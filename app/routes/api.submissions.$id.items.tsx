/**
 * Submission Items API
 *
 * POST   /apps/trade-in/submissions/:id/items           - Add item to draft
 * DELETE /apps/trade-in/submissions/:id/items/:itemId   - Remove item from draft
 */

import type { ActionFunctionArgs } from "react-router";
import {
  requireCustomer,
  jsonResponse,
  errorResponse,
  sanitizeString,
  parsePositiveInt,
} from "../lib/app-proxy.server";
import {
  getSubmissionById,
  addItemToSubmission,
  removeItemFromSubmission,
  type CreateItemInput,
} from "../lib/submissions.server";
import { Condition } from "../lib/constants";

const VALID_CONDITIONS = ["NM", "LP", "MP", "HP", "DMG"];
const MAX_QUANTITY_PER_ITEM = 99;

export async function action({ request, params }: ActionFunctionArgs) {
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
    return errorResponse(403, "forbidden", "Not authorized to modify this submission");
  }

  // Check submission is in draft status
  if (submission.status !== "DRAFT") {
    return errorResponse(
      409,
      "invalid_status",
      `Cannot modify items for submission with status '${submission.status}'. Must be 'DRAFT'.`
    );
  }

  // Handle different methods
  if (request.method === "POST") {
    return handleAddItem(id, request);
  }

  if (request.method === "DELETE") {
    return handleRemoveItem(id, request);
  }

  return errorResponse(405, "method_not_allowed", "Only POST and DELETE requests are supported");
}

/**
 * Add item to draft submission
 */
async function handleAddItem(submissionId: string, request: Request) {
  // Parse request body
  let body: any;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "invalid_json", "Request body must be valid JSON");
  }

  // Validate item
  const validation = validateItemRequest(body);
  if (!validation.valid) {
    return errorResponse(400, "validation_error", "Validation failed", validation.errors);
  }

  const item: CreateItemInput = {
    cardPriceId: body.cardPriceId || undefined,
    cardName: sanitizeString(body.cardName, 200),
    setName: sanitizeString(body.setName, 200),
    setCode: body.setCode ? sanitizeString(body.setCode, 20) : undefined,
    variant: body.variant ? sanitizeString(body.variant, 100) : undefined,
    quantity: body.quantity,
    conditionClaimed: body.conditionClaimed as Condition,
  };

  try {
    const newItem = await addItemToSubmission(submissionId, item);

    return jsonResponse(
      {
        success: true,
        message: "Item added to submission",
        item: {
          id: newItem.id,
          cardName: newItem.cardName,
          setName: newItem.setName,
          quantity: newItem.quantity,
          conditionClaimed: newItem.conditionClaimed,
          quotedPrice: newItem.quotedPrice,
        },
      },
      201
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Add item error:", error);

    return errorResponse(400, "add_failed", message);
  }
}

/**
 * Remove item from draft submission
 */
async function handleRemoveItem(submissionId: string, request: Request) {
  // Get item ID from body or query parameter
  const url = new URL(request.url);
  let itemId = url.searchParams.get("itemId");

  // Also try to get from request body
  if (!itemId) {
    try {
      const body = await request.json();
      itemId = body.itemId;
    } catch {
      // No body or invalid JSON
    }
  }

  if (!itemId) {
    return errorResponse(400, "missing_item_id", "Item ID is required (itemId query param or body)");
  }

  try {
    await removeItemFromSubmission(submissionId, itemId);

    return jsonResponse({
      success: true,
      message: "Item removed from submission",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Remove item error:", error);

    return errorResponse(400, "remove_failed", message);
  }
}

/**
 * Validate item request body
 */
function validateItemRequest(body: any): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!body.cardName || typeof body.cardName !== "string" || !body.cardName.trim()) {
    errors.push("cardName is required");
  }

  if (!body.setName || typeof body.setName !== "string" || !body.setName.trim()) {
    errors.push("setName is required");
  }

  if (!body.quantity || typeof body.quantity !== "number") {
    errors.push("quantity is required and must be a number");
  } else if (body.quantity < 1) {
    errors.push("quantity must be at least 1");
  } else if (body.quantity > MAX_QUANTITY_PER_ITEM) {
    errors.push(`quantity cannot exceed ${MAX_QUANTITY_PER_ITEM}`);
  }

  if (!body.conditionClaimed || !VALID_CONDITIONS.includes(body.conditionClaimed)) {
    errors.push(`conditionClaimed must be one of: ${VALID_CONDITIONS.join(", ")}`);
  }

  return { valid: errors.length === 0, errors };
}

// Only action methods supported
export async function loader() {
  return errorResponse(405, "method_not_allowed", "Only POST and DELETE requests are supported");
}
