/**
 * Cardmarket CSV Parser
 *
 * Parses official Cardmarket price guide CSV exports
 * Available from: https://www.cardmarket.com/en/OnePiece/Data/PriceGuide
 *
 * CSV Format (semicolon-delimited):
 * - Product ID: Internal Cardmarket product ID
 * - Name: Card name (localized)
 * - Expansion: Set name
 * - (optional) Category: Card type
 * - Price Guide: Trend price in EUR
 * - Avg. Sell Price: Average selling price
 * - Low Price: Lowest available price
 * - Avg. Day 1: Previous day average
 * - Avg. Day 7: 7-day average
 * - Avg. Day 30: 30-day average
 */

import type { CardmarketCSVRow } from "../types";

// =============================================================================
// CONFIGURATION
// =============================================================================

const CSV_DELIMITER = ";";
const EXPECTED_HEADERS = [
  "Product ID",
  "Name",
  "Expansion",
  "Price Guide",
];

// Cardmarket expansion name to set code mapping
const EXPANSION_TO_SET_CODE: Record<string, string> = {
  "Romance Dawn": "OP01",
  "Paramount War": "OP02",
  "Pillars of Strength": "OP03",
  "Kingdoms of Intrigue": "OP04",
  "Awakening of the New Era": "OP05",
  "Wings of the Captain": "OP06",
  "500 Years in the Future": "OP07",
  "Two Legends": "OP08",
  "The Four Emperors": "OP09",
  "Royal Blood": "OP10",
  "Uta": "OP11",
  "Starter Deck: Straw Hat Crew": "ST01",
  "Starter Deck: Worst Generation": "ST02",
  "Starter Deck: The Seven Warlords of the Sea": "ST03",
  "Starter Deck: Animal Kingdom Pirates": "ST04",
  "Starter Deck: ONE PIECE FILM edition": "ST05",
  "Starter Deck: Navy": "ST06",
  "Starter Deck: Big Mom Pirates": "ST07",
  "Starter Deck: Monkey.D.Luffy": "ST08",
  "Starter Deck: Yamato": "ST09",
  "Starter Deck: The Three Captains": "ST10",
  "Starter Deck: Uta": "ST11",
  "Starter Deck: Zoro & Sanji": "ST12",
  "Starter Deck: The Three Brothers": "ST13",
  "Starter Deck: 3D2Y": "ST14",
  "Starter Deck: RED Edward.Newgate": "ST15",
  "Starter Deck: GREEN Uta": "ST16",
  "Starter Deck: BLUE Donquixote Doflamingo": "ST17",
  "Starter Deck: PURPLE Monkey.D.Luffy": "ST18",
  "Memorial Collection": "EB01",
  "Extra Booster: Memorial Collection": "EB01",
  "Anime 25th Anniversary Collection": "EB02",
  "Extra Booster: Anime 25th Anniversary Collection": "EB02",
  // Promo cards
  "Promo Cards": "PROMO",
  "Demo Deck": "DEMO",
};

// =============================================================================
// CSV PARSER
// =============================================================================

export interface ParseOptions {
  skipInvalidRows?: boolean;
  onInvalidRow?: (row: string[], index: number, error: string) => void;
}

export interface ParseResult {
  rows: CardmarketCSVRow[];
  errors: Array<{ row: number; error: string }>;
  totalRows: number;
  validRows: number;
  skippedRows: number;
}

/**
 * Parse a Cardmarket CSV string into structured data
 */
export function parseCardmarketCSV(
  csvContent: string,
  options: ParseOptions = {}
): ParseResult {
  const { skipInvalidRows = true, onInvalidRow } = options;

  const lines = csvContent.trim().split("\n");
  const result: ParseResult = {
    rows: [],
    errors: [],
    totalRows: 0,
    validRows: 0,
    skippedRows: 0,
  };

  if (lines.length === 0) {
    return result;
  }

  // Parse header row
  const headerLine = lines[0];
  const headers = parseCSVLine(headerLine);
  const headerMap = buildHeaderMap(headers);

  // Validate required headers
  const missingHeaders = EXPECTED_HEADERS.filter(
    (h) => headerMap[h] === undefined
  );
  if (missingHeaders.length > 0) {
    throw new Error(
      `Missing required CSV headers: ${missingHeaders.join(", ")}`
    );
  }

  // Parse data rows
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    result.totalRows++;

    try {
      const values = parseCSVLine(line);
      const row = mapRowToObject(values, headerMap);

      if (row) {
        result.rows.push(row);
        result.validRows++;
      } else {
        result.skippedRows++;
        const error = "Failed to parse row values";
        result.errors.push({ row: i + 1, error });
        if (onInvalidRow) {
          onInvalidRow(values, i, error);
        }
      }
    } catch (error) {
      result.skippedRows++;
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      result.errors.push({ row: i + 1, error: errorMsg });

      if (!skipInvalidRows) {
        throw error;
      }

      if (onInvalidRow) {
        onInvalidRow([], i, errorMsg);
      }
    }
  }

  return result;
}

/**
 * Parse a single CSV line, handling quoted values
 */
function parseCSVLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        // Escaped quote
        current += '"';
        i++;
      } else {
        // Toggle quote mode
        inQuotes = !inQuotes;
      }
    } else if (char === CSV_DELIMITER && !inQuotes) {
      values.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }

  // Add last value
  values.push(current.trim());

  return values;
}

/**
 * Build a map of header names to column indices
 */
function buildHeaderMap(headers: string[]): Record<string, number> {
  const map: Record<string, number> = {};

  for (let i = 0; i < headers.length; i++) {
    const header = headers[i].trim();
    map[header] = i;

    // Also map common variations
    if (header === "Avg. Sell Price") {
      map["AvgSellPrice"] = i;
    }
    if (header === "Price Guide") {
      map["TrendPrice"] = i;
    }
  }

  return map;
}

/**
 * Map CSV row values to a CardmarketCSVRow object
 */
function mapRowToObject(
  values: string[],
  headerMap: Record<string, number>
): CardmarketCSVRow | null {
  const get = (header: string): string | undefined => {
    const idx = headerMap[header];
    return idx !== undefined ? values[idx] : undefined;
  };

  const getNumber = (header: string): number | undefined => {
    const val = get(header);
    if (!val || val === "-" || val === "") return undefined;
    // Handle European number format (comma as decimal separator)
    const normalized = val.replace(",", ".").replace(/[^\d.-]/g, "");
    const num = parseFloat(normalized);
    return isNaN(num) ? undefined : num;
  };

  const getInteger = (header: string): number | undefined => {
    const val = get(header);
    if (!val || val === "-" || val === "") return undefined;
    const normalized = val.replace(/[^\d]/g, "");
    const num = parseInt(normalized, 10);
    return isNaN(num) ? undefined : num;
  };

  const productId = get("Product ID");
  const name = get("Name");
  const expansion = get("Expansion");
  const trendPrice = getNumber("Price Guide");

  // Required fields
  if (!productId || !name || !expansion || trendPrice === undefined) {
    return null;
  }

  return {
    productId,
    name,
    expansion,
    category: get("Category"),
    trendPrice,
    avgSellPrice: getNumber("Avg. Sell Price"),
    lowPrice: getNumber("Low Price"),
    avg1d: getNumber("Avg. Day 1"),
    avg7d: getNumber("Avg. Day 7"),
    avg30d: getNumber("Avg. Day 30"),
    // Inventory signals for ML features (may not be present in all CSV exports)
    availableItems: getInteger("Available Items"),
    availableFoils: getInteger("Available Foils"),
    updatedAt: new Date().toISOString(),
  };
}

// =============================================================================
// FILE OPERATIONS
// =============================================================================

/**
 * Parse a Cardmarket CSV file from disk
 */
export async function parseCardmarketCSVFile(
  filePath: string,
  options: ParseOptions = {}
): Promise<ParseResult> {
  const fs = await import("fs/promises");
  const content = await fs.readFile(filePath, "utf-8");
  return parseCardmarketCSV(content, options);
}

/**
 * Download and parse the latest Cardmarket price guide
 * Note: Cardmarket requires authentication for CSV downloads
 * This function expects the CSV to be manually downloaded or fetched via API
 */
export async function fetchCardmarketPriceGuide(
  downloadUrl: string,
  options: ParseOptions = {}
): Promise<ParseResult> {
  const response = await fetch(downloadUrl);

  if (!response.ok) {
    throw new Error(`Failed to fetch Cardmarket CSV: HTTP ${response.status}`);
  }

  const content = await response.text();
  return parseCardmarketCSV(content, options);
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Convert Cardmarket expansion name to set code
 */
export function expansionToSetCode(expansion: string): string | null {
  // Direct match
  if (EXPANSION_TO_SET_CODE[expansion]) {
    return EXPANSION_TO_SET_CODE[expansion];
  }

  // Try partial match
  const lowerExpansion = expansion.toLowerCase();
  for (const [key, code] of Object.entries(EXPANSION_TO_SET_CODE)) {
    if (lowerExpansion.includes(key.toLowerCase())) {
      return code;
    }
  }

  // Try to extract set code from expansion name (e.g., "OP01 - Romance Dawn")
  const setCodeMatch = expansion.match(/\b(OP\d{2}|ST\d{2}|EB\d{2})\b/i);
  if (setCodeMatch) {
    return setCodeMatch[1].toUpperCase();
  }

  return null;
}

/**
 * Normalize card name for matching
 * Removes special characters, normalizes whitespace, lowercases
 */
export function normalizeCardName(name: string): string {
  return name
    .toLowerCase()
    .replace(/['".,!?:;()[\]{}]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extract card number from name if present
 * Cardmarket names sometimes include the card number
 */
export function extractCardNumber(name: string): string | null {
  // Match patterns like "OP01-001", "ST01-001", etc.
  const match = name.match(/\b(OP\d{2}|ST\d{2}|EB\d{2}|PROMO)-(\d{3})\b/i);
  if (match) {
    return `${match[1].toUpperCase()}-${match[2]}`;
  }
  return null;
}

/**
 * Match Cardmarket row to internal card ID
 * Attempts various matching strategies
 */
export function matchCardmarketToCardId(
  row: CardmarketCSVRow,
  knownCards: Array<{ cardId: string; name: string; setCode: string }>
): string | null {
  // Strategy 1: Extract card number from name
  const cardNumber = extractCardNumber(row.name);
  if (cardNumber) {
    const match = knownCards.find((c) =>
      c.cardId.toUpperCase().startsWith(cardNumber.toUpperCase())
    );
    if (match) return match.cardId;
  }

  // Strategy 2: Match by set and normalized name
  const setCode = expansionToSetCode(row.expansion);
  if (setCode) {
    const normalizedName = normalizeCardName(row.name);
    const match = knownCards.find(
      (c) =>
        c.setCode.toUpperCase() === setCode.toUpperCase() &&
        normalizeCardName(c.name) === normalizedName
    );
    if (match) return match.cardId;
  }

  // Strategy 3: Fuzzy name match within set
  if (setCode) {
    const normalizedName = normalizeCardName(row.name);
    const setCards = knownCards.filter(
      (c) => c.setCode.toUpperCase() === setCode.toUpperCase()
    );

    for (const card of setCards) {
      const cardNormalized = normalizeCardName(card.name);
      // Check if one contains the other
      if (
        cardNormalized.includes(normalizedName) ||
        normalizedName.includes(cardNormalized)
      ) {
        return card.cardId;
      }
    }
  }

  return null;
}

/**
 * Group CSV rows by expansion/set
 */
export function groupByExpansion(
  rows: CardmarketCSVRow[]
): Map<string, CardmarketCSVRow[]> {
  const groups = new Map<string, CardmarketCSVRow[]>();

  for (const row of rows) {
    const existing = groups.get(row.expansion) || [];
    existing.push(row);
    groups.set(row.expansion, existing);
  }

  return groups;
}

/**
 * Calculate price statistics from CSV data
 */
export function calculateCSVStats(rows: CardmarketCSVRow[]): {
  totalCards: number;
  avgTrendPrice: number;
  medianTrendPrice: number;
  minPrice: number;
  maxPrice: number;
  totalMarketValue: number;
} {
  if (rows.length === 0) {
    return {
      totalCards: 0,
      avgTrendPrice: 0,
      medianTrendPrice: 0,
      minPrice: 0,
      maxPrice: 0,
      totalMarketValue: 0,
    };
  }

  const prices = rows.map((r) => r.trendPrice).sort((a, b) => a - b);
  const sum = prices.reduce((a, b) => a + b, 0);

  return {
    totalCards: rows.length,
    avgTrendPrice: sum / rows.length,
    medianTrendPrice:
      prices.length % 2 === 0
        ? (prices[prices.length / 2 - 1] + prices[prices.length / 2]) / 2
        : prices[Math.floor(prices.length / 2)],
    minPrice: prices[0],
    maxPrice: prices[prices.length - 1],
    totalMarketValue: sum,
  };
}

/**
 * Filter rows by minimum price threshold
 */
export function filterByMinPrice(
  rows: CardmarketCSVRow[],
  minPrice: number
): CardmarketCSVRow[] {
  return rows.filter((r) => r.trendPrice >= minPrice);
}

/**
 * Sort rows by various criteria
 */
export function sortRows(
  rows: CardmarketCSVRow[],
  sortBy: "price" | "name" | "expansion",
  order: "asc" | "desc" = "desc"
): CardmarketCSVRow[] {
  const sorted = [...rows].sort((a, b) => {
    switch (sortBy) {
      case "price":
        return a.trendPrice - b.trendPrice;
      case "name":
        return a.name.localeCompare(b.name);
      case "expansion":
        return a.expansion.localeCompare(b.expansion);
      default:
        return 0;
    }
  });

  return order === "desc" ? sorted.reverse() : sorted;
}
