/**
 * S3 Price Data Service
 *
 * Handles fetching and parsing price data from S3 bucket.
 * Supports daily_prices.xlsx (historical) and pricefeed/*.xlsx (multi-channel).
 *
 * @synapse See docs/S3_PRICE_PIPELINE_PLAN.md for architecture
 */

import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import * as XLSX from "xlsx";
import { Readable } from "stream";
import prisma from "../db.server";
import { logger } from "./observability.server";

// ============================================================================
// Configuration
// ============================================================================

const S3_BUCKET = process.env.S3_PRICE_BUCKET || "pricedata-tcg";
const S3_REGION = process.env.S3_REGION || "us-east-1";
const JPY_TO_GBP_DEFAULT = 1 / 212; // Fallback exchange rate

// ============================================================================
// Types
// ============================================================================

export interface HistoricalPriceRow {
  cardNumber: string;
  sku: string;
  date: Date;
  priceJpy: number;
  priceGbp: number;
}

export interface PriceFeedRow {
  sku: string;
  source: string;
  priceJpy: number;
  baseCostGbp: number;
  totalCostGbp: number;
  sellingPriceGbp: number;
  exchangeRate: number;
  platformId?: string;
}

export interface SyncResult {
  synced: number;
  skipped: number;
  errors: string[];
  newDates?: string[];
}

export interface CardHistoryPoint {
  date: string;
  priceGbp: number;
  priceJpy: number | null;
  exchangeRate: number | null;
  change: number;
  changeJpy: number | null;
  changeFx: number | null;
}

export interface CardHistoryResponse {
  cardId: string;
  name: string | null;
  setCode: string | null;
  game: string;
  history: CardHistoryPoint[];
  stats: {
    currentGbp: number;
    currentJpy: number | null;
    highGbp: number;
    highJpy: number | null;
    lowGbp: number;
    lowJpy: number | null;
    avgGbp: number;
    avgJpy: number | null;
    change7dGbp: number;
    change7dJpy: number | null;
    change30dGbp: number;
    change30dJpy: number | null;
  };
  exchangeRate: {
    current: number | null;
    change24h: number | null;
  };
}

// ============================================================================
// S3 Client
// ============================================================================

const s3Client = new S3Client({ region: S3_REGION });

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/**
 * Download a file from S3
 */
export async function downloadFromS3(key: string): Promise<Buffer> {
  logger.info("Downloading from S3", { bucket: S3_BUCKET, key });

  const command = new GetObjectCommand({ Bucket: S3_BUCKET, Key: key });
  const response = await s3Client.send(command);

  if (!response.Body) {
    throw new Error(`Empty response from S3 for ${key}`);
  }

  const buffer = await streamToBuffer(response.Body as Readable);
  logger.info("S3 download complete", { key, size: buffer.length });

  return buffer;
}

// ============================================================================
// SKU Mapping
// ============================================================================

/**
 * Normalize card number to match database fullCardNumber format
 */
export function normalizeCardNumber(cardNumber: string, game: string): string {
  if (game === "onepiece") {
    // OP01-001 -> OP01-001 (already correct format)
    const match = cardNumber.match(/^([A-Z0-9]+)-(\d+)$/i);
    if (match) {
      return `${match[1].toUpperCase()}-${match[2]}`;
    }
  }
  return cardNumber;
}

/**
 * Extract set code from card number
 */
export function extractSetCode(cardNumber: string): string | null {
  const match = cardNumber.match(/^([A-Z0-9]+)-/i);
  return match ? match[1].toUpperCase() : null;
}

/**
 * Build a mapping from normalized card numbers to database cardIds
 */
export async function buildCardMapping(
  game: string
): Promise<Map<string, { cardId: string; setCode: string | null; name: string }>> {
  const cards = await prisma.cardPriceV2.findMany({
    where: { game },
    select: { cardId: true, setCode: true, fullCardNumber: true, name: true, bestPriceGbp: true },
    orderBy: { bestPriceGbp: "desc" },
  });

  const mapping = new Map<string, { cardId: string; setCode: string | null; name: string }>();

  for (const card of cards) {
    // Map by fullCardNumber (prefer highest-priced variant)
    if (card.fullCardNumber && !mapping.has(card.fullCardNumber)) {
      mapping.set(card.fullCardNumber, {
        cardId: card.cardId,
        setCode: card.setCode,
        name: card.name,
      });
    }
  }

  return mapping;
}

// ============================================================================
// Excel Parsing
// ============================================================================

/**
 * Parse daily_prices.xlsx for historical data
 */
export function parseDailyPrices(
  buffer: Buffer,
  game: string,
  exchangeRate: number = JPY_TO_GBP_DEFAULT
): HistoricalPriceRow[] {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = game === "onepiece" ? "onepiece" : "pokemon";
  const sheet = workbook.Sheets[sheetName];

  if (!sheet) {
    throw new Error(`Sheet '${sheetName}' not found in daily_prices.xlsx`);
  }

  const data = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 });
  const headers = data[0];
  const rows: HistoricalPriceRow[] = [];

  // Find date columns (skip card_number, sku, cardrush)
  const dateColumns: { index: number; date: Date }[] = [];
  for (let i = 0; i < headers.length; i++) {
    const dateMatch = String(headers[i]).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (dateMatch) {
      dateColumns.push({
        index: i,
        date: new Date(parseInt(dateMatch[1]), parseInt(dateMatch[2]) - 1, parseInt(dateMatch[3])),
      });
    }
  }

  // Process each card row
  for (let rowIdx = 1; rowIdx < data.length; rowIdx++) {
    const row = data[rowIdx];
    if (!row || row.length < 3) continue;

    const cardNumber = String(row[0] || "");
    const sku = String(row[1] || "");

    if (!cardNumber) continue;

    // Extract price for each date
    for (const { index, date } of dateColumns) {
      const priceJpy = Number(row[index]);
      if (!priceJpy || isNaN(priceJpy) || priceJpy <= 0) continue;

      rows.push({
        cardNumber: normalizeCardNumber(cardNumber, game),
        sku,
        date,
        priceJpy,
        priceGbp: priceJpy * exchangeRate,
      });
    }
  }

  return rows;
}

/**
 * Parse pricefeed/*.xlsx for multi-channel data
 */
export function parsePriceFeed(buffer: Buffer): PriceFeedRow[] {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const rows: PriceFeedRow[] = [];

  const sourceSheets = ["ebay_business", "ebay_private", "cardmarket", "cardtrader", "shopify"];

  for (const sheetName of sourceSheets) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;

    const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);

    for (const row of data) {
      const sku = String(row["sku"] || "");
      if (!sku) continue;

      // Find the date column (format: YYYY-MM-DD)
      let priceJpy = 0;
      for (const key of Object.keys(row)) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(key)) {
          priceJpy = Number(row[key]) || 0;
          break;
        }
      }

      // Get platform-specific ID
      let platformId: string | undefined;
      if (sheetName.startsWith("ebay")) {
        platformId = String(row["ebay_item_number"] || "");
      } else if (sheetName === "cardmarket") {
        platformId = String(row["cardmarketid"] || "");
      }

      rows.push({
        sku,
        source: sheetName,
        priceJpy,
        baseCostGbp: Number(row["base_cost"]) || 0,
        totalCostGbp: Number(row["total_cost"]) || 0,
        sellingPriceGbp: Number(row["selling_price"]) || 0,
        exchangeRate: Number(row["gbp_to_jpy"]) || 212,
        platformId: platformId || undefined,
      });
    }
  }

  return rows;
}

// ============================================================================
// Sync Functions
// ============================================================================

/**
 * Sync historical prices from S3 daily_prices.xlsx
 * Now stores both JPY (source) and GBP (converted) prices with exchange rate
 */
export async function syncDailyPrices(game: string = "onepiece"): Promise<SyncResult> {
  const result: SyncResult = { synced: 0, skipped: 0, errors: [], newDates: [] };

  try {
    // Get existing dates
    const existingDates = await prisma.$queryRaw<{ snapshot_date: Date }[]>`
      SELECT DISTINCT snapshot_date FROM card_price_history WHERE game = ${game}
    `;
    const existingDateSet = new Set(existingDates.map((d) => d.snapshot_date.toISOString().split("T")[0]));

    // Download and parse S3 file
    const buffer = await downloadFromS3("daily_prices.xlsx");

    // Get exchange rate from latest pricefeed
    let exchangeRate = JPY_TO_GBP_DEFAULT;
    let gbpToJpy = 1 / JPY_TO_GBP_DEFAULT;
    try {
      const pfBuffer = await downloadFromS3(`pricefeed/${game}_pricefeed.xlsx`);
      const pfRows = parsePriceFeed(pfBuffer);
      if (pfRows.length > 0 && pfRows[0].exchangeRate > 0) {
        gbpToJpy = pfRows[0].exchangeRate;
        exchangeRate = 1 / gbpToJpy;
      }
    } catch {
      logger.warn("Could not get exchange rate from pricefeed, using default");
    }

    // Store exchange rate history
    await upsertExchangeRate(exchangeRate, gbpToJpy);

    const rows = parseDailyPrices(buffer, game, exchangeRate);
    logger.info("Parsed daily prices", { game, totalRows: rows.length, exchangeRate });

    // Build card mapping
    const cardMapping = await buildCardMapping(game);

    // Filter to only new dates
    const newRows = rows.filter((r) => {
      const dateStr = r.date.toISOString().split("T")[0];
      return !existingDateSet.has(dateStr);
    });

    if (newRows.length === 0) {
      logger.info("No new dates to sync", { game });
      return result;
    }

    // Group by date for logging
    const newDateSet = new Set(newRows.map((r) => r.date.toISOString().split("T")[0]));
    result.newDates = Array.from(newDateSet).sort();
    logger.info("New dates found", { game, dateCount: result.newDates.length, dates: result.newDates.join(", ") });

    // Calculate changes and prepare for insert (now with JPY data)
    const inserts: {
      id: string;
      cardId: string;
      game: string;
      setCode: string | null;
      priceJpy: number;
      priceGbp: number;
      exchangeRate: number;
      sourceUsed: string;
      change: number;
      changeJpy: number;
      changeFx: number;
      snapshotDate: Date;
    }[] = [];

    // Group rows by card for change calculation
    const rowsByCard = new Map<string, HistoricalPriceRow[]>();
    for (const row of newRows) {
      const cardInfo = cardMapping.get(row.cardNumber);
      const cardId = cardInfo?.cardId || row.cardNumber;
      if (!rowsByCard.has(cardId)) rowsByCard.set(cardId, []);
      rowsByCard.get(cardId)!.push(row);
    }

    for (const [cardId, cardRows] of rowsByCard.entries()) {
      cardRows.sort((a, b) => a.date.getTime() - b.date.getTime());

      let previousPriceJpy: number | null = null;
      let previousPriceGbp: number | null = null;
      let previousExchangeRate: number | null = null;

      // Get last known prices before our new data
      const firstDate = cardRows[0].date;
      const lastKnownPrice = await prisma.cardPriceHistory.findFirst({
        where: {
          cardId,
          snapshotDate: { lt: firstDate },
        },
        orderBy: { snapshotDate: "desc" },
        select: { priceGbp: true, priceJpy: true, exchangeRate: true },
      });

      if (lastKnownPrice) {
        previousPriceGbp = lastKnownPrice.priceGbp.toNumber();
        previousPriceJpy = lastKnownPrice.priceJpy?.toNumber() || null;
        previousExchangeRate = lastKnownPrice.exchangeRate?.toNumber() || null;
      }

      for (const row of cardRows) {
        const cardInfo = cardMapping.get(row.cardNumber);

        // Calculate changes
        const changeGbp = previousPriceGbp && previousPriceGbp > 0
          ? ((row.priceGbp - previousPriceGbp) / previousPriceGbp) * 100
          : 0;

        const changeJpy = previousPriceJpy && previousPriceJpy > 0
          ? ((row.priceJpy - previousPriceJpy) / previousPriceJpy) * 100
          : 0;

        // FX change contribution (difference between GBP change and JPY change)
        const changeFx = previousExchangeRate && previousExchangeRate > 0
          ? ((exchangeRate - previousExchangeRate) / previousExchangeRate) * 100
          : 0;

        inserts.push({
          id: `${cardId}-${row.date.toISOString().split("T")[0]}`,
          cardId,
          game,
          setCode: cardInfo?.setCode || extractSetCode(row.cardNumber),
          priceJpy: row.priceJpy,
          priceGbp: row.priceGbp,
          exchangeRate,
          sourceUsed: "s3_sync",
          change: changeGbp,
          changeJpy,
          changeFx,
          snapshotDate: row.date,
        });

        previousPriceJpy = row.priceJpy;
        previousPriceGbp = row.priceGbp;
        previousExchangeRate = exchangeRate;
      }
    }

    // Batch insert
    const BATCH_SIZE = 500;
    for (let i = 0; i < inserts.length; i += BATCH_SIZE) {
      const batch = inserts.slice(i, i + BATCH_SIZE);
      const inserted = await prisma.cardPriceHistory.createMany({
        data: batch,
        skipDuplicates: true,
      });
      result.synced += inserted.count;
    }

    result.skipped = inserts.length - result.synced;
    logger.info("Daily prices sync complete", {
      game,
      synced: result.synced,
      skipped: result.skipped,
      newDates: result.newDates?.length || 0,
      exchangeRate,
    });

    return result;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    result.errors.push(errorMsg);
    logger.error("Daily prices sync failed", { game, error: errorMsg });
    return result;
  }
}

/**
 * Upsert exchange rate history for today
 */
async function upsertExchangeRate(jpyToGbp: number, gbpToJpy: number): Promise<void> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dateStr = today.toISOString().split("T")[0];

  // Get yesterday's rate for change calculation
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const previousRate = await prisma.exchangeRateHistory.findFirst({
    where: { date: { lt: today } },
    orderBy: { date: "desc" },
    select: { jpyToGbp: true },
  });

  const change24h = previousRate
    ? ((jpyToGbp - previousRate.jpyToGbp.toNumber()) / previousRate.jpyToGbp.toNumber()) * 100
    : 0;

  await prisma.exchangeRateHistory.upsert({
    where: { date: today },
    create: {
      id: `fx-${dateStr}`,
      date: today,
      jpyToGbp,
      gbpToJpy,
      change24h,
      source: "s3_pricefeed",
    },
    update: {
      jpyToGbp,
      gbpToJpy,
      change24h,
    },
  });

  logger.info("Exchange rate updated", { jpyToGbp, gbpToJpy, change24h });
}

// ============================================================================
// Query Functions
// ============================================================================

/**
 * Get price history for a specific card with dual currency support
 */
export async function getCardHistory(
  cardId: string,
  days: number = 30
): Promise<CardHistoryResponse | null> {
  // First try exact cardId match
  let card = await prisma.cardPriceV2.findFirst({
    where: { cardId },
    select: { cardId: true, name: true, setCode: true, game: true, fullCardNumber: true },
  });

  // If not found, try matching by fullCardNumber
  if (!card) {
    card = await prisma.cardPriceV2.findFirst({
      where: { fullCardNumber: cardId },
      select: { cardId: true, name: true, setCode: true, game: true, fullCardNumber: true },
    });
  }

  const targetCardId = card?.cardId || cardId;
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  // Get history with JPY data
  const history = await prisma.cardPriceHistory.findMany({
    where: {
      cardId: targetCardId,
      snapshotDate: { gte: startDate },
    },
    orderBy: { snapshotDate: "asc" },
    select: {
      snapshotDate: true,
      priceGbp: true,
      priceJpy: true,
      exchangeRate: true,
      change: true,
      changeJpy: true,
      changeFx: true,
    },
  });

  if (history.length === 0) {
    // Try matching by card number pattern
    const historyByPattern = await prisma.cardPriceHistory.findMany({
      where: {
        cardId: { contains: cardId },
        snapshotDate: { gte: startDate },
      },
      orderBy: { snapshotDate: "asc" },
      select: {
        snapshotDate: true,
        priceGbp: true,
        priceJpy: true,
        exchangeRate: true,
        change: true,
        changeJpy: true,
        changeFx: true,
        cardId: true,
      },
      take: 1000,
    });

    if (historyByPattern.length === 0) {
      return null;
    }

    // Use the first matching cardId
    const matchedCardId = historyByPattern[0].cardId;
    const filteredHistory = historyByPattern.filter((h) => h.cardId === matchedCardId);

    return buildHistoryResponse(matchedCardId, card, filteredHistory);
  }

  return buildHistoryResponse(targetCardId, card, history);
}

// Type for history records with optional JPY fields
type HistoryRecord = {
  snapshotDate: Date;
  priceGbp: { toNumber(): number };
  priceJpy?: { toNumber(): number } | null;
  exchangeRate?: { toNumber(): number } | null;
  change: { toNumber(): number };
  changeJpy?: { toNumber(): number } | null;
  changeFx?: { toNumber(): number } | null;
};

async function buildHistoryResponse(
  cardId: string,
  card: { name: string; setCode: string | null; game: string } | null,
  history: HistoryRecord[]
): Promise<CardHistoryResponse> {
  const historyPoints: CardHistoryPoint[] = history.map((h) => ({
    date: h.snapshotDate.toISOString().split("T")[0],
    priceGbp: h.priceGbp.toNumber(),
    priceJpy: h.priceJpy?.toNumber() || null,
    exchangeRate: h.exchangeRate?.toNumber() || null,
    change: h.change.toNumber(),
    changeJpy: h.changeJpy?.toNumber() || null,
    changeFx: h.changeFx?.toNumber() || null,
  }));

  const pricesGbp = historyPoints.map((h) => h.priceGbp);
  const pricesJpy = historyPoints.map((h) => h.priceJpy).filter((p): p is number => p !== null);

  const currentGbp = pricesGbp[pricesGbp.length - 1] || 0;
  const currentJpy = pricesJpy.length > 0 ? pricesJpy[pricesJpy.length - 1] : null;

  const highGbp = Math.max(...pricesGbp);
  const lowGbp = Math.min(...pricesGbp);
  const avgGbp = pricesGbp.reduce((a, b) => a + b, 0) / pricesGbp.length;

  const highJpy = pricesJpy.length > 0 ? Math.max(...pricesJpy) : null;
  const lowJpy = pricesJpy.length > 0 ? Math.min(...pricesJpy) : null;
  const avgJpy = pricesJpy.length > 0 ? pricesJpy.reduce((a, b) => a + b, 0) / pricesJpy.length : null;

  // Calculate 7d and 30d changes for GBP
  let change7dGbp = 0;
  let change30dGbp = 0;
  let change7dJpy: number | null = null;
  let change30dJpy: number | null = null;

  if (historyPoints.length >= 7) {
    const price7dAgo = historyPoints[historyPoints.length - 7]?.priceGbp;
    if (price7dAgo && price7dAgo > 0) {
      change7dGbp = ((currentGbp - price7dAgo) / price7dAgo) * 100;
    }

    const priceJpy7dAgo = historyPoints[historyPoints.length - 7]?.priceJpy;
    if (priceJpy7dAgo && priceJpy7dAgo > 0 && currentJpy) {
      change7dJpy = ((currentJpy - priceJpy7dAgo) / priceJpy7dAgo) * 100;
    }
  }

  if (historyPoints.length >= 30) {
    const price30dAgo = historyPoints[historyPoints.length - 30]?.priceGbp;
    if (price30dAgo && price30dAgo > 0) {
      change30dGbp = ((currentGbp - price30dAgo) / price30dAgo) * 100;
    }

    const priceJpy30dAgo = historyPoints[historyPoints.length - 30]?.priceJpy;
    if (priceJpy30dAgo && priceJpy30dAgo > 0 && currentJpy) {
      change30dJpy = ((currentJpy - priceJpy30dAgo) / priceJpy30dAgo) * 100;
    }
  }

  // Get current exchange rate
  const latestRate = await prisma.exchangeRateHistory.findFirst({
    orderBy: { date: "desc" },
    select: { jpyToGbp: true, change24h: true },
  });

  return {
    cardId,
    name: card?.name || null,
    setCode: card?.setCode || null,
    game: card?.game || "onepiece",
    history: historyPoints,
    stats: {
      currentGbp,
      currentJpy,
      highGbp,
      highJpy,
      lowGbp,
      lowJpy,
      avgGbp,
      avgJpy,
      change7dGbp,
      change7dJpy,
      change30dGbp,
      change30dJpy,
    },
    exchangeRate: {
      current: latestRate?.jpyToGbp.toNumber() || null,
      change24h: latestRate?.change24h?.toNumber() || null,
    },
  };
}

// Keep old function signature for backwards compatibility
export async function getCardHistoryLegacy(
  cardId: string,
  days: number = 30
): Promise<{ cardId: string; history: { date: string; price: number; change: number }[]; stats: { current: number; high: number; low: number; avg: number; change7d: number; change30d: number } } | null> {
  const result = await getCardHistory(cardId, days);
  if (!result) return null;

  return {
    cardId: result.cardId,
    history: result.history.map((h) => ({
      date: h.date,
      price: h.priceGbp,
      change: h.change,
    })),
    stats: {
      current: result.stats.currentGbp,
      high: result.stats.highGbp,
      low: result.stats.lowGbp,
      avg: result.stats.avgGbp,
      change7d: result.stats.change7dGbp,
      change30d: result.stats.change30dGbp,
    },
  };
}

/**
 * Get the latest exchange rate from S3 pricefeed
 */
export async function getLatestExchangeRate(game: string = "onepiece"): Promise<number> {
  try {
    const buffer = await downloadFromS3(`pricefeed/${game}_pricefeed.xlsx`);
    const rows = parsePriceFeed(buffer);
    if (rows.length > 0 && rows[0].exchangeRate > 0) {
      return rows[0].exchangeRate;
    }
  } catch (error) {
    logger.warn("Failed to get exchange rate from S3", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return 212; // Default fallback
}

// ============================================================================
// Pricefeed Sync (Multi-Channel Prices)
// ============================================================================

export interface PricefeedSyncResult {
  synced: number;
  errors: string[];
  channels: Record<string, number>;
}

/**
 * Sync multi-channel prices from S3 pricefeed/*.xlsx
 * Updates the price_sources table with current prices from all sales channels
 */
export async function syncPricefeed(game: string = "onepiece"): Promise<PricefeedSyncResult> {
  const result: PricefeedSyncResult = { synced: 0, errors: [], channels: {} };

  try {
    const buffer = await downloadFromS3(`pricefeed/${game}_pricefeed.xlsx`);
    const rows = parsePriceFeed(buffer);

    logger.info("Parsed pricefeed", { game, totalRows: rows.length });

    // Build card mapping
    const cardMapping = await buildCardMapping(game);

    // Group by source for tracking
    const bySource = new Map<string, PriceFeedRow[]>();
    for (const row of rows) {
      if (!bySource.has(row.source)) bySource.set(row.source, []);
      bySource.get(row.source)!.push(row);
    }

    // Upsert price sources
    for (const [source, sourceRows] of bySource.entries()) {
      let channelCount = 0;

      for (const row of sourceRows) {
        // Map SKU to cardId
        const cardNumber = row.sku.replace(/^OP-/, "").replace(/-JP$/, "");
        const cardInfo = cardMapping.get(cardNumber);
        const cardId = cardInfo?.cardId || cardNumber;

        try {
          await prisma.priceSource.upsert({
            where: {
              cardId_source: { cardId, source },
            },
            create: {
              cardId,
              game,
              source,
              platformId: row.platformId || null,
              priceJpy: row.priceJpy,
              priceGbp: row.priceJpy / row.exchangeRate,
              costGbp: row.totalCostGbp,
              sellingPriceGbp: row.sellingPriceGbp,
              exchangeRate: row.exchangeRate,
            },
            update: {
              priceJpy: row.priceJpy,
              priceGbp: row.priceJpy / row.exchangeRate,
              costGbp: row.totalCostGbp,
              sellingPriceGbp: row.sellingPriceGbp,
              exchangeRate: row.exchangeRate,
              platformId: row.platformId || null,
              lastUpdated: new Date(),
            },
          });
          channelCount++;
        } catch (error) {
          // Skip duplicates and errors silently
        }
      }

      result.channels[source] = channelCount;
      result.synced += channelCount;
    }

    logger.info("Pricefeed sync complete", { game, synced: result.synced, channels: Object.keys(result.channels).length });
    return result;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    result.errors.push(errorMsg);
    logger.error("Pricefeed sync failed", { game, error: errorMsg });
    return result;
  }
}

/**
 * Get multi-channel prices for a specific card
 */
export async function getCardSources(cardId: string): Promise<{
  cardId: string;
  sources: Record<string, {
    priceJpy: number | null;
    priceGbp: number | null;
    sellingPriceGbp: number | null;
    costGbp: number | null;
    margin: number | null;
    marginPercent: number | null;
    platformId: string | null;
    lastUpdated: string;
  }>;
  bestBuy: string | null;
  bestSell: string | null;
} | null> {
  const sources = await prisma.priceSource.findMany({
    where: { cardId },
  });

  if (sources.length === 0) {
    // Try by pattern match
    const sourcesByPattern = await prisma.priceSource.findMany({
      where: { cardId: { contains: cardId } },
      take: 10,
    });

    if (sourcesByPattern.length === 0) return null;
    // Use first match's cardId
    const matchedCardId = sourcesByPattern[0].cardId;
    return getCardSources(matchedCardId);
  }

  const result: Record<string, {
    priceJpy: number | null;
    priceGbp: number | null;
    sellingPriceGbp: number | null;
    costGbp: number | null;
    margin: number | null;
    marginPercent: number | null;
    platformId: string | null;
    lastUpdated: string;
  }> = {};

  let lowestCost = Infinity;
  let highestSell = 0;
  let bestBuy: string | null = null;
  let bestSell: string | null = null;

  for (const source of sources) {
    const priceGbp = source.priceGbp?.toNumber() || null;
    const costGbp = source.costGbp?.toNumber() || null;
    const sellingPriceGbp = source.sellingPriceGbp?.toNumber() || null;

    const margin = costGbp && sellingPriceGbp ? sellingPriceGbp - costGbp : null;
    const marginPercent = costGbp && margin ? (margin / costGbp) * 100 : null;

    result[source.source] = {
      priceJpy: source.priceJpy?.toNumber() || null,
      priceGbp,
      sellingPriceGbp,
      costGbp,
      margin,
      marginPercent,
      platformId: source.platformId,
      lastUpdated: source.lastUpdated.toISOString(),
    };

    // Track best buy (lowest cost) and best sell (highest selling price)
    if (source.source === "cardrush" && costGbp && costGbp < lowestCost) {
      lowestCost = costGbp;
      bestBuy = source.source;
    }

    if (sellingPriceGbp && sellingPriceGbp > highestSell) {
      highestSell = sellingPriceGbp;
      bestSell = source.source;
    }
  }

  return { cardId, sources: result, bestBuy, bestSell };
}

// ============================================================================
// Correlation Calculation
// ============================================================================

/**
 * Calculate Pearson correlation coefficient between two price series
 */
function calculatePearsonCorrelation(seriesA: number[], seriesB: number[]): {
  correlation: number;
  pValue: number;
  n: number;
} {
  const n = Math.min(seriesA.length, seriesB.length);
  if (n < 10) {
    return { correlation: 0, pValue: 1, n };
  }

  // Trim to same length
  const a = seriesA.slice(-n);
  const b = seriesB.slice(-n);

  // Calculate means
  const meanA = a.reduce((sum, v) => sum + v, 0) / n;
  const meanB = b.reduce((sum, v) => sum + v, 0) / n;

  // Calculate covariance and standard deviations
  let covariance = 0;
  let varianceA = 0;
  let varianceB = 0;

  for (let i = 0; i < n; i++) {
    const diffA = a[i] - meanA;
    const diffB = b[i] - meanB;
    covariance += diffA * diffB;
    varianceA += diffA * diffA;
    varianceB += diffB * diffB;
  }

  const stdA = Math.sqrt(varianceA);
  const stdB = Math.sqrt(varianceB);

  if (stdA === 0 || stdB === 0) {
    return { correlation: 0, pValue: 1, n };
  }

  const correlation = covariance / (stdA * stdB);

  // Calculate t-statistic for p-value approximation
  const t = correlation * Math.sqrt((n - 2) / (1 - correlation * correlation));
  // Simplified p-value approximation (would need proper t-distribution for accuracy)
  const pValue = Math.exp(-0.5 * t * t) * 2;

  return { correlation, pValue: Math.min(1, Math.max(0, pValue)), n };
}

/**
 * Calculate and store correlations between cards
 * Should be run weekly via cron
 */
export async function calculateCorrelations(
  game: string = "onepiece",
  minDays: number = 30,
  minCorrelation: number = 0.3
): Promise<{ calculated: number; stored: number; errors: string[] }> {
  const result = { calculated: 0, stored: 0, errors: [] as string[] };

  try {
    // Get all cards with sufficient history
    const cardIds = await prisma.$queryRaw<{ card_id: string; count: bigint }[]>`
      SELECT card_id, COUNT(*) as count
      FROM card_price_history
      WHERE game = ${game}
      GROUP BY card_id
      HAVING COUNT(*) >= ${minDays}
      ORDER BY COUNT(*) DESC
      LIMIT 200
    `;

    logger.info("Found cards for correlation", { count: cardIds.length, game });

    // Get price series for each card
    const priceSeries = new Map<string, number[]>();

    for (const { card_id } of cardIds) {
      const history = await prisma.cardPriceHistory.findMany({
        where: { cardId: card_id, game },
        orderBy: { snapshotDate: "asc" },
        select: { priceGbp: true },
      });

      priceSeries.set(card_id, history.map((h) => h.priceGbp.toNumber()));
    }

    // Calculate pairwise correlations
    const cards = Array.from(priceSeries.keys());
    const correlationsToStore: {
      id: string;
      entityA: string;
      entityB: string;
      entityType: string;
      correlation: number;
      sampleSize: number;
      pValue: number;
    }[] = [];

    for (let i = 0; i < cards.length; i++) {
      for (let j = i + 1; j < cards.length; j++) {
        const seriesA = priceSeries.get(cards[i])!;
        const seriesB = priceSeries.get(cards[j])!;

        const { correlation, pValue, n } = calculatePearsonCorrelation(seriesA, seriesB);
        result.calculated++;

        // Only store significant correlations
        if (Math.abs(correlation) >= minCorrelation && pValue < 0.05) {
          correlationsToStore.push({
            id: `${cards[i]}-${cards[j]}`,
            entityA: cards[i],
            entityB: cards[j],
            entityType: "card",
            correlation,
            sampleSize: n,
            pValue,
          });
        }
      }
    }

    // Batch upsert correlations
    for (const corr of correlationsToStore) {
      try {
        await prisma.priceCorrelation.upsert({
          where: { entityA_entityB: { entityA: corr.entityA, entityB: corr.entityB } },
          create: corr,
          update: {
            correlation: corr.correlation,
            sampleSize: corr.sampleSize,
            pValue: corr.pValue,
            updatedAt: new Date(),
          },
        });
        result.stored++;
      } catch {
        // Skip duplicates
      }
    }

    logger.info("Correlation calculation complete", {
      game,
      calculated: result.calculated,
      stored: result.stored,
    });

    return result;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    result.errors.push(errorMsg);
    logger.error("Correlation calculation failed", { game, error: errorMsg });
    return result;
  }
}

// ============================================================================
// Network Data for Visualization
// ============================================================================

export interface NetworkNode {
  id: string;
  name: string;
  setCode: string | null;
  priceJpy: number | null;
  priceGbp: number;
  changeJpy: number | null;
  changeGbp: number;
  size: number;
  color: string;
}

export interface NetworkEdge {
  source: string;
  target: string;
  correlation: number;
  strength: number;
  type: "positive" | "negative";
}

export interface NetworkCluster {
  setCode: string;
  name: string;
  cardCount: number;
  avgPrice: number;
  internalCorrelation: number;
  color: string;
}

export interface NetworkData {
  nodes: NetworkNode[];
  edges: NetworkEdge[];
  clusters: NetworkCluster[];
  marketForces: {
    exchangeRate: {
      current: number | null;
      change24h: number | null;
      impact: string;
    };
  };
}

/**
 * Get network data for neural network visualization
 */
export async function getNetworkData(
  game: string = "onepiece",
  minCorrelation: number = 0.3,
  limit: number = 150
): Promise<NetworkData> {
  // Get top cards by price
  const cards = await prisma.cardPriceV2.findMany({
    where: { game },
    orderBy: { bestPriceGbp: "desc" },
    take: limit,
    select: {
      cardId: true,
      name: true,
      setCode: true,
      bestPriceGbp: true,
    },
  });

  const cardIds = cards.map((c) => c.cardId);

  // Get latest price history for these cards
  const latestPrices = await prisma.$queryRaw<{
    card_id: string;
    price_gbp: number;
    price_jpy: number | null;
    change: number;
    change_jpy: number | null;
  }[]>`
    SELECT DISTINCT ON (card_id)
      card_id,
      price_gbp::float,
      price_jpy::float,
      change::float,
      change_jpy::float
    FROM card_price_history
    WHERE card_id = ANY(${cardIds})
    ORDER BY card_id, snapshot_date DESC
  `;

  const priceMap = new Map(latestPrices.map((p) => [p.card_id, p]));

  // Build nodes
  const nodes: NetworkNode[] = cards.map((card) => {
    const price = priceMap.get(card.cardId);
    const priceGbp = price?.price_gbp || card.bestPriceGbp?.toNumber() || 0;
    const changeGbp = price?.change || 0;

    // Size based on price (log scale)
    const size = Math.max(4, Math.min(16, Math.log(priceGbp + 1) * 3));

    // Color based on change
    let color: string;
    if (changeGbp > 5) color = "#00ff88";
    else if (changeGbp > 0) color = "#4ade80";
    else if (changeGbp > -5) color = "#94a3b8";
    else if (changeGbp > -10) color = "#f87171";
    else color = "#ff4444";

    return {
      id: card.cardId,
      name: card.name,
      setCode: card.setCode,
      priceJpy: price?.price_jpy || null,
      priceGbp,
      changeJpy: price?.change_jpy || null,
      changeGbp,
      size,
      color,
    };
  });

  // Get correlations for these cards
  const correlations = await prisma.priceCorrelation.findMany({
    where: {
      entityType: "card",
      entityA: { in: cardIds },
      entityB: { in: cardIds },
      OR: [
        { correlation: { gte: minCorrelation } },
        { correlation: { lte: -minCorrelation } },
      ],
    },
    select: {
      entityA: true,
      entityB: true,
      correlation: true,
    },
  });

  // Build edges
  const edges: NetworkEdge[] = correlations.map((corr) => ({
    source: corr.entityA,
    target: corr.entityB,
    correlation: corr.correlation.toNumber(),
    strength: Math.abs(corr.correlation.toNumber()),
    type: corr.correlation.toNumber() > 0 ? "positive" : "negative",
  }));

  // Build clusters from sets
  const setGroups = new Map<string, typeof nodes>();
  for (const node of nodes) {
    const set = node.setCode || "unknown";
    if (!setGroups.has(set)) setGroups.set(set, []);
    setGroups.get(set)!.push(node);
  }

  const setColors = [
    "#3b82f6", "#8b5cf6", "#ec4899", "#f97316", "#22c55e",
    "#06b6d4", "#eab308", "#ef4444", "#a855f7", "#14b8a6",
  ];

  const clusters: NetworkCluster[] = Array.from(setGroups.entries()).map(([setCode, setNodes], i) => {
    const avgPrice = setNodes.reduce((sum, n) => sum + n.priceGbp, 0) / setNodes.length;

    // Calculate internal correlation (avg correlation within set)
    const setCardIds = new Set(setNodes.map((n) => n.id));
    const internalEdges = edges.filter(
      (e) => setCardIds.has(e.source) && setCardIds.has(e.target)
    );
    const internalCorrelation = internalEdges.length > 0
      ? internalEdges.reduce((sum, e) => sum + e.correlation, 0) / internalEdges.length
      : 0;

    return {
      setCode,
      name: setCode,
      cardCount: setNodes.length,
      avgPrice,
      internalCorrelation,
      color: setColors[i % setColors.length],
    };
  });

  // Get exchange rate
  const latestRate = await prisma.exchangeRateHistory.findFirst({
    orderBy: { date: "desc" },
    select: { jpyToGbp: true, change24h: true },
  });

  const fxChange = latestRate?.change24h?.toNumber() || 0;

  return {
    nodes,
    edges,
    clusters,
    marketForces: {
      exchangeRate: {
        current: latestRate?.jpyToGbp.toNumber() || null,
        change24h: fxChange,
        impact: fxChange !== 0
          ? `All nodes shifted ${fxChange > 0 ? "+" : ""}${fxChange.toFixed(2)}% from FX`
          : "No FX impact today",
      },
    },
  };
}
