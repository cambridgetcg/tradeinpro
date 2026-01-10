/**
 * ML Module - Modular Machine Learning System for TCG Arbitrage
 *
 * This module provides 15 specialized ML models across 6 layers:
 *
 * LAYER 1: PERCEPTION
 * - **Vision (CNN)**: Card image recognition, condition grading, authenticity
 * - **Vision Transformer (ViT)**: [AWAITING TRAINING] Enhanced card identification
 *
 * LAYER 2: EVALUATION
 * - **Quality**: Logistic regression listing quality scoring
 * - **Seller Risk**: [AWAITING TRAINING] Counterparty risk assessment
 *
 * LAYER 3: PREDICTION
 * - **Demand (XGBoost)**: Price movement prediction (speculation)
 * - **TFT**: [AWAITING TRAINING] Multi-horizon Temporal Fusion Transformer
 * - **GNN**: [AWAITING TRAINING] Graph Neural Network for market topology
 * - **Timing (Prophet)**: Time series optimal buy/sell timing
 *
 * LAYER 4: ANOMALY & OPPORTUNITY
 * - **Anomaly (Isolation Forest)**: Price anomaly detection
 * - **Arbitrage Detector**: [NEW] Cross-market spread analysis
 *
 * LAYER 5: EXECUTION OPTIMIZATION
 * - Position sizing, market simulation (planned)
 *
 * LAYER 6: META-LEARNING
 * - **Stacking Meta-Learner**: [AWAITING BASE MODELS] Ensemble combination
 * - **Orchestrator**: Combines all models for unified analysis
 *
 * Architecture Philosophy:
 * - Neural networks for images (what they're good at)
 * - XGBoost for tabular data (beats NNs on structured data)
 * - Specialized algorithms for specialized tasks
 *
 * @see docs/AI_MODELS_FOR_TCG_ARBITRAGE.md for complete model specifications
 *
 * @example
 * ```typescript
 * import { getOrchestrator } from "~/lib/ml";
 *
 * const orchestrator = getOrchestrator();
 * await orchestrator.initialize();
 *
 * const result = await orchestrator.analyze({
 *   listing: {
 *     id: "123",
 *     platform: "tcgplayer",
 *     title: "OP01-121 Roronoa Zoro Parallel",
 *     price: 45.00,
 *     currency: "USD",
 *     imageUrls: ["https://example.com/card.jpg"],
 *   },
 *   userContext: {
 *     region: "UK",
 *   },
 * });
 *
 * console.log(result.recommendation.action); // "buy" | "avoid" | "monitor"
 * console.log(result.deal?.type); // "arbitrage" | "speculation" | "timing"
 * ```
 */

// =============================================================================
// TYPES
// =============================================================================

export * from "./types";

// =============================================================================
// CONFIGURATION
// =============================================================================

export {
  getModelEnvironment,
  getDeploymentConfig,
  AWS_CONFIG,
  LOCAL_MODEL_PATHS,
  DEMAND_FEATURE_CONFIG,
  QUALITY_FEATURE_CONFIG,
  ANOMALY_FEATURE_CONFIG,
  TIMING_FEATURE_CONFIG,
  VISION_CONFIG,
  PLATFORM_FEES,
  SHIPPING_COSTS,
  IMPORT_CONFIG,
  CONDITION_MULTIPLIERS,
  GRADING_PREMIUMS,
  MODEL_VERSIONS,
  PERFORMANCE_CONFIG,
} from "./config";

// =============================================================================
// BASE CLASSES
// =============================================================================

export {
  BaseModel,
  BaseFeatureExtractor,
  ModelRegistry,
  ModelCache,
  zScore,
  percentileRank,
  calculateRSI,
  calculateMACD,
  calculateEMA,
  standardDeviation,
  percentChange,
  normalize,
  clip,
} from "./base.server";

// =============================================================================
// VISION MODEL
// =============================================================================

export {
  VisionModel,
  getVisionModel,
  resetVisionModel,
} from "./vision";

export {
  loadImage,
  preprocessImage,
  normalizePixels,
  flattenTensor,
  analyzeImageQuality,
  extractCorners,
  extractEdges,
} from "./vision/preprocessor.server";

// =============================================================================
// VISION TRANSFORMER (NEW - AWAITING TRAINING)
// =============================================================================

export {
  VisionTransformerModel,
  getVisionTransformerModel,
  resetVisionTransformerModel,
  VIT_CONFIG,
  calculateTrainingReadiness as calculateVitTrainingReadiness,
  type ViTTrainingExample,
  type ViTTrainingStats,
} from "./vision/vit.server";

// =============================================================================
// DEMAND FORECASTING MODEL
// =============================================================================

export {
  DemandModel,
  getDemandModel,
  resetDemandModel,
} from "./demand";

export {
  DemandFeatureExtractor,
  getDemandFeatureExtractor,
  type CardPriceHistory,
  type CardMetadata,
  type MarketContext,
  type ExternalSignals,
  type DemandRawData,
} from "./demand/features.server";

// =============================================================================
// TEMPORAL FUSION TRANSFORMER (NEW - AWAITING TRAINING)
// =============================================================================

export {
  TemporalFusionTransformerModel,
  getTemporalFusionTransformer,
  resetTemporalFusionTransformer,
  TFT_CONFIG,
  calculateTFTTrainingReadiness,
  type TFTInput,
  type TFTOutput,
  type TFTTrainingExample,
  type TFTTrainingStats,
} from "./demand/tft.server";

// =============================================================================
// QUALITY SCORING MODEL
// =============================================================================

export {
  QualityModel,
  getQualityModel,
  resetQualityModel,
  extractQualityFeatures,
  type ListingForQuality,
  type QualityContext,
} from "./quality";

// =============================================================================
// ANOMALY DETECTION MODEL
// =============================================================================

export {
  AnomalyModel,
  getAnomalyModel,
  resetAnomalyModel,
  extractAnomalyFeatures,
  type ListingForAnomaly,
  type MarketStats,
} from "./anomaly";

// =============================================================================
// CROSS-MARKET ARBITRAGE DETECTOR (NEW)
// =============================================================================

export {
  CrossMarketArbitrageDetector,
  getCrossMarketArbitrageDetector,
  resetCrossMarketArbitrageDetector,
  ARBITRAGE_CONFIG,
  type ArbitrageInput,
  type ArbitrageOutput,
  type ArbitrageOpportunity,
  type MarketPrice,
  type CostBreakdown,
} from "./anomaly/arbitrage.server";

// =============================================================================
// TIMING OPTIMIZER MODEL
// =============================================================================

export {
  TimingModel,
  getTimingModel,
  resetTimingModel,
} from "./timing";

// =============================================================================
// GRAPH NEURAL NETWORK (NEW - AWAITING TRAINING)
// =============================================================================

export {
  GraphNeuralNetworkModel,
  getGraphNeuralNetwork,
  resetGraphNeuralNetwork,
  GNN_CONFIG,
  calculateGNNTrainingReadiness,
  type Graph,
  type GraphNode,
  type GraphEdge,
  type GNNPrediction,
  type GNNTrainingData,
  type GNNTrainingStats,
} from "./graph/gnn.server";

// =============================================================================
// STACKING META-LEARNER (NEW - AWAITING BASE MODEL OUTPUTS)
// =============================================================================

export {
  StackingMetaLearner,
  getStackingMetaLearner,
  resetStackingMetaLearner,
  STACKING_CONFIG,
  calculateStackingTrainingReadiness,
  type StackingInput,
  type StackingOutput,
  type BaseModelPredictions,
  type StackingTrainingExample,
  type StackingTrainingStats,
} from "./meta/stacking.server";

// =============================================================================
// DATA PIPELINE CONNECTOR
// =============================================================================

export {
  // Arbitrage model connectors
  toArbitrageInput,
  toArbitrageInputBatch,
  fromDataCollectionArbitrage,

  // TFT model connectors
  toTFTInput,
  toTFTInputBatch,

  // Demand model connectors
  toDemandModelInput,
  toDemandModelInputBatch,

  // Feature engineering
  calculateRollingStats,
  calculateMomentum,
  calculateSpreadFeatures,

  // Data validation
  validateAggregatedPrice,
  cleanAggregatedPrices,
} from "./data";

// =============================================================================
// ORCHESTRATOR
// =============================================================================

export {
  MLOrchestrator,
  getOrchestrator,
  resetOrchestrator,
} from "./orchestrator";

// =============================================================================
// CONVENIENCE FUNCTIONS
// =============================================================================

/**
 * Initialize all ML models
 */
export async function initializeML(): Promise<void> {
  const { getOrchestrator } = await import("./orchestrator");
  const orchestrator = getOrchestrator();
  await orchestrator.initialize();
}

/**
 * Get status of all ML models
 */
export function getMLStatus(): ReturnType<import("./orchestrator").MLOrchestrator["getStatus"]> {
  const { getOrchestrator } = require("./orchestrator");
  return getOrchestrator().getStatus();
}

/**
 * Analyze a listing using all models
 */
export async function analyzeListing(
  request: import("./types").AnalysisRequest
): Promise<import("./types").AnalysisResult> {
  const { getOrchestrator } = await import("./orchestrator");
  const orchestrator = getOrchestrator();

  if (!orchestrator.getStatus().isInitialized) {
    await orchestrator.initialize();
  }

  return orchestrator.analyze(request);
}
