/**
 * Price Data Sync Cron Endpoint
 *
 * GET /api/cron/price-sync
 *
 * Syncs price data from S3 daily_prices.xlsx.
 * Called by Vercel Cron daily to import new price data.
 *
 * This handles incremental sync - only imports dates not already in the database.
 *
 * Requires CRON_SECRET env var for authentication.
 */

import type { LoaderFunctionArgs } from "react-router";
import { syncDailyPrices } from "../lib/s3-prices.server";
import { logger, metrics } from "../lib/observability.server";

export async function loader({ request }: LoaderFunctionArgs) {
  // Verify cron secret
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    logger.warn("Price sync cron: Invalid or missing authorization");
    return new Response(
      JSON.stringify({ error: "Unauthorized" }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }

  logger.info("Price sync cron: Starting...");
  metrics.increment("cron.priceSync.started");
  const startTime = Date.now();

  const results: {
    onepiece: { synced: number; skipped: number; errors: string[]; newDates?: string[] };
    pokemon: { synced: number; skipped: number; errors: string[]; newDates?: string[] };
  } = {
    onepiece: { synced: 0, skipped: 0, errors: [] },
    pokemon: { synced: 0, skipped: 0, errors: [] },
  };

  try {
    // Sync One Piece prices
    logger.info("Price sync: Processing One Piece...");
    results.onepiece = await syncDailyPrices("onepiece");

    // Sync Pokemon prices
    logger.info("Price sync: Processing Pokemon...");
    results.pokemon = await syncDailyPrices("pokemon");

    const duration = Date.now() - startTime;
    const totalSynced = results.onepiece.synced + results.pokemon.synced;
    const totalErrors = results.onepiece.errors.length + results.pokemon.errors.length;

    logger.info("Price sync cron: Complete", {
      duration,
      totalSynced,
      totalErrors,
      onepieceNewDates: results.onepiece.newDates?.length || 0,
      pokemonNewDates: results.pokemon.newDates?.length || 0,
    });

    metrics.increment("cron.priceSync.completed");
    metrics.timing("cron.priceSync.duration", duration);

    return new Response(
      JSON.stringify({
        success: totalErrors === 0,
        duration,
        results,
        totalSynced,
        timestamp: new Date().toISOString(),
      }),
      {
        status: totalErrors === 0 ? 200 : 207, // 207 Multi-Status for partial success
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMsg = error instanceof Error ? error.message : String(error);

    logger.error("Price sync cron: Failed", {
      error: errorMsg,
      duration,
    });

    metrics.increment("cron.priceSync.failed");

    return new Response(
      JSON.stringify({
        success: false,
        duration,
        error: errorMsg,
        timestamp: new Date().toISOString(),
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

// Support POST for manual triggering
export async function action({ request }: LoaderFunctionArgs) {
  return loader({ request } as LoaderFunctionArgs);
}
