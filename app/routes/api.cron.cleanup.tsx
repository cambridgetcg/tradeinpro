/**
 * Database Cleanup Cron Endpoint
 *
 * GET /api/cron/cleanup
 *
 * Scheduled endpoint for cleaning up expired database records.
 * Called by Vercel Cron daily at 3 AM UTC.
 *
 * Currently cleans:
 * - Expired idempotency records (>24 hours old)
 *
 * Requires CRON_SECRET env var for authentication.
 */

import type { LoaderFunctionArgs } from "react-router";
import { cleanupExpiredIdempotencyRecords } from "../lib/idempotency.server";

export async function loader({ request }: LoaderFunctionArgs) {
  // Verify cron secret
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    console.warn("[cleanup-cron] Invalid or missing authorization");
    return new Response(
      JSON.stringify({ error: "Unauthorized" }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }

  console.log("[cleanup-cron] Starting database cleanup...");
  const startTime = Date.now();

  const results = {
    idempotencyRecords: 0,
  };

  try {
    // Clean up expired idempotency records
    results.idempotencyRecords = await cleanupExpiredIdempotencyRecords();
    console.log(`[cleanup-cron] Cleaned ${results.idempotencyRecords} idempotency records`);

    const duration = Date.now() - startTime;

    console.log(`[cleanup-cron] Cleanup complete in ${duration}ms`, results);

    return new Response(
      JSON.stringify({
        success: true,
        duration,
        cleaned: results,
        timestamp: new Date().toISOString(),
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error("[cleanup-cron] Cleanup failed:", error);

    return new Response(
      JSON.stringify({
        success: false,
        duration,
        error: error instanceof Error ? error.message : "Cleanup failed",
        partialResults: results,
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

// Also support POST for manual triggering
export async function action({ request }: LoaderFunctionArgs) {
  return loader({ request } as LoaderFunctionArgs);
}
