#!/usr/bin/env npx tsx
/**
 * Comprehensive 1-Year eBay Collection Runner
 *
 * Exhausts ~1000 SerpAPI searches to collect sold listing data for
 * alt art and rare One Piece TCG cards from the past year.
 *
 * Usage:
 *   npx tsx src/run-1year-collection.ts [options]
 *
 * Options:
 *   --dry-run          Preview without making API calls
 *   --priority=N       Only run queries with priority <= N (1-3)
 *   --variant=TYPE     Only run queries targeting specific variant
 *   --max-searches=N   Limit total searches (default: 1000)
 *   --resume=QUERY     Resume from specific query name
 *   --verbose          Enable detailed logging
 *
 * Created: 2026-01-09
 */

import {
  getAllComprehensiveQueries,
  getTotalSearches,
  getTotalExpectedListings,
  getSearchAllocation,
  printSummary,
  type ComprehensiveQuery,
} from './comprehensive-1year-queries.js';
import { Collector } from './pipeline/collector.js';
import { StorageManager } from './pipeline/storage.js';
import type { PipelineConfig } from './pipeline/config.js';
import type { ParsedListing } from './pipeline/types.js';

// =============================================================================
// CONFIGURATION
// =============================================================================

const CONFIG: PipelineConfig = {
  serpApiKey: process.env.SERPAPI_API_KEY || '***REMOVED-ROTATE-ME***',
  searchesPerRun: 1000,
  resultsPerPage: 200, // SerpAPI returns up to 240 per search with _ipg=200

  s3Bucket: process.env.S3_BUCKET || 'tcg-training-data',
  s3Region: process.env.AWS_REGION || 'us-east-1',
  s3Prefix: 'onepiece-tcg-1year',

  imageResolutions: [500, 1600],
  downloadConcurrency: 5,
  downloadRetries: 3,
  downloadDelayMs: 100,

  serpApiDelayMs: 2000, // Conservative rate limiting
  ebayImageDelayMs: 50,

  localCachePath: './cache/1year',
};

interface RunOptions {
  dryRun: boolean;
  maxPriority: number | null;
  targetVariant: string | null;
  maxSearches: number;
  resumeFrom: string | null;
  verbose: boolean;
  skipImages: boolean;
}

interface RunStats {
  startTime: Date;
  endTime?: Date;
  queriesRun: number;
  searchesUsed: number;
  listingsCollected: number;
  imagesDownloaded: number;
  bytesDownloaded: number;
  errors: Array<{ query: string; error: string }>;
  byVariant: Record<string, number>;
  byLanguage: Record<string, number>;
}

// =============================================================================
// MAIN RUNNER
// =============================================================================

async function main(): Promise<void> {
  const options = parseArgs();

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('       ONE PIECE TCG - 1-YEAR DATA COLLECTION');
  console.log('       Alt Art & Rare Cards from eBay Sold Listings');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Validate API key
  if (!CONFIG.serpApiKey && !options.dryRun) {
    console.error('❌ SERPAPI_API_KEY environment variable not set');
    console.log('   Set it with: export SERPAPI_API_KEY=your_key_here');
    process.exit(1);
  }

  // Print configuration summary
  printSummary();

  // Filter queries based on options
  let queries = getAllComprehensiveQueries();

  if (options.maxPriority) {
    queries = queries.filter((q) => q.priority <= options.maxPriority!);
    console.log(`📋 Filtered to priority <= ${options.maxPriority}: ${queries.length} queries`);
  }

  if (options.targetVariant) {
    queries = queries.filter((q) => q.targetVariant === options.targetVariant);
    console.log(`📋 Filtered to variant '${options.targetVariant}': ${queries.length} queries`);
  }

  if (options.resumeFrom) {
    const idx = queries.findIndex((q) => q.name === options.resumeFrom);
    if (idx >= 0) {
      queries = queries.slice(idx);
      console.log(`📋 Resuming from '${options.resumeFrom}': ${queries.length} queries remaining`);
    } else {
      console.warn(`⚠️  Query '${options.resumeFrom}' not found, starting from beginning`);
    }
  }

  // Calculate totals for filtered queries
  const totalSearches = queries.reduce((sum, q) => sum + q.searches, 0);
  const limitedSearches = Math.min(totalSearches, options.maxSearches);

  console.log(`\n📊 COLLECTION PLAN:`);
  console.log(`   Queries to run:     ${queries.length}`);
  console.log(`   Total searches:     ${totalSearches}`);
  console.log(`   Search limit:       ${options.maxSearches}`);
  console.log(`   Effective searches: ${limitedSearches}`);
  console.log(`   Dry run:            ${options.dryRun ? 'YES' : 'NO'}`);
  console.log(`   Skip images:        ${options.skipImages ? 'YES' : 'NO'}`);

  if (options.dryRun) {
    console.log('\n🔍 DRY RUN - No API calls will be made\n');
    printQueryPlan(queries, options.maxSearches);
    return;
  }

  // Confirm before proceeding
  console.log('\n⚠️  This will use up to', limitedSearches, 'SerpAPI searches.');
  console.log('   Press Ctrl+C within 5 seconds to cancel...\n');
  await delay(5000);

  // Initialize components
  const collector = new Collector(CONFIG);
  const storage = new StorageManager(CONFIG);

  // Run collection
  const stats = await runCollection(queries, collector, storage, options);

  // Print final stats
  printFinalStats(stats);

  // Save stats to file
  await saveStats(stats, storage);
}

// =============================================================================
// COLLECTION LOGIC
// =============================================================================

async function runCollection(
  queries: ComprehensiveQuery[],
  collector: Collector,
  storage: StorageManager,
  options: RunOptions
): Promise<RunStats> {
  const stats: RunStats = {
    startTime: new Date(),
    queriesRun: 0,
    searchesUsed: 0,
    listingsCollected: 0,
    imagesDownloaded: 0,
    bytesDownloaded: 0,
    errors: [],
    byVariant: {},
    byLanguage: {},
  };

  // Load processed IDs for deduplication
  const processedIds = await storage.getProcessedItemIds();
  console.log(`📦 Previously processed: ${processedIds.size} items\n`);

  // Process each query
  for (const query of queries) {
    if (stats.searchesUsed >= options.maxSearches) {
      console.log(`\n🛑 Reached search limit (${options.maxSearches})`);
      break;
    }

    const remainingSearches = options.maxSearches - stats.searchesUsed;
    const searchesToUse = Math.min(query.searches, remainingSearches);

    console.log(`\n${'─'.repeat(60)}`);
    console.log(`🔍 Query: ${query.name}`);
    console.log(`   "${query.query}"`);
    console.log(`   Searches: ${searchesToUse}/${query.searches} (${remainingSearches} remaining)`);
    if (query.targetVariant) console.log(`   Variant: ${query.targetVariant}`);
    if (query.notes) console.log(`   Notes: ${query.notes}`);

    try {
      const result = await processQuery(
        query,
        searchesToUse,
        collector,
        storage,
        processedIds,
        options
      );

      stats.queriesRun++;
      stats.searchesUsed += result.searchesUsed;
      stats.listingsCollected += result.listings;
      stats.imagesDownloaded += result.images;
      stats.bytesDownloaded += result.bytes;

      // Track by variant
      if (query.targetVariant) {
        stats.byVariant[query.targetVariant] =
          (stats.byVariant[query.targetVariant] || 0) + result.listings;
      }

      // Track by language
      if (query.targetLanguage && query.targetLanguage !== 'ALL') {
        stats.byLanguage[query.targetLanguage] =
          (stats.byLanguage[query.targetLanguage] || 0) + result.listings;
      }

      console.log(`   ✅ Collected: ${result.listings} listings, ${result.images} images`);
      console.log(`   📊 Running total: ${stats.listingsCollected} listings, ${stats.searchesUsed} searches`);

      // Update processed IDs
      for (const id of result.processedIds) {
        processedIds.add(id);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      stats.errors.push({ query: query.name, error: errorMsg });
      console.log(`   ❌ Error: ${errorMsg}`);
    }

    // Rate limiting between queries
    if (stats.searchesUsed < options.maxSearches) {
      console.log(`   ⏳ Waiting ${CONFIG.serpApiDelayMs}ms before next query...`);
      await delay(CONFIG.serpApiDelayMs);
    }
  }

  stats.endTime = new Date();
  return stats;
}

async function processQuery(
  query: ComprehensiveQuery,
  maxSearches: number,
  collector: Collector,
  storage: StorageManager,
  processedIds: Set<string>,
  options: RunOptions
): Promise<{
  searchesUsed: number;
  listings: number;
  images: number;
  bytes: number;
  processedIds: string[];
}> {
  const allListings: ParsedListing[] = [];
  let searchesUsed = 0;

  // Fetch pages up to limit
  for (let page = 1; page <= maxSearches; page++) {
    const { listings, totalResults } = await collector.fetchListings(
      query.query,
      query.name,
      page
    );

    searchesUsed++;
    const newListings = collector.filterNewListings(listings, processedIds);
    const validListings = collector.filterWithImages(newListings);

    allListings.push(...validListings);

    if (options.verbose) {
      console.log(`     Page ${page}: ${listings.length} raw, ${validListings.length} valid, ${totalResults} total`);
    }

    // Check if we've exhausted results
    const fetchedSoFar = page * CONFIG.resultsPerPage;
    if (fetchedSoFar >= totalResults || listings.length === 0) {
      break;
    }

    // Rate limiting between pages
    await delay(CONFIG.serpApiDelayMs);
  }

  // Save listings metadata
  if (allListings.length > 0) {
    await storage.saveListingsMetadata(allListings, query.name);
  }

  // Download images (unless skipped)
  let totalImages = 0;
  let totalBytes = 0;

  if (!options.skipImages && allListings.length > 0) {
    const imageBuffers = await collector.downloadBatch(
      allListings,
      CONFIG.imageResolutions,
      options.verbose
        ? (completed, total) => {
            process.stdout.write(`\r     Downloading images: ${completed}/${total}`);
          }
        : undefined
    );

    if (options.verbose) {
      console.log(); // New line after progress
    }

    // Upload to S3
    for (const listing of allListings) {
      const images = imageBuffers.get(listing.ebayItemId);
      if (!images) continue;

      for (const [resolution, buffer] of images) {
        await storage.uploadImage(buffer, listing, resolution);
        totalBytes += buffer.length;
        totalImages++;
      }
    }

    // Update manifest
    const imageMetadata = allListings
      .filter((l) => imageBuffers.has(l.ebayItemId))
      .flatMap((l) =>
        CONFIG.imageResolutions.map((res) => ({
          ebayItemId: l.ebayItemId,
          cardId: l.cardId,
          resolution: res,
          s3Key: `${CONFIG.s3Prefix}/images/raw/${res}/${l.cardId || 'unknown'}/${l.ebayItemId}.jpg`,
          sizeBytes: imageBuffers.get(l.ebayItemId)?.get(res)?.length || 0,
          contentType: 'image/jpeg' as const,
          downloadedAt: new Date().toISOString(),
          labels: {
            cardId: l.cardId,
            variantType: l.variantType,
            rarity: l.rarity,
            language: l.language,
            graded: l.graded,
            gradeCompany: l.gradeCompany,
            gradeValue: l.gradeValue,
            condition: l.condition,
            price: l.price,
            priceCurrency: l.priceCurrency,
          },
        }))
      );

    await storage.updateManifest(allListings, imageMetadata, query.name);
  }

  return {
    searchesUsed,
    listings: allListings.length,
    images: totalImages,
    bytes: totalBytes,
    processedIds: allListings.map((l) => l.ebayItemId),
  };
}

// =============================================================================
// HELPERS
// =============================================================================

function parseArgs(): RunOptions {
  const args = process.argv.slice(2);
  const options: RunOptions = {
    dryRun: false,
    maxPriority: null,
    targetVariant: null,
    maxSearches: 1000,
    resumeFrom: null,
    verbose: false,
    skipImages: false,
  };

  for (const arg of args) {
    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--verbose') {
      options.verbose = true;
    } else if (arg === '--skip-images') {
      options.skipImages = true;
    } else if (arg.startsWith('--priority=')) {
      options.maxPriority = parseInt(arg.split('=')[1], 10);
    } else if (arg.startsWith('--variant=')) {
      options.targetVariant = arg.split('=')[1];
    } else if (arg.startsWith('--max-searches=')) {
      options.maxSearches = parseInt(arg.split('=')[1], 10);
    } else if (arg.startsWith('--resume=')) {
      options.resumeFrom = arg.split('=')[1];
    }
  }

  return options;
}

function printQueryPlan(queries: ComprehensiveQuery[], maxSearches: number): void {
  console.log('\n📋 QUERY EXECUTION PLAN:\n');

  let cumulativeSearches = 0;

  for (const query of queries) {
    if (cumulativeSearches >= maxSearches) {
      console.log(`... ${queries.length - queries.indexOf(query)} queries skipped (search limit reached)`);
      break;
    }

    const searchesToUse = Math.min(query.searches, maxSearches - cumulativeSearches);
    cumulativeSearches += searchesToUse;

    console.log(`[P${query.priority}] ${query.name}`);
    console.log(`    Searches: ${searchesToUse}/${query.searches}`);
    console.log(`    Expected: ~${query.expectedListings} listings`);
    if (query.targetVariant) console.log(`    Variant: ${query.targetVariant}`);
    console.log();
  }

  console.log(`\nTotal: ${cumulativeSearches} searches planned`);
}

function printFinalStats(stats: RunStats): void {
  const duration = stats.endTime
    ? (stats.endTime.getTime() - stats.startTime.getTime()) / 1000
    : 0;

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('                    COLLECTION COMPLETE');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log('SUMMARY:');
  console.log(`  Duration:            ${(duration / 60).toFixed(1)} minutes`);
  console.log(`  Queries run:         ${stats.queriesRun}`);
  console.log(`  Searches used:       ${stats.searchesUsed}`);
  console.log(`  Listings collected:  ${stats.listingsCollected.toLocaleString()}`);
  console.log(`  Images downloaded:   ${stats.imagesDownloaded.toLocaleString()}`);
  console.log(`  Data size:           ${(stats.bytesDownloaded / 1024 / 1024).toFixed(1)} MB`);
  console.log(`  Errors:              ${stats.errors.length}`);

  if (Object.keys(stats.byVariant).length > 0) {
    console.log('\nBY VARIANT:');
    for (const [variant, count] of Object.entries(stats.byVariant)) {
      console.log(`  ${variant.padEnd(15)} ${count.toLocaleString()} listings`);
    }
  }

  if (Object.keys(stats.byLanguage).length > 0) {
    console.log('\nBY LANGUAGE:');
    for (const [lang, count] of Object.entries(stats.byLanguage)) {
      console.log(`  ${lang.padEnd(5)} ${count.toLocaleString()} listings`);
    }
  }

  if (stats.errors.length > 0) {
    console.log('\nERRORS:');
    for (const { query, error } of stats.errors.slice(0, 10)) {
      console.log(`  ${query}: ${error}`);
    }
    if (stats.errors.length > 10) {
      console.log(`  ... and ${stats.errors.length - 10} more errors`);
    }
  }

  console.log('\n═══════════════════════════════════════════════════════════════\n');
}

async function saveStats(stats: RunStats, storage: StorageManager): Promise<void> {
  const statsData = {
    ...stats,
    startTime: stats.startTime.toISOString(),
    endTime: stats.endTime?.toISOString(),
  };

  const date = new Date().toISOString().split('T')[0];
  await storage.saveDailyStats({
    date,
    queriesRun: stats.queriesRun,
    listingsCollected: stats.listingsCollected,
    imagesDownloaded: stats.imagesDownloaded,
    bytesDownloaded: stats.bytesDownloaded,
    errors: stats.errors.length,
    duration: stats.endTime
      ? stats.endTime.getTime() - stats.startTime.getTime()
      : 0,
  });

  console.log(`📊 Stats saved to S3: ${CONFIG.s3Prefix}/stats/daily/${date}.json`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// =============================================================================
// RUN
// =============================================================================

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
