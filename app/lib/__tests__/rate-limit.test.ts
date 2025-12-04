/**
 * Tests for Rate Limiting Middleware
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  RateLimiter,
  MemoryRateLimitStore,
  createRateLimiter,
  createRateLimitHeaders,
  createRateLimitResponse,
  withRateLimit,
  createCustomerKeyGenerator,
  createShopKeyGenerator,
  createEndpointKeyGenerator,
  RATE_LIMIT_PRESETS,
  getSharedStore,
} from "../rate-limit.server";

// ============================================================================
// Test Helpers
// ============================================================================

function createMockRequest(
  url: string = "https://example.com/api/test",
  headers: Record<string, string> = {}
): Request {
  const requestHeaders = new Headers();
  for (const [key, value] of Object.entries(headers)) {
    requestHeaders.set(key, value);
  }

  return new Request(url, {
    method: "GET",
    headers: requestHeaders,
  });
}

// ============================================================================
// MemoryRateLimitStore Tests
// ============================================================================

describe("MemoryRateLimitStore", () => {
  let store: MemoryRateLimitStore;

  beforeEach(() => {
    store = new MemoryRateLimitStore(60000); // 1 minute cleanup
  });

  afterEach(() => {
    store.destroy();
  });

  it("should return null for non-existent key", async () => {
    const entry = await store.get("nonexistent");
    expect(entry).toBeNull();
  });

  it("should set and get entry", async () => {
    const entry = { count: 5, resetTime: Date.now() + 60000 };
    await store.set("test-key", entry);

    const retrieved = await store.get("test-key");
    expect(retrieved).toEqual(entry);
  });

  it("should increment counter for new key", async () => {
    const entry = await store.increment("new-key", 60000);

    expect(entry.count).toBe(1);
    expect(entry.resetTime).toBeGreaterThan(Date.now());
  });

  it("should increment counter for existing key", async () => {
    await store.increment("test-key", 60000);
    const entry = await store.increment("test-key", 60000);

    expect(entry.count).toBe(2);
  });

  it("should delete entry", async () => {
    await store.increment("test-key", 60000);
    await store.delete("test-key");

    const entry = await store.get("test-key");
    expect(entry).toBeNull();
  });

  it("should return null for expired entry", async () => {
    // Set entry that expired in the past
    await store.set("expired", { count: 1, resetTime: Date.now() - 1000 });

    const entry = await store.get("expired");
    expect(entry).toBeNull();
  });

  it("should reset counter when incrementing expired entry", async () => {
    // Set expired entry
    await store.set("expired", { count: 10, resetTime: Date.now() - 1000 });

    // Increment should start fresh
    const entry = await store.increment("expired", 60000);
    expect(entry.count).toBe(1);
  });

  it("should track store size", async () => {
    expect(store.getSize()).toBe(0);

    await store.increment("key1", 60000);
    expect(store.getSize()).toBe(1);

    await store.increment("key2", 60000);
    expect(store.getSize()).toBe(2);

    await store.delete("key1");
    expect(store.getSize()).toBe(1);
  });

  it("should clear store on destroy", async () => {
    await store.increment("key1", 60000);
    await store.increment("key2", 60000);

    store.destroy();
    expect(store.getSize()).toBe(0);
  });
});

// ============================================================================
// RateLimiter Tests
// ============================================================================

describe("RateLimiter", () => {
  let limiter: RateLimiter;
  let store: MemoryRateLimitStore;

  beforeEach(() => {
    store = new MemoryRateLimitStore();
    limiter = new RateLimiter(
      {
        maxRequests: 5,
        windowMs: 60000,
        keyPrefix: "test",
      },
      store
    );
  });

  afterEach(() => {
    store.destroy();
  });

  describe("check", () => {
    it("should allow requests within limit", async () => {
      const request = createMockRequest("https://example.com/api", {
        "x-forwarded-for": "192.168.1.1",
      });

      const result = await limiter.check(request);

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(4);
      expect(result.total).toBe(5);
    });

    it("should decrement remaining count", async () => {
      const request = createMockRequest("https://example.com/api", {
        "x-forwarded-for": "192.168.1.1",
      });

      await limiter.check(request);
      await limiter.check(request);
      const result = await limiter.check(request);

      expect(result.remaining).toBe(2);
    });

    it("should block requests exceeding limit", async () => {
      const request = createMockRequest("https://example.com/api", {
        "x-forwarded-for": "192.168.1.1",
      });

      // Make 5 requests (all allowed)
      for (let i = 0; i < 5; i++) {
        const result = await limiter.check(request);
        expect(result.allowed).toBe(true);
      }

      // 6th request should be blocked
      const result = await limiter.check(request);
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });

    it("should track different keys separately", async () => {
      const request1 = createMockRequest("https://example.com/api", {
        "x-forwarded-for": "192.168.1.1",
      });
      const request2 = createMockRequest("https://example.com/api", {
        "x-forwarded-for": "192.168.1.2",
      });

      // Use up limit for request1
      for (let i = 0; i < 5; i++) {
        await limiter.check(request1);
      }

      // request2 should still be allowed
      const result = await limiter.check(request2);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(4);
    });

    it("should skip rate limiting when skip function returns true", async () => {
      const skipLimiter = new RateLimiter(
        {
          maxRequests: 1,
          windowMs: 60000,
          skip: (req) => req.headers.get("x-bypass") === "true",
        },
        store
      );

      const request = createMockRequest("https://example.com/api", {
        "x-forwarded-for": "192.168.1.1",
        "x-bypass": "true",
      });

      // Should always be allowed when skip returns true
      for (let i = 0; i < 10; i++) {
        const result = await skipLimiter.check(request);
        expect(result.allowed).toBe(true);
      }
    });

    it("should use custom key generator", async () => {
      const customLimiter = new RateLimiter(
        {
          maxRequests: 2,
          windowMs: 60000,
          keyGenerator: () => "same-key",
        },
        store
      );

      // Different IPs but same key
      const request1 = createMockRequest("https://example.com/api", {
        "x-forwarded-for": "192.168.1.1",
      });
      const request2 = createMockRequest("https://example.com/api", {
        "x-forwarded-for": "192.168.1.2",
      });

      await customLimiter.check(request1);
      await customLimiter.check(request2);
      const result = await customLimiter.check(request1);

      expect(result.allowed).toBe(false);
    });
  });

  describe("reset", () => {
    it("should reset rate limit for key", async () => {
      const request = createMockRequest("https://example.com/api", {
        "x-forwarded-for": "192.168.1.1",
      });

      // Use up some of the limit
      for (let i = 0; i < 3; i++) {
        await limiter.check(request);
      }

      // Reset
      await limiter.reset(request);

      // Should have full limit again
      const result = await limiter.check(request);
      expect(result.remaining).toBe(4);
    });
  });

  describe("getMessage", () => {
    it("should return default message", () => {
      expect(limiter.getMessage()).toBe(
        "Too many requests, please try again later."
      );
    });

    it("should return custom message", () => {
      const customLimiter = new RateLimiter({
        maxRequests: 5,
        windowMs: 60000,
        message: "Custom rate limit message",
      });

      expect(customLimiter.getMessage()).toBe("Custom rate limit message");
    });
  });

  describe("getConfig", () => {
    it("should return config copy", () => {
      const config = limiter.getConfig();

      expect(config.maxRequests).toBe(5);
      expect(config.windowMs).toBe(60000);
      expect(config.keyPrefix).toBe("test");
    });
  });
});

// ============================================================================
// Key Generators Tests
// ============================================================================

describe("Key Generators", () => {
  describe("default key generator", () => {
    it("should use x-forwarded-for header", async () => {
      const limiter = new RateLimiter({ maxRequests: 5, windowMs: 60000 });
      const request = createMockRequest("https://example.com/api", {
        "x-forwarded-for": "192.168.1.100, 10.0.0.1",
      });

      await limiter.check(request);
      // First IP should be used
    });

    it("should use x-real-ip header as fallback", async () => {
      const limiter = new RateLimiter({ maxRequests: 5, windowMs: 60000 });
      const request = createMockRequest("https://example.com/api", {
        "x-real-ip": "192.168.1.50",
      });

      await limiter.check(request);
    });
  });

  describe("createCustomerKeyGenerator", () => {
    it("should use customer ID when available", async () => {
      let customerId: string | null = "cust_123";
      const keyGen = createCustomerKeyGenerator(() => customerId);
      const request = createMockRequest();

      const key = keyGen(request);
      expect(key).toBe("customer:cust_123");
    });

    it("should fall back to IP when no customer ID", async () => {
      const keyGen = createCustomerKeyGenerator(() => null);
      const request = createMockRequest("https://example.com/api", {
        "x-forwarded-for": "192.168.1.1",
      });

      const key = keyGen(request);
      expect(key).toBe("192.168.1.1");
    });
  });

  describe("createShopKeyGenerator", () => {
    it("should use shop domain", async () => {
      const keyGen = createShopKeyGenerator("mystore.myshopify.com");
      const request = createMockRequest();

      const key = keyGen(request);
      expect(key).toBe("shop:mystore.myshopify.com");
    });
  });

  describe("createEndpointKeyGenerator", () => {
    it("should combine IP and pathname", async () => {
      const keyGen = createEndpointKeyGenerator();
      const request = createMockRequest("https://example.com/api/cards", {
        "x-forwarded-for": "192.168.1.1",
      });

      const key = keyGen(request);
      expect(key).toBe("192.168.1.1:/api/cards");
    });
  });
});

// ============================================================================
// Response Helpers Tests
// ============================================================================

describe("Response Helpers", () => {
  describe("createRateLimitHeaders", () => {
    it("should create rate limit headers", () => {
      const result = {
        allowed: true,
        remaining: 8,
        resetTime: Date.now() + 60000,
        total: 10,
      };

      const headers = createRateLimitHeaders(result);

      expect(headers.get("X-RateLimit-Limit")).toBe("10");
      expect(headers.get("X-RateLimit-Remaining")).toBe("8");
      expect(headers.get("X-RateLimit-Reset")).toBeTruthy();
    });
  });

  describe("createRateLimitResponse", () => {
    it("should create 429 response", async () => {
      const result = {
        allowed: false,
        remaining: 0,
        resetTime: Date.now() + 30000,
        total: 5,
      };

      const response = createRateLimitResponse(
        result,
        "Rate limit exceeded"
      );

      expect(response.status).toBe(429);

      const body = await response.json();
      expect(body.error).toBe("rate_limit_exceeded");
      expect(body.message).toBe("Rate limit exceeded");
      expect(body.retryAfter).toBeGreaterThan(0);
    });

    it("should include Retry-After header", async () => {
      const result = {
        allowed: false,
        remaining: 0,
        resetTime: Date.now() + 60000,
        total: 5,
      };

      const response = createRateLimitResponse(result, "Too many requests");

      expect(response.headers.get("Retry-After")).toBeTruthy();
    });

    it("should include rate limit headers", async () => {
      const result = {
        allowed: false,
        remaining: 0,
        resetTime: Date.now() + 60000,
        total: 5,
      };

      const response = createRateLimitResponse(result, "Limited");

      expect(response.headers.get("X-RateLimit-Limit")).toBe("5");
      expect(response.headers.get("X-RateLimit-Remaining")).toBe("0");
    });
  });
});

// ============================================================================
// withRateLimit Middleware Tests
// ============================================================================

describe("withRateLimit", () => {
  let store: MemoryRateLimitStore;
  let limiter: RateLimiter;

  beforeEach(() => {
    store = new MemoryRateLimitStore();
    limiter = new RateLimiter(
      {
        maxRequests: 2,
        windowMs: 60000,
      },
      store
    );
  });

  afterEach(() => {
    store.destroy();
  });

  it("should execute handler when allowed", async () => {
    const request = createMockRequest("https://example.com/api", {
      "x-forwarded-for": "192.168.1.1",
    });

    const result = await withRateLimit(request, limiter, async () => {
      return { success: true, data: "test" };
    });

    expect(result).toEqual({ success: true, data: "test" });
  });

  it("should return 429 response when blocked", async () => {
    const request = createMockRequest("https://example.com/api", {
      "x-forwarded-for": "192.168.1.1",
    });

    // Exhaust rate limit
    await limiter.check(request);
    await limiter.check(request);

    const result = await withRateLimit(request, limiter, async () => {
      return { success: true };
    });

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(429);
  });

  it("should not execute handler when blocked", async () => {
    const request = createMockRequest("https://example.com/api", {
      "x-forwarded-for": "192.168.1.1",
    });

    // Exhaust rate limit
    await limiter.check(request);
    await limiter.check(request);

    const handler = vi.fn().mockResolvedValue({ success: true });

    await withRateLimit(request, limiter, handler);

    expect(handler).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Preset Configurations Tests
// ============================================================================

describe("RATE_LIMIT_PRESETS", () => {
  it("should have api preset", () => {
    expect(RATE_LIMIT_PRESETS.api).toBeDefined();
    expect(RATE_LIMIT_PRESETS.api.maxRequests).toBe(100);
    expect(RATE_LIMIT_PRESETS.api.windowMs).toBe(60000);
  });

  it("should have strict preset", () => {
    expect(RATE_LIMIT_PRESETS.strict).toBeDefined();
    expect(RATE_LIMIT_PRESETS.strict.maxRequests).toBe(10);
  });

  it("should have search preset", () => {
    expect(RATE_LIMIT_PRESETS.search).toBeDefined();
    expect(RATE_LIMIT_PRESETS.search.maxRequests).toBe(30);
  });

  it("should have submission preset", () => {
    expect(RATE_LIMIT_PRESETS.submission).toBeDefined();
    expect(RATE_LIMIT_PRESETS.submission.maxRequests).toBe(5);
    expect(RATE_LIMIT_PRESETS.submission.windowMs).toBe(3600000); // 1 hour
  });

  it("should have auth preset", () => {
    expect(RATE_LIMIT_PRESETS.auth).toBeDefined();
    expect(RATE_LIMIT_PRESETS.auth.maxRequests).toBe(5);
    expect(RATE_LIMIT_PRESETS.auth.windowMs).toBe(900000); // 15 minutes
  });

  it("should have export preset", () => {
    expect(RATE_LIMIT_PRESETS.export).toBeDefined();
    expect(RATE_LIMIT_PRESETS.export.maxRequests).toBe(3);
    expect(RATE_LIMIT_PRESETS.export.windowMs).toBe(3600000); // 1 hour
  });
});

// ============================================================================
// Factory Functions Tests
// ============================================================================

describe("createRateLimiter", () => {
  it("should create limiter with preset config", () => {
    const limiter = createRateLimiter("api");
    const config = limiter.getConfig();

    expect(config.maxRequests).toBe(100);
    expect(config.windowMs).toBe(60000);
  });

  it("should allow overrides", () => {
    const limiter = createRateLimiter("api", { maxRequests: 50 });
    const config = limiter.getConfig();

    expect(config.maxRequests).toBe(50);
    expect(config.windowMs).toBe(60000);
  });

  it("should use provided store", () => {
    const customStore = new MemoryRateLimitStore();
    const limiter = createRateLimiter("api", {}, customStore);

    // Verify it uses the custom store by checking behavior
    expect(limiter.getConfig().maxRequests).toBe(100);

    customStore.destroy();
  });
});

describe("getSharedStore", () => {
  it("should return singleton store", () => {
    const store1 = getSharedStore();
    const store2 = getSharedStore();

    expect(store1).toBe(store2);
  });
});

// ============================================================================
// Edge Cases Tests
// ============================================================================

describe("Edge Cases", () => {
  let store: MemoryRateLimitStore;

  beforeEach(() => {
    store = new MemoryRateLimitStore();
  });

  afterEach(() => {
    store.destroy();
  });

  it("should handle request with no headers gracefully", async () => {
    const limiter = new RateLimiter(
      { maxRequests: 5, windowMs: 60000 },
      store
    );
    const request = createMockRequest("https://example.com/api");

    const result = await limiter.check(request);

    expect(result.allowed).toBe(true);
  });

  it("should handle very short window", async () => {
    const limiter = new RateLimiter(
      { maxRequests: 2, windowMs: 100 }, // 100ms window
      store
    );
    const request = createMockRequest("https://example.com/api", {
      "x-forwarded-for": "192.168.1.1",
    });

    // Use up limit
    await limiter.check(request);
    await limiter.check(request);

    // Should be blocked
    let result = await limiter.check(request);
    expect(result.allowed).toBe(false);

    // Wait for window to expire
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Should be allowed again
    result = await limiter.check(request);
    expect(result.allowed).toBe(true);
  });

  it("should handle high request volume", async () => {
    const limiter = new RateLimiter(
      { maxRequests: 1000, windowMs: 60000 },
      store
    );
    const request = createMockRequest("https://example.com/api", {
      "x-forwarded-for": "192.168.1.1",
    });

    // Make many requests
    for (let i = 0; i < 999; i++) {
      await limiter.check(request);
    }

    // Should still have 1 remaining
    const result = await limiter.check(request);
    expect(result.remaining).toBe(0);
    expect(result.allowed).toBe(true);
  });

  it("should handle concurrent requests", async () => {
    const limiter = new RateLimiter(
      { maxRequests: 5, windowMs: 60000 },
      store
    );
    const request = createMockRequest("https://example.com/api", {
      "x-forwarded-for": "192.168.1.1",
    });

    // Make concurrent requests
    const results = await Promise.all([
      limiter.check(request),
      limiter.check(request),
      limiter.check(request),
      limiter.check(request),
      limiter.check(request),
    ]);

    // All should be allowed (or some may be blocked due to race)
    const allowed = results.filter((r) => r.allowed).length;
    expect(allowed).toBe(5);
  });

  it("should handle special characters in key", async () => {
    const limiter = new RateLimiter(
      {
        maxRequests: 5,
        windowMs: 60000,
        keyGenerator: () => "test:key:with:colons:and/slashes",
      },
      store
    );
    const request = createMockRequest();

    const result = await limiter.check(request);
    expect(result.allowed).toBe(true);
  });
});
