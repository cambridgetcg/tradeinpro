/**
 * Prisma Error Utilities
 * Helpers for detecting and handling Prisma-specific errors
 */

import { Prisma } from "@prisma/client";

/**
 * Check if error is a Prisma unique constraint violation (P2002)
 * This occurs when trying to insert/update a record with a duplicate unique field
 */
export function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

/**
 * Get the field(s) that caused the unique constraint violation
 * Returns array of field names that violated uniqueness
 */
export function getConstraintFields(error: unknown): string[] {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  ) {
    const meta = error.meta as { target?: string[] } | undefined;
    return meta?.target || [];
  }
  return [];
}

/**
 * Check if error is a Prisma record not found error (P2025)
 */
export function isNotFoundError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2025"
  );
}

/**
 * Check if error is a Prisma foreign key constraint error (P2003)
 */
export function isForeignKeyError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2003"
  );
}

/**
 * Sleep utility for retry delays
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calculate exponential backoff delay with jitter
 * @param attempt - Current attempt number (0-based)
 * @param baseDelayMs - Base delay in milliseconds
 * @param maxDelayMs - Maximum delay in milliseconds
 * @returns Delay in milliseconds
 */
export function calculateBackoffDelay(
  attempt: number,
  baseDelayMs: number = 50,
  maxDelayMs: number = 5000
): number {
  // Exponential backoff: baseDelay * 2^attempt
  const exponentialDelay = baseDelayMs * Math.pow(2, attempt);
  // Add random jitter (0-50% of delay)
  const jitter = exponentialDelay * Math.random() * 0.5;
  // Cap at max delay
  return Math.min(exponentialDelay + jitter, maxDelayMs);
}
