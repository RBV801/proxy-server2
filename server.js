require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

async function searchTMDB(query, page = 1) {
    try {
        // Process complex queries
        const keywords = query.toLowerCase().split(' ')
            .filter(word => !['with', 'and', 'the', 'a', 'an', 'in', 'on', 'at', 'to', 'for', 'of'].includes(word));
        
        // Search by keywords and get more results
        const requests = keywords.map(keyword =>
            fetch(`https://api.themoviedb.org/3/search/movie?api_key=${process.env.TMDB_API_KEY}&query=${encodeURIComponent(keyword)}&page=${page}&include_adult=false`)
                .then(res => res.json())
        );

        const responses = await Promise.all(requests);
        
        // Merge and score results
        const movieMap = new Map();
        responses.forEach(response => {
            response.results?.forEach(movie => {
                if (movieMap.has(movie.id)) {
                    movieMap.get(movie.id).score += 1;
                } else {
                    movieMap.set(movie.id, {
                        ...movie,
                        score: 1
                    });
                }
            });
        });

        // Convert to array and sort by score and popularity
        const results = Array.from(movieMap.values())
            .sort((a, b) => (b.score * b.popularity) - (a.score * a.popularity))
            .slice(0, 20);

        return { results, total_pages: Math.ceil(results.length / 20) };
    } catch (error) {
        console.error('TMDB Search Error:', error);
        throw error;
    }
}

async function getMovieDetails(tmdbId) {
    try {
        const url = `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${process.env.TMDB_API_KEY}&append_to_response=keywords,watch/providers`;
        const response = await fetch(url);
        const data = await response.json();
        return data;
    } catch (error) {
        console.error('TMDB Details Error:', error);
        throw error;
    }
}

async function searchOMDB(query, page = 1) {
    try {
        const url = `https://www.omdbapi.com/?s=${encodeURIComponent(query)}&apikey=${process.env.OMDB_API_KEY}&page=${page}`;
        const response = await fetch(url);
        const data = await response.json();
        return data;
    } catch (error) {
        console.error('OMDB Search Error:', error);
        throw error;
    }
}

async function getOMDBDetails(imdbId) {
    try {
        const url = `https://www.omdbapi.com/?i=${imdbId}&apikey=${process.env.OMDB_API_KEY}`;
        const response = await fetch(url);
        const data = await response.json();
        return data;
    } catch (error) {
        console.error('OMDB Details Error:', error);
        throw error;
    }
}

app.get('/api/search', async (req, res) => {
    try {
        const { query } = req.query;
        if (!query) {
            return res.status(400).json({ error: 'Search query is required' });
        }

        const [omdbData, tmdbData] = await Promise.all([
            searchOMDB(query),
            searchTMDB(query)
        ]);

        const tmdbDetails = await Promise.all(
            tmdbData.results.map(movie => getMovieDetails(movie.id))
        );

        const enrichedResults = [];
        const processedTitles = new Set();

        // Process TMDB results first
        for (const tmdbMovie of tmdbDetails) {
            const normalizedTitle = tmdbMovie.title.toLowerCase();
            if (!processedTitles.has(normalizedTitle)) {
                processedTitles.add(normalizedTitle);
                enrichedResults.push({
                    id: tmdbMovie.id,
                    title: tmdbMovie.title,
                    year: tmdbMovie.release_date?.substring(0, 4),
                    tmdbData: {
                        ...tmdbMovie,
                        streamingProviders: tmdbMovie['watch/providers']?.results?.US || {}
                    },
                    keywords: tmdbMovie.keywords?.keywords?.map(k => k.name) || [],
                    genres: tmdbMovie.genres?.map(g => g.name) || [],
                    recommendationScore: Math.round(
                        (tmdbMovie.vote_average * 10) +
                        (tmdbMovie.popularity * 0.1) +
                        (tmdbMovie.vote_count * 0.01)
                    )
                });
            }
        }

        // Add OMDB results
        if (omdbData.Search) {
            for (const omdbMovie of omdbData.Search) {
                const normalizedTitle = omdbMovie.Title.toLowerCase();
                const existingMovie = enrichedResults.find(
                    m => m.title.toLowerCase() === normalizedTitle
                );

                if (existingMovie) {
                    existingMovie.omdbData = await getOMDBDetails(omdbMovie.imdbID);
                } else {
                    const details = await getOMDBDetails(omdbMovie.imdbID);
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

        // Sort by recommendation score
        enrichedResults.sort((a, b) => b.recommendationScore - a.recommendationScore);

        res.json({
            totalResults: enrichedResults.length,
            Search: enrichedResults,
            currentPage: 1,
            hasMore: false
        });
    } catch (error) {
        console.error('Proxy server error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.listen(PORT, () => {
    console.log(`Proxy server running on port ${PORT}`);});
