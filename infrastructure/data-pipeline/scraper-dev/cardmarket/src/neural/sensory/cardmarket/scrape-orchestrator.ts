/**
 * CardMarket Scrape Orchestrator
 *
 * Coordinates systematic scraping of CardMarket for One Piece TCG data.
 * Manages rate limiting, scheduling, and data flow to the neural network.
 *
 * @see docs/CARDMARKET_ALCHEMIST_GRIMOIRE.md
 */

import { CardMarketUrlBuilder, cardMarketUrlBuilder } from './url-builder';
import {
  CardMarketTargetRegistry,
  cardMarketTargetRegistry,
  CardMarketTarget,
  ONE_PIECE_SETS,
  PriorityTier,
} from './target-cards';
import {
  CardmarketScraper,
  createScraper,
  type ScrapedCard,
} from '../../../scrapers/cardmarket-scraper.js';
import type { ScraperConfig } from '../../../config/index.js';
import type { ProxyConfig } from '../../../config/proxy.js';

// =============================================================================
// TYPES
// =============================================================================

export interface OrchestratorConfig {
  maxRequestsPerMinute: number;
  delayBetweenRequests: number;
  delayVariance: number;
  maxRetries: number;
  backoffMultiplier: number;
  sessionDurationMs: number;
  enablePriorityQueue: boolean;
  dryRun: boolean;
  scraperConfig?: Partial<ScraperConfig>;
  proxyConfig?: Partial<ProxyConfig>;
}

export interface ScrapeJob {
  id: string;
  url: string;
  cardId: string;
  variant: string;
  tier: PriorityTier;
  priority: number;
  retries: number;
  createdAt: Date;
  status: 'pending' | 'running' | 'completed' | 'failed';
}

export interface ScrapeResult {
  job: ScrapeJob;
  success: boolean;
  data?: CardMarketPriceData;
  error?: string;
  latencyMs: number;
  timestamp: Date;
}

export interface CardMarketPriceData {
  cardId: string;
  variant: string;
  url: string;

  // Price guide data (EUR)
  priceFromEur: number;
  priceTrendEur: number;
  priceAvg7Eur: number | null;
  priceAvg30Eur: number | null;

  // Market data
  availableItems: number;
  totalListings: number;

  // Price changes
  priceChange7d: number | null;
  priceChange30d: number | null;

  // Metadata
  scrapedAt: Date;
  language: string;
}

export interface ScheduleWindow {
  name: string;
  hour: number;
  tiers: PriorityTier[];
  description: string;
}

export interface ScrapeSession {
  id: string;
  startTime: Date;
  endTime?: Date;
  jobsCompleted: number;
  jobsFailed: number;
  totalJobs: number;
  status: 'running' | 'completed' | 'paused' | 'failed';
}

// =============================================================================
// CONSTANTS
// =============================================================================

const DEFAULT_CONFIG: OrchestratorConfig = {
  maxRequestsPerMinute: 30,
  delayBetweenRequests: 2000,
  delayVariance: 0.3,
  maxRetries: 3,
  backoffMultiplier: 2,
  sessionDurationMs: 600000, // 10 minutes
  enablePriorityQueue: true,
  dryRun: false,
};

const SCHEDULE_WINDOWS: ScheduleWindow[] = [
  {
    name: 'Morning Ritual',
    hour: 6,
    tiers: ['legendary'],
    description: 'Scrape all legendary tier cards',
  },
  {
    name: 'Midday Ritual',
    hour: 12,
    tiers: ['legendary', 'epic'],
    description: 'Scrape legendary and epic tiers',
  },
  {
    name: 'Evening Ritual',
    hour: 18,
    tiers: ['legendary', 'epic', 'rare'],
    description: 'Full sweep all tiers',
  },
  {
    name: 'Nightly Ritual',
    hour: 0,
    tiers: ['legendary', 'epic', 'rare', 'common'],
    description: 'Complete data refresh',
  },
];

// =============================================================================
// SCRAPE ORCHESTRATOR
// =============================================================================

export class CardMarketScrapeOrchestrator {
  private config: OrchestratorConfig;
  private urlBuilder: CardMarketUrlBuilder;
  private registry: CardMarketTargetRegistry;
  private scraper: CardmarketScraper;

  // Job queue
  private jobQueue: ScrapeJob[] = [];
  private activeJobs: Map<string, ScrapeJob> = new Map();
  private completedJobs: ScrapeResult[] = [];

  // Rate limiting
  private requestTimes: number[] = [];

  // Session management
  private currentSession: ScrapeSession | null = null;

  // Scheduling
  private scheduleTimer: NodeJS.Timeout | null = null;

  // Callbacks
  private onJobComplete?: (result: ScrapeResult) => void;
  private onSessionComplete?: (session: ScrapeSession) => void;

  constructor(config: Partial<OrchestratorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.urlBuilder = cardMarketUrlBuilder;
    this.registry = cardMarketTargetRegistry;

    // Initialize the CardMarket scraper with config
    this.scraper = createScraper(
      {
        requestsPerMinute: this.config.maxRequestsPerMinute,
        requestDelayMs: this.config.delayBetweenRequests,
        maxRetries: this.config.maxRetries,
        ...this.config.scraperConfig,
      },
      this.config.proxyConfig
    );
  }

  // ===========================================================================
  // LIFECYCLE
  // ===========================================================================

  /**
   * Initialize the orchestrator and test connection
   */
  async initialize(): Promise<void> {
    console.log('\n🔮 Initializing CardMarket Scrape Orchestrator...');

    // Test connection to CardMarket
    const connectionTest = await this.testConnection();
    if (connectionTest.success) {
      console.log(`✓ CardMarket connection successful (${connectionTest.latency}ms)`);
    } else {
      console.warn(`⚠ CardMarket connection warning: ${connectionTest.message}`);
    }

    console.log('✓ Orchestrator initialized');
  }

  async start(): Promise<void> {
    console.log('\n🔮 CARDMARKET SCRAPE ORCHESTRATOR AWAKENS');
    console.log('═'.repeat(50));
    this.registry.printSummary();
    console.log(`  Rate limit: ${this.config.maxRequestsPerMinute} req/min`);
    console.log(`  Delay: ${this.config.delayBetweenRequests}ms (±${this.config.delayVariance * 100}%)`);
    console.log(`  Dry run: ${this.config.dryRun}`);
    console.log(`  Scraper: ${this.scraper ? 'Connected' : 'Not initialized'}`);
    console.log('═'.repeat(50));

    // Start scheduler
    this.startScheduler();
  }

  async stop(): Promise<void> {
    console.log('\n🌙 CardMarket Orchestrator entering dormancy...');

    if (this.scheduleTimer) {
      clearInterval(this.scheduleTimer);
      this.scheduleTimer = null;
    }

    // Complete current session
    if (this.currentSession?.status === 'running') {
      this.currentSession.status = 'paused';
      this.currentSession.endTime = new Date();
    }

    this.printSessionSummary();
  }

  // ===========================================================================
  // JOB MANAGEMENT
  // ===========================================================================

  /**
   * Queue jobs for a list of target cards
   */
  queueTargets(targets: CardMarketTarget[]): void {
    for (const target of targets) {
      const job: ScrapeJob = {
        id: `job-${target.cardId}-${target.variant}-${Date.now()}`,
        url: this.urlBuilder.buildCardDetailUrl(target),
        cardId: target.cardId,
        variant: target.variant,
        tier: target.tier,
        priority: target.scrapePriority,
        retries: 0,
        createdAt: new Date(),
        status: 'pending',
      };

      this.jobQueue.push(job);
    }

    // Sort by priority if enabled
    if (this.config.enablePriorityQueue) {
      this.jobQueue.sort((a, b) => b.priority - a.priority);
    }

    console.log(`📋 Queued ${targets.length} jobs (total: ${this.jobQueue.length})`);
  }

  /**
   * Queue all cards for a specific tier
   */
  queueTier(tier: PriorityTier): void {
    const targets = this.registry.getByTier(tier);
    this.queueTargets(targets);
  }

  /**
   * Queue all critical gap cards
   */
  queueCriticalGaps(): void {
    const targets = this.registry.getCriticalGaps();
    this.queueTargets(targets);
  }

  /**
   * Queue all cards for a specific set
   */
  queueSet(setCode: string): void {
    const targets = this.registry.getBySet(setCode);
    this.queueTargets(targets);
  }

  // ===========================================================================
  // EXECUTION
  // ===========================================================================

  /**
   * Process the job queue
   */
  async processQueue(onProgress?: (progress: QueueProgress) => void): Promise<ScrapeSession> {
    this.currentSession = {
      id: `session-${Date.now()}`,
      startTime: new Date(),
      jobsCompleted: 0,
      jobsFailed: 0,
      totalJobs: this.jobQueue.length,
      status: 'running',
    };

    console.log(`\n🚀 Starting session: ${this.currentSession.id}`);
    console.log(`   Jobs to process: ${this.jobQueue.length}`);

    while (this.jobQueue.length > 0 && this.currentSession.status === 'running') {
      const job = this.jobQueue.shift()!;

      // Enforce rate limit
      await this.enforceRateLimit();

      // Process job
      const result = await this.processJob(job);

      if (result.success) {
        this.currentSession.jobsCompleted++;
      } else {
        // Retry logic
        if (job.retries < this.config.maxRetries) {
          job.retries++;
          job.status = 'pending';
          this.jobQueue.push(job); // Re-queue at end
        } else {
          this.currentSession.jobsFailed++;
        }
      }

      this.completedJobs.push(result);

      // Callback
      if (this.onJobComplete) {
        this.onJobComplete(result);
      }

      // Progress callback
      if (onProgress) {
        onProgress({
          completed: this.currentSession.jobsCompleted,
          failed: this.currentSession.jobsFailed,
          remaining: this.jobQueue.length,
          total: this.currentSession.totalJobs,
        });
      }

      // Random delay
      await this.randomDelay();
    }

    this.currentSession.status = 'completed';
    this.currentSession.endTime = new Date();

    if (this.onSessionComplete) {
      this.onSessionComplete(this.currentSession);
    }

    this.printSessionSummary();

    return this.currentSession;
  }

  /**
   * Process a single job
   */
  private async processJob(job: ScrapeJob): Promise<ScrapeResult> {
    const startTime = Date.now();
    job.status = 'running';
    this.activeJobs.set(job.id, job);

    const result: ScrapeResult = {
      job,
      success: false,
      latencyMs: 0,
      timestamp: new Date(),
    };

    if (this.config.dryRun) {
      console.log(`  [DRY] ${job.cardId} (${job.variant}): ${job.url.slice(0, 60)}...`);
      job.status = 'completed';
      result.success = true;
      result.latencyMs = 50;
      this.activeJobs.delete(job.id);
      return result;
    }

    try {
      // In real implementation, this would call the actual scraper
      // For now, we'll simulate the structure
      const data = await this.fetchCardData(job);
      result.data = data;
      result.success = true;
      job.status = 'completed';

      console.log(`  ✓ ${job.cardId} (${job.variant}): €${data.priceTrendEur}`);
    } catch (error) {
      result.error = String(error);
      job.status = 'failed';
      console.error(`  ✗ ${job.cardId} (${job.variant}): ${error}`);
    }

    result.latencyMs = Date.now() - startTime;
    this.activeJobs.delete(job.id);

    return result;
  }

  /**
   * Fetch card data from CardMarket using the integrated scraper
   */
  private async fetchCardData(job: ScrapeJob): Promise<CardMarketPriceData> {
    const result = await this.scraper.scrapeCard(job.url, { includeArticles: false });

    if (result.error) {
      throw new Error(result.error);
    }

    if (!result.card) {
      throw new Error(`No card data returned for ${job.cardId}`);
    }

    const card = result.card;

    return {
      cardId: job.cardId,
      variant: job.variant,
      url: job.url,
      priceFromEur: card.lowPrice ?? 0,
      priceTrendEur: card.trendPrice ?? 0,
      priceAvg7Eur: card.avg7Price,
      priceAvg30Eur: card.avg30Price,
      availableItems: card.availableCount ?? 0,
      totalListings: card.availableCount ?? 0,
      priceChange7d: card.priceChange7d,
      priceChange30d: card.priceChange30d,
      scrapedAt: new Date(card.scrapedAt),
      language: 'EN',
    };
  }

  /**
   * Test connection to CardMarket
   */
  async testConnection(): Promise<{ success: boolean; message: string; latency: number }> {
    return this.scraper.testConnection();
  }

  /**
   * Get scraper statistics
   */
  getScrapeStats(): { requests: ReturnType<CardmarketScraper['getRequestStats']>; parser: ReturnType<CardmarketScraper['getParserStats']> } {
    return {
      requests: this.scraper.getRequestStats(),
      parser: this.scraper.getParserStats(),
    };
  }

  /**
   * Reset scraper state
   */
  resetScraper(): void {
    this.scraper.reset();
  }

  // ===========================================================================
  // SCHEDULING
  // ===========================================================================

  private startScheduler(): void {
    // Check every minute
    this.scheduleTimer = setInterval(() => {
      this.checkSchedule();
    }, 60000);

    // Check immediately
    this.checkSchedule();
  }

  private checkSchedule(): void {
    const now = new Date();
    const currentHour = now.getUTCHours();
    const currentMinute = now.getUTCMinutes();

    // Only trigger at start of hour
    if (currentMinute !== 0) return;

    // Check each window
    for (const window of SCHEDULE_WINDOWS) {
      if (currentHour === window.hour) {
        console.log(`\n⏰ Scheduled window: ${window.name}`);
        this.runScheduledWindow(window);
        return;
      }
    }
  }

  private async runScheduledWindow(window: ScheduleWindow): Promise<void> {
    console.log(`   ${window.description}`);

    // Queue all tiers for this window
    for (const tier of window.tiers) {
      this.queueTier(tier);
    }

    // Process queue
    await this.processQueue();
  }

  // ===========================================================================
  // MANUAL RITUALS
  // ===========================================================================

  /**
   * Run morning ritual (legendary only)
   */
  async runMorningRitual(): Promise<ScrapeSession> {
    console.log('\n🌅 Running Morning Ritual (Legendary tier)');
    this.queueTier('legendary');
    return this.processQueue();
  }

  /**
   * Run midday ritual (legendary + epic)
   */
  async runMiddayRitual(): Promise<ScrapeSession> {
    console.log('\n☀️ Running Midday Ritual (Legendary + Epic)');
    this.queueTier('legendary');
    this.queueTier('epic');
    return this.processQueue();
  }

  /**
   * Run evening ritual (all tiers)
   */
  async runEveningRitual(): Promise<ScrapeSession> {
    console.log('\n🌆 Running Evening Ritual (All tiers)');
    this.queueTier('legendary');
    this.queueTier('epic');
    this.queueTier('rare');
    return this.processQueue();
  }

  /**
   * Run gap filling (critical gaps only)
   */
  async runGapFillRitual(): Promise<ScrapeSession> {
    console.log('\n🔧 Running Gap Fill Ritual (Critical gaps)');
    this.queueCriticalGaps();
    return this.processQueue();
  }

  // ===========================================================================
  // RATE LIMITING
  // ===========================================================================

  private async enforceRateLimit(): Promise<void> {
    const now = Date.now();
    const windowStart = now - 60000;

    // Remove old timestamps
    this.requestTimes = this.requestTimes.filter((t) => t > windowStart);

    // Check if at limit
    if (this.requestTimes.length >= this.config.maxRequestsPerMinute) {
      const oldestRequest = this.requestTimes[0];
      const waitTime = oldestRequest + 60000 - now;

      if (waitTime > 0) {
        console.log(`⏳ Rate limit: waiting ${waitTime}ms...`);
        await this.sleep(waitTime);
      }
    }

    this.requestTimes.push(now);
  }

  private async randomDelay(): Promise<void> {
    const variance = this.config.delayBetweenRequests * this.config.delayVariance;
    const delay = this.config.delayBetweenRequests + (Math.random() * 2 - 1) * variance;
    await this.sleep(delay);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ===========================================================================
  // CALLBACKS
  // ===========================================================================

  onJobCompleted(callback: (result: ScrapeResult) => void): void {
    this.onJobComplete = callback;
  }

  onSessionCompleted(callback: (session: ScrapeSession) => void): void {
    this.onSessionComplete = callback;
  }

  // ===========================================================================
  // STATISTICS
  // ===========================================================================

  getQueueStatus(): QueueStatus {
    return {
      pending: this.jobQueue.length,
      active: this.activeJobs.size,
      completed: this.completedJobs.filter((r) => r.success).length,
      failed: this.completedJobs.filter((r) => !r.success).length,
    };
  }

  getResults(): ScrapeResult[] {
    return [...this.completedJobs];
  }

  getSuccessfulResults(): ScrapeResult[] {
    return this.completedJobs.filter((r) => r.success);
  }

  private printSessionSummary(): void {
    if (!this.currentSession) return;

    const duration = this.currentSession.endTime
      ? (this.currentSession.endTime.getTime() - this.currentSession.startTime.getTime()) / 1000
      : 0;

    console.log('\n📊 SESSION SUMMARY');
    console.log('═'.repeat(50));
    console.log(`  Session ID: ${this.currentSession.id}`);
    console.log(`  Status: ${this.currentSession.status}`);
    console.log(`  Duration: ${duration.toFixed(1)}s`);
    console.log(`  Jobs completed: ${this.currentSession.jobsCompleted}`);
    console.log(`  Jobs failed: ${this.currentSession.jobsFailed}`);
    console.log(`  Success rate: ${((this.currentSession.jobsCompleted / this.currentSession.totalJobs) * 100).toFixed(1)}%`);
    console.log('═'.repeat(50));
  }

  /**
   * Clear completed jobs to free memory
   */
  clearCompletedJobs(): void {
    this.completedJobs = [];
  }
}

// =============================================================================
// TYPES
// =============================================================================

interface QueueProgress {
  completed: number;
  failed: number;
  remaining: number;
  total: number;
}

interface QueueStatus {
  pending: number;
  active: number;
  completed: number;
  failed: number;
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

export function createCardMarketOrchestrator(
  config: Partial<OrchestratorConfig> = {}
): CardMarketScrapeOrchestrator {
  return new CardMarketScrapeOrchestrator(config);
}

// =============================================================================
// SINGLETON
// =============================================================================

let orchestratorInstance: CardMarketScrapeOrchestrator | null = null;

export function getCardMarketOrchestrator(
  config?: Partial<OrchestratorConfig>
): CardMarketScrapeOrchestrator {
  if (!orchestratorInstance) {
    orchestratorInstance = createCardMarketOrchestrator(config);
  }
  return orchestratorInstance;
}
