const express = require('express');
const cors = require('cors');
const app = express();
const port = 3000;

app.use(cors());

app.get('/api/search', async (req, res) => {
  try {
    const searchResults = await queryMovieDatabase(req.query.query);
    res.json({
      Search: searchResults.results,
      totalResults: searchResults.totalResults
    });
  } catch (error) {
    console.error('Error during search:', error);
    res.status(500).json({ error: 'An error occurred while processing the search request.' });
  }
});

app.use((err, req, res, next) => {
  console.error('Global error handler:', err);
  res.status(500).json({ error: 'An unexpected error occurred.' });
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});

async function queryMovieDatabase(query) {
  return {
    totalResults: 500,
    results: [
      { id: 1, title: 'The Wizard of Oz', year: 1939, actors: ['Judy Garland'] },
      { id: 2, title: 'A Star Is Born', year: 1954, actors: ['Judy Garland'] }
    ]
  };
}