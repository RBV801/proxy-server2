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
  // ... (unchanged)
}

async function searchPerson(term) {
  // ... (unchanged) 
}

async function searchMovies(term) {
  // ... (unchanged)
}

async function searchTMDB(query, page = 1) {
  const cacheKey = `search:${query}:${page}`;
  if (searchCache.has(cacheKey)) {
    const cached = searchCache.get(cacheKey);
    if (Date.now() - cached.timestamp < CACHE_DURATION) return cached.data;
  }

  const searchTerms = await parseSearchWithClaude(query);
  console.log('Search terms:', searchTerms);
  
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
        results.get(id).score += movie.score * 2; // Increase weight for person matches
      } else {
        results.set(id, { ...movie, score: movie.score * 2 }); // Increase weight for person matches
      }
    }
  }

  let sortedResults = Array.from(results.values())
    .sort((a, b) => {
      return (b.score * b.popularity) - (a.score * a.popularity);
    });
    
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
}

async function getMovieDetails(tmdbId) {
  // ... (unchanged)
}

async function searchOMDB(query) {
  // ... (unchanged)  
}

async function getOMDBDetails(imdbId) {
  // ... (unchanged)
}

app.get('/api/search', async (req, res) => {
  try {
    const { query, page = 1 } = req.query;
    if (!query) {
      return res.status(400).json({ error: 'Search query is required' });    
    }

    const tmdbData = await searchTMDB(query, page);

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
          (keywords.some(k => query.toLowerCase().includes(k)) ? 50 : 0) +
          (genres.some(g => query.toLowerCase().includes(g)) ? 30 : 0)
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

    res.json({
      totalResults: tmdbData.total_results,
      totalPages: tmdbData.total_pages, 
      page: tmdbData.page,
      hasMore: tmdbData.page < tmdbData.total_pages,
      Search: enrichedResults
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
