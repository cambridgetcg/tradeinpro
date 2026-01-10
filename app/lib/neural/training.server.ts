/**
 * Neural Network Training Data Pipeline
 *
 * Handles data preparation for model training including:
 * - Historical data export
 * - Feature sequence generation
 * - Label creation from deal outcomes
 * - Train/validation/test splits
 */

import { getShardClient, GameShard } from "../shard.server";
import {
  FeatureVector,
  FeatureStatistics,
  TrainingLabels,
  DealType,
  DEAL_TYPES,
} from "./types";
import { FeatureNormalizer, flattenFeatureVector } from "./features.server";

// ============================================================================
// TRAINING DATA TYPES
// ============================================================================

export interface TrainingExample {
  /** Card ID */
  cardId: string;
  /** Sequence of feature vectors (30 days) */
  features: number[][];
  /** Labels */
  labels: {
    dealType: number[]; // One-hot encoded
    confidence: number;
    expectedReturn: number;
    riskLevel: number[]; // One-hot encoded [LOW, MEDIUM, HIGH]
  };
  /** When this example was created */
  timestamp: Date;
}

export interface TrainingDataset {
  /** Training examples */
  train: TrainingExample[];
  /** Validation examples */
  validation: TrainingExample[];
  /** Test examples */
  test: TrainingExample[];
  /** Feature statistics for normalization */
  statistics: FeatureStatistics;
  /** Metadata */
  metadata: {
    totalExamples: number;
    positiveExamples: number;
    negativeExamples: number;
    dealTypeDistribution: Record<DealType, number>;
    dateRange: { start: Date; end: Date };
    game: GameShard;
  };
}

export interface TrainingDataConfig {
  /** Game to export data for */
  game?: GameShard;
  /** Minimum days of history required */
  minHistoryDays?: number;
  /** Sequence length for LSTM input */
  sequenceLength?: number;
  /** Train/validation/test split ratios */
  splitRatios?: { train: number; validation: number; test: number };
  /** Whether to include negative examples */
  includeNegatives?: boolean;
  /** Ratio of negatives to positives */
  negativeRatio?: number;
  /** Minimum deal confidence for positive examples */
  minDealConfidence?: number;
}

const DEFAULT_CONFIG: Required<TrainingDataConfig> = {
  game: "onepiece",
  minHistoryDays: 30,
  sequenceLength: 30,
  splitRatios: { train: 0.7, validation: 0.15, test: 0.15 },
  includeNegatives: true,
  negativeRatio: 2,
  minDealConfidence: 0.6,
};

// ============================================================================
// TRAINING DATA PIPELINE
// ============================================================================

/**
 * Export training data from historical deals and price history.
 */
export async function exportTrainingData(
  config?: TrainingDataConfig
): Promise<TrainingDataset> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const client = getShardClient(cfg.game);

  console.log(`[TrainingPipeline] Starting export for ${cfg.game}`);

  // Step 1: Get historical deals with outcomes
  const deals = await client.neuralDeal.findMany({
    where: {
      status: { in: ["EXECUTED", "EXPIRED"] },
      confidence: { gte: cfg.minDealConfidence },
    },
    orderBy: { createdAt: "asc" },
  });

  console.log(`[TrainingPipeline] Found ${deals.length} historical deals`);

  // Step 2: Get all cards with sufficient history
  const cardIds = [...new Set(deals.map((d) => d.cardId))];

  // Calculate minDate based on earliest deal date (need sequenceLength days before it)
  const earliestDealDate = deals.length > 0
    ? new Date(Math.min(...deals.map((d) => d.createdAt.getTime())))
    : new Date();
  const minDate = new Date(earliestDealDate.getTime() - cfg.sequenceLength * 24 * 60 * 60 * 1000);

  const cards = await client.cardPriceV2.findMany({
    where: {
      cardId: { in: cardIds.length > 0 ? cardIds : undefined },
      game: cfg.game,
      bestPriceGbp: { gt: 0 },
    },
    take: 5000,
  });

  const histories = await client.cardPriceHistory.findMany({
    where: {
      cardId: { in: cards.map((c) => c.cardId) },
      snapshotDate: { gte: minDate },
    },
    orderBy: { snapshotDate: "asc" },
  });

  // Group history by card
  const historyByCard = new Map<string, typeof histories>();
  for (const h of histories) {
    if (!historyByCard.has(h.cardId)) {
      historyByCard.set(h.cardId, []);
    }
    historyByCard.get(h.cardId)!.push(h);
  }

  // Step 3: Create positive examples from deals
  const positiveExamples: TrainingExample[] = [];
  const dealsByCard = new Map<string, typeof deals>();
  for (const deal of deals) {
    if (!dealsByCard.has(deal.cardId)) {
      dealsByCard.set(deal.cardId, []);
    }
    dealsByCard.get(deal.cardId)!.push(deal);
  }

  const normalizer = new FeatureNormalizer();
  const statistics = normalizer.getStatistics();

  for (const deal of deals) {
    const history = historyByCard.get(deal.cardId) || [];
    if (history.length < cfg.sequenceLength) continue;

    const card = cards.find((c) => c.cardId === deal.cardId);
    if (!card) continue;

    // Get features up to deal creation date
    const dealDate = deal.createdAt;
    const relevantHistory = history
      .filter((h) => h.snapshotDate < dealDate)
      .slice(-cfg.sequenceLength);

    if (relevantHistory.length < cfg.sequenceLength) continue;

    // Build feature sequence
    const featureSequence = await buildFeatureSequence(
      card,
      relevantHistory,
      cfg.sequenceLength,
      normalizer
    );

    if (!featureSequence) continue;

    positiveExamples.push({
      cardId: deal.cardId,
      features: featureSequence,
      labels: {
        dealType: oneHotEncode(deal.dealType, DEAL_TYPES),
        confidence: deal.confidence.toNumber(),
        expectedReturn: deal.expectedReturn.toNumber(),
        riskLevel: oneHotEncode(deal.riskLevel, ["LOW", "MEDIUM", "HIGH"]),
      },
      timestamp: deal.createdAt,
    });
  }

  console.log(`[TrainingPipeline] Created ${positiveExamples.length} positive examples`);

  // Step 4: Create negative examples from non-deal cards
  const negativeExamples: TrainingExample[] = [];
  if (cfg.includeNegatives) {
    const targetNegatives = Math.floor(positiveExamples.length * cfg.negativeRatio);
    const dealCardIds = new Set(deals.map((d) => d.cardId));

    const nonDealCards = cards.filter((c) => !dealCardIds.has(c.cardId));
    const shuffled = shuffleArray(nonDealCards);

    for (const card of shuffled.slice(0, targetNegatives)) {
      const history = historyByCard.get(card.cardId) || [];
      if (history.length < cfg.sequenceLength) continue;

      const featureSequence = await buildFeatureSequence(
        card,
        history.slice(-cfg.sequenceLength),
        cfg.sequenceLength,
        normalizer
      );

      if (!featureSequence) continue;

      // Negative example - no deal type, low confidence
      negativeExamples.push({
        cardId: card.cardId,
        features: featureSequence,
        labels: {
          dealType: new Array(DEAL_TYPES.length).fill(0), // No deal
          confidence: 0.1,
          expectedReturn: 0,
          riskLevel: [0.33, 0.33, 0.34], // Uniform distribution
        },
        timestamp: new Date(),
      });
    }
  }

  console.log(`[TrainingPipeline] Created ${negativeExamples.length} negative examples`);

  // Step 5: Combine and shuffle
  const allExamples = shuffleArray([...positiveExamples, ...negativeExamples]);

  // Step 6: Split into train/validation/test
  const trainEnd = Math.floor(allExamples.length * cfg.splitRatios.train);
  const valEnd = trainEnd + Math.floor(allExamples.length * cfg.splitRatios.validation);

  const train = allExamples.slice(0, trainEnd);
  const validation = allExamples.slice(trainEnd, valEnd);
  const test = allExamples.slice(valEnd);

  // Step 7: Calculate deal type distribution
  const dealTypeDistribution: Record<DealType, number> = {} as Record<DealType, number>;
  for (const dt of DEAL_TYPES) {
    dealTypeDistribution[dt] = 0;
  }
  for (const ex of positiveExamples) {
    const dealTypeIndex = ex.labels.dealType.indexOf(1);
    if (dealTypeIndex >= 0) {
      dealTypeDistribution[DEAL_TYPES[dealTypeIndex]]++;
    }
  }

  // Calculate date range
  const dates = allExamples.map((e) => e.timestamp.getTime());
  const dateRange = {
    start: new Date(Math.min(...dates)),
    end: new Date(Math.max(...dates)),
  };

  console.log(`[TrainingPipeline] Export complete:`);
  console.log(`  - Train: ${train.length}`);
  console.log(`  - Validation: ${validation.length}`);
  console.log(`  - Test: ${test.length}`);

  return {
    train,
    validation,
    test,
    statistics,
    metadata: {
      totalExamples: allExamples.length,
      positiveExamples: positiveExamples.length,
      negativeExamples: negativeExamples.length,
      dealTypeDistribution,
      dateRange,
      game: cfg.game,
    },
  };
}

/**
 * Build a sequence of feature vectors from price history.
 * Uses a simplified feature calculation for training data.
 */
async function buildFeatureSequence(
  card: { cardId: string; name: string; setCode: string | null; bestPriceGbp: { toNumber: () => number } | null },
  history: Array<{ snapshotDate: Date; priceGbp: { toNumber: () => number }; priceJpy: { toNumber: () => number } | null; change: { toNumber: () => number } }>,
  sequenceLength: number,
  normalizer: FeatureNormalizer
): Promise<number[][] | null> {
  if (history.length < sequenceLength) return null;

  const sequence: number[][] = [];

  // For each day in the sequence, calculate simplified features
  for (let i = 0; i < sequenceLength; i++) {
    const dayHistory = history.slice(0, history.length - sequenceLength + i + 1);
    const currentPrice = dayHistory[dayHistory.length - 1]?.priceGbp.toNumber() || 0;

    // Calculate simplified features from history
    const features = calculateSimplifiedFeatures(dayHistory, currentPrice);
    const normalized = normalizer.normalize(features);
    const flat = flattenFeatureVector(normalized);

    sequence.push(flat);
  }

  return sequence;
}

/**
 * Calculate simplified features from history data for training.
 */
function calculateSimplifiedFeatures(
  history: Array<{ snapshotDate: Date; priceGbp: { toNumber: () => number }; priceJpy: { toNumber: () => number } | null; change: { toNumber: () => number } }>,
  currentPrice: number
): FeatureVector {
  const prices = history.map((h) => h.priceGbp.toNumber());
  const changes = history.map((h) => h.change.toNumber());

  // Calculate basic statistics
  const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
  const stdDev = Math.sqrt(
    prices.reduce((sum, p) => sum + Math.pow(p - avgPrice, 2), 0) / prices.length
  );

  // Calculate velocity
  const velocity7d = prices.length >= 7
    ? (prices[prices.length - 1] - prices[prices.length - 7]) / (prices[prices.length - 7] || 1) / 7
    : 0;

  // Calculate RSI
  const gains = changes.filter((c) => c > 0);
  const losses = changes.filter((c) => c < 0).map(Math.abs);
  const avgGain = gains.length > 0 ? gains.reduce((a, b) => a + b, 0) / 14 : 0;
  const avgLoss = losses.length > 0 ? losses.reduce((a, b) => a + b, 0) / 14 : 0.001;
  const rs = avgGain / avgLoss;
  const rsi = 100 - 100 / (1 + rs);

  return {
    price: {
      current_gbp: currentPrice,
      current_jpy: null,
      spread_optcg_limitless: 0,
      spread_optcg_justtcg: 0,
      spread_min_max: 0,
      distance_from_best: 0,
      jp_en_gap_pct: 0,
      fx_adjusted_gap: 0,
      tradein_margin: 0.3,
      percentile_in_set: 0.5,
      percentile_in_rarity: 0.5,
      price_to_index_ratio: currentPrice / 50,
    },
    temporal: {
      velocity_1d: changes[changes.length - 1] || 0,
      velocity_7d: velocity7d,
      velocity_30d: prices.length >= 30
        ? (prices[prices.length - 1] - prices[0]) / (prices[0] || 1) / 30
        : 0,
      acceleration_7d: 0,
      volatility_7d: stdDev / avgPrice,
      volatility_30d: stdDev / avgPrice,
      volatility_ratio: 1,
      trend_strength: Math.abs(velocity7d) * 10,
      trend_direction: velocity7d > 0 ? 1 : velocity7d < 0 ? -1 : 0,
      mean_reversion_distance: (currentPrice - avgPrice) / (stdDev || 1),
      days_since_high: 0,
      days_since_low: 0,
      streak_length: 0,
      seasonality_index: 0,
      momentum_rsi: rsi,
    },
    market: {
      set_momentum: 0,
      rarity_momentum: 0,
      game_sentiment: 0,
      correlation_to_set: 0.7,
      correlation_to_rarity: 0.6,
      correlation_deviation: 0,
      liquidity_score: 0.5,
      volume_relative: 1,
      inventory_signal: 0,
      market_cap_rank: 100,
    },
    fx: {
      jpy_gbp_current: 0.0053,
      fx_velocity_7d: 0,
      fx_volatility_7d: 0.01,
      fx_trend_direction: 0,
      fx_mean_reversion: 0,
    },
    derived: {
      opportunity_score: 0.5,
      risk_score: 0.5,
      time_sensitivity: 0.5,
    },
  };
}

/**
 * Convert training data to TensorFlow-compatible format.
 */
export function toTensorFormat(dataset: TrainingDataset): {
  xTrain: number[][][];
  yTrainDealType: number[][];
  yTrainConfidence: number[];
  yTrainReturn: number[];
  yTrainRisk: number[][];
  xVal: number[][][];
  yValDealType: number[][];
  yValConfidence: number[];
  yValReturn: number[];
  yValRisk: number[][];
  xTest: number[][][];
  yTestDealType: number[][];
  yTestConfidence: number[];
  yTestReturn: number[];
  yTestRisk: number[][];
} {
  const extractXY = (examples: TrainingExample[]) => ({
    x: examples.map((e) => e.features),
    yDealType: examples.map((e) => e.labels.dealType),
    yConfidence: examples.map((e) => e.labels.confidence),
    yReturn: examples.map((e) => e.labels.expectedReturn),
    yRisk: examples.map((e) => e.labels.riskLevel),
  });

  const trainData = extractXY(dataset.train);
  const valData = extractXY(dataset.validation);
  const testData = extractXY(dataset.test);

  return {
    xTrain: trainData.x,
    yTrainDealType: trainData.yDealType,
    yTrainConfidence: trainData.yConfidence,
    yTrainReturn: trainData.yReturn,
    yTrainRisk: trainData.yRisk,
    xVal: valData.x,
    yValDealType: valData.yDealType,
    yValConfidence: valData.yConfidence,
    yValReturn: valData.yReturn,
    yValRisk: valData.yRisk,
    xTest: testData.x,
    yTestDealType: testData.yDealType,
    yTestConfidence: testData.yConfidence,
    yTestReturn: testData.yReturn,
    yTestRisk: testData.yRisk,
  };
}

/**
 * Export training data to JSON file format.
 */
export function exportToJSON(dataset: TrainingDataset): string {
  return JSON.stringify({
    train: dataset.train.map((e) => ({
      cardId: e.cardId,
      features: e.features,
      labels: e.labels,
      timestamp: e.timestamp.toISOString(),
    })),
    validation: dataset.validation.map((e) => ({
      cardId: e.cardId,
      features: e.features,
      labels: e.labels,
      timestamp: e.timestamp.toISOString(),
    })),
    test: dataset.test.map((e) => ({
      cardId: e.cardId,
      features: e.features,
      labels: e.labels,
      timestamp: e.timestamp.toISOString(),
    })),
    statistics: dataset.statistics,
    metadata: {
      ...dataset.metadata,
      dateRange: {
        start: dataset.metadata.dateRange.start.toISOString(),
        end: dataset.metadata.dateRange.end.toISOString(),
      },
    },
  });
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function oneHotEncode<T>(value: T, categories: readonly T[]): number[] {
  const result = new Array(categories.length).fill(0);
  const index = categories.indexOf(value);
  if (index >= 0) {
    result[index] = 1;
  }
  return result;
}

function shuffleArray<T>(array: T[]): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// ============================================================================
// DATA AUGMENTATION
// ============================================================================

/**
 * Augment training data with synthetic examples.
 */
export function augmentTrainingData(
  examples: TrainingExample[],
  augmentationFactor: number = 2
): TrainingExample[] {
  const augmented: TrainingExample[] = [...examples];

  for (const example of examples) {
    for (let i = 0; i < augmentationFactor - 1; i++) {
      // Add noise to features
      const noisyFeatures = example.features.map((seq) =>
        seq.map((val) => val + (Math.random() - 0.5) * 0.1)
      );

      augmented.push({
        ...example,
        cardId: `${example.cardId}_aug_${i}`,
        features: noisyFeatures,
      });
    }
  }

  return shuffleArray(augmented);
}

/**
 * Balance classes by oversampling minority classes.
 */
export function balanceClasses(examples: TrainingExample[]): TrainingExample[] {
  // Group by deal type
  const byType: Map<number, TrainingExample[]> = new Map();

  for (const ex of examples) {
    const typeIndex = ex.labels.dealType.indexOf(1);
    if (!byType.has(typeIndex)) {
      byType.set(typeIndex, []);
    }
    byType.get(typeIndex)!.push(ex);
  }

  // Find max count
  const maxCount = Math.max(...Array.from(byType.values()).map((arr) => arr.length));

  // Oversample minority classes
  const balanced: TrainingExample[] = [];

  for (const [typeIndex, typeExamples] of byType) {
    balanced.push(...typeExamples);

    // Oversample
    const needed = maxCount - typeExamples.length;
    for (let i = 0; i < needed; i++) {
      const source = typeExamples[i % typeExamples.length];
      balanced.push({
        ...source,
        cardId: `${source.cardId}_os_${i}`,
      });
    }
  }

  return shuffleArray(balanced);
}
