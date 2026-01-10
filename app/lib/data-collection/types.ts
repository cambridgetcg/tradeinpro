/**
 * Types for CardMarket Data Collection Pipeline
 */

// =============================================================================
// OPTCG API Types
// =============================================================================

export interface OPTCGCard {
  card_name: string;
  set_name: string;
  set_id: string;
  card_set_id: string;
  rarity: string;
  card_color: string;
  card_type: string;
  card_cost: string;
  card_power: string;
  life: string;
  counter_amount: string;
  attribute: string;
  sub_types: string;
  card_text: string;
  inventory_price: number;
  market_price: number;
  date_scraped: string;
  card_image_id: string;
  card_image: string;
}

export interface OPTCGCardWithHistory extends OPTCGCard {
  Day1_Inventory_Price?: number;
  Day1_Market_Price?: number;
  Day2_Inventory_Price?: number;
  Day2_Market_Price?: number;
  Day3_Inventory_Price?: number;
  Day3_Market_Price?: number;
  Day4_Inventory_Price?: number;
  Day4_Market_Price?: number;
  Day5_Inventory_Price?: number;
  Day5_Market_Price?: number;
  Day6_Inventory_Price?: number;
  Day6_Market_Price?: number;
  Day7_Inventory_Price?: number;
  Day7_Market_Price?: number;
  Day8_Inventory_Price?: number;
  Day8_Market_Price?: number;
  Day9_Inventory_Price?: number;
  Day9_Market_Price?: number;
  Day10_Inventory_Price?: number;
  Day10_Market_Price?: number;
  Day11_Inventory_Price?: number;
  Day11_Market_Price?: number;
  Day12_Inventory_Price?: number;
  Day12_Market_Price?: number;
  Day13_Inventory_Price?: number;
  Day13_Market_Price?: number;
}

export interface OPTCGSet {
  set_id: string;
  set_name: string;
}

// =============================================================================
// JustTCG API Types
// =============================================================================

export interface JustTCGGame {
  id: string;
  name: string;
}

export interface JustTCGSet {
  id: string;
  name: string;
  game: string;
}

export interface JustTCGCard {
  id: string;
  name: string;
  game: string;
  set: string;
  price: number;
  lastUpdated: string;
  variants?: JustTCGVariant[];
  statistics?: JustTCGStatistics;
  priceHistory?: JustTCGPricePoint[];
}

export interface JustTCGVariant {
  condition: string;
  printing: string;
  price: number;
  lastUpdated: string;
}

export interface JustTCGStatistics {
  change24h: number;
  change7d: number;
  change30d: number;
  change90d?: number;
  avg: number;
  min: number;
  max: number;
  stdDev: number;
  coeffVar: number;
  iqr: number;
  trendSlope: number;
  allTimeHigh?: number;
  allTimeHighDate?: string;
  allTimeLow?: number;
  allTimeLowDate?: string;
}

export interface JustTCGPricePoint {
  p: number; // price
  t: number; // unix timestamp
}

export type JustTCGPriceHistoryDuration = "7d" | "30d" | "90d" | "180d";

export interface JustTCGSearchParams {
  game?: string;
  set?: string;
  search?: string;
  id?: string;
  limit?: number;
  offset?: number;
  orderBy?: "price" | "24h" | "7d" | "30d";
  order?: "asc" | "desc";
  includeStatistics?: boolean;
  includePriceHistory?: boolean;
  priceHistoryDuration?: JustTCGPriceHistoryDuration;
}

// =============================================================================
// Cardmarket CSV Types
// =============================================================================

export interface CardmarketCSVRow {
  productId: string;
  name: string;
  expansion: string;
  category?: string;
  trendPrice: number;
  avgSellPrice?: number;
  lowPrice?: number;
  avg1d?: number;
  avg7d?: number;
  avg30d?: number;
  // Inventory signals (for ML features)
  availableItems?: number;
  availableFoils?: number;
  updatedAt?: string;
}

// =============================================================================
// FX Rate Types
// =============================================================================

export interface FXRates {
  USDGBP: number;
  EURGBP: number;
  JPYGBP: number;
  timestamp: Date;
}

export interface FXRateResponse {
  rates: Record<string, number>;
  base: string;
  timestamp: number;
}

// =============================================================================
// Aggregated Price Types
// =============================================================================

export interface AggregatedPrice {
  cardId: string;
  timestamp: Date;

  // US Market (TCGplayer)
  us?: {
    source: "optcg" | "justtcg";
    marketPrice: number; // USD
    lowPrice: number; // USD
    marketPriceGBP: number;
    lowPriceGBP: number;
    change24h?: number;
    change7d?: number;
    change30d?: number;
    // Volume metrics from JustTCG variants
    listingsCount?: number;
    conditionsAvailable?: number;
  };

  // EU Market (Cardmarket)
  eu?: {
    source: "cardmarket_csv" | "apify";
    trendPrice: number; // EUR
    lowPrice: number; // EUR
    avgPrice?: number; // EUR
    trendPriceGBP: number;
    lowPriceGBP: number;
    // Inventory signals from Cardmarket CSV
    availableItems?: number;
    availableFoils?: number;
  };

  // Calculated arbitrage
  arbitrage?: {
    spreadEUtoUS: number; // Buy EU, sell US
    spreadUStoEU: number; // Buy US, sell EU
    bestDirection: "EU_TO_US" | "US_TO_EU" | "NONE";
    grossSpread: number;
    estimatedNetSpread: number;
    estimatedFees: number;
    estimatedShipping: number;
  };
}

// =============================================================================
// Arbitrage Detection Types
// =============================================================================

export interface ArbitrageDetectionInput {
  cardId: string;
  usPrice?: {
    market: number;
    low: number;
    currency: "USD";
  };
  euPrice?: {
    trend: number;
    low: number;
    currency: "EUR";
  };
  fxRates: FXRates;
}

export interface ArbitrageDetectionResult {
  cardId: string;
  hasOpportunity: boolean;
  opportunity?: {
    buyMarket: string;
    buyPrice: number;
    buyCurrency: string;
    buyPriceGBP: number;
    sellMarket: string;
    sellPrice: number;
    sellCurrency: string;
    sellPriceGBP: number;
    grossSpread: number;
    estimatedFees: number;
    estimatedShipping: number;
    netSpread: number;
    confidence: number;
    urgency: "immediate" | "short" | "medium" | "low";
  };
}

// =============================================================================
// Collection Job Types
// =============================================================================

export interface CollectionJobConfig {
  name: string;
  enabled: boolean;
  schedule?: string; // Cron expression
  intervalMs?: number;
  maxRetries?: number;
  timeoutMs?: number;
}

export interface CollectionJobResult {
  jobName: string;
  startedAt: Date;
  completedAt: Date;
  status: "success" | "failed" | "partial";
  recordsProcessed: number;
  recordsCreated: number;
  recordsUpdated: number;
  errorsCount: number;
  errors?: Array<{ message: string; details?: unknown }>;
}

// =============================================================================
// Training Data Export Types
// =============================================================================

export interface ArbitrageTrainingExample {
  cardId: string;
  timestamp: Date;

  // Features
  usMarketUSD: number;
  usLowUSD: number;
  euTrendEUR: number;
  euLowEUR: number;
  fxUSDGBP: number;
  fxEURGBP: number;
  spreadEUtoUS: number;
  spreadUStoEU: number;

  // Label (outcome)
  wasExecuted: boolean;
  actualProfit?: number;
  wasSuccessful?: boolean;
}

export interface TFTTrainingSequence {
  cardId: string;
  staticFeatures: {
    setCode: string;
    rarity: string;
    variantType: string;
    avgPriceLevel: "low" | "medium" | "high" | "premium";
  };
  observedSequence: Array<{
    date: Date;
    usMarketGBP: number;
    euTrendGBP?: number;
    spread?: number;
  }>;
  targetSequence: Array<{
    date: Date;
    usMarketGBP: number;
    euTrendGBP?: number;
  }>;
}

export interface DemandTrainingExample {
  cardId: string;
  timestamp: Date;

  // Features
  features: {
    change24h: number;
    change7d: number;
    change30d: number;
    avgPrice: number;
    volatility: number;
    trendSlope: number;
    priceLevel: number;
  };

  // Label
  label: {
    priceChange7d: number;
    direction: "strong_up" | "up" | "flat" | "down" | "strong_down";
  };
}
