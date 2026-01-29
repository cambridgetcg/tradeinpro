/**
 * DynamoDB Caching Layer
 *
 * Provides a high-performance caching layer using DynamoDB for:
 * - Current card prices (sub-10ms lookups)
 * - Card catalog data
 * - Session/rate limit data
 *
 * This complements the Redis cache (cache.server.ts) and is optimized for
 * AWS-native deployments with lower latency for structured data lookups.
 */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  DeleteCommand,
  QueryCommand,
  BatchGetCommand,
  BatchWriteCommand,
} from "@aws-sdk/lib-dynamodb";

// ============================================================================
// Configuration
// ============================================================================

const AWS_REGION = process.env.AWS_REGION || "us-east-1";
const USE_DYNAMODB_CACHE = process.env.USE_DYNAMODB_CACHE === "true";

// Table names
const TABLES = {
  PRICES: "cardforum-current-prices",
  CATALOG: "cardforum-card-catalog",
  SESSIONS: "cardforum-sessions",
} as const;

// Singleton client
let docClient: DynamoDBDocumentClient | null = null;

function getDocClient(): DynamoDBDocumentClient {
  if (!docClient) {
    const client = new DynamoDBClient({ region: AWS_REGION });
    docClient = DynamoDBDocumentClient.from(client, {
      marshallOptions: {
        removeUndefinedValues: true,
        convertClassInstanceToMap: true,
      },
    });
  }
  return docClient;
}

// ============================================================================
// Types
// ============================================================================

export interface DynamoCachedPrice {
  cardId: string;
  game: string;
  name: string;
  priceGbp: number;
  priceUsd: number;
  priceEur: number;
  change24h: number;
  updatedAt: string;
  ttl?: number;
}

export interface DynamoCachedCard {
  cardId: string;
  setCode: string;
  name: string;
  rarity: string;
  variantType: string | null;
  imageUrl: string | null;
  ttl?: number;
}

export interface DynamoCachedSession {
  sessionId: string;
  data: Record<string, unknown>;
  createdAt: string;
  ttl: number;
}

// ============================================================================
// Price Cache
// ============================================================================

/**
 * Get a cached price by card ID from DynamoDB.
 */
export async function getDynamoCachedPrice(cardId: string): Promise<DynamoCachedPrice | null> {
  if (!USE_DYNAMODB_CACHE) return null;

  try {
    const result = await getDocClient().send(
      new GetCommand({
        TableName: TABLES.PRICES,
        Key: { cardId },
      })
    );
    return (result.Item as DynamoCachedPrice) || null;
  } catch (error) {
    console.warn(`[DynamoDB Cache] Failed to get price for ${cardId}:`, error);
    return null;
  }
}

/**
 * Get multiple cached prices by card IDs from DynamoDB.
 */
export async function getDynamoCachedPrices(cardIds: string[]): Promise<Map<string, DynamoCachedPrice>> {
  if (!USE_DYNAMODB_CACHE || cardIds.length === 0) {
    return new Map();
  }

  const results = new Map<string, DynamoCachedPrice>();

  // DynamoDB BatchGet has a limit of 100 items
  const batches = [];
  for (let i = 0; i < cardIds.length; i += 100) {
    batches.push(cardIds.slice(i, i + 100));
  }

  try {
    for (const batch of batches) {
      const response = await getDocClient().send(
        new BatchGetCommand({
          RequestItems: {
            [TABLES.PRICES]: {
              Keys: batch.map((cardId) => ({ cardId })),
            },
          },
        })
      );

      const items = response.Responses?.[TABLES.PRICES] || [];
      for (const item of items) {
        const price = item as DynamoCachedPrice;
        results.set(price.cardId, price);
      }
    }
  } catch (error) {
    console.warn(`[DynamoDB Cache] Failed to batch get prices:`, error);
  }

  return results;
}

/**
 * Cache a price in DynamoDB.
 */
export async function setDynamoCachedPrice(price: DynamoCachedPrice): Promise<void> {
  if (!USE_DYNAMODB_CACHE) return;

  try {
    await getDocClient().send(
      new PutCommand({
        TableName: TABLES.PRICES,
        Item: {
          ...price,
          ttl: Math.floor(Date.now() / 1000) + 3600, // 1 hour TTL
        },
      })
    );
  } catch (error) {
    console.warn(`[DynamoDB Cache] Failed to cache price for ${price.cardId}:`, error);
  }
}

/**
 * Batch cache multiple prices in DynamoDB.
 */
export async function setDynamoCachedPrices(prices: DynamoCachedPrice[]): Promise<void> {
  if (!USE_DYNAMODB_CACHE || prices.length === 0) return;

  const ttl = Math.floor(Date.now() / 1000) + 3600;

  // DynamoDB BatchWrite has a limit of 25 items
  const batches = [];
  for (let i = 0; i < prices.length; i += 25) {
    batches.push(prices.slice(i, i + 25));
  }

  try {
    for (const batch of batches) {
      await getDocClient().send(
        new BatchWriteCommand({
          RequestItems: {
            [TABLES.PRICES]: batch.map((price) => ({
              PutRequest: {
                Item: { ...price, ttl },
              },
            })),
          },
        })
      );
    }
  } catch (error) {
    console.warn(`[DynamoDB Cache] Failed to batch cache prices:`, error);
  }
}

/**
 * Get prices by game from DynamoDB.
 */
export async function getDynamoCachedPricesByGame(game: string, limit = 100): Promise<DynamoCachedPrice[]> {
  if (!USE_DYNAMODB_CACHE) return [];

  try {
    const result = await getDocClient().send(
      new QueryCommand({
        TableName: TABLES.PRICES,
        IndexName: "game-index",
        KeyConditionExpression: "game = :game",
        ExpressionAttributeValues: { ":game": game },
        Limit: limit,
      })
    );
    return (result.Items as DynamoCachedPrice[]) || [];
  } catch (error) {
    console.warn(`[DynamoDB Cache] Failed to query prices by game ${game}:`, error);
    return [];
  }
}

// ============================================================================
// Card Catalog Cache
// ============================================================================

/**
 * Get a cached card by ID from DynamoDB.
 */
export async function getDynamoCachedCard(cardId: string): Promise<DynamoCachedCard | null> {
  if (!USE_DYNAMODB_CACHE) return null;

  try {
    const result = await getDocClient().send(
      new GetCommand({
        TableName: TABLES.CATALOG,
        Key: { cardId },
      })
    );
    return (result.Item as DynamoCachedCard) || null;
  } catch (error) {
    console.warn(`[DynamoDB Cache] Failed to get card ${cardId}:`, error);
    return null;
  }
}

/**
 * Cache a card in DynamoDB.
 */
export async function setDynamoCachedCard(card: DynamoCachedCard): Promise<void> {
  if (!USE_DYNAMODB_CACHE) return;

  try {
    await getDocClient().send(
      new PutCommand({
        TableName: TABLES.CATALOG,
        Item: {
          ...card,
          ttl: Math.floor(Date.now() / 1000) + 86400, // 24 hour TTL
        },
      })
    );
  } catch (error) {
    console.warn(`[DynamoDB Cache] Failed to cache card ${card.cardId}:`, error);
  }
}

/**
 * Get cards by set code from DynamoDB.
 */
export async function getDynamoCachedCardsBySet(setCode: string, limit = 500): Promise<DynamoCachedCard[]> {
  if (!USE_DYNAMODB_CACHE) return [];

  try {
    const result = await getDocClient().send(
      new QueryCommand({
        TableName: TABLES.CATALOG,
        IndexName: "set-index",
        KeyConditionExpression: "setCode = :setCode",
        ExpressionAttributeValues: { ":setCode": setCode },
        Limit: limit,
      })
    );
    return (result.Items as DynamoCachedCard[]) || [];
  } catch (error) {
    console.warn(`[DynamoDB Cache] Failed to query cards by set ${setCode}:`, error);
    return [];
  }
}

// ============================================================================
// Session Cache
// ============================================================================

/**
 * Get a cached session from DynamoDB.
 */
export async function getDynamoCachedSession(sessionId: string): Promise<DynamoCachedSession | null> {
  if (!USE_DYNAMODB_CACHE) return null;

  try {
    const result = await getDocClient().send(
      new GetCommand({
        TableName: TABLES.SESSIONS,
        Key: { sessionId },
      })
    );
    return (result.Item as DynamoCachedSession) || null;
  } catch (error) {
    console.warn(`[DynamoDB Cache] Failed to get session ${sessionId}:`, error);
    return null;
  }
}

/**
 * Set a cached session in DynamoDB.
 */
export async function setDynamoCachedSession(
  sessionId: string,
  data: Record<string, unknown>,
  ttlSeconds = 3600
): Promise<void> {
  if (!USE_DYNAMODB_CACHE) return;

  try {
    await getDocClient().send(
      new PutCommand({
        TableName: TABLES.SESSIONS,
        Item: {
          sessionId,
          data,
          createdAt: new Date().toISOString(),
          ttl: Math.floor(Date.now() / 1000) + ttlSeconds,
        },
      })
    );
  } catch (error) {
    console.warn(`[DynamoDB Cache] Failed to set session ${sessionId}:`, error);
  }
}

/**
 * Delete a cached session from DynamoDB.
 */
export async function deleteDynamoCachedSession(sessionId: string): Promise<void> {
  if (!USE_DYNAMODB_CACHE) return;

  try {
    await getDocClient().send(
      new DeleteCommand({
        TableName: TABLES.SESSIONS,
        Key: { sessionId },
      })
    );
  } catch (error) {
    console.warn(`[DynamoDB Cache] Failed to delete session ${sessionId}:`, error);
  }
}

// ============================================================================
// Rate Limiting via DynamoDB
// ============================================================================

interface RateLimitRecord {
  key: string;
  count: number;
  windowStart: number;
  ttl: number;
}

/**
 * Check rate limit using DynamoDB.
 * Returns true if the request should be allowed.
 */
export async function checkDynamoRateLimit(
  key: string,
  maxRequests: number,
  windowSeconds: number
): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - (now % windowSeconds);
  const resetAt = windowStart + windowSeconds;
  const compositeKey = `ratelimit:${key}:${windowStart}`;

  if (!USE_DYNAMODB_CACHE) {
    return { allowed: true, remaining: maxRequests, resetAt };
  }

  try {
    const result = await getDocClient().send(
      new GetCommand({
        TableName: TABLES.SESSIONS,
        Key: { sessionId: compositeKey },
      })
    );

    const record = result.Item as RateLimitRecord | undefined;
    const currentCount = record?.count || 0;

    if (currentCount >= maxRequests) {
      return {
        allowed: false,
        remaining: 0,
        resetAt,
      };
    }

    // Increment count
    await getDocClient().send(
      new PutCommand({
        TableName: TABLES.SESSIONS,
        Item: {
          sessionId: compositeKey,
          count: currentCount + 1,
          windowStart,
          ttl: resetAt + 60, // Keep for 1 minute after window expires
        },
      })
    );

    return {
      allowed: true,
      remaining: maxRequests - currentCount - 1,
      resetAt,
    };
  } catch (error) {
    console.warn(`[DynamoDB Cache] Rate limit check failed for ${key}:`, error);
    // Allow request on error
    return { allowed: true, remaining: maxRequests, resetAt };
  }
}

// ============================================================================
// Cache Statistics
// ============================================================================

export interface DynamoCacheStats {
  pricesTable: string;
  catalogTable: string;
  sessionsTable: string;
  enabled: boolean;
  region: string;
}

export function getDynamoCacheStats(): DynamoCacheStats {
  return {
    pricesTable: TABLES.PRICES,
    catalogTable: TABLES.CATALOG,
    sessionsTable: TABLES.SESSIONS,
    enabled: USE_DYNAMODB_CACHE,
    region: AWS_REGION,
  };
}

// ============================================================================
// Warm-up Function
// ============================================================================

/**
 * Warm up the DynamoDB cache with price data from the database.
 * Call this during price sync to populate the cache.
 */
export async function warmupPriceCache(
  prices: Array<{
    cardId: string;
    game: string;
    name: string;
    priceGbp: number;
    priceUsd: number;
    priceEur: number;
    change24h: number;
  }>
): Promise<number> {
  if (!USE_DYNAMODB_CACHE) return 0;

  const now = new Date().toISOString();
  const cachedPrices: DynamoCachedPrice[] = prices.map((p) => ({
    ...p,
    updatedAt: now,
  }));

  await setDynamoCachedPrices(cachedPrices);
  return prices.length;
}
