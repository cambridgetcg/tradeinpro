/**
 * Neural Network Deal Identification System - Validation Schemas
 *
 * Zod schemas for runtime validation of neural system data.
 * These schemas ensure data integrity at system boundaries (API, database).
 */

import { z } from "zod";

// ============================================================================
// ENUMS & LITERALS
// ============================================================================

export const DealTypeSchema = z.enum([
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
]);

export const TimeHorizonSchema = z.enum(["IMMEDIATE", "SHORT", "MEDIUM", "LONG"]);

export const RiskLevelSchema = z.enum(["LOW", "MEDIUM", "HIGH"]);

export const ActionTypeSchema = z.enum(["BUY", "SELL", "BUY_SELL", "HOLD"]);

export const DealStatusSchema = z.enum(["ACTIVE", "EXECUTED", "EXPIRED", "CANCELLED"]);

export const ApiTierSchema = z.enum([
  "free",
  "developer",
  "professional",
  "enterprise",
  "neural",
]);

export const GameShardSchema = z.enum(["onepiece", "pokemon", "mtg", "yugioh"]);

// ============================================================================
// FEATURE VECTORS
// ============================================================================

export const PriceFeaturesSchema = z.object({
  current_gbp: z.number().nonnegative(),
  current_jpy: z.number().nonnegative().nullable(),
  spread_optcg_limitless: z.number(),
  spread_optcg_justtcg: z.number(),
  spread_min_max: z.number().min(0).max(1),
  distance_from_best: z.number(),
  jp_en_gap_pct: z.number(),
  fx_adjusted_gap: z.number(),
  tradein_margin: z.number().min(0).max(1),
  percentile_in_set: z.number().min(0).max(1),
  percentile_in_rarity: z.number().min(0).max(1),
  price_to_index_ratio: z.number().nonnegative(),
});

export const TemporalFeaturesSchema = z.object({
  velocity_1d: z.number(),
  velocity_7d: z.number(),
  velocity_30d: z.number(),
  acceleration_7d: z.number(),
  volatility_7d: z.number().nonnegative(),
  volatility_30d: z.number().nonnegative(),
  volatility_ratio: z.number().nonnegative(),
  trend_strength: z.number().min(0).max(1),
  trend_direction: z.number().min(-1).max(1),
  mean_reversion_distance: z.number(),
  days_since_high: z.number().int().nonnegative(),
  days_since_low: z.number().int().nonnegative(),
  streak_length: z.number().int(),
  seasonality_index: z.number(),
  momentum_rsi: z.number().min(0).max(100),
});

export const MarketFeaturesSchema = z.object({
  set_momentum: z.number(),
  rarity_momentum: z.number(),
  game_sentiment: z.number().min(-1).max(1),
  correlation_to_set: z.number().min(-1).max(1),
  correlation_to_rarity: z.number().min(-1).max(1),
  correlation_deviation: z.number(),
  liquidity_score: z.number().min(0).max(1),
  volume_relative: z.number().nonnegative(),
  inventory_signal: z.number().min(-1).max(1),
  market_cap_rank: z.number().int().positive(),
});

export const FxFeaturesSchema = z.object({
  jpy_gbp_current: z.number().positive(),
  fx_velocity_7d: z.number(),
  fx_volatility_7d: z.number().nonnegative(),
  fx_trend_direction: z.number().min(-1).max(1),
  fx_mean_reversion: z.number(),
});

export const DerivedFeaturesSchema = z.object({
  opportunity_score: z.number().min(0).max(1),
  risk_score: z.number().min(0).max(1),
  time_sensitivity: z.number().min(0).max(1),
});

export const FeatureVectorSchema = z.object({
  price: PriceFeaturesSchema,
  temporal: TemporalFeaturesSchema,
  market: MarketFeaturesSchema,
  fx: FxFeaturesSchema,
  derived: DerivedFeaturesSchema,
});

// ============================================================================
// PREDICTIONS & DEALS
// ============================================================================

export const DealActionSchema = z.object({
  type: ActionTypeSchema,
  buyMarket: z.string().optional(),
  buyPrice: z.number().positive().optional(),
  sellMarket: z.string().optional(),
  sellPrice: z.number().positive().optional(),
  targetPrice: z.number().positive().optional(),
});

export const DealMetadataSchema = z
  .object({
    featureImportance: z.record(z.string(), z.number()).optional(),
    dealTypeProbabilities: z.array(z.number()).optional(),
    sources: z.array(z.string()).optional(),
  })
  .passthrough();

export const DetectedDealSchema = z.object({
  cardId: z.string().min(1),
  cardName: z.string().min(1),
  dealType: DealTypeSchema,
  confidence: z.number().min(0).max(1),
  expectedReturn: z.number(),
  riskLevel: RiskLevelSchema,
  timeHorizon: TimeHorizonSchema,
  action: DealActionSchema,
  metadata: DealMetadataSchema,
  source: z.enum(["neural", "rule"]),
  expiresAt: z.date(),
});

export const DealPredictionSchema = z.object({
  dealType: DealTypeSchema,
  dealTypeProbabilities: z.array(z.number().min(0).max(1)),
  confidence: z.number().min(0).max(1),
  expectedReturn: z.number(),
  riskLevel: RiskLevelSchema,
  riskProbabilities: z.array(z.number().min(0).max(1)),
});

// ============================================================================
// API SCHEMAS
// ============================================================================

export const RateLimitInfoSchema = z.object({
  daily: z.number().int(),
  minute: z.number().int(),
  remaining: z.number().int().nonnegative(),
  resetAt: z.date(),
});

export const ApiPermissionsSchema = z.object({
  endpoints: z.array(z.string()),
  games: z.array(z.string()),
  maxHistoryDays: z.number().int().nonnegative(),
  bulkAccess: z.boolean(),
  webhooks: z.boolean(),
  streaming: z.boolean(),
  neuralAccess: z.boolean(),
});

export const ApiKeyAuthSchema = z.object({
  keyId: z.string(),
  tier: ApiTierSchema,
  rateLimit: RateLimitInfoSchema,
  permissions: ApiPermissionsSchema,
});

// ============================================================================
// PIPELINE CONFIGURATION
// ============================================================================

export const PipelineConfigSchema = z.object({
  minConfidence: z.number().min(0).max(1).default(0.5),
  minExpectedReturn: z.number().nonnegative().default(5),
  useNeuralNetwork: z.boolean().default(true),
  useRuleBasedDetectors: z.boolean().default(true),
  modelVersion: z.string().optional(),
});

export const PipelineResultSchema = z.object({
  deals: z.array(DetectedDealSchema),
  durationMs: z.number().int().nonnegative(),
  cardsProcessed: z.number().int().nonnegative(),
  dealsBySource: z.object({
    neural: z.number().int().nonnegative(),
    rule: z.number().int().nonnegative(),
  }),
  dealsByType: z.record(DealTypeSchema, z.number().int().nonnegative()),
});

// ============================================================================
// API REQUEST/RESPONSE SCHEMAS
// ============================================================================

/** Query params for deals endpoint */
export const DealsQuerySchema = z.object({
  game: GameShardSchema.optional().default("onepiece"),
  type: DealTypeSchema.optional(),
  minConfidence: z.coerce.number().min(0).max(1).optional(),
  minReturn: z.coerce.number().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

/** Query params for predictions endpoint */
export const PredictionsQuerySchema = z.object({
  game: GameShardSchema.optional().default("onepiece"),
});

/** API key creation request */
export const CreateApiKeyRequestSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  tier: ApiTierSchema.optional().default("free"),
  organization: z.string().max(200).optional(),
  allowedGames: z.array(z.string()).optional(),
});

/** API key update request */
export const UpdateApiKeyRequestSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  tier: ApiTierSchema.optional(),
  status: z.enum(["active", "suspended", "revoked"]).optional(),
  allowedEndpoints: z.array(z.string()).optional(),
  allowedGames: z.array(z.string()).optional(),
});

/** Webhook configuration request */
export const WebhookConfigSchema = z.object({
  url: z.string().url(),
  events: z.array(z.string()).min(1),
  cardIds: z.array(z.string()).optional(),
  games: z.array(z.string()).optional(),
  minPriceChange: z.number().optional(),
});

// ============================================================================
// TRAINING DATA SCHEMAS
// ============================================================================

export const TrainingOptionsSchema = z.object({
  epochs: z.number().int().positive().optional().default(100),
  batchSize: z.number().int().positive().optional().default(32),
  patience: z.number().int().positive().optional().default(10),
  learningRate: z.number().positive().optional().default(0.001),
  dropoutRate: z.number().min(0).max(0.9).optional().default(0.3),
});

export const TrainingLabelsSchema = z.object({
  dealType: z.array(z.array(z.number().min(0).max(1))),
  confidence: z.array(z.array(z.number().min(0).max(1))),
  expectedReturn: z.array(z.array(z.number())),
  riskLevel: z.array(z.array(z.number().min(0).max(1))),
});

export const ModelMetricsSchema = z.object({
  date: z.date(),
  totalPredictions: z.number().int().nonnegative(),
  accuracy: z.number().min(0).max(1),
  avgConfidence: z.number().min(0).max(1),
  avgPredictedReturn: z.number(),
  avgActualReturn: z.number(),
});

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

/**
 * Validate feature vector and return sanitized version.
 */
export function validateFeatureVector(data: unknown) {
  return FeatureVectorSchema.parse(data);
}

/**
 * Safely validate feature vector, returning null on failure.
 */
export function safeValidateFeatureVector(data: unknown) {
  const result = FeatureVectorSchema.safeParse(data);
  return result.success ? result.data : null;
}

/**
 * Validate detected deal and return sanitized version.
 */
export function validateDetectedDeal(data: unknown) {
  return DetectedDealSchema.parse(data);
}

/**
 * Validate API key auth context.
 */
export function validateApiKeyAuth(data: unknown) {
  return ApiKeyAuthSchema.parse(data);
}

/**
 * Validate deals query parameters.
 */
export function validateDealsQuery(params: Record<string, string | null>) {
  const parsed = Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== null)
  );
  return DealsQuerySchema.parse(parsed);
}

/**
 * Validate pipeline configuration.
 */
export function validatePipelineConfig(data: unknown) {
  return PipelineConfigSchema.parse(data);
}

/**
 * Validate training options.
 */
export function validateTrainingOptions(data: unknown) {
  return TrainingOptionsSchema.parse(data);
}

/**
 * Get validation error messages as a formatted string.
 */
export function formatValidationErrors(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    .join("; ");
}

// ============================================================================
// TYPE EXPORTS (inferred from schemas)
// ============================================================================

export type ValidatedDealType = z.infer<typeof DealTypeSchema>;
export type ValidatedFeatureVector = z.infer<typeof FeatureVectorSchema>;
export type ValidatedDetectedDeal = z.infer<typeof DetectedDealSchema>;
export type ValidatedApiKeyAuth = z.infer<typeof ApiKeyAuthSchema>;
export type ValidatedDealsQuery = z.infer<typeof DealsQuerySchema>;
export type ValidatedPipelineConfig = z.infer<typeof PipelineConfigSchema>;
export type ValidatedTrainingOptions = z.infer<typeof TrainingOptionsSchema>;
