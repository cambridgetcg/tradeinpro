/**
 * Gap Filling Entry Point
 *
 * Main entry point for the ML training data collection system.
 * Initializes all collectors, feature store, and job scheduler.
 *
 * Usage:
 *   npx tsx src/gap-filling-entry.ts
 *
 * Environment Variables Required:
 *   TCGAPIS_API_KEY     - TCGAPIs API key (listings)
 *   YOUTUBE_API_KEY     - YouTube Data API key (social)
 *   REDDIT_CLIENT_ID    - Reddit OAuth client ID (social)
 *   REDDIT_CLIENT_SECRET - Reddit OAuth client secret (social)
 *   LIMITLESS_API_KEY   - Limitless TCG API key (tournaments)
 *   APIFY_TOKEN         - Apify token (Cardmarket scraping)
 *   REDIS_URL           - Redis connection URL (feature store)
 *   DATABASE_URL        - PostgreSQL connection URL (storage)
 */

import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';

// Collectors
import {
  createTCGApisCollector,
  createYouTubeCollector,
  createRedditCollector,
  createLimitlessCollector,
  createCardmarketCollector,
} from './collectors/index.js';

// Feature store
import { createFeatureStore } from './features/index.js';

// Jobs
import {
  createDefaultScheduler,
  createAllHandlers,
  type JobResult,
} from './jobs/index.js';

/**
 * Environment configuration
 */
interface EnvConfig {
  // API Keys
  TCGAPIS_API_KEY: string;
  YOUTUBE_API_KEY: string;
  REDDIT_CLIENT_ID: string;
  REDDIT_CLIENT_SECRET: string;
  LIMITLESS_API_KEY: string;
  APIFY_TOKEN: string;

  // Infrastructure
  REDIS_URL: string;
  DATABASE_URL: string;
}

/**
 * Load and validate environment configuration
 */
function loadConfig(): EnvConfig {
  const required = [
    'TCGAPIS_API_KEY',
    'YOUTUBE_API_KEY',
    'REDDIT_CLIENT_ID',
    'REDDIT_CLIENT_SECRET',
    'LIMITLESS_API_KEY',
    'APIFY_TOKEN',
    'REDIS_URL',
    'DATABASE_URL',
  ];

  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    console.warn(`Warning: Missing environment variables: ${missing.join(', ')}`);
    console.warn('Some collectors may not function properly.');
  }

  return {
    TCGAPIS_API_KEY: process.env.TCGAPIS_API_KEY || '',
    YOUTUBE_API_KEY: process.env.YOUTUBE_API_KEY || '',
    REDDIT_CLIENT_ID: process.env.REDDIT_CLIENT_ID || '',
    REDDIT_CLIENT_SECRET: process.env.REDDIT_CLIENT_SECRET || '',
    LIMITLESS_API_KEY: process.env.LIMITLESS_API_KEY || '',
    APIFY_TOKEN: process.env.APIFY_TOKEN || '',
    REDIS_URL: process.env.REDIS_URL || 'redis://localhost:6379',
    DATABASE_URL: process.env.DATABASE_URL || '',
  };
}

/**
 * Initialize all collectors
 */
function initializeCollectors(config: EnvConfig) {
  return {
    listingCollector: createTCGApisCollector({
      apiKey: config.TCGAPIS_API_KEY,
    }),
    youtubeCollector: createYouTubeCollector({
      apiKey: config.YOUTUBE_API_KEY,
    }),
    redditCollector: createRedditCollector({
      clientId: config.REDDIT_CLIENT_ID,
      clientSecret: config.REDDIT_CLIENT_SECRET,
    }),
    tournamentCollector: createLimitlessCollector({
      apiKey: config.LIMITLESS_API_KEY,
    }),
    cardmarketCollector: createCardmarketCollector({
      apifyToken: config.APIFY_TOKEN,
    }),
  };
}

/**
 * Main entry point
 */
async function main() {
  console.log('='.repeat(60));
  console.log('TCG ML Training Data Collection System');
  console.log('='.repeat(60));
  console.log();

  // Load configuration
  const config = loadConfig();

  // Initialize database
  console.log('Initializing database connection...');
  const db = new PrismaClient();
  await db.$connect();
  console.log('✓ Database connected');

  // Initialize Redis
  console.log('Initializing Redis connection...');
  const redis = new Redis(config.REDIS_URL);
  const featureStore = createFeatureStore(redis);
  console.log('✓ Redis connected');

  // Initialize collectors
  console.log('Initializing collectors...');
  const collectors = initializeCollectors(config);
  console.log('✓ Collectors initialized');

  // Create job handlers
  console.log('Creating job handlers...');
  const handlers = createAllHandlers({
    ...collectors,
    featureStore,
    db: db as any, // Type assertion for Prisma client
  });
  console.log('✓ Job handlers created');

  // Create scheduler
  console.log('Creating scheduler...');
  const scheduler = createDefaultScheduler(handlers, {
    onJobComplete: async (result: JobResult) => {
      console.log(`[${new Date().toISOString()}] Job ${result.jobId} completed:`, {
        status: result.status,
        items: result.itemsProcessed,
        errors: result.errorCount,
        duration: `${result.duration}ms`,
      });

      // Store job result in database
      await db.collectionJob.create({
        data: {
          jobType: result.jobType,
          status: result.status,
          itemsProcessed: result.itemsProcessed,
          itemsTotal: result.itemsTotal,
          errorCount: result.errorCount,
          startedAt: result.startedAt,
          completedAt: result.completedAt,
          lastError: result.lastError,
        },
      });
    },
    onJobError: async (jobId: string, error: Error) => {
      console.error(`[${new Date().toISOString()}] Job ${jobId} error:`, error.message);
    },
  });
  console.log('✓ Scheduler created');

  // Start scheduler
  console.log();
  console.log('Starting scheduler...');
  scheduler.start();
  console.log('✓ Scheduler running');

  // Print status
  console.log();
  console.log('Scheduled Jobs:');
  console.log('-'.repeat(60));
  for (const [name, status] of scheduler.getAllJobStatuses()) {
    if (status) {
      console.log(`  ${name}:`);
      console.log(`    Schedule: ${status.config.schedule}`);
      console.log(`    Enabled: ${status.config.enabled}`);
      console.log(`    Next run: ${status.nextRun.toISOString()}`);
    }
  }
  console.log();

  // Handle shutdown
  const shutdown = async () => {
    console.log();
    console.log('Shutting down...');
    await scheduler.stop();
    await featureStore.close();
    await db.$disconnect();
    redis.disconnect();
    console.log('✓ Shutdown complete');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Keep process alive
  console.log('Press Ctrl+C to stop');
}

// Run
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
