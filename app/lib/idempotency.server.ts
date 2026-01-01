/**
 * Idempotency Service
 * Prevents duplicate submission creation from network retries or double-clicks
 *
 * Uses two detection methods:
 * 1. Idempotency Key: Client-provided UUID for explicit duplicate detection
 * 2. Content Hash: SHA-256 of email + normalized items for accidental duplicates
 */

import * as crypto from "crypto";
import prisma from "../db.server";

// ============================================================================
// Configuration
// ============================================================================

/** How long to keep idempotency records (24 hours) */
const IDEMPOTENCY_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Window for content-based duplicate detection (5 minutes) */
const CONTENT_DUPLICATE_WINDOW_MS = 5 * 60 * 1000;

// ============================================================================
// Types
// ============================================================================

export interface IdempotencyCheckResult {
  /** Whether this is a duplicate request */
  isDuplicate: boolean;
  /** ID of existing submission if duplicate */
  existingSubmissionId?: string;
  /** Cached response to return for duplicate requests */
  cachedResponse?: {
    status: number;
    body: string;
  };
}

export interface ContentHashInput {
  email: string;
  items: Array<{
    cardPriceId?: string;
    cardName: string;
    quantity: number;
    conditionClaimed: string;
  }>;
}

export interface CheckIdempotencyParams {
  idempotencyKey?: string;
  email: string;
  contentHash: string;
  customerId?: string;
}

export interface RecordIdempotencyParams {
  idempotencyKey?: string;
  contentHash: string;
  email: string;
  customerId?: string;
  submissionId: string;
  responseStatus: number;
  responseBody: string;
}

// ============================================================================
// Content Hash Generation
// ============================================================================

/**
 * Generate a content hash from submission data for duplicate detection
 * Hash is based on normalized email + items (sorted for consistency)
 */
export function generateContentHash(data: ContentHashInput): string {
  // Normalize email to lowercase
  const normalizedEmail = data.email.toLowerCase().trim();

  // Normalize items: use cardPriceId if available, otherwise cardName
  // Include quantity and condition, sort for consistent hashing
  const normalizedItems = data.items
    .map((item) => {
      const cardId = item.cardPriceId || item.cardName;
      return `${cardId}:${item.quantity}:${item.conditionClaimed}`;
    })
    .sort()
    .join("|");

  // Create hash of normalized content
  const content = `${normalizedEmail}:${normalizedItems}`;
  return crypto.createHash("sha256").update(content).digest("hex").slice(0, 32);
}

// ============================================================================
// Idempotency Checks
// ============================================================================

/**
 * Check if a request is a duplicate based on idempotency key or content hash
 *
 * Returns:
 * - isDuplicate: false - proceed with creation
 * - isDuplicate: true + cachedResponse - return the cached response
 * - isDuplicate: true + existingSubmissionId - inform about existing submission
 */
export async function checkIdempotency(
  params: CheckIdempotencyParams
): Promise<IdempotencyCheckResult> {
  const now = new Date();

  // Check 1: Exact idempotency key match (handles network retries)
  if (params.idempotencyKey) {
    const existingByKey = await prisma.idempotencyRecord.findUnique({
      where: { idempotencyKey: params.idempotencyKey },
    });

    if (existingByKey && existingByKey.expiresAt > now) {
      console.log(
        `[idempotency] Duplicate detected by key: ${params.idempotencyKey}`
      );
      return {
        isDuplicate: true,
        existingSubmissionId: existingByKey.submissionId || undefined,
        cachedResponse: existingByKey.responseBody
          ? {
              status: existingByKey.responseStatus,
              body: existingByKey.responseBody,
            }
          : undefined,
      };
    }
  }

  // Check 2: Same content within short window (catches accidental duplicates)
  const recentDuplicate = await prisma.idempotencyRecord.findFirst({
    where: {
      contentHash: params.contentHash,
      email: params.email.toLowerCase().trim(),
      createdAt: {
        gte: new Date(now.getTime() - CONTENT_DUPLICATE_WINDOW_MS),
      },
      submissionId: { not: null }, // Only match successful submissions
    },
    orderBy: { createdAt: "desc" },
  });

  if (recentDuplicate) {
    console.log(
      `[idempotency] Duplicate detected by content hash: ${params.contentHash}`
    );
    return {
      isDuplicate: true,
      existingSubmissionId: recentDuplicate.submissionId || undefined,
    };
  }

  // Not a duplicate
  return { isDuplicate: false };
}

// ============================================================================
// Idempotency Recording
// ============================================================================

/**
 * Record a successful submission for future idempotency checks
 * If no idempotency key provided, generates one based on content hash
 */
export async function recordIdempotency(
  params: RecordIdempotencyParams
): Promise<void> {
  const expiresAt = new Date(Date.now() + IDEMPOTENCY_WINDOW_MS);

  // If no idempotency key provided, generate one for content-based tracking
  const key =
    params.idempotencyKey ||
    `content-${params.contentHash}-${Date.now()}`;

  try {
    await prisma.idempotencyRecord.upsert({
      where: { idempotencyKey: key },
      create: {
        idempotencyKey: key,
        contentHash: params.contentHash,
        email: params.email.toLowerCase().trim(),
        customerId: params.customerId,
        submissionId: params.submissionId,
        responseStatus: params.responseStatus,
        responseBody: params.responseBody,
        expiresAt,
      },
      update: {
        submissionId: params.submissionId,
        responseStatus: params.responseStatus,
        responseBody: params.responseBody,
        expiresAt,
      },
    });

    console.log(
      `[idempotency] Recorded submission ${params.submissionId} with key ${key}`
    );
  } catch (error) {
    // Log but don't fail - idempotency is a safety net, not critical path
    console.error("[idempotency] Failed to record:", error);
  }
}

// ============================================================================
// Cleanup
// ============================================================================

/**
 * Clean up expired idempotency records
 * Should be called periodically (e.g., via CRON job)
 */
export async function cleanupExpiredIdempotencyRecords(): Promise<number> {
  const result = await prisma.idempotencyRecord.deleteMany({
    where: {
      expiresAt: { lt: new Date() },
    },
  });

  if (result.count > 0) {
    console.log(`[idempotency] Cleaned up ${result.count} expired records`);
  }

  return result.count;
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Extract idempotency key from request headers
 * Supports both X-Idempotency-Key and Idempotency-Key headers
 */
export function getIdempotencyKeyFromRequest(request: Request): string | undefined {
  return (
    request.headers.get("X-Idempotency-Key") ||
    request.headers.get("Idempotency-Key") ||
    undefined
  );
}
