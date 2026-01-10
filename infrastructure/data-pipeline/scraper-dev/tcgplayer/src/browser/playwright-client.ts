/**
 * Playwright Browser Client
 *
 * Handles JavaScript-rendered pages using headless browser automation.
 * Adapted for TCGplayer with stealth mode and anti-detection features.
 *
 * Features:
 * - Stealth mode with navigator.webdriver masking
 * - Fingerprint rotation
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

export type BrowserType = 'chromium' | 'firefox' | 'webkit';

export interface BrowserClientConfig {
  browserType: BrowserType;
  headless: boolean;
  timeout: number;
  slowMo: number;
  proxy?: {
    server: string;
    username?: string;
    password?: string;
  };
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
  blocked: boolean;
  challengeDetected: boolean;
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
  blockResources: ['media', 'font'], // Keep images for price detection
};

/**
 * Stealth scripts to avoid detection
 * TCGplayer uses the same BWSTATE system as Cardmarket
 */
const STEALTH_SCRIPTS = `
  // Override navigator.webdriver
  Object.defineProperty(navigator, 'webdriver', {
    get: () => undefined,
  });

  // Delete webdriver property
  delete navigator.__proto__.webdriver;

  // Override chrome runtime
  window.chrome = {
    runtime: {},
    loadTimes: function() {},
    csi: function() {},
    app: {},
  };

  // Override permissions
  const originalQuery = window.navigator.permissions.query;
  window.navigator.permissions.query = (parameters) => (
    parameters.name === 'notifications' ?
      Promise.resolve({ state: Notification.permission }) :
      originalQuery(parameters)
  );

  // Override plugins to look like real browser
  Object.defineProperty(navigator, 'plugins', {
    get: () => {
      const plugins = [
        { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer' },
        { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai' },
        { name: 'Native Client', filename: 'internal-nacl-plugin' },
      ];
      plugins.item = (i) => plugins[i];
      plugins.namedItem = (name) => plugins.find(p => p.name === name);
      plugins.refresh = () => {};
      return plugins;
    },
  });

  // Override languages
  Object.defineProperty(navigator, 'languages', {
    get: () => ['en-US', 'en'],
  });

  // Override hardware concurrency
  Object.defineProperty(navigator, 'hardwareConcurrency', {
    get: () => 8,
  });

  // Override device memory
  Object.defineProperty(navigator, 'deviceMemory', {
    get: () => 8,
  });

  // Override connection
  Object.defineProperty(navigator, 'connection', {
    get: () => ({
      effectiveType: '4g',
      rtt: 50,
      downlink: 10,
      saveData: false,
    }),
  });

  // Override WebGL vendor/renderer
  const getParameterProto = WebGLRenderingContext.prototype.getParameter;
  WebGLRenderingContext.prototype.getParameter = function(parameter) {
    if (parameter === 37445) {
      return 'Intel Inc.';
    }
    if (parameter === 37446) {
      return 'Intel Iris OpenGL Engine';
    }
    return getParameterProto.call(this, parameter);
  };

  // Override canvas fingerprint
  const toDataURLProto = HTMLCanvasElement.prototype.toDataURL;
  HTMLCanvasElement.prototype.toDataURL = function(type) {
    if (type === 'image/png' && this.width === 220 && this.height === 30) {
      // Return consistent canvas fingerprint
      return toDataURLProto.call(this, type);
    }
    return toDataURLProto.call(this, type);
  };
`;

/**
 * Playwright browser client for TCGplayer scraping
 */
export class PlaywrightClient {
  private config: BrowserClientConfig;
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private fingerprint: BrowserFingerprint;
  private stats = {
    pagesLoaded: 0,
    pagesFailed: 0,
    challengesDetected: 0,
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
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-features=IsolateOrigins,site-per-process',
        '--disable-dev-shm-usage',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-gpu',
        '--disable-web-security',
        '--disable-features=VizDisplayCompositor',
      ],
    };

    // Add proxy if configured
    if (this.config.proxy) {
      launchOptions.proxy = this.config.proxy;
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
      locale: 'en-US',
      timezoneId: this.fingerprint.timezone,
      colorScheme: 'light',
      extraHTTPHeaders: {
        'Accept-Language': this.fingerprint.acceptLanguage,
      },
    };

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
   * Detect BWSTATE challenge or block
   */
  private detectChallenge(html: string, url: string): { blocked: boolean; challengeDetected: boolean } {
    const blocked =
      html.includes('Access Denied') ||
      html.includes('blocked') ||
      html.includes('captcha') ||
      url.includes('/human-test/');

    const challengeDetected =
      html.includes('human-test') ||
      html.includes('bwstate') ||
      html.includes('challenge') ||
      url.includes('/challenge');

    return { blocked, challengeDetected };
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

    const timing = {
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
        await page.waitForSelector(options.waitForSelector, { timeout: timeout / 2 });
      }

      // Get page content
      const html = await page.content();
      const title = await page.title();
      const finalUrl = page.url();

      // Detect challenges
      const { blocked, challengeDetected } = this.detectChallenge(html, finalUrl);

      if (challengeDetected) {
        this.stats.challengesDetected++;
      }

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
        success: !blocked,
        url: finalUrl,
        status: response?.status() || 200,
        html,
        title,
        screenshot,
        cookies,
        timing,
        blocked,
        challengeDetected,
      };
    } catch (error) {
      this.stats.pagesFailed++;

      const html = await page.content().catch(() => '');
      const { blocked, challengeDetected } = this.detectChallenge(html, url);

      await page.close();

      return {
        success: false,
        url,
        status: 0,
        html,
        title: '',
        cookies: [],
        timing,
        blocked,
        challengeDetected,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Navigate with retry on challenge detection
   */
  async navigateWithRetry(
    url: string,
    options?: {
      waitForSelector?: string;
      maxRetries?: number;
      retryDelay?: number;
    }
  ): Promise<NavigationResult> {
    const maxRetries = options?.maxRetries || 3;
    const retryDelay = options?.retryDelay || 5000;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const result = await this.navigate(url, {
        waitForSelector: options?.waitForSelector,
      });

      if (result.success && !result.challengeDetected) {
        return result;
      }

      if (attempt < maxRetries) {
        console.log(`Challenge detected on attempt ${attempt}, rotating fingerprint and retrying...`);
        await this.rotateFingerprint();
        await this.sleep(retryDelay);
      }
    }

    // Return last result
    return this.navigate(url, { waitForSelector: options?.waitForSelector });
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
        locale: 'en-US',
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
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
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
  getStats() {
    return {
      ...this.stats,
      averageLoadTime: this.stats.pagesLoaded > 0
        ? this.stats.totalLoadTime / this.stats.pagesLoaded
        : 0,
    };
  }

  /**
   * Reset stats
   */
  resetStats(): void {
    this.stats = {
      pagesLoaded: 0,
      pagesFailed: 0,
      challengesDetected: 0,
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
