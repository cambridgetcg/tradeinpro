/**
 * OPTCG API Data Collector Lambda
 *
 * Collects card and price data from the free OPTCG API (optcgapi.com).
 * This is a high-quality data source specifically for One Piece TCG.
 *
 * Features:
 * - Free API with no authentication required
 * - Daily updated prices from TCGplayer
 * - Comprehensive card catalog (OP01-OP12, ST01-ST28, Promos)
 * - Historic pricing (2 weeks)
 *
 * API Documentation: https://optcgapi.com/about/general
 */

import { Handler, ScheduledEvent } from "aws-lambda";
import {
  putToKinesis,
  batchUpdateCurrentPrices,
  writePriceToTimestream,
  normalizePrice,
  normalizePriceAsync,
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

const OPTCG_API_BASE = "https://optcgapi.com/api";

const PRICE_STREAM = process.env.PRICE_STREAM_NAME!;
const CURRENT_PRICES_TABLE = process.env.CURRENT_PRICES_TABLE!;
const TIMESTREAM_DATABASE = process.env.TIMESTREAM_DATABASE!;

// Rate limiter: Be respectful to free API (2 req/sec max)
const rateLimiter = new RateLimiter(2, 2);

// =============================================================================
// TYPES
// =============================================================================

interface OptcgCard {
  id: number;
  card_id: string;          // e.g., "OP01-001"
  name: string;
  card_type: string;        // "Leader", "Character", "Event", "Stage"
  color: string;            // "Red", "Green", "Blue", etc.
  rarity: string;           // "C", "UC", "R", "SR", "SEC", "L", "P"
  cost?: number;
  power?: number;
  counter?: number;
  attribute?: string;
  effect?: string;
  trigger?: string;
  set_name: string;
  set_code: string;         // e.g., "OP01"
  image_url?: string;

  // Pricing data from TCGplayer
  tcgplayer_market_price?: number;
  tcgplayer_low_price?: number;
  tcgplayer_mid_price?: number;
  tcgplayer_high_price?: number;
  tcgplayer_direct_low?: number;

  // Variants
  is_alternate_art?: boolean;
  is_parallel?: boolean;
  variant_type?: string;

  // Metadata
  last_updated?: string;
}

interface OptcgSet {
  id: number;
  name: string;
  code: string;
  release_date?: string;
  card_count?: number;
}

interface OptcgPriceHistory {
  card_id: string;
  date: string;
  market_price: number;
  low_price?: number;
  high_price?: number;
}

interface OptcgApiResponse<T> {
  count?: number;
  next?: string;
  previous?: string;
  results: T[];
}

// =============================================================================
// API CLIENT
// =============================================================================

class OptcgApiClient {
  private baseUrl: string;

  constructor(baseUrl: string = OPTCG_API_BASE) {
    this.baseUrl = baseUrl;
  }

  private async request<T>(endpoint: string): Promise<T> {
    await rateLimiter.acquire();

    const url = `${this.baseUrl}${endpoint}`;

    const response = await withRetry(
      async () => {
        const res = await fetch(url, {
          headers: {
            Accept: "application/json",
            "User-Agent": "TCG-DataPipeline/1.0",
          },
        });

        if (!res.ok) {
          if (res.status === 429) {
            throw new Error("Rate limited");
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
   * Get all available sets
   */
  async getSets(): Promise<OptcgSet[]> {
    const response = await this.request<OptcgApiResponse<OptcgSet>>("/sets/");
    return response.results || [];
  }

  /**
   * Get all cards (paginated)
   */
  async getCards(page: number = 1, pageSize: number = 100): Promise<{
    cards: OptcgCard[];
    hasMore: boolean;
    total: number;
  }> {
    const response = await this.request<OptcgApiResponse<OptcgCard>>(
      `/cards/?page=${page}&page_size=${pageSize}`
    );

    return {
      cards: response.results || [],
      hasMore: !!response.next,
      total: response.count || 0,
    };
  }

  /**
   * Get cards by set code
   */
  async getCardsBySet(setCode: string): Promise<OptcgCard[]> {
    const allCards: OptcgCard[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const response = await this.request<OptcgApiResponse<OptcgCard>>(
        `/cards/?set=${setCode}&page=${page}&page_size=100`
      );

      if (response.results && response.results.length > 0) {
        allCards.push(...response.results);
        hasMore = !!response.next;
        page++;
      } else {
        hasMore = false;
      }

      // Add small delay between pages
      await sleep(500);
    }

    return allCards;
  }

  /**
   * Get single card by ID
   */
  async getCard(cardId: string): Promise<OptcgCard | null> {
    try {
      return await this.request<OptcgCard>(`/cards/${cardId}/`);
    } catch {
      return null;
    }
  }

  /**
   * Get price history for a card
   */
  async getPriceHistory(cardId: string): Promise<OptcgPriceHistory[]> {
    try {
      const response = await this.request<OptcgApiResponse<OptcgPriceHistory>>(
        `/cards/${cardId}/prices/`
      );
      return response.results || [];
    } catch {
      return [];
    }
  }

  /**
   * Get all cards with prices (optimized endpoint if available)
   */
  async getAllCardsWithPrices(): Promise<OptcgCard[]> {
    const allCards: OptcgCard[] = [];
    let page = 1;
    let hasMore = true;
    let totalProcessed = 0;

    console.log("Fetching all cards from OPTCG API...");

    while (hasMore) {
      try {
        const { cards, hasMore: more, total } = await this.getCards(page, 100);

        if (cards.length > 0) {
          allCards.push(...cards);
          totalProcessed += cards.length;
          hasMore = more;
          page++;

          console.log(`  Fetched page ${page - 1}: ${totalProcessed}/${total} cards`);
        } else {
          hasMore = false;
        }

        // Respectful delay
        await sleep(1000);
      } catch (error) {
        console.warn(`Error fetching page ${page}:`, error);
        hasMore = false;
      }
    }

    console.log(`Total cards fetched: ${allCards.length}`);
    return allCards;
  }
}

// =============================================================================
// DATA PROCESSING
// =============================================================================

interface ExtendedPriceEvent extends PriceEvent {
  rarity?: string;
  cardType?: string;
  color?: string;
  cost?: number;
  power?: number;
  sourceQuality?: string;
  priceConfidence?: string;
}

function determineVariantType(card: OptcgCard): string {
  // Use explicit variant info if available
  if (card.variant_type) {
    return card.variant_type.toLowerCase();
  }

  // Check flags
  if (card.is_parallel) return "parallel";
  if (card.is_alternate_art) return "parallel";

  // Check name/rarity for hints
  const nameLower = card.name.toLowerCase();
  const rarityLower = (card.rarity || "").toLowerCase();

  if (nameLower.includes("parallel") || rarityLower.includes("parallel")) {
    return "parallel";
  }
  if (nameLower.includes("manga") || rarityLower.includes("manga")) {
    return "manga";
  }
  if (nameLower.includes("sp") || rarityLower.includes("sp")) {
    return "sp";
  }
  if (nameLower.includes("alternate art") || nameLower.includes("alt art")) {
    return "parallel";
  }

  return "regular";
}

function extractSetAndNumber(cardId: string): { setCode: string; cardNumber: string } {
  // Expected format: "OP01-001", "ST01-015", "EB01-042"
  const match = cardId.match(/^([A-Z]+\d+)-(\d+)$/i);

  if (match) {
    return {
      setCode: match[1].toUpperCase(),
      cardNumber: match[2],
    };
  }

  // Fallback: try to parse any way we can
  const parts = cardId.split("-");
  if (parts.length >= 2) {
    return {
      setCode: parts[0].toUpperCase(),
      cardNumber: parts[1],
    };
  }

  return { setCode: "", cardNumber: cardId };
}

function determinePriceConfidence(card: OptcgCard): "high" | "medium" | "low" {
  // High confidence: has market price and it's recent
  if (card.tcgplayer_market_price && card.tcgplayer_market_price > 0) {
    return "high";
  }

  // Medium confidence: has low/mid price
  if (card.tcgplayer_mid_price || card.tcgplayer_low_price) {
    return "medium";
  }

  // Low confidence: no reliable price data
  return "low";
}

function createPriceEventFromOptcg(
  card: OptcgCard,
  collectedAt: string
): ExtendedPriceEvent | null {
  const source = "optcg_api";

  // Extract set code and number
  const { setCode, cardNumber } = extractSetAndNumber(card.card_id);

  if (!setCode || !cardNumber) {
    dataQualityTracker.recordDropped(source, "invalid_card_id", {
      title: card.name,
      rawData: { card_id: card.card_id },
    });
    return null;
  }

  // Determine variant type
  const variantType = determineVariantType(card);

  // Build card ID
  const cardId = normalizeCardId(setCode, cardNumber, variantType);

  // Get price (prefer market price)
  const price = card.tcgplayer_market_price ||
                card.tcgplayer_mid_price ||
                card.tcgplayer_low_price ||
                0;

  if (price <= 0) {
    dataQualityTracker.recordDropped(source, "no_price_data", {
      title: card.name,
      rawData: { card_id: card.card_id },
    });
    return null;
  }

  // Normalize price (OPTCG API uses USD)
  const { priceUsd, priceGbp } = normalizePrice(price, "USD");

  // Determine price confidence
  const priceConfidence = determinePriceConfidence(card);

  // Track success
  dataQualityTracker.recordSuccess(source, {
    fuzzyMatched: false,
    unknownCondition: false,
  });

  return {
    eventType: "price",
    source,
    cardId,
    externalId: card.id.toString(),
    name: card.name,
    setCode,
    cardNumber,
    variantType,
    condition: "NM", // OPTCG API prices are for NM condition
    language: "EN",  // English releases
    price,
    currency: "USD",
    priceUsd,
    priceGbp,
    listingsCount: undefined,
    sellerId: undefined,
    timestamp: card.last_updated || collectedAt,
    collectedAt,
    // Extended fields
    rarity: card.rarity,
    cardType: card.card_type,
    color: card.color,
    cost: card.cost,
    power: card.power,
    sourceQuality: "high", // OPTCG API is reliable
    priceConfidence,
  };
}

// =============================================================================
// MAIN HANDLER
// =============================================================================

export const handler: Handler<ScheduledEvent> = async (event) => {
  console.log("OPTCG API collector started", { event });
  const collectedAt = nowIso();

  // Reset data quality tracker for this run
  dataQualityTracker.reset();

  try {
    // Fetch live FX rates
    await fetchLiveFxRates();

    const client = new OptcgApiClient();

    // Get all cards with prices
    const allCards = await client.getAllCardsWithPrices();

    console.log(`Processing ${allCards.length} cards...`);

    const priceEvents: ExtendedPriceEvent[] = [];
    const cardCatalog: Map<string, OptcgCard> = new Map();

    for (const card of allCards) {
      // Store in catalog
      cardCatalog.set(card.card_id, card);

      // Create price event
      const priceEvent = createPriceEventFromOptcg(card, collectedAt);
      if (priceEvent) {
        priceEvents.push(priceEvent);
      }
    }

    console.log(`Created ${priceEvents.length} price events`);

    // Log data quality summary
    dataQualityTracker.logSummary();

    // Get quality metrics
    const qualityMetrics = dataQualityTracker.getMetrics();
    const droppedSample = dataQualityTracker.getDroppedRecords().slice(0, 10);

    // Send to Kinesis
    if (priceEvents.length > 0) {
      await putToKinesis(PRICE_STREAM, priceEvents);
    }

    // Update DynamoDB current prices
    if (priceEvents.length > 0) {
      await batchUpdateCurrentPrices(CURRENT_PRICES_TABLE, priceEvents);
    }

    // Write to Timestream
    if (priceEvents.length > 0) {
      await writePriceToTimestream(
        TIMESTREAM_DATABASE,
        "price_history",
        priceEvents
      );
    }

    // Summary stats
    const stats = {
      totalCards: allCards.length,
      priceEventsCreated: priceEvents.length,
      uniqueSets: new Set(allCards.map(c => c.set_code)).size,
      byRarity: {} as Record<string, number>,
      avgPrice: 0,
      highValueCards: 0,
    };

    // Calculate stats
    for (const card of allCards) {
      const rarity = card.rarity || "Unknown";
      stats.byRarity[rarity] = (stats.byRarity[rarity] || 0) + 1;
    }

    if (priceEvents.length > 0) {
      stats.avgPrice = priceEvents.reduce((sum, e) => sum + e.priceUsd, 0) / priceEvents.length;
      stats.highValueCards = priceEvents.filter(e => e.priceUsd > 20).length;
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        priceEvents: priceEvents.length,
        stats,
        collectedAt,
        dataQuality: {
          metrics: qualityMetrics,
          droppedSample,
        },
      }),
    };
  } catch (error) {
    console.error("OPTCG API collector error:", error);

    // Still log data quality even on error
    dataQualityTracker.logSummary();

    throw error;
  }
};
