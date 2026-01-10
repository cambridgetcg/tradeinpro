"use strict";
/**
 * Cardmarket Data Collector Lambda
 *
 * Collects price data from the Cardmarket API (Europe's largest marketplace).
 * Uses OAuth 1.0a for authentication.
 *
 * API Documentation: https://api.cardmarket.com/ws/documentation
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
const crypto = __importStar(require("crypto"));
const utils_1 = require("/opt/nodejs/utils");
// =============================================================================
// CONFIGURATION
// =============================================================================
const CARDMARKET_API_BASE = "https://api.cardmarket.com/ws/v2.0";
const CARDMARKET_GAME_ID = 7; // One Piece Card Game
const PRICE_STREAM = process.env.PRICE_STREAM_NAME;
const CURRENT_PRICES_TABLE = process.env.CURRENT_PRICES_TABLE;
const TIMESTREAM_DATABASE = process.env.TIMESTREAM_DATABASE;
// Rate limiter: 100 requests per minute
const rateLimiter = new utils_1.RateLimiter(2, 2);
// =============================================================================
// OAUTH 1.0a IMPLEMENTATION
// =============================================================================
class CardmarketOAuth {
    constructor(appToken, appSecret, accessToken = "", accessSecret = "") {
        this.appToken = appToken;
        this.appSecret = appSecret;
        this.accessToken = accessToken;
        this.accessSecret = accessSecret;
    }
    generateSignature(method, url, params) {
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
        const signingKey = `${encodeURIComponent(this.appSecret)}&${encodeURIComponent(this.accessSecret)}`;
        // Generate HMAC-SHA1 signature
        const signature = crypto
            .createHmac("sha1", signingKey)
            .update(signatureBase)
            .digest("base64");
        return signature;
    }
    generateAuthHeader(method, url) {
        const timestamp = Math.floor(Date.now() / 1000).toString();
        const nonce = crypto.randomBytes(16).toString("hex");
        const oauthParams = {
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
    constructor(appToken, appSecret) {
        this.oauth = new CardmarketOAuth(appToken, appSecret);
    }
    async request(endpoint, method = "GET") {
        await rateLimiter.acquire();
        const url = `${CARDMARKET_API_BASE}${endpoint}`;
        const authHeader = this.oauth.generateAuthHeader(method, url);
        const response = await (0, utils_1.withRetry)(async () => {
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
    async getExpansions() {
        const response = await this.request(`/games/${CARDMARKET_GAME_ID}/expansions`);
        return response.expansion || [];
    }
    /**
     * Get products in an expansion
     */
    async getProductsByExpansion(expansionId) {
        const response = await this.request(`/expansions/${expansionId}/singles`);
        return response.product || [];
    }
    /**
     * Get price guide for a product
     */
    async getPriceGuide(productId) {
        try {
            const response = await this.request(`/products/${productId}/priceGuide`);
            return response.priceGuide;
        }
        catch (error) {
            console.warn(`Failed to get price guide for product ${productId}:`, error);
            return null;
        }
    }
    /**
     * Get articles (listings) for a product
     */
    async getArticles(productId, options = {}) {
        const params = new URLSearchParams();
        if (options.start)
            params.set("start", options.start.toString());
        if (options.maxResults)
            params.set("maxResults", options.maxResults.toString());
        if (options.minCondition)
            params.set("minCondition", options.minCondition);
        const query = params.toString() ? `?${params.toString()}` : "";
        const response = await this.request(`/articles/${productId}${query}`);
        return response.article || [];
    }
    /**
     * Search for products
     */
    async searchProducts(query) {
        const response = await this.request(`/products/find?search=${encodeURIComponent(query)}&idGame=${CARDMARKET_GAME_ID}`);
        return response.product || [];
    }
}
// =============================================================================
// DATA PROCESSING
// =============================================================================
const CARDMARKET_CONDITION_MAP = {
    MT: "NM", // Mint = NM
    NM: "NM", // Near Mint
    EX: "LP", // Excellent = LP
    GD: "MP", // Good = MP
    LP: "MP", // Light Played = MP (Cardmarket's LP is lower than TCGplayer's)
    PL: "HP", // Played = HP
    PO: "DMG", // Poor = DMG
};
const CARDMARKET_LANGUAGE_MAP = {
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
function extractCardInfo(product) {
    let setCode = product.expansion?.abbreviation || "";
    let cardNumber = product.number || "";
    let variantType = "regular";
    // Detect variant from rarity or name
    const rarityLower = (product.rarity || "").toLowerCase();
    const nameLower = (product.enName || "").toLowerCase();
    if (rarityLower.includes("parallel") || nameLower.includes("parallel")) {
        variantType = "parallel";
    }
    else if (rarityLower.includes("alternate") || nameLower.includes("alternate art")) {
        variantType = "parallel";
    }
    else if (nameLower.includes("manga")) {
        variantType = "manga";
    }
    else if (nameLower.includes("sp") || rarityLower.includes("special")) {
        variantType = "sp";
    }
    return { setCode, cardNumber, variantType };
}
function createPriceEventFromGuide(product, priceGuide, collectedAt) {
    const { setCode, cardNumber, variantType } = extractCardInfo(product);
    if (!setCode || !cardNumber) {
        return null;
    }
    const cardId = (0, utils_1.normalizeCardId)(setCode, cardNumber, variantType);
    // Use trend price as the primary price
    const priceValue = priceGuide.trend || priceGuide.avg || priceGuide.low || 0;
    if (priceValue === 0)
        return null;
    const { priceUsd, priceGbp } = (0, utils_1.normalizePrice)(priceValue, "EUR");
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
function createPriceEventsFromArticles(product, articles, collectedAt) {
    const { setCode, cardNumber, variantType: baseVariant } = extractCardInfo(product);
    if (!setCode || !cardNumber) {
        return [];
    }
    // Group articles by condition and language, get lowest price
    const priceByConditionLanguage = new Map();
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
        }
        else if (existing) {
            existing.count += article.count;
        }
    }
    const events = [];
    for (const [key, data] of priceByConditionLanguage) {
        const [condition, language] = key.split("-");
        const { priceUsd, priceGbp } = (0, utils_1.normalizePrice)(data.price, "EUR");
        // Adjust variant type if foil
        let variantType = baseVariant;
        if (data.article.isFoil && variantType === "regular") {
            variantType = "parallel";
        }
        const cardId = (0, utils_1.normalizeCardId)(setCode, cardNumber, variantType);
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
const handler = async (event) => {
    console.log("Cardmarket collector started", { event });
    const collectedAt = (0, utils_1.nowIso)();
    try {
        // Get API credentials
        const secrets = await (0, utils_1.getSecrets)();
        if (!secrets.cardmarket_app_token || !secrets.cardmarket_app_secret) {
            throw new Error("Cardmarket API credentials not configured");
        }
        const client = new CardmarketClient(secrets.cardmarket_app_token, secrets.cardmarket_app_secret);
        // Get all expansions
        console.log("Fetching expansions...");
        const expansions = await client.getExpansions();
        console.log(`Found ${expansions.length} expansions`);
        const allPriceEvents = [];
        // Process each expansion
        for (const expansion of expansions) {
            if (!expansion.isReleased)
                continue;
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
                                const articleEvents = createPriceEventsFromArticles(product, articles, collectedAt);
                                allPriceEvents.push(...articleEvents);
                            }
                        }
                    }
                    catch (error) {
                        console.warn(`Failed to process product ${product.idProduct}:`, error);
                    }
                }
            }
            catch (error) {
                console.warn(`Failed to process expansion ${expansion.idExpansion}:`, error);
            }
        }
        // Deduplicate by cardId + condition + language
        const uniqueEvents = new Map();
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
            await (0, utils_1.putToKinesis)(PRICE_STREAM, finalEvents);
        }
        // Update DynamoDB
        if (finalEvents.length > 0) {
            await (0, utils_1.batchUpdateCurrentPrices)(CURRENT_PRICES_TABLE, finalEvents);
        }
        // Write to Timestream
        if (finalEvents.length > 0) {
            await (0, utils_1.writePriceToTimestream)(TIMESTREAM_DATABASE, "price_history", finalEvents);
        }
        return {
            statusCode: 200,
            body: JSON.stringify({
                priceEvents: finalEvents.length,
                expansionsProcessed: expansions.length,
                collectedAt,
            }),
        };
    }
    catch (error) {
        console.error("Cardmarket collector error:", error);
        throw error;
    }
};
exports.handler = handler;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY2FyZG1hcmtldC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL2xhbWJkYS9jb2xsZWN0b3JzL2NhcmRtYXJrZXQvY2FyZG1hcmtldC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiO0FBQUE7Ozs7Ozs7R0FPRzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBR0gsK0NBQWlDO0FBQ2pDLDZDQWEyQjtBQUUzQixnRkFBZ0Y7QUFDaEYsZ0JBQWdCO0FBQ2hCLGdGQUFnRjtBQUVoRixNQUFNLG1CQUFtQixHQUFHLG9DQUFvQyxDQUFDO0FBQ2pFLE1BQU0sa0JBQWtCLEdBQUcsQ0FBQyxDQUFDLENBQUMsc0JBQXNCO0FBRXBELE1BQU0sWUFBWSxHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUMsaUJBQWtCLENBQUM7QUFDcEQsTUFBTSxvQkFBb0IsR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLG9CQUFxQixDQUFDO0FBQy9ELE1BQU0sbUJBQW1CLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxtQkFBb0IsQ0FBQztBQUU3RCx3Q0FBd0M7QUFDeEMsTUFBTSxXQUFXLEdBQUcsSUFBSSxtQkFBVyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQztBQTZFMUMsZ0ZBQWdGO0FBQ2hGLDRCQUE0QjtBQUM1QixnRkFBZ0Y7QUFFaEYsTUFBTSxlQUFlO0lBTW5CLFlBQ0UsUUFBZ0IsRUFDaEIsU0FBaUIsRUFDakIsY0FBc0IsRUFBRSxFQUN4QixlQUF1QixFQUFFO1FBRXpCLElBQUksQ0FBQyxRQUFRLEdBQUcsUUFBUSxDQUFDO1FBQ3pCLElBQUksQ0FBQyxTQUFTLEdBQUcsU0FBUyxDQUFDO1FBQzNCLElBQUksQ0FBQyxXQUFXLEdBQUcsV0FBVyxDQUFDO1FBQy9CLElBQUksQ0FBQyxZQUFZLEdBQUcsWUFBWSxDQUFDO0lBQ25DLENBQUM7SUFFRCxpQkFBaUIsQ0FDZixNQUFjLEVBQ2QsR0FBVyxFQUNYLE1BQThCO1FBRTlC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QWUsRUFDZixXQUFXLENBQ1osQ0FBQztRQUNKLENBQUM7UUFFRCxPQUFPO1lBQ0wsVUFBVSxFQUFFLEdBQUc7WUFDZixJQUFJLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQztnQkFDbkIsV0FBVyxFQUFFLFdBQVcsQ0FBQyxNQUFNO2dCQUMvQixtQkFBbUIsRUFBRSxVQUFVLENBQUMsTUFBTTtnQkFDdEMsV0FBVzthQUNaLENBQUM7U0FDSCxDQUFDO0lBQ0osQ0FBQztJQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7UUFDZixPQUFPLENBQUMsS0FBSyxDQUFDLDZCQUE2QixFQUFFLEtBQUssQ0FBQyxDQUFDO1FBQ3BELE1BQU0sS0FBSyxDQUFDO0lBQ2QsQ0FBQztBQUNILENBQUMsQ0FBQztBQXBIVyxRQUFBLE9BQU8sV0FvSGxCIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBDYXJkbWFya2V0IERhdGEgQ29sbGVjdG9yIExhbWJkYVxuICpcbiAqIENvbGxlY3RzIHByaWNlIGRhdGEgZnJvbSB0aGUgQ2FyZG1hcmtldCBBUEkgKEV1cm9wZSdzIGxhcmdlc3QgbWFya2V0cGxhY2UpLlxuICogVXNlcyBPQXV0aCAxLjBhIGZvciBhdXRoZW50aWNhdGlvbi5cbiAqXG4gKiBBUEkgRG9jdW1lbnRhdGlvbjogaHR0cHM6Ly9hcGkuY2FyZG1hcmtldC5jb20vd3MvZG9jdW1lbnRhdGlvblxuICovXG5cbmltcG9ydCB7IEhhbmRsZXIsIFNjaGVkdWxlZEV2ZW50IH0gZnJvbSBcImF3cy1sYW1iZGFcIjtcbmltcG9ydCAqIGFzIGNyeXB0byBmcm9tIFwiY3J5cHRvXCI7XG5pbXBvcnQge1xuICBnZXRTZWNyZXRzLFxuICBwdXRUb0tpbmVzaXMsXG4gIGJhdGNoVXBkYXRlQ3VycmVudFByaWNlcyxcbiAgd3JpdGVQcmljZVRvVGltZXN0cmVhbSxcbiAgbm9ybWFsaXplUHJpY2UsXG4gIG5vcm1hbGl6ZUNhcmRJZCxcbiAgbm9ybWFsaXplQ29uZGl0aW9uLFxuICBSYXRlTGltaXRlcixcbiAgd2l0aFJldHJ5LFxuICBub3dJc28sXG4gIGNodW5rQXJyYXksXG4gIFByaWNlRXZlbnQsXG59IGZyb20gXCIvb3B0L25vZGVqcy91dGlsc1wiO1xuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gQ09ORklHVVJBVElPTlxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuY29uc3QgQ0FSRE1BUktFVF9BUElfQkFTRSA9IFwiaHR0cHM6Ly9hcGkuY2FyZG1hcmtldC5jb20vd3MvdjIuMFwiO1xuY29uc3QgQ0FSRE1BUktFVF9HQU1FX0lEID0gNzsgLy8gT25lIFBpZWNlIENhcmQgR2FtZVxuXG5jb25zdCBQUklDRV9TVFJFQU0gPSBwcm9jZXNzLmVudi5QUklDRV9TVFJFQU1fTkFNRSE7XG5jb25zdCBDVVJSRU5UX1BSSUNFU19UQUJMRSA9IHByb2Nlc3MuZW52LkNVUlJFTlRfUFJJQ0VTX1RBQkxFITtcbmNvbnN0IFRJTUVTVFJFQU1fREFUQUJBU0UgPSBwcm9jZXNzLmVudi5USU1FU1RSRUFNX0RBVEFCQVNFITtcblxuLy8gUmF0ZSBsaW1pdGVyOiAxMDAgcmVxdWVzdHMgcGVyIG1pbnV0ZVxuY29uc3QgcmF0ZUxpbWl0ZXIgPSBuZXcgUmF0ZUxpbWl0ZXIoMiwgMik7XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBUWVBFU1xuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuaW50ZXJmYWNlIENhcmRtYXJrZXRQcm9kdWN0IHtcbiAgaWRQcm9kdWN0OiBudW1iZXI7XG4gIGlkTWV0YXByb2R1Y3Q6IG51bWJlcjtcbiAgY291bnRSZXByaW50czogbnVtYmVyO1xuICBlbk5hbWU6IHN0cmluZztcbiAgbG9jTmFtZTogc3RyaW5nO1xuICBpbWFnZTogc3RyaW5nO1xuICB3ZWJzaXRlOiBzdHJpbmc7XG4gIGdhbWVOYW1lOiBzdHJpbmc7XG4gIGNhdGVnb3J5TmFtZTogc3RyaW5nO1xuICBudW1iZXI6IHN0cmluZztcbiAgcmFyaXR5OiBzdHJpbmc7XG4gIGV4cGFuc2lvbk5hbWU6IHN0cmluZztcbiAgZXhwYW5zaW9uOiB7XG4gICAgaWRFeHBhbnNpb246IG51bWJlcjtcbiAgICBlbk5hbWU6IHN0cmluZztcbiAgICBhYmJyZXZpYXRpb246IHN0cmluZztcbiAgfTtcbn1cblxuaW50ZXJmYWNlIENhcmRtYXJrZXRQcmljZUd1aWRlIHtcbiAgaWRQcm9kdWN0OiBudW1iZXI7XG4gIGF2ZzogbnVtYmVyO1xuICBsb3c6IG51bWJlcjtcbiAgdHJlbmQ6IG51bWJlcjtcbiAgYXZnMTogbnVtYmVyO1xuICBhdmc3OiBudW1iZXI7XG4gIGF2ZzMwOiBudW1iZXI7XG4gIGxvd0ZvaWw6IG51bWJlcjtcbiAgYXZnRm9pbDogbnVtYmVyO1xuICB0cmVuZEZvaWw6IG51bWJlcjtcbn1cblxuaW50ZXJmYWNlIENhcmRtYXJrZXRBcnRpY2xlIHtcbiAgaWRBcnRpY2xlOiBudW1iZXI7XG4gIGlkUHJvZHVjdDogbnVtYmVyO1xuICBsYW5ndWFnZToge1xuICAgIGlkTGFuZ3VhZ2U6IG51bWJlcjtcbiAgICBsYW5ndWFnZU5hbWU6IHN0cmluZztcbiAgfTtcbiAgY29uZGl0aW9uOiBzdHJpbmc7XG4gIGlzRm9pbDogYm9vbGVhbjtcbiAgaXNBbHRlcmVkOiBib29sZWFuO1xuICBpc1NpZ25lZDogYm9vbGVhbjtcbiAgaXNGaXJzdEVkOiBib29sZWFuO1xuICBpc1BsYXlzZXQ6IGJvb2xlYW47XG4gIHByaWNlOiBudW1iZXI7XG4gIGlkQ3VycmVuY3k6IG51bWJlcjtcbiAgY291bnQ6IG51bWJlcjtcbiAgc2VsbGVyOiB7XG4gICAgaWRVc2VyOiBudW1iZXI7XG4gICAgdXNlcm5hbWU6IHN0cmluZztcbiAgICBzZWxsQ291bnQ6IG51bWJlcjtcbiAgICByZXB1dGF0aW9uOiBudW1iZXI7XG4gICAgc2hpcHNGYXN0OiBudW1iZXI7XG4gICAgYWRkcmVzczoge1xuICAgICAgY291bnRyeTogc3RyaW5nO1xuICAgIH07XG4gIH07XG59XG5cbmludGVyZmFjZSBDYXJkbWFya2V0RXhwYW5zaW9uIHtcbiAgaWRFeHBhbnNpb246IG51bWJlcjtcbiAgZW5OYW1lOiBzdHJpbmc7XG4gIGFiYnJldmlhdGlvbjogc3RyaW5nO1xuICByZWxlYXNlRGF0ZTogc3RyaW5nO1xuICBpc1JlbGVhc2VkOiBib29sZWFuO1xuICBpY29uOiBudW1iZXI7XG4gIGlkR2FtZTogbnVtYmVyO1xufVxuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gT0FVVEggMS4wYSBJTVBMRU1FTlRBVElPTlxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuY2xhc3MgQ2FyZG1hcmtldE9BdXRoIHtcbiAgcHJpdmF0ZSBhcHBUb2tlbjogc3RyaW5nO1xuICBwcml2YXRlIGFwcFNlY3JldDogc3RyaW5nO1xuICBwcml2YXRlIGFjY2Vzc1Rva2VuOiBzdHJpbmc7XG4gIHByaXZhdGUgYWNjZXNzU2VjcmV0OiBzdHJpbmc7XG5cbiAgY29uc3RydWN0b3IoXG4gICAgYXBwVG9rZW46IHN0cmluZyxcbiAgICBhcHBTZWNyZXQ6IHN0cmluZyxcbiAgICBhY2Nlc3NUb2tlbjogc3RyaW5nID0gXCJcIixcbiAgICBhY2Nlc3NTZWNyZXQ6IHN0cmluZyA9IFwiXCJcbiAgKSB7XG4gICAgdGhpcy5hcHBUb2tlbiA9IGFwcFRva2VuO1xuICAgIHRoaXMuYXBwU2VjcmV0ID0gYXBwU2VjcmV0O1xuICAgIHRoaXMuYWNjZXNzVG9rZW4gPSBhY2Nlc3NUb2tlbjtcbiAgICB0aGlzLmFjY2Vzc1NlY3JldCA9IGFjY2Vzc1NlY3JldDtcbiAgfVxuXG4gIGdlbmVyYXRlU2lnbmF0dXJlKFxuICAgIG1ldGhvZDogc3RyaW5nLFxuICAgIHVybDogc3RyaW5nLFxuICAgIHBhcmFtczogUmVjb3JkPHN0cmluZywgc3RyaW5nPlxuICApOiBzdHJpbmcge1xuICAgIC8vIENyZWF0ZSBwYXJhbWV0ZXIgc3RyaW5nXG4gICAgY29uc3Qgc29ydGVkUGFyYW1zID0gT2JqZWN0LmtleXMocGFyYW1zKVxuICAgICAgLnNvcnQoKVxuICAgICAgLm1hcCgoa2V5KSA9PiBgJHtrZXl9PSR7ZW5jb2RlVVJJQ29tcG9uZW50KHBhcmFtc1trZXldKX1gKVxuICAgICAgLmpvaW4oXCImXCIpO1xuXG4gICAgLy8gQ3JlYXRlIHNpZ25hdHVyZSBiYXNlIHN0cmluZ1xuICAgIGNvbnN0IHNpZ25hdHVyZUJhc2UgPSBbXG4gICAgICBtZXRob2QudG9VcHBlckNhc2UoKSxcbiAgICAgIGVuY29kZVVSSUNvbXBvbmVudCh1cmwpLFxuICAgICAgZW5jb2RlVVJJQ29tcG9uZW50KHNvcnRlZFBhcmFtcyksXG4gICAgXS5qb2luKFwiJlwiKTtcblxuICAgIC8vIENyZWF0ZSBzaWduaW5nIGtleVxuICAgIGNvbnN0IHNpZ25pbmdLZXkgPSBgJHtlbmNvZGVVUklDb21wb25lbnQodGhpcy5hcHBTZWNyZXQpfSYke2VuY29kZVVSSUNvbXBvbmVudChcbiAgICAgIHRoaXMuYWNjZXNzU2VjcmV0XG4gICAgKX1gO1xuXG4gICAgLy8gR2VuZXJhdGUgSE1BQy1TSEExIHNpZ25hdHVyZVxuICAgIGNvbnN0IHNpZ25hdHVyZSA9IGNyeXB0b1xuICAgICAgLmNyZWF0ZUhtYWMoXCJzaGExXCIsIHNpZ25pbmdLZXkpXG4gICAgICAudXBkYXRlKHNpZ25hdHVyZUJhc2UpXG4gICAgICAuZGlnZXN0KFwiYmFzZTY0XCIpO1xuXG4gICAgcmV0dXJuIHNpZ25hdHVyZTtcbiAgfVxuXG4gIGdlbmVyYXRlQXV0aEhlYWRlcihtZXRob2Q6IHN0cmluZywgdXJsOiBzdHJpbmcpOiBzdHJpbmcge1xuICAgIGNvbnN0IHRpbWVzdGFtcCA9IE1hdGguZmxvb3IoRGF0ZS5ub3coKSAvIDEwMDApLnRvU3RyaW5nKCk7XG4gICAgY29uc3Qgbm9uY2UgPSBjcnlwdG8ucmFuZG9tQnl0ZXMoMTYpLnRvU3RyaW5nKFwiaGV4XCIpO1xuXG4gICAgY29uc3Qgb2F1dGhQYXJhbXM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7XG4gICAgICBvYXV0aF9jb25zdW1lcl9rZXk6IHRoaXMuYXBwVG9rZW4sXG4gICAgICBvYXV0aF9ub25jZTogbm9uY2UsXG4gICAgICBvYXV0aF9zaWduYXR1cmVfbWV0aG9kOiBcIkhNQUMtU0hBMVwiLFxuICAgICAgb2F1dGhfdGltZXN0YW1wOiB0aW1lc3RhbXAsXG4gICAgICBvYXV0aF90b2tlbjogdGhpcy5hY2Nlc3NUb2tlbixcbiAgICAgIG9hdXRoX3ZlcnNpb246IFwiMS4wXCIsXG4gICAgfTtcblxuICAgIC8vIEdlbmVyYXRlIHNpZ25hdHVyZVxuICAgIGNvbnN0IHNpZ25hdHVyZSA9IHRoaXMuZ2VuZXJhdGVTaWduYXR1cmUobWV0aG9kLCB1cmwsIG9hdXRoUGFyYW1zKTtcbiAgICBvYXV0aFBhcmFtcy5vYXV0aF9zaWduYXR1cmUgPSBzaWduYXR1cmU7XG5cbiAgICAvLyBDcmVhdGUgQXV0aG9yaXphdGlvbiBoZWFkZXJcbiAgICBjb25zdCBhdXRoSGVhZGVyID0gT2JqZWN0LmtleXMob2F1dGhQYXJhbXMpXG4gICAgICAuc29ydCgpXG4gICAgICAubWFwKChrZXkpID0+IGAke2tleX09XCIke2VuY29kZVVSSUNvbXBvbmVudChvYXV0aFBhcmFtc1trZXldKX1cImApXG4gICAgICAuam9pbihcIiwgXCIpO1xuXG4gICAgcmV0dXJuIGBPQXV0aCByZWFsbT1cIiR7dXJsfVwiLCAke2F1dGhIZWFkZXJ9YDtcbiAgfVxufVxuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gQVBJIENMSUVOVFxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuY2xhc3MgQ2FyZG1hcmtldENsaWVudCB7XG4gIHByaXZhdGUgb2F1dGg6IENhcmRtYXJrZXRPQXV0aDtcblxuICBjb25zdHJ1Y3RvcihhcHBUb2tlbjogc3RyaW5nLCBhcHBTZWNyZXQ6IHN0cmluZykge1xuICAgIHRoaXMub2F1dGggPSBuZXcgQ2FyZG1hcmtldE9BdXRoKGFwcFRva2VuLCBhcHBTZWNyZXQpO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyByZXF1ZXN0PFQ+KFxuICAgIGVuZHBvaW50OiBzdHJpbmcsXG4gICAgbWV0aG9kOiBzdHJpbmcgPSBcIkdFVFwiXG4gICk6IFByb21pc2U8VD4ge1xuICAgIGF3YWl0IHJhdGVMaW1pdGVyLmFjcXVpcmUoKTtcblxuICAgIGNvbnN0IHVybCA9IGAke0NBUkRNQVJLRVRfQVBJX0JBU0V9JHtlbmRwb2ludH1gO1xuICAgIGNvbnN0IGF1dGhIZWFkZXIgPSB0aGlzLm9hdXRoLmdlbmVyYXRlQXV0aEhlYWRlcihtZXRob2QsIHVybCk7XG5cbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHdpdGhSZXRyeShhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCByZXMgPSBhd2FpdCBmZXRjaCh1cmwsIHtcbiAgICAgICAgbWV0aG9kLFxuICAgICAgICBoZWFkZXJzOiB7XG4gICAgICAgICAgQXV0aG9yaXphdGlvbjogYXV0aEhlYWRlcixcbiAgICAgICAgICBBY2NlcHQ6IFwiYXBwbGljYXRpb24vanNvblwiLFxuICAgICAgICB9LFxuICAgICAgfSk7XG5cbiAgICAgIGlmICghcmVzLm9rKSB7XG4gICAgICAgIGlmIChyZXMuc3RhdHVzID09PSA0MjkpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJSYXRlIGxpbWl0ZWRcIik7XG4gICAgICAgIH1cbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBIVFRQICR7cmVzLnN0YXR1c306ICR7YXdhaXQgcmVzLnRleHQoKX1gKTtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHJlcy5qc29uKCk7XG4gICAgfSk7XG5cbiAgICByZXR1cm4gcmVzcG9uc2U7XG4gIH1cblxuICAvKipcbiAgICogR2V0IGFsbCBleHBhbnNpb25zIChzZXRzKSBmb3IgT25lIFBpZWNlXG4gICAqL1xuICBhc3luYyBnZXRFeHBhbnNpb25zKCk6IFByb21pc2U8Q2FyZG1hcmtldEV4cGFuc2lvbltdPiB7XG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCB0aGlzLnJlcXVlc3Q8eyBleHBhbnNpb246IENhcmRtYXJrZXRFeHBhbnNpb25bXSB9PihcbiAgICAgIGAvZ2FtZXMvJHtDQVJETUFSS0VUX0dBTUVfSUR9L2V4cGFuc2lvbnNgXG4gICAgKTtcbiAgICByZXR1cm4gcmVzcG9uc2UuZXhwYW5zaW9uIHx8IFtdO1xuICB9XG5cbiAgLyoqXG4gICAqIEdldCBwcm9kdWN0cyBpbiBhbiBleHBhbnNpb25cbiAgICovXG4gIGFzeW5jIGdldFByb2R1Y3RzQnlFeHBhbnNpb24oZXhwYW5zaW9uSWQ6IG51bWJlcik6IFByb21pc2U8Q2FyZG1hcmtldFByb2R1Y3RbXT4ge1xuICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgdGhpcy5yZXF1ZXN0PHsgcHJvZHVjdDogQ2FyZG1hcmtldFByb2R1Y3RbXSB9PihcbiAgICAgIGAvZXhwYW5zaW9ucy8ke2V4cGFuc2lvbklkfS9zaW5nbGVzYFxuICAgICk7XG4gICAgcmV0dXJuIHJlc3BvbnNlLnByb2R1Y3QgfHwgW107XG4gIH1cblxuICAvKipcbiAgICogR2V0IHByaWNlIGd1aWRlIGZvciBhIHByb2R1Y3RcbiAgICovXG4gIGFzeW5jIGdldFByaWNlR3VpZGUocHJvZHVjdElkOiBudW1iZXIpOiBQcm9taXNlPENhcmRtYXJrZXRQcmljZUd1aWRlIHwgbnVsbD4ge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHRoaXMucmVxdWVzdDx7IHByaWNlR3VpZGU6IENhcmRtYXJrZXRQcmljZUd1aWRlIH0+KFxuICAgICAgICBgL3Byb2R1Y3RzLyR7cHJvZHVjdElkfS9wcmljZUd1aWRlYFxuICAgICAgKTtcbiAgICAgIHJldHVybiByZXNwb25zZS5wcmljZUd1aWRlO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBjb25zb2xlLndhcm4oYEZhaWxlZCB0byBnZXQgcHJpY2UgZ3VpZGUgZm9yIHByb2R1Y3QgJHtwcm9kdWN0SWR9OmAsIGVycm9yKTtcbiAgICAgIHJldHVybiBudWxsO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBHZXQgYXJ0aWNsZXMgKGxpc3RpbmdzKSBmb3IgYSBwcm9kdWN0XG4gICAqL1xuICBhc3luYyBnZXRBcnRpY2xlcyhcbiAgICBwcm9kdWN0SWQ6IG51bWJlcixcbiAgICBvcHRpb25zOiB7XG4gICAgICBzdGFydD86IG51bWJlcjtcbiAgICAgIG1heFJlc3VsdHM/OiBudW1iZXI7XG4gICAgICBtaW5Db25kaXRpb24/OiBzdHJpbmc7XG4gICAgfSA9IHt9XG4gICk6IFByb21pc2U8Q2FyZG1hcmtldEFydGljbGVbXT4ge1xuICAgIGNvbnN0IHBhcmFtcyA9IG5ldyBVUkxTZWFyY2hQYXJhbXMoKTtcbiAgICBpZiAob3B0aW9ucy5zdGFydCkgcGFyYW1zLnNldChcInN0YXJ0XCIsIG9wdGlvbnMuc3RhcnQudG9TdHJpbmcoKSk7XG4gICAgaWYgKG9wdGlvbnMubWF4UmVzdWx0cykgcGFyYW1zLnNldChcIm1heFJlc3VsdHNcIiwgb3B0aW9ucy5tYXhSZXN1bHRzLnRvU3RyaW5nKCkpO1xuICAgIGlmIChvcHRpb25zLm1pbkNvbmRpdGlvbikgcGFyYW1zLnNldChcIm1pbkNvbmRpdGlvblwiLCBvcHRpb25zLm1pbkNvbmRpdGlvbik7XG5cbiAgICBjb25zdCBxdWVyeSA9IHBhcmFtcy50b1N0cmluZygpID8gYD8ke3BhcmFtcy50b1N0cmluZygpfWAgOiBcIlwiO1xuXG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCB0aGlzLnJlcXVlc3Q8eyBhcnRpY2xlOiBDYXJkbWFya2V0QXJ0aWNsZVtdIH0+KFxuICAgICAgYC9hcnRpY2xlcy8ke3Byb2R1Y3RJZH0ke3F1ZXJ5fWBcbiAgICApO1xuICAgIHJldHVybiByZXNwb25zZS5hcnRpY2xlIHx8IFtdO1xuICB9XG5cbiAgLyoqXG4gICAqIFNlYXJjaCBmb3IgcHJvZHVjdHNcbiAgICovXG4gIGFzeW5jIHNlYXJjaFByb2R1Y3RzKHF1ZXJ5OiBzdHJpbmcpOiBQcm9taXNlPENhcmRtYXJrZXRQcm9kdWN0W10+IHtcbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHRoaXMucmVxdWVzdDx7IHByb2R1Y3Q6IENhcmRtYXJrZXRQcm9kdWN0W10gfT4oXG4gICAgICBgL3Byb2R1Y3RzL2ZpbmQ/c2VhcmNoPSR7ZW5jb2RlVVJJQ29tcG9uZW50KHF1ZXJ5KX0maWRHYW1lPSR7Q0FSRE1BUktFVF9HQU1FX0lEfWBcbiAgICApO1xuICAgIHJldHVybiByZXNwb25zZS5wcm9kdWN0IHx8IFtdO1xuICB9XG59XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBEQVRBIFBST0NFU1NJTkdcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbmNvbnN0IENBUkRNQVJLRVRfQ09ORElUSU9OX01BUDogUmVjb3JkPHN0cmluZywgc3RyaW5nPiA9IHtcbiAgTVQ6IFwiTk1cIiwgLy8gTWludCA9IE5NXG4gIE5NOiBcIk5NXCIsIC8vIE5lYXIgTWludFxuICBFWDogXCJMUFwiLCAvLyBFeGNlbGxlbnQgPSBMUFxuICBHRDogXCJNUFwiLCAvLyBHb29kID0gTVBcbiAgTFA6IFwiTVBcIiwgLy8gTGlnaHQgUGxheWVkID0gTVAgKENhcmRtYXJrZXQncyBMUCBpcyBsb3dlciB0aGFuIFRDR3BsYXllcidzKVxuICBQTDogXCJIUFwiLCAvLyBQbGF5ZWQgPSBIUFxuICBQTzogXCJETUdcIiwgLy8gUG9vciA9IERNR1xufTtcblxuY29uc3QgQ0FSRE1BUktFVF9MQU5HVUFHRV9NQVA6IFJlY29yZDxudW1iZXIsIHN0cmluZz4gPSB7XG4gIDE6IFwiRU5cIiwgLy8gRW5nbGlzaFxuICAyOiBcIkZSXCIsIC8vIEZyZW5jaFxuICAzOiBcIkRFXCIsIC8vIEdlcm1hblxuICA0OiBcIkVTXCIsIC8vIFNwYW5pc2hcbiAgNTogXCJJVFwiLCAvLyBJdGFsaWFuXG4gIDY6IFwiSlBcIiwgLy8gSmFwYW5lc2VcbiAgNzogXCJQVFwiLCAvLyBQb3J0dWd1ZXNlXG4gIDg6IFwiUlVcIiwgLy8gUnVzc2lhblxuICA5OiBcIktPXCIsIC8vIEtvcmVhblxuICAxMDogXCJaSFwiLCAvLyBDaGluZXNlXG59O1xuXG5mdW5jdGlvbiBleHRyYWN0Q2FyZEluZm8ocHJvZHVjdDogQ2FyZG1hcmtldFByb2R1Y3QpOiB7XG4gIHNldENvZGU6IHN0cmluZztcbiAgY2FyZE51bWJlcjogc3RyaW5nO1xuICB2YXJpYW50VHlwZTogc3RyaW5nO1xufSB7XG4gIGxldCBzZXRDb2RlID0gcHJvZHVjdC5leHBhbnNpb24/LmFiYnJldmlhdGlvbiB8fCBcIlwiO1xuICBsZXQgY2FyZE51bWJlciA9IHByb2R1Y3QubnVtYmVyIHx8IFwiXCI7XG4gIGxldCB2YXJpYW50VHlwZSA9IFwicmVndWxhclwiO1xuXG4gIC8vIERldGVjdCB2YXJpYW50IGZyb20gcmFyaXR5IG9yIG5hbWVcbiAgY29uc3QgcmFyaXR5TG93ZXIgPSAocHJvZHVjdC5yYXJpdHkgfHwgXCJcIikudG9Mb3dlckNhc2UoKTtcbiAgY29uc3QgbmFtZUxvd2VyID0gKHByb2R1Y3QuZW5OYW1lIHx8IFwiXCIpLnRvTG93ZXJDYXNlKCk7XG5cbiAgaWYgKHJhcml0eUxvd2VyLmluY2x1ZGVzKFwicGFyYWxsZWxcIikgfHwgbmFtZUxvd2VyLmluY2x1ZGVzKFwicGFyYWxsZWxcIikpIHtcbiAgICB2YXJpYW50VHlwZSA9IFwicGFyYWxsZWxcIjtcbiAgfSBlbHNlIGlmIChyYXJpdHlMb3dlci5pbmNsdWRlcyhcImFsdGVybmF0ZVwiKSB8fCBuYW1lTG93ZXIuaW5jbHVkZXMoXCJhbHRlcm5hdGUgYXJ0XCIpKSB7XG4gICAgdmFyaWFudFR5cGUgPSBcInBhcmFsbGVsXCI7XG4gIH0gZWxzZSBpZiAobmFtZUxvd2VyLmluY2x1ZGVzKFwibWFuZ2FcIikpIHtcbiAgICB2YXJpYW50VHlwZSA9IFwibWFuZ2FcIjtcbiAgfSBlbHNlIGlmIChuYW1lTG93ZXIuaW5jbHVkZXMoXCJzcFwiKSB8fCByYXJpdHlMb3dlci5pbmNsdWRlcyhcInNwZWNpYWxcIikpIHtcbiAgICB2YXJpYW50VHlwZSA9IFwic3BcIjtcbiAgfVxuXG4gIHJldHVybiB7IHNldENvZGUsIGNhcmROdW1iZXIsIHZhcmlhbnRUeXBlIH07XG59XG5cbmZ1bmN0aW9uIGNyZWF0ZVByaWNlRXZlbnRGcm9tR3VpZGUoXG4gIHByb2R1Y3Q6IENhcmRtYXJrZXRQcm9kdWN0LFxuICBwcmljZUd1aWRlOiBDYXJkbWFya2V0UHJpY2VHdWlkZSxcbiAgY29sbGVjdGVkQXQ6IHN0cmluZ1xuKTogUHJpY2VFdmVudCB8IG51bGwge1xuICBjb25zdCB7IHNldENvZGUsIGNhcmROdW1iZXIsIHZhcmlhbnRUeXBlIH0gPSBleHRyYWN0Q2FyZEluZm8ocHJvZHVjdCk7XG5cbiAgaWYgKCFzZXRDb2RlIHx8ICFjYXJkTnVtYmVyKSB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICBjb25zdCBjYXJkSWQgPSBub3JtYWxpemVDYXJkSWQoc2V0Q29kZSwgY2FyZE51bWJlciwgdmFyaWFudFR5cGUpO1xuXG4gIC8vIFVzZSB0cmVuZCBwcmljZSBhcyB0aGUgcHJpbWFyeSBwcmljZVxuICBjb25zdCBwcmljZVZhbHVlID0gcHJpY2VHdWlkZS50cmVuZCB8fCBwcmljZUd1aWRlLmF2ZyB8fCBwcmljZUd1aWRlLmxvdyB8fCAwO1xuICBpZiAocHJpY2VWYWx1ZSA9PT0gMCkgcmV0dXJuIG51bGw7XG5cbiAgY29uc3QgeyBwcmljZVVzZCwgcHJpY2VHYnAgfSA9IG5vcm1hbGl6ZVByaWNlKHByaWNlVmFsdWUsIFwiRVVSXCIpO1xuXG4gIHJldHVybiB7XG4gICAgZXZlbnRUeXBlOiBcInByaWNlXCIsXG4gICAgc291cmNlOiBcImNhcmRtYXJrZXRcIixcbiAgICBjYXJkSWQsXG4gICAgZXh0ZXJuYWxJZDogcHJvZHVjdC5pZFByb2R1Y3QudG9TdHJpbmcoKSxcbiAgICBuYW1lOiBwcm9kdWN0LmVuTmFtZSxcbiAgICBzZXRDb2RlLFxuICAgIGNhcmROdW1iZXIsXG4gICAgdmFyaWFudFR5cGUsXG4gICAgY29uZGl0aW9uOiBcIk5NXCIsIC8vIFByaWNlIGd1aWRlIGlzIGZvciBOTSBjb25kaXRpb25cbiAgICBsYW5ndWFnZTogXCJFTlwiLFxuICAgIHByaWNlOiBwcmljZVZhbHVlLFxuICAgIGN1cnJlbmN5OiBcIkVVUlwiLFxuICAgIHByaWNlVXNkLFxuICAgIHByaWNlR2JwLFxuICAgIGxpc3RpbmdzQ291bnQ6IHVuZGVmaW5lZCxcbiAgICB0aW1lc3RhbXA6IGNvbGxlY3RlZEF0LFxuICAgIGNvbGxlY3RlZEF0LFxuICB9O1xufVxuXG5mdW5jdGlvbiBjcmVhdGVQcmljZUV2ZW50c0Zyb21BcnRpY2xlcyhcbiAgcHJvZHVjdDogQ2FyZG1hcmtldFByb2R1Y3QsXG4gIGFydGljbGVzOiBDYXJkbWFya2V0QXJ0aWNsZVtdLFxuICBjb2xsZWN0ZWRBdDogc3RyaW5nXG4pOiBQcmljZUV2ZW50W10ge1xuICBjb25zdCB7IHNldENvZGUsIGNhcmROdW1iZXIsIHZhcmlhbnRUeXBlOiBiYXNlVmFyaWFudCB9ID0gZXh0cmFjdENhcmRJbmZvKHByb2R1Y3QpO1xuXG4gIGlmICghc2V0Q29kZSB8fCAhY2FyZE51bWJlcikge1xuICAgIHJldHVybiBbXTtcbiAgfVxuXG4gIC8vIEdyb3VwIGFydGljbGVzIGJ5IGNvbmRpdGlvbiBhbmQgbGFuZ3VhZ2UsIGdldCBsb3dlc3QgcHJpY2VcbiAgY29uc3QgcHJpY2VCeUNvbmRpdGlvbkxhbmd1YWdlID0gbmV3IE1hcDxzdHJpbmcsIHtcbiAgICBwcmljZTogbnVtYmVyO1xuICAgIGNvdW50OiBudW1iZXI7XG4gICAgYXJ0aWNsZTogQ2FyZG1hcmtldEFydGljbGU7XG4gIH0+KCk7XG5cbiAgZm9yIChjb25zdCBhcnRpY2xlIG9mIGFydGljbGVzKSB7XG4gICAgY29uc3QgY29uZGl0aW9uID0gQ0FSRE1BUktFVF9DT05ESVRJT05fTUFQW2FydGljbGUuY29uZGl0aW9uXSB8fCBcIk5NXCI7XG4gICAgY29uc3QgbGFuZ3VhZ2UgPSBDQVJETUFSS0VUX0xBTkdVQUdFX01BUFthcnRpY2xlLmxhbmd1YWdlLmlkTGFuZ3VhZ2VdIHx8IFwiRU5cIjtcbiAgICBjb25zdCBrZXkgPSBgJHtjb25kaXRpb259LSR7bGFuZ3VhZ2V9YDtcblxuICAgIGNvbnN0IGV4aXN0aW5nID0gcHJpY2VCeUNvbmRpdGlvbkxhbmd1YWdlLmdldChrZXkpO1xuICAgIGlmICghZXhpc3RpbmcgfHwgYXJ0aWNsZS5wcmljZSA8IGV4aXN0aW5nLnByaWNlKSB7XG4gICAgICBwcmljZUJ5Q29uZGl0aW9uTGFuZ3VhZ2Uuc2V0KGtleSwge1xuICAgICAgICBwcmljZTogYXJ0aWNsZS5wcmljZSxcbiAgICAgICAgY291bnQ6IGFydGljbGUuY291bnQsXG4gICAgICAgIGFydGljbGUsXG4gICAgICB9KTtcbiAgICB9IGVsc2UgaWYgKGV4aXN0aW5nKSB7XG4gICAgICBleGlzdGluZy5jb3VudCArPSBhcnRpY2xlLmNvdW50O1xuICAgIH1cbiAgfVxuXG4gIGNvbnN0IGV2ZW50czogUHJpY2VFdmVudFtdID0gW107XG5cbiAgZm9yIChjb25zdCBba2V5LCBkYXRhXSBvZiBwcmljZUJ5Q29uZGl0aW9uTGFuZ3VhZ2UpIHtcbiAgICBjb25zdCBbY29uZGl0aW9uLCBsYW5ndWFnZV0gPSBrZXkuc3BsaXQoXCItXCIpO1xuICAgIGNvbnN0IHsgcHJpY2VVc2QsIHByaWNlR2JwIH0gPSBub3JtYWxpemVQcmljZShkYXRhLnByaWNlLCBcIkVVUlwiKTtcblxuICAgIC8vIEFkanVzdCB2YXJpYW50IHR5cGUgaWYgZm9pbFxuICAgIGxldCB2YXJpYW50VHlwZSA9IGJhc2VWYXJpYW50O1xuICAgIGlmIChkYXRhLmFydGljbGUuaXNGb2lsICYmIHZhcmlhbnRUeXBlID09PSBcInJlZ3VsYXJcIikge1xuICAgICAgdmFyaWFudFR5cGUgPSBcInBhcmFsbGVsXCI7XG4gICAgfVxuXG4gICAgY29uc3QgY2FyZElkID0gbm9ybWFsaXplQ2FyZElkKHNldENvZGUsIGNhcmROdW1iZXIsIHZhcmlhbnRUeXBlKTtcblxuICAgIGV2ZW50cy5wdXNoKHtcbiAgICAgIGV2ZW50VHlwZTogXCJwcmljZVwiLFxuICAgICAgc291cmNlOiBcImNhcmRtYXJrZXRcIixcbiAgICAgIGNhcmRJZCxcbiAgICAgIGV4dGVybmFsSWQ6IHByb2R1Y3QuaWRQcm9kdWN0LnRvU3RyaW5nKCksXG4gICAgICBuYW1lOiBwcm9kdWN0LmVuTmFtZSxcbiAgICAgIHNldENvZGUsXG4gICAgICBjYXJkTnVtYmVyLFxuICAgICAgdmFyaWFudFR5cGUsXG4gICAgICBjb25kaXRpb24sXG4gICAgICBsYW5ndWFnZSxcbiAgICAgIHByaWNlOiBkYXRhLnByaWNlLFxuICAgICAgY3VycmVuY3k6IFwiRVVSXCIsXG4gICAgICBwcmljZVVzZCxcbiAgICAgIHByaWNlR2JwLFxuICAgICAgbGlzdGluZ3NDb3VudDogZGF0YS5jb3VudCxcbiAgICAgIHNlbGxlcklkOiBkYXRhLmFydGljbGUuc2VsbGVyLnVzZXJuYW1lLFxuICAgICAgdGltZXN0YW1wOiBjb2xsZWN0ZWRBdCxcbiAgICAgIGNvbGxlY3RlZEF0LFxuICAgIH0pO1xuICB9XG5cbiAgcmV0dXJuIGV2ZW50cztcbn1cblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIE1BSU4gSEFORExFUlxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuZXhwb3J0IGNvbnN0IGhhbmRsZXI6IEhhbmRsZXI8U2NoZWR1bGVkRXZlbnQ+ID0gYXN5bmMgKGV2ZW50KSA9PiB7XG4gIGNvbnNvbGUubG9nKFwiQ2FyZG1hcmtldCBjb2xsZWN0b3Igc3RhcnRlZFwiLCB7IGV2ZW50IH0pO1xuICBjb25zdCBjb2xsZWN0ZWRBdCA9IG5vd0lzbygpO1xuXG4gIHRyeSB7XG4gICAgLy8gR2V0IEFQSSBjcmVkZW50aWFsc1xuICAgIGNvbnN0IHNlY3JldHMgPSBhd2FpdCBnZXRTZWNyZXRzKCk7XG4gICAgaWYgKCFzZWNyZXRzLmNhcmRtYXJrZXRfYXBwX3Rva2VuIHx8ICFzZWNyZXRzLmNhcmRtYXJrZXRfYXBwX3NlY3JldCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQ2FyZG1hcmtldCBBUEkgY3JlZGVudGlhbHMgbm90IGNvbmZpZ3VyZWRcIik7XG4gICAgfVxuXG4gICAgY29uc3QgY2xpZW50ID0gbmV3IENhcmRtYXJrZXRDbGllbnQoXG4gICAgICBzZWNyZXRzLmNhcmRtYXJrZXRfYXBwX3Rva2VuLFxuICAgICAgc2VjcmV0cy5jYXJkbWFya2V0X2FwcF9zZWNyZXRcbiAgICApO1xuXG4gICAgLy8gR2V0IGFsbCBleHBhbnNpb25zXG4gICAgY29uc29sZS5sb2coXCJGZXRjaGluZyBleHBhbnNpb25zLi4uXCIpO1xuICAgIGNvbnN0IGV4cGFuc2lvbnMgPSBhd2FpdCBjbGllbnQuZ2V0RXhwYW5zaW9ucygpO1xuICAgIGNvbnNvbGUubG9nKGBGb3VuZCAke2V4cGFuc2lvbnMubGVuZ3RofSBleHBhbnNpb25zYCk7XG5cbiAgICBjb25zdCBhbGxQcmljZUV2ZW50czogUHJpY2VFdmVudFtdID0gW107XG5cbiAgICAvLyBQcm9jZXNzIGVhY2ggZXhwYW5zaW9uXG4gICAgZm9yIChjb25zdCBleHBhbnNpb24gb2YgZXhwYW5zaW9ucykge1xuICAgICAgaWYgKCFleHBhbnNpb24uaXNSZWxlYXNlZCkgY29udGludWU7XG5cbiAgICAgIGNvbnNvbGUubG9nKGBQcm9jZXNzaW5nIGV4cGFuc2lvbjogJHtleHBhbnNpb24uZW5OYW1lfSAoJHtleHBhbnNpb24uYWJicmV2aWF0aW9ufSlgKTtcblxuICAgICAgdHJ5IHtcbiAgICAgICAgLy8gR2V0IHByb2R1Y3RzIGluIGV4cGFuc2lvblxuICAgICAgICBjb25zdCBwcm9kdWN0cyA9IGF3YWl0IGNsaWVudC5nZXRQcm9kdWN0c0J5RXhwYW5zaW9uKGV4cGFuc2lvbi5pZEV4cGFuc2lvbik7XG4gICAgICAgIGNvbnNvbGUubG9nKGAgIEZvdW5kICR7cHJvZHVjdHMubGVuZ3RofSBwcm9kdWN0c2ApO1xuXG4gICAgICAgIC8vIEdldCBwcmljZSBndWlkZSBhbmQgYXJ0aWNsZXMgZm9yIGVhY2ggcHJvZHVjdFxuICAgICAgICBmb3IgKGNvbnN0IHByb2R1Y3Qgb2YgcHJvZHVjdHMpIHtcbiAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgLy8gR2V0IHByaWNlIGd1aWRlXG4gICAgICAgICAgICBjb25zdCBwcmljZUd1aWRlID0gYXdhaXQgY2xpZW50LmdldFByaWNlR3VpZGUocHJvZHVjdC5pZFByb2R1Y3QpO1xuICAgICAgICAgICAgaWYgKHByaWNlR3VpZGUpIHtcbiAgICAgICAgICAgICAgY29uc3QgcHJpY2VFdmVudCA9IGNyZWF0ZVByaWNlRXZlbnRGcm9tR3VpZGUocHJvZHVjdCwgcHJpY2VHdWlkZSwgY29sbGVjdGVkQXQpO1xuICAgICAgICAgICAgICBpZiAocHJpY2VFdmVudCkge1xuICAgICAgICAgICAgICAgIGFsbFByaWNlRXZlbnRzLnB1c2gocHJpY2VFdmVudCk7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgLy8gR2V0IGFydGljbGVzIGZvciBtb3JlIGRldGFpbGVkIHByaWNpbmdcbiAgICAgICAgICAgIC8vIExpbWl0IHRvIGF2b2lkIHJhdGUgbGltaXRzXG4gICAgICAgICAgICBpZiAoYWxsUHJpY2VFdmVudHMubGVuZ3RoIDwgMTAwMCkge1xuICAgICAgICAgICAgICBjb25zdCBhcnRpY2xlcyA9IGF3YWl0IGNsaWVudC5nZXRBcnRpY2xlcyhwcm9kdWN0LmlkUHJvZHVjdCwge1xuICAgICAgICAgICAgICAgIG1heFJlc3VsdHM6IDUwLFxuICAgICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgICBpZiAoYXJ0aWNsZXMubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgICAgIGNvbnN0IGFydGljbGVFdmVudHMgPSBjcmVhdGVQcmljZUV2ZW50c0Zyb21BcnRpY2xlcyhcbiAgICAgICAgICAgICAgICAgIHByb2R1Y3QsXG4gICAgICAgICAgICAgICAgICBhcnRpY2xlcyxcbiAgICAgICAgICAgICAgICAgIGNvbGxlY3RlZEF0XG4gICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgICAgICBhbGxQcmljZUV2ZW50cy5wdXNoKC4uLmFydGljbGVFdmVudHMpO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgIGNvbnNvbGUud2FybihgRmFpbGVkIHRvIHByb2Nlc3MgcHJvZHVjdCAke3Byb2R1Y3QuaWRQcm9kdWN0fTpgLCBlcnJvcik7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBjb25zb2xlLndhcm4oYEZhaWxlZCB0byBwcm9jZXNzIGV4cGFuc2lvbiAke2V4cGFuc2lvbi5pZEV4cGFuc2lvbn06YCwgZXJyb3IpO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIERlZHVwbGljYXRlIGJ5IGNhcmRJZCArIGNvbmRpdGlvbiArIGxhbmd1YWdlXG4gICAgY29uc3QgdW5pcXVlRXZlbnRzID0gbmV3IE1hcDxzdHJpbmcsIFByaWNlRXZlbnQ+KCk7XG4gICAgZm9yIChjb25zdCBldmVudCBvZiBhbGxQcmljZUV2ZW50cykge1xuICAgICAgY29uc3Qga2V5ID0gYCR7ZXZlbnQuY2FyZElkfS0ke2V2ZW50LmNvbmRpdGlvbn0tJHtldmVudC5sYW5ndWFnZX1gO1xuICAgICAgY29uc3QgZXhpc3RpbmcgPSB1bmlxdWVFdmVudHMuZ2V0KGtleSk7XG4gICAgICAvLyBLZWVwIGxvd2VzdCBwcmljZVxuICAgICAgaWYgKCFleGlzdGluZyB8fCBldmVudC5wcmljZVVzZCA8IGV4aXN0aW5nLnByaWNlVXNkKSB7XG4gICAgICAgIHVuaXF1ZUV2ZW50cy5zZXQoa2V5LCBldmVudCk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgY29uc3QgZmluYWxFdmVudHMgPSBBcnJheS5mcm9tKHVuaXF1ZUV2ZW50cy52YWx1ZXMoKSk7XG4gICAgY29uc29sZS5sb2coYENvbGxlY3RlZCAke2ZpbmFsRXZlbnRzLmxlbmd0aH0gdW5pcXVlIHByaWNlIGV2ZW50c2ApO1xuXG4gICAgLy8gU2VuZCB0byBLaW5lc2lzXG4gICAgaWYgKGZpbmFsRXZlbnRzLmxlbmd0aCA+IDApIHtcbiAgICAgIGF3YWl0IHB1dFRvS2luZXNpcyhQUklDRV9TVFJFQU0sIGZpbmFsRXZlbnRzKTtcbiAgICB9XG5cbiAgICAvLyBVcGRhdGUgRHluYW1vREJcbiAgICBpZiAoZmluYWxFdmVudHMubGVuZ3RoID4gMCkge1xuICAgICAgYXdhaXQgYmF0Y2hVcGRhdGVDdXJyZW50UHJpY2VzKENVUlJFTlRfUFJJQ0VTX1RBQkxFLCBmaW5hbEV2ZW50cyk7XG4gICAgfVxuXG4gICAgLy8gV3JpdGUgdG8gVGltZXN0cmVhbVxuICAgIGlmIChmaW5hbEV2ZW50cy5sZW5ndGggPiAwKSB7XG4gICAgICBhd2FpdCB3cml0ZVByaWNlVG9UaW1lc3RyZWFtKFxuICAgICAgICBUSU1FU1RSRUFNX0RBVEFCQVNFLFxuICAgICAgICBcInByaWNlX2hpc3RvcnlcIixcbiAgICAgICAgZmluYWxFdmVudHNcbiAgICAgICk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIHN0YXR1c0NvZGU6IDIwMCxcbiAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgcHJpY2VFdmVudHM6IGZpbmFsRXZlbnRzLmxlbmd0aCxcbiAgICAgICAgZXhwYW5zaW9uc1Byb2Nlc3NlZDogZXhwYW5zaW9ucy5sZW5ndGgsXG4gICAgICAgIGNvbGxlY3RlZEF0LFxuICAgICAgfSksXG4gICAgfTtcbiAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICBjb25zb2xlLmVycm9yKFwiQ2FyZG1hcmtldCBjb2xsZWN0b3IgZXJyb3I6XCIsIGVycm9yKTtcbiAgICB0aHJvdyBlcnJvcjtcbiAgfVxufTtcbiJdfQ==