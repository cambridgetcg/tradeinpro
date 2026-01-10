/**
 * OPTCG API Client
 *
 * Free API for One Piece TCG data from optcgapi.com
 * - No authentication required
 * - 14-day price history via /twoweeks/ endpoints
 * - TCGplayer prices (inventory_price, market_price)
 *
 * @see https://optcgapi.com/documentation
 */

import type {
  OPTCGCard,
  OPTCGCardWithHistory,
  OPTCGSet,
} from "../types";

// =============================================================================
// CONFIGURATION
// =============================================================================

const OPTCG_API_BASE = "https://optcgapi.com/api";
const DEFAULT_TIMEOUT = 30000; // 30 seconds
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000; // 1 second

// =============================================================================
// CLIENT
// =============================================================================

export class OPTCGClient {
  private baseUrl: string;

  constructor(baseUrl: string = OPTCG_API_BASE) {
    this.baseUrl = baseUrl;
  }

  /**
   * Make a request to the OPTCG API with retry logic
   */
  private async request<T>(endpoint: string, retries = MAX_RETRIES): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT);

        const response = await fetch(url, {
          method: "GET",
          headers: {
            Accept: "application/json",
          },
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${await response.text()}`);
        }

        return await response.json();
      } catch (error) {
        const isLastAttempt = attempt === retries;
        const isAbort = error instanceof Error && error.name === "AbortError";

        if (isLastAttempt) {
          throw new Error(
            `OPTCG API request failed after ${retries} attempts: ${
              error instanceof Error ? error.message : "Unknown error"
            }`
          );
        }

        console.warn(
          `OPTCG API request attempt ${attempt} failed:`,
          error instanceof Error ? error.message : error
        );

        // Wait before retrying (exponential backoff)
        await new Promise((resolve) =>
          setTimeout(resolve, RETRY_DELAY * Math.pow(2, attempt - 1))
        );
      }
    }

    throw new Error("Unexpected: request loop completed without return or throw");
  }

  // ===========================================================================
  // SETS ENDPOINTS
  // ===========================================================================

  /**
   * Get all available set names and IDs
   */
  async getAllSets(): Promise<OPTCGSet[]> {
    return this.request<OPTCGSet[]>("/allSets/");
  }

  /**
   * Get all cards from all sets
   */
  async getAllSetCards(): Promise<OPTCGCard[]> {
    return this.request<OPTCGCard[]>("/allSetCards/");
  }

  /**
   * Get all cards from a specific set
   */
  async getSetCards(setId: string): Promise<OPTCGCard[]> {
    return this.request<OPTCGCard[]>(`/sets/${encodeURIComponent(setId)}/`);
  }

  /**
   * Get a specific card by ID
   */
  async getCard(cardId: string): Promise<OPTCGCard> {
    return this.request<OPTCGCard>(`/sets/card/${encodeURIComponent(cardId)}/`);
  }

  /**
   * Get a card with 14-day price history
   */
  async getCardWithHistory(cardId: string): Promise<OPTCGCardWithHistory> {
    return this.request<OPTCGCardWithHistory>(
      `/sets/card/twoweeks/${encodeURIComponent(cardId)}/`
    );
  }

  /**
   * Filter set cards by parameters
   */
  async filterSetCards(params: {
    set_id?: string;
    rarity?: string;
    card_color?: string;
    card_type?: string;
  }): Promise<OPTCGCard[]> {
    const queryParams = new URLSearchParams();
    if (params.set_id) queryParams.set("set_id", params.set_id);
    if (params.rarity) queryParams.set("rarity", params.rarity);
    if (params.card_color) queryParams.set("card_color", params.card_color);
    if (params.card_type) queryParams.set("card_type", params.card_type);

    const query = queryParams.toString();
    return this.request<OPTCGCard[]>(`/sets/filtered/${query ? `?${query}` : ""}`);
  }

  // ===========================================================================
  // STARTER DECK ENDPOINTS
  // ===========================================================================

  /**
   * Get all starter deck IDs and names
   */
  async getAllDecks(): Promise<OPTCGSet[]> {
    return this.request<OPTCGSet[]>("/allDecks/");
  }

  /**
   * Get all starter deck cards
   */
  async getAllDeckCards(): Promise<OPTCGCard[]> {
    return this.request<OPTCGCard[]>("/allSTCards/");
  }

  /**
   * Get cards from a specific starter deck
   */
  async getDeckCards(deckId: string): Promise<OPTCGCard[]> {
    return this.request<OPTCGCard[]>(`/decks/${encodeURIComponent(deckId)}/`);
  }

  /**
   * Get a starter deck card with 14-day price history
   */
  async getDeckCardWithHistory(cardId: string): Promise<OPTCGCardWithHistory> {
    return this.request<OPTCGCardWithHistory>(
      `/decks/card/twoweeks/${encodeURIComponent(cardId)}/`
    );
  }

  // ===========================================================================
  // PROMO ENDPOINTS
  // ===========================================================================

  /**
   * Get all promotional cards
   */
  async getAllPromoCards(): Promise<OPTCGCard[]> {
    return this.request<OPTCGCard[]>("/allPromoCards/");
  }

  /**
   * Get a promo card with 14-day price history
   */
  async getPromoCardWithHistory(cardId: string): Promise<OPTCGCardWithHistory> {
    return this.request<OPTCGCardWithHistory>(
      `/promos/card/twoweeks/${encodeURIComponent(cardId)}/`
    );
  }

  // ===========================================================================
  // BULK OPERATIONS
  // ===========================================================================

  /**
   * Fetch all cards from all sources with current prices
   * Combines sets, starter decks, and promos
   */
  async fetchAllCards(): Promise<OPTCGCard[]> {
    const [setCards, deckCards, promoCards] = await Promise.all([
      this.getAllSetCards().catch((e) => {
        console.warn("Failed to fetch set cards:", e);
        return [] as OPTCGCard[];
      }),
      this.getAllDeckCards().catch((e) => {
        console.warn("Failed to fetch deck cards:", e);
        return [] as OPTCGCard[];
      }),
      this.getAllPromoCards().catch((e) => {
        console.warn("Failed to fetch promo cards:", e);
        return [] as OPTCGCard[];
      }),
    ]);

    // Combine and deduplicate by card_set_id
    const cardMap = new Map<string, OPTCGCard>();

    for (const card of [...setCards, ...deckCards, ...promoCards]) {
      const key = card.card_set_id;
      if (!cardMap.has(key)) {
        cardMap.set(key, card);
      }
    }

    return Array.from(cardMap.values());
  }

  /**
   * Fetch cards with 14-day price history
   * Note: This makes individual requests per card, use sparingly
   */
  async fetchCardsWithHistory(
    cardIds: string[],
    onProgress?: (processed: number, total: number) => void
  ): Promise<OPTCGCardWithHistory[]> {
    const results: OPTCGCardWithHistory[] = [];
    const total = cardIds.length;

    for (let i = 0; i < cardIds.length; i++) {
      try {
        const card = await this.getCardWithHistory(cardIds[i]);
        results.push(card);
      } catch (error) {
        console.warn(`Failed to fetch history for ${cardIds[i]}:`, error);
      }

      if (onProgress) {
        onProgress(i + 1, total);
      }

      // Rate limiting: 100ms delay between requests
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    return results;
  }
}

// =============================================================================
// SINGLETON INSTANCE
// =============================================================================

let clientInstance: OPTCGClient | null = null;

export function getOPTCGClient(): OPTCGClient {
  if (!clientInstance) {
    clientInstance = new OPTCGClient();
  }
  return clientInstance;
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Extract 14-day price history from OPTCGCardWithHistory
 */
export function extractPriceHistory(
  card: OPTCGCardWithHistory
): Array<{ day: number; inventoryPrice?: number; marketPrice?: number }> {
  const history: Array<{
    day: number;
    inventoryPrice?: number;
    marketPrice?: number;
  }> = [];

  for (let day = 1; day <= 13; day++) {
    const invKey = `Day${day}_Inventory_Price` as keyof OPTCGCardWithHistory;
    const mktKey = `Day${day}_Market_Price` as keyof OPTCGCardWithHistory;

    const inventoryPrice = card[invKey] as number | undefined;
    const marketPrice = card[mktKey] as number | undefined;

    if (inventoryPrice !== undefined || marketPrice !== undefined) {
      history.push({ day, inventoryPrice, marketPrice });
    }
  }

  return history;
}

/**
 * Normalize OPTCG card ID to our internal format
 * OPTCG uses: "OP01-001" format
 * We use: "OP01-001" or "OP01-001-parallel" for variants
 */
export function normalizeOPTCGCardId(
  cardSetId: string,
  variantType?: string
): string {
  const baseId = cardSetId.toUpperCase().trim();

  if (variantType && variantType !== "regular") {
    return `${baseId}-${variantType.toLowerCase()}`;
  }

  return baseId;
}
