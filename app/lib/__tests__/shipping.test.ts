/**
 * Tests for shipping label generation and instructions
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getShippingSettings,
  updateReturnAddress,
  validateReturnAddress,
  formatAddress,
  generateShippingLabel,
  generateTrackingNumber,
  qualifiesForFreeShipping,
  getSelfShipInstructions,
  updateTrackingNumber,
  markAsReceived,
  generateLabelHTML,
  generatePackingSlipHTML,
} from "../shipping.server";

// Mock Prisma
vi.mock("../../db.server", () => ({
  default: {
    tradeInSettings: {
      findFirst: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
    tradeInSubmission: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    submissionNote: {
      create: vi.fn(),
    },
  },
}));

import prisma from "../../db.server";

const mockPrisma = prisma as unknown as {
  tradeInSettings: {
    findFirst: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
  tradeInSubmission: {
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  submissionNote: {
    create: ReturnType<typeof vi.fn>;
  };
};

// Sample data
const mockReturnAddress = {
  name: "CardForum Ltd",
  company: "CardForum Trading Cards",
  address1: "Unit 5, Trading Estate",
  address2: "Industrial Park",
  city: "Cambridge",
  province: "Cambridgeshire",
  postalCode: "CB1 2AB",
  country: "GB",
  phone: "+44 1234 567890",
};

const mockSettings = {
  id: "settings-1",
  shippingLabelEnabled: true,
  freeShippingMinimum: 5000,
  returnAddress: JSON.stringify(mockReturnAddress),
};

const mockSubmission = {
  id: "sub-1",
  submissionNumber: "TRD-202412-00001",
  customerId: "customer-1",
  status: "SUBMITTED",
  payoutType: "STORE_CREDIT",
  quotedTotal: 5000,
  bonusAmount: 500,
  shippingMethod: null,
  trackingNumber: null,
  labelUrl: null,
  createdAt: new Date(),
  items: [
    {
      id: "item-1",
      cardName: "Charizard VMAX",
      setName: "Sword & Shield",
      variant: null,
      conditionClaimed: "NM",
      quantity: 1,
      quotedPrice: 5000,
    },
  ],
  customer: {
    id: "customer-1",
    firstName: "John",
    lastName: "Doe",
    email: "john@example.com",
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.tradeInSettings.findFirst.mockResolvedValue(mockSettings);
});

// ============================================================================
// getShippingSettings
// ============================================================================

describe("getShippingSettings", () => {
  it("should return settings from database", async () => {
    const settings = await getShippingSettings();

    expect(settings.shippingLabelEnabled).toBe(true);
    expect(settings.freeShippingMinimum).toBe(5000);
    expect(settings.returnAddress).toEqual(mockReturnAddress);
  });

  it("should return defaults when no settings exist", async () => {
    mockPrisma.tradeInSettings.findFirst.mockResolvedValue(null);

    const settings = await getShippingSettings();

    expect(settings.shippingLabelEnabled).toBe(true);
    expect(settings.freeShippingMinimum).toBe(5000);
    expect(settings.returnAddress).toBeNull();
  });

  it("should handle invalid JSON in returnAddress", async () => {
    mockPrisma.tradeInSettings.findFirst.mockResolvedValue({
      ...mockSettings,
      returnAddress: "invalid-json",
    });

    const settings = await getShippingSettings();

    expect(settings.returnAddress).toBeNull();
  });
});

// ============================================================================
// validateReturnAddress
// ============================================================================

describe("validateReturnAddress", () => {
  it("should accept complete valid address", () => {
    const result = validateReturnAddress(mockReturnAddress);

    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("should reject missing name", () => {
    const { name, ...addressWithoutName } = mockReturnAddress;
    const result = validateReturnAddress(addressWithoutName);

    expect(result.valid).toBe(false);
    expect(result.error).toBe("Name is required");
  });

  it("should reject missing address1", () => {
    const { address1, ...addressWithoutLine1 } = mockReturnAddress;
    const result = validateReturnAddress(addressWithoutLine1);

    expect(result.valid).toBe(false);
    expect(result.error).toBe("Address line 1 is required");
  });

  it("should reject missing city", () => {
    const { city, ...addressWithoutCity } = mockReturnAddress;
    const result = validateReturnAddress(addressWithoutCity);

    expect(result.valid).toBe(false);
    expect(result.error).toBe("City is required");
  });

  it("should reject missing postalCode", () => {
    const { postalCode, ...addressWithoutPostal } = mockReturnAddress;
    const result = validateReturnAddress(addressWithoutPostal);

    expect(result.valid).toBe(false);
    expect(result.error).toBe("Postal code is required");
  });

  it("should reject missing country", () => {
    const { country, ...addressWithoutCountry } = mockReturnAddress;
    const result = validateReturnAddress(addressWithoutCountry);

    expect(result.valid).toBe(false);
    expect(result.error).toBe("Country is required");
  });

  it("should reject invalid country code format", () => {
    const result = validateReturnAddress({
      ...mockReturnAddress,
      country: "United Kingdom",
    });

    expect(result.valid).toBe(false);
    expect(result.error).toContain("2-letter ISO code");
  });

  it("should reject empty strings", () => {
    const result = validateReturnAddress({
      ...mockReturnAddress,
      name: "   ",
    });

    expect(result.valid).toBe(false);
    expect(result.error).toBe("Name is required");
  });
});

// ============================================================================
// formatAddress
// ============================================================================

describe("formatAddress", () => {
  it("should format complete address", () => {
    const lines = formatAddress(mockReturnAddress);

    expect(lines).toContain("CardForum Ltd");
    expect(lines).toContain("CardForum Trading Cards");
    expect(lines).toContain("Unit 5, Trading Estate");
    expect(lines.some((l) => l.includes("Cambridge"))).toBe(true);
    expect(lines).toContain("United Kingdom");
  });

  it("should handle address without optional fields", () => {
    const minimalAddress = {
      name: "Test",
      address1: "123 Main St",
      city: "London",
      postalCode: "SW1A 1AA",
      country: "GB",
    };

    const lines = formatAddress(minimalAddress);

    expect(lines).toHaveLength(4);
    expect(lines).toContain("Test");
    expect(lines).toContain("123 Main St");
  });

  it("should return placeholder for null address", () => {
    const lines = formatAddress(null);

    expect(lines).toEqual(["No return address configured"]);
  });
});

// ============================================================================
// updateReturnAddress
// ============================================================================

describe("updateReturnAddress", () => {
  it("should update existing settings", async () => {
    await updateReturnAddress(mockReturnAddress);

    expect(mockPrisma.tradeInSettings.update).toHaveBeenCalledWith({
      where: { id: "settings-1" },
      data: { returnAddress: JSON.stringify(mockReturnAddress) },
    });
  });

  it("should create settings if none exist", async () => {
    mockPrisma.tradeInSettings.findFirst.mockResolvedValue(null);

    await updateReturnAddress(mockReturnAddress);

    expect(mockPrisma.tradeInSettings.create).toHaveBeenCalledWith({
      data: { returnAddress: JSON.stringify(mockReturnAddress) },
    });
  });

  it("should throw error for invalid address", async () => {
    await expect(
      updateReturnAddress({ name: "" } as any)
    ).rejects.toThrow("Name is required");
  });
});

// ============================================================================
// generateTrackingNumber
// ============================================================================

describe("generateTrackingNumber", () => {
  it("should generate unique tracking number", () => {
    const tracking1 = generateTrackingNumber("TRD-202412-00001");
    const tracking2 = generateTrackingNumber("TRD-202412-00001");

    expect(tracking1).toMatch(/^CF[A-Z0-9]+$/);
    expect(tracking2).toMatch(/^CF[A-Z0-9]+$/);
    expect(tracking1).not.toBe(tracking2);
  });

  it("should start with CF prefix", () => {
    const tracking = generateTrackingNumber("TRD-202412-00001");

    expect(tracking.startsWith("CF")).toBe(true);
  });
});

// ============================================================================
// generateShippingLabel
// ============================================================================

describe("generateShippingLabel", () => {
  beforeEach(() => {
    mockPrisma.tradeInSubmission.findUnique.mockResolvedValue(mockSubmission);
    mockPrisma.tradeInSubmission.update.mockResolvedValue({
      ...mockSubmission,
      shippingMethod: "PREPAID",
    });
  });

  it("should generate label for valid submission", async () => {
    const label = await generateShippingLabel({ submissionId: "sub-1" });

    expect(label.labelUrl).toContain("sub-1");
    expect(label.trackingNumber).toMatch(/^CF/);
    expect(label.carrier).toBe("Royal Mail Tracked");
    expect(label.instructions).toHaveLength(4);
  });

  it("should update submission with tracking info", async () => {
    await generateShippingLabel({ submissionId: "sub-1" });

    expect(mockPrisma.tradeInSubmission.update).toHaveBeenCalledWith({
      where: { id: "sub-1" },
      data: expect.objectContaining({
        shippingMethod: "PREPAID",
        trackingNumber: expect.stringMatching(/^CF/),
        labelUrl: expect.stringContaining("sub-1"),
      }),
    });
  });

  it("should throw error for non-existent submission", async () => {
    mockPrisma.tradeInSubmission.findUnique.mockResolvedValue(null);

    await expect(
      generateShippingLabel({ submissionId: "non-existent" })
    ).rejects.toThrow("Submission not found");
  });

  it("should throw error for non-SUBMITTED status", async () => {
    mockPrisma.tradeInSubmission.findUnique.mockResolvedValue({
      ...mockSubmission,
      status: "DRAFT",
    });

    await expect(
      generateShippingLabel({ submissionId: "sub-1" })
    ).rejects.toThrow("Shipping label can only be generated for submitted orders");
  });

  it("should throw error if no return address configured", async () => {
    mockPrisma.tradeInSettings.findFirst.mockResolvedValue({
      ...mockSettings,
      returnAddress: null,
    });

    await expect(
      generateShippingLabel({ submissionId: "sub-1" })
    ).rejects.toThrow("Return address not configured");
  });
});

// ============================================================================
// qualifiesForFreeShipping
// ============================================================================

describe("qualifiesForFreeShipping", () => {
  it("should return true when above minimum", async () => {
    mockPrisma.tradeInSubmission.findUnique.mockResolvedValue({
      ...mockSubmission,
      quotedTotal: 6000,
    });

    const result = await qualifiesForFreeShipping("sub-1");

    expect(result.qualifies).toBe(true);
    expect(result.minimum).toBe(5000);
    expect(result.current).toBe(6000);
  });

  it("should return false when below minimum", async () => {
    mockPrisma.tradeInSubmission.findUnique.mockResolvedValue({
      ...mockSubmission,
      quotedTotal: 3000,
    });

    const result = await qualifiesForFreeShipping("sub-1");

    expect(result.qualifies).toBe(false);
    expect(result.current).toBe(3000);
  });

  it("should return true when exactly at minimum", async () => {
    mockPrisma.tradeInSubmission.findUnique.mockResolvedValue({
      ...mockSubmission,
      quotedTotal: 5000,
    });

    const result = await qualifiesForFreeShipping("sub-1");

    expect(result.qualifies).toBe(true);
  });

  it("should throw error for non-existent submission", async () => {
    mockPrisma.tradeInSubmission.findUnique.mockResolvedValue(null);

    await expect(qualifiesForFreeShipping("non-existent")).rejects.toThrow(
      "Submission not found"
    );
  });
});

// ============================================================================
// getSelfShipInstructions
// ============================================================================

describe("getSelfShipInstructions", () => {
  beforeEach(() => {
    mockPrisma.tradeInSubmission.findUnique.mockResolvedValue(mockSubmission);
  });

  it("should return formatted instructions", async () => {
    const instructions = await getSelfShipInstructions("sub-1");

    expect(instructions.submissionNumber).toBe("TRD-202412-00001");
    expect(instructions.quotedTotal).toBe(5000);
    expect(instructions.itemCount).toBe(1);
    expect(instructions.instructions).toHaveLength(4);
    expect(instructions.packingTips).toHaveLength(5);
    expect(instructions.importantNotes).toHaveLength(4);
  });

  it("should include return address", async () => {
    const instructions = await getSelfShipInstructions("sub-1");

    expect(instructions.returnAddress).toEqual(mockReturnAddress);
  });

  it("should update submission to SELF_SHIP method", async () => {
    await getSelfShipInstructions("sub-1");

    expect(mockPrisma.tradeInSubmission.update).toHaveBeenCalledWith({
      where: { id: "sub-1" },
      data: { shippingMethod: "SELF_SHIP" },
    });
  });

  it("should not update if shipping method already set", async () => {
    mockPrisma.tradeInSubmission.findUnique.mockResolvedValue({
      ...mockSubmission,
      shippingMethod: "PREPAID",
    });

    await getSelfShipInstructions("sub-1");

    expect(mockPrisma.tradeInSubmission.update).not.toHaveBeenCalled();
  });

  it("should throw error for non-existent submission", async () => {
    mockPrisma.tradeInSubmission.findUnique.mockResolvedValue(null);

    await expect(getSelfShipInstructions("non-existent")).rejects.toThrow(
      "Submission not found"
    );
  });

  it("should include submission number in instructions", async () => {
    const instructions = await getSelfShipInstructions("sub-1");

    expect(
      instructions.instructions.some((i) =>
        i.includes("TRD-202412-00001")
      )
    ).toBe(true);
  });
});

// ============================================================================
// updateTrackingNumber
// ============================================================================

describe("updateTrackingNumber", () => {
  beforeEach(() => {
    mockPrisma.tradeInSubmission.findUnique.mockResolvedValue(mockSubmission);
    mockPrisma.tradeInSubmission.update.mockResolvedValue({
      ...mockSubmission,
      trackingNumber: "TRACK123",
    });
  });

  it("should update tracking number", async () => {
    await updateTrackingNumber("sub-1", "TRACK123");

    expect(mockPrisma.tradeInSubmission.update).toHaveBeenCalledWith({
      where: { id: "sub-1" },
      data: {
        trackingNumber: "TRACK123",
        status: "IN_TRANSIT",
      },
    });
  });

  it("should create system note", async () => {
    await updateTrackingNumber("sub-1", "TRACK123", "Royal Mail");

    expect(mockPrisma.submissionNote.create).toHaveBeenCalledWith({
      data: {
        submissionId: "sub-1",
        authorType: "SYSTEM",
        message: "Tracking number updated: TRACK123 (Royal Mail)",
      },
    });
  });

  it("should throw error for invalid status", async () => {
    mockPrisma.tradeInSubmission.findUnique.mockResolvedValue({
      ...mockSubmission,
      status: "GRADING",
    });

    await expect(updateTrackingNumber("sub-1", "TRACK123")).rejects.toThrow(
      "Cannot update tracking for this submission status"
    );
  });

  it("should allow update for IN_TRANSIT status", async () => {
    mockPrisma.tradeInSubmission.findUnique.mockResolvedValue({
      ...mockSubmission,
      status: "IN_TRANSIT",
    });

    await expect(
      updateTrackingNumber("sub-1", "TRACK123")
    ).resolves.not.toThrow();
  });
});

// ============================================================================
// markAsReceived
// ============================================================================

describe("markAsReceived", () => {
  beforeEach(() => {
    mockPrisma.tradeInSubmission.findUnique.mockResolvedValue(mockSubmission);
    mockPrisma.tradeInSubmission.update.mockResolvedValue({
      ...mockSubmission,
      status: "RECEIVED",
    });
  });

  it("should mark submission as received", async () => {
    await markAsReceived("sub-1");

    expect(mockPrisma.tradeInSubmission.update).toHaveBeenCalledWith({
      where: { id: "sub-1" },
      data: {
        status: "RECEIVED",
        receivedAt: expect.any(Date),
      },
    });
  });

  it("should throw error for non-existent submission", async () => {
    mockPrisma.tradeInSubmission.findUnique.mockResolvedValue(null);

    await expect(markAsReceived("non-existent")).rejects.toThrow(
      "Submission not found"
    );
  });

  it("should throw error for invalid status", async () => {
    mockPrisma.tradeInSubmission.findUnique.mockResolvedValue({
      ...mockSubmission,
      status: "COMPLETED",
    });

    await expect(markAsReceived("sub-1")).rejects.toThrow(
      "Cannot mark as received from current status"
    );
  });

  it("should work for IN_TRANSIT status", async () => {
    mockPrisma.tradeInSubmission.findUnique.mockResolvedValue({
      ...mockSubmission,
      status: "IN_TRANSIT",
    });

    await expect(markAsReceived("sub-1")).resolves.not.toThrow();
  });
});

// ============================================================================
// generateLabelHTML
// ============================================================================

describe("generateLabelHTML", () => {
  beforeEach(() => {
    mockPrisma.tradeInSubmission.findUnique.mockResolvedValue(mockSubmission);
  });

  it("should generate valid HTML", async () => {
    const html = await generateLabelHTML("sub-1");

    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("TRD-202412-00001");
    expect(html).toContain("CardForum Ltd");
  });

  it("should include submission number prominently", async () => {
    const html = await generateLabelHTML("sub-1");

    expect(html).toContain("TRD-202412-00001");
    expect(html).toContain("Reference Number");
  });

  it("should include return address", async () => {
    const html = await generateLabelHTML("sub-1");

    expect(html).toContain("CardForum Ltd");
    expect(html).toContain("Unit 5, Trading Estate");
    expect(html).toContain("Cambridge");
  });

  it("should throw error if no return address configured", async () => {
    mockPrisma.tradeInSettings.findFirst.mockResolvedValue({
      ...mockSettings,
      returnAddress: null,
    });

    await expect(generateLabelHTML("sub-1")).rejects.toThrow(
      "Return address not configured"
    );
  });

  it("should include tracking number if available", async () => {
    mockPrisma.tradeInSubmission.findUnique.mockResolvedValue({
      ...mockSubmission,
      trackingNumber: "CF123ABC",
    });

    const html = await generateLabelHTML("sub-1");

    expect(html).toContain("CF123ABC");
  });
});

// ============================================================================
// generatePackingSlipHTML
// ============================================================================

describe("generatePackingSlipHTML", () => {
  beforeEach(() => {
    mockPrisma.tradeInSubmission.findUnique.mockResolvedValue(mockSubmission);
  });

  it("should generate valid HTML", async () => {
    const html = await generatePackingSlipHTML("sub-1");

    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("Packing Slip");
    expect(html).toContain("TRD-202412-00001");
  });

  it("should include customer information", async () => {
    const html = await generatePackingSlipHTML("sub-1");

    expect(html).toContain("John");
    expect(html).toContain("Doe");
    expect(html).toContain("john@example.com");
  });

  it("should list all items", async () => {
    const html = await generatePackingSlipHTML("sub-1");

    expect(html).toContain("Charizard VMAX");
    expect(html).toContain("Sword & Shield");
    expect(html).toContain("NM");
  });

  it("should show totals", async () => {
    const html = await generatePackingSlipHTML("sub-1");

    expect(html).toContain("Quoted Total");
    expect(html).toContain("£50.00");
  });

  it("should show bonus for store credit", async () => {
    const html = await generatePackingSlipHTML("sub-1");

    expect(html).toContain("Store Credit Bonus");
    expect(html).toContain("£5.00");
  });

  it("should not show bonus for bank transfer", async () => {
    mockPrisma.tradeInSubmission.findUnique.mockResolvedValue({
      ...mockSubmission,
      payoutType: "BANK",
      bonusAmount: 0,
    });

    const html = await generatePackingSlipHTML("sub-1");

    expect(html).not.toContain("Store Credit Bonus");
  });

  it("should throw error for non-existent submission", async () => {
    mockPrisma.tradeInSubmission.findUnique.mockResolvedValue(null);

    await expect(generatePackingSlipHTML("non-existent")).rejects.toThrow(
      "Submission not found"
    );
  });
});
