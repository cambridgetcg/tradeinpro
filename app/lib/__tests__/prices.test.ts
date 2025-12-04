import { describe, it, expect, vi, beforeEach } from "vitest";
import { Decimal } from "@prisma/client/runtime/library";

// Mock prisma before importing prices.server
vi.mock("../../db.server", () => ({
  default: {
    cardPrice: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
      groupBy: vi.fn(),
      aggregate: vi.fn(),
    },
    externalCardPrice: {
      findMany: vi.fn(),
      count: vi.fn(),
      groupBy: vi.fn(),
    },
    tradeInItem: {
      count: vi.fn(),
    },
    tradeInSettings: {
      findUnique: vi.fn(),
      create: vi.fn(),
      upsert: vi.fn(),
    },
  },
}));

import prisma from "../../db.server";
import {
  searchPrices,
  getPriceById,
  getUniqueGames,
  previewSync,
  bulkUpdatePrices,
  deletePrices,
  createPrice,
  getPriceStats,
  getExternalPriceCount,
  getExternalGames,
} from "../prices.server";

const mockPrisma = prisma as unknown as {
  cardPrice: {
    findMany: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    groupBy: ReturnType<typeof vi.fn>;
    aggregate: ReturnType<typeof vi.fn>;
  };
  externalCardPrice: {
    findMany: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
    groupBy: ReturnType<typeof vi.fn>;
  };
  tradeInItem: {
    count: ReturnType<typeof vi.fn>;
  };
  tradeInSettings: {
    findUnique: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
  };
};

describe("searchPrices", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should search by card name", async () => {
    const mockPrices = [
      { id: "1", cardName: "Charizard VMAX", setName: "SWSH", priceNM: 5000 },
    ];

    mockPrisma.cardPrice.findMany.mockResolvedValue(mockPrices);
    mockPrisma.cardPrice.count.mockResolvedValue(1);

    const result = await searchPrices({ search: "Charizard" });

    expect(result.prices).toEqual(mockPrices);
    expect(result.pagination.total).toBe(1);
    expect(mockPrisma.cardPrice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            { cardName: { contains: "Charizard", mode: "insensitive" } },
          ]),
        }),
      })
    );
  });

  it("should filter by game", async () => {
    mockPrisma.cardPrice.findMany.mockResolvedValue([]);
    mockPrisma.cardPrice.count.mockResolvedValue(0);

    await searchPrices({ game: "pokemon" });

    expect(mockPrisma.cardPrice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          setName: { contains: "pokemon", mode: "insensitive" },
        }),
      })
    );
  });

  it("should filter by active status", async () => {
    mockPrisma.cardPrice.findMany.mockResolvedValue([]);
    mockPrisma.cardPrice.count.mockResolvedValue(0);

    await searchPrices({ isActive: true });

    expect(mockPrisma.cardPrice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          isActive: true,
        }),
      })
    );
  });

  it("should filter by price range", async () => {
    mockPrisma.cardPrice.findMany.mockResolvedValue([]);
    mockPrisma.cardPrice.count.mockResolvedValue(0);

    await searchPrices({ minPrice: 100, maxPrice: 5000 });

    expect(mockPrisma.cardPrice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          priceNM: { gte: 100, lte: 5000 },
        }),
      })
    );
  });

  it("should paginate results", async () => {
    mockPrisma.cardPrice.findMany.mockResolvedValue([]);
    mockPrisma.cardPrice.count.mockResolvedValue(100);

    const result = await searchPrices({ page: 3, limit: 20 });

    expect(result.pagination.page).toBe(3);
    expect(result.pagination.limit).toBe(20);
    expect(result.pagination.totalPages).toBe(5);
    expect(mockPrisma.cardPrice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 40, // (3-1) * 20
        take: 20,
      })
    );
  });

  it("should sort by name ascending by default", async () => {
    mockPrisma.cardPrice.findMany.mockResolvedValue([]);
    mockPrisma.cardPrice.count.mockResolvedValue(0);

    await searchPrices({});

    expect(mockPrisma.cardPrice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { cardName: "asc" },
      })
    );
  });

  it("should sort by price ascending", async () => {
    mockPrisma.cardPrice.findMany.mockResolvedValue([]);
    mockPrisma.cardPrice.count.mockResolvedValue(0);

    await searchPrices({ sort: "price-asc" });

    expect(mockPrisma.cardPrice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { priceNM: "asc" },
      })
    );
  });

  it("should sort by price descending", async () => {
    mockPrisma.cardPrice.findMany.mockResolvedValue([]);
    mockPrisma.cardPrice.count.mockResolvedValue(0);

    await searchPrices({ sort: "price-desc" });

    expect(mockPrisma.cardPrice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { priceNM: "desc" },
      })
    );
  });

  it("should sort by updated date", async () => {
    mockPrisma.cardPrice.findMany.mockResolvedValue([]);
    mockPrisma.cardPrice.count.mockResolvedValue(0);

    await searchPrices({ sort: "updated" });

    expect(mockPrisma.cardPrice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { updatedAt: "desc" },
      })
    );
  });

  it("should enforce minimum page of 1", async () => {
    mockPrisma.cardPrice.findMany.mockResolvedValue([]);
    mockPrisma.cardPrice.count.mockResolvedValue(0);

    const result = await searchPrices({ page: -5 });

    expect(result.pagination.page).toBe(1);
  });

  it("should enforce maximum limit of 100", async () => {
    mockPrisma.cardPrice.findMany.mockResolvedValue([]);
    mockPrisma.cardPrice.count.mockResolvedValue(0);

    const result = await searchPrices({ limit: 500 });

    expect(result.pagination.limit).toBe(100);
    expect(mockPrisma.cardPrice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 100,
      })
    );
  });
});

describe("getPriceById", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should get price with recent trade-in items", async () => {
    const mockPrice = {
      id: "price-1",
      cardName: "Charizard",
      tradeInItems: [],
    };

    mockPrisma.cardPrice.findUnique.mockResolvedValue(mockPrice);

    const result = await getPriceById("price-1");

    expect(result).toEqual(mockPrice);
    expect(mockPrisma.cardPrice.findUnique).toHaveBeenCalledWith({
      where: { id: "price-1" },
      include: expect.objectContaining({
        tradeInItems: expect.objectContaining({
          take: 5,
        }),
      }),
    });
  });
});

describe("getUniqueGames", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return unique game names", async () => {
    mockPrisma.cardPrice.groupBy.mockResolvedValue([
      { setName: "pokemon" },
      { setName: "yugioh" },
      { setName: "mtg" },
    ]);

    const result = await getUniqueGames();

    expect(result).toEqual(["pokemon", "yugioh", "mtg"]);
  });
});

describe("previewSync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock settings
    mockPrisma.tradeInSettings.findUnique.mockResolvedValue({
      conditionMultiplierNM: 0.7,
      conditionMultiplierLP: 0.55,
      conditionMultiplierMP: 0.4,
      conditionMultiplierHP: 0.25,
      conditionMultiplierDMG: 0.1,
    });
  });

  it("should calculate preview stats", async () => {
    const externalPrices = [
      { cardId: "pokemon-001", name: "Card A", tradeinPriceGbp: new Decimal("10.00"), marketPriceGbp: null },
      { cardId: "pokemon-002", name: "Card B", tradeinPriceGbp: new Decimal("5.00"), marketPriceGbp: null },
      { cardId: "pokemon-003", name: "Card C", tradeinPriceGbp: new Decimal("0.00"), marketPriceGbp: null }, // Zero price - below minimum
    ];

    mockPrisma.externalCardPrice.findMany.mockResolvedValue(externalPrices);
    // Card A exists with matching cardName and setName (which comes from external.game or "Unknown")
    mockPrisma.cardPrice.findMany.mockResolvedValue([
      { cardName: "Card A", setName: "pokemon" },
    ]);

    const result = await previewSync("test-shop", {
      overwriteExisting: false,
      applyMultipliers: true,
      skipBelowMinimum: true,
    });

    // Total: 3 external prices
    // Card A: matches existing, counted as existing
    // Card B: new card, counted as new
    // Card C: 0p * 70% = 0p, below minimum (1p default), counted as belowMinimum
    expect(result.totalCards).toBe(3);
    expect(result.belowMinimum).toBe(1); // Card C below minimum
    // After skipping Card C, we have Card A (existing) and Card B (new)
    expect(result.existingCards).toBe(1); // Card A
    expect(result.newCards).toBe(1); // Card B
  });

  it("should count all as new when no existing prices", async () => {
    const externalPrices = [
      { cardId: "set-001", name: "Card A", tradeinPriceGbp: new Decimal("10.00"), marketPriceGbp: null },
      { cardId: "set-002", name: "Card B", tradeinPriceGbp: new Decimal("5.00"), marketPriceGbp: null },
    ];

    mockPrisma.externalCardPrice.findMany.mockResolvedValue(externalPrices);
    mockPrisma.cardPrice.findMany.mockResolvedValue([]);

    const result = await previewSync("test-shop", {
      overwriteExisting: false,
      applyMultipliers: true,
      skipBelowMinimum: false,
    });

    expect(result.newCards).toBe(2);
    expect(result.existingCards).toBe(0);
  });
});

describe("bulkUpdatePrices", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should update multiple prices", async () => {
    mockPrisma.cardPrice.updateMany.mockResolvedValue({ count: 5 });

    const result = await bulkUpdatePrices(
      ["id1", "id2", "id3", "id4", "id5"],
      { isActive: true }
    );

    expect(result.success).toBe(5);
    expect(result.failed).toBe(0);
  });

  it("should batch large updates", async () => {
    // Create 150 IDs
    const ids = Array.from({ length: 150 }, (_, i) => `id-${i}`);

    mockPrisma.cardPrice.updateMany.mockResolvedValue({ count: 100 });

    await bulkUpdatePrices(ids, { isActive: false });

    // Should be called twice: once for 100, once for 50
    expect(mockPrisma.cardPrice.updateMany).toHaveBeenCalledTimes(2);
  });

  it("should handle errors gracefully", async () => {
    mockPrisma.cardPrice.updateMany
      .mockResolvedValueOnce({ count: 50 })
      .mockRejectedValueOnce(new Error("DB error"));

    const ids = Array.from({ length: 150 }, (_, i) => `id-${i}`);
    const result = await bulkUpdatePrices(ids, { isActive: true });

    expect(result.success).toBe(50);
    expect(result.failed).toBe(50);
  });
});

describe("deletePrices", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should delete unused prices", async () => {
    mockPrisma.tradeInItem.count.mockResolvedValue(0);
    mockPrisma.cardPrice.delete.mockResolvedValue({});

    const result = await deletePrices(["id1", "id2"]);

    expect(result.success).toBe(2);
    expect(result.failed).toBe(0);
  });

  it("should skip prices in use", async () => {
    mockPrisma.tradeInItem.count
      .mockResolvedValueOnce(0) // First price not in use
      .mockResolvedValueOnce(5); // Second price in use

    mockPrisma.cardPrice.delete.mockResolvedValue({});

    const result = await deletePrices(["id1", "id2"]);

    expect(result.success).toBe(1);
    expect(result.failed).toBe(1);
    expect(mockPrisma.cardPrice.delete).toHaveBeenCalledTimes(1);
  });

  it("should handle delete errors", async () => {
    mockPrisma.tradeInItem.count.mockResolvedValue(0);
    mockPrisma.cardPrice.delete.mockRejectedValue(new Error("Delete failed"));

    const result = await deletePrices(["id1"]);

    expect(result.success).toBe(0);
    expect(result.failed).toBe(1);
  });
});

describe("createPrice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should create a new price", async () => {
    const priceData = {
      cardName: "Test Card",
      setName: "Test Set",
      priceNM: 1000,
      priceLP: 800,
      priceMP: 600,
      priceHP: 400,
      priceDMG: 200,
    };

    mockPrisma.cardPrice.create.mockResolvedValue({ id: "new-id", ...priceData });

    const result = await createPrice(priceData);

    expect(result.cardName).toBe("Test Card");
    expect(mockPrisma.cardPrice.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        cardName: "Test Card",
        isActive: true,
      }),
    });
  });

  it("should respect isActive parameter", async () => {
    const priceData = {
      cardName: "Test Card",
      setName: "Test Set",
      priceNM: 100,
      priceLP: 80,
      priceMP: 60,
      priceHP: 40,
      priceDMG: 20,
      isActive: false,
    };

    mockPrisma.cardPrice.create.mockResolvedValue({ id: "new-id", ...priceData });

    await createPrice(priceData);

    expect(mockPrisma.cardPrice.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        isActive: false,
      }),
    });
  });
});

describe("getPriceStats", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return price statistics", async () => {
    mockPrisma.cardPrice.count
      .mockResolvedValueOnce(1000) // total
      .mockResolvedValueOnce(850); // active

    mockPrisma.cardPrice.aggregate.mockResolvedValue({
      _avg: { priceNM: 2500 },
    });

    mockPrisma.cardPrice.groupBy.mockResolvedValue([
      { setName: "pokemon" },
      { setName: "yugioh" },
    ]);

    const result = await getPriceStats();

    expect(result.totalPrices).toBe(1000);
    expect(result.activePrices).toBe(850);
    expect(result.inactivePrices).toBe(150);
    expect(result.averageNMPrice).toBe(2500);
    expect(result.gamesCount).toBe(2);
  });

  it("should handle empty database", async () => {
    mockPrisma.cardPrice.count.mockResolvedValue(0);
    mockPrisma.cardPrice.aggregate.mockResolvedValue({
      _avg: { priceNM: null },
    });
    mockPrisma.cardPrice.groupBy.mockResolvedValue([]);

    const result = await getPriceStats();

    expect(result.totalPrices).toBe(0);
    expect(result.averageNMPrice).toBe(0);
    expect(result.gamesCount).toBe(0);
  });
});

describe("getExternalPriceCount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should count all external prices", async () => {
    mockPrisma.externalCardPrice.count.mockResolvedValue(5000);

    const result = await getExternalPriceCount();

    expect(result).toBe(5000);
    expect(mockPrisma.externalCardPrice.count).toHaveBeenCalledWith({
      where: {},
    });
  });

  it("should filter by game", async () => {
    mockPrisma.externalCardPrice.count.mockResolvedValue(1500);

    const result = await getExternalPriceCount("pokemon");

    expect(result).toBe(1500);
    expect(mockPrisma.externalCardPrice.count).toHaveBeenCalledWith({
      where: { game: { contains: "pokemon", mode: "insensitive" } },
    });
  });
});

describe("getExternalGames", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return unique game names from external prices", async () => {
    mockPrisma.externalCardPrice.groupBy.mockResolvedValue([
      { game: "pokemon" },
      { game: "yugioh" },
      { game: null },
    ]);

    const result = await getExternalGames();

    expect(result).toEqual(["pokemon", "yugioh"]);
  });
});
