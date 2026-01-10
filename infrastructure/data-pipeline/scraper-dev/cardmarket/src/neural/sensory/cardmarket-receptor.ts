/**
 * CardMarket Receptor Neuron
 *
 * Sensory neuron that receives raw price data from CardMarket scraping.
 * Acts as the first point of contact with external data, converting
 * DOM-scraped prices into standardized neural signals.
 *
 * Myelin Sheaths:
 *   - V2/V3 English-only (skip language detection)
 *   - Cloudflare bypass via VPN
 *   - Rate-limit aware delays (5-10s)
 */

import { BaseNeuron } from '../base-neuron';
import {
  NeuralLayer,
  NeuralSignal,
  NeurotransmitterType,
  RawPriceSignal,
  MyelinSheath,
} from '../types';

// =============================================================================
// INTERFACES
// =============================================================================

export interface CardMarketScrapeResult {
  cardId: string;
  name: string;
  variantType: string;

  // Scraped prices (EUR)
  priceFrom: number | null;
  priceTrend: number | null;
  priceAvg: number | null;

  // Listing data
  availableItems: number;

  // Metadata
  language: string;
  url: string;
  scraped_at: Date;

  // Validation
  isValid: boolean;
  validationErrors: string[];
}

export interface ReceptorConfig {
  minPriceEur: number;
  maxPriceEur: number;
  refractoryPeriodMs: number;
  enableMyelinOptimizations: boolean;
}

// =============================================================================
// CARDMARKET RECEPTOR NEURON
// =============================================================================

export class CardMarketReceptorNeuron extends BaseNeuron<
  CardMarketScrapeResult,
  RawPriceSignal
> {
  private config: ReceptorConfig;
  private validationStats: ValidationStats;

  constructor(config: Partial<ReceptorConfig> = {}) {
    super('CardMarketReceptor', NeuralLayer.SENSORY);

    this.config = {
      minPriceEur: 0.50,
      maxPriceEur: 10000,
      refractoryPeriodMs: 5000, // 5 seconds between scrapes
      enableMyelinOptimizations: true,
      ...config,
    };

    this.validationStats = {
      received: 0,
      accepted: 0,
      rejected: 0,
      byReason: new Map(),
    };
  }

  // ===========================================================================
  // LIFECYCLE
  // ===========================================================================

  protected async onInitialize(): Promise<void> {
    // Add myelin sheaths (optimizations)
    if (this.config.enableMyelinOptimizations) {
      this.initializeMyelinSheaths();
    }

    console.log(`📡 [${this.name}] CardMarket receptor initialized`);
    console.log(`   Min price: €${this.config.minPriceEur}`);
    console.log(`   Max price: €${this.config.maxPriceEur}`);
    console.log(`   Refractory period: ${this.config.refractoryPeriodMs}ms`);
  }

  protected async onShutdown(): Promise<void> {
    this.logValidationStats();
  }

  // ===========================================================================
  // MYELIN SHEATHS (OPTIMIZATIONS)
  // ===========================================================================

  private initializeMyelinSheaths(): void {
    // Sheath 1: V2/V3 English-only optimization
    const v2v3Sheath: MyelinSheath = {
      id: 'v2v3-english-only',
      name: 'V2/V3 English-Only',
      location: 'CardMarket Receptor → Validation Filter',
      effect: 'Skip language detection for V2/V3 variants',
      speedupFactor: 1.3, // 30% faster
      source: 'CARDMARKET_SCRAPING_INSIGHTS.md',
      ttlMs: undefined, // No caching, just skip logic
    };
    this.addMyelinSheath(v2v3Sheath);

    // Sheath 2: Known card ID patterns
    const knownCardsSheath: MyelinSheath = {
      id: 'known-card-patterns',
      name: 'Known Card ID Patterns',
      location: 'CardMarket Receptor validation',
      effect: 'Fast-path validation for known card ID formats',
      speedupFactor: 1.2,
      source: 'Empirical pattern matching',
      ttlMs: 3600000, // 1 hour cache
      cache: new Map(),
    };
    this.addMyelinSheath(knownCardsSheath);

    console.log(`⚡ [${this.name}] Myelin sheaths initialized: 2`);
  }

  // ===========================================================================
  // SIGNAL PROCESSING
  // ===========================================================================

  async processSignal(
    signal: NeuralSignal<CardMarketScrapeResult>
  ): Promise<RawPriceSignal> {
    const scrapeResult = signal.payload;
    this.validationStats.received++;

    // Apply V2/V3 myelin sheath optimization
    const isV2V3 = this.isV2V3Variant(scrapeResult.variantType);
    const skipLanguageCheck = isV2V3 && this.myelinSheaths.has('v2v3-english-only');

    // Validate the scrape result
    const validation = this.validateScrapeResult(scrapeResult, skipLanguageCheck);

    if (!validation.isValid) {
      this.validationStats.rejected++;
      validation.errors.forEach((reason) => {
        const count = this.validationStats.byReason.get(reason) || 0;
        this.validationStats.byReason.set(reason, count + 1);
      });

      throw new Error(
        `Invalid scrape result for ${scrapeResult.cardId}: ${validation.errors.join(', ')}`
      );
    }

    this.validationStats.accepted++;

    // Transform to standardized RawPriceSignal
    const rawSignal: RawPriceSignal = {
      cardId: scrapeResult.cardId,
      name: scrapeResult.name,
      source: 'cardmarket',
      currency: 'EUR',

      priceFrom: scrapeResult.priceFrom,
      priceTrend: scrapeResult.priceTrend,
      priceAvg: scrapeResult.priceAvg,

      variantType: scrapeResult.variantType,
      language: skipLanguageCheck ? 'EN' : scrapeResult.language,
      availableItems: scrapeResult.availableItems,
      scraped_at: scrapeResult.scraped_at,
    };

    return rawSignal;
  }

  // ===========================================================================
  // VALIDATION
  // ===========================================================================

  private validateScrapeResult(
    result: CardMarketScrapeResult,
    skipLanguageCheck: boolean
  ): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Check if already marked invalid
    if (!result.isValid) {
      errors.push(...result.validationErrors);
    }

    // Validate card ID format
    if (!this.isValidCardId(result.cardId)) {
      errors.push('Invalid card ID format');
    }

    // Validate prices exist
    if (
      result.priceFrom === null &&
      result.priceTrend === null &&
      result.priceAvg === null
    ) {
      errors.push('No price data available');
    }

    // Validate price bounds
    const prices = [result.priceFrom, result.priceTrend, result.priceAvg].filter(
      (p): p is number => p !== null
    );

    for (const price of prices) {
      if (price < this.config.minPriceEur) {
        errors.push(`Price below minimum (€${price} < €${this.config.minPriceEur})`);
        break;
      }
      if (price > this.config.maxPriceEur) {
        errors.push(`Price above maximum (€${price} > €${this.config.maxPriceEur})`);
        break;
      }
    }

    // Validate language (unless myelin-optimized)
    if (!skipLanguageCheck && !this.isValidLanguage(result.language)) {
      errors.push(`Invalid language: ${result.language}`);
    }

    // Validate available items
    if (result.availableItems < 0) {
      errors.push('Negative available items');
    }

    // Check for price anomalies
    if (this.hasPriceAnomaly(result)) {
      errors.push('Price anomaly detected');
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  private isValidCardId(cardId: string): boolean {
    // Check myelin cache first
    const cached = this.checkMyelinCache<boolean>('known-card-patterns', cardId);
    if (cached !== null) return cached;

    // One Piece TCG card ID patterns:
    // OP01-001, OP01-001-parallel, OP03-OP01-051-sp, etc.
    const patterns = [
      /^[A-Z]{2}\d{2}-\d{3}$/,                           // Standard: OP01-001
      /^[A-Z]{2}\d{2}-\d{3}-[a-z]+$/,                    // With variant: OP01-001-parallel
      /^[A-Z]{2}\d{2}-[A-Z]{2}\d{2}-\d{3}$/,             // SP prefix: OP03-OP01-051
      /^[A-Z]{2}\d{2}-[A-Z]{2}\d{2}-\d{3}-[a-z]+$/,      // SP with variant: OP03-OP01-051-sp
      /^[A-Z]{2,3}\d{2}-\d{3}$/,                         // Event cards: PRB01-001
    ];

    const isValid = patterns.some((pattern) => pattern.test(cardId));

    // Store in myelin cache
    this.setMyelinCache('known-card-patterns', cardId, isValid);

    return isValid;
  }

  private isV2V3Variant(variantType: string): boolean {
    // V2/V3 variants are English-only (per CARDMARKET_SCRAPING_INSIGHTS.md)
    const v2v3Types = ['v2', 'v3', 'parallel', 'manga', 'boxtopper', 'wanted'];
    return v2v3Types.some((t) =>
      variantType.toLowerCase().includes(t)
    );
  }

  private isValidLanguage(language: string): boolean {
    const validLanguages = ['EN', 'JP', 'DE', 'FR', 'ES', 'IT'];
    return validLanguages.includes(language.toUpperCase());
  }

  private hasPriceAnomaly(result: CardMarketScrapeResult): boolean {
    // Check for suspicious patterns
    const prices = [result.priceFrom, result.priceTrend, result.priceAvg].filter(
      (p): p is number => p !== null
    );

    if (prices.length < 2) return false;

    // Check for extreme variance (>500% difference)
    const min = Math.min(...prices);
    const max = Math.max(...prices);

    if (min > 0 && max / min > 5) {
      console.warn(
        `⚠️ [${this.name}] Price anomaly for ${result.cardId}: ${min} - ${max}`
      );
      return true;
    }

    return false;
  }

  // ===========================================================================
  // NEUROTRANSMITTER SELECTION
  // ===========================================================================

  protected selectNeurotransmitter(output: RawPriceSignal): NeurotransmitterType {
    // Calculate best price for evaluation
    const prices = [output.priceFrom, output.priceTrend, output.priceAvg].filter(
      (p): p is number => p !== null
    );

    if (prices.length === 0) {
      return NeurotransmitterType.GABA; // Inhibitory - no usable data
    }

    const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;

    // High-value cards (>€50) trigger more attention
    if (avgPrice >= 50) {
      return NeurotransmitterType.NOREPINEPHRINE; // Alert/attention
    }

    // Low availability might indicate opportunity
    if (output.availableItems <= 3) {
      return NeurotransmitterType.DOPAMINE; // Opportunity signal
    }

    // Standard excitatory signal
    return NeurotransmitterType.GLUTAMATE;
  }

  protected calculateSignalStrength(output: RawPriceSignal): number {
    // Strength based on data quality and price magnitude
    let strength = 0.5; // Base strength

    // Adjust for data completeness
    const priceCount = [output.priceFrom, output.priceTrend, output.priceAvg].filter(
      (p) => p !== null
    ).length;
    strength += priceCount * 0.1;

    // Adjust for availability (scarcity increases signal)
    if (output.availableItems > 0 && output.availableItems <= 5) {
      strength += 0.2;
    }

    return Math.min(strength, 1.0);
  }

  // ===========================================================================
  // STATISTICS
  // ===========================================================================

  private logValidationStats(): void {
    console.log(`\n📊 [${this.name}] Validation Statistics:`);
    console.log(`   Received: ${this.validationStats.received}`);
    console.log(`   Accepted: ${this.validationStats.accepted}`);
    console.log(`   Rejected: ${this.validationStats.rejected}`);
    console.log(
      `   Acceptance rate: ${(
        (this.validationStats.accepted / Math.max(this.validationStats.received, 1)) *
        100
      ).toFixed(1)}%`
    );

    if (this.validationStats.byReason.size > 0) {
      console.log(`   Rejection reasons:`);
      this.validationStats.byReason.forEach((count, reason) => {
        console.log(`     - ${reason}: ${count}`);
      });
    }
  }

  getValidationStats(): ValidationStats {
    return { ...this.validationStats };
  }
}

// =============================================================================
// SUPPORTING TYPES
// =============================================================================

interface ValidationStats {
  received: number;
  accepted: number;
  rejected: number;
  byReason: Map<string, number>;
}
