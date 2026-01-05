/**
 * Feature Flags System
 *
 * Simple feature flag system for controlling features without deployment.
 * Flags can be stored in database (TradeInSettings) or environment variables.
 *
 * @synapse CODE_SYNAPSE.md - See ./CODE_SYNAPSE.md for module dependencies
 *
 * USAGE:
 *   import { isFeatureEnabled, getFeatureFlags } from "./feature-flags.server";
 *
 *   // Check single flag
 *   if (await isFeatureEnabled("royalMailEnabled", shop)) {
 *     // Use Royal Mail
 *   }
 *
 *   // Get all flags
 *   const flags = await getFeatureFlags(shop);
 *   if (flags.priceFreshnessBlocking) {
 *     // Block stale submissions
 *   }
 *
 * FLAG SOURCES (in priority order):
 *   1. Environment variables (FEATURE_FLAG_<NAME>=true/false)
 *   2. Database (TradeInSettings JSON column)
 *   3. Default values
 */

import { getOrCreateSettings, invalidateSettingsCache } from "./settings.server";

// ============================================================================
// Types
// ============================================================================

/**
 * All available feature flags
 */
export interface FeatureFlags {
  /** Enable Royal Mail shipping integration */
  royalMailEnabled: boolean;
  /** Block submissions with stale prices (>24h) instead of just warning */
  priceFreshnessBlocking: boolean;
  /** Enable new payout methods (PayPal, etc.) */
  newPayoutMethods: boolean;
  /** Enable Japanese card support */
  japaneseCardsEnabled: boolean;
  /** Enable debug logging in production */
  debugLogging: boolean;
  /** Enable beta features for testing */
  betaFeatures: boolean;
  /** Enable automatic gift card creation */
  autoGiftCards: boolean;
  /** Enable submission notifications */
  notificationsEnabled: boolean;
}

export type FeatureFlagName = keyof FeatureFlags;

// ============================================================================
// Default Values
// ============================================================================

const DEFAULT_FLAGS: FeatureFlags = {
  royalMailEnabled: false,
  priceFreshnessBlocking: false,
  newPayoutMethods: false,
  japaneseCardsEnabled: true,
  debugLogging: false,
  betaFeatures: false,
  autoGiftCards: true,
  notificationsEnabled: true,
};

// ============================================================================
// Environment Variable Overrides
// ============================================================================

/**
 * Check for environment variable override
 * Environment variables take highest priority
 *
 * Format: FEATURE_FLAG_ROYAL_MAIL_ENABLED=true
 */
function getEnvOverride(flagName: FeatureFlagName): boolean | null {
  // Convert camelCase to SCREAMING_SNAKE_CASE
  const envName =
    "FEATURE_FLAG_" +
    flagName
      .replace(/([A-Z])/g, "_$1")
      .toUpperCase()
      .replace(/^_/, "");

  const value = process.env[envName];

  if (value === undefined || value === "") {
    return null;
  }

  return value.toLowerCase() === "true" || value === "1";
}

// ============================================================================
// In-Memory Cache
// ============================================================================

interface CacheEntry {
  flags: FeatureFlags;
  expires: number;
}

const flagsCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function getCachedFlags(shop: string): FeatureFlags | null {
  const entry = flagsCache.get(shop);
  if (!entry) return null;

  if (Date.now() > entry.expires) {
    flagsCache.delete(shop);
    return null;
  }

  return entry.flags;
}

function setCachedFlags(shop: string, flags: FeatureFlags): void {
  flagsCache.set(shop, {
    flags,
    expires: Date.now() + CACHE_TTL_MS,
  });
}

/**
 * Invalidate feature flags cache for a shop
 */
export function invalidateFeatureFlagsCache(shop?: string): void {
  if (shop) {
    flagsCache.delete(shop);
  } else {
    flagsCache.clear();
  }
}

// ============================================================================
// Main API
// ============================================================================

/**
 * Get all feature flags for a shop
 * Merges default flags with database overrides and environment overrides
 */
export async function getFeatureFlags(shop: string): Promise<FeatureFlags> {
  // Check cache first
  const cached = getCachedFlags(shop);
  if (cached) {
    return cached;
  }

  // Start with defaults
  const flags: FeatureFlags = { ...DEFAULT_FLAGS };

  // Apply database overrides from settings
  try {
    const settings = await getOrCreateSettings(shop);

    // Royal Mail is stored directly in settings
    if (settings.royalMailEnabled !== null) {
      flags.royalMailEnabled = settings.royalMailEnabled;
    }

    // Other flags could be stored in a JSON column
    // For now, we use settings fields that exist
    if (settings.notifyOnSubmission !== null) {
      flags.notificationsEnabled = settings.notifyOnSubmission;
    }
  } catch (error) {
    const { logger } = await import("./observability.server");
    logger.warn("Failed to load feature flags from settings, using defaults", {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // Apply environment variable overrides (highest priority)
  for (const flagName of Object.keys(flags) as FeatureFlagName[]) {
    const envOverride = getEnvOverride(flagName);
    if (envOverride !== null) {
      flags[flagName] = envOverride;
    }
  }

  // Cache the result
  setCachedFlags(shop, flags);

  return flags;
}

/**
 * Check if a specific feature is enabled
 */
export async function isFeatureEnabled(
  flagName: FeatureFlagName,
  shop: string
): Promise<boolean> {
  // Quick check for environment override first (avoids DB call)
  const envOverride = getEnvOverride(flagName);
  if (envOverride !== null) {
    return envOverride;
  }

  const flags = await getFeatureFlags(shop);
  return flags[flagName];
}

/**
 * Check if a specific feature is enabled (synchronous, uses cache only)
 * Returns default if not cached - use for non-critical paths
 */
export function isFeatureEnabledSync(
  flagName: FeatureFlagName,
  shop: string
): boolean {
  // Check environment override
  const envOverride = getEnvOverride(flagName);
  if (envOverride !== null) {
    return envOverride;
  }

  // Check cache
  const cached = getCachedFlags(shop);
  if (cached) {
    return cached[flagName];
  }

  // Return default
  return DEFAULT_FLAGS[flagName];
}

/**
 * Get the default value for a feature flag
 */
export function getDefaultFlag(flagName: FeatureFlagName): boolean {
  return DEFAULT_FLAGS[flagName];
}

/**
 * Get all feature flag names
 */
export function getAllFlagNames(): FeatureFlagName[] {
  return Object.keys(DEFAULT_FLAGS) as FeatureFlagName[];
}

// ============================================================================
// Debugging & Admin
// ============================================================================

/**
 * Get feature flags with metadata for admin display
 */
export async function getFeatureFlagsWithMeta(shop: string): Promise<{
  flags: FeatureFlags;
  sources: Record<FeatureFlagName, "default" | "database" | "environment">;
}> {
  const flags = await getFeatureFlags(shop);
  const sources: Record<FeatureFlagName, "default" | "database" | "environment"> =
    {} as Record<FeatureFlagName, "default" | "database" | "environment">;

  for (const flagName of Object.keys(flags) as FeatureFlagName[]) {
    const envOverride = getEnvOverride(flagName);
    if (envOverride !== null) {
      sources[flagName] = "environment";
    } else if (flags[flagName] !== DEFAULT_FLAGS[flagName]) {
      sources[flagName] = "database";
    } else {
      sources[flagName] = "default";
    }
  }

  return { flags, sources };
}
