/**
 * Neural Predictions API Endpoint
 *
 * GET /api/v1/neural/predictions/:cardId
 *
 * Returns AI price predictions for a specific card.
 * Requires Neural tier API access.
 */

import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";

export async function loader({ request, params }: LoaderFunctionArgs) {
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

    const { cardId } = params;
    if (!cardId) {
      return json({ error: "Card ID is required" }, { status: 400 });
    }

    // Parse query parameters
    const url = new URL(request.url);
    const game = parseGameShard(url.searchParams.get("game"));

    const client = getShardClient(game);

    // Get latest prediction
    const prediction = await client.neuralPrediction.findFirst({
      where: {
        cardId,
        expiresAt: { gt: new Date() },
      },
      orderBy: { predictedAt: "desc" },
    });

    // Get card details
    const card = await client.cardPriceV2.findUnique({
      where: { cardId },
      select: {
        cardId: true,
        name: true,
        setCode: true,
        bestPriceGbp: true,
      },
    });

    if (!card) {
      return json({ error: "Card not found" }, { status: 404 });
    }

    const response = {
      cardId: card.cardId,
      cardName: card.name,
      setCode: card.setCode,
      currentPrice: card.bestPriceGbp?.toNumber(),
      prediction: prediction
        ? {
            price24h: prediction.price24h?.toNumber(),
            price7d: prediction.price7d?.toNumber(),
            price30d: prediction.price30d?.toNumber(),
            confidence24h: prediction.confidence24h?.toNumber(),
            confidence7d: prediction.confidence7d?.toNumber(),
            confidence30d: prediction.confidence30d?.toNumber(),
            modelVersion: prediction.modelVersion,
            predictedAt: prediction.predictedAt.toISOString(),
          }
        : null,
      source: prediction ? "cached" : "not_available",
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
    console.error("[api.v1.neural.predictions] Error:", error);
    return json({ error: "Internal server error" }, { status: 500 });
  }
}
