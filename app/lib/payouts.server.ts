/**
 * Payout Processing for Trade-In System
 * Handles store credit (gift cards), bank transfers, and PayPal payouts
 */

import prisma from "../db.server";
import type { Prisma } from "@prisma/client";
import { getOrCreateSettings } from "./settings.server";
import { PayoutStatus, PayoutType, type PayoutStatusType, type PayoutTypeValue } from "./constants";

// ============================================================================
// TYPES
// ============================================================================

export interface PayoutSearchParams {
  status?: PayoutStatusType;
  type?: PayoutTypeValue;
  customerId?: string;
  page?: number;
  limit?: number;
}

export interface PayoutSearchResult {
  payouts: Awaited<ReturnType<typeof prisma.payout.findMany>>;
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface CreatePayoutInput {
  submissionId: string;
  customerId: string;
  type: PayoutTypeValue;
  amount: number;
  bonusAmount?: number;
  totalAmount: number;
}

export interface PayoutResult {
  success: boolean;
  payout?: Awaited<ReturnType<typeof prisma.payout.findUnique>>;
  giftCard?: {
    id: string;
    code: string;
    lastCharacters: string;
    balance: string;
  };
  error?: string;
}

export interface PayoutStats {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  totalPending: number;
  totalCompleted: number;
}

// ============================================================================
// PAYOUT SEARCH & RETRIEVAL
// ============================================================================

/**
 * Search payouts with filters and pagination
 */
export async function searchPayouts(
  params: PayoutSearchParams
): Promise<PayoutSearchResult> {
  const page = Math.max(1, params.page || 1);
  const limit = Math.min(100, Math.max(1, params.limit || 20));
  const skip = (page - 1) * limit;

  const where: Prisma.PayoutWhereInput = {};

  if (params.status) {
    where.status = params.status;
  }

  if (params.type) {
    where.type = params.type;
  }

  if (params.customerId) {
    where.customerId = params.customerId;
  }

  const [payouts, total] = await Promise.all([
    prisma.payout.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      include: {
        submission: {
          select: {
            submissionNumber: true,
            status: true,
          },
        },
        customer: {
          select: {
            email: true,
            firstName: true,
            lastName: true,
          },
        },
      },
    }),
    prisma.payout.count({ where }),
  ]);

  return {
    payouts,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

/**
 * Get a single payout by ID with full details
 */
export async function getPayoutById(id: string) {
  return prisma.payout.findUnique({
    where: { id },
    include: {
      submission: {
        include: {
          items: true,
        },
      },
      customer: {
        include: {
          payoutMethods: true,
        },
      },
    },
  });
}

/**
 * Get payout by submission ID
 */
export async function getPayoutBySubmissionId(submissionId: string) {
  return prisma.payout.findUnique({
    where: { submissionId },
    include: {
      submission: true,
      customer: true,
    },
  });
}

/**
 * Get payout statistics
 */
export async function getPayoutStats(): Promise<PayoutStats> {
  const [statusCounts, pendingTotal, completedTotal] = await Promise.all([
    prisma.payout.groupBy({
      by: ["status"],
      _count: true,
    }),
    prisma.payout.aggregate({
      where: { status: PayoutStatus.PENDING },
      _sum: { totalAmount: true },
    }),
    prisma.payout.aggregate({
      where: { status: PayoutStatus.COMPLETED },
      _sum: { totalAmount: true },
    }),
  ]);

  const counts = statusCounts.reduce(
    (acc, item) => {
      acc[item.status.toLowerCase() as keyof Omit<PayoutStats, "totalPending" | "totalCompleted">] = item._count;
      return acc;
    },
    { pending: 0, processing: 0, completed: 0, failed: 0 }
  );

  return {
    ...counts,
    totalPending: pendingTotal._sum.totalAmount ?? 0,
    totalCompleted: completedTotal._sum.totalAmount ?? 0,
  };
}

// ============================================================================
// PAYOUT CREATION
// ============================================================================

/**
 * Create a payout record when submission is approved
 */
export async function createPayout(
  shop: string,
  submissionId: string
): Promise<PayoutResult> {
  // Check if payout already exists
  const existing = await prisma.payout.findUnique({
    where: { submissionId },
  });

  if (existing) {
    if (existing.status === PayoutStatus.COMPLETED) {
      return {
        success: false,
        error: "Payout already completed for this submission",
      };
    }
    // Return existing pending/failed payout
    return { success: true, payout: existing };
  }

  // Get submission and settings
  const [submission, settings] = await Promise.all([
    prisma.tradeInSubmission.findUnique({
      where: { id: submissionId },
      include: { customer: true },
    }),
    getOrCreateSettings(shop),
  ]);

  if (!submission) {
    return { success: false, error: "Submission not found" };
  }

  // Calculate payout amounts
  const baseAmount = submission.finalTotal ?? submission.quotedTotal;
  let bonusAmount = 0;
  let totalAmount = baseAmount;

  if (submission.payoutType === PayoutType.STORE_CREDIT) {
    bonusAmount = Math.floor(baseAmount * (settings.storeCreditBonusPercent / 100));
    totalAmount = baseAmount + bonusAmount;
  } else if (
    submission.payoutType === PayoutType.BANK ||
    submission.payoutType === PayoutType.PAYPAL
  ) {
    if (settings.cashPayoutPercent < 100) {
      const reduction = baseAmount - Math.floor(baseAmount * (settings.cashPayoutPercent / 100));
      bonusAmount = -reduction;
      totalAmount = baseAmount + bonusAmount;
    }
  }

  // Create payout record
  const payout = await prisma.payout.create({
    data: {
      submissionId,
      customerId: submission.customerId,
      type: submission.payoutType,
      amount: baseAmount,
      bonusAmount,
      totalAmount,
      status: PayoutStatus.PENDING,
    },
  });

  return { success: true, payout };
}

// ============================================================================
// STORE CREDIT (GIFT CARD) PROCESSING
// ============================================================================

/**
 * GraphQL mutation for creating a gift card
 */
const CREATE_GIFT_CARD_MUTATION = `#graphql
  mutation giftCardCreate($input: GiftCardCreateInput!) {
    giftCardCreate(input: $input) {
      giftCard {
        id
        lastCharacters
        maskedCode
        balance {
          amount
          currencyCode
        }
        expiresOn
        customer {
          id
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

interface ShopifyAdminContext {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
}

/**
 * Process store credit payout by creating a Shopify gift card
 */
export async function processStoreCreditPayout(
  payoutId: string,
  admin: ShopifyAdminContext
): Promise<PayoutResult> {
  const payout = await prisma.payout.findUnique({
    where: { id: payoutId },
    include: {
      submission: true,
      customer: true,
    },
  });

  if (!payout) {
    return { success: false, error: "Payout not found" };
  }

  if (payout.status === PayoutStatus.COMPLETED) {
    return { success: false, error: "Payout already completed" };
  }

  if (payout.type !== PayoutType.STORE_CREDIT) {
    return { success: false, error: "Payout is not store credit type" };
  }

  // Mark as processing
  await prisma.payout.update({
    where: { id: payoutId },
    data: { status: PayoutStatus.PROCESSING },
  });

  try {
    // Convert pence to pounds for Shopify
    const amountInPounds = (payout.totalAmount / 100).toFixed(2);

    const response = await admin.graphql(CREATE_GIFT_CARD_MUTATION, {
      variables: {
        input: {
          initialValue: amountInPounds,
          customerId: payout.customer.shopifyCustomerId
            ? `gid://shopify/Customer/${payout.customer.shopifyCustomerId}`
            : null,
          note: `Trade-in #${payout.submission.submissionNumber}`,
          expiresOn: null, // No expiry
        },
      },
    });

    const data = await response.json();

    if (data.data?.giftCardCreate?.userErrors?.length > 0) {
      const errorMessage = data.data.giftCardCreate.userErrors[0].message;

      await prisma.payout.update({
        where: { id: payoutId },
        data: {
          status: PayoutStatus.FAILED,
          failureReason: errorMessage,
        },
      });

      return { success: false, error: errorMessage };
    }

    const giftCard = data.data?.giftCardCreate?.giftCard;

    if (!giftCard) {
      throw new Error("No gift card returned from Shopify");
    }

    // Update payout with gift card details
    const updatedPayout = await prisma.payout.update({
      where: { id: payoutId },
      data: {
        status: PayoutStatus.COMPLETED,
        giftCardId: giftCard.id,
        giftCardCode: giftCard.maskedCode,
        processedAt: new Date(),
      },
    });

    // Also update submission to completed
    await prisma.tradeInSubmission.update({
      where: { id: payout.submissionId },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
      },
    });

    return {
      success: true,
      payout: updatedPayout,
      giftCard: {
        id: giftCard.id,
        code: giftCard.maskedCode,
        lastCharacters: giftCard.lastCharacters,
        balance: giftCard.balance.amount,
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";

    await prisma.payout.update({
      where: { id: payoutId },
      data: {
        status: PayoutStatus.FAILED,
        failureReason: errorMessage,
      },
    });

    return { success: false, error: errorMessage };
  }
}

// ============================================================================
// BANK TRANSFER PROCESSING
// ============================================================================

/**
 * Mark a bank transfer as processing with reference
 */
export async function markBankTransferProcessing(
  payoutId: string,
  bankReference: string
): Promise<PayoutResult> {
  const payout = await prisma.payout.findUnique({
    where: { id: payoutId },
  });

  if (!payout) {
    return { success: false, error: "Payout not found" };
  }

  if (payout.type !== PayoutType.BANK) {
    return { success: false, error: "Payout is not bank transfer type" };
  }

  if (payout.status === PayoutStatus.COMPLETED) {
    return { success: false, error: "Payout already completed" };
  }

  const updatedPayout = await prisma.payout.update({
    where: { id: payoutId },
    data: {
      status: PayoutStatus.PROCESSING,
      bankReference,
    },
  });

  return { success: true, payout: updatedPayout };
}

/**
 * Mark a bank transfer as completed
 */
export async function markBankTransferCompleted(
  payoutId: string
): Promise<PayoutResult> {
  const payout = await prisma.payout.findUnique({
    where: { id: payoutId },
    include: { submission: true },
  });

  if (!payout) {
    return { success: false, error: "Payout not found" };
  }

  if (payout.type !== PayoutType.BANK && payout.type !== PayoutType.PAYPAL) {
    return { success: false, error: "Payout is not bank/PayPal transfer type" };
  }

  if (payout.status === PayoutStatus.COMPLETED) {
    return { success: false, error: "Payout already completed" };
  }

  const updatedPayout = await prisma.payout.update({
    where: { id: payoutId },
    data: {
      status: PayoutStatus.COMPLETED,
      processedAt: new Date(),
    },
  });

  // Also update submission to completed
  await prisma.tradeInSubmission.update({
    where: { id: payout.submissionId },
    data: {
      status: "COMPLETED",
      completedAt: new Date(),
    },
  });

  return { success: true, payout: updatedPayout };
}

// ============================================================================
// PAYOUT RETRY & FAILURE HANDLING
// ============================================================================

/**
 * Retry a failed payout
 */
export async function retryPayout(
  payoutId: string
): Promise<PayoutResult> {
  const payout = await prisma.payout.findUnique({
    where: { id: payoutId },
  });

  if (!payout) {
    return { success: false, error: "Payout not found" };
  }

  if (payout.status !== PayoutStatus.FAILED) {
    return { success: false, error: "Only failed payouts can be retried" };
  }

  // Reset to pending
  const updatedPayout = await prisma.payout.update({
    where: { id: payoutId },
    data: {
      status: PayoutStatus.PENDING,
      failureReason: null,
    },
  });

  return { success: true, payout: updatedPayout };
}

/**
 * Mark payout as failed with reason
 */
export async function markPayoutFailed(
  payoutId: string,
  reason: string
): Promise<PayoutResult> {
  const updatedPayout = await prisma.payout.update({
    where: { id: payoutId },
    data: {
      status: PayoutStatus.FAILED,
      failureReason: reason,
    },
  });

  return { success: true, payout: updatedPayout };
}

// ============================================================================
// BULK OPERATIONS
// ============================================================================

/**
 * Export pending bank transfers as CSV data
 */
export async function exportBankTransfers(): Promise<{
  data: Array<{
    reference: string;
    customerName: string;
    email: string;
    amount: string;
    submissionNumber: string;
  }>;
  count: number;
}> {
  const payouts = await prisma.payout.findMany({
    where: {
      type: PayoutType.BANK,
      status: PayoutStatus.PENDING,
    },
    include: {
      customer: {
        include: {
          payoutMethods: {
            where: { type: "BANK", isDefault: true },
          },
        },
      },
      submission: {
        select: { submissionNumber: true },
      },
    },
  });

  const data = payouts.map((p) => ({
    reference: `TRD-${p.submission.submissionNumber}`,
    customerName: `${p.customer.firstName || ""} ${p.customer.lastName || ""}`.trim() || "Unknown",
    email: p.customer.email,
    amount: (p.totalAmount / 100).toFixed(2),
    submissionNumber: p.submission.submissionNumber,
  }));

  return { data, count: data.length };
}

/**
 * Get pending payouts that need action
 */
export async function getPendingPayouts() {
  return prisma.payout.findMany({
    where: {
      status: PayoutStatus.PENDING,
    },
    orderBy: { createdAt: "asc" },
    include: {
      submission: {
        select: {
          submissionNumber: true,
        },
      },
      customer: {
        select: {
          email: true,
          firstName: true,
          lastName: true,
        },
      },
    },
  });
}

/**
 * Check for stale payouts (pending > 24 hours)
 */
export async function getStalePayouts() {
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  return prisma.payout.findMany({
    where: {
      status: PayoutStatus.PENDING,
      createdAt: { lt: oneDayAgo },
    },
    include: {
      submission: true,
      customer: true,
    },
  });
}
