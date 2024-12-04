const mongoose = require('mongoose');

const SearchPatternSchema = new mongoose.Schema({
  userId: String,
  patterns: [{
    category: String,
    weight: Number,
    lastUpdated: Date
  }],
  preferences: {
    genres: { type: Map, of: Number },
    actors: { type: Map, of: Number },
    directors: { type: Map, of: Number },
    keywords: { type: Map, of: Number },
    eras: { type: Map, of: Number }
  },
  lastUpdated: { type: Date, default: Date.now }
});

module.exports = mongoose.model('SearchPattern', SearchPatternSchema);