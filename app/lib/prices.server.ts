/**
 * Price Management for Trade-In System
 * Handles price search, sync from external sources, and bulk operations
 */

import prisma from "../db.server";
import type { Prisma } from "@prisma/client";
import { poundsToPence, toNumber } from "./pricing.server";
import { getOrCreateSettings } from "./settings.server";
import { PriceConstants } from "./constants";

// ============================================================================
// TYPES
// ============================================================================

export interface PriceSearchParams {
  search?: string;
  game?: string;
  minPrice?: number;
  maxPrice?: number;
  isActive?: boolean;
  hasExternalPrice?: boolean;
  sort?: "name" | "price-asc" | "price-desc" | "updated";
  page?: number;
  limit?: number;
}

export interface PriceSearchResult {
  prices: Awaited<ReturnType<typeof prisma.cardPrice.findMany>>;
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface PriceSyncOptions {
  game?: string;
  overwriteExisting: boolean;
  applyMultipliers: boolean;
  skipBelowMinimum: boolean;
  minimumPrice?: number;
}

export interface SyncResult {
  created: number;
  updated: number;
  skipped: number;
  errors: Array<{ card: string; error: string }>;
  totalProcessed: number;
}

export interface SyncPreview {
  totalCards: number;
  newCards: number;
  existingCards: number;
  belowMinimum: number;
}

export interface BulkUpdateResult {
  success: number;
  failed: number;
}

// ============================================================================
// SEARCH & FILTER
// ============================================================================

/**
 * Search and filter prices with pagination
 */
export async function searchPrices(
  params: PriceSearchParams
): Promise<PriceSearchResult> {
  const page = Math.max(1, params.page || 1);
  const limit = Math.min(100, Math.max(1, params.limit || 20));
  const skip = (page - 1) * limit;

  const where: Prisma.CardPriceWhereInput = {};

  // Text search
  if (params.search && params.search.trim()) {
    const searchTerm = params.search.trim();
    where.OR = [
      { cardName: { contains: searchTerm, mode: "insensitive" } },
      { setName: { contains: searchTerm, mode: "insensitive" } },
      { setCode: { contains: searchTerm, mode: "insensitive" } },
    ];
  }

  // Game filter (setName is used as game identifier)
  if (params.game && params.game !== "all") {
    where.setName = { contains: params.game, mode: "insensitive" };
  }

  // Active status
  if (params.isActive !== undefined) {
    where.isActive = params.isActive;
  }

  // Price range (NM price)
  if (params.minPrice !== undefined || params.maxPrice !== undefined) {
    where.priceNM = {};
    if (params.minPrice !== undefined) {
      where.priceNM.gte = params.minPrice;
    }
    if (params.maxPrice !== undefined) {
      where.priceNM.lte = params.maxPrice;
    }
  }

  // Determine sort order
  let orderBy: Prisma.CardPriceOrderByWithRelationInput;
  switch (params.sort) {
    case "price-asc":
      orderBy = { priceNM: "asc" };
      break;
    case "price-desc":
      orderBy = { priceNM: "desc" };
      break;
    case "updated":
      orderBy = { updatedAt: "desc" };
      break;
    case "name":
    default:
      orderBy = { cardName: "asc" };
      break;
  }

  // Execute queries in parallel
  const [prices, total] = await Promise.all([
    prisma.cardPrice.findMany({
      where,
      orderBy,
      skip,
      take: limit,
    }),
    prisma.cardPrice.count({ where }),
  ]);

  return {
    prices,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

/**
 * Get a single price by ID
 */
export async function getPriceById(id: string) {
  return prisma.cardPrice.findUnique({
    where: { id },
    include: {
      tradeInItems: {
        take: 5,
        orderBy: { createdAt: "desc" },
        include: {
          submission: {
            select: {
              submissionNumber: true,
              status: true,
            },
          },
        },
      },
    },
  });
}

/**
 * Get unique games/sets for filter dropdown
 */
export async function getUniqueGames(): Promise<string[]> {
  const results = await prisma.cardPrice.groupBy({
    by: ["setName"],
    orderBy: {
      setName: "asc",
    },
  });

  return results.map((r) => r.setName);
}

// ============================================================================
// PRICE SYNC FROM EXTERNAL
// ============================================================================

/**
 * Preview sync results before executing
 */
export async function previewSync(
  shop: string,
  options: PriceSyncOptions
): Promise<SyncPreview> {
  const settings = await getOrCreateSettings(shop);
  const minimumPrice = options.minimumPrice ?? PriceConstants.MIN_TRADEABLE_PRICE;

  // Build where clause for external prices
  const where: Prisma.ExternalCardPriceWhereInput = {};
  if (options.game) {
    where.game = { contains: options.game, mode: "insensitive" };
  }

  // Count external prices
  const externalPrices = await prisma.externalCardPrice.findMany({
    where,
    select: {
      cardId: true,
      name: true,
      tradeinPriceGbp: true,
      marketPriceGbp: true,
    },
  });

  // Check which already exist
  const existingNames = new Set(
    (
      await prisma.cardPrice.findMany({
        where: options.game
          ? { setName: { contains: options.game, mode: "insensitive" } }
          : {},
        select: { cardName: true, setName: true },
      })
    ).map((p) => `${p.cardName}|${p.setName}`)
  );

  let newCards = 0;
  let existingCards = 0;
  let belowMinimum = 0;

  for (const ext of externalPrices) {
    const basePrice = toNumber(ext.tradeinPriceGbp ?? ext.marketPriceGbp ?? 0);
    const basePence = poundsToPence(basePrice);
    const nmPrice = options.applyMultipliers
      ? Math.floor(basePence * settings.conditionMultiplierNM)
      : basePence;

    if (options.skipBelowMinimum && nmPrice < minimumPrice) {
      belowMinimum++;
      continue;
    }

    const key = `${ext.name}|${ext.cardId.split("-")[0] || "unknown"}`;
    if (existingNames.has(key)) {
      existingCards++;
    } else {
      newCards++;
    }
  }

  return {
    totalCards: externalPrices.length,
    newCards,
    existingCards,
    belowMinimum,
  };
}

/**
 * Sync prices from ExternalCardPrice table
 */
export async function syncPricesFromExternal(
  shop: string,
  options: PriceSyncOptions,
  onProgress?: (progress: number, message: string) => void
): Promise<SyncResult> {
  const settings = await getOrCreateSettings(shop);
  const minimumPrice = options.minimumPrice ?? PriceConstants.MIN_TRADEABLE_PRICE;

  // Build where clause for external prices
  const where: Prisma.ExternalCardPriceWhereInput = {};
  if (options.game) {
    where.game = { contains: options.game, mode: "insensitive" };
  }

  const externalPrices = await prisma.externalCardPrice.findMany({
    where,
  });

  const results: SyncResult = {
    created: 0,
    updated: 0,
    skipped: 0,
    errors: [],
    totalProcessed: 0,
  };

  const BATCH_SIZE = 50;
  const total = externalPrices.length;

  for (let i = 0; i < total; i += BATCH_SIZE) {
    const batch = externalPrices.slice(i, i + BATCH_SIZE);

    for (const external of batch) {
      try {
        // Calculate base price
        const basePrice = toNumber(
          external.tradeinPriceGbp ?? external.marketPriceGbp ?? 0
        );
        const basePence = poundsToPence(basePrice);

        // Apply multipliers if requested
        let priceNM: number, priceLP: number, priceMP: number, priceHP: number, priceDMG: number;

        if (options.applyMultipliers) {
          priceNM = Math.floor(basePence * settings.conditionMultiplierNM);
          priceLP = Math.floor(basePence * settings.conditionMultiplierLP);
          priceMP = Math.floor(basePence * settings.conditionMultiplierMP);
          priceHP = Math.floor(basePence * settings.conditionMultiplierHP);
          priceDMG = Math.floor(basePence * settings.conditionMultiplierDMG);
        } else {
          priceNM = basePence;
          priceLP = basePence;
          priceMP = basePence;
          priceHP = basePence;
          priceDMG = basePence;
        }

        // Skip if below minimum
        if (options.skipBelowMinimum && priceNM < minimumPrice) {
          results.skipped++;
          continue;
        }

        // Extract set info from card_id (format: "set-number" or similar)
        const setName = external.game || "Unknown";
        const setCode = external.cardId.split("-")[0] || null;

        const priceData = {
          cardName: external.name,
          setName,
          setCode,
          rarity: external.rarity,
          variant: external.variantType,
          priceNM,
          priceLP,
          priceMP,
          priceHP,
          priceDMG,
          isActive: priceNM >= minimumPrice,
        };

        // Check if exists
        const existing = await prisma.cardPrice.findFirst({
          where: {
            cardName: external.name,
            setName,
          },
        });

        if (existing) {
          if (options.overwriteExisting) {
            await prisma.cardPrice.update({
              where: { id: existing.id },
              data: priceData,
            });
            results.updated++;
          } else {
            results.skipped++;
          }
        } else {
          await prisma.cardPrice.create({
            data: priceData,
          });
          results.created++;
        }

        results.totalProcessed++;
      } catch (error) {
        results.errors.push({
          card: external.name,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    // Report progress
    const progress = Math.min(100, Math.round(((i + batch.length) / total) * 100));
    onProgress?.(progress, `Processed ${i + batch.length} of ${total} cards`);
  }

  return results;
}

// ============================================================================
// CRUD OPERATIONS
// ============================================================================

/**
 * Update a single price
 */
export async function updatePrice(
  id: string,
  data: {
    priceNM?: number;
    priceLP?: number;
    priceMP?: number;
    priceHP?: number;
    priceDMG?: number;
    isActive?: boolean;
  }
) {
  return prisma.cardPrice.update({
    where: { id },
    data,
  });
}

/**
 * Bulk update prices (set active/inactive)
 */
export async function bulkUpdatePrices(
  ids: string[],
  update: { isActive?: boolean }
): Promise<BulkUpdateResult> {
  const BATCH_SIZE = 100;
  let success = 0;
  let failed = 0;

  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batch = ids.slice(i, i + BATCH_SIZE);

    try {
      const result = await prisma.cardPrice.updateMany({
        where: { id: { in: batch } },
        data: update,
      });
      success += result.count;
    } catch {
      failed += batch.length;
    }
  }

  return { success, failed };
}

/**
 * Delete prices (only if not used in any submissions)
 */
export async function deletePrices(ids: string[]): Promise<BulkUpdateResult> {
  let success = 0;
  let failed = 0;

  for (const id of ids) {
    try {
      // Check if used in any trade-in items
      const usageCount = await prisma.tradeInItem.count({
        where: { cardPriceId: id },
      });

      if (usageCount > 0) {
        failed++;
        continue;
      }

      await prisma.cardPrice.delete({
        where: { id },
      });
      success++;
    } catch {
      failed++;
    }
  }

  return { success, failed };
}

/**
 * Create a new price manually
 */
export async function createPrice(data: {
  cardName: string;
  setName: string;
  setCode?: string;
  rarity?: string;
  variant?: string;
  priceNM: number;
  priceLP: number;
  priceMP: number;
  priceHP: number;
  priceDMG: number;
  isActive?: boolean;
}) {
  return prisma.cardPrice.create({
    data: {
      ...data,
      isActive: data.isActive ?? true,
    },
  });
}

// ============================================================================
// STATISTICS
// ============================================================================

/**
 * Get price statistics
 */
export async function getPriceStats() {
  const [totalPrices, activePrices, avgPrice, games] = await Promise.all([
    prisma.cardPrice.count(),
    prisma.cardPrice.count({ where: { isActive: true } }),
    prisma.cardPrice.aggregate({
      _avg: { priceNM: true },
      where: { isActive: true },
    }),
    prisma.cardPrice.groupBy({
      by: ["setName"],
      _count: true,
    }),
  ]);

  return {
    totalPrices,
    activePrices,
    inactivePrices: totalPrices - activePrices,
    averageNMPrice: avgPrice._avg.priceNM ?? 0,
    gamesCount: games.length,
  };
}

/**
 * Get external price count for sync preview
 */
export async function getExternalPriceCount(game?: string): Promise<number> {
  const where: Prisma.ExternalCardPriceWhereInput = {};
  if (game) {
    where.game = { contains: game, mode: "insensitive" };
  }

  return prisma.externalCardPrice.count({ where });
}

/**
 * Get unique games from external prices
 */
export async function getExternalGames(): Promise<string[]> {
  const results = await prisma.externalCardPrice.groupBy({
    by: ["game"],
    orderBy: {
      game: "asc",
    },
  });

  return results.map((r) => r.game).filter(Boolean);
}
