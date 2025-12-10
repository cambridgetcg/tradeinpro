/**
 * Shipping Label API
 *
 * GET  /apps/trade-in/shipping/label/:id  - Get printable shipping label (HTML or PDF)
 * POST /apps/trade-in/shipping/label/:id  - Request prepaid label with shipping address
 */

import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import {
  requireCustomer,
  errorResponse,
  jsonResponse,
  sanitizeString,
} from "../lib/app-proxy.server";
import {
  generateLabelHTML,
  generateShippingLabel,
  qualifiesForFreeShipping,
  type CustomerAddress,
} from "../lib/shipping.server";
import { getSubmissionById } from "../lib/submissions.server";
import prisma from "../db.server";
import { isValidUKPostcode } from "../services/royalMailApi.server";

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

  // Only show labels for submitted/in-transit orders
  if (!["SUBMITTED", "IN_TRANSIT"].includes(submission.status)) {
    return errorResponse(
      409,
      "invalid_status",
      `Shipping label not available for submission with status '${submission.status}'. Submit the order first.`
    );
  }

  try {
    // Check if we have a PDF label from Royal Mail
    const submissionData = await prisma.tradeInSubmission.findUnique({
      where: { id },
      select: {
        labelPdfBase64: true,
        submissionNumber: true,
        trackingNumber: true,
      },
    });

    // If we have a Royal Mail PDF label, serve it
    if (submissionData?.labelPdfBase64) {
      const pdfBuffer = Buffer.from(submissionData.labelPdfBase64, "base64");
      return new Response(pdfBuffer, {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="label-${submissionData.submissionNumber}.pdf"`,
          "Cache-Control": "no-cache, no-store, must-revalidate",
        },
      });
    }

    // Otherwise, generate tracking number if needed and show HTML label
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

// ============================================================================
// POST - Request prepaid label with shipping address
// ============================================================================

interface RequestLabelBody {
  shippingAddress: {
    name: string;
    address1: string;
    address2?: string;
    city: string;
    postalCode: string;
    country?: string;
  };
}

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
    return errorResponse(403, "forbidden", "Not authorized to access this submission");
  }

  // Only generate labels for submitted orders
  if (submission.status !== "SUBMITTED") {
    return errorResponse(
      409,
      "invalid_status",
      `Cannot request label for submission with status '${submission.status}'`
    );
  }

  // Parse and validate request body
  let body: RequestLabelBody;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "invalid_json", "Request body must be valid JSON");
  }

  // Validate shipping address
  const validation = validateShippingAddress(body.shippingAddress);
  if (!validation.valid) {
    return errorResponse(400, "validation_error", "Invalid shipping address", validation.errors);
  }

  try {
    const customerAddress: CustomerAddress = {
      name: sanitizeString(body.shippingAddress.name, 100),
      address1: sanitizeString(body.shippingAddress.address1, 200),
      address2: body.shippingAddress.address2
        ? sanitizeString(body.shippingAddress.address2, 200)
        : undefined,
      city: sanitizeString(body.shippingAddress.city, 100),
      postalCode: sanitizeString(body.shippingAddress.postalCode, 20),
      country: body.shippingAddress.country || "GB",
    };

    // Generate the label with customer address
    const label = await generateShippingLabel({
      submissionId: id,
      customerAddress,
    });

    return jsonResponse({
      success: true,
      label: {
        labelUrl: label.labelUrl,
        trackingNumber: label.trackingNumber,
        carrier: label.carrier,
        estimatedDelivery: label.estimatedDelivery,
        instructions: label.instructions,
      },
    });
  } catch (error) {
    console.error("Generate label error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return errorResponse(500, "label_failed", message);
  }
}

// ============================================================================
// Validation Helpers
// ============================================================================

function validateShippingAddress(
  address: any
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!address || typeof address !== "object") {
    return { valid: false, errors: ["Shipping address is required"] };
  }

  if (!address.name?.trim()) {
    errors.push("Name is required");
  }

  if (!address.address1?.trim()) {
    errors.push("Address line 1 is required");
  }

  if (!address.city?.trim()) {
    errors.push("City is required");
  }

  if (!address.postalCode?.trim()) {
    errors.push("Postal code is required");
  } else if (!isValidUKPostcode(address.postalCode)) {
    errors.push("Invalid UK postcode format");
  }

  return { valid: errors.length === 0, errors };
}
