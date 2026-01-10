/**
 * Cardmarket Data Collector Lambda
 *
 * Collects price data from the Cardmarket API (Europe's largest marketplace).
 * Uses OAuth 1.0a for authentication.
 *
 * API Documentation: https://api.cardmarket.com/ws/documentation
 */

import { Handler, ScheduledEvent } from "aws-lambda";
import * as crypto from "crypto";
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
} from "/opt/nodejs/utils";

// =============================================================================
// CONFIGURATION
// =============================================================================

const CARDMARKET_API_BASE = "https://api.cardmarket.com/ws/v2.0";
const CARDMARKET_GAME_ID = 7; // One Piece Card Game

const PRICE_STREAM = process.env.PRICE_STREAM_NAME!;
const CURRENT_PRICES_TABLE = process.env.CURRENT_PRICES_TABLE!;
const TIMESTREAM_DATABASE = process.env.TIMESTREAM_DATABASE!;

// Rate limiter: 100 requests per minute
const rateLimiter = new RateLimiter(2, 2);

// =============================================================================
// TYPES
// =============================================================================

interface CardmarketProduct {
  idProduct: number;
  idMetaproduct: number;
  countReprints: number;
  enName: string;
  locName: string;
  image: string;
  website: string;
  gameName: string;
  categoryName: string;
  number: string;
  rarity: string;
  expansionName: string;
  expansion: {
    idExpansion: number;
    enName: string;
    abbreviation: string;
  };
}

interface CardmarketPriceGuide {
  idProduct: number;
  avg: number;
  low: number;
  trend: number;
  avg1: number;
  avg7: number;
  avg30: number;
  lowFoil: number;
  avgFoil: number;
  trendFoil: number;
}

interface CardmarketArticle {
  idArticle: number;
  idProduct: number;
  language: {
    idLanguage: number;
    languageName: string;
  };
  condition: string;
  isFoil: boolean;
  isAltered: boolean;
  isSigned: boolean;
  isFirstEd: boolean;
  isPlayset: boolean;
  price: number;
  idCurrency: number;
  count: number;
  seller: {
    idUser: number;
    username: string;
    sellCount: number;
    reputation: number;
    shipsFast: number;
    address: {
      country: string;
    };
  };
}

interface CardmarketExpansion {
  idExpansion: number;
  enName: string;
  abbreviation: string;
  releaseDate: string;
  isReleased: boolean;
  icon: number;
  idGame: number;
}

// =============================================================================
// OAUTH 1.0a IMPLEMENTATION
// =============================================================================

class CardmarketOAuth {
  private appToken: string;
  private appSecret: string;
  private accessToken: string;
  private accessSecret: string;

  constructor(
    appToken: string,
    appSecret: string,
    accessToken: string = "",
    accessSecret: string = ""
  ) {
    this.appToken = appToken;
    this.appSecret = appSecret;
    this.accessToken = accessToken;
    this.accessSecret = accessSecret;
  }

  generateSignature(
    method: string,
    url: string,
    params: Record<string, string>
  ): string {
    // Create parameter string
    const sortedParams = Object.keys(params)
      .sort()
      .map((key) => `${key}=${encodeURIComponent(params[key])}`)
      .join("&");

    // Create signature base string
    const signatureBase = [
      method.toUpperCase(),
      encodeURIComponent(url),
      encodeURIComponent(sortedParams),
    ].join("&");

    // Create signing key
    const signingKey = `${encodeURIComponent(this.appSecret)}&${encodeURIComponent(
      this.accessSecret
    )}`;

    // Generate HMAC-SHA1 signature
    const signature = crypto
      .createHmac("sha1", signingKey)
      .update(signatureBase)
      .digest("base64");

    return signature;
  }

  generateAuthHeader(method: string, url: string): string {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = crypto.randomBytes(16).toString("hex");

    const oauthParams: Record<string, string> = {
      oauth_consumer_key: this.appToken,
      oauth_nonce: nonce,
      oauth_signature_method: "HMAC-SHA1",
      oauth_timestamp: timestamp,
      oauth_token: this.accessToken,
      oauth_version: "1.0",
    };

    // Generate signature
    const signature = this.generateSignature(method, url, oauthParams);
    oauthParams.oauth_signature = signature;

    // Create Authorization header
    const authHeader = Object.keys(oauthParams)
      .sort()
      .map((key) => `${key}="${encodeURIComponent(oauthParams[key])}"`)
      .join(", ");

    return `OAuth realm="${url}", ${authHeader}`;
  }
}

// =============================================================================
// API CLIENT
// =============================================================================

class CardmarketClient {
  private oauth: CardmarketOAuth;

  constructor(appToken: string, appSecret: string) {
    this.oauth = new CardmarketOAuth(appToken, appSecret);
  }

  private async request<T>(
    endpoint: string,
    method: string = "GET"
  ): Promise<T> {
    await rateLimiter.acquire();

    const url = `${CARDMARKET_API_BASE}${endpoint}`;
    const authHeader = this.oauth.generateAuthHeader(method, url);

    const response = await withRetry(async () => {
      const res = await fetch(url, {
        method,
        headers: {
          Authorization: authHeader,
          Accept: "application/json",
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
   * Get all expansions (sets) for One Piece
   */
  async getExpansions(): Promise<CardmarketExpansion[]> {
    const response = await this.request<{ expansion: CardmarketExpansion[] }>(
      `/games/${CARDMARKET_GAME_ID}/expansions`
    );
    return response.expansion || [];
  }

  /**
   * Get products in an expansion
   */
  async getProductsByExpansion(expansionId: number): Promise<CardmarketProduct[]> {
    const response = await this.request<{ product: CardmarketProduct[] }>(
      `/expansions/${expansionId}/singles`
    );
    return response.product || [];
  }

  /**
   * Get price guide for a product
   */
  async getPriceGuide(productId: number): Promise<CardmarketPriceGuide | null> {
    try {
      const response = await this.request<{ priceGuide: CardmarketPriceGuide }>(
        `/products/${productId}/priceGuide`
      );
      return response.priceGuide;
    } catch (error) {
      console.warn(`Failed to get price guide for product ${productId}:`, error);
      return null;
    }
  }

  /**
   * Get articles (listings) for a product
   */
  async getArticles(
    productId: number,
    options: {
      start?: number;
      maxResults?: number;
      minCondition?: string;
    } = {}
  ): Promise<CardmarketArticle[]> {
    const params = new URLSearchParams();
    if (options.start) params.set("start", options.start.toString());
    if (options.maxResults) params.set("maxResults", options.maxResults.toString());
    if (options.minCondition) params.set("minCondition", options.minCondition);

    const query = params.toString() ? `?${params.toString()}` : "";

    const response = await this.request<{ article: CardmarketArticle[] }>(
      `/articles/${productId}${query}`
    );
    return response.article || [];
  }

  /**
   * Search for products
   */
  async searchProducts(query: string): Promise<CardmarketProduct[]> {
    const response = await this.request<{ product: CardmarketProduct[] }>(
      `/products/find?search=${encodeURIComponent(query)}&idGame=${CARDMARKET_GAME_ID}`
    );
    return response.product || [];
  }
}

// =============================================================================
// DATA PROCESSING
// =============================================================================

const CARDMARKET_CONDITION_MAP: Record<string, string> = {
  MT: "NM", // Mint = NM
  NM: "NM", // Near Mint
  EX: "LP", // Excellent = LP
  GD: "MP", // Good = MP
  LP: "MP", // Light Played = MP (Cardmarket's LP is lower than TCGplayer's)
  PL: "HP", // Played = HP
  PO: "DMG", // Poor = DMG
};

const CARDMARKET_LANGUAGE_MAP: Record<number, string> = {
  1: "EN", // English
  2: "FR", // French
  3: "DE", // German
  4: "ES", // Spanish
  5: "IT", // Italian
  6: "JP", // Japanese
  7: "PT", // Portuguese
  8: "RU", // Russian
  9: "KO", // Korean
  10: "ZH", // Chinese
};

function extractCardInfo(product: CardmarketProduct): {
  setCode: string;
  cardNumber: string;
  variantType: string;
} {
  let setCode = product.expansion?.abbreviation || "";
  let cardNumber = product.number || "";
  let variantType = "regular";

  // Detect variant from rarity or name
  const rarityLower = (product.rarity || "").toLowerCase();
  const nameLower = (product.enName || "").toLowerCase();

  if (rarityLower.includes("parallel") || nameLower.includes("parallel")) {
    variantType = "parallel";
  } else if (rarityLower.includes("alternate") || nameLower.includes("alternate art")) {
    variantType = "parallel";
  } else if (nameLower.includes("manga")) {
    variantType = "manga";
  } else if (nameLower.includes("sp") || rarityLower.includes("special")) {
    variantType = "sp";
  }

  return { setCode, cardNumber, variantType };
}

function createPriceEventFromGuide(
  product: CardmarketProduct,
  priceGuide: CardmarketPriceGuide,
  collectedAt: string
): PriceEvent | null {
  const { setCode, cardNumber, variantType } = extractCardInfo(product);

  if (!setCode || !cardNumber) {
    return null;
  }

  const cardId = normalizeCardId(setCode, cardNumber, variantType);

  // Use trend price as the primary price
  const priceValue = priceGuide.trend || priceGuide.avg || priceGuide.low || 0;
  if (priceValue === 0) return null;

  const { priceUsd, priceGbp } = normalizePrice(priceValue, "EUR");

  return {
    eventType: "price",
    source: "cardmarket",
    cardId,
    externalId: product.idProduct.toString(),
    name: product.enName,
    setCode,
    cardNumber,
    variantType,
    condition: "NM", // Price guide is for NM condition
    language: "EN",
    price: priceValue,
    currency: "EUR",
    priceUsd,
    priceGbp,
    listingsCount: undefined,
    timestamp: collectedAt,
    collectedAt,
  };
}

function createPriceEventsFromArticles(
  product: CardmarketProduct,
  articles: CardmarketArticle[],
  collectedAt: string
): PriceEvent[] {
  const { setCode, cardNumber, variantType: baseVariant } = extractCardInfo(product);

  if (!setCode || !cardNumber) {
    return [];
  }

  // Group articles by condition and language, get lowest price
  const priceByConditionLanguage = new Map<string, {
    price: number;
    count: number;
    article: CardmarketArticle;
  }>();

  for (const article of articles) {
    const condition = CARDMARKET_CONDITION_MAP[article.condition] || "NM";
    const language = CARDMARKET_LANGUAGE_MAP[article.language.idLanguage] || "EN";
    const key = `${condition}-${language}`;

    const existing = priceByConditionLanguage.get(key);
    if (!existing || article.price < existing.price) {
      priceByConditionLanguage.set(key, {
        price: article.price,
        count: article.count,
        article,
      });
    } else if (existing) {
      existing.count += article.count;
    }
  }

  const events: PriceEvent[] = [];

  for (const [key, data] of priceByConditionLanguage) {
    const [condition, language] = key.split("-");
    const { priceUsd, priceGbp } = normalizePrice(data.price, "EUR");

    // Adjust variant type if foil
    let variantType = baseVariant;
    if (data.article.isFoil && variantType === "regular") {
      variantType = "parallel";
    }

    const cardId = normalizeCardId(setCode, cardNumber, variantType);

    events.push({
      eventType: "price",
      source: "cardmarket",
      cardId,
      externalId: product.idProduct.toString(),
      name: product.enName,
      setCode,
      cardNumber,
      variantType,
      condition,
      language,
      price: data.price,
      currency: "EUR",
      priceUsd,
      priceGbp,
      listingsCount: data.count,
      sellerId: data.article.seller.username,
      timestamp: collectedAt,
      collectedAt,
    });
  }

  return events;
}

// =============================================================================
// MAIN HANDLER
// =============================================================================

export const handler: Handler<ScheduledEvent> = async (event) => {
  console.log("Cardmarket collector started", { event });
  const collectedAt = nowIso();

  try {
    // Get API credentials
    const secrets = await getSecrets();
    if (!secrets.cardmarket_app_token || !secrets.cardmarket_app_secret) {
      throw new Error("Cardmarket API credentials not configured");
    }

    const client = new CardmarketClient(
      secrets.cardmarket_app_token,
      secrets.cardmarket_app_secret
    );

    // Get all expansions
    console.log("Fetching expansions...");
    const expansions = await client.getExpansions();
    console.log(`Found ${expansions.length} expansions`);

    const allPriceEvents: PriceEvent[] = [];

    // Process each expansion
    for (const expansion of expansions) {
      if (!expansion.isReleased) continue;

      console.log(`Processing expansion: ${expansion.enName} (${expansion.abbreviation})`);

      try {
        // Get products in expansion
        const products = await client.getProductsByExpansion(expansion.idExpansion);
        console.log(`  Found ${products.length} products`);

        // Get price guide and articles for each product
        for (const product of products) {
          try {
            // Get price guide
            const priceGuide = await client.getPriceGuide(product.idProduct);
            if (priceGuide) {
              const priceEvent = createPriceEventFromGuide(product, priceGuide, collectedAt);
              if (priceEvent) {
                allPriceEvents.push(priceEvent);
              }
            }

            // Get articles for more detailed pricing
            // Limit to avoid rate limits
            if (allPriceEvents.length < 1000) {
              const articles = await client.getArticles(product.idProduct, {
                maxResults: 50,
              });

              if (articles.length > 0) {
                const articleEvents = createPriceEventsFromArticles(
                  product,
                  articles,
                  collectedAt
                );
                allPriceEvents.push(...articleEvents);
              }
            }
          } catch (error) {
            console.warn(`Failed to process product ${product.idProduct}:`, error);
          }
        }
      } catch (error) {
        console.warn(`Failed to process expansion ${expansion.idExpansion}:`, error);
      }
    }

    // Deduplicate by cardId + condition + language
    const uniqueEvents = new Map<string, PriceEvent>();
    for (const event of allPriceEvents) {
      const key = `${event.cardId}-${event.condition}-${event.language}`;
      const existing = uniqueEvents.get(key);
      // Keep lowest price
      if (!existing || event.priceUsd < existing.priceUsd) {
        uniqueEvents.set(key, event);
      }
    }

    const finalEvents = Array.from(uniqueEvents.values());
    console.log(`Collected ${finalEvents.length} unique price events`);

    // Send to Kinesis
    if (finalEvents.length > 0) {
      await putToKinesis(PRICE_STREAM, finalEvents);
    }

    // Update DynamoDB
    if (finalEvents.length > 0) {
      await batchUpdateCurrentPrices(CURRENT_PRICES_TABLE, finalEvents);
    }

    // Write to Timestream
    if (finalEvents.length > 0) {
      await writePriceToTimestream(
        TIMESTREAM_DATABASE,
        "price_history",
        finalEvents
      );
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        priceEvents: finalEvents.length,
        expansionsProcessed: expansions.length,
        collectedAt,
      }),
    };
  } catch (error) {
    console.error("Cardmarket collector error:", error);
    throw error;
  }
};
