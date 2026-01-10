/**
 * Playwright Browser Client
 *
 * Handles JavaScript-rendered pages using headless browser automation.
 * Features:
 * - Stealth mode with anti-detection
 * - Proxy integration
 * - Session management
 * - Screenshot capture for debugging
 * - Network request interception
 */

import {
  chromium,
  firefox,
  webkit,
  type Browser,
  type BrowserContext,
  type Page,
  type LaunchOptions,
  type BrowserContextOptions,
} from 'playwright';
import { generateFingerprint, type BrowserFingerprint } from '../resilience/fingerprint.js';
import { getProxyUrl, type ProxyConfig } from '../config/proxy.js';

export type BrowserType = 'chromium' | 'firefox' | 'webkit';

export interface BrowserClientConfig {
  browserType: BrowserType;
  headless: boolean;
  timeout: number;
  slowMo: number;
  proxy?: Partial<ProxyConfig>;
  stealth: boolean;
  screenshots: boolean;
  screenshotDir: string;
  blockResources: string[];
  userDataDir?: string;
}

export interface NavigationResult {
  success: boolean;
  url: string;
  status: number;
  html: string;
  title: string;
  screenshot?: Buffer;
  cookies: Array<{
    name: string;
    value: string;
    domain: string;
  }>;
  timing: {
    navigationStart: number;
    domContentLoaded: number;
    load: number;
  };
  error?: string;
}

const DEFAULT_CONFIG: BrowserClientConfig = {
  browserType: 'chromium',
  headless: true,
  timeout: 30000,
  slowMo: 0,
  stealth: true,
  screenshots: false,
  screenshotDir: './screenshots',
  blockResources: ['image', 'media', 'font'], // Block to speed up loading
};

/**
 * Stealth scripts to avoid detection
 */
const STEALTH_SCRIPTS = `
  // Override navigator.webdriver
  Object.defineProperty(navigator, 'webdriver', {
    get: () => false,
  });

  // Override chrome runtime
  window.chrome = {
    runtime: {},
  };

  // Override permissions
  const originalQuery = window.navigator.permissions.query;
  window.navigator.permissions.query = (parameters) => (
    parameters.name === 'notifications' ?
      Promise.resolve({ state: Notification.permission }) :
      originalQuery(parameters)
  );

  // Override plugins
  Object.defineProperty(navigator, 'plugins', {
    get: () => [1, 2, 3, 4, 5],
  });

  // Override languages
  Object.defineProperty(navigator, 'languages', {
    get: () => ['en-US', 'en', 'de'],
  });

  // Override hardware concurrency
  Object.defineProperty(navigator, 'hardwareConcurrency', {
    get: () => 4,
  });

  // Override device memory
  Object.defineProperty(navigator, 'deviceMemory', {
    get: () => 8,
  });
`;

/**
 * Playwright browser client
 */
export class PlaywrightClient {
  private config: BrowserClientConfig;
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private fingerprint: BrowserFingerprint;
  private stats = {
    pagesLoaded: 0,
    pagesFailed: 0,
    screenshotsTaken: 0,
    totalLoadTime: 0,
  };

  constructor(config?: Partial<BrowserClientConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.fingerprint = generateFingerprint();
  }

  /**
   * Launch the browser
   */
  async launch(): Promise<void> {
    if (this.browser) {
      return;
    }

    const launchOptions: LaunchOptions = {
      headless: this.config.headless,
      slowMo: this.config.slowMo,
    };

    // Add proxy if configured
    const proxyUrl = this.config.proxy ? getProxyUrl(this.config.proxy) : null;
    if (proxyUrl) {
      const proxyParts = new URL(proxyUrl.url);
      launchOptions.proxy = {
        server: `${proxyParts.protocol}//${proxyParts.hostname}:${proxyParts.port}`,
        username: proxyParts.username,
        password: proxyParts.password,
      };
    }

    // Select browser type
    const browserLauncher = {
      chromium,
      firefox,
      webkit,
    }[this.config.browserType];

    this.browser = await browserLauncher.launch(launchOptions);

    // Create context with fingerprint
    const contextOptions: BrowserContextOptions = {
      viewport: this.fingerprint.viewport,
      userAgent: this.fingerprint.userAgent,
      locale: this.fingerprint.language,
      timezoneId: this.fingerprint.timezone,
      colorScheme: 'light',
      extraHTTPHeaders: {
        'Accept-Language': this.fingerprint.acceptLanguage,
      },
    };

    if (this.config.userDataDir) {
      contextOptions.storageState = undefined;
    }

    this.context = await this.browser.newContext(contextOptions);

    // Add stealth scripts if enabled
    if (this.config.stealth) {
      await this.context.addInitScript(STEALTH_SCRIPTS);
    }

    // Block specified resources
    if (this.config.blockResources.length > 0) {
      await this.context.route('**/*', (route) => {
        const resourceType = route.request().resourceType();
        if (this.config.blockResources.includes(resourceType)) {
          route.abort();
        } else {
          route.continue();
        }
      });
    }
  }

  /**
   * Close the browser
   */
  async close(): Promise<void> {
    if (this.context) {
      await this.context.close();
      this.context = null;
    }
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  /**
   * Navigate to a URL and get rendered HTML
   */
  async navigate(url: string, options?: {
    waitForSelector?: string;
    waitForLoadState?: 'load' | 'domcontentloaded' | 'networkidle';
    timeout?: number;
    screenshot?: boolean;
  }): Promise<NavigationResult> {
    if (!this.browser || !this.context) {
      await this.launch();
    }

    const page = await this.context!.newPage();
    const timeout = options?.timeout || this.config.timeout;
    const startTime = Date.now();

    let timing = {
      navigationStart: startTime,
      domContentLoaded: 0,
      load: 0,
    };

    try {
      // Set up performance timing collection
      page.on('domcontentloaded', () => {
        timing.domContentLoaded = Date.now() - startTime;
      });

      page.on('load', () => {
        timing.load = Date.now() - startTime;
      });

      // Navigate to URL
      const response = await page.goto(url, {
        timeout,
        waitUntil: options?.waitForLoadState || 'domcontentloaded',
      });

      // Wait for specific selector if requested
      if (options?.waitForSelector) {
        await page.waitForSelector(options.waitForSelector, { timeout });
      }

      // Get page content
      const html = await page.content();
      const title = await page.title();

      // Get cookies
      const cookies = (await this.context!.cookies()).map((c) => ({
        name: c.name,
        value: c.value,
        domain: c.domain,
      }));

      // Take screenshot if requested
      let screenshot: Buffer | undefined;
      if (options?.screenshot || this.config.screenshots) {
        screenshot = await page.screenshot({ fullPage: true });
        this.stats.screenshotsTaken++;
      }

      this.stats.pagesLoaded++;
      this.stats.totalLoadTime += Date.now() - startTime;

      await page.close();

      return {
        success: true,
        url: page.url(),
        status: response?.status() || 200,
        html,
        title,
        screenshot,
        cookies,
        timing,
      };
    } catch (error) {
      this.stats.pagesFailed++;

      const html = await page.content().catch(() => '');

      await page.close();

      return {
        success: false,
        url,
        status: 0,
        html,
        title: '',
        cookies: [],
        timing,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Execute JavaScript on a page and get result
   */
  async evaluate<T>(url: string, script: string | (() => T)): Promise<T | null> {
    if (!this.browser || !this.context) {
      await this.launch();
    }

    const page = await this.context!.newPage();

    try {
      await page.goto(url, {
        timeout: this.config.timeout,
        waitUntil: 'domcontentloaded',
      });

      const result = await page.evaluate(script);
      await page.close();
      return result as T;
    } catch (error) {
      await page.close();
      console.error('Evaluate error:', error);
      return null;
    }
  }

  /**
   * Wait for an element and click it
   */
  async clickAndWait(
    page: Page,
    selector: string,
    waitForSelector?: string
  ): Promise<void> {
    await page.click(selector);
    if (waitForSelector) {
      await page.waitForSelector(waitForSelector, { timeout: this.config.timeout });
    }
  }

  /**
   * Handle infinite scroll pages
   */
  async scrollToBottom(page: Page, maxScrolls: number = 10): Promise<void> {
    let previousHeight = 0;
    let scrolls = 0;

    while (scrolls < maxScrolls) {
      const currentHeight = await page.evaluate(() => document.body.scrollHeight);

      if (currentHeight === previousHeight) {
        break;
      }

      previousHeight = currentHeight;
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(1000);
      scrolls++;
    }
  }

  /**
   * Get a new page from the context
   */
  async newPage(): Promise<Page> {
    if (!this.browser || !this.context) {
      await this.launch();
    }
    return this.context!.newPage();
  }

  /**
   * Rotate fingerprint and recreate context
   */
  async rotateFingerprint(): Promise<void> {
    this.fingerprint = generateFingerprint();

    if (this.context) {
      await this.context.close();
    }

    if (this.browser) {
      this.context = await this.browser.newContext({
        viewport: this.fingerprint.viewport,
        userAgent: this.fingerprint.userAgent,
        locale: this.fingerprint.language,
        timezoneId: this.fingerprint.timezone,
        extraHTTPHeaders: {
          'Accept-Language': this.fingerprint.acceptLanguage,
        },
      });

      if (this.config.stealth) {
        await this.context.addInitScript(STEALTH_SCRIPTS);
      }
    }
  }

  /**
   * Get current fingerprint
   */
  getFingerprint(): BrowserFingerprint {
    return { ...this.fingerprint };
  }

  /**
   * Get client stats
   */
  getStats(): typeof this.stats {
    return {
      ...this.stats,
      averageLoadTime: this.stats.pagesLoaded > 0
        ? this.stats.totalLoadTime / this.stats.pagesLoaded
        : 0,
    } as typeof this.stats;
  }

  /**
   * Reset stats
   */
  resetStats(): void {
    this.stats = {
      pagesLoaded: 0,
      pagesFailed: 0,
      screenshotsTaken: 0,
      totalLoadTime: 0,
    };
  }
}

/**
 * Create a Playwright client
 */
export function createPlaywrightClient(config?: Partial<BrowserClientConfig>): PlaywrightClient {
  return new PlaywrightClient(config);
}
