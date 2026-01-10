/**
 * Hybrid Scraper
 *
 * Intelligently switches between HTTP client and Playwright browser
 * based on page requirements and error patterns.
 *
 * Strategy:
 * 1. Start with HTTP client (faster, cheaper)
 * 2. Escalate to Playwright if:
 *    - Page requires JavaScript rendering
 *    - HTTP client is blocked
 *    - CAPTCHA detected
 */

import {
  HttpClient,
  type HttpResponse,
  type RequestOptions,
} from './http-client.js';
import {
  PlaywrightClient,
  type BrowserClientConfig,
  type NavigationResult,
} from '../browser/playwright-client.js';
import {
  CardmarketHtmlParser,
  type ParsedProduct,
  type ParsedCardDetails,
} from '../parsers/html-parser.js';
import {
  CircuitBreaker,
  CircuitBreakerRegistry,
} from '../resilience/circuit-breaker.js';
import {
  detectCaptcha,
  CaptchaSolver,
  type CaptchaConfig,
} from '../resilience/captcha.js';
import {
  DEFAULT_SCRAPER_CONFIG,
  type ScraperConfig,
} from '../config/index.js';
import { type ProxyConfig } from '../config/proxy.js';
import { RateLimiter, sleep } from '../utils/index.js';

export type FetchMode = 'http' | 'browser' | 'auto';

export interface HybridScraperConfig {
  scraper: Partial<ScraperConfig>;
  proxy: Partial<ProxyConfig>;
  browser: Partial<BrowserClientConfig>;
  captcha: Partial<CaptchaConfig>;
  defaultMode: FetchMode;
  escalationThreshold: number;  // Failures before escalating to browser
  deescalationThreshold: number; // Successes before returning to HTTP
}

export interface HybridResponse {
  success: boolean;
  mode: 'http' | 'browser';
  url: string;
  status: number;
  html: string;
  captchaDetected: boolean;
  escalated: boolean;
  timing: {
    total: number;
    fetch: number;
    parse?: number;
  };
  error?: string;
}

export interface HybridStats {
  httpRequests: number;
  browserRequests: number;
  escalations: number;
  deescalations: number;
  captchasDetected: number;
  captchasSolved: number;
  averageHttpLatency: number;
  averageBrowserLatency: number;
}

const DEFAULT_HYBRID_CONFIG: HybridScraperConfig = {
  scraper: {},
  proxy: {},
  browser: {},
  captcha: {},
  defaultMode: 'auto',
  escalationThreshold: 3,
  deescalationThreshold: 5,
};

/**
 * Hybrid scraper class
 */
export class HybridScraper {
  private httpClient: HttpClient;
  private browserClient: PlaywrightClient | null = null;
  private parser: CardmarketHtmlParser;
  private captchaSolver: CaptchaSolver;
  private circuitRegistry: CircuitBreakerRegistry;
  private rateLimiter: RateLimiter;
  private config: HybridScraperConfig;

  private currentMode: 'http' | 'browser' = 'http';
  private httpFailures: number = 0;
  private browserSuccesses: number = 0;

  private stats: HybridStats = {
    httpRequests: 0,
    browserRequests: 0,
    escalations: 0,
    deescalations: 0,
    captchasDetected: 0,
    captchasSolved: 0,
    averageHttpLatency: 0,
    averageBrowserLatency: 0,
  };

  private httpLatencies: number[] = [];
  private browserLatencies: number[] = [];

  constructor(config?: Partial<HybridScraperConfig>) {
    this.config = { ...DEFAULT_HYBRID_CONFIG, ...config };

    const scraperConfig = { ...DEFAULT_SCRAPER_CONFIG, ...this.config.scraper };

    this.httpClient = new HttpClient(this.config.scraper, this.config.proxy);
    this.parser = new CardmarketHtmlParser();
    this.captchaSolver = new CaptchaSolver(this.config.captcha);
    this.circuitRegistry = new CircuitBreakerRegistry();
    this.rateLimiter = new RateLimiter(
      scraperConfig.requestsPerMinute,
      scraperConfig.requestsPerMinute / 60
    );

    // Set initial mode
    if (this.config.defaultMode === 'http') {
      this.currentMode = 'http';
    } else if (this.config.defaultMode === 'browser') {
      this.currentMode = 'browser';
    }
  }

  /**
   * Initialize browser client lazily
   */
  private async ensureBrowserClient(): Promise<PlaywrightClient> {
    if (!this.browserClient) {
      this.browserClient = new PlaywrightClient(this.config.browser);
      await this.browserClient.launch();
    }
    return this.browserClient;
  }

  /**
   * Fetch a URL using the appropriate method
   */
  async fetch(url: string, options?: {
    mode?: FetchMode;
    waitForSelector?: string;
    requestOptions?: RequestOptions;
  }): Promise<HybridResponse> {
    const startTime = Date.now();
    await this.rateLimiter.acquire();

    const mode = options?.mode || this.config.defaultMode;
    const shouldUseBrowser = mode === 'browser' ||
      (mode === 'auto' && this.currentMode === 'browser');

    // Check circuit breaker for the domain
    const domain = new URL(url).hostname;
    const circuit = this.circuitRegistry.getCircuit(domain);

    if (!circuit.canRequest()) {
      return {
        success: false,
        mode: this.currentMode,
        url,
        status: 0,
        html: '',
        captchaDetected: false,
        escalated: false,
        timing: { total: Date.now() - startTime, fetch: 0 },
        error: 'Circuit breaker open - too many failures',
      };
    }

    let response: HybridResponse;

    if (shouldUseBrowser) {
      response = await this.fetchWithBrowser(url, options?.waitForSelector);
    } else {
      response = await this.fetchWithHttp(url, options?.requestOptions);

      // Check for escalation conditions
      if (!response.success || response.captchaDetected) {
        this.httpFailures++;

        if (this.httpFailures >= this.config.escalationThreshold) {
          // Escalate to browser
          this.stats.escalations++;
          this.currentMode = 'browser';
          this.httpFailures = 0;

          // Retry with browser
          response = await this.fetchWithBrowser(url, options?.waitForSelector);
          response.escalated = true;
        }
      } else {
        this.httpFailures = 0;
      }
    }

    // Update circuit breaker
    if (response.success) {
      circuit.recordSuccess();

      // Check for de-escalation
      if (this.currentMode === 'browser') {
        this.browserSuccesses++;
        if (this.browserSuccesses >= this.config.deescalationThreshold) {
          this.stats.deescalations++;
          this.currentMode = 'http';
          this.browserSuccesses = 0;
        }
      }
    } else {
      circuit.recordFailure();
    }

    response.timing.total = Date.now() - startTime;
    return response;
  }

  /**
   * Fetch using HTTP client
   */
  private async fetchWithHttp(
    url: string,
    options?: RequestOptions
  ): Promise<HybridResponse> {
    const fetchStart = Date.now();
    this.stats.httpRequests++;

    const response = await this.httpClient.fetch(url, options);
    const fetchTime = Date.now() - fetchStart;

    this.httpLatencies.push(fetchTime);
    if (this.httpLatencies.length > 100) this.httpLatencies.shift();

    const captchaResult = detectCaptcha(response.body);

    if (captchaResult.detected) {
      this.stats.captchasDetected++;
    }

    return {
      success: response.status >= 200 && response.status < 300,
      mode: 'http',
      url: response.url,
      status: response.status,
      html: response.body,
      captchaDetected: captchaResult.detected,
      escalated: false,
      timing: {
        total: fetchTime,
        fetch: fetchTime,
      },
      error: response.status !== 200 ? response.statusText : undefined,
    };
  }

  /**
   * Fetch using Playwright browser
   */
  private async fetchWithBrowser(
    url: string,
    waitForSelector?: string
  ): Promise<HybridResponse> {
    const fetchStart = Date.now();
    this.stats.browserRequests++;

    const client = await this.ensureBrowserClient();
    const result = await client.navigate(url, {
      waitForSelector,
      waitForLoadState: 'networkidle',
    });

    const fetchTime = Date.now() - fetchStart;

    this.browserLatencies.push(fetchTime);
    if (this.browserLatencies.length > 100) this.browserLatencies.shift();

    const captchaResult = detectCaptcha(result.html);

    if (captchaResult.detected) {
      this.stats.captchasDetected++;

      // Try to solve CAPTCHA if solver is configured
      if (this.captchaSolver.isConfigured() && captchaResult.siteKey) {
        const solution = await this.captchaSolver.solve({
          type: captchaResult.type!,
          siteKey: captchaResult.siteKey,
          pageUrl: url,
        });

        if (solution) {
          this.stats.captchasSolved++;
          // Would need to submit the solution and re-fetch
          // This is a simplified implementation
        }
      }
    }

    return {
      success: result.success,
      mode: 'browser',
      url: result.url,
      status: result.status,
      html: result.html,
      captchaDetected: captchaResult.detected,
      escalated: false,
      timing: {
        total: fetchTime,
        fetch: result.timing.load || fetchTime,
      },
      error: result.error,
    };
  }

  /**
   * Parse products from expansion page
   */
  async scrapeExpansionPage(url: string): Promise<{
    products: ParsedProduct[];
    response: HybridResponse;
  }> {
    const response = await this.fetch(url);

    if (!response.success) {
      return { products: [], response };
    }

    const products = this.parser.parseExpansionPage(response.html, new URL(url).origin);
    response.timing.parse = Date.now() - (Date.now() - response.timing.total);

    return { products, response };
  }

  /**
   * Parse card details from card page
   */
  async scrapeCardPage(url: string): Promise<{
    card: ParsedCardDetails | null;
    response: HybridResponse;
  }> {
    const response = await this.fetch(url, {
      waitForSelector: '.info-list-container, .price-container',
    });

    if (!response.success) {
      return { card: null, response };
    }

    const card = this.parser.parseCardDetailPage(response.html);
    response.timing.parse = Date.now() - (Date.now() - response.timing.total);

    return { card, response };
  }

  /**
   * Get current fetch mode
   */
  getCurrentMode(): 'http' | 'browser' {
    return this.currentMode;
  }

  /**
   * Force a specific mode
   */
  setMode(mode: 'http' | 'browser'): void {
    this.currentMode = mode;
    this.httpFailures = 0;
    this.browserSuccesses = 0;
  }

  /**
   * Get statistics
   */
  getStats(): HybridStats {
    return {
      ...this.stats,
      averageHttpLatency: this.httpLatencies.length > 0
        ? this.httpLatencies.reduce((a, b) => a + b, 0) / this.httpLatencies.length
        : 0,
      averageBrowserLatency: this.browserLatencies.length > 0
        ? this.browserLatencies.reduce((a, b) => a + b, 0) / this.browserLatencies.length
        : 0,
    };
  }

  /**
   * Get circuit breaker stats
   */
  getCircuitStats(): Map<string, {
    state: string;
    failures: number;
    successes: number;
  }> {
    const stats = new Map();
    for (const [name, circuit] of this.circuitRegistry.getAllStats()) {
      stats.set(name, {
        state: circuit.state,
        failures: circuit.failures,
        successes: circuit.successes,
      });
    }
    return stats;
  }

  /**
   * Reset all state
   */
  reset(): void {
    this.currentMode = this.config.defaultMode === 'browser' ? 'browser' : 'http';
    this.httpFailures = 0;
    this.browserSuccesses = 0;
    this.httpLatencies = [];
    this.browserLatencies = [];
    this.stats = {
      httpRequests: 0,
      browserRequests: 0,
      escalations: 0,
      deescalations: 0,
      captchasDetected: 0,
      captchasSolved: 0,
      averageHttpLatency: 0,
      averageBrowserLatency: 0,
    };
    this.circuitRegistry.resetAll();
    this.httpClient.resetStats();
    this.parser.resetStats();
  }

  /**
   * Close browser if open
   */
  async close(): Promise<void> {
    if (this.browserClient) {
      await this.browserClient.close();
      this.browserClient = null;
    }
  }
}

/**
 * Create a hybrid scraper
 */
export function createHybridScraper(config?: Partial<HybridScraperConfig>): HybridScraper {
  return new HybridScraper(config);
}
