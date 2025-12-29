/**
 * Japanese Price CSV Upload API
 *
 * POST /api/admin/jp-prices/upload
 * Accepts CSV file upload and imports to JapanesePriceSource table
 */

import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import {
  parseJapanesePriceCsv,
  importJapanesePrices,
} from "../lib/jp-prices.server";

export async function action({ request }: ActionFunctionArgs) {
  // Authenticate admin request
  const { admin, session } = await authenticate.admin(request);

  if (request.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const csvContent = formData.get("csvContent");

    let content: string;

    if (file && file instanceof File) {
      content = await file.text();
    } else if (csvContent && typeof csvContent === "string") {
      content = csvContent;
    } else {
      return new Response(
        JSON.stringify({ error: "No CSV file or content provided" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Parse CSV
    const { records, errors: parseErrors } = parseJapanesePriceCsv(content);

    if (records.length === 0) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "No valid records found in CSV",
          parseErrors,
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Import to database
    const result = await importJapanesePrices(records);

    return new Response(
      JSON.stringify({
        success: true,
        result: {
          created: result.created,
          updated: result.updated,
          skipped: result.skipped,
          totalProcessed: result.totalProcessed,
          errorCount: result.errors.length,
        },
        parseErrors,
        importErrors: result.errors.slice(0, 10), // Limit errors returned
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("JP price upload error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Upload failed",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

// GET for health check
export async function loader() {
  return new Response(
    JSON.stringify({
      endpoint: "jp-prices-upload",
      method: "POST",
      accepts: "multipart/form-data with 'file' field or 'csvContent' field",
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}
