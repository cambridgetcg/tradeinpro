/**
 * TCG Neural Network Module
 *
 * Biological neural network metaphor for TCG data pipeline.
 * Exports all neurons, types, and the main network orchestrator.
 */

// =============================================================================
// TYPES
// =============================================================================

export * from './types';

// =============================================================================
// BASE NEURON
// =============================================================================

export { BaseNeuron, NeuronOptions, NeuronStatus } from './base-neuron';

// =============================================================================
// SENSORY LAYER
// =============================================================================

export {
  CardMarketReceptorNeuron,
  CardMarketScrapeResult,
  ReceptorConfig,
} from './sensory/cardmarket-receptor';

export {
  EbayReceptorNeuron,
  EbayReceptorConfig,
  SerpApiEbayResponse,
  SerpApiEbayItem,
  FXRateProvider as EbayFXRateProvider,
} from './sensory/ebay-receptor';

// SerpAPI Alchemist Module
export {
  // Title Parser (Four Elements)
  TitleParser,
  ParsedTitle,
  VariantType as SerpApiVariantType,
  LanguageCode,
  shouldExclude,
  getDedupeKey,
  titleParser,
  // Target Cards (Sacred Registry)
  TargetCard,
  TargetCardRegistry,
  PriorityTier,
  QueryTarget,
  CRITICAL_GAPS,
  ALL_TARGET_CARDS,
  targetCardRegistry,
  // SerpAPI Client (Alchemist's Cauldron)
  SerpApiClient,
  SerpApiConfig,
  SerpApiQuery,
  SerpApiResponse,
  EbaySoldResult,
  ProcessedListing,
  QueryResult,
  createSerpApiClient,
  // Query Orchestrator (Grand Scheduler)
  QueryOrchestrator,
  OrchestratorConfig,
  ScheduleWindow,
  CollectionBatch,
  BatchStats,
  DailyReport,
  createQueryOrchestrator,
  getOrchestrator,
  // eBay Receptor Bridge
  EbayReceptorBridgeNeuron,
  BridgeConfig,
  BridgeOutput,
  createEbayReceptorBridge,
  // Quick Start
  startSerpApiCollection,
  runManualCollection,
} from './sensory/serpapi';

// CardMarket Alchemist Module
export {
  // Target Cards (Sacred Registry)
  CardMarketTarget,
  SetInfo,
  PriorityTier as CardMarketPriorityTier,
  CardMarketVariantType,
  ONE_PIECE_SETS,
  ALL_CARDMARKET_TARGETS,
  CardMarketTargetRegistry,
  cardMarketTargetRegistry,
  // URL Builder (Sacred URL Codex)
  UrlConfig,
  CardUrl,
  CardMarketUrlBuilder,
  cardMarketUrlBuilder,
  buildCardUrl as buildCardMarketUrl,
  buildExpansionUrl as buildCardMarketExpansionUrl,
  // Scrape Orchestrator (Transmutation Schedule)
  ScrapeScheduleWindow,
  ScrapeJob,
  ScrapeJobResult,
  ScrapeSessionStats,
  OrchestratorState,
  CardMarketOrchestratorConfig,
  CardMarketScrapeOrchestrator,
  createCardMarketOrchestrator,
  getCardMarketOrchestrator,
  // Quick Start
  startCardMarketCollection,
  scrapeCard,
  getAllExpansionUrls,
  parseCardMarketUrl,
  CARDMARKET_MODULE,
  printCardMarketModuleInfo,
  // Data Parser (Four Cardinal Essences)
  ParsedCardMarketData,
  CardMarketVariant,
  CardMarketLanguage,
  CardMarketCondition,
  RawCardMarketScrape,
  CardMarketDataParser,
  cardMarketDataParser,
  hasValidPricing,
  shouldExcludeFromTraining,
  getCardMarketDedupeKey,
  getBestPrice,
  convertEurToUsd,
  getPriceSpread,
} from './sensory/cardmarket';

export {
  VisualCortexReceptorNeuron,
  VisualCortexConfig,
  ImageInput,
  VisualCardSignal,
  DefectLocation,
  EmbryonicStage,
} from './sensory/visual-cortex-receptor';

// =============================================================================
// INTERNEURON LAYER
// =============================================================================

export {
  PriceTransformerNeuron,
  PriceTransformerConfig,
  FXRateProvider,
} from './interneuron/price-transformer';

export {
  NormalizationScalerNeuron,
  NormalizationStats,
  NormalizationConfig,
  RawFeatureVector,
  NormalizedFeatureVector,
} from './interneuron/normalization-scaler';

// =============================================================================
// CORTICAL LAYER
// =============================================================================

export {
  LSTMPredictorNeuron,
  LSTMPredictorConfig,
  SequenceInput,
  LSTMOutput,
} from './cortical/lstm-predictor';

export {
  EnsembleOrchestratorNeuron,
  EnsembleConfig,
  ModelPrediction,
  EnsembleInput,
  EnsembleOutput,
  ModelContribution,
} from './cortical/ensemble-orchestrator';

// =============================================================================
// MOTOR LAYER
// =============================================================================

export {
  RDSWriterNeuron,
  RDSWriterConfig,
  WriteResult,
  PrismaClient,
} from './motor/rds-writer';

export {
  S3UploaderNeuron,
  S3UploaderConfig,
  UploadRequest,
  TrainingData,
  TrainingExample,
  TrainingMetadata,
  UploadResult,
  S3Client,
} from './motor/s3-uploader';

// =============================================================================
// NEURAL NETWORK
// =============================================================================

export {
  TCGNeuralNetwork,
  NetworkConfig,
  NeuronRegistry,
  createNeuralNetwork,
} from './network';

// =============================================================================
// MYELIN SHEATHS
// =============================================================================

export {
  V2V3_ENGLISH_ONLY,
  CLOUDFLARE_BYPASS,
  FX_RATE_CACHE,
  BATCH_DB_WRITES,
  PRECOMPUTED_NORMALIZATION,
  KNOWN_CARD_PATTERNS,
  RATE_LIMIT_AWARENESS,
  HISTORICAL_WINDOW,
  S3_PARTITION_PREFIX,
  GZIP_COMPRESSION,
  ALL_MYELIN_SHEATHS,
  SHEATHS_BY_LOCATION,
  calculateTotalSpeedup,
  getCacheStats,
  applyMyelinSheaths,
  printMyelinSummary,
} from './myelin-sheaths';

// =============================================================================
// NEUROTRANSMITTERS & ION CHANNELS
// =============================================================================

export {
  createNeurotransmitter,
  releaseDopamine,
  shouldReleaseDopamine,
  releaseSerotonin,
  shouldReleaseSerotonin,
  releaseAcetylcholine,
  releaseGABA,
  shouldReleaseGABA,
  releaseGlutamate,
  shouldReleaseGlutamate,
  releaseNorepinephrine,
  createIonChannel,
  createSodiumChannel,
  createPotassiumChannel,
  createCalciumChannel,
  createChlorideChannel,
  classifySignal,
  getNeurotransmitterInfo,
  printNeurotransmitterSummary,
  DopaminePayload,
  SerotoninPayload,
  AcetylcholinePayload,
  GABAPayload,
  GlutamatePayload,
  NorepinephrinePayload,
} from './neurotransmitters';

// =============================================================================
// NUTRITION MODULE
// =============================================================================

export {
  RawCardImage,
  CardLabels,
  ConditionLabel,
  RarityLabel,
  VariantLabel,
  LanguageLabel,
  DefectAnnotation,
  CardContext,
  TrainingNutrient,
  VitaminConfig,
  MineralConfig,
  NutrientPipeline,
  ProcessedNutrient,
  AugmentedImage,
  MineralFeatures,
  NutritionalBalance,
  DatasetNutrition,
} from './nutrition';

// =============================================================================
// QUICK START UTILITY
// =============================================================================

import { createNeuralNetwork, NetworkConfig } from './network';

/**
 * Quick start: Create and initialize a full neural network
 *
 * @example
 * ```typescript
 * import { quickStart } from './neural';
 *
 * const network = await quickStart();
 * // Network is ready to process signals
 *
 * const cardmarket = network.neurons.sensory?.cardmarket;
 * // Process scrape results through the network
 * ```
 */
export async function quickStart(
  config: Partial<NetworkConfig> = {}
): Promise<ReturnType<typeof createNeuralNetwork>> {
  console.log('🚀 Quick starting TCG Neural Network...\n');
  return createNeuralNetwork(config);
}
