/**
 * Japan Market Data Collector Lambda
 *
 * Scrapes price data from Japanese marketplaces:
 * - Yahoo Auctions Japan
 * - Mercari Japan
 *
 * Uses rotating proxies to avoid IP blocks.
 * Requires Japanese text parsing for card identification.
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
  sleep,
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

const YAHOO_AUCTIONS_BASE = "https://auctions.yahoo.co.jp";
const MERCARI_BASE = "https://jp.mercari.com";

const PRICE_STREAM = process.env.PRICE_STREAM_NAME!;
const LISTING_STREAM = process.env.LISTING_STREAM_NAME!;
const SALES_STREAM = process.env.SALES_STREAM_NAME!;
const CURRENT_PRICES_TABLE = process.env.CURRENT_PRICES_TABLE!;

// Rate limiter: Conservative to avoid blocks
const rateLimiter = new RateLimiter(1, 1); // 1 request per second

// Search keywords in Japanese
const SEARCH_KEYWORDS = [
  "ワンピースカードゲーム", // One Piece Card Game
  "ワンピース カード",
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
  "パラレル", // Parallel
  "スペシャルアート", // Special Art
  "コミパラ", // Comic Parallel
];

// =============================================================================
// TYPES
// =============================================================================

interface ProxyConfig {
  host: string;
  port: number;
  username: string;
  password: string;
}

interface YahooAuctionItem {
  auctionId: string;
  title: string;
  currentPrice: number;
  buyNowPrice: number | null;
  bidCount: number;
  endTime: string;
  sellerId: string;
  sellerRating: number;
  condition: string;
  imageUrls: string[];
  categoryId: string;
}

interface MercariItem {
  itemId: string;
  title: string;
  price: number;
  status: "on_sale" | "trading" | "sold_out";
  sellerId: string;
  condition: string;
  imageUrls: string[];
  createdAt: string;
  updatedAt: string;
}

// =============================================================================
// PROXY MANAGEMENT
// =============================================================================

class ProxyRotator {
  private proxies: ProxyConfig[] = [];
  private currentIndex = 0;

  constructor(username: string, password: string) {
    // Using Bright Data residential proxy format
    // Each request gets a new IP
    this.proxies = [
      {
        host: "brd.superproxy.io",
        port: 22225,
        username: `${username}-country-jp`,
        password,
      },
      {
        host: "brd.superproxy.io",
        port: 22225,
        username: `${username}-country-jp-session-${Date.now()}`,
        password,
      },
    ];
  }

  getProxy(): ProxyConfig {
    const proxy = this.proxies[this.currentIndex];
    this.currentIndex = (this.currentIndex + 1) % this.proxies.length;
    return proxy;
  }

  getProxyUrl(): string {
    const proxy = this.getProxy();
    return `http://${proxy.username}:${proxy.password}@${proxy.host}:${proxy.port}`;
  }
}

// =============================================================================
// SCRAPER BASE CLASS
// =============================================================================

abstract class JapanScraper {
  protected proxyRotator: ProxyRotator;

  constructor(proxyRotator: ProxyRotator) {
    this.proxyRotator = proxyRotator;
  }

  protected async fetchWithProxy(url: string): Promise<string> {
    await rateLimiter.acquire();

    // In production, would use proxy
    // For Lambda, use fetch-with-proxy library or custom implementation
    const response = await withRetry(
      async () => {
        // Note: In actual Lambda deployment, would configure proxy via HTTP agent
        const res = await fetch(url, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept-Language": "ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7",
            Accept:
              "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
          },
        });

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }

        return res.text();
      },
      { maxRetries: 3, baseDelayMs: 2000 }
    );

    return response;
  }

  abstract search(keyword: string): Promise<YahooAuctionItem[] | MercariItem[]>;
}

// =============================================================================
// YAHOO AUCTIONS SCRAPER
// =============================================================================

class YahooAuctionsScraper extends JapanScraper {
  async search(keyword: string): Promise<YahooAuctionItem[]> {
    const encodedKeyword = encodeURIComponent(keyword);
    const url = `${YAHOO_AUCTIONS_BASE}/search/search?p=${encodedKeyword}&va=${encodedKeyword}&auccat=2084307365&n=100&mode=1`;

    const html = await this.fetchWithProxy(url);
    return this.parseSearchResults(html);
  }

  private parseSearchResults(html: string): YahooAuctionItem[] {
    const items: YahooAuctionItem[] = [];

    // Try multiple parsing strategies for robustness

    // Strategy 1: Standard data attributes
    const pattern1 = /data-auction-id="([^"]+)"[\s\S]*?<a[^>]+>([^<]+)<\/a>[\s\S]*?data-price="(\d+)"/g;
    let match1;
    while ((match1 = pattern1.exec(html)) !== null) {
      const [, auctionId, title, price] = match1;
      items.push({
        auctionId,
        title: sanitizeString(title),
        currentPrice: parseInt(price, 10),
        buyNowPrice: null,
        bidCount: 0,
        endTime: "",
        sellerId: "",
        sellerRating: 0,
        condition: "",
        imageUrls: [],
        categoryId: "2084307365",
      });
    }

    // Strategy 2: Fallback - JSON-LD structured data
    if (items.length === 0) {
      const jsonLdMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g);
      if (jsonLdMatch) {
        for (const block of jsonLdMatch) {
          try {
            const jsonStr = block.replace(/<script[^>]*>|<\/script>/g, "");
            const data = JSON.parse(jsonStr);
            if (data["@type"] === "Product" || data["@type"] === "ItemPage") {
              const offers = data.offers || data.mainEntity?.offers;
              if (offers) {
                items.push({
                  auctionId: data.productID || data.identifier || `parsed-${Date.now()}`,
                  title: sanitizeString(data.name || ""),
                  currentPrice: parseInt(offers.price || "0", 10),
                  buyNowPrice: null,
                  bidCount: 0,
                  endTime: "",
                  sellerId: "",
                  sellerRating: 0,
                  condition: offers.itemCondition || "",
                  imageUrls: data.image ? [data.image] : [],
                  categoryId: "2084307365",
                });
              }
            }
          } catch {
            // JSON parse failed, continue to next block
          }
        }
      }
    }

    // Strategy 3: Alternative HTML structure (newer Yahoo layout)
    if (items.length === 0) {
      const pattern3 = /href="[^"]*\/auction\/([a-z]\d+)"[^>]*>[\s\S]*?class="[^"]*title[^"]*"[^>]*>([^<]+)<[\s\S]*?class="[^"]*price[^"]*"[^>]*>([^<]+)</gi;
      let match3;
      while ((match3 = pattern3.exec(html)) !== null) {
        const [, auctionId, title, priceStr] = match3;
        const price = parseInt(priceStr.replace(/[^\d]/g, ""), 10);
        if (price > 0) {
          items.push({
            auctionId,
            title: sanitizeString(title),
            currentPrice: price,
            buyNowPrice: null,
            bidCount: 0,
            endTime: "",
            sellerId: "",
            sellerRating: 0,
            condition: "",
            imageUrls: [],
            categoryId: "2084307365",
          });
        }
      }
    }

    // Log parsing strategy used
    if (items.length > 0) {
      console.log(`[YahooParser] Extracted ${items.length} items from HTML`);
    } else {
      console.warn("[YahooParser] No items extracted from HTML - structure may have changed");
      dataQualityTracker.recordDropped("yahoo_jp", "html_parse_failed", {
        rawData: { htmlLength: html.length, sample: html.slice(0, 500) },
      });
    }

    return items;
  }

  async getItemDetails(auctionId: string): Promise<YahooAuctionItem | null> {
    const url = `${YAHOO_AUCTIONS_BASE}/item/${auctionId}`;
    const html = await this.fetchWithProxy(url);

    // Parse item details
    const titleMatch = html.match(/<h1[^>]*class="[^"]*ProductTitle[^"]*"[^>]*>([^<]+)<\/h1>/);
    const priceMatch = html.match(/data-price="(\d+)"/);
    const bidMatch = html.match(/入札件数[^\d]*(\d+)/);
    const sellerMatch = html.match(/data-seller-id="([^"]+)"/);
    const conditionMatch = html.match(/商品の状態[^<]*<[^>]+>([^<]+)</);

    if (!titleMatch || !priceMatch) return null;

    return {
      auctionId,
      title: sanitizeString(titleMatch[1]),
      currentPrice: parseInt(priceMatch[1], 10),
      buyNowPrice: null,
      bidCount: bidMatch ? parseInt(bidMatch[1], 10) : 0,
      endTime: "",
      sellerId: sellerMatch ? sellerMatch[1] : "",
      sellerRating: 0,
      condition: conditionMatch ? conditionMatch[1] : "",
      imageUrls: [],
      categoryId: "2084307365",
    };
  }

  async getCompletedSales(keyword: string): Promise<SalesEvent[]> {
    // Yahoo Auctions completed listings
    const encodedKeyword = encodeURIComponent(keyword);
    const url = `${YAHOO_AUCTIONS_BASE}/closedsearch/closedsearch?p=${encodedKeyword}&auccat=2084307365&n=50`;

    const html = await this.fetchWithProxy(url);
    const sales: SalesEvent[] = [];

    // Parse completed sales
    const itemPattern =
      /data-auction-id="([^"]+)"[\s\S]*?<a[^>]+>([^<]+)<\/a>[\s\S]*?class="[^"]*Price[^"]*"[^>]*>([^<]+)</g;
    let match;

    const collectedAt = nowIso();

    while ((match = itemPattern.exec(html)) !== null) {
      const [, auctionId, title, priceStr] = match;
      const price = parseInt(priceStr.replace(/[^\d]/g, ""), 10);

      const cardInfo = this.extractCardInfo(title);
      if (cardInfo && price > 0) {
        const { priceUsd } = normalizePrice(price, "JPY");

        sales.push({
          eventType: "sale",
          source: "yahoo_jp",
          saleId: `yahoo-${auctionId}`,
          cardId: normalizeCardId(cardInfo.setCode, cardInfo.cardNumber, cardInfo.variantType),
          price,
          currency: "JPY",
          priceUsd,
          condition: "NM", // Default
          quantity: 1,
          sellerId: undefined,
          buyerId: undefined,
          saleDate: collectedAt,
          collectedAt,
        });
      }
    }

    return sales;
  }

  private extractCardInfo(title: string): {
    setCode: string;
    cardNumber: string;
    variantType: string;
  } | null {
    // Match card number pattern
    const match = title.match(/([A-Z]{2,3}\d{2})-(\d{3})/i);
    if (!match) return null;

    const setCode = match[1].toUpperCase();
    const cardNumber = match[2];

    // Detect variant
    let variantType = "regular";
    const titleLower = title.toLowerCase();

    if (titleLower.includes("パラレル") || titleLower.includes("parallel")) {
      variantType = "parallel";
    } else if (titleLower.includes("コミパラ") || titleLower.includes("manga")) {
      variantType = "manga";
    } else if (titleLower.includes("sp") || titleLower.includes("スペシャル")) {
      variantType = "sp";
    }

    return { setCode, cardNumber, variantType };
  }
}

// =============================================================================
// MERCARI SCRAPER
// =============================================================================

class MercariScraper extends JapanScraper {
  async search(keyword: string): Promise<MercariItem[]> {
    // Mercari uses a dynamic API, so we need to scrape the search page
    // or reverse-engineer their API
    const encodedKeyword = encodeURIComponent(keyword);
    const url = `${MERCARI_BASE}/search?keyword=${encodedKeyword}&category_id=1291&status=on_sale`;

    const html = await this.fetchWithProxy(url);
    return this.parseSearchResults(html);
  }

  private parseSearchResults(html: string): MercariItem[] {
    const items: MercariItem[] = [];

    // Strategy 1: Next.js SSR data (most reliable)
    const dataMatch = html.match(/__NEXT_DATA__[^>]*>([^<]+)<\/script>/);
    if (dataMatch) {
      try {
        const jsonData = JSON.parse(dataMatch[1]);
        const searchResults = jsonData?.props?.pageProps?.searchResults ||
                             jsonData?.props?.pageProps?.items ||
                             jsonData?.props?.initialData?.items ||
                             [];

        for (const item of searchResults) {
          items.push({
            itemId: item.id || item.itemId || "",
            title: item.name || item.title || "",
            price: item.price || parseInt(item.priceStr?.replace(/[^\d]/g, ""), 10) || 0,
            status: item.status || "on_sale",
            sellerId: item.seller?.id || item.sellerId || "",
            condition: item.item_condition?.name || item.condition || "",
            imageUrls: item.thumbnails || item.photos || [],
            createdAt: item.created || item.createdAt || "",
            updatedAt: item.updated || item.updatedAt || "",
          });
        }
      } catch (error) {
        console.warn("Failed to parse Mercari __NEXT_DATA__:", error);
      }
    }

    // Strategy 2: Look for React hydration data
    if (items.length === 0) {
      const reactDataMatch = html.match(/window\.__PRELOADED_STATE__\s*=\s*({[\s\S]*?});<\/script>/);
      if (reactDataMatch) {
        try {
          const preloadedState = JSON.parse(reactDataMatch[1]);
          const searchItems = preloadedState?.search?.items || preloadedState?.items || [];
          for (const item of searchItems) {
            items.push({
              itemId: item.id || "",
              title: item.name || "",
              price: item.price || 0,
              status: item.status || "on_sale",
              sellerId: item.sellerId || "",
              condition: item.condition || "",
              imageUrls: item.photos || [],
              createdAt: item.created || "",
              updatedAt: item.updated || "",
            });
          }
        } catch {
          // Continue to next strategy
        }
      }
    }

    // Strategy 3: HTML parsing fallback
    if (items.length === 0) {
      const itemPattern = /data-item-id="([^"]+)"[\s\S]*?data-item-name="([^"]*)"[\s\S]*?data-item-price="(\d+)"/g;
      let match;
      while ((match = itemPattern.exec(html)) !== null) {
        const [, itemId, title, price] = match;
        items.push({
          itemId,
          title: sanitizeString(title),
          price: parseInt(price, 10),
          status: "on_sale",
          sellerId: "",
          condition: "",
          imageUrls: [],
          createdAt: "",
          updatedAt: "",
        });
      }
    }

    // Log parsing results
    if (items.length > 0) {
      console.log(`[MercariParser] Extracted ${items.length} items from response`);
    } else {
      console.warn("[MercariParser] No items extracted - page structure may have changed");
      dataQualityTracker.recordDropped("mercari_jp", "html_parse_failed", {
        rawData: { htmlLength: html.length, sample: html.slice(0, 500) },
      });
    }

    return items;
  }

  async getSoldItems(keyword: string): Promise<SalesEvent[]> {
    const encodedKeyword = encodeURIComponent(keyword);
    const url = `${MERCARI_BASE}/search?keyword=${encodedKeyword}&category_id=1291&status=sold_out`;

    const html = await this.fetchWithProxy(url);
    const items = this.parseSearchResults(html);
    const collectedAt = nowIso();

    const sales: SalesEvent[] = [];

    for (const item of items) {
      const cardInfo = this.extractCardInfo(item.title);
      if (cardInfo && item.price > 0) {
        const { priceUsd } = normalizePrice(item.price, "JPY");

        sales.push({
          eventType: "sale",
          source: "mercari_jp",
          saleId: `mercari-${item.itemId}`,
          cardId: normalizeCardId(cardInfo.setCode, cardInfo.cardNumber, cardInfo.variantType),
          price: item.price,
          currency: "JPY",
          priceUsd,
          condition: this.normalizeCondition(item.condition),
          quantity: 1,
          sellerId: item.sellerId,
          buyerId: undefined,
          saleDate: item.updatedAt || collectedAt,
          collectedAt,
        });
      }
    }

    return sales;
  }

  private extractCardInfo(title: string): {
    setCode: string;
    cardNumber: string;
    variantType: string;
  } | null {
    const match = title.match(/([A-Z]{2,3}\d{2})-(\d{3})/i);
    if (!match) return null;

    const setCode = match[1].toUpperCase();
    const cardNumber = match[2];

    let variantType = "regular";
    const titleLower = title.toLowerCase();

    if (titleLower.includes("パラレル") || titleLower.includes("parallel")) {
      variantType = "parallel";
    } else if (titleLower.includes("コミパラ")) {
      variantType = "manga";
    } else if (titleLower.includes("スペシャル") || titleLower.includes("sp")) {
      variantType = "sp";
    }

    return { setCode, cardNumber, variantType };
  }

  private normalizeCondition(condition: string): string {
    const conditionMap: Record<string, string> = {
      新品未使用: "NM",
      未使用に近い: "NM",
      目立った傷や汚れなし: "LP",
      やや傷や汚れあり: "MP",
      傷や汚れあり: "HP",
      全体的に状態が悪い: "DMG",
    };
    return conditionMap[condition] || "NM";
  }
}

// =============================================================================
// DATA PROCESSING
// =============================================================================

interface ExtendedPriceEvent extends PriceEvent {
  sellerReputationTier?: string;
  sellerWeightFactor?: number;
  fuzzyMatched?: boolean;
  matchConfidence?: string;
  conditionKnown?: boolean;
}

function createPriceEventFromYahoo(
  item: YahooAuctionItem,
  collectedAt: string
): ExtendedPriceEvent | null {
  const source = "yahoo_jp";

  // Try standard pattern first
  const cardMatch = item.title.match(/([A-Z]{2,3}\d{2})-(\d{3})/i);
  let setCode: string;
  let cardNumber: string;
  let fuzzyMatched = false;
  let confidence: "high" | "medium" | "low" = "high";

  if (cardMatch) {
    setCode = cardMatch[1].toUpperCase();
    cardNumber = cardMatch[2];
  } else {
    // Try fuzzy matching
    const fuzzyResult = fuzzyMatchCard(item.title);
    if (fuzzyResult) {
      setCode = fuzzyResult.setCode;
      cardNumber = fuzzyResult.cardNumber;
      fuzzyMatched = true;
      confidence = fuzzyResult.confidence;
    } else {
      dataQualityTracker.recordDropped(source, "no_card_id_pattern", { title: item.title });
      return null;
    }
  }

  // Use standardized variant detection
  const variantType = detectVariantType(item.title);

  const cardId = normalizeCardId(setCode, cardNumber, variantType);
  const price = item.buyNowPrice || item.currentPrice;

  if (price <= 0) {
    dataQualityTracker.recordDropped(source, "invalid_price", {
      title: item.title,
      rawData: { price },
    });
    return null;
  }

  const { priceUsd, priceGbp } = normalizePrice(price, "JPY");

  // Handle unknown condition properly - don't assume NM
  const conditionResult = normalizeConditionWithTracking(item.condition || "");
  const condition = conditionResult.isKnown ? conditionResult.condition : "UNKNOWN";

  // Calculate seller reputation if available
  const sellerRepTier = calculateSellerReputation(undefined, item.sellerRating);
  const weightFactor = getSellerWeightFactor(sellerRepTier);

  // Track success
  dataQualityTracker.recordSuccess(source, {
    fuzzyMatched,
    unknownCondition: !conditionResult.isKnown,
  });

  return {
    eventType: "price",
    source,
    cardId,
    externalId: item.auctionId,
    name: item.title,
    setCode,
    cardNumber,
    variantType,
    condition,
    language: "JP",
    price,
    currency: "JPY",
    priceUsd,
    priceGbp,
    listingsCount: 1,
    sellerId: item.sellerId,
    timestamp: collectedAt,
    collectedAt,
    // Extended fields
    sellerReputationTier: sellerRepTier,
    sellerWeightFactor: weightFactor,
    fuzzyMatched,
    matchConfidence: confidence,
    conditionKnown: conditionResult.isKnown,
  };
}

function createPriceEventFromMercari(
  item: MercariItem,
  collectedAt: string
): ExtendedPriceEvent | null {
  const source = "mercari_jp";

  // Try standard pattern first
  const cardMatch = item.title.match(/([A-Z]{2,3}\d{2})-(\d{3})/i);
  let setCode: string;
  let cardNumber: string;
  let fuzzyMatched = false;
  let confidence: "high" | "medium" | "low" = "high";

  if (cardMatch) {
    setCode = cardMatch[1].toUpperCase();
    cardNumber = cardMatch[2];
  } else {
    // Try fuzzy matching
    const fuzzyResult = fuzzyMatchCard(item.title);
    if (fuzzyResult) {
      setCode = fuzzyResult.setCode;
      cardNumber = fuzzyResult.cardNumber;
      fuzzyMatched = true;
      confidence = fuzzyResult.confidence;
    } else {
      dataQualityTracker.recordDropped(source, "no_card_id_pattern", { title: item.title });
      return null;
    }
  }

  // Use standardized variant detection
  const variantType = detectVariantType(item.title);

  const cardId = normalizeCardId(setCode, cardNumber, variantType);

  if (item.price <= 0) {
    dataQualityTracker.recordDropped(source, "invalid_price", {
      title: item.title,
      rawData: { price: item.price },
    });
    return null;
  }

  const { priceUsd, priceGbp } = normalizePrice(item.price, "JPY");

  // Use unified condition tracking
  const conditionResult = normalizeConditionWithTracking(item.condition || "");
  const condition = conditionResult.isKnown ? conditionResult.condition : "UNKNOWN";

  // Track success
  dataQualityTracker.recordSuccess(source, {
    fuzzyMatched,
    unknownCondition: !conditionResult.isKnown,
  });

  return {
    eventType: "price",
    source,
    cardId,
    externalId: item.itemId,
    name: item.title,
    setCode,
    cardNumber,
    variantType,
    condition,
    language: "JP",
    price: item.price,
    currency: "JPY",
    priceUsd,
    priceGbp,
    listingsCount: 1,
    sellerId: item.sellerId,
    timestamp: collectedAt,
    collectedAt,
    // Extended fields
    fuzzyMatched,
    matchConfidence: confidence,
    conditionKnown: conditionResult.isKnown,
  };
}

// =============================================================================
// MAIN HANDLER
// =============================================================================

export const handler: Handler<ScheduledEvent> = async (event) => {
  console.log("Japan collector started", { event });
  const collectedAt = nowIso();

  // Reset data quality tracker for this run
  dataQualityTracker.reset();

  try {
    // Fetch live FX rates before processing (important for JPY conversion)
    await fetchLiveFxRates();

    // Get proxy credentials
    const secrets = await getSecrets();
    if (!secrets.proxy_username || !secrets.proxy_password) {
      console.warn("Proxy credentials not configured, using direct connection");
    }

    const proxyRotator = new ProxyRotator(
      secrets.proxy_username || "",
      secrets.proxy_password || ""
    );

    const yahooScraper = new YahooAuctionsScraper(proxyRotator);
    const mercariScraper = new MercariScraper(proxyRotator);

    const allPriceEvents: ExtendedPriceEvent[] = [];
    const allSalesEvents: SalesEvent[] = [];

    // Process each keyword
    for (const keyword of SEARCH_KEYWORDS) {
      console.log(`Searching for: ${keyword}`);

      try {
        // Yahoo Auctions
        console.log("  Searching Yahoo Auctions...");
        const yahooItems = await yahooScraper.search(keyword);
        console.log(`  Found ${yahooItems.length} Yahoo items`);

        for (const item of yahooItems) {
          const priceEvent = createPriceEventFromYahoo(item, collectedAt);
          if (priceEvent) {
            allPriceEvents.push(priceEvent);
          }
        }

        // Get completed Yahoo sales
        const yahooSales = await yahooScraper.getCompletedSales(keyword);
        allSalesEvents.push(...yahooSales);

        // Add delay between sources
        await sleep(2000);

        // Mercari
        console.log("  Searching Mercari...");
        const mercariItems = await mercariScraper.search(keyword);
        console.log(`  Found ${mercariItems.length} Mercari items`);

        for (const item of mercariItems) {
          if (item.status === "on_sale") {
            const priceEvent = createPriceEventFromMercari(item, collectedAt);
            if (priceEvent) {
              allPriceEvents.push(priceEvent);
            }
          }
        }

        // Get sold Mercari items
        const mercariSales = await mercariScraper.getSoldItems(keyword);
        allSalesEvents.push(...mercariSales);

        // Add delay between keywords
        await sleep(3000);
      } catch (error) {
        console.warn(`Failed to process keyword "${keyword}":`, error);
      }
    }

    // Deduplicate
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
    console.log(`Collected ${allSalesEvents.length} sales events`);

    // Send to Kinesis
    if (finalPriceEvents.length > 0) {
      await putToKinesis(PRICE_STREAM, finalPriceEvents);
    }

    if (allSalesEvents.length > 0) {
      await putToKinesis(SALES_STREAM, allSalesEvents);
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
        salesEvents: allSalesEvents.length,
        keywordsProcessed: SEARCH_KEYWORDS.length,
        collectedAt,
        dataQuality: {
          metrics: qualityMetrics,
          droppedSample,
        },
      }),
    };
  } catch (error) {
    console.error("Japan collector error:", error);

    // Still log data quality even on error
    dataQualityTracker.logSummary();

    throw error;
  }
};
