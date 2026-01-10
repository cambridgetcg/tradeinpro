/**
 * Check Training Readiness
 *
 * Assesses whether the collected data is sufficient for model training.
 * Calculates a readiness score and provides milestone tracking.
 *
 * Training Milestones:
 * - Alpha (40+): Train with synthetic data, validate pipeline
 * - Beta (60+): Train with mixed data, tune hyperparameters
 * - Production (80+): Full training with quality data
 *
 * Usage:
 *   npx tsx scripts/check-readiness.ts [--json] [--verbose]
 *
 * Options:
 *   --json              Output results in JSON format
 *   --verbose           Show detailed breakdown
 *   --game=<game>       Game to check (default: onepiece)
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

interface ReadinessConfig {
  json: boolean;
  verbose: boolean;
  game: string;
}

interface ComponentScore {
  name: string;
  score: number;
  weight: number;
  details: string;
  requirements: string[];
}

interface TrainingMilestone {
  name: string;
  minScore: number;
  description: string;
  reached: boolean;
}

interface ReadinessResult {
  timestamp: string;
  game: string;
  readinessScore: number;
  currentMilestone: string;
  nextMilestone: string | null;
  estimatedDaysToReady: number | null;
  components: ComponentScore[];
  milestones: TrainingMilestone[];
  blockers: string[];
  dataStats: {
    totalCards: number;
    cardsWithHistory: number;
    historyRecords: number;
    correlationRecords: number;
    dealRecords: number;
    avgDaysPerCard: number;
    dealTypeCount: number;
    minDealTypeCount: number;
  };
}

function parseArgs(): ReadinessConfig {
  const args = process.argv.slice(2);
  return {
    json: args.includes("--json"),
    verbose: args.includes("--verbose"),
    game: args.find((a) => a.startsWith("--game="))?.split("=")[1] || "onepiece",
  };
}

// =============================================================================
// COMPONENT SCORE CALCULATORS
// =============================================================================

/**
 * Calculate data volume score
 * Target: 500,000 history records
 */
async function calculateDataVolumeScore(game: string): Promise<ComponentScore> {
  const historyCount = await prisma.cardPriceHistory.count({
    where: { game },
  });

  const target = 500000;
  const score = Math.min(100, (historyCount / target) * 100);

  const requirements: string[] = [];
  if (historyCount < 100000) requirements.push("Need 100k+ history records for alpha training");
  if (historyCount < 250000) requirements.push("Need 250k+ history records for beta training");
  if (historyCount < target) requirements.push("Need 500k+ history records for production");

  return {
    name: "Data Volume",
    score: Math.round(score),
    weight: 0.25,
    details: `${historyCount.toLocaleString()} / ${target.toLocaleString()} history records`,
    requirements,
  };
}

/**
 * Calculate data quality score
 * Based on feature default rate and outliers
 */
async function calculateDataQualityScore(game: string): Promise<ComponentScore> {
  // Check correlation coverage as proxy for feature quality
  const [totalCards, cardsWithCorrelation] = await Promise.all([
    prisma.cardPriceV2.count({ where: { game } }),
    prisma.cardCorrelationCache.count({ where: { game } }),
  ]);

  // Check volume stats
  const volumeStats = await prisma.volumeStatistics.findFirst({
    where: { game },
    orderBy: { snapshotDate: "desc" },
  });

  const correlationRate = totalCards > 0 ? cardsWithCorrelation / totalCards : 0;
  const volumeCoverage = volumeStats?.totalCardsTracked ?
    Math.min(1, volumeStats.totalCardsTracked / totalCards) : 0;

  // Quality score is average of correlation and volume coverage
  const score = ((correlationRate + volumeCoverage) / 2) * 100;

  const requirements: string[] = [];
  if (correlationRate < 0.5) requirements.push("Need 50%+ correlation coverage");
  if (correlationRate < 0.8) requirements.push("Target 80%+ correlation coverage");
  if (volumeCoverage < 0.5) requirements.push("Need 50%+ volume data coverage");

  return {
    name: "Data Quality",
    score: Math.round(score),
    weight: 0.25,
    details: `Correlation: ${(correlationRate * 100).toFixed(1)}%, Volume: ${(volumeCoverage * 100).toFixed(1)}%`,
    requirements,
  };
}

/**
 * Calculate feature coverage score
 * Based on cards with sufficient history for all features
 */
async function calculateFeatureCoverageScore(game: string): Promise<ComponentScore> {
  // Count cards with 30+ days history (needed for full feature calculation)
  const result = await prisma.$queryRaw<[{ count: bigint }]>`
    SELECT COUNT(*) as count FROM (
      SELECT card_id
      FROM card_price_history
      WHERE game = ${game}
      GROUP BY card_id
      HAVING COUNT(DISTINCT DATE(snapshot_date)) >= 30
    ) sub
  `;

  const cardsWithFullHistory = Number(result[0]?.count || 0);
  const target = 800;
  const score = Math.min(100, (cardsWithFullHistory / target) * 100);

  const requirements: string[] = [];
  if (cardsWithFullHistory < 300) requirements.push("Need 300+ cards with 30d history for alpha");
  if (cardsWithFullHistory < 500) requirements.push("Need 500+ cards with 30d history for beta");
  if (cardsWithFullHistory < target) requirements.push("Need 800+ cards with 30d history for production");

  return {
    name: "Feature Coverage",
    score: Math.round(score),
    weight: 0.25,
    details: `${cardsWithFullHistory} / ${target} cards have 30+ days history`,
    requirements,
  };
}

/**
 * Calculate label balance score
 * Based on deal type distribution
 */
async function calculateLabelBalanceScore(game: string): Promise<ComponentScore> {
  const dealCounts = await prisma.neuralDeal.groupBy({
    by: ["dealType"],
    where: { game },
    _count: true,
  });

  const typeCount = dealCounts.length;
  const minCount = dealCounts.length > 0
    ? Math.min(...dealCounts.map((d) => d._count))
    : 0;
  const targetMinPerType = 300;

  // Score based on both type coverage and minimum count
  const typeCoverageScore = Math.min(100, (typeCount / 10) * 100); // 10 deal types
  const balanceScore = Math.min(100, (minCount / targetMinPerType) * 100);
  const score = (typeCoverageScore + balanceScore) / 2;

  const requirements: string[] = [];
  if (typeCount < 5) requirements.push("Need at least 5 deal types represented");
  if (minCount < 50) requirements.push("Need 50+ examples of each deal type for alpha");
  if (minCount < 100) requirements.push("Need 100+ examples of each deal type for beta");
  if (minCount < targetMinPerType) requirements.push("Need 300+ examples of each deal type for production");

  return {
    name: "Label Balance",
    score: Math.round(score),
    weight: 0.25,
    details: `${typeCount} deal types, min ${minCount} examples each`,
    requirements,
  };
}

// =============================================================================
// MAIN READINESS CHECK
// =============================================================================

function defineMilestones(score: number): TrainingMilestone[] {
  return [
    {
      name: "Alpha Training",
      minScore: 40,
      description: "Train with synthetic data, validate pipeline",
      reached: score >= 40,
    },
    {
      name: "Beta Training",
      minScore: 60,
      description: "Train with mixed data, tune hyperparameters",
      reached: score >= 60,
    },
    {
      name: "Production Training",
      minScore: 80,
      description: "Full training with quality data",
      reached: score >= 80,
    },
  ];
}

function estimateDaysToReady(
  currentScore: number,
  targetScore: number,
  dataGrowthRate: number
): number | null {
  if (currentScore >= targetScore) return 0;
  if (dataGrowthRate <= 0) return null;

  // Rough estimate: score growth proportional to data growth
  const scoreGap = targetScore - currentScore;
  const daysNeeded = Math.ceil(scoreGap / dataGrowthRate);

  return Math.min(daysNeeded, 90); // Cap at 90 days
}

function identifyBlockers(components: ComponentScore[]): string[] {
  const blockers: string[] = [];

  for (const component of components) {
    if (component.score < 30) {
      blockers.push(`${component.name} critically low (${component.score}%)`);
    }
    for (const req of component.requirements) {
      if (component.score < 40) {
        blockers.push(req);
      }
    }
  }

  return [...new Set(blockers)].slice(0, 5); // Top 5 unique blockers
}

async function main() {
  const config = parseArgs();

  if (!config.json) {
    console.log("=".repeat(60));
    console.log("Training Readiness Assessment");
    console.log("=".repeat(60));
    console.log(`Game: ${config.game}`);
    console.log(`Timestamp: ${new Date().toISOString()}`);
    console.log("");
  }

  try {
    // Calculate component scores
    const components = await Promise.all([
      calculateDataVolumeScore(config.game),
      calculateDataQualityScore(config.game),
      calculateFeatureCoverageScore(config.game),
      calculateLabelBalanceScore(config.game),
    ]);

    // Calculate overall readiness score
    const readinessScore = Math.round(
      components.reduce((sum, c) => sum + c.score * c.weight, 0)
    );

    // Define milestones
    const milestones = defineMilestones(readinessScore);

    // Find current and next milestone
    const currentMilestone =
      milestones.filter((m) => m.reached).pop()?.name || "Not Ready";
    const nextMilestone =
      milestones.find((m) => !m.reached)?.name || null;
    const nextMilestoneScore =
      milestones.find((m) => !m.reached)?.minScore || 100;

    // Estimate days to ready
    const estimatedDays = estimateDaysToReady(readinessScore, nextMilestoneScore, 2);

    // Identify blockers
    const blockers = identifyBlockers(components);

    // Get data stats
    const [
      totalCards,
      historyRecords,
      correlationRecords,
      dealRecords,
      cardsWithHistory,
      dealTypeCounts,
    ] = await Promise.all([
      prisma.cardPriceV2.count({ where: { game: config.game } }),
      prisma.cardPriceHistory.count({ where: { game: config.game } }),
      prisma.cardCorrelationCache.count({ where: { game: config.game } }),
      prisma.neuralDeal.count({ where: { game: config.game } }),
      prisma.cardPriceHistory.groupBy({
        by: ["cardId"],
        where: { game: config.game },
      }),
      prisma.neuralDeal.groupBy({
        by: ["dealType"],
        where: { game: config.game },
        _count: true,
      }),
    ]);

    const avgDaysPerCard = cardsWithHistory.length > 0
      ? historyRecords / cardsWithHistory.length
      : 0;

    const result: ReadinessResult = {
      timestamp: new Date().toISOString(),
      game: config.game,
      readinessScore,
      currentMilestone,
      nextMilestone,
      estimatedDaysToReady: estimatedDays,
      components,
      milestones,
      blockers,
      dataStats: {
        totalCards,
        cardsWithHistory: cardsWithHistory.length,
        historyRecords,
        correlationRecords,
        dealRecords,
        avgDaysPerCard: Math.round(avgDaysPerCard * 10) / 10,
        dealTypeCount: dealTypeCounts.length,
        minDealTypeCount: dealTypeCounts.length > 0
          ? Math.min(...dealTypeCounts.map((d) => d._count))
          : 0,
      },
    };

    if (config.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      // Print readiness score
      const scoreBar = "█".repeat(Math.floor(readinessScore / 5)) +
                       "░".repeat(20 - Math.floor(readinessScore / 5));
      console.log(`Readiness Score: ${readinessScore}/100`);
      console.log(`[${scoreBar}]`);
      console.log(`Current Milestone: ${currentMilestone}`);
      if (nextMilestone) {
        console.log(`Next Milestone: ${nextMilestone} (need ${nextMilestoneScore}+)`);
        if (estimatedDays !== null) {
          console.log(`Estimated Days: ${estimatedDays > 0 ? `~${estimatedDays}` : "Ready!"}`);
        }
      }

      // Print component breakdown
      console.log("\n" + "-".repeat(60));
      console.log("COMPONENT SCORES");
      console.log("-".repeat(60));
      console.log(
        "Component".padEnd(20) +
          "Score".padStart(10) +
          "Weight".padStart(10) +
          "Weighted".padStart(12)
      );
      console.log("-".repeat(60));

      for (const component of components) {
        const weighted = Math.round(component.score * component.weight);
        console.log(
          component.name.padEnd(20) +
            `${component.score}%`.padStart(10) +
            `${(component.weight * 100).toFixed(0)}%`.padStart(10) +
            `${weighted}`.padStart(12)
        );
        if (config.verbose) {
          console.log(`    ${component.details}`);
          for (const req of component.requirements) {
            console.log(`    - ${req}`);
          }
        }
      }

      // Print milestones
      console.log("\n" + "-".repeat(60));
      console.log("TRAINING MILESTONES");
      console.log("-".repeat(60));

      for (const milestone of milestones) {
        const icon = milestone.reached ? "[✓]" : "[ ]";
        console.log(`${icon} ${milestone.name} (${milestone.minScore}+): ${milestone.description}`);
      }

      // Print data stats
      console.log("\n" + "-".repeat(60));
      console.log("DATA STATISTICS");
      console.log("-".repeat(60));
      console.log(`Total cards: ${result.dataStats.totalCards.toLocaleString()}`);
      console.log(`Cards with history: ${result.dataStats.cardsWithHistory.toLocaleString()}`);
      console.log(`History records: ${result.dataStats.historyRecords.toLocaleString()}`);
      console.log(`Correlation records: ${result.dataStats.correlationRecords.toLocaleString()}`);
      console.log(`Deal records: ${result.dataStats.dealRecords.toLocaleString()}`);
      console.log(`Avg days per card: ${result.dataStats.avgDaysPerCard}`);
      console.log(`Deal types: ${result.dataStats.dealTypeCount} (min ${result.dataStats.minDealTypeCount} each)`);

      // Print blockers
      if (blockers.length > 0) {
        console.log("\n" + "-".repeat(60));
        console.log("BLOCKERS");
        console.log("-".repeat(60));
        for (const blocker of blockers) {
          console.log(`- ${blocker}`);
        }
      }

      // Print next steps
      console.log("\n" + "=".repeat(60));
      console.log("RECOMMENDED NEXT STEPS");
      console.log("=".repeat(60));

      if (readinessScore < 40) {
        console.log("1. Run: npx tsx scripts/bootstrap-historical-data.ts");
        console.log("2. Run: npx tsx scripts/seed-volume-data.ts");
        console.log("3. Run: npx tsx scripts/compute-statistics.ts");
        console.log("4. Run: npx tsx scripts/generate-synthetic-deals.ts");
      } else if (readinessScore < 60) {
        console.log("1. Continue daily data collection (snapshot-history.ts)");
        console.log("2. Run generate-synthetic-deals.ts for more training examples");
        console.log("3. Consider alpha training to validate pipeline");
      } else if (readinessScore < 80) {
        console.log("1. Ready for beta training!");
        console.log("2. Run: npx tsx scripts/train-neural-model.ts");
        console.log("3. Continue data collection to improve score");
      } else {
        console.log("READY FOR PRODUCTION TRAINING!");
        console.log("Run: npx tsx scripts/train-neural-model.ts --production");
      }
    }
  } catch (error) {
    console.error("Readiness check failed:", error);
    process.exit(1);
  }
}

main()
  .catch((error) => {
    console.error("Script failed:", error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
