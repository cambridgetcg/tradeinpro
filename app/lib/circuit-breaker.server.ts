/**
 * Circuit Breaker Implementation
 *
 * Protects external API calls from cascading failures.
 * When failures exceed threshold, circuit opens and calls fail fast.
 * After timeout, circuit enters half-open state to test recovery.
 *
 * @synapse CODE_SYNAPSE.md - See ./CODE_SYNAPSE.md for module dependencies
 *
 * USAGE:
 *   const apiBreaker = new CircuitBreaker('royal-mail', {
 *     failureThreshold: 3,
 *     resetTimeoutMs: 60000,
 *   });
 *
 *   const result = await apiBreaker.execute(
 *     () => royalMailApi.createOrder(data),
 *     () => ({ success: false, fallback: true }) // Optional fallback
 *   );
 *
 * SERVICES USING THIS:
 *   - Royal Mail API (shipping labels)
 *   - Shopify Admin API (customer data, gift cards)
 *   - Email service (notifications)
 */

import { logger, metrics } from "./observability.server";

// ============================================================================
// Types
// ============================================================================

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface CircuitBreakerOptions {
  /** Number of failures before opening circuit (default: 3) */
  failureThreshold?: number;
  /** Time in ms before trying to close circuit (default: 60000 = 1 minute) */
  resetTimeoutMs?: number;
  /** Number of successful requests needed in half-open to close (default: 1) */
  successThreshold?: number;
  /** Callback when circuit state changes */
  onStateChange?: (name: string, from: CircuitState, to: CircuitState) => void;
}

export interface CircuitBreakerStats {
  name: string;
  state: CircuitState;
  failures: number;
  successes: number;
  lastFailure: number | null;
  lastSuccess: number | null;
}

export class CircuitOpenError extends Error {
  constructor(
    message: string,
    public readonly circuitName: string
  ) {
    super(message);
    this.name = "CircuitOpenError";
  }
}

// ============================================================================
// Default Options
// ============================================================================

const DEFAULT_OPTIONS: Required<Omit<CircuitBreakerOptions, "onStateChange">> = {
  failureThreshold: 3,
  resetTimeoutMs: 60000, // 1 minute
  successThreshold: 1,
};

// ============================================================================
// Circuit Breaker Class
// ============================================================================

export class CircuitBreaker {
  private state: CircuitState = "CLOSED";
  private failures = 0;
  private successes = 0;
  private lastFailure: number | null = null;
  private lastSuccess: number | null = null;
  private readonly options: Required<Omit<CircuitBreakerOptions, "onStateChange">>;
  private readonly onStateChange?: CircuitBreakerOptions["onStateChange"];

  constructor(
    public readonly name: string,
    options: CircuitBreakerOptions = {}
  ) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.onStateChange = options.onStateChange;
  }

  /**
   * Execute a function with circuit breaker protection
   * @param fn - The async function to execute
   * @param fallback - Optional fallback function if circuit is open or fn fails
   */
  async execute<T>(
    fn: () => Promise<T>,
    fallback?: () => T | Promise<T>
  ): Promise<T> {
    // Check if circuit should transition from OPEN to HALF_OPEN
    if (this.state === "OPEN") {
      if (this.shouldAttemptReset()) {
        this.transition("HALF_OPEN");
      } else {
        // Circuit is open and not ready to reset
        logger.warn("Circuit breaker rejecting request", {
          circuit: this.name,
          state: "OPEN",
          hasFallback: !!fallback,
        });
        metrics.increment(`circuit.${this.name}.rejected`);
        if (fallback) {
          return fallback();
        }
        throw new CircuitOpenError(
          `Circuit breaker '${this.name}' is open`,
          this.name
        );
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure(error);

      // If we have a fallback, use it
      if (fallback) {
        logger.warn("Circuit breaker operation failed, using fallback", {
          circuit: this.name,
        });
        return fallback();
      }

      throw error;
    }
  }

  /**
   * Get current circuit breaker stats
   */
  getStats(): CircuitBreakerStats {
    return {
      name: this.name,
      state: this.state,
      failures: this.failures,
      successes: this.successes,
      lastFailure: this.lastFailure,
      lastSuccess: this.lastSuccess,
    };
  }

  /**
   * Manually reset the circuit breaker to CLOSED state
   */
  reset(): void {
    this.transition("CLOSED");
    this.failures = 0;
    this.successes = 0;
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private shouldAttemptReset(): boolean {
    if (!this.lastFailure) return true;
    return Date.now() - this.lastFailure >= this.options.resetTimeoutMs;
  }

  private onSuccess(): void {
    this.lastSuccess = Date.now();

    if (this.state === "HALF_OPEN") {
      this.successes++;
      if (this.successes >= this.options.successThreshold) {
        this.transition("CLOSED");
        this.failures = 0;
        this.successes = 0;
      }
    } else if (this.state === "CLOSED") {
      // Reset failure count on success in closed state
      this.failures = 0;
    }
  }

  private onFailure(error: unknown): void {
    this.lastFailure = Date.now();
    this.failures++;

    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.warn("Circuit breaker recorded failure", {
      circuit: this.name,
      failures: this.failures,
      threshold: this.options.failureThreshold,
      error: errorMessage,
    });
    metrics.increment(`circuit.${this.name}.failure`);

    if (this.state === "HALF_OPEN") {
      // Any failure in half-open immediately opens the circuit
      this.transition("OPEN");
      this.successes = 0;
    } else if (this.state === "CLOSED") {
      if (this.failures >= this.options.failureThreshold) {
        this.transition("OPEN");
      }
    }
  }

  private transition(newState: CircuitState): void {
    if (this.state === newState) return;

    const oldState = this.state;
    this.state = newState;

    logger.info("Circuit breaker state changed", {
      circuit: this.name,
      from: oldState,
      to: newState,
    });
    metrics.increment(`circuit.${this.name}.transition.${newState.toLowerCase()}`);

    if (this.onStateChange) {
      this.onStateChange(this.name, oldState, newState);
    }
  }
}

// ============================================================================
// Global Circuit Breaker Registry
// ============================================================================

const circuitBreakers = new Map<string, CircuitBreaker>();

/**
 * Get or create a circuit breaker by name
 */
export function getCircuitBreaker(
  name: string,
  options?: CircuitBreakerOptions
): CircuitBreaker {
  let breaker = circuitBreakers.get(name);

  if (!breaker) {
    breaker = new CircuitBreaker(name, options);
    circuitBreakers.set(name, breaker);
  }

  return breaker;
}

/**
 * Get stats for all circuit breakers
 */
export function getAllCircuitBreakerStats(): CircuitBreakerStats[] {
  return Array.from(circuitBreakers.values()).map((cb) => cb.getStats());
}

/**
 * Reset all circuit breakers (useful for testing)
 */
export function resetAllCircuitBreakers(): void {
  circuitBreakers.forEach((cb) => cb.reset());
}

// ============================================================================
// Pre-configured Circuit Breakers
// ============================================================================

/**
 * Circuit breaker for Royal Mail API
 * - 3 failures opens circuit
 * - 2 minute reset timeout (shipping is time-sensitive)
 */
export const royalMailCircuitBreaker = new CircuitBreaker("royal-mail", {
  failureThreshold: 3,
  resetTimeoutMs: 2 * 60 * 1000, // 2 minutes
  onStateChange: (name, from, to) => {
    if (to === "OPEN") {
      logger.error("ALERT: Royal Mail circuit breaker OPENED", {
        circuit: name,
        impact: "shipping labels will fallback",
      });
    }
  },
});

/**
 * Circuit breaker for Shopify Admin API
 * - 5 failures opens circuit (more tolerant)
 * - 1 minute reset timeout
 */
export const shopifyAdminCircuitBreaker = new CircuitBreaker("shopify-admin", {
  failureThreshold: 5,
  resetTimeoutMs: 60 * 1000, // 1 minute
});

/**
 * Circuit breaker for Email/Notification service
 * - 3 failures opens circuit
 * - 5 minute reset timeout (emails can be delayed)
 */
export const emailCircuitBreaker = new CircuitBreaker("email-service", {
  failureThreshold: 3,
  resetTimeoutMs: 5 * 60 * 1000, // 5 minutes
});

// Register pre-configured circuit breakers in the global registry
// so resetAllCircuitBreakers() works on them
circuitBreakers.set("royal-mail", royalMailCircuitBreaker);
circuitBreakers.set("shopify-admin", shopifyAdminCircuitBreaker);
circuitBreakers.set("email-service", emailCircuitBreaker);
