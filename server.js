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
        const url = `https://api.themoviedb.org/3/search/movie?api_key=${process.env.TMDB_API_KEY}&query=${encodeURIComponent(query)}&page=${page}&include_adult=false`;
        const response = await fetch(url);
        const data = await response.json();
        return data;
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
        const url = `http://www.omdbapi.com/?s=${encodeURIComponent(query)}&apikey=${process.env.OMDB_API_KEY}&page=${page}`;
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
        const url = `http://www.omdbapi.com/?i=${imdbId}&apikey=${process.env.OMDB_API_KEY}`;
        const response = await fetch(url);
        const data = await response.json();
        return data;
    } catch (error) {
        console.error('OMDB Details Error:', error);
        throw error;
    }
}

function normalizeTitle(title) {
    return title.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function calculateRecommendationScore(movie) {
    let score = 0;
    
    // Base score from TMDb popularity and vote average
    if (movie.tmdbData) {
        score += (movie.tmdbData.popularity || 0) * 0.5;
        score += (movie.tmdbData.vote_average || 0) * 10;
        score += (movie.tmdbData.vote_count || 0) * 0.01;
    }
    
    // Additional score from IMDb rating
    if (movie.omdbData && movie.omdbData.imdbRating) {
        score += parseFloat(movie.omdbData.imdbRating) * 10;
    }
    
    return Math.round(score);
}

app.get('/api/search', async (req, res) => {
    try {
        const { query, page = 1 } = req.query;
        if (!query) {
            return res.status(400).json({ error: 'Search query is required' });
        }

        // Fetch initial results from both APIs
        const [tmdbResponse, omdbResponse] = await Promise.all([
            searchTMDB(query, page),
            searchOMDB(query, page)
        ]);

        // Create a map to store merged results
        const mergedResults = new Map();

        // Process TMDb results
        if (tmdbResponse.results) {
            for (const movie of tmdbResponse.results) {
                const normalizedTitle = normalizeTitle(movie.title);
                if (!mergedResults.has(normalizedTitle)) {
                    const details = await getMovieDetails(movie.id);
                    mergedResults.set(normalizedTitle, {
                        id: movie.id,
                        title: movie.title,
                        tmdbData: {
                            ...details,
                            streamingProviders: details['watch/providers']?.results?.US || {},
                        },
                        year: movie.release_date ? movie.release_date.substring(0, 4) : null,
                        type: 'movie',
                        keywords: details.keywords?.keywords?.map(k => k.name) || [],
                        genres: details.genres?.map(g => g.name) || []
                    });
                }
            }
        }

        // Process OMDB results
        if (omdbResponse.Search) {
            for (const movie of omdbResponse.Search) {
                const normalizedTitle = normalizeTitle(movie.Title);
                if (mergedResults.has(normalizedTitle)) {
                    // Enrich existing entry with OMDB data
                    const details = await getOMDBDetails(movie.imdbID);
                    mergedResults.get(normalizedTitle).omdbData = details;
                } else {
                    // Create new entry
                    mergedResults.set(normalizedTitle, {
                        title: movie.Title,
                        omdbData: await getOMDBDetails(movie.imdbID),
                        year: movie.Year,
                        type: movie.Type,
                        poster: movie.Poster
                    });
                }
            }
        }

        // Convert map to array and calculate recommendation scores
        const results = Array.from(mergedResults.values()).map(movie => ({
            ...movie,
            recommendationScore: calculateRecommendationScore(movie)
        }));

        // Sort by recommendation score
        results.sort((a, b) => b.recommendationScore - a.recommendationScore);

        res.json({
            totalResults: results.length,
            Search: results,
            currentPage: parseInt(page),
            hasMore: tmdbResponse.total_pages > page || (omdbResponse.totalResults > page * 10)
        });

    } catch (error) {
        console.error('Proxy server error:', error);
        res.status(500).json({ 
            error: 'Internal server error',
            message: error.message 
        });
    }
});

app.listen(PORT, () => {
    console.log(`Proxy server running on port ${PORT}`);
});