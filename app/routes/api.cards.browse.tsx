/**
 * Card Browse API
 *
 * GET /apps/trade-in/cards/browse
 *
 * Public endpoint (via App Proxy) for browsing cards with images.
 * Queries CardPriceV2 directly for real-time market prices and images.
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

// Configuration
const MAX_RESULTS = 100;
const DEFAULT_RESULTS = 24;
const MIN_QUERY_LENGTH = 2;
const MAX_QUERY_LENGTH = 100;

// CDN base URL for card images (configure via env var in production)
const IMAGE_CDN_BASE = process.env.CARD_IMAGE_CDN_URL || "/card-images/";

export interface CardBrowseResult {
  cardId: string;
  name: string;
  setCode: string | null;
  cardNumber: string | null;
  variantType: string | null;
  rarity: string | null;
  imageUrl: string | null;
  prices: {
    market: number; // Best market price in pence
    tradein: {
      NM: number;
      LP: number;
      MP: number;
      HP: number;
      DMG: number;
    };
  };
}

export interface CardBrowseResponse {
  cards: CardBrowseResult[];
  count: number;
  total: number;
  page: number;
  totalPages: number;
  sets: string[];
  releases: string[];
  filters: {
    query: string | null;
    setCode: string | null;
    releaseSet: string | null;
    minPrice: number | null;
    page: number;
    limit: number;
  };
}

export async function loader({ request }: LoaderFunctionArgs) {
  // Validate App Proxy signature
  const context = validateAppProxy(request);
  if (!context.isValid && process.env.NODE_ENV === "production") {
    return errorResponse(401, "unauthorized", "Invalid request signature");
  }

  const url = new URL(request.url);

  // Extract query parameters
  const query = sanitizeString(url.searchParams.get("q") || "", MAX_QUERY_LENGTH);
  const setCode = sanitizeString(url.searchParams.get("set") || "", 20) || undefined;
  const releaseSet = sanitizeString(url.searchParams.get("release") || "", 20) || undefined;
  const page = Math.max(1, parsePositiveInt(url.searchParams.get("page"), 1));
  const limit = Math.min(
    parsePositiveInt(url.searchParams.get("limit"), DEFAULT_RESULTS),
    MAX_RESULTS
  );
  const minPrice = parsePositiveInt(url.searchParams.get("minPrice"), 0) || undefined;
  const sortBy = sanitizeString(url.searchParams.get("sort") || "price-desc", 20);

  // Get settings for condition multipliers
  const settings = await getOrCreateSettings(context.shop || "default");

  try {
    // Build where clause dynamically
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const baseWhere: Record<string, any> = {
      game: "onepiece",
      tradeinPriceGbp: { not: null },
    };

    // Add search filter
    if (query && query.length >= MIN_QUERY_LENGTH) {
      baseWhere.OR = [
        { name: { contains: query, mode: "insensitive" } },
        { cardId: { contains: query, mode: "insensitive" } },
        { setCode: { contains: query, mode: "insensitive" } },
      ];
    }

    // Add set filter
    if (setCode) {
      baseWhere.setCode = setCode.toUpperCase();
    }

    // Add release filter (e.g., OP07, ST01)
    if (releaseSet) {
      baseWhere.releaseSet = releaseSet.toUpperCase();
    }

    // Add minimum price filter (in GBP, convert to compare)
    if (minPrice) {
      const minGbp = minPrice / 100; // Convert pence to pounds
      baseWhere.tradeinPriceGbp = { gte: minGbp };
    }

    // Determine sort order
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let orderBy: any;
    switch (sortBy) {
      case "price-asc":
        orderBy = { tradeinPriceGbp: "asc" };
        break;
      case "price-desc":
        orderBy = { tradeinPriceGbp: "desc" };
        break;
      case "name":
        orderBy = { name: "asc" };
        break;
      case "set":
        orderBy = [{ setCode: "asc" }, { cardNumber: "asc" }];
        break;
      default:
        orderBy = { tradeinPriceGbp: "desc" };
    }

    // Get total count and paginated results
    const [total, cards, allSets, allReleases] = await Promise.all([
      prisma.cardPriceV2.count({ where: baseWhere }),
      prisma.cardPriceV2.findMany({
        where: baseWhere,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
        select: {
          cardId: true,
          name: true,
          setCode: true,
          releaseSet: true,
          cardNumber: true,
          variantType: true,
          rarity: true,
          imageUrl: true,
          bestPriceGbp: true,
          tradeinPriceGbp: true,
        },
      }),
      // Get unique sets for filter dropdown
      prisma.cardPriceV2.groupBy({
        by: ["setCode"],
        where: { game: "onepiece", tradeinPriceGbp: { not: null } },
        orderBy: { setCode: "asc" },
      }),
      // Get unique releases for filter dropdown
      prisma.cardPriceV2.groupBy({
        by: ["releaseSet"],
        where: { game: "onepiece", tradeinPriceGbp: { not: null } },
        orderBy: { releaseSet: "asc" },
      }),
    ]);

    // Transform results with condition prices
    const results: CardBrowseResult[] = cards.map((card: typeof cards[number]) => {
      const basePrice = card.tradeinPriceGbp
        ? Math.round(Number(card.tradeinPriceGbp) * 100) // Convert GBP to pence
        : 0;

      const marketPrice = card.bestPriceGbp
        ? Math.round(Number(card.bestPriceGbp) * 100)
        : 0;

      // Apply condition multipliers
      const tradeinPrices = {
        NM: Math.round(basePrice * settings.conditionMultiplierNM),
        LP: Math.round(basePrice * settings.conditionMultiplierLP),
        MP: Math.round(basePrice * settings.conditionMultiplierMP),
        HP: Math.round(basePrice * settings.conditionMultiplierHP),
        DMG: Math.round(basePrice * settings.conditionMultiplierDMG),
      };

      return {
        cardId: card.cardId,
        name: card.name,
        setCode: card.setCode,
        cardNumber: card.cardNumber,
        variantType: card.variantType,
        rarity: card.rarity,
        imageUrl: card.imageUrl ? `${IMAGE_CDN_BASE}${card.imageUrl}` : null,
        prices: {
          market: marketPrice,
          tradein: tradeinPrices,
        },
      };
    });

    const response: CardBrowseResponse = {
      cards: results,
      count: results.length,
      total,
      page,
      totalPages: Math.ceil(total / limit),
      sets: allSets.map((s: { setCode: string | null }) => s.setCode).filter((s: string | null): s is string => s !== null),
      releases: allReleases.map((r: { releaseSet: string | null }) => r.releaseSet).filter((r: string | null): r is string => r !== null),
      filters: {
        query: query || null,
        setCode: setCode || null,
        releaseSet: releaseSet || null,
        minPrice: minPrice || null,
        page,
        limit,
      },
    };

    return jsonResponse(response);
  } catch (error) {
    console.error("Card browse error:", error);
    return errorResponse(
      500,
      "browse_failed",
      "An error occurred while browsing cards. Please try again."
    );
  }
}

// Only GET is supported
export async function action() {
  return errorResponse(405, "method_not_allowed", "Only GET requests are supported");
}
