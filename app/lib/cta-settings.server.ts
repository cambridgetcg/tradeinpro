/**
 * CTA Block Settings Management
 * Handles saving CTA settings to database and syncing to Shopify metafields
 */

import prisma from "../db.server";

// Type for Shopify Admin GraphQL client
interface AdminGraphQLClient {
  graphql(query: string, options?: { variables?: Record<string, unknown> }): Promise<Response>;
}

// ============================================================================
// TYPES
// ============================================================================

export interface CTASettings {
  ctaTitle: string | null;
  ctaDescription: string | null;
  ctaButtonText: string | null;
  ctaButtonLink: string | null;
  ctaShowFeatures: boolean;
  ctaFeature1Title: string | null;
  ctaFeature1Desc: string | null;
  ctaFeature2Title: string | null;
  ctaFeature2Desc: string | null;
  ctaFeature3Title: string | null;
  ctaFeature3Desc: string | null;
}

export interface CTASettingsInput {
  ctaTitle?: string | null;
  ctaDescription?: string | null;
  ctaButtonText?: string | null;
  ctaButtonLink?: string | null;
  ctaShowFeatures?: boolean;
  ctaFeature1Title?: string | null;
  ctaFeature1Desc?: string | null;
  ctaFeature2Title?: string | null;
  ctaFeature2Desc?: string | null;
  ctaFeature3Title?: string | null;
  ctaFeature3Desc?: string | null;
}

// Default CTA settings
export const DEFAULT_CTA_SETTINGS: CTASettings = {
  ctaTitle: "Trade In Your Cards",
  ctaDescription: "Turn your trading cards into cash or store credit",
  ctaButtonText: "Start Trade-In",
  ctaButtonLink: "/pages/trade-in",
  ctaShowFeatures: true,
  ctaFeature1Title: "Fast Payouts",
  ctaFeature1Desc: "Get paid within 48 hours",
  ctaFeature2Title: "10% Bonus",
  ctaFeature2Desc: "Extra 10% for store credit",
  ctaFeature3Title: "Free Shipping",
  ctaFeature3Desc: "On orders over £50",
};

// ============================================================================
// DATABASE OPERATIONS
// ============================================================================

/**
 * Get CTA settings from database
 */
export async function getCTASettings(shop: string): Promise<CTASettings> {
  const settings = await prisma.tradeInSettings.findUnique({
    where: { shop },
    select: {
      ctaTitle: true,
      ctaDescription: true,
      ctaButtonText: true,
      ctaButtonLink: true,
      ctaShowFeatures: true,
      ctaFeature1Title: true,
      ctaFeature1Desc: true,
      ctaFeature2Title: true,
      ctaFeature2Desc: true,
      ctaFeature3Title: true,
      ctaFeature3Desc: true,
    },
  });

  if (!settings) {
    return DEFAULT_CTA_SETTINGS;
  }

  return {
    ctaTitle: settings.ctaTitle ?? DEFAULT_CTA_SETTINGS.ctaTitle,
    ctaDescription: settings.ctaDescription ?? DEFAULT_CTA_SETTINGS.ctaDescription,
    ctaButtonText: settings.ctaButtonText ?? DEFAULT_CTA_SETTINGS.ctaButtonText,
    ctaButtonLink: settings.ctaButtonLink ?? DEFAULT_CTA_SETTINGS.ctaButtonLink,
    ctaShowFeatures: settings.ctaShowFeatures ?? DEFAULT_CTA_SETTINGS.ctaShowFeatures,
    ctaFeature1Title: settings.ctaFeature1Title ?? DEFAULT_CTA_SETTINGS.ctaFeature1Title,
    ctaFeature1Desc: settings.ctaFeature1Desc ?? DEFAULT_CTA_SETTINGS.ctaFeature1Desc,
    ctaFeature2Title: settings.ctaFeature2Title ?? DEFAULT_CTA_SETTINGS.ctaFeature2Title,
    ctaFeature2Desc: settings.ctaFeature2Desc ?? DEFAULT_CTA_SETTINGS.ctaFeature2Desc,
    ctaFeature3Title: settings.ctaFeature3Title ?? DEFAULT_CTA_SETTINGS.ctaFeature3Title,
    ctaFeature3Desc: settings.ctaFeature3Desc ?? DEFAULT_CTA_SETTINGS.ctaFeature3Desc,
  };
}

/**
 * Save CTA settings to database
 */
export async function saveCTASettings(
  shop: string,
  input: CTASettingsInput
): Promise<CTASettings> {
  const settings = await prisma.tradeInSettings.upsert({
    where: { shop },
    create: {
      shop,
      ...input,
    },
    update: input,
    select: {
      ctaTitle: true,
      ctaDescription: true,
      ctaButtonText: true,
      ctaButtonLink: true,
      ctaShowFeatures: true,
      ctaFeature1Title: true,
      ctaFeature1Desc: true,
      ctaFeature2Title: true,
      ctaFeature2Desc: true,
      ctaFeature3Title: true,
      ctaFeature3Desc: true,
    },
  });

  return {
    ctaTitle: settings.ctaTitle,
    ctaDescription: settings.ctaDescription,
    ctaButtonText: settings.ctaButtonText,
    ctaButtonLink: settings.ctaButtonLink,
    ctaShowFeatures: settings.ctaShowFeatures,
    ctaFeature1Title: settings.ctaFeature1Title,
    ctaFeature1Desc: settings.ctaFeature1Desc,
    ctaFeature2Title: settings.ctaFeature2Title,
    ctaFeature2Desc: settings.ctaFeature2Desc,
    ctaFeature3Title: settings.ctaFeature3Title,
    ctaFeature3Desc: settings.ctaFeature3Desc,
  };
}

// ============================================================================
// SHOPIFY METAFIELD SYNC
// ============================================================================

const METAFIELD_NAMESPACE = "cardforum";

/**
 * Sync CTA settings to Shopify shop metafields
 */
export async function syncCTAToMetafields(
  admin: AdminGraphQLClient,
  settings: CTASettings
): Promise<{ success: boolean; errors: string[] }> {
  const errors: string[] = [];

  // Build metafield inputs
  const metafields = [
    { key: "cta_title", value: settings.ctaTitle || "", type: "single_line_text_field" },
    { key: "cta_description", value: settings.ctaDescription || "", type: "single_line_text_field" },
    { key: "cta_button_text", value: settings.ctaButtonText || "", type: "single_line_text_field" },
    { key: "cta_button_link", value: settings.ctaButtonLink || "", type: "single_line_text_field" },
    { key: "cta_show_features", value: settings.ctaShowFeatures ? "true" : "false", type: "boolean" },
    {
      key: "cta_feature_1",
      value: `${settings.ctaFeature1Title || ""}|${settings.ctaFeature1Desc || ""}`,
      type: "single_line_text_field"
    },
    {
      key: "cta_feature_2",
      value: `${settings.ctaFeature2Title || ""}|${settings.ctaFeature2Desc || ""}`,
      type: "single_line_text_field"
    },
    {
      key: "cta_feature_3",
      value: `${settings.ctaFeature3Title || ""}|${settings.ctaFeature3Desc || ""}`,
      type: "single_line_text_field"
    },
  ];

  // Use metafieldsSet mutation to update all metafields at once
  const mutation = `
    mutation MetafieldsSet($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields {
          key
          namespace
          value
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  try {
    const response = await admin.graphql(mutation, {
      variables: {
        metafields: metafields.map((mf) => ({
          namespace: METAFIELD_NAMESPACE,
          key: mf.key,
          value: mf.value,
          type: mf.type,
          ownerId: "gid://shopify/Shop", // Current shop
        })),
      },
    });

    const data = await response.json();

    if (data.data?.metafieldsSet?.userErrors?.length > 0) {
      for (const error of data.data.metafieldsSet.userErrors) {
        errors.push(`${error.field}: ${error.message}`);
      }
    }

    return { success: errors.length === 0, errors };
  } catch (error) {
    console.error("Failed to sync metafields:", error);
    errors.push(error instanceof Error ? error.message : "Unknown error");
    return { success: false, errors };
  }
}

/**
 * Fetch current CTA metafields from Shopify
 */
export async function fetchCTAMetafields(
  admin: AdminGraphQLClient
): Promise<CTASettings> {
  const query = `
    query GetShopMetafields {
      shop {
        metafields(namespace: "cardforum", first: 10) {
          edges {
            node {
              key
              value
            }
          }
        }
      }
    }
  `;

  try {
    const response = await admin.graphql(query);
    const data = await response.json();

    const metafields = data.data?.shop?.metafields?.edges || [];
    const metafieldMap: Record<string, string> = {};

    for (const edge of metafields) {
      metafieldMap[edge.node.key] = edge.node.value;
    }

    // Parse feature fields (format: "Title|Description")
    const parseFeature = (value: string | undefined): { title: string | null; desc: string | null } => {
      if (!value) return { title: null, desc: null };
      const parts = value.split("|");
      return { title: parts[0] || null, desc: parts[1] || null };
    };

    const feature1 = parseFeature(metafieldMap.cta_feature_1);
    const feature2 = parseFeature(metafieldMap.cta_feature_2);
    const feature3 = parseFeature(metafieldMap.cta_feature_3);

    return {
      ctaTitle: metafieldMap.cta_title || DEFAULT_CTA_SETTINGS.ctaTitle,
      ctaDescription: metafieldMap.cta_description || DEFAULT_CTA_SETTINGS.ctaDescription,
      ctaButtonText: metafieldMap.cta_button_text || DEFAULT_CTA_SETTINGS.ctaButtonText,
      ctaButtonLink: metafieldMap.cta_button_link || DEFAULT_CTA_SETTINGS.ctaButtonLink,
      ctaShowFeatures: metafieldMap.cta_show_features === "true",
      ctaFeature1Title: feature1.title || DEFAULT_CTA_SETTINGS.ctaFeature1Title,
      ctaFeature1Desc: feature1.desc || DEFAULT_CTA_SETTINGS.ctaFeature1Desc,
      ctaFeature2Title: feature2.title || DEFAULT_CTA_SETTINGS.ctaFeature2Title,
      ctaFeature2Desc: feature2.desc || DEFAULT_CTA_SETTINGS.ctaFeature2Desc,
      ctaFeature3Title: feature3.title || DEFAULT_CTA_SETTINGS.ctaFeature3Title,
      ctaFeature3Desc: feature3.desc || DEFAULT_CTA_SETTINGS.ctaFeature3Desc,
    };
  } catch (error) {
    console.error("Failed to fetch metafields:", error);
    return DEFAULT_CTA_SETTINGS;
  }
}

/**
 * Save CTA settings and sync to Shopify metafields
 */
export async function saveCTASettingsAndSync(
  shop: string,
  admin: AdminGraphQLClient,
  input: CTASettingsInput
): Promise<{ settings: CTASettings; syncSuccess: boolean; syncErrors: string[] }> {
  // Save to database first
  const settings = await saveCTASettings(shop, input);

  // Then sync to Shopify metafields
  const syncResult = await syncCTAToMetafields(admin, settings);

  return {
    settings,
    syncSuccess: syncResult.success,
    syncErrors: syncResult.errors,
  };
}
