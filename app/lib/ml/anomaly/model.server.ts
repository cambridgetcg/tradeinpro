/**
 * Anomaly Detection Model (Isolation Forest)
 *
 * Detects mispriced listings and data errors in real-time.
 * Isolation Forest is ideal because:
 * - Fast training and inference
 * - No distribution assumptions
 * - Works well with mixed features
 * - Handles concept drift with easy retraining
 */

import { BaseModel, ModelCache, zScore, standardDeviation } from "../base.server";
import { getDeploymentConfig, MODEL_VERSIONS, ANOMALY_FEATURE_CONFIG } from "../config";
import type { AnomalyFeatures, AnomalyPrediction, AnomalyType, BasePrediction } from "../types";

// =============================================================================
// ANOMALY MODEL CLASS
// =============================================================================

export class AnomalyModel extends BaseModel<AnomalyFeatures, AnomalyPrediction> {
  readonly name = "anomaly";
  readonly version = MODEL_VERSIONS.anomaly;

  private forest: IIsolationForest | null = null;
  private detectionCache: ModelCache<AnomalyPrediction>;

  // Statistics for feature normalization
  private featureMeans: number[] = [];
  private featureStds: number[] = [];

  constructor() {
    super();
    this.detectionCache = new ModelCache<AnomalyPrediction>(60); // 1 minute cache
  }

  /**
   * Load the anomaly detection model
   */
  async load(): Promise<void> {
    const config = getDeploymentConfig();

    if (config.environment === "aws" && config.aws?.lambda.anomalyFunction) {
      await this.loadAWSModel(config.aws.lambda.anomalyFunction);
    } else {
      await this.loadLocalModel(config.localModelPaths?.anomaly);
    }

    this._isLoaded = true;
  }

  /**
   * Load local model
   */
  private async loadLocalModel(modelPath?: string): Promise<void> {
    console.log(`[AnomalyModel] Loading local Isolation Forest from ${modelPath || "default"}`);

    // Create and initialize the forest
    this.forest = new LocalIsolationForest(
      ANOMALY_FEATURE_CONFIG.isolationForest.nEstimators,
      ANOMALY_FEATURE_CONFIG.isolationForest.maxSamples,
      ANOMALY_FEATURE_CONFIG.isolationForest.contamination
    );

    // In production, would load pre-trained model
    // For now, initialize with default parameters
    if (this.forest) {
      await this.forest.initialize();
    }
  }

  /**
   * Load AWS Lambda model
   */
  private async loadAWSModel(functionName: string): Promise<void> {
    console.log(`[AnomalyModel] Connecting to Lambda function: ${functionName}`);

    // Would initialize Lambda client
    this.forest = new LambdaIsolationForest(functionName);
    await this.forest.initialize();
  }

  /**
   * Fit the model on training data
   */
  async fit(trainingData: AnomalyFeatures[]): Promise<void> {
    if (!this.forest) {
      throw new Error("Model not loaded");
    }

    // Convert features to arrays
    const featureArrays = trainingData.map((f) => this.featuresToArray(f));

    // Calculate normalization statistics
    this.calculateNormalizationStats(featureArrays);

    // Normalize and fit
    const normalizedData = featureArrays.map((f) => this.normalizeArray(f));
    await this.forest.fit(normalizedData);
  }

  /**
   * Run prediction
   */
  protected async _predict(input: AnomalyFeatures): Promise<Omit<AnomalyPrediction, keyof BasePrediction>> {
    if (!this.forest) {
      throw new Error("Model not loaded");
    }

    // Convert and normalize features
    const featureArray = this.featuresToArray(input);
    const normalized = this.normalizeArray(featureArray);

    // Get anomaly score
    const score = await this.forest.score(normalized);

    // Classify anomaly
    const isAnomaly = score > ANOMALY_FEATURE_CONFIG.zScore.anomalyThreshold;
    const anomalyType = this.classifyAnomalyType(input, score);

    // Get contributing features
    const contributingFeatures = this.getContributingFeatures(input, normalized);

    // Generate arbitrage signal if underpriced
    const arbitrageSignal =
      anomalyType === "underpriced" ? this.generateArbitrageSignal(input, score) : undefined;

    return {
      listingId: "", // Set by caller
      isAnomaly,
      anomalyScore: score,
      anomalyType,
      contributingFeatures,
      arbitrageSignal,
    };
  }

  /**
   * Convert features to array
   */
  private featuresToArray(features: AnomalyFeatures): number[] {
    return [
      features.priceZScore,
      features.priceVsMedian,
      features.priceVsRecentSales,
      features.pricePercentile,
      features.listingAgeHours,
      features.sellerListingsToday,
      features.cardListingsToday,
      features.tcgCmSpread,
      features.tcgEbaySpread,
      features.crossMarketZScore,
      features.isCompleteData ? 1 : 0,
      features.conditionMatchesPrice ? 1 : 0,
      features.titleMatchesCard,
    ];
  }

  /**
   * Calculate normalization statistics from training data
   */
  private calculateNormalizationStats(data: number[][]): void {
    if (data.length === 0) return;

    const numFeatures = data[0].length;
    this.featureMeans = [];
    this.featureStds = [];

    for (let i = 0; i < numFeatures; i++) {
      const values = data.map((row) => row[i]);
      const mean = values.reduce((a, b) => a + b, 0) / values.length;
      const std = standardDeviation(values);

      this.featureMeans.push(mean);
      this.featureStds.push(std || 1); // Avoid division by zero
    }
  }

  /**
   * Normalize a feature array
   */
  private normalizeArray(features: number[]): number[] {
    if (this.featureMeans.length === 0) {
      // No normalization stats, return as-is
      return features;
    }

    return features.map((f, i) => (f - this.featureMeans[i]) / this.featureStds[i]);
  }

  /**
   * Classify the type of anomaly
   */
  private classifyAnomalyType(features: AnomalyFeatures, score: number): AnomalyType {
    if (score < ANOMALY_FEATURE_CONFIG.zScore.anomalyThreshold) {
      return "normal";
    }

    // Check for underpriced (arbitrage opportunity)
    if (features.priceZScore < -2) {
      return "underpriced";
    }

    // Check for overpriced
    if (features.priceZScore > 2) {
      return "overpriced";
    }

    // Check for data error
    if (!features.isCompleteData || features.titleMatchesCard < 0.5) {
      return "data_error";
    }

    // Check for market dislocation (cross-market spread)
    if (Math.abs(features.crossMarketZScore) > ANOMALY_FEATURE_CONFIG.crossMarket.anomalousSpread) {
      return "market_dislocation";
    }

    // Check for suspicious activity
    if (features.sellerListingsToday > 20 || features.cardListingsToday > 50) {
      return "suspicious_activity";
    }

    return "normal";
  }

  /**
   * Get features contributing most to anomaly
   */
  private getContributingFeatures(
    features: AnomalyFeatures,
    normalized: number[]
  ): Array<{ feature: string; zScore: number; contribution: number }> {
    const featureNames = [
      "priceZScore",
      "priceVsMedian",
      "priceVsRecentSales",
      "pricePercentile",
      "listingAgeHours",
      "sellerListingsToday",
      "cardListingsToday",
      "tcgCmSpread",
      "tcgEbaySpread",
      "crossMarketZScore",
      "isCompleteData",
      "conditionMatchesPrice",
      "titleMatchesCard",
    ];

    const contributions = normalized.map((value, idx) => ({
      feature: featureNames[idx],
      zScore: Math.abs(value),
      contribution: Math.abs(value) / (normalized.reduce((sum, v) => sum + Math.abs(v), 0) || 1),
    }));

    // Sort by z-score and return top 5
    return contributions.sort((a, b) => b.zScore - a.zScore).slice(0, 5);
  }

  /**
   * Generate arbitrage signal for underpriced listings
   */
  private generateArbitrageSignal(
    features: AnomalyFeatures,
    score: number
  ): AnomalyPrediction["arbitrageSignal"] {
    const isOpportunity = features.priceZScore < -2 && features.conditionMatchesPrice;

    // Estimate margin based on price deviation
    const estimatedMargin = Math.abs(features.priceVsMedian);

    // Determine urgency based on how anomalous it is
    let urgency: "immediate" | "short" | "medium" | "low" = "low";
    if (score > ANOMALY_FEATURE_CONFIG.zScore.severeAnomalyThreshold) {
      urgency = "immediate";
    } else if (score > ANOMALY_FEATURE_CONFIG.zScore.anomalyThreshold * 1.5) {
      urgency = "short";
    } else if (score > ANOMALY_FEATURE_CONFIG.zScore.anomalyThreshold) {
      urgency = "medium";
    }

    // Determine action
    let suggestedAction: "buy" | "sell" | "monitor" | "avoid" = "monitor";
    if (isOpportunity && estimatedMargin > ANOMALY_FEATURE_CONFIG.crossMarket.arbitrageOpportunity) {
      suggestedAction = "buy";
    } else if (!features.conditionMatchesPrice) {
      suggestedAction = "avoid";
    }

    return {
      isOpportunity,
      estimatedMargin,
      suggestedAction,
      urgency,
    };
  }

  /**
   * Unload model
   */
  async unload(): Promise<void> {
    if (this.forest) {
      await this.forest.cleanup();
    }
    this.forest = null;
    this.featureMeans = [];
    this.featureStds = [];
    this.detectionCache.clear();
    this._isLoaded = false;
  }
}

// =============================================================================
// ISOLATION FOREST IMPLEMENTATION
// =============================================================================

interface IIsolationForest {
  initialize(): Promise<void>;
  fit(data: number[][]): Promise<void>;
  score(sample: number[]): Promise<number>;
  cleanup(): Promise<void>;
}

/**
 * Local Isolation Forest implementation
 *
 * Isolation Forest works by randomly partitioning data.
 * Anomalies are isolated in fewer partitions (shorter path length).
 */
class LocalIsolationForest implements IIsolationForest {
  private nEstimators: number;
  private maxSamples: "auto" | number;
  private contamination: number;
  private trees: IsolationTree[] = [];
  private averagePathLength: number = 0;

  constructor(nEstimators: number, maxSamples: "auto" | number, contamination: number) {
    this.nEstimators = nEstimators;
    this.maxSamples = maxSamples;
    this.contamination = contamination;
  }

  async initialize(): Promise<void> {
    // Initialization done in fit()
  }

  async fit(data: number[][]): Promise<void> {
    if (data.length === 0) return;

    const sampleSize =
      this.maxSamples === "auto"
        ? Math.min(256, data.length)
        : Math.min(this.maxSamples, data.length);

    this.trees = [];

    // Build trees
    for (let i = 0; i < this.nEstimators; i++) {
      // Sample data
      const sample = this.subsample(data, sampleSize);

      // Build tree
      const tree = new IsolationTree();
      tree.fit(sample, 0, Math.ceil(Math.log2(sampleSize)));
      this.trees.push(tree);
    }

    // Calculate average path length for normalization
    this.averagePathLength = this.calculateAveragePathLength(sampleSize);
  }

  async score(sample: number[]): Promise<number> {
    if (this.trees.length === 0) {
      return 0;
    }

    // Get average path length across all trees
    let totalPathLength = 0;
    for (const tree of this.trees) {
      totalPathLength += tree.pathLength(sample, 0);
    }
    const avgPathLength = totalPathLength / this.trees.length;

    // Convert to anomaly score (0 to 1)
    // Shorter path = more anomalous = higher score
    const score = Math.pow(2, -avgPathLength / this.averagePathLength);

    return score;
  }

  async cleanup(): Promise<void> {
    this.trees = [];
  }

  /**
   * Subsample data
   */
  private subsample(data: number[][], size: number): number[][] {
    const indices = new Set<number>();
    while (indices.size < size && indices.size < data.length) {
      indices.add(Math.floor(Math.random() * data.length));
    }
    return Array.from(indices).map((i) => data[i]);
  }

  /**
   * Calculate expected average path length
   */
  private calculateAveragePathLength(n: number): number {
    if (n <= 1) return 0;
    if (n === 2) return 1;

    // Harmonic number approximation
    const harmonicNumber = Math.log(n - 1) + 0.5772156649; // Euler-Mascheroni constant
    return 2 * harmonicNumber - (2 * (n - 1)) / n;
  }
}

/**
 * Isolation Tree node
 */
class IsolationTree {
  private splitFeature: number = -1;
  private splitValue: number = 0;
  private left: IsolationTree | null = null;
  private right: IsolationTree | null = null;
  private size: number = 0;

  /**
   * Fit the tree on data
   */
  fit(data: number[][], depth: number, maxDepth: number): void {
    this.size = data.length;

    // Stop conditions
    if (depth >= maxDepth || data.length <= 1) {
      return;
    }

    // Random feature selection
    const numFeatures = data[0]?.length ?? 0;
    if (numFeatures === 0) return;

    this.splitFeature = Math.floor(Math.random() * numFeatures);

    // Get min and max for this feature
    const values = data.map((row) => row[this.splitFeature]);
    const minVal = Math.min(...values);
    const maxVal = Math.max(...values);

    // If all values are the same, can't split
    if (minVal === maxVal) {
      return;
    }

    // Random split value
    this.splitValue = minVal + Math.random() * (maxVal - minVal);

    // Split data
    const leftData = data.filter((row) => row[this.splitFeature] < this.splitValue);
    const rightData = data.filter((row) => row[this.splitFeature] >= this.splitValue);

    // Build children
    if (leftData.length > 0) {
      this.left = new IsolationTree();
      this.left.fit(leftData, depth + 1, maxDepth);
    }

    if (rightData.length > 0) {
      this.right = new IsolationTree();
      this.right.fit(rightData, depth + 1, maxDepth);
    }
  }

  /**
   * Get path length to isolate sample
   */
  pathLength(sample: number[], depth: number): number {
    // Leaf node
    if (this.splitFeature === -1 || (!this.left && !this.right)) {
      // Return expected path length for remaining samples
      return depth + this.expectedPathLength(this.size);
    }

    // Traverse
    if (sample[this.splitFeature] < this.splitValue) {
      return this.left ? this.left.pathLength(sample, depth + 1) : depth + 1;
    } else {
      return this.right ? this.right.pathLength(sample, depth + 1) : depth + 1;
    }
  }

  /**
   * Expected path length for n samples
   */
  private expectedPathLength(n: number): number {
    if (n <= 1) return 0;
    if (n === 2) return 1;

    const harmonicNumber = Math.log(n - 1) + 0.5772156649;
    return 2 * harmonicNumber - (2 * (n - 1)) / n;
  }
}

/**
 * Lambda-based Isolation Forest for AWS
 */
class LambdaIsolationForest implements IIsolationForest {
  private functionName: string;
  private client: unknown = null;

  constructor(functionName: string) {
    this.functionName = functionName;
  }

  async initialize(): Promise<void> {
    // Initialize Lambda client
    console.log(`[LambdaIsolationForest] Connected to: ${this.functionName}`);
    this.client = { functionName: this.functionName };
  }

  async fit(_data: number[][]): Promise<void> {
    // Training happens separately on AWS
    // This would invoke a training Lambda or use pre-trained model
  }

  async score(sample: number[]): Promise<number> {
    // In production:
    // const { LambdaClient, InvokeCommand } = await import("@aws-sdk/client-lambda");
    // const response = await this.client.send(new InvokeCommand({
    //   FunctionName: this.functionName,
    //   Payload: JSON.stringify({ features: sample }),
    // }));
    // return JSON.parse(new TextDecoder().decode(response.Payload)).score;

    // Placeholder
    return 0.1;
  }

  async cleanup(): Promise<void> {
    this.client = null;
  }
}

// =============================================================================
// FEATURE EXTRACTION HELPERS
// =============================================================================

export interface ListingForAnomaly {
  listingId: string;
  price: number;
  cardId: string;
  condition?: string;
  title?: string;
  sellerId?: string;
}

export interface MarketStats {
  medianPrice: number;
  meanPrice: number;
  stdPrice: number;
  recentSales: number[];
  tcgPrice: number;
  cmPrice: number;
  ebayPrice: number;
  listingsToday: number;
  sellerListingsToday: number;
}

/**
 * Extract anomaly features from listing and market data
 */
export function extractAnomalyFeatures(
  listing: ListingForAnomaly,
  stats: MarketStats,
  listingAgeHours: number = 0
): AnomalyFeatures {
  const priceZScore = zScore(listing.price, stats.meanPrice, stats.stdPrice);

  const priceVsMedian =
    stats.medianPrice > 0 ? (listing.price - stats.medianPrice) / stats.medianPrice : 0;

  const recentAvg =
    stats.recentSales.length > 0
      ? stats.recentSales.reduce((a, b) => a + b, 0) / stats.recentSales.length
      : stats.meanPrice;
  const priceVsRecentSales = recentAvg > 0 ? (listing.price - recentAvg) / recentAvg : 0;

  const pricePercentile = stats.recentSales.filter((p) => p < listing.price).length /
    (stats.recentSales.length || 1);

  // Cross-market spreads
  const tcgCmSpread =
    stats.tcgPrice > 0 && stats.cmPrice > 0 ? (stats.tcgPrice - stats.cmPrice) / stats.tcgPrice : 0;

  const tcgEbaySpread =
    stats.tcgPrice > 0 && stats.ebayPrice > 0
      ? (stats.tcgPrice - stats.ebayPrice) / stats.tcgPrice
      : 0;

  const crossMarketZScore = Math.abs(tcgCmSpread) + Math.abs(tcgEbaySpread);

  // Data quality
  const isCompleteData = Boolean(listing.condition && listing.title);

  const conditionMatchesPrice = true; // Would need more context to determine

  const titleMatchesCard = listing.title ? 1.0 : 0.0; // Would use NLP to verify

  return {
    priceZScore,
    priceVsMedian,
    priceVsRecentSales,
    pricePercentile,
    listingAgeHours,
    sellerListingsToday: stats.sellerListingsToday,
    cardListingsToday: stats.listingsToday,
    tcgCmSpread,
    tcgEbaySpread,
    crossMarketZScore,
    isCompleteData,
    conditionMatchesPrice,
    titleMatchesCard,
  };
}

// =============================================================================
// SINGLETON INSTANCE
// =============================================================================

let anomalyModelInstance: AnomalyModel | null = null;

export function getAnomalyModel(): AnomalyModel {
  if (!anomalyModelInstance) {
    anomalyModelInstance = new AnomalyModel();
  }
  return anomalyModelInstance;
}

export function resetAnomalyModel(): void {
  if (anomalyModelInstance) {
    anomalyModelInstance.unload();
  }
  anomalyModelInstance = null;
}
