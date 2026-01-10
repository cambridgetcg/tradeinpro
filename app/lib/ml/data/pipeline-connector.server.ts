/**
 * ML Pipeline Data Connector
 *
 * Connects the data collection pipeline to ML models:
 * - Converts collected market data to model input formats
 * - Provides training data preparation
 * - Handles feature engineering
 *
 * @see app/lib/data-collection for source data
 * @see app/lib/ml for model definitions
 */

import type {
  AggregatedPrice,
  ArbitrageDetectionResult,
  ArbitrageTrainingExample,
  TFTTrainingSequence,
  DemandTrainingExample,
  FXRates,
  JustTCGCard,
} from "../../data-collection/types";

import type { TFTInput, TFTOutput } from "../demand/tft.server";
import type { ArbitrageInput, ArbitrageOutput } from "../anomaly/arbitrage.server";

// =============================================================================
// TYPE MAPPINGS
// =============================================================================

/**
 * Market name mapping between data collection and ML models
 */
const MARKET_MAPPING: Record<string, "tcgplayer" | "cardmarket" | "ebay_us" | "ebay_uk" | "yahoo_jp"> = {
  optcg: "tcgplayer",
  justtcg: "tcgplayer",
  cardmarket_csv: "cardmarket",
  apify: "cardmarket",
};

/**
 * Region mapping based on market source
 */
const REGION_MAPPING: Record<string, "US" | "UK" | "EU" | "JP"> = {
  optcg: "US",
  justtcg: "US",
  cardmarket_csv: "EU",
  apify: "EU",
};

// =============================================================================
// ARBITRAGE MODEL CONNECTOR
// =============================================================================

/**
 * Convert aggregated prices to arbitrage model input
 */
export function toArbitrageInput(
  aggregated: AggregatedPrice,
  fxRates: FXRates,
  cardName: string = "Unknown Card",
  userRegion: "US" | "UK" | "EU" | "JP" = "UK"
): ArbitrageInput {
  const prices: ArbitrageInput["prices"] = [];

  // Add US market prices
  if (aggregated.us) {
    prices.push({
      market: MARKET_MAPPING[aggregated.us.source] || "tcgplayer",
      region: REGION_MAPPING[aggregated.us.source] || "US",
      price: aggregated.us.marketPrice,
      currency: "USD",
      priceGBP: aggregated.us.marketPriceGBP,
      lastUpdated: aggregated.timestamp,
    });

    // Add low price as separate listing
    if (aggregated.us.lowPrice !== aggregated.us.marketPrice) {
      prices.push({
        market: MARKET_MAPPING[aggregated.us.source] || "tcgplayer",
        region: REGION_MAPPING[aggregated.us.source] || "US",
        price: aggregated.us.lowPrice,
        currency: "USD",
        priceGBP: aggregated.us.lowPriceGBP,
        lastUpdated: aggregated.timestamp,
      });
    }
  }

  // Add EU market prices
  if (aggregated.eu) {
    prices.push({
      market: MARKET_MAPPING[aggregated.eu.source] || "cardmarket",
      region: REGION_MAPPING[aggregated.eu.source] || "EU",
      price: aggregated.eu.trendPrice,
      currency: "EUR",
      priceGBP: aggregated.eu.trendPriceGBP,
      lastUpdated: aggregated.timestamp,
    });

    // Add low price as separate listing
    if (aggregated.eu.lowPrice !== aggregated.eu.trendPrice) {
      prices.push({
        market: MARKET_MAPPING[aggregated.eu.source] || "cardmarket",
        region: REGION_MAPPING[aggregated.eu.source] || "EU",
        price: aggregated.eu.lowPrice,
        currency: "EUR",
        priceGBP: aggregated.eu.lowPriceGBP,
        lastUpdated: aggregated.timestamp,
      });
    }
  }

  return {
    cardId: aggregated.cardId,
    cardName,
    prices,
    userRegion,
    fxRates: {
      USDGBP: fxRates.USDGBP,
      EURGBP: fxRates.EURGBP,
      JPYGBP: fxRates.JPYGBP,
    },
  };
}

/**
 * Convert batch of aggregated prices to arbitrage inputs
 */
export function toArbitrageInputBatch(
  aggregatedPrices: AggregatedPrice[],
  fxRates: FXRates,
  cardNames: Map<string, string>,
  userRegion: "US" | "UK" | "EU" | "JP" = "UK"
): ArbitrageInput[] {
  return aggregatedPrices.map((price) =>
    toArbitrageInput(
      price,
      fxRates,
      cardNames.get(price.cardId) || "Unknown Card",
      userRegion
    )
  );
}

/**
 * Convert data collection arbitrage result to ML model format
 */
export function fromDataCollectionArbitrage(
  result: ArbitrageDetectionResult
): Partial<ArbitrageOutput> {
  if (!result.hasOpportunity || !result.opportunity) {
    return {
      cardId: result.cardId,
      opportunities: [],
      bestOpportunity: null,
      noOpportunityReasons: ["No opportunity detected"],
      scanTimestamp: new Date(),
    };
  }

  const opp = result.opportunity;

  return {
    cardId: result.cardId,
    opportunities: [
      {
        cardId: result.cardId,
        cardName: "Unknown",
        buyMarket: opp.buyMarket.toLowerCase() as "tcgplayer" | "cardmarket",
        buyRegion: opp.buyMarket === "Cardmarket" ? "EU" : "US",
        buyPrice: opp.buyPrice,
        buyPriceGBP: opp.buyPriceGBP,
        sellMarket: opp.sellMarket.toLowerCase() as "tcgplayer" | "cardmarket",
        sellRegion: opp.sellMarket === "Cardmarket" ? "EU" : "US",
        sellPrice: opp.sellPrice,
        sellPriceGBP: opp.sellPriceGBP,
        grossSpread: opp.grossSpread,
        netSpread: opp.netSpread,
        expectedProfit: opp.sellPriceGBP - opp.buyPriceGBP - opp.estimatedFees - opp.estimatedShipping,
        costs: {
          purchasePrice: opp.buyPriceGBP,
          platformFeeBuy: 0,
          platformFeeSell: opp.estimatedFees * opp.sellPriceGBP,
          fxFee: 0,
          shippingToUser: opp.estimatedShipping,
          shippingToBuyer: 0,
          customs: 0,
          vat: 0,
          totalCost: opp.buyPriceGBP + opp.estimatedFees + opp.estimatedShipping,
        },
        confidence: opp.confidence,
        sellerRiskScore: 0.2,
        riskFactors: [],
        urgency: opp.urgency,
        expiryEstimate: new Date(Date.now() + 24 * 60 * 60 * 1000),
        detectedAt: new Date(),
        route: `${opp.buyMarket}→${opp.sellMarket}`,
      },
    ],
    scanTimestamp: new Date(),
  };
}

// =============================================================================
// TFT MODEL CONNECTOR
// =============================================================================

/**
 * Card metadata for static feature encoding
 */
interface CardMetadata {
  cardId: string;
  rarity: string;
  color: string;
  cardType: string;
  setCode: string;
}

/**
 * Feature encodings for TFT model
 */
const RARITY_ENCODING: Record<string, number> = {
  common: 0,
  uncommon: 1,
  rare: 2,
  "super rare": 3,
  "secret rare": 4,
  leader: 5,
  alt_art: 6,
  manga: 7,
  parallel: 8,
  sp: 9,
};

const COLOR_ENCODING: Record<string, number> = {
  red: 0,
  green: 1,
  blue: 2,
  purple: 3,
  black: 4,
  yellow: 5,
  multicolor: 6,
};

const CARD_TYPE_ENCODING: Record<string, number> = {
  leader: 0,
  character: 1,
  event: 2,
  stage: 3,
};

/**
 * Convert TFT training sequence to model input format
 */
export function toTFTInput(
  sequence: TFTTrainingSequence,
  metadata?: CardMetadata
): TFTInput {
  // Encode static features
  const staticFeatures = {
    cardIdEncoded: hashCardId(sequence.cardId),
    rarityEncoded: RARITY_ENCODING[sequence.staticFeatures.rarity.toLowerCase()] ?? 2,
    colorEncoded: 0, // Would need color data
    cardTypeEncoded: 0, // Would need type data
    setEncoded: hashSetCode(sequence.staticFeatures.setCode),
  };

  // Convert observed sequence
  const observedSequence = sequence.observedSequence.map((obs) => ({
    date: obs.date,
    price: obs.usMarketGBP,
    priceChange: 0, // Calculate from previous day
    volume: 0, // Not available in current data
    listingsCount: 0, // Not available
    tcg100Index: 0, // Would need index data
    socialSentiment: 0, // Not available
    searchVolume: 0, // Not available
  }));

  // Add price change calculation
  for (let i = 1; i < observedSequence.length; i++) {
    const prev = observedSequence[i - 1].price;
    const curr = observedSequence[i].price;
    observedSequence[i].priceChange = prev > 0 ? (curr - prev) / prev : 0;
  }

  // Generate known sequence (encoder + decoder)
  const knownSequence: TFTInput["knownSequence"] = [];
  const allDates = [
    ...sequence.observedSequence.map((o) => o.date),
    ...sequence.targetSequence.map((t) => t.date),
  ];

  for (const date of allDates) {
    const d = new Date(date);
    knownSequence.push({
      date: d,
      dayOfWeek: d.getDay(),
      month: d.getMonth(),
      isWeekend: d.getDay() === 0 || d.getDay() === 6,
      isHoliday: false, // Would need holiday calendar
      daysToSetRelease: 0, // Would need release schedule
      daysToTournament: 0, // Would need tournament schedule
      isBanListPeriod: false, // Would need ban list schedule
    });
  }

  return {
    cardId: sequence.cardId,
    staticFeatures,
    observedSequence,
    knownSequence,
  };
}

/**
 * Convert batch of TFT training sequences to model inputs
 */
export function toTFTInputBatch(
  sequences: TFTTrainingSequence[],
  metadataMap?: Map<string, CardMetadata>
): TFTInput[] {
  return sequences.map((seq) => toTFTInput(seq, metadataMap?.get(seq.cardId)));
}

/**
 * Hash card ID to numeric encoding
 */
function hashCardId(cardId: string): number {
  let hash = 0;
  for (let i = 0; i < cardId.length; i++) {
    const char = cardId.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash) % 10000;
}

/**
 * Hash set code to numeric encoding
 */
function hashSetCode(setCode: string): number {
  // Extract number from set code (e.g., "OP01" -> 1, "ST10" -> 110)
  const match = setCode.match(/^(OP|ST|EB)(\d+)$/i);
  if (match) {
    const prefix = match[1].toUpperCase();
    const num = parseInt(match[2], 10);
    const prefixOffset = prefix === "OP" ? 0 : prefix === "ST" ? 100 : 200;
    return prefixOffset + num;
  }
  return 0;
}

// =============================================================================
// DEMAND MODEL CONNECTOR
// =============================================================================

/**
 * Convert demand training example to model-ready features
 */
export function toDemandModelInput(
  example: DemandTrainingExample
): {
  features: number[];
  label: number;
  labelName: string;
} {
  // Normalize features
  const features = [
    example.features.change24h,
    example.features.change7d,
    example.features.change30d,
    Math.log10(example.features.avgPrice + 1) / 3, // Normalize price level
    example.features.volatility / example.features.avgPrice, // Coefficient of variation
    example.features.trendSlope,
    example.features.priceLevel,
  ];

  // Convert label to numeric
  const labelMap: Record<string, number> = {
    strong_down: 0,
    down: 1,
    flat: 2,
    up: 3,
    strong_up: 4,
  };

  return {
    features,
    label: labelMap[example.label.direction] ?? 2,
    labelName: example.label.direction,
  };
}

/**
 * Convert batch of demand examples to model inputs
 */
export function toDemandModelInputBatch(
  examples: DemandTrainingExample[]
): {
  features: number[][];
  labels: number[];
  labelNames: string[];
} {
  const results = examples.map(toDemandModelInput);

  return {
    features: results.map((r) => r.features),
    labels: results.map((r) => r.label),
    labelNames: results.map((r) => r.labelName),
  };
}

// =============================================================================
// FEATURE ENGINEERING
// =============================================================================

/**
 * Calculate rolling statistics from price history
 */
export function calculateRollingStats(
  prices: number[],
  windowSize: number
): {
  mean: number[];
  std: number[];
  min: number[];
  max: number[];
} {
  const mean: number[] = [];
  const std: number[] = [];
  const min: number[] = [];
  const max: number[] = [];

  for (let i = 0; i < prices.length; i++) {
    const windowStart = Math.max(0, i - windowSize + 1);
    const window = prices.slice(windowStart, i + 1);

    const windowMean = window.reduce((a, b) => a + b, 0) / window.length;
    const windowVariance =
      window.reduce((sum, p) => sum + Math.pow(p - windowMean, 2), 0) / window.length;

    mean.push(windowMean);
    std.push(Math.sqrt(windowVariance));
    min.push(Math.min(...window));
    max.push(Math.max(...window));
  }

  return { mean, std, min, max };
}

/**
 * Calculate momentum indicators
 */
export function calculateMomentum(
  prices: number[]
): {
  roc: number[]; // Rate of change
  rsi: number[]; // Relative strength index (simplified)
} {
  const roc: number[] = [0];
  const gains: number[] = [0];
  const losses: number[] = [0];
  const rsi: number[] = [50];

  for (let i = 1; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    const pctChange = prices[i - 1] > 0 ? change / prices[i - 1] : 0;

    roc.push(pctChange);

    if (change > 0) {
      gains.push(change);
      losses.push(0);
    } else {
      gains.push(0);
      losses.push(Math.abs(change));
    }

    // Simple RSI calculation (14-period)
    if (i >= 14) {
      const avgGain =
        gains.slice(i - 13, i + 1).reduce((a, b) => a + b, 0) / 14;
      const avgLoss =
        losses.slice(i - 13, i + 1).reduce((a, b) => a + b, 0) / 14;

      if (avgLoss === 0) {
        rsi.push(100);
      } else {
        const rs = avgGain / avgLoss;
        rsi.push(100 - 100 / (1 + rs));
      }
    } else {
      rsi.push(50);
    }
  }

  return { roc, rsi };
}

/**
 * Calculate spread features between markets
 */
export function calculateSpreadFeatures(
  usPrices: number[],
  euPrices: number[],
  fxRateHistory: { usdGbp: number; eurGbp: number }[]
): {
  spreadEuToUs: number[];
  spreadUsToEu: number[];
  spreadMean: number;
  spreadStd: number;
  spreadTrend: number;
} {
  const spreadsEuToUs: number[] = [];
  const spreadsUsToEu: number[] = [];

  for (let i = 0; i < Math.min(usPrices.length, euPrices.length); i++) {
    const fx = fxRateHistory[Math.min(i, fxRateHistory.length - 1)];
    const usGbp = usPrices[i] * fx.usdGbp;
    const euGbp = euPrices[i] * fx.eurGbp;

    if (euGbp > 0) {
      spreadsEuToUs.push((usGbp - euGbp) / euGbp);
    }
    if (usGbp > 0) {
      spreadsUsToEu.push((euGbp - usGbp) / usGbp);
    }
  }

  // Calculate statistics
  const spreadMean =
    spreadsEuToUs.length > 0
      ? spreadsEuToUs.reduce((a, b) => a + b, 0) / spreadsEuToUs.length
      : 0;

  const spreadVariance =
    spreadsEuToUs.length > 0
      ? spreadsEuToUs.reduce((sum, s) => sum + Math.pow(s - spreadMean, 2), 0) /
        spreadsEuToUs.length
      : 0;

  // Trend (slope of linear regression)
  let spreadTrend = 0;
  if (spreadsEuToUs.length > 1) {
    const n = spreadsEuToUs.length;
    const xMean = (n - 1) / 2;
    const yMean = spreadMean;
    let numerator = 0;
    let denominator = 0;

    for (let i = 0; i < n; i++) {
      numerator += (i - xMean) * (spreadsEuToUs[i] - yMean);
      denominator += (i - xMean) * (i - xMean);
    }

    spreadTrend = denominator > 0 ? numerator / denominator : 0;
  }

  return {
    spreadEuToUs: spreadsEuToUs,
    spreadUsToEu: spreadsUsToEu,
    spreadMean,
    spreadStd: Math.sqrt(spreadVariance),
    spreadTrend,
  };
}

// =============================================================================
// DATA VALIDATION
// =============================================================================

/**
 * Validate aggregated price data quality
 */
export function validateAggregatedPrice(price: AggregatedPrice): {
  isValid: boolean;
  warnings: string[];
  errors: string[];
} {
  const warnings: string[] = [];
  const errors: string[] = [];

  // Check for required fields
  if (!price.cardId) {
    errors.push("Missing card ID");
  }

  // Check US data
  if (price.us) {
    if (price.us.marketPrice <= 0) {
      warnings.push("US market price is zero or negative");
    }
    if (price.us.lowPrice > price.us.marketPrice) {
      warnings.push("US low price exceeds market price");
    }
  }

  // Check EU data
  if (price.eu) {
    if (price.eu.trendPrice <= 0) {
      warnings.push("EU trend price is zero or negative");
    }
    if (price.eu.lowPrice && price.eu.lowPrice > price.eu.trendPrice * 1.5) {
      warnings.push("EU low price significantly exceeds trend price");
    }
  }

  // Check both markets available for arbitrage
  if (!price.us && !price.eu) {
    errors.push("No market data available");
  }

  return {
    isValid: errors.length === 0,
    warnings,
    errors,
  };
}

/**
 * Filter and clean aggregated prices for model training
 */
export function cleanAggregatedPrices(
  prices: AggregatedPrice[],
  options: {
    minPriceGBP?: number;
    requireBothMarkets?: boolean;
  } = {}
): {
  cleaned: AggregatedPrice[];
  removed: number;
  reasons: Record<string, number>;
} {
  const { minPriceGBP = 0.5, requireBothMarkets = false } = options;

  const cleaned: AggregatedPrice[] = [];
  const reasons: Record<string, number> = {};

  for (const price of prices) {
    const validation = validateAggregatedPrice(price);

    if (!validation.isValid) {
      validation.errors.forEach((err) => {
        reasons[err] = (reasons[err] || 0) + 1;
      });
      continue;
    }

    // Check minimum price
    const maxPrice = Math.max(
      price.us?.marketPriceGBP ?? 0,
      price.eu?.trendPriceGBP ?? 0
    );
    if (maxPrice < minPriceGBP) {
      reasons["Below minimum price"] = (reasons["Below minimum price"] || 0) + 1;
      continue;
    }

    // Check both markets requirement
    if (requireBothMarkets && (!price.us || !price.eu)) {
      reasons["Missing market data"] = (reasons["Missing market data"] || 0) + 1;
      continue;
    }

    cleaned.push(price);
  }

  return {
    cleaned,
    removed: prices.length - cleaned.length,
    reasons,
  };
}
