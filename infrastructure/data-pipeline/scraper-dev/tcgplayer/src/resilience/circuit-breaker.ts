/**
 * Circuit Breaker Pattern Implementation
 *
 * Prevents cascading failures by stopping requests to failing endpoints.
 * States: CLOSED (normal) -> OPEN (failing) -> HALF_OPEN (testing)
 *
 * Ported from Cardmarket scraper with TCGplayer-specific defaults.
 */

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerConfig {
  failureThreshold: number;      // Number of failures before opening
  successThreshold: number;      // Successes needed to close from half-open
  timeout: number;               // Time in ms before trying again (half-open)
  monitoringWindow: number;      // Time window for counting failures
}

export interface CircuitStats {
  state: CircuitState;
  failures: number;
  successes: number;
  lastFailure: Date | null;
  lastSuccess: Date | null;
  totalRequests: number;
  openedAt: Date | null;
  closedAt: Date | null;
}

// TCGplayer-specific defaults (more conservative due to stricter anti-bot)
const DEFAULT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 3,           // Lower threshold for TCGplayer
  successThreshold: 2,
  timeout: 60000,                // 60 seconds (longer cooldown)
  monitoringWindow: 120000,      // 2 minutes
};

/**
 * Circuit Breaker class
 */
export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failures: number = 0;
  private successes: number = 0;
  private lastFailureTime: number = 0;
  private lastSuccessTime: number = 0;
  private openedAt: number = 0;
  private closedAt: number = Date.now();
  private totalRequests: number = 0;
  private failureTimestamps: number[] = [];
  private config: CircuitBreakerConfig;
  private name: string;

  constructor(name: string, config?: Partial<CircuitBreakerConfig>) {
    this.name = name;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Check if request is allowed
   */
  canRequest(): boolean {
    this.cleanOldFailures();

    if (this.state === 'CLOSED') {
      return true;
    }

    if (this.state === 'OPEN') {
      // Check if timeout has passed
      if (Date.now() - this.openedAt >= this.config.timeout) {
        this.state = 'HALF_OPEN';
        this.successes = 0;
        return true;
      }
      return false;
    }

    // HALF_OPEN - allow limited requests
    return true;
  }

  /**
   * Record a successful request
   */
  recordSuccess(): void {
    this.totalRequests++;
    this.successes++;
    this.lastSuccessTime = Date.now();

    if (this.state === 'HALF_OPEN') {
      if (this.successes >= this.config.successThreshold) {
        this.close();
      }
    }
  }

  /**
   * Record a failed request
   */
  recordFailure(): void {
    this.totalRequests++;
    this.failures++;
    this.lastFailureTime = Date.now();
    this.failureTimestamps.push(Date.now());

    if (this.state === 'HALF_OPEN') {
      this.open();
      return;
    }

    if (this.state === 'CLOSED') {
      this.cleanOldFailures();
      if (this.failureTimestamps.length >= this.config.failureThreshold) {
        this.open();
      }
    }
  }

  /**
   * Open the circuit (stop requests)
   */
  private open(): void {
    this.state = 'OPEN';
    this.openedAt = Date.now();
    this.successes = 0;
  }

  /**
   * Close the circuit (resume normal operation)
   */
  private close(): void {
    this.state = 'CLOSED';
    this.closedAt = Date.now();
    this.failures = 0;
    this.failureTimestamps = [];
  }

  /**
   * Force reset the circuit breaker
   */
  reset(): void {
    this.state = 'CLOSED';
    this.failures = 0;
    this.successes = 0;
    this.failureTimestamps = [];
    this.closedAt = Date.now();
  }

  /**
   * Remove failures outside the monitoring window
   */
  private cleanOldFailures(): void {
    const cutoff = Date.now() - this.config.monitoringWindow;
    this.failureTimestamps = this.failureTimestamps.filter((t) => t > cutoff);
  }

  /**
   * Get current stats
   */
  getStats(): CircuitStats {
    return {
      state: this.state,
      failures: this.failures,
      successes: this.successes,
      lastFailure: this.lastFailureTime ? new Date(this.lastFailureTime) : null,
      lastSuccess: this.lastSuccessTime ? new Date(this.lastSuccessTime) : null,
      totalRequests: this.totalRequests,
      openedAt: this.openedAt ? new Date(this.openedAt) : null,
      closedAt: this.closedAt ? new Date(this.closedAt) : null,
    };
  }

  /**
   * Get circuit state
   */
  getState(): CircuitState {
    // Check for automatic state transitions
    this.canRequest();
    return this.state;
  }

  /**
   * Get circuit name
   */
  getName(): string {
    return this.name;
  }
}

/**
 * Circuit Breaker Registry for managing multiple circuits
 */
export class CircuitBreakerRegistry {
  private circuits: Map<string, CircuitBreaker> = new Map();
  private defaultConfig: Partial<CircuitBreakerConfig>;

  constructor(defaultConfig?: Partial<CircuitBreakerConfig>) {
    this.defaultConfig = defaultConfig || {};
  }

  /**
   * Get or create a circuit breaker for a key
   */
  getCircuit(name: string, config?: Partial<CircuitBreakerConfig>): CircuitBreaker {
    let circuit = this.circuits.get(name);
    if (!circuit) {
      circuit = new CircuitBreaker(name, { ...this.defaultConfig, ...config });
      this.circuits.set(name, circuit);
    }
    return circuit;
  }

  /**
   * Get all circuit stats
   */
  getAllStats(): Map<string, CircuitStats> {
    const stats = new Map<string, CircuitStats>();
    for (const [name, circuit] of this.circuits) {
      stats.set(name, circuit.getStats());
    }
    return stats;
  }

  /**
   * Reset all circuits
   */
  resetAll(): void {
    for (const circuit of this.circuits.values()) {
      circuit.reset();
    }
  }

  /**
   * Get count of open circuits
   */
  getOpenCircuitCount(): number {
    let count = 0;
    for (const circuit of this.circuits.values()) {
      if (circuit.getState() === 'OPEN') {
        count++;
      }
    }
    return count;
  }
}
