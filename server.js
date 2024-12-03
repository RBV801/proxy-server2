require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

async function searchTMDB(query) {
    const response = await fetch(
        `https://api.themoviedb.org/3/search/movie?api_key=${process.env.TMDB_API_KEY}&query=${encodeURIComponent(query)}`
    );
    return response.json();
}

async function getMovieDetails(tmdbId) {
    const response = await fetch(
        `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${process.env.TMDB_API_KEY}&append_to_response=keywords`
    );
    return response.json();
}

app.get('/api/search', async (req, res) => {
    try {
        const { query } = req.query;
        if (!query) {
            return res.status(400).json({ error: 'Search query is required' });
        }

        const [omdbResponse, tmdbResponse] = await Promise.all([
            fetch(`http://www.omdbapi.com/?s=${query}&apikey=${process.env.OMDB_API_KEY}`),
            searchTMDB(query)
        ]);

        const [omdbData, tmdbData] = await Promise.all([
            omdbResponse.json(),
            tmdbResponse
        ]);

        // Get additional details for TMDB results
        const tmdbDetails = await Promise.all(
            tmdbData.results.slice(0, 5).map(movie => getMovieDetails(movie.id))
        );

        // Combine and enrich results
        const enrichedResults = [];
        
        if (omdbData.Search) {
            for (const omdbMovie of omdbData.Search) {
                const tmdbMatch = tmdbDetails.find(t => {
                    return t.title.toLowerCase() === omdbMovie.Title.toLowerCase();
                });

                enrichedResults.push({
                    ...omdbMovie,
                    overview: tmdbMatch?.overview || '',
                    genres: tmdbMatch?.genres?.map(g => g.name) || [],
                    keywords: tmdbMatch?.keywords?.keywords?.map(k => k.name) || [],
                    rating: tmdbMatch?.vote_average || null
                });
            }
        }

        res.json({ Search: enrichedResults });
    } catch (error) {
        console.error('Proxy server error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.listen(PORT, () => {
    console.log(`Proxy server running on port ${PORT}`);
});