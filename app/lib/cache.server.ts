/**
 * Redis Caching Layer
 *
 * Provides caching for frequently accessed data using Upstash Redis.
 * Falls back gracefully when Redis is unavailable.
 *
 * Features:
 * - Type-safe cache operations
 * - Automatic JSON serialization
 * - TTL management
 * - Cache invalidation patterns
 * - Fallback to in-memory for development
 */

// ============================================================================
// Types
// ============================================================================

export interface CacheConfig {
  url: string;
  token: string;
}

export interface CacheEntry<T> {
  data: T;
  cachedAt: number;
  expiresAt: number;
}

interface UpstashResponse<T> {
  result: T;
}

// ============================================================================
// Cache TTL Presets (in seconds)
// ============================================================================

export const CACHE_TTL = {
  /** Card prices - 5 minutes (prices update twice daily, but allow fast invalidation) */
  CARD_PRICES: 300,

  /** Card sets list - 1 hour (rarely changes) */
  CARD_SETS: 3600,

  /** Public settings - 5 minutes */
  SETTINGS: 300,

  /** Search results - 2 minutes */
  SEARCH_RESULTS: 120,

  /** Submission counts/stats - 1 minute */
  STATS: 60,

  /** Single card details - 10 minutes */
  CARD_DETAIL: 600,
} as const;

// ============================================================================
// Cache Key Prefixes
// ============================================================================

export const CACHE_PREFIX = {
  CARD_PRICE: "price:",
  CARD_SET: "set:",
  SEARCH: "search:",
  SETTINGS: "settings:",
  STATS: "stats:",
} as const;

// ============================================================================
// Upstash Redis Client
// ============================================================================

class UpstashCacheClient {
  private baseUrl: string;
  private token: string;

  constructor(config: CacheConfig) {
    this.baseUrl = config.url;
    this.token = config.token;
  }

  private async command<T>(cmd: string[]): Promise<T> {
    const response = await fetch(this.baseUrl, {
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

  async set(key: string, value: string, ttlSeconds?: number): Promise<string> {
    const cmd = ["SET", key, value];
    if (ttlSeconds) {
      cmd.push("EX", ttlSeconds.toString());
    }
    return this.command<string>(cmd);
  }

  async del(key: string): Promise<number> {
    return this.command<number>(["DEL", key]);
  }

  async keys(pattern: string): Promise<string[]> {
    return this.command<string[]>(["KEYS", pattern]);
  }

  async mget(keys: string[]): Promise<(string | null)[]> {
    return this.command<(string | null)[]>(["MGET", ...keys]);
  }

  async pipeline(commands: string[][]): Promise<unknown[]> {
    const response = await fetch(`${this.baseUrl}/pipeline`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(commands),
    });

    if (!response.ok) {
      throw new Error(`Redis pipeline error: ${response.status}`);
    }

    const data = (await response.json()) as { result: unknown }[];
    return data.map((r) => r.result);
  }
}

// ============================================================================
// In-Memory Fallback Cache
// ============================================================================

class MemoryCache {
  private cache = new Map<string, { value: string; expiresAt: number }>();
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // Cleanup expired entries every minute
    this.cleanupInterval = setInterval(() => this.cleanup(), 60000);
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (entry.expiresAt < now) {
        this.cache.delete(key);
      }
    }
  }

  async get(key: string): Promise<string | null> {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (entry.expiresAt < Date.now()) {
      this.cache.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<string> {
    const expiresAt = ttlSeconds
      ? Date.now() + ttlSeconds * 1000
      : Date.now() + 3600 * 1000; // Default 1 hour

    this.cache.set(key, { value, expiresAt });
    return "OK";
  }

  async del(key: string): Promise<number> {
    return this.cache.delete(key) ? 1 : 0;
  }

  async keys(pattern: string): Promise<string[]> {
    const regex = new RegExp(
      "^" + pattern.replace(/\*/g, ".*").replace(/\?/g, ".") + "$"
    );
    const result: string[] = [];
    for (const key of this.cache.keys()) {
      if (regex.test(key)) {
        result.push(key);
      }
    }
    return result;
  }

  async mget(keys: string[]): Promise<(string | null)[]> {
    return Promise.all(keys.map((k) => this.get(k)));
  }

  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.cache.clear();
  }
}

// ============================================================================
// Cache Service
// ============================================================================

type CacheClient = UpstashCacheClient | MemoryCache;

class CacheService {
  private client: CacheClient;
  private isRedis: boolean;

  constructor() {
    const url = process.env.UPSTASH_REDIS_URL;
    const token = process.env.UPSTASH_REDIS_TOKEN;

    if (url && token) {
      this.client = new UpstashCacheClient({ url, token });
      this.isRedis = true;
      console.log("Cache: Using Upstash Redis");
    } else {
      this.client = new MemoryCache();
      this.isRedis = false;
      console.log("Cache: Using in-memory fallback");
    }
  }

  /**
   * Get a cached value, parsing JSON automatically.
   */
  async get<T>(key: string): Promise<T | null> {
    try {
      const raw = await this.client.get(key);
      if (!raw) return null;
      return JSON.parse(raw) as T;
    } catch (error) {
      console.error("Cache get error:", error);
      return null;
    }
  }

  /**
   * Set a value with automatic JSON serialization.
   */
  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<boolean> {
    try {
      const raw = JSON.stringify(value);
      await this.client.set(key, raw, ttlSeconds);
      return true;
    } catch (error) {
      console.error("Cache set error:", error);
      return false;
    }
  }

  /**
   * Delete a cached value.
   */
  async del(key: string): Promise<boolean> {
    try {
      await this.client.del(key);
      return true;
    } catch (error) {
      console.error("Cache del error:", error);
      return false;
    }
  }

  /**
   * Delete all keys matching a pattern.
   */
  async invalidatePattern(pattern: string): Promise<number> {
    try {
      const keys = await this.client.keys(pattern);
      if (keys.length === 0) return 0;

      let deleted = 0;
      for (const key of keys) {
        await this.client.del(key);
        deleted++;
      }
      return deleted;
    } catch (error) {
      console.error("Cache invalidate error:", error);
      return 0;
    }
  }

  /**
   * Get multiple values at once.
   */
  async mget<T>(keys: string[]): Promise<(T | null)[]> {
    try {
      const results = await this.client.mget(keys);
      return results.map((r) => (r ? (JSON.parse(r) as T) : null));
    } catch (error) {
      console.error("Cache mget error:", error);
      return keys.map(() => null);
    }
  }

  /**
   * Get or set pattern - fetch from cache or compute and cache.
   */
  async getOrSet<T>(
    key: string,
    fetcher: () => Promise<T>,
    ttlSeconds?: number
  ): Promise<T> {
    // Try cache first
    const cached = await this.get<T>(key);
    if (cached !== null) {
      return cached;
    }

    // Fetch fresh data
    const fresh = await fetcher();

    // Cache it (don't await, fire and forget)
    this.set(key, fresh, ttlSeconds).catch(() => {});

    return fresh;
  }

  /**
   * Check if using Redis (true) or memory fallback (false).
   */
  isUsingRedis(): boolean {
    return this.isRedis;
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let cacheInstance: CacheService | null = null;

export function getCache(): CacheService {
  if (!cacheInstance) {
    cacheInstance = new CacheService();
  }
  return cacheInstance;
}

// ============================================================================
// Helper Functions for Common Cache Operations
// ============================================================================

/**
 * Cache card prices for a set.
 */
export async function getCachedCardPrices<T>(
  setCode: string,
  fetcher: () => Promise<T>
): Promise<T> {
  const cache = getCache();
  const key = `${CACHE_PREFIX.CARD_SET}${setCode}:prices`;
  return cache.getOrSet(key, fetcher, CACHE_TTL.CARD_PRICES);
}

/**
 * Cache search results.
 */
export async function getCachedSearchResults<T>(
  query: string,
  filters: Record<string, string>,
  fetcher: () => Promise<T>
): Promise<T> {
  const cache = getCache();
  const filterKey = Object.entries(filters)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const key = `${CACHE_PREFIX.SEARCH}${query}:${filterKey}`;
  return cache.getOrSet(key, fetcher, CACHE_TTL.SEARCH_RESULTS);
}

/**
 * Cache public settings.
 */
export async function getCachedSettings<T>(fetcher: () => Promise<T>): Promise<T> {
  const cache = getCache();
  const key = `${CACHE_PREFIX.SETTINGS}public`;
  return cache.getOrSet(key, fetcher, CACHE_TTL.SETTINGS);
}

/**
 * Cache single card details.
 */
export async function getCachedCardDetail<T>(
  cardId: string,
  fetcher: () => Promise<T>
): Promise<T> {
  const cache = getCache();
  const key = `${CACHE_PREFIX.CARD_PRICE}${cardId}`;
  return cache.getOrSet(key, fetcher, CACHE_TTL.CARD_DETAIL);
}

/**
 * Invalidate all price caches (call after price sync).
 */
export async function invalidatePriceCaches(): Promise<void> {
  const cache = getCache();
  await Promise.all([
    cache.invalidatePattern(`${CACHE_PREFIX.CARD_PRICE}*`),
    cache.invalidatePattern(`${CACHE_PREFIX.CARD_SET}*`),
    cache.invalidatePattern(`${CACHE_PREFIX.SEARCH}*`),
  ]);
  console.log("Cache: Invalidated all price caches");
}

/**
 * Invalidate settings cache.
 */
export async function invalidateSettingsCache(): Promise<void> {
  const cache = getCache();
  await cache.invalidatePattern(`${CACHE_PREFIX.SETTINGS}*`);
  console.log("Cache: Invalidated settings cache");
}
