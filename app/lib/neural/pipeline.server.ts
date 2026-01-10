/**
 * Deal Detection Pipeline
 *
 * Orchestrates the neural network and rule-based detectors
 * to identify market opportunities.
 */

import { getShardClient, GameShard } from "../shard.server";
import {
  DetectedDeal,
  DealType,
  DealAction,
  CardWithData,
  FeatureVector,
  PipelineConfig,
  PipelineResult,
  SetStatistics,
  GameStatistics,
  DEAL_EXPIRY_HOURS,
  TimeHorizon,
} from "./types";
import {
  FeatureCalculator,
  FeatureNormalizer,
  calculateFeaturesInBatch,
  type ExtendedStatisticsContext,
} from "./features.server";
import {
  getRarityStatistics,
  getVolumeStatistics,
} from "../data-collection/services/statistics.server";
import { getCardCorrelation } from "../data-collection/services/correlation.server";
import { NeuralModelService } from "./model.server";
import { PipelineCache, getPipelineCache } from "./cache.server";

// ============================================================================
// RULE-BASED DETECTOR INTERFACE
// ============================================================================

/**
 * Interface for rule-based deal detectors.
 */
export interface RuleBasedDetector {
  /** Detector name for logging */
  name: string;
  /** Detect deals for a card */
  detect(
    card: CardWithData,
    features: FeatureVector
  ): Promise<DetectedDeal | null>;
}

// ============================================================================
// RULE-BASED DETECTORS
// ============================================================================

/**
 * Detects cross-market arbitrage opportunities.
 */
export class CrossMarketArbitrageDetector implements RuleBasedDetector {
  name = "CrossMarketArbitrage";

  async detect(
    card: CardWithData,
    features: FeatureVector
  ): Promise<DetectedDeal | null> {
    const { price } = features;

    // Need significant spread (>15%)
    if (price.spread_min_max < 0.15) return null;

    // Calculate net profit after fees
    const buyFee = 0.1; // 10% buyer fee
    const sellFee = 0.13; // 13% seller fee
    const netSpread = price.spread_min_max - buyFee - sellFee;

    if (netSpread < 0.05) return null; // Minimum 5% net profit

    // Determine buy/sell markets
    const prices = {
      optcg: card.card.optcgTcgplayerGbp?.toNumber() || Infinity,
      limitless: card.card.limitlessCardmarketGbp?.toNumber() || Infinity,
      justtcg: card.card.justtcgTcgplayerGbp?.toNumber() || Infinity,
    };

    const validPrices = Object.entries(prices).filter(
      ([, v]) => v !== Infinity && v > 0
    );
    if (validPrices.length < 2) return null;

    const minEntry = validPrices.reduce((a, b) => (a[1] < b[1] ? a : b));
    const maxEntry = validPrices.reduce((a, b) => (a[1] > b[1] ? a : b));

    return {
      cardId: card.card.cardId,
      cardName: card.card.name,
      dealType: "ARBITRAGE_CROSS_MARKET",
      confidence: Math.min(0.95, 0.5 + netSpread),
      expectedReturn: netSpread * 100,
      riskLevel: netSpread > 0.15 ? "LOW" : "MEDIUM",
      timeHorizon: "IMMEDIATE",
      action: {
        type: "BUY_SELL",
        buyMarket: this.mapMarket(minEntry[0]),
        buyPrice: minEntry[1],
        sellMarket: this.mapMarket(maxEntry[0]),
        sellPrice: maxEntry[1],
      },
      metadata: {
        spread: price.spread_min_max,
        netSpread,
        pricesByMarket: prices,
      },
      source: "rule",
      expiresAt: this.calculateExpiry("ARBITRAGE_CROSS_MARKET"),
    };
  }

  private mapMarket(key: string): string {
    const markets: Record<string, string> = {
      optcg: "TCGplayer",
      limitless: "CardMarket",
      justtcg: "JustTCG",
    };
    return markets[key] || key;
  }

  private calculateExpiry(dealType: DealType): Date {
    const hours = DEAL_EXPIRY_HOURS[dealType] || 24;
    return new Date(Date.now() + hours * 60 * 60 * 1000);
  }
}

/**
 * Detects statistically undervalued cards.
 */
export class StatisticalUndervalueDetector implements RuleBasedDetector {
  name = "StatisticalUndervalue";

  async detect(
    card: CardWithData,
    features: FeatureVector
  ): Promise<DetectedDeal | null> {
    const { temporal, price } = features;

    // Need price significantly below mean (>15%)
    if (temporal.mean_reversion_distance > -0.15) return null;

    // Avoid falling knives (strong negative momentum with acceleration)
    if (temporal.velocity_7d < -0.05 && temporal.acceleration_7d < 0)
      return null;

    // RSI should indicate oversold
    if (temporal.momentum_rsi > 40) return null;

    const expectedReturn = Math.abs(temporal.mean_reversion_distance) * 100;
    const confidence = Math.min(
      0.85,
      0.4 + Math.abs(temporal.mean_reversion_distance)
    );

    return {
      cardId: card.card.cardId,
      cardName: card.card.name,
      dealType: "UNDERVALUED_STATISTICAL",
      confidence,
      expectedReturn,
      riskLevel: temporal.volatility_7d > 0.1 ? "HIGH" : "MEDIUM",
      timeHorizon: "MEDIUM",
      action: {
        type: "BUY",
        buyMarket: "Best Available",
        buyPrice: price.current_gbp,
        targetPrice: price.current_gbp * (1 + expectedReturn / 100),
      },
      metadata: {
        meanReversionDistance: temporal.mean_reversion_distance,
        rsi: temporal.momentum_rsi,
        volatility: temporal.volatility_7d,
      },
      source: "rule",
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    };
  }
}

/**
 * Detects momentum breakout opportunities.
 */
export class MomentumBreakoutDetector implements RuleBasedDetector {
  name = "MomentumBreakout";

  async detect(
    card: CardWithData,
    features: FeatureVector
  ): Promise<DetectedDeal | null> {
    const { temporal, market, price } = features;

    // Strong positive velocity (>2% per day)
    if (temporal.velocity_7d < 0.02) return null;

    // Positive acceleration
    if (temporal.acceleration_7d <= 0) return null;

    // Strong trend
    if (temporal.trend_strength < 0.7) return null;

    // Volume confirmation (if available)
    if (market.volume_relative < 1.2) return null;

    const projectedReturn = temporal.velocity_7d * 7 * 100;
    const confidence = Math.min(
      0.8,
      temporal.trend_strength * temporal.velocity_7d * 20
    );

    return {
      cardId: card.card.cardId,
      cardName: card.card.name,
      dealType: "MOMENTUM_BREAKOUT",
      confidence,
      expectedReturn: projectedReturn,
      riskLevel: "HIGH",
      timeHorizon: "SHORT",
      action: {
        type: "BUY",
        buyMarket: "Best Available",
        buyPrice: price.current_gbp,
        targetPrice: price.current_gbp * (1 + projectedReturn / 100),
      },
      metadata: {
        velocity: temporal.velocity_7d,
        acceleration: temporal.acceleration_7d,
        trendStrength: temporal.trend_strength,
        volumeRelative: market.volume_relative,
      },
      source: "rule",
      expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
    };
  }
}

/**
 * Detects supply shock opportunities.
 */
export class SupplyShockDetector implements RuleBasedDetector {
  name = "SupplyShock";

  async detect(
    card: CardWithData,
    features: FeatureVector
  ): Promise<DetectedDeal | null> {
    const { market, temporal, price } = features;

    // Need inventory signal indicating low stock
    if (market.inventory_signal > -0.3) return null;

    // Should see price uptick
    if (temporal.velocity_7d < 0) return null;

    // Low liquidity
    if (market.liquidity_score > 0.3) return null;

    const expectedReturn = 15; // Conservative estimate
    const confidence = Math.min(0.7, 0.4 + Math.abs(market.inventory_signal));

    return {
      cardId: card.card.cardId,
      cardName: card.card.name,
      dealType: "SUPPLY_SHOCK",
      confidence,
      expectedReturn,
      riskLevel: "HIGH",
      timeHorizon: "SHORT",
      action: {
        type: "BUY",
        buyMarket: "Best Available",
        buyPrice: price.current_gbp,
        targetPrice: price.current_gbp * 1.15,
      },
      metadata: {
        inventorySignal: market.inventory_signal,
        liquidityScore: market.liquidity_score,
        velocity: temporal.velocity_7d,
      },
      source: "rule",
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    };
  }
}

/**
 * Detects currency arbitrage opportunities (JP/EN price gaps).
 */
export class CurrencyArbitrageDetector implements RuleBasedDetector {
  name = "CurrencyArbitrage";

  async detect(
    card: CardWithData,
    features: FeatureVector
  ): Promise<DetectedDeal | null> {
    const { price, fx } = features;

    // Need significant FX-adjusted gap (>20%)
    if (Math.abs(price.fx_adjusted_gap) < 0.2) return null;

    // Get current FX rate
    const fxRate = fx.jpy_gbp_current;
    if (fxRate <= 0) return null;

    // Determine direction of opportunity
    const jpPriceGbp = (price.current_jpy || 0) * fxRate;
    const enPriceGbp = price.current_gbp;

    if (jpPriceGbp <= 0 || enPriceGbp <= 0) return null;

    const buyInJapan = jpPriceGbp < enPriceGbp * 0.8; // JP cheaper by >20%
    const buyInWest = enPriceGbp < jpPriceGbp * 0.8; // EN cheaper by >20%

    if (!buyInJapan && !buyInWest) return null;

    const buyPrice = buyInJapan ? jpPriceGbp : enPriceGbp;
    const sellPrice = buyInJapan ? enPriceGbp : jpPriceGbp;
    const expectedReturn = ((sellPrice - buyPrice) / buyPrice) * 100;

    // Account for shipping/import costs (~15%)
    const netReturn = expectedReturn - 15;
    if (netReturn < 10) return null;

    // FX volatility increases risk
    const riskLevel = fx.fx_volatility_7d > 0.02 ? "HIGH" : "MEDIUM";

    return {
      cardId: card.card.cardId,
      cardName: card.card.name,
      dealType: "ARBITRAGE_CURRENCY",
      confidence: Math.min(0.85, 0.5 + Math.abs(price.fx_adjusted_gap) / 2),
      expectedReturn: netReturn,
      riskLevel,
      timeHorizon: "MEDIUM",
      action: {
        type: "BUY_SELL",
        buyMarket: buyInJapan ? "Japan (JPY)" : "Western (GBP)",
        buyPrice,
        sellMarket: buyInJapan ? "Western (GBP)" : "Japan (JPY)",
        sellPrice,
      },
      metadata: {
        jpPriceGbp,
        enPriceGbp,
        fxRate,
        fxVolatility: fx.fx_volatility_7d,
        rawGap: price.jp_en_gap_pct,
        adjustedGap: price.fx_adjusted_gap,
      },
      source: "rule",
      expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000), // 3 days
    };
  }
}

/**
 * Detects when a card breaks from its usual set/rarity correlation.
 */
export class CorrelationBreakDetector implements RuleBasedDetector {
  name = "CorrelationBreak";

  async detect(
    card: CardWithData,
    features: FeatureVector
  ): Promise<DetectedDeal | null> {
    const { market, temporal, price } = features;

    // Need significant correlation deviation (>1.5 standard deviations)
    if (Math.abs(market.correlation_deviation) < 1.5) return null;

    // If deviating down, potential buying opportunity
    const isUnderperforming = market.correlation_deviation < -1.5;

    // If deviating up, may indicate unique demand
    const isOutperforming = market.correlation_deviation > 1.5;

    if (!isUnderperforming && !isOutperforming) return null;

    // Check if set is moving in opposite direction
    const setMomentum = market.set_momentum;
    const cardMomentum = temporal.velocity_7d;

    // Underperforming while set is rising = buying opportunity
    if (isUnderperforming && setMomentum > 0.01) {
      const expectedReturn = Math.abs(market.correlation_deviation) * 10;

      return {
        cardId: card.card.cardId,
        cardName: card.card.name,
        dealType: "CORRELATION_BREAK",
        confidence: Math.min(0.75, 0.4 + Math.abs(market.correlation_deviation) / 5),
        expectedReturn,
        riskLevel: "MEDIUM",
        timeHorizon: "MEDIUM",
        action: {
          type: "BUY",
          buyMarket: "Best Available",
          buyPrice: price.current_gbp,
          targetPrice: price.current_gbp * (1 + expectedReturn / 100),
        },
        metadata: {
          correlationDeviation: market.correlation_deviation,
          setMomentum,
          cardMomentum,
          correlationToSet: market.correlation_to_set,
        },
        source: "rule",
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      };
    }

    return null;
  }
}

/**
 * Detects seasonal trading opportunities.
 */
export class SeasonalOpportunityDetector implements RuleBasedDetector {
  name = "SeasonalOpportunity";

  async detect(
    card: CardWithData,
    features: FeatureVector
  ): Promise<DetectedDeal | null> {
    const { temporal, market, price } = features;

    // Need strong seasonality signal
    if (Math.abs(temporal.seasonality_index) < 0.2) return null;

    // Current price should be below seasonal expectation
    // Negative seasonality index means we're in a historically low period
    if (temporal.seasonality_index > -0.15) return null;

    // Check if price is actually lower than recent average
    if (temporal.mean_reversion_distance > -0.1) return null;

    // Calculate expected seasonal recovery
    const seasonalRecovery = Math.abs(temporal.seasonality_index) * 100;
    const historicalRecovery = Math.abs(temporal.mean_reversion_distance) * 100;
    const expectedReturn = Math.max(seasonalRecovery, historicalRecovery) * 0.7;

    if (expectedReturn < 10) return null;

    return {
      cardId: card.card.cardId,
      cardName: card.card.name,
      dealType: "SEASONAL_OPPORTUNITY",
      confidence: Math.min(0.7, 0.4 + Math.abs(temporal.seasonality_index)),
      expectedReturn,
      riskLevel: "MEDIUM",
      timeHorizon: "LONG",
      action: {
        type: "BUY",
        buyMarket: "Best Available",
        buyPrice: price.current_gbp,
        targetPrice: price.current_gbp * (1 + expectedReturn / 100),
      },
      metadata: {
        seasonalityIndex: temporal.seasonality_index,
        meanReversionDistance: temporal.mean_reversion_distance,
        daysToSeasonalPeak: this.estimateDaysToSeasonalPeak(),
      },
      source: "rule",
      expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
    };
  }

  private estimateDaysToSeasonalPeak(): number {
    // Simplified: assume major tournaments quarterly
    const now = new Date();
    const month = now.getMonth();
    // Peak months: March, June, September, December (tournament seasons)
    const peakMonths = [2, 5, 8, 11];
    const currentMonth = month;

    for (const peak of peakMonths) {
      if (peak > currentMonth) {
        return (peak - currentMonth) * 30;
      }
    }
    return (12 - currentMonth + peakMonths[0]) * 30;
  }
}

/**
 * Detects sudden demand surges.
 */
export class DemandSurgeDetector implements RuleBasedDetector {
  name = "DemandSurge";

  async detect(
    card: CardWithData,
    features: FeatureVector
  ): Promise<DetectedDeal | null> {
    const { market, temporal, price } = features;

    // Need high relative volume (>2x normal)
    if (market.volume_relative < 2.0) return null;

    // Price should be stable or rising
    if (temporal.velocity_7d < -0.01) return null;

    // Inventory should be declining
    if (market.inventory_signal > 0) return null;

    // High liquidity score means demand is being met
    if (market.liquidity_score > 0.5) return null;

    // Calculate expected price increase based on demand pressure
    const demandPressure = market.volume_relative * Math.abs(market.inventory_signal);
    const expectedReturn = Math.min(30, demandPressure * 10);

    if (expectedReturn < 8) return null;

    const confidence = Math.min(0.8, 0.5 + demandPressure / 5);

    return {
      cardId: card.card.cardId,
      cardName: card.card.name,
      dealType: "DEMAND_SURGE",
      confidence,
      expectedReturn,
      riskLevel: "HIGH",
      timeHorizon: "SHORT",
      action: {
        type: "BUY",
        buyMarket: "Best Available",
        buyPrice: price.current_gbp,
        targetPrice: price.current_gbp * (1 + expectedReturn / 100),
      },
      metadata: {
        volumeRelative: market.volume_relative,
        inventorySignal: market.inventory_signal,
        liquidityScore: market.liquidity_score,
        demandPressure,
      },
      source: "rule",
      expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
    };
  }
}

/**
 * Detects momentum reversal opportunities.
 */
export class MomentumReversalDetector implements RuleBasedDetector {
  name = "MomentumReversal";

  async detect(
    card: CardWithData,
    features: FeatureVector
  ): Promise<DetectedDeal | null> {
    const { temporal, price } = features;

    // Look for oversold bounce setup
    const isOversold = temporal.momentum_rsi < 30;
    // Or overbought correction
    const isOverbought = temporal.momentum_rsi > 70;

    if (!isOversold && !isOverbought) return null;

    // Need momentum to be reversing (acceleration opposite to velocity)
    const momentumReversing =
      (temporal.velocity_7d > 0 && temporal.acceleration_7d < 0) ||
      (temporal.velocity_7d < 0 && temporal.acceleration_7d > 0);

    if (!momentumReversing) return null;

    // Check streak for reversal confirmation
    if (Math.abs(temporal.streak_length) < 3) return null;

    if (isOversold && temporal.acceleration_7d > 0) {
      // Oversold bounce
      const bounceTarget = Math.abs(temporal.mean_reversion_distance) * 0.5;
      const expectedReturn = bounceTarget * 100;

      if (expectedReturn < 10) return null;

      return {
        cardId: card.card.cardId,
        cardName: card.card.name,
        dealType: "MOMENTUM_REVERSAL",
        confidence: Math.min(0.75, 0.4 + (30 - temporal.momentum_rsi) / 50),
        expectedReturn,
        riskLevel: "HIGH",
        timeHorizon: "SHORT",
        action: {
          type: "BUY",
          buyMarket: "Best Available",
          buyPrice: price.current_gbp,
          targetPrice: price.current_gbp * (1 + expectedReturn / 100),
        },
        metadata: {
          rsi: temporal.momentum_rsi,
          velocity: temporal.velocity_7d,
          acceleration: temporal.acceleration_7d,
          streakLength: temporal.streak_length,
          type: "oversold_bounce",
        },
        source: "rule",
        expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
      };
    }

    if (isOverbought && temporal.acceleration_7d < 0) {
      // Overbought correction - opportunity to sell
      const correctionTarget = Math.abs(temporal.mean_reversion_distance) * 0.3;

      return {
        cardId: card.card.cardId,
        cardName: card.card.name,
        dealType: "MOMENTUM_REVERSAL",
        confidence: Math.min(0.7, 0.4 + (temporal.momentum_rsi - 70) / 50),
        expectedReturn: correctionTarget * 100,
        riskLevel: "MEDIUM",
        timeHorizon: "SHORT",
        action: {
          type: "SELL",
          sellMarket: "Best Available",
          sellPrice: price.current_gbp,
          targetPrice: price.current_gbp * (1 - correctionTarget),
        },
        metadata: {
          rsi: temporal.momentum_rsi,
          velocity: temporal.velocity_7d,
          acceleration: temporal.acceleration_7d,
          streakLength: temporal.streak_length,
          type: "overbought_correction",
        },
        source: "rule",
        expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
      };
    }

    return null;
  }
}

/**
 * Detects undervalued cards compared to similar cards in set/rarity.
 */
export class ComparativeUndervalueDetector implements RuleBasedDetector {
  name = "ComparativeUndervalue";

  async detect(
    card: CardWithData,
    features: FeatureVector
  ): Promise<DetectedDeal | null> {
    const { price, market, temporal } = features;

    // Need to be significantly below set percentile
    if (price.percentile_in_set > 0.3) return null;

    // And significantly below rarity percentile
    if (price.percentile_in_rarity > 0.25) return null;

    // Price to index ratio should indicate undervaluation
    if (price.price_to_index_ratio > 0.8) return null;

    // Should not be in a strong downtrend
    if (temporal.velocity_7d < -0.02 && temporal.trend_strength > 0.7) return null;

    // Calculate expected convergence to mean
    const setGap = (0.5 - price.percentile_in_set) * 100;
    const rarityGap = (0.5 - price.percentile_in_rarity) * 100;
    const expectedReturn = Math.min(setGap, rarityGap) * 0.6;

    if (expectedReturn < 12) return null;

    const confidence = Math.min(
      0.75,
      0.4 + (0.5 - price.percentile_in_set) + (0.5 - price.percentile_in_rarity)
    );

    return {
      cardId: card.card.cardId,
      cardName: card.card.name,
      dealType: "UNDERVALUED_COMPARATIVE",
      confidence,
      expectedReturn,
      riskLevel: "MEDIUM",
      timeHorizon: "MEDIUM",
      action: {
        type: "BUY",
        buyMarket: "Best Available",
        buyPrice: price.current_gbp,
        targetPrice: price.current_gbp * (1 + expectedReturn / 100),
      },
      metadata: {
        percentileInSet: price.percentile_in_set,
        percentileInRarity: price.percentile_in_rarity,
        priceToIndexRatio: price.price_to_index_ratio,
        setCode: card.card.setCode,
        rarity: card.card.rarity,
      },
      source: "rule",
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    };
  }
}

// ============================================================================
// DEAL DETECTION PIPELINE
// ============================================================================

/**
 * Main pipeline for detecting deals across all cards.
 */
export class DealDetectionPipeline {
  private normalizer: FeatureNormalizer;
  private ruleBasedDetectors: RuleBasedDetector[];
  private config: PipelineConfig;
  private neuralModel: NeuralModelService;
  private modelInitialized: boolean = false;
  private cache: PipelineCache;

  constructor(config?: Partial<PipelineConfig>) {
    this.config = {
      minConfidence: 0.5,
      minExpectedReturn: 5,
      useNeuralNetwork: true,
      useRuleBasedDetectors: true,
      ...config,
    };

    this.normalizer = new FeatureNormalizer();
    this.neuralModel = new NeuralModelService();
    this.cache = getPipelineCache();
    this.ruleBasedDetectors = [
      // Original 4 detectors
      new CrossMarketArbitrageDetector(),
      new StatisticalUndervalueDetector(),
      new MomentumBreakoutDetector(),
      new SupplyShockDetector(),
      // New 6 detectors
      new CurrencyArbitrageDetector(),
      new CorrelationBreakDetector(),
      new SeasonalOpportunityDetector(),
      new DemandSurgeDetector(),
      new MomentumReversalDetector(),
      new ComparativeUndervalueDetector(),
    ];
  }

  /**
   * Run the full detection pipeline for a game.
   * @param game - The game shard to run detection for
   * @param bypassCache - If true, skip the cache and run fresh detection
   */
  async run(game: GameShard = "onepiece", bypassCache: boolean = false): Promise<PipelineResult> {
    console.log(`[DealPipeline] Starting detection for ${game}`);
    const startTime = Date.now();

    // Check cache first (unless bypassed)
    if (!bypassCache) {
      const cachedResult = this.cache.getPipelineResult(game);
      if (cachedResult) {
        console.log(`[DealPipeline] Returning cached result for ${game}`);
        return cachedResult;
      }
    }

    // Step 1: Load all cards with required data
    const cards = await this.loadCardsWithData(game);
    console.log(`[DealPipeline] Loaded ${cards.length} cards`);

    if (cards.length === 0) {
      return this.emptyResult(startTime);
    }

    // Step 2: Build statistics for feature calculation
    const { setStatsMap, gameStats } = await this.buildStatistics(game, cards);

    // Step 3: Calculate features with caching
    const features = await this.calculateFeaturesWithCache(cards, setStatsMap, gameStats);

    // Step 4: Run rule-based detectors
    const ruleDeals = this.config.useRuleBasedDetectors
      ? await this.runRuleBasedDetectors(cards, features)
      : [];

    // Step 5: Run neural network (if enabled and model loaded)
    let neuralDeals: DetectedDeal[] = [];
    if (this.config.useNeuralNetwork) {
      try {
        neuralDeals = await this.runNeuralNetwork(cards, features);
        console.log(`[DealPipeline] Neural network found ${neuralDeals.length} deals`);
      } catch (error) {
        console.error("[DealPipeline] Neural network error:", error);
        // Continue with rule-based detectors only
      }
    }

    // Step 6: Merge and deduplicate deals
    const allDeals = this.mergeDeals(neuralDeals, ruleDeals);

    // Step 7: Rank and filter
    const rankedDeals = this.rankDeals(allDeals);
    const filteredDeals = this.filterDeals(rankedDeals);

    // Step 8: Persist to database
    await this.persistDeals(filteredDeals, game);

    const duration = Date.now() - startTime;
    console.log(
      `[DealPipeline] Completed in ${duration}ms, found ${filteredDeals.length} deals`
    );

    const result = this.buildResult(filteredDeals, cards.length, duration);

    // Cache the result
    this.cache.setPipelineResult(game, result);
    console.log(`[DealPipeline] Cached result for ${game}`);

    return result;
  }

  /**
   * Calculate features with caching support.
   */
  private async calculateFeaturesWithCache(
    cards: CardWithData[],
    setStatsMap: Map<string, SetStatistics>,
    gameStats: GameStatistics
  ): Promise<FeatureVector[]> {
    const features: FeatureVector[] = [];
    const uncachedCards: CardWithData[] = [];
    const uncachedIndices: number[] = [];

    // Check cache for each card
    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      const cachedFeatures = this.cache.getFeatures(card.card.cardId);

      if (cachedFeatures) {
        features[i] = cachedFeatures;
      } else {
        uncachedCards.push(card);
        uncachedIndices.push(i);
      }
    }

    const cacheHits = cards.length - uncachedCards.length;
    if (cacheHits > 0) {
      console.log(`[DealPipeline] Feature cache: ${cacheHits}/${cards.length} hits`);
    }

    // Calculate features for uncached cards
    if (uncachedCards.length > 0) {
      // Load extended statistics for all uncached cards
      const extendedStatsMap = await this.loadExtendedStatistics(uncachedCards, gameStats.game || "onepiece");

      const newFeatures = await calculateFeaturesInBatch(
        uncachedCards,
        setStatsMap,
        gameStats,
        extendedStatsMap
      );

      // Cache and insert new features
      for (let i = 0; i < uncachedCards.length; i++) {
        const idx = uncachedIndices[i];
        const card = uncachedCards[i];
        const feature = newFeatures[i];

        features[idx] = feature;
        this.cache.setFeatures(card.card.cardId, feature);
      }
    }

    return features;
  }

  /**
   * Load extended statistics for feature calculation.
   */
  private async loadExtendedStatistics(
    cards: CardWithData[],
    game: string
  ): Promise<Map<string, ExtendedStatisticsContext>> {
    const client = getShardClient(game as GameShard);
    const result = new Map<string, ExtendedStatisticsContext>();

    try {
      // Load pre-computed statistics in parallel
      const [rarityStats, volumeStats] = await Promise.all([
        getRarityStatistics(client, game),
        getVolumeStatistics(client, game),
      ]);

      // Load market listings and correlations for each card
      const cardIds = cards.map((c) => c.card.cardId);

      // Get US listings
      const usListings = await client.marketPriceUS.findMany({
        where: { cardId: { in: cardIds }, source: "justtcg" },
        select: { cardId: true, listingsCount: true },
      });
      const usListingsMap = new Map(
        usListings.map((l) => [l.cardId, l.listingsCount || 0])
      );

      // Get EU listings
      const euListings = await client.marketPriceEU.findMany({
        where: { cardId: { in: cardIds }, source: "cardmarket_csv" },
        select: { cardId: true, availableItems: true },
      });
      const euListingsMap = new Map(
        euListings.map((l) => [l.cardId, l.availableItems || 0])
      );

      // Load correlations (batch query)
      const correlations = await client.cardCorrelationCache.findMany({
        where: { cardId: { in: cardIds } },
        orderBy: { snapshotDate: "desc" },
        distinct: ["cardId"],
      });
      const correlationsMap = new Map(
        correlations.map((c) => [
          c.cardId,
          {
            cardId: c.cardId,
            correlationToSet: Number(c.correlationToSet),
            correlationToRarity: Number(c.correlationToRarity),
            correlationDeviation: Number(c.correlationDeviation),
            sampleDays: c.sampleDays,
            pValueSet: Number(c.pValueSet),
            pValueRarity: Number(c.pValueRarity),
          },
        ])
      );

      // Build extended stats for each card
      for (const card of cards) {
        const cardId = card.card.cardId;
        result.set(cardId, {
          rarityStats,
          volumeStats,
          cardCorrelation: correlationsMap.get(cardId) || null,
          usListingsCount: usListingsMap.get(cardId),
          euAvailableItems: euListingsMap.get(cardId),
        });
      }

      console.log(
        `[DealPipeline] Loaded extended stats: ${rarityStats.size} rarities, ` +
          `${correlationsMap.size}/${cards.length} correlations`
      );
    } catch (error) {
      console.warn("[DealPipeline] Failed to load extended statistics:", error);
      // Return empty map - will use defaults
    }

    return result;
  }

  /**
   * Load cards with all related data for feature calculation.
   */
  private async loadCardsWithData(game: GameShard): Promise<CardWithData[]> {
    const client = getShardClient(game);

    // Get cards with price data
    const cards = await client.cardPriceV2.findMany({
      where: {
        game,
        bestPriceGbp: { gt: 0 },
      },
      take: 1000, // Limit for performance
    });

    if (cards.length === 0) return [];

    const cardIds = cards.map((c) => c.cardId);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    // Load related data in parallel
    const [histories, sources, fx] = await Promise.all([
      client.cardPriceHistory.findMany({
        where: {
          cardId: { in: cardIds },
          snapshotDate: { gte: thirtyDaysAgo },
        },
        orderBy: { snapshotDate: "asc" },
      }),
      client.priceSource.findMany({
        where: { cardId: { in: cardIds } },
      }),
      client.exchangeRateHistory.findMany({
        where: { date: { gte: thirtyDaysAgo } },
        orderBy: { date: "asc" },
      }),
    ]);

    // Group by card
    const historyByCard = this.groupBy(histories, "cardId");
    const sourcesByCard = this.groupBy(sources, "cardId");

    return cards.map((card) => ({
      card: {
        cardId: card.cardId,
        name: card.name,
        game: card.game,
        setCode: card.setCode,
        variantType: card.variantType,
        rarity: card.rarity,
        optcgTcgplayerGbp: card.optcgTcgplayerGbp,
        limitlessCardmarketGbp: card.limitlessCardmarketGbp,
        justtcgTcgplayerGbp: card.justtcgTcgplayerGbp,
        bestPriceGbp: card.bestPriceGbp,
        tradeinPriceGbp: card.tradeinPriceGbp,
      },
      history: (historyByCard[card.cardId] || []).map((h) => ({
        snapshotDate: h.snapshotDate,
        priceGbp: h.priceGbp,
        priceJpy: h.priceJpy,
        change: h.change,
      })),
      sources: (sourcesByCard[card.cardId] || []).map((s) => ({
        source: s.source,
        priceGbp: s.priceGbp,
        priceJpy: s.priceJpy,
      })),
      fx: fx.map((f) => ({
        date: f.date,
        jpyToGbp: f.jpyToGbp,
      })),
    }));
  }

  /**
   * Build set-level and game-level statistics.
   */
  private async buildStatistics(
    game: GameShard,
    cards: CardWithData[]
  ): Promise<{ setStatsMap: Map<string, SetStatistics>; gameStats: GameStatistics }> {
    // Group cards by set
    const cardsBySet = new Map<string, CardWithData[]>();
    for (const card of cards) {
      const setCode = card.card.setCode || "unknown";
      if (!cardsBySet.has(setCode)) {
        cardsBySet.set(setCode, []);
      }
      cardsBySet.get(setCode)!.push(card);
    }

    // Build set statistics
    const setStatsMap = new Map<string, SetStatistics>();
    for (const [setCode, setCards] of cardsBySet) {
      const prices = setCards
        .map((c) => c.card.bestPriceGbp?.toNumber() || 0)
        .filter((p) => p > 0);
      const avgPrice =
        prices.length > 0
          ? prices.reduce((a, b) => a + b, 0) / prices.length
          : 0;

      // Calculate 7d momentum from history
      const momentum7d = this.calculateSetMomentum(setCards);

      setStatsMap.set(setCode, {
        setCode,
        cardCount: setCards.length,
        avgPrice,
        momentum7d,
        pricePercentile: (price: number) => {
          if (prices.length === 0) return 0.5;
          const below = prices.filter((p) => p < price).length;
          return below / prices.length;
        },
      });
    }

    // Build game statistics
    const allPrices = cards
      .map((c) => c.card.bestPriceGbp?.toNumber() || 0)
      .filter((p) => p > 0);
    const tcg100AvgPrice =
      allPrices.length > 0
        ? allPrices
            .sort((a, b) => b - a)
            .slice(0, 100)
            .reduce((a, b) => a + b, 0) / Math.min(100, allPrices.length)
        : 0;

    // Build market cap ranking
    const cardsByMarketCap = [...cards].sort((a, b) => {
      const aPrice = a.card.bestPriceGbp?.toNumber() || 0;
      const bPrice = b.card.bestPriceGbp?.toNumber() || 0;
      return bPrice - aPrice;
    });
    const marketCapRanks = new Map<string, number>();
    cardsByMarketCap.forEach((c, i) => {
      marketCapRanks.set(c.card.cardId, i + 1);
    });

    const gameStats: GameStatistics = {
      game,
      sentiment: this.calculateGameSentiment(cards),
      tcg100AvgPrice,
      getMarketCapRank: (cardId: string) =>
        marketCapRanks.get(cardId) || cards.length,
    };

    return { setStatsMap, gameStats };
  }

  private calculateSetMomentum(cards: CardWithData[]): number {
    // Average 7d velocity across cards
    const velocities: number[] = [];
    for (const card of cards) {
      if (card.history.length >= 7) {
        const prices = card.history.slice(-7).map((h) => h.priceGbp.toNumber());
        const first = prices[0];
        const last = prices[prices.length - 1];
        if (first > 0) {
          velocities.push((last - first) / first / 7);
        }
      }
    }
    return velocities.length > 0
      ? velocities.reduce((a, b) => a + b, 0) / velocities.length
      : 0;
  }

  private calculateGameSentiment(cards: CardWithData[]): number {
    // Aggregate positive/negative movers
    let positive = 0;
    let negative = 0;
    for (const card of cards) {
      if (card.history.length > 0) {
        const lastChange = card.history[card.history.length - 1].change.toNumber();
        if (lastChange > 0) positive++;
        if (lastChange < 0) negative++;
      }
    }
    const total = positive + negative;
    return total > 0 ? (positive - negative) / total : 0;
  }

  /**
   * Run all rule-based detectors on cards.
   */
  private async runRuleBasedDetectors(
    cards: CardWithData[],
    features: FeatureVector[]
  ): Promise<DetectedDeal[]> {
    const deals: DetectedDeal[] = [];

    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      const feature = features[i];

      for (const detector of this.ruleBasedDetectors) {
        try {
          const deal = await detector.detect(card, feature);
          if (deal) {
            deals.push(deal);
          }
        } catch (error) {
          console.error(
            `[DealPipeline] Error in ${detector.name} for ${card.card.cardId}:`,
            error
          );
        }
      }
    }

    return deals;
  }

  /**
   * Run neural network inference on cards.
   */
  private async runNeuralNetwork(
    cards: CardWithData[],
    features: FeatureVector[]
  ): Promise<DetectedDeal[]> {
    // Lazy-load and initialize model
    if (!this.modelInitialized) {
      await this.neuralModel.load();
      this.modelInitialized = true;
      console.log(`[DealPipeline] Neural model loaded: ${this.neuralModel.getVersion()}`);
    }

    if (!this.neuralModel.isReady()) {
      console.warn("[DealPipeline] Neural model not ready, skipping");
      return [];
    }

    // Normalize features for the model
    const normalizedFeatures = features.map((f) => this.normalizer.normalize(f));

    // Run batch prediction (process in chunks to avoid memory issues)
    const batchSize = 100;
    const deals: DetectedDeal[] = [];

    for (let i = 0; i < cards.length; i += batchSize) {
      const batchCards = cards.slice(i, i + batchSize);
      const batchFeatures = normalizedFeatures.slice(i, i + batchSize);

      const predictions = await this.neuralModel.predict(batchFeatures);

      // Convert predictions to DetectedDeal objects
      for (let j = 0; j < predictions.length; j++) {
        const pred = predictions[j];
        const card = batchCards[j];
        const feature = features[i + j];

        // Only include high-confidence predictions above threshold
        if (pred.confidence < this.config.minConfidence) continue;
        if (pred.expectedReturn < this.config.minExpectedReturn) continue;

        // Skip low-confidence predictions (model may output low confidence for non-deals)
        if (pred.confidence < 0.3) continue;

        const deal = this.predictionToDeal(card, feature, pred);
        deals.push(deal);
      }
    }

    return deals;
  }

  /**
   * Convert a neural prediction to a DetectedDeal.
   */
  private predictionToDeal(
    card: CardWithData,
    features: FeatureVector,
    prediction: {
      dealType: DealType;
      confidence: number;
      expectedReturn: number;
      riskLevel: "LOW" | "MEDIUM" | "HIGH";
    }
  ): DetectedDeal {
    const currentPrice = features.price.current_gbp;
    const targetPrice = currentPrice * (1 + prediction.expectedReturn / 100);

    // Determine action based on deal type
    const action: DealAction = this.determineAction(prediction.dealType, currentPrice, targetPrice);

    // Calculate time horizon based on deal type
    const timeHorizon = this.determineTimeHorizon(prediction.dealType);

    // Calculate expiry based on deal type
    const expiryHours = DEAL_EXPIRY_HOURS[prediction.dealType] || 24;
    const expiresAt = new Date(Date.now() + expiryHours * 60 * 60 * 1000);

    return {
      cardId: card.card.cardId,
      cardName: card.card.name,
      dealType: prediction.dealType,
      confidence: prediction.confidence,
      expectedReturn: prediction.expectedReturn,
      riskLevel: prediction.riskLevel,
      timeHorizon,
      action,
      metadata: {
        source: "neural",
        modelVersion: this.neuralModel.getVersion(),
        setCode: card.card.setCode,
        variantType: card.card.variantType,
      },
      source: "neural",
      expiresAt,
    };
  }

  /**
   * Determine the action for a deal based on its type.
   */
  private determineAction(
    dealType: DealType,
    currentPrice: number,
    targetPrice: number
  ): DealAction {
    // Arbitrage types suggest buy-sell
    if (dealType.startsWith("ARBITRAGE")) {
      return {
        type: "BUY_SELL",
        buyMarket: "Best Available",
        buyPrice: currentPrice,
        sellMarket: "Target Market",
        sellPrice: targetPrice,
      };
    }

    // Undervalued/momentum types suggest buy
    if (
      dealType.includes("UNDERVALUED") ||
      dealType === "MOMENTUM_BREAKOUT" ||
      dealType === "DEMAND_SURGE" ||
      dealType === "SUPPLY_SHOCK"
    ) {
      return {
        type: "BUY",
        buyMarket: "Best Available",
        buyPrice: currentPrice,
        targetPrice,
      };
    }

    // Reversal could be buy or sell depending on direction
    if (dealType === "MOMENTUM_REVERSAL") {
      return {
        type: "BUY",
        buyMarket: "Best Available",
        buyPrice: currentPrice,
        targetPrice,
      };
    }

    // Default to hold/monitor
    return {
      type: "HOLD",
      buyMarket: "N/A",
      buyPrice: currentPrice,
    };
  }

  /**
   * Determine time horizon based on deal type.
   */
  private determineTimeHorizon(dealType: DealType): TimeHorizon {
    switch (dealType) {
      case "ARBITRAGE_CROSS_MARKET":
      case "ARBITRAGE_CURRENCY":
        return "IMMEDIATE";
      case "MOMENTUM_BREAKOUT":
      case "MOMENTUM_REVERSAL":
      case "SUPPLY_SHOCK":
      case "DEMAND_SURGE":
        return "SHORT";
      case "UNDERVALUED_STATISTICAL":
      case "UNDERVALUED_COMPARATIVE":
      case "CORRELATION_BREAK":
        return "MEDIUM";
      case "SEASONAL_OPPORTUNITY":
        return "LONG";
      default:
        return "MEDIUM";
    }
  }

  /**
   * Merge neural and rule-based deals, boosting confidence for agreements.
   */
  private mergeDeals(
    neuralDeals: DetectedDeal[],
    ruleDeals: DetectedDeal[]
  ): DetectedDeal[] {
    const merged: Map<string, DetectedDeal> = new Map();

    // Add neural deals first (higher priority)
    for (const deal of neuralDeals) {
      const key = `${deal.cardId}:${deal.dealType}`;
      merged.set(key, deal);
    }

    // Add rule-based deals
    for (const deal of ruleDeals) {
      const key = `${deal.cardId}:${deal.dealType}`;
      if (!merged.has(key)) {
        merged.set(key, deal);
      } else {
        // Boost confidence if both sources agree
        const existing = merged.get(key)!;
        existing.confidence = Math.min(0.99, existing.confidence * 1.2);
        existing.metadata.sources = ["neural", "rule"];
      }
    }

    return Array.from(merged.values());
  }

  /**
   * Rank deals by expected value (return * confidence).
   */
  private rankDeals(deals: DetectedDeal[]): DetectedDeal[] {
    return deals.sort((a, b) => {
      const scoreA = a.expectedReturn * a.confidence;
      const scoreB = b.expectedReturn * b.confidence;
      return scoreB - scoreA;
    });
  }

  /**
   * Filter deals based on configuration thresholds.
   */
  private filterDeals(deals: DetectedDeal[]): DetectedDeal[] {
    return deals.filter((deal) => {
      if (deal.confidence < this.config.minConfidence) return false;
      if (deal.expectedReturn < this.config.minExpectedReturn) return false;
      if (deal.expiresAt < new Date()) return false;
      return true;
    });
  }

  /**
   * Persist deals to database.
   */
  private async persistDeals(
    deals: DetectedDeal[],
    game: GameShard
  ): Promise<void> {
    const client = getShardClient(game);

    // Expire old deals
    await client.$executeRaw`
      UPDATE neural_deals
      SET status = 'EXPIRED'
      WHERE status = 'ACTIVE' AND expires_at < NOW()
    `;

    // Insert/update new deals
    for (const deal of deals) {
      await client.neuralDeal.upsert({
        where: {
          id: `${deal.cardId}:${deal.dealType}:ACTIVE`,
        },
        create: {
          cardId: deal.cardId,
          game,
          dealType: deal.dealType,
          confidence: deal.confidence,
          expectedReturn: deal.expectedReturn,
          timeHorizon: deal.timeHorizon,
          riskLevel: deal.riskLevel,
          actionType: deal.action.type,
          buyMarket: deal.action.buyMarket,
          buyPrice: deal.action.buyPrice,
          sellMarket: deal.action.sellMarket,
          sellPrice: deal.action.sellPrice,
          metadata: deal.metadata as object,
          expiresAt: deal.expiresAt,
        },
        update: {
          confidence: deal.confidence,
          expectedReturn: deal.expectedReturn,
          expiresAt: deal.expiresAt,
          metadata: deal.metadata as object,
        },
      });
    }
  }

  private groupBy<T extends Record<string, unknown>>(
    array: T[],
    key: keyof T
  ): Record<string, T[]> {
    return array.reduce(
      (acc, item) => {
        const groupKey = String(item[key]);
        if (!acc[groupKey]) {
          acc[groupKey] = [];
        }
        acc[groupKey].push(item);
        return acc;
      },
      {} as Record<string, T[]>
    );
  }

  private emptyResult(startTime: number): PipelineResult {
    return {
      deals: [],
      durationMs: Date.now() - startTime,
      cardsProcessed: 0,
      dealsBySource: { neural: 0, rule: 0 },
      dealsByType: {} as Record<DealType, number>,
    };
  }

  private buildResult(
    deals: DetectedDeal[],
    cardsProcessed: number,
    durationMs: number
  ): PipelineResult {
    const dealsBySource = { neural: 0, rule: 0 };
    const dealsByType: Record<DealType, number> = {} as Record<DealType, number>;

    for (const deal of deals) {
      dealsBySource[deal.source]++;
      dealsByType[deal.dealType] = (dealsByType[deal.dealType] || 0) + 1;
    }

    return {
      deals,
      durationMs,
      cardsProcessed,
      dealsBySource,
      dealsByType,
    };
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export const detectors = {
  // Original 4
  CrossMarketArbitrageDetector,
  StatisticalUndervalueDetector,
  MomentumBreakoutDetector,
  SupplyShockDetector,
  // New 6
  CurrencyArbitrageDetector,
  CorrelationBreakDetector,
  SeasonalOpportunityDetector,
  DemandSurgeDetector,
  MomentumReversalDetector,
  ComparativeUndervalueDetector,
};
