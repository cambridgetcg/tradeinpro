/**
 * Confirm Submission API
 *
 * POST /apps/trade-in/submissions/:id/confirm
 *
 * Customer confirms grading results and approves payout
 */

import type { ActionFunctionArgs } from "react-router";
import {
  requireCustomer,
  jsonResponse,
  errorResponse,
} from "../lib/app-proxy.server";
import { confirmSubmission, getSubmissionById } from "../lib/submissions.server";

export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return errorResponse(405, "method_not_allowed", "Only POST requests are supported");
  }

  const { id } = params;
  if (!id) {
    return errorResponse(400, "missing_id", "Submission ID is required");
  }

  const context = await requireCustomer(request);

  // Verify submission exists and ownership
  const submission = await getSubmissionById(id);
  if (!submission) {
    return errorResponse(404, "not_found", "Submission not found");
  }

  if (submission.customerId !== context.internalCustomerId) {
    return errorResponse(403, "forbidden", "Not authorized to confirm this submission");
  }

  // Check current status
  if (submission.status !== "PENDING_APPROVAL") {
    return errorResponse(
      409,
      "invalid_status",
      `Cannot confirm submission with status '${submission.status}'. Must be 'PENDING_APPROVAL'.`
    );
  }

  try {
    const updated = await confirmSubmission(id, context.internalCustomerId);

    return jsonResponse({
      success: true,
      message: "Submission confirmed. Your payout is being processed.",
      submission: {
        id: updated.id,
        submissionNumber: updated.submissionNumber,
        status: updated.status,
        approvedAt: updated.approvedAt?.toISOString(),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Confirm submission error:", error);

    return errorResponse(400, "confirm_failed", message);
  }
}

// Only POST is supported
export async function loader() {
  return errorResponse(405, "method_not_allowed", "Only POST requests are supported");
}
