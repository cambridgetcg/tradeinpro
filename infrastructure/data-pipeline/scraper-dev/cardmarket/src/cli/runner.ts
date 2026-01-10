#!/usr/bin/env node
/**
 * Production CLI Runner
 *
 * Command-line interface for running the Cardmarket scraper.
 * Supports:
 * - Single set or multiple sets scraping
 * - Output to S3 or local filesystem
 * - Configurable concurrency and delays
 * - Health checks and metrics reporting
 */

import { parseArgs } from 'node:util';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  CardmarketScraper,
  createScraper,
  type ScrapeResult,
  type ScrapeProgress,
} from '../scrapers/cardmarket-scraper.js';
import { HybridScraper, createHybridScraper } from '../scrapers/hybrid-scraper.js';
import { ONEPIECE_SETS } from '../config/sets.js';
import { S3Storage } from '../storage/s3-storage.js';
import {
  MetricsCollector,
  createConsoleHandler,
  ScraperMetrics,
} from '../monitoring/metrics.js';
import {
  HealthCheckManager,
  createConnectivityCheck,
  createMemoryCheck,
} from '../monitoring/health.js';
import { nowIso } from '../utils/index.js';

interface CliOptions {
  sets: string[];
  output: 'local' | 's3';
  outputDir: string;
  s3Bucket?: string;
  mode: 'http' | 'browser' | 'hybrid';
  maxCards: number;
  maxPages: number;
  delay: number;
  concurrency: number;
  includeArticles: boolean;
  healthCheck: boolean;
  verbose: boolean;
  dryRun: boolean;
}

const DEFAULT_OPTIONS: CliOptions = {
  sets: [],
  output: 'local',
  outputDir: './output',
  mode: 'http',
  maxCards: Infinity,
  maxPages: Infinity,
  delay: 2000,
  concurrency: 5,
  includeArticles: true,
  healthCheck: true,
  verbose: false,
  dryRun: false,
};

/**
 * Parse command line arguments
 */
function parseCliArgs(): CliOptions {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      sets: { type: 'string', short: 's', multiple: true, default: [] },
      output: { type: 'string', short: 'o', default: 'local' },
      'output-dir': { type: 'string', default: './output' },
      's3-bucket': { type: 'string' },
      mode: { type: 'string', short: 'm', default: 'http' },
      'max-cards': { type: 'string', default: '0' },
      'max-pages': { type: 'string', default: '0' },
      delay: { type: 'string', short: 'd', default: '2000' },
      concurrency: { type: 'string', short: 'c', default: '5' },
      'include-articles': { type: 'boolean', default: true },
      'health-check': { type: 'boolean', default: true },
      verbose: { type: 'boolean', short: 'v', default: false },
      'dry-run': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h' },
      'list-sets': { type: 'boolean' },
    },
    allowPositionals: true,
  });

  // Handle help
  if (values.help) {
    printHelp();
    process.exit(0);
  }

  // Handle list-sets
  if (values['list-sets']) {
    printSets();
    process.exit(0);
  }

  // Combine positionals with --sets
  const sets = [
    ...(values.sets as string[] || []),
    ...positionals,
  ];

  // Default to all sets if none specified
  const finalSets = sets.length > 0 ? sets : Object.keys(ONEPIECE_SETS);

  return {
    sets: finalSets,
    output: (values.output as 'local' | 's3') || 'local',
    outputDir: values['output-dir'] as string || './output',
    s3Bucket: values['s3-bucket'] as string | undefined,
    mode: (values.mode as 'http' | 'browser' | 'hybrid') || 'http',
    maxCards: parseInt(values['max-cards'] as string, 10) || Infinity,
    maxPages: parseInt(values['max-pages'] as string, 10) || Infinity,
    delay: parseInt(values.delay as string, 10) || 2000,
    concurrency: parseInt(values.concurrency as string, 10) || 5,
    includeArticles: values['include-articles'] !== false,
    healthCheck: values['health-check'] !== false,
    verbose: !!values.verbose,
    dryRun: !!values['dry-run'],
  };
}

/**
 * Print help message
 */
function printHelp(): void {
  console.log(`
Cardmarket Scraper CLI

Usage: npx tsx src/cli/runner.ts [options] [sets...]

Options:
  -s, --sets <codes>      Set codes to scrape (e.g., OP01 OP02)
  -o, --output <type>     Output type: local or s3 (default: local)
  --output-dir <path>     Local output directory (default: ./output)
  --s3-bucket <name>      S3 bucket name (required if output=s3)
  -m, --mode <mode>       Scraping mode: http, browser, or hybrid (default: http)
  --max-cards <n>         Maximum cards to scrape per set (default: all)
  --max-pages <n>         Maximum pages to scrape per set (default: all)
  -d, --delay <ms>        Delay between requests in ms (default: 2000)
  -c, --concurrency <n>   Maximum concurrent requests (default: 5)
  --include-articles      Include seller listings (default: true)
  --health-check          Run health checks before scraping (default: true)
  -v, --verbose           Enable verbose output
  --dry-run               Show what would be scraped without scraping
  --list-sets             List all available sets
  -h, --help              Show this help message

Examples:
  # Scrape all sets to local directory
  npx tsx src/cli/runner.ts

  # Scrape specific sets
  npx tsx src/cli/runner.ts OP01 OP02 OP03

  # Scrape to S3 with browser mode
  npx tsx src/cli/runner.ts --output s3 --s3-bucket my-bucket --mode hybrid

  # Quick test with limits
  npx tsx src/cli/runner.ts OP01 --max-cards 10 --max-pages 1
`);
}

/**
 * Print available sets
 */
function printSets(): void {
  console.log('\nAvailable One Piece TCG Sets:\n');

  const categories = {
    booster: [] as string[],
    starter: [] as string[],
    promo: [] as string[],
    other: [] as string[],
  };

  for (const [code, config] of Object.entries(ONEPIECE_SETS)) {
    const line = `  ${code.padEnd(6)} ${config.cardmarketName.padEnd(30)} (${config.cardCount} cards)`;
    categories[config.type as keyof typeof categories]?.push(line) ||
      categories.other.push(line);
  }

  if (categories.booster.length > 0) {
    console.log('Booster Sets:');
    categories.booster.forEach((l) => console.log(l));
    console.log();
  }

  if (categories.starter.length > 0) {
    console.log('Starter Decks:');
    categories.starter.forEach((l) => console.log(l));
    console.log();
  }

  if (categories.promo.length > 0) {
    console.log('Promo Sets:');
    categories.promo.forEach((l) => console.log(l));
    console.log();
  }
}

/**
 * Run health checks
 */
async function runHealthChecks(): Promise<boolean> {
  console.log('\n🏥 Running health checks...\n');

  const healthManager = new HealthCheckManager();

  healthManager.register('cardmarket', createConnectivityCheck('https://www.cardmarket.com/en/OnePiece'));
  healthManager.register('memory', createMemoryCheck(256, 512));

  const health = await healthManager.runAll();

  for (const check of health.checks) {
    const icon = check.status === 'healthy' ? '✅' :
                 check.status === 'degraded' ? '⚠️' : '❌';
    console.log(`  ${icon} ${check.name}: ${check.message} (${check.latencyMs}ms)`);
  }

  console.log(`\nOverall status: ${health.status.toUpperCase()}\n`);

  return health.status !== 'unhealthy';
}

/**
 * Create progress reporter
 */
function createProgressReporter(verbose: boolean): (progress: ScrapeProgress) => void {
  let lastSet = '';

  return (progress: ScrapeProgress) => {
    if (progress.currentSet !== lastSet) {
      console.log(`\n📦 Scraping set: ${progress.currentSet}`);
      lastSet = progress.currentSet;
    }

    if (verbose) {
      process.stdout.write(
        `\r  Page ${progress.currentPage}/${progress.totalPages || '?'} | ` +
        `Cards: ${progress.cardsScraped} | ` +
        `Articles: ${progress.articlesScraped} | ` +
        `Errors: ${progress.errorsCount}`
      );
    }
  };
}

/**
 * Save results locally
 */
async function saveLocal(
  outputDir: string,
  setCode: string,
  result: ScrapeResult
): Promise<string> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${setCode}_${timestamp}.json`;
  const filepath = join(outputDir, setCode, filename);

  await mkdir(dirname(filepath), { recursive: true });

  const data = {
    metadata: {
      setCode,
      scrapedAt: nowIso(),
      cardCount: result.cards.length,
      articleCount: result.articles.length,
      stats: result.stats,
      errors: result.errors,
    },
    cards: result.cards,
    articles: result.articles,
  };

  await writeFile(filepath, JSON.stringify(data, null, 2));

  return filepath;
}

/**
 * Save results to S3
 */
async function saveS3(
  bucket: string,
  setCode: string,
  result: ScrapeResult
): Promise<string> {
  const storage = new S3Storage({ bucket });
  const scrapeId = `scrape_${Date.now()}`;

  const { key } = await storage.store(
    setCode,
    result.cards,
    result.articles,
    scrapeId
  );

  return `s3://${bucket}/${key}`;
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  console.log('\n🎴 Cardmarket Scraper v1.0.0\n');

  const options = parseCliArgs();

  // Validate sets
  const validSets: string[] = [];
  const invalidSets: string[] = [];

  for (const set of options.sets) {
    if (ONEPIECE_SETS[set]) {
      validSets.push(set);
    } else {
      invalidSets.push(set);
    }
  }

  if (invalidSets.length > 0) {
    console.error(`❌ Unknown sets: ${invalidSets.join(', ')}`);
    console.error('   Use --list-sets to see available sets');
    process.exit(1);
  }

  // Print configuration
  console.log('Configuration:');
  console.log(`  Sets: ${validSets.join(', ')}`);
  console.log(`  Mode: ${options.mode}`);
  console.log(`  Output: ${options.output}${options.s3Bucket ? ` (${options.s3Bucket})` : ''}`);
  console.log(`  Delay: ${options.delay}ms`);
  console.log(`  Max cards per set: ${options.maxCards === Infinity ? 'unlimited' : options.maxCards}`);
  console.log(`  Include articles: ${options.includeArticles}`);

  if (options.dryRun) {
    console.log('\n🏃 Dry run - not actually scraping');
    process.exit(0);
  }

  // Run health checks
  if (options.healthCheck) {
    const healthy = await runHealthChecks();
    if (!healthy) {
      console.error('❌ Health checks failed. Use --no-health-check to skip.');
      process.exit(1);
    }
  }

  // Setup metrics
  const metrics = new MetricsCollector({
    namespace: 'CardmarketScraper',
    dimensions: { Environment: process.env.NODE_ENV || 'development' },
  });
  metrics.addHandler(createConsoleHandler());
  const scraperMetrics = new ScraperMetrics(metrics);

  // Create scraper
  const scraper = createScraper({
    requestDelayMs: options.delay,
    maxConcurrency: options.concurrency,
  });

  const startTime = Date.now();
  const results: Map<string, ScrapeResult> = new Map();

  // Scrape each set
  for (const setCode of validSets) {
    console.log(`\n${'='.repeat(50)}`);
    console.log(`📦 Starting: ${setCode} (${ONEPIECE_SETS[setCode].cardmarketName})`);

    const result = await scraper.scrapeSet(setCode, {
      includeArticles: options.includeArticles,
      maxCardsPerSet: options.maxCards,
      maxPagesPerSet: options.maxPages,
      delayBetweenRequests: options.delay,
      onProgress: createProgressReporter(options.verbose),
    });

    results.set(setCode, result);

    // Record metrics
    scraperMetrics.recordCard(setCode);

    // Print summary
    console.log(`\n\n✅ ${setCode} complete:`);
    console.log(`   Cards: ${result.cards.length}`);
    console.log(`   Articles: ${result.articles.length}`);
    console.log(`   Pages: ${result.stats.pagesProcessed}`);
    console.log(`   Duration: ${(result.stats.duration / 1000).toFixed(1)}s`);
    console.log(`   Errors: ${result.errors.length}`);

    // Save results
    let savedPath: string;
    if (options.output === 's3' && options.s3Bucket) {
      savedPath = await saveS3(options.s3Bucket, setCode, result);
    } else {
      savedPath = await saveLocal(options.outputDir, setCode, result);
    }
    console.log(`   Saved: ${savedPath}`);

    // Print errors if verbose
    if (options.verbose && result.errors.length > 0) {
      console.log('\n   Errors:');
      for (const error of result.errors.slice(0, 5)) {
        console.log(`     - ${error}`);
      }
      if (result.errors.length > 5) {
        console.log(`     ... and ${result.errors.length - 5} more`);
      }
    }
  }

  // Final summary
  const totalDuration = Date.now() - startTime;
  let totalCards = 0;
  let totalArticles = 0;
  let totalErrors = 0;

  for (const result of results.values()) {
    totalCards += result.cards.length;
    totalArticles += result.articles.length;
    totalErrors += result.errors.length;
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log('📊 Final Summary:');
  console.log(`   Sets scraped: ${results.size}`);
  console.log(`   Total cards: ${totalCards}`);
  console.log(`   Total articles: ${totalArticles}`);
  console.log(`   Total errors: ${totalErrors}`);
  console.log(`   Total duration: ${(totalDuration / 1000).toFixed(1)}s`);
  console.log(`   Average per set: ${(totalDuration / results.size / 1000).toFixed(1)}s`);

  // Flush metrics
  await metrics.flush();

  console.log('\n✨ Done!\n');
}

// Run
main().catch((error) => {
  console.error('\n❌ Fatal error:', error);
  process.exit(1);
});
