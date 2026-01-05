/**
 * Customer-facing submission management
 * Handles creation, validation, and status tracking of trade-in submissions
 *
 * @synapse CODE_SYNAPSE.md - See ./CODE_SYNAPSE.md for full module dependency graph
 *
 * IMPORTS FROM:
 *   - ./constants.ts (status enums, formatPrice)
 *   - ./settings.server.ts (condition multipliers, thresholds)
 *   - ./prisma-errors.ts (retry logic)
 *
 * IMPORTED BY:
 *   - ../routes/api.submissions.tsx (createSubmission, formatSubmissionForResponse)
 *   - ../routes/api.my-submissions.tsx (query patterns)
 *   - ../routes/api.track.tsx (getSubmissionByNumber)
 *   - ../routes/api.packing-slip.$number.tsx (submission lookup)
 *
 * CONSUMED BY (Frontend):
 *   - ShopifyTheme_TCG/assets/trade-in-app.js (POST /submissions)
 *   - extensions/trade-in-account/src/api/client.ts (GET my-submissions)
 *
 * RELATED DOCS:
 *   - docs/TRADE_IN_SYSTEM_SYNAPSE.md (full system architecture)
 *   - docs/trade-in-submission-flow.md (detailed flow)
 */

import prisma from "../db.server";
import type { Prisma, TradeInSubmission } from "@prisma/client";
import { Condition, formatPrice, PayoutType, type ConditionType, type PayoutTypeValue } from "./constants";
import { getOrCreateSettings, getMultiplierFromSettings } from "./settings.server";
import {
  isUniqueConstraintError,
  getConstraintFields,
  sleep,
  calculateBackoffDelay,
} from "./prisma-errors";
import { withTrace, logger, metrics } from "./observability.server";
import { withDbRetry } from "./db-resilience.server";

// ============================================================================
// Retry Configuration
// ============================================================================

const MAX_SUBMISSION_NUMBER_RETRIES = 5;
const RETRY_BASE_DELAY_MS = 50;

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

  logger.debug("Validating items", { itemCount: items.length, cardIdCount: cardIds.length });

  // 2. Single batch lookup (1 query instead of N)
  const cardsMap = await batchLookupCardPricesV2(cardIds);
  logger.debug("Batch card lookup complete", { foundCount: cardsMap.size, requestedCount: cardIds.length });

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

    // Debug logging for card lookup
    if (!card && item.cardPriceId) {
      logger.debug("Card not found in batch lookup", {
        cardPriceId: item.cardPriceId,
        cardName: item.cardName,
      });
    }

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
    totalValue += price * item.quantity;

    validatedItems.push({
      input: item,
      card,
      price,
      marketPricePence,
      isValid: true
    });
  }

  logger.debug("Validation totals calculated", {
    totalValue,
    minimumRequired: settings.minimumSubmissionValue,
    totalItems,
    invalidCount: invalidCards.length,
  });

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

  if (errors.length > 0) {
    logger.debug("Validation errors found", { errorCount: errors.length, firstError: errors[0] });
  }

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
 *
 * @param retryOffset - Additional offset to add to sequence number on retry
 *                      Used to avoid collisions when concurrent requests get same count
 */
export async function generateSubmissionNumber(retryOffset: number = 0): Promise<string> {
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

  // Add retryOffset to handle concurrent request collisions
  const sequenceNumber = count + 1 + retryOffset;
  const sequence = String(sequenceNumber).padStart(5, "0");
  return `${prefix}-${sequence}`;
}

// ============================================================================
// Customer Management
// ============================================================================

/**
 * Find or create a customer by Shopify ID or email
 *
 * Also updates placeholder customer records (auto-created when customer
 * first visits My Trade-Ins page) with their real email and name.
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
      // Update placeholder email and name if this is their first real submission
      const isPlaceholderEmail = existing.email.endsWith("@pending.local");
      const needsUpdate =
        isPlaceholderEmail ||
        (!existing.firstName && firstName) ||
        (!existing.lastName && lastName);

      if (needsUpdate) {
        return prisma.customer.update({
          where: { id: existing.id },
          data: {
            email: isPlaceholderEmail ? normalizedEmail : existing.email,
            firstName: existing.firstName || firstName,
            lastName: existing.lastName || lastName,
          },
        });
      }
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
 * Internal helper to create submission with retry on unique constraint violation
 * Handles race condition where concurrent requests get same submission number
 */
async function createSubmissionWithRetry(
  submissionData: Prisma.TradeInSubmissionCreateInput,
  attempt: number = 0
): Promise<TradeInSubmission & { items: any[]; customer: any }> {
  try {
    // withDbRetry handles connection errors, collision retries are handled below
    return await withDbRetry(
      () => prisma.tradeInSubmission.create({
        data: submissionData,
        include: {
          items: true,
          customer: true,
        },
      }),
      { label: "create-submission", maxRetries: 3 }
    );
  } catch (error) {
    // Check if this is a unique constraint violation on submissionNumber
    if (isUniqueConstraintError(error)) {
      const fields = getConstraintFields(error);

      if (
        fields.includes("submissionNumber") &&
        attempt < MAX_SUBMISSION_NUMBER_RETRIES
      ) {
        // Log retry attempt for monitoring
        logger.warn("Submission number collision, retrying", {
          attempt: attempt + 1,
          maxRetries: MAX_SUBMISSION_NUMBER_RETRIES,
        });
        metrics.increment("submission.number_collision");

        // Wait with exponential backoff before retrying
        const delay = calculateBackoffDelay(attempt, RETRY_BASE_DELAY_MS);
        await sleep(delay);

        // Generate new submission number with higher offset
        const newSubmissionNumber = await generateSubmissionNumber(attempt + 1);

        // Retry with new submission number
        return createSubmissionWithRetry(
          { ...submissionData, submissionNumber: newSubmissionNumber },
          attempt + 1
        );
      }
    }

    // Not a retryable error, or max retries exceeded
    throw error;
  }
}

/**
 * Create a new trade-in submission (OPTIMIZED)
 *
 * Performance improvements:
 * - Parallel settings + customer fetch
 * - Single batch card lookup via validateAndPrepareItems
 * - No additional DB queries when creating items (uses pre-calculated prices)
 * - Settings cached for request duration
 * - Automatic retry on submission number collision
 *
 * Before: 40-60 DB queries for 10 items
 * After: 6-8 DB queries for any number of items
 */
export async function createSubmission(input: CreateSubmissionInput, shop?: string) {
  const shopId = shop || "default";

  return withTrace("submission.create", {
    shop: shopId,
    itemCount: input.items.length,
    payoutType: input.payoutType,
    hasShopifyCustomer: !!input.shopifyCustomerId,
  }, async (trace) => {
    // 1. PARALLEL FETCH: Settings + Customer (2 queries instead of sequential)
    trace.log("Fetching settings and customer in parallel");
    const [settings, customer] = await Promise.all([
      getCachedSettings(shopId),
      getOrCreateCustomer({
        shopifyCustomerId: input.shopifyCustomerId,
        email: input.email,
        firstName: input.firstName,
        lastName: input.lastName,
      })
    ]);
    trace.addAttribute("customerId", customer.id);

    // 2. SINGLE-PASS VALIDATION + PRICE CALCULATION (1 batch query for all cards)
    trace.log("Validating and calculating prices");
    const { validatedItems, errors, totalValue } = await validateAndPrepareItems(
      input.items,
      settings
    );

    if (errors.length > 0) {
      clearSettingsCache();
      trace.setResult("error");
      trace.addAttribute("validationErrors", errors.length);
      logger.info("Submission validation failed", {
        errorCount: errors.length,
        firstError: errors[0],
      }, trace.traceId);
      return { success: false, errors };
    }

    trace.addAttribute("quotedTotal", totalValue);

    // 3. Generate submission number (1 query)
    trace.log("Generating submission number");
    const submissionNumber = await generateSubmissionNumber();
    trace.addAttribute("submissionNumber", submissionNumber);

    // 4. Calculate bonus (in-memory, no DB)
    const bonusAmount = input.payoutType === PayoutType.STORE_CREDIT
      ? Math.floor(totalValue * (settings.storeCreditBonusPercent / 100))
      : 0;

    // 5. Build submission data
    // NOTE: cardPriceId is set to null because we're using CardPriceV2 for lookups,
    // and the TradeInItem.cardPriceId FK references the legacy CardPrice table.
    // Card details are denormalized in the item record anyway.
    const submissionData: Prisma.TradeInSubmissionCreateInput = {
      submissionNumber,
      customer: { connect: { id: customer.id } },
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
    };

    // 6. Create submission with automatic retry on collision
    trace.log("Creating submission record");
    const submission = await createSubmissionWithRetry(submissionData);

    // 7. Clear cache after request completes
    clearSettingsCache();

    // Record success metrics
    metrics.increment("submission.created");
    metrics.increment(`submission.payout_type.${input.payoutType.toLowerCase()}`);
    trace.setResult("success");

    logger.info("Submission created successfully", {
      submissionNumber,
      submissionId: submission.id,
      quotedTotal: totalValue,
      itemCount: input.items.length,
    }, trace.traceId);

    return { success: true, submission };
  });
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
