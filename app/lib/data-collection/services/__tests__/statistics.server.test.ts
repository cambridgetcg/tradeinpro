/**
 * Tests for Statistics Service
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  computeRarityStatistics,
  computeSetStatistics,
  computeVolumeStatistics,
  calculatePricePercentile,
  type RarityDistribution,
} from "../statistics.server";

// Helper to create Decimal-like mock that works with Number()
const decimal = (n: number) => ({
  valueOf: () => n,
  toNumber: () => n,
  toString: () => String(n),
});

// Mock Prisma client
const mockPrisma = {
  cardPriceV2: {
    findMany: vi.fn(),
    groupBy: vi.fn(),
  },
  marketPriceUS: {
    findMany: vi.fn(),
  },
  marketPriceEU: {
    findMany: vi.fn(),
  },
  rarityStatistics: {
    upsert: vi.fn(),
    findMany: vi.fn(),
  },
  setStatistics: {
    upsert: vi.fn(),
    findMany: vi.fn(),
  },
  volumeStatistics: {
    upsert: vi.fn(),
    findFirst: vi.fn(),
  },
  $queryRaw: vi.fn(),
};

describe("Statistics Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("computeRarityStatistics", () => {
    it("should calculate rarity percentiles correctly", async () => {
      // Mock card data with varying prices
      const mockCards = [
        { cardId: "card1", rarity: "Secret Rare", bestPriceGbp: decimal(10) },
        { cardId: "card2", rarity: "Secret Rare", bestPriceGbp: decimal(20) },
        { cardId: "card3", rarity: "Secret Rare", bestPriceGbp: decimal(30) },
        { cardId: "card4", rarity: "Secret Rare", bestPriceGbp: decimal(40) },
        { cardId: "card5", rarity: "Secret Rare", bestPriceGbp: decimal(50) },
        { cardId: "card6", rarity: "Secret Rare", bestPriceGbp: decimal(60) },
        { cardId: "card7", rarity: "Secret Rare", bestPriceGbp: decimal(70) },
        { cardId: "card8", rarity: "Secret Rare", bestPriceGbp: decimal(80) },
        { cardId: "card9", rarity: "Secret Rare", bestPriceGbp: decimal(90) },
        { cardId: "card10", rarity: "Secret Rare", bestPriceGbp: decimal(100) },
        { cardId: "card11", rarity: "Rare", bestPriceGbp: decimal(5) },
        { cardId: "card12", rarity: "Rare", bestPriceGbp: decimal(8) },
      ];

      mockPrisma.cardPriceV2.findMany.mockResolvedValue(mockCards);

      const result = await computeRarityStatistics(mockPrisma as any, "onepiece");

      expect(result).toHaveLength(2);

      const secretRare = result.find((r) => r.rarity === "Secret Rare");
      expect(secretRare).toBeDefined();
      expect(secretRare!.cardCount).toBe(10);
      expect(secretRare!.avgPrice).toBe(55);
      expect(secretRare!.percentiles.p50).toBeCloseTo(55, 0);

      const rare = result.find((r) => r.rarity === "Rare");
      expect(rare).toBeDefined();
      expect(rare!.cardCount).toBe(2);
    });

    it("should handle empty data", async () => {
      mockPrisma.cardPriceV2.findMany.mockResolvedValue([]);

      const result = await computeRarityStatistics(mockPrisma as any, "onepiece");

      expect(result).toHaveLength(0);
    });

    it("should filter out zero prices", async () => {
      const mockCards = [
        { cardId: "card1", rarity: "Rare", bestPriceGbp: decimal(0) },
        { cardId: "card2", rarity: "Rare", bestPriceGbp: decimal(10) },
      ];

      // Note: The filter happens at the query level with gt: 0
      mockPrisma.cardPriceV2.findMany.mockResolvedValue([mockCards[1]]);

      const result = await computeRarityStatistics(mockPrisma as any, "onepiece");

      expect(result).toHaveLength(1);
      expect(result[0].cardCount).toBe(1);
    });
  });

  describe("computeSetStatistics", () => {
    it("should calculate set statistics correctly", async () => {
      const mockCards = [
        { cardId: "OP01-001", setCode: "OP01", bestPriceGbp: decimal(10) },
        { cardId: "OP01-002", setCode: "OP01", bestPriceGbp: decimal(20) },
        { cardId: "OP01-003", setCode: "OP01", bestPriceGbp: decimal(30) },
        { cardId: "OP02-001", setCode: "OP02", bestPriceGbp: decimal(100) },
      ];

      mockPrisma.cardPriceV2.findMany.mockResolvedValue(mockCards);

      const result = await computeSetStatistics(mockPrisma as any, "onepiece");

      expect(result).toHaveLength(2);

      const op01 = result.find((s) => s.setCode === "OP01");
      expect(op01).toBeDefined();
      expect(op01!.cardCount).toBe(3);
      expect(op01!.avgPrice).toBe(20);
      expect(op01!.medianPrice).toBe(20);
      expect(op01!.totalMarketCap).toBe(60);
      expect(op01!.minPrice).toBe(10);
      expect(op01!.maxPrice).toBe(30);

      const op02 = result.find((s) => s.setCode === "OP02");
      expect(op02).toBeDefined();
      expect(op02!.cardCount).toBe(1);
      expect(op02!.avgPrice).toBe(100);
    });
  });

  describe("computeVolumeStatistics", () => {
    it("should calculate volume averages", async () => {
      mockPrisma.marketPriceUS.findMany.mockResolvedValue([
        { cardId: "card1", listingsCount: 10 },
        { cardId: "card2", listingsCount: 20 },
        { cardId: "card3", listingsCount: 30 },
      ]);

      mockPrisma.marketPriceEU.findMany.mockResolvedValue([
        { cardId: "card1", availableItems: 5 },
        { cardId: "card2", availableItems: 15 },
      ]);

      mockPrisma.cardPriceV2.findMany.mockResolvedValue([
        { cardId: "card1", rarity: "Rare" },
        { cardId: "card2", rarity: "Rare" },
        { cardId: "card3", rarity: "Secret Rare" },
      ]);

      const result = await computeVolumeStatistics(mockPrisma as any, "onepiece");

      expect(result.avgUsListings).toBe(20); // (10 + 20 + 30) / 3
      expect(result.avgEuListings).toBe(10); // (5 + 15) / 2
      expect(result.totalCardsTracked).toBe(3);
      expect(result.byRarity).toHaveProperty("Rare");
      expect(result.byRarity).toHaveProperty("Secret Rare");
    });

    it("should handle missing data gracefully", async () => {
      mockPrisma.marketPriceUS.findMany.mockResolvedValue([]);
      mockPrisma.marketPriceEU.findMany.mockResolvedValue([]);
      mockPrisma.cardPriceV2.findMany.mockResolvedValue([]);

      const result = await computeVolumeStatistics(mockPrisma as any, "onepiece");

      expect(result.avgUsListings).toBe(0);
      expect(result.avgEuListings).toBe(0);
      expect(result.totalCardsTracked).toBe(0);
    });
  });

  describe("calculatePricePercentile", () => {
    const distribution: RarityDistribution = {
      rarity: "Test",
      cardCount: 100,
      avgPrice: 50,
      percentiles: {
        p10: 10,
        p25: 25,
        p50: 50,
        p75: 75,
        p90: 90,
        p95: 95,
        p99: 99,
      },
      momentum7d: null,
      momentum30d: null,
    };

    it("should return low percentile for low prices", () => {
      const result = calculatePricePercentile(5, distribution);
      expect(result).toBeLessThan(0.1);
    });

    it("should return median for median price", () => {
      const result = calculatePricePercentile(50, distribution);
      expect(result).toBeCloseTo(0.5, 1);
    });

    it("should return high percentile for high prices", () => {
      const result = calculatePricePercentile(99, distribution);
      expect(result).toBeGreaterThan(0.9);
    });

    it("should return ~0.995 for prices above p99", () => {
      const result = calculatePricePercentile(150, distribution);
      expect(result).toBe(0.995);
    });

    it("should interpolate between percentiles", () => {
      const result = calculatePricePercentile(37.5, distribution);
      // Between p25 (0.25) and p50 (0.50), at midpoint
      expect(result).toBeCloseTo(0.375, 2);
    });
  });
});
