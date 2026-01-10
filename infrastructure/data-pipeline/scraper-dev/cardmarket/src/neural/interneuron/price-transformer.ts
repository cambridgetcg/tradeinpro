/**
 * Price Transformer Neuron
 *
 * Interneuron that transforms raw price signals from sensory neurons.
 * Performs currency conversion to USD (standardized for ML training),
 * spread calculation, and trade-in margin application.
 *
 * Currency Standardization:
 *   - All prices normalized to USD for ML model consistency
 *   - Original source prices/currency retained for reference
 *
 * Neurotransmitters Released:
 *   - DOPAMINE: Price opportunity signal
 *   - GABA: Risk/caution signal
 */

import { BaseNeuron } from '../base-neuron';
import {
  NeuralLayer,
  NeuralSignal,
  NeurotransmitterType,
  RawPriceSignal,
  NormalizedPriceSignal,
} from '../types';

// =============================================================================
// INTERFACES
// =============================================================================

export interface PriceTransformerConfig {
  tradeinMultiplier: number;      // Default 0.70 (70% of best price)
  spreadWarningThreshold: number; // Alert if spread > this %
  enableOpportunityDetection: boolean;
}

export interface FXRateProvider {
  getRate(from: string, to: string): Promise<number | null>;
}

// Default FX rates to USD (fallback when provider unavailable)
const DEFAULT_FX_TO_USD: Record<string, number> = {
  'USD': 1.0,
  'EUR': 1.08,  // EUR is stronger than USD
  'GBP': 1.27,  // GBP is stronger than USD
  'JPY': 0.0067,
  'AUD': 0.65,
  'CAD': 0.74,
};

// =============================================================================
// PRICE TRANSFORMER NEURON
// =============================================================================

export class PriceTransformerNeuron extends BaseNeuron<
  RawPriceSignal,
  NormalizedPriceSignal
> {
  private config: PriceTransformerConfig;
  private fxProvider?: FXRateProvider;

  // Cached FX rates
  private fxCache: Map<string, { rate: number; timestamp: Date }> = new Map();
  private fxCacheTtlMs: number = 3600000; // 1 hour

  // Transformation statistics
  private stats: TransformationStats;

  constructor(
    config: Partial<PriceTransformerConfig> = {},
    fxProvider?: FXRateProvider
  ) {
    super('PriceTransformer', NeuralLayer.INTERNEURON);

    this.config = {
      tradeinMultiplier: 0.70,
      spreadWarningThreshold: 0.20, // 20%
      enableOpportunityDetection: true,
      ...config,
    };

    this.fxProvider = fxProvider;

    this.stats = {
      processed: 0,
      fxConverted: 0,
      opportunities: 0,
      risks: 0,
      avgSpread: 0,
      bySource: new Map(),
    };
  }

  // ===========================================================================
  // LIFECYCLE
  // ===========================================================================

  protected async onInitialize(): Promise<void> {
    // Pre-warm FX cache if provider available
    if (this.fxProvider) {
      await this.warmFxCache();
    }

    console.log(`💱 [${this.name}] Price transformer initialized`);
    console.log(`   Trade-in multiplier: ${this.config.tradeinMultiplier}`);
    console.log(`   Target currency: USD (standardized for ML)`);
    console.log(`   FX provider: ${this.fxProvider ? 'Available' : 'Using defaults'}`);
  }

  protected async onShutdown(): Promise<void> {
    this.logStats();
    this.fxCache.clear();
  }

  // ===========================================================================
  // FX CACHE MANAGEMENT
  // ===========================================================================

  private async warmFxCache(): Promise<void> {
    // Pre-warm all source currencies to USD
    const currencies = ['EUR', 'GBP', 'JPY', 'AUD', 'CAD'];

    for (const from of currencies) {
      try {
        const rate = await this.fxProvider?.getRate(from, 'USD');
        if (rate) {
          this.fxCache.set(`${from}/USD`, { rate, timestamp: new Date() });
          console.log(`   Cached ${from}/USD: ${rate.toFixed(4)}`);
        }
      } catch (error) {
        console.warn(`   Failed to cache ${from}/USD: ${error}`);
      }
    }
  }

  private async getFxRate(from: string, to: string): Promise<number> {
    // Same currency = no conversion
    if (from === to) return 1.0;

    const pair = `${from}/${to}`;

    // Check cache
    const cached = this.fxCache.get(pair);
    if (cached && Date.now() - cached.timestamp.getTime() < this.fxCacheTtlMs) {
      return cached.rate;
    }

    // Fetch from provider
    if (this.fxProvider) {
      try {
        const rate = await this.fxProvider.getRate(from, to);
        if (rate) {
          this.fxCache.set(pair, { rate, timestamp: new Date() });
          return rate;
        }
      } catch (error) {
        console.warn(`FX fetch failed for ${pair}: ${error}`);
      }
    }

    // Return default rates (to USD)
    if (to === 'USD') {
      return DEFAULT_FX_TO_USD[from] || 1.0;
    } else if (from === 'USD') {
      return 1.0 / (DEFAULT_FX_TO_USD[to] || 1.0);
    }

    // Cross-rate through USD
    const fromToUsd = DEFAULT_FX_TO_USD[from] || 1.0;
    const toToUsd = DEFAULT_FX_TO_USD[to] || 1.0;
    return fromToUsd / toToUsd;
  }

  // ===========================================================================
  // SIGNAL PROCESSING
  // ===========================================================================

  async processSignal(
    signal: NeuralSignal<RawPriceSignal>
  ): Promise<NormalizedPriceSignal> {
    const raw = signal.payload;
    this.stats.processed++;

    // Track by source marketplace
    const sourceCount = this.stats.bySource.get(raw.source) || 0;
    this.stats.bySource.set(raw.source, sourceCount + 1);

    // Get FX rate for currency conversion to USD
    const fxRate = await this.getFxRate(raw.currency, 'USD');
    if (raw.currency !== 'USD') {
      this.stats.fxConverted++;
    }

    // Convert all prices to USD (standardized for ML training)
    const priceFromUsd = raw.priceFrom !== null ? raw.priceFrom * fxRate : 0;
    const priceTrendUsd = raw.priceTrend !== null ? raw.priceTrend * fxRate : 0;
    const priceAvgUsd = raw.priceAvg !== null ? raw.priceAvg * fxRate : 0;

    // Determine best price (lowest available)
    const prices = [priceFromUsd, priceTrendUsd, priceAvgUsd].filter((p) => p > 0);
    const bestPriceUsd = prices.length > 0 ? Math.min(...prices) : 0;

    // Calculate trade-in price
    const tradeinPriceUsd = bestPriceUsd * this.config.tradeinMultiplier;

    // Calculate spread
    const { spreadPercent, spreadAbsolute } = this.calculateSpread(prices);

    // Update running average spread
    this.stats.avgSpread =
      (this.stats.avgSpread * (this.stats.processed - 1) + spreadPercent) /
      this.stats.processed;

    // Build normalized signal with source currency retention
    const normalized: NormalizedPriceSignal = {
      cardId: raw.cardId,
      name: raw.name,

      // USD normalized prices for ML training
      priceFromUsd,
      priceTrendUsd,
      priceAvgUsd,

      bestPriceUsd,
      tradeinPriceUsd,

      // Original source data retained for reference
      source: {
        marketplace: raw.source,
        currency: raw.currency,
        priceFrom: raw.priceFrom,
        priceTrend: raw.priceTrend,
        priceAvg: raw.priceAvg,
      },

      spreadPercent,
      spreadAbsolute,

      fxRate,
      fxSource: this.fxProvider ? 'provider' : 'default',

      timestamp: new Date(),
    };

    // Detect opportunities and risks
    if (this.config.enableOpportunityDetection) {
      this.analyzeOpportunities(normalized, raw);
    }

    return normalized;
  }

  // ===========================================================================
  // SPREAD CALCULATION
  // ===========================================================================

  private calculateSpread(prices: number[]): {
    spreadPercent: number;
    spreadAbsolute: number;
  } {
    if (prices.length < 2) {
      return { spreadPercent: 0, spreadAbsolute: 0 };
    }

    const min = Math.min(...prices);
    const max = Math.max(...prices);

    const spreadAbsolute = max - min;
    const spreadPercent = min > 0 ? (max - min) / min : 0;

    return { spreadPercent, spreadAbsolute };
  }

  // ===========================================================================
  // OPPORTUNITY DETECTION
  // ===========================================================================

  private analyzeOpportunities(
    normalized: NormalizedPriceSignal,
    raw: RawPriceSignal
  ): void {
    // High spread indicates potential opportunity
    if (normalized.spreadPercent >= this.config.spreadWarningThreshold) {
      this.stats.opportunities++;
      console.log(
        `💰 [${this.name}] Opportunity: ${raw.cardId} spread ${(
          normalized.spreadPercent * 100
        ).toFixed(1)}% (source: ${raw.source})`
      );
    }

    // Very high spread might indicate data quality issue (risk)
    if (normalized.spreadPercent > 0.5) {
      this.stats.risks++;
      console.log(
        `⚠️ [${this.name}] Risk: ${raw.cardId} excessive spread ${(
          normalized.spreadPercent * 100
        ).toFixed(1)}%`
      );
    }

    // Low availability with good price (CardMarket only - eBay is sold listings)
    if (raw.source === 'cardmarket' && raw.availableItems <= 3 && normalized.bestPriceUsd >= 12) {
      this.stats.opportunities++;
      console.log(
        `💰 [${this.name}] Scarcity opportunity: ${raw.cardId} (${raw.availableItems} available)`
      );
    }
  }

  // ===========================================================================
  // NEUROTRANSMITTER SELECTION
  // ===========================================================================

  protected selectNeurotransmitter(
    output: NormalizedPriceSignal
  ): NeurotransmitterType {
    // High spread = opportunity signal
    if (output.spreadPercent >= this.config.spreadWarningThreshold) {
      return NeurotransmitterType.DOPAMINE;
    }

    // Excessive spread = risk signal
    if (output.spreadPercent > 0.5) {
      return NeurotransmitterType.GABA;
    }

    // High-value trade-in = attention ($40 USD threshold)
    if (output.tradeinPriceUsd >= 40) {
      return NeurotransmitterType.NOREPINEPHRINE;
    }

    // Standard signal
    return NeurotransmitterType.GLUTAMATE;
  }

  protected calculateSignalStrength(output: NormalizedPriceSignal): number {
    // Base strength on data quality and value
    let strength = 0.5;

    // Better data = stronger signal
    const priceCount = [
      output.priceFromUsd,
      output.priceTrendUsd,
      output.priceAvgUsd,
    ].filter((p) => p > 0).length;
    strength += priceCount * 0.1;

    // Higher value = stronger signal ($60 USD / $25 USD thresholds)
    if (output.bestPriceUsd >= 60) {
      strength += 0.2;
    } else if (output.bestPriceUsd >= 25) {
      strength += 0.1;
    }

    // Tight spread = higher confidence = stronger signal
    if (output.spreadPercent < 0.05) {
      strength += 0.1;
    }

    return Math.min(strength, 1.0);
  }

  // ===========================================================================
  // STATISTICS
  // ===========================================================================

  private logStats(): void {
    console.log(`\n📊 [${this.name}] Transformation Statistics:`);
    console.log(`   Processed: ${this.stats.processed}`);
    console.log(`   FX converted: ${this.stats.fxConverted}`);
    console.log(`   Opportunities detected: ${this.stats.opportunities}`);
    console.log(`   Risks flagged: ${this.stats.risks}`);
    console.log(`   Average spread: ${(this.stats.avgSpread * 100).toFixed(2)}%`);

    if (this.stats.bySource.size > 0) {
      console.log(`   By source marketplace:`);
      this.stats.bySource.forEach((count, source) => {
        console.log(`     - ${source}: ${count}`);
      });
    }
  }

  getStats(): TransformationStats {
    return { ...this.stats };
  }

  // ===========================================================================
  // FX RATE INJECTION (for testing)
  // ===========================================================================

  setFxProvider(provider: FXRateProvider): void {
    this.fxProvider = provider;
  }

  injectFxRate(from: string, to: string, rate: number): void {
    const pair = `${from}/${to}`;
    this.fxCache.set(pair, { rate, timestamp: new Date() });
  }
}

// =============================================================================
// SUPPORTING TYPES
// =============================================================================

interface TransformationStats {
  processed: number;
  fxConverted: number;
  opportunities: number;
  risks: number;
  avgSpread: number;
  bySource: Map<string, number>;
}
