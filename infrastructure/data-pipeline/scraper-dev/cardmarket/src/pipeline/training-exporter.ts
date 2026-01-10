/**
 * Training Data Exporter for ML Model Training
 *
 * Exports CardMarket price data in formats suitable for neural network training:
 * - 30-timestep sequences for LSTM model (30 days × 45 features)
 * - Feature normalization with Z-scores
 * - Train/validation/test splits
 * - Deal type labels for classification
 *
 * Output Formats:
 * - JSON: For TensorFlow.js training
 * - CSV: For XGBoost/scikit-learn training
 * - Parquet: For Spark/Glue jobs (future)
 */

import { PrismaClient, Prisma } from '@prisma/client';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

// =============================================================================
// CONFIGURATION
// =============================================================================

interface ExporterConfig {
  databaseUrl: string;
  s3Bucket: string;
  s3Region: string;
  sequenceLength: number;     // Number of timesteps (default: 30 days)
  featureCount: number;       // Number of features per timestep
  trainSplit: number;         // Training set ratio (default: 0.7)
  validationSplit: number;    // Validation set ratio (default: 0.15)
  testSplit: number;          // Test set ratio (default: 0.15)
  minHistoryDays: number;     // Minimum history required for a card
  zScoreClip: number;         // Clip Z-scores to prevent outliers
}

const DEFAULT_CONFIG: ExporterConfig = {
  databaseUrl: process.env.DATABASE_URL || '',
  s3Bucket: process.env.S3_DATA_BUCKET || 'tcg-dev-data-lake',
  s3Region: process.env.AWS_REGION || 'us-east-1',
  sequenceLength: 30,
  featureCount: 45,
  trainSplit: 0.7,
  validationSplit: 0.15,
  testSplit: 0.15,
  minHistoryDays: 14,
  zScoreClip: 3.0,
};

// =============================================================================
// TYPES
// =============================================================================

/** 45-feature vector for a single timestep */
interface FeatureVector {
  // Price Features (12)
  current_gbp: number;
  current_eur: number;
  spread_trend_from: number;
  spread_7d_trend: number;
  spread_30d_7d: number;
  distance_from_best: number;
  jp_en_gap_pct: number;
  fx_adjusted_gap: number;
  tradein_margin: number;
  percentile_in_set: number;
  percentile_in_rarity: number;
  price_to_index_ratio: number;

  // Temporal Features (15)
  velocity_1d: number;
  velocity_7d: number;
  velocity_30d: number;
  acceleration_7d: number;
  volatility_7d: number;
  volatility_30d: number;
  volatility_ratio: number;
  trend_strength: number;
  trend_direction: number;
  mean_reversion_distance: number;
  days_since_high: number;
  days_since_low: number;
  streak_length: number;
  seasonality_index: number;
  momentum_rsi: number;

  // Market Features (10)
  set_momentum: number;
  rarity_momentum: number;
  game_sentiment: number;
  correlation_to_set: number;
  correlation_to_rarity: number;
  correlation_deviation: number;
  liquidity_score: number;
  volume_relative: number;
  inventory_signal: number;
  market_cap_rank: number;

  // FX Features (5)
  jpy_gbp_current: number;
  eur_gbp_current: number;
  fx_velocity_7d: number;
  fx_volatility_7d: number;
  fx_trend_direction: number;

  // Derived Features (3)
  opportunity_score: number;
  risk_score: number;
  time_sensitivity: number;
}

/** Training example with sequence and labels */
interface TrainingExample {
  cardId: string;
  sequence: number[][];        // [sequenceLength, featureCount]
  labels: {
    dealType: number[];        // One-hot [10 classes]
    confidence: number;        // [0-1]
    expectedReturn: number;    // Percentage
    riskLevel: number[];       // One-hot [3 classes: LOW, MEDIUM, HIGH]
  };
  metadata: {
    lastDate: string;
    setCode: string;
    variantType: string;
  };
}

/** Normalization statistics */
interface NormalizationStats {
  mean: number[];
  std: number[];
  min: number[];
  max: number[];
}

/** Export result */
interface ExportResult {
  trainExamples: number;
  validationExamples: number;
  testExamples: number;
  s3Keys: string[];
  normalizationStats: NormalizationStats;
}

// =============================================================================
// DEAL TYPE DEFINITIONS
// =============================================================================

const DEAL_TYPES = [
  'ARBITRAGE_CROSS_MARKET',    // 0: Buy low in one market, sell high in another
  'ARBITRAGE_CURRENCY',        // 1: JP/EN FX-adjusted gaps
  'UNDERVALUED_STATISTICAL',   // 2: Price >15% below 30-day mean
  'UNDERVALUED_COMPARATIVE',   // 3: Price <25th percentile vs peers
  'MOMENTUM_BREAKOUT',         // 4: >2%/day price acceleration
  'MOMENTUM_REVERSAL',         // 5: RSI oversold <30 or overbought >70
  'SUPPLY_SHOCK',              // 6: Inventory depletion signal
  'DEMAND_SURGE',              // 7: >2x relative volume spike
  'CORRELATION_BREAK',         // 8: >1.5 std dev from set/rarity
  'SEASONAL_OPPORTUNITY',      // 9: Tournament season patterns
] as const;

const RISK_LEVELS = ['LOW', 'MEDIUM', 'HIGH'] as const;

// =============================================================================
// TRAINING EXPORTER CLASS
// =============================================================================

export class TrainingExporter {
  private config: ExporterConfig;
  private prisma: PrismaClient;
  private s3: S3Client;

  constructor(config: Partial<ExporterConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.prisma = new PrismaClient({
      datasources: {
        db: { url: this.config.databaseUrl }
      }
    });
    this.s3 = new S3Client({ region: this.config.s3Region });
  }

  /**
   * Initialize connections
   */
  async initialize(): Promise<void> {
    await this.prisma.$connect();
    console.log('📊 Connected to database for training export');
  }

  /**
   * Build training dataset from historical data
   */
  async buildTrainingDataset(): Promise<ExportResult> {
    console.log('\n🧠 Building training dataset...\n');

    // 1. Get cards with sufficient history
    const eligibleCards = await this.getEligibleCards();
    console.log(`📋 Found ${eligibleCards.length} cards with sufficient history`);

    // 2. Build feature sequences for each card
    const allExamples: TrainingExample[] = [];
    for (const cardId of eligibleCards) {
      const examples = await this.buildCardSequences(cardId);
      allExamples.push(...examples);
    }
    console.log(`📊 Built ${allExamples.length} training examples`);

    if (allExamples.length === 0) {
      throw new Error('No training examples could be built');
    }

    // 3. Calculate normalization statistics
    const normStats = this.calculateNormalizationStats(allExamples);
    console.log('📈 Calculated normalization statistics');

    // 4. Normalize features
    const normalizedExamples = this.normalizeExamples(allExamples, normStats);

    // 5. Split into train/validation/test
    const { train, validation, test } = this.splitDataset(normalizedExamples);
    console.log(`\n📦 Dataset splits:`);
    console.log(`   Train:      ${train.length} examples`);
    console.log(`   Validation: ${validation.length} examples`);
    console.log(`   Test:       ${test.length} examples`);

    // 6. Export to S3
    const s3Keys = await this.exportToS3({
      train,
      validation,
      test,
      normStats,
    });

    return {
      trainExamples: train.length,
      validationExamples: validation.length,
      testExamples: test.length,
      s3Keys,
      normalizationStats: normStats,
    };
  }

  /**
   * Get cards with sufficient price history
   */
  private async getEligibleCards(): Promise<string[]> {
    const minDate = new Date();
    minDate.setDate(minDate.getDate() - this.config.minHistoryDays);

    const cards = await this.prisma.priceHistoryDaily.groupBy({
      by: ['cardId'],
      _count: { date: true },
      having: {
        date: { _count: { gte: this.config.minHistoryDays } }
      }
    });

    return cards.map(c => c.cardId);
  }

  /**
   * Build feature sequences for a single card
   */
  private async buildCardSequences(cardId: string): Promise<TrainingExample[]> {
    // Get historical prices
    const history = await this.prisma.priceHistoryDaily.findMany({
      where: { cardId },
      orderBy: { date: 'asc' },
      take: 90, // Last 90 days max
    });

    if (history.length < this.config.sequenceLength) {
      return [];
    }

    // Get card metadata
    const card = await this.prisma.cardPriceV2.findUnique({
      where: { cardId }
    });

    const examples: TrainingExample[] = [];

    // Create sliding window sequences
    for (let i = this.config.sequenceLength; i < history.length; i++) {
      const windowStart = i - this.config.sequenceLength;
      const windowData = history.slice(windowStart, i);
      const targetData = history[i];

      // Build feature sequence
      const sequence = windowData.map((day, idx) =>
        this.buildDayFeatures(day, windowData, idx)
      );

      // Determine labels (rule-based for now, will be replaced by model)
      const labels = this.determineLabels(windowData, targetData);

      examples.push({
        cardId,
        sequence,
        labels,
        metadata: {
          lastDate: targetData.date.toISOString().split('T')[0],
          setCode: card?.releaseSet || cardId.split('-')[0],
          variantType: card?.variantType || 'unknown',
        }
      });
    }

    return examples;
  }

  /**
   * Build 45-feature vector for a single day
   */
  private buildDayFeatures(
    day: any,
    history: any[],
    dayIndex: number
  ): number[] {
    const features: number[] = [];

    // Helper to safely get price as number
    const toNum = (val: Prisma.Decimal | null | undefined): number =>
      val ? val.toNumber() : 0;

    const currentPrice = toNum(day.euTrendGbp) || toNum(day.usMarketGbp);
    const fromPrice = toNum(day.euLowGbp) || toNum(day.usLowGbp);

    // ===== Price Features (12) =====
    features.push(currentPrice);                                    // current_gbp
    features.push(toNum(day.euTrendEur));                          // current_eur
    features.push(fromPrice > 0 ? (currentPrice - fromPrice) / fromPrice : 0);  // spread_trend_from
    features.push(0);                                               // spread_7d_trend (needs avg)
    features.push(0);                                               // spread_30d_7d (needs avg)
    features.push(fromPrice > 0 ? currentPrice / fromPrice - 1 : 0); // distance_from_best
    features.push(0);                                               // jp_en_gap_pct (not available)
    features.push(0);                                               // fx_adjusted_gap
    features.push(currentPrice * 0.7);                             // tradein_margin (70% of price)
    features.push(0.5);                                             // percentile_in_set (placeholder)
    features.push(0.5);                                             // percentile_in_rarity (placeholder)
    features.push(1.0);                                             // price_to_index_ratio (placeholder)

    // ===== Temporal Features (15) =====
    const velocities = this.calculateVelocities(history, dayIndex);
    features.push(velocities.velocity1d);                           // velocity_1d
    features.push(velocities.velocity7d);                           // velocity_7d
    features.push(velocities.velocity30d);                          // velocity_30d
    features.push(velocities.acceleration7d);                       // acceleration_7d
    features.push(velocities.volatility7d);                         // volatility_7d
    features.push(velocities.volatility30d);                        // volatility_30d
    features.push(velocities.volatility7d > 0 ? velocities.volatility30d / velocities.volatility7d : 1);  // volatility_ratio
    features.push(velocities.trendStrength);                        // trend_strength
    features.push(velocities.trendDirection);                       // trend_direction
    features.push(0);                                               // mean_reversion_distance
    features.push(velocities.daysSinceHigh);                        // days_since_high
    features.push(velocities.daysSinceLow);                         // days_since_low
    features.push(0);                                               // streak_length
    features.push(0);                                               // seasonality_index
    features.push(velocities.rsi);                                  // momentum_rsi

    // ===== Market Features (10) =====
    features.push(0);                                               // set_momentum
    features.push(0);                                               // rarity_momentum
    features.push(0);                                               // game_sentiment
    features.push(0);                                               // correlation_to_set
    features.push(0);                                               // correlation_to_rarity
    features.push(0);                                               // correlation_deviation
    features.push(day.euListingsCount || 0);                        // liquidity_score
    features.push(1.0);                                             // volume_relative
    features.push(0);                                               // inventory_signal
    features.push(0);                                               // market_cap_rank

    // ===== FX Features (5) =====
    features.push(0);                                               // jpy_gbp_current (not available)
    features.push(toNum(day.fxEurGbp) || 0.85);                    // eur_gbp_current
    features.push(0);                                               // fx_velocity_7d
    features.push(0);                                               // fx_volatility_7d
    features.push(0);                                               // fx_trend_direction

    // ===== Derived Features (3) =====
    features.push(0);                                               // opportunity_score
    features.push(0);                                               // risk_score
    features.push(0);                                               // time_sensitivity

    return features;
  }

  /**
   * Calculate velocity and volatility features
   */
  private calculateVelocities(history: any[], currentIndex: number): {
    velocity1d: number;
    velocity7d: number;
    velocity30d: number;
    acceleration7d: number;
    volatility7d: number;
    volatility30d: number;
    trendStrength: number;
    trendDirection: number;
    daysSinceHigh: number;
    daysSinceLow: number;
    rsi: number;
  } {
    const toNum = (val: any): number => val?.toNumber?.() || Number(val) || 0;
    const getPrice = (h: any) => toNum(h.euTrendGbp) || toNum(h.usMarketGbp);

    const currentPrice = getPrice(history[currentIndex]);
    const prices = history.slice(0, currentIndex + 1).map(getPrice);

    // Velocities (% change per day)
    const velocity1d = currentIndex >= 1 && prices[currentIndex - 1] > 0
      ? (currentPrice - prices[currentIndex - 1]) / prices[currentIndex - 1]
      : 0;

    const velocity7d = currentIndex >= 7 && prices[currentIndex - 7] > 0
      ? (currentPrice - prices[currentIndex - 7]) / prices[currentIndex - 7] / 7
      : 0;

    const velocity30d = currentIndex >= 30 && prices[currentIndex - 30] > 0
      ? (currentPrice - prices[currentIndex - 30]) / prices[currentIndex - 30] / 30
      : 0;

    // Acceleration
    const acceleration7d = velocity7d - (currentIndex >= 8 && prices[currentIndex - 8] > 0
      ? (prices[currentIndex - 7] - prices[currentIndex - 8]) / prices[currentIndex - 8]
      : 0);

    // Volatility (std dev of returns)
    const returns7d = prices.slice(-7).map((p, i, arr) =>
      i > 0 && arr[i - 1] > 0 ? (p - arr[i - 1]) / arr[i - 1] : 0
    ).slice(1);

    const volatility7d = returns7d.length > 0
      ? Math.sqrt(returns7d.reduce((sum, r) => sum + r * r, 0) / returns7d.length)
      : 0;

    const returns30d = prices.slice(-30).map((p, i, arr) =>
      i > 0 && arr[i - 1] > 0 ? (p - arr[i - 1]) / arr[i - 1] : 0
    ).slice(1);

    const volatility30d = returns30d.length > 0
      ? Math.sqrt(returns30d.reduce((sum, r) => sum + r * r, 0) / returns30d.length)
      : 0;

    // Trend strength and direction
    const avgPrice = prices.length > 0
      ? prices.reduce((a, b) => a + b, 0) / prices.length
      : currentPrice;

    const trendDirection = avgPrice > 0 ? (currentPrice - avgPrice) / avgPrice : 0;
    const trendStrength = Math.abs(trendDirection);

    // Days since high/low
    const maxPrice = Math.max(...prices);
    const minPrice = Math.min(...prices);
    const daysSinceHigh = prices.lastIndexOf(maxPrice) >= 0
      ? currentIndex - prices.lastIndexOf(maxPrice)
      : 0;
    const daysSinceLow = prices.lastIndexOf(minPrice) >= 0
      ? currentIndex - prices.lastIndexOf(minPrice)
      : 0;

    // RSI (Relative Strength Index)
    const gains = returns7d.filter(r => r > 0);
    const losses = returns7d.filter(r => r < 0).map(r => Math.abs(r));
    const avgGain = gains.length > 0 ? gains.reduce((a, b) => a + b, 0) / 7 : 0;
    const avgLoss = losses.length > 0 ? losses.reduce((a, b) => a + b, 0) / 7 : 0;
    const rs = avgLoss > 0 ? avgGain / avgLoss : 100;
    const rsi = 100 - (100 / (1 + rs));

    return {
      velocity1d,
      velocity7d,
      velocity30d,
      acceleration7d,
      volatility7d,
      volatility30d,
      trendStrength,
      trendDirection,
      daysSinceHigh,
      daysSinceLow,
      rsi: rsi / 100, // Normalize to 0-1
    };
  }

  /**
   * Determine labels for a training example
   */
  private determineLabels(
    history: any[],
    target: any
  ): TrainingExample['labels'] {
    const toNum = (val: any): number => val?.toNumber?.() || Number(val) || 0;
    const getPrice = (h: any) => toNum(h.euTrendGbp) || toNum(h.usMarketGbp);

    const prices = history.map(getPrice);
    const targetPrice = getPrice(target);
    const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;

    // Determine deal type based on rules
    let dealTypeIndex = -1;
    let confidence = 0.5;
    let expectedReturn = 0;
    let riskLevel = 1; // MEDIUM

    // Check for undervalued (>15% below 30-day mean)
    if (avgPrice > 0 && (avgPrice - targetPrice) / avgPrice > 0.15) {
      dealTypeIndex = 2; // UNDERVALUED_STATISTICAL
      confidence = Math.min(0.9, (avgPrice - targetPrice) / avgPrice);
      expectedReturn = (avgPrice - targetPrice) / targetPrice * 100;
      riskLevel = expectedReturn > 30 ? 2 : expectedReturn > 15 ? 1 : 0;
    }

    // Check for momentum breakout
    const velocity7d = prices.length >= 7
      ? (targetPrice - prices[prices.length - 7]) / prices[prices.length - 7] / 7
      : 0;

    if (velocity7d > 0.02) { // >2%/day
      dealTypeIndex = 4; // MOMENTUM_BREAKOUT
      confidence = Math.min(0.8, velocity7d * 10);
      expectedReturn = velocity7d * 30 * 100; // Project 30 days
      riskLevel = 2; // HIGH (momentum can reverse)
    }

    // Default: no deal detected
    if (dealTypeIndex === -1) {
      dealTypeIndex = 0; // Default to ARBITRAGE_CROSS_MARKET
      confidence = 0.1;
      expectedReturn = 0;
    }

    // One-hot encode deal type
    const dealType = Array(10).fill(0);
    dealType[dealTypeIndex] = 1;

    // One-hot encode risk level
    const riskLevelOneHot = Array(3).fill(0);
    riskLevelOneHot[riskLevel] = 1;

    return {
      dealType,
      confidence,
      expectedReturn,
      riskLevel: riskLevelOneHot,
    };
  }

  /**
   * Calculate normalization statistics (mean, std) for all features
   */
  private calculateNormalizationStats(examples: TrainingExample[]): NormalizationStats {
    const featureCount = this.config.featureCount;
    const sums = Array(featureCount).fill(0);
    const sumSquares = Array(featureCount).fill(0);
    const mins = Array(featureCount).fill(Infinity);
    const maxs = Array(featureCount).fill(-Infinity);
    let count = 0;

    for (const example of examples) {
      for (const timestep of example.sequence) {
        for (let i = 0; i < featureCount; i++) {
          const val = timestep[i] || 0;
          sums[i] += val;
          sumSquares[i] += val * val;
          mins[i] = Math.min(mins[i], val);
          maxs[i] = Math.max(maxs[i], val);
        }
        count++;
      }
    }

    const mean = sums.map(s => s / count);
    const variance = sumSquares.map((ss, i) => ss / count - mean[i] * mean[i]);
    const std = variance.map(v => Math.sqrt(Math.max(v, 1e-8))); // Prevent division by zero

    return { mean, std, min: mins, max: maxs };
  }

  /**
   * Normalize examples using Z-score normalization
   */
  private normalizeExamples(
    examples: TrainingExample[],
    stats: NormalizationStats
  ): TrainingExample[] {
    const clip = this.config.zScoreClip;

    return examples.map(example => ({
      ...example,
      sequence: example.sequence.map(timestep =>
        timestep.map((val, i) => {
          const zScore = (val - stats.mean[i]) / stats.std[i];
          return Math.max(-clip, Math.min(clip, zScore)); // Clip outliers
        })
      )
    }));
  }

  /**
   * Split dataset into train/validation/test
   */
  private splitDataset(examples: TrainingExample[]): {
    train: TrainingExample[];
    validation: TrainingExample[];
    test: TrainingExample[];
  } {
    // Shuffle examples
    const shuffled = [...examples].sort(() => Math.random() - 0.5);

    const trainEnd = Math.floor(shuffled.length * this.config.trainSplit);
    const valEnd = trainEnd + Math.floor(shuffled.length * this.config.validationSplit);

    return {
      train: shuffled.slice(0, trainEnd),
      validation: shuffled.slice(trainEnd, valEnd),
      test: shuffled.slice(valEnd),
    };
  }

  /**
   * Export datasets to S3
   */
  private async exportToS3(data: {
    train: TrainingExample[];
    validation: TrainingExample[];
    test: TrainingExample[];
    normStats: NormalizationStats;
  }): Promise<string[]> {
    const timestamp = new Date().toISOString().split('T')[0];
    const basePath = `training/cardmarket/datasets/${timestamp}`;
    const keys: string[] = [];

    // Export train set
    const trainKey = `${basePath}/train.json`;
    await this.s3.send(new PutObjectCommand({
      Bucket: this.config.s3Bucket,
      Key: trainKey,
      Body: JSON.stringify(data.train),
      ContentType: 'application/json',
    }));
    keys.push(trainKey);

    // Export validation set
    const valKey = `${basePath}/validation.json`;
    await this.s3.send(new PutObjectCommand({
      Bucket: this.config.s3Bucket,
      Key: valKey,
      Body: JSON.stringify(data.validation),
      ContentType: 'application/json',
    }));
    keys.push(valKey);

    // Export test set
    const testKey = `${basePath}/test.json`;
    await this.s3.send(new PutObjectCommand({
      Bucket: this.config.s3Bucket,
      Key: testKey,
      Body: JSON.stringify(data.test),
      ContentType: 'application/json',
    }));
    keys.push(testKey);

    // Export normalization stats
    const statsKey = `${basePath}/normalization_stats.json`;
    await this.s3.send(new PutObjectCommand({
      Bucket: this.config.s3Bucket,
      Key: statsKey,
      Body: JSON.stringify(data.normStats),
      ContentType: 'application/json',
    }));
    keys.push(statsKey);

    // Export metadata
    const metaKey = `${basePath}/metadata.json`;
    await this.s3.send(new PutObjectCommand({
      Bucket: this.config.s3Bucket,
      Key: metaKey,
      Body: JSON.stringify({
        exportDate: new Date().toISOString(),
        sequenceLength: this.config.sequenceLength,
        featureCount: this.config.featureCount,
        trainExamples: data.train.length,
        validationExamples: data.validation.length,
        testExamples: data.test.length,
        dealTypes: DEAL_TYPES,
        riskLevels: RISK_LEVELS,
      }),
      ContentType: 'application/json',
    }));
    keys.push(metaKey);

    console.log(`\n📤 Exported to S3:`);
    keys.forEach(k => console.log(`   s3://${this.config.s3Bucket}/${k}`));

    return keys;
  }

  /**
   * Cleanup connections
   */
  async close(): Promise<void> {
    await this.prisma.$disconnect();
  }
}

// =============================================================================
// CLI ENTRY POINT
// =============================================================================

async function main() {
  const exporter = new TrainingExporter();

  try {
    await exporter.initialize();
    const result = await exporter.buildTrainingDataset();

    console.log('\n✅ Training export complete!');
    console.log(`   Train:      ${result.trainExamples} examples`);
    console.log(`   Validation: ${result.validationExamples} examples`);
    console.log(`   Test:       ${result.testExamples} examples`);

  } catch (error) {
    console.error('Export failed:', error);
    process.exit(1);
  } finally {
    await exporter.close();
  }
}

const isMainModule = typeof process !== 'undefined' && process.argv[1]?.includes('training-exporter');
if (isMainModule) {
  main();
}
