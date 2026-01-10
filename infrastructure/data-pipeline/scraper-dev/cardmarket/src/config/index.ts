/**
 * Configuration Module Index
 */

export * from './sets.js';
export * from './selectors.js';
export * from './proxy.js';
export * from './cardmarket-optimized.js';

/**
 * Cardmarket base URLs
 */
export const CARDMARKET_BASE_URL = 'https://www.cardmarket.com';
export const CARDMARKET_ONEPIECE_URL = `${CARDMARKET_BASE_URL}/en/OnePiece`;

/**
 * Scraper configuration
 */
export interface ScraperConfig {
  // Request settings
  requestDelayMs: number;
  requestTimeoutMs: number;
  maxRetries: number;
  retryDelayMs: number;

  // Concurrency
  maxConcurrency: number;

  // Rate limiting
  requestsPerMinute: number;

  // User agent
  userAgents: string[];

  // Headers
  defaultHeaders: Record<string, string>;
}

export const DEFAULT_SCRAPER_CONFIG: ScraperConfig = {
  requestDelayMs: parseInt(process.env.REQUEST_DELAY_MS || '2000', 10),
  requestTimeoutMs: parseInt(process.env.REQUEST_TIMEOUT_MS || '30000', 10),
  maxRetries: parseInt(process.env.RETRY_ATTEMPTS || '3', 10),
  retryDelayMs: 5000,
  maxConcurrency: parseInt(process.env.MAX_CONCURRENCY || '10', 10),
  requestsPerMinute: 30, // Cardmarket's apparent limit

  userAgents: [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  ],

  defaultHeaders: {
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7',
    'Accept-Encoding': 'gzip, deflate, br',
    Connection: 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Cache-Control': 'max-age=0',
  },
};

/**
 * Get a random user agent
 */
export function getRandomUserAgent(config: ScraperConfig = DEFAULT_SCRAPER_CONFIG): string {
  return config.userAgents[Math.floor(Math.random() * config.userAgents.length)];
}

/**
 * Build request headers with randomization
 */
export function buildRequestHeaders(
  config: ScraperConfig = DEFAULT_SCRAPER_CONFIG
): Record<string, string> {
  return {
    ...config.defaultHeaders,
    'User-Agent': getRandomUserAgent(config),
  };
}
