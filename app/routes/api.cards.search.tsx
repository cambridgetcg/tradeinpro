/**
 * Card Search API
 *
 * GET /apps/trade-in/cards/search
 *
 * Public endpoint (via App Proxy) for searching the card catalog.
 * Used for autocomplete in the trade-in submission form.
 */

import type { LoaderFunctionArgs } from "react-router";
import {
  validateAppProxy,
  jsonResponse,
  errorResponse,
  sanitizeString,
  parsePositiveInt,
} from "../lib/app-proxy.server";
import { searchCards } from "../lib/submissions.server";

// Maximum results per request
const MAX_RESULTS = 50;
const DEFAULT_RESULTS = 20;
const MIN_QUERY_LENGTH = 2;
const MAX_QUERY_LENGTH = 100;

export async function loader({ request }: LoaderFunctionArgs) {
  // Validate App Proxy signature (but don't require customer login)
  const context = validateAppProxy(request);

  // In production, reject invalid signatures
  // For development/testing, we may allow direct access
  if (!context.isValid && process.env.NODE_ENV === "production") {
    return errorResponse(401, "unauthorized", "Invalid request signature");
  }

  const url = new URL(request.url);

  // Extract and validate query parameters
  const query = sanitizeString(url.searchParams.get("q") || "", MAX_QUERY_LENGTH);
  const game = sanitizeString(url.searchParams.get("game") || "", 50) || undefined;
  const limit = Math.min(
    parsePositiveInt(url.searchParams.get("limit"), DEFAULT_RESULTS),
    MAX_RESULTS
  );
  const minPrice = parsePositiveInt(url.searchParams.get("minPrice"), 0) || undefined;

  // Validate query length
  if (query.length < MIN_QUERY_LENGTH) {
    return jsonResponse({
      results: [],
      count: 0,
      query,
      message: `Query must be at least ${MIN_QUERY_LENGTH} characters`,
    });
  }

  try {
    const results = await searchCards({
      query,
      game,
      limit,
      minPrice,
    });

    return jsonResponse({
      results,
      count: results.length,
      query,
      filters: {
        game: game || null,
        limit,
        minPrice: minPrice || null,
      },
    });
  } catch (error) {
    console.error("Card search error:", error);

    return errorResponse(
      500,
      "search_failed",
      "An error occurred while searching. Please try again."
    );
  }
}

// Only GET method is supported
export async function action() {
  return errorResponse(405, "method_not_allowed", "Only GET requests are supported");
}
