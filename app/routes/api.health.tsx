/**
 * Health Check Endpoint
 *
 * Provides system health status for monitoring and load balancers.
 * Checks database connectivity, Redis availability, and external service reachability.
 *
 * GET /api/health - Basic health check (fast, for load balancers)
 * GET /api/health?detailed=true - Detailed health with all component checks
 */

import type { LoaderFunctionArgs } from "react-router";

interface HealthCheck {
  status: "ok" | "error" | "degraded";
  latencyMs?: number;
  message?: string;
}

interface ShardHealthCheck {
  game: string;
  displayName: string;
  connected: boolean;
  latencyMs: number;
}

interface HealthResponse {
  status: "healthy" | "degraded" | "unhealthy";
  timestamp: string;
  version: string;
  uptime: number;
  checks?: {
    database: HealthCheck;
    redis: HealthCheck;
    priceApi: HealthCheck;
    shards?: {
      status: "ok" | "degraded" | "error";
      activeCount: number;
      totalCount: number;
      shards: ShardHealthCheck[];
    };
  };
}

const startTime = Date.now();

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const detailed = url.searchParams.get("detailed") === "true";

  // Basic health check (fast path for load balancers)
  if (!detailed) {
    return new Response(
      JSON.stringify({
        status: "healthy",
        timestamp: new Date().toISOString(),
        version: process.env.npm_package_version || "1.0.0",
        uptime: Math.floor((Date.now() - startTime) / 1000),
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-cache, no-store, must-revalidate",
        },
      }
    );
  }

  // Detailed health check with all components
  const checks = await runHealthChecks();

  const allOk = Object.values(checks).every((c) => c.status === "ok");
  const anyError = Object.values(checks).some((c) => c.status === "error");

  const overallStatus: HealthResponse["status"] = allOk
    ? "healthy"
    : anyError
      ? "unhealthy"
      : "degraded";

  const response: HealthResponse = {
    status: overallStatus,
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || "1.0.0",
    uptime: Math.floor((Date.now() - startTime) / 1000),
    checks,
  };

  return new Response(JSON.stringify(response), {
    status: overallStatus === "healthy" ? 200 : overallStatus === "degraded" ? 200 : 503,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-cache, no-store, must-revalidate",
    },
  });
}

async function runHealthChecks(): Promise<{
  database: HealthCheck;
  redis: HealthCheck;
  priceApi: HealthCheck;
  shards: {
    status: "ok" | "degraded" | "error";
    activeCount: number;
    totalCount: number;
    shards: ShardHealthCheck[];
  };
}> {
  const [database, redis, priceApi, shards] = await Promise.all([
    checkDatabase(),
    checkRedis(),
    checkPriceApi(),
    checkShards(),
  ]);

  return { database, redis, priceApi, shards };
}

async function checkShards(): Promise<{
  status: "ok" | "degraded" | "error";
  activeCount: number;
  totalCount: number;
  shards: ShardHealthCheck[];
}> {
  try {
    const { shardRouter } = await import("../lib/shard.server");

    const activeShards = shardRouter.getActiveShards();
    const allShards = shardRouter.getAllShards();
    const healthResults = await shardRouter.checkAllHealth();

    const shardHealthList: ShardHealthCheck[] = healthResults.map((h) => ({
      game: h.game,
      displayName: h.displayName,
      connected: h.connected,
      latencyMs: h.latencyMs,
    }));

    const allConnected = healthResults.every((h) => h.connected);
    const anyDisconnected = healthResults.some((h) => !h.connected);

    return {
      status: allConnected ? "ok" : anyDisconnected ? "degraded" : "error",
      activeCount: activeShards.length,
      totalCount: allShards.length,
      shards: shardHealthList,
    };
  } catch (error) {
    return {
      status: "error",
      activeCount: 0,
      totalCount: 0,
      shards: [],
    };
  }
}

async function checkDatabase(): Promise<HealthCheck> {
  const start = Date.now();

  try {
    // Dynamic import to avoid server-only issues
    const { default: prisma } = await import("../db.server");

    // Simple query to test connectivity
    await prisma.$queryRaw`SELECT 1`;

    return {
      status: "ok",
      latencyMs: Date.now() - start,
    };
  } catch (error) {
    return {
      status: "error",
      latencyMs: Date.now() - start,
      message: error instanceof Error ? error.message : "Database connection failed",
    };
  }
}

async function checkRedis(): Promise<HealthCheck> {
  const start = Date.now();

  try {
    const { isRedisConfigured, getRedisStore } = await import(
      "../lib/rate-limit-redis.server"
    );

    if (!isRedisConfigured()) {
      return {
        status: "degraded",
        latencyMs: Date.now() - start,
        message: "Redis not configured (using in-memory fallback)",
      };
    }

    const store = getRedisStore();
    if (!store) {
      return {
        status: "degraded",
        latencyMs: Date.now() - start,
        message: "Redis store not initialized",
      };
    }

    // Test Redis with a simple get operation
    await store.get("health-check-test");

    return {
      status: "ok",
      latencyMs: Date.now() - start,
    };
  } catch (error) {
    return {
      status: "error",
      latencyMs: Date.now() - start,
      message: error instanceof Error ? error.message : "Redis connection failed",
    };
  }
}

async function checkPriceApi(): Promise<HealthCheck> {
  const start = Date.now();

  try {
    // Check if we can reach the price API (just a basic connectivity test)
    const priceApiUrl = process.env.PRICE_API_URL;

    if (!priceApiUrl) {
      // If no external price API configured, check internal price data
      const { default: prisma } = await import("../db.server");

      const recentPrice = await prisma.cardPriceV2.findFirst({
        where: {
          optcgUpdatedAt: {
            gte: new Date(Date.now() - 24 * 60 * 60 * 1000), // Last 24 hours
          },
        },
        select: { cardId: true, optcgUpdatedAt: true },
      });

      if (!recentPrice) {
        return {
          status: "degraded",
          latencyMs: Date.now() - start,
          message: "No recent price data (>24h old)",
        };
      }

      return {
        status: "ok",
        latencyMs: Date.now() - start,
        message: "Price data is fresh",
      };
    }

    // External price API health check
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
      const response = await fetch(`${priceApiUrl}/health`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!response.ok) {
        return {
          status: "degraded",
          latencyMs: Date.now() - start,
          message: `Price API returned ${response.status}`,
        };
      }

      return {
        status: "ok",
        latencyMs: Date.now() - start,
      };
    } catch (fetchError) {
      clearTimeout(timeout);
      throw fetchError;
    }
  } catch (error) {
    return {
      status: "error",
      latencyMs: Date.now() - start,
      message: error instanceof Error ? error.message : "Price API check failed",
    };
  }
}
