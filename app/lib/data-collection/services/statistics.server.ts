/**
 * Statistics Service
 *
 * Computes daily statistics for ML feature calculation:
 * - Rarity-level price distributions (for percentile_in_rarity)
 * - Set-level statistics (for set momentum and correlation)
 * - Volume statistics (for relative_volume normalization)
 *
 * These statistics are pre-computed daily and cached in the database
 * to avoid expensive on-the-fly calculations during feature extraction.
 */

import type { Prisma, PrismaClient } from "@prisma/client";

// =============================================================================
// TYPES
// =============================================================================

export interface RarityDistribution {
  rarity: string;
  cardCount: number;
  avgPrice: number;
  percentiles: {
    p10: number;
    p25: number;
    p50: number;
    p75: number;
    p90: number;
    p95: number;
    p99: number;
  };
  momentum7d: number | null;
  momentum30d: number | null;
}

export interface SetDistribution {
  setCode: string;
  cardCount: number;
  avgPrice: number;
  medianPrice: number;
  totalMarketCap: number;
  minPrice: number;
  maxPrice: number;
  momentum7d: number | null;
  momentum30d: number | null;
  volatility7d: number | null;
}

export interface VolumeStats {
  avgUsListings: number;
  avgEuListings: number;
  totalCardsTracked: number;
  byRarity: Record<string, { avgListings: number; cardCount: number }>;
}

export interface ComputeStatisticsResult {
  rarityStats: RarityDistribution[];
  setStats: SetDistribution[];
  volumeStats: VolumeStats;
  snapshotDate: Date;
}

// =============================================================================
// RARITY STATISTICS
// =============================================================================

/**
 * Compute rarity-level price distributions from card_prices_v2 table
 */
export async function computeRarityStatistics(
  prisma: PrismaClient,
  game: string = "onepiece"
): Promise<RarityDistribution[]> {
  // Get all cards grouped by rarity with their current prices
  const cards = await prisma.cardPriceV2.findMany({
    where: {
      game,
      bestPriceGbp: { gt: 0 },
    },
    select: {
      cardId: true,
      rarity: true,
      bestPriceGbp: true,
    },
  });

  // Group by rarity
  const byRarity = new Map<string, number[]>();
  for (const card of cards) {
    const rarity = card.rarity || "Unknown";
    const prices = byRarity.get(rarity) || [];
    prices.push(Number(card.bestPriceGbp));
    byRarity.set(rarity, prices);
  }

  // Calculate statistics for each rarity
  const results: RarityDistribution[] = [];

  for (const [rarity, prices] of byRarity) {
    if (prices.length === 0) continue;

    // Sort for percentile calculation
    const sorted = [...prices].sort((a, b) => a - b);
    const n = sorted.length;

    // Calculate percentiles
    const percentile = (p: number): number => {
      const idx = (p / 100) * (n - 1);
      const lower = Math.floor(idx);
      const upper = Math.ceil(idx);
      if (lower === upper) return sorted[lower];
      return sorted[lower] + (sorted[upper] - sorted[lower]) * (idx - lower);
    };

    // Calculate average
    const avg = prices.reduce((a, b) => a + b, 0) / n;

    results.push({
      rarity,
      cardCount: n,
      avgPrice: avg,
      percentiles: {
        p10: percentile(10),
        p25: percentile(25),
        p50: percentile(50),
        p75: percentile(75),
        p90: percentile(90),
        p95: percentile(95),
        p99: percentile(99),
      },
      momentum7d: null, // Will be calculated from history
      momentum30d: null,
    });
  }

  return results;
}

/**
 * Calculate rarity momentum from price history
 */
export async function computeRarityMomentum(
  prisma: PrismaClient,
  game: string = "onepiece"
): Promise<Map<string, { momentum7d: number; momentum30d: number }>> {
  const now = new Date();
  const date7dAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const date30dAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  // Get current average by rarity
  const currentPrices = await prisma.cardPriceV2.groupBy({
    by: ["rarity"],
    where: { game, bestPriceGbp: { gt: 0 } },
    _avg: { bestPriceGbp: true },
  });

  const currentByRarity = new Map<string, number>();
  for (const row of currentPrices) {
    if (row.rarity && row._avg.bestPriceGbp) {
      currentByRarity.set(row.rarity, Number(row._avg.bestPriceGbp));
    }
  }

  // Get historical averages by rarity from price history
  // We need to join with card_prices_v2 to get rarity
  const history7d = await prisma.$queryRaw<
    Array<{ rarity: string; avg_price: number }>
  >`
    SELECT c.rarity, AVG(h.price_gbp) as avg_price
    FROM card_price_history h
    JOIN card_prices_v2 c ON h.card_id = c.card_id
    WHERE h.snapshot_date >= ${date7dAgo}
      AND h.snapshot_date < ${now}
      AND c.game = ${game}
    GROUP BY c.rarity
  `;

  const history30d = await prisma.$queryRaw<
    Array<{ rarity: string; avg_price: number }>
  >`
    SELECT c.rarity, AVG(h.price_gbp) as avg_price
    FROM card_price_history h
    JOIN card_prices_v2 c ON h.card_id = c.card_id
    WHERE h.snapshot_date >= ${date30dAgo}
      AND h.snapshot_date < ${date7dAgo}
      AND c.game = ${game}
    GROUP BY c.rarity
  `;

  const past7d = new Map<string, number>();
  const past30d = new Map<string, number>();

  for (const row of history7d) {
    if (row.rarity) past7d.set(row.rarity, Number(row.avg_price));
  }
  for (const row of history30d) {
    if (row.rarity) past30d.set(row.rarity, Number(row.avg_price));
  }

  // Calculate momentum
  const momentum = new Map<string, { momentum7d: number; momentum30d: number }>();

  for (const [rarity, currentPrice] of currentByRarity) {
    const price7d = past7d.get(rarity);
    const price30d = past30d.get(rarity);

    momentum.set(rarity, {
      momentum7d: price7d && price7d > 0 ? (currentPrice - price7d) / price7d : 0,
      momentum30d:
        price30d && price30d > 0 ? (currentPrice - price30d) / price30d : 0,
    });
  }

  return momentum;
}

// =============================================================================
// SET STATISTICS
// =============================================================================

/**
 * Compute set-level price statistics
 */
export async function computeSetStatistics(
  prisma: PrismaClient,
  game: string = "onepiece"
): Promise<SetDistribution[]> {
  // Get all cards grouped by set
  const cards = await prisma.cardPriceV2.findMany({
    where: {
      game,
      bestPriceGbp: { gt: 0 },
    },
    select: {
      cardId: true,
      setCode: true,
      bestPriceGbp: true,
    },
  });

  // Group by set
  const bySet = new Map<string, number[]>();
  for (const card of cards) {
    const setCode = card.setCode || "Unknown";
    const prices = bySet.get(setCode) || [];
    prices.push(Number(card.bestPriceGbp));
    bySet.set(setCode, prices);
  }

  // Calculate statistics for each set
  const results: SetDistribution[] = [];

  for (const [setCode, prices] of bySet) {
    if (prices.length === 0) continue;

    const sorted = [...prices].sort((a, b) => a - b);
    const n = sorted.length;
    const sum = prices.reduce((a, b) => a + b, 0);
    const avg = sum / n;
    const median = n % 2 === 0
      ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2
      : sorted[Math.floor(n / 2)];

    results.push({
      setCode,
      cardCount: n,
      avgPrice: avg,
      medianPrice: median,
      totalMarketCap: sum,
      minPrice: sorted[0],
      maxPrice: sorted[n - 1],
      momentum7d: null,
      momentum30d: null,
      volatility7d: null,
    });
  }

  return results;
}

/**
 * Calculate set momentum and volatility from price history
 */
export async function computeSetMomentum(
  prisma: PrismaClient,
  game: string = "onepiece"
): Promise<
  Map<string, { momentum7d: number; momentum30d: number; volatility7d: number }>
> {
  const now = new Date();
  const date7dAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const date30dAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  // Get current average by set
  const currentPrices = await prisma.cardPriceV2.groupBy({
    by: ["setCode"],
    where: { game, bestPriceGbp: { gt: 0 } },
    _avg: { bestPriceGbp: true },
  });

  const currentBySet = new Map<string, number>();
  for (const row of currentPrices) {
    if (row.setCode && row._avg.bestPriceGbp) {
      currentBySet.set(row.setCode, Number(row._avg.bestPriceGbp));
    }
  }

  // Get historical data with daily prices for volatility
  const dailyPrices = await prisma.$queryRaw<
    Array<{ set_code: string; snapshot_date: Date; avg_price: number }>
  >`
    SELECT c.set_code, h.snapshot_date, AVG(h.price_gbp) as avg_price
    FROM card_price_history h
    JOIN card_prices_v2 c ON h.card_id = c.card_id
    WHERE h.snapshot_date >= ${date7dAgo}
      AND c.game = ${game}
    GROUP BY c.set_code, h.snapshot_date
    ORDER BY c.set_code, h.snapshot_date
  `;

  // Group daily prices by set
  const dailyBySet = new Map<string, number[]>();
  for (const row of dailyPrices) {
    const prices = dailyBySet.get(row.set_code) || [];
    prices.push(Number(row.avg_price));
    dailyBySet.set(row.set_code, prices);
  }

  // Get 30-day historical averages
  const history30d = await prisma.$queryRaw<
    Array<{ set_code: string; avg_price: number }>
  >`
    SELECT c.set_code, AVG(h.price_gbp) as avg_price
    FROM card_price_history h
    JOIN card_prices_v2 c ON h.card_id = c.card_id
    WHERE h.snapshot_date >= ${date30dAgo}
      AND h.snapshot_date < ${date7dAgo}
      AND c.game = ${game}
    GROUP BY c.set_code
  `;

  const past30d = new Map<string, number>();
  for (const row of history30d) {
    past30d.set(row.set_code, Number(row.avg_price));
  }

  // Calculate momentum and volatility
  const results = new Map<
    string,
    { momentum7d: number; momentum30d: number; volatility7d: number }
  >();

  for (const [setCode, currentPrice] of currentBySet) {
    const dailyPricesSet = dailyBySet.get(setCode) || [];
    const price30d = past30d.get(setCode);

    // Calculate 7d momentum from daily prices
    const price7dStart = dailyPricesSet[0];
    const momentum7d =
      price7dStart && price7dStart > 0
        ? (currentPrice - price7dStart) / price7dStart
        : 0;

    // Calculate 30d momentum
    const momentum30d =
      price30d && price30d > 0 ? (currentPrice - price30d) / price30d : 0;

    // Calculate volatility (coefficient of variation of daily returns)
    let volatility7d = 0;
    if (dailyPricesSet.length >= 2) {
      const returns: number[] = [];
      for (let i = 1; i < dailyPricesSet.length; i++) {
        if (dailyPricesSet[i - 1] > 0) {
          returns.push(
            (dailyPricesSet[i] - dailyPricesSet[i - 1]) / dailyPricesSet[i - 1]
          );
        }
      }
      if (returns.length > 0) {
        const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
        const variance =
          returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) /
          returns.length;
        volatility7d = Math.sqrt(variance);
      }
    }

    results.set(setCode, { momentum7d, momentum30d, volatility7d });
  }

  return results;
}

// =============================================================================
// VOLUME STATISTICS
// =============================================================================

/**
 * Compute volume/listing statistics for relative_volume normalization
 */
export async function computeVolumeStatistics(
  prisma: PrismaClient,
  game: string = "onepiece"
): Promise<VolumeStats> {
  // Get US listings counts
  const usListings = await prisma.marketPriceUS.findMany({
    where: {
      source: "justtcg",
      listingsCount: { not: null },
    },
    select: {
      cardId: true,
      listingsCount: true,
    },
  });

  // Get EU listings counts
  const euListings = await prisma.marketPriceEU.findMany({
    where: {
      source: "cardmarket_csv",
      availableItems: { not: null },
    },
    select: {
      cardId: true,
      availableItems: true,
    },
  });

  // Calculate averages
  const usTotal = usListings.reduce((sum, l) => sum + (l.listingsCount || 0), 0);
  const euTotal = euListings.reduce((sum, l) => sum + (l.availableItems || 0), 0);

  const avgUsListings = usListings.length > 0 ? usTotal / usListings.length : 0;
  const avgEuListings = euListings.length > 0 ? euTotal / euListings.length : 0;

  // Get by-rarity averages
  const cardIds = new Set([
    ...usListings.map((l) => l.cardId),
    ...euListings.map((l) => l.cardId),
  ]);

  // Get rarity for each card
  const cards = await prisma.cardPriceV2.findMany({
    where: {
      cardId: { in: Array.from(cardIds) },
      game,
    },
    select: {
      cardId: true,
      rarity: true,
    },
  });

  const cardRarityMap = new Map<string, string>();
  for (const card of cards) {
    if (card.rarity) {
      cardRarityMap.set(card.cardId, card.rarity);
    }
  }

  // Build listing map
  const listingMap = new Map<string, number>();
  for (const l of usListings) {
    listingMap.set(l.cardId, l.listingsCount || 0);
  }
  for (const l of euListings) {
    const current = listingMap.get(l.cardId) || 0;
    listingMap.set(l.cardId, current + (l.availableItems || 0));
  }

  // Aggregate by rarity
  const byRarity: Record<string, { total: number; count: number }> = {};
  for (const [cardId, listings] of listingMap) {
    const rarity = cardRarityMap.get(cardId) || "Unknown";
    if (!byRarity[rarity]) {
      byRarity[rarity] = { total: 0, count: 0 };
    }
    byRarity[rarity].total += listings;
    byRarity[rarity].count++;
  }

  const byRarityResult: Record<
    string,
    { avgListings: number; cardCount: number }
  > = {};
  for (const [rarity, data] of Object.entries(byRarity)) {
    byRarityResult[rarity] = {
      avgListings: data.count > 0 ? data.total / data.count : 0,
      cardCount: data.count,
    };
  }

  return {
    avgUsListings,
    avgEuListings,
    totalCardsTracked: cardIds.size,
    byRarity: byRarityResult,
  };
}

// =============================================================================
// PERSISTENCE
// =============================================================================

/**
 * Compute all statistics and persist to database
 */
export async function computeAndPersistStatistics(
  prisma: PrismaClient,
  game: string = "onepiece"
): Promise<ComputeStatisticsResult> {
  const snapshotDate = new Date();
  snapshotDate.setHours(0, 0, 0, 0); // Normalize to start of day

  console.log(`[Statistics] Computing statistics for ${game} at ${snapshotDate.toISOString()}`);

  // Compute all statistics in parallel
  const [rarityStats, rarityMomentum, setStats, setMomentum, volumeStats] =
    await Promise.all([
      computeRarityStatistics(prisma, game),
      computeRarityMomentum(prisma, game),
      computeSetStatistics(prisma, game),
      computeSetMomentum(prisma, game),
      computeVolumeStatistics(prisma, game),
    ]);

  // Merge momentum into rarity stats
  for (const stat of rarityStats) {
    const momentum = rarityMomentum.get(stat.rarity);
    if (momentum) {
      stat.momentum7d = momentum.momentum7d;
      stat.momentum30d = momentum.momentum30d;
    }
  }

  // Merge momentum/volatility into set stats
  for (const stat of setStats) {
    const momentum = setMomentum.get(stat.setCode);
    if (momentum) {
      stat.momentum7d = momentum.momentum7d;
      stat.momentum30d = momentum.momentum30d;
      stat.volatility7d = momentum.volatility7d;
    }
  }

  // Persist rarity statistics
  console.log(`[Statistics] Persisting ${rarityStats.length} rarity statistics`);
  for (const stat of rarityStats) {
    await prisma.rarityStatistics.upsert({
      where: {
        game_rarity_snapshotDate: {
          game,
          rarity: stat.rarity,
          snapshotDate,
        },
      },
      update: {
        p10: stat.percentiles.p10,
        p25: stat.percentiles.p25,
        p50: stat.percentiles.p50,
        p75: stat.percentiles.p75,
        p90: stat.percentiles.p90,
        p95: stat.percentiles.p95,
        p99: stat.percentiles.p99,
        cardCount: stat.cardCount,
        avgPrice: stat.avgPrice,
        momentum7d: stat.momentum7d,
        momentum30d: stat.momentum30d,
      },
      create: {
        game,
        rarity: stat.rarity,
        snapshotDate,
        p10: stat.percentiles.p10,
        p25: stat.percentiles.p25,
        p50: stat.percentiles.p50,
        p75: stat.percentiles.p75,
        p90: stat.percentiles.p90,
        p95: stat.percentiles.p95,
        p99: stat.percentiles.p99,
        cardCount: stat.cardCount,
        avgPrice: stat.avgPrice,
        momentum7d: stat.momentum7d,
        momentum30d: stat.momentum30d,
      },
    });
  }

  // Persist set statistics
  console.log(`[Statistics] Persisting ${setStats.length} set statistics`);
  for (const stat of setStats) {
    await prisma.setStatistics.upsert({
      where: {
        game_setCode_snapshotDate: {
          game,
          setCode: stat.setCode,
          snapshotDate,
        },
      },
      update: {
        avgPrice: stat.avgPrice,
        medianPrice: stat.medianPrice,
        totalMarketCap: stat.totalMarketCap,
        minPrice: stat.minPrice,
        maxPrice: stat.maxPrice,
        cardCount: stat.cardCount,
        momentum7d: stat.momentum7d,
        momentum30d: stat.momentum30d,
        volatility7d: stat.volatility7d,
      },
      create: {
        game,
        setCode: stat.setCode,
        snapshotDate,
        avgPrice: stat.avgPrice,
        medianPrice: stat.medianPrice,
        totalMarketCap: stat.totalMarketCap,
        minPrice: stat.minPrice,
        maxPrice: stat.maxPrice,
        cardCount: stat.cardCount,
        momentum7d: stat.momentum7d,
        momentum30d: stat.momentum30d,
        volatility7d: stat.volatility7d,
      },
    });
  }

  // Persist volume statistics
  console.log(`[Statistics] Persisting volume statistics`);
  await prisma.volumeStatistics.upsert({
    where: {
      game_snapshotDate: {
        game,
        snapshotDate,
      },
    },
    update: {
      avgUsListings: volumeStats.avgUsListings,
      avgEuListings: volumeStats.avgEuListings,
      totalCardsTracked: volumeStats.totalCardsTracked,
      avgListingsByRarity: volumeStats.byRarity as Prisma.InputJsonValue,
    },
    create: {
      game,
      snapshotDate,
      avgUsListings: volumeStats.avgUsListings,
      avgEuListings: volumeStats.avgEuListings,
      totalCardsTracked: volumeStats.totalCardsTracked,
      avgListingsByRarity: volumeStats.byRarity as Prisma.InputJsonValue,
    },
  });

  console.log(`[Statistics] Completed statistics computation`);

  return {
    rarityStats,
    setStats,
    volumeStats,
    snapshotDate,
  };
}

// =============================================================================
// LOOKUP FUNCTIONS (for feature calculation)
// =============================================================================

/**
 * Get cached rarity statistics for a specific date
 */
export async function getRarityStatistics(
  prisma: PrismaClient,
  game: string = "onepiece",
  date?: Date
): Promise<Map<string, RarityDistribution>> {
  const snapshotDate = date || new Date();
  snapshotDate.setHours(0, 0, 0, 0);

  const stats = await prisma.rarityStatistics.findMany({
    where: {
      game,
      snapshotDate: {
        lte: snapshotDate,
      },
    },
    orderBy: {
      snapshotDate: "desc",
    },
    distinct: ["rarity"],
  });

  const result = new Map<string, RarityDistribution>();
  for (const stat of stats) {
    result.set(stat.rarity, {
      rarity: stat.rarity,
      cardCount: stat.cardCount,
      avgPrice: Number(stat.avgPrice),
      percentiles: {
        p10: Number(stat.p10),
        p25: Number(stat.p25),
        p50: Number(stat.p50),
        p75: Number(stat.p75),
        p90: Number(stat.p90),
        p95: Number(stat.p95),
        p99: Number(stat.p99),
      },
      momentum7d: stat.momentum7d ? Number(stat.momentum7d) : null,
      momentum30d: stat.momentum30d ? Number(stat.momentum30d) : null,
    });
  }

  return result;
}

/**
 * Get cached set statistics for a specific date
 */
export async function getSetStatistics(
  prisma: PrismaClient,
  game: string = "onepiece",
  date?: Date
): Promise<Map<string, SetDistribution>> {
  const snapshotDate = date || new Date();
  snapshotDate.setHours(0, 0, 0, 0);

  const stats = await prisma.setStatistics.findMany({
    where: {
      game,
      snapshotDate: {
        lte: snapshotDate,
      },
    },
    orderBy: {
      snapshotDate: "desc",
    },
    distinct: ["setCode"],
  });

  const result = new Map<string, SetDistribution>();
  for (const stat of stats) {
    result.set(stat.setCode, {
      setCode: stat.setCode,
      cardCount: stat.cardCount,
      avgPrice: Number(stat.avgPrice),
      medianPrice: Number(stat.medianPrice),
      totalMarketCap: Number(stat.totalMarketCap),
      minPrice: stat.minPrice ? Number(stat.minPrice) : 0,
      maxPrice: stat.maxPrice ? Number(stat.maxPrice) : 0,
      momentum7d: stat.momentum7d ? Number(stat.momentum7d) : null,
      momentum30d: stat.momentum30d ? Number(stat.momentum30d) : null,
      volatility7d: stat.volatility7d ? Number(stat.volatility7d) : null,
    });
  }

  return result;
}

/**
 * Get cached volume statistics for a specific date
 */
export async function getVolumeStatistics(
  prisma: PrismaClient,
  game: string = "onepiece",
  date?: Date
): Promise<VolumeStats | null> {
  const snapshotDate = date || new Date();
  snapshotDate.setHours(0, 0, 0, 0);

  const stat = await prisma.volumeStatistics.findFirst({
    where: {
      game,
      snapshotDate: {
        lte: snapshotDate,
      },
    },
    orderBy: {
      snapshotDate: "desc",
    },
  });

  if (!stat) return null;

  return {
    avgUsListings: stat.avgUsListings ? Number(stat.avgUsListings) : 0,
    avgEuListings: stat.avgEuListings ? Number(stat.avgEuListings) : 0,
    totalCardsTracked: stat.totalCardsTracked,
    byRarity: (stat.avgListingsByRarity as Record<
      string,
      { avgListings: number; cardCount: number }
    >) || {},
  };
}

/**
 * Calculate percentile for a price within its rarity
 */
export function calculatePricePercentile(
  price: number,
  distribution: RarityDistribution
): number {
  const { percentiles } = distribution;
  const thresholds = [
    { p: 0.1, v: percentiles.p10 },
    { p: 0.25, v: percentiles.p25 },
    { p: 0.5, v: percentiles.p50 },
    { p: 0.75, v: percentiles.p75 },
    { p: 0.9, v: percentiles.p90 },
    { p: 0.95, v: percentiles.p95 },
    { p: 0.99, v: percentiles.p99 },
  ];

  // Find where price falls
  if (price <= thresholds[0].v) {
    return thresholds[0].p / 2;
  }

  for (let i = 1; i < thresholds.length; i++) {
    if (price <= thresholds[i].v) {
      // Linear interpolation between percentiles
      const prevP = thresholds[i - 1].p;
      const currP = thresholds[i].p;
      const prevV = thresholds[i - 1].v;
      const currV = thresholds[i].v;
      const ratio = (price - prevV) / (currV - prevV);
      return prevP + ratio * (currP - prevP);
    }
  }

  // Above p99
  return 0.995;
}
