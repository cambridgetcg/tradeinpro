/**
 * JustTCG API Client
 *
 * Paid API service supporting multiple TCGs with comprehensive price data.
 * API Documentation: https://justtcg.com/docs
 *
 * Pricing Tiers:
 * - Free: 1,000 req/month, 10/min
 * - Starter ($20): 10,000 req/month, 50/min
 * - Professional ($50): 50,000 req/month, 100/min
 */

import { config } from '../config/index.js';
import type { GameCode } from '../config/games.js';
import {
  BaseCardApiClient,
  CurrencyConverter,
  type NormalizedCard,
  type NormalizedSet,
  type SearchParams,
} from './base-client.js';

/**
 * JustTCG game identifiers
 */
const JUSTTCG_GAME_MAP: Record<GameCode, string> = {
  'onepiece': 'one-piece-tcg',
  'pokemon': 'pokemon-tcg',
  'mtg': 'magic-the-gathering',
  'yugioh': 'yu-gi-oh',
  'lorcana': 'disney-lorcana',
  'flesh-and-blood': 'flesh-and-blood',
  'digimon': 'digimon-card-game',
  'union-arena': 'union-arena',
  'weiss-schwarz': 'weiss-schwarz',
  'dragonball-super': 'dragon-ball-super',
  'star-wars-unlimited': 'star-wars-unlimited',
  'custom': 'custom',
};

/**
 * JustTCG price variant
 */
export interface JustTcgVariant {
  condition: 'Near Mint' | 'Lightly Played' | 'Moderately Played' | 'Heavily Played' | 'Damaged';
  printing: 'Normal' | 'Foil' | 'Reverse Holofoil' | '1st Edition' | string;
  price: {
    usd: number;
    eur?: number;
    gbp?: number;
    updated_at: string;
  };
  history?: {
    '7d'?: number;
    '30d'?: number;
    '90d'?: number;
    '180d'?: number;
  };
}

/**
 * JustTCG raw card response
 */
export interface JustTcgCard {
  id: string;
  name: string;
  game: string;
  set: {
    code: string;
    name: string;
    release_date?: string;
  };
  number: string;
  rarity?: string;
  variants: JustTcgVariant[];
  image_url?: string;
  tcgplayer_url?: string;
  updated_at: string;
}

/**
 * JustTCG raw set response
 */
export interface JustTcgSet {
  code: string;
  name: string;
  game: string;
  card_count: number;
  release_date?: string;
}

/**
 * JustTCG API response wrapper
 */
export interface JustTcgResponse<T> {
  data: T;
  meta?: {
    total: number;
    page: number;
    page_size: number;
    total_pages: number;
  };
  error?: {
    code: string;
    message: string;
  };
}

/**
 * JustTCG API error
 */
export class JustTcgApiError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public code?: string
  ) {
    super(message);
    this.name = 'JustTcgApiError';
  }
}

/**
 * JustTCG API Client - supports multiple games
 */
export class JustTcgClient extends BaseCardApiClient {
  readonly name = 'JustTCG API';
  private _game: GameCode;

  private baseUrl: string;
  private apiKey: string;
  private timeout: number;
  private requestsThisMinute = 0;
  private minuteResetTime = Date.now();

  get game(): GameCode {
    return this._game;
  }

  constructor(options: {
    game: GameCode;
    apiKey: string;
    baseUrl?: string;
    timeout?: number;
  }) {
    super();
    this._game = options.game;
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl || config.dataSources.justTcg.baseUrl;
    this.timeout = options.timeout || 30000;
  }

  /**
   * Get JustTCG game identifier
   */
  private getJustTcgGame(): string {
    return JUSTTCG_GAME_MAP[this._game] || this._game;
  }

  /**
   * Rate limit check and wait
   */
  private async checkRateLimit(): Promise<void> {
    const now = Date.now();

    // Reset counter every minute
    if (now - this.minuteResetTime >= 60000) {
      this.requestsThisMinute = 0;
      this.minuteResetTime = now;
    }

    // JustTCG Starter plan: 50 req/min
    const maxRequestsPerMinute = config.rateLimits.justTcg.requestsPerMinute;
    if (this.requestsThisMinute >= maxRequestsPerMinute) {
      const waitTime = 60000 - (now - this.minuteResetTime);
      console.log(`JustTCG rate limit reached, waiting ${waitTime}ms...`);
      await this.sleep(waitTime + 100);
      this.requestsThisMinute = 0;
      this.minuteResetTime = Date.now();
    }

    this.requestsThisMinute++;
  }

  /**
   * Make authenticated request to JustTCG API
   */
  private async request<T>(endpoint: string, params?: Record<string, string | number>): Promise<T> {
    await this.checkRateLimit();

    const url = new URL(`${this.baseUrl}${endpoint}`);
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          url.searchParams.append(key, String(value));
        }
      });
    }

    const startTime = Date.now();

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'x-api-key': this.apiKey,
          'User-Agent': 'TCGplayer-Scraper/1.0',
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      this.trackRequest(startTime);

      if (response.status === 429) {
        throw new JustTcgApiError('Rate limit exceeded', 429, 'RATE_LIMITED');
      }

      if (response.status === 401) {
        throw new JustTcgApiError('Invalid API key', 401, 'UNAUTHORIZED');
      }

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({})) as { error?: { message?: string; code?: string } };
        throw new JustTcgApiError(
          errorBody.error?.message || `API request failed: ${response.statusText}`,
          response.status,
          errorBody.error?.code
        );
      }

      return await response.json() as T;
    } catch (error) {
      this.trackError();
      throw error;
    }
  }

  /**
   * Extract best price from variants
   */
  private extractBestPrice(variants: JustTcgVariant[]): {
    price?: number;
    variant?: string;
    condition?: string;
  } {
    if (!variants || variants.length === 0) {
      return {};
    }

    // Find Near Mint Normal first
    const nmNormal = variants.find(
      (v) => v.condition === 'Near Mint' && v.printing === 'Normal'
    );
    if (nmNormal?.price?.usd) {
      return { price: nmNormal.price.usd, variant: undefined, condition: 'Near Mint' };
    }

    // Fall back to any Near Mint
    const nm = variants.find((v) => v.condition === 'Near Mint');
    if (nm?.price?.usd) {
      return { price: nm.price.usd, variant: nm.printing, condition: 'Near Mint' };
    }

    // Fall back to first available
    const first = variants[0];
    if (first?.price?.usd) {
      return { price: first.price.usd, variant: first.printing, condition: first.condition };
    }

    return {};
  }

  /**
   * Normalize JustTCG card to generic format
   */
  private normalizeCard(card: JustTcgCard): NormalizedCard {
    const { price, variant, condition } = this.extractBestPrice(card.variants);
    const priceGbp = price ? CurrencyConverter.usdToGbp(price) : undefined;

    // Get foil price if available
    const foilVariant = card.variants.find(
      (v) => v.printing === 'Foil' && v.condition === 'Near Mint'
    );

    return {
      id: card.id,
      game: this._game,
      name: card.name,
      setCode: card.set.code,
      cardNumber: card.number,
      variantType: variant,
      variantName: condition,
      isVariant: !!variant && variant !== 'Normal',
      priceUsd: price,
      priceGbp,
      lowPriceUsd: price, // JustTCG doesn't distinguish low/mid/high in basic response
      midPriceUsd: price,
      marketPriceUsd: price,
      rarity: card.rarity,
      imageUrl: card.image_url,
      productUrl: card.tcgplayer_url,
      lastUpdated: new Date(card.updated_at),
      attributes: {
        setName: card.set.name,
        variants: card.variants.map((v) => ({
          condition: v.condition,
          printing: v.printing,
          priceUsd: v.price.usd,
          history: v.history,
        })),
        foilPriceUsd: foilVariant?.price?.usd,
      },
    };
  }

  /**
   * Normalize JustTCG set to generic format
   */
  private normalizeSet(set: JustTcgSet): NormalizedSet {
    return {
      code: set.code,
      name: set.name,
      game: this._game,
      releaseDate: set.release_date,
      cardCount: set.card_count,
    };
  }

  /**
   * Get all available sets for current game
   */
  async getSets(): Promise<NormalizedSet[]> {
    const response = await this.request<JustTcgResponse<JustTcgSet[]>>('/sets', {
      game: this.getJustTcgGame(),
    });
    return response.data.map((s) => this.normalizeSet(s));
  }

  /**
   * Get cards from a specific set
   */
  async getCardsBySet(setCode: string): Promise<NormalizedCard[]> {
    const allCards: NormalizedCard[] = [];
    let page = 1;
    const pageSize = 200; // JustTCG max batch size
    let hasMore = true;

    while (hasMore) {
      const response = await this.request<JustTcgResponse<JustTcgCard[]>>('/cards', {
        game: this.getJustTcgGame(),
        set: setCode,
        page,
        page_size: pageSize,
      });

      const cards = response.data.map((c) => this.normalizeCard(c));
      allCards.push(...cards);

      if (!response.meta || page >= response.meta.total_pages) {
        hasMore = false;
      } else {
        page++;
        await this.sleep(200); // Small delay between pages
      }
    }

    return allCards;
  }

  /**
   * Get a specific card by ID
   */
  async getCard(cardId: string): Promise<NormalizedCard | null> {
    try {
      const response = await this.request<JustTcgResponse<JustTcgCard>>(`/cards/${cardId}`);
      return this.normalizeCard(response.data);
    } catch (error) {
      if (error instanceof JustTcgApiError && error.statusCode === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Search cards with filters
   */
  async searchCards(params: SearchParams): Promise<NormalizedCard[]> {
    const queryParams: Record<string, string | number> = {
      game: this.getJustTcgGame(),
    };

    if (params.name) queryParams.name = params.name;
    if (params.setCode) queryParams.set = params.setCode;
    if (params.rarity) queryParams.rarity = params.rarity;
    if (params.page) queryParams.page = params.page;
    if (params.limit) queryParams.page_size = Math.min(params.limit, 200);

    const response = await this.request<JustTcgResponse<JustTcgCard[]>>('/cards', queryParams);
    return response.data.map((c) => this.normalizeCard(c));
  }

  /**
   * Batch fetch cards by IDs (up to 200)
   */
  async batchGetCards(cardIds: string[]): Promise<NormalizedCard[]> {
    if (cardIds.length === 0) return [];

    const chunks: string[][] = [];
    for (let i = 0; i < cardIds.length; i += 200) {
      chunks.push(cardIds.slice(i, i + 200));
    }

    const allCards: NormalizedCard[] = [];

    for (const chunk of chunks) {
      const response = await this.request<JustTcgResponse<JustTcgCard[]>>('/cards/batch', {
        ids: chunk.join(','),
      });
      allCards.push(...response.data.map((c) => this.normalizeCard(c)));
      await this.sleep(200);
    }

    return allCards;
  }

  /**
   * Get cards updated after a specific date (delta sync)
   */
  async getUpdatedCards(since: Date, setCode?: string): Promise<NormalizedCard[]> {
    const params: Record<string, string | number> = {
      game: this.getJustTcgGame(),
      updated_after: since.toISOString(),
      page_size: 200,
    };

    if (setCode) {
      params.set = setCode;
    }

    const allCards: NormalizedCard[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      params.page = page;
      const response = await this.request<JustTcgResponse<JustTcgCard[]>>('/cards', params);

      allCards.push(...response.data.map((c) => this.normalizeCard(c)));

      if (!response.meta || page >= response.meta.total_pages) {
        hasMore = false;
      } else {
        page++;
        await this.sleep(200);
      }
    }

    return allCards;
  }

  /**
   * Switch to a different game
   */
  setGame(game: GameCode): void {
    this._game = game;
  }
}

/**
 * Create JustTCG client instance
 */
export function createJustTcgClient(options: {
  game: GameCode;
  apiKey?: string;
}): JustTcgClient | null {
  const apiKey = options.apiKey || config.dataSources.justTcg.apiKey;

  if (!apiKey) {
    console.warn('JustTCG API key not configured');
    return null;
  }

  return new JustTcgClient({
    game: options.game,
    apiKey,
  });
}

export default JustTcgClient;
