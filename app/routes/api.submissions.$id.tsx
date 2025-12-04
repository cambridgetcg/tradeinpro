/**
 * Individual Submission API
 *
 * GET /apps/trade-in/submissions/:id     - Get submission details
 * PUT /apps/trade-in/submissions/:id     - Update submission (submit for processing)
 */

import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import {
  requireCustomer,
  requireAppProxy,
  jsonResponse,
  errorResponse,
  sanitizeString,
} from "../lib/app-proxy.server";
import {
  getSubmissionById,
  getSubmissionByNumber,
  getSubmissionStatus,
  submitSubmission,
} from "../lib/submissions.server";

// ============================================================================
// GET - Get submission details
// ============================================================================

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { id } = params;

  if (!id) {
    return errorResponse(400, "missing_id", "Submission ID is required");
  }

  const url = new URL(request.url);
  const byNumber = url.searchParams.get("by") === "number";

  // If looking up by submission number, allow public access with limited data
  if (byNumber) {
    return handlePublicLookup(request, id);
  }

  // Full access requires customer login
  const context = await requireCustomer(request);

  try {
    const submission = await getSubmissionById(id);

    if (!submission) {
      return errorResponse(404, "not_found", "Submission not found");
    }

    // Verify ownership
    if (submission.customerId !== context.internalCustomerId) {
      return errorResponse(403, "forbidden", "Not authorized to view this submission");
    }

    const status = await getSubmissionStatus(id);

    return jsonResponse({
      submission: formatFullSubmission(submission),
      status,
    });
  } catch (error) {
    console.error("Get submission error:", error);
    return errorResponse(500, "fetch_failed", "Failed to fetch submission");
  }
}

/**
 * Public lookup by submission number - returns limited data
 */
async function handlePublicLookup(request: Request, submissionNumber: string) {
  // Validate App Proxy but don't require login
  const context = requireAppProxy(request);

  // Sanitize submission number
  const sanitizedNumber = sanitizeString(submissionNumber, 50);

  try {
    const submission = await getSubmissionByNumber(sanitizedNumber);

    if (!submission) {
      return errorResponse(404, "not_found", "Submission not found");
    }

    const status = await getSubmissionStatus(submission.id);

    // Return limited public info (no items, totals, or customer data)
    return jsonResponse({
      submissionNumber: submission.submissionNumber,
      status: status?.status,
      statusLabel: status?.statusLabel,
      statusDescription: status?.statusDescription,
      timeline: status?.timeline,
      shippingMethod: submission.shippingMethod,
      // Don't expose: items, totals, customer info
    });
  } catch (error) {
    console.error("Public lookup error:", error);
    return errorResponse(500, "fetch_failed", "Failed to fetch submission");
  }
}

// ============================================================================
// PUT - Update submission (submit for processing)
// ============================================================================

export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method !== "PUT") {
    return errorResponse(405, "method_not_allowed", "Only PUT requests are supported");
  }

  const { id } = params;
  if (!id) {
    return errorResponse(400, "missing_id", "Submission ID is required");
  }

  const context = await requireCustomer(request);

  // Parse request body
  let body: { action: string };
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "invalid_json", "Request body must be valid JSON");
  }

  // Verify ownership first
  const submission = await getSubmissionById(id);
  if (!submission) {
    return errorResponse(404, "not_found", "Submission not found");
  }

  if (submission.customerId !== context.internalCustomerId) {
    return errorResponse(403, "forbidden", "Not authorized to modify this submission");
  }

  try {
    if (body.action === "submit") {
      const updated = await submitSubmission(id);

      return jsonResponse({
        success: true,
        message: "Submission submitted successfully",
        submission: formatFullSubmission(updated),
      });
    }

    return errorResponse(400, "invalid_action", "Action must be 'submit'");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Submit error:", error);

    return errorResponse(400, "submit_failed", message);
  }
}

// ============================================================================
// Response Formatting
// ============================================================================

function formatFullSubmission(submission: any) {
  return {
    id: submission.id,
    submissionNumber: submission.submissionNumber,
    status: submission.status,
    payoutType: submission.payoutType,
    quotedTotal: submission.quotedTotal,
    finalTotal: submission.finalTotal,
    bonusAmount: submission.bonusAmount,
    shippingMethod: submission.shippingMethod,
    trackingNumber: submission.trackingNumber,
    labelUrl: submission.labelUrl,
    items: submission.items?.map((item: any) => ({
      id: item.id,
      cardName: item.cardName,
      setName: item.setName,
      setCode: item.setCode,
      variant: item.variant,
      quantity: item.quantity,
      conditionClaimed: item.conditionClaimed,
      conditionActual: item.conditionActual,
      quotedPrice: item.quotedPrice,
      finalPrice: item.finalPrice,
      status: item.status,
      adjustmentReason: item.adjustmentReason,
    })),
    notes: submission.notes?.map((note: any) => ({
      id: note.id,
      message: note.message,
      authorType: note.authorType,
      createdAt: note.createdAt?.toISOString(),
    })),
    payout: submission.payout
      ? {
          status: submission.payout.status,
          type: submission.payout.type,
          totalAmount: submission.payout.totalAmount,
          processedAt: submission.payout.processedAt?.toISOString() || null,
        }
      : null,
    createdAt: submission.createdAt?.toISOString(),
    submittedAt: submission.submittedAt?.toISOString() || null,
    receivedAt: submission.receivedAt?.toISOString() || null,
    gradedAt: submission.gradedAt?.toISOString() || null,
    approvedAt: submission.approvedAt?.toISOString() || null,
    completedAt: submission.completedAt?.toISOString() || null,
  };
}
