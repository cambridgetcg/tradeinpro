/**
 * Ensemble Orchestrator Neuron
 *
 * Cortical neuron that combines predictions from multiple ML models.
 * Implements weighted voting with dynamic weight adjustment based on
 * historical accuracy (Long-Term Potentiation/Depression).
 *
 * Inputs:
 *   - LSTM Predictor output
 *   - XGBoost Demand output (future)
 *   - Isolation Forest anomaly scores (future)
 *
 * Output:
 *   - Final deal recommendation with combined confidence
 */

import { BaseNeuron } from '../base-neuron';
import {
  NeuralLayer,
  NeuralSignal,
  NeurotransmitterType,
  PredictionSignal,
  DealType,
  RiskLevel,
  Synapse,
} from '../types';
import { v4 as uuidv4 } from 'uuid';

// =============================================================================
// INTERFACES
// =============================================================================

export interface EnsembleConfig {
  minConfidenceThreshold: number;
  anomalyWeight: number;
  enableDynamicWeights: boolean;
  feedbackDecayRate: number;
}

export interface ModelPrediction {
  modelId: string;
  modelType: 'lstm' | 'xgboost' | 'isolation_forest' | 'rule_based';
  prediction: PredictionSignal;
  weight: number;
}

export interface EnsembleInput {
  cardId: string;
  name: string;
  predictions: ModelPrediction[];
  anomalyScore?: number; // From isolation forest
}

export interface EnsembleOutput extends PredictionSignal {
  ensembleMethod: 'weighted_vote' | 'majority_vote' | 'stacking';
  modelContributions: ModelContribution[];
  disagreementScore: number;
  finalWeight: number;
}

export interface ModelContribution {
  modelId: string;
  modelType: string;
  weight: number;
  contribution: number; // How much this model influenced final decision
  agreed: boolean; // Whether this model agreed with final decision
}

// =============================================================================
// ENSEMBLE ORCHESTRATOR NEURON
// =============================================================================

export class EnsembleOrchestratorNeuron extends BaseNeuron<
  EnsembleInput,
  EnsembleOutput
> {
  private config: EnsembleConfig;

  // Model weights (updated via LTP/LTD)
  private modelWeights: Map<string, number> = new Map();

  // Historical accuracy tracking
  private accuracyHistory: Map<string, AccuracyRecord[]> = new Map();

  // Statistics
  private stats: OrchestratorStats;

  constructor(config: Partial<EnsembleConfig> = {}) {
    super('EnsembleOrchestrator', NeuralLayer.CORTICAL);

    this.config = {
      minConfidenceThreshold: 0.3,
      anomalyWeight: 0.15,
      enableDynamicWeights: true,
      feedbackDecayRate: 0.95,
      ...config,
    };

    // Initialize default weights
    this.modelWeights.set('lstm', 0.5);
    this.modelWeights.set('xgboost', 0.3);
    this.modelWeights.set('isolation_forest', 0.15);
    this.modelWeights.set('rule_based', 0.05);

    this.stats = {
      decisions: 0,
      highConfidence: 0,
      lowConfidence: 0,
      unanimousDecisions: 0,
      splitDecisions: 0,
      avgDisagreement: 0,
    };
  }

  // ===========================================================================
  // LIFECYCLE
  // ===========================================================================

  protected async onInitialize(): Promise<void> {
    console.log(`🎯 [${this.name}] Ensemble orchestrator initialized`);
    console.log(`   Min confidence: ${this.config.minConfidenceThreshold}`);
    console.log(`   Anomaly weight: ${this.config.anomalyWeight}`);
    console.log(`   Dynamic weights: ${this.config.enableDynamicWeights}`);

    // Log initial weights
    console.log(`   Model weights:`);
    this.modelWeights.forEach((weight, model) => {
      console.log(`     - ${model}: ${(weight * 100).toFixed(0)}%`);
    });
  }

  protected async onShutdown(): Promise<void> {
    this.logStats();
  }

  // ===========================================================================
  // SYNAPSE CREATION
  // ===========================================================================

  /**
   * Create synapse connection to a model neuron
   */
  createModelSynapse(
    modelId: string,
    modelType: string,
    initialWeight: number = 0.5
  ): Synapse {
    const synapse: Synapse = {
      id: uuidv4(),
      presynapticNeuron: modelId,
      postsynapticNeuron: this.id,
      weight: initialWeight,
      type: 'excitatory',
      lastActivity: new Date(),
      longTermPotentiation: 0,
      longTermDepression: 0,
    };

    this.addDendrite(synapse);
    this.modelWeights.set(modelId, initialWeight);

    console.log(
      `🔗 [${this.name}] Synapse created: ${modelId} → ${this.id} (weight: ${initialWeight})`
    );

    return synapse;
  }

  // ===========================================================================
  // SIGNAL PROCESSING
  // ===========================================================================

  async processSignal(signal: NeuralSignal<EnsembleInput>): Promise<EnsembleOutput> {
    const input = signal.payload;
    const startTime = Date.now();

    if (input.predictions.length === 0) {
      throw new Error('No predictions to ensemble');
    }

    // Normalize weights
    const normalizedPredictions = this.normalizePredictionWeights(input.predictions);

    // Apply anomaly penalty if present
    if (input.anomalyScore !== undefined) {
      this.applyAnomalyPenalty(normalizedPredictions, input.anomalyScore);
    }

    // Weighted vote for deal type
    const { dealType, dealTypeConfidence } = this.weightedVoteDealType(
      normalizedPredictions
    );

    // Combine confidences
    const combinedConfidence = this.combineConfidences(
      normalizedPredictions,
      dealType
    );

    // Combine expected returns
    const expectedReturn = this.combineExpectedReturns(normalizedPredictions);

    // Determine risk level
    const riskLevel = this.combineRiskLevels(normalizedPredictions);

    // Calculate disagreement score
    const disagreementScore = this.calculateDisagreement(
      normalizedPredictions,
      dealType
    );

    // Build model contributions
    const modelContributions = this.buildContributions(
      normalizedPredictions,
      dealType
    );

    // Extract top factors from all models
    const topFactors = this.mergeTopFactors(normalizedPredictions);

    const output: EnsembleOutput = {
      cardId: input.cardId,
      dealType,
      confidence: Math.min(combinedConfidence, 1 - disagreementScore * 0.5),
      expectedReturn,
      riskLevel,
      modelWeights: {
        lstm: this.modelWeights.get('lstm') || 0.5,
        xgboost: this.modelWeights.get('xgboost') || 0.3,
        isolationForest: this.modelWeights.get('isolation_forest') || 0.15,
      },
      topFactors,
      timestamp: new Date(),
      ensembleMethod: 'weighted_vote',
      modelContributions,
      disagreementScore,
      finalWeight: normalizedPredictions.reduce((sum, p) => sum + p.weight, 0),
    };

    // Update statistics
    this.updateStats(output, normalizedPredictions);

    const latency = Date.now() - startTime;
    console.log(
      `🎯 [${this.name}] ${input.cardId}: ${output.dealType} ` +
      `(ensemble conf: ${(output.confidence * 100).toFixed(1)}%, ` +
      `disagreement: ${(disagreementScore * 100).toFixed(0)}%, ` +
      `${latency}ms)`
    );

    return output;
  }

  // ===========================================================================
  // WEIGHT NORMALIZATION
  // ===========================================================================

  private normalizePredictionWeights(
    predictions: ModelPrediction[]
  ): ModelPrediction[] {
    // Apply stored model weights
    const weighted = predictions.map((p) => ({
      ...p,
      weight: (this.modelWeights.get(p.modelId) || 0.5) * p.weight,
    }));

    // Normalize to sum to 1
    const totalWeight = weighted.reduce((sum, p) => sum + p.weight, 0);
    if (totalWeight === 0) return weighted;

    return weighted.map((p) => ({
      ...p,
      weight: p.weight / totalWeight,
    }));
  }

  private applyAnomalyPenalty(
    predictions: ModelPrediction[],
    anomalyScore: number
  ): void {
    // If anomaly score is high (close to 1), reduce all confidences
    if (anomalyScore > 0.5) {
      const penalty = (anomalyScore - 0.5) * 2 * this.config.anomalyWeight;
      predictions.forEach((p) => {
        p.prediction.confidence *= 1 - penalty;
      });
    }
  }

  // ===========================================================================
  // VOTING MECHANISMS
  // ===========================================================================

  private weightedVoteDealType(predictions: ModelPrediction[]): {
    dealType: DealType;
    dealTypeConfidence: number;
  } {
    // Aggregate votes by deal type
    const votes = new Map<DealType, number>();

    for (const pred of predictions) {
      const current = votes.get(pred.prediction.dealType) || 0;
      votes.set(
        pred.prediction.dealType,
        current + pred.weight * pred.prediction.confidence
      );
    }

    // Find winner
    let maxVotes = 0;
    let winner = DealType.NEUTRAL;

    votes.forEach((voteCount, dealType) => {
      if (voteCount > maxVotes) {
        maxVotes = voteCount;
        winner = dealType;
      }
    });

    // Calculate vote confidence (how decisive the win was)
    const totalVotes = Array.from(votes.values()).reduce((a, b) => a + b, 0);
    const dealTypeConfidence = totalVotes > 0 ? maxVotes / totalVotes : 0;

    return { dealType: winner, dealTypeConfidence };
  }

  private combineConfidences(
    predictions: ModelPrediction[],
    finalDealType: DealType
  ): number {
    // Weight confidences by model weight, boost if agreed with final decision
    let weightedSum = 0;
    let weightSum = 0;

    for (const pred of predictions) {
      const agreed = pred.prediction.dealType === finalDealType;
      const effectiveWeight = pred.weight * (agreed ? 1.2 : 0.8);

      weightedSum += pred.prediction.confidence * effectiveWeight;
      weightSum += effectiveWeight;
    }

    return weightSum > 0 ? weightedSum / weightSum : 0.5;
  }

  private combineExpectedReturns(predictions: ModelPrediction[]): number {
    let weightedSum = 0;
    let weightSum = 0;

    for (const pred of predictions) {
      weightedSum += pred.prediction.expectedReturn * pred.weight;
      weightSum += pred.weight;
    }

    return weightSum > 0 ? weightedSum / weightSum : 0;
  }

  private combineRiskLevels(predictions: ModelPrediction[]): RiskLevel {
    // Vote on risk level
    const votes = { LOW: 0, MEDIUM: 0, HIGH: 0 };

    for (const pred of predictions) {
      votes[pred.prediction.riskLevel] += pred.weight;
    }

    // Find winner
    if (votes.HIGH >= votes.MEDIUM && votes.HIGH >= votes.LOW) {
      return RiskLevel.HIGH;
    }
    if (votes.LOW >= votes.MEDIUM && votes.LOW >= votes.HIGH) {
      return RiskLevel.LOW;
    }
    return RiskLevel.MEDIUM;
  }

  // ===========================================================================
  // DISAGREEMENT ANALYSIS
  // ===========================================================================

  private calculateDisagreement(
    predictions: ModelPrediction[],
    finalDealType: DealType
  ): number {
    if (predictions.length <= 1) return 0;

    // Count models that disagreed with final decision
    let disagreedWeight = 0;
    let totalWeight = 0;

    for (const pred of predictions) {
      totalWeight += pred.weight;
      if (pred.prediction.dealType !== finalDealType) {
        disagreedWeight += pred.weight;
      }
    }

    return totalWeight > 0 ? disagreedWeight / totalWeight : 0;
  }

  private buildContributions(
    predictions: ModelPrediction[],
    finalDealType: DealType
  ): ModelContribution[] {
    return predictions.map((pred) => {
      const agreed = pred.prediction.dealType === finalDealType;

      return {
        modelId: pred.modelId,
        modelType: pred.modelType,
        weight: pred.weight,
        contribution: pred.weight * pred.prediction.confidence,
        agreed,
      };
    });
  }

  // ===========================================================================
  // FACTOR MERGING
  // ===========================================================================

  private mergeTopFactors(predictions: ModelPrediction[]): string[] {
    // Collect all factors with their weights
    const factorScores = new Map<string, number>();

    for (const pred of predictions) {
      const factors = pred.prediction.topFactors || [];
      factors.forEach((factor, index) => {
        // Weight by position (first = highest) and model weight
        const positionWeight = 1 - index * 0.2;
        const score = pred.weight * positionWeight;

        const current = factorScores.get(factor) || 0;
        factorScores.set(factor, current + score);
      });
    }

    // Sort by score and take top 5
    return Array.from(factorScores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([factor]) => factor);
  }

  // ===========================================================================
  // FEEDBACK / PLASTICITY
  // ===========================================================================

  /**
   * Apply feedback to update model weights (LTP/LTD)
   */
  applyFeedback(
    modelId: string,
    wasCorrect: boolean,
    magnitude: number = 0.1
  ): void {
    if (!this.config.enableDynamicWeights) return;

    const currentWeight = this.modelWeights.get(modelId) || 0.5;

    if (wasCorrect) {
      // Long-Term Potentiation - strengthen connection
      const newWeight = Math.min(1.0, currentWeight + magnitude);
      this.modelWeights.set(modelId, newWeight);

      // Update synapse
      const synapse = this.dendrites.find(
        (s) => s.presynapticNeuron === modelId
      );
      if (synapse) {
        this.applyLTP(synapse.id, magnitude);
      }

      console.log(
        `📈 [${this.name}] LTP: ${modelId} weight ${currentWeight.toFixed(2)} → ${newWeight.toFixed(2)}`
      );
    } else {
      // Long-Term Depression - weaken connection
      const newWeight = Math.max(0.1, currentWeight - magnitude);
      this.modelWeights.set(modelId, newWeight);

      // Update synapse
      const synapse = this.dendrites.find(
        (s) => s.presynapticNeuron === modelId
      );
      if (synapse) {
        this.applyLTD(synapse.id, magnitude);
      }

      console.log(
        `📉 [${this.name}] LTD: ${modelId} weight ${currentWeight.toFixed(2)} → ${newWeight.toFixed(2)}`
      );
    }

    // Track accuracy history
    const history = this.accuracyHistory.get(modelId) || [];
    history.push({
      timestamp: new Date(),
      wasCorrect,
      magnitude,
    });

    // Keep last 100 records
    if (history.length > 100) {
      history.shift();
    }
    this.accuracyHistory.set(modelId, history);
  }

  /**
   * Get model accuracy over recent history
   */
  getModelAccuracy(modelId: string): number {
    const history = this.accuracyHistory.get(modelId);
    if (!history || history.length === 0) return 0.5;

    const correct = history.filter((r) => r.wasCorrect).length;
    return correct / history.length;
  }

  // ===========================================================================
  // NEUROTRANSMITTER SELECTION
  // ===========================================================================

  protected selectNeurotransmitter(output: EnsembleOutput): NeurotransmitterType {
    // High agreement + high confidence = strong signal
    if (output.disagreementScore < 0.2 && output.confidence > 0.8) {
      if (
        output.dealType === DealType.STRONG_BUY ||
        output.dealType === DealType.ARBITRAGE
      ) {
        return NeurotransmitterType.DOPAMINE;
      }
      if (
        output.dealType === DealType.STRONG_SELL ||
        output.dealType === DealType.RISK
      ) {
        return NeurotransmitterType.GABA;
      }
      return NeurotransmitterType.SEROTONIN;
    }

    // High disagreement = attention needed
    if (output.disagreementScore > 0.5) {
      return NeurotransmitterType.NOREPINEPHRINE;
    }

    return NeurotransmitterType.GLUTAMATE;
  }

  protected calculateSignalStrength(output: EnsembleOutput): number {
    // Strength based on confidence and agreement
    return output.confidence * (1 - output.disagreementScore * 0.5);
  }

  // ===========================================================================
  // STATISTICS
  // ===========================================================================

  private updateStats(
    output: EnsembleOutput,
    predictions: ModelPrediction[]
  ): void {
    this.stats.decisions++;

    if (output.confidence >= 0.7) {
      this.stats.highConfidence++;
    } else if (output.confidence < 0.4) {
      this.stats.lowConfidence++;
    }

    if (output.disagreementScore === 0) {
      this.stats.unanimousDecisions++;
    } else if (output.disagreementScore > 0.3) {
      this.stats.splitDecisions++;
    }

    this.stats.avgDisagreement =
      (this.stats.avgDisagreement * (this.stats.decisions - 1) +
        output.disagreementScore) /
      this.stats.decisions;
  }

  private logStats(): void {
    console.log(`\n📊 [${this.name}] Orchestrator Statistics:`);
    console.log(`   Total decisions: ${this.stats.decisions}`);
    console.log(`   High confidence: ${this.stats.highConfidence}`);
    console.log(`   Low confidence: ${this.stats.lowConfidence}`);
    console.log(`   Unanimous: ${this.stats.unanimousDecisions}`);
    console.log(`   Split decisions: ${this.stats.splitDecisions}`);
    console.log(
      `   Avg disagreement: ${(this.stats.avgDisagreement * 100).toFixed(1)}%`
    );

    console.log(`   Model weights:`);
    this.modelWeights.forEach((weight, model) => {
      const accuracy = this.getModelAccuracy(model);
      console.log(
        `     - ${model}: ${(weight * 100).toFixed(0)}% (accuracy: ${(
          accuracy * 100
        ).toFixed(0)}%)`
      );
    });
  }

  getStats(): OrchestratorStats {
    return { ...this.stats };
  }

  getModelWeights(): Map<string, number> {
    return new Map(this.modelWeights);
  }
}

// =============================================================================
// SUPPORTING TYPES
// =============================================================================

interface AccuracyRecord {
  timestamp: Date;
  wasCorrect: boolean;
  magnitude: number;
}

interface OrchestratorStats {
  decisions: number;
  highConfidence: number;
  lowConfidence: number;
  unanimousDecisions: number;
  splitDecisions: number;
  avgDisagreement: number;
}
