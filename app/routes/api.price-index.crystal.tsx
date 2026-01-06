/**
 * Crystal Visualization Data API
 *
 * GET /apps/trade-in/price-index/crystal
 *
 * Returns node/edge data for the crystal neural network visualization.
 * Provides card nodes, correlation edges, and set clusters.
 */

import type { LoaderFunctionArgs } from "react-router";
import {
  validateAppProxy,
  jsonResponse,
  errorResponse,
  sanitizeString,
  parsePositiveInt,
} from "../lib/app-proxy.server";
import { getCrystalData, type CrystalData } from "../lib/price-index.server";
import { logger, metrics } from "../lib/observability.server";

export interface CrystalDataResponse extends CrystalData {
  game: string;
  nodeCount: number;
  edgeCount: number;
  clusterCount: number;
  generatedAt: string;
}

const DEFAULT_MAX_NODES = 150;
const MAX_NODES_LIMIT = 500;

export async function loader({ request }: LoaderFunctionArgs) {
  // Validate App Proxy signature
  const context = validateAppProxy(request);
  if (!context.isValid && process.env.NODE_ENV === "production") {
    return errorResponse(401, "unauthorized", "Invalid request signature");
  }

  const url = new URL(request.url);
  const game = sanitizeString(url.searchParams.get("game") || "onepiece", 50);
  const maxNodes = Math.min(
    parsePositiveInt(url.searchParams.get("limit"), DEFAULT_MAX_NODES),
    MAX_NODES_LIMIT
  );

  try {
    logger.info("Generating crystal data", { game, maxNodes });
    metrics.increment("priceIndex.crystal.requested");

    const crystalData = await getCrystalData(game, maxNodes);

    const response: CrystalDataResponse = {
      ...crystalData,
      game,
      nodeCount: crystalData.nodes.length,
      edgeCount: crystalData.edges.length,
      clusterCount: crystalData.clusters.length,
      generatedAt: new Date().toISOString(),
    };

    metrics.increment("priceIndex.crystal.generated");

    return jsonResponse(response);
  } catch (error) {
    logger.error("Crystal data API error", {
      game,
      error: error instanceof Error ? error.message : String(error),
    });

    return errorResponse(
      500,
      "crystal_generation_failed",
      "Failed to generate crystal visualization data. Please try again."
    );
  }
}

export async function action() {
  return errorResponse(405, "method_not_allowed", "Only GET requests are supported");
}
