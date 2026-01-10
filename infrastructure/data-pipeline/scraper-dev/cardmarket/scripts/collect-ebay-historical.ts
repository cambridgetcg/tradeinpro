#!/usr/bin/env npx tsx
/**
 * eBay Historical Data Collection Script
 *
 * Collects 3 years of sold listings for One Piece TCG cards via SerpAPI.
 * Exhausts up to 2000 searches to gather comprehensive training data.
 *
 * Usage:
 *   npx tsx scripts/collect-ebay-historical.ts
 *   npx tsx scripts/collect-ebay-historical.ts --dry-run
 *   npx tsx scripts/collect-ebay-historical.ts --max-searches 500
 *
 * Environment:
 *   SERPAPI_KEY - Your SerpAPI key (required)
 *
 * Output:
 *   /tmp/serpapi-historical/historical-collection-{timestamp}.json
 *   /tmp/serpapi-historical/historical-collection-{timestamp}.ndjson
 */

// Load environment variables from .env file
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: join(__dirname, '..', '.env') });

import { createHistoricalCollector, CollectionProgress } from '../src/neural/sensory/serpapi/historical-collector.js';

// =============================================================================
// CONFIGURATION
// =============================================================================

interface CliOptions {
  maxSearches: number;
  yearsBack: number;
  dryRun: boolean;
  outputPath: string;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const options: CliOptions = {
    maxSearches: 2000,
    yearsBack: 3,
    dryRun: false,
    outputPath: '/tmp/serpapi-historical',
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--dry-run' || arg === '-d') {
      options.dryRun = true;
    } else if (arg === '--max-searches' || arg === '-m') {
      options.maxSearches = parseInt(args[++i], 10);
    } else if (arg === '--years' || arg === '-y') {
      options.yearsBack = parseInt(args[++i], 10);
    } else if (arg === '--output' || arg === '-o') {
      options.outputPath = args[++i];
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }

  return options;
}

function printHelp(): void {
  console.log(`
eBay Historical Data Collector
==============================

Collects sold listings for One Piece TCG cards via SerpAPI.

Usage:
  npx tsx scripts/collect-ebay-historical.ts [options]

Options:
  --max-searches, -m <n>   Maximum searches to execute (default: 2000)
  --years, -y <n>          Years of history to collect (default: 3)
  --dry-run, -d            Run without making API calls
  --output, -o <path>      Output directory (default: /tmp/serpapi-historical)
  --help, -h               Show this help message

Environment Variables:
  SERPAPI_KEY              Your SerpAPI API key (required)

Examples:
  # Full collection (2000 searches, 3 years)
  npx tsx scripts/collect-ebay-historical.ts

  # Test run without API calls
  npx tsx scripts/collect-ebay-historical.ts --dry-run

  # Limited collection
  npx tsx scripts/collect-ebay-historical.ts --max-searches 100 --years 1
  `);
}

// =============================================================================
// PROGRESS DISPLAY
// =============================================================================

function displayProgress(progress: CollectionProgress): void {
  const pct = ((progress.searchesCompleted / progress.totalSearches) * 100).toFixed(1);
  const bar = createProgressBar(progress.searchesCompleted, progress.totalSearches, 30);

  // Clear line and move cursor
  process.stdout.write('\r\x1b[K');
  process.stdout.write(
    `${bar} ${pct}% | ` +
    `🔍 ${progress.searchesCompleted}/${progress.totalSearches} | ` +
    `📦 ${progress.listingsCollected} listings | ` +
    `🃏 ${progress.cardsQueried} cards | ` +
    `⏱️  ETA: ${formatEta(progress.estimatedCompletion)}`
  );
}

function createProgressBar(current: number, total: number, width: number): string {
  const filled = Math.round((current / total) * width);
  const empty = width - filled;
  return `[${'█'.repeat(filled)}${'░'.repeat(empty)}]`;
}

function formatEta(date: Date | null): string {
  if (!date) return '--:--';
  const now = Date.now();
  const diff = date.getTime() - now;
  if (diff < 0) return '00:00';

  const minutes = Math.floor(diff / 60000);
  const seconds = Math.floor((diff % 60000) / 1000);

  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}h ${mins}m`;
  }

  return `${minutes}m ${seconds}s`;
}

// =============================================================================
// MAIN
// =============================================================================

async function main(): Promise<void> {
  const options = parseArgs();

  // Check for API key
  if (!process.env.SERPAPI_KEY && !options.dryRun) {
    console.error('\n❌ Error: SERPAPI_KEY environment variable not set.');
    console.error('   Set your SerpAPI key: export SERPAPI_KEY=your_key_here');
    console.error('   Or run with --dry-run to test without API calls.\n');
    process.exit(1);
  }

  console.log('\n');
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║   🎴 ONE PIECE TCG - EBAY HISTORICAL DATA COLLECTOR 🎴   ║');
  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log(`║  Max Searches:  ${String(options.maxSearches).padEnd(6)} (${options.dryRun ? 'DRY RUN' : 'LIVE'})`.padEnd(59) + '║');
  console.log(`║  Years Back:    ${options.yearsBack}`.padEnd(59) + '║');
  console.log(`║  Output Path:   ${options.outputPath.slice(0, 35)}...`.padEnd(59) + '║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log('\n');

  // Create collector
  const collector = createHistoricalCollector({
    maxSearches: options.maxSearches,
    yearsBack: options.yearsBack,
    dryRun: options.dryRun,
    outputPath: options.outputPath,
  });

  // Track progress
  let lastProgressUpdate = 0;

  try {
    const result = await collector.collect((progress) => {
      // Update display every 500ms
      const now = Date.now();
      if (now - lastProgressUpdate > 500) {
        displayProgress(progress);
        lastProgressUpdate = now;
      }
    });

    // Final newline after progress bar
    console.log('\n');

    // Summary stats
    console.log('\n📊 COLLECTION SUMMARY:');
    console.log('═'.repeat(50));

    console.log('\n🃏 Top Cards by Listings:');
    const cardCounts = Array.from(result.byCard.entries())
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 10);

    for (const [cardId, listings] of cardCounts) {
      const avgPrice = listings.reduce((s, l) => s + l.priceUsd, 0) / listings.length;
      console.log(`   ${cardId.padEnd(15)}: ${String(listings.length).padStart(4)} listings (avg $${avgPrice.toFixed(0)})`);
    }

    console.log('\n🎨 Variant Coverage:');
    for (const [variant, listings] of result.byVariant.entries()) {
      const indicator = listings.length < 50 ? '⚠️ ' : '✅';
      console.log(`   ${indicator} ${variant.padEnd(12)}: ${listings.length} listings`);
    }

    // Check critical gaps
    console.log('\n📋 Critical Gap Status:');
    const mangaCount = result.byVariant.get('manga')?.length || 0;
    const boxtopperCount = result.byVariant.get('boxtopper')?.length || 0;
    const leaderCount = result.byVariant.get('leader')?.length || 0;

    console.log(`   ${mangaCount > 0 ? '✅' : '❌'} Manga variants: ${mangaCount} (need more!)`);
    console.log(`   ${boxtopperCount > 0 ? '✅' : '❌'} Box toppers: ${boxtopperCount}`);
    console.log(`   ${leaderCount > 0 ? '✅' : '❌'} Leader alt arts: ${leaderCount}`);

    if (result.exportPath) {
      console.log(`\n💾 Data exported to:`);
      console.log(`   ${result.exportPath}`);
      console.log(`   ${result.exportPath.replace('.json', '.ndjson')}`);
    }

    // Suggest next steps
    console.log('\n📌 Next Steps:');
    console.log('   1. Upload NDJSON to S3 data lake');
    console.log('   2. Run training data pipeline');
    console.log('   3. Check variant coverage gaps');

    if (result.progress.errors.length > 0) {
      console.log(`\n⚠️  ${result.progress.errors.length} errors occurred. Check logs.`);
    }

    console.log('\n✨ Collection complete!\n');

  } catch (error) {
    console.error('\n❌ Collection failed:', error);
    process.exit(1);
  }
}

// Run
main().catch(console.error);
