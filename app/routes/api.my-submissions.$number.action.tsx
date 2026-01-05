/**
 * Customer Submission Actions API
 *
 * POST /apps/trade-in/my-submissions/:number/action
 *
 * Allows customers to:
 * - Accept grading offer (from PENDING_APPROVAL)
 * - Reject grading and request return (from PENDING_APPROVAL)
 * - Cancel submission (from SUBMITTED/DRAFT)
 * - Update tracking number (from SUBMITTED/IN_TRANSIT)
 *
 * @synapse ROUTES_SYNAPSE.md - Uses workflow.server.ts for transition validation
 */

import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  requireCustomer,
  jsonResponse,
  errorResponse,
  sanitizeString,
} from "../lib/app-proxy.server";
import prisma from "../db.server";
import { SubmissionStatus, SubmissionStatusLabels, type SubmissionStatusType } from "../lib/constants";
import { executeTransition, isValidTransition } from "../lib/workflow.server";

// ============================================================================
// Types
// ============================================================================

interface ActionRequest {
  action: "accept" | "reject" | "cancel" | "update_tracking";
  trackingNumber?: string;
  reason?: string;
}

interface ActionResponse {
  success: boolean;
  message: string;
  submission?: {
    submissionNumber: string;
    status: string;
    statusLabel: string;
  };
}

// ============================================================================
// Action Handler
// ============================================================================

export async function action({ request, params }: ActionFunctionArgs) {
  const submissionNumber = sanitizeString(params.number || "", 30).toUpperCase();

  if (!submissionNumber) {
    return errorResponse(400, "invalid_number", "Submission number is required");
  }

  if (request.method !== "POST") {
    return errorResponse(405, "method_not_allowed", "Only POST requests are supported");
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

  // Parse request body
  let body: ActionRequest;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "invalid_body", "Invalid JSON body");
  }

  const { action: actionType, trackingNumber, reason } = body;

  if (!actionType) {
    return errorResponse(400, "missing_action", "Action is required");
  }

  try {
    // Fetch submission with ownership verification
    const submission = await prisma.tradeInSubmission.findFirst({
      where: {
        submissionNumber,
        customerId: context.internalCustomerId,
      },
    });

    if (!submission) {
      return errorResponse(
        404,
        "not_found",
        "Submission not found or you don't have access to it"
      );
    }

    // Handle each action type
    switch (actionType) {
      case "accept":
        return handleAccept(submission, context.shop, context.internalCustomerId);

      case "reject":
        return handleReject(submission, reason, context.internalCustomerId);

      case "cancel":
        return handleCancel(submission, reason, context.internalCustomerId);

      case "update_tracking":
        return handleUpdateTracking(submission, trackingNumber, context.internalCustomerId);

      default:
        return errorResponse(400, "invalid_action", `Unknown action: ${actionType}`);
    }
  } catch (error) {
    console.error("Error processing action:", error);
    return errorResponse(500, "action_failed", "Failed to process action");
  }
}

// ============================================================================
// Action Handlers
// ============================================================================

async function handleAccept(
  submission: { id: string; submissionNumber: string; status: string },
  shop: string,
  customerId: string
): Promise<Response> {
  // Use workflow engine for transition validation and execution
  const result = await executeTransition({
    submissionId: submission.id,
    targetStatus: SubmissionStatus.APPROVED,
    actorType: "CUSTOMER",
    actorId: customerId,
    reason: "Customer accepted the grading offer",
    shop,
  });

  if (!result.success) {
    return errorResponse(
      400,
      "transition_failed",
      result.error || "Cannot accept offer in current state"
    );
  }

  const response: ActionResponse = {
    success: true,
    message: "Offer accepted! Your payment will be processed shortly.",
    submission: {
      submissionNumber: submission.submissionNumber,
      status: SubmissionStatus.APPROVED,
      statusLabel: SubmissionStatusLabels[SubmissionStatus.APPROVED],
    },
  };

  return jsonResponse(response);
}

async function handleReject(
  submission: { id: string; submissionNumber: string; status: string },
  reason: string | undefined,
  customerId: string
): Promise<Response> {
  const sanitizedReason = reason ? sanitizeString(reason, 500) : undefined;

  // Use workflow engine for transition validation and execution
  const result = await executeTransition({
    submissionId: submission.id,
    targetStatus: SubmissionStatus.RETURNED,
    actorType: "CUSTOMER",
    actorId: customerId,
    reason: sanitizedReason
      ? `Customer rejected offer: ${sanitizedReason}`
      : "Customer rejected offer and requested return",
  });

  if (!result.success) {
    return errorResponse(
      400,
      "transition_failed",
      result.error || "Cannot reject offer in current state"
    );
  }

  const response: ActionResponse = {
    success: true,
    message: "Return requested. We will ship your cards back to you.",
    submission: {
      submissionNumber: submission.submissionNumber,
      status: SubmissionStatus.RETURNED,
      statusLabel: SubmissionStatusLabels[SubmissionStatus.RETURNED],
    },
  };

  return jsonResponse(response);
}

async function handleCancel(
  submission: { id: string; submissionNumber: string; status: string },
  reason: string | undefined,
  customerId: string
): Promise<Response> {
  const sanitizedReason = reason ? sanitizeString(reason, 500) : undefined;

  // Use workflow engine for transition validation and execution
  const result = await executeTransition({
    submissionId: submission.id,
    targetStatus: SubmissionStatus.CANCELLED,
    actorType: "CUSTOMER",
    actorId: customerId,
    reason: sanitizedReason
      ? `Customer cancelled: ${sanitizedReason}`
      : "Customer cancelled submission",
  });

  if (!result.success) {
    return errorResponse(
      400,
      "transition_failed",
      result.error || "Cannot cancel submission in current state"
    );
  }

  const response: ActionResponse = {
    success: true,
    message: "Submission cancelled successfully.",
    submission: {
      submissionNumber: submission.submissionNumber,
      status: SubmissionStatus.CANCELLED,
      statusLabel: SubmissionStatusLabels[SubmissionStatus.CANCELLED],
    },
  };

  return jsonResponse(response);
}

async function handleUpdateTracking(
  submission: { id: string; submissionNumber: string; status: string },
  trackingNumber: string | undefined,
  customerId: string
): Promise<Response> {
  const currentStatus = submission.status as SubmissionStatusType;
  const trackableStatuses: SubmissionStatusType[] = [
    SubmissionStatus.SUBMITTED,
    SubmissionStatus.IN_TRANSIT,
  ];

  // Validate current status allows tracking updates
  if (!trackableStatuses.includes(currentStatus)) {
    return errorResponse(
      400,
      "invalid_status",
      "Can only update tracking for submissions awaiting shipment"
    );
  }

  const sanitizedTracking = trackingNumber
    ? sanitizeString(trackingNumber, 100).toUpperCase()
    : null;

  // Determine if we need a status transition
  const needsTransition =
    sanitizedTracking && currentStatus === SubmissionStatus.SUBMITTED;
  const newStatus = needsTransition ? SubmissionStatus.IN_TRANSIT : currentStatus;

  // If transitioning, validate via workflow
  if (needsTransition) {
    if (!isValidTransition(currentStatus, SubmissionStatus.IN_TRANSIT)) {
      return errorResponse(
        400,
        "transition_failed",
        "Cannot transition to IN_TRANSIT from current state"
      );
    }
  }

  // Update tracking number and status
  const updated = await prisma.tradeInSubmission.update({
    where: { id: submission.id },
    data: {
      trackingNumber: sanitizedTracking,
      status: newStatus,
    },
  });

  // Add note if tracking was added/updated
  if (sanitizedTracking) {
    await prisma.submissionNote.create({
      data: {
        submissionId: submission.id,
        authorType: "CUSTOMER",
        message: needsTransition
          ? `Customer added tracking number: ${sanitizedTracking}. Status changed to In Transit.`
          : `Customer updated tracking number: ${sanitizedTracking}`,
        isInternal: false,
      },
    });
  }

  const response: ActionResponse = {
    success: true,
    message: sanitizedTracking
      ? "Tracking number updated successfully."
      : "Tracking number removed.",
    submission: {
      submissionNumber: updated.submissionNumber,
      status: updated.status,
      statusLabel: SubmissionStatusLabels[newStatus],
    },
  };

  return jsonResponse(response);
}

// ============================================================================
// Loader (GET not supported)
// ============================================================================

export async function loader({ request }: LoaderFunctionArgs) {
  return errorResponse(405, "method_not_allowed", "Use POST to perform actions");
}
