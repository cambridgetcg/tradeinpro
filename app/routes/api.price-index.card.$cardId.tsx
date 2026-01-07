/**
 * Card Detail API
 *
 * GET /apps/trade-in/price-index/card/:cardId
 *
 * Returns comprehensive card data for the detail page including:
 * - Card metadata and image
 * - Current pricing (market + trade-in)
 * - Price history with stats
 * - Related cards (same character/set)
 *
 * Query params:
 *   - days: Number of days of history (default: 30, max: 365)
 */

import type { LoaderFunctionArgs } from "react-router";
import {
  validateAppProxy,
  jsonResponse,
  errorResponse,
  parsePositiveInt,
} from "../lib/app-proxy.server";
import prisma from "../db.server";
import type { CardPriceHistory } from "@prisma/client";
import { logger, metrics } from "../lib/observability.server";
import { getCachedCardHistory } from "../lib/cache.server";

const DEFAULT_DAYS = 30;
const MAX_DAYS = 365;
const TRADEIN_PERCENT = 70;

export interface CardDetailResponse {
  card: {
    cardId: string;
    name: string;
    fullCardNumber: string | null;
    setCode: string | null;
    releaseSet: string | null;
    variantType: string | null;
    rarity: string | null;
    language: string | null;
    imageUrl: string | null;
  };

  pricing: {
    currentGbp: number;
    currentUsd: number | null;
    currentJpy: number | null;
    tradeinGbp: number;
    tradeinPercent: number;
    change24h: number;
    change7d: number;
    change30d: number;
    updatedAt: string | null;
  };

  stats: {
    highGbp: number;
    lowGbp: number;
    avgGbp: number;
    highJpy: number | null;
    lowJpy: number | null;
    avgJpy: number | null;
    volatility: number;
    daysTracked: number;
  };

  history: Array<{
    date: string;
    priceGbp: number;
    priceJpy: number | null;
    change: number;
    changeJpy: number | null;
    changeFx: number | null;
  }>;

  related: Array<{
    cardId: string;
    name: string;
    variantType: string | null;
    priceGbp: number;
    change24h: number;
    imageUrl: string | null;
  }>;

  exchangeRate: {
    current: number | null;
    change24h: number | null;
  };
}

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

  const decodedCardId = decodeURIComponent(cardId);
  const url = new URL(request.url);
  const days = Math.min(
    parsePositiveInt(url.searchParams.get("days"), DEFAULT_DAYS),
    MAX_DAYS
  );

  logger.info("Card detail request", { cardId: decodedCardId, days });
  metrics.increment("priceIndex.cardDetail.requested");

  try {
    // Find the card - try exact match first, then by fullCardNumber
    let card = await prisma.cardPriceV2.findFirst({
      where: { cardId: decodedCardId },
    });

    if (!card) {
      card = await prisma.cardPriceV2.findFirst({
        where: { fullCardNumber: decodedCardId },
      });
    }

    if (!card) {
      // Try partial match
      card = await prisma.cardPriceV2.findFirst({
        where: {
          cardId: { contains: decodedCardId },
        },
      });
    }

    if (!card) {
      metrics.increment("priceIndex.cardDetail.notFound");
      return errorResponse(
        404,
        "card_not_found",
        `Card not found: ${decodedCardId}`
      );
    }

    // Get price history (cached)
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const history = await getCachedCardHistory(
      card.cardId,
      days,
      async () => {
        return prisma.cardPriceHistory.findMany({
          where: {
            cardId: card.cardId,
            snapshotDate: { gte: startDate },
          },
          orderBy: { snapshotDate: "asc" },
        });
      }
    );

    // Calculate stats from history
    const pricesGbp = history.map((h: CardPriceHistory) => h.priceGbp.toNumber());
    const pricesJpy = history
      .map((h: CardPriceHistory) => h.priceJpy?.toNumber())
      .filter((p: number | undefined): p is number => p !== null && p !== undefined && p > 0);

    const currentGbp = card.bestPriceGbp?.toNumber() ?? pricesGbp[pricesGbp.length - 1] ?? 0;
    const highGbp = pricesGbp.length > 0 ? Math.max(...pricesGbp) : currentGbp;
    const lowGbp = pricesGbp.length > 0 ? Math.min(...pricesGbp) : currentGbp;
    const avgGbp = pricesGbp.length > 0
      ? pricesGbp.reduce((a: number, b: number) => a + b, 0) / pricesGbp.length
      : currentGbp;

    const highJpy = pricesJpy.length > 0 ? Math.max(...pricesJpy) : null;
    const lowJpy = pricesJpy.length > 0 ? Math.min(...pricesJpy) : null;
    const avgJpy = pricesJpy.length > 0
      ? pricesJpy.reduce((a: number, b: number) => a + b, 0) / pricesJpy.length
      : null;

    // Calculate volatility (standard deviation as % of mean)
    let volatility = 0;
    if (pricesGbp.length > 1 && avgGbp > 0) {
      const squaredDiffs = pricesGbp.map((p: number) => Math.pow(p - avgGbp, 2));
      const variance = squaredDiffs.reduce((a: number, b: number) => a + b, 0) / pricesGbp.length;
      volatility = (Math.sqrt(variance) / avgGbp) * 100;
    }

    // Calculate changes
    let change24h = 0;
    let change7d = 0;
    let change30d = 0;

    if (history.length >= 2) {
      const yesterday = history[history.length - 2]?.priceGbp.toNumber();
      if (yesterday && yesterday > 0) {
        change24h = ((currentGbp - yesterday) / yesterday) * 100;
      }
    }

    if (history.length >= 7) {
      const price7dAgo = history[Math.max(0, history.length - 7)]?.priceGbp.toNumber();
      if (price7dAgo && price7dAgo > 0) {
        change7d = ((currentGbp - price7dAgo) / price7dAgo) * 100;
      }
    }

    if (history.length >= 30) {
      const price30dAgo = history[Math.max(0, history.length - 30)]?.priceGbp.toNumber();
      if (price30dAgo && price30dAgo > 0) {
        change30d = ((currentGbp - price30dAgo) / price30dAgo) * 100;
      }
    }

    // Get related cards (same fullCardNumber with different variants, or same set)
    const related = await getRelatedCards(card);

    // Get current exchange rate
    const latestRate = await prisma.exchangeRateHistory.findFirst({
      orderBy: { date: "desc" },
      select: { jpyToGbp: true, change24h: true },
    });

    const response: CardDetailResponse = {
      card: {
        cardId: card.cardId,
        name: card.name,
        fullCardNumber: card.fullCardNumber,
        setCode: card.setCode,
        releaseSet: card.releaseSet,
        variantType: card.variantType,
        rarity: card.rarity,
        language: card.language,
        imageUrl: card.imageUrl,
      },
      pricing: {
        currentGbp,
        currentUsd: card.optcgTcgplayerUsd?.toNumber() ?? null,
        currentJpy: pricesJpy.length > 0 ? pricesJpy[pricesJpy.length - 1] : null,
        tradeinGbp: currentGbp * (TRADEIN_PERCENT / 100),
        tradeinPercent: TRADEIN_PERCENT,
        change24h,
        change7d,
        change30d,
        updatedAt: card.lastUpdated?.toISOString() ?? null,
      },
      stats: {
        highGbp,
        lowGbp,
        avgGbp,
        highJpy,
        lowJpy,
        avgJpy,
        volatility,
        daysTracked: history.length,
      },
      history: history.map((h: CardPriceHistory) => ({
        date: h.snapshotDate.toISOString().split("T")[0],
        priceGbp: h.priceGbp.toNumber(),
        priceJpy: h.priceJpy?.toNumber() ?? null,
        change: h.change.toNumber(),
        changeJpy: h.changeJpy?.toNumber() ?? null,
        changeFx: h.changeFx?.toNumber() ?? null,
      })),
      related,
      exchangeRate: {
        current: latestRate?.jpyToGbp?.toNumber() ?? null,
        change24h: latestRate?.change24h?.toNumber() ?? null,
      },
    };

    metrics.increment("priceIndex.cardDetail.success");
    return jsonResponse(response);
  } catch (error) {
    logger.error("Card detail API error", {
      cardId: decodedCardId,
      error: error instanceof Error ? error.message : String(error),
    });

    return errorResponse(
      500,
      "card_detail_failed",
      "Failed to fetch card details. Please try again."
    );
  }
}

async function getRelatedCards(
  card: {
    cardId: string;
    fullCardNumber: string | null;
    setCode: string | null;
    name: string;
  }
): Promise<CardDetailResponse["related"]> {
  const related: CardDetailResponse["related"] = [];

  // Find cards with same fullCardNumber (different variants)
  if (card.fullCardNumber) {
    const sameNumber = await prisma.cardPriceV2.findMany({
      where: {
        fullCardNumber: card.fullCardNumber,
        cardId: { not: card.cardId },
      },
      take: 5,
      orderBy: { bestPriceGbp: "desc" },
    });

    for (const c of sameNumber) {
      const history = await prisma.cardPriceHistory.findFirst({
        where: { cardId: c.cardId },
        orderBy: { snapshotDate: "desc" },
        take: 2,
      });

      related.push({
        cardId: c.cardId,
        name: c.name,
        variantType: c.variantType,
        priceGbp: c.bestPriceGbp?.toNumber() ?? 0,
        change24h: history?.change.toNumber() ?? 0,
        imageUrl: c.imageUrl,
      });
    }
  }

  // If we need more, find cards from the same set
  if (related.length < 5 && card.setCode) {
    const sameSet = await prisma.cardPriceV2.findMany({
      where: {
        setCode: card.setCode,
        cardId: { not: card.cardId, notIn: related.map((r) => r.cardId) },
        bestPriceGbp: { gt: 10 }, // Only show valuable cards
      },
      take: 5 - related.length,
      orderBy: { bestPriceGbp: "desc" },
    });

    for (const c of sameSet) {
      const history = await prisma.cardPriceHistory.findFirst({
        where: { cardId: c.cardId },
        orderBy: { snapshotDate: "desc" },
      });

      related.push({
        cardId: c.cardId,
        name: c.name,
        variantType: c.variantType,
        priceGbp: c.bestPriceGbp?.toNumber() ?? 0,
        change24h: history?.change.toNumber() ?? 0,
        imageUrl: c.imageUrl,
      });
    }
  }

  return related;
}

export async function action() {
  return errorResponse(405, "method_not_allowed", "Only GET requests are supported");
}
