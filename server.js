require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const feedbackRoutes = require('./routes/feedback');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({
  origin: 'http://localhost:3000',
  methods: ['GET', 'POST'],
  credentials: true
}));

app.use(express.json());

mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log('Connected to MongoDB'))
.catch(err => console.error('MongoDB connection error:', err));

app.use('/api/feedback', feedbackRoutes);

app.get('/api/search', async (req, res) => {
  try {
    const { query = '', page = 1 } = req.query;
    if (!query) {
      return res.json({ Search: [], totalResults: 0 });
    }

    const response = await fetch(
      `http://www.omdbapi.com/?apikey=${process.env.OMDB_API_KEY}&s=${encodeURIComponent(query)}&page=${page}`
    );
    
    if (!response.ok) {
      throw new Error('OMDB API request failed');
    }

    const data = await response.json();
    console.log('OMDB Response:', data);

    if (data.Error) {
      return res.json({ Search: [], totalResults: 0, error: data.Error });
    }

    res.json(data);
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ 
      error: 'Failed to process search request',
      details: error.message 
    });
  }
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send('Something broke!');
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});