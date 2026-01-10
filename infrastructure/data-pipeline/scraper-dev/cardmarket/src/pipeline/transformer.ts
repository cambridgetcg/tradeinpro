/**
 * Data Transformer Module
 *
 * Transforms raw scraped data into normalized format:
 * - Currency conversion (EUR → GBP)
 * - Card ID normalization
 * - Price validation
 * - Anomaly detection
 * - Deduplication
 */

import type { ScrapedCard, ScrapedArticle } from '../scrapers/cardmarket-scraper.js';
import type { TransformedPrice } from './database-loader.js';
import { CloudWatchMetrics } from '../monitoring/cloudwatch.js';

/**
 * Transformation result
 */
export interface TransformResult {
  valid: TransformedPrice[];
  invalid: InvalidRecord[];
  anomalies: AnomalyRecord[];
  stats: TransformStats;
}

/**
 * Invalid record with reason
 */
export interface InvalidRecord {
  card: ScrapedCard;
  reasons: string[];
}

/**
 * Anomaly record
 */
export interface AnomalyRecord {
  cardId: string;
  type: 'price_spike' | 'price_drop' | 'availability_change' | 'missing_data';
  oldValue: number | null;
  newValue: number | null;
  percentChange: number;
  details: string;
}

/**
 * Transform statistics
 */
export interface TransformStats {
  totalInput: number;
  validOutput: number;
  invalidCount: number;
  anomalyCount: number;
  duplicatesRemoved: number;
  duration: number;
}

/**
 * Transformer configuration
 */
export interface TransformerConfig {
  // Currency conversion
  eurToGbpRate: number;

  // Validation thresholds
  minPrice: number;
  maxPrice: number;
  maxPriceChangePercent: number;

  // Anomaly detection
  enableAnomalyDetection: boolean;
  anomalyThresholdPercent: number;

  // Deduplication
  enableDeduplication: boolean;
}

const DEFAULT_CONFIG: TransformerConfig = {
  eurToGbpRate: 0.85,
  minPrice: 0.01,
  maxPrice: 10000,
  maxPriceChangePercent: 500,
  enableAnomalyDetection: true,
  anomalyThresholdPercent: 50,
  enableDeduplication: true,
};

/**
 * Previous price data for anomaly detection
 */
export interface PreviousPrices {
  [cardId: string]: {
    trendPriceGbp: number;
    availableCount: number;
    lastUpdated: Date;
  };
}

/**
 * Data transformer class
 */
export class DataTransformer {
  private config: TransformerConfig;
  private metrics: CloudWatchMetrics;

  constructor(
    config?: Partial<TransformerConfig>,
    metrics?: CloudWatchMetrics
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.metrics = metrics || new CloudWatchMetrics({ namespace: 'CardmarketPipeline' });
  }

  /**
   * Transform scraped cards to normalized format
   */
  async transform(
    cards: ScrapedCard[],
    previousPrices?: PreviousPrices
  ): Promise<TransformResult> {
    const startTime = Date.now();
    const valid: TransformedPrice[] = [];
    const invalid: InvalidRecord[] = [];
    const anomalies: AnomalyRecord[] = [];
    let duplicatesRemoved = 0;

    // Deduplicate by card ID
    const uniqueCards = this.config.enableDeduplication
      ? this.deduplicate(cards)
      : cards;
    duplicatesRemoved = cards.length - uniqueCards.length;

    for (const card of uniqueCards) {
      // Validate card
      const validationErrors = this.validate(card);

      if (validationErrors.length > 0) {
        invalid.push({ card, reasons: validationErrors });
        continue;
      }

      // Transform to normalized format
      const transformed = this.transformCard(card);

      // Check for anomalies
      if (this.config.enableAnomalyDetection && previousPrices) {
        const anomaly = this.detectAnomaly(transformed, previousPrices);
        if (anomaly) {
          anomalies.push(anomaly);
        }
      }

      valid.push(transformed);
    }

    const duration = Date.now() - startTime;

    // Record metrics
    await this.metrics.putMetric('TransformValidCount', valid.length, 'Count');
    await this.metrics.putMetric('TransformInvalidCount', invalid.length, 'Count');
    await this.metrics.putMetric('TransformAnomalies', anomalies.length, 'Count');
    await this.metrics.putMetric('TransformDurationMs', duration, 'Milliseconds');

    return {
      valid,
      invalid,
      anomalies,
      stats: {
        totalInput: cards.length,
        validOutput: valid.length,
        invalidCount: invalid.length,
        anomalyCount: anomalies.length,
        duplicatesRemoved,
        duration,
      },
    };
  }

  /**
   * Validate a scraped card
   */
  private validate(card: ScrapedCard): string[] {
    const errors: string[] = [];

    // Required fields
    if (!card.cardId || card.cardId.trim() === '') {
      errors.push('Missing card ID');
    }

    if (!card.name || card.name.trim() === '') {
      errors.push('Missing card name');
    }

    if (!card.setCode || card.setCode.trim() === '') {
      errors.push('Missing set code');
    }

    // Price validation
    if (card.trendPrice !== null) {
      if (card.trendPrice < this.config.minPrice) {
        errors.push(`Trend price ${card.trendPrice} below minimum ${this.config.minPrice}`);
      }
      if (card.trendPrice > this.config.maxPrice) {
        errors.push(`Trend price ${card.trendPrice} above maximum ${this.config.maxPrice}`);
      }
    }

    if (card.lowPrice !== null) {
      if (card.lowPrice < this.config.minPrice) {
        errors.push(`Low price ${card.lowPrice} below minimum ${this.config.minPrice}`);
      }
      if (card.lowPrice > this.config.maxPrice) {
        errors.push(`Low price ${card.lowPrice} above maximum ${this.config.maxPrice}`);
      }
    }

    // Sanity checks
    if (card.lowPrice !== null && card.trendPrice !== null) {
      if (card.lowPrice > card.trendPrice * 2) {
        errors.push(`Low price ${card.lowPrice} significantly higher than trend ${card.trendPrice}`);
      }
    }

    // Availability validation
    if (card.availableCount !== null && card.availableCount < 0) {
      errors.push(`Negative availability count: ${card.availableCount}`);
    }

    return errors;
  }

  /**
   * Transform a single card to normalized format
   */
  private transformCard(card: ScrapedCard): TransformedPrice {
    // Parse card ID components
    const { releaseSet, setCode, cardNumber, variantType } = this.parseCardId(card);

    // Convert EUR to GBP
    const trendPriceGbp = card.trendPrice
      ? this.convertToGbp(card.trendPrice)
      : null;
    const lowPriceGbp = card.lowPrice
      ? this.convertToGbp(card.lowPrice)
      : null;

    return {
      cardId: card.cardId,
      name: card.name,
      releaseSet,
      fullCardNumber: `${setCode}-${cardNumber}`,
      setCode,
      cardNumber,
      variantType,
      language: 'EN',

      trendPriceEur: card.trendPrice,
      lowPriceEur: card.lowPrice,
      avg7PriceEur: card.avg7Price,
      avg30PriceEur: card.avg30Price,

      trendPriceGbp,
      lowPriceGbp,

      availableCount: card.availableCount,
      sourceUrl: card.sourceUrl,
      exchangeRate: this.config.eurToGbpRate,
      scrapedAt: new Date(card.scrapedAt),
    };
  }

  /**
   * Parse card ID into components
   */
  private parseCardId(card: ScrapedCard): {
    releaseSet: string;
    setCode: string;
    cardNumber: string;
    variantType: string | null;
  } {
    // Card ID format: {RELEASE_SET}-{SET_CODE}-{NUMBER}[-{variant}]
    // e.g., OP01-OP01-003-parallel or OP03-OP01-051-sp
    const parts = card.cardId.split('-');

    if (parts.length >= 3) {
      const releaseSet = parts[0];
      const setCode = parts[1];
      const cardNumber = parts[2];
      const variantType = parts.length > 3 ? parts.slice(3).join('-') : null;

      return { releaseSet, setCode, cardNumber, variantType };
    }

    // Fallback to card properties
    return {
      releaseSet: card.setCode,
      setCode: card.setCode,
      cardNumber: card.cardNumber,
      variantType: card.variantType || null,
    };
  }

  /**
   * Convert EUR to GBP
   */
  private convertToGbp(eurPrice: number): number {
    return Number((eurPrice * this.config.eurToGbpRate).toFixed(2));
  }

  /**
   * Detect price anomalies
   */
  private detectAnomaly(
    current: TransformedPrice,
    previousPrices: PreviousPrices
  ): AnomalyRecord | null {
    const previous = previousPrices[current.cardId];
    if (!previous || !current.trendPriceGbp) {
      return null;
    }

    const oldPrice = previous.trendPriceGbp;
    const newPrice = current.trendPriceGbp;
    const percentChange = ((newPrice - oldPrice) / oldPrice) * 100;

    // Check for significant price change
    if (Math.abs(percentChange) > this.config.anomalyThresholdPercent) {
      return {
        cardId: current.cardId,
        type: percentChange > 0 ? 'price_spike' : 'price_drop',
        oldValue: oldPrice,
        newValue: newPrice,
        percentChange,
        details: `Price ${percentChange > 0 ? 'increased' : 'decreased'} by ${Math.abs(percentChange).toFixed(1)}%`,
      };
    }

    // Check for significant availability change
    if (
      previous.availableCount &&
      current.availableCount &&
      Math.abs(current.availableCount - previous.availableCount) > previous.availableCount * 0.5
    ) {
      const availChange =
        ((current.availableCount - previous.availableCount) / previous.availableCount) * 100;
      return {
        cardId: current.cardId,
        type: 'availability_change',
        oldValue: previous.availableCount,
        newValue: current.availableCount,
        percentChange: availChange,
        details: `Availability ${availChange > 0 ? 'increased' : 'decreased'} by ${Math.abs(availChange).toFixed(1)}%`,
      };
    }

    return null;
  }

  /**
   * Deduplicate cards by ID, keeping the most recent
   */
  private deduplicate(cards: ScrapedCard[]): ScrapedCard[] {
    const seen = new Map<string, ScrapedCard>();

    for (const card of cards) {
      const existing = seen.get(card.cardId);
      if (!existing || new Date(card.scrapedAt) > new Date(existing.scrapedAt)) {
        seen.set(card.cardId, card);
      }
    }

    return Array.from(seen.values());
  }

  /**
   * Set exchange rate dynamically
   */
  setExchangeRate(rate: number): void {
    this.config.eurToGbpRate = rate;
  }

  /**
   * Get current configuration
   */
  getConfig(): TransformerConfig {
    return { ...this.config };
  }
}

/**
 * Fetch current EUR/GBP exchange rate
 */
export async function fetchExchangeRate(): Promise<number> {
  try {
    // Use a free exchange rate API
    const response = await fetch(
      'https://api.exchangerate-api.com/v4/latest/EUR'
    );
    const data = await response.json();
    return data.rates?.GBP || 0.85;
  } catch (error) {
    console.warn('Failed to fetch exchange rate, using default 0.85');
    return 0.85;
  }
}

/**
 * Create a transformer instance
 */
export function createTransformer(
  config?: Partial<TransformerConfig>,
  metrics?: CloudWatchMetrics
): DataTransformer {
  return new DataTransformer(config, metrics);
}
