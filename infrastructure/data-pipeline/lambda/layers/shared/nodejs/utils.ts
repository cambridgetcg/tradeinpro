/**
 * Shared utilities for data pipeline Lambda functions
 */

import {
  KinesisClient,
  PutRecordsCommand,
  PutRecordsRequestEntry,
} from "@aws-sdk/client-kinesis";
import {
  DynamoDBClient,
  PutItemCommand,
  GetItemCommand,
  UpdateItemCommand,
  BatchWriteItemCommand,
} from "@aws-sdk/client-dynamodb";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";
import {
  TimestreamWriteClient,
  WriteRecordsCommand,
  _Record,
} from "@aws-sdk/client-timestream-write";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";

// =============================================================================
// CLIENTS
// =============================================================================

const kinesisClient = new KinesisClient({});
const dynamoClient = new DynamoDBClient({});
const secretsClient = new SecretsManagerClient({});
const timestreamClient = new TimestreamWriteClient({});

// =============================================================================
// TYPES
// =============================================================================

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

// =============================================================================
// SECRETS
// =============================================================================

let cachedSecrets: APICredentials | null = null;

export async function getSecrets(): Promise<APICredentials> {
  if (cachedSecrets) return cachedSecrets;

  const secretArn = process.env.SECRETS_ARN;
  if (!secretArn) {
    throw new Error("SECRETS_ARN environment variable not set");
  }

  const response = await secretsClient.send(
    new GetSecretValueCommand({ SecretId: secretArn })
  );

  if (!response.SecretString) {
    throw new Error("Secret value is empty");
  }

  cachedSecrets = JSON.parse(response.SecretString);
  return cachedSecrets!;
}

// =============================================================================
// KINESIS HELPERS
// =============================================================================

export async function putToKinesis(
  streamName: string,
  events: Array<PriceEvent | ListingEvent | SalesEvent | SignalEvent>
): Promise<void> {
  if (events.length === 0) return;

  // Kinesis has a limit of 500 records per batch
  const batches = chunkArray(events, 500);

  for (const batch of batches) {
    const records: PutRecordsRequestEntry[] = batch.map((event) => ({
      Data: Buffer.from(JSON.stringify(event)),
      PartitionKey: getPartitionKey(event),
    }));

    await kinesisClient.send(
      new PutRecordsCommand({
        StreamName: streamName,
        Records: records,
      })
    );
  }

  console.log(`Put ${events.length} records to ${streamName}`);
}

function getPartitionKey(
  event: PriceEvent | ListingEvent | SalesEvent | SignalEvent
): string {
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

export async function updateCurrentPrice(
  tableName: string,
  event: PriceEvent
): Promise<void> {
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

  await dynamoClient.send(
    new PutItemCommand({
      TableName: tableName,
      Item: marshall(item),
    })
  );
}

export async function batchUpdateCurrentPrices(
  tableName: string,
  events: PriceEvent[]
): Promise<void> {
  if (events.length === 0) return;

  // DynamoDB batch write limit is 25 items
  const batches = chunkArray(events, 25);

  for (const batch of batches) {
    const writeRequests = batch.map((event) => ({
      PutRequest: {
        Item: marshall({
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

    await dynamoClient.send(
      new BatchWriteItemCommand({
        RequestItems: {
          [tableName]: writeRequests,
        },
      })
    );
  }
}

export async function recordArbitrageOpportunity(
  tableName: string,
  cardId: string,
  buySource: string,
  sellSource: string,
  buyPrice: number,
  sellPrice: number,
  spread: number
): Promise<void> {
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

  await dynamoClient.send(
    new PutItemCommand({
      TableName: tableName,
      Item: marshall(item),
    })
  );
}

export async function getCardFromCatalog(
  tableName: string,
  cardId: string
): Promise<Record<string, unknown> | null> {
  const response = await dynamoClient.send(
    new GetItemCommand({
      TableName: tableName,
      Key: marshall({ card_id: cardId }),
    })
  );

  if (!response.Item) return null;
  return unmarshall(response.Item);
}

// =============================================================================
// TIMESTREAM HELPERS
// =============================================================================

export async function writePriceToTimestream(
  databaseName: string,
  tableName: string,
  events: PriceEvent[]
): Promise<void> {
  if (events.length === 0) return;

  // Timestream has a limit of 100 records per batch
  const batches = chunkArray(events, 100);

  for (const batch of batches) {
    const records: _Record[] = batch.map((event) => ({
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

    await timestreamClient.send(
      new WriteRecordsCommand({
        DatabaseName: databaseName,
        TableName: tableName,
        Records: records,
      })
    );
  }

  console.log(`Wrote ${events.length} records to Timestream`);
}

// =============================================================================
// CURRENCY CONVERSION
// =============================================================================

// Fallback exchange rates (used when API is unavailable)
const FALLBACK_FX_RATES: Record<string, number> = {
  USD: 1.0,
  GBP: 1.27,
  EUR: 1.08,
  JPY: 0.0067,
  CAD: 0.74,
  AUD: 0.65,
};

// Cached live rates with expiry
let cachedFxRates: Record<string, number> | null = null;
let fxRatesCacheExpiry: Date | null = null;
const FX_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Fetches live FX rates from exchangerate-api.com (free tier: 1500 req/month)
 * Falls back to static rates on error
 */
export async function fetchLiveFxRates(): Promise<Record<string, number>> {
  // Return cached rates if still valid
  if (cachedFxRates && fxRatesCacheExpiry && fxRatesCacheExpiry > new Date()) {
    return cachedFxRates;
  }

  try {
    // Using exchangerate-api.com free tier (no API key required for basic endpoint)
    const response = await fetch(
      "https://api.exchangerate-api.com/v4/latest/USD",
      { signal: AbortSignal.timeout(5000) } // 5s timeout
    );

    if (!response.ok) {
      throw new Error(`FX API returned ${response.status}`);
    }

    const data = await response.json() as { rates: Record<string, number> };
    const rates = data.rates;

    // Convert to USD-based rates (amount in currency * rate = USD)
    cachedFxRates = {
      USD: 1.0,
      GBP: 1 / (rates.GBP || 0.79),   // GBP to USD
      EUR: 1 / (rates.EUR || 0.92),   // EUR to USD
      JPY: 1 / (rates.JPY || 149),    // JPY to USD
      CAD: 1 / (rates.CAD || 1.36),   // CAD to USD
      AUD: 1 / (rates.AUD || 1.53),   // AUD to USD
    };

    fxRatesCacheExpiry = new Date(Date.now() + FX_CACHE_TTL_MS);

    console.log("Fetched live FX rates:", cachedFxRates);
    return cachedFxRates;
  } catch (error) {
    console.warn("Failed to fetch live FX rates, using fallback:", error);
    return FALLBACK_FX_RATES;
  }
}

/**
 * Gets current FX rates (cached or fallback)
 */
export function getFxRates(): Record<string, number> {
  return cachedFxRates || FALLBACK_FX_RATES;
}

export function convertToUsd(amount: number, currency: string): number {
  const rates = getFxRates();
  const rate = rates[currency.toUpperCase()] || 1;
  return amount * rate;
}

export function convertToGbp(amountUsd: number): number {
  const rates = getFxRates();
  return amountUsd / rates.GBP;
}

export function normalizePrice(
  price: number,
  currency: string
): { priceUsd: number; priceGbp: number } {
  const priceUsd = convertToUsd(price, currency);
  const priceGbp = convertToGbp(priceUsd);
  return { priceUsd, priceGbp };
}

/**
 * Async version that ensures live rates are loaded first
 */
export async function normalizePriceAsync(
  price: number,
  currency: string
): Promise<{ priceUsd: number; priceGbp: number }> {
  await fetchLiveFxRates();
  return normalizePrice(price, currency);
}

// =============================================================================
// CARD ID NORMALIZATION
// =============================================================================

export function normalizeCardId(
  setCode: string,
  cardNumber: string,
  variantType?: string
): string {
  const baseId = `${setCode.toUpperCase()}-${cardNumber.padStart(3, "0")}`;
  if (variantType && variantType !== "regular") {
    return `${baseId}-${variantType.toLowerCase()}`;
  }
  return baseId;
}

export function parseCardNumber(input: string): {
  setCode: string;
  cardNumber: string;
  variantType: string;
} {
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

const CONDITION_MAP: Record<string, string> = {
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

export interface ConditionResult {
  condition: string;
  isKnown: boolean;
  original: string;
}

/**
 * Normalizes condition string to standard codes
 * Returns UNKNOWN instead of defaulting to NM for tracking purposes
 */
export function normalizeConditionWithTracking(condition: string): ConditionResult {
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
export function normalizeCondition(condition: string): string {
  const result = normalizeConditionWithTracking(condition);
  return result.isKnown ? result.condition : "NM";
}

// =============================================================================
// RATE LIMITING
// =============================================================================

export class RateLimiter {
  private tokens: number;
  private lastRefill: number;
  private maxTokens: number;
  private refillRate: number; // tokens per second

  constructor(maxTokens: number, refillRate: number) {
    this.maxTokens = maxTokens;
    this.tokens = maxTokens;
    this.refillRate = refillRate;
    this.lastRefill = Date.now();
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRate);
    this.lastRefill = now;
  }

  async acquire(count: number = 1): Promise<void> {
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

// =============================================================================
// RETRY HELPERS
// =============================================================================

export interface RetryOptions {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
};

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {}
): Promise<T> {
  const opts = { ...DEFAULT_RETRY_OPTIONS, ...options };
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      console.error(`Attempt ${attempt + 1} failed:`, error);

      if (attempt < opts.maxRetries) {
        const delay = Math.min(
          opts.baseDelayMs * Math.pow(2, attempt) + Math.random() * 1000,
          opts.maxDelayMs
        );
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

export function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function sanitizeString(str: string): string {
  return str.replace(/[^\x20-\x7E]/g, "").trim();
}

// =============================================================================
// DATA QUALITY TRACKING
// =============================================================================

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

class DataQualityTracker {
  private metrics: Map<string, DataQualityMetrics> = new Map();
  private droppedRecords: DroppedRecord[] = [];
  private maxDroppedRecords = 1000; // Limit memory usage

  getOrCreateMetrics(source: string): DataQualityMetrics {
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
    return this.metrics.get(source)!;
  }

  recordSuccess(source: string, options?: { fuzzyMatched?: boolean; unknownCondition?: boolean }): void {
    const metrics = this.getOrCreateMetrics(source);
    metrics.totalProcessed++;
    metrics.successfullyParsed++;
    if (options?.fuzzyMatched) metrics.fuzzyMatched++;
    if (options?.unknownCondition) metrics.unknownConditions++;
  }

  recordDropped(
    source: string,
    reason: string,
    details?: { title?: string; rawData?: Record<string, unknown> }
  ): void {
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

  getMetrics(): DataQualityMetrics[] {
    return Array.from(this.metrics.values());
  }

  getDroppedRecords(): DroppedRecord[] {
    return this.droppedRecords;
  }

  logSummary(): void {
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

  reset(): void {
    this.metrics.clear();
    this.droppedRecords = [];
  }
}

// Global tracker instance
export const dataQualityTracker = new DataQualityTracker();

// =============================================================================
// FUZZY CARD MATCHING
// =============================================================================

// Known card names to set mappings for fuzzy matching
const CARD_NAME_PATTERNS: Array<{ pattern: RegExp; setCode: string; cardNumber?: string }> = [
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
export function fuzzyMatchCard(title: string): FuzzyMatchResult | null {
  const cleanTitle = title.trim();

  // Try each card number pattern in order of reliability
  for (let i = 0; i < CARD_NUMBER_PATTERNS.length; i++) {
    const pattern = CARD_NUMBER_PATTERNS[i];
    const match = cleanTitle.match(pattern);

    if (match) {
      let setCode: string;
      let cardNumber: string;

      if (match.length === 4) {
        // Pattern with separate set parts (e.g., OP 01-121)
        setCode = `${match[1]}${match[2]}`.toUpperCase();
        cardNumber = match[3].padStart(3, "0");
      } else {
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

const VARIANT_PATTERNS: Array<{ type: string; patterns: RegExp[] }> = [
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
export function detectVariantType(title: string): string {
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

// =============================================================================
// SELLER REPUTATION
// =============================================================================

export interface SellerReputation {
  sellerId: string;
  feedbackScore?: number;
  feedbackPercentage?: number;
  salesCount?: number;
  accountAge?: number; // in days
  reputationTier: "trusted" | "standard" | "new" | "low";
}

/**
 * Calculates seller reputation tier based on available metrics
 */
export function calculateSellerReputation(
  feedbackPercentage?: number,
  feedbackScore?: number,
  salesCount?: number
): SellerReputation["reputationTier"] {
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
export function getSellerWeightFactor(tier: SellerReputation["reputationTier"]): number {
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
