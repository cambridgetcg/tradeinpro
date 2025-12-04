/**
 * Self-Ship Instructions API
 *
 * GET /apps/trade-in/shipping/instructions/:id
 *
 * Get self-ship instructions for a submission
 */

import type { LoaderFunctionArgs } from "react-router";
import {
  requireCustomer,
  jsonResponse,
  errorResponse,
} from "../lib/app-proxy.server";
import {
  getSelfShipInstructions,
  qualifiesForFreeShipping,
  formatAddress,
} from "../lib/shipping.server";
import { getSubmissionById } from "../lib/submissions.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
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
    return errorResponse(403, "forbidden", "Not authorized to access this submission");
  }

  // Instructions available for submitted orders
  if (!["DRAFT", "SUBMITTED", "IN_TRANSIT"].includes(submission.status)) {
    return errorResponse(
      409,
      "invalid_status",
      `Shipping instructions not available for submission with status '${submission.status}'.`
    );
  }

  try {
    const instructions = await getSelfShipInstructions(id);
    const shippingEligibility = await qualifiesForFreeShipping(id);

    return jsonResponse({
      ...instructions,
      returnAddressFormatted: formatAddress(instructions.returnAddress),
      freeShipping: shippingEligibility,
    });
  } catch (error) {
    console.error("Get instructions error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";

    return errorResponse(500, "instructions_failed", message);
  }
}

// Only GET is supported
export async function action() {
  return errorResponse(405, "method_not_allowed", "Only GET requests are supported");
}
