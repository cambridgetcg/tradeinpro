/**
 * Stacking Meta-Learner
 *
 * Architecture: Gradient Boosted Trees (XGBoost/LightGBM) as Level-1 learner
 * Purpose: Combine all model outputs into final trading decision
 *
 * Training Status: AWAITING BASE MODEL PREDICTIONS
 * Data Requirements:
 *   - 100K+ decision examples with outcomes
 *   - All base model predictions
 *
 * @see docs/AI_MODELS_FOR_TCG_ARBITRAGE.md Section 7 - M15
 */

// =============================================================================
// CONFIGURATION
// =============================================================================

export const STACKING_CONFIG = {
  modelId: "stacking-meta-learner",
  version: "1.0.0-stub",

  // Base models (Level 0)
  baseModels: [
    { id: "demand_xgboost", type: "classification", weight: 0.2 },
    { id: "tft_forecaster", type: "regression", weight: 0.15 },
    { id: "prophet_timing", type: "regression", weight: 0.1 },
    { id: "isolation_forest", type: "anomaly", weight: 0.15 },
    { id: "quality_scorer", type: "classification", weight: 0.15 },
    { id: "arbitrage_detector", type: "regression", weight: 0.25 },
  ],

  // Meta features (computed from base model outputs)
  metaFeatures: {
    fromBaseModels: [
      "demand_prediction",
      "demand_confidence",
      "tft_p50_forecast",
      "tft_uncertainty",
      "timing_signal",
      "anomaly_score",
      "quality_score",
      "arbitrage_spread",
    ],
    computed: [
      "model_agreement_score",
      "confidence_weighted_avg",
      "max_confidence",
      "min_confidence",
      "prediction_variance",
    ],
    context: ["market_regime", "card_value_tier", "time_of_day", "day_of_week"],
  },

  // Output classes
  output: {
    actions: ["buy", "sell", "hold", "avoid", "monitor"],
    riskLevels: ["low", "medium", "high"],
  },

  // Training
  training: {
    requiredExamples: 100000,
    metaModelType: "xgboost", // or "lightgbm"
    hyperparameters: {
      maxDepth: 6,
      nEstimators: 200,
      learningRate: 0.1,
      subsample: 0.8,
      colsampleBytree: 0.8,
    },
    retrainingFrequency: "monthly",
  },
};

// =============================================================================
// TYPES
// =============================================================================

export interface BaseModelPredictions {
  demandPrediction: {
    priceMovement: "strong_up" | "up" | "flat" | "down" | "strong_down";
    confidence: number;
    expectedReturn7d: number;
    expectedReturn30d: number;
  };

  tftForecast: {
    p10: number;
    p50: number;
    p90: number;
    horizon: number;
  };

  timingSignal: {
    isBuyWindow: boolean;
    isSellWindow: boolean;
    seasonalEffect: number;
  };

  anomalyScore: {
    isAnomaly: boolean;
    score: number;
    type: string;
  };

  qualityScore: {
    quality: "legitimate" | "suspicious" | "likely_fake" | "misgraded" | "scam";
    confidence: number;
  };

  arbitrageSignal: {
    netSpread: number;
    bestRoute: string;
    urgency: "immediate" | "short" | "medium" | "low";
  };
}

export interface StackingInput {
  cardId: string;
  listingId?: string;
  currentPrice: number;

  // Base model predictions
  basePredictions: BaseModelPredictions;

  // Context
  context: {
    marketRegime: "accumulation" | "markup" | "distribution" | "markdown";
    cardValueTier: "low" | "medium" | "high" | "premium";
    userCapital: number;
    currentExposure: number;
  };
}

export interface StackingOutput {
  // Final decision
  action: "buy" | "sell" | "hold" | "avoid" | "monitor";
  confidence: number;

  // Risk assessment
  riskLevel: "low" | "medium" | "high";

  // Expected outcomes
  expectedReturn: number;
  expectedRisk: number; // VaR or std dev

  // Position sizing recommendation
  suggestedPositionSize: number; // As fraction of available capital

  // Reasoning
  reasoning: string[];
  topFactors: Array<{
    factor: string;
    contribution: number;
    direction: "positive" | "negative";
  }>;

  // Component weights
  componentWeights: Record<string, number>;

  // Model info
  modelVersion: string;
  predictionTimestamp: Date;
}

export interface StackingModelConfig {
  modelPath?: string;
}

// =============================================================================
// STACKING META-LEARNER SERVICE
// =============================================================================

export class StackingMetaLearner {
  readonly name = "Stacking Meta-Learner";
  readonly version = STACKING_CONFIG.version;

  private modelLoaded: boolean = false;
  private inferenceCount: number = 0;

  constructor(private config: StackingModelConfig = {}) {}

  /**
   * Load the meta-learner model
   */
  async load(): Promise<void> {
    console.log("[Stacking] Loading Meta-Learner model...");
    console.log("[Stacking] Status: MODEL NOT YET TRAINED");
    console.log("[Stacking] Required: 100K decision examples with outcomes");

    await new Promise((resolve) => setTimeout(resolve, 100));

    this.modelLoaded = true;
    console.log("[Stacking] Model loaded in STUB mode");
  }

  isLoaded(): boolean {
    return this.modelLoaded;
  }

  /**
   * Generate final trading decision from all model outputs
   */
  async predict(input: StackingInput): Promise<StackingOutput> {
    if (!this.modelLoaded) {
      throw new Error("Meta-learner not loaded. Call load() first.");
    }

    this.inferenceCount++;

    // Extract and compute meta features
    const metaFeatures = this.computeMetaFeatures(input);

    // STUB: Rule-based decision (replace with trained XGBoost)
    const decision = this.makeRuleBasedDecision(input, metaFeatures);

    return {
      ...decision,
      modelVersion: this.version,
      predictionTimestamp: new Date(),
    };
  }

  /**
   * Compute meta features from base model predictions
   */
  private computeMetaFeatures(
    input: StackingInput
  ): Record<string, number> {
    const bp = input.basePredictions;

    // Model agreement: do models agree on direction?
    let agreementScore = 0;
    const signals: number[] = [];

    // Demand signal
    const demandSignal =
      bp.demandPrediction.priceMovement === "strong_up"
        ? 2
        : bp.demandPrediction.priceMovement === "up"
          ? 1
          : bp.demandPrediction.priceMovement === "flat"
            ? 0
            : bp.demandPrediction.priceMovement === "down"
              ? -1
              : -2;
    signals.push(demandSignal);

    // TFT signal
    const tftSignal = bp.tftForecast.p50 > input.currentPrice ? 1 : -1;
    signals.push(tftSignal);

    // Timing signal
    const timingSignal = bp.timingSignal.isBuyWindow ? 1 : bp.timingSignal.isSellWindow ? -1 : 0;
    signals.push(timingSignal);

    // Anomaly signal (underpriced = positive)
    const anomalySignal = bp.anomalyScore.type === "underpriced" ? 1 : 0;
    signals.push(anomalySignal);

    // Arbitrage signal
    const arbitrageSignal = bp.arbitrageSignal.netSpread > 0.05 ? 1 : 0;
    signals.push(arbitrageSignal);

    // Agreement = how many agree with majority
    const positives = signals.filter((s) => s > 0).length;
    const negatives = signals.filter((s) => s < 0).length;
    agreementScore = Math.max(positives, negatives) / signals.length;

    // Confidence weighted average
    const confidences = [
      bp.demandPrediction.confidence,
      1 - Math.abs(bp.tftForecast.p90 - bp.tftForecast.p10) / bp.tftForecast.p50, // Narrower = more confident
      Math.abs(bp.timingSignal.seasonalEffect),
      bp.anomalyScore.score,
      bp.qualityScore.confidence,
    ];
    const avgConfidence = confidences.reduce((a, b) => a + b, 0) / confidences.length;

    return {
      demandSignal,
      tftSignal,
      timingSignal,
      anomalySignal,
      arbitrageSignal,
      agreementScore,
      avgConfidence,
      maxConfidence: Math.max(...confidences),
      minConfidence: Math.min(...confidences),
      qualityRisk: bp.qualityScore.quality === "legitimate" ? 0 : 1,
      arbitrageSpread: bp.arbitrageSignal.netSpread,
      expectedReturn: bp.demandPrediction.expectedReturn30d,
    };
  }

  /**
   * Rule-based decision (stub for trained model)
   */
  private makeRuleBasedDecision(
    input: StackingInput,
    features: Record<string, number>
  ): Omit<StackingOutput, "modelVersion" | "predictionTimestamp"> {
    const reasoning: string[] = [];
    const topFactors: StackingOutput["topFactors"] = [];

    // Quality gate: avoid bad listings
    if (features.qualityRisk > 0) {
      return {
        action: "avoid",
        confidence: 0.9,
        riskLevel: "high",
        expectedReturn: 0,
        expectedRisk: 1,
        suggestedPositionSize: 0,
        reasoning: ["Listing quality concerns detected"],
        topFactors: [
          {
            factor: "quality_risk",
            contribution: 1.0,
            direction: "negative",
          },
        ],
        componentWeights: { quality: 1.0 },
      };
    }

    // Strong buy signals
    if (
      features.arbitrageSpread > 0.1 &&
      features.agreementScore > 0.6 &&
      features.anomalySignal > 0
    ) {
      reasoning.push("Strong arbitrage opportunity detected");
      reasoning.push("Multiple models agree on positive signal");
      topFactors.push({ factor: "arbitrage_spread", contribution: 0.4, direction: "positive" });
      topFactors.push({ factor: "model_agreement", contribution: 0.3, direction: "positive" });

      return {
        action: "buy",
        confidence: features.avgConfidence,
        riskLevel: features.arbitrageSpread > 0.2 ? "low" : "medium",
        expectedReturn: features.arbitrageSpread,
        expectedRisk: 0.05,
        suggestedPositionSize: Math.min(0.1, features.arbitrageSpread), // Max 10%
        reasoning,
        topFactors,
        componentWeights: {
          arbitrage: 0.4,
          anomaly: 0.25,
          demand: 0.2,
          timing: 0.15,
        },
      };
    }

    // Moderate buy signals
    if (features.demandSignal > 0 && features.timingSignal >= 0) {
      reasoning.push("Positive demand forecast");
      reasoning.push("Timing appears favorable");

      return {
        action: "monitor",
        confidence: features.avgConfidence * 0.8,
        riskLevel: "medium",
        expectedReturn: features.expectedReturn,
        expectedRisk: 0.1,
        suggestedPositionSize: 0.05,
        reasoning,
        topFactors: [
          { factor: "demand_forecast", contribution: 0.5, direction: "positive" },
          { factor: "timing_signal", contribution: 0.3, direction: "positive" },
        ],
        componentWeights: {
          demand: 0.5,
          timing: 0.3,
          arbitrage: 0.1,
          anomaly: 0.1,
        },
      };
    }

    // Default: hold/monitor
    return {
      action: "hold",
      confidence: 0.5,
      riskLevel: "low",
      expectedReturn: 0,
      expectedRisk: 0.05,
      suggestedPositionSize: 0,
      reasoning: ["No clear signal from models", "Recommend waiting for better opportunity"],
      topFactors: [{ factor: "no_clear_signal", contribution: 0.5, direction: "negative" }],
      componentWeights: {
        demand: 0.25,
        timing: 0.25,
        arbitrage: 0.25,
        anomaly: 0.25,
      },
    };
  }

  /**
   * Unload model
   */
  async unload(): Promise<void> {
    this.modelLoaded = false;
    console.log("[Stacking] Model unloaded");
  }
}

// =============================================================================
// SINGLETON INSTANCE
// =============================================================================

let stackingInstance: StackingMetaLearner | null = null;

export function getStackingMetaLearner(config?: StackingModelConfig): StackingMetaLearner {
  if (!stackingInstance) {
    stackingInstance = new StackingMetaLearner(config);
  }
  return stackingInstance;
}

export function resetStackingMetaLearner(): void {
  if (stackingInstance) {
    stackingInstance.unload();
  }
  stackingInstance = null;
}

// =============================================================================
// TRAINING DATA SCHEMA
// =============================================================================

export interface StackingTrainingExample {
  exampleId: string;
  timestamp: Date;

  // Input
  input: StackingInput;

  // Actual outcome (for supervision)
  outcome: {
    actualAction: "buy" | "sell" | "hold";
    actualReturn7d: number;
    actualReturn30d: number;
    wasSuccessful: boolean;
    executionDetails?: {
      entryPrice: number;
      exitPrice: number;
      holdingDays: number;
      fees: number;
    };
  };
}

export interface StackingTrainingStats {
  totalExamples: number;
  outcomeDistribution: Record<string, number>;
  avgReturn: number;
  successRate: number;
  dateRange: { start: Date; end: Date };
  lastUpdated: Date;
}

export function calculateStackingTrainingReadiness(stats: StackingTrainingStats): {
  ready: boolean;
  completionPercentage: number;
  missingRequirements: string[];
} {
  const requirements = STACKING_CONFIG.training;
  const missing: string[] = [];

  const exampleCompletion = stats.totalExamples / requirements.requiredExamples;
  if (exampleCompletion < 1) {
    missing.push(
      `Need ${requirements.requiredExamples - stats.totalExamples} more examples (${Math.round(exampleCompletion * 100)}% complete)`
    );
  }

  // Need balanced outcome distribution
  const outcomes = Object.values(stats.outcomeDistribution);
  const minOutcome = Math.min(...outcomes);
  const maxOutcome = Math.max(...outcomes);
  if (maxOutcome > minOutcome * 5) {
    missing.push(`Outcome distribution imbalanced (max ${maxOutcome}x min)`);
  }

  return {
    ready: missing.length === 0,
    completionPercentage: Math.min(100, Math.round(exampleCompletion * 100)),
    missingRequirements: missing,
  };
}
