/**
 * Generate Synthetic Deals
 *
 * Creates labeled training examples for the neural network by:
 * 1. Running rule-based detectors on historical price snapshots
 * 2. Calculating actual returns using forward price movement (7-day lookahead)
 * 3. Labeling deals as EXECUTED (profit > 5%) or EXPIRED (no profit)
 *
 * This provides the ground truth for supervised learning.
 *
 * Usage:
 *   npx tsx scripts/generate-synthetic-deals.ts [--dry-run] [--days=N]
 *
 * Options:
 *   --dry-run           Show what would be created without persisting
 *   --days=N            Number of days to process (default: 30)
 *   --batch-size=N      Cards per batch (default: 50)
 *   --game=<game>       Game to process (default: onepiece)
 *   --min-history=N     Minimum days of history required (default: 14)
 *   --lookahead=N       Days to look ahead for return calculation (default: 7)
 */

import { PrismaClient, Prisma } from "@prisma/client";
import { FeatureCalculator } from "../app/lib/neural/features.server";
import type {
  CardWithData,
  FeatureVector,
  SetStatistics,
  GameStatistics,
  DetectedDeal,
  DealType,
  TimeHorizon,
  RiskLevel,
} from "../app/lib/neural/types";

const prisma = new PrismaClient();

interface GenerateConfig {
  dryRun: boolean;
  days: number;
  batchSize: number;
  game: string;
  minHistory: number;
  lookahead: number;
}

interface GenerateResult {
  daysProcessed: number;
  cardsAnalyzed: number;
  dealsCreated: number;
  executedDeals: number;
  expiredDeals: number;
  errors: number;
  duration: number;
}

interface DealTypeStats {
  total: number;
  executed: number;
  expired: number;
}

function parseArgs(): GenerateConfig {
  const args = process.argv.slice(2);
  return {
    dryRun: args.includes("--dry-run"),
    days: parseInt(args.find((a) => a.startsWith("--days="))?.split("=")[1] || "30"),
    batchSize: parseInt(
      args.find((a) => a.startsWith("--batch-size="))?.split("=")[1] || "50"
    ),
    game: args.find((a) => a.startsWith("--game="))?.split("=")[1] || "onepiece",
    minHistory: parseInt(
      args.find((a) => a.startsWith("--min-history="))?.split("=")[1] || "14"
    ),
    lookahead: parseInt(
      args.find((a) => a.startsWith("--lookahead="))?.split("=")[1] || "7"
    ),
  };
}

// =============================================================================
// SIMPLIFIED RULE-BASED DETECTORS
// Simplified versions of pipeline detectors that work with historical data
// =============================================================================

interface SimpleDetector {
  name: string;
  dealType: DealType;
  detect: (features: FeatureVector, card: any) => DetectedDeal | null;
}

const DETECTORS: SimpleDetector[] = [
  {
    name: "CrossMarketArbitrage",
    dealType: "ARBITRAGE_CROSS_MARKET",
    detect: (features, card) => {
      const { price } = features;
      if (price.spread_min_max < 0.15) return null;

      const buyFee = 0.1;
      const sellFee = 0.13;
      const netSpread = price.spread_min_max - buyFee - sellFee;
      if (netSpread < 0.05) return null;

      return createDeal(card, "ARBITRAGE_CROSS_MARKET", {
        confidence: Math.min(0.9, 0.5 + netSpread),
        expectedReturn: netSpread * 100,
        riskLevel: "LOW",
        timeHorizon: "IMMEDIATE",
      });
    },
  },
  {
    name: "StatisticalUndervalue",
    dealType: "UNDERVALUED_STATISTICAL",
    detect: (features, card) => {
      const { temporal, price } = features;
      if (temporal.mean_reversion_distance > -0.15) return null;
      if (temporal.velocity_7d < -0.05 && temporal.acceleration_7d < 0) return null;
      if (temporal.momentum_rsi > 40) return null;

      const expectedReturn = Math.abs(temporal.mean_reversion_distance) * 100;
      const confidence = Math.min(
        0.85,
        0.4 + Math.abs(temporal.mean_reversion_distance)
      );

      return createDeal(card, "UNDERVALUED_STATISTICAL", {
        confidence,
        expectedReturn,
        riskLevel: "MEDIUM",
        timeHorizon: "SHORT",
      });
    },
  },
  {
    name: "MomentumBreakout",
    dealType: "MOMENTUM_BREAKOUT",
    detect: (features, card) => {
      const { temporal, market } = features;
      if (temporal.velocity_7d < 0.02) return null;
      if (temporal.acceleration_7d <= 0) return null;
      if (temporal.trend_strength < 0.7) return null;
      if (market.volume_relative < 1.2) return null;

      const confidence = Math.min(
        0.8,
        0.5 + temporal.velocity_7d * 10 + temporal.trend_strength * 0.2
      );
      const expectedReturn =
        temporal.velocity_7d * 100 * 7 + temporal.acceleration_7d * 100 * 21;

      return createDeal(card, "MOMENTUM_BREAKOUT", {
        confidence,
        expectedReturn: Math.min(50, expectedReturn),
        riskLevel: "MEDIUM",
        timeHorizon: "SHORT",
      });
    },
  },
  {
    name: "SupplyShock",
    dealType: "SUPPLY_SHOCK",
    detect: (features, card) => {
      const { market, temporal } = features;
      if (market.inventory_signal > -0.3) return null;
      if (temporal.velocity_7d < 0) return null;
      if (market.liquidity_score > 0.3) return null;

      const confidence = Math.min(0.7, 0.4 + Math.abs(market.inventory_signal));

      return createDeal(card, "SUPPLY_SHOCK", {
        confidence,
        expectedReturn: 15,
        riskLevel: "HIGH",
        timeHorizon: "MEDIUM",
      });
    },
  },
  {
    name: "CurrencyArbitrage",
    dealType: "ARBITRAGE_CURRENCY",
    detect: (features, card) => {
      const { price, fx } = features;
      if (Math.abs(price.fx_adjusted_gap) < 0.2) return null;
      if (fx.jpy_gbp_current <= 0) return null;

      const netGap = Math.abs(price.fx_adjusted_gap) - 0.15; // shipping/fees
      if (netGap < 0.05) return null;

      const confidence = Math.min(0.85, 0.5 + netGap);

      return createDeal(card, "ARBITRAGE_CURRENCY", {
        confidence,
        expectedReturn: netGap * 100,
        riskLevel: "MEDIUM",
        timeHorizon: "SHORT",
      });
    },
  },
  {
    name: "CorrelationBreak",
    dealType: "CORRELATION_BREAK",
    detect: (features, card) => {
      const { market, temporal } = features;
      if (Math.abs(market.correlation_deviation) < 1.5) return null;

      const isUnderperforming = market.correlation_deviation < -1.5;
      if (!isUnderperforming) return null;

      if (market.set_momentum > 0 && temporal.velocity_7d < 0) {
        const confidence = Math.min(0.75, 0.4 + Math.abs(market.correlation_deviation) * 0.2);
        const expectedReturn = Math.abs(market.correlation_deviation) * 10;

        return createDeal(card, "CORRELATION_BREAK", {
          confidence,
          expectedReturn,
          riskLevel: "MEDIUM",
          timeHorizon: "MEDIUM",
        });
      }

      return null;
    },
  },
  {
    name: "SeasonalOpportunity",
    dealType: "SEASONAL_OPPORTUNITY",
    detect: (features, card) => {
      const { temporal } = features;
      if (Math.abs(temporal.seasonality_index) < 0.2) return null;
      if (temporal.seasonality_index > -0.15) return null;
      if (temporal.mean_reversion_distance > -0.1) return null;

      const seasonalRecovery = Math.abs(temporal.seasonality_index) * 100;
      const confidence = Math.min(0.7, 0.4 + Math.abs(temporal.seasonality_index));

      return createDeal(card, "SEASONAL_OPPORTUNITY", {
        confidence,
        expectedReturn: Math.min(30, seasonalRecovery),
        riskLevel: "MEDIUM",
        timeHorizon: "LONG",
      });
    },
  },
  {
    name: "DemandSurge",
    dealType: "DEMAND_SURGE",
    detect: (features, card) => {
      const { market, temporal } = features;
      if (market.volume_relative < 2.0) return null;
      if (temporal.velocity_7d < -0.01) return null;
      if (market.inventory_signal > 0) return null;
      if (market.liquidity_score > 0.5) return null;

      const confidence = Math.min(0.75, 0.4 + (market.volume_relative - 1) * 0.15);

      return createDeal(card, "DEMAND_SURGE", {
        confidence,
        expectedReturn: 10 + Math.min(15, (market.volume_relative - 1) * 10),
        riskLevel: "MEDIUM",
        timeHorizon: "SHORT",
      });
    },
  },
  {
    name: "MomentumReversal",
    dealType: "MOMENTUM_REVERSAL",
    detect: (features, card) => {
      const { temporal, price } = features;
      const isOversold = temporal.momentum_rsi < 30;
      const isOverbought = temporal.momentum_rsi > 70;

      if (!isOversold && !isOverbought) return null;

      const momentumReversing =
        (temporal.velocity_7d > 0 && temporal.acceleration_7d < 0) ||
        (temporal.velocity_7d < 0 && temporal.acceleration_7d > 0);

      if (!momentumReversing) return null;

      const confidence = isOversold
        ? Math.min(0.8, 0.5 + (30 - temporal.momentum_rsi) / 100)
        : Math.min(0.7, 0.5 + (temporal.momentum_rsi - 70) / 100);

      return createDeal(card, "MOMENTUM_REVERSAL", {
        confidence,
        expectedReturn: isOversold ? 12 : 10,
        riskLevel: isOversold ? "MEDIUM" : "HIGH",
        timeHorizon: "SHORT",
      });
    },
  },
  {
    name: "ComparativeUndervalue",
    dealType: "UNDERVALUED_COMPARATIVE",
    detect: (features, card) => {
      const { price, temporal } = features;
      if (price.percentile_in_set > 0.3) return null;
      if (price.percentile_in_rarity > 0.25) return null;
      if (price.price_to_index_ratio > 0.8) return null;
      if (temporal.velocity_7d < -0.02 && temporal.trend_strength > 0.7) return null;

      const undervaluation = Math.max(
        (0.3 - price.percentile_in_set) / 0.3,
        (0.25 - price.percentile_in_rarity) / 0.25
      );

      const confidence = Math.min(0.75, 0.4 + undervaluation * 0.3);
      const expectedReturn = undervaluation * 30;

      return createDeal(card, "UNDERVALUED_COMPARATIVE", {
        confidence,
        expectedReturn: Math.min(35, expectedReturn),
        riskLevel: "LOW",
        timeHorizon: "MEDIUM",
      });
    },
  },
];

function createDeal(
  card: any,
  dealType: DealType,
  params: {
    confidence: number;
    expectedReturn: number;
    riskLevel: RiskLevel;
    timeHorizon: TimeHorizon;
  }
): DetectedDeal {
  const horizonDays = {
    IMMEDIATE: 1,
    SHORT: 7,
    MEDIUM: 14,
    LONG: 30,
  };

  return {
    cardId: card.cardId,
    cardName: card.name || card.cardId,
    dealType,
    confidence: params.confidence,
    expectedReturn: params.expectedReturn,
    riskLevel: params.riskLevel,
    timeHorizon: params.timeHorizon,
    action: {
      type: "BUY",
      buyMarket: "tcgplayer",
      sellMarket: null,
    },
    metadata: {
      detectorName: dealType,
      currentPrice: Number(card.bestPriceGbp || 0),
    },
    source: "rule",
    expiresAt: new Date(
      Date.now() + horizonDays[params.timeHorizon] * 24 * 60 * 60 * 1000
    ),
  };
}

// =============================================================================
// HISTORICAL DATA PROCESSING
// =============================================================================

/**
 * Get cards with sufficient history for analysis
 */
async function getCardsWithHistory(
  game: string,
  minDays: number
): Promise<string[]> {
  const result = await prisma.$queryRaw<[{ card_id: string; days: bigint }]>`
    SELECT card_id, COUNT(DISTINCT DATE(snapshot_date)) as days
    FROM card_price_history
    WHERE game = ${game}
    GROUP BY card_id
    HAVING COUNT(DISTINCT DATE(snapshot_date)) >= ${minDays}
  `;

  return result.map((r) => r.card_id);
}

/**
 * Get price history for a card up to a specific date
 */
async function getHistoryUpToDate(
  cardId: string,
  date: Date,
  windowDays: number = 30
): Promise<any[]> {
  const startDate = new Date(date);
  startDate.setDate(startDate.getDate() - windowDays);

  return prisma.cardPriceHistory.findMany({
    where: {
      cardId,
      snapshotDate: {
        gte: startDate,
        lte: date,
      },
    },
    orderBy: { snapshotDate: "asc" },
  });
}

/**
 * Get forward price to calculate actual return
 */
async function getForwardPrice(
  cardId: string,
  fromDate: Date,
  daysAhead: number
): Promise<number | null> {
  const targetDate = new Date(fromDate);
  targetDate.setDate(targetDate.getDate() + daysAhead);

  // Find closest price within +/- 2 days of target
  const endDate = new Date(targetDate);
  endDate.setDate(endDate.getDate() + 2);

  const record = await prisma.cardPriceHistory.findFirst({
    where: {
      cardId,
      snapshotDate: {
        gte: fromDate,
        lte: endDate,
      },
    },
    orderBy: [
      {
        snapshotDate: "asc",
      },
    ],
    select: { priceGbp: true },
  });

  return record?.priceGbp ? Number(record.priceGbp) : null;
}

/**
 * Get set statistics for a given date
 */
async function getSetStatsForDate(
  game: string,
  setCode: string
): Promise<SetStatistics> {
  // Use current set statistics (simplified)
  const stats = await prisma.setStatistics.findFirst({
    where: { game, setCode },
    orderBy: { snapshotDate: "desc" },
  });

  return {
    setCode,
    cardCount: stats?.cardCount || 100,
    avgPrice: Number(stats?.avgPrice || 30),
    momentum7d: Number(stats?.momentum7d || 0),
    pricePercentile: (price: number) => {
      const avgPrice = Number(stats?.avgPrice || 30);
      return Math.min(1, Math.max(0, price / (avgPrice * 2)));
    },
  };
}

/**
 * Get game statistics
 */
async function getGameStats(): Promise<GameStatistics> {
  return {
    tcg100AvgPrice: 25,
    sentiment: 0.2,
    getMarketCapRank: () => 50,
  };
}

/**
 * Build CardWithData for historical analysis
 */
function buildCardWithData(
  card: any,
  history: any[],
  currentPrice: number
): CardWithData {
  return {
    card: {
      cardId: card.cardId,
      name: card.name,
      setCode: card.setCode,
      rarity: card.rarity,
      optcgTcgplayerGbp: { toNumber: () => currentPrice },
      limitlessCardmarketGbp: { toNumber: () => currentPrice * 0.9 },
      justtcgTcgplayerGbp: { toNumber: () => currentPrice * 1.02 },
      bestPriceGbp: { toNumber: () => currentPrice },
      tradeinPriceGbp: { toNumber: () => currentPrice * 0.7 },
    },
    history: history.map((h) => ({
      snapshotDate: h.snapshotDate,
      priceGbp: { toNumber: () => Number(h.priceGbp) },
      change: { toNumber: () => Number(h.change || 0) },
    })),
    sources: [{ priceGbp: { toNumber: () => currentPrice }, priceJpy: null }],
    fx: [{ jpyToGbp: { toNumber: () => 0.00472 } }],
  };
}

// =============================================================================
// MAIN PROCESSING
// =============================================================================

async function main() {
  const config = parseArgs();
  const startTime = Date.now();

  console.log("=".repeat(60));
  console.log("Generate Synthetic Deals");
  console.log("=".repeat(60));
  console.log(`Mode: ${config.dryRun ? "DRY RUN" : "LIVE"}`);
  console.log(`Game: ${config.game}`);
  console.log(`Days to process: ${config.days}`);
  console.log(`Minimum history: ${config.minHistory} days`);
  console.log(`Lookahead: ${config.lookahead} days`);
  console.log(`Batch size: ${config.batchSize}`);

  const result: GenerateResult = {
    daysProcessed: 0,
    cardsAnalyzed: 0,
    dealsCreated: 0,
    executedDeals: 0,
    expiredDeals: 0,
    errors: 0,
    duration: 0,
  };

  const dealTypeStats = new Map<DealType, DealTypeStats>();

  try {
    // Get cards with sufficient history
    console.log("\nFinding cards with sufficient history...");
    const cardIds = await getCardsWithHistory(config.game, config.minHistory);
    console.log(`Found ${cardIds.length} cards with ${config.minHistory}+ days of history`);

    if (cardIds.length === 0) {
      console.log("No cards with sufficient history. Run bootstrap-historical-data.ts first.");
      return;
    }

    // Get card details
    const cards = await prisma.cardPriceV2.findMany({
      where: { cardId: { in: cardIds } },
      select: { cardId: true, name: true, setCode: true, rarity: true, bestPriceGbp: true },
    });

    const cardMap = new Map(cards.map((c) => [c.cardId, c]));

    // Get game statistics
    const gameStats = await getGameStats();

    // Generate dates to process (working backwards from today)
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const endDate = new Date(today);
    endDate.setDate(endDate.getDate() - config.lookahead); // Leave room for lookahead

    const dates: Date[] = [];
    for (let i = 0; i < config.days; i++) {
      const date = new Date(endDate);
      date.setDate(date.getDate() - i);
      dates.push(date);
    }

    console.log(
      `\nProcessing ${dates.length} days from ${dates[dates.length - 1].toISOString().split("T")[0]} to ${dates[0].toISOString().split("T")[0]}`
    );

    // Process each date
    for (const date of dates) {
      const dateStr = date.toISOString().split("T")[0];
      process.stdout.write(`\rProcessing ${dateStr}...`);
      result.daysProcessed++;

      // Process cards in batches
      for (let i = 0; i < cardIds.length; i += config.batchSize) {
        const batch = cardIds.slice(i, i + config.batchSize);

        for (const cardId of batch) {
          try {
            result.cardsAnalyzed++;

            const card = cardMap.get(cardId);
            if (!card) continue;

            // Get history up to this date
            const history = await getHistoryUpToDate(cardId, date, 30);
            if (history.length < config.minHistory) continue;

            // Get the price on this date
            const dateHistory = history.find(
              (h) =>
                h.snapshotDate.toISOString().split("T")[0] === dateStr
            );
            if (!dateHistory) continue;

            const currentPrice = Number(dateHistory.priceGbp);
            if (currentPrice <= 0) continue;

            // Build card data
            const cardWithData = buildCardWithData(card, history, currentPrice);

            // Get set statistics
            const setStats = await getSetStatsForDate(config.game, card.setCode || "");

            // Calculate features
            const calculator = new FeatureCalculator(
              cardWithData,
              setStats,
              gameStats
            );
            const features = calculator.calculate();

            // Run detectors
            for (const detector of DETECTORS) {
              const deal = detector.detect(features, { ...card, bestPriceGbp: currentPrice });

              if (deal) {
                // Calculate actual return using forward price
                const forwardPrice = await getForwardPrice(
                  cardId,
                  date,
                  config.lookahead
                );

                let actualReturn: number | null = null;
                let status = "EXPIRED";

                if (forwardPrice !== null && currentPrice > 0) {
                  actualReturn = ((forwardPrice - currentPrice) / currentPrice) * 100;
                  status = actualReturn >= 5 ? "EXECUTED" : "EXPIRED";
                }

                // Track statistics
                const stats = dealTypeStats.get(deal.dealType) || {
                  total: 0,
                  executed: 0,
                  expired: 0,
                };
                stats.total++;
                if (status === "EXECUTED") {
                  stats.executed++;
                  result.executedDeals++;
                } else {
                  stats.expired++;
                  result.expiredDeals++;
                }
                dealTypeStats.set(deal.dealType, stats);

                if (config.dryRun) {
                  result.dealsCreated++;
                  continue;
                }

                // Create NeuralDeal record
                const expiresAt = new Date(date);
                expiresAt.setDate(expiresAt.getDate() + config.lookahead);

                await prisma.neuralDeal.create({
                  data: {
                    cardId,
                    game: config.game,
                    dealType: deal.dealType,
                    confidence: deal.confidence,
                    expectedReturn: deal.expectedReturn,
                    timeHorizon: deal.timeHorizon,
                    riskLevel: deal.riskLevel,
                    actionType: deal.action.type,
                    buyMarket: deal.action.buyMarket,
                    buyPrice: currentPrice,
                    sellMarket: deal.action.sellMarket,
                    sellPrice: forwardPrice,
                    metadata: deal.metadata as Prisma.JsonObject,
                    featureImportance: features as unknown as Prisma.JsonObject,
                    status,
                    createdAt: date,
                    expiresAt,
                    executedAt: status === "EXECUTED" ? expiresAt : null,
                    actualReturn,
                  },
                });

                result.dealsCreated++;
              }
            }
          } catch (error) {
            result.errors++;
            if (result.errors <= 5) {
              console.error(`\n  Error for ${cardId}:`, (error as Error).message);
            }
          }
        }
      }
    }

    result.duration = Date.now() - startTime;

    // Summary
    console.log("\n\n" + "=".repeat(60));
    console.log("GENERATION SUMMARY");
    console.log("=".repeat(60));
    console.log(`Days processed: ${result.daysProcessed}`);
    console.log(`Cards analyzed: ${result.cardsAnalyzed}`);
    console.log(`Deals created: ${result.dealsCreated}`);
    console.log(`  - Executed (profit >= 5%): ${result.executedDeals}`);
    console.log(`  - Expired (profit < 5%): ${result.expiredDeals}`);
    console.log(`Errors: ${result.errors}`);
    console.log(`Duration: ${(result.duration / 1000).toFixed(1)}s`);

    if (config.dryRun) {
      console.log("\n[DRY RUN] No records were actually created.");
    }

    // Deal type breakdown
    console.log("\n" + "-".repeat(40));
    console.log("DEAL TYPE BREAKDOWN");
    console.log("-".repeat(40));

    for (const [dealType, stats] of dealTypeStats.entries()) {
      const successRate =
        stats.total > 0 ? ((stats.executed / stats.total) * 100).toFixed(1) : "0.0";
      console.log(
        `${dealType.padEnd(25)} ${String(stats.total).padStart(5)} deals (${successRate}% success)`
      );
    }

    // Show database counts
    if (!config.dryRun) {
      const totalDeals = await prisma.neuralDeal.count({
        where: { game: config.game },
      });
      const executedDeals = await prisma.neuralDeal.count({
        where: { game: config.game, status: "EXECUTED" },
      });
      const expiredDeals = await prisma.neuralDeal.count({
        where: { game: config.game, status: "EXPIRED" },
      });

      console.log("\nDatabase Status:");
      console.log(`  Total NeuralDeal records: ${totalDeals}`);
      console.log(`  Executed deals: ${executedDeals}`);
      console.log(`  Expired deals: ${expiredDeals}`);
      console.log(
        `  Overall success rate: ${totalDeals > 0 ? ((executedDeals / totalDeals) * 100).toFixed(1) : 0}%`
      );
    }
  } catch (error) {
    console.error("\nGeneration failed:", error);
    process.exit(1);
  }
}

main()
  .catch((error) => {
    console.error("\nScript failed:", error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
