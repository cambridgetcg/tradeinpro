import { Router } from 'express';
import prisma from '../db.js';
import * as fs from 'fs';
import * as path from 'path';

export const modelRouter = Router();

// Get model status
modelRouter.get('/status', async (req, res) => {
  try {
    // Get latest model from history
    const latestModel = await prisma.neuralModelHistory.findFirst({
      orderBy: { trainedAt: 'desc' },
    });

    // Check if model files exist
    const modelPath = path.resolve(process.cwd(), '..', 'models', 'neural-alpha');
    const modelExists = fs.existsSync(path.join(modelPath, 'model.json'));

    // Get prediction stats
    const predictionCount = await prisma.neuralPrediction.count();
    const recentPredictions = await prisma.neuralPrediction.count({
      where: {
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
    });

    res.json({
      status: modelExists ? 'ready' : 'not_loaded',
      model: latestModel
        ? {
            version: latestModel.modelVersion,
            trainedAt: latestModel.trainedAt,
            trainingSamples: latestModel.trainingSamples,
            parameterCount: 190991, // From Alpha training
            inputShape: [30, 45],
            numDealTypes: 10,
            numRiskLevels: 3,
          }
        : null,
      files: {
        modelPath,
        exists: modelExists,
      },
      predictions: {
        total: predictionCount,
        last24h: recentPredictions,
      },
    });
  } catch (error) {
    console.error('Model status error:', error);
    res.status(500).json({ error: 'Failed to get model status' });
  }
});

// Get model architecture summary
modelRouter.get('/architecture', async (req, res) => {
  try {
    res.json({
      architecture: {
        name: 'LSTM Multi-Task Deal Classifier',
        inputShape: [30, 45],
        description: '30 timesteps × 45 features per timestep',
        layers: [
          { name: 'lstm_1', type: 'LSTM', units: 128, returnSequences: true },
          { name: 'dropout_1', type: 'Dropout', rate: 0.3 },
          { name: 'lstm_2', type: 'LSTM', units: 64, returnSequences: false },
          { name: 'dropout_2', type: 'Dropout', rate: 0.3 },
          { name: 'dense_1', type: 'Dense', units: 256, activation: 'relu' },
          { name: 'dropout_3', type: 'Dropout', rate: 0.3 },
          { name: 'dense_2', type: 'Dense', units: 128, activation: 'relu' },
        ],
        outputs: [
          { name: 'deal_type', shape: [10], activation: 'softmax' },
          { name: 'confidence', shape: [1], activation: 'sigmoid' },
          { name: 'expected_return', shape: [1], activation: 'linear' },
          { name: 'risk_level', shape: [3], activation: 'softmax' },
        ],
        totalParams: 190991,
      },
      featureCategories: {
        price: {
          count: 12,
          features: [
            'current_gbp', 'current_jpy', 'spread_optcg_limitless', 'spread_optcg_justtcg',
            'spread_min_max', 'distance_from_best', 'jp_en_gap_pct', 'fx_adjusted_gap',
            'tradein_margin', 'percentile_in_set', 'percentile_in_rarity', 'price_to_index_ratio',
          ],
        },
        temporal: {
          count: 15,
          features: [
            'velocity_1d', 'velocity_7d', 'velocity_30d', 'acceleration_7d',
            'volatility_7d', 'volatility_30d', 'volatility_ratio', 'trend_strength',
            'trend_direction', 'mean_reversion_distance', 'days_since_high', 'days_since_low',
            'streak_length', 'seasonality_index', 'momentum_rsi',
          ],
        },
        market: {
          count: 10,
          features: [
            'set_momentum', 'rarity_momentum', 'game_sentiment', 'correlation_to_set',
            'correlation_to_rarity', 'correlation_deviation', 'liquidity_score',
            'volume_relative', 'inventory_signal', 'market_cap_rank',
          ],
        },
        fx: {
          count: 5,
          features: [
            'jpy_gbp_current', 'fx_velocity_7d', 'fx_volatility_7d',
            'fx_trend_direction', 'fx_mean_reversion',
          ],
        },
        derived: {
          count: 3,
          features: ['opportunity_score', 'risk_score', 'time_sensitivity'],
        },
      },
      dealTypes: [
        'ARBITRAGE_CROSS_MARKET',
        'ARBITRAGE_CURRENCY',
        'UNDERVALUED_STATISTICAL',
        'UNDERVALUED_COMPARATIVE',
        'MOMENTUM_BREAKOUT',
        'MOMENTUM_REVERSAL',
        'SUPPLY_SHOCK',
        'DEMAND_SURGE',
        'CORRELATION_BREAK',
        'SEASONAL_OPPORTUNITY',
      ],
    });
  } catch (error) {
    console.error('Architecture error:', error);
    res.status(500).json({ error: 'Failed to get architecture' });
  }
});
