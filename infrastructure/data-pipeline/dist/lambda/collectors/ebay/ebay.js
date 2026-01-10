"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
const utils_1 = require("/opt/nodejs/utils");
// =============================================================================
// CONFIGURATION
// =============================================================================
const EBAY_BROWSE_API = "https://api.ebay.com/buy/browse/v1";
const EBAY_AUTH_API = "https://api.ebay.com/identity/v1/oauth2/token";
const PRICE_STREAM = process.env.PRICE_STREAM_NAME;
const LISTING_STREAM = process.env.LISTING_STREAM_NAME;
const SALES_STREAM = process.env.SALES_STREAM_NAME;
const CURRENT_PRICES_TABLE = process.env.CURRENT_PRICES_TABLE;
// Rate limiter: 5000 requests per day = ~3.5 per minute
const rateLimiter = new utils_1.RateLimiter(3, 3);
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
// OAUTH 2.0 CLIENT
// =============================================================================
class EbayAuthClient {
    constructor(clientId, clientSecret) {
        this.accessToken = null;
        this.tokenExpiry = null;
        this.clientId = clientId;
        this.clientSecret = clientSecret;
    }
    async getAccessToken() {
        // Check if token is still valid
        if (this.accessToken && this.tokenExpiry && this.tokenExpiry > new Date()) {
            return this.accessToken;
        }
        // Get new token
        const credentials = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64");
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
        const data = await response.json();
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
    constructor(auth, marketplace = "EBAY_US") {
        this.auth = auth;
        this.marketplace = marketplace;
    }
    async request(endpoint, params) {
        await rateLimiter.acquire();
        const accessToken = await this.auth.getAccessToken();
        const url = `${EBAY_BROWSE_API}${endpoint}?${params.toString()}`;
        const response = await (0, utils_1.withRetry)(async () => {
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
    async searchItems(query, options = {}) {
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
        return this.request("/item_summary/search", params);
    }
    /**
     * Search across multiple marketplaces
     */
    async searchMultipleMarketplaces(query, marketplaces = ["EBAY_US", "EBAY_GB", "EBAY_DE"]) {
        const results = [];
        for (const marketplace of marketplaces) {
            try {
                this.marketplace = marketplace;
                const response = await this.searchItems(query, { limit: 100 });
                results.push({
                    marketplace,
                    items: response.itemSummaries || [],
                });
            }
            catch (error) {
                console.warn(`Failed to search ${marketplace}:`, error);
            }
        }
        return results;
    }
}
// =============================================================================
// DATA PROCESSING
// =============================================================================
const EBAY_CONDITION_MAP = {
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
const MARKETPLACE_CURRENCY = {
    EBAY_US: "USD",
    EBAY_GB: "GBP",
    EBAY_DE: "EUR",
    EBAY_AU: "AUD",
    EBAY_CA: "CAD",
};
function extractCardInfoFromTitle(title) {
    const cleanTitle = (0, utils_1.sanitizeString)(title);
    // Try standard pattern first
    const cardMatch = cleanTitle.match(/([A-Z]{2,3}\d{2})-(\d{3})/i);
    if (cardMatch) {
        const setCode = cardMatch[1].toUpperCase();
        const cardNumber = cardMatch[2];
        // Use standardized variant detection
        const variantType = (0, utils_1.detectVariantType)(cleanTitle);
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
    const fuzzyResult = (0, utils_1.fuzzyMatchCard)(cleanTitle);
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
    utils_1.dataQualityTracker.recordDropped("ebay", "no_card_id_pattern", { title });
    return null;
}
function createPriceEventFromListing(item, marketplace, collectedAt) {
    const source = `ebay_${marketplace.toLowerCase().replace("ebay_", "")}`;
    const cardInfo = extractCardInfoFromTitle(item.title);
    if (!cardInfo) {
        // Already tracked by extractCardInfoFromTitle
        return null;
    }
    const { setCode, cardNumber, variantType, name, fuzzyMatched, confidence } = cardInfo;
    const cardId = (0, utils_1.normalizeCardId)(setCode, cardNumber, variantType);
    const price = parseFloat(item.price.value);
    if (isNaN(price) || price <= 0) {
        utils_1.dataQualityTracker.recordDropped(source, "invalid_price", {
            title: item.title,
            rawData: { price: item.price.value },
        });
        return null;
    }
    const currency = item.price.currency || MARKETPLACE_CURRENCY[marketplace] || "USD";
    const { priceUsd, priceGbp } = (0, utils_1.normalizePrice)(price, currency);
    // Normalize condition with tracking
    const conditionResult = (0, utils_1.normalizeConditionWithTracking)(EBAY_CONDITION_MAP[item.conditionId] || item.condition || "");
    const condition = conditionResult.isKnown ? conditionResult.condition : "NM";
    // Calculate seller reputation
    const sellerFeedbackPct = parseFloat(item.seller.feedbackPercentage) || undefined;
    const sellerRepTier = (0, utils_1.calculateSellerReputation)(sellerFeedbackPct, item.seller.feedbackScore);
    const weightFactor = (0, utils_1.getSellerWeightFactor)(sellerRepTier);
    // Detect language from marketplace or title
    let language = "EN";
    if (marketplace === "EBAY_DE")
        language = "DE";
    if (item.title.toLowerCase().includes("japanese") || item.title.includes("日本語")) {
        language = "JP";
    }
    // Track successful parse
    utils_1.dataQualityTracker.recordSuccess(source, {
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
function createListingEvent(item, marketplace, collectedAt) {
    const cardInfo = extractCardInfoFromTitle(item.title);
    const cardId = cardInfo
        ? (0, utils_1.normalizeCardId)(cardInfo.setCode, cardInfo.cardNumber, cardInfo.variantType)
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
const handler = async (event) => {
    console.log("eBay collector started", { event });
    const collectedAt = (0, utils_1.nowIso)();
    // Reset data quality tracker for this run
    utils_1.dataQualityTracker.reset();
    try {
        // Fetch live FX rates before processing
        await (0, utils_1.fetchLiveFxRates)();
        // Get API credentials
        const secrets = await (0, utils_1.getSecrets)();
        if (!secrets.ebay_client_id || !secrets.ebay_client_secret) {
            throw new Error("eBay API credentials not configured");
        }
        const auth = new EbayAuthClient(secrets.ebay_client_id, secrets.ebay_client_secret);
        const client = new EbayClient(auth);
        const allPriceEvents = [];
        const allListingEvents = [];
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
            }
            catch (error) {
                console.warn(`Failed to search for "${query}":`, error);
            }
        }
        // Deduplicate price events (keep lowest price per card)
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
        console.log(`Collected ${allListingEvents.length} listing events`);
        // Send to Kinesis
        if (finalPriceEvents.length > 0) {
            await (0, utils_1.putToKinesis)(PRICE_STREAM, finalPriceEvents);
        }
        if (allListingEvents.length > 0) {
            await (0, utils_1.putToKinesis)(LISTING_STREAM, allListingEvents);
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
                listingEvents: allListingEvents.length,
                queriesProcessed: SEARCH_QUERIES.length,
                collectedAt,
                dataQuality: {
                    metrics: qualityMetrics,
                    droppedSample,
                },
            }),
        };
    }
    catch (error) {
        console.error("eBay collector error:", error);
        // Still log data quality even on error
        utils_1.dataQualityTracker.logSummary();
        throw error;
    }
};
exports.handler = handler;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZWJheS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL2xhbWJkYS9jb2xsZWN0b3JzL2ViYXkvZWJheS50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiO0FBQUE7Ozs7Ozs7OztHQVNHOzs7QUFHSCw2Q0F1QjJCO0FBRTNCLGdGQUFnRjtBQUNoRixnQkFBZ0I7QUFDaEIsZ0ZBQWdGO0FBRWhGLE1BQU0sZUFBZSxHQUFHLG9DQUFvQyxDQUFDO0FBQzdELE1BQU0sYUFBYSxHQUFHLCtDQUErQyxDQUFDO0FBRXRFLE1BQU0sWUFBWSxHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUMsaUJBQWtCLENBQUM7QUFDcEQsTUFBTSxjQUFjLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxtQkFBb0IsQ0FBQztBQUN4RCxNQUFNLFlBQVksR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLGlCQUFrQixDQUFDO0FBQ3BELE1BQU0sb0JBQW9CLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxvQkFBcUIsQ0FBQztBQUUvRCx3REFBd0Q7QUFDeEQsTUFBTSxXQUFXLEdBQUcsSUFBSSxtQkFBVyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQztBQUUxQyxxQ0FBcUM7QUFDckMsTUFBTSxjQUFjLEdBQUc7SUFDckIscUJBQXFCO0lBQ3JCLGVBQWU7SUFDZixNQUFNO0lBQ04sTUFBTTtJQUNOLE1BQU07SUFDTixNQUFNO0lBQ04sTUFBTTtJQUNOLE1BQU07SUFDTixNQUFNO0lBQ04sTUFBTTtJQUNOLE1BQU07SUFDTixNQUFNO0lBQ04sTUFBTTtJQUNOLE1BQU07SUFDTixNQUFNO0lBQ04sY0FBYztJQUNkLGVBQWU7Q0FDaEIsQ0FBQztBQTBERixnRkFBZ0Y7QUFDaEYsbUJBQW1CO0FBQ25CLGdGQUFnRjtBQUVoRixNQUFNLGNBQWM7SUFNbEIsWUFBWSxRQUFnQixFQUFFLFlBQW9CO1FBSDFDLGdCQUFXLEdBQWtCLElBQUksQ0FBQztRQUNsQyxnQkFBVyxHQUFn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LE1BQU07Z0JBQ3BDLGFBQWEsRUFBRSxnQkFBZ0IsQ0FBQyxNQUFNO2dCQUN0QyxnQkFBZ0IsRUFBRSxjQUFjLENBQUMsTUFBTTtnQkFDdkMsV0FBVztnQkFDWCxXQUFXLEVBQUU7b0JBQ1gsT0FBTyxFQUFFLGNBQWM7b0JBQ3ZCLGFBQWE7aUJBQ2Q7YUFDRixDQUFDO1NBQ0gsQ0FBQztJQUNKLENBQUM7SUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1FBQ2YsT0FBTyxDQUFDLEtBQUssQ0FBQyx1QkFBdUIsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUU5Qyx1Q0FBdUM7UUFDdkMsMEJBQWtCLENBQUMsVUFBVSxFQUFFLENBQUM7UUFFaEMsTUFBTSxLQUFLLENBQUM7SUFDZCxDQUFDO0FBQ0gsQ0FBQyxDQUFDO0FBbEhXLFFBQUEsT0FBTyxXQWtIbEIiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIGVCYXkgRGF0YSBDb2xsZWN0b3IgTGFtYmRhXG4gKlxuICogQ29sbGVjdHMgbGlzdGluZ3MgYW5kIGNvbXBsZXRlZCBzYWxlcyBmcm9tIGVCYXkgQVBJcy5cbiAqIFVzZXMgT0F1dGggMi4wIGZvciBhdXRoZW50aWNhdGlvbi5cbiAqXG4gKiBBUElzIHVzZWQ6XG4gKiAtIEJyb3dzZSBBUEk6IFNlYXJjaCBhY3RpdmUgbGlzdGluZ3NcbiAqIC0gRmluZGluZyBBUEk6IFNlYXJjaCBjb21wbGV0ZWQgc2FsZXNcbiAqL1xuXG5pbXBvcnQgeyBIYW5kbGVyLCBTY2hlZHVsZWRFdmVudCB9IGZyb20gXCJhd3MtbGFtYmRhXCI7XG5pbXBvcnQge1xuICBnZXRTZWNyZXRzLFxuICBwdXRUb0tpbmVzaXMsXG4gIGJhdGNoVXBkYXRlQ3VycmVudFByaWNlcyxcbiAgbm9ybWFsaXplUHJpY2UsXG4gIG5vcm1hbGl6ZVByaWNlQXN5bmMsXG4gIGZldGNoTGl2ZUZ4UmF0ZXMsXG4gIG5vcm1hbGl6ZUNhcmRJZCxcbiAgbm9ybWFsaXplQ29uZGl0aW9uLFxuICBub3JtYWxpemVDb25kaXRpb25XaXRoVHJhY2tpbmcsXG4gIFJhdGVMaW1pdGVyLFxuICB3aXRoUmV0cnksXG4gIG5vd0lzbyxcbiAgcGFyc2VDYXJkTnVtYmVyLFxuICBzYW5pdGl6ZVN0cmluZyxcbiAgUHJpY2VFdmVudCxcbiAgTGlzdGluZ0V2ZW50LFxuICBTYWxlc0V2ZW50LFxuICBkYXRhUXVhbGl0eVRyYWNrZXIsXG4gIGZ1enp5TWF0Y2hDYXJkLFxuICBkZXRlY3RWYXJpYW50VHlwZSxcbiAgY2FsY3VsYXRlU2VsbGVyUmVwdXRhdGlvbixcbiAgZ2V0U2VsbGVyV2VpZ2h0RmFjdG9yLFxufSBmcm9tIFwiL29wdC9ub2RlanMvdXRpbHNcIjtcblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIENPTkZJR1VSQVRJT05cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbmNvbnN0IEVCQVlfQlJPV1NFX0FQSSA9IFwiaHR0cHM6Ly9hcGkuZWJheS5jb20vYnV5L2Jyb3dzZS92MVwiO1xuY29uc3QgRUJBWV9BVVRIX0FQSSA9IFwiaHR0cHM6Ly9hcGkuZWJheS5jb20vaWRlbnRpdHkvdjEvb2F1dGgyL3Rva2VuXCI7XG5cbmNvbnN0IFBSSUNFX1NUUkVBTSA9IHByb2Nlc3MuZW52LlBSSUNFX1NUUkVBTV9OQU1FITtcbmNvbnN0IExJU1RJTkdfU1RSRUFNID0gcHJvY2Vzcy5lbnYuTElTVElOR19TVFJFQU1fTkFNRSE7XG5jb25zdCBTQUxFU19TVFJFQU0gPSBwcm9jZXNzLmVudi5TQUxFU19TVFJFQU1fTkFNRSE7XG5jb25zdCBDVVJSRU5UX1BSSUNFU19UQUJMRSA9IHByb2Nlc3MuZW52LkNVUlJFTlRfUFJJQ0VTX1RBQkxFITtcblxuLy8gUmF0ZSBsaW1pdGVyOiA1MDAwIHJlcXVlc3RzIHBlciBkYXkgPSB+My41IHBlciBtaW51dGVcbmNvbnN0IHJhdGVMaW1pdGVyID0gbmV3IFJhdGVMaW1pdGVyKDMsIDMpO1xuXG4vLyBTZWFyY2ggcXVlcmllcyBmb3IgT25lIFBpZWNlIGNhcmRzXG5jb25zdCBTRUFSQ0hfUVVFUklFUyA9IFtcbiAgXCJvbmUgcGllY2UgY2FyZCBnYW1lXCIsXG4gIFwib25lIHBpZWNlIHRjZ1wiLFxuICBcIk9QMDFcIixcbiAgXCJPUDAyXCIsXG4gIFwiT1AwM1wiLFxuICBcIk9QMDRcIixcbiAgXCJPUDA1XCIsXG4gIFwiT1AwNlwiLFxuICBcIk9QMDdcIixcbiAgXCJPUDA4XCIsXG4gIFwiT1AwOVwiLFxuICBcIk9QMTBcIixcbiAgXCJPUDExXCIsXG4gIFwiRUIwMVwiLFxuICBcIkVCMDJcIixcbiAgXCJyb21hbmNlIGRhd25cIixcbiAgXCJwYXJhbW91bnQgd2FyXCIsXG5dO1xuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gVFlQRVNcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbmludGVyZmFjZSBFYmF5SXRlbVN1bW1hcnkge1xuICBpdGVtSWQ6IHN0cmluZztcbiAgdGl0bGU6IHN0cmluZztcbiAgcHJpY2U6IHtcbiAgICB2YWx1ZTogc3RyaW5nO1xuICAgIGN1cnJlbmN5OiBzdHJpbmc7XG4gIH07XG4gIGNvbmRpdGlvbjogc3RyaW5nO1xuICBjb25kaXRpb25JZDogc3RyaW5nO1xuICBpbWFnZT86IHtcbiAgICBpbWFnZVVybDogc3RyaW5nO1xuICB9O1xuICB0aHVtYm5haWxJbWFnZXM/OiBBcnJheTx7IGltYWdlVXJsOiBzdHJpbmcgfT47XG4gIHNlbGxlcjoge1xuICAgIHVzZXJuYW1lOiBzdHJpbmc7XG4gICAgZmVlZGJhY2tQZXJjZW50YWdlOiBzdHJpbmc7XG4gICAgZmVlZGJhY2tTY29yZTogbnVtYmVyO1xuICB9O1xuICBpdGVtTG9jYXRpb24/OiB7XG4gICAgY291bnRyeTogc3RyaW5nO1xuICAgIHBvc3RhbENvZGU/OiBzdHJpbmc7XG4gIH07XG4gIGJ1eWluZ09wdGlvbnM6IHN0cmluZ1tdO1xuICBpdGVtRW5kRGF0ZT86IHN0cmluZztcbiAgaXRlbVdlYlVybDogc3RyaW5nO1xuICBjYXRlZ29yaWVzPzogQXJyYXk8e1xuICAgIGNhdGVnb3J5SWQ6IHN0cmluZztcbiAgICBjYXRlZ29yeU5hbWU6IHN0cmluZztcbiAgfT47XG4gIHNoaXBwaW5nT3B0aW9ucz86IEFycmF5PHtcbiAgICBzaGlwcGluZ0Nvc3Q/OiB7XG4gICAgICB2YWx1ZTogc3RyaW5nO1xuICAgICAgY3VycmVuY3k6IHN0cmluZztcbiAgICB9O1xuICB9Pjtcbn1cblxuaW50ZXJmYWNlIEViYXlTZWFyY2hSZXNwb25zZSB7XG4gIGhyZWY6IHN0cmluZztcbiAgdG90YWw6IG51bWJlcjtcbiAgbmV4dD86IHN0cmluZztcbiAgb2Zmc2V0OiBudW1iZXI7XG4gIGxpbWl0OiBudW1iZXI7XG4gIGl0ZW1TdW1tYXJpZXM/OiBFYmF5SXRlbVN1bW1hcnlbXTtcbn1cblxuaW50ZXJmYWNlIEViYXlBY2Nlc3NUb2tlbiB7XG4gIGFjY2Vzc190b2tlbjogc3RyaW5nO1xuICBleHBpcmVzX2luOiBudW1iZXI7XG4gIHRva2VuX3R5cGU6IHN0cmluZztcbn1cblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIE9BVVRIIDIuMCBDTElFTlRcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbmNsYXNzIEViYXlBdXRoQ2xpZW50IHtcbiAgcHJpdmF0ZSBjbGllbnRJZDogc3RyaW5nO1xuICBwcml2YXRlIGNsaWVudFNlY3JldDogc3RyaW5nO1xuICBwcml2YXRlIGFjY2Vzc1Rva2VuOiBzdHJpbmcgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSB0b2tlbkV4cGlyeTogRGF0ZSB8IG51bGwgPSBudWxsO1xuXG4gIGNvbnN0cnVjdG9yKGNsaWVudElkOiBzdHJpbmcsIGNsaWVudFNlY3JldDogc3RyaW5nKSB7XG4gICAgdGhpcy5jbGllbnRJZCA9IGNsaWVudElkO1xuICAgIHRoaXMuY2xpZW50U2VjcmV0ID0gY2xpZW50U2VjcmV0O1xuICB9XG5cbiAgYXN5bmMgZ2V0QWNjZXNzVG9rZW4oKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgICAvLyBDaGVjayBpZiB0b2tlbiBpcyBzdGlsbCB2YWxpZFxuICAgIGlmICh0aGlzLmFjY2Vzc1Rva2VuICYmIHRoaXMudG9rZW5FeHBpcnkgJiYgdGhpcy50b2tlbkV4cGlyeSA+IG5ldyBEYXRlKCkpIHtcbiAgICAgIHJldHVybiB0aGlzLmFjY2Vzc1Rva2VuO1xuICAgIH1cblxuICAgIC8vIEdldCBuZXcgdG9rZW5cbiAgICBjb25zdCBjcmVkZW50aWFscyA9IEJ1ZmZlci5mcm9tKGAke3RoaXMuY2xpZW50SWR9OiR7dGhpcy5jbGllbnRTZWNyZXR9YCkudG9TdHJpbmcoXG4gICAgICBcImJhc2U2NFwiXG4gICAgKTtcblxuICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgZmV0Y2goRUJBWV9BVVRIX0FQSSwge1xuICAgICAgbWV0aG9kOiBcIlBPU1RcIixcbiAgICAgIGhlYWRlcnM6IHtcbiAgICAgICAgQXV0aG9yaXphdGlvbjogYEJhc2ljICR7Y3JlZGVudGlhbHN9YCxcbiAgICAgICAgXCJDb250ZW50LVR5cGVcIjogXCJhcHBsaWNhdGlvbi94LXd3dy1mb3JtLXVybGVuY29kZWRcIixcbiAgICAgIH0sXG4gICAgICBib2R5OiBcImdyYW50X3R5cGU9Y2xpZW50X2NyZWRlbnRpYWxzJnNjb3BlPWh0dHBzOi8vYXBpLmViYXkuY29tL29hdXRoL2FwaV9zY29wZVwiLFxuICAgIH0pO1xuXG4gICAgaWYgKCFyZXNwb25zZS5vaykge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBGYWlsZWQgdG8gZ2V0IGVCYXkgYWNjZXNzIHRva2VuOiAke3Jlc3BvbnNlLnN0YXR1c31gKTtcbiAgICB9XG5cbiAgICBjb25zdCBkYXRhOiBFYmF5QWNjZXNzVG9rZW4gPSBhd2FpdCByZXNwb25zZS5qc29uKCk7XG5cbiAgICB0aGlzLmFjY2Vzc1Rva2VuID0gZGF0YS5hY2Nlc3NfdG9rZW47XG4gICAgLy8gU2V0IGV4cGlyeSA1IG1pbnV0ZXMgYmVmb3JlIGFjdHVhbCBleHBpcnlcbiAgICB0aGlzLnRva2VuRXhwaXJ5ID0gbmV3IERhdGUoRGF0ZS5ub3coKSArIChkYXRhLmV4cGlyZXNfaW4gLSAzMDApICogMTAwMCk7XG5cbiAgICByZXR1cm4gdGhpcy5hY2Nlc3NUb2tlbjtcbiAgfVxufVxuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gQVBJIENMSUVOVFxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuY2xhc3MgRWJheUNsaWVudCB7XG4gIHByaXZhdGUgYXV0aDogRWJheUF1dGhDbGllbnQ7XG4gIHByaXZhdGUgbWFya2V0cGxhY2U6IHN0cmluZztcblxuICBjb25zdHJ1Y3RvcihhdXRoOiBFYmF5QXV0aENsaWVudCwgbWFya2V0cGxhY2U6IHN0cmluZyA9IFwiRUJBWV9VU1wiKSB7XG4gICAgdGhpcy5hdXRoID0gYXV0aDtcbiAgICB0aGlzLm1hcmtldHBsYWNlID0gbWFya2V0cGxhY2U7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHJlcXVlc3Q8VD4oZW5kcG9pbnQ6IHN0cmluZywgcGFyYW1zOiBVUkxTZWFyY2hQYXJhbXMpOiBQcm9taXNlPFQ+IHtcbiAgICBhd2FpdCByYXRlTGltaXRlci5hY3F1aXJlKCk7XG5cbiAgICBjb25zdCBhY2Nlc3NUb2tlbiA9IGF3YWl0IHRoaXMuYXV0aC5nZXRBY2Nlc3NUb2tlbigpO1xuICAgIGNvbnN0IHVybCA9IGAke0VCQVlfQlJPV1NFX0FQSX0ke2VuZHBvaW50fT8ke3BhcmFtcy50b1N0cmluZygpfWA7XG5cbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHdpdGhSZXRyeShhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCByZXMgPSBhd2FpdCBmZXRjaCh1cmwsIHtcbiAgICAgICAgaGVhZGVyczoge1xuICAgICAgICAgIEF1dGhvcml6YXRpb246IGBCZWFyZXIgJHthY2Nlc3NUb2tlbn1gLFxuICAgICAgICAgIFwiWC1FQkFZLUMtTUFSS0VUUExBQ0UtSURcIjogdGhpcy5tYXJrZXRwbGFjZSxcbiAgICAgICAgICBcIlgtRUJBWS1DLUVORFVTRVJDVFhcIjogXCJhZmZpbGlhdGVDYW1wYWlnbklkPTxlUE5DYW1wYWlnbklkPixhZmZpbGlhdGVSZWZlcmVuY2VJZD08cmVmZXJlbmNlSWQ+XCIsXG4gICAgICAgIH0sXG4gICAgICB9KTtcblxuICAgICAgaWYgKCFyZXMub2spIHtcbiAgICAgICAgaWYgKHJlcy5zdGF0dXMgPT09IDQyOSkge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcIlJhdGUgbGltaXRlZFwiKTtcbiAgICAgICAgfVxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEhUVFAgJHtyZXMuc3RhdHVzfTogJHthd2FpdCByZXMudGV4dCgpfWApO1xuICAgICAgfVxuXG4gICAgICByZXR1cm4gcmVzLmpzb24oKTtcbiAgICB9KTtcblxuICAgIHJldHVybiByZXNwb25zZTtcbiAgfVxuXG4gIC8qKlxuICAgKiBTZWFyY2ggZm9yIGl0ZW1zXG4gICAqL1xuICBhc3luYyBzZWFyY2hJdGVtcyhcbiAgICBxdWVyeTogc3RyaW5nLFxuICAgIG9wdGlvbnM6IHtcbiAgICAgIGxpbWl0PzogbnVtYmVyO1xuICAgICAgb2Zmc2V0PzogbnVtYmVyO1xuICAgICAgZmlsdGVyPzogc3RyaW5nO1xuICAgICAgc29ydD86IHN0cmluZztcbiAgICB9ID0ge31cbiAgKTogUHJvbWlzZTxFYmF5U2VhcmNoUmVzcG9uc2U+IHtcbiAgICBjb25zdCBwYXJhbXMgPSBuZXcgVVJMU2VhcmNoUGFyYW1zKHtcbiAgICAgIHE6IHF1ZXJ5LFxuICAgICAgbGltaXQ6IChvcHRpb25zLmxpbWl0IHx8IDUwKS50b1N0cmluZygpLFxuICAgICAgb2Zmc2V0OiAob3B0aW9ucy5vZmZzZXQgfHwgMCkudG9TdHJpbmcoKSxcbiAgICAgIGNhdGVnb3J5X2lkczogXCIxODM0NTQsMjUzNlwiLCAvLyBUcmFkaW5nIENhcmQgR2FtZXMsIENvbGxlY3RpYmxlIENhcmQgR2FtZXNcbiAgICB9KTtcblxuICAgIGlmIChvcHRpb25zLmZpbHRlcikge1xuICAgICAgcGFyYW1zLnNldChcImZpbHRlclwiLCBvcHRpb25zLmZpbHRlcik7XG4gICAgfVxuXG4gICAgaWYgKG9wdGlvbnMuc29ydCkge1xuICAgICAgcGFyYW1zLnNldChcInNvcnRcIiwgb3B0aW9ucy5zb3J0KTtcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5yZXF1ZXN0PEViYXlTZWFyY2hSZXNwb25zZT4oXCIvaXRlbV9zdW1tYXJ5L3NlYXJjaFwiLCBwYXJhbXMpO1xuICB9XG5cbiAgLyoqXG4gICAqIFNlYXJjaCBhY3Jvc3MgbXVsdGlwbGUgbWFya2V0cGxhY2VzXG4gICAqL1xuICBhc3luYyBzZWFyY2hNdWx0aXBsZU1hcmtldHBsYWNlcyhcbiAgICBxdWVyeTogc3RyaW5nLFxuICAgIG1hcmtldHBsYWNlczogc3RyaW5nW10gPSBbXCJFQkFZX1VTXCIsIFwiRUJBWV9HQlwiLCBcIkVCQVlfREVcIl1cbiAgKTogUHJvbWlzZTx7IG1hcmtldHBsYWNlOiBzdHJpbmc7IGl0ZW1zOiBFYmF5SXRlbVN1bW1hcnlbXSB9W10+IHtcbiAgICBjb25zdCByZXN1bHRzOiB7IG1hcmtldHBsYWNlOiBzdHJpbmc7IGl0ZW1zOiBFYmF5SXRlbVN1bW1hcnlbXSB9W10gPSBbXTtcblxuICAgIGZvciAoY29uc3QgbWFya2V0cGxhY2Ugb2YgbWFya2V0cGxhY2VzKSB7XG4gICAgICB0cnkge1xuICAgICAgICB0aGlzLm1hcmtldHBsYWNlID0gbWFya2V0cGxhY2U7XG4gICAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgdGhpcy5zZWFyY2hJdGVtcyhxdWVyeSwgeyBsaW1pdDogMTAwIH0pO1xuICAgICAgICByZXN1bHRzLnB1c2goe1xuICAgICAgICAgIG1hcmtldHBsYWNlLFxuICAgICAgICAgIGl0ZW1zOiByZXNwb25zZS5pdGVtU3VtbWFyaWVzIHx8IFtdLFxuICAgICAgICB9KTtcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGNvbnNvbGUud2FybihgRmFpbGVkIHRvIHNlYXJjaCAke21hcmtldHBsYWNlfTpgLCBlcnJvcik7XG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHJlc3VsdHM7XG4gIH1cbn1cblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIERBVEEgUFJPQ0VTU0lOR1xuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuY29uc3QgRUJBWV9DT05ESVRJT05fTUFQOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0ge1xuICBcIjEwMDBcIjogXCJOTVwiLCAvLyBOZXdcbiAgXCIxNTAwXCI6IFwiTk1cIiwgLy8gT3BlbiBib3hcbiAgXCIyMDAwXCI6IFwiTk1cIiwgLy8gQ2VydGlmaWVkIFJlZnVyYmlzaGVkXG4gIFwiMjUwMFwiOiBcIk5NXCIsIC8vIFNlbGxlciBSZWZ1cmJpc2hlZFxuICBcIjMwMDBcIjogXCJMUFwiLCAvLyBVc2VkXG4gIFwiNDAwMFwiOiBcIkxQXCIsIC8vIFZlcnkgR29vZFxuICBcIjUwMDBcIjogXCJNUFwiLCAvLyBHb29kXG4gIFwiNjAwMFwiOiBcIkhQXCIsIC8vIEFjY2VwdGFibGVcbiAgXCI3MDAwXCI6IFwiRE1HXCIsIC8vIEZvciBwYXJ0cy9ub3Qgd29ya2luZ1xufTtcblxuY29uc3QgTUFSS0VUUExBQ0VfQ1VSUkVOQ1k6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7XG4gIEVCQVlfVVM6IFwiVVNEXCIsXG4gIEVCQVlfR0I6IFwiR0JQXCIsXG4gIEVCQVlfREU6IFwiRVVSXCIsXG4gIEVCQVlfQVU6IFwiQVVEXCIsXG4gIEVCQVlfQ0E6IFwiQ0FEXCIsXG59O1xuXG5pbnRlcmZhY2UgQ2FyZEluZm9SZXN1bHQge1xuICBzZXRDb2RlOiBzdHJpbmc7XG4gIGNhcmROdW1iZXI6IHN0cmluZztcbiAgdmFyaWFudFR5cGU6IHN0cmluZztcbiAgbmFtZTogc3RyaW5nO1xuICBmdXp6eU1hdGNoZWQ6IGJvb2xlYW47XG4gIGNvbmZpZGVuY2U6IFwiaGlnaFwiIHwgXCJtZWRpdW1cIiB8IFwibG93XCI7XG59XG5cbmZ1bmN0aW9uIGV4dHJhY3RDYXJkSW5mb0Zyb21UaXRsZSh0aXRsZTogc3RyaW5nKTogQ2FyZEluZm9SZXN1bHQgfCBudWxsIHtcbiAgY29uc3QgY2xlYW5UaXRsZSA9IHNhbml0aXplU3RyaW5nKHRpdGxlKTtcblxuICAvLyBUcnkgc3RhbmRhcmQgcGF0dGVybiBmaXJzdFxuICBjb25zdCBjYXJkTWF0Y2ggPSBjbGVhblRpdGxlLm1hdGNoKC8oW0EtWl17MiwzfVxcZHsyfSktKFxcZHszfSkvaSk7XG4gIGlmIChjYXJkTWF0Y2gpIHtcbiAgICBjb25zdCBzZXRDb2RlID0gY2FyZE1hdGNoWzFdLnRvVXBwZXJDYXNlKCk7XG4gICAgY29uc3QgY2FyZE51bWJlciA9IGNhcmRNYXRjaFsyXTtcblxuICAgIC8vIFVzZSBzdGFuZGFyZGl6ZWQgdmFyaWFudCBkZXRlY3Rpb25cbiAgICBjb25zdCB2YXJpYW50VHlwZSA9IGRldGVjdFZhcmlhbnRUeXBlKGNsZWFuVGl0bGUpO1xuXG4gICAgLy8gRXh0cmFjdCBuYW1lIChldmVyeXRoaW5nIGJlZm9yZSB0aGUgY2FyZCBudW1iZXIpXG4gICAgY29uc3QgbmFtZU1hdGNoID0gY2xlYW5UaXRsZS5tYXRjaCgvXiguKj8pKD86W0EtWl17MiwzfVxcZHsyfS1cXGR7M30pL2kpO1xuICAgIGNvbnN0IG5hbWUgPSBuYW1lTWF0Y2ggPyBuYW1lTWF0Y2hbMV0udHJpbSgpIDogY2xlYW5UaXRsZTtcblxuICAgIHJldHVybiB7XG4gICAgICBzZXRDb2RlLFxuICAgICAgY2FyZE51bWJlcixcbiAgICAgIHZhcmlhbnRUeXBlLFxuICAgICAgbmFtZSxcbiAgICAgIGZ1enp5TWF0Y2hlZDogZmFsc2UsXG4gICAgICBjb25maWRlbmNlOiBcImhpZ2hcIixcbiAgICB9O1xuICB9XG5cbiAgLy8gVHJ5IGZ1enp5IG1hdGNoaW5nIGZvciBub24tc3RhbmRhcmQgZm9ybWF0c1xuICBjb25zdCBmdXp6eVJlc3VsdCA9IGZ1enp5TWF0Y2hDYXJkKGNsZWFuVGl0bGUpO1xuICBpZiAoZnV6enlSZXN1bHQpIHtcbiAgICAvLyBFeHRyYWN0IG5hbWUgKHVzZSBmdWxsIHRpdGxlIGlmIHdlIGNhbid0IGZpbmQgYSBiZXR0ZXIgb25lKVxuICAgIGNvbnN0IG5hbWUgPSBjbGVhblRpdGxlLnJlcGxhY2UoL1tBLVpdezIsM31cXGR7Mn1bXFxzXFwtXFwvXFwuXVxcZHszfS9naSwgXCJcIikudHJpbSgpIHx8IGNsZWFuVGl0bGU7XG5cbiAgICByZXR1cm4ge1xuICAgICAgc2V0Q29kZTogZnV6enlSZXN1bHQuc2V0Q29kZSxcbiAgICAgIGNhcmROdW1iZXI6IGZ1enp5UmVzdWx0LmNhcmROdW1iZXIsXG4gICAgICB2YXJpYW50VHlwZTogZnV6enlSZXN1bHQudmFyaWFudFR5cGUsXG4gICAgICBuYW1lLFxuICAgICAgZnV6enlNYXRjaGVkOiB0cnVlLFxuICAgICAgY29uZmlkZW5jZTogZnV6enlSZXN1bHQuY29uZmlkZW5jZSxcbiAgICB9O1xuICB9XG5cbiAgLy8gUmVjb3JkIGRyb3BwZWQgZm9yIGFuYWx5c2lzXG4gIGRhdGFRdWFsaXR5VHJhY2tlci5yZWNvcmREcm9wcGVkKFwiZWJheVwiLCBcIm5vX2NhcmRfaWRfcGF0dGVyblwiLCB7IHRpdGxlIH0pO1xuXG4gIHJldHVybiBudWxsO1xufVxuXG5pbnRlcmZhY2UgRXh0ZW5kZWRQcmljZUV2ZW50IGV4dGVuZHMgUHJpY2VFdmVudCB7XG4gIHNlbGxlclJlcHV0YXRpb25UaWVyPzogc3RyaW5nO1xuICBzZWxsZXJXZWlnaHRGYWN0b3I/OiBudW1iZXI7XG4gIGZ1enp5TWF0Y2hlZD86IGJvb2xlYW47XG4gIG1hdGNoQ29uZmlkZW5jZT86IHN0cmluZztcbiAgY29uZGl0aW9uS25vd24/OiBib29sZWFuO1xufVxuXG5mdW5jdGlvbiBjcmVhdGVQcmljZUV2ZW50RnJvbUxpc3RpbmcoXG4gIGl0ZW06IEViYXlJdGVtU3VtbWFyeSxcbiAgbWFya2V0cGxhY2U6IHN0cmluZyxcbiAgY29sbGVjdGVkQXQ6IHN0cmluZ1xuKTogRXh0ZW5kZWRQcmljZUV2ZW50IHwgbnVsbCB7XG4gIGNvbnN0IHNvdXJjZSA9IGBlYmF5XyR7bWFya2V0cGxhY2UudG9Mb3dlckNhc2UoKS5yZXBsYWNlKFwiZWJheV9cIiwgXCJcIil9YDtcblxuICBjb25zdCBjYXJkSW5mbyA9IGV4dHJhY3RDYXJkSW5mb0Zyb21UaXRsZShpdGVtLnRpdGxlKTtcbiAgaWYgKCFjYXJkSW5mbykge1xuICAgIC8vIEFscmVhZHkgdHJhY2tlZCBieSBleHRyYWN0Q2FyZEluZm9Gcm9tVGl0bGVcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIGNvbnN0IHsgc2V0Q29kZSwgY2FyZE51bWJlciwgdmFyaWFudFR5cGUsIG5hbWUsIGZ1enp5TWF0Y2hlZCwgY29uZmlkZW5jZSB9ID0gY2FyZEluZm87XG4gIGNvbnN0IGNhcmRJZCA9IG5vcm1hbGl6ZUNhcmRJZChzZXRDb2RlLCBjYXJkTnVtYmVyLCB2YXJpYW50VHlwZSk7XG5cbiAgY29uc3QgcHJpY2UgPSBwYXJzZUZsb2F0KGl0ZW0ucHJpY2UudmFsdWUpO1xuICBpZiAoaXNOYU4ocHJpY2UpIHx8IHByaWNlIDw9IDApIHtcbiAgICBkYXRhUXVhbGl0eVRyYWNrZXIucmVjb3JkRHJvcHBlZChzb3VyY2UsIFwiaW52YWxpZF9wcmljZVwiLCB7XG4gICAgICB0aXRsZTogaXRlbS50aXRsZSxcbiAgICAgIHJhd0RhdGE6IHsgcHJpY2U6IGl0ZW0ucHJpY2UudmFsdWUgfSxcbiAgICB9KTtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIGNvbnN0IGN1cnJlbmN5ID0gaXRlbS5wcmljZS5jdXJyZW5jeSB8fCBNQVJLRVRQTEFDRV9DVVJSRU5DWVttYXJrZXRwbGFjZV0gfHwgXCJVU0RcIjtcbiAgY29uc3QgeyBwcmljZVVzZCwgcHJpY2VHYnAgfSA9IG5vcm1hbGl6ZVByaWNlKHByaWNlLCBjdXJyZW5jeSk7XG5cbiAgLy8gTm9ybWFsaXplIGNvbmRpdGlvbiB3aXRoIHRyYWNraW5nXG4gIGNvbnN0IGNvbmRpdGlvblJlc3VsdCA9IG5vcm1hbGl6ZUNvbmRpdGlvbldpdGhUcmFja2luZyhcbiAgICBFQkFZX0NPTkRJVElPTl9NQVBbaXRlbS5jb25kaXRpb25JZF0gfHwgaXRlbS5jb25kaXRpb24gfHwgXCJcIlxuICApO1xuICBjb25zdCBjb25kaXRpb24gPSBjb25kaXRpb25SZXN1bHQuaXNLbm93biA/IGNvbmRpdGlvblJlc3VsdC5jb25kaXRpb24gOiBcIk5NXCI7XG5cbiAgLy8gQ2FsY3VsYXRlIHNlbGxlciByZXB1dGF0aW9uXG4gIGNvbnN0IHNlbGxlckZlZWRiYWNrUGN0ID0gcGFyc2VGbG9hdChpdGVtLnNlbGxlci5mZWVkYmFja1BlcmNlbnRhZ2UpIHx8IHVuZGVmaW5lZDtcbiAgY29uc3Qgc2VsbGVyUmVwVGllciA9IGNhbGN1bGF0ZVNlbGxlclJlcHV0YXRpb24oXG4gICAgc2VsbGVyRmVlZGJhY2tQY3QsXG4gICAgaXRlbS5zZWxsZXIuZmVlZGJhY2tTY29yZVxuICApO1xuICBjb25zdCB3ZWlnaHRGYWN0b3IgPSBnZXRTZWxsZXJXZWlnaHRGYWN0b3Ioc2VsbGVyUmVwVGllcik7XG5cbiAgLy8gRGV0ZWN0IGxhbmd1YWdlIGZyb20gbWFya2V0cGxhY2Ugb3IgdGl0bGVcbiAgbGV0IGxhbmd1YWdlID0gXCJFTlwiO1xuICBpZiAobWFya2V0cGxhY2UgPT09IFwiRUJBWV9ERVwiKSBsYW5ndWFnZSA9IFwiREVcIjtcbiAgaWYgKGl0ZW0udGl0bGUudG9Mb3dlckNhc2UoKS5pbmNsdWRlcyhcImphcGFuZXNlXCIpIHx8IGl0ZW0udGl0bGUuaW5jbHVkZXMoXCLml6XmnKzoqp5cIikpIHtcbiAgICBsYW5ndWFnZSA9IFwiSlBcIjtcbiAgfVxuXG4gIC8vIFRyYWNrIHN1Y2Nlc3NmdWwgcGFyc2VcbiAgZGF0YVF1YWxpdHlUcmFja2VyLnJlY29yZFN1Y2Nlc3Moc291cmNlLCB7XG4gICAgZnV6enlNYXRjaGVkLFxuICAgIHVua25vd25Db25kaXRpb246ICFjb25kaXRpb25SZXN1bHQuaXNLbm93bixcbiAgfSk7XG5cbiAgcmV0dXJuIHtcbiAgICBldmVudFR5cGU6IFwicHJpY2VcIixcbiAgICBzb3VyY2UsXG4gICAgY2FyZElkLFxuICAgIGV4dGVybmFsSWQ6IGl0ZW0uaXRlbUlkLFxuICAgIG5hbWUsXG4gICAgc2V0Q29kZSxcbiAgICBjYXJkTnVtYmVyLFxuICAgIHZhcmlhbnRUeXBlLFxuICAgIGNvbmRpdGlvbixcbiAgICBsYW5ndWFnZSxcbiAgICBwcmljZSxcbiAgICBjdXJyZW5jeSxcbiAgICBwcmljZVVzZCxcbiAgICBwcmljZUdicCxcbiAgICBsaXN0aW5nc0NvdW50OiAxLFxuICAgIHNlbGxlcklkOiBpdGVtLnNlbGxlci51c2VybmFtZSxcbiAgICB0aW1lc3RhbXA6IGNvbGxlY3RlZEF0LFxuICAgIGNvbGxlY3RlZEF0LFxuICAgIC8vIEV4dGVuZGVkIGZpZWxkcyBmb3IgZGF0YSBxdWFsaXR5XG4gICAgc2VsbGVyUmVwdXRhdGlvblRpZXI6IHNlbGxlclJlcFRpZXIsXG4gICAgc2VsbGVyV2VpZ2h0RmFjdG9yOiB3ZWlnaHRGYWN0b3IsXG4gICAgZnV6enlNYXRjaGVkLFxuICAgIG1hdGNoQ29uZmlkZW5jZTogY29uZmlkZW5jZSxcbiAgICBjb25kaXRpb25Lbm93bjogY29uZGl0aW9uUmVzdWx0LmlzS25vd24sXG4gIH07XG59XG5cbmZ1bmN0aW9uIGNyZWF0ZUxpc3RpbmdFdmVudChcbiAgaXRlbTogRWJheUl0ZW1TdW1tYXJ5LFxuICBtYXJrZXRwbGFjZTogc3RyaW5nLFxuICBjb2xsZWN0ZWRBdDogc3RyaW5nXG4pOiBMaXN0aW5nRXZlbnQgfCBudWxsIHtcbiAgY29uc3QgY2FyZEluZm8gPSBleHRyYWN0Q2FyZEluZm9Gcm9tVGl0bGUoaXRlbS50aXRsZSk7XG4gIGNvbnN0IGNhcmRJZCA9IGNhcmRJbmZvXG4gICAgPyBub3JtYWxpemVDYXJkSWQoY2FyZEluZm8uc2V0Q29kZSwgY2FyZEluZm8uY2FyZE51bWJlciwgY2FyZEluZm8udmFyaWFudFR5cGUpXG4gICAgOiBcIlwiO1xuXG4gIGNvbnN0IHByaWNlID0gcGFyc2VGbG9hdChpdGVtLnByaWNlLnZhbHVlKTtcbiAgaWYgKGlzTmFOKHByaWNlKSB8fCBwcmljZSA8PSAwKSB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICBjb25zdCBjb25kaXRpb24gPSBFQkFZX0NPTkRJVElPTl9NQVBbaXRlbS5jb25kaXRpb25JZF0gfHwgXCJOTVwiO1xuICBjb25zdCBpc0F1Y3Rpb24gPSBpdGVtLmJ1eWluZ09wdGlvbnMuaW5jbHVkZXMoXCJBVUNUSU9OXCIpO1xuXG4gIHJldHVybiB7XG4gICAgZXZlbnRUeXBlOiBcImxpc3RpbmdcIixcbiAgICBzb3VyY2U6IGBlYmF5XyR7bWFya2V0cGxhY2UudG9Mb3dlckNhc2UoKS5yZXBsYWNlKFwiZWJheV9cIiwgXCJcIil9YCxcbiAgICBsaXN0aW5nSWQ6IGl0ZW0uaXRlbUlkLFxuICAgIGNhcmRJZCxcbiAgICB0aXRsZTogaXRlbS50aXRsZSxcbiAgICBkZXNjcmlwdGlvbjogdW5kZWZpbmVkLCAvLyBXb3VsZCBuZWVkIGFkZGl0aW9uYWwgQVBJIGNhbGxcbiAgICBwcmljZSxcbiAgICBjdXJyZW5jeTogaXRlbS5wcmljZS5jdXJyZW5jeSxcbiAgICBjb25kaXRpb24sXG4gICAgc2VsbGVySWQ6IGl0ZW0uc2VsbGVyLnVzZXJuYW1lLFxuICAgIHNlbGxlckZlZWRiYWNrOiBwYXJzZUZsb2F0KGl0ZW0uc2VsbGVyLmZlZWRiYWNrUGVyY2VudGFnZSkgfHwgdW5kZWZpbmVkLFxuICAgIHNlbGxlckZlZWRiYWNrQ291bnQ6IGl0ZW0uc2VsbGVyLmZlZWRiYWNrU2NvcmUsXG4gICAgaW1hZ2VVcmxzOiBpdGVtLnRodW1ibmFpbEltYWdlcz8ubWFwKChpbWcpID0+IGltZy5pbWFnZVVybCksXG4gICAgaXNBdWN0aW9uLFxuICAgIGVuZFRpbWU6IGl0ZW0uaXRlbUVuZERhdGUsXG4gICAgdGltZXN0YW1wOiBjb2xsZWN0ZWRBdCxcbiAgICBjb2xsZWN0ZWRBdCxcbiAgfTtcbn1cblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIE1BSU4gSEFORExFUlxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuZXhwb3J0IGNvbnN0IGhhbmRsZXI6IEhhbmRsZXI8U2NoZWR1bGVkRXZlbnQ+ID0gYXN5bmMgKGV2ZW50KSA9PiB7XG4gIGNvbnNvbGUubG9nKFwiZUJheSBjb2xsZWN0b3Igc3RhcnRlZFwiLCB7IGV2ZW50IH0pO1xuICBjb25zdCBjb2xsZWN0ZWRBdCA9IG5vd0lzbygpO1xuXG4gIC8vIFJlc2V0IGRhdGEgcXVhbGl0eSB0cmFja2VyIGZvciB0aGlzIHJ1blxuICBkYXRhUXVhbGl0eVRyYWNrZXIucmVzZXQoKTtcblxuICB0cnkge1xuICAgIC8vIEZldGNoIGxpdmUgRlggcmF0ZXMgYmVmb3JlIHByb2Nlc3NpbmdcbiAgICBhd2FpdCBmZXRjaExpdmVGeFJhdGVzKCk7XG5cbiAgICAvLyBHZXQgQVBJIGNyZWRlbnRpYWxzXG4gICAgY29uc3Qgc2VjcmV0cyA9IGF3YWl0IGdldFNlY3JldHMoKTtcbiAgICBpZiAoIXNlY3JldHMuZWJheV9jbGllbnRfaWQgfHwgIXNlY3JldHMuZWJheV9jbGllbnRfc2VjcmV0KSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJlQmF5IEFQSSBjcmVkZW50aWFscyBub3QgY29uZmlndXJlZFwiKTtcbiAgICB9XG5cbiAgICBjb25zdCBhdXRoID0gbmV3IEViYXlBdXRoQ2xpZW50KFxuICAgICAgc2VjcmV0cy5lYmF5X2NsaWVudF9pZCxcbiAgICAgIHNlY3JldHMuZWJheV9jbGllbnRfc2VjcmV0XG4gICAgKTtcbiAgICBjb25zdCBjbGllbnQgPSBuZXcgRWJheUNsaWVudChhdXRoKTtcblxuICAgIGNvbnN0IGFsbFByaWNlRXZlbnRzOiBFeHRlbmRlZFByaWNlRXZlbnRbXSA9IFtdO1xuICAgIGNvbnN0IGFsbExpc3RpbmdFdmVudHM6IExpc3RpbmdFdmVudFtdID0gW107XG5cbiAgICAvLyBTZWFyY2ggYWNyb3NzIG1hcmtldHBsYWNlc1xuICAgIGNvbnN0IG1hcmtldHBsYWNlcyA9IFtcIkVCQVlfVVNcIiwgXCJFQkFZX0dCXCIsIFwiRUJBWV9ERVwiXTtcblxuICAgIGZvciAoY29uc3QgcXVlcnkgb2YgU0VBUkNIX1FVRVJJRVMpIHtcbiAgICAgIGNvbnNvbGUubG9nKGBTZWFyY2hpbmcgZm9yOiAke3F1ZXJ5fWApO1xuXG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCByZXN1bHRzID0gYXdhaXQgY2xpZW50LnNlYXJjaE11bHRpcGxlTWFya2V0cGxhY2VzKHF1ZXJ5LCBtYXJrZXRwbGFjZXMpO1xuXG4gICAgICAgIGZvciAoY29uc3QgeyBtYXJrZXRwbGFjZSwgaXRlbXMgfSBvZiByZXN1bHRzKSB7XG4gICAgICAgICAgY29uc29sZS5sb2coYCAgJHttYXJrZXRwbGFjZX06ICR7aXRlbXMubGVuZ3RofSBpdGVtc2ApO1xuXG4gICAgICAgICAgZm9yIChjb25zdCBpdGVtIG9mIGl0ZW1zKSB7XG4gICAgICAgICAgICAvLyBDcmVhdGUgcHJpY2UgZXZlbnRcbiAgICAgICAgICAgIGNvbnN0IHByaWNlRXZlbnQgPSBjcmVhdGVQcmljZUV2ZW50RnJvbUxpc3RpbmcoaXRlbSwgbWFya2V0cGxhY2UsIGNvbGxlY3RlZEF0KTtcbiAgICAgICAgICAgIGlmIChwcmljZUV2ZW50KSB7XG4gICAgICAgICAgICAgIGFsbFByaWNlRXZlbnRzLnB1c2gocHJpY2VFdmVudCk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIENyZWF0ZSBsaXN0aW5nIGV2ZW50XG4gICAgICAgICAgICBjb25zdCBsaXN0aW5nRXZlbnQgPSBjcmVhdGVMaXN0aW5nRXZlbnQoaXRlbSwgbWFya2V0cGxhY2UsIGNvbGxlY3RlZEF0KTtcbiAgICAgICAgICAgIGlmIChsaXN0aW5nRXZlbnQpIHtcbiAgICAgICAgICAgICAgYWxsTGlzdGluZ0V2ZW50cy5wdXNoKGxpc3RpbmdFdmVudCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBjb25zb2xlLndhcm4oYEZhaWxlZCB0byBzZWFyY2ggZm9yIFwiJHtxdWVyeX1cIjpgLCBlcnJvcik7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gRGVkdXBsaWNhdGUgcHJpY2UgZXZlbnRzIChrZWVwIGxvd2VzdCBwcmljZSBwZXIgY2FyZClcbiAgICBjb25zdCB1bmlxdWVQcmljZXMgPSBuZXcgTWFwPHN0cmluZywgUHJpY2VFdmVudD4oKTtcbiAgICBmb3IgKGNvbnN0IGV2ZW50IG9mIGFsbFByaWNlRXZlbnRzKSB7XG4gICAgICBjb25zdCBrZXkgPSBgJHtldmVudC5jYXJkSWR9LSR7ZXZlbnQuY29uZGl0aW9ufS0ke2V2ZW50LnNvdXJjZX1gO1xuICAgICAgY29uc3QgZXhpc3RpbmcgPSB1bmlxdWVQcmljZXMuZ2V0KGtleSk7XG4gICAgICBpZiAoIWV4aXN0aW5nIHx8IGV2ZW50LnByaWNlVXNkIDwgZXhpc3RpbmcucHJpY2VVc2QpIHtcbiAgICAgICAgdW5pcXVlUHJpY2VzLnNldChrZXksIGV2ZW50KTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBjb25zdCBmaW5hbFByaWNlRXZlbnRzID0gQXJyYXkuZnJvbSh1bmlxdWVQcmljZXMudmFsdWVzKCkpO1xuXG4gICAgY29uc29sZS5sb2coYENvbGxlY3RlZCAke2ZpbmFsUHJpY2VFdmVudHMubGVuZ3RofSB1bmlxdWUgcHJpY2UgZXZlbnRzYCk7XG4gICAgY29uc29sZS5sb2coYENvbGxlY3RlZCAke2FsbExpc3RpbmdFdmVudHMubGVuZ3RofSBsaXN0aW5nIGV2ZW50c2ApO1xuXG4gICAgLy8gU2VuZCB0byBLaW5lc2lzXG4gICAgaWYgKGZpbmFsUHJpY2VFdmVudHMubGVuZ3RoID4gMCkge1xuICAgICAgYXdhaXQgcHV0VG9LaW5lc2lzKFBSSUNFX1NUUkVBTSwgZmluYWxQcmljZUV2ZW50cyk7XG4gICAgfVxuXG4gICAgaWYgKGFsbExpc3RpbmdFdmVudHMubGVuZ3RoID4gMCkge1xuICAgICAgYXdhaXQgcHV0VG9LaW5lc2lzKExJU1RJTkdfU1RSRUFNLCBhbGxMaXN0aW5nRXZlbnRzKTtcbiAgICB9XG5cbiAgICAvLyBVcGRhdGUgRHluYW1vREJcbiAgICBpZiAoZmluYWxQcmljZUV2ZW50cy5sZW5ndGggPiAwKSB7XG4gICAgICBhd2FpdCBiYXRjaFVwZGF0ZUN1cnJlbnRQcmljZXMoQ1VSUkVOVF9QUklDRVNfVEFCTEUsIGZpbmFsUHJpY2VFdmVudHMpO1xuICAgIH1cblxuICAgIC8vIExvZyBkYXRhIHF1YWxpdHkgc3VtbWFyeVxuICAgIGRhdGFRdWFsaXR5VHJhY2tlci5sb2dTdW1tYXJ5KCk7XG5cbiAgICAvLyBHZXQgZGF0YSBxdWFsaXR5IG1ldHJpY3MgZm9yIHJlc3BvbnNlXG4gICAgY29uc3QgcXVhbGl0eU1ldHJpY3MgPSBkYXRhUXVhbGl0eVRyYWNrZXIuZ2V0TWV0cmljcygpO1xuICAgIGNvbnN0IGRyb3BwZWRTYW1wbGUgPSBkYXRhUXVhbGl0eVRyYWNrZXIuZ2V0RHJvcHBlZFJlY29yZHMoKS5zbGljZSgwLCAxMCk7XG5cbiAgICByZXR1cm4ge1xuICAgICAgc3RhdHVzQ29kZTogMjAwLFxuICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICBwcmljZUV2ZW50czogZmluYWxQcmljZUV2ZW50cy5sZW5ndGgsXG4gICAgICAgIGxpc3RpbmdFdmVudHM6IGFsbExpc3RpbmdFdmVudHMubGVuZ3RoLFxuICAgICAgICBxdWVyaWVzUHJvY2Vzc2VkOiBTRUFSQ0hfUVVFUklFUy5sZW5ndGgsXG4gICAgICAgIGNvbGxlY3RlZEF0LFxuICAgICAgICBkYXRhUXVhbGl0eToge1xuICAgICAgICAgIG1ldHJpY3M6IHF1YWxpdHlNZXRyaWNzLFxuICAgICAgICAgIGRyb3BwZWRTYW1wbGUsXG4gICAgICAgIH0sXG4gICAgICB9KSxcbiAgICB9O1xuICB9IGNhdGNoIChlcnJvcikge1xuICAgIGNvbnNvbGUuZXJyb3IoXCJlQmF5IGNvbGxlY3RvciBlcnJvcjpcIiwgZXJyb3IpO1xuXG4gICAgLy8gU3RpbGwgbG9nIGRhdGEgcXVhbGl0eSBldmVuIG9uIGVycm9yXG4gICAgZGF0YVF1YWxpdHlUcmFja2VyLmxvZ1N1bW1hcnkoKTtcblxuICAgIHRocm93IGVycm9yO1xuICB9XG59O1xuIl19