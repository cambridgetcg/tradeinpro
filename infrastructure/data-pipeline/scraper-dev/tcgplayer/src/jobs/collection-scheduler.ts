/**
 * Collection Job Scheduler
 *
 * Orchestrates data collection from all sources:
 * - TCGAPIs listings (hourly)
 * - Social signals (every 2 hours)
 * - Tournament data (daily)
 * - Cross-platform prices (hourly)
 *
 * Uses cron-style scheduling with job tracking and error recovery.
 */

import type { GameCode } from '../config/games.js';

/**
 * Job configuration
 */
export interface JobConfig {
  name: string;
  type: JobType;
  schedule: string; // Cron expression
  enabled: boolean;
  games?: GameCode[];
  options?: Record<string, unknown>;
}

/**
 * Job types
 */
export type JobType = 'listings' | 'social_youtube' | 'social_reddit' | 'tournament' | 'cardmarket' | 'feature_refresh';

/**
 * Job status
 */
export type JobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

/**
 * Job execution result
 */
export interface JobResult {
  jobId: string;
  jobType: JobType;
  status: JobStatus;
  startedAt: Date;
  completedAt: Date | null;
  itemsProcessed: number;
  itemsTotal: number | null;
  errorCount: number;
  lastError: string | null;
  duration: number | null; // milliseconds
}

/**
 * Job execution context
 */
export interface JobContext {
  jobId: string;
  jobType: JobType;
  games: GameCode[];
  options: Record<string, unknown>;
  signal: AbortSignal;
  onProgress: (processed: number, total?: number) => void;
  onError: (error: Error) => void;
}

/**
 * Job handler function type
 */
export type JobHandler = (context: JobContext) => Promise<void>;

/**
 * Scheduled job instance
 */
interface ScheduledJob {
  config: JobConfig;
  handler: JobHandler;
  nextRun: Date;
  lastRun: Date | null;
  lastResult: JobResult | null;
  isRunning: boolean;
  abortController: AbortController | null;
}

/**
 * Cron parser result
 */
interface CronParts {
  minute: number[];
  hour: number[];
  dayOfMonth: number[];
  month: number[];
  dayOfWeek: number[];
}

/**
 * Collection Job Scheduler
 */
export class CollectionScheduler {
  private jobs: Map<string, ScheduledJob> = new Map();
  private handlers: Map<JobType, JobHandler> = new Map();
  private isRunning = false;
  private checkInterval: ReturnType<typeof setInterval> | null = null;
  private readonly CHECK_INTERVAL_MS = 60000; // Check every minute

  // Default games to process
  private readonly DEFAULT_GAMES: GameCode[] = ['onepiece', 'pokemon'];

  // Job result callbacks
  private onJobComplete?: (result: JobResult) => Promise<void>;
  private onJobError?: (jobId: string, error: Error) => Promise<void>;

  constructor(options?: {
    onJobComplete?: (result: JobResult) => Promise<void>;
    onJobError?: (jobId: string, error: Error) => Promise<void>;
  }) {
    this.onJobComplete = options?.onJobComplete;
    this.onJobError = options?.onJobError;
  }

  // ==================== Job Registration ====================

  /**
   * Register a job handler
   */
  registerHandler(type: JobType, handler: JobHandler): void {
    this.handlers.set(type, handler);
  }

  /**
   * Add a scheduled job
   */
  addJob(config: JobConfig): void {
    if (!this.handlers.has(config.type)) {
      throw new Error(`No handler registered for job type: ${config.type}`);
    }

    const job: ScheduledJob = {
      config,
      handler: this.handlers.get(config.type)!,
      nextRun: this.calculateNextRun(config.schedule),
      lastRun: null,
      lastResult: null,
      isRunning: false,
      abortController: null,
    };

    this.jobs.set(config.name, job);
  }

  /**
   * Remove a scheduled job
   */
  removeJob(name: string): void {
    const job = this.jobs.get(name);
    if (job?.isRunning) {
      job.abortController?.abort();
    }
    this.jobs.delete(name);
  }

  /**
   * Update job configuration
   */
  updateJob(name: string, updates: Partial<JobConfig>): void {
    const job = this.jobs.get(name);
    if (!job) {
      throw new Error(`Job not found: ${name}`);
    }

    job.config = { ...job.config, ...updates };
    if (updates.schedule) {
      job.nextRun = this.calculateNextRun(updates.schedule);
    }
  }

  // ==================== Scheduler Control ====================

  /**
   * Start the scheduler
   */
  start(): void {
    if (this.isRunning) return;

    this.isRunning = true;
    this.checkInterval = setInterval(() => this.checkAndRunJobs(), this.CHECK_INTERVAL_MS);

    // Run initial check
    this.checkAndRunJobs();

    console.log(`Scheduler started with ${this.jobs.size} jobs`);
  }

  /**
   * Stop the scheduler
   */
  async stop(): Promise<void> {
    this.isRunning = false;

    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }

    // Cancel all running jobs
    const cancellations: Promise<void>[] = [];
    for (const [name, job] of this.jobs) {
      if (job.isRunning && job.abortController) {
        job.abortController.abort();
        cancellations.push(this.waitForJobCompletion(name, 30000));
      }
    }

    await Promise.all(cancellations);
    console.log('Scheduler stopped');
  }

  /**
   * Run a job immediately (manual trigger)
   */
  async runJobNow(name: string): Promise<JobResult> {
    const job = this.jobs.get(name);
    if (!job) {
      throw new Error(`Job not found: ${name}`);
    }

    if (job.isRunning) {
      throw new Error(`Job is already running: ${name}`);
    }

    return this.executeJob(name, job);
  }

  /**
   * Get job status
   */
  getJobStatus(name: string): {
    config: JobConfig;
    nextRun: Date;
    lastRun: Date | null;
    lastResult: JobResult | null;
    isRunning: boolean;
  } | null {
    const job = this.jobs.get(name);
    if (!job) return null;

    return {
      config: job.config,
      nextRun: job.nextRun,
      lastRun: job.lastRun,
      lastResult: job.lastResult,
      isRunning: job.isRunning,
    };
  }

  /**
   * Get all job statuses
   */
  getAllJobStatuses(): Map<string, ReturnType<typeof this.getJobStatus>> {
    const statuses = new Map();
    for (const name of this.jobs.keys()) {
      statuses.set(name, this.getJobStatus(name));
    }
    return statuses;
  }

  // ==================== Job Execution ====================

  /**
   * Check for due jobs and run them
   */
  private checkAndRunJobs(): void {
    const now = new Date();

    for (const [name, job] of this.jobs) {
      if (!job.config.enabled || job.isRunning) continue;

      if (now >= job.nextRun) {
        // Run job asynchronously
        this.executeJob(name, job).catch((error) => {
          console.error(`Job ${name} failed:`, error);
        });
      }
    }
  }

  /**
   * Execute a single job
   */
  private async executeJob(name: string, job: ScheduledJob): Promise<JobResult> {
    const jobId = `${name}-${Date.now()}`;
    const startedAt = new Date();

    job.isRunning = true;
    job.abortController = new AbortController();

    let itemsProcessed = 0;
    let itemsTotal: number | null = null;
    let errorCount = 0;
    let lastError: string | null = null;
    let status: JobStatus = 'running';

    const context: JobContext = {
      jobId,
      jobType: job.config.type,
      games: job.config.games || this.DEFAULT_GAMES,
      options: job.config.options || {},
      signal: job.abortController.signal,
      onProgress: (processed, total) => {
        itemsProcessed = processed;
        if (total !== undefined) itemsTotal = total;
      },
      onError: (error) => {
        errorCount++;
        lastError = error.message;
        console.error(`Job ${name} error:`, error.message);
      },
    };

    try {
      console.log(`Starting job: ${name} (${jobId})`);
      await job.handler(context);
      status = 'completed';
    } catch (error) {
      if (job.abortController.signal.aborted) {
        status = 'cancelled';
      } else {
        status = 'failed';
        lastError = error instanceof Error ? error.message : String(error);
        console.error(`Job ${name} failed:`, error);

        if (this.onJobError) {
          await this.onJobError(jobId, error instanceof Error ? error : new Error(String(error)));
        }
      }
    } finally {
      const completedAt = new Date();
      job.isRunning = false;
      job.abortController = null;
      job.lastRun = completedAt;
      job.nextRun = this.calculateNextRun(job.config.schedule);

      const result: JobResult = {
        jobId,
        jobType: job.config.type,
        status,
        startedAt,
        completedAt,
        itemsProcessed,
        itemsTotal,
        errorCount,
        lastError,
        duration: completedAt.getTime() - startedAt.getTime(),
      };

      job.lastResult = result;

      if (this.onJobComplete) {
        await this.onJobComplete(result);
      }

      console.log(`Job ${name} ${status}: ${itemsProcessed} items, ${errorCount} errors, ${result.duration}ms`);
      return result;
    }
  }

  /**
   * Wait for a job to complete
   */
  private async waitForJobCompletion(name: string, timeoutMs: number): Promise<void> {
    const start = Date.now();
    const job = this.jobs.get(name);

    while (job?.isRunning && Date.now() - start < timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  // ==================== Cron Parsing ====================

  /**
   * Parse cron expression and calculate next run time
   */
  private calculateNextRun(cron: string): Date {
    const parts = this.parseCron(cron);
    const now = new Date();
    const next = new Date(now);

    // Start from next minute
    next.setSeconds(0);
    next.setMilliseconds(0);
    next.setMinutes(next.getMinutes() + 1);

    // Find next matching time (up to 1 year ahead)
    const maxIterations = 525600; // Minutes in a year
    for (let i = 0; i < maxIterations; i++) {
      if (this.matchesCron(next, parts)) {
        return next;
      }
      next.setMinutes(next.getMinutes() + 1);
    }

    // Fallback: 1 hour from now
    return new Date(now.getTime() + 3600000);
  }

  /**
   * Parse cron expression into parts
   */
  private parseCron(cron: string): CronParts {
    const parts = cron.trim().split(/\s+/);
    if (parts.length !== 5) {
      throw new Error(`Invalid cron expression: ${cron}`);
    }

    return {
      minute: this.parseCronField(parts[0], 0, 59),
      hour: this.parseCronField(parts[1], 0, 23),
      dayOfMonth: this.parseCronField(parts[2], 1, 31),
      month: this.parseCronField(parts[3], 1, 12),
      dayOfWeek: this.parseCronField(parts[4], 0, 6),
    };
  }

  /**
   * Parse a single cron field
   */
  private parseCronField(field: string, min: number, max: number): number[] {
    const values: number[] = [];

    // Handle wildcards
    if (field === '*') {
      for (let i = min; i <= max; i++) values.push(i);
      return values;
    }

    // Handle step values (*/5)
    if (field.startsWith('*/')) {
      const step = parseInt(field.slice(2), 10);
      for (let i = min; i <= max; i += step) values.push(i);
      return values;
    }

    // Handle comma-separated values
    const parts = field.split(',');
    for (const part of parts) {
      // Handle ranges (1-5)
      if (part.includes('-')) {
        const [start, end] = part.split('-').map((n) => parseInt(n, 10));
        for (let i = start; i <= end; i++) values.push(i);
      } else {
        values.push(parseInt(part, 10));
      }
    }

    return [...new Set(values)].sort((a, b) => a - b);
  }

  /**
   * Check if a date matches cron parts
   */
  private matchesCron(date: Date, parts: CronParts): boolean {
    return (
      parts.minute.includes(date.getMinutes()) &&
      parts.hour.includes(date.getHours()) &&
      parts.dayOfMonth.includes(date.getDate()) &&
      parts.month.includes(date.getMonth() + 1) &&
      parts.dayOfWeek.includes(date.getDay())
    );
  }
}

// ==================== Default Job Configurations ====================

/**
 * Default job configurations for gap-filling
 */
export const DEFAULT_JOBS: JobConfig[] = [
  {
    name: 'listings-hourly',
    type: 'listings',
    schedule: '0 * * * *', // Every hour at :00
    enabled: true,
    games: ['onepiece', 'pokemon'],
    options: {
      batchSize: 100,
      priorityCardsOnly: false,
    },
  },
  {
    name: 'youtube-signals',
    type: 'social_youtube',
    schedule: '30 */2 * * *', // Every 2 hours at :30
    enabled: true,
    games: ['onepiece', 'pokemon', 'mtg', 'yugioh'],
    options: {
      hoursBack: 24,
      maxResults: 25,
    },
  },
  {
    name: 'reddit-signals',
    type: 'social_reddit',
    schedule: '15 */2 * * *', // Every 2 hours at :15
    enabled: true,
    games: ['onepiece', 'pokemon', 'mtg', 'yugioh'],
    options: {
      hoursBack: 24,
      limitPerSub: 100,
    },
  },
  {
    name: 'tournament-daily',
    type: 'tournament',
    schedule: '0 6 * * *', // Daily at 6 AM
    enabled: true,
    games: ['onepiece', 'pokemon', 'digimon'],
    options: {
      daysBack: 7,
      topCut: 32,
    },
  },
  {
    name: 'cardmarket-hourly',
    type: 'cardmarket',
    schedule: '45 * * * *', // Every hour at :45
    enabled: true,
    games: ['onepiece', 'pokemon'],
    options: {
      priorityCardsOnly: true,
      maxCards: 100,
    },
  },
  {
    name: 'feature-refresh',
    type: 'feature_refresh',
    schedule: '*/15 * * * *', // Every 15 minutes
    enabled: true,
    games: ['onepiece', 'pokemon'],
    options: {
      refreshStale: true,
      maxAgeMinutes: 60,
    },
  },
];

/**
 * Create and configure a scheduler with default jobs
 */
export function createDefaultScheduler(
  handlers: Map<JobType, JobHandler>,
  options?: {
    onJobComplete?: (result: JobResult) => Promise<void>;
    onJobError?: (jobId: string, error: Error) => Promise<void>;
  }
): CollectionScheduler {
  const scheduler = new CollectionScheduler(options);

  // Register all handlers
  for (const [type, handler] of handlers) {
    scheduler.registerHandler(type, handler);
  }

  // Add default jobs
  for (const config of DEFAULT_JOBS) {
    if (handlers.has(config.type)) {
      scheduler.addJob(config);
    }
  }

  return scheduler;
}

export default CollectionScheduler;
