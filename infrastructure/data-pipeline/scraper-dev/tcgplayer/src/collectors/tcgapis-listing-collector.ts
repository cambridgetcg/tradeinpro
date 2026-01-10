/**
 * TCGAPIs Listing Collector
 *
 * Collects individual listings from TCGplayer via TCGAPIs service.
 * Provides listing-level data needed for the Sniper model.
 *
 * Service: https://tcgapis.com/
 * Plan Required: Unlimited (£499/mo) for live listings
 *
 * Features:
 * - Live TCGplayer listings (hourly updates)
 * - SKU-level pricing by condition
 * - Sales history for training labels
 * - No rate limits on Unlimited plan
 */

import type { GameCode } from '../config/games.js';

/**
 * TCGAPIs configuration
 */
export interface TCGApisConfig {
  apiKey: string;
  baseUrl?: string;
  timeout?: number;
}

/**
 * Condition types matching TCGplayer
 */
export type CardCondition = 'NM' | 'LP' | 'MP' | 'HP' | 'DMG';

/**
 * Individual seller listing
 */
export interface SellerListing {
  sellerId: string;
  sellerName: string;
  sellerRating: number;
  sellerSalesCount: number;
  price: number;
  condition: CardCondition;
  quantity: number;
  shippingCost: number;
  language: string;
  isFeatured: boolean;
  listingId?: string;
}

/**
 * Complete listing data for a card
 */
export interface ListingData {
  cardId: string;
  tcgplayerProductId: string;
  platform: 'tcgplayer';
  name: string;
  setCode: string;
  listings: SellerListing[];
  marketPrice: number;
  lowPrice: number;
  midPrice: number;
  highPrice: number;
  listingCount: number;
  lastUpdated: Date;
}

/**
 * Sales history record
 */
export interface SaleRecord {
  date: Date;
  price: number;
  condition: CardCondition;
  quantity: number;
  shippingIncluded: boolean;
}

/**
 * Sales history for a card
 */
export interface SalesHistory {
  cardId: string;
  tcgplayerProductId: string;
  totalSales: number;
  totalQuantity: number;
  avgPrice: number;
  minPrice: number;
  maxPrice: number;
  sales: SaleRecord[];
  period: {
    startDate: Date;
    endDate: Date;
    days: number;
  };
}

/**
 * Listing with outcome for training data
 */
export interface ListingOutcome {
  listingId: string;
  cardId: string;
  sellerId: string;
  price: number;
  condition: CardCondition;
  marketPriceAtListing: number;
  lowPriceAtListing: number;
  discountFromMarket: number;
  discountFromLow: number;
  sellerRating: number;
  sellerSalesCount: number;
  firstSeenAt: Date;
  soldAt: Date | null;
  timeToSellMinutes: number | null;
  soldFast: boolean; // Sold within 1 hour
}

/**
 * TCGAPIs client error
 */
export class TCGApisError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public endpoint: string
  ) {
    super(message);
    this.name = 'TCGApisError';
  }
}

/**
 * TCGAPIs Listing Collector
 */
export class TCGApisListingCollector {
  private apiKey: string;
  private baseUrl: string;
  private timeout: number;

  // Statistics
  private requestCount = 0;
  private errorCount = 0;
  private lastRequestTime = 0;

  constructor(config: TCGApisConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || 'https://api.tcgapis.com/v1';
    this.timeout = config.timeout || 30000;
  }

  /**
   * Make authenticated request to TCGAPIs
   */
  private async request<T>(
    endpoint: string,
    options: {
      method?: 'GET' | 'POST';
      body?: Record<string, unknown>;
      params?: Record<string, string | number>;
    } = {}
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${endpoint}`);

    if (options.params) {
      Object.entries(options.params).forEach(([key, value]) => {
        url.searchParams.append(key, String(value));
      });
    }

    const startTime = Date.now();

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(url.toString(), {
        method: options.method || 'GET',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      this.requestCount++;
      this.lastRequestTime = Date.now();

      if (!response.ok) {
        this.errorCount++;
        const errorBody = await response.text();
        throw new TCGApisError(
          `API request failed: ${response.statusText} - ${errorBody}`,
          response.status,
          endpoint
        );
      }

      return await response.json() as T;
    } catch (error) {
      if (error instanceof TCGApisError) throw error;

      this.errorCount++;
      throw new TCGApisError(
        `Request failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        0,
        endpoint
      );
    }
  }

  /**
   * Fetch live listings for a card
   *
   * Returns all active seller listings with prices and conditions.
   */
  async getListings(productId: string): Promise<ListingData> {
    interface ListingsResponse {
      productId: string;
      name: string;
      setCode: string;
      marketPrice: number;
      lowPrice: number;
      midPrice: number;
      highPrice: number;
      lastUpdated: string;
      listings: Array<{
        id?: string;
        seller: {
          id: string;
          name: string;
          rating: number;
          salesCount: number;
        };
        price: number;
        condition: string;
        quantity: number;
        shipping: number;
        language: string;
        featured: boolean;
      }>;
    }

    const response = await this.request<ListingsResponse>(
      `/tcgplayer/products/${productId}/listings`
    );

    return {
      cardId: productId,
      tcgplayerProductId: productId,
      platform: 'tcgplayer',
      name: response.name,
      setCode: response.setCode,
      marketPrice: response.marketPrice,
      lowPrice: response.lowPrice,
      midPrice: response.midPrice,
      highPrice: response.highPrice,
      listingCount: response.listings.length,
      lastUpdated: new Date(response.lastUpdated),
      listings: response.listings.map((l) => ({
        listingId: l.id,
        sellerId: l.seller.id,
        sellerName: l.seller.name,
        sellerRating: l.seller.rating,
        sellerSalesCount: l.seller.salesCount,
        price: l.price,
        condition: this.mapCondition(l.condition),
        quantity: l.quantity,
        shippingCost: l.shipping || 0,
        language: l.language || 'English',
        isFeatured: l.featured || false,
      })),
    };
  }

  /**
   * Fetch listings for multiple cards in a single request
   *
   * More efficient than individual calls for bulk operations.
   */
  async batchGetListings(productIds: string[]): Promise<Map<string, ListingData>> {
    interface BatchResponse {
      results: Array<{
        productId: string;
        name: string;
        setCode: string;
        marketPrice: number;
        lowPrice: number;
        midPrice: number;
        highPrice: number;
        lastUpdated: string;
        listings: Array<{
          id?: string;
          seller: {
            id: string;
            name: string;
            rating: number;
            salesCount: number;
          };
          price: number;
          condition: string;
          quantity: number;
          shipping: number;
          language: string;
          featured: boolean;
        }>;
      }>;
    }

    const results = new Map<string, ListingData>();

    // TCGAPIs supports batch requests up to 100 products
    const batches = this.chunk(productIds, 100);

    for (const batch of batches) {
      const response = await this.request<BatchResponse>(
        '/tcgplayer/products/batch/listings',
        {
          method: 'POST',
          body: { productIds: batch },
        }
      );

      for (const item of response.results) {
        results.set(item.productId, {
          cardId: item.productId,
          tcgplayerProductId: item.productId,
          platform: 'tcgplayer',
          name: item.name,
          setCode: item.setCode,
          marketPrice: item.marketPrice,
          lowPrice: item.lowPrice,
          midPrice: item.midPrice,
          highPrice: item.highPrice,
          listingCount: item.listings.length,
          lastUpdated: new Date(item.lastUpdated),
          listings: item.listings.map((l) => ({
            listingId: l.id,
            sellerId: l.seller.id,
            sellerName: l.seller.name,
            sellerRating: l.seller.rating,
            sellerSalesCount: l.seller.salesCount,
            price: l.price,
            condition: this.mapCondition(l.condition),
            quantity: l.quantity,
            shippingCost: l.shipping || 0,
            language: l.language || 'English',
            isFeatured: l.featured || false,
          })),
        });
      }
    }

    return results;
  }

  /**
   * Fetch sales history for a card
   *
   * Returns historical sales data for training the Sniper model.
   */
  async getSalesHistory(productId: string, days: number = 90): Promise<SalesHistory> {
    interface SalesResponse {
      productId: string;
      totalSales: number;
      totalQuantity: number;
      avgPrice: number;
      minPrice: number;
      maxPrice: number;
      startDate: string;
      endDate: string;
      sales: Array<{
        date: string;
        price: number;
        condition: string;
        quantity: number;
        shippingIncluded: boolean;
      }>;
    }

    const response = await this.request<SalesResponse>(
      `/tcgplayer/products/${productId}/sales`,
      { params: { days } }
    );

    return {
      cardId: productId,
      tcgplayerProductId: productId,
      totalSales: response.totalSales,
      totalQuantity: response.totalQuantity,
      avgPrice: response.avgPrice,
      minPrice: response.minPrice,
      maxPrice: response.maxPrice,
      period: {
        startDate: new Date(response.startDate),
        endDate: new Date(response.endDate),
        days,
      },
      sales: response.sales.map((s) => ({
        date: new Date(s.date),
        price: s.price,
        condition: this.mapCondition(s.condition),
        quantity: s.quantity,
        shippingIncluded: s.shippingIncluded,
      })),
    };
  }

  /**
   * Search for products by name or set
   */
  async searchProducts(
    query: string,
    options: {
      game?: string;
      setCode?: string;
      limit?: number;
    } = {}
  ): Promise<Array<{ productId: string; name: string; setCode: string; marketPrice: number }>> {
    interface SearchResponse {
      results: Array<{
        productId: string;
        name: string;
        setCode: string;
        marketPrice: number;
      }>;
      total: number;
    }

    const response = await this.request<SearchResponse>('/tcgplayer/products/search', {
      params: {
        q: query,
        ...(options.game && { game: options.game }),
        ...(options.setCode && { set: options.setCode }),
        limit: options.limit || 50,
      },
    });

    return response.results;
  }

  /**
   * Get market prices for multiple products
   */
  async batchGetPrices(productIds: string[]): Promise<Map<string, {
    marketPrice: number;
    lowPrice: number;
    midPrice: number;
    highPrice: number;
  }>> {
    interface PricesResponse {
      results: Array<{
        productId: string;
        marketPrice: number;
        lowPrice: number;
        midPrice: number;
        highPrice: number;
      }>;
    }

    const results = new Map();
    const batches = this.chunk(productIds, 100);

    for (const batch of batches) {
      const response = await this.request<PricesResponse>(
        '/tcgplayer/products/batch/prices',
        {
          method: 'POST',
          body: { productIds: batch },
        }
      );

      for (const item of response.results) {
        results.set(item.productId, {
          marketPrice: item.marketPrice,
          lowPrice: item.lowPrice,
          midPrice: item.midPrice,
          highPrice: item.highPrice,
        });
      }
    }

    return results;
  }

  /**
   * Generate training data from listing tracking
   *
   * Compares current listings to previous snapshot to detect sold items.
   */
  generateTrainingData(
    currentListings: ListingData,
    previousListings: Map<string, {
      sellerId: string;
      price: number;
      condition: CardCondition;
      firstSeenAt: Date;
      marketPriceAtListing: number;
      lowPriceAtListing: number;
      sellerRating: number;
      sellerSalesCount: number;
    }>
  ): ListingOutcome[] {
    const outcomes: ListingOutcome[] = [];
    const now = new Date();

    // Create set of current listing keys
    const currentKeys = new Set(
      currentListings.listings.map((l) =>
        `${l.sellerId}-${l.price.toFixed(2)}-${l.condition}`
      )
    );

    // Check which previous listings are gone (sold)
    for (const [key, prev] of previousListings) {
      if (!currentKeys.has(key)) {
        // Listing is gone - likely sold
        const timeToSellMinutes = Math.floor(
          (now.getTime() - prev.firstSeenAt.getTime()) / (1000 * 60)
        );

        outcomes.push({
          listingId: key,
          cardId: currentListings.cardId,
          sellerId: prev.sellerId,
          price: prev.price,
          condition: prev.condition,
          marketPriceAtListing: prev.marketPriceAtListing,
          lowPriceAtListing: prev.lowPriceAtListing,
          discountFromMarket: prev.marketPriceAtListing > 0
            ? (prev.marketPriceAtListing - prev.price) / prev.marketPriceAtListing
            : 0,
          discountFromLow: prev.lowPriceAtListing > 0
            ? (prev.lowPriceAtListing - prev.price) / prev.lowPriceAtListing
            : 0,
          sellerRating: prev.sellerRating,
          sellerSalesCount: prev.sellerSalesCount,
          firstSeenAt: prev.firstSeenAt,
          soldAt: now,
          timeToSellMinutes,
          soldFast: timeToSellMinutes < 60,
        });
      }
    }

    return outcomes;
  }

  /**
   * Map condition string to normalized type
   */
  private mapCondition(raw: string): CardCondition {
    const normalized = raw.toLowerCase().replace(/[^a-z]/g, '');
    const map: Record<string, CardCondition> = {
      'nearmint': 'NM',
      'nm': 'NM',
      'lightlyplayed': 'LP',
      'lp': 'LP',
      'moderatelyplayed': 'MP',
      'mp': 'MP',
      'heavilyplayed': 'HP',
      'hp': 'HP',
      'damaged': 'DMG',
      'dmg': 'DMG',
    };
    return map[normalized] || 'NM';
  }

  /**
   * Split array into chunks
   */
  private chunk<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  /**
   * Get collector statistics
   */
  getStats(): {
    requestCount: number;
    errorCount: number;
    lastRequestTime: number;
    errorRate: number;
  } {
    return {
      requestCount: this.requestCount,
      errorCount: this.errorCount,
      lastRequestTime: this.lastRequestTime,
      errorRate: this.requestCount > 0
        ? this.errorCount / this.requestCount
        : 0,
    };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.requestCount = 0;
    this.errorCount = 0;
    this.lastRequestTime = 0;
  }
}

/**
 * Create TCGAPIs collector instance
 */
export function createTCGApisCollector(config: TCGApisConfig): TCGApisListingCollector {
  return new TCGApisListingCollector(config);
}

export default TCGApisListingCollector;
