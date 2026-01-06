/**
 * Price Index Historical Data API
 *
 * GET /apps/trade-in/price-index/:type/:key
 *
 * Returns historical data for a specific price index.
 * Used for charting index trends over time.
 *
 * Examples:
 *   /apps/trade-in/price-index/GAME/onepiece?range=30
 *   /apps/trade-in/price-index/SET/OP01?range=7
 */

import type { LoaderFunctionArgs } from "react-router";
import {
  validateAppProxy,
  jsonResponse,
  errorResponse,
  parsePositiveInt,
} from "../lib/app-proxy.server";
import {
  getIndexHistory,
  calculateIndex,
  INDEX_CONFIGS,
  type IndexType,
  type IndexResult,
} from "../lib/price-index.server";
import { logger } from "../lib/observability.server";

export interface IndexHistoryResponse {
  index: {
    type: IndexType;
    key: string;
  };
  current: IndexResult | null;
  history: Array<{
    date: string;
    value: number;
    change: number;
  }>;
  stats: {
    high: number;
    low: number;
    avg: number;
    volatility: number;
  };
  range: number;
}

const VALID_INDEX_TYPES = ["GAME", "SET", "RARITY", "TOP_100", "LANGUAGE", "VOLATILITY"];
const MAX_RANGE_DAYS = 365;
const DEFAULT_RANGE = 30;

export async function loader({ request, params }: LoaderFunctionArgs) {
  // Validate App Proxy signature
  const context = validateAppProxy(request);
  if (!context.isValid && process.env.NODE_ENV === "production") {
    return errorResponse(401, "unauthorized", "Invalid request signature");
  }

  const { type, key } = params;

  // Validate type parameter
  if (!type || !VALID_INDEX_TYPES.includes(type.toUpperCase())) {
    return errorResponse(400, "invalid_type", `Invalid index type. Must be one of: ${VALID_INDEX_TYPES.join(", ")}`);
  }

  // Validate key parameter
  if (!key || key.length < 1 || key.length > 50) {
    return errorResponse(400, "invalid_key", "Index key must be 1-50 characters");
  }

  const url = new URL(request.url);
  const range = Math.min(
    parsePositiveInt(url.searchParams.get("range"), DEFAULT_RANGE),
    MAX_RANGE_DAYS
  );

  const indexType = type.toUpperCase() as IndexType;
  const indexKey = key;

  try {
    // Get historical data
    const history = await getIndexHistory(indexType, indexKey, range);

    // Calculate current value
    let current: IndexResult | null = null;

    // Check if we have a predefined config
    const configKey = `${indexType}_${indexKey}`;
    if (INDEX_CONFIGS[configKey]) {
      current = await calculateIndex(INDEX_CONFIGS[configKey]);
    } else if (indexType === "SET") {
      // Dynamic set index
      current = await calculateIndex({
        type: "SET",
        key: indexKey,
        weights: "equal",
        filters: { setCode: indexKey, minPrice: 0.5 },
      });
    }

    // Calculate stats from history
    const values = history.map((h) => h.value);
    const stats = {
      high: values.length > 0 ? Math.max(...values) : 0,
      low: values.length > 0 ? Math.min(...values) : 0,
      avg: values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0,
      volatility: current?.volatility ?? 0,
    };

    const response: IndexHistoryResponse = {
      index: {
        type: indexType,
        key: indexKey,
      },
      current,
      history,
      stats,
      range,
    };

    return jsonResponse(response);
  } catch (error) {
    logger.error("Index history API error", {
      type: indexType,
      key: indexKey,
      error: error instanceof Error ? error.message : String(error),
    });

    return errorResponse(
      500,
      "history_fetch_failed",
      "Failed to fetch index history. Please try again."
    );
  }
}

export async function action() {
  return errorResponse(405, "method_not_allowed", "Only GET requests are supported");
}
