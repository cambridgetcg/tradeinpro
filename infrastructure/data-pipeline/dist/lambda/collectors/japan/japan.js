"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
const utils_1 = require("/opt/nodejs/utils");
// =============================================================================
// CONFIGURATION
// =============================================================================
const YAHOO_AUCTIONS_BASE = "https://auctions.yahoo.co.jp";
const MERCARI_BASE = "https://jp.mercari.com";
const PRICE_STREAM = process.env.PRICE_STREAM_NAME;
const LISTING_STREAM = process.env.LISTING_STREAM_NAME;
const SALES_STREAM = process.env.SALES_STREAM_NAME;
const CURRENT_PRICES_TABLE = process.env.CURRENT_PRICES_TABLE;
// Rate limiter: Conservative to avoid blocks
const rateLimiter = new utils_1.RateLimiter(1, 1); // 1 request per second
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
// PROXY MANAGEMENT
// =============================================================================
class ProxyRotator {
    constructor(username, password) {
        this.proxies = [];
        this.currentIndex = 0;
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
    getProxy() {
        const proxy = this.proxies[this.currentIndex];
        this.currentIndex = (this.currentIndex + 1) % this.proxies.length;
        return proxy;
    }
    getProxyUrl() {
        const proxy = this.getProxy();
        return `http://${proxy.username}:${proxy.password}@${proxy.host}:${proxy.port}`;
    }
}
// =============================================================================
// SCRAPER BASE CLASS
// =============================================================================
class JapanScraper {
    constructor(proxyRotator) {
        this.proxyRotator = proxyRotator;
    }
    async fetchWithProxy(url) {
        await rateLimiter.acquire();
        // In production, would use proxy
        // For Lambda, use fetch-with-proxy library or custom implementation
        const response = await (0, utils_1.withRetry)(async () => {
            // Note: In actual Lambda deployment, would configure proxy via HTTP agent
            const res = await fetch(url, {
                headers: {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                    "Accept-Language": "ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7",
                    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
                },
            });
            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
            }
            return res.text();
        }, { maxRetries: 3, baseDelayMs: 2000 });
        return response;
    }
}
// =============================================================================
// YAHOO AUCTIONS SCRAPER
// =============================================================================
class YahooAuctionsScraper extends JapanScraper {
    async search(keyword) {
        const encodedKeyword = encodeURIComponent(keyword);
        const url = `${YAHOO_AUCTIONS_BASE}/search/search?p=${encodedKeyword}&va=${encodedKeyword}&auccat=2084307365&n=100&mode=1`;
        const html = await this.fetchWithProxy(url);
        return this.parseSearchResults(html);
    }
    parseSearchResults(html) {
        const items = [];
        // Try multiple parsing strategies for robustness
        // Strategy 1: Standard data attributes
        const pattern1 = /data-auction-id="([^"]+)"[\s\S]*?<a[^>]+>([^<]+)<\/a>[\s\S]*?data-price="(\d+)"/g;
        let match1;
        while ((match1 = pattern1.exec(html)) !== null) {
            const [, auctionId, title, price] = match1;
            items.push({
                auctionId,
                title: (0, utils_1.sanitizeString)(title),
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
                                    title: (0, utils_1.sanitizeString)(data.name || ""),
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
                    }
                    catch {
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
                        title: (0, utils_1.sanitizeString)(title),
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
        }
        else {
            console.warn("[YahooParser] No items extracted from HTML - structure may have changed");
            utils_1.dataQualityTracker.recordDropped("yahoo_jp", "html_parse_failed", {
                rawData: { htmlLength: html.length, sample: html.slice(0, 500) },
            });
        }
        return items;
    }
    async getItemDetails(auctionId) {
        const url = `${YAHOO_AUCTIONS_BASE}/item/${auctionId}`;
        const html = await this.fetchWithProxy(url);
        // Parse item details
        const titleMatch = html.match(/<h1[^>]*class="[^"]*ProductTitle[^"]*"[^>]*>([^<]+)<\/h1>/);
        const priceMatch = html.match(/data-price="(\d+)"/);
        const bidMatch = html.match(/入札件数[^\d]*(\d+)/);
        const sellerMatch = html.match(/data-seller-id="([^"]+)"/);
        const conditionMatch = html.match(/商品の状態[^<]*<[^>]+>([^<]+)</);
        if (!titleMatch || !priceMatch)
            return null;
        return {
            auctionId,
            title: (0, utils_1.sanitizeString)(titleMatch[1]),
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
    async getCompletedSales(keyword) {
        // Yahoo Auctions completed listings
        const encodedKeyword = encodeURIComponent(keyword);
        const url = `${YAHOO_AUCTIONS_BASE}/closedsearch/closedsearch?p=${encodedKeyword}&auccat=2084307365&n=50`;
        const html = await this.fetchWithProxy(url);
        const sales = [];
        // Parse completed sales
        const itemPattern = /data-auction-id="([^"]+)"[\s\S]*?<a[^>]+>([^<]+)<\/a>[\s\S]*?class="[^"]*Price[^"]*"[^>]*>([^<]+)</g;
        let match;
        const collectedAt = (0, utils_1.nowIso)();
        while ((match = itemPattern.exec(html)) !== null) {
            const [, auctionId, title, priceStr] = match;
            const price = parseInt(priceStr.replace(/[^\d]/g, ""), 10);
            const cardInfo = this.extractCardInfo(title);
            if (cardInfo && price > 0) {
                const { priceUsd } = (0, utils_1.normalizePrice)(price, "JPY");
                sales.push({
                    eventType: "sale",
                    source: "yahoo_jp",
                    saleId: `yahoo-${auctionId}`,
                    cardId: (0, utils_1.normalizeCardId)(cardInfo.setCode, cardInfo.cardNumber, cardInfo.variantType),
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
    extractCardInfo(title) {
        // Match card number pattern
        const match = title.match(/([A-Z]{2,3}\d{2})-(\d{3})/i);
        if (!match)
            return null;
        const setCode = match[1].toUpperCase();
        const cardNumber = match[2];
        // Detect variant
        let variantType = "regular";
        const titleLower = title.toLowerCase();
        if (titleLower.includes("パラレル") || titleLower.includes("parallel")) {
            variantType = "parallel";
        }
        else if (titleLower.includes("コミパラ") || titleLower.includes("manga")) {
            variantType = "manga";
        }
        else if (titleLower.includes("sp") || titleLower.includes("スペシャル")) {
            variantType = "sp";
        }
        return { setCode, cardNumber, variantType };
    }
}
// =============================================================================
// MERCARI SCRAPER
// =============================================================================
class MercariScraper extends JapanScraper {
    async search(keyword) {
        // Mercari uses a dynamic API, so we need to scrape the search page
        // or reverse-engineer their API
        const encodedKeyword = encodeURIComponent(keyword);
        const url = `${MERCARI_BASE}/search?keyword=${encodedKeyword}&category_id=1291&status=on_sale`;
        const html = await this.fetchWithProxy(url);
        return this.parseSearchResults(html);
    }
    parseSearchResults(html) {
        const items = [];
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
            }
            catch (error) {
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
                }
                catch {
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
                    title: (0, utils_1.sanitizeString)(title),
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
        }
        else {
            console.warn("[MercariParser] No items extracted - page structure may have changed");
            utils_1.dataQualityTracker.recordDropped("mercari_jp", "html_parse_failed", {
                rawData: { htmlLength: html.length, sample: html.slice(0, 500) },
            });
        }
        return items;
    }
    async getSoldItems(keyword) {
        const encodedKeyword = encodeURIComponent(keyword);
        const url = `${MERCARI_BASE}/search?keyword=${encodedKeyword}&category_id=1291&status=sold_out`;
        const html = await this.fetchWithProxy(url);
        const items = this.parseSearchResults(html);
        const collectedAt = (0, utils_1.nowIso)();
        const sales = [];
        for (const item of items) {
            const cardInfo = this.extractCardInfo(item.title);
            if (cardInfo && item.price > 0) {
                const { priceUsd } = (0, utils_1.normalizePrice)(item.price, "JPY");
                sales.push({
                    eventType: "sale",
                    source: "mercari_jp",
                    saleId: `mercari-${item.itemId}`,
                    cardId: (0, utils_1.normalizeCardId)(cardInfo.setCode, cardInfo.cardNumber, cardInfo.variantType),
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
    extractCardInfo(title) {
        const match = title.match(/([A-Z]{2,3}\d{2})-(\d{3})/i);
        if (!match)
            return null;
        const setCode = match[1].toUpperCase();
        const cardNumber = match[2];
        let variantType = "regular";
        const titleLower = title.toLowerCase();
        if (titleLower.includes("パラレル") || titleLower.includes("parallel")) {
            variantType = "parallel";
        }
        else if (titleLower.includes("コミパラ")) {
            variantType = "manga";
        }
        else if (titleLower.includes("スペシャル") || titleLower.includes("sp")) {
            variantType = "sp";
        }
        return { setCode, cardNumber, variantType };
    }
    normalizeCondition(condition) {
        const conditionMap = {
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
function createPriceEventFromYahoo(item, collectedAt) {
    const source = "yahoo_jp";
    // Try standard pattern first
    const cardMatch = item.title.match(/([A-Z]{2,3}\d{2})-(\d{3})/i);
    let setCode;
    let cardNumber;
    let fuzzyMatched = false;
    let confidence = "high";
    if (cardMatch) {
        setCode = cardMatch[1].toUpperCase();
        cardNumber = cardMatch[2];
    }
    else {
        // Try fuzzy matching
        const fuzzyResult = (0, utils_1.fuzzyMatchCard)(item.title);
        if (fuzzyResult) {
            setCode = fuzzyResult.setCode;
            cardNumber = fuzzyResult.cardNumber;
            fuzzyMatched = true;
            confidence = fuzzyResult.confidence;
        }
        else {
            utils_1.dataQualityTracker.recordDropped(source, "no_card_id_pattern", { title: item.title });
            return null;
        }
    }
    // Use standardized variant detection
    const variantType = (0, utils_1.detectVariantType)(item.title);
    const cardId = (0, utils_1.normalizeCardId)(setCode, cardNumber, variantType);
    const price = item.buyNowPrice || item.currentPrice;
    if (price <= 0) {
        utils_1.dataQualityTracker.recordDropped(source, "invalid_price", {
            title: item.title,
            rawData: { price },
        });
        return null;
    }
    const { priceUsd, priceGbp } = (0, utils_1.normalizePrice)(price, "JPY");
    // Handle unknown condition properly - don't assume NM
    const conditionResult = (0, utils_1.normalizeConditionWithTracking)(item.condition || "");
    const condition = conditionResult.isKnown ? conditionResult.condition : "UNKNOWN";
    // Calculate seller reputation if available
    const sellerRepTier = (0, utils_1.calculateSellerReputation)(undefined, item.sellerRating);
    const weightFactor = (0, utils_1.getSellerWeightFactor)(sellerRepTier);
    // Track success
    utils_1.dataQualityTracker.recordSuccess(source, {
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
function createPriceEventFromMercari(item, collectedAt) {
    const source = "mercari_jp";
    // Try standard pattern first
    const cardMatch = item.title.match(/([A-Z]{2,3}\d{2})-(\d{3})/i);
    let setCode;
    let cardNumber;
    let fuzzyMatched = false;
    let confidence = "high";
    if (cardMatch) {
        setCode = cardMatch[1].toUpperCase();
        cardNumber = cardMatch[2];
    }
    else {
        // Try fuzzy matching
        const fuzzyResult = (0, utils_1.fuzzyMatchCard)(item.title);
        if (fuzzyResult) {
            setCode = fuzzyResult.setCode;
            cardNumber = fuzzyResult.cardNumber;
            fuzzyMatched = true;
            confidence = fuzzyResult.confidence;
        }
        else {
            utils_1.dataQualityTracker.recordDropped(source, "no_card_id_pattern", { title: item.title });
            return null;
        }
    }
    // Use standardized variant detection
    const variantType = (0, utils_1.detectVariantType)(item.title);
    const cardId = (0, utils_1.normalizeCardId)(setCode, cardNumber, variantType);
    if (item.price <= 0) {
        utils_1.dataQualityTracker.recordDropped(source, "invalid_price", {
            title: item.title,
            rawData: { price: item.price },
        });
        return null;
    }
    const { priceUsd, priceGbp } = (0, utils_1.normalizePrice)(item.price, "JPY");
    // Use unified condition tracking
    const conditionResult = (0, utils_1.normalizeConditionWithTracking)(item.condition || "");
    const condition = conditionResult.isKnown ? conditionResult.condition : "UNKNOWN";
    // Track success
    utils_1.dataQualityTracker.recordSuccess(source, {
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
const handler = async (event) => {
    console.log("Japan collector started", { event });
    const collectedAt = (0, utils_1.nowIso)();
    // Reset data quality tracker for this run
    utils_1.dataQualityTracker.reset();
    try {
        // Fetch live FX rates before processing (important for JPY conversion)
        await (0, utils_1.fetchLiveFxRates)();
        // Get proxy credentials
        const secrets = await (0, utils_1.getSecrets)();
        if (!secrets.proxy_username || !secrets.proxy_password) {
            console.warn("Proxy credentials not configured, using direct connection");
        }
        const proxyRotator = new ProxyRotator(secrets.proxy_username || "", secrets.proxy_password || "");
        const yahooScraper = new YahooAuctionsScraper(proxyRotator);
        const mercariScraper = new MercariScraper(proxyRotator);
        const allPriceEvents = [];
        const allSalesEvents = [];
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
                await (0, utils_1.sleep)(2000);
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
                await (0, utils_1.sleep)(3000);
            }
            catch (error) {
                console.warn(`Failed to process keyword "${keyword}":`, error);
            }
        }
        // Deduplicate
        const uniquePrices = new Map();
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
            await (0, utils_1.putToKinesis)(PRICE_STREAM, finalPriceEvents);
        }
        if (allSalesEvents.length > 0) {
            await (0, utils_1.putToKinesis)(SALES_STREAM, allSalesEvents);
        }
        // Update DynamoDB
        if (finalPriceEvents.length > 0) {
            await (0, utils_1.batchUpdateCurrentPrices)(CURRENT_PRICES_TABLE, finalPriceEvents);
        }
        // Log data quality summary
        utils_1.dataQualityTracker.logSummary();
        // Get data quality metrics for response
        const qualityMetrics = utils_1.dataQualityTracker.getMetrics();
        const droppedSample = utils_1.dataQualityTracker.getDroppedRecords().slice(0, 10);
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
    }
    catch (error) {
        console.error("Japan collector error:", error);
        // Still log data quality even on error
        utils_1.dataQualityTracker.logSummary();
        throw error;
    }
};
exports.handler = handler;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiamFwYW4uanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9sYW1iZGEvY29sbGVjdG9ycy9qYXBhbi9qYXBhbi50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiO0FBQUE7Ozs7Ozs7OztHQVNHOzs7QUFHSCw2Q0F1QjJCO0FBRTNCLGdGQUFnRjtBQUNoRixnQkFBZ0I7QUFDaEIsZ0ZBQWdGO0FBRWhGLE1BQU0sbUJBQW1CLEdBQUcsOEJBQThCLENBQUM7QUFDM0QsTUFBTSxZQUFZLEdBQUcsd0JBQXdCLENBQUM7QUFFOUMsTUFBTSxZQUFZLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxpQkFBa0IsQ0FBQztBQUNwRCxNQUFNLGNBQWMsR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLG1CQUFvQixDQUFDO0FBQ3hELE1BQU0sWUFBWSxHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUMsaUJBQWtCLENBQUM7QUFDcEQsTUFBTSxvQkFBb0IsR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLG9CQUFxQixDQUFDO0FBRS9ELDZDQUE2QztBQUM3QyxNQUFNLFdBQVcsR0FBRyxJQUFJLG1CQUFXLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUMsdUJBQXVCO0FBRWxFLDhCQUE4QjtBQUM5QixNQUFNLGVBQWUsR0FBRztJQUN0QixhQUFhLEVBQUUsc0JBQXNCO0lBQ3JDLFdBQVc7SUFDWCxNQUFNO0lBQ04sTUFBTTtJQUNOLE1BQU07SUFDTixNQUFNO0lBQ04sTUFBTTtJQUNOLE1BQU07SUFDTixNQUFNO0lBQ04sTUFBTTtJQUNOLE1BQU07SUFDTixNQUFNO0lBQ04sTUFBTTtJQUNOLE1BQU07SUFDTixNQUFNO0lBQ04sTUFBTSxFQUFFLFdBQVc7SUFDbkIsVUFBVSxFQUFFLGNBQWM7SUFDMUIsTUFBTSxFQUFFLGlCQUFpQjtDQUMxQixDQUFDO0FBdUNGLGdGQUFnRjtBQUNoRixtQkFBbUI7QUFDbkIsZ0ZBQWdGO0FBRWhGLE1BQU0sWUFBWTtJ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QUssQ0FBQyx3QkFBd0IsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUUvQyx1Q0FBdUM7UUFDdkMsMEJBQWtCLENBQUMsVUFBVSxFQUFFLENBQUM7UUFFaEMsTUFBTSxLQUFLLENBQUM7SUFDZCxDQUFDO0FBQ0gsQ0FBQyxDQUFDO0FBdElXLFFBQUEsT0FBTyxXQXNJbEIiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIEphcGFuIE1hcmtldCBEYXRhIENvbGxlY3RvciBMYW1iZGFcbiAqXG4gKiBTY3JhcGVzIHByaWNlIGRhdGEgZnJvbSBKYXBhbmVzZSBtYXJrZXRwbGFjZXM6XG4gKiAtIFlhaG9vIEF1Y3Rpb25zIEphcGFuXG4gKiAtIE1lcmNhcmkgSmFwYW5cbiAqXG4gKiBVc2VzIHJvdGF0aW5nIHByb3hpZXMgdG8gYXZvaWQgSVAgYmxvY2tzLlxuICogUmVxdWlyZXMgSmFwYW5lc2UgdGV4dCBwYXJzaW5nIGZvciBjYXJkIGlkZW50aWZpY2F0aW9uLlxuICovXG5cbmltcG9ydCB7IEhhbmRsZXIsIFNjaGVkdWxlZEV2ZW50IH0gZnJvbSBcImF3cy1sYW1iZGFcIjtcbmltcG9ydCB7XG4gIGdldFNlY3JldHMsXG4gIHB1dFRvS2luZXNpcyxcbiAgYmF0Y2hVcGRhdGVDdXJyZW50UHJpY2VzLFxuICBub3JtYWxpemVQcmljZSxcbiAgbm9ybWFsaXplUHJpY2VBc3luYyxcbiAgZmV0Y2hMaXZlRnhSYXRlcyxcbiAgbm9ybWFsaXplQ2FyZElkLFxuICBub3JtYWxpemVDb25kaXRpb24sXG4gIG5vcm1hbGl6ZUNvbmRpdGlvbldpdGhUcmFja2luZyxcbiAgUmF0ZUxpbWl0ZXIsXG4gIHdpdGhSZXRyeSxcbiAgbm93SXNvLFxuICBzbGVlcCxcbiAgc2FuaXRpemVTdHJpbmcsXG4gIFByaWNlRXZlbnQsXG4gIExpc3RpbmdFdmVudCxcbiAgU2FsZXNFdmVudCxcbiAgZGF0YVF1YWxpdHlUcmFja2VyLFxuICBmdXp6eU1hdGNoQ2FyZCxcbiAgZGV0ZWN0VmFyaWFudFR5cGUsXG4gIGNhbGN1bGF0ZVNlbGxlclJlcHV0YXRpb24sXG4gIGdldFNlbGxlcldlaWdodEZhY3Rvcixcbn0gZnJvbSBcIi9vcHQvbm9kZWpzL3V0aWxzXCI7XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBDT05GSUdVUkFUSU9OXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG5jb25zdCBZQUhPT19BVUNUSU9OU19CQVNFID0gXCJodHRwczovL2F1Y3Rpb25zLnlhaG9vLmNvLmpwXCI7XG5jb25zdCBNRVJDQVJJX0JBU0UgPSBcImh0dHBzOi8vanAubWVyY2FyaS5jb21cIjtcblxuY29uc3QgUFJJQ0VfU1RSRUFNID0gcHJvY2Vzcy5lbnYuUFJJQ0VfU1RSRUFNX05BTUUhO1xuY29uc3QgTElTVElOR19TVFJFQU0gPSBwcm9jZXNzLmVudi5MSVNUSU5HX1NUUkVBTV9OQU1FITtcbmNvbnN0IFNBTEVTX1NUUkVBTSA9IHByb2Nlc3MuZW52LlNBTEVTX1NUUkVBTV9OQU1FITtcbmNvbnN0IENVUlJFTlRfUFJJQ0VTX1RBQkxFID0gcHJvY2Vzcy5lbnYuQ1VSUkVOVF9QUklDRVNfVEFCTEUhO1xuXG4vLyBSYXRlIGxpbWl0ZXI6IENvbnNlcnZhdGl2ZSB0byBhdm9pZCBibG9ja3NcbmNvbnN0IHJhdGVMaW1pdGVyID0gbmV3IFJhdGVMaW1pdGVyKDEsIDEpOyAvLyAxIHJlcXVlc3QgcGVyIHNlY29uZFxuXG4vLyBTZWFyY2gga2V5d29yZHMgaW4gSmFwYW5lc2VcbmNvbnN0IFNFQVJDSF9LRVlXT1JEUyA9IFtcbiAgXCLjg6/jg7Pjg5Tjg7zjgrnjgqvjg7zjg4njgrLjg7zjg6BcIiwgLy8gT25lIFBpZWNlIENhcmQgR2FtZVxuICBcIuODr+ODs+ODlOODvOOCuSDjgqvjg7zjg4lcIixcbiAgXCJPUDAxXCIsXG4gIFwiT1AwMlwiLFxuICBcIk9QMDNcIixcbiAgXCJPUDA0XCIsXG4gIFwiT1AwNVwiLFxuICBcIk9QMDZcIixcbiAgXCJPUDA3XCIsXG4gIFwiT1AwOFwiLFxuICBcIk9QMDlcIixcbiAgXCJPUDEwXCIsXG4gIFwiT1AxMVwiLFxuICBcIkVCMDFcIixcbiAgXCJFQjAyXCIsXG4gIFwi44OR44Op44Os44OrXCIsIC8vIFBhcmFsbGVsXG4gIFwi44K544Oa44K344Oj44Or44Ki44O844OIXCIsIC8vIFNwZWNpYWwgQXJ0XG4gIFwi44Kz44Of44OR44OpXCIsIC8vIENvbWljIFBhcmFsbGVsXG5dO1xuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gVFlQRVNcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbmludGVyZmFjZSBQcm94eUNvbmZpZyB7XG4gIGhvc3Q6IHN0cmluZztcbiAgcG9ydDogbnVtYmVyO1xuICB1c2VybmFtZTogc3RyaW5nO1xuICBwYXNzd29yZDogc3RyaW5nO1xufVxuXG5pbnRlcmZhY2UgWWFob29BdWN0aW9uSXRlbSB7XG4gIGF1Y3Rpb25JZDogc3RyaW5nO1xuICB0aXRsZTogc3RyaW5nO1xuICBjdXJyZW50UHJpY2U6IG51bWJlcjtcbiAgYnV5Tm93UHJpY2U6IG51bWJlciB8IG51bGw7XG4gIGJpZENvdW50OiBudW1iZXI7XG4gIGVuZFRpbWU6IHN0cmluZztcbiAgc2VsbGVySWQ6IHN0cmluZztcbiAgc2VsbGVyUmF0aW5nOiBudW1iZXI7XG4gIGNvbmRpdGlvbjogc3RyaW5nO1xuICBpbWFnZVVybHM6IHN0cmluZ1tdO1xuICBjYXRlZ29yeUlkOiBzdHJpbmc7XG59XG5cbmludGVyZmFjZSBNZXJjYXJpSXRlbSB7XG4gIGl0ZW1JZDogc3RyaW5nO1xuICB0aXRsZTogc3RyaW5nO1xuICBwcmljZTogbnVtYmVyO1xuICBzdGF0dXM6IFwib25fc2FsZVwiIHwgXCJ0cmFkaW5nXCIgfCBcInNvbGRfb3V0XCI7XG4gIHNlbGxlcklkOiBzdHJpbmc7XG4gIGNvbmRpdGlvbjogc3RyaW5nO1xuICBpbWFnZVVybHM6IHN0cmluZ1tdO1xuICBjcmVhdGVkQXQ6IHN0cmluZztcbiAgdXBkYXRlZEF0OiBzdHJpbmc7XG59XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBQUk9YWSBNQU5BR0VNRU5UXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG5jbGFzcyBQcm94eVJvdGF0b3Ige1xuICBwcml2YXRlIHByb3hpZXM6IFByb3h5Q29uZmlnW10gPSBbXTtcbiAgcHJpdmF0ZSBjdXJyZW50SW5kZXggPSAwO1xuXG4gIGNvbnN0cnVjdG9yKHVzZXJuYW1lOiBzdHJpbmcsIHBhc3N3b3JkOiBzdHJpbmcpIHtcbiAgICAvLyBVc2luZyBCcmlnaHQgRGF0YSByZXNpZGVudGlhbCBwcm94eSBmb3JtYXRcbiAgICAvLyBFYWNoIHJlcXVlc3QgZ2V0cyBhIG5ldyBJUFxuICAgIHRoaXMucHJveGllcyA9IFtcbiAgICAgIHtcbiAgICAgICAgaG9zdDogXCJicmQuc3VwZXJwcm94eS5pb1wiLFxuICAgICAgICBwb3J0OiAyMjIyNSxcbiAgICAgICAgdXNlcm5hbWU6IGAke3VzZXJuYW1lfS1jb3VudHJ5LWpwYCxcbiAgICAgICAgcGFzc3dvcmQsXG4gICAgICB9LFxuICAgICAge1xuICAgICAgICBob3N0OiBcImJyZC5zdXBlcnByb3h5LmlvXCIsXG4gICAgICAgIHBvcnQ6IDIyMjI1LFxuICAgICAgICB1c2VybmFtZTogYCR7dXNlcm5hbWV9LWNvdW50cnktanAtc2Vzc2lvbi0ke0RhdGUubm93KCl9YCxcbiAgICAgICAgcGFzc3dvcmQsXG4gICAgICB9LFxuICAgIF07XG4gIH1cblxuICBnZXRQcm94eSgpOiBQcm94eUNvbmZpZyB7XG4gICAgY29uc3QgcHJveHkgPSB0aGlzLnByb3hpZXNbdGhpcy5jdXJyZW50SW5kZXhdO1xuICAgIHRoaXMuY3VycmVudEluZGV4ID0gKHRoaXMuY3VycmVudEluZGV4ICsgMSkgJSB0aGlzLnByb3hpZXMubGVuZ3RoO1xuICAgIHJldHVybiBwcm94eTtcbiAgfVxuXG4gIGdldFByb3h5VXJsKCk6IHN0cmluZyB7XG4gICAgY29uc3QgcHJveHkgPSB0aGlzLmdldFByb3h5KCk7XG4gICAgcmV0dXJuIGBodHRwOi8vJHtwcm94eS51c2VybmFtZX06JHtwcm94eS5wYXNzd29yZH1AJHtwcm94eS5ob3N0fToke3Byb3h5LnBvcnR9YDtcbiAgfVxufVxuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gU0NSQVBFUiBCQVNFIENMQVNTXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG5hYnN0cmFjdCBjbGFzcyBKYXBhblNjcmFwZXIge1xuICBwcm90ZWN0ZWQgcHJveHlSb3RhdG9yOiBQcm94eVJvdGF0b3I7XG5cbiAgY29uc3RydWN0b3IocHJveHlSb3RhdG9yOiBQcm94eVJvdGF0b3IpIHtcbiAgICB0aGlzLnByb3h5Um90YXRvciA9IHByb3h5Um90YXRvcjtcbiAgfVxuXG4gIHByb3RlY3RlZCBhc3luYyBmZXRjaFdpdGhQcm94eSh1cmw6IHN0cmluZyk6IFByb21pc2U8c3RyaW5nPiB7XG4gICAgYXdhaXQgcmF0ZUxpbWl0ZXIuYWNxdWlyZSgpO1xuXG4gICAgLy8gSW4gcHJvZHVjdGlvbiwgd291bGQgdXNlIHByb3h5XG4gICAgLy8gRm9yIExhbWJkYSwgdXNlIGZldGNoLXdpdGgtcHJveHkgbGlicmFyeSBvciBjdXN0b20gaW1wbGVtZW50YXRpb25cbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHdpdGhSZXRyeShcbiAgICAgIGFzeW5jICgpID0+IHtcbiAgICAgICAgLy8gTm90ZTogSW4gYWN0dWFsIExhbWJkYSBkZXBsb3ltZW50LCB3b3VsZCBjb25maWd1cmUgcHJveHkgdmlhIEhUVFAgYWdlbnRcbiAgICAgICAgY29uc3QgcmVzID0gYXdhaXQgZmV0Y2godXJsLCB7XG4gICAgICAgICAgaGVhZGVyczoge1xuICAgICAgICAgICAgXCJVc2VyLUFnZW50XCI6XG4gICAgICAgICAgICAgIFwiTW96aWxsYS81LjAgKFdpbmRvd3MgTlQgMTAuMDsgV2luNjQ7IHg2NCkgQXBwbGVXZWJLaXQvNTM3LjM2IChLSFRNTCwgbGlrZSBHZWNrbykgQ2hyb21lLzEyMC4wLjAuMCBTYWZhcmkvNTM3LjM2XCIsXG4gICAgICAgICAgICBcIkFjY2VwdC1MYW5ndWFnZVwiOiBcImphLUpQLGphO3E9MC45LGVuLVVTO3E9MC44LGVuO3E9MC43XCIsXG4gICAgICAgICAgICBBY2NlcHQ6XG4gICAgICAgICAgICAgIFwidGV4dC9odG1sLGFwcGxpY2F0aW9uL3hodG1sK3htbCxhcHBsaWNhdGlvbi94bWw7cT0wLjksaW1hZ2Uvd2VicCwqLyo7cT0wLjhcIixcbiAgICAgICAgICB9LFxuICAgICAgICB9KTtcblxuICAgICAgICBpZiAoIXJlcy5vaykge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgSFRUUCAke3Jlcy5zdGF0dXN9YCk7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gcmVzLnRleHQoKTtcbiAgICAgIH0sXG4gICAgICB7IG1heFJldHJpZXM6IDMsIGJhc2VEZWxheU1zOiAyMDAwIH1cbiAgICApO1xuXG4gICAgcmV0dXJuIHJlc3BvbnNlO1xuICB9XG5cbiAgYWJzdHJhY3Qgc2VhcmNoKGtleXdvcmQ6IHN0cmluZyk6IFByb21pc2U8WWFob29BdWN0aW9uSXRlbVtdIHwgTWVyY2FyaUl0ZW1bXT47XG59XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBZQUhPTyBBVUNUSU9OUyBTQ1JBUEVSXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG5jbGFzcyBZYWhvb0F1Y3Rpb25zU2NyYXBlciBleHRlbmRzIEphcGFuU2NyYXBlciB7XG4gIGFzeW5jIHNlYXJjaChrZXl3b3JkOiBzdHJpbmcpOiBQcm9taXNlPFlhaG9vQXVjdGlvbkl0ZW1bXT4ge1xuICAgIGNvbnN0IGVuY29kZWRLZXl3b3JkID0gZW5jb2RlVVJJQ29tcG9uZW50KGtleXdvcmQpO1xuICAgIGNvbnN0IHVybCA9IGAke1lBSE9PX0FVQ1RJT05TX0JBU0V9L3NlYXJjaC9zZWFyY2g/cD0ke2VuY29kZWRLZXl3b3JkfSZ2YT0ke2VuY29kZWRLZXl3b3JkfSZhdWNjYXQ9MjA4NDMwNzM2NSZuPTEwMCZtb2RlPTFgO1xuXG4gICAgY29uc3QgaHRtbCA9IGF3YWl0IHRoaXMuZmV0Y2hXaXRoUHJveHkodXJsKTtcbiAgICByZXR1cm4gdGhpcy5wYXJzZVNlYXJjaFJlc3VsdHMoaHRtbCk7XG4gIH1cblxuICBwcml2YXRlIHBhcnNlU2VhcmNoUmVzdWx0cyhodG1sOiBzdHJpbmcpOiBZYWhvb0F1Y3Rpb25JdGVtW10ge1xuICAgIGNvbnN0IGl0ZW1zOiBZYWhvb0F1Y3Rpb25JdGVtW10gPSBbXTtcblxuICAgIC8vIFRyeSBtdWx0aXBsZSBwYXJzaW5nIHN0cmF0ZWdpZXMgZm9yIHJvYnVzdG5lc3NcblxuICAgIC8vIFN0cmF0ZWd5IDE6IFN0YW5kYXJkIGRhdGEgYXR0cmlidXRlc1xuICAgIGNvbnN0IHBhdHRlcm4xID0gL2RhdGEtYXVjdGlvbi1pZD1cIihbXlwiXSspXCJbXFxzXFxTXSo/PGFbXj5dKz4oW148XSspPFxcL2E+W1xcc1xcU10qP2RhdGEtcHJpY2U9XCIoXFxkKylcIi9nO1xuICAgIGxldCBtYXRjaDE7XG4gICAgd2hpbGUgKChtYXRjaDEgPSBwYXR0ZXJuMS5leGVjKGh0bWwpKSAhPT0gbnVsbCkge1xuICAgICAgY29uc3QgWywgYXVjdGlvbklkLCB0aXRsZSwgcHJpY2VdID0gbWF0Y2gxO1xuICAgICAgaXRlbXMucHVzaCh7XG4gICAgICAgIGF1Y3Rpb25JZCxcbiAgICAgICAgdGl0bGU6IHNhbml0aXplU3RyaW5nKHRpdGxlKSxcbiAgICAgICAgY3VycmVudFByaWNlOiBwYXJzZUludChwcmljZSwgMTApLFxuICAgICAgICBidXlOb3dQcmljZTogbnVsbCxcbiAgICAgICAgYmlkQ291bnQ6IDAsXG4gICAgICAgIGVuZFRpbWU6IFwiXCIsXG4gICAgICAgIHNlbGxlcklkOiBcIlwiLFxuICAgICAgICBzZWxsZXJSYXRpbmc6IDAsXG4gICAgICAgIGNvbmRpdGlvbjogXCJcIixcbiAgICAgICAgaW1hZ2VVcmxzOiBbXSxcbiAgICAgICAgY2F0ZWdvcnlJZDogXCIyMDg0MzA3MzY1XCIsXG4gICAgICB9KTtcbiAgICB9XG5cbiAgICAvLyBTdHJhdGVneSAyOiBGYWxsYmFjayAtIEpTT04tTEQgc3RydWN0dXJlZCBkYXRhXG4gICAgaWYgKGl0ZW1zLmxlbmd0aCA9PT0gMCkge1xuICAgICAgY29uc3QganNvbkxkTWF0Y2ggPSBodG1sLm1hdGNoKC88c2NyaXB0IHR5cGU9XCJhcHBsaWNhdGlvblxcL2xkXFwranNvblwiPihbXFxzXFxTXSo/KTxcXC9zY3JpcHQ+L2cpO1xuICAgICAgaWYgKGpzb25MZE1hdGNoKSB7XG4gICAgICAgIGZvciAoY29uc3QgYmxvY2sgb2YganNvbkxkTWF0Y2gpIHtcbiAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgY29uc3QganNvblN0ciA9IGJsb2NrLnJlcGxhY2UoLzxzY3JpcHRbXj5dKj58PFxcL3NjcmlwdD4vZywgXCJcIik7XG4gICAgICAgICAgICBjb25zdCBkYXRhID0gSlNPTi5wYXJzZShqc29uU3RyKTtcbiAgICAgICAgICAgIGlmIChkYXRhW1wiQHR5cGVcIl0gPT09IFwiUHJvZHVjdFwiIHx8IGRhdGFbXCJAdHlwZVwiXSA9PT0gXCJJdGVtUGFnZVwiKSB7XG4gICAgICAgICAgICAgIGNvbnN0IG9mZmVycyA9IGRhdGEub2ZmZXJzIHx8IGRhdGEubWFpbkVudGl0eT8ub2ZmZXJzO1xuICAgICAgICAgICAgICBpZiAob2ZmZXJzKSB7XG4gICAgICAgICAgICAgICAgaXRlbXMucHVzaCh7XG4gICAgICAgICAgICAgICAgICBhdWN0aW9uSWQ6IGRhdGEucHJvZHVjdElEIHx8IGRhdGEuaWRlbnRpZmllciB8fCBgcGFyc2VkLSR7RGF0ZS5ub3coKX1gLFxuICAgICAgICAgICAgICAgICAgdGl0bGU6IHNhbml0aXplU3RyaW5nKGRhdGEubmFtZSB8fCBcIlwiKSxcbiAgICAgICAgICAgICAgICAgIGN1cnJlbnRQcmljZTogcGFyc2VJbnQob2ZmZXJzLnByaWNlIHx8IFwiMFwiLCAxMCksXG4gICAgICAgICAgICAgICAgICBidXlOb3dQcmljZTogbnVsbCxcbiAgICAgICAgICAgICAgICAgIGJpZENvdW50OiAwLFxuICAgICAgICAgICAgICAgICAgZW5kVGltZTogXCJcIixcbiAgICAgICAgICAgICAgICAgIHNlbGxlcklkOiBcIlwiLFxuICAgICAgICAgICAgICAgICAgc2VsbGVyUmF0aW5nOiAwLFxuICAgICAgICAgICAgICAgICAgY29uZGl0aW9uOiBvZmZlcnMuaXRlbUNvbmRpdGlvbiB8fCBcIlwiLFxuICAgICAgICAgICAgICAgICAgaW1hZ2VVcmxzOiBkYXRhLmltYWdlID8gW2RhdGEuaW1hZ2VdIDogW10sXG4gICAgICAgICAgICAgICAgICBjYXRlZ29yeUlkOiBcIjIwODQzMDczNjVcIixcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgIH0gY2F0Y2gge1xuICAgICAgICAgICAgLy8gSlNPTiBwYXJzZSBmYWlsZWQsIGNvbnRpbnVlIHRvIG5leHQgYmxvY2tcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBTdHJhdGVneSAzOiBBbHRlcm5hdGl2ZSBIVE1MIHN0cnVjdHVyZSAobmV3ZXIgWWFob28gbGF5b3V0KVxuICAgIGlmIChpdGVtcy5sZW5ndGggPT09IDApIHtcbiAgICAgIGNvbnN0IHBhdHRlcm4zID0gL2hyZWY9XCJbXlwiXSpcXC9hdWN0aW9uXFwvKFthLXpdXFxkKylcIltePl0qPltcXHNcXFNdKj9jbGFzcz1cIlteXCJdKnRpdGxlW15cIl0qXCJbXj5dKj4oW148XSspPFtcXHNcXFNdKj9jbGFzcz1cIlteXCJdKnByaWNlW15cIl0qXCJbXj5dKj4oW148XSspPC9naTtcbiAgICAgIGxldCBtYXRjaDM7XG4gICAgICB3aGlsZSAoKG1hdGNoMyA9IHBhdHRlcm4zLmV4ZWMoaHRtbCkpICE9PSBudWxsKSB7XG4gICAgICAgIGNvbnN0IFssIGF1Y3Rpb25JZCwgdGl0bGUsIHByaWNlU3RyXSA9IG1hdGNoMztcbiAgICAgICAgY29uc3QgcHJpY2UgPSBwYXJzZUludChwcmljZVN0ci5yZXBsYWNlKC9bXlxcZF0vZywgXCJcIiksIDEwKTtcbiAgICAgICAgaWYgKHByaWNlID4gMCkge1xuICAgICAgICAgIGl0ZW1zLnB1c2goe1xuICAgICAgICAgICAgYXVjdGlvbklkLFxuICAgICAgICAgICAgdGl0bGU6IHNhbml0aXplU3RyaW5nKHRpdGxlKSxcbiAgICAgICAgICAgIGN1cnJlbnRQcmljZTogcHJpY2UsXG4gICAgICAgICAgICBidXlOb3dQcmljZTogbnVsbCxcbiAgICAgICAgICAgIGJpZENvdW50OiAwLFxuICAgICAgICAgICAgZW5kVGltZTogXCJcIixcbiAgICAgICAgICAgIHNlbGxlcklkOiBcIlwiLFxuICAgICAgICAgICAgc2VsbGVyUmF0aW5nOiAwLFxuICAgICAgICAgICAgY29uZGl0aW9uOiBcIlwiLFxuICAgICAgICAgICAgaW1hZ2VVcmxzOiBbXSxcbiAgICAgICAgICAgIGNhdGVnb3J5SWQ6IFwiMjA4NDMwNzM2NVwiLFxuICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gTG9nIHBhcnNpbmcgc3RyYXRlZ3kgdXNlZFxuICAgIGlmIChpdGVtcy5sZW5ndGggPiAwKSB7XG4gICAgICBjb25zb2xlLmxvZyhgW1lhaG9vUGFyc2VyXSBFeHRyYWN0ZWQgJHtpdGVtcy5sZW5ndGh9IGl0ZW1zIGZyb20gSFRNTGApO1xuICAgIH0gZWxzZSB7XG4gICAgICBjb25zb2xlLndhcm4oXCJbWWFob29QYXJzZXJdIE5vIGl0ZW1zIGV4dHJhY3RlZCBmcm9tIEhUTUwgLSBzdHJ1Y3R1cmUgbWF5IGhhdmUgY2hhbmdlZFwiKTtcbiAgICAgIGRhdGFRdWFsaXR5VHJhY2tlci5yZWNvcmREcm9wcGVkKFwieWFob29fanBcIiwgXCJodG1sX3BhcnNlX2ZhaWxlZFwiLCB7XG4gICAgICAgIHJhd0RhdGE6IHsgaHRtbExlbmd0aDogaHRtbC5sZW5ndGgsIHNhbXBsZTogaHRtbC5zbGljZSgwLCA1MDApIH0sXG4gICAgICB9KTtcbiAgICB9XG5cbiAgICByZXR1cm4gaXRlbXM7XG4gIH1cblxuICBhc3luYyBnZXRJdGVtRGV0YWlscyhhdWN0aW9uSWQ6IHN0cmluZyk6IFByb21pc2U8WWFob29BdWN0aW9uSXRlbSB8IG51bGw+IHtcbiAgICBjb25zdCB1cmwgPSBgJHtZQUhPT19BVUNUSU9OU19CQVNFfS9pdGVtLyR7YXVjdGlvbklkfWA7XG4gICAgY29uc3QgaHRtbCA9IGF3YWl0IHRoaXMuZmV0Y2hXaXRoUHJveHkodXJsKTtcblxuICAgIC8vIFBhcnNlIGl0ZW0gZGV0YWlsc1xuICAgIGNvbnN0IHRpdGxlTWF0Y2ggPSBodG1sLm1hdGNoKC88aDFbXj5dKmNsYXNzPVwiW15cIl0qUHJvZHVjdFRpdGxlW15cIl0qXCJbXj5dKj4oW148XSspPFxcL2gxPi8pO1xuICAgIGNvbnN0IHByaWNlTWF0Y2ggPSBodG1sLm1hdGNoKC9kYXRhLXByaWNlPVwiKFxcZCspXCIvKTtcbiAgICBjb25zdCBiaWRNYXRjaCA9IGh0bWwubWF0Y2goL+WFpeacreS7tuaVsFteXFxkXSooXFxkKykvKTtcbiAgICBjb25zdCBzZWxsZXJNYXRjaCA9IGh0bWwubWF0Y2goL2RhdGEtc2VsbGVyLWlkPVwiKFteXCJdKylcIi8pO1xuICAgIGNvbnN0IGNvbmRpdGlvbk1hdGNoID0gaHRtbC5tYXRjaCgv5ZWG5ZOB44Gu54q25oWLW148XSo8W14+XSs+KFtePF0rKTwvKTtcblxuICAgIGlmICghdGl0bGVNYXRjaCB8fCAhcHJpY2VNYXRjaCkgcmV0dXJuIG51bGw7XG5cbiAgICByZXR1cm4ge1xuICAgICAgYXVjdGlvbklkLFxuICAgICAgdGl0bGU6IHNhbml0aXplU3RyaW5nKHRpdGxlTWF0Y2hbMV0pLFxuICAgICAgY3VycmVudFByaWNlOiBwYXJzZUludChwcmljZU1hdGNoWzFdLCAxMCksXG4gICAgICBidXlOb3dQcmljZTogbnVsbCxcbiAgICAgIGJpZENvdW50OiBiaWRNYXRjaCA/IHBhcnNlSW50KGJpZE1hdGNoWzFdLCAxMCkgOiAwLFxuICAgICAgZW5kVGltZTogXCJcIixcbiAgICAgIHNlbGxlcklkOiBzZWxsZXJNYXRjaCA/IHNlbGxlck1hdGNoWzFdIDogXCJcIixcbiAgICAgIHNlbGxlclJhdGluZzogMCxcbiAgICAgIGNvbmRpdGlvbjogY29uZGl0aW9uTWF0Y2ggPyBjb25kaXRpb25NYXRjaFsxXSA6IFwiXCIsXG4gICAgICBpbWFnZVVybHM6IFtdLFxuICAgICAgY2F0ZWdvcnlJZDogXCIyMDg0MzA3MzY1XCIsXG4gICAgfTtcbiAgfVxuXG4gIGFzeW5jIGdldENvbXBsZXRlZFNhbGVzKGtleXdvcmQ6IHN0cmluZyk6IFByb21pc2U8U2FsZXNFdmVudFtdPiB7XG4gICAgLy8gWWFob28gQXVjdGlvbnMgY29tcGxldGVkIGxpc3RpbmdzXG4gICAgY29uc3QgZW5jb2RlZEtleXdvcmQgPSBlbmNvZGVVUklDb21wb25lbnQoa2V5d29yZCk7XG4gICAgY29uc3QgdXJsID0gYCR7WUFIT09fQVVDVElPTlNfQkFTRX0vY2xvc2Vkc2VhcmNoL2Nsb3NlZHNlYXJjaD9wPSR7ZW5jb2RlZEtleXdvcmR9JmF1Y2NhdD0yMDg0MzA3MzY1Jm49NTBgO1xuXG4gICAgY29uc3QgaHRtbCA9IGF3YWl0IHRoaXMuZmV0Y2hXaXRoUHJveHkodXJsKTtcbiAgICBjb25zdCBzYWxlczogU2FsZXNFdmVudFtdID0gW107XG5cbiAgICAvLyBQYXJzZSBjb21wbGV0ZWQgc2FsZXNcbiAgICBjb25zdCBpdGVtUGF0dGVybiA9XG4gICAgICAvZGF0YS1hdWN0aW9uLWlkPVwiKFteXCJdKylcIltcXHNcXFNdKj88YVtePl0rPihbXjxdKyk8XFwvYT5bXFxzXFxTXSo/Y2xhc3M9XCJbXlwiXSpQcmljZVteXCJdKlwiW14+XSo+KFtePF0rKTwvZztcbiAgICBsZXQgbWF0Y2g7XG5cbiAgICBjb25zdCBjb2xsZWN0ZWRBdCA9IG5vd0lzbygpO1xuXG4gICAgd2hpbGUgKChtYXRjaCA9IGl0ZW1QYXR0ZXJuLmV4ZWMoaHRtbCkpICE9PSBudWxsKSB7XG4gICAgICBjb25zdCBbLCBhdWN0aW9uSWQsIHRpdGxlLCBwcmljZVN0cl0gPSBtYXRjaDtcbiAgICAgIGNvbnN0IHByaWNlID0gcGFyc2VJbnQocHJpY2VTdHIucmVwbGFjZSgvW15cXGRdL2csIFwiXCIpLCAxMCk7XG5cbiAgICAgIGNvbnN0IGNhcmRJbmZvID0gdGhpcy5leHRyYWN0Q2FyZEluZm8odGl0bGUpO1xuICAgICAgaWYgKGNhcmRJbmZvICYmIHByaWNlID4gMCkge1xuICAgICAgICBjb25zdCB7IHByaWNlVXNkIH0gPSBub3JtYWxpemVQcmljZShwcmljZSwgXCJKUFlcIik7XG5cbiAgICAgICAgc2FsZXMucHVzaCh7XG4gICAgICAgICAgZXZlbnRUeXBlOiBcInNhbGVcIixcbiAgICAgICAgICBzb3VyY2U6IFwieWFob29fanBcIixcbiAgICAgICAgICBzYWxlSWQ6IGB5YWhvby0ke2F1Y3Rpb25JZH1gLFxuICAgICAgICAgIGNhcmRJZDogbm9ybWFsaXplQ2FyZElkKGNhcmRJbmZvLnNldENvZGUsIGNhcmRJbmZvLmNhcmROdW1iZXIsIGNhcmRJbmZvLnZhcmlhbnRUeXBlKSxcbiAgICAgICAgICBwcmljZSxcbiAgICAgICAgICBjdXJyZW5jeTogXCJKUFlcIixcbiAgICAgICAgICBwcmljZVVzZCxcbiAgICAgICAgICBjb25kaXRpb246IFwiTk1cIiwgLy8gRGVmYXVsdFxuICAgICAgICAgIHF1YW50aXR5OiAxLFxuICAgICAgICAgIHNlbGxlcklkOiB1bmRlZmluZWQsXG4gICAgICAgICAgYnV5ZXJJZDogdW5kZWZpbmVkLFxuICAgICAgICAgIHNhbGVEYXRlOiBjb2xsZWN0ZWRBdCxcbiAgICAgICAgICBjb2xsZWN0ZWRBdCxcbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHNhbGVzO1xuICB9XG5cbiAgcHJpdmF0ZSBleHRyYWN0Q2FyZEluZm8odGl0bGU6IHN0cmluZyk6IHtcbiAgICBzZXRDb2RlOiBzdHJpbmc7XG4gICAgY2FyZE51bWJlcjogc3RyaW5nO1xuICAgIHZhcmlhbnRUeXBlOiBzdHJpbmc7XG4gIH0gfCBudWxsIHtcbiAgICAvLyBNYXRjaCBjYXJkIG51bWJlciBwYXR0ZXJuXG4gICAgY29uc3QgbWF0Y2ggPSB0aXRsZS5tYXRjaCgvKFtBLVpdezIsM31cXGR7Mn0pLShcXGR7M30pL2kpO1xuICAgIGlmICghbWF0Y2gpIHJldHVybiBudWxsO1xuXG4gICAgY29uc3Qgc2V0Q29kZSA9IG1hdGNoWzFdLnRvVXBwZXJDYXNlKCk7XG4gICAgY29uc3QgY2FyZE51bWJlciA9IG1hdGNoWzJdO1xuXG4gICAgLy8gRGV0ZWN0IHZhcmlhbnRcbiAgICBsZXQgdmFyaWFudFR5cGUgPSBcInJlZ3VsYXJcIjtcbiAgICBjb25zdCB0aXRsZUxvd2VyID0gdGl0bGUudG9Mb3dlckNhc2UoKTtcblxuICAgIGlmICh0aXRsZUxvd2VyLmluY2x1ZGVzKFwi44OR44Op44Os44OrXCIpIHx8IHRpdGxlTG93ZXIuaW5jbHVkZXMoXCJwYXJhbGxlbFwiKSkge1xuICAgICAgdmFyaWFudFR5cGUgPSBcInBhcmFsbGVsXCI7XG4gICAgfSBlbHNlIGlmICh0aXRsZUxvd2VyLmluY2x1ZGVzKFwi44Kz44Of44OR44OpXCIpIHx8IHRpdGxlTG93ZXIuaW5jbHVkZXMoXCJtYW5nYVwiKSkge1xuICAgICAgdmFyaWFudFR5cGUgPSBcIm1hbmdhXCI7XG4gICAgfSBlbHNlIGlmICh0aXRsZUxvd2VyLmluY2x1ZGVzKFwic3BcIikgfHwgdGl0bGVMb3dlci5pbmNsdWRlcyhcIuOCueODmuOCt+ODo+ODq1wiKSkge1xuICAgICAgdmFyaWFudFR5cGUgPSBcInNwXCI7XG4gICAgfVxuXG4gICAgcmV0dXJuIHsgc2V0Q29kZSwgY2FyZE51bWJlciwgdmFyaWFudFR5cGUgfTtcbiAgfVxufVxuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gTUVSQ0FSSSBTQ1JBUEVSXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG5jbGFzcyBNZXJjYXJpU2NyYXBlciBleHRlbmRzIEphcGFuU2NyYXBlciB7XG4gIGFzeW5jIHNlYXJjaChrZXl3b3JkOiBzdHJpbmcpOiBQcm9taXNlPE1lcmNhcmlJdGVtW10+IHtcbiAgICAvLyBNZXJjYXJpIHVzZXMgYSBkeW5hbWljIEFQSSwgc28gd2UgbmVlZCB0byBzY3JhcGUgdGhlIHNlYXJjaCBwYWdlXG4gICAgLy8gb3IgcmV2ZXJzZS1lbmdpbmVlciB0aGVpciBBUElcbiAgICBjb25zdCBlbmNvZGVkS2V5d29yZCA9IGVuY29kZVVSSUNvbXBvbmVudChrZXl3b3JkKTtcbiAgICBjb25zdCB1cmwgPSBgJHtNRVJDQVJJX0JBU0V9L3NlYXJjaD9rZXl3b3JkPSR7ZW5jb2RlZEtleXdvcmR9JmNhdGVnb3J5X2lkPTEyOTEmc3RhdHVzPW9uX3NhbGVgO1xuXG4gICAgY29uc3QgaHRtbCA9IGF3YWl0IHRoaXMuZmV0Y2hXaXRoUHJveHkodXJsKTtcbiAgICByZXR1cm4gdGhpcy5wYXJzZVNlYXJjaFJlc3VsdHMoaHRtbCk7XG4gIH1cblxuICBwcml2YXRlIHBhcnNlU2VhcmNoUmVzdWx0cyhodG1sOiBzdHJpbmcpOiBNZXJjYXJpSXRlbVtdIHtcbiAgICBjb25zdCBpdGVtczogTWVyY2FyaUl0ZW1bXSA9IFtdO1xuXG4gICAgLy8gU3RyYXRlZ3kgMTogTmV4dC5qcyBTU1IgZGF0YSAobW9zdCByZWxpYWJsZSlcbiAgICBjb25zdCBkYXRhTWF0Y2ggPSBodG1sLm1hdGNoKC9fX05FWFRfREFUQV9fW14+XSo+KFtePF0rKTxcXC9zY3JpcHQ+Lyk7XG4gICAgaWYgKGRhdGFNYXRjaCkge1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QganNvbkRhdGEgPSBKU09OLnBhcnNlKGRhdGFNYXRjaFsxXSk7XG4gICAgICAgIGNvbnN0IHNlYXJjaFJlc3VsdHMgPSBqc29uRGF0YT8ucHJvcHM/LnBhZ2VQcm9wcz8uc2VhcmNoUmVzdWx0cyB8fFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICBqc29uRGF0YT8ucHJvcHM/LnBhZ2VQcm9wcz8uaXRlbXMgfHxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAganNvbkRhdGE/LnByb3BzPy5pbml0aWFsRGF0YT8uaXRlbXMgfHxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgW107XG5cbiAgICAgICAgZm9yIChjb25zdCBpdGVtIG9mIHNlYXJjaFJlc3VsdHMpIHtcbiAgICAgICAgICBpdGVtcy5wdXNoKHtcbiAgICAgICAgICAgIGl0ZW1JZDogaXRlbS5pZCB8fCBpdGVtLml0ZW1JZCB8fCBcIlwiLFxuICAgICAgICAgICAgdGl0bGU6IGl0ZW0ubmFtZSB8fCBpdGVtLnRpdGxlIHx8IFwiXCIsXG4gICAgICAgICAgICBwcmljZTogaXRlbS5wcmljZSB8fCBwYXJzZUludChpdGVtLnByaWNlU3RyPy5yZXBsYWNlKC9bXlxcZF0vZywgXCJcIiksIDEwKSB8fCAwLFxuICAgICAgICAgICAgc3RhdHVzOiBpdGVtLnN0YXR1cyB8fCBcIm9uX3NhbGVcIixcbiAgICAgICAgICAgIHNlbGxlcklkOiBpdGVtLnNlbGxlcj8uaWQgfHwgaXRlbS5zZWxsZXJJZCB8fCBcIlwiLFxuICAgICAgICAgICAgY29uZGl0aW9uOiBpdGVtLml0ZW1fY29uZGl0aW9uPy5uYW1lIHx8IGl0ZW0uY29uZGl0aW9uIHx8IFwiXCIsXG4gICAgICAgICAgICBpbWFnZVVybHM6IGl0ZW0udGh1bWJuYWlscyB8fCBpdGVtLnBob3RvcyB8fCBbXSxcbiAgICAgICAgICAgIGNyZWF0ZWRBdDogaXRlbS5jcmVhdGVkIHx8IGl0ZW0uY3JlYXRlZEF0IHx8IFwiXCIsXG4gICAgICAgICAgICB1cGRhdGVkQXQ6IGl0ZW0udXBkYXRlZCB8fCBpdGVtLnVwZGF0ZWRBdCB8fCBcIlwiLFxuICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBjb25zb2xlLndhcm4oXCJGYWlsZWQgdG8gcGFyc2UgTWVyY2FyaSBfX05FWFRfREFUQV9fOlwiLCBlcnJvcik7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gU3RyYXRlZ3kgMjogTG9vayBmb3IgUmVhY3QgaHlkcmF0aW9uIGRhdGFcbiAgICBpZiAoaXRlbXMubGVuZ3RoID09PSAwKSB7XG4gICAgICBjb25zdCByZWFjdERhdGFNYXRjaCA9IGh0bWwubWF0Y2goL3dpbmRvd1xcLl9fUFJFTE9BREVEX1NUQVRFX19cXHMqPVxccyooe1tcXHNcXFNdKj99KTs8XFwvc2NyaXB0Pi8pO1xuICAgICAgaWYgKHJlYWN0RGF0YU1hdGNoKSB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgY29uc3QgcHJlbG9hZGVkU3RhdGUgPSBKU09OLnBhcnNlKHJlYWN0RGF0YU1hdGNoWzFdKTtcbiAgICAgICAgICBjb25zdCBzZWFyY2hJdGVtcyA9IHByZWxvYWRlZFN0YXRlPy5zZWFyY2g/Lml0ZW1zIHx8IHByZWxvYWRlZFN0YXRlPy5pdGVtcyB8fCBbXTtcbiAgICAgICAgICBmb3IgKGNvbnN0IGl0ZW0gb2Ygc2VhcmNoSXRlbXMpIHtcbiAgICAgICAgICAgIGl0ZW1zLnB1c2goe1xuICAgICAgICAgICAgICBpdGVtSWQ6IGl0ZW0uaWQgfHwgXCJcIixcbiAgICAgICAgICAgICAgdGl0bGU6IGl0ZW0ubmFtZSB8fCBcIlwiLFxuICAgICAgICAgICAgICBwcmljZTogaXRlbS5wcmljZSB8fCAwLFxuICAgICAgICAgICAgICBzdGF0dXM6IGl0ZW0uc3RhdHVzIHx8IFwib25fc2FsZVwiLFxuICAgICAgICAgICAgICBzZWxsZXJJZDogaXRlbS5zZWxsZXJJZCB8fCBcIlwiLFxuICAgICAgICAgICAgICBjb25kaXRpb246IGl0ZW0uY29uZGl0aW9uIHx8IFwiXCIsXG4gICAgICAgICAgICAgIGltYWdlVXJsczogaXRlbS5waG90b3MgfHwgW10sXG4gICAgICAgICAgICAgIGNyZWF0ZWRBdDogaXRlbS5jcmVhdGVkIHx8IFwiXCIsXG4gICAgICAgICAgICAgIHVwZGF0ZWRBdDogaXRlbS51cGRhdGVkIHx8IFwiXCIsXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICB9XG4gICAgICAgIH0gY2F0Y2gge1xuICAgICAgICAgIC8vIENvbnRpbnVlIHRvIG5leHQgc3RyYXRlZ3lcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIC8vIFN0cmF0ZWd5IDM6IEhUTUwgcGFyc2luZyBmYWxsYmFja1xuICAgIGlmIChpdGVtcy5sZW5ndGggPT09IDApIHtcbiAgICAgIGNvbnN0IGl0ZW1QYXR0ZXJuID0gL2RhdGEtaXRlbS1pZD1cIihbXlwiXSspXCJbXFxzXFxTXSo/ZGF0YS1pdGVtLW5hbWU9XCIoW15cIl0qKVwiW1xcc1xcU10qP2RhdGEtaXRlbS1wcmljZT1cIihcXGQrKVwiL2c7XG4gICAgICBsZXQgbWF0Y2g7XG4gICAgICB3aGlsZSAoKG1hdGNoID0gaXRlbVBhdHRlcm4uZXhlYyhodG1sKSkgIT09IG51bGwpIHtcbiAgICAgICAgY29uc3QgWywgaXRlbUlkLCB0aXRsZSwgcHJpY2VdID0gbWF0Y2g7XG4gICAgICAgIGl0ZW1zLnB1c2goe1xuICAgICAgICAgIGl0ZW1JZCxcbiAgICAgICAgICB0aXRsZTogc2FuaXRpemVTdHJpbmcodGl0bGUpLFxuICAgICAgICAgIHByaWNlOiBwYXJzZUludChwcmljZSwgMTApLFxuICAgICAgICAgIHN0YXR1czogXCJvbl9zYWxlXCIsXG4gICAgICAgICAgc2VsbGVySWQ6IFwiXCIsXG4gICAgICAgICAgY29uZGl0aW9uOiBcIlwiLFxuICAgICAgICAgIGltYWdlVXJsczogW10sXG4gICAgICAgICAgY3JlYXRlZEF0OiBcIlwiLFxuICAgICAgICAgIHVwZGF0ZWRBdDogXCJcIixcbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gTG9nIHBhcnNpbmcgcmVzdWx0c1xuICAgIGlmIChpdGVtcy5sZW5ndGggPiAwKSB7XG4gICAgICBjb25zb2xlLmxvZyhgW01lcmNhcmlQYXJzZXJdIEV4dHJhY3RlZCAke2l0ZW1zLmxlbmd0aH0gaXRlbXMgZnJvbSByZXNwb25zZWApO1xuICAgIH0gZWxzZSB7XG4gICAgICBjb25zb2xlLndhcm4oXCJbTWVyY2FyaVBhcnNlcl0gTm8gaXRlbXMgZXh0cmFjdGVkIC0gcGFnZSBzdHJ1Y3R1cmUgbWF5IGhhdmUgY2hhbmdlZFwiKTtcbiAgICAgIGRhdGFRdWFsaXR5VHJhY2tlci5yZWNvcmREcm9wcGVkKFwibWVyY2FyaV9qcFwiLCBcImh0bWxfcGFyc2VfZmFpbGVkXCIsIHtcbiAgICAgICAgcmF3RGF0YTogeyBodG1sTGVuZ3RoOiBodG1sLmxlbmd0aCwgc2FtcGxlOiBodG1sLnNsaWNlKDAsIDUwMCkgfSxcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIHJldHVybiBpdGVtcztcbiAgfVxuXG4gIGFzeW5jIGdldFNvbGRJdGVtcyhrZXl3b3JkOiBzdHJpbmcpOiBQcm9taXNlPFNhbGVzRXZlbnRbXT4ge1xuICAgIGNvbnN0IGVuY29kZWRLZXl3b3JkID0gZW5jb2RlVVJJQ29tcG9uZW50KGtleXdvcmQpO1xuICAgIGNvbnN0IHVybCA9IGAke01FUkNBUklfQkFTRX0vc2VhcmNoP2tleXdvcmQ9JHtlbmNvZGVkS2V5d29yZH0mY2F0ZWdvcnlfaWQ9MTI5MSZzdGF0dXM9c29sZF9vdXRgO1xuXG4gICAgY29uc3QgaHRtbCA9IGF3YWl0IHRoaXMuZmV0Y2hXaXRoUHJveHkodXJsKTtcbiAgICBjb25zdCBpdGVtcyA9IHRoaXMucGFyc2VTZWFyY2hSZXN1bHRzKGh0bWwpO1xuICAgIGNvbnN0IGNvbGxlY3RlZEF0ID0gbm93SXNvKCk7XG5cbiAgICBjb25zdCBzYWxlczogU2FsZXNFdmVudFtdID0gW107XG5cbiAgICBmb3IgKGNvbnN0IGl0ZW0gb2YgaXRlbXMpIHtcbiAgICAgIGNvbnN0IGNhcmRJbmZvID0gdGhpcy5leHRyYWN0Q2FyZEluZm8oaXRlbS50aXRsZSk7XG4gICAgICBpZiAoY2FyZEluZm8gJiYgaXRlbS5wcmljZSA+IDApIHtcbiAgICAgICAgY29uc3QgeyBwcmljZVVzZCB9ID0gbm9ybWFsaXplUHJpY2UoaXRlbS5wcmljZSwgXCJKUFlcIik7XG5cbiAgICAgICAgc2FsZXMucHVzaCh7XG4gICAgICAgICAgZXZlbnRUeXBlOiBcInNhbGVcIixcbiAgICAgICAgICBzb3VyY2U6IFwibWVyY2FyaV9qcFwiLFxuICAgICAgICAgIHNhbGVJZDogYG1lcmNhcmktJHtpdGVtLml0ZW1JZH1gLFxuICAgICAgICAgIGNhcmRJZDogbm9ybWFsaXplQ2FyZElkKGNhcmRJbmZvLnNldENvZGUsIGNhcmRJbmZvLmNhcmROdW1iZXIsIGNhcmRJbmZvLnZhcmlhbnRUeXBlKSxcbiAgICAgICAgICBwcmljZTogaXRlbS5wcmljZSxcbiAgICAgICAgICBjdXJyZW5jeTogXCJKUFlcIixcbiAgICAgICAgICBwcmljZVVzZCxcbiAgICAgICAgICBjb25kaXRpb246IHRoaXMubm9ybWFsaXplQ29uZGl0aW9uKGl0ZW0uY29uZGl0aW9uKSxcbiAgICAgICAgICBxdWFudGl0eTogMSxcbiAgICAgICAgICBzZWxsZXJJZDogaXRlbS5zZWxsZXJJZCxcbiAgICAgICAgICBidXllcklkOiB1bmRlZmluZWQsXG4gICAgICAgICAgc2FsZURhdGU6IGl0ZW0udXBkYXRlZEF0IHx8IGNvbGxlY3RlZEF0LFxuICAgICAgICAgIGNvbGxlY3RlZEF0LFxuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gc2FsZXM7XG4gIH1cblxuICBwcml2YXRlIGV4dHJhY3RDYXJkSW5mbyh0aXRsZTogc3RyaW5nKToge1xuICAgIHNldENvZGU6IHN0cmluZztcbiAgICBjYXJkTnVtYmVyOiBzdHJpbmc7XG4gICAgdmFyaWFudFR5cGU6IHN0cmluZztcbiAgfSB8IG51bGwge1xuICAgIGNvbnN0IG1hdGNoID0gdGl0bGUubWF0Y2goLyhbQS1aXXsyLDN9XFxkezJ9KS0oXFxkezN9KS9pKTtcbiAgICBpZiAoIW1hdGNoKSByZXR1cm4gbnVsbDtcblxuICAgIGNvbnN0IHNldENvZGUgPSBtYXRjaFsxXS50b1VwcGVyQ2FzZSgpO1xuICAgIGNvbnN0IGNhcmROdW1iZXIgPSBtYXRjaFsyXTtcblxuICAgIGxldCB2YXJpYW50VHlwZSA9IFwicmVndWxhclwiO1xuICAgIGNvbnN0IHRpdGxlTG93ZXIgPSB0aXRsZS50b0xvd2VyQ2FzZSgpO1xuXG4gICAgaWYgKHRpdGxlTG93ZXIuaW5jbHVkZXMoXCLjg5Hjg6njg6zjg6tcIikgfHwgdGl0bGVMb3dlci5pbmNsdWRlcyhcInBhcmFsbGVsXCIpKSB7XG4gICAgICB2YXJpYW50VHlwZSA9IFwicGFyYWxsZWxcIjtcbiAgICB9IGVsc2UgaWYgKHRpdGxlTG93ZXIuaW5jbHVkZXMoXCLjgrPjg5/jg5Hjg6lcIikpIHtcbiAgICAgIHZhcmlhbnRUeXBlID0gXCJtYW5nYVwiO1xuICAgIH0gZWxzZSBpZiAodGl0bGVMb3dlci5pbmNsdWRlcyhcIuOCueODmuOCt+ODo+ODq1wiKSB8fCB0aXRsZUxvd2VyLmluY2x1ZGVzKFwic3BcIikpIHtcbiAgICAgIHZhcmlhbnRUeXBlID0gXCJzcFwiO1xuICAgIH1cblxuICAgIHJldHVybiB7IHNldENvZGUsIGNhcmROdW1iZXIsIHZhcmlhbnRUeXBlIH07XG4gIH1cblxuICBwcml2YXRlIG5vcm1hbGl6ZUNvbmRpdGlvbihjb25kaXRpb246IHN0cmluZyk6IHN0cmluZyB7XG4gICAgY29uc3QgY29uZGl0aW9uTWFwOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0ge1xuICAgICAg5paw5ZOB5pyq5L2/55SoOiBcIk5NXCIsXG4gICAgICDmnKrkvb/nlKjjgavov5HjgYQ6IFwiTk1cIixcbiAgICAgIOebrueri+OBo+OBn+WCt+OChOaxmuOCjOOBquOBlzogXCJMUFwiLFxuICAgICAg44KE44KE5YK344KE5rGa44KM44GC44KKOiBcIk1QXCIsXG4gICAgICDlgrfjgoTmsZrjgozjgYLjgoo6IFwiSFBcIixcbiAgICAgIOWFqOS9k+eahOOBq+eKtuaFi+OBjOaCquOBhDogXCJETUdcIixcbiAgICB9O1xuICAgIHJldHVybiBjb25kaXRpb25NYXBbY29uZGl0aW9uXSB8fCBcIk5NXCI7XG4gIH1cbn1cblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIERBVEEgUFJPQ0VTU0lOR1xuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuaW50ZXJmYWNlIEV4dGVuZGVkUHJpY2VFdmVudCBleHRlbmRzIFByaWNlRXZlbnQge1xuICBzZWxsZXJSZXB1dGF0aW9uVGllcj86IHN0cmluZztcbiAgc2VsbGVyV2VpZ2h0RmFjdG9yPzogbnVtYmVyO1xuICBmdXp6eU1hdGNoZWQ/OiBib29sZWFuO1xuICBtYXRjaENvbmZpZGVuY2U/OiBzdHJpbmc7XG4gIGNvbmRpdGlvbktub3duPzogYm9vbGVhbjtcbn1cblxuZnVuY3Rpb24gY3JlYXRlUHJpY2VFdmVudEZyb21ZYWhvbyhcbiAgaXRlbTogWWFob29BdWN0aW9uSXRlbSxcbiAgY29sbGVjdGVkQXQ6IHN0cmluZ1xuKTogRXh0ZW5kZWRQcmljZUV2ZW50IHwgbnVsbCB7XG4gIGNvbnN0IHNvdXJjZSA9IFwieWFob29fanBcIjtcblxuICAvLyBUcnkgc3RhbmRhcmQgcGF0dGVybiBmaXJzdFxuICBjb25zdCBjYXJkTWF0Y2ggPSBpdGVtLnRpdGxlLm1hdGNoKC8oW0EtWl17MiwzfVxcZHsyfSktKFxcZHszfSkvaSk7XG4gIGxldCBzZXRDb2RlOiBzdHJpbmc7XG4gIGxldCBjYXJkTnVtYmVyOiBzdHJpbmc7XG4gIGxldCBmdXp6eU1hdGNoZWQgPSBmYWxzZTtcbiAgbGV0IGNvbmZpZGVuY2U6IFwiaGlnaFwiIHwgXCJtZWRpdW1cIiB8IFwibG93XCIgPSBcImhpZ2hcIjtcblxuICBpZiAoY2FyZE1hdGNoKSB7XG4gICAgc2V0Q29kZSA9IGNhcmRNYXRjaFsxXS50b1VwcGVyQ2FzZSgpO1xuICAgIGNhcmROdW1iZXIgPSBjYXJkTWF0Y2hbMl07XG4gIH0gZWxzZSB7XG4gICAgLy8gVHJ5IGZ1enp5IG1hdGNoaW5nXG4gICAgY29uc3QgZnV6enlSZXN1bHQgPSBmdXp6eU1hdGNoQ2FyZChpdGVtLnRpdGxlKTtcbiAgICBpZiAoZnV6enlSZXN1bHQpIHtcbiAgICAgIHNldENvZGUgPSBmdXp6eVJlc3VsdC5zZXRDb2RlO1xuICAgICAgY2FyZE51bWJlciA9IGZ1enp5UmVzdWx0LmNhcmROdW1iZXI7XG4gICAgICBmdXp6eU1hdGNoZWQgPSB0cnVlO1xuICAgICAgY29uZmlkZW5jZSA9IGZ1enp5UmVzdWx0LmNvbmZpZGVuY2U7XG4gICAgfSBlbHNlIHtcbiAgICAgIGRhdGFRdWFsaXR5VHJhY2tlci5yZWNvcmREcm9wcGVkKHNvdXJjZSwgXCJub19jYXJkX2lkX3BhdHRlcm5cIiwgeyB0aXRsZTogaXRlbS50aXRsZSB9KTtcbiAgICAgIHJldHVybiBudWxsO1xuICAgIH1cbiAgfVxuXG4gIC8vIFVzZSBzdGFuZGFyZGl6ZWQgdmFyaWFudCBkZXRlY3Rpb25cbiAgY29uc3QgdmFyaWFudFR5cGUgPSBkZXRlY3RWYXJpYW50VHlwZShpdGVtLnRpdGxlKTtcblxuICBjb25zdCBjYXJkSWQgPSBub3JtYWxpemVDYXJkSWQoc2V0Q29kZSwgY2FyZE51bWJlciwgdmFyaWFudFR5cGUpO1xuICBjb25zdCBwcmljZSA9IGl0ZW0uYnV5Tm93UHJpY2UgfHwgaXRlbS5jdXJyZW50UHJpY2U7XG5cbiAgaWYgKHByaWNlIDw9IDApIHtcbiAgICBkYXRhUXVhbGl0eVRyYWNrZXIucmVjb3JkRHJvcHBlZChzb3VyY2UsIFwiaW52YWxpZF9wcmljZVwiLCB7XG4gICAgICB0aXRsZTogaXRlbS50aXRsZSxcbiAgICAgIHJhd0RhdGE6IHsgcHJpY2UgfSxcbiAgICB9KTtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIGNvbnN0IHsgcHJpY2VVc2QsIHByaWNlR2JwIH0gPSBub3JtYWxpemVQcmljZShwcmljZSwgXCJKUFlcIik7XG5cbiAgLy8gSGFuZGxlIHVua25vd24gY29uZGl0aW9uIHByb3Blcmx5IC0gZG9uJ3QgYXNzdW1lIE5NXG4gIGNvbnN0IGNvbmRpdGlvblJlc3VsdCA9IG5vcm1hbGl6ZUNvbmRpdGlvbldpdGhUcmFja2luZyhpdGVtLmNvbmRpdGlvbiB8fCBcIlwiKTtcbiAgY29uc3QgY29uZGl0aW9uID0gY29uZGl0aW9uUmVzdWx0LmlzS25vd24gPyBjb25kaXRpb25SZXN1bHQuY29uZGl0aW9uIDogXCJVTktOT1dOXCI7XG5cbiAgLy8gQ2FsY3VsYXRlIHNlbGxlciByZXB1dGF0aW9uIGlmIGF2YWlsYWJsZVxuICBjb25zdCBzZWxsZXJSZXBUaWVyID0gY2FsY3VsYXRlU2VsbGVyUmVwdXRhdGlvbih1bmRlZmluZWQsIGl0ZW0uc2VsbGVyUmF0aW5nKTtcbiAgY29uc3Qgd2VpZ2h0RmFjdG9yID0gZ2V0U2VsbGVyV2VpZ2h0RmFjdG9yKHNlbGxlclJlcFRpZXIpO1xuXG4gIC8vIFRyYWNrIHN1Y2Nlc3NcbiAgZGF0YVF1YWxpdHlUcmFja2VyLnJlY29yZFN1Y2Nlc3Moc291cmNlLCB7XG4gICAgZnV6enlNYXRjaGVkLFxuICAgIHVua25vd25Db25kaXRpb246ICFjb25kaXRpb25SZXN1bHQuaXNLbm93bixcbiAgfSk7XG5cbiAgcmV0dXJuIHtcbiAgICBldmVudFR5cGU6IFwicHJpY2VcIixcbiAgICBzb3VyY2UsXG4gICAgY2FyZElkLFxuICAgIGV4dGVybmFsSWQ6IGl0ZW0uYXVjdGlvbklkLFxuICAgIG5hbWU6IGl0ZW0udGl0bGUsXG4gICAgc2V0Q29kZSxcbiAgICBjYXJkTnVtYmVyLFxuICAgIHZhcmlhbnRUeXBlLFxuICAgIGNvbmRpdGlvbixcbiAgICBsYW5ndWFnZTogXCJKUFwiLFxuICAgIHByaWNlLFxuICAgIGN1cnJlbmN5OiBcIkpQWVwiLFxuICAgIHByaWNlVXNkLFxuICAgIHByaWNlR2JwLFxuICAgIGxpc3RpbmdzQ291bnQ6IDEsXG4gICAgc2VsbGVySWQ6IGl0ZW0uc2VsbGVySWQsXG4gICAgdGltZXN0YW1wOiBjb2xsZWN0ZWRBdCxcbiAgICBjb2xsZWN0ZWRBdCxcbiAgICAvLyBFeHRlbmRlZCBmaWVsZHNcbiAgICBzZWxsZXJSZXB1dGF0aW9uVGllcjogc2VsbGVyUmVwVGllcixcbiAgICBzZWxsZXJXZWlnaHRGYWN0b3I6IHdlaWdodEZhY3RvcixcbiAgICBmdXp6eU1hdGNoZWQsXG4gICAgbWF0Y2hDb25maWRlbmNlOiBjb25maWRlbmNlLFxuICAgIGNvbmRpdGlvbktub3duOiBjb25kaXRpb25SZXN1bHQuaXNLbm93bixcbiAgfTtcbn1cblxuZnVuY3Rpb24gY3JlYXRlUHJpY2VFdmVudEZyb21NZXJjYXJpKFxuICBpdGVtOiBNZXJjYXJpSXRlbSxcbiAgY29sbGVjdGVkQXQ6IHN0cmluZ1xuKTogRXh0ZW5kZWRQcmljZUV2ZW50IHwgbnVsbCB7XG4gIGNvbnN0IHNvdXJjZSA9IFwibWVyY2FyaV9qcFwiO1xuXG4gIC8vIFRyeSBzdGFuZGFyZCBwYXR0ZXJuIGZpcnN0XG4gIGNvbnN0IGNhcmRNYXRjaCA9IGl0ZW0udGl0bGUubWF0Y2goLyhbQS1aXXsyLDN9XFxkezJ9KS0oXFxkezN9KS9pKTtcbiAgbGV0IHNldENvZGU6IHN0cmluZztcbiAgbGV0IGNhcmROdW1iZXI6IHN0cmluZztcbiAgbGV0IGZ1enp5TWF0Y2hlZCA9IGZhbHNlO1xuICBsZXQgY29uZmlkZW5jZTogXCJoaWdoXCIgfCBcIm1lZGl1bVwiIHwgXCJsb3dcIiA9IFwiaGlnaFwiO1xuXG4gIGlmIChjYXJkTWF0Y2gpIHtcbiAgICBzZXRDb2RlID0gY2FyZE1hdGNoWzFdLnRvVXBwZXJDYXNlKCk7XG4gICAgY2FyZE51bWJlciA9IGNhcmRNYXRjaFsyXTtcbiAgfSBlbHNlIHtcbiAgICAvLyBUcnkgZnV6enkgbWF0Y2hpbmdcbiAgICBjb25zdCBmdXp6eVJlc3VsdCA9IGZ1enp5TWF0Y2hDYXJkKGl0ZW0udGl0bGUpO1xuICAgIGlmIChmdXp6eVJlc3VsdCkge1xuICAgICAgc2V0Q29kZSA9IGZ1enp5UmVzdWx0LnNldENvZGU7XG4gICAgICBjYXJkTnVtYmVyID0gZnV6enlSZXN1bHQuY2FyZE51bWJlcjtcbiAgICAgIGZ1enp5TWF0Y2hlZCA9IHRydWU7XG4gICAgICBjb25maWRlbmNlID0gZnV6enlSZXN1bHQuY29uZmlkZW5jZTtcbiAgICB9IGVsc2Uge1xuICAgICAgZGF0YVF1YWxpdHlUcmFja2VyLnJlY29yZERyb3BwZWQoc291cmNlLCBcIm5vX2NhcmRfaWRfcGF0dGVyblwiLCB7IHRpdGxlOiBpdGVtLnRpdGxlIH0pO1xuICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuICB9XG5cbiAgLy8gVXNlIHN0YW5kYXJkaXplZCB2YXJpYW50IGRldGVjdGlvblxuICBjb25zdCB2YXJpYW50VHlwZSA9IGRldGVjdFZhcmlhbnRUeXBlKGl0ZW0udGl0bGUpO1xuXG4gIGNvbnN0IGNhcmRJZCA9IG5vcm1hbGl6ZUNhcmRJZChzZXRDb2RlLCBjYXJkTnVtYmVyLCB2YXJpYW50VHlwZSk7XG5cbiAgaWYgKGl0ZW0ucHJpY2UgPD0gMCkge1xuICAgIGRhdGFRdWFsaXR5VHJhY2tlci5yZWNvcmREcm9wcGVkKHNvdXJjZSwgXCJpbnZhbGlkX3ByaWNlXCIsIHtcbiAgICAgIHRpdGxlOiBpdGVtLnRpdGxlLFxuICAgICAgcmF3RGF0YTogeyBwcmljZTogaXRlbS5wcmljZSB9LFxuICAgIH0pO1xuICAgIHJldHVybiBudWxsO1xuICB9XG5cbiAgY29uc3QgeyBwcmljZVVzZCwgcHJpY2VHYnAgfSA9IG5vcm1hbGl6ZVByaWNlKGl0ZW0ucHJpY2UsIFwiSlBZXCIpO1xuXG4gIC8vIFVzZSB1bmlmaWVkIGNvbmRpdGlvbiB0cmFja2luZ1xuICBjb25zdCBjb25kaXRpb25SZXN1bHQgPSBub3JtYWxpemVDb25kaXRpb25XaXRoVHJhY2tpbmcoaXRlbS5jb25kaXRpb24gfHwgXCJcIik7XG4gIGNvbnN0IGNvbmRpdGlvbiA9IGNvbmRpdGlvblJlc3VsdC5pc0tub3duID8gY29uZGl0aW9uUmVzdWx0LmNvbmRpdGlvbiA6IFwiVU5LTk9XTlwiO1xuXG4gIC8vIFRyYWNrIHN1Y2Nlc3NcbiAgZGF0YVF1YWxpdHlUcmFja2VyLnJlY29yZFN1Y2Nlc3Moc291cmNlLCB7XG4gICAgZnV6enlNYXRjaGVkLFxuICAgIHVua25vd25Db25kaXRpb246ICFjb25kaXRpb25SZXN1bHQuaXNLbm93bixcbiAgfSk7XG5cbiAgcmV0dXJuIHtcbiAgICBldmVudFR5cGU6IFwicHJpY2VcIixcbiAgICBzb3VyY2UsXG4gICAgY2FyZElkLFxuICAgIGV4dGVybmFsSWQ6IGl0ZW0uaXRlbUlkLFxuICAgIG5hbWU6IGl0ZW0udGl0bGUsXG4gICAgc2V0Q29kZSxcbiAgICBjYXJkTnVtYmVyLFxuICAgIHZhcmlhbnRUeXBlLFxuICAgIGNvbmRpdGlvbixcbiAgICBsYW5ndWFnZTogXCJKUFwiLFxuICAgIHByaWNlOiBpdGVtLnByaWNlLFxuICAgIGN1cnJlbmN5OiBcIkpQWVwiLFxuICAgIHByaWNlVXNkLFxuICAgIHByaWNlR2JwLFxuICAgIGxpc3RpbmdzQ291bnQ6IDEsXG4gICAgc2VsbGVySWQ6IGl0ZW0uc2VsbGVySWQsXG4gICAgdGltZXN0YW1wOiBjb2xsZWN0ZWRBdCxcbiAgICBjb2xsZWN0ZWRBdCxcbiAgICAvLyBFeHRlbmRlZCBmaWVsZHNcbiAgICBmdXp6eU1hdGNoZWQsXG4gICAgbWF0Y2hDb25maWRlbmNlOiBjb25maWRlbmNlLFxuICAgIGNvbmRpdGlvbktub3duOiBjb25kaXRpb25SZXN1bHQuaXNLbm93bixcbiAgfTtcbn1cblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIE1BSU4gSEFORExFUlxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuZXhwb3J0IGNvbnN0IGhhbmRsZXI6IEhhbmRsZXI8U2NoZWR1bGVkRXZlbnQ+ID0gYXN5bmMgKGV2ZW50KSA9PiB7XG4gIGNvbnNvbGUubG9nKFwiSmFwYW4gY29sbGVjdG9yIHN0YXJ0ZWRcIiwgeyBldmVudCB9KTtcbiAgY29uc3QgY29sbGVjdGVkQXQgPSBub3dJc28oKTtcblxuICAvLyBSZXNldCBkYXRhIHF1YWxpdHkgdHJhY2tlciBmb3IgdGhpcyBydW5cbiAgZGF0YVF1YWxpdHlUcmFja2VyLnJlc2V0KCk7XG5cbiAgdHJ5IHtcbiAgICAvLyBGZXRjaCBsaXZlIEZYIHJhdGVzIGJlZm9yZSBwcm9jZXNzaW5nIChpbXBvcnRhbnQgZm9yIEpQWSBjb252ZXJzaW9uKVxuICAgIGF3YWl0IGZldGNoTGl2ZUZ4UmF0ZXMoKTtcblxuICAgIC8vIEdldCBwcm94eSBjcmVkZW50aWFsc1xuICAgIGNvbnN0IHNlY3JldHMgPSBhd2FpdCBnZXRTZWNyZXRzKCk7XG4gICAgaWYgKCFzZWNyZXRzLnByb3h5X3VzZXJuYW1lIHx8ICFzZWNyZXRzLnByb3h5X3Bhc3N3b3JkKSB7XG4gICAgICBjb25zb2xlLndhcm4oXCJQcm94eSBjcmVkZW50aWFscyBub3QgY29uZmlndXJlZCwgdXNpbmcgZGlyZWN0IGNvbm5lY3Rpb25cIik7XG4gICAgfVxuXG4gICAgY29uc3QgcHJveHlSb3RhdG9yID0gbmV3IFByb3h5Um90YXRvcihcbiAgICAgIHNlY3JldHMucHJveHlfdXNlcm5hbWUgfHwgXCJcIixcbiAgICAgIHNlY3JldHMucHJveHlfcGFzc3dvcmQgfHwgXCJcIlxuICAgICk7XG5cbiAgICBjb25zdCB5YWhvb1NjcmFwZXIgPSBuZXcgWWFob29BdWN0aW9uc1NjcmFwZXIocHJveHlSb3RhdG9yKTtcbiAgICBjb25zdCBtZXJjYXJpU2NyYXBlciA9IG5ldyBNZXJjYXJpU2NyYXBlcihwcm94eVJvdGF0b3IpO1xuXG4gICAgY29uc3QgYWxsUHJpY2VFdmVudHM6IEV4dGVuZGVkUHJpY2VFdmVudFtdID0gW107XG4gICAgY29uc3QgYWxsU2FsZXNFdmVudHM6IFNhbGVzRXZlbnRbXSA9IFtdO1xuXG4gICAgLy8gUHJvY2VzcyBlYWNoIGtleXdvcmRcbiAgICBmb3IgKGNvbnN0IGtleXdvcmQgb2YgU0VBUkNIX0tFWVdPUkRTKSB7XG4gICAgICBjb25zb2xlLmxvZyhgU2VhcmNoaW5nIGZvcjogJHtrZXl3b3JkfWApO1xuXG4gICAgICB0cnkge1xuICAgICAgICAvLyBZYWhvbyBBdWN0aW9uc1xuICAgICAgICBjb25zb2xlLmxvZyhcIiAgU2VhcmNoaW5nIFlhaG9vIEF1Y3Rpb25zLi4uXCIpO1xuICAgICAgICBjb25zdCB5YWhvb0l0ZW1zID0gYXdhaXQgeWFob29TY3JhcGVyLnNlYXJjaChrZXl3b3JkKTtcbiAgICAgICAgY29uc29sZS5sb2coYCAgRm91bmQgJHt5YWhvb0l0ZW1zLmxlbmd0aH0gWWFob28gaXRlbXNgKTtcblxuICAgICAgICBmb3IgKGNvbnN0IGl0ZW0gb2YgeWFob29JdGVtcykge1xuICAgICAgICAgIGNvbnN0IHByaWNlRXZlbnQgPSBjcmVhdGVQcmljZUV2ZW50RnJvbVlhaG9vKGl0ZW0sIGNvbGxlY3RlZEF0KTtcbiAgICAgICAgICBpZiAocHJpY2VFdmVudCkge1xuICAgICAgICAgICAgYWxsUHJpY2VFdmVudHMucHVzaChwcmljZUV2ZW50KTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICAvLyBHZXQgY29tcGxldGVkIFlhaG9vIHNhbGVzXG4gICAgICAgIGNvbnN0IHlhaG9vU2FsZXMgPSBhd2FpdCB5YWhvb1NjcmFwZXIuZ2V0Q29tcGxldGVkU2FsZXMoa2V5d29yZCk7XG4gICAgICAgIGFsbFNhbGVzRXZlbnRzLnB1c2goLi4ueWFob29TYWxlcyk7XG5cbiAgICAgICAgLy8gQWRkIGRlbGF5IGJldHdlZW4gc291cmNlc1xuICAgICAgICBhd2FpdCBzbGVlcCgyMDAwKTtcblxuICAgICAgICAvLyBNZXJjYXJpXG4gICAgICAgIGNvbnNvbGUubG9nKFwiICBTZWFyY2hpbmcgTWVyY2FyaS4uLlwiKTtcbiAgICAgICAgY29uc3QgbWVyY2FyaUl0ZW1zID0gYXdhaXQgbWVyY2FyaVNjcmFwZXIuc2VhcmNoKGtleXdvcmQpO1xuICAgICAgICBjb25zb2xlLmxvZyhgICBGb3VuZCAke21lcmNhcmlJdGVtcy5sZW5ndGh9IE1lcmNhcmkgaXRlbXNgKTtcblxuICAgICAgICBmb3IgKGNvbnN0IGl0ZW0gb2YgbWVyY2FyaUl0ZW1zKSB7XG4gICAgICAgICAgaWYgKGl0ZW0uc3RhdHVzID09PSBcIm9uX3NhbGVcIikge1xuICAgICAgICAgICAgY29uc3QgcHJpY2VFdmVudCA9IGNyZWF0ZVByaWNlRXZlbnRGcm9tTWVyY2FyaShpdGVtLCBjb2xsZWN0ZWRBdCk7XG4gICAgICAgICAgICBpZiAocHJpY2VFdmVudCkge1xuICAgICAgICAgICAgICBhbGxQcmljZUV2ZW50cy5wdXNoKHByaWNlRXZlbnQpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIC8vIEdldCBzb2xkIE1lcmNhcmkgaXRlbXNcbiAgICAgICAgY29uc3QgbWVyY2FyaVNhbGVzID0gYXdhaXQgbWVyY2FyaVNjcmFwZXIuZ2V0U29sZEl0ZW1zKGtleXdvcmQpO1xuICAgICAgICBhbGxTYWxlc0V2ZW50cy5wdXNoKC4uLm1lcmNhcmlTYWxlcyk7XG5cbiAgICAgICAgLy8gQWRkIGRlbGF5IGJldHdlZW4ga2V5d29yZHNcbiAgICAgICAgYXdhaXQgc2xlZXAoMzAwMCk7XG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBjb25zb2xlLndhcm4oYEZhaWxlZCB0byBwcm9jZXNzIGtleXdvcmQgXCIke2tleXdvcmR9XCI6YCwgZXJyb3IpO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIERlZHVwbGljYXRlXG4gICAgY29uc3QgdW5pcXVlUHJpY2VzID0gbmV3IE1hcDxzdHJpbmcsIFByaWNlRXZlbnQ+KCk7XG4gICAgZm9yIChjb25zdCBldmVudCBvZiBhbGxQcmljZUV2ZW50cykge1xuICAgICAgY29uc3Qga2V5ID0gYCR7ZXZlbnQuY2FyZElkfS0ke2V2ZW50LmNvbmRpdGlvbn0tJHtldmVudC5zb3VyY2V9YDtcbiAgICAgIGNvbnN0IGV4aXN0aW5nID0gdW5pcXVlUHJpY2VzLmdldChrZXkpO1xuICAgICAgaWYgKCFleGlzdGluZyB8fCBldmVudC5wcmljZVVzZCA8IGV4aXN0aW5nLnByaWNlVXNkKSB7XG4gICAgICAgIHVuaXF1ZVByaWNlcy5zZXQoa2V5LCBldmVudCk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgY29uc3QgZmluYWxQcmljZUV2ZW50cyA9IEFycmF5LmZyb20odW5pcXVlUHJpY2VzLnZhbHVlcygpKTtcblxuICAgIGNvbnNvbGUubG9nKGBDb2xsZWN0ZWQgJHtmaW5hbFByaWNlRXZlbnRzLmxlbmd0aH0gdW5pcXVlIHByaWNlIGV2ZW50c2ApO1xuICAgIGNvbnNvbGUubG9nKGBDb2xsZWN0ZWQgJHthbGxTYWxlc0V2ZW50cy5sZW5ndGh9IHNhbGVzIGV2ZW50c2ApO1xuXG4gICAgLy8gU2VuZCB0byBLaW5lc2lzXG4gICAgaWYgKGZpbmFsUHJpY2VFdmVudHMubGVuZ3RoID4gMCkge1xuICAgICAgYXdhaXQgcHV0VG9LaW5lc2lzKFBSSUNFX1NUUkVBTSwgZmluYWxQcmljZUV2ZW50cyk7XG4gICAgfVxuXG4gICAgaWYgKGFsbFNhbGVzRXZlbnRzLmxlbmd0aCA+IDApIHtcbiAgICAgIGF3YWl0IHB1dFRvS2luZXNpcyhTQUxFU19TVFJFQU0sIGFsbFNhbGVzRXZlbnRzKTtcbiAgICB9XG5cbiAgICAvLyBVcGRhdGUgRHluYW1vREJcbiAgICBpZiAoZmluYWxQcmljZUV2ZW50cy5sZW5ndGggPiAwKSB7XG4gICAgICBhd2FpdCBiYXRjaFVwZGF0ZUN1cnJlbnRQcmljZXMoQ1VSUkVOVF9QUklDRVNfVEFCTEUsIGZpbmFsUHJpY2VFdmVudHMpO1xuICAgIH1cblxuICAgIC8vIExvZyBkYXRhIHF1YWxpdHkgc3VtbWFyeVxuICAgIGRhdGFRdWFsaXR5VHJhY2tlci5sb2dTdW1tYXJ5KCk7XG5cbiAgICAvLyBHZXQgZGF0YSBxdWFsaXR5IG1ldHJpY3MgZm9yIHJlc3BvbnNlXG4gICAgY29uc3QgcXVhbGl0eU1ldHJpY3MgPSBkYXRhUXVhbGl0eVRyYWNrZXIuZ2V0TWV0cmljcygpO1xuICAgIGNvbnN0IGRyb3BwZWRTYW1wbGUgPSBkYXRhUXVhbGl0eVRyYWNrZXIuZ2V0RHJvcHBlZFJlY29yZHMoKS5zbGljZSgwLCAxMCk7XG5cbiAgICByZXR1cm4ge1xuICAgICAgc3RhdHVzQ29kZTogMjAwLFxuICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICBwcmljZUV2ZW50czogZmluYWxQcmljZUV2ZW50cy5sZW5ndGgsXG4gICAgICAgIHNhbGVzRXZlbnRzOiBhbGxTYWxlc0V2ZW50cy5sZW5ndGgsXG4gICAgICAgIGtleXdvcmRzUHJvY2Vzc2VkOiBTRUFSQ0hfS0VZV09SRFMubGVuZ3RoLFxuICAgICAgICBjb2xsZWN0ZWRBdCxcbiAgICAgICAgZGF0YVF1YWxpdHk6IHtcbiAgICAgICAgICBtZXRyaWNzOiBxdWFsaXR5TWV0cmljcyxcbiAgICAgICAgICBkcm9wcGVkU2FtcGxlLFxuICAgICAgICB9LFxuICAgICAgfSksXG4gICAgfTtcbiAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICBjb25zb2xlLmVycm9yKFwiSmFwYW4gY29sbGVjdG9yIGVycm9yOlwiLCBlcnJvcik7XG5cbiAgICAvLyBTdGlsbCBsb2cgZGF0YSBxdWFsaXR5IGV2ZW4gb24gZXJyb3JcbiAgICBkYXRhUXVhbGl0eVRyYWNrZXIubG9nU3VtbWFyeSgpO1xuXG4gICAgdGhyb3cgZXJyb3I7XG4gIH1cbn07XG4iXX0=