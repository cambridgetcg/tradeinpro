/**
 * TCGPlayer Search API Scraper
 *
 * Uses TCGPlayer's public search API to fetch:
 * - Product data (name, prices, metadata)
 * - Individual seller listings (seller, price, condition, quantity)
 *
 * This is the PRIMARY data source for individual listings.
 * Much more reliable than HTML scraping since it uses the same API
 * that powers the TCGPlayer website.
 *
 * API Endpoint: https://mp-search-api.tcgplayer.com/v1/search/request
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * DOCUMENTATION REFERENCES (Symbiotic Code ↔ Docs)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * @see {@link file://../../../docs/SCRAPER_ARCHITECTURE_INSIGHTS.md} - Comprehensive architecture comparison
 *   - Section 1: Data Collection Strategies (API-First Approach)
 *   - Section 2.3: Rate Limiting Strategies
 *   - Section 2.4: Retry Logic (Exponential Backoff)
 *   - Section 3: Data Model Comparison (TCGPlayerListingResult)
 *   - Section 9: Code Patterns to Reuse
 *
 * @see {@link file://../../../docs/HYBRID_PIPELINE_ARCHITECTURE.md} - Integration with JustTCG API
 *   - How this scraper fits into the hybrid pipeline
 *   - Fallback strategies when API fails
 *
 * @see {@link file://../../../docs/TCGPLAYER_STACK_ANALYSIS.md} - Platform technical analysis
 *   - Why HTML scraping fails (SPA architecture)
 *   - API endpoint discovery process
 *
 * @see {@link file://../../../docs/README.md} - TCGPlayer documentation index
 *
 * Related Code Files:
 * @see {@link file://./tcgplayer-brightdata-scraper.ts} - Deprecated HTML scraper (for reference)
 * @see {@link file://../../scripts/test-search-api-scraper.ts} - Test script
 * @see {@link file://../../scripts/daily-archive-local.ts} - Daily archive integration
 * @see {@link file://../collectors/cardmarket-collector.ts} - CardMarket comparison implementation
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * @module scrapers/tcgplayer-search-api-scraper
 * @author TCG Data Pipeline Team
 * @since 2026-01-10
 */

import type { GameCode } from '../config/games.js';
import { getSetsByGame, type SetInfo } from '../config/sets.js';

// ============================================================================
// Types
// ============================================================================

export interface TCGPlayerSearchConfig {
  requestDelayMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
  maxListingsPerProduct?: number;
  includeListings?: boolean;
  pageSize?: number;
}

export interface TCGPlayerProductResult {
  productId: number;
  productName: string;
  productLineName: string;
  setName: string;
  setUrlName: string;
  cardNumber: string | null;
  rarity: string | null;
  marketPrice: number | null;
  medianPrice: number | null;
  lowestPrice: number | null;
  lowestPriceWithShipping: number | null;
  totalListings: number;
  imageUrl: string | null;
  foilOnly: boolean;
  customAttributes: {
    number?: string;
    color?: string[];
    cardType?: string[];
    rarityDbName?: string;
    power?: string;
    cost?: string;
    counter?: string;
    subtypes?: string[];
  };
  listings: TCGPlayerListingResult[];
  scrapedAt: string;
}

export interface TCGPlayerListingResult {
  listingId: number;
  sellerId: string;
  sellerName: string;
  sellerRating: number;
  sellerSales: number;
  goldSeller: boolean;
  verifiedSeller: boolean;
  directSeller: boolean;
  condition: string;
  conditionId: number;
  printing: string;
  language: string;
  languageAbbreviation: string;
  price: number;
  shippingPrice: number;
  quantity: number;
  productConditionId: number;
}

export interface ScrapeMetrics {
  runId: string;
  startTime: Date;
  endTime?: Date;
  setsProcessed: number;
  productsScraped: number;
  listingsScraped: number;
  apiCalls: number;
  errors: number;
  retries: number;
  durationMs?: number;
}

// Internal API response types
interface SearchAPIResponse {
  errors: unknown[];
  results: SearchResult[];
}

interface SearchResult {
  aggregations?: Record<string, unknown>;
  results?: ProductData[];
}

interface ProductData {
  productId: number;
  productName: string;
  productLineName: string;
  setName: string;
  setUrlName: string;
  rarityName: string;
  marketPrice: number | null;
  medianPrice: number | null;
  lowestPrice: number | null;
  lowestPriceWithShipping: number | null;
  totalListings: number;
  foilOnly: boolean;
  productStatusId: number;
  customAttributes?: {
    number?: string;
    color?: string[];
    cardType?: string[];
    rarityDbName?: string;
    power?: string;
    cost?: string;
    counter?: string;
    subtypes?: string[];
  };
  listings?: ListingData[];
}

interface ListingData {
  listingId: number;
  sellerId: string;
  sellerName: string;
  sellerRating: number;
  sellerSales: string;
  goldSeller: boolean;
  verifiedSeller: boolean;
  directSeller: boolean;
  condition: string;
  conditionId: number;
  printing: string;
  language: string;
  languageAbbreviation: string;
  price: number;
  shippingPrice: number;
  quantity: number;
  productConditionId: number;
  productId: number;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_CONFIG: Required<TCGPlayerSearchConfig> = {
  requestDelayMs: 1500,  // Be nice to the API
  maxRetries: 3,
  retryDelayMs: 3000,
  maxListingsPerProduct: 50,
  includeListings: true,
  pageSize: 50,  // Max results per page
};

const SEARCH_API_URL = 'https://mp-search-api.tcgplayer.com/v1/search/request';

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// TCGPlayer game slugs for the productLineName filter
const GAME_SLUGS: Record<GameCode, string> = {
  'onepiece': 'one-piece-card-game',
  'pokemon': 'pokemon',
  'mtg': 'magic-the-gathering',
  'yugioh': 'yugioh',
  'lorcana': 'disney-lorcana-tcg',
  'digimon': 'digimon-card-game',
  'flesh-and-blood': 'flesh-and-blood-tcg',
  'star-wars-unlimited': 'star-wars-unlimited',
  'union-arena': 'union-arena',
  'weiss-schwarz': 'weiss-schwarz',
  'dragonball-super': 'dragon-ball-super-card-game',
  'custom': 'custom',
};

// ============================================================================
// TCGPlayer Search API Scraper
// ============================================================================

export class TCGPlayerSearchAPIScraper {
  private config: Required<TCGPlayerSearchConfig>;
  private game: GameCode;
  private gameSlug: string;
  private lastRequestTime = 0;
  private errors: string[] = [];
  private metrics: ScrapeMetrics;

  constructor(game: GameCode, config?: TCGPlayerSearchConfig) {
    this.game = game;
    this.gameSlug = GAME_SLUGS[game] || game;
    this.config = { ...DEFAULT_CONFIG, ...config };

    this.metrics = {
      runId: `search-${Date.now()}`,
      startTime: new Date(),
      setsProcessed: 0,
      productsScraped: 0,
      listingsScraped: 0,
      apiCalls: 0,
      errors: 0,
      retries: 0,
    };
  }

  /**
   * Rate limiting helper
   */
  private async rateLimit(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;
    const minDelay = this.config.requestDelayMs;

    if (elapsed < minDelay) {
      await new Promise(resolve => setTimeout(resolve, minDelay - elapsed));
    }

    this.lastRequestTime = Date.now();
  }

  /**
   * Build search request body
   */
  private buildSearchBody(setSlug: string, from: number = 0): Record<string, unknown> {
    const body: Record<string, unknown> = {
      algorithm: 'sales_exp_fields_boosting',
      from,
      size: this.config.pageSize,
      filters: {
        term: {
          productLineName: [this.gameSlug],
          setName: [setSlug],
        },
        range: {},
        match: {},
      },
      context: {
        cart: {},
        shippingCountry: 'US',
      },
      sort: {
        field: 'product-name',
        order: 'asc',
      },
    };

    // Include listing details if requested
    if (this.config.includeListings) {
      body.listingSearch = {
        filters: {
          term: {},
          range: {},
          exclude: {
            channelExclusion: 0,
          },
        },
      };
    }

    return body;
  }

  /**
   * Execute search API request with retry logic
   */
  private async executeSearch(body: Record<string, unknown>): Promise<SearchAPIResponse | null> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
      try {
        await this.rateLimit();
        this.metrics.apiCalls++;

        const response = await fetch(SEARCH_API_URL, {
          method: 'POST',
          headers: {
            'Accept': 'application/json',
            'Accept-Language': 'en-US,en;q=0.9',
            'Content-Type': 'application/json',
            'User-Agent': USER_AGENT,
            'Origin': 'https://www.tcgplayer.com',
            'Referer': 'https://www.tcgplayer.com/',
          },
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          throw new Error(`API error ${response.status}`);
        }

        const data = await response.json() as SearchAPIResponse;
        return data;

      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        this.metrics.retries++;

        if (attempt < this.config.maxRetries) {
          const delay = this.config.retryDelayMs * Math.pow(2, attempt - 1);
          console.log(`   ⚠️ Retry ${attempt}/${this.config.maxRetries} in ${delay}ms: ${lastError.message}`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    this.metrics.errors++;
    if (lastError) {
      this.errors.push(`Search API error: ${lastError.message}`);
    }
    return null;
  }

  /**
   * Parse API response into product results
   */
  private parseResults(response: SearchAPIResponse): TCGPlayerProductResult[] {
    const products: TCGPlayerProductResult[] = [];
    const now = new Date().toISOString();

    // Response structure: { results: [{ aggregations, results: [...products] }] }
    for (const result of response.results) {
      if (!result.results) continue;

      for (const product of result.results) {
        // Skip products without market data
        if (!product.productId) continue;

        const cardNumber = product.customAttributes?.number || null;

        const productResult: TCGPlayerProductResult = {
          productId: product.productId,
          productName: product.productName,
          productLineName: product.productLineName,
          setName: product.setName,
          setUrlName: product.setUrlName,
          cardNumber,
          rarity: product.rarityName || null,
          marketPrice: product.marketPrice,
          medianPrice: product.medianPrice,
          lowestPrice: product.lowestPrice,
          lowestPriceWithShipping: product.lowestPriceWithShipping,
          totalListings: product.totalListings || 0,
          imageUrl: null, // Not returned in search API
          foilOnly: product.foilOnly || false,
          customAttributes: product.customAttributes || {},
          listings: [],
          scrapedAt: now,
        };

        // Parse listings if present
        if (product.listings && Array.isArray(product.listings)) {
          for (const listing of product.listings.slice(0, this.config.maxListingsPerProduct)) {
            productResult.listings.push({
              listingId: listing.listingId,
              sellerId: listing.sellerId,
              sellerName: listing.sellerName,
              sellerRating: listing.sellerRating,
              sellerSales: parseInt(listing.sellerSales, 10) || 0,
              goldSeller: listing.goldSeller || false,
              verifiedSeller: listing.verifiedSeller || false,
              directSeller: listing.directSeller || false,
              condition: listing.condition,
              conditionId: listing.conditionId,
              printing: listing.printing,
              language: listing.language,
              languageAbbreviation: listing.languageAbbreviation,
              price: listing.price,
              shippingPrice: listing.shippingPrice,
              quantity: listing.quantity,
              productConditionId: listing.productConditionId,
            });

            this.metrics.listingsScraped++;
          }
        }

        products.push(productResult);
        this.metrics.productsScraped++;
      }
    }

    return products;
  }

  /**
   * Scrape a single set
   */
  async scrapeSet(setCode: string, options?: { maxProducts?: number }): Promise<TCGPlayerProductResult[]> {
    const sets = getSetsByGame(this.game);
    const set = sets.find(s => s.code.toUpperCase() === setCode.toUpperCase());

    if (!set) {
      throw new Error(`Set ${setCode} not found for game ${this.game}`);
    }

    console.log(`\n📦 Scraping set: ${set.name} (${set.code})`);
    console.log(`   TCGPlayer slug: ${set.tcgplayerSlug}`);

    const allProducts: TCGPlayerProductResult[] = [];
    let from = 0;
    let hasMore = true;
    const maxProducts = options?.maxProducts || Infinity;

    while (hasMore && allProducts.length < maxProducts) {
      console.log(`   Fetching products ${from + 1}-${from + this.config.pageSize}...`);

      const body = this.buildSearchBody(set.tcgplayerSlug, from);
      const response = await this.executeSearch(body);

      if (!response) {
        console.log(`   ❌ Failed to fetch page at offset ${from}`);
        break;
      }

      const products = this.parseResults(response);

      if (products.length === 0) {
        hasMore = false;
      } else {
        allProducts.push(...products);
        from += this.config.pageSize;

        // Check if we got fewer than pageSize (last page)
        if (products.length < this.config.pageSize) {
          hasMore = false;
        }

        console.log(`   ✅ Got ${products.length} products (total: ${allProducts.length})`);
      }
    }

    this.metrics.setsProcessed++;
    console.log(`   ✅ Set complete: ${allProducts.length} products, ${this.metrics.listingsScraped} listings`);

    return allProducts.slice(0, maxProducts);
  }

  /**
   * Scrape multiple sets
   */
  async scrapeSets(setCodes?: string[], options?: { maxProductsPerSet?: number }): Promise<TCGPlayerProductResult[]> {
    const sets = getSetsByGame(this.game);
    const setsToScrape = setCodes
      ? sets.filter(s => setCodes.map(c => c.toUpperCase()).includes(s.code.toUpperCase()))
      : sets.filter(s => s.isReleased);

    console.log(`\n🎴 TCGPlayer Search API Scraper - ${this.game}`);
    console.log(`   Sets to scrape: ${setsToScrape.map(s => s.code).join(', ')}`);

    const allProducts: TCGPlayerProductResult[] = [];

    for (const set of setsToScrape) {
      try {
        const products = await this.scrapeSet(set.code, {
          maxProducts: options?.maxProductsPerSet,
        });
        allProducts.push(...products);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.log(`   ❌ Error scraping ${set.code}: ${msg}`);
        this.errors.push(`Set ${set.code}: ${msg}`);
      }
    }

    return allProducts;
  }

  /**
   * Scrape a single product by ID
   */
  async scrapeProduct(productId: number): Promise<TCGPlayerProductResult | null> {
    console.log(`📦 Fetching product ${productId}...`);

    const body = {
      algorithm: 'listings',
      from: 0,
      size: this.config.maxListingsPerProduct,
      filters: {
        term: {
          productId: [productId],
        },
        range: {},
        match: {},
      },
      listingSearch: {
        filters: {
          term: {},
          range: {},
          exclude: {
            channelExclusion: 0,
          },
        },
      },
      context: {
        cart: {},
        shippingCountry: 'US',
      },
      sort: {
        field: 'price',
        order: 'asc',
      },
    };

    const response = await this.executeSearch(body);
    if (!response) return null;

    const products = this.parseResults(response);
    return products.length > 0 ? products[0] : null;
  }

  /**
   * Get available sets
   */
  getAvailableSets(): SetInfo[] {
    return getSetsByGame(this.game).filter(s => s.isReleased);
  }

  /**
   * Get scrape metrics
   */
  getMetrics(): ScrapeMetrics {
    return {
      ...this.metrics,
      endTime: new Date(),
      durationMs: Date.now() - this.metrics.startTime.getTime(),
    };
  }

  /**
   * Get errors
   */
  getErrors(): string[] {
    return [...this.errors];
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createTCGPlayerSearchScraper(
  game: GameCode,
  config?: TCGPlayerSearchConfig
): TCGPlayerSearchAPIScraper {
  return new TCGPlayerSearchAPIScraper(game, config);
}

export default TCGPlayerSearchAPIScraper;
