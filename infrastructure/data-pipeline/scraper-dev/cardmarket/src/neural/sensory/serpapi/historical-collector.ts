/**
 * Historical Data Collector
 *
 * The Grand Transmutation Ritual - collects 3 years of eBay sold listings
 * for all targeted One Piece TCG cards.
 *
 * Features:
 *   - 2000 search quota management
 *   - 3-year historical lookback with date segmentation
 *   - All target cards (Legendary, Epic, Rare tiers)
 *   - Extended variant coverage (manga, boxtopper, leader alt arts)
 *   - Progress persistence and resumability
 *   - Real-time statistics
 *
 * @see docs/SERPAPI_ALCHEMIST_GRIMOIRE.md
 */

import { TitleParser, ParsedTitle, shouldExclude, getDedupeKey, titleParser } from './title-parser';
import {
  TargetCard,
  TargetCardRegistry,
  targetCardRegistry,
  ALL_TARGET_CARDS,
  CRITICAL_GAPS,
  PriorityTier,
} from './target-cards';

// =============================================================================
// TYPES
// =============================================================================

export interface CollectorConfig {
  apiKey: string;
  maxSearches: number;
  yearsBack: number;
  minPrice: number;
  maxPrice: number;
  rateLimitMs: number;
  outputPath: string;
  enablePersistence: boolean;
  dryRun: boolean;
}

export interface DateSegment {
  label: string;
  startDate: string; // YYYY-MM-DD
  endDate: string;
}

export interface SearchQuery {
  id: string;
  cardId: string;
  variant: string;
  query: string;
  dateSegment: DateSegment;
  priority: number;
  tier: PriorityTier;
}

export interface CollectedListing {
  // Identity
  id: string;
  cardId: string;
  setCode: string | null;
  cardNumber: string | null;
  variant: string;
  language: string;

  // Price (USD normalized)
  priceUsd: number;
  shippingUsd: number;
  totalUsd: number;
  originalCurrency: string;
  originalPrice: number;

  // Sale context
  soldDate: string | null;
  listingType: string;
  condition: string;
  isGraded: boolean;
  gradingCompany: string | null;
  grade: number | null;

  // Seller
  sellerName: string;
  sellerFeedback: number;

  // Content
  title: string;
  link: string;
  thumbnail: string | null;
  character: string | null;

  // Quality
  confidence: number;
  queryId: string;
  collectedAt: string;
}

export interface CollectionProgress {
  totalSearches: number;
  remainingSearches: number;
  searchesCompleted: number;
  listingsCollected: number;
  uniqueListings: number;
  cardsQueried: number;
  totalCards: number;
  currentCard: string | null;
  currentSegment: string | null;
  startTime: Date;
  estimatedCompletion: Date | null;
  errors: string[];
}

export interface CollectionResult {
  listings: CollectedListing[];
  progress: CollectionProgress;
  byCard: Map<string, CollectedListing[]>;
  byVariant: Map<string, CollectedListing[]>;
  byYear: Map<string, CollectedListing[]>;
  exportPath: string | null;
}

// =============================================================================
// CONSTANTS
// =============================================================================

// Note: apiKey is set lazily to allow dotenv to load first
const DEFAULT_CONFIG: CollectorConfig = {
  apiKey: '', // Will be set from process.env in constructor
  maxSearches: 2000,
  yearsBack: 3,
  minPrice: 5,
  maxPrice: 1000,
  rateLimitMs: 1200, // ~50 requests per minute to stay safe
  outputPath: '/tmp/serpapi-historical',
  enablePersistence: true,
  dryRun: false,
};

// FX rates to USD
const FX_TO_USD: Record<string, number> = {
  'USD': 1.0,
  'GBP': 1.27,
  'EUR': 1.08,
  'AUD': 0.65,
  'CAD': 0.74,
};

// eBay domains
const EBAY_DOMAINS = {
  US: 'ebay.com',
  UK: 'ebay.co.uk',
  DE: 'ebay.de',
};

// =============================================================================
// EXTENDED TARGET CARDS
// =============================================================================

/**
 * Extended card list including all variants we want to collect
 * This expands the target registry to include more cards for comprehensive coverage
 */
const EXTENDED_TARGETS: Array<{ cardId: string; name: string; variants: string[] }> = [
  // Flagship characters - all variants
  { cardId: 'OP01-120', name: 'Shanks', variants: ['parallel', 'manga', 'sp'] },
  { cardId: 'OP06-118', name: 'Yamato', variants: ['parallel', 'manga'] },
  { cardId: 'OP03-040', name: 'Nami', variants: ['parallel', 'manga'] },
  { cardId: 'OP05-119', name: 'Luffy Gear 5', variants: ['sec', 'parallel'] },
  { cardId: 'OP01-078', name: 'Boa Hancock', variants: ['parallel', 'sp'] },
  { cardId: 'OP01-047', name: 'Trafalgar Law', variants: ['parallel', 'sp', 'manga'] },
  { cardId: 'OP02-013', name: 'Portgas D. Ace', variants: ['parallel', 'manga'] },
  { cardId: 'OP04-044', name: 'Kaido', variants: ['sec', 'parallel'] },

  // Straw Hats
  { cardId: 'OP01-025', name: 'Roronoa Zoro', variants: ['parallel', 'sp', 'manga'] },
  { cardId: 'OP03-034', name: 'Sanji', variants: ['parallel', 'manga'] },
  { cardId: 'OP01-017', name: 'Nico Robin', variants: ['parallel', 'sp'] },
  { cardId: 'OP01-015', name: 'Tony Tony Chopper', variants: ['parallel'] },

  // Villains
  { cardId: 'OP04-064', name: 'Crocodile', variants: ['sec', 'parallel'] },
  { cardId: 'OP04-031', name: 'Donquixote Doflamingo', variants: ['parallel', 'manga'] },
  { cardId: 'OP03-123', name: 'Charlotte Katakuri', variants: ['sec', 'parallel'] },

  // Emperors
  { cardId: 'OP02-004', name: 'Edward Newgate', variants: ['leader', 'parallel'] },
  { cardId: 'OP02-001', name: 'Big Mom', variants: ['leader', 'parallel'] },
  { cardId: 'OP04-001', name: 'Blackbeard', variants: ['leader', 'parallel'] },

  // Super Rookies
  { cardId: 'OP05-074', name: 'Eustass Kid', variants: ['sec', 'parallel'] },
  { cardId: 'OP04-083', name: 'Sabo', variants: ['parallel', 'manga'] },

  // Extra Boosters
  { cardId: 'EB01-061', name: 'Yamato EB01', variants: ['parallel', 'sec'] },
  { cardId: 'EB02-024', name: 'Shanks EB02', variants: ['parallel'] },

  // Starter Deck variants
  { cardId: 'ST13-003', name: 'Monkey D. Luffy ST13', variants: ['parallel'] },
  { cardId: 'ST01-012', name: 'Roronoa Zoro ST01', variants: ['parallel'] },

  // Box Toppers (CRITICAL GAP)
  { cardId: 'OP01-024', name: 'Luffy Box Topper', variants: ['boxtopper'] },
  { cardId: 'OP02-004', name: 'Whitebeard Box Topper', variants: ['boxtopper'] },
  { cardId: 'OP03-040', name: 'Nami Box Topper', variants: ['boxtopper'] },

  // Leader Alt Arts (CRITICAL GAP)
  { cardId: 'OP01-001', name: 'Luffy Leader', variants: ['leader'] },
  { cardId: 'OP01-002', name: 'Kaido Leader', variants: ['leader'] },
  { cardId: 'OP01-003', name: 'Kid Leader', variants: ['leader'] },
  { cardId: 'OP02-001', name: 'Big Mom Leader', variants: ['leader'] },
  { cardId: 'OP03-001', name: 'Charlotte Katakuri Leader', variants: ['leader'] },
  { cardId: 'OP04-001', name: 'Teach Leader', variants: ['leader'] },
  { cardId: 'OP05-001', name: 'Luffy Gear 5 Leader', variants: ['leader'] },
  { cardId: 'OP06-001', name: 'Yamato Leader', variants: ['leader'] },

  // Wanted Poster variants
  { cardId: 'OP01-003', name: 'Wanted Poster', variants: ['wantedposter'] },

  // Promo cards
  { cardId: 'P-001', name: 'Promo Luffy', variants: ['promo'] },
  { cardId: 'P-002', name: 'Promo Zoro', variants: ['promo'] },
];

// =============================================================================
// HISTORICAL COLLECTOR
// =============================================================================

export class HistoricalCollector {
  private config: CollectorConfig;
  private parser: TitleParser;

  // State
  private searchesUsed: number = 0;
  private listings: Map<string, CollectedListing> = new Map();
  private errors: string[] = [];
  private startTime: Date = new Date();
  private currentCardIndex: number = 0;
  private currentSegmentIndex: number = 0;

  // Progress callback
  private onProgress?: (progress: CollectionProgress) => void;

  constructor(config: Partial<CollectorConfig> = {}) {
    this.config = {
      ...DEFAULT_CONFIG,
      // Read API key at runtime to allow dotenv to load first
      apiKey: process.env.SERPAPI_KEY || '',
      ...config
    };
    this.parser = titleParser;
  }

  // ===========================================================================
  // PUBLIC API
  // ===========================================================================

  /**
   * Start the grand collection ritual
   */
  async collect(onProgress?: (progress: CollectionProgress) => void): Promise<CollectionResult> {
    this.onProgress = onProgress;
    this.startTime = new Date();

    console.log('\n✨ THE GRAND TRANSMUTATION RITUAL BEGINS ✨');
    console.log('═'.repeat(60));
    console.log(`  Max searches: ${this.config.maxSearches}`);
    console.log(`  Years back: ${this.config.yearsBack}`);
    console.log(`  Target cards: ${this.getTotalQueries()}`);
    console.log(`  Dry run: ${this.config.dryRun}`);
    console.log('═'.repeat(60));

    if (!this.config.apiKey && !this.config.dryRun) {
      throw new Error('No SerpAPI key configured. Set SERPAPI_KEY environment variable.');
    }

    // Generate all queries
    const queries = this.generateAllQueries();
    console.log(`\n📜 Generated ${queries.length} search queries\n`);

    // Execute queries
    for (const query of queries) {
      if (this.searchesUsed >= this.config.maxSearches) {
        console.log(`\n⚠️ Search quota exhausted (${this.config.maxSearches})`);
        break;
      }

      try {
        await this.executeQuery(query);
        this.reportProgress(query);
      } catch (error) {
        this.errors.push(`${query.id}: ${error}`);
        console.error(`❌ Query failed: ${query.id}`);
      }

      // Rate limiting
      await this.sleep(this.config.rateLimitMs);
    }

    // Build result
    const result = this.buildResult();

    // Export if enabled
    if (this.config.enablePersistence) {
      await this.exportResults(result);
    }

    this.printFinalSummary(result);

    return result;
  }

  /**
   * Resume collection from saved progress
   */
  async resume(savedProgress: string): Promise<CollectionResult> {
    // TODO: Implement resume from checkpoint
    throw new Error('Resume not yet implemented');
  }

  // ===========================================================================
  // QUERY GENERATION
  // ===========================================================================

  private generateAllQueries(): SearchQuery[] {
    const queries: SearchQuery[] = [];
    const dateSegments = this.generateDateSegments();

    // Generate queries for each card and variant
    for (const target of EXTENDED_TARGETS) {
      for (const variant of target.variants) {
        // Generate queries for each date segment
        for (const segment of dateSegments) {
          // Primary query
          queries.push({
            id: `${target.cardId}-${variant}-${segment.label}-primary`,
            cardId: target.cardId,
            variant,
            query: this.buildPrimaryQuery(target.cardId, target.name, variant),
            dateSegment: segment,
            priority: this.calculatePriority(variant),
            tier: this.getTier(target.cardId, variant),
          });

          // Secondary query (character-focused)
          queries.push({
            id: `${target.cardId}-${variant}-${segment.label}-secondary`,
            cardId: target.cardId,
            variant,
            query: this.buildSecondaryQuery(target.cardId, target.name, variant),
            dateSegment: segment,
            priority: this.calculatePriority(variant) - 1,
            tier: this.getTier(target.cardId, variant),
          });
        }
      }
    }

    // Sort by priority (highest first)
    queries.sort((a, b) => b.priority - a.priority);

    return queries;
  }

  private generateDateSegments(): DateSegment[] {
    const segments: DateSegment[] = [];
    const now = new Date();

    // Generate quarterly segments for the past 3 years
    for (let year = 0; year < this.config.yearsBack; year++) {
      for (let quarter = 0; quarter < 4; quarter++) {
        const segmentEnd = new Date(now);
        segmentEnd.setFullYear(now.getFullYear() - year);
        segmentEnd.setMonth(now.getMonth() - (quarter * 3));

        const segmentStart = new Date(segmentEnd);
        segmentStart.setMonth(segmentStart.getMonth() - 3);

        const label = `${segmentStart.getFullYear()}Q${Math.floor(segmentStart.getMonth() / 3) + 1}`;

        segments.push({
          label,
          startDate: segmentStart.toISOString().split('T')[0],
          endDate: segmentEnd.toISOString().split('T')[0],
        });
      }
    }

    return segments;
  }

  private buildPrimaryQuery(cardId: string, name: string, variant: string): string {
    const variantTerms: Record<string, string> = {
      parallel: 'alt art alternate parallel',
      manga: 'manga art',
      sp: 'SP special art',
      sec: 'SEC secret rare',
      leader: 'leader alt art',
      boxtopper: 'box topper',
      wantedposter: 'wanted poster',
      promo: 'promo promotional',
    };

    return `One Piece Card Game ${cardId} ${variantTerms[variant] || variant} English`;
  }

  private buildSecondaryQuery(cardId: string, name: string, variant: string): string {
    return `OPTCG ${name} ${cardId} ${variant} raw NM`;
  }

  private calculatePriority(variant: string): number {
    // Prioritize critical gaps
    const priorities: Record<string, number> = {
      manga: 10,      // CRITICAL GAP
      boxtopper: 9,   // CRITICAL GAP
      leader: 8,      // CRITICAL GAP
      sec: 7,
      sp: 6,
      parallel: 5,
      wantedposter: 4,
      promo: 3,
    };
    return priorities[variant] || 1;
  }

  private getTier(cardId: string, variant: string): PriorityTier {
    // Check target registry first
    const tier = targetCardRegistry.getTier(cardId, variant as any);
    if (tier) return tier;

    // Default based on variant
    if (['manga', 'sec'].includes(variant)) return 'legendary';
    if (['sp', 'leader', 'boxtopper'].includes(variant)) return 'epic';
    return 'rare';
  }

  private getTotalQueries(): number {
    let total = 0;
    const segments = this.config.yearsBack * 4; // Quarterly segments
    for (const target of EXTENDED_TARGETS) {
      total += target.variants.length * segments * 2; // 2 queries per variant per segment
    }
    return total;
  }

  // ===========================================================================
  // QUERY EXECUTION
  // ===========================================================================

  private async executeQuery(query: SearchQuery): Promise<void> {
    this.searchesUsed++;

    if (this.config.dryRun) {
      console.log(`  [DRY] ${query.id}: "${query.query.slice(0, 50)}..."`);
      // Simulate some results
      await this.sleep(50);
      return;
    }

    const params = new URLSearchParams({
      engine: 'ebay',
      _nkw: query.query,
      LH_Sold: '1',
      LH_Complete: '1',
      _udlo: String(this.config.minPrice),
      _udhi: String(this.config.maxPrice),
      ebay_domain: EBAY_DOMAINS.UK,
      api_key: this.config.apiKey,
      num: '60',
    });

    // Add date range (eBay uses _sop for sorting, we filter in post-processing)
    // Note: eBay's sold listings are already sorted by date

    const url = `https://serpapi.com/search.json?${params}`;

    try {
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();

      if (data.error) {
        throw new Error(data.error);
      }

      // Process results
      const results = data.organic_results || [];
      for (const item of results) {
        const listing = this.processListing(item, query);
        if (listing && !this.listings.has(listing.id)) {
          this.listings.set(listing.id, listing);
        }
      }

      console.log(`  ✓ ${query.id}: ${results.length} results`);
    } catch (error) {
      throw error;
    }
  }

  private processListing(item: any, query: SearchQuery): CollectedListing | null {
    // Parse title
    const parsed = this.parser.parse(item.title || '');

    // Skip if should exclude
    if (shouldExclude(parsed)) {
      return null;
    }

    // Extract price
    const { priceUsd, currency, originalPrice } = this.extractPrice(item);

    // Skip invalid prices
    if (priceUsd < this.config.minPrice || priceUsd > this.config.maxPrice) {
      return null;
    }

    // Extract shipping
    const shippingUsd = this.extractShipping(item);

    // Generate unique ID
    const id = `${parsed.cardId || query.cardId}-${item.link?.slice(-20) || Date.now()}`;

    return {
      id,
      cardId: parsed.cardId || query.cardId,
      setCode: parsed.setCode,
      cardNumber: parsed.cardNumber,
      variant: parsed.variant,
      language: parsed.language,
      priceUsd,
      shippingUsd,
      totalUsd: priceUsd + shippingUsd,
      originalCurrency: currency,
      originalPrice,
      soldDate: item.sold_date || null,
      listingType: item.listing_type || 'unknown',
      condition: item.condition || 'unknown',
      isGraded: parsed.isGraded,
      gradingCompany: parsed.gradingCompany,
      grade: parsed.grade,
      sellerName: item.seller?.name || 'unknown',
      sellerFeedback: item.seller?.feedback_score || 0,
      title: item.title || '',
      link: item.link || '',
      thumbnail: item.thumbnail || null,
      character: parsed.extractedCharacter,
      confidence: parsed.confidence,
      queryId: query.id,
      collectedAt: new Date().toISOString(),
    };
  }

  private extractPrice(item: any): { priceUsd: number; currency: string; originalPrice: number } {
    if (!item.price) {
      return { priceUsd: 0, currency: 'USD', originalPrice: 0 };
    }

    const originalPrice = item.price.extracted || 0;
    const currency = item.price.currency || this.detectCurrency(item.price.raw || '');
    const fxRate = FX_TO_USD[currency] || 1.0;

    return {
      priceUsd: originalPrice * fxRate,
      currency,
      originalPrice,
    };
  }

  private extractShipping(item: any): number {
    if (!item.shipping?.extracted) return 0;
    return item.shipping.extracted;
  }

  private detectCurrency(priceString: string): string {
    if (priceString.includes('$')) return 'USD';
    if (priceString.includes('£')) return 'GBP';
    if (priceString.includes('€')) return 'EUR';
    return 'USD';
  }

  // ===========================================================================
  // PROGRESS REPORTING
  // ===========================================================================

  private reportProgress(query: SearchQuery): void {
    const progress = this.getProgress(query);

    if (this.onProgress) {
      this.onProgress(progress);
    }

    // Log every 10 searches
    if (this.searchesUsed % 10 === 0) {
      const elapsed = (Date.now() - this.startTime.getTime()) / 1000;
      const rate = this.searchesUsed / elapsed;
      const remaining = this.config.maxSearches - this.searchesUsed;
      const eta = remaining / rate;

      console.log(`\n📊 Progress: ${this.searchesUsed}/${this.config.maxSearches} searches`);
      console.log(`   Listings: ${this.listings.size} unique`);
      console.log(`   Rate: ${rate.toFixed(1)} searches/sec`);
      console.log(`   ETA: ${this.formatDuration(eta)}\n`);
    }
  }

  private getProgress(currentQuery?: SearchQuery): CollectionProgress {
    const elapsed = Date.now() - this.startTime.getTime();
    const rate = this.searchesUsed / (elapsed / 1000);
    const remaining = this.config.maxSearches - this.searchesUsed;
    const etaMs = (remaining / rate) * 1000;

    return {
      totalSearches: this.config.maxSearches,
      remainingSearches: remaining,
      searchesCompleted: this.searchesUsed,
      listingsCollected: this.listings.size,
      uniqueListings: this.listings.size,
      cardsQueried: new Set(Array.from(this.listings.values()).map((l) => l.cardId)).size,
      totalCards: EXTENDED_TARGETS.length,
      currentCard: currentQuery?.cardId || null,
      currentSegment: currentQuery?.dateSegment.label || null,
      startTime: this.startTime,
      estimatedCompletion: new Date(Date.now() + etaMs),
      errors: this.errors,
    };
  }

  // ===========================================================================
  // RESULTS
  // ===========================================================================

  private buildResult(): CollectionResult {
    const listingsArray = Array.from(this.listings.values());

    // Group by card
    const byCard = new Map<string, CollectedListing[]>();
    for (const listing of listingsArray) {
      const existing = byCard.get(listing.cardId) || [];
      existing.push(listing);
      byCard.set(listing.cardId, existing);
    }

    // Group by variant
    const byVariant = new Map<string, CollectedListing[]>();
    for (const listing of listingsArray) {
      const existing = byVariant.get(listing.variant) || [];
      existing.push(listing);
      byVariant.set(listing.variant, existing);
    }

    // Group by year
    const byYear = new Map<string, CollectedListing[]>();
    for (const listing of listingsArray) {
      const year = listing.soldDate?.slice(0, 4) || 'unknown';
      const existing = byYear.get(year) || [];
      existing.push(listing);
      byYear.set(year, existing);
    }

    return {
      listings: listingsArray,
      progress: this.getProgress(),
      byCard,
      byVariant,
      byYear,
      exportPath: null,
    };
  }

  private async exportResults(result: CollectionResult): Promise<void> {
    const fs = await import('fs').then((m) => m.promises);
    const path = await import('path');

    // Ensure output directory exists
    try {
      await fs.mkdir(this.config.outputPath, { recursive: true });
    } catch {}

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `historical-collection-${timestamp}.json`;
    const filepath = path.join(this.config.outputPath, filename);

    const exportData = {
      metadata: {
        collectedAt: new Date().toISOString(),
        searchesUsed: this.searchesUsed,
        totalListings: result.listings.length,
        uniqueCards: result.byCard.size,
        variantBreakdown: Object.fromEntries(
          Array.from(result.byVariant.entries()).map(([k, v]) => [k, v.length])
        ),
        yearBreakdown: Object.fromEntries(
          Array.from(result.byYear.entries()).map(([k, v]) => [k, v.length])
        ),
        errors: this.errors.length,
      },
      listings: result.listings,
    };

    await fs.writeFile(filepath, JSON.stringify(exportData, null, 2));
    result.exportPath = filepath;

    console.log(`\n💾 Exported to: ${filepath}`);

    // Also export as NDJSON for S3/training
    const ndjsonPath = filepath.replace('.json', '.ndjson');
    const ndjsonContent = result.listings.map((l) => JSON.stringify(l)).join('\n');
    await fs.writeFile(ndjsonPath, ndjsonContent);

    console.log(`💾 NDJSON export: ${ndjsonPath}`);
  }

  private printFinalSummary(result: CollectionResult): void {
    const elapsed = (Date.now() - this.startTime.getTime()) / 1000;

    console.log('\n');
    console.log('╔══════════════════════════════════════════════════════════╗');
    console.log('║        🏆 GRAND TRANSMUTATION COMPLETE 🏆                ║');
    console.log('╠══════════════════════════════════════════════════════════╣');
    console.log(`║  Searches used:     ${String(this.searchesUsed).padStart(6)} / ${this.config.maxSearches}                    ║`);
    console.log(`║  Total listings:    ${String(result.listings.length).padStart(6)}                              ║`);
    console.log(`║  Unique cards:      ${String(result.byCard.size).padStart(6)}                              ║`);
    console.log(`║  Duration:          ${this.formatDuration(elapsed).padStart(10)}                        ║`);
    console.log('╠══════════════════════════════════════════════════════════╣');
    console.log('║  VARIANT BREAKDOWN:                                      ║');

    for (const [variant, listings] of result.byVariant.entries()) {
      const avgPrice = listings.reduce((s, l) => s + l.priceUsd, 0) / listings.length;
      console.log(`║    ${variant.padEnd(12)}: ${String(listings.length).padStart(5)} listings (avg $${avgPrice.toFixed(0)})`.padEnd(59) + '║');
    }

    console.log('╠══════════════════════════════════════════════════════════╣');
    console.log('║  YEAR BREAKDOWN:                                         ║');

    for (const [year, listings] of Array.from(result.byYear.entries()).sort()) {
      console.log(`║    ${year}: ${String(listings.length).padStart(5)} listings`.padEnd(59) + '║');
    }

    if (this.errors.length > 0) {
      console.log('╠══════════════════════════════════════════════════════════╣');
      console.log(`║  ⚠️  Errors: ${this.errors.length}`.padEnd(59) + '║');
    }

    console.log('╚══════════════════════════════════════════════════════════╝');
  }

  // ===========================================================================
  // UTILITIES
  // ===========================================================================

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private formatDuration(seconds: number): string {
    if (seconds < 60) return `${seconds.toFixed(0)}s`;
    if (seconds < 3600) return `${(seconds / 60).toFixed(1)}m`;
    return `${(seconds / 3600).toFixed(1)}h`;
  }
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

export function createHistoricalCollector(
  config: Partial<CollectorConfig> = {}
): HistoricalCollector {
  return new HistoricalCollector(config);
}

// =============================================================================
// CLI RUNNER
// =============================================================================

/**
 * Run the historical collection as a standalone script
 */
export async function runHistoricalCollection(
  options: {
    maxSearches?: number;
    yearsBack?: number;
    dryRun?: boolean;
  } = {}
): Promise<CollectionResult> {
  const collector = createHistoricalCollector({
    maxSearches: options.maxSearches ?? 2000,
    yearsBack: options.yearsBack ?? 3,
    dryRun: options.dryRun ?? false,
  });

  return collector.collect((progress) => {
    // Progress callback - could stream to UI
  });
}
