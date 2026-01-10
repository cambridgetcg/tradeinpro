/**
 * Tests for FeatureCalculator with Extended Statistics Context
 *
 * These tests verify that the FeatureCalculator correctly uses
 * pre-computed statistics from the statistics and correlation services.
 */

import { describe, it, expect } from "vitest";
import {
  FeatureCalculator,
  type ExtendedStatisticsContext,
} from "../features.server";
import type { CardWithData, SetStatistics, GameStatistics } from "../types";
import type { RarityDistribution, VolumeStats } from "../../data-collection/services/statistics.server";
import type { CardCorrelation } from "../../data-collection/services/correlation.server";

// Mock card data
const mockCard: CardWithData = {
  card: {
    cardId: "OP01-001",
    name: "Test Card",
    setCode: "OP01",
    rarity: "Secret Rare",
    optcgTcgplayerGbp: { toNumber: () => 50 },
    limitlessCardmarketGbp: { toNumber: () => 45 },
    justtcgTcgplayerGbp: { toNumber: () => 52 },
    bestPriceGbp: { toNumber: () => 50 },
    tradeinPriceGbp: { toNumber: () => 35 },
  },
  history: Array.from({ length: 30 }, (_, i) => ({
    snapshotDate: new Date(Date.now() - (29 - i) * 24 * 60 * 60 * 1000),
    priceGbp: { toNumber: () => 45 + Math.sin(i / 3) * 5 },
    change: { toNumber: () => 0.01 },
  })),
  sources: [
    { priceGbp: { toNumber: () => 50 }, priceJpy: null },
    { priceGbp: { toNumber: () => 45 }, priceJpy: null },
  ],
  fx: [
    { jpyToGbp: { toNumber: () => 0.00472 } },
  ],
};

const mockSetStats: SetStatistics = {
  setCode: "OP01",
  cardCount: 100,
  avgPrice: 30,
  momentum7d: 0.05,
  pricePercentile: (price: number) => price / 100,
};

const mockGameStats: GameStatistics = {
  tcg100AvgPrice: 25,
  sentiment: 0.2,
  getMarketCapRank: () => 50,
};

// Mock rarity distribution
const mockRarityDistribution: RarityDistribution = {
  rarity: "Secret Rare",
  cardCount: 50,
  avgPrice: 60,
  percentiles: {
    p10: 20,
    p25: 35,
    p50: 55,
    p75: 80,
    p90: 100,
    p95: 120,
    p99: 150,
  },
  momentum7d: 0.08,
  momentum30d: 0.15,
};

// Mock volume stats
const mockVolumeStats: VolumeStats = {
  avgUsListings: 15,
  avgEuListings: 20,
  totalCardsTracked: 500,
  byRarity: {
    "Secret Rare": { avgListings: 25, cardCount: 50 },
    "Rare": { avgListings: 50, cardCount: 200 },
  },
};

// Mock card correlation
const mockCardCorrelation: CardCorrelation = {
  cardId: "OP01-001",
  correlationToSet: 0.85,
  correlationToRarity: 0.72,
  correlationDeviation: 0.13,
  sampleDays: 30,
  pValueSet: 0.001,
  pValueRarity: 0.005,
};

describe("FeatureCalculator with Extended Statistics", () => {
  describe("without extended stats (backwards compatibility)", () => {
    it("should use default values when no extended stats provided", () => {
      const calculator = new FeatureCalculator(
        mockCard as any,
        mockSetStats,
        mockGameStats
      );

      const features = calculator.calculate();

      // Should use defaults
      expect(features.market.rarity_momentum).toBe(0);
      expect(features.market.correlation_to_set).toBe(0.7);
      expect(features.market.correlation_to_rarity).toBe(0.5);
      expect(features.market.correlation_deviation).toBe(0.2);
      expect(features.market.volume_relative).toBe(1);
      expect(features.market.inventory_signal).toBe(0);
    });
  });

  describe("with extended stats", () => {
    const extendedStats: ExtendedStatisticsContext = {
      rarityStats: new Map([["Secret Rare", mockRarityDistribution]]),
      volumeStats: mockVolumeStats,
      cardCorrelation: mockCardCorrelation,
      usListingsCount: 30,
      euAvailableItems: 25,
    };

    it("should use rarity momentum from statistics", () => {
      const calculator = new FeatureCalculator(
        mockCard as any,
        mockSetStats,
        mockGameStats,
        extendedStats
      );

      const features = calculator.calculate();

      expect(features.market.rarity_momentum).toBe(0.08);
    });

    it("should use correlations from correlation cache", () => {
      const calculator = new FeatureCalculator(
        mockCard as any,
        mockSetStats,
        mockGameStats,
        extendedStats
      );

      const features = calculator.calculate();

      expect(features.market.correlation_to_set).toBe(0.85);
      expect(features.market.correlation_to_rarity).toBe(0.72);
      expect(features.market.correlation_deviation).toBe(0.13);
    });

    it("should calculate relative volume using listing counts", () => {
      const calculator = new FeatureCalculator(
        mockCard as any,
        mockSetStats,
        mockGameStats,
        extendedStats
      );

      const features = calculator.calculate();

      // Card has 55 listings (30 US + 25 EU)
      // Average is 35 (15 + 20)
      // log(56) / log(36) should be > 1
      expect(features.market.volume_relative).toBeGreaterThan(1);
    });

    it("should calculate inventory signal relative to rarity average", () => {
      const calculator = new FeatureCalculator(
        mockCard as any,
        mockSetStats,
        mockGameStats,
        extendedStats
      );

      const features = calculator.calculate();

      // Card has 55 listings, rarity average is 25
      // (55 - 25) / 25 = 1.2
      // tanh(1.2) is positive
      expect(features.market.inventory_signal).toBeGreaterThan(0);
    });

    it("should calculate rarity percentile correctly", () => {
      const calculator = new FeatureCalculator(
        mockCard as any,
        mockSetStats,
        mockGameStats,
        extendedStats
      );

      const features = calculator.calculate();

      // Price is 50 GBP, between p25 (35) and p50 (55)
      // interpolation: 0.25 + (50-35)/(55-35) * (0.5-0.25) = 0.4375
      expect(features.price.percentile_in_rarity).toBeCloseTo(0.4375, 2);
    });
  });

  describe("edge cases", () => {
    it("should handle missing rarity in stats gracefully", () => {
      const extendedStats: ExtendedStatisticsContext = {
        rarityStats: new Map([["Common", mockRarityDistribution]]), // Different rarity
        volumeStats: mockVolumeStats,
        cardCorrelation: mockCardCorrelation,
      };

      const calculator = new FeatureCalculator(
        mockCard as any,
        mockSetStats,
        mockGameStats,
        extendedStats
      );

      const features = calculator.calculate();

      // Should use defaults for missing rarity
      expect(features.market.rarity_momentum).toBe(0);
      expect(features.price.percentile_in_rarity).toBe(0.5);
    });

    it("should handle zero volume stats gracefully", () => {
      const zeroVolumeStats: VolumeStats = {
        avgUsListings: 0,
        avgEuListings: 0,
        totalCardsTracked: 0,
        byRarity: {},
      };

      const extendedStats: ExtendedStatisticsContext = {
        volumeStats: zeroVolumeStats,
        usListingsCount: 10,
        euAvailableItems: 5,
      };

      const calculator = new FeatureCalculator(
        mockCard as any,
        mockSetStats,
        mockGameStats,
        extendedStats
      );

      const features = calculator.calculate();

      expect(features.market.volume_relative).toBe(1);
      expect(features.market.inventory_signal).toBe(0);
    });

    it("should handle null correlation gracefully", () => {
      const extendedStats: ExtendedStatisticsContext = {
        cardCorrelation: null,
      };

      const calculator = new FeatureCalculator(
        mockCard as any,
        mockSetStats,
        mockGameStats,
        extendedStats
      );

      const features = calculator.calculate();

      // Should use defaults
      expect(features.market.correlation_to_set).toBe(0.7);
      expect(features.market.correlation_to_rarity).toBe(0.5);
    });
  });

  describe("liquidity score", () => {
    it("should factor in both sources and listings", () => {
      const extendedStats: ExtendedStatisticsContext = {
        usListingsCount: 100,
        euAvailableItems: 100,
      };

      const calculator = new FeatureCalculator(
        mockCard as any,
        mockSetStats,
        mockGameStats,
        extendedStats
      );

      const features = calculator.calculate();

      // High listings should increase liquidity
      expect(features.market.liquidity_score).toBeGreaterThan(0.5);
    });

    it("should have lower liquidity with few listings", () => {
      const extendedStats: ExtendedStatisticsContext = {
        usListingsCount: 1,
        euAvailableItems: 1,
      };

      const calculator = new FeatureCalculator(
        mockCard as any,
        mockSetStats,
        mockGameStats,
        extendedStats
      );

      const features = calculator.calculate();

      // Low listings should result in lower liquidity
      // (but still gets score from sources)
      expect(features.market.liquidity_score).toBeLessThan(0.5);
    });
  });
});
