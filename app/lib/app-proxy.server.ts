/**
 * Shopify App Proxy authentication and validation
 * Validates HMAC signatures for requests coming through App Proxy
 *
 * @see https://shopify.dev/docs/apps/online-store/app-proxies
 */

import crypto from "crypto";
import prisma from "../db.server";

// ============================================================================
// Types
// ============================================================================

export interface AppProxyContext {
  shop: string;
  customerId: string | null;
  locale: string;
  timestamp: string;
  isValid: boolean;
  path_prefix: string;
}

export interface AppProxyContextWithCustomer extends AppProxyContext {
  customerId: string;
  internalCustomerId: string;
}

// ============================================================================
// Signature Validation
// ============================================================================

/**
 * Validate Shopify App Proxy request signature
 *
 * Shopify signs all App Proxy requests with HMAC-SHA256 using SHOPIFY_API_SECRET.
 * The signature is computed over sorted query parameters (excluding signature itself).
 *
 * @param request - The incoming request
 * @returns AppProxyContext with validation result
 */
export function validateAppProxy(request: Request): AppProxyContext {
  const url = new URL(request.url);
  const params = new URLSearchParams(url.search);

  const signature = params.get("signature");
  const timestamp = params.get("timestamp");
  const shop = params.get("shop");
  const loggedInCustomerId = params.get("logged_in_customer_id");
  const pathPrefix = params.get("path_prefix") || "";
  const locale = params.get("locale") || "en";

  // Default context (invalid)
  const context: AppProxyContext = {
    shop: shop || "",
    customerId: loggedInCustomerId || null,
    locale,
    timestamp: timestamp || "",
    isValid: false,
    path_prefix: pathPrefix,
  };

  // Require minimum parameters
  if (!signature || !timestamp || !shop) {
    return context;
  }

  // Check timestamp is within 5 minutes (300 seconds)
  const requestTime = parseInt(timestamp, 10);
  const now = Math.floor(Date.now() / 1000);
  if (isNaN(requestTime) || Math.abs(now - requestTime) > 300) {
    console.warn("App Proxy request timestamp invalid or expired");
    return context;
  }

  // Get API secret
  const secret = process.env.SHOPIFY_API_SECRET;
  if (!secret) {
    console.error("SHOPIFY_API_SECRET not configured");
    return context;
  }

  // Build message for HMAC verification
  // Remove signature param, sort remaining params alphabetically
  params.delete("signature");
  const sortedParams = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("");

  // Calculate expected signature
  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(sortedParams)
    .digest("hex");

  // Timing-safe comparison to prevent timing attacks
  try {
    const signatureBuffer = Buffer.from(signature, "hex");
    const expectedBuffer = Buffer.from(expectedSignature, "hex");

    if (
      signatureBuffer.length !== expectedBuffer.length ||
      !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)
    ) {
      console.warn("App Proxy signature mismatch");
      return context;
    }
  } catch {
    console.warn("App Proxy signature comparison failed");
    return context;
  }

  context.isValid = true;
  return context;
}

/**
 * Require valid App Proxy context, throw 401 Response if invalid
 *
 * @param request - The incoming request
 * @returns Valid AppProxyContext
 * @throws Response with 401 status if invalid
 */
export function requireAppProxy(request: Request): AppProxyContext {
  const context = validateAppProxy(request);

  if (!context.isValid) {
    throw new Response(
      JSON.stringify({ error: "unauthorized", message: "Invalid request signature" }),
      {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  return context;
}

/**
 * Require logged-in customer, throw 401 Response if not authenticated
 *
 * @param request - The incoming request
 * @returns AppProxyContext with customerId guaranteed
 * @throws Response with 401 status if not logged in
 */
export async function requireCustomer(
  request: Request
): Promise<AppProxyContextWithCustomer> {
  const context = requireAppProxy(request);

  if (!context.customerId) {
    throw new Response(
      JSON.stringify({ error: "login_required", message: "Customer login required" }),
      {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  // Find internal customer record
  const customer = await findCustomerByShopifyId(context.customerId);
  if (!customer) {
    throw new Response(
      JSON.stringify({ error: "customer_not_found", message: "Customer record not found" }),
      {
        status: 404,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  return {
    ...context,
    customerId: context.customerId,
    internalCustomerId: customer.id,
  };
}

/**
 * Find customer by Shopify customer ID
 */
export async function findCustomerByShopifyId(shopifyCustomerId: string) {
  return prisma.customer.findUnique({
    where: { shopifyCustomerId },
  });
}

/**
 * Find customer by email
 */
export async function findCustomerByEmail(email: string) {
  return prisma.customer.findFirst({
    where: { email: email.toLowerCase() },
  });
}

// ============================================================================
// Rate Limiting Types (for documentation - implement at API gateway level)
// ============================================================================

export const RATE_LIMITS = {
  "POST /api/submissions": { max: 10, windowSeconds: 3600 }, // 10/hour
  "GET /api/cards/search": { max: 100, windowSeconds: 60 }, // 100/minute
  "GET /api/shipping/label": { max: 5, windowSeconds: 60 }, // 5/minute
  "POST /api/submissions/confirm": { max: 3, windowSeconds: 60 }, // 3/minute
} as const;

// ============================================================================
// Input Validation Helpers
// ============================================================================

/**
 * Validate email format
 */
export function isValidEmail(email: string): boolean {
  if (!email || typeof email !== "string") return false;
  // Basic email validation - allows most valid emails
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

/**
 * Sanitize string input (trim and limit length)
 */
export function sanitizeString(input: unknown, maxLength = 500): string {
  if (typeof input !== "string") return "";
  return input.trim().slice(0, maxLength);
}

/**
 * Parse positive integer from string/number
 */
export function parsePositiveInt(input: unknown, defaultValue = 0): number {
  if (typeof input === "number" && Number.isInteger(input) && input > 0) {
    return input;
  }
  if (typeof input === "string") {
    const parsed = parseInt(input, 10);
    if (!isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return defaultValue;
}

// ============================================================================
// Error Response Helpers
// ============================================================================

export interface APIError {
  error: string;
  message: string;
  details?: string[];
}

/**
 * Create a JSON error response
 */
export function errorResponse(
  status: number,
  error: string,
  message: string,
  details?: string[]
): Response {
  const body: APIError = { error, message };
  if (details && details.length > 0) {
    body.details = details;
  }

  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Create a JSON success response
 */
export function jsonResponse<T>(data: T, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
