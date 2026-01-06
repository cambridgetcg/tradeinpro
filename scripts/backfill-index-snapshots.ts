/**
 * Backfill Price Index Snapshots
 *
 * Calculates historical index snapshots from card_price_history data.
 * Run after importing historical price data.
 *
 * Usage: npx tsx scripts/backfill-index-snapshots.ts [--dry-run]
 */

import { PrismaClient, Prisma } from "@prisma/client";

const prisma = new PrismaClient();

interface DateStats {
  date: Date;
  game: string;
  setCode: string | null;
  cardCount: number;
  totalValue: number;
  avgPrice: number;
  highPrice: number;
  lowPrice: number;
  variance: number;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  console.log("=".repeat(60));
  console.log("Backfill Price Index Snapshots (Optimized)");
  console.log("=".repeat(60));
  console.log(`Mode: ${dryRun ? "DRY RUN" : "LIVE"}`);

  try {
    // Calculate all stats in one query using raw SQL for performance
    console.log("\nCalculating game index stats...");

    // Game-level index stats
    const gameStats = await prisma.$queryRaw<{
      snapshot_date: Date;
      game: string;
      card_count: bigint;
      total_value: Prisma.Decimal;
      avg_price: Prisma.Decimal;
      high_price: Prisma.Decimal;
      low_price: Prisma.Decimal;
      variance: Prisma.Decimal;
    }[]>`
      SELECT
        snapshot_date,
        game,
        COUNT(*) as card_count,
        SUM(price_gbp) as total_value,
        AVG(price_gbp) as avg_price,
        MAX(price_gbp) as high_price,
        MIN(price_gbp) as low_price,
        VARIANCE(price_gbp) as variance
      FROM card_price_history
      WHERE price_gbp > 0.5
      GROUP BY snapshot_date, game
      ORDER BY snapshot_date, game
    `;

    console.log(`  Found ${gameStats.length} game-date combinations`);

    // Set-level index stats
    console.log("\nCalculating set index stats...");
    const setStats = await prisma.$queryRaw<{
      snapshot_date: Date;
      game: string;
      set_code: string;
      card_count: bigint;
      total_value: Prisma.Decimal;
      avg_price: Prisma.Decimal;
      high_price: Prisma.Decimal;
      low_price: Prisma.Decimal;
      variance: Prisma.Decimal;
    }[]>`
      SELECT
        snapshot_date,
        game,
        set_code,
        COUNT(*) as card_count,
        SUM(price_gbp) as total_value,
        AVG(price_gbp) as avg_price,
        MAX(price_gbp) as high_price,
        MIN(price_gbp) as low_price,
        VARIANCE(price_gbp) as variance
      FROM card_price_history
      WHERE price_gbp > 0.5 AND set_code IS NOT NULL
      GROUP BY snapshot_date, game, set_code
      HAVING COUNT(*) >= 3
      ORDER BY snapshot_date, set_code
    `;

    console.log(`  Found ${setStats.length} set-date combinations`);

    // Top 100 stats (per date)
    console.log("\nCalculating Top 100 index stats...");
    const top100Stats = await prisma.$queryRaw<{
      snapshot_date: Date;
      card_count: bigint;
      total_value: Prisma.Decimal;
      avg_price: Prisma.Decimal;
      high_price: Prisma.Decimal;
      low_price: Prisma.Decimal;
      variance: Prisma.Decimal;
    }[]>`
      WITH ranked AS (
        SELECT
          snapshot_date,
          price_gbp,
          ROW_NUMBER() OVER (PARTITION BY snapshot_date ORDER BY price_gbp DESC) as rn
        FROM card_price_history
        WHERE price_gbp > 1
      )
      SELECT
        snapshot_date,
        COUNT(*) as card_count,
        SUM(price_gbp) as total_value,
        AVG(price_gbp) as avg_price,
        MAX(price_gbp) as high_price,
        MIN(price_gbp) as low_price,
        VARIANCE(price_gbp) as variance
      FROM ranked
      WHERE rn <= 100
      GROUP BY snapshot_date
      ORDER BY snapshot_date
    `;

    console.log(`  Found ${top100Stats.length} dates with Top 100 data`);

    // Build value maps for change calculation
    console.log("\nBuilding value maps for change calculation...");

    const gameValueMap = new Map<string, Map<number, number>>();
    for (const stat of gameStats) {
      const key = `GAME_${stat.game}`;
      if (!gameValueMap.has(key)) gameValueMap.set(key, new Map());
      gameValueMap.get(key)!.set(stat.snapshot_date.getTime(), Number(stat.avg_price));
    }

    const setValueMap = new Map<string, Map<number, number>>();
    for (const stat of setStats) {
      const key = `SET_${stat.set_code}`;
      if (!setValueMap.has(key)) setValueMap.set(key, new Map());
      setValueMap.get(key)!.set(stat.snapshot_date.getTime(), Number(stat.avg_price));
    }

    const top100ValueMap = new Map<number, number>();
    for (const stat of top100Stats) {
      top100ValueMap.set(stat.snapshot_date.getTime(), Number(stat.avg_price));
    }

    // Build snapshots
    console.log("\nBuilding snapshots with change calculations...");

    const snapshots: {
      indexType: string;
      indexKey: string;
      value: number;
      change24h: number;
      change7d: number;
      change30d: number;
      cardCount: number;
      totalMarketCap: number;
      avgPrice: number;
      volatility: number;
      highPrice: number;
      lowPrice: number;
      snapshotDate: Date;
    }[] = [];

    const day1Ms = 24 * 60 * 60 * 1000;
    const day7Ms = 7 * day1Ms;
    const day30Ms = 30 * day1Ms;

    // Game snapshots
    for (const stat of gameStats) {
      const key = `GAME_${stat.game}`;
      const valueMap = gameValueMap.get(key)!;
      const currentTime = stat.snapshot_date.getTime();
      const currentValue = Number(stat.avg_price);

      const value1dAgo = valueMap.get(currentTime - day1Ms);
      const value7dAgo = valueMap.get(currentTime - day7Ms);
      const value30dAgo = valueMap.get(currentTime - day30Ms);

      snapshots.push({
        indexType: "GAME",
        indexKey: stat.game,
        value: currentValue,
        change24h: value1dAgo && value1dAgo > 0 ? ((currentValue - value1dAgo) / value1dAgo) * 100 : 0,
        change7d: value7dAgo && value7dAgo > 0 ? ((currentValue - value7dAgo) / value7dAgo) * 100 : 0,
        change30d: value30dAgo && value30dAgo > 0 ? ((currentValue - value30dAgo) / value30dAgo) * 100 : 0,
        cardCount: Number(stat.card_count),
        totalMarketCap: Number(stat.total_value),
        avgPrice: Number(stat.avg_price),
        volatility: Math.sqrt(Number(stat.variance) || 0),
        highPrice: Number(stat.high_price),
        lowPrice: Number(stat.low_price),
        snapshotDate: stat.snapshot_date,
      });
    }

    // Set snapshots
    for (const stat of setStats) {
      const key = `SET_${stat.set_code}`;
      const valueMap = setValueMap.get(key)!;
      const currentTime = stat.snapshot_date.getTime();
      const currentValue = Number(stat.avg_price);

      const value1dAgo = valueMap.get(currentTime - day1Ms);
      const value7dAgo = valueMap.get(currentTime - day7Ms);
      const value30dAgo = valueMap.get(currentTime - day30Ms);

      snapshots.push({
        indexType: "SET",
        indexKey: stat.set_code,
        value: currentValue,
        change24h: value1dAgo && value1dAgo > 0 ? ((currentValue - value1dAgo) / value1dAgo) * 100 : 0,
        change7d: value7dAgo && value7dAgo > 0 ? ((currentValue - value7dAgo) / value7dAgo) * 100 : 0,
        change30d: value30dAgo && value30dAgo > 0 ? ((currentValue - value30dAgo) / value30dAgo) * 100 : 0,
        cardCount: Number(stat.card_count),
        totalMarketCap: Number(stat.total_value),
        avgPrice: Number(stat.avg_price),
        volatility: Math.sqrt(Number(stat.variance) || 0),
        highPrice: Number(stat.high_price),
        lowPrice: Number(stat.low_price),
        snapshotDate: stat.snapshot_date,
      });
    }

    // Top 100 snapshots
    for (const stat of top100Stats) {
      const currentTime = stat.snapshot_date.getTime();
      const currentValue = Number(stat.avg_price);

      const value1dAgo = top100ValueMap.get(currentTime - day1Ms);
      const value7dAgo = top100ValueMap.get(currentTime - day7Ms);
      const value30dAgo = top100ValueMap.get(currentTime - day30Ms);

      snapshots.push({
        indexType: "TOP_100",
        indexKey: "top100",
        value: currentValue,
        change24h: value1dAgo && value1dAgo > 0 ? ((currentValue - value1dAgo) / value1dAgo) * 100 : 0,
        change7d: value7dAgo && value7dAgo > 0 ? ((currentValue - value7dAgo) / value7dAgo) * 100 : 0,
        change30d: value30dAgo && value30dAgo > 0 ? ((currentValue - value30dAgo) / value30dAgo) * 100 : 0,
        cardCount: Number(stat.card_count),
        totalMarketCap: Number(stat.total_value),
        avgPrice: Number(stat.avg_price),
        volatility: Math.sqrt(Number(stat.variance) || 0),
        highPrice: Number(stat.high_price),
        lowPrice: Number(stat.low_price),
        snapshotDate: stat.snapshot_date,
      });
    }

    console.log(`\nTotal snapshots to insert: ${snapshots.length}`);

    if (dryRun) {
      console.log("\n[DRY RUN] Sample snapshots:");
      const gameSnaps = snapshots.filter((s) => s.indexType === "GAME").slice(-5);
      const setSnaps = snapshots.filter((s) => s.indexType === "SET").slice(-5);
      const top100Snaps = snapshots.filter((s) => s.indexType === "TOP_100").slice(-5);

      console.log("\nGame indices (latest 5):");
      for (const s of gameSnaps) {
        console.log(`  ${s.indexKey}: ${s.value.toFixed(2)} (24h: ${s.change24h.toFixed(2)}%) - ${s.snapshotDate.toISOString().split("T")[0]}`);
      }

      console.log("\nSet indices (latest 5):");
      for (const s of setSnaps) {
        console.log(`  ${s.indexKey}: ${s.value.toFixed(2)} (24h: ${s.change24h.toFixed(2)}%) - ${s.snapshotDate.toISOString().split("T")[0]}`);
      }

      console.log("\nTop 100 (latest 5):");
      for (const s of top100Snaps) {
        console.log(`  ${s.indexKey}: ${s.value.toFixed(2)} (24h: ${s.change24h.toFixed(2)}%) - ${s.snapshotDate.toISOString().split("T")[0]}`);
      }

      return;
    }

    // Insert in batches
    console.log(`\nInserting ${snapshots.length} snapshots...`);
    const BATCH_SIZE = 500;
    let inserted = 0;

    for (let i = 0; i < snapshots.length; i += BATCH_SIZE) {
      const batch = snapshots.slice(i, i + BATCH_SIZE);

      const result = await prisma.priceIndexSnapshot.createMany({
        data: batch,
        skipDuplicates: true,
      });

      inserted += result.count;

      if ((i + BATCH_SIZE) % 2000 === 0 || i + BATCH_SIZE >= snapshots.length) {
        console.log(`  Inserted ${inserted} snapshots...`);
      }
    }

    // Summary
    console.log("\n" + "=".repeat(60));
    console.log("BACKFILL COMPLETE");
    console.log("=".repeat(60));

    const finalCount = await prisma.priceIndexSnapshot.count();
    console.log(`Total price_index_snapshots: ${finalCount}`);

    // Show index summary
    const indexSummary = await prisma.$queryRaw<{ index_type: string; count: bigint }[]>`
      SELECT index_type, COUNT(*) as count
      FROM price_index_snapshots
      GROUP BY index_type
      ORDER BY index_type
    `;

    console.log("\nIndex breakdown:");
    for (const row of indexSummary) {
      console.log(`  ${row.index_type}: ${row.count} snapshots`);
    }
  } catch (error) {
    console.error("Backfill failed:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
