/**
 * Daily CardMarket Price Archive using Bright Data
 *
 * Usage:
 *   BRIGHTDATA_TOKEN=xxx npx tsx scripts/daily-cardmarket-brightdata.ts [--dry-run] [--sets=OP01,OP02] [--max-cards=10]
 */

import { PrismaClient } from '@prisma/client';
import { createBrightDataScraper, type CardArchiveData, CONDITIONS } from '../src/scrapers/cardmarket-brightdata-scraper.js';

const prisma = new PrismaClient();

const EUR_TO_GBP = 0.86;

interface ArchiveStats {
  setsProcessed: number;
  cardsArchived: number;
  conditionSnapshotsCreated: number;
  listingSnapshotsCreated: number;
  errors: string[];
  duration: number;
}

async function saveCardArchive(card: CardArchiveData, date: Date): Promise<{ archiveId: number; conditionCount: number; listingCount: number }> {
  const toGbp = (eur: number | null): number | null => {
    return eur !== null ? Math.round(eur * EUR_TO_GBP * 100) / 100 : null;
  };

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
      priceChange7d: card.priceChange7d,
      priceChange30d: card.priceChange30d,
      eurGbpRate: EUR_TO_GBP,
      scrapeSuccess: true,
      scrapedAt: new Date(),
    },
  });

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

  let listingCount = 0;
  for (const listing of card.listings) {
    await prisma.cardMarketListingSnapshot.create({
      data: {
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
      },
    });
    listingCount++;
  }

  return { archiveId: archive.id, conditionCount, listingCount };
}

async function runDailyArchive(options: {
  dryRun: boolean;
  sets?: string[];
  maxCards?: number;
  maxPages?: number;
  apiToken: string;
}): Promise<ArchiveStats> {
  const startTime = Date.now();
  const stats: ArchiveStats = {
    setsProcessed: 0,
    cardsArchived: 0,
    conditionSnapshotsCreated: 0,
    listingSnapshotsCreated: 0,
    errors: [],
    duration: 0,
  };

  const scraper = createBrightDataScraper({
    apiToken: options.apiToken,
    requestDelayMs: 2000,
    includeListings: true,
    maxListingsPerCard: 50,
  });

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const availableSets = scraper.getAvailableSets();
  const setsToProcess = options.sets || availableSets.map((s) => s.code);

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  📅 Daily CardMarket Price Archive (Bright Data)');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Date: ${today.toISOString().split('T')[0]}`);
  console.log(`  Mode: ${options.dryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log(`  Sets: ${setsToProcess.join(', ')}`);
  console.log(`  Max cards per set: ${options.maxCards || 'all'}`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  try {
    for (const setCode of setsToProcess) {
      console.log(`\n🗂️  Processing set: ${setCode}`);

      const result = await scraper.scrapeSetArchive(setCode, {
        maxCards: options.maxCards,
        maxPages: options.maxPages,
      });

      if (result.errors.length > 0) {
        stats.errors.push(...result.errors);
      }

      for (const card of result.cards) {
        if (options.dryRun) {
          console.log(`   [DRY RUN] Would archive: ${card.cardId} - €${card.trendPriceEur} (${card.conditionPrices.length} conditions)`);
          stats.cardsArchived++;
          stats.conditionSnapshotsCreated += card.conditionPrices.length;
          stats.listingSnapshotsCreated += card.listings.length;
        } else {
          try {
            const { conditionCount, listingCount } = await saveCardArchive(card, today);
            stats.cardsArchived++;
            stats.conditionSnapshotsCreated += conditionCount;
            stats.listingSnapshotsCreated += listingCount;
          } catch (error) {
            const msg = error instanceof Error ? error.message : 'Unknown error';
            stats.errors.push(`Failed to save ${card.cardId}: ${msg}`);
          }
        }
      }

      stats.setsProcessed++;
      console.log(`   ✓ Set complete: ${result.stats.cardsProcessed} cards, ${result.stats.conditionsExtracted} conditions`);
    }
  } finally {
    await scraper.close();
    await prisma.$disconnect();
  }

  stats.duration = Date.now() - startTime;
  return stats;
}

// Get API token from environment
const apiToken = process.env.BRIGHTDATA_TOKEN;
if (!apiToken) {
  console.error('Error: BRIGHTDATA_TOKEN environment variable is required');
  console.error('Usage: BRIGHTDATA_TOKEN=xxx npx tsx scripts/daily-cardmarket-brightdata.ts');
  process.exit(1);
}

// Parse command line arguments
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');

const setsArg = args.find((a) => a.startsWith('--sets='));
const sets = setsArg ? setsArg.split('=')[1].split(',') : undefined;

const maxCardsArg = args.find((a) => a.startsWith('--max-cards='));
const maxCards = maxCardsArg ? parseInt(maxCardsArg.split('=')[1], 10) : undefined;

const maxPagesArg = args.find((a) => a.startsWith('--max-pages='));
const maxPages = maxPagesArg ? parseInt(maxPagesArg.split('=')[1], 10) : undefined;

runDailyArchive({ dryRun, sets, maxCards, maxPages, apiToken })
  .then((stats) => {
    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('  📊 ARCHIVE COMPLETE');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`  Sets processed: ${stats.setsProcessed}`);
    console.log(`  Cards archived: ${stats.cardsArchived}`);
    console.log(`  Condition snapshots: ${stats.conditionSnapshotsCreated}`);
    console.log(`  Listing snapshots: ${stats.listingSnapshotsCreated}`);
    console.log(`  Duration: ${(stats.duration / 1000).toFixed(1)}s`);
    console.log(`  Errors: ${stats.errors.length}`);

    if (stats.errors.length > 0) {
      console.log('\n⚠️  Errors:');
      stats.errors.slice(0, 10).forEach((e) => console.log(`   - ${e}`));
      if (stats.errors.length > 10) {
        console.log(`   ... and ${stats.errors.length - 10} more`);
      }
    }

    console.log('═══════════════════════════════════════════════════════════════\n');
    process.exit(stats.errors.length > 0 ? 1 : 0);
  })
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
