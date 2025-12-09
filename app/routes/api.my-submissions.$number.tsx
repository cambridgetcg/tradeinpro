/**
 * Customer Submission Detail API
 *
 * GET /apps/trade-in/my-submissions/:number
 *
 * Returns detailed information about a single submission.
 * Verifies the submission belongs to the logged-in customer.
 */

import type { LoaderFunctionArgs } from "react-router";
import {
  requireCustomer,
  jsonResponse,
  errorResponse,
  sanitizeString,
} from "../lib/app-proxy.server";
import prisma from "../db.server";
import {
  SubmissionStatus,
  SubmissionStatusLabels,
  ItemStatus,
  ConditionLabels,
  type ConditionType,
} from "../lib/constants";

// ============================================================================
// Types
// ============================================================================

interface TimelineStep {
  status: string;
  label: string;
  description: string;
  completedAt: string | null;
  isComplete: boolean;
  isCurrent: boolean;
}

interface ItemDetail {
  id: string;
  cardName: string;
  setName: string;
  setCode: string | null;
  variant: string | null;
  quantity: number;
  conditionClaimed: string;
  conditionClaimedLabel: string;
  conditionActual: string | null;
  conditionActualLabel: string | null;
  quotedPrice: number;
  finalPrice: number | null;
  status: string;
  statusLabel: string;
  adjustmentReason: string | null;
  wasAdjusted: boolean;
}

interface GradingResults {
  hasAdjustments: boolean;
  adjustedItemCount: number;
  rejectedItemCount: number;
  originalTotal: number;
  adjustedTotal: number;
  difference: number;
}

interface SubmissionDetailResponse {
  submission: {
    id: string;
    submissionNumber: string;
    status: string;
    statusLabel: string;
    statusDescription: string;
    payoutType: string;
    payoutTypeLabel: string;
    shippingMethod: string | null;
    trackingNumber: string | null;
    quotedTotal: number;
    finalTotal: number | null;
    bonusAmount: number | null;
    totalPayout: number;
    itemCount: number;
    createdAt: string;
    submittedAt: string | null;
    receivedAt: string | null;
    gradedAt: string | null;
    approvedAt: string | null;
    completedAt: string | null;
  };
  items: ItemDetail[];
  timeline: TimelineStep[];
  gradingResults: GradingResults | null;
  actions: {
    canDownloadPackingSlip: boolean;
    canViewShippingInstructions: boolean;
    canAcceptOffer: boolean;
    canRejectOffer: boolean;
    canCancel: boolean;
    canUpdateTracking: boolean;
  };
}

// ============================================================================
// Constants
// ============================================================================

const STATUS_INFO: Record<string, { label: string; description: string }> = {
  DRAFT: {
    label: "Draft",
    description: "Your submission is being prepared",
  },
  SUBMITTED: {
    label: "Submitted",
    description: "Please send your cards to us. Check the shipping instructions for our address.",
  },
  IN_TRANSIT: {
    label: "In Transit",
    description: "Your package is on its way to us",
  },
  RECEIVED: {
    label: "Received",
    description: "We have your cards and will begin grading soon",
  },
  GRADING: {
    label: "Grading",
    description: "Our team is verifying your cards",
  },
  PENDING_APPROVAL: {
    label: "Review Required",
    description: "Grading complete - please review and accept or reject the offer",
  },
  APPROVED: {
    label: "Approved",
    description: "Processing your payment",
  },
  COMPLETED: {
    label: "Complete",
    description: "Payment sent! Thank you for trading with us",
  },
  CANCELLED: {
    label: "Cancelled",
    description: "This submission was cancelled",
  },
  RETURNED: {
    label: "Returned",
    description: "Your cards have been returned",
  },
};

const ITEM_STATUS_LABELS: Record<string, string> = {
  PENDING: "Pending Review",
  VERIFIED: "Verified",
  ADJUSTED: "Adjusted",
  REJECTED: "Rejected",
};

const PAYOUT_TYPE_LABELS: Record<string, string> = {
  STORE_CREDIT: "Store Credit (+10% bonus)",
  BANK: "Bank Transfer",
};

const TIMELINE_ORDER = [
  "SUBMITTED",
  "IN_TRANSIT",
  "RECEIVED",
  "GRADING",
  "PENDING_APPROVAL",
  "APPROVED",
  "COMPLETED",
];

// ============================================================================
// Loader
// ============================================================================

export async function loader({ request, params }: LoaderFunctionArgs) {
  const submissionNumber = sanitizeString(params.number || "", 30).toUpperCase();

  if (!submissionNumber) {
    return errorResponse(400, "invalid_number", "Submission number is required");
  }

  // Require logged-in customer
  let context;
  try {
    context = await requireCustomer(request);
  } catch (response) {
    // In development, allow bypassing auth for testing
    if (process.env.NODE_ENV !== "production") {
      const url = new URL(request.url);
      const testCustomerId = url.searchParams.get("_test_customer_id");
      if (testCustomerId) {
        const customer = await prisma.customer.findUnique({
          where: { id: testCustomerId },
        });
        if (customer) {
          context = {
            isValid: true,
            shop: "test",
            customerId: customer.shopifyCustomerId || "test",
            internalCustomerId: customer.id,
            locale: "en",
            timestamp: "",
            path_prefix: "",
          };
        }
      }
    }
    if (!context) {
      return response as Response;
    }
  }

  try {
    // Fetch submission with ownership verification
    const submission = await prisma.tradeInSubmission.findFirst({
      where: {
        submissionNumber,
        customerId: context.internalCustomerId,
      },
      include: {
        items: {
          orderBy: { createdAt: "asc" },
        },
        payout: {
          select: {
            status: true,
            type: true,
            totalAmount: true,
            processedAt: true,
          },
        },
      },
    });

    if (!submission) {
      return errorResponse(
        404,
        "not_found",
        "Submission not found or you don't have access to it"
      );
    }

    // Build timeline
    const currentStatusIndex = TIMELINE_ORDER.indexOf(submission.status);
    const timeline: TimelineStep[] = TIMELINE_ORDER.map((status, index) => {
      const info = STATUS_INFO[status];
      let completedAt: string | null = null;

      switch (status) {
        case "SUBMITTED":
          completedAt = submission.submittedAt?.toISOString() || null;
          break;
        case "RECEIVED":
          completedAt = submission.receivedAt?.toISOString() || null;
          break;
        case "GRADING":
        case "PENDING_APPROVAL":
          completedAt = submission.gradedAt?.toISOString() || null;
          break;
        case "APPROVED":
          completedAt = submission.approvedAt?.toISOString() || null;
          break;
        case "COMPLETED":
          completedAt = submission.completedAt?.toISOString() || null;
          break;
      }

      return {
        status,
        label: info.label,
        description: info.description,
        completedAt,
        isComplete: index < currentStatusIndex || submission.status === status,
        isCurrent: submission.status === status,
      };
    });

    // Format items
    const items: ItemDetail[] = submission.items.map((item) => ({
      id: item.id,
      cardName: item.cardName,
      setName: item.setName,
      setCode: item.setCode,
      variant: item.variant,
      quantity: item.quantity,
      conditionClaimed: item.conditionClaimed,
      conditionClaimedLabel:
        ConditionLabels[item.conditionClaimed as ConditionType] || item.conditionClaimed,
      conditionActual: item.conditionActual,
      conditionActualLabel: item.conditionActual
        ? ConditionLabels[item.conditionActual as ConditionType] || item.conditionActual
        : null,
      quotedPrice: item.quotedPrice,
      finalPrice: item.finalPrice,
      status: item.status,
      statusLabel: ITEM_STATUS_LABELS[item.status] || item.status,
      adjustmentReason: item.adjustmentReason,
      wasAdjusted:
        item.status === ItemStatus.ADJUSTED || item.status === ItemStatus.REJECTED,
    }));

    // Calculate grading results if grading is complete
    let gradingResults: GradingResults | null = null;
    if (
      submission.status === SubmissionStatus.PENDING_APPROVAL ||
      submission.status === SubmissionStatus.APPROVED ||
      submission.status === SubmissionStatus.COMPLETED
    ) {
      const adjustedItems = items.filter((item) => item.status === ItemStatus.ADJUSTED);
      const rejectedItems = items.filter((item) => item.status === ItemStatus.REJECTED);
      const originalTotal = items.reduce(
        (sum, item) => sum + item.quotedPrice,
        0
      );
      const adjustedTotal = items.reduce(
        (sum, item) => sum + (item.finalPrice ?? item.quotedPrice),
        0
      );

      gradingResults = {
        hasAdjustments: adjustedItems.length > 0 || rejectedItems.length > 0,
        adjustedItemCount: adjustedItems.length,
        rejectedItemCount: rejectedItems.length,
        originalTotal,
        adjustedTotal,
        difference: adjustedTotal - originalTotal,
      };
    }

    // Calculate total payout
    const baseTotal = submission.finalTotal ?? submission.quotedTotal;
    const bonus = submission.bonusAmount || 0;
    const totalPayout = baseTotal + bonus;

    // Determine available actions
    const actions = {
      canDownloadPackingSlip:
        submission.status === SubmissionStatus.SUBMITTED ||
        submission.status === SubmissionStatus.IN_TRANSIT,
      canViewShippingInstructions:
        submission.status === SubmissionStatus.SUBMITTED ||
        submission.status === SubmissionStatus.IN_TRANSIT,
      canAcceptOffer: submission.status === SubmissionStatus.PENDING_APPROVAL,
      canRejectOffer: submission.status === SubmissionStatus.PENDING_APPROVAL,
      canCancel:
        submission.status === SubmissionStatus.SUBMITTED ||
        submission.status === SubmissionStatus.DRAFT,
      canUpdateTracking:
        submission.status === SubmissionStatus.SUBMITTED ||
        submission.status === SubmissionStatus.IN_TRANSIT,
    };

    const statusInfo = STATUS_INFO[submission.status] || {
      label: submission.status,
      description: "",
    };

    const response: SubmissionDetailResponse = {
      submission: {
        id: submission.id,
        submissionNumber: submission.submissionNumber,
        status: submission.status,
        statusLabel: statusInfo.label,
        statusDescription: statusInfo.description,
        payoutType: submission.payoutType,
        payoutTypeLabel: PAYOUT_TYPE_LABELS[submission.payoutType] || submission.payoutType,
        shippingMethod: submission.shippingMethod,
        trackingNumber: submission.trackingNumber,
        quotedTotal: submission.quotedTotal,
        finalTotal: submission.finalTotal,
        bonusAmount: submission.bonusAmount,
        totalPayout,
        itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
        createdAt: submission.createdAt.toISOString(),
        submittedAt: submission.submittedAt?.toISOString() || null,
        receivedAt: submission.receivedAt?.toISOString() || null,
        gradedAt: submission.gradedAt?.toISOString() || null,
        approvedAt: submission.approvedAt?.toISOString() || null,
        completedAt: submission.completedAt?.toISOString() || null,
      },
      items,
      timeline,
      gradingResults,
      actions,
    };

    return jsonResponse(response);
  } catch (error) {
    console.error("Error fetching submission detail:", error);
    return errorResponse(500, "fetch_failed", "Failed to load submission details");
  }
}

// Only GET is supported
export async function action() {
  return errorResponse(405, "method_not_allowed", "Only GET requests are supported");
}
