"use strict";
/**
 * Shared utilities for data pipeline Lambda functions
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.dataQualityTracker = exports.RateLimiter = void 0;
exports.getSecrets = getSecrets;
exports.putToKinesis = putToKinesis;
exports.updateCurrentPrice = updateCurrentPrice;
exports.batchUpdateCurrentPrices = batchUpdateCurrentPrices;
exports.recordArbitrageOpportunity = recordArbitrageOpportunity;
exports.getCardFromCatalog = getCardFromCatalog;
exports.writePriceToTimestream = writePriceToTimestream;
exports.fetchLiveFxRates = fetchLiveFxRates;
exports.getFxRates = getFxRates;
exports.convertToUsd = convertToUsd;
exports.convertToGbp = convertToGbp;
exports.normalizePrice = normalizePrice;
exports.normalizePriceAsync = normalizePriceAsync;
exports.normalizeCardId = normalizeCardId;
exports.parseCardNumber = parseCardNumber;
exports.normalizeConditionWithTracking = normalizeConditionWithTracking;
exports.normalizeCondition = normalizeCondition;
exports.withRetry = withRetry;
exports.chunkArray = chunkArray;
exports.sleep = sleep;
exports.nowIso = nowIso;
exports.sanitizeString = sanitizeString;
exports.fuzzyMatchCard = fuzzyMatchCard;
exports.detectVariantType = detectVariantType;
exports.calculateSellerReputation = calculateSellerReputation;
exports.getSellerWeightFactor = getSellerWeightFactor;
const client_kinesis_1 = require("@aws-sdk/client-kinesis");
const client_dynamodb_1 = require("@aws-sdk/client-dynamodb");
const client_secrets_manager_1 = require("@aws-sdk/client-secrets-manager");
const client_timestream_write_1 = require("@aws-sdk/client-timestream-write");
const util_dynamodb_1 = require("@aws-sdk/util-dynamodb");
// =============================================================================
// CLIENTS
// =============================================================================
const kinesisClient = new client_kinesis_1.KinesisClient({});
const dynamoClient = new client_dynamodb_1.DynamoDBClient({});
const secretsClient = new client_secrets_manager_1.SecretsManagerClient({});
const timestreamClient = new client_timestream_write_1.TimestreamWriteClient({});
// =============================================================================
// SECRETS
// =============================================================================
let cachedSecrets = null;
async function getSecrets() {
    if (cachedSecrets)
        return cachedSecrets;
    const secretArn = process.env.SECRETS_ARN;
    if (!secretArn) {
        throw new Error("SECRETS_ARN environment variable not set");
    }
    const response = await secretsClient.send(new client_secrets_manager_1.GetSecretValueCommand({ SecretId: secretArn }));
    if (!response.SecretString) {
        throw new Error("Secret value is empty");
    }
    cachedSecrets = JSON.parse(response.SecretString);
    return cachedSecrets;
}
// =============================================================================
// KINESIS HELPERS
// =============================================================================
async function putToKinesis(streamName, events) {
    if (events.length === 0)
        return;
    // Kinesis has a limit of 500 records per batch
    const batches = chunkArray(events, 500);
    for (const batch of batches) {
        const records = batch.map((event) => ({
            Data: Buffer.from(JSON.stringify(event)),
            PartitionKey: getPartitionKey(event),
        }));
        await kinesisClient.send(new client_kinesis_1.PutRecordsCommand({
            StreamName: streamName,
            Records: records,
        }));
    }
    console.log(`Put ${events.length} records to ${streamName}`);
}
function getPartitionKey(event) {
    if ("cardId" in event && event.cardId) {
        return event.cardId;
    }
    if ("cardName" in event && event.cardName) {
        return event.cardName;
    }
    return `${event.source}-${Date.now()}`;
}
// =============================================================================
// DYNAMODB HELPERS
// =============================================================================
async function updateCurrentPrice(tableName, event) {
    const item = {
        card_id: event.cardId,
        source_condition: `${event.source}#${event.condition}`,
        source: event.source,
        condition: event.condition,
        price: event.price,
        price_usd: event.priceUsd,
        price_gbp: event.priceGbp,
        currency: event.currency,
        listings_count: event.listingsCount || 0,
        name: event.name,
        set_code: event.setCode,
        updated_at: event.collectedAt,
        ttl: Math.floor(Date.now() / 1000) + 86400 * 7, // 7 days TTL
    };
    await dynamoClient.send(new client_dynamodb_1.PutItemCommand({
        TableName: tableName,
        Item: (0, util_dynamodb_1.marshall)(item),
    }));
}
async function batchUpdateCurrentPrices(tableName, events) {
    if (events.length === 0)
        return;
    // DynamoDB batch write limit is 25 items
    const batches = chunkArray(events, 25);
    for (const batch of batches) {
        const writeRequests = batch.map((event) => ({
            PutRequest: {
                Item: (0, util_dynamodb_1.marshall)({
                    card_id: event.cardId,
                    source_condition: `${event.source}#${event.condition}`,
                    source: event.source,
                    condition: event.condition,
                    price: event.price,
                    price_usd: event.priceUsd,
                    price_gbp: event.priceGbp,
                    currency: event.currency,
                    listings_count: event.listingsCount || 0,
                    name: event.name,
                    set_code: event.setCode,
                    updated_at: event.collectedAt,
                    ttl: Math.floor(Date.now() / 1000) + 86400 * 7,
                }),
            },
        }));
        await dynamoClient.send(new client_dynamodb_1.BatchWriteItemCommand({
            RequestItems: {
                [tableName]: writeRequests,
            },
        }));
    }
}
async function recordArbitrageOpportunity(tableName, cardId, buySource, sellSource, buyPrice, sellPrice, spread) {
    const timestamp = Date.now();
    const netProfit = sellPrice - buyPrice;
    const item = {
        card_id: cardId,
        timestamp,
        buy_source: buySource,
        sell_source: sellSource,
        buy_price: buyPrice,
        sell_price: sellPrice,
        spread,
        net_profit: netProfit,
        created_at: new Date().toISOString(),
        ttl: Math.floor(timestamp / 1000) + 86400, // 24 hours TTL
    };
    await dynamoClient.send(new client_dynamodb_1.PutItemCommand({
        TableName: tableName,
        Item: (0, util_dynamodb_1.marshall)(item),
    }));
}
async function getCardFromCatalog(tableName, cardId) {
    const response = await dynamoClient.send(new client_dynamodb_1.GetItemCommand({
        TableName: tableName,
        Key: (0, util_dynamodb_1.marshall)({ card_id: cardId }),
    }));
    if (!response.Item)
        return null;
    return (0, util_dynamodb_1.unmarshall)(response.Item);
}
// =============================================================================
// TIMESTREAM HELPERS
// =============================================================================
async function writePriceToTimestream(databaseName, tableName, events) {
    if (events.length === 0)
        return;
    // Timestream has a limit of 100 records per batch
    const batches = chunkArray(events, 100);
    for (const batch of batches) {
        const records = batch.map((event) => ({
            Dimensions: [
                { Name: "card_id", Value: event.cardId },
                { Name: "source", Value: event.source },
                { Name: "condition", Value: event.condition },
                { Name: "currency", Value: event.currency },
            ],
            MeasureName: "price_data",
            MeasureValueType: "MULTI",
            MeasureValues: [
                {
                    Name: "price",
                    Value: event.price.toString(),
                    Type: "DOUBLE",
                },
                {
                    Name: "price_usd",
                    Value: event.priceUsd.toString(),
                    Type: "DOUBLE",
                },
                {
                    Name: "price_gbp",
                    Value: event.priceGbp.toString(),
                    Type: "DOUBLE",
                },
                {
                    Name: "listings_count",
                    Value: (event.listingsCount || 0).toString(),
                    Type: "BIGINT",
                },
            ],
            Time: new Date(event.timestamp).getTime().toString(),
            TimeUnit: "MILLISECONDS",
        }));
        await timestreamClient.send(new client_timestream_write_1.WriteRecordsCommand({
            DatabaseName: databaseName,
            TableName: tableName,
            Records: records,
        }));
    }
    console.log(`Wrote ${events.length} records to Timestream`);
}
// =============================================================================
// CURRENCY CONVERSION
// =============================================================================
// Fallback exchange rates (used when API is unavailable)
const FALLBACK_FX_RATES = {
    USD: 1.0,
    GBP: 1.27,
    EUR: 1.08,
    JPY: 0.0067,
    CAD: 0.74,
    AUD: 0.65,
};
// Cached live rates with expiry
let cachedFxRates = null;
let fxRatesCacheExpiry = null;
const FX_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
/**
 * Fetches live FX rates from exchangerate-api.com (free tier: 1500 req/month)
 * Falls back to static rates on error
 */
async function fetchLiveFxRates() {
    // Return cached rates if still valid
    if (cachedFxRates && fxRatesCacheExpiry && fxRatesCacheExpiry > new Date()) {
        return cachedFxRates;
    }
    try {
        // Using exchangerate-api.com free tier (no API key required for basic endpoint)
        const response = await fetch("https://api.exchangerate-api.com/v4/latest/USD", { signal: AbortSignal.timeout(5000) } // 5s timeout
        );
        if (!response.ok) {
            throw new Error(`FX API returned ${response.status}`);
        }
        const data = await response.json();
        const rates = data.rates;
        // Convert to USD-based rates (amount in currency * rate = USD)
        cachedFxRates = {
            USD: 1.0,
            GBP: 1 / (rates.GBP || 0.79), // GBP to USD
            EUR: 1 / (rates.EUR || 0.92), // EUR to USD
            JPY: 1 / (rates.JPY || 149), // JPY to USD
            CAD: 1 / (rates.CAD || 1.36), // CAD to USD
            AUD: 1 / (rates.AUD || 1.53), // AUD to USD
        };
        fxRatesCacheExpiry = new Date(Date.now() + FX_CACHE_TTL_MS);
        console.log("Fetched live FX rates:", cachedFxRates);
        return cachedFxRates;
    }
    catch (error) {
        console.warn("Failed to fetch live FX rates, using fallback:", error);
        return FALLBACK_FX_RATES;
    }
}
/**
 * Gets current FX rates (cached or fallback)
 */
function getFxRates() {
    return cachedFxRates || FALLBACK_FX_RATES;
}
function convertToUsd(amount, currency) {
    const rates = getFxRates();
    const rate = rates[currency.toUpperCase()] || 1;
    return amount * rate;
}
function convertToGbp(amountUsd) {
    const rates = getFxRates();
    return amountUsd / rates.GBP;
}
function normalizePrice(price, currency) {
    const priceUsd = convertToUsd(price, currency);
    const priceGbp = convertToGbp(priceUsd);
    return { priceUsd, priceGbp };
}
/**
 * Async version that ensures live rates are loaded first
 */
async function normalizePriceAsync(price, currency) {
    await fetchLiveFxRates();
    return normalizePrice(price, currency);
}
// =============================================================================
// CARD ID NORMALIZATION
// =============================================================================
function normalizeCardId(setCode, cardNumber, variantType) {
    const baseId = `${setCode.toUpperCase()}-${cardNumber.padStart(3, "0")}`;
    if (variantType && variantType !== "regular") {
        return `${baseId}-${variantType.toLowerCase()}`;
    }
    return baseId;
}
function parseCardNumber(input) {
    // Handle formats like "OP01-121", "OP01-121-parallel", "OP01-121 (Parallel)"
    const cleanInput = input.toUpperCase().trim();
    // Try to match pattern: SET-NUMBER[-VARIANT]
    const match = cleanInput.match(/^([A-Z]+\d+)-(\d+)(?:-([A-Z]+))?$/i);
    if (match) {
        return {
            setCode: match[1],
            cardNumber: match[2],
            variantType: match[3]?.toLowerCase() || "regular",
        };
    }
    // Try to extract variant from parentheses
    const parenMatch = cleanInput.match(/^([A-Z]+\d+)-(\d+)\s*\(([^)]+)\)$/i);
    if (parenMatch) {
        return {
            setCode: parenMatch[1],
            cardNumber: parenMatch[2],
            variantType: parenMatch[3].toLowerCase().replace(/\s+/g, ""),
        };
    }
    // Fallback
    return {
        setCode: "",
        cardNumber: input,
        variantType: "regular",
    };
}
// =============================================================================
// CONDITION NORMALIZATION
// =============================================================================
const CONDITION_MAP = {
    // Near Mint variants
    nm: "NM",
    "near mint": "NM",
    nearmint: "NM",
    mint: "NM",
    m: "NM",
    "m/nm": "NM",
    new: "NM",
    "brand new": "NM",
    // Lightly Played variants
    lp: "LP",
    "lightly played": "LP",
    lightlyplayed: "LP",
    "light play": "LP",
    sp: "LP", // Slightly Played = LP
    ex: "LP", // Excellent = LP
    excellent: "LP",
    "very good": "LP",
    vg: "LP",
    // Moderately Played variants
    mp: "MP",
    "moderately played": "MP",
    moderatelyplayed: "MP",
    "moderate play": "MP",
    gd: "MP", // Good = MP
    good: "MP",
    pl: "MP", // Played = MP
    played: "MP",
    // Heavily Played variants
    hp: "HP",
    "heavily played": "HP",
    heavilyplayed: "HP",
    "heavy play": "HP",
    poor: "HP",
    // Damaged variants
    dmg: "DMG",
    damaged: "DMG",
    d: "DMG",
    // Japanese condition terms
    "新品未使用": "NM",
    "未使用": "NM",
    "未使用に近い": "NM",
    "目立った傷や汚れなし": "LP",
    "やや傷や汚れあり": "MP",
    "傷や汚れあり": "HP",
    "全体的に状態が悪い": "DMG",
};
/**
 * Normalizes condition string to standard codes
 * Returns UNKNOWN instead of defaulting to NM for tracking purposes
 */
function normalizeConditionWithTracking(condition) {
    const trimmed = condition.trim();
    const normalized = CONDITION_MAP[trimmed.toLowerCase()];
    return {
        condition: normalized || "UNKNOWN",
        isKnown: !!normalized,
        original: trimmed,
    };
}
/**
 * Legacy function that defaults to NM for backward compatibility
 * @deprecated Use normalizeConditionWithTracking for new code
 */
function normalizeCondition(condition) {
    const result = normalizeConditionWithTracking(condition);
    return result.isKnown ? result.condition : "NM";
}
// =============================================================================
// RATE LIMITING
// =============================================================================
class RateLimiter {
    constructor(maxTokens, refillRate) {
        this.maxTokens = maxTokens;
        this.tokens = maxTokens;
        this.refillRate = refillRate;
        this.lastRefill = Date.now();
    }
    refill() {
        const now = Date.now();
        const elapsed = (now - this.lastRefill) / 1000;
        this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRate);
        this.lastRefill = now;
    }
    async acquire(count = 1) {
        this.refill();
        if (this.tokens >= count) {
            this.tokens -= count;
            return;
        }
        // Wait for tokens to be available
        const waitTime = ((count - this.tokens) / this.refillRate) * 1000;
        await sleep(waitTime);
        this.refill();
        this.tokens -= count;
    }
}
exports.RateLimiter = RateLimiter;
const DEFAULT_RETRY_OPTIONS = {
    maxRetries: 3,
    baseDelayMs: 1000,
    maxDelayMs: 30000,
};
async function withRetry(fn, options = {}) {
    const opts = { ...DEFAULT_RETRY_OPTIONS, ...options };
    let lastError = null;
    for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
        try {
            return await fn();
        }
        catch (error) {
            lastError = error;
            console.error(`Attempt ${attempt + 1} failed:`, error);
            if (attempt < opts.maxRetries) {
                const delay = Math.min(opts.baseDelayMs * Math.pow(2, attempt) + Math.random() * 1000, opts.maxDelayMs);
                console.log(`Retrying in ${delay}ms...`);
                await sleep(delay);
            }
        }
    }
    throw lastError;
}
// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================
function chunkArray(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
        chunks.push(array.slice(i, i + size));
    }
    return chunks;
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
function nowIso() {
    return new Date().toISOString();
}
function sanitizeString(str) {
    return str.replace(/[^\x20-\x7E]/g, "").trim();
}
class DataQualityTracker {
    constructor() {
        this.metrics = new Map();
        this.droppedRecords = [];
        this.maxDroppedRecords = 1000; // Limit memory usage
    }
    getOrCreateMetrics(source) {
        if (!this.metrics.has(source)) {
            this.metrics.set(source, {
                source,
                totalProcessed: 0,
                successfullyParsed: 0,
                dropped: 0,
                droppedByReason: {},
                unknownConditions: 0,
                fuzzyMatched: 0,
                collectedAt: nowIso(),
            });
        }
        return this.metrics.get(source);
    }
    recordSuccess(source, options) {
        const metrics = this.getOrCreateMetrics(source);
        metrics.totalProcessed++;
        metrics.successfullyParsed++;
        if (options?.fuzzyMatched)
            metrics.fuzzyMatched++;
        if (options?.unknownCondition)
            metrics.unknownConditions++;
    }
    recordDropped(source, reason, details) {
        const metrics = this.getOrCreateMetrics(source);
        metrics.totalProcessed++;
        metrics.dropped++;
        metrics.droppedByReason[reason] = (metrics.droppedByReason[reason] || 0) + 1;
        // Store sample of dropped records for debugging
        if (this.droppedRecords.length < this.maxDroppedRecords) {
            this.droppedRecords.push({
                source,
                reason,
                title: details?.title,
                rawData: details?.rawData,
                timestamp: nowIso(),
            });
        }
    }
    getMetrics() {
        return Array.from(this.metrics.values());
    }
    getDroppedRecords() {
        return this.droppedRecords;
    }
    logSummary() {
        for (const metrics of this.metrics.values()) {
            const dropRate = metrics.totalProcessed > 0
                ? ((metrics.dropped / metrics.totalProcessed) * 100).toFixed(1)
                : "0";
            console.log(`[DataQuality] ${metrics.source}:`);
            console.log(`  Total: ${metrics.totalProcessed}, Parsed: ${metrics.successfullyParsed}, Dropped: ${metrics.dropped} (${dropRate}%)`);
            console.log(`  Unknown conditions: ${metrics.unknownConditions}, Fuzzy matched: ${metrics.fuzzyMatched}`);
            if (Object.keys(metrics.droppedByReason).length > 0) {
                console.log(`  Drop reasons:`, metrics.droppedByReason);
            }
        }
    }
    reset() {
        this.metrics.clear();
        this.droppedRecords = [];
    }
}
// Global tracker instance
exports.dataQualityTracker = new DataQualityTracker();
// =============================================================================
// FUZZY CARD MATCHING
// =============================================================================
// Known card names to set mappings for fuzzy matching
const CARD_NAME_PATTERNS = [
    // Character name patterns that can help identify cards
    { pattern: /\bluffy\b/i, setCode: "OP" },
    { pattern: /\bzoro\b/i, setCode: "OP" },
    { pattern: /\bnami\b/i, setCode: "OP" },
    { pattern: /\bsanji\b/i, setCode: "OP" },
    { pattern: /\brobin\b/i, setCode: "OP" },
    { pattern: /\bchopper\b/i, setCode: "OP" },
    { pattern: /\bfranky\b/i, setCode: "OP" },
    { pattern: /\bbrook\b/i, setCode: "OP" },
    { pattern: /\bjinbe\b/i, setCode: "OP" },
    { pattern: /\bshank/i, setCode: "OP" },
    { pattern: /\bkaido\b/i, setCode: "OP" },
    { pattern: /\bace\b/i, setCode: "OP" },
    { pattern: /\blaw\b/i, setCode: "OP" },
    { pattern: /\bkid\b/i, setCode: "OP" },
    { pattern: /\byamato\b/i, setCode: "OP" },
];
// Alternative card number formats to try
const CARD_NUMBER_PATTERNS = [
    // Standard: OP01-121, EB01-045
    /([A-Z]{2,3}\d{2})-(\d{3})/i,
    // With spaces: OP01 - 121, OP 01-121
    /([A-Z]{2,3})\s*(\d{2})\s*[-–]\s*(\d{2,3})/i,
    // No dash: OP01121
    /([A-Z]{2,3})(\d{2})(\d{3})/i,
    // Japanese format: OP01 ルフィ 121
    /([A-Z]{2,3}\d{2})[^\d]*(\d{3})/i,
    // Alternate separators: OP01/121, OP01.121
    /([A-Z]{2,3}\d{2})[\/\.](\d{3})/i,
];
/**
 * Attempts to extract card info using multiple pattern matching strategies
 */
function fuzzyMatchCard(title) {
    const cleanTitle = title.trim();
    // Try each card number pattern in order of reliability
    for (let i = 0; i < CARD_NUMBER_PATTERNS.length; i++) {
        const pattern = CARD_NUMBER_PATTERNS[i];
        const match = cleanTitle.match(pattern);
        if (match) {
            let setCode;
            let cardNumber;
            if (match.length === 4) {
                // Pattern with separate set parts (e.g., OP 01-121)
                setCode = `${match[1]}${match[2]}`.toUpperCase();
                cardNumber = match[3].padStart(3, "0");
            }
            else {
                setCode = match[1].toUpperCase();
                cardNumber = match[2].padStart(3, "0");
            }
            // Detect variant type
            const variantType = detectVariantType(cleanTitle);
            return {
                setCode,
                cardNumber,
                variantType,
                confidence: i === 0 ? "high" : "medium",
                matchMethod: `pattern_${i}`,
            };
        }
    }
    // Low confidence: try to match by known character names
    for (const { pattern, setCode } of CARD_NAME_PATTERNS) {
        if (pattern.test(cleanTitle)) {
            // Can identify it's a One Piece card but can't get exact number
            // Return null but log for potential manual review
            console.log(`[FuzzyMatch] Potential ${setCode} card detected but no card number: "${title}"`);
            break;
        }
    }
    return null;
}
// =============================================================================
// VARIANT DETECTION (STANDARDIZED)
// =============================================================================
const VARIANT_PATTERNS = [
    {
        type: "parallel",
        patterns: [
            /\bparallel\b/i,
            /\balt\s*art\b/i,
            /\balternate\s*art\b/i,
            /\bパラレル/,
            /\bAA\b/,
            /\b(P)\s*版/,
        ],
    },
    {
        type: "manga",
        patterns: [
            /\bmanga\b/i,
            /\bcomic\s*parallel\b/i,
            /\bコミパラ/,
            /\bマンガ/,
        ],
    },
    {
        type: "sp",
        patterns: [
            /\bsp\b(?!\d)/i, // sp but not followed by digit
            /\bspecial\s*art\b/i,
            /\bスペシャル/,
            /\bスペシャルアート/,
        ],
    },
    {
        type: "spr",
        patterns: [
            /\bspr\b/i,
            /\bsecret\s*rare\b/i,
            /\bsec\b/i,
            /\bシークレット/,
        ],
    },
    {
        type: "tr",
        patterns: [
            /\btr\b/i,
            /\btreasure\b/i,
            /\bトレジャー/,
        ],
    },
    {
        type: "boxtopper",
        patterns: [
            /\bbox\s*topper\b/i,
            /\bpromo\b/i,
            /\bボックストッパー/,
        ],
    },
    {
        type: "wantedposter",
        patterns: [
            /\bwanted\s*poster\b/i,
            /\b手配書/,
        ],
    },
];
/**
 * Standardized variant detection across all sources
 */
function detectVariantType(title) {
    const cleanTitle = title.toLowerCase();
    for (const { type, patterns } of VARIANT_PATTERNS) {
        for (const pattern of patterns) {
            if (pattern.test(cleanTitle)) {
                return type;
            }
        }
    }
    return "regular";
}
/**
 * Calculates seller reputation tier based on available metrics
 */
function calculateSellerReputation(feedbackPercentage, feedbackScore, salesCount) {
    // Trusted: High feedback % and significant transaction count
    if (feedbackPercentage && feedbackPercentage >= 99 && (feedbackScore || 0) >= 100) {
        return "trusted";
    }
    // Low: Poor feedback or very low score
    if (feedbackPercentage && feedbackPercentage < 95) {
        return "low";
    }
    if (feedbackScore && feedbackScore < 10) {
        return "new";
    }
    // Standard: Everything else
    return "standard";
}
/**
 * Weight factor for price based on seller reputation
 * Trusted sellers get full weight, low reputation gets lower weight
 */
function getSellerWeightFactor(tier) {
    switch (tier) {
        case "trusted":
            return 1.0;
        case "standard":
            return 0.9;
        case "new":
            return 0.7;
        case "low":
            return 0.5;
        default:
            return 0.8;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidXRpbHMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi9sYW1iZGEvbGF5ZXJzL3NoYXJlZC9ub2RlanMvdXRpbHMudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOztHQUVHOzs7QUE4SEgsZ0NBa0JDO0FBTUQsb0NBd0JDO0FBa0JELGdEQTBCQztBQUVELDREQXNDQztBQUVELGdFQStCQztBQUVELGdEQWFDO0FBTUQsd0RBd0RDO0FBeUJELDRDQXNDQztBQUtELGdDQUVDO0FBRUQsb0NBSUM7QUFFRCxvQ0FHQztBQUVELHdDQU9DO0FBS0Qsa0RBTUM7QUFNRCwwQ0FVQztBQUVELDBDQW1DQztBQXNFRCx3RUFTQztBQU1ELGdEQUdDO0FBMERELDhCQTBCQztBQU1ELGdDQU1DO0FBRUQsc0JBRUM7QUFFRCx3QkFFQztBQUVELHdDQUVDO0FBOEpELHdDQTZDQztBQXlFRCw4Q0FZQztBQWtCRCw4REFvQkM7QUFNRCxzREFhQztBQXJpQ0QsNERBSWlDO0FBQ2pDLDhEQU1rQztBQUNsQyw0RUFHeUM7QUFDekMsOEVBSTBDO0FBQzFDLDBEQUE4RDtBQUU5RCxnRkFBZ0Y7QUFDaEYsVUFBVTtBQUNWLGdGQUFnRjtBQUVoRixNQUFNLGFBQWEsR0FBRyxJQUFJLDhCQUFhLENBQUMsRUFBRSxDQUFDLENBQUM7QUFDNUMsTUFBTSxZQUFZLEdBQUcsSUFBSSxnQ0FBYyxDQUFDLEVBQUUsQ0FBQyxDQUFDO0FBQzVDLE1BQU0sYUFBYSxHQUFHLElBQUksNkNBQW9CLENBQUMsRUFBRSxDQUFDLENBQUM7QUFDbkQsTUFBTSxnQkFBZ0IsR0FBRyxJQUFJLCtDQUFxQixDQUFDLEVBQUUsQ0FBQyxDQUFDO0FBd0Z2RCxnRkFBZ0Y7QUFDaEYsVUFBVTtBQUNWLGdGQUFnRjtBQUVoRixJQUFJLGFBQWEsR0FBMEIsSUFBSSxDQUFDO0FBRXpDLEtBQUssVUFBVSxVQUFVO0lBQzlCLElBQUksYUFBYTtRQUFFLE9BQU8sYUFBYSxDQUFDO0lBRXhD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QUNILFNBQWdCLHFCQUFxQixDQUFDLElBQXdDO0lBQzVFLFFBQVEsSUFBSSxFQUFFLENBQUM7UUFDYixLQUFLLFNBQVM7WUFDWixPQUFPLEdBQUcsQ0FBQztRQUNiLEtBQUssVUFBVTtZQUNiLE9BQU8sR0FBRyxDQUFDO1FBQ2IsS0FBSyxLQUFLO1lBQ1IsT0FBTyxHQUFHLENBQUM7UUFDYixLQUFLLEtBQUs7WUFDUixPQUFPLEdBQUcsQ0FBQztRQUNiO1lBQ0UsT0FBTyxHQUFHLENBQUM7SUFDZixDQUFDO0FBQ0gsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogU2hhcmVkIHV0aWxpdGllcyBmb3IgZGF0YSBwaXBlbGluZSBMYW1iZGEgZnVuY3Rpb25zXG4gKi9cblxuaW1wb3J0IHtcbiAgS2luZXNpc0NsaWVudCxcbiAgUHV0UmVjb3Jkc0NvbW1hbmQsXG4gIFB1dFJlY29yZHNSZXF1ZXN0RW50cnksXG59IGZyb20gXCJAYXdzLXNkay9jbGllbnQta2luZXNpc1wiO1xuaW1wb3J0IHtcbiAgRHluYW1vREJDbGllbnQsXG4gIFB1dEl0ZW1Db21tYW5kLFxuICBHZXRJdGVtQ29tbWFuZCxcbiAgVXBkYXRlSXRlbUNvbW1hbmQsXG4gIEJhdGNoV3JpdGVJdGVtQ29tbWFuZCxcbn0gZnJvbSBcIkBhd3Mtc2RrL2NsaWVudC1keW5hbW9kYlwiO1xuaW1wb3J0IHtcbiAgU2VjcmV0c01hbmFnZXJDbGllbnQsXG4gIEdldFNlY3JldFZhbHVlQ29tbWFuZCxcbn0gZnJvbSBcIkBhd3Mtc2RrL2NsaWVudC1zZWNyZXRzLW1hbmFnZXJcIjtcbmltcG9ydCB7XG4gIFRpbWVzdHJlYW1Xcml0ZUNsaWVudCxcbiAgV3JpdGVSZWNvcmRzQ29tbWFuZCxcbiAgX1JlY29yZCxcbn0gZnJvbSBcIkBhd3Mtc2RrL2NsaWVudC10aW1lc3RyZWFtLXdyaXRlXCI7XG5pbXBvcnQgeyBtYXJzaGFsbCwgdW5tYXJzaGFsbCB9IGZyb20gXCJAYXdzLXNkay91dGlsLWR5bmFtb2RiXCI7XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBDTElFTlRTXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG5jb25zdCBraW5lc2lzQ2xpZW50ID0gbmV3IEtpbmVzaXNDbGllbnQoe30pO1xuY29uc3QgZHluYW1vQ2xpZW50ID0gbmV3IER5bmFtb0RCQ2xpZW50KHt9KTtcbmNvbnN0IHNlY3JldHNDbGllbnQgPSBuZXcgU2VjcmV0c01hbmFnZXJDbGllbnQoe30pO1xuY29uc3QgdGltZXN0cmVhbUNsaWVudCA9IG5ldyBUaW1lc3RyZWFtV3JpdGVDbGllbnQoe30pO1xuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gVFlQRVNcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbmV4cG9ydCBpbnRlcmZhY2UgUHJpY2VFdmVudCB7XG4gIGV2ZW50VHlwZTogXCJwcmljZVwiO1xuICBzb3VyY2U6IHN0cmluZztcbiAgY2FyZElkOiBzdHJpbmc7XG4gIGV4dGVybmFsSWQ6IHN0cmluZztcbiAgbmFtZTogc3RyaW5nO1xuICBzZXRDb2RlOiBzdHJpbmc7XG4gIGNhcmROdW1iZXI6IHN0cmluZztcbiAgdmFyaWFudFR5cGU6IHN0cmluZztcbiAgY29uZGl0aW9uOiBzdHJpbmc7XG4gIGxhbmd1YWdlOiBzdHJpbmc7XG4gIHByaWNlOiBudW1iZXI7XG4gIGN1cnJlbmN5OiBzdHJpbmc7XG4gIHByaWNlVXNkOiBudW1iZXI7XG4gIHByaWNlR2JwOiBudW1iZXI7XG4gIGxpc3RpbmdzQ291bnQ/OiBudW1iZXI7XG4gIHNlbGxlcklkPzogc3RyaW5nO1xuICB0aW1lc3RhbXA6IHN0cmluZztcbiAgY29sbGVjdGVkQXQ6IHN0cmluZztcbn1cblxuZXhwb3J0IGludGVyZmFjZSBMaXN0aW5nRXZlbnQge1xuICBldmVudFR5cGU6IFwibGlzdGluZ1wiO1xuICBzb3VyY2U6IHN0cmluZztcbiAgbGlzdGluZ0lkOiBzdHJpbmc7XG4gIGNhcmRJZDogc3RyaW5nO1xuICB0aXRsZTogc3RyaW5nO1xuICBkZXNjcmlwdGlvbj86IHN0cmluZztcbiAgcHJpY2U6IG51bWJlcjtcbiAgY3VycmVuY3k6IHN0cmluZztcbiAgY29uZGl0aW9uOiBzdHJpbmc7XG4gIHNlbGxlcklkOiBzdHJpbmc7XG4gIHNlbGxlckZlZWRiYWNrPzogbnVtYmVyO1xuICBzZWxsZXJGZWVkYmFja0NvdW50PzogbnVtYmVyO1xuICBpbWFnZVVybHM/OiBzdHJpbmdbXTtcbiAgaXNBdWN0aW9uOiBib29sZWFuO1xuICBlbmRUaW1lPzogc3RyaW5nO1xuICB0aW1lc3RhbXA6IHN0cmluZztcbiAgY29sbGVjdGVkQXQ6IHN0cmluZztcbn1cblxuZXhwb3J0IGludGVyZmFjZSBTYWxlc0V2ZW50IHtcbiAgZXZlbnRUeXBlOiBcInNhbGVcIjtcbiAgc291cmNlOiBzdHJpbmc7XG4gIHNhbGVJZDogc3RyaW5nO1xuICBjYXJkSWQ6IHN0cmluZztcbiAgcHJpY2U6IG51bWJlcjtcbiAgY3VycmVuY3k6IHN0cmluZztcbiAgcHJpY2VVc2Q6IG51bWJlcjtcbiAgY29uZGl0aW9uOiBzdHJpbmc7XG4gIHF1YW50aXR5OiBudW1iZXI7XG4gIHNlbGxlcklkPzogc3RyaW5nO1xuICBidXllcklkPzogc3RyaW5nO1xuICBzYWxlRGF0ZTogc3RyaW5nO1xuICBjb2xsZWN0ZWRBdDogc3RyaW5nO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIFNpZ25hbEV2ZW50IHtcbiAgZXZlbnRUeXBlOiBcInNpZ25hbFwiO1xuICBzaWduYWxUeXBlOiBcInNvY2lhbFwiIHwgXCJ5b3V0dWJlXCIgfCBcInRvdXJuYW1lbnRcIiB8IFwibmV3c1wiO1xuICBjYXJkSWQ/OiBzdHJpbmc7XG4gIGNhcmROYW1lPzogc3RyaW5nO1xuICBjb250ZW50OiBzdHJpbmc7XG4gIHNlbnRpbWVudD86IG51bWJlcjtcbiAgcmVhY2g/OiBudW1iZXI7XG4gIHNvdXJjZTogc3RyaW5nO1xuICBzb3VyY2VVcmw/OiBzdHJpbmc7XG4gIHRpbWVzdGFtcDogc3RyaW5nO1xuICBjb2xsZWN0ZWRBdDogc3RyaW5nO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIEFQSUNyZWRlbnRpYWxzIHtcbiAgdGNncGxheWVyX2FwaV9rZXk/OiBzdHJpbmc7XG4gIHRjZ3BsYXllcl9hY2Nlc3NfdG9rZW4/OiBzdHJpbmc7XG4gIGNhcmRtYXJrZXRfYXBwX3Rva2VuPzogc3RyaW5nO1xuICBjYXJkbWFya2V0X2FwcF9zZWNyZXQ/OiBzdHJpbmc7XG4gIGViYXlfY2xpZW50X2lkPzogc3RyaW5nO1xuICBlYmF5X2NsaWVudF9zZWNyZXQ/OiBzdHJpbmc7XG4gIHByb3h5X3VzZXJuYW1lPzogc3RyaW5nO1xuICBwcm94eV9wYXNzd29yZD86IHN0cmluZztcbn1cblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIFNFQ1JFVFNcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbmxldCBjYWNoZWRTZWNyZXRzOiBBUElDcmVkZW50aWFscyB8IG51bGwgPSBudWxsO1xuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gZ2V0U2VjcmV0cygpOiBQcm9taXNlPEFQSUNyZWRlbnRpYWxzPiB7XG4gIGlmIChjYWNoZWRTZWNyZXRzKSByZXR1cm4gY2FjaGVkU2VjcmV0cztcblxuICBjb25zdCBzZWNyZXRBcm4gPSBwcm9jZXNzLmVudi5TRUNSRVRTX0FSTjtcbiAgaWYgKCFzZWNyZXRBcm4pIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJTRUNSRVRTX0FSTiBlbnZpcm9ubWVudCB2YXJpYWJsZSBub3Qgc2V0XCIpO1xuICB9XG5cbiAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBzZWNyZXRzQ2xpZW50LnNlbmQoXG4gICAgbmV3IEdldFNlY3JldFZhbHVlQ29tbWFuZCh7IFNlY3JldElkOiBzZWNyZXRBcm4gfSlcbiAgKTtcblxuICBpZiAoIXJlc3BvbnNlLlNlY3JldFN0cmluZykge1xuICAgIHRocm93IG5ldyBFcnJvcihcIlNlY3JldCB2YWx1ZSBpcyBlbXB0eVwiKTtcbiAgfVxuXG4gIGNhY2hlZFNlY3JldHMgPSBKU09OLnBhcnNlKHJlc3BvbnNlLlNlY3JldFN0cmluZyk7XG4gIHJldHVybiBjYWNoZWRTZWNyZXRzITtcbn1cblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIEtJTkVTSVMgSEVMUEVSU1xuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHB1dFRvS2luZXNpcyhcbiAgc3RyZWFtTmFtZTogc3RyaW5nLFxuICBldmVudHM6IEFycmF5PFByaWNlRXZlbnQgfCBMaXN0aW5nRXZlbnQgfCBTYWxlc0V2ZW50IHwgU2lnbmFsRXZlbnQ+XG4pOiBQcm9taXNlPHZvaWQ+IHtcbiAgaWYgKGV2ZW50cy5sZW5ndGggPT09IDApIHJldHVybjtcblxuICAvLyBLaW5lc2lzIGhhcyBhIGxpbWl0IG9mIDUwMCByZWNvcmRzIHBlciBiYXRjaFxuICBjb25zdCBiYXRjaGVzID0gY2h1bmtBcnJheShldmVudHMsIDUwMCk7XG5cbiAgZm9yIChjb25zdCBiYXRjaCBvZiBiYXRjaGVzKSB7XG4gICAgY29uc3QgcmVjb3JkczogUHV0UmVjb3Jkc1JlcXVlc3RFbnRyeVtdID0gYmF0Y2gubWFwKChldmVudCkgPT4gKHtcbiAgICAgIERhdGE6IEJ1ZmZlci5mcm9tKEpTT04uc3RyaW5naWZ5KGV2ZW50KSksXG4gICAgICBQYXJ0aXRpb25LZXk6IGdldFBhcnRpdGlvbktleShldmVudCksXG4gICAgfSkpO1xuXG4gICAgYXdhaXQga2luZXNpc0NsaWVudC5zZW5kKFxuICAgICAgbmV3IFB1dFJlY29yZHNDb21tYW5kKHtcbiAgICAgICAgU3RyZWFtTmFtZTogc3RyZWFtTmFtZSxcbiAgICAgICAgUmVjb3JkczogcmVjb3JkcyxcbiAgICAgIH0pXG4gICAgKTtcbiAgfVxuXG4gIGNvbnNvbGUubG9nKGBQdXQgJHtldmVudHMubGVuZ3RofSByZWNvcmRzIHRvICR7c3RyZWFtTmFtZX1gKTtcbn1cblxuZnVuY3Rpb24gZ2V0UGFydGl0aW9uS2V5KFxuICBldmVudDogUHJpY2VFdmVudCB8IExpc3RpbmdFdmVudCB8IFNhbGVzRXZlbnQgfCBTaWduYWxFdmVudFxuKTogc3RyaW5nIHtcbiAgaWYgKFwiY2FyZElkXCIgaW4gZXZlbnQgJiYgZXZlbnQuY2FyZElkKSB7XG4gICAgcmV0dXJuIGV2ZW50LmNhcmRJZDtcbiAgfVxuICBpZiAoXCJjYXJkTmFtZVwiIGluIGV2ZW50ICYmIGV2ZW50LmNhcmROYW1lKSB7XG4gICAgcmV0dXJuIGV2ZW50LmNhcmROYW1lO1xuICB9XG4gIHJldHVybiBgJHtldmVudC5zb3VyY2V9LSR7RGF0ZS5ub3coKX1gO1xufVxuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gRFlOQU1PREIgSEVMUEVSU1xuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHVwZGF0ZUN1cnJlbnRQcmljZShcbiAgdGFibGVOYW1lOiBzdHJpbmcsXG4gIGV2ZW50OiBQcmljZUV2ZW50XG4pOiBQcm9taXNlPHZvaWQ+IHtcbiAgY29uc3QgaXRlbSA9IHtcbiAgICBjYXJkX2lkOiBldmVudC5jYXJkSWQsXG4gICAgc291cmNlX2NvbmRpdGlvbjogYCR7ZXZlbnQuc291cmNlfSMke2V2ZW50LmNvbmRpdGlvbn1gLFxuICAgIHNvdXJjZTogZXZlbnQuc291cmNlLFxuICAgIGNvbmRpdGlvbjogZXZlbnQuY29uZGl0aW9uLFxuICAgIHByaWNlOiBldmVudC5wcmljZSxcbiAgICBwcmljZV91c2Q6IGV2ZW50LnByaWNlVXNkLFxuICAgIHByaWNlX2dicDogZXZlbnQucHJpY2VHYnAsXG4gICAgY3VycmVuY3k6IGV2ZW50LmN1cnJlbmN5LFxuICAgIGxpc3RpbmdzX2NvdW50OiBldmVudC5saXN0aW5nc0NvdW50IHx8IDAsXG4gICAgbmFtZTogZXZlbnQubmFtZSxcbiAgICBzZXRfY29kZTogZXZlbnQuc2V0Q29kZSxcbiAgICB1cGRhdGVkX2F0OiBldmVudC5jb2xsZWN0ZWRBdCxcbiAgICB0dGw6IE1hdGguZmxvb3IoRGF0ZS5ub3coKSAvIDEwMDApICsgODY0MDAgKiA3LCAvLyA3IGRheXMgVFRMXG4gIH07XG5cbiAgYXdhaXQgZHluYW1vQ2xpZW50LnNlbmQoXG4gICAgbmV3IFB1dEl0ZW1Db21tYW5kKHtcbiAgICAgIFRhYmxlTmFtZTogdGFibGVOYW1lLFxuICAgICAgSXRlbTogbWFyc2hhbGwoaXRlbSksXG4gICAgfSlcbiAgKTtcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGJhdGNoVXBkYXRlQ3VycmVudFByaWNlcyhcbiAgdGFibGVOYW1lOiBzdHJpbmcsXG4gIGV2ZW50czogUHJpY2VFdmVudFtdXG4pOiBQcm9taXNlPHZvaWQ+IHtcbiAgaWYgKGV2ZW50cy5sZW5ndGggPT09IDApIHJldHVybjtcblxuICAvLyBEeW5hbW9EQiBiYXRjaCB3cml0ZSBsaW1pdCBpcyAyNSBpdGVtc1xuICBjb25zdCBiYXRjaGVzID0gY2h1bmtBcnJheShldmVudHMsIDI1KTtcblxuICBmb3IgKGNvbnN0IGJhdGNoIG9mIGJhdGNoZXMpIHtcbiAgICBjb25zdCB3cml0ZVJlcXVlc3RzID0gYmF0Y2gubWFwKChldmVudCkgPT4gKHtcbiAgICAgIFB1dFJlcXVlc3Q6IHtcbiAgICAgICAgSXRlbTogbWFyc2hhbGwoe1xuICAgICAgICAgIGNhcmRfaWQ6IGV2ZW50LmNhcmRJZCxcbiAgICAgICAgICBzb3VyY2VfY29uZGl0aW9uOiBgJHtldmVudC5zb3VyY2V9IyR7ZXZlbnQuY29uZGl0aW9ufWAsXG4gICAgICAgICAgc291cmNlOiBldmVudC5zb3VyY2UsXG4gICAgICAgICAgY29uZGl0aW9uOiBldmVudC5jb25kaXRpb24sXG4gICAgICAgICAgcHJpY2U6IGV2ZW50LnByaWNlLFxuICAgICAgICAgIHByaWNlX3VzZDogZXZlbnQucHJpY2VVc2QsXG4gICAgICAgICAgcHJpY2VfZ2JwOiBldmVudC5wcmljZUdicCxcbiAgICAgICAgICBjdXJyZW5jeTogZXZlbnQuY3VycmVuY3ksXG4gICAgICAgICAgbGlzdGluZ3NfY291bnQ6IGV2ZW50Lmxpc3RpbmdzQ291bnQgfHwgMCxcbiAgICAgICAgICBuYW1lOiBldmVudC5uYW1lLFxuICAgICAgICAgIHNldF9jb2RlOiBldmVudC5zZXRDb2RlLFxuICAgICAgICAgIHVwZGF0ZWRfYXQ6IGV2ZW50LmNvbGxlY3RlZEF0LFxuICAgICAgICAgIHR0bDogTWF0aC5mbG9vcihEYXRlLm5vdygpIC8gMTAwMCkgKyA4NjQwMCAqIDcsXG4gICAgICAgIH0pLFxuICAgICAgfSxcbiAgICB9KSk7XG5cbiAgICBhd2FpdCBkeW5hbW9DbGllbnQuc2VuZChcbiAgICAgIG5ldyBCYXRjaFdyaXRlSXRlbUNvbW1hbmQoe1xuICAgICAgICBSZXF1ZXN0SXRlbXM6IHtcbiAgICAgICAgICBbdGFibGVOYW1lXTogd3JpdGVSZXF1ZXN0cyxcbiAgICAgICAgfSxcbiAgICAgIH0pXG4gICAgKTtcbiAgfVxufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcmVjb3JkQXJiaXRyYWdlT3Bwb3J0dW5pdHkoXG4gIHRhYmxlTmFtZTogc3RyaW5nLFxuICBjYXJkSWQ6IHN0cmluZyxcbiAgYnV5U291cmNlOiBzdHJpbmcsXG4gIHNlbGxTb3VyY2U6IHN0cmluZyxcbiAgYnV5UHJpY2U6IG51bWJlcixcbiAgc2VsbFByaWNlOiBudW1iZXIsXG4gIHNwcmVhZDogbnVtYmVyXG4pOiBQcm9taXNlPHZvaWQ+IHtcbiAgY29uc3QgdGltZXN0YW1wID0gRGF0ZS5ub3coKTtcbiAgY29uc3QgbmV0UHJvZml0ID0gc2VsbFByaWNlIC0gYnV5UHJpY2U7XG5cbiAgY29uc3QgaXRlbSA9IHtcbiAgICBjYXJkX2lkOiBjYXJkSWQsXG4gICAgdGltZXN0YW1wLFxuICAgIGJ1eV9zb3VyY2U6IGJ1eVNvdXJjZSxcbiAgICBzZWxsX3NvdXJjZTogc2VsbFNvdXJjZSxcbiAgICBidXlfcHJpY2U6IGJ1eVByaWNlLFxuICAgIHNlbGxfcHJpY2U6IHNlbGxQcmljZSxcbiAgICBzcHJlYWQsXG4gICAgbmV0X3Byb2ZpdDogbmV0UHJvZml0LFxuICAgIGNyZWF0ZWRfYXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICB0dGw6IE1hdGguZmxvb3IodGltZXN0YW1wIC8gMTAwMCkgKyA4NjQwMCwgLy8gMjQgaG91cnMgVFRMXG4gIH07XG5cbiAgYXdhaXQgZHluYW1vQ2xpZW50LnNlbmQoXG4gICAgbmV3IFB1dEl0ZW1Db21tYW5kKHtcbiAgICAgIFRhYmxlTmFtZTogdGFibGVOYW1lLFxuICAgICAgSXRlbTogbWFyc2hhbGwoaXRlbSksXG4gICAgfSlcbiAgKTtcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGdldENhcmRGcm9tQ2F0YWxvZyhcbiAgdGFibGVOYW1lOiBzdHJpbmcsXG4gIGNhcmRJZDogc3RyaW5nXG4pOiBQcm9taXNlPFJlY29yZDxzdHJpbmcsIHVua25vd24+IHwgbnVsbD4ge1xuICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGR5bmFtb0NsaWVudC5zZW5kKFxuICAgIG5ldyBHZXRJdGVtQ29tbWFuZCh7XG4gICAgICBUYWJsZU5hbWU6IHRhYmxlTmFtZSxcbiAgICAgIEtleTogbWFyc2hhbGwoeyBjYXJkX2lkOiBjYXJkSWQgfSksXG4gICAgfSlcbiAgKTtcblxuICBpZiAoIXJlc3BvbnNlLkl0ZW0pIHJldHVybiBudWxsO1xuICByZXR1cm4gdW5tYXJzaGFsbChyZXNwb25zZS5JdGVtKTtcbn1cblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIFRJTUVTVFJFQU0gSEVMUEVSU1xuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHdyaXRlUHJpY2VUb1RpbWVzdHJlYW0oXG4gIGRhdGFiYXNlTmFtZTogc3RyaW5nLFxuICB0YWJsZU5hbWU6IHN0cmluZyxcbiAgZXZlbnRzOiBQcmljZUV2ZW50W11cbik6IFByb21pc2U8dm9pZD4ge1xuICBpZiAoZXZlbnRzLmxlbmd0aCA9PT0gMCkgcmV0dXJuO1xuXG4gIC8vIFRpbWVzdHJlYW0gaGFzIGEgbGltaXQgb2YgMTAwIHJlY29yZHMgcGVyIGJhdGNoXG4gIGNvbnN0IGJhdGNoZXMgPSBjaHVua0FycmF5KGV2ZW50cywgMTAwKTtcblxuICBmb3IgKGNvbnN0IGJhdGNoIG9mIGJhdGNoZXMpIHtcbiAgICBjb25zdCByZWNvcmRzOiBfUmVjb3JkW10gPSBiYXRjaC5tYXAoKGV2ZW50KSA9PiAoe1xuICAgICAgRGltZW5zaW9uczogW1xuICAgICAgICB7IE5hbWU6IFwiY2FyZF9pZFwiLCBWYWx1ZTogZXZlbnQuY2FyZElkIH0sXG4gICAgICAgIHsgTmFtZTogXCJzb3VyY2VcIiwgVmFsdWU6IGV2ZW50LnNvdXJjZSB9LFxuICAgICAgICB7IE5hbWU6IFwiY29uZGl0aW9uXCIsIFZhbHVlOiBldmVudC5jb25kaXRpb24gfSxcbiAgICAgICAgeyBOYW1lOiBcImN1cnJlbmN5XCIsIFZhbHVlOiBldmVudC5jdXJyZW5jeSB9LFxuICAgICAgXSxcbiAgICAgIE1lYXN1cmVOYW1lOiBcInByaWNlX2RhdGFcIixcbiAgICAgIE1lYXN1cmVWYWx1ZVR5cGU6IFwiTVVMVElcIixcbiAgICAgIE1lYXN1cmVWYWx1ZXM6IFtcbiAgICAgICAge1xuICAgICAgICAgIE5hbWU6IFwicHJpY2VcIixcbiAgICAgICAgICBWYWx1ZTogZXZlbnQucHJpY2UudG9TdHJpbmcoKSxcbiAgICAgICAgICBUeXBlOiBcIkRPVUJMRVwiLFxuICAgICAgICB9LFxuICAgICAgICB7XG4gICAgICAgICAgTmFtZTogXCJwcmljZV91c2RcIixcbiAgICAgICAgICBWYWx1ZTogZXZlbnQucHJpY2VVc2QudG9TdHJpbmcoKSxcbiAgICAgICAgICBUeXBlOiBcIkRPVUJMRVwiLFxuICAgICAgICB9LFxuICAgICAgICB7XG4gICAgICAgICAgTmFtZTogXCJwcmljZV9nYnBcIixcbiAgICAgICAgICBWYWx1ZTogZXZlbnQucHJpY2VHYnAudG9TdHJpbmcoKSxcbiAgICAgICAgICBUeXBlOiBcIkRPVUJMRVwiLFxuICAgICAgICB9LFxuICAgICAgICB7XG4gICAgICAgICAgTmFtZTogXCJsaXN0aW5nc19jb3VudFwiLFxuICAgICAgICAgIFZhbHVlOiAoZXZlbnQubGlzdGluZ3NDb3VudCB8fCAwKS50b1N0cmluZygpLFxuICAgICAgICAgIFR5cGU6IFwiQklHSU5UXCIsXG4gICAgICAgIH0sXG4gICAgICBdLFxuICAgICAgVGltZTogbmV3IERhdGUoZXZlbnQudGltZXN0YW1wKS5nZXRUaW1lKCkudG9TdHJpbmcoKSxcbiAgICAgIFRpbWVVbml0OiBcIk1JTExJU0VDT05EU1wiLFxuICAgIH0pKTtcblxuICAgIGF3YWl0IHRpbWVzdHJlYW1DbGllbnQuc2VuZChcbiAgICAgIG5ldyBXcml0ZVJlY29yZHNDb21tYW5kKHtcbiAgICAgICAgRGF0YWJhc2VOYW1lOiBkYXRhYmFzZU5hbWUsXG4gICAgICAgIFRhYmxlTmFtZTogdGFibGVOYW1lLFxuICAgICAgICBSZWNvcmRzOiByZWNvcmRzLFxuICAgICAgfSlcbiAgICApO1xuICB9XG5cbiAgY29uc29sZS5sb2coYFdyb3RlICR7ZXZlbnRzLmxlbmd0aH0gcmVjb3JkcyB0byBUaW1lc3RyZWFtYCk7XG59XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBDVVJSRU5DWSBDT05WRVJTSU9OXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4vLyBGYWxsYmFjayBleGNoYW5nZSByYXRlcyAodXNlZCB3aGVuIEFQSSBpcyB1bmF2YWlsYWJsZSlcbmNvbnN0IEZBTExCQUNLX0ZYX1JBVEVTOiBSZWNvcmQ8c3RyaW5nLCBudW1iZXI+ID0ge1xuICBVU0Q6IDEuMCxcbiAgR0JQOiAxLjI3LFxuICBFVVI6IDEuMDgsXG4gIEpQWTogMC4wMDY3LFxuICBDQUQ6IDAuNzQsXG4gIEFVRDogMC42NSxcbn07XG5cbi8vIENhY2hlZCBsaXZlIHJhdGVzIHdpdGggZXhwaXJ5XG5sZXQgY2FjaGVkRnhSYXRlczogUmVjb3JkPHN0cmluZywgbnVtYmVyPiB8IG51bGwgPSBudWxsO1xubGV0IGZ4UmF0ZXNDYWNoZUV4cGlyeTogRGF0ZSB8IG51bGwgPSBudWxsO1xuY29uc3QgRlhfQ0FDSEVfVFRMX01TID0gNjAgKiA2MCAqIDEwMDA7IC8vIDEgaG91clxuXG4vKipcbiAqIEZldGNoZXMgbGl2ZSBGWCByYXRlcyBmcm9tIGV4Y2hhbmdlcmF0ZS1hcGkuY29tIChmcmVlIHRpZXI6IDE1MDAgcmVxL21vbnRoKVxuICogRmFsbHMgYmFjayB0byBzdGF0aWMgcmF0ZXMgb24gZXJyb3JcbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGZldGNoTGl2ZUZ4UmF0ZXMoKTogUHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBudW1iZXI+PiB7XG4gIC8vIFJldHVybiBjYWNoZWQgcmF0ZXMgaWYgc3RpbGwgdmFsaWRcbiAgaWYgKGNhY2hlZEZ4UmF0ZXMgJiYgZnhSYXRlc0NhY2hlRXhwaXJ5ICYmIGZ4UmF0ZXNDYWNoZUV4cGlyeSA+IG5ldyBEYXRlKCkpIHtcbiAgICByZXR1cm4gY2FjaGVkRnhSYXRlcztcbiAgfVxuXG4gIHRyeSB7XG4gICAgLy8gVXNpbmcgZXhjaGFuZ2VyYXRlLWFwaS5jb20gZnJlZSB0aWVyIChubyBBUEkga2V5IHJlcXVpcmVkIGZvciBiYXNpYyBlbmRwb2ludClcbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGZldGNoKFxuICAgICAgXCJodHRwczovL2FwaS5leGNoYW5nZXJhdGUtYXBpLmNvbS92NC9sYXRlc3QvVVNEXCIsXG4gICAgICB7IHNpZ25hbDogQWJvcnRTaWduYWwudGltZW91dCg1MDAwKSB9IC8vIDVzIHRpbWVvdXRcbiAgICApO1xuXG4gICAgaWYgKCFyZXNwb25zZS5vaykge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBGWCBBUEkgcmV0dXJuZWQgJHtyZXNwb25zZS5zdGF0dXN9YCk7XG4gICAgfVxuXG4gICAgY29uc3QgZGF0YSA9IGF3YWl0IHJlc3BvbnNlLmpzb24oKTtcbiAgICBjb25zdCByYXRlcyA9IGRhdGEucmF0ZXMgYXMgUmVjb3JkPHN0cmluZywgbnVtYmVyPjtcblxuICAgIC8vIENvbnZlcnQgdG8gVVNELWJhc2VkIHJhdGVzIChhbW91bnQgaW4gY3VycmVuY3kgKiByYXRlID0gVVNEKVxuICAgIGNhY2hlZEZ4UmF0ZXMgPSB7XG4gICAgICBVU0Q6IDEuMCxcbiAgICAgIEdCUDogMSAvIChyYXRlcy5HQlAgfHwgMC43OSksICAgLy8gR0JQIHRvIFVTRFxuICAgICAgRVVSOiAxIC8gKHJhdGVzLkVVUiB8fCAwLjkyKSwgICAvLyBFVVIgdG8gVVNEXG4gICAgICBKUFk6IDEgLyAocmF0ZXMuSlBZIHx8IDE0OSksICAgIC8vIEpQWSB0byBVU0RcbiAgICAgIENBRDogMSAvIChyYXRlcy5DQUQgfHwgMS4zNiksICAgLy8gQ0FEIHRvIFVTRFxuICAgICAgQVVEOiAxIC8gKHJhdGVzLkFVRCB8fCAxLjUzKSwgICAvLyBBVUQgdG8gVVNEXG4gICAgfTtcblxuICAgIGZ4UmF0ZXNDYWNoZUV4cGlyeSA9IG5ldyBEYXRlKERhdGUubm93KCkgKyBGWF9DQUNIRV9UVExfTVMpO1xuXG4gICAgY29uc29sZS5sb2coXCJGZXRjaGVkIGxpdmUgRlggcmF0ZXM6XCIsIGNhY2hlZEZ4UmF0ZXMpO1xuICAgIHJldHVybiBjYWNoZWRGeFJhdGVzO1xuICB9IGNhdGNoIChlcnJvcikge1xuICAgIGNvbnNvbGUud2FybihcIkZhaWxlZCB0byBmZXRjaCBsaXZlIEZYIHJhdGVzLCB1c2luZyBmYWxsYmFjazpcIiwgZXJyb3IpO1xuICAgIHJldHVybiBGQUxMQkFDS19GWF9SQVRFUztcbiAgfVxufVxuXG4vKipcbiAqIEdldHMgY3VycmVudCBGWCByYXRlcyAoY2FjaGVkIG9yIGZhbGxiYWNrKVxuICovXG5leHBvcnQgZnVuY3Rpb24gZ2V0RnhSYXRlcygpOiBSZWNvcmQ8c3RyaW5nLCBudW1iZXI+IHtcbiAgcmV0dXJuIGNhY2hlZEZ4UmF0ZXMgfHwgRkFMTEJBQ0tfRlhfUkFURVM7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBjb252ZXJ0VG9Vc2QoYW1vdW50OiBudW1iZXIsIGN1cnJlbmN5OiBzdHJpbmcpOiBudW1iZXIge1xuICBjb25zdCByYXRlcyA9IGdldEZ4UmF0ZXMoKTtcbiAgY29uc3QgcmF0ZSA9IHJhdGVzW2N1cnJlbmN5LnRvVXBwZXJDYXNlKCldIHx8IDE7XG4gIHJldHVybiBhbW91bnQgKiByYXRlO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gY29udmVydFRvR2JwKGFtb3VudFVzZDogbnVtYmVyKTogbnVtYmVyIHtcbiAgY29uc3QgcmF0ZXMgPSBnZXRGeFJhdGVzKCk7XG4gIHJldHVybiBhbW91bnRVc2QgLyByYXRlcy5HQlA7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBub3JtYWxpemVQcmljZShcbiAgcHJpY2U6IG51bWJlcixcbiAgY3VycmVuY3k6IHN0cmluZ1xuKTogeyBwcmljZVVzZDogbnVtYmVyOyBwcmljZUdicDogbnVtYmVyIH0ge1xuICBjb25zdCBwcmljZVVzZCA9IGNvbnZlcnRUb1VzZChwcmljZSwgY3VycmVuY3kpO1xuICBjb25zdCBwcmljZUdicCA9IGNvbnZlcnRUb0dicChwcmljZVVzZCk7XG4gIHJldHVybiB7IHByaWNlVXNkLCBwcmljZUdicCB9O1xufVxuXG4vKipcbiAqIEFzeW5jIHZlcnNpb24gdGhhdCBlbnN1cmVzIGxpdmUgcmF0ZXMgYXJlIGxvYWRlZCBmaXJzdFxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gbm9ybWFsaXplUHJpY2VBc3luYyhcbiAgcHJpY2U6IG51bWJlcixcbiAgY3VycmVuY3k6IHN0cmluZ1xuKTogUHJvbWlzZTx7IHByaWNlVXNkOiBudW1iZXI7IHByaWNlR2JwOiBudW1iZXIgfT4ge1xuICBhd2FpdCBmZXRjaExpdmVGeFJhdGVzKCk7XG4gIHJldHVybiBub3JtYWxpemVQcmljZShwcmljZSwgY3VycmVuY3kpO1xufVxuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gQ0FSRCBJRCBOT1JNQUxJWkFUSU9OXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG5leHBvcnQgZnVuY3Rpb24gbm9ybWFsaXplQ2FyZElkKFxuICBzZXRDb2RlOiBzdHJpbmcsXG4gIGNhcmROdW1iZXI6IHN0cmluZyxcbiAgdmFyaWFudFR5cGU/OiBzdHJpbmdcbik6IHN0cmluZyB7XG4gIGNvbnN0IGJhc2VJZCA9IGAke3NldENvZGUudG9VcHBlckNhc2UoKX0tJHtjYXJkTnVtYmVyLnBhZFN0YXJ0KDMsIFwiMFwiKX1gO1xuICBpZiAodmFyaWFudFR5cGUgJiYgdmFyaWFudFR5cGUgIT09IFwicmVndWxhclwiKSB7XG4gICAgcmV0dXJuIGAke2Jhc2VJZH0tJHt2YXJpYW50VHlwZS50b0xvd2VyQ2FzZSgpfWA7XG4gIH1cbiAgcmV0dXJuIGJhc2VJZDtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlQ2FyZE51bWJlcihpbnB1dDogc3RyaW5nKToge1xuICBzZXRDb2RlOiBzdHJpbmc7XG4gIGNhcmROdW1iZXI6IHN0cmluZztcbiAgdmFyaWFudFR5cGU6IHN0cmluZztcbn0ge1xuICAvLyBIYW5kbGUgZm9ybWF0cyBsaWtlIFwiT1AwMS0xMjFcIiwgXCJPUDAxLTEyMS1wYXJhbGxlbFwiLCBcIk9QMDEtMTIxIChQYXJhbGxlbClcIlxuICBjb25zdCBjbGVhbklucHV0ID0gaW5wdXQudG9VcHBlckNhc2UoKS50cmltKCk7XG5cbiAgLy8gVHJ5IHRvIG1hdGNoIHBhdHRlcm46IFNFVC1OVU1CRVJbLVZBUklBTlRdXG4gIGNvbnN0IG1hdGNoID0gY2xlYW5JbnB1dC5tYXRjaCgvXihbQS1aXStcXGQrKS0oXFxkKykoPzotKFtBLVpdKykpPyQvaSk7XG5cbiAgaWYgKG1hdGNoKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIHNldENvZGU6IG1hdGNoWzFdLFxuICAgICAgY2FyZE51bWJlcjogbWF0Y2hbMl0sXG4gICAgICB2YXJpYW50VHlwZTogbWF0Y2hbM10/LnRvTG93ZXJDYXNlKCkgfHwgXCJyZWd1bGFyXCIsXG4gICAgfTtcbiAgfVxuXG4gIC8vIFRyeSB0byBleHRyYWN0IHZhcmlhbnQgZnJvbSBwYXJlbnRoZXNlc1xuICBjb25zdCBwYXJlbk1hdGNoID0gY2xlYW5JbnB1dC5tYXRjaCgvXihbQS1aXStcXGQrKS0oXFxkKylcXHMqXFwoKFteKV0rKVxcKSQvaSk7XG4gIGlmIChwYXJlbk1hdGNoKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIHNldENvZGU6IHBhcmVuTWF0Y2hbMV0sXG4gICAgICBjYXJkTnVtYmVyOiBwYXJlbk1hdGNoWzJdLFxuICAgICAgdmFyaWFudFR5cGU6IHBhcmVuTWF0Y2hbM10udG9Mb3dlckNhc2UoKS5yZXBsYWNlKC9cXHMrL2csIFwiXCIpLFxuICAgIH07XG4gIH1cblxuICAvLyBGYWxsYmFja1xuICByZXR1cm4ge1xuICAgIHNldENvZGU6IFwiXCIsXG4gICAgY2FyZE51bWJlcjogaW5wdXQsXG4gICAgdmFyaWFudFR5cGU6IFwicmVndWxhclwiLFxuICB9O1xufVxuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gQ09ORElUSU9OIE5PUk1BTElaQVRJT05cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbmNvbnN0IENPTkRJVElPTl9NQVA6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7XG4gIC8vIE5lYXIgTWludCB2YXJpYW50c1xuICBubTogXCJOTVwiLFxuICBcIm5lYXIgbWludFwiOiBcIk5NXCIsXG4gIG5lYXJtaW50OiBcIk5NXCIsXG4gIG1pbnQ6IFwiTk1cIixcbiAgbTogXCJOTVwiLFxuICBcIm0vbm1cIjogXCJOTVwiLFxuICBuZXc6IFwiTk1cIixcbiAgXCJicmFuZCBuZXdcIjogXCJOTVwiLFxuXG4gIC8vIExpZ2h0bHkgUGxheWVkIHZhcmlhbnRzXG4gIGxwOiBcIkxQXCIsXG4gIFwibGlnaHRseSBwbGF5ZWRcIjogXCJMUFwiLFxuICBsaWdodGx5cGxheWVkOiBcIkxQXCIsXG4gIFwibGlnaHQgcGxheVwiOiBcIkxQXCIsXG4gIHNwOiBcIkxQXCIsIC8vIFNsaWdodGx5IFBsYXllZCA9IExQXG4gIGV4OiBcIkxQXCIsIC8vIEV4Y2VsbGVudCA9IExQXG4gIGV4Y2VsbGVudDogXCJMUFwiLFxuICBcInZlcnkgZ29vZFwiOiBcIkxQXCIsXG4gIHZnOiBcIkxQXCIsXG5cbiAgLy8gTW9kZXJhdGVseSBQbGF5ZWQgdmFyaWFudHNcbiAgbXA6IFwiTVBcIixcbiAgXCJtb2RlcmF0ZWx5IHBsYXllZFwiOiBcIk1QXCIsXG4gIG1vZGVyYXRlbHlwbGF5ZWQ6IFwiTVBcIixcbiAgXCJtb2RlcmF0ZSBwbGF5XCI6IFwiTVBcIixcbiAgZ2Q6IFwiTVBcIiwgLy8gR29vZCA9IE1QXG4gIGdvb2Q6IFwiTVBcIixcbiAgcGw6IFwiTVBcIiwgLy8gUGxheWVkID0gTVBcbiAgcGxheWVkOiBcIk1QXCIsXG5cbiAgLy8gSGVhdmlseSBQbGF5ZWQgdmFyaWFudHNcbiAgaHA6IFwiSFBcIixcbiAgXCJoZWF2aWx5IHBsYXllZFwiOiBcIkhQXCIsXG4gIGhlYXZpbHlwbGF5ZWQ6IFwiSFBcIixcbiAgXCJoZWF2eSBwbGF5XCI6IFwiSFBcIixcbiAgcG9vcjogXCJIUFwiLFxuXG4gIC8vIERhbWFnZWQgdmFyaWFudHNcbiAgZG1nOiBcIkRNR1wiLFxuICBkYW1hZ2VkOiBcIkRNR1wiLFxuICBkOiBcIkRNR1wiLFxuXG4gIC8vIEphcGFuZXNlIGNvbmRpdGlvbiB0ZXJtc1xuICBcIuaWsOWTgeacquS9v+eUqFwiOiBcIk5NXCIsXG4gIFwi5pyq5L2/55SoXCI6IFwiTk1cIixcbiAgXCLmnKrkvb/nlKjjgavov5HjgYRcIjogXCJOTVwiLFxuICBcIuebrueri+OBo+OBn+WCt+OChOaxmuOCjOOBquOBl1wiOiBcIkxQXCIsXG4gIFwi44KE44KE5YK344KE5rGa44KM44GC44KKXCI6IFwiTVBcIixcbiAgXCLlgrfjgoTmsZrjgozjgYLjgopcIjogXCJIUFwiLFxuICBcIuWFqOS9k+eahOOBq+eKtuaFi+OBjOaCquOBhFwiOiBcIkRNR1wiLFxufTtcblxuZXhwb3J0IGludGVyZmFjZSBDb25kaXRpb25SZXN1bHQge1xuICBjb25kaXRpb246IHN0cmluZztcbiAgaXNLbm93bjogYm9vbGVhbjtcbiAgb3JpZ2luYWw6IHN0cmluZztcbn1cblxuLyoqXG4gKiBOb3JtYWxpemVzIGNvbmRpdGlvbiBzdHJpbmcgdG8gc3RhbmRhcmQgY29kZXNcbiAqIFJldHVybnMgVU5LTk9XTiBpbnN0ZWFkIG9mIGRlZmF1bHRpbmcgdG8gTk0gZm9yIHRyYWNraW5nIHB1cnBvc2VzXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBub3JtYWxpemVDb25kaXRpb25XaXRoVHJhY2tpbmcoY29uZGl0aW9uOiBzdHJpbmcpOiBDb25kaXRpb25SZXN1bHQge1xuICBjb25zdCB0cmltbWVkID0gY29uZGl0aW9uLnRyaW0oKTtcbiAgY29uc3Qgbm9ybWFsaXplZCA9IENPTkRJVElPTl9NQVBbdHJpbW1lZC50b0xvd2VyQ2FzZSgpXTtcblxuICByZXR1cm4ge1xuICAgIGNvbmRpdGlvbjogbm9ybWFsaXplZCB8fCBcIlVOS05PV05cIixcbiAgICBpc0tub3duOiAhIW5vcm1hbGl6ZWQsXG4gICAgb3JpZ2luYWw6IHRyaW1tZWQsXG4gIH07XG59XG5cbi8qKlxuICogTGVnYWN5IGZ1bmN0aW9uIHRoYXQgZGVmYXVsdHMgdG8gTk0gZm9yIGJhY2t3YXJkIGNvbXBhdGliaWxpdHlcbiAqIEBkZXByZWNhdGVkIFVzZSBub3JtYWxpemVDb25kaXRpb25XaXRoVHJhY2tpbmcgZm9yIG5ldyBjb2RlXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBub3JtYWxpemVDb25kaXRpb24oY29uZGl0aW9uOiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCByZXN1bHQgPSBub3JtYWxpemVDb25kaXRpb25XaXRoVHJhY2tpbmcoY29uZGl0aW9uKTtcbiAgcmV0dXJuIHJlc3VsdC5pc0tub3duID8gcmVzdWx0LmNvbmRpdGlvbiA6IFwiTk1cIjtcbn1cblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIFJBVEUgTElNSVRJTkdcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbmV4cG9ydCBjbGFzcyBSYXRlTGltaXRlciB7XG4gIHByaXZhdGUgdG9rZW5zOiBudW1iZXI7XG4gIHByaXZhdGUgbGFzdFJlZmlsbDogbnVtYmVyO1xuICBwcml2YXRlIG1heFRva2VuczogbnVtYmVyO1xuICBwcml2YXRlIHJlZmlsbFJhdGU6IG51bWJlcjsgLy8gdG9rZW5zIHBlciBzZWNvbmRcblxuICBjb25zdHJ1Y3RvcihtYXhUb2tlbnM6IG51bWJlciwgcmVmaWxsUmF0ZTogbnVtYmVyKSB7XG4gICAgdGhpcy5tYXhUb2tlbnMgPSBtYXhUb2tlbnM7XG4gICAgdGhpcy50b2tlbnMgPSBtYXhUb2tlbnM7XG4gICAgdGhpcy5yZWZpbGxSYXRlID0gcmVmaWxsUmF0ZTtcbiAgICB0aGlzLmxhc3RSZWZpbGwgPSBEYXRlLm5vdygpO1xuICB9XG5cbiAgcHJpdmF0ZSByZWZpbGwoKTogdm9pZCB7XG4gICAgY29uc3Qgbm93ID0gRGF0ZS5ub3coKTtcbiAgICBjb25zdCBlbGFwc2VkID0gKG5vdyAtIHRoaXMubGFzdFJlZmlsbCkgLyAxMDAwO1xuICAgIHRoaXMudG9rZW5zID0gTWF0aC5taW4odGhpcy5tYXhUb2tlbnMsIHRoaXMudG9rZW5zICsgZWxhcHNlZCAqIHRoaXMucmVmaWxsUmF0ZSk7XG4gICAgdGhpcy5sYXN0UmVmaWxsID0gbm93O1xuICB9XG5cbiAgYXN5bmMgYWNxdWlyZShjb3VudDogbnVtYmVyID0gMSk6IFByb21pc2U8dm9pZD4ge1xuICAgIHRoaXMucmVmaWxsKCk7XG5cbiAgICBpZiAodGhpcy50b2tlbnMgPj0gY291bnQpIHtcbiAgICAgIHRoaXMudG9rZW5zIC09IGNvdW50O1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIC8vIFdhaXQgZm9yIHRva2VucyB0byBiZSBhdmFpbGFibGVcbiAgICBjb25zdCB3YWl0VGltZSA9ICgoY291bnQgLSB0aGlzLnRva2VucykgLyB0aGlzLnJlZmlsbFJhdGUpICogMTAwMDtcbiAgICBhd2FpdCBzbGVlcCh3YWl0VGltZSk7XG4gICAgdGhpcy5yZWZpbGwoKTtcbiAgICB0aGlzLnRva2VucyAtPSBjb3VudDtcbiAgfVxufVxuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gUkVUUlkgSEVMUEVSU1xuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuZXhwb3J0IGludGVyZmFjZSBSZXRyeU9wdGlvbnMge1xuICBtYXhSZXRyaWVzOiBudW1iZXI7XG4gIGJhc2VEZWxheU1zOiBudW1iZXI7XG4gIG1heERlbGF5TXM6IG51bWJlcjtcbn1cblxuY29uc3QgREVGQVVMVF9SRVRSWV9PUFRJT05TOiBSZXRyeU9wdGlvbnMgPSB7XG4gIG1heFJldHJpZXM6IDMsXG4gIGJhc2VEZWxheU1zOiAxMDAwLFxuICBtYXhEZWxheU1zOiAzMDAwMCxcbn07XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiB3aXRoUmV0cnk8VD4oXG4gIGZuOiAoKSA9PiBQcm9taXNlPFQ+LFxuICBvcHRpb25zOiBQYXJ0aWFsPFJldHJ5T3B0aW9ucz4gPSB7fVxuKTogUHJvbWlzZTxUPiB7XG4gIGNvbnN0IG9wdHMgPSB7IC4uLkRFRkFVTFRfUkVUUllfT1BUSU9OUywgLi4ub3B0aW9ucyB9O1xuICBsZXQgbGFzdEVycm9yOiBFcnJvciB8IG51bGwgPSBudWxsO1xuXG4gIGZvciAobGV0IGF0dGVtcHQgPSAwOyBhdHRlbXB0IDw9IG9wdHMubWF4UmV0cmllczsgYXR0ZW1wdCsrKSB7XG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiBhd2FpdCBmbigpO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBsYXN0RXJyb3IgPSBlcnJvciBhcyBFcnJvcjtcbiAgICAgIGNvbnNvbGUuZXJyb3IoYEF0dGVtcHQgJHthdHRlbXB0ICsgMX0gZmFpbGVkOmAsIGVycm9yKTtcblxuICAgICAgaWYgKGF0dGVtcHQgPCBvcHRzLm1heFJldHJpZXMpIHtcbiAgICAgICAgY29uc3QgZGVsYXkgPSBNYXRoLm1pbihcbiAgICAgICAgICBvcHRzLmJhc2VEZWxheU1zICogTWF0aC5wb3coMiwgYXR0ZW1wdCkgKyBNYXRoLnJhbmRvbSgpICogMTAwMCxcbiAgICAgICAgICBvcHRzLm1heERlbGF5TXNcbiAgICAgICAgKTtcbiAgICAgICAgY29uc29sZS5sb2coYFJldHJ5aW5nIGluICR7ZGVsYXl9bXMuLi5gKTtcbiAgICAgICAgYXdhaXQgc2xlZXAoZGVsYXkpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHRocm93IGxhc3RFcnJvcjtcbn1cblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIFVUSUxJVFkgRlVOQ1RJT05TXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG5leHBvcnQgZnVuY3Rpb24gY2h1bmtBcnJheTxUPihhcnJheTogVFtdLCBzaXplOiBudW1iZXIpOiBUW11bXSB7XG4gIGNvbnN0IGNodW5rczogVFtdW10gPSBbXTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBhcnJheS5sZW5ndGg7IGkgKz0gc2l6ZSkge1xuICAgIGNodW5rcy5wdXNoKGFycmF5LnNsaWNlKGksIGkgKyBzaXplKSk7XG4gIH1cbiAgcmV0dXJuIGNodW5rcztcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHNsZWVwKG1zOiBudW1iZXIpOiBQcm9taXNlPHZvaWQ+IHtcbiAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiBzZXRUaW1lb3V0KHJlc29sdmUsIG1zKSk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBub3dJc28oKTogc3RyaW5nIHtcbiAgcmV0dXJuIG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHNhbml0aXplU3RyaW5nKHN0cjogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIHN0ci5yZXBsYWNlKC9bXlxceDIwLVxceDdFXS9nLCBcIlwiKS50cmltKCk7XG59XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBEQVRBIFFVQUxJVFkgVFJBQ0tJTkdcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbmV4cG9ydCBpbnRlcmZhY2UgRHJvcHBlZFJlY29yZCB7XG4gIHNvdXJjZTogc3RyaW5nO1xuICByZWFzb246IHN0cmluZztcbiAgdGl0bGU/OiBzdHJpbmc7XG4gIHJhd0RhdGE/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgdGltZXN0YW1wOiBzdHJpbmc7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgRGF0YVF1YWxpdHlNZXRyaWNzIHtcbiAgc291cmNlOiBzdHJpbmc7XG4gIHRvdGFsUHJvY2Vzc2VkOiBudW1iZXI7XG4gIHN1Y2Nlc3NmdWxseVBhcnNlZDogbnVtYmVyO1xuICBkcm9wcGVkOiBudW1iZXI7XG4gIGRyb3BwZWRCeVJlYXNvbjogUmVjb3JkPHN0cmluZywgbnVtYmVyPjtcbiAgdW5rbm93bkNvbmRpdGlvbnM6IG51bWJlcjtcbiAgZnV6enlNYXRjaGVkOiBudW1iZXI7XG4gIGNvbGxlY3RlZEF0OiBzdHJpbmc7XG59XG5cbmNsYXNzIERhdGFRdWFsaXR5VHJhY2tlciB7XG4gIHByaXZhdGUgbWV0cmljczogTWFwPHN0cmluZywgRGF0YVF1YWxpdHlNZXRyaWNzPiA9IG5ldyBNYXAoKTtcbiAgcHJpdmF0ZSBkcm9wcGVkUmVjb3JkczogRHJvcHBlZFJlY29yZFtdID0gW107XG4gIHByaXZhdGUgbWF4RHJvcHBlZFJlY29yZHMgPSAxMDAwOyAvLyBMaW1pdCBtZW1vcnkgdXNhZ2VcblxuICBnZXRPckNyZWF0ZU1ldHJpY3Moc291cmNlOiBzdHJpbmcpOiBEYXRhUXVhbGl0eU1ldHJpY3Mge1xuICAgIGlmICghdGhpcy5tZXRyaWNzLmhhcyhzb3VyY2UpKSB7XG4gICAgICB0aGlzLm1ldHJpY3Muc2V0KHNvdXJjZSwge1xuICAgICAgICBzb3VyY2UsXG4gICAgICAgIHRvdGFsUHJvY2Vzc2VkOiAwLFxuICAgICAgICBzdWNjZXNzZnVsbHlQYXJzZWQ6IDAsXG4gICAgICAgIGRyb3BwZWQ6IDAsXG4gICAgICAgIGRyb3BwZWRCeVJlYXNvbjoge30sXG4gICAgICAgIHVua25vd25Db25kaXRpb25zOiAwLFxuICAgICAgICBmdXp6eU1hdGNoZWQ6IDAsXG4gICAgICAgIGNvbGxlY3RlZEF0OiBub3dJc28oKSxcbiAgICAgIH0pO1xuICAgIH1cbiAgICByZXR1cm4gdGhpcy5tZXRyaWNzLmdldChzb3VyY2UpITtcbiAgfVxuXG4gIHJlY29yZFN1Y2Nlc3Moc291cmNlOiBzdHJpbmcsIG9wdGlvbnM/OiB7IGZ1enp5TWF0Y2hlZD86IGJvb2xlYW47IHVua25vd25Db25kaXRpb24/OiBib29sZWFuIH0pOiB2b2lkIHtcbiAgICBjb25zdCBtZXRyaWNzID0gdGhpcy5nZXRPckNyZWF0ZU1ldHJpY3Moc291cmNlKTtcbiAgICBtZXRyaWNzLnRvdGFsUHJvY2Vzc2VkKys7XG4gICAgbWV0cmljcy5zdWNjZXNzZnVsbHlQYXJzZWQrKztcbiAgICBpZiAob3B0aW9ucz8uZnV6enlNYXRjaGVkKSBtZXRyaWNzLmZ1enp5TWF0Y2hlZCsrO1xuICAgIGlmIChvcHRpb25zPy51bmtub3duQ29uZGl0aW9uKSBtZXRyaWNzLnVua25vd25Db25kaXRpb25zKys7XG4gIH1cblxuICByZWNvcmREcm9wcGVkKFxuICAgIHNvdXJjZTogc3RyaW5nLFxuICAgIHJlYXNvbjogc3RyaW5nLFxuICAgIGRldGFpbHM/OiB7IHRpdGxlPzogc3RyaW5nOyByYXdEYXRhPzogUmVjb3JkPHN0cmluZywgdW5rbm93bj4gfVxuICApOiB2b2lkIHtcbiAgICBjb25zdCBtZXRyaWNzID0gdGhpcy5nZXRPckNyZWF0ZU1ldHJpY3Moc291cmNlKTtcbiAgICBtZXRyaWNzLnRvdGFsUHJvY2Vzc2VkKys7XG4gICAgbWV0cmljcy5kcm9wcGVkKys7XG4gICAgbWV0cmljcy5kcm9wcGVkQnlSZWFzb25bcmVhc29uXSA9IChtZXRyaWNzLmRyb3BwZWRCeVJlYXNvbltyZWFzb25dIHx8IDApICsgMTtcblxuICAgIC8vIFN0b3JlIHNhbXBsZSBvZiBkcm9wcGVkIHJlY29yZHMgZm9yIGRlYnVnZ2luZ1xuICAgIGlmICh0aGlzLmRyb3BwZWRSZWNvcmRzLmxlbmd0aCA8IHRoaXMubWF4RHJvcHBlZFJlY29yZHMpIHtcbiAgICAgIHRoaXMuZHJvcHBlZFJlY29yZHMucHVzaCh7XG4gICAgICAgIHNvdXJjZSxcbiAgICAgICAgcmVhc29uLFxuICAgICAgICB0aXRsZTogZGV0YWlscz8udGl0bGUsXG4gICAgICAgIHJhd0RhdGE6IGRldGFpbHM/LnJhd0RhdGEsXG4gICAgICAgIHRpbWVzdGFtcDogbm93SXNvKCksXG4gICAgICB9KTtcbiAgICB9XG4gIH1cblxuICBnZXRNZXRyaWNzKCk6IERhdGFRdWFsaXR5TWV0cmljc1tdIHtcbiAgICByZXR1cm4gQXJyYXkuZnJvbSh0aGlzLm1ldHJpY3MudmFsdWVzKCkpO1xuICB9XG5cbiAgZ2V0RHJvcHBlZFJlY29yZHMoKTogRHJvcHBlZFJlY29yZFtdIHtcbiAgICByZXR1cm4gdGhpcy5kcm9wcGVkUmVjb3JkcztcbiAgfVxuXG4gIGxvZ1N1bW1hcnkoKTogdm9pZCB7XG4gICAgZm9yIChjb25zdCBtZXRyaWNzIG9mIHRoaXMubWV0cmljcy52YWx1ZXMoKSkge1xuICAgICAgY29uc3QgZHJvcFJhdGUgPSBtZXRyaWNzLnRvdGFsUHJvY2Vzc2VkID4gMFxuICAgICAgICA/ICgobWV0cmljcy5kcm9wcGVkIC8gbWV0cmljcy50b3RhbFByb2Nlc3NlZCkgKiAxMDApLnRvRml4ZWQoMSlcbiAgICAgICAgOiBcIjBcIjtcblxuICAgICAgY29uc29sZS5sb2coYFtEYXRhUXVhbGl0eV0gJHttZXRyaWNzLnNvdXJjZX06YCk7XG4gICAgICBjb25zb2xlLmxvZyhgICBUb3RhbDogJHttZXRyaWNzLnRvdGFsUHJvY2Vzc2VkfSwgUGFyc2VkOiAke21ldHJpY3Muc3VjY2Vzc2Z1bGx5UGFyc2VkfSwgRHJvcHBlZDogJHttZXRyaWNzLmRyb3BwZWR9ICgke2Ryb3BSYXRlfSUpYCk7XG4gICAgICBjb25zb2xlLmxvZyhgICBVbmtub3duIGNvbmRpdGlvbnM6ICR7bWV0cmljcy51bmtub3duQ29uZGl0aW9uc30sIEZ1enp5IG1hdGNoZWQ6ICR7bWV0cmljcy5mdXp6eU1hdGNoZWR9YCk7XG5cbiAgICAgIGlmIChPYmplY3Qua2V5cyhtZXRyaWNzLmRyb3BwZWRCeVJlYXNvbikubGVuZ3RoID4gMCkge1xuICAgICAgICBjb25zb2xlLmxvZyhgICBEcm9wIHJlYXNvbnM6YCwgbWV0cmljcy5kcm9wcGVkQnlSZWFzb24pO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHJlc2V0KCk6IHZvaWQge1xuICAgIHRoaXMubWV0cmljcy5jbGVhcigpO1xuICAgIHRoaXMuZHJvcHBlZFJlY29yZHMgPSBbXTtcbiAgfVxufVxuXG4vLyBHbG9iYWwgdHJhY2tlciBpbnN0YW5jZVxuZXhwb3J0IGNvbnN0IGRhdGFRdWFsaXR5VHJhY2tlciA9IG5ldyBEYXRhUXVhbGl0eVRyYWNrZXIoKTtcblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIEZVWlpZIENBUkQgTUFUQ0hJTkdcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbi8vIEtub3duIGNhcmQgbmFtZXMgdG8gc2V0IG1hcHBpbmdzIGZvciBmdXp6eSBtYXRjaGluZ1xuY29uc3QgQ0FSRF9OQU1FX1BBVFRFUk5TOiBBcnJheTx7IHBhdHRlcm46IFJlZ0V4cDsgc2V0Q29kZTogc3RyaW5nOyBjYXJkTnVtYmVyPzogc3RyaW5nIH0+ID0gW1xuICAvLyBDaGFyYWN0ZXIgbmFtZSBwYXR0ZXJucyB0aGF0IGNhbiBoZWxwIGlkZW50aWZ5IGNhcmRzXG4gIHsgcGF0dGVybjogL1xcYmx1ZmZ5XFxiL2ksIHNldENvZGU6IFwiT1BcIiB9LFxuICB7IHBhdHRlcm46IC9cXGJ6b3JvXFxiL2ksIHNldENvZGU6IFwiT1BcIiB9LFxuICB7IHBhdHRlcm46IC9cXGJuYW1pXFxiL2ksIHNldENvZGU6IFwiT1BcIiB9LFxuICB7IHBhdHRlcm46IC9cXGJzYW5qaVxcYi9pLCBzZXRDb2RlOiBcIk9QXCIgfSxcbiAgeyBwYXR0ZXJuOiAvXFxicm9iaW5cXGIvaSwgc2V0Q29kZTogXCJPUFwiIH0sXG4gIHsgcGF0dGVybjogL1xcYmNob3BwZXJcXGIvaSwgc2V0Q29kZTogXCJPUFwiIH0sXG4gIHsgcGF0dGVybjogL1xcYmZyYW5reVxcYi9pLCBzZXRDb2RlOiBcIk9QXCIgfSxcbiAgeyBwYXR0ZXJuOiAvXFxiYnJvb2tcXGIvaSwgc2V0Q29kZTogXCJPUFwiIH0sXG4gIHsgcGF0dGVybjogL1xcYmppbmJlXFxiL2ksIHNldENvZGU6IFwiT1BcIiB9LFxuICB7IHBhdHRlcm46IC9cXGJzaGFuay9pLCBzZXRDb2RlOiBcIk9QXCIgfSxcbiAgeyBwYXR0ZXJuOiAvXFxia2FpZG9cXGIvaSwgc2V0Q29kZTogXCJPUFwiIH0sXG4gIHsgcGF0dGVybjogL1xcYmFjZVxcYi9pLCBzZXRDb2RlOiBcIk9QXCIgfSxcbiAgeyBwYXR0ZXJuOiAvXFxibGF3XFxiL2ksIHNldENvZGU6IFwiT1BcIiB9LFxuICB7IHBhdHRlcm46IC9cXGJraWRcXGIvaSwgc2V0Q29kZTogXCJPUFwiIH0sXG4gIHsgcGF0dGVybjogL1xcYnlhbWF0b1xcYi9pLCBzZXRDb2RlOiBcIk9QXCIgfSxcbl07XG5cbi8vIEFsdGVybmF0aXZlIGNhcmQgbnVtYmVyIGZvcm1hdHMgdG8gdHJ5XG5jb25zdCBDQVJEX05VTUJFUl9QQVRURVJOUyA9IFtcbiAgLy8gU3RhbmRhcmQ6IE9QMDEtMTIxLCBFQjAxLTA0NVxuICAvKFtBLVpdezIsM31cXGR7Mn0pLShcXGR7M30pL2ksXG4gIC8vIFdpdGggc3BhY2VzOiBPUDAxIC0gMTIxLCBPUCAwMS0xMjFcbiAgLyhbQS1aXXsyLDN9KVxccyooXFxkezJ9KVxccypbLeKAk11cXHMqKFxcZHsyLDN9KS9pLFxuICAvLyBObyBkYXNoOiBPUDAxMTIxXG4gIC8oW0EtWl17MiwzfSkoXFxkezJ9KShcXGR7M30pL2ksXG4gIC8vIEphcGFuZXNlIGZvcm1hdDogT1AwMSDjg6vjg5XjgqMgMTIxXG4gIC8oW0EtWl17MiwzfVxcZHsyfSlbXlxcZF0qKFxcZHszfSkvaSxcbiAgLy8gQWx0ZXJuYXRlIHNlcGFyYXRvcnM6IE9QMDEvMTIxLCBPUDAxLjEyMVxuICAvKFtBLVpdezIsM31cXGR7Mn0pW1xcL1xcLl0oXFxkezN9KS9pLFxuXTtcblxuZXhwb3J0IGludGVyZmFjZSBGdXp6eU1hdGNoUmVzdWx0IHtcbiAgc2V0Q29kZTogc3RyaW5nO1xuICBjYXJkTnVtYmVyOiBzdHJpbmc7XG4gIHZhcmlhbnRUeXBlOiBzdHJpbmc7XG4gIGNvbmZpZGVuY2U6IFwiaGlnaFwiIHwgXCJtZWRpdW1cIiB8IFwibG93XCI7XG4gIG1hdGNoTWV0aG9kOiBzdHJpbmc7XG59XG5cbi8qKlxuICogQXR0ZW1wdHMgdG8gZXh0cmFjdCBjYXJkIGluZm8gdXNpbmcgbXVsdGlwbGUgcGF0dGVybiBtYXRjaGluZyBzdHJhdGVnaWVzXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBmdXp6eU1hdGNoQ2FyZCh0aXRsZTogc3RyaW5nKTogRnV6enlNYXRjaFJlc3VsdCB8IG51bGwge1xuICBjb25zdCBjbGVhblRpdGxlID0gdGl0bGUudHJpbSgpO1xuXG4gIC8vIFRyeSBlYWNoIGNhcmQgbnVtYmVyIHBhdHRlcm4gaW4gb3JkZXIgb2YgcmVsaWFiaWxpdHlcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBDQVJEX05VTUJFUl9QQVRURVJOUy5sZW5ndGg7IGkrKykge1xuICAgIGNvbnN0IHBhdHRlcm4gPSBDQVJEX05VTUJFUl9QQVRURVJOU1tpXTtcbiAgICBjb25zdCBtYXRjaCA9IGNsZWFuVGl0bGUubWF0Y2gocGF0dGVybik7XG5cbiAgICBpZiAobWF0Y2gpIHtcbiAgICAgIGxldCBzZXRDb2RlOiBzdHJpbmc7XG4gICAgICBsZXQgY2FyZE51bWJlcjogc3RyaW5nO1xuXG4gICAgICBpZiAobWF0Y2gubGVuZ3RoID09PSA0KSB7XG4gICAgICAgIC8vIFBhdHRlcm4gd2l0aCBzZXBhcmF0ZSBzZXQgcGFydHMgKGUuZy4sIE9QIDAxLTEyMSlcbiAgICAgICAgc2V0Q29kZSA9IGAke21hdGNoWzFdfSR7bWF0Y2hbMl19YC50b1VwcGVyQ2FzZSgpO1xuICAgICAgICBjYXJkTnVtYmVyID0gbWF0Y2hbM10ucGFkU3RhcnQoMywgXCIwXCIpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgc2V0Q29kZSA9IG1hdGNoWzFdLnRvVXBwZXJDYXNlKCk7XG4gICAgICAgIGNhcmROdW1iZXIgPSBtYXRjaFsyXS5wYWRTdGFydCgzLCBcIjBcIik7XG4gICAgICB9XG5cbiAgICAgIC8vIERldGVjdCB2YXJpYW50IHR5cGVcbiAgICAgIGNvbnN0IHZhcmlhbnRUeXBlID0gZGV0ZWN0VmFyaWFudFR5cGUoY2xlYW5UaXRsZSk7XG5cbiAgICAgIHJldHVybiB7XG4gICAgICAgIHNldENvZGUsXG4gICAgICAgIGNhcmROdW1iZXIsXG4gICAgICAgIHZhcmlhbnRUeXBlLFxuICAgICAgICBjb25maWRlbmNlOiBpID09PSAwID8gXCJoaWdoXCIgOiBcIm1lZGl1bVwiLFxuICAgICAgICBtYXRjaE1ldGhvZDogYHBhdHRlcm5fJHtpfWAsXG4gICAgICB9O1xuICAgIH1cbiAgfVxuXG4gIC8vIExvdyBjb25maWRlbmNlOiB0cnkgdG8gbWF0Y2ggYnkga25vd24gY2hhcmFjdGVyIG5hbWVzXG4gIGZvciAoY29uc3QgeyBwYXR0ZXJuLCBzZXRDb2RlIH0gb2YgQ0FSRF9OQU1FX1BBVFRFUk5TKSB7XG4gICAgaWYgKHBhdHRlcm4udGVzdChjbGVhblRpdGxlKSkge1xuICAgICAgLy8gQ2FuIGlkZW50aWZ5IGl0J3MgYSBPbmUgUGllY2UgY2FyZCBidXQgY2FuJ3QgZ2V0IGV4YWN0IG51bWJlclxuICAgICAgLy8gUmV0dXJuIG51bGwgYnV0IGxvZyBmb3IgcG90ZW50aWFsIG1hbnVhbCByZXZpZXdcbiAgICAgIGNvbnNvbGUubG9nKGBbRnV6enlNYXRjaF0gUG90ZW50aWFsICR7c2V0Q29kZX0gY2FyZCBkZXRlY3RlZCBidXQgbm8gY2FyZCBudW1iZXI6IFwiJHt0aXRsZX1cImApO1xuICAgICAgYnJlYWs7XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIG51bGw7XG59XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBWQVJJQU5UIERFVEVDVElPTiAoU1RBTkRBUkRJWkVEKVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuY29uc3QgVkFSSUFOVF9QQVRURVJOUzogQXJyYXk8eyB0eXBlOiBzdHJpbmc7IHBhdHRlcm5zOiBSZWdFeHBbXSB9PiA9IFtcbiAge1xuICAgIHR5cGU6IFwicGFyYWxsZWxcIixcbiAgICBwYXR0ZXJuczogW1xuICAgICAgL1xcYnBhcmFsbGVsXFxiL2ksXG4gICAgICAvXFxiYWx0XFxzKmFydFxcYi9pLFxuICAgICAgL1xcYmFsdGVybmF0ZVxccyphcnRcXGIvaSxcbiAgICAgIC9cXGLjg5Hjg6njg6zjg6svLFxuICAgICAgL1xcYkFBXFxiLyxcbiAgICAgIC9cXGIoUClcXHMq54mILyxcbiAgICBdLFxuICB9LFxuICB7XG4gICAgdHlwZTogXCJtYW5nYVwiLFxuICAgIHBhdHRlcm5zOiBbXG4gICAgICAvXFxibWFuZ2FcXGIvaSxcbiAgICAgIC9cXGJjb21pY1xccypwYXJhbGxlbFxcYi9pLFxuICAgICAgL1xcYuOCs+ODn+ODkeODqS8sXG4gICAgICAvXFxi44Oe44Oz44KsLyxcbiAgICBdLFxuICB9LFxuICB7XG4gICAgdHlwZTogXCJzcFwiLFxuICAgIHBhdHRlcm5zOiBbXG4gICAgICAvXFxic3BcXGIoPyFcXGQpL2ksIC8vIHNwIGJ1dCBub3QgZm9sbG93ZWQgYnkgZGlnaXRcbiAgICAgIC9cXGJzcGVjaWFsXFxzKmFydFxcYi9pLFxuICAgICAgL1xcYuOCueODmuOCt+ODo+ODqy8sXG4gICAgICAvXFxi44K544Oa44K344Oj44Or44Ki44O844OILyxcbiAgICBdLFxuICB9LFxuICB7XG4gICAgdHlwZTogXCJzcHJcIixcbiAgICBwYXR0ZXJuczogW1xuICAgICAgL1xcYnNwclxcYi9pLFxuICAgICAgL1xcYnNlY3JldFxccypyYXJlXFxiL2ksXG4gICAgICAvXFxic2VjXFxiL2ksXG4gICAgICAvXFxi44K344O844Kv44Os44OD44OILyxcbiAgICBdLFxuICB9LFxuICB7XG4gICAgdHlwZTogXCJ0clwiLFxuICAgIHBhdHRlcm5zOiBbXG4gICAgICAvXFxidHJcXGIvaSxcbiAgICAgIC9cXGJ0cmVhc3VyZVxcYi9pLFxuICAgICAgL1xcYuODiOODrOOCuOODo+ODvC8sXG4gICAgXSxcbiAgfSxcbiAge1xuICAgIHR5cGU6IFwiYm94dG9wcGVyXCIsXG4gICAgcGF0dGVybnM6IFtcbiAgICAgIC9cXGJib3hcXHMqdG9wcGVyXFxiL2ksXG4gICAgICAvXFxicHJvbW9cXGIvaSxcbiAgICAgIC9cXGLjg5zjg4Pjgq/jgrnjg4jjg4Pjg5Hjg7wvLFxuICAgIF0sXG4gIH0sXG4gIHtcbiAgICB0eXBlOiBcIndhbnRlZHBvc3RlclwiLFxuICAgIHBhdHRlcm5zOiBbXG4gICAgICAvXFxid2FudGVkXFxzKnBvc3RlclxcYi9pLFxuICAgICAgL1xcYuaJi+mFjeabuC8sXG4gICAgXSxcbiAgfSxcbl07XG5cbi8qKlxuICogU3RhbmRhcmRpemVkIHZhcmlhbnQgZGV0ZWN0aW9uIGFjcm9zcyBhbGwgc291cmNlc1xuICovXG5leHBvcnQgZnVuY3Rpb24gZGV0ZWN0VmFyaWFudFR5cGUodGl0bGU6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IGNsZWFuVGl0bGUgPSB0aXRsZS50b0xvd2VyQ2FzZSgpO1xuXG4gIGZvciAoY29uc3QgeyB0eXBlLCBwYXR0ZXJucyB9IG9mIFZBUklBTlRfUEFUVEVSTlMpIHtcbiAgICBmb3IgKGNvbnN0IHBhdHRlcm4gb2YgcGF0dGVybnMpIHtcbiAgICAgIGlmIChwYXR0ZXJuLnRlc3QoY2xlYW5UaXRsZSkpIHtcbiAgICAgICAgcmV0dXJuIHR5cGU7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIFwicmVndWxhclwiO1xufVxuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gU0VMTEVSIFJFUFVUQVRJT05cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbmV4cG9ydCBpbnRlcmZhY2UgU2VsbGVyUmVwdXRhdGlvbiB7XG4gIHNlbGxlcklkOiBzdHJpbmc7XG4gIGZlZWRiYWNrU2NvcmU/OiBudW1iZXI7XG4gIGZlZWRiYWNrUGVyY2VudGFnZT86IG51bWJlcjtcbiAgc2FsZXNDb3VudD86IG51bWJlcjtcbiAgYWNjb3VudEFnZT86IG51bWJlcjsgLy8gaW4gZGF5c1xuICByZXB1dGF0aW9uVGllcjogXCJ0cnVzdGVkXCIgfCBcInN0YW5kYXJkXCIgfCBcIm5ld1wiIHwgXCJsb3dcIjtcbn1cblxuLyoqXG4gKiBDYWxjdWxhdGVzIHNlbGxlciByZXB1dGF0aW9uIHRpZXIgYmFzZWQgb24gYXZhaWxhYmxlIG1ldHJpY3NcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNhbGN1bGF0ZVNlbGxlclJlcHV0YXRpb24oXG4gIGZlZWRiYWNrUGVyY2VudGFnZT86IG51bWJlcixcbiAgZmVlZGJhY2tTY29yZT86IG51bWJlcixcbiAgc2FsZXNDb3VudD86IG51bWJlclxuKTogU2VsbGVyUmVwdXRhdGlvbltcInJlcHV0YXRpb25UaWVyXCJdIHtcbiAgLy8gVHJ1c3RlZDogSGlnaCBmZWVkYmFjayAlIGFuZCBzaWduaWZpY2FudCB0cmFuc2FjdGlvbiBjb3VudFxuICBpZiAoZmVlZGJhY2tQZXJjZW50YWdlICYmIGZlZWRiYWNrUGVyY2VudGFnZSA+PSA5OSAmJiAoZmVlZGJhY2tTY29yZSB8fCAwKSA+PSAxMDApIHtcbiAgICByZXR1cm4gXCJ0cnVzdGVkXCI7XG4gIH1cblxuICAvLyBMb3c6IFBvb3IgZmVlZGJhY2sgb3IgdmVyeSBsb3cgc2NvcmVcbiAgaWYgKGZlZWRiYWNrUGVyY2VudGFnZSAmJiBmZWVkYmFja1BlcmNlbnRhZ2UgPCA5NSkge1xuICAgIHJldHVybiBcImxvd1wiO1xuICB9XG4gIGlmIChmZWVkYmFja1Njb3JlICYmIGZlZWRiYWNrU2NvcmUgPCAxMCkge1xuICAgIHJldHVybiBcIm5ld1wiO1xuICB9XG5cbiAgLy8gU3RhbmRhcmQ6IEV2ZXJ5dGhpbmcgZWxzZVxuICByZXR1cm4gXCJzdGFuZGFyZFwiO1xufVxuXG4vKipcbiAqIFdlaWdodCBmYWN0b3IgZm9yIHByaWNlIGJhc2VkIG9uIHNlbGxlciByZXB1dGF0aW9uXG4gKiBUcnVzdGVkIHNlbGxlcnMgZ2V0IGZ1bGwgd2VpZ2h0LCBsb3cgcmVwdXRhdGlvbiBnZXRzIGxvd2VyIHdlaWdodFxuICovXG5leHBvcnQgZnVuY3Rpb24gZ2V0U2VsbGVyV2VpZ2h0RmFjdG9yKHRpZXI6IFNlbGxlclJlcHV0YXRpb25bXCJyZXB1dGF0aW9uVGllclwiXSk6IG51bWJlciB7XG4gIHN3aXRjaCAodGllcikge1xuICAgIGNhc2UgXCJ0cnVzdGVkXCI6XG4gICAgICByZXR1cm4gMS4wO1xuICAgIGNhc2UgXCJzdGFuZGFyZFwiOlxuICAgICAgcmV0dXJuIDAuOTtcbiAgICBjYXNlIFwibmV3XCI6XG4gICAgICByZXR1cm4gMC43O1xuICAgIGNhc2UgXCJsb3dcIjpcbiAgICAgIHJldHVybiAwLjU7XG4gICAgZGVmYXVsdDpcbiAgICAgIHJldHVybiAwLjg7XG4gIH1cbn1cbiJdfQ==