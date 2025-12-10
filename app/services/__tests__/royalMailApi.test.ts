/**
 * Tests for Royal Mail API Service
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  RoyalMailService,
  createRoyalMailService,
  getRoyalMailService,
  estimatePackageWeight,
  getPackageFormat,
  isValidUKPostcode,
  formatUKPostcode,
  ROYAL_MAIL_SERVICES,
  type CreateOrderRequest,
  type RoyalMailRecipient,
  type RoyalMailSender,
} from "../royalMailApi.server";

// ============================================================================
// Test Fixtures
// ============================================================================

const testApiKey = "test-api-key-12345";

const testRecipient: RoyalMailRecipient = {
  fullName: "John Customer",
  address: {
    addressLine1: "123 Test Street",
    city: "London",
    postcode: "SW1A 1AA",
    countryCode: "GB",
  },
  emailAddress: "customer@example.com",
  telephoneNumber: "07123456789",
};

const testSender: RoyalMailSender = {
  tradingName: "CardForum",
  companyName: "CardForum Ltd",
  address: {
    addressLine1: "456 Business Road",
    city: "Manchester",
    postcode: "M1 1AA",
    countryCode: "GB",
  },
  emailAddress: "trade-in@cardforum.co.uk",
};

const testOrderRequest: CreateOrderRequest = {
  recipient: testRecipient,
  sender: testSender,
  orderReference: "TRD-202412-00001",
  orderDate: "2024-12-10T10:00:00Z",
  subtotal: 50.0,
  shippingCostCharged: 0,
  total: 50.0,
  currencyCode: "GBP",
  weightInGrams: 150,
  packageFormatIdentifier: "largeLetter",
  serviceCode: "TPN",
  includeLabelInResponse: true,
};

const mockSuccessResponse = {
  successCount: 1,
  failureCount: 0,
  createdOrders: [
    {
      orderIdentifier: "RM-ORDER-123",
      orderReference: "TRD-202412-00001",
      createdOn: "2024-12-10T10:00:00Z",
      trackingNumber: "RM123456789GB",
      status: "created",
      label: {
        labelData: "base64-pdf-data-here",
        labelFormat: "PDF",
      },
    },
  ],
};

const mockFailedResponse = {
  successCount: 0,
  failureCount: 1,
  failedOrders: [
    {
      orderReference: "TRD-202412-00001",
      errorCode: "INVALID_POSTCODE",
      errorMessage: "Invalid postcode format",
    },
  ],
};

// ============================================================================
// Service Configuration Tests
// ============================================================================

describe("RoyalMailService - Configuration", () => {
  it("should not be configured without API key", () => {
    const service = new RoyalMailService("");
    expect(service.isConfigured()).toBe(false);
  });

  it("should be configured with API key", () => {
    const service = new RoyalMailService(testApiKey);
    expect(service.isConfigured()).toBe(true);
  });

  it("should allow custom base URL", () => {
    const service = new RoyalMailService(testApiKey, "https://custom.api.com");
    expect(service.isConfigured()).toBe(true);
  });
});

// ============================================================================
// Factory Function Tests
// ============================================================================

describe("Factory Functions", () => {
  const originalEnv = process.env.ROYAL_MAIL_API_KEY;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.ROYAL_MAIL_API_KEY;
    } else {
      process.env.ROYAL_MAIL_API_KEY = originalEnv;
    }
  });

  it("getRoyalMailService should always return an instance", () => {
    const service = getRoyalMailService();
    expect(service).toBeInstanceOf(RoyalMailService);
  });
});

// ============================================================================
// Order Creation Tests
// ============================================================================

describe("RoyalMailService - Create Order", () => {
  let service: RoyalMailService;

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    service = new RoyalMailService(testApiKey);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("should return error when not configured", async () => {
    const unconfiguredService = new RoyalMailService("");
    const result = await unconfiguredService.createOrder(testOrderRequest);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("NOT_CONFIGURED");
    }
  });

  it("should create order successfully", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockSuccessResponse,
    });
    vi.stubGlobal("fetch", mockFetch);

    const result = await service.createOrder(testOrderRequest);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.orderIdentifier).toBe("RM-ORDER-123");
      expect(result.data.trackingNumber).toBe("RM123456789GB");
      expect(result.data.label?.labelData).toBe("base64-pdf-data-here");
    }

    // Verify fetch was called with correct parameters
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/orders"),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: `Bearer ${testApiKey}`,
          "Content-Type": "application/json",
        }),
      })
    );
  });

  it("should handle API validation errors", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockFailedResponse,
    });
    vi.stubGlobal("fetch", mockFetch);

    const result = await service.createOrder(testOrderRequest);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("INVALID_POSTCODE");
      expect(result.error.message).toBe("Invalid postcode format");
    }
  });

  it("should handle HTTP errors", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      json: async () => ({ message: "Invalid API key" }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const result = await service.createOrder(testOrderRequest);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("HTTP_401");
      expect(result.error.message).toBe("Invalid API key");
    }
  });

  it("should handle network errors", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error("Network failure"));
    vi.stubGlobal("fetch", mockFetch);

    const result = await service.createOrder(testOrderRequest);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("NETWORK_ERROR");
      expect(result.error.message).toBe("Network failure");
    }
  });

  it("should handle rate limiting (429)", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
      json: async () => ({ message: "Rate limit exceeded" }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const result = await service.createOrder(testOrderRequest);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("HTTP_429");
    }
  });
});

// ============================================================================
// Get Label Tests
// ============================================================================

describe("RoyalMailService - Get Label", () => {
  let service: RoyalMailService;

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    service = new RoyalMailService(testApiKey);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("should retrieve label successfully", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        labelData: "base64-pdf-content",
        labelFormat: "PDF",
      }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const result = await service.getLabel("RM-ORDER-123");

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe("base64-pdf-content");
    }
  });

  it("should handle non-existent order", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
      json: async () => ({ message: "Order not found" }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const result = await service.getLabel("NON-EXISTENT");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("HTTP_404");
    }
  });
});

// ============================================================================
// Delete Order Tests
// ============================================================================

describe("RoyalMailService - Delete Order", () => {
  let service: RoyalMailService;

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    service = new RoyalMailService(testApiKey);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("should delete order successfully", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
    });
    vi.stubGlobal("fetch", mockFetch);

    const result = await service.deleteOrder("RM-ORDER-123");

    expect(result.success).toBe(true);
  });
});

// ============================================================================
// Helper Function Tests
// ============================================================================

describe("estimatePackageWeight", () => {
  it("should calculate weight for small submission", () => {
    const weight = estimatePackageWeight(5);
    // 50 (packaging) + 5*2 (cards) + 15 (1 top loader batch)
    expect(weight).toBe(75);
  });

  it("should calculate weight for medium submission", () => {
    const weight = estimatePackageWeight(25);
    // 50 (packaging) + 25*2 (cards) + 45 (3 top loader batches)
    expect(weight).toBe(145);
  });

  it("should calculate weight for large submission", () => {
    const weight = estimatePackageWeight(100);
    // 50 (packaging) + 100*2 (cards) + 150 (10 top loader batches)
    expect(weight).toBe(400);
  });

  it("should handle zero items", () => {
    const weight = estimatePackageWeight(0);
    // Just packaging weight
    expect(weight).toBe(50);
  });
});

describe("getPackageFormat", () => {
  it("should return largeLetter for small submissions", () => {
    expect(getPackageFormat(1)).toBe("largeLetter");
    expect(getPackageFormat(10)).toBe("largeLetter");
    expect(getPackageFormat(20)).toBe("largeLetter");
  });

  it("should return parcel for larger submissions", () => {
    expect(getPackageFormat(21)).toBe("parcel");
    expect(getPackageFormat(50)).toBe("parcel");
    expect(getPackageFormat(100)).toBe("parcel");
  });
});

describe("isValidUKPostcode", () => {
  it("should validate correct postcodes", () => {
    expect(isValidUKPostcode("SW1A 1AA")).toBe(true);
    expect(isValidUKPostcode("M1 1AA")).toBe(true);
    expect(isValidUKPostcode("B33 8TH")).toBe(true);
    expect(isValidUKPostcode("CR2 6XH")).toBe(true);
    expect(isValidUKPostcode("DN55 1PT")).toBe(true);
    expect(isValidUKPostcode("W1A 0AX")).toBe(true);
    expect(isValidUKPostcode("EC1A 1BB")).toBe(true);
  });

  it("should validate postcodes without spaces", () => {
    expect(isValidUKPostcode("SW1A1AA")).toBe(true);
    expect(isValidUKPostcode("M11AA")).toBe(true);
  });

  it("should be case insensitive", () => {
    expect(isValidUKPostcode("sw1a 1aa")).toBe(true);
    expect(isValidUKPostcode("SW1a 1Aa")).toBe(true);
  });

  it("should reject invalid postcodes", () => {
    expect(isValidUKPostcode("INVALID")).toBe(false);
    expect(isValidUKPostcode("12345")).toBe(false);
    expect(isValidUKPostcode("")).toBe(false);
    expect(isValidUKPostcode("SW1A")).toBe(false);
  });
});

describe("formatUKPostcode", () => {
  it("should format postcodes correctly", () => {
    expect(formatUKPostcode("sw1a1aa")).toBe("SW1A 1AA");
    expect(formatUKPostcode("m11aa")).toBe("M1 1AA");
    expect(formatUKPostcode("  EC1A 1BB  ")).toBe("EC1A 1BB");
  });

  it("should handle already formatted postcodes", () => {
    expect(formatUKPostcode("SW1A 1AA")).toBe("SW1A 1AA");
  });

  it("should handle short strings gracefully", () => {
    expect(formatUKPostcode("AA")).toBe("AA");
    expect(formatUKPostcode("")).toBe("");
  });
});

describe("ROYAL_MAIL_SERVICES", () => {
  it("should have correct service codes", () => {
    expect(ROYAL_MAIL_SERVICES.TRACKED_24).toBe("TPS");
    expect(ROYAL_MAIL_SERVICES.TRACKED_48).toBe("TPN");
    expect(ROYAL_MAIL_SERVICES.SPECIAL_DELIVERY_9AM).toBe("SD1");
    expect(ROYAL_MAIL_SERVICES.SPECIAL_DELIVERY_1PM).toBe("SD2");
  });
});
