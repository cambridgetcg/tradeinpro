/**
 * Rate Limiting Middleware
 *
 * Provides configurable rate limiting for API endpoints
 * to prevent abuse and ensure fair usage.
 */

// ============================================================================
// Types
// ============================================================================

export interface RateLimitConfig {
  /** Maximum number of requests allowed in the window */
  maxRequests: number;
  /** Time window in milliseconds */
  windowMs: number;
  /** Unique identifier for the rate limit bucket */
  keyPrefix?: string;
  /** Custom key generator function */
  keyGenerator?: (request: Request) => string;
  /** Skip rate limiting for certain requests */
  skip?: (request: Request) => boolean;
  /** Custom message for rate limit exceeded */
  message?: string;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetTime: number;
  total: number;
}

export interface RateLimitStore {
  get(key: string): Promise<RateLimitEntry | null>;
  set(key: string, entry: RateLimitEntry): Promise<void>;
  increment(key: string, windowMs: number): Promise<RateLimitEntry>;
  delete(key: string): Promise<void>;
}

export interface RateLimitEntry {
  count: number;
  resetTime: number;
}

// ============================================================================
// In-Memory Store (Development/Single Instance)
// ============================================================================

export class MemoryRateLimitStore implements RateLimitStore {
  private store = new Map<string, RateLimitEntry>();
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor(cleanupIntervalMs: number = 60000) {
    // Periodically clean up expired entries
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, cleanupIntervalMs);
  }

  async get(key: string): Promise<RateLimitEntry | null> {
    const entry = this.store.get(key);
    if (!entry) return null;

    // Check if expired
    if (Date.now() > entry.resetTime) {
      this.store.delete(key);
      return null;
    }

    return entry;
  }

  async set(key: string, entry: RateLimitEntry): Promise<void> {
    this.store.set(key, entry);
  }

  async increment(key: string, windowMs: number): Promise<RateLimitEntry> {
    const now = Date.now();
    const existing = await this.get(key);

    if (existing) {
      existing.count++;
      this.store.set(key, existing);
      return existing;
    }

    const newEntry: RateLimitEntry = {
      count: 1,
      resetTime: now + windowMs,
    };
    this.store.set(key, newEntry);
    return newEntry;
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (now > entry.resetTime) {
        this.store.delete(key);
      }
    }
  }

  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.store.clear();
  }

  // For testing
  getSize(): number {
    return this.store.size;
  }
}

// ============================================================================
// Rate Limiter Class
// ============================================================================

export class RateLimiter {
  private config: Required<RateLimitConfig>;
  private store: RateLimitStore;

  constructor(config: RateLimitConfig, store?: RateLimitStore) {
    this.config = {
      maxRequests: config.maxRequests,
      windowMs: config.windowMs,
      keyPrefix: config.keyPrefix || "rl",
      keyGenerator: config.keyGenerator || defaultKeyGenerator,
      skip: config.skip || (() => false),
      message: config.message || "Too many requests, please try again later.",
    };
    this.store = store || new MemoryRateLimitStore();
  }

  async check(request: Request): Promise<RateLimitResult> {
    // Check if should skip
    if (this.config.skip(request)) {
      return {
        allowed: true,
        remaining: this.config.maxRequests,
        resetTime: Date.now() + this.config.windowMs,
        total: this.config.maxRequests,
      };
    }

    // Generate key
    const baseKey = this.config.keyGenerator(request);
    const key = `${this.config.keyPrefix}:${baseKey}`;

    // Increment counter
    const entry = await this.store.increment(key, this.config.windowMs);

    const allowed = entry.count <= this.config.maxRequests;
    const remaining = Math.max(0, this.config.maxRequests - entry.count);

    return {
      allowed,
      remaining,
      resetTime: entry.resetTime,
      total: this.config.maxRequests,
    };
  }

  async reset(request: Request): Promise<void> {
    const baseKey = this.config.keyGenerator(request);
    const key = `${this.config.keyPrefix}:${baseKey}`;
    await this.store.delete(key);
  }

  getMessage(): string {
    return this.config.message;
  }

  getConfig(): Readonly<Required<RateLimitConfig>> {
    return { ...this.config };
  }
}

// ============================================================================
// Key Generators
// ============================================================================

function defaultKeyGenerator(request: Request): string {
  // Try to get IP from various headers
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }

  const realIp = request.headers.get("x-real-ip");
  if (realIp) {
    return realIp;
  }

  // Fallback to URL as a last resort (not ideal)
  return new URL(request.url).hostname;
}

export function createCustomerKeyGenerator(getCustomerId: () => string | null) {
  return (request: Request): string => {
    const customerId = getCustomerId();
    if (customerId) {
      return `customer:${customerId}`;
    }
    return defaultKeyGenerator(request);
  };
}

export function createShopKeyGenerator(shopDomain: string) {
  return (_request: Request): string => {
    return `shop:${shopDomain}`;
  };
}

export function createEndpointKeyGenerator() {
  return (request: Request): string => {
    const ip = defaultKeyGenerator(request);
    const url = new URL(request.url);
    return `${ip}:${url.pathname}`;
  };
}

// ============================================================================
// Response Helpers
// ============================================================================

export function createRateLimitHeaders(result: RateLimitResult): Headers {
  const headers = new Headers();
  headers.set("X-RateLimit-Limit", result.total.toString());
  headers.set("X-RateLimit-Remaining", result.remaining.toString());
  headers.set("X-RateLimit-Reset", result.resetTime.toString());
  return headers;
}

export function createRateLimitResponse(
  result: RateLimitResult,
  message: string
): Response {
  const headers = createRateLimitHeaders(result);
  headers.set("Retry-After", Math.ceil((result.resetTime - Date.now()) / 1000).toString());

  return new Response(
    JSON.stringify({
      error: "rate_limit_exceeded",
      message,
      retryAfter: Math.ceil((result.resetTime - Date.now()) / 1000),
    }),
    {
      status: 429,
      headers,
    }
  );
}

// ============================================================================
// Preset Configurations
// ============================================================================

export const RATE_LIMIT_PRESETS = {
  /** Standard API rate limit: 100 requests per minute */
  api: {
    maxRequests: 100,
    windowMs: 60 * 1000,
    keyPrefix: "api",
  },

  /** Strict limit for sensitive operations: 10 requests per minute */
  strict: {
    maxRequests: 10,
    windowMs: 60 * 1000,
    keyPrefix: "strict",
  },

  /** Search rate limit: 30 requests per minute */
  search: {
    maxRequests: 30,
    windowMs: 60 * 1000,
    keyPrefix: "search",
  },

  /** Submission rate limit: 5 per hour */
  submission: {
    maxRequests: 5,
    windowMs: 60 * 60 * 1000,
    keyPrefix: "submit",
  },

  /** Login/auth rate limit: 5 attempts per 15 minutes */
  auth: {
    maxRequests: 5,
    windowMs: 15 * 60 * 1000,
    keyPrefix: "auth",
  },

  /** Export rate limit: 3 per hour */
  export: {
    maxRequests: 3,
    windowMs: 60 * 60 * 1000,
    keyPrefix: "export",
  },
} as const;

// ============================================================================
// Factory Functions
// ============================================================================

export function createRateLimiter(
  preset: keyof typeof RATE_LIMIT_PRESETS,
  overrides?: Partial<RateLimitConfig>,
  store?: RateLimitStore
): RateLimiter {
  const presetConfig = RATE_LIMIT_PRESETS[preset];
  return new RateLimiter({ ...presetConfig, ...overrides }, store);
}

// Shared store for all rate limiters (in production, use Redis)
let sharedStore: MemoryRateLimitStore | null = null;

export function getSharedStore(): MemoryRateLimitStore {
  if (!sharedStore) {
    sharedStore = new MemoryRateLimitStore();
  }
  return sharedStore;
}

// ============================================================================
// Middleware Helper
// ============================================================================

export async function withRateLimit<T>(
  request: Request,
  limiter: RateLimiter,
  handler: () => Promise<T>
): Promise<T | Response> {
  const result = await limiter.check(request);

  if (!result.allowed) {
    return createRateLimitResponse(result, limiter.getMessage());
  }

  return handler();
}

// Pre-configured limiters for common use cases
export const apiRateLimiter = createRateLimiter("api", {}, getSharedStore());
export const searchRateLimiter = createRateLimiter("search", {}, getSharedStore());
export const submissionRateLimiter = createRateLimiter("submission", {}, getSharedStore());
export const exportRateLimiter = createRateLimiter("export", {}, getSharedStore());
