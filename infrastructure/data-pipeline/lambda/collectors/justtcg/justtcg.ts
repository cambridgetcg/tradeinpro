/**
 * JustTCG API Data Collector Lambda
 *
 * Collects price data from JustTCG API - a reliable aggregator with
 * condition-specific pricing updated every 6 hours.
 *
 * Features:
 * - Multi-game support (One Piece, Pokemon, MTG, etc.)
 * - Condition-specific pricing (NM, LP, MP, HP, DMG)
 * - 6-hour update frequency
 * - Variant support (foil, parallel, etc.)
 *
 * API Documentation: https://justtcg.com/docs
 *
 * Pricing Tiers:
 * - Free: 1,000 req/month, 100/day, 10/min
 * - Starter ($9.90): 10,000 req/month
 * - Professional ($24.90): 50,000 req/month
 * - Enterprise ($49.50+): 500,000+ req/month
 */

import { Handler, ScheduledEvent } from "aws-lambda";
import {
  getSecrets,
  putToKinesis,
  batchUpdateCurrentPrices,
  writePriceToTimestream,
  normalizePrice,
  fetchLiveFxRates,
  normalizeCardId,
  normalizeCondition,
  normalizeConditionWithTracking,
  RateLimiter,
  withRetry,
  nowIso,
  sleep,
  dataQualityTracker,
  detectVariantType,
  PriceEvent,
} from "/opt/nodejs/utils";

// =============================================================================
// CONFIGURATION
// =============================================================================

const JUSTTCG_API_BASE = "https://api.justtcg.com/v1";
const GAME_ID = "one-piece-card-game";

const PRICE_STREAM = process.env.PRICE_STREAM_NAME!;
const CURRENT_PRICES_TABLE = process.env.CURRENT_PRICES_TABLE!;
const TIMESTREAM_DATABASE = process.env.TIMESTREAM_DATABASE!;

// Rate limiter based on plan (default to free tier: 10 req/min)
const rateLimiter = new RateLimiter(10, 10);

// =============================================================================
// TYPES
// =============================================================================

interface JustTcgGame {
  id: string;
  name: string;
  game_value_usd?: number;
}

interface JustTcgSet {
  id: string;
  name: string;
  code: string;
  game_id: string;
  release_date?: string;
  card_count?: number;
  set_value_usd?: number;
}

interface JustTcgCardVariant {
  id: string;
  condition: string;      // "NM", "LP", "MP", "HP", "DMG"
  printing: string;       // "Normal", "Foil", "1st Edition", etc.
  price_usd?: number;
  price_eur?: number;
  price_gbp?: number;
  tcgplayer_sku_id?: string;
  last_updated?: string;
}

interface JustTcgCard {
  id: string;
  name: string;
  set_id: string;
  set_code: string;
  card_number: string;
  rarity?: string;
  card_type?: string;
  image_url?: string;
  variants: JustTcgCardVariant[];
  scryfall_id?: string;
  mtgjson_id?: string;
}

interface JustTcgResponse<T> {
  data: T[];
  meta?: {
    total: number;
    page: number;
    per_page: number;
    last_page: number;
  };
}

// =============================================================================
// API CLIENT
// =============================================================================

class JustTcgClient {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  private async request<T>(endpoint: string, params?: Record<string, string>): Promise<T> {
    await rateLimiter.acquire();

    const url = new URL(`${JUSTTCG_API_BASE}${endpoint}`);
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        url.searchParams.set(key, value);
      });
    }

    const response = await withRetry(
      async () => {
        const res = await fetch(url.toString(), {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            Accept: "application/json",
            "Content-Type": "application/json",
          },
        });

        if (!res.ok) {
          if (res.status === 401) {
            throw new Error("Invalid API key");
          }
          if (res.status === 429) {
            const retryAfter = res.headers.get("Retry-After") || "60";
            console.warn(`Rate limited. Retry after ${retryAfter}s`);
            throw new Error(`Rate limited. Retry after ${retryAfter}s`);
          }
          throw new Error(`HTTP ${res.status}: ${await res.text()}`);
        }

        return res.json();
      },
      { maxRetries: 3, baseDelayMs: 2000 }
    );

    return response;
  }

  /**
   * Get available games
   */
  async getGames(): Promise<JustTcgGame[]> {
    const response = await this.request<JustTcgResponse<JustTcgGame>>("/games");
    return response.data || [];
  }

  /**
   * Get sets for a game
   */
  async getSets(gameId: string = GAME_ID): Promise<JustTcgSet[]> {
    const response = await this.request<JustTcgResponse<JustTcgSet>>("/sets", {
      game: gameId,
    });
    return response.data || [];
  }

  /**
   * Get cards with variants and pricing
   */
  async getCards(
    setId: string,
    options: {
      page?: number;
      per_page?: number;
      include_variants?: boolean;
    } = {}
  ): Promise<{ cards: JustTcgCard[]; meta?: { total: number; last_page: number } }> {
    const params: Record<string, string> = {
      set: setId,
      include_variants: (options.include_variants ?? true).toString(),
    };

    if (options.page) params.page = options.page.toString();
    if (options.per_page) params.per_page = options.per_page.toString();

    const response = await this.request<JustTcgResponse<JustTcgCard>>("/cards", params);

    return {
      cards: response.data || [],
      meta: response.meta,
    };
  }

  /**
   * Get single card by ID
   */
  async getCard(cardId: string): Promise<JustTcgCard | null> {
    try {
      const response = await this.request<{ data: JustTcgCard }>(`/cards/${cardId}`);
      return response.data;
    } catch {
      return null;
    }
  }

  /**
   * Search cards
   */
  async searchCards(
    query: string,
    gameId: string = GAME_ID
  ): Promise<JustTcgCard[]> {
    const response = await this.request<JustTcgResponse<JustTcgCard>>("/cards", {
      game: gameId,
      q: query,
      include_variants: "true",
    });
    return response.data || [];
  }

  /**
   * Get cards updated since a timestamp (for incremental sync)
   */
  async getUpdatedCards(
    since: number, // Unix timestamp
    gameId: string = GAME_ID
  ): Promise<JustTcgCard[]> {
    const allCards: JustTcgCard[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const response = await this.request<JustTcgResponse<JustTcgCard>>("/cards", {
        game: gameId,
        updated_after: since.toString(),
        page: page.toString(),
        per_page: "100",
        include_variants: "true",
      });

      if (response.data && response.data.length > 0) {
        allCards.push(...response.data);
        hasMore = response.meta ? page < response.meta.last_page : false;
        page++;
      } else {
        hasMore = false;
      }

      await sleep(1000); // Respect rate limits
    }

    return allCards;
  }
}

// =============================================================================
// DATA PROCESSING
// =============================================================================

interface ExtendedPriceEvent extends PriceEvent {
  rarity?: string;
  cardType?: string;
  printing?: string;
  sourceQuality?: string;
  priceConfidence?: string;
  tcgplayerSkuId?: string;
}

function mapPrintingToVariant(printing: string): string {
  const printingLower = printing.toLowerCase();

  if (printingLower.includes("foil") || printingLower.includes("holo")) {
    return "parallel";
  }
  if (printingLower.includes("alternate") || printingLower.includes("alt art")) {
    return "parallel";
  }
  if (printingLower.includes("manga")) {
    return "manga";
  }
  if (printingLower.includes("sp") || printingLower.includes("special")) {
    return "sp";
  }
  if (printingLower.includes("secret")) {
    return "spr";
  }

  return "regular";
}

function extractSetAndNumber(card: JustTcgCard): { setCode: string; cardNumber: string } {
  // Use the card's set_code and card_number fields
  if (card.set_code && card.card_number) {
    return {
      setCode: card.set_code.toUpperCase(),
      cardNumber: card.card_number,
    };
  }

  // Try to parse from card name or ID
  const match = card.name.match(/([A-Z]+\d+)-(\d+)/i) ||
                card.id.match(/([A-Z]+\d+)-(\d+)/i);

  if (match) {
    return {
      setCode: match[1].toUpperCase(),
      cardNumber: match[2],
    };
  }

  return { setCode: "", cardNumber: "" };
}

function createPriceEventsFromJustTcg(
  card: JustTcgCard,
  collectedAt: string
): ExtendedPriceEvent[] {
  const source = "justtcg";
  const events: ExtendedPriceEvent[] = [];

  const { setCode, cardNumber } = extractSetAndNumber(card);

  if (!setCode || !cardNumber) {
    dataQualityTracker.recordDropped(source, "invalid_card_id", {
      title: card.name,
      rawData: { id: card.id, set_code: card.set_code, card_number: card.card_number },
    });
    return events;
  }

  // Process each variant (condition + printing combination)
  for (const variant of card.variants) {
    const price = variant.price_usd;

    if (!price || price <= 0) {
      dataQualityTracker.recordDropped(source, "no_price_data", {
        title: `${card.name} [${variant.condition} ${variant.printing}]`,
      });
      continue;
    }

    // Determine variant type from printing
    const variantType = mapPrintingToVariant(variant.printing);

    // Build card ID
    const cardId = normalizeCardId(setCode, cardNumber, variantType);

    // Normalize condition
    const conditionResult = normalizeConditionWithTracking(variant.condition);
    const condition = conditionResult.isKnown ? conditionResult.condition : "NM";

    // Normalize price
    const { priceUsd, priceGbp } = normalizePrice(price, "USD");

    // Track success
    dataQualityTracker.recordSuccess(source, {
      fuzzyMatched: false,
      unknownCondition: !conditionResult.isKnown,
    });

    events.push({
      eventType: "price",
      source,
      cardId,
      externalId: variant.id,
      name: card.name,
      setCode,
      cardNumber,
      variantType,
      condition,
      language: "EN",
      price,
      currency: "USD",
      priceUsd,
      priceGbp,
      listingsCount: undefined,
      sellerId: undefined,
      timestamp: variant.last_updated || collectedAt,
      collectedAt,
      // Extended fields
      rarity: card.rarity,
      cardType: card.card_type,
      printing: variant.printing,
      sourceQuality: "high",
      priceConfidence: "high", // JustTCG is reliable
      tcgplayerSkuId: variant.tcgplayer_sku_id,
    });
  }

  return events;
}

// =============================================================================
// MAIN HANDLER
// =============================================================================

export const handler: Handler<ScheduledEvent> = async (event) => {
  console.log("JustTCG collector started", { event });
  const collectedAt = nowIso();

  // Reset data quality tracker
  dataQualityTracker.reset();

  try {
    // Fetch live FX rates
    await fetchLiveFxRates();

    // Get API credentials
    const secrets = await getSecrets();
    if (!secrets.justtcg_api_key) {
      throw new Error("JustTCG API key not configured");
    }

    const client = new JustTcgClient(secrets.justtcg_api_key);

    // Get all sets for One Piece
    console.log("Fetching sets...");
    const sets = await client.getSets(GAME_ID);
    console.log(`Found ${sets.length} sets`);

    const allPriceEvents: ExtendedPriceEvent[] = [];
    let totalCardsProcessed = 0;

    // Process each set
    for (const set of sets) {
      console.log(`Processing set: ${set.name} (${set.code})`);

      let page = 1;
      let hasMore = true;

      while (hasMore) {
        try {
          const { cards, meta } = await client.getCards(set.id, {
            page,
            per_page: 50,
            include_variants: true,
          });

          if (cards.length === 0) {
            hasMore = false;
            continue;
          }

          // Process each card
          for (const card of cards) {
            const priceEvents = createPriceEventsFromJustTcg(card, collectedAt);
            allPriceEvents.push(...priceEvents);
            totalCardsProcessed++;
          }

          // Check pagination
          hasMore = meta ? page < meta.last_page : false;
          page++;

          console.log(`  Page ${page - 1}: ${cards.length} cards (${totalCardsProcessed} total)`);

          // Respect rate limits
          await sleep(1000);
        } catch (error) {
          console.warn(`Error processing set ${set.code} page ${page}:`, error);
          hasMore = false;
        }
      }
    }

    console.log(`Total price events: ${allPriceEvents.length}`);

    // Log data quality
    dataQualityTracker.logSummary();
    const qualityMetrics = dataQualityTracker.getMetrics();
    const droppedSample = dataQualityTracker.getDroppedRecords().slice(0, 10);

    // Send to Kinesis
    if (allPriceEvents.length > 0) {
      await putToKinesis(PRICE_STREAM, allPriceEvents);
    }

    // Update DynamoDB
    if (allPriceEvents.length > 0) {
      await batchUpdateCurrentPrices(CURRENT_PRICES_TABLE, allPriceEvents);
    }

    // Write to Timestream
    if (allPriceEvents.length > 0) {
      await writePriceToTimestream(
        TIMESTREAM_DATABASE,
        "price_history",
        allPriceEvents
      );
    }

    // Calculate stats
    const stats = {
      setsProcessed: sets.length,
      cardsProcessed: totalCardsProcessed,
      priceEvents: allPriceEvents.length,
      byCondition: {} as Record<string, number>,
      avgPrice: 0,
      highValueCards: 0,
    };

    for (const event of allPriceEvents) {
      stats.byCondition[event.condition] = (stats.byCondition[event.condition] || 0) + 1;
    }

    if (allPriceEvents.length > 0) {
      stats.avgPrice = allPriceEvents.reduce((sum, e) => sum + e.priceUsd, 0) / allPriceEvents.length;
      stats.highValueCards = allPriceEvents.filter(e => e.priceUsd > 20).length;
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        priceEvents: allPriceEvents.length,
        stats,
        collectedAt,
        dataQuality: {
          metrics: qualityMetrics,
          droppedSample,
        },
      }),
    };
  } catch (error) {
    console.error("JustTCG collector error:", error);
    dataQualityTracker.logSummary();
    throw error;
  }
};
