/**
 * SerpAPI Client Service
 *
 * The Alchemist's Cauldron - transforms queries into gold (eBay sold listings).
 * Handles API requests, rate limiting, caching, and error recovery.
 *
 * Query Templates (English Market Elixirs):
 *   - Primary: "One Piece Card Game {cardId} {variant} English"
 *   - Character: "OPTCG {character} {cardId} {variant} alt art"
 *   - General: "OPTCG {cardId} parallel raw NM"
 *
 * @see docs/SERPAPI_ALCHEMIST_GRIMOIRE.md
 */

import { TitleParser, ParsedTitle, shouldExclude, getDedupeKey } from './title-parser';
import { TargetCard, targetCardRegistry, PriorityTier } from './target-cards';

// =============================================================================
// TYPES
// =============================================================================

export interface SerpApiConfig {
  apiKey: string;
  baseUrl: string;
  maxResultsPerQuery: number;
  minPrice: number;
  maxPrice: number;
  rateLimitPerMinute: number;
  cacheTtlMs: number;
  dryRun: boolean;
}

export interface SerpApiQuery {
  query: string;
  cardId: string;
  variant?: string;
  tier: PriorityTier;
  priority: number;
}

export interface SerpApiResponse {
  search_metadata: {
    id: string;
    status: string;
    json_endpoint: string;
    created_at: string;
    processed_at: string;
    total_time_taken: number;
  };
  search_parameters: {
    engine: string;
    q: string;
    ebay_domain: string;
  };
  organic_results?: EbaySoldResult[];
  error?: string;
}

export interface EbaySoldResult {
  position: number;
  title: string;
  link: string;
  thumbnail?: string;
  condition?: string;
  price?: {
    raw: string;
    extracted: number;
    currency?: string;
  };
  shipping?: {
    raw: string;
    extracted?: number;
  };
  sold_date?: string;
  seller?: {
    name?: string;
    feedback_score?: number;
    feedback_percent?: number;
  };
  listing_type?: string; // auction, buy_it_now, best_offer
  bids?: number;
}

export interface ProcessedListing {
  // Parsed title data
  parsed: ParsedTitle;

  // Original eBay data
  title: string;
  link: string;
  thumbnail?: string;

  // Price data (already converted to USD by processor)
  priceUsd: number;
  shippingUsd: number;
  totalUsd: number;
  originalCurrency: string;
  originalPrice: number;

  // Sale context
  soldDate: Date | null;
  listingType: string;
  condition: string;

  // Seller info
  sellerName: string;
  sellerFeedback: number;

  // Quality indicators
  isUsable: boolean; // Passes all quality filters
  exclusionReason?: string;
}

export interface QueryResult {
  query: SerpApiQuery;
  timestamp: Date;
  totalResults: number;
  usableResults: number;
  listings: ProcessedListing[];
  errors: string[];
  cached: boolean;
  latencyMs: number;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const DEFAULT_CONFIG: SerpApiConfig = {
  apiKey: process.env.SERPAPI_KEY || '',
  baseUrl: 'https://serpapi.com/search.json',
  maxResultsPerQuery: 60,
  minPrice: 5, // £5 minimum
  maxPrice: 500, // £500 maximum (filter outliers)
  rateLimitPerMinute: 100,
  cacheTtlMs: 30 * 60 * 1000, // 30 minutes
  dryRun: false,
};

// FX rates to USD (updated daily in production)
const FX_TO_USD: Record<string, number> = {
  'USD': 1.0,
  'GBP': 1.27,
  'EUR': 1.08,
  'AUD': 0.65,
  'CAD': 0.74,
};

// eBay domains by market
const EBAY_DOMAINS: Record<string, string> = {
  'US': 'ebay.com',
  'UK': 'ebay.co.uk',
  'DE': 'ebay.de',
  'AU': 'ebay.com.au',
};

// =============================================================================
// SERPAPI CLIENT
// =============================================================================

export class SerpApiClient {
  private config: SerpApiConfig;
  private titleParser: TitleParser;

  // Rate limiting
  private requestTimes: number[] = [];

  // Caching
  private cache: Map<string, { result: QueryResult; expiry: number }>;

  // Statistics
  private stats: ClientStats;

  constructor(config: Partial<SerpApiConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.titleParser = new TitleParser();
    this.cache = new Map();

    this.stats = {
      queriesExecuted: 0,
      totalListings: 0,
      usableListings: 0,
      cacheHits: 0,
      errors: 0,
      avgLatencyMs: 0,
    };
  }

  // ===========================================================================
  // PUBLIC API
  // ===========================================================================

  /**
   * Search eBay sold listings for a specific card
   */
  async searchCard(card: TargetCard): Promise<QueryResult[]> {
    const queries = this.buildQueries(card);
    const results: QueryResult[] = [];

    for (const query of queries) {
      const result = await this.executeQuery(query);
      results.push(result);

      // Rate limit between queries
      await this.enforceRateLimit();
    }

    return results;
  }

  /**
   * Search using a raw query string
   */
  async searchRaw(query: string, tier: PriorityTier = 'common'): Promise<QueryResult> {
    const serpQuery: SerpApiQuery = {
      query,
      cardId: 'unknown',
      tier,
      priority: 1,
    };

    return this.executeQuery(serpQuery);
  }

  /**
   * Search all target cards by priority tier
   */
  async searchByTier(tier: PriorityTier): Promise<Map<string, QueryResult[]>> {
    const cards = targetCardRegistry.getByTier(tier);
    const results = new Map<string, QueryResult[]>();

    console.log(`🔍 Searching ${cards.length} ${tier} cards...`);

    for (const card of cards) {
      const cardResults = await this.searchCard(card);
      results.set(card.cardId, cardResults);

      // Log progress
      const totalUsable = cardResults.reduce((sum, r) => sum + r.usableResults, 0);
      console.log(`  ✓ ${card.cardId} (${card.variant}): ${totalUsable} usable listings`);
    }

    return results;
  }

  /**
   * Execute the morning, midday, or evening query schedule
   */
  async executeSchedule(schedule: 'morning' | 'midday' | 'evening'): Promise<QueryResult[]> {
    const querySchedule = targetCardRegistry.getQuerySchedule();
    const cards = querySchedule[schedule];
    const allResults: QueryResult[] = [];

    console.log(`\n🌅 Executing ${schedule} query schedule (${cards.length} cards)...`);

    for (const card of cards) {
      const results = await this.searchCard(card);
      allResults.push(...results);
    }

    const totalUsable = allResults.reduce((sum, r) => sum + r.usableResults, 0);
    console.log(`✅ Schedule complete: ${totalUsable} usable listings collected`);

    return allResults;
  }

  // ===========================================================================
  // QUERY BUILDING
  // ===========================================================================

  private buildQueries(card: TargetCard): SerpApiQuery[] {
    const queries: SerpApiQuery[] = [];

    // Primary query: Card ID + variant + "English"
    queries.push({
      query: `One Piece Card Game ${card.cardId} ${card.variant} English`,
      cardId: card.cardId,
      variant: card.variant,
      tier: card.tier,
      priority: card.queryPriority,
    });

    // Character-focused query
    queries.push({
      query: `OPTCG ${card.character} ${card.cardId} ${card.variant} alt art`,
      cardId: card.cardId,
      variant: card.variant,
      tier: card.tier,
      priority: card.queryPriority - 1,
    });

    // Use top 2 aliases
    for (const alias of card.aliases.slice(0, 2)) {
      queries.push({
        query: `One Piece Card Game ${alias} English`,
        cardId: card.cardId,
        variant: card.variant,
        tier: card.tier,
        priority: card.queryPriority - 2,
      });
    }

    return queries;
  }

  // ===========================================================================
  // QUERY EXECUTION
  // ===========================================================================

  private async executeQuery(query: SerpApiQuery): Promise<QueryResult> {
    const startTime = Date.now();
    const cacheKey = this.getCacheKey(query);

    // Check cache
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiry > Date.now()) {
      this.stats.cacheHits++;
      return { ...cached.result, cached: true };
    }

    const result: QueryResult = {
      query,
      timestamp: new Date(),
      totalResults: 0,
      usableResults: 0,
      listings: [],
      errors: [],
      cached: false,
      latencyMs: 0,
    };

    if (this.config.dryRun) {
      console.log(`📝 [DRY RUN] Would query: "${query.query}"`);
      result.latencyMs = Date.now() - startTime;
      return result;
    }

    if (!this.config.apiKey) {
      result.errors.push('No SerpAPI key configured');
      return result;
    }

    try {
      // Execute SerpAPI request
      const response = await this.fetchSerpApi(query.query);

      if (response.error) {
        result.errors.push(response.error);
        this.stats.errors++;
        return result;
      }

      // Process results
      const organicResults = response.organic_results || [];
      result.totalResults = organicResults.length;

      for (const item of organicResults) {
        const processed = this.processListing(item, query);
        result.listings.push(processed);

        if (processed.isUsable) {
          result.usableResults++;
        }
      }

      // Update stats
      this.stats.queriesExecuted++;
      this.stats.totalListings += result.totalResults;
      this.stats.usableListings += result.usableResults;

      result.latencyMs = Date.now() - startTime;
      this.stats.avgLatencyMs =
        (this.stats.avgLatencyMs * (this.stats.queriesExecuted - 1) + result.latencyMs) /
        this.stats.queriesExecuted;

      // Cache result
      this.cache.set(cacheKey, {
        result,
        expiry: Date.now() + this.config.cacheTtlMs,
      });

    } catch (error) {
      result.errors.push(`Query failed: ${error}`);
      this.stats.errors++;
    }

    return result;
  }

  private async fetchSerpApi(query: string): Promise<SerpApiResponse> {
    const params = new URLSearchParams({
      engine: 'ebay',
      _nkw: query,
      LH_Sold: '1', // Sold listings only
      LH_Complete: '1', // Completed listings
      ebay_domain: EBAY_DOMAINS['UK'],
      api_key: this.config.apiKey,
      num: String(this.config.maxResultsPerQuery),
    });

    const url = `${this.config.baseUrl}?${params}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`SerpAPI HTTP error: ${response.status}`);
    }

    return response.json();
  }

  // ===========================================================================
  // LISTING PROCESSING
  // ===========================================================================

  private processListing(item: EbaySoldResult, query: SerpApiQuery): ProcessedListing {
    // Parse title
    const parsed = this.titleParser.parse(item.title);

    // Extract price
    const { priceUsd, currency, originalPrice } = this.extractPrice(item);
    const shippingUsd = this.extractShipping(item);

    // Determine condition from eBay data or parsed title
    const condition = item.condition || (parsed.isGraded ? 'Graded' : 'Raw');

    // Build processed listing
    const listing: ProcessedListing = {
      parsed,
      title: item.title,
      link: item.link,
      thumbnail: item.thumbnail,
      priceUsd,
      shippingUsd,
      totalUsd: priceUsd + shippingUsd,
      originalCurrency: currency,
      originalPrice,
      soldDate: item.sold_date ? new Date(item.sold_date) : null,
      listingType: item.listing_type || 'unknown',
      condition,
      sellerName: item.seller?.name || 'unknown',
      sellerFeedback: item.seller?.feedback_score || 0,
      isUsable: false,
      exclusionReason: undefined,
    };

    // Apply quality filters
    listing.isUsable = this.passesQualityFilters(listing, query);

    return listing;
  }

  private extractPrice(item: EbaySoldResult): {
    priceUsd: number;
    currency: string;
    originalPrice: number;
  } {
    if (!item.price) {
      return { priceUsd: 0, currency: 'USD', originalPrice: 0 };
    }

    const originalPrice = item.price.extracted || 0;
    const currency = item.price.currency || this.detectCurrency(item.price.raw);
    const fxRate = FX_TO_USD[currency] || 1.0;

    return {
      priceUsd: originalPrice * fxRate,
      currency,
      originalPrice,
    };
  }

  private extractShipping(item: EbaySoldResult): number {
    if (!item.shipping?.extracted) return 0;

    // Assume shipping is in same currency as item (simplification)
    return item.shipping.extracted;
  }

  private detectCurrency(priceString: string): string {
    if (priceString.includes('$')) return 'USD';
    if (priceString.includes('£')) return 'GBP';
    if (priceString.includes('€')) return 'EUR';
    if (priceString.includes('A$')) return 'AUD';
    if (priceString.includes('C$')) return 'CAD';
    return 'USD';
  }

  // ===========================================================================
  // QUALITY FILTERS
  // ===========================================================================

  private passesQualityFilters(listing: ProcessedListing, query: SerpApiQuery): boolean {
    const { parsed } = listing;

    // Filter: No card ID extracted
    if (!parsed.cardId) {
      listing.exclusionReason = 'No card ID extracted from title';
      return false;
    }

    // Filter: Graded cards (we want raw cards for training)
    if (parsed.isGraded) {
      listing.exclusionReason = 'Graded card (PSA/CGC/BGS)';
      return false;
    }

    // Filter: Wrong language (we want English primarily)
    if (parsed.language !== 'EN') {
      listing.exclusionReason = `Non-English card (${parsed.language})`;
      return false;
    }

    // Filter: Price too low (likely accessories or damaged)
    if (listing.priceUsd < this.config.minPrice) {
      listing.exclusionReason = `Price too low ($${listing.priceUsd})`;
      return false;
    }

    // Filter: Price too high (likely outlier or multiple cards)
    if (listing.priceUsd > this.config.maxPrice) {
      listing.exclusionReason = `Price too high ($${listing.priceUsd})`;
      return false;
    }

    // Filter: Low confidence parse
    if (parsed.confidence < 0.4) {
      listing.exclusionReason = `Low parse confidence (${parsed.confidence})`;
      return false;
    }

    // Filter: Should exclude based on parser rules
    if (shouldExclude(parsed)) {
      listing.exclusionReason = 'Excluded by title parser rules';
      return false;
    }

    // Bonus: Card matches query target (higher confidence)
    if (parsed.cardId !== query.cardId && query.cardId !== 'unknown') {
      // Allow if it's a related card (same set)
      const parsedSet = parsed.setCode || '';
      const querySet = query.cardId.split('-')[0];
      if (parsedSet !== querySet) {
        listing.exclusionReason = `Card mismatch: got ${parsed.cardId}, expected ${query.cardId}`;
        return false;
      }
    }

    return true;
  }

  // ===========================================================================
  // RATE LIMITING
  // ===========================================================================

  private async enforceRateLimit(): Promise<void> {
    const now = Date.now();
    const windowStart = now - 60000; // 1 minute window

    // Remove old timestamps
    this.requestTimes = this.requestTimes.filter((t) => t > windowStart);

    // Check if at limit
    if (this.requestTimes.length >= this.config.rateLimitPerMinute) {
      const oldestRequest = this.requestTimes[0];
      const waitTime = oldestRequest + 60000 - now;

      if (waitTime > 0) {
        console.log(`⏳ Rate limit reached, waiting ${waitTime}ms...`);
        await this.sleep(waitTime);
      }
    }

    // Record this request
    this.requestTimes.push(now);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ===========================================================================
  // CACHING
  // ===========================================================================

  private getCacheKey(query: SerpApiQuery): string {
    return `${query.query}|${query.cardId}|${query.variant || ''}`;
  }

  /**
   * Clear expired cache entries
   */
  clearExpiredCache(): number {
    const now = Date.now();
    let cleared = 0;

    const entries = Array.from(this.cache.entries());
    for (const [key, value] of entries) {
      if (value.expiry < now) {
        this.cache.delete(key);
        cleared++;
      }
    }

    return cleared;
  }

  /**
   * Clear all cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  // ===========================================================================
  // STATISTICS
  // ===========================================================================

  getStats(): ClientStats {
    return { ...this.stats };
  }

  printStats(): void {
    console.log('\n📊 SERPAPI CLIENT STATISTICS');
    console.log('═'.repeat(50));
    console.log(`  Queries executed: ${this.stats.queriesExecuted}`);
    console.log(`  Total listings: ${this.stats.totalListings}`);
    console.log(`  Usable listings: ${this.stats.usableListings}`);
    console.log(`  Cache hits: ${this.stats.cacheHits}`);
    console.log(`  Errors: ${this.stats.errors}`);
    console.log(`  Avg latency: ${this.stats.avgLatencyMs.toFixed(0)}ms`);
    console.log(`  Usability rate: ${((this.stats.usableListings / this.stats.totalListings) * 100 || 0).toFixed(1)}%`);
    console.log('═'.repeat(50));
  }

  // ===========================================================================
  // DEDUPLICATION
  // ===========================================================================

  /**
   * Deduplicate listings across multiple query results
   */
  deduplicateListings(results: QueryResult[]): ProcessedListing[] {
    const seen = new Map<string, ProcessedListing>();

    for (const result of results) {
      for (const listing of result.listings) {
        if (!listing.isUsable) continue;

        const key = getDedupeKey(listing.parsed);
        const existing = seen.get(key);

        // Keep the listing with higher price (more recent sale)
        if (!existing || listing.priceUsd > existing.priceUsd) {
          seen.set(key, listing);
        }
      }
    }

    return Array.from(seen.values());
  }
}

// =============================================================================
// TYPES
// =============================================================================

export interface ClientStats {
  queriesExecuted: number;
  totalListings: number;
  usableListings: number;
  cacheHits: number;
  errors: number;
  avgLatencyMs: number;
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

export function createSerpApiClient(config: Partial<SerpApiConfig> = {}): SerpApiClient {
  return new SerpApiClient(config);
}
