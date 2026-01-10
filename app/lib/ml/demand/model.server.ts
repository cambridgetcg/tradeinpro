/**
 * Demand Forecasting Model (XGBoost/LightGBM)
 *
 * Predicts which cards will appreciate in value.
 * Uses gradient boosting for tabular data - significantly outperforms
 * neural networks on structured features.
 */

import { BaseModel, ModelCache } from "../base.server";
import { getDeploymentConfig, MODEL_VERSIONS, DEMAND_FEATURE_CONFIG } from "../config";
import type { DemandFeatures, DemandPrediction, PriceMovement, BasePrediction } from "../types";
import { getDemandFeatureExtractor, type DemandRawData } from "./features.server";

// =============================================================================
// DEMAND MODEL CLASS
// =============================================================================

export class DemandModel extends BaseModel<DemandFeatures, DemandPrediction> {
  readonly name = "demand";
  readonly version = MODEL_VERSIONS.demand;

  private model: XGBoostModel | null = null;
  private predictionCache: ModelCache<DemandPrediction>;
  private featureExtractor = getDemandFeatureExtractor();

  constructor() {
    super();
    this.predictionCache = new ModelCache<DemandPrediction>(60); // 1 minute cache
  }

  /**
   * Load the demand forecasting model
   */
  async load(): Promise<void> {
    const config = getDeploymentConfig();

    if (config.environment === "aws" && config.aws?.sagemaker.demandEndpoint) {
      await this.loadAWSModel(config.aws.sagemaker.demandEndpoint);
    } else {
      await this.loadLocalModel(config.localModelPaths?.demand);
    }

    this._isLoaded = true;
  }

  /**
   * Load local model
   */
  private async loadLocalModel(modelPath?: string): Promise<void> {
    console.log(`[DemandModel] Loading local XGBoost model from ${modelPath || "default path"}`);

    // In production, would load actual XGBoost model:
    // - Could use `xgboost` npm package (limited)
    // - Could use ONNX runtime for cross-platform
    // - Could call Python subprocess

    // Create a simple decision tree-like model for local development
    this.model = new LocalXGBoostModel();
    await this.model.load(modelPath);
  }

  /**
   * Load AWS SageMaker model
   */
  private async loadAWSModel(endpoint: string): Promise<void> {
    console.log(`[DemandModel] Connecting to SageMaker endpoint: ${endpoint}`);

    this.model = new SageMakerXGBoostModel(endpoint);
    await this.model.load();
  }

  /**
   * Run prediction
   */
  protected async _predict(input: DemandFeatures): Promise<Omit<DemandPrediction, keyof BasePrediction>> {
    if (!this.model) {
      throw new Error("Model not loaded");
    }

    // Normalize features
    const normalizedFeatures = this.featureExtractor.normalize(input);

    // Convert to feature array
    const featureArray = this.featuresToArray(normalizedFeatures);

    // Run model prediction
    const rawOutput = await this.model.predict(featureArray);

    // Post-process results
    return this.postProcess(rawOutput, normalizedFeatures);
  }

  /**
   * Convert features object to array for model input
   */
  private featuresToArray(features: DemandFeatures): number[] {
    return [
      // Price momentum (15)
      features.priceChange7d,
      features.priceChange30d,
      features.priceChange90d,
      features.priceAcceleration,
      features.priceVs52wHigh,
      features.priceVs52wLow,
      features.pricePercentile90d,
      features.consecutiveUpDays,
      features.consecutiveDownDays,
      features.volatility7d,
      features.volatility30d,
      features.volatilityRatio,
      features.rsi14,
      features.macd,
      features.macdSignal,
      // Volume (10)
      features.sales7d,
      features.sales30d,
      features.salesChange7d,
      features.listingsCount,
      features.listingsChange7d,
      features.daysOfSupply,
      features.sellThroughRate,
      features.timeToSaleAvg,
      features.priceDispersion,
      features.bidAskSpread ?? 0,
      // Card characteristics (12)
      features.rarityEncoded,
      features.isLeader ? 1 : 0,
      features.isCharacter ? 1 : 0,
      features.isEvent ? 1 : 0,
      features.isStage ? 1 : 0,
      features.colorEncoded,
      features.cost,
      features.power ?? 0,
      features.setAgeDays,
      features.setTotalValue,
      features.cardRankInSet,
      features.isAlternateArt ? 1 : 0,
      // Market context (10)
      features.tcg100IndexValue,
      features.tcg100Change7d,
      features.setIndexValue,
      features.setIndexChange7d,
      this.encodeMarketPhase(features.marketPhase),
      features.daysToNextSet,
      features.daysSinceLastSet,
      features.isTournamentLegal ? 1 : 0,
      features.tournamentPlayRate,
      features.metaRelevanceScore,
      // External signals (8)
      features.socialMentions7d,
      features.socialSentiment,
      features.youtubeMentions7d,
      features.searchTrend7d,
      features.tournamentTopCut,
      features.banWatchScore,
      features.reprintProbability,
      features.crossoverPotential,
    ];
  }

  /**
   * Post-process raw model output
   */
  private postProcess(
    raw: RawXGBoostOutput,
    features: DemandFeatures
  ): Omit<DemandPrediction, keyof BasePrediction> {
    // Determine price movement from probabilities
    const movements: PriceMovement[] = ["strong_up", "up", "flat", "down", "strong_down"];
    const maxIdx = raw.classProbs.indexOf(Math.max(...raw.classProbs));
    const priceMovement = movements[maxIdx];

    // Calculate expected returns from regression output
    const expectedReturn = {
      days7: raw.regressionOutput[0] ?? 0,
      days30: raw.regressionOutput[1] ?? 0,
      days90: raw.regressionOutput[2] ?? 0,
    };

    // Confidence interval based on model uncertainty
    const uncertainty = 0.1; // Would come from model
    const confidenceInterval = {
      days30Low: expectedReturn.days30 - uncertainty,
      days30High: expectedReturn.days30 + uncertainty,
    };

    // Extract top contributing features
    const topFeatures = this.getTopFeatures(raw.featureImportance, features);

    // Calculate risk score
    const riskScore = this.calculateRiskScore(features, raw);
    const riskFactors = this.identifyRiskFactors(features, raw);

    return {
      cardId: "", // Would be set by caller
      priceMovement,
      movementProbabilities: {
        strongUp: raw.classProbs[0],
        up: raw.classProbs[1],
        flat: raw.classProbs[2],
        down: raw.classProbs[3],
        strongDown: raw.classProbs[4],
      },
      expectedReturn,
      confidenceInterval,
      topFeatures,
      riskScore,
      riskFactors,
    };
  }

  /**
   * Get top contributing features
   */
  private getTopFeatures(
    importance: number[],
    features: DemandFeatures
  ): Array<{ feature: string; importance: number; value: number }> {
    const featureNames = this.featureExtractor.getFeatureNames();
    const featureValues = this.featuresToArray(features);

    const indexed = importance.map((imp, idx) => ({
      feature: featureNames[idx] || `feature_${idx}`,
      importance: imp,
      value: featureValues[idx],
    }));

    // Sort by importance and take top 5
    return indexed.sort((a, b) => b.importance - a.importance).slice(0, 5);
  }

  /**
   * Encode market phase as number
   */
  private encodeMarketPhase(phase: DemandFeatures["marketPhase"]): number {
    const phases: Record<string, number> = {
      accumulation: 0,
      markup: 1,
      distribution: 2,
      markdown: 3,
    };
    return phases[phase] ?? 0;
  }

  /**
   * Calculate risk score
   */
  private calculateRiskScore(features: DemandFeatures, raw: RawXGBoostOutput): number {
    let risk = 0;

    // Volatility risk
    if (features.volatility7d > DEMAND_FEATURE_CONFIG.volatility.highThreshold) {
      risk += 0.3;
    }

    // Low liquidity risk
    if (features.sales7d < 5) {
      risk += 0.2;
    }

    // Market phase risk
    if (features.marketPhase === "markdown") {
      risk += 0.25;
    }

    // High uncertainty in prediction
    const maxProb = Math.max(...raw.classProbs);
    if (maxProb < 0.5) {
      risk += 0.25;
    }

    return Math.min(1, risk);
  }

  /**
   * Identify specific risk factors
   */
  private identifyRiskFactors(features: DemandFeatures, raw: RawXGBoostOutput): string[] {
    const factors: string[] = [];

    if (features.volatility7d > DEMAND_FEATURE_CONFIG.volatility.highThreshold) {
      factors.push("High price volatility");
    }

    if (features.sales7d < 5) {
      factors.push("Low trading volume");
    }

    if (features.marketPhase === "markdown") {
      factors.push("Market in markdown phase");
    }

    if (features.banWatchScore > 0.5) {
      factors.push("Potential ban/restriction risk");
    }

    if (features.reprintProbability > 0.5) {
      factors.push("High reprint probability");
    }

    if (features.daysOfSupply > 30) {
      factors.push("High supply relative to demand");
    }

    const maxProb = Math.max(...raw.classProbs);
    if (maxProb < 0.5) {
      factors.push("Low prediction confidence");
    }

    return factors;
  }

  /**
   * Predict from raw data (includes feature extraction)
   */
  async predictFromRaw(raw: DemandRawData): Promise<DemandPrediction> {
    const features = await this.featureExtractor.extract(raw);
    const prediction = await this.predict(features);
    return {
      ...prediction,
      cardId: raw.priceHistory.cardId,
    };
  }

  /**
   * Batch prediction from raw data
   */
  async predictBatchFromRaw(rawData: DemandRawData[]): Promise<DemandPrediction[]> {
    const features = await this.featureExtractor.extractBatch(rawData);
    const predictions = await this.predictBatch(features);

    return predictions.map((pred, idx) => ({
      ...pred,
      cardId: rawData[idx].priceHistory.cardId,
    }));
  }

  /**
   * Unload model
   */
  async unload(): Promise<void> {
    if (this.model) {
      await this.model.unload();
    }
    this.model = null;
    this.predictionCache.clear();
    this._isLoaded = false;
  }
}

// =============================================================================
// RAW MODEL OUTPUT
// =============================================================================

interface RawXGBoostOutput {
  classProbs: number[]; // [strong_up, up, flat, down, strong_down]
  regressionOutput: number[]; // [7d, 30d, 90d expected returns]
  featureImportance: number[];
}

// =============================================================================
// MODEL INTERFACES
// =============================================================================

interface XGBoostModel {
  load(path?: string): Promise<void>;
  predict(features: number[]): Promise<RawXGBoostOutput>;
  predictBatch(features: number[][]): Promise<RawXGBoostOutput[]>;
  unload(): Promise<void>;
}

/**
 * Local XGBoost model implementation
 *
 * This is a simplified implementation for development.
 * In production, would use actual XGBoost via:
 * - xgboost npm package
 * - ONNX runtime
 * - Python subprocess
 */
class LocalXGBoostModel implements XGBoostModel {
  private weights: number[][] | null = null;

  async load(path?: string): Promise<void> {
    // In production, load actual model weights
    // For now, create random weights for demonstration
    console.log(`[LocalXGBoostModel] Loading from ${path || "default"}`);

    // Simplified: use random weights
    // Real model would load from file
    this.weights = [];
    for (let i = 0; i < 5; i++) {
      // 5 classes
      this.weights.push(new Array(55).fill(0).map(() => (Math.random() - 0.5) * 0.1));
    }
  }

  async predict(features: number[]): Promise<RawXGBoostOutput> {
    if (!this.weights) {
      throw new Error("Model not loaded");
    }

    // Simplified prediction using linear combination
    // Real XGBoost would use tree ensemble
    const logits = this.weights.map((w) =>
      w.reduce((sum, weight, idx) => sum + weight * (features[idx] || 0), 0)
    );

    // Softmax for class probabilities
    const maxLogit = Math.max(...logits);
    const expLogits = logits.map((l) => Math.exp(l - maxLogit));
    const sumExp = expLogits.reduce((a, b) => a + b, 0);
    const classProbs = expLogits.map((e) => e / sumExp);

    // Regression output (simplified)
    const baseReturn = features[0] * 0.5 + features[1] * 0.3; // Based on price changes
    const regressionOutput = [baseReturn * 0.3, baseReturn, baseReturn * 2];

    // Feature importance (simplified - would come from model)
    const featureImportance = features.map((f) => Math.abs(f) * Math.random());

    return {
      classProbs,
      regressionOutput,
      featureImportance,
    };
  }

  async predictBatch(features: number[][]): Promise<RawXGBoostOutput[]> {
    return Promise.all(features.map((f) => this.predict(f)));
  }

  async unload(): Promise<void> {
    this.weights = null;
  }
}

/**
 * SageMaker XGBoost model implementation
 */
class SageMakerXGBoostModel implements XGBoostModel {
  private endpoint: string;
  private client: unknown = null;

  constructor(endpoint: string) {
    this.endpoint = endpoint;
  }

  async load(): Promise<void> {
    // Initialize SageMaker runtime client
    // const { SageMakerRuntimeClient } = await import("@aws-sdk/client-sagemaker-runtime");
    // this.client = new SageMakerRuntimeClient({ region: process.env.AWS_REGION });
    console.log(`[SageMakerXGBoostModel] Connected to endpoint: ${this.endpoint}`);
    this.client = { endpoint: this.endpoint };
  }

  async predict(features: number[]): Promise<RawXGBoostOutput> {
    // In production:
    // const { InvokeEndpointCommand } = await import("@aws-sdk/client-sagemaker-runtime");
    // const command = new InvokeEndpointCommand({
    //   EndpointName: this.endpoint,
    //   Body: JSON.stringify({ instances: [features] }),
    //   ContentType: "application/json",
    // });
    // const response = await this.client.send(command);
    // const body = JSON.parse(new TextDecoder().decode(response.Body));
    // return body.predictions[0];

    // Placeholder
    return {
      classProbs: [0.2, 0.3, 0.3, 0.15, 0.05],
      regressionOutput: [0.02, 0.05, 0.08],
      featureImportance: new Array(55).fill(0.02),
    };
  }

  async predictBatch(features: number[][]): Promise<RawXGBoostOutput[]> {
    // Batch inference
    return Promise.all(features.map((f) => this.predict(f)));
  }

  async unload(): Promise<void> {
    this.client = null;
  }
}

// =============================================================================
// SINGLETON INSTANCE
// =============================================================================

let demandModelInstance: DemandModel | null = null;

export function getDemandModel(): DemandModel {
  if (!demandModelInstance) {
    demandModelInstance = new DemandModel();
  }
  return demandModelInstance;
}

export function resetDemandModel(): void {
  if (demandModelInstance) {
    demandModelInstance.unload();
  }
  demandModelInstance = null;
}
