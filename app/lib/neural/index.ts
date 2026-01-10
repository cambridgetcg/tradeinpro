/**
 * Neural Network Deal Identification System
 *
 * Main entry point for the neural network module.
 * Re-exports all public APIs for easy consumption.
 */

// Types
export * from "./types";

// Feature Engineering
export {
  FeatureCalculator,
  FeatureNormalizer,
  calculateFeaturesInBatch,
  flattenFeatureVector,
  getFeatureNames,
} from "./features.server";

// Deal Detection Pipeline
export {
  DealDetectionPipeline,
  // Original 4 detectors
  CrossMarketArbitrageDetector,
  StatisticalUndervalueDetector,
  MomentumBreakoutDetector,
  SupplyShockDetector,
  // New 6 detectors
  CurrencyArbitrageDetector,
  CorrelationBreakDetector,
  SeasonalOpportunityDetector,
  DemandSurgeDetector,
  MomentumReversalDetector,
  ComparativeUndervalueDetector,
  detectors,
} from "./pipeline.server";
export type { RuleBasedDetector } from "./pipeline.server";

// Neural Model Service
export {
  NeuralModelService,
  getModelService,
  initializeModel,
  trackPrediction,
  recordOutcome,
  getModelMetrics,
} from "./model.server";
export type { TrainingResult, ModelMetadata } from "./model.server";

// API Authentication
export {
  authenticateRequest,
  recordApiUsage,
  createApiKey,
  revokeApiKey,
  updateApiKeyTier,
  getApiKeyStats,
  hasEndpointAccess,
  hasGameAccess,
  hasHistoryAccess,
  requiresNeuralAccess,
  generateApiKey,
  hashApiKey,
  ApiAuthError,
} from "./api-auth.server";

// Pipeline Cache
export {
  PipelineCache,
  getPipelineCache,
  resetPipelineCache,
} from "./cache.server";

// Validation Schemas
export {
  // Schemas
  DealTypeSchema,
  TimeHorizonSchema,
  RiskLevelSchema,
  ActionTypeSchema,
  FeatureVectorSchema,
  DetectedDealSchema,
  PipelineConfigSchema,
  DealsQuerySchema,
  CreateApiKeyRequestSchema,
  TrainingOptionsSchema,
  // Validation helpers
  validateFeatureVector,
  safeValidateFeatureVector,
  validateDetectedDeal,
  validateApiKeyAuth,
  validateDealsQuery,
  validatePipelineConfig,
  validateTrainingOptions,
  formatValidationErrors,
} from "./validation.server";
