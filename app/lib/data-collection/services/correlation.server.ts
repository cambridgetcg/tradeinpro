/**
 * Correlation Service
 *
 * Computes daily correlation coefficients for ML features:
 * - Card-to-set correlation (how closely a card tracks its set)
 * - Card-to-rarity correlation (how closely a card tracks its rarity)
 * - Correlation deviation (how anomalous the card's behavior is)
 *
 * These are cached daily to avoid expensive on-the-fly calculations.
 */

import type { PrismaClient } from "@prisma/client";

// =============================================================================
// TYPES
// =============================================================================

export interface CardCorrelation {
  cardId: string;
  correlationToSet: number;
  correlationToRarity: number;
  correlationDeviation: number;
  sampleDays: number;
  pValueSet: number | null;
  pValueRarity: number | null;
}

export interface CorrelationComputeResult {
  computed: number;
  failed: number;
  snapshotDate: Date;
}

// =============================================================================
// STATISTICAL FUNCTIONS
// =============================================================================

/**
 * Calculate Pearson correlation coefficient
 */
function pearsonCorrelation(x: number[], y: number[]): number {
  if (x.length !== y.length || x.length < 3) return 0;

  const n = x.length;
  const sumX = x.reduce((a, b) => a + b, 0);
  const sumY = y.reduce((a, b) => a + b, 0);
  const sumXY = x.reduce((sum, xi, i) => sum + xi * y[i], 0);
  const sumX2 = x.reduce((sum, xi) => sum + xi * xi, 0);
  const sumY2 = y.reduce((sum, yi) => sum + yi * yi, 0);

  const numerator = n * sumXY - sumX * sumY;
  const denominator = Math.sqrt(
    (n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY)
  );

  if (denominator === 0) return 0;
  return Math.max(-1, Math.min(1, numerator / denominator));
}

/**
 * Calculate p-value for correlation coefficient
 * Uses t-distribution approximation
 */
function correlationPValue(r: number, n: number): number {
  if (n <= 2) return 1;

  // t-statistic
  const t = r * Math.sqrt((n - 2) / (1 - r * r));
  const df = n - 2;

  // Approximate p-value using beta function approximation
  // For large df, t-distribution approaches normal
  if (df > 100) {
    // Use normal approximation
    const z = Math.abs(t);
    // Approximate cumulative normal using error function
    const p = 1 - 0.5 * (1 + erf(z / Math.sqrt(2)));
    return 2 * p; // Two-tailed
  }

  // For smaller df, use beta function approximation
  const x = df / (df + t * t);
  const a = df / 2;
  const b = 0.5;

  // Incomplete beta function approximation
  const betaInc = incompleteBeta(x, a, b);
  return betaInc;
}

/**
 * Error function approximation (for normal CDF)
 */
function erf(x: number): number {
  const sign = x >= 0 ? 1 : -1;
  x = Math.abs(x);

  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const t = 1 / (1 + p * x);
  const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

  return sign * y;
}

/**
 * Incomplete beta function approximation
 */
function incompleteBeta(x: number, a: number, b: number): number {
  // Simple continued fraction approximation
  if (x === 0) return 0;
  if (x === 1) return 1;

  // For numerical stability, use the symmetry relation if needed
  if (x > (a + 1) / (a + b + 2)) {
    return 1 - incompleteBeta(1 - x, b, a);
  }

  // Compute using continued fraction
  const lnBeta = lgamma(a) + lgamma(b) - lgamma(a + b);
  const front = Math.exp(Math.log(x) * a + Math.log(1 - x) * b - lnBeta) / a;

  // Lentz's algorithm for continued fraction
  let f = 1;
  let c = 1;
  let d = 0;

  for (let m = 1; m <= 100; m++) {
    let numerator: number;
    const m2 = 2 * m;

    // Even step
    numerator = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2));
    d = 1 + numerator * d;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    d = 1 / d;
    c = 1 + numerator / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    f *= c * d;

    // Odd step
    numerator =
      -((a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1));
    d = 1 + numerator * d;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    d = 1 / d;
    c = 1 + numerator / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    const delta = c * d;
    f *= delta;

    if (Math.abs(delta - 1) < 1e-8) break;
  }

  return front * (f - 1);
}

/**
 * Log gamma function approximation (Stirling's approximation)
 */
function lgamma(x: number): number {
  if (x <= 0) return Infinity;

  const c = [
    76.18009172947146, -86.50532032941677, 24.01409824083091,
    -1.231739572450155, 0.001208650973866179, -0.000005395239384953,
  ];

  let y = x;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) {
    ser += c[j] / ++y;
  }
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

// =============================================================================
// CORRELATION COMPUTATION
// =============================================================================

/**
 * Build daily price index for a set of cards
 */
async function buildSetPriceIndex(
  prisma: PrismaClient,
  setCode: string,
  startDate: Date,
  endDate: Date
): Promise<Map<string, number>> {
  const history = await prisma.$queryRaw<
    Array<{ snapshot_date: Date; avg_price: number }>
  >`
    SELECT h.snapshot_date, AVG(h.price_gbp) as avg_price
    FROM card_price_history h
    JOIN card_prices_v2 c ON h.card_id = c.card_id
    WHERE c.set_code = ${setCode}
      AND h.snapshot_date >= ${startDate}
      AND h.snapshot_date <= ${endDate}
    GROUP BY h.snapshot_date
    ORDER BY h.snapshot_date
  `;

  const index = new Map<string, number>();
  for (const row of history) {
    const dateKey = row.snapshot_date.toISOString().split("T")[0];
    index.set(dateKey, Number(row.avg_price));
  }

  return index;
}

/**
 * Build daily price index for a rarity
 */
async function buildRarityPriceIndex(
  prisma: PrismaClient,
  rarity: string,
  startDate: Date,
  endDate: Date
): Promise<Map<string, number>> {
  const history = await prisma.$queryRaw<
    Array<{ snapshot_date: Date; avg_price: number }>
  >`
    SELECT h.snapshot_date, AVG(h.price_gbp) as avg_price
    FROM card_price_history h
    JOIN card_prices_v2 c ON h.card_id = c.card_id
    WHERE c.rarity = ${rarity}
      AND h.snapshot_date >= ${startDate}
      AND h.snapshot_date <= ${endDate}
    GROUP BY h.snapshot_date
    ORDER BY h.snapshot_date
  `;

  const index = new Map<string, number>();
  for (const row of history) {
    const dateKey = row.snapshot_date.toISOString().split("T")[0];
    index.set(dateKey, Number(row.avg_price));
  }

  return index;
}

/**
 * Get price history for a specific card
 */
async function getCardPriceHistory(
  prisma: PrismaClient,
  cardId: string,
  startDate: Date,
  endDate: Date
): Promise<Map<string, number>> {
  const history = await prisma.cardPriceHistory.findMany({
    where: {
      cardId,
      snapshotDate: {
        gte: startDate,
        lte: endDate,
      },
    },
    orderBy: {
      snapshotDate: "asc",
    },
  });

  const prices = new Map<string, number>();
  for (const row of history) {
    const dateKey = row.snapshotDate.toISOString().split("T")[0];
    prices.set(dateKey, Number(row.priceGbp));
  }

  return prices;
}

/**
 * Align card prices with index prices (only keep dates both have)
 */
function alignPriceSeries(
  cardPrices: Map<string, number>,
  indexPrices: Map<string, number>
): { cardPrices: number[]; indexPrices: number[] } {
  const alignedCard: number[] = [];
  const alignedIndex: number[] = [];

  for (const [date, cardPrice] of cardPrices) {
    const indexPrice = indexPrices.get(date);
    if (indexPrice !== undefined) {
      alignedCard.push(cardPrice);
      alignedIndex.push(indexPrice);
    }
  }

  return { cardPrices: alignedCard, indexPrices: alignedIndex };
}

/**
 * Compute correlation for a single card
 */
export async function computeCardCorrelation(
  prisma: PrismaClient,
  cardId: string,
  setCode: string,
  rarity: string,
  lookbackDays: number = 30
): Promise<CardCorrelation | null> {
  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - lookbackDays * 24 * 60 * 60 * 1000);

  // Get card price history
  const cardPrices = await getCardPriceHistory(prisma, cardId, startDate, endDate);

  if (cardPrices.size < 7) {
    // Need at least 7 days of data for meaningful correlation
    return null;
  }

  // Get set and rarity indices
  const [setIndex, rarityIndex] = await Promise.all([
    buildSetPriceIndex(prisma, setCode, startDate, endDate),
    buildRarityPriceIndex(prisma, rarity, startDate, endDate),
  ]);

  // Align price series
  const alignedSet = alignPriceSeries(cardPrices, setIndex);
  const alignedRarity = alignPriceSeries(cardPrices, rarityIndex);

  // Calculate correlations
  const correlationToSet = pearsonCorrelation(
    alignedSet.cardPrices,
    alignedSet.indexPrices
  );
  const correlationToRarity = pearsonCorrelation(
    alignedRarity.cardPrices,
    alignedRarity.indexPrices
  );

  // Calculate deviation (how different this card is from expected)
  const correlationDeviation = Math.abs(correlationToSet - correlationToRarity);

  // Calculate p-values
  const pValueSet = correlationPValue(correlationToSet, alignedSet.cardPrices.length);
  const pValueRarity = correlationPValue(
    correlationToRarity,
    alignedRarity.cardPrices.length
  );

  return {
    cardId,
    correlationToSet,
    correlationToRarity,
    correlationDeviation,
    sampleDays: cardPrices.size,
    pValueSet,
    pValueRarity,
  };
}

/**
 * Compute correlations for all cards and persist to database
 */
export async function computeAndPersistCorrelations(
  prisma: PrismaClient,
  game: string = "onepiece",
  lookbackDays: number = 30,
  batchSize: number = 100
): Promise<CorrelationComputeResult> {
  const snapshotDate = new Date();
  snapshotDate.setHours(0, 0, 0, 0);

  console.log(`[Correlation] Computing correlations for ${game}`);

  // Get all cards with enough history
  const cards = await prisma.cardPriceV2.findMany({
    where: { game },
    select: {
      cardId: true,
      setCode: true,
      rarity: true,
    },
  });

  console.log(`[Correlation] Processing ${cards.length} cards`);

  let computed = 0;
  let failed = 0;

  // Process in batches
  for (let i = 0; i < cards.length; i += batchSize) {
    const batch = cards.slice(i, i + batchSize);

    // Process batch in parallel
    const results = await Promise.all(
      batch.map(async (card) => {
        try {
          if (!card.setCode || !card.rarity) {
            return null;
          }
          return await computeCardCorrelation(
            prisma,
            card.cardId,
            card.setCode,
            card.rarity,
            lookbackDays
          );
        } catch (error) {
          console.warn(`[Correlation] Error computing for ${card.cardId}:`, error);
          return null;
        }
      })
    );

    // Persist results
    for (const result of results) {
      if (!result) {
        failed++;
        continue;
      }

      try {
        await prisma.cardCorrelationCache.upsert({
          where: {
            cardId_snapshotDate: {
              cardId: result.cardId,
              snapshotDate,
            },
          },
          update: {
            correlationToSet: result.correlationToSet,
            correlationToRarity: result.correlationToRarity,
            correlationDeviation: result.correlationDeviation,
            sampleDays: result.sampleDays,
            pValueSet: result.pValueSet,
            pValueRarity: result.pValueRarity,
          },
          create: {
            cardId: result.cardId,
            game,
            snapshotDate,
            correlationToSet: result.correlationToSet,
            correlationToRarity: result.correlationToRarity,
            correlationDeviation: result.correlationDeviation,
            sampleDays: result.sampleDays,
            pValueSet: result.pValueSet,
            pValueRarity: result.pValueRarity,
          },
        });
        computed++;
      } catch (error) {
        console.warn(`[Correlation] Error persisting for ${result.cardId}:`, error);
        failed++;
      }
    }

    // Progress logging
    if ((i + batchSize) % 500 === 0 || i + batchSize >= cards.length) {
      console.log(
        `[Correlation] Progress: ${Math.min(i + batchSize, cards.length)}/${cards.length}`
      );
    }
  }

  console.log(
    `[Correlation] Completed: ${computed} computed, ${failed} failed`
  );

  return { computed, failed, snapshotDate };
}

// =============================================================================
// LOOKUP FUNCTIONS (for feature calculation)
// =============================================================================

/**
 * Get cached correlation for a card
 */
export async function getCardCorrelation(
  prisma: PrismaClient,
  cardId: string,
  date?: Date
): Promise<CardCorrelation | null> {
  const snapshotDate = date || new Date();
  snapshotDate.setHours(0, 0, 0, 0);

  const cache = await prisma.cardCorrelationCache.findFirst({
    where: {
      cardId,
      snapshotDate: {
        lte: snapshotDate,
      },
    },
    orderBy: {
      snapshotDate: "desc",
    },
  });

  if (!cache) return null;

  return {
    cardId: cache.cardId,
    correlationToSet: cache.correlationToSet ? Number(cache.correlationToSet) : 0,
    correlationToRarity: cache.correlationToRarity
      ? Number(cache.correlationToRarity)
      : 0,
    correlationDeviation: cache.correlationDeviation
      ? Number(cache.correlationDeviation)
      : 0,
    sampleDays: cache.sampleDays,
    pValueSet: cache.pValueSet ? Number(cache.pValueSet) : null,
    pValueRarity: cache.pValueRarity ? Number(cache.pValueRarity) : null,
  };
}

/**
 * Get cached correlations for multiple cards
 */
export async function getCardCorrelations(
  prisma: PrismaClient,
  cardIds: string[],
  date?: Date
): Promise<Map<string, CardCorrelation>> {
  const snapshotDate = date || new Date();
  snapshotDate.setHours(0, 0, 0, 0);

  // Get most recent correlation for each card
  const caches = await prisma.cardCorrelationCache.findMany({
    where: {
      cardId: { in: cardIds },
      snapshotDate: {
        lte: snapshotDate,
      },
    },
    orderBy: {
      snapshotDate: "desc",
    },
    distinct: ["cardId"],
  });

  const result = new Map<string, CardCorrelation>();
  for (const cache of caches) {
    result.set(cache.cardId, {
      cardId: cache.cardId,
      correlationToSet: cache.correlationToSet ? Number(cache.correlationToSet) : 0,
      correlationToRarity: cache.correlationToRarity
        ? Number(cache.correlationToRarity)
        : 0,
      correlationDeviation: cache.correlationDeviation
        ? Number(cache.correlationDeviation)
        : 0,
      sampleDays: cache.sampleDays,
      pValueSet: cache.pValueSet ? Number(cache.pValueSet) : null,
      pValueRarity: cache.pValueRarity ? Number(cache.pValueRarity) : null,
    });
  }

  return result;
}

/**
 * Default correlation values when no cache exists
 */
export const DEFAULT_CORRELATION: CardCorrelation = {
  cardId: "",
  correlationToSet: 0.7, // Reasonable default - most cards correlate with their set
  correlationToRarity: 0.5, // Moderate rarity correlation
  correlationDeviation: 0.2, // Some deviation is normal
  sampleDays: 0,
  pValueSet: null,
  pValueRarity: null,
};
