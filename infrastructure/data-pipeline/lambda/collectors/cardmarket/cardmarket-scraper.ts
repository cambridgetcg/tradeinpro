/**
 * Cardmarket Web Scraper Lambda
 *
 * Scrapes price data from Cardmarket (Europe's largest TCG marketplace)
 * since their API is no longer publicly available.
 *
 * Alternative approaches:
 * 1. Direct web scraping with proxy rotation (this implementation)
 * 2. Apify Cardmarket Trend Scraper ($10/mo) - https://apify.com/ecomscrape/cardmarket-trend-scraper
 * 3. RapidAPI Cardmarket API (when One Piece is supported)
 *
 * Data scraped:
 * - Trend prices (weekly top cards, best bargains)
 * - Product prices from search results
 * - Price guide data from card pages
 */

import { Handler, ScheduledEvent } from "aws-lambda";
import {
  getSecrets,
  putToKinesis,
  batchUpdateCurrentPrices,
  normalizePrice,
  fetchLiveFxRates,
  normalizeCardId,
  normalizeCondition,
  normalizeConditionWithTracking,
  RateLimiter,
  withRetry,
  nowIso,
  sleep,
  sanitizeString,
  dataQualityTracker,
  detectVariantType,
  PriceEvent,
} from "/opt/nodejs/utils";

// =============================================================================
// CONFIGURATION
// =============================================================================

const CARDMARKET_BASE = "https://www.cardmarket.com";
const CARDMARKET_ONEPIECE = `${CARDMARKET_BASE}/en/OnePiece`;

const PRICE_STREAM = process.env.PRICE_STREAM_NAME!;
const CURRENT_PRICES_TABLE = process.env.CURRENT_PRICES_TABLE!;

// Conservative rate limiting to avoid blocks
const rateLimiter = new RateLimiter(1, 0.5); // 1 request per 2 seconds

// One Piece sets on Cardmarket
const ONEPIECE_EXPANSIONS = [
  { name: "Romance Dawn", code: "OP01" },
  { name: "Paramount War", code: "OP02" },
  { name: "Pillars of Strength", code: "OP03" },
  { name: "Kingdoms of Intrigue", code: "OP04" },
  { name: "Awakening of the New Era", code: "OP05" },
  { name: "Wings of the Captain", code: "OP06" },
  { name: "500 Years in the Future", code: "OP07" },
  { name: "Two Legends", code: "OP08" },
  { name: "The Four Emperors", code: "OP09" },
  { name: "Royal Blood", code: "OP10" },
  { name: "Uta", code: "OP11" },
  { name: "Extra Booster Memorial Collection", code: "EB01" },
  { name: "Extra Booster Anime 25th Collection", code: "EB02" },
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

interface CardmarketTrendCard {
  url: string;
  title: string;
  imageUrl: string;
  expansionUrl?: string;
  price: number;
  currency: string;
  position: number;
  sourceUrl: string;
}

interface CardmarketProductPrice {
  cardId: string;
  name: string;
  setCode: string;
  cardNumber: string;
  variantType: string;
  trendPrice: number;
  lowPrice: number;
  avgPrice: number;
  avg1Day?: number;
  avg7Day?: number;
  avg30Day?: number;
  availableItems: number;
  currency: string;
}

// =============================================================================
// PROXY MANAGEMENT
// =============================================================================

class ProxyRotator {
  private proxies: ProxyConfig[] = [];
  private currentIndex = 0;

  constructor(username: string, password: string) {
    // Using Bright Data residential proxy for EU IPs
    this.proxies = [
      {
        host: "brd.superproxy.io",
        port: 22225,
        username: `${username}-country-de`,
        password,
      },
      {
        host: "brd.superproxy.io",
        port: 22225,
        username: `${username}-country-fr`,
        password,
      },
      {
        host: "brd.superproxy.io",
        port: 22225,
        username: `${username}-country-nl`,
        password,
      },
    ];
  }

  getProxyUrl(): string {
    const proxy = this.proxies[this.currentIndex];
    this.currentIndex = (this.currentIndex + 1) % this.proxies.length;
    return `http://${proxy.username}:${proxy.password}@${proxy.host}:${proxy.port}`;
  }
}

// =============================================================================
// SCRAPER
// =============================================================================

class CardmarketScraper {
  private proxyRotator: ProxyRotator | null;

  constructor(proxyRotator: ProxyRotator | null = null) {
    this.proxyRotator = proxyRotator;
  }

  private async fetchPage(url: string): Promise<string> {
    await rateLimiter.acquire();

    const response = await withRetry(
      async () => {
        // Note: In production Lambda, configure proxy via http agent
        const res = await fetch(url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9,de;q=0.8",
            "Accept-Encoding": "gzip, deflate, br",
            "DNT": "1",
            "Connection": "keep-alive",
            "Upgrade-Insecure-Requests": "1",
          },
        });

        if (!res.ok) {
          if (res.status === 429) {
            throw new Error("Rate limited");
          }
          if (res.status === 403) {
            throw new Error("Blocked - need different proxy");
          }
          throw new Error(`HTTP ${res.status}`);
        }

        return res.text();
      },
      { maxRetries: 3, baseDelayMs: 5000 }
    );

    return response;
  }

  /**
   * Scrape weekly trending cards from Cardmarket
   */
  async scrapeTrendingCards(): Promise<CardmarketTrendCard[]> {
    const cards: CardmarketTrendCard[] = [];

    // Scrape Top Cards page
    const topCardsUrl = `${CARDMARKET_ONEPIECE}/Expansions`;
    const html = await this.fetchPage(topCardsUrl);

    // Parse trending cards from HTML
    // Strategy 1: Look for JSON-LD data
    const jsonLdMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g);
    if (jsonLdMatch) {
      for (const block of jsonLdMatch) {
        try {
          const jsonStr = block.replace(/<script[^>]*>|<\/script>/g, "");
          const data = JSON.parse(jsonStr);
          if (data["@type"] === "ItemList" && data.itemListElement) {
            for (const item of data.itemListElement) {
              if (item.item && item.item.offers) {
                cards.push({
                  url: item.item.url || "",
                  title: item.item.name || "",
                  imageUrl: item.item.image || "",
                  price: parseFloat(item.item.offers.price) || 0,
                  currency: item.item.offers.priceCurrency || "EUR",
                  position: item.position || 0,
                  sourceUrl: topCardsUrl,
                });
              }
            }
          }
        } catch {
          // Continue to next block
        }
      }
    }

    // Strategy 2: Parse HTML directly
    if (cards.length === 0) {
      const cardPattern = /<div[^>]*class="[^"]*col-product[^"]*"[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>[\s\S]*?<span[^>]*class="[^"]*product-name[^"]*"[^>]*>([^<]+)<[\s\S]*?<span[^>]*class="[^"]*price-container[^"]*"[^>]*>([^<]+)</gi;
      let match;

      while ((match = cardPattern.exec(html)) !== null) {
        const [, url, name, priceStr] = match;
        const price = parseFloat(priceStr.replace(/[^\d.,]/g, "").replace(",", "."));

        if (price > 0) {
          cards.push({
            url: url.startsWith("http") ? url : `${CARDMARKET_BASE}${url}`,
            title: sanitizeString(name),
            imageUrl: "",
            price,
            currency: "EUR",
            position: cards.length + 1,
            sourceUrl: topCardsUrl,
          });
        }
      }
    }

    return cards;
  }

  /**
   * Scrape product list from an expansion page
   */
  async scrapeExpansion(expansionName: string): Promise<CardmarketProductPrice[]> {
    const products: CardmarketProductPrice[] = [];

    // URL encode the expansion name
    const encodedName = encodeURIComponent(expansionName.replace(/ /g, "-"));
    const expansionUrl = `${CARDMARKET_ONEPIECE}/Products/Singles/${encodedName}`;

    console.log(`Scraping expansion: ${expansionUrl}`);

    const html = await this.fetchPage(expansionUrl);

    // Find set code from our mapping
    const expansion = ONEPIECE_EXPANSIONS.find(e => e.name === expansionName);
    const setCode = expansion?.code || "";

    // Parse product cards from HTML
    // Look for product rows with price data
    const productPattern = /<div[^>]*class="[^"]*table-body[^"]*"[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*title="([^"]+)"[\s\S]*?<span[^>]*class="[^"]*trend[^"]*"[^>]*>([^<]+)<[\s\S]*?<span[^>]*class="[^"]*lowPrice[^"]*"[^>]*>([^<]+)</gi;

    let match;
    while ((match = productPattern.exec(html)) !== null) {
      const [, url, name, trendPriceStr, lowPriceStr] = match;

      const trendPrice = parseFloat(trendPriceStr.replace(/[^\d.,]/g, "").replace(",", ".")) || 0;
      const lowPrice = parseFloat(lowPriceStr.replace(/[^\d.,]/g, "").replace(",", ".")) || 0;

      // Extract card number from URL or name
      const cardNumberMatch = name.match(/([A-Z]+\d+)-(\d+)/i) || url.match(/([A-Z]+\d+)-(\d+)/i);

      if (cardNumberMatch && trendPrice > 0) {
        const cardSetCode = cardNumberMatch[1].toUpperCase();
        const cardNumber = cardNumberMatch[2];
        const variantType = detectVariantType(name);

        products.push({
          cardId: normalizeCardId(cardSetCode, cardNumber, variantType),
          name: sanitizeString(name),
          setCode: cardSetCode || setCode,
          cardNumber,
          variantType,
          trendPrice,
          lowPrice,
          avgPrice: trendPrice, // Use trend as avg if not available
          availableItems: 0,
          currency: "EUR",
        });
      }
    }

    // Alternative parsing: table rows
    if (products.length === 0) {
      const tableRowPattern = /<tr[^>]*class="[^"]*article-row[^"]*"[^>]*>[\s\S]*?<a[^>]*>([^<]+)<[\s\S]*?data-trend="([^"]+)"[\s\S]*?data-lowprice="([^"]+)"/gi;

      while ((match = tableRowPattern.exec(html)) !== null) {
        const [, name, trendStr, lowStr] = match;
        const trendPrice = parseFloat(trendStr) || 0;
        const lowPrice = parseFloat(lowStr) || 0;

        const cardNumberMatch = name.match(/([A-Z]+\d+)-(\d+)/i);

        if (cardNumberMatch && trendPrice > 0) {
          products.push({
            cardId: normalizeCardId(cardNumberMatch[1], cardNumberMatch[2], "regular"),
            name: sanitizeString(name),
            setCode: cardNumberMatch[1].toUpperCase(),
            cardNumber: cardNumberMatch[2],
            variantType: "regular",
            trendPrice,
            lowPrice,
            avgPrice: trendPrice,
            availableItems: 0,
            currency: "EUR",
          });
        }
      }
    }

    console.log(`  Found ${products.length} products`);
    return products;
  }

  /**
   * Scrape detailed price info from a product page
   */
  async scrapeProductPage(productUrl: string): Promise<CardmarketProductPrice | null> {
    const html = await this.fetchPage(productUrl);

    // Extract price guide data
    const trendMatch = html.match(/Trend Price[^<]*<[^>]*>([^<]+)</i);
    const lowMatch = html.match(/From[^<]*<[^>]*>([^<]+)</i);
    const avgMatch = html.match(/30-days average[^<]*<[^>]*>([^<]+)</i);
    const avg7Match = html.match(/7-days average[^<]*<[^>]*>([^<]+)</i);
    const avg1Match = html.match(/1-day average[^<]*<[^>]*>([^<]+)</i);

    const titleMatch = html.match(/<h1[^>]*>([^<]+)</);
    const cardIdMatch = productUrl.match(/([A-Z]+\d+)-(\d+)/i);

    if (!cardIdMatch) return null;

    const parsePrice = (str: string | undefined): number => {
      if (!str) return 0;
      return parseFloat(str.replace(/[^\d.,]/g, "").replace(",", ".")) || 0;
    };

    return {
      cardId: normalizeCardId(cardIdMatch[1], cardIdMatch[2], "regular"),
      name: titleMatch ? sanitizeString(titleMatch[1]) : "",
      setCode: cardIdMatch[1].toUpperCase(),
      cardNumber: cardIdMatch[2],
      variantType: "regular",
      trendPrice: parsePrice(trendMatch?.[1]),
      lowPrice: parsePrice(lowMatch?.[1]),
      avgPrice: parsePrice(avgMatch?.[1]),
      avg30Day: parsePrice(avgMatch?.[1]),
      avg7Day: parsePrice(avg7Match?.[1]),
      avg1Day: parsePrice(avg1Match?.[1]),
      availableItems: 0,
      currency: "EUR",
    };
  }
}

// =============================================================================
// DATA PROCESSING
// =============================================================================

interface ExtendedPriceEvent extends PriceEvent {
  trendPrice?: number;
  lowPrice?: number;
  avgPrice?: number;
  sourceQuality?: string;
}

function createPriceEventFromCardmarket(
  product: CardmarketProductPrice,
  collectedAt: string
): ExtendedPriceEvent | null {
  const source = "cardmarket";

  if (product.trendPrice <= 0 && product.avgPrice <= 0) {
    dataQualityTracker.recordDropped(source, "no_price_data", {
      title: product.name,
    });
    return null;
  }

  // Use trend price as primary, fallback to avg
  const price = product.trendPrice || product.avgPrice;

  // Convert EUR to USD and GBP
  const { priceUsd, priceGbp } = normalizePrice(price, "EUR");

  dataQualityTracker.recordSuccess(source, {
    fuzzyMatched: false,
    unknownCondition: false,
  });

  return {
    eventType: "price",
    source,
    cardId: product.cardId,
    externalId: product.cardId,
    name: product.name,
    setCode: product.setCode,
    cardNumber: product.cardNumber,
    variantType: product.variantType,
    condition: "NM", // Cardmarket trend prices are for NM
    language: "EN",
    price,
    currency: "EUR",
    priceUsd,
    priceGbp,
    listingsCount: product.availableItems,
    sellerId: undefined,
    timestamp: collectedAt,
    collectedAt,
    // Extended fields
    trendPrice: product.trendPrice,
    lowPrice: product.lowPrice,
    avgPrice: product.avgPrice,
    sourceQuality: "medium", // Scraped data has lower confidence
  };
}

// =============================================================================
// MAIN HANDLER
// =============================================================================

export const handler: Handler<ScheduledEvent> = async (event) => {
  console.log("Cardmarket scraper started", { event });
  const collectedAt = nowIso();

  dataQualityTracker.reset();

  try {
    // Fetch live FX rates
    await fetchLiveFxRates();

    // Get proxy credentials (optional)
    let proxyRotator: ProxyRotator | null = null;
    try {
      const secrets = await getSecrets();
      if (secrets.proxy_username && secrets.proxy_password) {
        proxyRotator = new ProxyRotator(secrets.proxy_username, secrets.proxy_password);
      }
    } catch {
      console.warn("Proxy credentials not available, using direct connection");
    }

    const scraper = new CardmarketScraper(proxyRotator);

    const allPriceEvents: ExtendedPriceEvent[] = [];

    // Scrape each expansion
    for (const expansion of ONEPIECE_EXPANSIONS) {
      console.log(`Processing expansion: ${expansion.name} (${expansion.code})`);

      try {
        const products = await scraper.scrapeExpansion(expansion.name);

        for (const product of products) {
          const priceEvent = createPriceEventFromCardmarket(product, collectedAt);
          if (priceEvent) {
            allPriceEvents.push(priceEvent);
          }
        }

        // Delay between expansions
        await sleep(5000);
      } catch (error) {
        console.warn(`Failed to scrape ${expansion.name}:`, error);
        dataQualityTracker.recordDropped("cardmarket", "scrape_failed", {
          title: expansion.name,
        });
      }
    }

    console.log(`Total price events: ${allPriceEvents.length}`);

    // Log data quality
    dataQualityTracker.logSummary();
    const qualityMetrics = dataQualityTracker.getMetrics();
    const droppedSample = dataQualityTracker.getDroppedRecords().slice(0, 10);

    // Send to Kinesis
    if (allPriceEvents.length > 0) {
      await putToKinesis(PRICE_STREAM, allPriceEvents);
    }

    // Update DynamoDB
    if (allPriceEvents.length > 0) {
      await batchUpdateCurrentPrices(CURRENT_PRICES_TABLE, allPriceEvents);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        priceEvents: allPriceEvents.length,
        expansionsProcessed: ONEPIECE_EXPANSIONS.length,
        collectedAt,
        dataQuality: {
          metrics: qualityMetrics,
          droppedSample,
        },
      }),
    };
  } catch (error) {
    console.error("Cardmarket scraper error:", error);
    dataQualityTracker.logSummary();
    throw error;
  }
};
