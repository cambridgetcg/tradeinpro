/**
 * Price Index Calculation Engine (PRISM)
 *
 * Calculates market indices for TCG cards across games, sets, rarities.
 * Supports multiple weighting methods and tracks historical trends.
 *
 * @synapse See docs/TCG_PRICE_INDEX_PLAN.md for architecture
 */

import { Prisma } from "@prisma/client";
import prisma from "../db.server";
import { logger, metrics, withTrace } from "./observability.server";

// ============================================================================
// Types
// ============================================================================

export type IndexType = "GAME" | "SET" | "RARITY" | "TOP_100" | "LANGUAGE" | "VOLATILITY";
export type WeightMethod = "market_cap" | "equal" | "card_count";

export interface IndexConfig {
  type: IndexType;
  key: string;
  weights: WeightMethod;
  filters: {
    game?: string;
    setCode?: string;
    rarity?: string;
    language?: string;
    minPrice?: number;
    topN?: number;
  };
}

export interface IndexResult {
  type: IndexType;
  key: string;
  value: number;
  change24h: number;
  change7d: number;
  change30d: number;
  cardCount: number;
  totalMarketCap: number;
  avgPrice: number;
  volatility: number;
  highPrice: number;
  lowPrice: number;
  calculatedAt: Date;
}

export interface TopMover {
  cardId: string;
  name: string;
  setCode: string | null;
  price: number;
  change: number;
  changePercent: number;
}

export interface CrystalNode {
  id: string;
  name: string;
  price: number;
  change: number;
  setCode: string | null;
  rarity: string | null;
  game: string;
}

export interface CrystalEdge {
  source: string;
  target: string;
  correlation: number;
}

export interface CrystalData {
  nodes: CrystalNode[];
  edges: CrystalEdge[];
  clusters: { id: string; cardCount: number }[];
}

// ============================================================================
// Index Configurations
// ============================================================================

export const INDEX_CONFIGS: Record<string, IndexConfig> = {
  // Game-level indices
  GAME_onepiece: {
    type: "GAME",
    key: "onepiece",
    weights: "market_cap",
    filters: { game: "onepiece", minPrice: 0.5 },
  },
  GAME_pokemon: {
    type: "GAME",
    key: "pokemon",
    weights: "market_cap",
    filters: { game: "pokemon", minPrice: 0.5 },
  },

  // Top 100 most valuable
  TOP_100: {
    type: "TOP_100",
    key: "top100",
    weights: "equal",
    filters: { minPrice: 1.0, topN: 100 },
  },

  // Language comparison
  LANG_EN: {
    type: "LANGUAGE",
    key: "EN",
    weights: "equal",
    filters: { language: "EN", minPrice: 0.5 },
  },
  LANG_JP: {
    type: "LANGUAGE",
    key: "JP",
    weights: "equal",
    filters: { language: "JP", minPrice: 0.5 },
  },
};

// ============================================================================
// Index Calculation Functions
// ============================================================================

/**
 * Calculate an index value based on configuration
 */
export async function calculateIndex(config: IndexConfig): Promise<IndexResult> {
  return withTrace("priceIndex.calculate", { type: config.type, key: config.key }, async (trace) => {
    const { filters } = config;

    // Build where clause
    const where: Prisma.CardPriceV2WhereInput = {
      bestPriceGbp: { not: null },
    };

    if (filters.game) where.game = filters.game;
    if (filters.setCode) where.setCode = filters.setCode;
    if (filters.rarity) where.rarity = filters.rarity;
    if (filters.language) where.language = filters.language;
    if (filters.minPrice) {
      where.bestPriceGbp = { gte: filters.minPrice };
    }

    // Fetch cards
    let cards = await prisma.cardPriceV2.findMany({
      where,
      select: {
        cardId: true,
        name: true,
        setCode: true,
        rarity: true,
        bestPriceGbp: true,
        game: true,
      },
      orderBy: filters.topN ? { bestPriceGbp: "desc" } : undefined,
      take: filters.topN,
    });

    if (cards.length === 0) {
      trace.log("No cards found for index", { config: JSON.stringify(filters) });
      return createEmptyResult(config);
    }

    trace.addAttribute("cardCount", cards.length);

    // Calculate prices as numbers
    const prices = cards
      .map((c) => c.bestPriceGbp?.toNumber() ?? 0)
      .filter((p) => p > 0);

    // Calculate metrics
    const totalMarketCap = prices.reduce((sum, p) => sum + p, 0);
    const avgPrice = totalMarketCap / prices.length;
    const highPrice = Math.max(...prices);
    const lowPrice = Math.min(...prices);

    // Calculate volatility (standard deviation)
    const variance = prices.reduce((sum, p) => sum + Math.pow(p - avgPrice, 2), 0) / prices.length;
    const volatility = Math.sqrt(variance);

    // Calculate index value based on weighting method
    let value: number;
    switch (config.weights) {
      case "market_cap":
        // Market-cap weighted average
        value = totalMarketCap / cards.length;
        break;
      case "equal":
        // Simple average
        value = avgPrice;
        break;
      case "card_count":
        // Sum of all prices (total market cap)
        value = totalMarketCap;
        break;
      default:
        value = avgPrice;
    }

    // Get historical changes
    const [change24h, change7d, change30d] = await Promise.all([
      getHistoricalChange(config.type, config.key, 1),
      getHistoricalChange(config.type, config.key, 7),
      getHistoricalChange(config.type, config.key, 30),
    ]);

    metrics.increment("priceIndex.calculated");

    return {
      type: config.type,
      key: config.key,
      value,
      change24h,
      change7d,
      change30d,
      cardCount: cards.length,
      totalMarketCap,
      avgPrice,
      volatility,
      highPrice,
      lowPrice,
      calculatedAt: new Date(),
    };
  });
}

/**
 * Get percentage change from historical snapshot
 */
async function getHistoricalChange(
  indexType: IndexType,
  indexKey: string,
  daysAgo: number
): Promise<number> {
  try {
    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() - daysAgo);
    targetDate.setHours(0, 0, 0, 0);

    const snapshot = await prisma.priceIndexSnapshot.findFirst({
      where: {
        indexType,
        indexKey,
        snapshotDate: { lte: targetDate },
      },
      orderBy: { snapshotDate: "desc" },
      select: { value: true },
    });

    if (!snapshot) return 0;

    // Get current value for comparison
    const current = await prisma.priceIndexSnapshot.findFirst({
      where: { indexType, indexKey },
      orderBy: { snapshotDate: "desc" },
      select: { value: true },
    });

    if (!current) return 0;

    const oldValue = snapshot.value.toNumber();
    const newValue = current.value.toNumber();

    if (oldValue === 0) return 0;
    return ((newValue - oldValue) / oldValue) * 100;
  } catch {
    // PriceIndexSnapshot table may not exist yet
    return 0;
  }
}

/**
 * Create empty result for configs with no matching cards
 */
function createEmptyResult(config: IndexConfig): IndexResult {
  return {
    type: config.type,
    key: config.key,
    value: 0,
    change24h: 0,
    change7d: 0,
    change30d: 0,
    cardCount: 0,
    totalMarketCap: 0,
    avgPrice: 0,
    volatility: 0,
    highPrice: 0,
    lowPrice: 0,
    calculatedAt: new Date(),
  };
}

// ============================================================================
// Set Index Functions
// ============================================================================

/**
 * Get all unique sets and generate their index configs
 */
export async function getSetIndexConfigs(game?: string): Promise<IndexConfig[]> {
  const where: Prisma.CardPriceV2WhereInput = {
    setCode: { not: null },
    bestPriceGbp: { not: null },
  };
  if (game) where.game = game;

  const sets = await prisma.cardPriceV2.findMany({
    where,
    select: { setCode: true, game: true },
    distinct: ["setCode"],
  });

  return sets
    .filter((s) => s.setCode)
    .map((s) => ({
      type: "SET" as IndexType,
      key: s.setCode!,
      weights: "equal" as WeightMethod,
      filters: { setCode: s.setCode!, game: s.game, minPrice: 0.5 },
    }));
}

/**
 * Calculate all set indices for a game
 */
export async function calculateAllSetIndices(game?: string): Promise<IndexResult[]> {
  const configs = await getSetIndexConfigs(game);
  const results = await Promise.all(configs.map((c) => calculateIndex(c)));
  return results.filter((r) => r.cardCount > 0);
}

// ============================================================================
// Snapshot Functions
// ============================================================================

/**
 * Take a snapshot of current prices for historical tracking
 */
export async function takeSnapshot(indexResult: IndexResult): Promise<void> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  await prisma.priceIndexSnapshot.upsert({
    where: {
      indexType_indexKey_snapshotDate: {
        indexType: indexResult.type,
        indexKey: indexResult.key,
        snapshotDate: today,
      },
    },
    update: {
      value: indexResult.value,
      change24h: indexResult.change24h,
      change7d: indexResult.change7d,
      change30d: indexResult.change30d,
      cardCount: indexResult.cardCount,
      totalMarketCap: indexResult.totalMarketCap,
      avgPrice: indexResult.avgPrice,
      volatility: indexResult.volatility,
      highPrice: indexResult.highPrice,
      lowPrice: indexResult.lowPrice,
    },
    create: {
      indexType: indexResult.type,
      indexKey: indexResult.key,
      value: indexResult.value,
      change24h: indexResult.change24h,
      change7d: indexResult.change7d,
      change30d: indexResult.change30d,
      cardCount: indexResult.cardCount,
      totalMarketCap: indexResult.totalMarketCap,
      avgPrice: indexResult.avgPrice,
      volatility: indexResult.volatility,
      highPrice: indexResult.highPrice,
      lowPrice: indexResult.lowPrice,
      snapshotDate: today,
    },
  });

  logger.info("Index snapshot taken", { type: indexResult.type, key: indexResult.key });
  metrics.increment("priceIndex.snapshot.created");
}

/**
 * Take card-level price snapshots for detailed history
 */
export async function takeCardPriceSnapshots(game?: string): Promise<number> {
  return withTrace("priceIndex.cardSnapshots", { game: game || "all" }, async (trace) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const where: Prisma.CardPriceV2WhereInput = {
      bestPriceGbp: { not: null },
    };
    if (game) where.game = game;

    const cards = await prisma.cardPriceV2.findMany({
      where,
      select: {
        cardId: true,
        game: true,
        setCode: true,
        bestPriceGbp: true,
        optcgTcgplayerGbp: true,
        limitlessCardmarketGbp: true,
        justtcgTcgplayerGbp: true,
      },
    });

    trace.addAttribute("cardCount", cards.length);

    // Get previous day's prices for change calculation
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const previousPrices = await prisma.cardPriceHistory.findMany({
      where: { snapshotDate: yesterday },
      select: { cardId: true, priceGbp: true },
    });

    const prevPriceMap = new Map(previousPrices.map((p) => [p.cardId, p.priceGbp.toNumber()]));

    // Determine source used for each card
    const snapshots = cards.map((card) => {
      const price = card.bestPriceGbp?.toNumber() ?? 0;
      const prevPrice = prevPriceMap.get(card.cardId) ?? price;
      const change = prevPrice > 0 ? ((price - prevPrice) / prevPrice) * 100 : 0;

      // Determine which source provided the best price
      let sourceUsed = "unknown";
      if (card.optcgTcgplayerGbp?.toNumber() === price) sourceUsed = "optcg";
      else if (card.limitlessCardmarketGbp?.toNumber() === price) sourceUsed = "limitless";
      else if (card.justtcgTcgplayerGbp?.toNumber() === price) sourceUsed = "justtcg";

      return {
        cardId: card.cardId,
        game: card.game,
        setCode: card.setCode,
        priceGbp: price,
        sourceUsed,
        change,
        snapshotDate: today,
      };
    });

    // Batch insert with conflict handling
    let insertedCount = 0;
    const batchSize = 500;

    for (let i = 0; i < snapshots.length; i += batchSize) {
      const batch = snapshots.slice(i, i + batchSize);

      // Use raw SQL for upsert performance
      await prisma.$executeRaw`
        INSERT INTO card_price_history (id, card_id, game, set_code, price_gbp, source_used, change, snapshot_date)
        SELECT
          gen_random_uuid()::text,
          unnest(${batch.map((s) => s.cardId)}::text[]),
          unnest(${batch.map((s) => s.game)}::text[]),
          unnest(${batch.map((s) => s.setCode)}::text[]),
          unnest(${batch.map((s) => s.priceGbp)}::decimal[]),
          unnest(${batch.map((s) => s.sourceUsed)}::text[]),
          unnest(${batch.map((s) => s.change)}::decimal[]),
          ${today}::date
        ON CONFLICT (card_id, snapshot_date) DO UPDATE SET
          price_gbp = EXCLUDED.price_gbp,
          source_used = EXCLUDED.source_used,
          change = EXCLUDED.change
      `;

      insertedCount += batch.length;
    }

    trace.addAttribute("insertedCount", insertedCount);
    metrics.increment("priceIndex.cardSnapshots.created", insertedCount);

    return insertedCount;
  });
}

// ============================================================================
// Query Functions
// ============================================================================

/**
 * Get all current indices
 */
export async function getAllIndices(): Promise<Record<string, IndexResult>> {
  const results: Record<string, IndexResult> = {};

  // Calculate main indices
  for (const [key, config] of Object.entries(INDEX_CONFIGS)) {
    results[key] = await calculateIndex(config);
  }

  return results;
}

/**
 * Get historical data for an index
 */
export async function getIndexHistory(
  indexType: IndexType,
  indexKey: string,
  days: number = 30
): Promise<{ date: string; value: number; change: number }[]> {
  try {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const snapshots = await prisma.priceIndexSnapshot.findMany({
      where: {
        indexType,
        indexKey,
        snapshotDate: { gte: startDate },
      },
      orderBy: { snapshotDate: "asc" },
      select: {
        snapshotDate: true,
        value: true,
        change24h: true,
      },
    });

    return snapshots.map((s) => ({
      date: s.snapshotDate.toISOString().split("T")[0],
      value: s.value.toNumber(),
      change: s.change24h.toNumber(),
    }));
  } catch {
    // PriceIndexSnapshot table may not exist yet
    return [];
  }
}

/**
 * Get top gainers and losers
 */
export async function getTopMovers(limit: number = 10): Promise<{
  gainers: TopMover[];
  losers: TopMover[];
}> {
  try {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Get today's prices with yesterday's for comparison
    const todayPrices = await prisma.cardPriceHistory.findMany({
      where: { snapshotDate: today },
      select: {
        cardId: true,
        priceGbp: true,
        change: true,
      },
      orderBy: { change: "desc" },
      take: limit * 2, // Get extra for filtering
    });

    const yesterdayPrices = await prisma.cardPriceHistory.findMany({
      where: { snapshotDate: yesterday },
      select: {
        cardId: true,
        priceGbp: true,
      },
    });

    const yesterdayMap = new Map(yesterdayPrices.map((p) => [p.cardId, p.priceGbp.toNumber()]));

    // Get card names
    const cardIds = todayPrices.map((p) => p.cardId);
    const cards = await prisma.cardPriceV2.findMany({
      where: { cardId: { in: cardIds } },
      select: { cardId: true, name: true, setCode: true },
    });
    const cardMap = new Map(cards.map((c) => [c.cardId, c]));

    // Build movers list
    const movers: TopMover[] = todayPrices
      .filter((p) => yesterdayMap.has(p.cardId))
      .map((p) => {
        const card = cardMap.get(p.cardId);
        const prevPrice = yesterdayMap.get(p.cardId) ?? 0;
        const currentPrice = p.priceGbp.toNumber();
        const priceChange = currentPrice - prevPrice;

        return {
          cardId: p.cardId,
          name: card?.name ?? p.cardId,
          setCode: card?.setCode ?? null,
          price: currentPrice,
          change: priceChange,
          changePercent: p.change.toNumber(),
        };
      });

    // Sort and split
    const sorted = movers.sort((a, b) => b.changePercent - a.changePercent);
    const gainers = sorted.filter((m) => m.changePercent > 0).slice(0, limit);
    const losers = sorted.filter((m) => m.changePercent < 0).slice(-limit).reverse();

    return { gainers, losers };
  } catch (error) {
    // CardPriceHistory table may not exist yet
    logger.warn("CardPriceHistory table not available for getTopMovers", {
      error: error instanceof Error ? error.message : String(error),
    });
    return { gainers: [], losers: [] };
  }
}

// ============================================================================
// Crystal Visualization Data
// ============================================================================

/**
 * Get data for crystal neural network visualization
 */
export async function getCrystalData(
  game: string,
  maxNodes: number = 200
): Promise<CrystalData> {
  return withTrace("priceIndex.crystalData", { game, maxNodes }, async (trace) => {
    // Get top cards by price
    const cards = await prisma.cardPriceV2.findMany({
      where: {
        game,
        bestPriceGbp: { not: null, gte: 0.5 },
      },
      select: {
        cardId: true,
        name: true,
        setCode: true,
        rarity: true,
        bestPriceGbp: true,
        game: true,
      },
      orderBy: { bestPriceGbp: "desc" },
      take: maxNodes,
    });

    trace.addAttribute("nodeCount", cards.length);

    // Get yesterday's prices for change calculation (handle missing table gracefully)
    const cardIds = cards.map((c) => c.cardId);
    let prevPriceMap = new Map<string, number>();

    try {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      yesterday.setHours(0, 0, 0, 0);

      const prevPrices = await prisma.cardPriceHistory.findMany({
        where: {
          cardId: { in: cardIds },
          snapshotDate: yesterday,
        },
        select: { cardId: true, priceGbp: true },
      });

      prevPriceMap = new Map(prevPrices.map((p) => [p.cardId, p.priceGbp.toNumber()]));
    } catch (error) {
      // Table may not exist yet - no change data available
      logger.warn("CardPriceHistory table not available", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Build nodes
    const nodes: CrystalNode[] = cards.map((card) => {
      const price = card.bestPriceGbp?.toNumber() ?? 0;
      const prevPrice = prevPriceMap.get(card.cardId) ?? price;
      const change = prevPrice > 0 ? ((price - prevPrice) / prevPrice) * 100 : 0;

      return {
        id: card.cardId,
        name: card.name,
        price,
        change,
        setCode: card.setCode,
        rarity: card.rarity,
        game: card.game,
      };
    });

    // Get correlations for edges (handle missing table gracefully)
    let edges: CrystalEdge[] = [];
    try {
      const correlations = await prisma.priceCorrelation.findMany({
        where: {
          OR: [
            { entityA: { in: cardIds } },
            { entityB: { in: cardIds } },
          ],
          correlation: { gte: 0.5 }, // Only show strong correlations
        },
        select: {
          entityA: true,
          entityB: true,
          correlation: true,
        },
        take: 500, // Limit edges for performance
      });

      edges = correlations
        .filter((c) => cardIds.includes(c.entityA) && cardIds.includes(c.entityB))
        .map((c) => ({
          source: c.entityA,
          target: c.entityB,
          correlation: c.correlation.toNumber(),
        }));
    } catch (error) {
      // Table may not exist yet - return empty edges
      logger.warn("PriceCorrelation table not available", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    trace.addAttribute("edgeCount", edges.length);

    // Build clusters from sets
    const setMap = new Map<string, number>();
    cards.forEach((c) => {
      if (c.setCode) {
        setMap.set(c.setCode, (setMap.get(c.setCode) ?? 0) + 1);
      }
    });

    const clusters = Array.from(setMap.entries()).map(([id, cardCount]) => ({
      id,
      cardCount,
    }));

    return { nodes, edges, clusters };
  });
}

// ============================================================================
// Daily Cron Job
// ============================================================================

/**
 * Run daily price index snapshot job
 * Should be called by cron at midnight
 */
export async function runDailySnapshot(): Promise<{
  indicesProcessed: number;
  cardsProcessed: number;
}> {
  return withTrace("priceIndex.dailySnapshot", {}, async (trace) => {
    logger.info("Starting daily price index snapshot");

    // 1. Calculate and snapshot main indices
    let indicesProcessed = 0;
    for (const [key, config] of Object.entries(INDEX_CONFIGS)) {
      try {
        const result = await calculateIndex(config);
        await takeSnapshot(result);
        indicesProcessed++;
        trace.log(`Snapshotted ${key}`, { value: result.value });
      } catch (error) {
        logger.error(`Failed to snapshot index ${key}`, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // 2. Calculate and snapshot all set indices
    const setIndices = await calculateAllSetIndices();
    for (const setIndex of setIndices) {
      try {
        await takeSnapshot(setIndex);
        indicesProcessed++;
      } catch (error) {
        logger.error(`Failed to snapshot set ${setIndex.key}`, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // 3. Take card-level snapshots
    const cardsProcessed = await takeCardPriceSnapshots();

    trace.addAttribute("indicesProcessed", indicesProcessed);
    trace.addAttribute("cardsProcessed", cardsProcessed);

    logger.info("Daily snapshot complete", { indicesProcessed, cardsProcessed });
    metrics.increment("priceIndex.dailySnapshot.completed");

    return { indicesProcessed, cardsProcessed };
  });
}
