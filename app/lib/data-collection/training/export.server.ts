/**
 * Training Data Export Functions
 *
 * Exports collected price data in formats suitable for ML model training:
 * - Arbitrage training examples (for Cross-Market Arbitrage Detector)
 * - TFT sequences (for Temporal Fusion Transformer price prediction)
 * - Demand classification examples (for demand surge detection)
 * - Daily snapshots for time series models
 */

import type {
  ArbitrageTrainingExample,
  TFTTrainingSequence,
  DemandTrainingExample,
  FXRates,
} from "../types";

// =============================================================================
// CONFIGURATION
// =============================================================================

const EXPORT_CONFIG = {
  // TFT sequence parameters
  tft: {
    observedDays: 90, // Days of historical data to include
    targetDays: 14, // Days to predict
    minDataPoints: 30, // Minimum data points for valid sequence
  },
  // Demand classification thresholds
  demand: {
    strongUp: 0.15, // 15%+ increase
    up: 0.05, // 5-15% increase
    flat: 0.02, // -2% to +5%
    down: -0.05, // -5% to -2%
    strongDown: -0.15, // 15%+ decrease
  },
  // Price level thresholds (GBP)
  priceLevel: {
    low: 5,
    medium: 20,
    high: 50,
    premium: 100,
  },
};

// =============================================================================
// ARBITRAGE TRAINING DATA
// =============================================================================

export interface ArbitrageExportOptions {
  startDate?: Date;
  endDate?: Date;
  minSpread?: number;
  includeNegatives?: boolean;
  sampleNegativeRatio?: number;
}

/**
 * Export arbitrage training examples from historical data
 */
export async function exportArbitrageTrainingData(
  prisma: PrismaClientType,
  options: ArbitrageExportOptions = {}
): Promise<ArbitrageTrainingExample[]> {
  const {
    startDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
    endDate = new Date(),
    minSpread = 0.05,
    includeNegatives = true,
    sampleNegativeRatio = 3,
  } = options;

  const examples: ArbitrageTrainingExample[] = [];

  // Fetch historical arbitrage opportunities
  const opportunities = await prisma.arbitrageOpportunity.findMany({
    where: {
      detectedAt: {
        gte: startDate,
        lte: endDate,
      },
    },
    orderBy: { detectedAt: "asc" },
  });

  // Fetch corresponding FX rates
  const fxRates = await prisma.fXRate.findMany({
    where: {
      fetchedAt: {
        gte: startDate,
        lte: endDate,
      },
    },
    orderBy: { fetchedAt: "asc" },
  });

  // Build FX rate lookup map
  const fxRateMap = buildFXRateLookup(fxRates);

  // Process each opportunity
  for (const opp of opportunities) {
    const fxRate = findNearestFXRate(opp.detectedAt, fxRateMap);
    // Note: fxRate always returns a value (defaults if needed)

    // Get US and EU prices at detection time
    const usPrice = await prisma.marketPriceUS.findFirst({
      where: {
        cardId: opp.cardId,
        updatedAt: {
          gte: new Date(opp.detectedAt.getTime() - 60 * 60 * 1000),
          lte: new Date(opp.detectedAt.getTime() + 60 * 60 * 1000),
        },
      },
    });

    const euPrice = await prisma.marketPriceEU.findFirst({
      where: {
        cardId: opp.cardId,
        updatedAt: {
          gte: new Date(opp.detectedAt.getTime() - 60 * 60 * 1000),
          lte: new Date(opp.detectedAt.getTime() + 60 * 60 * 1000),
        },
      },
    });

    if (!usPrice || !euPrice) continue;

    const example: ArbitrageTrainingExample = {
      cardId: opp.cardId,
      timestamp: opp.detectedAt,
      usMarketUSD: Number(usPrice.marketPrice),
      usLowUSD: Number(usPrice.lowPrice),
      euTrendEUR: Number(euPrice.trendPrice),
      euLowEUR: Number(euPrice.lowPrice),
      fxUSDGBP: fxRate.usdGbp,
      fxEURGBP: fxRate.eurGbp,
      spreadEUtoUS: Number(opp.grossSpread),
      spreadUStoEU: -Number(opp.grossSpread), // Inverse
      wasExecuted: opp.wasExecuted || false,
      actualProfit: opp.actualProfit ? Number(opp.actualProfit) : undefined,
      wasSuccessful: opp.wasSuccessful,
    };

    examples.push(example);
  }

  // Sample negative examples if requested
  if (includeNegatives) {
    const negativeExamples = await sampleNegativeArbitrageExamples(
      prisma,
      startDate,
      endDate,
      examples.length * sampleNegativeRatio,
      fxRateMap
    );
    examples.push(...negativeExamples);
  }

  // Sort by timestamp
  examples.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  return examples;
}

/**
 * Sample negative arbitrage examples (prices without opportunities)
 */
async function sampleNegativeArbitrageExamples(
  prisma: PrismaClientType,
  startDate: Date,
  endDate: Date,
  count: number,
  fxRateMap: Map<number, FXRateRecord>
): Promise<ArbitrageTrainingExample[]> {
  const examples: ArbitrageTrainingExample[] = [];

  // Get random price snapshots where arbitrage wasn't detected
  const dailyPrices = await prisma.priceHistoryDaily.findMany({
    where: {
      date: {
        gte: startDate,
        lte: endDate,
      },
    },
    take: count * 2, // Fetch more to account for filtering
    orderBy: { date: "asc" },
  });

  for (const price of dailyPrices) {
    if (examples.length >= count) break;

    const fxRate = findNearestFXRate(price.date, fxRateMap);
    // Note: fxRate always returns a value (defaults if needed)

    // Skip if this card had an arbitrage opportunity detected BEFORE this snapshot
    // IMPORTANT: Only look at past opportunities to prevent temporal leakage
    // Looking into the future (+12h) would contaminate training labels
    const hadOpportunity = await prisma.arbitrageOpportunity.findFirst({
      where: {
        cardId: price.cardId,
        detectedAt: {
          gte: new Date(price.date.getTime() - 12 * 60 * 60 * 1000),
          lte: price.date, // Only look at past, never future
        },
      },
    });

    if (hadOpportunity) continue;

    const usPrice = Number(price.usMarketGbp) / fxRate.usdGbp;
    const euPrice = Number(price.euTrendGbp) / fxRate.eurGbp;

    examples.push({
      cardId: price.cardId,
      timestamp: price.date,
      usMarketUSD: usPrice,
      usLowUSD: usPrice * 0.95, // Estimate low price
      euTrendEUR: euPrice,
      euLowEUR: euPrice * 0.95,
      fxUSDGBP: fxRate.usdGbp,
      fxEURGBP: fxRate.eurGbp,
      spreadEUtoUS: (usPrice - euPrice * fxRate.eurGbp / fxRate.usdGbp) / euPrice,
      spreadUStoEU: (euPrice - usPrice * fxRate.usdGbp / fxRate.eurGbp) / usPrice,
      wasExecuted: false,
      wasSuccessful: undefined,
    });
  }

  return examples;
}

// =============================================================================
// TFT SEQUENCE DATA
// =============================================================================

export interface TFTExportOptions {
  startDate?: Date;
  endDate?: Date;
  cardIds?: string[];
  minPriceGBP?: number;
}

/**
 * Export TFT training sequences for price prediction
 */
export async function exportTFTTrainingSequences(
  prisma: PrismaClientType,
  options: TFTExportOptions = {}
): Promise<TFTTrainingSequence[]> {
  const {
    startDate = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000),
    endDate = new Date(),
    cardIds,
    minPriceGBP = 1,
  } = options;

  const sequences: TFTTrainingSequence[] = [];

  // Get unique cards with sufficient history
  const cards = await getCardsWithHistory(prisma, startDate, endDate, cardIds);

  for (const card of cards) {
    // Get daily price history for this card
    const history = await prisma.priceHistoryDaily.findMany({
      where: {
        cardId: card.cardId,
        date: {
          gte: startDate,
          lte: endDate,
        },
      },
      orderBy: { date: "asc" },
    });

    // Skip if insufficient data
    if (history.length < EXPORT_CONFIG.tft.minDataPoints) continue;

    // Generate sequences with sliding window
    const windowSize = EXPORT_CONFIG.tft.observedDays;
    const targetSize = EXPORT_CONFIG.tft.targetDays;

    for (let i = 0; i <= history.length - windowSize - targetSize; i++) {
      const observed = history.slice(i, i + windowSize);
      const target = history.slice(i + windowSize, i + windowSize + targetSize);

      // Calculate average price for level classification
      const avgPrice =
        observed.reduce((sum, p) => sum + Number(p.usMarketGbp || 0), 0) /
        observed.length;

      if (avgPrice < minPriceGBP) continue;

      const sequence: TFTTrainingSequence = {
        cardId: card.cardId,
        staticFeatures: {
          setCode: card.setCode || extractSetCode(card.cardId),
          rarity: card.rarity || "unknown",
          variantType: card.variantType || "regular",
          avgPriceLevel: classifyPriceLevel(avgPrice),
        },
        observedSequence: observed.map((p) => ({
          date: p.date,
          usMarketGBP: Number(p.usMarketGbp) || 0,
          euTrendGBP: p.euTrendGbp ? Number(p.euTrendGbp) : undefined,
          spread: p.spreadEuToUs ? Number(p.spreadEuToUs) : undefined,
        })),
        targetSequence: target.map((p) => ({
          date: p.date,
          usMarketGBP: Number(p.usMarketGbp) || 0,
          euTrendGBP: p.euTrendGbp ? Number(p.euTrendGbp) : undefined,
        })),
      };

      sequences.push(sequence);
    }
  }

  return sequences;
}

/**
 * Classify price level
 */
function classifyPriceLevel(
  priceGBP: number
): "low" | "medium" | "high" | "premium" {
  const { low, medium, high } = EXPORT_CONFIG.priceLevel;

  if (priceGBP < low) return "low";
  if (priceGBP < medium) return "medium";
  if (priceGBP < high) return "high";
  return "premium";
}

/**
 * Extract set code from card ID
 */
function extractSetCode(cardId: string): string {
  const match = cardId.match(/^(OP\d{2}|ST\d{2}|EB\d{2})/i);
  return match ? match[1].toUpperCase() : "UNKNOWN";
}

// =============================================================================
// DEMAND CLASSIFICATION DATA
// =============================================================================

export interface DemandExportOptions {
  startDate?: Date;
  endDate?: Date;
  lookbackDays?: number;
  predictionDays?: number;
}

/**
 * Export demand classification training examples
 */
export async function exportDemandTrainingData(
  prisma: PrismaClientType,
  options: DemandExportOptions = {}
): Promise<DemandTrainingExample[]> {
  const {
    startDate = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000),
    endDate = new Date(),
    lookbackDays = 30,
    predictionDays = 7,
  } = options;

  const examples: DemandTrainingExample[] = [];

  // Get daily price history with statistics
  const prices = await prisma.priceHistoryDaily.findMany({
    where: {
      date: {
        gte: startDate,
        lte: endDate,
      },
    },
    orderBy: [{ cardId: "asc" }, { date: "asc" }],
  });

  // Group by card
  const cardPrices = groupByCard(prices);

  for (const [cardId, history] of cardPrices) {
    // Need enough history for lookback and prediction
    if (history.length < lookbackDays + predictionDays) continue;

    // CRITICAL: Validate temporal order to prevent data corruption
    const isSorted = history.every(
      (h, i) => i === 0 || h.date >= history[i - 1].date
    );
    if (!isSorted) {
      console.error(`[DemandExport] History for ${cardId} is not sorted by date - skipping`);
      continue;
    }

    // Generate examples with sliding window
    for (let i = lookbackDays; i <= history.length - predictionDays; i++) {
      const lookback = history.slice(i - lookbackDays, i);
      const future = history.slice(i, i + predictionDays);

      // Calculate features from lookback period
      const features = calculateDemandFeatures(lookback);

      // Calculate label from future period
      const label = calculateDemandLabel(lookback, future);

      examples.push({
        cardId,
        timestamp: history[i].date,
        features,
        label,
      });
    }
  }

  return examples;
}

/**
 * Calculate demand features from price history
 */
function calculateDemandFeatures(
  history: PriceHistoryRecord[]
): DemandTrainingExample["features"] {
  const prices = history.map((h) => Number(h.usMarketGbp) || 0);
  const n = prices.length;

  // Calculate changes
  const endPrice = prices[n - 1];

  const change24h = n >= 2 ? (endPrice - prices[n - 2]) / prices[n - 2] : 0;
  const change7d = n >= 7 ? (endPrice - prices[n - 8]) / prices[n - 8] : 0;
  const change30d = n >= 30 ? (endPrice - prices[0]) / prices[0] : 0;

  // Average price
  const avgPrice = prices.reduce((a, b) => a + b, 0) / n;

  // Volatility (standard deviation)
  const variance =
    prices.reduce((sum, p) => sum + Math.pow(p - avgPrice, 2), 0) / n;
  const volatility = Math.sqrt(variance);

  // Trend slope (simple linear regression)
  const xMean = (n - 1) / 2;
  const yMean = avgPrice;
  let numerator = 0;
  let denominator = 0;

  for (let i = 0; i < n; i++) {
    numerator += (i - xMean) * (prices[i] - yMean);
    denominator += (i - xMean) * (i - xMean);
  }

  const trendSlope = denominator !== 0 ? numerator / denominator : 0;

  // Price level (normalized)
  const priceLevel = Math.log10(avgPrice + 1);

  return {
    change24h,
    change7d,
    change30d,
    avgPrice,
    volatility,
    trendSlope,
    priceLevel,
  };
}

/**
 * Calculate demand label from future prices
 */
function calculateDemandLabel(
  lookback: PriceHistoryRecord[],
  future: PriceHistoryRecord[]
): DemandTrainingExample["label"] {
  const currentPrice = Number(lookback[lookback.length - 1].usMarketGbp) || 0;
  const futurePrice = Number(future[future.length - 1].usMarketGbp) || 0;

  const priceChange7d = (futurePrice - currentPrice) / currentPrice;

  // Classify direction
  let direction: DemandTrainingExample["label"]["direction"];
  const { strongUp, up, down, strongDown } = EXPORT_CONFIG.demand;

  if (priceChange7d >= strongUp) {
    direction = "strong_up";
  } else if (priceChange7d >= up) {
    direction = "up";
  } else if (priceChange7d >= down) {
    direction = "flat";
  } else if (priceChange7d >= strongDown) {
    direction = "down";
  } else {
    direction = "strong_down";
  }

  return { priceChange7d, direction };
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

interface FXRateRecord {
  usdGbp: number;
  eurGbp: number;
  fetchedAt: Date;
}

interface PriceHistoryRecord {
  cardId: string;
  date: Date;
  usMarketGbp?: number | null;
  euTrendGbp?: number | null;
  spreadEuToUs?: number | null;
}

interface CardRecord {
  cardId: string;
  setCode?: string;
  rarity?: string;
  variantType?: string;
}

/**
 * Build FX rate lookup map by day
 */
function buildFXRateLookup(
  rates: FXRateRecord[]
): Map<number, FXRateRecord> {
  const map = new Map<number, FXRateRecord>();

  for (const rate of rates) {
    const dayKey = Math.floor(rate.fetchedAt.getTime() / (24 * 60 * 60 * 1000));
    map.set(dayKey, rate);
  }

  return map;
}

// Default FX rates as fallback (prevents silent data loss)
const DEFAULT_FX_RATES: FXRateRecord = {
  usdGbp: 0.79,
  eurGbp: 0.85,
  fetchedAt: new Date(0), // Epoch = obviously a fallback
};

/**
 * Find nearest FX rate to a given date
 * IMPORTANT: Only searches BACKWARDS in time to prevent temporal leakage
 */
function findNearestFXRate(
  date: Date,
  rateMap: Map<number, FXRateRecord>
): FXRateRecord {
  const dayKey = Math.floor(date.getTime() / (24 * 60 * 60 * 1000));

  // Try exact match first
  if (rateMap.has(dayKey)) {
    return rateMap.get(dayKey)!;
  }

  // Search ONLY backwards - never use future FX rates (temporal leakage)
  for (let offset = 1; offset <= 7; offset++) {
    if (rateMap.has(dayKey - offset)) {
      return rateMap.get(dayKey - offset)!;
    }
    // REMOVED: forward search (dayKey + offset) to prevent leakage
  }

  // Fallback to defaults with warning (prevents silent data loss)
  console.warn(`[FX] No rate found within 7 days before ${date.toISOString()}, using defaults`);
  return DEFAULT_FX_RATES;
}

/**
 * Get cards with sufficient price history
 */
async function getCardsWithHistory(
  prisma: PrismaClientType,
  startDate: Date,
  endDate: Date,
  cardIds?: string[]
): Promise<CardRecord[]> {
  const whereClause: Record<string, unknown> = {};

  if (cardIds && cardIds.length > 0) {
    whereClause.cardId = { in: cardIds };
  }

  // Get distinct cards from price history
  const cards = await prisma.priceHistoryDaily.findMany({
    where: {
      ...whereClause,
      date: {
        gte: startDate,
        lte: endDate,
      },
    },
    distinct: ["cardId"],
    select: {
      cardId: true,
    },
  });

  return cards.map((c) => ({
    cardId: c.cardId,
  }));
}

/**
 * Group price history by card
 */
function groupByCard(
  prices: PriceHistoryRecord[]
): Map<string, PriceHistoryRecord[]> {
  const groups = new Map<string, PriceHistoryRecord[]>();

  for (const price of prices) {
    const existing = groups.get(price.cardId) || [];
    existing.push(price);
    groups.set(price.cardId, existing);
  }

  return groups;
}

// =============================================================================
// EXPORT FORMATS
// =============================================================================

/**
 * Export training data to JSON format
 */
export function exportToJSON<T>(data: T[]): string {
  return JSON.stringify(data, null, 2);
}

/**
 * Export training data to JSONL format (one JSON object per line)
 */
export function exportToJSONL<T>(data: T[]): string {
  return data.map((item) => JSON.stringify(item)).join("\n");
}

/**
 * Export arbitrage examples to CSV format
 */
export function exportArbitrageToCSV(
  examples: ArbitrageTrainingExample[]
): string {
  const headers = [
    "cardId",
    "timestamp",
    "usMarketUSD",
    "usLowUSD",
    "euTrendEUR",
    "euLowEUR",
    "fxUSDGBP",
    "fxEURGBP",
    "spreadEUtoUS",
    "spreadUStoEU",
    "wasExecuted",
    "actualProfit",
    "wasSuccessful",
  ];

  const rows = examples.map((ex) =>
    [
      ex.cardId,
      ex.timestamp.toISOString(),
      ex.usMarketUSD,
      ex.usLowUSD,
      ex.euTrendEUR,
      ex.euLowEUR,
      ex.fxUSDGBP,
      ex.fxEURGBP,
      ex.spreadEUtoUS,
      ex.spreadUStoEU,
      ex.wasExecuted ? 1 : 0,
      ex.actualProfit ?? "",
      ex.wasSuccessful === undefined ? "" : ex.wasSuccessful ? 1 : 0,
    ].join(",")
  );

  return [headers.join(","), ...rows].join("\n");
}

/**
 * Export demand examples to CSV format
 */
export function exportDemandToCSV(examples: DemandTrainingExample[]): string {
  const headers = [
    "cardId",
    "timestamp",
    "change24h",
    "change7d",
    "change30d",
    "avgPrice",
    "volatility",
    "trendSlope",
    "priceLevel",
    "priceChange7d",
    "direction",
  ];

  const rows = examples.map((ex) =>
    [
      ex.cardId,
      ex.timestamp.toISOString(),
      ex.features.change24h,
      ex.features.change7d,
      ex.features.change30d,
      ex.features.avgPrice,
      ex.features.volatility,
      ex.features.trendSlope,
      ex.features.priceLevel,
      ex.label.priceChange7d,
      ex.label.direction,
    ].join(",")
  );

  return [headers.join(","), ...rows].join("\n");
}

// Type placeholder for Prisma client
type PrismaClientType = {
  arbitrageOpportunity: {
    findMany: (args: Record<string, unknown>) => Promise<ArbitrageOppRecord[]>;
    findFirst: (args: Record<string, unknown>) => Promise<ArbitrageOppRecord | null>;
  };
  fXRate: {
    findMany: (args: Record<string, unknown>) => Promise<FXRateRecord[]>;
  };
  marketPriceUS: {
    findFirst: (args: Record<string, unknown>) => Promise<USPriceRecord | null>;
  };
  marketPriceEU: {
    findFirst: (args: Record<string, unknown>) => Promise<EUPriceRecord | null>;
  };
  priceHistoryDaily: {
    findMany: (args: Record<string, unknown>) => Promise<PriceHistoryRecord[]>;
  };
};

interface ArbitrageOppRecord {
  cardId: string;
  detectedAt: Date;
  grossSpread: number | string;
  netSpread: number | string;
  wasExecuted: boolean | null;
  actualProfit: number | string | null;
  wasSuccessful: boolean | null;
}

interface USPriceRecord {
  marketPrice: number | string;
  lowPrice: number | string;
}

interface EUPriceRecord {
  trendPrice: number | string;
  lowPrice: number | string;
}
