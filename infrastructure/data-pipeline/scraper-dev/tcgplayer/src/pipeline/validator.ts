/**
 * Data Validator
 *
 * Validates normalized card data from all sources.
 * Ensures data quality before transformation and storage.
 */

import type { NormalizedCard, NormalizedSet } from '../apis/base-client.js';
import type { GameCode } from '../config/games.js';
import { getGameConfig } from '../config/games.js';

/**
 * Validation error detail
 */
export interface ValidationError {
  field: string;
  message: string;
  value?: unknown;
  severity: 'error' | 'warning';
}

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
  cardId?: string;
}

/**
 * Validation rules configuration
 */
export interface ValidationRules {
  // Price validation
  minPrice: number;           // Minimum valid price (USD)
  maxPrice: number;           // Maximum valid price (USD)
  maxPriceChangePercent: number; // Max % change from previous price

  // Required fields
  requirePrice: boolean;
  requireImage: boolean;
  requireRarity: boolean;

  // Pattern validation
  validateSetCode: boolean;
  validateCardNumber: boolean;

  // Anomaly detection
  flagLargeChanges: boolean;
  largeChangeThreshold: number; // % threshold for flagging
}

const DEFAULT_RULES: ValidationRules = {
  minPrice: 0.01,
  maxPrice: 50000,           // $50k max for chase cards
  maxPriceChangePercent: 500, // 5x change is suspicious
  requirePrice: false,        // Cards can exist without prices
  requireImage: false,
  requireRarity: false,
  validateSetCode: true,
  validateCardNumber: true,
  flagLargeChanges: true,
  largeChangeThreshold: 100,  // 100% change flagged
};

/**
 * Card data validator
 */
export class CardValidator {
  private rules: ValidationRules;
  private previousPrices: Map<string, number> = new Map();

  constructor(rules?: Partial<ValidationRules>) {
    this.rules = { ...DEFAULT_RULES, ...rules };
  }

  /**
   * Validate a single card
   */
  validateCard(card: NormalizedCard): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationError[] = [];

    // Required field validation
    if (!card.id || card.id.trim() === '') {
      errors.push({
        field: 'id',
        message: 'Card ID is required',
        severity: 'error',
      });
    }

    if (!card.name || card.name.trim() === '') {
      errors.push({
        field: 'name',
        message: 'Card name is required',
        severity: 'error',
      });
    }

    if (!card.game) {
      errors.push({
        field: 'game',
        message: 'Game code is required',
        severity: 'error',
      });
    }

    if (!card.setCode || card.setCode.trim() === '') {
      errors.push({
        field: 'setCode',
        message: 'Set code is required',
        severity: 'error',
      });
    }

    // Price validation
    if (this.rules.requirePrice && card.priceUsd === undefined) {
      errors.push({
        field: 'priceUsd',
        message: 'Price is required',
        severity: 'error',
      });
    }

    if (card.priceUsd !== undefined) {
      if (card.priceUsd < this.rules.minPrice) {
        warnings.push({
          field: 'priceUsd',
          message: `Price ${card.priceUsd} is below minimum ${this.rules.minPrice}`,
          value: card.priceUsd,
          severity: 'warning',
        });
      }

      if (card.priceUsd > this.rules.maxPrice) {
        errors.push({
          field: 'priceUsd',
          message: `Price ${card.priceUsd} exceeds maximum ${this.rules.maxPrice}`,
          value: card.priceUsd,
          severity: 'error',
        });
      }

      if (isNaN(card.priceUsd) || !isFinite(card.priceUsd)) {
        errors.push({
          field: 'priceUsd',
          message: 'Price must be a valid number',
          value: card.priceUsd,
          severity: 'error',
        });
      }
    }

    // Validate other price fields if present
    for (const field of ['lowPriceUsd', 'midPriceUsd', 'highPriceUsd', 'marketPriceUsd'] as const) {
      const value = card[field];
      if (value !== undefined) {
        if (isNaN(value) || !isFinite(value) || value < 0) {
          errors.push({
            field,
            message: `${field} must be a valid positive number`,
            value,
            severity: 'error',
          });
        }
      }
    }

    // Set code pattern validation
    if (this.rules.validateSetCode && card.setCode && card.game) {
      const gameConfig = getGameConfig(card.game);
      if (gameConfig?.setPattern && !gameConfig.setPattern.test(card.setCode)) {
        warnings.push({
          field: 'setCode',
          message: `Set code "${card.setCode}" doesn't match expected pattern for ${card.game}`,
          value: card.setCode,
          severity: 'warning',
        });
      }
    }

    // Card ID pattern validation
    if (this.rules.validateCardNumber && card.id && card.game) {
      const gameConfig = getGameConfig(card.game);
      if (gameConfig?.cardIdPattern && !gameConfig.cardIdPattern.test(card.id)) {
        warnings.push({
          field: 'id',
          message: `Card ID "${card.id}" doesn't match expected pattern for ${card.game}`,
          value: card.id,
          severity: 'warning',
        });
      }
    }

    // Image URL validation
    if (this.rules.requireImage && !card.imageUrl) {
      warnings.push({
        field: 'imageUrl',
        message: 'Image URL is missing',
        severity: 'warning',
      });
    }

    if (card.imageUrl && !this.isValidUrl(card.imageUrl)) {
      warnings.push({
        field: 'imageUrl',
        message: 'Image URL is not a valid URL',
        value: card.imageUrl,
        severity: 'warning',
      });
    }

    // Rarity validation
    if (this.rules.requireRarity && !card.rarity) {
      warnings.push({
        field: 'rarity',
        message: 'Rarity is missing',
        severity: 'warning',
      });
    }

    // Variant consistency
    if (card.isVariant && !card.variantType) {
      warnings.push({
        field: 'variantType',
        message: 'Card is marked as variant but variantType is missing',
        severity: 'warning',
      });
    }

    // Price change anomaly detection
    if (this.rules.flagLargeChanges && card.priceUsd !== undefined) {
      const previousPrice = this.previousPrices.get(card.id);
      if (previousPrice !== undefined && previousPrice > 0) {
        const changePercent = Math.abs((card.priceUsd - previousPrice) / previousPrice) * 100;
        if (changePercent > this.rules.largeChangeThreshold) {
          warnings.push({
            field: 'priceUsd',
            message: `Large price change detected: ${changePercent.toFixed(1)}% (${previousPrice} → ${card.priceUsd})`,
            value: { previous: previousPrice, current: card.priceUsd, changePercent },
            severity: 'warning',
          });
        }
      }
      // Store for future comparisons
      this.previousPrices.set(card.id, card.priceUsd);
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      cardId: card.id,
    };
  }

  /**
   * Validate multiple cards
   */
  validateCards(cards: NormalizedCard[]): {
    validCards: NormalizedCard[];
    invalidCards: Array<{ card: NormalizedCard; result: ValidationResult }>;
    summary: {
      total: number;
      valid: number;
      invalid: number;
      warnings: number;
    };
  } {
    const validCards: NormalizedCard[] = [];
    const invalidCards: Array<{ card: NormalizedCard; result: ValidationResult }> = [];
    let warningCount = 0;

    for (const card of cards) {
      const result = this.validateCard(card);
      if (result.valid) {
        validCards.push(card);
        warningCount += result.warnings.length;
      } else {
        invalidCards.push({ card, result });
      }
    }

    return {
      validCards,
      invalidCards,
      summary: {
        total: cards.length,
        valid: validCards.length,
        invalid: invalidCards.length,
        warnings: warningCount,
      },
    };
  }

  /**
   * Validate a set
   */
  validateSet(set: NormalizedSet): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationError[] = [];

    if (!set.code || set.code.trim() === '') {
      errors.push({
        field: 'code',
        message: 'Set code is required',
        severity: 'error',
      });
    }

    if (!set.name || set.name.trim() === '') {
      errors.push({
        field: 'name',
        message: 'Set name is required',
        severity: 'error',
      });
    }

    if (!set.game) {
      errors.push({
        field: 'game',
        message: 'Game code is required',
        severity: 'error',
      });
    }

    if (set.cardCount !== undefined && (set.cardCount < 0 || !Number.isInteger(set.cardCount))) {
      errors.push({
        field: 'cardCount',
        message: 'Card count must be a positive integer',
        value: set.cardCount,
        severity: 'error',
      });
    }

    if (set.releaseDate && !this.isValidDate(set.releaseDate)) {
      warnings.push({
        field: 'releaseDate',
        message: 'Release date is not in a valid format',
        value: set.releaseDate,
        severity: 'warning',
      });
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Load previous prices for anomaly detection
   */
  loadPreviousPrices(prices: Map<string, number> | Array<{ id: string; price: number }>): void {
    if (prices instanceof Map) {
      this.previousPrices = new Map(prices);
    } else {
      this.previousPrices.clear();
      for (const { id, price } of prices) {
        this.previousPrices.set(id, price);
      }
    }
  }

  /**
   * Get current rules
   */
  getRules(): ValidationRules {
    return { ...this.rules };
  }

  /**
   * Update rules
   */
  updateRules(rules: Partial<ValidationRules>): void {
    this.rules = { ...this.rules, ...rules };
  }

  /**
   * Check if string is a valid URL
   */
  private isValidUrl(url: string): boolean {
    // Allow relative paths for local images
    if (url.startsWith('/') || url.startsWith('./')) {
      return true;
    }
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if string is a valid date
   */
  private isValidDate(dateStr: string): boolean {
    // Accept ISO dates and common formats
    const date = new Date(dateStr);
    return !isNaN(date.getTime());
  }
}

/**
 * Create a card validator instance
 */
export function createValidator(rules?: Partial<ValidationRules>): CardValidator {
  return new CardValidator(rules);
}

/**
 * Quick validation helper
 */
export function validateCard(card: NormalizedCard, rules?: Partial<ValidationRules>): ValidationResult {
  const validator = new CardValidator(rules);
  return validator.validateCard(card);
}

/**
 * Quick batch validation helper
 */
export function validateCards(
  cards: NormalizedCard[],
  rules?: Partial<ValidationRules>
): ReturnType<CardValidator['validateCards']> {
  const validator = new CardValidator(rules);
  return validator.validateCards(cards);
}
