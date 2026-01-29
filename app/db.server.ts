import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var prismaGlobal: PrismaClient | undefined;
}

// ============================================================================
// Connection Pool Configuration
// ============================================================================
// Optimized for serverless (Vercel) with AWS RDS PostgreSQL
//
// Key considerations:
// - Serverless functions have short lifetimes, reuse connections via global
// - RDS db.t3.micro has 79 max connections
// - Leave headroom for direct connections and Lambda functions
// ============================================================================

const CONNECTION_POOL_CONFIG = {
  // Maximum connections in the pool per serverless instance
  // Keep low for serverless to avoid exhausting RDS connections
  connectionLimit: parseInt(process.env.DATABASE_CONNECTION_LIMIT || "5"),

  // Connection timeout in milliseconds
  // Fail fast if pool is exhausted rather than waiting indefinitely
  connectTimeout: parseInt(process.env.DATABASE_CONNECT_TIMEOUT || "10000"),

  // Pool timeout - how long to wait for available connection
  poolTimeout: parseInt(process.env.DATABASE_POOL_TIMEOUT || "10000"),

  // Idle timeout - release connections after inactivity
  idleTimeout: parseInt(process.env.DATABASE_IDLE_TIMEOUT || "60000"),
};

// Build connection URL with pool parameters
function buildDatabaseUrl(): string {
  const baseUrl = process.env.DATABASE_URL;
  if (!baseUrl) {
    throw new Error("DATABASE_URL environment variable is required");
  }

  // Add connection pool parameters to URL if not already present
  const url = new URL(baseUrl);

  // Set connection pool parameters
  if (!url.searchParams.has("connection_limit")) {
    url.searchParams.set("connection_limit", CONNECTION_POOL_CONFIG.connectionLimit.toString());
  }
  if (!url.searchParams.has("connect_timeout")) {
    url.searchParams.set("connect_timeout", Math.floor(CONNECTION_POOL_CONFIG.connectTimeout / 1000).toString());
  }
  if (!url.searchParams.has("pool_timeout")) {
    url.searchParams.set("pool_timeout", Math.floor(CONNECTION_POOL_CONFIG.poolTimeout / 1000).toString());
  }

  return url.toString();
}

console.log("[db.server] Initializing Prisma client:", {
  hasDbUrl: !!process.env.DATABASE_URL,
  dbHost: process.env.DATABASE_URL?.match(/@([^:]+):/)?.[1] || "unknown",
  nodeEnv: process.env.NODE_ENV,
  hasExistingGlobal: !!global.prismaGlobal,
  poolConfig: CONNECTION_POOL_CONFIG,
});

// Create a singleton PrismaClient that works in both dev and serverless production
// In serverless, this prevents creating multiple connections on each request
const prisma = global.prismaGlobal ?? new PrismaClient({
  datasources: {
    db: {
      url: buildDatabaseUrl(),
    },
  },
  log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
});

// Store on global to reuse across hot reloads in dev and warm starts in serverless
global.prismaGlobal = prisma;

// ============================================================================
// Connection Pool Monitoring
// ============================================================================

/**
 * Get database connection pool statistics.
 * Useful for monitoring and debugging connection issues.
 */
export async function getConnectionStats(): Promise<{
  poolConfig: typeof CONNECTION_POOL_CONFIG;
  activeConnections: number;
  maxConnections: number;
  availableConnections: number;
}> {
  try {
    const result = await prisma.$queryRaw<[{ active: bigint; max: bigint }]>`
      SELECT
        (SELECT count(*) FROM pg_stat_activity WHERE state = 'active') as active,
        (SELECT setting::int FROM pg_settings WHERE name = 'max_connections') as max
    `;

    const active = Number(result[0].active);
    const max = Number(result[0].max);

    return {
      poolConfig: CONNECTION_POOL_CONFIG,
      activeConnections: active,
      maxConnections: max,
      availableConnections: max - active,
    };
  } catch (error) {
    console.error("[db.server] Failed to get connection stats:", error);
    return {
      poolConfig: CONNECTION_POOL_CONFIG,
      activeConnections: -1,
      maxConnections: -1,
      availableConnections: -1,
    };
  }
}

/**
 * Gracefully disconnect from the database.
 * Call this in cleanup handlers if needed.
 */
export async function disconnect(): Promise<void> {
  await prisma.$disconnect();
  console.log("[db.server] Disconnected from database");
}

export { prisma };
export default prisma;
