/**
 * Shard-Aware Query Helpers
 *
 * Provides game-specific query utilities that automatically route to the correct shard.
 * These helpers abstract away the complexity of multi-database routing.
 *
 * Usage:
 *   import { getCardPriceHistory, searchCardsAcrossGames } from "./shard-queries.server";
 *
 *   // Query specific game
 *   const history = await getCardPriceHistory("OP01-001-parallel", "onepiece", 30);
 *
 *   // Search across all games
 *   const results = await searchCardsAcrossGames("Luffy");
 */

import { Decimal } from "@prisma/client/runtime/library";
import {
  GameShard,
  getShardClient,
  withShard,
  withAllShards,
  routeCardToShard,
  getActiveShards,
  getShardDisplayName,
} from "./shard.server";

// ============================================================================
// Types
// ============================================================================

export interface CardPrice {
  cardId: string;
  name: string;
  game: string;
  setCode: string | null;
  priceGbp: number;
  change24h: number;
  imageUrl: string | null;
}

export interface CardPriceHistoryPoint {
  date: string;
  priceGbp: number;
  priceJpy: number | null;
  change: number;
}

export interface CrossGameSearchResult {
  game: GameShard;
  gameName: string;
  cards: CardPrice[];
  totalCount: number;
}

export interface GameStats {
  game: GameShard;
  gameName: string;
  cardCount: number;
  historyRows: number;
  avgPriceGbp: number;
  totalValueGbp: number;
}

// ============================================================================
// Card Price Queries
// ============================================================================

/**
 * Get current price for a specific card.
 */
export async function getCardPrice(
  cardId: string,
  game?: GameShard
): Promise<CardPrice | null> {
  const shard = game || routeCardToShard(cardId);

  return withShard(shard, async (prisma) => {
    const card = await prisma.cardPriceV2.findUnique({
      where: { cardId },
    });

    if (!card) return null;

    return {
      cardId: card.cardId,
      name: card.name,
      game: card.game,
      setCode: card.setCode,
      priceGbp: card.bestPriceGbp?.toNumber() ?? 0,
      change24h: 0, // Calculate from history if needed
      imageUrl: card.imageUrl,
    };
  });
}

/**
 * Get price history for a card.
 */
export async function getCardPriceHistory(
  cardId: string,
  game: GameShard | undefined,
  days: number = 30
): Promise<CardPriceHistoryPoint[]> {
  const shard = game || routeCardToShard(cardId);
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  return withShard(shard, async (prisma) => {
    const history = await prisma.cardPriceHistory.findMany({
      where: {
        cardId,
        snapshotDate: { gte: startDate },
      },
      orderBy: { snapshotDate: "asc" },
      select: {
        snapshotDate: true,
        priceGbp: true,
        priceJpy: true,
        change: true,
      },
    });

    return history.map((h) => ({
      date: h.snapshotDate.toISOString().split("T")[0],
      priceGbp: h.priceGbp.toNumber(),
      priceJpy: h.priceJpy?.toNumber() ?? null,
      change: h.change.toNumber(),
    }));
  });
}

/**
 * Search cards within a specific game.
 */
export async function searchCards(
  game: GameShard,
  query: string,
  options: {
    limit?: number;
    offset?: number;
    setCode?: string;
    minPrice?: number;
    maxPrice?: number;
  } = {}
): Promise<{ cards: CardPrice[]; totalCount: number }> {
  const { limit = 20, offset = 0, setCode, minPrice, maxPrice } = options;

  return withShard(game, async (prisma) => {
    const where: Record<string, unknown> = {
      name: { contains: query, mode: "insensitive" },
    };

    if (setCode) {
      where.setCode = setCode;
    }

    if (minPrice !== undefined || maxPrice !== undefined) {
      where.bestPriceGbp = {};
      if (minPrice !== undefined) {
        (where.bestPriceGbp as Record<string, unknown>).gte = new Decimal(minPrice);
      }
      if (maxPrice !== undefined) {
        (where.bestPriceGbp as Record<string, unknown>).lte = new Decimal(maxPrice);
      }
    }

    const [cards, totalCount] = await Promise.all([
      prisma.cardPriceV2.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: { bestPriceGbp: "desc" },
      }),
      prisma.cardPriceV2.count({ where }),
    ]);

    return {
      cards: cards.map((c) => ({
        cardId: c.cardId,
        name: c.name,
        game: c.game,
        setCode: c.setCode,
        priceGbp: c.bestPriceGbp?.toNumber() ?? 0,
        change24h: 0,
        imageUrl: c.imageUrl,
      })),
      totalCount,
    };
  });
}

/**
 * Search cards across all active games.
 */
export async function searchCardsAcrossGames(
  query: string,
  options: {
    limitPerGame?: number;
    minPrice?: number;
    maxPrice?: number;
  } = {}
): Promise<CrossGameSearchResult[]> {
  const { limitPerGame = 10, minPrice, maxPrice } = options;

  const results = await withAllShards(async (prisma, game) => {
    const where: Record<string, unknown> = {
      name: { contains: query, mode: "insensitive" },
    };

    if (minPrice !== undefined || maxPrice !== undefined) {
      where.bestPriceGbp = {};
      if (minPrice !== undefined) {
        (where.bestPriceGbp as Record<string, unknown>).gte = new Decimal(minPrice);
      }
      if (maxPrice !== undefined) {
        (where.bestPriceGbp as Record<string, unknown>).lte = new Decimal(maxPrice);
      }
    }

    const [cards, totalCount] = await Promise.all([
      prisma.cardPriceV2.findMany({
        where,
        take: limitPerGame,
        orderBy: { bestPriceGbp: "desc" },
      }),
      prisma.cardPriceV2.count({ where }),
    ]);

    return cards.map((c) => ({
      cardId: c.cardId,
      name: c.name,
      game: c.game,
      setCode: c.setCode,
      priceGbp: c.bestPriceGbp?.toNumber() ?? 0,
      change24h: 0,
      imageUrl: c.imageUrl,
      _totalCount: totalCount,
    }));
  });

  return results.map(({ game, results }) => ({
    game,
    gameName: getShardDisplayName(game),
    cards: results.map(({ _totalCount, ...card }) => card),
    totalCount: results[0]?._totalCount ?? 0,
  }));
}

// ============================================================================
// Aggregation Queries
// ============================================================================

/**
 * Get statistics for a specific game.
 */
export async function getGameStats(game: GameShard): Promise<GameStats> {
  return withShard(game, async (prisma) => {
    const [cardStats, historyCount] = await Promise.all([
      prisma.cardPriceV2.aggregate({
        _count: true,
        _avg: { bestPriceGbp: true },
        _sum: { bestPriceGbp: true },
      }),
      prisma.cardPriceHistory.count(),
    ]);

    return {
      game,
      gameName: getShardDisplayName(game),
      cardCount: cardStats._count,
      historyRows: historyCount,
      avgPriceGbp: cardStats._avg.bestPriceGbp?.toNumber() ?? 0,
      totalValueGbp: cardStats._sum.bestPriceGbp?.toNumber() ?? 0,
    };
  });
}

/**
 * Get statistics for all active games.
 */
export async function getAllGameStats(): Promise<GameStats[]> {
  const activeShards = getActiveShards();
  const stats = await Promise.all(activeShards.map(getGameStats));
  return stats;
}

/**
 * Get top cards by price across all games.
 */
export async function getTopCardsAcrossGames(
  limit: number = 10
): Promise<(CardPrice & { gameName: string })[]> {
  const results = await withAllShards(async (prisma) => {
    const cards = await prisma.cardPriceV2.findMany({
      where: { bestPriceGbp: { gt: 0 } },
      orderBy: { bestPriceGbp: "desc" },
      take: limit,
    });

    return cards.map((c) => ({
      cardId: c.cardId,
      name: c.name,
      game: c.game,
      setCode: c.setCode,
      priceGbp: c.bestPriceGbp?.toNumber() ?? 0,
      change24h: 0,
      imageUrl: c.imageUrl,
    }));
  });

  // Flatten and sort by price
  const allCards = results.flatMap(({ game, results }) =>
    results.map((card) => ({
      ...card,
      gameName: getShardDisplayName(game),
    }))
  );

  return allCards
    .sort((a, b) => b.priceGbp - a.priceGbp)
    .slice(0, limit);
}

/**
 * Get price movement leaders across all games.
 */
export async function getPriceMoversAcrossGames(
  type: "gainers" | "losers",
  limit: number = 10
): Promise<(CardPrice & { gameName: string })[]> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const results = await withAllShards(async (prisma) => {
    // Get history entries with significant price changes
    const history = await prisma.cardPriceHistory.findMany({
      where: {
        snapshotDate: today,
        change: type === "gainers" ? { gt: 0 } : { lt: 0 },
      },
      orderBy: {
        change: type === "gainers" ? "desc" : "asc",
      },
      take: limit,
    });

    // Fetch card details for these history entries
    const cardIds = history.map((h) => h.cardId);
    const cards = await prisma.cardPriceV2.findMany({
      where: { cardId: { in: cardIds } },
      select: { cardId: true, name: true, imageUrl: true },
    });
    const cardMap = new Map(cards.map((c) => [c.cardId, c]));

    return history.map((h) => {
      const card = cardMap.get(h.cardId);
      return {
        cardId: h.cardId,
        name: card?.name ?? h.cardId,
        game: h.game,
        setCode: h.setCode,
        priceGbp: h.priceGbp.toNumber(),
        change24h: h.change.toNumber(),
        imageUrl: card?.imageUrl ?? null,
      };
    });
  });

  const allCards = results.flatMap(({ game, results }) =>
    results.map((card) => ({
      ...card,
      gameName: getShardDisplayName(game),
    }))
  );

  return allCards
    .sort((a, b) =>
      type === "gainers"
        ? b.change24h - a.change24h
        : a.change24h - b.change24h
    )
    .slice(0, limit);
}

// ============================================================================
// Set/Collection Queries
// ============================================================================

/**
 * Get all sets for a specific game.
 */
export async function getGameSets(
  game: GameShard
): Promise<{ setCode: string; cardCount: number; avgPrice: number }[]> {
  return withShard(game, async (prisma) => {
    const sets = await prisma.cardPriceV2.groupBy({
      by: ["setCode"],
      _count: true,
      _avg: { bestPriceGbp: true },
      orderBy: { setCode: "asc" },
    });

    return sets
      .filter((s) => s.setCode)
      .map((s) => ({
        setCode: s.setCode!,
        cardCount: s._count,
        avgPrice: s._avg.bestPriceGbp?.toNumber() ?? 0,
      }));
  });
}

/**
 * Get cards in a specific set.
 */
export async function getSetCards(
  game: GameShard,
  setCode: string
): Promise<CardPrice[]> {
  return withShard(game, async (prisma) => {
    const cards = await prisma.cardPriceV2.findMany({
      where: { setCode },
      orderBy: { cardNumber: "asc" },
    });

    return cards.map((c) => ({
      cardId: c.cardId,
      name: c.name,
      game: c.game,
      setCode: c.setCode,
      priceGbp: c.bestPriceGbp?.toNumber() ?? 0,
      change24h: 0,
      imageUrl: c.imageUrl,
    }));
  });
}

// ============================================================================
// Exports
// ============================================================================

export const shardQueries = {
  // Single card
  getCardPrice,
  getCardPriceHistory,

  // Search
  searchCards,
  searchCardsAcrossGames,

  // Aggregations
  getGameStats,
  getAllGameStats,
  getTopCardsAcrossGames,
  getPriceMoversAcrossGames,

  // Sets
  getGameSets,
  getSetCards,
};
