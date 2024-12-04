require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

async function parseSearchQuery(query) {
    try {
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
                    content: `Parse this movie search query and extract relevant search terms: "${query}". Return only key search terms as a comma-separated list, no explanation needed.`
                }],
                model: 'claude-3-haiku-20240307',
                max_tokens: 100
            })
        });

        const data = await response.json();
        const searchTerms = data.content.split(',').map(term => term.trim());
        return searchTerms;
    } catch (error) {
        console.error('Claude API Error:', error);
        return query.split(' ');
    }
}

async function searchTMDB(query, page = 1) {
    try {
        const searchTerms = await parseSearchQuery(query);
        const requests = searchTerms.map(term =>
            fetch(`https://api.themoviedb.org/3/search/movie?api_key=${process.env.TMDB_API_KEY}&query=${encodeURIComponent(term)}&page=${page}&include_adult=false`)
                .then(res => res.json())
                .catch(err => ({ results: [] }))
        );

        const responses = await Promise.all(requests);
        
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

        const results = Array.from(movieMap.values())
            .sort((a, b) => (b.score * b.popularity) - (a.score * a.popularity))
            .slice(0, 20);

        return { results, total_pages: Math.ceil(results.length / 20) };
    } catch (error) {
        console.error('TMDB Search Error:', error);
        return { results: [], total_pages: 0 };
    }
}

// Rest of the code remains the same...
