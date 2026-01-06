/**
 * TCG-100 Index Engine
 *
 * Modeled after NASDAQ-100 methodology:
 * - Modified market-cap weighted index
 * - Weight capping to prevent concentration
 * - Buffer zone (ranks 76-100) to reduce turnover
 * - Monthly reconstitution + weekly rebalancing
 * - Separate EN/JP indices for language comparison
 *
 * @see https://indexes.nasdaq.com/docs/Methodology_NDX.pdf
 */

import { Prisma } from "@prisma/client";
import prisma from "../db.server";
import { logger, metrics, withTrace } from "./observability.server";

// ============================================================================
// Types
// ============================================================================

export type Language = "EN" | "JP" | "ALL";

/**
 * Language comparison result - compares EN vs JP market performance
 */
export interface LanguageComparisonResult {
  en: TCG100Result | null;
  jp: TCG100Result | null;
  comparison: {
    indexDiff: number;           // EN index - JP index
    indexDiffPercent: number;    // % difference
    change24hDiff: number;       // EN 24h change - JP 24h change
    volatilityDiff: number;      // EN volatility - JP volatility
    marketCapRatio: number;      // EN market cap / JP market cap
    avgPriceRatio: number;       // EN avg price / JP avg price
    correlation7d: number | null; // 7-day price correlation
  };
  timestamp: Date;
}

/**
 * Index constituent - a card in the TCG-100 index
 */
export interface IndexConstituent {
  cardId: string;
  name: string;
  setCode: string | null;
  releaseSet: string | null;
  rarity: string | null;
  imageUrl: string | null;

  // Pricing (GBP)
  priceGbp: number;
  previousPriceGbp: number;
  change24h: number;
  change7d: number;

  // Japanese pricing (for dual currency display)
  priceJpy: number | null;
  previousPriceJpy: number | null;
  changeJpy24h: number | null;

  // Index weighting
  marketCap: number; // price × volume factor
  rawWeight: number; // before capping (as decimal, e.g., 0.15 = 15%)
  cappedWeight: number; // after applying concentration rules
  weightAdjustment: "none" | "capped" | "redistributed";

  // Rankings
  rank: number; // 1-100 position
  previousRank: number | null;
  rankChange: number;

  // Eligibility
  daysInIndex: number;
  eligibleForRemoval: boolean;
  inBufferZone: boolean; // ranks 76-100

  // Volume/activity metrics
  priceChangesLast7d: number; // count of price updates
  volatility: number;
}

/**
 * Index calculation result
 */
export interface TCG100Result {
  // Language
  language: Language;

  // Core metrics
  value: number; // Index value (weighted average price)
  previousValue: number;
  change24h: number;
  change7d: number;
  change30d: number;

  // JPY-denominated (for Japanese market comparison)
  valueJpy: number | null;
  changeJpy24h: number | null;

  // Market stats
  totalMarketCap: number;
  avgPrice: number;
  medianPrice: number;
  highPrice: number;
  lowPrice: number;

  // Constituents
  constituents: IndexConstituent[];
  constituentCount: number;

  // Weight distribution
  largestWeight: number;
  top5Weight: number;
  concentrationIndex: number; // Herfindahl index for concentration

  // Volatility
  volatilityIndex: number;

  // Metadata
  calculatedAt: Date;
  lastReconstitution: Date | null;
  nextReconstitution: Date;
  lastRebalance: Date | null;
  nextRebalance: Date;
}

/**
 * Weight capping configuration (NASDAQ-100 style)
 */
export interface WeightCappingConfig {
  maxSingleWeight: number; // 24% for NASDAQ, we'll use same
  maxConcentratedWeight: number; // 48% aggregate of >4.5% cards
  concentrationThreshold: number; // 4.5% threshold
  top5MaxAggregate: number; // 40% for top 5 after adjustment
  nonTop5Cap: number; // 4.4% for cards outside top 5
}

/**
 * Eligibility criteria for index inclusion
 */
export interface EligibilityCriteria {
  minPriceGbp: number; // Minimum card value
  minDaysListed: number; // Minimum days with price data
  minPriceUpdates: number; // Minimum price changes (activity)
  requiresRecentPrice: boolean; // Must have price in last 7 days
}

/**
 * Reconstitution result
 */
export interface ReconstitutionResult {
  additions: string[]; // Card IDs added
  removals: string[]; // Card IDs removed
  retained: string[]; // Cards that stayed
  bufferZoneProtected: string[]; // Cards protected by buffer zone
  timestamp: Date;
}

// ============================================================================
// Constants
// ============================================================================

export const DEFAULT_WEIGHT_CAPPING: WeightCappingConfig = {
  maxSingleWeight: 0.24, // 24% max for single card
  maxConcentratedWeight: 0.48, // 48% max aggregate for >4.5% cards
  concentrationThreshold: 0.045, // 4.5% threshold
  top5MaxAggregate: 0.40, // 40% for top 5 after adjustment
  nonTop5Cap: 0.044, // 4.4% for cards outside top 5
};

export const DEFAULT_ELIGIBILITY: EligibilityCriteria = {
  minPriceGbp: 1.0, // Min £1 value
  minDaysListed: 7, // Min 7 days of data
  minPriceUpdates: 3, // At least 3 price updates
  requiresRecentPrice: true,
};

// Buffer zone: Top 75 guaranteed, 76-100 protected if current members
const GUARANTEED_INCLUSION_RANK = 75;
const BUFFER_ZONE_END = 100;
const INDEX_SIZE = 100;

// Reconstitution schedule
const RECONSTITUTION_DAY = 1; // 1st of month
const REBALANCE_WEEKDAY = 1; // Monday

// ============================================================================
// Core Index Calculation
// ============================================================================

/**
 * Calculate the TCG-100 index with NASDAQ-style weighting
 */
export async function calculateTCG100(
  game: string = "onepiece",
  language: Language = "ALL",
  weightConfig: WeightCappingConfig = DEFAULT_WEIGHT_CAPPING
): Promise<TCG100Result> {
  return withTrace("tcg100.calculate", { game, language }, async (trace) => {
    // 1. Get eligible cards ranked by market cap
    const eligibleCards = await getEligibleCards(game, DEFAULT_ELIGIBILITY, language);
    trace.addAttribute("eligibleCount", eligibleCards.length);

    if (eligibleCards.length === 0) {
      return createEmptyResult(language);
    }

    // 2. Get current constituents (for buffer zone protection)
    const indexKey = language === "ALL" ? game : `${game}_${language}`;
    const currentConstituents = await getCurrentConstituents(indexKey);
    const currentIds = new Set(currentConstituents.map((c) => c.cardId));

    // 3. Select top 100 with buffer zone rules
    const selectedCards = selectConstituentsWithBufferZone(
      eligibleCards,
      currentIds
    );
    trace.addAttribute("selectedCount", selectedCards.length);

    // 4. Calculate raw weights (market-cap based)
    const totalMarketCap = selectedCards.reduce((sum, c) => sum + c.marketCap, 0);
    const cardsWithRawWeights = selectedCards.map((card) => ({
      ...card,
      rawWeight: totalMarketCap > 0 ? card.marketCap / totalMarketCap : 1 / selectedCards.length,
    }));

    // 5. Apply NASDAQ-style weight capping
    const cardsWithCappedWeights = applyWeightCapping(
      cardsWithRawWeights,
      weightConfig
    );

    // 6. Get historical data for change calculations
    const [change24h, change7d, change30d, previousValue] = await Promise.all([
      getIndexChange(game, 1),
      getIndexChange(game, 7),
      getIndexChange(game, 30),
      getPreviousIndexValue(game, 1),
    ]);

    // 7. Calculate index value (weighted average)
    const indexValue = cardsWithCappedWeights.reduce(
      (sum, c) => sum + c.priceGbp * c.cappedWeight,
      0
    );

    // 8. Calculate statistics
    const prices = cardsWithCappedWeights.map((c) => c.priceGbp);
    const sortedPrices = [...prices].sort((a, b) => a - b);
    const medianPrice =
      sortedPrices.length > 0
        ? sortedPrices[Math.floor(sortedPrices.length / 2)]
        : 0;

    // Calculate volatility (std dev of weights × price changes)
    const avgChange = cardsWithCappedWeights.reduce((sum, c) => sum + c.change24h, 0) / cardsWithCappedWeights.length;
    const volatilityIndex = Math.sqrt(
      cardsWithCappedWeights.reduce(
        (sum, c) => sum + Math.pow(c.change24h - avgChange, 2) * c.cappedWeight,
        0
      )
    );

    // Calculate concentration (Herfindahl index)
    const concentrationIndex = cardsWithCappedWeights.reduce(
      (sum, c) => sum + Math.pow(c.cappedWeight, 2),
      0
    );

    // Top 5 weight
    const top5Weight = cardsWithCappedWeights
      .slice(0, 5)
      .reduce((sum, c) => sum + c.cappedWeight, 0);

    // Calculate JPY value if available
    const jpyPrices = cardsWithCappedWeights.filter((c) => c.priceJpy !== null);
    const valueJpy =
      jpyPrices.length > 0
        ? jpyPrices.reduce(
            (sum, c) => sum + (c.priceJpy ?? 0) * c.cappedWeight,
            0
          )
        : null;

    // Get reconstitution dates
    const now = new Date();
    const lastReconstitution = await getLastReconstitutionDate(game);
    const nextReconstitution = getNextReconstitutionDate(now);
    const lastRebalance = await getLastRebalanceDate(game);
    const nextRebalance = getNextRebalanceDate(now);

    metrics.increment("tcg100.calculated");

    const result: TCG100Result = {
      language,
      value: indexValue,
      previousValue,
      change24h,
      change7d,
      change30d,
      valueJpy,
      changeJpy24h: null, // TODO: Calculate from JPY history
      totalMarketCap,
      avgPrice: totalMarketCap / cardsWithCappedWeights.length,
      medianPrice,
      highPrice: Math.max(...prices),
      lowPrice: Math.min(...prices),
      constituents: cardsWithCappedWeights,
      constituentCount: cardsWithCappedWeights.length,
      largestWeight: Math.max(...cardsWithCappedWeights.map((c) => c.cappedWeight)),
      top5Weight,
      concentrationIndex,
      volatilityIndex,
      calculatedAt: new Date(),
      lastReconstitution,
      nextReconstitution,
      lastRebalance,
      nextRebalance,
    };

    return result;
  });
}

/**
 * Calculate and compare EN vs JP indices
 */
export async function calculateLanguageComparison(
  game: string = "onepiece"
): Promise<LanguageComparisonResult> {
  return withTrace("tcg100.languageComparison", { game }, async (trace) => {
    // Calculate both indices in parallel
    const [enIndex, jpIndex] = await Promise.all([
      calculateTCG100(game, "EN"),
      calculateTCG100(game, "JP"),
    ]);

    trace.addAttribute("enCards", enIndex.constituentCount);
    trace.addAttribute("jpCards", jpIndex.constituentCount);

    // Calculate comparison metrics
    const indexDiff = enIndex.value - jpIndex.value;
    const avgValue = (enIndex.value + jpIndex.value) / 2;
    const indexDiffPercent = avgValue > 0 ? (indexDiff / avgValue) * 100 : 0;

    const comparison = {
      indexDiff,
      indexDiffPercent,
      change24hDiff: enIndex.change24h - jpIndex.change24h,
      volatilityDiff: enIndex.volatilityIndex - jpIndex.volatilityIndex,
      marketCapRatio: jpIndex.totalMarketCap > 0
        ? enIndex.totalMarketCap / jpIndex.totalMarketCap
        : 0,
      avgPriceRatio: jpIndex.avgPrice > 0
        ? enIndex.avgPrice / jpIndex.avgPrice
        : 0,
      correlation7d: await calculateLanguageCorrelation(game),
    };

    return {
      en: enIndex,
      jp: jpIndex,
      comparison,
      timestamp: new Date(),
    };
  });
}

/**
 * Calculate 7-day correlation between EN and JP index movements
 */
async function calculateLanguageCorrelation(game: string): Promise<number | null> {
  try {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    // Get EN and JP historical data
    const [enHistory, jpHistory] = await Promise.all([
      prisma.priceIndexSnapshot.findMany({
        where: {
          indexType: "TCG_100",
          indexKey: `${game}_EN`,
          snapshotDate: { gte: sevenDaysAgo },
        },
        orderBy: { snapshotDate: "asc" },
        select: { snapshotDate: true, value: true },
      }),
      prisma.priceIndexSnapshot.findMany({
        where: {
          indexType: "TCG_100",
          indexKey: `${game}_JP`,
          snapshotDate: { gte: sevenDaysAgo },
        },
        orderBy: { snapshotDate: "asc" },
        select: { snapshotDate: true, value: true },
      }),
    ]);

    if (enHistory.length < 3 || jpHistory.length < 3) {
      return null; // Not enough data
    }

    // Match dates and calculate correlation
    const enMap = new Map(
      enHistory.map((h) => [h.snapshotDate.toISOString().split("T")[0], h.value.toNumber()])
    );
    const jpMap = new Map(
      jpHistory.map((h) => [h.snapshotDate.toISOString().split("T")[0], h.value.toNumber()])
    );

    const commonDates = [...enMap.keys()].filter((d) => jpMap.has(d));
    if (commonDates.length < 3) return null;

    const enValues = commonDates.map((d) => enMap.get(d)!);
    const jpValues = commonDates.map((d) => jpMap.get(d)!);

    // Calculate Pearson correlation
    const n = enValues.length;
    const sumEn = enValues.reduce((a, b) => a + b, 0);
    const sumJp = jpValues.reduce((a, b) => a + b, 0);
    const sumEnSq = enValues.reduce((a, b) => a + b * b, 0);
    const sumJpSq = jpValues.reduce((a, b) => a + b * b, 0);
    const sumProduct = enValues.reduce((sum, en, i) => sum + en * jpValues[i], 0);

    const numerator = n * sumProduct - sumEn * sumJp;
    const denominator = Math.sqrt(
      (n * sumEnSq - sumEn * sumEn) * (n * sumJpSq - sumJp * sumJp)
    );

    return denominator > 0 ? numerator / denominator : null;
  } catch {
    return null;
  }
}

// ============================================================================
// Eligibility & Selection
// ============================================================================

/**
 * Get all eligible cards for index consideration, ranked by market cap
 */
async function getEligibleCards(
  game: string,
  criteria: EligibilityCriteria = DEFAULT_ELIGIBILITY,
  language: Language = "ALL"
): Promise<IndexConstituent[]> {
  // Get cards with prices and recent history
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  // Build where clause with optional language filter
  const whereClause: Prisma.CardPriceV2WhereInput = {
    game,
    bestPriceGbp: { gte: criteria.minPriceGbp },
  };

  if (language !== "ALL") {
    whereClause.language = language;
  }

  const cards = await prisma.cardPriceV2.findMany({
    where: whereClause,
    select: {
      cardId: true,
      name: true,
      setCode: true,
      releaseSet: true,
      rarity: true,
      imageUrl: true,
      bestPriceGbp: true,
    },
    orderBy: { bestPriceGbp: "desc" },
  });

  // Get price history for activity/eligibility checks
  const cardIds = cards.map((c) => c.cardId);

  let historyData: { cardId: string; count: number; firstDate: Date }[] = [];
  try {
    const history = await prisma.cardPriceHistory.groupBy({
      by: ["cardId"],
      where: {
        cardId: { in: cardIds },
        snapshotDate: { gte: sevenDaysAgo },
      },
      _count: { cardId: true },
      _min: { snapshotDate: true },
    });

    historyData = history.map((h) => ({
      cardId: h.cardId,
      count: h._count.cardId,
      firstDate: h._min.snapshotDate ?? new Date(),
    }));
  } catch {
    // Table may not exist yet
  }

  const historyMap = new Map(historyData.map((h) => [h.cardId, h]));

  // Get yesterday's prices for change calculation
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(0, 0, 0, 0);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let prevPriceMap = new Map<string, { gbp: number; jpy: number | null }>();
  try {
    const prevPrices = await prisma.cardPriceHistory.findMany({
      where: {
        cardId: { in: cardIds },
        snapshotDate: yesterday,
      },
      select: { cardId: true, priceGbp: true, priceJpy: true },
    });
    prevPriceMap = new Map(
      prevPrices.map((p) => [
        p.cardId,
        { gbp: p.priceGbp.toNumber(), jpy: p.priceJpy?.toNumber() ?? null },
      ])
    );
  } catch {
    // Table may not exist yet
  }

  // Get current JPY prices
  let jpyPriceMap = new Map<string, number>();
  try {
    const jpyPrices = await prisma.cardPriceHistory.findMany({
      where: {
        cardId: { in: cardIds },
        snapshotDate: today,
        priceJpy: { not: null },
      },
      select: { cardId: true, priceJpy: true },
    });
    jpyPriceMap = new Map(
      jpyPrices.map((p) => [p.cardId, p.priceJpy?.toNumber() ?? 0])
    );
  } catch {
    // Table may not exist yet
  }

  // Get 7-day history for volatility
  let weekPriceMap = new Map<string, number[]>();
  try {
    const weekPrices = await prisma.cardPriceHistory.findMany({
      where: {
        cardId: { in: cardIds },
        snapshotDate: { gte: sevenDaysAgo },
      },
      select: { cardId: true, priceGbp: true },
      orderBy: { snapshotDate: "asc" },
    });

    for (const p of weekPrices) {
      const prices = weekPriceMap.get(p.cardId) ?? [];
      prices.push(p.priceGbp.toNumber());
      weekPriceMap.set(p.cardId, prices);
    }
  } catch {
    // Table may not exist yet
  }

  // Get current constituent info
  let constituentMap = new Map<
    string,
    { rank: number; daysInIndex: number; previousRank: number | null }
  >();
  try {
    const constituents = await prisma.indexConstituent.findMany({
      where: { game, isActive: true },
      select: { cardId: true, rank: true, daysInIndex: true, previousRank: true },
    });
    constituentMap = new Map(
      constituents.map((c) => [
        c.cardId,
        {
          rank: c.rank,
          daysInIndex: c.daysInIndex,
          previousRank: c.previousRank,
        },
      ])
    );
  } catch {
    // Table may not exist yet
  }

  // Filter and build constituents
  const eligibleCards: IndexConstituent[] = [];
  let rank = 0;

  for (const card of cards) {
    const history = historyMap.get(card.cardId);
    const priceGbp = card.bestPriceGbp?.toNumber() ?? 0;
    const prevPrice = prevPriceMap.get(card.cardId);
    const priceJpy = jpyPriceMap.get(card.cardId) ?? null;
    const weekPrices = weekPriceMap.get(card.cardId) ?? [];
    const constituentInfo = constituentMap.get(card.cardId);

    // Check eligibility
    const priceUpdates = history?.count ?? 0;
    const hasRecentPrice = priceUpdates > 0;

    if (criteria.requiresRecentPrice && !hasRecentPrice) {
      continue;
    }

    rank++;

    // Calculate changes
    const previousPriceGbp = prevPrice?.gbp ?? priceGbp;
    const change24h =
      previousPriceGbp > 0
        ? ((priceGbp - previousPriceGbp) / previousPriceGbp) * 100
        : 0;

    // Calculate 7-day change
    const firstWeekPrice = weekPrices.length > 0 ? weekPrices[0] : priceGbp;
    const change7d =
      firstWeekPrice > 0
        ? ((priceGbp - firstWeekPrice) / firstWeekPrice) * 100
        : 0;

    // Calculate volatility (coefficient of variation)
    let volatility = 0;
    if (weekPrices.length > 1) {
      const mean = weekPrices.reduce((a, b) => a + b, 0) / weekPrices.length;
      const variance =
        weekPrices.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) /
        weekPrices.length;
      volatility = mean > 0 ? (Math.sqrt(variance) / mean) * 100 : 0;
    }

    // Market cap = price × volume factor (using price update count as proxy)
    const volumeFactor = Math.max(1, priceUpdates);
    const marketCap = priceGbp * volumeFactor;

    const previousRank = constituentInfo?.previousRank ?? null;
    const daysInIndex = constituentInfo?.daysInIndex ?? 0;
    const inBufferZone = rank > GUARANTEED_INCLUSION_RANK && rank <= BUFFER_ZONE_END;

    eligibleCards.push({
      cardId: card.cardId,
      name: card.name,
      setCode: card.setCode,
      releaseSet: card.releaseSet,
      rarity: card.rarity,
      imageUrl: card.imageUrl,
      priceGbp,
      previousPriceGbp,
      change24h,
      change7d,
      priceJpy,
      previousPriceJpy: prevPrice?.jpy ?? null,
      changeJpy24h: null, // Calculated separately
      marketCap,
      rawWeight: 0, // Calculated later
      cappedWeight: 0, // Calculated later
      weightAdjustment: "none",
      rank,
      previousRank,
      rankChange: previousRank !== null ? previousRank - rank : 0,
      daysInIndex,
      eligibleForRemoval: daysInIndex > 14 && rank > BUFFER_ZONE_END,
      inBufferZone,
      priceChangesLast7d: priceUpdates,
      volatility,
    });
  }

  return eligibleCards;
}

/**
 * Select top 100 constituents with buffer zone protection
 * - Top 75 ranked cards are automatically included
 * - Cards ranked 76-100 stay if they're current members
 * - Remaining slots filled by highest-ranked non-members
 */
function selectConstituentsWithBufferZone(
  eligibleCards: IndexConstituent[],
  currentConstituents: Set<string>
): IndexConstituent[] {
  const selected: IndexConstituent[] = [];
  const guaranteed: IndexConstituent[] = [];
  const bufferZoneProtected: IndexConstituent[] = [];
  const candidates: IndexConstituent[] = [];

  for (const card of eligibleCards) {
    if (card.rank <= GUARANTEED_INCLUSION_RANK) {
      // Top 75: guaranteed inclusion
      guaranteed.push(card);
    } else if (
      card.rank <= BUFFER_ZONE_END &&
      currentConstituents.has(card.cardId)
    ) {
      // Ranks 76-100: protected if current member
      bufferZoneProtected.push(card);
    } else if (card.rank <= BUFFER_ZONE_END * 1.5) {
      // Candidates for remaining slots (up to rank 150)
      candidates.push(card);
    }
  }

  // Add guaranteed cards
  selected.push(...guaranteed);

  // Add buffer zone protected cards
  selected.push(...bufferZoneProtected);

  // Fill remaining slots with highest-ranked candidates
  const remainingSlots = INDEX_SIZE - selected.length;
  if (remainingSlots > 0) {
    const selectedIds = new Set(selected.map((c) => c.cardId));
    const additionalCards = candidates
      .filter((c) => !selectedIds.has(c.cardId))
      .slice(0, remainingSlots);
    selected.push(...additionalCards);
  }

  // Re-rank within index
  return selected
    .sort((a, b) => b.marketCap - a.marketCap)
    .map((card, idx) => ({
      ...card,
      rank: idx + 1,
      inBufferZone: idx + 1 > GUARANTEED_INCLUSION_RANK,
    }));
}

// ============================================================================
// Weight Capping (NASDAQ-100 Style)
// ============================================================================

/**
 * Apply NASDAQ-100 style weight capping rules:
 * 1. No single card can exceed 24%
 * 2. Cards with >4.5% weight can't aggregate >48%
 * 3. After Stage 1 adjustments, top 5 max 40%
 * 4. Non-top-5 cards capped at 4.4% or 5th largest
 */
function applyWeightCapping(
  cards: IndexConstituent[],
  config: WeightCappingConfig
): IndexConstituent[] {
  // Sort by raw weight descending
  const sorted = [...cards].sort((a, b) => b.rawWeight - a.rawWeight);

  // Stage 1: Cap individual weights at maxSingleWeight (24%)
  let redistributionPool = 0;
  const stage1 = sorted.map((card) => {
    if (card.rawWeight > config.maxSingleWeight) {
      redistributionPool += card.rawWeight - config.maxSingleWeight;
      return {
        ...card,
        cappedWeight: config.maxSingleWeight,
        weightAdjustment: "capped" as const,
      };
    }
    return { ...card, cappedWeight: card.rawWeight };
  });

  // Stage 2: Ensure concentrated cards (>4.5%) don't exceed 48% aggregate
  const concentratedCards = stage1.filter(
    (c) => c.cappedWeight > config.concentrationThreshold
  );
  const concentratedWeight = concentratedCards.reduce(
    (sum, c) => sum + c.cappedWeight,
    0
  );

  let stage2 = stage1;
  if (concentratedWeight > config.maxConcentratedWeight) {
    // Scale down concentrated cards proportionally
    const scaleFactor = config.maxConcentratedWeight / concentratedWeight;
    const excessWeight = concentratedWeight - config.maxConcentratedWeight;
    redistributionPool += excessWeight;

    stage2 = stage1.map((card) => {
      if (card.cappedWeight > config.concentrationThreshold) {
        return {
          ...card,
          cappedWeight: card.cappedWeight * scaleFactor,
          weightAdjustment: "capped" as const,
        };
      }
      return card;
    });
  }

  // Stage 3: Cap non-top-5 at 4.4% or 5th largest
  const fifthLargestWeight = stage2[4]?.cappedWeight ?? config.nonTop5Cap;
  const nonTop5Cap = Math.min(config.nonTop5Cap, fifthLargestWeight);

  const stage3 = stage2.map((card, idx) => {
    if (idx >= 5 && card.cappedWeight > nonTop5Cap) {
      redistributionPool += card.cappedWeight - nonTop5Cap;
      return {
        ...card,
        cappedWeight: nonTop5Cap,
        weightAdjustment: "capped" as const,
      };
    }
    return card;
  });

  // Stage 4: Redistribute excess weight to uncapped cards
  const uncappedCards = stage3.filter((c) => c.weightAdjustment === "none");
  const uncappedTotalWeight = uncappedCards.reduce(
    (sum, c) => sum + c.cappedWeight,
    0
  );

  if (redistributionPool > 0 && uncappedTotalWeight > 0) {
    const redistributionFactor = redistributionPool / uncappedTotalWeight;

    return stage3.map((card) => {
      if (card.weightAdjustment === "none") {
        const additionalWeight = card.cappedWeight * redistributionFactor;
        const newWeight = Math.min(
          card.cappedWeight + additionalWeight,
          config.maxSingleWeight
        );
        return {
          ...card,
          cappedWeight: newWeight,
          weightAdjustment:
            newWeight !== card.cappedWeight + additionalWeight
              ? ("redistributed" as const)
              : card.weightAdjustment,
        };
      }
      return card;
    });
  }

  return stage3;
}

// ============================================================================
// Reconstitution & Rebalancing
// ============================================================================

/**
 * Perform monthly reconstitution
 * - Re-evaluate all eligible cards
 * - Apply buffer zone rules
 * - Record additions/removals
 */
export async function performReconstitution(
  game: string = "onepiece"
): Promise<ReconstitutionResult> {
  return withTrace("tcg100.reconstitution", { game }, async (trace) => {
    const now = new Date();

    // Get current constituents
    const currentConstituents = await getCurrentConstituents(game);
    const currentIds = new Set(currentConstituents.map((c) => c.cardId));

    // Calculate new index
    const newIndex = await calculateTCG100(game);
    const newIds = new Set(newIndex.constituents.map((c) => c.cardId));

    // Determine changes
    const additions = newIndex.constituents
      .filter((c) => !currentIds.has(c.cardId))
      .map((c) => c.cardId);

    const removals = currentConstituents
      .filter((c) => !newIds.has(c.cardId))
      .map((c) => c.cardId);

    const retained = newIndex.constituents
      .filter((c) => currentIds.has(c.cardId))
      .map((c) => c.cardId);

    const bufferZoneProtected = newIndex.constituents
      .filter((c) => c.inBufferZone && currentIds.has(c.cardId))
      .map((c) => c.cardId);

    trace.addAttribute("additions", additions.length);
    trace.addAttribute("removals", removals.length);
    trace.addAttribute("bufferProtected", bufferZoneProtected.length);

    // Save new constituents
    await saveConstituents(game, newIndex.constituents);

    // Record reconstitution event
    await recordReconstitution(game, {
      additions,
      removals,
      retained,
      bufferZoneProtected,
      timestamp: now,
    });

    // Take snapshot
    await takeIndexSnapshot(game, newIndex);

    metrics.increment("tcg100.reconstitution.completed");

    return {
      additions,
      removals,
      retained,
      bufferZoneProtected,
      timestamp: now,
    };
  });
}

/**
 * Perform weekly weight rebalancing
 * - Recalculate weights based on current prices
 * - Apply capping rules
 * - Does not change constituents
 */
export async function performRebalance(game: string = "onepiece"): Promise<void> {
  return withTrace("tcg100.rebalance", { game }, async (trace) => {
    // Get current constituents
    const constituents = await getCurrentConstituents(game);
    if (constituents.length === 0) {
      trace.log("No constituents to rebalance");
      return;
    }

    // Recalculate with current prices
    const newIndex = await calculateTCG100(game);

    // Update weights only (keep same cards)
    await updateConstituentWeights(game, newIndex.constituents);

    // Take snapshot
    await takeIndexSnapshot(game, newIndex);

    metrics.increment("tcg100.rebalance.completed");
  });
}

// ============================================================================
// Persistence Functions
// ============================================================================

async function getCurrentConstituents(
  game: string
): Promise<{ cardId: string; rank: number }[]> {
  try {
    return await prisma.indexConstituent.findMany({
      where: { game, isActive: true },
      select: { cardId: true, rank: true },
      orderBy: { rank: "asc" },
    });
  } catch {
    // Table may not exist yet
    return [];
  }
}

async function saveConstituents(
  game: string,
  constituents: IndexConstituent[]
): Promise<void> {
  try {
    const now = new Date();

    // Deactivate old constituents
    await prisma.indexConstituent.updateMany({
      where: { game, isActive: true },
      data: { isActive: false },
    });

    // Insert new constituents
    await prisma.indexConstituent.createMany({
      data: constituents.map((c) => ({
        cardId: c.cardId,
        game,
        rank: c.rank,
        previousRank: c.previousRank,
        rawWeight: c.rawWeight,
        cappedWeight: c.cappedWeight,
        marketCap: c.marketCap,
        priceGbp: c.priceGbp,
        daysInIndex: c.daysInIndex + 1,
        inBufferZone: c.inBufferZone,
        isActive: true,
        updatedAt: now,
      })),
    });
  } catch (error) {
    logger.warn("Could not save constituents (table may not exist)", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function updateConstituentWeights(
  game: string,
  constituents: IndexConstituent[]
): Promise<void> {
  try {
    const now = new Date();

    for (const c of constituents) {
      await prisma.indexConstituent.updateMany({
        where: { game, cardId: c.cardId, isActive: true },
        data: {
          rawWeight: c.rawWeight,
          cappedWeight: c.cappedWeight,
          marketCap: c.marketCap,
          priceGbp: c.priceGbp,
          rank: c.rank,
          updatedAt: now,
        },
      });
    }
  } catch (error) {
    logger.warn("Could not update constituent weights", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function recordReconstitution(
  game: string,
  result: ReconstitutionResult
): Promise<void> {
  try {
    await prisma.indexReconstitution.create({
      data: {
        game,
        additions: result.additions,
        removals: result.removals,
        retained: result.retained.length,
        bufferZoneProtected: result.bufferZoneProtected.length,
        reconstitutionDate: result.timestamp,
      },
    });
  } catch (error) {
    logger.warn("Could not record reconstitution (table may not exist)", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function takeIndexSnapshot(
  game: string,
  index: TCG100Result
): Promise<void> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  try {
    await prisma.priceIndexSnapshot.upsert({
      where: {
        indexType_indexKey_snapshotDate: {
          indexType: "TCG_100",
          indexKey: game,
          snapshotDate: today,
        },
      },
      update: {
        value: index.value,
        change24h: index.change24h,
        change7d: index.change7d,
        change30d: index.change30d,
        cardCount: index.constituentCount,
        totalMarketCap: index.totalMarketCap,
        avgPrice: index.avgPrice,
        volatility: index.volatilityIndex,
        highPrice: index.highPrice,
        lowPrice: index.lowPrice,
      },
      create: {
        indexType: "TCG_100",
        indexKey: game,
        value: index.value,
        change24h: index.change24h,
        change7d: index.change7d,
        change30d: index.change30d,
        cardCount: index.constituentCount,
        totalMarketCap: index.totalMarketCap,
        avgPrice: index.avgPrice,
        volatility: index.volatilityIndex,
        highPrice: index.highPrice,
        lowPrice: index.lowPrice,
        snapshotDate: today,
      },
    });
  } catch (error) {
    logger.warn("Could not save index snapshot", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// ============================================================================
// Historical Data Queries
// ============================================================================

async function getIndexChange(game: string, daysAgo: number): Promise<number> {
  try {
    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() - daysAgo);
    targetDate.setHours(0, 0, 0, 0);

    const [current, historical] = await Promise.all([
      prisma.priceIndexSnapshot.findFirst({
        where: { indexType: "TCG_100", indexKey: game },
        orderBy: { snapshotDate: "desc" },
        select: { value: true },
      }),
      prisma.priceIndexSnapshot.findFirst({
        where: {
          indexType: "TCG_100",
          indexKey: game,
          snapshotDate: { lte: targetDate },
        },
        orderBy: { snapshotDate: "desc" },
        select: { value: true },
      }),
    ]);

    if (!current || !historical) return 0;

    const currentValue = current.value.toNumber();
    const historicalValue = historical.value.toNumber();

    if (historicalValue === 0) return 0;
    return ((currentValue - historicalValue) / historicalValue) * 100;
  } catch {
    return 0;
  }
}

async function getPreviousIndexValue(
  game: string,
  daysAgo: number
): Promise<number> {
  try {
    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() - daysAgo);
    targetDate.setHours(0, 0, 0, 0);

    const snapshot = await prisma.priceIndexSnapshot.findFirst({
      where: {
        indexType: "TCG_100",
        indexKey: game,
        snapshotDate: { lte: targetDate },
      },
      orderBy: { snapshotDate: "desc" },
      select: { value: true },
    });

    return snapshot?.value.toNumber() ?? 0;
  } catch {
    return 0;
  }
}

async function getLastReconstitutionDate(game: string): Promise<Date | null> {
  try {
    const record = await prisma.indexReconstitution.findFirst({
      where: { game },
      orderBy: { reconstitutionDate: "desc" },
      select: { reconstitutionDate: true },
    });
    return record?.reconstitutionDate ?? null;
  } catch {
    return null;
  }
}

async function getLastRebalanceDate(game: string): Promise<Date | null> {
  try {
    const record = await prisma.priceIndexSnapshot.findFirst({
      where: { indexType: "TCG_100", indexKey: game },
      orderBy: { snapshotDate: "desc" },
      select: { snapshotDate: true },
    });
    return record?.snapshotDate ?? null;
  } catch {
    return null;
  }
}

function getNextReconstitutionDate(from: Date): Date {
  const next = new Date(from);
  next.setMonth(next.getMonth() + 1);
  next.setDate(RECONSTITUTION_DAY);
  next.setHours(0, 0, 0, 0);
  return next;
}

function getNextRebalanceDate(from: Date): Date {
  const next = new Date(from);
  const daysUntilMonday = (REBALANCE_WEEKDAY + 7 - next.getDay()) % 7 || 7;
  next.setDate(next.getDate() + daysUntilMonday);
  next.setHours(0, 0, 0, 0);
  return next;
}

// ============================================================================
// Helpers
// ============================================================================

function createEmptyResult(language: Language = "ALL"): TCG100Result {
  return {
    language,
    value: 0,
    previousValue: 0,
    change24h: 0,
    change7d: 0,
    change30d: 0,
    valueJpy: null,
    changeJpy24h: null,
    totalMarketCap: 0,
    avgPrice: 0,
    medianPrice: 0,
    highPrice: 0,
    lowPrice: 0,
    constituents: [],
    constituentCount: 0,
    largestWeight: 0,
    top5Weight: 0,
    concentrationIndex: 0,
    volatilityIndex: 0,
    calculatedAt: new Date(),
    lastReconstitution: null,
    nextReconstitution: getNextReconstitutionDate(new Date()),
    lastRebalance: null,
    nextRebalance: getNextRebalanceDate(new Date()),
  };
}

/**
 * Get index constituents for API response
 */
export async function getTCG100Constituents(
  game: string = "onepiece",
  language: Language = "ALL",
  options: {
    page?: number;
    limit?: number;
    sortBy?: "rank" | "weight" | "change" | "price";
    sortOrder?: "asc" | "desc";
  } = {}
): Promise<{
  constituents: IndexConstituent[];
  total: number;
  page: number;
  limit: number;
}> {
  const { page = 1, limit = 100, sortBy = "rank", sortOrder = "asc" } = options;

  const index = await calculateTCG100(game, language);

  let sorted = [...index.constituents];
  switch (sortBy) {
    case "weight":
      sorted.sort((a, b) =>
        sortOrder === "asc"
          ? a.cappedWeight - b.cappedWeight
          : b.cappedWeight - a.cappedWeight
      );
      break;
    case "change":
      sorted.sort((a, b) =>
        sortOrder === "asc"
          ? a.change24h - b.change24h
          : b.change24h - a.change24h
      );
      break;
    case "price":
      sorted.sort((a, b) =>
        sortOrder === "asc"
          ? a.priceGbp - b.priceGbp
          : b.priceGbp - a.priceGbp
      );
      break;
    default:
      sorted.sort((a, b) =>
        sortOrder === "asc" ? a.rank - b.rank : b.rank - a.rank
      );
  }

  const offset = (page - 1) * limit;
  const paginated = sorted.slice(offset, offset + limit);

  return {
    constituents: paginated,
    total: index.constituentCount,
    page,
    limit,
  };
}
