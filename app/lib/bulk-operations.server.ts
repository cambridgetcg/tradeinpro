/**
 * Bulk Operations Library
 *
 * Provides batch processing for common admin operations on submissions.
 */

import prisma from "../db.server";
import { attemptTransition, type SubmissionContext } from "./workflow.server";

// Helper to build context from a submission record
function buildContext(submission: {
  status: string;
  items?: Array<{ status: string }>;
  quotedTotal?: number;
  finalTotal?: number | null;
}): SubmissionContext {
  const items = submission.items || [];
  const gradedStatuses = ["VERIFIED", "ADJUSTED", "REJECTED"];
  const gradedItems = items.filter((i) => gradedStatuses.includes(i.status));

  return {
    currentStatus: submission.status as any,
    itemsCount: items.length,
    gradedItemsCount: gradedItems.length,
    totalValue: submission.finalTotal ?? submission.quotedTotal ?? 0,
    requiresApproval: false, // Bulk operations handle this differently
    allItemsGraded: items.length === 0 || gradedItems.length === items.length,
  };
}

// ============================================================================
// Types
// ============================================================================

export interface BulkOperationResult {
  success: number;
  failed: number;
  errors: Array<{ id: string; error: string }>;
}

export interface BulkOperationOptions {
  /** Maximum items to process in one batch */
  maxItems?: number;
  /** Continue processing even if some items fail */
  continueOnError?: boolean;
}

const DEFAULT_MAX_ITEMS = 100;

// ============================================================================
// Validation
// ============================================================================

function validateBulkInput(
  submissionIds: string[],
  options: BulkOperationOptions = {}
): void {
  const maxItems = options.maxItems ?? DEFAULT_MAX_ITEMS;

  if (!Array.isArray(submissionIds)) {
    throw new Error("submissionIds must be an array");
  }

  if (submissionIds.length === 0) {
    throw new Error("At least one submission ID is required");
  }

  if (submissionIds.length > maxItems) {
    throw new Error(`Bulk operations limited to ${maxItems} items`);
  }

  // Check for duplicate IDs
  const uniqueIds = new Set(submissionIds);
  if (uniqueIds.size !== submissionIds.length) {
    throw new Error("Duplicate submission IDs provided");
  }
}

// ============================================================================
// Bulk Operations
// ============================================================================

/**
 * Bulk mark submissions as received
 */
export async function bulkMarkReceived(
  submissionIds: string[],
  options: BulkOperationOptions = {}
): Promise<BulkOperationResult> {
  validateBulkInput(submissionIds, options);

  const result: BulkOperationResult = { success: 0, failed: 0, errors: [] };

  for (const id of submissionIds) {
    try {
      const submission = await prisma.tradeInSubmission.findUnique({
        where: { id },
      });

      if (!submission) {
        result.failed++;
        result.errors.push({ id, error: "Submission not found" });
        continue;
      }

      // Check if transition is valid
      const context = buildContext(submission);
      const transition = attemptTransition(context, "RECEIVED");
      if (!transition.allowed) {
        result.failed++;
        result.errors.push({
          id,
          error: transition.reason || `Cannot transition from ${submission.status} to RECEIVED`,
        });
        continue;
      }

      // Update submission
      await prisma.tradeInSubmission.update({
        where: { id },
        data: {
          status: "RECEIVED",
          receivedAt: new Date(),
        },
      });

      result.success++;
    } catch (error) {
      result.failed++;
      result.errors.push({
        id,
        error: error instanceof Error ? error.message : "Unknown error",
      });

      if (!options.continueOnError) {
        throw error;
      }
    }
  }

  return result;
}

/**
 * Bulk move submissions to grading
 */
export async function bulkStartGrading(
  submissionIds: string[],
  options: BulkOperationOptions = {}
): Promise<BulkOperationResult> {
  validateBulkInput(submissionIds, options);

  const result: BulkOperationResult = { success: 0, failed: 0, errors: [] };

  for (const id of submissionIds) {
    try {
      const submission = await prisma.tradeInSubmission.findUnique({
        where: { id },
      });

      if (!submission) {
        result.failed++;
        result.errors.push({ id, error: "Submission not found" });
        continue;
      }

      const context = buildContext(submission);
      const transition = attemptTransition(context, "GRADING");
      if (!transition.allowed) {
        result.failed++;
        result.errors.push({
          id,
          error: transition.reason || `Cannot transition from ${submission.status} to GRADING`,
        });
        continue;
      }

      await prisma.tradeInSubmission.update({
        where: { id },
        data: { status: "GRADING" },
      });

      result.success++;
    } catch (error) {
      result.failed++;
      result.errors.push({
        id,
        error: error instanceof Error ? error.message : "Unknown error",
      });

      if (!options.continueOnError) {
        throw error;
      }
    }
  }

  return result;
}

/**
 * Bulk approve submissions and create payouts
 */
export async function bulkApproveSubmissions(
  submissionIds: string[],
  options: BulkOperationOptions = {}
): Promise<BulkOperationResult> {
  validateBulkInput(submissionIds, options);

  const result: BulkOperationResult = { success: 0, failed: 0, errors: [] };

  for (const id of submissionIds) {
    try {
      const submission = await prisma.tradeInSubmission.findUnique({
        where: { id },
        include: { items: true },
      });

      if (!submission) {
        result.failed++;
        result.errors.push({ id, error: "Submission not found" });
        continue;
      }

      // Check if already approved or completed
      if (submission.status === "APPROVED" || submission.status === "COMPLETED") {
        result.failed++;
        result.errors.push({ id, error: "Submission already approved" });
        continue;
      }

      // Check if transition is valid
      const context = buildContext(submission);
      const transition = attemptTransition(context, "APPROVED");
      if (!transition.allowed) {
        result.failed++;
        result.errors.push({
          id,
          error: transition.reason || `Cannot transition from ${submission.status} to APPROVED`,
        });
        continue;
      }

      // Calculate final total if not set
      const finalTotal = submission.finalTotal ?? submission.quotedTotal;

      // Update submission and create payout in transaction
      await prisma.$transaction(async (tx) => {
        // Update submission
        await tx.tradeInSubmission.update({
          where: { id },
          data: {
            status: "APPROVED",
            finalTotal,
            approvedAt: new Date(),
          },
        });

        // Check if payout already exists
        const existingPayout = await tx.payout.findUnique({
          where: { submissionId: id },
        });

        if (!existingPayout) {
          // Calculate bonus for store credit
          const bonusAmount =
            submission.payoutType === "STORE_CREDIT"
              ? Math.round(finalTotal * 0.1)
              : 0;

          // Create payout record
          await tx.payout.create({
            data: {
              submissionId: id,
              customerId: submission.customerId,
              type: submission.payoutType,
              amount: finalTotal,
              bonusAmount,
              totalAmount: finalTotal + bonusAmount,
              status: "PENDING",
            },
          });
        }

        // Add system note
        await tx.submissionNote.create({
          data: {
            submissionId: id,
            authorType: "SYSTEM",
            message: "Submission approved via bulk operation",
            isInternal: true,
          },
        });
      });

      result.success++;
    } catch (error) {
      result.failed++;
      result.errors.push({
        id,
        error: error instanceof Error ? error.message : "Unknown error",
      });

      if (!options.continueOnError) {
        throw error;
      }
    }
  }

  return result;
}

/**
 * Bulk cancel submissions
 */
export async function bulkCancelSubmissions(
  submissionIds: string[],
  reason: string,
  options: BulkOperationOptions = {}
): Promise<BulkOperationResult> {
  validateBulkInput(submissionIds, options);

  if (!reason || reason.trim().length === 0) {
    throw new Error("Cancellation reason is required");
  }

  const sanitizedReason = reason.trim().slice(0, 500);
  const result: BulkOperationResult = { success: 0, failed: 0, errors: [] };

  for (const id of submissionIds) {
    try {
      const submission = await prisma.tradeInSubmission.findUnique({
        where: { id },
      });

      if (!submission) {
        result.failed++;
        result.errors.push({ id, error: "Submission not found" });
        continue;
      }

      // Check if already cancelled or completed
      if (submission.status === "CANCELLED") {
        result.failed++;
        result.errors.push({ id, error: "Submission already cancelled" });
        continue;
      }

      if (submission.status === "COMPLETED") {
        result.failed++;
        result.errors.push({ id, error: "Cannot cancel completed submission" });
        continue;
      }

      // Check if transition is valid
      const context = buildContext(submission);
      const transition = attemptTransition(context, "CANCELLED");
      if (!transition.allowed) {
        result.failed++;
        result.errors.push({
          id,
          error: transition.reason || `Cannot cancel submission in ${submission.status} status`,
        });
        continue;
      }

      // Update submission in transaction
      await prisma.$transaction([
        prisma.tradeInSubmission.update({
          where: { id },
          data: { status: "CANCELLED" },
        }),
        prisma.submissionNote.create({
          data: {
            submissionId: id,
            authorType: "MERCHANT",
            message: `Bulk cancelled: ${sanitizedReason}`,
            isInternal: true,
          },
        }),
      ]);

      result.success++;
    } catch (error) {
      result.failed++;
      result.errors.push({
        id,
        error: error instanceof Error ? error.message : "Unknown error",
      });

      if (!options.continueOnError) {
        throw error;
      }
    }
  }

  return result;
}

/**
 * Bulk request returns for rejected submissions
 */
export async function bulkRequestReturns(
  submissionIds: string[],
  reason: string,
  options: BulkOperationOptions = {}
): Promise<BulkOperationResult> {
  validateBulkInput(submissionIds, options);

  if (!reason || reason.trim().length === 0) {
    throw new Error("Return reason is required");
  }

  const sanitizedReason = reason.trim().slice(0, 500);
  const result: BulkOperationResult = { success: 0, failed: 0, errors: [] };

  for (const id of submissionIds) {
    try {
      const submission = await prisma.tradeInSubmission.findUnique({
        where: { id },
      });

      if (!submission) {
        result.failed++;
        result.errors.push({ id, error: "Submission not found" });
        continue;
      }

      // Check if already returned
      if (submission.status === "RETURNED") {
        result.failed++;
        result.errors.push({ id, error: "Submission already returned" });
        continue;
      }

      // Check if transition is valid
      const context = buildContext(submission);
      const transition = attemptTransition(context, "RETURNED");
      if (!transition.allowed) {
        result.failed++;
        result.errors.push({
          id,
          error: transition.reason || `Cannot return submission in ${submission.status} status`,
        });
        continue;
      }

      await prisma.$transaction([
        prisma.tradeInSubmission.update({
          where: { id },
          data: { status: "RETURNED" },
        }),
        prisma.submissionNote.create({
          data: {
            submissionId: id,
            authorType: "MERCHANT",
            message: `Return requested: ${sanitizedReason}`,
            isInternal: false,
          },
        }),
      ]);

      result.success++;
    } catch (error) {
      result.failed++;
      result.errors.push({
        id,
        error: error instanceof Error ? error.message : "Unknown error",
      });

      if (!options.continueOnError) {
        throw error;
      }
    }
  }

  return result;
}

/**
 * Bulk add internal notes to submissions
 */
export async function bulkAddNotes(
  submissionIds: string[],
  message: string,
  options: BulkOperationOptions & { isInternal?: boolean; authorName?: string } = {}
): Promise<BulkOperationResult> {
  validateBulkInput(submissionIds, options);

  if (!message || message.trim().length === 0) {
    throw new Error("Note message is required");
  }

  const sanitizedMessage = message.trim().slice(0, 2000);
  const result: BulkOperationResult = { success: 0, failed: 0, errors: [] };

  for (const id of submissionIds) {
    try {
      // Verify submission exists
      const submission = await prisma.tradeInSubmission.findUnique({
        where: { id },
        select: { id: true },
      });

      if (!submission) {
        result.failed++;
        result.errors.push({ id, error: "Submission not found" });
        continue;
      }

      await prisma.submissionNote.create({
        data: {
          submissionId: id,
          authorType: "MERCHANT",
          authorName: options.authorName,
          message: sanitizedMessage,
          isInternal: options.isInternal ?? true,
        },
      });

      result.success++;
    } catch (error) {
      result.failed++;
      result.errors.push({
        id,
        error: error instanceof Error ? error.message : "Unknown error",
      });

      if (!options.continueOnError) {
        throw error;
      }
    }
  }

  return result;
}
