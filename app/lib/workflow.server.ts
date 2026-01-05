/**
 * Workflow State Machine for Trade-In Submissions
 * Handles status transitions with validation and business rules
 *
 * @synapse CODE_SYNAPSE.md - See ./CODE_SYNAPSE.md for full module dependency graph
 *
 * EXPORTS:
 *   - canTransition() - Validate if status change is allowed
 *   - getNextStatuses() - Get available transitions from current state
 *   - WORKFLOW_TRANSITIONS - Full state machine definition
 *
 * SHOULD BE IMPORTED BY (currently under-utilized):
 *   - ../routes/api.submissions.$id.confirm.tsx
 *   - ../routes/api.submissions.$id.reject.tsx
 *   - ../routes/api.my-submissions.$number.action.tsx
 *   - ./submissions.server.ts (for internal validation)
 *
 * STATUS FLOW:
 *   DRAFT → SUBMITTED → RECEIVED → GRADING → GRADED → CUSTOMER_REVIEW
 *                                                 ↓
 *                                 CONFIRMED → PAYMENT_PENDING → COMPLETED
 *                                 REJECTED → RETURNED/DISPOSED
 *
 * RELATED DOCS:
 *   - docs/TRADE_IN_SYSTEM_SYNAPSE.md (system architecture)
 */

import {
  SubmissionStatus,
  type SubmissionStatusType,
  ItemStatus,
  type ItemStatusType,
  PayoutStatus,
  type PayoutStatusType,
  NoteAuthorType,
} from "./constants";
import { withTrace, logger, metrics } from "./observability.server";
import { withDbRetry } from "./db-resilience.server";

// ============================================================================
// TYPES
// ============================================================================

export interface TransitionResult {
  allowed: boolean;
  newStatus?: SubmissionStatusType;
  reason?: string;
  sideEffects?: SideEffect[];
}

export interface SideEffect {
  type:
    | "UPDATE_TIMESTAMP"
    | "CREATE_NOTE"
    | "SEND_NOTIFICATION"
    | "TRIGGER_PAYOUT"
    | "UPDATE_ITEMS";
  payload: Record<string, unknown>;
}

export interface SubmissionContext {
  currentStatus: SubmissionStatusType;
  itemsCount: number;
  gradedItemsCount: number;
  totalValue: number;
  requiresApproval: boolean;
  hasTrackingNumber?: boolean;
  allItemsGraded?: boolean;
}

// ============================================================================
// TRANSITION RULES
// ============================================================================

/**
 * Valid status transitions for submissions
 * Each status maps to an array of valid next statuses
 */
const VALID_TRANSITIONS: Record<SubmissionStatusType, SubmissionStatusType[]> =
  {
    [SubmissionStatus.DRAFT]: [
      SubmissionStatus.SUBMITTED,
      SubmissionStatus.CANCELLED,
    ],
    [SubmissionStatus.SUBMITTED]: [
      SubmissionStatus.IN_TRANSIT,
      SubmissionStatus.RECEIVED, // For drop-off
      SubmissionStatus.CANCELLED,
    ],
    [SubmissionStatus.IN_TRANSIT]: [
      SubmissionStatus.RECEIVED,
      SubmissionStatus.RETURNED, // Lost/returned shipment
    ],
    [SubmissionStatus.RECEIVED]: [
      SubmissionStatus.GRADING,
      SubmissionStatus.RETURNED, // Immediate rejection
    ],
    [SubmissionStatus.GRADING]: [
      SubmissionStatus.PENDING_APPROVAL,
      SubmissionStatus.APPROVED, // Auto-approve if below threshold
      SubmissionStatus.RETURNED, // All items rejected
    ],
    [SubmissionStatus.PENDING_APPROVAL]: [
      SubmissionStatus.APPROVED,
      SubmissionStatus.RETURNED, // Customer rejects offer
      SubmissionStatus.GRADING, // Re-grade needed
    ],
    [SubmissionStatus.APPROVED]: [
      SubmissionStatus.COMPLETED,
      SubmissionStatus.PENDING_APPROVAL, // Issue with payout
    ],
    [SubmissionStatus.COMPLETED]: [], // Terminal state
    [SubmissionStatus.CANCELLED]: [], // Terminal state
    [SubmissionStatus.RETURNED]: [], // Terminal state
  };

/**
 * Transitions that can be triggered by the system automatically
 */
const SYSTEM_ALLOWED_TRANSITIONS: Array<
  [SubmissionStatusType, SubmissionStatusType]
> = [
  [SubmissionStatus.GRADING, SubmissionStatus.APPROVED], // Auto-approve
  [SubmissionStatus.APPROVED, SubmissionStatus.COMPLETED], // Payout complete
];

/**
 * Transitions that require all items to be graded first
 */
const REQUIRES_ALL_ITEMS_GRADED: SubmissionStatusType[] = [
  SubmissionStatus.PENDING_APPROVAL,
  SubmissionStatus.APPROVED,
];

// ============================================================================
// CORE TRANSITION LOGIC
// ============================================================================

/**
 * Check if a status transition is valid
 */
export function isValidTransition(
  from: SubmissionStatusType,
  to: SubmissionStatusType
): boolean {
  const validNextStatuses = VALID_TRANSITIONS[from];
  return validNextStatuses?.includes(to) ?? false;
}

/**
 * Get all valid next statuses for a given status
 */
export function getValidNextStatuses(
  status: SubmissionStatusType
): SubmissionStatusType[] {
  return VALID_TRANSITIONS[status] ?? [];
}

/**
 * Check if a status is a terminal state
 */
export function isTerminalStatus(status: SubmissionStatusType): boolean {
  return VALID_TRANSITIONS[status]?.length === 0;
}

/**
 * Attempt a status transition with full validation
 */
export function attemptTransition(
  context: SubmissionContext,
  targetStatus: SubmissionStatusType,
  isSystemAction: boolean = false
): TransitionResult {
  const { currentStatus } = context;

  // Check if transition is valid
  if (!isValidTransition(currentStatus, targetStatus)) {
    return {
      allowed: false,
      reason: `Cannot transition from ${currentStatus} to ${targetStatus}`,
    };
  }

  // Check if all items need to be graded first
  if (REQUIRES_ALL_ITEMS_GRADED.includes(targetStatus)) {
    if (!context.allItemsGraded && context.itemsCount > 0) {
      return {
        allowed: false,
        reason: `All items must be graded before moving to ${targetStatus}`,
      };
    }
  }

  // Check system-only transitions
  if (!isSystemAction) {
    const isSystemTransition = SYSTEM_ALLOWED_TRANSITIONS.some(
      ([from, to]) => from === currentStatus && to === targetStatus
    );
    // System transitions can still be done manually, but log it
  }

  // Build side effects based on transition
  const sideEffects = buildTransitionSideEffects(
    currentStatus,
    targetStatus,
    context
  );

  return {
    allowed: true,
    newStatus: targetStatus,
    sideEffects,
  };
}

// ============================================================================
// SIDE EFFECTS
// ============================================================================

function buildTransitionSideEffects(
  from: SubmissionStatusType,
  to: SubmissionStatusType,
  context: SubmissionContext
): SideEffect[] {
  const effects: SideEffect[] = [];

  // Always create a system note for status changes
  effects.push({
    type: "CREATE_NOTE",
    payload: {
      authorType: NoteAuthorType.SYSTEM,
      message: `Status changed from ${from} to ${to}`,
      isInternal: true,
    },
  });

  // Timestamp updates based on target status
  switch (to) {
    case SubmissionStatus.SUBMITTED:
      effects.push({
        type: "UPDATE_TIMESTAMP",
        payload: { field: "submittedAt" },
      });
      effects.push({
        type: "SEND_NOTIFICATION",
        payload: { type: "submission_received", to: "merchant" },
      });
      break;

    case SubmissionStatus.RECEIVED:
      effects.push({
        type: "UPDATE_TIMESTAMP",
        payload: { field: "receivedAt" },
      });
      effects.push({
        type: "SEND_NOTIFICATION",
        payload: { type: "package_received", to: "customer" },
      });
      break;

    case SubmissionStatus.GRADING:
      // No specific side effects, grading in progress
      break;

    case SubmissionStatus.PENDING_APPROVAL:
      effects.push({
        type: "UPDATE_TIMESTAMP",
        payload: { field: "gradedAt" },
      });
      effects.push({
        type: "SEND_NOTIFICATION",
        payload: { type: "grading_complete", to: "customer" },
      });
      break;

    case SubmissionStatus.APPROVED:
      effects.push({
        type: "UPDATE_TIMESTAMP",
        payload: { field: "approvedAt" },
      });
      // If coming directly from grading (auto-approve), also set gradedAt
      if (from === SubmissionStatus.GRADING) {
        effects.push({
          type: "UPDATE_TIMESTAMP",
          payload: { field: "gradedAt" },
        });
      }
      effects.push({
        type: "TRIGGER_PAYOUT",
        payload: { amount: context.totalValue },
      });
      break;

    case SubmissionStatus.COMPLETED:
      effects.push({
        type: "UPDATE_TIMESTAMP",
        payload: { field: "completedAt" },
      });
      effects.push({
        type: "SEND_NOTIFICATION",
        payload: { type: "payout_complete", to: "customer" },
      });
      break;

    case SubmissionStatus.CANCELLED:
      effects.push({
        type: "SEND_NOTIFICATION",
        payload: { type: "submission_cancelled", to: "customer" },
      });
      break;

    case SubmissionStatus.RETURNED:
      effects.push({
        type: "SEND_NOTIFICATION",
        payload: { type: "items_returned", to: "customer" },
      });
      break;
  }

  return effects;
}

// ============================================================================
// ITEM STATUS WORKFLOW
// ============================================================================

/**
 * Valid item status transitions
 */
const VALID_ITEM_TRANSITIONS: Record<ItemStatusType, ItemStatusType[]> = {
  [ItemStatus.PENDING]: [
    ItemStatus.VERIFIED,
    ItemStatus.ADJUSTED,
    ItemStatus.REJECTED,
  ],
  [ItemStatus.VERIFIED]: [ItemStatus.ADJUSTED], // Can be re-evaluated
  [ItemStatus.ADJUSTED]: [ItemStatus.VERIFIED, ItemStatus.REJECTED],
  [ItemStatus.REJECTED]: [], // Terminal for this item
};

export function isValidItemTransition(
  from: ItemStatusType,
  to: ItemStatusType
): boolean {
  return VALID_ITEM_TRANSITIONS[from]?.includes(to) ?? false;
}

export function getValidItemNextStatuses(
  status: ItemStatusType
): ItemStatusType[] {
  return VALID_ITEM_TRANSITIONS[status] ?? [];
}

// ============================================================================
// PAYOUT STATUS WORKFLOW
// ============================================================================

const VALID_PAYOUT_TRANSITIONS: Record<PayoutStatusType, PayoutStatusType[]> = {
  [PayoutStatus.PENDING]: [PayoutStatus.PROCESSING, PayoutStatus.FAILED],
  [PayoutStatus.PROCESSING]: [PayoutStatus.COMPLETED, PayoutStatus.FAILED],
  [PayoutStatus.COMPLETED]: [], // Terminal
  [PayoutStatus.FAILED]: [PayoutStatus.PENDING], // Can retry
};

export function isValidPayoutTransition(
  from: PayoutStatusType,
  to: PayoutStatusType
): boolean {
  return VALID_PAYOUT_TRANSITIONS[from]?.includes(to) ?? false;
}

// ============================================================================
// BULK OPERATIONS
// ============================================================================

/**
 * Check if submission can proceed to next workflow stage
 */
export function canProceedToNextStage(
  context: SubmissionContext
): { canProceed: boolean; blockers: string[] } {
  const blockers: string[] = [];

  switch (context.currentStatus) {
    case SubmissionStatus.DRAFT:
      if (context.itemsCount === 0) {
        blockers.push("Submission has no items");
      }
      if (context.totalValue === 0) {
        blockers.push("Submission has zero value");
      }
      break;

    case SubmissionStatus.SUBMITTED:
      // Can proceed to in-transit or received
      break;

    case SubmissionStatus.IN_TRANSIT:
      // Waiting for package arrival
      break;

    case SubmissionStatus.RECEIVED:
      // Ready to start grading
      break;

    case SubmissionStatus.GRADING:
      if (!context.allItemsGraded) {
        blockers.push(
          `${context.itemsCount - context.gradedItemsCount} items still need grading`
        );
      }
      break;

    case SubmissionStatus.PENDING_APPROVAL:
      // Waiting for customer/merchant approval
      break;

    case SubmissionStatus.APPROVED:
      // Waiting for payout to complete
      break;
  }

  return {
    canProceed: blockers.length === 0,
    blockers,
  };
}

/**
 * Get recommended next action for a submission
 */
export function getRecommendedAction(
  context: SubmissionContext
): { action: string; targetStatus?: SubmissionStatusType } | null {
  switch (context.currentStatus) {
    case SubmissionStatus.DRAFT:
      return context.itemsCount > 0
        ? { action: "Submit for review", targetStatus: SubmissionStatus.SUBMITTED }
        : { action: "Add items to submission" };

    case SubmissionStatus.SUBMITTED:
      return {
        action: "Mark as received or in transit",
        targetStatus: SubmissionStatus.RECEIVED,
      };

    case SubmissionStatus.IN_TRANSIT:
      return {
        action: "Mark as received when package arrives",
        targetStatus: SubmissionStatus.RECEIVED,
      };

    case SubmissionStatus.RECEIVED:
      return {
        action: "Start grading items",
        targetStatus: SubmissionStatus.GRADING,
      };

    case SubmissionStatus.GRADING:
      if (context.allItemsGraded) {
        return context.requiresApproval
          ? {
              action: "Send for customer approval",
              targetStatus: SubmissionStatus.PENDING_APPROVAL,
            }
          : { action: "Approve submission", targetStatus: SubmissionStatus.APPROVED };
      }
      return { action: `Grade remaining ${context.itemsCount - context.gradedItemsCount} items` };

    case SubmissionStatus.PENDING_APPROVAL:
      return { action: "Waiting for customer response" };

    case SubmissionStatus.APPROVED:
      return {
        action: "Process payout",
        targetStatus: SubmissionStatus.COMPLETED,
      };

    default:
      return null;
  }
}

// ============================================================================
// WORKFLOW HISTORY
// ============================================================================

export interface WorkflowHistoryEntry {
  fromStatus: SubmissionStatusType;
  toStatus: SubmissionStatusType;
  timestamp: Date;
  actor: string;
  reason?: string;
}

/**
 * Build a readable workflow timeline
 */
export function buildWorkflowTimeline(
  history: WorkflowHistoryEntry[]
): Array<{
  status: SubmissionStatusType;
  timestamp: Date;
  duration?: number; // milliseconds
  actor: string;
}> {
  const timeline: Array<{
    status: SubmissionStatusType;
    timestamp: Date;
    duration?: number;
    actor: string;
  }> = [];

  for (let i = 0; i < history.length; i++) {
    const entry = history[i];
    const nextEntry = history[i + 1];

    timeline.push({
      status: entry.toStatus,
      timestamp: entry.timestamp,
      duration: nextEntry
        ? nextEntry.timestamp.getTime() - entry.timestamp.getTime()
        : undefined,
      actor: entry.actor,
    });
  }

  return timeline;
}

/**
 * Calculate average time in each status (for analytics)
 */
export function calculateAverageStatusDurations(
  histories: WorkflowHistoryEntry[][]
): Map<SubmissionStatusType, number> {
  const durations = new Map<SubmissionStatusType, number[]>();

  for (const history of histories) {
    const timeline = buildWorkflowTimeline(history);
    for (const entry of timeline) {
      if (entry.duration !== undefined) {
        const existing = durations.get(entry.status) ?? [];
        existing.push(entry.duration);
        durations.set(entry.status, existing);
      }
    }
  }

  const averages = new Map<SubmissionStatusType, number>();
  for (const [status, times] of durations) {
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    averages.set(status, avg);
  }

  return averages;
}

// ============================================================================
// SIDE EFFECT EXECUTOR
// ============================================================================

import prisma from "../db.server";

export interface ExecuteTransitionOptions {
  submissionId: string;
  targetStatus: SubmissionStatusType;
  actorType: "CUSTOMER" | "MERCHANT" | "SYSTEM";
  actorId?: string;
  reason?: string;
  shop?: string;
}

export interface ExecuteTransitionResult {
  success: boolean;
  submission?: {
    id: string;
    submissionNumber: string;
    status: string;
    [key: string]: unknown;
  };
  error?: string;
  sideEffectsExecuted?: string[];
}

/**
 * Execute a status transition with full validation and side effects
 * This is the main entry point for routes to use
 */
export async function executeTransition(
  options: ExecuteTransitionOptions
): Promise<ExecuteTransitionResult> {
  const { submissionId, targetStatus, actorType, actorId, reason, shop } = options;

  return withTrace("workflow.transition", {
    submissionId,
    targetStatus,
    actorType,
  }, async (trace) => {
    // Fetch current submission state
    trace.log("Fetching submission state");
    const submission = await prisma.tradeInSubmission.findUnique({
      where: { id: submissionId },
      include: {
        items: true,
        customer: true,
      },
    });

    if (!submission) {
      trace.setResult("error");
      trace.addAttribute("error", "not_found");
      return { success: false, error: "Submission not found" };
    }

    trace.addAttribute("currentStatus", submission.status);
    trace.addAttribute("submissionNumber", submission.submissionNumber);

    // Build context for workflow validation
    const gradedStatuses: string[] = [ItemStatus.VERIFIED, ItemStatus.ADJUSTED, ItemStatus.REJECTED];
    const gradedItemsCount = submission.items.filter((item) =>
      gradedStatuses.includes(item.status)
    ).length;

    const context: SubmissionContext = {
      currentStatus: submission.status as SubmissionStatusType,
      itemsCount: submission.items.length,
      gradedItemsCount,
      totalValue: submission.finalTotal ?? submission.quotedTotal ?? 0,
      requiresApproval: (submission.finalTotal ?? submission.quotedTotal ?? 0) >= 5000, // £50 threshold
      hasTrackingNumber: !!submission.trackingNumber,
      allItemsGraded: gradedItemsCount === submission.items.length,
    };

    // Validate transition
    trace.log("Validating transition");
    const transitionResult = attemptTransition(
      context,
      targetStatus,
      actorType === "SYSTEM"
    );

    if (!transitionResult.allowed) {
      trace.setResult("error");
      trace.addAttribute("error", "transition_not_allowed");
      logger.info("Transition rejected", {
        submissionId,
        from: submission.status,
        to: targetStatus,
        reason: transitionResult.reason,
      }, trace.traceId);
      return {
        success: false,
        error: transitionResult.reason ?? "Transition not allowed",
      };
    }

    // Execute the transition and side effects in a transaction
    const executedEffects: string[] = [];

    try {
      trace.log("Executing transition in transaction");
      const result = await withDbRetry(
        () => prisma.$transaction(async (tx) => {
        // Build update data based on side effects
        const updateData: Record<string, unknown> = {
          status: targetStatus,
        };

        // Process timestamp updates
        for (const effect of transitionResult.sideEffects ?? []) {
          if (effect.type === "UPDATE_TIMESTAMP") {
            const field = effect.payload.field as string;
            updateData[field] = new Date();
            executedEffects.push(`UPDATE_TIMESTAMP:${field}`);
          }
        }

        // Update submission
        const updated = await tx.tradeInSubmission.update({
          where: { id: submissionId },
          data: updateData,
        });

        // Process note creation
        for (const effect of transitionResult.sideEffects ?? []) {
          if (effect.type === "CREATE_NOTE") {
            await tx.submissionNote.create({
              data: {
                submissionId,
                authorType: effect.payload.authorType as string,
                message: reason
                  ? `${effect.payload.message}. Reason: ${reason}`
                  : (effect.payload.message as string),
                isInternal: effect.payload.isInternal as boolean,
              },
            });
            executedEffects.push("CREATE_NOTE");
          }
        }

        return updated;
      }),
        { label: "workflow-transition", maxRetries: 3 }
      );

      // Process async side effects outside transaction (notifications, payouts)
      trace.log("Processing async side effects");
      for (const effect of transitionResult.sideEffects ?? []) {
        try {
          if (effect.type === "SEND_NOTIFICATION") {
            await executeNotification(submission, effect.payload, shop);
            executedEffects.push(`SEND_NOTIFICATION:${effect.payload.type}`);
          } else if (effect.type === "TRIGGER_PAYOUT" && shop) {
            await executePayout(submissionId, shop, trace.traceId);
            executedEffects.push("TRIGGER_PAYOUT");
          }
        } catch (effectError) {
          // Log but don't fail the transition for async effects
          const errorMsg = effectError instanceof Error ? effectError.message : String(effectError);
          logger.error("Side effect failed", {
            effectType: effect.type,
            submissionId,
            error: errorMsg,
          }, trace.traceId);
          executedEffects.push(`${effect.type}:FAILED`);
        }
      }

      // Record success metrics
      metrics.increment(`workflow.transition.${targetStatus.toLowerCase()}`);
      metrics.increment(`workflow.transition.success`);
      trace.setResult("success");

      logger.info("Transition completed", {
        submissionId,
        from: submission.status,
        to: targetStatus,
        effectsExecuted: executedEffects.length,
      }, trace.traceId);

      return {
        success: true,
        submission: {
          id: result.id,
          submissionNumber: result.submissionNumber,
          status: result.status,
          approvedAt: result.approvedAt?.toISOString(),
          completedAt: result.completedAt?.toISOString(),
        },
        sideEffectsExecuted: executedEffects,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error("Transition transaction failed", {
        submissionId,
        targetStatus,
        error: errorMsg,
      }, trace.traceId);
      trace.setResult("error");
      metrics.increment("workflow.transition.error");
      return {
        success: false,
        error: errorMsg,
      };
    }
  });
}

/**
 * Execute notification side effect
 */
async function executeNotification(
  submission: {
    id: string;
    submissionNumber: string;
    customer: { email: string; firstName?: string | null } | null;
    items: unknown[];
    quotedTotal: number | null;
    finalTotal: number | null;
  },
  payload: Record<string, unknown>,
  shop?: string
): Promise<void> {
  const { type, to } = payload;

  // Import notifications dynamically to avoid circular deps
  const notifications = await import("./notifications.server");

  switch (type) {
    case "submission_received":
      if (to === "merchant") {
        // Merchant notification - could be implemented
        logger.debug("Merchant notification for new submission", {
          submissionNumber: submission.submissionNumber,
        });
      }
      break;

    case "package_received":
      if (submission.customer?.email) {
        // Use sendSubmissionReceivedNotification for package received
        await notifications.sendSubmissionReceivedNotification?.(submission as never);
      }
      break;

    case "grading_complete":
      if (submission.customer?.email) {
        await notifications.sendGradingCompleteNotification?.(submission as never);
      }
      break;

    case "payout_complete":
      if (submission.customer?.email) {
        // Use sendPayoutIssuedNotification for payout complete
        const payoutInfo = {
          totalAmount: submission.finalTotal ?? submission.quotedTotal ?? 0,
        };
        await notifications.sendPayoutIssuedNotification?.(submission as never, payoutInfo);
      }
      break;

    case "submission_cancelled":
      // Cancellation notification not implemented yet
      logger.debug("Cancellation notification requested", {
        submissionNumber: submission.submissionNumber,
      });
      break;

    case "items_returned":
      if (submission.customer?.email) {
        await notifications.sendReturnRequestedNotification?.(submission as never, "Your cards are being returned.");
      }
      break;

    default:
      logger.warn("Unknown notification type", { type: String(type) });
  }
}

/**
 * Execute payout side effect
 */
async function executePayout(submissionId: string, shop: string, traceId?: string): Promise<void> {
  const payouts = await import("./payouts.server");

  const result = await payouts.createPayout(shop, submissionId);

  if (!result.success) {
    logger.error("Payout creation failed", {
      submissionId,
      error: result.error,
    }, traceId);
    throw new Error(result.error ?? "Payout creation failed");
  }

  logger.info("Payout created", { submissionId }, traceId);
}
