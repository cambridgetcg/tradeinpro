/**
 * TCG-100 Index API
 *
 * GET /apps/trade-in/price-index/tcg100
 *
 * Returns the NASDAQ-style TCG-100 index with:
 * - Market-cap weighted constituents
 * - Weight capping applied
 * - Buffer zone information
 * - Index statistics
 * - Separate EN/JP language indices
 *
 * Query params:
 *   - game: Game to calculate index for (default: onepiece)
 *   - language: Language filter (EN, JP, ALL) (default: ALL)
 *   - includeConstituents: Include full constituent list (default: true)
 *   - page: Page number for constituents (default: 1)
 *   - limit: Constituents per page (default: 100)
 *   - sortBy: Sort field (rank, weight, change, price)
 *   - sortOrder: Sort direction (asc, desc)
 */

import type { LoaderFunctionArgs } from "react-router";
import {
  validateAppProxy,
  jsonResponse,
  errorResponse,
  parsePositiveInt,
} from "../lib/app-proxy.server";
import {
  calculateTCG100,
  getTCG100Constituents,
  type TCG100Result,
  type IndexConstituent,
  type Language,
} from "../lib/tcg100-index.server";
import { logger, metrics } from "../lib/observability.server";

export interface TCG100Response {
  // Language
  language: Language;

  // Core index data
  index: {
    value: number;
    previousValue: number;
    change24h: number;
    change7d: number;
    change30d: number;
    valueJpy: number | null;
  };

  // Market statistics
  market: {
    totalMarketCap: number;
    avgPrice: number;
    medianPrice: number;
    highPrice: number;
    lowPrice: number;
    constituentCount: number;
  };

  // Weight distribution
  weights: {
    largestWeight: number;
    top5Weight: number;
    concentrationIndex: number;
    volatilityIndex: number;
  };

  // Schedule
  schedule: {
    lastReconstitution: string | null;
    nextReconstitution: string;
    lastRebalance: string | null;
    nextRebalance: string;
  };

  // Constituents (paginated)
  constituents?: {
    data: ConstituentResponse[];
    total: number;
    page: number;
    limit: number;
  };

  // Metadata
  game: string;
  timestamp: string;
}

export interface ConstituentResponse {
  cardId: string;
  name: string;
  setCode: string | null;
  releaseSet: string | null;
  rarity: string | null;
  imageUrl: string | null;
  rank: number;
  previousRank: number | null;
  rankChange: number;
  priceGbp: number;
  priceJpy: number | null;
  change24h: number;
  change7d: number;
  rawWeight: number;
  cappedWeight: number;
  weightPercent: number;
  marketCap: number;
  inBufferZone: boolean;
  daysInIndex: number;
  volatility: number;
}

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 100;

export async function loader({ request }: LoaderFunctionArgs) {
  // Validate App Proxy signature
  const context = validateAppProxy(request);
  if (!context.isValid && process.env.NODE_ENV === "production") {
    return errorResponse(401, "unauthorized", "Invalid request signature");
  }

  const url = new URL(request.url);
  const game = url.searchParams.get("game") || "onepiece";
  const languageParam = url.searchParams.get("language")?.toUpperCase() || "ALL";
  const language: Language = (["EN", "JP", "ALL"].includes(languageParam)
    ? languageParam
    : "ALL") as Language;
  const includeConstituents = url.searchParams.get("includeConstituents") !== "false";
  const page = parsePositiveInt(url.searchParams.get("page"), 1);
  const limit = Math.min(
    parsePositiveInt(url.searchParams.get("limit"), DEFAULT_LIMIT),
    MAX_LIMIT
  );
  const sortBy = (url.searchParams.get("sortBy") || "rank") as
    | "rank"
    | "weight"
    | "change"
    | "price";
  const sortOrder = (url.searchParams.get("sortOrder") || "asc") as "asc" | "desc";

  try {
    metrics.increment("priceIndex.tcg100.requested");

    // Calculate index with language filter
    const indexData = await calculateTCG100(game, language);

    // Build response
    const response: TCG100Response = {
      language: indexData.language,
      index: {
        value: indexData.value,
        previousValue: indexData.previousValue,
        change24h: indexData.change24h,
        change7d: indexData.change7d,
        change30d: indexData.change30d,
        valueJpy: indexData.valueJpy,
      },
      market: {
        totalMarketCap: indexData.totalMarketCap,
        avgPrice: indexData.avgPrice,
        medianPrice: indexData.medianPrice,
        highPrice: indexData.highPrice,
        lowPrice: indexData.lowPrice,
        constituentCount: indexData.constituentCount,
      },
      weights: {
        largestWeight: indexData.largestWeight,
        top5Weight: indexData.top5Weight,
        concentrationIndex: indexData.concentrationIndex,
        volatilityIndex: indexData.volatilityIndex,
      },
      schedule: {
        lastReconstitution: indexData.lastReconstitution?.toISOString() ?? null,
        nextReconstitution: indexData.nextReconstitution.toISOString(),
        lastRebalance: indexData.lastRebalance?.toISOString() ?? null,
        nextRebalance: indexData.nextRebalance.toISOString(),
      },
      game,
      timestamp: new Date().toISOString(),
    };

    // Include constituents if requested
    if (includeConstituents) {
      const constituentsData = await getTCG100Constituents(game, language, {
        page,
        limit,
        sortBy,
        sortOrder,
      });

      response.constituents = {
        data: constituentsData.constituents.map(mapConstituent),
        total: constituentsData.total,
        page: constituentsData.page,
        limit: constituentsData.limit,
      };
    }

    return jsonResponse(response);
  } catch (error) {
    logger.error("TCG-100 API error", {
      error: error instanceof Error ? error.message : String(error),
    });

    return errorResponse(
      500,
      "tcg100_calculation_failed",
      "Failed to calculate TCG-100 index. Please try again."
    );
  }
}

function mapConstituent(c: IndexConstituent): ConstituentResponse {
  return {
    cardId: c.cardId,
    name: c.name,
    setCode: c.setCode,
    releaseSet: c.releaseSet,
    rarity: c.rarity,
    imageUrl: c.imageUrl,
    rank: c.rank,
    previousRank: c.previousRank,
    rankChange: c.rankChange,
    priceGbp: c.priceGbp,
    priceJpy: c.priceJpy,
    change24h: c.change24h,
    change7d: c.change7d,
    rawWeight: c.rawWeight,
    cappedWeight: c.cappedWeight,
    weightPercent: c.cappedWeight * 100,
    marketCap: c.marketCap,
    inBufferZone: c.inBufferZone,
    daysInIndex: c.daysInIndex,
    volatility: c.volatility,
  };
}

export async function action() {
  return errorResponse(405, "method_not_allowed", "Only GET requests are supported");
}
