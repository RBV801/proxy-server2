const Feedback = require('../models/Feedback');
const SearchPattern = require('../models/SearchPattern');

class FeedbackService {
  async storeFeedback(feedbackData) {
    try {
      const feedback = new Feedback(feedbackData);
      await feedback.save();
      await this.updateSearchPatterns(feedbackData);
      return true;
    } catch (error) {
      console.error('Error storing feedback:', error);
      throw error;
    }
  }

  async updateSearchPatterns(feedbackData) {
    const { userId, searchContext, matchFactors, rating } = feedbackData;
    
    try {
      let userPattern = await SearchPattern.findOne({ userId });
      
      if (!userPattern) {
        userPattern = new SearchPattern({
          userId,
          patterns: [],
          preferences: {
            genres: new Map(),
            actors: new Map(),
            directors: new Map(),
            keywords: new Map(),
            eras: new Map()
          }
        });
      }

      const weightAdjustment = rating === 'positive' ? 0.1 : -0.05;
      
      matchFactors.forEach(factor => {
        const [category, value] = this.parseMatchFactor(factor);
        if (category && value) {
          const preferences = userPattern.preferences[category];
          if (preferences) {
            const currentWeight = preferences.get(value) || 1.0;
            preferences.set(
              value,
              Math.max(0.1, Math.min(2.0, currentWeight + weightAdjustment))
            );
          }
        }
      });

      userPattern.lastUpdated = new Date();
      await userPattern.save();
      
    } catch (error) {
      console.error('Error updating search patterns:', error);
      throw error;
    }
  }

  parseMatchFactor(factor) {
    const categories = ['genre', 'actor', 'director', 'keyword', 'era'];
    for (const category of categories) {
      if (factor.toLowerCase().includes(category + ':')) {
        const value = factor.split(':')[1].trim();
        return [category + 's', value];
      }
    }
    return [null, null];
  }

  async getPersonalizedWeights(userId) {
    try {
      const userPattern = await SearchPattern.findOne({ userId });
      if (!userPattern) {
        return this.getDefaultWeights();
      }
      
      return {
        genres: Object.fromEntries(userPattern.preferences.genres),
        actors: Object.fromEntries(userPattern.preferences.actors),
        directors: Object.fromEntries(userPattern.preferences.directors),
        keywords: Object.fromEntries(userPattern.preferences.keywords),
        eras: Object.fromEntries(userPattern.preferences.eras)
      };
    } catch (error) {
      console.error('Error getting personalized weights:', error);
      return this.getDefaultWeights();
    }
  }

  getDefaultWeights() {
    return {
      genres: { weight: 1.0 },
      actors: { weight: 1.0 },
      directors: { weight: 1.0 },
      keywords: { weight: 1.0 },
      eras: { weight: 1.0 }
    };
  }
}

module.exports = new FeedbackService();