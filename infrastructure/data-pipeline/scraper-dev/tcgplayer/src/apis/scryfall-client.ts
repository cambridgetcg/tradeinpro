/**
 * Scryfall API Client
 *
 * Free API for Magic: The Gathering card data and pricing.
 * API Documentation: https://scryfall.com/docs/api
 *
 * Rate Limits: Very strict - ~10 requests/second, prefer bulk data
 * Note: Scryfall requests respectful use - delays between requests required
 */

import {
  BaseCardApiClient,
  CurrencyConverter,
  type NormalizedCard,
  type NormalizedSet,
  type SearchParams,
} from './base-client.js';

/**
 * Scryfall card prices
 */
export interface ScryfallPrices {
  usd?: string;
  usd_foil?: string;
  usd_etched?: string;
  eur?: string;
  eur_foil?: string;
  tix?: string; // MTGO tickets
}

/**
 * Scryfall card faces (for double-faced cards)
 */
export interface ScryfallCardFace {
  name: string;
  mana_cost?: string;
  type_line?: string;
  oracle_text?: string;
  image_uris?: {
    small: string;
    normal: string;
    large: string;
    png: string;
  };
}

/**
 * Scryfall raw card response
 */
export interface ScryfallCard {
  id: string;
  oracle_id: string;
  name: string;
  set: string;
  set_name: string;
  collector_number: string;
  released_at: string;
  rarity: 'common' | 'uncommon' | 'rare' | 'mythic' | 'special' | 'bonus';
  prices: ScryfallPrices;
  image_uris?: {
    small: string;
    normal: string;
    large: string;
    png: string;
    art_crop: string;
    border_crop: string;
  };
  card_faces?: ScryfallCardFace[];
  tcgplayer_id?: number;
  purchase_uris?: {
    tcgplayer?: string;
    cardmarket?: string;
  };
  // Card attributes
  mana_cost?: string;
  cmc?: number;
  type_line?: string;
  oracle_text?: string;
  colors?: string[];
  color_identity?: string[];
  keywords?: string[];
  // Variants
  foil: boolean;
  nonfoil: boolean;
  finishes: ('nonfoil' | 'foil' | 'etched' | 'glossy')[];
  frame_effects?: string[];
  full_art: boolean;
  textless: boolean;
  border_color: 'black' | 'white' | 'borderless' | 'silver' | 'gold';
  promo: boolean;
}

/**
 * Scryfall raw set response
 */
export interface ScryfallSet {
  id: string;
  code: string;
  name: string;
  released_at?: string;
  set_type: string;
  card_count: number;
  digital: boolean;
  icon_svg_uri: string;
  search_uri: string;
}

/**
 * Scryfall list response
 */
export interface ScryfallList<T> {
  object: 'list';
  has_more: boolean;
  next_page?: string;
  total_cards?: number;
  data: T[];
}

/**
 * Scryfall API error response
 */
export interface ScryfallError {
  object: 'error';
  status: number;
  code: string;
  details: string;
}

/**
 * Scryfall API error
 */
export class ScryfallApiError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public code: string
  ) {
    super(message);
    this.name = 'ScryfallApiError';
  }
}

/**
 * Scryfall API Client
 */
export class ScryfallClient extends BaseCardApiClient {
  readonly game = 'mtg' as const;
  readonly name = 'Scryfall API';

  private baseUrl = 'https://api.scryfall.com';
  private timeout = 30000;

  // Scryfall requires delays between requests
  private minDelayMs = 100;

  /**
   * Make request to Scryfall API
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

    // Scryfall requires minimum 50-100ms between requests
    const timeSinceLastRequest = Date.now() - this.lastRequestTime;
    if (timeSinceLastRequest < this.minDelayMs) {
      await this.sleep(this.minDelayMs - timeSinceLastRequest);
    }

    const startTime = Date.now();

    try {
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
        const errorBody = await response.json().catch(() => ({ details: '', code: '' })) as Partial<ScryfallError>;
        throw new ScryfallApiError(
          errorBody.details || `API request failed: ${response.statusText}`,
          response.status,
          errorBody.code || 'unknown'
        );
      }

      return await response.json() as T;
    } catch (error) {
      this.trackError();
      throw error;
    }
  }

  /**
   * Fetch all pages of a list response
   */
  private async fetchAllPages<T>(initialResponse: ScryfallList<T>): Promise<T[]> {
    const allData: T[] = [...initialResponse.data];
    let nextPage = initialResponse.next_page;

    while (nextPage) {
      await this.sleep(this.minDelayMs);
      const response = await fetch(nextPage, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'TCGplayer-Scraper/1.0',
        },
      });

      if (!response.ok) break;

      const data = await response.json() as ScryfallList<T>;
      allData.push(...data.data);
      nextPage = data.next_page;
    }

    return allData;
  }

  /**
   * Determine variant type from card data
   */
  private getVariantType(card: ScryfallCard): string | undefined {
    const variants: string[] = [];

    if (card.foil && !card.nonfoil) variants.push('foil');
    if (card.finishes.includes('etched')) variants.push('etched');
    if (card.full_art) variants.push('full-art');
    if (card.textless) variants.push('textless');
    if (card.border_color === 'borderless') variants.push('borderless');
    if (card.frame_effects?.includes('showcase')) variants.push('showcase');
    if (card.frame_effects?.includes('extendedart')) variants.push('extended-art');
    if (card.promo) variants.push('promo');

    return variants.length > 0 ? variants[0] : undefined;
  }

  /**
   * Get image URL from card
   */
  private getImageUrl(card: ScryfallCard): string | undefined {
    if (card.image_uris?.normal) {
      return card.image_uris.normal;
    }
    if (card.card_faces?.[0]?.image_uris?.normal) {
      return card.card_faces[0].image_uris.normal;
    }
    return undefined;
  }

  /**
   * Normalize Scryfall card to generic format
   */
  private normalizeCard(card: ScryfallCard): NormalizedCard {
    const priceUsd = card.prices.usd ? parseFloat(card.prices.usd) : undefined;
    const foilPriceUsd = card.prices.usd_foil ? parseFloat(card.prices.usd_foil) : undefined;
    const priceEur = card.prices.eur ? parseFloat(card.prices.eur) : undefined;
    const priceGbp = priceUsd ? CurrencyConverter.usdToGbp(priceUsd) : undefined;

    const variantType = this.getVariantType(card);

    return {
      id: card.id,
      game: 'mtg',
      name: card.name,
      setCode: card.set.toUpperCase(),
      cardNumber: card.collector_number,
      variantType,
      isVariant: !!variantType,
      priceUsd,
      priceGbp,
      priceEur,
      lowPriceUsd: priceUsd,
      midPriceUsd: priceUsd,
      highPriceUsd: foilPriceUsd,
      marketPriceUsd: priceUsd,
      rarity: card.rarity,
      imageUrl: this.getImageUrl(card),
      productUrl: card.purchase_uris?.tcgplayer,
      lastUpdated: new Date(),
      attributes: {
        setName: card.set_name,
        releasedAt: card.released_at,
        manaCost: card.mana_cost,
        cmc: card.cmc,
        typeLine: card.type_line,
        oracleText: card.oracle_text,
        colors: card.colors,
        colorIdentity: card.color_identity,
        keywords: card.keywords,
        finishes: card.finishes,
        foil: card.foil,
        nonfoil: card.nonfoil,
        fullArt: card.full_art,
        borderColor: card.border_color,
        promo: card.promo,
        tcgplayerId: card.tcgplayer_id,
        foilPriceUsd,
        etchedPriceUsd: card.prices.usd_etched ? parseFloat(card.prices.usd_etched) : undefined,
      },
    };
  }

  /**
   * Normalize Scryfall set to generic format
   */
  private normalizeSet(set: ScryfallSet): NormalizedSet {
    return {
      code: set.code.toUpperCase(),
      name: set.name,
      game: 'mtg',
      releaseDate: set.released_at,
      cardCount: set.card_count,
      productUrl: `https://scryfall.com/sets/${set.code}`,
    };
  }

  /**
   * Get all available sets
   */
  async getSets(): Promise<NormalizedSet[]> {
    const response = await this.request<ScryfallList<ScryfallSet>>('/sets');
    return response.data
      .filter((s) => !s.digital) // Exclude digital-only sets
      .map((s) => this.normalizeSet(s));
  }

  /**
   * Get cards from a specific set
   */
  async getCardsBySet(setCode: string): Promise<NormalizedCard[]> {
    const response = await this.request<ScryfallList<ScryfallCard>>('/cards/search', {
      q: `set:${setCode.toLowerCase()}`,
      unique: 'prints',
      order: 'collector_number',
    });

    const allCards = await this.fetchAllPages(response);
    return allCards.map((c) => this.normalizeCard(c));
  }

  /**
   * Get a specific card by ID
   */
  async getCard(cardId: string): Promise<NormalizedCard | null> {
    try {
      const card = await this.request<ScryfallCard>(`/cards/${cardId}`);
      return this.normalizeCard(card);
    } catch (error) {
      if (error instanceof ScryfallApiError && error.statusCode === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Search cards with filters
   */
  async searchCards(params: SearchParams): Promise<NormalizedCard[]> {
    const queryParts: string[] = [];

    if (params.name) queryParts.push(`name:"${params.name}"`);
    if (params.setCode) queryParts.push(`set:${params.setCode.toLowerCase()}`);
    if (params.rarity) queryParts.push(`rarity:${params.rarity}`);

    // Default to searching for cards with prices
    if (queryParts.length === 0) {
      queryParts.push('usd>0');
    }

    try {
      const response = await this.request<ScryfallList<ScryfallCard>>('/cards/search', {
        q: queryParts.join(' '),
        unique: 'prints',
        page: params.page || 1,
      });

      // Don't fetch all pages for search, just return first page
      return response.data.map((c) => this.normalizeCard(c));
    } catch (error) {
      if (error instanceof ScryfallApiError && error.code === 'not_found') {
        return [];
      }
      throw error;
    }
  }

  /**
   * Get cards with prices
   */
  async getCardsWithPrices(setCode?: string): Promise<NormalizedCard[]> {
    const query = setCode
      ? `set:${setCode.toLowerCase()} usd>0`
      : 'usd>0 year>=2020';

    try {
      const response = await this.request<ScryfallList<ScryfallCard>>('/cards/search', {
        q: query,
        unique: 'prints',
        order: 'usd',
        dir: 'desc',
      });

      return response.data.map((c) => this.normalizeCard(c));
    } catch (error) {
      if (error instanceof ScryfallApiError && error.code === 'not_found') {
        return [];
      }
      throw error;
    }
  }

  /**
   * Get card by exact name
   */
  async getCardByName(name: string, setCode?: string): Promise<NormalizedCard | null> {
    try {
      const params: Record<string, string> = { exact: name };
      if (setCode) {
        params.set = setCode.toLowerCase();
      }

      const card = await this.request<ScryfallCard>('/cards/named', params);
      return this.normalizeCard(card);
    } catch (error) {
      if (error instanceof ScryfallApiError && error.statusCode === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Autocomplete card names
   */
  async autocomplete(query: string): Promise<string[]> {
    const response = await this.request<{ object: 'catalog'; data: string[] }>(
      '/cards/autocomplete',
      { q: query }
    );
    return response.data;
  }

  /**
   * Get random card
   */
  async getRandomCard(): Promise<NormalizedCard> {
    const card = await this.request<ScryfallCard>('/cards/random');
    return this.normalizeCard(card);
  }
}

/**
 * Create Scryfall client instance
 */
export function createScryfallClient(): ScryfallClient {
  return new ScryfallClient();
}

export default ScryfallClient;
