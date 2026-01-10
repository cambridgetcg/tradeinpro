/**
 * Listing Quality Scorer (Logistic Regression)
 *
 * Fast, interpretable model for detecting:
 * - Counterfeit listings
 * - Misgraded cards
 * - Scam listings
 * - Suspicious sellers
 */

import { BaseModel, ModelCache } from "../base.server";
import { getDeploymentConfig, MODEL_VERSIONS, QUALITY_FEATURE_CONFIG } from "../config";
import type { QualityFeatures, QualityPrediction, ListingQuality, BasePrediction } from "../types";

// =============================================================================
// QUALITY MODEL CLASS
// =============================================================================

export class QualityModel extends BaseModel<QualityFeatures, QualityPrediction> {
  readonly name = "quality";
  readonly version = MODEL_VERSIONS.quality;

  private model: LogisticRegressionModel | null = null;
  private predictionCache: ModelCache<QualityPrediction>;

  constructor() {
    super();
    this.predictionCache = new ModelCache<QualityPrediction>(60);
  }

  /**
   * Load the quality scoring model
   */
  async load(): Promise<void> {
    const config = getDeploymentConfig();

    if (config.environment === "aws" && config.aws?.lambda.qualityFunction) {
      await this.loadAWSModel(config.aws.lambda.qualityFunction);
    } else {
      await this.loadLocalModel(config.localModelPaths?.quality);
    }

    this._isLoaded = true;
  }

  /**
   * Load local model
   */
  private async loadLocalModel(modelPath?: string): Promise<void> {
    console.log(`[QualityModel] Loading local Logistic Regression from ${modelPath || "default"}`);

    this.model = new LocalLogisticRegression();
    await this.model.initialize();
  }

  /**
   * Load AWS Lambda model
   */
  private async loadAWSModel(functionName: string): Promise<void> {
    console.log(`[QualityModel] Connecting to Lambda: ${functionName}`);

    this.model = new LambdaLogisticRegression(functionName);
    await this.model.initialize();
  }

  /**
   * Run prediction
   */
  protected async _predict(input: QualityFeatures): Promise<Omit<QualityPrediction, keyof BasePrediction>> {
    if (!this.model) {
      throw new Error("Model not loaded");
    }

    // Convert features to array
    const featureArray = this.featuresToArray(input);

    // Get probabilities from model
    const probabilities = await this.model.predict(featureArray);

    // Determine classification
    const quality = this.classifyQuality(probabilities);

    // Identify risk factors
    const riskFactors = this.identifyRiskFactors(input);

    // Generate recommendation
    const { recommendation, recommendationReason } = this.generateRecommendation(
      quality,
      probabilities,
      riskFactors
    );

    return {
      listingId: "",
      quality,
      probabilities,
      riskFactors,
      recommendation,
      recommendationReason,
    };
  }

  /**
   * Convert features to array
   */
  private featuresToArray(features: QualityFeatures): number[] {
    return [
      // Price signals (5)
      features.priceVsMarket,
      features.priceVsRecentSales,
      features.pricePercentile,
      features.isSuspiciouslyLow ? 1 : 0,
      features.isRoundNumber ? 1 : 0,
      // Seller signals (10)
      features.feedbackScore / 100, // Normalize to 0-1
      Math.log(features.feedbackCount + 1) / 10, // Log-scale
      Math.log(features.accountAgeDays + 1) / 10,
      features.isNewAccount ? 1 : 0,
      features.isPowerSeller ? 1 : 0,
      features.negativeFeedbackRate,
      features.recentNegativeCount / 10,
      features.sellsOtherCategories ? 1 : 0,
      features.listingVelocity / 20,
      (features.responseTimeHours ?? 24) / 48,
      // Listing signals (10)
      features.hasPhotos ? 1 : 0,
      features.photoCount / 5,
      features.photoQualityScore,
      features.usesStockPhoto ? 1 : 0,
      features.descriptionLength / 500,
      features.descriptionQualityScore,
      features.conditionMatchesPhotos ? 1 : 0,
      features.titleHasSuspiciousKeywords ? 1 : 0,
      features.isAuction ? 1 : 0,
      features.shippingLocationMatches ? 1 : 0,
      // Card-specific (5)
      features.isHighValue ? 1 : 0,
      features.hasKnownFakes ? 1 : 0,
      features.isGraded ? 1 : 0,
      features.editionMatchesEra ? 1 : 0,
      features.imageAuthenticityScore,
    ];
  }

  /**
   * Classify quality from probabilities
   */
  private classifyQuality(
    probs: QualityPrediction["probabilities"]
  ): ListingQuality {
    const entries: [ListingQuality, number][] = [
      ["legitimate", probs.legitimate],
      ["suspicious", probs.suspicious],
      ["likely_fake", probs.likelyFake],
      ["misgraded", probs.misgraded],
      ["scam", probs.scam],
    ];

    const [quality] = entries.reduce((best, current) =>
      current[1] > best[1] ? current : best
    );

    return quality;
  }

  /**
   * Identify specific risk factors
   */
  private identifyRiskFactors(
    features: QualityFeatures
  ): QualityPrediction["riskFactors"] {
    const factors: QualityPrediction["riskFactors"] = [];

    // Price-related
    if (features.isSuspiciouslyLow) {
      factors.push({
        factor: "Price significantly below market",
        severity: "high",
        description: `Price is ${Math.abs(features.priceVsMarket * 100).toFixed(0)}% below market average`,
      });
    }

    // Seller-related
    if (features.isNewAccount) {
      factors.push({
        factor: "New seller account",
        severity: "medium",
        description: "Account is less than 30 days old",
      });
    }

    if (features.feedbackScore < QUALITY_FEATURE_CONFIG.seller.lowFeedbackThreshold) {
      factors.push({
        factor: "Low feedback score",
        severity: "medium",
        description: `Feedback score is ${features.feedbackScore}%, below threshold`,
      });
    }

    if (features.listingVelocity > QUALITY_FEATURE_CONFIG.seller.highVelocityThreshold) {
      factors.push({
        factor: "High listing velocity",
        severity: "medium",
        description: `Seller listed ${features.listingVelocity} items today`,
      });
    }

    // Listing-related
    if (features.usesStockPhoto) {
      factors.push({
        factor: "Uses stock photo",
        severity: "high",
        description: "Listing uses generic/stock image instead of actual card photo",
      });
    }

    if (!features.hasPhotos) {
      factors.push({
        factor: "No photos",
        severity: "medium",
        description: "Listing has no photos of the actual card",
      });
    }

    if (features.titleHasSuspiciousKeywords) {
      factors.push({
        factor: "Suspicious keywords in title",
        severity: "medium",
        description: "Title contains keywords like 'authentic', 'real', 'not fake'",
      });
    }

    // Card-specific
    if (features.hasKnownFakes && !features.isGraded) {
      factors.push({
        factor: "Known counterfeit target",
        severity: "high",
        description: "This card is commonly counterfeited and is not graded",
      });
    }

    if (!features.editionMatchesEra) {
      factors.push({
        factor: "Edition/era mismatch",
        severity: "high",
        description: "Listed edition doesn't match card's expected release period",
      });
    }

    if (features.imageAuthenticityScore < 0.7) {
      factors.push({
        factor: "Low image authenticity score",
        severity: "high",
        description: "Visual analysis indicates potential authenticity issues",
      });
    }

    return factors;
  }

  /**
   * Generate recommendation
   */
  private generateRecommendation(
    quality: ListingQuality,
    probs: QualityPrediction["probabilities"],
    riskFactors: QualityPrediction["riskFactors"]
  ): { recommendation: "safe" | "caution" | "avoid"; recommendationReason: string } {
    // Count high severity risks
    const highRisks = riskFactors.filter((r) => r.severity === "high").length;
    const mediumRisks = riskFactors.filter((r) => r.severity === "medium").length;

    if (quality === "scam" || quality === "likely_fake" || highRisks >= 2) {
      return {
        recommendation: "avoid",
        recommendationReason: `High risk: ${quality === "scam" ? "Likely scam" : quality === "likely_fake" ? "Likely counterfeit" : `${highRisks} high-severity risk factors identified`}`,
      };
    }

    if (quality === "suspicious" || quality === "misgraded" || highRisks >= 1 || mediumRisks >= 3) {
      return {
        recommendation: "caution",
        recommendationReason: `Proceed with caution: ${riskFactors.map((r) => r.factor).join(", ")}`,
      };
    }

    return {
      recommendation: "safe",
      recommendationReason: `Listing appears legitimate (${(probs.legitimate * 100).toFixed(0)}% confidence)`,
    };
  }

  /**
   * Unload model
   */
  async unload(): Promise<void> {
    if (this.model) {
      await this.model.cleanup();
    }
    this.model = null;
    this.predictionCache.clear();
    this._isLoaded = false;
  }
}

// =============================================================================
// LOGISTIC REGRESSION INTERFACES
// =============================================================================

interface LogisticRegressionModel {
  initialize(): Promise<void>;
  predict(features: number[]): Promise<QualityPrediction["probabilities"]>;
  cleanup(): Promise<void>;
}

/**
 * Local Logistic Regression implementation
 */
class LocalLogisticRegression implements LogisticRegressionModel {
  private weights: number[][] = [];
  private biases: number[] = [];

  async initialize(): Promise<void> {
    // Initialize weights for 5 classes with 30 features
    const numClasses = 5;
    const numFeatures = 30;

    // In production, would load trained weights
    // For now, initialize with heuristic weights
    this.weights = [];
    this.biases = [];

    for (let c = 0; c < numClasses; c++) {
      // Heuristic weights that make sense for each class
      const classWeights = new Array(numFeatures).fill(0);

      if (c === 0) {
        // Legitimate: positive for good signals
        classWeights[5] = 0.5; // High feedback score
        classWeights[6] = 0.3; // More feedback count
        classWeights[7] = 0.2; // Older account
        classWeights[10] = 0.3; // Has photos
        classWeights[16] = 0.2; // Condition matches
      } else if (c === 1) {
        // Suspicious: mixed signals
        classWeights[0] = -0.3; // Low price
        classWeights[8] = -0.2; // Not power seller
        classWeights[14] = 0.2; // Short description
      } else if (c === 2) {
        // Likely fake
        classWeights[0] = -0.5; // Very low price
        classWeights[13] = 0.5; // Uses stock photo
        classWeights[20] = 0.3; // Has known fakes
        classWeights[24] = -0.4; // Low authenticity
      } else if (c === 3) {
        // Misgraded
        classWeights[16] = -0.5; // Condition doesn't match
        classWeights[12] = -0.3; // Low photo quality
      } else {
        // Scam
        classWeights[3] = 0.4; // Suspiciously low
        classWeights[8] = 0.3; // New account
        classWeights[9] = 0.3; // High negative feedback
        classWeights[17] = 0.3; // Suspicious keywords
      }

      this.weights.push(classWeights);
      this.biases.push(c === 0 ? 0.5 : -0.5); // Prior: legitimate more likely
    }
  }

  async predict(features: number[]): Promise<QualityPrediction["probabilities"]> {
    // Calculate logits
    const logits = this.weights.map((w, c) => {
      let logit = this.biases[c];
      for (let i = 0; i < features.length && i < w.length; i++) {
        logit += w[i] * features[i];
      }
      return logit;
    });

    // Softmax
    const maxLogit = Math.max(...logits);
    const expLogits = logits.map((l) => Math.exp(l - maxLogit));
    const sumExp = expLogits.reduce((a, b) => a + b, 0);
    const probs = expLogits.map((e) => e / sumExp);

    return {
      legitimate: probs[0],
      suspicious: probs[1],
      likelyFake: probs[2],
      misgraded: probs[3],
      scam: probs[4],
    };
  }

  async cleanup(): Promise<void> {
    this.weights = [];
    this.biases = [];
  }
}

/**
 * Lambda-based Logistic Regression
 */
class LambdaLogisticRegression implements LogisticRegressionModel {
  private functionName: string;

  constructor(functionName: string) {
    this.functionName = functionName;
  }

  async initialize(): Promise<void> {
    console.log(`[LambdaLogisticRegression] Connected to: ${this.functionName}`);
  }

  async predict(_features: number[]): Promise<QualityPrediction["probabilities"]> {
    // Would invoke Lambda
    return {
      legitimate: 0.7,
      suspicious: 0.15,
      likelyFake: 0.05,
      misgraded: 0.05,
      scam: 0.05,
    };
  }

  async cleanup(): Promise<void> {}
}

// =============================================================================
// FEATURE EXTRACTION HELPERS
// =============================================================================

export interface ListingForQuality {
  listingId: string;
  price: number;
  title: string;
  description?: string;
  condition?: string;
  photoUrls?: string[];
  sellerId: string;
  sellerFeedbackScore: number;
  sellerFeedbackCount: number;
  sellerAccountAgeDays: number;
  isAuction: boolean;
  shippingFrom?: string;
  sellerLocation?: string;
}

export interface QualityContext {
  marketPrice: number;
  recentSales: number[];
  hasKnownFakes: boolean;
  isHighValueCard: boolean;
  isGradedCard: boolean;
  expectedEdition?: string;
  imageAuthenticityScore?: number;
  conditionFromImage?: string;
  sellerListingsToday?: number;
  sellerResponseTimeHours?: number;
}

/**
 * Extract quality features from listing
 */
export function extractQualityFeatures(
  listing: ListingForQuality,
  context: QualityContext
): QualityFeatures {
  const priceVsMarket =
    context.marketPrice > 0 ? (listing.price - context.marketPrice) / context.marketPrice : 0;

  const recentAvg =
    context.recentSales.length > 0
      ? context.recentSales.reduce((a, b) => a + b, 0) / context.recentSales.length
      : context.marketPrice;
  const priceVsRecentSales = recentAvg > 0 ? (listing.price - recentAvg) / recentAvg : 0;

  const pricePercentile =
    context.recentSales.filter((p) => p < listing.price).length /
    (context.recentSales.length || 1);

  const isSuspiciouslyLow = priceVsMarket < QUALITY_FEATURE_CONFIG.price.suspiciouslyLowThreshold;
  const isRoundNumber = listing.price % 5 === 0 || listing.price % 10 === 0;

  // Check for suspicious keywords
  const suspiciousKeywords = ["authentic", "real", "genuine", "not fake", "100%", "guaranteed"];
  const titleLower = listing.title.toLowerCase();
  const titleHasSuspiciousKeywords = suspiciousKeywords.some((kw) => titleLower.includes(kw));

  // Check if stock photo (simplified)
  const usesStockPhoto = !listing.photoUrls || listing.photoUrls.length === 0;

  return {
    // Price signals
    priceVsMarket,
    priceVsRecentSales,
    pricePercentile,
    isSuspiciouslyLow,
    isRoundNumber,

    // Seller signals
    feedbackScore: listing.sellerFeedbackScore,
    feedbackCount: listing.sellerFeedbackCount,
    accountAgeDays: listing.sellerAccountAgeDays,
    isNewAccount: listing.sellerAccountAgeDays < QUALITY_FEATURE_CONFIG.seller.newAccountDays,
    isPowerSeller: listing.sellerFeedbackCount > 1000 && listing.sellerFeedbackScore > 99,
    negativeFeedbackRate: (100 - listing.sellerFeedbackScore) / 100,
    recentNegativeCount: 0, // Would need additional data
    sellsOtherCategories: false, // Would need additional data
    listingVelocity: context.sellerListingsToday ?? 0,
    responseTimeHours: context.sellerResponseTimeHours ?? null,

    // Listing signals
    hasPhotos: Boolean(listing.photoUrls && listing.photoUrls.length > 0),
    photoCount: listing.photoUrls?.length ?? 0,
    photoQualityScore: 0.8, // Would need image analysis
    usesStockPhoto,
    descriptionLength: listing.description?.length ?? 0,
    descriptionQualityScore: 0.7, // Would need NLP analysis
    conditionMatchesPhotos:
      !context.conditionFromImage || context.conditionFromImage === listing.condition,
    titleHasSuspiciousKeywords,
    isAuction: listing.isAuction,
    shippingLocationMatches:
      !listing.shippingFrom ||
      !listing.sellerLocation ||
      listing.shippingFrom === listing.sellerLocation,

    // Card-specific
    isHighValue: context.isHighValueCard,
    hasKnownFakes: context.hasKnownFakes,
    isGraded: context.isGradedCard,
    editionMatchesEra: true, // Would need card data
    imageAuthenticityScore: context.imageAuthenticityScore ?? 0.9,
  };
}

// =============================================================================
// SINGLETON INSTANCE
// =============================================================================

let qualityModelInstance: QualityModel | null = null;

export function getQualityModel(): QualityModel {
  if (!qualityModelInstance) {
    qualityModelInstance = new QualityModel();
  }
  return qualityModelInstance;
}

export function resetQualityModel(): void {
  if (qualityModelInstance) {
    qualityModelInstance.unload();
  }
  qualityModelInstance = null;
}
