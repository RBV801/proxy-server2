const mongoose = require('mongoose');

const FeedbackSchema = new mongoose.Schema({
  searchContext: String,
  matchFactors: [String],
  rating: String,
  note: String,
  timestamp: { type: Date, default: Date.now },
  userId: String,
  searchResults: [{
    movieId: String,
    title: String,
    position: Number,
    clicked: Boolean
  }],
  aiCreditsUsed: Number
});

module.exports = mongoose.model('Feedback', FeedbackSchema);