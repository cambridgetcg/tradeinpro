/**
 * Compute Daily Statistics for ML Feature Calculation
 *
 * This script computes and caches statistics needed by the neural network:
 * - Rarity price distributions (for percentile_in_rarity)
 * - Set statistics (for set momentum)
 * - Volume statistics (for relative_volume)
 * - Card correlations (for correlation features)
 *
 * Run this daily via cron or scheduled task:
 *   npx tsx scripts/compute-statistics.ts
 *
 * Options:
 *   --stats-only    Only compute statistics, skip correlations
 *   --corr-only     Only compute correlations, skip statistics
 *   --batch-size=N  Correlation batch size (default: 100)
 *   --dry-run       Show what would be computed without persisting
 */

import { PrismaClient } from "@prisma/client";
import {
  computeAndPersistStatistics,
  type ComputeStatisticsResult,
} from "../app/lib/data-collection/services/statistics.server";
import {
  computeAndPersistCorrelations,
  type CorrelationComputeResult,
} from "../app/lib/data-collection/services/correlation.server";

const prisma = new PrismaClient();

interface RunOptions {
  statsOnly: boolean;
  corrOnly: boolean;
  batchSize: number;
  dryRun: boolean;
  game: string;
}

function parseArgs(): RunOptions {
  const args = process.argv.slice(2);
  return {
    statsOnly: args.includes("--stats-only"),
    corrOnly: args.includes("--corr-only"),
    batchSize: parseInt(
      args.find((a) => a.startsWith("--batch-size="))?.split("=")[1] || "100"
    ),
    dryRun: args.includes("--dry-run"),
    game: args.find((a) => a.startsWith("--game="))?.split("=")[1] || "onepiece",
  };
}

async function computeStatistics(
  game: string,
  dryRun: boolean
): Promise<ComputeStatisticsResult | null> {
  console.log("\n[Statistics] Computing price statistics...");

  if (dryRun) {
    // Just count what would be processed
    const cardCount = await prisma.cardPriceV2.count({
      where: { game, bestPriceGbp: { gt: 0 } },
    });
    const rarityCount = await prisma.cardPriceV2.groupBy({
      by: ["rarity"],
      where: { game, bestPriceGbp: { gt: 0 } },
    });
    const setCount = await prisma.cardPriceV2.groupBy({
      by: ["setCode"],
      where: { game, bestPriceGbp: { gt: 0 } },
    });

    console.log(`  [DRY RUN] Would process ${cardCount} cards`);
    console.log(`  [DRY RUN] Would compute ${rarityCount.length} rarity distributions`);
    console.log(`  [DRY RUN] Would compute ${setCount.length} set statistics`);
    return null;
  }

  const result = await computeAndPersistStatistics(prisma, game);

  console.log(`  Computed ${result.rarityStats.length} rarity distributions`);
  console.log(`  Computed ${result.setStats.length} set statistics`);
  console.log(`  Volume stats: ${result.volumeStats.totalCardsTracked} cards tracked`);

  return result;
}

async function computeCorrelations(
  game: string,
  batchSize: number,
  dryRun: boolean
): Promise<CorrelationComputeResult | null> {
  console.log("\n[Correlations] Computing card correlations...");

  if (dryRun) {
    // Count cards with sufficient history
    const cardsWithHistory = await prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(DISTINCT card_id) as count
      FROM card_price_history
      WHERE game = ${game}
      GROUP BY card_id
      HAVING COUNT(*) >= 7
    `;
    const count = Number(cardsWithHistory[0]?.count || 0);
    console.log(`  [DRY RUN] Would compute correlations for ~${count} cards`);
    return null;
  }

  const result = await computeAndPersistCorrelations(prisma, game, 30, batchSize);

  console.log(`  Computed ${result.computed} correlations`);
  console.log(`  Failed ${result.failed} (insufficient data or errors)`);

  return result;
}

async function main() {
  const options = parseArgs();

  console.log("=".repeat(60));
  console.log("Daily Statistics Computation");
  console.log("=".repeat(60));
  console.log(`Mode: ${options.dryRun ? "DRY RUN" : "LIVE"}`);
  console.log(`Game: ${options.game}`);
  console.log(`Stats only: ${options.statsOnly}`);
  console.log(`Corr only: ${options.corrOnly}`);
  console.log(`Batch size: ${options.batchSize}`);

  const startTime = Date.now();

  try {
    let statsResult: ComputeStatisticsResult | null = null;
    let corrResult: CorrelationComputeResult | null = null;

    // Compute statistics
    if (!options.corrOnly) {
      statsResult = await computeStatistics(options.game, options.dryRun);
    }

    // Compute correlations
    if (!options.statsOnly) {
      corrResult = await computeCorrelations(
        options.game,
        options.batchSize,
        options.dryRun
      );
    }

    // Summary
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log("\n" + "=".repeat(60));
    console.log("COMPUTATION COMPLETE");
    console.log("=".repeat(60));
    console.log(`Total time: ${elapsed}s`);

    if (statsResult) {
      console.log("\nStatistics:");
      console.log(`  - ${statsResult.rarityStats.length} rarity distributions`);
      console.log(`  - ${statsResult.setStats.length} set statistics`);
      console.log(`  - Volume: US avg ${statsResult.volumeStats.avgUsListings.toFixed(1)} listings`);
      console.log(`  - Volume: EU avg ${statsResult.volumeStats.avgEuListings.toFixed(1)} listings`);
    }

    if (corrResult) {
      console.log("\nCorrelations:");
      console.log(`  - ${corrResult.computed} cards computed`);
      console.log(`  - ${corrResult.failed} cards failed`);
    }

    // Show database counts
    if (!options.dryRun) {
      const counts = await Promise.all([
        prisma.rarityStatistics.count({ where: { game: options.game } }),
        prisma.setStatistics.count({ where: { game: options.game } }),
        prisma.cardCorrelationCache.count({ where: { game: options.game } }),
        prisma.volumeStatistics.count({ where: { game: options.game } }),
      ]);

      console.log("\nDatabase totals:");
      console.log(`  - rarity_statistics: ${counts[0]} records`);
      console.log(`  - set_statistics: ${counts[1]} records`);
      console.log(`  - card_correlation_cache: ${counts[2]} records`);
      console.log(`  - volume_statistics: ${counts[3]} records`);
    }
  } catch (error) {
    console.error("\nComputation failed:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
