/**
 * Price Index Snapshot Cron Endpoint
 *
 * GET /api/cron/price-snapshot
 *
 * Scheduled endpoint for taking daily price index snapshots.
 * Called by Vercel Cron daily at midnight UTC.
 *
 * Creates snapshots for:
 * - Game indices (GAME_onepiece, GAME_pokemon)
 * - Set indices (dynamically discovered)
 * - Top 100 index
 * - Language indices (EN, JP)
 * - Card-level price history
 *
 * Requires CRON_SECRET env var for authentication.
 */

import type { LoaderFunctionArgs } from "react-router";
import { runDailySnapshot } from "../lib/price-index.server";
import { logger } from "../lib/observability.server";

export async function loader({ request }: LoaderFunctionArgs) {
  // Verify cron secret
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    logger.warn("Price snapshot cron: Invalid or missing authorization");
    return new Response(
      JSON.stringify({ error: "Unauthorized" }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }

  logger.info("Price snapshot cron: Starting daily snapshot...");
  const startTime = Date.now();

  try {
    const results = await runDailySnapshot();
    const duration = Date.now() - startTime;

    logger.info("Price snapshot cron: Complete", {
      duration,
      indicesProcessed: results.indicesProcessed,
      cardsProcessed: results.cardsProcessed,
    });

    return new Response(
      JSON.stringify({
        success: true,
        duration,
        indicesProcessed: results.indicesProcessed,
        cardsProcessed: results.cardsProcessed,
        timestamp: new Date().toISOString(),
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error("Price snapshot cron: Failed", {
      error: error instanceof Error ? error.message : String(error),
      duration,
    });

    return new Response(
      JSON.stringify({
        success: false,
        duration,
        error: error instanceof Error ? error.message : "Snapshot failed",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

// Also support POST for manual triggering
export async function action({ request }: LoaderFunctionArgs) {
  return loader({ request } as LoaderFunctionArgs);
}
