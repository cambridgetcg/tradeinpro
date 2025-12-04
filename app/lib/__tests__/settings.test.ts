import { describe, it, expect } from "vitest";
import {
  validateMultipliers,
  validateThresholds,
  validateReturnAddress,
  validatePayoutSettings,
  validateContent,
  validateSettings,
  parseReturnAddress,
  DEFAULT_SETTINGS,
  type ReturnAddress,
} from "../settings.server";

describe("validateMultipliers", () => {
  it("should accept valid descending multipliers", () => {
    const result = validateMultipliers({
      conditionMultiplierNM: 0.7,
      conditionMultiplierLP: 0.55,
      conditionMultiplierMP: 0.4,
      conditionMultiplierHP: 0.25,
      conditionMultiplierDMG: 0.1,
    });

    expect(result.valid).toBe(true);
    expect(Object.keys(result.errors)).toHaveLength(0);
  });

  it("should reject when LP >= NM", () => {
    const result = validateMultipliers({
      conditionMultiplierNM: 0.7,
      conditionMultiplierLP: 0.7, // Equal to NM
      conditionMultiplierMP: 0.4,
      conditionMultiplierHP: 0.25,
      conditionMultiplierDMG: 0.1,
    });

    expect(result.valid).toBe(false);
    expect(result.errors.conditionMultiplierLP).toBeDefined();
  });

  it("should reject when MP >= LP", () => {
    const result = validateMultipliers({
      conditionMultiplierNM: 0.7,
      conditionMultiplierLP: 0.55,
      conditionMultiplierMP: 0.6, // Greater than LP
      conditionMultiplierHP: 0.25,
      conditionMultiplierDMG: 0.1,
    });

    expect(result.valid).toBe(false);
    expect(result.errors.conditionMultiplierMP).toBeDefined();
  });

  it("should reject when HP >= MP", () => {
    const result = validateMultipliers({
      conditionMultiplierNM: 0.7,
      conditionMultiplierLP: 0.55,
      conditionMultiplierMP: 0.4,
      conditionMultiplierHP: 0.4, // Equal to MP
      conditionMultiplierDMG: 0.1,
    });

    expect(result.valid).toBe(false);
    expect(result.errors.conditionMultiplierHP).toBeDefined();
  });

  it("should reject when DMG >= HP", () => {
    const result = validateMultipliers({
      conditionMultiplierNM: 0.7,
      conditionMultiplierLP: 0.55,
      conditionMultiplierMP: 0.4,
      conditionMultiplierHP: 0.25,
      conditionMultiplierDMG: 0.3, // Greater than HP
    });

    expect(result.valid).toBe(false);
    expect(result.errors.conditionMultiplierDMG).toBeDefined();
  });

  it("should reject multipliers outside 0.01-1.00 range", () => {
    const result = validateMultipliers({
      conditionMultiplierNM: 1.5, // Too high
      conditionMultiplierLP: 0.55,
      conditionMultiplierMP: 0.4,
      conditionMultiplierHP: 0.25,
      conditionMultiplierDMG: 0.005, // Too low
    });

    expect(result.valid).toBe(false);
    expect(result.errors.conditionMultiplierNM).toBeDefined();
    expect(result.errors.conditionMultiplierDMG).toBeDefined();
  });

  it("should use default values when not provided", () => {
    const result = validateMultipliers({});

    expect(result.valid).toBe(true);
  });

  it("should validate partially provided multipliers against defaults", () => {
    const result = validateMultipliers({
      conditionMultiplierNM: 0.8, // Higher than default
    });

    expect(result.valid).toBe(true);
  });
});

describe("validateThresholds", () => {
  it("should accept valid threshold combination", () => {
    const result = validateThresholds({
      minimumSubmissionValue: 500,
      requiresApprovalAbove: 5000,
      autoApproveBelow: 2000,
      maxItemsPerSubmission: 100,
    });

    expect(result.valid).toBe(true);
    expect(Object.keys(result.errors)).toHaveLength(0);
  });

  it("should reject autoApprove > requiresApproval", () => {
    const result = validateThresholds({
      minimumSubmissionValue: 500,
      requiresApprovalAbove: 2000,
      autoApproveBelow: 5000, // Greater than requiresApproval
      maxItemsPerSubmission: 100,
    });

    expect(result.valid).toBe(false);
    expect(result.errors.autoApproveBelow).toBeDefined();
  });

  it("should reject negative minimum value", () => {
    const result = validateThresholds({
      minimumSubmissionValue: -100,
    });

    expect(result.valid).toBe(false);
    expect(result.errors.minimumSubmissionValue).toBeDefined();
  });

  it("should reject minimum value above £1,000", () => {
    const result = validateThresholds({
      minimumSubmissionValue: 200000, // £2,000 in pence
    });

    expect(result.valid).toBe(false);
    expect(result.errors.minimumSubmissionValue).toBeDefined();
  });

  it("should reject maxItems outside 1-500 range", () => {
    const resultLow = validateThresholds({ maxItemsPerSubmission: 0 });
    const resultHigh = validateThresholds({ maxItemsPerSubmission: 501 });

    expect(resultLow.valid).toBe(false);
    expect(resultHigh.valid).toBe(false);
    expect(resultLow.errors.maxItemsPerSubmission).toBeDefined();
    expect(resultHigh.errors.maxItemsPerSubmission).toBeDefined();
  });

  it("should accept equal autoApprove and requiresApproval thresholds", () => {
    const result = validateThresholds({
      requiresApprovalAbove: 2000,
      autoApproveBelow: 2000,
    });

    expect(result.valid).toBe(true);
  });
});

describe("validateReturnAddress", () => {
  it("should accept null address", () => {
    const result = validateReturnAddress(null);

    expect(result.valid).toBe(true);
  });

  it("should accept complete valid address", () => {
    const address: ReturnAddress = {
      name: "CardForum Ltd",
      company: "CardForum",
      address1: "Unit 5, Trading Estate",
      address2: "Industrial Park",
      city: "Cambridge",
      province: "Cambridgeshire",
      postalCode: "CB1 2AB",
      country: "GB",
      phone: "+44 1234 567890",
    };

    const result = validateReturnAddress(address);

    expect(result.valid).toBe(true);
  });

  it("should accept minimal valid address", () => {
    const address: ReturnAddress = {
      name: "Test",
      address1: "123 Street",
      city: "London",
      postalCode: "W1 1AA",
      country: "GB",
    };

    const result = validateReturnAddress(address);

    expect(result.valid).toBe(true);
  });

  it("should reject missing name", () => {
    const address: ReturnAddress = {
      name: "",
      address1: "123 Street",
      city: "London",
      postalCode: "W1 1AA",
      country: "GB",
    };

    const result = validateReturnAddress(address);

    expect(result.valid).toBe(false);
    expect(result.errors["returnAddress.name"]).toBeDefined();
  });

  it("should reject missing address1", () => {
    const address: ReturnAddress = {
      name: "Test",
      address1: "",
      city: "London",
      postalCode: "W1 1AA",
      country: "GB",
    };

    const result = validateReturnAddress(address);

    expect(result.valid).toBe(false);
    expect(result.errors["returnAddress.address1"]).toBeDefined();
  });

  it("should reject missing city", () => {
    const address: ReturnAddress = {
      name: "Test",
      address1: "123 Street",
      city: "",
      postalCode: "W1 1AA",
      country: "GB",
    };

    const result = validateReturnAddress(address);

    expect(result.valid).toBe(false);
    expect(result.errors["returnAddress.city"]).toBeDefined();
  });

  it("should reject missing postal code", () => {
    const address: ReturnAddress = {
      name: "Test",
      address1: "123 Street",
      city: "London",
      postalCode: "",
      country: "GB",
    };

    const result = validateReturnAddress(address);

    expect(result.valid).toBe(false);
    expect(result.errors["returnAddress.postalCode"]).toBeDefined();
  });

  it("should reject invalid country code format", () => {
    const addressLowercase: ReturnAddress = {
      name: "Test",
      address1: "123 Street",
      city: "London",
      postalCode: "W1 1AA",
      country: "gb", // Lowercase
    };

    const addressLong: ReturnAddress = {
      name: "Test",
      address1: "123 Street",
      city: "London",
      postalCode: "W1 1AA",
      country: "GBR", // 3 letters
    };

    expect(validateReturnAddress(addressLowercase).valid).toBe(false);
    expect(validateReturnAddress(addressLong).valid).toBe(false);
  });
});

describe("validatePayoutSettings", () => {
  it("should accept valid payout settings", () => {
    const result = validatePayoutSettings({
      storeCreditBonusPercent: 10,
      cashPayoutPercent: 100,
    });

    expect(result.valid).toBe(true);
  });

  it("should accept zero store credit bonus", () => {
    const result = validatePayoutSettings({
      storeCreditBonusPercent: 0,
    });

    expect(result.valid).toBe(true);
  });

  it("should accept maximum store credit bonus of 50%", () => {
    const result = validatePayoutSettings({
      storeCreditBonusPercent: 50,
    });

    expect(result.valid).toBe(true);
  });

  it("should reject store credit bonus above 50%", () => {
    const result = validatePayoutSettings({
      storeCreditBonusPercent: 51,
    });

    expect(result.valid).toBe(false);
    expect(result.errors.storeCreditBonusPercent).toBeDefined();
  });

  it("should reject negative store credit bonus", () => {
    const result = validatePayoutSettings({
      storeCreditBonusPercent: -5,
    });

    expect(result.valid).toBe(false);
    expect(result.errors.storeCreditBonusPercent).toBeDefined();
  });

  it("should accept minimum cash payout of 50%", () => {
    const result = validatePayoutSettings({
      cashPayoutPercent: 50,
    });

    expect(result.valid).toBe(true);
  });

  it("should reject cash payout below 50%", () => {
    const result = validatePayoutSettings({
      cashPayoutPercent: 49,
    });

    expect(result.valid).toBe(false);
    expect(result.errors.cashPayoutPercent).toBeDefined();
  });

  it("should reject cash payout above 100%", () => {
    const result = validatePayoutSettings({
      cashPayoutPercent: 101,
    });

    expect(result.valid).toBe(false);
    expect(result.errors.cashPayoutPercent).toBeDefined();
  });
});

describe("validateContent", () => {
  it("should accept valid content", () => {
    const result = validateContent({
      termsAndConditions: "By submitting cards, you agree to our terms.",
      gradingGuideUrl: "https://example.com/grading-guide",
    });

    expect(result.valid).toBe(true);
  });

  it("should accept null values", () => {
    const result = validateContent({
      termsAndConditions: null,
      gradingGuideUrl: null,
    });

    expect(result.valid).toBe(true);
  });

  it("should accept empty strings", () => {
    const result = validateContent({
      termsAndConditions: "",
      gradingGuideUrl: "",
    });

    expect(result.valid).toBe(true);
  });

  it("should reject terms over 10,000 characters", () => {
    const result = validateContent({
      termsAndConditions: "a".repeat(10001),
    });

    expect(result.valid).toBe(false);
    expect(result.errors.termsAndConditions).toBeDefined();
  });

  it("should accept terms exactly 10,000 characters", () => {
    const result = validateContent({
      termsAndConditions: "a".repeat(10000),
    });

    expect(result.valid).toBe(true);
  });

  it("should reject invalid URL format", () => {
    const result = validateContent({
      gradingGuideUrl: "not-a-valid-url",
    });

    expect(result.valid).toBe(false);
    expect(result.errors.gradingGuideUrl).toBeDefined();
  });

  it("should accept valid HTTPS URL", () => {
    const result = validateContent({
      gradingGuideUrl: "https://example.com/guide",
    });

    expect(result.valid).toBe(true);
  });

  it("should accept valid HTTP URL", () => {
    const result = validateContent({
      gradingGuideUrl: "http://example.com/guide",
    });

    expect(result.valid).toBe(true);
  });
});

describe("validateSettings", () => {
  it("should validate all settings together", () => {
    const result = validateSettings({
      conditionMultiplierNM: 0.7,
      conditionMultiplierLP: 0.55,
      conditionMultiplierMP: 0.4,
      conditionMultiplierHP: 0.25,
      conditionMultiplierDMG: 0.1,
      storeCreditBonusPercent: 10,
      cashPayoutPercent: 100,
      minimumSubmissionValue: 500,
      requiresApprovalAbove: 5000,
      autoApproveBelow: 2000,
      maxItemsPerSubmission: 100,
      returnAddress: {
        name: "Test",
        address1: "123 Street",
        city: "London",
        postalCode: "W1 1AA",
        country: "GB",
      },
      termsAndConditions: "Terms here",
      gradingGuideUrl: "https://example.com",
    });

    expect(result.valid).toBe(true);
    expect(Object.keys(result.errors)).toHaveLength(0);
  });

  it("should collect errors from all validators", () => {
    const result = validateSettings({
      conditionMultiplierNM: 0.5,
      conditionMultiplierLP: 0.6, // Greater than NM (invalid)
      storeCreditBonusPercent: 60, // Too high
      autoApproveBelow: 6000,
      requiresApprovalAbove: 5000, // autoApprove > requires (invalid)
      gradingGuideUrl: "invalid-url",
    });

    expect(result.valid).toBe(false);
    expect(Object.keys(result.errors).length).toBeGreaterThan(1);
  });
});

describe("parseReturnAddress", () => {
  it("should return null for null input", () => {
    const result = parseReturnAddress(null);
    expect(result).toBeNull();
  });

  it("should return null for invalid JSON", () => {
    const result = parseReturnAddress("not valid json");
    expect(result).toBeNull();
  });

  it("should parse valid JSON address", () => {
    const address: ReturnAddress = {
      name: "Test",
      address1: "123 Street",
      city: "London",
      postalCode: "W1 1AA",
      country: "GB",
    };

    const result = parseReturnAddress(JSON.stringify(address));

    expect(result).toEqual(address);
  });

  it("should handle empty string", () => {
    const result = parseReturnAddress("");
    expect(result).toBeNull();
  });
});

describe("DEFAULT_SETTINGS", () => {
  it("should have all required default values", () => {
    expect(DEFAULT_SETTINGS.conditionMultiplierNM).toBe(0.7);
    expect(DEFAULT_SETTINGS.conditionMultiplierLP).toBe(0.55);
    expect(DEFAULT_SETTINGS.conditionMultiplierMP).toBe(0.4);
    expect(DEFAULT_SETTINGS.conditionMultiplierHP).toBe(0.25);
    expect(DEFAULT_SETTINGS.conditionMultiplierDMG).toBe(0.1);
    expect(DEFAULT_SETTINGS.storeCreditBonusPercent).toBe(10);
    expect(DEFAULT_SETTINGS.cashPayoutPercent).toBe(100);
    expect(DEFAULT_SETTINGS.minimumSubmissionValue).toBe(500);
    expect(DEFAULT_SETTINGS.requiresApprovalAbove).toBe(5000);
    expect(DEFAULT_SETTINGS.autoApproveBelow).toBe(2000);
    expect(DEFAULT_SETTINGS.maxItemsPerSubmission).toBe(100);
    expect(DEFAULT_SETTINGS.freeShippingMinimum).toBe(5000);
    expect(DEFAULT_SETTINGS.shippingLabelEnabled).toBe(true);
    expect(DEFAULT_SETTINGS.notifyOnSubmission).toBe(true);
    expect(DEFAULT_SETTINGS.notifyOnReceived).toBe(true);
    expect(DEFAULT_SETTINGS.notifyOnGraded).toBe(true);
  });

  it("should have multipliers in descending order", () => {
    expect(DEFAULT_SETTINGS.conditionMultiplierNM).toBeGreaterThan(
      DEFAULT_SETTINGS.conditionMultiplierLP
    );
    expect(DEFAULT_SETTINGS.conditionMultiplierLP).toBeGreaterThan(
      DEFAULT_SETTINGS.conditionMultiplierMP
    );
    expect(DEFAULT_SETTINGS.conditionMultiplierMP).toBeGreaterThan(
      DEFAULT_SETTINGS.conditionMultiplierHP
    );
    expect(DEFAULT_SETTINGS.conditionMultiplierHP).toBeGreaterThan(
      DEFAULT_SETTINGS.conditionMultiplierDMG
    );
  });

  it("should have valid threshold relationship", () => {
    expect(DEFAULT_SETTINGS.autoApproveBelow).toBeLessThanOrEqual(
      DEFAULT_SETTINGS.requiresApprovalAbove
    );
  });
});
