/**
 * Pricing Engine for Trade-In System
 * Handles all price calculations with proper edge case handling
 */

import type { Decimal } from "@prisma/client/runtime/library";
import {
  Condition,
  type ConditionType,
  DefaultConditionMultipliers,
  PayoutType,
  type PayoutTypeValue,
  PriceConstants,
  isValidCondition,
} from "./constants";

// ============================================================================
// TYPES
// ============================================================================

export interface ConditionMultipliers {
  conditionMultiplierNM: number;
  conditionMultiplierLP: number;
  conditionMultiplierMP: number;
  conditionMultiplierHP: number;
  conditionMultiplierDMG: number;
}

export interface PricingSettings extends ConditionMultipliers {
  storeCreditBonusPercent: number;
  cashPayoutPercent: number;
}

export interface CardPriceData {
  tradeinPriceGbp?: Decimal | number | null;
  tradeinPrice?: Decimal | number | null;
  marketPriceGbp?: Decimal | number | null;
  marketPrice?: Decimal | number | null;
}

export interface PriceCalculationResult {
  basePrice: number; // Price in pence before condition adjustment
  adjustedPrice: number; // Price after condition multiplier
  quantity: number;
  totalPrice: number; // adjustedPrice * quantity
  condition: ConditionType;
  multiplierUsed: number;
}

export interface SubmissionTotalResult {
  subtotal: number; // Sum of all item prices
  bonusAmount: number; // Store credit bonus (if applicable)
  totalAmount: number; // Final amount customer receives
  payoutType: PayoutTypeValue;
  itemCount: number;
  warnings: string[];
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Safely convert Prisma Decimal or number to number
 */
export function toNumber(value: Decimal | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return value;
  // Prisma Decimal has a toNumber() method
  return Number(value);
}

/**
 * Convert pounds to pence
 */
export function poundsToPence(pounds: number): number {
  return Math.round(pounds * PriceConstants.CURRENCY_SUBUNIT);
}

/**
 * Clamp a number between min and max
 */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Get condition multiplier from settings
 */
export function getConditionMultiplier(
  condition: ConditionType,
  settings?: Partial<ConditionMultipliers>
): number {
  const multipliers: ConditionMultipliers = {
    conditionMultiplierNM:
      settings?.conditionMultiplierNM ?? DefaultConditionMultipliers.NM,
    conditionMultiplierLP:
      settings?.conditionMultiplierLP ?? DefaultConditionMultipliers.LP,
    conditionMultiplierMP:
      settings?.conditionMultiplierMP ?? DefaultConditionMultipliers.MP,
    conditionMultiplierHP:
      settings?.conditionMultiplierHP ?? DefaultConditionMultipliers.HP,
    conditionMultiplierDMG:
      settings?.conditionMultiplierDMG ?? DefaultConditionMultipliers.DMG,
  };

  const multiplierMap: Record<ConditionType, number> = {
    [Condition.NM]: multipliers.conditionMultiplierNM,
    [Condition.LP]: multipliers.conditionMultiplierLP,
    [Condition.MP]: multipliers.conditionMultiplierMP,
    [Condition.HP]: multipliers.conditionMultiplierHP,
    [Condition.DMG]: multipliers.conditionMultiplierDMG,
  };

  return multiplierMap[condition];
}

// ============================================================================
// PRICE CALCULATION
// ============================================================================

/**
 * Calculate trade-in price for a single card
 *
 * Price priority:
 * 1. tradeinPriceGbp (already converted trade-in price)
 * 2. tradeinPrice (original trade-in price, may need conversion)
 * 3. marketPriceGbp * condition multiplier
 * 4. marketPrice * condition multiplier
 *
 * All calculations use pence to avoid floating point issues
 */
export function calculateCardPrice(
  cardData: CardPriceData,
  condition: ConditionType,
  quantity: number = 1,
  settings?: Partial<ConditionMultipliers>
): PriceCalculationResult {
  // Validate inputs
  if (!isValidCondition(condition)) {
    throw new Error(`Invalid condition: ${condition}`);
  }

  const safeQuantity = Math.max(1, Math.floor(quantity));
  const multiplier = getConditionMultiplier(condition, settings);

  // Try to get base price (in pounds from DB, convert to pence)
  let basePrice = 0;
  let priceSource: "tradein" | "market" = "tradein";

  // Priority 1: tradeinPriceGbp
  const tradeinGbp = toNumber(cardData.tradeinPriceGbp);
  if (tradeinGbp > 0) {
    basePrice = poundsToPence(tradeinGbp);
    priceSource = "tradein";
  }
  // Priority 2: tradeinPrice (USD/EUR, use as-is for now)
  else {
    const tradein = toNumber(cardData.tradeinPrice);
    if (tradein > 0) {
      basePrice = poundsToPence(tradein);
      priceSource = "tradein";
    }
    // Priority 3: marketPriceGbp
    else {
      const marketGbp = toNumber(cardData.marketPriceGbp);
      if (marketGbp > 0) {
        basePrice = poundsToPence(marketGbp);
        priceSource = "market";
      }
      // Priority 4: marketPrice
      else {
        const market = toNumber(cardData.marketPrice);
        if (market > 0) {
          basePrice = poundsToPence(market);
          priceSource = "market";
        }
      }
    }
  }

  // Trade-in prices already have a margin built in, so we apply condition multiplier
  // Market prices need the full condition adjustment
  let adjustedPrice: number;

  if (priceSource === "tradein") {
    // For trade-in prices, the multiplier represents condition degradation
    // NM at 70% of trade-in value, LP at 55%, etc.
    adjustedPrice = Math.floor(basePrice * multiplier);
  } else {
    // For market prices, apply the same multiplier
    adjustedPrice = Math.floor(basePrice * multiplier);
  }

  // Ensure non-negative and within bounds
  adjustedPrice = clamp(adjustedPrice, 0, PriceConstants.MAX_PRICE);
  const totalPrice = clamp(
    adjustedPrice * safeQuantity,
    0,
    PriceConstants.MAX_PRICE
  );

  return {
    basePrice,
    adjustedPrice,
    quantity: safeQuantity,
    totalPrice,
    condition,
    multiplierUsed: multiplier,
  };
}

/**
 * Calculate price adjustment when condition changes during grading
 */
export function calculateConditionAdjustment(
  originalPrice: number,
  originalCondition: ConditionType,
  actualCondition: ConditionType,
  settings?: Partial<ConditionMultipliers>
): {
  originalPrice: number;
  adjustedPrice: number;
  difference: number;
  percentChange: number;
} {
  const originalMultiplier = getConditionMultiplier(originalCondition, settings);
  const actualMultiplier = getConditionMultiplier(actualCondition, settings);

  // Reverse-engineer base price from original price and multiplier
  const basePrice =
    originalMultiplier > 0
      ? Math.round(originalPrice / originalMultiplier)
      : originalPrice;

  // Calculate new price with actual condition
  const adjustedPrice = Math.floor(basePrice * actualMultiplier);
  const difference = adjustedPrice - originalPrice;
  const percentChange =
    originalPrice > 0
      ? Math.round((difference / originalPrice) * 100)
      : 0;

  return {
    originalPrice,
    adjustedPrice,
    difference,
    percentChange,
  };
}

// ============================================================================
// SUBMISSION TOTALS
// ============================================================================

export interface SubmissionItem {
  quotedPrice: number;
  finalPrice?: number | null;
  quantity: number;
  status: string;
}

/**
 * Calculate total for a submission
 */
export function calculateSubmissionTotal(
  items: SubmissionItem[],
  payoutType: PayoutTypeValue,
  settings?: Partial<PricingSettings>
): SubmissionTotalResult {
  const warnings: string[] = [];
  const storeCreditBonus = settings?.storeCreditBonusPercent ?? 10;
  const cashPayoutPercent = settings?.cashPayoutPercent ?? 100;

  // Sum up item prices (use finalPrice if available, otherwise quotedPrice)
  let subtotal = 0;
  let itemCount = 0;

  for (const item of items) {
    // Skip rejected items
    if (item.status === "REJECTED") continue;

    const price = item.finalPrice ?? item.quotedPrice;
    const quantity = Math.max(1, item.quantity);

    subtotal += price * quantity;
    itemCount += quantity;
  }

  // Ensure subtotal is within bounds
  subtotal = clamp(subtotal, 0, PriceConstants.MAX_PRICE);

  // Calculate bonus/adjustment based on payout type
  let bonusAmount = 0;
  let totalAmount = subtotal;

  if (payoutType === PayoutType.STORE_CREDIT) {
    // Store credit gets a bonus percentage
    bonusAmount = Math.floor(subtotal * (storeCreditBonus / 100));
    totalAmount = subtotal + bonusAmount;
  } else if (
    payoutType === PayoutType.BANK ||
    payoutType === PayoutType.PAYPAL
  ) {
    // Cash payouts may have a reduced percentage
    if (cashPayoutPercent < 100) {
      const reduction = subtotal - Math.floor(subtotal * (cashPayoutPercent / 100));
      bonusAmount = -reduction; // Negative "bonus" represents reduction
      totalAmount = subtotal + bonusAmount;
      warnings.push(
        `Cash payout is ${cashPayoutPercent}% of trade-in value`
      );
    }
  }

  // Final bounds check
  totalAmount = clamp(totalAmount, 0, PriceConstants.MAX_PRICE);

  if (subtotal === 0 && itemCount > 0) {
    warnings.push("All items have zero value");
  }

  return {
    subtotal,
    bonusAmount,
    totalAmount,
    payoutType,
    itemCount,
    warnings,
  };
}

/**
 * Check if submission meets minimum value requirement
 */
export function meetsMinimumValue(
  total: number,
  minimumValue: number = PriceConstants.CURRENCY_SUBUNIT * 5 // £5 default
): { meets: boolean; shortfall: number } {
  const shortfall = Math.max(0, minimumValue - total);
  return {
    meets: total >= minimumValue,
    shortfall,
  };
}

/**
 * Determine if submission requires manual approval
 */
export function requiresApproval(
  total: number,
  thresholds?: {
    requiresApprovalAbove?: number;
    autoApproveBelow?: number;
  }
): { required: boolean; reason?: string } {
  const requiresAbove = thresholds?.requiresApprovalAbove ?? 5000; // £50
  const autoBelow = thresholds?.autoApproveBelow ?? 2000; // £20

  if (total >= requiresAbove) {
    return {
      required: true,
      reason: `Submission value exceeds auto-approval threshold`,
    };
  }

  if (total < autoBelow) {
    return {
      required: false,
    };
  }

  // Between autoBelow and requiresAbove - could go either way
  // Default to requiring approval for safety
  return {
    required: true,
    reason: `Submission value requires review`,
  };
}

// ============================================================================
// BULK OPERATIONS
// ============================================================================

export interface BulkPriceResult {
  items: Array<{
    index: number;
    result: PriceCalculationResult;
    error?: string;
  }>;
  totalValue: number;
  successCount: number;
  errorCount: number;
}

/**
 * Calculate prices for multiple cards at once
 */
export function calculateBulkPrices(
  cards: Array<{
    cardData: CardPriceData;
    condition: ConditionType;
    quantity: number;
  }>,
  settings?: Partial<ConditionMultipliers>
): BulkPriceResult {
  const items: BulkPriceResult["items"] = [];
  let totalValue = 0;
  let successCount = 0;
  let errorCount = 0;

  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    try {
      const result = calculateCardPrice(
        card.cardData,
        card.condition,
        card.quantity,
        settings
      );
      items.push({ index: i, result });
      totalValue += result.totalPrice;
      successCount++;
    } catch (error) {
      items.push({
        index: i,
        result: {
          basePrice: 0,
          adjustedPrice: 0,
          quantity: card.quantity,
          totalPrice: 0,
          condition: card.condition,
          multiplierUsed: 0,
        },
        error: error instanceof Error ? error.message : "Unknown error",
      });
      errorCount++;
    }
  }

  return {
    items,
    totalValue: clamp(totalValue, 0, PriceConstants.MAX_PRICE),
    successCount,
    errorCount,
  };
}
