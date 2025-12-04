/**
 * Price API Client
 *
 * Fetches card prices from the external trading card price API.
 * API Endpoint: https://p5cfufhj0e.execute-api.us-east-1.amazonaws.com/prod
 */

const API_BASE_URL = process.env.PRICE_API_URL || 'https://p5cfufhj0e.execute-api.us-east-1.amazonaws.com/prod';

export interface CardPrice {
  card_id: string;
  name: string;
  market_price: number | null;
  tradein_price: number | null;
  market_price_gbp: number | null;
  tradein_price_gbp: number | null;
  currency: string;
  source: string;
  game: string;
  variant_type: string | null;
  rarity: string | null;
  is_alternate_art: boolean;
  tcgplayer_price_usd: number | null;
  cardmarket_price_eur: number | null;
  last_updated: string;
}

export interface TradeInPrice {
  card_id: string;
  name: string;
  market_price: number | null;
  variant_type: string | null;
  currency: string;
  trade_in_prices: {
    NM: number;
    LP: number;
    MP: number;
    HP: number;
    DMG: number;
  };
}

export interface InventoryItem {
  sku: string;
  card_type: string;
  release_set: string;
  original_card_id: string;
  jpy_price: number | null;
  gbp_cost: number | null;
  gbp_selling: number | null;
  tcgplayer_price_usd: number | null;
  tcgplayer_price_gbp: number | null;
  cardmarket_price_eur: number | null;
  cardmarket_price_gbp: number | null;
  best_en_price_gbp: number | null;
  price_diff_pct: number | null;
  last_updated: string;
}

export interface PricesResponse {
  success: boolean;
  data: CardPrice[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    has_more: boolean;
  };
}

export interface SearchResponse {
  success: boolean;
  query: string;
  count: number;
  data: CardPrice[];
}

export interface TradeInResponse {
  success: boolean;
  condition_multipliers: Record<string, number>;
  count: number;
  data: TradeInPrice[];
}

export interface InventoryResponse {
  success: boolean;
  data: InventoryItem[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    has_more: boolean;
  };
}

async function fetchApi<T>(endpoint: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(`${API_BASE_URL}${endpoint}`);
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value) url.searchParams.set(key, value);
    });
  }

  const response = await fetch(url.toString(), {
    headers: {
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`API request failed: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

/**
 * Get card prices with pagination and filters
 */
export async function getPrices(options: {
  game?: string;
  source?: string;
  variant_type?: string;
  limit?: number;
  offset?: number;
} = {}): Promise<PricesResponse> {
  const params: Record<string, string> = {};
  if (options.game) params.game = options.game;
  if (options.source) params.source = options.source;
  if (options.variant_type) params.variant_type = options.variant_type;
  if (options.limit) params.limit = String(options.limit);
  if (options.offset) params.offset = String(options.offset);

  return fetchApi<PricesResponse>('/prices', params);
}

/**
 * Get a specific card price by ID
 */
export async function getPriceById(cardId: string): Promise<{ success: boolean; data: CardPrice }> {
  return fetchApi(`/prices/${encodeURIComponent(cardId)}`);
}

/**
 * Search cards by name
 */
export async function searchPrices(options: {
  query: string;
  game?: string;
  limit?: number;
}): Promise<SearchResponse> {
  const params: Record<string, string> = { q: options.query };
  if (options.game) params.game = options.game;
  if (options.limit) params.limit = String(options.limit);

  return fetchApi<SearchResponse>('/prices/search', params);
}

/**
 * Get trade-in prices with condition multipliers
 */
export async function getTradeInPrices(options: {
  game: string;
  card_ids?: string[];
  currency?: 'GBP' | 'USD';
}): Promise<TradeInResponse> {
  const params: Record<string, string> = { game: options.game };
  if (options.card_ids?.length) params.card_ids = options.card_ids.join(',');
  if (options.currency) params.currency = options.currency;

  return fetchApi<TradeInResponse>('/trade-in-prices', params);
}

/**
 * Get inventory alt art prices with EN comparisons
 */
export async function getInventory(options: {
  card_type?: string;
  limit?: number;
  offset?: number;
} = {}): Promise<InventoryResponse> {
  const params: Record<string, string> = {};
  if (options.card_type) params.card_type = options.card_type;
  if (options.limit) params.limit = String(options.limit);
  if (options.offset) params.offset = String(options.offset);

  return fetchApi<InventoryResponse>('/inventory', params);
}

/**
 * Convert external API price format to Prisma CardPrice format
 * Prices come as dollars, convert to cents for storage
 */
export function convertToDbFormat(apiPrice: CardPrice | TradeInPrice): {
  cardName: string;
  setName: string;
  setCode: string | null;
  rarity: string | null;
  variant: string | null;
  priceNM: number;
  priceLP: number;
  priceMP: number;
  priceHP: number;
  priceDMG: number;
} {
  // For TradeInPrice format (has trade_in_prices object)
  if ('trade_in_prices' in apiPrice) {
    const tradeIn = apiPrice as TradeInPrice;
    // Extract set from card_id (e.g., "optcg-op06-OP06-081" -> "OP06")
    const setMatch = tradeIn.card_id.match(/([A-Z]+\d+)/i);
    const setCode = setMatch ? setMatch[1].toUpperCase() : null;

    return {
      cardName: tradeIn.name,
      setName: setCode || 'Unknown',
      setCode,
      rarity: null,
      variant: tradeIn.variant_type,
      // Convert GBP to cents (prices are already in condition format)
      priceNM: Math.round((tradeIn.trade_in_prices.NM || 0) * 100),
      priceLP: Math.round((tradeIn.trade_in_prices.LP || 0) * 100),
      priceMP: Math.round((tradeIn.trade_in_prices.MP || 0) * 100),
      priceHP: Math.round((tradeIn.trade_in_prices.HP || 0) * 100),
      priceDMG: Math.round((tradeIn.trade_in_prices.DMG || 0) * 100),
    };
  }

  // For CardPrice format (calculate trade-in prices from market price)
  const card = apiPrice as CardPrice;
  const setMatch = card.card_id.match(/([A-Z]+\d+)/i);
  const setCode = setMatch ? setMatch[1].toUpperCase() : null;

  // Use GBP price, fallback to USD if not available
  const marketPrice = card.market_price_gbp || card.market_price || 0;

  // Apply condition multipliers (same as API)
  const CONDITION_MULTIPLIERS = {
    NM: 0.70,
    LP: 0.55,
    MP: 0.40,
    HP: 0.25,
    DMG: 0.10,
  };

  return {
    cardName: card.name,
    setName: setCode || 'Unknown',
    setCode,
    rarity: card.rarity,
    variant: card.variant_type,
    priceNM: Math.round(marketPrice * CONDITION_MULTIPLIERS.NM * 100),
    priceLP: Math.round(marketPrice * CONDITION_MULTIPLIERS.LP * 100),
    priceMP: Math.round(marketPrice * CONDITION_MULTIPLIERS.MP * 100),
    priceHP: Math.round(marketPrice * CONDITION_MULTIPLIERS.HP * 100),
    priceDMG: Math.round(marketPrice * CONDITION_MULTIPLIERS.DMG * 100),
  };
}
