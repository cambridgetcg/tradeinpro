/**
 * ML Data Module
 *
 * Connects data collection pipeline to ML models
 */

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
} from "./pipeline-connector.server";
