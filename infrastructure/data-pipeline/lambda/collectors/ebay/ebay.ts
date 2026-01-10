/**
 * eBay Data Collector Lambda
 *
 * Collects listings and completed sales from eBay APIs.
 * Uses OAuth 2.0 for authentication.
 *
 * APIs used:
 * - Browse API: Search active listings
 * - Finding API: Search completed sales
 */

import { Handler, ScheduledEvent } from "aws-lambda";
import {
  getSecrets,
  putToKinesis,
  batchUpdateCurrentPrices,
  normalizePrice,
  normalizePriceAsync,
  fetchLiveFxRates,
  normalizeCardId,
  normalizeCondition,
  normalizeConditionWithTracking,
  RateLimiter,
  withRetry,
  nowIso,
  parseCardNumber,
  sanitizeString,
  PriceEvent,
  ListingEvent,
  SalesEvent,
  dataQualityTracker,
  fuzzyMatchCard,
  detectVariantType,
  calculateSellerReputation,
  getSellerWeightFactor,
} from "/opt/nodejs/utils";

// =============================================================================
// CONFIGURATION
// =============================================================================

const EBAY_BROWSE_API = "https://api.ebay.com/buy/browse/v1";
const EBAY_AUTH_API = "https://api.ebay.com/identity/v1/oauth2/token";

const PRICE_STREAM = process.env.PRICE_STREAM_NAME!;
const LISTING_STREAM = process.env.LISTING_STREAM_NAME!;
const SALES_STREAM = process.env.SALES_STREAM_NAME!;
const CURRENT_PRICES_TABLE = process.env.CURRENT_PRICES_TABLE!;

// Rate limiter: 5000 requests per day = ~3.5 per minute
const rateLimiter = new RateLimiter(3, 3);

// Search queries for One Piece cards
const SEARCH_QUERIES = [
  "one piece card game",
  "one piece tcg",
  "OP01",
  "OP02",
  "OP03",
  "OP04",
  "OP05",
  "OP06",
  "OP07",
  "OP08",
  "OP09",
  "OP10",
  "OP11",
  "EB01",
  "EB02",
  "romance dawn",
  "paramount war",
];

// =============================================================================
// TYPES
// =============================================================================

interface EbayItemSummary {
  itemId: string;
  title: string;
  price: {
    value: string;
    currency: string;
  };
  condition: string;
  conditionId: string;
  image?: {
    imageUrl: string;
  };
  thumbnailImages?: Array<{ imageUrl: string }>;
  seller: {
    username: string;
    feedbackPercentage: string;
    feedbackScore: number;
  };
  itemLocation?: {
    country: string;
    postalCode?: string;
  };
  buyingOptions: string[];
  itemEndDate?: string;
  itemWebUrl: string;
  categories?: Array<{
    categoryId: string;
    categoryName: string;
  }>;
  shippingOptions?: Array<{
    shippingCost?: {
      value: string;
      currency: string;
    };
  }>;
}

interface EbaySearchResponse {
  href: string;
  total: number;
  next?: string;
  offset: number;
  limit: number;
  itemSummaries?: EbayItemSummary[];
}

interface EbayAccessToken {
  access_token: string;
  expires_in: number;
  token_type: string;
}

// =============================================================================
// OAUTH 2.0 CLIENT
// =============================================================================

class EbayAuthClient {
  private clientId: string;
  private clientSecret: string;
  private accessToken: string | null = null;
  private tokenExpiry: Date | null = null;

  constructor(clientId: string, clientSecret: string) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
  }

  async getAccessToken(): Promise<string> {
    // Check if token is still valid
    if (this.accessToken && this.tokenExpiry && this.tokenExpiry > new Date()) {
      return this.accessToken;
    }

    // Get new token
    const credentials = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString(
      "base64"
    );

    const response = await fetch(EBAY_AUTH_API, {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope",
    });

    if (!response.ok) {
      throw new Error(`Failed to get eBay access token: ${response.status}`);
    }

    const data: EbayAccessToken = await response.json();

    this.accessToken = data.access_token;
    // Set expiry 5 minutes before actual expiry
    this.tokenExpiry = new Date(Date.now() + (data.expires_in - 300) * 1000);

    return this.accessToken;
  }
}

// =============================================================================
// API CLIENT
// =============================================================================

class EbayClient {
  private auth: EbayAuthClient;
  private marketplace: string;

  constructor(auth: EbayAuthClient, marketplace: string = "EBAY_US") {
    this.auth = auth;
    this.marketplace = marketplace;
  }

  private async request<T>(endpoint: string, params: URLSearchParams): Promise<T> {
    await rateLimiter.acquire();

    const accessToken = await this.auth.getAccessToken();
    const url = `${EBAY_BROWSE_API}${endpoint}?${params.toString()}`;

    const response = await withRetry(async () => {
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "X-EBAY-C-MARKETPLACE-ID": this.marketplace,
          "X-EBAY-C-ENDUSERCTX": "affiliateCampaignId=<ePNCampaignId>,affiliateReferenceId=<referenceId>",
        },
      });

      if (!res.ok) {
        if (res.status === 429) {
          throw new Error("Rate limited");
        }
        throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      }

      return res.json();
    });

    return response;
  }

  /**
   * Search for items
   */
  async searchItems(
    query: string,
    options: {
      limit?: number;
      offset?: number;
      filter?: string;
      sort?: string;
    } = {}
  ): Promise<EbaySearchResponse> {
    const params = new URLSearchParams({
      q: query,
      limit: (options.limit || 50).toString(),
      offset: (options.offset || 0).toString(),
      category_ids: "183454,2536", // Trading Card Games, Collectible Card Games
    });

    if (options.filter) {
      params.set("filter", options.filter);
    }

    if (options.sort) {
      params.set("sort", options.sort);
    }

    return this.request<EbaySearchResponse>("/item_summary/search", params);
  }

  /**
   * Search across multiple marketplaces
   */
  async searchMultipleMarketplaces(
    query: string,
    marketplaces: string[] = ["EBAY_US", "EBAY_GB", "EBAY_DE"]
  ): Promise<{ marketplace: string; items: EbayItemSummary[] }[]> {
    const results: { marketplace: string; items: EbayItemSummary[] }[] = [];

    for (const marketplace of marketplaces) {
      try {
        this.marketplace = marketplace;
        const response = await this.searchItems(query, { limit: 100 });
        results.push({
          marketplace,
          items: response.itemSummaries || [],
        });
      } catch (error) {
        console.warn(`Failed to search ${marketplace}:`, error);
      }
    }

    return results;
  }
}

// =============================================================================
// DATA PROCESSING
// =============================================================================

const EBAY_CONDITION_MAP: Record<string, string> = {
  "1000": "NM", // New
  "1500": "NM", // Open box
  "2000": "NM", // Certified Refurbished
  "2500": "NM", // Seller Refurbished
  "3000": "LP", // Used
  "4000": "LP", // Very Good
  "5000": "MP", // Good
  "6000": "HP", // Acceptable
  "7000": "DMG", // For parts/not working
};

const MARKETPLACE_CURRENCY: Record<string, string> = {
  EBAY_US: "USD",
  EBAY_GB: "GBP",
  EBAY_DE: "EUR",
  EBAY_AU: "AUD",
  EBAY_CA: "CAD",
};

interface CardInfoResult {
  setCode: string;
  cardNumber: string;
  variantType: string;
  name: string;
  fuzzyMatched: boolean;
  confidence: "high" | "medium" | "low";
}

function extractCardInfoFromTitle(title: string): CardInfoResult | null {
  const cleanTitle = sanitizeString(title);

  // Try standard pattern first
  const cardMatch = cleanTitle.match(/([A-Z]{2,3}\d{2})-(\d{3})/i);
  if (cardMatch) {
    const setCode = cardMatch[1].toUpperCase();
    const cardNumber = cardMatch[2];

    // Use standardized variant detection
    const variantType = detectVariantType(cleanTitle);

    // Extract name (everything before the card number)
    const nameMatch = cleanTitle.match(/^(.*?)(?:[A-Z]{2,3}\d{2}-\d{3})/i);
    const name = nameMatch ? nameMatch[1].trim() : cleanTitle;

    return {
      setCode,
      cardNumber,
      variantType,
      name,
      fuzzyMatched: false,
      confidence: "high",
    };
  }

  // Try fuzzy matching for non-standard formats
  const fuzzyResult = fuzzyMatchCard(cleanTitle);
  if (fuzzyResult) {
    // Extract name (use full title if we can't find a better one)
    const name = cleanTitle.replace(/[A-Z]{2,3}\d{2}[\s\-\/\.]\d{3}/gi, "").trim() || cleanTitle;

    return {
      setCode: fuzzyResult.setCode,
      cardNumber: fuzzyResult.cardNumber,
      variantType: fuzzyResult.variantType,
      name,
      fuzzyMatched: true,
      confidence: fuzzyResult.confidence,
    };
  }

  // Record dropped for analysis
  dataQualityTracker.recordDropped("ebay", "no_card_id_pattern", { title });

  return null;
}

interface ExtendedPriceEvent extends PriceEvent {
  sellerReputationTier?: string;
  sellerWeightFactor?: number;
  fuzzyMatched?: boolean;
  matchConfidence?: string;
  conditionKnown?: boolean;
}

function createPriceEventFromListing(
  item: EbayItemSummary,
  marketplace: string,
  collectedAt: string
): ExtendedPriceEvent | null {
  const source = `ebay_${marketplace.toLowerCase().replace("ebay_", "")}`;

  const cardInfo = extractCardInfoFromTitle(item.title);
  if (!cardInfo) {
    // Already tracked by extractCardInfoFromTitle
    return null;
  }

  const { setCode, cardNumber, variantType, name, fuzzyMatched, confidence } = cardInfo;
  const cardId = normalizeCardId(setCode, cardNumber, variantType);

  const price = parseFloat(item.price.value);
  if (isNaN(price) || price <= 0) {
    dataQualityTracker.recordDropped(source, "invalid_price", {
      title: item.title,
      rawData: { price: item.price.value },
    });
    return null;
  }

  const currency = item.price.currency || MARKETPLACE_CURRENCY[marketplace] || "USD";
  const { priceUsd, priceGbp } = normalizePrice(price, currency);

  // Normalize condition with tracking
  const conditionResult = normalizeConditionWithTracking(
    EBAY_CONDITION_MAP[item.conditionId] || item.condition || ""
  );
  const condition = conditionResult.isKnown ? conditionResult.condition : "NM";

  // Calculate seller reputation
  const sellerFeedbackPct = parseFloat(item.seller.feedbackPercentage) || undefined;
  const sellerRepTier = calculateSellerReputation(
    sellerFeedbackPct,
    item.seller.feedbackScore
  );
  const weightFactor = getSellerWeightFactor(sellerRepTier);

  // Detect language from marketplace or title
  let language = "EN";
  if (marketplace === "EBAY_DE") language = "DE";
  if (item.title.toLowerCase().includes("japanese") || item.title.includes("日本語")) {
    language = "JP";
  }

  // Track successful parse
  dataQualityTracker.recordSuccess(source, {
    fuzzyMatched,
    unknownCondition: !conditionResult.isKnown,
  });

  return {
    eventType: "price",
    source,
    cardId,
    externalId: item.itemId,
    name,
    setCode,
    cardNumber,
    variantType,
    condition,
    language,
    price,
    currency,
    priceUsd,
    priceGbp,
    listingsCount: 1,
    sellerId: item.seller.username,
    timestamp: collectedAt,
    collectedAt,
    // Extended fields for data quality
    sellerReputationTier: sellerRepTier,
    sellerWeightFactor: weightFactor,
    fuzzyMatched,
    matchConfidence: confidence,
    conditionKnown: conditionResult.isKnown,
  };
}

function createListingEvent(
  item: EbayItemSummary,
  marketplace: string,
  collectedAt: string
): ListingEvent | null {
  const cardInfo = extractCardInfoFromTitle(item.title);
  const cardId = cardInfo
    ? normalizeCardId(cardInfo.setCode, cardInfo.cardNumber, cardInfo.variantType)
    : "";

  const price = parseFloat(item.price.value);
  if (isNaN(price) || price <= 0) {
    return null;
  }

  const condition = EBAY_CONDITION_MAP[item.conditionId] || "NM";
  const isAuction = item.buyingOptions.includes("AUCTION");

  return {
    eventType: "listing",
    source: `ebay_${marketplace.toLowerCase().replace("ebay_", "")}`,
    listingId: item.itemId,
    cardId,
    title: item.title,
    description: undefined, // Would need additional API call
    price,
    currency: item.price.currency,
    condition,
    sellerId: item.seller.username,
    sellerFeedback: parseFloat(item.seller.feedbackPercentage) || undefined,
    sellerFeedbackCount: item.seller.feedbackScore,
    imageUrls: item.thumbnailImages?.map((img) => img.imageUrl),
    isAuction,
    endTime: item.itemEndDate,
    timestamp: collectedAt,
    collectedAt,
  };
}

// =============================================================================
// MAIN HANDLER
// =============================================================================

export const handler: Handler<ScheduledEvent> = async (event) => {
  console.log("eBay collector started", { event });
  const collectedAt = nowIso();

  // Reset data quality tracker for this run
  dataQualityTracker.reset();

  try {
    // Fetch live FX rates before processing
    await fetchLiveFxRates();

    // Get API credentials
    const secrets = await getSecrets();
    if (!secrets.ebay_client_id || !secrets.ebay_client_secret) {
      throw new Error("eBay API credentials not configured");
    }

    const auth = new EbayAuthClient(
      secrets.ebay_client_id,
      secrets.ebay_client_secret
    );
    const client = new EbayClient(auth);

    const allPriceEvents: ExtendedPriceEvent[] = [];
    const allListingEvents: ListingEvent[] = [];

    // Search across marketplaces
    const marketplaces = ["EBAY_US", "EBAY_GB", "EBAY_DE"];

    for (const query of SEARCH_QUERIES) {
      console.log(`Searching for: ${query}`);

      try {
        const results = await client.searchMultipleMarketplaces(query, marketplaces);

        for (const { marketplace, items } of results) {
          console.log(`  ${marketplace}: ${items.length} items`);

          for (const item of items) {
            // Create price event
            const priceEvent = createPriceEventFromListing(item, marketplace, collectedAt);
            if (priceEvent) {
              allPriceEvents.push(priceEvent);
            }

            // Create listing event
            const listingEvent = createListingEvent(item, marketplace, collectedAt);
            if (listingEvent) {
              allListingEvents.push(listingEvent);
            }
          }
        }
      } catch (error) {
        console.warn(`Failed to search for "${query}":`, error);
      }
    }

    // Deduplicate price events (keep lowest price per card)
    const uniquePrices = new Map<string, PriceEvent>();
    for (const event of allPriceEvents) {
      const key = `${event.cardId}-${event.condition}-${event.source}`;
      const existing = uniquePrices.get(key);
      if (!existing || event.priceUsd < existing.priceUsd) {
        uniquePrices.set(key, event);
      }
    }

    const finalPriceEvents = Array.from(uniquePrices.values());

    console.log(`Collected ${finalPriceEvents.length} unique price events`);
    console.log(`Collected ${allListingEvents.length} listing events`);

    // Send to Kinesis
    if (finalPriceEvents.length > 0) {
      await putToKinesis(PRICE_STREAM, finalPriceEvents);
    }

    if (allListingEvents.length > 0) {
      await putToKinesis(LISTING_STREAM, allListingEvents);
    }

    // Update DynamoDB
    if (finalPriceEvents.length > 0) {
      await batchUpdateCurrentPrices(CURRENT_PRICES_TABLE, finalPriceEvents);
    }

    // Log data quality summary
    dataQualityTracker.logSummary();

    // Get data quality metrics for response
    const qualityMetrics = dataQualityTracker.getMetrics();
    const droppedSample = dataQualityTracker.getDroppedRecords().slice(0, 10);

    return {
      statusCode: 200,
      body: JSON.stringify({
        priceEvents: finalPriceEvents.length,
        listingEvents: allListingEvents.length,
        queriesProcessed: SEARCH_QUERIES.length,
        collectedAt,
        dataQuality: {
          metrics: qualityMetrics,
          droppedSample,
        },
      }),
    };
  } catch (error) {
    console.error("eBay collector error:", error);

    // Still log data quality even on error
    dataQualityTracker.logSummary();

    throw error;
  }
};
