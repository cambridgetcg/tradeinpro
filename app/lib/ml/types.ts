/**
 * ML Module Type Definitions
 *
 * Core types for the modular ML architecture.
 * Each specialized model has its own input/output types.
 */

// =============================================================================
// COMMON TYPES
// =============================================================================

/**
 * Model execution environment
 */
export type ModelEnvironment = "local" | "aws";

/**
 * Model status for health checks
 */
export interface ModelStatus {
  name: string;
  version: string;
  environment: ModelEnvironment;
  isLoaded: boolean;
  lastInference: Date | null;
  inferenceCount: number;
  averageLatencyMs: number;
  errorRate: number;
}

/**
 * Base prediction result with confidence
 */
export interface BasePrediction {
  confidence: number; // 0-1
  modelVersion: string;
  inferenceTimeMs: number;
  timestamp: Date;
}

/**
 * Card identifier used across all models
 */
export interface CardIdentifier {
  cardId: string;
  name?: string;
  setCode?: string;
  cardNumber?: string;
  variantType?: string;
  language?: CardLanguage;
}

/**
 * Supported card languages
 */
export type CardLanguage = "EN" | "JP" | "DE" | "FR" | "IT" | "ES" | "PT" | "KO" | "ZH";

/**
 * Card condition grades
 */
export type CardCondition = "NM" | "LP" | "MP" | "HP" | "DMG";

/**
 * Variant types
 */
export type VariantType =
  | "regular"
  | "parallel"
  | "sp"
  | "manga"
  | "boxtopper"
  | "spr"
  | "tr"
  | "wantedposter"
  | "dashpack"
  | "promo";

/**
 * Trading platforms
 */
export type Platform =
  | "tcgplayer"
  | "cardmarket"
  | "ebay"
  | "ebay_uk"
  | "ebay_de"
  | "yahoo_jp"
  | "mercari_jp"
  | "cardtrader";

/**
 * Geographic regions
 */
export type Region = "US" | "UK" | "EU" | "JP" | "AU" | "KR" | "CN";

// =============================================================================
// VISION MODEL TYPES
// =============================================================================

/**
 * Input for vision model
 */
export interface VisionInput {
  /** Base64 encoded image or URL */
  image: string;
  /** Image source type */
  imageType: "base64" | "url" | "filepath";
  /** Optional: listing context for better matching */
  listingContext?: {
    title?: string;
    description?: string;
    platform?: Platform;
    listedPrice?: number;
    currency?: string;
  };
}

/**
 * Vision model output - card identification and grading
 */
export interface VisionOutput extends BasePrediction {
  /** Identified card (top match) */
  cardMatch: {
    cardId: string;
    name: string;
    setCode: string;
    cardNumber: string;
    confidence: number;
  };
  /** Alternative matches if uncertain */
  alternativeMatches?: Array<{
    cardId: string;
    name: string;
    confidence: number;
  }>;
  /** Detected language */
  language: {
    detected: CardLanguage;
    confidence: number;
  };
  /** Condition assessment */
  condition: {
    grade: CardCondition;
    confidence: number;
    details: {
      corners: number; // 0-1 quality score
      edges: number;
      surface: number;
      centering: number;
    };
  };
  /** Variant detection */
  variant: {
    type: VariantType;
    confidence: number;
  };
  /** Authenticity assessment */
  authenticity: {
    isAuthentic: boolean;
    confidence: number;
    redFlags: string[];
  };
  /** PSA grading potential */
  gradingPotential: {
    psa10Probability: number;
    psa9Probability: number;
    expectedGrade: number; // 1-10
    recommendSubmission: boolean;
  };
}

// =============================================================================
// DEMAND FORECASTING TYPES (XGBoost/LightGBM)
// =============================================================================

/**
 * Features for demand forecasting model
 */
export interface DemandFeatures {
  // Price momentum (15 features)
  priceChange7d: number;
  priceChange30d: number;
  priceChange90d: number;
  priceAcceleration: number;
  priceVs52wHigh: number;
  priceVs52wLow: number;
  pricePercentile90d: number;
  consecutiveUpDays: number;
  consecutiveDownDays: number;
  volatility7d: number;
  volatility30d: number;
  volatilityRatio: number;
  rsi14: number;
  macd: number;
  macdSignal: number;

  // Volume/liquidity (10 features)
  sales7d: number;
  sales30d: number;
  salesChange7d: number;
  listingsCount: number;
  listingsChange7d: number;
  daysOfSupply: number;
  sellThroughRate: number;
  timeToSaleAvg: number;
  priceDispersion: number;
  bidAskSpread: number | null;

  // Card characteristics (12 features)
  rarityEncoded: number;
  isLeader: boolean;
  isCharacter: boolean;
  isEvent: boolean;
  isStage: boolean;
  colorEncoded: number;
  cost: number;
  power: number | null;
  setAgeDays: number;
  setTotalValue: number;
  cardRankInSet: number;
  isAlternateArt: boolean;

  // Market context (10 features)
  tcg100IndexValue: number;
  tcg100Change7d: number;
  setIndexValue: number;
  setIndexChange7d: number;
  marketPhase: MarketPhase;
  daysToNextSet: number;
  daysSinceLastSet: number;
  isTournamentLegal: boolean;
  tournamentPlayRate: number;
  metaRelevanceScore: number;

  // External signals (8 features)
  socialMentions7d: number;
  socialSentiment: number;
  youtubeMentions7d: number;
  searchTrend7d: number;
  tournamentTopCut: number;
  banWatchScore: number;
  reprintProbability: number;
  crossoverPotential: number;
}

/**
 * Market cycle phases
 */
export type MarketPhase = "accumulation" | "markup" | "distribution" | "markdown";

/**
 * Price movement prediction classes
 */
export type PriceMovement = "strong_up" | "up" | "flat" | "down" | "strong_down";

/**
 * Demand forecasting output
 */
export interface DemandPrediction extends BasePrediction {
  cardId: string;

  /** Classification output */
  priceMovement: PriceMovement;
  movementProbabilities: {
    strongUp: number;
    up: number;
    flat: number;
    down: number;
    strongDown: number;
  };

  /** Regression output */
  expectedReturn: {
    days7: number;
    days30: number;
    days90: number;
  };

  /** Confidence intervals */
  confidenceInterval: {
    days30Low: number;
    days30High: number;
  };

  /** Feature importance for this prediction */
  topFeatures: Array<{
    feature: string;
    importance: number;
    value: number;
  }>;

  /** Risk assessment */
  riskScore: number; // 0-1
  riskFactors: string[];
}

// =============================================================================
// LISTING QUALITY TYPES (Logistic Regression)
// =============================================================================

/**
 * Features for listing quality model
 */
export interface QualityFeatures {
  // Price signals (5 features)
  priceVsMarket: number;
  priceVsRecentSales: number;
  pricePercentile: number;
  isSuspiciouslyLow: boolean;
  isRoundNumber: boolean;

  // Seller signals (10 features)
  feedbackScore: number;
  feedbackCount: number;
  accountAgeDays: number;
  isNewAccount: boolean;
  isPowerSeller: boolean;
  negativeFeedbackRate: number;
  recentNegativeCount: number;
  sellsOtherCategories: boolean;
  listingVelocity: number;
  responseTimeHours: number | null;

  // Listing signals (10 features)
  hasPhotos: boolean;
  photoCount: number;
  photoQualityScore: number;
  usesStockPhoto: boolean;
  descriptionLength: number;
  descriptionQualityScore: number;
  conditionMatchesPhotos: boolean;
  titleHasSuspiciousKeywords: boolean;
  isAuction: boolean;
  shippingLocationMatches: boolean;

  // Card-specific signals (5 features)
  isHighValue: boolean;
  hasKnownFakes: boolean;
  isGraded: boolean;
  editionMatchesEra: boolean;
  imageAuthenticityScore: number;
}

/**
 * Listing quality classification
 */
export type ListingQuality = "legitimate" | "suspicious" | "likely_fake" | "misgraded" | "scam";

/**
 * Listing quality output
 */
export interface QualityPrediction extends BasePrediction {
  listingId: string;

  /** Overall classification */
  quality: ListingQuality;

  /** Probabilities for each class */
  probabilities: {
    legitimate: number;
    suspicious: number;
    likelyFake: number;
    misgraded: number;
    scam: number;
  };

  /** Risk factors identified */
  riskFactors: Array<{
    factor: string;
    severity: "low" | "medium" | "high";
    description: string;
  }>;

  /** Recommendation */
  recommendation: "safe" | "caution" | "avoid";
  recommendationReason: string;
}

// =============================================================================
// TIMING OPTIMIZER TYPES (Prophet/ARIMA)
// =============================================================================

/**
 * Time series data point
 */
export interface TimeSeriesPoint {
  date: Date;
  price: number;
  volume?: number;
}

/**
 * Timing model input
 */
export interface TimingInput {
  cardId: string;
  priceHistory: TimeSeriesPoint[];
  forecastDays: number;
}

/**
 * Seasonal pattern
 */
export interface SeasonalPattern {
  type: "weekly" | "monthly" | "yearly";
  pattern: Array<{
    period: number; // Day of week (0-6), month (1-12), etc.
    effect: number; // Multiplier (1.0 = neutral)
  }>;
}

/**
 * Timing optimizer output
 */
export interface TimingPrediction extends BasePrediction {
  cardId: string;

  /** Price forecast */
  forecast: Array<{
    date: Date;
    predicted: number;
    lowerBound: number;
    upperBound: number;
  }>;

  /** Optimal timing windows */
  optimalBuyDates: Array<{
    date: Date;
    expectedPrice: number;
    reason: string;
  }>;

  optimalSellDates: Array<{
    date: Date;
    expectedPrice: number;
    reason: string;
  }>;

  /** Seasonal patterns detected */
  seasonality: {
    weekly: SeasonalPattern;
    monthly: SeasonalPattern;
    yearly: SeasonalPattern;
  };

  /** Current timing assessment */
  currentTiming: {
    isBuyWindow: boolean;
    isSellWindow: boolean;
    daysToNextBuyWindow: number;
    daysToNextSellWindow: number;
    currentSeasonalEffect: number;
  };

  /** Trend analysis */
  trend: {
    direction: "up" | "down" | "flat";
    strength: number;
    changepoints: Date[];
  };
}

// =============================================================================
// ANOMALY DETECTION TYPES (Isolation Forest)
// =============================================================================

/**
 * Features for anomaly detection
 */
export interface AnomalyFeatures {
  // Price features
  priceZScore: number;
  priceVsMedian: number;
  priceVsRecentSales: number;
  pricePercentile: number;

  // Volume features
  listingAgeHours: number;
  sellerListingsToday: number;
  cardListingsToday: number;

  // Cross-market features
  tcgCmSpread: number;
  tcgEbaySpread: number;
  crossMarketZScore: number;

  // Data quality features
  isCompleteData: boolean;
  conditionMatchesPrice: boolean;
  titleMatchesCard: number;
}

/**
 * Anomaly type classification
 */
export type AnomalyType =
  | "underpriced"
  | "overpriced"
  | "data_error"
  | "market_dislocation"
  | "suspicious_activity"
  | "normal";

/**
 * Anomaly detection output
 */
export interface AnomalyPrediction extends BasePrediction {
  listingId: string;

  /** Is this an anomaly? */
  isAnomaly: boolean;

  /** Anomaly score (0-1, higher = more anomalous) */
  anomalyScore: number;

  /** Type of anomaly */
  anomalyType: AnomalyType;

  /** Contributing features */
  contributingFeatures: Array<{
    feature: string;
    zScore: number;
    contribution: number;
  }>;

  /** For arbitrage opportunities */
  arbitrageSignal?: {
    isOpportunity: boolean;
    estimatedMargin: number;
    suggestedAction: "buy" | "sell" | "monitor" | "avoid";
    urgency: "immediate" | "short" | "medium" | "low";
  };
}

// =============================================================================
// ORCHESTRATOR TYPES
// =============================================================================

/**
 * Combined analysis request
 */
export interface AnalysisRequest {
  /** Listing to analyze */
  listing: {
    id: string;
    platform: Platform;
    title: string;
    description?: string;
    price: number;
    currency: string;
    condition?: string;
    imageUrls?: string[];
    sellerId?: string;
    sellerFeedback?: number;
    sellerFeedbackCount?: number;
  };

  /** Which models to run */
  models?: {
    vision?: boolean;
    demand?: boolean;
    quality?: boolean;
    timing?: boolean;
    anomaly?: boolean;
  };

  /** User context for cost calculations */
  userContext?: {
    region: Region;
    vatRate?: number;
  };
}

/**
 * Combined analysis result
 */
export interface AnalysisResult {
  listingId: string;
  analyzedAt: Date;
  totalLatencyMs: number;

  /** Individual model results */
  vision?: VisionOutput;
  demand?: DemandPrediction;
  quality?: QualityPrediction;
  timing?: TimingPrediction;
  anomaly?: AnomalyPrediction;

  /** Combined recommendation */
  recommendation: {
    action: "buy" | "sell" | "hold" | "avoid" | "monitor";
    confidence: number;
    reasoning: string[];
    risks: string[];
    opportunities: string[];
  };

  /** Deal identification */
  deal?: {
    type: "arbitrage" | "speculation" | "timing" | "none";
    estimatedReturn: number;
    timeHorizon: "immediate" | "short" | "medium" | "long";
    riskLevel: "low" | "medium" | "high";
  };

  /** True cost calculation */
  costAnalysis?: {
    purchasePrice: number;
    estimatedTotalCost: number;
    estimatedNetSale: number;
    estimatedProfit: number;
    costBreakdown: {
      platformFee: number;
      shipping: number;
      customs: number;
      vat: number;
      other: number;
    };
  };
}

// =============================================================================
// MODEL INTERFACE
// =============================================================================

/**
 * Generic model interface that all models must implement
 */
export interface MLModel<TInput, TOutput extends BasePrediction> {
  /** Model name */
  readonly name: string;

  /** Model version */
  readonly version: string;

  /** Initialize/load the model */
  load(): Promise<void>;

  /** Check if model is loaded */
  isLoaded(): boolean;

  /** Run inference */
  predict(input: TInput): Promise<TOutput>;

  /** Batch inference */
  predictBatch(inputs: TInput[]): Promise<TOutput[]>;

  /** Get model status */
  getStatus(): ModelStatus;

  /** Unload model from memory */
  unload(): Promise<void>;
}

/**
 * Feature extractor interface
 */
export interface FeatureExtractor<TRaw, TFeatures> {
  /** Extract features from raw data */
  extract(raw: TRaw): Promise<TFeatures>;

  /** Extract features for multiple items */
  extractBatch(raw: TRaw[]): Promise<TFeatures[]>;

  /** Get feature names */
  getFeatureNames(): string[];

  /** Normalize features */
  normalize(features: TFeatures): TFeatures;
}

// =============================================================================
// AWS CONFIGURATION TYPES
// =============================================================================

/**
 * AWS configuration
 */
export interface AWSConfig {
  region: string;
  s3: {
    dataBucket: string;
    modelBucket: string;
  };
  sagemaker: {
    visionEndpoint?: string;
    demandEndpoint?: string;
    timingEndpoint?: string;
  };
  lambda: {
    qualityFunction?: string;
    anomalyFunction?: string;
  };
}

/**
 * Model deployment configuration
 */
export interface ModelDeploymentConfig {
  environment: ModelEnvironment;
  aws?: AWSConfig;
  localModelPaths?: {
    vision?: string;
    demand?: string;
    quality?: string;
    timing?: string;
    anomaly?: string;
  };
}
