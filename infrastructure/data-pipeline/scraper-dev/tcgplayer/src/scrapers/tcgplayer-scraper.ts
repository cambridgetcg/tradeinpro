/**
 * TCGplayer Direct Scraper
 *
 * Fallback scraper for when APIs are unavailable.
 * Uses Playwright with stealth mode to bypass BWSTATE anti-bot protection.
 */

import { PlaywrightClient, createPlaywrightClient, type NavigationResult } from '../browser/playwright-client.js';
import { CircuitBreaker } from '../resilience/circuit-breaker.js';
import { getGameConfig, type GameCode } from '../config/games.js';
import {
  type NormalizedCard,
  type NormalizedSet,
  CurrencyConverter,
} from '../apis/base-client.js';
import * as cheerio from 'cheerio';

/**
 * Scraped price data
 */
export interface ScrapedPrice {
  marketPrice?: number;
  lowPrice?: number;
  midPrice?: number;
  highPrice?: number;
  foilMarketPrice?: number;
  foilLowPrice?: number;
}

/**
 * Scraped card data
 */
export interface ScrapedCard {
  tcgplayerProductId: string;
  name: string;
  setName: string;
  cardNumber?: string;
  rarity?: string;
  prices: ScrapedPrice;
  imageUrl?: string;
  productUrl: string;
  scrapedAt: Date;
}

/**
 * Scraper configuration
 */
export interface ScraperConfig {
  headless: boolean;
  timeout: number;
  requestDelay: number;
  maxRetries: number;
  screenshotsOnError: boolean;
  proxy?: {
    server: string;
    username?: string;
    password?: string;
  };
}

const DEFAULT_CONFIG: ScraperConfig = {
  headless: true,
  timeout: 60000,
  requestDelay: 3000,
  maxRetries: 3,
  screenshotsOnError: true,
};

/**
 * TCGplayer URL builder
 */
export class TcgplayerUrlBuilder {
  private static BASE_URL = 'https://www.tcgplayer.com';

  /**
   * Build product search URL for a game
   */
  static searchUrl(game: GameCode, setSlug?: string, page: number = 1): string {
    const gameConfig = getGameConfig(game);
    if (!gameConfig) {
      throw new Error(`Unknown game: ${game}`);
    }

    let url = `${this.BASE_URL}/search/${gameConfig.tcgplayerName}`;
    if (setSlug) {
      url += `/${setSlug}`;
    }

    const params = new URLSearchParams({
      productLineName: gameConfig.tcgplayerName,
      view: 'grid',
      page: String(page),
    });

    if (setSlug) {
      params.set('setName', setSlug);
    }

    return `${url}?${params.toString()}`;
  }

  /**
   * Build price guide URL for a set
   */
  static priceGuideUrl(game: GameCode, setSlug: string): string {
    const gameConfig = getGameConfig(game);
    if (!gameConfig) {
      throw new Error(`Unknown game: ${game}`);
    }

    return `${this.BASE_URL}/categories/trading-and-collectible-card-games/${gameConfig.tcgplayerName}/price-guides/${setSlug}`;
  }

  /**
   * Build individual product URL
   */
  static productUrl(productId: string, slug: string): string {
    return `${this.BASE_URL}/product/${productId}/${slug}`;
  }
}

/**
 * TCGplayer HTML Parser
 */
export class TcgplayerParser {
  /**
   * Parse price from text (handles $X.XX format)
   */
  static parsePrice(text: string | undefined): number | undefined {
    if (!text) return undefined;
    const match = text.match(/\$?([\d,]+\.?\d*)/);
    if (match) {
      return parseFloat(match[1].replace(',', ''));
    }
    return undefined;
  }

  /**
   * Parse search results page
   */
  static parseSearchResults(html: string, productUrl: string): ScrapedCard[] {
    const $ = cheerio.load(html);
    const cards: ScrapedCard[] = [];

    // TCGplayer uses different selectors based on view mode
    // Grid view items
    $('.search-result').each((_, element) => {
      const $el = $(element);

      const productLink = $el.find('a[href*="/product/"]').first();
      const href = productLink.attr('href') || '';
      const productIdMatch = href.match(/\/product\/(\d+)/);

      if (!productIdMatch) return;

      const name = $el.find('.search-result__title, .product-card__name').text().trim();
      const setName = $el.find('.search-result__subtitle, .product-card__set').text().trim();

      // Price extraction
      const priceText = $el.find('.inventory__price-with-shipping, .price-guide__price').text();
      const marketPrice = this.parsePrice(priceText);

      const imageUrl = $el.find('img').attr('src') || $el.find('img').attr('data-src');

      if (name) {
        cards.push({
          tcgplayerProductId: productIdMatch[1],
          name,
          setName,
          prices: { marketPrice },
          imageUrl,
          productUrl: `https://www.tcgplayer.com${href}`,
          scrapedAt: new Date(),
        });
      }
    });

    // Alternative selector for list view
    if (cards.length === 0) {
      $('[data-testid="product-card"], .product-card').each((_, element) => {
        const $el = $(element);

        const productLink = $el.find('a[href*="/product/"]').first();
        const href = productLink.attr('href') || '';
        const productIdMatch = href.match(/\/product\/(\d+)/);

        if (!productIdMatch) return;

        const name = $el.find('[data-testid="product-name"]').text().trim() ||
                     $el.find('.product-card__name').text().trim();

        const priceEl = $el.find('[data-testid="product-price"]').first() ||
                       $el.find('.product-card__price').first();
        const marketPrice = this.parsePrice(priceEl.text());

        if (name) {
          cards.push({
            tcgplayerProductId: productIdMatch[1],
            name,
            setName: '',
            prices: { marketPrice },
            productUrl: href.startsWith('http') ? href : `https://www.tcgplayer.com${href}`,
            scrapedAt: new Date(),
          });
        }
      });
    }

    return cards;
  }

  /**
   * Parse price guide page
   */
  static parsePriceGuide(html: string): ScrapedCard[] {
    const $ = cheerio.load(html);
    const cards: ScrapedCard[] = [];

    // Price guide tables have different structure
    $('tr[data-testid="price-guide-row"], .price-guide__row').each((_, element) => {
      const $row = $(element);

      const productLink = $row.find('a[href*="/product/"]').first();
      const href = productLink.attr('href') || '';
      const productIdMatch = href.match(/\/product\/(\d+)/);

      if (!productIdMatch) return;

      const name = $row.find('td:first-child, .price-guide__name').text().trim();

      // TCGplayer price guide shows multiple price points
      const cells = $row.find('td');
      const prices: ScrapedPrice = {
        marketPrice: this.parsePrice(cells.eq(1).text()),
        lowPrice: this.parsePrice(cells.eq(2).text()),
        midPrice: this.parsePrice(cells.eq(3).text()),
        highPrice: this.parsePrice(cells.eq(4).text()),
      };

      if (name) {
        cards.push({
          tcgplayerProductId: productIdMatch[1],
          name,
          setName: '',
          prices,
          productUrl: `https://www.tcgplayer.com${href}`,
          scrapedAt: new Date(),
        });
      }
    });

    return cards;
  }

  /**
   * Parse individual product page for detailed pricing
   */
  static parseProductPage(html: string, productId: string, url: string): ScrapedCard | null {
    const $ = cheerio.load(html);

    const name = $('h1[data-testid="product-name"], .product-details__name').text().trim();
    if (!name) return null;

    const setName = $('[data-testid="product-set"], .product-details__set').text().trim();
    const cardNumber = $('[data-testid="product-number"]').text().trim();
    const rarity = $('[data-testid="product-rarity"]').text().trim();

    // Detailed price extraction
    const marketPriceEl = $('[data-testid="market-price"]');
    const lowPriceEl = $('[data-testid="low-price"]');
    const midPriceEl = $('[data-testid="mid-price"]');
    const highPriceEl = $('[data-testid="high-price"]');

    const prices: ScrapedPrice = {
      marketPrice: this.parsePrice(marketPriceEl.text()),
      lowPrice: this.parsePrice(lowPriceEl.text()),
      midPrice: this.parsePrice(midPriceEl.text()),
      highPrice: this.parsePrice(highPriceEl.text()),
    };

    // Check for foil prices
    const foilMarketEl = $('[data-testid="foil-market-price"]');
    if (foilMarketEl.length) {
      prices.foilMarketPrice = this.parsePrice(foilMarketEl.text());
    }

    const imageUrl = $('img[data-testid="product-image"]').attr('src');

    return {
      tcgplayerProductId: productId,
      name,
      setName,
      cardNumber,
      rarity,
      prices,
      imageUrl,
      productUrl: url,
      scrapedAt: new Date(),
    };
  }

  /**
   * Check if page indicates blocking/challenge
   */
  static isBlocked(html: string): boolean {
    return html.includes('Access Denied') ||
           html.includes('human-test') ||
           html.includes('captcha') ||
           html.includes('blocked') ||
           html.length < 1000; // Suspiciously short response
  }
}

/**
 * TCGplayer Direct Scraper
 */
export class TcgplayerScraper {
  private client: PlaywrightClient;
  private circuitBreaker: CircuitBreaker;
  private config: ScraperConfig;
  private game: GameCode;

  private stats = {
    pagesScraped: 0,
    cardsFound: 0,
    errors: 0,
    blocksDetected: 0,
  };

  constructor(game: GameCode, config?: Partial<ScraperConfig>) {
    this.game = game;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.client = createPlaywrightClient({
      headless: this.config.headless,
      timeout: this.config.timeout,
      proxy: this.config.proxy,
      stealth: true,
    });
    this.circuitBreaker = new CircuitBreaker('tcgplayer', {
      failureThreshold: 3,
      timeout: 120000, // 2 minutes
    });
  }

  /**
   * Initialize the scraper
   */
  async init(): Promise<void> {
    await this.client.launch();
  }

  /**
   * Close the scraper
   */
  async close(): Promise<void> {
    await this.client.close();
  }

  /**
   * Sleep between requests
   */
  private async sleep(ms: number = this.config.requestDelay): Promise<void> {
    // Add random variance (±30%)
    const variance = ms * 0.3;
    const actualDelay = ms + (Math.random() * variance * 2 - variance);
    await new Promise((resolve) => setTimeout(resolve, actualDelay));
  }

  /**
   * Scrape search results for a set
   */
  async scrapeSet(setSlug: string, maxPages: number = 10): Promise<ScrapedCard[]> {
    const allCards: ScrapedCard[] = [];

    for (let page = 1; page <= maxPages; page++) {
      if (!this.circuitBreaker.canRequest()) {
        console.log('Circuit breaker open, waiting...');
        await this.sleep(60000);
        continue;
      }

      const url = TcgplayerUrlBuilder.searchUrl(this.game, setSlug, page);
      console.log(`Scraping page ${page}: ${url}`);

      const result = await this.client.navigateWithRetry(url, {
        waitForSelector: '.search-result, [data-testid="product-card"]',
        maxRetries: this.config.maxRetries,
      });

      if (!result.success || result.blocked) {
        this.circuitBreaker.recordFailure();
        this.stats.blocksDetected++;
        this.stats.errors++;
        console.error(`Page ${page} blocked or failed`);
        break;
      }

      this.circuitBreaker.recordSuccess();
      const cards = TcgplayerParser.parseSearchResults(result.html, url);

      if (cards.length === 0) {
        // No more results
        break;
      }

      allCards.push(...cards);
      this.stats.pagesScraped++;
      this.stats.cardsFound += cards.length;

      console.log(`Found ${cards.length} cards on page ${page}`);
      await this.sleep();
    }

    return allCards;
  }

  /**
   * Scrape price guide for a set
   */
  async scrapePriceGuide(setSlug: string): Promise<ScrapedCard[]> {
    if (!this.circuitBreaker.canRequest()) {
      throw new Error('Circuit breaker open');
    }

    const url = TcgplayerUrlBuilder.priceGuideUrl(this.game, setSlug);
    console.log(`Scraping price guide: ${url}`);

    const result = await this.client.navigateWithRetry(url, {
      waitForSelector: '.price-guide__row, [data-testid="price-guide-row"]',
      maxRetries: this.config.maxRetries,
    });

    if (!result.success || result.blocked) {
      this.circuitBreaker.recordFailure();
      this.stats.blocksDetected++;
      throw new Error('Price guide scrape failed or blocked');
    }

    this.circuitBreaker.recordSuccess();
    const cards = TcgplayerParser.parsePriceGuide(result.html);

    this.stats.pagesScraped++;
    this.stats.cardsFound += cards.length;

    return cards;
  }

  /**
   * Scrape individual product page
   */
  async scrapeProduct(productId: string, slug: string): Promise<ScrapedCard | null> {
    if (!this.circuitBreaker.canRequest()) {
      throw new Error('Circuit breaker open');
    }

    const url = TcgplayerUrlBuilder.productUrl(productId, slug);
    console.log(`Scraping product: ${url}`);

    const result = await this.client.navigateWithRetry(url, {
      waitForSelector: '[data-testid="product-name"], .product-details__name',
      maxRetries: this.config.maxRetries,
    });

    if (!result.success || result.blocked) {
      this.circuitBreaker.recordFailure();
      this.stats.blocksDetected++;
      return null;
    }

    this.circuitBreaker.recordSuccess();
    const card = TcgplayerParser.parseProductPage(result.html, productId, url);

    if (card) {
      this.stats.pagesScraped++;
      this.stats.cardsFound++;
    }

    return card;
  }

  /**
   * Convert scraped cards to normalized format
   */
  normalizeCards(scrapedCards: ScrapedCard[]): NormalizedCard[] {
    return scrapedCards.map((card) => {
      const priceGbp = card.prices.marketPrice
        ? CurrencyConverter.usdToGbp(card.prices.marketPrice)
        : undefined;

      return {
        id: `tcgplayer-${card.tcgplayerProductId}`,
        game: this.game,
        name: card.name,
        setCode: card.setName,
        cardNumber: card.cardNumber || '',
        isVariant: false,
        priceUsd: card.prices.marketPrice,
        priceGbp,
        lowPriceUsd: card.prices.lowPrice,
        midPriceUsd: card.prices.midPrice,
        highPriceUsd: card.prices.highPrice,
        marketPriceUsd: card.prices.marketPrice,
        rarity: card.rarity,
        imageUrl: card.imageUrl,
        productUrl: card.productUrl,
        lastUpdated: card.scrapedAt,
        attributes: {
          tcgplayerProductId: card.tcgplayerProductId,
          foilMarketPrice: card.prices.foilMarketPrice,
          foilLowPrice: card.prices.foilLowPrice,
          source: 'scraper',
        },
      };
    });
  }

  /**
   * Get scraper statistics
   */
  getStats() {
    return {
      ...this.stats,
      clientStats: this.client.getStats(),
      circuitBreakerState: this.circuitBreaker.getState(),
    };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.stats = {
      pagesScraped: 0,
      cardsFound: 0,
      errors: 0,
      blocksDetected: 0,
    };
    this.client.resetStats();
    this.circuitBreaker.reset();
  }
}

/**
 * Create TCGplayer scraper instance
 */
export function createTcgplayerScraper(
  game: GameCode,
  config?: Partial<ScraperConfig>
): TcgplayerScraper {
  return new TcgplayerScraper(game, config);
}

export default TcgplayerScraper;
