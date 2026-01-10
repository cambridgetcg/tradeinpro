/**
 * Database Loader
 *
 * Loads transformed card data into PostgreSQL database.
 * Supports upsert operations, batch processing, and price history tracking.
 */

import { PrismaClient } from '@prisma/client';
import type { GameCode } from '../config/games.js';
import type { TransformedCard } from '../pipeline/transformer.js';

/**
 * Database loader configuration
 */
export interface DatabaseLoaderConfig {
  batchSize: number;
  maxRetries: number;
  retryDelay: number;
  trackPriceHistory: boolean;
  updateExisting: boolean;
  dryRun: boolean;
}

/**
 * Load result
 */
export interface LoadResult {
  success: boolean;
  inserted: number;
  updated: number;
  skipped: number;
  errors: number;
  duration: number;
  priceHistoryRecords: number;
  errorDetails: Array<{ cardId: string; error: string }>;
}

/**
 * Price history record
 */
export interface PriceHistoryRecord {
  cardId: string;
  game: GameCode;
  priceUsd: number | null;
  priceGbp: number | null;
  tradeinPriceGbp: number | null;
  source: string;
  recordedAt: Date;
}

const DEFAULT_CONFIG: DatabaseLoaderConfig = {
  batchSize: 100,
  maxRetries: 3,
  retryDelay: 1000,
  trackPriceHistory: true,
  updateExisting: true,
  dryRun: false,
};

/**
 * Database loader
 */
export class DatabaseLoader {
  private prisma: PrismaClient;
  private config: DatabaseLoaderConfig;
  private initialized: boolean = false;

  constructor(config?: Partial<DatabaseLoaderConfig>, prismaClient?: PrismaClient) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.prisma = prismaClient || new PrismaClient();
  }

  /**
   * Initialize database connection
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    await this.prisma.$connect();
    this.initialized = true;
  }

  /**
   * Close database connection
   */
  async close(): Promise<void> {
    await this.prisma.$disconnect();
    this.initialized = false;
  }

  /**
   * Load transformed cards into database
   */
  async loadCards(cards: TransformedCard[]): Promise<LoadResult> {
    const startTime = Date.now();
    await this.init();

    const result: LoadResult = {
      success: true,
      inserted: 0,
      updated: 0,
      skipped: 0,
      errors: 0,
      duration: 0,
      priceHistoryRecords: 0,
      errorDetails: [],
    };

    if (this.config.dryRun) {
      console.log(`[DRY RUN] Would load ${cards.length} cards`);
      result.duration = Date.now() - startTime;
      return result;
    }

    // Process in batches
    for (let i = 0; i < cards.length; i += this.config.batchSize) {
      const batch = cards.slice(i, i + this.config.batchSize);

      try {
        const batchResult = await this.loadBatch(batch);
        result.inserted += batchResult.inserted;
        result.updated += batchResult.updated;
        result.skipped += batchResult.skipped;
        result.errors += batchResult.errors;
        result.priceHistoryRecords += batchResult.priceHistoryRecords;
        result.errorDetails.push(...batchResult.errorDetails);
      } catch (error) {
        result.errors += batch.length;
        result.errorDetails.push({
          cardId: 'batch',
          error: error instanceof Error ? error.message : 'Unknown batch error',
        });
      }
    }

    result.success = result.errors === 0;
    result.duration = Date.now() - startTime;
    return result;
  }

  /**
   * Load a batch of cards
   */
  private async loadBatch(cards: TransformedCard[]): Promise<{
    inserted: number;
    updated: number;
    skipped: number;
    errors: number;
    priceHistoryRecords: number;
    errorDetails: Array<{ cardId: string; error: string }>;
  }> {
    const result = {
      inserted: 0,
      updated: 0,
      skipped: 0,
      errors: 0,
      priceHistoryRecords: 0,
      errorDetails: [] as Array<{ cardId: string; error: string }>,
    };

    // Use a transaction for atomicity
    await this.prisma.$transaction(async (tx) => {
      for (const card of cards) {
        try {
          const existing = await tx.cardPriceV2.findUnique({
            where: { cardId: card.cardId },
          });

          if (existing && !this.config.updateExisting) {
            result.skipped++;
            continue;
          }

          // Prepare data for upsert
          const data = this.transformCardToDbRecord(card);

          // Upsert the card
          if (existing) {
            await tx.cardPriceV2.update({
              where: { cardId: card.cardId },
              data,
            });
            result.updated++;
          } else {
            await tx.cardPriceV2.create({
              data: {
                cardId: card.cardId,
                ...data,
              },
            });
            result.inserted++;
          }

          // Track price history if enabled
          if (this.config.trackPriceHistory && this.shouldTrackHistory(card, existing)) {
            await tx.priceHistory.create({
              data: {
                cardId: card.cardId,
                game: card.game,
                priceUsd: card.priceUsd,
                priceGbp: card.priceGbp,
                tradeinPriceGbp: card.tradeinPriceGbp,
                source: card.primarySource,
                recordedAt: new Date(),
              },
            });
            result.priceHistoryRecords++;
          }
        } catch (error) {
          result.errors++;
          result.errorDetails.push({
            cardId: card.cardId,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }
    });

    return result;
  }

  /**
   * Transform card to database record format
   */
  private transformCardToDbRecord(card: TransformedCard): Record<string, unknown> {
    return {
      game: card.game,
      name: card.name,
      releaseSet: card.releaseSet,
      fullCardNumber: card.fullCardNumber,
      setCode: card.setCode,
      cardNumber: card.cardNumber,
      variantType: card.variantType,
      isVariant: card.isVariant,
      // Pricing
      optcgTcgplayerUsd: card.priceUsd,
      optcgTcgplayerGbp: card.priceGbp,
      lowPriceUsd: card.lowPriceUsd,
      midPriceUsd: card.midPriceUsd,
      highPriceUsd: card.highPriceUsd,
      marketPriceUsd: card.marketPriceUsd,
      bestPriceGbp: card.bestPriceGbp,
      tradeinPriceGbp: card.tradeinPriceGbp,
      // Metadata
      rarity: card.rarity,
      imageUrl: card.imageUrl,
      productUrl: card.productUrl,
      // Quality
      qualityScore: card.qualityScore,
      priceConfidence: card.priceConfidence,
      sources: card.sources,
      primarySource: card.primarySource,
      // Timestamps
      lastUpdated: card.lastUpdated,
      updatedAt: new Date(),
    };
  }

  /**
   * Determine if price history should be recorded
   */
  private shouldTrackHistory(card: TransformedCard, existing?: { priceUsd?: number | null; priceGbp?: number | null } | null): boolean {
    if (!existing) return card.priceUsd !== null || card.priceGbp !== null;

    // Only track if price changed significantly (>1%)
    const threshold = 0.01;

    if (card.priceUsd !== null && existing.priceUsd !== null && existing.priceUsd !== undefined) {
      const change = Math.abs((card.priceUsd - existing.priceUsd) / existing.priceUsd);
      if (change > threshold) return true;
    }

    if (card.priceGbp !== null && existing.priceGbp !== null && existing.priceGbp !== undefined) {
      const change = Math.abs((card.priceGbp - existing.priceGbp) / existing.priceGbp);
      if (change > threshold) return true;
    }

    return false;
  }

  /**
   * Load price history for analysis
   */
  async getPriceHistory(
    cardId: string,
    options?: {
      startDate?: Date;
      endDate?: Date;
      limit?: number;
    }
  ): Promise<PriceHistoryRecord[]> {
    await this.init();

    const where: Record<string, unknown> = { cardId };

    if (options?.startDate || options?.endDate) {
      where.recordedAt = {};
      if (options.startDate) {
        (where.recordedAt as Record<string, unknown>).gte = options.startDate;
      }
      if (options.endDate) {
        (where.recordedAt as Record<string, unknown>).lte = options.endDate;
      }
    }

    const records = await this.prisma.priceHistory.findMany({
      where,
      orderBy: { recordedAt: 'desc' },
      take: options?.limit || 100,
    });

    return records.map((r) => ({
      cardId: r.cardId,
      game: r.game as GameCode,
      priceUsd: r.priceUsd ? Number(r.priceUsd) : null,
      priceGbp: r.priceGbp ? Number(r.priceGbp) : null,
      tradeinPriceGbp: r.tradeinPriceGbp ? Number(r.tradeinPriceGbp) : null,
      source: r.source,
      recordedAt: r.recordedAt,
    }));
  }

  /**
   * Get cards by game
   */
  async getCardsByGame(game: GameCode, options?: {
    setCode?: string;
    withPrices?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<TransformedCard[]> {
    await this.init();

    const where: Record<string, unknown> = { game };

    if (options?.setCode) {
      where.setCode = options.setCode;
    }

    if (options?.withPrices) {
      where.optcgTcgplayerUsd = { not: null };
    }

    const cards = await this.prisma.cardPriceV2.findMany({
      where,
      take: options?.limit || 1000,
      skip: options?.offset || 0,
      orderBy: { cardId: 'asc' },
    });

    return cards.map((c) => this.dbRecordToTransformedCard(c));
  }

  /**
   * Convert database record to TransformedCard
   */
  private dbRecordToTransformedCard(record: Record<string, unknown>): TransformedCard {
    return {
      cardId: record.cardId as string,
      game: record.game as GameCode,
      name: record.name as string,
      releaseSet: record.releaseSet as string,
      fullCardNumber: record.fullCardNumber as string,
      setCode: record.setCode as string,
      cardNumber: record.cardNumber as string,
      variantType: record.variantType as string | null,
      isVariant: record.isVariant as boolean,
      priceUsd: record.optcgTcgplayerUsd as number | null,
      lowPriceUsd: record.lowPriceUsd as number | null,
      midPriceUsd: record.midPriceUsd as number | null,
      highPriceUsd: record.highPriceUsd as number | null,
      marketPriceUsd: record.marketPriceUsd as number | null,
      priceGbp: record.optcgTcgplayerGbp as number | null,
      priceEur: null,
      bestPriceGbp: record.bestPriceGbp as number | null,
      tradeinPriceGbp: record.tradeinPriceGbp as number | null,
      rarity: record.rarity as string | null,
      imageUrl: record.imageUrl as string | null,
      productUrl: record.productUrl as string | null,
      qualityScore: record.qualityScore as number || 0,
      priceConfidence: record.priceConfidence as number || 0,
      sources: record.sources as string[] || [],
      primarySource: record.primarySource as string || 'unknown',
      lastUpdated: record.lastUpdated as Date || new Date(),
      transformedAt: record.updatedAt as Date || new Date(),
    };
  }

  /**
   * Get statistics
   */
  async getStats(): Promise<{
    totalCards: number;
    cardsByGame: Record<string, number>;
    cardsWithPrices: number;
    priceHistoryRecords: number;
    lastUpdated: Date | null;
  }> {
    await this.init();

    const [totalCards, cardsWithPrices, priceHistoryRecords, lastCard] = await Promise.all([
      this.prisma.cardPriceV2.count(),
      this.prisma.cardPriceV2.count({ where: { optcgTcgplayerUsd: { not: null } } }),
      this.prisma.priceHistory.count(),
      this.prisma.cardPriceV2.findFirst({ orderBy: { updatedAt: 'desc' } }),
    ]);

    // Get counts by game
    const gameCounts = await this.prisma.cardPriceV2.groupBy({
      by: ['game'],
      _count: { game: true },
    });

    const cardsByGame: Record<string, number> = {};
    for (const gc of gameCounts) {
      cardsByGame[gc.game] = gc._count.game;
    }

    return {
      totalCards,
      cardsByGame,
      cardsWithPrices,
      priceHistoryRecords,
      lastUpdated: lastCard?.updatedAt || null,
    };
  }

  /**
   * Delete old price history records
   */
  async pruneHistory(olderThan: Date): Promise<number> {
    await this.init();

    if (this.config.dryRun) {
      const count = await this.prisma.priceHistory.count({
        where: { recordedAt: { lt: olderThan } },
      });
      console.log(`[DRY RUN] Would delete ${count} price history records`);
      return count;
    }

    const result = await this.prisma.priceHistory.deleteMany({
      where: { recordedAt: { lt: olderThan } },
    });

    return result.count;
  }

  /**
   * Export data for ML training
   */
  async exportForML(options?: {
    game?: GameCode;
    startDate?: Date;
    endDate?: Date;
    minPriceUsd?: number;
  }): Promise<Array<{
    cardId: string;
    game: string;
    name: string;
    setCode: string;
    rarity: string | null;
    priceUsd: number;
    priceGbp: number | null;
    historicalPrices: Array<{ date: string; price: number }>;
  }>> {
    await this.init();

    const where: Record<string, unknown> = {
      optcgTcgplayerUsd: { not: null },
    };

    if (options?.game) {
      where.game = options.game;
    }

    if (options?.minPriceUsd) {
      where.optcgTcgplayerUsd = { gte: options.minPriceUsd };
    }

    const cards = await this.prisma.cardPriceV2.findMany({
      where,
      include: {
        // Include price history if available
        priceHistory: {
          where: {
            ...(options?.startDate && { recordedAt: { gte: options.startDate } }),
            ...(options?.endDate && { recordedAt: { lte: options.endDate } }),
          },
          orderBy: { recordedAt: 'asc' },
        },
      },
    });

    return cards.map((card) => ({
      cardId: card.cardId,
      game: card.game,
      name: card.name,
      setCode: card.setCode,
      rarity: card.rarity,
      priceUsd: Number(card.optcgTcgplayerUsd),
      priceGbp: card.optcgTcgplayerGbp ? Number(card.optcgTcgplayerGbp) : null,
      historicalPrices: card.priceHistory.map((ph) => ({
        date: ph.recordedAt.toISOString(),
        price: ph.priceUsd ? Number(ph.priceUsd) : 0,
      })),
    }));
  }
}

/**
 * Create database loader instance
 */
export function createDatabaseLoader(
  config?: Partial<DatabaseLoaderConfig>,
  prismaClient?: PrismaClient
): DatabaseLoader {
  return new DatabaseLoader(config, prismaClient);
}

/**
 * Quick load helper
 */
export async function loadCards(
  cards: TransformedCard[],
  config?: Partial<DatabaseLoaderConfig>
): Promise<LoadResult> {
  const loader = new DatabaseLoader(config);
  try {
    return await loader.loadCards(cards);
  } finally {
    await loader.close();
  }
}
