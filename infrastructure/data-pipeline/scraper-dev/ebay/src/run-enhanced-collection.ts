#!/usr/bin/env npx tsx
/**
 * Enhanced Image Collection Runner
 *
 * Uses optimized queries based on Cambridge TCG naming convention analysis.
 * Run with: npx tsx src/run-enhanced-collection.ts [options]
 *
 * Options:
 *   --priority=N      Run queries up to priority N (default: 2)
 *   --max-pages=N     Max pages per query (default: 3)
 *   --dry-run         Download but don't upload to S3
 *   --verbose         Show detailed progress
 *   --manga-only      Run only manga queries (critical gap)
 *   --high-value      Run only high-value card queries
 *
 * Created: 2026-01-09
 */

import * as dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  getAllQueries,
  getQueriesByPriority,
  getQueriesByVariant,
  HIGH_VALUE_CARD_QUERIES,
  VARIANT_TYPE_QUERIES,
  QUERY_STATS,
  type CollectionQuery,
} from './enhanced-queries.js';
import { Collector } from './pipeline/collector.js';
import { StorageManager } from './pipeline/storage.js';
import { DEFAULT_CONFIG, type PipelineConfig } from './pipeline/config.js';
import type { ParsedListing, ImageMetadata, DailyStats } from './pipeline/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: resolve(__dirname, '../.env') });

// ============================================================================
// CLI Argument Parsing
// ============================================================================

interface CliArgs {
  priority: number;
  maxPages: number;
  dryRun: boolean;
  verbose: boolean;
  mangaOnly: boolean;
  highValue: boolean;
  help: boolean;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const result: CliArgs = {
    priority: 2,      // Default to priority 1-2
    maxPages: 3,      // 3 pages = ~600 results per query
    dryRun: false,
    verbose: false,
    mangaOnly: false,
    highValue: false,
    help: false,
  };

  for (const arg of args) {
    if (arg === '--help' || arg === '-h') {
      result.help = true;
    } else if (arg === '--dry-run') {
      result.dryRun = true;
    } else if (arg === '--verbose' || arg === '-v') {
      result.verbose = true;
    } else if (arg === '--manga-only') {
      result.mangaOnly = true;
    } else if (arg === '--high-value') {
      result.highValue = true;
    } else if (arg.startsWith('--priority=')) {
      result.priority = parseInt(arg.split('=')[1], 10);
    } else if (arg.startsWith('--max-pages=')) {
      result.maxPages = parseInt(arg.split('=')[1], 10);
    }
  }

  return result;
}

function showHelp(): void {
  console.log(`
Enhanced Image Collection Pipeline
==================================

Uses optimized queries based on Cambridge TCG naming convention analysis.

Usage:
  npx tsx src/run-enhanced-collection.ts [options]

Options:
  --priority=N      Run queries up to priority N (1-4, default: 2)
  --max-pages=N     Max pages per query (default: 3)
  --dry-run         Download images but don't upload to S3
  --verbose, -v     Show detailed progress
  --manga-only      Run only manga queries (critical gap in training data)
  --high-value      Run only high-value card-specific queries
  --help, -h        Show this help message

Query Stats:
  Total queries:        ${QUERY_STATS.totalQueries}
  Priority 1 queries:   ${QUERY_STATS.priority1Count}
  Priority 2 queries:   ${QUERY_STATS.priority2Count}
  Expected volume:      ~${QUERY_STATS.totalExpectedVolume} listings
  Critical gaps:        ${QUERY_STATS.criticalGaps.join(', ')}

Examples:
  # Quick test with dry run
  npx tsx src/run-enhanced-collection.ts --priority=1 --max-pages=1 --dry-run --verbose

  # Run manga queries only (critical gap)
  npx tsx src/run-enhanced-collection.ts --manga-only --verbose

  # Full collection run (priority 1-2)
  npx tsx src/run-enhanced-collection.ts --priority=2 --verbose

  # High-value cards only
  npx tsx src/run-enhanced-collection.ts --high-value --verbose
`);
}

// ============================================================================
// Collection Runner
// ============================================================================

async function runCollection(args: CliArgs): Promise<void> {
  console.log('═'.repeat(70));
  console.log('ENHANCED IMAGE COLLECTION PIPELINE');
  console.log('Based on Cambridge TCG Naming Convention Analysis');
  console.log('═'.repeat(70));

  // Validate environment
  if (!process.env.SERPAPI_API_KEY) {
    console.error('❌ SERPAPI_API_KEY not set in .env');
    process.exit(1);
  }

  const config: PipelineConfig = {
    ...DEFAULT_CONFIG,
    serpApiKey: process.env.SERPAPI_API_KEY,
    s3Bucket: process.env.S3_BUCKET || 'tcg-training-data',
  };

  console.log(`\n📊 Configuration:`);
  console.log(`   S3 Bucket: ${config.s3Bucket}`);
  console.log(`   SerpApi Key: ${config.serpApiKey.substring(0, 20)}...`);
  console.log(`   Max Pages: ${args.maxPages}`);
  console.log(`   Dry Run: ${args.dryRun}`);

  // Select queries
  let queries: CollectionQuery[];

  if (args.mangaOnly) {
    queries = getQueriesByVariant('manga');
    console.log(`\n🎯 Mode: MANGA ONLY (${queries.length} queries)`);
  } else if (args.highValue) {
    queries = HIGH_VALUE_CARD_QUERIES;
    console.log(`\n🎯 Mode: HIGH-VALUE CARDS (${queries.length} queries)`);
  } else {
    queries = getQueriesByPriority(args.priority);
    console.log(`\n🎯 Mode: PRIORITY <= ${args.priority} (${queries.length} queries)`);
  }

  // Show queries
  console.log(`\n📋 Queries to run:`);
  for (const q of queries) {
    console.log(`   [P${q.priority}] ${q.name}: ~${q.expectedVolume} expected`);
  }

  const expectedTotal = queries.reduce((sum, q) => sum + q.expectedVolume, 0);
  console.log(`   Expected total: ~${expectedTotal} listings`);

  // Initialize components
  const collector = new Collector(config);
  const storage = new StorageManager(config);

  // Get processed IDs for deduplication
  const processedIds = await storage.getProcessedItemIds();
  console.log(`\n📦 Already processed: ${processedIds.size} items`);

  // Stats tracking
  const stats: DailyStats = {
    date: new Date().toISOString().split('T')[0],
    queriesRun: 0,
    listingsCollected: 0,
    imagesDownloaded: 0,
    bytesDownloaded: 0,
    errors: 0,
    duration: 0,
  };

  const startTime = Date.now();
  const errors: Array<{ query: string; error: string }> = [];

  // Process each query
  for (const queryConfig of queries) {
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`🔍 Query: ${queryConfig.name} [Priority ${queryConfig.priority}]`);
    console.log(`   "${queryConfig.query}"`);
    if (queryConfig.notes) {
      console.log(`   📝 ${queryConfig.notes}`);
    }

    try {
      // Fetch listings
      const listings = await collector.fetchAllPages(
        queryConfig.query,
        queryConfig.name,
        args.maxPages
      );

      console.log(`   Found ${listings.length} raw listings`);

      // Filter
      let filtered = collector.filterWithImages(listings);
      console.log(`   After image filter: ${filtered.length}`);

      filtered = collector.filterWithCardIds(filtered);
      console.log(`   After card ID filter: ${filtered.length}`);

      filtered = collector.filterNewListings(filtered, processedIds);
      console.log(`   After dedup filter: ${filtered.length}`);

      if (filtered.length === 0) {
        console.log(`   ⚠️  No new listings to process`);
        stats.queriesRun++;
        continue;
      }

      // Download images
      const resolutions = [500, 1600];
      console.log(`   Downloading images (${resolutions.join('px, ')}px)...`);

      const imageBuffers = await collector.downloadBatch(
        filtered,
        resolutions,
        args.verbose
          ? (completed, total) => {
              process.stdout.write(`\r   Progress: ${completed}/${total} images`);
            }
          : undefined
      );

      if (args.verbose) {
        console.log(); // New line after progress
      }

      // Upload to S3
      let totalBytes = 0;
      let totalImages = 0;
      const allImageMetadata: ImageMetadata[] = [];

      if (!args.dryRun) {
        for (const listing of filtered) {
          const images = imageBuffers.get(listing.ebayItemId);
          if (!images) continue;

          for (const [resolution, buffer] of images) {
            const metadata = await storage.uploadImage(buffer, listing, resolution);
            allImageMetadata.push(metadata);
            totalBytes += buffer.length;
            totalImages++;
          }

          // Update processed IDs
          processedIds.add(listing.ebayItemId);
        }

        // Save metadata
        await storage.saveListingsMetadata(filtered, queryConfig.name);
        await storage.updateManifest(filtered, allImageMetadata, queryConfig.name);

        console.log(`   ✅ Uploaded ${totalImages} images (${(totalBytes / 1024 / 1024).toFixed(2)} MB)`);
      } else {
        // Dry run - just count
        for (const [, images] of imageBuffers) {
          for (const [, buffer] of images) {
            totalBytes += buffer.length;
            totalImages++;
          }
        }
        console.log(`   🏃 DRY RUN: Would upload ${totalImages} images (${(totalBytes / 1024 / 1024).toFixed(2)} MB)`);
      }

      stats.queriesRun++;
      stats.listingsCollected += filtered.length;
      stats.imagesDownloaded += totalImages;
      stats.bytesDownloaded += totalBytes;

      // Log variant breakdown
      if (args.verbose) {
        const variantCounts: Record<string, number> = {};
        for (const listing of filtered) {
          const vt = listing.variantType || 'unknown';
          variantCounts[vt] = (variantCounts[vt] || 0) + 1;
        }
        console.log(`   Variants: ${JSON.stringify(variantCounts)}`);
      }

    } catch (error) {
      stats.errors++;
      const errorMsg = error instanceof Error ? error.message : String(error);
      errors.push({ query: queryConfig.name, error: errorMsg });
      console.log(`   ❌ Error: ${errorMsg}`);
    }

    // Rate limit delay
    await new Promise((r) => setTimeout(r, config.serpApiDelayMs));
  }

  stats.duration = Date.now() - startTime;

  // Save daily stats
  if (!args.dryRun) {
    await storage.saveDailyStats(stats);
  }

  // Summary
  console.log(`\n${'═'.repeat(70)}`);
  console.log('COLLECTION COMPLETE');
  console.log(`${'═'.repeat(70)}`);
  console.log(`   Queries run:     ${stats.queriesRun}`);
  console.log(`   Listings:        ${stats.listingsCollected}`);
  console.log(`   Images:          ${stats.imagesDownloaded}`);
  console.log(`   Total size:      ${(stats.bytesDownloaded / 1024 / 1024).toFixed(2)} MB`);
  console.log(`   Errors:          ${stats.errors}`);
  console.log(`   Duration:        ${(stats.duration / 1000).toFixed(1)}s`);

  if (errors.length > 0) {
    console.log(`\n❌ Errors:`);
    for (const err of errors) {
      console.log(`   ${err.query}: ${err.error}`);
    }
  }

  // Recommendations
  console.log(`\n💡 Recommendations:`);
  if (stats.listingsCollected === 0) {
    console.log(`   - Try increasing --max-pages or running with --priority=3`);
    console.log(`   - Check if queries are too restrictive`);
  } else {
    const avgPerQuery = stats.listingsCollected / stats.queriesRun;
    console.log(`   - Average ${avgPerQuery.toFixed(1)} listings per query`);
    if (avgPerQuery < 10) {
      console.log(`   - Consider broadening queries or increasing --max-pages`);
    }
  }
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const args = parseArgs();

  if (args.help) {
    showHelp();
    process.exit(0);
  }

  await runCollection(args);
}

main().catch((error) => {
  console.error('Pipeline error:', error);
  process.exit(1);
});
