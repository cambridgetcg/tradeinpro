/**
 * Trade-In System Constants
 * Central source of truth for all enums, status codes, and configuration
 */

// ============================================================================
// SUBMISSION STATUS
// ============================================================================

export const SubmissionStatus = {
  DRAFT: "DRAFT",
  SUBMITTED: "SUBMITTED",
  IN_TRANSIT: "IN_TRANSIT",
  RECEIVED: "RECEIVED",
  GRADING: "GRADING",
  PENDING_APPROVAL: "PENDING_APPROVAL",
  APPROVED: "APPROVED",
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED",
  RETURNED: "RETURNED",
} as const;

export type SubmissionStatusType =
  (typeof SubmissionStatus)[keyof typeof SubmissionStatus];

// Human-readable labels for statuses
export const SubmissionStatusLabels: Record<SubmissionStatusType, string> = {
  [SubmissionStatus.DRAFT]: "Draft",
  [SubmissionStatus.SUBMITTED]: "Submitted",
  [SubmissionStatus.IN_TRANSIT]: "In Transit",
  [SubmissionStatus.RECEIVED]: "Received",
  [SubmissionStatus.GRADING]: "Grading",
  [SubmissionStatus.PENDING_APPROVAL]: "Pending Approval",
  [SubmissionStatus.APPROVED]: "Approved",
  [SubmissionStatus.COMPLETED]: "Completed",
  [SubmissionStatus.CANCELLED]: "Cancelled",
  [SubmissionStatus.RETURNED]: "Returned",
};

// Badge tones for each status (Polaris)
export const SubmissionStatusTones: Record<
  SubmissionStatusType,
  "info" | "success" | "warning" | "critical" | "attention" | undefined
> = {
  [SubmissionStatus.DRAFT]: undefined,
  [SubmissionStatus.SUBMITTED]: "info",
  [SubmissionStatus.IN_TRANSIT]: "info",
  [SubmissionStatus.RECEIVED]: "attention",
  [SubmissionStatus.GRADING]: "attention",
  [SubmissionStatus.PENDING_APPROVAL]: "warning",
  [SubmissionStatus.APPROVED]: "success",
  [SubmissionStatus.COMPLETED]: "success",
  [SubmissionStatus.CANCELLED]: "critical",
  [SubmissionStatus.RETURNED]: "critical",
};

// ============================================================================
// ITEM STATUS
// ============================================================================

export const ItemStatus = {
  PENDING: "PENDING",
  VERIFIED: "VERIFIED",
  ADJUSTED: "ADJUSTED",
  REJECTED: "REJECTED",
} as const;

export type ItemStatusType = (typeof ItemStatus)[keyof typeof ItemStatus];

export const ItemStatusLabels: Record<ItemStatusType, string> = {
  [ItemStatus.PENDING]: "Pending",
  [ItemStatus.VERIFIED]: "Verified",
  [ItemStatus.ADJUSTED]: "Adjusted",
  [ItemStatus.REJECTED]: "Rejected",
};

// ============================================================================
// CARD CONDITIONS
// ============================================================================

export const Condition = {
  NM: "NM",
  LP: "LP",
  MP: "MP",
  HP: "HP",
  DMG: "DMG",
} as const;

export type ConditionType = (typeof Condition)[keyof typeof Condition];

export const ConditionLabels: Record<ConditionType, string> = {
  [Condition.NM]: "Near Mint",
  [Condition.LP]: "Lightly Played",
  [Condition.MP]: "Moderately Played",
  [Condition.HP]: "Heavily Played",
  [Condition.DMG]: "Damaged",
};

// Default condition multipliers (percentage of market price)
// These are overridden by TradeInSettings in the database
export const DefaultConditionMultipliers: Record<ConditionType, number> = {
  [Condition.NM]: 0.7,
  [Condition.LP]: 0.55,
  [Condition.MP]: 0.4,
  [Condition.HP]: 0.25,
  [Condition.DMG]: 0.1,
};

// Order of conditions from best to worst (for comparison)
export const ConditionOrder: ConditionType[] = [
  Condition.NM,
  Condition.LP,
  Condition.MP,
  Condition.HP,
  Condition.DMG,
];

// ============================================================================
// PAYOUT TYPES
// ============================================================================

export const PayoutType = {
  STORE_CREDIT: "STORE_CREDIT",
  BANK: "BANK",
  PAYPAL: "PAYPAL",
} as const;

export type PayoutTypeValue = (typeof PayoutType)[keyof typeof PayoutType];

export const PayoutTypeLabels: Record<PayoutTypeValue, string> = {
  [PayoutType.STORE_CREDIT]: "Store Credit",
  [PayoutType.BANK]: "Bank Transfer",
  [PayoutType.PAYPAL]: "PayPal",
};

// ============================================================================
// CONTACT CHANNELS
// ============================================================================

export const ContactChannel = {
  WHATSAPP: "WHATSAPP",
  TELEGRAM: "TELEGRAM",
  SIGNAL: "SIGNAL",
} as const;

export type ContactChannelType = (typeof ContactChannel)[keyof typeof ContactChannel];

export const ContactChannelLabels: Record<ContactChannelType, string> = {
  [ContactChannel.WHATSAPP]: "WhatsApp",
  [ContactChannel.TELEGRAM]: "Telegram",
  [ContactChannel.SIGNAL]: "Signal",
};

// ============================================================================
// PAYOUT STATUS
// ============================================================================

export const PayoutStatus = {
  PENDING: "PENDING",
  PROCESSING: "PROCESSING",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
} as const;

export type PayoutStatusType =
  (typeof PayoutStatus)[keyof typeof PayoutStatus];

// ============================================================================
// SHIPPING METHODS
// ============================================================================

export const ShippingMethod = {
  PREPAID: "PREPAID",
  SELF_SHIP: "SELF_SHIP",
  DROP_OFF: "DROP_OFF",
} as const;

export type ShippingMethodType =
  (typeof ShippingMethod)[keyof typeof ShippingMethod];

export const ShippingMethodLabels: Record<ShippingMethodType, string> = {
  [ShippingMethod.PREPAID]: "Prepaid Label",
  [ShippingMethod.SELF_SHIP]: "Self Ship",
  [ShippingMethod.DROP_OFF]: "Drop Off",
};

// ============================================================================
// NOTE AUTHOR TYPES
// ============================================================================

export const NoteAuthorType = {
  CUSTOMER: "CUSTOMER",
  MERCHANT: "MERCHANT",
  SYSTEM: "SYSTEM",
} as const;

export type NoteAuthorTypeValue =
  (typeof NoteAuthorType)[keyof typeof NoteAuthorType];

// ============================================================================
// VALIDATION CONSTANTS
// ============================================================================

export const Validation = {
  // Maximum items allowed in a single submission
  MAX_ITEMS_PER_SUBMISSION: 100,
  // Maximum quantity per line item
  MAX_QUANTITY_PER_ITEM: 99,
  // Minimum submission value in pence (default £5)
  DEFAULT_MIN_SUBMISSION_VALUE: 500,
  // Maximum card name length
  MAX_CARD_NAME_LENGTH: 500,
  // Maximum note message length
  MAX_NOTE_LENGTH: 2000,
} as const;

// ============================================================================
// PRICE CONSTANTS
// ============================================================================

export const PriceConstants = {
  // All prices are stored in pence (smallest currency unit)
  CURRENCY_SUBUNIT: 100,
  // Maximum price we'll accept (£99,999.99)
  MAX_PRICE: 9999999,
  // Minimum price for a card to be trade-in eligible
  MIN_TRADEABLE_PRICE: 1,
} as const;

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Format price from pence to display string
 */
export function formatPrice(pence: number, currency = "GBP"): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
  }).format(pence / PriceConstants.CURRENCY_SUBUNIT);
}

/**
 * Parse price string to pence
 */
export function parsePriceToPence(priceString: string): number {
  const cleaned = priceString.replace(/[^0-9.]/g, "");
  const parsed = parseFloat(cleaned);
  if (isNaN(parsed)) return 0;
  return Math.round(parsed * PriceConstants.CURRENCY_SUBUNIT);
}

/**
 * Check if a condition is worse than another
 */
export function isConditionWorse(
  condition: ConditionType,
  comparedTo: ConditionType
): boolean {
  const conditionIndex = ConditionOrder.indexOf(condition);
  const comparedIndex = ConditionOrder.indexOf(comparedTo);
  return conditionIndex > comparedIndex;
}

/**
 * Get the next condition (worse)
 */
export function getNextWorseCondition(
  condition: ConditionType
): ConditionType | null {
  const index = ConditionOrder.indexOf(condition);
  if (index === -1 || index === ConditionOrder.length - 1) return null;
  return ConditionOrder[index + 1];
}

/**
 * Check if a status value is valid
 */
export function isValidSubmissionStatus(
  status: string
): status is SubmissionStatusType {
  return Object.values(SubmissionStatus).includes(
    status as SubmissionStatusType
  );
}

/**
 * Check if a condition value is valid
 */
export function isValidCondition(
  condition: string
): condition is ConditionType {
  return Object.values(Condition).includes(condition as ConditionType);
}
