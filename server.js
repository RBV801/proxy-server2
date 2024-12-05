require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const feedbackRoutes = require('./routes/feedback');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log('Connected to MongoDB'))
.catch(err => console.error('MongoDB connection error:', err));

// Routes
app.use('/api/feedback', feedbackRoutes);

// Search endpoint
app.get('/api/search', async (req, res) => {
  try {
    const { query, page = 1 } = req.query;
    const response = await fetch(
      `http://www.omdbapi.com/?apikey=${process.env.OMDB_API_KEY}&s=${encodeURIComponent(query)}&page=${page}`
    );
    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: 'Failed to process search request' });
  }
});

// Error handling
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send('Something broke!');
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});