/**
 * CardMarket URL Builder
 *
 * Constructs valid CardMarket URLs for scraping operations.
 * Handles set expansion pages, card detail pages, and search queries.
 *
 * @see docs/CARDMARKET_ALCHEMIST_GRIMOIRE.md
 */

import { CardMarketTarget, SetInfo, ONE_PIECE_SETS } from './target-cards';

// =============================================================================
// TYPES
// =============================================================================

export interface UrlConfig {
  baseUrl: string;
  language: 'en' | 'de' | 'fr' | 'it' | 'es';
  game: string;
}

export interface CardUrl {
  url: string;
  cardId: string;
  variant: string;
  type: 'detail' | 'expansion' | 'search';
}

// =============================================================================
// CONSTANTS
// =============================================================================

const DEFAULT_CONFIG: UrlConfig = {
  baseUrl: 'https://www.cardmarket.com',
  language: 'en',
  game: 'One-Piece',
};

// Language path segments
const LANGUAGE_PATHS: Record<string, string> = {
  en: 'en',
  de: 'de',
  fr: 'fr',
  it: 'it',
  es: 'es',
};

// =============================================================================
// URL BUILDER CLASS
// =============================================================================

export class CardMarketUrlBuilder {
  private config: UrlConfig;

  constructor(config: Partial<UrlConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ===========================================================================
  // SET EXPANSION URLS
  // ===========================================================================

  /**
   * Build URL for a set's expansion page (list of all cards)
   */
  buildExpansionUrl(setCode: string, page: number = 1): string {
    const set = ONE_PIECE_SETS.find((s) => s.code === setCode);
    if (!set) {
      throw new Error(`Unknown set code: ${setCode}`);
    }

    const langPath = LANGUAGE_PATHS[this.config.language];
    let url = `${this.config.baseUrl}/${langPath}/${this.config.game}/Products/Singles/${set.urlSlug}`;

    if (page > 1) {
      url += `?site=${page}`;
    }

    return url;
  }

  /**
   * Build URLs for all pages of a set expansion
   */
  buildExpansionUrls(setCode: string, totalCards: number, cardsPerPage: number = 30): string[] {
    const totalPages = Math.ceil(totalCards / cardsPerPage);
    const urls: string[] = [];

    for (let page = 1; page <= totalPages; page++) {
      urls.push(this.buildExpansionUrl(setCode, page));
    }

    return urls;
  }

  /**
   * Build expansion URLs for all sets
   */
  buildAllExpansionUrls(): Map<string, string[]> {
    const result = new Map<string, string[]>();

    for (const set of ONE_PIECE_SETS) {
      const urls = this.buildExpansionUrls(set.code, set.cardCount);
      result.set(set.code, urls);
    }

    return result;
  }

  // ===========================================================================
  // CARD DETAIL URLS
  // ===========================================================================

  /**
   * Build URL for a specific card's detail page
   */
  buildCardDetailUrl(target: CardMarketTarget): string {
    const set = ONE_PIECE_SETS.find((s) => s.code === target.setCode);
    if (!set) {
      throw new Error(`Unknown set code: ${target.setCode}`);
    }

    const langPath = LANGUAGE_PATHS[this.config.language];
    return `${this.config.baseUrl}/${langPath}/${this.config.game}/Products/Singles/${set.urlSlug}/${target.urlSlug}`;
  }

  /**
   * Build card URL from card ID and variant
   */
  buildCardUrl(cardId: string, cardName: string, setSlug: string, variant?: string): string {
    const langPath = LANGUAGE_PATHS[this.config.language];

    // Normalize card name for URL
    const normalizedName = this.normalizeForUrl(cardName);

    // Build URL slug
    let urlSlug = `${normalizedName}-${cardId}`;

    // Add variant suffix
    if (variant && variant !== 'standard') {
      const variantSuffix = this.getVariantSuffix(variant);
      if (variantSuffix) {
        urlSlug += variantSuffix;
      }
    }

    return `${this.config.baseUrl}/${langPath}/${this.config.game}/Products/Singles/${setSlug}/${urlSlug}`;
  }

  /**
   * Build URLs for all target cards
   */
  buildTargetCardUrls(targets: CardMarketTarget[]): CardUrl[] {
    return targets.map((target) => ({
      url: this.buildCardDetailUrl(target),
      cardId: target.cardId,
      variant: target.variant,
      type: 'detail' as const,
    }));
  }

  // ===========================================================================
  // SEARCH URLS
  // ===========================================================================

  /**
   * Build search URL for a card name
   */
  buildSearchUrl(query: string, filters?: SearchFilters): string {
    const langPath = LANGUAGE_PATHS[this.config.language];
    const encodedQuery = encodeURIComponent(query);

    let url = `${this.config.baseUrl}/${langPath}/${this.config.game}/Products/Search?searchString=${encodedQuery}`;

    if (filters) {
      if (filters.minPrice !== undefined) {
        url += `&minPrice=${filters.minPrice}`;
      }
      if (filters.maxPrice !== undefined) {
        url += `&maxPrice=${filters.maxPrice}`;
      }
      if (filters.rarity) {
        url += `&rarity=${filters.rarity}`;
      }
      if (filters.language) {
        url += `&language=${filters.language}`;
      }
    }

    return url;
  }

  // ===========================================================================
  // SELLER LISTING URLS
  // ===========================================================================

  /**
   * Build URL for seller listings of a card
   */
  buildListingsUrl(cardUrl: string, options?: ListingsOptions): string {
    let url = cardUrl;

    const params: string[] = [];

    if (options?.language) {
      params.push(`language=${options.language}`);
    }
    if (options?.minCondition) {
      params.push(`minCondition=${options.minCondition}`);
    }
    if (options?.sellerCountry) {
      params.push(`sellerCountry=${options.sellerCountry}`);
    }

    if (params.length > 0) {
      const separator = url.includes('?') ? '&' : '?';
      url += separator + params.join('&');
    }

    return url;
  }

  // ===========================================================================
  // UTILITIES
  // ===========================================================================

  /**
   * Normalize a card name for URL usage
   */
  private normalizeForUrl(name: string): string {
    return name
      .replace(/\./g, '') // Remove periods
      .replace(/'/g, '') // Remove apostrophes
      .replace(/"/g, '') // Remove quotes
      .replace(/[()]/g, '') // Remove parentheses
      .replace(/\s+/g, '-') // Replace spaces with dashes
      .replace(/-+/g, '-') // Collapse multiple dashes
      .replace(/^-|-$/g, ''); // Remove leading/trailing dashes
  }

  /**
   * Get URL suffix for variant type
   */
  private getVariantSuffix(variant: string): string {
    const suffixes: Record<string, string> = {
      parallel: '-V2',
      manga: '-Manga',
      alt_art: '-Alternate-Art',
      boxtopper: '-Box-Topper',
      leader: '-V2', // Leader alt arts use V2 suffix
      sp: '', // SP cards have different card IDs
      sec: '', // SEC cards have different card IDs
      promo: '', // Promos have different card IDs
    };

    return suffixes[variant] || '';
  }

  /**
   * Parse a CardMarket URL to extract card info
   */
  parseUrl(url: string): ParsedUrl | null {
    const regex = /\/Singles\/([^/]+)\/([^/?]+)/;
    const match = url.match(regex);

    if (!match) return null;

    const setSlug = match[1];
    const cardSlug = match[2];

    // Find set by slug
    const set = ONE_PIECE_SETS.find((s) => s.urlSlug === setSlug);

    // Extract card ID from slug
    const cardIdMatch = cardSlug.match(/(OP\d{2}|EB\d{2}|ST\d{2}|P)-(\d{3})/i);
    const cardId = cardIdMatch ? `${cardIdMatch[1]}-${cardIdMatch[2]}` : null;

    // Detect variant from suffix
    let variant = 'standard';
    if (cardSlug.includes('-V2') || cardSlug.includes('-Parallel')) {
      variant = 'parallel';
    } else if (cardSlug.includes('-Manga')) {
      variant = 'manga';
    } else if (cardSlug.includes('-Box-Topper')) {
      variant = 'boxtopper';
    } else if (cardSlug.includes('-Alternate-Art')) {
      variant = 'alt_art';
    }

    return {
      url,
      setCode: set?.code || null,
      setSlug,
      cardSlug,
      cardId,
      variant,
    };
  }

  /**
   * Get set URL slug from set code
   */
  getSetSlug(setCode: string): string | null {
    const set = ONE_PIECE_SETS.find((s) => s.code === setCode);
    return set?.urlSlug || null;
  }

  /**
   * Build URL with different language
   */
  withLanguage(url: string, newLanguage: 'en' | 'de' | 'fr' | 'it' | 'es'): string {
    const currentLang = LANGUAGE_PATHS[this.config.language];
    const newLang = LANGUAGE_PATHS[newLanguage];
    return url.replace(`/${currentLang}/`, `/${newLang}/`);
  }
}

// =============================================================================
// TYPES
// =============================================================================

interface SearchFilters {
  minPrice?: number;
  maxPrice?: number;
  rarity?: string;
  language?: string;
}

interface ListingsOptions {
  language?: number; // CardMarket language ID
  minCondition?: number;
  sellerCountry?: string;
}

interface ParsedUrl {
  url: string;
  setCode: string | null;
  setSlug: string;
  cardSlug: string;
  cardId: string | null;
  variant: string;
}

// =============================================================================
// SINGLETON
// =============================================================================

export const cardMarketUrlBuilder = new CardMarketUrlBuilder();

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Quick helper to build a card detail URL
 */
export function buildCardUrl(target: CardMarketTarget): string {
  return cardMarketUrlBuilder.buildCardDetailUrl(target);
}

/**
 * Quick helper to build an expansion URL
 */
export function buildExpansionUrl(setCode: string, page?: number): string {
  return cardMarketUrlBuilder.buildExpansionUrl(setCode, page);
}
