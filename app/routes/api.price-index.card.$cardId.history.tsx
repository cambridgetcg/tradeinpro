/**
 * Card Price History API
 *
 * GET /apps/trade-in/price-index/card/:cardId/history
 *
 * Returns historical price data for a specific card.
 * Used for charting individual card price trends.
 *
 * Query params:
 *   - days: Number of days of history (default: 30, max: 365)
 *
 * Example:
 *   /apps/trade-in/price-index/card/OP01-001/history?days=90
 */

import type { LoaderFunctionArgs } from "react-router";
import {
  validateAppProxy,
  jsonResponse,
  errorResponse,
  parsePositiveInt,
} from "../lib/app-proxy.server";
import { getCardHistory, type CardHistoryResponse } from "../lib/s3-prices.server";
import { logger, metrics } from "../lib/observability.server";

const DEFAULT_DAYS = 30;
const MAX_DAYS = 365;

export async function loader({ request, params }: LoaderFunctionArgs) {
  // Validate App Proxy signature
  const context = validateAppProxy(request);
  if (!context.isValid && process.env.NODE_ENV === "production") {
    return errorResponse(401, "unauthorized", "Invalid request signature");
  }

  const { cardId } = params;

  if (!cardId) {
    return errorResponse(400, "missing_card_id", "Card ID is required");
  }

  // Decode URL-encoded cardId (e.g., OP01-001 may be encoded)
  const decodedCardId = decodeURIComponent(cardId);

  const url = new URL(request.url);
  const days = Math.min(
    parsePositiveInt(url.searchParams.get("days"), DEFAULT_DAYS),
    MAX_DAYS
  );

  logger.info("Card history request", { cardId: decodedCardId, days });
  metrics.increment("priceIndex.cardHistory.requested");

  try {
    const history = await getCardHistory(decodedCardId, days);

    if (!history) {
      metrics.increment("priceIndex.cardHistory.notFound");
      return errorResponse(
        404,
        "card_not_found",
        `No price history found for card: ${decodedCardId}`
      );
    }

    metrics.increment("priceIndex.cardHistory.success");

    return jsonResponse({
      ...history,
      requestedDays: days,
      actualDays: history.history.length,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    logger.error("Card history API error", {
      cardId: decodedCardId,
      error: error instanceof Error ? error.message : String(error),
    });

    return errorResponse(
      500,
      "history_fetch_failed",
      "Failed to fetch card history. Please try again."
    );
  }
}

export async function action() {
  return errorResponse(405, "method_not_allowed", "Only GET requests are supported");
}
