/**
 * Snapshot History
 *
 * Creates daily CardPriceHistory records from current CardPriceV2 data.
 * This script should be run daily via cron to maintain continuous price history.
 *
 * Features:
 * - Creates snapshots for all cards with valid prices
 * - Calculates daily change percentage from previous snapshot
 * - Skips cards that already have a snapshot for today
 * - Updates VolumeStatistics after snapshotting
 *
 * Usage:
 *   npx tsx scripts/snapshot-history.ts [--dry-run] [--date=YYYY-MM-DD]
 *
 * Options:
 *   --dry-run           Show what would be created without persisting
 *   --date=YYYY-MM-DD   Snapshot for specific date (default: today)
 *   --game=<game>       Game to process (default: onepiece)
 *   --batch-size=N      Cards per batch (default: 100)
 *
 * Cron Example:
 *   0 3 * * * cd /app && npx tsx scripts/snapshot-history.ts >> /var/log/history.log 2>&1
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

interface SnapshotConfig {
  dryRun: boolean;
  date: Date;
  game: string;
  batchSize: number;
}

interface SnapshotResult {
  cardsProcessed: number;
  snapshotsCreated: number;
  snapshotsSkipped: number;
  errors: number;
  duration: number;
}

function parseArgs(): SnapshotConfig {
  const args = process.argv.slice(2);

  // Parse date argument
  const dateArg = args.find((a) => a.startsWith("--date="))?.split("=")[1];
  let date = new Date();
  if (dateArg) {
    date = new Date(dateArg);
    if (isNaN(date.getTime())) {
      console.error(`Invalid date format: ${dateArg}`);
      process.exit(1);
    }
  }
  date.setHours(0, 0, 0, 0);

  return {
    dryRun: args.includes("--dry-run"),
    date,
    game: args.find((a) => a.startsWith("--game="))?.split("=")[1] || "onepiece",
    batchSize: parseInt(
      args.find((a) => a.startsWith("--batch-size="))?.split("=")[1] || "100"
    ),
  };
}

/**
 * Get existing snapshot dates for today to avoid duplicates
 */
async function getExistingSnapshotsForDate(
  date: Date,
  game: string
): Promise<Set<string>> {
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);

  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);

  const existing = await prisma.cardPriceHistory.findMany({
    where: {
      game,
      snapshotDate: {
        gte: startOfDay,
        lte: endOfDay,
      },
    },
    select: { cardId: true },
  });

  return new Set(existing.map((e) => e.cardId));
}

/**
 * Get previous day's price for calculating change
 */
async function getPreviousPrice(
  cardId: string,
  beforeDate: Date
): Promise<number | null> {
  const record = await prisma.cardPriceHistory.findFirst({
    where: {
      cardId,
      snapshotDate: { lt: beforeDate },
    },
    orderBy: { snapshotDate: "desc" },
    select: { priceGbp: true },
  });

  return record?.priceGbp ? Number(record.priceGbp) : null;
}

/**
 * Create a snapshot for a single card
 */
async function createSnapshot(
  card: {
    cardId: string;
    game: string;
    setCode: string | null;
    bestPriceGbp: { toNumber: () => number } | null;
  },
  date: Date,
  previousPrice: number | null,
  dryRun: boolean
): Promise<boolean> {
  const currentPrice = card.bestPriceGbp?.toNumber() ?? 0;

  if (currentPrice <= 0) {
    return false;
  }

  // Calculate change from previous day
  let change = 0;
  if (previousPrice && previousPrice > 0) {
    change = (currentPrice - previousPrice) / previousPrice;
  }

  const dateKey = date.toISOString().split("T")[0];
  const id = `${card.cardId}-${dateKey}`;

  if (dryRun) {
    console.log(
      `  [DRY RUN] Would create snapshot for ${card.cardId}: £${currentPrice.toFixed(2)} (${change >= 0 ? "+" : ""}${(change * 100).toFixed(2)}%)`
    );
    return true;
  }

  try {
    await prisma.cardPriceHistory.create({
      data: {
        id,
        cardId: card.cardId,
        game: card.game,
        setCode: card.setCode,
        priceGbp: currentPrice,
        sourceUsed: "daily_snapshot",
        change,
        snapshotDate: date,
      },
    });
    return true;
  } catch (error) {
    // Handle unique constraint violations gracefully
    if ((error as { code?: string }).code === "P2002") {
      return false; // Already exists
    }
    throw error;
  }
}

/**
 * Update aggregate statistics after snapshotting
 */
async function updateAggregates(game: string, dryRun: boolean): Promise<void> {
  console.log("\n[Aggregates] Updating statistics...");

  if (dryRun) {
    console.log("  [DRY RUN] Would update aggregate statistics");
    return;
  }

  // Calculate total history records
  const totalHistory = await prisma.cardPriceHistory.count({
    where: { game },
  });

  // Calculate cards with history
  const cardsWithHistory = await prisma.cardPriceHistory.groupBy({
    by: ["cardId"],
    where: { game },
  });

  // Calculate average days per card
  const avgDaysPerCard = totalHistory / Math.max(1, cardsWithHistory.length);

  console.log(`  Total history records: ${totalHistory}`);
  console.log(`  Cards with history: ${cardsWithHistory.length}`);
  console.log(`  Avg days per card: ${avgDaysPerCard.toFixed(1)}`);
}

async function main() {
  const config = parseArgs();
  const startTime = Date.now();

  console.log("=".repeat(60));
  console.log("Daily History Snapshot");
  console.log("=".repeat(60));
  console.log(`Mode: ${config.dryRun ? "DRY RUN" : "LIVE"}`);
  console.log(`Date: ${config.date.toISOString().split("T")[0]}`);
  console.log(`Game: ${config.game}`);
  console.log(`Batch size: ${config.batchSize}`);

  const result: SnapshotResult = {
    cardsProcessed: 0,
    snapshotsCreated: 0,
    snapshotsSkipped: 0,
    errors: 0,
    duration: 0,
  };

  try {
    // Get existing snapshots for today
    console.log("\nChecking existing snapshots...");
    const existingSnapshots = await getExistingSnapshotsForDate(
      config.date,
      config.game
    );
    console.log(`  Found ${existingSnapshots.size} existing snapshots for today`);

    // Get all cards with valid prices
    console.log("\nFetching cards with valid prices...");
    const cards = await prisma.cardPriceV2.findMany({
      where: {
        game: config.game,
        bestPriceGbp: { gt: 0 },
      },
      select: {
        cardId: true,
        game: true,
        setCode: true,
        bestPriceGbp: true,
      },
    });
    console.log(`  Found ${cards.length} cards to process`);

    // Process in batches
    console.log("\nCreating snapshots...");

    for (let i = 0; i < cards.length; i += config.batchSize) {
      const batch = cards.slice(i, i + config.batchSize);
      const batchNum = Math.floor(i / config.batchSize) + 1;
      const totalBatches = Math.ceil(cards.length / config.batchSize);

      process.stdout.write(`\r  Batch ${batchNum}/${totalBatches}...`);

      for (const card of batch) {
        result.cardsProcessed++;

        // Skip if already has snapshot for today
        if (existingSnapshots.has(card.cardId)) {
          result.snapshotsSkipped++;
          continue;
        }

        try {
          // Get previous price for change calculation
          const previousPrice = await getPreviousPrice(card.cardId, config.date);

          const created = await createSnapshot(
            {
              cardId: card.cardId,
              game: card.game,
              setCode: card.setCode,
              bestPriceGbp: card.bestPriceGbp
                ? { toNumber: () => Number(card.bestPriceGbp) }
                : null,
            },
            config.date,
            previousPrice,
            config.dryRun
          );

          if (created) {
            result.snapshotsCreated++;
          } else {
            result.snapshotsSkipped++;
          }
        } catch (error) {
          result.errors++;
          console.error(`\n  Error for ${card.cardId}:`, error);
        }
      }
    }

    // Update aggregates
    await updateAggregates(config.game, config.dryRun);

    result.duration = Date.now() - startTime;

    // Summary
    console.log("\n\n" + "=".repeat(60));
    console.log("SNAPSHOT SUMMARY");
    console.log("=".repeat(60));
    console.log(`Cards processed: ${result.cardsProcessed}`);
    console.log(`Snapshots created: ${result.snapshotsCreated}`);
    console.log(`Snapshots skipped: ${result.snapshotsSkipped} (already exist)`);
    console.log(`Errors: ${result.errors}`);
    console.log(`Duration: ${(result.duration / 1000).toFixed(1)}s`);

    if (config.dryRun) {
      console.log("\n[DRY RUN] No records were actually created.");
    }

    // Show database status
    if (!config.dryRun) {
      const [totalRecords, uniqueCards, todayRecords] = await Promise.all([
        prisma.cardPriceHistory.count({ where: { game: config.game } }),
        prisma.cardPriceHistory.groupBy({
          by: ["cardId"],
          where: { game: config.game },
        }),
        prisma.cardPriceHistory.count({
          where: {
            game: config.game,
            snapshotDate: {
              gte: config.date,
              lt: new Date(config.date.getTime() + 24 * 60 * 60 * 1000),
            },
          },
        }),
      ]);

      console.log("\nDatabase Status:");
      console.log(`  Total CardPriceHistory records: ${totalRecords}`);
      console.log(`  Unique cards with history: ${uniqueCards.length}`);
      console.log(`  Records for today: ${todayRecords}`);
      console.log(
        `  Average days per card: ${(totalRecords / Math.max(1, uniqueCards.length)).toFixed(1)}`
      );
    }
  } catch (error) {
    console.error("\nSnapshot failed:", error);
    process.exit(1);
  }
}

main()
  .catch((error) => {
    console.error("\nScript failed:", error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
