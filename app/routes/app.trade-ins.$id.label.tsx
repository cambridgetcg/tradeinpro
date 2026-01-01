/**
 * PDF Label Download Route
 *
 * GET /app/trade-ins/:id/label
 *
 * Downloads the prepaid shipping label PDF for a submission.
 * Only works for submissions with Royal Mail prepaid labels.
 */

import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await authenticate.admin(request);

  const { id } = params;

  if (!id) {
    return new Response("Submission ID required", { status: 400 });
  }

  const submission = await prisma.tradeInSubmission.findUnique({
    where: { id },
    select: {
      submissionNumber: true,
      labelPdfBase64: true,
      shippingMethod: true,
    },
  });

  if (!submission) {
    return new Response("Submission not found", { status: 404 });
  }

  if (!submission.labelPdfBase64) {
    return new Response("No shipping label available for this submission", {
      status: 404,
    });
  }

  // Convert Base64 to binary
  const pdfBuffer = Buffer.from(submission.labelPdfBase64, "base64");

  return new Response(pdfBuffer, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="shipping-label-${submission.submissionNumber}.pdf"`,
      "Content-Length": pdfBuffer.length.toString(),
      "Cache-Control": "private, no-cache, no-store, must-revalidate",
    },
  });
}
