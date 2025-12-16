/**
 * Submissions API
 *
 * GET  /apps/trade-in/submissions     - List customer's submissions (requires login)
 * POST /apps/trade-in/submissions     - Create new submission (allows guest with email)
 */

import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import {
  requireAppProxy,
  requireCustomer,
  findCustomerByShopifyId,
  jsonResponse,
  errorResponse,
  isValidEmail,
  sanitizeString,
  parsePositiveInt,
} from "../lib/app-proxy.server";
import {
  createSubmission,
  getCustomerSubmissions,
  submitSubmission,
  type CreateItemInput,
} from "../lib/submissions.server";
import { sendSubmissionCreatedNotification } from "../lib/notifications.server";
import { Condition, PayoutType, type ConditionType, type PayoutTypeValue } from "../lib/constants";

// ============================================================================
// GET - List customer submissions
// ============================================================================

export async function loader({ request }: LoaderFunctionArgs) {
  // Require logged-in customer
  const context = await requireCustomer(request);

  const url = new URL(request.url);
  const status = sanitizeString(url.searchParams.get("status") || "", 50) || undefined;
  const limit = Math.min(parsePositiveInt(url.searchParams.get("limit"), 20), 50);
  const offset = parsePositiveInt(url.searchParams.get("offset"), 0);

  try {
    const { submissions, total } = await getCustomerSubmissions(
      context.internalCustomerId,
      { status, limit, offset }
    );

    return jsonResponse({
      submissions: submissions.map(formatSubmissionForList),
      total,
      limit,
      offset,
    });
  } catch (error) {
    console.error("List submissions error:", error);
    return errorResponse(500, "fetch_failed", "Failed to fetch submissions");
  }
}

// ============================================================================
// POST - Create new submission
// ============================================================================

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return errorResponse(405, "method_not_allowed", "Only POST requests are supported");
  }

  // Validate App Proxy (allows guest)
  const context = requireAppProxy(request);

  // Parse request body
  let body: CreateSubmissionRequest;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "invalid_json", "Request body must be valid JSON");
  }

  // Validate request
  const validation = validateCreateSubmissionRequest(body);
  if (!validation.valid) {
    return errorResponse(400, "validation_error", "Validation failed", validation.errors);
  }

  try {
    // Debug: Log context and raw items from request
    console.log('[api.submissions] Shop context:', context.shop);
    console.log('[api.submissions] Raw items from request:', JSON.stringify(body.items.map((item: any) => ({
      cardPriceId: item.cardPriceId,
      cardName: item.cardName,
      setName: item.setName,
      quantity: item.quantity,
      conditionClaimed: item.conditionClaimed
    })), null, 2));

    // Build items array with proper typing
    const items: CreateItemInput[] = body.items.map((item) => ({
      cardPriceId: item.cardPriceId || undefined,
      cardName: sanitizeString(item.cardName, 200),
      setName: sanitizeString(item.setName, 200),
      setCode: item.setCode ? sanitizeString(item.setCode, 20) : undefined,
      variant: item.variant ? sanitizeString(item.variant, 100) : undefined,
      quantity: item.quantity,
      conditionClaimed: item.conditionClaimed as ConditionType,
    }));

    // Debug: Log processed items
    console.log('[api.submissions] Processed items:', JSON.stringify(items.map(item => ({
      cardPriceId: item.cardPriceId,
      cardName: item.cardName
    })), null, 2));

    const result = await createSubmission(
      {
        shopifyCustomerId: context.customerId || undefined,
        email: body.email.toLowerCase().trim(),
        firstName: body.firstName ? sanitizeString(body.firstName, 100) : undefined,
        lastName: body.lastName ? sanitizeString(body.lastName, 100) : undefined,
        payoutType: body.payoutType as PayoutTypeValue,
        items,
        // Bank details (sanitized and normalized)
        bankAccountName: body.bankAccountName ? sanitizeString(body.bankAccountName, 100) : undefined,
        bankSortCode: body.bankSortCode ? body.bankSortCode.replace(/[-\s]/g, "") : undefined,
        bankAccountNumber: body.bankAccountNumber ? body.bankAccountNumber.replace(/\s/g, "") : undefined,
        // Contact preferences
        phone: body.phone ? sanitizeString(body.phone, 30) : undefined,
        contactChannel: body.contactChannel || undefined,
      },
      context.shop // Pass shop for settings lookup
    );

    if (!result.success) {
      return errorResponse(
        400,
        "creation_failed",
        "Failed to create submission",
        result.errors
      );
    }

    // Auto-submit the submission (changes status from DRAFT to SUBMITTED)
    // This makes it visible in the admin queue immediately
    const submittedSubmission = await submitSubmission(result.submission!.id);

    // Send confirmation email to customer
    try {
      await sendSubmissionCreatedNotification(submittedSubmission);
    } catch (notifyError) {
      console.error("Failed to send submission confirmation email:", notifyError);
      // Don't fail the request, submission is still created
    }

    return jsonResponse(
      {
        success: true,
        submission: formatSubmissionForResponse(submittedSubmission),
      },
      201
    );
  } catch (error) {
    console.error("Create submission error:", error);
    return errorResponse(500, "creation_failed", "An error occurred while creating submission");
  }
}

// ============================================================================
// Request Types & Validation
// ============================================================================

interface CreateSubmissionRequest {
  email: string;
  firstName?: string;
  lastName?: string;
  payoutType: string;
  items: Array<{
    cardPriceId?: string;
    cardName: string;
    setName: string;
    setCode?: string;
    variant?: string;
    quantity: number;
    conditionClaimed: string;
  }>;
  // Bank details (required when payoutType is BANK)
  bankAccountName?: string;
  bankSortCode?: string;
  bankAccountNumber?: string;
  // Contact preferences
  phone?: string;
  contactChannel?: string;
}

const VALID_PAYOUT_TYPES = ["STORE_CREDIT", "BANK", "PAYPAL"];
const VALID_CONDITIONS = ["NM", "LP", "MP", "HP", "DMG"];
const VALID_CONTACT_CHANNELS = ["WHATSAPP", "TELEGRAM", "SIGNAL"];
const MAX_ITEMS = 100;
const MAX_QUANTITY_PER_ITEM = 99;

function validateCreateSubmissionRequest(body: any): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Email validation
  if (!body.email || typeof body.email !== "string") {
    errors.push("Email is required");
  } else if (!isValidEmail(body.email)) {
    errors.push("Invalid email format");
  }

  // Payout type validation
  if (!body.payoutType || !VALID_PAYOUT_TYPES.includes(body.payoutType)) {
    errors.push(`Payout type must be one of: ${VALID_PAYOUT_TYPES.join(", ")}`);
  }

  // Bank details validation (required when payoutType is BANK)
  if (body.payoutType === "BANK") {
    if (!body.bankAccountName || typeof body.bankAccountName !== "string" || !body.bankAccountName.trim()) {
      errors.push("Account holder name is required for bank transfers");
    }
    if (!body.bankSortCode || typeof body.bankSortCode !== "string") {
      errors.push("Sort code is required for bank transfers");
    } else {
      // Validate UK sort code format (XX-XX-XX or XXXXXX)
      const sortCodeClean = body.bankSortCode.replace(/[-\s]/g, "");
      if (!/^\d{6}$/.test(sortCodeClean)) {
        errors.push("Sort code must be 6 digits (e.g., 12-34-56 or 123456)");
      }
    }
    if (!body.bankAccountNumber || typeof body.bankAccountNumber !== "string") {
      errors.push("Account number is required for bank transfers");
    } else {
      // Validate UK account number (8 digits)
      const accountNumberClean = body.bankAccountNumber.replace(/\s/g, "");
      if (!/^\d{8}$/.test(accountNumberClean)) {
        errors.push("Account number must be 8 digits");
      }
    }
  }

  // Phone validation (required)
  if (!body.phone || typeof body.phone !== "string" || !body.phone.trim()) {
    errors.push("Phone number is required");
  } else {
    // Contact channel validation (required when phone is provided)
    if (!body.contactChannel || !VALID_CONTACT_CHANNELS.includes(body.contactChannel)) {
      errors.push(`Contact channel is required. Must be one of: ${VALID_CONTACT_CHANNELS.join(", ")}`);
    }
  }

  // Items validation
  if (!body.items || !Array.isArray(body.items)) {
    errors.push("Items array is required");
  } else if (body.items.length === 0) {
    errors.push("At least one item is required");
  } else if (body.items.length > MAX_ITEMS) {
    errors.push(`Maximum ${MAX_ITEMS} items per submission`);
  } else {
    // Validate each item
    body.items.forEach((item: any, index: number) => {
      const itemNum = index + 1;

      if (!item.cardName || typeof item.cardName !== "string" || !item.cardName.trim()) {
        errors.push(`Item ${itemNum}: cardName is required`);
      }

      if (!item.setName || typeof item.setName !== "string" || !item.setName.trim()) {
        errors.push(`Item ${itemNum}: setName is required`);
      }

      if (!item.quantity || typeof item.quantity !== "number") {
        errors.push(`Item ${itemNum}: quantity is required and must be a number`);
      } else if (item.quantity < 1) {
        errors.push(`Item ${itemNum}: quantity must be at least 1`);
      } else if (item.quantity > MAX_QUANTITY_PER_ITEM) {
        errors.push(`Item ${itemNum}: quantity cannot exceed ${MAX_QUANTITY_PER_ITEM}`);
      }

      if (!item.conditionClaimed || !VALID_CONDITIONS.includes(item.conditionClaimed)) {
        errors.push(`Item ${itemNum}: conditionClaimed must be one of: ${VALID_CONDITIONS.join(", ")}`);
      }
    });
  }

  return { valid: errors.length === 0, errors };
}

// ============================================================================
// Response Formatting
// ============================================================================

function formatSubmissionForList(submission: any) {
  return {
    id: submission.id,
    submissionNumber: submission.submissionNumber,
    status: submission.status,
    payoutType: submission.payoutType,
    quotedTotal: submission.quotedTotal,
    finalTotal: submission.finalTotal,
    bonusAmount: submission.bonusAmount,
    itemCount: submission.items?.length || 0,
    createdAt: submission.createdAt?.toISOString(),
    submittedAt: submission.submittedAt?.toISOString() || null,
  };
}

function formatSubmissionForResponse(submission: any) {
  return {
    id: submission.id,
    submissionNumber: submission.submissionNumber,
    status: submission.status,
    payoutType: submission.payoutType,
    quotedTotal: submission.quotedTotal,
    bonusAmount: submission.bonusAmount,
    items: submission.items?.map((item: any) => ({
      id: item.id,
      cardName: item.cardName,
      setName: item.setName,
      setCode: item.setCode,
      variant: item.variant,
      quantity: item.quantity,
      conditionClaimed: item.conditionClaimed,
      quotedPrice: item.quotedPrice,
    })),
    createdAt: submission.createdAt?.toISOString(),
  };
}
