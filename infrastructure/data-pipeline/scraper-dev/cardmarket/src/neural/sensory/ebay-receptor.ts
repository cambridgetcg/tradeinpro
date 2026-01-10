/**
 * eBay Receptor Neuron
 *
 * Sensory neuron that receives sold listing data from eBay via SerpAPI.
 * Converts sold auction/BIN prices into standardized neural signals with
 * USD normalization for ML training while retaining source currency.
 *
 * Data Source: SerpAPI (google.serper.dev or serpapi.com)
 * API Endpoint: eBay search with sold filter
 *
 * Myelin Sheaths:
 *   - API response caching (TTL: 1 hour)
 *   - Query deduplication
 *   - Rate limiting (2s between requests)
 *
 * Currency Handling:
 *   - Source currencies: USD, GBP, EUR, AUD, CAD
 *   - All normalized to USD for training
 *   - Original prices retained in source field
 */

import { BaseNeuron } from '../base-neuron';
import {
  NeuralLayer,
  NeuralSignal,
  NeurotransmitterType,
  RawPriceSignal,
  MyelinSheath,
  EbaySoldListing,
  EbaySearchResult,
} from '../types';

// =============================================================================
// INTERFACES
// =============================================================================

export interface SerpApiEbayResponse {
  search_metadata: {
    id: string;
    status: string;
    created_at: string;
    processed_at: string;
    total_time_taken: number;
  };
  search_parameters: {
    engine: string;
    ebay_domain: string;
    _nkw: string;
    LH_Sold: string;
    LH_Complete: string;
  };
  organic_results: SerpApiEbayItem[];
  pagination?: {
    current: number;
    next?: string;
  };
}

export interface SerpApiEbayItem {
  position: number;
  title: string;
  link: string;
  epid?: string;
  condition?: string;
  price: {
    raw: string;
    extracted: number;
    currency?: string;
  };
  shipping?: {
    raw?: string;
    extracted?: number;
  };
  sold_date?: string;
  thumbnail?: string;
  extensions?: string[];
  buy_it_now?: boolean;
  accepts_best_offer?: boolean;
  seller?: {
    username?: string;
    feedback_score?: number;
    positive_feedback_percent?: number;
  };
}

export interface EbayReceptorConfig {
  serpApiKey: string;
  ebayDomain: 'ebay.com' | 'ebay.co.uk' | 'ebay.de' | 'ebay.com.au' | 'ebay.ca';
  defaultCurrency: 'USD' | 'GBP' | 'EUR' | 'AUD' | 'CAD';
  minPriceUsd: number;
  maxPriceUsd: number;
  maxResultsPerQuery: number;
  refractoryPeriodMs: number;
  enableMyelinOptimizations: boolean;
  outlierStdDevThreshold: number; // Remove prices > N std devs from median
}

export interface FXRateProvider {
  getRate(from: string, to: string): Promise<number | null>;
}

// Domain to default currency mapping
const DOMAIN_CURRENCY_MAP: Record<string, 'USD' | 'GBP' | 'EUR' | 'AUD' | 'CAD'> = {
  'ebay.com': 'USD',
  'ebay.co.uk': 'GBP',
  'ebay.de': 'EUR',
  'ebay.com.au': 'AUD',
  'ebay.ca': 'CAD',
};

// Default FX rates to USD (fallback when provider unavailable)
const DEFAULT_FX_TO_USD: Record<string, number> = {
  'USD': 1.0,
  'GBP': 1.27,  // GBP is stronger than USD
  'EUR': 1.08,
  'AUD': 0.65,
  'CAD': 0.74,
  'JPY': 0.0067,
};

// =============================================================================
// EBAY RECEPTOR NEURON
// =============================================================================

export class EbayReceptorNeuron extends BaseNeuron<
  SerpApiEbayResponse,
  RawPriceSignal
> {
  private config: EbayReceptorConfig;
  private fxProvider?: FXRateProvider;
  private fxCache: Map<string, { rate: number; timestamp: Date }> = new Map();
  private fxCacheTtlMs: number = 3600000; // 1 hour
  private stats: EbayReceptorStats;
  private queryCache: Map<string, EbaySearchResult> = new Map();

  constructor(
    config: Partial<EbayReceptorConfig> & { serpApiKey: string },
    fxProvider?: FXRateProvider
  ) {
    super('EbayReceptor', NeuralLayer.SENSORY);

    this.config = {
      serpApiKey: config.serpApiKey,
      ebayDomain: config.ebayDomain || 'ebay.com',
      defaultCurrency: config.defaultCurrency || 'USD',
      minPriceUsd: config.minPriceUsd ?? 1.0,
      maxPriceUsd: config.maxPriceUsd ?? 50000,
      maxResultsPerQuery: config.maxResultsPerQuery ?? 100,
      refractoryPeriodMs: config.refractoryPeriodMs ?? 2000, // SerpAPI rate limit
      enableMyelinOptimizations: config.enableMyelinOptimizations ?? true,
      outlierStdDevThreshold: config.outlierStdDevThreshold ?? 2.5,
    };

    this.fxProvider = fxProvider;

    this.stats = {
      queriesProcessed: 0,
      listingsReceived: 0,
      listingsAccepted: 0,
      listingsRejected: 0,
      outliersPruned: 0,
      fxConversions: 0,
      cacheHits: 0,
      cacheMisses: 0,
      avgPriceUsd: 0,
      byCondition: new Map(),
      byListingType: new Map(),
    };
  }

  // ===========================================================================
  // LIFECYCLE
  // ===========================================================================

  protected async onInitialize(): Promise<void> {
    if (this.config.enableMyelinOptimizations) {
      this.initializeMyelinSheaths();
    }

    // Pre-warm FX cache
    await this.warmFxCache();

    console.log(`🛒 [${this.name}] eBay receptor initialized`);
    console.log(`   Domain: ${this.config.ebayDomain}`);
    console.log(`   Default currency: ${this.config.defaultCurrency}`);
    console.log(`   Price range: $${this.config.minPriceUsd} - $${this.config.maxPriceUsd}`);
    console.log(`   SerpAPI key: ${this.config.serpApiKey.substring(0, 8)}...`);
    console.log(`   FX provider: ${this.fxProvider ? 'Available' : 'Using defaults'}`);
  }

  protected async onShutdown(): Promise<void> {
    this.logStats();
    this.queryCache.clear();
    this.fxCache.clear();
  }

  // ===========================================================================
  // MYELIN SHEATHS (OPTIMIZATIONS)
  // ===========================================================================

  private initializeMyelinSheaths(): void {
    // Sheath 1: Query result caching
    const queryCacheSheath: MyelinSheath = {
      id: 'ebay-query-cache',
      name: 'eBay Query Cache',
      location: 'eBay Receptor → API Response',
      effect: 'Cache SerpAPI responses for duplicate queries',
      speedupFactor: 10.0, // Massive speedup on cache hit
      source: 'SerpAPI rate limit mitigation',
      ttlMs: 3600000, // 1 hour
      cache: new Map(),
    };
    this.addMyelinSheath(queryCacheSheath);

    // Sheath 2: TCG card pattern recognition
    const tcgPatternSheath: MyelinSheath = {
      id: 'tcg-card-patterns',
      name: 'TCG Card Patterns',
      location: 'eBay Receptor title parsing',
      effect: 'Fast-path card identification via regex patterns',
      speedupFactor: 1.5,
      source: 'Empirical pattern matching',
      ttlMs: undefined, // No caching, just pattern matching
    };
    this.addMyelinSheath(tcgPatternSheath);

    // Sheath 3: Price normalization cache
    const fxCacheSheath: MyelinSheath = {
      id: 'fx-rate-cache',
      name: 'FX Rate Cache',
      location: 'eBay Receptor → Price Normalization',
      effect: 'Cache FX rates to avoid repeated lookups',
      speedupFactor: 1.2,
      source: 'FX rate provider optimization',
      ttlMs: 3600000, // 1 hour
      cache: new Map(),
    };
    this.addMyelinSheath(fxCacheSheath);

    console.log(`⚡ [${this.name}] Myelin sheaths initialized: 3`);
  }

  // ===========================================================================
  // FX CACHE MANAGEMENT
  // ===========================================================================

  private async warmFxCache(): Promise<void> {
    const currencies = ['GBP', 'EUR', 'AUD', 'CAD', 'JPY'];

    for (const from of currencies) {
      try {
        const rate = await this.getFxRate(from, 'USD');
        console.log(`   Cached ${from}/USD: ${rate.toFixed(4)}`);
      } catch (error) {
        console.warn(`   Failed to cache ${from}/USD: ${error}`);
      }
    }
  }

  private async getFxRate(from: string, to: string): Promise<number> {
    // USD to USD is always 1
    if (from === to) return 1.0;

    const pair = `${from}/${to}`;

    // Check cache
    const cached = this.fxCache.get(pair);
    if (cached && Date.now() - cached.timestamp.getTime() < this.fxCacheTtlMs) {
      return cached.rate;
    }

    // Fetch from provider
    if (this.fxProvider) {
      try {
        const rate = await this.fxProvider.getRate(from, to);
        if (rate) {
          this.fxCache.set(pair, { rate, timestamp: new Date() });
          this.stats.fxConversions++;
          return rate;
        }
      } catch (error) {
        console.warn(`FX fetch failed for ${pair}: ${error}`);
      }
    }

    // Return default rate
    if (to === 'USD') {
      return DEFAULT_FX_TO_USD[from] || 1.0;
    } else if (from === 'USD') {
      return 1.0 / (DEFAULT_FX_TO_USD[to] || 1.0);
    }

    // Cross-rate through USD
    const fromToUsd = DEFAULT_FX_TO_USD[from] || 1.0;
    const toToUsd = DEFAULT_FX_TO_USD[to] || 1.0;
    return fromToUsd / toToUsd;
  }

  // ===========================================================================
  // SIGNAL PROCESSING
  // ===========================================================================

  async processSignal(
    signal: NeuralSignal<SerpApiEbayResponse>
  ): Promise<RawPriceSignal> {
    const response = signal.payload;
    this.stats.queriesProcessed++;

    // Extract card ID from search parameters
    const query = response.search_parameters._nkw;
    const cardId = this.extractCardIdFromQuery(query);

    // Parse and validate listings
    const listings = await this.parseListings(response.organic_results);
    this.stats.listingsReceived += response.organic_results.length;
    this.stats.listingsAccepted += listings.length;
    this.stats.listingsRejected += response.organic_results.length - listings.length;

    // Calculate statistics
    const searchResult = this.buildSearchResult(cardId, query, listings);

    // Store in query cache for myelin optimization
    this.queryCache.set(query, searchResult);

    // Create RawPriceSignal with USD normalization
    const rawSignal: RawPriceSignal = {
      cardId,
      name: this.extractCardName(query),
      source: 'ebay',
      currency: 'USD', // Normalized to USD

      // All prices normalized to USD
      priceFrom: searchResult.stats.minPrice,
      priceTrend: searchResult.stats.medianPrice,
      priceAvg: searchResult.stats.avgPrice,

      variantType: this.detectVariantFromQuery(query),
      language: 'EN', // eBay listings are primarily English
      availableItems: 0, // Sold listings, not available
      scraped_at: searchResult.searchTimestamp,
    };

    return rawSignal;
  }

  // ===========================================================================
  // LISTING PARSING
  // ===========================================================================

  private async parseListings(
    items: SerpApiEbayItem[]
  ): Promise<EbaySoldListing[]> {
    const listings: EbaySoldListing[] = [];

    for (const item of items) {
      const listing = await this.parseItem(item);
      if (listing && this.validateListing(listing)) {
        listings.push(listing);
      }
    }

    // Prune outliers
    return this.pruneOutliers(listings);
  }

  private async parseItem(item: SerpApiEbayItem): Promise<EbaySoldListing | null> {
    try {
      // Detect currency from price string or use domain default
      const currency = this.detectCurrency(item.price.raw) || this.config.defaultCurrency;

      // Convert price to USD
      const fxRate = await this.getFxRate(currency, 'USD');
      const priceUsd = item.price.extracted * fxRate;

      // Parse shipping
      let shippingPriceUsd: number | null = null;
      if (item.shipping?.extracted) {
        shippingPriceUsd = item.shipping.extracted * fxRate;
      }

      // Detect listing type
      const listingType = this.detectListingType(item);

      // Parse sold date
      const soldDate = item.sold_date
        ? this.parseSoldDate(item.sold_date)
        : new Date();

      return {
        title: item.title,
        price: priceUsd,
        currency: 'USD', // Normalized
        soldDate,
        condition: item.condition || 'Unknown',
        seller: item.seller?.username || 'Unknown',
        listingType,
        shippingPrice: shippingPriceUsd,
        imageUrl: item.thumbnail || null,
        itemUrl: item.link,
        itemId: item.epid || this.extractItemId(item.link),
      };
    } catch (error) {
      console.warn(`Failed to parse eBay item: ${error}`);
      return null;
    }
  }

  private detectCurrency(priceRaw: string): 'USD' | 'GBP' | 'EUR' | 'AUD' | 'CAD' | null {
    if (priceRaw.includes('$') && !priceRaw.includes('AU$') && !priceRaw.includes('C$')) {
      return 'USD';
    }
    if (priceRaw.includes('£')) return 'GBP';
    if (priceRaw.includes('€')) return 'EUR';
    if (priceRaw.includes('AU$') || priceRaw.includes('A$')) return 'AUD';
    if (priceRaw.includes('C$') || priceRaw.includes('CA$')) return 'CAD';
    return null;
  }

  private detectListingType(item: SerpApiEbayItem): 'auction' | 'buy_it_now' | 'best_offer' {
    if (item.buy_it_now) return 'buy_it_now';
    if (item.accepts_best_offer) return 'best_offer';

    // Check extensions for "Auction" keyword
    if (item.extensions?.some(ext => ext.toLowerCase().includes('auction'))) {
      return 'auction';
    }

    // Default to BIN for sold listings
    return 'buy_it_now';
  }

  private parseSoldDate(dateStr: string): Date {
    // SerpAPI formats: "Sold Dec 15, 2024", "Sold 3 days ago", etc.
    const now = new Date();

    // Handle relative dates
    const daysAgoMatch = dateStr.match(/(\d+)\s*days?\s*ago/i);
    if (daysAgoMatch) {
      const daysAgo = parseInt(daysAgoMatch[1], 10);
      return new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);
    }

    // Handle absolute dates
    const cleaned = dateStr.replace(/^Sold\s*/i, '').trim();
    const parsed = new Date(cleaned);
    return isNaN(parsed.getTime()) ? now : parsed;
  }

  private extractItemId(url: string): string {
    // Extract eBay item ID from URL
    const match = url.match(/\/itm\/(\d+)/);
    return match ? match[1] : `unknown-${Date.now()}`;
  }

  // ===========================================================================
  // VALIDATION & OUTLIER PRUNING
  // ===========================================================================

  private validateListing(listing: EbaySoldListing): boolean {
    // Price bounds check
    if (listing.price < this.config.minPriceUsd) {
      return false;
    }
    if (listing.price > this.config.maxPriceUsd) {
      return false;
    }

    // Must have a valid sold date (within last 90 days)
    const daysSinceSale = (Date.now() - listing.soldDate.getTime()) / (24 * 60 * 60 * 1000);
    if (daysSinceSale > 90 || daysSinceSale < 0) {
      return false;
    }

    // Track by condition
    const conditionCount = this.stats.byCondition.get(listing.condition) || 0;
    this.stats.byCondition.set(listing.condition, conditionCount + 1);

    // Track by listing type
    const typeCount = this.stats.byListingType.get(listing.listingType) || 0;
    this.stats.byListingType.set(listing.listingType, typeCount + 1);

    return true;
  }

  private pruneOutliers(listings: EbaySoldListing[]): EbaySoldListing[] {
    if (listings.length < 5) {
      return listings; // Not enough data for outlier detection
    }

    const prices = listings.map(l => l.price).sort((a, b) => a - b);
    const median = prices[Math.floor(prices.length / 2)];

    // Calculate standard deviation
    const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
    const variance = prices.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / prices.length;
    const stdDev = Math.sqrt(variance);

    // Filter outliers
    const threshold = this.config.outlierStdDevThreshold;
    const filtered = listings.filter(listing => {
      const zScore = Math.abs(listing.price - median) / (stdDev || 1);
      const isOutlier = zScore > threshold;

      if (isOutlier) {
        this.stats.outliersPruned++;
        console.log(
          `🗑️ [${this.name}] Pruned outlier: $${listing.price.toFixed(2)} (z=${zScore.toFixed(2)})`
        );
      }

      return !isOutlier;
    });

    return filtered;
  }

  // ===========================================================================
  // SEARCH RESULT AGGREGATION
  // ===========================================================================

  private buildSearchResult(
    cardId: string,
    query: string,
    listings: EbaySoldListing[]
  ): EbaySearchResult {
    const prices = listings.map(l => l.price).sort((a, b) => a - b);

    const stats = this.calculateStats(prices);

    // Update running average
    if (listings.length > 0) {
      const totalPrices = this.stats.avgPriceUsd * (this.stats.listingsAccepted - listings.length);
      const newTotal = totalPrices + prices.reduce((a, b) => a + b, 0);
      this.stats.avgPriceUsd = newTotal / this.stats.listingsAccepted;
    }

    return {
      cardId,
      query,
      listings,
      totalResults: listings.length,
      searchTimestamp: new Date(),
      stats,
    };
  }

  private calculateStats(prices: number[]): EbaySearchResult['stats'] {
    if (prices.length === 0) {
      return {
        avgPrice: 0,
        medianPrice: 0,
        minPrice: 0,
        maxPrice: 0,
        stdDev: 0,
        sampleSize: 0,
        priceRange: { low: 0, high: 0 },
      };
    }

    const sorted = [...prices].sort((a, b) => a - b);
    const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length;
    const median = sorted[Math.floor(sorted.length / 2)];
    const min = sorted[0];
    const max = sorted[sorted.length - 1];

    const variance = sorted.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / sorted.length;
    const stdDev = Math.sqrt(variance);

    // IQR for price range
    const q1Index = Math.floor(sorted.length * 0.25);
    const q3Index = Math.floor(sorted.length * 0.75);

    return {
      avgPrice: mean,
      medianPrice: median,
      minPrice: min,
      maxPrice: max,
      stdDev,
      sampleSize: sorted.length,
      priceRange: {
        low: sorted[q1Index] || min,
        high: sorted[q3Index] || max,
      },
    };
  }

  // ===========================================================================
  // CARD IDENTIFICATION
  // ===========================================================================

  private extractCardIdFromQuery(query: string): string {
    // Try to extract card ID patterns from search query
    const patterns = [
      /([A-Z]{2}\d{2}-\d{3}(-[a-z]+)?)/i,        // OP01-001, OP01-001-parallel
      /([A-Z]{2}\d{2}-[A-Z]{2}\d{2}-\d{3})/i,    // OP03-OP01-051
    ];

    for (const pattern of patterns) {
      const match = query.match(pattern);
      if (match) {
        return match[1].toUpperCase();
      }
    }

    // Fallback: generate from query hash
    return `EBAY-${this.hashQuery(query)}`;
  }

  private extractCardName(query: string): string {
    // Remove common search modifiers
    return query
      .replace(/one\s*piece\s*(tcg|card\s*game)?/gi, '')
      .replace(/\b(parallel|manga|sp|alt\s*art|secret\s*rare)\b/gi, '')
      .replace(/\b(psa|bgs|cgc)\s*\d+\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private detectVariantFromQuery(query: string): string {
    const lowerQuery = query.toLowerCase();

    if (lowerQuery.includes('manga')) return 'manga';
    if (lowerQuery.includes('parallel')) return 'parallel';
    if (lowerQuery.includes('alt art') || lowerQuery.includes('alternate art')) return 'alt-art';
    if (lowerQuery.includes('sp') || lowerQuery.includes('special art')) return 'sp';
    if (lowerQuery.includes('secret rare')) return 'secret-rare';
    if (lowerQuery.includes('box topper') || lowerQuery.includes('boxtopper')) return 'boxtopper';

    return 'standard';
  }

  private hashQuery(query: string): string {
    // Simple hash for query deduplication
    let hash = 0;
    for (let i = 0; i < query.length; i++) {
      const char = query.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(36).substring(0, 8);
  }

  // ===========================================================================
  // NEUROTRANSMITTER SELECTION
  // ===========================================================================

  protected selectNeurotransmitter(output: RawPriceSignal): NeurotransmitterType {
    const prices = [output.priceFrom, output.priceTrend, output.priceAvg].filter(
      (p): p is number => p !== null && p > 0
    );

    if (prices.length === 0) {
      return NeurotransmitterType.GABA; // Inhibitory - no data
    }

    const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;

    // High-value cards (>$100 USD) trigger attention
    if (avgPrice >= 100) {
      return NeurotransmitterType.NOREPINEPHRINE;
    }

    // Good sample size indicates reliable data
    if (prices.length >= 3) {
      return NeurotransmitterType.SEROTONIN; // Confidence signal
    }

    // Standard signal
    return NeurotransmitterType.GLUTAMATE;
  }

  protected calculateSignalStrength(output: RawPriceSignal): number {
    let strength = 0.5;

    // More price data = stronger signal
    const priceCount = [output.priceFrom, output.priceTrend, output.priceAvg].filter(
      (p) => p !== null && p > 0
    ).length;
    strength += priceCount * 0.1;

    // Higher value = stronger signal
    const avgPrice = output.priceAvg || output.priceTrend || output.priceFrom || 0;
    if (avgPrice >= 50) {
      strength += 0.2;
    } else if (avgPrice >= 20) {
      strength += 0.1;
    }

    return Math.min(strength, 1.0);
  }

  // ===========================================================================
  // STATISTICS
  // ===========================================================================

  private logStats(): void {
    console.log(`\n📊 [${this.name}] eBay Receptor Statistics:`);
    console.log(`   Queries processed: ${this.stats.queriesProcessed}`);
    console.log(`   Listings received: ${this.stats.listingsReceived}`);
    console.log(`   Listings accepted: ${this.stats.listingsAccepted}`);
    console.log(`   Listings rejected: ${this.stats.listingsRejected}`);
    console.log(`   Outliers pruned: ${this.stats.outliersPruned}`);
    console.log(`   FX conversions: ${this.stats.fxConversions}`);
    console.log(`   Average price (USD): $${this.stats.avgPriceUsd.toFixed(2)}`);
    console.log(`   Cache hits: ${this.stats.cacheHits}`);
    console.log(`   Cache misses: ${this.stats.cacheMisses}`);

    if (this.stats.byCondition.size > 0) {
      console.log(`   By condition:`);
      this.stats.byCondition.forEach((count, condition) => {
        console.log(`     - ${condition}: ${count}`);
      });
    }

    if (this.stats.byListingType.size > 0) {
      console.log(`   By listing type:`);
      this.stats.byListingType.forEach((count, type) => {
        console.log(`     - ${type}: ${count}`);
      });
    }
  }

  getStats(): EbayReceptorStats {
    return { ...this.stats };
  }

  // ===========================================================================
  // FX RATE INJECTION (for testing)
  // ===========================================================================

  setFxProvider(provider: FXRateProvider): void {
    this.fxProvider = provider;
  }

  injectFxRate(from: string, to: string, rate: number): void {
    const pair = `${from}/${to}`;
    this.fxCache.set(pair, { rate, timestamp: new Date() });
  }

  // ===========================================================================
  // QUERY CACHE ACCESS
  // ===========================================================================

  getCachedResult(query: string): EbaySearchResult | undefined {
    const cached = this.queryCache.get(query);
    if (cached) {
      this.stats.cacheHits++;
    } else {
      this.stats.cacheMisses++;
    }
    return cached;
  }

  clearQueryCache(): void {
    this.queryCache.clear();
  }
}

// =============================================================================
// SUPPORTING TYPES
// =============================================================================

interface EbayReceptorStats {
  queriesProcessed: number;
  listingsReceived: number;
  listingsAccepted: number;
  listingsRejected: number;
  outliersPruned: number;
  fxConversions: number;
  cacheHits: number;
  cacheMisses: number;
  avgPriceUsd: number;
  byCondition: Map<string, number>;
  byListingType: Map<string, number>;
}
