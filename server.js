require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

app.use((req, res, next) => {
    const startTime = Date.now();
    console.log(`\n[${new Date().toISOString()}] ${req.method} ${req.url}`);
    console.log('Query params:', req.query);

    const originalJson = res.json;
    res.json = function(body) {
        const endTime = Date.now();
        console.log(`Response time: ${endTime - startTime}ms`);
        console.log('Response size:', JSON.stringify(body).length, 'bytes');
        console.log('Total results:', body.totalResults || 0);
        return originalJson.call(this, body);
    };
    next();
});

const logApiCall = async (name, url) => {
    console.log(`\n[${new Date().toISOString()}] API Call: ${name}`);
    console.log('URL:', url);
};

async function parseSearchWithClaude(query) {
    try {
        console.log('\n[Claude API] Parsing query:', query);
        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': process.env.ANTHROPIC_API_KEY,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                messages: [{
                    role: 'user',
                    content: `Parse this movie search query into specific search terms for finding relevant movies: "${query}". Return only key terms as comma-separated list, focusing on descriptive terms that would help find the most relevant movies.`
                }],
                model: 'claude-3-haiku-20240307',
                max_tokens: 100
            })
        });
        const data = await response.json();
        const keywords = data.content.split(',').map(k => k.trim());
        console.log('[Claude API] Extracted keywords:', keywords);
        return keywords;
    } catch (error) {
        console.error('[Claude API] Error:', error);
        return query.toLowerCase().split(' ')
            .filter(word => !['with', 'and', 'the', 'a', 'an', 'in', 'on', 'at', 'to', 'for', 'of'].includes(word));
    }
}

async function searchTMDB(query, page = 1) {
    try {
        const keywords = await parseSearchWithClaude(query);
        console.log('Processing keywords:', keywords);
        
        const requests = keywords.map(async keyword => {
            const url = `https://api.themoviedb.org/3/search/movie?api_key=${process.env.TMDB_API_KEY}&query=${encodeURIComponent(keyword)}&page=${page}&include_adult=false`;
            await logApiCall('TMDB Search', url);
            const response = await fetch(url);
            const data = await response.json();
            console.log(`Results for "${keyword}": ${data.results?.length || 0}`);
            return { keyword, data };
        });

        const responses = await Promise.all(requests);
        
        const movieMap = new Map();
        const keywordWeights = {
            monster: 3,
            creature: 3,
            horror: 2,
            scary: 2,
            cool: 2,
            awesome: 2,
            amazing: 2,
            design: 2,
            special: 1.5,
            effects: 1.5
        };

        responses.forEach(({keyword, data}) => {
            data.results?.forEach(movie => {
                if (movieMap.has(movie.id)) {
                    const existingMovie = movieMap.get(movie.id);
                    existingMovie.score += keywordWeights[keyword.toLowerCase()] || 1;
                    existingMovie.matchedKeywords.add(keyword);
                } else {
                    movieMap.set(movie.id, {
                        ...movie,
                        score: keywordWeights[keyword.toLowerCase()] || 1,
                        matchedKeywords: new Set([keyword])
                    });
                }
            });
        });

        const results = Array.from(movieMap.values())
            .sort((a, b) => {
                const scoreA = a.score * (a.popularity || 1) * (a.vote_average || 1);
                const scoreB = b.score * (b.popularity || 1) * (b.vote_average || 1);
                return scoreB - scoreA;
            })
            .slice(0, 10);

        console.log('Total unique movies found:', movieMap.size);
        console.log('Returning top results:', results.length);

        return { results, total_pages: Math.ceil(movieMap.size / 10) };
    } catch (error) {
        console.error('TMDB Search Error:', error);
        return { results: [], total_pages: 0 };
    }
}

async function getMovieDetails(tmdbId) {
    try {
        const url = `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${process.env.TMDB_API_KEY}&append_to_response=keywords,watch/providers`;
        await logApiCall('TMDB Details', url);
        const response = await fetch(url);
        const data = await response.json();
        return data;
    } catch (error) {
        console.error('TMDB Details Error:', error);
        return null;
    }
}

async function searchOMDB(query) {
    try {
        const url = `https://www.omdbapi.com/?s=${encodeURIComponent(query)}&apikey=${process.env.OMDB_API_KEY}&type=movie`;
        await logApiCall('OMDB Search', url);
        const response = await fetch(url);
        const text = await response.text();
        try {
            const data = JSON.parse(text);
            console.log('OMDB results:', data.Search?.length || 0);
            return data;
        } catch (e) {
            console.error('OMDB Response:', text);
            return { Search: [] };
        }
    } catch (error) {
        console.error('OMDB Search Error:', error);
        return { Search: [] };
    }
}

async function getOMDBDetails(imdbId) {
    try {
        const url = `https://www.omdbapi.com/?i=${imdbId}&apikey=${process.env.OMDB_API_KEY}`;
        await logApiCall('OMDB Details', url);
        const response = await fetch(url);
        const data = await response.json();
        return data;
    } catch (error) {
        console.error('OMDB Details Error:', error);
        return null;
    }
}

app.get('/api/search', async (req, res) => {
    try {
        const { query, page = 1 } = req.query;
        if (!query) {
            return res.status(400).json({ error: 'Search query is required' });
        }

        console.log('\nStarting search process...');
        const startTime = Date.now();

        const [omdbData, tmdbData] = await Promise.all([
            searchOMDB(query),
            searchTMDB(query, page)
        ]);

        console.log('\nFetching movie details...');
        const tmdbDetails = await Promise.all(
            tmdbData.results.map(movie => getMovieDetails(movie.id))
        );

        const enrichedResults = [];
        const processedTitles = new Set();

        console.log('\nProcessing TMDB results...');
        for (const tmdbMovie of tmdbDetails) {
            if (!tmdbMovie) continue;
            const normalizedTitle = tmdbMovie.title.toLowerCase();
            if (!processedTitles.has(normalizedTitle)) {
                processedTitles.add(normalizedTitle);
                const baseMovie = tmdbData.results.find(m => m.id === tmdbMovie.id);
                enrichedResults.push({
                    id: tmdbMovie.id,
                    title: tmdbMovie.title,
                    year: tmdbMovie.release_date?.substring(0, 4),
                    tmdbData: {
                        ...tmdbMovie,
                        matchedKeywords: baseMovie?.matchedKeywords ? Array.from(baseMovie.matchedKeywords) : [],
                        streamingProviders: tmdbMovie['watch/providers']?.results?.US || {}
                    },
                    keywords: tmdbMovie.keywords?.keywords?.map(k => k.name) || [],
                    genres: tmdbMovie.genres?.map(g => g.name) || [],
                    recommendationScore: Math.round(
                        (baseMovie?.score || 0) * 10 +
                        (tmdbMovie.vote_average * 10) +
                        (tmdbMovie.popularity * 0.1) +
                        (tmdbMovie.vote_count * 0.01)
                    )
                });
            }
        }

        console.log('\nProcessing OMDB results...');
        if (omdbData.Search) {
            for (const omdbMovie of omdbData.Search) {
                const normalizedTitle = omdbMovie.Title.toLowerCase();
                const existingMovie = enrichedResults.find(
                    m => m.title.toLowerCase() === normalizedTitle
                );

                if (existingMovie) {
                    const omdbDetails = await getOMDBDetails(omdbMovie.imdbID);
                    if (omdbDetails) {
                        existingMovie.omdbData = omdbDetails;
                    }
                } else {
                    const details = await getOMDBDetails(omdbMovie.imdbID);
                    if (details) {
                        enrichedResults.push({
                            title: omdbMovie.Title,
                            year: omdbMovie.Year,
                            Poster: omdbMovie.Poster,
                            omdbData: details,
                            recommendationScore: Math.round(
                                (parseFloat(details.imdbRating || 0) * 10) +
                                (parseInt(details.imdbVotes?.replace(/,/g, '') || 0) * 0.001)
                            )
                        });
                    }
                }
            }
        }

        enrichedResults.sort((a, b) => b.recommendationScore - a.recommendationScore);

        const endTime = Date.now();
        console.log(`\nTotal processing time: ${endTime - startTime}ms`);
        console.log('Final results count:', enrichedResults.length);

        res.json({
            totalResults: enrichedResults.length,
            Search: enrichedResults,
            currentPage: parseInt(page),
            hasMore: false,
            processingTime: endTime - startTime
        });
    } catch (error) {
        console.error('\nProxy server error:', error);
        res.status(500).json({
            error: 'Internal server error',
            message: error.message,
            totalResults: 0,
            Search: []
        });
    }
});

app.listen(PORT, () => {
    console.log(`\nServer started at ${new Date().toISOString()}`);
    console.log(`Listening on port ${PORT}`);
    console.log('Environment:', process.env.NODE_ENV || 'development');
});