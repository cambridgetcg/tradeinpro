/**
 * Tracking Update API
 *
 * POST /apps/trade-in/shipping/tracking/:id
 *
 * Update tracking number for self-shipped submission
 */

import type { ActionFunctionArgs } from "react-router";
import {
  requireCustomer,
  jsonResponse,
  errorResponse,
  sanitizeString,
} from "../lib/app-proxy.server";
import { updateTrackingNumber } from "../lib/shipping.server";
import { getSubmissionById } from "../lib/submissions.server";

const MAX_TRACKING_LENGTH = 100;
const MAX_CARRIER_LENGTH = 50;

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
  let body: { trackingNumber: string; carrier?: string };
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "invalid_json", "Request body must be valid JSON");
  }

  // Validate tracking number
  const trackingNumber = sanitizeString(body.trackingNumber || "", MAX_TRACKING_LENGTH);
  if (!trackingNumber) {
    return errorResponse(400, "missing_tracking", "Tracking number is required");
  }

  const carrier = body.carrier
    ? sanitizeString(body.carrier, MAX_CARRIER_LENGTH)
    : undefined;

  // Verify submission exists and ownership
  const submission = await getSubmissionById(id);
  if (!submission) {
    return errorResponse(404, "not_found", "Submission not found");
  }

  if (submission.customerId !== context.internalCustomerId) {
    return errorResponse(403, "forbidden", "Not authorized to modify this submission");
  }

  // Check submission is in correct status
  if (!["SUBMITTED", "IN_TRANSIT"].includes(submission.status)) {
    return errorResponse(
      409,
      "invalid_status",
      `Cannot update tracking for submission with status '${submission.status}'. Must be 'SUBMITTED' or 'IN_TRANSIT'.`
    );
  }

  try {
    await updateTrackingNumber(id, trackingNumber, carrier);

    return jsonResponse({
      success: true,
      message: "Tracking number updated successfully",
      trackingNumber,
      carrier: carrier || null,
      status: "IN_TRANSIT",
    });
  } catch (error) {
    console.error("Update tracking error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";

    return errorResponse(400, "update_failed", message);
  }
}

// Only POST is supported
export async function loader() {
  return errorResponse(405, "method_not_allowed", "Only POST requests are supported");
}
