/**
 * Base Neuron Abstract Class
 *
 * Provides core functionality for all neurons in the TCG neural network.
 * Handles signal reception, processing, and firing with biological metaphors.
 */

import { v4 as uuidv4 } from 'uuid';
import {
  INeuron,
  NeuralLayer,
  NeuralSignal,
  NeuronMetrics,
  NeuronState,
  NeurotransmitterType,
  Synapse,
  MyelinSheath,
  CacheEntry,
} from './types';

// =============================================================================
// CONSTANTS
// =============================================================================

const RESTING_POTENTIAL = -70; // mV
const THRESHOLD_POTENTIAL = -55; // mV
const PEAK_POTENTIAL = 40; // mV
const REFRACTORY_PERIOD_MS = 2; // Absolute refractory period
const DEFAULT_DECAY_RATE = 0.95; // Membrane potential decay per tick

// =============================================================================
// BASE NEURON ABSTRACT CLASS
// =============================================================================

export abstract class BaseNeuron<TInput = unknown, TOutput = unknown>
  implements INeuron<TInput, TOutput>
{
  public readonly id: string;
  public readonly name: string;
  public readonly layer: NeuralLayer;

  public state: NeuronState;
  public metrics: NeuronMetrics;

  public dendrites: Synapse[] = [];
  public axonTerminals: Synapse[] = [];

  // Myelin sheaths for optimization
  protected myelinSheaths: Map<string, MyelinSheath> = new Map();

  // Signal buffer for temporal integration
  protected signalBuffer: NeuralSignal<TInput>[] = [];
  protected bufferWindowMs: number = 100;

  // Internal state
  protected isInitialized: boolean = false;
  protected isShuttingDown: boolean = false;

  constructor(
    name: string,
    layer: NeuralLayer,
    options: Partial<NeuronOptions> = {}
  ) {
    this.id = options.id || `${layer}-${name}-${uuidv4().slice(0, 8)}`;
    this.name = name;
    this.layer = layer;

    // Initialize state
    this.state = {
      membranePotential: RESTING_POTENTIAL,
      isRefractory: false,
      refractoryEndTime: undefined,
      lastFired: null,
      firingRate: 0,
    };

    // Initialize metrics
    this.metrics = {
      signalsReceived: 0,
      signalsSent: 0,
      errorsEncountered: 0,
      averageLatencyMs: 0,
      lastActivity: new Date(),
    };

    if (options.bufferWindowMs) {
      this.bufferWindowMs = options.bufferWindowMs;
    }
  }

  // ===========================================================================
  // LIFECYCLE METHODS
  // ===========================================================================

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    console.log(`🧠 [${this.name}] Initializing neuron...`);

    // Subclass-specific initialization
    await this.onInitialize();

    this.isInitialized = true;
    console.log(`✅ [${this.name}] Neuron ready`);
  }

  async shutdown(): Promise<void> {
    if (this.isShuttingDown) return;

    this.isShuttingDown = true;
    console.log(`🛑 [${this.name}] Shutting down neuron...`);

    // Clear signal buffer
    this.signalBuffer = [];

    // Clear myelin caches
    this.myelinSheaths.forEach((sheath) => sheath.cache?.clear());

    // Subclass-specific cleanup
    await this.onShutdown();

    console.log(`⏹️ [${this.name}] Neuron stopped`);
  }

  // Abstract lifecycle hooks for subclasses
  protected abstract onInitialize(): Promise<void>;
  protected abstract onShutdown(): Promise<void>;

  // ===========================================================================
  // SIGNAL PROCESSING
  // ===========================================================================

  /**
   * Receive signal at dendrite (input)
   * Implements temporal summation and integration
   */
  async receiveDendrite(signal: NeuralSignal<TInput>): Promise<void> {
    if (!this.isInitialized || this.isShuttingDown) {
      throw new Error(`Neuron ${this.name} not ready to receive signals`);
    }

    this.metrics.signalsReceived++;
    this.metrics.lastActivity = new Date();

    // Check refractory period
    if (this.state.isRefractory) {
      const now = Date.now();
      if (
        this.state.refractoryEndTime &&
        now < this.state.refractoryEndTime.getTime()
      ) {
        // In absolute refractory period - signal ignored
        console.log(`⏸️ [${this.name}] Signal ignored (refractory period)`);
        return;
      } else {
        this.state.isRefractory = false;
      }
    }

    // Add to signal buffer for temporal summation
    this.signalBuffer.push(signal);

    // Clean old signals outside buffer window
    const cutoff = Date.now() - this.bufferWindowMs;
    this.signalBuffer = this.signalBuffer.filter(
      (s) => s.timestamp.getTime() > cutoff
    );

    // Calculate integrated potential from all buffered signals
    const integratedStrength = this.signalBuffer.reduce(
      (sum, s) => sum + s.strength,
      0
    );

    // Update membrane potential
    this.state.membranePotential = RESTING_POTENTIAL + integratedStrength * 20;

    // Check if threshold reached
    if (this.state.membranePotential >= THRESHOLD_POTENTIAL) {
      await this.triggerActionPotential(signal);
    }
  }

  /**
   * Trigger action potential (fire the neuron)
   */
  private async triggerActionPotential(
    triggeringSignal: NeuralSignal<TInput>
  ): Promise<void> {
    const startTime = Date.now();

    // Depolarization - membrane potential rises to peak
    this.state.membranePotential = PEAK_POTENTIAL;

    try {
      // Process the signal
      const output = await this.processSignal(triggeringSignal);

      // Determine neurotransmitter based on output
      const neurotransmitter = this.selectNeurotransmitter(output);

      // Fire axon (send output signal)
      const outputSignal = await this.fireAxon(output, neurotransmitter);

      // Update metrics
      this.metrics.signalsSent++;
      const latency = Date.now() - startTime;
      this.metrics.averageLatencyMs =
        (this.metrics.averageLatencyMs * (this.metrics.signalsSent - 1) +
          latency) /
        this.metrics.signalsSent;

      // Propagate to connected neurons via axon terminals
      for (const synapse of this.axonTerminals) {
        await this.propagateToSynapse(synapse, outputSignal);
      }
    } catch (error) {
      this.metrics.errorsEncountered++;
      console.error(`❌ [${this.name}] Error during action potential:`, error);
      throw error;
    } finally {
      // Repolarization - return to resting potential
      this.state.membranePotential = RESTING_POTENTIAL;
      this.state.lastFired = new Date();

      // Enter refractory period
      this.state.isRefractory = true;
      this.state.refractoryEndTime = new Date(
        Date.now() + REFRACTORY_PERIOD_MS
      );

      // Update firing rate
      this.updateFiringRate();

      // Clear signal buffer
      this.signalBuffer = [];
    }
  }

  /**
   * Process incoming signal (subclass implementation)
   */
  abstract processSignal(signal: NeuralSignal<TInput>): Promise<TOutput>;

  /**
   * Select appropriate neurotransmitter based on output
   */
  protected selectNeurotransmitter(_output: TOutput): NeurotransmitterType {
    // Default to glutamate (excitatory)
    // Subclasses should override for specific behavior
    return NeurotransmitterType.GLUTAMATE;
  }

  /**
   * Fire axon terminal with output signal
   */
  async fireAxon(
    output: TOutput,
    neurotransmitter: NeurotransmitterType
  ): Promise<NeuralSignal<TOutput>> {
    const signal: NeuralSignal<TOutput> = {
      id: uuidv4(),
      sourceNeuron: this.id,
      timestamp: new Date(),
      signalType: this.getSignalType(neurotransmitter),
      strength: this.calculateSignalStrength(output),
      payload: output,
      neurotransmitter,
    };

    return signal;
  }

  /**
   * Propagate signal through synapse to connected neuron
   */
  private async propagateToSynapse(
    synapse: Synapse,
    signal: NeuralSignal<TOutput>
  ): Promise<void> {
    // Apply synaptic weight
    const weightedSignal: NeuralSignal<TOutput> = {
      ...signal,
      targetNeuron: synapse.postsynapticNeuron,
      strength: signal.strength * synapse.weight,
    };

    // Update synapse activity
    synapse.lastActivity = new Date();

    // Note: In a full implementation, this would call the target neuron's receiveDendrite
    // For now, we emit an event or store for later processing
    console.log(
      `📤 [${this.name}] Signal sent to ${synapse.postsynapticNeuron} (weight: ${synapse.weight.toFixed(3)})`
    );
  }

  // ===========================================================================
  // MYELIN SHEATH (OPTIMIZATION)
  // ===========================================================================

  /**
   * Add myelin sheath for optimization
   */
  addMyelinSheath(sheath: MyelinSheath): void {
    this.myelinSheaths.set(sheath.id, {
      ...sheath,
      cache: new Map(),
    });
    console.log(`⚡ [${this.name}] Myelin sheath added: ${sheath.name}`);
  }

  /**
   * Check myelin cache for fast response
   */
  protected checkMyelinCache<T>(sheathId: string, key: string): T | null {
    const sheath = this.myelinSheaths.get(sheathId);
    if (!sheath?.cache) return null;

    const entry = sheath.cache.get(key) as CacheEntry | undefined;
    if (!entry) return null;

    // Check TTL
    const age = Date.now() - entry.timestamp.getTime();
    if (sheath.ttlMs && age > sheath.ttlMs) {
      sheath.cache.delete(key);
      return null;
    }

    // Cache hit
    entry.hits++;
    return entry.value as T;
  }

  /**
   * Store in myelin cache
   */
  protected setMyelinCache(sheathId: string, key: string, value: unknown): void {
    const sheath = this.myelinSheaths.get(sheathId);
    if (!sheath?.cache) return;

    sheath.cache.set(key, {
      value,
      timestamp: new Date(),
      hits: 0,
    });
  }

  // ===========================================================================
  // SYNAPSE MANAGEMENT
  // ===========================================================================

  /**
   * Add dendrite (input connection)
   */
  addDendrite(synapse: Synapse): void {
    this.dendrites.push(synapse);
  }

  /**
   * Add axon terminal (output connection)
   */
  addAxonTerminal(synapse: Synapse): void {
    this.axonTerminals.push(synapse);
  }

  /**
   * Apply Long-Term Potentiation (strengthen synapse)
   */
  applyLTP(synapseId: string, strength: number): void {
    const synapse =
      this.dendrites.find((s) => s.id === synapseId) ||
      this.axonTerminals.find((s) => s.id === synapseId);

    if (synapse) {
      synapse.longTermPotentiation += strength;
      synapse.weight = Math.min(1.0, synapse.weight + strength * 0.1);
      console.log(`📈 [${this.name}] LTP applied to synapse ${synapseId}`);
    }
  }

  /**
   * Apply Long-Term Depression (weaken synapse)
   */
  applyLTD(synapseId: string, strength: number): void {
    const synapse =
      this.dendrites.find((s) => s.id === synapseId) ||
      this.axonTerminals.find((s) => s.id === synapseId);

    if (synapse) {
      synapse.longTermDepression += strength;
      synapse.weight = Math.max(-1.0, synapse.weight - strength * 0.1);
      console.log(`📉 [${this.name}] LTD applied to synapse ${synapseId}`);
    }
  }

  // ===========================================================================
  // METRICS
  // ===========================================================================

  getMetrics(): NeuronMetrics {
    return { ...this.metrics };
  }

  resetMetrics(): void {
    this.metrics = {
      signalsReceived: 0,
      signalsSent: 0,
      errorsEncountered: 0,
      averageLatencyMs: 0,
      lastActivity: new Date(),
    };
  }

  // ===========================================================================
  // HELPER METHODS
  // ===========================================================================

  private getSignalType(
    neurotransmitter: NeurotransmitterType
  ): 'excitatory' | 'inhibitory' | 'modulatory' {
    switch (neurotransmitter) {
      case NeurotransmitterType.GABA:
        return 'inhibitory';
      case NeurotransmitterType.SEROTONIN:
      case NeurotransmitterType.ACETYLCHOLINE:
        return 'modulatory';
      default:
        return 'excitatory';
    }
  }

  protected calculateSignalStrength(_output: TOutput): number {
    // Default implementation - subclasses should override
    return 1.0;
  }

  private updateFiringRate(): void {
    // Simple exponential moving average of firing rate
    const now = Date.now();
    const timeSinceLastFire = this.state.lastFired
      ? now - this.state.lastFired.getTime()
      : 1000;

    const instantRate = 1000 / Math.max(timeSinceLastFire, 1); // Hz
    this.state.firingRate =
      this.state.firingRate * 0.9 + instantRate * 0.1;
  }

  // ===========================================================================
  // DEBUG HELPERS
  // ===========================================================================

  /**
   * Get neuron status for debugging
   */
  getStatus(): NeuronStatus {
    return {
      id: this.id,
      name: this.name,
      layer: this.layer,
      isInitialized: this.isInitialized,
      isShuttingDown: this.isShuttingDown,
      state: { ...this.state },
      metrics: this.getMetrics(),
      dendritesCount: this.dendrites.length,
      axonTerminalsCount: this.axonTerminals.length,
      myelinSheathsCount: this.myelinSheaths.size,
      signalBufferSize: this.signalBuffer.length,
    };
  }
}

// =============================================================================
// SUPPORTING TYPES
// =============================================================================

export interface NeuronOptions {
  id: string;
  bufferWindowMs: number;
}

export interface NeuronStatus {
  id: string;
  name: string;
  layer: NeuralLayer;
  isInitialized: boolean;
  isShuttingDown: boolean;
  state: NeuronState;
  metrics: NeuronMetrics;
  dendritesCount: number;
  axonTerminalsCount: number;
  myelinSheathsCount: number;
  signalBufferSize: number;
}
