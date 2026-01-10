/**
 * Cardmarket Scraper
 *
 * Main orchestration class for scraping Cardmarket.
 * Combines HTTP client, HTML parser, rate limiting, and data extraction.
 */

import {
  CARDMARKET_BASE_URL,
  CARDMARKET_ONEPIECE_URL,
  ONEPIECE_SETS,
  type SetConfig,
  DEFAULT_SCRAPER_CONFIG,
  type ScraperConfig,
} from '../config/index.js';
import { type ProxyConfig } from '../config/proxy.js';
import {
  CardmarketHtmlParser,
  type ParsedProduct,
  type ParsedCardDetails,
  type ParsedArticle,
  type ParserStats,
} from '../parsers/html-parser.js';
import {
  HttpClient,
  type HttpResponse,
  type RequestStats,
} from './http-client.js';
import {
  RateLimiter,
  sleepWithVariance,
  nowIso,
  normalizeCardId,
} from '../utils/index.js';

/**
 * Scraped card data with metadata
 */
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

/**
 * Scraped article (seller listing)
 */
export interface ScrapedArticle extends ParsedArticle {
  cardId: string;
  sourceUrl: string;
  scrapedAt: string;
}

/**
 * Scraper run result
 */
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
    requestStats: RequestStats;
    parserStats: ParserStats;
  };
}

/**
 * Scraper options
 */
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
 * Progress callback data
 */
export interface ScrapeProgress {
  currentSet: string;
  currentPage: number;
  totalPages: number | null;
  cardsScraped: number;
  articlesScraped: number;
  errorsCount: number;
}

/**
 * Main Cardmarket scraper class
 */
export class CardmarketScraper {
  private httpClient: HttpClient;
  private parser: CardmarketHtmlParser;
  private rateLimiter: RateLimiter;
  private config: ScraperConfig;
  private errors: string[] = [];

  constructor(
    scraperConfig?: Partial<ScraperConfig>,
    proxyConfig?: Partial<ProxyConfig>
  ) {
    this.config = { ...DEFAULT_SCRAPER_CONFIG, ...scraperConfig };
    this.httpClient = new HttpClient(scraperConfig, proxyConfig);
    this.parser = new CardmarketHtmlParser();
    this.rateLimiter = new RateLimiter(
      this.config.requestsPerMinute,
      this.config.requestsPerMinute / 60
    );
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
   * Scrape a single expansion page
   */
  private async scrapeExpansionPage(
    setCode: string,
    page: number
  ): Promise<{ products: ParsedProduct[]; totalPages: number | null }> {
    await this.rateLimiter.acquire();

    const url = this.buildExpansionUrl(setCode, page);
    const response = await this.httpClient.fetch(url, {
      proxySessionKey: `expansion-${setCode}`,
    });

    if (response.status !== 200) {
      this.errors.push(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
      return { products: [], totalPages: null };
    }

    if (this.parser.isBlocked(response.body)) {
      this.errors.push(`Blocked while fetching ${url}`);
      return { products: [], totalPages: null };
    }

    const products = this.parser.parseExpansionPage(response.body, CARDMARKET_BASE_URL);
    const pagination = this.parser.extractPagination(response.body);

    return {
      products,
      totalPages: pagination?.totalPages ?? null,
    };
  }

  /**
   * Scrape card detail page
   */
  private async scrapeCardDetail(
    url: string,
    setCode: string
  ): Promise<{ card: ScrapedCard | null; articles: ScrapedArticle[] }> {
    await this.rateLimiter.acquire();

    const response = await this.httpClient.fetch(url, {
      proxySessionKey: `card-${setCode}`,
    });

    if (response.status !== 200) {
      this.errors.push(`Failed to fetch card detail ${url}: ${response.status}`);
      return { card: null, articles: [] };
    }

    if (this.parser.isBlocked(response.body)) {
      this.errors.push(`Blocked while fetching card detail ${url}`);
      return { card: null, articles: [] };
    }

    const details = this.parser.parseCardDetailPage(response.body);
    if (!details) {
      this.errors.push(`Failed to parse card detail from ${url}`);
      return { card: null, articles: [] };
    }

    // Build card ID
    const cardId = normalizeCardId(
      details.setCode || setCode,
      details.cardNumber || '000',
      details.variantType
    );

    const card: ScrapedCard = {
      cardId,
      name: details.name,
      setCode: details.setCode || setCode,
      cardNumber: details.cardNumber || '000',
      variantType: details.variantType,
      rarity: details.rarity,
      imageUrl: details.imageUrl,
      trendPrice: details.trendPrice,
      lowPrice: details.lowPrice,
      avg7Price: details.avg7Price,
      avg30Price: details.avg30Price,
      availableCount: details.availableCount,
      priceChange7d: details.priceChange7d,
      priceChange30d: details.priceChange30d,
      sourceUrl: url,
      scrapedAt: nowIso(),
    };

    // Parse articles
    const parsedArticles = this.parser.parseArticles(response.body);
    const articles: ScrapedArticle[] = parsedArticles.map((article) => ({
      ...article,
      cardId,
      sourceUrl: url,
      scrapedAt: nowIso(),
    }));

    return { card, articles };
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

    const {
      includeArticles = true,
      maxCardsPerSet = Infinity,
      maxPagesPerSet = Infinity,
      startPage = 1,
      delayBetweenRequests = this.config.requestDelayMs,
      onProgress,
    } = options;

    let page = startPage;
    let totalPages: number | null = null;
    let pagesProcessed = 0;
    const seenUrls = new Set<string>();

    // First, get all product URLs from expansion pages
    const productUrls: string[] = [];

    while (page <= (totalPages || maxPagesPerSet)) {
      if (productUrls.length >= maxCardsPerSet) break;

      const result = await this.scrapeExpansionPage(setCode, page);
      pagesProcessed++;

      if (result.totalPages && !totalPages) {
        totalPages = Math.min(result.totalPages, maxPagesPerSet);
      }

      // Collect unique URLs
      for (const product of result.products) {
        if (!seenUrls.has(product.url) && productUrls.length < maxCardsPerSet) {
          seenUrls.add(product.url);
          productUrls.push(product.url);
        }
      }

      // Report progress
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

      // Delay between pages
      if (page <= (totalPages || maxPagesPerSet)) {
        await sleepWithVariance(delayBetweenRequests);
      }
    }

    // Now scrape individual card details
    for (let i = 0; i < productUrls.length; i++) {
      const url = productUrls[i];

      const result = await this.scrapeCardDetail(url, setCode);

      if (result.card) {
        cards.push(result.card);
      }

      if (includeArticles && result.articles.length > 0) {
        articles.push(...result.articles);
      }

      // Report progress
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

      // Delay between card requests
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
        requestStats: this.httpClient.getStats(),
        parserStats: this.parser.getStats(),
      },
    };
  }

  /**
   * Scrape multiple sets
   */
  async scrapeSets(options: ScraperOptions = {}): Promise<ScrapeResult> {
    const startTime = Date.now();
    const allCards: ScrapedCard[] = [];
    const allArticles: ScrapedArticle[] = [];
    const allErrors: string[] = [];
    let totalPagesProcessed = 0;

    const {
      sets = Object.keys(ONEPIECE_SETS),
      delayBetweenSets = 10000,
      onProgress,
      ...setOptions
    } = options;

    for (let i = 0; i < sets.length; i++) {
      const setCode = sets[i];

      // Check if set exists
      if (!ONEPIECE_SETS[setCode]) {
        allErrors.push(`Unknown set code: ${setCode}`);
        continue;
      }

      const result = await this.scrapeSet(setCode, {
        ...setOptions,
        onProgress,
      });

      allCards.push(...result.cards);
      allArticles.push(...result.articles);
      allErrors.push(...result.errors);
      totalPagesProcessed += result.stats.pagesProcessed;

      // Delay between sets
      if (i < sets.length - 1) {
        await sleepWithVariance(delayBetweenSets);
      }
    }

    const duration = Date.now() - startTime;

    return {
      success: allErrors.length === 0,
      cards: allCards,
      articles: allArticles,
      errors: allErrors,
      stats: {
        cardsScraped: allCards.length,
        articlesScraped: allArticles.length,
        pagesProcessed: totalPagesProcessed,
        duration,
        requestStats: this.httpClient.getStats(),
        parserStats: this.parser.getStats(),
      },
    };
  }

  /**
   * Scrape a single card by URL
   */
  async scrapeCard(
    url: string,
    options: { includeArticles?: boolean } = {}
  ): Promise<{ card: ScrapedCard | null; articles: ScrapedArticle[]; error: string | null }> {
    this.errors = [];
    this.parser.resetStats();

    // Extract set code from URL
    const setMatch = url.match(/\/Products\/Singles\/([^/]+)/);
    const setCode = setMatch ? this.getSetCodeFromCardmarketName(setMatch[1]) : 'UNKNOWN';

    const result = await this.scrapeCardDetail(url, setCode);

    return {
      card: result.card,
      articles: options.includeArticles !== false ? result.articles : [],
      error: this.errors.length > 0 ? this.errors[0] : null,
    };
  }

  /**
   * Get set code from Cardmarket expansion name
   */
  private getSetCodeFromCardmarketName(cardmarketName: string): string {
    for (const [code, config] of Object.entries(ONEPIECE_SETS)) {
      if (config.cardmarketName === cardmarketName) {
        return code;
      }
    }
    return 'UNKNOWN';
  }

  /**
   * Test connectivity to Cardmarket
   */
  async testConnection(): Promise<{ success: boolean; message: string; latency: number }> {
    const startTime = Date.now();

    try {
      const response = await this.httpClient.fetch(CARDMARKET_ONEPIECE_URL, {
        retries: 1,
      });

      const latency = Date.now() - startTime;

      if (response.status === 200) {
        if (this.parser.isBlocked(response.body)) {
          return {
            success: false,
            message: 'Connection successful but access is blocked',
            latency,
          };
        }

        if (this.parser.isValidCardmarketPage(response.body)) {
          return {
            success: true,
            message: 'Connection successful',
            latency,
          };
        }

        return {
          success: false,
          message: 'Response received but does not appear to be Cardmarket',
          latency,
        };
      }

      return {
        success: false,
        message: `Connection failed with status ${response.status}`,
        latency,
      };
    } catch (error) {
      return {
        success: false,
        message: `Connection error: ${error instanceof Error ? error.message : 'Unknown error'}`,
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
   * Get HTTP client stats
   */
  getRequestStats(): RequestStats {
    return this.httpClient.getStats();
  }

  /**
   * Get parser stats
   */
  getParserStats(): ParserStats {
    return this.parser.getStats();
  }

  /**
   * Reset all stats and state
   */
  reset(): void {
    this.httpClient.resetStats();
    this.httpClient.clearCookies();
    this.httpClient.clearProxySessions();
    this.parser.resetStats();
    this.errors = [];
  }
}

/**
 * Create a configured scraper instance
 */
export function createScraper(
  scraperConfig?: Partial<ScraperConfig>,
  proxyConfig?: Partial<ProxyConfig>
): CardmarketScraper {
  return new CardmarketScraper(scraperConfig, proxyConfig);
}
