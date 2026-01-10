/**
 * Price Aggregator Service
 *
 * Aggregates prices from multiple sources:
 * - US Market: OPTCG API (free) + JustTCG (premium)
 * - EU Market: Cardmarket CSV
 *
 * Performs FX conversion and detects arbitrage opportunities
 */

import type {
  FXRates,
  AggregatedPrice,
  ArbitrageDetectionInput,
  ArbitrageDetectionResult,
  OPTCGCard,
  JustTCGCard,
  CardmarketCSVRow,
} from "../types";

import {
  getOPTCGClient,
  getJustTCGClient,
  getFXRateClient,
  usdToGbp,
  eurToGbp,
  normalizeOPTCGCardId,
  normalizeJustTCGCardId,
} from "../clients";

// =============================================================================
// CONFIGURATION
// =============================================================================

// Arbitrage detection thresholds
const ARBITRAGE_CONFIG = {
  minGrossSpread: 0.15, // 15% minimum spread to consider
  minNetSpread: 0.05, // 5% minimum net profit after fees
  estimatedFees: {
    tcgplayerSeller: 0.1275, // 12.75% TCGplayer seller fee
    cardmarketSeller: 0.05, // 5% Cardmarket seller fee
    paypal: 0.029, // 2.9% PayPal fee
    shipping: {
      usToEu: 15, // USD flat rate
      euToUs: 12, // EUR flat rate
    },
  },
  confidenceWeights: {
    spreadSize: 0.3,
    priceVolatility: 0.2,
    dataRecency: 0.2,
    historicalAccuracy: 0.3,
  },
};

// Price data freshness thresholds (milliseconds)
const FRESHNESS_THRESHOLDS = {
  realtime: 15 * 60 * 1000, // 15 minutes
  fresh: 60 * 60 * 1000, // 1 hour
  stale: 24 * 60 * 60 * 1000, // 24 hours
};

// =============================================================================
// PRICE AGGREGATION
// =============================================================================

export interface AggregationOptions {
  includeArbitrage?: boolean;
  minPriceUSD?: number;
  minPriceEUR?: number;
  cardIds?: string[];
}

export interface AggregationResult {
  prices: AggregatedPrice[];
  fxRates: FXRates;
  timestamp: Date;
  sources: {
    optcg: { cards: number; timestamp?: Date };
    justtcg: { cards: number; timestamp?: Date };
    cardmarket: { cards: number; timestamp?: Date };
  };
  arbitrageOpportunities: ArbitrageDetectionResult[];
}

/**
 * Aggregate prices from all sources
 */
export async function aggregatePrices(
  usPricesOPTCG: OPTCGCard[],
  usPricesJustTCG: JustTCGCard[],
  euPricesCardmarket: CardmarketCSVRow[],
  options: AggregationOptions = {}
): Promise<AggregationResult> {
  const fxClient = getFXRateClient();
  const fxRates = await fxClient.getRates();
  const timestamp = new Date();

  // Build price maps by normalized card ID
  const usPriceMap = buildUSPriceMap(usPricesOPTCG, usPricesJustTCG);
  const euPriceMap = buildEUPriceMap(euPricesCardmarket);

  // Get all unique card IDs
  const allCardIds = new Set([...usPriceMap.keys(), ...euPriceMap.keys()]);

  // Filter by requested card IDs if provided
  const targetCardIds = options.cardIds
    ? new Set(options.cardIds.map((id) => id.toUpperCase()))
    : allCardIds;

  // Aggregate prices for each card
  const prices: AggregatedPrice[] = [];
  const arbitrageOpportunities: ArbitrageDetectionResult[] = [];

  for (const cardId of allCardIds) {
    if (!targetCardIds.has(cardId)) continue;

    const usData = usPriceMap.get(cardId);
    const euData = euPriceMap.get(cardId);

    // Skip if below minimum price thresholds
    if (
      options.minPriceUSD &&
      usData &&
      usData.marketPrice < options.minPriceUSD
    ) {
      continue;
    }
    if (options.minPriceEUR && euData && euData.trendPrice < options.minPriceEUR) {
      continue;
    }

    const aggregated = buildAggregatedPrice(cardId, usData, euData, fxRates);
    prices.push(aggregated);

    // Detect arbitrage if requested
    if (options.includeArbitrage && usData && euData) {
      const arbitrage = detectArbitrage({
        cardId,
        usPrice: {
          market: usData.marketPrice,
          low: usData.lowPrice,
          currency: "USD",
        },
        euPrice: {
          trend: euData.trendPrice,
          low: euData.lowPrice || euData.trendPrice,
          currency: "EUR",
        },
        fxRates,
      });

      if (arbitrage.hasOpportunity) {
        arbitrageOpportunities.push(arbitrage);
      }
    }
  }

  return {
    prices,
    fxRates,
    timestamp,
    sources: {
      optcg: {
        cards: usPricesOPTCG.length,
        timestamp: usPricesOPTCG[0]
          ? new Date(usPricesOPTCG[0].date_scraped)
          : undefined,
      },
      justtcg: {
        cards: usPricesJustTCG.length,
        timestamp: usPricesJustTCG[0]
          ? new Date(usPricesJustTCG[0].lastUpdated)
          : undefined,
      },
      cardmarket: {
        cards: euPricesCardmarket.length,
        timestamp: euPricesCardmarket[0]?.updatedAt
          ? new Date(euPricesCardmarket[0].updatedAt)
          : undefined,
      },
    },
    arbitrageOpportunities,
  };
}

// =============================================================================
// PRICE MAP BUILDERS
// =============================================================================

interface USPriceData {
  source: "optcg" | "justtcg";
  marketPrice: number;
  lowPrice: number;
  change24h?: number;
  change7d?: number;
  change30d?: number;
  timestamp: Date;
  // Volume/inventory metrics from JustTCG variants
  listingsCount?: number;
  conditionsAvailable?: number;
}

interface EUPriceData {
  source: "cardmarket_csv";
  trendPrice: number;
  avgPrice?: number;
  lowPrice?: number;
  timestamp: Date;
  // Inventory signals from Cardmarket CSV
  availableItems?: number;
  availableFoils?: number;
}

/**
 * Build US price map from OPTCG and JustTCG data
 * Prefers JustTCG (more statistics) over OPTCG when both available
 */
function buildUSPriceMap(
  optcgCards: OPTCGCard[],
  justTCGCards: JustTCGCard[]
): Map<string, USPriceData> {
  const priceMap = new Map<string, USPriceData>();

  // Add OPTCG prices first (as fallback)
  for (const card of optcgCards) {
    const normalizedId = normalizeOPTCGCardId(card.card_set_id);

    priceMap.set(normalizedId, {
      source: "optcg",
      marketPrice: card.market_price,
      lowPrice: card.inventory_price,
      timestamp: new Date(card.date_scraped),
      // OPTCG doesn't provide listings count
      listingsCount: undefined,
      conditionsAvailable: undefined,
    });
  }

  // Override with JustTCG prices (preferred source)
  for (const card of justTCGCards) {
    const normalizedId = normalizeJustTCGCardId(card.id);

    // Extract volume metrics from variants
    const variants = card.variants || [];
    const pricedVariants = variants.filter((v) => v.price > 0);
    const uniqueConditions = new Set(pricedVariants.map((v) => v.condition));

    priceMap.set(normalizedId, {
      source: "justtcg",
      marketPrice: card.price,
      lowPrice: card.variants?.[0]?.price || card.price,
      change24h: card.statistics?.change24h,
      change7d: card.statistics?.change7d,
      change30d: card.statistics?.change30d,
      timestamp: new Date(card.lastUpdated),
      // Volume metrics from variant data
      listingsCount: pricedVariants.length,
      conditionsAvailable: uniqueConditions.size,
    });
  }

  return priceMap;
}

/**
 * Build EU price map from Cardmarket CSV data
 */
function buildEUPriceMap(
  cardmarketRows: CardmarketCSVRow[]
): Map<string, EUPriceData> {
  const priceMap = new Map<string, EUPriceData>();

  for (const row of cardmarketRows) {
    // Try to extract card ID from Cardmarket product ID or name
    // Cardmarket uses different ID format, so we need to normalize
    const cardId = extractCardIdFromCardmarket(row);

    if (cardId) {
      priceMap.set(cardId, {
        source: "cardmarket_csv",
        trendPrice: row.trendPrice,
        avgPrice: row.avgSellPrice,
        lowPrice: row.lowPrice,
        timestamp: row.updatedAt ? new Date(row.updatedAt) : new Date(),
        // Inventory signals from Cardmarket CSV
        availableItems: row.availableItems,
        availableFoils: row.availableFoils,
      });
    }
  }

  return priceMap;
}

/**
 * Extract normalized card ID from Cardmarket data
 */
function extractCardIdFromCardmarket(row: CardmarketCSVRow): string | null {
  // Try to find card number pattern in name
  const match = row.name.match(/\b(OP\d{2}|ST\d{2}|EB\d{2})-(\d{3})\b/i);
  if (match) {
    return `${match[1].toUpperCase()}-${match[2]}`;
  }

  // Use product ID as fallback (will need mapping table)
  return null;
}

// =============================================================================
// AGGREGATED PRICE BUILDER
// =============================================================================

/**
 * Build aggregated price record with FX conversion
 */
function buildAggregatedPrice(
  cardId: string,
  usData: USPriceData | undefined,
  euData: EUPriceData | undefined,
  fxRates: FXRates
): AggregatedPrice {
  const aggregated: AggregatedPrice = {
    cardId,
    timestamp: new Date(),
  };

  // US Market data
  if (usData) {
    aggregated.us = {
      source: usData.source,
      marketPrice: usData.marketPrice,
      lowPrice: usData.lowPrice,
      marketPriceGBP: usdToGbp(usData.marketPrice, fxRates),
      lowPriceGBP: usdToGbp(usData.lowPrice, fxRates),
      change24h: usData.change24h,
      change7d: usData.change7d,
      change30d: usData.change30d,
      // Volume metrics
      listingsCount: usData.listingsCount,
      conditionsAvailable: usData.conditionsAvailable,
    };
  }

  // EU Market data
  if (euData) {
    aggregated.eu = {
      source: euData.source,
      trendPrice: euData.trendPrice,
      lowPrice: euData.lowPrice || euData.trendPrice,
      avgPrice: euData.avgPrice,
      trendPriceGBP: eurToGbp(euData.trendPrice, fxRates),
      lowPriceGBP: eurToGbp(euData.lowPrice || euData.trendPrice, fxRates),
      // Inventory signals
      availableItems: euData.availableItems,
      availableFoils: euData.availableFoils,
    };
  }

  // Calculate arbitrage if both markets available
  if (usData && euData) {
    const arbitrage = calculateArbitrageSpread(usData, euData, fxRates);
    aggregated.arbitrage = arbitrage;
  }

  return aggregated;
}

// =============================================================================
// ARBITRAGE DETECTION
// =============================================================================

/**
 * Calculate arbitrage spread between US and EU markets
 */
function calculateArbitrageSpread(
  usData: USPriceData,
  euData: EUPriceData,
  fxRates: FXRates
): AggregatedPrice["arbitrage"] {
  const usMarketGBP = usdToGbp(usData.marketPrice, fxRates);
  const euTrendGBP = eurToGbp(euData.trendPrice, fxRates);

  // Spread EU to US: Buy from EU (cheaper), sell in US (higher)
  const spreadEUtoUS = (usMarketGBP - euTrendGBP) / euTrendGBP;

  // Spread US to EU: Buy from US (cheaper), sell in EU (higher)
  const spreadUStoEU = (euTrendGBP - usMarketGBP) / usMarketGBP;

  // Determine best direction
  let bestDirection: "EU_TO_US" | "US_TO_EU" | "NONE" = "NONE";
  let grossSpread = 0;

  if (spreadEUtoUS > spreadUStoEU && spreadEUtoUS > ARBITRAGE_CONFIG.minGrossSpread) {
    bestDirection = "EU_TO_US";
    grossSpread = spreadEUtoUS;
  } else if (spreadUStoEU > ARBITRAGE_CONFIG.minGrossSpread) {
    bestDirection = "US_TO_EU";
    grossSpread = spreadUStoEU;
  }

  // Estimate fees and net spread
  const estimatedFees = calculateEstimatedFees(
    bestDirection,
    usData.marketPrice,
    euData.trendPrice
  );

  const estimatedShipping =
    bestDirection === "EU_TO_US"
      ? usdToGbp(ARBITRAGE_CONFIG.estimatedFees.shipping.euToUs, fxRates)
      : bestDirection === "US_TO_EU"
        ? eurToGbp(ARBITRAGE_CONFIG.estimatedFees.shipping.usToEu, fxRates)
        : 0;

  const netSpread = grossSpread - estimatedFees - estimatedShipping / Math.max(usMarketGBP, euTrendGBP);

  return {
    spreadEUtoUS,
    spreadUStoEU,
    bestDirection,
    grossSpread,
    estimatedNetSpread: Math.max(0, netSpread),
    estimatedFees,
    estimatedShipping,
  };
}

/**
 * Calculate estimated fees as a percentage
 */
function calculateEstimatedFees(
  direction: "EU_TO_US" | "US_TO_EU" | "NONE",
  usPriceUSD: number,
  euPriceEUR: number
): number {
  if (direction === "NONE") return 0;

  const { tcgplayerSeller, cardmarketSeller, paypal } =
    ARBITRAGE_CONFIG.estimatedFees;

  if (direction === "EU_TO_US") {
    // Buy from EU (Cardmarket fees minimal), sell on US (TCGplayer fees)
    return tcgplayerSeller + paypal;
  } else {
    // Buy from US (TCGplayer buyer fees ~0), sell on EU (Cardmarket fees)
    return cardmarketSeller + paypal;
  }
}

/**
 * Detect arbitrage opportunity with confidence scoring
 */
export function detectArbitrage(
  input: ArbitrageDetectionInput
): ArbitrageDetectionResult {
  const { cardId, usPrice, euPrice, fxRates } = input;

  // Convert to GBP for comparison
  const usMarketGBP = usPrice ? usdToGbp(usPrice.market, fxRates) : 0;
  const usLowGBP = usPrice ? usdToGbp(usPrice.low, fxRates) : 0;
  const euTrendGBP = euPrice ? eurToGbp(euPrice.trend, fxRates) : 0;
  const euLowGBP = euPrice ? eurToGbp(euPrice.low, fxRates) : 0;

  // Need both markets for arbitrage
  if (!usPrice || !euPrice) {
    return { cardId, hasOpportunity: false };
  }

  // Calculate spreads
  const spreadEUtoUS = (usMarketGBP - euLowGBP) / euLowGBP;
  const spreadUStoEU = (euTrendGBP - usLowGBP) / usLowGBP;

  // Determine best direction
  let bestDirection: "EU_TO_US" | "US_TO_EU" | null = null;
  let buyMarket = "";
  let buyPrice = 0;
  let buyCurrency = "";
  let buyPriceGBP = 0;
  let sellMarket = "";
  let sellPrice = 0;
  let sellCurrency = "";
  let sellPriceGBP = 0;
  let grossSpread = 0;

  if (
    spreadEUtoUS > spreadUStoEU &&
    spreadEUtoUS > ARBITRAGE_CONFIG.minGrossSpread
  ) {
    bestDirection = "EU_TO_US";
    buyMarket = "Cardmarket";
    buyPrice = euPrice.low;
    buyCurrency = "EUR";
    buyPriceGBP = euLowGBP;
    sellMarket = "TCGplayer";
    sellPrice = usPrice.market;
    sellCurrency = "USD";
    sellPriceGBP = usMarketGBP;
    grossSpread = spreadEUtoUS;
  } else if (spreadUStoEU > ARBITRAGE_CONFIG.minGrossSpread) {
    bestDirection = "US_TO_EU";
    buyMarket = "TCGplayer";
    buyPrice = usPrice.low;
    buyCurrency = "USD";
    buyPriceGBP = usLowGBP;
    sellMarket = "Cardmarket";
    sellPrice = euPrice.trend;
    sellCurrency = "EUR";
    sellPriceGBP = euTrendGBP;
    grossSpread = spreadUStoEU;
  }

  if (!bestDirection) {
    return { cardId, hasOpportunity: false };
  }

  // Calculate fees
  const estimatedFees = calculateEstimatedFees(
    bestDirection,
    usPrice.market,
    euPrice.trend
  );

  const estimatedShipping =
    bestDirection === "EU_TO_US"
      ? usdToGbp(ARBITRAGE_CONFIG.estimatedFees.shipping.euToUs, fxRates)
      : eurToGbp(ARBITRAGE_CONFIG.estimatedFees.shipping.usToEu, fxRates);

  // Net spread after fees
  const netSpread =
    grossSpread - estimatedFees - estimatedShipping / sellPriceGBP;

  if (netSpread < ARBITRAGE_CONFIG.minNetSpread) {
    return { cardId, hasOpportunity: false };
  }

  // Calculate confidence score
  const confidence = calculateConfidence(
    grossSpread,
    netSpread,
    buyPriceGBP,
    sellPriceGBP
  );

  // Determine urgency
  const urgency = determineUrgency(grossSpread, netSpread);

  return {
    cardId,
    hasOpportunity: true,
    opportunity: {
      buyMarket,
      buyPrice,
      buyCurrency,
      buyPriceGBP,
      sellMarket,
      sellPrice,
      sellCurrency,
      sellPriceGBP,
      grossSpread,
      estimatedFees,
      estimatedShipping,
      netSpread,
      confidence,
      urgency,
    },
  };
}

/**
 * Calculate confidence score for arbitrage opportunity
 */
function calculateConfidence(
  grossSpread: number,
  netSpread: number,
  buyPriceGBP: number,
  sellPriceGBP: number
): number {
  const { confidenceWeights } = ARBITRAGE_CONFIG;

  // Spread size score (higher spread = more confidence)
  const spreadScore = Math.min(1, grossSpread / 0.5) * confidenceWeights.spreadSize;

  // Price level score (higher prices = more reliable data)
  const avgPrice = (buyPriceGBP + sellPriceGBP) / 2;
  const priceScore =
    Math.min(1, avgPrice / 50) * confidenceWeights.priceVolatility;

  // Data recency score (placeholder - would need actual timestamps)
  const recencyScore = 0.8 * confidenceWeights.dataRecency;

  // Historical accuracy score (placeholder - would need feedback data)
  const historicalScore = 0.7 * confidenceWeights.historicalAccuracy;

  return Math.min(1, spreadScore + priceScore + recencyScore + historicalScore);
}

/**
 * Determine urgency level for arbitrage opportunity
 */
function determineUrgency(
  grossSpread: number,
  netSpread: number
): "immediate" | "short" | "medium" | "low" {
  if (grossSpread > 0.4 && netSpread > 0.2) {
    return "immediate";
  }
  if (grossSpread > 0.3 && netSpread > 0.15) {
    return "short";
  }
  if (grossSpread > 0.2 && netSpread > 0.1) {
    return "medium";
  }
  return "low";
}

// =============================================================================
// BATCH PROCESSING
// =============================================================================

/**
 * Process all prices and store in database
 */
export async function processAndStorePrices(
  prisma: PrismaClientType,
  result: AggregationResult
): Promise<{
  usPricesStored: number;
  euPricesStored: number;
  arbitrageStored: number;
}> {
  let usPricesStored = 0;
  let euPricesStored = 0;
  let arbitrageStored = 0;

  // Store FX rates
  await prisma.fXRate.create({
    data: {
      usdGbp: result.fxRates.USDGBP,
      eurGbp: result.fxRates.EURGBP,
      jpyGbp: result.fxRates.JPYGBP,
      fetchedAt: result.timestamp,
    },
  });

  // Process each aggregated price
  for (const price of result.prices) {
    // Store US market price
    if (price.us) {
      await prisma.marketPriceUS.upsert({
        where: {
          cardId_source: {
            cardId: price.cardId,
            source: price.us.source,
          },
        },
        update: {
          marketPrice: price.us.marketPrice,
          lowPrice: price.us.lowPrice,
          marketPriceGbp: price.us.marketPriceGBP,
          lowPriceGbp: price.us.lowPriceGBP,
          change24h: price.us.change24h,
          change7d: price.us.change7d,
          change30d: price.us.change30d,
          // Volume metrics from JustTCG variants
          listingsCount: price.us.listingsCount,
          conditionsAvailable: price.us.conditionsAvailable,
          updatedAt: price.timestamp,
        },
        create: {
          cardId: price.cardId,
          source: price.us.source,
          marketPrice: price.us.marketPrice,
          lowPrice: price.us.lowPrice,
          marketPriceGbp: price.us.marketPriceGBP,
          lowPriceGbp: price.us.lowPriceGBP,
          change24h: price.us.change24h,
          change7d: price.us.change7d,
          change30d: price.us.change30d,
          // Volume metrics from JustTCG variants
          listingsCount: price.us.listingsCount,
          conditionsAvailable: price.us.conditionsAvailable,
          updatedAt: price.timestamp,
        },
      });
      usPricesStored++;
    }

    // Store EU market price
    if (price.eu) {
      await prisma.marketPriceEU.upsert({
        where: {
          cardId_source: {
            cardId: price.cardId,
            source: price.eu.source,
          },
        },
        update: {
          trendPrice: price.eu.trendPrice,
          avgPrice: price.eu.avgPrice,
          lowPrice: price.eu.lowPrice,
          trendPriceGbp: price.eu.trendPriceGBP,
          lowPriceGbp: price.eu.lowPriceGBP,
          // Inventory signals from Cardmarket CSV
          availableItems: price.eu.availableItems,
          availableFoils: price.eu.availableFoils,
          updatedAt: price.timestamp,
        },
        create: {
          cardId: price.cardId,
          source: price.eu.source,
          trendPrice: price.eu.trendPrice,
          avgPrice: price.eu.avgPrice,
          lowPrice: price.eu.lowPrice,
          trendPriceGbp: price.eu.trendPriceGBP,
          lowPriceGbp: price.eu.lowPriceGBP,
          // Inventory signals from Cardmarket CSV
          availableItems: price.eu.availableItems,
          availableFoils: price.eu.availableFoils,
          updatedAt: price.timestamp,
        },
      });
      euPricesStored++;
    }
  }

  // Store arbitrage opportunities
  for (const arb of result.arbitrageOpportunities) {
    if (arb.hasOpportunity && arb.opportunity) {
      await prisma.arbitrageOpportunity.create({
        data: {
          cardId: arb.cardId,
          buyMarket: arb.opportunity.buyMarket,
          buyPrice: arb.opportunity.buyPrice,
          buyCurrency: arb.opportunity.buyCurrency,
          buyPriceGbp: arb.opportunity.buyPriceGBP,
          sellMarket: arb.opportunity.sellMarket,
          sellPrice: arb.opportunity.sellPrice,
          sellCurrency: arb.opportunity.sellCurrency,
          sellPriceGbp: arb.opportunity.sellPriceGBP,
          grossSpread: arb.opportunity.grossSpread,
          netSpread: arb.opportunity.netSpread,
          estimatedFees: arb.opportunity.estimatedFees,
          estimatedShipping: arb.opportunity.estimatedShipping,
          confidence: arb.opportunity.confidence,
          urgency: arb.opportunity.urgency,
          detectedAt: result.timestamp,
        },
      });
      arbitrageStored++;
    }
  }

  return { usPricesStored, euPricesStored, arbitrageStored };
}

// Type placeholder for Prisma client (imported at runtime)
type PrismaClientType = {
  fXRate: {
    create: (args: { data: Record<string, unknown> }) => Promise<unknown>;
  };
  marketPriceUS: {
    upsert: (args: {
      where: Record<string, unknown>;
      update: Record<string, unknown>;
      create: Record<string, unknown>;
    }) => Promise<unknown>;
  };
  marketPriceEU: {
    upsert: (args: {
      where: Record<string, unknown>;
      update: Record<string, unknown>;
      create: Record<string, unknown>;
    }) => Promise<unknown>;
  };
  arbitrageOpportunity: {
    create: (args: { data: Record<string, unknown> }) => Promise<unknown>;
  };
};
