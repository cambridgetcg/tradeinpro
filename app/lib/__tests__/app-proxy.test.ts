/**
 * Tests for App Proxy authentication and validation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import crypto from "crypto";
import {
  validateAppProxy,
  requireAppProxy,
  isValidEmail,
  sanitizeString,
  parsePositiveInt,
  errorResponse,
  jsonResponse,
} from "../app-proxy.server";

// Mock prisma
vi.mock("../../db.server", () => ({
  default: {
    customer: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
  },
}));

// ============================================================================
// Test Helpers
// ============================================================================

const TEST_SECRET = "test_secret_key_12345";

/**
 * Generate valid App Proxy signature for testing
 */
function generateSignature(params: Record<string, string>, secret = TEST_SECRET): string {
  const sortedParams = Object.entries(params)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("");

  return crypto.createHmac("sha256", secret).update(sortedParams).digest("hex");
}

/**
 * Create a mock Request with App Proxy parameters
 */
function createAppProxyRequest(
  params: Record<string, string>,
  options: { includeSignature?: boolean; secret?: string } = {}
): Request {
  const { includeSignature = true, secret = TEST_SECRET } = options;

  const queryParams = { ...params };

  if (includeSignature) {
    const signature = generateSignature(params, secret);
    queryParams.signature = signature;
  }

  const url = new URL("https://example.com/api/test");
  Object.entries(queryParams).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });

  return new Request(url.toString());
}

/**
 * Get current timestamp
 */
function getCurrentTimestamp(): string {
  return Math.floor(Date.now() / 1000).toString();
}

// ============================================================================
// validateAppProxy Tests
// ============================================================================

describe("validateAppProxy", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv, SHOPIFY_API_SECRET: TEST_SECRET };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("valid requests", () => {
    it("should accept valid signature with all parameters", () => {
      const params = {
        shop: "test-store.myshopify.com",
        timestamp: getCurrentTimestamp(),
        logged_in_customer_id: "12345",
        locale: "en",
        path_prefix: "/apps/trade-in",
      };

      const request = createAppProxyRequest(params);
      const result = validateAppProxy(request);

      expect(result.isValid).toBe(true);
      expect(result.shop).toBe("test-store.myshopify.com");
      expect(result.customerId).toBe("12345");
      expect(result.locale).toBe("en");
      expect(result.path_prefix).toBe("/apps/trade-in");
    });

    it("should accept valid signature without customer (guest)", () => {
      const params = {
        shop: "test-store.myshopify.com",
        timestamp: getCurrentTimestamp(),
        locale: "en",
      };

      const request = createAppProxyRequest(params);
      const result = validateAppProxy(request);

      expect(result.isValid).toBe(true);
      expect(result.customerId).toBeNull();
    });

    it("should accept timestamp within 5 minute window", () => {
      // 4 minutes ago
      const timestamp = (Math.floor(Date.now() / 1000) - 240).toString();
      const params = {
        shop: "test-store.myshopify.com",
        timestamp,
        locale: "en",
      };

      const request = createAppProxyRequest(params);
      const result = validateAppProxy(request);

      expect(result.isValid).toBe(true);
    });

    it("should accept timestamp in near future (clock skew)", () => {
      // 1 minute in the future
      const timestamp = (Math.floor(Date.now() / 1000) + 60).toString();
      const params = {
        shop: "test-store.myshopify.com",
        timestamp,
        locale: "en",
      };

      const request = createAppProxyRequest(params);
      const result = validateAppProxy(request);

      expect(result.isValid).toBe(true);
    });
  });

  describe("invalid requests", () => {
    it("should reject missing signature", () => {
      const params = {
        shop: "test-store.myshopify.com",
        timestamp: getCurrentTimestamp(),
      };

      const request = createAppProxyRequest(params, { includeSignature: false });
      const result = validateAppProxy(request);

      expect(result.isValid).toBe(false);
    });

    it("should reject missing timestamp", () => {
      const params = {
        shop: "test-store.myshopify.com",
      };

      const request = createAppProxyRequest(params);
      const result = validateAppProxy(request);

      expect(result.isValid).toBe(false);
    });

    it("should reject missing shop", () => {
      const params = {
        timestamp: getCurrentTimestamp(),
      };

      const request = createAppProxyRequest(params);
      const result = validateAppProxy(request);

      expect(result.isValid).toBe(false);
    });

    it("should reject expired timestamp (> 5 minutes old)", () => {
      // 10 minutes ago
      const timestamp = (Math.floor(Date.now() / 1000) - 600).toString();
      const params = {
        shop: "test-store.myshopify.com",
        timestamp,
        locale: "en",
      };

      const request = createAppProxyRequest(params);
      const result = validateAppProxy(request);

      expect(result.isValid).toBe(false);
    });

    it("should reject future timestamp (> 5 minutes ahead)", () => {
      // 10 minutes in future
      const timestamp = (Math.floor(Date.now() / 1000) + 600).toString();
      const params = {
        shop: "test-store.myshopify.com",
        timestamp,
        locale: "en",
      };

      const request = createAppProxyRequest(params);
      const result = validateAppProxy(request);

      expect(result.isValid).toBe(false);
    });

    it("should reject invalid timestamp format", () => {
      const params = {
        shop: "test-store.myshopify.com",
        timestamp: "not-a-number",
        locale: "en",
      };

      const request = createAppProxyRequest(params);
      const result = validateAppProxy(request);

      expect(result.isValid).toBe(false);
    });

    it("should reject tampered parameters", () => {
      const params = {
        shop: "test-store.myshopify.com",
        timestamp: getCurrentTimestamp(),
        locale: "en",
      };

      // Generate signature with original params
      const signature = generateSignature(params);

      // Tamper with shop parameter
      const url = new URL("https://example.com/api/test");
      url.searchParams.set("shop", "hacked-store.myshopify.com"); // Different!
      url.searchParams.set("timestamp", params.timestamp);
      url.searchParams.set("locale", params.locale);
      url.searchParams.set("signature", signature);

      const request = new Request(url.toString());
      const result = validateAppProxy(request);

      expect(result.isValid).toBe(false);
    });

    it("should reject wrong secret", () => {
      const params = {
        shop: "test-store.myshopify.com",
        timestamp: getCurrentTimestamp(),
        locale: "en",
      };

      const request = createAppProxyRequest(params, { secret: "wrong_secret" });
      const result = validateAppProxy(request);

      expect(result.isValid).toBe(false);
    });

    it("should reject when SHOPIFY_API_SECRET not configured", () => {
      delete process.env.SHOPIFY_API_SECRET;

      const params = {
        shop: "test-store.myshopify.com",
        timestamp: getCurrentTimestamp(),
        locale: "en",
      };

      const request = createAppProxyRequest(params);
      const result = validateAppProxy(request);

      expect(result.isValid).toBe(false);
    });

    it("should reject malformed signature (not hex)", () => {
      const params = {
        shop: "test-store.myshopify.com",
        timestamp: getCurrentTimestamp(),
        locale: "en",
      };

      const url = new URL("https://example.com/api/test");
      Object.entries(params).forEach(([key, value]) => {
        url.searchParams.set(key, value);
      });
      url.searchParams.set("signature", "not-valid-hex-string!");

      const request = new Request(url.toString());
      const result = validateAppProxy(request);

      expect(result.isValid).toBe(false);
    });
  });

  describe("context extraction", () => {
    it("should extract all context values from valid request", () => {
      const params = {
        shop: "my-store.myshopify.com",
        timestamp: getCurrentTimestamp(),
        logged_in_customer_id: "67890",
        locale: "fr",
        path_prefix: "/apps/trade",
      };

      const request = createAppProxyRequest(params);
      const result = validateAppProxy(request);

      expect(result.isValid).toBe(true);
      expect(result.shop).toBe("my-store.myshopify.com");
      expect(result.customerId).toBe("67890");
      expect(result.locale).toBe("fr");
      expect(result.path_prefix).toBe("/apps/trade");
      expect(result.timestamp).toBe(params.timestamp);
    });

    it("should use default locale when not provided", () => {
      const params = {
        shop: "test-store.myshopify.com",
        timestamp: getCurrentTimestamp(),
      };

      const request = createAppProxyRequest(params);
      const result = validateAppProxy(request);

      expect(result.locale).toBe("en");
    });

    it("should return empty path_prefix when not provided", () => {
      const params = {
        shop: "test-store.myshopify.com",
        timestamp: getCurrentTimestamp(),
      };

      const request = createAppProxyRequest(params);
      const result = validateAppProxy(request);

      expect(result.path_prefix).toBe("");
    });
  });
});

// ============================================================================
// requireAppProxy Tests
// ============================================================================

describe("requireAppProxy", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv, SHOPIFY_API_SECRET: TEST_SECRET };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("should return context for valid request", () => {
    const params = {
      shop: "test-store.myshopify.com",
      timestamp: getCurrentTimestamp(),
      locale: "en",
    };

    const request = createAppProxyRequest(params);
    const result = requireAppProxy(request);

    expect(result.isValid).toBe(true);
    expect(result.shop).toBe("test-store.myshopify.com");
  });

  it("should throw 401 Response for invalid signature", () => {
    const params = {
      shop: "test-store.myshopify.com",
      timestamp: getCurrentTimestamp(),
    };

    const request = createAppProxyRequest(params, { includeSignature: false });

    expect(() => requireAppProxy(request)).toThrow();

    try {
      requireAppProxy(request);
    } catch (error) {
      expect(error).toBeInstanceOf(Response);
      const response = error as Response;
      expect(response.status).toBe(401);
    }
  });

  it("should include error details in 401 response body", async () => {
    const params = {
      shop: "test-store.myshopify.com",
      timestamp: getCurrentTimestamp(),
    };

    const request = createAppProxyRequest(params, { includeSignature: false });

    try {
      requireAppProxy(request);
    } catch (error) {
      const response = error as Response;
      const body = await response.json();
      expect(body.error).toBe("unauthorized");
      expect(body.message).toBeDefined();
    }
  });
});

// ============================================================================
// Input Validation Helper Tests
// ============================================================================

describe("isValidEmail", () => {
  it("should accept valid email addresses", () => {
    expect(isValidEmail("test@example.com")).toBe(true);
    expect(isValidEmail("user.name@domain.co.uk")).toBe(true);
    expect(isValidEmail("user+tag@example.com")).toBe(true);
    expect(isValidEmail("123@domain.com")).toBe(true);
  });

  it("should reject invalid email addresses", () => {
    expect(isValidEmail("")).toBe(false);
    expect(isValidEmail("notanemail")).toBe(false);
    expect(isValidEmail("@nodomain.com")).toBe(false);
    expect(isValidEmail("noat.com")).toBe(false);
    expect(isValidEmail("spaces in@email.com")).toBe(false);
    expect(isValidEmail("missing@domain")).toBe(false);
  });

  it("should reject non-string inputs", () => {
    expect(isValidEmail(null as any)).toBe(false);
    expect(isValidEmail(undefined as any)).toBe(false);
    expect(isValidEmail(123 as any)).toBe(false);
    expect(isValidEmail({} as any)).toBe(false);
  });

  it("should trim whitespace before validation", () => {
    expect(isValidEmail("  test@example.com  ")).toBe(true);
  });
});

describe("sanitizeString", () => {
  it("should trim whitespace", () => {
    expect(sanitizeString("  hello  ")).toBe("hello");
    expect(sanitizeString("\n\ttabbed\n\t")).toBe("tabbed");
  });

  it("should limit string length", () => {
    const longString = "a".repeat(1000);
    expect(sanitizeString(longString, 100)).toBe("a".repeat(100));
  });

  it("should use default max length of 500", () => {
    const longString = "b".repeat(600);
    expect(sanitizeString(longString)).toBe("b".repeat(500));
  });

  it("should return empty string for non-strings", () => {
    expect(sanitizeString(null)).toBe("");
    expect(sanitizeString(undefined)).toBe("");
    expect(sanitizeString(123)).toBe("");
    expect(sanitizeString({})).toBe("");
    expect(sanitizeString([])).toBe("");
  });
});

describe("parsePositiveInt", () => {
  it("should parse positive integers from numbers", () => {
    expect(parsePositiveInt(5)).toBe(5);
    expect(parsePositiveInt(100)).toBe(100);
    expect(parsePositiveInt(1)).toBe(1);
  });

  it("should parse positive integers from strings", () => {
    expect(parsePositiveInt("10")).toBe(10);
    expect(parsePositiveInt("1")).toBe(1);
    expect(parsePositiveInt("999")).toBe(999);
  });

  it("should return default for zero and negative numbers", () => {
    expect(parsePositiveInt(0)).toBe(0);
    expect(parsePositiveInt(-5)).toBe(0);
    expect(parsePositiveInt("-10")).toBe(0);
    expect(parsePositiveInt("0")).toBe(0);
  });

  it("should return default for invalid inputs", () => {
    expect(parsePositiveInt("abc")).toBe(0);
    expect(parsePositiveInt(null)).toBe(0);
    expect(parsePositiveInt(undefined)).toBe(0);
    expect(parsePositiveInt({})).toBe(0);
    expect(parsePositiveInt(1.5)).toBe(0); // Not integer
  });

  it("should use custom default value", () => {
    expect(parsePositiveInt("invalid", 10)).toBe(10);
    expect(parsePositiveInt(null, 5)).toBe(5);
  });
});

// ============================================================================
// Response Helper Tests
// ============================================================================

describe("errorResponse", () => {
  it("should create JSON error response with correct status", async () => {
    const response = errorResponse(400, "bad_request", "Invalid input");

    expect(response.status).toBe(400);
    expect(response.headers.get("Content-Type")).toBe("application/json");

    const body = await response.json();
    expect(body.error).toBe("bad_request");
    expect(body.message).toBe("Invalid input");
  });

  it("should include details when provided", async () => {
    const response = errorResponse(
      422,
      "validation_error",
      "Validation failed",
      ["Field 'email' is required", "Field 'quantity' must be positive"]
    );

    const body = await response.json();
    expect(body.details).toHaveLength(2);
    expect(body.details).toContain("Field 'email' is required");
  });

  it("should not include details when empty array", async () => {
    const response = errorResponse(400, "bad_request", "Error", []);

    const body = await response.json();
    expect(body.details).toBeUndefined();
  });
});

describe("jsonResponse", () => {
  it("should create JSON response with data", async () => {
    const data = { id: "123", name: "Test", items: [1, 2, 3] };
    const response = jsonResponse(data);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/json");

    const body = await response.json();
    expect(body).toEqual(data);
  });

  it("should use custom status code", async () => {
    const response = jsonResponse({ created: true }, 201);

    expect(response.status).toBe(201);
  });

  it("should handle various data types", async () => {
    expect((await jsonResponse([1, 2, 3]).json())).toEqual([1, 2, 3]);
    expect((await jsonResponse("string").json())).toBe("string");
    expect((await jsonResponse(null).json())).toBeNull();
    expect((await jsonResponse(42).json())).toBe(42);
  });
});
