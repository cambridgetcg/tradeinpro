/**
 * CardMarket Data Collection Pipeline
 *
 * Complete data collection system for TCG price data:
 * - Multi-source price collection (OPTCG, JustTCG, Cardmarket)
 * - FX rate conversion
 * - Price aggregation and arbitrage detection
 * - Scheduled collection jobs
 * - Training data export for ML models
 */

// =============================================================================
// TYPES
// =============================================================================

export type {
  // OPTCG Types
  OPTCGCard,
  OPTCGCardWithHistory,
  OPTCGSet,

  // JustTCG Types
  JustTCGGame,
  JustTCGSet,
  JustTCGCard,
  JustTCGVariant,
  JustTCGStatistics,
  JustTCGPricePoint,
  JustTCGPriceHistoryDuration,
  JustTCGSearchParams,

  // Cardmarket Types
  CardmarketCSVRow,

  // FX Rate Types
  FXRates,
  FXRateResponse,

  // Aggregated Price Types
  AggregatedPrice,
  ArbitrageDetectionInput,
  ArbitrageDetectionResult,

  // Job Types
  CollectionJobConfig,
  CollectionJobResult,

  // Training Data Types
  ArbitrageTrainingExample,
  TFTTrainingSequence,
  DemandTrainingExample,
} from "./types";

// =============================================================================
// CLIENTS
// =============================================================================

export {
  // OPTCG Client
  OPTCGClient,
  getOPTCGClient,
  extractPriceHistory,
  normalizeOPTCGCardId,

  // JustTCG Client
  JustTCGClient,
  getJustTCGClient,
  resetJustTCGClient,
  convertPriceHistory,
  normalizeJustTCGCardId,
  JUSTTCG_RATE_LIMITS,

  // FX Rate Client
  FXRateClient,
  getFXRateClient,
  resetFXRateClient,
  usdToGbp,
  eurToGbp,
  jpyToGbp,
  gbpToUsd,
  gbpToEur,
  convertFromGbp,
  inverseRate,

  // Cardmarket CSV Parser
  parseCardmarketCSV,
  parseCardmarketCSVFile,
  fetchCardmarketPriceGuide,
  expansionToSetCode,
  normalizeCardName,
  extractCardNumber,
  matchCardmarketToCardId,
  groupByExpansion,
  calculateCSVStats,
  filterByMinPrice,
  sortRows,
} from "./clients";

export type { ParseOptions, ParseResult } from "./clients";

// =============================================================================
// SERVICES
// =============================================================================

export {
  // Price Aggregator
  aggregatePrices,
  processAndStorePrices,
  detectArbitrage,

  // Collection Jobs
  JOB_CONFIGS,
  getJobState,
  getAllJobStates,
  runOPTCGSync,
  runJustTCGFullRefresh,
  runJustTCGTopMovers,
  runFXRatesRefresh,
  processCardmarketCSV,
  runArbitrageDetection,
  startScheduledJob,
  stopScheduledJob,
  stopAllScheduledJobs,
  getRunningJobs,
  initializeScheduledJobs,
} from "./services";

export type { AggregationOptions, AggregationResult } from "./services";

// =============================================================================
// TRAINING DATA EXPORT
// =============================================================================

export {
  // Export functions
  exportArbitrageTrainingData,
  exportTFTTrainingSequences,
  exportDemandTrainingData,

  // Export formats
  exportToJSON,
  exportToJSONL,
  exportArbitrageToCSV,
  exportDemandToCSV,
} from "./training";

export type {
  ArbitrageExportOptions,
  TFTExportOptions,
  DemandExportOptions,
} from "./training";
