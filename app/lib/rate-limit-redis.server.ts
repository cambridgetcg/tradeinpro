/**
 * Redis Rate Limiting Store
 *
 * Distributed rate limiting using Upstash Redis.
 * This replaces the in-memory store for production use on Vercel
 * where serverless functions don't share memory.
 *
 * Setup:
 * 1. Create a free Upstash Redis database at https://upstash.com
 * 2. Add UPSTASH_REDIS_URL and UPSTASH_REDIS_TOKEN to .env
 *
 * Usage:
 *   import { getRedisStore, createRedisRateLimiter } from './rate-limit-redis.server';
 *   const limiter = createRedisRateLimiter('api');
 */

import type { RateLimitStore, RateLimitEntry } from "./rate-limit.server";
import {
  RateLimiter,
  RATE_LIMIT_PRESETS,
  type RateLimitConfig,
} from "./rate-limit.server";

// ============================================================================
// Types
// ============================================================================

interface UpstashRedisConfig {
  url: string;
  token: string;
}

interface UpstashResponse<T> {
  result: T;
}

// ============================================================================
// Upstash Redis Client (Lightweight HTTP-based)
// ============================================================================

/**
 * Minimal Upstash Redis client using HTTP API.
 * This avoids the need for @upstash/redis package if not available.
 */
class UpstashRedisClient {
  private baseUrl: string;
  private token: string;

  constructor(config: UpstashRedisConfig) {
    this.baseUrl = config.url;
    this.token = config.token;
  }

  private async command<T>(cmd: string[]): Promise<T> {
    const response = await fetch(`${this.baseUrl}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(cmd),
    });

    if (!response.ok) {
      throw new Error(`Redis error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as UpstashResponse<T>;
    return data.result;
  }

  async get(key: string): Promise<string | null> {
    return this.command<string | null>(["GET", key]);
  }

  async set(key: string, value: string, options?: { ex?: number }): Promise<string> {
    const cmd = ["SET", key, value];
    if (options?.ex) {
      cmd.push("EX", options.ex.toString());
    }
    return this.command<string>(cmd);
  }

  async incr(key: string): Promise<number> {
    return this.command<number>(["INCR", key]);
  }

  async expire(key: string, seconds: number): Promise<number> {
    return this.command<number>(["EXPIRE", key, seconds.toString()]);
  }

  async ttl(key: string): Promise<number> {
    return this.command<number>(["TTL", key]);
  }

  async del(key: string): Promise<number> {
    return this.command<number>(["DEL", key]);
  }

  async eval(script: string, keys: string[], args: string[]): Promise<unknown> {
    return this.command(["EVAL", script, keys.length.toString(), ...keys, ...args]);
  }
}

// ============================================================================
// Redis Rate Limit Store
// ============================================================================

export class RedisRateLimitStore implements RateLimitStore {
  private client: UpstashRedisClient;
  private prefix: string;

  constructor(config: UpstashRedisConfig, prefix: string = "ratelimit") {
    this.client = new UpstashRedisClient(config);
    this.prefix = prefix;
  }

  private getKey(key: string): string {
    return `${this.prefix}:${key}`;
  }

  async get(key: string): Promise<RateLimitEntry | null> {
    try {
      const redisKey = this.getKey(key);
      const data = await this.client.get(redisKey);

      if (!data) return null;

      const entry = JSON.parse(data) as RateLimitEntry;

      // Check if expired
      if (Date.now() > entry.resetTime) {
        await this.delete(key);
        return null;
      }

      return entry;
    } catch (error) {
      console.error("Redis get error:", error);
      return null;
    }
  }

  async set(key: string, entry: RateLimitEntry): Promise<void> {
    try {
      const redisKey = this.getKey(key);
      const ttlSeconds = Math.ceil((entry.resetTime - Date.now()) / 1000);

      if (ttlSeconds > 0) {
        await this.client.set(redisKey, JSON.stringify(entry), { ex: ttlSeconds });
      }
    } catch (error) {
      console.error("Redis set error:", error);
    }
  }

  async increment(key: string, windowMs: number): Promise<RateLimitEntry> {
    try {
      const redisKey = this.getKey(key);
      const now = Date.now();
      const windowSeconds = Math.ceil(windowMs / 1000);

      // Use Lua script for atomic increment with expiry
      const script = `
        local current = redis.call('GET', KEYS[1])
        local count = 1
        local resetTime = tonumber(ARGV[1])

        if current then
          local entry = cjson.decode(current)
          if tonumber(entry.resetTime) > tonumber(ARGV[2]) then
            count = entry.count + 1
            resetTime = entry.resetTime
          end
        end

        local newEntry = cjson.encode({count = count, resetTime = resetTime})
        redis.call('SET', KEYS[1], newEntry, 'EX', ARGV[3])
        return newEntry
      `;

      const resetTime = now + windowMs;
      const result = await this.client.eval(
        script,
        [redisKey],
        [resetTime.toString(), now.toString(), windowSeconds.toString()]
      );

      if (typeof result === "string") {
        return JSON.parse(result) as RateLimitEntry;
      }

      // Fallback if Lua script fails
      return await this.incrementFallback(key, windowMs);
    } catch (error) {
      console.error("Redis increment error:", error);
      // Fallback to simple increment
      return this.incrementFallback(key, windowMs);
    }
  }

  private async incrementFallback(key: string, windowMs: number): Promise<RateLimitEntry> {
    const redisKey = this.getKey(key);
    const now = Date.now();
    const windowSeconds = Math.ceil(windowMs / 1000);

    // Simple increment (not atomic but works as fallback)
    const existing = await this.get(key);

    if (existing && existing.resetTime > now) {
      const updated: RateLimitEntry = {
        count: existing.count + 1,
        resetTime: existing.resetTime,
      };
      await this.client.set(redisKey, JSON.stringify(updated), { ex: windowSeconds });
      return updated;
    }

    const newEntry: RateLimitEntry = {
      count: 1,
      resetTime: now + windowMs,
    };
    await this.client.set(redisKey, JSON.stringify(newEntry), { ex: windowSeconds });
    return newEntry;
  }

  async delete(key: string): Promise<void> {
    try {
      const redisKey = this.getKey(key);
      await this.client.del(redisKey);
    } catch (error) {
      console.error("Redis delete error:", error);
    }
  }
}

// ============================================================================
// Singleton Store
// ============================================================================

let redisStore: RedisRateLimitStore | null = null;

/**
 * Get the shared Redis rate limit store.
 * Returns null if Redis is not configured.
 */
export function getRedisStore(): RedisRateLimitStore | null {
  if (redisStore) return redisStore;

  const url = process.env.UPSTASH_REDIS_URL;
  const token = process.env.UPSTASH_REDIS_TOKEN;

  if (!url || !token) {
    console.warn(
      "Redis rate limiting not configured. Set UPSTASH_REDIS_URL and UPSTASH_REDIS_TOKEN."
    );
    return null;
  }

  redisStore = new RedisRateLimitStore({ url, token });
  return redisStore;
}

/**
 * Check if Redis is configured and available.
 */
export function isRedisConfigured(): boolean {
  return !!(process.env.UPSTASH_REDIS_URL && process.env.UPSTASH_REDIS_TOKEN);
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a rate limiter with Redis store (falls back to memory if Redis not configured).
 */
export function createRedisRateLimiter(
  preset: keyof typeof RATE_LIMIT_PRESETS,
  overrides?: Partial<RateLimitConfig>
): RateLimiter {
  const presetConfig = RATE_LIMIT_PRESETS[preset];
  const store = getRedisStore();

  if (!store) {
    console.warn(`Redis not configured, using memory store for ${preset} rate limiter`);
  }

  // Import memory store as fallback
  const { getSharedStore } = require("./rate-limit.server");

  return new RateLimiter(
    { ...presetConfig, ...overrides },
    store || getSharedStore()
  );
}

// ============================================================================
// Pre-configured Redis Rate Limiters
// ============================================================================

// Lazy initialization to avoid errors if Redis not configured
let _apiLimiter: RateLimiter | null = null;
let _searchLimiter: RateLimiter | null = null;
let _submissionLimiter: RateLimiter | null = null;
let _exportLimiter: RateLimiter | null = null;
let _strictLimiter: RateLimiter | null = null;

export function getApiRateLimiter(): RateLimiter {
  if (!_apiLimiter) {
    _apiLimiter = createRedisRateLimiter("api");
  }
  return _apiLimiter;
}

export function getSearchRateLimiter(): RateLimiter {
  if (!_searchLimiter) {
    _searchLimiter = createRedisRateLimiter("search");
  }
  return _searchLimiter;
}

export function getSubmissionRateLimiter(): RateLimiter {
  if (!_submissionLimiter) {
    _submissionLimiter = createRedisRateLimiter("submission");
  }
  return _submissionLimiter;
}

export function getExportRateLimiter(): RateLimiter {
  if (!_exportLimiter) {
    _exportLimiter = createRedisRateLimiter("export");
  }
  return _exportLimiter;
}

export function getStrictRateLimiter(): RateLimiter {
  if (!_strictLimiter) {
    _strictLimiter = createRedisRateLimiter("strict");
  }
  return _strictLimiter;
}

// ============================================================================
// Middleware Helper with Redis
// ============================================================================

/**
 * Apply rate limiting to a request using Redis store.
 * Falls back gracefully if Redis is unavailable.
 */
export async function withRedisRateLimit<T>(
  request: Request,
  preset: keyof typeof RATE_LIMIT_PRESETS,
  handler: () => Promise<T>
): Promise<T | Response> {
  const limiter = createRedisRateLimiter(preset);

  try {
    const result = await limiter.check(request);

    if (!result.allowed) {
      const { createRateLimitResponse } = require("./rate-limit.server");
      return createRateLimitResponse(result, limiter.getMessage());
    }

    return handler();
  } catch (error) {
    // If rate limiting fails, allow the request through
    // (fail open to avoid blocking legitimate traffic)
    console.error("Rate limiting error, allowing request:", error);
    return handler();
  }
}
