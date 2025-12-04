import { describe, it, expect } from "vitest";
import {
  SubmissionStatus,
  SubmissionStatusLabels,
  SubmissionStatusTones,
  ItemStatus,
  Condition,
  ConditionLabels,
  DefaultConditionMultipliers,
  ConditionOrder,
  PayoutType,
  PayoutStatus,
  ShippingMethod,
  NoteAuthorType,
  Validation,
  PriceConstants,
  formatPrice,
  parsePriceToPence,
  isConditionWorse,
  getNextWorseCondition,
  isValidSubmissionStatus,
  isValidCondition,
} from "../constants";

describe("constants", () => {
  describe("SubmissionStatus", () => {
    it("should have all expected statuses", () => {
      expect(SubmissionStatus.DRAFT).toBe("DRAFT");
      expect(SubmissionStatus.SUBMITTED).toBe("SUBMITTED");
      expect(SubmissionStatus.IN_TRANSIT).toBe("IN_TRANSIT");
      expect(SubmissionStatus.RECEIVED).toBe("RECEIVED");
      expect(SubmissionStatus.GRADING).toBe("GRADING");
      expect(SubmissionStatus.PENDING_APPROVAL).toBe("PENDING_APPROVAL");
      expect(SubmissionStatus.APPROVED).toBe("APPROVED");
      expect(SubmissionStatus.COMPLETED).toBe("COMPLETED");
      expect(SubmissionStatus.CANCELLED).toBe("CANCELLED");
      expect(SubmissionStatus.RETURNED).toBe("RETURNED");
    });

    it("should have labels for all statuses", () => {
      const statusValues = Object.values(SubmissionStatus);
      for (const status of statusValues) {
        expect(SubmissionStatusLabels[status]).toBeDefined();
        expect(typeof SubmissionStatusLabels[status]).toBe("string");
      }
    });

    it("should have tones for all statuses", () => {
      const statusValues = Object.values(SubmissionStatus);
      for (const status of statusValues) {
        expect(status in SubmissionStatusTones).toBe(true);
      }
    });
  });

  describe("ItemStatus", () => {
    it("should have all expected statuses", () => {
      expect(ItemStatus.PENDING).toBe("PENDING");
      expect(ItemStatus.VERIFIED).toBe("VERIFIED");
      expect(ItemStatus.ADJUSTED).toBe("ADJUSTED");
      expect(ItemStatus.REJECTED).toBe("REJECTED");
    });
  });

  describe("Condition", () => {
    it("should have all expected conditions", () => {
      expect(Condition.NM).toBe("NM");
      expect(Condition.LP).toBe("LP");
      expect(Condition.MP).toBe("MP");
      expect(Condition.HP).toBe("HP");
      expect(Condition.DMG).toBe("DMG");
    });

    it("should have labels for all conditions", () => {
      const conditionValues = Object.values(Condition);
      for (const condition of conditionValues) {
        expect(ConditionLabels[condition]).toBeDefined();
        expect(typeof ConditionLabels[condition]).toBe("string");
      }
    });

    it("should have default multipliers for all conditions", () => {
      expect(DefaultConditionMultipliers.NM).toBe(0.7);
      expect(DefaultConditionMultipliers.LP).toBe(0.55);
      expect(DefaultConditionMultipliers.MP).toBe(0.4);
      expect(DefaultConditionMultipliers.HP).toBe(0.25);
      expect(DefaultConditionMultipliers.DMG).toBe(0.1);
    });

    it("should have condition order from best to worst", () => {
      expect(ConditionOrder).toEqual(["NM", "LP", "MP", "HP", "DMG"]);
    });
  });

  describe("PayoutType", () => {
    it("should have all expected types", () => {
      expect(PayoutType.STORE_CREDIT).toBe("STORE_CREDIT");
      expect(PayoutType.BANK).toBe("BANK");
      expect(PayoutType.PAYPAL).toBe("PAYPAL");
    });
  });

  describe("PayoutStatus", () => {
    it("should have all expected statuses", () => {
      expect(PayoutStatus.PENDING).toBe("PENDING");
      expect(PayoutStatus.PROCESSING).toBe("PROCESSING");
      expect(PayoutStatus.COMPLETED).toBe("COMPLETED");
      expect(PayoutStatus.FAILED).toBe("FAILED");
    });
  });

  describe("ShippingMethod", () => {
    it("should have all expected methods", () => {
      expect(ShippingMethod.PREPAID).toBe("PREPAID");
      expect(ShippingMethod.SELF_SHIP).toBe("SELF_SHIP");
      expect(ShippingMethod.DROP_OFF).toBe("DROP_OFF");
    });
  });

  describe("NoteAuthorType", () => {
    it("should have all expected types", () => {
      expect(NoteAuthorType.CUSTOMER).toBe("CUSTOMER");
      expect(NoteAuthorType.MERCHANT).toBe("MERCHANT");
      expect(NoteAuthorType.SYSTEM).toBe("SYSTEM");
    });
  });

  describe("Validation constants", () => {
    it("should have sensible default values", () => {
      expect(Validation.MAX_ITEMS_PER_SUBMISSION).toBe(100);
      expect(Validation.MAX_QUANTITY_PER_ITEM).toBe(99);
      expect(Validation.DEFAULT_MIN_SUBMISSION_VALUE).toBe(500);
      expect(Validation.MAX_CARD_NAME_LENGTH).toBe(500);
      expect(Validation.MAX_NOTE_LENGTH).toBe(2000);
    });
  });

  describe("PriceConstants", () => {
    it("should have correct values", () => {
      expect(PriceConstants.CURRENCY_SUBUNIT).toBe(100);
      expect(PriceConstants.MAX_PRICE).toBe(9999999);
      expect(PriceConstants.MIN_TRADEABLE_PRICE).toBe(1);
    });
  });
});

describe("formatPrice", () => {
  it("should format pence to GBP by default", () => {
    expect(formatPrice(100)).toBe("£1.00");
    expect(formatPrice(1500)).toBe("£15.00");
    expect(formatPrice(99)).toBe("£0.99");
    expect(formatPrice(0)).toBe("£0.00");
  });

  it("should handle large amounts", () => {
    expect(formatPrice(1000000)).toBe("£10,000.00");
    expect(formatPrice(9999999)).toBe("£99,999.99");
  });

  it("should handle different currencies", () => {
    expect(formatPrice(100, "USD")).toMatch(/\$1\.00/);
    expect(formatPrice(100, "EUR")).toMatch(/€1\.00/);
  });
});

describe("parsePriceToPence", () => {
  it("should parse valid price strings", () => {
    expect(parsePriceToPence("1.00")).toBe(100);
    expect(parsePriceToPence("15.50")).toBe(1550);
    expect(parsePriceToPence("0.99")).toBe(99);
    expect(parsePriceToPence("100")).toBe(10000);
  });

  it("should handle currency symbols", () => {
    expect(parsePriceToPence("£15.00")).toBe(1500);
    expect(parsePriceToPence("$20.50")).toBe(2050);
    expect(parsePriceToPence("€5.25")).toBe(525);
  });

  it("should handle invalid input", () => {
    expect(parsePriceToPence("")).toBe(0);
    expect(parsePriceToPence("abc")).toBe(0);
    expect(parsePriceToPence("not a price")).toBe(0);
  });

  it("should round to nearest pence", () => {
    expect(parsePriceToPence("1.999")).toBe(200);
    expect(parsePriceToPence("1.001")).toBe(100);
  });
});

describe("isConditionWorse", () => {
  it("should correctly compare conditions", () => {
    expect(isConditionWorse("LP", "NM")).toBe(true);
    expect(isConditionWorse("MP", "LP")).toBe(true);
    expect(isConditionWorse("HP", "MP")).toBe(true);
    expect(isConditionWorse("DMG", "HP")).toBe(true);
  });

  it("should return false for better or equal conditions", () => {
    expect(isConditionWorse("NM", "LP")).toBe(false);
    expect(isConditionWorse("NM", "NM")).toBe(false);
    expect(isConditionWorse("LP", "MP")).toBe(false);
  });

  it("should handle extreme comparisons", () => {
    expect(isConditionWorse("DMG", "NM")).toBe(true);
    expect(isConditionWorse("NM", "DMG")).toBe(false);
  });
});

describe("getNextWorseCondition", () => {
  it("should return the next worse condition", () => {
    expect(getNextWorseCondition("NM")).toBe("LP");
    expect(getNextWorseCondition("LP")).toBe("MP");
    expect(getNextWorseCondition("MP")).toBe("HP");
    expect(getNextWorseCondition("HP")).toBe("DMG");
  });

  it("should return null for worst condition", () => {
    expect(getNextWorseCondition("DMG")).toBe(null);
  });
});

describe("isValidSubmissionStatus", () => {
  it("should return true for valid statuses", () => {
    expect(isValidSubmissionStatus("DRAFT")).toBe(true);
    expect(isValidSubmissionStatus("SUBMITTED")).toBe(true);
    expect(isValidSubmissionStatus("COMPLETED")).toBe(true);
  });

  it("should return false for invalid statuses", () => {
    expect(isValidSubmissionStatus("INVALID")).toBe(false);
    expect(isValidSubmissionStatus("")).toBe(false);
    expect(isValidSubmissionStatus("draft")).toBe(false); // Case sensitive
  });
});

describe("isValidCondition", () => {
  it("should return true for valid conditions", () => {
    expect(isValidCondition("NM")).toBe(true);
    expect(isValidCondition("LP")).toBe(true);
    expect(isValidCondition("MP")).toBe(true);
    expect(isValidCondition("HP")).toBe(true);
    expect(isValidCondition("DMG")).toBe(true);
  });

  it("should return false for invalid conditions", () => {
    expect(isValidCondition("INVALID")).toBe(false);
    expect(isValidCondition("")).toBe(false);
    expect(isValidCondition("nm")).toBe(false); // Case sensitive
    expect(isValidCondition("Near Mint")).toBe(false);
  });
});
