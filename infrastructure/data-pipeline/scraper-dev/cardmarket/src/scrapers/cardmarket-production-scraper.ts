/**
 * CardMarket Production Scraper
 *
 * Production-ready scraper with:
 * - AWS Secrets Manager integration
 * - Retry logic with exponential backoff
 * - Progress checkpointing
 * - Comprehensive error handling
 * - CloudWatch metrics
 */

import * as cheerio from 'cheerio';
import { CARDMARKET_ONEPIECE_URL, ONEPIECE_SETS } from '../config/index.js';
import { RateLimiter, sleepWithVariance } from '../utils/index.js';

// ============================================================================
// Types
// ============================================================================

export interface ProductionScraperConfig {
  apiToken: string;
  zone: string;
  databaseUrl: string;
  requestDelayMs: number;
  requestsPerMinute: number;
  maxRetries: number;
  retryDelayMs: number;
  includeListings: boolean;
  maxListingsPerCard: number;
  enableCheckpointing: boolean;
  enableMetrics: boolean;
}

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
  totalSellers: number | null;
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

export interface ScrapeCheckpoint {
  date: string;
  startedAt: string;
  lastSetCode: string;
  lastCardIndex: number;
  completedSets: string[];
  totalCardsScraped: number;
  totalErrors: number;
}

export interface ScrapeMetrics {
  runId: string;
  startTime: Date;
  endTime?: Date;
  setsProcessed: number;
  cardsScraped: number;
  conditionsExtracted: number;
  listingsExtracted: number;
  apiCalls: number;
  errors: number;
  retries: number;
  durationMs?: number;
}

export interface ArchiveResult {
  success: boolean;
  cards: CardArchiveData[];
  errors: string[];
  metrics: ScrapeMetrics;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: ProductionScraperConfig = {
  apiToken: '',
  zone: 'mcp_unlocker',
  databaseUrl: '',
  requestDelayMs: 2000,
  requestsPerMinute: 20,
  maxRetries: 3,
  retryDelayMs: 5000,
  includeListings: true,
  maxListingsPerCard: 50,
  enableCheckpointing: true,
  enableMetrics: true,
};

// ============================================================================
// AWS Secrets Manager Integration
// ============================================================================

export async function getSecretsFromAWS(): Promise<{ apiToken: string; databaseUrl: string }> {
  // Check if running in AWS (has AWS_REGION)
  if (!process.env.AWS_REGION) {
    // Local development - use environment variables
    return {
      apiToken: process.env.BRIGHTDATA_TOKEN || '',
      databaseUrl: process.env.DATABASE_URL || '',
    };
  }

  // AWS environment - use Secrets Manager
  const { SecretsManagerClient, GetSecretValueCommand } = await import('@aws-sdk/client-secrets-manager');
  const client = new SecretsManagerClient({ region: process.env.AWS_REGION });

  const [brightdataSecret, dbSecret] = await Promise.all([
    client.send(new GetSecretValueCommand({ SecretId: 'cardmarket-scraper/brightdata' })),
    client.send(new GetSecretValueCommand({ SecretId: 'cardmarket-scraper/database' })),
  ]);

  const brightdata = JSON.parse(brightdataSecret.SecretString || '{}');
  const database = JSON.parse(dbSecret.SecretString || '{}');

  return {
    apiToken: brightdata.API_TOKEN || '',
    databaseUrl: database.DATABASE_URL || '',
  };
}

// ============================================================================
// CloudWatch Metrics
// ============================================================================

export async function publishMetrics(metrics: ScrapeMetrics): Promise<void> {
  if (!process.env.AWS_REGION) {
    console.log('[Metrics] Local mode - logging instead of publishing');
    console.log(JSON.stringify(metrics, null, 2));
    return;
  }

  const { CloudWatchClient, PutMetricDataCommand } = await import('@aws-sdk/client-cloudwatch');
  const client = new CloudWatchClient({ region: process.env.AWS_REGION });

  const metricData = [
    { MetricName: 'CardsScraped', Value: metrics.cardsScraped, Unit: 'Count' },
    { MetricName: 'ConditionsExtracted', Value: metrics.conditionsExtracted, Unit: 'Count' },
    { MetricName: 'ListingsExtracted', Value: metrics.listingsExtracted, Unit: 'Count' },
    { MetricName: 'APICallsCount', Value: metrics.apiCalls, Unit: 'Count' },
    { MetricName: 'ErrorCount', Value: metrics.errors, Unit: 'Count' },
    { MetricName: 'RetryCount', Value: metrics.retries, Unit: 'Count' },
    { MetricName: 'DurationSeconds', Value: (metrics.durationMs || 0) / 1000, Unit: 'Seconds' },
  ];

  await client.send(new PutMetricDataCommand({
    Namespace: 'CardMarket/Scraper',
    MetricData: metricData.map(m => ({
      ...m,
      Timestamp: new Date(),
      Dimensions: [{ Name: 'Environment', Value: process.env.ENVIRONMENT || 'production' }],
    })),
  }));

  console.log('[Metrics] Published to CloudWatch');
}

// ============================================================================
// Production Scraper Class
// ============================================================================

export class ProductionCardMarketScraper {
  private config: ProductionScraperConfig;
  private rateLimiter: RateLimiter;
  private errors: string[] = [];
  private metrics: ScrapeMetrics;
  private checkpoint: ScrapeCheckpoint | null = null;

  constructor(config: Partial<ProductionScraperConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    if (!this.config.apiToken) {
      throw new Error('Bright Data API token is required');
    }

    this.rateLimiter = new RateLimiter(
      this.config.requestsPerMinute,
      this.config.requestsPerMinute / 60
    );

    this.metrics = {
      runId: `run-${Date.now()}`,
      startTime: new Date(),
      setsProcessed: 0,
      cardsScraped: 0,
      conditionsExtracted: 0,
      listingsExtracted: 0,
      apiCalls: 0,
      errors: 0,
      retries: 0,
    };
  }

  /**
   * Fetch URL with retry logic and exponential backoff
   */
  private async fetchWithRetry(url: string): Promise<string> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
      try {
        await this.rateLimiter.acquire();
        this.metrics.apiCalls++;

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
          const errorText = await response.text();
          throw new Error(`API error ${response.status}: ${errorText}`);
        }

        return await response.text();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        this.metrics.retries++;

        if (attempt < this.config.maxRetries) {
          const delay = this.config.retryDelayMs * Math.pow(2, attempt - 1);
          console.log(`   ⚠️ Retry ${attempt}/${this.config.maxRetries} in ${delay}ms: ${lastError.message}`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    this.metrics.errors++;
    throw lastError || new Error('Unknown error');
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
      totalSellers: null,
      priceChange7d: null,
      priceChange30d: null,
    };

    data.cardName = $('h1').first().text().trim();

    const cardNumMatch = data.cardName.match(/\(([A-Z0-9]+-\d+)\)/i) || url.match(/\/([A-Z0-9]+-\d+)/i);
    if (cardNumMatch) {
      const parts = cardNumMatch[1].split('-');
      data.setCode = parts[0];
      data.cardNumber = parts[1];
    }

    const urlLower = url.toLowerCase();
    if (urlLower.includes('-v1') || urlLower.includes('-v2')) data.variantType = 'parallel';
    else if (urlLower.includes('-manga')) data.variantType = 'manga';
    else if (urlLower.includes('-sp')) data.variantType = 'sp';
    else if (urlLower.includes('-sec')) data.variantType = 'sec';

    data.cardId = `${data.setCode}-${data.cardNumber}${data.variantType !== 'standard' ? '-' + data.variantType : ''}`;

    const infoText = $('.info-list-container').text();

    const fromMatch = infoText.match(/From\s*([\d,.]+)\s*€/i);
    if (fromMatch) data.fromPriceEur = parseFloat(fromMatch[1].replace(',', '.'));

    const trendMatch = infoText.match(/Price Trend\s*([\d,.]+)\s*€/i) || infoText.match(/Trend\s*([\d,.]+)\s*€/i);
    if (trendMatch) data.trendPriceEur = parseFloat(trendMatch[1].replace(',', '.'));

    const avg7Match = infoText.match(/7-day average[^€]*([\d,.]+)\s*€/i);
    if (avg7Match) data.avg7PriceEur = parseFloat(avg7Match[1].replace(',', '.'));

    const avg30Match = infoText.match(/30-day average[^€]*([\d,.]+)\s*€/i);
    if (avg30Match) data.avg30PriceEur = parseFloat(avg30Match[1].replace(',', '.'));

    // Extract "Available items" count
    const availMatch = infoText.match(/Available items\s*(\d+)/i);
    if (availMatch) data.totalListings = parseInt(availMatch[1], 10);

    // Extract sellers count - CardMarket shows "X items from Y sellers" or "Y Sellers"
    const sellersMatch = infoText.match(/from\s*(\d+)\s*sellers?/i)
      || infoText.match(/(\d+)\s*sellers?/i)
      || infoText.match(/Verkäufer\s*(\d+)/i);
    if (sellersMatch) data.totalSellers = parseInt(sellersMatch[1], 10);

    // Fallback: count unique sellers from article rows
    if (!data.totalSellers) {
      const sellerNames = new Set<string>();
      $('.article-row .seller-name a, .article-row a[href*="/Users/"]').each((_, el) => {
        const name = $(el).text().trim();
        if (name) sellerNames.add(name);
      });
      if (sellerNames.size > 0) {
        data.totalSellers = sellerNames.size;
      }
    }

    return data;
  }

  /**
   * Parse condition prices from HTML
   */
  private parseConditionPrices(html: string): ConditionPrice[] {
    const $ = cheerio.load(html);
    const conditionMap: Record<string, ConditionPrice> = {};
    const condIdMap: Record<string, number> = { MT: 1, NM: 2, EX: 3, GD: 4, LP: 5, PL: 6, PO: 7 };
    const langIdMap: Record<string, number> = { EN: 1, JP: 2, DE: 3, FR: 4, IT: 5, ES: 6, PT: 7, KR: 8, CN: 9 };

    // Language detection helpers
    const langMap: Record<string, string> = {
      'en': 'EN', 'english': 'EN', 'gb': 'EN',
      'jp': 'JP', 'japanese': 'JP', 'ja': 'JP',
      'de': 'DE', 'german': 'DE',
      'fr': 'FR', 'french': 'FR',
      'it': 'IT', 'italian': 'IT',
      'es': 'ES', 'spanish': 'ES',
      'pt': 'PT', 'portuguese': 'PT',
      'kr': 'KR', 'korean': 'KR',
      'cn': 'CN', 'chinese': 'CN',
    };

    $('.article-row').each((_, row) => {
      const $row = $(row);
      const rowHtml = $.html(row).toLowerCase();

      // === CONDITION ===
      let condCode = 'NM';
      const condEl = $row.find('[class*="condition"], abbr[title*="Mint"], abbr[title*="Near"]');
      const condClass = condEl.attr('class') || '';
      const condTitle = condEl.attr('title') || '';
      const condText = condEl.text().trim().toUpperCase();

      if (condClass.includes('condition-mt') || (condTitle.includes('Mint') && !condTitle.includes('Near')) || condText === 'MT') {
        condCode = 'MT';
      } else if (condClass.includes('condition-nm') || condTitle.includes('Near Mint') || condText === 'NM') {
        condCode = 'NM';
      } else if (condClass.includes('condition-ex') || condTitle.includes('Excellent') || condText === 'EX') {
        condCode = 'EX';
      } else if (condClass.includes('condition-gd') || condTitle.includes('Good') || condText === 'GD') {
        condCode = 'GD';
      } else if (condClass.includes('condition-lp') || condTitle.includes('Light') || condText === 'LP') {
        condCode = 'LP';
      } else if (condClass.includes('condition-pl') || condTitle.includes('Played') || condText === 'PL') {
        condCode = 'PL';
      } else if (condClass.includes('condition-po') || condTitle.includes('Poor') || condText === 'PO') {
        condCode = 'PO';
      }

      // === PRICE ===
      const priceText = $row.find('.price-container .fw-bold, [class*="price"] .fw-bold').first().text().trim();
      const priceMatch = priceText.match(/([\d,.]+)\s*€/);
      const price = priceMatch ? parseFloat(priceMatch[1].replace(',', '.')) : null;

      if (!price) return;

      // === LANGUAGE ===
      let langCode = 'EN';
      const langEl = $row.find('[class*="language"], [data-original-title*="English"], [data-original-title*="Japanese"], [title*="English"], [title*="Japanese"], img[src*="lang"]');
      if (langEl.length > 0) {
        const langClass = langEl.attr('class') || '';
        const langTitle = langEl.attr('title') || langEl.attr('data-original-title') || '';
        const langSrc = langEl.attr('src') || '';

        const langClassMatch = langClass.match(/lang(?:uage)?[_-](\w{2})/i);
        if (langClassMatch) {
          langCode = langMap[langClassMatch[1].toLowerCase()] || langClassMatch[1].toUpperCase();
        } else if (langTitle) {
          const titleLower = langTitle.toLowerCase();
          for (const [key, code] of Object.entries(langMap)) {
            if (titleLower.includes(key)) {
              langCode = code;
              break;
            }
          }
        } else if (langSrc) {
          const srcMatch = langSrc.match(/lang[_\/](\w{2})/i);
          if (srcMatch) {
            langCode = langMap[srcMatch[1].toLowerCase()] || srcMatch[1].toUpperCase();
          }
        }
      }
      // Fallback: check row text
      if (langCode === 'EN' && (rowHtml.includes('japanese') || rowHtml.includes('japan'))) {
        langCode = 'JP';
      }

      const key = `${condCode}-${langCode}`;

      if (!conditionMap[key]) {
        conditionMap[key] = {
          conditionId: condIdMap[condCode] || 2,
          conditionCode: condCode,
          languageId: langIdMap[langCode] || 1,
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

    // Country code mapping from flag classes/images
    const countryMap: Record<string, string> = {
      'de': 'DE', 'germany': 'DE',
      'gb': 'GB', 'uk': 'GB', 'united-kingdom': 'GB',
      'fr': 'FR', 'france': 'FR',
      'it': 'IT', 'italy': 'IT',
      'es': 'ES', 'spain': 'ES',
      'nl': 'NL', 'netherlands': 'NL',
      'be': 'BE', 'belgium': 'BE',
      'at': 'AT', 'austria': 'AT',
      'pl': 'PL', 'poland': 'PL',
      'jp': 'JP', 'japan': 'JP',
      'us': 'US', 'usa': 'US',
    };

    // Language code mapping
    const langMap: Record<string, string> = {
      'en': 'EN', 'english': 'EN', 'gb': 'EN',
      'jp': 'JP', 'japanese': 'JP', 'ja': 'JP',
      'de': 'DE', 'german': 'DE',
      'fr': 'FR', 'french': 'FR',
      'it': 'IT', 'italian': 'IT',
      'es': 'ES', 'spanish': 'ES',
      'pt': 'PT', 'portuguese': 'PT',
      'kr': 'KR', 'korean': 'KR',
      'cn': 'CN', 'chinese': 'CN',
    };

    $('.article-row').each((i, row) => {
      if (i >= this.config.maxListingsPerCard) return false;

      const $row = $(row);
      const rowHtml = $.html(row).toLowerCase();

      const listing: ListingData = {
        sellerName: 'Unknown',
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

      // === SELLER NAME ===
      const sellerEl = $row.find('.seller-name a, .col-seller a, a[href*="/Users/"]').first();
      listing.sellerName = sellerEl.text().trim() || 'Unknown';

      // === SELLER COUNTRY (from flag icon/class) ===
      const flagEl = $row.find('[class*="flag-"], img[src*="flag"], .sprite-flag, [class*="country"]');
      if (flagEl.length > 0) {
        const flagClass = flagEl.attr('class') || '';
        const flagSrc = flagEl.attr('src') || '';
        const flagTitle = flagEl.attr('title') || flagEl.attr('data-original-title') || '';

        // Extract country from class like "flag-de" or "sprite-flag-de"
        const classMatch = flagClass.match(/flag[_-](\w{2})/i);
        if (classMatch) {
          listing.sellerCountry = countryMap[classMatch[1].toLowerCase()] || classMatch[1].toUpperCase();
        }
        // Extract from src like "/flags/de.gif"
        else if (flagSrc) {
          const srcMatch = flagSrc.match(/flags?[\/](\w{2})/i);
          if (srcMatch) {
            listing.sellerCountry = countryMap[srcMatch[1].toLowerCase()] || srcMatch[1].toUpperCase();
          }
        }
        // Extract from title like "Germany"
        else if (flagTitle) {
          const titleLower = flagTitle.toLowerCase();
          for (const [key, code] of Object.entries(countryMap)) {
            if (titleLower.includes(key)) {
              listing.sellerCountry = code;
              break;
            }
          }
        }
      }

      // === SELLER SALES (from seller info) ===
      const salesText = $row.find('.seller-info, .col-seller').text();
      const salesMatch = salesText.match(/(\d+(?:[.,]\d+)?)\s*(?:sales|verkäufe|ventes)/i);
      if (salesMatch) {
        listing.sellerSales = parseInt(salesMatch[1].replace(/[.,]/g, ''), 10);
      } else {
        // Try to find sales count in format "12345 sales" or "(12345)"
        const numMatch = salesText.match(/\(?\s*(\d{1,6})\s*\)?/);
        if (numMatch && parseInt(numMatch[1], 10) > 10) {
          listing.sellerSales = parseInt(numMatch[1], 10);
        }
      }

      // === CONDITION ===
      const condEl = $row.find('[class*="condition"], abbr[title*="Mint"], abbr[title*="Near"], abbr[title*="Excellent"]');
      const condClass = condEl.attr('class') || '';
      const condTitle = condEl.attr('title') || '';
      const condText = condEl.text().trim().toUpperCase();

      if (condClass.includes('condition-mt') || condTitle.includes('Mint') && !condTitle.includes('Near') || condText === 'MT') {
        listing.conditionCode = 'MT';
      } else if (condClass.includes('condition-nm') || condTitle.includes('Near Mint') || condText === 'NM') {
        listing.conditionCode = 'NM';
      } else if (condClass.includes('condition-ex') || condTitle.includes('Excellent') || condText === 'EX') {
        listing.conditionCode = 'EX';
      } else if (condClass.includes('condition-gd') || condTitle.includes('Good') || condText === 'GD') {
        listing.conditionCode = 'GD';
      } else if (condClass.includes('condition-lp') || condTitle.includes('Light') || condText === 'LP') {
        listing.conditionCode = 'LP';
      } else if (condClass.includes('condition-pl') || condTitle.includes('Played') || condText === 'PL') {
        listing.conditionCode = 'PL';
      } else if (condClass.includes('condition-po') || condTitle.includes('Poor') || condText === 'PO') {
        listing.conditionCode = 'PO';
      }

      // === LANGUAGE (from language flag/icon) ===
      const langEl = $row.find('[class*="language"], [data-original-title*="English"], [data-original-title*="Japanese"], [title*="English"], [title*="Japanese"], img[src*="lang"]');
      if (langEl.length > 0) {
        const langClass = langEl.attr('class') || '';
        const langTitle = langEl.attr('title') || langEl.attr('data-original-title') || '';
        const langSrc = langEl.attr('src') || '';

        // Check class for language
        const langClassMatch = langClass.match(/lang(?:uage)?[_-](\w{2})/i);
        if (langClassMatch) {
          listing.languageCode = langMap[langClassMatch[1].toLowerCase()] || langClassMatch[1].toUpperCase();
        }
        // Check title
        else if (langTitle) {
          const titleLower = langTitle.toLowerCase();
          for (const [key, code] of Object.entries(langMap)) {
            if (titleLower.includes(key)) {
              listing.languageCode = code;
              break;
            }
          }
        }
        // Check src
        else if (langSrc) {
          const srcMatch = langSrc.match(/lang[_\/](\w{2})/i);
          if (srcMatch) {
            listing.languageCode = langMap[srcMatch[1].toLowerCase()] || srcMatch[1].toUpperCase();
          }
        }
      }
      // Fallback: check row text for language indicators
      if (listing.languageCode === 'EN') {
        if (rowHtml.includes('japanese') || rowHtml.includes('japan')) {
          listing.languageCode = 'JP';
        }
      }

      // === QUANTITY ===
      const qtyEl = $row.find('.col-quantity, [class*="quantity"], .amount');
      const qtyText = qtyEl.text().trim();
      const qtyMatch = qtyText.match(/(\d+)/);
      if (qtyMatch) {
        listing.quantity = parseInt(qtyMatch[1], 10) || 1;
      }

      // === PRICE ===
      const priceText = $row.find('.price-container .fw-bold, .col-price .fw-bold, [class*="price"] .fw-bold').text();
      const priceMatch = priceText.match(/([\d,.]+)\s*€/);
      if (priceMatch) {
        listing.priceEur = parseFloat(priceMatch[1].replace(',', '.'));
      }

      // === ITEM FLAGS (signed, first edition, altered, playset) ===
      // Check for icons/badges indicating special attributes
      const itemIcons = $row.find('[class*="icon"], [class*="badge"], [title]');
      itemIcons.each((_, icon) => {
        const iconClass = $(icon).attr('class') || '';
        const iconTitle = ($(icon).attr('title') || $(icon).attr('data-original-title') || '').toLowerCase();
        const iconClassLower = iconClass.toLowerCase();

        if (iconTitle.includes('signed') || iconClassLower.includes('signed')) {
          listing.isSigned = true;
        }
        if (iconTitle.includes('first') || iconTitle.includes('1st') || iconClassLower.includes('firsted') || iconClassLower.includes('first-ed')) {
          listing.isFirstEd = true;
        }
        if (iconTitle.includes('altered') || iconClassLower.includes('altered')) {
          listing.isAltered = true;
        }
        if (iconTitle.includes('playset') || iconClassLower.includes('playset')) {
          listing.isPlayset = true;
        }
      });

      // Also check row HTML for these indicators
      if (rowHtml.includes('signed')) listing.isSigned = true;
      if (rowHtml.includes('first edition') || rowHtml.includes('1st edition')) listing.isFirstEd = true;
      if (rowHtml.includes('altered')) listing.isAltered = true;
      if (rowHtml.includes('playset')) listing.isPlayset = true;

      if (listing.priceEur > 0) {
        listings.push(listing);
      }
    });

    return listings;
  }

  /**
   * Scrape a single card with full error handling
   */
  async scrapeCard(cardUrl: string): Promise<CardArchiveData | null> {
    try {
      const html = await this.fetchWithRetry(cardUrl);

      const baseData = this.parseCardPage(html, cardUrl);
      if (!baseData) {
        this.errors.push(`Failed to parse: ${cardUrl}`);
        this.metrics.errors++;
        return null;
      }

      const conditionPrices = this.parseConditionPrices(html);
      const listings = this.config.includeListings ? this.parseListings(html) : [];

      this.metrics.cardsScraped++;
      this.metrics.conditionsExtracted += conditionPrices.length;
      this.metrics.listingsExtracted += listings.length;

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
   * Scrape entire set with progress tracking
   */
  async scrapeSet(
    setCode: string,
    options: {
      maxCards?: number;
      maxPages?: number;
      startIndex?: number;
      onProgress?: (progress: { current: number; total: number; cardName: string }) => void;
    } = {}
  ): Promise<CardArchiveData[]> {
    const cards: CardArchiveData[] = [];
    const { maxCards = Infinity, maxPages = Infinity, startIndex = 0, onProgress } = options;

    const setConfig = ONEPIECE_SETS[setCode];
    if (!setConfig) {
      this.errors.push(`Unknown set: ${setCode}`);
      return cards;
    }

    console.log(`\n📦 Scraping set: ${setCode} (${setConfig.cardmarketName})`);

    // Collect card URLs
    const cardUrls: string[] = [];
    let pageNum = 1;
    let totalPages: number | null = null;

    while (pageNum <= (totalPages || maxPages)) {
      if (cardUrls.length >= maxCards) break;

      const expansionUrl = `${CARDMARKET_ONEPIECE_URL}/Products/Singles/${setConfig.cardmarketName}${pageNum > 1 ? '?site=' + pageNum : ''}`;

      try {
        const html = await this.fetchWithRetry(expansionUrl);
        const $ = cheerio.load(html);

        $('.table-body .row a[href*="/Products/Singles/"]').each((_, el) => {
          const href = $(el).attr('href');
          if (href && cardUrls.length < maxCards) {
            const fullUrl = href.startsWith('http') ? href : `https://www.cardmarket.com${href}`;
            if (!cardUrls.includes(fullUrl)) {
              cardUrls.push(fullUrl);
            }
          }
        });

        if (!totalPages) {
          let maxPage = 1;
          $('.pagination .page-item').each((_, el) => {
            const num = parseInt($(el).text(), 10);
            if (!isNaN(num) && num > maxPage) maxPage = num;
          });
          totalPages = Math.min(maxPage, maxPages);
        }

        console.log(`   Page ${pageNum}/${totalPages}: ${cardUrls.length} cards found`);
      } catch (error) {
        console.error(`   ❌ Error on page ${pageNum}:`, error);
      }

      pageNum++;
      await sleepWithVariance(this.config.requestDelayMs);
    }

    // Scrape cards (starting from checkpoint if provided)
    console.log(`\n📊 Scraping ${cardUrls.length - startIndex} cards (starting at index ${startIndex})...`);

    for (let i = startIndex; i < cardUrls.length; i++) {
      const url = cardUrls[i];
      const cardSlug = url.split('/').pop() || '';

      if (onProgress) {
        onProgress({ current: i + 1, total: cardUrls.length, cardName: cardSlug });
      }

      console.log(`   [${i + 1}/${cardUrls.length}] ${cardSlug}`);

      const cardData = await this.scrapeCard(url);
      if (cardData) {
        cards.push(cardData);
        console.log(`      ✓ €${cardData.trendPriceEur || 'N/A'} (${cardData.conditionPrices.length} conditions)`);
      }

      // Update checkpoint
      if (this.config.enableCheckpointing) {
        this.checkpoint = {
          date: new Date().toISOString().split('T')[0],
          startedAt: this.metrics.startTime.toISOString(),
          lastSetCode: setCode,
          lastCardIndex: i,
          completedSets: [],
          totalCardsScraped: this.metrics.cardsScraped,
          totalErrors: this.metrics.errors,
        };
      }

      if (i < cardUrls.length - 1) {
        await sleepWithVariance(this.config.requestDelayMs);
      }
    }

    this.metrics.setsProcessed++;
    return cards;
  }

  /**
   * Get current metrics
   */
  getMetrics(): ScrapeMetrics {
    return {
      ...this.metrics,
      endTime: new Date(),
      durationMs: Date.now() - this.metrics.startTime.getTime(),
    };
  }

  /**
   * Get errors
   */
  getErrors(): string[] {
    return [...this.errors];
  }

  /**
   * Get checkpoint for resume capability
   */
  getCheckpoint(): ScrapeCheckpoint | null {
    return this.checkpoint;
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
    // Publish final metrics
    if (this.config.enableMetrics) {
      await publishMetrics(this.getMetrics());
    }
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export async function createProductionScraper(
  config?: Partial<ProductionScraperConfig>
): Promise<ProductionCardMarketScraper> {
  // Get secrets from AWS or environment
  const secrets = await getSecretsFromAWS();

  return new ProductionCardMarketScraper({
    ...config,
    apiToken: config?.apiToken || secrets.apiToken,
    databaseUrl: config?.databaseUrl || secrets.databaseUrl,
  });
}
