/**
 * Shopify App Proxy authentication and validation
 * Validates HMAC signatures for requests coming through App Proxy
 * Also supports Session Token (JWT) authentication for Customer Account UI Extensions
 *
 * @see https://shopify.dev/docs/apps/online-store/app-proxies
 * @see https://shopify.dev/docs/api/customer-account-ui-extensions/apis/session-token
 *
 * @synapse CODE_SYNAPSE.md - See ./CODE_SYNAPSE.md for full module dependency graph
 *
 * AUTHENTICATION METHODS:
 *   1. App Proxy - HMAC signature validation (Theme requests)
 *   2. Session Token - JWT validation (Customer Account UI Extensions)
 *
 * IMPORTED BY:
 *   - ../routes/api.storefront.$.tsx (validateAppProxy - entry point)
 *   - ../routes/api.my-submissions.tsx (requireCustomer)
 *   - ../routes/api.my-submissions.$number.tsx (requireCustomer)
 *   - ../routes/api.my-submissions.$number.action.tsx (requireCustomer)
 *   - ../routes/api.track.tsx (requireAppProxy)
 *   - ../routes/api.submissions.tsx (optionalCustomer)
 *
 * EXTENSION INTEGRATION:
 *   - extensions/trade-in-account/src/hooks/useSessionToken.ts (token provider)
 *   - extensions/trade-in-account/src/api/client.ts (sends Bearer token)
 *   - extensions/trade-in-blocks/assets/trade-in-account.js (sends X-Customer-Email)
 *
 * RELATED DOCS:
 *   - docs/MY_SUBMISSIONS_FLOW_INVESTIGATION.md (auth flow details)
 *   - docs/OAUTH_IMPLEMENTATION_REVIEW.md (JWT implementation)
 *   - docs/trade-in-history-extension-analysis.md (customer linking)
 */

import crypto from "crypto";
import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";
import { shopifyAdminCircuitBreaker, CircuitOpenError } from "./circuit-breaker.server";
import { withTrace, logger, metrics } from "./observability.server";

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

/**
 * Session Token (JWT) claims from Customer Account UI Extensions
 * @see https://shopify.dev/docs/api/customer-account-ui-extensions/apis/session-token
 */
export interface SessionTokenClaims {
  /** Shopify store URL */
  dest: string;
  /** App Client ID */
  aud: string;
  /** Token expiration timestamp */
  exp: number;
  /** Token "not before" timestamp */
  nbf: number;
  /** Token issued at timestamp */
  iat: number;
  /** Unique token identifier (nonce) */
  jti: string;
  /** Customer GID (e.g., "gid://shopify/Customer/12345") - only present if customer is logged in */
  sub?: string;
}

// ============================================================================
// Session Token (JWT) Validation for Customer Account UI Extensions
// ============================================================================

/**
 * Extract Bearer token from Authorization header
 */
function extractBearerToken(request: Request): string | null {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }
  return authHeader.substring(7);
}

/**
 * Base64URL decode (JWT uses base64url encoding)
 */
function base64UrlDecode(str: string): string {
  // Add padding if needed
  const padded = str + "=".repeat((4 - (str.length % 4)) % 4);
  // Replace URL-safe chars with standard base64 chars
  const base64 = padded.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(base64, "base64").toString("utf8");
}

/**
 * Verify JWT signature using HMAC-SHA256
 */
function verifyJwtSignature(
  header: string,
  payload: string,
  signature: string,
  secret: string
): boolean {
  const signatureInput = `${header}.${payload}`;
  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(signatureInput)
    .digest("base64url");

  // Timing-safe comparison
  try {
    const signatureBuffer = Buffer.from(signature, "base64url");
    const expectedBuffer = Buffer.from(expectedSignature, "base64url");

    if (signatureBuffer.length !== expectedBuffer.length) {
      return false;
    }
    return crypto.timingSafeEqual(signatureBuffer, expectedBuffer);
  } catch {
    return false;
  }
}

/**
 * Validate and decode a Shopify Session Token (JWT)
 *
 * Session tokens are JWTs signed with the app's API secret.
 * They contain customer identity in the 'sub' claim.
 *
 * @param token - The JWT token string
 * @returns Decoded claims if valid, null if invalid
 */
export function validateSessionToken(token: string): SessionTokenClaims | null {
  logger.debug("Validating session token");

  const secret = process.env.SHOPIFY_API_SECRET;
  if (!secret) {
    logger.error("Session token validation failed: SHOPIFY_API_SECRET not configured");
    return null;
  }

  const clientId = process.env.SHOPIFY_API_KEY;
  if (!clientId) {
    logger.error("Session token validation failed: SHOPIFY_API_KEY not configured");
    return null;
  }

  try {
    // Split JWT into parts
    const parts = token.split(".");
    if (parts.length !== 3) {
      logger.warn("Session token invalid: wrong number of JWT parts", { parts: parts.length });
      return null;
    }

    const [headerB64, payloadB64, signatureB64] = parts;

    // Decode payload first
    const payloadJson = base64UrlDecode(payloadB64);
    const claims = JSON.parse(payloadJson) as SessionTokenClaims;
    logger.debug("Session token claims decoded", {
      dest: claims.dest,
      aud: claims.aud,
      hasSub: !!claims.sub,
    });

    // Verify signature
    const signatureValid = verifyJwtSignature(headerB64, payloadB64, signatureB64, secret);
    if (!signatureValid) {
      logger.warn("Session token signature verification failed");
      metrics.increment("auth.session_token.signature_failed");
      return null;
    }

    // Verify audience matches our client ID
    if (claims.aud !== clientId) {
      logger.warn("Session token audience mismatch", {
        expected: clientId,
        actual: claims.aud,
      });
      metrics.increment("auth.session_token.audience_mismatch");
      return null;
    }

    // Check expiration
    const now = Math.floor(Date.now() / 1000);
    if (claims.exp < now) {
      logger.warn("Session token expired", {
        expiredAt: new Date(claims.exp * 1000).toISOString(),
      });
      metrics.increment("auth.session_token.expired");
      return null;
    }

    // Check not-before
    if (claims.nbf > now) {
      logger.warn("Session token not yet valid", {
        validFrom: new Date(claims.nbf * 1000).toISOString(),
      });
      metrics.increment("auth.session_token.not_yet_valid");
      return null;
    }

    logger.debug("Session token validation passed", { hasSub: !!claims.sub });
    metrics.increment("auth.session_token.valid");
    return claims;
  } catch (error) {
    logger.error("Session token validation error", {
      error: error instanceof Error ? error.message : String(error),
    });
    metrics.increment("auth.session_token.error");
    return null;
  }
}

/**
 * Extract Shopify customer ID from session token 'sub' claim
 * The sub claim format is: "gid://shopify/Customer/12345"
 *
 * @param sub - The 'sub' claim value
 * @returns Customer ID string or null
 */
function extractCustomerIdFromSub(sub: string): string | null {
  const match = sub.match(/^gid:\/\/shopify\/Customer\/(\d+)$/);
  return match ? match[1] : null;
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
    logger.warn("App Proxy request timestamp invalid or expired", {
      requestTime,
      now,
      diff: Math.abs(now - requestTime),
    });
    return context;
  }

  // Get API secret
  const secret = process.env.SHOPIFY_API_SECRET;
  if (!secret) {
    logger.error("App Proxy validation failed: SHOPIFY_API_SECRET not configured");
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
      logger.warn("App Proxy signature mismatch", { shop });
      metrics.increment("auth.app_proxy.signature_mismatch");
      return context;
    }
  } catch {
    logger.warn("App Proxy signature comparison failed", { shop });
    metrics.increment("auth.app_proxy.comparison_error");
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
 * Supports two authentication methods:
 * 1. App Proxy - uses `logged_in_customer_id` query parameter from Shopify
 * 2. Session Token (JWT) - uses Bearer token in Authorization header
 *
 * Auto-creates a customer record if one doesn't exist for the Shopify customer.
 * This handles the case where a customer visits "My Trade-Ins" before submitting.
 *
 * @param request - The incoming request
 * @returns AppProxyContext with customerId guaranteed
 * @throws Response with 401 status if not logged in
 */
export async function requireCustomer(
  request: Request
): Promise<AppProxyContextWithCustomer> {
  let shopifyCustomerId: string | null = null;
  let shop = "";
  let locale = "en";
  let timestamp = "";
  let pathPrefix = "";
  let authMethod: "app_proxy" | "session_token" = "app_proxy";

  logger.debug("Customer authentication check started");

  // First, try App Proxy validation (traditional method)
  const appProxyContext = validateAppProxy(request);
  logger.debug("App Proxy validation result", {
    isValid: appProxyContext.isValid,
    hasCustomerId: !!appProxyContext.customerId,
    shop: appProxyContext.shop,
  });

  if (appProxyContext.isValid && appProxyContext.customerId) {
    // App Proxy auth successful with customer ID
    shopifyCustomerId = appProxyContext.customerId;
    shop = appProxyContext.shop;
    locale = appProxyContext.locale;
    timestamp = appProxyContext.timestamp;
    pathPrefix = appProxyContext.path_prefix;
    authMethod = "app_proxy";
    logger.debug("Using App Proxy auth", { customerId: shopifyCustomerId });
  } else {
    // Try Session Token authentication (for Customer Account UI Extensions)
    const bearerToken = extractBearerToken(request);
    logger.debug("Trying Session Token auth", { hasToken: !!bearerToken });

    if (bearerToken) {
      const claims = validateSessionToken(bearerToken);

      if (claims) {
        // Session token is valid
        if (claims.sub) {
          // Extract customer ID from 'sub' claim (format: "gid://shopify/Customer/12345")
          shopifyCustomerId = extractCustomerIdFromSub(claims.sub);
          shop = claims.dest;
          authMethod = "session_token";
          logger.debug("Session Token auth successful", {
            customerId: shopifyCustomerId,
            hasSub: true,
          });

          if (!shopifyCustomerId) {
            logger.warn("Failed to parse customer ID from sub claim", { sub: claims.sub });
          }
        } else {
          // Token valid but no customer ID (customer not logged in or no permission)
          logger.warn("Session token valid but no sub claim - customer may not be logged in");
        }
      }
    } else {
      logger.debug("No Bearer token in Authorization header");
    }

    // If App Proxy signature exists but is invalid, and no valid session token, reject
    const url = new URL(request.url);
    const hasAppProxyParams = url.searchParams.get("signature") !== null;

    if (hasAppProxyParams && !appProxyContext.isValid && !shopifyCustomerId) {
      logger.warn("Auth failed: App Proxy params exist but invalid, no session token");
      metrics.increment("auth.customer.failed");
      throw new Response(
        JSON.stringify({ error: "unauthorized", message: "Invalid request signature" }),
        {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
  }

  // Require customer to be logged in
  if (!shopifyCustomerId) {
    logger.warn("Auth failed: No customer ID found from any auth method");
    metrics.increment("auth.customer.login_required");
    throw new Response(
      JSON.stringify({ error: "login_required", message: "Customer login required" }),
      {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  logger.info("Customer authenticated", { method: authMethod, customerId: shopifyCustomerId });
  metrics.increment(`auth.customer.success.${authMethod}`);

  // Find or create internal customer record
  let customer = await findCustomerByShopifyId(shopifyCustomerId);

  if (!customer) {
    // Customer not found by Shopify ID - they may have submitted as a guest before
    // Try to find and link by email
    logger.debug("Customer not found by Shopify ID, attempting to link by email", {
      shopifyCustomerId,
    });

    // Step 1: Check if email was provided via header (for backwards compatibility)
    let customerEmail = request.headers.get("X-Customer-Email")?.toLowerCase().trim();

    // Step 2: If no header, fetch email from Shopify Admin API
    if (!customerEmail || !customerEmail.includes("@") || customerEmail.endsWith("@pending.local")) {
      logger.debug("No email header, fetching from Shopify API");
      customerEmail = await getShopifyCustomerEmail(shop, shopifyCustomerId) || undefined;
    }

    if (customerEmail && customerEmail.includes("@") && !customerEmail.endsWith("@pending.local")) {
      // Try to find existing customer by email (may have submitted as guest)
      const existingByEmail = await prisma.customer.findFirst({
        where: { email: customerEmail },
      });

      if (existingByEmail && !existingByEmail.shopifyCustomerId) {
        // MERGE: Update existing customer with Shopify ID - this links guest submissions!
        customer = await prisma.customer.update({
          where: { id: existingByEmail.id },
          data: { shopifyCustomerId },
        });
        logger.info("Linked guest customer with Shopify ID", {
          customerId: existingByEmail.id,
          shopifyCustomerId,
        });
        metrics.increment("customer.linked_guest");
      } else if (existingByEmail && existingByEmail.shopifyCustomerId === shopifyCustomerId) {
        // Already linked (shouldn't happen, but handle gracefully)
        customer = existingByEmail;
        logger.debug("Customer already linked to Shopify ID", { shopifyCustomerId });
      } else if (existingByEmail) {
        // Customer exists but has different Shopify ID - edge case
        // This could happen if same email is used by different Shopify accounts
        logger.warn("Customer exists with different Shopify ID, creating new record", {
          existingShopifyId: existingByEmail.shopifyCustomerId,
          newShopifyId: shopifyCustomerId,
        });
        // Don't use this customer - fall through to create new one
      }
    }

    // Still no customer? Create new one
    if (!customer) {
      try {
        customer = await prisma.customer.create({
          data: {
            shopifyCustomerId: shopifyCustomerId,
            email: customerEmail || `shopify-${shopifyCustomerId}@pending.local`, // Use real email if available
          },
        });
        logger.info("Created new customer record", {
          shopifyCustomerId,
          hasEmail: !!customerEmail,
        });
        metrics.increment("customer.created");
      } catch (error) {
        // Handle race condition - another request might have created it
        customer = await findCustomerByShopifyId(shopifyCustomerId);
        if (!customer) {
          logger.error("Failed to create customer record", {
            shopifyCustomerId,
            error: error instanceof Error ? error.message : String(error),
          });
          throw new Response(
            JSON.stringify({ error: "customer_creation_failed", message: "Unable to create customer record" }),
            {
              status: 500,
              headers: { "Content-Type": "application/json" },
            }
          );
        }
      }
    }
  }

  return {
    shop,
    customerId: shopifyCustomerId,
    locale,
    timestamp,
    isValid: true,
    path_prefix: pathPrefix,
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
// Shopify Admin API Helpers
// ============================================================================

const GET_CUSTOMER_EMAIL_QUERY = `#graphql
  query getCustomerEmail($id: ID!) {
    customer(id: $id) {
      id
      email
    }
  }
`;

/**
 * Fetch customer email from Shopify Admin API
 * Uses offline access token stored in session
 * Protected by circuit breaker to prevent cascading failures
 *
 * @param shop - Shopify shop domain
 * @param shopifyCustomerId - Numeric Shopify customer ID
 * @returns Customer email or null if not found
 */
export async function getShopifyCustomerEmail(
  shop: string,
  shopifyCustomerId: string
): Promise<string | null> {
  if (!shop || !shopifyCustomerId) {
    return null;
  }

  return withTrace("shopify.getCustomerEmail", {
    shop,
    customerId: shopifyCustomerId,
  }, async (trace) => {
    try {
      // Circuit breaker protects against Shopify Admin API failures
      const email = await shopifyAdminCircuitBreaker.execute(
        async () => {
          trace.log("Fetching admin API access");
          const { admin } = await unauthenticated.admin(shop);

          trace.log("Querying customer email");
          const response = await admin.graphql(GET_CUSTOMER_EMAIL_QUERY, {
            variables: {
              id: `gid://shopify/Customer/${shopifyCustomerId}`,
            },
          });

          const data = await response.json();
          return data?.data?.customer?.email as string | null;
        },
        () => null // Fallback returns null if circuit is open
      );

      if (email) {
        trace.setResult("success");
        trace.addAttribute("found", true);
        metrics.increment("shopify.customer.email.found");
        logger.debug("Shopify customer email found", {
          customerId: shopifyCustomerId,
          emailDomain: email.split("@")[1] || "unknown",
        });
        return email.toLowerCase();
      }

      trace.setResult("success");
      trace.addAttribute("found", false);
      metrics.increment("shopify.customer.email.not_found");
      logger.debug("Shopify customer email not found", {
        customerId: shopifyCustomerId,
      });
      return null;
    } catch (error) {
      trace.setResult("error");
      const isCircuitOpen = error instanceof CircuitOpenError;
      trace.addAttribute("circuitOpen", isCircuitOpen);

      if (isCircuitOpen) {
        metrics.increment("shopify.customer.email.circuit_open");
        logger.warn("Shopify Admin API circuit open, skipping email fetch", {
          customerId: shopifyCustomerId,
        });
      } else {
        metrics.increment("shopify.customer.email.error");
        logger.error("Failed to fetch Shopify customer email", {
          customerId: shopifyCustomerId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return null;
    }
  });
}

// ============================================================================
// Rate Limiting Types (for documentation - implement at API gateway level)
// ============================================================================

export const RATE_LIMITS = {
  "POST /api/submissions": { max: 10, windowSeconds: 3600 }, // 10/hour
  "GET /api/cards/lookup": { max: 100, windowSeconds: 60 }, // 100/minute
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
