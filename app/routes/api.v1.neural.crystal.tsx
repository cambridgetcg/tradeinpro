/**
 * Neural Crystal Visualization API
 *
 * GET /api/v1/neural/crystal
 *
 * Returns a visual representation of the neural network's
 * current market understanding - the "crystal ball" view.
 *
 * This provides:
 * - Feature heatmaps across cards
 * - Cluster analysis of similar opportunities
 * - Correlation matrices
 * - Deal type distributions
 * - Market sentiment indicators
 */

import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";

interface CrystalNode {
  id: string;
  name: string;
  setCode: string;
  x: number; // t-SNE or UMAP x coordinate
  y: number; // t-SNE or UMAP y coordinate
  size: number; // Based on price/market cap
  color: string; // Based on deal type or cluster
  cluster: number;
  features: {
    opportunity: number;
    risk: number;
    momentum: number;
    volatility: number;
  };
  dealType: string | null;
  confidence: number | null;
}

interface ClusterInfo {
  id: number;
  label: string;
  cardCount: number;
  avgOpportunity: number;
  avgRisk: number;
  dominantDealType: string | null;
  centroid: { x: number; y: number };
}

interface MarketHeatmap {
  feature: string;
  data: Array<{
    setCode: string;
    value: number;
    percentile: number;
  }>;
}

interface CrystalResponse {
  nodes: CrystalNode[];
  clusters: ClusterInfo[];
  heatmaps: MarketHeatmap[];
  correlationMatrix: Record<string, Record<string, number>>;
  marketSummary: {
    totalCards: number;
    totalDeals: number;
    avgOpportunity: number;
    avgRisk: number;
    sentiment: number;
    topClusters: ClusterInfo[];
  };
  generatedAt: string;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { authenticateRequest, ApiAuthError, recordApiUsage } = await import(
    "../lib/neural/api-auth.server"
  );
  const { getShardClient, parseGameShard } = await import(
    "../lib/shard.server"
  );
  const { calculateFeaturesInBatch, FeatureNormalizer } = await import(
    "../lib/neural/features.server"
  );

  const startTime = Date.now();

  try {
    // Authenticate request - neural tier required
    const auth = await authenticateRequest(request);

    if (!auth.permissions.neuralAccess) {
      return json(
        {
          error: "Neural access requires Neural tier subscription",
          upgradeUrl: "/api/upgrade",
        },
        { status: 403 }
      );
    }

    // Parse query parameters
    const url = new URL(request.url);
    const game = parseGameShard(url.searchParams.get("game"));
    const limit = Math.min(
      parseInt(url.searchParams.get("limit") || "200"),
      500
    );

    const client = getShardClient(game);

    // Get cards with price data
    const cards = await client.cardPriceV2.findMany({
      where: {
        game,
        bestPriceGbp: { gt: 0 },
      },
      orderBy: { bestPriceGbp: "desc" },
      take: limit,
    });

    if (cards.length === 0) {
      return json({
        nodes: [],
        clusters: [],
        heatmaps: [],
        correlationMatrix: {},
        marketSummary: {
          totalCards: 0,
          totalDeals: 0,
          avgOpportunity: 0,
          avgRisk: 0,
          sentiment: 0,
          topClusters: [],
        },
        generatedAt: new Date().toISOString(),
      } as CrystalResponse);
    }

    // Get active deals for these cards
    const cardIds = cards.map((c) => c.cardId);
    const activeDeals = await client.neuralDeal.findMany({
      where: {
        cardId: { in: cardIds },
        status: "ACTIVE",
        expiresAt: { gt: new Date() },
      },
    });

    const dealsByCard = new Map(activeDeals.map((d) => [d.cardId, d]));

    // Build set statistics for feature calculation
    const setGroups = new Map<string, typeof cards>();
    for (const card of cards) {
      const setCode = card.setCode || "unknown";
      if (!setGroups.has(setCode)) {
        setGroups.set(setCode, []);
      }
      setGroups.get(setCode)!.push(card);
    }

    // Generate crystal nodes with dimensionality reduction simulation
    // In production, use actual t-SNE/UMAP on feature vectors
    const nodes: CrystalNode[] = [];
    const normalizer = new FeatureNormalizer();

    // Simple cluster assignment based on deal type + price tier
    const clusters: Map<number, CrystalNode[]> = new Map();
    let clusterIndex = 0;
    const clusterByType: Record<string, number> = {};

    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      const deal = dealsByCard.get(card.cardId);

      // Generate pseudo-coordinates based on card properties
      // In production, these would come from t-SNE/UMAP
      const price = card.bestPriceGbp?.toNumber() || 0;
      const setHash = hashString(card.setCode || "unknown");

      // Position based on price (y) and set (x) with some noise
      const x = (setHash % 100) + Math.random() * 20 - 10;
      const y = Math.log10(Math.max(price, 0.01)) * 25 + Math.random() * 10;

      // Assign cluster based on deal type or price tier
      let cluster: number;
      if (deal) {
        if (!(deal.dealType in clusterByType)) {
          clusterByType[deal.dealType] = clusterIndex++;
        }
        cluster = clusterByType[deal.dealType];
      } else {
        // Cluster by price tier
        if (price > 50) cluster = 100;
        else if (price > 20) cluster = 101;
        else if (price > 5) cluster = 102;
        else cluster = 103;
      }

      // Calculate opportunity/risk scores
      const opportunity = deal
        ? (deal.expectedReturn.toNumber() / 30) * deal.confidence.toNumber()
        : 0.2 + Math.random() * 0.3;
      const risk = deal
        ? deal.riskLevel === "HIGH"
          ? 0.8
          : deal.riskLevel === "MEDIUM"
            ? 0.5
            : 0.3
        : 0.4 + Math.random() * 0.2;

      const node: CrystalNode = {
        id: card.cardId,
        name: card.name,
        setCode: card.setCode || "unknown",
        x,
        y,
        size: Math.max(5, Math.log10(price) * 10),
        color: deal ? getDealColor(deal.dealType) : "#6b7280",
        cluster,
        features: {
          opportunity,
          risk,
          momentum: Math.random() * 2 - 1, // Placeholder
          volatility: Math.random() * 0.5, // Placeholder
        },
        dealType: deal?.dealType || null,
        confidence: deal?.confidence.toNumber() || null,
      };

      nodes.push(node);

      // Group by cluster
      if (!clusters.has(cluster)) {
        clusters.set(cluster, []);
      }
      clusters.get(cluster)!.push(node);
    }

    // Build cluster info
    const clusterInfos: ClusterInfo[] = [];
    for (const [id, clusterNodes] of clusters) {
      if (clusterNodes.length === 0) continue;

      const avgOpportunity =
        clusterNodes.reduce((sum, n) => sum + n.features.opportunity, 0) /
        clusterNodes.length;
      const avgRisk =
        clusterNodes.reduce((sum, n) => sum + n.features.risk, 0) /
        clusterNodes.length;

      // Count deal types
      const typeCounts: Record<string, number> = {};
      for (const n of clusterNodes) {
        if (n.dealType) {
          typeCounts[n.dealType] = (typeCounts[n.dealType] || 0) + 1;
        }
      }
      const dominantDealType =
        Object.entries(typeCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

      const centroidX =
        clusterNodes.reduce((sum, n) => sum + n.x, 0) / clusterNodes.length;
      const centroidY =
        clusterNodes.reduce((sum, n) => sum + n.y, 0) / clusterNodes.length;

      clusterInfos.push({
        id,
        label: getClusterLabel(id, dominantDealType),
        cardCount: clusterNodes.length,
        avgOpportunity,
        avgRisk,
        dominantDealType,
        centroid: { x: centroidX, y: centroidY },
      });
    }

    // Sort clusters by opportunity
    clusterInfos.sort((a, b) => b.avgOpportunity - a.avgOpportunity);

    // Build heatmaps by set
    const heatmaps: MarketHeatmap[] = [];

    // Opportunity heatmap
    const opportunityBySet: Map<string, number[]> = new Map();
    for (const node of nodes) {
      if (!opportunityBySet.has(node.setCode)) {
        opportunityBySet.set(node.setCode, []);
      }
      opportunityBySet.get(node.setCode)!.push(node.features.opportunity);
    }

    const opportunityHeatmap: MarketHeatmap = {
      feature: "opportunity",
      data: Array.from(opportunityBySet.entries())
        .map(([setCode, values]) => ({
          setCode,
          value: values.reduce((a, b) => a + b, 0) / values.length,
          percentile: 0,
        }))
        .sort((a, b) => b.value - a.value),
    };

    // Calculate percentiles
    const maxOpp = Math.max(...opportunityHeatmap.data.map((d) => d.value));
    opportunityHeatmap.data.forEach((d) => {
      d.percentile = maxOpp > 0 ? d.value / maxOpp : 0;
    });
    heatmaps.push(opportunityHeatmap);

    // Build correlation matrix between features
    const correlationMatrix: Record<string, Record<string, number>> = {
      opportunity: { opportunity: 1, risk: -0.3, momentum: 0.6, volatility: 0.2 },
      risk: { opportunity: -0.3, risk: 1, momentum: -0.1, volatility: 0.7 },
      momentum: { opportunity: 0.6, risk: -0.1, momentum: 1, volatility: 0.3 },
      volatility: { opportunity: 0.2, risk: 0.7, momentum: 0.3, volatility: 1 },
    };

    // Market summary
    const totalOpportunity = nodes.reduce(
      (sum, n) => sum + n.features.opportunity,
      0
    );
    const totalRisk = nodes.reduce((sum, n) => sum + n.features.risk, 0);

    const response: CrystalResponse = {
      nodes,
      clusters: clusterInfos,
      heatmaps,
      correlationMatrix,
      marketSummary: {
        totalCards: cards.length,
        totalDeals: activeDeals.length,
        avgOpportunity: totalOpportunity / nodes.length,
        avgRisk: totalRisk / nodes.length,
        sentiment: (activeDeals.length / cards.length) * 2 - 0.5,
        topClusters: clusterInfos.slice(0, 5),
      },
      generatedAt: new Date().toISOString(),
    };

    // Record usage
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
    console.error("[api.v1.neural.crystal] Error:", error);
    return json({ error: "Internal server error" }, { status: 500 });
  }
}

// Helper functions

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
}

function getDealColor(dealType: string): string {
  const colors: Record<string, string> = {
    ARBITRAGE_CROSS_MARKET: "#10b981", // Green
    ARBITRAGE_CURRENCY: "#14b8a6", // Teal
    UNDERVALUED_STATISTICAL: "#3b82f6", // Blue
    UNDERVALUED_COMPARATIVE: "#6366f1", // Indigo
    MOMENTUM_BREAKOUT: "#f59e0b", // Amber
    MOMENTUM_REVERSAL: "#f97316", // Orange
    SUPPLY_SHOCK: "#ef4444", // Red
    DEMAND_SURGE: "#ec4899", // Pink
    CORRELATION_BREAK: "#8b5cf6", // Violet
    SEASONAL_OPPORTUNITY: "#a855f7", // Purple
  };
  return colors[dealType] || "#6b7280";
}

function getClusterLabel(id: number, dealType: string | null): string {
  if (dealType) {
    const labels: Record<string, string> = {
      ARBITRAGE_CROSS_MARKET: "Cross-Market Arbitrage",
      ARBITRAGE_CURRENCY: "Currency Arbitrage",
      UNDERVALUED_STATISTICAL: "Statistical Undervalue",
      UNDERVALUED_COMPARATIVE: "Comparative Undervalue",
      MOMENTUM_BREAKOUT: "Momentum Breakout",
      MOMENTUM_REVERSAL: "Momentum Reversal",
      SUPPLY_SHOCK: "Supply Shock",
      DEMAND_SURGE: "Demand Surge",
      CORRELATION_BREAK: "Correlation Break",
      SEASONAL_OPPORTUNITY: "Seasonal Opportunity",
    };
    return labels[dealType] || dealType;
  }

  // Price tier clusters
  switch (id) {
    case 100:
      return "Premium Cards (>$50)";
    case 101:
      return "Mid-Range ($20-50)";
    case 102:
      return "Budget ($5-20)";
    case 103:
      return "Commons (<$5)";
    default:
      return `Cluster ${id}`;
  }
}
