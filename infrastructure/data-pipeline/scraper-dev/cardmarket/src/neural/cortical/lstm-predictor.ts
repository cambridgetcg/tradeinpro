/**
 * LSTM Predictor Neuron
 *
 * Cortical neuron that uses LSTM neural network for price prediction.
 * Processes 30-timestep × 45-feature sequences to predict deal types.
 *
 * Architecture:
 *   Input: [batch, 30, 45]
 *   LSTM Layer 1: 128 units, return_sequences=True
 *   Dropout: 0.2
 *   LSTM Layer 2: 64 units
 *   Dense: 32 units, ReLU
 *   Output Heads: deal_type, confidence, expected_return, risk_level
 */

import { BaseNeuron } from '../base-neuron';
import {
  NeuralLayer,
  NeuralSignal,
  NeurotransmitterType,
  FeatureVector,
  PredictionSignal,
  DealType,
  RiskLevel,
} from '../types';

// =============================================================================
// INTERFACES
// =============================================================================

export interface LSTMPredictorConfig {
  sequenceLength: number;
  featureCount: number;
  hiddenSize: number;
  dropoutRate: number;
  modelPath?: string;
  useMockModel: boolean;
}

export interface SequenceInput {
  cardId: string;
  name: string;
  sequence: FeatureVector[]; // Array of 30 timesteps
}

export interface LSTMOutput {
  dealTypeProbabilities: number[]; // [10 classes]
  confidence: number;
  expectedReturn: number;
  riskLevelProbabilities: number[]; // [3 classes]
}

// =============================================================================
// LSTM PREDICTOR NEURON
// =============================================================================

export class LSTMPredictorNeuron extends BaseNeuron<SequenceInput, PredictionSignal> {
  private config: LSTMPredictorConfig;
  private modelLoaded: boolean = false;

  // Weights would be loaded from trained model
  // For now, we use a mock/heuristic implementation
  private dealTypeLabels: DealType[] = [
    DealType.STRONG_BUY,
    DealType.BUY,
    DealType.HOLD,
    DealType.SELL,
    DealType.STRONG_SELL,
    DealType.ARBITRAGE,
    DealType.MOMENTUM,
    DealType.VALUE,
    DealType.RISK,
    DealType.NEUTRAL,
  ];

  private riskLabels: RiskLevel[] = [RiskLevel.LOW, RiskLevel.MEDIUM, RiskLevel.HIGH];

  // Statistics
  private stats: PredictorStats;

  constructor(config: Partial<LSTMPredictorConfig> = {}) {
    super('LSTMPredictor', NeuralLayer.CORTICAL);

    this.config = {
      sequenceLength: 30,
      featureCount: 45,
      hiddenSize: 128,
      dropoutRate: 0.2,
      useMockModel: true,
      ...config,
    };

    this.stats = {
      predictions: 0,
      strongSignals: 0,
      neutralSignals: 0,
      avgConfidence: 0,
      avgLatencyMs: 0,
    };
  }

  // ===========================================================================
  // LIFECYCLE
  // ===========================================================================

  protected async onInitialize(): Promise<void> {
    if (this.config.modelPath && !this.config.useMockModel) {
      await this.loadModel();
    } else {
      console.log(`   Using heuristic model (production model not loaded)`);
      this.modelLoaded = true;
    }

    console.log(`🧠 [${this.name}] LSTM predictor initialized`);
    console.log(`   Sequence length: ${this.config.sequenceLength}`);
    console.log(`   Feature count: ${this.config.featureCount}`);
    console.log(`   Hidden size: ${this.config.hiddenSize}`);
    console.log(`   Model loaded: ${this.modelLoaded}`);
  }

  protected async onShutdown(): Promise<void> {
    this.logStats();
  }

  // ===========================================================================
  // MODEL LOADING
  // ===========================================================================

  private async loadModel(): Promise<void> {
    try {
      // In production, load TensorFlow.js or ONNX model
      console.log(`   Loading model from ${this.config.modelPath}...`);

      // Placeholder for actual model loading
      // const tf = await import('@tensorflow/tfjs-node');
      // this.model = await tf.loadLayersModel(this.config.modelPath);

      this.modelLoaded = true;
      console.log(`   Model loaded successfully`);
    } catch (error) {
      console.warn(`   Failed to load model: ${error}`);
      console.log(`   Falling back to heuristic model`);
      this.modelLoaded = true;
    }
  }

  // ===========================================================================
  // SIGNAL PROCESSING
  // ===========================================================================

  async processSignal(signal: NeuralSignal<SequenceInput>): Promise<PredictionSignal> {
    const input = signal.payload;
    const startTime = Date.now();

    // Validate sequence length
    if (input.sequence.length < this.config.sequenceLength) {
      throw new Error(
        `Insufficient sequence length: ${input.sequence.length} < ${this.config.sequenceLength}`
      );
    }

    // Take last N timesteps
    const sequence = input.sequence.slice(-this.config.sequenceLength);

    // Run prediction
    const lstmOutput = this.predict(sequence);

    // Determine deal type and risk level
    const dealTypeIdx = this.argmax(lstmOutput.dealTypeProbabilities);
    const riskLevelIdx = this.argmax(lstmOutput.riskLevelProbabilities);

    const prediction: PredictionSignal = {
      cardId: input.cardId,
      dealType: this.dealTypeLabels[dealTypeIdx],
      confidence: lstmOutput.confidence,
      expectedReturn: lstmOutput.expectedReturn,
      riskLevel: this.riskLabels[riskLevelIdx],
      modelWeights: {
        lstm: 0.5, // This model's weight in ensemble
        xgboost: 0.3,
        isolationForest: 0.2,
      },
      topFactors: this.extractTopFactors(sequence),
      timestamp: new Date(),
    };

    // Update stats
    const latency = Date.now() - startTime;
    this.stats.predictions++;
    this.stats.avgLatencyMs =
      (this.stats.avgLatencyMs * (this.stats.predictions - 1) + latency) /
      this.stats.predictions;
    this.stats.avgConfidence =
      (this.stats.avgConfidence * (this.stats.predictions - 1) +
        lstmOutput.confidence) /
      this.stats.predictions;

    if (
      prediction.dealType === DealType.STRONG_BUY ||
      prediction.dealType === DealType.STRONG_SELL ||
      prediction.dealType === DealType.ARBITRAGE
    ) {
      this.stats.strongSignals++;
    } else if (
      prediction.dealType === DealType.HOLD ||
      prediction.dealType === DealType.NEUTRAL
    ) {
      this.stats.neutralSignals++;
    }

    console.log(
      `🔮 [${this.name}] ${input.cardId}: ${prediction.dealType} ` +
      `(conf: ${(prediction.confidence * 100).toFixed(1)}%, ` +
      `return: ${(prediction.expectedReturn * 100).toFixed(1)}%, ` +
      `risk: ${prediction.riskLevel})`
    );

    return prediction;
  }

  // ===========================================================================
  // PREDICTION (HEURISTIC/MOCK)
  // ===========================================================================

  private predict(sequence: FeatureVector[]): LSTMOutput {
    // Extract key features from the sequence
    const latest = sequence[sequence.length - 1];
    const oldest = sequence[0];

    // Temporal analysis
    const velocity = latest.temporal.velocity_7d;
    const volatility = latest.temporal.volatility_7d;
    const rsi = latest.temporal.rsiMomentum;
    const trendStrength = latest.temporal.trendStrength;

    // Market analysis
    const opportunityScore = latest.derived.opportunityScore;
    const riskScore = latest.derived.riskScore;

    // Calculate momentum over sequence
    const priceChange = this.calculateSequenceMomentum(sequence);

    // Heuristic-based probabilities
    const dealTypeProbabilities = this.calculateDealTypeProbabilities({
      velocity,
      volatility,
      rsi,
      trendStrength,
      opportunityScore,
      riskScore,
      priceChange,
    });

    // Confidence based on signal consistency
    const confidence = this.calculateConfidence({
      volatility,
      trendStrength,
      opportunityScore,
      riskScore,
    });

    // Expected return based on velocity and opportunity
    const expectedReturn = this.calculateExpectedReturn({
      velocity,
      opportunityScore,
      priceChange,
    });

    // Risk level probabilities
    const riskLevelProbabilities = this.calculateRiskProbabilities({
      volatility,
      riskScore,
    });

    return {
      dealTypeProbabilities,
      confidence,
      expectedReturn,
      riskLevelProbabilities,
    };
  }

  private calculateDealTypeProbabilities(features: {
    velocity: number;
    volatility: number;
    rsi: number;
    trendStrength: number;
    opportunityScore: number;
    riskScore: number;
    priceChange: number;
  }): number[] {
    // Initialize uniform distribution
    const probs = new Array(10).fill(0.1);

    // Adjust based on features
    // RSI oversold (< 30) suggests buying opportunity
    if (features.rsi < 30) {
      probs[0] += 0.2; // STRONG_BUY
      probs[1] += 0.1; // BUY
    }
    // RSI overbought (> 70) suggests selling
    else if (features.rsi > 70) {
      probs[3] += 0.1; // SELL
      probs[4] += 0.2; // STRONG_SELL
    }

    // High opportunity score
    if (features.opportunityScore > 0.7) {
      probs[0] += 0.15; // STRONG_BUY
      probs[5] += 0.1;  // ARBITRAGE
      probs[7] += 0.1;  // VALUE
    }

    // High risk score
    if (features.riskScore > 0.7) {
      probs[8] += 0.2; // RISK
      probs[4] += 0.1; // STRONG_SELL
    }

    // Strong positive momentum
    if (features.velocity > 0.05 && features.trendStrength > 0.5) {
      probs[6] += 0.2; // MOMENTUM
      probs[1] += 0.1; // BUY
    }

    // Strong negative momentum
    if (features.velocity < -0.05) {
      probs[3] += 0.1; // SELL
      probs[4] += 0.1; // STRONG_SELL
    }

    // High volatility reduces confidence in directional signals
    if (features.volatility > 0.1) {
      probs[2] += 0.1; // HOLD
      probs[9] += 0.1; // NEUTRAL
    }

    // Normalize to sum to 1
    const sum = probs.reduce((a, b) => a + b, 0);
    return probs.map((p) => p / sum);
  }

  private calculateConfidence(features: {
    volatility: number;
    trendStrength: number;
    opportunityScore: number;
    riskScore: number;
  }): number {
    let confidence = 0.5; // Base confidence

    // Strong trend increases confidence
    confidence += features.trendStrength * 0.2;

    // Clear opportunity or risk increases confidence
    confidence += Math.abs(features.opportunityScore - 0.5) * 0.2;
    confidence += Math.abs(features.riskScore - 0.5) * 0.1;

    // High volatility decreases confidence
    confidence -= features.volatility * 0.5;

    return Math.max(0.1, Math.min(0.95, confidence));
  }

  private calculateExpectedReturn(features: {
    velocity: number;
    opportunityScore: number;
    priceChange: number;
  }): number {
    // Project based on recent velocity and opportunity
    let expectedReturn = features.velocity * 5; // Project 5 periods

    // Adjust for opportunity
    expectedReturn += (features.opportunityScore - 0.5) * 0.1;

    // Bound between -50% and +100%
    return Math.max(-0.5, Math.min(1.0, expectedReturn));
  }

  private calculateRiskProbabilities(features: {
    volatility: number;
    riskScore: number;
  }): number[] {
    // [LOW, MEDIUM, HIGH]
    const probs = [0.33, 0.34, 0.33];

    if (features.riskScore > 0.7 || features.volatility > 0.15) {
      probs[2] += 0.3; // HIGH
      probs[0] -= 0.15;
      probs[1] -= 0.15;
    } else if (features.riskScore < 0.3 && features.volatility < 0.05) {
      probs[0] += 0.3; // LOW
      probs[1] -= 0.15;
      probs[2] -= 0.15;
    }

    // Normalize
    const sum = probs.reduce((a, b) => a + b, 0);
    return probs.map((p) => p / sum);
  }

  private calculateSequenceMomentum(sequence: FeatureVector[]): number {
    if (sequence.length < 2) return 0;

    // Compare last vs first derived opportunity scores as proxy for price change
    const first = sequence[0].derived.opportunityScore;
    const last = sequence[sequence.length - 1].derived.opportunityScore;

    return last - first;
  }

  // ===========================================================================
  // FACTOR EXTRACTION
  // ===========================================================================

  private extractTopFactors(sequence: FeatureVector[]): string[] {
    const latest = sequence[sequence.length - 1];
    const factors: { name: string; importance: number }[] = [];

    // Analyze which features are most influential
    if (Math.abs(latest.temporal.velocity_7d) > 0.03) {
      factors.push({
        name: `7-day velocity: ${(latest.temporal.velocity_7d * 100).toFixed(1)}%`,
        importance: Math.abs(latest.temporal.velocity_7d) * 10,
      });
    }

    if (latest.temporal.rsiMomentum < 30 || latest.temporal.rsiMomentum > 70) {
      factors.push({
        name: `RSI ${latest.temporal.rsiMomentum < 30 ? 'oversold' : 'overbought'}: ${latest.temporal.rsiMomentum.toFixed(0)}`,
        importance: Math.abs(latest.temporal.rsiMomentum - 50) / 20,
      });
    }

    if (latest.derived.opportunityScore > 0.6) {
      factors.push({
        name: `High opportunity: ${(latest.derived.opportunityScore * 100).toFixed(0)}%`,
        importance: latest.derived.opportunityScore,
      });
    }

    if (latest.derived.riskScore > 0.6) {
      factors.push({
        name: `Elevated risk: ${(latest.derived.riskScore * 100).toFixed(0)}%`,
        importance: latest.derived.riskScore,
      });
    }

    if (latest.temporal.volatility_7d > 0.1) {
      factors.push({
        name: `High volatility: ${(latest.temporal.volatility_7d * 100).toFixed(1)}%`,
        importance: latest.temporal.volatility_7d * 5,
      });
    }

    // Sort by importance and take top 3
    factors.sort((a, b) => b.importance - a.importance);
    return factors.slice(0, 3).map((f) => f.name);
  }

  // ===========================================================================
  // UTILITIES
  // ===========================================================================

  private argmax(arr: number[]): number {
    return arr.reduce(
      (maxIdx, val, idx, array) => (val > array[maxIdx] ? idx : maxIdx),
      0
    );
  }

  // ===========================================================================
  // NEUROTRANSMITTER SELECTION
  // ===========================================================================

  protected selectNeurotransmitter(output: PredictionSignal): NeurotransmitterType {
    // Strong buy/sell signals
    if (
      output.dealType === DealType.STRONG_BUY ||
      output.dealType === DealType.ARBITRAGE
    ) {
      return NeurotransmitterType.DOPAMINE; // Opportunity
    }

    if (
      output.dealType === DealType.STRONG_SELL ||
      output.dealType === DealType.RISK
    ) {
      return NeurotransmitterType.GABA; // Caution
    }

    // High confidence predictions
    if (output.confidence > 0.8) {
      return NeurotransmitterType.SEROTONIN; // Confidence
    }

    return NeurotransmitterType.GLUTAMATE;
  }

  protected calculateSignalStrength(output: PredictionSignal): number {
    return output.confidence;
  }

  // ===========================================================================
  // STATISTICS
  // ===========================================================================

  private logStats(): void {
    console.log(`\n📊 [${this.name}] Predictor Statistics:`);
    console.log(`   Predictions: ${this.stats.predictions}`);
    console.log(`   Strong signals: ${this.stats.strongSignals}`);
    console.log(`   Neutral signals: ${this.stats.neutralSignals}`);
    console.log(`   Avg confidence: ${(this.stats.avgConfidence * 100).toFixed(1)}%`);
    console.log(`   Avg latency: ${this.stats.avgLatencyMs.toFixed(0)}ms`);
  }

  getStats(): PredictorStats {
    return { ...this.stats };
  }
}

// =============================================================================
// SUPPORTING TYPES
// =============================================================================

interface PredictorStats {
  predictions: number;
  strongSignals: number;
  neutralSignals: number;
  avgConfidence: number;
  avgLatencyMs: number;
}
