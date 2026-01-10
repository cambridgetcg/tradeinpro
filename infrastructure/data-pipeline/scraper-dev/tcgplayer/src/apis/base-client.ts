/**
 * Base API Client Interface
 *
 * Generic interface that all game-specific API clients should implement.
 * Enables consistent data fetching across different TCGs.
 */

import type { GameCode } from '../config/games.js';

/**
 * Normalized card data (game-agnostic)
 */
export interface NormalizedCard {
  // Identity
  id: string;                      // Unique identifier (game-specific format)
  game: GameCode;                  // Which game this card belongs to
  name: string;                    // Card name
  setCode: string;                 // Set code (e.g., 'OP01', 'SWS', 'BT15')
  cardNumber: string;              // Card number within set

  // Variant info
  variantType?: string;            // parallel, foil, holo, etc.
  variantName?: string;            // Full variant description
  isVariant: boolean;              // Is this a variant of a base card?

  // Pricing (USD - primary currency for TCGplayer)
  priceUsd?: number;               // Market price in USD
  lowPriceUsd?: number;            // Low price
  midPriceUsd?: number;            // Mid price
  highPriceUsd?: number;           // High price
  marketPriceUsd?: number;         // Market price

  // Converted prices (optional)
  priceGbp?: number;               // Converted to GBP
  priceEur?: number;               // Converted to EUR

  // Metadata
  rarity?: string;
  imageUrl?: string;
  productUrl?: string;             // Link to buy
  lastUpdated?: Date;

  // Game-specific data (flexible)
  attributes?: Record<string, unknown>;
}

/**
 * Normalized set data (game-agnostic)
 */
export interface NormalizedSet {
  code: string;
  name: string;
  game: GameCode;
  releaseDate?: string;
  cardCount?: number;
  productUrl?: string;
}

/**
 * Search parameters (game-agnostic)
 */
export interface SearchParams {
  name?: string;
  setCode?: string;
  cardNumber?: string;
  rarity?: string;
  variantType?: string;
  page?: number;
  limit?: number;
}

/**
 * API client statistics
 */
export interface ClientStats {
  requestCount: number;
  errorCount: number;
  lastRequestTime: number;
  averageResponseTime: number;
}

/**
 * Base API client interface
 */
export interface ICardApiClient {
  /** Game this client is for */
  readonly game: GameCode;

  /** Client name (e.g., 'OPTCG API', 'Pokemon TCG API') */
  readonly name: string;

  /** Get all available sets */
  getSets(): Promise<NormalizedSet[]>;

  /** Get cards from a specific set */
  getCardsBySet(setCode: string): Promise<NormalizedCard[]>;

  /** Get a specific card by ID */
  getCard(cardId: string): Promise<NormalizedCard | null>;

  /** Search cards with filters */
  searchCards(params: SearchParams): Promise<NormalizedCard[]>;

  /** Get cards with prices only */
  getCardsWithPrices(setCode?: string): Promise<NormalizedCard[]>;

  /** Get client statistics */
  getStats(): ClientStats;

  /** Reset statistics */
  resetStats(): void;
}

/**
 * Abstract base class for API clients
 */
export abstract class BaseCardApiClient implements ICardApiClient {
  abstract readonly game: GameCode;
  abstract readonly name: string;

  protected requestCount = 0;
  protected errorCount = 0;
  protected lastRequestTime = 0;
  protected totalResponseTime = 0;

  abstract getSets(): Promise<NormalizedSet[]>;
  abstract getCardsBySet(setCode: string): Promise<NormalizedCard[]>;
  abstract getCard(cardId: string): Promise<NormalizedCard | null>;
  abstract searchCards(params: SearchParams): Promise<NormalizedCard[]>;

  /**
   * Get cards with prices (default implementation)
   */
  async getCardsWithPrices(setCode?: string): Promise<NormalizedCard[]> {
    const cards = setCode
      ? await this.getCardsBySet(setCode)
      : await this.searchCards({});

    return cards.filter((c) => c.priceUsd !== undefined && c.priceUsd > 0);
  }

  /**
   * Get statistics
   */
  getStats(): ClientStats {
    return {
      requestCount: this.requestCount,
      errorCount: this.errorCount,
      lastRequestTime: this.lastRequestTime,
      averageResponseTime: this.requestCount > 0
        ? this.totalResponseTime / this.requestCount
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
    this.totalResponseTime = 0;
  }

  /**
   * Track a request
   */
  protected trackRequest(startTime: number): void {
    this.requestCount++;
    this.lastRequestTime = Date.now();
    this.totalResponseTime += Date.now() - startTime;
  }

  /**
   * Track an error
   */
  protected trackError(): void {
    this.errorCount++;
  }

  /**
   * Sleep helper
   */
  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Exchange rates type
 */
interface ExchangeRates {
  USD_TO_GBP: number;
  USD_TO_EUR: number;
  EUR_TO_GBP: number;
  EUR_TO_USD: number;
  GBP_TO_USD: number;
  GBP_TO_EUR: number;
}

/**
 * Currency converter interface
 */
interface ICurrencyConverter {
  rates: ExchangeRates;
  usdToGbp(usd: number): number;
  usdToEur(usd: number): number;
  eurToGbp(eur: number): number;
  eurToUsd(eur: number): number;
  updateRates(rates: Partial<ExchangeRates>): void;
  fetchLatestRates(): Promise<void>;
}

/**
 * Currency conversion utilities
 */
export const CurrencyConverter: ICurrencyConverter = {
  // Default exchange rates (should be updated periodically)
  rates: {
    USD_TO_GBP: 0.79,
    USD_TO_EUR: 0.92,
    EUR_TO_GBP: 0.86,
    EUR_TO_USD: 1.09,
    GBP_TO_USD: 1.27,
    GBP_TO_EUR: 1.16,
  },

  /**
   * Convert USD to GBP
   */
  usdToGbp(usd: number): number {
    return Math.round(usd * this.rates.USD_TO_GBP * 100) / 100;
  },

  /**
   * Convert USD to EUR
   */
  usdToEur(usd: number): number {
    return Math.round(usd * this.rates.USD_TO_EUR * 100) / 100;
  },

  /**
   * Convert EUR to GBP
   */
  eurToGbp(eur: number): number {
    return Math.round(eur * this.rates.EUR_TO_GBP * 100) / 100;
  },

  /**
   * Convert EUR to USD
   */
  eurToUsd(eur: number): number {
    return Math.round(eur * this.rates.EUR_TO_USD * 100) / 100;
  },

  /**
   * Update exchange rates
   */
  updateRates(rates: Partial<ExchangeRates>): void {
    Object.assign(this.rates, rates);
  },

  /**
   * Fetch latest rates from API (optional)
   */
  async fetchLatestRates(): Promise<void> {
    try {
      const response = await fetch('https://api.exchangerate-api.com/v4/latest/USD');
      const data = await response.json() as { rates?: { GBP?: number; EUR?: number } };

      if (data.rates) {
        this.rates.USD_TO_GBP = data.rates.GBP || this.rates.USD_TO_GBP;
        this.rates.USD_TO_EUR = data.rates.EUR || this.rates.USD_TO_EUR;
        // Calculate derived rates
        this.rates.EUR_TO_GBP = this.rates.USD_TO_GBP / this.rates.USD_TO_EUR;
        this.rates.EUR_TO_USD = 1 / this.rates.USD_TO_EUR;
        this.rates.GBP_TO_USD = 1 / this.rates.USD_TO_GBP;
        this.rates.GBP_TO_EUR = 1 / this.rates.EUR_TO_GBP;
      }
    } catch {
      console.warn('Failed to fetch exchange rates, using defaults');
    }
  },
};

/**
 * Normalize a price to a specific currency
 */
export function normalizePrice(
  card: NormalizedCard,
  targetCurrency: 'USD' | 'GBP' | 'EUR' = 'GBP'
): number | undefined {
  if (targetCurrency === 'USD' && card.priceUsd) {
    return card.priceUsd;
  }

  if (targetCurrency === 'GBP') {
    if (card.priceGbp) return card.priceGbp;
    if (card.priceUsd) return CurrencyConverter.usdToGbp(card.priceUsd);
    if (card.priceEur) return CurrencyConverter.eurToGbp(card.priceEur);
  }

  if (targetCurrency === 'EUR') {
    if (card.priceEur) return card.priceEur;
    if (card.priceUsd) return CurrencyConverter.usdToEur(card.priceUsd);
    if (card.priceGbp) return card.priceGbp / CurrencyConverter.rates.EUR_TO_GBP;
  }

  return undefined;
}
