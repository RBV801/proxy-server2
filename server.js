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
          content: `Analyze this movie search query: "${query}". Extract key search terms, considering:
          1. Actor/director names - include their common name variations
          2. Movie-related terms (e.g., 'movies', 'films') - remove if combined with person name
          3. Descriptive terms
          Return as JSON array.`
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
    return query.toLowerCase().split(' ').filter(term => 
      !['movies', 'films', 'movie', 'film', 'and', 'the', 'with'].includes(term)
    );
  }
}

async function searchPerson(term) {
  const url = `https://api.themoviedb.org/3/search/person?api_key=${process.env.TMDB_API_KEY}&query=${encodeURIComponent(term)}`;
  const response = await fetch(url);
  const data = await response.json();
  
  const movies = new Map();
  for (const person of data.results || []) {
    const creditsUrl = `https://api.themoviedb.org/3/person/${person.id}/movie_credits?api_key=${process.env.TMDB_API_KEY}`;
    const creditsResponse = await fetch(creditsUrl);
    const creditsData = await creditsResponse.json();
    
    for (const movie of [...(creditsData.cast || []), ...(creditsData.crew || [])]) {
      if (movies.has(movie.id)) {
        movies.get(movie.id).score += 5;
      } else {
        movies.set(movie.id, {
          ...movie,
          score: 5,
          matchedTerms: new Set([`${term} (as ${person.name})`])
        });
      }
    }
  }
  return movies;
}

async function searchMovies(term) {
  const url = `https://api.themoviedb.org/3/search/movie?api_key=${process.env.TMDB_API_KEY}&query=${encodeURIComponent(term)}&include_adult=false`;
  const response = await fetch(url);
  const data = await response.json();
  
  return new Map(
    data.results.map(movie => [
      movie.id,
      {
        ...movie,
        score: 1,
        matchedTerms: new Set([term])
      }
    ])
  );
}

async function searchTMDB(query) {
  const cacheKey = `search:${query}`;
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
        results.get(id).score += movie.score;
      } else {
        results.set(id, movie);
      }
    }
  }

  const sortedResults = Array.from(results.values())
    .sort((a, b) => {
      if (query.toLowerCase().includes('latest')) {
        return new Date(b.release_date || 0) - new Date(a.release_date || 0);
      }
      return (b.score * b.popularity) - (a.score * a.popularity);
    });

  const data = { results: sortedResults, total_results: sortedResults.length };
  searchCache.set(cacheKey, { data, timestamp: Date.now() });
  return data;
}

async function getMovieDetails(tmdbId) {
    try {
        const url = `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${process.env.TMDB_API_KEY}&append_to_response=keywords,watch/providers`;
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
        const response = await fetch(url);
        const data = await response.json();
        return data;
    } catch (error) {
        console.error('OMDB Search Error:', error);
        return { Search: [] };
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
        return null;
    }
}

app.get('/api/search', async (req, res) => {
    try {
        const { query, page = 1 } = req.query;
        if (!query) {
            return res.status(400).json({ error: 'Search query is required' });
        }

        const [omdbData, tmdbData] = await Promise.all([
            searchOMDB(query),
            searchTMDB(query, page)
        ]);

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

        res.json({
            totalResults: enrichedResults.length,
            Search: enrichedResults,
            currentPage: parseInt(page),
            hasMore: false
        });
    } catch (error) {
        console.error('Proxy server error:', error);
        res.status(500).json({
            error: 'Internal server error',
            message: error.message,
            totalResults: 0,
            Search: []
        });
    }
});

app.listen(PORT, () => {
    console.log(`Proxy server running on port ${PORT}`);});
