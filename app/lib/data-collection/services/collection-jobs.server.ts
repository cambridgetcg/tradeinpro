/**
 * Collection Jobs Service
 *
 * Scheduled jobs for data collection:
 * - OPTCG price sync (every 4 hours)
 * - JustTCG full refresh (daily)
 * - JustTCG top movers (every 2 hours)
 * - Cardmarket CSV processing (when uploaded)
 * - FX rates refresh (every hour)
 * - Arbitrage detection (every 30 minutes)
 */

import type {
  CollectionJobConfig,
  CollectionJobResult,
  OPTCGCard,
  JustTCGCard,
  CardmarketCSVRow,
} from "../types";

import {
  getOPTCGClient,
  getJustTCGClient,
  getFXRateClient,
  parseCardmarketCSV,
} from "../clients";

import {
  aggregatePrices,
  processAndStorePrices,
} from "./price-aggregator.server";

// =============================================================================
// JOB CONFIGURATIONS
// =============================================================================

export const JOB_CONFIGS: Record<string, CollectionJobConfig> = {
  optcg_sync: {
    name: "OPTCG Price Sync",
    enabled: true,
    intervalMs: 4 * 60 * 60 * 1000, // 4 hours
    maxRetries: 3,
    timeoutMs: 5 * 60 * 1000, // 5 minutes
  },
  justtcg_full: {
    name: "JustTCG Full Refresh",
    enabled: true,
    intervalMs: 24 * 60 * 60 * 1000, // 24 hours
    maxRetries: 3,
    timeoutMs: 30 * 60 * 1000, // 30 minutes
  },
  justtcg_movers: {
    name: "JustTCG Top Movers",
    enabled: true,
    intervalMs: 2 * 60 * 60 * 1000, // 2 hours
    maxRetries: 3,
    timeoutMs: 5 * 60 * 1000, // 5 minutes
  },
  fx_rates: {
    name: "FX Rates Refresh",
    enabled: true,
    intervalMs: 60 * 60 * 1000, // 1 hour
    maxRetries: 3,
    timeoutMs: 30 * 1000, // 30 seconds
  },
  arbitrage_detection: {
    name: "Arbitrage Detection",
    enabled: true,
    intervalMs: 30 * 60 * 1000, // 30 minutes
    maxRetries: 2,
    timeoutMs: 10 * 60 * 1000, // 10 minutes
  },
};

// =============================================================================
// JOB STATE MANAGEMENT
// =============================================================================

interface JobState {
  lastRun?: Date;
  nextRun?: Date;
  isRunning: boolean;
  lastResult?: CollectionJobResult;
  consecutiveFailures: number;
}

const jobStates = new Map<string, JobState>();

/**
 * Get job state
 */
export function getJobState(jobName: string): JobState | undefined {
  return jobStates.get(jobName);
}

/**
 * Get all job states
 */
export function getAllJobStates(): Map<string, JobState> {
  return new Map(jobStates);
}

/**
 * Update job state
 */
function updateJobState(jobName: string, update: Partial<JobState>): void {
  const current = jobStates.get(jobName) || {
    isRunning: false,
    consecutiveFailures: 0,
  };
  jobStates.set(jobName, { ...current, ...update });
}

// =============================================================================
// JOB RUNNERS
// =============================================================================

/**
 * Run OPTCG price sync job
 */
export async function runOPTCGSync(): Promise<CollectionJobResult> {
  const jobName = "optcg_sync";
  const startedAt = new Date();

  updateJobState(jobName, { isRunning: true, lastRun: startedAt });

  try {
    const client = getOPTCGClient();
    const cards = await client.fetchAllCards();

    const result: CollectionJobResult = {
      jobName,
      startedAt,
      completedAt: new Date(),
      status: "success",
      recordsProcessed: cards.length,
      recordsCreated: 0, // Will be updated by storage
      recordsUpdated: cards.length,
      errorsCount: 0,
    };

    updateJobState(jobName, {
      isRunning: false,
      lastResult: result,
      consecutiveFailures: 0,
      nextRun: new Date(Date.now() + JOB_CONFIGS[jobName].intervalMs!),
    });

    return result;
  } catch (error) {
    const result: CollectionJobResult = {
      jobName,
      startedAt,
      completedAt: new Date(),
      status: "failed",
      recordsProcessed: 0,
      recordsCreated: 0,
      recordsUpdated: 0,
      errorsCount: 1,
      errors: [
        {
          message: error instanceof Error ? error.message : "Unknown error",
          details: error,
        },
      ],
    };

    const state = jobStates.get(jobName);
    updateJobState(jobName, {
      isRunning: false,
      lastResult: result,
      consecutiveFailures: (state?.consecutiveFailures || 0) + 1,
      nextRun: new Date(Date.now() + JOB_CONFIGS[jobName].intervalMs!),
    });

    return result;
  }
}

/**
 * Run JustTCG full refresh job
 */
export async function runJustTCGFullRefresh(
  onProgress?: (fetched: number, batch: number) => void
): Promise<CollectionJobResult> {
  const jobName = "justtcg_full";
  const startedAt = new Date();

  updateJobState(jobName, { isRunning: true, lastRun: startedAt });

  try {
    const client = getJustTCGClient();
    const cards = await client.fetchAllOnePieceCards(true, onProgress);

    const result: CollectionJobResult = {
      jobName,
      startedAt,
      completedAt: new Date(),
      status: "success",
      recordsProcessed: cards.length,
      recordsCreated: 0,
      recordsUpdated: cards.length,
      errorsCount: 0,
    };

    updateJobState(jobName, {
      isRunning: false,
      lastResult: result,
      consecutiveFailures: 0,
      nextRun: new Date(Date.now() + JOB_CONFIGS[jobName].intervalMs!),
    });

    return result;
  } catch (error) {
    const result: CollectionJobResult = {
      jobName,
      startedAt,
      completedAt: new Date(),
      status: "failed",
      recordsProcessed: 0,
      recordsCreated: 0,
      recordsUpdated: 0,
      errorsCount: 1,
      errors: [
        {
          message: error instanceof Error ? error.message : "Unknown error",
          details: error,
        },
      ],
    };

    const state = jobStates.get(jobName);
    updateJobState(jobName, {
      isRunning: false,
      lastResult: result,
      consecutiveFailures: (state?.consecutiveFailures || 0) + 1,
      nextRun: new Date(Date.now() + JOB_CONFIGS[jobName].intervalMs!),
    });

    return result;
  }
}

/**
 * Run JustTCG top movers job
 */
export async function runJustTCGTopMovers(): Promise<CollectionJobResult> {
  const jobName = "justtcg_movers";
  const startedAt = new Date();

  updateJobState(jobName, { isRunning: true, lastRun: startedAt });

  try {
    const client = getJustTCGClient();

    // Fetch top gainers and losers for each timeframe
    const results = await Promise.all([
      client.getTopMovers("24h", "gainers", 50),
      client.getTopMovers("24h", "losers", 50),
      client.getTopMovers("7d", "gainers", 50),
      client.getTopMovers("7d", "losers", 50),
    ]);

    const totalCards = results.flat().length;

    const result: CollectionJobResult = {
      jobName,
      startedAt,
      completedAt: new Date(),
      status: "success",
      recordsProcessed: totalCards,
      recordsCreated: 0,
      recordsUpdated: totalCards,
      errorsCount: 0,
    };

    updateJobState(jobName, {
      isRunning: false,
      lastResult: result,
      consecutiveFailures: 0,
      nextRun: new Date(Date.now() + JOB_CONFIGS[jobName].intervalMs!),
    });

    return result;
  } catch (error) {
    const result: CollectionJobResult = {
      jobName,
      startedAt,
      completedAt: new Date(),
      status: "failed",
      recordsProcessed: 0,
      recordsCreated: 0,
      recordsUpdated: 0,
      errorsCount: 1,
      errors: [
        {
          message: error instanceof Error ? error.message : "Unknown error",
          details: error,
        },
      ],
    };

    const state = jobStates.get(jobName);
    updateJobState(jobName, {
      isRunning: false,
      lastResult: result,
      consecutiveFailures: (state?.consecutiveFailures || 0) + 1,
      nextRun: new Date(Date.now() + JOB_CONFIGS[jobName].intervalMs!),
    });

    return result;
  }
}

/**
 * Run FX rates refresh job
 */
export async function runFXRatesRefresh(): Promise<CollectionJobResult> {
  const jobName = "fx_rates";
  const startedAt = new Date();

  updateJobState(jobName, { isRunning: true, lastRun: startedAt });

  try {
    const client = getFXRateClient();
    const rates = await client.getRates(true); // Force refresh

    const result: CollectionJobResult = {
      jobName,
      startedAt,
      completedAt: new Date(),
      status: "success",
      recordsProcessed: 1,
      recordsCreated: 1,
      recordsUpdated: 0,
      errorsCount: 0,
    };

    updateJobState(jobName, {
      isRunning: false,
      lastResult: result,
      consecutiveFailures: 0,
      nextRun: new Date(Date.now() + JOB_CONFIGS[jobName].intervalMs!),
    });

    return result;
  } catch (error) {
    const result: CollectionJobResult = {
      jobName,
      startedAt,
      completedAt: new Date(),
      status: "failed",
      recordsProcessed: 0,
      recordsCreated: 0,
      recordsUpdated: 0,
      errorsCount: 1,
      errors: [
        {
          message: error instanceof Error ? error.message : "Unknown error",
          details: error,
        },
      ],
    };

    const state = jobStates.get(jobName);
    updateJobState(jobName, {
      isRunning: false,
      lastResult: result,
      consecutiveFailures: (state?.consecutiveFailures || 0) + 1,
      nextRun: new Date(Date.now() + JOB_CONFIGS[jobName].intervalMs!),
    });

    return result;
  }
}

/**
 * Process Cardmarket CSV upload
 */
export async function processCardmarketCSV(
  csvContent: string
): Promise<CollectionJobResult> {
  const jobName = "cardmarket_csv";
  const startedAt = new Date();

  try {
    const parseResult = parseCardmarketCSV(csvContent);

    const result: CollectionJobResult = {
      jobName,
      startedAt,
      completedAt: new Date(),
      status: parseResult.errors.length > 0 ? "partial" : "success",
      recordsProcessed: parseResult.totalRows,
      recordsCreated: parseResult.validRows,
      recordsUpdated: 0,
      errorsCount: parseResult.errors.length,
      errors: parseResult.errors.slice(0, 10).map((e) => ({
        message: `Row ${e.row}: ${e.error}`,
      })),
    };

    return result;
  } catch (error) {
    return {
      jobName,
      startedAt,
      completedAt: new Date(),
      status: "failed",
      recordsProcessed: 0,
      recordsCreated: 0,
      recordsUpdated: 0,
      errorsCount: 1,
      errors: [
        {
          message: error instanceof Error ? error.message : "Unknown error",
          details: error,
        },
      ],
    };
  }
}

/**
 * Run full arbitrage detection job
 */
export async function runArbitrageDetection(
  prisma: PrismaClientType,
  usPrices: OPTCGCard[],
  justtcgPrices: JustTCGCard[],
  euPrices: CardmarketCSVRow[]
): Promise<CollectionJobResult> {
  const jobName = "arbitrage_detection";
  const startedAt = new Date();

  updateJobState(jobName, { isRunning: true, lastRun: startedAt });

  try {
    const aggregationResult = await aggregatePrices(
      usPrices,
      justtcgPrices,
      euPrices,
      { includeArbitrage: true }
    );

    const storageResult = await processAndStorePrices(prisma, aggregationResult);

    const result: CollectionJobResult = {
      jobName,
      startedAt,
      completedAt: new Date(),
      status: "success",
      recordsProcessed: aggregationResult.prices.length,
      recordsCreated: storageResult.arbitrageStored,
      recordsUpdated:
        storageResult.usPricesStored + storageResult.euPricesStored,
      errorsCount: 0,
    };

    updateJobState(jobName, {
      isRunning: false,
      lastResult: result,
      consecutiveFailures: 0,
      nextRun: new Date(Date.now() + JOB_CONFIGS[jobName].intervalMs!),
    });

    return result;
  } catch (error) {
    const result: CollectionJobResult = {
      jobName,
      startedAt,
      completedAt: new Date(),
      status: "failed",
      recordsProcessed: 0,
      recordsCreated: 0,
      recordsUpdated: 0,
      errorsCount: 1,
      errors: [
        {
          message: error instanceof Error ? error.message : "Unknown error",
          details: error,
        },
      ],
    };

    const state = jobStates.get(jobName);
    updateJobState(jobName, {
      isRunning: false,
      lastResult: result,
      consecutiveFailures: (state?.consecutiveFailures || 0) + 1,
      nextRun: new Date(Date.now() + JOB_CONFIGS[jobName].intervalMs!),
    });

    return result;
  }
}

// =============================================================================
// JOB SCHEDULER
// =============================================================================

const runningTimers = new Map<string, NodeJS.Timeout>();

/**
 * Start a scheduled job
 */
export function startScheduledJob(
  jobName: string,
  runner: () => Promise<CollectionJobResult>,
  config?: CollectionJobConfig
): void {
  const jobConfig = config || JOB_CONFIGS[jobName];

  if (!jobConfig) {
    throw new Error(`No configuration found for job: ${jobName}`);
  }

  if (!jobConfig.enabled) {
    console.log(`Job ${jobName} is disabled, skipping`);
    return;
  }

  // Clear any existing timer
  stopScheduledJob(jobName);

  // Schedule the job
  const timer = setInterval(async () => {
    const state = jobStates.get(jobName);

    // Skip if already running
    if (state?.isRunning) {
      console.log(`Job ${jobName} is already running, skipping`);
      return;
    }

    // Skip if too many consecutive failures
    if ((state?.consecutiveFailures || 0) >= (jobConfig.maxRetries || 3)) {
      console.warn(
        `Job ${jobName} has ${state?.consecutiveFailures} consecutive failures, pausing`
      );
      return;
    }

    try {
      console.log(`Starting job: ${jobName}`);
      const result = await runner();
      console.log(
        `Job ${jobName} completed: ${result.status}, processed ${result.recordsProcessed} records`
      );
    } catch (error) {
      console.error(
        `Job ${jobName} failed:`,
        error instanceof Error ? error.message : error
      );
    }
  }, jobConfig.intervalMs);

  runningTimers.set(jobName, timer);
  console.log(
    `Scheduled job ${jobName} to run every ${jobConfig.intervalMs! / 1000 / 60} minutes`
  );
}

/**
 * Stop a scheduled job
 */
export function stopScheduledJob(jobName: string): void {
  const timer = runningTimers.get(jobName);
  if (timer) {
    clearInterval(timer);
    runningTimers.delete(jobName);
    console.log(`Stopped job: ${jobName}`);
  }
}

/**
 * Stop all scheduled jobs
 */
export function stopAllScheduledJobs(): void {
  for (const jobName of runningTimers.keys()) {
    stopScheduledJob(jobName);
  }
}

/**
 * Get list of running jobs
 */
export function getRunningJobs(): string[] {
  return Array.from(runningTimers.keys());
}

/**
 * Initialize all default scheduled jobs
 */
export function initializeScheduledJobs(): void {
  // Note: In production, these would be started based on environment
  // For now, we provide the functions but don't auto-start

  console.log("Scheduled jobs module loaded. Call individual start functions to begin collection.");
}

// Type placeholder for Prisma client
type PrismaClientType = {
  fXRate: {
    create: (args: { data: Record<string, unknown> }) => Promise<unknown>;
  };
  marketPriceUS: {
    upsert: (args: {
      where: Record<string, unknown>;
      update: Record<string, unknown>;
      create: Record<string, unknown>;
    }) => Promise<unknown>;
  };
  marketPriceEU: {
    upsert: (args: {
      where: Record<string, unknown>;
      update: Record<string, unknown>;
      create: Record<string, unknown>;
    }) => Promise<unknown>;
  };
  arbitrageOpportunity: {
    create: (args: { data: Record<string, unknown> }) => Promise<unknown>;
  };
};
