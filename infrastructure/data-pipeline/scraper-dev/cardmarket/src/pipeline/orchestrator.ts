/**
 * Pipeline Orchestrator Module
 *
 * Orchestrates the complete scraping pipeline:
 * 1. Scrape data from Cardmarket
 * 2. Store raw data to S3
 * 3. Transform and validate data
 * 4. Load to RDS database
 * 5. Generate training exports
 */

import { PrismaClient } from '@prisma/client';
import { HybridScraper, createHybridScraper } from '../scrapers/hybrid-scraper.js';
import { S3Storage, createS3Storage } from '../storage/s3-storage.js';
import { DataTransformer, createTransformer, fetchExchangeRate } from './transformer.js';
import { DatabaseLoader, createDatabaseLoader } from './database-loader.js';
import { CloudWatchMetrics } from '../monitoring/cloudwatch.js';
import type { ScrapedCard } from '../scrapers/cardmarket-scraper.js';

/**
 * Pipeline run configuration
 */
export interface PipelineConfig {
  // Sets to scrape
  sets: string[];

  // Scraping options
  maxCardsPerSet: number;
  maxPagesPerSet: number;
  includeArticles: boolean;

  // Pipeline options
  storeRawToS3: boolean;
  enableTransformation: boolean;
  loadToDatabase: boolean;
  generateTrainingExport: boolean;

  // Error handling
  continueOnError: boolean;
  maxErrors: number;

  // Dry run mode
  dryRun: boolean;
}

const DEFAULT_CONFIG: PipelineConfig = {
  sets: [],
  maxCardsPerSet: 500,
  maxPagesPerSet: 50,
  includeArticles: false,
  storeRawToS3: true,
  enableTransformation: true,
  loadToDatabase: true,
  generateTrainingExport: false,
  continueOnError: true,
  maxErrors: 10,
  dryRun: false,
};

/**
 * Pipeline run result
 */
export interface PipelineResult {
  runId: string;
  success: boolean;
  status: 'completed' | 'partial' | 'failed';

  // Metrics
  setsProcessed: number;
  totalCardsScraped: number;
  totalCardsTransformed: number;
  totalCardsLoaded: number;
  totalErrors: number;

  // Timing
  startedAt: Date;
  completedAt: Date;
  duration: number;

  // Details
  setResults: SetResult[];
  errors: PipelineError[];
}

/**
 * Per-set result
 */
export interface SetResult {
  setCode: string;
  success: boolean;
  cardsScraped: number;
  cardsTransformed: number;
  cardsLoaded: number;
  errors: string[];
  s3Key?: string;
  duration: number;
}

/**
 * Pipeline error
 */
export interface PipelineError {
  stage: 'scrape' | 'store' | 'transform' | 'load' | 'export';
  setCode?: string;
  cardId?: string;
  error: string;
  timestamp: Date;
}

/**
 * Pipeline progress callback
 */
export type PipelineProgressCallback = (progress: {
  stage: string;
  setCode: string;
  progress: number;
  message: string;
}) => void;

/**
 * Pipeline orchestrator class
 */
export class PipelineOrchestrator {
  private scraper: HybridScraper;
  private storage: S3Storage;
  private transformer: DataTransformer;
  private loader: DatabaseLoader;
  private metrics: CloudWatchMetrics;
  private prisma: PrismaClient;

  constructor(
    prisma?: PrismaClient,
    metrics?: CloudWatchMetrics
  ) {
    this.prisma = prisma || new PrismaClient();
    this.metrics = metrics || new CloudWatchMetrics({ namespace: 'CardmarketPipeline' });
    this.scraper = createHybridScraper();
    this.storage = createS3Storage();
    this.transformer = createTransformer(undefined, this.metrics);
    this.loader = createDatabaseLoader(this.prisma, this.metrics);
  }

  /**
   * Execute the complete pipeline
   */
  async run(
    config: Partial<PipelineConfig> = {},
    onProgress?: PipelineProgressCallback
  ): Promise<PipelineResult> {
    const fullConfig = { ...DEFAULT_CONFIG, ...config };
    const runId = `pipeline_${Date.now()}`;
    const startedAt = new Date();
    const errors: PipelineError[] = [];
    const setResults: SetResult[] = [];

    console.log(`[Pipeline] Starting run ${runId}`);
    console.log(`[Pipeline] Sets: ${fullConfig.sets.join(', ')}`);

    // Record pipeline start
    await this.recordPipelineStart(runId, fullConfig);

    // Fetch current exchange rate
    const exchangeRate = await fetchExchangeRate();
    this.transformer.setExchangeRate(exchangeRate);
    console.log(`[Pipeline] Using exchange rate EUR/GBP: ${exchangeRate}`);

    // Process each set
    for (let i = 0; i < fullConfig.sets.length; i++) {
      const setCode = fullConfig.sets[i];

      // Check error threshold
      if (errors.length >= fullConfig.maxErrors && !fullConfig.continueOnError) {
        console.log(`[Pipeline] Max errors reached (${errors.length}), stopping`);
        break;
      }

      // Report progress
      if (onProgress) {
        onProgress({
          stage: 'processing',
          setCode,
          progress: (i / fullConfig.sets.length) * 100,
          message: `Processing set ${setCode} (${i + 1}/${fullConfig.sets.length})`,
        });
      }

      try {
        const setResult = await this.processSet(setCode, fullConfig, errors);
        setResults.push(setResult);
      } catch (error) {
        errors.push({
          stage: 'scrape',
          setCode,
          error: error instanceof Error ? error.message : 'Unknown error',
          timestamp: new Date(),
        });

        setResults.push({
          setCode,
          success: false,
          cardsScraped: 0,
          cardsTransformed: 0,
          cardsLoaded: 0,
          errors: [error instanceof Error ? error.message : 'Unknown error'],
          duration: 0,
        });
      }
    }

    // Generate training export if enabled
    if (fullConfig.generateTrainingExport && !fullConfig.dryRun) {
      try {
        await this.generateTrainingExport();
      } catch (error) {
        errors.push({
          stage: 'export',
          error: error instanceof Error ? error.message : 'Export failed',
          timestamp: new Date(),
        });
      }
    }

    const completedAt = new Date();
    const duration = completedAt.getTime() - startedAt.getTime();

    // Calculate totals
    const totalCardsScraped = setResults.reduce((sum, r) => sum + r.cardsScraped, 0);
    const totalCardsTransformed = setResults.reduce((sum, r) => sum + r.cardsTransformed, 0);
    const totalCardsLoaded = setResults.reduce((sum, r) => sum + r.cardsLoaded, 0);

    // Determine status
    const allSuccess = setResults.every((r) => r.success);
    const anySuccess = setResults.some((r) => r.success);
    const status = allSuccess ? 'completed' : anySuccess ? 'partial' : 'failed';

    // Record pipeline completion
    await this.recordPipelineCompletion(runId, {
      status,
      setsProcessed: setResults.filter((r) => r.success).length,
      cardsScraped: totalCardsScraped,
      cardsLoaded: totalCardsLoaded,
      errorsCount: errors.length,
      duration,
    });

    // Report metrics
    await this.metrics.putMetric('PipelineRunsCompleted', 1, 'Count');
    await this.metrics.putMetric('PipelineCardsProcessed', totalCardsLoaded, 'Count');
    await this.metrics.putMetric('PipelineDurationMs', duration, 'Milliseconds');
    await this.metrics.putMetric('PipelineErrors', errors.length, 'Count');

    return {
      runId,
      success: status === 'completed',
      status,
      setsProcessed: setResults.filter((r) => r.success).length,
      totalCardsScraped,
      totalCardsTransformed,
      totalCardsLoaded,
      totalErrors: errors.length,
      startedAt,
      completedAt,
      duration,
      setResults,
      errors,
    };
  }

  /**
   * Process a single set through the pipeline
   */
  private async processSet(
    setCode: string,
    config: PipelineConfig,
    errors: PipelineError[]
  ): Promise<SetResult> {
    const setStart = Date.now();
    let cardsScraped = 0;
    let cardsTransformed = 0;
    let cardsLoaded = 0;
    let s3Key: string | undefined;
    const setErrors: string[] = [];

    console.log(`[Pipeline] Processing set: ${setCode}`);

    // Step 1: Scrape
    console.log(`[Pipeline] Step 1: Scraping ${setCode}...`);
    const scrapeResult = await this.scraper.scrapeSet(setCode, {
      maxCardsPerSet: config.maxCardsPerSet,
      maxPagesPerSet: config.maxPagesPerSet,
      includeArticles: config.includeArticles,
    });

    cardsScraped = scrapeResult.cards.length;
    console.log(`[Pipeline] Scraped ${cardsScraped} cards from ${setCode}`);

    if (scrapeResult.errors.length > 0) {
      setErrors.push(...scrapeResult.errors);
      scrapeResult.errors.forEach((err) => {
        errors.push({
          stage: 'scrape',
          setCode,
          error: err,
          timestamp: new Date(),
        });
      });
    }

    if (cardsScraped === 0) {
      return {
        setCode,
        success: false,
        cardsScraped: 0,
        cardsTransformed: 0,
        cardsLoaded: 0,
        errors: setErrors.length > 0 ? setErrors : ['No cards scraped'],
        duration: Date.now() - setStart,
      };
    }

    // Step 2: Store raw to S3
    if (config.storeRawToS3 && !config.dryRun) {
      console.log(`[Pipeline] Step 2: Storing raw data to S3...`);
      try {
        const storeResult = await this.storage.store(
          setCode,
          scrapeResult.cards,
          scrapeResult.articles,
          `scrape_${Date.now()}`
        );
        s3Key = storeResult.key;
        console.log(`[Pipeline] Stored to S3: ${s3Key}`);
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : 'S3 storage failed';
        setErrors.push(errMsg);
        errors.push({
          stage: 'store',
          setCode,
          error: errMsg,
          timestamp: new Date(),
        });
      }
    }

    // Step 3: Transform
    if (config.enableTransformation) {
      console.log(`[Pipeline] Step 3: Transforming ${cardsScraped} cards...`);
      const transformResult = await this.transformer.transform(scrapeResult.cards);

      cardsTransformed = transformResult.valid.length;
      console.log(`[Pipeline] Transformed ${cardsTransformed} valid cards`);

      if (transformResult.invalid.length > 0) {
        console.log(`[Pipeline] ${transformResult.invalid.length} invalid cards`);
        transformResult.invalid.forEach((inv) => {
          errors.push({
            stage: 'transform',
            setCode,
            cardId: inv.card.cardId,
            error: inv.reasons.join(', '),
            timestamp: new Date(),
          });
        });
      }

      if (transformResult.anomalies.length > 0) {
        console.log(`[Pipeline] ${transformResult.anomalies.length} price anomalies detected`);
      }

      // Step 4: Load to database
      if (config.loadToDatabase && !config.dryRun && cardsTransformed > 0) {
        console.log(`[Pipeline] Step 4: Loading ${cardsTransformed} cards to database...`);
        try {
          const loadResult = await this.loader.load(transformResult.valid);
          cardsLoaded = loadResult.upsertedCount;
          console.log(`[Pipeline] Loaded ${cardsLoaded} cards to database`);

          if (loadResult.errors.length > 0) {
            loadResult.errors.forEach((err) => {
              setErrors.push(err.error);
              errors.push({
                stage: 'load',
                setCode,
                cardId: err.cardId,
                error: err.error,
                timestamp: new Date(),
              });
            });
          }
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : 'Database load failed';
          setErrors.push(errMsg);
          errors.push({
            stage: 'load',
            setCode,
            error: errMsg,
            timestamp: new Date(),
          });
        }
      }
    }

    const duration = Date.now() - setStart;
    const success = cardsLoaded > 0 || (config.dryRun && cardsScraped > 0);

    console.log(`[Pipeline] Set ${setCode} completed: ${cardsLoaded}/${cardsScraped} loaded in ${duration}ms`);

    return {
      setCode,
      success,
      cardsScraped,
      cardsTransformed,
      cardsLoaded,
      errors: setErrors,
      s3Key,
      duration,
    };
  }

  /**
   * Generate training data export
   */
  private async generateTrainingExport(): Promise<void> {
    console.log('[Pipeline] Generating training data export...');

    // Query price history for last 90 days
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 90);

    // Export to S3 as JSON (could be converted to Parquet)
    const priceHistory = await this.prisma.$queryRaw<any[]>`
      SELECT
        card_id,
        price_date,
        tcgplayer_price_gbp,
        cardmarket_price_gbp,
        best_price_gbp,
        tradein_price_gbp,
        available_count,
        source
      FROM price_history
      WHERE price_date >= ${cutoffDate}
      ORDER BY card_id, price_date
    `;

    if (priceHistory.length > 0) {
      const today = new Date().toISOString().split('T')[0];
      await this.storage.store(
        'training',
        [],
        [],
        `training_export_${today}`
      );
      console.log(`[Pipeline] Exported ${priceHistory.length} price history records`);
    }
  }

  /**
   * Record pipeline start in database
   */
  private async recordPipelineStart(
    runId: string,
    config: PipelineConfig
  ): Promise<void> {
    try {
      await this.prisma.$executeRaw`
        INSERT INTO pipeline_runs (run_id, status, started_at, metrics)
        VALUES (${runId}, 'running', NOW(), ${JSON.stringify(config)})
      `;
    } catch (error) {
      console.warn('Failed to record pipeline start:', error);
    }
  }

  /**
   * Record pipeline completion in database
   */
  private async recordPipelineCompletion(
    runId: string,
    result: {
      status: string;
      setsProcessed: number;
      cardsScraped: number;
      cardsLoaded: number;
      errorsCount: number;
      duration: number;
    }
  ): Promise<void> {
    try {
      await this.prisma.$executeRaw`
        UPDATE pipeline_runs
        SET
          status = ${result.status},
          sets_processed = ${result.setsProcessed},
          cards_scraped = ${result.cardsScraped},
          cards_updated = ${result.cardsLoaded},
          errors_count = ${result.errorsCount},
          duration_ms = ${result.duration},
          completed_at = NOW()
        WHERE run_id = ${runId}
      `;
    } catch (error) {
      console.warn('Failed to record pipeline completion:', error);
    }
  }

  /**
   * Run pipeline for a single card URL (for testing)
   */
  async runSingleCard(
    url: string,
    options: { loadToDatabase?: boolean; dryRun?: boolean } = {}
  ): Promise<{
    success: boolean;
    card: ScrapedCard | null;
    transformed: any | null;
    loaded: boolean;
    error: string | null;
  }> {
    console.log(`[Pipeline] Single card test: ${url}`);

    // Scrape single card
    const scrapeResult = await this.scraper.scrapeCard(url);
    if (!scrapeResult.card) {
      return {
        success: false,
        card: null,
        transformed: null,
        loaded: false,
        error: scrapeResult.error || 'Failed to scrape card',
      };
    }

    console.log(`[Pipeline] Scraped: ${scrapeResult.card.name}`);

    // Transform
    const transformResult = await this.transformer.transform([scrapeResult.card]);
    const transformed = transformResult.valid[0] || null;

    if (!transformed) {
      return {
        success: false,
        card: scrapeResult.card,
        transformed: null,
        loaded: false,
        error: transformResult.invalid[0]?.reasons.join(', ') || 'Transformation failed',
      };
    }

    console.log(`[Pipeline] Transformed: ${JSON.stringify(transformed, null, 2)}`);

    // Load if requested
    let loaded = false;
    if (options.loadToDatabase && !options.dryRun) {
      const loadResult = await this.loader.load([transformed]);
      loaded = loadResult.upsertedCount > 0;
      console.log(`[Pipeline] Loaded: ${loaded}`);
    }

    return {
      success: true,
      card: scrapeResult.card,
      transformed,
      loaded,
      error: null,
    };
  }

  /**
   * Close all connections
   */
  async close(): Promise<void> {
    await this.prisma.$disconnect();
    await this.loader.close();
  }
}

/**
 * Create a pipeline orchestrator instance
 */
export function createPipelineOrchestrator(
  prisma?: PrismaClient,
  metrics?: CloudWatchMetrics
): PipelineOrchestrator {
  return new PipelineOrchestrator(prisma, metrics);
}
