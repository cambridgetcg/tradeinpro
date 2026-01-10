/**
 * CSS Selectors for Cardmarket HTML Parsing
 *
 * Multi-strategy approach: Primary selectors with fallbacks
 * Updated based on Cardmarket's HTML structure as of January 2025
 */

export interface SelectorStrategy {
  primary: string[];
  fallback: string[];
  regex?: RegExp[];
}

export interface PageSelectors {
  [key: string]: SelectorStrategy;
}

/**
 * Expansion/Set listing page selectors
 */
export const EXPANSION_PAGE_SELECTORS: PageSelectors = {
  // Product row container
  productRow: {
    primary: [
      '.table-body .row',
      '.product-row',
      '[class*="productRow"]',
    ],
    fallback: [
      'div[class*="row"][class*="product"]',
      '.table tr',
    ],
  },

  // Product name/title
  productName: {
    primary: [
      '.col-product a',
      '.product-name a',
      '[class*="productName"] a',
    ],
    fallback: [
      '.col-product .name',
      'a[href*="/Products/Singles/"]',
    ],
  },

  // Product link
  productLink: {
    primary: [
      '.col-product a[href*="/Products/Singles/"]',
      '.product-name a[href]',
    ],
    fallback: [
      'a[href*="/Products/Singles/"][class*="product"]',
    ],
  },

  // Product price (trend)
  productPrice: {
    primary: [
      '.col-price .font-weight-bold',
      '.price-container .trend',
      '[class*="priceGuide"] .trend',
    ],
    fallback: [
      '.col-price',
      '[class*="price"]',
    ],
    regex: [
      /€\s*(\d+[.,]\d{2})/,
      /(\d+[.,]\d{2})\s*€/,
    ],
  },

  // Available quantity
  productQuantity: {
    primary: [
      '.col-availability .availability',
      '.availability-count',
    ],
    fallback: [
      '[class*="availability"]',
    ],
    regex: [
      /(\d+)\s*(?:available|verfügbar|disponible)/i,
    ],
  },

  // Card number/ID
  cardNumber: {
    primary: [
      '.col-info .info-row:first-child',
      '[class*="cardNumber"]',
    ],
    fallback: [],
    regex: [
      /([A-Z]{2,3}\d{2})-(\d{3})/i,
    ],
  },

  // Rarity
  rarity: {
    primary: [
      '.col-info [class*="rarity"]',
      '.rarity-icon',
    ],
    fallback: [
      'span[class*="rarity"]',
      'img[src*="rarity"]',
    ],
  },

  // Pagination
  pagination: {
    primary: [
      '.pagination-container',
      '.pagination',
    ],
    fallback: [
      'nav[aria-label*="pagination"]',
      '[class*="pagination"]',
    ],
  },

  // Total results count
  resultCount: {
    primary: [
      '.result-count',
      '.info-list-container .info-row',
    ],
    fallback: [
      '[class*="resultCount"]',
    ],
    regex: [
      /(\d+)\s*(?:Products|Produkte|Produits)/i,
      /(?:Showing|Zeige)\s*\d+\s*(?:of|von)\s*(\d+)/i,
    ],
  },
};

/**
 * Single card/product detail page selectors
 */
export const CARD_DETAIL_SELECTORS: PageSelectors = {
  // Card name
  cardName: {
    primary: [
      'h1.page-title',
      '.page-title-container h1',
      '[class*="productTitle"]',
    ],
    fallback: [
      'h1',
      '.product-name',
    ],
  },

  // Price guide container
  priceGuide: {
    primary: [
      '.info-list-container',
      '.price-container',
      '[class*="priceGuide"]',
    ],
    fallback: [
      '.product-info',
      '[class*="price"]',
    ],
  },

  // Trend price
  trendPrice: {
    primary: [
      '.info-list-container dd:contains("Trend") + dd',
      '.price-container .trend',
      '[data-metric="trend"]',
    ],
    fallback: [
      'dd:contains("Trend")',
      '[class*="trend"]',
    ],
    regex: [
      /Trend[^€]*€\s*(\d+[.,]\d{2})/i,
      /€\s*(\d+[.,]\d{2})[^€]*Trend/i,
    ],
  },

  // Low price (From)
  lowPrice: {
    primary: [
      '.info-list-container dt:contains("From") + dd',
      '.info-list-container dt:contains("Ab") + dd',
      '.price-container .low',
    ],
    fallback: [
      'dd:contains("From")',
      '[class*="lowPrice"]',
    ],
    regex: [
      /(?:From|Ab)[^€]*€\s*(\d+[.,]\d{2})/i,
      /€\s*(\d+[.,]\d{2})[^€]*(?:From|Ab)/i,
    ],
  },

  // 30-day average
  avg30Price: {
    primary: [
      '.info-list-container dt:contains("30-days") + dd',
      '.info-list-container dt:contains("30 Tage") + dd',
      '[data-metric="avg30"]',
    ],
    fallback: [],
    regex: [
      /30[^€]*€\s*(\d+[.,]\d{2})/i,
    ],
  },

  // 7-day average
  avg7Price: {
    primary: [
      '.info-list-container dt:contains("7-days") + dd',
      '[data-metric="avg7"]',
    ],
    fallback: [],
    regex: [
      /7[^€]*€\s*(\d+[.,]\d{2})/i,
    ],
  },

  // Available copies count
  availableCopies: {
    primary: [
      '.info-list-container dt:contains("Available") + dd',
      '.info-list-container dt:contains("Verfügbar") + dd',
    ],
    fallback: [
      '[class*="availability"]',
    ],
    regex: [
      /(\d+)\s*(?:items|copies|Artikel)/i,
    ],
  },

  // Card image
  cardImage: {
    primary: [
      '.product-image img',
      '.card-image img',
      '[class*="productImage"] img',
    ],
    fallback: [
      'img[src*="img.cardmarket.com"]',
    ],
  },

  // Card details (set, number, rarity)
  cardDetails: {
    primary: [
      '.info-list-container',
      '.product-details',
    ],
    fallback: [
      '[class*="productInfo"]',
    ],
  },

  // Price change indicators
  priceChange7d: {
    primary: [
      '[data-change="7d"]',
      '.price-change-7d',
    ],
    fallback: [],
    regex: [
      /([+-]?\d+[.,]?\d*)\s*%\s*(?:7|week)/i,
    ],
  },

  priceChange30d: {
    primary: [
      '[data-change="30d"]',
      '.price-change-30d',
    ],
    fallback: [],
    regex: [
      /([+-]?\d+[.,]?\d*)\s*%\s*(?:30|month)/i,
    ],
  },
};

/**
 * Article/listing selectors (individual seller listings)
 */
export const ARTICLE_SELECTORS: PageSelectors = {
  // Article row
  articleRow: {
    primary: [
      '.article-row',
      '.table-body .row',
      '[class*="articleRow"]',
    ],
    fallback: [
      'div[class*="article"]',
    ],
  },

  // Seller name
  sellerName: {
    primary: [
      '.seller-name a',
      '[class*="sellerName"] a',
      '.col-seller a',
    ],
    fallback: [
      'a[href*="/Users/"]',
    ],
  },

  // Seller rating
  sellerRating: {
    primary: [
      '.seller-rating',
      '[class*="sellerRating"]',
      '.col-seller [class*="rating"]',
    ],
    fallback: [],
    regex: [
      /(\d+(?:[.,]\d+)?)\s*%/,
    ],
  },

  // Article condition
  articleCondition: {
    primary: [
      '.col-condition abbr',
      '[class*="condition"] abbr',
      '.condition-icon',
    ],
    fallback: [
      '[title*="Mint"]',
      '[title*="Near Mint"]',
      '[title*="Excellent"]',
      '[title*="Good"]',
      '[title*="Played"]',
      '[title*="Poor"]',
    ],
  },

  // Article price
  articlePrice: {
    primary: [
      '.col-price .price-container',
      '.article-price',
      '[class*="articlePrice"]',
    ],
    fallback: [
      '.col-price',
    ],
    regex: [
      /€\s*(\d+[.,]\d{2})/,
    ],
  },

  // Article quantity
  articleQuantity: {
    primary: [
      '.col-quantity',
      '[class*="quantity"]',
    ],
    fallback: [],
    regex: [
      /(\d+)\s*(?:×|x|available)/i,
    ],
  },

  // Language
  articleLanguage: {
    primary: [
      '.col-product [class*="language"]',
      '.language-icon',
      'span[class*="flag"]',
    ],
    fallback: [
      'img[src*="flag"]',
    ],
  },

  // Foil indicator
  isFoil: {
    primary: [
      '[class*="foil"]',
      '.foil-icon',
      'span[title*="Foil"]',
    ],
    fallback: [],
  },
};

/**
 * Get selector list for a specific field
 */
export function getSelectors(
  page: 'expansion' | 'card' | 'article',
  field: string
): SelectorStrategy | null {
  const selectorMap = {
    expansion: EXPANSION_PAGE_SELECTORS,
    card: CARD_DETAIL_SELECTORS,
    article: ARTICLE_SELECTORS,
  };

  return selectorMap[page]?.[field] ?? null;
}

/**
 * Get all selectors for a field (primary + fallback combined)
 */
export function getAllSelectors(
  page: 'expansion' | 'card' | 'article',
  field: string
): string[] {
  const strategy = getSelectors(page, field);
  if (!strategy) return [];
  return [...strategy.primary, ...strategy.fallback];
}
