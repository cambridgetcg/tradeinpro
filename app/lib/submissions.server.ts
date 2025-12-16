/**
 * Customer-facing submission management
 * Handles creation, validation, and status tracking of trade-in submissions
 */

import prisma from "../db.server";
import type { Prisma } from "@prisma/client";
import { Condition, formatPrice, PayoutType, type ConditionType, type PayoutTypeValue } from "./constants";
import { getOrCreateSettings, getMultiplierFromSettings } from "./settings.server";

// ============================================================================
// Types
// ============================================================================

export interface CreateItemInput {
  cardPriceId?: string;
  cardName: string;
  setName: string;
  setCode?: string;
  variant?: string;
  quantity: number;
  conditionClaimed: ConditionType;
}

export interface CreateSubmissionInput {
  shopifyCustomerId?: string;
  email: string;
  firstName?: string;
  lastName?: string;
  payoutType: PayoutTypeValue;
  items: CreateItemInput[];
  // Bank details (required when payoutType is BANK)
  bankAccountName?: string;
  bankSortCode?: string;
  bankAccountNumber?: string;
  // Contact preferences
  phone?: string;
  contactChannel?: string;
}

export interface SubmissionValidation {
  minimumValue: boolean;
  minimumRequired: number;
  currentTotal: number;
  withinItemLimit: boolean;
  maxItems: number;
  currentItems: number;
  invalidCards: string[];
  isValid: boolean;
  errors: string[];
}

export interface CardSearchParams {
  query: string;
  game?: string;
  limit?: number;
  minPrice?: number;
}

export interface CardSearchResult {
  id: string;
  cardName: string;
  setName: string;
  setCode: string | null;
  variant: string | null;
  rarity: string | null;
  prices: {
    NM: number;
    LP: number;
    MP: number;
    HP: number;
    DMG: number;
  };
}

export interface TimelineEvent {
  status: string;
  label: string;
  timestamp: string | null;
  isComplete: boolean;
  isCurrent: boolean;
}

export interface SubmissionStatusResponse {
  id: string;
  submissionNumber: string;
  status: string;
  statusLabel: string;
  statusDescription: string;
  timeline: TimelineEvent[];
  quotedTotal: number;
  finalTotal: number | null;
  bonusAmount: number;
  itemCount: number;
  verifiedCount: number;
  adjustedCount: number;
  rejectedCount: number;
  shippingMethod: string | null;
  trackingNumber: string | null;
  labelUrl: string | null;
  payoutType: string;
  payoutStatus: string | null;
  nextAction: {
    type: string;
    message: string;
    actionUrl?: string;
  } | null;
}

// ============================================================================
// Performance Optimization: Request-Scoped Cache
// ============================================================================

// Settings cache - cleared after each request
const settingsCache = new Map<string, Awaited<ReturnType<typeof getOrCreateSettings>>>();

export function getSettingsFromCache(shop: string) {
  return settingsCache.get(shop) || null;
}

export function setSettingsInCache(shop: string, settings: Awaited<ReturnType<typeof getOrCreateSettings>>) {
  settingsCache.set(shop, settings);
}

export function clearSettingsCache() {
  settingsCache.clear();
}

// Get settings with caching
export async function getCachedSettings(shop: string) {
  const cached = getSettingsFromCache(shop);
  if (cached) return cached;

  const settings = await getOrCreateSettings(shop);
  setSettingsInCache(shop, settings);
  return settings;
}

// ============================================================================
// Performance Optimization: Batch Card Lookups
// ============================================================================

/**
 * Batch lookup cards from CardPriceV2 - single query instead of N queries
 */
export async function batchLookupCardPricesV2(cardIds: string[]) {
  if (cardIds.length === 0) return new Map<string, Awaited<ReturnType<typeof prisma.cardPriceV2.findUnique>>>();

  const cards = await prisma.cardPriceV2.findMany({
    where: { cardId: { in: cardIds } }
  });

  return new Map(cards.map(c => [c.cardId, c]));
}

/**
 * Calculate price from pre-fetched card data (no DB query)
 */
export function calculatePriceFromCard(
  card: { bestPriceGbp: unknown },
  condition: ConditionType,
  settings: Awaited<ReturnType<typeof getOrCreateSettings>>
): number {
  if (!card.bestPriceGbp) return 0;

  const multiplier = getMultiplierFromSettings(settings, condition);
  const marketPricePence = Math.round(Number(card.bestPriceGbp) * 100);
  // Round down to nearest 10p
  return Math.floor(marketPricePence * multiplier / 10) * 10;
}

// ============================================================================
// Performance Optimization: Unified Validation + Preparation
// ============================================================================

export interface ValidatedItem {
  input: CreateItemInput;
  card: Awaited<ReturnType<typeof prisma.cardPriceV2.findUnique>> | null;
  price: number;
  marketPricePence: number; // Base market price for grading recalculations
  isValid: boolean;
  error?: string;
}

/**
 * Validate and prepare all items in a single pass with batch DB lookup
 * Replaces separate validateSubmission + per-item lookups in createSubmission
 */
export async function validateAndPrepareItems(
  items: CreateItemInput[],
  settings: Awaited<ReturnType<typeof getOrCreateSettings>>
): Promise<{ validatedItems: ValidatedItem[]; errors: string[]; totalValue: number; totalItems: number }> {
  // 1. Extract all cardPriceIds for batch lookup
  const cardIds = items
    .map(i => i.cardPriceId)
    .filter((id): id is string => !!id && id.trim().length > 0);

  console.log('[validateAndPrepareItems] Input items count:', items.length);
  console.log('[validateAndPrepareItems] cardIds to lookup:', JSON.stringify(cardIds));

  // 2. Single batch lookup (1 query instead of N)
  const cardsMap = await batchLookupCardPricesV2(cardIds);
  console.log('[validateAndPrepareItems] cardsMap size:', cardsMap.size);
  if (cardsMap.size > 0) {
    console.log('[validateAndPrepareItems] cardsMap keys:', JSON.stringify(Array.from(cardsMap.keys())));
  }

  // 3. Process all items without additional DB queries
  const validatedItems: ValidatedItem[] = [];
  const errors: string[] = [];
  const invalidCards: string[] = [];
  let totalValue = 0;
  let totalItems = 0;

  for (const item of items) {
    totalItems += item.quantity;

    // Look up card from pre-fetched map
    const card = item.cardPriceId ? cardsMap.get(item.cardPriceId) || null : null;

    // Debug: Show exactly what we're looking up
    console.log('[validateAndPrepareItems] Looking up:', {
      cardPriceId: item.cardPriceId,
      cardPriceIdType: typeof item.cardPriceId,
      cardPriceIdLength: item.cardPriceId?.length,
      found: !!card,
      cardName: item.cardName
    });

    if (!card) {
      validatedItems.push({
        input: item,
        card: null,
        price: 0,
        marketPricePence: 0,
        isValid: false,
        error: 'Card not found'
      });
      // Include the cardPriceId in the error for debugging
      const errorDetail = item.cardPriceId
        ? `${item.cardName} (ID: ${item.cardPriceId})`
        : `${item.cardName} (no ID provided)`;
      invalidCards.push(errorDetail);
      continue;
    }

    // Get market price and calculate condition price
    const marketPricePence = card.bestPriceGbp ? Math.round(Number(card.bestPriceGbp) * 100) : 0;
    const price = calculatePriceFromCard(card, item.conditionClaimed, settings);
    console.log('[validateAndPrepareItems] calculated price:', price, 'for condition:', item.conditionClaimed, 'market:', marketPricePence);
    totalValue += price * item.quantity;

    validatedItems.push({
      input: item,
      card,
      price,
      marketPricePence,
      isValid: true
    });
  }

  console.log('[validateAndPrepareItems] totalValue:', totalValue, 'minimumRequired:', settings.minimumSubmissionValue);

  // 4. Threshold validation
  if (totalValue < settings.minimumSubmissionValue) {
    errors.push(`Minimum submission value is ${formatPrice(settings.minimumSubmissionValue)}`);
  }

  if (totalItems > settings.maxItemsPerSubmission) {
    errors.push(`Maximum ${settings.maxItemsPerSubmission} items per submission`);
  }

  if (invalidCards.length > 0) {
    errors.push(`Cards not found or not accepting: ${invalidCards.join(", ")}`);
  }

  console.log('[validateAndPrepareItems] errors:', errors);

  return { validatedItems, errors, totalValue, totalItems };
}

// ============================================================================
// Settings Helper
// ============================================================================

interface SubmissionSettings {
  minimumSubmissionValue: number;
  maxItemsPerSubmission: number;
  autoApproveBelow: number;
  requiresApprovalAbove: number;
  storeCreditBonusPercent: number;
}

export async function getSubmissionSettings(): Promise<SubmissionSettings> {
  const settings = await prisma.tradeInSettings.findFirst();

  return {
    minimumSubmissionValue: settings?.minimumSubmissionValue ?? 500,
    maxItemsPerSubmission: settings?.maxItemsPerSubmission ?? 100,
    autoApproveBelow: settings?.autoApproveBelow ?? 2000,
    requiresApprovalAbove: settings?.requiresApprovalAbove ?? 5000,
    storeCreditBonusPercent: settings?.storeCreditBonusPercent ?? 10,
  };
}

// ============================================================================
// Submission Number Generation
// ============================================================================

/**
 * Generate unique submission number in format: TRD-YYYYMM-XXXXX
 */
export async function generateSubmissionNumber(): Promise<string> {
  const now = new Date();
  const yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  const prefix = `TRD-${yearMonth}`;

  // Get count for this month
  const count = await prisma.tradeInSubmission.count({
    where: {
      submissionNumber: {
        startsWith: prefix,
      },
    },
  });

  const sequence = String(count + 1).padStart(5, "0");
  return `${prefix}-${sequence}`;
}

// ============================================================================
// Customer Management
// ============================================================================

/**
 * Find or create a customer by Shopify ID or email
 */
export async function getOrCreateCustomer(params: {
  shopifyCustomerId?: string;
  email: string;
  firstName?: string;
  lastName?: string;
}) {
  const { shopifyCustomerId, email, firstName, lastName } = params;
  const normalizedEmail = email.toLowerCase().trim();

  // Try to find by Shopify ID first
  if (shopifyCustomerId) {
    const existing = await prisma.customer.findUnique({
      where: { shopifyCustomerId },
    });

    if (existing) {
      return existing;
    }
  }

  // Try to find by email
  const existingByEmail = await prisma.customer.findFirst({
    where: { email: normalizedEmail },
  });

  if (existingByEmail) {
    // Update Shopify ID if we now have one
    if (shopifyCustomerId && !existingByEmail.shopifyCustomerId) {
      return prisma.customer.update({
        where: { id: existingByEmail.id },
        data: { shopifyCustomerId },
      });
    }
    return existingByEmail;
  }

  // Create new customer
  return prisma.customer.create({
    data: {
      shopifyCustomerId,
      email: normalizedEmail,
      firstName,
      lastName,
    },
  });
}

// ============================================================================
// Price Lookup
// ============================================================================

/**
 * Get price for a card based on condition (legacy CardPrice table)
 */
export function getConditionPrice(
  cardPrice: {
    priceNM: number;
    priceLP: number;
    priceMP: number;
    priceHP: number;
    priceDMG: number;
  },
  condition: ConditionType
): number {
  switch (condition) {
    case Condition.NM:
      return cardPrice.priceNM;
    case Condition.LP:
      return cardPrice.priceLP;
    case Condition.MP:
      return cardPrice.priceMP;
    case Condition.HP:
      return cardPrice.priceHP;
    case Condition.DMG:
      return cardPrice.priceDMG;
    default:
      return cardPrice.priceNM;
  }
}

/**
 * Find card price by name and set (legacy CardPrice table)
 */
export async function findCardPriceByName(
  cardName: string,
  setName: string,
  variant?: string
) {
  return prisma.cardPrice.findFirst({
    where: {
      cardName: { equals: cardName, mode: "insensitive" },
      setName: { equals: setName, mode: "insensitive" },
      ...(variant && { variant }),
      isActive: true,
    },
  });
}

/**
 * Find card from CardPriceV2 by cardId
 * This is the primary lookup for cards from search/browse APIs
 */
export async function findCardPriceV2ById(cardId: string) {
  return prisma.cardPriceV2.findUnique({
    where: { cardId },
  });
}

/**
 * Calculate trade-in price for a card from CardPriceV2 based on condition
 * Uses the market price (bestPriceGbp) and applies condition multipliers
 * Returns price in pence
 */
export async function calculateCardPriceV2(
  cardId: string,
  condition: ConditionType,
  shop: string
): Promise<{ price: number; card: Awaited<ReturnType<typeof findCardPriceV2ById>> } | null> {
  const card = await findCardPriceV2ById(cardId);
  if (!card || !card.bestPriceGbp) {
    return null;
  }

  const settings = await getOrCreateSettings(shop);
  const multiplier = getMultiplierFromSettings(settings, condition);

  // Convert GBP to pence and apply condition multiplier
  // Round down to nearest 10p
  const marketPricePence = Math.round(Number(card.bestPriceGbp) * 100);
  const price = Math.floor(marketPricePence * multiplier / 10) * 10;

  return { price, card };
}

// ============================================================================
// Submission Validation
// ============================================================================

/**
 * Validate a submission before creation
 * Now uses CardPriceV2 for card lookup (primary) with CardPrice as fallback
 */
export async function validateSubmission(
  items: CreateItemInput[],
  settings?: SubmissionSettings,
  shop?: string
): Promise<SubmissionValidation> {
  const actualSettings = settings || (await getSubmissionSettings());
  const shopId = shop || "default";
  const errors: string[] = [];
  const invalidCards: string[] = [];
  let totalValue = 0;
  let totalItems = 0;

  for (const item of items) {
    totalItems += item.quantity;

    // Try CardPriceV2 first (primary source for search/browse APIs)
    if (item.cardPriceId) {
      const result = await calculateCardPriceV2(
        item.cardPriceId,
        item.conditionClaimed,
        shopId
      );

      if (result) {
        totalValue += result.price * item.quantity;
        continue;
      }
    }

    // Fallback to legacy CardPrice table
    let cardPrice;
    if (item.cardPriceId) {
      cardPrice = await prisma.cardPrice.findUnique({
        where: { id: item.cardPriceId },
      });
    }

    // Try by name if not found by ID
    if (!cardPrice) {
      cardPrice = await findCardPriceByName(
        item.cardName,
        item.setName,
        item.variant
      );
    }

    if (!cardPrice || !cardPrice.isActive) {
      invalidCards.push(item.cardName);
      continue;
    }

    // Calculate price based on claimed condition
    const price = getConditionPrice(cardPrice, item.conditionClaimed);
    totalValue += price * item.quantity;
  }

  // Validate minimums
  if (totalValue < actualSettings.minimumSubmissionValue) {
    errors.push(
      `Minimum submission value is ${formatPrice(actualSettings.minimumSubmissionValue)}`
    );
  }

  // Validate item count
  if (totalItems > actualSettings.maxItemsPerSubmission) {
    errors.push(
      `Maximum ${actualSettings.maxItemsPerSubmission} items per submission`
    );
  }

  // Validate all cards found
  if (invalidCards.length > 0) {
    errors.push(
      `Cards not found or not accepting: ${invalidCards.join(", ")}`
    );
  }

  return {
    minimumValue: totalValue >= actualSettings.minimumSubmissionValue,
    minimumRequired: actualSettings.minimumSubmissionValue,
    currentTotal: totalValue,
    withinItemLimit: totalItems <= actualSettings.maxItemsPerSubmission,
    maxItems: actualSettings.maxItemsPerSubmission,
    currentItems: totalItems,
    invalidCards,
    isValid: errors.length === 0,
    errors,
  };
}

// ============================================================================
// Submission CRUD
// ============================================================================

/**
 * Create a new trade-in submission (OPTIMIZED)
 *
 * Performance improvements:
 * - Parallel settings + customer fetch
 * - Single batch card lookup via validateAndPrepareItems
 * - No additional DB queries when creating items (uses pre-calculated prices)
 * - Settings cached for request duration
 *
 * Before: 40-60 DB queries for 10 items
 * After: 6-8 DB queries for any number of items
 */
export async function createSubmission(input: CreateSubmissionInput, shop?: string) {
  const shopId = shop || "default";

  // 1. PARALLEL FETCH: Settings + Customer (2 queries instead of sequential)
  const [settings, customer] = await Promise.all([
    getCachedSettings(shopId),
    getOrCreateCustomer({
      shopifyCustomerId: input.shopifyCustomerId,
      email: input.email,
      firstName: input.firstName,
      lastName: input.lastName,
    })
  ]);

  // 2. SINGLE-PASS VALIDATION + PRICE CALCULATION (1 batch query for all cards)
  const { validatedItems, errors, totalValue } = await validateAndPrepareItems(
    input.items,
    settings
  );

  if (errors.length > 0) {
    clearSettingsCache();
    return { success: false, errors };
  }

  // 3. Generate submission number (1 query)
  const submissionNumber = await generateSubmissionNumber();

  // 4. Calculate bonus (in-memory, no DB)
  const bonusAmount = input.payoutType === PayoutType.STORE_CREDIT
    ? Math.floor(totalValue * (settings.storeCreditBonusPercent / 100))
    : 0;

  // 5. Create submission with PRE-CALCULATED items (1 transaction, no additional lookups)
  // NOTE: cardPriceId is set to null because we're using CardPriceV2 for lookups,
  // and the TradeInItem.cardPriceId FK references the legacy CardPrice table.
  // Card details are denormalized in the item record anyway.
  const submission = await prisma.tradeInSubmission.create({
    data: {
      submissionNumber,
      customerId: customer.id,
      status: "DRAFT",
      payoutType: input.payoutType,
      quotedTotal: totalValue,
      bonusAmount,
      // Bank details (only stored when payoutType is BANK)
      ...(input.payoutType === PayoutType.BANK && {
        bankAccountName: input.bankAccountName,
        bankSortCode: input.bankSortCode,
        bankAccountNumber: input.bankAccountNumber,
      }),
      // Contact preferences
      phone: input.phone || null,
      contactChannel: input.contactChannel || null,
      items: {
        create: validatedItems
          .filter(vi => vi.isValid)
          .map(vi => ({
            cardPriceId: null, // CardPriceV2 IDs are incompatible with CardPrice FK
            cardName: vi.input.cardName,
            setName: vi.input.setName,
            setCode: vi.input.setCode || null,
            variant: vi.input.variant || null,
            quantity: vi.input.quantity,
            conditionClaimed: vi.input.conditionClaimed,
            marketPricePence: vi.marketPricePence, // Store for grading recalculations
            quotedPrice: vi.price * vi.input.quantity,
            status: "PENDING",
          })),
      },
    },
    include: {
      items: true,
      customer: true,
    },
  });

  // 6. Clear cache after request completes
  clearSettingsCache();

  return { success: true, submission };
}

/**
 * Get submission by ID with full details
 */
export async function getSubmissionById(id: string) {
  return prisma.tradeInSubmission.findUnique({
    where: { id },
    include: {
      items: {
        include: {
          cardPrice: true,
        },
      },
      customer: true,
      notes: {
        where: { isInternal: false },
        orderBy: { createdAt: "desc" },
      },
      payout: true,
    },
  });
}

/**
 * Get submission by submission number
 */
export async function getSubmissionByNumber(submissionNumber: string) {
  return prisma.tradeInSubmission.findUnique({
    where: { submissionNumber },
    include: {
      items: {
        include: {
          cardPrice: true,
        },
      },
      customer: true,
      notes: {
        where: { isInternal: false },
        orderBy: { createdAt: "desc" },
      },
      payout: true,
    },
  });
}

/**
 * Get submissions for a customer
 */
export async function getCustomerSubmissions(
  customerId: string,
  options?: {
    status?: string;
    limit?: number;
    offset?: number;
  }
) {
  const where: Prisma.TradeInSubmissionWhereInput = {
    customerId,
    ...(options?.status && { status: options.status }),
  };

  const [submissions, total] = await Promise.all([
    prisma.tradeInSubmission.findMany({
      where,
      include: {
        items: true,
        payout: true,
      },
      orderBy: { createdAt: "desc" },
      take: options?.limit ?? 20,
      skip: options?.offset ?? 0,
    }),
    prisma.tradeInSubmission.count({ where }),
  ]);

  return { submissions, total };
}

// ============================================================================
// Submission Actions
// ============================================================================

/**
 * Submit a draft submission for processing
 */
export async function submitSubmission(submissionId: string) {
  const submission = await prisma.tradeInSubmission.findUnique({
    where: { id: submissionId },
    include: { items: true },
  });

  if (!submission) {
    throw new Error("Submission not found");
  }

  if (submission.status !== "DRAFT") {
    throw new Error("Only draft submissions can be submitted");
  }

  if (submission.items.length === 0) {
    throw new Error("Submission must have at least one item");
  }

  return prisma.tradeInSubmission.update({
    where: { id: submissionId },
    data: {
      status: "SUBMITTED",
      submittedAt: new Date(),
    },
    include: { items: true, customer: true },
  });
}

/**
 * Customer confirms adjusted submission (approves grading results)
 */
export async function confirmSubmission(
  submissionId: string,
  customerId: string
) {
  const submission = await prisma.tradeInSubmission.findUnique({
    where: { id: submissionId },
    include: { customer: true },
  });

  if (!submission) {
    throw new Error("Submission not found");
  }

  if (submission.customerId !== customerId) {
    throw new Error("Not authorized to confirm this submission");
  }

  if (submission.status !== "PENDING_APPROVAL") {
    throw new Error("Submission is not pending approval");
  }

  return prisma.tradeInSubmission.update({
    where: { id: submissionId },
    data: {
      status: "APPROVED",
      approvedAt: new Date(),
    },
  });
}

/**
 * Customer rejects grading and requests return
 */
export async function rejectSubmission(
  submissionId: string,
  customerId: string,
  reason: string
) {
  const submission = await prisma.tradeInSubmission.findUnique({
    where: { id: submissionId },
  });

  if (!submission) {
    throw new Error("Submission not found");
  }

  if (submission.customerId !== customerId) {
    throw new Error("Not authorized to reject this submission");
  }

  if (submission.status !== "PENDING_APPROVAL") {
    throw new Error("Submission is not pending approval");
  }

  // Update status and add note
  const [updated] = await prisma.$transaction([
    prisma.tradeInSubmission.update({
      where: { id: submissionId },
      data: { status: "RETURNED" },
    }),
    prisma.submissionNote.create({
      data: {
        submissionId,
        authorType: "CUSTOMER",
        message: `Rejected grading and requested return. Reason: ${reason}`,
      },
    }),
  ]);

  return updated;
}

/**
 * Add item to draft submission
 * Now uses CardPriceV2 for card lookup (primary) with CardPrice as fallback
 */
export async function addItemToSubmission(
  submissionId: string,
  item: CreateItemInput,
  shop?: string
) {
  const submission = await prisma.tradeInSubmission.findUnique({
    where: { id: submissionId },
    include: { items: true },
  });

  if (!submission) {
    throw new Error("Submission not found");
  }

  if (submission.status !== "DRAFT") {
    throw new Error("Can only add items to draft submissions");
  }

  const shopId = shop || "default";
  let price = 0;
  let cardPriceId: string | null = null;

  // Try CardPriceV2 first (primary source for search/browse APIs)
  if (item.cardPriceId) {
    const result = await calculateCardPriceV2(
      item.cardPriceId,
      item.conditionClaimed,
      shopId
    );

    if (result) {
      price = result.price;
      cardPriceId = item.cardPriceId;
    }
  }

  // Fallback to legacy CardPrice table if not found in V2
  if (price === 0) {
    let cardPrice;
    if (item.cardPriceId) {
      cardPrice = await prisma.cardPrice.findUnique({
        where: { id: item.cardPriceId },
      });
    }

    if (!cardPrice) {
      cardPrice = await findCardPriceByName(item.cardName, item.setName, item.variant);
    }

    if (!cardPrice || !cardPrice.isActive) {
      throw new Error("Card not found or not accepting trade-ins");
    }

    price = getConditionPrice(cardPrice, item.conditionClaimed);
    cardPriceId = cardPrice.id;
  }

  const itemTotal = price * item.quantity;

  // Create item and update submission total
  const [newItem] = await prisma.$transaction([
    prisma.tradeInItem.create({
      data: {
        submissionId,
        cardPriceId,
        cardName: item.cardName,
        setName: item.setName,
        setCode: item.setCode,
        variant: item.variant,
        quantity: item.quantity,
        conditionClaimed: item.conditionClaimed,
        quotedPrice: itemTotal,
        status: "PENDING",
      },
    }),
    prisma.tradeInSubmission.update({
      where: { id: submissionId },
      data: {
        quotedTotal: { increment: itemTotal },
      },
    }),
  ]);

  return newItem;
}

/**
 * Remove item from draft submission
 */
export async function removeItemFromSubmission(
  submissionId: string,
  itemId: string
) {
  const submission = await prisma.tradeInSubmission.findUnique({
    where: { id: submissionId },
  });

  if (!submission) {
    throw new Error("Submission not found");
  }

  if (submission.status !== "DRAFT") {
    throw new Error("Can only remove items from draft submissions");
  }

  const item = await prisma.tradeInItem.findUnique({
    where: { id: itemId },
  });

  if (!item || item.submissionId !== submissionId) {
    throw new Error("Item not found in this submission");
  }

  // Delete item and update submission total
  await prisma.$transaction([
    prisma.tradeInItem.delete({
      where: { id: itemId },
    }),
    prisma.tradeInSubmission.update({
      where: { id: submissionId },
      data: {
        quotedTotal: { decrement: item.quotedPrice },
      },
    }),
  ]);

  return { success: true };
}

// ============================================================================
// Card Search
// ============================================================================

/**
 * Search card catalog for autocomplete
 */
export async function searchCards(
  params: CardSearchParams
): Promise<CardSearchResult[]> {
  const { query, game, limit = 20, minPrice } = params;

  if (!query || query.length < 2) {
    return [];
  }

  const results = await prisma.cardPrice.findMany({
    where: {
      isActive: true,
      OR: [
        { cardName: { contains: query, mode: "insensitive" } },
        { setName: { contains: query, mode: "insensitive" } },
        { setCode: { contains: query, mode: "insensitive" } },
      ],
      ...(game && { setName: { contains: game, mode: "insensitive" } }),
      ...(minPrice && { priceNM: { gte: minPrice } }),
    },
    take: limit,
    orderBy: [{ priceNM: "desc" }, { cardName: "asc" }],
  });

  return results.map((card) => ({
    id: card.id,
    cardName: card.cardName,
    setName: card.setName,
    setCode: card.setCode,
    variant: card.variant,
    rarity: card.rarity,
    prices: {
      NM: card.priceNM,
      LP: card.priceLP,
      MP: card.priceMP,
      HP: card.priceHP,
      DMG: card.priceDMG,
    },
  }));
}

// ============================================================================
// Status & Timeline
// ============================================================================

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  SUBMITTED: "Submitted",
  IN_TRANSIT: "In Transit",
  RECEIVED: "Received",
  GRADING: "Grading",
  PENDING_APPROVAL: "Pending Approval",
  APPROVED: "Approved",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  RETURNED: "Returned",
};

const STATUS_DESCRIPTIONS: Record<string, string> = {
  DRAFT: "Your submission is being prepared. Add cards and submit when ready.",
  SUBMITTED: "Your submission has been received. Please ship your cards.",
  IN_TRANSIT: "Your package is on its way to us.",
  RECEIVED: "We've received your package and will begin grading soon.",
  GRADING: "Our team is grading your cards.",
  PENDING_APPROVAL: "Grading complete. Please review and approve the results.",
  APPROVED: "Your submission has been approved. Payout is being processed.",
  COMPLETED: "Your payout has been issued. Thank you for trading with us!",
  CANCELLED: "This submission has been cancelled.",
  RETURNED: "Your cards are being returned to you.",
};

const STATUS_ORDER = [
  "DRAFT",
  "SUBMITTED",
  "IN_TRANSIT",
  "RECEIVED",
  "GRADING",
  "PENDING_APPROVAL",
  "APPROVED",
  "COMPLETED",
];

/**
 * Get formatted submission status with timeline
 */
export async function getSubmissionStatus(
  submissionId: string
): Promise<SubmissionStatusResponse | null> {
  const submission = await prisma.tradeInSubmission.findUnique({
    where: { id: submissionId },
    include: {
      items: true,
      payout: true,
    },
  });

  if (!submission) {
    return null;
  }

  // Build timeline
  const currentIndex = STATUS_ORDER.indexOf(submission.status);
  const timeline: TimelineEvent[] = STATUS_ORDER.map((status, index) => {
    let timestamp: string | null = null;

    // Get timestamp for completed statuses
    if (status === "SUBMITTED" && submission.submittedAt) {
      timestamp = submission.submittedAt.toISOString();
    } else if (status === "RECEIVED" && submission.receivedAt) {
      timestamp = submission.receivedAt.toISOString();
    } else if (status === "GRADING" && submission.gradedAt) {
      timestamp = submission.gradedAt.toISOString();
    } else if (status === "APPROVED" && submission.approvedAt) {
      timestamp = submission.approvedAt.toISOString();
    } else if (status === "COMPLETED" && submission.completedAt) {
      timestamp = submission.completedAt.toISOString();
    }

    return {
      status,
      label: STATUS_LABELS[status],
      timestamp,
      isComplete: index < currentIndex,
      isCurrent: index === currentIndex,
    };
  });

  // Count item statuses
  const itemCounts = submission.items.reduce(
    (acc, item) => {
      if (item.status === "VERIFIED") acc.verified++;
      else if (item.status === "ADJUSTED") acc.adjusted++;
      else if (item.status === "REJECTED") acc.rejected++;
      return acc;
    },
    { verified: 0, adjusted: 0, rejected: 0 }
  );

  // Determine next action
  let nextAction: SubmissionStatusResponse["nextAction"] = null;
  switch (submission.status) {
    case "DRAFT":
      nextAction = {
        type: "SUBMIT",
        message: "Review your items and submit when ready.",
      };
      break;
    case "SUBMITTED":
      nextAction = {
        type: "SHIP_CARDS",
        message: "Ship your cards using the provided label or self-ship instructions.",
      };
      break;
    case "IN_TRANSIT":
    case "RECEIVED":
    case "GRADING":
      nextAction = {
        type: "AWAIT_GRADING",
        message: "Please wait while we grade your cards.",
      };
      break;
    case "PENDING_APPROVAL":
      nextAction = {
        type: "REVIEW_CHANGES",
        message: "Please review the grading results and approve or request return.",
      };
      break;
    case "APPROVED":
      nextAction = {
        type: "AWAIT_PAYOUT",
        message: "Your payout is being processed.",
      };
      break;
    case "COMPLETED":
      nextAction = {
        type: "COMPLETE",
        message: "Your trade-in is complete. Thank you!",
      };
      break;
  }

  return {
    id: submission.id,
    submissionNumber: submission.submissionNumber,
    status: submission.status,
    statusLabel: STATUS_LABELS[submission.status] || submission.status,
    statusDescription:
      STATUS_DESCRIPTIONS[submission.status] || "Unknown status",
    timeline,
    quotedTotal: submission.quotedTotal,
    finalTotal: submission.finalTotal,
    bonusAmount: submission.bonusAmount,
    itemCount: submission.items.length,
    verifiedCount: itemCounts.verified,
    adjustedCount: itemCounts.adjusted,
    rejectedCount: itemCounts.rejected,
    shippingMethod: submission.shippingMethod,
    trackingNumber: submission.trackingNumber,
    labelUrl: submission.labelUrl,
    payoutType: submission.payoutType,
    payoutStatus: submission.payout?.status || null,
    nextAction,
  };
}
