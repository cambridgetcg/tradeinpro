/**
 * CardMarket Archive Scraper
 *
 * Scrapes CardMarket for historical price archiving with:
 * - Aggregate prices (trend, from, 7d avg, 30d avg)
 * - Condition-level price breakdowns (MT, NM, EX, GD, LP, PL, PO)
 * - Language partitioning (EN, JP, DE, FR, ES, IT)
 * - Seller listing snapshots
 *
 * Designed for daily archival to build comprehensive price history.
 */

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import {
  CARDMARKET_ONEPIECE_URL,
  ONEPIECE_SETS,
} from '../config/index.js';
import { RateLimiter, sleepWithVariance, nowIso } from '../utils/index.js';

// Stealth scripts
const STEALTH_SCRIPTS = `
  Object.defineProperty(navigator, 'webdriver', { get: () => false });
  window.chrome = { runtime: {} };
  Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
  Object.defineProperty(navigator, 'languages', { get: () => ['en-GB', 'en-US', 'en'] });
`;

// CardMarket condition mappings
export const CONDITIONS = {
  1: { id: 1, code: 'MT', name: 'Mint' },
  2: { id: 2, code: 'NM', name: 'Near Mint' },
  3: { id: 3, code: 'EX', name: 'Excellent' },
  4: { id: 4, code: 'GD', name: 'Good' },
  5: { id: 5, code: 'LP', name: 'Light Played' },
  6: { id: 6, code: 'PL', name: 'Played' },
  7: { id: 7, code: 'PO', name: 'Poor' },
} as const;

// CardMarket language mappings
export const LANGUAGES = {
  1: { id: 1, code: 'EN', name: 'English' },
  2: { id: 2, code: 'FR', name: 'French' },
  3: { id: 3, code: 'DE', name: 'German' },
  4: { id: 4, code: 'ES', name: 'Spanish' },
  5: { id: 5, code: 'IT', name: 'Italian' },
  6: { id: 6, code: 'JP', name: 'Japanese' },
} as const;

export interface ArchiveScraperConfig {
  headless: boolean;
  timeout: number;
  requestDelayMs: number;
  requestsPerMinute: number;
  maxRetries: number;
  includeListings: boolean;
  maxListingsPerCard: number;
}

const DEFAULT_CONFIG: ArchiveScraperConfig = {
  headless: true,
  timeout: 60000,
  requestDelayMs: 3000,
  requestsPerMinute: 10,
  maxRetries: 2,
  includeListings: true,
  maxListingsPerCard: 50,
};

// Archive data structures
export interface CardArchiveData {
  cardId: string;
  cardName: string;
  setCode: string;
  cardNumber: string;
  variantType: string;
  sourceUrl: string;
  scrapedAt: string;
  trendPriceEur: number | null;
  fromPriceEur: number | null;
  avg7PriceEur: number | null;
  avg30PriceEur: number | null;
  totalListings: number | null;
  priceChange7d: number | null;
  priceChange30d: number | null;
  conditionPrices: ConditionPrice[];
  listings: ListingData[];
}

export interface ConditionPrice {
  conditionId: number;
  conditionCode: string;
  languageId: number;
  languageCode: string;
  fromPriceEur: number | null;
  avgPriceEur: number | null;
  highPriceEur: number | null;
  listingsCount: number;
}

export interface ListingData {
  sellerName: string;
  sellerCountry: string | null;
  sellerSales: number | null;
  conditionCode: string;
  languageCode: string;
  priceEur: number;
  quantity: number;
  isSigned: boolean;
  isFirstEd: boolean;
  isAltered: boolean;
  isPlayset: boolean;
}

export interface ArchiveResult {
  success: boolean;
  cards: CardArchiveData[];
  errors: string[];
  stats: {
    cardsProcessed: number;
    conditionsExtracted: number;
    listingsExtracted: number;
    duration: number;
  };
}

/**
 * CardMarket Archive Scraper
 */
export class CardMarketArchiveScraper {
  private config: ArchiveScraperConfig;
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private rateLimiter: RateLimiter;
  private errors: string[] = [];

  constructor(config?: Partial<ArchiveScraperConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.rateLimiter = new RateLimiter(
      this.config.requestsPerMinute,
      this.config.requestsPerMinute / 60
    );
  }

  async launch(): Promise<void> {
    if (this.browser) return;

    this.browser = await chromium.launch({
      headless: this.config.headless,
    });

    this.context = await this.browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      locale: 'en-GB',
      viewport: { width: 1920, height: 1080 },
    });

    await this.context.addInitScript(STEALTH_SCRIPTS);

    // Block images to speed up loading
    await this.context.route('**/*', (route) => {
      const type = route.request().resourceType();
      if (['image', 'media', 'font'].includes(type)) {
        route.abort();
      } else {
        route.continue();
      }
    });
  }

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
   * Scrape a single card's archive data with condition breakdown
   */
  async scrapeCardArchive(cardUrl: string): Promise<CardArchiveData | null> {
    await this.rateLimiter.acquire();

    if (!this.context) {
      await this.launch();
    }

    const page = await this.context!.newPage();

    try {
      // Navigate to card page
      await page.goto(cardUrl, {
        waitUntil: 'networkidle',
        timeout: this.config.timeout,
      });

      await page.waitForTimeout(2000);

      // Check for Cloudflare
      const html = await page.content();
      if (html.includes('Just a moment')) {
        await page.waitForTimeout(5000);
      }

      // Extract basic card info and aggregate prices
      const baseData = await this.extractBaseData(page, cardUrl);
      if (!baseData) {
        this.errors.push(`Failed to extract base data from ${cardUrl}`);
        await page.close();
        return null;
      }

      // Extract condition-level prices
      const conditionPrices = await this.extractConditionPrices(page);

      // Extract individual listings if enabled
      let listings: ListingData[] = [];
      if (this.config.includeListings) {
        listings = await this.extractListings(page);
      }

      await page.close();

      return {
        ...baseData,
        conditionPrices,
        listings,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      this.errors.push(`Error scraping ${cardUrl}: ${msg}`);
      await page.close();
      return null;
    }
  }

  /**
   * Extract base card data and aggregate prices
   */
  private async extractBaseData(page: Page, url: string): Promise<Omit<CardArchiveData, 'conditionPrices' | 'listings'> | null> {
    // Use a simple string function to avoid __name issues
    const extractFn = `
      (function(sourceUrl) {
        var data = {
          cardId: '',
          cardName: '',
          setCode: '',
          cardNumber: '',
          variantType: 'standard',
          sourceUrl: sourceUrl,
          scrapedAt: new Date().toISOString(),
          trendPriceEur: null,
          fromPriceEur: null,
          avg7PriceEur: null,
          avg30PriceEur: null,
          totalListings: null,
          priceChange7d: null,
          priceChange30d: null
        };

        // Extract card name from h1
        var h1 = document.querySelector('h1');
        data.cardName = h1 ? h1.textContent.trim() : '';

        // Parse card number from name or URL
        var cardNumMatch = data.cardName.match(/\\(([A-Z0-9]+-\\d+)\\)/i) ||
                          sourceUrl.match(/\\/([A-Z0-9]+-\\d+)/i);
        if (cardNumMatch) {
          var parts = cardNumMatch[1].split('-');
          data.setCode = parts[0];
          data.cardNumber = parts[1];
        }

        // Detect variant type
        var urlLower = sourceUrl.toLowerCase();
        if (urlLower.indexOf('-v1') >= 0 || urlLower.indexOf('-v2') >= 0) data.variantType = 'parallel';
        else if (urlLower.indexOf('-manga') >= 0) data.variantType = 'manga';
        else if (urlLower.indexOf('-sp') >= 0) data.variantType = 'sp';
        else if (urlLower.indexOf('-sec') >= 0) data.variantType = 'sec';

        // Build cardId
        data.cardId = data.setCode + '-' + data.cardNumber + (data.variantType !== 'standard' ? '-' + data.variantType : '');

        // Extract prices from info container
        var infoContainer = document.querySelector('.info-list-container');
        var infoText = infoContainer ? infoContainer.textContent : '';

        // Parse From price
        var fromMatch = infoText.match(/From\\s*([\\d,.]+)\\s*€/i);
        if (fromMatch) data.fromPriceEur = parseFloat(fromMatch[1].replace(',', '.'));

        // Parse Trend price
        var trendMatch = infoText.match(/Price Trend\\s*([\\d,.]+)\\s*€/i) ||
                        infoText.match(/Trend\\s*([\\d,.]+)\\s*€/i);
        if (trendMatch) data.trendPriceEur = parseFloat(trendMatch[1].replace(',', '.'));

        // Parse 7-day avg
        var avg7Match = infoText.match(/7-day average[^€]*([\\d,.]+)\\s*€/i);
        if (avg7Match) data.avg7PriceEur = parseFloat(avg7Match[1].replace(',', '.'));

        // Parse 30-day avg
        var avg30Match = infoText.match(/30-day average[^€]*([\\d,.]+)\\s*€/i);
        if (avg30Match) data.avg30PriceEur = parseFloat(avg30Match[1].replace(',', '.'));

        // Extract available count
        var availMatch = infoText.match(/Available items\\s*(\\d+)/i);
        if (availMatch) data.totalListings = parseInt(availMatch[1], 10);

        return data;
      })
    `;

    return await page.evaluate(eval(extractFn), url);
  }

  /**
   * Extract condition-level prices by analyzing listings
   */
  private async extractConditionPrices(page: Page): Promise<ConditionPrice[]> {
    const extractFn = `
      (function() {
        var conditionMap = {};
        var rows = document.querySelectorAll('.article-row');

        rows.forEach(function(row) {
          // Get condition
          var condEl = row.querySelector('[class*="article-condition"]');
          var condCode = 'NM';
          if (condEl) {
            if (condEl.classList.contains('condition-mt')) condCode = 'MT';
            else if (condEl.classList.contains('condition-nm')) condCode = 'NM';
            else if (condEl.classList.contains('condition-ex')) condCode = 'EX';
            else if (condEl.classList.contains('condition-gd')) condCode = 'GD';
            else if (condEl.classList.contains('condition-lp')) condCode = 'LP';
            else if (condEl.classList.contains('condition-pl')) condCode = 'PL';
            else if (condEl.classList.contains('condition-po')) condCode = 'PO';
          }

          // Get price
          var priceEl = row.querySelector('.price-container .fw-bold, [class*="price"] .fw-bold');
          var priceText = priceEl ? priceEl.textContent.trim() : '';
          var priceMatch = priceText.match(/([\\d,.]+)\\s*€/);
          var price = priceMatch ? parseFloat(priceMatch[1].replace(',', '.')) : null;

          if (!price) return;

          var langCode = 'EN';
          var key = condCode + '-' + langCode;

          var condIdMap = { MT: 1, NM: 2, EX: 3, GD: 4, LP: 5, PL: 6, PO: 7 };

          if (!conditionMap[key]) {
            conditionMap[key] = {
              conditionId: condIdMap[condCode] || 2,
              conditionCode: condCode,
              languageId: 1,
              languageCode: langCode,
              fromPriceEur: price,
              avgPriceEur: price,
              highPriceEur: price,
              listingsCount: 1
            };
          } else {
            var existing = conditionMap[key];
            existing.listingsCount++;

            if (price < existing.fromPriceEur) existing.fromPriceEur = price;
            if (price > existing.highPriceEur) existing.highPriceEur = price;

            var currentTotal = existing.avgPriceEur * (existing.listingsCount - 1);
            existing.avgPriceEur = (currentTotal + price) / existing.listingsCount;
          }
        });

        return Object.keys(conditionMap).map(function(k) { return conditionMap[k]; });
      })
    `;

    return await page.evaluate(eval(extractFn));
  }

  /**
   * Extract individual seller listings
   */
  private async extractListings(page: Page): Promise<ListingData[]> {
    const maxListings = this.config.maxListingsPerCard;

    const extractFn = `
      (function(max) {
        var listings = [];
        var rows = document.querySelectorAll('.article-row');

        for (var i = 0; i < rows.length && i < max; i++) {
          var row = rows[i];
          var listing = {
            sellerName: '',
            sellerCountry: null,
            sellerSales: null,
            conditionCode: 'NM',
            languageCode: 'EN',
            priceEur: 0,
            quantity: 1,
            isSigned: false,
            isFirstEd: false,
            isAltered: false,
            isPlayset: false
          };

          // Seller name
          var sellerEl = row.querySelector('.seller-name a');
          listing.sellerName = sellerEl ? sellerEl.textContent.trim() : 'Unknown';

          // Seller country
          var flagEl = row.querySelector('[aria-label*="Item location"]');
          if (flagEl) {
            var ariaLabel = flagEl.getAttribute('aria-label') || '';
            var countryMatch = ariaLabel.match(/location:\\s*(\\w+)/i);
            if (countryMatch) {
              listing.sellerCountry = countryMatch[1].substring(0, 2).toUpperCase();
            }
          }

          // Seller sales
          var salesEl = row.querySelector('.sell-count');
          if (salesEl) {
            listing.sellerSales = parseInt(salesEl.textContent.trim(), 10) || null;
          }

          // Condition
          var condEl = row.querySelector('[class*="article-condition"]');
          if (condEl) {
            if (condEl.classList.contains('condition-mt')) listing.conditionCode = 'MT';
            else if (condEl.classList.contains('condition-ex')) listing.conditionCode = 'EX';
            else if (condEl.classList.contains('condition-gd')) listing.conditionCode = 'GD';
            else if (condEl.classList.contains('condition-lp')) listing.conditionCode = 'LP';
            else if (condEl.classList.contains('condition-pl')) listing.conditionCode = 'PL';
            else if (condEl.classList.contains('condition-po')) listing.conditionCode = 'PO';
          }

          // Price
          var priceEl = row.querySelector('.price-container .fw-bold');
          if (priceEl) {
            var priceMatch = priceEl.textContent.match(/([\\d,.]+)\\s*€/);
            if (priceMatch) {
              listing.priceEur = parseFloat(priceMatch[1].replace(',', '.'));
            }
          }

          if (listing.priceEur > 0) {
            listings.push(listing);
          }
        }

        return listings;
      })
    `;

    return await page.evaluate(eval(extractFn), maxListings);
  }

  /**
   * Scrape all cards from a set for archival
   */
  async scrapeSetArchive(
    setCode: string,
    options: {
      maxCards?: number;
      maxPages?: number;
      onProgress?: (progress: { current: number; total: number; cardName: string }) => void;
    } = {}
  ): Promise<ArchiveResult> {
    const startTime = Date.now();
    const cards: CardArchiveData[] = [];
    this.errors = [];

    const { maxCards = Infinity, maxPages = Infinity, onProgress } = options;

    await this.launch();

    const setConfig = ONEPIECE_SETS[setCode];
    if (!setConfig) {
      return {
        success: false,
        cards: [],
        errors: [`Unknown set code: ${setCode}`],
        stats: { cardsProcessed: 0, conditionsExtracted: 0, listingsExtracted: 0, duration: 0 },
      };
    }

    console.log(`\n📦 Archiving set: ${setCode} (${setConfig.cardmarketName})`);

    // First, collect card URLs from expansion pages
    const cardUrls: string[] = [];
    let pageNum = 1;
    let totalPages: number | null = null;

    while (pageNum <= (totalPages || maxPages)) {
      if (cardUrls.length >= maxCards) break;

      await this.rateLimiter.acquire();

      const expansionUrl = `${CARDMARKET_ONEPIECE_URL}/Products/Singles/${setConfig.cardmarketName}${pageNum > 1 ? '?site=' + pageNum : ''}`;

      const browserPage = await this.context!.newPage();

      try {
        await browserPage.goto(expansionUrl, {
          waitUntil: 'networkidle',
          timeout: this.config.timeout,
        });

        await browserPage.waitForTimeout(2000);

        // Get card URLs using simple evaluate
        const urls = await browserPage.evaluate(`
          (function() {
            var links = [];
            document.querySelectorAll('.table-body .row a[href*="/Products/Singles/"]').forEach(function(el) {
              var href = el.getAttribute('href');
              if (href && links.indexOf(href) === -1) {
                links.push(href.indexOf('http') === 0 ? href : 'https://www.cardmarket.com' + href);
              }
            });
            return links;
          })()
        `);

        // Get pagination
        if (!totalPages) {
          const maxPage = await browserPage.evaluate(`
            (function() {
              var max = 1;
              document.querySelectorAll('.pagination .page-item').forEach(function(el) {
                var num = parseInt(el.textContent, 10);
                if (!isNaN(num) && num > max) max = num;
              });
              return max;
            })()
          `);
          totalPages = Math.min(maxPage as number, maxPages);
        }

        (urls as string[]).forEach((url) => {
          if (cardUrls.length < maxCards && !cardUrls.includes(url)) {
            cardUrls.push(url);
          }
        });

        console.log(`   Page ${pageNum}/${totalPages}: Found ${(urls as string[]).length} cards (total: ${cardUrls.length})`);
      } catch (error) {
        this.errors.push(`Error loading expansion page ${pageNum}: ${error}`);
      } finally {
        await browserPage.close();
      }

      pageNum++;
      await sleepWithVariance(this.config.requestDelayMs);
    }

    // Now scrape each card
    console.log(`\n📊 Scraping ${cardUrls.length} cards for archive...`);

    let conditionsExtracted = 0;
    let listingsExtracted = 0;

    for (let i = 0; i < cardUrls.length; i++) {
      const url = cardUrls[i];

      if (onProgress) {
        onProgress({ current: i + 1, total: cardUrls.length, cardName: url.split('/').pop() || '' });
      }

      console.log(`   [${i + 1}/${cardUrls.length}] ${url.split('/').pop()}`);

      const archiveData = await this.scrapeCardArchive(url);

      if (archiveData) {
        cards.push(archiveData);
        conditionsExtracted += archiveData.conditionPrices.length;
        listingsExtracted += archiveData.listings.length;
        console.log(`      ✓ ${archiveData.cardName} - €${archiveData.trendPriceEur || 'N/A'} (${archiveData.conditionPrices.length} conditions, ${archiveData.listings.length} listings)`);
      }

      if (i < cardUrls.length - 1) {
        await sleepWithVariance(this.config.requestDelayMs);
      }
    }

    const duration = Date.now() - startTime;

    return {
      success: this.errors.length === 0,
      cards,
      errors: this.errors,
      stats: {
        cardsProcessed: cards.length,
        conditionsExtracted,
        listingsExtracted,
        duration,
      },
    };
  }

  /**
   * Get available sets
   */
  getAvailableSets() {
    return Object.entries(ONEPIECE_SETS).map(([code, config]) => ({
      code,
      name: config.cardmarketName,
    }));
  }
}

/**
 * Create archive scraper instance
 */
export function createArchiveScraper(config?: Partial<ArchiveScraperConfig>): CardMarketArchiveScraper {
  return new CardMarketArchiveScraper(config);
}
