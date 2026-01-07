/**
 * Tiered Storage for Price History
 *
 * Provides transparent access to price history across multiple storage tiers:
 * - Hot tier: Daily data (last 90 days) - card_price_history
 * - Warm tier: Weekly aggregates (90-365 days) - card_price_history_weekly
 * - Cold tier: Monthly aggregates (365+ days) - card_price_history_monthly
 *
 * Usage:
 *   import { getCardPriceHistory } from "./tiered-storage.server";
 *   const history = await getCardPriceHistory(cardId, 365);
 */

import prisma from "../db.server";
import { Decimal } from "@prisma/client/runtime/library";

// ============================================================================
// Types
// ============================================================================

export interface PriceDataPoint {
  date: string;
  priceGbp: number;
  priceJpy: number | null;
  change: number;
  source: "daily" | "weekly" | "monthly";
}

export interface TieredQueryOptions {
  /** Number of days of history to fetch */
  days: number;
  /** Include weekly aggregates for older data */
  includeWeekly?: boolean;
  /** Include monthly aggregates for very old data */
  includeMonthly?: boolean;
}

// ============================================================================
// Configuration
// ============================================================================

const TIER_CONFIG = {
  /** Days to keep in hot tier (daily granularity) */
  hotTierDays: 90,

  /** Days to keep in warm tier (weekly granularity) */
  warmTierDays: 365,

  /** Beyond this, use monthly aggregates */
  coldTierStart: 365,
};

// ============================================================================
// Tiered Query Functions
// ============================================================================

/**
 * Get price history for a card across all tiers.
 * Automatically selects appropriate granularity based on date range.
 */
export async function getCardPriceHistory(
  cardId: string,
  days: number
): Promise<PriceDataPoint[]> {
  const now = new Date();
  const results: PriceDataPoint[] = [];

  // Determine which tiers to query
  const hotEnd = new Date(now);
  const hotStart = new Date(now);
  hotStart.setDate(hotStart.getDate() - Math.min(days, TIER_CONFIG.hotTierDays));

  // Query hot tier (daily data)
  const dailyData = await prisma.cardPriceHistory.findMany({
    where: {
      cardId,
      snapshotDate: { gte: hotStart },
    },
    orderBy: { snapshotDate: "asc" },
  });

  for (const row of dailyData) {
    results.push({
      date: row.snapshotDate.toISOString().split("T")[0],
      priceGbp: row.priceGbp.toNumber(),
      priceJpy: row.priceJpy?.toNumber() ?? null,
      change: row.change.toNumber(),
      source: "daily",
    });
  }

  // If requesting more than hot tier days, try weekly data
  if (days > TIER_CONFIG.hotTierDays) {
    const weeklyStart = new Date(now);
    weeklyStart.setDate(weeklyStart.getDate() - Math.min(days, TIER_CONFIG.warmTierDays));

    const weeklyEnd = new Date(hotStart);

    try {
      const weeklyData = await prisma.$queryRaw<
        Array<{
          week_start: Date;
          close_gbp: Decimal;
          close_jpy: Decimal | null;
          change_pct: Decimal | null;
        }>
      >`
        SELECT week_start, close_gbp, close_jpy, change_pct
        FROM card_price_history_weekly
        WHERE card_id = ${cardId}
          AND week_start >= ${weeklyStart}
          AND week_start < ${weeklyEnd}
        ORDER BY week_start ASC
      `;

      for (const row of weeklyData) {
        results.push({
          date: row.week_start.toISOString().split("T")[0],
          priceGbp: row.close_gbp.toNumber(),
          priceJpy: row.close_jpy?.toNumber() ?? null,
          change: row.change_pct?.toNumber() ?? 0,
          source: "weekly",
        });
      }
    } catch (error) {
      // Weekly table might not exist yet
      console.log("Weekly aggregates not available");
    }
  }

  // If requesting more than warm tier days, try monthly data
  if (days > TIER_CONFIG.warmTierDays) {
    const monthlyStart = new Date(now);
    monthlyStart.setDate(monthlyStart.getDate() - days);

    const monthlyEnd = new Date(now);
    monthlyEnd.setDate(monthlyEnd.getDate() - TIER_CONFIG.warmTierDays);

    try {
      const monthlyData = await prisma.$queryRaw<
        Array<{
          month_start: Date;
          close_gbp: Decimal;
          close_jpy: Decimal | null;
          change_pct: Decimal | null;
        }>
      >`
        SELECT month_start, close_gbp, close_jpy, change_pct
        FROM card_price_history_monthly
        WHERE card_id = ${cardId}
          AND month_start >= ${monthlyStart}
          AND month_start < ${monthlyEnd}
        ORDER BY month_start ASC
      `;

      for (const row of monthlyData) {
        results.push({
          date: row.month_start.toISOString().split("T")[0],
          priceGbp: row.close_gbp.toNumber(),
          priceJpy: row.close_jpy?.toNumber() ?? null,
          change: row.change_pct?.toNumber() ?? 0,
          source: "monthly",
        });
      }
    } catch (error) {
      // Monthly table might not exist yet
      console.log("Monthly aggregates not available");
    }
  }

  // Sort by date (oldest first)
  results.sort((a, b) => a.date.localeCompare(b.date));

  return results;
}

/**
 * Get storage statistics across all tiers.
 */
export async function getTieredStorageStats(): Promise<{
  daily: { rows: number; sizeBytes: number };
  weekly: { rows: number; sizeBytes: number } | null;
  monthly: { rows: number; sizeBytes: number } | null;
  totalSizeBytes: number;
}> {
  const dailyStats = await prisma.$queryRaw<[{ count: bigint; size: bigint }]>`
    SELECT
      COUNT(*) as count,
      pg_total_relation_size('card_price_history') as size
    FROM card_price_history
  `;

  let weeklyStats: { count: bigint; size: bigint } | null = null;
  let monthlyStats: { count: bigint; size: bigint } | null = null;

  try {
    const weekly = await prisma.$queryRaw<[{ count: bigint; size: bigint }]>`
      SELECT
        COUNT(*) as count,
        pg_total_relation_size('card_price_history_weekly') as size
      FROM card_price_history_weekly
    `;
    weeklyStats = weekly[0];
  } catch {
    // Table doesn't exist
  }

  try {
    const monthly = await prisma.$queryRaw<[{ count: bigint; size: bigint }]>`
      SELECT
        COUNT(*) as count,
        pg_total_relation_size('card_price_history_monthly') as size
      FROM card_price_history_monthly
    `;
    monthlyStats = monthly[0];
  } catch {
    // Table doesn't exist
  }

  const totalSize =
    Number(dailyStats[0].size) +
    (weeklyStats ? Number(weeklyStats.size) : 0) +
    (monthlyStats ? Number(monthlyStats.size) : 0);

  return {
    daily: {
      rows: Number(dailyStats[0].count),
      sizeBytes: Number(dailyStats[0].size),
    },
    weekly: weeklyStats
      ? {
          rows: Number(weeklyStats.count),
          sizeBytes: Number(weeklyStats.size),
        }
      : null,
    monthly: monthlyStats
      ? {
          rows: Number(monthlyStats.count),
          sizeBytes: Number(monthlyStats.size),
        }
      : null,
    totalSizeBytes: totalSize,
  };
}

// ============================================================================
// Aggregation Functions (for scheduled jobs)
// ============================================================================

/**
 * Aggregate daily data older than 90 days into weekly summaries.
 * Run this weekly to maintain tiered storage.
 */
export async function aggregateDailyToWeekly(): Promise<{
  weeksProcessed: number;
  rowsAggregated: number;
}> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - TIER_CONFIG.hotTierDays);

  // Get weeks that need aggregation
  const weeksToProcess = await prisma.$queryRaw<
    Array<{ week_start: Date; count: bigint }>
  >`
    SELECT
      DATE_TRUNC('week', snapshot_date)::DATE as week_start,
      COUNT(*) as count
    FROM card_price_history
    WHERE snapshot_date < ${cutoffDate}
    GROUP BY DATE_TRUNC('week', snapshot_date)
    HAVING COUNT(*) > 0
    ORDER BY week_start DESC
    LIMIT 10
  `;

  let totalRows = 0;

  for (const week of weeksToProcess) {
    const weekEnd = new Date(week.week_start);
    weekEnd.setDate(weekEnd.getDate() + 7);

    // Aggregate this week's data
    await prisma.$executeRaw`
      INSERT INTO card_price_history_weekly (
        card_id, game, set_code, week_start,
        open_gbp, high_gbp, low_gbp, close_gbp,
        open_jpy, high_jpy, low_jpy, close_jpy,
        volume, change_pct
      )
      SELECT
        card_id,
        game,
        set_code,
        ${week.week_start}::DATE as week_start,
        (ARRAY_AGG(price_gbp ORDER BY snapshot_date ASC))[1] as open_gbp,
        MAX(price_gbp) as high_gbp,
        MIN(price_gbp) as low_gbp,
        (ARRAY_AGG(price_gbp ORDER BY snapshot_date DESC))[1] as close_gbp,
        (ARRAY_AGG(price_jpy ORDER BY snapshot_date ASC))[1] as open_jpy,
        MAX(price_jpy) as high_jpy,
        MIN(price_jpy) as low_jpy,
        (ARRAY_AGG(price_jpy ORDER BY snapshot_date DESC))[1] as close_jpy,
        COUNT(*)::INT as volume,
        CASE
          WHEN (ARRAY_AGG(price_gbp ORDER BY snapshot_date ASC))[1] > 0
          THEN (((ARRAY_AGG(price_gbp ORDER BY snapshot_date DESC))[1] -
                 (ARRAY_AGG(price_gbp ORDER BY snapshot_date ASC))[1]) /
                (ARRAY_AGG(price_gbp ORDER BY snapshot_date ASC))[1]) * 100
          ELSE 0
        END as change_pct
      FROM card_price_history
      WHERE snapshot_date >= ${week.week_start}
        AND snapshot_date < ${weekEnd}
      GROUP BY card_id, game, set_code
      ON CONFLICT (card_id, week_start) DO UPDATE SET
        high_gbp = GREATEST(EXCLUDED.high_gbp, card_price_history_weekly.high_gbp),
        low_gbp = LEAST(EXCLUDED.low_gbp, card_price_history_weekly.low_gbp),
        close_gbp = EXCLUDED.close_gbp,
        high_jpy = GREATEST(EXCLUDED.high_jpy, card_price_history_weekly.high_jpy),
        low_jpy = LEAST(EXCLUDED.low_jpy, card_price_history_weekly.low_jpy),
        close_jpy = EXCLUDED.close_jpy,
        volume = EXCLUDED.volume,
        change_pct = EXCLUDED.change_pct
    `;

    totalRows += Number(week.count);
  }

  return {
    weeksProcessed: weeksToProcess.length,
    rowsAggregated: totalRows,
  };
}

/**
 * Delete daily data that has been aggregated.
 * Only run after verifying aggregates are correct.
 */
export async function pruneDailyData(
  olderThanDays: number
): Promise<{ deletedRows: number }> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

  // First, verify we have weekly aggregates for this period
  const coverage = await prisma.$queryRaw<[{ count: bigint }]>`
    SELECT COUNT(DISTINCT week_start) as count
    FROM card_price_history_weekly
    WHERE week_start < ${cutoffDate}
  `;

  if (Number(coverage[0].count) === 0) {
    console.warn("No weekly aggregates found. Run aggregation first.");
    return { deletedRows: 0 };
  }

  // Delete old daily data
  const result = await prisma.$executeRaw`
    DELETE FROM card_price_history
    WHERE snapshot_date < ${cutoffDate}
  `;

  return { deletedRows: result };
}

// ============================================================================
// Exports
// ============================================================================

export const tieredStorage = {
  getCardPriceHistory,
  getTieredStorageStats,
  aggregateDailyToWeekly,
  pruneDailyData,
  config: TIER_CONFIG,
};
