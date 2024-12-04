require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

const searchCache = new Map();
const CACHE_DURATION = 3600000; // 1 hour

function normalizeSearchTerms(query) {
  if (!query) return [];
  
  const terms = new Set([query.toLowerCase()]);
  
  // Add individual words as terms if they're meaningful
  query.toLowerCase().split(' ').forEach(word => {
    if (word.length > 2 && !['the', 'and', 'for', 'with'].includes(word)) {
      terms.add(word);
    }
  });

  return Array.from(terms);
}

async function searchPerson(term) {
  if (!term) return new Map();
  
  try {
    const response = await fetch(
      `https://api.themoviedb.org/3/search/person?api_key=${process.env.TMDB_API_KEY}&query=${encodeURIComponent(term)}`
    );
    
    if (!response.ok) {
      console.error(`TMDB person search failed: ${response.status} ${response.statusText}`);
      return new Map();
    }
    
    const data = await response.json();
    
    if (!data.results) return new Map();

    const movieMap = new Map();
    for (const person of data.results) {
      if (person.known_for) {
        for (const movie of person.known_for) {
          if (movie.media_type === 'movie') {
            movieMap.set(movie.id, {
              ...movie,
              matchedTerms: new Set([term]),
              score: person.popularity,
              popularity: movie.popularity || 1
            });
          }
        }
      }
    }
    
    return movieMap;
  } catch (error) {
    console.error('Error in searchPerson:', error);
    return new Map();
  }
}

async function searchMovies(term) {
  if (!term) return new Map();
  
  try {
    const response = await fetch(
      `https://api.themoviedb.org/3/search/movie?api_key=${process.env.TMDB_API_KEY}&query=${encodeURIComponent(term)}`
    );
    
    if (!response.ok) {
      console.error(`TMDB movie search failed: ${response.status} ${response.statusText}`);
      return new Map();
    }
    
    const data = await response.json();
    
    if (!data.results) return new Map();

    const movieMap = new Map();
    for (const movie of data.results) {
      movieMap.set(movie.id, {
        ...movie,
        matchedTerms: new Set([term]),
        score: movie.vote_average || 1,
        popularity: movie.popularity || 1
      });
    }
    
    return movieMap;
  } catch (error) {
    console.error('Error in searchMovies:', error);
    return new Map();
  }
}

async function searchTMDB(query, page = 1) {
  if (!query) {
    console.error('No query provided to searchTMDB');
    return { results: [], total_results: 0, total_pages: 0, page: 1 };
  }

  try {
    const cacheKey = `search:${query}:${page}`;
    if (searchCache.has(cacheKey)) {
      const cached = searchCache.get(cacheKey);
      if (Date.now() - cached.timestamp < CACHE_DURATION) return cached.data;
    }

    const searchTerms = normalizeSearchTerms(query);
    console.log('Normalized search terms:', searchTerms);
    
    if (!searchTerms.length) {
      console.error('No valid search terms generated from query:', query);
      return { results: [], total_results: 0, total_pages: 0, page: 1 };
    }

    const results = new Map();
    
    for (const term of searchTerms) {
      const [movieResults, personResults] = await Promise.all([
        searchMovies(term),
        searchPerson(term)
      ]);

      for (const [id, movie] of movieResults) {
        if (results.has(id)) {
          results.get(id).matchedTerms.add(term);
          results.get(id).score += movie.score;
        } else {
          results.set(id, movie);
        }
      }
      
      for (const [id, movie] of personResults) {
        if (results.has(id)) {
          for (const term of movie.matchedTerms) {
            results.get(id).matchedTerms.add(term);
          }
          results.get(id).score += movie.score * 2;
        } else {
          results.set(id, { ...movie, score: movie.score * 2 });
        }
      }
    }

    let sortedResults = Array.from(results.values())
      .sort((a, b) => (b.score * b.popularity) - (a.score * a.popularity));
      
    if (query.toLowerCase().includes('latest')) {
      sortedResults = sortedResults.sort((a, b) => 
        new Date(b.release_date || '1900-01-01') - new Date(a.release_date || '1900-01-01')
      );
    }

    const startIndex = (page - 1) * 10;
    const endIndex = startIndex + 10;
    const paginatedResults = sortedResults.slice(startIndex, endIndex);

    const data = { 
      results: paginatedResults, 
      total_results: sortedResults.length,
      total_pages: Math.ceil(sortedResults.length / 10),
      page
    };
    
    searchCache.set(cacheKey, { data, timestamp: Date.now() });
    return data;
  } catch (error) {
    console.error('Error in searchTMDB:', error);
    throw error;
  }
}

async function getMovieDetails(tmdbId) {
  if (!tmdbId) return null;
  
  try {
    const [detailsResponse, keywordsResponse, providersResponse] = await Promise.all([
      fetch(`https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${process.env.TMDB_API_KEY}`),
      fetch(`https://api.themoviedb.org/3/movie/${tmdbId}/keywords?api_key=${process.env.TMDB_API_KEY}`),
      fetch(`https://api.themoviedb.org/3/movie/${tmdbId}/watch/providers?api_key=${process.env.TMDB_API_KEY}`)
    ]);

    if (!detailsResponse.ok) {
      console.error(`Failed to fetch movie details: ${detailsResponse.status} ${detailsResponse.statusText}`);
      return null;
    }

    const [details, keywords, providers] = await Promise.all([
      detailsResponse.json(),
      keywordsResponse.ok ? keywordsResponse.json() : { keywords: [] },
      providersResponse.ok ? providersResponse.json() : { results: {} }
    ]);

    return {
      ...details,
      keywords,
      'watch/providers': providers
    };
  } catch (error) {
    console.error('Error in getMovieDetails:', error);
    return null;
  }
}

app.get('/api/search', async (req, res) => {
  try {
    const { query, page = 1 } = req.query;
    console.log('Received search request:', { query, page });
    
    if (!query) {
      return res.status(400).json({ error: 'Search query is required' });
    }

    const tmdbData = await searchTMDB(query, parseInt(page));
    console.log(`Found ${tmdbData.total_results} total results`);

    const tmdbDetails = await Promise.all(
      tmdbData.results.map(movie => getMovieDetails(movie.id))
    );

    const enrichedResults = [];
    const processedTitles = new Set();

    for (const tmdbMovie of tmdbDetails) {
      if (!tmdbMovie) continue;
      
      const normalizedTitle = tmdbMovie.title.toLowerCase();
      if (!processedTitles.has(normalizedTitle)) {
        processedTitles.add(normalizedTitle);

        const keywords = tmdbMovie.keywords?.keywords?.map(k => k.name) || [];
        const genres = tmdbMovie.genres?.map(g => g.name) || [];

        let recommendationScore = Math.round(
          (tmdbMovie.vote_average * 10) + 
          (tmdbMovie.popularity * 0.1) +
          (tmdbMovie.vote_count * 0.01) +
          (keywords.some(k => query.toLowerCase().includes(k.toLowerCase())) ? 50 : 0) +
          (genres.some(g => query.toLowerCase().includes(g.toLowerCase())) ? 30 : 0)
        );

        enrichedResults.push({
          id: tmdbMovie.id,
          title: tmdbMovie.title,
          year: tmdbMovie.release_date?.substring(0, 4),
          tmdbData: {
            ...tmdbMovie,
            streamingProviders: tmdbMovie['watch/providers']?.results?.US || {}
          },
          keywords,
          genres,
          recommendationScore
        });
      }
    }

    enrichedResults.sort((a, b) => b.recommendationScore - a.recommendationScore);

    const response = {
      totalResults: tmdbData.total_results,
      totalPages: tmdbData.total_pages,
      page: tmdbData.page,
      hasMore: tmdbData.page < tmdbData.total_pages,
      Search: enrichedResults
    };

    console.log(`Returning ${enrichedResults.length} enriched results`);
    res.json(response);
  } catch (error) {
    console.error('Proxy server error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

app.listen(PORT, () => {
  console.log(`Proxy server running on port ${PORT}`);
});