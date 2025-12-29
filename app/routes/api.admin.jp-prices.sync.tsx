/**
 * Japanese Price Sync API
 *
 * POST /api/admin/jp-prices/sync
 * Syncs JapanesePriceSource records to CardPriceV2 with language="JP"
 */

import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import {
  syncJapanesePricesToCards,
  getJpPriceStats,
  updateJpyExchangeRates,
} from "../lib/jp-prices.server";

export async function action({ request }: ActionFunctionArgs) {
  // Authenticate admin request
  const { admin, session } = await authenticate.admin(request);

  if (request.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    const body = await request.json().catch(() => ({}));
    const action = (body as { action?: string }).action || "sync";

    if (action === "update-rates") {
      // Update exchange rates for JPY prices
      const updated = await updateJpyExchangeRates();
      return new Response(
        JSON.stringify({
          success: true,
          action: "update-rates",
          updated,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    // Default: sync to CardPriceV2
    const result = await syncJapanesePricesToCards(session.shop);

    return new Response(
      JSON.stringify({
        success: true,
        action: "sync",
        result: {
          created: result.created,
          updated: result.updated,
          skipped: result.skipped,
          totalProcessed: result.totalProcessed,
          errorCount: result.errors.length,
        },
        errors: result.errors.slice(0, 10), // Limit errors returned
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("JP price sync error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Sync failed",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

// GET for stats
export async function loader({ request }: ActionFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);

  try {
    const stats = await getJpPriceStats();
    return new Response(
      JSON.stringify({
        success: true,
        stats,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("JP price stats error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Failed to get stats",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
