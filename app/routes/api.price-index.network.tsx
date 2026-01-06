/**
 * Price Network API
 *
 * GET /apps/trade-in/price-index/network
 *
 * Returns neural network visualization data showing:
 * - Nodes: Cards with price and movement data
 * - Edges: Correlations between cards (positive/negative)
 * - Clusters: Set-based groupings with internal correlation
 * - Market Forces: Exchange rate impact and volume
 *
 * Query params:
 *   - game: Game to query (default: onepiece)
 *   - minCorrelation: Minimum correlation threshold (default: 0.3)
 *   - limit: Maximum nodes to return (default: 150)
 *
 * Example:
 *   /apps/trade-in/price-index/network?game=onepiece&minCorrelation=0.5
 */

import type { LoaderFunctionArgs } from "react-router";
import {
  validateAppProxy,
  jsonResponse,
  errorResponse,
  parsePositiveInt,
} from "../lib/app-proxy.server";
import { getNetworkData, type NetworkData } from "../lib/s3-prices.server";
import { logger, metrics } from "../lib/observability.server";

const DEFAULT_MIN_CORRELATION = 0.3;
const DEFAULT_LIMIT = 150;
const MAX_LIMIT = 500;

export async function loader({ request }: LoaderFunctionArgs) {
  // Validate App Proxy signature
  const context = validateAppProxy(request);
  if (!context.isValid && process.env.NODE_ENV === "production") {
    return errorResponse(401, "unauthorized", "Invalid request signature");
  }

  const url = new URL(request.url);
  const game = url.searchParams.get("game") || "onepiece";

  // Parse correlation threshold (0.0 to 1.0)
  const minCorrelationParam = url.searchParams.get("minCorrelation");
  let minCorrelation = DEFAULT_MIN_CORRELATION;
  if (minCorrelationParam) {
    const parsed = parseFloat(minCorrelationParam);
    if (!isNaN(parsed) && parsed >= 0 && parsed <= 1) {
      minCorrelation = parsed;
    }
  }

  const limit = Math.min(
    parsePositiveInt(url.searchParams.get("limit"), DEFAULT_LIMIT),
    MAX_LIMIT
  );

  logger.info("Network data request", { game, minCorrelation, limit });
  metrics.increment("priceIndex.network.requested");

  try {
    const networkData = await getNetworkData(game, minCorrelation, limit);

    metrics.increment("priceIndex.network.success");

    return jsonResponse({
      ...networkData,
      meta: {
        game,
        minCorrelation,
        limit,
        nodeCount: networkData.nodes.length,
        edgeCount: networkData.edges.length,
        clusterCount: networkData.clusters.length,
        generatedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    logger.error("Network API error", {
      game,
      error: error instanceof Error ? error.message : String(error),
    });

    return errorResponse(
      500,
      "network_fetch_failed",
      "Failed to fetch network data. Please try again."
    );
  }
}

export async function action() {
  return errorResponse(405, "method_not_allowed", "Only GET requests are supported");
}
