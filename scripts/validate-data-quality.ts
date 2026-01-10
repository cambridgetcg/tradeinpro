/**
 * Validate Data Quality
 *
 * Validates the quality of collected data for ML training readiness.
 * Checks various metrics and alerts on issues that could affect model training.
 *
 * Metrics checked:
 * - Price freshness (stale data detection)
 * - Historical coverage (cards with sufficient history)
 * - Correlation coverage (cards with correlation data)
 * - Feature default rate (hardcoded vs real values)
 * - Deal type balance (training example distribution)
 * - Data gaps (missing days in history)
 * - Outlier detection (anomalous prices)
 *
 * Usage:
 *   npx tsx scripts/validate-data-quality.ts [--verbose] [--json]
 *
 * Options:
 *   --verbose           Show detailed breakdown of issues
 *   --json              Output results in JSON format
 *   --game=<game>       Game to validate (default: onepiece)
 *   --alert-threshold   Exit with error if score below threshold (default: 50)
 *
 * Cron Example:
 *   0 4 * * * cd /app && npx tsx scripts/validate-data-quality.ts >> /var/log/quality.log 2>&1
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

interface ValidationConfig {
  verbose: boolean;
  json: boolean;
  game: string;
  alertThreshold: number;
}

interface MetricResult {
  name: string;
  value: number;
  target: number;
  status: "pass" | "warn" | "fail";
  details?: string;
}

interface ValidationResult {
  timestamp: string;
  game: string;
  overallScore: number;
  status: "healthy" | "warning" | "critical";
  metrics: MetricResult[];
  alerts: string[];
  recommendations: string[];
}

function parseArgs(): ValidationConfig {
  const args = process.argv.slice(2);
  return {
    verbose: args.includes("--verbose"),
    json: args.includes("--json"),
    game: args.find((a) => a.startsWith("--game="))?.split("=")[1] || "onepiece",
    alertThreshold: parseInt(
      args.find((a) => a.startsWith("--alert-threshold="))?.split("=")[1] || "50"
    ),
  };
}

// =============================================================================
// METRIC VALIDATORS
// =============================================================================

/**
 * Check price data freshness
 */
async function validatePriceFreshness(game: string): Promise<MetricResult> {
  const mostRecent = await prisma.cardPriceV2.aggregate({
    where: { game },
    _max: { lastUpdated: true },
  });

  const lastUpdate = mostRecent._max.lastUpdated;
  const hoursStale = lastUpdate
    ? (Date.now() - lastUpdate.getTime()) / (1000 * 60 * 60)
    : Infinity;

  let status: "pass" | "warn" | "fail" = "pass";
  if (hoursStale > 24) status = "fail";
  else if (hoursStale > 4) status = "warn";

  return {
    name: "Price Freshness",
    value: Math.round(hoursStale * 10) / 10,
    target: 4, // hours
    status,
    details: lastUpdate
      ? `Last update: ${lastUpdate.toISOString()}`
      : "No price data found",
  };
}

/**
 * Check historical data coverage
 */
async function validateHistoryCoverage(game: string): Promise<MetricResult> {
  // Count cards with 30+ days of history
  const result = await prisma.$queryRaw<[{ count: bigint }]>`
    SELECT COUNT(*) as count FROM (
      SELECT card_id
      FROM card_price_history
      WHERE game = ${game}
      GROUP BY card_id
      HAVING COUNT(DISTINCT DATE(snapshot_date)) >= 30
    ) sub
  `;

  const cardsWithHistory = Number(result[0]?.count || 0);
  const targetCards = 500;

  let status: "pass" | "warn" | "fail" = "pass";
  if (cardsWithHistory < targetCards * 0.5) status = "fail";
  else if (cardsWithHistory < targetCards) status = "warn";

  return {
    name: "Cards with 30d+ History",
    value: cardsWithHistory,
    target: targetCards,
    status,
    details: `${((cardsWithHistory / targetCards) * 100).toFixed(1)}% of target`,
  };
}

/**
 * Check correlation data coverage
 */
async function validateCorrelationCoverage(game: string): Promise<MetricResult> {
  const [totalCards, cardsWithCorrelation] = await Promise.all([
    prisma.cardPriceV2.count({ where: { game } }),
    prisma.cardCorrelationCache.count({ where: { game } }),
  ]);

  const coveragePercent =
    totalCards > 0 ? (cardsWithCorrelation / totalCards) * 100 : 0;

  let status: "pass" | "warn" | "fail" = "pass";
  if (coveragePercent < 50) status = "fail";
  else if (coveragePercent < 80) status = "warn";

  return {
    name: "Correlation Coverage",
    value: Math.round(coveragePercent),
    target: 90, // percent
    status,
    details: `${cardsWithCorrelation}/${totalCards} cards have correlation data`,
  };
}

/**
 * Check volume statistics completeness
 */
async function validateVolumeData(game: string): Promise<MetricResult> {
  const volumeStats = await prisma.volumeStatistics.findFirst({
    where: { game },
    orderBy: { snapshotDate: "desc" },
  });

  const cardsTracked = volumeStats?.totalCardsTracked || 0;
  const targetCards = 500;

  let status: "pass" | "warn" | "fail" = "pass";
  if (cardsTracked < targetCards * 0.5) status = "fail";
  else if (cardsTracked < targetCards * 0.8) status = "warn";

  return {
    name: "Volume Data Coverage",
    value: cardsTracked,
    target: targetCards,
    status,
    details: volumeStats
      ? `Computed at: ${volumeStats.snapshotDate.toISOString()}`
      : "No volume statistics found",
  };
}

/**
 * Check deal training examples balance
 */
async function validateDealBalance(game: string): Promise<MetricResult> {
  const dealCounts = await prisma.neuralDeal.groupBy({
    by: ["dealType"],
    where: { game },
    _count: true,
  });

  const totalDeals = dealCounts.reduce((sum, d) => sum + d._count, 0);
  const minTypeCount = dealCounts.length > 0
    ? Math.min(...dealCounts.map((d) => d._count))
    : 0;

  const targetMinPerType = 100;

  let status: "pass" | "warn" | "fail" = "pass";
  if (totalDeals === 0) status = "fail";
  else if (minTypeCount < targetMinPerType * 0.3) status = "fail";
  else if (minTypeCount < targetMinPerType) status = "warn";

  const breakdown = dealCounts
    .sort((a, b) => a._count - b._count)
    .map((d) => `${d.dealType}: ${d._count}`)
    .join(", ");

  return {
    name: "Deal Type Balance",
    value: minTypeCount,
    target: targetMinPerType,
    status,
    details: totalDeals > 0 ? `Total: ${totalDeals}. Min type: ${minTypeCount}` : "No deals found",
  };
}

/**
 * Check for data gaps in history
 */
async function validateDataGaps(game: string): Promise<MetricResult> {
  // Check for gaps in the last 30 days
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const daysWithData = await prisma.$queryRaw<[{ days: bigint }]>`
    SELECT COUNT(DISTINCT DATE(snapshot_date)) as days
    FROM card_price_history
    WHERE game = ${game}
    AND snapshot_date >= ${thirtyDaysAgo}
  `;

  const activeDays = Number(daysWithData[0]?.days || 0);
  const expectedDays = 30;
  const gapDays = expectedDays - activeDays;

  let status: "pass" | "warn" | "fail" = "pass";
  if (gapDays > 7) status = "fail";
  else if (gapDays > 3) status = "warn";

  return {
    name: "Data Gaps (30d)",
    value: gapDays,
    target: 0, // days missing
    status,
    details: `${activeDays}/${expectedDays} days have data`,
  };
}

/**
 * Check for price outliers
 */
async function validateOutliers(game: string): Promise<MetricResult> {
  // Count prices that are extreme outliers (>5 std dev from mean)
  const stats = await prisma.cardPriceV2.aggregate({
    where: { game, bestPriceGbp: { gt: 0 } },
    _avg: { bestPriceGbp: true },
    _count: true,
  });

  const avgPrice = Number(stats._avg.bestPriceGbp || 0);
  const totalCards = stats._count;

  // Get standard deviation (approximate via IQR)
  const prices = await prisma.cardPriceV2.findMany({
    where: { game, bestPriceGbp: { gt: 0 } },
    select: { bestPriceGbp: true },
    orderBy: { bestPriceGbp: "asc" },
  });

  const priceValues = prices.map((p) => Number(p.bestPriceGbp));
  const q1 = priceValues[Math.floor(priceValues.length * 0.25)] || 0;
  const q3 = priceValues[Math.floor(priceValues.length * 0.75)] || 0;
  const iqr = q3 - q1;
  const upperBound = q3 + 3 * iqr;
  const lowerBound = Math.max(0, q1 - 3 * iqr);

  const outliers = priceValues.filter(
    (p) => p > upperBound || p < lowerBound
  ).length;
  const outlierRate = totalCards > 0 ? (outliers / totalCards) * 100 : 0;

  let status: "pass" | "warn" | "fail" = "pass";
  if (outlierRate > 5) status = "fail";
  else if (outlierRate > 1) status = "warn";

  return {
    name: "Outlier Rate",
    value: Math.round(outlierRate * 10) / 10,
    target: 1, // percent
    status,
    details: `${outliers}/${totalCards} cards are statistical outliers`,
  };
}

/**
 * Check rarity/set statistics coverage
 */
async function validateStatisticsCoverage(game: string): Promise<MetricResult> {
  const [rarityCount, setCount] = await Promise.all([
    prisma.rarityStatistics.count({ where: { game } }),
    prisma.setStatistics.count({ where: { game } }),
  ]);

  // Get expected counts
  const [uniqueRarities, uniqueSets] = await Promise.all([
    prisma.cardPriceV2.groupBy({
      by: ["rarity"],
      where: { game, rarity: { not: null } },
    }),
    prisma.cardPriceV2.groupBy({
      by: ["setCode"],
      where: { game, setCode: { not: null } },
    }),
  ]);

  const expectedRarities = uniqueRarities.length;
  const expectedSets = uniqueSets.length;

  const rarityCoverage = expectedRarities > 0 ? (rarityCount / expectedRarities) * 100 : 0;
  const setCoverage = expectedSets > 0 ? (setCount / expectedSets) * 100 : 0;
  const avgCoverage = (rarityCoverage + setCoverage) / 2;

  let status: "pass" | "warn" | "fail" = "pass";
  if (avgCoverage < 50) status = "fail";
  else if (avgCoverage < 80) status = "warn";

  return {
    name: "Statistics Coverage",
    value: Math.round(avgCoverage),
    target: 90, // percent
    status,
    details: `Rarity: ${rarityCount}/${expectedRarities}, Sets: ${setCount}/${expectedSets}`,
  };
}

// =============================================================================
// MAIN VALIDATION
// =============================================================================

function calculateOverallScore(metrics: MetricResult[]): number {
  const weights: Record<string, number> = {
    "Price Freshness": 15,
    "Cards with 30d+ History": 20,
    "Correlation Coverage": 15,
    "Volume Data Coverage": 10,
    "Deal Type Balance": 15,
    "Data Gaps (30d)": 10,
    "Outlier Rate": 5,
    "Statistics Coverage": 10,
  };

  let totalScore = 0;
  let totalWeight = 0;

  for (const metric of metrics) {
    const weight = weights[metric.name] || 10;
    totalWeight += weight;

    // Score based on status
    let score: number;
    switch (metric.status) {
      case "pass":
        score = 100;
        break;
      case "warn":
        score = 60;
        break;
      case "fail":
        score = 20;
        break;
    }

    totalScore += score * weight;
  }

  return Math.round(totalScore / totalWeight);
}

function generateAlerts(metrics: MetricResult[]): string[] {
  const alerts: string[] = [];

  for (const metric of metrics) {
    if (metric.status === "fail") {
      alerts.push(`CRITICAL: ${metric.name} - ${metric.details || metric.value}`);
    } else if (metric.status === "warn") {
      alerts.push(`WARNING: ${metric.name} - ${metric.details || metric.value}`);
    }
  }

  return alerts;
}

function generateRecommendations(metrics: MetricResult[]): string[] {
  const recommendations: string[] = [];

  for (const metric of metrics) {
    if (metric.status === "fail" || metric.status === "warn") {
      switch (metric.name) {
        case "Price Freshness":
          recommendations.push("Run price collection jobs more frequently");
          break;
        case "Cards with 30d+ History":
          recommendations.push("Run bootstrap-historical-data.ts to backfill history");
          break;
        case "Correlation Coverage":
          recommendations.push("Run compute-statistics.ts to update correlations");
          break;
        case "Volume Data Coverage":
          recommendations.push("Run seed-volume-data.ts to populate listing counts");
          break;
        case "Deal Type Balance":
          recommendations.push("Run generate-synthetic-deals.ts to create training examples");
          break;
        case "Data Gaps (30d)":
          recommendations.push("Ensure snapshot-history.ts runs daily via cron");
          break;
        case "Outlier Rate":
          recommendations.push("Review outlier prices for data quality issues");
          break;
        case "Statistics Coverage":
          recommendations.push("Run compute-statistics.ts to update rarity/set stats");
          break;
      }
    }
  }

  return [...new Set(recommendations)]; // Deduplicate
}

async function main() {
  const config = parseArgs();
  const startTime = Date.now();

  if (!config.json) {
    console.log("=".repeat(60));
    console.log("Data Quality Validation");
    console.log("=".repeat(60));
    console.log(`Game: ${config.game}`);
    console.log(`Timestamp: ${new Date().toISOString()}`);
    console.log("");
  }

  try {
    // Run all validations
    const metrics: MetricResult[] = await Promise.all([
      validatePriceFreshness(config.game),
      validateHistoryCoverage(config.game),
      validateCorrelationCoverage(config.game),
      validateVolumeData(config.game),
      validateDealBalance(config.game),
      validateDataGaps(config.game),
      validateOutliers(config.game),
      validateStatisticsCoverage(config.game),
    ]);

    // Calculate overall score
    const overallScore = calculateOverallScore(metrics);
    const status: "healthy" | "warning" | "critical" =
      overallScore >= 80 ? "healthy" : overallScore >= 50 ? "warning" : "critical";

    // Generate alerts and recommendations
    const alerts = generateAlerts(metrics);
    const recommendations = generateRecommendations(metrics);

    const result: ValidationResult = {
      timestamp: new Date().toISOString(),
      game: config.game,
      overallScore,
      status,
      metrics,
      alerts,
      recommendations,
    };

    if (config.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      // Print metrics table
      console.log("METRICS");
      console.log("-".repeat(60));
      console.log(
        "Metric".padEnd(30) +
          "Value".padStart(10) +
          "Target".padStart(10) +
          "Status".padStart(10)
      );
      console.log("-".repeat(60));

      for (const metric of metrics) {
        const statusIcon =
          metric.status === "pass" ? "[OK]" : metric.status === "warn" ? "[!]" : "[X]";
        console.log(
          metric.name.padEnd(30) +
            String(metric.value).padStart(10) +
            String(metric.target).padStart(10) +
            statusIcon.padStart(10)
        );
        if (config.verbose && metric.details) {
          console.log(`    ${metric.details}`);
        }
      }

      console.log("-".repeat(60));
      console.log(`Overall Score: ${overallScore}/100 (${status.toUpperCase()})`);
      console.log(`Duration: ${(Date.now() - startTime)}ms`);

      // Print alerts
      if (alerts.length > 0) {
        console.log("\n" + "=".repeat(60));
        console.log("ALERTS");
        console.log("=".repeat(60));
        for (const alert of alerts) {
          console.log(alert);
        }
      }

      // Print recommendations
      if (recommendations.length > 0) {
        console.log("\n" + "=".repeat(60));
        console.log("RECOMMENDATIONS");
        console.log("=".repeat(60));
        for (let i = 0; i < recommendations.length; i++) {
          console.log(`${i + 1}. ${recommendations[i]}`);
        }
      }
    }

    // Exit with error if below threshold
    if (overallScore < config.alertThreshold) {
      if (!config.json) {
        console.error(
          `\nData quality score (${overallScore}) is below threshold (${config.alertThreshold})`
        );
      }
      process.exit(1);
    }
  } catch (error) {
    console.error("Validation failed:", error);
    process.exit(1);
  }
}

main()
  .catch((error) => {
    console.error("Script failed:", error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
