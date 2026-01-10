/**
 * Hybrid TCGPlayer Pipeline
 *
 * Combines JustTCG API (primary) with Search API/Bright Data scraper (fallback)
 * for resilient TCGPlayer price data collection.
 *
 * Strategy:
 * 1. Try JustTCG API first (faster, cheaper per request, more reliable)
 * 2. If JustTCG fails or doesn't cover a game, fall back to Search API
 * 3. Merge and deduplicate results
 * 4. Save to database with source attribution
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * DOCUMENTATION REFERENCES (Symbiotic Code ↔ Docs)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * @see {@link file://../../../docs/HYBRID_PIPELINE_ARCHITECTURE.md} - PRIMARY DOCUMENTATION
 *   - Complete hybrid pipeline design
 *   - JustTCG vs Search API trade-offs
 *   - Fallback strategy diagram
 *   - Cost analysis
 *
 * @see {@link file://../../../docs/SCRAPER_ARCHITECTURE_INSIGHTS.md} - Patterns used
 *   - Section 2.4: Retry Logic (Exponential Backoff)
 *   - Section 5: Error Handling Patterns
 *   - Section 8: Recommended Architecture
 *
 * @see {@link file://../../../docs/AWS_INFRASTRUCTURE.md} - Deployment context
 *   - Lambda integration
 *   - S3 storage
 *   - Database loader
 *
 * @see {@link file://../../../docs/GAP_FILLING_IMPLEMENTATION_PLAN.md} - Data gaps
 *   - When to use fallback sources
 *   - Missing data strategies
 *
 * Related Code Files:
 * @see {@link file://../apis/justtcg-client.ts} - Primary data source
 * @see {@link file://../scrapers/tcgplayer-search-api-scraper.ts} - Fallback source (recommended)
 * @see {@link file://../scrapers/tcgplayer-brightdata-scraper.ts} - Legacy fallback (deprecated)
 * @see {@link file://../resilience/circuit-breaker.ts} - Failure handling
 * @see {@link file://../../scripts/daily-archive-local.ts} - Usage example
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * @module pipeline/hybrid-tcgplayer-pipeline
 * @since 2026-01-09
 */

import type { GameCode } from '../config/games.js';
import type { SetInfo } from '../config/sets.js';
import { getSetsByGame } from '../config/sets.js';
import { JustTcgClient, createJustTcgClient, type JustTcgCard } from '../apis/justtcg-client.js';
import { createTCGPlayerScraper, type TCGPlayerCardData, type TCGPlayerScraperConfig } from '../scrapers/tcgplayer-brightdata-scraper.js';
import { CircuitBreaker, CircuitBreakerRegistry } from '../resilience/circuit-breaker.js';
import { CurrencyConverter } from '../apis/base-client.js';

// ============================================================================
// Types
// ============================================================================

export interface HybridPipelineConfig {
  game: GameCode;
  justTcgApiKey?: string;
  brightdataToken?: string;
  preferApi?: boolean;
  enableFallback?: boolean;
  maxRetries?: number;
  circuitBreakerConfig?: {
    failureThreshold: number;
    timeout: number;
  };
}

export interface UnifiedCardData {
  // Identity
  cardId: string;
  cardName: string;
  game: GameCode;
  setCode: string;
  setName: string;
  cardNumber: string;
  variantType: string | null;
  rarity: string | null;
  // Prices (USD and GBP)
  marketPriceUsd: number | null;
  marketPriceGbp: number | null;
  lowPriceUsd: number | null;
  lowPriceGbp: number | null;
  // Metadata
  totalListings: number | null;
  totalSellers: number | null;
  imageUrl: string | null;
  productUrl: string | null;
  // Source tracking
  source: 'justtcg' | 'brightdata' | 'merged';
  sourceUrl: string;
  scrapedAt: string;
  // Historical data (if from JustTCG)
  statistics?: {
    change24h?: number;
    change7d?: number;
    change30d?: number;
    change90d?: number;
    avg?: number;
    stdDev?: number;
  };
  priceHistory?: Array<{ price: number; timestamp: Date }>;
}

export interface PipelineResult {
  success: boolean;
  game: GameCode;
  setsProcessed: number;
  cardsCollected: number;
  apiSource: 'justtcg' | 'brightdata' | 'none';
  fallbackUsed: boolean;
  errors: string[];
  cards: UnifiedCardData[];
  duration: number;
}

export type DataSourceStatus = 'available' | 'unavailable' | 'circuit_open';

// ============================================================================
// Hybrid Pipeline Class
// ============================================================================

export class HybridTCGPlayerPipeline {
  private config: HybridPipelineConfig;
  private circuitRegistry: CircuitBreakerRegistry;
  private justTcgClient: JustTcgClient | null = null;
  private errors: string[] = [];

  constructor(config: HybridPipelineConfig) {
    this.config = {
      preferApi: true,
      enableFallback: true,
      maxRetries: 3,
      ...config,
    };

    this.circuitRegistry = new CircuitBreakerRegistry({
      failureThreshold: config.circuitBreakerConfig?.failureThreshold || 3,
      timeout: config.circuitBreakerConfig?.timeout || 60000,
    });

    // Initialize JustTCG client if API key is available
    if (this.config.justTcgApiKey) {
      this.justTcgClient = createJustTcgClient({
        game: this.config.game,
        apiKey: this.config.justTcgApiKey,
      });
    }
  }

  /**
   * Check data source availability
   */
  async checkSourceStatus(): Promise<{
    justtcg: DataSourceStatus;
    brightdata: DataSourceStatus;
  }> {
    const status = {
      justtcg: 'unavailable' as DataSourceStatus,
      brightdata: 'unavailable' as DataSourceStatus,
    };

    // Check JustTCG
    const justTcgCircuit = this.circuitRegistry.getCircuit('justtcg');
    if (!this.justTcgClient) {
      status.justtcg = 'unavailable';
    } else if (!justTcgCircuit.canRequest()) {
      status.justtcg = 'circuit_open';
    } else {
      status.justtcg = 'available';
    }

    // Check Bright Data
    const brightdataCircuit = this.circuitRegistry.getCircuit('brightdata');
    if (!this.config.brightdataToken) {
      status.brightdata = 'unavailable';
    } else if (!brightdataCircuit.canRequest()) {
      status.brightdata = 'circuit_open';
    } else {
      status.brightdata = 'available';
    }

    return status;
  }

  /**
   * Fetch cards using JustTCG API
   */
  private async fetchFromJustTCG(setCode?: string): Promise<UnifiedCardData[]> {
    if (!this.justTcgClient) {
      throw new Error('JustTCG client not initialized');
    }

    const circuit = this.circuitRegistry.getCircuit('justtcg');
    if (!circuit.canRequest()) {
      throw new Error('JustTCG circuit breaker is open');
    }

    console.log(`   📡 Fetching from JustTCG API${setCode ? ` (set: ${setCode})` : ''}...`);

    try {
      const cards: JustTcgCard[] = [];

      if (setCode) {
        const setCards = await this.justTcgClient.getCardsBySet(setCode);
        cards.push(...(setCards as unknown as JustTcgCard[]));
      } else {
        // Fetch all sets for the game
        const sets = await this.justTcgClient.getSets();
        for (const set of sets) {
          const setCards = await this.justTcgClient.getCardsBySet(set.code);
          cards.push(...(setCards as unknown as JustTcgCard[]));
        }
      }

      circuit.recordSuccess();
      console.log(`   ✅ JustTCG: ${cards.length} cards retrieved`);

      return cards.map(card => this.normalizeJustTCGCard(card));
    } catch (error) {
      circuit.recordFailure();
      throw error;
    }
  }

  /**
   * Fetch cards using Bright Data scraper
   */
  private async fetchFromBrightData(setCode?: string, options?: { maxCards?: number }): Promise<UnifiedCardData[]> {
    if (!this.config.brightdataToken) {
      throw new Error('Bright Data token not configured');
    }

    const circuit = this.circuitRegistry.getCircuit('brightdata');
    if (!circuit.canRequest()) {
      throw new Error('Bright Data circuit breaker is open');
    }

    console.log(`   🌐 Fetching via Bright Data scraper${setCode ? ` (set: ${setCode})` : ''}...`);

    try {
      const scraper = await createTCGPlayerScraper(this.config.game, {
        apiToken: this.config.brightdataToken,
      } as TCGPlayerScraperConfig);

      let cards: TCGPlayerCardData[];
      if (setCode) {
        cards = await scraper.scrapeSet(setCode, { maxCards: options?.maxCards });
      } else {
        cards = await scraper.scrapeSets();
      }

      await scraper.close();

      circuit.recordSuccess();
      console.log(`   ✅ Bright Data: ${cards.length} cards scraped`);

      return cards.map(card => this.normalizeBrightDataCard(card));
    } catch (error) {
      circuit.recordFailure();
      throw error;
    }
  }

  /**
   * Normalize JustTCG card to unified format
   */
  private normalizeJustTCGCard(card: JustTcgCard): UnifiedCardData {
    // Extract best price from variants
    const nmVariant = card.variants?.find(v =>
      v.condition === 'Near Mint' && v.printing === 'Normal'
    );
    const anyVariant = card.variants?.[0];
    const bestVariant = nmVariant || anyVariant;

    const priceUsd = bestVariant?.price?.usd ?? null;
    const priceGbp = priceUsd ? CurrencyConverter.usdToGbp(priceUsd) : null;

    return {
      cardId: card.id,
      cardName: card.name,
      game: this.config.game,
      setCode: card.set.code,
      setName: card.set.name,
      cardNumber: card.number,
      variantType: this.detectVariantFromCard(card),
      rarity: card.rarity || null,
      marketPriceUsd: priceUsd,
      marketPriceGbp: priceGbp,
      lowPriceUsd: priceUsd, // JustTCG gives single price
      lowPriceGbp: priceGbp,
      totalListings: card.variants?.length || null,
      totalSellers: null,
      imageUrl: card.image_url || null,
      productUrl: card.tcgplayer_url || null,
      source: 'justtcg',
      sourceUrl: `https://api.justtcg.com/v1/cards/${card.id}`,
      scrapedAt: new Date().toISOString(),
      // Include statistics if available
      statistics: undefined, // Would need to fetch with include_statistics=true
      priceHistory: undefined, // Would need to fetch with include_price_history=true
    };
  }

  /**
   * Normalize Bright Data scraped card to unified format
   */
  private normalizeBrightDataCard(card: TCGPlayerCardData): UnifiedCardData {
    return {
      cardId: card.cardId,
      cardName: card.cardName,
      game: card.game,
      setCode: card.setCode,
      setName: card.setName,
      cardNumber: card.cardNumber,
      variantType: card.variantType,
      rarity: card.rarity,
      marketPriceUsd: card.marketPriceUsd,
      marketPriceGbp: card.marketPriceGbp,
      lowPriceUsd: card.lowPriceUsd,
      lowPriceGbp: card.lowPriceGbp,
      totalListings: card.totalListings,
      totalSellers: card.totalSellers,
      imageUrl: card.imageUrl,
      productUrl: card.sourceUrl,
      source: 'brightdata',
      sourceUrl: card.sourceUrl,
      scrapedAt: card.scrapedAt,
    };
  }

  /**
   * Detect variant type from JustTCG card
   */
  private detectVariantFromCard(card: JustTcgCard): string | null {
    const nameLower = card.name.toLowerCase();

    if (nameLower.includes('parallel')) return 'parallel';
    if (nameLower.includes('alternate art')) return 'alternate-art';
    if (nameLower.includes('manga')) return 'manga';
    if (nameLower.includes('special')) return 'sp';

    // Check variants for foil
    const hasFoil = card.variants?.some(v => v.printing === 'Foil');
    if (hasFoil) return 'foil';

    return null;
  }

  /**
   * Merge cards from multiple sources, preferring API data
   */
  private mergeCards(
    apiCards: UnifiedCardData[],
    scraperCards: UnifiedCardData[]
  ): UnifiedCardData[] {
    const cardMap = new Map<string, UnifiedCardData>();

    // Add scraper cards first (lower priority)
    for (const card of scraperCards) {
      cardMap.set(card.cardId.toLowerCase(), card);
    }

    // Override with API cards (higher priority)
    for (const card of apiCards) {
      const existing = cardMap.get(card.cardId.toLowerCase());
      if (existing) {
        // Merge data, preferring API but filling gaps from scraper
        cardMap.set(card.cardId.toLowerCase(), {
          ...existing,
          ...card,
          source: 'merged',
          totalListings: card.totalListings || existing.totalListings,
          totalSellers: card.totalSellers || existing.totalSellers,
          imageUrl: card.imageUrl || existing.imageUrl,
        });
      } else {
        cardMap.set(card.cardId.toLowerCase(), card);
      }
    }

    return Array.from(cardMap.values());
  }

  /**
   * Run the hybrid pipeline for a specific set or all sets
   */
  async run(options?: {
    setCode?: string;
    maxCards?: number;
    forceSource?: 'justtcg' | 'brightdata';
  }): Promise<PipelineResult> {
    const startTime = Date.now();
    const result: PipelineResult = {
      success: false,
      game: this.config.game,
      setsProcessed: 0,
      cardsCollected: 0,
      apiSource: 'none',
      fallbackUsed: false,
      errors: [],
      cards: [],
      duration: 0,
    };

    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log(`  🔄 Hybrid TCGPlayer Pipeline - ${this.config.game.toUpperCase()}`);
    console.log('═══════════════════════════════════════════════════════════════');

    const status = await this.checkSourceStatus();
    console.log(`  JustTCG: ${status.justtcg}`);
    console.log(`  Bright Data: ${status.brightdata}`);
    console.log(`  Set: ${options?.setCode || 'all released sets'}`);
    console.log('═══════════════════════════════════════════════════════════════\n');

    let apiCards: UnifiedCardData[] = [];
    let scraperCards: UnifiedCardData[] = [];

    // Determine which source to use
    const useJustTCG = !options?.forceSource || options.forceSource === 'justtcg';
    const useScraper = !options?.forceSource || options.forceSource === 'brightdata';

    // Try JustTCG API first (if available and not forced to scraper)
    if (useJustTCG && status.justtcg === 'available' && this.config.preferApi) {
      try {
        apiCards = await this.fetchFromJustTCG(options?.setCode);
        result.apiSource = 'justtcg';
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        this.errors.push(`JustTCG failed: ${msg}`);
        console.log(`   ⚠️ JustTCG failed: ${msg}`);
      }
    }

    // Fall back to scraper if API failed or returned no data
    const needsFallback = apiCards.length === 0 && this.config.enableFallback;
    if (useScraper && needsFallback && status.brightdata === 'available') {
      try {
        scraperCards = await this.fetchFromBrightData(options?.setCode, {
          maxCards: options?.maxCards,
        });
        result.apiSource = result.apiSource === 'none' ? 'brightdata' : result.apiSource;
        result.fallbackUsed = true;
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        this.errors.push(`Bright Data failed: ${msg}`);
        console.log(`   ⚠️ Bright Data failed: ${msg}`);
      }
    }

    // Merge results
    if (apiCards.length > 0 && scraperCards.length > 0) {
      result.cards = this.mergeCards(apiCards, scraperCards);
    } else {
      result.cards = apiCards.length > 0 ? apiCards : scraperCards;
    }

    // Calculate stats
    result.cardsCollected = result.cards.length;
    result.success = result.cardsCollected > 0;
    result.errors = [...this.errors];
    result.duration = Date.now() - startTime;

    // Count sets processed
    const uniqueSets = new Set(result.cards.map(c => c.setCode));
    result.setsProcessed = uniqueSets.size;

    // Print summary
    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('  📊 PIPELINE COMPLETE');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`  Status: ${result.success ? '✅ SUCCESS' : '❌ FAILED'}`);
    console.log(`  Source: ${result.apiSource}${result.fallbackUsed ? ' (with fallback)' : ''}`);
    console.log(`  Sets processed: ${result.setsProcessed}`);
    console.log(`  Cards collected: ${result.cardsCollected}`);
    console.log(`  Duration: ${(result.duration / 1000).toFixed(1)}s`);
    if (result.errors.length > 0) {
      console.log(`  Errors: ${result.errors.length}`);
    }
    console.log('═══════════════════════════════════════════════════════════════\n');

    return result;
  }

  /**
   * Get available sets for the current game
   */
  getAvailableSets(): SetInfo[] {
    return getSetsByGame(this.config.game).filter(s => s.isReleased);
  }

  /**
   * Get circuit breaker status
   */
  getCircuitStatus(): Map<string, { state: string; failures: number }> {
    const status = new Map<string, { state: string; failures: number }>();

    const justTcgCircuit = this.circuitRegistry.getCircuit('justtcg');
    status.set('justtcg', {
      state: justTcgCircuit.getState(),
      failures: justTcgCircuit.getStats().failures,
    });

    const brightdataCircuit = this.circuitRegistry.getCircuit('brightdata');
    status.set('brightdata', {
      state: brightdataCircuit.getState(),
      failures: brightdataCircuit.getStats().failures,
    });

    return status;
  }

  /**
   * Reset circuit breakers
   */
  resetCircuits(): void {
    this.circuitRegistry.resetAll();
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export async function createHybridPipeline(
  game: GameCode,
  options?: {
    justTcgApiKey?: string;
    brightdataToken?: string;
  }
): Promise<HybridTCGPlayerPipeline> {
  // Auto-load secrets from environment or AWS
  const justTcgApiKey = options?.justTcgApiKey
    || process.env.JUSTTCG_API_KEY
    || undefined;

  const brightdataToken = options?.brightdataToken
    || process.env.BRIGHTDATA_TOKEN
    || undefined;

  return new HybridTCGPlayerPipeline({
    game,
    justTcgApiKey,
    brightdataToken,
    preferApi: true,
    enableFallback: true,
  });
}

export default HybridTCGPlayerPipeline;
