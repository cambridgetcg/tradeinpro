/**
 * Neural System Status API Endpoint
 *
 * GET /api/v1/neural/status
 *
 * Returns neural network system status and model info.
 * Requires Neural tier API access.
 */

import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";

export async function loader({ request }: LoaderFunctionArgs) {
  const { authenticateRequest, ApiAuthError } = await import(
    "../lib/neural/api-auth.server"
  );
  const { getModelService, getModelMetrics } = await import(
    "../lib/neural/model.server"
  );
  const { getShardClient } = await import("../lib/shard.server");

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

    // Get model service status
    const modelService = getModelService();
    const metadata = modelService.getMetadata();

    // Get recent model metrics
    let metrics = null;
    try {
      metrics = await getModelMetrics(metadata.version, 7);
    } catch {
      // Metrics may not be available yet
    }

    // Get deal statistics
    const client = getShardClient("onepiece");
    const now = new Date();

    const [activeDeals, totalDeals, recentPredictions] = await Promise.all([
      client.neuralDeal.count({
        where: {
          status: "ACTIVE",
          expiresAt: { gt: now },
        },
      }),
      client.neuralDeal.count(),
      client.neuralPrediction.count({
        where: {
          predictedAt: {
            gte: new Date(now.getTime() - 24 * 60 * 60 * 1000),
          },
        },
      }),
    ]);

    const response = {
      status: "operational",
      model: {
        version: metadata.version,
        isLoaded: metadata.isLoaded,
        inputShape: metadata.config.inputShape,
        numDealTypes: metadata.config.numDealTypes,
      },
      performance: metrics
        ? {
            accuracy: metrics.accuracy,
            avgConfidence: metrics.avgConfidence,
            totalPredictions: metrics.totalPredictions,
          }
        : null,
      statistics: {
        activeDeals,
        totalDeals,
        predictions24h: recentPredictions,
      },
      features: {
        count: 45,
        categories: ["price", "temporal", "market", "fx", "derived"],
      },
      detectors: [
        "CrossMarketArbitrage",
        "StatisticalUndervalue",
        "MomentumBreakout",
        "SupplyShock",
      ],
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
    console.error("[api.v1.neural.status] Error:", error);
    return json({ error: "Internal server error" }, { status: 500 });
  }
}
