# Phase 4: API Routes, Notifications & Customer Integration

## Overview

Phase 4 exposes the Phase 3 libraries via REST APIs and adds customer-facing functionality:

1. **API Routes** - REST endpoints via Shopify App Proxy for customer access
2. **Email Notifications** - Automated emails for submission lifecycle events
3. **App Proxy Authentication** - Secure customer identification via Shopify
4. **Webhook Handlers** - React to Shopify events (customer updates, etc.)

---

## 1. Architecture

### 1.1 Request Flow

```
Customer Browser
      │
      ▼
Shopify Storefront (mystore.myshopify.com/apps/trade-in/*)
      │
      ▼ (App Proxy - adds signature + customer info)
      │
      ▼
Vercel (cardforum.vercel.app/api/*)
      │
      ▼
API Route Handler
      │
      ├──► Validate App Proxy signature
      ├──► Extract customer info from headers
      └──► Call Phase 3 library functions
```

### 1.2 File Structure

```
app/
├── routes/
│   ├── api.submissions.tsx           # POST /apps/trade-in/submissions
│   ├── api.submissions.$id.tsx       # GET/PUT /apps/trade-in/submissions/:id
│   ├── api.submissions.$id.confirm.tsx
│   ├── api.submissions.$id.reject.tsx
│   ├── api.submissions.$id.items.tsx # POST/DELETE items
│   ├── api.cards.search.tsx          # GET /apps/trade-in/cards/search
│   ├── api.shipping.label.$id.tsx    # GET shipping label HTML
│   ├── api.shipping.instructions.$id.tsx
│   └── webhooks.tsx                  # Shopify webhooks
├── lib/
│   ├── app-proxy.server.ts           # App Proxy signature validation
│   └── notifications.server.ts       # Email sending
```

---

## 2. App Proxy Authentication

### 2.1 Shopify App Proxy Setup

Configure in Shopify Partners Dashboard:
- **Subpath prefix**: `trade-in`
- **Proxy URL**: `https://cardforum.vercel.app/api`

This routes: `https://mystore.com/apps/trade-in/*` → `https://cardforum.vercel.app/api/*`

### 2.2 Signature Validation

```typescript
// app/lib/app-proxy.server.ts

import crypto from "crypto";

interface AppProxyContext {
  shop: string;
  customerId: string | null;
  customerEmail: string | null;
  locale: string;
  timestamp: string;
  isValid: boolean;
}

/**
 * Validate Shopify App Proxy request signature
 *
 * Shopify signs all App Proxy requests with HMAC-SHA256 using SHOPIFY_API_SECRET.
 * The signature is passed as `signature` query parameter.
 *
 * @see https://shopify.dev/docs/apps/online-store/app-proxies
 */
export function validateAppProxy(request: Request): AppProxyContext {
  const url = new URL(request.url);
  const params = new URLSearchParams(url.search);

  const signature = params.get("signature");
  const timestamp = params.get("timestamp");
  const shop = params.get("shop");
  const loggedInCustomerId = params.get("logged_in_customer_id");

  // Default context (invalid)
  const context: AppProxyContext = {
    shop: shop || "",
    customerId: loggedInCustomerId || null,
    customerEmail: null, // Fetched separately if needed
    locale: params.get("locale") || "en",
    timestamp: timestamp || "",
    isValid: false,
  };

  // Require minimum parameters
  if (!signature || !timestamp || !shop) {
    return context;
  }

  // Check timestamp is within 5 minutes
  const requestTime = parseInt(timestamp, 10);
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - requestTime) > 300) {
    console.warn("App Proxy request timestamp too old");
    return context;
  }

  // Build message for HMAC verification
  // Remove signature param, sort remaining params
  params.delete("signature");
  const sortedParams = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("");

  // Calculate expected signature
  const secret = process.env.SHOPIFY_API_SECRET;
  if (!secret) {
    console.error("SHOPIFY_API_SECRET not configured");
    return context;
  }

  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(sortedParams)
    .digest("hex");

  // Timing-safe comparison
  const signatureBuffer = Buffer.from(signature, "hex");
  const expectedBuffer = Buffer.from(expectedSignature, "hex");

  if (
    signatureBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    console.warn("App Proxy signature mismatch");
    return context;
  }

  context.isValid = true;
  return context;
}

/**
 * Require valid App Proxy context, throw 401 if invalid
 */
export function requireAppProxy(request: Request): AppProxyContext {
  const context = validateAppProxy(request);

  if (!context.isValid) {
    throw new Response("Unauthorized", { status: 401 });
  }

  return context;
}

/**
 * Require logged-in customer, throw 401 if not authenticated
 */
export function requireCustomer(request: Request): AppProxyContext & { customerId: string } {
  const context = requireAppProxy(request);

  if (!context.customerId) {
    throw new Response("Customer login required", { status: 401 });
  }

  return context as AppProxyContext & { customerId: string };
}
```

### 2.3 Edge Cases & Error Handling

```typescript
// Edge Case 1: Replay attacks
// Solution: Reject requests older than 5 minutes

// Edge Case 2: Missing API secret
// Solution: Fail closed - reject all requests if secret not configured

// Edge Case 3: Guest customers (not logged in)
// Allow submission creation with email, but require login for:
// - Viewing existing submissions
// - Confirming/rejecting grading results

// Edge Case 4: Customer trying to access another customer's submission
// Always verify customerId matches submission owner

// Edge Case 5: Rate limiting
export const RATE_LIMITS = {
  submissions: { max: 10, window: 3600 },    // 10 submissions/hour
  cardSearch: { max: 100, window: 60 },      // 100 searches/minute
  shippingLabel: { max: 5, window: 60 },     // 5 labels/minute
};
```

---

## 3. API Routes

### 3.1 Card Search API

```typescript
// app/routes/api.cards.search.tsx

import type { LoaderFunctionArgs } from "react-router";
import { validateAppProxy } from "../lib/app-proxy.server";
import { searchCards } from "../lib/submissions.server";

/**
 * GET /apps/trade-in/cards/search?q=charizard&game=pokemon&limit=20
 *
 * Public endpoint (no customer login required) for card autocomplete.
 * Used in the trade-in form to find cards.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  // Validate App Proxy (but don't require customer login)
  const context = validateAppProxy(request);
  if (!context.isValid) {
    return Response.json({ error: "Invalid request" }, { status: 401 });
  }

  const url = new URL(request.url);
  const query = url.searchParams.get("q") || "";
  const game = url.searchParams.get("game") || undefined;
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "20", 10), 50);
  const minPrice = url.searchParams.get("minPrice")
    ? parseInt(url.searchParams.get("minPrice")!, 10)
    : undefined;

  // Validate query length
  if (query.length < 2) {
    return Response.json({
      results: [],
      error: "Query must be at least 2 characters"
    });
  }

  try {
    const results = await searchCards({ query, game, limit, minPrice });

    return Response.json({
      results,
      count: results.length,
      query,
    });
  } catch (error) {
    console.error("Card search error:", error);
    return Response.json(
      { error: "Search failed", results: [] },
      { status: 500 }
    );
  }
}

// Edge Cases:
// 1. Empty query → Return empty results with message
// 2. SQL injection → Prisma handles parameterization
// 3. Very long query → Truncate to 100 chars
// 4. Special characters → Escape for LIKE pattern
// 5. No results → Return empty array (not error)
```

### 3.2 Submissions API

```typescript
// app/routes/api.submissions.tsx

import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { requireAppProxy, requireCustomer } from "../lib/app-proxy.server";
import {
  createSubmission,
  getCustomerSubmissions,
  getOrCreateCustomer,
} from "../lib/submissions.server";
import { Condition, PayoutType } from "../lib/constants";

/**
 * GET /apps/trade-in/submissions
 *
 * List customer's submissions (requires login)
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const context = requireCustomer(request);

  const url = new URL(request.url);
  const status = url.searchParams.get("status") || undefined;
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "20", 10), 50);
  const offset = parseInt(url.searchParams.get("offset") || "0", 10);

  try {
    // Find customer by Shopify ID
    const customer = await findCustomerByShopifyId(context.customerId);

    if (!customer) {
      return Response.json({ submissions: [], total: 0 });
    }

    const { submissions, total } = await getCustomerSubmissions(customer.id, {
      status,
      limit,
      offset,
    });

    return Response.json({
      submissions: submissions.map(formatSubmissionForAPI),
      total,
      limit,
      offset,
    });
  } catch (error) {
    console.error("List submissions error:", error);
    return Response.json({ error: "Failed to fetch submissions" }, { status: 500 });
  }
}

/**
 * POST /apps/trade-in/submissions
 *
 * Create a new submission (allows guest with email)
 */
export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const context = requireAppProxy(request);

  let body: CreateSubmissionRequest;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Validation
  const validation = validateCreateSubmissionRequest(body);
  if (!validation.valid) {
    return Response.json({
      error: "Validation failed",
      errors: validation.errors
    }, { status: 400 });
  }

  try {
    const result = await createSubmission({
      shopifyCustomerId: context.customerId || undefined,
      email: body.email,
      firstName: body.firstName,
      lastName: body.lastName,
      payoutType: body.payoutType as PayoutType,
      items: body.items.map(item => ({
        cardPriceId: item.cardPriceId,
        cardName: item.cardName,
        setName: item.setName,
        setCode: item.setCode,
        variant: item.variant,
        quantity: item.quantity,
        conditionClaimed: item.conditionClaimed as Condition,
      })),
    });

    if (!result.success) {
      return Response.json({
        error: "Submission creation failed",
        errors: result.errors
      }, { status: 400 });
    }

    return Response.json({
      success: true,
      submission: formatSubmissionForAPI(result.submission!),
    }, { status: 201 });

  } catch (error) {
    console.error("Create submission error:", error);
    return Response.json({ error: "Failed to create submission" }, { status: 500 });
  }
}

// Request/Response Types
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
}

// Input Validation
function validateCreateSubmissionRequest(body: any): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Required fields
  if (!body.email || typeof body.email !== "string") {
    errors.push("Email is required");
  } else if (!isValidEmail(body.email)) {
    errors.push("Invalid email format");
  }

  if (!body.payoutType || !["STORE_CREDIT", "BANK", "PAYPAL"].includes(body.payoutType)) {
    errors.push("Invalid payout type. Must be STORE_CREDIT, BANK, or PAYPAL");
  }

  if (!body.items || !Array.isArray(body.items) || body.items.length === 0) {
    errors.push("At least one item is required");
  } else {
    body.items.forEach((item: any, index: number) => {
      if (!item.cardName) {
        errors.push(`Item ${index + 1}: cardName is required`);
      }
      if (!item.setName) {
        errors.push(`Item ${index + 1}: setName is required`);
      }
      if (!item.quantity || item.quantity < 1) {
        errors.push(`Item ${index + 1}: quantity must be at least 1`);
      }
      if (item.quantity > 100) {
        errors.push(`Item ${index + 1}: quantity cannot exceed 100`);
      }
      if (!item.conditionClaimed || !["NM", "LP", "MP", "HP", "DMG"].includes(item.conditionClaimed)) {
        errors.push(`Item ${index + 1}: conditionClaimed must be NM, LP, MP, HP, or DMG`);
      }
    });
  }

  return { valid: errors.length === 0, errors };
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// Edge Cases:
// 1. Duplicate submission prevention → Check for recent identical submissions
// 2. Invalid cardPriceId → Fallback to name-based lookup
// 3. Inactive card → Reject with clear error message
// 4. Concurrent submission creation → Use database transaction
// 5. Empty items after validation → Return specific error
```

### 3.3 Individual Submission API

```typescript
// app/routes/api.submissions.$id.tsx

import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { requireCustomer, requireAppProxy } from "../lib/app-proxy.server";
import {
  getSubmissionById,
  getSubmissionStatus,
  submitSubmission,
} from "../lib/submissions.server";

/**
 * GET /apps/trade-in/submissions/:id
 *
 * Get submission details with status timeline
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { id } = params;
  if (!id) {
    return Response.json({ error: "Submission ID required" }, { status: 400 });
  }

  // Allow both logged-in view and lookup by submission number (for tracking)
  const context = requireAppProxy(request);

  const url = new URL(request.url);
  const submissionNumber = url.searchParams.get("number");

  try {
    let submission;

    if (submissionNumber) {
      // Public lookup by submission number (limited info)
      submission = await getSubmissionByNumber(submissionNumber);
      if (!submission) {
        return Response.json({ error: "Submission not found" }, { status: 404 });
      }

      // Return limited public info
      const status = await getSubmissionStatus(submission.id);
      return Response.json({
        submissionNumber: submission.submissionNumber,
        status: status?.status,
        statusLabel: status?.statusLabel,
        statusDescription: status?.statusDescription,
        timeline: status?.timeline,
        // Don't expose items or totals publicly
      });
    }

    // Full access requires customer login
    if (!context.customerId) {
      return Response.json({ error: "Login required for full details" }, { status: 401 });
    }

    submission = await getSubmissionById(id);
    if (!submission) {
      return Response.json({ error: "Submission not found" }, { status: 404 });
    }

    // Verify ownership
    const customer = await findCustomerByShopifyId(context.customerId);
    if (!customer || submission.customerId !== customer.id) {
      return Response.json({ error: "Not authorized" }, { status: 403 });
    }

    const status = await getSubmissionStatus(id);

    return Response.json({
      submission: formatSubmissionForAPI(submission),
      status,
    });

  } catch (error) {
    console.error("Get submission error:", error);
    return Response.json({ error: "Failed to fetch submission" }, { status: 500 });
  }
}

/**
 * PUT /apps/trade-in/submissions/:id
 *
 * Update submission (submit for processing)
 */
export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method !== "PUT") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const { id } = params;
  if (!id) {
    return Response.json({ error: "Submission ID required" }, { status: 400 });
  }

  const context = requireCustomer(request);

  let body: { action: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Verify ownership first
  const submission = await getSubmissionById(id);
  if (!submission) {
    return Response.json({ error: "Submission not found" }, { status: 404 });
  }

  const customer = await findCustomerByShopifyId(context.customerId);
  if (!customer || submission.customerId !== customer.id) {
    return Response.json({ error: "Not authorized" }, { status: 403 });
  }

  try {
    if (body.action === "submit") {
      const updated = await submitSubmission(id);

      // Send confirmation email
      await sendSubmissionConfirmationEmail(updated);

      return Response.json({
        success: true,
        submission: formatSubmissionForAPI(updated),
      });
    }

    return Response.json({ error: "Invalid action" }, { status: 400 });

  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return Response.json({ error: message }, { status: 400 });
  }
}

// Edge Cases:
// 1. Submission already submitted → Return 409 Conflict
// 2. Empty submission (no items) → Return 400 with clear error
// 3. Customer deleted their Shopify account → Handle gracefully
// 4. Concurrent modification → Use optimistic locking
```

### 3.4 Confirm/Reject Actions

```typescript
// app/routes/api.submissions.$id.confirm.tsx

import type { ActionFunctionArgs } from "react-router";
import { requireCustomer } from "../lib/app-proxy.server";
import { confirmSubmission, getSubmissionById } from "../lib/submissions.server";
import { sendGradingConfirmedEmail } from "../lib/notifications.server";

/**
 * POST /apps/trade-in/submissions/:id/confirm
 *
 * Customer confirms grading results
 */
export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const { id } = params;
  if (!id) {
    return Response.json({ error: "Submission ID required" }, { status: 400 });
  }

  const context = requireCustomer(request);

  // Find customer
  const customer = await findCustomerByShopifyId(context.customerId);
  if (!customer) {
    return Response.json({ error: "Customer not found" }, { status: 404 });
  }

  try {
    const submission = await confirmSubmission(id, customer.id);

    // Send confirmation email
    await sendGradingConfirmedEmail(submission);

    // Trigger payout creation (Phase 2 integration)
    await createPayoutForSubmission(submission.id);

    return Response.json({
      success: true,
      message: "Submission confirmed. Your payout is being processed.",
    });

  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return Response.json({ error: message }, { status: 400 });
  }
}
```

```typescript
// app/routes/api.submissions.$id.reject.tsx

import type { ActionFunctionArgs } from "react-router";
import { requireCustomer } from "../lib/app-proxy.server";
import { rejectSubmission, getSubmissionById } from "../lib/submissions.server";
import { sendReturnRequestedEmail } from "../lib/notifications.server";

/**
 * POST /apps/trade-in/submissions/:id/reject
 *
 * Customer rejects grading and requests return
 */
export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const { id } = params;
  if (!id) {
    return Response.json({ error: "Submission ID required" }, { status: 400 });
  }

  const context = requireCustomer(request);

  let body: { reason?: string };
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const reason = body.reason?.trim() || "No reason provided";

  // Validate reason length
  if (reason.length > 500) {
    return Response.json({ error: "Reason must be under 500 characters" }, { status: 400 });
  }

  const customer = await findCustomerByShopifyId(context.customerId);
  if (!customer) {
    return Response.json({ error: "Customer not found" }, { status: 404 });
  }

  try {
    const submission = await rejectSubmission(id, customer.id, reason);

    // Send notification emails
    await sendReturnRequestedEmail(submission, reason);
    await notifyMerchantOfRejection(submission, reason);

    return Response.json({
      success: true,
      message: "Return requested. We will ship your cards back within 2-3 business days.",
    });

  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return Response.json({ error: message }, { status: 400 });
  }
}

// Edge Cases:
// 1. Customer changes mind after rejecting → Not allowed, show error
// 2. Return address on file changed → Use address from when package received
// 3. Cards damaged during grading → Escalate to support
// 4. Merchant disputes rejection → Add internal note for review
```

### 3.5 Shipping Label & Instructions

```typescript
// app/routes/api.shipping.label.$id.tsx

import type { LoaderFunctionArgs } from "react-router";
import { requireCustomer } from "../lib/app-proxy.server";
import { generateLabelHTML, generateShippingLabel } from "../lib/shipping.server";
import { getSubmissionById } from "../lib/submissions.server";

/**
 * GET /apps/trade-in/shipping/label/:id
 *
 * Get printable shipping label HTML
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { id } = params;
  if (!id) {
    return Response.json({ error: "Submission ID required" }, { status: 400 });
  }

  const context = requireCustomer(request);

  // Verify ownership
  const submission = await getSubmissionById(id);
  if (!submission) {
    return Response.json({ error: "Submission not found" }, { status: 404 });
  }

  const customer = await findCustomerByShopifyId(context.customerId);
  if (!customer || submission.customerId !== customer.id) {
    return Response.json({ error: "Not authorized" }, { status: 403 });
  }

  // Only generate labels for submitted orders
  if (submission.status !== "SUBMITTED" && submission.status !== "IN_TRANSIT") {
    return Response.json({
      error: "Shipping label not available for this submission status"
    }, { status: 400 });
  }

  try {
    // Generate label if not already created
    if (!submission.trackingNumber) {
      await generateShippingLabel({ submissionId: id });
    }

    const html = await generateLabelHTML(id);

    return new Response(html, {
      headers: {
        "Content-Type": "text/html",
        "Content-Disposition": `inline; filename="label-${submission.submissionNumber}.html"`,
      },
    });

  } catch (error) {
    console.error("Generate label error:", error);
    return Response.json({ error: "Failed to generate label" }, { status: 500 });
  }
}
```

```typescript
// app/routes/api.shipping.instructions.$id.tsx

import type { LoaderFunctionArgs } from "react-router";
import { requireCustomer } from "../lib/app-proxy.server";
import { getSelfShipInstructions } from "../lib/shipping.server";
import { getSubmissionById } from "../lib/submissions.server";

/**
 * GET /apps/trade-in/shipping/instructions/:id
 *
 * Get self-ship instructions for a submission
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { id } = params;
  if (!id) {
    return Response.json({ error: "Submission ID required" }, { status: 400 });
  }

  const context = requireCustomer(request);

  // Verify ownership
  const submission = await getSubmissionById(id);
  if (!submission) {
    return Response.json({ error: "Submission not found" }, { status: 404 });
  }

  const customer = await findCustomerByShopifyId(context.customerId);
  if (!customer || submission.customerId !== customer.id) {
    return Response.json({ error: "Not authorized" }, { status: 403 });
  }

  try {
    const instructions = await getSelfShipInstructions(id);

    return Response.json(instructions);

  } catch (error) {
    console.error("Get instructions error:", error);
    return Response.json({ error: "Failed to get instructions" }, { status: 500 });
  }
}
```

---

## 4. Email Notifications

### 4.1 Notification Service

```typescript
// app/lib/notifications.server.ts

import prisma from "../db.server";
import { formatPrice } from "./constants";

// ============================================================================
// Types
// ============================================================================

export enum NotificationType {
  SUBMISSION_CREATED = "submission_created",
  SUBMISSION_RECEIVED = "submission_received",
  GRADING_COMPLETE = "grading_complete",
  PAYOUT_ISSUED = "payout_issued",
  RETURN_SHIPPED = "return_shipped",
  MERCHANT_NEW_SUBMISSION = "merchant_new_submission",
  MERCHANT_RETURN_REQUESTED = "merchant_return_requested",
}

interface EmailContent {
  to: string;
  subject: string;
  text: string;
  html: string;
}

interface SubmissionEmailContext {
  customerName: string;
  customerEmail: string;
  submissionNumber: string;
  quotedTotal: number;
  finalTotal?: number;
  itemCount: number;
  payoutType: string;
  trackingUrl?: string;
}

// ============================================================================
// Email Templates
// ============================================================================

const BASE_URL = process.env.SHOP_URL || "https://mystore.com";

function buildTrackingUrl(submissionNumber: string): string {
  return `${BASE_URL}/apps/trade-in/track?number=${submissionNumber}`;
}

/**
 * Submission Created - Sent when customer submits trade-in
 */
export function buildSubmissionCreatedEmail(ctx: SubmissionEmailContext): EmailContent {
  const trackingUrl = buildTrackingUrl(ctx.submissionNumber);

  return {
    to: ctx.customerEmail,
    subject: `Trade-In ${ctx.submissionNumber} Submitted`,
    text: `
Hi ${ctx.customerName},

Thank you for your trade-in submission!

Submission: ${ctx.submissionNumber}
Items: ${ctx.itemCount}
Quoted Total: ${formatPrice(ctx.quotedTotal)}
Payout Method: ${ctx.payoutType === "STORE_CREDIT" ? "Store Credit (includes bonus)" : ctx.payoutType}

Next Steps:
1. Print your shipping label or use our return address
2. Package your cards securely
3. Drop off at your nearest Post Office

Track your submission: ${trackingUrl}

Questions? Reply to this email.

Thanks for trading with us!
CardForum Team
    `.trim(),
    html: buildEmailHtml({
      title: "Trade-In Submitted",
      greeting: `Hi ${ctx.customerName},`,
      body: `
        <p>Thank you for your trade-in submission!</p>

        <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
          <tr>
            <td style="padding: 10px; border-bottom: 1px solid #eee;"><strong>Submission</strong></td>
            <td style="padding: 10px; border-bottom: 1px solid #eee;">${ctx.submissionNumber}</td>
          </tr>
          <tr>
            <td style="padding: 10px; border-bottom: 1px solid #eee;"><strong>Items</strong></td>
            <td style="padding: 10px; border-bottom: 1px solid #eee;">${ctx.itemCount}</td>
          </tr>
          <tr>
            <td style="padding: 10px; border-bottom: 1px solid #eee;"><strong>Quoted Total</strong></td>
            <td style="padding: 10px; border-bottom: 1px solid #eee;">${formatPrice(ctx.quotedTotal)}</td>
          </tr>
          <tr>
            <td style="padding: 10px; border-bottom: 1px solid #eee;"><strong>Payout</strong></td>
            <td style="padding: 10px; border-bottom: 1px solid #eee;">${ctx.payoutType === "STORE_CREDIT" ? "Store Credit (includes bonus)" : ctx.payoutType}</td>
          </tr>
        </table>

        <h3>Next Steps</h3>
        <ol>
          <li>Print your shipping label or use our return address</li>
          <li>Package your cards securely</li>
          <li>Drop off at your nearest Post Office</li>
        </ol>
      `,
      cta: { text: "Track Your Submission", url: trackingUrl },
    }),
  };
}

/**
 * Grading Complete - Sent when all items have been graded
 */
export function buildGradingCompleteEmail(
  ctx: SubmissionEmailContext & {
    hasAdjustments: boolean;
    adjustedItems: Array<{ name: string; originalCondition: string; newCondition: string }>;
  }
): EmailContent {
  const trackingUrl = buildTrackingUrl(ctx.submissionNumber);
  const priceDiff = (ctx.finalTotal || 0) - ctx.quotedTotal;

  return {
    to: ctx.customerEmail,
    subject: `Trade-In ${ctx.submissionNumber} Grading Complete${ctx.hasAdjustments ? " - Review Required" : ""}`,
    text: `
Hi ${ctx.customerName},

We've finished grading your trade-in ${ctx.submissionNumber}.

Original Quote: ${formatPrice(ctx.quotedTotal)}
Final Value: ${formatPrice(ctx.finalTotal || 0)}
${priceDiff !== 0 ? `Difference: ${priceDiff > 0 ? "+" : ""}${formatPrice(priceDiff)}` : ""}

${ctx.hasAdjustments ? `
Some items were graded at different conditions:
${ctx.adjustedItems.map(item => `- ${item.name}: ${item.originalCondition} → ${item.newCondition}`).join("\n")}

Please review and approve your submission: ${trackingUrl}
` : `
All items matched your claimed conditions!
Your payout is being processed.
`}

Thanks for trading with us!
CardForum Team
    `.trim(),
    html: buildEmailHtml({
      title: ctx.hasAdjustments ? "Review Your Grading Results" : "Grading Complete",
      greeting: `Hi ${ctx.customerName},`,
      body: `
        <p>We've finished grading your trade-in.</p>

        <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
          <tr>
            <td style="padding: 10px; border-bottom: 1px solid #eee;"><strong>Original Quote</strong></td>
            <td style="padding: 10px; border-bottom: 1px solid #eee;">${formatPrice(ctx.quotedTotal)}</td>
          </tr>
          <tr>
            <td style="padding: 10px; border-bottom: 1px solid #eee;"><strong>Final Value</strong></td>
            <td style="padding: 10px; border-bottom: 1px solid #eee; ${priceDiff < 0 ? "color: #d00;" : ""}">${formatPrice(ctx.finalTotal || 0)}</td>
          </tr>
          ${priceDiff !== 0 ? `
          <tr>
            <td style="padding: 10px; border-bottom: 1px solid #eee;"><strong>Difference</strong></td>
            <td style="padding: 10px; border-bottom: 1px solid #eee; color: ${priceDiff > 0 ? "#080" : "#d00"};">${priceDiff > 0 ? "+" : ""}${formatPrice(priceDiff)}</td>
          </tr>
          ` : ""}
        </table>

        ${ctx.hasAdjustments ? `
          <h3>Adjusted Items</h3>
          <ul>
            ${ctx.adjustedItems.map(item => `
              <li>${item.name}: <strike>${item.originalCondition}</strike> → <strong>${item.newCondition}</strong></li>
            `).join("")}
          </ul>
          <p><strong>Please review and approve your submission to proceed with payout.</strong></p>
        ` : `
          <p style="color: #080;"><strong>All items matched your claimed conditions!</strong></p>
          <p>Your payout is being processed.</p>
        `}
      `,
      cta: ctx.hasAdjustments
        ? { text: "Review & Approve", url: trackingUrl }
        : { text: "View Submission", url: trackingUrl },
    }),
  };
}

/**
 * Payout Issued - Sent when payout is complete
 */
export function buildPayoutIssuedEmail(
  ctx: SubmissionEmailContext & {
    payoutAmount: number;
    giftCardCode?: string;
    bankReference?: string;
  }
): EmailContent {
  return {
    to: ctx.customerEmail,
    subject: `Trade-In ${ctx.submissionNumber} Payout Complete`,
    text: `
Hi ${ctx.customerName},

Great news! Your payout has been issued.

Submission: ${ctx.submissionNumber}
Amount: ${formatPrice(ctx.payoutAmount)}
Method: ${ctx.payoutType}
${ctx.giftCardCode ? `Gift Card Code: ${ctx.giftCardCode}` : ""}
${ctx.bankReference ? `Reference: ${ctx.bankReference}` : ""}

${ctx.giftCardCode ? "Use your gift card at checkout - it never expires!" : ""}
${ctx.bankReference ? "Your bank transfer should arrive within 2-3 business days." : ""}

Thanks for trading with us!
CardForum Team
    `.trim(),
    html: buildEmailHtml({
      title: "Payout Complete!",
      greeting: `Hi ${ctx.customerName},`,
      body: `
        <p>Great news! Your payout has been issued.</p>

        <div style="background: #f0fff0; border: 1px solid #0a0; padding: 20px; margin: 20px 0; text-align: center;">
          <div style="font-size: 24px; font-weight: bold; color: #080;">${formatPrice(ctx.payoutAmount)}</div>
          <div style="color: #666;">${ctx.payoutType === "STORE_CREDIT" ? "Store Credit" : ctx.payoutType}</div>
        </div>

        ${ctx.giftCardCode ? `
          <p><strong>Gift Card Code:</strong> <code style="background: #f0f0f0; padding: 5px 10px; font-size: 18px;">${ctx.giftCardCode}</code></p>
          <p>Use your gift card at checkout - it never expires!</p>
        ` : ""}

        ${ctx.bankReference ? `
          <p><strong>Bank Reference:</strong> ${ctx.bankReference}</p>
          <p>Your transfer should arrive within 2-3 business days.</p>
        ` : ""}
      `,
      cta: { text: "Shop Now", url: BASE_URL },
    }),
  };
}

// ============================================================================
// HTML Template Helper
// ============================================================================

function buildEmailHtml(opts: {
  title: string;
  greeting: string;
  body: string;
  cta?: { text: string; url: string };
}): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${opts.title}</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: #000; color: #fff; padding: 20px; text-align: center; margin-bottom: 30px;">
    <h1 style="margin: 0; font-size: 24px;">CardForum</h1>
    <p style="margin: 5px 0 0; font-size: 14px;">Trading Card Trade-Ins</p>
  </div>

  <h2 style="color: #000; border-bottom: 2px solid #000; padding-bottom: 10px;">${opts.title}</h2>

  <p>${opts.greeting}</p>

  ${opts.body}

  ${opts.cta ? `
    <p style="text-align: center; margin: 30px 0;">
      <a href="${opts.cta.url}" style="display: inline-block; background: #000; color: #fff; padding: 15px 30px; text-decoration: none; font-weight: bold;">${opts.cta.text}</a>
    </p>
  ` : ""}

  <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">

  <p style="font-size: 12px; color: #666;">
    Questions? Reply to this email or contact support@cardforum.co.uk<br>
    CardForum Ltd, Cambridge, UK
  </p>
</body>
</html>
  `.trim();
}

// ============================================================================
// Email Sending
// ============================================================================

/**
 * Send email using configured provider
 * MVP: Console logging. Production: Integrate SendGrid/Postmark/etc.
 */
export async function sendEmail(email: EmailContent): Promise<void> {
  // Log in development
  if (process.env.NODE_ENV !== "production") {
    console.log("📧 Email would be sent:", {
      to: email.to,
      subject: email.subject,
    });
    return;
  }

  // Production: Integrate with email provider
  // Example with SendGrid:
  // const sgMail = require("@sendgrid/mail");
  // sgMail.setApiKey(process.env.SENDGRID_API_KEY);
  // await sgMail.send({
  //   to: email.to,
  //   from: "trade-in@cardforum.co.uk",
  //   subject: email.subject,
  //   text: email.text,
  //   html: email.html,
  // });

  throw new Error("Email provider not configured");
}

// ============================================================================
// Convenience Functions
// ============================================================================

export async function sendSubmissionConfirmationEmail(submission: any): Promise<void> {
  const ctx = await buildSubmissionContext(submission);
  const email = buildSubmissionCreatedEmail(ctx);
  await sendEmail(email);
}

export async function sendGradingCompleteEmail(submission: any): Promise<void> {
  const ctx = await buildSubmissionContext(submission);
  const items = await prisma.tradeInItem.findMany({
    where: { submissionId: submission.id },
  });

  const adjustedItems = items
    .filter(item => item.conditionActual && item.conditionActual !== item.conditionClaimed)
    .map(item => ({
      name: item.cardName,
      originalCondition: item.conditionClaimed,
      newCondition: item.conditionActual!,
    }));

  const email = buildGradingCompleteEmail({
    ...ctx,
    finalTotal: submission.finalTotal,
    hasAdjustments: adjustedItems.length > 0,
    adjustedItems,
  });

  await sendEmail(email);
}

async function buildSubmissionContext(submission: any): Promise<SubmissionEmailContext> {
  const customer = submission.customer || await prisma.customer.findUnique({
    where: { id: submission.customerId },
  });

  const itemCount = submission.items?.length || await prisma.tradeInItem.count({
    where: { submissionId: submission.id },
  });

  return {
    customerName: [customer?.firstName, customer?.lastName].filter(Boolean).join(" ") || "Customer",
    customerEmail: customer?.email || "",
    submissionNumber: submission.submissionNumber,
    quotedTotal: submission.quotedTotal,
    finalTotal: submission.finalTotal,
    itemCount,
    payoutType: submission.payoutType,
  };
}
```

### 4.2 Notification Settings

```typescript
// Check notification preferences before sending
async function shouldSendNotification(type: NotificationType): Promise<boolean> {
  const settings = await prisma.tradeInSettings.findFirst();

  switch (type) {
    case NotificationType.SUBMISSION_CREATED:
      return settings?.notifyOnSubmission ?? true;
    case NotificationType.SUBMISSION_RECEIVED:
      return settings?.notifyOnReceived ?? true;
    case NotificationType.GRADING_COMPLETE:
      return settings?.notifyOnGraded ?? true;
    default:
      return true;
  }
}
```

---

## 5. Webhook Handlers

### 5.1 Shopify Webhooks

```typescript
// app/routes/webhooks.tsx

import type { ActionFunctionArgs } from "react-router";
import crypto from "crypto";
import prisma from "../db.server";

/**
 * Verify Shopify webhook signature
 */
function verifyWebhook(request: Request, body: string): boolean {
  const hmac = request.headers.get("X-Shopify-Hmac-Sha256");
  if (!hmac) return false;

  const secret = process.env.SHOPIFY_API_SECRET;
  if (!secret) return false;

  const calculated = crypto
    .createHmac("sha256", secret)
    .update(body, "utf8")
    .digest("base64");

  return crypto.timingSafeEqual(
    Buffer.from(hmac),
    Buffer.from(calculated)
  );
}

export async function action({ request }: ActionFunctionArgs) {
  const topic = request.headers.get("X-Shopify-Topic");
  const shop = request.headers.get("X-Shopify-Shop-Domain");
  const body = await request.text();

  // Verify signature
  if (!verifyWebhook(request, body)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const payload = JSON.parse(body);

  try {
    switch (topic) {
      case "customers/update":
        await handleCustomerUpdate(payload);
        break;

      case "customers/delete":
        await handleCustomerDelete(payload);
        break;

      case "app/uninstalled":
        await handleAppUninstalled(shop!);
        break;

      default:
        console.log(`Unhandled webhook: ${topic}`);
    }

    return new Response("OK", { status: 200 });

  } catch (error) {
    console.error(`Webhook error (${topic}):`, error);
    return new Response("Error", { status: 500 });
  }
}

/**
 * Handle customer update - sync email changes
 */
async function handleCustomerUpdate(payload: any) {
  const shopifyId = String(payload.id);
  const email = payload.email?.toLowerCase();
  const firstName = payload.first_name;
  const lastName = payload.last_name;

  const customer = await prisma.customer.findUnique({
    where: { shopifyCustomerId: shopifyId },
  });

  if (customer && email) {
    await prisma.customer.update({
      where: { id: customer.id },
      data: { email, firstName, lastName },
    });
  }
}

/**
 * Handle customer delete - anonymize data
 */
async function handleCustomerDelete(payload: any) {
  const shopifyId = String(payload.id);

  // GDPR compliance: anonymize rather than delete
  // to preserve submission history
  await prisma.customer.updateMany({
    where: { shopifyCustomerId: shopifyId },
    data: {
      email: `deleted-${shopifyId}@anonymized.local`,
      firstName: "Deleted",
      lastName: "Customer",
      phone: null,
      shopifyCustomerId: null,
    },
  });
}

/**
 * Handle app uninstall - clean up settings
 */
async function handleAppUninstalled(shop: string) {
  // Keep submission data for records
  // Only delete shop-specific settings
  await prisma.tradeInSettings.deleteMany({
    where: { shop },
  });
}
```

---

## 6. Testing Strategy

### 6.1 Unit Tests

```typescript
// app/lib/__tests__/app-proxy.test.ts

describe("App Proxy Validation", () => {
  describe("validateAppProxy", () => {
    it("should accept valid signature with all parameters");
    it("should reject missing signature");
    it("should reject expired timestamp (> 5 min)");
    it("should reject tampered parameters");
    it("should handle missing SHOPIFY_API_SECRET");
    it("should be timing-safe against side-channel attacks");
  });

  describe("requireCustomer", () => {
    it("should return context when customer logged in");
    it("should throw 401 for guest users");
    it("should throw 401 for invalid signature");
  });
});
```

```typescript
// app/lib/__tests__/notifications.test.ts

describe("Email Notifications", () => {
  describe("buildSubmissionCreatedEmail", () => {
    it("should include submission number in subject");
    it("should include tracking URL");
    it("should format currency correctly");
    it("should indicate store credit bonus");
  });

  describe("buildGradingCompleteEmail", () => {
    it("should show original and final totals");
    it("should list adjusted items when present");
    it("should show positive message when no adjustments");
    it("should include review CTA when adjustments present");
  });

  describe("buildPayoutIssuedEmail", () => {
    it("should include gift card code for store credit");
    it("should include bank reference for bank transfer");
    it("should show payout amount prominently");
  });
});
```

### 6.2 API Route Tests

```typescript
// app/routes/__tests__/api.submissions.test.ts

describe("POST /api/submissions", () => {
  it("should create submission with valid data");
  it("should return 400 for missing email");
  it("should return 400 for invalid payout type");
  it("should return 400 for empty items array");
  it("should return 400 for items below minimum value");
  it("should return 401 for invalid App Proxy signature");
  it("should link to existing customer by email");
  it("should create new customer for new email");
  it("should calculate bonus for store credit");
});

describe("GET /api/submissions/:id", () => {
  it("should return submission for owner");
  it("should return 403 for non-owner");
  it("should return 404 for non-existent submission");
  it("should include timeline in response");
  it("should include next action guidance");
});

describe("POST /api/submissions/:id/confirm", () => {
  it("should approve submission and trigger payout");
  it("should return 400 if not PENDING_APPROVAL");
  it("should return 403 for non-owner");
  it("should send confirmation email");
});
```

### 6.3 Integration Tests

```typescript
describe("Full Submission Flow", () => {
  it("should complete full lifecycle: create → submit → receive → grade → approve → payout");
  it("should handle rejection flow: grade → reject → return");
  it("should handle guest submission with email verification");
});
```

---

## 7. Error Handling

### 7.1 Standard Error Responses

```typescript
// Consistent API error format
interface APIError {
  error: string;           // Machine-readable error code
  message: string;         // Human-readable message
  details?: string[];      // Additional context
  requestId?: string;      // For support debugging
}

// HTTP Status Code Usage:
// 200 - Success
// 201 - Created (new submission)
// 400 - Bad Request (validation errors)
// 401 - Unauthorized (invalid signature)
// 403 - Forbidden (not owner)
// 404 - Not Found
// 409 - Conflict (duplicate submission, invalid state)
// 429 - Rate Limited
// 500 - Server Error
```

### 7.2 Error Logging

```typescript
// Structured error logging for debugging
function logAPIError(
  request: Request,
  error: Error,
  context: Record<string, any>
): void {
  const requestId = crypto.randomUUID();

  console.error(JSON.stringify({
    requestId,
    timestamp: new Date().toISOString(),
    method: request.method,
    url: request.url,
    error: error.message,
    stack: error.stack,
    ...context,
  }));
}
```

---

## 8. Security Considerations

### 8.1 Input Validation

- Sanitize all user input before database operations
- Limit string lengths (card names, reasons, etc.)
- Validate enum values strictly
- Reject unexpected JSON properties

### 8.2 Rate Limiting

```typescript
// Per-customer rate limits (enforced at CDN/API gateway level)
const RATE_LIMITS = {
  "POST /api/submissions": "10/hour",
  "GET /api/cards/search": "100/minute",
  "GET /api/shipping/label/*": "5/minute",
  "POST /api/submissions/*/confirm": "3/minute",
};
```

### 8.3 Data Access

- Always verify customer ownership before returning/modifying data
- Never expose internal IDs in public responses (use submission numbers)
- Redact sensitive info in logs (emails, gift card codes)
- Don't reveal whether a submission number exists to non-owners

---

## 9. Implementation Order

### Step 1: App Proxy Foundation
1. Create `app/lib/app-proxy.server.ts` with signature validation
2. Write unit tests for App Proxy validation
3. Configure App Proxy in Shopify Partners Dashboard

### Step 2: Card Search API
1. Create `app/routes/api.cards.search.tsx`
2. Write API tests
3. Test via App Proxy URL

### Step 3: Submissions API
1. Create `app/routes/api.submissions.tsx` (list/create)
2. Create `app/routes/api.submissions.$id.tsx` (get/update)
3. Write comprehensive tests

### Step 4: Submission Actions
1. Create `app/routes/api.submissions.$id.confirm.tsx`
2. Create `app/routes/api.submissions.$id.reject.tsx`
3. Create `app/routes/api.submissions.$id.items.tsx`
4. Write action tests

### Step 5: Shipping API
1. Create `app/routes/api.shipping.label.$id.tsx`
2. Create `app/routes/api.shipping.instructions.$id.tsx`
3. Write shipping tests

### Step 6: Notifications
1. Create `app/lib/notifications.server.ts`
2. Integrate with submission lifecycle
3. Write notification tests
4. Configure email provider (SendGrid/Postmark)

### Step 7: Webhooks
1. Create `app/routes/webhooks.tsx`
2. Register webhooks in Shopify
3. Write webhook handler tests

### Step 8: Documentation & Polish
1. Update CLAUDE.md with Phase 4 status
2. Create API documentation
3. Add request logging and monitoring
4. Performance optimization

---

## 10. API Summary

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | /api/cards/search | App Proxy | Search card catalog |
| GET | /api/submissions | Customer | List customer submissions |
| POST | /api/submissions | App Proxy | Create new submission |
| GET | /api/submissions/:id | Customer | Get submission details |
| PUT | /api/submissions/:id | Customer | Submit for processing |
| POST | /api/submissions/:id/confirm | Customer | Approve grading |
| POST | /api/submissions/:id/reject | Customer | Reject & request return |
| POST | /api/submissions/:id/items | Customer | Add item to draft |
| DELETE | /api/submissions/:id/items/:itemId | Customer | Remove item from draft |
| GET | /api/shipping/label/:id | Customer | Get printable label |
| GET | /api/shipping/instructions/:id | Customer | Get self-ship instructions |
| POST | /webhooks | Shopify | Handle Shopify webhooks |

---

## Summary

Phase 4 connects the customer-facing experience to the backend:

- **API Routes**: RESTful endpoints via Shopify App Proxy
- **Authentication**: Secure customer identification via HMAC signature
- **Notifications**: Automated emails at every stage
- **Webhooks**: React to Shopify events

This enables customers to:
1. Search for cards and build trade-in lists
2. Submit and track submissions
3. Receive email updates
4. Review grading and approve/reject
5. Get shipping labels and instructions

After Phase 4, the system will be feature-complete for the MVP launch.
