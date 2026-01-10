/**
 * Daily TCGPlayer Price Archive - Production Pipeline
 *
 * Hybrid pipeline using:
 * - JustTCG API as primary source (faster, cheaper, more reliable)
 * - Bright Data scraper as fallback (when API fails or doesn't cover a game)
 *
 * AWS-ready with:
 * - Secrets Manager integration
 * - CloudWatch metrics
 * - Retry logic
 * - Progress checkpointing
 *
 * Usage:
 *   # Local development
 *   JUSTTCG_API_KEY=xxx DATABASE_URL=xxx npx tsx scripts/daily-tcgplayer-production.ts
 *
 *   # With Bright Data fallback
 *   JUSTTCG_API_KEY=xxx BRIGHTDATA_TOKEN=xxx DATABASE_URL=xxx npx tsx scripts/daily-tcgplayer-production.ts
 *
 *   # Force scraper only (bypass API)
 *   BRIGHTDATA_TOKEN=xxx npx tsx scripts/daily-tcgplayer-production.ts --force-scraper
 *
 *   # AWS (secrets from Secrets Manager)
 *   npx tsx scripts/daily-tcgplayer-production.ts
 *
 * Options:
 *   --dry-run         Don't write to database
 *   --game=X          Game to scrape (default: onepiece)
 *   --sets=X,Y        Comma-separated set codes
 *   --max-cards=N     Max cards per set (for testing)
 *   --force-api       Force JustTCG API only (no fallback)
 *   --force-scraper   Force Bright Data scraper only (bypass API)
 */

import { PrismaClient } from '@prisma/client';
import {
  createHybridPipeline,
  type HybridTCGPlayerPipeline,
  type UnifiedCardData,
  type PipelineResult,
} from '../src/pipeline/hybrid-tcgplayer-pipeline.js';
import type { GameCode } from '../src/config/games.js';

// ============================================================================
// Configuration
// ============================================================================

const USD_TO_GBP = 0.79;

interface PipelineConfig {
  dryRun: boolean;
  game: GameCode;
  sets?: string[];
  maxCards?: number;
  forceApi?: boolean;
  forceScraper?: boolean;
}

interface ProductionResult {
  success: boolean;
  setsProcessed: number;
  cardsArchived: number;
  conditionSnapshots: number;
  historyRecords: number;
  errors: string[];
  duration: number;
  dataSource: 'justtcg' | 'brightdata' | 'merged' | 'none';
}

// ============================================================================
// Database Operations
// ============================================================================

async function saveCardArchive(
  prisma: PrismaClient,
  card: UnifiedCardData,
  date: Date
): Promise<{ conditionCount: number }> {
  const toGbp = (usd: number | null): number | null => {
    return usd !== null ? Math.round(usd * USD_TO_GBP * 100) / 100 : null;
  };

  // Upsert main archive record
  const archive = await prisma.tCGPlayerPriceArchive.upsert({
    where: {
      cardId_date: {
        cardId: card.cardId,
        date: date,
      },
    },
    create: {
      cardId: card.cardId,
      date: date,
      game: card.game,
      setCode: card.setCode,
      setName: card.setName,
      cardNumber: card.cardNumber,
      variantType: card.variantType,
      cardName: card.cardName,
      rarity: card.rarity,
      marketPriceUsd: card.marketPriceUsd,
      lowPriceUsd: card.lowPriceUsd,
      marketPriceGbp: card.marketPriceGbp,
      lowPriceGbp: card.lowPriceGbp,
      totalListings: card.totalListings,
      totalSellers: card.totalSellers,
      priceChange24h: card.statistics?.change24h,
      priceChange7d: card.statistics?.change7d,
      priceChange30d: card.statistics?.change30d,
      priceChange90d: card.statistics?.change90d,
      avgPriceUsd: card.statistics?.avg,
      stdDev: card.statistics?.stdDev,
      usdGbpRate: USD_TO_GBP,
      imageUrl: card.imageUrl,
      sourceUrl: card.sourceUrl,
      dataSource: card.source,
      scrapeSuccess: true,
    },
    update: {
      cardName: card.cardName,
      rarity: card.rarity,
      marketPriceUsd: card.marketPriceUsd,
      lowPriceUsd: card.lowPriceUsd,
      marketPriceGbp: card.marketPriceGbp,
      lowPriceGbp: card.lowPriceGbp,
      totalListings: card.totalListings,
      totalSellers: card.totalSellers,
      priceChange24h: card.statistics?.change24h,
      priceChange7d: card.statistics?.change7d,
      priceChange30d: card.statistics?.change30d,
      priceChange90d: card.statistics?.change90d,
      avgPriceUsd: card.statistics?.avg,
      stdDev: card.statistics?.stdDev,
      usdGbpRate: USD_TO_GBP,
      imageUrl: card.imageUrl,
      dataSource: card.source,
      scrapeSuccess: true,
      scrapedAt: new Date(),
    },
  });

  // Upsert NM condition price (default from market price)
  let conditionCount = 0;
  if (card.marketPriceUsd) {
    await prisma.tCGPlayerConditionSnapshot.upsert({
      where: {
        cardId_date_conditionCode_printing: {
          cardId: card.cardId,
          date: date,
          conditionCode: 'NM',
          printing: 'Normal',
        },
      },
      create: {
        archiveId: archive.id,
        cardId: card.cardId,
        date: date,
        conditionId: 1,
        conditionCode: 'NM',
        conditionName: 'Near Mint',
        printing: 'Normal',
        priceUsd: card.marketPriceUsd,
        lowPriceUsd: card.lowPriceUsd,
        priceGbp: card.marketPriceGbp,
        lowPriceGbp: card.lowPriceGbp,
        listingsCount: card.totalListings,
      },
      update: {
        priceUsd: card.marketPriceUsd,
        lowPriceUsd: card.lowPriceUsd,
        priceGbp: card.marketPriceGbp,
        lowPriceGbp: card.lowPriceGbp,
        listingsCount: card.totalListings,
      },
    });
    conditionCount++;
  }

  return { conditionCount };
}

async function savePriceHistory(
  prisma: PrismaClient,
  card: UnifiedCardData
): Promise<number> {
  if (!card.priceHistory || card.priceHistory.length === 0) {
    return 0;
  }

  let recordCount = 0;
  for (const point of card.priceHistory) {
    try {
      await prisma.tCGPlayerPriceHistory.upsert({
        where: {
          cardId_timestamp: {
            cardId: card.cardId,
            timestamp: point.timestamp,
          },
        },
        create: {
          cardId: card.cardId,
          priceUsd: point.price,
          priceGbp: Math.round(point.price * USD_TO_GBP * 100) / 100,
          timestamp: point.timestamp,
          dataSource: card.source,
        },
        update: {
          priceUsd: point.price,
          priceGbp: Math.round(point.price * USD_TO_GBP * 100) / 100,
        },
      });
      recordCount++;
    } catch {
      // Skip duplicates silently
    }
  }

  return recordCount;
}

// ============================================================================
// Main Pipeline
// ============================================================================

async function runPipeline(config: PipelineConfig): Promise<ProductionResult> {
  const startTime = Date.now();
  const errors: string[] = [];
  let setsProcessed = 0;
  let cardsArchived = 0;
  let conditionSnapshots = 0;
  let historyRecords = 0;
  let dataSource: 'justtcg' | 'brightdata' | 'merged' | 'none' = 'none';

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  📅 TCGPlayer Daily Price Archive - PRODUCTION');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Environment: ${process.env.AWS_REGION ? 'AWS' : 'Local'}`);
  console.log(`  Mode: ${config.dryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log(`  Game: ${config.game}`);
  console.log(`  Date: ${new Date().toISOString().split('T')[0]}`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Initialize hybrid pipeline
  console.log('🔐 Loading secrets and initializing pipeline...');
  const pipeline = await createHybridPipeline(config.game);

  // Check source availability
  const status = await pipeline.checkSourceStatus();
  console.log(`📡 JustTCG API: ${status.justtcg}`);
  console.log(`🌐 Bright Data: ${status.brightdata}\n`);

  // Initialize database
  const prisma = new PrismaClient();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Get sets to process
  const availableSets = pipeline.getAvailableSets();
  const setsToProcess = config.sets || availableSets.map((s) => s.code);

  console.log(`📋 Sets to process: ${setsToProcess.join(', ')}`);
  if (config.maxCards) {
    console.log(`📦 Max cards per set: ${config.maxCards}`);
  }
  console.log('');

  try {
    // Determine source to use
    let forceSource: 'justtcg' | 'brightdata' | undefined;
    if (config.forceApi) forceSource = 'justtcg';
    if (config.forceScraper) forceSource = 'brightdata';

    // Run hybrid pipeline for each set
    for (const setCode of setsToProcess) {
      console.log(`\n${'─'.repeat(60)}`);
      console.log(`🗂️  SET: ${setCode}`);
      console.log('─'.repeat(60));

      const result: PipelineResult = await pipeline.run({
        setCode,
        maxCards: config.maxCards,
        forceSource,
      });

      if (!result.success) {
        errors.push(...result.errors);
        continue;
      }

      dataSource = result.apiSource;

      // Save to database
      for (const card of result.cards) {
        if (config.dryRun) {
          console.log(`   [DRY RUN] Would save: ${card.cardId}`);
          cardsArchived++;
        } else {
          try {
            const { conditionCount } = await saveCardArchive(prisma, card, today);
            cardsArchived++;
            conditionSnapshots += conditionCount;

            // Save price history if available
            const historyCount = await savePriceHistory(prisma, card);
            historyRecords += historyCount;
          } catch (error) {
            const msg = error instanceof Error ? error.message : 'Unknown error';
            errors.push(`DB error for ${card.cardId}: ${msg}`);
          }
        }
      }

      setsProcessed++;
      console.log(`   ✅ Set complete: ${result.cardsCollected} cards saved`);
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    errors.push(`Pipeline error: ${msg}`);
    console.error('❌ Pipeline error:', msg);
  } finally {
    await prisma.$disconnect();
  }

  const duration = Date.now() - startTime;

  return {
    success: errors.length === 0,
    setsProcessed,
    cardsArchived,
    conditionSnapshots,
    historyRecords,
    errors,
    duration,
    dataSource,
  };
}

// ============================================================================
// CLI Entry Point
// ============================================================================

async function main() {
  // Parse arguments
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const forceApi = args.includes('--force-api');
  const forceScraper = args.includes('--force-scraper');

  const gameArg = args.find((a) => a.startsWith('--game='));
  const game = (gameArg ? gameArg.split('=')[1] : 'onepiece') as GameCode;

  const setsArg = args.find((a) => a.startsWith('--sets='));
  const sets = setsArg ? setsArg.split('=')[1].split(',') : undefined;

  const maxCardsArg = args.find((a) => a.startsWith('--max-cards='));
  const maxCards = maxCardsArg ? parseInt(maxCardsArg.split('=')[1], 10) : undefined;

  // Validate environment
  const hasJustTcg = !!process.env.JUSTTCG_API_KEY;
  const hasBrightdata = !!process.env.BRIGHTDATA_TOKEN;
  const isAws = !!process.env.AWS_REGION;

  if (!hasJustTcg && !hasBrightdata && !isAws) {
    console.error('❌ Error: JUSTTCG_API_KEY or BRIGHTDATA_TOKEN required');
    console.error('   (or run in AWS with Secrets Manager)');
    process.exit(1);
  }

  if (forceScraper && !hasBrightdata && !isAws) {
    console.error('❌ Error: --force-scraper requires BRIGHTDATA_TOKEN');
    process.exit(1);
  }

  // Run pipeline
  const result = await runPipeline({
    dryRun,
    game,
    sets,
    maxCards,
    forceApi,
    forceScraper,
  });

  // Print summary
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  📊 PIPELINE COMPLETE');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Status: ${result.success ? '✅ SUCCESS' : '❌ FAILED'}`);
  console.log(`  Data Source: ${result.dataSource}`);
  console.log(`  Sets processed: ${result.setsProcessed}`);
  console.log(`  Cards archived: ${result.cardsArchived}`);
  console.log(`  Condition snapshots: ${result.conditionSnapshots}`);
  console.log(`  History records: ${result.historyRecords}`);
  console.log(`  Duration: ${(result.duration / 1000 / 60).toFixed(1)} minutes`);
  console.log(`  Errors: ${result.errors.length}`);

  if (result.errors.length > 0) {
    console.log('\n⚠️  Errors:');
    result.errors.slice(0, 10).forEach((e) => console.log(`   - ${e}`));
    if (result.errors.length > 10) {
      console.log(`   ... and ${result.errors.length - 10} more`);
    }
  }

  console.log('═══════════════════════════════════════════════════════════════\n');

  // Exit with appropriate code
  process.exit(result.success ? 0 : 1);
}

main().catch((error) => {
  console.error('💥 Fatal error:', error);
  process.exit(1);
});
