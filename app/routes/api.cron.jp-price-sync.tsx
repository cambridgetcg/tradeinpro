/**
 * Japanese Price Sync Cron Endpoint
 *
 * GET /api/cron/jp-price-sync
 *
 * Scheduled endpoint for syncing Japanese prices to CardPriceV2.
 * Called by Vercel Cron every 6 hours.
 *
 * Requires CRON_SECRET env var for authentication.
 */

import type { LoaderFunctionArgs } from "react-router";
import { fullS3Sync } from "../lib/jp-prices.server";

// Default shop for cron jobs
const DEFAULT_SHOP = process.env.SHOPIFY_SHOP_DOMAIN || "cambridgetcg.myshopify.com";

export async function loader({ request }: LoaderFunctionArgs) {
  // Verify cron secret
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    console.warn("Cron: Invalid or missing authorization");
    return new Response(
      JSON.stringify({ error: "Unauthorized" }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }

  console.log("Cron: Starting Japanese price sync...");
  const startTime = Date.now();

  try {
    // Full S3 sync: download from AWS S3 and sync to CardPriceV2
    console.log("Cron: Starting full S3 sync...");
    const result = await fullS3Sync(DEFAULT_SHOP);

    const duration = Date.now() - startTime;

    console.log(`Cron: S3 sync complete in ${duration}ms`, {
      imported: {
        created: result.import.created,
        updated: result.import.updated,
        skipped: result.import.skipped,
      },
      synced: {
        created: result.sync.created,
        updated: result.sync.updated,
        skipped: result.sync.skipped,
      },
      importErrors: result.import.errors.length,
      syncErrors: result.sync.errors.length,
    });

    return new Response(
      JSON.stringify({
        success: true,
        duration,
        import: {
          created: result.import.created,
          updated: result.import.updated,
          skipped: result.import.skipped,
          totalProcessed: result.import.totalProcessed,
          errorCount: result.import.errors.length,
        },
        sync: {
          created: result.sync.created,
          updated: result.sync.updated,
          skipped: result.sync.skipped,
          totalProcessed: result.sync.totalProcessed,
          errorCount: result.sync.errors.length,
        },
        lastModified: result.lastModified,
        errors: [
          ...result.import.errors.slice(0, 3),
          ...result.sync.errors.slice(0, 2),
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error("Cron: Japanese price sync failed:", error);

    return new Response(
      JSON.stringify({
        success: false,
        duration,
        error: error instanceof Error ? error.message : "Sync failed",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

// Also support POST for manual triggering
export async function action({ request }: LoaderFunctionArgs) {
  return loader({ request } as LoaderFunctionArgs);
}
