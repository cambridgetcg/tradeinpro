/**
 * Multi-Source Data Merger
 *
 * Combines card data from multiple sources (APIs, scrapers)
 * with intelligent deduplication and conflict resolution.
 */

import type { NormalizedCard, NormalizedSet } from '../apis/base-client.js';
import type { GameCode } from '../config/games.js';

/**
 * Data source with priority
 */
export interface DataSource {
  name: string;
  priority: number;          // Higher = preferred for conflicts
  trustScore: number;        // 0-1, how much to trust pricing
  freshnessWeight: number;   // How important is data freshness
}

/**
 * Predefined data source configurations
 */
export const DATA_SOURCES: Record<string, DataSource> = {
  'optcg-api': {
    name: 'OPTCG API',
    priority: 90,
    trustScore: 0.95,
    freshnessWeight: 0.8,
  },
  'pokemon-tcg-api': {
    name: 'Pokemon TCG API',
    priority: 90,
    trustScore: 0.95,
    freshnessWeight: 0.8,
  },
  'scryfall': {
    name: 'Scryfall',
    priority: 95,
    trustScore: 0.98,
    freshnessWeight: 0.9,
  },
  'justtcg': {
    name: 'JustTCG API',
    priority: 85,
    trustScore: 0.90,
    freshnessWeight: 0.85,
  },
  'tcgplayer-scraper': {
    name: 'TCGplayer Scraper',
    priority: 70,
    trustScore: 0.75,
    freshnessWeight: 0.7,
  },
  'cardmarket-scraper': {
    name: 'Cardmarket Scraper',
    priority: 70,
    trustScore: 0.75,
    freshnessWeight: 0.7,
  },
};

/**
 * Card with source metadata
 */
export interface SourcedCard extends NormalizedCard {
  source: string;
  fetchedAt: Date;
  qualityScore?: number;
}

/**
 * Merged card result
 */
export interface MergedCard extends NormalizedCard {
  sources: string[];
  primarySource: string;
  mergedAt: Date;
  conflictsResolved: number;
  qualityScore: number;
  priceConfidence: number;   // 0-1, how confident are we in the price
}

/**
 * Merge statistics
 */
export interface MergeStats {
  totalInput: number;
  uniqueCards: number;
  duplicatesRemoved: number;
  conflictsResolved: number;
  sourceBreakdown: Record<string, number>;
  averageQualityScore: number;
}

/**
 * Merge configuration
 */
export interface MergeConfig {
  preferNewerData: boolean;           // Prefer more recent data
  maxAgeDifference: number;           // Max hours between sources to consider
  priceAveragingStrategy: 'weighted' | 'median' | 'lowest' | 'highest';
  requireMinSources: number;          // Minimum sources for high confidence
  dedupeStrategy: 'id' | 'name-set' | 'fuzzy';
}

const DEFAULT_CONFIG: MergeConfig = {
  preferNewerData: true,
  maxAgeDifference: 24,               // 24 hours
  priceAveragingStrategy: 'weighted',
  requireMinSources: 1,
  dedupeStrategy: 'id',
};

/**
 * Multi-source data merger
 */
export class CardMerger {
  private config: MergeConfig;
  private sources: Map<string, DataSource>;

  constructor(config?: Partial<MergeConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.sources = new Map(Object.entries(DATA_SOURCES));
  }

  /**
   * Register a custom data source
   */
  registerSource(id: string, source: DataSource): void {
    this.sources.set(id, source);
  }

  /**
   * Merge cards from multiple sources
   */
  mergeCards(cardsBySource: Map<string, SourcedCard[]>): {
    cards: MergedCard[];
    stats: MergeStats;
  } {
    // Group cards by dedupe key
    const groups = new Map<string, SourcedCard[]>();
    let totalInput = 0;

    for (const [sourceName, cards] of cardsBySource) {
      for (const card of cards) {
        totalInput++;
        const key = this.getDedupeKey(card);
        const group = groups.get(key) || [];
        group.push({ ...card, source: sourceName });
        groups.set(key, group);
      }
    }

    // Merge each group
    const mergedCards: MergedCard[] = [];
    let conflictsResolved = 0;
    let totalQuality = 0;

    for (const [, group] of groups) {
      const merged = this.mergeGroup(group);
      mergedCards.push(merged);
      conflictsResolved += merged.conflictsResolved;
      totalQuality += merged.qualityScore;
    }

    // Calculate source breakdown
    const sourceBreakdown: Record<string, number> = {};
    for (const [sourceName, cards] of cardsBySource) {
      sourceBreakdown[sourceName] = cards.length;
    }

    return {
      cards: mergedCards,
      stats: {
        totalInput,
        uniqueCards: mergedCards.length,
        duplicatesRemoved: totalInput - mergedCards.length,
        conflictsResolved,
        sourceBreakdown,
        averageQualityScore: mergedCards.length > 0 ? totalQuality / mergedCards.length : 0,
      },
    };
  }

  /**
   * Merge a group of cards (same card from different sources)
   */
  private mergeGroup(cards: SourcedCard[]): MergedCard {
    if (cards.length === 1) {
      return this.singleCardToMerged(cards[0]);
    }

    // Sort by source priority (highest first)
    const sorted = [...cards].sort((a, b) => {
      const sourceA = this.sources.get(a.source);
      const sourceB = this.sources.get(b.source);
      const priorityA = sourceA?.priority || 50;
      const priorityB = sourceB?.priority || 50;

      // If preferNewerData, also consider freshness
      if (this.config.preferNewerData && a.fetchedAt && b.fetchedAt) {
        const freshnessWeight = (sourceA?.freshnessWeight || 0.5) - (sourceB?.freshnessWeight || 0.5);
        const timeDiff = (b.fetchedAt.getTime() - a.fetchedAt.getTime()) / (1000 * 60 * 60);
        const freshnessBonus = Math.min(10, timeDiff * freshnessWeight);
        return (priorityB + freshnessBonus) - priorityA;
      }

      return priorityB - priorityA;
    });

    const primary = sorted[0];
    let conflictsResolved = 0;

    // Merge prices based on strategy
    const prices = cards
      .filter((c) => c.priceUsd !== undefined && c.priceUsd > 0)
      .map((c) => ({
        price: c.priceUsd!,
        source: c.source,
        trust: this.sources.get(c.source)?.trustScore || 0.5,
      }));

    let mergedPrice: number | undefined;
    if (prices.length > 0) {
      mergedPrice = this.calculateMergedPrice(prices);
      if (prices.length > 1 && prices.some((p) => Math.abs(p.price - mergedPrice!) > 0.01)) {
        conflictsResolved++;
      }
    }

    // Merge other price points
    const lowPrices = cards.filter((c) => c.lowPriceUsd).map((c) => c.lowPriceUsd!);
    const midPrices = cards.filter((c) => c.midPriceUsd).map((c) => c.midPriceUsd!);
    const highPrices = cards.filter((c) => c.highPriceUsd).map((c) => c.highPriceUsd!);
    const marketPrices = cards.filter((c) => c.marketPriceUsd).map((c) => c.marketPriceUsd!);

    // Calculate quality and confidence scores
    const qualityScore = this.calculateQualityScore(cards);
    const priceConfidence = this.calculatePriceConfidence(prices);

    // Prefer non-empty values from higher priority sources
    const merged: MergedCard = {
      id: primary.id,
      game: primary.game,
      name: this.pickBestValue(cards, 'name') || primary.name,
      setCode: primary.setCode,
      cardNumber: this.pickBestValue(cards, 'cardNumber') || primary.cardNumber,
      variantType: this.pickBestValue(cards, 'variantType'),
      variantName: this.pickBestValue(cards, 'variantName'),
      isVariant: cards.some((c) => c.isVariant),
      priceUsd: mergedPrice,
      lowPriceUsd: lowPrices.length > 0 ? Math.min(...lowPrices) : undefined,
      midPriceUsd: midPrices.length > 0 ? this.median(midPrices) : undefined,
      highPriceUsd: highPrices.length > 0 ? Math.max(...highPrices) : undefined,
      marketPriceUsd: marketPrices.length > 0 ? this.median(marketPrices) : undefined,
      priceGbp: primary.priceGbp,
      priceEur: primary.priceEur,
      rarity: this.pickBestValue(cards, 'rarity'),
      imageUrl: this.pickBestValue(cards, 'imageUrl'),
      productUrl: this.pickBestValue(cards, 'productUrl'),
      lastUpdated: new Date(Math.max(...cards.map((c) => c.fetchedAt?.getTime() || 0))),
      attributes: this.mergeAttributes(cards),
      sources: [...new Set(cards.map((c) => c.source))],
      primarySource: primary.source,
      mergedAt: new Date(),
      conflictsResolved,
      qualityScore,
      priceConfidence,
    };

    return merged;
  }

  /**
   * Calculate merged price based on strategy
   */
  private calculateMergedPrice(prices: Array<{ price: number; source: string; trust: number }>): number {
    switch (this.config.priceAveragingStrategy) {
      case 'weighted':
        // Weighted average by trust score
        const totalWeight = prices.reduce((sum, p) => sum + p.trust, 0);
        const weighted = prices.reduce((sum, p) => sum + p.price * p.trust, 0);
        return Math.round((weighted / totalWeight) * 100) / 100;

      case 'median':
        return this.median(prices.map((p) => p.price));

      case 'lowest':
        return Math.min(...prices.map((p) => p.price));

      case 'highest':
        return Math.max(...prices.map((p) => p.price));

      default:
        return prices[0].price;
    }
  }

  /**
   * Calculate quality score for merged card
   */
  private calculateQualityScore(cards: SourcedCard[]): number {
    let score = 0;

    // More sources = higher quality
    score += Math.min(30, cards.length * 10);

    // Higher trust sources = better
    const avgTrust = cards.reduce((sum, c) => {
      const source = this.sources.get(c.source);
      return sum + (source?.trustScore || 0.5);
    }, 0) / cards.length;
    score += avgTrust * 30;

    // Data completeness
    const primary = cards[0];
    if (primary.priceUsd !== undefined) score += 15;
    if (primary.imageUrl) score += 10;
    if (primary.rarity) score += 5;
    if (primary.variantType) score += 5;
    if (primary.productUrl) score += 5;

    return Math.min(100, score);
  }

  /**
   * Calculate price confidence
   */
  private calculatePriceConfidence(prices: Array<{ price: number; trust: number }>): number {
    if (prices.length === 0) return 0;
    if (prices.length === 1) return prices[0].trust * 0.7; // Single source = lower confidence

    // Check price consistency across sources
    const avg = prices.reduce((sum, p) => sum + p.price, 0) / prices.length;
    const variance = prices.reduce((sum, p) => sum + Math.pow(p.price - avg, 2), 0) / prices.length;
    const stdDev = Math.sqrt(variance);
    const cv = avg > 0 ? stdDev / avg : 1; // Coefficient of variation

    // High variance = low confidence
    const consistencyScore = Math.max(0, 1 - cv);

    // Average trust score
    const avgTrust = prices.reduce((sum, p) => sum + p.trust, 0) / prices.length;

    // More sources = higher confidence (diminishing returns)
    const sourceBonus = Math.min(0.2, (prices.length - 1) * 0.1);

    return Math.min(1, (consistencyScore * 0.4 + avgTrust * 0.4 + sourceBonus + 0.2));
  }

  /**
   * Pick best non-empty value from cards
   */
  private pickBestValue<K extends keyof NormalizedCard>(
    cards: SourcedCard[],
    field: K
  ): NormalizedCard[K] | undefined {
    for (const card of cards) {
      const value = card[field];
      if (value !== undefined && value !== null && value !== '') {
        return value;
      }
    }
    return undefined;
  }

  /**
   * Merge attributes from all sources
   */
  private mergeAttributes(cards: SourcedCard[]): Record<string, unknown> {
    const merged: Record<string, unknown> = {};
    const sources: string[] = [];

    for (const card of cards) {
      sources.push(card.source);
      if (card.attributes) {
        Object.assign(merged, card.attributes);
      }
    }

    merged._sources = sources;
    return merged;
  }

  /**
   * Get dedupe key for a card
   */
  private getDedupeKey(card: NormalizedCard): string {
    switch (this.config.dedupeStrategy) {
      case 'id':
        return `${card.game}:${card.id}`;

      case 'name-set':
        const normalizedName = card.name.toLowerCase().replace(/[^a-z0-9]/g, '');
        return `${card.game}:${card.setCode}:${normalizedName}`;

      case 'fuzzy':
        // For fuzzy matching, use a simplified key
        const fuzzyName = card.name
          .toLowerCase()
          .replace(/[^a-z0-9]/g, '')
          .substring(0, 20);
        return `${card.game}:${card.setCode}:${fuzzyName}`;

      default:
        return `${card.game}:${card.id}`;
    }
  }

  /**
   * Convert single card to merged format
   */
  private singleCardToMerged(card: SourcedCard): MergedCard {
    const source = this.sources.get(card.source);
    const qualityScore = this.calculateQualityScore([card]);

    return {
      ...card,
      sources: [card.source],
      primarySource: card.source,
      mergedAt: new Date(),
      conflictsResolved: 0,
      qualityScore,
      priceConfidence: card.priceUsd !== undefined ? (source?.trustScore || 0.5) * 0.7 : 0,
    };
  }

  /**
   * Calculate median
   */
  private median(values: number[]): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 0) {
      return (sorted[mid - 1] + sorted[mid]) / 2;
    }
    return sorted[mid];
  }
}

/**
 * Create a card merger instance
 */
export function createMerger(config?: Partial<MergeConfig>): CardMerger {
  return new CardMerger(config);
}

/**
 * Quick merge helper for two sources
 */
export function mergeTwoSources(
  primary: SourcedCard[],
  primarySource: string,
  secondary: SourcedCard[],
  secondarySource: string,
  config?: Partial<MergeConfig>
): { cards: MergedCard[]; stats: MergeStats } {
  const merger = new CardMerger(config);
  const sourceMap = new Map<string, SourcedCard[]>();
  sourceMap.set(primarySource, primary);
  sourceMap.set(secondarySource, secondary);
  return merger.mergeCards(sourceMap);
}
