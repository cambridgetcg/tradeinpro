#!/usr/bin/env npx tsx
/**
 * Image Collection CLI
 *
 * Usage:
 *   npx tsx src/collect-images.ts [options]
 *
 * Options:
 *   --queries=sec_en,parallel_en    Run specific queries
 *   --priority=2                     Run queries up to priority level
 *   --max-pages=5                    Max pages per query
 *   --resolutions=500,1600           Image resolutions to download
 *   --dry-run                        Don't upload to S3
 *   --verbose                        Show detailed progress
 *   --stats                          Show collection stats only
 *   --generate-labels                Generate training labels
 *
 * Examples:
 *   # Run all priority 1 queries
 *   npx tsx src/collect-images.ts --priority=1 --verbose
 *
 *   # Run specific queries in dry-run mode
 *   npx tsx src/collect-images.ts --queries=sec_en,manga_en --dry-run --verbose
 *
 *   # Generate training labels from collected data
 *   npx tsx src/collect-images.ts --generate-labels
 */

import * as dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { ImageCollectionPipeline, COLLECTION_QUERIES } from './pipeline/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: resolve(__dirname, '../.env') });

// ============================================================================
// CLI Argument Parsing
// ============================================================================

interface CliArgs {
  queries?: string[];
  priority?: number;
  maxPages?: number;
  resolutions?: number[];
  dryRun: boolean;
  verbose: boolean;
  showStats: boolean;
  generateLabels: boolean;
  help: boolean;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const result: CliArgs = {
    dryRun: false,
    verbose: false,
    showStats: false,
    generateLabels: false,
    help: false,
  };

  for (const arg of args) {
    if (arg === '--help' || arg === '-h') {
      result.help = true;
    } else if (arg === '--dry-run') {
      result.dryRun = true;
    } else if (arg === '--verbose' || arg === '-v') {
      result.verbose = true;
    } else if (arg === '--stats') {
      result.showStats = true;
    } else if (arg === '--generate-labels') {
      result.generateLabels = true;
    } else if (arg.startsWith('--queries=')) {
      result.queries = arg.split('=')[1].split(',');
    } else if (arg.startsWith('--priority=')) {
      result.priority = parseInt(arg.split('=')[1], 10);
    } else if (arg.startsWith('--max-pages=')) {
      result.maxPages = parseInt(arg.split('=')[1], 10);
    } else if (arg.startsWith('--resolutions=')) {
      result.resolutions = arg.split('=')[1].split(',').map(Number);
    }
  }

  return result;
}

function showHelp(): void {
  console.log(`
Image Collection Pipeline CLI

Usage:
  npx tsx src/collect-images.ts [options]

Options:
  --queries=name1,name2    Run specific queries by name
  --priority=N             Run queries with priority <= N (default: all)
  --max-pages=N            Max pages per query (default: 5)
  --resolutions=500,1600   Image resolutions to download
  --dry-run                Fetch and download but don't upload to S3
  --verbose, -v            Show detailed progress
  --stats                  Show collection statistics only
  --generate-labels        Generate training labels from collected data
  --help, -h               Show this help message

Available Queries:
${COLLECTION_QUERIES.map((q) => `  ${q.name.padEnd(20)} [P${q.priority}] ${q.query.substring(0, 45)}...`).join('\n')}

Examples:
  # Quick test with dry run
  npx tsx src/collect-images.ts --queries=sec_en --max-pages=1 --dry-run --verbose

  # Run high-priority queries (production)
  npx tsx src/collect-images.ts --priority=2 --verbose

  # View collection stats
  npx tsx src/collect-images.ts --stats
`);
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

  // Validate environment
  if (!process.env.SERPAPI_API_KEY) {
    console.error('❌ SERPAPI_API_KEY not set in .env');
    process.exit(1);
  }

  const s3Bucket = process.env.S3_BUCKET || 'tcg-training-data';

  console.log('═'.repeat(60));
  console.log('One Piece TCG Image Collection Pipeline');
  console.log('═'.repeat(60));
  console.log(`S3 Bucket: ${s3Bucket}`);
  console.log(`SerpApi Key: ${process.env.SERPAPI_API_KEY.substring(0, 20)}...`);

  // Initialize pipeline
  const pipeline = new ImageCollectionPipeline({
    s3Bucket,
    serpApiKey: process.env.SERPAPI_API_KEY,
  });

  // Show stats only
  if (args.showStats) {
    console.log('\n📊 Collection Statistics');
    console.log('─'.repeat(60));

    try {
      const stats = await pipeline.getStats();

      console.log(`Total Listings: ${stats.totalListings.toLocaleString()}`);
      console.log(`Total Images: ${stats.totalImages.toLocaleString()}`);
      console.log(`Total Size: ${(stats.totalSizeBytes / 1024 / 1024).toFixed(2)} MB`);
      console.log(`Date Range: ${stats.dateRange.earliest || 'N/A'} to ${stats.dateRange.latest || 'N/A'}`);

      console.log('\nBy Variant Type:');
      for (const [variant, count] of Object.entries(stats.byVariantType)) {
        console.log(`  ${variant}: ${count}`);
      }

      console.log('\nBy Language:');
      for (const [lang, count] of Object.entries(stats.byLanguage)) {
        console.log(`  ${lang}: ${count}`);
      }

      console.log('\nGraded vs Raw:');
      console.log(`  Graded: ${stats.byGraded.graded}`);
      console.log(`  Raw: ${stats.byGraded.raw}`);

      console.log('\nTop Cards by Count:');
      const topCards = Object.entries(stats.byCardId)
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, 10);
      for (const [cardId, data] of topCards) {
        console.log(`  ${cardId}: ${data.count} listings (avg: $${data.avgPrice.toFixed(2)})`);
      }
    } catch (error) {
      console.log('No stats available yet. Run collection first.');
    }

    process.exit(0);
  }

  // Generate labels only
  if (args.generateLabels) {
    console.log('\n🏷️  Generating Training Labels');
    console.log('─'.repeat(60));

    try {
      await pipeline.generateLabels();
      console.log('✅ Labels generated successfully');
    } catch (error) {
      console.error('❌ Error generating labels:', error);
      process.exit(1);
    }

    process.exit(0);
  }

  // Run collection
  console.log('\n🚀 Starting Collection');
  console.log('─'.repeat(60));

  if (args.dryRun) {
    console.log('⚠️  DRY RUN MODE - No uploads to S3');
  }

  const result = await pipeline.run({
    queries: args.queries,
    priority: args.priority,
    maxPagesPerQuery: args.maxPages,
    resolutions: args.resolutions,
    dryRun: args.dryRun,
    verbose: args.verbose,
  });

  // Show errors if any
  if (result.errors.length > 0) {
    console.log('\n❌ Errors:');
    for (const err of result.errors) {
      console.log(`   ${err.query}: ${err.error}`);
    }
  }

  process.exit(result.success ? 0 : 1);
}

main().catch((error) => {
  console.error('Pipeline error:', error);
  process.exit(1);
});
