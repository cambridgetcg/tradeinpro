/**
 * Tests for Idempotency Service
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  generateContentHash,
  type ContentHashInput,
} from "../idempotency.server";

// Mock Prisma
vi.mock("../../db.server", () => ({
  default: {
    idempotencyRecord: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      upsert: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

describe("Idempotency Service", () => {
  describe("generateContentHash", () => {
    it("should generate consistent hash for same input", () => {
      const input: ContentHashInput = {
        email: "test@example.com",
        items: [
          { cardPriceId: "card-1", cardName: "Card A", quantity: 2, conditionClaimed: "NM" },
          { cardPriceId: "card-2", cardName: "Card B", quantity: 1, conditionClaimed: "LP" },
        ],
      };

      const hash1 = generateContentHash(input);
      const hash2 = generateContentHash(input);

      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(32);
    });

    it("should generate same hash regardless of item order", () => {
      const input1: ContentHashInput = {
        email: "test@example.com",
        items: [
          { cardPriceId: "card-1", cardName: "Card A", quantity: 2, conditionClaimed: "NM" },
          { cardPriceId: "card-2", cardName: "Card B", quantity: 1, conditionClaimed: "LP" },
        ],
      };

      const input2: ContentHashInput = {
        email: "test@example.com",
        items: [
          { cardPriceId: "card-2", cardName: "Card B", quantity: 1, conditionClaimed: "LP" },
          { cardPriceId: "card-1", cardName: "Card A", quantity: 2, conditionClaimed: "NM" },
        ],
      };

      expect(generateContentHash(input1)).toBe(generateContentHash(input2));
    });

    it("should normalize email to lowercase", () => {
      const input1: ContentHashInput = {
        email: "Test@Example.COM",
        items: [{ cardName: "Card A", quantity: 1, conditionClaimed: "NM" }],
      };

      const input2: ContentHashInput = {
        email: "test@example.com",
        items: [{ cardName: "Card A", quantity: 1, conditionClaimed: "NM" }],
      };

      expect(generateContentHash(input1)).toBe(generateContentHash(input2));
    });

    it("should trim email whitespace", () => {
      const input1: ContentHashInput = {
        email: "  test@example.com  ",
        items: [{ cardName: "Card A", quantity: 1, conditionClaimed: "NM" }],
      };

      const input2: ContentHashInput = {
        email: "test@example.com",
        items: [{ cardName: "Card A", quantity: 1, conditionClaimed: "NM" }],
      };

      expect(generateContentHash(input1)).toBe(generateContentHash(input2));
    });

    it("should generate different hash for different emails", () => {
      const input1: ContentHashInput = {
        email: "user1@example.com",
        items: [{ cardName: "Card A", quantity: 1, conditionClaimed: "NM" }],
      };

      const input2: ContentHashInput = {
        email: "user2@example.com",
        items: [{ cardName: "Card A", quantity: 1, conditionClaimed: "NM" }],
      };

      expect(generateContentHash(input1)).not.toBe(generateContentHash(input2));
    });

    it("should generate different hash for different quantities", () => {
      const input1: ContentHashInput = {
        email: "test@example.com",
        items: [{ cardName: "Card A", quantity: 1, conditionClaimed: "NM" }],
      };

      const input2: ContentHashInput = {
        email: "test@example.com",
        items: [{ cardName: "Card A", quantity: 2, conditionClaimed: "NM" }],
      };

      expect(generateContentHash(input1)).not.toBe(generateContentHash(input2));
    });

    it("should generate different hash for different conditions", () => {
      const input1: ContentHashInput = {
        email: "test@example.com",
        items: [{ cardName: "Card A", quantity: 1, conditionClaimed: "NM" }],
      };

      const input2: ContentHashInput = {
        email: "test@example.com",
        items: [{ cardName: "Card A", quantity: 1, conditionClaimed: "LP" }],
      };

      expect(generateContentHash(input1)).not.toBe(generateContentHash(input2));
    });

    it("should use cardPriceId over cardName when available", () => {
      const input1: ContentHashInput = {
        email: "test@example.com",
        items: [{ cardPriceId: "price-123", cardName: "Card A", quantity: 1, conditionClaimed: "NM" }],
      };

      const input2: ContentHashInput = {
        email: "test@example.com",
        items: [{ cardPriceId: "price-123", cardName: "Different Name", quantity: 1, conditionClaimed: "NM" }],
      };

      // Same cardPriceId should produce same hash
      expect(generateContentHash(input1)).toBe(generateContentHash(input2));
    });

    it("should use cardName when cardPriceId not available", () => {
      const input1: ContentHashInput = {
        email: "test@example.com",
        items: [{ cardName: "Card A", quantity: 1, conditionClaimed: "NM" }],
      };

      const input2: ContentHashInput = {
        email: "test@example.com",
        items: [{ cardName: "Card B", quantity: 1, conditionClaimed: "NM" }],
      };

      expect(generateContentHash(input1)).not.toBe(generateContentHash(input2));
    });

    it("should handle empty items array", () => {
      const input: ContentHashInput = {
        email: "test@example.com",
        items: [],
      };

      const hash = generateContentHash(input);
      expect(hash).toHaveLength(32);
    });

    it("should handle multiple items correctly", () => {
      const input: ContentHashInput = {
        email: "test@example.com",
        items: [
          { cardName: "Card A", quantity: 4, conditionClaimed: "NM" },
          { cardName: "Card B", quantity: 2, conditionClaimed: "LP" },
          { cardName: "Card C", quantity: 1, conditionClaimed: "MP" },
        ],
      };

      const hash = generateContentHash(input);
      expect(hash).toHaveLength(32);
      expect(typeof hash).toBe("string");
    });
  });

  describe("checkIdempotency", () => {
    let mockPrisma: any;

    beforeEach(async () => {
      vi.resetModules();
      const { default: prisma } = await import("../../db.server");
      mockPrisma = prisma;
      vi.clearAllMocks();
    });

    it("should return isDuplicate: false when no matching records", async () => {
      mockPrisma.idempotencyRecord.findUnique.mockResolvedValue(null);
      mockPrisma.idempotencyRecord.findFirst.mockResolvedValue(null);

      const { checkIdempotency } = await import("../idempotency.server");

      const result = await checkIdempotency({
        idempotencyKey: "test-key-123",
        email: "test@example.com",
        contentHash: "abc123",
      });

      expect(result.isDuplicate).toBe(false);
      expect(result.existingSubmissionId).toBeUndefined();
      expect(result.cachedResponse).toBeUndefined();
    });

    it("should return duplicate with cached response for matching idempotency key", async () => {
      const cachedRecord = {
        idempotencyKey: "test-key-123",
        submissionId: "sub-456",
        responseStatus: 201,
        responseBody: JSON.stringify({ success: true, submissionId: "sub-456" }),
        expiresAt: new Date(Date.now() + 3600000), // 1 hour in future
      };

      mockPrisma.idempotencyRecord.findUnique.mockResolvedValue(cachedRecord);

      const { checkIdempotency } = await import("../idempotency.server");

      const result = await checkIdempotency({
        idempotencyKey: "test-key-123",
        email: "test@example.com",
        contentHash: "abc123",
      });

      expect(result.isDuplicate).toBe(true);
      expect(result.existingSubmissionId).toBe("sub-456");
      expect(result.cachedResponse).toEqual({
        status: 201,
        body: cachedRecord.responseBody,
      });
    });

    it("should ignore expired idempotency key records", async () => {
      const expiredRecord = {
        idempotencyKey: "test-key-123",
        submissionId: "sub-456",
        responseStatus: 201,
        responseBody: JSON.stringify({ success: true }),
        expiresAt: new Date(Date.now() - 3600000), // 1 hour in past (expired)
      };

      mockPrisma.idempotencyRecord.findUnique.mockResolvedValue(expiredRecord);
      mockPrisma.idempotencyRecord.findFirst.mockResolvedValue(null);

      const { checkIdempotency } = await import("../idempotency.server");

      const result = await checkIdempotency({
        idempotencyKey: "test-key-123",
        email: "test@example.com",
        contentHash: "abc123",
      });

      expect(result.isDuplicate).toBe(false);
    });

    it("should detect duplicate by content hash within window", async () => {
      mockPrisma.idempotencyRecord.findUnique.mockResolvedValue(null);
      mockPrisma.idempotencyRecord.findFirst.mockResolvedValue({
        contentHash: "abc123",
        email: "test@example.com",
        submissionId: "sub-789",
        createdAt: new Date(),
      });

      const { checkIdempotency } = await import("../idempotency.server");

      const result = await checkIdempotency({
        email: "test@example.com",
        contentHash: "abc123",
      });

      expect(result.isDuplicate).toBe(true);
      expect(result.existingSubmissionId).toBe("sub-789");
      expect(result.cachedResponse).toBeUndefined(); // No cached response for content hash match
    });

    it("should skip idempotency key check when not provided", async () => {
      mockPrisma.idempotencyRecord.findFirst.mockResolvedValue(null);

      const { checkIdempotency } = await import("../idempotency.server");

      await checkIdempotency({
        email: "test@example.com",
        contentHash: "abc123",
      });

      expect(mockPrisma.idempotencyRecord.findUnique).not.toHaveBeenCalled();
      expect(mockPrisma.idempotencyRecord.findFirst).toHaveBeenCalled();
    });
  });

  describe("recordIdempotency", () => {
    let mockPrisma: any;

    beforeEach(async () => {
      vi.resetModules();
      const { default: prisma } = await import("../../db.server");
      mockPrisma = prisma;
      vi.clearAllMocks();
    });

    it("should upsert idempotency record with provided key", async () => {
      mockPrisma.idempotencyRecord.upsert.mockResolvedValue({});

      const { recordIdempotency } = await import("../idempotency.server");

      await recordIdempotency({
        idempotencyKey: "test-key-123",
        contentHash: "abc123",
        email: "test@example.com",
        submissionId: "sub-456",
        responseStatus: 201,
        responseBody: JSON.stringify({ success: true }),
      });

      expect(mockPrisma.idempotencyRecord.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { idempotencyKey: "test-key-123" },
          create: expect.objectContaining({
            idempotencyKey: "test-key-123",
            contentHash: "abc123",
            email: "test@example.com",
            submissionId: "sub-456",
            responseStatus: 201,
          }),
        })
      );
    });

    it("should generate content-based key when idempotencyKey not provided", async () => {
      mockPrisma.idempotencyRecord.upsert.mockResolvedValue({});

      const { recordIdempotency } = await import("../idempotency.server");

      await recordIdempotency({
        contentHash: "abc123",
        email: "test@example.com",
        submissionId: "sub-456",
        responseStatus: 201,
        responseBody: JSON.stringify({ success: true }),
      });

      expect(mockPrisma.idempotencyRecord.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { idempotencyKey: expect.stringContaining("content-abc123-") },
        })
      );
    });

    it("should normalize email to lowercase", async () => {
      mockPrisma.idempotencyRecord.upsert.mockResolvedValue({});

      const { recordIdempotency } = await import("../idempotency.server");

      await recordIdempotency({
        idempotencyKey: "test-key",
        contentHash: "abc123",
        email: "Test@Example.COM",
        submissionId: "sub-456",
        responseStatus: 201,
        responseBody: "{}",
      });

      expect(mockPrisma.idempotencyRecord.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            email: "test@example.com",
          }),
        })
      );
    });

    it("should not throw on database errors", async () => {
      mockPrisma.idempotencyRecord.upsert.mockRejectedValue(new Error("DB error"));

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const { recordIdempotency } = await import("../idempotency.server");

      // Should not throw
      await expect(
        recordIdempotency({
          idempotencyKey: "test-key",
          contentHash: "abc123",
          email: "test@example.com",
          submissionId: "sub-456",
          responseStatus: 201,
          responseBody: "{}",
        })
      ).resolves.toBeUndefined();

      expect(consoleSpy).toHaveBeenCalledWith(
        "[idempotency] Failed to record:",
        expect.any(Error)
      );

      consoleSpy.mockRestore();
    });
  });

  describe("cleanupExpiredIdempotencyRecords", () => {
    let mockPrisma: any;

    beforeEach(async () => {
      vi.resetModules();
      const { default: prisma } = await import("../../db.server");
      mockPrisma = prisma;
      vi.clearAllMocks();
    });

    it("should delete expired records", async () => {
      mockPrisma.idempotencyRecord.deleteMany.mockResolvedValue({ count: 5 });

      const { cleanupExpiredIdempotencyRecords } = await import("../idempotency.server");

      const count = await cleanupExpiredIdempotencyRecords();

      expect(count).toBe(5);
      expect(mockPrisma.idempotencyRecord.deleteMany).toHaveBeenCalledWith({
        where: {
          expiresAt: { lt: expect.any(Date) },
        },
      });
    });

    it("should return 0 when no records to delete", async () => {
      mockPrisma.idempotencyRecord.deleteMany.mockResolvedValue({ count: 0 });

      const { cleanupExpiredIdempotencyRecords } = await import("../idempotency.server");

      const count = await cleanupExpiredIdempotencyRecords();

      expect(count).toBe(0);
    });
  });

  describe("getIdempotencyKeyFromRequest", () => {
    it("should extract X-Idempotency-Key header", async () => {
      const { getIdempotencyKeyFromRequest } = await import("../idempotency.server");

      const request = new Request("https://example.com", {
        headers: { "X-Idempotency-Key": "test-key-123" },
      });

      expect(getIdempotencyKeyFromRequest(request)).toBe("test-key-123");
    });

    it("should extract Idempotency-Key header as fallback", async () => {
      const { getIdempotencyKeyFromRequest } = await import("../idempotency.server");

      const request = new Request("https://example.com", {
        headers: { "Idempotency-Key": "fallback-key-456" },
      });

      expect(getIdempotencyKeyFromRequest(request)).toBe("fallback-key-456");
    });

    it("should prefer X-Idempotency-Key over Idempotency-Key", async () => {
      const { getIdempotencyKeyFromRequest } = await import("../idempotency.server");

      const request = new Request("https://example.com", {
        headers: {
          "X-Idempotency-Key": "preferred-key",
          "Idempotency-Key": "fallback-key",
        },
      });

      expect(getIdempotencyKeyFromRequest(request)).toBe("preferred-key");
    });

    it("should return undefined when no idempotency header present", async () => {
      const { getIdempotencyKeyFromRequest } = await import("../idempotency.server");

      const request = new Request("https://example.com");

      expect(getIdempotencyKeyFromRequest(request)).toBeUndefined();
    });
  });
});
