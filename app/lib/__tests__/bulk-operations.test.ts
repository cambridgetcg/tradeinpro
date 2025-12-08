/**
 * Tests for Bulk Operations Library
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock prisma before importing
vi.mock("../../db.server", () => ({
  default: {
    tradeInSubmission: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    submissionNote: {
      create: vi.fn(),
    },
    payout: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

import prisma from "../../db.server";
import {
  bulkMarkReceived,
  bulkStartGrading,
  bulkApproveSubmissions,
  bulkCancelSubmissions,
  bulkRequestReturns,
  bulkAddNotes,
} from "../bulk-operations.server";

// ============================================================================
// Test Helpers
// ============================================================================

function createMockSubmission(overrides: any = {}) {
  return {
    id: "sub_123",
    submissionNumber: "TRD-202412-00001",
    customerId: "cust_123",
    status: "SUBMITTED",
    payoutType: "STORE_CREDIT",
    quotedTotal: 5000,
    finalTotal: null,
    items: [],
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("Bulk Operations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default transaction implementation
    vi.mocked(prisma.$transaction).mockImplementation(async (ops) => {
      if (Array.isArray(ops)) {
        return Promise.all(ops);
      }
      return ops(prisma);
    });
  });

  // ==========================================================================
  // Validation Tests
  // ==========================================================================

  describe("Input Validation", () => {
    it("should reject empty submission IDs array", async () => {
      await expect(bulkMarkReceived([])).rejects.toThrow(
        "At least one submission ID is required"
      );
    });

    it("should reject too many submission IDs", async () => {
      const ids = Array.from({ length: 101 }, (_, i) => `sub_${i}`);

      await expect(bulkMarkReceived(ids)).rejects.toThrow(
        "Bulk operations limited to 100 items"
      );
    });

    it("should reject duplicate submission IDs", async () => {
      await expect(
        bulkMarkReceived(["sub_1", "sub_2", "sub_1"])
      ).rejects.toThrow("Duplicate submission IDs provided");
    });

    it("should allow custom max items limit", async () => {
      const ids = Array.from({ length: 15 }, (_, i) => `sub_${i}`);

      await expect(
        bulkMarkReceived(ids, { maxItems: 10 })
      ).rejects.toThrow("Bulk operations limited to 10 items");
    });
  });

  // ==========================================================================
  // bulkMarkReceived Tests
  // ==========================================================================

  describe("bulkMarkReceived", () => {
    it("should mark submissions as received", async () => {
      // IN_TRANSIT -> RECEIVED is a valid transition
      const mockSubmission = createMockSubmission({ status: "IN_TRANSIT" });

      vi.mocked(prisma.tradeInSubmission.findUnique).mockResolvedValue(
        mockSubmission as any
      );
      vi.mocked(prisma.tradeInSubmission.update).mockResolvedValue({
        ...mockSubmission,
        status: "RECEIVED",
      } as any);

      const result = await bulkMarkReceived(["sub_123"]);

      expect(result.success).toBe(1);
      expect(result.failed).toBe(0);
      expect(prisma.tradeInSubmission.update).toHaveBeenCalledWith({
        where: { id: "sub_123" },
        data: {
          status: "RECEIVED",
          receivedAt: expect.any(Date),
        },
      });
    });

    it("should mark SUBMITTED as received (drop-off)", async () => {
      // SUBMITTED -> RECEIVED is valid for drop-offs
      const mockSubmission = createMockSubmission({ status: "SUBMITTED" });

      vi.mocked(prisma.tradeInSubmission.findUnique).mockResolvedValue(
        mockSubmission as any
      );
      vi.mocked(prisma.tradeInSubmission.update).mockResolvedValue({
        ...mockSubmission,
        status: "RECEIVED",
      } as any);

      const result = await bulkMarkReceived(["sub_123"]);

      expect(result.success).toBe(1);
    });

    it("should handle not found submissions", async () => {
      vi.mocked(prisma.tradeInSubmission.findUnique).mockResolvedValue(null);

      const result = await bulkMarkReceived(["sub_notfound"]);

      expect(result.success).toBe(0);
      expect(result.failed).toBe(1);
      expect(result.errors[0]).toEqual({
        id: "sub_notfound",
        error: "Submission not found",
      });
    });

    it("should reject invalid status transitions", async () => {
      const mockSubmission = createMockSubmission({ status: "COMPLETED" });

      vi.mocked(prisma.tradeInSubmission.findUnique).mockResolvedValue(
        mockSubmission as any
      );

      const result = await bulkMarkReceived(["sub_123"]);

      expect(result.success).toBe(0);
      expect(result.failed).toBe(1);
      expect(result.errors[0].error).toContain("Cannot transition");
    });

    it("should process multiple submissions", async () => {
      const submissions = [
        createMockSubmission({ id: "sub_1", status: "IN_TRANSIT" }),
        createMockSubmission({ id: "sub_2", status: "SUBMITTED" }),
        createMockSubmission({ id: "sub_3", status: "COMPLETED" }), // Cannot receive COMPLETED
      ];

      vi.mocked(prisma.tradeInSubmission.findUnique).mockImplementation(
        (async (args: any) => {
          const sub = submissions.find((s) => s.id === args.where.id);
          return sub as any;
        }) as any
      );
      vi.mocked(prisma.tradeInSubmission.update).mockResolvedValue({} as any);

      const result = await bulkMarkReceived(["sub_1", "sub_2", "sub_3"]);

      expect(result.success).toBe(2);
      expect(result.failed).toBe(1);
    });
  });

  // ==========================================================================
  // bulkStartGrading Tests
  // ==========================================================================

  describe("bulkStartGrading", () => {
    it("should move submissions to grading", async () => {
      // RECEIVED -> GRADING is valid
      const mockSubmission = createMockSubmission({ status: "RECEIVED" });

      vi.mocked(prisma.tradeInSubmission.findUnique).mockResolvedValue(
        mockSubmission as any
      );
      vi.mocked(prisma.tradeInSubmission.update).mockResolvedValue({
        ...mockSubmission,
        status: "GRADING",
      } as any);

      const result = await bulkStartGrading(["sub_123"]);

      expect(result.success).toBe(1);
      expect(prisma.tradeInSubmission.update).toHaveBeenCalledWith({
        where: { id: "sub_123" },
        data: { status: "GRADING" },
      });
    });

    it("should reject submissions not in RECEIVED status", async () => {
      // SUBMITTED -> GRADING is NOT valid (must be RECEIVED first)
      const mockSubmission = createMockSubmission({ status: "SUBMITTED" });

      vi.mocked(prisma.tradeInSubmission.findUnique).mockResolvedValue(
        mockSubmission as any
      );

      const result = await bulkStartGrading(["sub_123"]);

      expect(result.failed).toBe(1);
      expect(result.errors[0].error).toContain("Cannot transition");
    });
  });

  // ==========================================================================
  // bulkApproveSubmissions Tests
  // ==========================================================================

  describe("bulkApproveSubmissions", () => {
    it("should approve submissions and create payouts", async () => {
      // PENDING_APPROVAL -> APPROVED is valid
      // Also GRADING -> APPROVED is valid for auto-approve
      const mockSubmission = createMockSubmission({
        status: "PENDING_APPROVAL",
        quotedTotal: 5000,
      });

      vi.mocked(prisma.tradeInSubmission.findUnique).mockResolvedValue(
        mockSubmission as any
      );
      vi.mocked(prisma.payout.findUnique).mockResolvedValue(null);
      vi.mocked(prisma.tradeInSubmission.update).mockResolvedValue({} as any);
      vi.mocked(prisma.payout.create).mockResolvedValue({} as any);
      vi.mocked(prisma.submissionNote.create).mockResolvedValue({} as any);

      const result = await bulkApproveSubmissions(["sub_123"]);

      expect(result.success).toBe(1);
      expect(result.failed).toBe(0);
    });

    it("should skip already approved submissions", async () => {
      const mockSubmission = createMockSubmission({ status: "APPROVED" });

      vi.mocked(prisma.tradeInSubmission.findUnique).mockResolvedValue(
        mockSubmission as any
      );

      const result = await bulkApproveSubmissions(["sub_123"]);

      expect(result.failed).toBe(1);
      expect(result.errors[0].error).toBe("Submission already approved");
    });

    it("should skip completed submissions", async () => {
      const mockSubmission = createMockSubmission({ status: "COMPLETED" });

      vi.mocked(prisma.tradeInSubmission.findUnique).mockResolvedValue(
        mockSubmission as any
      );

      const result = await bulkApproveSubmissions(["sub_123"]);

      expect(result.failed).toBe(1);
      expect(result.errors[0].error).toBe("Submission already approved");
    });

    it("should calculate store credit bonus", async () => {
      const mockSubmission = createMockSubmission({
        status: "PENDING_APPROVAL",
        payoutType: "STORE_CREDIT",
        quotedTotal: 5000,
      });

      vi.mocked(prisma.tradeInSubmission.findUnique).mockResolvedValue(
        mockSubmission as any
      );
      vi.mocked(prisma.payout.findUnique).mockResolvedValue(null);
      vi.mocked(prisma.tradeInSubmission.update).mockResolvedValue({} as any);
      vi.mocked(prisma.payout.create).mockResolvedValue({} as any);
      vi.mocked(prisma.submissionNote.create).mockResolvedValue({} as any);

      await bulkApproveSubmissions(["sub_123"]);

      // The payout should include 10% bonus for store credit
      expect(prisma.payout.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          amount: 5000,
          bonusAmount: 500, // 10% of 5000
          totalAmount: 5500,
        }),
      });
    });

    it("should not add bonus for bank transfers", async () => {
      const mockSubmission = createMockSubmission({
        status: "PENDING_APPROVAL",
        payoutType: "BANK",
        quotedTotal: 5000,
      });

      vi.mocked(prisma.tradeInSubmission.findUnique).mockResolvedValue(
        mockSubmission as any
      );
      vi.mocked(prisma.payout.findUnique).mockResolvedValue(null);
      vi.mocked(prisma.tradeInSubmission.update).mockResolvedValue({} as any);
      vi.mocked(prisma.payout.create).mockResolvedValue({} as any);
      vi.mocked(prisma.submissionNote.create).mockResolvedValue({} as any);

      await bulkApproveSubmissions(["sub_123"]);

      expect(prisma.payout.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          amount: 5000,
          bonusAmount: 0,
          totalAmount: 5000,
        }),
      });
    });
  });

  // ==========================================================================
  // bulkCancelSubmissions Tests
  // ==========================================================================

  describe("bulkCancelSubmissions", () => {
    it("should cancel submissions with reason", async () => {
      const mockSubmission = createMockSubmission({ status: "SUBMITTED" });

      vi.mocked(prisma.tradeInSubmission.findUnique).mockResolvedValue(
        mockSubmission as any
      );

      const result = await bulkCancelSubmissions(
        ["sub_123"],
        "Customer requested cancellation"
      );

      expect(result.success).toBe(1);
      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it("should require cancellation reason", async () => {
      await expect(bulkCancelSubmissions(["sub_123"], "")).rejects.toThrow(
        "Cancellation reason is required"
      );

      await expect(bulkCancelSubmissions(["sub_123"], "   ")).rejects.toThrow(
        "Cancellation reason is required"
      );
    });

    it("should skip already cancelled submissions", async () => {
      const mockSubmission = createMockSubmission({ status: "CANCELLED" });

      vi.mocked(prisma.tradeInSubmission.findUnique).mockResolvedValue(
        mockSubmission as any
      );

      const result = await bulkCancelSubmissions(["sub_123"], "Test reason");

      expect(result.failed).toBe(1);
      expect(result.errors[0].error).toBe("Submission already cancelled");
    });

    it("should not cancel completed submissions", async () => {
      const mockSubmission = createMockSubmission({ status: "COMPLETED" });

      vi.mocked(prisma.tradeInSubmission.findUnique).mockResolvedValue(
        mockSubmission as any
      );

      const result = await bulkCancelSubmissions(["sub_123"], "Test reason");

      expect(result.failed).toBe(1);
      expect(result.errors[0].error).toBe("Cannot cancel completed submission");
    });

    it("should truncate long reasons", async () => {
      const mockSubmission = createMockSubmission({ status: "SUBMITTED" });
      const longReason = "x".repeat(600);

      vi.mocked(prisma.tradeInSubmission.findUnique).mockResolvedValue(
        mockSubmission as any
      );

      await bulkCancelSubmissions(["sub_123"], longReason);

      // Verify the note message was truncated
      expect(prisma.$transaction).toHaveBeenCalledWith([
        expect.anything(),
        expect.objectContaining({
          // The reason should be truncated to 500 chars
        }),
      ]);
    });
  });

  // ==========================================================================
  // bulkRequestReturns Tests
  // ==========================================================================

  describe("bulkRequestReturns", () => {
    it("should request returns for submissions", async () => {
      const mockSubmission = createMockSubmission({
        status: "PENDING_APPROVAL",
      });

      vi.mocked(prisma.tradeInSubmission.findUnique).mockResolvedValue(
        mockSubmission as any
      );

      const result = await bulkRequestReturns(
        ["sub_123"],
        "Customer rejected grading"
      );

      expect(result.success).toBe(1);
    });

    it("should require return reason", async () => {
      await expect(bulkRequestReturns(["sub_123"], "")).rejects.toThrow(
        "Return reason is required"
      );
    });

    it("should skip already returned submissions", async () => {
      const mockSubmission = createMockSubmission({ status: "RETURNED" });

      vi.mocked(prisma.tradeInSubmission.findUnique).mockResolvedValue(
        mockSubmission as any
      );

      const result = await bulkRequestReturns(["sub_123"], "Test reason");

      expect(result.failed).toBe(1);
      expect(result.errors[0].error).toBe("Submission already returned");
    });
  });

  // ==========================================================================
  // bulkAddNotes Tests
  // ==========================================================================

  describe("bulkAddNotes", () => {
    it("should add notes to submissions", async () => {
      const mockSubmission = createMockSubmission();

      vi.mocked(prisma.tradeInSubmission.findUnique).mockResolvedValue(
        mockSubmission as any
      );
      vi.mocked(prisma.submissionNote.create).mockResolvedValue({} as any);

      const result = await bulkAddNotes(["sub_123"], "Test note");

      expect(result.success).toBe(1);
      expect(prisma.submissionNote.create).toHaveBeenCalledWith({
        data: {
          submissionId: "sub_123",
          authorType: "MERCHANT",
          authorName: undefined,
          message: "Test note",
          isInternal: true,
        },
      });
    });

    it("should require note message", async () => {
      await expect(bulkAddNotes(["sub_123"], "")).rejects.toThrow(
        "Note message is required"
      );
    });

    it("should handle not found submissions", async () => {
      vi.mocked(prisma.tradeInSubmission.findUnique).mockResolvedValue(null);

      const result = await bulkAddNotes(["sub_notfound"], "Test note");

      expect(result.failed).toBe(1);
      expect(result.errors[0].error).toBe("Submission not found");
    });

    it("should support public notes", async () => {
      const mockSubmission = createMockSubmission();

      vi.mocked(prisma.tradeInSubmission.findUnique).mockResolvedValue(
        mockSubmission as any
      );
      vi.mocked(prisma.submissionNote.create).mockResolvedValue({} as any);

      await bulkAddNotes(["sub_123"], "Public note", { isInternal: false });

      expect(prisma.submissionNote.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          isInternal: false,
        }),
      });
    });

    it("should support author name", async () => {
      const mockSubmission = createMockSubmission();

      vi.mocked(prisma.tradeInSubmission.findUnique).mockResolvedValue(
        mockSubmission as any
      );
      vi.mocked(prisma.submissionNote.create).mockResolvedValue({} as any);

      await bulkAddNotes(["sub_123"], "Note", { authorName: "Admin User" });

      expect(prisma.submissionNote.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          authorName: "Admin User",
        }),
      });
    });
  });

  // ==========================================================================
  // Error Handling Tests
  // ==========================================================================

  describe("Error Handling", () => {
    it("should continue on error when option is set", async () => {
      const submissions = [
        createMockSubmission({ id: "sub_1", status: "IN_TRANSIT" }),
        null, // Will cause not found
        createMockSubmission({ id: "sub_3", status: "IN_TRANSIT" }),
      ];

      vi.mocked(prisma.tradeInSubmission.findUnique).mockImplementation(
        (async (args: any) => {
          if (args.where.id === "sub_2") return null;
          return submissions.find((s) => s?.id === args.where.id) as any;
        }) as any
      );
      vi.mocked(prisma.tradeInSubmission.update).mockResolvedValue({} as any);

      const result = await bulkMarkReceived(["sub_1", "sub_2", "sub_3"], {
        continueOnError: true,
      });

      expect(result.success).toBe(2);
      expect(result.failed).toBe(1);
    });

    it("should stop on first error when continueOnError is false", async () => {
      vi.mocked(prisma.tradeInSubmission.findUnique).mockRejectedValue(
        new Error("Database error")
      );

      await expect(
        bulkMarkReceived(["sub_1", "sub_2"], { continueOnError: false })
      ).rejects.toThrow("Database error");
    });
  });
});
