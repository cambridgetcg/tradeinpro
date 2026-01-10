/**
 * Seed Volume Data
 *
 * Populates MarketPriceUS and MarketPriceEU tables with volume/inventory data
 * required for ML feature calculation. This script:
 *
 * 1. Fetches JustTCG card data with variants for US volume metrics
 * 2. Processes Cardmarket CSV exports for EU volume metrics
 * 3. Updates VolumeStatistics aggregates
 *
 * Usage:
 *   npx tsx scripts/seed-volume-data.ts [--dry-run] [--source=justtcg|cardmarket|both]
 *
 * Options:
 *   --dry-run           Show what would be created without persisting
 *   --source=<source>   Data source to seed (default: both)
 *   --csv-path=<path>   Path to Cardmarket CSV file (for cardmarket source)
 *   --batch-size=N      Cards per batch (default: 50)
 *   --game=<game>       Game to process (default: onepiece)
 */

import { PrismaClient } from "@prisma/client";
import {
  JustTCGClient,
  extractVolumeMetrics,
  extractMomentumMetrics,
} from "../app/lib/data-collection/clients/justtcg.server";
import {
  parseCardmarketCSVFile,
  matchCardmarketToCardId,
  expansionToSetCode,
} from "../app/lib/data-collection/clients/cardmarket-csv.server";
import type { JustTCGCard } from "../app/lib/data-collection/types";

const prisma = new PrismaClient();

interface SeedConfig {
  dryRun: boolean;
  source: "justtcg" | "cardmarket" | "both";
  csvPath: string | null;
  batchSize: number;
  game: string;
}

interface SeedResult {
  usRecordsCreated: number;
  usRecordsUpdated: number;
  euRecordsCreated: number;
  euRecordsUpdated: number;
  errors: number;
  duration: number;
}

function parseArgs(): SeedConfig {
  const args = process.argv.slice(2);
  const sourceArg = args.find((a) => a.startsWith("--source="))?.split("=")[1];

  return {
    dryRun: args.includes("--dry-run"),
    source: (sourceArg as SeedConfig["source"]) || "both",
    csvPath: args.find((a) => a.startsWith("--csv-path="))?.split("=")[1] || null,
    batchSize: parseInt(
      args.find((a) => a.startsWith("--batch-size="))?.split("=")[1] || "50"
    ),
    game: args.find((a) => a.startsWith("--game="))?.split("=")[1] || "onepiece",
  };
}

/**
 * Normalize JustTCG card ID to our internal format
 */
function normalizeJustTCGCardId(justTCGId: string): string {
  // JustTCG uses lowercase IDs, we use uppercase
  // Format: "one-piece-op01-001" -> "OP01-001"
  const match = justTCGId.match(/op(\d+)-(\d+)/i);
  if (match) {
    return `OP${match[1].padStart(2, "0")}-${match[2].padStart(3, "0")}`;
  }
  return justTCGId.toUpperCase();
}

/**
 * Seed volume data from JustTCG API
 */
async function seedFromJustTCG(
  config: SeedConfig
): Promise<{ created: number; updated: number; errors: number }> {
  console.log("\n[JustTCG] Fetching card data with volume metrics...");

  const result = { created: 0, updated: 0, errors: 0 };

  try {
    const client = new JustTCGClient(
      process.env.JUSTTCG_API_KEY || "",
      "professional"
    );

    // Fetch all One Piece cards with statistics
    let fetchedCount = 0;
    const allCards: JustTCGCard[] = [];

    console.log("  Fetching all cards (this may take a while)...");

    const cards = await client.fetchAllOnePieceCards(true, (fetched, batch) => {
      fetchedCount = fetched;
      process.stdout.write(`\r  Batch ${batch}: ${fetched} cards fetched`);
    });

    allCards.push(...cards);
    console.log(`\n  Total cards fetched: ${allCards.length}`);

    // Map JustTCG cards to our card IDs
    const ourCards = await prisma.cardPriceV2.findMany({
      where: { game: config.game },
      select: { cardId: true, name: true, setCode: true },
    });

    const cardIdMap = new Map<string, string>();
    for (const card of ourCards) {
      // Try to match by various patterns
      const upperCardId = card.cardId.toUpperCase();
      cardIdMap.set(upperCardId, card.cardId);

      // Also map without variant suffix
      const baseId = upperCardId.split("-").slice(0, 2).join("-");
      if (!cardIdMap.has(baseId)) {
        cardIdMap.set(baseId, card.cardId);
      }
    }

    console.log(`  Mapped ${cardIdMap.size} card IDs from database`);

    // Process cards in batches
    const collectedAt = new Date();

    for (let i = 0; i < allCards.length; i += config.batchSize) {
      const batch = allCards.slice(i, i + config.batchSize);
      const batchNum = Math.floor(i / config.batchSize) + 1;
      const totalBatches = Math.ceil(allCards.length / config.batchSize);

      process.stdout.write(`\r  Processing batch ${batchNum}/${totalBatches}...`);

      for (const justTCGCard of batch) {
        try {
          // Normalize card ID
          const normalizedId = normalizeJustTCGCardId(justTCGCard.id);
          const matchedCardId =
            cardIdMap.get(normalizedId) || cardIdMap.get(justTCGCard.id.toUpperCase());

          if (!matchedCardId) {
            // Card not in our database, skip
            continue;
          }

          // Extract volume and momentum metrics
          const volumeMetrics = extractVolumeMetrics(justTCGCard);
          const momentumMetrics = extractMomentumMetrics(justTCGCard);
          const stats = justTCGCard.statistics;

          if (config.dryRun) {
            console.log(
              `\n    [DRY RUN] Would upsert MarketPriceUS for ${matchedCardId}:`,
              {
                listingsCount: volumeMetrics.listingsCount,
                conditionsAvailable: volumeMetrics.conditionsAvailable,
              }
            );
            result.created++;
            continue;
          }

          // Upsert to MarketPriceUS
          const existing = await prisma.marketPriceUS.findFirst({
            where: {
              cardId: matchedCardId,
              source: "justtcg",
            },
            orderBy: { collectedAt: "desc" },
          });

          if (existing) {
            // Update if data is newer
            await prisma.marketPriceUS.update({
              where: { id: existing.id },
              data: {
                marketPrice: justTCGCard.price,
                lowPrice: stats?.min,
                midPrice: stats?.avg,
                highPrice: stats?.max,
                inventoryPrice: volumeMetrics.inventoryPressure
                  ? justTCGCard.price * (1 + volumeMetrics.inventoryPressure)
                  : null,
                change24h: stats?.change24h,
                change7d: stats?.change7d,
                change30d: stats?.change30d,
                change90d: stats?.change90d,
                avgPrice: stats?.avg,
                minPrice: stats?.min,
                maxPrice: stats?.max,
                stdDev: stats?.stdDev,
                trendSlope: stats?.trendSlope,
                listingsCount: volumeMetrics.listingsCount,
                conditionsAvailable: volumeMetrics.conditionsAvailable,
                collectedAt,
                sourceUpdatedAt: justTCGCard.lastUpdated
                  ? new Date(justTCGCard.lastUpdated)
                  : null,
              },
            });
            result.updated++;
          } else {
            await prisma.marketPriceUS.create({
              data: {
                cardId: matchedCardId,
                source: "justtcg",
                marketPrice: justTCGCard.price,
                lowPrice: stats?.min,
                midPrice: stats?.avg,
                highPrice: stats?.max,
                inventoryPrice: volumeMetrics.inventoryPressure
                  ? justTCGCard.price * (1 + volumeMetrics.inventoryPressure)
                  : null,
                change24h: stats?.change24h,
                change7d: stats?.change7d,
                change30d: stats?.change30d,
                change90d: stats?.change90d,
                avgPrice: stats?.avg,
                minPrice: stats?.min,
                maxPrice: stats?.max,
                stdDev: stats?.stdDev,
                trendSlope: stats?.trendSlope,
                listingsCount: volumeMetrics.listingsCount,
                conditionsAvailable: volumeMetrics.conditionsAvailable,
                collectedAt,
                sourceUpdatedAt: justTCGCard.lastUpdated
                  ? new Date(justTCGCard.lastUpdated)
                  : null,
              },
            });
            result.created++;
          }
        } catch (error) {
          result.errors++;
          console.error(`\n  Error processing card ${justTCGCard.id}:`, error);
        }
      }
    }

    console.log("\n");
  } catch (error) {
    console.error("\n[JustTCG] Error:", error);
    result.errors++;
  }

  return result;
}

/**
 * Seed volume data from Cardmarket CSV
 */
async function seedFromCardmarket(
  config: SeedConfig
): Promise<{ created: number; updated: number; errors: number }> {
  console.log("\n[Cardmarket] Processing CSV file...");

  const result = { created: 0, updated: 0, errors: 0 };

  if (!config.csvPath) {
    console.log("  No CSV path provided. Looking for CSV files in data directory...");

    // Try to find CSV files in common locations
    const fs = await import("fs/promises");
    const path = await import("path");

    const possiblePaths = [
      "data/cardmarket.csv",
      "data/cardmarket-prices.csv",
      "data/one-piece-cardmarket.csv",
      "../data/cardmarket.csv",
    ];

    for (const tryPath of possiblePaths) {
      try {
        await fs.access(path.resolve(process.cwd(), tryPath));
        config.csvPath = tryPath;
        console.log(`  Found CSV at: ${tryPath}`);
        break;
      } catch {
        // File doesn't exist, try next
      }
    }

    if (!config.csvPath) {
      console.log("  No CSV file found. Skipping Cardmarket seeding.");
      console.log("  To seed from Cardmarket, use: --csv-path=/path/to/cardmarket.csv");
      return result;
    }
  }

  try {
    console.log(`  Parsing: ${config.csvPath}`);
    const parseResult = await parseCardmarketCSVFile(config.csvPath);

    console.log(`  Parsed ${parseResult.validRows} valid rows`);
    console.log(`  Skipped ${parseResult.skippedRows} invalid rows`);

    // Get our card database for matching
    const ourCards = await prisma.cardPriceV2.findMany({
      where: { game: config.game },
      select: { cardId: true, name: true, setCode: true },
    });

    console.log(`  Matching against ${ourCards.length} cards in database...`);

    const collectedAt = new Date();
    let matched = 0;
    let unmatched = 0;

    for (const row of parseResult.rows) {
      try {
        // Try to match to our card ID
        const matchedCardId = matchCardmarketToCardId(row, ourCards);

        if (!matchedCardId) {
          unmatched++;
          continue;
        }

        matched++;

        if (config.dryRun) {
          console.log(`  [DRY RUN] Would upsert MarketPriceEU for ${matchedCardId}:`, {
            trendPrice: row.trendPrice,
            availableItems: row.availableItems,
          });
          result.created++;
          continue;
        }

        // Upsert to MarketPriceEU
        const existing = await prisma.marketPriceEU.findFirst({
          where: {
            cardId: matchedCardId,
            source: "cardmarket_csv",
          },
          orderBy: { collectedAt: "desc" },
        });

        if (existing) {
          await prisma.marketPriceEU.update({
            where: { id: existing.id },
            data: {
              trendPrice: row.trendPrice,
              avgPrice: row.avgSellPrice,
              lowPrice: row.lowPrice,
              avg1d: row.avg1d,
              avg7d: row.avg7d,
              avg30d: row.avg30d,
              availableItems: row.availableItems,
              availableFoils: row.availableFoils,
              collectedAt,
            },
          });
          result.updated++;
        } else {
          await prisma.marketPriceEU.create({
            data: {
              cardId: matchedCardId,
              source: "cardmarket_csv",
              trendPrice: row.trendPrice,
              avgPrice: row.avgSellPrice,
              lowPrice: row.lowPrice,
              avg1d: row.avg1d,
              avg7d: row.avg7d,
              avg30d: row.avg30d,
              availableItems: row.availableItems,
              availableFoils: row.availableFoils,
              collectedAt,
            },
          });
          result.created++;
        }
      } catch (error) {
        result.errors++;
        console.error(`  Error processing row for ${row.name}:`, error);
      }
    }

    console.log(`  Matched: ${matched} cards`);
    console.log(`  Unmatched: ${unmatched} cards`);
  } catch (error) {
    console.error("[Cardmarket] Error:", error);
    result.errors++;
  }

  return result;
}

/**
 * Update VolumeStatistics aggregates after seeding
 */
async function updateVolumeStatistics(
  game: string,
  dryRun: boolean
): Promise<void> {
  console.log("\n[VolumeStatistics] Updating aggregates...");

  if (dryRun) {
    console.log("  [DRY RUN] Would update volume statistics");
    return;
  }

  // Calculate US listing averages
  const usStats = await prisma.marketPriceUS.aggregate({
    where: {
      listingsCount: { gt: 0 },
    },
    _avg: {
      listingsCount: true,
    },
    _count: true,
  });

  // Calculate EU inventory averages
  const euStats = await prisma.marketPriceEU.aggregate({
    where: {
      availableItems: { gt: 0 },
    },
    _avg: {
      availableItems: true,
    },
    _count: true,
  });

  const avgUsListings = usStats._avg.listingsCount || 0;
  const avgEuListings = euStats._avg.availableItems || 0;
  const totalCardsTracked = usStats._count + euStats._count;

  // Upsert volume statistics
  await prisma.volumeStatistics.upsert({
    where: {
      game_snapshotDate: {
        game,
        snapshotDate: new Date(new Date().setHours(0, 0, 0, 0)),
      },
    },
    update: {
      avgUsListings,
      avgEuListings,
      totalCardsTracked,
    },
    create: {
      game,
      avgUsListings,
      avgEuListings,
      totalCardsTracked,
      avgListingsByRarity: {},
      snapshotDate: new Date(new Date().setHours(0, 0, 0, 0)),
    },
  });

  console.log(`  US avg listings: ${avgUsListings.toFixed(1)}`);
  console.log(`  EU avg listings: ${avgEuListings.toFixed(1)}`);
  console.log(`  Total cards tracked: ${totalCardsTracked}`);
}

async function main() {
  const config = parseArgs();
  const startTime = Date.now();

  console.log("=".repeat(60));
  console.log("Seed Volume Data");
  console.log("=".repeat(60));
  console.log(`Mode: ${config.dryRun ? "DRY RUN" : "LIVE"}`);
  console.log(`Source: ${config.source}`);
  console.log(`Game: ${config.game}`);
  if (config.csvPath) {
    console.log(`CSV path: ${config.csvPath}`);
  }
  console.log(`Batch size: ${config.batchSize}`);

  const result: SeedResult = {
    usRecordsCreated: 0,
    usRecordsUpdated: 0,
    euRecordsCreated: 0,
    euRecordsUpdated: 0,
    errors: 0,
    duration: 0,
  };

  try {
    // Seed from JustTCG
    if (config.source === "justtcg" || config.source === "both") {
      const justtcgResult = await seedFromJustTCG(config);
      result.usRecordsCreated += justtcgResult.created;
      result.usRecordsUpdated += justtcgResult.updated;
      result.errors += justtcgResult.errors;
    }

    // Seed from Cardmarket
    if (config.source === "cardmarket" || config.source === "both") {
      const cardmarketResult = await seedFromCardmarket(config);
      result.euRecordsCreated += cardmarketResult.created;
      result.euRecordsUpdated += cardmarketResult.updated;
      result.errors += cardmarketResult.errors;
    }

    // Update aggregates
    await updateVolumeStatistics(config.game, config.dryRun);

    result.duration = Date.now() - startTime;

    // Summary
    console.log("\n" + "=".repeat(60));
    console.log("SEED SUMMARY");
    console.log("=".repeat(60));
    console.log(`US records created: ${result.usRecordsCreated}`);
    console.log(`US records updated: ${result.usRecordsUpdated}`);
    console.log(`EU records created: ${result.euRecordsCreated}`);
    console.log(`EU records updated: ${result.euRecordsUpdated}`);
    console.log(`Errors: ${result.errors}`);
    console.log(`Duration: ${(result.duration / 1000).toFixed(1)}s`);

    if (config.dryRun) {
      console.log("\n[DRY RUN] No records were actually created.");
    }

    // Show database counts
    if (!config.dryRun) {
      const [usCount, euCount, volumeStats] = await Promise.all([
        prisma.marketPriceUS.count(),
        prisma.marketPriceEU.count(),
        prisma.volumeStatistics.findFirst({
          where: { game: config.game },
          orderBy: { snapshotDate: "desc" },
        }),
      ]);

      console.log("\nDatabase Status:");
      console.log(`  MarketPriceUS records: ${usCount}`);
      console.log(`  MarketPriceEU records: ${euCount}`);
      if (volumeStats) {
        console.log(
          `  VolumeStatistics: ${volumeStats.totalCardsTracked} cards tracked`
        );
      }
    }
  } catch (error) {
    console.error("\nSeeding failed:", error);
    process.exit(1);
  }
}

main()
  .catch((error) => {
    console.error("\nScript failed:", error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
