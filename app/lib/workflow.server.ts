/**
 * Workflow State Machine for Trade-In Submissions
 * Handles status transitions with validation and business rules
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
