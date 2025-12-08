/**
 * Public Tracking Page API
 *
 * GET /apps/trade-in/track?number=TI-XXXX-XXXXXX
 *
 * Public endpoint for customers to track their submissions.
 * Returns full tracking details including timeline, items, and grading results.
 */

import type { LoaderFunctionArgs } from "react-router";
import {
  validateAppProxy,
  jsonResponse,
  errorResponse,
  sanitizeString,
} from "../lib/app-proxy.server";
import prisma from "../db.server";

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

interface TrackingItem {
  cardName: string;
  setCode: string | null;
  variant: string | null;
  quantity: number;
  conditionClaimed: string;
  conditionActual: string | null;
  quotedPrice: number;
  finalPrice: number | null;
  status: string;
  adjustmentReason: string | null;
}

interface TrackingResponse {
  found: boolean;
  submission: {
    submissionNumber: string;
    status: string;
    statusLabel: string;
    statusDescription: string;
    shippingMethod: string | null;
    trackingNumber: string | null;
    payoutType: string;
    quotedTotal: number;
    finalTotal: number | null;
    bonusAmount: number | null;
    itemCount: number;
    createdAt: string;
    submittedAt: string | null;
    receivedAt: string | null;
    gradedAt: string | null;
    approvedAt: string | null;
    completedAt: string | null;
  };
  timeline: TimelineStep[];
  items: TrackingItem[];
  // Only show if grading is complete
  gradingResults: {
    hasAdjustments: boolean;
    adjustedItemCount: number;
    originalTotal: number;
    adjustedTotal: number;
    canAccept: boolean;
    canReject: boolean;
  } | null;
}

// ============================================================================
// Status Labels and Descriptions
// ============================================================================

const STATUS_INFO: Record<string, { label: string; description: string }> = {
  DRAFT: {
    label: "Draft",
    description: "Your submission is being prepared",
  },
  SUBMITTED: {
    label: "Submitted",
    description: "Waiting for your cards to arrive",
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
    description: "Grading complete - please review the results",
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

export async function loader({ request }: LoaderFunctionArgs) {
  // Validate App Proxy (but don't require customer login)
  const context = validateAppProxy(request);
  if (!context.isValid && process.env.NODE_ENV === "production") {
    return errorResponse(401, "unauthorized", "Invalid request signature");
  }

  const url = new URL(request.url);
  const number = sanitizeString(url.searchParams.get("number") || "", 50);

  if (!number) {
    return jsonResponse({
      found: false,
      error: "Please enter a submission number",
    });
  }

  try {
    const submission = await prisma.tradeInSubmission.findUnique({
      where: { submissionNumber: number.toUpperCase() },
      include: {
        items: {
          select: {
            cardName: true,
            setCode: true,
            variant: true,
            quantity: true,
            conditionClaimed: true,
            conditionActual: true,
            quotedPrice: true,
            finalPrice: true,
            status: true,
            adjustmentReason: true,
          },
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
      return jsonResponse({
        found: false,
        error: "Submission not found. Please check your reference number.",
      });
    }

    // Build timeline
    const currentStatusIndex = TIMELINE_ORDER.indexOf(submission.status);
    const timeline: TimelineStep[] = TIMELINE_ORDER.map((status, index) => {
      const info = STATUS_INFO[status];
      let completedAt: string | null = null;

      // Get completion timestamp for each status
      switch (status) {
        case "SUBMITTED":
          completedAt = submission.submittedAt?.toISOString() || null;
          break;
        case "RECEIVED":
          completedAt = submission.receivedAt?.toISOString() || null;
          break;
        case "GRADING":
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
    const items: TrackingItem[] = submission.items.map((item) => ({
      cardName: item.cardName,
      setCode: item.setCode,
      variant: item.variant,
      quantity: item.quantity,
      conditionClaimed: item.conditionClaimed,
      conditionActual: item.conditionActual,
      quotedPrice: item.quotedPrice,
      finalPrice: item.finalPrice,
      status: item.status,
      adjustmentReason: item.adjustmentReason,
    }));

    // Calculate grading results if applicable
    let gradingResults = null;
    if (
      submission.status === "PENDING_APPROVAL" ||
      submission.status === "APPROVED" ||
      submission.status === "COMPLETED"
    ) {
      const adjustedItems = items.filter(
        (item) => item.status === "ADJUSTED" || item.status === "REJECTED"
      );
      const originalTotal = items.reduce(
        (sum, item) => sum + item.quotedPrice * item.quantity,
        0
      );
      const adjustedTotal = items.reduce(
        (sum, item) =>
          sum +
          (item.finalPrice !== null ? item.finalPrice : item.quotedPrice) *
            item.quantity,
        0
      );

      gradingResults = {
        hasAdjustments: adjustedItems.length > 0,
        adjustedItemCount: adjustedItems.length,
        originalTotal,
        adjustedTotal,
        canAccept: submission.status === "PENDING_APPROVAL",
        canReject: submission.status === "PENDING_APPROVAL",
      };
    }

    const statusInfo = STATUS_INFO[submission.status] || {
      label: submission.status,
      description: "",
    };

    const response: TrackingResponse = {
      found: true,
      submission: {
        submissionNumber: submission.submissionNumber,
        status: submission.status,
        statusLabel: statusInfo.label,
        statusDescription: statusInfo.description,
        shippingMethod: submission.shippingMethod,
        trackingNumber: submission.trackingNumber,
        payoutType: submission.payoutType,
        quotedTotal: submission.quotedTotal,
        finalTotal: submission.finalTotal,
        bonusAmount: submission.bonusAmount,
        itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
        createdAt: submission.createdAt.toISOString(),
        submittedAt: submission.submittedAt?.toISOString() || null,
        receivedAt: submission.receivedAt?.toISOString() || null,
        gradedAt: submission.gradedAt?.toISOString() || null,
        approvedAt: submission.approvedAt?.toISOString() || null,
        completedAt: submission.completedAt?.toISOString() || null,
      },
      timeline,
      items,
      gradingResults,
    };

    return jsonResponse(response);
  } catch (error) {
    console.error("Tracking lookup error:", error);
    return errorResponse(
      500,
      "lookup_failed",
      "An error occurred while looking up your submission"
    );
  }
}

// Only GET is supported
export async function action() {
  return errorResponse(405, "method_not_allowed", "Only GET requests are supported");
}
