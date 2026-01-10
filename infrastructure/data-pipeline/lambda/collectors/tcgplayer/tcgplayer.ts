/**
 * TCGplayer Data Collector Lambda
 *
 * Collects price and sales data from the TCGplayer API.
 * Runs every 5 minutes via EventBridge schedule.
 *
 * TCGplayer API endpoints used:
 * - /pricing/product/{productId}/prices - Get current prices
 * - /catalog/products - Search products
 * - /pricing/marketprices - Get market prices
 */

import { Handler, ScheduledEvent } from "aws-lambda";
import {
  getSecrets,
  putToKinesis,
  batchUpdateCurrentPrices,
  writePriceToTimestream,
  normalizePrice,
  normalizeCardId,
  normalizeCondition,
  RateLimiter,
  withRetry,
  nowIso,
  chunkArray,
  PriceEvent,
  SalesEvent,
} from "/opt/nodejs/utils";

// =============================================================================
// CONFIGURATION
// =============================================================================

const TCGPLAYER_API_BASE = "https://api.tcgplayer.com";
const TCGPLAYER_CATEGORY_ID = 73; // One Piece Card Game category ID

const PRICE_STREAM = process.env.PRICE_STREAM_NAME!;
const SALES_STREAM = process.env.SALES_STREAM_NAME!;
const CURRENT_PRICES_TABLE = process.env.CURRENT_PRICES_TABLE!;
const TIMESTREAM_DATABASE = process.env.TIMESTREAM_DATABASE!;

// Rate limiter: 300 requests per minute = 5 per second
const rateLimiter = new RateLimiter(5, 5);

// =============================================================================
// TYPES
// =============================================================================

interface TCGplayerProduct {
  productId: number;
  name: string;
  cleanName: string;
  imageUrl: string;
  categoryId: number;
  groupId: number;
  url: string;
  modifiedOn: string;
  extendedData: Array<{
    name: string;
    displayName: string;
    value: string;
  }>;
}

interface TCGplayerPrice {
  productId: number;
  lowPrice: number | null;
  midPrice: number | null;
  highPrice: number | null;
  marketPrice: number | null;
  directLowPrice: number | null;
  subTypeName: string; // "Normal", "Foil", "1st Edition", etc.
}

interface TCGplayerSale {
  productId: number;
  orderDate: string;
  condition: string;
  variant: string;
  quantity: number;
  purchasePrice: number;
  shippingPrice: number;
}

interface TCGplayerGroup {
  groupId: number;
  name: string;
  abbreviation: string;
  supplemental: boolean;
  publishedOn: string;
  modifiedOn: string;
  categoryId: number;
}

// =============================================================================
// API CLIENT
// =============================================================================

class TCGplayerClient {
  private accessToken: string;
  private tokenExpiry: Date | null = null;
  private apiKey: string;

  constructor(apiKey: string, accessToken: string) {
    this.apiKey = apiKey;
    this.accessToken = accessToken;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    await rateLimiter.acquire();

    const url = `${TCGPLAYER_API_BASE}${endpoint}`;

    const response = await withRetry(async () => {
      const res = await fetch(url, {
        ...options,
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          "Content-Type": "application/json",
          ...options.headers,
        },
      });

      if (!res.ok) {
        if (res.status === 429) {
          // Rate limited - wait and retry
          const retryAfter = res.headers.get("Retry-After") || "60";
          throw new Error(`Rate limited. Retry after ${retryAfter}s`);
        }
        throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      }

      return res.json();
    });

    return response;
  }

  /**
   * Get all product groups (sets) for One Piece
   */
  async getGroups(): Promise<TCGplayerGroup[]> {
    const response = await this.request<{ results: TCGplayerGroup[] }>(
      `/catalog/categories/${TCGPLAYER_CATEGORY_ID}/groups?limit=100`
    );
    return response.results;
  }

  /**
   * Get products in a group
   */
  async getProductsByGroup(
    groupId: number,
    offset: number = 0,
    limit: number = 100
  ): Promise<{ products: TCGplayerProduct[]; totalItems: number }> {
    const response = await this.request<{
      results: TCGplayerProduct[];
      totalItems: number;
    }>(
      `/catalog/products?categoryId=${TCGPLAYER_CATEGORY_ID}&groupId=${groupId}&offset=${offset}&limit=${limit}`
    );
    return { products: response.results, totalItems: response.totalItems };
  }

  /**
   * Get prices for multiple products
   */
  async getPrices(productIds: number[]): Promise<TCGplayerPrice[]> {
    if (productIds.length === 0) return [];

    // TCGplayer allows up to 250 product IDs per request
    const chunks = chunkArray(productIds, 250);
    const allPrices: TCGplayerPrice[] = [];

    for (const chunk of chunks) {
      const response = await this.request<{ results: TCGplayerPrice[] }>(
        `/pricing/product/${chunk.join(",")}`
      );
      allPrices.push(...response.results);
    }

    return allPrices;
  }

  /**
   * Get recent sales for a product
   */
  async getRecentSales(
    productId: number,
    condition?: string
  ): Promise<TCGplayerSale[]> {
    let endpoint = `/pricing/product/${productId}/recentSales`;
    if (condition) {
      endpoint += `?condition=${encodeURIComponent(condition)}`;
    }

    const response = await this.request<{ data: TCGplayerSale[] }>(endpoint);
    return response.data || [];
  }

  /**
   * Get market prices (aggregated)
   */
  async getMarketPrices(productIds: number[]): Promise<TCGplayerPrice[]> {
    if (productIds.length === 0) return [];

    const chunks = chunkArray(productIds, 250);
    const allPrices: TCGplayerPrice[] = [];

    for (const chunk of chunks) {
      const response = await this.request<{ results: TCGplayerPrice[] }>(
        `/pricing/marketprices/${chunk.join(",")}`
      );
      allPrices.push(...response.results);
    }

    return allPrices;
  }
}

// =============================================================================
// DATA PROCESSING
// =============================================================================

function extractCardInfo(product: TCGplayerProduct): {
  setCode: string;
  cardNumber: string;
  variantType: string;
} {
  // Extract from extended data
  let setCode = "";
  let cardNumber = "";
  let variantType = "regular";

  for (const ext of product.extendedData) {
    if (ext.name === "Number") {
      // Format is usually "OP01-001" or similar
      const parts = ext.value.split("-");
      if (parts.length >= 2) {
        setCode = parts[0];
        cardNumber = parts[1];
      }
    }
    if (ext.name === "Rarity") {
      // Check for special variants
      const rarity = ext.value.toLowerCase();
      if (rarity.includes("alternate") || rarity.includes("parallel")) {
        variantType = "parallel";
      } else if (rarity.includes("manga")) {
        variantType = "manga";
      } else if (rarity.includes("sp")) {
        variantType = "sp";
      }
    }
  }

  // Try to extract from name if not found
  if (!setCode || !cardNumber) {
    const nameMatch = product.name.match(/([A-Z]+\d+)-(\d+)/i);
    if (nameMatch) {
      setCode = nameMatch[1];
      cardNumber = nameMatch[2];
    }
  }

  return { setCode, cardNumber, variantType };
}

function mapSubTypeToCondition(subType: string): string {
  // TCGplayer uses subTypeName for condition/variant
  const normalized = subType.toLowerCase();

  if (normalized.includes("near mint")) return "NM";
  if (normalized.includes("lightly")) return "LP";
  if (normalized.includes("moderately")) return "MP";
  if (normalized.includes("heavily")) return "HP";
  if (normalized.includes("damaged")) return "DMG";

  return "NM"; // Default
}

function createPriceEvent(
  product: TCGplayerProduct,
  price: TCGplayerPrice,
  collectedAt: string
): PriceEvent | null {
  const { setCode, cardNumber, variantType } = extractCardInfo(product);

  if (!setCode || !cardNumber) {
    console.warn(`Could not extract card info for product ${product.productId}`);
    return null;
  }

  const cardId = normalizeCardId(setCode, cardNumber, variantType);
  const condition = mapSubTypeToCondition(price.subTypeName);

  // Use market price, falling back to mid, then low
  const priceValue = price.marketPrice ?? price.midPrice ?? price.lowPrice ?? 0;
  if (priceValue === 0) return null;

  const { priceUsd, priceGbp } = normalizePrice(priceValue, "USD");

  return {
    eventType: "price",
    source: "tcgplayer",
    cardId,
    externalId: product.productId.toString(),
    name: product.cleanName,
    setCode,
    cardNumber,
    variantType,
    condition,
    language: "EN", // TCGplayer is primarily English
    price: priceValue,
    currency: "USD",
    priceUsd,
    priceGbp,
    listingsCount: undefined, // Would need separate API call
    sellerId: undefined,
    timestamp: product.modifiedOn,
    collectedAt,
  };
}

function createSalesEvents(
  product: TCGplayerProduct,
  sales: TCGplayerSale[],
  collectedAt: string
): SalesEvent[] {
  const { setCode, cardNumber, variantType } = extractCardInfo(product);
  const cardId = normalizeCardId(setCode, cardNumber, variantType);

  return sales.map((sale, idx) => {
    const { priceUsd } = normalizePrice(sale.purchasePrice, "USD");

    return {
      eventType: "sale" as const,
      source: "tcgplayer",
      saleId: `tcg-${product.productId}-${sale.orderDate}-${idx}`,
      cardId,
      price: sale.purchasePrice,
      currency: "USD",
      priceUsd,
      condition: normalizeCondition(sale.condition),
      quantity: sale.quantity,
      sellerId: undefined,
      buyerId: undefined,
      saleDate: sale.orderDate,
      collectedAt,
    };
  });
}

// =============================================================================
// MAIN HANDLER
// =============================================================================

export const handler: Handler<ScheduledEvent> = async (event) => {
  console.log("TCGplayer collector started", { event });
  const collectedAt = nowIso();

  try {
    // Get API credentials
    const secrets = await getSecrets();
    if (!secrets.tcgplayer_api_key || !secrets.tcgplayer_access_token) {
      throw new Error("TCGplayer API credentials not configured");
    }

    const client = new TCGplayerClient(
      secrets.tcgplayer_api_key,
      secrets.tcgplayer_access_token
    );

    // Get all product groups (sets)
    console.log("Fetching product groups...");
    const groups = await client.getGroups();
    console.log(`Found ${groups.length} groups`);

    const allPriceEvents: PriceEvent[] = [];
    const allSalesEvents: SalesEvent[] = [];

    // Process each group
    for (const group of groups) {
      console.log(`Processing group: ${group.name} (${group.groupId})`);

      // Get all products in the group
      let offset = 0;
      const limit = 100;
      let totalProcessed = 0;

      while (true) {
        const { products, totalItems } = await client.getProductsByGroup(
          group.groupId,
          offset,
          limit
        );

        if (products.length === 0) break;

        // Get prices for these products
        const productIds = products.map((p) => p.productId);
        const prices = await client.getPrices(productIds);

        // Create price events
        const priceMap = new Map(prices.map((p) => [p.productId, p]));

        for (const product of products) {
          const price = priceMap.get(product.productId);
          if (price) {
            const priceEvent = createPriceEvent(product, price, collectedAt);
            if (priceEvent) {
              allPriceEvents.push(priceEvent);
            }
          }
        }

        totalProcessed += products.length;
        offset += limit;

        // Check if we've processed all products
        if (totalProcessed >= totalItems) break;

        // Progress log
        console.log(
          `  Processed ${totalProcessed}/${totalItems} products in ${group.name}`
        );
      }

      // Get recent sales for high-value products (sample)
      // In production, would be more selective
      const highValueProducts = allPriceEvents
        .filter((e) => e.priceUsd > 20)
        .slice(0, 10);

      for (const priceEvent of highValueProducts) {
        try {
          const sales = await client.getRecentSales(
            parseInt(priceEvent.externalId),
            priceEvent.condition
          );

          // Find the original product
          const product: TCGplayerProduct = {
            productId: parseInt(priceEvent.externalId),
            name: priceEvent.name,
            cleanName: priceEvent.name,
            imageUrl: "",
            categoryId: TCGPLAYER_CATEGORY_ID,
            groupId: group.groupId,
            url: "",
            modifiedOn: collectedAt,
            extendedData: [],
          };

          const salesEvents = createSalesEvents(product, sales, collectedAt);
          allSalesEvents.push(...salesEvents);
        } catch (error) {
          console.warn(
            `Failed to get sales for product ${priceEvent.externalId}:`,
            error
          );
        }
      }
    }

    console.log(`Collected ${allPriceEvents.length} price events`);
    console.log(`Collected ${allSalesEvents.length} sales events`);

    // Send to Kinesis
    if (allPriceEvents.length > 0) {
      await putToKinesis(PRICE_STREAM, allPriceEvents);
    }

    if (allSalesEvents.length > 0) {
      await putToKinesis(SALES_STREAM, allSalesEvents);
    }

    // Update DynamoDB current prices
    if (allPriceEvents.length > 0) {
      await batchUpdateCurrentPrices(CURRENT_PRICES_TABLE, allPriceEvents);
    }

    // Write to Timestream
    if (allPriceEvents.length > 0) {
      await writePriceToTimestream(
        TIMESTREAM_DATABASE,
        "price_history",
        allPriceEvents
      );
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        priceEvents: allPriceEvents.length,
        salesEvents: allSalesEvents.length,
        collectedAt,
      }),
    };
  } catch (error) {
    console.error("TCGplayer collector error:", error);
    throw error;
  }
};
