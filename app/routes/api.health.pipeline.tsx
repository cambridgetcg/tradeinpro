/**
 * Data Pipeline Health API
 *
 * Returns the health status of the data acquisition pipeline including:
 * - S3 file freshness
 * - Database data freshness
 * - Lambda collector status
 * - External API credential validation (with ?deep=true)
 */

import type { LoaderFunctionArgs } from "react-router";
import { S3Client, HeadObjectCommand } from "@aws-sdk/client-s3";
import { prisma } from "../db.server";

const S3_PRICE_BUCKET = process.env.S3_PRICE_BUCKET || "pricedata-tcg";
const S3_REGION = process.env.S3_REGION || "us-east-1";

// Credential validation cache (1 hour TTL)
interface CredentialCacheEntry {
  result: CheckResult;
  expiresAt: number;
}
const credentialCache = new Map<string, CredentialCacheEntry>();
const CREDENTIAL_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// Thresholds for data freshness (in hours)
const FRESHNESS_THRESHOLDS = {
  S3_DAILY_PRICES: 24, // Should update twice daily
  S3_PRICEFEED: 24, // Should update daily
  DB_PRICE_HISTORY: 48, // Should update daily
  DB_CARD_PRICES: 24, // Should update twice daily
};

interface HealthStatus {
  status: "healthy" | "degraded" | "unhealthy";
  timestamp: string;
  checks: {
    s3DailyPrices: CheckResult;
    s3Pricefeed: CheckResult;
    dbPriceHistory: CheckResult;
    dbCardPrices: CheckResult;
    tcgplayerApi?: CheckResult;
    brightDataApi?: CheckResult;
  };
  summary: {
    healthyCount: number;
    degradedCount: number;
    unhealthyCount: number;
  };
  deepCheck?: boolean;
}

interface CheckResult {
  status: "healthy" | "degraded" | "unhealthy";
  lastUpdated: string | null;
  ageHours: number | null;
  threshold: number;
  message: string;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const deep = url.searchParams.get("deep") === "true";
  const forceRefresh = url.searchParams.get("refresh") === "true";

  // Core checks (always run)
  const coreChecks = await Promise.all([
    checkS3File("daily_prices.xlsx", FRESHNESS_THRESHOLDS.S3_DAILY_PRICES),
    checkS3File("pricefeed/onepiece_pricefeed.xlsx", FRESHNESS_THRESHOLDS.S3_PRICEFEED),
    checkDbPriceHistory(FRESHNESS_THRESHOLDS.DB_PRICE_HISTORY),
    checkDbCardPrices(FRESHNESS_THRESHOLDS.DB_CARD_PRICES),
  ]);

  const [s3DailyPrices, s3Pricefeed, dbPriceHistory, dbCardPrices] = coreChecks;

  // Credential checks (only with ?deep=true)
  let tcgplayerApi: CheckResult | undefined;
  let brightDataApi: CheckResult | undefined;

  if (deep) {
    [tcgplayerApi, brightDataApi] = await Promise.all([
      checkTcgplayerCredentials(forceRefresh),
      checkBrightDataCredentials(forceRefresh),
    ]);
  }

  const allChecks = [
    s3DailyPrices,
    s3Pricefeed,
    dbPriceHistory,
    dbCardPrices,
    ...(tcgplayerApi ? [tcgplayerApi] : []),
    ...(brightDataApi ? [brightDataApi] : []),
  ];

  const healthyCount = allChecks.filter((c) => c.status === "healthy").length;
  const degradedCount = allChecks.filter((c) => c.status === "degraded").length;
  const unhealthyCount = allChecks.filter((c) => c.status === "unhealthy").length;

  let overallStatus: "healthy" | "degraded" | "unhealthy" = "healthy";
  if (unhealthyCount > 0) {
    overallStatus = "unhealthy";
  } else if (degradedCount > 0) {
    overallStatus = "degraded";
  }

  const response: HealthStatus = {
    status: overallStatus,
    timestamp: new Date().toISOString(),
    checks: {
      s3DailyPrices,
      s3Pricefeed,
      dbPriceHistory,
      dbCardPrices,
      ...(tcgplayerApi && { tcgplayerApi }),
      ...(brightDataApi && { brightDataApi }),
    },
    summary: {
      healthyCount,
      degradedCount,
      unhealthyCount,
    },
    ...(deep && { deepCheck: true }),
  };

  return Response.json(response, {
    status: overallStatus === "unhealthy" ? 503 : 200,
    headers: {
      "Cache-Control": "no-cache, no-store, must-revalidate",
    },
  });
}

async function checkS3File(key: string, thresholdHours: number): Promise<CheckResult> {
  try {
    const s3 = new S3Client({ region: S3_REGION });
    const command = new HeadObjectCommand({
      Bucket: S3_PRICE_BUCKET,
      Key: key,
    });

    const response = await s3.send(command);
    const lastModified = response.LastModified;

    if (!lastModified) {
      return {
        status: "unhealthy",
        lastUpdated: null,
        ageHours: null,
        threshold: thresholdHours,
        message: `S3 file ${key} has no LastModified date`,
      };
    }

    const ageMs = Date.now() - lastModified.getTime();
    const ageHours = ageMs / (1000 * 60 * 60);

    let status: "healthy" | "degraded" | "unhealthy" = "healthy";
    let message = `File updated ${ageHours.toFixed(1)} hours ago`;

    if (ageHours > thresholdHours * 2) {
      status = "unhealthy";
      message = `File is critically stale (${ageHours.toFixed(1)}h > ${thresholdHours * 2}h)`;
    } else if (ageHours > thresholdHours) {
      status = "degraded";
      message = `File is stale (${ageHours.toFixed(1)}h > ${thresholdHours}h)`;
    }

    return {
      status,
      lastUpdated: lastModified.toISOString(),
      ageHours: Math.round(ageHours * 10) / 10,
      threshold: thresholdHours,
      message,
    };
  } catch (error) {
    return {
      status: "unhealthy",
      lastUpdated: null,
      ageHours: null,
      threshold: thresholdHours,
      message: `Failed to check S3 file ${key}: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}

async function checkDbPriceHistory(thresholdHours: number): Promise<CheckResult> {
  try {
    const latest = await prisma.cardPriceHistory.findFirst({
      orderBy: { snapshotDate: "desc" },
      select: { snapshotDate: true },
    });

    if (!latest) {
      return {
        status: "unhealthy",
        lastUpdated: null,
        ageHours: null,
        threshold: thresholdHours,
        message: "No price history records found",
      };
    }

    const ageMs = Date.now() - latest.snapshotDate.getTime();
    const ageHours = ageMs / (1000 * 60 * 60);

    let status: "healthy" | "degraded" | "unhealthy" = "healthy";
    let message = `Latest snapshot ${ageHours.toFixed(1)} hours ago`;

    if (ageHours > thresholdHours * 2) {
      status = "unhealthy";
      message = `Price history critically stale (${ageHours.toFixed(1)}h > ${thresholdHours * 2}h)`;
    } else if (ageHours > thresholdHours) {
      status = "degraded";
      message = `Price history stale (${ageHours.toFixed(1)}h > ${thresholdHours}h)`;
    }

    return {
      status,
      lastUpdated: latest.snapshotDate.toISOString(),
      ageHours: Math.round(ageHours * 10) / 10,
      threshold: thresholdHours,
      message,
    };
  } catch (error) {
    return {
      status: "unhealthy",
      lastUpdated: null,
      ageHours: null,
      threshold: thresholdHours,
      message: `Failed to check price history: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}

async function checkDbCardPrices(thresholdHours: number): Promise<CheckResult> {
  try {
    const latest = await prisma.cardPriceV2.findFirst({
      orderBy: { lastUpdated: "desc" },
      select: { lastUpdated: true },
    });

    if (!latest || !latest.lastUpdated) {
      return {
        status: "unhealthy",
        lastUpdated: null,
        ageHours: null,
        threshold: thresholdHours,
        message: "No card prices found or no lastUpdated field",
      };
    }

    const ageMs = Date.now() - latest.lastUpdated.getTime();
    const ageHours = ageMs / (1000 * 60 * 60);

    let status: "healthy" | "degraded" | "unhealthy" = "healthy";
    let message = `Card prices updated ${ageHours.toFixed(1)} hours ago`;

    if (ageHours > thresholdHours * 2) {
      status = "unhealthy";
      message = `Card prices critically stale (${ageHours.toFixed(1)}h > ${thresholdHours * 2}h)`;
    } else if (ageHours > thresholdHours) {
      status = "degraded";
      message = `Card prices stale (${ageHours.toFixed(1)}h > ${thresholdHours}h)`;
    }

    return {
      status,
      lastUpdated: latest.lastUpdated.toISOString(),
      ageHours: Math.round(ageHours * 10) / 10,
      threshold: thresholdHours,
      message,
    };
  } catch (error) {
    return {
      status: "unhealthy",
      lastUpdated: null,
      ageHours: null,
      threshold: thresholdHours,
      message: `Failed to check card prices: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}

// ============================================================================
// Credential Validation Functions
// ============================================================================

async function checkTcgplayerCredentials(forceRefresh: boolean): Promise<CheckResult> {
  const cacheKey = "tcgplayer";

  // Check cache unless forced refresh
  if (!forceRefresh) {
    const cached = credentialCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return { ...cached.result, message: `${cached.result.message} (cached)` };
    }
  }

  try {
    // TCGplayer API key from environment or Secrets Manager
    const apiKey = process.env.TCGPLAYER_API_KEY;

    if (!apiKey) {
      const result: CheckResult = {
        status: "degraded",
        lastUpdated: null,
        ageHours: null,
        threshold: 0,
        message: "TCGplayer API key not configured",
      };
      cacheResult(cacheKey, result);
      return result;
    }

    // TCGplayer uses Bearer token auth - validate with a lightweight endpoint
    // Note: In production, this would call the actual TCGplayer API
    // For now, we just verify the key exists and is formatted correctly
    const isValidFormat = apiKey.length > 20; // Basic format check

    if (!isValidFormat) {
      const result: CheckResult = {
        status: "unhealthy",
        lastUpdated: null,
        ageHours: null,
        threshold: 0,
        message: "TCGplayer API key appears invalid (too short)",
      };
      cacheResult(cacheKey, result);
      return result;
    }

    // If we had full API access, we would call:
    // const response = await fetch('https://api.tcgplayer.com/catalog/categories', {
    //   headers: { 'Authorization': `Bearer ${apiKey}` }
    // });

    const result: CheckResult = {
      status: "healthy",
      lastUpdated: new Date().toISOString(),
      ageHours: 0,
      threshold: 0,
      message: "TCGplayer API key configured",
    };
    cacheResult(cacheKey, result);
    return result;
  } catch (error) {
    const result: CheckResult = {
      status: "unhealthy",
      lastUpdated: null,
      ageHours: null,
      threshold: 0,
      message: `TCGplayer check failed: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
    cacheResult(cacheKey, result);
    return result;
  }
}

async function checkBrightDataCredentials(forceRefresh: boolean): Promise<CheckResult> {
  const cacheKey = "brightdata";

  // Check cache unless forced refresh
  if (!forceRefresh) {
    const cached = credentialCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return { ...cached.result, message: `${cached.result.message} (cached)` };
    }
  }

  try {
    // Bright Data credentials from environment or Secrets Manager
    const apiKey = process.env.BRIGHT_DATA_API_KEY;

    if (!apiKey) {
      const result: CheckResult = {
        status: "degraded",
        lastUpdated: null,
        ageHours: null,
        threshold: 0,
        message: "Bright Data API key not configured",
      };
      cacheResult(cacheKey, result);
      return result;
    }

    // Basic format validation
    const isValidFormat = apiKey.length > 10;

    if (!isValidFormat) {
      const result: CheckResult = {
        status: "unhealthy",
        lastUpdated: null,
        ageHours: null,
        threshold: 0,
        message: "Bright Data API key appears invalid (too short)",
      };
      cacheResult(cacheKey, result);
      return result;
    }

    // If we had full API access, we would call:
    // const response = await fetch('https://api.brightdata.com/zone/status', {
    //   headers: { 'Authorization': `Bearer ${apiKey}` }
    // });

    const result: CheckResult = {
      status: "healthy",
      lastUpdated: new Date().toISOString(),
      ageHours: 0,
      threshold: 0,
      message: "Bright Data API key configured",
    };
    cacheResult(cacheKey, result);
    return result;
  } catch (error) {
    const result: CheckResult = {
      status: "unhealthy",
      lastUpdated: null,
      ageHours: null,
      threshold: 0,
      message: `Bright Data check failed: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
    cacheResult(cacheKey, result);
    return result;
  }
}

function cacheResult(key: string, result: CheckResult): void {
  credentialCache.set(key, {
    result,
    expiresAt: Date.now() + CREDENTIAL_CACHE_TTL_MS,
  });
}
