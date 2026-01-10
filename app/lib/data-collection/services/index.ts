/**
 * Data Collection Services
 *
 * High-level services for price aggregation and scheduled jobs
 */

// Price Aggregator
export {
  aggregatePrices,
  processAndStorePrices,
  detectArbitrage,
} from "./price-aggregator.server";

export type {
  AggregationOptions,
  AggregationResult,
} from "./price-aggregator.server";

// Collection Jobs
export {
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
} from "./collection-jobs.server";
