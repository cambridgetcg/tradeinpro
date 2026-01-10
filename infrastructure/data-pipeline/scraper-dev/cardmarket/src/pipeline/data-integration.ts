/**
 * CardMarket Data Integration Module
 *
 * Integrates scraped CardMarket prices with the TCG data pipeline:
 * - Writes to RDS (MarketPriceEU, CardPriceV2, PriceHistoryDaily)
 * - Uploads raw data to S3 for archival and training
 * - Formats data for ML training pipelines
 *
 * Data Flow:
 * ┌─────────────────┐     ┌────────────────┐     ┌──────────────────┐
 * │ Targeted Scraper│────▶│ DataIntegration│────▶│ RDS (PostgreSQL) │
 * │  (Playwright)   │     │                │     │  - MarketPriceEU │
 * └─────────────────┘     │                │     │  - CardPriceV2   │
 *                         │                │     │  - PriceHistory  │
 *                         │                │     └──────────────────┘
 *                         │                │
 *                         │                │     ┌──────────────────┐
 *                         │                │────▶│ S3 Data Lake     │
 *                         │                │     │  - raw/prices/   │
 *                         │                │     │  - training/     │
 *                         └────────────────┘     └──────────────────┘
 */

import { PrismaClient, Prisma } from '@prisma/client';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { ScrapedPrice, ScrapeReport } from '../services/targeted-scraper';

// =============================================================================
// CONFIGURATION
// =============================================================================

interface IntegrationConfig {
  // Database
  databaseUrl: string;

  // S3
  s3Bucket: string;
  s3Region: string;
  s3Prefix: string;

  // Feature flags
  enableRds: boolean;
  enableS3: boolean;
  enableTrainingExport: boolean;

  // FX rates (fallback if not fetched from DB)
  defaultEurGbpRate: number;
}

const DEFAULT_CONFIG: IntegrationConfig = {
  databaseUrl: process.env.DATABASE_URL || '',
  s3Bucket: process.env.S3_DATA_BUCKET || 'tcg-dev-data-lake',
  s3Region: process.env.AWS_REGION || 'us-east-1',
  s3Prefix: 'raw/prices/source=cardmarket_scraper',
  enableRds: true,
  enableS3: true,
  enableTrainingExport: true,
  defaultEurGbpRate: 0.85, // Approximate EUR to GBP
};

// =============================================================================
// TYPES
// =============================================================================

/** Format for RDS MarketPriceEU table */
interface MarketPriceEURecord {
  cardId: string;
  source: 'cardmarket_scraper';
  trendPrice: Prisma.Decimal | null;
  avgPrice: Prisma.Decimal | null;
  lowPrice: Prisma.Decimal | null;
  avg1d: Prisma.Decimal | null;
  avg7d: Prisma.Decimal | null;
  avg30d: Prisma.Decimal | null;
  availableItems: number | null;
  availableFoils: number | null;
  collectedAt: Date;
  sourceUpdatedAt: Date | null;
}

/** Format for updating CardPriceV2 */
interface CardPriceV2Update {
  cardId: string;
  limitlessCardmarketEur: Prisma.Decimal | null;
  limitlessCardmarketGbp: Prisma.Decimal | null;
  limitlessUpdatedAt: Date;
}

/** Format for PriceHistoryDaily */
interface PriceHistoryDailyRecord {
  cardId: string;
  date: Date;
  euTrendEur: Prisma.Decimal | null;
  euLowEur: Prisma.Decimal | null;
  euTrendGbp: Prisma.Decimal | null;
  euLowGbp: Prisma.Decimal | null;
  euListingsCount: number | null;
  fxEurGbp: Prisma.Decimal;
}

/** S3 raw data format */
interface S3RawRecord {
  event_type: 'price';
  source: 'cardmarket_scraper';
  card_id: string;
  variant: string;
  name: string;
  language: string;

  // Prices in EUR
  trend_price_eur: number | null;
  from_price_eur: number | null;
  avg_7d_eur: number | null;
  avg_30d_eur: number | null;
  avg_1d_eur: number | null;

  // Converted to GBP
  trend_price_gbp: number | null;
  from_price_gbp: number | null;

  // Inventory signals
  available_count: number | null;
  english_available: number | null;
  japanese_available: number | null;
  has_multiple_languages: boolean;

  // Metadata
  scraped_at: string;
  url: string;
  fx_eur_gbp: number;
}

/** Training data format (45 features + labels) */
export interface TrainingDataPoint {
  // Card identification
  card_id: string;
  timestamp: string;

  // Price features (from CardMarket)
  price_eur: number;
  price_gbp: number;
  from_price_eur: number;
  trend_price_eur: number;
  avg_7d_eur: number;
  avg_30d_eur: number;

  // Spread features (calculated)
  spread_trend_vs_from: number; // (trend - from) / from
  spread_7d_vs_trend: number;   // (7d - trend) / trend
  spread_30d_vs_7d: number;     // (30d - 7d) / 7d

  // Inventory features
  available_count: number;
  relative_volume: number; // vs average for this rarity

  // FX features
  fx_eur_gbp: number;

  // Temporal features (to be filled by feature engineering)
  velocity_1d: number | null;
  velocity_7d: number | null;
  velocity_30d: number | null;

  // Labels (for training)
  deal_type: string | null;
  confidence: number | null;
  expected_return: number | null;
}

// =============================================================================
// DATA INTEGRATION CLASS
// =============================================================================

export class DataIntegration {
  private config: IntegrationConfig;
  private prisma: PrismaClient | null = null;
  private s3: S3Client | null = null;
  private eurGbpRate: number;

  constructor(config: Partial<IntegrationConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.eurGbpRate = this.config.defaultEurGbpRate;
  }

  /**
   * Initialize connections
   */
  async initialize(): Promise<void> {
    // Initialize Prisma
    if (this.config.enableRds && this.config.databaseUrl) {
      this.prisma = new PrismaClient({
        datasources: {
          db: { url: this.config.databaseUrl }
        }
      });
      await this.prisma.$connect();
      console.log('📊 Connected to RDS');

      // Fetch latest FX rate
      await this.updateFxRate();
    }

    // Initialize S3
    if (this.config.enableS3) {
      this.s3 = new S3Client({ region: this.config.s3Region });
      console.log(`📦 S3 client initialized (bucket: ${this.config.s3Bucket})`);
    }
  }

  /**
   * Fetch latest EUR/GBP rate from database
   */
  private async updateFxRate(): Promise<void> {
    if (!this.prisma) return;

    try {
      // FXRate model uses baseCurrency and targetCurrency
      const fxRate = await this.prisma.fXRate.findFirst({
        where: {
          baseCurrency: 'GBP',
          targetCurrency: 'EUR'
        },
        orderBy: { collectedAt: 'desc' }
      });

      if (fxRate) {
        // Rate is stored as EUR per GBP, we need GBP per EUR
        this.eurGbpRate = 1 / fxRate.rate.toNumber();
        console.log(`💱 FX rate EUR/GBP: ${this.eurGbpRate.toFixed(4)}`);
      }
    } catch (error) {
      console.warn('Could not fetch FX rate, using default:', this.config.defaultEurGbpRate);
    }
  }

  /**
   * Convert EUR to GBP
   */
  private eurToGbp(eurAmount: number | null): number | null {
    if (eurAmount === null) return null;
    return Math.round(eurAmount * this.eurGbpRate * 100) / 100;
  }

  /**
   * Map variant string to database format
   */
  private mapVariant(variant: string): string {
    const variantMap: Record<string, string> = {
      'V.2': 'parallel',
      'V.3': 'parallel',
      'SP': 'sp',
      'Manga': 'manga',
    };
    return variantMap[variant] || 'parallel';
  }

  /**
   * Build card ID in the format expected by CardPriceV2
   * Format: {RELEASE_SET}-{FULL_CARD_NUMBER}[-{variant}]
   */
  private buildCardId(cardNumber: string, variant: string): string {
    const setCode = cardNumber.split('-')[0];
    const variantType = this.mapVariant(variant);
    return `${setCode}-${cardNumber}-${variantType}`;
  }

  /**
   * Process scrape report and write to all destinations
   */
  async processScrapeReport(report: ScrapeReport): Promise<IntegrationResult> {
    const result: IntegrationResult = {
      rdsRecords: 0,
      s3Records: 0,
      trainingRecords: 0,
      errors: [],
    };

    console.log(`\n🔄 Processing ${report.results.length} scraped prices...`);

    // 1. Write to RDS
    if (this.config.enableRds && this.prisma && report.results.length > 0) {
      try {
        const rdsResult = await this.writeToRds(report.results);
        result.rdsRecords = rdsResult.written;
        console.log(`✅ RDS: ${result.rdsRecords} records written`);
      } catch (error) {
        const message = `RDS write failed: ${error}`;
        result.errors.push(message);
        console.error(`❌ ${message}`);
      }
    }

    // 2. Write to S3
    if (this.config.enableS3 && this.s3 && report.results.length > 0) {
      try {
        const s3Result = await this.writeToS3(report);
        result.s3Records = s3Result.records;
        console.log(`✅ S3: ${result.s3Records} records uploaded to ${s3Result.key}`);
      } catch (error) {
        const message = `S3 write failed: ${error}`;
        result.errors.push(message);
        console.error(`❌ ${message}`);
      }
    }

    // 3. Export training data
    if (this.config.enableTrainingExport && this.s3 && report.results.length > 0) {
      try {
        const trainingResult = await this.exportTrainingData(report.results);
        result.trainingRecords = trainingResult.records;
        console.log(`✅ Training: ${result.trainingRecords} data points exported`);
      } catch (error) {
        const message = `Training export failed: ${error}`;
        result.errors.push(message);
        console.error(`❌ ${message}`);
      }
    }

    return result;
  }

  /**
   * Write scraped prices to RDS (MarketPriceEU, CardPriceV2, PriceHistoryDaily)
   */
  private async writeToRds(prices: ScrapedPrice[]): Promise<{ written: number }> {
    if (!this.prisma) throw new Error('Prisma not initialized');

    let written = 0;
    const now = new Date();
    const today = new Date(now.toISOString().split('T')[0]);

    for (const price of prices) {
      const cardId = this.buildCardId(price.cardNumber, price.variant);

      try {
        // 1. Insert into MarketPriceEU (historical record)
        await this.prisma.marketPriceEU.create({
          data: {
            cardId,
            source: 'cardmarket_scraper',
            trendPrice: price.trendPrice ? new Prisma.Decimal(price.trendPrice) : null,
            avgPrice: price.avg7Price ? new Prisma.Decimal(price.avg7Price) : null,
            lowPrice: price.fromPrice ? new Prisma.Decimal(price.fromPrice) : null,
            avg1d: price.avg1Price ? new Prisma.Decimal(price.avg1Price) : null,
            avg7d: price.avg7Price ? new Prisma.Decimal(price.avg7Price) : null,
            avg30d: price.avg30Price ? new Prisma.Decimal(price.avg30Price) : null,
            availableItems: price.available,
            availableFoils: null, // Not tracked in our scraper
            collectedAt: now,
            sourceUpdatedAt: price.scrapedAt,
          }
        });

        // 2. Update CardPriceV2 (latest price)
        const gbpPrice = this.eurToGbp(price.trendPrice);
        await this.prisma.cardPriceV2.upsert({
          where: { cardId },
          update: {
            limitlessCardmarketEur: price.trendPrice ? new Prisma.Decimal(price.trendPrice) : null,
            limitlessCardmarketGbp: gbpPrice ? new Prisma.Decimal(gbpPrice) : null,
            limitlessUpdatedAt: now,
          },
          create: {
            cardId,
            game: 'onepiece',
            name: price.name,
            releaseSet: price.cardNumber.split('-')[0],
            fullCardNumber: price.cardNumber,
            setCode: price.cardNumber.split('-')[0],
            cardNumber: price.cardNumber.split('-')[1],
            variantType: this.mapVariant(price.variant),
            language: 'EN',
            limitlessCardmarketEur: price.trendPrice ? new Prisma.Decimal(price.trendPrice) : null,
            limitlessCardmarketGbp: gbpPrice ? new Prisma.Decimal(gbpPrice) : null,
            limitlessUpdatedAt: now,
          }
        });

        // 3. Upsert PriceHistoryDaily (daily aggregate)
        await this.prisma.priceHistoryDaily.upsert({
          where: {
            cardId_date: { cardId, date: today }
          },
          update: {
            euTrendEur: price.trendPrice ? new Prisma.Decimal(price.trendPrice) : null,
            euLowEur: price.fromPrice ? new Prisma.Decimal(price.fromPrice) : null,
            euTrendGbp: gbpPrice ? new Prisma.Decimal(gbpPrice) : null,
            euLowGbp: this.eurToGbp(price.fromPrice) ? new Prisma.Decimal(this.eurToGbp(price.fromPrice)!) : null,
            euListingsCount: price.available,
            fxEurGbp: new Prisma.Decimal(this.eurGbpRate),
          },
          create: {
            cardId,
            date: today,
            euTrendEur: price.trendPrice ? new Prisma.Decimal(price.trendPrice) : null,
            euLowEur: price.fromPrice ? new Prisma.Decimal(price.fromPrice) : null,
            euTrendGbp: gbpPrice ? new Prisma.Decimal(gbpPrice) : null,
            euLowGbp: this.eurToGbp(price.fromPrice) ? new Prisma.Decimal(this.eurToGbp(price.fromPrice)!) : null,
            euListingsCount: price.available,
            fxEurGbp: new Prisma.Decimal(this.eurGbpRate),
          }
        });

        written++;
      } catch (error) {
        console.warn(`Failed to write ${cardId}:`, error);
      }
    }

    return { written };
  }

  /**
   * Write raw scrape data to S3
   */
  private async writeToS3(report: ScrapeReport): Promise<{ records: number; key: string }> {
    if (!this.s3) throw new Error('S3 not initialized');

    const now = new Date();
    const dateKey = now.toISOString().split('T')[0]; // YYYY-MM-DD
    const hourKey = now.toISOString().split('T')[1].split(':')[0]; // HH

    // Format data as newline-delimited JSON (NDJSON)
    const records: S3RawRecord[] = report.results.map(price => ({
      event_type: 'price',
      source: 'cardmarket_scraper',
      card_id: this.buildCardId(price.cardNumber, price.variant),
      variant: price.variant,
      name: price.name,
      language: price.language,

      trend_price_eur: price.trendPrice,
      from_price_eur: price.fromPrice,
      avg_7d_eur: price.avg7Price,
      avg_30d_eur: price.avg30Price,
      avg_1d_eur: price.avg1Price,

      trend_price_gbp: this.eurToGbp(price.trendPrice),
      from_price_gbp: this.eurToGbp(price.fromPrice),

      available_count: price.available,
      english_available: price.englishAvailable,
      japanese_available: price.japaneseAvailable,
      has_multiple_languages: price.hasMultipleLanguages,

      scraped_at: price.scrapedAt.toISOString(),
      url: price.url,
      fx_eur_gbp: this.eurGbpRate,
    }));

    const ndjson = records.map(r => JSON.stringify(r)).join('\n');
    const key = `${this.config.s3Prefix}/year=${now.getFullYear()}/month=${String(now.getMonth() + 1).padStart(2, '0')}/day=${dateKey.split('-')[2]}/hour=${hourKey}/scrape-${now.getTime()}.ndjson`;

    await this.s3.send(new PutObjectCommand({
      Bucket: this.config.s3Bucket,
      Key: key,
      Body: ndjson,
      ContentType: 'application/x-ndjson',
      Metadata: {
        'scrape-started': report.startedAt.toISOString(),
        'scrape-completed': report.completedAt?.toISOString() || '',
        'cards-scraped': String(report.cardsScraped),
        'fx-rate': String(this.eurGbpRate),
      }
    }));

    return { records: records.length, key };
  }

  /**
   * Export training-ready data points
   */
  private async exportTrainingData(prices: ScrapedPrice[]): Promise<{ records: number }> {
    if (!this.s3) throw new Error('S3 not initialized');

    const now = new Date();
    const trainingPoints: TrainingDataPoint[] = [];

    for (const price of prices) {
      if (!price.trendPrice) continue;

      const cardId = this.buildCardId(price.cardNumber, price.variant);

      // Calculate spread features
      const spreadTrendVsFrom = price.fromPrice && price.trendPrice
        ? (price.trendPrice - price.fromPrice) / price.fromPrice
        : 0;

      const spread7dVsTrend = price.avg7Price && price.trendPrice
        ? (price.avg7Price - price.trendPrice) / price.trendPrice
        : 0;

      const spread30dVs7d = price.avg30Price && price.avg7Price
        ? (price.avg30Price - price.avg7Price) / price.avg7Price
        : 0;

      trainingPoints.push({
        card_id: cardId,
        timestamp: now.toISOString(),

        price_eur: price.trendPrice,
        price_gbp: this.eurToGbp(price.trendPrice) || 0,
        from_price_eur: price.fromPrice || 0,
        trend_price_eur: price.trendPrice,
        avg_7d_eur: price.avg7Price || 0,
        avg_30d_eur: price.avg30Price || 0,

        spread_trend_vs_from: spreadTrendVsFrom,
        spread_7d_vs_trend: spread7dVsTrend,
        spread_30d_vs_7d: spread30dVs7d,

        available_count: price.available || 0,
        relative_volume: 1.0, // To be calculated by feature engineering

        fx_eur_gbp: this.eurGbpRate,

        // Temporal features - null until history is available
        velocity_1d: null,
        velocity_7d: null,
        velocity_30d: null,

        // Labels - null until model inference or manual labeling
        deal_type: null,
        confidence: null,
        expected_return: null,
      });
    }

    // Upload to training folder
    const dateKey = now.toISOString().split('T')[0];
    const key = `training/cardmarket/${dateKey}/features-${now.getTime()}.json`;

    await this.s3.send(new PutObjectCommand({
      Bucket: this.config.s3Bucket,
      Key: key,
      Body: JSON.stringify(trainingPoints, null, 2),
      ContentType: 'application/json',
      Metadata: {
        'feature-count': String(trainingPoints.length),
        'collection-date': dateKey,
      }
    }));

    return { records: trainingPoints.length };
  }

  /**
   * Cleanup connections
   */
  async close(): Promise<void> {
    if (this.prisma) {
      await this.prisma.$disconnect();
    }
  }
}

// =============================================================================
// TYPES
// =============================================================================

interface IntegrationResult {
  rdsRecords: number;
  s3Records: number;
  trainingRecords: number;
  errors: string[];
}

// =============================================================================
// CLI ENTRY POINT
// =============================================================================

export async function runIntegration(report: ScrapeReport): Promise<IntegrationResult> {
  const integration = new DataIntegration();

  try {
    await integration.initialize();
    const result = await integration.processScrapeReport(report);
    return result;
  } finally {
    await integration.close();
  }
}
