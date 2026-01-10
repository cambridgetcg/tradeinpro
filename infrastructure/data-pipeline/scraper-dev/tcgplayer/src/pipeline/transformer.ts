/**
 * Data Transformer
 *
 * Transforms and normalizes card data from various sources into a consistent
 * format ready for storage. Handles currency conversion, trade-in price
 * calculation, and data enrichment.
 */

import type { NormalizedCard, NormalizedSet } from '../apis/base-client.js';
import { CurrencyConverter, normalizePrice } from '../apis/base-client.js';
import type { GameCode } from '../config/games.js';
import { getGameConfig } from '../config/games.js';
import type { MergedCard } from './merger.js';
import type { ValidationResult } from './validator.js';
import { CardValidator } from './validator.js';

/**
 * Trade-in calculation configuration
 */
export interface TradeInConfig {
  baseMultiplier: number;      // Base trade-in % of market price (default 70%)
  minimumPriceGbp: number;     // Minimum price to calculate trade-in
  maximumPriceGbp: number;     // Maximum price cap
  roundTo: number;             // Round to nearest pence (default 1)
}

/**
 * Transformation options
 */
export interface TransformOptions {
  targetCurrency: 'USD' | 'GBP' | 'EUR';
  calculateTradeIn: boolean;
  tradeInConfig: TradeInConfig;
  enrichVariants: boolean;
  stripHtml: boolean;
  normalizeNames: boolean;
  validateOutput: boolean;
}

/**
 * Transformed card ready for database
 */
export interface TransformedCard {
  // Identity
  cardId: string;
  game: GameCode;
  name: string;
  releaseSet: string;
  fullCardNumber: string;
  setCode: string;
  cardNumber: string;

  // Variant info
  variantType: string | null;
  isVariant: boolean;

  // Prices (USD source)
  priceUsd: number | null;
  lowPriceUsd: number | null;
  midPriceUsd: number | null;
  highPriceUsd: number | null;
  marketPriceUsd: number | null;

  // Converted prices
  priceGbp: number | null;
  priceEur: number | null;
  bestPriceGbp: number | null;

  // Trade-in value
  tradeinPriceGbp: number | null;

  // Metadata
  rarity: string | null;
  imageUrl: string | null;
  productUrl: string | null;

  // Quality & source tracking
  qualityScore: number;
  priceConfidence: number;
  sources: string[];
  primarySource: string;

  // Timestamps
  lastUpdated: Date;
  transformedAt: Date;
}

/**
 * Transformation result
 */
export interface TransformResult {
  cards: TransformedCard[];
  stats: {
    inputCount: number;
    outputCount: number;
    skipped: number;
    tradeInCalculated: number;
    currencyConverted: number;
    validationErrors: number;
  };
  errors: Array<{ cardId: string; error: string }>;
}

const DEFAULT_TRADE_IN_CONFIG: TradeInConfig = {
  baseMultiplier: 0.70,      // 70% of market price
  minimumPriceGbp: 0.01,     // 1p minimum
  maximumPriceGbp: 50000,    // £50k cap
  roundTo: 1,                // Round to nearest penny
};

const DEFAULT_OPTIONS: TransformOptions = {
  targetCurrency: 'GBP',
  calculateTradeIn: true,
  tradeInConfig: DEFAULT_TRADE_IN_CONFIG,
  enrichVariants: true,
  stripHtml: true,
  normalizeNames: true,
  validateOutput: true,
};

/**
 * Data transformer class
 */
export class DataTransformer {
  private options: TransformOptions;
  private validator: CardValidator;

  constructor(options?: Partial<TransformOptions>) {
    this.options = {
      ...DEFAULT_OPTIONS,
      ...options,
      tradeInConfig: {
        ...DEFAULT_TRADE_IN_CONFIG,
        ...options?.tradeInConfig,
      },
    };
    this.validator = new CardValidator();
  }

  /**
   * Transform merged cards to database-ready format
   */
  transformCards(cards: MergedCard[]): TransformResult {
    const transformed: TransformedCard[] = [];
    const errors: Array<{ cardId: string; error: string }> = [];
    let skipped = 0;
    let tradeInCalculated = 0;
    let currencyConverted = 0;
    let validationErrors = 0;

    for (const card of cards) {
      try {
        const result = this.transformCard(card);

        if (result) {
          // Validate if enabled
          if (this.options.validateOutput) {
            const validation = this.validator.validateCard(card);
            if (!validation.valid) {
              validationErrors++;
              // Still include but log validation issues
              console.warn(`Validation warnings for ${card.id}:`, validation.errors);
            }
          }

          transformed.push(result);

          if (result.tradeinPriceGbp !== null) {
            tradeInCalculated++;
          }
          if (result.priceGbp !== null || result.priceEur !== null) {
            currencyConverted++;
          }
        } else {
          skipped++;
        }
      } catch (err) {
        errors.push({
          cardId: card.id,
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }

    return {
      cards: transformed,
      stats: {
        inputCount: cards.length,
        outputCount: transformed.length,
        skipped,
        tradeInCalculated,
        currencyConverted,
        validationErrors,
      },
      errors,
    };
  }

  /**
   * Transform a single card
   */
  transformCard(card: MergedCard): TransformedCard | null {
    // Parse card ID components
    const { releaseSet, setCode, cardNumber, fullCardNumber } = this.parseCardId(card);

    // Clean name
    let name = card.name;
    if (this.options.stripHtml) {
      name = this.stripHtml(name);
    }
    if (this.options.normalizeNames) {
      name = this.normalizeName(name);
    }

    // Convert currencies
    let priceGbp: number | null = null;
    let priceEur: number | null = null;

    if (card.priceUsd !== undefined && card.priceUsd > 0) {
      priceGbp = CurrencyConverter.usdToGbp(card.priceUsd);
      priceEur = CurrencyConverter.usdToEur(card.priceUsd);
    } else if (card.priceGbp !== undefined) {
      priceGbp = card.priceGbp;
    } else if (card.priceEur !== undefined) {
      priceGbp = CurrencyConverter.eurToGbp(card.priceEur);
    }

    // Determine best price in GBP
    const bestPriceGbp = priceGbp;

    // Calculate trade-in price
    let tradeinPriceGbp: number | null = null;
    if (this.options.calculateTradeIn && bestPriceGbp !== null) {
      tradeinPriceGbp = this.calculateTradeInPrice(bestPriceGbp);
    }

    // Enrich variant info if enabled
    let variantType = card.variantType || null;
    if (this.options.enrichVariants && !variantType) {
      variantType = this.detectVariantType(card);
    }

    return {
      cardId: card.id,
      game: card.game,
      name,
      releaseSet,
      fullCardNumber,
      setCode,
      cardNumber,
      variantType,
      isVariant: card.isVariant || variantType !== null,
      priceUsd: card.priceUsd ?? null,
      lowPriceUsd: card.lowPriceUsd ?? null,
      midPriceUsd: card.midPriceUsd ?? null,
      highPriceUsd: card.highPriceUsd ?? null,
      marketPriceUsd: card.marketPriceUsd ?? null,
      priceGbp,
      priceEur,
      bestPriceGbp,
      tradeinPriceGbp,
      rarity: card.rarity ?? null,
      imageUrl: card.imageUrl ?? null,
      productUrl: card.productUrl ?? null,
      qualityScore: card.qualityScore,
      priceConfidence: card.priceConfidence,
      sources: card.sources,
      primarySource: card.primarySource,
      lastUpdated: card.lastUpdated || new Date(),
      transformedAt: new Date(),
    };
  }

  /**
   * Calculate trade-in price
   */
  private calculateTradeInPrice(priceGbp: number): number | null {
    const { baseMultiplier, minimumPriceGbp, maximumPriceGbp, roundTo } = this.options.tradeInConfig;

    if (priceGbp < minimumPriceGbp) {
      return null;
    }

    let tradeIn = priceGbp * baseMultiplier;

    // Apply cap
    tradeIn = Math.min(tradeIn, maximumPriceGbp);

    // Round
    tradeIn = Math.round(tradeIn / roundTo) * roundTo;

    // Round to 2 decimal places
    return Math.round(tradeIn * 100) / 100;
  }

  /**
   * Parse card ID into components
   */
  private parseCardId(card: NormalizedCard): {
    releaseSet: string;
    setCode: string;
    cardNumber: string;
    fullCardNumber: string;
  } {
    const id = card.id;
    const game = card.game;

    // Default values
    let releaseSet = card.setCode;
    let setCode = card.setCode;
    let cardNumber = card.cardNumber;
    let fullCardNumber = `${setCode}-${cardNumber}`;

    // Game-specific parsing
    if (game === 'onepiece') {
      // One Piece format: OP03-OP01-051-sp or OP01-003-parallel
      const parts = id.split('-');

      if (parts.length >= 3) {
        // Check if first part is release set (different from card set)
        if (parts[0].match(/^(OP|ST|EB|P|DON)\d{2}$/i) && parts[1].match(/^(OP|ST|EB|P|DON)\d{2}$/i)) {
          // Format: RELEASE_SET-CARD_SET-NUMBER[-variant]
          releaseSet = parts[0];
          setCode = parts[1];
          cardNumber = parts[2];
          fullCardNumber = `${setCode}-${cardNumber}`;
        } else if (parts[0].match(/^(OP|ST|EB|P|DON)\d{2}$/i)) {
          // Format: SET-NUMBER[-variant]
          releaseSet = parts[0];
          setCode = parts[0];
          cardNumber = parts[1];
          fullCardNumber = `${setCode}-${cardNumber}`;
        }
      }
    } else if (game === 'pokemon') {
      // Pokemon format: SET-NUMBER or set/number
      const match = id.match(/^([A-Z]{2,4}\d*)[-/](\d+)$/i);
      if (match) {
        setCode = match[1].toUpperCase();
        cardNumber = match[2];
        fullCardNumber = `${setCode}-${cardNumber}`;
        releaseSet = setCode;
      }
    } else if (game === 'mtg') {
      // MTG format: SET-collector_number
      const parts = id.split('-');
      if (parts.length >= 2) {
        setCode = parts[0].toUpperCase();
        cardNumber = parts.slice(1).join('-');
        fullCardNumber = `${setCode}-${cardNumber}`;
        releaseSet = setCode;
      }
    }

    return { releaseSet, setCode, cardNumber, fullCardNumber };
  }

  /**
   * Detect variant type from card data
   */
  private detectVariantType(card: NormalizedCard): string | null {
    const gameConfig = getGameConfig(card.game);
    const variantTypes = gameConfig?.variantTypes || [];

    // Check ID for variant indicators
    const id = card.id.toLowerCase();
    for (const variant of variantTypes) {
      if (id.includes(variant.toLowerCase())) {
        return variant;
      }
    }

    // Check name for variant indicators
    const name = card.name.toLowerCase();
    const commonIndicators = [
      { pattern: /\(parallel\)/i, type: 'parallel' },
      { pattern: /\(foil\)/i, type: 'foil' },
      { pattern: /\(holo\)/i, type: 'holo' },
      { pattern: /\(sp\)/i, type: 'sp' },
      { pattern: /\(alt\s*art\)/i, type: 'alt-art' },
      { pattern: /\(secret\)/i, type: 'secret' },
      { pattern: /\(promo\)/i, type: 'promo' },
      { pattern: /\(full\s*art\)/i, type: 'full-art' },
      { pattern: /\(borderless\)/i, type: 'borderless' },
    ];

    for (const { pattern, type } of commonIndicators) {
      if (pattern.test(name) || pattern.test(card.variantName || '')) {
        return type;
      }
    }

    return null;
  }

  /**
   * Strip HTML from string
   */
  private stripHtml(str: string): string {
    return str
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .trim();
  }

  /**
   * Normalize card name
   */
  private normalizeName(name: string): string {
    return name
      // Normalize quotes
      .replace(/['']/g, "'")
      .replace(/[""]/g, '"')
      // Normalize dashes
      .replace(/[–—]/g, '-')
      // Remove extra whitespace
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Batch transform with chunking
   */
  async transformBatch(
    cards: MergedCard[],
    chunkSize: number = 1000,
    onProgress?: (processed: number, total: number) => void
  ): Promise<TransformResult> {
    const allTransformed: TransformedCard[] = [];
    const allErrors: Array<{ cardId: string; error: string }> = [];
    const stats = {
      inputCount: cards.length,
      outputCount: 0,
      skipped: 0,
      tradeInCalculated: 0,
      currencyConverted: 0,
      validationErrors: 0,
    };

    for (let i = 0; i < cards.length; i += chunkSize) {
      const chunk = cards.slice(i, i + chunkSize);
      const result = this.transformCards(chunk);

      allTransformed.push(...result.cards);
      allErrors.push(...result.errors);

      stats.outputCount += result.stats.outputCount;
      stats.skipped += result.stats.skipped;
      stats.tradeInCalculated += result.stats.tradeInCalculated;
      stats.currencyConverted += result.stats.currencyConverted;
      stats.validationErrors += result.stats.validationErrors;

      if (onProgress) {
        onProgress(Math.min(i + chunkSize, cards.length), cards.length);
      }

      // Small delay to prevent blocking
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    return {
      cards: allTransformed,
      stats,
      errors: allErrors,
    };
  }

  /**
   * Update exchange rates
   */
  async updateExchangeRates(): Promise<void> {
    await CurrencyConverter.fetchLatestRates();
  }

  /**
   * Get current options
   */
  getOptions(): TransformOptions {
    return { ...this.options };
  }

  /**
   * Update options
   */
  updateOptions(options: Partial<TransformOptions>): void {
    this.options = {
      ...this.options,
      ...options,
      tradeInConfig: {
        ...this.options.tradeInConfig,
        ...options?.tradeInConfig,
      },
    };
  }
}

/**
 * Create a data transformer instance
 */
export function createTransformer(options?: Partial<TransformOptions>): DataTransformer {
  return new DataTransformer(options);
}

/**
 * Quick transform helper
 */
export function transformCards(
  cards: MergedCard[],
  options?: Partial<TransformOptions>
): TransformResult {
  const transformer = new DataTransformer(options);
  return transformer.transformCards(cards);
}

/**
 * Transform from raw normalized cards (skipping merge)
 */
export function transformRawCards(
  cards: NormalizedCard[],
  source: string,
  options?: Partial<TransformOptions>
): TransformResult {
  const transformer = new DataTransformer(options);

  // Convert to merged card format
  const mergedCards: MergedCard[] = cards.map((card) => ({
    ...card,
    sources: [source],
    primarySource: source,
    mergedAt: new Date(),
    conflictsResolved: 0,
    qualityScore: 50,
    priceConfidence: card.priceUsd !== undefined ? 0.7 : 0,
  }));

  return transformer.transformCards(mergedCards);
}
