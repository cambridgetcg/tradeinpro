/**
 * HTTP Client for Cardmarket Scraping
 *
 * Features:
 * - Proxy support with rotation
 * - Automatic retry with exponential backoff
 * - Request/response logging
 * - Cookie management
 * - Rate limiting integration
 */

import { HttpsProxyAgent } from 'https-proxy-agent';
import {
  DEFAULT_SCRAPER_CONFIG,
  buildRequestHeaders,
  type ScraperConfig,
} from '../config/index.js';
import {
  getProxyUrl,
  ProxySessionManager,
  type ProxyUrl,
  type ProxyConfig,
} from '../config/proxy.js';
import { sleep, generateRequestId, withRetry } from '../utils/index.js';

/**
 * HTTP Response wrapper
 */
export interface HttpResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  url: string;
  redirected: boolean;
  requestId: string;
  duration: number;
  proxyUsed: string | null;
}

/**
 * Request options
 */
export interface RequestOptions {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
  timeout?: number;
  followRedirects?: boolean;
  proxySessionKey?: string;
  retries?: number;
  retryDelay?: number;
}

/**
 * Request statistics
 */
export interface RequestStats {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  retriedRequests: number;
  blockedRequests: number;
  averageLatency: number;
  proxyRotations: number;
}

/**
 * HTTP Client class
 */
export class HttpClient {
  private config: ScraperConfig;
  private proxyManager: ProxySessionManager;
  private stats: RequestStats;
  private cookies: Map<string, string> = new Map();
  private latencies: number[] = [];

  constructor(
    scraperConfig?: Partial<ScraperConfig>,
    proxyConfig?: Partial<ProxyConfig>
  ) {
    this.config = { ...DEFAULT_SCRAPER_CONFIG, ...scraperConfig };
    this.proxyManager = new ProxySessionManager(proxyConfig);
    this.stats = this.initStats();
  }

  private initStats(): RequestStats {
    return {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      retriedRequests: 0,
      blockedRequests: 0,
      averageLatency: 0,
      proxyRotations: 0,
    };
  }

  /**
   * Get request statistics
   */
  getStats(): RequestStats {
    return {
      ...this.stats,
      averageLatency:
        this.latencies.length > 0
          ? this.latencies.reduce((a, b) => a + b, 0) / this.latencies.length
          : 0,
    };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.stats = this.initStats();
    this.latencies = [];
  }

  /**
   * Set a cookie
   */
  setCookie(name: string, value: string): void {
    this.cookies.set(name, value);
  }

  /**
   * Get all cookies as header string
   */
  private getCookieHeader(): string {
    const parts: string[] = [];
    for (const [name, value] of this.cookies) {
      parts.push(`${name}=${value}`);
    }
    return parts.join('; ');
  }

  /**
   * Parse Set-Cookie headers and store cookies
   */
  private parseSetCookies(headers: Headers): void {
    const setCookies = headers.getSetCookie?.() || [];
    for (const cookie of setCookies) {
      const match = cookie.match(/^([^=]+)=([^;]*)/);
      if (match) {
        this.cookies.set(match[1], match[2]);
      }
    }
  }

  /**
   * Build fetch options with proxy agent
   */
  private buildFetchOptions(
    options: RequestOptions,
    proxyUrl: ProxyUrl | null
  ): RequestInit & { agent?: HttpsProxyAgent<string> } {
    const headers: Record<string, string> = {
      ...buildRequestHeaders(this.config),
      ...options.headers,
    };

    // Add cookies
    const cookieHeader = this.getCookieHeader();
    if (cookieHeader) {
      headers['Cookie'] = cookieHeader;
    }

    const fetchOptions: RequestInit & { agent?: HttpsProxyAgent<string> } = {
      method: options.method || 'GET',
      headers,
      redirect: options.followRedirects !== false ? 'follow' : 'manual',
    };

    if (options.body) {
      fetchOptions.body = options.body;
    }

    // Add proxy agent if available
    if (proxyUrl) {
      fetchOptions.agent = new HttpsProxyAgent(proxyUrl.url);
    }

    return fetchOptions;
  }

  /**
   * Check if response indicates blocking
   */
  private isBlocked(status: number, body: string): boolean {
    if (status === 403 || status === 429) {
      return true;
    }

    const blockedIndicators = [
      'captcha',
      'blocked',
      'too many requests',
      'rate limit',
      'access denied',
      'forbidden',
      'please verify',
      'security check',
      'cloudflare',
    ];

    const lowerBody = body.toLowerCase();
    return blockedIndicators.some((indicator) => lowerBody.includes(indicator));
  }

  /**
   * Make a single HTTP request
   */
  private async makeRequest(
    url: string,
    options: RequestOptions,
    proxyUrl: ProxyUrl | null
  ): Promise<HttpResponse> {
    const requestId = generateRequestId();
    const startTime = Date.now();

    const fetchOptions = this.buildFetchOptions(options, proxyUrl);
    const timeout = options.timeout || this.config.requestTimeoutMs;

    // Create abort controller for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        ...fetchOptions,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Parse cookies from response
      this.parseSetCookies(response.headers);

      const body = await response.text();
      const duration = Date.now() - startTime;

      // Convert headers to plain object
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });

      return {
        status: response.status,
        statusText: response.statusText,
        headers,
        body,
        url: response.url,
        redirected: response.redirected,
        requestId,
        duration,
        proxyUsed: proxyUrl?.url.replace(/:[^:@]+@/, ':***@') || null,
      };
    } catch (error) {
      clearTimeout(timeoutId);

      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      // Return error response
      return {
        status: 0,
        statusText: errorMessage,
        headers: {},
        body: '',
        url,
        redirected: false,
        requestId,
        duration,
        proxyUsed: proxyUrl?.url.replace(/:[^:@]+@/, ':***@') || null,
      };
    }
  }

  /**
   * Fetch a URL with retry and proxy rotation
   */
  async fetch(url: string, options: RequestOptions = {}): Promise<HttpResponse> {
    this.stats.totalRequests++;

    const maxRetries = options.retries ?? this.config.maxRetries;
    const baseDelay = options.retryDelay ?? this.config.retryDelayMs;

    let lastResponse: HttpResponse | null = null;
    let proxyUrl = this.proxyManager.getSession(options.proxySessionKey || 'default');

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) {
        this.stats.retriedRequests++;

        // Rotate proxy on retry
        if (proxyUrl) {
          this.proxyManager.invalidateSession(options.proxySessionKey || 'default');
          proxyUrl = this.proxyManager.getSession(options.proxySessionKey || 'default');
          this.stats.proxyRotations++;
        }

        // Exponential backoff
        const delay = baseDelay * Math.pow(2, attempt - 1) + Math.random() * 1000;
        await sleep(delay);
      }

      const response = await this.makeRequest(url, options, proxyUrl);
      lastResponse = response;

      // Track latency for successful requests
      if (response.status >= 200 && response.status < 300) {
        this.latencies.push(response.duration);
        if (this.latencies.length > 100) {
          this.latencies.shift();
        }
      }

      // Success
      if (response.status >= 200 && response.status < 300) {
        // Check for soft blocking (captcha in body)
        if (this.isBlocked(response.status, response.body)) {
          this.stats.blockedRequests++;
          continue; // Retry with new proxy
        }

        this.stats.successfulRequests++;
        return response;
      }

      // Hard blocking
      if (this.isBlocked(response.status, response.body)) {
        this.stats.blockedRequests++;
        continue; // Retry with new proxy
      }

      // Server error - retry
      if (response.status >= 500) {
        continue;
      }

      // Client error (4xx except 403/429) - don't retry
      if (response.status >= 400 && response.status < 500) {
        break;
      }

      // Network error - retry
      if (response.status === 0) {
        continue;
      }
    }

    this.stats.failedRequests++;
    return lastResponse!;
  }

  /**
   * Fetch multiple URLs with concurrency control
   */
  async fetchMany(
    urls: string[],
    options: RequestOptions = {},
    concurrency: number = this.config.maxConcurrency
  ): Promise<Map<string, HttpResponse>> {
    const results = new Map<string, HttpResponse>();
    const pending: Promise<void>[] = [];

    for (const url of urls) {
      const task = async () => {
        const response = await this.fetch(url, options);
        results.set(url, response);
      };

      pending.push(task());

      // Control concurrency
      if (pending.length >= concurrency) {
        await Promise.race(pending);
        // Remove completed promises
        for (let i = pending.length - 1; i >= 0; i--) {
          Promise.race([pending[i], Promise.resolve('done')]).then((result) => {
            if (result === 'done') {
              pending.splice(i, 1);
            }
          });
        }
      }
    }

    // Wait for all remaining
    await Promise.all(pending);

    return results;
  }

  /**
   * Clear all cookies
   */
  clearCookies(): void {
    this.cookies.clear();
  }

  /**
   * Clear proxy sessions
   */
  clearProxySessions(): void {
    this.proxyManager.clearSessions();
  }
}

/**
 * Create a configured HTTP client
 */
export function createHttpClient(
  scraperConfig?: Partial<ScraperConfig>,
  proxyConfig?: Partial<ProxyConfig>
): HttpClient {
  return new HttpClient(scraperConfig, proxyConfig);
}
