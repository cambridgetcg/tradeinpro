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
 */

import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  requireCustomer,
  jsonResponse,
  errorResponse,
  sanitizeString,
} from "../lib/app-proxy.server";
import prisma from "../db.server";
import { SubmissionStatus } from "../lib/constants";

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
        return handleAccept(submission);

      case "reject":
        return handleReject(submission, reason);

      case "cancel":
        return handleCancel(submission, reason);

      case "update_tracking":
        return handleUpdateTracking(submission, trackingNumber);

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
  submission: { id: string; submissionNumber: string; status: string }
): Promise<Response> {
  // Validate status
  if (submission.status !== SubmissionStatus.PENDING_APPROVAL) {
    return errorResponse(
      400,
      "invalid_status",
      "Can only accept offers for submissions pending approval"
    );
  }

  // Update to APPROVED
  const updated = await prisma.tradeInSubmission.update({
    where: { id: submission.id },
    data: {
      status: SubmissionStatus.APPROVED,
      approvedAt: new Date(),
    },
  });

  // Add note
  await prisma.submissionNote.create({
    data: {
      submissionId: submission.id,
      authorType: "CUSTOMER",
      message: "Customer accepted the grading offer",
      isInternal: false,
    },
  });

  // TODO: Trigger payout creation and email notification

  const response: ActionResponse = {
    success: true,
    message: "Offer accepted! Your payment will be processed shortly.",
    submission: {
      submissionNumber: updated.submissionNumber,
      status: updated.status,
      statusLabel: "Approved",
    },
  };

  return jsonResponse(response);
}

async function handleReject(
  submission: { id: string; submissionNumber: string; status: string },
  reason?: string
): Promise<Response> {
  // Validate status
  if (submission.status !== SubmissionStatus.PENDING_APPROVAL) {
    return errorResponse(
      400,
      "invalid_status",
      "Can only reject offers for submissions pending approval"
    );
  }

  // Update to RETURNED
  const updated = await prisma.tradeInSubmission.update({
    where: { id: submission.id },
    data: {
      status: SubmissionStatus.RETURNED,
    },
  });

  // Add note
  await prisma.submissionNote.create({
    data: {
      submissionId: submission.id,
      authorType: "CUSTOMER",
      message: reason
        ? `Customer rejected the offer and requested return. Reason: ${sanitizeString(reason, 500)}`
        : "Customer rejected the offer and requested return",
      isInternal: false,
    },
  });

  // TODO: Trigger return process and email notification

  const response: ActionResponse = {
    success: true,
    message: "Return requested. We will ship your cards back to you.",
    submission: {
      submissionNumber: updated.submissionNumber,
      status: updated.status,
      statusLabel: "Returned",
    },
  };

  return jsonResponse(response);
}

async function handleCancel(
  submission: { id: string; submissionNumber: string; status: string },
  reason?: string
): Promise<Response> {
  // Validate status - can only cancel before shipping
  const cancellableStatuses = [SubmissionStatus.DRAFT, SubmissionStatus.SUBMITTED];

  if (!cancellableStatuses.includes(submission.status as typeof SubmissionStatus.DRAFT)) {
    return errorResponse(
      400,
      "invalid_status",
      "Can only cancel submissions that haven't been shipped yet"
    );
  }

  // Update to CANCELLED
  const updated = await prisma.tradeInSubmission.update({
    where: { id: submission.id },
    data: {
      status: SubmissionStatus.CANCELLED,
    },
  });

  // Add note
  await prisma.submissionNote.create({
    data: {
      submissionId: submission.id,
      authorType: "CUSTOMER",
      message: reason
        ? `Customer cancelled submission. Reason: ${sanitizeString(reason, 500)}`
        : "Customer cancelled submission",
      isInternal: false,
    },
  });

  const response: ActionResponse = {
    success: true,
    message: "Submission cancelled successfully.",
    submission: {
      submissionNumber: updated.submissionNumber,
      status: updated.status,
      statusLabel: "Cancelled",
    },
  };

  return jsonResponse(response);
}

async function handleUpdateTracking(
  submission: { id: string; submissionNumber: string; status: string },
  trackingNumber?: string
): Promise<Response> {
  // Validate status
  const trackableStatuses = [SubmissionStatus.SUBMITTED, SubmissionStatus.IN_TRANSIT];

  if (!trackableStatuses.includes(submission.status as typeof SubmissionStatus.SUBMITTED)) {
    return errorResponse(
      400,
      "invalid_status",
      "Can only update tracking for submissions awaiting shipment"
    );
  }

  const sanitizedTracking = trackingNumber
    ? sanitizeString(trackingNumber, 100).toUpperCase()
    : null;

  // Update tracking number and status
  const newStatus =
    sanitizedTracking && submission.status === SubmissionStatus.SUBMITTED
      ? SubmissionStatus.IN_TRANSIT
      : submission.status;

  const updated = await prisma.tradeInSubmission.update({
    where: { id: submission.id },
    data: {
      trackingNumber: sanitizedTracking,
      status: newStatus,
    },
  });

  // Add note if tracking was added
  if (sanitizedTracking) {
    await prisma.submissionNote.create({
      data: {
        submissionId: submission.id,
        authorType: "CUSTOMER",
        message: `Customer added tracking number: ${sanitizedTracking}`,
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
      statusLabel: newStatus === SubmissionStatus.IN_TRANSIT ? "In Transit" : "Submitted",
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
