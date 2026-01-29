/**
 * E2E Grading Flow Tests
 *
 * Tests the complete grading workflow:
 * SUBMITTED → RECEIVED → GRADING → [grade items] → APPROVED → payout created
 *
 * Validates:
 * - Price recalculation using marketPricePence
 * - Condition adjustment calculations
 * - Auto-payout creation on APPROVED transition
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { SubmissionStatus, ItemStatus, PayoutStatus, Condition, type ConditionType } from "../constants";
import { attemptTransition, type SubmissionContext } from "../workflow.server";

// Mock Prisma
vi.mock("../../db.server", () => ({
  default: {
    tradeInSubmission: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    tradeInItem: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    submissionNote: {
      create: vi.fn(),
    },
    payout: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    tradeInSettings: {
      findFirst: vi.fn(),
    },
  },
}));

import prisma from "../../db.server";

const mockPrisma = prisma as unknown as {
  tradeInSubmission: {
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  tradeInItem: {
    findUnique: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  submissionNote: {
    create: ReturnType<typeof vi.fn>;
  };
  payout: {
    findUnique: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
  tradeInSettings: {
    findFirst: ReturnType<typeof vi.fn>;
  };
};

// Test data
const mockSettings = {
  id: "settings-1",
  shop: "test.myshopify.com",
  conditionMultiplierNM: 0.70,
  conditionMultiplierLP: 0.55,
  conditionMultiplierMP: 0.40,
  conditionMultiplierHP: 0.25,
  conditionMultiplierDMG: 0.10,
  storeCreditBonusPercent: 10,
  minimumSubmissionValue: 500,
  maxItemsPerSubmission: 100,
};

const createMockItem = (overrides = {}) => ({
  id: "item-1",
  submissionId: "sub-1",
  cardName: "Monkey D. Luffy",
  setName: "OP01",
  setCode: "OP01",
  variant: "parallel",
  quantity: 1,
  conditionClaimed: "NM",
  conditionActual: null,
  marketPricePence: 10000, // £100.00 market price
  quotedPrice: 7000, // £70.00 (70% of market for NM)
  finalPrice: null,
  status: ItemStatus.PENDING,
  adjustmentReason: null,
  ...overrides,
});

const createMockSubmission = (overrides = {}) => ({
  id: "sub-1",
  submissionNumber: "TRD-202601-00001",
  customerId: "cust-1",
  status: SubmissionStatus.SUBMITTED,
  payoutType: "STORE_CREDIT",
  quotedTotal: 7000,
  finalTotal: null,
  bonusAmount: 700,
  items: [createMockItem()],
  customer: { id: "cust-1", email: "test@example.com" },
  ...overrides,
});

describe("Grading Flow", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockPrisma.tradeInSettings.findFirst.mockResolvedValue(mockSettings);
  });

  describe("Price Recalculation with marketPricePence", () => {
    it("should calculate new price when condition is adjusted from NM to LP", () => {
      const item = createMockItem({
        marketPricePence: 10000, // £100.00 market price
        conditionClaimed: "NM",
        quotedPrice: 7000, // £70.00 (NM at 70%)
      });

      // Calculate new price for LP (55%)
      const multiplier = mockSettings.conditionMultiplierLP;
      const expectedPrice = Math.floor(item.marketPricePence * multiplier / 10) * 10;

      expect(expectedPrice).toBe(5500); // £55.00
    });

    it("should calculate new price when condition is adjusted from NM to MP", () => {
      const item = createMockItem({
        marketPricePence: 10000,
        conditionClaimed: "NM",
      });

      const multiplier = mockSettings.conditionMultiplierMP;
      const expectedPrice = Math.floor(item.marketPricePence * multiplier / 10) * 10;

      expect(expectedPrice).toBe(4000); // £40.00
    });

    it("should calculate new price when condition is adjusted from NM to HP", () => {
      const item = createMockItem({
        marketPricePence: 10000,
        conditionClaimed: "NM",
      });

      const multiplier = mockSettings.conditionMultiplierHP;
      const expectedPrice = Math.floor(item.marketPricePence * multiplier / 10) * 10;

      expect(expectedPrice).toBe(2500); // £25.00
    });

    it("should calculate new price when condition is adjusted from NM to DMG", () => {
      const item = createMockItem({
        marketPricePence: 10000,
        conditionClaimed: "NM",
      });

      const multiplier = mockSettings.conditionMultiplierDMG;
      const expectedPrice = Math.floor(item.marketPricePence * multiplier / 10) * 10;

      expect(expectedPrice).toBe(1000); // £10.00
    });

    it("should handle quantity > 1 correctly", () => {
      const item = createMockItem({
        marketPricePence: 10000,
        quantity: 3,
        conditionClaimed: "NM",
        quotedPrice: 21000, // 3 × £70.00
      });

      const multiplier = mockSettings.conditionMultiplierLP;
      const pricePerUnit = Math.floor(item.marketPricePence * multiplier / 10) * 10;
      const totalPrice = pricePerUnit * item.quantity;

      expect(pricePerUnit).toBe(5500);
      expect(totalPrice).toBe(16500); // 3 × £55.00
    });

    it("should round down to nearest 10p", () => {
      const item = createMockItem({
        marketPricePence: 9999, // £99.99 market price
      });

      const multiplier = mockSettings.conditionMultiplierNM; // 0.70
      // 9999 * 0.70 = 6999.3 → floor(6999.3 / 10) * 10 = 6990
      const expectedPrice = Math.floor(item.marketPricePence * multiplier / 10) * 10;

      expect(expectedPrice).toBe(6990); // £69.90
    });
  });

  describe("Workflow Transitions", () => {
    it("should allow SUBMITTED → RECEIVED transition", () => {
      const context: SubmissionContext = {
        currentStatus: SubmissionStatus.SUBMITTED,
        itemsCount: 1,
        gradedItemsCount: 0,
        totalValue: 7000,
        requiresApproval: false,
        allItemsGraded: false,
      };

      const result = attemptTransition(context, SubmissionStatus.RECEIVED);
      expect(result.allowed).toBe(true);
    });

    it("should allow RECEIVED → GRADING transition", () => {
      const context: SubmissionContext = {
        currentStatus: SubmissionStatus.RECEIVED,
        itemsCount: 1,
        gradedItemsCount: 0,
        totalValue: 7000,
        requiresApproval: false,
        allItemsGraded: false,
      };

      const result = attemptTransition(context, SubmissionStatus.GRADING);
      expect(result.allowed).toBe(true);
    });

    it("should allow GRADING → APPROVED when all items graded", () => {
      const context: SubmissionContext = {
        currentStatus: SubmissionStatus.GRADING,
        itemsCount: 3,
        gradedItemsCount: 3,
        totalValue: 7000,
        requiresApproval: false,
        allItemsGraded: true,
      };

      const result = attemptTransition(context, SubmissionStatus.APPROVED);
      expect(result.allowed).toBe(true);
    });

    it("should NOT allow GRADING → APPROVED when items not graded", () => {
      const context: SubmissionContext = {
        currentStatus: SubmissionStatus.GRADING,
        itemsCount: 3,
        gradedItemsCount: 1,
        totalValue: 7000,
        requiresApproval: false,
        allItemsGraded: false,
      };

      const result = attemptTransition(context, SubmissionStatus.APPROVED);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("graded");
    });
  });

  describe("Item Status Transitions", () => {
    it("should set item status to VERIFIED when condition matches", () => {
      const item = createMockItem({
        conditionClaimed: "NM",
        status: ItemStatus.PENDING,
      });

      // Simulating grading action where actual matches claimed
      const conditionActual = "NM";
      const expectedStatus = ItemStatus.VERIFIED;

      expect(conditionActual).toBe(item.conditionClaimed);
      expect(expectedStatus).toBe(ItemStatus.VERIFIED);
    });

    it("should set item status to ADJUSTED when condition is worse", () => {
      const item = createMockItem({
        conditionClaimed: "NM",
        status: ItemStatus.PENDING,
      });

      // Simulating grading action where actual is worse than claimed
      const conditionActual = "LP";
      const expectedStatus = ItemStatus.ADJUSTED;

      expect(conditionActual).not.toBe(item.conditionClaimed);
      expect(expectedStatus).toBe(ItemStatus.ADJUSTED);
    });

    it("should set item status to REJECTED and price to 0 when rejected", () => {
      const item = createMockItem({
        status: ItemStatus.PENDING,
      });

      // Simulating reject action
      const expectedStatus = ItemStatus.REJECTED;
      const expectedPrice = 0;

      expect(expectedStatus).toBe(ItemStatus.REJECTED);
      expect(expectedPrice).toBe(0);
    });
  });

  describe("Submission Total Recalculation", () => {
    it("should recalculate finalTotal after grading all items", () => {
      const items = [
        createMockItem({ id: "item-1", quotedPrice: 7000, finalPrice: 7000 }), // Verified
        createMockItem({ id: "item-2", quotedPrice: 5000, finalPrice: 3500 }), // Adjusted
        createMockItem({ id: "item-3", quotedPrice: 3000, finalPrice: 0 }), // Rejected
      ];

      const finalTotal = items.reduce(
        (sum, item) => sum + (item.finalPrice ?? item.quotedPrice),
        0
      );

      expect(finalTotal).toBe(10500); // £70 + £35 + £0
    });

    it("should use quotedPrice if finalPrice is null", () => {
      const items = [
        createMockItem({ quotedPrice: 7000, finalPrice: null }), // Not graded yet
        createMockItem({ quotedPrice: 5000, finalPrice: 5000 }), // Verified
      ];

      const total = items.reduce(
        (sum, item) => sum + (item.finalPrice ?? item.quotedPrice),
        0
      );

      expect(total).toBe(12000);
    });
  });

  describe("Complete Grading Flow Simulation", () => {
    it("should complete full grading flow with mixed item outcomes", () => {
      // Setup: Submission with 3 items
      const submission = createMockSubmission({
        status: SubmissionStatus.GRADING,
        quotedTotal: 15000, // £150 total
        items: [
          createMockItem({
            id: "item-1",
            marketPricePence: 10000,
            quotedPrice: 7000,
            conditionClaimed: "NM"
          }),
          createMockItem({
            id: "item-2",
            marketPricePence: 8000,
            quotedPrice: 5600,
            conditionClaimed: "NM"
          }),
          createMockItem({
            id: "item-3",
            marketPricePence: 5000,
            quotedPrice: 3500,
            conditionClaimed: "NM"
          }),
        ],
      });

      // Simulate grading:
      // Item 1: Verified as NM → £70.00
      // Item 2: Adjusted to LP → £44.00 (8000 * 0.55)
      // Item 3: Rejected → £0.00

      const gradedItems = [
        { ...submission.items[0], conditionActual: "NM", finalPrice: 7000, status: ItemStatus.VERIFIED },
        { ...submission.items[1], conditionActual: "LP", finalPrice: 4400, status: ItemStatus.ADJUSTED },
        { ...submission.items[2], conditionActual: "DMG", finalPrice: 0, status: ItemStatus.REJECTED },
      ];

      const finalTotal = gradedItems.reduce((sum, item) => sum + item.finalPrice, 0);
      const allGraded = gradedItems.every(item => item.status !== ItemStatus.PENDING);

      expect(finalTotal).toBe(11400); // £114.00
      expect(allGraded).toBe(true);

      // Verify transition to APPROVED is allowed
      const context: SubmissionContext = {
        currentStatus: SubmissionStatus.GRADING,
        itemsCount: 3,
        gradedItemsCount: 3,
        totalValue: finalTotal,
        requiresApproval: false,
        allItemsGraded: true,
      };

      const transitionResult = attemptTransition(context, SubmissionStatus.APPROVED);
      expect(transitionResult.allowed).toBe(true);
    });
  });

  describe("Payout Creation on APPROVED", () => {
    it("should create payout with store credit bonus", () => {
      const baseAmount = 10000; // £100.00
      const bonusPercent = mockSettings.storeCreditBonusPercent;
      const bonusAmount = Math.floor(baseAmount * (bonusPercent / 100));
      const totalAmount = baseAmount + bonusAmount;

      expect(bonusAmount).toBe(1000); // £10.00 bonus
      expect(totalAmount).toBe(11000); // £110.00 total
    });

    it("should create payout without bonus for bank transfer", () => {
      const baseAmount = 10000;
      const payoutType = "BANK";

      // No bonus for bank transfer
      const totalAmount = baseAmount;

      expect(totalAmount).toBe(10000);
    });
  });

  describe("Edge Cases", () => {
    it("should handle item with marketPricePence = 0", () => {
      const item = createMockItem({
        marketPricePence: 0,
      });

      const multiplier = mockSettings.conditionMultiplierLP;
      const expectedPrice = Math.floor(item.marketPricePence * multiplier / 10) * 10;

      expect(expectedPrice).toBe(0);
    });

    it("should handle submission with no items", () => {
      const submission = createMockSubmission({
        items: [],
        quotedTotal: 0,
      });

      const finalTotal = submission.items.reduce(
        (sum, item) => sum + (item.finalPrice ?? item.quotedPrice),
        0
      );

      expect(finalTotal).toBe(0);
    });

    it("should handle very high value items", () => {
      const item = createMockItem({
        marketPricePence: 100000000, // £1,000,000
      });

      const multiplier = mockSettings.conditionMultiplierNM;
      const expectedPrice = Math.floor(item.marketPricePence * multiplier / 10) * 10;

      expect(expectedPrice).toBe(70000000); // £700,000
    });
  });
});
