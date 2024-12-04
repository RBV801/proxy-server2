require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

const searchCache = new Map();
const CACHE_DURATION = 3600000;

async function parseSearchWithClaude(query) {
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2024-03-01'
      },
      body: JSON.stringify({
        messages: [{
          role: 'user',
          content: `Analyze this movie search query: "${query}". Return only key search terms as a JSON array. Include relevant synonyms and related terms. For actor names, include their well-known movies and roles.`
        }],
        model: 'claude-3-haiku-20240307',
        max_tokens: 150
      })
    });
    const data = await response.json();
    const terms = JSON.parse(data.content[0].text);
    return terms;
  } catch (error) {
    console.error('Claude API error:', error);
    return [query];
  }
}

async function searchTMDB(query) {
  const cacheKey = `search:${query}`;
  if (searchCache.has(cacheKey)) {
    const cached = searchCache.get(cacheKey);
    if (Date.now() - cached.timestamp < CACHE_DURATION) {
      return cached.data;
    }
  }

  const searchTerms = await parseSearchWithClaude(query);
  console.log('Search terms:', searchTerms);

  const results = new Map();
  
  for (const term of searchTerms) {
    // Search movies
    const movieUrl = `https://api.themoviedb.org/3/search/movie?api_key=${process.env.TMDB_API_KEY}&query=${encodeURIComponent(term)}&include_adult=false`;
    const movieResponse = await fetch(movieUrl);
    const movieData = await movieResponse.json();

    // Search people
    const personUrl = `https://api.themoviedb.org/3/search/person?api_key=${process.env.TMDB_API_KEY}&query=${encodeURIComponent(term)}`;
    const personResponse = await fetch(personUrl);
    const personData = await personResponse.json();

    // Process movie results
    for (const movie of movieData.results || []) {
      if (results.has(movie.id)) {
        results.get(movie.id).matchedTerms.add(term);
        results.get(movie.id).score += 1;
      } else {
        results.set(movie.id, {
          ...movie,
          matchedTerms: new Set([term]),
          score: 1
        });
      }
    }

    // Process person's movies
    for (const person of personData.results || []) {
      const creditsUrl = `https://api.themoviedb.org/3/person/${person.id}/movie_credits?api_key=${process.env.TMDB_API_KEY}`;
      const creditsResponse = await fetch(creditsUrl);
      const creditsData = await creditsResponse.json();

      for (const movie of creditsData.cast || []) {
        if (results.has(movie.id)) {
          results.get(movie.id).matchedTerms.add(`${term} (as ${person.name})`);
          results.get(movie.id).score += 2; // Higher weight for cast matches
        } else {
          results.set(movie.id, {
            ...movie,
            matchedTerms: new Set([`${term} (as ${person.name})`]),
            score: 2
          });
        }
      }
    }
  }

  const sortedResults = Array.from(results.values())
    .sort((a, b) => {
      // Prioritize recent movies for "latest" queries
      if (query.toLowerCase().includes('latest')) {
        return new Date(b.release_date || 0) - new Date(a.release_date || 0);
      }
      // Otherwise sort by score and popularity
      return (b.score * b.popularity) - (a.score * a.popularity);
    });

  const data = {
    results: sortedResults,
    total_results: sortedResults.length
  };

  searchCache.set(cacheKey, {
    data,
    timestamp: Date.now()
  });

  return data;
}

async function getMovieDetails(movieId) {
  const url = `https://api.themoviedb.org/3/movie/${movieId}?api_key=${process.env.TMDB_API_KEY}&append_to_response=keywords,credits`;
  const response = await fetch(url);
  const data = await response.json();
  return data;
}

app.get('/api/search', async (req, res) => {
  try {
    const { query } = req.query;
    if (!query) {
      return res.status(400).json({ error: 'Search query required' });
    }

    console.log('Processing search:', query);
    const searchData = await searchTMDB(query);

    const enrichedResults = await Promise.all(
      searchData.results.map(async (movie) => {
        const details = await getMovieDetails(movie.id);
        return {
          id: movie.id,
          title: movie.title,
          year: movie.release_date?.substring(0, 4),
          overview: movie.overview,
          poster_path: movie.poster_path,
          matchedTerms: Array.from(movie.matchedTerms),
          genres: details.genres?.map(g => g.name) || [],
          keywords: details.keywords?.keywords?.map(k => k.name) || [],
          cast: details.credits?.cast?.slice(0, 5).map(c => c.name) || [],
          recommendationScore: Math.round(
            (movie.score * 20) +
            (movie.vote_average * 10) +
            (movie.popularity * 0.1)
          )
        };
      })
    );

    res.json({
      totalResults: enrichedResults.length,
      Search: enrichedResults
    });

  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({
      error: 'Search failed',
      message: error.message
    });
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
