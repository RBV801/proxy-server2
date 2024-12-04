require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

const movieCache = new Map();
const CACHE_DURATION = 3600000; // 1 hour

app.use((req, res, next) => {
    const startTime = Date.now();
    console.log(`\n[${new Date().toISOString()}] ${req.method} ${req.url}`);
    console.log('Query params:', req.query);

    res.json = function(body) {
        const endTime = Date.now();
        console.log(`Response time: ${endTime - startTime}ms`);
        return express.response.json.call(this, body);
    };
    next();
});

async function parseSearchWithClaude(query) {
    try {
        console.log('[Claude API] Processing:', query);
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
                    content: `Extract key search terms from: "${query}". Return comma-separated terms only.`
                }],
                model: 'claude-3-haiku-20240307',
                max_tokens: 50
            })
        });

        if (!response.ok) throw new Error(`Claude API error: ${response.status}`);
        const data = await response.json();
        const terms = data.content?.split(',').map(t => t.trim()).filter(Boolean) || [];
        console.log('[Claude API] Terms:', terms);
        return terms;
    } catch (error) {
        console.error('[Claude API] Error:', error);
        return query.toLowerCase().split(' ')
            .filter(word => !['with', 'and', 'the', 'a', 'an', 'in', 'on', 'at', 'to', 'for', 'of'].includes(word));
    }
}

async function searchTMDB(query, page = 1) {
    const cacheKey = `tmdb:${query}:${page}`;
    if (movieCache.has(cacheKey)) {
        const cached = movieCache.get(cacheKey);
        if (Date.now() - cached.timestamp < CACHE_DURATION) {
            return cached.data;
        }
        movieCache.delete(cacheKey);
    }

    const keywords = await parseSearchWithClaude(query);
    console.log('Search terms:', keywords);
    
    const requests = keywords.map(async keyword => {
        const url = `https://api.themoviedb.org/3/search/movie?api_key=${process.env.TMDB_API_KEY}&query=${encodeURIComponent(keyword)}&page=${page}&include_adult=false`;
        const response = await fetch(url);
        const data = await response.json();
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
        design: 2
    };

    responses.forEach(({keyword, data}) => {
        data.results?.forEach(movie => {
            if (movieMap.has(movie.id)) {
                movieMap.get(movie.id).score += keywordWeights[keyword.toLowerCase()] || 1;
            } else {
                movieMap.set(movie.id, {
                    ...movie,
                    score: keywordWeights[keyword.toLowerCase()] || 1
                });
            }
        });
    });

    const results = Array.from(movieMap.values())
        .sort((a, b) => (b.score * b.vote_average * b.popularity) - (a.score * a.vote_average * a.popularity))
        .slice(0, 10);

    const resultData = { results, total_pages: Math.ceil(movieMap.size / 10) };
    movieCache.set(cacheKey, { data: resultData, timestamp: Date.now() });
    return resultData;
}

async function getMovieDetails(tmdbId) {
    const cacheKey = `tmdb:details:${tmdbId}`;
    if (movieCache.has(cacheKey)) {
        const cached = movieCache.get(cacheKey);
        if (Date.now() - cached.timestamp < CACHE_DURATION) {
            return cached.data;
        }
        movieCache.delete(cacheKey);
    }

    const url = `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${process.env.TMDB_API_KEY}&append_to_response=keywords,watch/providers`;
    const response = await fetch(url);
    const data = await response.json();
    
    movieCache.set(cacheKey, { data, timestamp: Date.now() });
    return data;
}

async function searchOMDB(query) {
    const cacheKey = `omdb:${query}`;
    if (movieCache.has(cacheKey)) {
        const cached = movieCache.get(cacheKey);
        if (Date.now() - cached.timestamp < CACHE_DURATION) {
            return cached.data;
        }
        movieCache.delete(cacheKey);
    }

    try {
        const url = `https://www.omdbapi.com/?s=${encodeURIComponent(query)}&apikey=${process.env.OMDB_API_KEY}&type=movie`;
        const response = await fetch(url);
        const text = await response.text();
        const data = JSON.parse(text);
        movieCache.set(cacheKey, { data, timestamp: Date.now() });
        return data;
    } catch (error) {
        console.error('OMDB Search Error:', error);
        return { Search: [] };
    }
}

app.get('/api/search', async (req, res) => {
    try {
        const { query, page = 1 } = req.query;
        if (!query) {
            return res.status(400).json({ error: 'Search query is required' });
        }

        const [tmdbData] = await Promise.all([
            searchTMDB(query, page)
        ]);

        const tmdbDetails = await Promise.all(
            tmdbData.results.map(movie => getMovieDetails(movie.id))
        );

        const enrichedResults = tmdbDetails
            .filter(Boolean)
            .map(movie => ({
                id: movie.id,
                title: movie.title,
                year: movie.release_date?.substring(0, 4),
                tmdbData: {
                    ...movie,
                    streamingProviders: movie['watch/providers']?.results?.US || {}
                },
                keywords: movie.keywords?.keywords?.map(k => k.name) || [],
                genres: movie.genres?.map(g => g.name) || [],
                recommendationScore: Math.round(
                    (movie.vote_average * 10) +
                    (movie.popularity * 0.1) +
                    (movie.vote_count * 0.01)
                )
            }));

        enrichedResults.sort((a, b) => b.recommendationScore - a.recommendationScore);

        res.json({
            totalResults: enrichedResults.length,
            Search: enrichedResults,
            currentPage: parseInt(page),
            hasMore: false
        });
    } catch (error) {
        console.error('Server error:', error);
        res.status(500).json({
            error: 'Internal server error',
            message: error.message,
            totalResults: 0,
            Search: []
        });
    }
});

app.listen(PORT, () => {
    console.log(`Server started on port ${PORT}`);
});