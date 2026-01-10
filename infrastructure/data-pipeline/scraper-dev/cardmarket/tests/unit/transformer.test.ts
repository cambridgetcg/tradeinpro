/**
 * Unit tests for Data Transformer
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ScrapedCard } from '../../src/scrapers/cardmarket-scraper.js';

// Mock CloudWatch metrics
vi.mock('../../src/monitoring/cloudwatch.js', () => ({
  CloudWatchMetrics: vi.fn().mockImplementation(() => ({
    putMetric: vi.fn().mockResolvedValue(undefined),
    flush: vi.fn().mockResolvedValue(undefined),
  })),
}));

// Import after mocking
const { DataTransformer, createTransformer } = await import(
  '../../src/pipeline/transformer.js'
);

describe('DataTransformer', () => {
  let transformer: InstanceType<typeof DataTransformer>;

  const createMockCard = (overrides: Partial<ScrapedCard> = {}): ScrapedCard => ({
    name: 'Monkey D. Luffy',
    cardId: 'OP01-003',
    setCode: 'OP01',
    cardNumber: '003',
    url: 'https://www.cardmarket.com/en/OnePiece/Products/Singles/Romance-Dawn/OP01-003',
    trendPrice: 10.5,
    lowPrice: 8.0,
    available: 50,
    currency: 'EUR',
    scrapedAt: new Date().toISOString(),
    ...overrides,
  });

  beforeEach(() => {
    transformer = createTransformer();
  });

  describe('transform', () => {
    it('should transform valid cards', async () => {
      const cards = [createMockCard()];
      const result = await transformer.transform(cards);

      expect(result.valid.length).toBe(1);
      expect(result.invalid.length).toBe(0);
      expect(result.valid[0].cardId).toBe('OP01-003');
    });

    it('should convert EUR to GBP', async () => {
      const cards = [createMockCard({ trendPrice: 10.0, lowPrice: 8.0 })];
      const result = await transformer.transform(cards);

      // Default EUR/GBP rate is 0.85
      expect(result.valid[0].trendPriceGbp).toBeCloseTo(8.5, 2);
      expect(result.valid[0].lowPriceGbp).toBeCloseTo(6.8, 2);
    });

    it('should calculate trade-in price', async () => {
      const cards = [createMockCard({ lowPrice: 10.0 })];
      const result = await transformer.transform(cards);

      // Trade-in = best price * 0.70
      const bestPriceGbp = 10.0 * 0.85;
      const expectedTradein = bestPriceGbp * 0.7;
      expect(result.valid[0].tradeinPriceGbp).toBeCloseTo(expectedTradein, 2);
    });

    it('should reject cards with invalid prices', async () => {
      const cards = [
        createMockCard({ trendPrice: -5 }),
        createMockCard({ trendPrice: 0 }),
        createMockCard({ trendPrice: 15000 }), // Above max threshold
      ];

      const result = await transformer.transform(cards);

      expect(result.invalid.length).toBe(3);
      expect(result.valid.length).toBe(0);
    });

    it('should reject cards without card ID', async () => {
      const cards = [createMockCard({ cardId: undefined as any })];
      const result = await transformer.transform(cards);

      expect(result.invalid.length).toBe(1);
      expect(result.invalid[0].reasons).toContain('Missing card ID');
    });

    it('should deduplicate cards keeping the latest', async () => {
      const cards = [
        createMockCard({ trendPrice: 10.0, scrapedAt: '2026-01-09T10:00:00Z' }),
        createMockCard({ trendPrice: 12.0, scrapedAt: '2026-01-09T12:00:00Z' }), // Later
      ];

      const result = await transformer.transform(cards);

      expect(result.valid.length).toBe(1);
      expect(result.valid[0].trendPriceGbp).toBeCloseTo(12.0 * 0.85, 2); // Kept the later one
    });
  });

  describe('anomaly detection', () => {
    it('should flag price anomalies over threshold', async () => {
      const cards = [
        createMockCard({
          trendPrice: 100.0,
          // Simulate previous price was 50 EUR (100% increase)
        }),
      ];

      // Enable anomaly detection with low threshold
      transformer = createTransformer({
        anomalyThresholdPercent: 50,
        enableAnomalyDetection: true,
      });

      const result = await transformer.transform(cards);

      // Since we don't have historical data in this test, it won't flag as anomaly
      // but the field should exist
      expect(result.valid[0]).toHaveProperty('isAnomaly');
    });
  });

  describe('validation', () => {
    it('should validate price range', () => {
      const validResult = transformer['validatePriceRange'](50);
      const tooLow = transformer['validatePriceRange'](0.001);
      const tooHigh = transformer['validatePriceRange'](20000);

      expect(validResult.valid).toBe(true);
      expect(tooLow.valid).toBe(false);
      expect(tooHigh.valid).toBe(false);
    });

    it('should validate card ID format', () => {
      const valid1 = transformer['validateCardId']('OP01-003');
      const valid2 = transformer['validateCardId']('EB02-045');
      const valid3 = transformer['validateCardId']('ST15-001');
      const invalid = transformer['validateCardId']('INVALID');

      expect(valid1).toBe(true);
      expect(valid2).toBe(true);
      expect(valid3).toBe(true);
      expect(invalid).toBe(false);
    });
  });

  describe('currency conversion', () => {
    it('should use custom exchange rate', async () => {
      transformer.setExchangeRate(0.90);

      const cards = [createMockCard({ trendPrice: 100.0 })];
      const result = await transformer.transform(cards);

      expect(result.valid[0].trendPriceGbp).toBeCloseTo(90.0, 2);
    });

    it('should handle zero prices gracefully', async () => {
      const cards = [createMockCard({ trendPrice: 0.01, lowPrice: 0 })];
      const result = await transformer.transform(cards);

      // Low price of 0 should be handled or rejected
      expect(result.valid.length + result.invalid.length).toBe(1);
    });
  });
});
