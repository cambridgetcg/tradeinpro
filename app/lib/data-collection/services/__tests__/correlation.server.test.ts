/**
 * Tests for Correlation Service
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  computeCardCorrelation,
  getCardCorrelation,
  DEFAULT_CORRELATION,
} from "../correlation.server";

// Helper to create Decimal-like mock that works with Number()
const decimal = (n: number) => ({
  valueOf: () => n,
  toNumber: () => n,
  toString: () => String(n),
});

// Mock Prisma client
const mockPrisma = {
  cardPriceHistory: {
    findMany: vi.fn(),
  },
  cardCorrelationCache: {
    upsert: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
  },
  cardPriceV2: {
    findMany: vi.fn(),
  },
  $queryRaw: vi.fn(),
};

describe("Correlation Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("pearson correlation calculation", () => {
    it("should return 1 for perfectly correlated data", async () => {
      // Create price history where card perfectly tracks the set
      const dates = Array.from({ length: 14 }, (_, i) => {
        const d = new Date();
        d.setDate(d.getDate() - (13 - i));
        return d;
      });

      // Card prices: 10, 11, 12, ...
      const cardHistory = dates.map((d, i) => ({
        snapshotDate: d,
        priceGbp: decimal(10 + i),
      }));

      // Set prices: same trend (20, 22, 24, ...)
      const setIndex = dates.map((d, i) => ({
        snapshot_date: d,
        avg_price: 20 + i * 2,
      }));

      mockPrisma.cardPriceHistory.findMany.mockResolvedValue(cardHistory);
      mockPrisma.$queryRaw.mockResolvedValueOnce(setIndex);
      mockPrisma.$queryRaw.mockResolvedValueOnce(setIndex); // Same for rarity

      const result = await computeCardCorrelation(
        mockPrisma as any,
        "test-card",
        "OP01",
        "Rare",
        30
      );

      expect(result).not.toBeNull();
      expect(result!.correlationToSet).toBeCloseTo(1, 2);
    });

    it("should return -1 for perfectly inversely correlated data", async () => {
      const dates = Array.from({ length: 14 }, (_, i) => {
        const d = new Date();
        d.setDate(d.getDate() - (13 - i));
        return d;
      });

      // Card prices increasing
      const cardHistory = dates.map((d, i) => ({
        snapshotDate: d,
        priceGbp: decimal(10 + i),
      }));

      // Set prices decreasing
      const setIndex = dates.map((d, i) => ({
        snapshot_date: d,
        avg_price: 100 - i * 5,
      }));

      mockPrisma.cardPriceHistory.findMany.mockResolvedValue(cardHistory);
      mockPrisma.$queryRaw.mockResolvedValueOnce(setIndex);
      mockPrisma.$queryRaw.mockResolvedValueOnce(setIndex);

      const result = await computeCardCorrelation(
        mockPrisma as any,
        "test-card",
        "OP01",
        "Rare",
        30
      );

      expect(result).not.toBeNull();
      expect(result!.correlationToSet).toBeLessThan(-0.9);
    });

    it("should return null for insufficient data", async () => {
      // Only 3 days of history (need at least 7)
      const dates = [new Date(), new Date(), new Date()];
      const cardHistory = dates.map((d) => ({
        snapshotDate: d,
        priceGbp: decimal(10),
      }));

      mockPrisma.cardPriceHistory.findMany.mockResolvedValue(cardHistory);

      const result = await computeCardCorrelation(
        mockPrisma as any,
        "test-card",
        "OP01",
        "Rare",
        30
      );

      expect(result).toBeNull();
    });
  });

  describe("correlation deviation", () => {
    it("should calculate deviation between set and rarity correlations", async () => {
      const dates = Array.from({ length: 14 }, (_, i) => {
        const d = new Date();
        d.setDate(d.getDate() - (13 - i));
        return d;
      });

      const cardHistory = dates.map((d, i) => ({
        snapshotDate: d,
        priceGbp: decimal(10 + i),
      }));

      // Set correlation will be high
      const setIndex = dates.map((d, i) => ({
        snapshot_date: d,
        avg_price: 20 + i * 2,
      }));

      // Rarity correlation will be different (negative)
      const rarityIndex = dates.map((d, i) => ({
        snapshot_date: d,
        avg_price: 50 - i * 2,
      }));

      mockPrisma.cardPriceHistory.findMany.mockResolvedValue(cardHistory);
      mockPrisma.$queryRaw.mockResolvedValueOnce(setIndex);
      mockPrisma.$queryRaw.mockResolvedValueOnce(rarityIndex);

      const result = await computeCardCorrelation(
        mockPrisma as any,
        "test-card",
        "OP01",
        "Rare",
        30
      );

      expect(result).not.toBeNull();
      // Deviation should be significant (|1 - (-1)| = 2, but clamped)
      expect(result!.correlationDeviation).toBeGreaterThan(1);
    });
  });

  describe("getCardCorrelation", () => {
    it("should return cached correlation", async () => {
      const cachedData = {
        cardId: "test-card",
        correlationToSet: decimal(0.8),
        correlationToRarity: decimal(0.6),
        correlationDeviation: decimal(0.2),
        sampleDays: 30,
        pValueSet: decimal(0.01),
        pValueRarity: decimal(0.02),
      };

      mockPrisma.cardCorrelationCache.findFirst.mockResolvedValue(cachedData);

      const result = await getCardCorrelation(
        mockPrisma as any,
        "test-card"
      );

      expect(result).not.toBeNull();
      expect(result!.correlationToSet).toBe(0.8);
      expect(result!.correlationToRarity).toBe(0.6);
      expect(result!.correlationDeviation).toBe(0.2);
    });

    it("should return null when no cache exists", async () => {
      mockPrisma.cardCorrelationCache.findFirst.mockResolvedValue(null);

      const result = await getCardCorrelation(
        mockPrisma as any,
        "test-card"
      );

      expect(result).toBeNull();
    });
  });

  describe("DEFAULT_CORRELATION", () => {
    it("should have reasonable default values", () => {
      expect(DEFAULT_CORRELATION.correlationToSet).toBe(0.7);
      expect(DEFAULT_CORRELATION.correlationToRarity).toBe(0.5);
      expect(DEFAULT_CORRELATION.correlationDeviation).toBe(0.2);
      expect(DEFAULT_CORRELATION.sampleDays).toBe(0);
    });
  });
});
