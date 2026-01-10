/**
 * Neural Deals API Endpoint
 *
 * GET /api/v1/neural/deals
 *
 * Returns AI-identified market deals.
 * Requires Neural tier API access.
 */

import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";

export async function loader({ request }: LoaderFunctionArgs) {
  const { authenticateRequest, ApiAuthError } = await import(
    "../lib/neural/api-auth.server"
  );
  const { getShardClient, parseGameShard } = await import(
    "../lib/shard.server"
  );

  const startTime = Date.now();

  try {
    // Authenticate request
    const auth = await authenticateRequest(request);

    // Check neural access
    if (!auth.permissions.neuralAccess) {
      return json(
        {
          error: "Neural access requires Tier 4 subscription",
          upgradeUrl: "/api/upgrade",
        },
        { status: 403 }
      );
    }

    // Parse query parameters
    const url = new URL(request.url);
    const game = parseGameShard(url.searchParams.get("game"));
    const dealType = url.searchParams.get("type");
    const minConfidence = parseFloat(
      url.searchParams.get("minConfidence") || "0.5"
    );
    const limit = Math.min(
      parseInt(url.searchParams.get("limit") || "50"),
      100
    );

    // Get deals from database
    const client = getShardClient(game);

    const where: Record<string, unknown> = {
      game,
      status: "ACTIVE",
      confidence: { gte: minConfidence },
      expiresAt: { gt: new Date() },
    };

    if (dealType) {
      where.dealType = dealType;
    }

    const deals = await client.neuralDeal.findMany({
      where,
      orderBy: [{ confidence: "desc" }, { expectedReturn: "desc" }],
      take: limit,
    });

    // Group by type for summary
    const byType: Record<string, number> = {};
    let totalConfidence = 0;
    let totalReturn = 0;

    for (const deal of deals) {
      byType[deal.dealType] = (byType[deal.dealType] || 0) + 1;
      totalConfidence += deal.confidence.toNumber();
      totalReturn += deal.expectedReturn.toNumber();
    }

    const response = {
      deals: deals.map((deal) => ({
        dealId: deal.id,
        cardId: deal.cardId,
        dealType: deal.dealType,
        confidence: deal.confidence.toNumber(),
        expectedReturn: deal.expectedReturn.toNumber(),
        timeHorizon: deal.timeHorizon,
        riskLevel: deal.riskLevel,
        action: {
          type: deal.actionType,
          buyMarket: deal.buyMarket,
          buyPrice: deal.buyPrice?.toNumber(),
          sellMarket: deal.sellMarket,
          sellPrice: deal.sellPrice?.toNumber(),
        },
        expiresAt: deal.expiresAt.toISOString(),
        createdAt: deal.createdAt.toISOString(),
      })),
      summary: {
        totalDeals: deals.length,
        byType,
        avgConfidence:
          deals.length > 0 ? totalConfidence / deals.length : 0,
        avgExpectedReturn:
          deals.length > 0 ? totalReturn / deals.length : 0,
      },
      generatedAt: new Date().toISOString(),
    };

    // Record usage
    const { recordApiUsage } = await import("../lib/neural/api-auth.server");
    await recordApiUsage(auth, request, {
      status: 200,
      durationMs: Date.now() - startTime,
    });

    return json(response);
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return json(
        { error: error.message, details: error.details },
        { status: error.status }
      );
    }
    console.error("[api.v1.neural.deals] Error:", error);
    return json({ error: "Internal server error" }, { status: 500 });
  }
}
