/**
 * Bootstrap Historical Data
 *
 * Creates CardPriceHistory records from existing CardPriceV2 data to establish
 * baseline training data for the neural network. This script:
 *
 * 1. Takes current prices from CardPriceV2 and creates daily snapshots
 * 2. Fills gaps in existing CardPriceHistory
 * 3. Calculates change percentages from consecutive days
 *
 * Usage:
 *   npx tsx scripts/bootstrap-historical-data.ts [--dry-run] [--days=N] [--batch-size=N]
 *
 * Options:
 *   --dry-run       Show what would be created without persisting
 *   --days=N        Number of days to bootstrap (default: 1, just today)
 *   --batch-size=N  Cards per batch (default: 100)
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

interface BootstrapConfig {
  dryRun: boolean;
  days: number;
  batchSize: number;
}

interface BootstrapResult {
  cardsProcessed: number;
  recordsCreated: number;
  recordsSkipped: number;
  errors: number;
  duration: number;
}

function parseArgs(): BootstrapConfig {
  const args = process.argv.slice(2);
  return {
    dryRun: args.includes("--dry-run"),
    days: parseInt(args.find((a) => a.startsWith("--days="))?.split("=")[1] || "1"),
    batchSize: parseInt(args.find((a) => a.startsWith("--batch-size="))?.split("=")[1] || "100"),
  };
}

function normalizeDate(date: Date): Date {
  const normalized = new Date(date);
  normalized.setHours(0, 0, 0, 0);
  return normalized;
}

async function getExistingHistoryDates(cardId: string): Promise<Set<string>> {
  const records = await prisma.cardPriceHistory.findMany({
    where: { cardId },
    select: { snapshotDate: true },
  });

  const dates = new Set<string>();
  for (const record of records) {
    dates.add(normalizeDate(record.snapshotDate).toISOString().split("T")[0]);
  }
  return dates;
}

async function getPreviousPrice(cardId: string, date: Date): Promise<number | null> {
  const previousRecord = await prisma.cardPriceHistory.findFirst({
    where: {
      cardId,
      snapshotDate: { lt: date },
    },
    orderBy: { snapshotDate: "desc" },
    select: { priceGbp: true },
  });

  return previousRecord?.priceGbp?.toNumber() ?? null;
}

async function bootstrapCard(
  card: {
    cardId: string;
    game: string;
    setCode: string | null;
    bestPriceGbp: { toNumber: () => number } | null;
  },
  dates: Date[],
  config: BootstrapConfig
): Promise<{ created: number; skipped: number; errors: number }> {
  const result = { created: 0, skipped: 0, errors: 0 };

  const currentPrice = card.bestPriceGbp?.toNumber() ?? 0;
  if (currentPrice <= 0) {
    return result;
  }

  // Get existing history dates for this card
  const existingDates = await getExistingHistoryDates(card.cardId);

  for (const date of dates) {
    const dateKey = date.toISOString().split("T")[0];

    // Skip if already exists
    if (existingDates.has(dateKey)) {
      result.skipped++;
      continue;
    }

    try {
      // Get previous price for change calculation
      const previousPrice = await getPreviousPrice(card.cardId, date);
      const change = previousPrice && previousPrice > 0
        ? (currentPrice - previousPrice) / previousPrice
        : 0;

      if (!config.dryRun) {
        await prisma.cardPriceHistory.create({
          data: {
            id: `${card.cardId}-${dateKey}`,
            cardId: card.cardId,
            game: card.game,
            setCode: card.setCode,
            priceGbp: currentPrice,
            sourceUsed: "bootstrap",
            change: change,
            snapshotDate: date,
          },
        });
      }

      result.created++;
    } catch (error) {
      // Handle unique constraint violations gracefully
      if ((error as { code?: string }).code === "P2002") {
        result.skipped++;
      } else {
        result.errors++;
        console.error(`  Error for ${card.cardId} on ${dateKey}:`, error);
      }
    }
  }

  return result;
}

async function main() {
  const config = parseArgs();
  const startTime = Date.now();

  console.log("=".repeat(60));
  console.log("Bootstrap Historical Data");
  console.log("=".repeat(60));
  console.log(`Mode: ${config.dryRun ? "DRY RUN" : "LIVE"}`);
  console.log(`Days to bootstrap: ${config.days}`);
  console.log(`Batch size: ${config.batchSize}`);

  // Generate dates to bootstrap
  const today = normalizeDate(new Date());
  const dates: Date[] = [];
  for (let i = 0; i < config.days; i++) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    dates.push(date);
  }
  console.log(`Date range: ${dates[dates.length - 1].toISOString().split("T")[0]} to ${dates[0].toISOString().split("T")[0]}`);

  // Get all cards with valid prices
  const cards = await prisma.cardPriceV2.findMany({
    where: {
      bestPriceGbp: { gt: 0 },
    },
    select: {
      cardId: true,
      game: true,
      setCode: true,
      bestPriceGbp: true,
    },
  });

  console.log(`\nFound ${cards.length} cards to process`);

  // Process in batches
  const result: BootstrapResult = {
    cardsProcessed: 0,
    recordsCreated: 0,
    recordsSkipped: 0,
    errors: 0,
    duration: 0,
  };

  for (let i = 0; i < cards.length; i += config.batchSize) {
    const batch = cards.slice(i, i + config.batchSize);
    const batchNum = Math.floor(i / config.batchSize) + 1;
    const totalBatches = Math.ceil(cards.length / config.batchSize);

    process.stdout.write(`\rProcessing batch ${batchNum}/${totalBatches}...`);

    for (const card of batch) {
      const cardResult = await bootstrapCard(card, dates, config);
      result.cardsProcessed++;
      result.recordsCreated += cardResult.created;
      result.recordsSkipped += cardResult.skipped;
      result.errors += cardResult.errors;
    }
  }

  result.duration = Date.now() - startTime;

  // Summary
  console.log("\n\n" + "=".repeat(60));
  console.log("BOOTSTRAP SUMMARY");
  console.log("=".repeat(60));
  console.log(`Cards processed: ${result.cardsProcessed}`);
  console.log(`Records created: ${result.recordsCreated}`);
  console.log(`Records skipped: ${result.recordsSkipped} (already exist)`);
  console.log(`Errors: ${result.errors}`);
  console.log(`Duration: ${(result.duration / 1000).toFixed(1)}s`);

  if (config.dryRun) {
    console.log("\n[DRY RUN] No records were actually created.");
  }

  // Show current database counts
  if (!config.dryRun) {
    const totalHistory = await prisma.cardPriceHistory.count();
    const uniqueCards = await prisma.cardPriceHistory.groupBy({
      by: ["cardId"],
    });
    const avgDaysPerCard = totalHistory / uniqueCards.length;

    console.log("\nDatabase Status:");
    console.log(`  Total CardPriceHistory records: ${totalHistory}`);
    console.log(`  Cards with history: ${uniqueCards.length}`);
    console.log(`  Average days per card: ${avgDaysPerCard.toFixed(1)}`);
  }
}

main()
  .catch((error) => {
    console.error("\nBootstrap failed:", error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
