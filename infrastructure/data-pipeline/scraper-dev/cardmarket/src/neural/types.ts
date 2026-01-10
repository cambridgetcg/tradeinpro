/**
 * Neural Network Type Definitions
 *
 * Core types for the biological neural network metaphor applied to TCG data pipeline.
 * Each component models neurons, synapses, neurotransmitters, and ion channels.
 */

// =============================================================================
// NEUROTRANSMITTER TYPES
// =============================================================================

export enum NeurotransmitterType {
  /** Reward/Opportunity signal - triggers opportunity detection pathway */
  DOPAMINE = 'DOPAMINE',

  /** Confidence/Stability signal - increases weight in ensemble voting */
  SEROTONIN = 'SEROTONIN',

  /** Memory/Learning signal - updates model weights */
  ACETYLCHOLINE = 'ACETYLCHOLINE',

  /** Inhibition/Risk signal - suppresses deal recommendations */
  GABA = 'GABA',

  /** Excitation/Momentum signal - increases time sensitivity */
  GLUTAMATE = 'GLUTAMATE',

  /** Alert/Attention signal - triggers alert dispatcher */
  NOREPINEPHRINE = 'NOREPINEPHRINE',
}

export interface Neurotransmitter {
  type: NeurotransmitterType;
  concentration: number; // 0.0 to 1.0
  timestamp: Date;
  source: string;
  payload?: Record<string, unknown>;
}

// =============================================================================
// ION CHANNEL TYPES
// =============================================================================

export enum IonChannelType {
  /** Sodium - Inbound data (depolarization) */
  SODIUM = 'Na+',

  /** Potassium - Outbound predictions (repolarization) */
  POTASSIUM = 'K+',

  /** Calcium - Synaptic plasticity (learning) */
  CALCIUM = 'Ca2+',

  /** Chloride - Inhibition (suppression) */
  CHLORIDE = 'Cl-',
}

export interface IonChannel {
  type: IonChannelType;
  isOpen: boolean;
  conductance: number; // 0.0 to 1.0
  gatedBy: 'voltage' | 'ligand' | 'mechanical';
}

// =============================================================================
// SIGNAL TYPES
// =============================================================================

export interface NeuralSignal<T = unknown> {
  id: string;
  sourceNeuron: string;
  targetNeuron?: string;
  timestamp: Date;
  signalType: 'excitatory' | 'inhibitory' | 'modulatory';
  strength: number; // -1.0 to 1.0
  payload: T;
  neurotransmitter: NeurotransmitterType;
}

// =============================================================================
// SYNAPSE TYPES
// =============================================================================

export interface Synapse {
  id: string;
  presynapticNeuron: string;
  postsynapticNeuron: string;
  weight: number; // -1.0 to 1.0 (negative = inhibitory)
  type: 'excitatory' | 'inhibitory' | 'modulatory';
  lastActivity: Date;

  // Plasticity
  longTermPotentiation: number; // LTP strength
  longTermDepression: number;   // LTD strength
}

// =============================================================================
// MYELIN SHEATH (OPTIMIZATION)
// =============================================================================

export interface MyelinSheath {
  id: string;
  name: string;
  location: string; // e.g., "CardMarket Receptor → Validation Filter"
  effect: string;
  speedupFactor: number; // e.g., 1.3 = 30% faster
  source: string; // Documentation source

  // Cache implementation
  cache?: Map<string, CacheEntry>;
  ttlMs?: number;
}

export interface CacheEntry {
  value: unknown;
  timestamp: Date;
  hits: number;
}

// =============================================================================
// BASE NEURON INTERFACE
// =============================================================================

export interface NeuronState {
  membranePotential: number; // -70mV at rest, +40mV at peak
  isRefractory: boolean;
  refractoryEndTime?: Date;
  lastFired: Date | null;
  firingRate: number; // Hz (firings per second)
}

export interface NeuronMetrics {
  signalsReceived: number;
  signalsSent: number;
  errorsEncountered: number;
  averageLatencyMs: number;
  lastActivity: Date;
}

export interface INeuron<TInput = unknown, TOutput = unknown> {
  id: string;
  name: string;
  layer: NeuralLayer;
  state: NeuronState;
  metrics: NeuronMetrics;

  // Connections
  dendrites: Synapse[]; // Input connections
  axonTerminals: Synapse[]; // Output connections

  // Processing
  receiveDendrite(signal: NeuralSignal<TInput>): Promise<void>;
  processSignal(signal: NeuralSignal<TInput>): Promise<TOutput>;
  fireAxon(output: TOutput, neurotransmitter: NeurotransmitterType): Promise<NeuralSignal<TOutput>>;

  // Lifecycle
  initialize(): Promise<void>;
  shutdown(): Promise<void>;

  // Metrics
  getMetrics(): NeuronMetrics;
  resetMetrics(): void;
}

// =============================================================================
// NEURAL LAYERS
// =============================================================================

export enum NeuralLayer {
  SENSORY = 'SENSORY',
  INTERNEURON = 'INTERNEURON',
  ASSOCIATION = 'ASSOCIATION',
  CORTICAL = 'CORTICAL',
  MOTOR = 'MOTOR',
}

// =============================================================================
// PRICE DATA SIGNALS
// =============================================================================

export interface RawPriceSignal {
  cardId: string;
  name: string;
  source: 'cardmarket' | 'tcgplayer' | 'ebay' | 'japan';
  currency: 'EUR' | 'USD' | 'GBP' | 'JPY';

  // Price points
  priceFrom: number | null;
  priceTrend: number | null;
  priceAvg: number | null;

  // Metadata
  variantType: string;
  language: string;
  availableItems: number;
  scraped_at: Date;
}

export interface NormalizedPriceSignal {
  cardId: string;
  name: string;

  // All prices normalized to USD (standard for ML training)
  priceFromUsd: number;
  priceTrendUsd: number;
  priceAvgUsd: number;

  // Trade-in pricing (in USD)
  bestPriceUsd: number;
  tradeinPriceUsd: number; // bestPrice × 0.70

  // Original source prices (retained for reference)
  source: {
    marketplace: 'cardmarket' | 'tcgplayer' | 'ebay' | 'japan';
    currency: 'EUR' | 'USD' | 'GBP' | 'JPY';
    priceFrom: number | null;
    priceTrend: number | null;
    priceAvg: number | null;
  };

  // Spread analysis (in USD)
  spreadPercent: number;
  spreadAbsolute: number;

  // FX data
  fxRate: number; // Rate used: source currency → USD
  fxSource: string;

  timestamp: Date;
}

// =============================================================================
// EBAY SOLD LISTING SIGNALS
// =============================================================================

export interface EbaySoldListing {
  title: string;
  price: number;
  currency: 'USD' | 'GBP' | 'EUR' | 'AUD' | 'CAD';
  soldDate: Date;
  condition: string;
  seller: string;
  listingType: 'auction' | 'buy_it_now' | 'best_offer';
  shippingPrice: number | null;
  imageUrl: string | null;
  itemUrl: string;
  itemId: string;
}

export interface EbaySearchResult {
  cardId: string;
  query: string;
  listings: EbaySoldListing[];
  totalResults: number;
  searchTimestamp: Date;

  // Aggregated statistics
  stats: {
    avgPrice: number;
    medianPrice: number;
    minPrice: number;
    maxPrice: number;
    stdDev: number;
    sampleSize: number;
    priceRange: { low: number; high: number };
  };
}

// =============================================================================
// FEATURE SIGNALS
// =============================================================================

export interface TemporalFeatures {
  velocity_1d: number;
  velocity_7d: number;
  velocity_30d: number;
  acceleration_7d: number;
  volatility_7d: number;
  volatility_30d: number;
  trendStrength: number;
  trendDirection: 1 | 0 | -1;
  daysSinceHigh: number;
  daysSinceLow: number;
  streakLength: number;
  rsiMomentum: number;
  macd: number;
  macdSignal: number;
  macdHistogram: number;
}

export interface MarketFeatures {
  setMomentum: number;
  rarityMomentum: number;
  gameSentiment: number;
  correlationToSet: number;
  correlationToRarity: number;
  correlationDeviation: number;
  liquidityScore: number;
  volumeRelative: number;
  inventorySignal: number;
  marketCapRank: number;
}

export interface FXFeatures {
  eurGbpCurrent: number;
  jpyGbpCurrent: number;
  fxVelocity7d: number;
  fxVolatility7d: number;
  fxTrendDirection: 1 | 0 | -1;
}

export interface DerivedFeatures {
  opportunityScore: number;
  riskScore: number;
  timeSensitivity: number;
}

export interface FeatureVector {
  temporal: TemporalFeatures;
  market: MarketFeatures;
  fx: FXFeatures;
  derived: DerivedFeatures;

  // Flattened for ML
  toArray(): number[];
}

// =============================================================================
// PREDICTION SIGNALS
// =============================================================================

export enum DealType {
  STRONG_BUY = 'STRONG_BUY',
  BUY = 'BUY',
  HOLD = 'HOLD',
  SELL = 'SELL',
  STRONG_SELL = 'STRONG_SELL',
  ARBITRAGE = 'ARBITRAGE',
  MOMENTUM = 'MOMENTUM',
  VALUE = 'VALUE',
  RISK = 'RISK',
  NEUTRAL = 'NEUTRAL',
}

export enum RiskLevel {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
}

export interface PredictionSignal {
  cardId: string;
  dealType: DealType;
  confidence: number; // 0.0 to 1.0
  expectedReturn: number; // percentage
  riskLevel: RiskLevel;

  // Model contributions
  modelWeights: {
    lstm: number;
    xgboost: number;
    isolationForest: number;
  };

  // Explanation
  topFactors: string[];
  timestamp: Date;
}

// =============================================================================
// CLUSTER INTERFACES
// =============================================================================

export interface NeuronCluster<T extends INeuron = INeuron> {
  id: string;
  name: string;
  layer: NeuralLayer;
  neurons: Map<string, T>;

  // Cluster operations
  processCluster(inputs: NeuralSignal[]): Promise<NeuralSignal[]>;
  getClusterMetrics(): ClusterMetrics;
}

export interface ClusterMetrics {
  totalNeurons: number;
  activeNeurons: number;
  totalSignals: number;
  averageLatencyMs: number;
  errorRate: number;
}

// =============================================================================
// NEURAL NETWORK INTERFACE
// =============================================================================

export interface NeuralNetwork {
  clusters: Map<string, NeuronCluster>;
  synapses: Map<string, Synapse>;
  myelinSheaths: Map<string, MyelinSheath>;

  // Signal propagation
  propagateSignal(signal: NeuralSignal): Promise<NeuralSignal[]>;

  // Learning
  applyLTP(synapseId: string, strength: number): void;
  applyLTD(synapseId: string, strength: number): void;

  // Lifecycle
  initialize(): Promise<void>;
  shutdown(): Promise<void>;

  // Metrics
  getNetworkMetrics(): NetworkMetrics;
}

export interface NetworkMetrics {
  totalClusters: number;
  totalNeurons: number;
  totalSynapses: number;
  signalsPerSecond: number;
  averageLatencyMs: number;
  errorRate: number;
  uptime: number;
}
