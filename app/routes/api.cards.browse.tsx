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

// Price freshness thresholds
const PRICE_FRESH_THRESHOLD_MS = 4 * 60 * 60 * 1000; // 4 hours - prices are fresh
const PRICE_STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours - prices may be outdated


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
  pricesFreshness: {
    status: "fresh" | "stale" | "expired";
    oldestUpdateAt: string | null;
    message: string | null;
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
  const game = sanitizeString(url.searchParams.get("game") || "onepiece", 50);
  const language = sanitizeString(url.searchParams.get("language") || "", 10) || undefined;
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
      game,
      tradeinPriceGbp: { not: null },
    };

    // Add language filter
    if (language) {
      baseWhere.language = language.toUpperCase();
    }

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
          updatedAt: true, // For freshness check
        },
      }),
      // Get unique sets for filter dropdown
      prisma.cardPriceV2.groupBy({
        by: ["setCode"],
        where: { game, tradeinPriceGbp: { not: null } },
        orderBy: { setCode: "asc" },
      }),
      // Get unique releases for filter dropdown
      prisma.cardPriceV2.groupBy({
        by: ["releaseSet"],
        where: { game, tradeinPriceGbp: { not: null } },
        orderBy: { releaseSet: "asc" },
      }),
    ]);

    // Check price freshness based on most recent update
    const now = Date.now();
    let oldestUpdate: Date | null = null;

    for (const card of cards) {
      if (card.updatedAt) {
        if (!oldestUpdate || card.updatedAt < oldestUpdate) {
          oldestUpdate = card.updatedAt;
        }
      }
    }

    const oldestAge = oldestUpdate ? now - oldestUpdate.getTime() : 0;
    const pricesFreshness = {
      status: (oldestAge > PRICE_STALE_THRESHOLD_MS
        ? "expired"
        : oldestAge > PRICE_FRESH_THRESHOLD_MS
          ? "stale"
          : "fresh") as "fresh" | "stale" | "expired",
      oldestUpdateAt: oldestUpdate?.toISOString() || null,
      message: oldestAge > PRICE_STALE_THRESHOLD_MS
        ? "Prices may be outdated. Please verify before submitting."
        : oldestAge > PRICE_FRESH_THRESHOLD_MS
          ? "Prices were last updated over 4 hours ago."
          : null,
    };

    // Transform results with condition prices
    // IMPORTANT: Use bestPriceGbp (market price) as the base for condition multipliers
    // This ensures NM = 70% of market, LP = 55% of market, etc.
    // Previously used tradeinPriceGbp which already had 70% applied, causing double-discount
    const results: CardBrowseResult[] = cards.map((card: typeof cards[number]) => {
      const marketPricePence = card.bestPriceGbp
        ? Math.round(Number(card.bestPriceGbp) * 100) // Convert GBP to pence
        : 0;

      // Apply condition multipliers to market price (not tradein price)
      // Round down to nearest 10p (10 pence)
      const tradeinPrices = {
        NM: Math.floor(marketPricePence * settings.conditionMultiplierNM / 10) * 10,
        LP: Math.floor(marketPricePence * settings.conditionMultiplierLP / 10) * 10,
        MP: Math.floor(marketPricePence * settings.conditionMultiplierMP / 10) * 10,
        HP: Math.floor(marketPricePence * settings.conditionMultiplierHP / 10) * 10,
        DMG: Math.floor(marketPricePence * settings.conditionMultiplierDMG / 10) * 10,
      };

      return {
        cardId: card.cardId,
        name: card.name,
        setCode: card.setCode,
        cardNumber: card.cardNumber,
        variantType: card.variantType,
        rarity: card.rarity,
        imageUrl: card.imageUrl,
        prices: {
          market: marketPricePence,
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
      pricesFreshness,
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
