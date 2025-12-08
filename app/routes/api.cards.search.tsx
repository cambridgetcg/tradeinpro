/**
 * Card Search API
 *
 * GET /apps/trade-in/cards/search
 *
 * Public endpoint (via App Proxy) for searching the card catalog.
 * Used for autocomplete in the trade-in submission form.
 * Now queries CardPriceV2 directly for real-time prices and images.
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


export interface CardSearchResult {
  id: string;
  cardName: string;
  setName: string;
  setCode: string | null;
  cardNumber: string | null;
  variant: string | null;
  rarity: string | null;
  imageUrl: string | null;
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
      orderBy: [{ tradeinPriceGbp: "desc" }, { name: "asc" }],
      take: limit,
      select: {
        cardId: true,
        name: true,
        setCode: true,
        cardNumber: true,
        variantType: true,
        rarity: true,
        imageUrl: true,
        tradeinPriceGbp: true,
      },
    });

    // Transform to API response format with condition prices
    const results: CardSearchResult[] = cards.map((card: typeof cards[number]) => {
      const basePrice = card.tradeinPriceGbp
        ? Math.round(Number(card.tradeinPriceGbp) * 100) // Convert GBP to pence
        : 0;

      // Apply condition multipliers
      return {
        id: card.cardId, // Use cardId as the ID for cart operations
        cardName: card.name,
        setName: card.setCode || "Unknown Set",
        setCode: card.setCode,
        cardNumber: card.cardNumber,
        variant: card.variantType,
        rarity: card.rarity,
        imageUrl: card.imageUrl,
        prices: {
          NM: Math.round(basePrice * settings.conditionMultiplierNM),
          LP: Math.round(basePrice * settings.conditionMultiplierLP),
          MP: Math.round(basePrice * settings.conditionMultiplierMP),
          HP: Math.round(basePrice * settings.conditionMultiplierHP),
          DMG: Math.round(basePrice * settings.conditionMultiplierDMG),
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
