/**
 * Pokemon TCG API Client
 *
 * Client for the free Pokemon TCG API.
 * API Documentation: https://docs.pokemontcg.io/
 *
 * Note: This API provides card data but prices come from TCGplayer.
 */

import {
  BaseCardApiClient,
  CurrencyConverter,
  type NormalizedCard,
  type NormalizedSet,
  type SearchParams,
} from './base-client.js';

/**
 * Raw card data from Pokemon TCG API
 */
export interface PokemonCard {
  id: string;
  name: string;
  supertype: string;
  subtypes?: string[];
  hp?: string;
  types?: string[];
  set: {
    id: string;
    name: string;
    series: string;
    releaseDate: string;
    total: number;
  };
  number: string;
  rarity?: string;
  images: {
    small: string;
    large: string;
  };
  tcgplayer?: {
    url: string;
    updatedAt: string;
    prices?: {
      normal?: { low: number; mid: number; high: number; market: number };
      holofoil?: { low: number; mid: number; high: number; market: number };
      reverseHolofoil?: { low: number; mid: number; high: number; market: number };
      firstEditionNormal?: { low: number; mid: number; high: number; market: number };
      firstEditionHolofoil?: { low: number; mid: number; high: number; market: number };
    };
  };
  cardmarket?: {
    url: string;
    updatedAt: string;
    prices?: {
      averageSellPrice: number;
      lowPrice: number;
      trendPrice: number;
    };
  };
}

/**
 * Raw set data from Pokemon TCG API
 */
export interface PokemonSet {
  id: string;
  name: string;
  series: string;
  printedTotal: number;
  total: number;
  releaseDate: string;
  images: {
    symbol: string;
    logo: string;
  };
}

/**
 * API response wrapper
 */
export interface PokemonApiResponse<T> {
  data: T;
  page?: number;
  pageSize?: number;
  count?: number;
  totalCount?: number;
}

/**
 * Pokemon TCG API Client
 */
export class PokemonTcgClient extends BaseCardApiClient {
  readonly game = 'pokemon' as const;
  readonly name = 'Pokemon TCG API';

  private baseUrl = 'https://api.pokemontcg.io/v2';
  private apiKey?: string;
  private timeout = 30000;

  constructor(options?: { apiKey?: string; timeout?: number }) {
    super();
    this.apiKey = options?.apiKey;
    this.timeout = options?.timeout || 30000;
  }

  /**
   * Make a request to the API
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
    const headers: Record<string, string> = {
      'Accept': 'application/json',
    };

    if (this.apiKey) {
      headers['X-Api-Key'] = this.apiKey;
    }

    try {
      // Rate limit: 1000/day without key, 20000/day with key
      // Conservative: ~10 requests/minute
      const timeSinceLastRequest = Date.now() - this.lastRequestTime;
      if (timeSinceLastRequest < 6000) {
        await this.sleep(6000 - timeSinceLastRequest);
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(url.toString(), {
        method: 'GET',
        headers,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      this.trackRequest(startTime);

      if (!response.ok) {
        throw new Error(`Pokemon API request failed: ${response.statusText}`);
      }

      return await response.json() as T;
    } catch (error) {
      this.trackError();
      throw error;
    }
  }

  /**
   * Extract best price from card prices
   */
  private extractPrice(card: PokemonCard): { price?: number; variant?: string } {
    if (!card.tcgplayer?.prices) {
      return {};
    }

    const prices = card.tcgplayer.prices;

    // Priority: holofoil > reverseHolofoil > normal > firstEdition variants
    if (prices.holofoil?.market) {
      return { price: prices.holofoil.market, variant: 'holofoil' };
    }
    if (prices.reverseHolofoil?.market) {
      return { price: prices.reverseHolofoil.market, variant: 'reverse-holo' };
    }
    if (prices.normal?.market) {
      return { price: prices.normal.market, variant: undefined };
    }
    if (prices.firstEditionHolofoil?.market) {
      return { price: prices.firstEditionHolofoil.market, variant: 'first-edition-holo' };
    }
    if (prices.firstEditionNormal?.market) {
      return { price: prices.firstEditionNormal.market, variant: 'first-edition' };
    }

    return {};
  }

  /**
   * Normalize Pokemon card to generic format
   */
  private normalizeCard(card: PokemonCard): NormalizedCard {
    const { price, variant } = this.extractPrice(card);
    const priceGbp = price ? CurrencyConverter.usdToGbp(price) : undefined;
    const priceEur = card.cardmarket?.prices?.averageSellPrice;

    return {
      id: card.id,
      game: 'pokemon',
      name: card.name,
      setCode: card.set.id,
      cardNumber: card.number,
      variantType: variant,
      isVariant: !!variant,
      priceUsd: price,
      priceGbp,
      priceEur,
      rarity: card.rarity,
      imageUrl: card.images.large,
      productUrl: card.tcgplayer?.url,
      lastUpdated: card.tcgplayer?.updatedAt
        ? new Date(card.tcgplayer.updatedAt)
        : new Date(),
      attributes: {
        supertype: card.supertype,
        subtypes: card.subtypes,
        hp: card.hp,
        types: card.types,
        series: card.set.series,
        setName: card.set.name,
      },
    };
  }

  /**
   * Normalize Pokemon set to generic format
   */
  private normalizeSet(set: PokemonSet): NormalizedSet {
    return {
      code: set.id,
      name: set.name,
      game: 'pokemon',
      releaseDate: set.releaseDate,
      cardCount: set.total,
    };
  }

  /**
   * Get all available sets
   */
  async getSets(): Promise<NormalizedSet[]> {
    const response = await this.request<PokemonApiResponse<PokemonSet[]>>('/sets', {
      orderBy: '-releaseDate',
    });
    return response.data.map((s) => this.normalizeSet(s));
  }

  /**
   * Get cards from a specific set
   */
  async getCardsBySet(setCode: string): Promise<NormalizedCard[]> {
    const response = await this.request<PokemonApiResponse<PokemonCard[]>>('/cards', {
      q: `set.id:${setCode}`,
      pageSize: 250,
    });
    return response.data.map((c) => this.normalizeCard(c));
  }

  /**
   * Get a specific card by ID
   */
  async getCard(cardId: string): Promise<NormalizedCard | null> {
    try {
      const response = await this.request<PokemonApiResponse<PokemonCard>>(`/cards/${cardId}`);
      return this.normalizeCard(response.data as unknown as PokemonCard);
    } catch {
      return null;
    }
  }

  /**
   * Search cards with filters
   */
  async searchCards(params: SearchParams): Promise<NormalizedCard[]> {
    const queryParts: string[] = [];

    if (params.name) queryParts.push(`name:"*${params.name}*"`);
    if (params.setCode) queryParts.push(`set.id:${params.setCode}`);
    if (params.rarity) queryParts.push(`rarity:"${params.rarity}"`);

    const queryParams: Record<string, string | number> = {
      pageSize: params.limit || 100,
      page: params.page || 1,
    };

    if (queryParts.length > 0) {
      queryParams.q = queryParts.join(' ');
    }

    const response = await this.request<PokemonApiResponse<PokemonCard[]>>('/cards', queryParams);
    return response.data.map((c) => this.normalizeCard(c));
  }

  /**
   * Get cards with prices
   */
  async getCardsWithPrices(setCode?: string): Promise<NormalizedCard[]> {
    let cards: NormalizedCard[];

    if (setCode) {
      cards = await this.getCardsBySet(setCode);
    } else {
      // Without a set filter, just get recent cards with prices
      cards = await this.searchCards({ limit: 100 });
    }

    return cards.filter((c) => c.priceUsd !== undefined && c.priceUsd > 0);
  }
}

/**
 * Create Pokemon TCG client instance
 */
export function createPokemonTcgClient(options?: {
  apiKey?: string;
  timeout?: number;
}): PokemonTcgClient {
  return new PokemonTcgClient(options);
}

export default PokemonTcgClient;
