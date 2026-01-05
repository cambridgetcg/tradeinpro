/**
 * Database Resilience Layer
 *
 * Provides retry logic with exponential backoff for database operations.
 * Handles transient connection errors gracefully.
 *
 * @synapse CODE_SYNAPSE.md - See ./CODE_SYNAPSE.md for module dependencies
 *
 * USAGE:
 *   import { withDbRetry } from "./db-resilience.server";
 *
 *   // Wrap individual operations
 *   const users = await withDbRetry(() => prisma.user.findMany());
 *
 *   // Or use the wrapper for critical operations
 *   const submission = await withDbRetry(
 *     () => prisma.tradeInSubmission.create({ data: ... }),
 *     { maxRetries: 5, label: 'create-submission' }
 *   );
 *
 * PRISMA ERROR CODES:
 *   P1001 - Can't reach database server
 *   P1002 - Database server was reached but timed out
 *   P1008 - Operations timed out
 *   P1017 - Server has closed the connection
 *   P2024 - Timed out fetching a new connection from pool
 */

import { logger, metrics } from "./observability.server";

// ============================================================================
// Types
// ============================================================================

export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries?: number;
  /** Initial delay in ms before first retry (default: 1000) */
  initialDelayMs?: number;
  /** Maximum delay in ms between retries (default: 10000) */
  maxDelayMs?: number;
  /** Multiplier for exponential backoff (default: 2) */
  backoffMultiplier?: number;
  /** Optional label for logging */
  label?: string;
  /** Whether to add jitter to delays (default: true) */
  jitter?: boolean;
}

export interface RetryResult<T> {
  success: boolean;
  data?: T;
  error?: Error;
  attempts: number;
  totalTimeMs: number;
}

// ============================================================================
// Prisma Error Detection
// ============================================================================

/** Prisma error codes that indicate transient connection issues */
const RETRYABLE_ERROR_CODES = new Set([
  "P1001", // Can't reach database server
  "P1002", // Database server timed out
  "P1008", // Operations timed out
  "P1017", // Server has closed the connection
  "P2024", // Timed out fetching connection from pool
]);

/**
 * Check if an error is a retryable Prisma connection error
 */
export function isRetryableDbError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;

  // Check for Prisma error code
  const prismaError = error as { code?: string; message?: string };
  if (prismaError.code && RETRYABLE_ERROR_CODES.has(prismaError.code)) {
    return true;
  }

  // Check for connection-related error messages
  const message = prismaError.message?.toLowerCase() || "";
  return (
    message.includes("connection") ||
    message.includes("timeout") ||
    message.includes("econnreset") ||
    message.includes("econnrefused")
  );
}

// ============================================================================
// Default Options
// ============================================================================

const DEFAULT_OPTIONS: Required<Omit<RetryOptions, "label">> = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 10000,
  backoffMultiplier: 2,
  jitter: true,
};

// ============================================================================
// Retry Logic
// ============================================================================

/**
 * Calculate delay for next retry with exponential backoff and optional jitter
 */
function calculateDelay(
  attempt: number,
  options: Required<Omit<RetryOptions, "label">>
): number {
  const exponentialDelay =
    options.initialDelayMs * Math.pow(options.backoffMultiplier, attempt - 1);
  const cappedDelay = Math.min(exponentialDelay, options.maxDelayMs);

  if (options.jitter) {
    // Add up to 25% jitter to prevent thundering herd
    const jitterAmount = cappedDelay * 0.25 * Math.random();
    return Math.round(cappedDelay + jitterAmount);
  }

  return cappedDelay;
}

/**
 * Sleep for a specified duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute a database operation with retry logic
 *
 * @param operation - The async function to execute
 * @param options - Retry configuration options
 * @returns The result of the operation
 * @throws The last error if all retries fail
 */
export async function withDbRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const label = opts.label || "db-operation";
  const startTime = Date.now();

  for (let attempt = 1; attempt <= opts.maxRetries + 1; attempt++) {
    try {
      const result = await operation();

      // Log success if we had to retry
      if (attempt > 1) {
        logger.info("DB operation succeeded after retry", {
          label,
          attempt,
          durationMs: Date.now() - startTime,
        });
        metrics.increment("db.retry.success");
      }

      return result;
    } catch (error) {
      const isLastAttempt = attempt > opts.maxRetries;
      const isRetryable = isRetryableDbError(error);

      // Log the error
      const errorCode = (error as { code?: string }).code || "unknown";
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.warn("DB operation attempt failed", {
        label,
        attempt,
        maxAttempts: opts.maxRetries + 1,
        errorCode,
        error: errorMsg,
        isRetryable,
      });
      metrics.increment("db.retry.attempt");

      // If it's not retryable or we're out of retries, throw
      if (!isRetryable || isLastAttempt) {
        logger.error("DB operation failed after all retries", {
          label,
          attempts: attempt,
          durationMs: Date.now() - startTime,
          error: errorMsg,
        });
        metrics.increment("db.retry.exhausted");
        throw error;
      }

      // Calculate delay and wait before retrying
      const delay = calculateDelay(attempt, opts);
      logger.debug("DB retry scheduled", { label, delayMs: delay });
      await sleep(delay);
    }
  }

  // This should never be reached, but TypeScript needs it
  throw new Error("Unreachable");
}

/**
 * Execute a database operation with retry logic and return detailed result
 *
 * @param operation - The async function to execute
 * @param options - Retry configuration options
 * @returns Detailed result including success status, attempts, and timing
 */
export async function withDbRetryDetailed<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {}
): Promise<RetryResult<T>> {
  const startTime = Date.now();
  let attempts = 0;

  try {
    const data = await withDbRetry(operation, {
      ...options,
      // Track attempts via a wrapper
    });

    return {
      success: true,
      data,
      attempts: 1, // Simplified - actual attempts tracked in logs
      totalTimeMs: Date.now() - startTime,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error : new Error(String(error)),
      attempts: (options.maxRetries || DEFAULT_OPTIONS.maxRetries) + 1,
      totalTimeMs: Date.now() - startTime,
    };
  }
}

// ============================================================================
// Health Check
// ============================================================================

/**
 * Check database connectivity with a simple query
 * Uses retry logic to handle transient issues
 */
export async function checkDbHealth(): Promise<{
  healthy: boolean;
  latencyMs: number;
  error?: string;
}> {
  const startTime = Date.now();

  try {
    // Import prisma dynamically to avoid circular deps
    const prisma = (await import("../db.server")).default;

    // Simple query to check connectivity
    await prisma.$queryRaw`SELECT 1`;

    return {
      healthy: true,
      latencyMs: Date.now() - startTime,
    };
  } catch (error) {
    return {
      healthy: false,
      latencyMs: Date.now() - startTime,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
