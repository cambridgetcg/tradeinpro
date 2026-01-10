/**
 * Multi-Strategy HTML Parser for Cardmarket
 *
 * Implements a robust parsing approach with:
 * 1. Primary CSS selectors
 * 2. Fallback CSS selectors
 * 3. Regex-based extraction
 * 4. Heuristic matching
 */

import * as cheerio from 'cheerio';
import type { CheerioAPI, Cheerio, Element } from 'cheerio';
import {
  EXPANSION_PAGE_SELECTORS,
  CARD_DETAIL_SELECTORS,
  ARTICLE_SELECTORS,
  type SelectorStrategy,
} from '../config/selectors.js';
import {
  parsePrice,
  parseIntSafe,
  parsePercentage,
  extractCardNumber,
  normalizeCondition,
  detectVariantType,
  cleanHtmlText,
} from '../utils/index.js';

/**
 * Parsed product from expansion page
 */
export interface ParsedProduct {
  name: string;
  url: string;
  cardNumber: string | null;
  setCode: string | null;
  rarity: string | null;
  trendPrice: number | null;
  lowPrice: number | null;
  availableCount: number | null;
  variantType: string;
}

/**
 * Parsed card details from card page
 */
export interface ParsedCardDetails {
  name: string;
  cardNumber: string | null;
  setCode: string | null;
  rarity: string | null;
  imageUrl: string | null;
  trendPrice: number | null;
  lowPrice: number | null;
  avg7Price: number | null;
  avg30Price: number | null;
  availableCount: number | null;
  priceChange7d: number | null;
  priceChange30d: number | null;
  variantType: string;
}

/**
 * Parsed article (seller listing)
 */
export interface ParsedArticle {
  sellerName: string;
  sellerUrl: string | null;
  sellerRating: number | null;
  condition: string;
  language: string;
  isFoil: boolean;
  price: number;
  quantity: number;
}

/**
 * Parser statistics for debugging
 */
export interface ParserStats {
  selectorsAttempted: number;
  selectorSuccesses: number;
  regexAttempted: number;
  regexSuccesses: number;
  fallbacksUsed: number;
  errors: string[];
}

/**
 * HTML Parser class with multi-strategy support
 */
export class CardmarketHtmlParser {
  private stats: ParserStats;

  constructor() {
    this.stats = this.initStats();
  }

  private initStats(): ParserStats {
    return {
      selectorsAttempted: 0,
      selectorSuccesses: 0,
      regexAttempted: 0,
      regexSuccesses: 0,
      fallbacksUsed: 0,
      errors: [],
    };
  }

  /**
   * Get parsing statistics
   */
  getStats(): ParserStats {
    return { ...this.stats };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.stats = this.initStats();
  }

  /**
   * Try multiple CSS selectors until one works
   */
  private trySelectors($: CheerioAPI, selectors: string[], context?: Cheerio<Element>): string | null {
    for (const selector of selectors) {
      this.stats.selectorsAttempted++;
      try {
        const element = context ? context.find(selector) : $(selector);
        if (element.length > 0) {
          const text = cleanHtmlText(element.first().text());
          if (text) {
            this.stats.selectorSuccesses++;
            return text;
          }
        }
      } catch {
        // Selector failed, try next
      }
    }
    return null;
  }

  /**
   * Try regex patterns on text
   */
  private tryRegex(text: string, patterns: RegExp[]): string | null {
    for (const pattern of patterns) {
      this.stats.regexAttempted++;
      const match = text.match(pattern);
      if (match && match[1]) {
        this.stats.regexSuccesses++;
        return match[1];
      }
    }
    return null;
  }

  /**
   * Extract value using multi-strategy approach
   */
  private extractValue(
    $: CheerioAPI,
    strategy: SelectorStrategy,
    context?: Cheerio<Element>,
    fullHtml?: string
  ): string | null {
    // Try primary selectors first
    let value = this.trySelectors($, strategy.primary, context);

    // Try fallback selectors
    if (!value && strategy.fallback.length > 0) {
      this.stats.fallbacksUsed++;
      value = this.trySelectors($, strategy.fallback, context);
    }

    // Try regex on raw HTML
    if (!value && strategy.regex && fullHtml) {
      value = this.tryRegex(fullHtml, strategy.regex);
    }

    return value;
  }

  /**
   * Parse expansion page (list of products)
   */
  parseExpansionPage(html: string, baseUrl: string): ParsedProduct[] {
    const $ = cheerio.load(html);
    const products: ParsedProduct[] = [];

    // Try to find product rows
    const rowSelectors = [
      ...EXPANSION_PAGE_SELECTORS.productRow.primary,
      ...EXPANSION_PAGE_SELECTORS.productRow.fallback,
    ];

    let rows: Cheerio<Element> | null = null;

    for (const selector of rowSelectors) {
      this.stats.selectorsAttempted++;
      const found = $(selector);
      if (found.length > 0) {
        this.stats.selectorSuccesses++;
        rows = found;
        break;
      }
    }

    if (!rows || rows.length === 0) {
      // Fallback: try to find product links directly
      const productLinks = $('a[href*="/Products/Singles/"]');
      if (productLinks.length > 0) {
        productLinks.each((_, el) => {
          const $el = $(el);
          const href = $el.attr('href');
          const name = cleanHtmlText($el.text());

          if (href && name && name.length > 2) {
            const url = href.startsWith('http') ? href : `${baseUrl}${href}`;
            const cardInfo = extractCardNumber(name) || extractCardNumber(href);

            products.push({
              name,
              url,
              cardNumber: cardInfo?.cardNumber ?? null,
              setCode: cardInfo?.setCode ?? null,
              rarity: null,
              trendPrice: null,
              lowPrice: null,
              availableCount: null,
              variantType: detectVariantType(name),
            });
          }
        });
      }

      return products;
    }

    // Parse each product row
    rows.each((_, row) => {
      try {
        const $row = $(row);
        const rowHtml = $.html(row);

        // Extract name and URL
        const nameStrategy = EXPANSION_PAGE_SELECTORS.productName;
        const name = this.extractValue($, nameStrategy, $row);

        const linkEl = $row.find('a[href*="/Products/Singles/"]').first();
        const href = linkEl.attr('href');

        if (!name || !href) return;

        const url = href.startsWith('http') ? href : `${baseUrl}${href}`;

        // Extract card number
        const cardInfo = extractCardNumber(name) || extractCardNumber(href);

        // Extract price
        const priceStrategy = EXPANSION_PAGE_SELECTORS.productPrice;
        const priceText = this.extractValue($, priceStrategy, $row, rowHtml);
        const trendPrice = priceText ? parsePrice(priceText) : null;

        // Extract quantity
        const quantityStrategy = EXPANSION_PAGE_SELECTORS.productQuantity;
        const quantityText = this.extractValue($, quantityStrategy, $row, rowHtml);
        const availableCount = quantityText ? parseIntSafe(quantityText) : null;

        // Detect variant
        const variantType = detectVariantType(name);

        products.push({
          name,
          url,
          cardNumber: cardInfo?.cardNumber ?? null,
          setCode: cardInfo?.setCode ?? null,
          rarity: null, // Would need additional parsing
          trendPrice,
          lowPrice: null, // Usually not on list page
          availableCount,
          variantType,
        });
      } catch (error) {
        this.stats.errors.push(`Error parsing product row: ${error}`);
      }
    });

    return products;
  }

  /**
   * Parse card detail page
   */
  parseCardDetailPage(html: string): ParsedCardDetails | null {
    const $ = cheerio.load(html);

    try {
      // Extract card name
      const nameStrategy = CARD_DETAIL_SELECTORS.cardName;
      const name = this.extractValue($, nameStrategy, undefined, html);

      if (!name) {
        this.stats.errors.push('Could not extract card name');
        return null;
      }

      // Extract card number from page
      const cardInfo = extractCardNumber(html);

      // Extract image URL
      const imgSelectors = [
        ...CARD_DETAIL_SELECTORS.cardImage.primary,
        ...CARD_DETAIL_SELECTORS.cardImage.fallback,
      ];
      let imageUrl: string | null = null;
      for (const selector of imgSelectors) {
        const img = $(selector).first();
        if (img.length > 0) {
          imageUrl = img.attr('src') || img.attr('data-src') || null;
          if (imageUrl) break;
        }
      }

      // Extract prices
      const trendText = this.extractValue($, CARD_DETAIL_SELECTORS.trendPrice, undefined, html);
      const lowText = this.extractValue($, CARD_DETAIL_SELECTORS.lowPrice, undefined, html);
      const avg7Text = this.extractValue($, CARD_DETAIL_SELECTORS.avg7Price, undefined, html);
      const avg30Text = this.extractValue($, CARD_DETAIL_SELECTORS.avg30Price, undefined, html);

      // Extract availability
      const availText = this.extractValue($, CARD_DETAIL_SELECTORS.availableCopies, undefined, html);

      // Extract price changes
      const change7dText = this.extractValue($, CARD_DETAIL_SELECTORS.priceChange7d, undefined, html);
      const change30dText = this.extractValue($, CARD_DETAIL_SELECTORS.priceChange30d, undefined, html);

      return {
        name,
        cardNumber: cardInfo?.cardNumber ?? null,
        setCode: cardInfo?.setCode ?? null,
        rarity: null, // Would need specific extraction
        imageUrl,
        trendPrice: trendText ? parsePrice(trendText) : null,
        lowPrice: lowText ? parsePrice(lowText) : null,
        avg7Price: avg7Text ? parsePrice(avg7Text) : null,
        avg30Price: avg30Text ? parsePrice(avg30Text) : null,
        availableCount: availText ? parseIntSafe(availText) : null,
        priceChange7d: change7dText ? parsePercentage(change7dText) : null,
        priceChange30d: change30dText ? parsePercentage(change30dText) : null,
        variantType: detectVariantType(name),
      };
    } catch (error) {
      this.stats.errors.push(`Error parsing card detail: ${error}`);
      return null;
    }
  }

  /**
   * Parse articles (seller listings) from card page
   */
  parseArticles(html: string): ParsedArticle[] {
    const $ = cheerio.load(html);
    const articles: ParsedArticle[] = [];

    // Find article rows
    const rowSelectors = [
      ...ARTICLE_SELECTORS.articleRow.primary,
      ...ARTICLE_SELECTORS.articleRow.fallback,
    ];

    let rows: Cheerio<Element> | null = null;

    for (const selector of rowSelectors) {
      const found = $(selector);
      if (found.length > 0) {
        rows = found;
        break;
      }
    }

    if (!rows || rows.length === 0) {
      return articles;
    }

    rows.each((_, row) => {
      try {
        const $row = $(row);
        const rowHtml = $.html(row);

        // Extract seller info
        const sellerNameText = this.extractValue($, ARTICLE_SELECTORS.sellerName, $row);
        if (!sellerNameText) return;

        const sellerLink = $row.find('a[href*="/Users/"]').first();
        const sellerUrl = sellerLink.attr('href') || null;

        // Extract seller rating
        const ratingText = this.extractValue($, ARTICLE_SELECTORS.sellerRating, $row, rowHtml);
        const sellerRating = ratingText ? parsePercentage(ratingText) : null;

        // Extract condition
        let condition = 'NM';
        const conditionEl = $row.find('[class*="condition"] abbr, abbr[title*="Mint"], abbr[title*="Near"], abbr[title*="Excellent"], abbr[title*="Good"], abbr[title*="Played"], abbr[title*="Poor"]').first();
        if (conditionEl.length > 0) {
          const abbr = conditionEl.text().trim() || conditionEl.attr('title')?.split(' ')[0] || 'NM';
          condition = normalizeCondition(abbr);
        }

        // Extract price
        const priceText = this.extractValue($, ARTICLE_SELECTORS.articlePrice, $row, rowHtml);
        const price = priceText ? parsePrice(priceText) : null;
        if (!price) return;

        // Extract quantity
        const quantityText = this.extractValue($, ARTICLE_SELECTORS.articleQuantity, $row, rowHtml);
        const quantity = quantityText ? parseIntSafe(quantityText) : 1;

        // Check for foil
        const foilSelectors = ARTICLE_SELECTORS.isFoil.primary;
        let isFoil = false;
        for (const selector of foilSelectors) {
          if ($row.find(selector).length > 0) {
            isFoil = true;
            break;
          }
        }

        // Extract language (default to EN)
        const language = 'EN'; // Would need specific extraction

        articles.push({
          sellerName: sellerNameText,
          sellerUrl,
          sellerRating,
          condition,
          language,
          isFoil,
          price,
          quantity: quantity || 1,
        });
      } catch (error) {
        this.stats.errors.push(`Error parsing article: ${error}`);
      }
    });

    return articles;
  }

  /**
   * Extract all product URLs from an expansion page
   */
  extractProductUrls(html: string, baseUrl: string): string[] {
    const $ = cheerio.load(html);
    const urls: string[] = [];

    $('a[href*="/Products/Singles/"]').each((_, el) => {
      const href = $(el).attr('href');
      if (href) {
        const fullUrl = href.startsWith('http') ? href : `${baseUrl}${href}`;
        // Filter out non-product pages (like expansion pages)
        if (fullUrl.match(/\/Products\/Singles\/[^/]+\/[^/]+$/)) {
          urls.push(fullUrl);
        }
      }
    });

    return [...new Set(urls)]; // Remove duplicates
  }

  /**
   * Check if page indicates bot detection/blocking
   */
  isBlocked(html: string): boolean {
    const blockedIndicators = [
      'captcha',
      'blocked',
      'too many requests',
      'rate limit',
      'access denied',
      'forbidden',
      'please verify',
      'security check',
    ];

    const lowerHtml = html.toLowerCase();
    return blockedIndicators.some((indicator) => lowerHtml.includes(indicator));
  }

  /**
   * Check if page is a valid Cardmarket page
   */
  isValidCardmarketPage(html: string): boolean {
    return (
      html.includes('cardmarket.com') ||
      html.includes('Cardmarket') ||
      html.includes('MKM')
    );
  }

  /**
   * Extract pagination info
   */
  extractPagination(html: string): { currentPage: number; totalPages: number } | null {
    const $ = cheerio.load(html);

    // Try to find pagination
    const pagination = $('.pagination, [class*="pagination"]');
    if (pagination.length === 0) {
      return null;
    }

    const activePage = pagination.find('.active, [class*="active"]');
    const currentPage = activePage.length > 0 ? parseIntSafe(activePage.text()) || 1 : 1;

    // Try to find total pages
    const pageLinks = pagination.find('a[href*="page="]');
    let maxPage = currentPage;

    pageLinks.each((_, el) => {
      const pageText = $(el).text().trim();
      const pageNum = parseIntSafe(pageText);
      if (pageNum && pageNum > maxPage) {
        maxPage = pageNum;
      }
    });

    return { currentPage, totalPages: maxPage };
  }
}
