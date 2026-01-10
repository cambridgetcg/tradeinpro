/**
 * OPTCG API Client
 *
 * Client for the free OPTCG (One Piece TCG) API.
 * Primary data source for One Piece cards - no API key required.
 *
 * API Documentation: https://www.optcgapi.com/api
 */

import { config } from '../config/index.js';
import {
  BaseCardApiClient,
  CurrencyConverter,
  type NormalizedCard,
  type NormalizedSet,
  type SearchParams,
} from './base-client.js';

/**
 * Raw card data from OPTCG API
 */
export interface OptcgCard {
  id: string;
  name: string;
  card_number: string;
  set_code: string;
  rarity: string;
  type: string;
  color: string | string[];
  cost?: number;
  power?: number;
  counter?: number;
  attribute?: string;
  effect?: string;
  trigger?: string;
  image_url: string;
  tcgplayer_price?: number;
  tcgplayer_url?: string;
}

/**
 * Raw set data from OPTCG API
 */
export interface OptcgSet {
  id: string;
  name: string;
  code: string;
  release_date: string;
  card_count: number;
}

/**
 * API response wrapper
 */
export interface OptcgResponse<T> {
  success: boolean;
  data: T;
  error?: string;
  count?: number;
  page?: number;
  totalPages?: number;
}

/**
 * OPTCG-specific search parameters
 */
export interface OptcgSearchParams {
  name?: string;
  set_code?: string;
  card_number?: string;
  rarity?: string;
  type?: string;
  color?: string;
  page?: number;
  limit?: number;
}

/**
 * Error types
 */
export class OptcgApiError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public endpoint: string
  ) {
    super(message);
    this.name = 'OptcgApiError';
  }
}

/**
 * OPTCG API Client - implements base interface
 */
export class OptcgClient extends BaseCardApiClient {
  readonly game = 'onepiece' as const;
  readonly name = 'OPTCG API';

  private baseUrl: string;
  private timeout: number;
  private retryAttempts: number;
  private retryDelay: number;

  constructor(options?: Partial<{
    baseUrl: string;
    timeout: number;
    retryAttempts: number;
    retryDelay: number;
  }>) {
    super();
    this.baseUrl = options?.baseUrl || config.dataSources.optcg.baseUrl;
    this.timeout = options?.timeout || config.dataSources.optcg.timeout;
    this.retryAttempts = options?.retryAttempts || config.dataSources.optcg.retryAttempts;
    this.retryDelay = options?.retryDelay || config.dataSources.optcg.retryDelay;
  }

  /**
   * Make a request to the API with retry logic
   */
  private async request<T>(endpoint: string, params?: Record<string, string | number>): Promise<T> {
    const url = new URL(`${this.baseUrl}${endpoint}`);
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          url.searchParams.append(key, String(value));
        }
      });
    }

    const startTime = Date.now();
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.retryAttempts; attempt++) {
      try {
        const timeSinceLastRequest = Date.now() - this.lastRequestTime;
        if (timeSinceLastRequest < 1000) {
          await this.sleep(1000 - timeSinceLastRequest);
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);

        const response = await fetch(url.toString(), {
          method: 'GET',
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'TCGplayer-Scraper/1.0 (Multi-Game Price Tracker)',
          },
          signal: controller.signal,
        });

        clearTimeout(timeoutId);
        this.trackRequest(startTime);

        if (!response.ok) {
          throw new OptcgApiError(
            `API request failed: ${response.statusText}`,
            response.status,
            endpoint
          );
        }

        return await response.json() as T;
      } catch (error) {
        lastError = error as Error;
        this.trackError();

        if (attempt < this.retryAttempts) {
          const delay = this.retryDelay * Math.pow(2, attempt - 1);
          console.log(`OPTCG API request failed (attempt ${attempt}/${this.retryAttempts}), retrying in ${delay}ms...`);
          await this.sleep(delay);
        }
      }
    }

    throw lastError || new Error('Request failed after all retries');
  }

  /**
   * Normalize OPTCG card to generic format
   */
  private normalizeCard(card: OptcgCard): NormalizedCard {
    const priceGbp = card.tcgplayer_price
      ? CurrencyConverter.usdToGbp(card.tcgplayer_price)
      : undefined;

    // Detect variant from card ID or name
    const isVariant = card.id.includes('-') && card.id.split('-').length > 2;
    const variantType = isVariant ? card.id.split('-').pop() : undefined;

    return {
      id: card.id,
      game: 'onepiece',
      name: card.name,
      setCode: card.set_code,
      cardNumber: card.card_number,
      variantType,
      isVariant,
      priceUsd: card.tcgplayer_price,
      priceGbp,
      rarity: card.rarity,
      imageUrl: card.image_url,
      productUrl: card.tcgplayer_url,
      lastUpdated: new Date(),
      attributes: {
        type: card.type,
        color: card.color,
        cost: card.cost,
        power: card.power,
        counter: card.counter,
        attribute: card.attribute,
        effect: card.effect,
        trigger: card.trigger,
      },
    };
  }

  /**
   * Normalize OPTCG set to generic format
   */
  private normalizeSet(set: OptcgSet): NormalizedSet {
    return {
      code: set.code,
      name: set.name,
      game: 'onepiece',
      releaseDate: set.release_date,
      cardCount: set.card_count,
    };
  }

  /**
   * Get all available sets
   */
  async getSets(): Promise<NormalizedSet[]> {
    const response = await this.request<OptcgResponse<OptcgSet[]>>('/sets');
    return response.data.map((s) => this.normalizeSet(s));
  }

  /**
   * Get cards from a specific set
   */
  async getCardsBySet(setCode: string): Promise<NormalizedCard[]> {
    const response = await this.request<OptcgResponse<OptcgCard[]>>('/cards', {
      set_code: setCode.toUpperCase(),
    });
    return response.data.map((c) => this.normalizeCard(c));
  }

  /**
   * Get a specific card by ID
   */
  async getCard(cardId: string): Promise<NormalizedCard | null> {
    try {
      const response = await this.request<OptcgResponse<OptcgCard>>(`/cards/${cardId}`);
      return this.normalizeCard(response.data);
    } catch {
      return null;
    }
  }

  /**
   * Search cards with filters
   */
  async searchCards(params: SearchParams): Promise<NormalizedCard[]> {
    const queryParams: Record<string, string | number> = {};

    if (params.name) queryParams.name = params.name;
    if (params.setCode) queryParams.set_code = params.setCode;
    if (params.cardNumber) queryParams.card_number = params.cardNumber;
    if (params.rarity) queryParams.rarity = params.rarity;
    if (params.page) queryParams.page = params.page;
    if (params.limit) queryParams.limit = params.limit;

    const response = await this.request<OptcgResponse<OptcgCard[]>>('/cards', queryParams);
    return response.data.map((c) => this.normalizeCard(c));
  }

  /**
   * Get all cards with prices (for bulk fetching)
   */
  async getAllCardsWithPrices(options?: {
    setCode?: string;
    onProgress?: (loaded: number, total: number) => void;
  }): Promise<NormalizedCard[]> {
    const allCards: NormalizedCard[] = [];
    let page = 1;
    const limit = 100;
    let hasMore = true;

    while (hasMore) {
      const params: SearchParams = { page, limit };
      if (options?.setCode) {
        params.setCode = options.setCode;
      }

      const cards = await this.searchCards(params);

      if (cards.length === 0) {
        hasMore = false;
      } else {
        allCards.push(...cards);
        options?.onProgress?.(allCards.length, allCards.length + (cards.length === limit ? limit : 0));
        page++;
        await this.sleep(500);
      }
    }

    return allCards;
  }

  /**
   * Get raw OPTCG card data (for direct API access)
   */
  async getRawCardsBySet(setCode: string): Promise<OptcgCard[]> {
    const response = await this.request<OptcgResponse<OptcgCard[]>>('/cards', {
      set_code: setCode.toUpperCase(),
    });
    return response.data;
  }
}

/**
 * Create OPTCG client instance
 */
export function createOptcgClient(options?: Partial<{
  baseUrl: string;
  timeout: number;
  retryAttempts: number;
  retryDelay: number;
}>): OptcgClient {
  return new OptcgClient(options);
}

export default OptcgClient;
