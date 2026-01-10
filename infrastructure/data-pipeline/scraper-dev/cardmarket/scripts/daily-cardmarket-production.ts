/**
 * Daily CardMarket Price Archive - Production Pipeline
 *
 * AWS-ready scraper with:
 * - Secrets Manager integration
 * - CloudWatch metrics
 * - Retry logic
 * - Progress checkpointing
 *
 * Usage:
 *   # Local development
 *   BRIGHTDATA_TOKEN=xxx DATABASE_URL=xxx npx tsx scripts/daily-cardmarket-production.ts
 *
 *   # AWS (secrets from Secrets Manager)
 *   npx tsx scripts/daily-cardmarket-production.ts
 *
 * Options:
 *   --dry-run       Don't write to database
 *   --sets=X,Y      Comma-separated set codes
 *   --max-cards=N   Max cards per set
 */

import { PrismaClient } from '@prisma/client';
import {
  createProductionScraper,
  type CardArchiveData,
  type ScrapeMetrics,
  publishMetrics,
} from '../src/scrapers/cardmarket-production-scraper.js';

// ============================================================================
// Configuration
// ============================================================================

const EUR_TO_GBP = 0.86;

interface PipelineConfig {
  dryRun: boolean;
  sets?: string[];
  maxCards?: number;
  maxPages?: number;
}

interface PipelineResult {
  success: boolean;
  setsProcessed: number;
  cardsArchived: number;
  conditionSnapshots: number;
  listingSnapshots: number;
  errors: string[];
  metrics: ScrapeMetrics;
  duration: number;
}

// ============================================================================
// Database Operations
// ============================================================================

async function saveCardArchive(
  prisma: PrismaClient,
  card: CardArchiveData,
  date: Date
): Promise<{ conditionCount: number; listingCount: number }> {
  const toGbp = (eur: number | null): number | null => {
    return eur !== null ? Math.round(eur * EUR_TO_GBP * 100) / 100 : null;
  };

  // Upsert main archive record
  const archive = await prisma.cardMarketPriceArchive.upsert({
    where: {
      cardId_date: {
        cardId: card.cardId,
        date: date,
      },
    },
    create: {
      cardId: card.cardId,
      date: date,
      game: 'onepiece',
      setCode: card.setCode,
      cardNumber: card.cardNumber,
      variantType: card.variantType,
      cardName: card.cardName,
      trendPriceEur: card.trendPriceEur,
      fromPriceEur: card.fromPriceEur,
      avg7PriceEur: card.avg7PriceEur,
      avg30PriceEur: card.avg30PriceEur,
      trendPriceGbp: toGbp(card.trendPriceEur),
      fromPriceGbp: toGbp(card.fromPriceEur),
      avg7PriceGbp: toGbp(card.avg7PriceEur),
      avg30PriceGbp: toGbp(card.avg30PriceEur),
      totalListings: card.totalListings,
      totalSellers: card.totalSellers,
      priceChange7d: card.priceChange7d,
      priceChange30d: card.priceChange30d,
      eurGbpRate: EUR_TO_GBP,
      sourceUrl: card.sourceUrl,
      scrapeSuccess: true,
    },
    update: {
      cardName: card.cardName,
      trendPriceEur: card.trendPriceEur,
      fromPriceEur: card.fromPriceEur,
      avg7PriceEur: card.avg7PriceEur,
      avg30PriceEur: card.avg30PriceEur,
      trendPriceGbp: toGbp(card.trendPriceEur),
      fromPriceGbp: toGbp(card.fromPriceEur),
      avg7PriceGbp: toGbp(card.avg7PriceEur),
      avg30PriceGbp: toGbp(card.avg30PriceEur),
      totalListings: card.totalListings,
      totalSellers: card.totalSellers,
      priceChange7d: card.priceChange7d,
      priceChange30d: card.priceChange30d,
      eurGbpRate: EUR_TO_GBP,
      scrapeSuccess: true,
      scrapedAt: new Date(),
    },
  });

  // Upsert condition snapshots
  let conditionCount = 0;
  for (const cond of card.conditionPrices) {
    await prisma.cardMarketConditionSnapshot.upsert({
      where: {
        cardId_date_conditionCode_languageCode: {
          cardId: card.cardId,
          date: date,
          conditionCode: cond.conditionCode,
          languageCode: cond.languageCode,
        },
      },
      create: {
        archiveId: archive.id,
        cardId: card.cardId,
        date: date,
        conditionId: cond.conditionId,
        conditionCode: cond.conditionCode,
        languageId: cond.languageId,
        languageCode: cond.languageCode,
        fromPriceEur: cond.fromPriceEur,
        avgPriceEur: cond.avgPriceEur,
        highPriceEur: cond.highPriceEur,
        fromPriceGbp: toGbp(cond.fromPriceEur),
        avgPriceGbp: toGbp(cond.avgPriceEur),
        highPriceGbp: toGbp(cond.highPriceEur),
        listingsCount: cond.listingsCount,
      },
      update: {
        fromPriceEur: cond.fromPriceEur,
        avgPriceEur: cond.avgPriceEur,
        highPriceEur: cond.highPriceEur,
        fromPriceGbp: toGbp(cond.fromPriceEur),
        avgPriceGbp: toGbp(cond.avgPriceEur),
        highPriceGbp: toGbp(cond.highPriceEur),
        listingsCount: cond.listingsCount,
      },
    });
    conditionCount++;
  }

  // Delete existing listings for this card/date to avoid duplicates on re-run
  await prisma.cardMarketListingSnapshot.deleteMany({
    where: {
      cardId: card.cardId,
      date: date,
    },
  });

  // Create listing snapshots in batch for efficiency
  let listingCount = 0;
  if (card.listings.length > 0) {
    await prisma.cardMarketListingSnapshot.createMany({
      data: card.listings.map((listing) => ({
        cardId: card.cardId,
        date: date,
        sellerName: listing.sellerName,
        sellerCountry: listing.sellerCountry,
        sellerSales: listing.sellerSales,
        conditionCode: listing.conditionCode,
        languageCode: listing.languageCode,
        priceEur: listing.priceEur,
        quantity: listing.quantity,
        isSigned: listing.isSigned,
        isFirstEd: listing.isFirstEd,
        isAltered: listing.isAltered,
        isPlayset: listing.isPlayset,
      })),
    });
    listingCount = card.listings.length;
  }

  return { conditionCount, listingCount };
}

// ============================================================================
// Main Pipeline
// ============================================================================

async function runPipeline(config: PipelineConfig): Promise<PipelineResult> {
  const startTime = Date.now();
  const errors: string[] = [];
  let setsProcessed = 0;
  let cardsArchived = 0;
  let conditionSnapshots = 0;
  let listingSnapshots = 0;

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  📅 CardMarket Daily Price Archive - PRODUCTION');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Environment: ${process.env.AWS_REGION ? 'AWS' : 'Local'}`);
  console.log(`  Mode: ${config.dryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log(`  Date: ${new Date().toISOString().split('T')[0]}`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Initialize scraper (auto-loads secrets)
  console.log('🔐 Loading secrets...');
  const scraper = await createProductionScraper({
    apiToken: process.env.BRIGHTDATA_TOKEN,
    requestDelayMs: 2000,
    maxRetries: 3,
    includeListings: true,
    maxListingsPerCard: 50,
    enableMetrics: !config.dryRun,
  });

  // Initialize database
  const prisma = new PrismaClient();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Get sets to process
  const availableSets = scraper.getAvailableSets();
  const setsToProcess = config.sets || availableSets.map((s) => s.code);

  console.log(`📋 Sets to process: ${setsToProcess.join(', ')}`);
  console.log(`📦 Max cards per set: ${config.maxCards || 'all'}\n`);

  try {
    for (const setCode of setsToProcess) {
      console.log(`\n${'─'.repeat(60)}`);
      console.log(`🗂️  SET: ${setCode}`);
      console.log('─'.repeat(60));

      const cards = await scraper.scrapeSet(setCode, {
        maxCards: config.maxCards,
        maxPages: config.maxPages,
      });

      // Save to database
      for (const card of cards) {
        if (config.dryRun) {
          console.log(`   [DRY RUN] Would save: ${card.cardId}`);
          cardsArchived++;
          conditionSnapshots += card.conditionPrices.length;
          listingSnapshots += card.listings.length;
        } else {
          try {
            const { conditionCount, listingCount } = await saveCardArchive(prisma, card, today);
            cardsArchived++;
            conditionSnapshots += conditionCount;
            listingSnapshots += listingCount;
          } catch (error) {
            const msg = error instanceof Error ? error.message : 'Unknown error';
            errors.push(`DB error for ${card.cardId}: ${msg}`);
          }
        }
      }

      setsProcessed++;
      console.log(`   ✅ Set complete: ${cards.length} cards saved`);
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    errors.push(`Pipeline error: ${msg}`);
    console.error('❌ Pipeline error:', msg);
  } finally {
    // Cleanup
    await scraper.close();
    await prisma.$disconnect();
  }

  const metrics = scraper.getMetrics();
  const duration = Date.now() - startTime;

  // Add scraper errors
  errors.push(...scraper.getErrors());

  return {
    success: errors.length === 0,
    setsProcessed,
    cardsArchived,
    conditionSnapshots,
    listingSnapshots,
    errors,
    metrics,
    duration,
  };
}

// ============================================================================
// CLI Entry Point
// ============================================================================

async function main() {
  // Parse arguments
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');

  const setsArg = args.find((a) => a.startsWith('--sets='));
  const sets = setsArg ? setsArg.split('=')[1].split(',') : undefined;

  const maxCardsArg = args.find((a) => a.startsWith('--max-cards='));
  const maxCards = maxCardsArg ? parseInt(maxCardsArg.split('=')[1], 10) : undefined;

  const maxPagesArg = args.find((a) => a.startsWith('--max-pages='));
  const maxPages = maxPagesArg ? parseInt(maxPagesArg.split('=')[1], 10) : undefined;

  // Validate environment
  if (!process.env.BRIGHTDATA_TOKEN && !process.env.AWS_REGION) {
    console.error('❌ Error: BRIGHTDATA_TOKEN required (or run in AWS with Secrets Manager)');
    process.exit(1);
  }

  // Run pipeline
  const result = await runPipeline({ dryRun, sets, maxCards, maxPages });

  // Print summary
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  📊 PIPELINE COMPLETE');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Status: ${result.success ? '✅ SUCCESS' : '❌ FAILED'}`);
  console.log(`  Sets processed: ${result.setsProcessed}`);
  console.log(`  Cards archived: ${result.cardsArchived}`);
  console.log(`  Condition snapshots: ${result.conditionSnapshots}`);
  console.log(`  Listing snapshots: ${result.listingSnapshots}`);
  console.log(`  Duration: ${(result.duration / 1000 / 60).toFixed(1)} minutes`);
  console.log(`  API calls: ${result.metrics.apiCalls}`);
  console.log(`  Retries: ${result.metrics.retries}`);
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
