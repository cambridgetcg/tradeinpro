/**
 * Settings Management for Trade-In System
 * Handles CRUD operations, validation, and defaults for shop settings
 */

import prisma from "../db.server";
import { Condition, type ConditionType } from "./constants";

// ============================================================================
// TYPES
// ============================================================================

export interface ReturnAddress {
  name: string;
  company?: string;
  address1: string;
  address2?: string;
  city: string;
  province?: string;
  postalCode: string;
  country: string; // ISO 2-letter code
  phone?: string;
}

export interface SettingsValidationResult {
  valid: boolean;
  errors: Record<string, string>;
}

export interface TradeInSettingsInput {
  // Pricing
  conditionMultiplierNM?: number;
  conditionMultiplierLP?: number;
  conditionMultiplierMP?: number;
  conditionMultiplierHP?: number;
  conditionMultiplierDMG?: number;
  storeCreditBonusPercent?: number;
  cashPayoutPercent?: number;

  // Thresholds
  minimumSubmissionValue?: number;
  requiresApprovalAbove?: number;
  autoApproveBelow?: number;
  maxItemsPerSubmission?: number;

  // Shipping
  freeShippingMinimum?: number;
  shippingLabelEnabled?: boolean;
  returnAddress?: ReturnAddress | null;

  // Notifications
  notifyOnSubmission?: boolean;
  notifyOnReceived?: boolean;
  notifyOnGraded?: boolean;

  // Content
  termsAndConditions?: string | null;
  gradingGuideUrl?: string | null;
}

// ============================================================================
// DEFAULT VALUES
// ============================================================================

export const DEFAULT_SETTINGS: Required<Omit<TradeInSettingsInput, "returnAddress" | "termsAndConditions" | "gradingGuideUrl">> & {
  returnAddress: ReturnAddress | null;
  termsAndConditions: string | null;
  gradingGuideUrl: string | null;
} = {
  conditionMultiplierNM: 0.70,
  conditionMultiplierLP: 0.55,
  conditionMultiplierMP: 0.40,
  conditionMultiplierHP: 0.25,
  conditionMultiplierDMG: 0.10,
  storeCreditBonusPercent: 10,
  cashPayoutPercent: 100,
  minimumSubmissionValue: 500,
  requiresApprovalAbove: 5000,
  autoApproveBelow: 2000,
  maxItemsPerSubmission: 100,
  freeShippingMinimum: 5000,
  shippingLabelEnabled: true,
  returnAddress: null,
  notifyOnSubmission: true,
  notifyOnReceived: true,
  notifyOnGraded: true,
  termsAndConditions: null,
  gradingGuideUrl: null,
};

// ============================================================================
// VALIDATION
// ============================================================================

/**
 * Validate condition multipliers are in descending order
 */
export function validateMultipliers(input: {
  conditionMultiplierNM?: number;
  conditionMultiplierLP?: number;
  conditionMultiplierMP?: number;
  conditionMultiplierHP?: number;
  conditionMultiplierDMG?: number;
}): SettingsValidationResult {
  const errors: Record<string, string> = {};

  const nm = input.conditionMultiplierNM ?? DEFAULT_SETTINGS.conditionMultiplierNM;
  const lp = input.conditionMultiplierLP ?? DEFAULT_SETTINGS.conditionMultiplierLP;
  const mp = input.conditionMultiplierMP ?? DEFAULT_SETTINGS.conditionMultiplierMP;
  const hp = input.conditionMultiplierHP ?? DEFAULT_SETTINGS.conditionMultiplierHP;
  const dmg = input.conditionMultiplierDMG ?? DEFAULT_SETTINGS.conditionMultiplierDMG;

  // Range validation
  const validateRange = (value: number, name: string, fieldName: string) => {
    if (value < 0.01 || value > 1) {
      errors[fieldName] = `${name} multiplier must be between 0.01 and 1.00`;
    }
  };

  validateRange(nm, "Near Mint", "conditionMultiplierNM");
  validateRange(lp, "Lightly Played", "conditionMultiplierLP");
  validateRange(mp, "Moderately Played", "conditionMultiplierMP");
  validateRange(hp, "Heavily Played", "conditionMultiplierHP");
  validateRange(dmg, "Damaged", "conditionMultiplierDMG");

  // Order validation (must be descending)
  if (Object.keys(errors).length === 0) {
    if (lp >= nm) {
      errors.conditionMultiplierLP = "LP multiplier must be less than NM";
    }
    if (mp >= lp) {
      errors.conditionMultiplierMP = "MP multiplier must be less than LP";
    }
    if (hp >= mp) {
      errors.conditionMultiplierHP = "HP multiplier must be less than MP";
    }
    if (dmg >= hp) {
      errors.conditionMultiplierDMG = "DMG multiplier must be less than HP";
    }
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
  };
}

/**
 * Validate threshold consistency
 */
export function validateThresholds(input: {
  minimumSubmissionValue?: number;
  requiresApprovalAbove?: number;
  autoApproveBelow?: number;
  maxItemsPerSubmission?: number;
}): SettingsValidationResult {
  const errors: Record<string, string> = {};

  const minValue = input.minimumSubmissionValue ?? DEFAULT_SETTINGS.minimumSubmissionValue;
  const requiresAbove = input.requiresApprovalAbove ?? DEFAULT_SETTINGS.requiresApprovalAbove;
  const autoBelow = input.autoApproveBelow ?? DEFAULT_SETTINGS.autoApproveBelow;
  const maxItems = input.maxItemsPerSubmission ?? DEFAULT_SETTINGS.maxItemsPerSubmission;

  // Range validations
  if (minValue < 0 || minValue > 100000) {
    errors.minimumSubmissionValue = "Minimum value must be between £0 and £1,000";
  }
  if (requiresAbove < 0 || requiresAbove > 10000000) {
    errors.requiresApprovalAbove = "Approval threshold must be between £0 and £100,000";
  }
  if (autoBelow < 0 || autoBelow > 10000000) {
    errors.autoApproveBelow = "Auto-approve threshold must be between £0 and £100,000";
  }
  if (maxItems < 1 || maxItems > 500) {
    errors.maxItemsPerSubmission = "Max items must be between 1 and 500";
  }

  // Relationship validations
  if (Object.keys(errors).length === 0) {
    if (autoBelow > requiresAbove) {
      errors.autoApproveBelow = "Auto-approve threshold cannot exceed requires-approval threshold";
    }
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
  };
}

/**
 * Validate return address
 */
export function validateReturnAddress(address: ReturnAddress | null): SettingsValidationResult {
  const errors: Record<string, string> = {};

  if (address === null) {
    return { valid: true, errors };
  }

  if (!address.name || address.name.trim().length === 0) {
    errors["returnAddress.name"] = "Name is required";
  }
  if (!address.address1 || address.address1.trim().length === 0) {
    errors["returnAddress.address1"] = "Address line 1 is required";
  }
  if (!address.city || address.city.trim().length === 0) {
    errors["returnAddress.city"] = "City is required";
  }
  if (!address.postalCode || address.postalCode.trim().length === 0) {
    errors["returnAddress.postalCode"] = "Postal code is required";
  }
  if (!address.country || !/^[A-Z]{2}$/.test(address.country)) {
    errors["returnAddress.country"] = "Country must be a 2-letter ISO code (e.g., GB, US)";
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
  };
}

/**
 * Validate payout settings
 */
export function validatePayoutSettings(input: {
  storeCreditBonusPercent?: number;
  cashPayoutPercent?: number;
}): SettingsValidationResult {
  const errors: Record<string, string> = {};

  const bonus = input.storeCreditBonusPercent ?? DEFAULT_SETTINGS.storeCreditBonusPercent;
  const cashPayout = input.cashPayoutPercent ?? DEFAULT_SETTINGS.cashPayoutPercent;

  if (bonus < 0 || bonus > 50) {
    errors.storeCreditBonusPercent = "Store credit bonus must be between 0% and 50%";
  }
  if (cashPayout < 50 || cashPayout > 100) {
    errors.cashPayoutPercent = "Cash payout rate must be between 50% and 100%";
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
  };
}

/**
 * Validate content fields
 */
export function validateContent(input: {
  termsAndConditions?: string | null;
  gradingGuideUrl?: string | null;
}): SettingsValidationResult {
  const errors: Record<string, string> = {};

  if (input.termsAndConditions && input.termsAndConditions.length > 10000) {
    errors.termsAndConditions = "Terms and conditions cannot exceed 10,000 characters";
  }

  if (input.gradingGuideUrl) {
    try {
      new URL(input.gradingGuideUrl);
    } catch {
      errors.gradingGuideUrl = "Grading guide must be a valid URL";
    }
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
  };
}

/**
 * Validate all settings at once
 */
export function validateSettings(input: TradeInSettingsInput): SettingsValidationResult {
  const allErrors: Record<string, string> = {};

  const multiplierResult = validateMultipliers(input);
  const thresholdResult = validateThresholds(input);
  const addressResult = validateReturnAddress(input.returnAddress ?? null);
  const payoutResult = validatePayoutSettings(input);
  const contentResult = validateContent(input);

  Object.assign(allErrors, multiplierResult.errors);
  Object.assign(allErrors, thresholdResult.errors);
  Object.assign(allErrors, addressResult.errors);
  Object.assign(allErrors, payoutResult.errors);
  Object.assign(allErrors, contentResult.errors);

  return {
    valid: Object.keys(allErrors).length === 0,
    errors: allErrors,
  };
}

// ============================================================================
// DATABASE OPERATIONS
// ============================================================================

/**
 * Get settings for a shop, creating defaults if none exist
 */
export async function getOrCreateSettings(shop: string) {
  let settings = await prisma.tradeInSettings.findUnique({
    where: { shop },
  });

  if (!settings) {
    settings = await prisma.tradeInSettings.create({
      data: { shop },
    });
  }

  return settings;
}

/**
 * Get settings for a shop (returns null if not found)
 */
export async function getSettings(shop: string) {
  return prisma.tradeInSettings.findUnique({
    where: { shop },
  });
}

/**
 * Update settings for a shop
 */
export async function updateSettings(
  shop: string,
  input: TradeInSettingsInput
): Promise<{ success: true; settings: Awaited<ReturnType<typeof getSettings>> } | { success: false; errors: Record<string, string> }> {
  // Validate input
  const validation = validateSettings(input);
  if (!validation.valid) {
    return { success: false, errors: validation.errors };
  }

  // Prepare data for update
  const data: Record<string, unknown> = {};

  // Pricing
  if (input.conditionMultiplierNM !== undefined) {
    data.conditionMultiplierNM = input.conditionMultiplierNM;
  }
  if (input.conditionMultiplierLP !== undefined) {
    data.conditionMultiplierLP = input.conditionMultiplierLP;
  }
  if (input.conditionMultiplierMP !== undefined) {
    data.conditionMultiplierMP = input.conditionMultiplierMP;
  }
  if (input.conditionMultiplierHP !== undefined) {
    data.conditionMultiplierHP = input.conditionMultiplierHP;
  }
  if (input.conditionMultiplierDMG !== undefined) {
    data.conditionMultiplierDMG = input.conditionMultiplierDMG;
  }
  if (input.storeCreditBonusPercent !== undefined) {
    data.storeCreditBonusPercent = input.storeCreditBonusPercent;
  }
  if (input.cashPayoutPercent !== undefined) {
    data.cashPayoutPercent = input.cashPayoutPercent;
  }

  // Thresholds
  if (input.minimumSubmissionValue !== undefined) {
    data.minimumSubmissionValue = input.minimumSubmissionValue;
  }
  if (input.requiresApprovalAbove !== undefined) {
    data.requiresApprovalAbove = input.requiresApprovalAbove;
  }
  if (input.autoApproveBelow !== undefined) {
    data.autoApproveBelow = input.autoApproveBelow;
  }
  if (input.maxItemsPerSubmission !== undefined) {
    data.maxItemsPerSubmission = input.maxItemsPerSubmission;
  }

  // Shipping
  if (input.freeShippingMinimum !== undefined) {
    data.freeShippingMinimum = input.freeShippingMinimum;
  }
  if (input.shippingLabelEnabled !== undefined) {
    data.shippingLabelEnabled = input.shippingLabelEnabled;
  }
  if (input.returnAddress !== undefined) {
    data.returnAddress = input.returnAddress ? JSON.stringify(input.returnAddress) : null;
  }

  // Notifications
  if (input.notifyOnSubmission !== undefined) {
    data.notifyOnSubmission = input.notifyOnSubmission;
  }
  if (input.notifyOnReceived !== undefined) {
    data.notifyOnReceived = input.notifyOnReceived;
  }
  if (input.notifyOnGraded !== undefined) {
    data.notifyOnGraded = input.notifyOnGraded;
  }

  // Content
  if (input.termsAndConditions !== undefined) {
    data.termsAndConditions = input.termsAndConditions;
  }
  if (input.gradingGuideUrl !== undefined) {
    data.gradingGuideUrl = input.gradingGuideUrl;
  }

  // Upsert settings
  const settings = await prisma.tradeInSettings.upsert({
    where: { shop },
    create: { shop, ...data },
    update: data,
  });

  return { success: true, settings };
}

/**
 * Parse return address from JSON string
 */
export function parseReturnAddress(json: string | null): ReturnAddress | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as ReturnAddress;
  } catch {
    return null;
  }
}

/**
 * Get multiplier for a specific condition from settings
 */
export function getMultiplierFromSettings(
  settings: Awaited<ReturnType<typeof getSettings>>,
  condition: ConditionType
): number {
  if (!settings) {
    return DEFAULT_SETTINGS[`conditionMultiplier${condition}` as keyof typeof DEFAULT_SETTINGS] as number;
  }

  const multiplierMap: Record<ConditionType, number> = {
    [Condition.NM]: settings.conditionMultiplierNM,
    [Condition.LP]: settings.conditionMultiplierLP,
    [Condition.MP]: settings.conditionMultiplierMP,
    [Condition.HP]: settings.conditionMultiplierHP,
    [Condition.DMG]: settings.conditionMultiplierDMG,
  };

  return multiplierMap[condition];
}
