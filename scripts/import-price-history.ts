/**
 * Import Historical Price Data from S3
 *
 * Reads daily_prices.xlsx from S3 and imports into card_price_history table.
 * This is a one-time import script for historical data.
 *
 * Usage: npx tsx scripts/import-price-history.ts [--dry-run]
 */

import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { PrismaClient } from "@prisma/client";
import * as XLSX from "xlsx";
import { Readable } from "stream";

const prisma = new PrismaClient();

// Configuration
const S3_BUCKET = "pricedata-tcg";
const S3_KEY = "daily_prices.xlsx";
const JPY_TO_GBP_RATE = 1 / 212; // Approximate conversion rate
const BATCH_SIZE = 1000;

interface PriceRow {
  cardId: string;
  sku: string;
  game: string;
  setCode: string | null;
  snapshotDate: Date;
  priceJpy: number;
  priceGbp: number;
  change: number;
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function downloadFromS3(): Promise<Buffer> {
  const client = new S3Client({ region: "us-east-1" });
  const command = new GetObjectCommand({ Bucket: S3_BUCKET, Key: S3_KEY });
  const response = await client.send(command);

  if (!response.Body) {
    throw new Error("Empty response from S3");
  }

  return streamToBuffer(response.Body as Readable);
}

function parseDate(dateStr: string): Date | null {
  // Handle Excel date formats
  if (!dateStr || dateStr === "card_number" || dateStr === "sku" || dateStr === "cardrush") {
    return null;
  }

  // Try parsing as YYYY-MM-DD
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    return new Date(parseInt(match[1]), parseInt(match[2]) - 1, parseInt(match[3]));
  }

  return null;
}

function extractSetCode(sku: string): string | null {
  // SKU format: OP-OP01-001-JP or PKMN-SV1A-074-JP
  const match = sku.match(/^(?:OP|PKMN)-([A-Z0-9]+)-/i);
  return match ? match[1].toUpperCase() : null;
}

function normalizeCardNumber(cardNumber: string, game: string): string {
  // Normalize card number to match fullCardNumber in database
  // Input: OP01-001, SV1a-074/073
  // Output: OP01-001, SV1a-074/073 (unchanged, as these match fullCardNumber)

  if (game === "onepiece") {
    // Card number format: OP01-001
    // This should match fullCardNumber directly
    const match = cardNumber.match(/^([A-Z0-9]+)-(\d+)$/i);
    if (match) {
      return `${match[1].toUpperCase()}-${match[2]}`;
    }
  } else if (game === "pokemon") {
    // Card number format: SV1a-074/073
    // This should match as-is
    return cardNumber;
  }

  return cardNumber;
}

async function getCardMapping(game: string): Promise<Map<string, { cardId: string; setCode: string | null }>> {
  // Get all cards from card_prices_v2 for mapping
  const cards = await prisma.cardPriceV2.findMany({
    where: { game },
    select: { cardId: true, setCode: true, fullCardNumber: true, bestPriceGbp: true },
    orderBy: { bestPriceGbp: "desc" }, // Prefer highest-priced variant
  });

  const mapping = new Map<string, { cardId: string; setCode: string | null }>();

  for (const card of cards) {
    // Map by cardId
    if (!mapping.has(card.cardId)) {
      mapping.set(card.cardId, { cardId: card.cardId, setCode: card.setCode });
    }

    // Also map by fullCardNumber - prefer first match (highest priced)
    if (card.fullCardNumber && !mapping.has(card.fullCardNumber)) {
      mapping.set(card.fullCardNumber, { cardId: card.cardId, setCode: card.setCode });
    }
  }

  return mapping;
}

async function processSheet(
  workbook: XLSX.WorkBook,
  sheetName: string,
  game: string,
  dryRun: boolean
): Promise<{ processed: number; inserted: number; skipped: number }> {
  console.log(`\nProcessing sheet: ${sheetName} (game: ${game})`);

  const sheet = workbook.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 });

  if (data.length < 2) {
    console.log("  No data rows found");
    return { processed: 0, inserted: 0, skipped: 0 };
  }

  // Get headers (first row)
  const headers = data[0];
  console.log(`  Total columns: ${headers.length}`);
  console.log(`  Total rows: ${data.length - 1}`);

  // Find date columns (skip card_number, sku, cardrush)
  const dateColumns: { index: number; date: Date }[] = [];
  for (let i = 0; i < headers.length; i++) {
    const date = parseDate(String(headers[i]));
    if (date) {
      dateColumns.push({ index: i, date });
    }
  }
  console.log(`  Date columns found: ${dateColumns.length}`);
  console.log(`  Date range: ${dateColumns[0]?.date.toISOString().split("T")[0]} to ${dateColumns[dateColumns.length - 1]?.date.toISOString().split("T")[0]}`);

  // Get card mapping from database
  const cardMapping = await getCardMapping(game);
  console.log(`  Cards in database: ${cardMapping.size}`);

  // Process rows and collect price data
  const allRows: PriceRow[] = [];
  let skipped = 0;

  for (let rowIdx = 1; rowIdx < data.length; rowIdx++) {
    const row = data[rowIdx];
    if (!row || row.length < 3) continue;

    const cardNumber = String(row[0] || "");
    const sku = String(row[1] || "");

    if (!cardNumber) {
      skipped++;
      continue;
    }

    // Normalize card number for matching
    const normalizedCardNum = normalizeCardNumber(cardNumber, game);

    // Try to find the card in our database (prefer cardNumber match)
    const cardInfo = cardMapping.get(normalizedCardNum) || cardMapping.get(cardNumber);

    const setCode = cardInfo?.setCode || extractSetCode(sku || cardNumber);
    const finalCardId = cardInfo?.cardId || normalizedCardNum;

    // Process each date column
    let previousPrice: number | null = null;
    for (const { index, date } of dateColumns) {
      const priceJpy = Number(row[index]);

      if (!priceJpy || isNaN(priceJpy) || priceJpy <= 0) {
        continue;
      }

      const priceGbp = priceJpy * JPY_TO_GBP_RATE;
      const change = previousPrice
        ? ((priceGbp - previousPrice) / previousPrice) * 100
        : 0;

      allRows.push({
        cardId: finalCardId,
        sku,
        game,
        setCode,
        snapshotDate: date,
        priceJpy,
        priceGbp,
        change,
      });

      previousPrice = priceGbp;
    }
  }

  console.log(`  Price records to insert: ${allRows.length}`);
  console.log(`  Skipped rows: ${skipped}`);

  if (dryRun) {
    console.log("  [DRY RUN] Would insert records");
    console.log("  Sample records:");
    for (const row of allRows.slice(0, 3)) {
      console.log(`    ${row.cardId}: ${row.snapshotDate.toISOString().split("T")[0]} = £${row.priceGbp.toFixed(2)} (${row.change.toFixed(2)}%)`);
    }
    return { processed: allRows.length, inserted: 0, skipped };
  }

  // Batch insert
  let inserted = 0;
  for (let i = 0; i < allRows.length; i += BATCH_SIZE) {
    const batch = allRows.slice(i, i + BATCH_SIZE);

    // Use raw SQL for bulk upsert
    const values = batch.map((r) => ({
      id: `${r.cardId}-${r.snapshotDate.toISOString().split("T")[0]}`,
      cardId: r.cardId,
      game: r.game,
      setCode: r.setCode,
      priceGbp: r.priceGbp,
      sourceUsed: "s3_import",
      change: r.change,
      snapshotDate: r.snapshotDate,
    }));

    try {
      // Use createMany with skipDuplicates for upsert-like behavior
      const result = await prisma.cardPriceHistory.createMany({
        data: values.map((v) => ({
          id: v.id,
          cardId: v.cardId,
          game: v.game,
          setCode: v.setCode,
          priceGbp: v.priceGbp,
          sourceUsed: v.sourceUsed,
          change: v.change,
          snapshotDate: v.snapshotDate,
        })),
        skipDuplicates: true,
      });

      inserted += result.count;

      if ((i + BATCH_SIZE) % 10000 === 0 || i + BATCH_SIZE >= allRows.length) {
        console.log(`  Inserted ${inserted} of ${allRows.length} records...`);
      }
    } catch (error) {
      console.error(`  Error inserting batch at ${i}:`, error);
    }
  }

  return { processed: allRows.length, inserted, skipped };
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  console.log("=".repeat(60));
  console.log("Historical Price Data Import");
  console.log("=".repeat(60));
  console.log(`Mode: ${dryRun ? "DRY RUN" : "LIVE"}`);
  console.log(`S3 Source: s3://${S3_BUCKET}/${S3_KEY}`);
  console.log(`JPY to GBP rate: ${JPY_TO_GBP_RATE.toFixed(6)}`);

  try {
    // Download from S3
    console.log("\nDownloading from S3...");
    const buffer = await downloadFromS3();
    console.log(`Downloaded ${(buffer.length / 1024).toFixed(1)} KB`);

    // Parse Excel
    console.log("\nParsing Excel file...");
    const workbook = XLSX.read(buffer, { type: "buffer" });
    console.log(`Sheets: ${workbook.SheetNames.join(", ")}`);

    // Process each sheet
    const results: Record<string, { processed: number; inserted: number; skipped: number }> = {};

    for (const sheetName of workbook.SheetNames) {
      const game = sheetName.toLowerCase();
      results[sheetName] = await processSheet(workbook, sheetName, game, dryRun);
    }

    // Summary
    console.log("\n" + "=".repeat(60));
    console.log("IMPORT SUMMARY");
    console.log("=".repeat(60));

    let totalProcessed = 0;
    let totalInserted = 0;

    for (const [sheet, stats] of Object.entries(results)) {
      console.log(`${sheet}: ${stats.inserted}/${stats.processed} records inserted (${stats.skipped} skipped)`);
      totalProcessed += stats.processed;
      totalInserted += stats.inserted;
    }

    console.log("-".repeat(60));
    console.log(`TOTAL: ${totalInserted}/${totalProcessed} records inserted`);

    // Verify
    if (!dryRun) {
      const count = await prisma.cardPriceHistory.count();
      console.log(`\nDatabase card_price_history count: ${count}`);
    }
  } catch (error) {
    console.error("Import failed:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
