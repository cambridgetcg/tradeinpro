/**
 * Tests for email notification service
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  buildSubmissionCreatedEmail,
  buildSubmissionReceivedEmail,
  buildGradingCompleteEmail,
  buildPayoutIssuedEmail,
  buildReturnRequestedEmail,
  buildMerchantNewSubmissionEmail,
  sendEmail,
  NotificationType,
  shouldSendNotification,
  type SubmissionEmailContext,
} from "../notifications.server";

// Mock prisma
vi.mock("../../db.server", () => ({
  default: {
    customer: {
      findUnique: vi.fn(),
    },
    tradeInItem: {
      count: vi.fn(),
      findMany: vi.fn(),
    },
    tradeInSettings: {
      findFirst: vi.fn(),
    },
  },
}));

import prisma from "../../db.server";

// ============================================================================
// Test Data
// ============================================================================

const baseContext: SubmissionEmailContext = {
  customerName: "John Smith",
  customerEmail: "john@example.com",
  submissionNumber: "TRD-202412-00001",
  quotedTotal: 12500, // £125.00
  itemCount: 5,
  payoutType: "STORE_CREDIT",
};

// ============================================================================
// buildSubmissionCreatedEmail Tests
// ============================================================================

describe("buildSubmissionCreatedEmail", () => {
  it("should create email with correct recipient", () => {
    const email = buildSubmissionCreatedEmail(baseContext);

    expect(email.to).toBe("john@example.com");
  });

  it("should include submission number in subject", () => {
    const email = buildSubmissionCreatedEmail(baseContext);

    expect(email.subject).toContain("TRD-202412-00001");
    expect(email.subject).toContain("Submitted");
  });

  it("should include customer name in greeting", () => {
    const email = buildSubmissionCreatedEmail(baseContext);

    expect(email.text).toContain("Hi John Smith");
    expect(email.html).toContain("Hi John Smith");
  });

  it("should format quoted total correctly", () => {
    const email = buildSubmissionCreatedEmail(baseContext);

    expect(email.text).toContain("£125.00");
    expect(email.html).toContain("£125.00");
  });

  it("should include item count", () => {
    const email = buildSubmissionCreatedEmail(baseContext);

    expect(email.text).toContain("Items: 5");
  });

  it("should include tracking URL", () => {
    const email = buildSubmissionCreatedEmail(baseContext);

    expect(email.text).toContain("track?number=TRD-202412-00001");
    expect(email.html).toContain("track?number=TRD-202412-00001");
  });

  it("should indicate store credit with bonus", () => {
    const ctx = { ...baseContext, bonusAmount: 1250 };
    const email = buildSubmissionCreatedEmail(ctx);

    expect(email.text).toContain("Store Credit");
    expect(email.html).toContain("+£12.50 bonus");
  });

  it("should include next steps instructions", () => {
    const email = buildSubmissionCreatedEmail(baseContext);

    expect(email.text).toContain("Next Steps");
    expect(email.text).toContain("shipping label");
    expect(email.text).toContain("Package your cards");
  });

  it("should have both text and HTML versions", () => {
    const email = buildSubmissionCreatedEmail(baseContext);

    expect(email.text).toBeTruthy();
    expect(email.html).toBeTruthy();
    expect(email.html).toContain("<!DOCTYPE html>");
  });
});

// ============================================================================
// buildSubmissionReceivedEmail Tests
// ============================================================================

describe("buildSubmissionReceivedEmail", () => {
  it("should indicate package received", () => {
    const email = buildSubmissionReceivedEmail(baseContext);

    expect(email.subject).toContain("Received");
    expect(email.text).toContain("received your trade-in");
  });

  it("should mention grading timeline", () => {
    const email = buildSubmissionReceivedEmail(baseContext);

    expect(email.text).toContain("1-3 business days");
    expect(email.html).toContain("1-3 business days");
  });

  it("should include tracking link", () => {
    const email = buildSubmissionReceivedEmail(baseContext);

    expect(email.html).toContain("Track Your Submission");
  });
});

// ============================================================================
// buildGradingCompleteEmail Tests
// ============================================================================

describe("buildGradingCompleteEmail", () => {
  describe("no adjustments", () => {
    it("should indicate all items verified", () => {
      const email = buildGradingCompleteEmail({
        ...baseContext,
        finalTotal: 12500,
        hasAdjustments: false,
      });

      expect(email.text).toContain("All items matched");
      expect(email.html).toContain("All items matched");
    });

    it("should not include review required in subject", () => {
      const email = buildGradingCompleteEmail({
        ...baseContext,
        finalTotal: 12500,
        hasAdjustments: false,
      });

      expect(email.subject).not.toContain("Review Required");
    });

    it("should mention payout being processed", () => {
      const email = buildGradingCompleteEmail({
        ...baseContext,
        finalTotal: 12500,
        hasAdjustments: false,
      });

      expect(email.text).toContain("payout is being processed");
    });
  });

  describe("with adjustments", () => {
    const adjustedItems = [
      { name: "Charizard VMAX", originalCondition: "NM", newCondition: "LP" },
      { name: "Pikachu V", originalCondition: "LP", newCondition: "MP" },
    ];

    it("should indicate review required in subject", () => {
      const email = buildGradingCompleteEmail({
        ...baseContext,
        finalTotal: 10000, // Lower than quoted
        hasAdjustments: true,
        adjustedItems,
      });

      expect(email.subject).toContain("Review Required");
    });

    it("should list adjusted items", () => {
      const email = buildGradingCompleteEmail({
        ...baseContext,
        finalTotal: 10000,
        hasAdjustments: true,
        adjustedItems,
      });

      expect(email.text).toContain("Charizard VMAX");
      expect(email.text).toContain("NM → LP");
      expect(email.html).toContain("Charizard VMAX");
    });

    it("should show original and final totals", () => {
      const email = buildGradingCompleteEmail({
        ...baseContext,
        quotedTotal: 12500,
        finalTotal: 10000,
        hasAdjustments: true,
        adjustedItems,
      });

      expect(email.text).toContain("£125.00"); // Original
      expect(email.text).toContain("£100.00"); // Final
    });

    it("should show price difference", () => {
      const email = buildGradingCompleteEmail({
        ...baseContext,
        quotedTotal: 12500,
        finalTotal: 10000,
        hasAdjustments: true,
        adjustedItems,
      });

      expect(email.text).toContain("-£25.00");
    });

    it("should mention 7 day approval deadline", () => {
      const email = buildGradingCompleteEmail({
        ...baseContext,
        finalTotal: 10000,
        hasAdjustments: true,
        adjustedItems,
      });

      expect(email.text).toContain("7 days");
      expect(email.html).toContain("7 days");
    });

    it("should have Review & Approve CTA", () => {
      const email = buildGradingCompleteEmail({
        ...baseContext,
        finalTotal: 10000,
        hasAdjustments: true,
        adjustedItems,
      });

      expect(email.html).toContain("Review & Approve");
    });
  });

  describe("price increased (rare)", () => {
    it("should show positive difference", () => {
      const email = buildGradingCompleteEmail({
        ...baseContext,
        quotedTotal: 10000,
        finalTotal: 12500,
        hasAdjustments: true,
        adjustedItems: [
          { name: "Charizard", originalCondition: "LP", newCondition: "NM" },
        ],
      });

      expect(email.text).toContain("+£25.00");
    });
  });
});

// ============================================================================
// buildPayoutIssuedEmail Tests
// ============================================================================

describe("buildPayoutIssuedEmail", () => {
  it("should show payout amount prominently", () => {
    const email = buildPayoutIssuedEmail({
      ...baseContext,
      payoutAmount: 13750, // With bonus
    });

    expect(email.text).toContain("£137.50");
    expect(email.html).toContain("£137.50");
  });

  it("should include gift card code for store credit", () => {
    const email = buildPayoutIssuedEmail({
      ...baseContext,
      payoutAmount: 13750,
      giftCardCode: "XXXX-XXXX-XXXX-ABCD",
    });

    expect(email.text).toContain("XXXX-XXXX-XXXX-ABCD");
    expect(email.html).toContain("XXXX-XXXX-XXXX-ABCD");
  });

  it("should mention gift card never expires", () => {
    const email = buildPayoutIssuedEmail({
      ...baseContext,
      payoutAmount: 13750,
      giftCardCode: "XXXX-XXXX-XXXX-ABCD",
    });

    expect(email.text).toContain("never expires");
  });

  it("should include bank reference for bank transfer", () => {
    const email = buildPayoutIssuedEmail({
      ...baseContext,
      payoutType: "BANK",
      payoutAmount: 12500,
      bankReference: "TRD202412001",
    });

    expect(email.text).toContain("TRD202412001");
    expect(email.html).toContain("TRD202412001");
  });

  it("should mention 2-3 business days for bank transfer", () => {
    const email = buildPayoutIssuedEmail({
      ...baseContext,
      payoutType: "BANK",
      payoutAmount: 12500,
      bankReference: "TRD202412001",
    });

    expect(email.text).toContain("2-3 business days");
  });

  it("should have Shop Now CTA", () => {
    const email = buildPayoutIssuedEmail({
      ...baseContext,
      payoutAmount: 13750,
    });

    expect(email.html).toContain("Shop Now");
  });
});

// ============================================================================
// buildReturnRequestedEmail Tests
// ============================================================================

describe("buildReturnRequestedEmail", () => {
  it("should acknowledge return request", () => {
    const email = buildReturnRequestedEmail(
      baseContext,
      "Price difference too high"
    );

    expect(email.subject).toContain("Return Requested");
    expect(email.text).toContain("received your request to return");
  });

  it("should include customer reason", () => {
    const reason = "Price difference too high";
    const email = buildReturnRequestedEmail(baseContext, reason);

    expect(email.text).toContain(reason);
    expect(email.html).toContain(reason);
  });

  it("should mention 2-3 day shipping timeline", () => {
    const email = buildReturnRequestedEmail(baseContext, "Changed mind");

    expect(email.text).toContain("2-3 business days");
    expect(email.html).toContain("2-3 business days");
  });

  it("should include submission number", () => {
    const email = buildReturnRequestedEmail(baseContext, "Test reason");

    expect(email.text).toContain("TRD-202412-00001");
  });
});

// ============================================================================
// buildMerchantNewSubmissionEmail Tests
// ============================================================================

describe("buildMerchantNewSubmissionEmail", () => {
  it("should have [CardForum] prefix in subject", () => {
    const email = buildMerchantNewSubmissionEmail(baseContext);

    expect(email.subject).toContain("[CardForum]");
    expect(email.subject).toContain("New Trade-In");
  });

  it("should include customer email", () => {
    const email = buildMerchantNewSubmissionEmail(baseContext);

    expect(email.text).toContain("john@example.com");
    expect(email.html).toContain("john@example.com");
  });

  it("should include submission details", () => {
    const email = buildMerchantNewSubmissionEmail(baseContext);

    expect(email.text).toContain("TRD-202412-00001");
    expect(email.text).toContain("5"); // item count
    expect(email.text).toContain("£125.00");
  });

  it("should include admin link", () => {
    const email = buildMerchantNewSubmissionEmail(baseContext);

    expect(email.text).toContain("/app/trade-ins");
    expect(email.html).toContain("View in Admin");
  });
});

// ============================================================================
// sendEmail Tests
// ============================================================================

describe("sendEmail", () => {
  const originalEnv = process.env;
  // sendEmail now uses logger.debug which calls console.debug
  const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});

  beforeEach(() => {
    process.env = { ...originalEnv, NODE_ENV: "development" };
    debugSpy.mockClear();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("should log email in development mode", async () => {
    const email = buildSubmissionCreatedEmail(baseContext);
    const result = await sendEmail(email);

    expect(result.success).toBe(true);
    // Logger uses console.debug in development mode
    expect(debugSpy).toHaveBeenCalled();
  });

  it("should return success in development", async () => {
    const email = buildSubmissionCreatedEmail(baseContext);
    const result = await sendEmail(email);

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("should log in production (pending provider integration)", async () => {
    process.env.NODE_ENV = "production";

    const email = buildSubmissionCreatedEmail(baseContext);
    const result = await sendEmail(email);

    expect(result.success).toBe(true);
  });
});

// ============================================================================
// shouldSendNotification Tests
// ============================================================================

describe("shouldSendNotification", () => {
  beforeEach(() => {
    vi.mocked(prisma.tradeInSettings.findFirst).mockReset();
  });

  it("should return true by default for submission created", async () => {
    vi.mocked(prisma.tradeInSettings.findFirst).mockResolvedValue(null);

    const result = await shouldSendNotification(NotificationType.SUBMISSION_CREATED);
    expect(result).toBe(true);
  });

  it("should return true by default for grading complete", async () => {
    vi.mocked(prisma.tradeInSettings.findFirst).mockResolvedValue(null);

    const result = await shouldSendNotification(NotificationType.GRADING_COMPLETE);
    expect(result).toBe(true);
  });

  it("should respect notifyOnSubmission setting", async () => {
    vi.mocked(prisma.tradeInSettings.findFirst).mockResolvedValue({
      id: "1",
      shop: null,
      notifyOnSubmission: false,
      notifyOnReceived: true,
      notifyOnGraded: true,
      minimumSubmissionValue: 500,
      requiresApprovalAbove: 5000,
      autoApproveBelow: 2000,
      maxItemsPerSubmission: 100,
      storeCreditBonusPercent: 10,
      cashPayoutPercent: 100,
      conditionMultiplierNM: 0.7,
      conditionMultiplierLP: 0.55,
      conditionMultiplierMP: 0.4,
      conditionMultiplierHP: 0.25,
      conditionMultiplierDMG: 0.1,
      freeShippingMinimum: 5000,
      shippingLabelEnabled: true,
      returnAddress: null,
      royalMailEnabled: false,
      royalMailService: "TPN",
      termsAndConditions: null,
      gradingGuideUrl: null,
      ctaTitle: null,
      ctaDescription: null,
      ctaButtonText: null,
      ctaButtonLink: null,
      ctaShowFeatures: true,
      ctaFeature1Title: null,
      ctaFeature1Desc: null,
      ctaFeature2Title: null,
      ctaFeature2Desc: null,
      ctaFeature3Title: null,
      ctaFeature3Desc: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await shouldSendNotification(NotificationType.SUBMISSION_CREATED);
    expect(result).toBe(false);
  });

  it("should respect notifyOnReceived setting", async () => {
    vi.mocked(prisma.tradeInSettings.findFirst).mockResolvedValue({
      id: "1",
      shop: null,
      notifyOnSubmission: true,
      notifyOnReceived: false,
      notifyOnGraded: true,
      minimumSubmissionValue: 500,
      requiresApprovalAbove: 5000,
      autoApproveBelow: 2000,
      maxItemsPerSubmission: 100,
      storeCreditBonusPercent: 10,
      cashPayoutPercent: 100,
      conditionMultiplierNM: 0.7,
      conditionMultiplierLP: 0.55,
      conditionMultiplierMP: 0.4,
      conditionMultiplierHP: 0.25,
      conditionMultiplierDMG: 0.1,
      freeShippingMinimum: 5000,
      shippingLabelEnabled: true,
      returnAddress: null,
      royalMailEnabled: false,
      royalMailService: "TPN",
      termsAndConditions: null,
      gradingGuideUrl: null,
      ctaTitle: null,
      ctaDescription: null,
      ctaButtonText: null,
      ctaButtonLink: null,
      ctaShowFeatures: true,
      ctaFeature1Title: null,
      ctaFeature1Desc: null,
      ctaFeature2Title: null,
      ctaFeature2Desc: null,
      ctaFeature3Title: null,
      ctaFeature3Desc: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await shouldSendNotification(NotificationType.SUBMISSION_RECEIVED);
    expect(result).toBe(false);
  });

  it("should respect notifyOnGraded setting", async () => {
    vi.mocked(prisma.tradeInSettings.findFirst).mockResolvedValue({
      id: "1",
      shop: null,
      notifyOnSubmission: true,
      notifyOnReceived: true,
      notifyOnGraded: false,
      minimumSubmissionValue: 500,
      requiresApprovalAbove: 5000,
      autoApproveBelow: 2000,
      maxItemsPerSubmission: 100,
      storeCreditBonusPercent: 10,
      cashPayoutPercent: 100,
      conditionMultiplierNM: 0.7,
      conditionMultiplierLP: 0.55,
      conditionMultiplierMP: 0.4,
      conditionMultiplierHP: 0.25,
      conditionMultiplierDMG: 0.1,
      freeShippingMinimum: 5000,
      shippingLabelEnabled: true,
      returnAddress: null,
      royalMailEnabled: false,
      royalMailService: "TPN",
      termsAndConditions: null,
      gradingGuideUrl: null,
      ctaTitle: null,
      ctaDescription: null,
      ctaButtonText: null,
      ctaButtonLink: null,
      ctaShowFeatures: true,
      ctaFeature1Title: null,
      ctaFeature1Desc: null,
      ctaFeature2Title: null,
      ctaFeature2Desc: null,
      ctaFeature3Title: null,
      ctaFeature3Desc: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await shouldSendNotification(NotificationType.GRADING_COMPLETE);
    expect(result).toBe(false);
  });

  it("should always allow payout notifications", async () => {
    vi.mocked(prisma.tradeInSettings.findFirst).mockResolvedValue({
      id: "1",
      shop: null,
      notifyOnSubmission: false,
      notifyOnReceived: false,
      notifyOnGraded: false,
      minimumSubmissionValue: 500,
      requiresApprovalAbove: 5000,
      autoApproveBelow: 2000,
      maxItemsPerSubmission: 100,
      storeCreditBonusPercent: 10,
      cashPayoutPercent: 100,
      conditionMultiplierNM: 0.7,
      conditionMultiplierLP: 0.55,
      conditionMultiplierMP: 0.4,
      conditionMultiplierHP: 0.25,
      conditionMultiplierDMG: 0.1,
      freeShippingMinimum: 5000,
      shippingLabelEnabled: true,
      returnAddress: null,
      royalMailEnabled: false,
      royalMailService: "TPN",
      termsAndConditions: null,
      gradingGuideUrl: null,
      ctaTitle: null,
      ctaDescription: null,
      ctaButtonText: null,
      ctaButtonLink: null,
      ctaShowFeatures: true,
      ctaFeature1Title: null,
      ctaFeature1Desc: null,
      ctaFeature2Title: null,
      ctaFeature2Desc: null,
      ctaFeature3Title: null,
      ctaFeature3Desc: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await shouldSendNotification(NotificationType.PAYOUT_ISSUED);
    expect(result).toBe(true);
  });
});

// ============================================================================
// HTML Template Tests
// ============================================================================

describe("HTML Email Templates", () => {
  it("should have valid HTML structure", () => {
    const email = buildSubmissionCreatedEmail(baseContext);

    expect(email.html).toContain("<!DOCTYPE html>");
    expect(email.html).toContain("<html>");
    expect(email.html).toContain("</html>");
    expect(email.html).toContain("<head>");
    expect(email.html).toContain("<body");
  });

  it("should include CardForum branding", () => {
    const email = buildSubmissionCreatedEmail(baseContext);

    expect(email.html).toContain("CardForum");
    expect(email.html).toContain("Trading Card Trade-Ins");
  });

  it("should include footer with contact info", () => {
    const email = buildSubmissionCreatedEmail(baseContext);

    expect(email.html).toContain("support@cardforum.co.uk");
    expect(email.html).toContain("Cambridge, UK");
  });

  it("should have responsive viewport meta tag", () => {
    const email = buildSubmissionCreatedEmail(baseContext);

    expect(email.html).toContain('name="viewport"');
    expect(email.html).toContain("width=device-width");
  });

  it("should use inline styles (email compatibility)", () => {
    const email = buildSubmissionCreatedEmail(baseContext);

    // Should have inline styles, not external CSS
    expect(email.html).toContain('style="');
    expect(email.html).not.toContain('<link rel="stylesheet"');
  });
});
