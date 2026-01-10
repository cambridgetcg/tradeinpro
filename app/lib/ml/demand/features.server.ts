/**
 * Demand Forecasting Feature Extractor
 *
 * Extracts 55 features for predicting card price movements.
 */

import { BaseFeatureExtractor } from "../base.server";
import {
  calculateRSI,
  calculateMACD,
  standardDeviation,
  percentChange,
  percentileRank,
} from "../base.server";
import { DEMAND_FEATURE_CONFIG } from "../config";
import type { DemandFeatures, MarketPhase, CardIdentifier } from "../types";

// =============================================================================
// RAW DATA TYPES
// =============================================================================

export interface CardPriceHistory {
  cardId: string;
  prices: Array<{
    date: Date;
    price: number;
    volume?: number;
    listingsCount?: number;
  }>;
}

export interface CardMetadata {
  cardId: string;
  name: string;
  setCode: string;
  rarity: string;
  cardType: "leader" | "character" | "event" | "stage";
  color: string;
  cost: number;
  power: number | null;
  releaseDate: Date;
  isAlternateArt: boolean;
  isTournamentLegal: boolean;
}

export interface MarketContext {
  tcg100Value: number;
  tcg100Change7d: number;
  marketPhase: MarketPhase;
  nextSetDays: number;
  lastSetDays: number;
}

export interface ExternalSignals {
  socialMentions7d: number;
  socialSentiment: number;
  youtubeMentions7d: number;
  searchTrend7d: number;
  tournamentTopCut: number;
  tournamentPlayRate: number;
  banWatchScore: number;
  reprintProbability: number;
  crossoverPotential: number;
}

export interface DemandRawData {
  priceHistory: CardPriceHistory;
  metadata: CardMetadata;
  marketContext: MarketContext;
  signals: ExternalSignals;
  setTotalValue?: number;
  cardRankInSet?: number;
}

// =============================================================================
// FEATURE EXTRACTOR
// =============================================================================

export class DemandFeatureExtractor extends BaseFeatureExtractor<DemandRawData, DemandFeatures> {
  constructor() {
    super();
    this._featureNames = [
      // Price momentum (15)
      "priceChange7d",
      "priceChange30d",
      "priceChange90d",
      "priceAcceleration",
      "priceVs52wHigh",
      "priceVs52wLow",
      "pricePercentile90d",
      "consecutiveUpDays",
      "consecutiveDownDays",
      "volatility7d",
      "volatility30d",
      "volatilityRatio",
      "rsi14",
      "macd",
      "macdSignal",
      // Volume (10)
      "sales7d",
      "sales30d",
      "salesChange7d",
      "listingsCount",
      "listingsChange7d",
      "daysOfSupply",
      "sellThroughRate",
      "timeToSaleAvg",
      "priceDispersion",
      "bidAskSpread",
      // Card characteristics (12)
      "rarityEncoded",
      "isLeader",
      "isCharacter",
      "isEvent",
      "isStage",
      "colorEncoded",
      "cost",
      "power",
      "setAgeDays",
      "setTotalValue",
      "cardRankInSet",
      "isAlternateArt",
      // Market context (10)
      "tcg100IndexValue",
      "tcg100Change7d",
      "setIndexValue",
      "setIndexChange7d",
      "marketPhase",
      "daysToNextSet",
      "daysSinceLastSet",
      "isTournamentLegal",
      "tournamentPlayRate",
      "metaRelevanceScore",
      // External signals (8)
      "socialMentions7d",
      "socialSentiment",
      "youtubeMentions7d",
      "searchTrend7d",
      "tournamentTopCut",
      "banWatchScore",
      "reprintProbability",
      "crossoverPotential",
    ];
  }

  /**
   * Extract all features from raw data
   */
  async extract(raw: DemandRawData): Promise<DemandFeatures> {
    const priceFeatures = this.extractPriceFeatures(raw.priceHistory);
    const volumeFeatures = this.extractVolumeFeatures(raw.priceHistory);
    const cardFeatures = this.extractCardFeatures(raw.metadata, raw.setTotalValue, raw.cardRankInSet);
    const marketFeatures = this.extractMarketFeatures(raw.marketContext, raw.metadata);
    const signalFeatures = this.extractSignalFeatures(raw.signals);

    return {
      ...priceFeatures,
      ...volumeFeatures,
      ...cardFeatures,
      ...marketFeatures,
      ...signalFeatures,
    };
  }

  /**
   * Extract price momentum features (15 features)
   */
  private extractPriceFeatures(history: CardPriceHistory): Pick<
    DemandFeatures,
    | "priceChange7d"
    | "priceChange30d"
    | "priceChange90d"
    | "priceAcceleration"
    | "priceVs52wHigh"
    | "priceVs52wLow"
    | "pricePercentile90d"
    | "consecutiveUpDays"
    | "consecutiveDownDays"
    | "volatility7d"
    | "volatility30d"
    | "volatilityRatio"
    | "rsi14"
    | "macd"
    | "macdSignal"
  > {
    const prices = history.prices.map((p) => p.price);
    const sortedPrices = [...prices].sort((a, b) => a - b);

    const currentPrice = prices[prices.length - 1] || 0;
    const price7dAgo = prices[prices.length - 8] || currentPrice;
    const price30dAgo = prices[prices.length - 31] || currentPrice;
    const price90dAgo = prices[prices.length - 91] || currentPrice;

    // Price changes
    const priceChange7d = percentChange(currentPrice, price7dAgo);
    const priceChange30d = percentChange(currentPrice, price30dAgo);
    const priceChange90d = percentChange(currentPrice, price90dAgo);

    // Acceleration (change in momentum)
    const prevChange7d = prices.length > 14
      ? percentChange(price7dAgo, prices[prices.length - 15] || price7dAgo)
      : 0;
    const priceAcceleration = priceChange7d - prevChange7d;

    // 52-week high/low
    const yearPrices = prices.slice(-365);
    const high52w = Math.max(...yearPrices);
    const low52w = Math.min(...yearPrices);
    const priceVs52wHigh = high52w > 0 ? currentPrice / high52w : 1;
    const priceVs52wLow = low52w > 0 ? currentPrice / low52w : 1;

    // Percentile in 90-day range
    const recent90d = prices.slice(-90);
    const sorted90d = [...recent90d].sort((a, b) => a - b);
    const pricePercentile90d = percentileRank(currentPrice, sorted90d);

    // Consecutive up/down days
    let consecutiveUpDays = 0;
    let consecutiveDownDays = 0;
    for (let i = prices.length - 1; i > 0; i--) {
      if (prices[i] > prices[i - 1]) {
        if (consecutiveDownDays === 0) consecutiveUpDays++;
        else break;
      } else if (prices[i] < prices[i - 1]) {
        if (consecutiveUpDays === 0) consecutiveDownDays++;
        else break;
      } else {
        break;
      }
    }

    // Volatility
    const volatility7d = standardDeviation(prices.slice(-7));
    const volatility30d = standardDeviation(prices.slice(-30));
    const volatilityRatio = volatility30d > 0 ? volatility7d / volatility30d : 1;

    // Technical indicators
    const rsi14 = calculateRSI(prices, 14);
    const macdResult = calculateMACD(prices);

    return {
      priceChange7d,
      priceChange30d,
      priceChange90d,
      priceAcceleration,
      priceVs52wHigh,
      priceVs52wLow,
      pricePercentile90d,
      consecutiveUpDays,
      consecutiveDownDays,
      volatility7d,
      volatility30d,
      volatilityRatio,
      rsi14,
      macd: macdResult.macd,
      macdSignal: macdResult.signal,
    };
  }

  /**
   * Extract volume/liquidity features (10 features)
   */
  private extractVolumeFeatures(history: CardPriceHistory): Pick<
    DemandFeatures,
    | "sales7d"
    | "sales30d"
    | "salesChange7d"
    | "listingsCount"
    | "listingsChange7d"
    | "daysOfSupply"
    | "sellThroughRate"
    | "timeToSaleAvg"
    | "priceDispersion"
    | "bidAskSpread"
  > {
    const recent7d = history.prices.slice(-7);
    const recent30d = history.prices.slice(-30);
    const prev7d = history.prices.slice(-14, -7);

    // Sales volume
    const sales7d = recent7d.reduce((sum, p) => sum + (p.volume || 0), 0);
    const sales30d = recent30d.reduce((sum, p) => sum + (p.volume || 0), 0);
    const prevSales7d = prev7d.reduce((sum, p) => sum + (p.volume || 0), 0);
    const salesChange7d = prevSales7d > 0 ? percentChange(sales7d, prevSales7d) : 0;

    // Listings
    const latestListings = history.prices[history.prices.length - 1]?.listingsCount || 0;
    const prev7dListings = history.prices[history.prices.length - 8]?.listingsCount || latestListings;
    const listingsCount = latestListings;
    const listingsChange7d = prev7dListings > 0 ? percentChange(latestListings, prev7dListings) : 0;

    // Days of supply
    const dailySales = sales7d / 7;
    const daysOfSupply = dailySales > 0 ? listingsCount / dailySales : 999;

    // Sell-through rate (simplified)
    const sellThroughRate = listingsCount > 0 ? Math.min(1, sales7d / listingsCount) : 0;

    // Time to sale (placeholder - would need actual listing data)
    const timeToSaleAvg = 3; // Default 3 days

    // Price dispersion
    const prices = history.prices.slice(-30).map((p) => p.price);
    const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
    const priceDispersion = avgPrice > 0 ? standardDeviation(prices) / avgPrice : 0;

    // Bid-ask spread (not available in most cases)
    const bidAskSpread = null;

    return {
      sales7d,
      sales30d,
      salesChange7d,
      listingsCount,
      listingsChange7d,
      daysOfSupply,
      sellThroughRate,
      timeToSaleAvg,
      priceDispersion,
      bidAskSpread,
    };
  }

  /**
   * Extract card characteristic features (12 features)
   */
  private extractCardFeatures(
    metadata: CardMetadata,
    setTotalValue?: number,
    cardRankInSet?: number
  ): Pick<
    DemandFeatures,
    | "rarityEncoded"
    | "isLeader"
    | "isCharacter"
    | "isEvent"
    | "isStage"
    | "colorEncoded"
    | "cost"
    | "power"
    | "setAgeDays"
    | "setTotalValue"
    | "cardRankInSet"
    | "isAlternateArt"
  > {
    // Encode rarity
    const rarityMap: Record<string, number> = {
      C: 0,
      UC: 1,
      R: 2,
      SR: 3,
      SEC: 4,
      L: 5,
      SP: 6,
    };
    const rarityEncoded = rarityMap[metadata.rarity.toUpperCase()] ?? 2;

    // Card type booleans
    const isLeader = metadata.cardType === "leader";
    const isCharacter = metadata.cardType === "character";
    const isEvent = metadata.cardType === "event";
    const isStage = metadata.cardType === "stage";

    // Encode color
    const colorMap: Record<string, number> = {
      red: 0,
      green: 1,
      blue: 2,
      purple: 3,
      black: 4,
      yellow: 5,
      multi: 6,
    };
    const colorEncoded = colorMap[metadata.color.toLowerCase()] ?? 0;

    // Set age
    const setAgeDays = Math.floor(
      (Date.now() - metadata.releaseDate.getTime()) / (1000 * 60 * 60 * 24)
    );

    return {
      rarityEncoded,
      isLeader,
      isCharacter,
      isEvent,
      isStage,
      colorEncoded,
      cost: metadata.cost,
      power: metadata.power,
      setAgeDays,
      setTotalValue: setTotalValue || 0,
      cardRankInSet: cardRankInSet || 0,
      isAlternateArt: metadata.isAlternateArt,
    };
  }

  /**
   * Extract market context features (10 features)
   */
  private extractMarketFeatures(
    context: MarketContext,
    metadata: CardMetadata
  ): Pick<
    DemandFeatures,
    | "tcg100IndexValue"
    | "tcg100Change7d"
    | "setIndexValue"
    | "setIndexChange7d"
    | "marketPhase"
    | "daysToNextSet"
    | "daysSinceLastSet"
    | "isTournamentLegal"
    | "tournamentPlayRate"
    | "metaRelevanceScore"
  > {
    return {
      tcg100IndexValue: context.tcg100Value,
      tcg100Change7d: context.tcg100Change7d,
      setIndexValue: 0, // Would calculate from set data
      setIndexChange7d: 0,
      marketPhase: context.marketPhase,
      daysToNextSet: context.nextSetDays,
      daysSinceLastSet: context.lastSetDays,
      isTournamentLegal: metadata.isTournamentLegal,
      tournamentPlayRate: 0, // Would get from tournament data
      metaRelevanceScore: 0,
    };
  }

  /**
   * Extract external signal features (8 features)
   */
  private extractSignalFeatures(signals: ExternalSignals): Pick<
    DemandFeatures,
    | "socialMentions7d"
    | "socialSentiment"
    | "youtubeMentions7d"
    | "searchTrend7d"
    | "tournamentTopCut"
    | "banWatchScore"
    | "reprintProbability"
    | "crossoverPotential"
  > {
    return {
      socialMentions7d: signals.socialMentions7d,
      socialSentiment: signals.socialSentiment,
      youtubeMentions7d: signals.youtubeMentions7d,
      searchTrend7d: signals.searchTrend7d,
      tournamentTopCut: signals.tournamentTopCut,
      banWatchScore: signals.banWatchScore,
      reprintProbability: signals.reprintProbability,
      crossoverPotential: signals.crossoverPotential,
    };
  }

  /**
   * Normalize features for model input
   */
  normalize(features: DemandFeatures): DemandFeatures {
    // In production, this would use stored normalization parameters
    // (mean, std) from training data
    return {
      ...features,
      // Clip extreme values
      priceChange7d: Math.max(-1, Math.min(1, features.priceChange7d)),
      priceChange30d: Math.max(-1, Math.min(1, features.priceChange30d)),
      priceChange90d: Math.max(-2, Math.min(2, features.priceChange90d)),
      volatility7d: Math.min(1, features.volatility7d),
      volatility30d: Math.min(1, features.volatility30d),
      rsi14: features.rsi14 / 100, // Normalize to 0-1
      socialSentiment: (features.socialSentiment + 1) / 2, // Normalize -1,1 to 0,1
    };
  }
}

// =============================================================================
// SINGLETON INSTANCE
// =============================================================================

let featureExtractorInstance: DemandFeatureExtractor | null = null;

export function getDemandFeatureExtractor(): DemandFeatureExtractor {
  if (!featureExtractorInstance) {
    featureExtractorInstance = new DemandFeatureExtractor();
  }
  return featureExtractorInstance;
}
