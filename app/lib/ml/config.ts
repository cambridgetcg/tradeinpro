/**
 * ML Module Configuration
 *
 * Centralized configuration for all ML models and infrastructure.
 */

import type { AWSConfig, ModelDeploymentConfig, ModelEnvironment } from "./types";

// =============================================================================
// ENVIRONMENT DETECTION
// =============================================================================

/**
 * Determine the model execution environment
 */
export function getModelEnvironment(): ModelEnvironment {
  // Check for AWS environment
  if (process.env.AWS_EXECUTION_ENV || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    return "aws";
  }

  // Explicit environment override
  if (process.env.ML_ENVIRONMENT === "aws") {
    return "aws";
  }

  return "local";
}

// =============================================================================
// AWS CONFIGURATION
// =============================================================================

export const AWS_CONFIG: AWSConfig = {
  region: process.env.AWS_REGION || "us-east-1",

  s3: {
    dataBucket: process.env.ML_DATA_BUCKET || "tcg-ml-data",
    modelBucket: process.env.ML_MODEL_BUCKET || "tcg-ml-models",
  },

  sagemaker: {
    visionEndpoint: process.env.SAGEMAKER_VISION_ENDPOINT,
    demandEndpoint: process.env.SAGEMAKER_DEMAND_ENDPOINT,
    timingEndpoint: process.env.SAGEMAKER_TIMING_ENDPOINT,
  },

  lambda: {
    qualityFunction: process.env.LAMBDA_QUALITY_FUNCTION,
    anomalyFunction: process.env.LAMBDA_ANOMALY_FUNCTION,
  },
};

// =============================================================================
// MODEL PATHS (Local Development)
// =============================================================================

export const LOCAL_MODEL_PATHS = {
  vision: process.env.ML_VISION_MODEL_PATH || "./models/vision",
  demand: process.env.ML_DEMAND_MODEL_PATH || "./models/demand",
  quality: process.env.ML_QUALITY_MODEL_PATH || "./models/quality",
  timing: process.env.ML_TIMING_MODEL_PATH || "./models/timing",
  anomaly: process.env.ML_ANOMALY_MODEL_PATH || "./models/anomaly",
};

// =============================================================================
// DEPLOYMENT CONFIGURATION
// =============================================================================

export function getDeploymentConfig(): ModelDeploymentConfig {
  const environment = getModelEnvironment();

  return {
    environment,
    aws: environment === "aws" ? AWS_CONFIG : undefined,
    localModelPaths: environment === "local" ? LOCAL_MODEL_PATHS : undefined,
  };
}

// =============================================================================
// FEATURE ENGINEERING CONFIGURATION
// =============================================================================

/**
 * Configuration for demand forecasting features
 */
export const DEMAND_FEATURE_CONFIG = {
  // Time windows for feature calculation
  windows: {
    short: 7,
    medium: 30,
    long: 90,
    yearly: 365,
  },

  // RSI configuration
  rsi: {
    period: 14,
    overbought: 70,
    oversold: 30,
  },

  // MACD configuration
  macd: {
    fastPeriod: 12,
    slowPeriod: 26,
    signalPeriod: 9,
  },

  // Volatility thresholds
  volatility: {
    lowThreshold: 0.05,
    highThreshold: 0.20,
  },

  // Market phase thresholds
  marketPhase: {
    accumulationThreshold: -0.1,
    markupThreshold: 0.1,
    distributionThreshold: 0.2,
  },
};

/**
 * Configuration for quality scoring features
 */
export const QUALITY_FEATURE_CONFIG = {
  // Price deviation thresholds
  price: {
    suspiciouslyLowThreshold: -0.30, // 30% below market
    suspiciouslyHighThreshold: 0.50, // 50% above market
  },

  // Seller thresholds
  seller: {
    newAccountDays: 30,
    lowFeedbackThreshold: 95,
    highVelocityThreshold: 20, // listings per day
  },

  // Listing quality thresholds
  listing: {
    minDescriptionLength: 50,
    minPhotoCount: 1,
  },

  // High value threshold (for extra scrutiny)
  highValueThreshold: 50.0, // USD
};

/**
 * Configuration for anomaly detection
 */
export const ANOMALY_FEATURE_CONFIG = {
  // Z-score thresholds
  zScore: {
    anomalyThreshold: 2.5,
    severeAnomalyThreshold: 3.5,
  },

  // Cross-market spread thresholds
  crossMarket: {
    normalSpread: 0.10, // 10%
    anomalousSpread: 0.25, // 25%
    arbitrageOpportunity: 0.15, // 15% after costs
  },

  // Isolation Forest parameters
  isolationForest: {
    nEstimators: 100,
    maxSamples: "auto" as const,
    contamination: 0.05,
    randomState: 42,
  },
};

/**
 * Configuration for timing optimizer
 */
export const TIMING_FEATURE_CONFIG = {
  // Forecast horizon
  forecast: {
    defaultDays: 90,
    maxDays: 365,
  },

  // Seasonal patterns
  seasonality: {
    weeklyFourierOrder: 3,
    monthlyFourierOrder: 5,
    yearlyFourierOrder: 10,
  },

  // TCG-specific events (affects pricing)
  events: {
    // Set release impact
    setReleaseImpact: {
      before: { days: 7, effect: 0.95 },
      after: { days: 14, effect: 1.15 },
    },

    // Tournament season
    tournamentSeason: {
      peakMonths: [3, 4, 8, 9], // March-April, August-September
      effect: 1.10,
    },

    // Holiday effects
    holidays: {
      christmas: { month: 12, days: [20, 31], effect: 1.25 },
      blackFriday: { month: 11, days: [25, 30], effect: 1.15 },
      goldenWeek: { month: 5, days: [1, 7], effect: 0.90 }, // Japan - good buy
      obon: { month: 8, days: [13, 16], effect: 0.92 }, // Japan - good buy
    },
  },
};

// =============================================================================
// VISION MODEL CONFIGURATION
// =============================================================================

export const VISION_CONFIG = {
  // Image preprocessing
  image: {
    targetSize: 224,
    normalize: {
      mean: [0.485, 0.456, 0.406], // ImageNet mean
      std: [0.229, 0.224, 0.225], // ImageNet std
    },
  },

  // Model architecture
  architecture: {
    backbone: "efficientnet-b4",
    pretrainedWeights: "imagenet",
  },

  // Output heads
  heads: {
    cardId: { classes: 10000 }, // Expandable
    condition: { classes: 5 }, // NM, LP, MP, HP, DMG
    language: { classes: 9 }, // EN, JP, DE, FR, IT, ES, PT, KO, ZH
    variant: { classes: 10 }, // regular, parallel, sp, etc.
    authenticity: { classes: 2 }, // real, fake
  },

  // Confidence thresholds
  confidence: {
    cardMatch: 0.85,
    condition: 0.75,
    language: 0.90,
    authenticity: 0.95,
  },
};

// =============================================================================
// COST CALCULATION CONFIGURATION
// =============================================================================

/**
 * Platform fee structures
 */
export const PLATFORM_FEES: Record<string, { seller: number; buyer: number; fixed?: number }> = {
  tcgplayer: { seller: 0.1025, buyer: 0, fixed: 0.30 },
  cardmarket: { seller: 0.05, buyer: 0 },
  ebay: { seller: 0.1325, buyer: 0, fixed: 0.30 },
  ebay_uk: { seller: 0.1325, buyer: 0, fixed: 0.30 },
  yahoo_jp: { seller: 0.10, buyer: 0 },
  mercari_jp: { seller: 0.10, buyer: 0 },
  cardtrader: { seller: 0.05, buyer: 0 },
};

/**
 * Shipping costs by route (GBP)
 */
export const SHIPPING_COSTS: Record<string, Record<string, { standard: number; tracked: number }>> = {
  UK: {
    UK: { standard: 1.5, tracked: 4.0 },
    US: { standard: 3.5, tracked: 12.0 },
    EU: { standard: 3.0, tracked: 8.0 },
    JP: { standard: 5.0, tracked: 15.0 },
  },
  US: {
    UK: { standard: 5.0, tracked: 15.0 },
    US: { standard: 0.78, tracked: 4.0 },
    EU: { standard: 5.0, tracked: 15.0 },
    JP: { standard: 6.0, tracked: 18.0 },
  },
  EU: {
    UK: { standard: 3.0, tracked: 8.0 },
    US: { standard: 5.0, tracked: 15.0 },
    EU: { standard: 1.5, tracked: 5.0 },
    JP: { standard: 6.0, tracked: 18.0 },
  },
  JP: {
    UK: { standard: 8.0, tracked: 25.0 },
    US: { standard: 8.0, tracked: 22.0 },
    EU: { standard: 8.0, tracked: 25.0 },
    JP: { standard: 1.5, tracked: 4.0 },
  },
};

/**
 * Import thresholds and VAT rates
 */
export const IMPORT_CONFIG: Record<string, { vatRate: number; dutyFreeThreshold: number }> = {
  UK: { vatRate: 0.20, dutyFreeThreshold: 135 },
  US: { vatRate: 0, dutyFreeThreshold: 800 },
  EU: { vatRate: 0.19, dutyFreeThreshold: 150 }, // Average EU rate
  JP: { vatRate: 0.10, dutyFreeThreshold: 10000 }, // JPY
};

/**
 * Proxy service fees for Japanese markets
 */
export const PROXY_FEES = {
  buyee: { percentage: 0.05, fixed: 300 }, // JPY
  fromjapan: { percentage: 0.05, fixed: 0 },
  zenmarket: { percentage: 0, fixed: 300 },
  jdirectitems: { percentage: 0.10, fixed: 0 },
};

/**
 * Currency conversion fees
 */
export const CURRENCY_FEES = {
  bank: 0.03, // 3%
  wise: 0.005, // 0.5%
  paypal: 0.04, // 4%
};

// =============================================================================
// CONDITION MULTIPLIERS
// =============================================================================

/**
 * Price multipliers by condition (relative to NM)
 */
export const CONDITION_MULTIPLIERS: Record<string, number> = {
  NM: 1.0,
  LP: 0.85,
  MP: 0.70,
  HP: 0.50,
  DMG: 0.25,
};

/**
 * Grading premiums (PSA grade to multiplier vs raw NM)
 */
export const GRADING_PREMIUMS: Record<number, number> = {
  10: 5.0, // PSA 10 = 5x raw NM
  9: 2.0, // PSA 9 = 2x raw NM
  8: 1.3,
  7: 1.0,
  6: 0.8,
};

// =============================================================================
// MODEL VERSION TRACKING
// =============================================================================

export const MODEL_VERSIONS = {
  vision: "1.0.0",
  demand: "1.0.0",
  quality: "1.0.0",
  timing: "1.0.0",
  anomaly: "1.0.0",
  orchestrator: "1.0.0",
};

// =============================================================================
// PERFORMANCE CONFIGURATION
// =============================================================================

export const PERFORMANCE_CONFIG = {
  // Inference timeouts (ms)
  timeout: {
    vision: 5000,
    demand: 1000,
    quality: 500,
    timing: 2000,
    anomaly: 500,
    orchestrator: 10000,
  },

  // Batch sizes
  batchSize: {
    vision: 8, // Limited by GPU memory
    demand: 100,
    quality: 100,
    timing: 50,
    anomaly: 100,
  },

  // Cache TTL (seconds)
  cacheTTL: {
    features: 300, // 5 minutes
    predictions: 60, // 1 minute
    marketData: 3600, // 1 hour
  },
};
