/**
 * Utility Functions for Cardmarket Scraper
 */

import crypto from 'node:crypto';

/**
 * Sleep for a specified number of milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Sleep with random variance (+/- 30%)
 */
export async function sleepWithVariance(baseMs: number): Promise<void> {
  const variance = baseMs * 0.3;
  const actualMs = baseMs + (Math.random() * variance * 2 - variance);
  await sleep(Math.max(100, actualMs));
}

/**
 * Get current timestamp in ISO format
 */
export function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Parse a price string to number (handles € symbols, commas, etc.)
 */
export function parsePrice(priceStr: string): number | null {
  if (!priceStr) return null;

  // Remove currency symbols and whitespace
  const cleaned = priceStr
    .replace(/[€$£¥]/g, '')
    .replace(/\s/g, '')
    .trim();

  // Handle European format (comma as decimal separator)
  // First, check if it's European format: "1.234,56" or "1234,56"
  if (cleaned.includes(',')) {
    // If there's a dot before comma, it's a thousands separator
    if (cleaned.indexOf('.') < cleaned.indexOf(',')) {
      // European: 1.234,56 -> 1234.56
      const normalized = cleaned.replace(/\./g, '').replace(',', '.');
      const value = parseFloat(normalized);
      return isNaN(value) ? null : value;
    }
    // Just comma: 1234,56 -> 1234.56
    const normalized = cleaned.replace(',', '.');
    const value = parseFloat(normalized);
    return isNaN(value) ? null : value;
  }

  // Standard format: 1234.56
  const value = parseFloat(cleaned);
  return isNaN(value) ? null : value;
}

/**
 * Parse a percentage string to number
 */
export function parsePercentage(percentStr: string): number | null {
  if (!percentStr) return null;

  const match = percentStr.match(/([+-]?\d+[.,]?\d*)/);
  if (!match) return null;

  const value = parseFloat(match[1].replace(',', '.'));
  return isNaN(value) ? null : value;
}

/**
 * Parse an integer from string
 */
export function parseIntSafe(str: string): number | null {
  if (!str) return null;

  const cleaned = str.replace(/[^\d-]/g, '');
  const value = parseInt(cleaned, 10);
  return isNaN(value) ? null : value;
}

/**
 * Extract card number from various formats
 */
export function extractCardNumber(text: string): { setCode: string; cardNumber: string } | null {
  // Standard format: OP01-003, ST01-015, EB01-042
  const match = text.match(/([A-Z]{2,4}\d{1,2})-(\d{1,4})/i);

  if (match) {
    return {
      setCode: match[1].toUpperCase(),
      cardNumber: match[2].padStart(3, '0'),
    };
  }

  return null;
}

/**
 * Normalize card ID to standard format
 */
export function normalizeCardId(
  setCode: string,
  cardNumber: string,
  variantType?: string
): string {
  const baseId = `${setCode.toUpperCase()}-${cardNumber.padStart(3, '0')}`;

  if (variantType && variantType !== 'regular') {
    return `${baseId}-${variantType.toLowerCase()}`;
  }

  return baseId;
}

/**
 * Detect variant type from card name or description
 */
export function detectVariantType(text: string): string {
  const lowerText = text.toLowerCase();

  const variantPatterns: Array<{ type: string; patterns: RegExp[] }> = [
    {
      type: 'parallel',
      patterns: [/\bparallel\b/i, /\balt\s*art\b/i, /\balternate\s*art\b/i, /\baa\b/i],
    },
    {
      type: 'manga',
      patterns: [/\bmanga\b/i, /\bcomic\s*parallel\b/i],
    },
    {
      type: 'sp',
      patterns: [/\bsp\b(?!\d)/i, /\bspecial\s*art\b/i],
    },
    {
      type: 'spr',
      patterns: [/\bspr\b/i, /\bsecret\s*rare\b/i, /\bsec\b/i],
    },
    {
      type: 'tr',
      patterns: [/\btr\b/i, /\btreasure\b/i],
    },
    {
      type: 'boxtopper',
      patterns: [/\bbox\s*topper\b/i, /\bpromo\b/i],
    },
  ];

  for (const { type, patterns } of variantPatterns) {
    for (const pattern of patterns) {
      if (pattern.test(lowerText)) {
        return type;
      }
    }
  }

  return 'regular';
}

/**
 * Map Cardmarket condition codes to standard codes
 */
export const CONDITION_MAP: Record<string, string> = {
  MT: 'NM', // Mint
  NM: 'NM', // Near Mint
  EX: 'LP', // Excellent
  GD: 'MP', // Good
  LP: 'MP', // Light Played (Cardmarket's LP is lower quality)
  PL: 'HP', // Played
  PO: 'DMG', // Poor
};

/**
 * Normalize condition code
 */
export function normalizeCondition(condition: string): string {
  const upperCondition = condition.toUpperCase().trim();
  return CONDITION_MAP[upperCondition] || 'NM';
}

/**
 * Map Cardmarket language IDs to ISO codes
 */
export const LANGUAGE_MAP: Record<number, string> = {
  1: 'EN', // English
  2: 'FR', // French
  3: 'DE', // German
  4: 'ES', // Spanish
  5: 'IT', // Italian
  6: 'JP', // Japanese
  7: 'PT', // Portuguese
  8: 'RU', // Russian
  9: 'KO', // Korean
  10: 'ZH', // Chinese
};

/**
 * Get language code from Cardmarket language ID
 */
export function getLanguageCode(languageId: number): string {
  return LANGUAGE_MAP[languageId] || 'EN';
}

/**
 * Generate a unique request ID for tracking
 */
export function generateRequestId(): string {
  return `req_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

/**
 * Retry an async function with exponential backoff
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
    onRetry?: (error: Error, attempt: number) => void;
  } = {}
): Promise<T> {
  const { maxRetries = 3, baseDelayMs = 1000, maxDelayMs = 30000, onRetry } = options;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      if (attempt < maxRetries) {
        const delay = Math.min(baseDelayMs * Math.pow(2, attempt) + Math.random() * 1000, maxDelayMs);

        if (onRetry) {
          onRetry(lastError, attempt + 1);
        }

        await sleep(delay);
      }
    }
  }

  throw lastError;
}

/**
 * Chunk an array into smaller arrays
 */
export function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

/**
 * Shuffle an array in place (Fisher-Yates)
 */
export function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/**
 * Create a deferred promise
 */
export interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

export function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;

  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

/**
 * Clean HTML string by removing extra whitespace
 */
export function cleanHtmlText(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/\n/g, ' ')
    .trim();
}

/**
 * Extract all URLs from HTML
 */
export function extractUrls(html: string, baseUrl: string): string[] {
  const urlRegex = /href=["']([^"']+)["']/gi;
  const urls: string[] = [];
  let match;

  while ((match = urlRegex.exec(html)) !== null) {
    let url = match[1];

    // Handle relative URLs
    if (url.startsWith('/')) {
      url = new URL(url, baseUrl).href;
    }

    urls.push(url);
  }

  return [...new Set(urls)]; // Remove duplicates
}

/**
 * Rate limiting token bucket
 */
export class RateLimiter {
  private tokens: number;
  private lastRefill: number;
  private maxTokens: number;
  private refillRate: number; // tokens per second

  constructor(maxTokens: number, refillRatePerSecond: number) {
    this.maxTokens = maxTokens;
    this.tokens = maxTokens;
    this.refillRate = refillRatePerSecond;
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

  getAvailableTokens(): number {
    this.refill();
    return this.tokens;
  }
}
