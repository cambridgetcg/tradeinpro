/**
 * TCGPlayer Bright Data Scraper (DEPRECATED - Use Search API instead)
 *
 * Production-ready scraper using Bright Data Web Unlocker:
 * - AWS Secrets Manager integration
 * - Retry logic with exponential backoff
 * - Progress checkpointing
 * - Comprehensive error handling
 * - CloudWatch metrics
 *
 * ⚠️  DEPRECATION NOTICE:
 * This scraper is DEPRECATED. TCGPlayer is an SPA that returns empty HTML shells.
 * Use tcgplayer-search-api-scraper.ts instead (free, reliable, includes listings).
 *
 * This file is kept for reference and as a fallback pattern example.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * DOCUMENTATION REFERENCES (Symbiotic Code ↔ Docs)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * @see {@link file://../../../docs/SCRAPER_ARCHITECTURE_INSIGHTS.md} - Why this approach failed
 *   - Section 1: "Why HTML Scraping Failed" - SPA returns empty shells
 *   - Section 7.2: "SPA Sites Are Harder to Scrape"
 *   - Section 7.3: "Third-Party Services Have Trade-offs"
 *
 * @see {@link file://../../../docs/HYBRID_PIPELINE_ARCHITECTURE.md} - Fallback role
 *   - How this fits as backup to JustTCG API
 *   - Cost analysis ($0.50-1.00 per 1000 cards)
 *
 * @see {@link file://../../../docs/TCGPLAYER_STACK_ANALYSIS.md} - Platform analysis
 *   - TCGPlayer SPA architecture details
 *   - Why Bright Data mcp_unlocker zone fails
 *
 * @see {@link file://../../../docs/AWS_INFRASTRUCTURE.md} - AWS integration
 *   - Secrets Manager for API token
 *   - CloudWatch metrics
 *
 * Related Code Files:
 * @see {@link file://./tcgplayer-search-api-scraper.ts} - RECOMMENDED replacement
 * @see {@link file://../../scripts/test-brightdata-scraper.ts} - Test script
 * @see {@link file://../../scripts/test-brightdata-browser.ts} - Browser test
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * @deprecated Use tcgplayer-search-api-scraper.ts instead
 * @module scrapers/tcgplayer-brightdata-scraper
 * @since 2026-01-09
 */

import * as cheerio from 'cheerio';
import type { GameCode } from '../config/games.js';
import { getSetsByGame, type SetInfo } from '../config/sets.js';

// ============================================================================
// Types
// ============================================================================

export interface TCGPlayerScraperConfig {
  apiToken?: string;
  zone?: string;
  requestDelayMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
  includeListings?: boolean;
  maxListingsPerCard?: number;
  enableMetrics?: boolean;
}

export interface TCGPlayerCardData {
  cardId: string;
  cardName: string;
  game: GameCode;
  setCode: string;
  setName: string;
  cardNumber: string;
  variantType: string | null;
  rarity: string | null;
  sourceUrl: string;
  scrapedAt: string;
  // Prices in USD (TCGPlayer's native currency)
  marketPriceUsd: number | null;
  lowPriceUsd: number | null;
  midPriceUsd: number | null;
  highPriceUsd: number | null;
  // Converted prices
  marketPriceGbp: number | null;
  lowPriceGbp: number | null;
  // Metadata
  totalListings: number | null;
  totalSellers: number | null;
  productId: string | null;
  imageUrl: string | null;
  // Condition prices and listings
  conditionPrices: TCGPlayerConditionPrice[];
  listings: TCGPlayerListing[];
}

export interface TCGPlayerConditionPrice {
  conditionId: number;
  conditionCode: string; // NM, LP, MP, HP, DMG
  conditionName: string;
  printing: string; // Normal, Foil
  priceUsd: number | null;
  listingsCount: number;
}

export interface TCGPlayerListing {
  sellerName: string;
  sellerRating: number | null;
  conditionCode: string;
  printing: string;
  priceUsd: number;
  quantity: number;
  isFoil: boolean;
  shippingUsd: number | null;
}

export interface ScrapeMetrics {
  runId: string;
  startTime: Date;
  endTime?: Date;
  setsProcessed: number;
  cardsScraped: number;
  apiCalls: number;
  errors: number;
  retries: number;
  durationMs?: number;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_CONFIG: Required<TCGPlayerScraperConfig> = {
  apiToken: '',
  zone: 'mcp_unlocker',
  requestDelayMs: 3000, // More conservative for TCGPlayer
  maxRetries: 3,
  retryDelayMs: 5000,
  includeListings: true,
  maxListingsPerCard: 30,
  enableMetrics: true,
};

const USD_TO_GBP = 0.79;

const TCGPLAYER_BASE_URL = 'https://www.tcgplayer.com';

// TCGPlayer game slugs
const GAME_SLUGS: Record<GameCode, string> = {
  'onepiece': 'one-piece-card-game',
  'pokemon': 'pokemon',
  'mtg': 'magic',
  'yugioh': 'yugioh',
  'lorcana': 'lorcana',
  'digimon': 'digimon-card-game',
  'flesh-and-blood': 'flesh-and-blood-tcg',
  'star-wars-unlimited': 'star-wars-unlimited',
  'union-arena': 'union-arena',
  'weiss-schwarz': 'weiss-schwarz',
  'dragonball-super': 'dragon-ball-super-card-game',
  'custom': 'custom',
};

// Condition code mapping
const CONDITION_MAP: Record<string, { id: number; code: string; name: string }> = {
  'near mint': { id: 1, code: 'NM', name: 'Near Mint' },
  'lightly played': { id: 2, code: 'LP', name: 'Lightly Played' },
  'moderately played': { id: 3, code: 'MP', name: 'Moderately Played' },
  'heavily played': { id: 4, code: 'HP', name: 'Heavily Played' },
  'damaged': { id: 5, code: 'DMG', name: 'Damaged' },
};

// ============================================================================
// AWS Secrets Manager Integration
// ============================================================================

export async function getSecretsFromAWS(): Promise<{ apiToken: string; databaseUrl: string }> {
  if (!process.env.AWS_REGION) {
    return {
      apiToken: process.env.BRIGHTDATA_TOKEN || '',
      databaseUrl: process.env.DATABASE_URL || '',
    };
  }

  const { SecretsManagerClient, GetSecretValueCommand } = await import('@aws-sdk/client-secrets-manager');
  const client = new SecretsManagerClient({ region: process.env.AWS_REGION });

  const [brightdataSecret, dbSecret] = await Promise.all([
    client.send(new GetSecretValueCommand({ SecretId: 'tcgplayer-scraper/brightdata' })),
    client.send(new GetSecretValueCommand({ SecretId: 'tcgplayer-scraper/database' })),
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
    { MetricName: 'CardsScraped', Value: metrics.cardsScraped, Unit: 'Count' as const },
    { MetricName: 'APICallsCount', Value: metrics.apiCalls, Unit: 'Count' as const },
    { MetricName: 'ErrorCount', Value: metrics.errors, Unit: 'Count' as const },
    { MetricName: 'RetryCount', Value: metrics.retries, Unit: 'Count' as const },
    { MetricName: 'DurationSeconds', Value: (metrics.durationMs || 0) / 1000, Unit: 'Seconds' as const },
  ];

  await client.send(new PutMetricDataCommand({
    Namespace: 'TCGPlayer/Scraper',
    MetricData: metricData.map(m => ({
      ...m,
      Timestamp: new Date(),
      Dimensions: [{ Name: 'Environment', Value: process.env.ENVIRONMENT || 'production' }],
    })),
  }));

  console.log('[Metrics] Published to CloudWatch');
}

// ============================================================================
// TCGPlayer Bright Data Scraper Class
// ============================================================================

export class TCGPlayerBrightDataScraper {
  private config: Required<TCGPlayerScraperConfig>;
  private errors: string[] = [];
  private metrics: ScrapeMetrics;
  private game: GameCode;
  private lastRequestTime = 0;

  constructor(game: GameCode, config?: TCGPlayerScraperConfig) {
    this.game = game;
    this.config = { ...DEFAULT_CONFIG, ...config };

    if (!this.config.apiToken) {
      throw new Error('Bright Data API token is required');
    }

    this.metrics = {
      runId: `run-${Date.now()}`,
      startTime: new Date(),
      setsProcessed: 0,
      cardsScraped: 0,
      apiCalls: 0,
      errors: 0,
      retries: 0,
    };
  }

  /**
   * Rate limiting helper
   */
  private async rateLimit(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;
    const minDelay = this.config.requestDelayMs;

    if (elapsed < minDelay) {
      await new Promise(resolve => setTimeout(resolve, minDelay - elapsed));
    }

    this.lastRequestTime = Date.now();
  }

  /**
   * Fetch URL with Bright Data and retry logic
   */
  private async fetchWithRetry(url: string): Promise<string> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
      try {
        await this.rateLimit();
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
    this.errors.push(`Fetch failed for ${url}: ${lastError?.message}`);
    throw lastError || new Error('Unknown error');
  }

  /**
   * Build search URL for a set
   */
  private buildSetUrl(set: SetInfo): string {
    const gameSlug = GAME_SLUGS[this.game] || this.game;
    return `${TCGPLAYER_BASE_URL}/search/${gameSlug}/${set.tcgplayerSlug}?productLineName=${gameSlug}&setName=${set.tcgplayerSlug}&view=grid`;
  }

  /**
   * Build product URL for a card
   */
  private buildProductUrl(productId: string, cardSlug: string): string {
    return `${TCGPLAYER_BASE_URL}/product/${productId}/${cardSlug}`;
  }

  /**
   * Parse set search page to get card URLs
   */
  private parseSetPage(html: string): Array<{ productId: string; url: string; name: string }> {
    const $ = cheerio.load(html);
    const cards: Array<{ productId: string; url: string; name: string }> = [];

    // TCGPlayer search results contain product cards
    $('.search-result, .product-card, [data-testid="product-card"]').each((_, el) => {
      const $el = $(el);
      const link = $el.find('a[href*="/product/"]').first();
      const href = link.attr('href');

      if (href) {
        const fullUrl = href.startsWith('http') ? href : `${TCGPLAYER_BASE_URL}${href}`;
        const productMatch = href.match(/\/product\/(\d+)/);
        const productId = productMatch ? productMatch[1] : '';
        const name = $el.find('.product-card__title, .search-result__title, h3').first().text().trim();

        if (productId) {
          cards.push({ productId, url: fullUrl, name });
        }
      }
    });

    return cards;
  }

  /**
   * Parse product page for card data
   */
  private parseProductPage(html: string, url: string, setCode: string, setName: string): TCGPlayerCardData | null {
    const $ = cheerio.load(html);

    const data: TCGPlayerCardData = {
      cardId: '',
      cardName: '',
      game: this.game,
      setCode,
      setName,
      cardNumber: '',
      variantType: null,
      rarity: null,
      sourceUrl: url,
      scrapedAt: new Date().toISOString(),
      marketPriceUsd: null,
      lowPriceUsd: null,
      midPriceUsd: null,
      highPriceUsd: null,
      marketPriceGbp: null,
      lowPriceGbp: null,
      totalListings: null,
      totalSellers: null,
      productId: null,
      imageUrl: null,
      conditionPrices: [],
      listings: [],
    };

    // Extract product ID from URL
    const productMatch = url.match(/\/product\/(\d+)/);
    data.productId = productMatch ? productMatch[1] : null;

    // Card name
    data.cardName = $('h1.product-details__name, h1[data-testid="product-name"]').first().text().trim()
      || $('h1').first().text().trim();

    // Extract card number from name or page
    const cardNumMatch = data.cardName.match(/\(([A-Z0-9]+-[A-Z]?\d+[A-Z]?)\)/i)
      || $('meta[property="og:description"]').attr('content')?.match(/([A-Z]{2,3}\d{2}-[A-Z]?\d+[A-Z]?)/i);

    if (cardNumMatch) {
      const parts = cardNumMatch[1].split('-');
      data.setCode = parts[0];
      data.cardNumber = parts.slice(1).join('-');
    }

    // Detect variant type
    const nameLower = data.cardName.toLowerCase();
    const urlLower = url.toLowerCase();
    if (nameLower.includes('parallel') || urlLower.includes('parallel')) {
      data.variantType = 'parallel';
    } else if (nameLower.includes('alternate art') || urlLower.includes('alternate')) {
      data.variantType = 'alternate-art';
    } else if (nameLower.includes('special') || urlLower.includes('-sp')) {
      data.variantType = 'sp';
    } else if (nameLower.includes('manga')) {
      data.variantType = 'manga';
    } else if (nameLower.includes('foil') || nameLower.includes('holo')) {
      data.variantType = 'foil';
    }

    // Build card ID
    data.cardId = `${data.setCode}-${data.cardNumber}${data.variantType ? '-' + data.variantType : ''}`;

    // Rarity
    const rarityEl = $('.product-details__rarity, [data-testid="rarity"]');
    data.rarity = rarityEl.text().trim() || null;

    // Image URL
    const imgEl = $('img.product-details__image, img[data-testid="product-image"]').first();
    data.imageUrl = imgEl.attr('src') || imgEl.attr('data-src') || null;

    // === PRICES ===
    const priceContainer = $('.price-guide, .product-details__market-price, [data-testid="price-guide"]');
    const priceText = priceContainer.text() + ' ' + $('.product-details').text();

    // Market price
    const marketMatch = priceText.match(/Market Price[:\s]*\$?([\d,.]+)/i);
    if (marketMatch) {
      data.marketPriceUsd = parseFloat(marketMatch[1].replace(',', ''));
      data.marketPriceGbp = Math.round(data.marketPriceUsd * USD_TO_GBP * 100) / 100;
    }

    // Low price
    const lowMatch = priceText.match(/Low[:\s]*\$?([\d,.]+)/i)
      || priceText.match(/From[:\s]*\$?([\d,.]+)/i);
    if (lowMatch) {
      data.lowPriceUsd = parseFloat(lowMatch[1].replace(',', ''));
      data.lowPriceGbp = Math.round(data.lowPriceUsd * USD_TO_GBP * 100) / 100;
    }

    // Mid price
    const midMatch = priceText.match(/Mid[:\s]*\$?([\d,.]+)/i);
    if (midMatch) {
      data.midPriceUsd = parseFloat(midMatch[1].replace(',', ''));
    }

    // High price
    const highMatch = priceText.match(/High[:\s]*\$?([\d,.]+)/i);
    if (highMatch) {
      data.highPriceUsd = parseFloat(highMatch[1].replace(',', ''));
    }

    // Listings count
    const listingsMatch = priceText.match(/(\d+)\s*(?:listings?|available)/i);
    if (listingsMatch) {
      data.totalListings = parseInt(listingsMatch[1], 10);
    }

    // Parse condition prices from price points table
    data.conditionPrices = this.parseConditionPrices(html);

    // Parse individual listings
    if (this.config.includeListings) {
      data.listings = this.parseListings(html);
    }

    return data;
  }

  /**
   * Parse condition-specific prices
   */
  private parseConditionPrices(html: string): TCGPlayerConditionPrice[] {
    const $ = cheerio.load(html);
    const prices: TCGPlayerConditionPrice[] = [];

    // TCGPlayer shows condition prices in a price guide table
    $('.price-guide__row, .price-points tr, [data-testid="price-row"]').each((_, row) => {
      const $row = $(row);
      const conditionText = $row.find('.price-guide__condition, td:first-child').text().toLowerCase().trim();
      const priceText = $row.find('.price-guide__price, td:last-child').text();

      const priceMatch = priceText.match(/\$?([\d,.]+)/);
      if (!priceMatch) return;

      const price = parseFloat(priceMatch[1].replace(',', ''));

      // Determine condition
      let condition = CONDITION_MAP['near mint'];
      for (const [key, val] of Object.entries(CONDITION_MAP)) {
        if (conditionText.includes(key)) {
          condition = val;
          break;
        }
      }

      // Determine printing (Normal vs Foil)
      const printing = conditionText.includes('foil') ? 'Foil' : 'Normal';

      prices.push({
        conditionId: condition.id,
        conditionCode: condition.code,
        conditionName: condition.name,
        printing,
        priceUsd: price,
        listingsCount: 1,
      });
    });

    return prices;
  }

  /**
   * Parse individual seller listings
   */
  private parseListings(html: string): TCGPlayerListing[] {
    const $ = cheerio.load(html);
    const listings: TCGPlayerListing[] = [];
    const maxListings = this.config.maxListingsPerCard;

    // TCGPlayer listings are in a table or grid
    $('.listing-item, .seller-listing, [data-testid="listing-row"]').slice(0, maxListings).each((_, el) => {
      const $el = $(el);

      // Seller name
      const sellerName = $el.find('.seller-info__name, .listing-item__seller-name, a[href*="/seller/"]').first().text().trim();
      if (!sellerName) return;

      // Seller rating
      const ratingText = $el.find('.seller-info__rating, [data-testid="seller-rating"]').text();
      const ratingMatch = ratingText.match(/([\d.]+)%?/);
      const sellerRating = ratingMatch ? parseFloat(ratingMatch[1]) : null;

      // Condition
      const condText = $el.find('.listing-item__condition, [data-testid="condition"]').text().toLowerCase();
      let conditionCode = 'NM';
      for (const [key, val] of Object.entries(CONDITION_MAP)) {
        if (condText.includes(key)) {
          conditionCode = val.code;
          break;
        }
      }

      // Price
      const priceText = $el.find('.listing-item__price, [data-testid="price"]').text();
      const priceMatch = priceText.match(/\$?([\d,.]+)/);
      if (!priceMatch) return;
      const priceUsd = parseFloat(priceMatch[1].replace(',', ''));

      // Quantity
      const qtyText = $el.find('.listing-item__quantity, [data-testid="quantity"]').text();
      const qtyMatch = qtyText.match(/(\d+)/);
      const quantity = qtyMatch ? parseInt(qtyMatch[1], 10) : 1;

      // Printing (Foil detection)
      const isFoil = condText.includes('foil') || $el.find('[data-testid="foil"]').length > 0;

      // Shipping
      const shippingText = $el.find('.listing-item__shipping, [data-testid="shipping"]').text();
      const shippingMatch = shippingText.match(/\$?([\d,.]+)/);
      const shippingUsd = shippingMatch ? parseFloat(shippingMatch[1].replace(',', '')) : null;

      listings.push({
        sellerName,
        sellerRating,
        conditionCode,
        printing: isFoil ? 'Foil' : 'Normal',
        priceUsd,
        quantity,
        isFoil,
        shippingUsd,
      });
    });

    return listings;
  }

  /**
   * Scrape a single set
   */
  async scrapeSet(setCode: string, options?: { maxCards?: number; maxPages?: number }): Promise<TCGPlayerCardData[]> {
    const sets = getSetsByGame(this.game);
    const set = sets.find(s => s.code.toUpperCase() === setCode.toUpperCase());

    if (!set) {
      throw new Error(`Set ${setCode} not found for game ${this.game}`);
    }

    console.log(`\n📦 Scraping set: ${set.name} (${set.code})`);

    const cards: TCGPlayerCardData[] = [];
    const setUrl = this.buildSetUrl(set);

    try {
      // Fetch set page to get card list
      console.log(`   Fetching set page: ${setUrl}`);
      const setHtml = await this.fetchWithRetry(setUrl);
      const cardLinks = this.parseSetPage(setHtml);

      console.log(`   Found ${cardLinks.length} cards in set`);

      // Limit cards if specified
      const cardsToFetch = options?.maxCards
        ? cardLinks.slice(0, options.maxCards)
        : cardLinks;

      // Fetch each card
      for (let i = 0; i < cardsToFetch.length; i++) {
        const card = cardsToFetch[i];
        try {
          console.log(`   [${i + 1}/${cardsToFetch.length}] ${card.name}`);
          const cardHtml = await this.fetchWithRetry(card.url);
          const cardData = this.parseProductPage(cardHtml, card.url, set.code, set.name);

          if (cardData) {
            cards.push(cardData);
            this.metrics.cardsScraped++;
          }
        } catch (error) {
          const msg = error instanceof Error ? error.message : 'Unknown error';
          console.log(`   ❌ Error scraping ${card.name}: ${msg}`);
          this.errors.push(`Error scraping ${card.url}: ${msg}`);
        }
      }

      this.metrics.setsProcessed++;
      console.log(`   ✅ Completed: ${cards.length} cards scraped`);

    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      console.error(`   ❌ Error scraping set ${setCode}: ${msg}`);
      this.errors.push(`Set scrape error ${setCode}: ${msg}`);
    }

    return cards;
  }

  /**
   * Scrape multiple sets
   */
  async scrapeSets(setCodes?: string[]): Promise<TCGPlayerCardData[]> {
    const sets = getSetsByGame(this.game);
    const setsToScrape = setCodes
      ? sets.filter(s => setCodes.includes(s.code.toUpperCase()))
      : sets.filter(s => s.isReleased);

    console.log(`\n🎴 TCGPlayer Bright Data Scraper - ${this.game}`);
    console.log(`   Sets to scrape: ${setsToScrape.map(s => s.code).join(', ')}`);

    const allCards: TCGPlayerCardData[] = [];

    for (const set of setsToScrape) {
      const cards = await this.scrapeSet(set.code);
      allCards.push(...cards);
    }

    return allCards;
  }

  /**
   * Get available sets for current game
   */
  getAvailableSets(): SetInfo[] {
    return getSetsByGame(this.game).filter(s => s.isReleased);
  }

  /**
   * Get scrape metrics
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
   * Close scraper (cleanup)
   */
  async close(): Promise<void> {
    // No resources to clean up for HTTP-based scraper
    console.log('   TCGPlayer scraper closed');
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export async function createTCGPlayerScraper(
  game: GameCode,
  options?: TCGPlayerScraperConfig
): Promise<TCGPlayerBrightDataScraper> {
  // Auto-load secrets if not provided
  if (!options?.apiToken) {
    const secrets = await getSecretsFromAWS();
    return new TCGPlayerBrightDataScraper(game, {
      ...options,
      apiToken: secrets.apiToken,
    });
  }

  return new TCGPlayerBrightDataScraper(game, options);
}

export default TCGPlayerBrightDataScraper;
