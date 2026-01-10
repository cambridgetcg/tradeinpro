/**
 * Shared utilities for data pipeline Lambda functions
 */
export interface PriceEvent {
    eventType: "price";
    source: string;
    cardId: string;
    externalId: string;
    name: string;
    setCode: string;
    cardNumber: string;
    variantType: string;
    condition: string;
    language: string;
    price: number;
    currency: string;
    priceUsd: number;
    priceGbp: number;
    listingsCount?: number;
    sellerId?: string;
    timestamp: string;
    collectedAt: string;
}
export interface ListingEvent {
    eventType: "listing";
    source: string;
    listingId: string;
    cardId: string;
    title: string;
    description?: string;
    price: number;
    currency: string;
    condition: string;
    sellerId: string;
    sellerFeedback?: number;
    sellerFeedbackCount?: number;
    imageUrls?: string[];
    isAuction: boolean;
    endTime?: string;
    timestamp: string;
    collectedAt: string;
}
export interface SalesEvent {
    eventType: "sale";
    source: string;
    saleId: string;
    cardId: string;
    price: number;
    currency: string;
    priceUsd: number;
    condition: string;
    quantity: number;
    sellerId?: string;
    buyerId?: string;
    saleDate: string;
    collectedAt: string;
}
export interface SignalEvent {
    eventType: "signal";
    signalType: "social" | "youtube" | "tournament" | "news";
    cardId?: string;
    cardName?: string;
    content: string;
    sentiment?: number;
    reach?: number;
    source: string;
    sourceUrl?: string;
    timestamp: string;
    collectedAt: string;
}
export interface APICredentials {
    tcgplayer_api_key?: string;
    tcgplayer_access_token?: string;
    cardmarket_app_token?: string;
    cardmarket_app_secret?: string;
    ebay_client_id?: string;
    ebay_client_secret?: string;
    proxy_username?: string;
    proxy_password?: string;
}
export declare function getSecrets(): Promise<APICredentials>;
export declare function putToKinesis(streamName: string, events: Array<PriceEvent | ListingEvent | SalesEvent | SignalEvent>): Promise<void>;
export declare function updateCurrentPrice(tableName: string, event: PriceEvent): Promise<void>;
export declare function batchUpdateCurrentPrices(tableName: string, events: PriceEvent[]): Promise<void>;
export declare function recordArbitrageOpportunity(tableName: string, cardId: string, buySource: string, sellSource: string, buyPrice: number, sellPrice: number, spread: number): Promise<void>;
export declare function getCardFromCatalog(tableName: string, cardId: string): Promise<Record<string, unknown> | null>;
export declare function writePriceToTimestream(databaseName: string, tableName: string, events: PriceEvent[]): Promise<void>;
/**
 * Fetches live FX rates from exchangerate-api.com (free tier: 1500 req/month)
 * Falls back to static rates on error
 */
export declare function fetchLiveFxRates(): Promise<Record<string, number>>;
/**
 * Gets current FX rates (cached or fallback)
 */
export declare function getFxRates(): Record<string, number>;
export declare function convertToUsd(amount: number, currency: string): number;
export declare function convertToGbp(amountUsd: number): number;
export declare function normalizePrice(price: number, currency: string): {
    priceUsd: number;
    priceGbp: number;
};
/**
 * Async version that ensures live rates are loaded first
 */
export declare function normalizePriceAsync(price: number, currency: string): Promise<{
    priceUsd: number;
    priceGbp: number;
}>;
export declare function normalizeCardId(setCode: string, cardNumber: string, variantType?: string): string;
export declare function parseCardNumber(input: string): {
    setCode: string;
    cardNumber: string;
    variantType: string;
};
export interface ConditionResult {
    condition: string;
    isKnown: boolean;
    original: string;
}
/**
 * Normalizes condition string to standard codes
 * Returns UNKNOWN instead of defaulting to NM for tracking purposes
 */
export declare function normalizeConditionWithTracking(condition: string): ConditionResult;
/**
 * Legacy function that defaults to NM for backward compatibility
 * @deprecated Use normalizeConditionWithTracking for new code
 */
export declare function normalizeCondition(condition: string): string;
export declare class RateLimiter {
    private tokens;
    private lastRefill;
    private maxTokens;
    private refillRate;
    constructor(maxTokens: number, refillRate: number);
    private refill;
    acquire(count?: number): Promise<void>;
}
export interface RetryOptions {
    maxRetries: number;
    baseDelayMs: number;
    maxDelayMs: number;
}
export declare function withRetry<T>(fn: () => Promise<T>, options?: Partial<RetryOptions>): Promise<T>;
export declare function chunkArray<T>(array: T[], size: number): T[][];
export declare function sleep(ms: number): Promise<void>;
export declare function nowIso(): string;
export declare function sanitizeString(str: string): string;
export interface DroppedRecord {
    source: string;
    reason: string;
    title?: string;
    rawData?: Record<string, unknown>;
    timestamp: string;
}
export interface DataQualityMetrics {
    source: string;
    totalProcessed: number;
    successfullyParsed: number;
    dropped: number;
    droppedByReason: Record<string, number>;
    unknownConditions: number;
    fuzzyMatched: number;
    collectedAt: string;
}
declare class DataQualityTracker {
    private metrics;
    private droppedRecords;
    private maxDroppedRecords;
    getOrCreateMetrics(source: string): DataQualityMetrics;
    recordSuccess(source: string, options?: {
        fuzzyMatched?: boolean;
        unknownCondition?: boolean;
    }): void;
    recordDropped(source: string, reason: string, details?: {
        title?: string;
        rawData?: Record<string, unknown>;
    }): void;
    getMetrics(): DataQualityMetrics[];
    getDroppedRecords(): DroppedRecord[];
    logSummary(): void;
    reset(): void;
}
export declare const dataQualityTracker: DataQualityTracker;
export interface FuzzyMatchResult {
    setCode: string;
    cardNumber: string;
    variantType: string;
    confidence: "high" | "medium" | "low";
    matchMethod: string;
}
/**
 * Attempts to extract card info using multiple pattern matching strategies
 */
export declare function fuzzyMatchCard(title: string): FuzzyMatchResult | null;
/**
 * Standardized variant detection across all sources
 */
export declare function detectVariantType(title: string): string;
export interface SellerReputation {
    sellerId: string;
    feedbackScore?: number;
    feedbackPercentage?: number;
    salesCount?: number;
    accountAge?: number;
    reputationTier: "trusted" | "standard" | "new" | "low";
}
/**
 * Calculates seller reputation tier based on available metrics
 */
export declare function calculateSellerReputation(feedbackPercentage?: number, feedbackScore?: number, salesCount?: number): SellerReputation["reputationTier"];
/**
 * Weight factor for price based on seller reputation
 * Trusted sellers get full weight, low reputation gets lower weight
 */
export declare function getSellerWeightFactor(tier: SellerReputation["reputationTier"]): number;
export {};
