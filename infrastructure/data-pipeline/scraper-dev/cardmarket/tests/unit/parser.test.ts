/**
 * Unit tests for HTML Parser
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  CardmarketHtmlParser,
  type ParsedProduct,
  type ParsedCardDetails,
} from '../../src/parsers/html-parser.js';

describe('CardmarketHtmlParser', () => {
  let parser: CardmarketHtmlParser;

  beforeEach(() => {
    parser = new CardmarketHtmlParser();
  });

  describe('parseExpansionPage', () => {
    it('should parse products from expansion page HTML', () => {
      const html = `
        <html>
          <body>
            <div class="table-body">
              <div class="row product-row">
                <div class="col-product">
                  <a href="/en/OnePiece/Products/Singles/Romance-Dawn/Monkey-D-Luffy-OP01-003">
                    Monkey D. Luffy OP01-003
                  </a>
                </div>
                <div class="col-price">
                  <span class="font-weight-bold">€ 2,50</span>
                </div>
                <div class="col-availability">
                  <span class="availability">42 available</span>
                </div>
              </div>
            </div>
          </body>
        </html>
      `;

      const products = parser.parseExpansionPage(html, 'https://www.cardmarket.com');

      expect(products.length).toBeGreaterThan(0);
      expect(products[0].name).toContain('Monkey D. Luffy');
      expect(products[0].url).toContain('OP01-003');
    });

    it('should extract card numbers from URLs', () => {
      const html = `
        <html>
          <body>
            <a href="/Products/Singles/OP01/Card-Name-OP01-042">Card Name OP01-042</a>
          </body>
        </html>
      `;

      const products = parser.parseExpansionPage(html, 'https://www.cardmarket.com');

      expect(products.length).toBe(1);
      expect(products[0].cardNumber).toBe('042');
      expect(products[0].setCode).toBe('OP01');
    });

    it('should detect variant types', () => {
      const html = `
        <html>
          <body>
            <a href="/Products/Singles/OP01/Luffy-Parallel-OP01-003">Luffy (Parallel) OP01-003</a>
            <a href="/Products/Singles/OP01/Luffy-Manga-OP01-003">Luffy (Manga) OP01-003</a>
          </body>
        </html>
      `;

      const products = parser.parseExpansionPage(html, 'https://www.cardmarket.com');

      expect(products.length).toBe(2);
      expect(products[0].variantType).toBe('parallel');
      expect(products[1].variantType).toBe('manga');
    });

    it('should return empty array for invalid HTML', () => {
      const html = '<html><body><div>No products here</div></body></html>';
      const products = parser.parseExpansionPage(html, 'https://www.cardmarket.com');
      expect(products).toEqual([]);
    });
  });

  describe('parseCardDetailPage', () => {
    it('should parse card details from card page HTML', () => {
      const html = `
        <html>
          <body>
            <h1 class="page-title">Monkey D. Luffy OP01-003</h1>
            <div class="info-list-container">
              <dt>Trend</dt><dd>€ 5,50</dd>
              <dt>From</dt><dd>€ 4,99</dd>
              <dt>Available</dt><dd>127 items</dd>
            </div>
            <img class="product-image" src="https://img.cardmarket.com/card.jpg">
          </body>
        </html>
      `;

      const details = parser.parseCardDetailPage(html);

      expect(details).not.toBeNull();
      expect(details?.name).toContain('Monkey D. Luffy');
      expect(details?.cardNumber).toBe('003');
      expect(details?.setCode).toBe('OP01');
    });

    it('should return null when card name cannot be extracted', () => {
      const html = '<html><body><div>No card info</div></body></html>';
      const details = parser.parseCardDetailPage(html);
      expect(details).toBeNull();
    });
  });

  describe('isBlocked', () => {
    it('should detect captcha pages', () => {
      const html = '<html><body>Please complete the captcha to continue</body></html>';
      expect(parser.isBlocked(html)).toBe(true);
    });

    it('should detect rate limit pages', () => {
      const html = '<html><body>Too many requests. Please try again later.</body></html>';
      expect(parser.isBlocked(html)).toBe(true);
    });

    it('should not flag normal pages as blocked', () => {
      const html = '<html><body><h1>Card Name</h1><div class="price">€5.00</div></body></html>';
      expect(parser.isBlocked(html)).toBe(false);
    });
  });

  describe('isValidCardmarketPage', () => {
    it('should validate cardmarket pages', () => {
      const html = '<html><head><title>Cardmarket</title></head></html>';
      expect(parser.isValidCardmarketPage(html)).toBe(true);
    });

    it('should reject non-cardmarket pages', () => {
      const html = '<html><head><title>Some Other Site</title></head></html>';
      expect(parser.isValidCardmarketPage(html)).toBe(false);
    });
  });

  describe('extractPagination', () => {
    it('should extract pagination info', () => {
      const html = `
        <html>
          <body>
            <div class="pagination">
              <a href="?page=1">1</a>
              <span class="active">2</span>
              <a href="?page=3">3</a>
              <a href="?page=10">10</a>
            </div>
          </body>
        </html>
      `;

      const pagination = parser.extractPagination(html);

      expect(pagination).not.toBeNull();
      expect(pagination?.currentPage).toBe(2);
      expect(pagination?.totalPages).toBe(10);
    });

    it('should return null when no pagination found', () => {
      const html = '<html><body>No pagination</body></html>';
      expect(parser.extractPagination(html)).toBeNull();
    });
  });

  describe('getStats', () => {
    it('should track parsing statistics', () => {
      const html = `
        <html>
          <body>
            <a href="/Products/Singles/OP01/Card-OP01-001">Card 1</a>
          </body>
        </html>
      `;

      parser.parseExpansionPage(html, 'https://www.cardmarket.com');
      const stats = parser.getStats();

      expect(stats.selectorsAttempted).toBeGreaterThan(0);
    });

    it('should reset statistics', () => {
      parser.resetStats();
      const stats = parser.getStats();

      expect(stats.selectorsAttempted).toBe(0);
      expect(stats.selectorSuccesses).toBe(0);
      expect(stats.errors).toEqual([]);
    });
  });
});
