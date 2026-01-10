/**
 * Database Loader Module
 *
 * Loads transformed Cardmarket price data into RDS:
 * - Upserts to card_prices_v2 (current prices)
 * - Inserts to price_history (historical tracking)
 * - Handles batch operations with transactions
 */

import { PrismaClient, Prisma } from '@prisma/client';
import type { ScrapedCard } from '../scrapers/cardmarket-scraper.js';
import { CloudWatchMetrics } from '../monitoring/cloudwatch.js';

/**
 * Transformed price data ready for database
 */
export interface TransformedPrice {
  cardId: string;
  name: string;
  releaseSet: string;
  fullCardNumber: string;
  setCode: string;
  cardNumber: string;
  variantType: string | null;
  language: string;

  // Cardmarket prices (EUR)
  trendPriceEur: number | null;
  lowPriceEur: number | null;
  avg7PriceEur: number | null;
  avg30PriceEur: number | null;

  // Converted prices (GBP)
  trendPriceGbp: number | null;
  lowPriceGbp: number | null;

  // Metadata
  availableCount: number | null;
  sourceUrl: string;
  exchangeRate: number;
  scrapedAt: Date;
}

/**
 * Load result
 */
export interface LoadResult {
  success: boolean;
  upsertedCount: number;
  historyInsertedCount: number;
  errors: LoadError[];
  duration: number;
}

/**
 * Load error details
 */
export interface LoadError {
  cardId: string;
  error: string;
  type: 'upsert' | 'history' | 'validation';
}

/**
 * Loader configuration
 */
export interface LoaderConfig {
  batchSize: number;
  enableHistory: boolean;
  updateBestPrice: boolean;
  tradeinMultiplier: number;
  dryRun: boolean;
}

const DEFAULT_CONFIG: LoaderConfig = {
  batchSize: 100,
  enableHistory: true,
  updateBestPrice: true,
  tradeinMultiplier: 0.70,
  dryRun: false,
};

/**
 * Database loader class
 */
export class DatabaseLoader {
  private prisma: PrismaClient;
  private metrics: CloudWatchMetrics;
  private config: LoaderConfig;

  constructor(
    prisma?: PrismaClient,
    metrics?: CloudWatchMetrics,
    config?: Partial<LoaderConfig>
  ) {
    this.prisma = prisma || new PrismaClient();
    this.metrics = metrics || new CloudWatchMetrics({ namespace: 'CardmarketPipeline' });
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Load transformed prices into the database
   */
  async load(prices: TransformedPrice[]): Promise<LoadResult> {
    const startTime = Date.now();
    const errors: LoadError[] = [];
    let upsertedCount = 0;
    let historyInsertedCount = 0;

    // Process in batches
    const batches = this.chunk(prices, this.config.batchSize);

    for (const batch of batches) {
      try {
        const batchResult = await this.processBatch(batch);
        upsertedCount += batchResult.upserted;
        historyInsertedCount += batchResult.historyInserted;
        errors.push(...batchResult.errors);
      } catch (error) {
        // Record batch-level error
        for (const price of batch) {
          errors.push({
            cardId: price.cardId,
            error: error instanceof Error ? error.message : 'Unknown error',
            type: 'upsert',
          });
        }
      }
    }

    const duration = Date.now() - startTime;

    // Record metrics
    await this.metrics.putMetric('DatabaseUpserts', upsertedCount, 'Count');
    await this.metrics.putMetric('HistoryInserts', historyInsertedCount, 'Count');
    await this.metrics.putMetric('LoadErrors', errors.length, 'Count');
    await this.metrics.putMetric('LoadDurationMs', duration, 'Milliseconds');

    return {
      success: errors.length === 0,
      upsertedCount,
      historyInsertedCount,
      errors,
      duration,
    };
  }

  /**
   * Process a batch of prices in a transaction
   */
  private async processBatch(
    batch: TransformedPrice[]
  ): Promise<{ upserted: number; historyInserted: number; errors: LoadError[] }> {
    const errors: LoadError[] = [];
    let upserted = 0;
    let historyInserted = 0;

    if (this.config.dryRun) {
      console.log(`[DRY RUN] Would process ${batch.length} prices`);
      return { upserted: batch.length, historyInserted: batch.length, errors: [] };
    }

    // Use transaction for atomicity
    await this.prisma.$transaction(async (tx) => {
      for (const price of batch) {
        try {
          // Upsert to card_prices_v2
          await this.upsertCardPrice(tx, price);
          upserted++;

          // Insert to price_history if enabled
          if (this.config.enableHistory) {
            await this.insertPriceHistory(tx, price);
            historyInserted++;
          }
        } catch (error) {
          errors.push({
            cardId: price.cardId,
            error: error instanceof Error ? error.message : 'Unknown error',
            type: 'upsert',
          });
        }
      }
    });

    return { upserted, historyInserted, errors };
  }

  /**
   * Upsert a single card price to card_prices_v2
   */
  private async upsertCardPrice(
    tx: Prisma.TransactionClient,
    price: TransformedPrice
  ): Promise<void> {
    // Check if card exists
    const existing = await tx.cardPriceV2.findUnique({
      where: { cardId: price.cardId },
      select: {
        cardId: true,
        optcgTcgplayerGbp: true,
        limitlessCardmarketGbp: true,
      },
    });

    // Calculate best price (lowest of all sources)
    let bestPriceGbp = price.lowPriceGbp;
    if (existing && this.config.updateBestPrice) {
      const tcgPrice = existing.optcgTcgplayerGbp?.toNumber();
      if (tcgPrice && bestPriceGbp && tcgPrice < bestPriceGbp) {
        bestPriceGbp = tcgPrice;
      }
    }

    // Calculate trade-in price
    const tradeinPriceGbp = bestPriceGbp
      ? Number((bestPriceGbp * this.config.tradeinMultiplier).toFixed(2))
      : null;

    if (existing) {
      // Update existing record
      await tx.cardPriceV2.update({
        where: { cardId: price.cardId },
        data: {
          limitlessCardmarketEur: price.trendPriceEur,
          limitlessCardmarketGbp: price.trendPriceGbp,
          limitlessUpdatedAt: price.scrapedAt,
          bestPriceGbp: bestPriceGbp,
          tradeinPriceGbp: tradeinPriceGbp,
          eurToGbpRate: price.exchangeRate,
          lastUpdated: new Date(),
        },
      });
    } else {
      // Create new record
      await tx.cardPriceV2.create({
        data: {
          cardId: price.cardId,
          game: 'onepiece',
          name: price.name,
          releaseSet: price.releaseSet,
          fullCardNumber: price.fullCardNumber,
          setCode: price.setCode,
          cardNumber: price.cardNumber,
          variantType: price.variantType,
          language: price.language,
          limitlessCardmarketEur: price.trendPriceEur,
          limitlessCardmarketGbp: price.trendPriceGbp,
          limitlessUpdatedAt: price.scrapedAt,
          bestPriceGbp: bestPriceGbp,
          tradeinPriceGbp: tradeinPriceGbp,
          eurToGbpRate: price.exchangeRate,
          lastUpdated: new Date(),
        },
      });
    }
  }

  /**
   * Insert price history record for ML training data
   */
  private async insertPriceHistory(
    tx: Prisma.TransactionClient,
    price: TransformedPrice
  ): Promise<void> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Use raw SQL for price_history table (not in Prisma schema yet)
    await tx.$executeRaw`
      INSERT INTO price_history (
        card_id,
        price_date,
        tcgplayer_price_gbp,
        cardmarket_price_gbp,
        best_price_gbp,
        tradein_price_gbp,
        available_count,
        source,
        created_at
      ) VALUES (
        ${price.cardId},
        ${today},
        NULL,
        ${price.trendPriceGbp},
        ${price.lowPriceGbp},
        ${price.lowPriceGbp ? price.lowPriceGbp * this.config.tradeinMultiplier : null},
        ${price.availableCount},
        'cardmarket',
        NOW()
      )
      ON CONFLICT (card_id, price_date, source) DO UPDATE SET
        cardmarket_price_gbp = EXCLUDED.cardmarket_price_gbp,
        best_price_gbp = LEAST(
          price_history.tcgplayer_price_gbp,
          EXCLUDED.cardmarket_price_gbp
        ),
        available_count = EXCLUDED.available_count
    `;
  }

  /**
   * Load scraped cards directly (convenience method)
   */
  async loadScrapedCards(
    cards: ScrapedCard[],
    exchangeRate: number = 0.85
  ): Promise<LoadResult> {
    const transformed = cards.map((card) =>
      this.transformScrapedCard(card, exchangeRate)
    );
    return this.load(transformed);
  }

  /**
   * Transform a ScrapedCard to TransformedPrice
   */
  private transformScrapedCard(
    card: ScrapedCard,
    exchangeRate: number
  ): TransformedPrice {
    return {
      cardId: card.cardId,
      name: card.name,
      releaseSet: card.setCode,
      fullCardNumber: `${card.setCode}-${card.cardNumber}`,
      setCode: card.setCode,
      cardNumber: card.cardNumber,
      variantType: card.variantType || null,
      language: 'EN',

      trendPriceEur: card.trendPrice,
      lowPriceEur: card.lowPrice,
      avg7PriceEur: card.avg7Price,
      avg30PriceEur: card.avg30Price,

      trendPriceGbp: card.trendPrice
        ? Number((card.trendPrice * exchangeRate).toFixed(2))
        : null,
      lowPriceGbp: card.lowPrice
        ? Number((card.lowPrice * exchangeRate).toFixed(2))
        : null,

      availableCount: card.availableCount,
      sourceUrl: card.sourceUrl,
      exchangeRate,
      scrapedAt: new Date(card.scrapedAt),
    };
  }

  /**
   * Get cards that haven't been updated recently
   */
  async getStaleCards(daysSinceUpdate: number = 7): Promise<string[]> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysSinceUpdate);

    const staleCards = await this.prisma.cardPriceV2.findMany({
      where: {
        game: 'onepiece',
        OR: [
          { limitlessUpdatedAt: null },
          { limitlessUpdatedAt: { lt: cutoffDate } },
        ],
      },
      select: { cardId: true },
    });

    return staleCards.map((c) => c.cardId);
  }

  /**
   * Get price statistics
   */
  async getPriceStats(): Promise<{
    totalCards: number;
    cardsWithCardmarketPrice: number;
    avgTradeinPrice: number;
    lastUpdateTime: Date | null;
  }> {
    const [total, withPrice, avgPrice, lastUpdate] = await Promise.all([
      this.prisma.cardPriceV2.count({ where: { game: 'onepiece' } }),
      this.prisma.cardPriceV2.count({
        where: { game: 'onepiece', limitlessCardmarketGbp: { not: null } },
      }),
      this.prisma.cardPriceV2.aggregate({
        where: { game: 'onepiece', tradeinPriceGbp: { not: null } },
        _avg: { tradeinPriceGbp: true },
      }),
      this.prisma.cardPriceV2.aggregate({
        where: { game: 'onepiece' },
        _max: { limitlessUpdatedAt: true },
      }),
    ]);

    return {
      totalCards: total,
      cardsWithCardmarketPrice: withPrice,
      avgTradeinPrice: avgPrice._avg.tradeinPriceGbp?.toNumber() || 0,
      lastUpdateTime: lastUpdate._max.limitlessUpdatedAt,
    };
  }

  /**
   * Chunk array into batches
   */
  private chunk<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  /**
   * Close database connection
   */
  async close(): Promise<void> {
    await this.prisma.$disconnect();
  }
}

/**
 * Create a database loader instance
 */
export function createDatabaseLoader(
  prisma?: PrismaClient,
  metrics?: CloudWatchMetrics,
  config?: Partial<LoaderConfig>
): DatabaseLoader {
  return new DatabaseLoader(prisma, metrics, config);
}
