import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock prisma before importing payouts.server
vi.mock("../../db.server", () => ({
  default: {
    payout: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      groupBy: vi.fn(),
      aggregate: vi.fn(),
    },
    tradeInSubmission: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    tradeInSettings: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
  },
}));

import prisma from "../../db.server";
import {
  searchPayouts,
  getPayoutById,
  getPayoutBySubmissionId,
  getPayoutStats,
  createPayout,
  processStoreCreditPayout,
  markBankTransferProcessing,
  markBankTransferCompleted,
  retryPayout,
  markPayoutFailed,
  exportBankTransfers,
  getPendingPayouts,
  getStalePayouts,
} from "../payouts.server";
import { PayoutStatus, PayoutType } from "../constants";

const mockPrisma = prisma as unknown as {
  payout: {
    findMany: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    groupBy: ReturnType<typeof vi.fn>;
    aggregate: ReturnType<typeof vi.fn>;
  };
  tradeInSubmission: {
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  tradeInSettings: {
    findUnique: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
};

describe("searchPayouts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should search payouts with pagination", async () => {
    const mockPayouts = [
      {
        id: "payout-1",
        type: PayoutType.STORE_CREDIT,
        status: PayoutStatus.PENDING,
        totalAmount: 5000,
        submission: { submissionNumber: "TRD-001", status: "APPROVED" },
        customer: { email: "test@example.com", firstName: "John", lastName: "Doe" },
      },
    ];

    mockPrisma.payout.findMany.mockResolvedValue(mockPayouts);
    mockPrisma.payout.count.mockResolvedValue(1);

    const result = await searchPayouts({ page: 1, limit: 20 });

    expect(result.payouts).toEqual(mockPayouts);
    expect(result.pagination.total).toBe(1);
    expect(result.pagination.page).toBe(1);
    expect(result.pagination.limit).toBe(20);
  });

  it("should filter by status", async () => {
    mockPrisma.payout.findMany.mockResolvedValue([]);
    mockPrisma.payout.count.mockResolvedValue(0);

    await searchPayouts({ status: PayoutStatus.PENDING });

    expect(mockPrisma.payout.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: PayoutStatus.PENDING,
        }),
      })
    );
  });

  it("should filter by type", async () => {
    mockPrisma.payout.findMany.mockResolvedValue([]);
    mockPrisma.payout.count.mockResolvedValue(0);

    await searchPayouts({ type: PayoutType.BANK });

    expect(mockPrisma.payout.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          type: PayoutType.BANK,
        }),
      })
    );
  });

  it("should filter by customerId", async () => {
    mockPrisma.payout.findMany.mockResolvedValue([]);
    mockPrisma.payout.count.mockResolvedValue(0);

    await searchPayouts({ customerId: "customer-123" });

    expect(mockPrisma.payout.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          customerId: "customer-123",
        }),
      })
    );
  });

  it("should enforce minimum page of 1", async () => {
    mockPrisma.payout.findMany.mockResolvedValue([]);
    mockPrisma.payout.count.mockResolvedValue(0);

    const result = await searchPayouts({ page: -5 });

    expect(result.pagination.page).toBe(1);
  });

  it("should enforce maximum limit of 100", async () => {
    mockPrisma.payout.findMany.mockResolvedValue([]);
    mockPrisma.payout.count.mockResolvedValue(0);

    const result = await searchPayouts({ limit: 500 });

    expect(result.pagination.limit).toBe(100);
    expect(mockPrisma.payout.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 100,
      })
    );
  });

  it("should order by createdAt descending", async () => {
    mockPrisma.payout.findMany.mockResolvedValue([]);
    mockPrisma.payout.count.mockResolvedValue(0);

    await searchPayouts({});

    expect(mockPrisma.payout.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { createdAt: "desc" },
      })
    );
  });
});

describe("getPayoutById", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should get payout with full details", async () => {
    const mockPayout = {
      id: "payout-1",
      submission: { items: [] },
      customer: { payoutMethods: [] },
    };

    mockPrisma.payout.findUnique.mockResolvedValue(mockPayout);

    const result = await getPayoutById("payout-1");

    expect(result).toEqual(mockPayout);
    expect(mockPrisma.payout.findUnique).toHaveBeenCalledWith({
      where: { id: "payout-1" },
      include: expect.objectContaining({
        submission: expect.any(Object),
        customer: expect.any(Object),
      }),
    });
  });
});

describe("getPayoutBySubmissionId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should get payout by submission ID", async () => {
    const mockPayout = {
      id: "payout-1",
      submissionId: "submission-1",
      submission: {},
      customer: {},
    };

    mockPrisma.payout.findUnique.mockResolvedValue(mockPayout);

    const result = await getPayoutBySubmissionId("submission-1");

    expect(result).toEqual(mockPayout);
    expect(mockPrisma.payout.findUnique).toHaveBeenCalledWith({
      where: { submissionId: "submission-1" },
      include: expect.any(Object),
    });
  });
});

describe("getPayoutStats", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return payout statistics", async () => {
    mockPrisma.payout.groupBy.mockResolvedValue([
      { status: "PENDING", _count: 5 },
      { status: "PROCESSING", _count: 2 },
      { status: "COMPLETED", _count: 10 },
      { status: "FAILED", _count: 1 },
    ]);

    mockPrisma.payout.aggregate
      .mockResolvedValueOnce({ _sum: { totalAmount: 25000 } }) // pending
      .mockResolvedValueOnce({ _sum: { totalAmount: 150000 } }); // completed

    const result = await getPayoutStats();

    expect(result.pending).toBe(5);
    expect(result.processing).toBe(2);
    expect(result.completed).toBe(10);
    expect(result.failed).toBe(1);
    expect(result.totalPending).toBe(25000);
    expect(result.totalCompleted).toBe(150000);
  });

  it("should handle empty database", async () => {
    mockPrisma.payout.groupBy.mockResolvedValue([]);
    mockPrisma.payout.aggregate.mockResolvedValue({ _sum: { totalAmount: null } });

    const result = await getPayoutStats();

    expect(result.pending).toBe(0);
    expect(result.processing).toBe(0);
    expect(result.completed).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.totalPending).toBe(0);
    expect(result.totalCompleted).toBe(0);
  });
});

describe("createPayout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should create a store credit payout with bonus", async () => {
    const mockSubmission = {
      id: "submission-1",
      customerId: "customer-1",
      payoutType: PayoutType.STORE_CREDIT,
      quotedTotal: 10000,
      finalTotal: 10000,
      customer: {},
    };

    const mockSettings = {
      storeCreditBonusPercent: 10,
      cashPayoutPercent: 100,
    };

    mockPrisma.payout.findUnique.mockResolvedValue(null); // No existing payout
    mockPrisma.tradeInSubmission.findUnique.mockResolvedValue(mockSubmission);
    mockPrisma.tradeInSettings.findUnique.mockResolvedValue(mockSettings);
    mockPrisma.payout.create.mockResolvedValue({
      id: "new-payout",
      amount: 10000,
      bonusAmount: 1000,
      totalAmount: 11000,
    });

    const result = await createPayout("test-shop", "submission-1");

    expect(result.success).toBe(true);
    expect(mockPrisma.payout.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        submissionId: "submission-1",
        customerId: "customer-1",
        type: PayoutType.STORE_CREDIT,
        amount: 10000,
        bonusAmount: 1000, // 10% bonus
        totalAmount: 11000,
        status: PayoutStatus.PENDING,
      }),
    });
  });

  it("should create a bank transfer payout with cash reduction", async () => {
    const mockSubmission = {
      id: "submission-1",
      customerId: "customer-1",
      payoutType: PayoutType.BANK,
      quotedTotal: 10000,
      finalTotal: 10000,
      customer: {},
    };

    const mockSettings = {
      storeCreditBonusPercent: 10,
      cashPayoutPercent: 90, // 10% reduction for cash
    };

    mockPrisma.payout.findUnique.mockResolvedValue(null);
    mockPrisma.tradeInSubmission.findUnique.mockResolvedValue(mockSubmission);
    mockPrisma.tradeInSettings.findUnique.mockResolvedValue(mockSettings);
    mockPrisma.payout.create.mockResolvedValue({
      id: "new-payout",
      amount: 10000,
      bonusAmount: -1000,
      totalAmount: 9000,
    });

    const result = await createPayout("test-shop", "submission-1");

    expect(result.success).toBe(true);
    expect(mockPrisma.payout.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        amount: 10000,
        bonusAmount: -1000, // 10% reduction
        totalAmount: 9000,
      }),
    });
  });

  it("should prevent duplicate payouts", async () => {
    const existingPayout = {
      id: "existing-payout",
      status: PayoutStatus.COMPLETED,
    };

    mockPrisma.payout.findUnique.mockResolvedValue(existingPayout);

    const result = await createPayout("test-shop", "submission-1");

    expect(result.success).toBe(false);
    expect(result.error).toContain("already completed");
  });

  it("should return existing pending payout", async () => {
    const existingPayout = {
      id: "existing-payout",
      status: PayoutStatus.PENDING,
    };

    mockPrisma.payout.findUnique.mockResolvedValue(existingPayout);

    const result = await createPayout("test-shop", "submission-1");

    expect(result.success).toBe(true);
    expect(result.payout).toEqual(existingPayout);
    expect(mockPrisma.payout.create).not.toHaveBeenCalled();
  });

  it("should handle missing submission", async () => {
    mockPrisma.payout.findUnique.mockResolvedValue(null);
    mockPrisma.tradeInSubmission.findUnique.mockResolvedValue(null);
    mockPrisma.tradeInSettings.findUnique.mockResolvedValue({
      storeCreditBonusPercent: 10,
      cashPayoutPercent: 100,
    });

    const result = await createPayout("test-shop", "nonexistent");

    expect(result.success).toBe(false);
    expect(result.error).toContain("not found");
  });
});

describe("processStoreCreditPayout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should create gift card via Shopify API", async () => {
    const mockPayout = {
      id: "payout-1",
      type: PayoutType.STORE_CREDIT,
      status: PayoutStatus.PENDING,
      totalAmount: 12540, // £125.40
      submissionId: "submission-1",
      submission: { submissionNumber: "TRD-001" },
      customer: { shopifyCustomerId: "123456" },
    };

    const mockGiftCardResponse = {
      data: {
        giftCardCreate: {
          giftCard: {
            id: "gid://shopify/GiftCard/999",
            lastCharacters: "ABCD",
            maskedCode: "•••• •••• •••• ABCD",
            balance: { amount: "125.40", currencyCode: "GBP" },
          },
          userErrors: [],
        },
      },
    };

    mockPrisma.payout.findUnique.mockResolvedValue(mockPayout);
    mockPrisma.payout.update.mockResolvedValue({ ...mockPayout, status: PayoutStatus.COMPLETED });
    mockPrisma.tradeInSubmission.update.mockResolvedValue({});

    const mockAdmin = {
      graphql: vi.fn().mockResolvedValue({
        json: () => Promise.resolve(mockGiftCardResponse),
      }),
    };

    const result = await processStoreCreditPayout("payout-1", mockAdmin);

    expect(result.success).toBe(true);
    expect(result.giftCard).toBeDefined();
    expect(result.giftCard?.id).toBe("gid://shopify/GiftCard/999");
    expect(mockAdmin.graphql).toHaveBeenCalledWith(
      expect.stringContaining("giftCardCreate"),
      expect.objectContaining({
        variables: expect.objectContaining({
          input: expect.objectContaining({
            initialValue: "125.40",
          }),
        }),
      })
    );
  });

  it("should handle Shopify API errors", async () => {
    const mockPayout = {
      id: "payout-1",
      type: PayoutType.STORE_CREDIT,
      status: PayoutStatus.PENDING,
      totalAmount: 5000,
      submissionId: "submission-1",
      submission: { submissionNumber: "TRD-001" },
      customer: { shopifyCustomerId: null },
    };

    const mockErrorResponse = {
      data: {
        giftCardCreate: {
          giftCard: null,
          userErrors: [{ field: "initialValue", message: "Invalid amount" }],
        },
      },
    };

    mockPrisma.payout.findUnique.mockResolvedValue(mockPayout);
    mockPrisma.payout.update.mockResolvedValue({});

    const mockAdmin = {
      graphql: vi.fn().mockResolvedValue({
        json: () => Promise.resolve(mockErrorResponse),
      }),
    };

    const result = await processStoreCreditPayout("payout-1", mockAdmin);

    expect(result.success).toBe(false);
    expect(result.error).toBe("Invalid amount");
    expect(mockPrisma.payout.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: PayoutStatus.FAILED,
          failureReason: "Invalid amount",
        }),
      })
    );
  });

  it("should reject non-store-credit payouts", async () => {
    const mockPayout = {
      id: "payout-1",
      type: PayoutType.BANK,
      status: PayoutStatus.PENDING,
    };

    mockPrisma.payout.findUnique.mockResolvedValue(mockPayout);

    const mockAdmin = { graphql: vi.fn() };

    const result = await processStoreCreditPayout("payout-1", mockAdmin);

    expect(result.success).toBe(false);
    expect(result.error).toContain("not store credit");
    expect(mockAdmin.graphql).not.toHaveBeenCalled();
  });

  it("should reject already completed payouts", async () => {
    const mockPayout = {
      id: "payout-1",
      type: PayoutType.STORE_CREDIT,
      status: PayoutStatus.COMPLETED,
    };

    mockPrisma.payout.findUnique.mockResolvedValue(mockPayout);

    const mockAdmin = { graphql: vi.fn() };

    const result = await processStoreCreditPayout("payout-1", mockAdmin);

    expect(result.success).toBe(false);
    expect(result.error).toContain("already completed");
  });

  it("should return error for missing payout", async () => {
    mockPrisma.payout.findUnique.mockResolvedValue(null);

    const mockAdmin = { graphql: vi.fn() };

    const result = await processStoreCreditPayout("nonexistent", mockAdmin);

    expect(result.success).toBe(false);
    expect(result.error).toContain("not found");
  });
});

describe("markBankTransferProcessing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should mark bank transfer as processing with reference", async () => {
    const mockPayout = {
      id: "payout-1",
      type: PayoutType.BANK,
      status: PayoutStatus.PENDING,
    };

    mockPrisma.payout.findUnique.mockResolvedValue(mockPayout);
    mockPrisma.payout.update.mockResolvedValue({
      ...mockPayout,
      status: PayoutStatus.PROCESSING,
      bankReference: "TRF-001",
    });

    const result = await markBankTransferProcessing("payout-1", "TRF-001");

    expect(result.success).toBe(true);
    expect(mockPrisma.payout.update).toHaveBeenCalledWith({
      where: { id: "payout-1" },
      data: {
        status: PayoutStatus.PROCESSING,
        bankReference: "TRF-001",
      },
    });
  });

  it("should reject non-bank payouts", async () => {
    const mockPayout = {
      id: "payout-1",
      type: PayoutType.STORE_CREDIT,
      status: PayoutStatus.PENDING,
    };

    mockPrisma.payout.findUnique.mockResolvedValue(mockPayout);

    const result = await markBankTransferProcessing("payout-1", "TRF-001");

    expect(result.success).toBe(false);
    expect(result.error).toContain("not bank transfer");
  });

  it("should reject already completed payouts", async () => {
    const mockPayout = {
      id: "payout-1",
      type: PayoutType.BANK,
      status: PayoutStatus.COMPLETED,
    };

    mockPrisma.payout.findUnique.mockResolvedValue(mockPayout);

    const result = await markBankTransferProcessing("payout-1", "TRF-001");

    expect(result.success).toBe(false);
    expect(result.error).toContain("already completed");
  });

  it("should return error for missing payout", async () => {
    mockPrisma.payout.findUnique.mockResolvedValue(null);

    const result = await markBankTransferProcessing("nonexistent", "TRF-001");

    expect(result.success).toBe(false);
    expect(result.error).toContain("not found");
  });
});

describe("markBankTransferCompleted", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should mark bank transfer as completed", async () => {
    const mockPayout = {
      id: "payout-1",
      type: PayoutType.BANK,
      status: PayoutStatus.PROCESSING,
      submissionId: "submission-1",
      submission: {},
    };

    mockPrisma.payout.findUnique.mockResolvedValue(mockPayout);
    mockPrisma.payout.update.mockResolvedValue({
      ...mockPayout,
      status: PayoutStatus.COMPLETED,
    });
    mockPrisma.tradeInSubmission.update.mockResolvedValue({});

    const result = await markBankTransferCompleted("payout-1");

    expect(result.success).toBe(true);
    expect(mockPrisma.payout.update).toHaveBeenCalledWith({
      where: { id: "payout-1" },
      data: expect.objectContaining({
        status: PayoutStatus.COMPLETED,
        processedAt: expect.any(Date),
      }),
    });
    expect(mockPrisma.tradeInSubmission.update).toHaveBeenCalledWith({
      where: { id: "submission-1" },
      data: expect.objectContaining({
        status: "COMPLETED",
        completedAt: expect.any(Date),
      }),
    });
  });

  it("should also work for PayPal payouts", async () => {
    const mockPayout = {
      id: "payout-1",
      type: PayoutType.PAYPAL,
      status: PayoutStatus.PROCESSING,
      submissionId: "submission-1",
      submission: {},
    };

    mockPrisma.payout.findUnique.mockResolvedValue(mockPayout);
    mockPrisma.payout.update.mockResolvedValue({
      ...mockPayout,
      status: PayoutStatus.COMPLETED,
    });
    mockPrisma.tradeInSubmission.update.mockResolvedValue({});

    const result = await markBankTransferCompleted("payout-1");

    expect(result.success).toBe(true);
  });

  it("should reject store credit payouts", async () => {
    const mockPayout = {
      id: "payout-1",
      type: PayoutType.STORE_CREDIT,
      status: PayoutStatus.PROCESSING,
    };

    mockPrisma.payout.findUnique.mockResolvedValue(mockPayout);

    const result = await markBankTransferCompleted("payout-1");

    expect(result.success).toBe(false);
    expect(result.error).toContain("not bank/PayPal");
  });

  it("should reject already completed payouts", async () => {
    const mockPayout = {
      id: "payout-1",
      type: PayoutType.BANK,
      status: PayoutStatus.COMPLETED,
    };

    mockPrisma.payout.findUnique.mockResolvedValue(mockPayout);

    const result = await markBankTransferCompleted("payout-1");

    expect(result.success).toBe(false);
    expect(result.error).toContain("already completed");
  });
});

describe("retryPayout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should reset failed payout to pending", async () => {
    const mockPayout = {
      id: "payout-1",
      status: PayoutStatus.FAILED,
      failureReason: "API error",
    };

    mockPrisma.payout.findUnique.mockResolvedValue(mockPayout);
    mockPrisma.payout.update.mockResolvedValue({
      ...mockPayout,
      status: PayoutStatus.PENDING,
      failureReason: null,
    });

    const result = await retryPayout("payout-1");

    expect(result.success).toBe(true);
    expect(mockPrisma.payout.update).toHaveBeenCalledWith({
      where: { id: "payout-1" },
      data: {
        status: PayoutStatus.PENDING,
        failureReason: null,
      },
    });
  });

  it("should reject non-failed payouts", async () => {
    const mockPayout = {
      id: "payout-1",
      status: PayoutStatus.COMPLETED,
    };

    mockPrisma.payout.findUnique.mockResolvedValue(mockPayout);

    const result = await retryPayout("payout-1");

    expect(result.success).toBe(false);
    expect(result.error).toContain("Only failed payouts");
  });

  it("should return error for missing payout", async () => {
    mockPrisma.payout.findUnique.mockResolvedValue(null);

    const result = await retryPayout("nonexistent");

    expect(result.success).toBe(false);
    expect(result.error).toContain("not found");
  });
});

describe("markPayoutFailed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should mark payout as failed with reason", async () => {
    mockPrisma.payout.update.mockResolvedValue({
      id: "payout-1",
      status: PayoutStatus.FAILED,
      failureReason: "Insufficient balance",
    });

    const result = await markPayoutFailed("payout-1", "Insufficient balance");

    expect(result.success).toBe(true);
    expect(mockPrisma.payout.update).toHaveBeenCalledWith({
      where: { id: "payout-1" },
      data: {
        status: PayoutStatus.FAILED,
        failureReason: "Insufficient balance",
      },
    });
  });
});

describe("exportBankTransfers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should export pending bank transfers", async () => {
    const mockPayouts = [
      {
        id: "payout-1",
        totalAmount: 5000,
        customer: {
          firstName: "John",
          lastName: "Doe",
          email: "john@example.com",
          payoutMethods: [],
        },
        submission: { submissionNumber: "TRD-001" },
      },
      {
        id: "payout-2",
        totalAmount: 7500,
        customer: {
          firstName: "Jane",
          lastName: "Smith",
          email: "jane@example.com",
          payoutMethods: [],
        },
        submission: { submissionNumber: "TRD-002" },
      },
    ];

    mockPrisma.payout.findMany.mockResolvedValue(mockPayouts);

    const result = await exportBankTransfers();

    expect(result.count).toBe(2);
    expect(result.data).toHaveLength(2);
    expect(result.data[0]).toEqual({
      reference: "TRD-TRD-001",
      customerName: "John Doe",
      email: "john@example.com",
      amount: "50.00",
      submissionNumber: "TRD-001",
    });
    expect(result.data[1].amount).toBe("75.00");
  });

  it("should handle empty payout list", async () => {
    mockPrisma.payout.findMany.mockResolvedValue([]);

    const result = await exportBankTransfers();

    expect(result.count).toBe(0);
    expect(result.data).toHaveLength(0);
  });

  it("should handle missing customer name", async () => {
    const mockPayouts = [
      {
        id: "payout-1",
        totalAmount: 5000,
        customer: {
          firstName: null,
          lastName: null,
          email: "test@example.com",
          payoutMethods: [],
        },
        submission: { submissionNumber: "TRD-001" },
      },
    ];

    mockPrisma.payout.findMany.mockResolvedValue(mockPayouts);

    const result = await exportBankTransfers();

    expect(result.data[0].customerName).toBe("Unknown");
  });
});

describe("getPendingPayouts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return all pending payouts ordered by creation", async () => {
    const mockPayouts = [
      { id: "payout-1", status: PayoutStatus.PENDING, createdAt: new Date("2024-01-01") },
      { id: "payout-2", status: PayoutStatus.PENDING, createdAt: new Date("2024-01-02") },
    ];

    mockPrisma.payout.findMany.mockResolvedValue(mockPayouts);

    const result = await getPendingPayouts();

    expect(result).toHaveLength(2);
    expect(mockPrisma.payout.findMany).toHaveBeenCalledWith({
      where: { status: PayoutStatus.PENDING },
      orderBy: { createdAt: "asc" },
      include: expect.any(Object),
    });
  });
});

describe("getStalePayouts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return payouts pending for more than 24 hours", async () => {
    const mockPayouts = [
      {
        id: "payout-1",
        status: PayoutStatus.PENDING,
        createdAt: new Date(Date.now() - 48 * 60 * 60 * 1000), // 48 hours ago
      },
    ];

    mockPrisma.payout.findMany.mockResolvedValue(mockPayouts);

    const result = await getStalePayouts();

    expect(result).toHaveLength(1);
    expect(mockPrisma.payout.findMany).toHaveBeenCalledWith({
      where: {
        status: PayoutStatus.PENDING,
        createdAt: { lt: expect.any(Date) },
      },
      include: expect.any(Object),
    });
  });
});
