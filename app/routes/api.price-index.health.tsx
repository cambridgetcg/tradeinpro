/**
 * Market Health API
 *
 * GET /apps/trade-in/price-index/health
 *
 * Returns market health metrics including:
 * - Sentiment (bullish/bearish/neutral)
 * - Gainers/losers counts
 * - Volatility index
 * - Hot sets with significant movement
 * - 7-day sparkline data
 *
 * Query params:
 *   - game: Game to analyze (default: onepiece)
 */

import type { LoaderFunctionArgs } from "react-router";
import {
  validateAppProxy,
  jsonResponse,
  errorResponse,
} from "../lib/app-proxy.server";
import { getMarketHealth, type MarketHealth } from "../lib/price-index.server";
import { logger, metrics } from "../lib/observability.server";

export interface MarketHealthResponse extends MarketHealth {
  game: string;
  timestamp: string;
}

export async function loader({ request }: LoaderFunctionArgs) {
  // Validate App Proxy signature
  const context = validateAppProxy(request);
  if (!context.isValid && process.env.NODE_ENV === "production") {
    return errorResponse(401, "unauthorized", "Invalid request signature");
  }

  const url = new URL(request.url);
  const game = url.searchParams.get("game") || "onepiece";

  try {
    metrics.increment("priceIndex.health.requested");

    const health = await getMarketHealth(game);

    const response: MarketHealthResponse = {
      ...health,
      game,
      timestamp: new Date().toISOString(),
    };

    return jsonResponse(response);
  } catch (error) {
    logger.error("Market health API error", {
      error: error instanceof Error ? error.message : String(error),
    });

    return errorResponse(
      500,
      "health_fetch_failed",
      "Failed to fetch market health. Please try again."
    );
  }
}

export async function action() {
  return errorResponse(405, "method_not_allowed", "Only GET requests are supported");
}
