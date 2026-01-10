/**
 * CardMarket Data Parser
 *
 * Extracts the Four Cardinal Essences from CardMarket scraped data:
 *   - FIRE: Price Guide Essence (priceFrom, priceTrend, priceAvg)
 *   - AIR: Variant Alchemy (URL patterns, card slug suffixes)
 *   - WATER: Language Currents (URL language path, card language flags)
 *   - EARTH: Condition Strata (MT, NM, EX, GD, LP, PL, PO)
 *
 * Unlike eBay's free-text titles, CardMarket has structured DOM data.
 * This parser extracts and normalizes that structured data.
 *
 * @see docs/CARDMARKET_ALCHEMIST_GRIMOIRE.md
 */

// =============================================================================
// TYPES
// =============================================================================

export interface ParsedCardMarketData {
  // FIRE: Price Guide Essence
  priceFromEur: number | null;
  priceTrendEur: number | null;
  priceAvg7Eur: number | null;
  priceAvg30Eur: number | null;
  availableItems: number;

  // AIR: Variant Alchemy
  variant: CardMarketVariant;
  isParallel: boolean;
  isManga: boolean;
  isBoxTopper: boolean;
  isSP: boolean;

  // WATER: Language Currents
  language: CardMarketLanguage;
  urlLanguage: string;

  // EARTH: Condition Strata
  condition: CardMarketCondition;
  conditionMultiplier: number;

  // Card Identity
  cardId: string | null;
  setCode: string | null;
  cardNumber: string | null;
  cardName: string | null;

  // Metadata
  url: string;
  setSlug: string | null;
  cardSlug: string | null;
  scrapedAt: Date;
  confidence: number;
}

export type CardMarketVariant =
  | 'standard'
  | 'parallel'
  | 'manga'
  | 'boxtopper'
  | 'alt_art'
  | 'sp'
  | 'sec'
  | 'leader'
  | 'promo';

export type CardMarketLanguage = 'EN' | 'JP' | 'DE' | 'FR' | 'IT' | 'ES';

export type CardMarketCondition = 'MT' | 'NM' | 'EX' | 'GD' | 'LP' | 'PL' | 'PO';

// =============================================================================
// RAW INPUT TYPES
// =============================================================================

/**
 * Raw data scraped from CardMarket DOM
 */
export interface RawCardMarketScrape {
  url: string;

  // Price guide section
  priceGuide?: {
    priceFrom?: string | number;
    priceTrend?: string | number;
    priceAvg7?: string | number;
    priceAvg30?: string | number;
    available?: string | number;
  };

  // Card header info
  cardInfo?: {
    name?: string;
    setName?: string;
    rarity?: string;
  };

  // Individual listing (article)
  article?: {
    price?: string | number;
    condition?: string;
    language?: string;
    seller?: {
      name?: string;
      rating?: number;
      sales?: number;
    };
    quantity?: number;
  };

  // Timestamp
  scrapedAt?: Date | string;
}

// =============================================================================
// FIRE: PRICE EXTRACTION RUNES
// =============================================================================

/**
 * Parse a price string from CardMarket DOM.
 * Handles: "€15,50", "15.50 €", "15,50", "15.50"
 */
function parseEurPrice(value: string | number | undefined): number | null {
  if (value === undefined || value === null) return null;

  if (typeof value === 'number') {
    return value >= 0 ? value : null;
  }

  // Remove currency symbols and whitespace
  const cleaned = value.replace(/[€\s]/g, '').trim();

  // Handle European comma format (15,50) and US dot format (15.50)
  // First check if it's comma-separated decimal (common in CardMarket)
  if (/^\d+,\d{2}$/.test(cleaned)) {
    return parseFloat(cleaned.replace(',', '.'));
  }

  // Handle dot-separated decimal
  if (/^\d+\.\d{2}$/.test(cleaned)) {
    return parseFloat(cleaned);
  }

  // Handle whole numbers
  if (/^\d+$/.test(cleaned)) {
    return parseInt(cleaned, 10);
  }

  // Try direct parse as fallback
  const parsed = parseFloat(cleaned.replace(',', '.'));
  return isNaN(parsed) ? null : parsed;
}

/**
 * Parse available items count
 */
function parseAvailableItems(value: string | number | undefined): number {
  if (value === undefined || value === null) return 0;

  if (typeof value === 'number') {
    return Math.max(0, Math.floor(value));
  }

  // Extract first number from string like "12 items" or "Available: 12"
  const match = value.match(/(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
}

// =============================================================================
// AIR: VARIANT DETECTION RUNES
// =============================================================================

/**
 * URL suffix patterns for variant detection
 */
const VARIANT_URL_PATTERNS: Array<{ variant: CardMarketVariant; pattern: RegExp }> = [
  { variant: 'parallel', pattern: /-V2$/i },
  { variant: 'parallel', pattern: /-Parallel$/i },
  { variant: 'manga', pattern: /-Manga$/i },
  { variant: 'manga', pattern: /-Manga-Art$/i },
  { variant: 'boxtopper', pattern: /-Box-Topper$/i },
  { variant: 'alt_art', pattern: /-Alternate-Art$/i },
  { variant: 'alt_art', pattern: /-Alt-Art$/i },
];

/**
 * Card ID patterns for SP detection
 */
const SP_CARD_ID_PATTERN = /^(OP|EB)\d{2}-SP-(OP|EB)\d{2}-\d{3}$/i;

/**
 * Detect variant from URL and card slug
 */
function detectVariantFromUrl(url: string, cardSlug?: string): CardMarketVariant {
  const slug = cardSlug || url;

  // Check SP format first (card ID based)
  if (SP_CARD_ID_PATTERN.test(slug)) {
    return 'sp';
  }

  // Check URL suffix patterns
  for (const { variant, pattern } of VARIANT_URL_PATTERNS) {
    if (pattern.test(slug)) {
      return variant;
    }
  }

  return 'standard';
}

// =============================================================================
// WATER: LANGUAGE EXTRACTION RUNES
// =============================================================================

/**
 * URL path language segments
 */
const URL_LANGUAGE_MAP: Record<string, CardMarketLanguage> = {
  en: 'EN',
  de: 'DE',
  fr: 'FR',
  it: 'IT',
  es: 'ES',
};

/**
 * Card language flags/codes from article listings
 */
const LANGUAGE_FLAG_MAP: Record<string, CardMarketLanguage> = {
  english: 'EN',
  japanese: 'JP',
  german: 'DE',
  french: 'FR',
  italian: 'IT',
  spanish: 'ES',
  en: 'EN',
  jp: 'JP',
  de: 'DE',
  fr: 'FR',
  it: 'IT',
  es: 'ES',
  // Language IDs (CardMarket internal)
  '1': 'EN',
  '2': 'DE',
  '3': 'FR',
  '4': 'ES',
  '5': 'IT',
  '7': 'JP',
};

/**
 * Extract URL language from path
 */
function extractUrlLanguage(url: string): { urlLang: string; language: CardMarketLanguage } {
  const match = url.match(/cardmarket\.com\/([a-z]{2})\//i);

  if (match) {
    const urlLang = match[1].toLowerCase();
    return {
      urlLang,
      language: URL_LANGUAGE_MAP[urlLang] || 'EN',
    };
  }

  return { urlLang: 'en', language: 'EN' };
}

/**
 * Parse article language from flag/string
 */
function parseArticleLanguage(language: string | undefined): CardMarketLanguage {
  if (!language) return 'EN';

  const normalized = language.toLowerCase().trim();
  return LANGUAGE_FLAG_MAP[normalized] || 'EN';
}

// =============================================================================
// EARTH: CONDITION EXTRACTION RUNES
// =============================================================================

/**
 * Condition code mappings and multipliers
 */
const CONDITION_MAP: Record<string, { condition: CardMarketCondition; multiplier: number }> = {
  // Full names
  mint: { condition: 'MT', multiplier: 1.1 },
  'near mint': { condition: 'NM', multiplier: 1.0 },
  excellent: { condition: 'EX', multiplier: 0.85 },
  good: { condition: 'GD', multiplier: 0.7 },
  'light played': { condition: 'LP', multiplier: 0.55 },
  played: { condition: 'PL', multiplier: 0.4 },
  poor: { condition: 'PO', multiplier: 0.2 },

  // Abbreviations
  mt: { condition: 'MT', multiplier: 1.1 },
  nm: { condition: 'NM', multiplier: 1.0 },
  ex: { condition: 'EX', multiplier: 0.85 },
  gd: { condition: 'GD', multiplier: 0.7 },
  lp: { condition: 'LP', multiplier: 0.55 },
  pl: { condition: 'PL', multiplier: 0.4 },
  po: { condition: 'PO', multiplier: 0.2 },

  // Numeric IDs (CardMarket internal)
  '1': { condition: 'MT', multiplier: 1.1 },
  '2': { condition: 'NM', multiplier: 1.0 },
  '3': { condition: 'EX', multiplier: 0.85 },
  '4': { condition: 'GD', multiplier: 0.7 },
  '5': { condition: 'LP', multiplier: 0.55 },
  '6': { condition: 'PL', multiplier: 0.4 },
  '7': { condition: 'PO', multiplier: 0.2 },
};

/**
 * Parse condition from string
 */
function parseCondition(conditionStr: string | undefined): {
  condition: CardMarketCondition;
  multiplier: number;
} {
  if (!conditionStr) {
    return { condition: 'NM', multiplier: 1.0 }; // Default to NM
  }

  const normalized = conditionStr.toLowerCase().trim();
  return CONDITION_MAP[normalized] || { condition: 'NM', multiplier: 1.0 };
}

// =============================================================================
// CARD ID EXTRACTION
// =============================================================================

/**
 * Card ID patterns for One Piece TCG
 */
const CARD_ID_PATTERNS = [
  // SP format in URL: ...OP03-SP-OP01-051...
  /\b(OP\d{2}|EB\d{2})-SP-(OP\d{2}|EB\d{2})-(\d{3})\b/i,

  // Standard format: OP01-120, EB02-061, ST16-004
  /\b(OP\d{2}|EB\d{2}|ST\d{2})-(\d{3})\b/i,

  // Promo format: P-001
  /\b(P)-(\d{3})\b/i,
];

/**
 * Extract card ID from URL or card slug
 */
function extractCardId(url: string, cardSlug?: string): {
  cardId: string | null;
  setCode: string | null;
  cardNumber: string | null;
} {
  const source = cardSlug || url;

  for (const pattern of CARD_ID_PATTERNS) {
    const match = source.match(pattern);
    if (match) {
      // Handle SP format specially
      if (pattern.source.includes('SP')) {
        const originalSet = match[2].toUpperCase();
        const cardNum = match[3];
        return {
          cardId: `${originalSet}-${cardNum}`,
          setCode: originalSet,
          cardNumber: cardNum,
        };
      }

      const setCode = match[1].toUpperCase();
      const cardNumber = match[2];
      return {
        cardId: `${setCode}-${cardNumber}`,
        setCode,
        cardNumber,
      };
    }
  }

  return { cardId: null, setCode: null, cardNumber: null };
}

/**
 * Extract set slug and card slug from URL
 */
function extractSlugsFromUrl(url: string): {
  setSlug: string | null;
  cardSlug: string | null;
} {
  const singlePattern = /\/Singles\/([^/]+)\/([^/?]+)/;
  const match = url.match(singlePattern);

  if (match) {
    return {
      setSlug: match[1],
      cardSlug: match[2],
    };
  }

  return { setSlug: null, cardSlug: null };
}

// =============================================================================
// MAIN PARSER CLASS
// =============================================================================

export class CardMarketDataParser {
  /**
   * Parse raw CardMarket scrape data into structured format.
   *
   * @example
   * ```typescript
   * const parser = new CardMarketDataParser();
   * const result = parser.parse({
   *   url: 'https://www.cardmarket.com/en/One-Piece/Products/Singles/Romance-Dawn/Shanks-OP01-120-V2',
   *   priceGuide: { priceFrom: '162,00 €', priceTrend: '175,50 €', available: 12 }
   * });
   * ```
   */
  parse(raw: RawCardMarketScrape): ParsedCardMarketData {
    const { setSlug, cardSlug } = extractSlugsFromUrl(raw.url);
    const { urlLang, language: urlLanguage } = extractUrlLanguage(raw.url);
    const { cardId, setCode, cardNumber } = extractCardId(raw.url, cardSlug || undefined);
    const variant = detectVariantFromUrl(raw.url, cardSlug || undefined);

    // Parse article-level data if present
    const articleLanguage = raw.article?.language
      ? parseArticleLanguage(raw.article.language)
      : urlLanguage;
    const { condition, multiplier } = parseCondition(raw.article?.condition);

    const result: ParsedCardMarketData = {
      // FIRE: Price Guide Essence
      priceFromEur: parseEurPrice(raw.priceGuide?.priceFrom),
      priceTrendEur: parseEurPrice(raw.priceGuide?.priceTrend),
      priceAvg7Eur: parseEurPrice(raw.priceGuide?.priceAvg7),
      priceAvg30Eur: parseEurPrice(raw.priceGuide?.priceAvg30),
      availableItems: parseAvailableItems(raw.priceGuide?.available),

      // AIR: Variant Alchemy
      variant,
      isParallel: variant === 'parallel',
      isManga: variant === 'manga',
      isBoxTopper: variant === 'boxtopper',
      isSP: variant === 'sp',

      // WATER: Language Currents
      language: articleLanguage,
      urlLanguage: urlLang,

      // EARTH: Condition Strata
      condition,
      conditionMultiplier: multiplier,

      // Card Identity
      cardId,
      setCode,
      cardNumber,
      cardName: raw.cardInfo?.name || null,

      // Metadata
      url: raw.url,
      setSlug,
      cardSlug,
      scrapedAt: raw.scrapedAt ? new Date(raw.scrapedAt) : new Date(),
      confidence: 0.5, // Will be calculated
    };

    // Calculate confidence
    result.confidence = this.calculateConfidence(result);

    return result;
  }

  /**
   * Parse multiple raw scrapes in batch.
   */
  parseBatch(rawItems: RawCardMarketScrape[]): ParsedCardMarketData[] {
    return rawItems.map((raw) => this.parse(raw));
  }

  /**
   * Parse a price guide page (multiple price points for one card)
   */
  parsePriceGuidePage(
    url: string,
    priceGuide: RawCardMarketScrape['priceGuide']
  ): ParsedCardMarketData {
    return this.parse({ url, priceGuide, scrapedAt: new Date() });
  }

  /**
   * Parse a seller article listing
   */
  parseArticleListing(
    url: string,
    article: RawCardMarketScrape['article']
  ): ParsedCardMarketData {
    return this.parse({ url, article, scrapedAt: new Date() });
  }

  // ===========================================================================
  // CONFIDENCE CALCULATION
  // ===========================================================================

  private calculateConfidence(result: ParsedCardMarketData): number {
    let confidence = 0.5; // Base confidence

    // FIRE: Price data completeness (+0.20)
    const priceCount = [
      result.priceFromEur,
      result.priceTrendEur,
      result.priceAvg7Eur,
      result.priceAvg30Eur,
    ].filter((p) => p !== null).length;
    confidence += priceCount * 0.05;

    // Card ID extracted (+0.15)
    if (result.cardId) {
      confidence += 0.15;
    }

    // AIR: Variant detected (+0.10)
    if (result.variant !== 'standard') {
      confidence += 0.10;
    }

    // Set slug matched (+0.05)
    if (result.setSlug) {
      confidence += 0.05;
    }

    // Available items data (+0.05)
    if (result.availableItems > 0) {
      confidence += 0.05;
    }

    return Math.max(0, Math.min(1, confidence));
  }
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Check if parsed data has valid pricing info
 */
export function hasValidPricing(parsed: ParsedCardMarketData): boolean {
  return (
    parsed.priceFromEur !== null ||
    parsed.priceTrendEur !== null ||
    parsed.priceAvg7Eur !== null
  );
}

/**
 * Check if parsed data should be excluded from training
 */
export function shouldExcludeFromTraining(parsed: ParsedCardMarketData): boolean {
  // Exclude if no card ID
  if (!parsed.cardId) {
    return true;
  }

  // Exclude if no pricing data
  if (!hasValidPricing(parsed)) {
    return true;
  }

  // Exclude very low confidence
  if (parsed.confidence < 0.4) {
    return true;
  }

  return false;
}

/**
 * Get deduplication key for a parsed result
 */
export function getDedupeKey(parsed: ParsedCardMarketData): string {
  return `${parsed.cardId}|${parsed.variant}|${parsed.language}`;
}

/**
 * Calculate best available price (lowest of available prices)
 */
export function getBestPrice(parsed: ParsedCardMarketData): number | null {
  const prices = [
    parsed.priceFromEur,
    parsed.priceTrendEur,
    parsed.priceAvg7Eur,
    parsed.priceAvg30Eur,
  ].filter((p): p is number => p !== null);

  if (prices.length === 0) return null;

  return Math.min(...prices);
}

/**
 * Convert EUR price to USD
 */
export function convertEurToUsd(eurPrice: number, fxRate: number = 1.08): number {
  return Math.round(eurPrice * fxRate * 100) / 100;
}

/**
 * Get price spread percentage
 */
export function getPriceSpread(parsed: ParsedCardMarketData): number | null {
  if (parsed.priceFromEur === null || parsed.priceTrendEur === null) {
    return null;
  }

  if (parsed.priceFromEur === 0) return 0;

  return Math.round(
    ((parsed.priceTrendEur - parsed.priceFromEur) / parsed.priceFromEur) * 10000
  ) / 100;
}

// =============================================================================
// SINGLETON
// =============================================================================

export const cardMarketDataParser = new CardMarketDataParser();
