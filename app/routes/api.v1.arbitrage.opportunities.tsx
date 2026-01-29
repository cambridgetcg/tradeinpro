/**
 * API Route: Arbitrage Opportunities
 *
 * Lists detected arbitrage opportunities with filtering and sorting
 */

import type { LoaderFunctionArgs } from "react-router";

// =============================================================================
// TYPES
// =============================================================================

interface OpportunityFilters {
  minSpread?: number;
  maxSpread?: number;
  urgency?: "immediate" | "short" | "medium" | "low";
  buyMarket?: string;
  sellMarket?: string;
  minConfidence?: number;
  cardId?: string;
  limit?: number;
  offset?: number;
}

// =============================================================================
// LOADER - List opportunities
// =============================================================================

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);

  // Parse query parameters
  const filters: OpportunityFilters = {
    minSpread: url.searchParams.has("minSpread")
      ? parseFloat(url.searchParams.get("minSpread")!)
      : undefined,
    maxSpread: url.searchParams.has("maxSpread")
      ? parseFloat(url.searchParams.get("maxSpread")!)
      : undefined,
    urgency: url.searchParams.get("urgency") as OpportunityFilters["urgency"],
    buyMarket: url.searchParams.get("buyMarket") || undefined,
    sellMarket: url.searchParams.get("sellMarket") || undefined,
    minConfidence: url.searchParams.has("minConfidence")
      ? parseFloat(url.searchParams.get("minConfidence")!)
      : undefined,
    cardId: url.searchParams.get("cardId") || undefined,
    limit: parseInt(url.searchParams.get("limit") || "50", 10),
    offset: parseInt(url.searchParams.get("offset") || "0", 10),
  };

  const sortBy = url.searchParams.get("sortBy") || "netSpread";
  const sortOrder = url.searchParams.get("sortOrder") || "desc";

  const { prisma } = await import("../db.server");

  // Build where clause
  const where: Record<string, unknown> = {
    // Only show recent opportunities (last 24 hours)
    detectedAt: {
      gte: new Date(Date.now() - 24 * 60 * 60 * 1000),
    },
  };

  if (filters.minSpread !== undefined) {
    where.netSpread = { ...(where.netSpread as object || {}), gte: filters.minSpread };
  }
  if (filters.maxSpread !== undefined) {
    where.netSpread = { ...(where.netSpread as object || {}), lte: filters.maxSpread };
  }
  if (filters.urgency) {
    where.urgency = filters.urgency;
  }
  if (filters.buyMarket) {
    where.buyMarket = filters.buyMarket;
  }
  if (filters.sellMarket) {
    where.sellMarket = filters.sellMarket;
  }
  if (filters.minConfidence !== undefined) {
    where.confidence = { gte: filters.minConfidence };
  }
  if (filters.cardId) {
    where.cardId = filters.cardId;
  }

  // Fetch opportunities
  const [opportunities, total] = await Promise.all([
    prisma.arbitrageOpportunity.findMany({
      where,
      orderBy: {
        [sortBy]: sortOrder,
      },
      skip: filters.offset,
      take: filters.limit,
      select: {
        id: true,
        cardId: true,
        buyMarket: true,
        buyPrice: true,
        buyCurrency: true,
        buyPriceGbp: true,
        sellMarket: true,
        sellPrice: true,
        sellCurrency: true,
        sellPriceGbp: true,
        grossSpread: true,
        netSpread: true,
        estimatedFees: true,
        estimatedShipping: true,
        confidence: true,
        urgency: true,
        detectedAt: true,
        wasExecuted: true,
        wasSuccessful: true,
      },
    }),
    prisma.arbitrageOpportunity.count({ where }),
  ]);

  // Get market stats
  const marketStats = await prisma.arbitrageOpportunity.groupBy({
    by: ["buyMarket", "sellMarket"],
    _count: true,
    _avg: {
      netSpread: true,
      confidence: true,
    },
    where: {
      detectedAt: {
        gte: new Date(Date.now() - 24 * 60 * 60 * 1000),
      },
    },
  });

  return {
    opportunities: opportunities.map((opp) => ({
      ...opp,
      buyPrice: Number(opp.buyPrice),
      buyPriceGbp: Number(opp.buyPriceGbp),
      sellPrice: Number(opp.sellPrice),
      sellPriceGbp: Number(opp.sellPriceGbp),
      grossSpread: Number(opp.grossSpread),
      netSpread: Number(opp.netSpread),
      estimatedFees: Number(opp.estimatedFees),
      estimatedShipping: Number(opp.estimatedShipping),
      confidence: Number(opp.confidence),
    })),
    pagination: {
      total,
      offset: filters.offset,
      limit: filters.limit,
      hasMore: (filters.offset || 0) + (filters.limit || 50) < total,
    },
    marketStats: marketStats.map((stat) => ({
      route: `${stat.buyMarket}→${stat.sellMarket}`,
      count: stat._count,
      avgSpread: stat._avg.netSpread,
      avgConfidence: stat._avg.confidence,
    })),
    filters,
  };
}
