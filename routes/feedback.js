const express = require('express');
const router = express.Router();
const feedbackService = require('../services/feedbackService');

router.post('/', async (req, res) => {
  try {
    const feedbackData = req.body;
    await feedbackService.storeFeedback(feedbackData);
    res.status(200).json({ message: 'Feedback stored successfully' });
  } catch (error) {
    console.error('Feedback storage error:', error);
    res.status(500).json({ error: 'Error storing feedback' });
  }
});

router.get('/weights/:userId', async (req, res) => {
  try {
    const weights = await feedbackService.getPersonalizedWeights(req.params.userId);
    res.status(200).json(weights);
  } catch (error) {
    console.error('Weight retrieval error:', error);
    res.status(500).json({ error: 'Error retrieving weights' });
  }
});

module.exports = router;