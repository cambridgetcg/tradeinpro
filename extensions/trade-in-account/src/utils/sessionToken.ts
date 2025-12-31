/**
 * Session Token Utilities
 *
 * Utilities for decoding and working with Shopify session tokens (JWTs).
 * These tokens are issued by Shopify for Customer Account UI Extensions.
 *
 * @see https://shopify.dev/docs/api/customer-account-ui-extensions/apis/session-token
 */

/**
 * Session token claims from Shopify
 */
export interface SessionTokenClaims {
  /** Shopify store URL (e.g., "store-name.myshopify.com") */
  dest: string;
  /** App Client ID */
  aud: string;
  /** Token expiration timestamp (Unix seconds) */
  exp: number;
  /** Token "not before" timestamp (Unix seconds) */
  nbf: number;
  /** Token issued at timestamp (Unix seconds) */
  iat: number;
  /** Unique token identifier (nonce) */
  jti: string;
  /** Customer GID (e.g., "gid://shopify/Customer/12345") - only present if customer is logged in */
  sub?: string;
}

/**
 * Decoded session token with metadata
 */
export interface DecodedSessionToken {
  /** Parsed token claims */
  claims: SessionTokenClaims;
  /** Original token string */
  token: string;
  /** Whether the token has expired */
  isExpired: boolean;
  /** Extracted numeric customer ID (or null if not logged in) */
  customerId: string | null;
  /** Shop domain from token */
  shop: string;
}

/**
 * Base64URL decode (JWT uses base64url encoding)
 */
function base64UrlDecode(str: string): string {
  // Add padding if needed
  const padded = str + '='.repeat((4 - (str.length % 4)) % 4);
  // Replace URL-safe chars with standard base64 chars
  const base64 = padded.replace(/-/g, '+').replace(/_/g, '/');
  return atob(base64);
}

/**
 * Decode a session token WITHOUT signature verification
 * (Signature verification should be done on the backend)
 *
 * @param token - JWT token string
 * @returns Decoded token data or null if invalid format
 */
export function decodeSessionToken(token: string): DecodedSessionToken | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return null;
    }

    const payloadJson = base64UrlDecode(parts[1]);
    const claims = JSON.parse(payloadJson) as SessionTokenClaims;

    const now = Math.floor(Date.now() / 1000);
    const isExpired = claims.exp < now;

    // Extract numeric customer ID from GID format
    let customerId: string | null = null;
    if (claims.sub) {
      const match = claims.sub.match(/^gid:\/\/shopify\/Customer\/(\d+)$/);
      customerId = match ? match[1] : null;
    }

    return {
      claims,
      token,
      isExpired,
      customerId,
      shop: claims.dest,
    };
  } catch {
    return null;
  }
}

/**
 * Extract customer ID from a session token
 *
 * @param token - JWT token string
 * @returns Numeric customer ID string or null
 */
export function getCustomerIdFromToken(token: string): string | null {
  const decoded = decodeSessionToken(token);
  return decoded?.customerId ?? null;
}

/**
 * Get token expiration time
 *
 * @param token - JWT token string
 * @returns Expiration timestamp (Unix seconds) or 0 if invalid
 */
export function getTokenExpiryTime(token: string): number {
  const decoded = decodeSessionToken(token);
  return decoded?.claims.exp ?? 0;
}

/**
 * Check if a token has expired
 *
 * @param token - JWT token string
 * @returns true if expired or invalid
 */
export function isTokenExpired(token: string): boolean {
  const decoded = decodeSessionToken(token);
  return decoded?.isExpired ?? true;
}

/**
 * Get time until token expires in milliseconds
 *
 * @param token - JWT token string
 * @returns Milliseconds until expiration (negative if expired)
 */
export function getTimeUntilExpiry(token: string): number {
  const decoded = decodeSessionToken(token);
  if (!decoded) return -1;

  const now = Math.floor(Date.now() / 1000);
  return (decoded.claims.exp - now) * 1000;
}

/**
 * Check if token is in preview mode (no real customer session)
 * This happens in the Shopify theme editor
 *
 * @param token - JWT token string
 * @returns true if in preview mode
 */
export function isPreviewMode(token: string): boolean {
  const decoded = decodeSessionToken(token);
  if (!decoded) return false;

  // Preview mode: token valid but missing shop domain or customer
  return !decoded.claims.dest || !decoded.claims.sub;
}
