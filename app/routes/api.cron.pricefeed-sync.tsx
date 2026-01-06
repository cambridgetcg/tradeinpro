/**
 * Pricefeed Multi-Channel Sync Cron Endpoint
 *
 * GET /api/cron/pricefeed-sync
 *
 * Syncs multi-channel price data from S3 pricefeed/*.xlsx files.
 * Updates price_sources table with current prices from all sales channels
 * (CardRush, eBay, CardMarket, CardTrader, etc.).
 *
 * Called by Vercel Cron daily to track arbitrage opportunities.
 *
 * Requires CRON_SECRET env var for authentication.
 */

import type { LoaderFunctionArgs } from "react-router";
import { syncPricefeed, type PricefeedSyncResult } from "../lib/s3-prices.server";
import { logger, metrics } from "../lib/observability.server";

export async function loader({ request }: LoaderFunctionArgs) {
  // Verify cron secret
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    logger.warn("Pricefeed sync cron: Invalid or missing authorization");
    return new Response(
      JSON.stringify({ error: "Unauthorized" }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }

  logger.info("Pricefeed sync cron: Starting...");
  metrics.increment("cron.pricefeedSync.started");
  const startTime = Date.now();

  const results: {
    onepiece: PricefeedSyncResult;
    pokemon: PricefeedSyncResult;
  } = {
    onepiece: { synced: 0, errors: [], channels: {} },
    pokemon: { synced: 0, errors: [], channels: {} },
  };

  try {
    // Sync One Piece pricefeed
    logger.info("Pricefeed sync: Processing One Piece...");
    results.onepiece = await syncPricefeed("onepiece");

    // Sync Pokemon pricefeed
    logger.info("Pricefeed sync: Processing Pokemon...");
    results.pokemon = await syncPricefeed("pokemon");

    const duration = Date.now() - startTime;
    const totalSynced = results.onepiece.synced + results.pokemon.synced;
    const totalErrors = results.onepiece.errors.length + results.pokemon.errors.length;

    logger.info("Pricefeed sync cron: Complete", {
      duration,
      totalSynced,
      totalErrors,
      onepieceChannels: Object.keys(results.onepiece.channels).length,
      pokemonChannels: Object.keys(results.pokemon.channels).length,
    });

    metrics.increment("cron.pricefeedSync.completed");
    metrics.timing("cron.pricefeedSync.duration", duration);

    return new Response(
      JSON.stringify({
        success: totalErrors === 0,
        duration,
        results,
        totalSynced,
        timestamp: new Date().toISOString(),
      }),
      {
        status: totalErrors === 0 ? 200 : 207,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMsg = error instanceof Error ? error.message : String(error);

    logger.error("Pricefeed sync cron: Failed", {
      error: errorMsg,
      duration,
    });

    metrics.increment("cron.pricefeedSync.failed");

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
