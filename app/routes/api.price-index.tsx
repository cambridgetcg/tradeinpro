/**
 * Price Index Summary API
 *
 * GET /apps/trade-in/price-index
 *
 * Returns current values for all tracked price indices.
 * Used by the price index dashboard to show overall market health.
 */

import type { LoaderFunctionArgs } from "react-router";
import {
  validateAppProxy,
  jsonResponse,
  errorResponse,
} from "../lib/app-proxy.server";
import {
  getAllIndices,
  calculateAllSetIndices,
  type IndexResult,
} from "../lib/price-index.server";
import { logger, metrics } from "../lib/observability.server";

export interface PriceIndexSummaryResponse {
  indices: Record<string, IndexResult>;
  setIndices: IndexResult[];
  timestamp: string;
  cacheAge: number; // seconds since calculation
}

// Simple in-memory cache for index data (expires every 5 minutes)
let cachedData: PriceIndexSummaryResponse | null = null;
let cacheTime: number = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export async function loader({ request }: LoaderFunctionArgs) {
  // Validate App Proxy signature (optional in dev)
  const context = validateAppProxy(request);
  if (!context.isValid && process.env.NODE_ENV === "production") {
    return errorResponse(401, "unauthorized", "Invalid request signature");
  }

  const url = new URL(request.url);
  const game = url.searchParams.get("game") || undefined;
  const forceRefresh = url.searchParams.get("refresh") === "true";

  try {
    const now = Date.now();
    const cacheAge = Math.floor((now - cacheTime) / 1000);

    // Return cached data if fresh and not forcing refresh
    if (cachedData && !forceRefresh && (now - cacheTime) < CACHE_TTL_MS) {
      metrics.increment("priceIndex.api.cacheHit");
      return jsonResponse({
        ...cachedData,
        cacheAge,
      });
    }

    metrics.increment("priceIndex.api.cacheMiss");
    logger.info("Calculating price indices", { game });

    // Calculate all indices
    const [indices, setIndices] = await Promise.all([
      getAllIndices(),
      calculateAllSetIndices(game),
    ]);

    // Build response
    const response: PriceIndexSummaryResponse = {
      indices,
      setIndices: setIndices.sort((a, b) => b.value - a.value), // Sort by value desc
      timestamp: new Date().toISOString(),
      cacheAge: 0,
    };

    // Update cache
    cachedData = response;
    cacheTime = now;

    return jsonResponse(response);
  } catch (error) {
    logger.error("Price index API error", {
      error: error instanceof Error ? error.message : String(error),
    });

    return errorResponse(
      500,
      "index_calculation_failed",
      "Failed to calculate price indices. Please try again."
    );
  }
}

export async function action() {
  return errorResponse(405, "method_not_allowed", "Only GET requests are supported");
}
