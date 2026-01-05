/**
 * Card Lookup API (renamed from search to avoid Shopify reserved path)
 *
 * GET /apps/trade-in/cards/lookup
 *
 * Public endpoint (via App Proxy) for searching the card catalog.
 * Used for autocomplete in the trade-in submission form.
 * Now queries CardPriceV2 directly for real-time prices and images.
 *
 * NOTE: Route renamed from /cards/search to /cards/lookup because
 * Shopify intercepts URLs containing "search" as a reserved path.
 */

import type { LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import {
  validateAppProxy,
  jsonResponse,
  errorResponse,
  sanitizeString,
  parsePositiveInt,
} from "../lib/app-proxy.server";
import { getOrCreateSettings } from "../lib/settings.server";

// Maximum results per request
const MAX_RESULTS = 50;
const DEFAULT_RESULTS = 20;
const MIN_QUERY_LENGTH = 2;
const MAX_QUERY_LENGTH = 100;

// Price freshness thresholds
const PRICE_FRESH_THRESHOLD_MS = 4 * 60 * 60 * 1000; // 4 hours - prices are fresh
const PRICE_STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours - prices may be outdated


export interface CardSearchResult {
  id: string;
  cardName: string;
  setName: string;
  setCode: string | null;
  cardNumber: string | null;
  variant: string | null;
  rarity: string | null;
  imageUrl: string | null;
  bestPriceGbp: number; // Market price in pence (for reference)
  prices: {
    NM: number;
    LP: number;
    MP: number;
    HP: number;
    DMG: number;
  };
}

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
  const setCode = sanitizeString(url.searchParams.get("set") || "", 20) || undefined;
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

  // Get settings for condition multipliers
  const settings = await getOrCreateSettings(context.shop || "default");

  try {
    // Build where clause dynamically
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const baseWhere: Record<string, any> = {
      game: "onepiece",
      tradeinPriceGbp: { not: null },
      OR: [
        { name: { contains: query, mode: "insensitive" } },
        { cardId: { contains: query, mode: "insensitive" } },
        { setCode: { contains: query, mode: "insensitive" } },
      ],
    };

    // Add set filter
    if (setCode) {
      baseWhere.setCode = setCode.toUpperCase();
    }

    // Add minimum price filter
    if (minPrice) {
      const minGbp = minPrice / 100;
      baseWhere.tradeinPriceGbp = { gte: minGbp };
    }

    const cards = await prisma.cardPriceV2.findMany({
      where: baseWhere,
      orderBy: [{ bestPriceGbp: "desc" }, { name: "asc" }],
      take: limit,
      select: {
        cardId: true,
        name: true,
        setCode: true,
        cardNumber: true,
        variantType: true,
        rarity: true,
        imageUrl: true,
        bestPriceGbp: true, // Market price - use this as base for calculations
        lastUpdated: true, // For freshness check
      },
    });

    // Check price freshness based on most recent update
    const now = Date.now();
    let oldestUpdate: Date | null = null;
    let newestUpdate: Date | null = null;

    for (const card of cards) {
      if (card.lastUpdated) {
        if (!oldestUpdate || card.lastUpdated < oldestUpdate) {
          oldestUpdate = card.lastUpdated;
        }
        if (!newestUpdate || card.lastUpdated > newestUpdate) {
          newestUpdate = card.lastUpdated;
        }
      }
    }

    const oldestAge = oldestUpdate ? now - oldestUpdate.getTime() : 0;
    const pricesFreshness = {
      status: oldestAge > PRICE_STALE_THRESHOLD_MS
        ? "expired"
        : oldestAge > PRICE_FRESH_THRESHOLD_MS
          ? "stale"
          : "fresh",
      oldestUpdateAt: oldestUpdate?.toISOString() || null,
      newestUpdateAt: newestUpdate?.toISOString() || null,
      message: oldestAge > PRICE_STALE_THRESHOLD_MS
        ? "Prices may be outdated. Please verify before submitting."
        : oldestAge > PRICE_FRESH_THRESHOLD_MS
          ? "Prices were last updated over 4 hours ago."
          : null,
    };

    // Transform to API response format with condition prices
    // IMPORTANT: Use bestPriceGbp (market price) as the base for condition multipliers
    // This ensures NM = 70% of market, LP = 55% of market, etc.
    // Previously used tradeinPriceGbp which already had 70% applied, causing double-discount
    const results: CardSearchResult[] = cards.map((card: typeof cards[number]) => {
      const marketPricePence = card.bestPriceGbp
        ? Math.round(Number(card.bestPriceGbp) * 100) // Convert GBP to pence
        : 0;

      // Apply condition multipliers to market price (not tradein price)
      return {
        id: card.cardId, // Use cardId as the ID for cart operations
        cardName: card.name,
        setName: card.setCode || "Unknown Set",
        setCode: card.setCode,
        cardNumber: card.cardNumber,
        variant: card.variantType,
        rarity: card.rarity,
        imageUrl: card.imageUrl,
        bestPriceGbp: marketPricePence, // Market price in pence for theme reference
        prices: {
          // Round down to nearest 10p (10 pence)
          NM: Math.floor(marketPricePence * settings.conditionMultiplierNM / 10) * 10,
          LP: Math.floor(marketPricePence * settings.conditionMultiplierLP / 10) * 10,
          MP: Math.floor(marketPricePence * settings.conditionMultiplierMP / 10) * 10,
          HP: Math.floor(marketPricePence * settings.conditionMultiplierHP / 10) * 10,
          DMG: Math.floor(marketPricePence * settings.conditionMultiplierDMG / 10) * 10,
        },
      };
    });

    return jsonResponse({
      results,
      count: results.length,
      query,
      filters: {
        setCode: setCode || null,
        limit,
        minPrice: minPrice || null,
      },
      pricesFreshness,
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
