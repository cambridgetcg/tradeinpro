/**
 * Cardmarket Data Collector
 *
 * Collects card prices from Cardmarket (European market) for cross-platform arbitrage.
 * Uses Apify scraper for data collection since official API is restricted.
 *
 * Service: Apify Cardmarket Card Details Scraper
 * Cost: ~$20/month
 *
 * Note: Requires Apify account and credits
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * DOCUMENTATION REFERENCES (Symbiotic Code ↔ Docs)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * @see {@link file://../../../docs/SCRAPER_ARCHITECTURE_INSIGHTS.md} - COMPARISON DOCUMENT
 *   - Section 1: CardMarket Third-Party Service Approach
 *   - Section 2: Architectural Patterns Comparison
 *   - Section 3: Data Model Comparison (CardmarketSeller, CardmarketPrice)
 *   - Section 4: Cross-Platform Integration (currency, matching)
 *   - Section 5: Error Handling Patterns (Exception-Based)
 *   - Section 7.3: Third-Party Services Trade-offs
 *
 * @see {@link file://../../../../cardmarket/docs/CARDMARKET_SCRAPER_INFRASTRUCTURE.md}
 *   - CardMarket-specific scraper details
 *   - CSS selectors, rate limits
 *
 * @see {@link file://../../../../cardmarket/docs/BRIGHTDATA_INTEGRATION_INSIGHTS.md}
 *   - Alternative: Bright Data for CardMarket (100% success rate)
 *
 * @see {@link file://../../../../cardmarket/docs/CARDMARKET_ALCHEMIST_GRIMOIRE.md}
 *   - Philosophical patterns for CardMarket scraping
 *   - Four Cardinal Essences
 *
 * @see {@link file://../../../../cardmarket/docs/INDEX.md} - CardMarket documentation index
 *
 * Related Code Files:
 * @see {@link file://../scrapers/tcgplayer-search-api-scraper.ts} - TCGPlayer comparison
 * @see {@link file://../apis/base-client.ts} - CurrencyConverter shared utility
 * @see {@link file://../pipeline/hybrid-tcgplayer-pipeline.ts} - Pipeline integration
 *
 * CardMarket Project Files:
 * @see {@link file://../../../../cardmarket/src/scrapers/} - CardMarket scraper implementations
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * @module collectors/cardmarket-collector
 * @since 2026-01-09
 */

import type { GameCode } from '../config/games.js';
import { CurrencyConverter } from '../apis/base-client.js';

/**
 * Cardmarket collector configuration
 */
export interface CardmarketCollectorConfig {
  apifyToken: string;
  actorId?: string;
}

/**
 * Cardmarket seller listing
 */
export interface CardmarketSeller {
  sellerId: string;
  sellerName: string;
  sellerType: 'private' | 'professional' | 'powerseller';
  salesCount: number;
  country: string;
  price: number;
  condition: string;
  language: string;
  quantity: number;
  comments?: string;
}

/**
 * Cardmarket price data
 */
export interface CardmarketPrice {
  cardmarketId: string;
  cardId: string; // Matched card ID (empty until matched)
  name: string;
  setCode: string;
  setName?: string;
  rarity?: string;

  // Price data (EUR)
  priceEur: number;
  trendEur: number;
  avg1dEur: number;
  avg7dEur: number;
  avg30dEur: number;
  lowEur: number;

  // Converted prices
  priceGbp: number;
  priceUsd: number;

  // Listing data
  listingCount: number;
  sellers: CardmarketSeller[];

  // Metadata
  url: string;
  lastUpdated: Date;
}

/**
 * Cross-platform price comparison
 */
export interface CrossPlatformPrice {
  cardId: string;
  name: string;
  setCode: string;

  // TCGplayer (USD)
  tcgplayerPriceUsd: number;
  tcgplayerLowUsd: number;

  // Cardmarket (EUR -> USD)
  cardmarketPriceEur: number;
  cardmarketPriceUsd: number;
  cardmarketLowEur: number;
  cardmarketLowUsd: number;

  // Arbitrage analysis
  priceDiffUsd: number;
  priceDiffPercent: number;
  arbitrageDirection: 'BUY_CARDMARKET' | 'BUY_TCGPLAYER' | 'NO_OPPORTUNITY';
  estimatedProfit: number;

  // FX rate used
  fxRateEurUsd: number;
  lastUpdated: Date;
}

/**
 * Apify actor run response
 */
interface ApifyRunResponse {
  id: string;
  status: string;
  defaultDatasetId: string;
}

/**
 * Apify dataset items response
 */
interface ApifyDatasetResponse {
  items: Array<{
    id: string;
    url: string;
    title: string;
    categories?: string[];
    imageUrl?: string;
    info?: Record<string, string>;
    averagePriceLine?: {
      current?: number | string;
      trend?: number | string;
      '1d'?: number | string;
      '7d'?: number | string;
      '30d'?: number | string;
    };
    sellerData?: Array<{
      sellerId: string;
      sellerName: string;
      sellerType?: string;
      salesCount?: number;
      country?: string;
      price: number | string;
      condition?: string;
      language?: string;
      quantity?: number;
      comments?: string;
    }>;
  }>;
}

/**
 * Cardmarket Data Collector
 */
export class CardmarketCollector {
  private apifyToken: string;
  private actorId: string;
  private apifyBaseUrl = 'https://api.apify.com/v2';

  constructor(config: CardmarketCollectorConfig) {
    this.apifyToken = config.apifyToken;
    this.actorId = config.actorId || 'ecomscrape/cardmarket-card-page-details-scraper';
  }

  /**
   * Scrape Cardmarket data for a list of URLs
   *
   * Cost: ~$0.02 per card scraped
   */
  async scrapeCards(cardUrls: string[]): Promise<CardmarketPrice[]> {
    // Start Apify actor
    const runResponse = await this.startActor(cardUrls);
    const runId = runResponse.id;

    // Wait for completion
    await this.waitForCompletion(runId);

    // Get results
    const datasetId = runResponse.defaultDatasetId;
    const data = await this.getDatasetItems(datasetId);

    return data.items.map((item) => this.parseCardmarketItem(item));
  }

  /**
   * Start Apify actor run
   */
  private async startActor(urls: string[]): Promise<ApifyRunResponse> {
    const response = await fetch(
      `${this.apifyBaseUrl}/acts/${this.actorId}/runs?token=${this.apifyToken}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          startUrls: urls.map((url) => ({ url })),
          max_retries_per_url: 2,
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to start Apify actor: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Wait for actor run to complete
   */
  private async waitForCompletion(runId: string, maxWaitMs: number = 300000): Promise<void> {
    const startTime = Date.now();
    const pollInterval = 5000; // 5 seconds

    while (Date.now() - startTime < maxWaitMs) {
      const response = await fetch(
        `${this.apifyBaseUrl}/actor-runs/${runId}?token=${this.apifyToken}`
      );

      if (!response.ok) {
        throw new Error(`Failed to check run status: ${response.statusText}`);
      }

      const run = await response.json() as { status: string };

      if (run.status === 'SUCCEEDED') {
        return;
      }

      if (run.status === 'FAILED' || run.status === 'ABORTED') {
        throw new Error(`Apify run failed with status: ${run.status}`);
      }

      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }

    throw new Error('Apify run timed out');
  }

  /**
   * Get items from Apify dataset
   */
  private async getDatasetItems(datasetId: string): Promise<ApifyDatasetResponse> {
    const response = await fetch(
      `${this.apifyBaseUrl}/datasets/${datasetId}/items?token=${this.apifyToken}`
    );

    if (!response.ok) {
      throw new Error(`Failed to get dataset items: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Parse Cardmarket item from Apify response
   */
  private parseCardmarketItem(item: ApifyDatasetResponse['items'][0]): CardmarketPrice {
    const priceEur = this.parsePrice(item.averagePriceLine?.current);
    const trendEur = this.parsePrice(item.averagePriceLine?.trend);
    const sellers = (item.sellerData || []).map((s) => ({
      sellerId: s.sellerId,
      sellerName: s.sellerName,
      sellerType: this.mapSellerType(s.sellerType),
      salesCount: s.salesCount || 0,
      country: s.country || '',
      price: this.parsePrice(s.price),
      condition: s.condition || 'NM',
      language: s.language || 'English',
      quantity: s.quantity || 1,
      comments: s.comments,
    }));

    const lowEur = sellers.length > 0
      ? Math.min(...sellers.map((s) => s.price))
      : priceEur;

    // Convert to other currencies
    const priceUsd = CurrencyConverter.eurToUsd(priceEur);
    const priceGbp = CurrencyConverter.eurToGbp(priceEur);

    return {
      cardmarketId: item.id,
      cardId: '', // Will be matched later
      name: this.extractCardName(item.title),
      setCode: this.extractSetCode(item.title),
      setName: item.categories?.[1],
      rarity: item.info?.Rarity,
      priceEur,
      trendEur,
      avg1dEur: this.parsePrice(item.averagePriceLine?.['1d']),
      avg7dEur: this.parsePrice(item.averagePriceLine?.['7d']),
      avg30dEur: this.parsePrice(item.averagePriceLine?.['30d']),
      lowEur,
      priceGbp,
      priceUsd,
      listingCount: sellers.length,
      sellers,
      url: item.url,
      lastUpdated: new Date(),
    };
  }

  /**
   * Build Cardmarket URL for a card
   */
  buildCardmarketUrl(cardName: string, game: GameCode, setCode?: string): string {
    const gameMapping: Record<GameCode, string> = {
      onepiece: 'OnePiece',
      pokemon: 'Pokemon',
      mtg: 'Magic',
      yugioh: 'YuGiOh',
      lorcana: 'Lorcana',
      digimon: 'Digimon',
      'flesh-and-blood': 'FleshAndBlood',
      'dragon-ball': 'DragonBall',
    };

    const gamePath = gameMapping[game];
    if (!gamePath) {
      throw new Error(`Game ${game} not supported on Cardmarket`);
    }

    const encodedName = encodeURIComponent(cardName.replace(/\s+/g, '-'));
    const basePath = `https://www.cardmarket.com/en/${gamePath}/Products/Singles`;

    if (setCode) {
      return `${basePath}/${setCode}/${encodedName}`;
    }

    return `${basePath}/${encodedName}`;
  }

  /**
   * Match Cardmarket prices to TCGplayer cards
   */
  matchToTcgplayer(
    cardmarketPrices: CardmarketPrice[],
    tcgplayerCards: Map<string, {
      cardId: string;
      name: string;
      marketPrice: number;
      lowPrice: number;
    }>
  ): Map<string, CrossPlatformPrice> {
    const matched = new Map<string, CrossPlatformPrice>();
    const fxRate = CurrencyConverter.rates.EUR_TO_USD;

    for (const cmCard of cardmarketPrices) {
      // Try to match by normalized name
      const normalizedName = this.normalizeName(cmCard.name);

      for (const [cardId, tcgCard] of tcgplayerCards) {
        const tcgNormalized = this.normalizeName(tcgCard.name);

        if (normalizedName === tcgNormalized) {
          const cardmarketPriceUsd = cmCard.priceEur * fxRate;
          const cardmarketLowUsd = cmCard.lowEur * fxRate;

          const priceDiffUsd = tcgCard.marketPrice - cardmarketPriceUsd;
          const priceDiffPercent = cardmarketPriceUsd > 0
            ? (priceDiffUsd / cardmarketPriceUsd) * 100
            : 0;

          // Determine arbitrage direction (accounting for fees and shipping)
          // TCGplayer fees: ~13%, Cardmarket fees: ~5%, Shipping: ~$4-5
          const minSpreadForArbitrage = 15; // 15% minimum spread

          let arbitrageDirection: 'BUY_CARDMARKET' | 'BUY_TCGPLAYER' | 'NO_OPPORTUNITY';
          let estimatedProfit = 0;

          if (priceDiffPercent > minSpreadForArbitrage) {
            // TCGplayer more expensive - buy from Cardmarket
            arbitrageDirection = 'BUY_CARDMARKET';
            estimatedProfit = priceDiffUsd * 0.75 - 5; // Account for fees and shipping
          } else if (priceDiffPercent < -minSpreadForArbitrage) {
            // Cardmarket more expensive - buy from TCGplayer
            arbitrageDirection = 'BUY_TCGPLAYER';
            estimatedProfit = Math.abs(priceDiffUsd) * 0.80 - 5;
          } else {
            arbitrageDirection = 'NO_OPPORTUNITY';
          }

          matched.set(cardId, {
            cardId,
            name: tcgCard.name,
            setCode: cmCard.setCode,
            tcgplayerPriceUsd: tcgCard.marketPrice,
            tcgplayerLowUsd: tcgCard.lowPrice,
            cardmarketPriceEur: cmCard.priceEur,
            cardmarketPriceUsd,
            cardmarketLowEur: cmCard.lowEur,
            cardmarketLowUsd,
            priceDiffUsd,
            priceDiffPercent,
            arbitrageDirection,
            estimatedProfit: Math.max(0, estimatedProfit),
            fxRateEurUsd: fxRate,
            lastUpdated: new Date(),
          });

          // Also update the cardId in the Cardmarket price
          cmCard.cardId = cardId;
          break;
        }
      }
    }

    return matched;
  }

  /**
   * Find arbitrage opportunities
   */
  findArbitrageOpportunities(
    crossPlatformPrices: Map<string, CrossPlatformPrice>,
    minProfit: number = 5
  ): CrossPlatformPrice[] {
    const opportunities: CrossPlatformPrice[] = [];

    for (const price of crossPlatformPrices.values()) {
      if (
        price.arbitrageDirection !== 'NO_OPPORTUNITY' &&
        price.estimatedProfit >= minProfit
      ) {
        opportunities.push(price);
      }
    }

    // Sort by estimated profit (descending)
    opportunities.sort((a, b) => b.estimatedProfit - a.estimatedProfit);

    return opportunities;
  }

  /**
   * Parse price from various formats
   */
  private parsePrice(value: unknown): number {
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
      // Remove currency symbols and parse
      const cleaned = value.replace(/[€$£,\s]/g, '').replace(',', '.');
      return parseFloat(cleaned) || 0;
    }
    return 0;
  }

  /**
   * Normalize card name for matching
   */
  private normalizeName(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .replace(/\s+/g, '');
  }

  /**
   * Extract card name from Cardmarket title
   */
  private extractCardName(title: string): string {
    // Cardmarket titles format: "Card Name (Set Code)"
    const match = title.match(/^(.+?)\s*\(/);
    return match ? match[1].trim() : title;
  }

  /**
   * Extract set code from Cardmarket title
   */
  private extractSetCode(title: string): string {
    const match = title.match(/\(([A-Z0-9-]+)\)/);
    return match ? match[1] : '';
  }

  /**
   * Map seller type to standardized format
   */
  private mapSellerType(type?: string): 'private' | 'professional' | 'powerseller' {
    if (!type) return 'private';
    const lower = type.toLowerCase();
    if (lower.includes('power')) return 'powerseller';
    if (lower.includes('pro')) return 'professional';
    return 'private';
  }

  /**
   * Update exchange rates
   */
  async updateExchangeRates(): Promise<void> {
    await CurrencyConverter.fetchLatestRates();
  }
}

/**
 * Create Cardmarket collector instance
 */
export function createCardmarketCollector(
  config: CardmarketCollectorConfig
): CardmarketCollector {
  return new CardmarketCollector(config);
}

export default CardmarketCollector;
