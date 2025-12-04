import { describe, it, expect } from "vitest";
import { Decimal } from "@prisma/client/runtime/library";
import {
  toNumber,
  poundsToPence,
  getConditionMultiplier,
  calculateCardPrice,
  calculateConditionAdjustment,
  calculateSubmissionTotal,
  meetsMinimumValue,
  requiresApproval,
  calculateBulkPrices,
} from "../pricing.server";
import { Condition, PayoutType } from "../constants";

describe("toNumber", () => {
  it("should handle null and undefined", () => {
    expect(toNumber(null)).toBe(0);
    expect(toNumber(undefined)).toBe(0);
  });

  it("should handle regular numbers", () => {
    expect(toNumber(10)).toBe(10);
    expect(toNumber(0)).toBe(0);
    expect(toNumber(-5)).toBe(-5);
    expect(toNumber(10.5)).toBe(10.5);
  });

  it("should handle Prisma Decimal", () => {
    expect(toNumber(new Decimal("10.50"))).toBe(10.5);
    expect(toNumber(new Decimal("0"))).toBe(0);
    expect(toNumber(new Decimal("99.99"))).toBe(99.99);
  });
});

describe("poundsToPence", () => {
  it("should convert pounds to pence", () => {
    expect(poundsToPence(1)).toBe(100);
    expect(poundsToPence(10.5)).toBe(1050);
    expect(poundsToPence(0)).toBe(0);
    expect(poundsToPence(99.99)).toBe(9999);
  });

  it("should round to nearest pence", () => {
    // Note: JavaScript floating point means 1.005 * 100 = 100.49999...
    // So we test with values that don't hit floating point edge cases
    expect(poundsToPence(1.50)).toBe(150);
    expect(poundsToPence(1.49)).toBe(149);
    expect(poundsToPence(10.01)).toBe(1001);
  });
});

describe("getConditionMultiplier", () => {
  it("should return default multipliers", () => {
    expect(getConditionMultiplier(Condition.NM)).toBe(0.7);
    expect(getConditionMultiplier(Condition.LP)).toBe(0.55);
    expect(getConditionMultiplier(Condition.MP)).toBe(0.4);
    expect(getConditionMultiplier(Condition.HP)).toBe(0.25);
    expect(getConditionMultiplier(Condition.DMG)).toBe(0.1);
  });

  it("should use custom multipliers when provided", () => {
    const customSettings = {
      conditionMultiplierNM: 0.8,
      conditionMultiplierLP: 0.6,
      conditionMultiplierMP: 0.45,
      conditionMultiplierHP: 0.3,
      conditionMultiplierDMG: 0.15,
    };

    expect(getConditionMultiplier(Condition.NM, customSettings)).toBe(0.8);
    expect(getConditionMultiplier(Condition.LP, customSettings)).toBe(0.6);
    expect(getConditionMultiplier(Condition.MP, customSettings)).toBe(0.45);
    expect(getConditionMultiplier(Condition.HP, customSettings)).toBe(0.3);
    expect(getConditionMultiplier(Condition.DMG, customSettings)).toBe(0.15);
  });

  it("should fall back to defaults for missing custom values", () => {
    const partialSettings = {
      conditionMultiplierNM: 0.8,
    };

    expect(getConditionMultiplier(Condition.NM, partialSettings)).toBe(0.8);
    expect(getConditionMultiplier(Condition.LP, partialSettings)).toBe(0.55);
  });
});

describe("calculateCardPrice", () => {
  it("should calculate price using tradeinPriceGbp first", () => {
    const result = calculateCardPrice(
      { tradeinPriceGbp: new Decimal("10.00") },
      Condition.NM,
      1
    );

    expect(result.basePrice).toBe(1000); // £10 = 1000p
    expect(result.adjustedPrice).toBe(700); // 70% of 1000
    expect(result.totalPrice).toBe(700);
    expect(result.multiplierUsed).toBe(0.7);
  });

  it("should fall back to tradeinPrice if tradeinPriceGbp is missing", () => {
    const result = calculateCardPrice(
      { tradeinPrice: new Decimal("10.00") },
      Condition.NM,
      1
    );

    expect(result.basePrice).toBe(1000);
    expect(result.adjustedPrice).toBe(700);
  });

  it("should fall back to marketPriceGbp if tradein prices are missing", () => {
    const result = calculateCardPrice(
      { marketPriceGbp: new Decimal("10.00") },
      Condition.NM,
      1
    );

    expect(result.basePrice).toBe(1000);
    expect(result.adjustedPrice).toBe(700);
  });

  it("should fall back to marketPrice if all GBP prices are missing", () => {
    const result = calculateCardPrice(
      { marketPrice: new Decimal("10.00") },
      Condition.NM,
      1
    );

    expect(result.basePrice).toBe(1000);
    expect(result.adjustedPrice).toBe(700);
  });

  it("should return zero if no prices available", () => {
    const result = calculateCardPrice({}, Condition.NM, 1);

    expect(result.basePrice).toBe(0);
    expect(result.adjustedPrice).toBe(0);
    expect(result.totalPrice).toBe(0);
  });

  it("should apply correct multipliers for each condition", () => {
    const cardData = { tradeinPriceGbp: new Decimal("100.00") };

    expect(calculateCardPrice(cardData, Condition.NM, 1).adjustedPrice).toBe(7000);
    expect(calculateCardPrice(cardData, Condition.LP, 1).adjustedPrice).toBe(5500);
    expect(calculateCardPrice(cardData, Condition.MP, 1).adjustedPrice).toBe(4000);
    expect(calculateCardPrice(cardData, Condition.HP, 1).adjustedPrice).toBe(2500);
    expect(calculateCardPrice(cardData, Condition.DMG, 1).adjustedPrice).toBe(1000);
  });

  it("should multiply by quantity", () => {
    const result = calculateCardPrice(
      { tradeinPriceGbp: new Decimal("10.00") },
      Condition.NM,
      4
    );

    expect(result.quantity).toBe(4);
    expect(result.adjustedPrice).toBe(700);
    expect(result.totalPrice).toBe(2800); // 700 * 4
  });

  it("should handle fractional quantities by rounding down", () => {
    const result = calculateCardPrice(
      { tradeinPriceGbp: new Decimal("10.00") },
      Condition.NM,
      2.7
    );

    expect(result.quantity).toBe(2);
    expect(result.totalPrice).toBe(1400);
  });

  it("should use minimum quantity of 1", () => {
    const result = calculateCardPrice(
      { tradeinPriceGbp: new Decimal("10.00") },
      Condition.NM,
      0
    );

    expect(result.quantity).toBe(1);
  });

  it("should throw error for invalid condition", () => {
    expect(() =>
      calculateCardPrice(
        { tradeinPriceGbp: new Decimal("10.00") },
        "INVALID" as any,
        1
      )
    ).toThrow("Invalid condition");
  });

  it("should use custom multipliers from settings", () => {
    const result = calculateCardPrice(
      { tradeinPriceGbp: new Decimal("100.00") },
      Condition.NM,
      1,
      { conditionMultiplierNM: 0.8 }
    );

    expect(result.adjustedPrice).toBe(8000); // 80% of 10000
    expect(result.multiplierUsed).toBe(0.8);
  });

  it("should floor the adjusted price", () => {
    // 7.77 * 100 * 0.7 = 543.9
    const result = calculateCardPrice(
      { tradeinPriceGbp: new Decimal("7.77") },
      Condition.NM,
      1
    );

    expect(result.adjustedPrice).toBe(543); // Floored from 543.9
  });
});

describe("calculateConditionAdjustment", () => {
  it("should calculate adjustment when condition is downgraded", () => {
    const result = calculateConditionAdjustment(700, Condition.NM, Condition.LP);

    // Original: 700p at 70% → base = 1000p
    // New: 1000p at 55% = 550p
    expect(result.originalPrice).toBe(700);
    expect(result.adjustedPrice).toBe(550);
    expect(result.difference).toBe(-150);
    expect(result.percentChange).toBe(-21); // -150/700 ≈ -21%
  });

  it("should calculate adjustment when condition is upgraded", () => {
    const result = calculateConditionAdjustment(550, Condition.LP, Condition.NM);

    // Original: 550p at 55% → base = 1000p
    // New: 1000p at 70% = 700p
    expect(result.originalPrice).toBe(550);
    expect(result.adjustedPrice).toBe(700);
    expect(result.difference).toBe(150);
    expect(result.percentChange).toBe(27); // 150/550 ≈ 27%
  });

  it("should return same price when condition unchanged", () => {
    const result = calculateConditionAdjustment(700, Condition.NM, Condition.NM);

    expect(result.adjustedPrice).toBe(700);
    expect(result.difference).toBe(0);
    expect(result.percentChange).toBe(0);
  });

  it("should handle zero original price", () => {
    const result = calculateConditionAdjustment(0, Condition.NM, Condition.LP);

    expect(result.percentChange).toBe(0);
  });
});

describe("calculateSubmissionTotal", () => {
  const mockItems = [
    { quotedPrice: 1000, finalPrice: null, quantity: 1, status: "PENDING" },
    { quotedPrice: 500, finalPrice: 450, quantity: 2, status: "ADJUSTED" },
    { quotedPrice: 200, finalPrice: null, quantity: 1, status: "REJECTED" },
  ];

  it("should sum item prices correctly", () => {
    const result = calculateSubmissionTotal(mockItems, PayoutType.BANK);

    // Item 1: 1000 * 1 = 1000 (uses quotedPrice since finalPrice is null)
    // Item 2: 450 * 2 = 900 (uses finalPrice)
    // Item 3: REJECTED, excluded
    expect(result.subtotal).toBe(1900);
    expect(result.itemCount).toBe(3);
  });

  it("should add store credit bonus", () => {
    const items = [
      { quotedPrice: 1000, finalPrice: null, quantity: 1, status: "PENDING" },
    ];

    const result = calculateSubmissionTotal(items, PayoutType.STORE_CREDIT);

    expect(result.subtotal).toBe(1000);
    expect(result.bonusAmount).toBe(100); // 10% bonus
    expect(result.totalAmount).toBe(1100);
  });

  it("should use custom store credit bonus percent", () => {
    const items = [
      { quotedPrice: 1000, finalPrice: null, quantity: 1, status: "PENDING" },
    ];

    const result = calculateSubmissionTotal(items, PayoutType.STORE_CREDIT, {
      storeCreditBonusPercent: 15,
    });

    expect(result.bonusAmount).toBe(150);
    expect(result.totalAmount).toBe(1150);
  });

  it("should apply cash payout reduction", () => {
    const items = [
      { quotedPrice: 1000, finalPrice: null, quantity: 1, status: "PENDING" },
    ];

    const result = calculateSubmissionTotal(items, PayoutType.BANK, {
      cashPayoutPercent: 90,
    });

    expect(result.subtotal).toBe(1000);
    expect(result.bonusAmount).toBe(-100); // 10% reduction
    expect(result.totalAmount).toBe(900);
    expect(result.warnings).toContain("Cash payout is 90% of trade-in value");
  });

  it("should handle empty items array", () => {
    const result = calculateSubmissionTotal([], PayoutType.BANK);

    expect(result.subtotal).toBe(0);
    expect(result.itemCount).toBe(0);
    expect(result.totalAmount).toBe(0);
  });

  it("should warn when all items have zero value", () => {
    const items = [
      { quotedPrice: 0, finalPrice: null, quantity: 1, status: "PENDING" },
    ];

    const result = calculateSubmissionTotal(items, PayoutType.BANK);

    expect(result.warnings).toContain("All items have zero value");
  });

  it("should exclude rejected items from total", () => {
    const items = [
      { quotedPrice: 1000, finalPrice: null, quantity: 1, status: "REJECTED" },
      { quotedPrice: 500, finalPrice: null, quantity: 1, status: "VERIFIED" },
    ];

    const result = calculateSubmissionTotal(items, PayoutType.BANK);

    expect(result.subtotal).toBe(500);
    expect(result.itemCount).toBe(1);
  });
});

describe("meetsMinimumValue", () => {
  it("should return true when value meets minimum", () => {
    const result = meetsMinimumValue(500, 500);

    expect(result.meets).toBe(true);
    expect(result.shortfall).toBe(0);
  });

  it("should return true when value exceeds minimum", () => {
    const result = meetsMinimumValue(1000, 500);

    expect(result.meets).toBe(true);
    expect(result.shortfall).toBe(0);
  });

  it("should return false with shortfall when below minimum", () => {
    const result = meetsMinimumValue(300, 500);

    expect(result.meets).toBe(false);
    expect(result.shortfall).toBe(200);
  });

  it("should use default minimum of £5 (500p)", () => {
    expect(meetsMinimumValue(500).meets).toBe(true);
    expect(meetsMinimumValue(499).meets).toBe(false);
  });
});

describe("requiresApproval", () => {
  it("should require approval above threshold", () => {
    const result = requiresApproval(5000, {
      requiresApprovalAbove: 5000,
      autoApproveBelow: 2000,
    });

    expect(result.required).toBe(true);
    expect(result.reason).toBeDefined();
  });

  it("should not require approval below auto-approve threshold", () => {
    const result = requiresApproval(1500, {
      requiresApprovalAbove: 5000,
      autoApproveBelow: 2000,
    });

    expect(result.required).toBe(false);
  });

  it("should require approval in middle zone", () => {
    const result = requiresApproval(3000, {
      requiresApprovalAbove: 5000,
      autoApproveBelow: 2000,
    });

    expect(result.required).toBe(true);
  });

  it("should use default thresholds", () => {
    expect(requiresApproval(1500).required).toBe(false); // Below £20
    expect(requiresApproval(5500).required).toBe(true); // Above £50
    expect(requiresApproval(3000).required).toBe(true); // In between
  });
});

describe("calculateBulkPrices", () => {
  it("should calculate prices for multiple cards", () => {
    const cards = [
      {
        cardData: { tradeinPriceGbp: new Decimal("10.00") },
        condition: Condition.NM,
        quantity: 1,
      },
      {
        cardData: { tradeinPriceGbp: new Decimal("5.00") },
        condition: Condition.LP,
        quantity: 2,
      },
    ];

    const result = calculateBulkPrices(cards);

    expect(result.successCount).toBe(2);
    expect(result.errorCount).toBe(0);
    expect(result.items.length).toBe(2);

    // Card 1: 1000p * 0.7 = 700p
    expect(result.items[0].result.totalPrice).toBe(700);
    // Card 2: 500p * 0.55 * 2 = 550p
    expect(result.items[1].result.totalPrice).toBe(550);

    expect(result.totalValue).toBe(1250);
  });

  it("should handle errors gracefully", () => {
    const cards = [
      {
        cardData: { tradeinPriceGbp: new Decimal("10.00") },
        condition: Condition.NM,
        quantity: 1,
      },
      {
        cardData: { tradeinPriceGbp: new Decimal("5.00") },
        condition: "INVALID" as any,
        quantity: 1,
      },
    ];

    const result = calculateBulkPrices(cards);

    expect(result.successCount).toBe(1);
    expect(result.errorCount).toBe(1);
    expect(result.items[1].error).toContain("Invalid condition");
    expect(result.totalValue).toBe(700); // Only first card counted
  });

  it("should handle empty array", () => {
    const result = calculateBulkPrices([]);

    expect(result.successCount).toBe(0);
    expect(result.errorCount).toBe(0);
    expect(result.totalValue).toBe(0);
    expect(result.items).toEqual([]);
  });
});
