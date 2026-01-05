/**
 * Reject Submission API
 *
 * POST /apps/trade-in/submissions/:id/reject
 *
 * Customer rejects grading results and requests return of cards
 *
 * @synapse ROUTES_SYNAPSE.md - Uses workflow.server.ts for transition validation
 */

import type { ActionFunctionArgs } from "react-router";
import {
  requireCustomer,
  jsonResponse,
  errorResponse,
  sanitizeString,
} from "../lib/app-proxy.server";
import { getSubmissionById } from "../lib/submissions.server";
import { executeTransition } from "../lib/workflow.server";
import { SubmissionStatus } from "../lib/constants";

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

  // Use workflow engine for transition validation and execution
  const result = await executeTransition({
    submissionId: id,
    targetStatus: SubmissionStatus.RETURNED,
    actorType: "CUSTOMER",
    actorId: context.internalCustomerId,
    reason: `Customer rejected offer: ${reason}`,
    shop: context.shop,
  });

  if (!result.success) {
    console.error("Reject submission error:", result.error);
    return errorResponse(
      409,
      "transition_failed",
      result.error || "Cannot reject submission in current state"
    );
  }

  return jsonResponse({
    success: true,
    message: "Return requested. Your cards will be shipped back within 2-3 business days.",
    submission: result.submission,
    sideEffects: result.sideEffectsExecuted,
  });
}

// Only POST is supported
export async function loader() {
  return errorResponse(405, "method_not_allowed", "Only POST requests are supported");
}
