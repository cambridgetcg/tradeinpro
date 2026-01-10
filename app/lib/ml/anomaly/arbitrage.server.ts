/**
 * Cross-Market Arbitrage Detector
 *
 * Architecture: Rule-Based Engine + Learned Threshold Optimization
 * Purpose: Real-time detection of price discrepancies across platforms
 *
 * Training Status: RULES IMPLEMENTED, THRESHOLDS AWAITING OPTIMIZATION
 * Data Requirements:
 *   - 10M+ cross-market spread observations
 *   - Cost database for all routes
 *
 * @see docs/AI_MODELS_FOR_TCG_ARBITRAGE.md Section 5 - M8
 */

// =============================================================================
// CONFIGURATION
// =============================================================================

export const ARBITRAGE_CONFIG = {
  modelId: "cross-market-arbitrage-detector",
  version: "1.0.0-rules",

  // Supported markets
  markets: {
    US: ["tcgplayer", "ebay_us"],
    UK: ["ebay_uk", "cardtrader"],
    EU: ["cardmarket", "cardtrader"],
    JP: ["yahoo_jp", "mercari_jp"],
  },

  // Platform fee structures
  platformFees: {
    tcgplayer: { seller: 0.1025, buyer: 0, fixed: 0.3 },
    cardmarket: { seller: 0.05, buyer: 0, fixed: 0 },
    ebay_us: { seller: 0.1325, buyer: 0, fixed: 0.3 },
    ebay_uk: { seller: 0.1325, buyer: 0, fixed: 0.3 },
    yahoo_jp: { seller: 0.1, buyer: 0, fixed: 0 },
    mercari_jp: { seller: 0.1, buyer: 0, fixed: 0 },
    cardtrader: { seller: 0.05, buyer: 0, fixed: 0 },
  },

  // Shipping costs (GBP, single card)
  shippingCosts: {
    US_UK: { standard: 5.0, tracked: 15.0 },
    UK_US: { standard: 5.0, tracked: 15.0 },
    EU_UK: { standard: 3.0, tracked: 8.0 },
    UK_EU: { standard: 3.0, tracked: 8.0 },
    JP_UK: { standard: 8.0, tracked: 25.0 },
    UK_JP: { standard: 8.0, tracked: 25.0 },
    JP_US: { standard: 8.0, tracked: 22.0 },
    US_JP: { standard: 8.0, tracked: 22.0 },
    DOMESTIC: { standard: 1.5, tracked: 4.0 },
  },

  // Import thresholds and VAT
  import: {
    UK: { vatRate: 0.2, dutyFreeThreshold: 135 },
    US: { vatRate: 0, dutyFreeThreshold: 800 },
    EU: { vatRate: 0.19, dutyFreeThreshold: 150 },
    JP: { vatRate: 0.1, dutyFreeThreshold: 10000 },
  },

  // Currency conversion fees
  fxFees: {
    bank: 0.03,
    wise: 0.005,
    paypal: 0.04,
  },

  // Detection thresholds (to be optimized via training)
  thresholds: {
    minGrossSpread: 0.15, // 15% minimum gross spread
    minNetSpread: 0.05, // 5% minimum after all costs
    maxSellerRisk: 0.3, // Max acceptable seller risk
    minConfidence: 0.7, // Minimum confidence to report
    minCardValue: 5.0, // Minimum card value (GBP)
  },

  // Urgency classification
  urgency: {
    immediate: { spreadThreshold: 0.25, windowHours: 1 },
    short: { spreadThreshold: 0.15, windowHours: 6 },
    medium: { spreadThreshold: 0.10, windowHours: 24 },
    low: { spreadThreshold: 0.05, windowHours: 72 },
  },
};

// =============================================================================
// TYPES
// =============================================================================

export type Market = "tcgplayer" | "cardmarket" | "ebay_us" | "ebay_uk" | "yahoo_jp" | "mercari_jp" | "cardtrader";
export type Region = "US" | "UK" | "EU" | "JP";

export interface MarketPrice {
  market: Market;
  region: Region;
  price: number;
  currency: "USD" | "GBP" | "EUR" | "JPY";
  priceGBP: number; // Normalized to GBP
  listingUrl?: string;
  sellerId?: string;
  sellerRating?: number;
  condition?: string;
  quantity?: number;
  lastUpdated: Date;
}

export interface ArbitrageInput {
  cardId: string;
  cardName: string;
  prices: MarketPrice[];
  userRegion: Region;
  fxRates: {
    USDGBP: number;
    EURGBP: number;
    JPYGBP: number;
  };
}

export interface CostBreakdown {
  purchasePrice: number;
  platformFeeBuy: number;
  platformFeeSell: number;
  fxFee: number;
  shippingToUser: number;
  shippingToBuyer: number;
  customs: number;
  vat: number;
  totalCost: number;
}

export interface ArbitrageOpportunity {
  cardId: string;
  cardName: string;

  // Buy side
  buyMarket: Market;
  buyRegion: Region;
  buyPrice: number;
  buyPriceGBP: number;
  buyUrl?: string;
  sellerId?: string;
  sellerRating?: number;

  // Sell side
  sellMarket: Market;
  sellRegion: Region;
  sellPrice: number;
  sellPriceGBP: number;

  // Spreads
  grossSpread: number; // Before costs
  netSpread: number; // After all costs
  expectedProfit: number; // Absolute GBP

  // Cost breakdown
  costs: CostBreakdown;

  // Risk and confidence
  confidence: number;
  sellerRiskScore: number;
  riskFactors: string[];

  // Timing
  urgency: "immediate" | "short" | "medium" | "low";
  expiryEstimate: Date;
  detectedAt: Date;

  // Route
  route: string; // e.g., "TCGplayer→CardMarket"
}

export interface ArbitrageOutput {
  cardId: string;
  opportunities: ArbitrageOpportunity[];
  bestOpportunity: ArbitrageOpportunity | null;
  noOpportunityReasons?: string[];
  scanTimestamp: Date;
}

// =============================================================================
// ARBITRAGE DETECTOR SERVICE
// =============================================================================

export class CrossMarketArbitrageDetector {
  readonly name = "Cross-Market Arbitrage Detector";
  readonly version = ARBITRAGE_CONFIG.version;

  private isInitialized: boolean = false;
  private scanCount: number = 0;
  private opportunitiesFound: number = 0;

  constructor() {}

  /**
   * Initialize the detector
   */
  async initialize(): Promise<void> {
    console.log("[Arbitrage] Initializing Cross-Market Arbitrage Detector...");
    console.log("[Arbitrage] Status: RULE-BASED MODE");
    console.log("[Arbitrage] Thresholds pending optimization from historical data");

    await new Promise((resolve) => setTimeout(resolve, 50));

    this.isInitialized = true;
    console.log("[Arbitrage] Detector initialized");
  }

  isLoaded(): boolean {
    return this.isInitialized;
  }

  /**
   * Detect arbitrage opportunities for a card
   */
  async detectOpportunities(input: ArbitrageInput): Promise<ArbitrageOutput> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    this.scanCount++;
    const opportunities: ArbitrageOpportunity[] = [];
    const noOpportunityReasons: string[] = [];

    // Need at least 2 markets
    if (input.prices.length < 2) {
      return {
        cardId: input.cardId,
        opportunities: [],
        bestOpportunity: null,
        noOpportunityReasons: ["Need prices from at least 2 markets"],
        scanTimestamp: new Date(),
      };
    }

    // Sort prices by GBP value (lowest first for buying)
    const sortedPrices = [...input.prices].sort((a, b) => a.priceGBP - b.priceGBP);

    // Check each buy-sell pair
    for (let i = 0; i < sortedPrices.length; i++) {
      const buyPrice = sortedPrices[i];

      // Skip low-value cards
      if (buyPrice.priceGBP < ARBITRAGE_CONFIG.thresholds.minCardValue) {
        continue;
      }

      for (let j = sortedPrices.length - 1; j > i; j--) {
        const sellPrice = sortedPrices[j];

        // Calculate gross spread
        const grossSpread = (sellPrice.priceGBP - buyPrice.priceGBP) / buyPrice.priceGBP;

        // Skip if gross spread too low
        if (grossSpread < ARBITRAGE_CONFIG.thresholds.minGrossSpread) {
          continue;
        }

        // Calculate full cost breakdown
        const costs = this.calculateCosts(
          buyPrice,
          sellPrice,
          input.userRegion,
          input.fxRates
        );

        // Calculate net spread
        const netRevenue = sellPrice.priceGBP - costs.platformFeeSell - costs.shippingToBuyer;
        const netCost = costs.totalCost;
        const netProfit = netRevenue - netCost;
        const netSpread = netProfit / netCost;

        // Skip if net spread too low
        if (netSpread < ARBITRAGE_CONFIG.thresholds.minNetSpread) {
          noOpportunityReasons.push(
            `${buyPrice.market}→${sellPrice.market}: Net spread ${(netSpread * 100).toFixed(1)}% below threshold`
          );
          continue;
        }

        // Assess seller risk
        const sellerRisk = this.assessSellerRisk(buyPrice);
        if (sellerRisk > ARBITRAGE_CONFIG.thresholds.maxSellerRisk) {
          noOpportunityReasons.push(
            `${buyPrice.market}→${sellPrice.market}: Seller risk ${(sellerRisk * 100).toFixed(0)}% too high`
          );
          continue;
        }

        // Determine urgency
        const urgency = this.classifyUrgency(grossSpread, netSpread);

        // Create opportunity
        const opportunity: ArbitrageOpportunity = {
          cardId: input.cardId,
          cardName: input.cardName,

          buyMarket: buyPrice.market,
          buyRegion: buyPrice.region,
          buyPrice: buyPrice.price,
          buyPriceGBP: buyPrice.priceGBP,
          buyUrl: buyPrice.listingUrl,
          sellerId: buyPrice.sellerId,
          sellerRating: buyPrice.sellerRating,

          sellMarket: sellPrice.market,
          sellRegion: sellPrice.region,
          sellPrice: sellPrice.price,
          sellPriceGBP: sellPrice.priceGBP,

          grossSpread,
          netSpread,
          expectedProfit: netProfit,

          costs,

          confidence: this.calculateConfidence(grossSpread, netSpread, sellerRisk),
          sellerRiskScore: sellerRisk,
          riskFactors: this.identifyRiskFactors(buyPrice, sellPrice, costs),

          urgency,
          expiryEstimate: this.estimateExpiry(urgency),
          detectedAt: new Date(),

          route: `${buyPrice.market}→${sellPrice.market}`,
        };

        opportunities.push(opportunity);
        this.opportunitiesFound++;
      }
    }

    // Sort by net spread (best first)
    opportunities.sort((a, b) => b.netSpread - a.netSpread);

    return {
      cardId: input.cardId,
      opportunities,
      bestOpportunity: opportunities[0] ?? null,
      noOpportunityReasons: opportunities.length === 0 ? noOpportunityReasons : undefined,
      scanTimestamp: new Date(),
    };
  }

  /**
   * Calculate full cost breakdown
   */
  private calculateCosts(
    buyPrice: MarketPrice,
    sellPrice: MarketPrice,
    userRegion: Region,
    fxRates: ArbitrageInput["fxRates"]
  ): CostBreakdown {
    // Platform fees
    const buyFees = ARBITRAGE_CONFIG.platformFees[buyPrice.market] ?? { seller: 0, buyer: 0 };
    const sellFees = ARBITRAGE_CONFIG.platformFees[sellPrice.market] ?? { seller: 0, buyer: 0 };

    const platformFeeBuy = buyPrice.priceGBP * buyFees.buyer;
    const platformFeeSell = sellPrice.priceGBP * sellFees.seller + (sellFees.fixed ?? 0);

    // FX fee (if cross-currency)
    let fxFee = 0;
    if (buyPrice.currency !== "GBP") {
      fxFee = buyPrice.priceGBP * ARBITRAGE_CONFIG.fxFees.wise; // Assume Wise
    }

    // Shipping: buy market → user
    const shippingRoute1 = `${buyPrice.region}_${userRegion}`;
    const shipping1 =
      ARBITRAGE_CONFIG.shippingCosts[shippingRoute1 as keyof typeof ARBITRAGE_CONFIG.shippingCosts] ??
      ARBITRAGE_CONFIG.shippingCosts.DOMESTIC;
    const shippingToUser = buyPrice.priceGBP > 50 ? shipping1.tracked : shipping1.standard;

    // Shipping: user → sell market
    const shippingRoute2 = `${userRegion}_${sellPrice.region}`;
    const shipping2 =
      ARBITRAGE_CONFIG.shippingCosts[shippingRoute2 as keyof typeof ARBITRAGE_CONFIG.shippingCosts] ??
      ARBITRAGE_CONFIG.shippingCosts.DOMESTIC;
    const shippingToBuyer = sellPrice.priceGBP > 50 ? shipping2.tracked : shipping2.standard;

    // Customs & VAT (if importing to user's region)
    let customs = 0;
    let vat = 0;

    if (buyPrice.region !== userRegion) {
      const importRules = ARBITRAGE_CONFIG.import[userRegion];
      if (buyPrice.priceGBP + shippingToUser > importRules.dutyFreeThreshold) {
        // No duty on trading cards (HS code 9504), but VAT applies
        vat = (buyPrice.priceGBP + shippingToUser) * importRules.vatRate;
      }
    }

    const totalCost =
      buyPrice.priceGBP +
      platformFeeBuy +
      fxFee +
      shippingToUser +
      customs +
      vat;

    return {
      purchasePrice: buyPrice.priceGBP,
      platformFeeBuy,
      platformFeeSell,
      fxFee,
      shippingToUser,
      shippingToBuyer,
      customs,
      vat,
      totalCost,
    };
  }

  /**
   * Assess seller risk
   */
  private assessSellerRisk(price: MarketPrice): number {
    // Base risk on seller rating
    if (!price.sellerRating) {
      return 0.3; // Unknown = medium risk
    }

    // Convert rating to risk (higher rating = lower risk)
    const ratingRisk = 1 - price.sellerRating / 100;

    // Platform trust factor
    const platformTrust: Record<Market, number> = {
      tcgplayer: 0.9,
      cardmarket: 0.9,
      ebay_us: 0.8,
      ebay_uk: 0.8,
      cardtrader: 0.85,
      yahoo_jp: 0.75,
      mercari_jp: 0.7,
    };
    const trustFactor = platformTrust[price.market] ?? 0.7;

    return ratingRisk * (2 - trustFactor);
  }

  /**
   * Classify opportunity urgency
   */
  private classifyUrgency(
    grossSpread: number,
    netSpread: number
  ): "immediate" | "short" | "medium" | "low" {
    const config = ARBITRAGE_CONFIG.urgency;

    if (grossSpread >= config.immediate.spreadThreshold) return "immediate";
    if (grossSpread >= config.short.spreadThreshold) return "short";
    if (grossSpread >= config.medium.spreadThreshold) return "medium";
    return "low";
  }

  /**
   * Calculate confidence score
   */
  private calculateConfidence(
    grossSpread: number,
    netSpread: number,
    sellerRisk: number
  ): number {
    // Higher spread = higher confidence
    const spreadConfidence = Math.min(1, netSpread / 0.2);

    // Lower seller risk = higher confidence
    const riskConfidence = 1 - sellerRisk;

    // Combine
    return spreadConfidence * 0.6 + riskConfidence * 0.4;
  }

  /**
   * Identify risk factors
   */
  private identifyRiskFactors(
    buyPrice: MarketPrice,
    sellPrice: MarketPrice,
    costs: CostBreakdown
  ): string[] {
    const risks: string[] = [];

    // Cross-currency risk
    if (buyPrice.currency !== "GBP" || sellPrice.currency !== "GBP") {
      risks.push("Currency fluctuation exposure");
    }

    // International shipping risk
    if (buyPrice.region !== sellPrice.region) {
      risks.push("International shipping delays possible");
    }

    // High VAT exposure
    if (costs.vat > 0) {
      risks.push(`VAT adds £${costs.vat.toFixed(2)} to cost`);
    }

    // Condition uncertainty
    if (!buyPrice.condition) {
      risks.push("Condition not specified - may vary");
    }

    // Seller reliability
    if (!buyPrice.sellerRating || buyPrice.sellerRating < 95) {
      risks.push("Seller reliability unverified");
    }

    return risks;
  }

  /**
   * Estimate opportunity expiry
   */
  private estimateExpiry(urgency: "immediate" | "short" | "medium" | "low"): Date {
    const config = ARBITRAGE_CONFIG.urgency;
    const hours = config[urgency].windowHours;

    const expiry = new Date();
    expiry.setHours(expiry.getHours() + hours);
    return expiry;
  }

  /**
   * Batch scan multiple cards
   */
  async scanBatch(inputs: ArbitrageInput[]): Promise<ArbitrageOutput[]> {
    return Promise.all(inputs.map((input) => this.detectOpportunities(input)));
  }

  /**
   * Get detector stats
   */
  getStats(): {
    scanCount: number;
    opportunitiesFound: number;
    version: string;
  } {
    return {
      scanCount: this.scanCount,
      opportunitiesFound: this.opportunitiesFound,
      version: this.version,
    };
  }
}

// =============================================================================
// SINGLETON INSTANCE
// =============================================================================

let arbitrageInstance: CrossMarketArbitrageDetector | null = null;

export function getCrossMarketArbitrageDetector(): CrossMarketArbitrageDetector {
  if (!arbitrageInstance) {
    arbitrageInstance = new CrossMarketArbitrageDetector();
  }
  return arbitrageInstance;
}

export function resetCrossMarketArbitrageDetector(): void {
  arbitrageInstance = null;
}

// =============================================================================
// TRAINING DATA SCHEMA (For Threshold Optimization)
// =============================================================================

export interface ArbitrageTrainingExample {
  spreadId: string;
  timestamp: Date;

  // Observed spread
  cardId: string;
  buyMarket: Market;
  sellMarket: Market;
  grossSpread: number;
  netSpread: number;

  // Outcome
  wasActionable: boolean;
  spreadDurationHours: number;
  wasExecuted: boolean;
  actualProfit?: number;
  failureReason?: string;
}

export interface ArbitrageTrainingStats {
  totalObservations: number;
  actionableRate: number;
  avgSpreadDuration: number;
  profitableRate: number;
  avgProfit: number;
  routeDistribution: Record<string, number>;
  lastUpdated: Date;
}

export function optimizeThresholds(
  trainingData: ArbitrageTrainingExample[]
): typeof ARBITRAGE_CONFIG.thresholds {
  // TODO: Implement threshold optimization using historical data
  // - Find optimal minNetSpread that maximizes profit while filtering noise
  // - Find optimal confidence threshold for each route
  // - Learn urgency classification boundaries

  console.log("[Arbitrage] Threshold optimization not yet implemented");
  console.log(`[Arbitrage] Would optimize using ${trainingData.length} examples`);

  return ARBITRAGE_CONFIG.thresholds;
}
