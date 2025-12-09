/**
 * Webhook Signature Verification
 *
 * Provides HMAC-SHA256 signature verification for webhook requests.
 * Used to validate requests from trusted services like the price-fetcher Lambda.
 */

import crypto from "crypto";

/**
 * Sign a payload with HMAC-SHA256.
 *
 * @param payload - The string payload to sign
 * @param secret - The shared secret key
 * @returns Hex-encoded signature
 */
export function signPayload(payload: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

/**
 * Verify a webhook signature using timing-safe comparison.
 *
 * @param payload - The raw request body
 * @param signature - The signature from the request header
 * @param secret - The shared secret key
 * @returns true if signature is valid
 */
export function verifyWebhookSignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  try {
    const expectedSignature = signPayload(payload, secret);

    // Use timing-safe comparison to prevent timing attacks
    const sigBuffer = Buffer.from(signature, "hex");
    const expectedBuffer = Buffer.from(expectedSignature, "hex");

    if (sigBuffer.length !== expectedBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(sigBuffer, expectedBuffer);
  } catch {
    // If signature is not valid hex or any other error
    return false;
  }
}

/**
 * Create signature headers for outgoing webhook requests.
 *
 * @param payload - The JSON payload as a string
 * @param secret - The shared secret key
 * @returns Headers object with signature
 */
export function createSignedHeaders(
  payload: string,
  secret: string
): Record<string, string> {
  const timestamp = Date.now().toString();
  const signaturePayload = `${timestamp}.${payload}`;
  const signature = signPayload(signaturePayload, secret);

  return {
    "x-webhook-signature": signature,
    "x-webhook-timestamp": timestamp,
    "Content-Type": "application/json",
  };
}

/**
 * Verify a webhook with timestamp to prevent replay attacks.
 *
 * @param payload - The raw request body
 * @param signature - The signature from headers
 * @param timestamp - The timestamp from headers
 * @param secret - The shared secret key
 * @param maxAgeMs - Maximum age of request in milliseconds (default 5 minutes)
 * @returns true if signature is valid and not expired
 */
export function verifyTimestampedWebhook(
  payload: string,
  signature: string,
  timestamp: string,
  secret: string,
  maxAgeMs: number = 5 * 60 * 1000
): boolean {
  // Check timestamp is recent
  const requestTime = parseInt(timestamp, 10);
  if (isNaN(requestTime)) {
    return false;
  }

  const now = Date.now();
  if (now - requestTime > maxAgeMs) {
    console.warn("Webhook request too old:", {
      requestTime,
      now,
      ageMs: now - requestTime,
    });
    return false;
  }

  // Verify signature over timestamp + payload
  const signaturePayload = `${timestamp}.${payload}`;
  return verifyWebhookSignature(signaturePayload, signature, secret);
}
