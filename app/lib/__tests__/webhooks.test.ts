/**
 * Tests for Shopify webhooks handler
 *
 * Note: These tests mock the database and verify webhook handling logic
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import crypto from "crypto";

// Mock prisma before importing anything that uses it
vi.mock("../../db.server", () => ({
  default: {
    customer: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    payoutMethod: {
      deleteMany: vi.fn(),
    },
    tradeInSettings: {
      deleteMany: vi.fn(),
    },
    session: {
      deleteMany: vi.fn(),
    },
    submissionNote: {
      updateMany: vi.fn(),
    },
  },
}));

import prisma from "../../db.server";

// ============================================================================
// Test Helpers
// ============================================================================

const TEST_SECRET = "test_webhook_secret_12345";

/**
 * Create action args compatible with React Router v7
 */
function createActionArgs(request: Request) {
  return {
    request,
    params: {},
    context: {},
    unstable_pattern: "/webhooks",
  } as const;
}

/**
 * Generate valid webhook HMAC signature
 */
function generateWebhookHmac(body: string, secret = TEST_SECRET): string {
  return crypto.createHmac("sha256", secret).update(body, "utf8").digest("base64");
}

/**
 * Create a mock webhook request
 */
function createWebhookRequest(
  topic: string,
  payload: any,
  options: { shop?: string; valid?: boolean; secret?: string } = {}
): Request {
  const { shop = "test-store.myshopify.com", valid = true, secret = TEST_SECRET } = options;

  const body = JSON.stringify(payload);
  const hmac = valid ? generateWebhookHmac(body, secret) : "invalid-hmac";

  return new Request("https://example.com/webhooks", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Topic": topic,
      "X-Shopify-Shop-Domain": shop,
      "X-Shopify-Hmac-Sha256": hmac,
      "X-Shopify-Webhook-Id": `webhook-${Date.now()}`,
    },
    body,
  });
}

// ============================================================================
// Tests
// ============================================================================

describe("Webhooks", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env = { ...originalEnv, SHOPIFY_API_SECRET: TEST_SECRET };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("Signature Verification", () => {
    it("should accept valid HMAC signature", async () => {
      // Import action dynamically after mocks are set up
      const { action } = await import("../../routes/webhooks");

      const payload = { id: "12345", email: "test@example.com" };
      const request = createWebhookRequest("customers/update", payload);

      const response = await action(createActionArgs(request));

      expect(response.status).toBe(200);
    });

    it("should reject invalid HMAC signature", async () => {
      const { action } = await import("../../routes/webhooks");

      const payload = { id: "12345" };
      const request = createWebhookRequest("customers/update", payload, { valid: false });

      const response = await action(createActionArgs(request));

      expect(response.status).toBe(401);
    });

    it("should reject request without HMAC header", async () => {
      const { action } = await import("../../routes/webhooks");

      const body = JSON.stringify({ id: "12345" });
      const request = new Request("https://example.com/webhooks", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Topic": "customers/update",
          "X-Shopify-Shop-Domain": "test-store.myshopify.com",
          // Missing X-Shopify-Hmac-Sha256
        },
        body,
      });

      const response = await action(createActionArgs(request));

      expect(response.status).toBe(401);
    });

    it("should reject when SHOPIFY_API_SECRET not configured", async () => {
      delete process.env.SHOPIFY_API_SECRET;

      const { action } = await import("../../routes/webhooks");

      const payload = { id: "12345" };
      const request = createWebhookRequest("customers/update", payload);

      const response = await action(createActionArgs(request));

      expect(response.status).toBe(401);
    });
  });

  describe("customers/update", () => {
    it("should update existing customer", async () => {
      const mockCustomer = {
        id: "cust_123",
        shopifyCustomerId: "12345",
        email: "old@example.com",
      };

      vi.mocked(prisma.customer.findUnique).mockResolvedValue(mockCustomer as any);
      vi.mocked(prisma.customer.update).mockResolvedValue({
        ...mockCustomer,
        email: "new@example.com",
      } as any);

      const { action } = await import("../../routes/webhooks");

      const payload = {
        id: 12345,
        email: "new@example.com",
        first_name: "John",
        last_name: "Smith",
      };

      const request = createWebhookRequest("customers/update", payload);
      const response = await action(createActionArgs(request));

      expect(response.status).toBe(200);
      expect(prisma.customer.findUnique).toHaveBeenCalledWith({
        where: { shopifyCustomerId: "12345" },
      });
      expect(prisma.customer.update).toHaveBeenCalled();
    });

    it("should skip update for non-existent customer", async () => {
      vi.mocked(prisma.customer.findUnique).mockResolvedValue(null);

      const { action } = await import("../../routes/webhooks");

      const payload = { id: 99999, email: "unknown@example.com" };
      const request = createWebhookRequest("customers/update", payload);

      const response = await action(createActionArgs(request));

      expect(response.status).toBe(200);
      expect(prisma.customer.update).not.toHaveBeenCalled();
    });
  });

  describe("customers/delete", () => {
    it("should anonymize customer data", async () => {
      const mockCustomer = {
        id: "cust_123",
        shopifyCustomerId: "12345",
        email: "john@example.com",
      };

      vi.mocked(prisma.customer.findUnique).mockResolvedValue(mockCustomer as any);
      vi.mocked(prisma.customer.update).mockResolvedValue({} as any);
      vi.mocked(prisma.payoutMethod.deleteMany).mockResolvedValue({ count: 1 });

      const { action } = await import("../../routes/webhooks");

      const payload = { id: 12345 };
      const request = createWebhookRequest("customers/delete", payload);

      const response = await action(createActionArgs(request));

      expect(response.status).toBe(200);
      expect(prisma.customer.update).toHaveBeenCalledWith({
        where: { id: "cust_123" },
        data: {
          email: "deleted-12345@anonymized.local",
          firstName: "Deleted",
          lastName: "Customer",
          phone: null,
          shopifyCustomerId: null,
        },
      });
    });

    it("should delete payout methods", async () => {
      const mockCustomer = {
        id: "cust_123",
        shopifyCustomerId: "12345",
      };

      vi.mocked(prisma.customer.findUnique).mockResolvedValue(mockCustomer as any);
      vi.mocked(prisma.customer.update).mockResolvedValue({} as any);
      vi.mocked(prisma.payoutMethod.deleteMany).mockResolvedValue({ count: 2 });

      const { action } = await import("../../routes/webhooks");

      const payload = { id: 12345 };
      const request = createWebhookRequest("customers/delete", payload);

      await action(createActionArgs(request));

      expect(prisma.payoutMethod.deleteMany).toHaveBeenCalledWith({
        where: { customerId: "cust_123" },
      });
    });

    it("should handle non-existent customer gracefully", async () => {
      vi.mocked(prisma.customer.findUnique).mockResolvedValue(null);

      const { action } = await import("../../routes/webhooks");

      const payload = { id: 99999 };
      const request = createWebhookRequest("customers/delete", payload);

      const response = await action(createActionArgs(request));

      expect(response.status).toBe(200);
      expect(prisma.customer.update).not.toHaveBeenCalled();
    });
  });

  describe("app/uninstalled", () => {
    it("should delete shop settings", async () => {
      vi.mocked(prisma.tradeInSettings.deleteMany).mockResolvedValue({ count: 1 });
      vi.mocked(prisma.session.deleteMany).mockResolvedValue({ count: 3 });

      const { action } = await import("../../routes/webhooks");

      const payload = {};
      const request = createWebhookRequest("app/uninstalled", payload, {
        shop: "uninstalling-store.myshopify.com",
      });

      const response = await action(createActionArgs(request));

      expect(response.status).toBe(200);
      expect(prisma.tradeInSettings.deleteMany).toHaveBeenCalledWith({
        where: { shop: "uninstalling-store.myshopify.com" },
      });
    });

    it("should delete sessions for the shop", async () => {
      vi.mocked(prisma.tradeInSettings.deleteMany).mockResolvedValue({ count: 0 });
      vi.mocked(prisma.session.deleteMany).mockResolvedValue({ count: 5 });

      const { action } = await import("../../routes/webhooks");

      const payload = {};
      const request = createWebhookRequest("app/uninstalled", payload, {
        shop: "test-store.myshopify.com",
      });

      await action(createActionArgs(request));

      expect(prisma.session.deleteMany).toHaveBeenCalledWith({
        where: { shop: "test-store.myshopify.com" },
      });
    });
  });

  describe("customers/redact", () => {
    it("should fully redact customer data", async () => {
      const mockCustomer = {
        id: "cust_456",
        shopifyCustomerId: "67890",
      };

      vi.mocked(prisma.customer.findUnique).mockResolvedValue(mockCustomer as any);
      vi.mocked(prisma.customer.update).mockResolvedValue({} as any);
      vi.mocked(prisma.payoutMethod.deleteMany).mockResolvedValue({ count: 0 });
      vi.mocked(prisma.submissionNote.updateMany).mockResolvedValue({ count: 2 });

      const { action } = await import("../../routes/webhooks");

      const payload = {
        shop_domain: "test-store.myshopify.com",
        customer: { id: 67890 },
      };

      const request = createWebhookRequest("customers/redact", payload);
      const response = await action(createActionArgs(request));

      expect(response.status).toBe(200);
      expect(prisma.customer.update).toHaveBeenCalledWith({
        where: { id: "cust_456" },
        data: expect.objectContaining({
          email: "redacted-67890@anonymized.local",
          firstName: "Redacted",
          lastName: "Customer",
          shopifyCustomerId: null,
        }),
      });
    });

    it("should anonymize customer submission notes", async () => {
      const mockCustomer = { id: "cust_456", shopifyCustomerId: "67890" };

      vi.mocked(prisma.customer.findUnique).mockResolvedValue(mockCustomer as any);
      vi.mocked(prisma.customer.update).mockResolvedValue({} as any);
      vi.mocked(prisma.payoutMethod.deleteMany).mockResolvedValue({ count: 0 });
      vi.mocked(prisma.submissionNote.updateMany).mockResolvedValue({ count: 3 });

      const { action } = await import("../../routes/webhooks");

      const payload = {
        shop_domain: "test-store.myshopify.com",
        customer: { id: 67890 },
      };

      const request = createWebhookRequest("customers/redact", payload);
      await action(createActionArgs(request));

      expect(prisma.submissionNote.updateMany).toHaveBeenCalledWith({
        where: {
          submission: { customerId: "cust_456" },
          authorType: "CUSTOMER",
        },
        data: { authorName: "Redacted Customer" },
      });
    });
  });

  describe("shop/redact", () => {
    it("should clean up shop data", async () => {
      vi.mocked(prisma.tradeInSettings.deleteMany).mockResolvedValue({ count: 1 });
      vi.mocked(prisma.session.deleteMany).mockResolvedValue({ count: 0 });

      const { action } = await import("../../routes/webhooks");

      const payload = { shop_id: 12345 };
      const request = createWebhookRequest("shop/redact", payload, {
        shop: "redacted-store.myshopify.com",
      });

      const response = await action(createActionArgs(request));

      expect(response.status).toBe(200);
      expect(prisma.tradeInSettings.deleteMany).toHaveBeenCalled();
    });
  });

  describe("customers/data_request", () => {
    it("should acknowledge data request", async () => {
      vi.mocked(prisma.customer.findUnique).mockResolvedValue({
        id: "cust_789",
        submissions: [],
        payouts: [],
      } as any);

      const { action } = await import("../../routes/webhooks");

      const payload = {
        shop_domain: "test-store.myshopify.com",
        customer: { id: 11111 },
        orders_requested: [1001, 1002],
      };

      const request = createWebhookRequest("customers/data_request", payload);
      const response = await action(createActionArgs(request));

      expect(response.status).toBe(200);
    });
  });

  describe("Unknown topics", () => {
    it("should return 200 for unknown topics", async () => {
      const { action } = await import("../../routes/webhooks");

      const payload = { some: "data" };
      const request = createWebhookRequest("unknown/topic", payload);

      const response = await action(createActionArgs(request));

      expect(response.status).toBe(200);
    });
  });

  describe("Error handling", () => {
    it("should return 200 even on handler errors (prevent retries)", async () => {
      vi.mocked(prisma.customer.findUnique).mockRejectedValue(
        new Error("Database connection failed")
      );

      const { action } = await import("../../routes/webhooks");

      const payload = { id: 12345 };
      const request = createWebhookRequest("customers/update", payload);

      const response = await action(createActionArgs(request));

      // Should return 200 to prevent Shopify from retrying
      expect(response.status).toBe(200);
    });

    it("should return 400 for invalid JSON body", async () => {
      const { action } = await import("../../routes/webhooks");

      const body = "not valid json {{{";
      const hmac = generateWebhookHmac(body);

      const request = new Request("https://example.com/webhooks", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Topic": "customers/update",
          "X-Shopify-Shop-Domain": "test-store.myshopify.com",
          "X-Shopify-Hmac-Sha256": hmac,
        },
        body,
      });

      const response = await action(createActionArgs(request));

      expect(response.status).toBe(400);
    });
  });

  describe("HTTP Methods", () => {
    it("should reject non-POST requests", async () => {
      const { action } = await import("../../routes/webhooks");

      const request = new Request("https://example.com/webhooks", {
        method: "GET",
      });

      const response = await action(createActionArgs(request));

      expect(response.status).toBe(405);
    });

    it("loader should reject GET requests", async () => {
      const { loader } = await import("../../routes/webhooks");

      const response = await loader();

      expect(response.status).toBe(405);
    });
  });
});
