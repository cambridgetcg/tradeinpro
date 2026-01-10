/**
 * Neural Network Deal Identification System - Type Definitions
 *
 * Core types for the AI-powered market intelligence engine.
 * These types define the structure for features, predictions, and deals.
 */

import { Decimal } from "@prisma/client/runtime/library";

// ============================================================================
// DEAL TYPES
// ============================================================================

/**
 * Deal types that the neural network can identify.
 */
export type DealType =
  | "ARBITRAGE_CROSS_MARKET"    // Same card, different market prices
  | "ARBITRAGE_CURRENCY"        // JP/EN price gap + FX opportunity
  | "UNDERVALUED_STATISTICAL"   // Below historical mean (z-score)
  | "UNDERVALUED_COMPARATIVE"   // Below similar cards
  | "MOMENTUM_BREAKOUT"         // Price acceleration detected
  | "MOMENTUM_REVERSAL"         // Oversold bounce opportunity
  | "SUPPLY_SHOCK"              // Inventory depletion signal
  | "DEMAND_SURGE"              // Volume spike detected
  | "CORRELATION_BREAK"         // Decorrelation from set/rarity
  | "SEASONAL_OPPORTUNITY";     // Tournament/release timing

/**
 * Time horizons for deal execution.
 */
export type TimeHorizon = "IMMEDIATE" | "SHORT" | "MEDIUM" | "LONG";

/**
 * Risk levels for deals.
 */
export type RiskLevel = "LOW" | "MEDIUM" | "HIGH";

/**
 * Action types for deal execution.
 */
export type ActionType = "BUY" | "SELL" | "BUY_SELL" | "HOLD";

/**
 * Deal status lifecycle.
 */
export type DealStatus = "ACTIVE" | "EXECUTED" | "EXPIRED" | "CANCELLED";

// ============================================================================
// FEATURE VECTORS
// ============================================================================

/**
 * Price-related features for a card.
 */
export interface PriceFeatures {
  /** Current best price in GBP */
  current_gbp: number;
  /** Current JPY price (if available) */
  current_jpy: number | null;
  /** Spread between OPTCG and Limitless sources */
  spread_optcg_limitless: number;
  /** Spread between OPTCG and JustTCG sources */
  spread_optcg_justtcg: number;
  /** Spread between min and max across all sources */
  spread_min_max: number;
  /** Distance from best available price */
  distance_from_best: number;
  /** JP vs EN price gap percentage */
  jp_en_gap_pct: number;
  /** Gap after FX consideration */
  fx_adjusted_gap: number;
  /** Trade-in vs market spread */
  tradein_margin: number;
  /** Price rank within set (0-1) */
  percentile_in_set: number;
  /** Price rank within rarity (0-1) */
  percentile_in_rarity: number;
  /** Relative to TCG-100 average */
  price_to_index_ratio: number;
}

/**
 * Temporal/time-series features for a card.
 */
export interface TemporalFeatures {
  /** 1-day price change rate */
  velocity_1d: number;
  /** 7-day price change rate */
  velocity_7d: number;
  /** 30-day price change rate */
  velocity_30d: number;
  /** Change in velocity (acceleration) */
  acceleration_7d: number;
  /** 7-day standard deviation */
  volatility_7d: number;
  /** 30-day standard deviation */
  volatility_30d: number;
  /** 7d/30d volatility ratio */
  volatility_ratio: number;
  /** R² of linear regression */
  trend_strength: number;
  /** Slope sign (-1, 0, 1) */
  trend_direction: number;
  /** Distance from 30d mean */
  mean_reversion_distance: number;
  /** Days since 30d high */
  days_since_high: number;
  /** Days since 30d low */
  days_since_low: number;
  /** Consecutive up/down days */
  streak_length: number;
  /** Day-of-week effect */
  seasonality_index: number;
  /** Relative Strength Index */
  momentum_rsi: number;
}

/**
 * Market-level features for a card.
 */
export interface MarketFeatures {
  /** Set-level price trend */
  set_momentum: number;
  /** Rarity-level price trend */
  rarity_momentum: number;
  /** Overall game sentiment (-1 to 1) */
  game_sentiment: number;
  /** Price correlation to set */
  correlation_to_set: number;
  /** Price correlation to rarity */
  correlation_to_rarity: number;
  /** Deviation from expected correlation */
  correlation_deviation: number;
  /** Trading activity estimate (0-1) */
  liquidity_score: number;
  /** Volume vs average */
  volume_relative: number;
  /** Stock level indicator (-1 to 1) */
  inventory_signal: number;
  /** Rank by market cap */
  market_cap_rank: number;
}

/**
 * Foreign exchange related features.
 */
export interface FxFeatures {
  /** Current JPY to GBP rate */
  jpy_gbp_current: number;
  /** FX change rate over 7 days */
  fx_velocity_7d: number;
  /** FX volatility over 7 days */
  fx_volatility_7d: number;
  /** FX trend direction (-1, 0, 1) */
  fx_trend_direction: number;
  /** Distance from 30d mean */
  fx_mean_reversion: number;
}

/**
 * Derived/composite features.
 */
export interface DerivedFeatures {
  /** Composite opportunity score (0-1) */
  opportunity_score: number;
  /** Composite risk score (0-1) */
  risk_score: number;
  /** How quickly to act (0-1) */
  time_sensitivity: number;
}

/**
 * Complete feature vector for a card (45 features total).
 */
export interface FeatureVector {
  price: PriceFeatures;       // 12 features
  temporal: TemporalFeatures; // 15 features
  market: MarketFeatures;     // 10 features
  fx: FxFeatures;             // 5 features
  derived: DerivedFeatures;   // 3 features
}

/**
 * Normalized feature vector (z-scored or min-max scaled).
 */
export interface NormalizedFeatures {
  price: Record<keyof PriceFeatures, number>;
  temporal: Record<keyof TemporalFeatures, number>;
  market: Record<keyof MarketFeatures, number>;
  fx: Record<keyof FxFeatures, number>;
  derived: Record<keyof DerivedFeatures, number>;
}

// ============================================================================
// PREDICTIONS & DEALS
// ============================================================================

/**
 * Raw prediction output from neural network.
 */
export interface DealPrediction {
  /** Predicted deal type */
  dealType: DealType;
  /** Probability distribution across all deal types */
  dealTypeProbabilities: number[];
  /** Overall confidence (0-1) */
  confidence: number;
  /** Expected return percentage */
  expectedReturn: number;
  /** Predicted risk level */
  riskLevel: RiskLevel;
  /** Probability distribution across risk levels */
  riskProbabilities: number[];
}

/**
 * Action recommendation for a deal.
 */
export interface DealAction {
  /** Type of action */
  type: ActionType;
  /** Market to buy from (if applicable) */
  buyMarket?: string;
  /** Buy price (if applicable) */
  buyPrice?: number;
  /** Market to sell on (if applicable) */
  sellMarket?: string;
  /** Sell price (if applicable) */
  sellPrice?: number;
  /** Target price for exit */
  targetPrice?: number;
}

/**
 * Detected deal with full metadata.
 */
export interface DetectedDeal {
  /** Card ID */
  cardId: string;
  /** Card name */
  cardName: string;
  /** Type of deal */
  dealType: DealType;
  /** Confidence score (0-1) */
  confidence: number;
  /** Expected return percentage */
  expectedReturn: number;
  /** Risk level */
  riskLevel: RiskLevel;
  /** Time horizon for execution */
  timeHorizon: TimeHorizon;
  /** Recommended action */
  action: DealAction;
  /** Additional metadata */
  metadata: DealMetadata;
  /** Source of detection (neural or rule) */
  source: "neural" | "rule";
  /** When the deal expires */
  expiresAt: Date;
}

/**
 * Metadata for a detected deal.
 */
export interface DealMetadata {
  /** Feature importance scores */
  featureImportance?: Record<string, number>;
  /** Deal type probability distribution */
  dealTypeProbabilities?: number[];
  /** Sources that contributed to detection */
  sources?: string[];
  /** Additional detector-specific data */
  [key: string]: unknown;
}

// ============================================================================
// DATA CONTAINERS
// ============================================================================

/**
 * Card with all required data for feature calculation.
 */
export interface CardWithData {
  /** Card price record */
  card: {
    cardId: string;
    name: string;
    game: string;
    setCode: string | null;
    variantType: string | null;
    rarity: string | null;
    optcgTcgplayerGbp: Decimal | null;
    limitlessCardmarketGbp: Decimal | null;
    justtcgTcgplayerGbp: Decimal | null;
    bestPriceGbp: Decimal | null;
    tradeinPriceGbp: Decimal | null;
  };
  /** Price history records */
  history: Array<{
    snapshotDate: Date;
    priceGbp: Decimal;
    priceJpy: Decimal | null;
    change: Decimal;
  }>;
  /** Multi-source prices */
  sources: Array<{
    source: string;
    priceGbp: Decimal | null;
    priceJpy: Decimal | null;
  }>;
  /** Exchange rate history */
  fx: Array<{
    date: Date;
    jpyToGbp: Decimal;
  }>;
}

/**
 * Set-level statistics for feature calculation.
 */
export interface SetStatistics {
  /** Set code */
  setCode: string;
  /** Number of cards in set */
  cardCount: number;
  /** Average price in GBP */
  avgPrice: number;
  /** 7-day momentum */
  momentum7d: number;
  /** Get percentile for a price */
  pricePercentile: (price: number) => number;
}

/**
 * Game-level statistics for feature calculation.
 */
export interface GameStatistics {
  /** Game identifier */
  game: string;
  /** Overall sentiment (-1 to 1) */
  sentiment: number;
  /** TCG-100 average price */
  tcg100AvgPrice: number;
  /** Get market cap rank for a card */
  getMarketCapRank: (cardId: string) => number;
}

// ============================================================================
// MODEL CONFIGURATION
// ============================================================================

/**
 * Training options for the neural network.
 */
export interface TrainingOptions {
  /** Number of training epochs */
  epochs?: number;
  /** Batch size */
  batchSize?: number;
  /** Early stopping patience */
  patience?: number;
  /** Learning rate */
  learningRate?: number;
  /** Dropout rate */
  dropoutRate?: number;
}

/**
 * Training labels for supervised learning.
 */
export interface TrainingLabels {
  /** Deal type one-hot encoded */
  dealType: number[][];
  /** Confidence values */
  confidence: number[][];
  /** Expected return values */
  expectedReturn: number[][];
  /** Risk level one-hot encoded */
  riskLevel: number[][];
}

/**
 * Model metrics for evaluation.
 */
export interface ModelMetrics {
  /** Evaluation date */
  date: Date;
  /** Total predictions made */
  totalPredictions: number;
  /** Accuracy rate */
  accuracy: number;
  /** Average confidence */
  avgConfidence: number;
  /** Average predicted return */
  avgPredictedReturn: number;
  /** Average actual return */
  avgActualReturn: number;
}

/**
 * Feature statistics for normalization.
 */
export interface FeatureStatistics {
  price: Record<string, { mean: number; std: number; min: number; max: number }>;
  temporal: Record<string, { mean: number; std: number; min: number; max: number }>;
  market: Record<string, { mean: number; std: number; min: number; max: number }>;
  fx: Record<string, { mean: number; std: number; min: number; max: number }>;
  derived: Record<string, { mean: number; std: number; min: number; max: number }>;
}

// ============================================================================
// API TYPES
// ============================================================================

/**
 * API tier definitions.
 */
export type ApiTier = "free" | "developer" | "professional" | "enterprise" | "neural";

/**
 * API key permissions.
 */
export interface ApiPermissions {
  /** Allowed endpoints */
  endpoints: string[];
  /** Allowed games */
  games: string[];
  /** Maximum history days */
  maxHistoryDays: number;
  /** Bulk access enabled */
  bulkAccess: boolean;
  /** Webhook access enabled */
  webhooks: boolean;
  /** Streaming access enabled */
  streaming: boolean;
  /** Neural access enabled */
  neuralAccess: boolean;
}

/**
 * Rate limit information.
 */
export interface RateLimitInfo {
  /** Daily limit */
  daily: number;
  /** Per-minute limit */
  minute: number;
  /** Remaining daily requests */
  remaining: number;
  /** When limits reset */
  resetAt: Date;
}

/**
 * Authenticated API request context.
 */
export interface ApiKeyAuth {
  /** Key ID */
  keyId: string;
  /** Tier */
  tier: ApiTier;
  /** Rate limit info */
  rateLimit: RateLimitInfo;
  /** Permissions */
  permissions: ApiPermissions;
}

// ============================================================================
// DEAL DETECTION PIPELINE
// ============================================================================

/**
 * Deal detection pipeline configuration.
 */
export interface PipelineConfig {
  /** Minimum confidence threshold */
  minConfidence: number;
  /** Minimum expected return */
  minExpectedReturn: number;
  /** Whether to use neural network */
  useNeuralNetwork: boolean;
  /** Whether to use rule-based detectors */
  useRuleBasedDetectors: boolean;
  /** Model version to use */
  modelVersion?: string;
}

/**
 * Pipeline execution result.
 */
export interface PipelineResult {
  /** Detected deals */
  deals: DetectedDeal[];
  /** Execution duration in ms */
  durationMs: number;
  /** Number of cards processed */
  cardsProcessed: number;
  /** Breakdown by source */
  dealsBySource: {
    neural: number;
    rule: number;
  };
  /** Breakdown by type */
  dealsByType: Record<DealType, number>;
}

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * All deal types as array for iteration.
 */
export const DEAL_TYPES: DealType[] = [
  "ARBITRAGE_CROSS_MARKET",
  "ARBITRAGE_CURRENCY",
  "UNDERVALUED_STATISTICAL",
  "UNDERVALUED_COMPARATIVE",
  "MOMENTUM_BREAKOUT",
  "MOMENTUM_REVERSAL",
  "SUPPLY_SHOCK",
  "DEMAND_SURGE",
  "CORRELATION_BREAK",
  "SEASONAL_OPPORTUNITY",
];

/**
 * Deal type expiry hours.
 */
export const DEAL_EXPIRY_HOURS: Record<DealType, number> = {
  ARBITRAGE_CROSS_MARKET: 4,
  ARBITRAGE_CURRENCY: 24,
  UNDERVALUED_STATISTICAL: 168,
  UNDERVALUED_COMPARATIVE: 168,
  MOMENTUM_BREAKOUT: 48,
  MOMENTUM_REVERSAL: 72,
  SUPPLY_SHOCK: 24,
  DEMAND_SURGE: 48,
  CORRELATION_BREAK: 168,
  SEASONAL_OPPORTUNITY: 336,
};

/**
 * API tier configurations.
 */
export const API_TIER_CONFIG: Record<ApiTier, {
  dailyLimit: number;
  minuteLimit: number;
  maxHistoryDays: number;
  price: number;
}> = {
  free: { dailyLimit: 100, minuteLimit: 10, maxHistoryDays: 0, price: 0 },
  developer: { dailyLimit: 1000, minuteLimit: 60, maxHistoryDays: 7, price: 29 },
  professional: { dailyLimit: 10000, minuteLimit: 200, maxHistoryDays: 90, price: 99 },
  enterprise: { dailyLimit: 100000, minuteLimit: 1000, maxHistoryDays: 365, price: 499 },
  neural: { dailyLimit: -1, minuteLimit: -1, maxHistoryDays: 365, price: 999 },
};
