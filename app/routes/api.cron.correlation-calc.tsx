/**
 * Correlation Calculation Cron Endpoint
 *
 * GET /api/cron/correlation-calc
 *
 * Calculates and stores Pearson correlations between card price movements.
 * Used for the neural network visualization showing price relationships.
 *
 * Called by Vercel Cron weekly (Sundays at 2 AM) as correlations are
 * computationally expensive and don't change rapidly.
 *
 * Requires CRON_SECRET env var for authentication.
 */

import type { LoaderFunctionArgs } from "react-router";
import { calculateCorrelations } from "../lib/s3-prices.server";
import { logger, metrics } from "../lib/observability.server";

export async function loader({ request }: LoaderFunctionArgs) {
  // Verify cron secret
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    logger.warn("Correlation calc cron: Invalid or missing authorization");
    return new Response(
      JSON.stringify({ error: "Unauthorized" }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }

  logger.info("Correlation calc cron: Starting...");
  metrics.increment("cron.correlationCalc.started");
  const startTime = Date.now();

  const results: {
    onepiece: { calculated: number; stored: number; errors: string[] };
    pokemon: { calculated: number; stored: number; errors: string[] };
  } = {
    onepiece: { calculated: 0, stored: 0, errors: [] },
    pokemon: { calculated: 0, stored: 0, errors: [] },
  };

  try {
    // Calculate One Piece correlations
    logger.info("Correlation calc: Processing One Piece...");
    results.onepiece = await calculateCorrelations("onepiece", 30, 0.3);

    // Calculate Pokemon correlations
    logger.info("Correlation calc: Processing Pokemon...");
    results.pokemon = await calculateCorrelations("pokemon", 30, 0.3);

    const duration = Date.now() - startTime;
    const totalCalculated = results.onepiece.calculated + results.pokemon.calculated;
    const totalStored = results.onepiece.stored + results.pokemon.stored;
    const totalErrors = results.onepiece.errors.length + results.pokemon.errors.length;

    logger.info("Correlation calc cron: Complete", {
      duration,
      totalCalculated,
      totalStored,
      totalErrors,
    });

    metrics.increment("cron.correlationCalc.completed");
    metrics.timing("cron.correlationCalc.duration", duration);

    return new Response(
      JSON.stringify({
        success: totalErrors === 0,
        duration,
        results,
        totalCalculated,
        totalStored,
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

    logger.error("Correlation calc cron: Failed", {
      error: errorMsg,
      duration,
    });

    metrics.increment("cron.correlationCalc.failed");

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
