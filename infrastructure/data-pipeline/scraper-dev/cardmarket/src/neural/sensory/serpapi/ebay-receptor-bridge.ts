/**
 * eBay Receptor Bridge
 *
 * Connects the SerpAPI Alchemist module to the EbayReceptorNeuron,
 * allowing processed eBay sold listings to flow through the neural network.
 *
 * Data Flow:
 *   SerpApiClient → ProcessedListings → Bridge → EbayReceptorNeuron → NeuralNetwork
 *
 * @see docs/SERPAPI_ALCHEMIST_GRIMOIRE.md
 */

import { BaseNeuron } from '../../base-neuron';
import {
  NeuralLayer,
  NeuralSignal,
  NeurotransmitterType,
  NormalizedPriceSignal,
} from '../../types';
import { ProcessedListing, QueryResult, ClientStats } from './serpapi-client';
import { QueryOrchestrator, getOrchestrator, CollectionBatch } from './query-orchestrator';

// =============================================================================
// TYPES
// =============================================================================

export interface BridgeConfig {
  batchSize: number;
  minConfidence: number;
  enableRealTimeFlow: boolean;
  bufferFlushIntervalMs: number;
}

export interface BridgeOutput {
  signals: NormalizedPriceSignal[];
  batchId: string;
  sourceListings: number;
  processedSignals: number;
  skipped: number;
  timestamp: Date;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const DEFAULT_CONFIG: BridgeConfig = {
  batchSize: 50,
  minConfidence: 0.5,
  enableRealTimeFlow: true,
  bufferFlushIntervalMs: 5000,
};

// =============================================================================
// EBAY RECEPTOR BRIDGE NEURON
// =============================================================================

export class EbayReceptorBridgeNeuron extends BaseNeuron<QueryResult[], BridgeOutput> {
  private config: BridgeConfig;
  private orchestrator: QueryOrchestrator;

  // Signal buffer for batching (using different name to avoid base class conflict)
  private priceSignalBuffer: NormalizedPriceSignal[] = [];
  private flushTimer: NodeJS.Timeout | null = null;

  // Downstream neurons to notify
  private downstreamNeurons: Array<(signal: NeuralSignal<NormalizedPriceSignal[]>) => Promise<void>> = [];

  // Statistics
  private stats: BridgeStats;

  constructor(config: Partial<BridgeConfig> = {}) {
    super('EbayReceptorBridge', NeuralLayer.SENSORY);

    this.config = { ...DEFAULT_CONFIG, ...config };
    this.orchestrator = getOrchestrator();

    this.stats = {
      listingsProcessed: 0,
      signalsEmitted: 0,
      signalsSkipped: 0,
      batchesEmitted: 0,
      avgConfidence: 0,
    };
  }

  // ===========================================================================
  // LIFECYCLE
  // ===========================================================================

  protected async onInitialize(): Promise<void> {
    console.log(`🌉 [${this.name}] eBay Receptor Bridge initialized`);
    console.log(`   Batch size: ${this.config.batchSize}`);
    console.log(`   Min confidence: ${this.config.minConfidence}`);
    console.log(`   Real-time flow: ${this.config.enableRealTimeFlow}`);

    if (this.config.enableRealTimeFlow) {
      this.startFlushTimer();
    }
  }

  protected async onShutdown(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    // Flush remaining buffer
    if (this.priceSignalBuffer.length > 0) {
      await this.flushBuffer();
    }

    this.logStats();
  }

  // ===========================================================================
  // SIGNAL PROCESSING
  // ===========================================================================

  async processSignal(signal: NeuralSignal<QueryResult[]>): Promise<BridgeOutput> {
    const results = signal.payload;
    const output: BridgeOutput = {
      signals: [],
      batchId: signal.id,
      sourceListings: 0,
      processedSignals: 0,
      skipped: 0,
      timestamp: new Date(),
    };

    // Process all query results
    for (const result of results) {
      for (const listing of result.listings) {
        output.sourceListings++;

        if (!listing.isUsable) {
          output.skipped++;
          this.stats.signalsSkipped++;
          continue;
        }

        // Apply confidence filter before conversion
        if (listing.parsed.confidence < this.config.minConfidence) {
          output.skipped++;
          this.stats.signalsSkipped++;
          continue;
        }

        // Convert to normalized price signal
        const priceSignal = this.convertToNormalizedSignal(listing, result);

        output.signals.push(priceSignal);
        output.processedSignals++;
        this.stats.signalsEmitted++;

        // Add to buffer for real-time flow
        if (this.config.enableRealTimeFlow) {
          this.priceSignalBuffer.push(priceSignal);

          if (this.priceSignalBuffer.length >= this.config.batchSize) {
            await this.flushBuffer();
          }
        }
      }
    }

    this.stats.listingsProcessed += output.sourceListings;

    console.log(
      `🌉 [${this.name}] Processed ${output.sourceListings} listings → ${output.processedSignals} signals`
    );

    return output;
  }

  // ===========================================================================
  // CONVERSION
  // ===========================================================================

  private convertToNormalizedSignal(
    listing: ProcessedListing,
    queryResult: QueryResult
  ): NormalizedPriceSignal {
    const { parsed } = listing;

    return {
      cardId: parsed.cardId || 'UNKNOWN',
      name: listing.title.slice(0, 100), // Truncate title for name

      // All prices in USD (standardized)
      priceFromUsd: listing.priceUsd,
      priceTrendUsd: listing.priceUsd, // Single sale, no trend
      priceAvgUsd: listing.priceUsd,
      bestPriceUsd: listing.priceUsd,
      tradeinPriceUsd: listing.priceUsd * 0.7, // Estimate trade-in at 70%

      // Source data (using type assertion for extended fields)
      source: {
        marketplace: 'ebay' as const,
        currency: listing.originalCurrency as 'EUR' | 'USD' | 'GBP' | 'JPY',
        priceFrom: listing.originalPrice,
        priceTrend: listing.originalPrice, // Use same price for single data point
        priceAvg: listing.originalPrice,
      },

      // Spread analysis (N/A for sold listings - single data point)
      spreadPercent: 0,
      spreadAbsolute: 0,

      // FX info
      fxRate: this.getFxRate(listing.originalCurrency),
      fxSource: 'serpapi-default',

      timestamp: listing.soldDate || new Date(),
    };
  }

  private getFxRate(currency: string): number {
    const rates: Record<string, number> = {
      'USD': 1.0,
      'GBP': 1.27,
      'EUR': 1.08,
      'AUD': 0.65,
      'CAD': 0.74,
    };
    return rates[currency] || 1.0;
  }

  // ===========================================================================
  // BUFFER MANAGEMENT
  // ===========================================================================

  private startFlushTimer(): void {
    this.flushTimer = setInterval(async () => {
      if (this.priceSignalBuffer.length > 0) {
        await this.flushBuffer();
      }
    }, this.config.bufferFlushIntervalMs);
  }

  private async flushBuffer(): Promise<void> {
    if (this.priceSignalBuffer.length === 0) return;

    const batch = [...this.priceSignalBuffer];
    this.priceSignalBuffer = [];

    // Create signal for downstream neurons
    const signal: NeuralSignal<NormalizedPriceSignal[]> = {
      id: `bridge-batch-${Date.now()}`,
      sourceNeuron: this.id,
      timestamp: new Date(),
      signalType: 'excitatory',
      strength: 1.0,
      payload: batch,
      neurotransmitter: NeurotransmitterType.GLUTAMATE,
    };

    // Emit to downstream neurons
    for (const downstream of this.downstreamNeurons) {
      try {
        await downstream(signal);
      } catch (error) {
        console.error(`❌ [${this.name}] Error sending to downstream:`, error);
      }
    }

    this.stats.batchesEmitted++;
    console.log(`📤 [${this.name}] Emitted batch of ${batch.length} signals`);
  }

  // ===========================================================================
  // DOWNSTREAM CONNECTIONS
  // ===========================================================================

  /**
   * Register a downstream neuron to receive price signals
   */
  connectDownstream(
    handler: (signal: NeuralSignal<NormalizedPriceSignal[]>) => Promise<void>
  ): void {
    this.downstreamNeurons.push(handler);
  }

  /**
   * Disconnect all downstream neurons
   */
  disconnectAll(): void {
    this.downstreamNeurons = [];
  }

  // ===========================================================================
  // ORCHESTRATOR INTEGRATION
  // ===========================================================================

  /**
   * Run a full collection cycle and process results
   */
  async runCollectionCycle(
    schedule: 'morning' | 'midday' | 'evening' = 'morning'
  ): Promise<BridgeOutput> {
    let batch: CollectionBatch;

    switch (schedule) {
      case 'morning':
        batch = await this.orchestrator.runMorningBatch();
        break;
      case 'midday':
        batch = await this.orchestrator.runMiddayBatch();
        break;
      case 'evening':
        batch = await this.orchestrator.runEveningBatch();
        break;
    }

    // Process the batch through this neuron
    const signal: NeuralSignal<QueryResult[]> = {
      id: batch.id,
      sourceNeuron: 'orchestrator',
      timestamp: new Date(),
      signalType: 'excitatory',
      strength: 1.0,
      payload: batch.results,
      neurotransmitter: NeurotransmitterType.GLUTAMATE,
    };

    return this.processSignal(signal);
  }

  /**
   * Export all collected data for training
   */
  async exportForTraining(): Promise<{
    signals: NormalizedPriceSignal[];
    metadata: ExportMetadata;
  }> {
    const exportData = await this.orchestrator.exportForTraining();

    // Convert to normalized signals
    const signals: NormalizedPriceSignal[] = exportData.data.map((record) => ({
      cardId: record.card_id || 'UNKNOWN',
      name: record.title.slice(0, 100),
      priceFromUsd: record.price_usd,
      priceTrendUsd: record.price_usd,
      priceAvgUsd: record.price_usd,
      bestPriceUsd: record.price_usd,
      tradeinPriceUsd: record.price_usd * 0.7,
      source: {
        marketplace: 'ebay',
        currency: record.original_currency as 'EUR' | 'USD' | 'GBP' | 'JPY',
        priceFrom: record.original_price,
        priceTrend: null,
        priceAvg: null,
      },
      spreadPercent: 0,
      spreadAbsolute: 0,
      fxRate: this.getFxRate(record.original_currency),
      fxSource: 'serpapi-default',
      timestamp: record.sold_date ? new Date(record.sold_date) : new Date(),
    }));

    return {
      signals,
      metadata: {
        count: exportData.count,
        exportedAt: exportData.exportedAt,
        source: 'serpapi-ebay-sold',
      },
    };
  }

  // ===========================================================================
  // NEUROTRANSMITTER SELECTION
  // ===========================================================================

  protected selectNeurotransmitter(output: BridgeOutput): NeurotransmitterType {
    // High volume success
    if (output.processedSignals >= 50) {
      return NeurotransmitterType.DOPAMINE;
    }

    // Learning data
    return NeurotransmitterType.ACETYLCHOLINE;
  }

  protected calculateSignalStrength(output: BridgeOutput): number {
    if (output.sourceListings === 0) return 0.1;

    const successRate = output.processedSignals / output.sourceListings;
    return Math.max(0.1, successRate);
  }

  // ===========================================================================
  // STATISTICS
  // ===========================================================================

  private logStats(): void {
    console.log(`\n📊 [${this.name}] Bridge Statistics:`);
    console.log(`   Listings processed: ${this.stats.listingsProcessed}`);
    console.log(`   Signals emitted: ${this.stats.signalsEmitted}`);
    console.log(`   Signals skipped: ${this.stats.signalsSkipped}`);
    console.log(`   Batches emitted: ${this.stats.batchesEmitted}`);
  }

  getStats(): BridgeStats {
    return { ...this.stats };
  }

  /**
   * Get buffer size
   */
  getBufferSize(): number {
    return this.priceSignalBuffer.length;
  }

  /**
   * Force flush buffer
   */
  async forceFlush(): Promise<void> {
    await this.flushBuffer();
  }
}

// =============================================================================
// TYPES
// =============================================================================

interface BridgeStats {
  listingsProcessed: number;
  signalsEmitted: number;
  signalsSkipped: number;
  batchesEmitted: number;
  avgConfidence: number;
}

interface ExportMetadata {
  count: number;
  exportedAt: Date;
  source: string;
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

export function createEbayReceptorBridge(
  config: Partial<BridgeConfig> = {}
): EbayReceptorBridgeNeuron {
  return new EbayReceptorBridgeNeuron(config);
}
