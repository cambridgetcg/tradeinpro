#!/usr/bin/env npx tsx
/**
 * CardMarket Live Collection Script
 *
 * Orchestrates CardMarket price collection with:
 * 1. CardMarket scraping via integrated orchestrator
 * 2. RDS storage for current prices (card_prices_v2) and history (price_history)
 * 3. S3 export for ML training data pipeline
 *
 * Usage:
 *   npx tsx scripts/collect-cardmarket-live.ts [options]
 *
 * Options:
 *   --dry-run        Simulate without actual scraping/storage
 *   --tier           Target tier: legendary, epic, rare, all (default: all)
 *   --set            Target specific set (e.g., OP01, OP06)
 *   --export-s3      Export raw data to S3 after collection
 *   --skip-rds       Skip database storage (dry run for scraping only)
 *   --proxy          Use proxy (requires PROXY_URL env var)
 *   --verbose        Enable verbose logging
 *
 * Environment Variables:
 *   DATABASE_URL     PostgreSQL connection string
 *   DATA_LAKE_BUCKET S3 bucket for training data (default: tcg-data-lake)
 *   AWS_REGION       AWS region (default: us-east-1)
 *   PROXY_URL        Proxy URL for Cloudflare bypass
 *   EUR_GBP_RATE     EUR to GBP exchange rate (default: 0.85)
 *
 * @see docs/CARDMARKET_SCRAPER_INFRASTRUCTURE.md
 */

import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { PrismaClient } from '@prisma/client';

// Load environment variables
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: join(__dirname, '..', '.env') });

// Import modules - using direct imports to avoid index.ts resolution issues
import {
  createCardMarketOrchestrator,
  type OrchestratorConfig as CardMarketOrchestratorConfig,
  type ScrapeResult as ScrapeJobResult,
  type CardMarketPriceData,
} from '../src/neural/sensory/cardmarket/scrape-orchestrator.js';
import { cardMarketTargetRegistry } from '../src/neural/sensory/cardmarket/target-cards.js';

// LoadResult interface (inline to avoid import issues)
interface LoadResult {
  success: boolean;
  upsertedCount: number;
  historyInsertedCount: number;
  errors: { cardId: string; error: string; type: string }[];
  duration: number;
}

// S3 uploader interface (inline to avoid import issues)
interface NormalizedPriceSignal {
  cardId: string;
  name: string;
  priceFromUsd: number;
  priceTrendUsd: number;
  priceAvgUsd: number;
  bestPriceUsd: number;
  tradeinPriceUsd: number;
  source: {
    marketplace: string;
    currency: string;
    priceFrom: number;
    priceTrend: number;
    priceAvg: number;
  };
  spreadPercent: number;
  spreadAbsolute: number;
  fxRate: number;
  fxSource: string;
  timestamp: Date;
}

// =============================================================================
// CONFIGURATION
// =============================================================================

interface CollectionConfig {
  dryRun: boolean;
  tier: 'legendary' | 'epic' | 'rare' | 'all';
  setCode?: string;
  exportS3: boolean;
  skipRds: boolean;
  useProxy: boolean;
  verbose: boolean;
  eurGbpRate: number;
}

function parseArgs(): CollectionConfig {
  const args = process.argv.slice(2);

  return {
    dryRun: args.includes('--dry-run'),
    tier: (args.find(a => a.startsWith('--tier='))?.split('=')[1] as CollectionConfig['tier']) || 'all',
    setCode: args.find(a => a.startsWith('--set='))?.split('=')[1],
    exportS3: args.includes('--export-s3'),
    skipRds: args.includes('--skip-rds'),
    useProxy: args.includes('--proxy'),
    verbose: args.includes('--verbose'),
    eurGbpRate: parseFloat(process.env.EUR_GBP_RATE || '0.85'),
  };
}

// =============================================================================
// MAIN COLLECTION LOGIC
// =============================================================================

async function runCollection(config: CollectionConfig): Promise<void> {
  console.log('\n' + '='.repeat(70));
  console.log('  CARDMARKET LIVE COLLECTION');
  console.log('  One Piece TCG Price Data Pipeline');
  console.log('='.repeat(70));
  console.log(`Started: ${new Date().toISOString()}`);
  console.log(`Mode: ${config.dryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log(`Tier: ${config.tier}`);
  if (config.setCode) console.log(`Set: ${config.setCode}`);
  console.log(`Export to S3: ${config.exportS3}`);
  console.log(`Skip RDS: ${config.skipRds}`);
  console.log(`Use Proxy: ${config.useProxy}`);
  console.log('='.repeat(70) + '\n');

  // Track results
  const collectedData: CardMarketPriceData[] = [];
  const errors: string[] = [];
  const startTime = Date.now();

  // ==========================================================================
  // 1. INITIALIZE SCRAPER ORCHESTRATOR
  // ==========================================================================
  console.log('1. Initializing CardMarket Scraper Orchestrator...\n');

  const orchestratorConfig: Partial<CardMarketOrchestratorConfig> = {
    maxRequestsPerMinute: 20,
    delayBetweenRequests: 3000,
    delayVariance: 0.3,
    maxRetries: 3,
    dryRun: config.dryRun,
  };

  if (config.useProxy && process.env.PROXY_URL) {
    console.log(`   Using proxy: ${process.env.PROXY_URL.replace(/:[^:@]+@/, ':***@')}`);
    // Parse proxy URL
    const proxyUrl = new URL(process.env.PROXY_URL);
    orchestratorConfig.proxyConfig = {
      host: proxyUrl.hostname,
      port: parseInt(proxyUrl.port),
      username: proxyUrl.username,
      password: proxyUrl.password,
      type: 'residential',
      country: 'DE',
    };
  }

  const orchestrator = createCardMarketOrchestrator(orchestratorConfig);

  // Test connection
  try {
    await orchestrator.initialize();
    console.log('   Orchestrator initialized successfully\n');
  } catch (error) {
    console.warn(`   Warning: Connection test failed - ${error}`);
    console.log('   Proceeding anyway (may fail on actual requests)\n');
  }

  // ==========================================================================
  // 2. QUEUE TARGETS
  // ==========================================================================
  console.log('2. Queueing scrape targets...\n');

  if (config.setCode) {
    orchestrator.queueSet(config.setCode);
  } else if (config.tier === 'all') {
    // Queue all tiers in priority order
    orchestrator.queueTier('legendary');
    orchestrator.queueTier('epic');
    orchestrator.queueTier('rare');
  } else {
    orchestrator.queueTier(config.tier);
  }

  // Add critical gaps
  orchestrator.queueCriticalGaps();

  console.log(`   Queue status: ${orchestrator.getQueueStatus().pending} jobs pending\n`);

  // ==========================================================================
  // 3. RUN SCRAPING
  // ==========================================================================
  console.log('3. Starting scrape session...\n');

  // Collect results as we go
  orchestrator.onJobCompleted((result: ScrapeJobResult) => {
    if (result.success && result.data) {
      collectedData.push(result.data);
      if (config.verbose) {
        console.log(`   + ${result.data.cardId}: €${result.data.priceTrendEur.toFixed(2)}`);
      }
    } else if (!result.success) {
      errors.push(`${result.job.cardId}: ${result.error}`);
    }
  });

  // Process queue
  const session = await orchestrator.processQueue((progress) => {
    const pct = ((progress.completed + progress.failed) / progress.total * 100).toFixed(1);
    const eta = progress.remaining * 3; // ~3s per request
    process.stdout.write(
      `\r   [${pct}%] Completed: ${progress.completed} | Failed: ${progress.failed} | ` +
      `Remaining: ${progress.remaining} | ETA: ${eta}s   `
    );
  });

  console.log('\n\n   Session complete!\n');

  // ==========================================================================
  // 4. STORE IN RDS
  // ==========================================================================
  if (!config.skipRds && collectedData.length > 0) {
    console.log('4. Storing data in RDS...\n');

    if (config.dryRun) {
      console.log(`   [DRY RUN] Would store ${collectedData.length} price records\n`);
    } else {
      try {
        const prisma = new PrismaClient();
        const startTime = Date.now();
        let upsertedCount = 0;
        let historyCount = 0;
        const rdsErrors: string[] = [];

        for (const data of collectedData) {
          try {
            const trendPriceGbp = Number((data.priceTrendEur * config.eurGbpRate).toFixed(2));
            const lowPriceGbp = Number((data.priceFromEur * config.eurGbpRate).toFixed(2));
            const tradeinPriceGbp = Number((lowPriceGbp * 0.70).toFixed(2));

            // Upsert to card_prices_v2
            await prisma.cardPriceV2.upsert({
              where: { cardId: data.cardId },
              update: {
                limitlessCardmarketEur: data.priceTrendEur,
                limitlessCardmarketGbp: trendPriceGbp,
                limitlessUpdatedAt: data.scrapedAt,
                bestPriceGbp: lowPriceGbp,
                tradeinPriceGbp: tradeinPriceGbp,
                eurToGbpRate: config.eurGbpRate,
                lastUpdated: new Date(),
              },
              create: {
                cardId: data.cardId,
                game: 'onepiece',
                name: data.cardId,
                releaseSet: data.cardId.split('-')[0],
                fullCardNumber: data.cardId.replace(/-[a-z]+$/, ''),
                setCode: data.cardId.split('-')[0],
                cardNumber: data.cardId.split('-')[1] || '000',
                variantType: data.variant !== 'standard' ? data.variant : null,
                language: data.language || 'EN',
                limitlessCardmarketEur: data.priceTrendEur,
                limitlessCardmarketGbp: trendPriceGbp,
                limitlessUpdatedAt: data.scrapedAt,
                bestPriceGbp: lowPriceGbp,
                tradeinPriceGbp: tradeinPriceGbp,
                eurToGbpRate: config.eurGbpRate,
                lastUpdated: new Date(),
              },
            });
            upsertedCount++;

            // Insert price history
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            await prisma.$executeRaw`
              INSERT INTO price_history_daily (
                card_id, date, eu_trend_gbp, eu_low_gbp, eu_trend_eur, eu_low_eur,
                eu_listings_count, fx_eur_gbp, created_at
              ) VALUES (
                ${data.cardId}, ${today}, ${trendPriceGbp}, ${lowPriceGbp},
                ${data.priceTrendEur}, ${data.priceFromEur}, ${data.availableItems},
                ${config.eurGbpRate}, NOW()
              )
              ON CONFLICT (card_id, date) DO UPDATE SET
                eu_trend_gbp = EXCLUDED.eu_trend_gbp,
                eu_low_gbp = EXCLUDED.eu_low_gbp,
                eu_trend_eur = EXCLUDED.eu_trend_eur,
                eu_low_eur = EXCLUDED.eu_low_eur,
                eu_listings_count = EXCLUDED.eu_listings_count
            `;
            historyCount++;
          } catch (err) {
            rdsErrors.push(`${data.cardId}: ${err}`);
          }
        }

        const duration = Date.now() - startTime;
        console.log(`   Upserted: ${upsertedCount} records`);
        console.log(`   History: ${historyCount} records`);
        if (rdsErrors.length > 0) {
          console.log(`   Errors: ${rdsErrors.length}`);
        }
        console.log(`   Duration: ${duration}ms\n`);

        await prisma.$disconnect();
      } catch (error) {
        console.error(`   RDS Error: ${error}\n`);
        errors.push(`RDS: ${error}`);
      }
    }
  } else if (config.skipRds) {
    console.log('4. Skipping RDS storage (--skip-rds)\n');
  }

  // ==========================================================================
  // 5. EXPORT TO S3
  // ==========================================================================
  if (config.exportS3 && collectedData.length > 0) {
    console.log('5. Exporting to S3...\n');

    if (config.dryRun) {
      console.log(`   [DRY RUN] Would export ${collectedData.length} records to S3\n`);
    } else {
      try {
        const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
        const { gzip } = await import('zlib');
        const { promisify } = await import('util');
        const gzipAsync = promisify(gzip);

        const s3Client = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
        const bucket = process.env.DATA_LAKE_BUCKET || 'tcg-data-lake';

        // Generate S3 key with date partitioning
        const now = new Date();
        const year = now.getUTCFullYear();
        const month = String(now.getUTCMonth() + 1).padStart(2, '0');
        const day = String(now.getUTCDate()).padStart(2, '0');
        const hour = String(now.getUTCHours()).padStart(2, '0');
        const timestamp = now.getTime();
        const key = `raw/prices/cardmarket/year=${year}/month=${month}/day=${day}/prices_${hour}_${timestamp}.ndjson.gz`;

        // Transform to NormalizedPriceSignal format
        const normalizedPrices: NormalizedPriceSignal[] = collectedData.map(data => ({
          cardId: data.cardId,
          name: data.cardId,
          priceFromUsd: data.priceFromEur * 1.08, // EUR to USD approx
          priceTrendUsd: data.priceTrendEur * 1.08,
          priceAvgUsd: (data.priceAvg7Eur || data.priceTrendEur) * 1.08,
          bestPriceUsd: data.priceFromEur * 1.08,
          tradeinPriceUsd: data.priceFromEur * 1.08 * 0.70,
          source: {
            marketplace: 'cardmarket',
            currency: 'EUR',
            priceFrom: data.priceFromEur,
            priceTrend: data.priceTrendEur,
            priceAvg: data.priceAvg7Eur || data.priceTrendEur,
          },
          spreadPercent: data.priceFromEur > 0
            ? ((data.priceTrendEur - data.priceFromEur) / data.priceFromEur * 100)
            : 0,
          spreadAbsolute: data.priceTrendEur - data.priceFromEur,
          fxRate: config.eurGbpRate,
          fxSource: 'config',
          timestamp: data.scrapedAt,
        }));

        // Convert to NDJSON format
        const ndjsonContent = normalizedPrices.map(p => JSON.stringify(p)).join('\n') + '\n';
        const compressedContent = await gzipAsync(Buffer.from(ndjsonContent));

        // Upload to S3
        await s3Client.send(new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: compressedContent,
          ContentType: 'application/gzip',
          ContentEncoding: 'gzip',
          Metadata: {
            'uploaded-by': 'cardmarket-collector',
            'record-count': String(normalizedPrices.length),
          },
        }));

        console.log(`   Uploaded: s3://${bucket}/${key}`);
        console.log(`   Size: ${(compressedContent.length / 1024).toFixed(1)} KB`);
        console.log(`   Records: ${normalizedPrices.length}\n`);
      } catch (error) {
        console.error(`   S3 Error: ${error}\n`);
        errors.push(`S3: ${error}`);
      }
    }
  } else if (!config.exportS3) {
    console.log('5. Skipping S3 export (use --export-s3 to enable)\n');
  }

  // ==========================================================================
  // 6. SUMMARY
  // ==========================================================================
  const duration = (Date.now() - startTime) / 1000;

  console.log('='.repeat(70));
  console.log('  COLLECTION SUMMARY');
  console.log('='.repeat(70));
  console.log(`  Duration: ${duration.toFixed(1)}s`);
  console.log(`  Cards collected: ${collectedData.length}`);
  console.log(`  Errors: ${errors.length}`);

  if (collectedData.length > 0) {
    const prices = collectedData.map(d => d.priceTrendEur).filter(p => p > 0);
    const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
    const maxPrice = Math.max(...prices);
    const minPrice = Math.min(...prices);

    console.log(`  Price range: €${minPrice.toFixed(2)} - €${maxPrice.toFixed(2)}`);
    console.log(`  Average price: €${avgPrice.toFixed(2)}`);
  }

  console.log('='.repeat(70));

  // Show top 10 most expensive cards
  if (collectedData.length > 0 && config.verbose) {
    console.log('\n  TOP 10 MOST EXPENSIVE CARDS:');
    console.log('-'.repeat(50));

    const sorted = [...collectedData]
      .sort((a, b) => b.priceTrendEur - a.priceTrendEur)
      .slice(0, 10);

    sorted.forEach((card, i) => {
      console.log(`  ${i + 1}. ${card.cardId} (${card.variant}): €${card.priceTrendEur.toFixed(2)}`);
    });
  }

  // Show errors if any
  if (errors.length > 0) {
    console.log('\n  ERRORS:');
    console.log('-'.repeat(50));
    errors.slice(0, 10).forEach(e => console.log(`  - ${e}`));
    if (errors.length > 10) {
      console.log(`  ... and ${errors.length - 10} more`);
    }
  }

  console.log('\n  Completed: ' + new Date().toISOString());
  console.log('='.repeat(70) + '\n');
}

// =============================================================================
// ENTRY POINT
// =============================================================================

async function main(): Promise<void> {
  const config = parseArgs();

  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(`
CardMarket Live Collection Script

Usage:
  npx tsx scripts/collect-cardmarket-live.ts [options]

Options:
  --dry-run        Simulate without actual scraping/storage
  --tier=TIER      Target tier: legendary, epic, rare, all (default: all)
  --set=CODE       Target specific set (e.g., OP01, OP06)
  --export-s3      Export raw data to S3 after collection
  --skip-rds       Skip database storage
  --proxy          Use proxy (requires PROXY_URL env var)
  --verbose        Enable verbose logging
  --help, -h       Show this help

Environment:
  DATABASE_URL     PostgreSQL connection string
  DATA_LAKE_BUCKET S3 bucket for training data
  AWS_REGION       AWS region (default: us-east-1)
  PROXY_URL        Proxy URL for Cloudflare bypass
  EUR_GBP_RATE     EUR to GBP exchange rate (default: 0.85)

Examples:
  # Dry run for legendary tier
  npx tsx scripts/collect-cardmarket-live.ts --dry-run --tier=legendary

  # Live collection with S3 export
  npx tsx scripts/collect-cardmarket-live.ts --export-s3 --verbose

  # Collect specific set with proxy
  npx tsx scripts/collect-cardmarket-live.ts --set=OP06 --proxy
`);
    return;
  }

  try {
    await runCollection(config);
  } catch (error) {
    console.error('\n\nFATAL ERROR:', error);
    process.exit(1);
  }
}

main();
