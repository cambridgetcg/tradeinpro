/**
 * Shipping Label API
 *
 * GET /apps/trade-in/shipping/label/:id
 *
 * Get printable shipping label HTML for a submission
 */

import type { LoaderFunctionArgs } from "react-router";
import { requireCustomer, errorResponse } from "../lib/app-proxy.server";
import {
  generateLabelHTML,
  generateShippingLabel,
  qualifiesForFreeShipping,
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

  // Only generate labels for submitted/in-transit orders
  if (!["SUBMITTED", "IN_TRANSIT"].includes(submission.status)) {
    return errorResponse(
      409,
      "invalid_status",
      `Shipping label not available for submission with status '${submission.status}'. Submit the order first.`
    );
  }

  try {
    // Check if qualifies for free shipping
    const shippingEligibility = await qualifiesForFreeShipping(id);

    // Generate tracking number if not already done
    if (!submission.trackingNumber) {
      try {
        await generateShippingLabel({ submissionId: id });
      } catch (labelError) {
        console.error("Label generation error:", labelError);
        return errorResponse(
          500,
          "label_generation_failed",
          "Unable to generate shipping label. Please try again or use self-ship instructions."
        );
      }
    }

    // Generate printable HTML
    const html = await generateLabelHTML(id);

    return new Response(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Disposition": `inline; filename="label-${submission.submissionNumber}.html"`,
        "Cache-Control": "no-cache, no-store, must-revalidate",
      },
    });
  } catch (error) {
    console.error("Generate label error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";

    return errorResponse(500, "label_failed", message);
  }
}

// Only GET is supported
export async function action() {
  return errorResponse(405, "method_not_allowed", "Only GET requests are supported");
}
