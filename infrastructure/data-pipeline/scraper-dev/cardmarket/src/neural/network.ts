/**
 * TCG Neural Network
 *
 * Main orchestrator that wires together all neurons into a complete
 * processing pipeline. Manages signal propagation, synaptic connections,
 * and network-wide metrics.
 *
 * Network Architecture:
 *   Sensory → Interneuron → Association → Cortical → Motor
 *
 * Data Flow:
 *   CardMarket → PriceTransformer → NormScaler → LSTM → Ensemble → RDS/S3
 */

import { v4 as uuidv4 } from 'uuid';
import {
  NeuralNetwork,
  NeuronCluster,
  Synapse,
  MyelinSheath,
  NeuralSignal,
  NetworkMetrics,
  NeuralLayer,
  NeurotransmitterType,
} from './types';
import { BaseNeuron } from './base-neuron';

// Neuron imports
import { CardMarketReceptorNeuron } from './sensory/cardmarket-receptor';
import { PriceTransformerNeuron } from './interneuron/price-transformer';
import { NormalizationScalerNeuron } from './interneuron/normalization-scaler';
import { LSTMPredictorNeuron } from './cortical/lstm-predictor';
import { EnsembleOrchestratorNeuron } from './cortical/ensemble-orchestrator';
import { RDSWriterNeuron } from './motor/rds-writer';
import { S3UploaderNeuron } from './motor/s3-uploader';

// =============================================================================
// INTERFACES
// =============================================================================

export interface NetworkConfig {
  enableSensory: boolean;
  enableInterneuron: boolean;
  enableCortical: boolean;
  enableMotor: boolean;
  dryRun: boolean;
}

export interface NeuronRegistry {
  sensory: {
    cardmarket: CardMarketReceptorNeuron;
  };
  interneuron: {
    priceTransformer: PriceTransformerNeuron;
    normalizationScaler: NormalizationScalerNeuron;
  };
  cortical: {
    lstmPredictor: LSTMPredictorNeuron;
    ensembleOrchestrator: EnsembleOrchestratorNeuron;
  };
  motor: {
    rdsWriter: RDSWriterNeuron;
    s3Uploader: S3UploaderNeuron;
  };
}

// =============================================================================
// TCG NEURAL NETWORK
// =============================================================================

export class TCGNeuralNetwork implements NeuralNetwork {
  private config: NetworkConfig;
  public clusters: Map<string, NeuronCluster> = new Map();
  public synapses: Map<string, Synapse> = new Map();
  public myelinSheaths: Map<string, MyelinSheath> = new Map();

  // Neuron registry for direct access
  public neurons: Partial<NeuronRegistry> = {};

  // Network state
  private isInitialized: boolean = false;
  private startTime: Date = new Date();

  // Metrics
  private signalCount: number = 0;
  private errorCount: number = 0;
  private totalLatencyMs: number = 0;

  constructor(config: Partial<NetworkConfig> = {}) {
    this.config = {
      enableSensory: true,
      enableInterneuron: true,
      enableCortical: true,
      enableMotor: true,
      dryRun: false,
      ...config,
    };
  }

  // ===========================================================================
  // INITIALIZATION
  // ===========================================================================

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    console.log('═'.repeat(60));
    console.log('🧠 TCG NEURAL NETWORK - INITIALIZATION');
    console.log('═'.repeat(60));

    this.startTime = new Date();

    // Create neurons
    await this.createNeurons();

    // Wire synaptic connections
    this.wireSynapses();

    // Add global myelin sheaths
    this.addGlobalMyelinSheaths();

    // Initialize all neurons
    await this.initializeNeurons();

    this.isInitialized = true;

    console.log('═'.repeat(60));
    console.log('✅ NEURAL NETWORK ONLINE');
    console.log(`   Total neurons: ${this.getNeuronCount()}`);
    console.log(`   Total synapses: ${this.synapses.size}`);
    console.log(`   Myelin sheaths: ${this.myelinSheaths.size}`);
    console.log('═'.repeat(60));
  }

  private async createNeurons(): Promise<void> {
    console.log('\n📦 Creating neurons...');

    // Sensory Layer
    if (this.config.enableSensory) {
      this.neurons.sensory = {
        cardmarket: new CardMarketReceptorNeuron({
          minPriceEur: 0.50,
          maxPriceEur: 10000,
        }),
      };
      console.log('   ✓ Sensory layer: CardMarket receptor');
    }

    // Interneuron Layer
    if (this.config.enableInterneuron) {
      this.neurons.interneuron = {
        priceTransformer: new PriceTransformerNeuron({
          tradeinMultiplier: 0.70,
        }),
        normalizationScaler: new NormalizationScalerNeuron({
          clipMin: -3.0,
          clipMax: 3.0,
        }),
      };
      console.log('   ✓ Interneuron layer: PriceTransformer, NormalizationScaler');
    }

    // Cortical Layer
    if (this.config.enableCortical) {
      this.neurons.cortical = {
        lstmPredictor: new LSTMPredictorNeuron({
          useMockModel: true,
        }),
        ensembleOrchestrator: new EnsembleOrchestratorNeuron({
          enableDynamicWeights: true,
        }),
      };
      console.log('   ✓ Cortical layer: LSTM Predictor, Ensemble Orchestrator');
    }

    // Motor Layer
    if (this.config.enableMotor) {
      this.neurons.motor = {
        rdsWriter: new RDSWriterNeuron(undefined, {
          dryRun: this.config.dryRun,
          batchSize: 50,
        }),
        s3Uploader: new S3UploaderNeuron(undefined, {
          dryRun: this.config.dryRun,
        }),
      };
      console.log('   ✓ Motor layer: RDS Writer, S3 Uploader');
    }
  }

  private wireSynapses(): void {
    console.log('\n🔗 Wiring synaptic connections...');

    const { sensory, interneuron, cortical, motor } = this.neurons;

    // Sensory → Interneuron
    if (sensory?.cardmarket && interneuron?.priceTransformer) {
      this.createSynapse(
        sensory.cardmarket,
        interneuron.priceTransformer,
        0.9,
        'excitatory'
      );
    }

    // Interneuron → Interneuron
    if (interneuron?.priceTransformer && interneuron?.normalizationScaler) {
      this.createSynapse(
        interneuron.priceTransformer,
        interneuron.normalizationScaler,
        0.95,
        'excitatory'
      );
    }

    // Interneuron → Motor (direct path for storage)
    if (interneuron?.priceTransformer && motor?.rdsWriter) {
      this.createSynapse(
        interneuron.priceTransformer,
        motor.rdsWriter,
        0.8,
        'excitatory'
      );
    }

    if (interneuron?.priceTransformer && motor?.s3Uploader) {
      this.createSynapse(
        interneuron.priceTransformer,
        motor.s3Uploader,
        0.8,
        'excitatory'
      );
    }

    // Interneuron → Cortical
    if (interneuron?.normalizationScaler && cortical?.lstmPredictor) {
      this.createSynapse(
        interneuron.normalizationScaler,
        cortical.lstmPredictor,
        0.9,
        'excitatory'
      );
    }

    // Cortical → Cortical
    if (cortical?.lstmPredictor && cortical?.ensembleOrchestrator) {
      const synapse = this.createSynapse(
        cortical.lstmPredictor,
        cortical.ensembleOrchestrator,
        0.5,
        'excitatory'
      );

      // Register with ensemble orchestrator for LTP/LTD
      cortical.ensembleOrchestrator.createModelSynapse(
        cortical.lstmPredictor.id,
        'lstm',
        0.5
      );
    }

    console.log(`   Total synapses: ${this.synapses.size}`);
  }

  private createSynapse(
    presynaptic: BaseNeuron,
    postsynaptic: BaseNeuron,
    weight: number,
    type: 'excitatory' | 'inhibitory' | 'modulatory'
  ): Synapse {
    const synapse: Synapse = {
      id: uuidv4(),
      presynapticNeuron: presynaptic.id,
      postsynapticNeuron: postsynaptic.id,
      weight,
      type,
      lastActivity: new Date(),
      longTermPotentiation: 0,
      longTermDepression: 0,
    };

    presynaptic.addAxonTerminal(synapse);
    postsynaptic.addDendrite(synapse);
    this.synapses.set(synapse.id, synapse);

    console.log(
      `   ${presynaptic.name} → ${postsynaptic.name} (${type}, w=${weight})`
    );

    return synapse;
  }

  private addGlobalMyelinSheaths(): void {
    console.log('\n⚡ Adding global myelin sheaths...');

    // Batch write optimization
    const batchSheath: MyelinSheath = {
      id: 'global-batch-writes',
      name: 'Global Batch Optimization',
      location: 'All motor neurons',
      effect: 'Batch database and S3 writes',
      speedupFactor: 10.0,
      source: 'Network configuration',
    };
    this.myelinSheaths.set(batchSheath.id, batchSheath);

    // FX caching
    const fxSheath: MyelinSheath = {
      id: 'global-fx-cache',
      name: 'FX Rate Caching',
      location: 'Price transformer',
      effect: '1-hour FX rate cache',
      speedupFactor: 5.0,
      source: 'Rate stability analysis',
      ttlMs: 3600000,
      cache: new Map(),
    };
    this.myelinSheaths.set(fxSheath.id, fxSheath);

    console.log(`   Total myelin sheaths: ${this.myelinSheaths.size}`);
  }

  private async initializeNeurons(): Promise<void> {
    console.log('\n🔌 Initializing neurons...');

    const allNeurons = this.getAllNeurons();

    for (const neuron of allNeurons) {
      await neuron.initialize();
    }
  }

  // ===========================================================================
  // SIGNAL PROPAGATION
  // ===========================================================================

  async propagateSignal(signal: NeuralSignal): Promise<NeuralSignal[]> {
    const startTime = Date.now();
    const outputs: NeuralSignal[] = [];

    try {
      // Find source neuron
      const sourceNeuron = this.findNeuronById(signal.sourceNeuron);
      if (!sourceNeuron) {
        throw new Error(`Source neuron not found: ${signal.sourceNeuron}`);
      }

      // Get output synapses
      const outputSynapses = sourceNeuron.axonTerminals;

      // Propagate to all connected neurons
      for (const synapse of outputSynapses) {
        const targetNeuron = this.findNeuronById(synapse.postsynapticNeuron);
        if (!targetNeuron) continue;

        // Apply synaptic weight
        const weightedSignal: NeuralSignal = {
          ...signal,
          strength: signal.strength * synapse.weight,
          targetNeuron: synapse.postsynapticNeuron,
        };

        // Deliver to target
        await targetNeuron.receiveDendrite(weightedSignal);

        outputs.push(weightedSignal);
        synapse.lastActivity = new Date();
      }

      this.signalCount++;
      this.totalLatencyMs += Date.now() - startTime;
    } catch (error) {
      this.errorCount++;
      console.error('Signal propagation error:', error);
      throw error;
    }

    return outputs;
  }

  // ===========================================================================
  // LEARNING (LTP/LTD)
  // ===========================================================================

  applyLTP(synapseId: string, strength: number): void {
    const synapse = this.synapses.get(synapseId);
    if (!synapse) return;

    synapse.longTermPotentiation += strength;
    synapse.weight = Math.min(1.0, synapse.weight + strength * 0.1);

    console.log(
      `📈 Network LTP: synapse ${synapseId} weight → ${synapse.weight.toFixed(3)}`
    );
  }

  applyLTD(synapseId: string, strength: number): void {
    const synapse = this.synapses.get(synapseId);
    if (!synapse) return;

    synapse.longTermDepression += strength;
    synapse.weight = Math.max(-1.0, synapse.weight - strength * 0.1);

    console.log(
      `📉 Network LTD: synapse ${synapseId} weight → ${synapse.weight.toFixed(3)}`
    );
  }

  // ===========================================================================
  // SHUTDOWN
  // ===========================================================================

  async shutdown(): Promise<void> {
    console.log('\n🛑 Shutting down neural network...');

    const allNeurons = this.getAllNeurons();

    // Shutdown in reverse order (motor first, sensory last)
    for (const neuron of allNeurons.reverse()) {
      await neuron.shutdown();
    }

    this.isInitialized = false;
    console.log('✅ Neural network offline');
  }

  // ===========================================================================
  // METRICS
  // ===========================================================================

  getNetworkMetrics(): NetworkMetrics {
    const allNeurons = this.getAllNeurons();
    const totalSignals = allNeurons.reduce(
      (sum, n) => sum + n.metrics.signalsReceived,
      0
    );
    const uptimeMs = Date.now() - this.startTime.getTime();

    return {
      totalClusters: this.clusters.size,
      totalNeurons: allNeurons.length,
      totalSynapses: this.synapses.size,
      signalsPerSecond:
        uptimeMs > 0 ? (this.signalCount / uptimeMs) * 1000 : 0,
      averageLatencyMs:
        this.signalCount > 0 ? this.totalLatencyMs / this.signalCount : 0,
      errorRate: totalSignals > 0 ? this.errorCount / totalSignals : 0,
      uptime: uptimeMs,
    };
  }

  // ===========================================================================
  // UTILITIES
  // ===========================================================================

  private getAllNeurons(): BaseNeuron[] {
    const neurons: BaseNeuron[] = [];

    if (this.neurons.sensory) {
      neurons.push(...Object.values(this.neurons.sensory));
    }
    if (this.neurons.interneuron) {
      neurons.push(...Object.values(this.neurons.interneuron));
    }
    if (this.neurons.cortical) {
      neurons.push(...Object.values(this.neurons.cortical));
    }
    if (this.neurons.motor) {
      neurons.push(...Object.values(this.neurons.motor));
    }

    return neurons;
  }

  private getNeuronCount(): number {
    return this.getAllNeurons().length;
  }

  private findNeuronById(id: string): BaseNeuron | undefined {
    return this.getAllNeurons().find((n) => n.id === id);
  }

  /**
   * Get neuron by layer and name
   */
  getNeuron<T extends BaseNeuron>(
    layer: keyof NeuronRegistry,
    name: string
  ): T | undefined {
    const layerNeurons = this.neurons[layer];
    if (!layerNeurons) return undefined;

    return (layerNeurons as Record<string, T>)[name];
  }

  /**
   * Print network status
   */
  printStatus(): void {
    const metrics = this.getNetworkMetrics();

    console.log('\n' + '═'.repeat(60));
    console.log('🧠 NEURAL NETWORK STATUS');
    console.log('═'.repeat(60));
    console.log(`Neurons: ${metrics.totalNeurons}`);
    console.log(`Synapses: ${metrics.totalSynapses}`);
    console.log(`Signals/sec: ${metrics.signalsPerSecond.toFixed(2)}`);
    console.log(`Avg latency: ${metrics.averageLatencyMs.toFixed(1)}ms`);
    console.log(`Error rate: ${(metrics.errorRate * 100).toFixed(2)}%`);
    console.log(`Uptime: ${(metrics.uptime / 1000).toFixed(1)}s`);
    console.log('═'.repeat(60));

    // Per-neuron status
    console.log('\nNeuron Status:');
    const allNeurons = this.getAllNeurons();
    for (const neuron of allNeurons) {
      const m = neuron.getMetrics();
      console.log(
        `  ${neuron.name}: recv=${m.signalsReceived}, sent=${m.signalsSent}, ` +
        `err=${m.errorsEncountered}, latency=${m.averageLatencyMs.toFixed(0)}ms`
      );
    }
  }
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

export async function createNeuralNetwork(
  config: Partial<NetworkConfig> = {}
): Promise<TCGNeuralNetwork> {
  const network = new TCGNeuralNetwork(config);
  await network.initialize();
  return network;
}
