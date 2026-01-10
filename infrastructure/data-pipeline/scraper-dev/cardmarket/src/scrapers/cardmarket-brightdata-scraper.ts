/**
 * CardMarket Archive Scraper using Bright Data Web Unlocker
 *
 * Uses Bright Data's API to bypass Cloudflare and scrape CardMarket.
 */

import * as cheerio from 'cheerio';
import { CARDMARKET_ONEPIECE_URL, ONEPIECE_SETS } from '../config/index.js';
import { RateLimiter, sleepWithVariance, nowIso } from '../utils/index.js';

// Condition mappings
export const CONDITIONS: Record<number, { id: number; code: string; name: string }> = {
  1: { id: 1, code: 'MT', name: 'Mint' },
  2: { id: 2, code: 'NM', name: 'Near Mint' },
  3: { id: 3, code: 'EX', name: 'Excellent' },
  4: { id: 4, code: 'GD', name: 'Good' },
  5: { id: 5, code: 'LP', name: 'Light Played' },
  6: { id: 6, code: 'PL', name: 'Played' },
  7: { id: 7, code: 'PO', name: 'Poor' },
};

export interface BrightDataConfig {
  apiToken: string;
  zone: string;
  requestDelayMs: number;
  requestsPerMinute: number;
  maxRetries: number;
  includeListings: boolean;
  maxListingsPerCard: number;
}

const DEFAULT_CONFIG: BrightDataConfig = {
  apiToken: '',
  zone: 'mcp_unlocker',
  requestDelayMs: 2000,
  requestsPerMinute: 20,
  maxRetries: 2,
  includeListings: true,
  maxListingsPerCard: 50,
};

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
 * Bright Data CardMarket Scraper
 */
export class BrightDataCardMarketScraper {
  private config: BrightDataConfig;
  private rateLimiter: RateLimiter;
  private errors: string[] = [];

  constructor(config: Partial<BrightDataConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    if (!this.config.apiToken) {
      throw new Error('Bright Data API token is required');
    }
    this.rateLimiter = new RateLimiter(
      this.config.requestsPerMinute,
      this.config.requestsPerMinute / 60
    );
  }

  /**
   * Fetch a URL using Bright Data Web Unlocker
   */
  private async fetchWithBrightData(url: string): Promise<string> {
    await this.rateLimiter.acquire();

    const response = await fetch('https://api.brightdata.com/request', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiToken}`,
      },
      body: JSON.stringify({
        zone: this.config.zone,
        url: url,
        format: 'raw',
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Bright Data API error: ${response.status} - ${error}`);
    }

    return await response.text();
  }

  /**
   * Parse card data from HTML
   */
  private parseCardPage(html: string, url: string): Omit<CardArchiveData, 'conditionPrices' | 'listings'> | null {
    const $ = cheerio.load(html);

    const data: Omit<CardArchiveData, 'conditionPrices' | 'listings'> = {
      cardId: '',
      cardName: '',
      setCode: '',
      cardNumber: '',
      variantType: 'standard',
      sourceUrl: url,
      scrapedAt: new Date().toISOString(),
      trendPriceEur: null,
      fromPriceEur: null,
      avg7PriceEur: null,
      avg30PriceEur: null,
      totalListings: null,
      priceChange7d: null,
      priceChange30d: null,
    };

    // Extract card name
    data.cardName = $('h1').first().text().trim();

    // Parse card number from name or URL
    const cardNumMatch = data.cardName.match(/\(([A-Z0-9]+-\d+)\)/i) || url.match(/\/([A-Z0-9]+-\d+)/i);
    if (cardNumMatch) {
      const parts = cardNumMatch[1].split('-');
      data.setCode = parts[0];
      data.cardNumber = parts[1];
    }

    // Detect variant type from URL
    const urlLower = url.toLowerCase();
    if (urlLower.includes('-v1') || urlLower.includes('-v2')) data.variantType = 'parallel';
    else if (urlLower.includes('-manga')) data.variantType = 'manga';
    else if (urlLower.includes('-sp')) data.variantType = 'sp';
    else if (urlLower.includes('-sec')) data.variantType = 'sec';

    // Build cardId
    data.cardId = `${data.setCode}-${data.cardNumber}${data.variantType !== 'standard' ? '-' + data.variantType : ''}`;

    // Extract prices from info container
    const infoText = $('.info-list-container').text();

    const fromMatch = infoText.match(/From\s*([\d,.]+)\s*€/i);
    if (fromMatch) data.fromPriceEur = parseFloat(fromMatch[1].replace(',', '.'));

    const trendMatch = infoText.match(/Price Trend\s*([\d,.]+)\s*€/i) || infoText.match(/Trend\s*([\d,.]+)\s*€/i);
    if (trendMatch) data.trendPriceEur = parseFloat(trendMatch[1].replace(',', '.'));

    const avg7Match = infoText.match(/7-day average[^€]*([\d,.]+)\s*€/i);
    if (avg7Match) data.avg7PriceEur = parseFloat(avg7Match[1].replace(',', '.'));

    const avg30Match = infoText.match(/30-day average[^€]*([\d,.]+)\s*€/i);
    if (avg30Match) data.avg30PriceEur = parseFloat(avg30Match[1].replace(',', '.'));

    const availMatch = infoText.match(/Available items\s*(\d+)/i);
    if (availMatch) data.totalListings = parseInt(availMatch[1], 10);

    return data;
  }

  /**
   * Parse condition prices from HTML
   */
  private parseConditionPrices(html: string): ConditionPrice[] {
    const $ = cheerio.load(html);
    const conditionMap: Record<string, ConditionPrice> = {};

    const condIdMap: Record<string, number> = { MT: 1, NM: 2, EX: 3, GD: 4, LP: 5, PL: 6, PO: 7 };

    $('.article-row').each((_, row) => {
      const $row = $(row);

      // Get condition
      let condCode = 'NM';
      const condEl = $row.find('[class*="article-condition"]');
      if (condEl.hasClass('condition-mt')) condCode = 'MT';
      else if (condEl.hasClass('condition-nm')) condCode = 'NM';
      else if (condEl.hasClass('condition-ex')) condCode = 'EX';
      else if (condEl.hasClass('condition-gd')) condCode = 'GD';
      else if (condEl.hasClass('condition-lp')) condCode = 'LP';
      else if (condEl.hasClass('condition-pl')) condCode = 'PL';
      else if (condEl.hasClass('condition-po')) condCode = 'PO';

      // Get price
      const priceText = $row.find('.price-container .fw-bold, [class*="price"] .fw-bold').first().text().trim();
      const priceMatch = priceText.match(/([\d,.]+)\s*€/);
      const price = priceMatch ? parseFloat(priceMatch[1].replace(',', '.')) : null;

      if (!price) return;

      const langCode = 'EN';
      const key = `${condCode}-${langCode}`;

      if (!conditionMap[key]) {
        conditionMap[key] = {
          conditionId: condIdMap[condCode] || 2,
          conditionCode: condCode,
          languageId: 1,
          languageCode: langCode,
          fromPriceEur: price,
          avgPriceEur: price,
          highPriceEur: price,
          listingsCount: 1,
        };
      } else {
        const existing = conditionMap[key];
        existing.listingsCount++;
        if (price < (existing.fromPriceEur || Infinity)) existing.fromPriceEur = price;
        if (price > (existing.highPriceEur || 0)) existing.highPriceEur = price;
        const currentTotal = (existing.avgPriceEur || 0) * (existing.listingsCount - 1);
        existing.avgPriceEur = (currentTotal + price) / existing.listingsCount;
      }
    });

    return Object.values(conditionMap);
  }

  /**
   * Parse individual listings from HTML
   */
  private parseListings(html: string): ListingData[] {
    const $ = cheerio.load(html);
    const listings: ListingData[] = [];

    $('.article-row').each((i, row) => {
      if (i >= this.config.maxListingsPerCard) return false;

      const $row = $(row);
      const listing: ListingData = {
        sellerName: $row.find('.seller-name a').text().trim() || 'Unknown',
        sellerCountry: null,
        sellerSales: null,
        conditionCode: 'NM',
        languageCode: 'EN',
        priceEur: 0,
        quantity: 1,
        isSigned: false,
        isFirstEd: false,
        isAltered: false,
        isPlayset: false,
      };

      // Condition
      const condEl = $row.find('[class*="article-condition"]');
      if (condEl.hasClass('condition-mt')) listing.conditionCode = 'MT';
      else if (condEl.hasClass('condition-ex')) listing.conditionCode = 'EX';
      else if (condEl.hasClass('condition-gd')) listing.conditionCode = 'GD';
      else if (condEl.hasClass('condition-lp')) listing.conditionCode = 'LP';
      else if (condEl.hasClass('condition-pl')) listing.conditionCode = 'PL';
      else if (condEl.hasClass('condition-po')) listing.conditionCode = 'PO';

      // Price
      const priceText = $row.find('.price-container .fw-bold').text();
      const priceMatch = priceText.match(/([\d,.]+)\s*€/);
      if (priceMatch) {
        listing.priceEur = parseFloat(priceMatch[1].replace(',', '.'));
      }

      if (listing.priceEur > 0) {
        listings.push(listing);
      }
    });

    return listings;
  }

  /**
   * Scrape a single card
   */
  async scrapeCardArchive(cardUrl: string): Promise<CardArchiveData | null> {
    try {
      const html = await this.fetchWithBrightData(cardUrl);

      const baseData = this.parseCardPage(html, cardUrl);
      if (!baseData) {
        this.errors.push(`Failed to parse card data from ${cardUrl}`);
        return null;
      }

      const conditionPrices = this.parseConditionPrices(html);
      const listings = this.config.includeListings ? this.parseListings(html) : [];

      return {
        ...baseData,
        conditionPrices,
        listings,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      this.errors.push(`Error scraping ${cardUrl}: ${msg}`);
      return null;
    }
  }

  /**
   * Scrape all cards from a set
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

    // Collect card URLs
    const cardUrls: string[] = [];
    let pageNum = 1;
    let totalPages: number | null = null;

    while (pageNum <= (totalPages || maxPages)) {
      if (cardUrls.length >= maxCards) break;

      const expansionUrl = `${CARDMARKET_ONEPIECE_URL}/Products/Singles/${setConfig.cardmarketName}${pageNum > 1 ? '?site=' + pageNum : ''}`;

      try {
        const html = await this.fetchWithBrightData(expansionUrl);
        const $ = cheerio.load(html);

        // Get card URLs
        $('.table-body .row a[href*="/Products/Singles/"]').each((_, el) => {
          const href = $(el).attr('href');
          if (href && cardUrls.length < maxCards) {
            const fullUrl = href.startsWith('http') ? href : `https://www.cardmarket.com${href}`;
            if (!cardUrls.includes(fullUrl)) {
              cardUrls.push(fullUrl);
            }
          }
        });

        // Get pagination
        if (!totalPages) {
          let maxPage = 1;
          $('.pagination .page-item').each((_, el) => {
            const num = parseInt($(el).text(), 10);
            if (!isNaN(num) && num > maxPage) maxPage = num;
          });
          totalPages = Math.min(maxPage, maxPages);
        }

        console.log(`   Page ${pageNum}/${totalPages}: Found ${cardUrls.length} cards`);
      } catch (error) {
        this.errors.push(`Error loading expansion page ${pageNum}: ${error}`);
      }

      pageNum++;
      await sleepWithVariance(this.config.requestDelayMs);
    }

    // Scrape each card
    console.log(`\n📊 Scraping ${cardUrls.length} cards...`);

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
        console.log(`      ✓ ${archiveData.cardName} - €${archiveData.trendPriceEur || 'N/A'} (${archiveData.conditionPrices.length} conditions)`);
      }

      if (i < cardUrls.length - 1) {
        await sleepWithVariance(this.config.requestDelayMs);
      }
    }

    return {
      success: this.errors.length === 0,
      cards,
      errors: this.errors,
      stats: {
        cardsProcessed: cards.length,
        conditionsExtracted,
        listingsExtracted,
        duration: Date.now() - startTime,
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

  async close(): Promise<void> {
    // No cleanup needed for API-based scraper
  }
}

export function createBrightDataScraper(config: Partial<BrightDataConfig>): BrightDataCardMarketScraper {
  return new BrightDataCardMarketScraper(config);
}
