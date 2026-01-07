/**
 * Shard Health & Status API
 *
 * Provides endpoints for monitoring multi-TCG shard health and statistics.
 *
 * GET /api/shards - List all shards and their status
 * GET /api/shards?health=true - Include health checks for each shard
 * GET /api/shards?stats=true - Include statistics for each shard
 */

import type { LoaderFunctionArgs } from "react-router";

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const includeHealth = url.searchParams.get("health") === "true";
  const includeStats = url.searchParams.get("stats") === "true";

  // Dynamic imports to keep this server-only
  const { shardRouter } = await import("../lib/shard.server");
  const { shardQueries } = await import("../lib/shard-queries.server");

  const activeShards = shardRouter.getActiveShards();
  const allShards = shardRouter.getAllShards();

  // Build response for each shard
  const shards = await Promise.all(
    allShards.map(async (game) => {
      const config = shardRouter.config[game];
      const isActive = shardRouter.isActive(game);

      const shardInfo: Record<string, unknown> = {
        game,
        displayName: config.displayName,
        active: isActive,
        envVar: config.envVar,
        configured: !!process.env[config.envVar],
      };

      // Include health check if requested and shard is active
      if (includeHealth && isActive) {
        const health = await shardRouter.checkHealth(game);
        shardInfo.health = {
          connected: health.connected,
          latencyMs: health.latencyMs,
          activeConnections: health.activeConnections,
          maxConnections: health.maxConnections,
          error: health.error,
        };
      }

      // Include statistics if requested and shard is active
      if (includeStats && isActive) {
        try {
          const stats = await shardQueries.getGameStats(game);
          shardInfo.stats = {
            cardCount: stats.cardCount,
            historyRows: stats.historyRows,
            avgPriceGbp: stats.avgPriceGbp,
            totalValueGbp: stats.totalValueGbp,
          };
        } catch (error) {
          shardInfo.stats = {
            error: error instanceof Error ? error.message : "Failed to get stats",
          };
        }
      }

      return shardInfo;
    })
  );

  // Summary statistics
  const summary = {
    totalShards: allShards.length,
    activeShards: activeShards.length,
    inactiveShards: allShards.length - activeShards.length,
    defaultShard: shardRouter.defaultShard,
  };

  return {
    success: true,
    summary,
    shards,
    timestamp: new Date().toISOString(),
  };
}
