# Neural Network Deal Identification - Technical Specification

**Date:** 2026-01-07
**Version:** 1.0
**Status:** Design Specification

---

## 1. System Overview

### 1.1 Purpose

The Neural Deal Identification System (NDIS) is an AI-powered market intelligence engine that:

1. **Identifies arbitrage opportunities** across markets and currencies
2. **Detects undervalued cards** using statistical and comparative analysis
3. **Predicts price movements** with confidence intervals
4. **Visualizes market structure** through network graphs

### 1.2 Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                    NEURAL DEAL IDENTIFICATION SYSTEM (NDIS)                          │
└─────────────────────────────────────────────────────────────────────────────────────┘

  ┌──────────────────────────────────────────────────────────────────────────────────┐
  │                              DATA LAYER                                           │
  │                                                                                   │
  │   ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐      │
  │   │CardPriceV2  │    │CardPriceHist│    │PriceSource  │    │ExchangeRate │      │
  │   │ (Current)   │    │ (Temporal)  │    │(Multi-Chan) │    │ (FX)        │      │
  │   └──────┬──────┘    └──────┬──────┘    └──────┬──────┘    └──────┬──────┘      │
  │          └───────────────────┼───────────────────┼───────────────────┘           │
  │                              │                   │                               │
  └──────────────────────────────┼───────────────────┼───────────────────────────────┘
                                 │                   │
                                 ▼                   ▼
  ┌──────────────────────────────────────────────────────────────────────────────────┐
  │                           FEATURE ENGINEERING                                     │
  │                                                                                   │
  │   ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐              │
  │   │  Price Features │    │Temporal Features│    │ Market Features │              │
  │   │                 │    │                 │    │                 │              │
  │   │ • Multi-source  │    │ • Velocity      │    │ • Sentiment     │              │
  │   │   spreads       │    │ • Acceleration  │    │ • Correlation   │              │
  │   │ • JP/EN gap     │    │ • Seasonality   │    │ • Liquidity     │              │
  │   │ • FX impact     │    │ • Trend strength│    │ • Volume        │              │
  │   └────────┬────────┘    └────────┬────────┘    └────────┬────────┘              │
  │            └──────────────────────┼──────────────────────┘                       │
  │                                   │                                               │
  └───────────────────────────────────┼───────────────────────────────────────────────┘
                                      │
                                      ▼
  ┌──────────────────────────────────────────────────────────────────────────────────┐
  │                            NEURAL NETWORK                                         │
  │                                                                                   │
  │   ┌─────────────────────────────────────────────────────────────────────────┐    │
  │   │                        TCG-DealNet v1.0                                  │    │
  │   │                                                                          │    │
  │   │   Input: [batch, 30 days, 45 features]                                  │    │
  │   │                                                                          │    │
  │   │   ┌───────────────┐   ┌───────────────┐   ┌───────────────┐            │    │
  │   │   │ LSTM Encoder  │──▶│  Attention    │──▶│ Feature Fusion│            │    │
  │   │   │ (128 → 64)    │   │  (4 heads)    │   │ (256 → 128)   │            │    │
  │   │   └───────────────┘   └───────────────┘   └───────┬───────┘            │    │
  │   │                                                    │                    │    │
  │   │          ┌────────────────┬────────────────┬───────┴───────┐           │    │
  │   │          ▼                ▼                ▼               ▼           │    │
  │   │   ┌───────────┐    ┌───────────┐    ┌───────────┐   ┌───────────┐     │    │
  │   │   │Deal Type  │    │Confidence │    │ Return    │   │   Risk    │     │    │
  │   │   │(10-class) │    │ (0-1)     │    │ (%)       │   │ (3-class) │     │    │
  │   │   └───────────┘    └───────────┘    └───────────┘   └───────────┘     │    │
  │   │                                                                          │    │
  │   └─────────────────────────────────────────────────────────────────────────┘    │
  │                                                                                   │
  └───────────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
  ┌──────────────────────────────────────────────────────────────────────────────────┐
  │                           DEAL GENERATION                                         │
  │                                                                                   │
  │   ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐      │
  │   │ Arbitrage   │    │ Undervalue  │    │  Momentum   │    │   Supply    │      │
  │   │ Detector    │    │ Detector    │    │  Detector   │    │   Shock     │      │
  │   └──────┬──────┘    └──────┬──────┘    └──────┬──────┘    └──────┬──────┘      │
  │          └───────────────────┼───────────────────┼───────────────────┘           │
  │                              │                   │                               │
  │                              ▼                   │                               │
  │                    ┌─────────────────────────────┼───────┐                       │
  │                    │      DEAL AGGREGATOR        │       │                       │
  │                    │                             │       │                       │
  │                    │  • Deduplication            │       │                       │
  │                    │  • Ranking                  │       │                       │
  │                    │  • Expiry calculation       │       │                       │
  │                    └─────────────┬───────────────┘       │                       │
  │                                  │                       │                       │
  └──────────────────────────────────┼───────────────────────┼───────────────────────┘
                                     │                       │
                                     ▼                       ▼
  ┌──────────────────────────────────────────────────────────────────────────────────┐
  │                            OUTPUT LAYER                                           │
  │                                                                                   │
  │   ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐              │
  │   │  neural_deals   │    │neural_predictions│   │  API Response   │              │
  │   │  (Database)     │    │   (Database)    │    │  (JSON)         │              │
  │   └─────────────────┘    └─────────────────┘    └─────────────────┘              │
  │                                                                                   │
  └──────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Feature Engineering

### 2.1 Feature Categories

```typescript
// ============================================================================
// FEATURE DEFINITIONS
// ============================================================================

interface FeatureVector {
  // PRICE FEATURES (12 features)
  price: {
    current_gbp: number;                    // Current best price
    current_jpy: number | null;             // Current JPY price
    spread_optcg_limitless: number;         // % spread between sources
    spread_optcg_justtcg: number;
    spread_min_max: number;                 // % spread between all sources
    distance_from_best: number;             // How far from best available
    jp_en_gap_pct: number;                  // JP vs EN price gap
    fx_adjusted_gap: number;                // Gap after FX consideration
    tradein_margin: number;                 // Trade-in vs market spread
    percentile_in_set: number;              // Price rank within set
    percentile_in_rarity: number;           // Price rank within rarity
    price_to_index_ratio: number;           // Relative to TCG-100 avg
  };

  // TEMPORAL FEATURES (15 features)
  temporal: {
    velocity_1d: number;                    // 1-day price change rate
    velocity_7d: number;                    // 7-day price change rate
    velocity_30d: number;                   // 30-day price change rate
    acceleration_7d: number;                // Change in velocity
    volatility_7d: number;                  // 7-day standard deviation
    volatility_30d: number;                 // 30-day standard deviation
    volatility_ratio: number;               // 7d/30d volatility ratio
    trend_strength: number;                 // R² of linear regression
    trend_direction: number;                // Slope sign (-1, 0, 1)
    mean_reversion_distance: number;        // Distance from 30d mean
    days_since_high: number;                // Days since 30d high
    days_since_low: number;                 // Days since 30d low
    streak_length: number;                  // Consecutive up/down days
    seasonality_index: number;              // Day-of-week effect
    momentum_rsi: number;                   // Relative Strength Index
  };

  // MARKET FEATURES (10 features)
  market: {
    set_momentum: number;                   // Set-level price trend
    rarity_momentum: number;                // Rarity-level price trend
    game_sentiment: number;                 // Overall game sentiment
    correlation_to_set: number;             // Price correlation to set
    correlation_to_rarity: number;          // Price correlation to rarity
    correlation_deviation: number;          // Deviation from expected corr
    liquidity_score: number;                // Trading activity estimate
    volume_relative: number;                // Volume vs average
    inventory_signal: number;               // Stock level indicator
    market_cap_rank: number;                // Rank by market cap
  };

  // FX FEATURES (5 features)
  fx: {
    jpy_gbp_current: number;                // Current exchange rate
    fx_velocity_7d: number;                 // FX change rate
    fx_volatility_7d: number;               // FX volatility
    fx_trend_direction: number;             // FX trend (-1, 0, 1)
    fx_mean_reversion: number;              // Distance from 30d mean
  };

  // DERIVED FEATURES (3 features)
  derived: {
    opportunity_score: number;              // Composite score 0-1
    risk_score: number;                     // Composite risk 0-1
    time_sensitivity: number;               // How quickly to act
  };
}

// Total: 45 features
```

### 2.2 Feature Calculation Pipeline

```typescript
// ============================================================================
// FEATURE CALCULATION
// ============================================================================

import { Decimal } from "@prisma/client/runtime/library";

export class FeatureCalculator {
  private cardPriceV2: CardPriceV2;
  private history: CardPriceHistory[];
  private priceSources: PriceSource[];
  private fxHistory: ExchangeRateHistory[];
  private setStats: SetStatistics;
  private gameStats: GameStatistics;

  constructor(
    card: CardPriceV2,
    history: CardPriceHistory[],
    sources: PriceSource[],
    fx: ExchangeRateHistory[],
    setStats: SetStatistics,
    gameStats: GameStatistics
  ) {
    this.cardPriceV2 = card;
    this.history = history;
    this.priceSources = sources;
    this.fxHistory = fx;
    this.setStats = setStats;
    this.gameStats = gameStats;
  }

  calculate(): FeatureVector {
    return {
      price: this.calculatePriceFeatures(),
      temporal: this.calculateTemporalFeatures(),
      market: this.calculateMarketFeatures(),
      fx: this.calculateFxFeatures(),
      derived: this.calculateDerivedFeatures(),
    };
  }

  private calculatePriceFeatures(): FeatureVector['price'] {
    const card = this.cardPriceV2;

    // Multi-source spreads
    const prices = [
      card.optcgTcgplayerGbp?.toNumber(),
      card.limitlessCardmarketGbp?.toNumber(),
      card.justtcgTcgplayerGbp?.toNumber(),
    ].filter((p): p is number => p !== null && p !== undefined && p > 0);

    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const bestPrice = card.bestPriceGbp?.toNumber() ?? 0;

    return {
      current_gbp: bestPrice,
      current_jpy: this.getJpyPrice(),
      spread_optcg_limitless: this.calculateSpread(
        card.optcgTcgplayerGbp?.toNumber(),
        card.limitlessCardmarketGbp?.toNumber()
      ),
      spread_optcg_justtcg: this.calculateSpread(
        card.optcgTcgplayerGbp?.toNumber(),
        card.justtcgTcgplayerGbp?.toNumber()
      ),
      spread_min_max: prices.length >= 2 ? (maxPrice - minPrice) / minPrice : 0,
      distance_from_best: bestPrice > 0 ? (maxPrice - bestPrice) / bestPrice : 0,
      jp_en_gap_pct: this.calculateJpEnGap(),
      fx_adjusted_gap: this.calculateFxAdjustedGap(),
      tradein_margin: this.calculateTradeinMargin(),
      percentile_in_set: this.setStats.pricePercentile(bestPrice),
      percentile_in_rarity: this.calculateRarityPercentile(bestPrice),
      price_to_index_ratio: bestPrice / (this.gameStats.tcg100AvgPrice || 1),
    };
  }

  private calculateTemporalFeatures(): FeatureVector['temporal'] {
    const prices = this.history.map(h => h.priceGbp.toNumber());
    const changes = this.history.map(h => h.change.toNumber());

    if (prices.length < 7) {
      return this.getDefaultTemporalFeatures();
    }

    // Velocity calculations
    const velocity1d = changes.length > 0 ? changes[changes.length - 1] : 0;
    const velocity7d = this.calculateVelocity(prices, 7);
    const velocity30d = this.calculateVelocity(prices, 30);

    // Acceleration (change in velocity)
    const prevVelocity7d = this.calculateVelocity(prices.slice(0, -7), 7);
    const acceleration7d = velocity7d - prevVelocity7d;

    // Volatility
    const volatility7d = this.calculateVolatility(prices.slice(-7));
    const volatility30d = this.calculateVolatility(prices.slice(-30));

    // Trend analysis
    const { strength, direction } = this.calculateTrend(prices.slice(-14));

    // Mean reversion
    const mean30d = this.calculateMean(prices.slice(-30));
    const currentPrice = prices[prices.length - 1];
    const meanReversionDistance = (currentPrice - mean30d) / mean30d;

    // High/Low tracking
    const high30d = Math.max(...prices.slice(-30));
    const low30d = Math.min(...prices.slice(-30));
    const daysSinceHigh = this.findDaysSince(prices.slice(-30), high30d);
    const daysSinceLow = this.findDaysSince(prices.slice(-30), low30d);

    return {
      velocity_1d: velocity1d,
      velocity_7d: velocity7d,
      velocity_30d: velocity30d,
      acceleration_7d: acceleration7d,
      volatility_7d: volatility7d,
      volatility_30d: volatility30d,
      volatility_ratio: volatility30d > 0 ? volatility7d / volatility30d : 1,
      trend_strength: strength,
      trend_direction: direction,
      mean_reversion_distance: meanReversionDistance,
      days_since_high: daysSinceHigh,
      days_since_low: daysSinceLow,
      streak_length: this.calculateStreak(changes),
      seasonality_index: this.calculateSeasonality(),
      momentum_rsi: this.calculateRSI(prices, 14),
    };
  }

  private calculateMarketFeatures(): FeatureVector['market'] {
    return {
      set_momentum: this.setStats.momentum7d,
      rarity_momentum: this.calculateRarityMomentum(),
      game_sentiment: this.gameStats.sentiment,
      correlation_to_set: this.calculateCorrelationToSet(),
      correlation_to_rarity: this.calculateCorrelationToRarity(),
      correlation_deviation: this.calculateCorrelationDeviation(),
      liquidity_score: this.estimateLiquidity(),
      volume_relative: this.calculateRelativeVolume(),
      inventory_signal: this.getInventorySignal(),
      market_cap_rank: this.gameStats.getMarketCapRank(this.cardPriceV2.cardId),
    };
  }

  private calculateFxFeatures(): FeatureVector['fx'] {
    const rates = this.fxHistory.map(f => f.jpyToGbp.toNumber());
    const currentRate = rates[rates.length - 1] || 0.00472;

    return {
      jpy_gbp_current: currentRate,
      fx_velocity_7d: this.calculateVelocity(rates, 7),
      fx_volatility_7d: this.calculateVolatility(rates.slice(-7)),
      fx_trend_direction: Math.sign(this.calculateVelocity(rates, 7)),
      fx_mean_reversion: this.calculateMeanReversion(rates, 30),
    };
  }

  private calculateDerivedFeatures(): FeatureVector['derived'] {
    // These are calculated after other features
    // Will be populated by the model pre-processor
    return {
      opportunity_score: 0,
      risk_score: 0,
      time_sensitivity: 0,
    };
  }

  // Helper methods
  private calculateSpread(a?: number, b?: number): number {
    if (!a || !b || a === 0) return 0;
    return Math.abs(a - b) / Math.min(a, b);
  }

  private calculateVelocity(prices: number[], days: number): number {
    const slice = prices.slice(-days);
    if (slice.length < 2) return 0;
    const first = slice[0];
    const last = slice[slice.length - 1];
    return first > 0 ? (last - first) / first / days : 0;
  }

  private calculateVolatility(prices: number[]): number {
    if (prices.length < 2) return 0;
    const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
    const squaredDiffs = prices.map(p => Math.pow(p - mean, 2));
    return Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / prices.length);
  }

  private calculateMean(prices: number[]): number {
    return prices.length > 0
      ? prices.reduce((a, b) => a + b, 0) / prices.length
      : 0;
  }

  private calculateTrend(prices: number[]): { strength: number; direction: number } {
    if (prices.length < 3) return { strength: 0, direction: 0 };

    // Linear regression
    const n = prices.length;
    const xs = Array.from({ length: n }, (_, i) => i);
    const xMean = (n - 1) / 2;
    const yMean = this.calculateMean(prices);

    let numerator = 0;
    let denominator = 0;
    for (let i = 0; i < n; i++) {
      numerator += (xs[i] - xMean) * (prices[i] - yMean);
      denominator += Math.pow(xs[i] - xMean, 2);
    }

    const slope = denominator !== 0 ? numerator / denominator : 0;

    // R² calculation
    const predicted = xs.map(x => yMean + slope * (x - xMean));
    const ssRes = prices.reduce((sum, y, i) => sum + Math.pow(y - predicted[i], 2), 0);
    const ssTot = prices.reduce((sum, y) => sum + Math.pow(y - yMean, 2), 0);
    const r2 = ssTot > 0 ? 1 - (ssRes / ssTot) : 0;

    return {
      strength: r2,
      direction: Math.sign(slope),
    };
  }

  private calculateRSI(prices: number[], period: number): number {
    if (prices.length < period + 1) return 50;

    const changes = prices.slice(-period - 1).map((p, i, arr) =>
      i === 0 ? 0 : p - arr[i - 1]
    ).slice(1);

    const gains = changes.filter(c => c > 0);
    const losses = changes.filter(c => c < 0).map(Math.abs);

    const avgGain = gains.length > 0 ? gains.reduce((a, b) => a + b, 0) / period : 0;
    const avgLoss = losses.length > 0 ? losses.reduce((a, b) => a + b, 0) / period : 0;

    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
  }

  // ... additional helper methods
}
```

### 2.3 Feature Normalization

```typescript
// ============================================================================
// FEATURE NORMALIZATION
// ============================================================================

export class FeatureNormalizer {
  private statistics: FeatureStatistics;

  constructor(trainingData: FeatureVector[]) {
    this.statistics = this.calculateStatistics(trainingData);
  }

  normalize(features: FeatureVector): NormalizedFeatures {
    const normalized: NormalizedFeatures = {
      price: {},
      temporal: {},
      market: {},
      fx: {},
      derived: {},
    };

    // Z-score normalization for most features
    for (const category of ['price', 'temporal', 'market', 'fx'] as const) {
      for (const [key, value] of Object.entries(features[category])) {
        const stats = this.statistics[category][key];
        if (stats && stats.std > 0) {
          normalized[category][key] = (value - stats.mean) / stats.std;
        } else {
          normalized[category][key] = 0;
        }
      }
    }

    // Min-max for bounded features
    const boundedFeatures = [
      'liquidity_score',
      'percentile_in_set',
      'percentile_in_rarity',
      'momentum_rsi',
    ];

    for (const key of boundedFeatures) {
      const value = this.findFeatureValue(features, key);
      normalized[this.findCategory(key)][key] = Math.max(0, Math.min(1, value));
    }

    return normalized;
  }

  private calculateStatistics(data: FeatureVector[]): FeatureStatistics {
    const stats: FeatureStatistics = {
      price: {},
      temporal: {},
      market: {},
      fx: {},
      derived: {},
    };

    for (const category of ['price', 'temporal', 'market', 'fx'] as const) {
      const keys = Object.keys(data[0][category]);
      for (const key of keys) {
        const values = data.map(d => d[category][key]).filter(v => v !== null);
        stats[category][key] = {
          mean: this.mean(values),
          std: this.std(values),
          min: Math.min(...values),
          max: Math.max(...values),
        };
      }
    }

    return stats;
  }

  private mean(values: number[]): number {
    return values.reduce((a, b) => a + b, 0) / values.length;
  }

  private std(values: number[]): number {
    const m = this.mean(values);
    return Math.sqrt(values.reduce((sum, v) => sum + Math.pow(v - m, 2), 0) / values.length);
  }
}
```

---

## 3. Model Architecture

### 3.1 TensorFlow.js Implementation

```typescript
// ============================================================================
// MODEL DEFINITION
// ============================================================================

import * as tf from '@tensorflow/tfjs-node';

export class TCGDealNet {
  private model: tf.LayersModel;
  private normalizer: FeatureNormalizer;

  async build(): Promise<void> {
    // Input layer: [batch, timesteps, features]
    const input = tf.input({ shape: [30, 45] });

    // LSTM Encoder
    let x = tf.layers.lstm({
      units: 128,
      returnSequences: true,
      dropout: 0.2,
      recurrentDropout: 0.2,
    }).apply(input) as tf.SymbolicTensor;

    x = tf.layers.lstm({
      units: 64,
      returnSequences: false,
      dropout: 0.2,
    }).apply(x) as tf.SymbolicTensor;

    // Attention mechanism (simplified self-attention)
    const attention = tf.layers.dense({ units: 64, activation: 'tanh' }).apply(x);
    const attentionWeights = tf.layers.dense({ units: 1, activation: 'softmax' }).apply(attention);
    x = tf.layers.multiply().apply([x, attentionWeights as tf.SymbolicTensor]) as tf.SymbolicTensor;

    // Feature fusion
    x = tf.layers.dense({ units: 256, activation: 'relu' }).apply(x) as tf.SymbolicTensor;
    x = tf.layers.batchNormalization().apply(x) as tf.SymbolicTensor;
    x = tf.layers.dropout({ rate: 0.3 }).apply(x) as tf.SymbolicTensor;
    x = tf.layers.dense({ units: 128, activation: 'relu' }).apply(x) as tf.SymbolicTensor;

    // Multi-task outputs
    const dealTypeOutput = tf.layers.dense({
      units: 10,
      activation: 'softmax',
      name: 'deal_type',
    }).apply(x) as tf.SymbolicTensor;

    const confidenceOutput = tf.layers.dense({
      units: 1,
      activation: 'sigmoid',
      name: 'confidence',
    }).apply(x) as tf.SymbolicTensor;

    const returnOutput = tf.layers.dense({
      units: 1,
      activation: 'linear',
      name: 'expected_return',
    }).apply(x) as tf.SymbolicTensor;

    const riskOutput = tf.layers.dense({
      units: 3,
      activation: 'softmax',
      name: 'risk_level',
    }).apply(x) as tf.SymbolicTensor;

    // Create model
    this.model = tf.model({
      inputs: input,
      outputs: [dealTypeOutput, confidenceOutput, returnOutput, riskOutput],
    });

    // Compile with multi-task loss
    this.model.compile({
      optimizer: tf.train.adam(0.001),
      loss: {
        deal_type: 'categoricalCrossentropy',
        confidence: 'binaryCrossentropy',
        expected_return: 'meanSquaredError',
        risk_level: 'categoricalCrossentropy',
      },
      lossWeights: {
        deal_type: 1.0,
        confidence: 0.5,
        expected_return: 0.3,
        risk_level: 0.5,
      },
      metrics: ['accuracy'],
    });
  }

  async train(
    trainData: { x: tf.Tensor3D; y: TrainingLabels },
    validationData: { x: tf.Tensor3D; y: TrainingLabels },
    options: TrainingOptions = {}
  ): Promise<tf.History> {
    const {
      epochs = 100,
      batchSize = 32,
      patience = 10,
    } = options;

    const callbacks: tf.Callback[] = [
      tf.callbacks.earlyStopping({
        monitor: 'val_loss',
        patience,
        restoreBestWeights: true,
      }),
    ];

    return this.model.fit(trainData.x, trainData.y, {
      epochs,
      batchSize,
      validationData: [validationData.x, validationData.y],
      callbacks,
      shuffle: true,
    });
  }

  async predict(features: NormalizedFeatures[]): Promise<DealPrediction[]> {
    // Convert to tensor
    const inputTensor = this.featuresToTensor(features);

    // Run inference
    const [dealType, confidence, expectedReturn, riskLevel] = this.model.predict(inputTensor) as tf.Tensor[];

    // Convert outputs
    const dealTypeProbs = await dealType.array() as number[][];
    const confidenceValues = await confidence.array() as number[][];
    const returnValues = await expectedReturn.array() as number[][];
    const riskProbs = await riskLevel.array() as number[][];

    // Cleanup
    inputTensor.dispose();
    dealType.dispose();
    confidence.dispose();
    expectedReturn.dispose();
    riskLevel.dispose();

    // Map to predictions
    return features.map((_, i) => ({
      dealType: this.argmaxDealType(dealTypeProbs[i]),
      dealTypeProbabilities: dealTypeProbs[i],
      confidence: confidenceValues[i][0],
      expectedReturn: returnValues[i][0],
      riskLevel: this.argmaxRisk(riskProbs[i]),
      riskProbabilities: riskProbs[i],
    }));
  }

  private featuresToTensor(features: NormalizedFeatures[]): tf.Tensor3D {
    // Reshape features into [batch, 30, 45] tensor
    // Each sample has 30 days of 45 features
    const data = features.map(f => this.flattenFeatures(f));
    return tf.tensor3d(data);
  }

  private flattenFeatures(f: NormalizedFeatures): number[][] {
    // Create 30-day sequence with current features
    // In production, this would use actual historical feature vectors
    const currentFeatures = [
      ...Object.values(f.price),
      ...Object.values(f.temporal),
      ...Object.values(f.market),
      ...Object.values(f.fx),
      ...Object.values(f.derived),
    ];

    // Pad to 30 days (in production, use real historical data)
    return Array(30).fill(currentFeatures);
  }

  private argmaxDealType(probs: number[]): DealType {
    const dealTypes: DealType[] = [
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
    ];
    const maxIdx = probs.indexOf(Math.max(...probs));
    return dealTypes[maxIdx];
  }

  private argmaxRisk(probs: number[]): RiskLevel {
    const risks: RiskLevel[] = ['LOW', 'MEDIUM', 'HIGH'];
    const maxIdx = probs.indexOf(Math.max(...probs));
    return risks[maxIdx];
  }

  async save(path: string): Promise<void> {
    await this.model.save(`file://${path}`);
  }

  async load(path: string): Promise<void> {
    this.model = await tf.loadLayersModel(`file://${path}/model.json`);
  }
}

interface DealPrediction {
  dealType: DealType;
  dealTypeProbabilities: number[];
  confidence: number;
  expectedReturn: number;
  riskLevel: RiskLevel;
  riskProbabilities: number[];
}
```

---

## 4. Deal Detection Pipeline

### 4.1 Pipeline Orchestration

```typescript
// ============================================================================
// DEAL DETECTION PIPELINE
// ============================================================================

export class DealDetectionPipeline {
  private model: TCGDealNet;
  private featureCalculator: FeatureCalculator;
  private normalizer: FeatureNormalizer;
  private ruleBasedDetectors: RuleBasedDetector[];

  async run(game: GameShard = 'onepiece'): Promise<DetectedDeal[]> {
    console.log(`[DealPipeline] Starting detection for ${game}`);
    const startTime = Date.now();

    // Step 1: Load all cards with required data
    const cards = await this.loadCardsWithData(game);
    console.log(`[DealPipeline] Loaded ${cards.length} cards`);

    // Step 2: Calculate features for each card
    const features = await Promise.all(
      cards.map(card => this.calculateFeatures(card))
    );

    // Step 3: Normalize features
    const normalized = features.map(f => this.normalizer.normalize(f));

    // Step 4: Run neural network predictions
    const predictions = await this.model.predict(normalized);

    // Step 5: Run rule-based detectors
    const ruleBasedDeals = await this.runRuleBasedDetectors(cards, features);

    // Step 6: Merge and deduplicate deals
    const allDeals = this.mergeDeals(
      this.predictionsToDeals(cards, predictions, features),
      ruleBasedDeals
    );

    // Step 7: Rank and filter
    const rankedDeals = this.rankDeals(allDeals);
    const filteredDeals = this.filterDeals(rankedDeals);

    // Step 8: Persist to database
    await this.persistDeals(filteredDeals);

    const duration = Date.now() - startTime;
    console.log(`[DealPipeline] Completed in ${duration}ms, found ${filteredDeals.length} deals`);

    return filteredDeals;
  }

  private async loadCardsWithData(game: GameShard): Promise<CardWithData[]> {
    const client = getShardClient(game);

    const cards = await client.cardPriceV2.findMany({
      where: {
        game,
        bestPriceGbp: { gt: 0 },
      },
    });

    // Load related data in parallel
    const cardIds = cards.map(c => c.cardId);

    const [histories, sources, fx] = await Promise.all([
      client.cardPriceHistory.findMany({
        where: {
          cardId: { in: cardIds },
          snapshotDate: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
        },
        orderBy: { snapshotDate: 'asc' },
      }),
      client.priceSource.findMany({
        where: { cardId: { in: cardIds } },
      }),
      client.exchangeRateHistory.findMany({
        where: {
          date: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
        },
        orderBy: { date: 'asc' },
      }),
    ]);

    // Group by card
    const historyByCard = this.groupBy(histories, 'cardId');
    const sourcesByCard = this.groupBy(sources, 'cardId');

    return cards.map(card => ({
      card,
      history: historyByCard[card.cardId] || [],
      sources: sourcesByCard[card.cardId] || [],
      fx,
    }));
  }

  private predictionsToDeals(
    cards: CardWithData[],
    predictions: DealPrediction[],
    features: FeatureVector[]
  ): DetectedDeal[] {
    const deals: DetectedDeal[] = [];

    for (let i = 0; i < cards.length; i++) {
      const prediction = predictions[i];
      const card = cards[i];
      const feature = features[i];

      // Only create deal if confidence threshold met
      if (prediction.confidence < 0.5) continue;

      // Skip if no meaningful return expected
      if (Math.abs(prediction.expectedReturn) < 5) continue;

      deals.push({
        cardId: card.card.cardId,
        cardName: card.card.name,
        dealType: prediction.dealType,
        confidence: prediction.confidence,
        expectedReturn: prediction.expectedReturn,
        riskLevel: prediction.riskLevel,
        timeHorizon: this.inferTimeHorizon(prediction.dealType),
        action: this.inferAction(prediction, feature),
        metadata: {
          featureImportance: this.calculateFeatureImportance(feature, prediction),
          dealTypeProbabilities: prediction.dealTypeProbabilities,
        },
        source: 'neural',
        expiresAt: this.calculateExpiry(prediction.dealType),
      });
    }

    return deals;
  }

  private async runRuleBasedDetectors(
    cards: CardWithData[],
    features: FeatureVector[]
  ): Promise<DetectedDeal[]> {
    const deals: DetectedDeal[] = [];

    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      const feature = features[i];

      for (const detector of this.ruleBasedDetectors) {
        const deal = await detector.detect(card, feature);
        if (deal) {
          deals.push({ ...deal, source: 'rule' });
        }
      }
    }

    return deals;
  }

  private mergeDeals(neuralDeals: DetectedDeal[], ruleDeals: DetectedDeal[]): DetectedDeal[] {
    const merged: Map<string, DetectedDeal> = new Map();

    // Add neural deals first (higher priority)
    for (const deal of neuralDeals) {
      const key = `${deal.cardId}:${deal.dealType}`;
      merged.set(key, deal);
    }

    // Add rule-based deals if not already present
    for (const deal of ruleDeals) {
      const key = `${deal.cardId}:${deal.dealType}`;
      if (!merged.has(key)) {
        merged.set(key, deal);
      } else {
        // Boost confidence if both sources agree
        const existing = merged.get(key)!;
        existing.confidence = Math.min(0.99, existing.confidence * 1.2);
        existing.metadata.sources = ['neural', 'rule'];
      }
    }

    return Array.from(merged.values());
  }

  private rankDeals(deals: DetectedDeal[]): DetectedDeal[] {
    return deals.sort((a, b) => {
      // Primary: Expected return weighted by confidence
      const scoreA = a.expectedReturn * a.confidence;
      const scoreB = b.expectedReturn * b.confidence;
      return scoreB - scoreA;
    });
  }

  private filterDeals(deals: DetectedDeal[]): DetectedDeal[] {
    return deals.filter(deal => {
      // Minimum confidence
      if (deal.confidence < 0.5) return false;

      // Minimum expected return
      if (deal.expectedReturn < 5) return false;

      // Not expired
      if (deal.expiresAt < new Date()) return false;

      return true;
    });
  }

  private async persistDeals(deals: DetectedDeal[]): Promise<void> {
    const client = getShardClient('onepiece');

    // Expire old deals
    await client.$executeRaw`
      UPDATE neural_deals
      SET status = 'EXPIRED'
      WHERE status = 'ACTIVE' AND expires_at < NOW()
    `;

    // Insert new deals
    for (const deal of deals) {
      await client.neuralDeal.upsert({
        where: {
          cardId_dealType_status: {
            cardId: deal.cardId,
            dealType: deal.dealType,
            status: 'ACTIVE',
          },
        },
        create: {
          cardId: deal.cardId,
          game: 'onepiece',
          dealType: deal.dealType,
          confidence: deal.confidence,
          expectedReturn: deal.expectedReturn,
          timeHorizon: deal.timeHorizon,
          riskLevel: deal.riskLevel,
          actionType: deal.action.type,
          buyMarket: deal.action.buyMarket,
          buyPrice: deal.action.buyPrice,
          sellMarket: deal.action.sellMarket,
          sellPrice: deal.action.sellPrice,
          metadata: deal.metadata,
          expiresAt: deal.expiresAt,
        },
        update: {
          confidence: deal.confidence,
          expectedReturn: deal.expectedReturn,
          expiresAt: deal.expiresAt,
          metadata: deal.metadata,
        },
      });
    }
  }

  private calculateExpiry(dealType: DealType): Date {
    const now = new Date();
    const expiryHours: Record<DealType, number> = {
      ARBITRAGE_CROSS_MARKET: 4,      // Very time-sensitive
      ARBITRAGE_CURRENCY: 24,         // FX can change
      UNDERVALUED_STATISTICAL: 168,   // 1 week
      UNDERVALUED_COMPARATIVE: 168,
      MOMENTUM_BREAKOUT: 48,          // 2 days
      MOMENTUM_REVERSAL: 72,          // 3 days
      SUPPLY_SHOCK: 24,               // Inventory can refill
      DEMAND_SURGE: 48,
      CORRELATION_BREAK: 168,
      SEASONAL_OPPORTUNITY: 336,      // 2 weeks
    };

    return new Date(now.getTime() + (expiryHours[dealType] || 24) * 60 * 60 * 1000);
  }
}
```

### 4.2 Rule-Based Detectors

```typescript
// ============================================================================
// RULE-BASED DETECTORS
// ============================================================================

export interface RuleBasedDetector {
  name: string;
  detect(card: CardWithData, features: FeatureVector): Promise<DetectedDeal | null>;
}

export class CrossMarketArbitrageDetector implements RuleBasedDetector {
  name = 'CrossMarketArbitrage';

  async detect(card: CardWithData, features: FeatureVector): Promise<DetectedDeal | null> {
    const { price } = features;

    // Need significant spread
    if (price.spread_min_max < 0.15) return null;

    // Calculate net profit after fees
    const buyFee = 0.10;  // 10% buyer fee
    const sellFee = 0.13; // 13% seller fee
    const netSpread = price.spread_min_max - buyFee - sellFee;

    if (netSpread < 0.05) return null;  // Minimum 5% net profit

    // Determine buy/sell markets
    const prices = {
      optcg: card.card.optcgTcgplayerGbp?.toNumber() || Infinity,
      limitless: card.card.limitlessCardmarketGbp?.toNumber() || Infinity,
      justtcg: card.card.justtcgTcgplayerGbp?.toNumber() || Infinity,
    };

    const minEntry = Object.entries(prices).reduce((a, b) => a[1] < b[1] ? a : b);
    const maxEntry = Object.entries(prices).reduce((a, b) => a[1] > b[1] ? a : b);

    return {
      cardId: card.card.cardId,
      cardName: card.card.name,
      dealType: 'ARBITRAGE_CROSS_MARKET',
      confidence: Math.min(0.95, 0.5 + netSpread),
      expectedReturn: netSpread * 100,
      riskLevel: netSpread > 0.15 ? 'LOW' : 'MEDIUM',
      timeHorizon: 'IMMEDIATE',
      action: {
        type: 'BUY_SELL',
        buyMarket: this.mapMarket(minEntry[0]),
        buyPrice: minEntry[1],
        sellMarket: this.mapMarket(maxEntry[0]),
        sellPrice: maxEntry[1],
      },
      metadata: {
        spread: price.spread_min_max,
        netSpread,
        pricesByMarket: prices,
      },
      expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000), // 4 hours
    };
  }

  private mapMarket(key: string): string {
    const markets: Record<string, string> = {
      optcg: 'TCGplayer',
      limitless: 'CardMarket',
      justtcg: 'JustTCG',
    };
    return markets[key] || key;
  }
}

export class StatisticalUndervalueDetector implements RuleBasedDetector {
  name = 'StatisticalUndervalue';

  async detect(card: CardWithData, features: FeatureVector): Promise<DetectedDeal | null> {
    const { temporal, price } = features;

    // Need price significantly below mean
    if (temporal.mean_reversion_distance > -0.15) return null;  // At least 15% below mean

    // Check trend isn't strongly negative (avoid falling knives)
    if (temporal.velocity_7d < -0.05 && temporal.acceleration_7d < 0) return null;

    // RSI should indicate oversold
    if (temporal.momentum_rsi > 40) return null;

    const expectedReturn = Math.abs(temporal.mean_reversion_distance) * 100;
    const confidence = Math.min(0.85, 0.4 + Math.abs(temporal.mean_reversion_distance));

    return {
      cardId: card.card.cardId,
      cardName: card.card.name,
      dealType: 'UNDERVALUED_STATISTICAL',
      confidence,
      expectedReturn,
      riskLevel: temporal.volatility_7d > 0.1 ? 'HIGH' : 'MEDIUM',
      timeHorizon: 'MEDIUM',
      action: {
        type: 'BUY',
        buyMarket: 'Best Available',
        buyPrice: price.current_gbp,
        targetPrice: price.current_gbp * (1 + expectedReturn / 100),
      },
      metadata: {
        meanReversionDistance: temporal.mean_reversion_distance,
        rsi: temporal.momentum_rsi,
        volatility: temporal.volatility_7d,
      },
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 1 week
    };
  }
}

export class MomentumBreakoutDetector implements RuleBasedDetector {
  name = 'MomentumBreakout';

  async detect(card: CardWithData, features: FeatureVector): Promise<DetectedDeal | null> {
    const { temporal, market } = features;

    // Strong positive velocity
    if (temporal.velocity_7d < 0.02) return null;  // At least 2% per day

    // Positive acceleration
    if (temporal.acceleration_7d <= 0) return null;

    // Strong trend
    if (temporal.trend_strength < 0.7) return null;

    // Volume confirmation
    if (market.volume_relative < 1.2) return null;  // 20% above average

    const projectedReturn = temporal.velocity_7d * 7 * 100;  // 7-day projection
    const confidence = Math.min(0.80, temporal.trend_strength * temporal.velocity_7d * 20);

    return {
      cardId: card.card.cardId,
      cardName: card.card.name,
      dealType: 'MOMENTUM_BREAKOUT',
      confidence,
      expectedReturn: projectedReturn,
      riskLevel: 'HIGH',  // Momentum can reverse quickly
      timeHorizon: 'SHORT',
      action: {
        type: 'BUY',
        buyMarket: 'Best Available',
        buyPrice: features.price.current_gbp,
        targetPrice: features.price.current_gbp * (1 + projectedReturn / 100),
      },
      metadata: {
        velocity: temporal.velocity_7d,
        acceleration: temporal.acceleration_7d,
        trendStrength: temporal.trend_strength,
        volumeRelative: market.volume_relative,
      },
      expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000), // 2 days
    };
  }
}
```

---

## 5. API Endpoints

### 5.1 Neural Endpoints

```typescript
// ============================================================================
// NEURAL API ROUTES
// ============================================================================

// app/routes/api.v1.neural.deals.tsx
export async function loader({ request }: LoaderFunctionArgs) {
  const auth = await authenticateRequest(request);

  if (!auth.permissions.neuralAccess) {
    return json({ error: 'Neural access requires Tier 4 subscription' }, { status: 403 });
  }

  const url = new URL(request.url);
  const game = url.searchParams.get('game') || 'onepiece';
  const dealType = url.searchParams.get('type');
  const minConfidence = parseFloat(url.searchParams.get('minConfidence') || '0.5');
  const limit = parseInt(url.searchParams.get('limit') || '50');

  const { shardRouter } = await import('../lib/shard.server');
  const client = shardRouter.getClient(game as GameShard);

  const where: Prisma.NeuralDealWhereInput = {
    game,
    status: 'ACTIVE',
    confidence: { gte: minConfidence },
    expiresAt: { gt: new Date() },
  };

  if (dealType) {
    where.dealType = dealType;
  }

  const deals = await client.neuralDeal.findMany({
    where,
    orderBy: [
      { confidence: 'desc' },
      { expectedReturn: 'desc' },
    ],
    take: limit,
  });

  // Group by type for summary
  const byType = deals.reduce((acc, deal) => {
    acc[deal.dealType] = (acc[deal.dealType] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return json({
    deals: deals.map(formatDeal),
    summary: {
      totalDeals: deals.length,
      byType,
      avgConfidence: deals.reduce((sum, d) => sum + d.confidence.toNumber(), 0) / deals.length,
      avgExpectedReturn: deals.reduce((sum, d) => sum + d.expectedReturn.toNumber(), 0) / deals.length,
    },
    generatedAt: new Date().toISOString(),
  });
}


// app/routes/api.v1.neural.predictions.$cardId.tsx
export async function loader({ request, params }: LoaderFunctionArgs) {
  const auth = await authenticateRequest(request);

  if (!auth.permissions.neuralAccess) {
    return json({ error: 'Neural access requires Tier 4 subscription' }, { status: 403 });
  }

  const { cardId } = params;
  const url = new URL(request.url);
  const game = url.searchParams.get('game') || 'onepiece';

  const client = getShardClient(game as GameShard);

  // Get latest prediction
  const prediction = await client.neuralPrediction.findFirst({
    where: {
      cardId,
      expiresAt: { gt: new Date() },
    },
    orderBy: { predictedAt: 'desc' },
  });

  if (!prediction) {
    // Generate on-demand prediction
    const pipeline = new DealDetectionPipeline();
    const freshPrediction = await pipeline.predictSingle(cardId, game);
    return json({ prediction: freshPrediction, source: 'realtime' });
  }

  return json({
    prediction: {
      cardId: prediction.cardId,
      price24h: prediction.price24h?.toNumber(),
      price7d: prediction.price7d?.toNumber(),
      price30d: prediction.price30d?.toNumber(),
      confidence24h: prediction.confidence24h?.toNumber(),
      confidence7d: prediction.confidence7d?.toNumber(),
      confidence30d: prediction.confidence30d?.toNumber(),
      modelVersion: prediction.modelVersion,
      predictedAt: prediction.predictedAt,
    },
    source: 'cached',
  });
}
```

---

## 6. Deployment & Operations

### 6.1 Training Pipeline

```yaml
# .github/workflows/train-model.yml
name: Train Neural Model

on:
  schedule:
    - cron: '0 3 * * 0'  # Weekly on Sunday at 3 AM
  workflow_dispatch:

jobs:
  train:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install dependencies
        run: npm ci

      - name: Download training data
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
        run: npm run neural:export-training-data

      - name: Train model
        run: npm run neural:train
        env:
          EPOCHS: 100
          BATCH_SIZE: 32

      - name: Evaluate model
        run: npm run neural:evaluate

      - name: Upload model to S3
        if: success()
        env:
          AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
        run: npm run neural:upload-model

      - name: Deploy model
        if: success()
        env:
          VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}
        run: npm run neural:deploy
```

### 6.2 Monitoring

```typescript
// ============================================================================
// MODEL MONITORING
// ============================================================================

export class ModelMonitor {
  async trackPrediction(
    cardId: string,
    prediction: DealPrediction,
    actualOutcome?: DealOutcome
  ): Promise<void> {
    const client = getShardClient('onepiece');

    await client.neuralModelMetrics.create({
      data: {
        cardId,
        modelVersion: prediction.modelVersion,
        predictedDealType: prediction.dealType,
        predictedConfidence: prediction.confidence,
        predictedReturn: prediction.expectedReturn,
        actualDealType: actualOutcome?.dealType,
        actualReturn: actualOutcome?.actualReturn,
        isCorrect: actualOutcome?.isCorrect,
        timestamp: new Date(),
      },
    });
  }

  async getDailyMetrics(date: Date): Promise<ModelMetrics> {
    const client = getShardClient('onepiece');

    const metrics = await client.neuralModelMetrics.aggregate({
      where: {
        timestamp: {
          gte: new Date(date.setHours(0, 0, 0, 0)),
          lt: new Date(date.setHours(23, 59, 59, 999)),
        },
        isCorrect: { not: null },
      },
      _count: true,
      _avg: {
        predictedConfidence: true,
        predictedReturn: true,
        actualReturn: true,
      },
    });

    const correctCount = await client.neuralModelMetrics.count({
      where: {
        timestamp: {
          gte: new Date(date.setHours(0, 0, 0, 0)),
          lt: new Date(date.setHours(23, 59, 59, 999)),
        },
        isCorrect: true,
      },
    });

    return {
      date,
      totalPredictions: metrics._count,
      accuracy: correctCount / metrics._count,
      avgConfidence: metrics._avg.predictedConfidence || 0,
      avgPredictedReturn: metrics._avg.predictedReturn || 0,
      avgActualReturn: metrics._avg.actualReturn || 0,
    };
  }
}
```

---

## 7. Summary

The Neural Deal Identification System provides:

1. **45-feature engineering pipeline** capturing price, temporal, market, and FX signals
2. **Multi-task neural network** predicting deal type, confidence, return, and risk
3. **10 deal type classifications** from arbitrage to momentum plays
4. **Rule-based detector ensemble** for high-confidence pattern matching
5. **Real-time API endpoints** for commercial access
6. **Continuous training pipeline** with weekly model updates
7. **Comprehensive monitoring** for accuracy tracking

**Expected Performance:**
- Deal Type Accuracy: >85%
- Profitable Deals: >70%
- Average Return on Winners: >15%
- False Positive Rate: <10%

---

*Generated: 2026-01-07*
*Version: 1.0*
*Classification: Technical Specification*
