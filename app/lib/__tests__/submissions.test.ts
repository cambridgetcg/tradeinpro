/**
 * Tests for customer-facing submission management
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  generateSubmissionNumber,
  getOrCreateCustomer,
  getConditionPrice,
  findCardPriceByName,
  validateSubmission,
  createSubmission,
  getSubmissionById,
  getCustomerSubmissions,
  submitSubmission,
  confirmSubmission,
  rejectSubmission,
  addItemToSubmission,
  removeItemFromSubmission,
  searchCards,
  getSubmissionStatus,
  getSubmissionSettings,
} from "../submissions.server";
import { Condition, PayoutType, type ConditionType } from "../constants";

// Mock Prisma
vi.mock("../../db.server", () => ({
  default: {
    tradeInSettings: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    tradeInSubmission: {
      count: vi.fn(),
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    customer: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    cardPrice: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    cardPriceV2: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    tradeInItem: {
      create: vi.fn(),
      findUnique: vi.fn(),
      delete: vi.fn(),
    },
    submissionNote: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

import prisma from "../../db.server";

const mockPrisma = prisma as unknown as {
  tradeInSettings: {
    findFirst: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
  tradeInSubmission: {
    count: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  customer: {
    findUnique: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  cardPrice: {
    findUnique: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
  };
  cardPriceV2: {
    findUnique: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
  };
  tradeInItem: {
    create: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  submissionNote: {
    create: ReturnType<typeof vi.fn>;
  };
  $transaction: ReturnType<typeof vi.fn>;
};

// Sample data
const mockCardPrice = {
  id: "card-1",
  cardName: "Charizard VMAX",
  setName: "Sword & Shield",
  setCode: "SWSH",
  variant: null,
  rarity: "Ultra Rare",
  priceNM: 5000,
  priceLP: 4000,
  priceMP: 3000,
  priceHP: 2000,
  priceDMG: 1000,
  isActive: true,
};

const mockCustomer = {
  id: "customer-1",
  shopifyCustomerId: "shopify-123",
  email: "test@example.com",
  firstName: "John",
  lastName: "Doe",
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockSubmission = {
  id: "sub-1",
  submissionNumber: "TRD-202412-00001",
  customerId: "customer-1",
  status: "DRAFT",
  payoutType: "STORE_CREDIT",
  quotedTotal: 5000,
  finalTotal: null,
  bonusAmount: 500,
  shippingMethod: null,
  trackingNumber: null,
  labelUrl: null,
  submittedAt: null,
  receivedAt: null,
  gradedAt: null,
  approvedAt: null,
  completedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  items: [],
  customer: mockCustomer,
};

const mockSettings = {
  minimumSubmissionValue: 500,
  maxItemsPerSubmission: 100,
  autoApproveBelow: 2000,
  requiresApprovalAbove: 5000,
  storeCreditBonusPercent: 10,
};

// Full settings object used by getOrCreateSettings
const mockFullSettings = {
  id: "settings-1",
  shop: "default",
  minimumSubmissionValue: 500,
  maxItemsPerSubmission: 100,
  autoApproveBelow: 2000,
  requiresApprovalAbove: 5000,
  storeCreditBonusPercent: 10,
  conditionMultiplierNM: 0.7,
  conditionMultiplierLP: 0.55,
  conditionMultiplierMP: 0.4,
  conditionMultiplierHP: 0.25,
  conditionMultiplierDMG: 0.1,
  freeShippingThreshold: 5000,
  createdAt: new Date(),
  updatedAt: new Date(),
};

// Mock CardPriceV2 card
const mockCardPriceV2 = {
  cardId: "OP02-OP02-013-manga-parallel-altart",
  name: "OP02 Portgas D. Ace Manga Parallel Alt Art -EN",
  game: "onepiece",
  releaseSet: "OP02",
  setCode: "OP02",
  cardNumber: "013",
  variantType: "manga-parallel-altart",
  rarity: "Rare",
  bestPriceGbp: 500, // £500
  tradeinPriceGbp: 350,
  imageUrl: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.tradeInSettings.findFirst.mockResolvedValue(mockSettings);
  mockPrisma.tradeInSettings.findUnique.mockResolvedValue(mockFullSettings);
  mockPrisma.cardPriceV2.findMany.mockResolvedValue([mockCardPriceV2]);
});

// ============================================================================
// getSubmissionSettings
// ============================================================================

describe("getSubmissionSettings", () => {
  it("should return settings from database", async () => {
    mockPrisma.tradeInSettings.findFirst.mockResolvedValue({
      minimumSubmissionValue: 1000,
      maxItemsPerSubmission: 50,
      autoApproveBelow: 3000,
      requiresApprovalAbove: 10000,
      storeCreditBonusPercent: 15,
    });

    const settings = await getSubmissionSettings();

    expect(settings.minimumSubmissionValue).toBe(1000);
    expect(settings.maxItemsPerSubmission).toBe(50);
    expect(settings.storeCreditBonusPercent).toBe(15);
  });

  it("should return defaults when no settings exist", async () => {
    mockPrisma.tradeInSettings.findFirst.mockResolvedValue(null);

    const settings = await getSubmissionSettings();

    expect(settings.minimumSubmissionValue).toBe(500);
    expect(settings.maxItemsPerSubmission).toBe(100);
    expect(settings.storeCreditBonusPercent).toBe(10);
  });
});

// ============================================================================
// generateSubmissionNumber
// ============================================================================

describe("generateSubmissionNumber", () => {
  it("should generate unique submission number", async () => {
    mockPrisma.tradeInSubmission.count.mockResolvedValue(0);

    const number = await generateSubmissionNumber();

    expect(number).toMatch(/^TRD-\d{6}-00001$/);
  });

  it("should increment sequence correctly", async () => {
    mockPrisma.tradeInSubmission.count.mockResolvedValue(42);

    const number = await generateSubmissionNumber();

    expect(number).toMatch(/^TRD-\d{6}-00043$/);
  });

  it("should use current year-month prefix", async () => {
    mockPrisma.tradeInSubmission.count.mockResolvedValue(0);
    const now = new Date();
    const expectedPrefix = `TRD-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;

    const number = await generateSubmissionNumber();

    expect(number.startsWith(expectedPrefix)).toBe(true);
  });
});

// ============================================================================
// getOrCreateCustomer
// ============================================================================

describe("getOrCreateCustomer", () => {
  it("should return existing customer by Shopify ID", async () => {
    mockPrisma.customer.findUnique.mockResolvedValue(mockCustomer);

    const customer = await getOrCreateCustomer({
      shopifyCustomerId: "shopify-123",
      email: "test@example.com",
    });

    expect(customer).toEqual(mockCustomer);
    expect(mockPrisma.customer.findUnique).toHaveBeenCalledWith({
      where: { shopifyCustomerId: "shopify-123" },
    });
  });

  it("should return existing customer by email", async () => {
    mockPrisma.customer.findUnique.mockResolvedValue(null);
    mockPrisma.customer.findFirst.mockResolvedValue(mockCustomer);

    const customer = await getOrCreateCustomer({
      email: "test@example.com",
    });

    expect(customer).toEqual(mockCustomer);
    expect(mockPrisma.customer.findFirst).toHaveBeenCalledWith({
      where: { email: "test@example.com" },
    });
  });

  it("should create new customer when not found", async () => {
    mockPrisma.customer.findUnique.mockResolvedValue(null);
    mockPrisma.customer.findFirst.mockResolvedValue(null);
    mockPrisma.customer.create.mockResolvedValue(mockCustomer);

    const customer = await getOrCreateCustomer({
      email: "new@example.com",
      firstName: "Jane",
      lastName: "Doe",
    });

    expect(mockPrisma.customer.create).toHaveBeenCalledWith({
      data: {
        shopifyCustomerId: undefined,
        email: "new@example.com",
        firstName: "Jane",
        lastName: "Doe",
      },
    });
  });

  it("should link Shopify ID to existing email customer", async () => {
    const customerWithoutShopifyId = { ...mockCustomer, shopifyCustomerId: null };
    mockPrisma.customer.findUnique.mockResolvedValue(null);
    mockPrisma.customer.findFirst.mockResolvedValue(customerWithoutShopifyId);
    mockPrisma.customer.update.mockResolvedValue(mockCustomer);

    const customer = await getOrCreateCustomer({
      shopifyCustomerId: "shopify-123",
      email: "test@example.com",
    });

    expect(mockPrisma.customer.update).toHaveBeenCalledWith({
      where: { id: customerWithoutShopifyId.id },
      data: { shopifyCustomerId: "shopify-123" },
    });
  });

  it("should normalize email to lowercase", async () => {
    mockPrisma.customer.findUnique.mockResolvedValue(null);
    mockPrisma.customer.findFirst.mockResolvedValue(null);
    mockPrisma.customer.create.mockResolvedValue(mockCustomer);

    await getOrCreateCustomer({
      email: "TEST@EXAMPLE.COM",
    });

    expect(mockPrisma.customer.findFirst).toHaveBeenCalledWith({
      where: { email: "test@example.com" },
    });
  });
});

// ============================================================================
// getConditionPrice
// ============================================================================

describe("getConditionPrice", () => {
  it("should return NM price for Near Mint condition", () => {
    const price = getConditionPrice(mockCardPrice, Condition.NM);
    expect(price).toBe(5000);
  });

  it("should return LP price for Lightly Played condition", () => {
    const price = getConditionPrice(mockCardPrice, Condition.LP);
    expect(price).toBe(4000);
  });

  it("should return MP price for Moderately Played condition", () => {
    const price = getConditionPrice(mockCardPrice, Condition.MP);
    expect(price).toBe(3000);
  });

  it("should return HP price for Heavily Played condition", () => {
    const price = getConditionPrice(mockCardPrice, Condition.HP);
    expect(price).toBe(2000);
  });

  it("should return DMG price for Damaged condition", () => {
    const price = getConditionPrice(mockCardPrice, Condition.DMG);
    expect(price).toBe(1000);
  });

  it("should default to NM price for unknown condition", () => {
    const price = getConditionPrice(mockCardPrice, "UNKNOWN" as ConditionType);
    expect(price).toBe(5000);
  });
});

// ============================================================================
// findCardPriceByName
// ============================================================================

describe("findCardPriceByName", () => {
  it("should find card by name and set", async () => {
    mockPrisma.cardPrice.findFirst.mockResolvedValue(mockCardPrice);

    const card = await findCardPriceByName("Charizard VMAX", "Sword & Shield");

    expect(card).toEqual(mockCardPrice);
    expect(mockPrisma.cardPrice.findFirst).toHaveBeenCalledWith({
      where: {
        cardName: { equals: "Charizard VMAX", mode: "insensitive" },
        setName: { equals: "Sword & Shield", mode: "insensitive" },
        isActive: true,
      },
    });
  });

  it("should include variant in search if provided", async () => {
    mockPrisma.cardPrice.findFirst.mockResolvedValue(mockCardPrice);

    await findCardPriceByName("Pikachu", "Base Set", "1st Edition");

    expect(mockPrisma.cardPrice.findFirst).toHaveBeenCalledWith({
      where: {
        cardName: { equals: "Pikachu", mode: "insensitive" },
        setName: { equals: "Base Set", mode: "insensitive" },
        variant: "1st Edition",
        isActive: true,
      },
    });
  });

  it("should return null when card not found", async () => {
    mockPrisma.cardPrice.findFirst.mockResolvedValue(null);

    const card = await findCardPriceByName("Nonexistent Card", "Unknown Set");

    expect(card).toBeNull();
  });
});

// ============================================================================
// validateSubmission
// ============================================================================

describe("validateSubmission", () => {
  it("should accept valid submission above minimum value", async () => {
    mockPrisma.cardPrice.findFirst.mockResolvedValue(mockCardPrice);

    const validation = await validateSubmission(
      [
        {
          cardName: "Charizard VMAX",
          setName: "Sword & Shield",
          quantity: 1,
          conditionClaimed: Condition.NM,
        },
      ],
      mockSettings
    );

    expect(validation.isValid).toBe(true);
    expect(validation.errors).toHaveLength(0);
    expect(validation.currentTotal).toBe(5000);
  });

  it("should reject submission below minimum value", async () => {
    const lowPriceCard = { ...mockCardPrice, priceNM: 100 };
    mockPrisma.cardPrice.findFirst.mockResolvedValue(lowPriceCard);

    const validation = await validateSubmission(
      [
        {
          cardName: "Common Card",
          setName: "Base Set",
          quantity: 1,
          conditionClaimed: Condition.NM,
        },
      ],
      mockSettings
    );

    expect(validation.isValid).toBe(false);
    expect(validation.minimumValue).toBe(false);
    expect(validation.errors).toContain("Minimum submission value is £5.00");
  });

  it("should reject submission exceeding item limit", async () => {
    mockPrisma.cardPrice.findFirst.mockResolvedValue(mockCardPrice);
    const strictSettings = { ...mockSettings, maxItemsPerSubmission: 5 };

    const validation = await validateSubmission(
      [
        {
          cardName: "Charizard VMAX",
          setName: "Sword & Shield",
          quantity: 10,
          conditionClaimed: Condition.NM,
        },
      ],
      strictSettings
    );

    expect(validation.isValid).toBe(false);
    expect(validation.withinItemLimit).toBe(false);
    expect(validation.errors).toContain("Maximum 5 items per submission");
  });

  it("should handle invalid card references", async () => {
    mockPrisma.cardPrice.findFirst.mockResolvedValue(null);

    const validation = await validateSubmission(
      [
        {
          cardName: "Invalid Card",
          setName: "Unknown Set",
          quantity: 1,
          conditionClaimed: Condition.NM,
        },
      ],
      mockSettings
    );

    expect(validation.isValid).toBe(false);
    expect(validation.invalidCards).toContain("Invalid Card");
  });

  it("should calculate correct totals for mixed conditions", async () => {
    mockPrisma.cardPrice.findFirst.mockResolvedValue(mockCardPrice);

    const validation = await validateSubmission(
      [
        {
          cardName: "Charizard VMAX",
          setName: "Sword & Shield",
          quantity: 1,
          conditionClaimed: Condition.NM, // 5000
        },
        {
          cardName: "Charizard VMAX",
          setName: "Sword & Shield",
          quantity: 2,
          conditionClaimed: Condition.LP, // 4000 * 2 = 8000
        },
      ],
      mockSettings
    );

    expect(validation.isValid).toBe(true);
    expect(validation.currentTotal).toBe(13000); // 5000 + 8000
    expect(validation.currentItems).toBe(3);
  });

  it("should reject inactive cards", async () => {
    const inactiveCard = { ...mockCardPrice, isActive: false };
    mockPrisma.cardPrice.findFirst.mockResolvedValue(null); // Active query returns null
    mockPrisma.cardPrice.findUnique.mockResolvedValue(inactiveCard);

    const validation = await validateSubmission(
      [
        {
          cardPriceId: "card-1",
          cardName: "Charizard VMAX",
          setName: "Sword & Shield",
          quantity: 1,
          conditionClaimed: Condition.NM,
        },
      ],
      mockSettings
    );

    expect(validation.invalidCards).toContain("Charizard VMAX");
  });
});

// ============================================================================
// createSubmission
// ============================================================================

describe("createSubmission", () => {
  beforeEach(() => {
    mockPrisma.cardPrice.findFirst.mockResolvedValue(mockCardPrice);
    mockPrisma.cardPrice.findUnique.mockResolvedValue(mockCardPrice);
    mockPrisma.cardPriceV2.findMany.mockResolvedValue([mockCardPriceV2]);
    mockPrisma.customer.findUnique.mockResolvedValue(null);
    mockPrisma.customer.findFirst.mockResolvedValue(null);
    mockPrisma.customer.create.mockResolvedValue(mockCustomer);
    mockPrisma.tradeInSubmission.count.mockResolvedValue(0);
    mockPrisma.tradeInSubmission.create.mockResolvedValue(mockSubmission);
  });

  it("should create submission with valid data", async () => {
    const result = await createSubmission({
      email: "test@example.com",
      firstName: "John",
      lastName: "Doe",
      payoutType: PayoutType.STORE_CREDIT,
      items: [
        {
          cardPriceId: mockCardPriceV2.cardId,
          cardName: mockCardPriceV2.name,
          setName: mockCardPriceV2.setCode || "Unknown",
          quantity: 1,
          conditionClaimed: Condition.NM,
        },
      ],
    });

    expect(result.success).toBe(true);
    expect(mockPrisma.tradeInSubmission.create).toHaveBeenCalled();
  });

  it("should return validation errors for invalid data", async () => {
    mockPrisma.cardPrice.findFirst.mockResolvedValue(null);
    mockPrisma.cardPriceV2.findMany.mockResolvedValue([]); // No cards found

    const result = await createSubmission({
      email: "test@example.com",
      payoutType: PayoutType.STORE_CREDIT,
      items: [
        {
          cardPriceId: "invalid-card-id",
          cardName: "Invalid Card",
          setName: "Unknown Set",
          quantity: 1,
          conditionClaimed: Condition.NM,
        },
      ],
    });

    expect(result.success).toBe(false);
    expect(result.errors).toBeDefined();
  });

  it("should calculate bonus for store credit", async () => {
    await createSubmission({
      email: "test@example.com",
      payoutType: PayoutType.STORE_CREDIT,
      items: [
        {
          cardPriceId: mockCardPriceV2.cardId,
          cardName: mockCardPriceV2.name,
          setName: mockCardPriceV2.setCode || "Unknown",
          quantity: 1,
          conditionClaimed: Condition.NM,
        },
      ],
    });

    const createCall = mockPrisma.tradeInSubmission.create.mock.calls[0][0];
    // mockCardPriceV2.bestPriceGbp = 500 GBP = 50000 pence
    // NM condition multiplier = 0.7, so 50000 * 0.7 = 35000 pence (rounded to nearest 10p)
    // 10% bonus = 3500 pence
    expect(createCall.data.bonusAmount).toBe(3500);
  });

  it("should not add bonus for bank transfer", async () => {
    await createSubmission({
      email: "test@example.com",
      payoutType: PayoutType.BANK,
      items: [
        {
          cardPriceId: mockCardPriceV2.cardId,
          cardName: mockCardPriceV2.name,
          setName: mockCardPriceV2.setCode || "Unknown",
          quantity: 1,
          conditionClaimed: Condition.NM,
        },
      ],
    });

    const createCall = mockPrisma.tradeInSubmission.create.mock.calls[0][0];
    expect(createCall.data.bonusAmount).toBe(0);
  });

  it("should link to Shopify customer when available", async () => {
    mockPrisma.customer.findUnique.mockResolvedValue(mockCustomer);

    await createSubmission({
      shopifyCustomerId: "shopify-123",
      email: "test@example.com",
      payoutType: PayoutType.STORE_CREDIT,
      items: [
        {
          cardPriceId: mockCardPriceV2.cardId,
          cardName: mockCardPriceV2.name,
          setName: mockCardPriceV2.setCode || "Unknown",
          quantity: 1,
          conditionClaimed: Condition.NM,
        },
      ],
    });

    expect(mockPrisma.customer.findUnique).toHaveBeenCalledWith({
      where: { shopifyCustomerId: "shopify-123" },
    });
  });
});

// ============================================================================
// submitSubmission
// ============================================================================

describe("submitSubmission", () => {
  it("should submit draft submission", async () => {
    const draftSubmission = {
      ...mockSubmission,
      status: "DRAFT",
      items: [{ id: "item-1" }],
    };
    mockPrisma.tradeInSubmission.findUnique.mockResolvedValue(draftSubmission);
    mockPrisma.tradeInSubmission.update.mockResolvedValue({
      ...draftSubmission,
      status: "SUBMITTED",
    });

    const result = await submitSubmission("sub-1");

    expect(result.status).toBe("SUBMITTED");
    expect(mockPrisma.tradeInSubmission.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "sub-1" },
        data: expect.objectContaining({
          status: "SUBMITTED",
          submittedAt: expect.any(Date),
        }),
      })
    );
  });

  it("should throw error for non-draft submission", async () => {
    mockPrisma.tradeInSubmission.findUnique.mockResolvedValue({
      ...mockSubmission,
      status: "SUBMITTED",
    });

    await expect(submitSubmission("sub-1")).rejects.toThrow(
      "Only draft submissions can be submitted"
    );
  });

  it("should throw error for empty submission", async () => {
    mockPrisma.tradeInSubmission.findUnique.mockResolvedValue({
      ...mockSubmission,
      status: "DRAFT",
      items: [],
    });

    await expect(submitSubmission("sub-1")).rejects.toThrow(
      "Submission must have at least one item"
    );
  });

  it("should throw error for non-existent submission", async () => {
    mockPrisma.tradeInSubmission.findUnique.mockResolvedValue(null);

    await expect(submitSubmission("non-existent")).rejects.toThrow(
      "Submission not found"
    );
  });
});

// ============================================================================
// confirmSubmission
// ============================================================================

describe("confirmSubmission", () => {
  it("should approve pending approval submission", async () => {
    mockPrisma.tradeInSubmission.findUnique.mockResolvedValue({
      ...mockSubmission,
      status: "PENDING_APPROVAL",
    });
    mockPrisma.tradeInSubmission.update.mockResolvedValue({
      ...mockSubmission,
      status: "APPROVED",
    });

    const result = await confirmSubmission("sub-1", "customer-1");

    expect(result.status).toBe("APPROVED");
  });

  it("should throw error if not owner", async () => {
    mockPrisma.tradeInSubmission.findUnique.mockResolvedValue({
      ...mockSubmission,
      status: "PENDING_APPROVAL",
    });

    await expect(confirmSubmission("sub-1", "wrong-customer")).rejects.toThrow(
      "Not authorized to confirm this submission"
    );
  });

  it("should throw error if not pending approval", async () => {
    mockPrisma.tradeInSubmission.findUnique.mockResolvedValue({
      ...mockSubmission,
      status: "GRADING",
    });

    await expect(confirmSubmission("sub-1", "customer-1")).rejects.toThrow(
      "Submission is not pending approval"
    );
  });
});

// ============================================================================
// rejectSubmission
// ============================================================================

describe("rejectSubmission", () => {
  it("should reject and request return", async () => {
    mockPrisma.tradeInSubmission.findUnique.mockResolvedValue({
      ...mockSubmission,
      status: "PENDING_APPROVAL",
    });
    mockPrisma.$transaction.mockResolvedValue([
      { ...mockSubmission, status: "RETURNED" },
      { id: "note-1" },
    ]);

    const result = await rejectSubmission(
      "sub-1",
      "customer-1",
      "Disagree with grading"
    );

    expect(mockPrisma.$transaction).toHaveBeenCalled();
  });

  it("should throw error if not owner", async () => {
    mockPrisma.tradeInSubmission.findUnique.mockResolvedValue({
      ...mockSubmission,
      status: "PENDING_APPROVAL",
    });

    await expect(
      rejectSubmission("sub-1", "wrong-customer", "reason")
    ).rejects.toThrow("Not authorized to reject this submission");
  });
});

// ============================================================================
// addItemToSubmission / removeItemFromSubmission
// ============================================================================

describe("addItemToSubmission", () => {
  it("should add item to draft submission", async () => {
    mockPrisma.tradeInSubmission.findUnique.mockResolvedValue({
      ...mockSubmission,
      status: "DRAFT",
    });
    mockPrisma.cardPrice.findFirst.mockResolvedValue(mockCardPrice);
    mockPrisma.$transaction.mockResolvedValue([{ id: "item-1" }, {}]);

    const item = await addItemToSubmission("sub-1", {
      cardName: "Charizard VMAX",
      setName: "Sword & Shield",
      quantity: 1,
      conditionClaimed: Condition.NM,
    });

    expect(mockPrisma.$transaction).toHaveBeenCalled();
  });

  it("should throw error for non-draft submission", async () => {
    mockPrisma.tradeInSubmission.findUnique.mockResolvedValue({
      ...mockSubmission,
      status: "SUBMITTED",
    });

    await expect(
      addItemToSubmission("sub-1", {
        cardName: "Test",
        setName: "Test",
        quantity: 1,
        conditionClaimed: Condition.NM,
      })
    ).rejects.toThrow("Can only add items to draft submissions");
  });

  it("should throw error for inactive card", async () => {
    mockPrisma.tradeInSubmission.findUnique.mockResolvedValue({
      ...mockSubmission,
      status: "DRAFT",
    });
    mockPrisma.cardPrice.findFirst.mockResolvedValue(null);

    await expect(
      addItemToSubmission("sub-1", {
        cardName: "Invalid",
        setName: "Invalid",
        quantity: 1,
        conditionClaimed: Condition.NM,
      })
    ).rejects.toThrow("Card not found or not accepting trade-ins");
  });
});

describe("removeItemFromSubmission", () => {
  it("should remove item from draft submission", async () => {
    mockPrisma.tradeInSubmission.findUnique.mockResolvedValue({
      ...mockSubmission,
      status: "DRAFT",
    });
    mockPrisma.tradeInItem.findUnique.mockResolvedValue({
      id: "item-1",
      submissionId: "sub-1",
      quotedPrice: 5000,
    });
    mockPrisma.$transaction.mockResolvedValue([{}, {}]);

    const result = await removeItemFromSubmission("sub-1", "item-1");

    expect(result.success).toBe(true);
    expect(mockPrisma.$transaction).toHaveBeenCalled();
  });

  it("should throw error for non-draft submission", async () => {
    mockPrisma.tradeInSubmission.findUnique.mockResolvedValue({
      ...mockSubmission,
      status: "SUBMITTED",
    });

    await expect(removeItemFromSubmission("sub-1", "item-1")).rejects.toThrow(
      "Can only remove items from draft submissions"
    );
  });
});

// ============================================================================
// searchCards
// ============================================================================

describe("searchCards", () => {
  it("should search by card name", async () => {
    mockPrisma.cardPrice.findMany.mockResolvedValue([mockCardPrice]);

    const results = await searchCards({ query: "Charizard" });

    expect(results).toHaveLength(1);
    expect(results[0].cardName).toBe("Charizard VMAX");
  });

  it("should return empty for short query", async () => {
    const results = await searchCards({ query: "a" });

    expect(results).toHaveLength(0);
    expect(mockPrisma.cardPrice.findMany).not.toHaveBeenCalled();
  });

  it("should filter by game", async () => {
    mockPrisma.cardPrice.findMany.mockResolvedValue([]);

    await searchCards({ query: "Pikachu", game: "pokemon" });

    expect(mockPrisma.cardPrice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          setName: { contains: "pokemon", mode: "insensitive" },
        }),
      })
    );
  });

  it("should respect limit parameter", async () => {
    mockPrisma.cardPrice.findMany.mockResolvedValue([]);

    await searchCards({ query: "test", limit: 10 });

    expect(mockPrisma.cardPrice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 10,
      })
    );
  });

  it("should format response with all prices", async () => {
    mockPrisma.cardPrice.findMany.mockResolvedValue([mockCardPrice]);

    const results = await searchCards({ query: "Charizard" });

    expect(results[0].prices).toEqual({
      NM: 5000,
      LP: 4000,
      MP: 3000,
      HP: 2000,
      DMG: 1000,
    });
  });
});

// ============================================================================
// getSubmissionStatus
// ============================================================================

describe("getSubmissionStatus", () => {
  it("should return formatted status with timeline", async () => {
    mockPrisma.tradeInSubmission.findUnique.mockResolvedValue({
      ...mockSubmission,
      status: "GRADING",
      submittedAt: new Date(),
      receivedAt: new Date(),
      items: [
        { status: "VERIFIED" },
        { status: "ADJUSTED" },
        { status: "PENDING" },
      ],
      payout: null,
    });

    const status = await getSubmissionStatus("sub-1");

    expect(status).toBeDefined();
    expect(status!.status).toBe("GRADING");
    expect(status!.statusLabel).toBe("Grading");
    expect(status!.timeline).toHaveLength(8);
    expect(status!.verifiedCount).toBe(1);
    expect(status!.adjustedCount).toBe(1);
  });

  it("should return null for non-existent submission", async () => {
    mockPrisma.tradeInSubmission.findUnique.mockResolvedValue(null);

    const status = await getSubmissionStatus("non-existent");

    expect(status).toBeNull();
  });

  it("should include next action for customer", async () => {
    mockPrisma.tradeInSubmission.findUnique.mockResolvedValue({
      ...mockSubmission,
      status: "PENDING_APPROVAL",
      items: [],
      payout: null,
    });

    const status = await getSubmissionStatus("sub-1");

    expect(status!.nextAction).toBeDefined();
    expect(status!.nextAction!.type).toBe("REVIEW_CHANGES");
  });

  it("should include payout status when available", async () => {
    mockPrisma.tradeInSubmission.findUnique.mockResolvedValue({
      ...mockSubmission,
      status: "COMPLETED",
      items: [],
      payout: { status: "COMPLETED" },
    });

    const status = await getSubmissionStatus("sub-1");

    expect(status!.payoutStatus).toBe("COMPLETED");
  });
});

// ============================================================================
// getCustomerSubmissions
// ============================================================================

describe("getCustomerSubmissions", () => {
  it("should return paginated submissions for customer", async () => {
    mockPrisma.tradeInSubmission.findMany.mockResolvedValue([mockSubmission]);
    mockPrisma.tradeInSubmission.count.mockResolvedValue(1);

    const result = await getCustomerSubmissions("customer-1");

    expect(result.submissions).toHaveLength(1);
    expect(result.total).toBe(1);
  });

  it("should filter by status", async () => {
    mockPrisma.tradeInSubmission.findMany.mockResolvedValue([]);
    mockPrisma.tradeInSubmission.count.mockResolvedValue(0);

    await getCustomerSubmissions("customer-1", { status: "COMPLETED" });

    expect(mockPrisma.tradeInSubmission.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { customerId: "customer-1", status: "COMPLETED" },
      })
    );
  });

  it("should respect pagination options", async () => {
    mockPrisma.tradeInSubmission.findMany.mockResolvedValue([]);
    mockPrisma.tradeInSubmission.count.mockResolvedValue(0);

    await getCustomerSubmissions("customer-1", { limit: 10, offset: 20 });

    expect(mockPrisma.tradeInSubmission.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 10,
        skip: 20,
      })
    );
  });
});
