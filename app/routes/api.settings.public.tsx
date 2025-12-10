/**
 * Public Settings API
 *
 * Exposes trade-in configuration settings to the storefront theme.
 * This endpoint is accessed via the App Proxy and returns:
 * - Condition codes with labels and multipliers
 * - Minimum submission value
 * - Store credit bonus percentage
 * - Free shipping threshold
 *
 * GET /apps/trade-in/settings
 */

import type { LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { Condition, ConditionLabels, type ConditionType } from "../lib/constants";
import { DEFAULT_SETTINGS } from "../lib/settings.server";
import { jsonResponse, errorResponse } from "../lib/app-proxy.server";

// ============================================================================
// TYPES
// ============================================================================

interface ConditionConfig {
  code: ConditionType;
  name: string;
  multiplier: number;
}

interface ReturnAddress {
  companyName?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  postalCode?: string;
  country?: string;
}

interface PublicSettingsResponse {
  conditions: ConditionConfig[];
  minimumValue: number;
  storeCreditBonus: number;
  freeShippingThreshold: number;
  returnAddress?: ReturnAddress;
}

// ============================================================================
// LOADER
// ============================================================================

export async function loader({ request }: LoaderFunctionArgs) {
  try {
    // Get settings from database (use first settings record for now)
    // In a multi-tenant setup, this would be filtered by shop
    const settings = await prisma.tradeInSettings.findFirst();

    // Build condition configuration array
    const conditions: ConditionConfig[] = [
      {
        code: Condition.NM,
        name: ConditionLabels[Condition.NM],
        multiplier: settings?.conditionMultiplierNM ?? DEFAULT_SETTINGS.conditionMultiplierNM,
      },
      {
        code: Condition.LP,
        name: ConditionLabels[Condition.LP],
        multiplier: settings?.conditionMultiplierLP ?? DEFAULT_SETTINGS.conditionMultiplierLP,
      },
      {
        code: Condition.MP,
        name: ConditionLabels[Condition.MP],
        multiplier: settings?.conditionMultiplierMP ?? DEFAULT_SETTINGS.conditionMultiplierMP,
      },
      {
        code: Condition.HP,
        name: ConditionLabels[Condition.HP],
        multiplier: settings?.conditionMultiplierHP ?? DEFAULT_SETTINGS.conditionMultiplierHP,
      },
      {
        code: Condition.DMG,
        name: ConditionLabels[Condition.DMG],
        multiplier: settings?.conditionMultiplierDMG ?? DEFAULT_SETTINGS.conditionMultiplierDMG,
      },
    ];

    // Parse return address from JSON string if available
    let returnAddress: ReturnAddress | undefined;
    if (settings?.returnAddress) {
      try {
        returnAddress = JSON.parse(settings.returnAddress) as ReturnAddress;
      } catch (e) {
        console.warn("Failed to parse return address JSON:", e);
      }
    }

    const response: PublicSettingsResponse = {
      conditions,
      minimumValue: settings?.minimumSubmissionValue ?? DEFAULT_SETTINGS.minimumSubmissionValue,
      storeCreditBonus: (settings?.storeCreditBonusPercent ?? DEFAULT_SETTINGS.storeCreditBonusPercent) / 100,
      freeShippingThreshold: settings?.freeShippingMinimum ?? DEFAULT_SETTINGS.freeShippingMinimum,
      returnAddress,
    };

    return jsonResponse(response);
  } catch (error) {
    console.error("Error fetching public settings:", error);
    return errorResponse(500, "internal_error", "Failed to load settings");
  }
}
