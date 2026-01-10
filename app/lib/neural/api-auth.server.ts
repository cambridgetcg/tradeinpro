/**
 * API Key Authentication and Rate Limiting
 *
 * Provides authentication middleware for the commercial API.
 * Handles API key validation, rate limiting, and permissions.
 */

import crypto from "crypto";
import { PrismaClient } from "@prisma/client";
import { getShardClient } from "../shard.server";
import {
  ApiKeyAuth,
  ApiTier,
  ApiPermissions,
  RateLimitInfo,
  API_TIER_CONFIG,
} from "./types";

// ============================================================================
// CONFIGURATION
// ============================================================================

const PUBLIC_KEY_ID = "public";
const PUBLIC_TIER: ApiTier = "free";

/**
 * Default permissions for public/unauthenticated access.
 */
const PUBLIC_PERMISSIONS: ApiPermissions = {
  endpoints: ["/v1/health", "/v1/indices", "/v1/cards/:id"],
  games: ["onepiece"],
  maxHistoryDays: 0,
  bulkAccess: false,
  webhooks: false,
  streaming: false,
  neuralAccess: false,
};

// ============================================================================
// KEY GENERATION & HASHING
// ============================================================================

/**
 * Generate a new API key with prefix and random bytes.
 * Format: cf_xxxxxxxxxxxxxxxxxxxxxxxxxxxx (32 chars total)
 */
export function generateApiKey(): { key: string; prefix: string; hash: string } {
  const randomBytes = crypto.randomBytes(24).toString("hex");
  const key = `cf_${randomBytes}`;
  const prefix = key.substring(0, 8);
  const hash = hashApiKey(key);

  return { key, prefix, hash };
}

/**
 * Hash an API key using SHA-256.
 */
export function hashApiKey(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex");
}

/**
 * Constant-time comparison for API keys.
 */
function secureCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

// ============================================================================
// AUTHENTICATION
// ============================================================================

/**
 * Authenticate a request using the X-API-Key header.
 * Returns permissions and rate limit info for the key.
 */
export async function authenticateRequest(request: Request): Promise<ApiKeyAuth> {
  const apiKey = request.headers.get("X-API-Key");

  // No key provided - return public tier
  if (!apiKey) {
    return createPublicAuth();
  }

  // Validate key format
  if (!apiKey.startsWith("cf_") || apiKey.length !== 35) {
    throw new ApiAuthError(401, "Invalid API key format");
  }

  // Look up key in database
  const client = getShardClient("onepiece");
  const keyHash = hashApiKey(apiKey);

  const keyRecord = await client.apiKey.findUnique({
    where: { keyHash },
    include: {
      usage: {
        where: {
          requestTimestamp: {
            gte: new Date(Date.now() - 24 * 60 * 60 * 1000),
          },
        },
        orderBy: { requestTimestamp: "desc" },
      },
    },
  });

  // Key not found
  if (!keyRecord) {
    throw new ApiAuthError(401, "Invalid API key");
  }

  // Key inactive
  if (keyRecord.status !== "active") {
    throw new ApiAuthError(401, `API key is ${keyRecord.status}`);
  }

  // Key expired
  if (keyRecord.expiresAt && keyRecord.expiresAt < new Date()) {
    throw new ApiAuthError(401, "API key has expired");
  }

  // Calculate rate limit usage
  const dailyUsage = keyRecord.usage.length;
  const rateLimitInfo = await calculateRateLimits(client, keyRecord, dailyUsage);

  // Check if rate limited
  if (rateLimitInfo.remaining <= 0) {
    throw new ApiAuthError(429, "Daily rate limit exceeded", {
      retryAfter: Math.ceil((rateLimitInfo.resetAt.getTime() - Date.now()) / 1000),
    });
  }

  // Update last used timestamp
  await client.apiKey.update({
    where: { id: keyRecord.id },
    data: { lastUsedAt: new Date() },
  });

  return {
    keyId: keyRecord.id,
    tier: keyRecord.tier as ApiTier,
    rateLimit: rateLimitInfo,
    permissions: {
      endpoints: keyRecord.allowedEndpoints,
      games: keyRecord.allowedGames,
      maxHistoryDays: keyRecord.maxHistoryDays,
      bulkAccess: keyRecord.bulkAccess,
      webhooks: keyRecord.webhookAccess,
      streaming: keyRecord.streamingAccess,
      neuralAccess: keyRecord.neuralAccess,
    },
  };
}

/**
 * Create public (unauthenticated) auth context.
 */
function createPublicAuth(): ApiKeyAuth {
  const tierConfig = API_TIER_CONFIG[PUBLIC_TIER];
  const resetAt = new Date();
  resetAt.setHours(23, 59, 59, 999);

  return {
    keyId: PUBLIC_KEY_ID,
    tier: PUBLIC_TIER,
    rateLimit: {
      daily: tierConfig.dailyLimit,
      minute: tierConfig.minuteLimit,
      remaining: tierConfig.dailyLimit, // Public tier gets full allowance
      resetAt,
    },
    permissions: PUBLIC_PERMISSIONS,
  };
}

/**
 * Calculate rate limit info for a key.
 */
async function calculateRateLimits(
  client: PrismaClient,
  keyRecord: { id: string; tier: string; rateLimitDaily: number },
  currentDailyUsage: number
): Promise<RateLimitInfo> {
  const tierConfig = API_TIER_CONFIG[keyRecord.tier as ApiTier] || API_TIER_CONFIG.free;

  // For unlimited tiers (neural), return high values
  if (tierConfig.dailyLimit === -1) {
    return {
      daily: -1,
      minute: -1,
      remaining: 999999,
      resetAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    };
  }

  // Calculate reset time (midnight UTC)
  const resetAt = new Date();
  resetAt.setUTCHours(24, 0, 0, 0);

  return {
    daily: keyRecord.rateLimitDaily || tierConfig.dailyLimit,
    minute: tierConfig.minuteLimit,
    remaining: Math.max(0, (keyRecord.rateLimitDaily || tierConfig.dailyLimit) - currentDailyUsage),
    resetAt,
  };
}

// ============================================================================
// USAGE TRACKING
// ============================================================================

/**
 * Record API usage for billing and analytics.
 */
export async function recordApiUsage(
  auth: ApiKeyAuth,
  request: Request,
  response: { status: number; durationMs: number }
): Promise<void> {
  // Don't record public tier usage
  if (auth.keyId === PUBLIC_KEY_ID) return;

  const client = getShardClient("onepiece");
  const url = new URL(request.url);

  await client.apiUsage.create({
    data: {
      apiKeyId: auth.keyId,
      endpoint: url.pathname,
      method: request.method,
      statusCode: response.status,
      responseTimeMs: response.durationMs,
      tier: auth.tier,
      billableUnits: calculateBillableUnits(url.pathname, auth.tier),
      ipAddress: getClientIp(request),
      userAgent: request.headers.get("User-Agent"),
    },
  });
}

/**
 * Calculate billable units based on endpoint and tier.
 * Different endpoints have different costs.
 */
function calculateBillableUnits(endpoint: string, tier: ApiTier): number {
  // Neural endpoints cost more
  if (endpoint.includes("/neural/")) {
    return 5;
  }
  // Bulk endpoints cost more
  if (endpoint.includes("/bulk/")) {
    return 10;
  }
  // Standard endpoints
  return 1;
}

/**
 * Get client IP address from request.
 */
function getClientIp(request: Request): string | null {
  // Check for Cloudflare/proxy headers
  const cfIp = request.headers.get("CF-Connecting-IP");
  if (cfIp) return cfIp;

  const xForwardedFor = request.headers.get("X-Forwarded-For");
  if (xForwardedFor) {
    return xForwardedFor.split(",")[0].trim();
  }

  return null;
}

// ============================================================================
// KEY MANAGEMENT
// ============================================================================

/**
 * Create a new API key.
 */
export async function createApiKey(params: {
  name: string;
  email: string;
  tier?: ApiTier;
  userId?: string;
  organization?: string;
  allowedGames?: string[];
}): Promise<{ keyId: string; apiKey: string; prefix: string }> {
  const client = getShardClient("onepiece");
  const { key, prefix, hash } = generateApiKey();
  const tier = params.tier || "free";
  const tierConfig = API_TIER_CONFIG[tier];

  const keyRecord = await client.apiKey.create({
    data: {
      keyHash: hash,
      keyPrefix: prefix,
      name: params.name,
      email: params.email,
      userId: params.userId,
      organization: params.organization,
      tier,
      rateLimitDaily: tierConfig.dailyLimit === -1 ? 999999 : tierConfig.dailyLimit,
      rateLimitMinute: tierConfig.minuteLimit === -1 ? 999999 : tierConfig.minuteLimit,
      maxHistoryDays: tierConfig.maxHistoryDays,
      allowedGames: params.allowedGames || ["onepiece"],
      bulkAccess: tier === "enterprise" || tier === "neural",
      webhookAccess: tier !== "free" && tier !== "developer",
      streamingAccess: tier === "enterprise" || tier === "neural",
      neuralAccess: tier === "neural",
    },
  });

  return {
    keyId: keyRecord.id,
    apiKey: key, // Only returned on creation!
    prefix,
  };
}

/**
 * Revoke an API key.
 */
export async function revokeApiKey(keyId: string): Promise<void> {
  const client = getShardClient("onepiece");

  await client.apiKey.update({
    where: { id: keyId },
    data: { status: "revoked" },
  });
}

/**
 * Update API key tier.
 */
export async function updateApiKeyTier(keyId: string, tier: ApiTier): Promise<void> {
  const client = getShardClient("onepiece");
  const tierConfig = API_TIER_CONFIG[tier];

  await client.apiKey.update({
    where: { id: keyId },
    data: {
      tier,
      rateLimitDaily: tierConfig.dailyLimit === -1 ? 999999 : tierConfig.dailyLimit,
      rateLimitMinute: tierConfig.minuteLimit === -1 ? 999999 : tierConfig.minuteLimit,
      maxHistoryDays: tierConfig.maxHistoryDays,
      bulkAccess: tier === "enterprise" || tier === "neural",
      webhookAccess: tier !== "free" && tier !== "developer",
      streamingAccess: tier === "enterprise" || tier === "neural",
      neuralAccess: tier === "neural",
    },
  });
}

/**
 * Get API key statistics.
 */
export async function getApiKeyStats(keyId: string): Promise<{
  totalRequests: number;
  last24h: number;
  last7d: number;
  avgResponseTime: number;
  errorRate: number;
}> {
  const client = getShardClient("onepiece");
  const now = new Date();

  const [totalCount, last24hCount, last7dCount, responseTimeAvg] = await Promise.all([
    client.apiUsage.count({ where: { apiKeyId: keyId } }),
    client.apiUsage.count({
      where: {
        apiKeyId: keyId,
        requestTimestamp: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
      },
    }),
    client.apiUsage.count({
      where: {
        apiKeyId: keyId,
        requestTimestamp: { gte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) },
      },
    }),
    client.apiUsage.aggregate({
      where: { apiKeyId: keyId },
      _avg: { responseTimeMs: true },
    }),
  ]);

  const errorCount = await client.apiUsage.count({
    where: {
      apiKeyId: keyId,
      statusCode: { gte: 400 },
    },
  });

  return {
    totalRequests: totalCount,
    last24h: last24hCount,
    last7d: last7dCount,
    avgResponseTime: responseTimeAvg._avg.responseTimeMs || 0,
    errorRate: totalCount > 0 ? errorCount / totalCount : 0,
  };
}

// ============================================================================
// PERMISSION CHECKS
// ============================================================================

/**
 * Check if auth has access to an endpoint.
 */
export function hasEndpointAccess(auth: ApiKeyAuth, endpoint: string): boolean {
  // Wildcard access
  if (auth.permissions.endpoints.includes("*")) return true;

  // Check exact match
  if (auth.permissions.endpoints.includes(endpoint)) return true;

  // Check pattern match (simple prefix matching)
  return auth.permissions.endpoints.some((pattern) =>
    endpoint.startsWith(pattern.replace("*", ""))
  );
}

/**
 * Check if auth has access to a game.
 */
export function hasGameAccess(auth: ApiKeyAuth, game: string): boolean {
  return auth.permissions.games.includes(game) || auth.permissions.games.includes("*");
}

/**
 * Check if auth can access history for given days.
 */
export function hasHistoryAccess(auth: ApiKeyAuth, days: number): boolean {
  return auth.permissions.maxHistoryDays >= days || auth.permissions.maxHistoryDays === -1;
}

/**
 * Check if request requires neural access.
 */
export function requiresNeuralAccess(endpoint: string): boolean {
  return endpoint.includes("/neural/");
}

// ============================================================================
// ERROR CLASS
// ============================================================================

export class ApiAuthError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: { retryAfter?: number }
  ) {
    super(message);
    this.name = "ApiAuthError";
  }
}
