/**
 * SerpAPI Query Orchestrator
 *
 * The Grand Alchemist - coordinates the daily rituals of data collection.
 * Schedules queries based on priority tiers and time windows.
 *
 * Daily Ritual Schedule:
 *   - 08:00 UTC (Morning Incantation): All Legendary + half Epic
 *   - 12:00 UTC (Midday Transmutation): All Legendary + other half Epic
 *   - 18:00 UTC (Evening Divination): Full sweep including Rare
 *
 * @see docs/SERPAPI_ALCHEMIST_GRIMOIRE.md
 */

import { SerpApiClient, QueryResult, ProcessedListing, ClientStats, createSerpApiClient } from './serpapi-client';
import { TargetCardRegistry, targetCardRegistry, TargetCard, CRITICAL_GAPS } from './target-cards';
import { ParsedTitle } from './title-parser';

// =============================================================================
// TYPES
// =============================================================================

export interface OrchestratorConfig {
  serpApiConfig?: Partial<import('./serpapi-client').SerpApiConfig>;
  scheduleEnabled: boolean;
  morningHourUtc: number;
  middayHourUtc: number;
  eveningHourUtc: number;
  gapFillEnabled: boolean;
  minListingsPerCard: number;
  dataOutputPath: string;
}

export interface ScheduleWindow {
  name: string;
  hour: number;
  cards: TargetCard[];
  priority: 'high' | 'medium' | 'low';
}

export interface CollectionBatch {
  id: string;
  window: ScheduleWindow;
  startTime: Date;
  endTime?: Date;
  results: QueryResult[];
  processedListings: ProcessedListing[];
  stats: BatchStats;
  status: 'pending' | 'running' | 'completed' | 'failed';
  errors: string[];
}

export interface BatchStats {
  totalQueries: number;
  successfulQueries: number;
  totalListings: number;
  usableListings: number;
  uniqueCards: number;
  byTier: Record<string, number>;
  byVariant: Record<string, number>;
  avgPriceUsd: number;
}

export interface DailyReport {
  date: string;
  batches: CollectionBatch[];
  totalListings: number;
  uniqueListings: number;
  cardsCovered: number;
  gapsIdentified: string[];
  recommendations: string[];
}

// =============================================================================
// CONSTANTS
// =============================================================================

const DEFAULT_CONFIG: OrchestratorConfig = {
  scheduleEnabled: true,
  morningHourUtc: 8,
  middayHourUtc: 12,
  eveningHourUtc: 18,
  gapFillEnabled: true,
  minListingsPerCard: 5,
  dataOutputPath: '/tmp/serpapi-collections',
};

// =============================================================================
// QUERY ORCHESTRATOR
// =============================================================================

export class QueryOrchestrator {
  private config: OrchestratorConfig;
  private client: SerpApiClient;
  private registry: TargetCardRegistry;

  // State
  private currentBatch: CollectionBatch | null = null;
  private dailyBatches: CollectionBatch[] = [];
  private cardCoverage: Map<string, number> = new Map();

  // Timers
  private scheduleTimer: NodeJS.Timeout | null = null;

  constructor(config: Partial<OrchestratorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.client = createSerpApiClient(this.config.serpApiConfig);
    this.registry = targetCardRegistry;
  }

  // ===========================================================================
  // LIFECYCLE
  // ===========================================================================

  /**
   * Start the orchestrator with automatic scheduling
   */
  async start(): Promise<void> {
    console.log('\n🔮 QUERY ORCHESTRATOR AWAKENS');
    console.log('═'.repeat(50));
    this.registry.printSummary();

    if (this.config.scheduleEnabled) {
      this.startScheduler();
      console.log('⏰ Automatic scheduling enabled');
      console.log(`   Morning: ${this.config.morningHourUtc}:00 UTC`);
      console.log(`   Midday: ${this.config.middayHourUtc}:00 UTC`);
      console.log(`   Evening: ${this.config.eveningHourUtc}:00 UTC`);
    }

    console.log('═'.repeat(50));
  }

  /**
   * Stop the orchestrator
   */
  async stop(): Promise<void> {
    console.log('\n🌙 Query Orchestrator entering dormancy...');

    if (this.scheduleTimer) {
      clearInterval(this.scheduleTimer);
      this.scheduleTimer = null;
    }

    // Wait for current batch to complete
    if (this.currentBatch?.status === 'running') {
      console.log('  Waiting for current batch to complete...');
      // In production, would await completion
    }

    this.printDailySummary();
    console.log('💤 Orchestrator dormant');
  }

  // ===========================================================================
  // SCHEDULING
  // ===========================================================================

  private startScheduler(): void {
    // Check every minute for scheduled windows
    this.scheduleTimer = setInterval(() => {
      this.checkSchedule();
    }, 60000);

    // Also check immediately
    this.checkSchedule();
  }

  private checkSchedule(): void {
    const now = new Date();
    const currentHour = now.getUTCHours();
    const currentMinute = now.getUTCMinutes();

    // Only trigger at the start of the hour (minute 0)
    if (currentMinute !== 0) return;

    // Check if it's a scheduled window
    if (currentHour === this.config.morningHourUtc) {
      this.runMorningBatch();
    } else if (currentHour === this.config.middayHourUtc) {
      this.runMiddayBatch();
    } else if (currentHour === this.config.eveningHourUtc) {
      this.runEveningBatch();
    }
  }

  // ===========================================================================
  // BATCH EXECUTION
  // ===========================================================================

  /**
   * Run morning collection batch (Legendary + half Epic)
   */
  async runMorningBatch(): Promise<CollectionBatch> {
    const schedule = this.registry.getQuerySchedule();
    return this.executeBatch({
      name: 'Morning Incantation',
      hour: this.config.morningHourUtc,
      cards: schedule.morning,
      priority: 'high',
    });
  }

  /**
   * Run midday collection batch (Legendary + other half Epic)
   */
  async runMiddayBatch(): Promise<CollectionBatch> {
    const schedule = this.registry.getQuerySchedule();
    return this.executeBatch({
      name: 'Midday Transmutation',
      hour: this.config.middayHourUtc,
      cards: schedule.midday,
      priority: 'high',
    });
  }

  /**
   * Run evening collection batch (Full sweep)
   */
  async runEveningBatch(): Promise<CollectionBatch> {
    const schedule = this.registry.getQuerySchedule();
    return this.executeBatch({
      name: 'Evening Divination',
      hour: this.config.eveningHourUtc,
      cards: schedule.evening,
      priority: 'medium',
    });
  }

  /**
   * Run a gap-filling batch for cards with insufficient data
   */
  async runGapFillBatch(): Promise<CollectionBatch> {
    const gaps = this.identifyGaps();
    const gapCards = this.registry.getCriticalGaps();

    return this.executeBatch({
      name: 'Gap Fill Ritual',
      hour: new Date().getUTCHours(),
      cards: gapCards,
      priority: 'high',
    });
  }

  /**
   * Run a custom batch with specific cards
   */
  async runCustomBatch(cards: TargetCard[], name: string = 'Custom Batch'): Promise<CollectionBatch> {
    return this.executeBatch({
      name,
      hour: new Date().getUTCHours(),
      cards,
      priority: 'low',
    });
  }

  private async executeBatch(window: ScheduleWindow): Promise<CollectionBatch> {
    const batch: CollectionBatch = {
      id: `batch-${Date.now()}`,
      window,
      startTime: new Date(),
      results: [],
      processedListings: [],
      stats: this.createEmptyStats(),
      status: 'pending',
      errors: [],
    };

    this.currentBatch = batch;
    batch.status = 'running';

    console.log(`\n🧪 Starting: ${window.name}`);
    console.log(`   Cards to query: ${window.cards.length}`);
    console.log(`   Priority: ${window.priority}`);

    try {
      // Execute queries for each card
      for (const card of window.cards) {
        try {
          const results = await this.client.searchCard(card);
          batch.results.push(...results);

          // Update coverage
          const usable = results.reduce((sum, r) => sum + r.usableResults, 0);
          const current = this.cardCoverage.get(card.cardId) || 0;
          this.cardCoverage.set(card.cardId, current + usable);

          batch.stats.totalQueries += results.length;
          batch.stats.successfulQueries += results.filter((r) => r.errors.length === 0).length;
        } catch (error) {
          batch.errors.push(`${card.cardId}: ${error}`);
        }
      }

      // Deduplicate and process listings
      batch.processedListings = this.client.deduplicateListings(batch.results);

      // Calculate statistics
      this.calculateBatchStats(batch);

      batch.status = 'completed';
      batch.endTime = new Date();

      // Store in daily batches
      this.dailyBatches.push(batch);

      console.log(`✅ ${window.name} complete!`);
      console.log(`   Total listings: ${batch.stats.totalListings}`);
      console.log(`   Usable listings: ${batch.stats.usableListings}`);
      console.log(`   Unique cards: ${batch.stats.uniqueCards}`);
      console.log(`   Duration: ${(batch.endTime.getTime() - batch.startTime.getTime()) / 1000}s`);

    } catch (error) {
      batch.status = 'failed';
      batch.errors.push(`Batch failed: ${error}`);
      console.error(`❌ ${window.name} failed:`, error);
    }

    this.currentBatch = null;
    return batch;
  }

  // ===========================================================================
  // STATISTICS
  // ===========================================================================

  private createEmptyStats(): BatchStats {
    return {
      totalQueries: 0,
      successfulQueries: 0,
      totalListings: 0,
      usableListings: 0,
      uniqueCards: 0,
      byTier: {},
      byVariant: {},
      avgPriceUsd: 0,
    };
  }

  private calculateBatchStats(batch: CollectionBatch): void {
    const stats = batch.stats;

    // Count totals
    for (const result of batch.results) {
      stats.totalListings += result.totalResults;
      stats.usableListings += result.usableResults;
    }

    // Analyze processed listings
    const cardIds = new Set<string>();
    const tiers: Record<string, number> = {};
    const variants: Record<string, number> = {};
    let totalPrice = 0;

    for (const listing of batch.processedListings) {
      const { parsed } = listing;

      if (parsed.cardId) {
        cardIds.add(parsed.cardId);
      }

      // Count by tier
      const tier = this.registry.getTier(parsed.cardId || '') || 'unknown';
      tiers[tier] = (tiers[tier] || 0) + 1;

      // Count by variant
      variants[parsed.variant] = (variants[parsed.variant] || 0) + 1;

      totalPrice += listing.priceUsd;
    }

    stats.uniqueCards = cardIds.size;
    stats.byTier = tiers;
    stats.byVariant = variants;
    stats.avgPriceUsd =
      batch.processedListings.length > 0
        ? totalPrice / batch.processedListings.length
        : 0;
  }

  // ===========================================================================
  // GAP ANALYSIS
  // ===========================================================================

  private identifyGaps(): string[] {
    const gaps: string[] = [];

    for (const card of this.registry.getByPriority()) {
      const coverage = this.cardCoverage.get(card.cardId) || 0;

      if (coverage < this.config.minListingsPerCard) {
        gaps.push(
          `${card.cardId} (${card.variant}): ${coverage}/${this.config.minListingsPerCard} listings`
        );
      }
    }

    return gaps;
  }

  // ===========================================================================
  // REPORTING
  // ===========================================================================

  /**
   * Generate daily report
   */
  generateDailyReport(): DailyReport {
    const today = new Date().toISOString().split('T')[0];

    // Aggregate all listings
    const allListings: ProcessedListing[] = [];
    for (const batch of this.dailyBatches) {
      allListings.push(...batch.processedListings);
    }

    // Deduplicate globally
    const uniqueListings = this.client.deduplicateListings(
      this.dailyBatches.flatMap((b) => b.results)
    );

    // Identify gaps
    const gaps = this.identifyGaps();

    // Generate recommendations
    const recommendations = this.generateRecommendations(gaps, uniqueListings);

    return {
      date: today,
      batches: this.dailyBatches,
      totalListings: allListings.length,
      uniqueListings: uniqueListings.length,
      cardsCovered: this.cardCoverage.size,
      gapsIdentified: gaps,
      recommendations,
    };
  }

  private generateRecommendations(gaps: string[], listings: ProcessedListing[]): string[] {
    const recommendations: string[] = [];

    // Gap-based recommendations
    if (gaps.length > 0) {
      recommendations.push(`Run gap-fill batch for ${gaps.length} under-represented cards`);
    }

    // Variant coverage
    const variantCounts: Record<string, number> = {};
    for (const listing of listings) {
      const v = listing.parsed.variant;
      variantCounts[v] = (variantCounts[v] || 0) + 1;
    }

    // Check critical gaps from registry
    if ((variantCounts['manga'] || 0) < 10) {
      recommendations.push('CRITICAL: Manga variant data severely lacking - increase query priority');
    }
    if ((variantCounts['boxtopper'] || 0) < 20) {
      recommendations.push('Box topper coverage low - add specific queries');
    }
    if ((variantCounts['leader'] || 0) < 30) {
      recommendations.push('Leader alt art coverage insufficient');
    }

    // Price distribution check
    const avgPrice = listings.reduce((s, l) => s + l.priceUsd, 0) / (listings.length || 1);
    if (avgPrice < 30) {
      recommendations.push('Average price low - may be capturing too many common variants');
    }

    return recommendations;
  }

  private printDailySummary(): void {
    const report = this.generateDailyReport();

    console.log('\n📊 DAILY COLLECTION SUMMARY');
    console.log('═'.repeat(50));
    console.log(`  Date: ${report.date}`);
    console.log(`  Batches run: ${report.batches.length}`);
    console.log(`  Total listings: ${report.totalListings}`);
    console.log(`  Unique listings: ${report.uniqueListings}`);
    console.log(`  Cards covered: ${report.cardsCovered}`);

    if (report.gapsIdentified.length > 0) {
      console.log('\n  ⚠️ Data Gaps:');
      for (const gap of report.gapsIdentified.slice(0, 5)) {
        console.log(`    - ${gap}`);
      }
      if (report.gapsIdentified.length > 5) {
        console.log(`    ... and ${report.gapsIdentified.length - 5} more`);
      }
    }

    if (report.recommendations.length > 0) {
      console.log('\n  💡 Recommendations:');
      for (const rec of report.recommendations) {
        console.log(`    - ${rec}`);
      }
    }

    console.log('═'.repeat(50));
  }

  // ===========================================================================
  // DATA EXPORT
  // ===========================================================================

  /**
   * Export collected listings for training
   */
  async exportForTraining(): Promise<ExportResult> {
    const allListings = this.dailyBatches.flatMap((b) => b.processedListings);
    const uniqueListings = this.client.deduplicateListings(
      this.dailyBatches.flatMap((b) => b.results)
    );

    // Format for training
    const trainingData = uniqueListings.map((listing) => ({
      // Card identification
      card_id: listing.parsed.cardId,
      set_code: listing.parsed.setCode,
      card_number: listing.parsed.cardNumber,
      variant: listing.parsed.variant,
      language: listing.parsed.language,

      // Price data (in USD)
      price_usd: listing.priceUsd,
      shipping_usd: listing.shippingUsd,
      total_usd: listing.totalUsd,

      // Original currency retained
      original_currency: listing.originalCurrency,
      original_price: listing.originalPrice,

      // Context
      sold_date: listing.soldDate?.toISOString() || null,
      listing_type: listing.listingType,
      condition: listing.condition,
      seller_feedback: listing.sellerFeedback,

      // Metadata
      title: listing.title,
      link: listing.link,
      thumbnail: listing.thumbnail,
      character: listing.parsed.extractedCharacter,
      confidence: listing.parsed.confidence,
    }));

    return {
      count: trainingData.length,
      data: trainingData,
      exportedAt: new Date(),
    };
  }

  // ===========================================================================
  // STATUS
  // ===========================================================================

  /**
   * Get current orchestrator status
   */
  getStatus(): OrchestratorStatus {
    return {
      isRunning: this.scheduleTimer !== null,
      currentBatch: this.currentBatch,
      batchesToday: this.dailyBatches.length,
      totalListingsToday: this.dailyBatches.reduce(
        (sum, b) => sum + b.stats.usableListings,
        0
      ),
      cardsCovered: this.cardCoverage.size,
      nextScheduledWindow: this.getNextScheduledWindow(),
      clientStats: this.client.getStats(),
    };
  }

  private getNextScheduledWindow(): string {
    const now = new Date();
    const currentHour = now.getUTCHours();

    if (currentHour < this.config.morningHourUtc) {
      return `Morning (${this.config.morningHourUtc}:00 UTC)`;
    } else if (currentHour < this.config.middayHourUtc) {
      return `Midday (${this.config.middayHourUtc}:00 UTC)`;
    } else if (currentHour < this.config.eveningHourUtc) {
      return `Evening (${this.config.eveningHourUtc}:00 UTC)`;
    } else {
      return `Morning tomorrow (${this.config.morningHourUtc}:00 UTC)`;
    }
  }
}

// =============================================================================
// TYPES
// =============================================================================

interface ExportResult {
  count: number;
  data: TrainingRecord[];
  exportedAt: Date;
}

interface TrainingRecord {
  card_id: string | null;
  set_code: string | null;
  card_number: string | null;
  variant: string;
  language: string;
  price_usd: number;
  shipping_usd: number;
  total_usd: number;
  original_currency: string;
  original_price: number;
  sold_date: string | null;
  listing_type: string;
  condition: string;
  seller_feedback: number;
  title: string;
  link: string;
  thumbnail?: string;
  character: string | null;
  confidence: number;
}

interface OrchestratorStatus {
  isRunning: boolean;
  currentBatch: CollectionBatch | null;
  batchesToday: number;
  totalListingsToday: number;
  cardsCovered: number;
  nextScheduledWindow: string;
  clientStats: ClientStats;
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

export function createQueryOrchestrator(
  config: Partial<OrchestratorConfig> = {}
): QueryOrchestrator {
  return new QueryOrchestrator(config);
}

// =============================================================================
// SINGLETON INSTANCE
// =============================================================================

let orchestratorInstance: QueryOrchestrator | null = null;

export function getOrchestrator(config?: Partial<OrchestratorConfig>): QueryOrchestrator {
  if (!orchestratorInstance) {
    orchestratorInstance = createQueryOrchestrator(config);
  }
  return orchestratorInstance;
}
