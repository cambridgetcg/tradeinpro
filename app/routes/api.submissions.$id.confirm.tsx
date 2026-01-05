/**
 * Confirm Submission API
 *
 * POST /apps/trade-in/submissions/:id/confirm
 *
 * Customer confirms grading results and approves payout
 *
 * @synapse ROUTES_SYNAPSE.md - Uses workflow.server.ts for transition validation
 */

import type { ActionFunctionArgs } from "react-router";
import {
  requireCustomer,
  jsonResponse,
  errorResponse,
} from "../lib/app-proxy.server";
import { getSubmissionById } from "../lib/submissions.server";
import { executeTransition } from "../lib/workflow.server";
import { SubmissionStatus } from "../lib/constants";

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

  // Use workflow engine for transition validation and execution
  const result = await executeTransition({
    submissionId: id,
    targetStatus: SubmissionStatus.APPROVED,
    actorType: "CUSTOMER",
    actorId: context.internalCustomerId,
    reason: "Customer confirmed grading offer",
    shop: context.shop,
  });

  if (!result.success) {
    console.error("Confirm submission error:", result.error);
    return errorResponse(
      409,
      "transition_failed",
      result.error || "Cannot confirm submission in current state"
    );
  }

  return jsonResponse({
    success: true,
    message: "Submission confirmed. Your payout is being processed.",
    submission: result.submission,
    sideEffects: result.sideEffectsExecuted,
  });
}

// Only POST is supported
export async function loader() {
  return errorResponse(405, "method_not_allowed", "Only POST requests are supported");
}
