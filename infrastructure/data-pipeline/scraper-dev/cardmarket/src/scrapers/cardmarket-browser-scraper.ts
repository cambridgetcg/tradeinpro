/**
 * CardMarket Browser Scraper
 *
 * Uses Playwright browser automation to bypass Cloudflare protection.
 * This works WITHOUT a proxy when using stealth mode.
 *
 * Key differences from HTTP scraper:
 * - Uses headless browser instead of HTTP requests
 * - Bypasses Cloudflare challenge automatically
 * - Stealth scripts prevent bot detection
 * - No residential proxy required
 */

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import {
  CARDMARKET_BASE_URL,
  CARDMARKET_ONEPIECE_URL,
  ONEPIECE_SETS,
  type SetConfig,
} from '../config/index.js';
import {
  CardmarketHtmlParser,
  type ParsedProduct,
  type ParsedArticle,
} from '../parsers/html-parser.js';
import {
  RateLimiter,
  sleepWithVariance,
  nowIso,
  normalizeCardId,
} from '../utils/index.js';

/**
 * Stealth scripts to avoid bot detection
 */
const STEALTH_SCRIPTS = `
  Object.defineProperty(navigator, 'webdriver', { get: () => false });
  window.chrome = { runtime: {} };
  Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
  Object.defineProperty(navigator, 'languages', { get: () => ['en-GB', 'en-US', 'en'] });
  Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 4 });
  Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
`;

export interface BrowserScraperConfig {
  headless: boolean;
  slowMo: number;
  timeout: number;
  requestsPerMinute: number;
  requestDelayMs: number;
  blockImages: boolean;
  maxRetries: number;
}

const DEFAULT_CONFIG: BrowserScraperConfig = {
  headless: true,
  slowMo: 0,
  timeout: 60000,
  requestsPerMinute: 10,
  requestDelayMs: 3000,
  blockImages: true,
  maxRetries: 2,
};

export interface ScrapedCard {
  cardId: string;
  name: string;
  setCode: string;
  cardNumber: string;
  variantType: string;
  rarity: string | null;
  imageUrl: string | null;
  trendPrice: number | null;
  lowPrice: number | null;
  avg7Price: number | null;
  avg30Price: number | null;
  availableCount: number | null;
  priceChange7d: number | null;
  priceChange30d: number | null;
  sourceUrl: string;
  scrapedAt: string;
}

export interface ScrapedArticle extends ParsedArticle {
  cardId: string;
  sourceUrl: string;
  scrapedAt: string;
}

export interface ScrapeResult {
  success: boolean;
  cards: ScrapedCard[];
  articles: ScrapedArticle[];
  errors: string[];
  stats: {
    cardsScraped: number;
    articlesScraped: number;
    pagesProcessed: number;
    duration: number;
  };
}

export interface ScrapeProgress {
  currentSet: string;
  currentPage: number;
  totalPages: number | null;
  cardsScraped: number;
  articlesScraped: number;
  errorsCount: number;
}

export interface ScraperOptions {
  sets?: string[];
  includeArticles?: boolean;
  maxCardsPerSet?: number;
  maxPagesPerSet?: number;
  startPage?: number;
  delayBetweenRequests?: number;
  delayBetweenSets?: number;
  onProgress?: (progress: ScrapeProgress) => void;
}

/**
 * Browser-based CardMarket scraper
 * Bypasses Cloudflare without requiring a proxy
 */
export class CardmarketBrowserScraper {
  private config: BrowserScraperConfig;
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private parser: CardmarketHtmlParser;
  private rateLimiter: RateLimiter;
  private errors: string[] = [];

  constructor(config?: Partial<BrowserScraperConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.parser = new CardmarketHtmlParser();
    this.rateLimiter = new RateLimiter(
      this.config.requestsPerMinute,
      this.config.requestsPerMinute / 60
    );
  }

  /**
   * Launch the browser
   */
  async launch(): Promise<void> {
    if (this.browser) return;

    this.browser = await chromium.launch({
      headless: this.config.headless,
      slowMo: this.config.slowMo,
    });

    this.context = await this.browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      locale: 'en-GB',
      viewport: { width: 1920, height: 1080 },
      extraHTTPHeaders: {
        'Accept-Language': 'en-GB,en;q=0.9',
      },
    });

    // Add stealth scripts
    await this.context.addInitScript(STEALTH_SCRIPTS);

    // Block images/media to speed up loading
    if (this.config.blockImages) {
      await this.context.route('**/*', (route) => {
        const type = route.request().resourceType();
        if (['image', 'media', 'font'].includes(type)) {
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
   * Navigate to a page with retry logic
   */
  private async navigatePage(url: string): Promise<{ page: Page; html: string } | null> {
    await this.rateLimiter.acquire();

    if (!this.context) {
      await this.launch();
    }

    const page = await this.context!.newPage();

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        await page.goto(url, {
          waitUntil: 'networkidle',
          timeout: this.config.timeout,
        });

        // Wait for content to load
        await page.waitForTimeout(2000);

        const html = await page.content();

        // Check for Cloudflare challenge
        if (html.includes('Just a moment')) {
          console.log('   Cloudflare challenge detected, waiting...');
          await page.waitForTimeout(5000);
          const retryHtml = await page.content();
          if (!retryHtml.includes('Just a moment')) {
            return { page, html: retryHtml };
          }
          throw new Error('Cloudflare challenge not resolved');
        }

        // Check for blocked page
        if (this.parser.isBlocked(html)) {
          throw new Error('Access blocked');
        }

        return { page, html };
      } catch (error) {
        if (attempt === this.config.maxRetries) {
          await page.close();
          const msg = error instanceof Error ? error.message : 'Unknown error';
          this.errors.push(`Failed to navigate to ${url}: ${msg}`);
          return null;
        }
        console.log(`   Retry ${attempt + 1}/${this.config.maxRetries}...`);
        await sleepWithVariance(3000);
      }
    }

    await page.close();
    return null;
  }

  /**
   * Build URL for expansion page
   */
  private buildExpansionUrl(setCode: string, page: number = 1): string {
    const setConfig = ONEPIECE_SETS[setCode];
    if (!setConfig) {
      throw new Error(`Unknown set code: ${setCode}`);
    }
    const baseUrl = `${CARDMARKET_ONEPIECE_URL}/Products/Singles/${setConfig.cardmarketName}`;
    return page > 1 ? `${baseUrl}?site=${page}` : baseUrl;
  }

  /**
   * Extract products from expansion page using browser
   */
  private async scrapeExpansionPage(
    setCode: string,
    pageNum: number
  ): Promise<{ products: ParsedProduct[]; totalPages: number | null }> {
    const url = this.buildExpansionUrl(setCode, pageNum);
    const result = await this.navigatePage(url);

    if (!result) {
      return { products: [], totalPages: null };
    }

    try {
      // Extract products using page evaluation for more accurate data
      const products = await result.page.evaluate(() => {
        const items: Array<{
          name: string;
          url: string;
          cardNumber: string;
          rarity: string;
          trendPrice: number | null;
          lowPrice: number | null;
          availableCount: number | null;
        }> = [];

        // Find all product rows in the table
        const rows = document.querySelectorAll('.table-body .row');

        rows.forEach((row) => {
          const linkEl = row.querySelector('a[href*="/Products/Singles/"]');
          if (!linkEl) return;

          const href = linkEl.getAttribute('href') || '';
          const name = linkEl.textContent?.trim() || '';

          // Extract card number from URL or name
          const cardNumMatch = href.match(/OP\d{2}-(\d{3})/i) || name.match(/\(([^)]+)\)/);
          const cardNumber = cardNumMatch ? cardNumMatch[1] : '';

          // Get price info
          const priceEls = row.querySelectorAll('.col-price, .font-weight-bold');
          let trendPrice: number | null = null;
          let lowPrice: number | null = null;

          priceEls.forEach((el) => {
            const priceText = el.textContent?.trim() || '';
            const priceMatch = priceText.match(/(\d+[.,]\d{2})\s*[€£]/);
            if (priceMatch) {
              const price = parseFloat(priceMatch[1].replace(',', '.'));
              if (trendPrice === null) {
                trendPrice = price;
              } else if (lowPrice === null) {
                lowPrice = price;
              }
            }
          });

          // Get availability
          const availEl = row.querySelector('.col-availability, .text-muted');
          const availText = availEl?.textContent?.trim() || '';
          const availMatch = availText.match(/(\d+)/);
          const availableCount = availMatch ? parseInt(availMatch[1], 10) : null;

          if (href) {
            items.push({
              name,
              url: href.startsWith('http') ? href : `https://www.cardmarket.com${href}`,
              cardNumber,
              rarity: '',
              trendPrice,
              lowPrice,
              availableCount,
            });
          }
        });

        return items;
      });

      // Get pagination
      const pagination = await result.page.evaluate(() => {
        const paginationEls = document.querySelectorAll('.pagination .page-item');
        let maxPage = 1;
        paginationEls.forEach((el) => {
          const pageText = el.textContent?.trim() || '';
          const pageNum = parseInt(pageText, 10);
          if (!isNaN(pageNum) && pageNum > maxPage) {
            maxPage = pageNum;
          }
        });
        return maxPage;
      });

      await result.page.close();

      // Convert to ParsedProduct format
      const parsedProducts: ParsedProduct[] = products
        .filter((p) => p.url.includes('/Products/Singles/'))
        .map((p) => ({
          name: p.name,
          url: p.url,
          cardNumber: p.cardNumber,
          rarity: p.rarity,
          trendPrice: p.trendPrice,
          lowPrice: p.lowPrice,
          availableCount: p.availableCount,
        }));

      return {
        products: parsedProducts,
        totalPages: pagination > 1 ? pagination : null,
      };
    } catch (error) {
      await result.page.close();
      const msg = error instanceof Error ? error.message : 'Unknown error';
      this.errors.push(`Error parsing expansion page ${url}: ${msg}`);
      return { products: [], totalPages: null };
    }
  }

  /**
   * Scrape card detail page
   */
  private async scrapeCardDetail(
    url: string,
    setCode: string
  ): Promise<{ card: ScrapedCard | null; articles: ScrapedArticle[] }> {
    const result = await this.navigatePage(url);

    if (!result) {
      return { card: null, articles: [] };
    }

    try {
      // Extract card details using page evaluation
      const details = await result.page.evaluate(() => {
        const data: {
          name: string;
          cardNumber: string;
          rarity: string;
          imageUrl: string | null;
          trendPrice: number | null;
          lowPrice: number | null;
          avg7Price: number | null;
          avg30Price: number | null;
          availableCount: number | null;
        } = {
          name: '',
          cardNumber: '',
          rarity: '',
          imageUrl: null,
          trendPrice: null,
          lowPrice: null,
          avg7Price: null,
          avg30Price: null,
          availableCount: null,
        };

        // Get name from h1
        const h1 = document.querySelector('h1');
        data.name = h1?.textContent?.trim() || '';

        // Get card number from breadcrumb or title
        const titleMatch = data.name.match(/\(([^)]+)\)/);
        if (titleMatch) {
          data.cardNumber = titleMatch[1];
        }

        // Get image
        const imgEl = document.querySelector('.image-wrapper img, .product-image img');
        data.imageUrl = imgEl?.getAttribute('src') || null;

        // Get price info from info table
        const infoRows = document.querySelectorAll('.info-list-container dd, .labeled-info');
        infoRows.forEach((el) => {
          const label = el.previousElementSibling?.textContent?.trim()?.toLowerCase() || '';
          const value = el.textContent?.trim() || '';
          const priceMatch = value.match(/(\d+[.,]\d{2})/);
          const price = priceMatch ? parseFloat(priceMatch[1].replace(',', '.')) : null;

          if (label.includes('trend') && price) data.trendPrice = price;
          if (label.includes('low') && price) data.lowPrice = price;
          if (label.includes('7-day') && price) data.avg7Price = price;
          if (label.includes('30-day') && price) data.avg30Price = price;
          if (label.includes('available')) {
            const availMatch = value.match(/(\d+)/);
            data.availableCount = availMatch ? parseInt(availMatch[1], 10) : null;
          }
        });

        return data;
      });

      await result.page.close();

      if (!details.name) {
        this.errors.push(`No card data found at ${url}`);
        return { card: null, articles: [] };
      }

      // Determine variant type from URL
      let variantType = 'standard';
      const urlLower = url.toLowerCase();
      if (urlLower.includes('-v2') || urlLower.includes('parallel')) variantType = 'parallel';
      else if (urlLower.includes('-manga')) variantType = 'manga';
      else if (urlLower.includes('-sp')) variantType = 'sp';

      const cardId = normalizeCardId(setCode, details.cardNumber || '000', variantType);

      const card: ScrapedCard = {
        cardId,
        name: details.name,
        setCode,
        cardNumber: details.cardNumber || '000',
        variantType,
        rarity: details.rarity || null,
        imageUrl: details.imageUrl,
        trendPrice: details.trendPrice,
        lowPrice: details.lowPrice,
        avg7Price: details.avg7Price,
        avg30Price: details.avg30Price,
        availableCount: details.availableCount,
        priceChange7d: null,
        priceChange30d: null,
        sourceUrl: url,
        scrapedAt: nowIso(),
      };

      return { card, articles: [] };
    } catch (error) {
      await result.page.close();
      const msg = error instanceof Error ? error.message : 'Unknown error';
      this.errors.push(`Error parsing card detail ${url}: ${msg}`);
      return { card: null, articles: [] };
    }
  }

  /**
   * Scrape all cards from a set
   */
  async scrapeSet(
    setCode: string,
    options: Omit<ScraperOptions, 'sets'> = {}
  ): Promise<ScrapeResult> {
    const startTime = Date.now();
    const cards: ScrapedCard[] = [];
    const articles: ScrapedArticle[] = [];
    this.errors = [];
    this.parser.resetStats();

    await this.launch();

    const {
      includeArticles = false,
      maxCardsPerSet = Infinity,
      maxPagesPerSet = Infinity,
      startPage = 1,
      delayBetweenRequests = this.config.requestDelayMs,
      onProgress,
    } = options;

    let page = startPage;
    let totalPages: number | null = null;
    let pagesProcessed = 0;
    const productUrls: string[] = [];
    const seenUrls = new Set<string>();

    console.log(`\n📦 Scraping set: ${setCode}`);

    // Phase 1: Collect product URLs from expansion pages
    while (page <= (totalPages || maxPagesPerSet)) {
      if (productUrls.length >= maxCardsPerSet) break;

      console.log(`   Page ${page}${totalPages ? `/${totalPages}` : ''}...`);
      const result = await this.scrapeExpansionPage(setCode, page);
      pagesProcessed++;

      if (result.totalPages && !totalPages) {
        totalPages = Math.min(result.totalPages, maxPagesPerSet);
      }

      for (const product of result.products) {
        if (!seenUrls.has(product.url) && productUrls.length < maxCardsPerSet) {
          seenUrls.add(product.url);
          productUrls.push(product.url);
        }
      }

      console.log(`   Found ${result.products.length} products (total: ${productUrls.length})`);

      if (onProgress) {
        onProgress({
          currentSet: setCode,
          currentPage: page,
          totalPages,
          cardsScraped: cards.length,
          articlesScraped: articles.length,
          errorsCount: this.errors.length,
        });
      }

      page++;

      if (page <= (totalPages || maxPagesPerSet)) {
        await sleepWithVariance(delayBetweenRequests);
      }
    }

    // Phase 2: Scrape individual card details
    console.log(`\n📊 Scraping ${productUrls.length} card details...`);

    for (let i = 0; i < productUrls.length; i++) {
      const url = productUrls[i];
      console.log(`   [${i + 1}/${productUrls.length}] ${url.split('/').pop()}`);

      const result = await this.scrapeCardDetail(url, setCode);

      if (result.card) {
        cards.push(result.card);
        console.log(`      ✓ ${result.card.name} - €${result.card.trendPrice || 'N/A'}`);
      }

      if (includeArticles && result.articles.length > 0) {
        articles.push(...result.articles);
      }

      if (onProgress) {
        onProgress({
          currentSet: setCode,
          currentPage: page,
          totalPages,
          cardsScraped: cards.length,
          articlesScraped: articles.length,
          errorsCount: this.errors.length,
        });
      }

      if (i < productUrls.length - 1) {
        await sleepWithVariance(delayBetweenRequests);
      }
    }

    const duration = Date.now() - startTime;

    return {
      success: this.errors.length === 0,
      cards,
      articles,
      errors: this.errors,
      stats: {
        cardsScraped: cards.length,
        articlesScraped: articles.length,
        pagesProcessed,
        duration,
      },
    };
  }

  /**
   * Test connectivity to CardMarket
   */
  async testConnection(): Promise<{ success: boolean; message: string; latency: number }> {
    const startTime = Date.now();

    try {
      await this.launch();

      const result = await this.navigatePage(CARDMARKET_ONEPIECE_URL);
      const latency = Date.now() - startTime;

      if (!result) {
        return {
          success: false,
          message: 'Failed to load CardMarket page',
          latency,
        };
      }

      const hasContent = result.html.includes('One Piece') || result.html.includes('onepiece');
      await result.page.close();

      if (hasContent) {
        return {
          success: true,
          message: 'Connection successful - Cloudflare bypassed with browser automation',
          latency,
        };
      }

      return {
        success: false,
        message: 'Page loaded but content verification failed',
        latency,
      };
    } catch (error) {
      return {
        success: false,
        message: `Connection error: ${error instanceof Error ? error.message : 'Unknown'}`,
        latency: Date.now() - startTime,
      };
    }
  }

  /**
   * Get available sets
   */
  getAvailableSets(): SetConfig[] {
    return Object.values(ONEPIECE_SETS);
  }

  /**
   * Reset state
   */
  async reset(): Promise<void> {
    this.errors = [];
    this.parser.resetStats();
    await this.close();
  }
}

/**
 * Create a browser-based scraper instance
 */
export function createBrowserScraper(
  config?: Partial<BrowserScraperConfig>
): CardmarketBrowserScraper {
  return new CardmarketBrowserScraper(config);
}
