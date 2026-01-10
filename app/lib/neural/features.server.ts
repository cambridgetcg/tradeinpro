/**
 * Feature Engineering Pipeline
 *
 * Calculates the 45-feature vector used by the neural network
 * for deal identification and price prediction.
 */

import { Decimal } from "@prisma/client/runtime/library";
import {
  FeatureVector,
  NormalizedFeatures,
  PriceFeatures,
  TemporalFeatures,
  MarketFeatures,
  FxFeatures,
  DerivedFeatures,
  CardWithData,
  SetStatistics,
  GameStatistics,
  FeatureStatistics,
} from "./types";

// Import statistics and correlation services
import type {
  RarityDistribution,
  VolumeStats,
} from "../data-collection/services/statistics.server";
import type { CardCorrelation } from "../data-collection/services/correlation.server";

// =============================================================================
// EXTENDED STATISTICS CONTEXT
// =============================================================================

/**
 * Extended statistics context for feature calculation
 * Includes pre-computed statistics from statistics.server.ts and correlation.server.ts
 */
export interface ExtendedStatisticsContext {
  rarityStats?: Map<string, RarityDistribution>;
  volumeStats?: VolumeStats | null;
  cardCorrelation?: CardCorrelation | null;
  usListingsCount?: number;
  euAvailableItems?: number;
}

// ============================================================================
// FEATURE CALCULATOR
// ============================================================================

/**
 * Calculates the complete feature vector for a card.
 */
export class FeatureCalculator {
  private card: CardWithData;
  private setStats: SetStatistics;
  private gameStats: GameStatistics;
  private extendedStats: ExtendedStatisticsContext;

  constructor(
    card: CardWithData,
    setStats: SetStatistics,
    gameStats: GameStatistics,
    extendedStats?: ExtendedStatisticsContext
  ) {
    this.card = card;
    this.setStats = setStats;
    this.gameStats = gameStats;
    this.extendedStats = extendedStats || {};
  }

  /**
   * Calculate the complete 45-feature vector.
   */
  calculate(): FeatureVector {
    const price = this.calculatePriceFeatures();
    const temporal = this.calculateTemporalFeatures();
    const market = this.calculateMarketFeatures();
    const fx = this.calculateFxFeatures();
    const derived = this.calculateDerivedFeatures(price, temporal, market);

    return { price, temporal, market, fx, derived };
  }

  // ==========================================================================
  // PRICE FEATURES (12)
  // ==========================================================================

  private calculatePriceFeatures(): PriceFeatures {
    const card = this.card.card;

    // Extract prices from different sources
    const optcgPrice = this.toNumber(card.optcgTcgplayerGbp);
    const limitlessPrice = this.toNumber(card.limitlessCardmarketGbp);
    const justtcgPrice = this.toNumber(card.justtcgTcgplayerGbp);
    const bestPrice = this.toNumber(card.bestPriceGbp);

    // Get all valid prices
    const validPrices = [optcgPrice, limitlessPrice, justtcgPrice].filter(
      (p) => p !== null && p > 0
    ) as number[];

    const minPrice = validPrices.length > 0 ? Math.min(...validPrices) : 0;
    const maxPrice = validPrices.length > 0 ? Math.max(...validPrices) : 0;

    // JPY price from sources
    const jpySource = this.card.sources.find((s) => s.priceJpy !== null);
    const currentJpy = jpySource ? this.toNumber(jpySource.priceJpy) : null;

    return {
      current_gbp: bestPrice || 0,
      current_jpy: currentJpy,
      spread_optcg_limitless: this.calculateSpread(optcgPrice, limitlessPrice),
      spread_optcg_justtcg: this.calculateSpread(optcgPrice, justtcgPrice),
      spread_min_max:
        validPrices.length >= 2 ? (maxPrice - minPrice) / minPrice : 0,
      distance_from_best:
        bestPrice && maxPrice > 0 ? (maxPrice - bestPrice) / bestPrice : 0,
      jp_en_gap_pct: this.calculateJpEnGap(currentJpy, bestPrice),
      fx_adjusted_gap: this.calculateFxAdjustedGap(currentJpy, bestPrice),
      tradein_margin: this.calculateTradeinMargin(bestPrice),
      percentile_in_set: this.setStats.pricePercentile(bestPrice || 0),
      percentile_in_rarity: this.calculateRarityPercentile(bestPrice || 0),
      price_to_index_ratio:
        (bestPrice || 0) / (this.gameStats.tcg100AvgPrice || 1),
    };
  }

  // ==========================================================================
  // TEMPORAL FEATURES (15)
  // ==========================================================================

  private calculateTemporalFeatures(): TemporalFeatures {
    const history = this.card.history;
    const prices = history.map((h) => this.toNumber(h.priceGbp) || 0);
    const changes = history.map((h) => this.toNumber(h.change) || 0);

    // Return defaults if insufficient history
    if (prices.length < 7) {
      return this.getDefaultTemporalFeatures();
    }

    // Velocity calculations
    const velocity1d = changes.length > 0 ? changes[changes.length - 1] : 0;
    const velocity7d = this.calculateVelocity(prices, 7);
    const velocity30d = this.calculateVelocity(prices, 30);

    // Acceleration
    const prevVelocity7d =
      prices.length >= 14
        ? this.calculateVelocity(prices.slice(0, -7), 7)
        : velocity7d;
    const acceleration7d = velocity7d - prevVelocity7d;

    // Volatility
    const volatility7d = this.calculateVolatility(prices.slice(-7));
    const volatility30d = this.calculateVolatility(prices.slice(-30));

    // Trend analysis
    const { strength, direction } = this.calculateTrend(prices.slice(-14));

    // Mean reversion
    const mean30d = this.calculateMean(prices.slice(-30));
    const currentPrice = prices[prices.length - 1];
    const meanReversionDistance =
      mean30d > 0 ? (currentPrice - mean30d) / mean30d : 0;

    // High/Low tracking
    const recentPrices = prices.slice(-30);
    const high30d = Math.max(...recentPrices);
    const low30d = Math.min(...recentPrices);
    const daysSinceHigh = this.findDaysSince(recentPrices, high30d);
    const daysSinceLow = this.findDaysSince(recentPrices, low30d);

    return {
      velocity_1d: velocity1d,
      velocity_7d: velocity7d,
      velocity_30d: velocity30d,
      acceleration_7d: acceleration7d,
      volatility_7d: volatility7d,
      volatility_30d: volatility30d,
      volatility_ratio: volatility30d > 0 ? volatility7d / volatility30d : 1,
      trend_strength: strength,
      trend_direction: direction,
      mean_reversion_distance: meanReversionDistance,
      days_since_high: daysSinceHigh,
      days_since_low: daysSinceLow,
      streak_length: this.calculateStreak(changes),
      seasonality_index: this.calculateSeasonality(),
      momentum_rsi: this.calculateRSI(prices, 14),
    };
  }

  private getDefaultTemporalFeatures(): TemporalFeatures {
    return {
      velocity_1d: 0,
      velocity_7d: 0,
      velocity_30d: 0,
      acceleration_7d: 0,
      volatility_7d: 0,
      volatility_30d: 0,
      volatility_ratio: 1,
      trend_strength: 0,
      trend_direction: 0,
      mean_reversion_distance: 0,
      days_since_high: 0,
      days_since_low: 0,
      streak_length: 0,
      seasonality_index: 0,
      momentum_rsi: 50,
    };
  }

  // ==========================================================================
  // MARKET FEATURES (10)
  // ==========================================================================

  private calculateMarketFeatures(): MarketFeatures {
    return {
      set_momentum: this.setStats.momentum7d,
      rarity_momentum: this.calculateRarityMomentum(),
      game_sentiment: this.gameStats.sentiment,
      correlation_to_set: this.calculateCorrelationToSet(),
      correlation_to_rarity: this.calculateCorrelationToRarity(),
      correlation_deviation: this.calculateCorrelationDeviation(),
      liquidity_score: this.estimateLiquidity(),
      volume_relative: this.calculateRelativeVolume(),
      inventory_signal: this.getInventorySignal(),
      market_cap_rank: this.gameStats.getMarketCapRank(this.card.card.cardId),
    };
  }

  // ==========================================================================
  // FX FEATURES (5)
  // ==========================================================================

  private calculateFxFeatures(): FxFeatures {
    const fxHistory = this.card.fx;
    const rates = fxHistory.map((f) => this.toNumber(f.jpyToGbp) || 0.00472);
    const currentRate = rates.length > 0 ? rates[rates.length - 1] : 0.00472;

    return {
      jpy_gbp_current: currentRate,
      fx_velocity_7d: rates.length >= 7 ? this.calculateVelocity(rates, 7) : 0,
      fx_volatility_7d:
        rates.length >= 7 ? this.calculateVolatility(rates.slice(-7)) : 0,
      fx_trend_direction: Math.sign(
        rates.length >= 7 ? this.calculateVelocity(rates, 7) : 0
      ),
      fx_mean_reversion: this.calculateMeanReversion(rates, 30),
    };
  }

  // ==========================================================================
  // DERIVED FEATURES (3)
  // ==========================================================================

  private calculateDerivedFeatures(
    price: PriceFeatures,
    temporal: TemporalFeatures,
    market: MarketFeatures
  ): DerivedFeatures {
    // Opportunity score: combination of arbitrage potential and undervaluation
    const arbitrageSignal = Math.max(
      price.spread_min_max,
      Math.abs(price.jp_en_gap_pct)
    );
    const undervalueSignal = Math.abs(
      Math.min(0, temporal.mean_reversion_distance)
    );
    const momentumSignal = Math.max(0, temporal.velocity_7d);
    const opportunityScore = Math.min(
      1,
      (arbitrageSignal * 0.4 + undervalueSignal * 0.4 + momentumSignal * 0.2) *
        2
    );

    // Risk score: combination of volatility and correlation deviation
    const volatilityRisk = Math.min(1, temporal.volatility_7d * 10);
    const correlationRisk = Math.abs(market.correlation_deviation);
    const liquidityRisk = 1 - market.liquidity_score;
    const riskScore = Math.min(
      1,
      volatilityRisk * 0.4 + correlationRisk * 0.3 + liquidityRisk * 0.3
    );

    // Time sensitivity: how quickly action is needed
    const timeSensitivity = Math.min(
      1,
      arbitrageSignal * 0.6 + Math.abs(temporal.acceleration_7d) * 10 * 0.4
    );

    return {
      opportunity_score: opportunityScore,
      risk_score: riskScore,
      time_sensitivity: timeSensitivity,
    };
  }

  // ==========================================================================
  // HELPER METHODS
  // ==========================================================================

  private toNumber(value: Decimal | null | undefined): number | null {
    if (value === null || value === undefined) return null;
    return value.toNumber();
  }

  private calculateSpread(a: number | null, b: number | null): number {
    if (!a || !b || a === 0) return 0;
    return Math.abs(a - b) / Math.min(a, b);
  }

  private calculateJpEnGap(jpyPrice: number | null, enPrice: number | null): number {
    if (!jpyPrice || !enPrice) return 0;
    const currentFxRate = this.card.fx.length > 0
      ? this.toNumber(this.card.fx[this.card.fx.length - 1].jpyToGbp) || 0.00472
      : 0.00472;
    const jpyInGbp = jpyPrice * currentFxRate;
    return jpyInGbp > 0 ? (enPrice - jpyInGbp) / jpyInGbp : 0;
  }

  private calculateFxAdjustedGap(jpyPrice: number | null, enPrice: number | null): number {
    const rawGap = this.calculateJpEnGap(jpyPrice, enPrice);
    // Adjust for FX trend (if JPY weakening, gap may widen)
    const fxTrend = this.card.fx.length >= 7
      ? this.calculateVelocity(
          this.card.fx.map(f => this.toNumber(f.jpyToGbp) || 0.00472),
          7
        )
      : 0;
    return rawGap + fxTrend * 0.1;
  }

  private calculateTradeinMargin(bestPrice: number | null): number {
    if (!bestPrice) return 0;
    const tradeinPrice = this.toNumber(this.card.card.tradeinPriceGbp);
    if (!tradeinPrice) return 0;
    return (bestPrice - tradeinPrice) / bestPrice;
  }

  private calculateRarityPercentile(price: number): number {
    // Use rarity statistics from extended context if available
    const rarity = this.card.card.rarity || "Unknown";
    const rarityDist = this.extendedStats.rarityStats?.get(rarity);

    if (!rarityDist || price <= 0) {
      return 0.5; // Default to median if no data
    }

    const { percentiles } = rarityDist;
    const thresholds = [
      { p: 0.1, v: percentiles.p10 },
      { p: 0.25, v: percentiles.p25 },
      { p: 0.5, v: percentiles.p50 },
      { p: 0.75, v: percentiles.p75 },
      { p: 0.9, v: percentiles.p90 },
      { p: 0.95, v: percentiles.p95 },
      { p: 0.99, v: percentiles.p99 },
    ];

    // Find where price falls in the distribution
    if (price <= thresholds[0].v) {
      return thresholds[0].p / 2;
    }

    for (let i = 1; i < thresholds.length; i++) {
      if (price <= thresholds[i].v) {
        const prevP = thresholds[i - 1].p;
        const currP = thresholds[i].p;
        const prevV = thresholds[i - 1].v;
        const currV = thresholds[i].v;
        const ratio = currV > prevV ? (price - prevV) / (currV - prevV) : 0.5;
        return prevP + ratio * (currP - prevP);
      }
    }

    return 0.995; // Above p99
  }

  private calculateVelocity(prices: number[], days: number): number {
    const slice = prices.slice(-days);
    if (slice.length < 2) return 0;
    const first = slice[0];
    const last = slice[slice.length - 1];
    return first > 0 ? (last - first) / first / days : 0;
  }

  private calculateVolatility(prices: number[]): number {
    if (prices.length < 2) return 0;
    const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
    const squaredDiffs = prices.map((p) => Math.pow(p - mean, 2));
    return Math.sqrt(
      squaredDiffs.reduce((a, b) => a + b, 0) / prices.length
    );
  }

  private calculateMean(prices: number[]): number {
    return prices.length > 0
      ? prices.reduce((a, b) => a + b, 0) / prices.length
      : 0;
  }

  private calculateTrend(prices: number[]): { strength: number; direction: number } {
    if (prices.length < 3) return { strength: 0, direction: 0 };

    const n = prices.length;
    const xs = Array.from({ length: n }, (_, i) => i);
    const xMean = (n - 1) / 2;
    const yMean = this.calculateMean(prices);

    let numerator = 0;
    let denominator = 0;
    for (let i = 0; i < n; i++) {
      numerator += (xs[i] - xMean) * (prices[i] - yMean);
      denominator += Math.pow(xs[i] - xMean, 2);
    }

    const slope = denominator !== 0 ? numerator / denominator : 0;

    // R² calculation
    const predicted = xs.map((x) => yMean + slope * (x - xMean));
    const ssRes = prices.reduce(
      (sum, y, i) => sum + Math.pow(y - predicted[i], 2),
      0
    );
    const ssTot = prices.reduce((sum, y) => sum + Math.pow(y - yMean, 2), 0);
    const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;

    return {
      strength: r2,
      direction: Math.sign(slope),
    };
  }

  private findDaysSince(prices: number[], targetPrice: number): number {
    for (let i = prices.length - 1; i >= 0; i--) {
      if (prices[i] === targetPrice) {
        return prices.length - 1 - i;
      }
    }
    return prices.length;
  }

  private calculateStreak(changes: number[]): number {
    if (changes.length === 0) return 0;

    let streak = 0;
    const lastDirection = Math.sign(changes[changes.length - 1]);

    for (let i = changes.length - 1; i >= 0; i--) {
      if (Math.sign(changes[i]) === lastDirection) {
        streak++;
      } else {
        break;
      }
    }

    return streak * lastDirection;
  }

  private calculateSeasonality(): number {
    // Use the most recent snapshot date from history, NOT current date
    // This prevents temporal leakage when processing historical data
    const latestHistory = this.card.history[this.card.history.length - 1];
    const snapshotDate = latestHistory?.snapshotDate
      ? new Date(latestHistory.snapshotDate)
      : new Date();

    const dayOfWeek = snapshotDate.getDay();
    // Weekend effect: typically lower activity
    return dayOfWeek === 0 || dayOfWeek === 6 ? -0.1 : 0.1;
  }

  private calculateRSI(prices: number[], period: number): number {
    if (prices.length < period + 1) return 50;

    const changes = prices
      .slice(-period - 1)
      .map((p, i, arr) => (i === 0 ? 0 : p - arr[i - 1]))
      .slice(1);

    const gains = changes.filter((c) => c > 0);
    const losses = changes.filter((c) => c < 0).map(Math.abs);

    const avgGain =
      gains.length > 0 ? gains.reduce((a, b) => a + b, 0) / period : 0;
    const avgLoss =
      losses.length > 0 ? losses.reduce((a, b) => a + b, 0) / period : 0;

    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - 100 / (1 + rs);
  }

  private calculateMeanReversion(values: number[], days: number): number {
    if (values.length < days) return 0;
    const recent = values.slice(-days);
    const mean = this.calculateMean(recent);
    const current = values[values.length - 1];
    return mean > 0 ? (current - mean) / mean : 0;
  }

  // Market features - using pre-computed statistics
  private calculateRarityMomentum(): number {
    // Use rarity statistics from extended context
    const rarity = this.card.card.rarity || "Unknown";
    const rarityDist = this.extendedStats.rarityStats?.get(rarity);

    if (rarityDist?.momentum7d !== null && rarityDist?.momentum7d !== undefined) {
      return rarityDist.momentum7d;
    }

    return 0; // Default when no data available
  }

  private calculateCorrelationToSet(): number {
    // Use cached correlation from correlation service
    const correlation = this.extendedStats.cardCorrelation;

    if (correlation?.correlationToSet !== undefined) {
      return correlation.correlationToSet;
    }

    return 0.7; // Default: most cards correlate moderately with their set
  }

  private calculateCorrelationToRarity(): number {
    // Use cached correlation from correlation service
    const correlation = this.extendedStats.cardCorrelation;

    if (correlation?.correlationToRarity !== undefined) {
      return correlation.correlationToRarity;
    }

    return 0.5; // Default: moderate rarity correlation
  }

  private calculateCorrelationDeviation(): number {
    // Use cached correlation from correlation service
    const correlation = this.extendedStats.cardCorrelation;

    if (correlation?.correlationDeviation !== undefined) {
      return correlation.correlationDeviation;
    }

    return 0.2; // Default: some deviation is normal
  }

  private estimateLiquidity(): number {
    // Combine source coverage with listing counts
    const sourceCount = this.card.sources.filter(
      (s) => s.priceGbp !== null
    ).length;
    const sourceScore = sourceCount / 4;

    // Factor in listings count if available
    const usListings = this.extendedStats.usListingsCount || 0;
    const euListings = this.extendedStats.euAvailableItems || 0;
    const totalListings = usListings + euListings;

    // High listings = high liquidity
    const listingsScore = totalListings > 0 ? Math.min(1, totalListings / 100) : 0;

    // Weighted combination
    return Math.min(1, sourceScore * 0.5 + listingsScore * 0.5);
  }

  private calculateRelativeVolume(): number {
    // Use volume statistics from extended context
    const volumeStats = this.extendedStats.volumeStats;

    if (!volumeStats) {
      return 1; // Default: average volume
    }

    const usListings = this.extendedStats.usListingsCount || 0;
    const euListings = this.extendedStats.euAvailableItems || 0;
    const cardListings = usListings + euListings;

    const avgListings = (volumeStats.avgUsListings || 0) + (volumeStats.avgEuListings || 0);

    if (avgListings <= 0) {
      return 1;
    }

    // Relative volume: card listings / market average
    // Log scale to handle outliers: ln(1 + x) / ln(1 + avg)
    const logCard = Math.log1p(cardListings);
    const logAvg = Math.log1p(avgListings);

    return logAvg > 0 ? logCard / logAvg : 1;
  }

  private getInventorySignal(): number {
    // Inventory signal: how does this card's inventory compare to average?
    // Positive = more listings than average (oversupply)
    // Negative = fewer listings than average (undersupply)
    const volumeStats = this.extendedStats.volumeStats;
    const rarity = this.card.card.rarity || "Unknown";

    if (!volumeStats) {
      return 0; // No signal without data
    }

    const usListings = this.extendedStats.usListingsCount || 0;
    const euListings = this.extendedStats.euAvailableItems || 0;
    const cardListings = usListings + euListings;

    // Use rarity-specific average if available
    const rarityAvg = volumeStats.byRarity?.[rarity]?.avgListings;
    const avgListings = rarityAvg ?? ((volumeStats.avgUsListings || 0) + (volumeStats.avgEuListings || 0));

    if (avgListings <= 0) {
      return 0;
    }

    // Normalize to [-1, 1] range using tanh
    const deviation = (cardListings - avgListings) / avgListings;
    return Math.tanh(deviation);
  }
}

// ============================================================================
// FEATURE NORMALIZER
// ============================================================================

/**
 * Normalizes feature vectors using z-score and min-max scaling.
 */
export class FeatureNormalizer {
  private statistics: FeatureStatistics;

  constructor(trainingData?: FeatureVector[]) {
    if (trainingData && trainingData.length > 0) {
      this.statistics = this.calculateStatistics(trainingData);
    } else {
      this.statistics = this.getDefaultStatistics();
    }
  }

  /**
   * Normalize a feature vector.
   */
  normalize(features: FeatureVector): NormalizedFeatures {
    return {
      price: this.normalizePriceFeatures(features.price),
      temporal: this.normalizeTemporalFeatures(features.temporal),
      market: this.normalizeMarketFeatures(features.market),
      fx: this.normalizeFxFeatures(features.fx),
      derived: this.normalizeDerivedFeatures(features.derived),
    };
  }

  private normalizePriceFeatures(features: PriceFeatures): Record<keyof PriceFeatures, number> {
    const result: Record<string, number> = {};
    for (const [key, value] of Object.entries(features)) {
      const stat = this.statistics.price[key];
      if (stat && stat.std > 0 && value !== null) {
        result[key] = (value - stat.mean) / stat.std;
      } else {
        result[key] = 0;
      }
    }
    return result as Record<keyof PriceFeatures, number>;
  }

  private normalizeTemporalFeatures(features: TemporalFeatures): Record<keyof TemporalFeatures, number> {
    const result: Record<string, number> = {};
    for (const [key, value] of Object.entries(features)) {
      const stat = this.statistics.temporal[key];
      if (stat && stat.std > 0) {
        result[key] = (value - stat.mean) / stat.std;
      } else {
        result[key] = 0;
      }
    }
    return result as Record<keyof TemporalFeatures, number>;
  }

  private normalizeMarketFeatures(features: MarketFeatures): Record<keyof MarketFeatures, number> {
    const result: Record<string, number> = {};
    for (const [key, value] of Object.entries(features)) {
      const stat = this.statistics.market[key];
      if (stat && stat.std > 0) {
        result[key] = (value - stat.mean) / stat.std;
      } else {
        result[key] = 0;
      }
    }
    return result as Record<keyof MarketFeatures, number>;
  }

  private normalizeFxFeatures(features: FxFeatures): Record<keyof FxFeatures, number> {
    const result: Record<string, number> = {};
    for (const [key, value] of Object.entries(features)) {
      const stat = this.statistics.fx[key];
      if (stat && stat.std > 0) {
        result[key] = (value - stat.mean) / stat.std;
      } else {
        result[key] = 0;
      }
    }
    return result as Record<keyof FxFeatures, number>;
  }

  private normalizeDerivedFeatures(features: DerivedFeatures): Record<keyof DerivedFeatures, number> {
    const result: Record<string, number> = {};
    for (const [key, value] of Object.entries(features)) {
      const stat = this.statistics.derived[key];
      if (stat && stat.std > 0) {
        result[key] = (value - stat.mean) / stat.std;
      } else {
        result[key] = 0;
      }
    }
    return result as Record<keyof DerivedFeatures, number>;
  }

  /**
   * Calculate statistics from training data.
   */
  private calculateStatistics(data: FeatureVector[]): FeatureStatistics {
    const stats: FeatureStatistics = {
      price: {},
      temporal: {},
      market: {},
      fx: {},
      derived: {},
    };

    // Helper to calculate stats for a category
    const calcCategoryStats = (
      categoryData: Record<string, number | null>[],
      target: Record<string, { mean: number; std: number; min: number; max: number }>
    ) => {
      if (categoryData.length === 0) return;
      const keys = Object.keys(categoryData[0]);
      for (const key of keys) {
        const values = categoryData
          .map((d) => d[key])
          .filter((v): v is number => v !== null && typeof v === "number");

        if (values.length > 0) {
          const mean = values.reduce((a, b) => a + b, 0) / values.length;
          const std = Math.sqrt(
            values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) /
              values.length
          );
          target[key] = {
            mean,
            std,
            min: Math.min(...values),
            max: Math.max(...values),
          };
        }
      }
    };

    calcCategoryStats(data.map(d => d.price as unknown as Record<string, number | null>), stats.price);
    calcCategoryStats(data.map(d => d.temporal as unknown as Record<string, number | null>), stats.temporal);
    calcCategoryStats(data.map(d => d.market as unknown as Record<string, number | null>), stats.market);
    calcCategoryStats(data.map(d => d.fx as unknown as Record<string, number | null>), stats.fx);
    calcCategoryStats(data.map(d => d.derived as unknown as Record<string, number | null>), stats.derived);

    return stats;
  }

  /**
   * Get default statistics for when no training data is available.
   */
  private getDefaultStatistics(): FeatureStatistics {
    // Default statistics based on expected value ranges
    return {
      price: {
        current_gbp: { mean: 20, std: 30, min: 0, max: 500 },
        current_jpy: { mean: 5000, std: 8000, min: 0, max: 100000 },
        spread_optcg_limitless: { mean: 0.1, std: 0.15, min: 0, max: 1 },
        spread_optcg_justtcg: { mean: 0.1, std: 0.15, min: 0, max: 1 },
        spread_min_max: { mean: 0.15, std: 0.2, min: 0, max: 1 },
        distance_from_best: { mean: 0.1, std: 0.15, min: 0, max: 1 },
        jp_en_gap_pct: { mean: 0, std: 0.3, min: -1, max: 1 },
        fx_adjusted_gap: { mean: 0, std: 0.3, min: -1, max: 1 },
        tradein_margin: { mean: 0.3, std: 0.1, min: 0, max: 1 },
        percentile_in_set: { mean: 0.5, std: 0.3, min: 0, max: 1 },
        percentile_in_rarity: { mean: 0.5, std: 0.3, min: 0, max: 1 },
        price_to_index_ratio: { mean: 1, std: 0.5, min: 0, max: 10 },
      },
      temporal: {
        velocity_1d: { mean: 0, std: 0.05, min: -1, max: 1 },
        velocity_7d: { mean: 0, std: 0.03, min: -0.5, max: 0.5 },
        velocity_30d: { mean: 0, std: 0.02, min: -0.5, max: 0.5 },
        acceleration_7d: { mean: 0, std: 0.02, min: -0.5, max: 0.5 },
        volatility_7d: { mean: 0.1, std: 0.1, min: 0, max: 1 },
        volatility_30d: { mean: 0.1, std: 0.1, min: 0, max: 1 },
        volatility_ratio: { mean: 1, std: 0.5, min: 0, max: 5 },
        trend_strength: { mean: 0.5, std: 0.3, min: 0, max: 1 },
        trend_direction: { mean: 0, std: 0.7, min: -1, max: 1 },
        mean_reversion_distance: { mean: 0, std: 0.2, min: -1, max: 1 },
        days_since_high: { mean: 15, std: 10, min: 0, max: 30 },
        days_since_low: { mean: 15, std: 10, min: 0, max: 30 },
        streak_length: { mean: 0, std: 3, min: -30, max: 30 },
        seasonality_index: { mean: 0, std: 0.1, min: -0.2, max: 0.2 },
        momentum_rsi: { mean: 50, std: 15, min: 0, max: 100 },
      },
      market: {
        set_momentum: { mean: 0, std: 0.05, min: -0.5, max: 0.5 },
        rarity_momentum: { mean: 0, std: 0.05, min: -0.5, max: 0.5 },
        game_sentiment: { mean: 0, std: 0.3, min: -1, max: 1 },
        correlation_to_set: { mean: 0.5, std: 0.3, min: -1, max: 1 },
        correlation_to_rarity: { mean: 0.5, std: 0.3, min: -1, max: 1 },
        correlation_deviation: { mean: 0, std: 0.2, min: -1, max: 1 },
        liquidity_score: { mean: 0.5, std: 0.3, min: 0, max: 1 },
        volume_relative: { mean: 1, std: 0.5, min: 0, max: 5 },
        inventory_signal: { mean: 0, std: 0.3, min: -1, max: 1 },
        market_cap_rank: { mean: 50, std: 30, min: 1, max: 100 },
      },
      fx: {
        jpy_gbp_current: { mean: 0.00472, std: 0.0005, min: 0.003, max: 0.007 },
        fx_velocity_7d: { mean: 0, std: 0.01, min: -0.05, max: 0.05 },
        fx_volatility_7d: { mean: 0.001, std: 0.001, min: 0, max: 0.01 },
        fx_trend_direction: { mean: 0, std: 0.7, min: -1, max: 1 },
        fx_mean_reversion: { mean: 0, std: 0.02, min: -0.1, max: 0.1 },
      },
      derived: {
        opportunity_score: { mean: 0.3, std: 0.2, min: 0, max: 1 },
        risk_score: { mean: 0.3, std: 0.2, min: 0, max: 1 },
        time_sensitivity: { mean: 0.3, std: 0.3, min: 0, max: 1 },
      },
    };
  }

  /**
   * Save statistics for later use.
   */
  getStatistics(): FeatureStatistics {
    return this.statistics;
  }

  /**
   * Load statistics from saved data.
   */
  loadStatistics(stats: FeatureStatistics): void {
    this.statistics = stats;
  }
}

// ============================================================================
// BATCH FEATURE CALCULATION
// ============================================================================

/**
 * Calculate features for multiple cards in batch.
 */
export async function calculateFeaturesInBatch(
  cards: CardWithData[],
  setStatsMap: Map<string, SetStatistics>,
  gameStats: GameStatistics,
  extendedStatsMap?: Map<string, ExtendedStatisticsContext>
): Promise<FeatureVector[]> {
  return cards.map((card) => {
    const setStats = setStatsMap.get(card.card.setCode || "unknown") || {
      setCode: "unknown",
      cardCount: 0,
      avgPrice: 0,
      momentum7d: 0,
      pricePercentile: () => 0.5,
    };
    const extendedStats = extendedStatsMap?.get(card.card.cardId);
    const calculator = new FeatureCalculator(card, setStats, gameStats, extendedStats);
    return calculator.calculate();
  });
}

/**
 * Flatten feature vector to array for neural network input.
 */
export function flattenFeatureVector(features: FeatureVector): number[] {
  return [
    ...Object.values(features.price).map((v) => v ?? 0),
    ...Object.values(features.temporal),
    ...Object.values(features.market),
    ...Object.values(features.fx),
    ...Object.values(features.derived),
  ];
}

/**
 * Get feature names in order (for debugging/explainability).
 */
export function getFeatureNames(): string[] {
  return [
    // Price features (12)
    "price.current_gbp",
    "price.current_jpy",
    "price.spread_optcg_limitless",
    "price.spread_optcg_justtcg",
    "price.spread_min_max",
    "price.distance_from_best",
    "price.jp_en_gap_pct",
    "price.fx_adjusted_gap",
    "price.tradein_margin",
    "price.percentile_in_set",
    "price.percentile_in_rarity",
    "price.price_to_index_ratio",
    // Temporal features (15)
    "temporal.velocity_1d",
    "temporal.velocity_7d",
    "temporal.velocity_30d",
    "temporal.acceleration_7d",
    "temporal.volatility_7d",
    "temporal.volatility_30d",
    "temporal.volatility_ratio",
    "temporal.trend_strength",
    "temporal.trend_direction",
    "temporal.mean_reversion_distance",
    "temporal.days_since_high",
    "temporal.days_since_low",
    "temporal.streak_length",
    "temporal.seasonality_index",
    "temporal.momentum_rsi",
    // Market features (10)
    "market.set_momentum",
    "market.rarity_momentum",
    "market.game_sentiment",
    "market.correlation_to_set",
    "market.correlation_to_rarity",
    "market.correlation_deviation",
    "market.liquidity_score",
    "market.volume_relative",
    "market.inventory_signal",
    "market.market_cap_rank",
    // FX features (5)
    "fx.jpy_gbp_current",
    "fx.fx_velocity_7d",
    "fx.fx_volatility_7d",
    "fx.fx_trend_direction",
    "fx.fx_mean_reversion",
    // Derived features (3)
    "derived.opportunity_score",
    "derived.risk_score",
    "derived.time_sensitivity",
  ];
}
