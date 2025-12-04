/**
 * Reject Submission API
 *
 * POST /apps/trade-in/submissions/:id/reject
 *
 * Customer rejects grading results and requests return of cards
 */

import type { ActionFunctionArgs } from "react-router";
import {
  requireCustomer,
  jsonResponse,
  errorResponse,
  sanitizeString,
} from "../lib/app-proxy.server";
import { rejectSubmission, getSubmissionById } from "../lib/submissions.server";

const MAX_REASON_LENGTH = 500;

export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return errorResponse(405, "method_not_allowed", "Only POST requests are supported");
  }

  const { id } = params;
  if (!id) {
    return errorResponse(400, "missing_id", "Submission ID is required");
  }

  const context = await requireCustomer(request);

  // Parse request body
  let body: { reason?: string };
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  // Extract and sanitize reason
  const reason = sanitizeString(body.reason || "", MAX_REASON_LENGTH) || "No reason provided";

  // Verify submission exists and ownership
  const submission = await getSubmissionById(id);
  if (!submission) {
    return errorResponse(404, "not_found", "Submission not found");
  }

  if (submission.customerId !== context.internalCustomerId) {
    return errorResponse(403, "forbidden", "Not authorized to reject this submission");
  }

  // Check current status
  if (submission.status !== "PENDING_APPROVAL") {
    return errorResponse(
      409,
      "invalid_status",
      `Cannot reject submission with status '${submission.status}'. Must be 'PENDING_APPROVAL'.`
    );
  }

  try {
    const updated = await rejectSubmission(id, context.internalCustomerId, reason);

    return jsonResponse({
      success: true,
      message: "Return requested. Your cards will be shipped back within 2-3 business days.",
      submission: {
        id: updated.id,
        submissionNumber: updated.submissionNumber,
        status: updated.status,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Reject submission error:", error);

    return errorResponse(400, "reject_failed", message);
  }
}

// Only POST is supported
export async function loader() {
  return errorResponse(405, "method_not_allowed", "Only POST requests are supported");
}
