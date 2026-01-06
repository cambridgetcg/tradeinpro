/**
 * Top Movers API
 *
 * GET /apps/trade-in/price-index/movers
 *
 * Returns biggest price gainers and losers in the last 24 hours.
 * Used for market alerts and trend analysis.
 */

import type { LoaderFunctionArgs } from "react-router";
import {
  validateAppProxy,
  jsonResponse,
  errorResponse,
  parsePositiveInt,
} from "../lib/app-proxy.server";
import { getTopMovers, type TopMover } from "../lib/price-index.server";
import { logger, metrics } from "../lib/observability.server";

export interface TopMoversResponse {
  gainers: TopMover[];
  losers: TopMover[];
  limit: number;
  timestamp: string;
}

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

export async function loader({ request }: LoaderFunctionArgs) {
  // Validate App Proxy signature
  const context = validateAppProxy(request);
  if (!context.isValid && process.env.NODE_ENV === "production") {
    return errorResponse(401, "unauthorized", "Invalid request signature");
  }

  const url = new URL(request.url);
  const limit = Math.min(
    parsePositiveInt(url.searchParams.get("limit"), DEFAULT_LIMIT),
    MAX_LIMIT
  );

  try {
    metrics.increment("priceIndex.movers.requested");

    const { gainers, losers } = await getTopMovers(limit);

    const response: TopMoversResponse = {
      gainers,
      losers,
      limit,
      timestamp: new Date().toISOString(),
    };

    return jsonResponse(response);
  } catch (error) {
    logger.error("Top movers API error", {
      error: error instanceof Error ? error.message : String(error),
    });

    return errorResponse(
      500,
      "movers_fetch_failed",
      "Failed to fetch top movers. Please try again."
    );
  }
}

export async function action() {
  return errorResponse(405, "method_not_allowed", "Only GET requests are supported");
}
