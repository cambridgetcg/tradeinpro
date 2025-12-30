/**
 * Japanese Card Price Management
 * Handles import from CSV/S3, sync to CardPriceV2, and price calculations
 */

import prisma from "../db.server";
import type { Prisma } from "@prisma/client";
import { poundsToPence, toNumber } from "./pricing.server";
import { getOrCreateSettings } from "./settings.server";
import { DefaultConditionMultipliers } from "./constants";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import * as XLSX from "xlsx";

// S3 Configuration
const S3_REGION = process.env.AWS_REGION || "us-east-1";
const PRICE_BUCKET = "pricedata-tcg";
const PRICE_FILE = "pricefeed/onepiece_pricefeed.xlsx";
const IMAGE_BUCKET = "jp-op-photos";
const IMAGE_PREFIX = "Official";

// ============================================================================
// TYPES
// ============================================================================

export interface JpPriceRecord {
  sku: string;
  name: string;
  setCode?: string;
  cardNumber?: string;
  variantType?: string;
  rarity?: string;
  priceJpy?: number;
  priceGbp?: number; // In pounds (will be converted to pence)
}

export interface ImportResult {
  created: number;
  updated: number;
  skipped: number;
  errors: Array<{ row: number; sku: string; error: string }>;
  totalProcessed: number;
}

export interface SyncResult {
  created: number;
  updated: number;
  skipped: number;
  errors: Array<{ sku: string; error: string }>;
  totalProcessed: number;
}

export interface JpPriceStats {
  totalRecords: number;
  syncedRecords: number;
  unsyncedRecords: number;
  averagePriceGbp: number;
  lastUpdated: Date | null;
}

// ============================================================================
// CSV PARSING
// ============================================================================

/**
 * Parse CSV content and return normalized price records
 * Expected columns: sku, name, set_code, card_number, variant_type, rarity, price_jpy, price_gbp
 */
export function parseJapanesePriceCsv(csvContent: string): {
  records: JpPriceRecord[];
  errors: Array<{ row: number; error: string }>;
} {
  const lines = csvContent.trim().split("\n");
  if (lines.length < 2) {
    return { records: [], errors: [{ row: 0, error: "CSV must have header and at least one data row" }] };
  }

  // Parse header
  const headerLine = lines[0].toLowerCase();
  const headers = parseCSVLine(headerLine);

  // Map column names to indices
  const colMap: Record<string, number> = {};
  const columnMappings: Record<string, string[]> = {
    sku: ["sku", "product_sku", "item_sku"],
    name: ["name", "card_name", "product_name", "title"],
    setCode: ["set_code", "setcode", "set", "release_set"],
    cardNumber: ["card_number", "cardnumber", "number", "card_no"],
    variantType: ["variant_type", "varianttype", "variant", "type"],
    rarity: ["rarity", "card_rarity"],
    priceJpy: ["price_jpy", "pricejpy", "jpy_price", "jpy", "price_yen"],
    priceGbp: ["price_gbp", "pricegbp", "gbp_price", "gbp", "price_pound", "price"],
  };

  for (const [field, aliases] of Object.entries(columnMappings)) {
    const idx = headers.findIndex((h) => aliases.includes(h.trim()));
    if (idx !== -1) {
      colMap[field] = idx;
    }
  }

  // Validate required columns
  if (colMap.sku === undefined) {
    return { records: [], errors: [{ row: 0, error: "CSV must have 'sku' column" }] };
  }
  if (colMap.name === undefined) {
    return { records: [], errors: [{ row: 0, error: "CSV must have 'name' column" }] };
  }
  if (colMap.priceGbp === undefined && colMap.priceJpy === undefined) {
    return { records: [], errors: [{ row: 0, error: "CSV must have 'price_gbp' or 'price_jpy' column" }] };
  }

  const records: JpPriceRecord[] = [];
  const errors: Array<{ row: number; error: string }> = [];

  // Parse data rows
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    try {
      const cols = parseCSVLine(line);

      const sku = cols[colMap.sku]?.trim();
      const name = cols[colMap.name]?.trim();

      if (!sku || !name) {
        errors.push({ row: i + 1, error: "Missing required field: sku or name" });
        continue;
      }

      const record: JpPriceRecord = {
        sku,
        name,
        setCode: colMap.setCode !== undefined ? cols[colMap.setCode]?.trim() || undefined : undefined,
        cardNumber: colMap.cardNumber !== undefined ? cols[colMap.cardNumber]?.trim() || undefined : undefined,
        variantType: colMap.variantType !== undefined ? cols[colMap.variantType]?.trim() || undefined : undefined,
        rarity: colMap.rarity !== undefined ? cols[colMap.rarity]?.trim() || undefined : undefined,
      };

      // Parse prices
      if (colMap.priceJpy !== undefined) {
        const jpyStr = cols[colMap.priceJpy]?.trim();
        if (jpyStr) {
          const jpy = parseFloat(jpyStr.replace(/[,¥]/g, ""));
          if (!isNaN(jpy) && jpy > 0) {
            record.priceJpy = Math.round(jpy);
          }
        }
      }

      if (colMap.priceGbp !== undefined) {
        const gbpStr = cols[colMap.priceGbp]?.trim();
        if (gbpStr) {
          const gbp = parseFloat(gbpStr.replace(/[,£]/g, ""));
          if (!isNaN(gbp) && gbp > 0) {
            record.priceGbp = gbp;
          }
        }
      }

      // Validate that we have at least one price
      if (record.priceJpy === undefined && record.priceGbp === undefined) {
        errors.push({ row: i + 1, error: `No valid price for SKU: ${sku}` });
        continue;
      }

      records.push(record);
    } catch (err) {
      errors.push({ row: i + 1, error: `Parse error: ${err instanceof Error ? err.message : String(err)}` });
    }
  }

  return { records, errors };
}

/**
 * Parse a single CSV line handling quoted fields
 */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  result.push(current);
  return result;
}

// ============================================================================
// EXCHANGE RATE
// ============================================================================

let cachedJpyRate: { rate: number; fetchedAt: number } | null = null;
const ONE_HOUR = 60 * 60 * 1000;

/**
 * Fetch current JPY→GBP exchange rate
 */
export async function getJpyExchangeRate(): Promise<number> {
  if (cachedJpyRate && Date.now() - cachedJpyRate.fetchedAt < ONE_HOUR) {
    return cachedJpyRate.rate;
  }

  const fallbackRate = 0.0053; // ~188 JPY per GBP

  try {
    const response = await fetch("https://api.exchangerate-api.com/v4/latest/JPY");
    if (!response.ok) {
      console.warn("Failed to fetch JPY exchange rate, using fallback");
      return fallbackRate;
    }
    const data = (await response.json()) as { rates: { GBP: number } };

    cachedJpyRate = {
      rate: data.rates.GBP,
      fetchedAt: Date.now(),
    };

    console.log(`Fetched exchange rate - JPY→GBP: ${cachedJpyRate.rate}`);
    return cachedJpyRate.rate;
  } catch (error) {
    console.warn("Error fetching JPY exchange rate, using fallback:", error);
    return fallbackRate;
  }
}

/**
 * Convert JPY to GBP pence
 */
export async function jpyToGbpPence(jpyAmount: number): Promise<{ pence: number; rate: number }> {
  const rate = await getJpyExchangeRate();
  const gbpPounds = jpyAmount * rate;
  const pence = poundsToPence(gbpPounds);
  return { pence, rate };
}

// ============================================================================
// IMPORT FUNCTIONS
// ============================================================================

/**
 * Import Japanese price records to JapanesePriceSource table
 */
export async function importJapanesePrices(
  records: JpPriceRecord[],
  onProgress?: (progress: number, message: string) => void
): Promise<ImportResult> {
  const result: ImportResult = {
    created: 0,
    updated: 0,
    skipped: 0,
    errors: [],
    totalProcessed: 0,
  };

  const BATCH_SIZE = 50;
  const total = records.length;
  let jpyToGbpRate: number | null = null;

  for (let i = 0; i < total; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);

    for (const record of batch) {
      try {
        // Convert JPY to GBP if needed
        let priceGbpPence: number | null = null;
        let usedJpyRate: number | null = null;

        if (record.priceGbp !== undefined && record.priceGbp > 0) {
          priceGbpPence = poundsToPence(record.priceGbp);
        } else if (record.priceJpy !== undefined && record.priceJpy > 0) {
          // Lazy load exchange rate
          if (jpyToGbpRate === null) {
            jpyToGbpRate = await getJpyExchangeRate();
          }
          const gbpPounds = record.priceJpy * jpyToGbpRate;
          priceGbpPence = poundsToPence(gbpPounds);
          usedJpyRate = jpyToGbpRate;
        }

        if (priceGbpPence === null || priceGbpPence <= 0) {
          result.errors.push({ row: 0, sku: record.sku, error: "Invalid price" });
          continue;
        }

        // Calculate trade-in price (70% of market price for NM)
        const tradeinPriceGbp = Math.floor(priceGbpPence * DefaultConditionMultipliers.NM);

        // Upsert to database
        const existing = await prisma.japanesePriceSource.findUnique({
          where: { sku: record.sku },
        });

        const data: Prisma.JapanesePriceSourceCreateInput = {
          sku: record.sku,
          name: record.name,
          setCode: record.setCode || extractSetCode(record.sku),
          cardNumber: record.cardNumber || extractCardNumber(record.sku),
          variantType: record.variantType || extractVariant(record.sku),
          rarity: record.rarity,
          priceJpy: record.priceJpy,
          priceGbp: priceGbpPence,
          tradeinPriceGbp,
          jpyToGbpRate: usedJpyRate,
          source: "csv_import",
          syncedToCardPrice: false, // Reset sync status on update
        };

        if (existing) {
          await prisma.japanesePriceSource.update({
            where: { sku: record.sku },
            data: {
              ...data,
              updatedAt: new Date(),
            },
          });
          result.updated++;
        } else {
          await prisma.japanesePriceSource.create({ data });
          result.created++;
        }

        result.totalProcessed++;
      } catch (error) {
        result.errors.push({
          row: 0,
          sku: record.sku,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Report progress
    const progress = Math.min(100, Math.round(((i + batch.length) / total) * 100));
    onProgress?.(progress, `Processed ${i + batch.length} of ${total} records`);
  }

  return result;
}

// ============================================================================
// SYNC TO CARDPRICEV2
// ============================================================================

/**
 * Sync JapanesePriceSource records to CardPriceV2 with language="JP"
 */
export async function syncJapanesePricesToCards(
  shop: string,
  onProgress?: (progress: number, message: string) => void
): Promise<SyncResult> {
  const result: SyncResult = {
    created: 0,
    updated: 0,
    skipped: 0,
    errors: [],
    totalProcessed: 0,
  };

  // Get settings for multipliers
  const settings = await getOrCreateSettings(shop);

  // Get unsynced records (or all records for full sync)
  const jpPrices = await prisma.japanesePriceSource.findMany({
    where: {
      priceGbp: { not: null },
    },
    orderBy: { updatedAt: "desc" },
  });

  const BATCH_SIZE = 50;
  const total = jpPrices.length;

  for (let i = 0; i < total; i += BATCH_SIZE) {
    const batch = jpPrices.slice(i, i + BATCH_SIZE);

    for (const jpPrice of batch) {
      try {
        if (!jpPrice.priceGbp) {
          result.skipped++;
          continue;
        }

        // Create card ID with JP prefix to avoid collision with EN cards
        const cardId = `JP-${jpPrice.sku}`.toUpperCase();

        // Calculate trade-in price with NM multiplier
        const tradeinPriceGbp = Math.floor(
          jpPrice.priceGbp * settings.conditionMultiplierNM
        );

        // Check if card exists
        const existing = await prisma.cardPriceV2.findUnique({
          where: { cardId },
          select: { imageUrl: true },
        });

        // Determine image URL:
        // - Preserve existing full URL if present (handles SP cards correctly)
        // - Otherwise construct from setCode/cardNumber (works for regular cards)
        const existingImageUrl = existing?.imageUrl;
        const existingHasFullUrl = existingImageUrl?.startsWith("https://") ?? false;
        const newImageUrl = existingHasFullUrl
          ? existingImageUrl // Preserve existing full URL
          : jpPrice.setCode && jpPrice.cardNumber
            ? getJpCardImageUrl(jpPrice.setCode, jpPrice.cardNumber)
            : null;

        const cardData = {
          name: jpPrice.name,
          game: "onepiece",
          language: "JP",
          releaseSet: jpPrice.setCode,
          setCode: jpPrice.setCode,
          cardNumber: jpPrice.cardNumber,
          variantType: jpPrice.variantType,
          rarity: jpPrice.rarity,
          bestPriceGbp: jpPrice.priceGbp / 100, // Convert pence to pounds for Decimal
          tradeinPriceGbp: tradeinPriceGbp / 100, // Convert pence to pounds for Decimal
          lastUpdated: new Date(),
          imageUrl: newImageUrl,
        };

        if (existing) {
          await prisma.cardPriceV2.update({
            where: { cardId },
            data: cardData,
          });
          result.updated++;
        } else {
          await prisma.cardPriceV2.create({
            data: {
              cardId,
              ...cardData,
            },
          });
          result.created++;
        }

        // Mark as synced
        await prisma.japanesePriceSource.update({
          where: { id: jpPrice.id },
          data: {
            syncedToCardPrice: true,
            cardPriceV2Id: cardId,
          },
        });

        result.totalProcessed++;
      } catch (error) {
        result.errors.push({
          sku: jpPrice.sku,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Report progress
    const progress = Math.min(100, Math.round(((i + batch.length) / total) * 100));
    onProgress?.(progress, `Synced ${i + batch.length} of ${total} cards`);
  }

  return result;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Extract set code from SKU (e.g., "OP01-003-P" -> "OP01")
 */
function extractSetCode(sku: string): string | undefined {
  const match = sku.match(/^([A-Z]{2,4}\d{2})/i);
  return match ? match[1].toUpperCase() : undefined;
}

/**
 * Extract card number from SKU (e.g., "OP01-003-P" -> "003")
 */
function extractCardNumber(sku: string): string | undefined {
  const parts = sku.split("-");
  if (parts.length >= 2) {
    const num = parts[1].match(/^\d+/);
    return num ? num[0] : undefined;
  }
  return undefined;
}

/**
 * Extract variant from SKU (e.g., "OP01-003-P" -> "parallel")
 */
function extractVariant(sku: string): string | undefined {
  const parts = sku.split("-");
  if (parts.length >= 3) {
    const variant = parts.slice(2).join("-").toLowerCase();
    const variantMap: Record<string, string> = {
      p: "parallel",
      sp: "sp",
      spr: "spr",
      tr: "tr",
      manga: "manga",
      boxtopper: "boxtopper",
    };
    return variantMap[variant] || variant || undefined;
  }
  return undefined;
}

/**
 * Get Japanese price statistics
 */
export async function getJpPriceStats(): Promise<JpPriceStats> {
  const [total, synced, avgPrice, latest] = await Promise.all([
    prisma.japanesePriceSource.count(),
    prisma.japanesePriceSource.count({ where: { syncedToCardPrice: true } }),
    prisma.japanesePriceSource.aggregate({
      _avg: { priceGbp: true },
      where: { priceGbp: { not: null } },
    }),
    prisma.japanesePriceSource.findFirst({
      orderBy: { updatedAt: "desc" },
      select: { updatedAt: true },
    }),
  ]);

  return {
    totalRecords: total,
    syncedRecords: synced,
    unsyncedRecords: total - synced,
    averagePriceGbp: avgPrice._avg.priceGbp ? toNumber(avgPrice._avg.priceGbp) / 100 : 0,
    lastUpdated: latest?.updatedAt || null,
  };
}

/**
 * Search Japanese price records
 */
export async function searchJpPrices(params: {
  search?: string;
  setCode?: string;
  synced?: boolean;
  page?: number;
  limit?: number;
}) {
  const page = Math.max(1, params.page || 1);
  const limit = Math.min(100, Math.max(1, params.limit || 20));
  const skip = (page - 1) * limit;

  const where: Prisma.JapanesePriceSourceWhereInput = {};

  if (params.search?.trim()) {
    where.OR = [
      { name: { contains: params.search.trim(), mode: "insensitive" } },
      { sku: { contains: params.search.trim(), mode: "insensitive" } },
    ];
  }

  if (params.setCode) {
    where.setCode = params.setCode;
  }

  if (params.synced !== undefined) {
    where.syncedToCardPrice = params.synced;
  }

  const [records, total] = await Promise.all([
    prisma.japanesePriceSource.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.japanesePriceSource.count({ where }),
  ]);

  return {
    records,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

/**
 * Get unique set codes from Japanese prices
 */
export async function getJpSetCodes(): Promise<string[]> {
  const results = await prisma.japanesePriceSource.groupBy({
    by: ["setCode"],
    orderBy: { setCode: "asc" },
  });

  return results.map((r) => r.setCode).filter((s): s is string => s !== null);
}

/**
 * Delete all Japanese price records (for reimport)
 */
export async function clearJpPrices(): Promise<number> {
  const result = await prisma.japanesePriceSource.deleteMany();
  return result.count;
}

/**
 * Update exchange rates for all JPY prices
 */
export async function updateJpyExchangeRates(): Promise<number> {
  const rate = await getJpyExchangeRate();

  // Get all records with JPY prices
  const records = await prisma.japanesePriceSource.findMany({
    where: { priceJpy: { not: null } },
  });

  let updated = 0;
  for (const record of records) {
    if (record.priceJpy) {
      const gbpPounds = record.priceJpy * rate;
      const priceGbpPence = poundsToPence(gbpPounds);
      const tradeinPriceGbp = Math.floor(priceGbpPence * DefaultConditionMultipliers.NM);

      await prisma.japanesePriceSource.update({
        where: { id: record.id },
        data: {
          priceGbp: priceGbpPence,
          tradeinPriceGbp,
          jpyToGbpRate: rate,
          syncedToCardPrice: false, // Needs resync
        },
      });
      updated++;
    }
  }

  return updated;
}

// ============================================================================
// S3 SYNC FUNCTIONS
// ============================================================================

/**
 * Create S3 client (uses default credential chain - IAM role, env vars, or ~/.aws/credentials)
 */
function getS3Client(): S3Client {
  return new S3Client({ region: S3_REGION });
}

/**
 * Download and parse the onepiece_pricefeed.xlsx from S3
 */
export async function downloadPriceFeedFromS3(): Promise<{
  records: JpPriceRecord[];
  lastModified: Date | null;
}> {
  const s3 = getS3Client();

  console.log(`S3: Downloading s3://${PRICE_BUCKET}/${PRICE_FILE}`);

  const command = new GetObjectCommand({
    Bucket: PRICE_BUCKET,
    Key: PRICE_FILE,
  });

  const response = await s3.send(command);

  if (!response.Body) {
    throw new Error("Empty response body from S3");
  }

  // Convert stream to buffer
  const chunks: Uint8Array[] = [];
  const reader = response.Body.transformToWebStream().getReader();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  const buffer = Buffer.concat(chunks);
  console.log(`S3: Downloaded ${buffer.length} bytes`);

  // Parse Excel file
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];

  // Convert to JSON
  const data = XLSX.utils.sheet_to_json(sheet) as Record<string, unknown>[];
  console.log(`S3: Parsed ${data.length} rows from sheet "${sheetName}"`);

  // Find the latest date column for JPY price
  const columns = Object.keys(data[0] || {});
  const dateColumns = columns.filter((col) => /^\d{4}-\d{2}-\d{2}/.test(col));
  const latestDateCol = dateColumns.sort().pop();

  console.log(`S3: Using JPY price column: ${latestDateCol}`);

  // Convert to JpPriceRecord format
  const records: JpPriceRecord[] = [];

  for (const row of data) {
    const sku = String(row["sku"] || "").trim();
    if (!sku) continue;

    // Extract card number from SKU (e.g., "OP-OP01-001-JP" -> "OP01-001")
    const cardNumber = extractCardNumberFromSku(sku);

    // Get JPY price from latest date column
    const jpyPrice = latestDateCol ? Number(row[latestDateCol]) : undefined;

    // Get GBP base cost (cost price, not selling price) for trade-in calculations
    const gbpPrice = row["base_cost"] ? Number(row["base_cost"]) : undefined;

    if (!jpyPrice && !gbpPrice) continue;

    records.push({
      sku,
      name: cardNumber || sku, // Use card number as name since pricefeed doesn't have names
      setCode: extractSetCodeFromSku(sku),
      cardNumber: extractCardNumFromSku(sku),
      priceJpy: jpyPrice && jpyPrice > 0 ? Math.round(jpyPrice) : undefined,
      priceGbp: gbpPrice && gbpPrice > 0 ? gbpPrice : undefined,
    });
  }

  console.log(`S3: Extracted ${records.length} valid price records`);

  return {
    records,
    lastModified: response.LastModified || null,
  };
}

/**
 * Extract card number from S3 SKU format
 * e.g., "OP-OP01-001-JP" -> "OP01-001"
 */
function extractCardNumberFromSku(sku: string): string | undefined {
  // SKU format: OP-OP01-001-JP or PKMN-SV1A-074-JP
  const match = sku.match(/^[A-Z]+-([A-Z0-9]+-\d+)/i);
  return match ? match[1].toUpperCase() : undefined;
}

/**
 * Extract set code from S3 SKU format
 * e.g., "OP-OP01-001-JP" -> "OP01"
 */
function extractSetCodeFromSku(sku: string): string | undefined {
  const cardNum = extractCardNumberFromSku(sku);
  if (cardNum) {
    const parts = cardNum.split("-");
    return parts[0];
  }
  return undefined;
}

/**
 * Extract card number only from S3 SKU format
 * e.g., "OP-OP01-001-JP" -> "001"
 */
function extractCardNumFromSku(sku: string): string | undefined {
  const cardNum = extractCardNumberFromSku(sku);
  if (cardNum) {
    const parts = cardNum.split("-");
    return parts.length > 1 ? parts[1] : undefined;
  }
  return undefined;
}

/**
 * Sync prices directly from S3 pricefeed
 */
export async function syncFromS3(
  onProgress?: (progress: number, message: string) => void
): Promise<ImportResult & { lastModified: Date | null }> {
  console.log("S3 Sync: Starting...");

  // Download and parse from S3
  onProgress?.(10, "Downloading price feed from S3...");
  const { records, lastModified } = await downloadPriceFeedFromS3();

  if (records.length === 0) {
    return {
      created: 0,
      updated: 0,
      skipped: 0,
      errors: [{ row: 0, sku: "", error: "No valid records in price feed" }],
      totalProcessed: 0,
      lastModified,
    };
  }

  onProgress?.(30, `Importing ${records.length} records...`);

  // Import to database
  const result = await importJapanesePrices(records, (progress, message) => {
    // Scale progress from 30-100
    const scaledProgress = 30 + Math.floor(progress * 0.7);
    onProgress?.(scaledProgress, message);
  });

  console.log(`S3 Sync: Complete - Created: ${result.created}, Updated: ${result.updated}`);

  return {
    ...result,
    lastModified,
  };
}

/**
 * Get image URL for a card from S3
 * Images are stored at: jp-op-photos/Official/{SET}/{CARD_NUMBER}.png
 */
export function getJpCardImageUrl(setCode: string, cardNumber: string): string {
  // Format: https://jp-op-photos.s3.amazonaws.com/Official/OP01/OP01-001.png
  const cardId = `${setCode}-${cardNumber}`;
  return `https://${IMAGE_BUCKET}.s3.${S3_REGION}.amazonaws.com/${IMAGE_PREFIX}/${setCode}/${cardId}.png`;
}

/**
 * Full S3 sync: Download prices and sync to CardPriceV2
 */
export async function fullS3Sync(
  shop: string,
  onProgress?: (progress: number, message: string) => void
): Promise<{
  import: ImportResult;
  sync: SyncResult;
  lastModified: Date | null;
}> {
  // Step 1: Import from S3
  onProgress?.(5, "Downloading from S3...");
  const importResult = await syncFromS3((progress, message) => {
    const scaledProgress = 5 + Math.floor(progress * 0.45);
    onProgress?.(scaledProgress, message);
  });

  // Step 2: Sync to CardPriceV2
  onProgress?.(55, "Syncing to trade-in database...");
  const syncResult = await syncJapanesePricesToCards(shop, (progress, message) => {
    const scaledProgress = 55 + Math.floor(progress * 0.45);
    onProgress?.(scaledProgress, message);
  });

  onProgress?.(100, "Complete!");

  return {
    import: importResult,
    sync: syncResult,
    lastModified: importResult.lastModified,
  };
}
