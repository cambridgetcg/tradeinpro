/**
 * Data Quality Validator Lambda
 *
 * Multi-layer validation pipeline for price data quality assessment:
 * 1. Schema Validation - Field presence, types, formats
 * 2. Statistical Validation - Outlier detection, distribution analysis
 * 3. Semantic Validation - Business rule validation
 * 4. Temporal Validation - Freshness and consistency checks
 *
 * Quality scores: Pass (≥0.9), Warn (0.7-0.9), Quarantine (0.5-0.7), Reject (<0.5)
 */

import { Handler, KinesisStreamEvent, KinesisStreamRecord } from "aws-lambda";
import {
  DynamoDBClient,
  PutItemCommand,
  GetItemCommand,
  QueryCommand,
  BatchWriteItemCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { putToKinesis, PriceEvent, chunkArray, nowIso } from "/opt/nodejs/utils";

// =============================================================================
// CONFIGURATION
// =============================================================================

const VALIDATED_STREAM = process.env.VALIDATED_STREAM_NAME!;
const QUARANTINE_STREAM = process.env.QUARANTINE_STREAM_NAME!;
const QUALITY_METRICS_TABLE = process.env.QUALITY_METRICS_TABLE!;
const PRICE_HISTORY_TABLE = process.env.PRICE_HISTORY_TABLE!;

const dynamoClient = new DynamoDBClient({});

// Quality score thresholds
const QUALITY_THRESHOLDS = {
  PASS: 0.9,
  WARN: 0.7,
  QUARANTINE: 0.5,
  // Below QUARANTINE = REJECT
};

// Statistical outlier detection settings
const OUTLIER_SETTINGS = {
  Z_SCORE_THRESHOLD: 3.0,      // Standard deviations for z-score
  IQR_MULTIPLIER: 1.5,         // IQR multiplier for Tukey's method
  MIN_SAMPLES_FOR_STATS: 5,    // Minimum samples for statistical analysis
  PRICE_CHANGE_THRESHOLD: 0.5, // 50% price change triggers review
};

// =============================================================================
// TYPES
// =============================================================================

export interface ValidationResult {
  isValid: boolean;
  score: number;
  tier: "pass" | "warn" | "quarantine" | "reject";
  checks: ValidationCheck[];
  metadata: {
    validatedAt: string;
    processingTimeMs: number;
    rulesApplied: number;
  };
}

export interface ValidationCheck {
  layer: "schema" | "statistical" | "semantic" | "temporal";
  rule: string;
  passed: boolean;
  score: number;
  message?: string;
  details?: Record<string, unknown>;
}

export interface ValidatedPriceEvent extends PriceEvent {
  qualityScore: number;
  qualityTier: string;
  validationDetails: ValidationCheck[];
  validatedAt: string;
}

export interface PriceHistoryEntry {
  cardId: string;
  source: string;
  prices: number[];
  timestamps: string[];
  mean: number;
  stdDev: number;
  min: number;
  max: number;
  lastUpdated: string;
}

// =============================================================================
// SCHEMA VALIDATION
// =============================================================================

interface SchemaRule {
  field: string;
  type: "string" | "number" | "boolean" | "array";
  required: boolean;
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  pattern?: RegExp;
  enum?: string[];
  custom?: (value: unknown, record: PriceEvent) => boolean;
}

const PRICE_EVENT_SCHEMA: SchemaRule[] = [
  // Required core fields
  { field: "eventType", type: "string", required: true, enum: ["price"] },
  { field: "source", type: "string", required: true, minLength: 1, maxLength: 50 },
  { field: "cardId", type: "string", required: true, pattern: /^[A-Z]{2,4}\d{2}-\d{3}(-[a-z]+)?$/i },
  { field: "name", type: "string", required: true, minLength: 1, maxLength: 200 },
  { field: "setCode", type: "string", required: true, pattern: /^[A-Z]{2,4}\d{2}$/i },
  { field: "cardNumber", type: "string", required: true, pattern: /^\d{1,4}$/ },

  // Price fields
  { field: "price", type: "number", required: true, min: 0.01, max: 100000 },
  { field: "priceUsd", type: "number", required: true, min: 0.01, max: 100000 },
  { field: "priceGbp", type: "number", required: true, min: 0.01, max: 100000 },
  { field: "currency", type: "string", required: true, enum: ["USD", "GBP", "EUR", "JPY", "CAD", "AUD"] },

  // Condition and variant
  { field: "condition", type: "string", required: true, enum: ["NM", "LP", "MP", "HP", "DMG", "UNKNOWN"] },
  { field: "variantType", type: "string", required: true, minLength: 1, maxLength: 30 },
  { field: "language", type: "string", required: true, enum: ["EN", "JP", "KR", "ZH", "DE", "FR", "IT", "ES", "PT"] },

  // Timestamps
  { field: "timestamp", type: "string", required: true, pattern: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/ },
  { field: "collectedAt", type: "string", required: true, pattern: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/ },

  // Optional fields with validation when present
  { field: "externalId", type: "string", required: false, maxLength: 200 },
  { field: "listingsCount", type: "number", required: false, min: 0, max: 1000000 },
  { field: "sellerId", type: "string", required: false, maxLength: 100 },
];

function validateSchema(event: PriceEvent): ValidationCheck[] {
  const checks: ValidationCheck[] = [];
  const record = event as Record<string, unknown>;

  for (const rule of PRICE_EVENT_SCHEMA) {
    const value = record[rule.field];
    const check: ValidationCheck = {
      layer: "schema",
      rule: `schema_${rule.field}`,
      passed: true,
      score: 1.0,
    };

    // Check required
    if (rule.required && (value === undefined || value === null || value === "")) {
      check.passed = false;
      check.score = 0;
      check.message = `Required field '${rule.field}' is missing`;
      checks.push(check);
      continue;
    }

    // Skip optional fields that are not present
    if (!rule.required && (value === undefined || value === null)) {
      continue;
    }

    // Type check
    const actualType = Array.isArray(value) ? "array" : typeof value;
    if (actualType !== rule.type) {
      check.passed = false;
      check.score = 0;
      check.message = `Field '${rule.field}' expected ${rule.type}, got ${actualType}`;
      checks.push(check);
      continue;
    }

    // String validations
    if (rule.type === "string" && typeof value === "string") {
      if (rule.minLength && value.length < rule.minLength) {
        check.passed = false;
        check.score = 0.5;
        check.message = `Field '${rule.field}' too short (${value.length} < ${rule.minLength})`;
      }
      if (rule.maxLength && value.length > rule.maxLength) {
        check.passed = false;
        check.score = 0.5;
        check.message = `Field '${rule.field}' too long (${value.length} > ${rule.maxLength})`;
      }
      if (rule.pattern && !rule.pattern.test(value)) {
        check.passed = false;
        check.score = 0.3;
        check.message = `Field '${rule.field}' doesn't match pattern: ${value}`;
      }
      if (rule.enum && !rule.enum.includes(value)) {
        check.passed = false;
        check.score = 0.3;
        check.message = `Field '${rule.field}' invalid value: ${value}. Expected: ${rule.enum.join(", ")}`;
      }
    }

    // Number validations
    if (rule.type === "number" && typeof value === "number") {
      if (rule.min !== undefined && value < rule.min) {
        check.passed = false;
        check.score = 0.3;
        check.message = `Field '${rule.field}' below minimum (${value} < ${rule.min})`;
      }
      if (rule.max !== undefined && value > rule.max) {
        check.passed = false;
        check.score = 0.3;
        check.message = `Field '${rule.field}' above maximum (${value} > ${rule.max})`;
      }
      if (Number.isNaN(value) || !Number.isFinite(value)) {
        check.passed = false;
        check.score = 0;
        check.message = `Field '${rule.field}' is not a valid number`;
      }
    }

    // Custom validation
    if (rule.custom && !rule.custom(value, event)) {
      check.passed = false;
      check.score = 0.5;
      check.message = `Field '${rule.field}' failed custom validation`;
    }

    checks.push(check);
  }

  return checks;
}

// =============================================================================
// STATISTICAL VALIDATION
// =============================================================================

async function getHistoricalStats(
  cardId: string,
  source: string
): Promise<PriceHistoryEntry | null> {
  try {
    const response = await dynamoClient.send(
      new QueryCommand({
        TableName: PRICE_HISTORY_TABLE,
        KeyConditionExpression: "card_id = :cardId",
        FilterExpression: "#src = :source",
        ExpressionAttributeNames: { "#src": "source" },
        ExpressionAttributeValues: marshall({
          ":cardId": cardId,
          ":source": source,
        }),
        Limit: 100,
        ScanIndexForward: false, // Most recent first
      })
    );

    if (!response.Items || response.Items.length < OUTLIER_SETTINGS.MIN_SAMPLES_FOR_STATS) {
      return null;
    }

    const prices = response.Items.map((item) => {
      const unmarshalled = unmarshall(item);
      return unmarshalled.price as number;
    }).filter((p) => p > 0);

    if (prices.length < OUTLIER_SETTINGS.MIN_SAMPLES_FOR_STATS) {
      return null;
    }

    const mean = prices.reduce((sum, p) => sum + p, 0) / prices.length;
    const variance = prices.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / prices.length;
    const stdDev = Math.sqrt(variance);

    return {
      cardId,
      source,
      prices,
      timestamps: [],
      mean,
      stdDev,
      min: Math.min(...prices),
      max: Math.max(...prices),
      lastUpdated: nowIso(),
    };
  } catch (error) {
    console.warn(`Failed to get historical stats for ${cardId}:`, error);
    return null;
  }
}

function calculateZScore(value: number, mean: number, stdDev: number): number {
  if (stdDev === 0) return 0;
  return Math.abs((value - mean) / stdDev);
}

function calculateIQROutlier(value: number, prices: number[]): { isOutlier: boolean; bounds: { lower: number; upper: number } } {
  const sorted = [...prices].sort((a, b) => a - b);
  const q1Index = Math.floor(sorted.length * 0.25);
  const q3Index = Math.floor(sorted.length * 0.75);
  const q1 = sorted[q1Index];
  const q3 = sorted[q3Index];
  const iqr = q3 - q1;

  const lower = q1 - OUTLIER_SETTINGS.IQR_MULTIPLIER * iqr;
  const upper = q3 + OUTLIER_SETTINGS.IQR_MULTIPLIER * iqr;

  return {
    isOutlier: value < lower || value > upper,
    bounds: { lower, upper },
  };
}

async function validateStatistical(event: PriceEvent): Promise<ValidationCheck[]> {
  const checks: ValidationCheck[] = [];

  // Get historical data for comparison
  const history = await getHistoricalStats(event.cardId, event.source);

  if (!history) {
    // Not enough data for statistical validation - pass with neutral score
    checks.push({
      layer: "statistical",
      rule: "stats_insufficient_data",
      passed: true,
      score: 0.8, // Neutral score when we can't validate
      message: "Insufficient historical data for statistical validation",
    });
    return checks;
  }

  // Z-Score validation
  const zScore = calculateZScore(event.priceUsd, history.mean, history.stdDev);
  const zScoreCheck: ValidationCheck = {
    layer: "statistical",
    rule: "stats_zscore",
    passed: zScore <= OUTLIER_SETTINGS.Z_SCORE_THRESHOLD,
    score: zScore <= OUTLIER_SETTINGS.Z_SCORE_THRESHOLD ? 1.0 : Math.max(0, 1 - (zScore - OUTLIER_SETTINGS.Z_SCORE_THRESHOLD) / 3),
    details: { zScore, threshold: OUTLIER_SETTINGS.Z_SCORE_THRESHOLD, mean: history.mean, stdDev: history.stdDev },
  };
  if (!zScoreCheck.passed) {
    zScoreCheck.message = `Price ${event.priceUsd} is ${zScore.toFixed(2)} std devs from mean ${history.mean.toFixed(2)}`;
  }
  checks.push(zScoreCheck);

  // IQR validation
  const iqrResult = calculateIQROutlier(event.priceUsd, history.prices);
  const iqrCheck: ValidationCheck = {
    layer: "statistical",
    rule: "stats_iqr",
    passed: !iqrResult.isOutlier,
    score: !iqrResult.isOutlier ? 1.0 : 0.5,
    details: { bounds: iqrResult.bounds, value: event.priceUsd },
  };
  if (!iqrCheck.passed) {
    iqrCheck.message = `Price ${event.priceUsd} outside IQR bounds [${iqrResult.bounds.lower.toFixed(2)}, ${iqrResult.bounds.upper.toFixed(2)}]`;
  }
  checks.push(iqrCheck);

  // Price change magnitude check
  const lastPrice = history.prices[0];
  const priceChangeRatio = Math.abs(event.priceUsd - lastPrice) / lastPrice;
  const priceChangeCheck: ValidationCheck = {
    layer: "statistical",
    rule: "stats_price_change",
    passed: priceChangeRatio <= OUTLIER_SETTINGS.PRICE_CHANGE_THRESHOLD,
    score: priceChangeRatio <= OUTLIER_SETTINGS.PRICE_CHANGE_THRESHOLD ? 1.0 : Math.max(0.3, 1 - priceChangeRatio),
    details: { previousPrice: lastPrice, newPrice: event.priceUsd, changeRatio: priceChangeRatio },
  };
  if (!priceChangeCheck.passed) {
    priceChangeCheck.message = `Price changed ${(priceChangeRatio * 100).toFixed(1)}% from ${lastPrice.toFixed(2)} to ${event.priceUsd.toFixed(2)}`;
  }
  checks.push(priceChangeCheck);

  return checks;
}

// =============================================================================
// SEMANTIC VALIDATION
// =============================================================================

// Known set codes and their expected card number ranges
const SET_CARD_RANGES: Record<string, { min: number; max: number }> = {
  OP01: { min: 1, max: 127 },
  OP02: { min: 1, max: 127 },
  OP03: { min: 1, max: 127 },
  OP04: { min: 1, max: 127 },
  OP05: { min: 1, max: 127 },
  OP06: { min: 1, max: 127 },
  OP07: { min: 1, max: 127 },
  OP08: { min: 1, max: 127 },
  OP09: { min: 1, max: 127 },
  OP10: { min: 1, max: 127 },
  OP11: { min: 1, max: 127 },
  OP12: { min: 1, max: 127 },
  EB01: { min: 1, max: 72 },
  EB02: { min: 1, max: 72 },
  ST01: { min: 1, max: 17 },
  ST02: { min: 1, max: 17 },
  ST03: { min: 1, max: 17 },
  ST04: { min: 1, max: 17 },
  ST05: { min: 1, max: 17 },
  ST06: { min: 1, max: 17 },
  ST07: { min: 1, max: 17 },
  ST08: { min: 1, max: 17 },
  ST09: { min: 1, max: 17 },
  ST10: { min: 1, max: 17 },
  ST11: { min: 1, max: 17 },
  ST12: { min: 1, max: 17 },
  ST13: { min: 1, max: 17 },
  ST14: { min: 1, max: 17 },
  ST15: { min: 1, max: 17 },
  ST16: { min: 1, max: 17 },
  ST17: { min: 1, max: 17 },
  ST18: { min: 1, max: 17 },
  ST19: { min: 1, max: 17 },
  ST20: { min: 1, max: 17 },
};

// Price ranges by rarity (for cards with rarity info)
const PRICE_EXPECTATIONS: Record<string, { typical: { min: number; max: number }; outlier: number }> = {
  C: { typical: { min: 0.01, max: 2 }, outlier: 10 },
  UC: { typical: { min: 0.01, max: 5 }, outlier: 20 },
  R: { typical: { min: 0.10, max: 20 }, outlier: 100 },
  SR: { typical: { min: 1, max: 100 }, outlier: 500 },
  SEC: { typical: { min: 5, max: 500 }, outlier: 2000 },
  L: { typical: { min: 0.50, max: 50 }, outlier: 200 },
  SP: { typical: { min: 5, max: 300 }, outlier: 1000 },
};

// Condition price multipliers (expected relative to NM)
const CONDITION_MULTIPLIERS: Record<string, { min: number; max: number }> = {
  NM: { min: 0.90, max: 1.0 },
  LP: { min: 0.70, max: 0.90 },
  MP: { min: 0.50, max: 0.75 },
  HP: { min: 0.30, max: 0.55 },
  DMG: { min: 0.10, max: 0.35 },
};

function validateSemantic(event: PriceEvent): ValidationCheck[] {
  const checks: ValidationCheck[] = [];

  // 1. Set code validity
  const setRange = SET_CARD_RANGES[event.setCode.toUpperCase()];
  const setValidCheck: ValidationCheck = {
    layer: "semantic",
    rule: "sem_valid_set",
    passed: !!setRange,
    score: setRange ? 1.0 : 0.5,
  };
  if (!setRange) {
    setValidCheck.message = `Unknown set code: ${event.setCode}`;
  }
  checks.push(setValidCheck);

  // 2. Card number within set range
  if (setRange) {
    const cardNum = parseInt(event.cardNumber, 10);
    const inRange = cardNum >= setRange.min && cardNum <= setRange.max;
    const cardNumCheck: ValidationCheck = {
      layer: "semantic",
      rule: "sem_card_number_range",
      passed: inRange,
      score: inRange ? 1.0 : 0.3,
      details: { cardNumber: cardNum, expectedRange: setRange },
    };
    if (!inRange) {
      cardNumCheck.message = `Card number ${cardNum} outside expected range [${setRange.min}, ${setRange.max}] for ${event.setCode}`;
    }
    checks.push(cardNumCheck);
  }

  // 3. Price sanity check
  const priceSanityCheck: ValidationCheck = {
    layer: "semantic",
    rule: "sem_price_sanity",
    passed: true,
    score: 1.0,
  };

  // Flag suspiciously low prices
  if (event.priceUsd < 0.05) {
    priceSanityCheck.passed = false;
    priceSanityCheck.score = 0.3;
    priceSanityCheck.message = `Suspiciously low price: $${event.priceUsd}`;
  }

  // Flag suspiciously high prices for common cards
  if (event.priceUsd > 1000) {
    priceSanityCheck.score = 0.7;
    priceSanityCheck.message = `Very high price flagged for review: $${event.priceUsd}`;
  }

  checks.push(priceSanityCheck);

  // 4. Currency consistency check
  const currencyCheck: ValidationCheck = {
    layer: "semantic",
    rule: "sem_currency_consistency",
    passed: true,
    score: 1.0,
  };

  // Check if USD and GBP prices are roughly consistent (within 30% of expected ratio)
  const expectedGbp = event.priceUsd * 0.79; // Approximate USD to GBP
  const gbpRatio = event.priceGbp / expectedGbp;
  if (gbpRatio < 0.7 || gbpRatio > 1.3) {
    currencyCheck.passed = false;
    currencyCheck.score = 0.6;
    currencyCheck.message = `Currency conversion seems off: USD ${event.priceUsd} → GBP ${event.priceGbp}`;
    currencyCheck.details = { expectedGbp, actualGbp: event.priceGbp, ratio: gbpRatio };
  }
  checks.push(currencyCheck);

  // 5. Variant type validity
  const VALID_VARIANTS = ["regular", "parallel", "manga", "sp", "spr", "tr", "boxtopper", "wantedposter", "dashpack"];
  const variantCheck: ValidationCheck = {
    layer: "semantic",
    rule: "sem_valid_variant",
    passed: VALID_VARIANTS.includes(event.variantType.toLowerCase()),
    score: VALID_VARIANTS.includes(event.variantType.toLowerCase()) ? 1.0 : 0.7,
  };
  if (!variantCheck.passed) {
    variantCheck.message = `Unknown variant type: ${event.variantType}`;
  }
  checks.push(variantCheck);

  // 6. Card ID consistency
  const expectedCardId = `${event.setCode.toUpperCase()}-${event.cardNumber.padStart(3, "0")}${event.variantType !== "regular" ? `-${event.variantType}` : ""}`;
  const cardIdMatch = event.cardId.toLowerCase() === expectedCardId.toLowerCase();
  const cardIdCheck: ValidationCheck = {
    layer: "semantic",
    rule: "sem_card_id_consistency",
    passed: cardIdMatch,
    score: cardIdMatch ? 1.0 : 0.5,
    details: { expected: expectedCardId, actual: event.cardId },
  };
  if (!cardIdCheck.passed) {
    cardIdCheck.message = `Card ID inconsistent: expected ${expectedCardId}, got ${event.cardId}`;
  }
  checks.push(cardIdCheck);

  return checks;
}

// =============================================================================
// TEMPORAL VALIDATION
// =============================================================================

function validateTemporal(event: PriceEvent): ValidationCheck[] {
  const checks: ValidationCheck[] = [];
  const now = new Date();

  // 1. Timestamp freshness
  const timestamp = new Date(event.timestamp);
  const collectedAt = new Date(event.collectedAt);

  const timestampAge = (now.getTime() - timestamp.getTime()) / (1000 * 60 * 60); // hours
  const freshnessCheck: ValidationCheck = {
    layer: "temporal",
    rule: "temp_freshness",
    passed: timestampAge <= 168, // 7 days
    score: timestampAge <= 24 ? 1.0 : timestampAge <= 72 ? 0.9 : timestampAge <= 168 ? 0.7 : 0.4,
    details: { timestampAgeHours: timestampAge },
  };
  if (!freshnessCheck.passed) {
    freshnessCheck.message = `Data is ${timestampAge.toFixed(1)} hours old`;
  }
  checks.push(freshnessCheck);

  // 2. Future timestamp check
  const futureCheck: ValidationCheck = {
    layer: "temporal",
    rule: "temp_not_future",
    passed: timestamp <= now && collectedAt <= now,
    score: (timestamp <= now && collectedAt <= now) ? 1.0 : 0,
  };
  if (!futureCheck.passed) {
    futureCheck.message = "Timestamp is in the future";
  }
  checks.push(futureCheck);

  // 3. Collection delay check (time between price timestamp and collection)
  const collectionDelay = (collectedAt.getTime() - timestamp.getTime()) / (1000 * 60 * 60); // hours
  const delayCheck: ValidationCheck = {
    layer: "temporal",
    rule: "temp_collection_delay",
    passed: collectionDelay >= -1 && collectionDelay <= 24, // Allow 1 hour clock skew
    score: collectionDelay >= -1 && collectionDelay <= 24 ? 1.0 : 0.7,
    details: { collectionDelayHours: collectionDelay },
  };
  if (!delayCheck.passed) {
    delayCheck.message = `Collection delay of ${collectionDelay.toFixed(1)} hours is unusual`;
  }
  checks.push(delayCheck);

  // 4. Timestamp format validity
  const isValidTimestamp = !isNaN(timestamp.getTime()) && !isNaN(collectedAt.getTime());
  const formatCheck: ValidationCheck = {
    layer: "temporal",
    rule: "temp_valid_format",
    passed: isValidTimestamp,
    score: isValidTimestamp ? 1.0 : 0,
  };
  if (!formatCheck.passed) {
    formatCheck.message = "Invalid timestamp format";
  }
  checks.push(formatCheck);

  return checks;
}

// =============================================================================
// QUALITY SCORE AGGREGATION
// =============================================================================

function aggregateQualityScore(checks: ValidationCheck[]): ValidationResult {
  const startTime = Date.now();

  if (checks.length === 0) {
    return {
      isValid: false,
      score: 0,
      tier: "reject",
      checks: [],
      metadata: {
        validatedAt: nowIso(),
        processingTimeMs: Date.now() - startTime,
        rulesApplied: 0,
      },
    };
  }

  // Layer weights for final score
  const LAYER_WEIGHTS: Record<string, number> = {
    schema: 0.35,      // Schema issues are most critical
    statistical: 0.25, // Statistical outliers need review
    semantic: 0.25,    // Business rule violations
    temporal: 0.15,    // Freshness is important but less critical
  };

  // Calculate weighted score per layer
  const layerScores: Record<string, { total: number; count: number }> = {};

  for (const check of checks) {
    if (!layerScores[check.layer]) {
      layerScores[check.layer] = { total: 0, count: 0 };
    }
    layerScores[check.layer].total += check.score;
    layerScores[check.layer].count++;
  }

  let weightedScore = 0;
  let totalWeight = 0;

  for (const [layer, weight] of Object.entries(LAYER_WEIGHTS)) {
    if (layerScores[layer]) {
      const layerAvg = layerScores[layer].total / layerScores[layer].count;
      weightedScore += layerAvg * weight;
      totalWeight += weight;
    }
  }

  // Normalize score
  const finalScore = totalWeight > 0 ? weightedScore / totalWeight : 0;

  // Check for any critical failures (schema required fields)
  const hasCriticalFailure = checks.some(
    (c) => c.layer === "schema" && c.rule.includes("required") && !c.passed
  );

  // Determine tier
  let tier: ValidationResult["tier"];
  if (hasCriticalFailure || finalScore < QUALITY_THRESHOLDS.QUARANTINE) {
    tier = "reject";
  } else if (finalScore < QUALITY_THRESHOLDS.WARN) {
    tier = "quarantine";
  } else if (finalScore < QUALITY_THRESHOLDS.PASS) {
    tier = "warn";
  } else {
    tier = "pass";
  }

  return {
    isValid: tier === "pass" || tier === "warn",
    score: finalScore,
    tier,
    checks,
    metadata: {
      validatedAt: nowIso(),
      processingTimeMs: Date.now() - startTime,
      rulesApplied: checks.length,
    },
  };
}

// =============================================================================
// METRICS RECORDING
// =============================================================================

interface QualityMetrics {
  source: string;
  period: string; // hourly bucket
  totalRecords: number;
  passCount: number;
  warnCount: number;
  quarantineCount: number;
  rejectCount: number;
  avgScore: number;
  failedRules: Record<string, number>;
  lastUpdated: string;
}

async function recordMetrics(
  source: string,
  results: Array<{ result: ValidationResult; event: PriceEvent }>
): Promise<void> {
  if (results.length === 0) return;

  const hourBucket = new Date().toISOString().slice(0, 13); // YYYY-MM-DDTHH

  const metrics: QualityMetrics = {
    source,
    period: hourBucket,
    totalRecords: results.length,
    passCount: results.filter((r) => r.result.tier === "pass").length,
    warnCount: results.filter((r) => r.result.tier === "warn").length,
    quarantineCount: results.filter((r) => r.result.tier === "quarantine").length,
    rejectCount: results.filter((r) => r.result.tier === "reject").length,
    avgScore: results.reduce((sum, r) => sum + r.result.score, 0) / results.length,
    failedRules: {},
    lastUpdated: nowIso(),
  };

  // Count failed rules
  for (const { result } of results) {
    for (const check of result.checks) {
      if (!check.passed) {
        metrics.failedRules[check.rule] = (metrics.failedRules[check.rule] || 0) + 1;
      }
    }
  }

  // Store metrics
  await dynamoClient.send(
    new PutItemCommand({
      TableName: QUALITY_METRICS_TABLE,
      Item: marshall({
        pk: `${source}#${hourBucket}`,
        sk: "metrics",
        ...metrics,
        ttl: Math.floor(Date.now() / 1000) + 86400 * 30, // 30 days TTL
      }),
    })
  );

  console.log(`[QualityMetrics] ${source}: ${metrics.passCount} pass, ${metrics.warnCount} warn, ${metrics.quarantineCount} quarantine, ${metrics.rejectCount} reject`);
}

// =============================================================================
// MAIN HANDLER
// =============================================================================

export const handler: Handler<KinesisStreamEvent> = async (event) => {
  console.log(`Processing ${event.Records.length} records`);

  const validatedEvents: ValidatedPriceEvent[] = [];
  const quarantinedEvents: Array<ValidatedPriceEvent & { quarantineReason: string }> = [];
  const resultsBySource: Map<string, Array<{ result: ValidationResult; event: PriceEvent }>> = new Map();

  for (const record of event.Records) {
    try {
      const payload = JSON.parse(
        Buffer.from(record.kinesis.data, "base64").toString("utf8")
      ) as PriceEvent;

      // Skip non-price events
      if (payload.eventType !== "price") {
        continue;
      }

      // Run all validation layers
      const schemaChecks = validateSchema(payload);
      const statisticalChecks = await validateStatistical(payload);
      const semanticChecks = validateSemantic(payload);
      const temporalChecks = validateTemporal(payload);

      // Aggregate all checks
      const allChecks = [...schemaChecks, ...statisticalChecks, ...semanticChecks, ...temporalChecks];
      const result = aggregateQualityScore(allChecks);

      // Track results by source for metrics
      if (!resultsBySource.has(payload.source)) {
        resultsBySource.set(payload.source, []);
      }
      resultsBySource.get(payload.source)!.push({ result, event: payload });

      // Create validated event
      const validatedEvent: ValidatedPriceEvent = {
        ...payload,
        qualityScore: result.score,
        qualityTier: result.tier,
        validationDetails: result.checks.filter((c) => !c.passed), // Only include failed checks
        validatedAt: result.metadata.validatedAt,
      };

      // Route based on tier
      if (result.tier === "pass" || result.tier === "warn") {
        validatedEvents.push(validatedEvent);
      } else {
        const primaryFailure = result.checks.find((c) => !c.passed);
        quarantinedEvents.push({
          ...validatedEvent,
          quarantineReason: primaryFailure?.message || result.tier,
        });
      }
    } catch (error) {
      console.error("Error processing record:", error);
    }
  }

  // Record metrics for each source
  for (const [source, results] of resultsBySource) {
    await recordMetrics(source, results);
  }

  // Send validated events to downstream
  if (validatedEvents.length > 0) {
    await putToKinesis(VALIDATED_STREAM, validatedEvents as unknown as PriceEvent[]);
    console.log(`Sent ${validatedEvents.length} validated events`);
  }

  // Send quarantined events for review
  if (quarantinedEvents.length > 0) {
    await putToKinesis(QUARANTINE_STREAM, quarantinedEvents as unknown as PriceEvent[]);
    console.log(`Quarantined ${quarantinedEvents.length} events for review`);
  }

  return {
    batchItemFailures: [],
  };
};
