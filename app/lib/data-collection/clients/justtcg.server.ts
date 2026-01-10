/**
 * JustTCG API Client
 *
 * Premium API for TCG pricing data with deep historical data
 * - Up to 180-day price history
 * - Rich statistics (24h/7d/30d/90d changes, std dev, trend slope)
 * - Multiple TCG support including One Piece
 *
 * @see https://justtcg.com/docs
 */

import type {
  JustTCGCard,
  JustTCGGame,
  JustTCGSet,
  JustTCGSearchParams,
  JustTCGPriceHistoryDuration,
} from "../types";

// =============================================================================
// CONFIGURATION
// =============================================================================

const JUSTTCG_API_BASE = "https://api.justtcg.com/v1";
const ONE_PIECE_GAME_ID = "one-piece-card-game";
const DEFAULT_TIMEOUT = 30000;
const MAX_RETRIES = 3;
const RETRY_DELAY = 2000;

// Rate limit configuration based on tier
export const JUSTTCG_RATE_LIMITS = {
  free: { monthly: 1000, daily: 100, perMinute: 10 },
  starter: { monthly: 10000, daily: 1000, perMinute: 50 },
  professional: { monthly: 50000, daily: 5000, perMinute: 100 },
  enterprise: { monthly: 500000, daily: 50000, perMinute: 500 },
};

// =============================================================================
// CLIENT
// =============================================================================

export class JustTCGClient {
  private apiKey: string;
  private baseUrl: string;
  private requestCount: number = 0;
  private lastRequestTime: number = 0;
  private tier: keyof typeof JUSTTCG_RATE_LIMITS;

  constructor(
    apiKey: string,
    tier: keyof typeof JUSTTCG_RATE_LIMITS = "professional",
    baseUrl: string = JUSTTCG_API_BASE
  ) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.tier = tier;
  }

  /**
   * Rate limiting helper
   */
  private async rateLimit(): Promise<void> {
    const limits = JUSTTCG_RATE_LIMITS[this.tier];
    const minInterval = (60 * 1000) / limits.perMinute; // ms between requests

    const now = Date.now();
    const elapsed = now - this.lastRequestTime;

    if (elapsed < minInterval) {
      await new Promise((resolve) =>
        setTimeout(resolve, minInterval - elapsed)
      );
    }

    this.lastRequestTime = Date.now();
    this.requestCount++;
  }

  /**
   * Make a request to the JustTCG API
   */
  private async request<T>(
    endpoint: string,
    method: "GET" | "POST" = "GET",
    body?: unknown,
    retries = MAX_RETRIES
  ): Promise<T> {
    await this.rateLimit();

    const url = `${this.baseUrl}${endpoint}`;

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT);

        const response = await fetch(url, {
          method,
          headers: {
            "x-api-key": this.apiKey,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorText = await response.text();

          // Handle rate limiting
          if (response.status === 429) {
            const retryAfter = response.headers.get("Retry-After") || "60";
            console.warn(`JustTCG rate limited. Retry after ${retryAfter}s`);
            await new Promise((resolve) =>
              setTimeout(resolve, parseInt(retryAfter) * 1000)
            );
            continue;
          }

          throw new Error(`HTTP ${response.status}: ${errorText}`);
        }

        return await response.json();
      } catch (error) {
        const isLastAttempt = attempt === retries;

        if (isLastAttempt) {
          throw new Error(
            `JustTCG API request failed after ${retries} attempts: ${
              error instanceof Error ? error.message : "Unknown error"
            }`
          );
        }

        console.warn(
          `JustTCG API request attempt ${attempt} failed:`,
          error instanceof Error ? error.message : error
        );

        await new Promise((resolve) =>
          setTimeout(resolve, RETRY_DELAY * Math.pow(2, attempt - 1))
        );
      }
    }

    throw new Error("Unexpected: request loop completed without return or throw");
  }

  // ===========================================================================
  // GAMES & SETS
  // ===========================================================================

  /**
   * List all available games
   */
  async getGames(): Promise<JustTCGGame[]> {
    const response = await this.request<{ data: JustTCGGame[] }>("/games");
    return response.data;
  }

  /**
   * List all sets, optionally filtered by game
   */
  async getSets(game?: string): Promise<JustTCGSet[]> {
    const params = game ? `?game=${encodeURIComponent(game)}` : "";
    const response = await this.request<{ data: JustTCGSet[] }>(`/sets${params}`);
    return response.data;
  }

  /**
   * Get One Piece sets specifically
   */
  async getOnePieceSets(): Promise<JustTCGSet[]> {
    return this.getSets(ONE_PIECE_GAME_ID);
  }

  // ===========================================================================
  // CARDS
  // ===========================================================================

  /**
   * Search for cards with various parameters
   */
  async searchCards(params: JustTCGSearchParams): Promise<JustTCGCard[]> {
    const queryParams = new URLSearchParams();

    if (params.game) queryParams.set("game", params.game);
    if (params.set) queryParams.set("set", params.set);
    if (params.search) queryParams.set("search", params.search);
    if (params.id) queryParams.set("id", params.id);
    if (params.limit) queryParams.set("limit", params.limit.toString());
    if (params.offset) queryParams.set("offset", params.offset.toString());
    if (params.orderBy) queryParams.set("orderBy", params.orderBy);
    if (params.order) queryParams.set("order", params.order);
    if (params.includeStatistics)
      queryParams.set("include_statistics", "true");
    if (params.includePriceHistory)
      queryParams.set("include_price_history", "true");
    if (params.priceHistoryDuration)
      queryParams.set("priceHistoryDuration", params.priceHistoryDuration);

    const query = queryParams.toString();
    const response = await this.request<{ data: JustTCGCard[] }>(
      `/cards${query ? `?${query}` : ""}`
    );
    return response.data;
  }

  /**
   * Get a single card by ID
   */
  async getCard(
    cardId: string,
    options: {
      includeStatistics?: boolean;
      includePriceHistory?: boolean;
      priceHistoryDuration?: JustTCGPriceHistoryDuration;
    } = {}
  ): Promise<JustTCGCard | null> {
    const cards = await this.searchCards({
      id: cardId,
      ...options,
    });
    return cards[0] || null;
  }

  /**
   * Get cards with full statistics and price history
   */
  async getCardsWithFullData(
    cardIds: string[],
    priceHistoryDuration: JustTCGPriceHistoryDuration = "180d"
  ): Promise<JustTCGCard[]> {
    // Batch lookup via POST endpoint
    const response = await this.request<{ data: JustTCGCard[] }>(
      `/cards?include_statistics=true&include_price_history=true&priceHistoryDuration=${priceHistoryDuration}`,
      "POST",
      { ids: cardIds }
    );
    return response.data;
  }

  /**
   * Get One Piece cards with optional filters
   */
  async getOnePieceCards(
    options: {
      set?: string;
      search?: string;
      limit?: number;
      offset?: number;
      orderBy?: "price" | "24h" | "7d" | "30d";
      order?: "asc" | "desc";
      includeStatistics?: boolean;
      includePriceHistory?: boolean;
      priceHistoryDuration?: JustTCGPriceHistoryDuration;
    } = {}
  ): Promise<JustTCGCard[]> {
    return this.searchCards({
      game: ONE_PIECE_GAME_ID,
      ...options,
    });
  }

  /**
   * Get top price movers (gainers or losers)
   */
  async getTopMovers(
    timeframe: "24h" | "7d" | "30d",
    direction: "gainers" | "losers",
    limit: number = 50
  ): Promise<JustTCGCard[]> {
    return this.searchCards({
      game: ONE_PIECE_GAME_ID,
      orderBy: timeframe,
      order: direction === "gainers" ? "desc" : "asc",
      limit,
      includeStatistics: true,
    });
  }

  /**
   * Get highest priced One Piece cards
   */
  async getHighestPriced(limit: number = 100): Promise<JustTCGCard[]> {
    return this.searchCards({
      game: ONE_PIECE_GAME_ID,
      orderBy: "price",
      order: "desc",
      limit,
      includeStatistics: true,
    });
  }

  // ===========================================================================
  // BULK OPERATIONS
  // ===========================================================================

  /**
   * Fetch all One Piece cards with statistics
   * Handles pagination automatically
   */
  async fetchAllOnePieceCards(
    includeStatistics: boolean = true,
    onProgress?: (fetched: number, batch: number) => void
  ): Promise<JustTCGCard[]> {
    const allCards: JustTCGCard[] = [];
    const batchSize = 100;
    let offset = 0;
    let hasMore = true;
    let batchNumber = 0;

    while (hasMore) {
      const cards = await this.getOnePieceCards({
        limit: batchSize,
        offset,
        includeStatistics,
      });

      allCards.push(...cards);
      batchNumber++;

      if (onProgress) {
        onProgress(allCards.length, batchNumber);
      }

      if (cards.length < batchSize) {
        hasMore = false;
      } else {
        offset += batchSize;
      }
    }

    return allCards;
  }

  /**
   * Fetch cards with 180-day price history
   * Use for selected high-value cards due to data volume
   */
  async fetchCardsWithHistory(
    cardIds: string[],
    priceHistoryDuration: JustTCGPriceHistoryDuration = "180d",
    batchSize: number = 10,
    onProgress?: (processed: number, total: number) => void
  ): Promise<JustTCGCard[]> {
    const results: JustTCGCard[] = [];
    const total = cardIds.length;

    for (let i = 0; i < cardIds.length; i += batchSize) {
      const batch = cardIds.slice(i, i + batchSize);
      const cards = await this.getCardsWithFullData(batch, priceHistoryDuration);
      results.push(...cards);

      if (onProgress) {
        onProgress(Math.min(i + batchSize, total), total);
      }
    }

    return results;
  }

  // ===========================================================================
  // USAGE TRACKING
  // ===========================================================================

  /**
   * Get current request count for this session
   */
  getRequestCount(): number {
    return this.requestCount;
  }

  /**
   * Reset request count (e.g., at start of new period)
   */
  resetRequestCount(): void {
    this.requestCount = 0;
  }
}

// =============================================================================
// SINGLETON INSTANCE
// =============================================================================

let clientInstance: JustTCGClient | null = null;

export function getJustTCGClient(): JustTCGClient {
  if (!clientInstance) {
    const apiKey = process.env.JUSTTCG_API_KEY;
    if (!apiKey) {
      throw new Error("JUSTTCG_API_KEY environment variable is required");
    }

    const tier =
      (process.env.JUSTTCG_TIER as keyof typeof JUSTTCG_RATE_LIMITS) ||
      "professional";

    clientInstance = new JustTCGClient(apiKey, tier);
  }
  return clientInstance;
}

export function resetJustTCGClient(): void {
  clientInstance = null;
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Convert JustTCG price history to dated records
 */
export function convertPriceHistory(
  priceHistory: Array<{ p: number; t: number }>
): Array<{ price: number; timestamp: Date }> {
  return priceHistory.map((point) => ({
    price: point.p,
    timestamp: new Date(point.t * 1000),
  }));
}

/**
 * Normalize JustTCG card ID to our internal format
 */
export function normalizeJustTCGCardId(justTCGId: string): string {
  // JustTCG uses format like "one-piece-op01-001"
  // We want "OP01-001"

  const match = justTCGId.match(/op(\d+)-(\d+)/i);
  if (match) {
    return `OP${match[1].padStart(2, "0")}-${match[2].padStart(3, "0")}`;
  }

  // If no match, return as-is but uppercase
  return justTCGId.toUpperCase();
}

// =============================================================================
// VOLUME/INVENTORY METRICS EXTRACTION
// =============================================================================

/**
 * Volume metrics extracted from JustTCG card data
 * Used to fill hardcoded feature gaps in neural network
 */
export interface JustTCGVolumeMetrics {
  /** Total number of variants with prices (proxy for listings count) */
  listingsCount: number;
  /** Number of distinct conditions with prices available */
  conditionsAvailable: number;
  /** Distinct conditions present */
  conditions: string[];
  /** Whether foil/special variants exist */
  hasFoilVariants: boolean;
  /** Price spread across conditions (max - min price) */
  priceSpread: number | null;
  /** Ratio of low price to market price (inventory pressure indicator) */
  inventoryPressure: number | null;
}

/**
 * Extract volume/inventory metrics from a JustTCG card
 * These metrics serve as proxies for trading activity and supply levels
 */
export function extractVolumeMetrics(card: JustTCGCard): JustTCGVolumeMetrics {
  const variants = card.variants || [];

  // Filter variants with valid prices
  const pricedVariants = variants.filter((v) => v.price > 0);

  // Get unique conditions
  const conditions = [...new Set(pricedVariants.map((v) => v.condition))];

  // Check for foil variants
  const foilPrintings = ["Foil", "Reverse Holo", "Holofoil", "Parallel"];
  const hasFoilVariants = pricedVariants.some((v) =>
    foilPrintings.some((fp) =>
      v.printing.toLowerCase().includes(fp.toLowerCase())
    )
  );

  // Calculate price spread
  const prices = pricedVariants.map((v) => v.price).sort((a, b) => a - b);
  const priceSpread =
    prices.length >= 2 ? prices[prices.length - 1] - prices[0] : null;

  // Calculate inventory pressure (ratio of inventory to market)
  // Low ratio means high supply pressure (inventory cheaper than market)
  const stats = card.statistics;
  let inventoryPressure: number | null = null;

  // Find the lowest available price across all conditions
  const lowestPrice = prices.length > 0 ? prices[0] : null;
  if (lowestPrice && card.price > 0) {
    inventoryPressure = (lowestPrice - card.price) / card.price;
  }

  return {
    listingsCount: pricedVariants.length,
    conditionsAvailable: conditions.length,
    conditions,
    hasFoilVariants,
    priceSpread,
    inventoryPressure,
  };
}

/**
 * Calculate relative volume for a card compared to market average
 * Returns a normalized value where 1 = average, >1 = more active, <1 = less active
 */
export function calculateRelativeVolume(
  cardMetrics: JustTCGVolumeMetrics,
  marketAverageListings: number
): number {
  if (marketAverageListings <= 0) return 1;
  return cardMetrics.listingsCount / marketAverageListings;
}

/**
 * Extract momentum metrics from JustTCG statistics
 * Returns normalized momentum indicators for feature vector
 */
export function extractMomentumMetrics(card: JustTCGCard): {
  momentum7d: number;
  momentum30d: number;
  momentum90d: number;
  volatility: number;
  trendStrength: number;
} {
  const stats = card.statistics;

  if (!stats) {
    return {
      momentum7d: 0,
      momentum30d: 0,
      momentum90d: 0,
      volatility: 0,
      trendStrength: 0,
    };
  }

  // Clamp momentum values to [-1, 1] range for feature normalization
  const clampMomentum = (value: number): number =>
    Math.max(-1, Math.min(1, value));

  // Calculate volatility as coefficient of variation (stdDev / mean)
  const volatility = stats.avg > 0 ? stats.stdDev / stats.avg : 0;

  // Trend strength = how consistent is the direction
  const trendStrength = Math.abs(stats.trendSlope);

  return {
    momentum7d: clampMomentum(stats.change7d),
    momentum30d: clampMomentum(stats.change30d),
    momentum90d: stats.change90d ? clampMomentum(stats.change90d) : 0,
    volatility: Math.min(1, volatility), // Cap at 1
    trendStrength: Math.min(1, trendStrength), // Cap at 1
  };
}
