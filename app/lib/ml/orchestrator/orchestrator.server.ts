/**
 * ML Orchestrator
 *
 * Combines all specialized models into a unified analysis pipeline.
 * Coordinates inference across models and generates combined recommendations.
 */

import { ModelCache } from "../base.server";
import { MODEL_VERSIONS, PERFORMANCE_CONFIG, PLATFORM_FEES, SHIPPING_COSTS, IMPORT_CONFIG } from "../config";
import type {
  AnalysisRequest,
  AnalysisResult,
  VisionOutput,
  DemandPrediction,
  QualityPrediction,
  TimingPrediction,
  AnomalyPrediction,
  Platform,
  Region,
} from "../types";

import { getVisionModel } from "../vision";
import { getDemandModel } from "../demand";
import { getQualityModel, extractQualityFeatures, type ListingForQuality, type QualityContext } from "../quality";
import { getTimingModel } from "../timing";
import { getAnomalyModel, extractAnomalyFeatures, type ListingForAnomaly, type MarketStats } from "../anomaly";

// =============================================================================
// ORCHESTRATOR CLASS
// =============================================================================

export class MLOrchestrator {
  private analysisCache: ModelCache<AnalysisResult>;
  private isInitialized: boolean = false;

  constructor() {
    this.analysisCache = new ModelCache<AnalysisResult>(60); // 1 minute cache
  }

  /**
   * Initialize all models
   */
  async initialize(): Promise<void> {
    console.log("[MLOrchestrator] Initializing all models...");

    const loadPromises: Promise<void>[] = [];

    // Load all models in parallel
    loadPromises.push(
      getVisionModel().load().catch((e) => {
        console.warn("[MLOrchestrator] Vision model failed to load:", e.message);
      })
    );

    loadPromises.push(
      getDemandModel().load().catch((e) => {
        console.warn("[MLOrchestrator] Demand model failed to load:", e.message);
      })
    );

    loadPromises.push(
      getQualityModel().load().catch((e) => {
        console.warn("[MLOrchestrator] Quality model failed to load:", e.message);
      })
    );

    loadPromises.push(
      getTimingModel().load().catch((e) => {
        console.warn("[MLOrchestrator] Timing model failed to load:", e.message);
      })
    );

    loadPromises.push(
      getAnomalyModel().load().catch((e) => {
        console.warn("[MLOrchestrator] Anomaly model failed to load:", e.message);
      })
    );

    await Promise.all(loadPromises);

    this.isInitialized = true;
    console.log("[MLOrchestrator] All models initialized");
  }

  /**
   * Run full analysis on a listing
   */
  async analyze(request: AnalysisRequest): Promise<AnalysisResult> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const startTime = performance.now();

    // Check cache
    const cacheKey = `${request.listing.id}-${JSON.stringify(request.models)}`;
    const cached = this.analysisCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    // Determine which models to run
    const modelsToRun = request.models ?? {
      vision: true,
      demand: true,
      quality: true,
      timing: true,
      anomaly: true,
    };

    // Run models in parallel
    const results = await this.runModels(request, modelsToRun);

    // Generate combined recommendation
    const recommendation = this.generateRecommendation(results, request);

    // Identify deal type
    const deal = this.identifyDeal(results, request);

    // Calculate costs
    const costAnalysis = request.userContext
      ? this.calculateCosts(request, results, request.userContext.region)
      : undefined;

    const totalLatencyMs = performance.now() - startTime;

    const analysisResult: AnalysisResult = {
      listingId: request.listing.id,
      analyzedAt: new Date(),
      totalLatencyMs,
      ...results,
      recommendation,
      deal,
      costAnalysis,
    };

    // Cache result
    this.analysisCache.set(cacheKey, analysisResult);

    return analysisResult;
  }

  /**
   * Run individual models
   */
  private async runModels(
    request: AnalysisRequest,
    modelsToRun: NonNullable<AnalysisRequest["models"]>
  ): Promise<{
    vision?: VisionOutput;
    demand?: DemandPrediction;
    quality?: QualityPrediction;
    timing?: TimingPrediction;
    anomaly?: AnomalyPrediction;
  }> {
    const results: {
      vision?: VisionOutput;
      demand?: DemandPrediction;
      quality?: QualityPrediction;
      timing?: TimingPrediction;
      anomaly?: AnomalyPrediction;
    } = {};

    const promises: Promise<void>[] = [];

    // Vision model
    if (modelsToRun.vision && request.listing.imageUrls?.length) {
      promises.push(
        this.runVisionModel(request.listing.imageUrls[0])
          .then((r) => {
            results.vision = r;
          })
          .catch((e) => console.warn("[Orchestrator] Vision error:", e.message))
      );
    }

    // Quality model
    if (modelsToRun.quality) {
      promises.push(
        this.runQualityModel(request)
          .then((r) => {
            results.quality = r;
          })
          .catch((e) => console.warn("[Orchestrator] Quality error:", e.message))
      );
    }

    // Anomaly model
    if (modelsToRun.anomaly) {
      promises.push(
        this.runAnomalyModel(request)
          .then((r) => {
            results.anomaly = r;
          })
          .catch((e) => console.warn("[Orchestrator] Anomaly error:", e.message))
      );
    }

    // Timing model (requires price history - would need to fetch)
    if (modelsToRun.timing) {
      promises.push(
        this.runTimingModel(request)
          .then((r) => {
            results.timing = r;
          })
          .catch((e) => console.warn("[Orchestrator] Timing error:", e.message))
      );
    }

    // Demand model (requires features - would need to fetch)
    if (modelsToRun.demand) {
      promises.push(
        this.runDemandModel(request)
          .then((r) => {
            results.demand = r;
          })
          .catch((e) => console.warn("[Orchestrator] Demand error:", e.message))
      );
    }

    await Promise.all(promises);

    return results;
  }

  /**
   * Run vision model
   */
  private async runVisionModel(imageUrl: string): Promise<VisionOutput> {
    const visionModel = getVisionModel();

    if (!visionModel.isLoaded()) {
      throw new Error("Vision model not loaded");
    }

    return visionModel.predict({
      image: imageUrl,
      imageType: "url",
    });
  }

  /**
   * Run quality model
   */
  private async runQualityModel(request: AnalysisRequest): Promise<QualityPrediction> {
    const qualityModel = getQualityModel();

    if (!qualityModel.isLoaded()) {
      throw new Error("Quality model not loaded");
    }

    // Prepare input
    const listing: ListingForQuality = {
      listingId: request.listing.id,
      price: request.listing.price,
      title: request.listing.title,
      description: request.listing.description,
      condition: request.listing.condition,
      photoUrls: request.listing.imageUrls,
      sellerId: request.listing.sellerId ?? "unknown",
      sellerFeedbackScore: request.listing.sellerFeedback ?? 99,
      sellerFeedbackCount: request.listing.sellerFeedbackCount ?? 100,
      sellerAccountAgeDays: 365, // Default assumption
      isAuction: false, // Default
    };

    // In production, would fetch actual context
    const context: QualityContext = {
      marketPrice: request.listing.price * 1.1, // Placeholder
      recentSales: [request.listing.price * 0.95, request.listing.price * 1.05],
      hasKnownFakes: false,
      isHighValueCard: request.listing.price > 50,
      isGradedCard: false,
    };

    const features = extractQualityFeatures(listing, context);
    const prediction = await qualityModel.predict(features);

    return {
      ...prediction,
      listingId: request.listing.id,
    };
  }

  /**
   * Run anomaly model
   */
  private async runAnomalyModel(request: AnalysisRequest): Promise<AnomalyPrediction> {
    const anomalyModel = getAnomalyModel();

    if (!anomalyModel.isLoaded()) {
      throw new Error("Anomaly model not loaded");
    }

    // Prepare input
    const listing: ListingForAnomaly = {
      listingId: request.listing.id,
      price: request.listing.price,
      cardId: "unknown", // Would be identified by vision model
      condition: request.listing.condition,
      title: request.listing.title,
      sellerId: request.listing.sellerId,
    };

    // In production, would fetch actual stats
    const stats: MarketStats = {
      medianPrice: request.listing.price * 1.1,
      meanPrice: request.listing.price * 1.1,
      stdPrice: request.listing.price * 0.2,
      recentSales: [request.listing.price * 0.9, request.listing.price * 1.1],
      tcgPrice: request.listing.price * 1.0,
      cmPrice: request.listing.price * 0.95,
      ebayPrice: request.listing.price * 1.1,
      listingsToday: 5,
      sellerListingsToday: 1,
    };

    const features = extractAnomalyFeatures(listing, stats);
    const prediction = await anomalyModel.predict(features);

    return {
      ...prediction,
      listingId: request.listing.id,
    };
  }

  /**
   * Run timing model
   */
  private async runTimingModel(request: AnalysisRequest): Promise<TimingPrediction> {
    const timingModel = getTimingModel();

    if (!timingModel.isLoaded()) {
      throw new Error("Timing model not loaded");
    }

    // Generate placeholder price history
    // In production, would fetch actual data
    const priceHistory = this.generatePlaceholderHistory(request.listing.price, 90);

    return timingModel.predict({
      cardId: "unknown",
      priceHistory,
      forecastDays: 30,
    });
  }

  /**
   * Run demand model
   */
  private async runDemandModel(request: AnalysisRequest): Promise<DemandPrediction> {
    const demandModel = getDemandModel();

    if (!demandModel.isLoaded()) {
      throw new Error("Demand model not loaded");
    }

    // Generate placeholder features
    // In production, would calculate from actual data
    const features = this.generatePlaceholderDemandFeatures(request.listing.price);

    return demandModel.predict(features);
  }

  /**
   * Generate placeholder price history
   */
  private generatePlaceholderHistory(
    currentPrice: number,
    days: number
  ): Array<{ date: Date; price: number; volume?: number }> {
    const history = [];
    const now = new Date();

    for (let i = days; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);

      // Random walk around current price
      const noise = (Math.random() - 0.5) * 0.1;
      const trend = (days - i) / days * 0.05; // Slight uptrend
      const price = currentPrice * (1 + noise + trend - 0.05);

      history.push({
        date,
        price: Math.max(1, price),
        volume: Math.floor(Math.random() * 10) + 1,
      });
    }

    return history;
  }

  /**
   * Generate placeholder demand features
   */
  private generatePlaceholderDemandFeatures(price: number): import("../types").DemandFeatures {
    return {
      priceChange7d: 0.02,
      priceChange30d: 0.05,
      priceChange90d: 0.08,
      priceAcceleration: 0.01,
      priceVs52wHigh: 0.95,
      priceVs52wLow: 1.3,
      pricePercentile90d: 0.7,
      consecutiveUpDays: 2,
      consecutiveDownDays: 0,
      volatility7d: 0.05,
      volatility30d: 0.08,
      volatilityRatio: 0.6,
      rsi14: 55,
      macd: 0.5,
      macdSignal: 0.3,
      sales7d: 15,
      sales30d: 50,
      salesChange7d: 0.1,
      listingsCount: 20,
      listingsChange7d: -0.05,
      daysOfSupply: 10,
      sellThroughRate: 0.3,
      timeToSaleAvg: 3,
      priceDispersion: 0.1,
      bidAskSpread: null,
      rarityEncoded: 3,
      isLeader: false,
      isCharacter: true,
      isEvent: false,
      isStage: false,
      colorEncoded: 0,
      cost: 4,
      power: 5000,
      setAgeDays: 180,
      setTotalValue: 500,
      cardRankInSet: 5,
      isAlternateArt: true,
      tcg100IndexValue: 1000,
      tcg100Change7d: 0.02,
      setIndexValue: 100,
      setIndexChange7d: 0.01,
      marketPhase: "markup",
      daysToNextSet: 45,
      daysSinceLastSet: 60,
      isTournamentLegal: true,
      tournamentPlayRate: 0.15,
      metaRelevanceScore: 0.6,
      socialMentions7d: 20,
      socialSentiment: 0.3,
      youtubeMentions7d: 2,
      searchTrend7d: 0.5,
      tournamentTopCut: 5,
      banWatchScore: 0.1,
      reprintProbability: 0.2,
      crossoverPotential: 0.3,
    };
  }

  /**
   * Generate combined recommendation
   */
  private generateRecommendation(
    results: {
      vision?: VisionOutput;
      demand?: DemandPrediction;
      quality?: QualityPrediction;
      timing?: TimingPrediction;
      anomaly?: AnomalyPrediction;
    },
    request: AnalysisRequest
  ): AnalysisResult["recommendation"] {
    const reasoning: string[] = [];
    const risks: string[] = [];
    const opportunities: string[] = [];

    let actionScore = 0; // Positive = buy, negative = avoid

    // Quality assessment
    if (results.quality) {
      if (results.quality.recommendation === "avoid") {
        actionScore -= 10;
        risks.push(...results.quality.riskFactors.map((r) => r.description));
      } else if (results.quality.recommendation === "caution") {
        actionScore -= 3;
        risks.push("Some quality concerns detected");
      } else {
        actionScore += 2;
        reasoning.push("Listing quality appears legitimate");
      }
    }

    // Anomaly assessment
    if (results.anomaly) {
      if (results.anomaly.anomalyType === "underpriced" && results.anomaly.isAnomaly) {
        actionScore += 5;
        opportunities.push(`Underpriced by ~${(results.anomaly.arbitrageSignal?.estimatedMargin ?? 0) * 100}%`);
      } else if (results.anomaly.anomalyType === "overpriced") {
        actionScore -= 3;
        risks.push("Price appears above market value");
      }
    }

    // Demand forecast
    if (results.demand) {
      if (results.demand.priceMovement === "strong_up" || results.demand.priceMovement === "up") {
        actionScore += 3;
        opportunities.push(`Price predicted to ${results.demand.priceMovement === "strong_up" ? "strongly increase" : "increase"}`);
      } else if (results.demand.priceMovement === "down" || results.demand.priceMovement === "strong_down") {
        actionScore -= 2;
        risks.push("Price predicted to decline");
      }

      if (results.demand.riskScore > 0.5) {
        risks.push(...results.demand.riskFactors.slice(0, 2));
      }
    }

    // Timing assessment
    if (results.timing) {
      if (results.timing.currentTiming.isBuyWindow) {
        actionScore += 2;
        opportunities.push("Currently in favorable buy window");
      } else if (results.timing.currentTiming.daysToNextBuyWindow < 7) {
        reasoning.push(`Better buy window in ${results.timing.currentTiming.daysToNextBuyWindow} days`);
      }
    }

    // Vision assessment
    if (results.vision) {
      if (!results.vision.authenticity.isAuthentic) {
        actionScore -= 10;
        risks.push("Card authenticity concerns from image analysis");
      }
      if (results.vision.condition.confidence > 0.8) {
        reasoning.push(`Condition assessed as ${results.vision.condition.grade}`);
      }
    }

    // Determine action
    let action: "buy" | "sell" | "hold" | "avoid" | "monitor";
    if (actionScore <= -5) {
      action = "avoid";
    } else if (actionScore >= 5) {
      action = "buy";
    } else if (actionScore >= 2) {
      action = "monitor";
    } else if (actionScore <= -2) {
      action = "hold";
    } else {
      action = "monitor";
    }

    // Calculate confidence
    const confidence = Math.min(1, Math.abs(actionScore) / 10);

    return {
      action,
      confidence,
      reasoning,
      risks,
      opportunities,
    };
  }

  /**
   * Identify deal type
   */
  private identifyDeal(
    results: {
      anomaly?: AnomalyPrediction;
      demand?: DemandPrediction;
      timing?: TimingPrediction;
    },
    request: AnalysisRequest
  ): AnalysisResult["deal"] {
    // Arbitrage opportunity
    if (results.anomaly?.arbitrageSignal?.isOpportunity) {
      return {
        type: "arbitrage",
        estimatedReturn: results.anomaly.arbitrageSignal.estimatedMargin,
        timeHorizon: results.anomaly.arbitrageSignal.urgency === "immediate" ? "immediate" : "short",
        riskLevel: results.anomaly.anomalyScore > 0.8 ? "low" : "medium",
      };
    }

    // Speculation opportunity
    if (
      results.demand?.priceMovement === "strong_up" &&
      results.demand.movementProbabilities.strongUp > 0.5
    ) {
      return {
        type: "speculation",
        estimatedReturn: results.demand.expectedReturn.days30,
        timeHorizon: "medium",
        riskLevel: results.demand.riskScore > 0.5 ? "high" : "medium",
      };
    }

    // Timing opportunity
    if (results.timing?.currentTiming.isBuyWindow) {
      return {
        type: "timing",
        estimatedReturn: 0.1, // Seasonal advantage
        timeHorizon: "short",
        riskLevel: "low",
      };
    }

    return {
      type: "none",
      estimatedReturn: 0,
      timeHorizon: "long",
      riskLevel: "low",
    };
  }

  /**
   * Calculate true costs
   */
  private calculateCosts(
    request: AnalysisRequest,
    results: { quality?: QualityPrediction },
    userRegion: Region
  ): AnalysisResult["costAnalysis"] {
    const purchasePrice = request.listing.price;
    const platform = request.listing.platform;
    const currency = request.listing.currency;

    // Determine seller region from platform
    const sellerRegion = this.getSellerRegion(platform);

    // Platform fees
    const platformFeeRate = PLATFORM_FEES[platform]?.seller ?? 0.10;
    const platformFee = purchasePrice * platformFeeRate;

    // Shipping
    const shippingRates = SHIPPING_COSTS[sellerRegion]?.[userRegion];
    const shipping = shippingRates?.tracked ?? 10;

    // Import costs
    const importConfig = IMPORT_CONFIG[userRegion];
    let customs = 0;
    let vat = 0;

    if (sellerRegion !== userRegion && purchasePrice > (importConfig?.dutyFreeThreshold ?? 999999)) {
      // Duty typically 0% on trading cards
      customs = 0;
      // VAT on goods + shipping
      vat = (purchasePrice + shipping) * (importConfig?.vatRate ?? 0);
    }

    // Total acquisition cost
    const estimatedTotalCost = purchasePrice + platformFee + shipping + customs + vat;

    // Estimated sale (assuming 20% markup to cover costs and profit)
    const estimatedNetSale = purchasePrice * 1.2 * (1 - platformFeeRate);

    const estimatedProfit = estimatedNetSale - estimatedTotalCost;

    return {
      purchasePrice,
      estimatedTotalCost,
      estimatedNetSale,
      estimatedProfit,
      costBreakdown: {
        platformFee,
        shipping,
        customs,
        vat,
        other: 0,
      },
    };
  }

  /**
   * Get seller region from platform
   */
  private getSellerRegion(platform: Platform): Region {
    const platformRegions: Record<Platform, Region> = {
      tcgplayer: "US",
      cardmarket: "EU",
      ebay: "US",
      ebay_uk: "UK",
      ebay_de: "EU",
      yahoo_jp: "JP",
      mercari_jp: "JP",
      cardtrader: "EU",
    };

    return platformRegions[platform] ?? "US";
  }

  /**
   * Get status of all models
   */
  getStatus(): {
    orchestratorVersion: string;
    isInitialized: boolean;
    models: Record<string, { loaded: boolean; version: string }>;
  } {
    return {
      orchestratorVersion: MODEL_VERSIONS.orchestrator,
      isInitialized: this.isInitialized,
      models: {
        vision: {
          loaded: getVisionModel().isLoaded(),
          version: MODEL_VERSIONS.vision,
        },
        demand: {
          loaded: getDemandModel().isLoaded(),
          version: MODEL_VERSIONS.demand,
        },
        quality: {
          loaded: getQualityModel().isLoaded(),
          version: MODEL_VERSIONS.quality,
        },
        timing: {
          loaded: getTimingModel().isLoaded(),
          version: MODEL_VERSIONS.timing,
        },
        anomaly: {
          loaded: getAnomalyModel().isLoaded(),
          version: MODEL_VERSIONS.anomaly,
        },
      },
    };
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.analysisCache.clear();
  }
}

// =============================================================================
// SINGLETON INSTANCE
// =============================================================================

let orchestratorInstance: MLOrchestrator | null = null;

export function getOrchestrator(): MLOrchestrator {
  if (!orchestratorInstance) {
    orchestratorInstance = new MLOrchestrator();
  }
  return orchestratorInstance;
}

export function resetOrchestrator(): void {
  if (orchestratorInstance) {
    orchestratorInstance.clearCache();
  }
  orchestratorInstance = null;
}
