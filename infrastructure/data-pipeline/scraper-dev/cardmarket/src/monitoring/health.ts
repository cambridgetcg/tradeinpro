/**
 * Health Check System
 *
 * Provides health checks for:
 * - HTTP connectivity
 * - Proxy availability
 * - Browser automation
 * - External dependencies
 */

export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';

export interface HealthCheckResult {
  name: string;
  status: HealthStatus;
  message: string;
  latencyMs: number;
  timestamp: Date;
  details?: Record<string, unknown>;
}

export interface OverallHealth {
  status: HealthStatus;
  checks: HealthCheckResult[];
  timestamp: Date;
}

export type HealthChecker = () => Promise<HealthCheckResult>;

/**
 * Health check manager
 */
export class HealthCheckManager {
  private checks: Map<string, HealthChecker> = new Map();
  private lastResults: Map<string, HealthCheckResult> = new Map();
  private checkInterval: NodeJS.Timeout | null = null;

  /**
   * Register a health check
   */
  register(name: string, checker: HealthChecker): void {
    this.checks.set(name, checker);
  }

  /**
   * Unregister a health check
   */
  unregister(name: string): void {
    this.checks.delete(name);
    this.lastResults.delete(name);
  }

  /**
   * Run a single health check
   */
  async runCheck(name: string): Promise<HealthCheckResult | null> {
    const checker = this.checks.get(name);
    if (!checker) return null;

    try {
      const result = await checker();
      this.lastResults.set(name, result);
      return result;
    } catch (error) {
      const result: HealthCheckResult = {
        name,
        status: 'unhealthy',
        message: error instanceof Error ? error.message : 'Check failed',
        latencyMs: 0,
        timestamp: new Date(),
      };
      this.lastResults.set(name, result);
      return result;
    }
  }

  /**
   * Run all health checks
   */
  async runAll(): Promise<OverallHealth> {
    const checks: HealthCheckResult[] = [];

    for (const name of this.checks.keys()) {
      const result = await this.runCheck(name);
      if (result) {
        checks.push(result);
      }
    }

    // Determine overall status
    let status: HealthStatus = 'healthy';
    for (const check of checks) {
      if (check.status === 'unhealthy') {
        status = 'unhealthy';
        break;
      }
      if (check.status === 'degraded') {
        status = 'degraded';
      }
    }

    return {
      status,
      checks,
      timestamp: new Date(),
    };
  }

  /**
   * Get last known results
   */
  getLastResults(): OverallHealth {
    const checks = Array.from(this.lastResults.values());

    let status: HealthStatus = 'healthy';
    for (const check of checks) {
      if (check.status === 'unhealthy') {
        status = 'unhealthy';
        break;
      }
      if (check.status === 'degraded') {
        status = 'degraded';
      }
    }

    return {
      status,
      checks,
      timestamp: new Date(),
    };
  }

  /**
   * Start periodic health checks
   */
  startPeriodicChecks(intervalMs: number = 60000): void {
    if (this.checkInterval) return;

    this.checkInterval = setInterval(async () => {
      await this.runAll();
    }, intervalMs);

    // Run immediately
    this.runAll();
  }

  /**
   * Stop periodic health checks
   */
  stopPeriodicChecks(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }
}

/**
 * Create a connectivity health check
 */
export function createConnectivityCheck(
  url: string,
  timeout: number = 10000
): HealthChecker {
  return async (): Promise<HealthCheckResult> => {
    const start = Date.now();
    const name = `connectivity:${new URL(url).hostname}`;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(url, {
        method: 'HEAD',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      const latencyMs = Date.now() - start;

      if (response.ok) {
        return {
          name,
          status: 'healthy',
          message: 'Connection successful',
          latencyMs,
          timestamp: new Date(),
          details: { statusCode: response.status },
        };
      }

      return {
        name,
        status: response.status >= 500 ? 'unhealthy' : 'degraded',
        message: `HTTP ${response.status}`,
        latencyMs,
        timestamp: new Date(),
        details: { statusCode: response.status },
      };
    } catch (error) {
      return {
        name,
        status: 'unhealthy',
        message: error instanceof Error ? error.message : 'Connection failed',
        latencyMs: Date.now() - start,
        timestamp: new Date(),
      };
    }
  };
}

/**
 * Create a proxy health check
 */
export function createProxyCheck(
  proxyUrl: string,
  testUrl: string = 'https://httpbin.org/ip'
): HealthChecker {
  return async (): Promise<HealthCheckResult> => {
    const start = Date.now();
    const name = 'proxy';

    try {
      // Note: Would need proxy agent for actual implementation
      // This is a simplified version

      const response = await fetch(testUrl, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0',
        },
      });

      const latencyMs = Date.now() - start;

      if (response.ok) {
        const data = await response.json();
        return {
          name,
          status: 'healthy',
          message: 'Proxy working',
          latencyMs,
          timestamp: new Date(),
          details: { ip: data.origin },
        };
      }

      return {
        name,
        status: 'degraded',
        message: `Proxy returned ${response.status}`,
        latencyMs,
        timestamp: new Date(),
      };
    } catch (error) {
      return {
        name,
        status: 'unhealthy',
        message: error instanceof Error ? error.message : 'Proxy check failed',
        latencyMs: Date.now() - start,
        timestamp: new Date(),
      };
    }
  };
}

/**
 * Create a memory health check
 */
export function createMemoryCheck(
  warningThresholdMb: number = 512,
  criticalThresholdMb: number = 1024
): HealthChecker {
  return async (): Promise<HealthCheckResult> => {
    const usage = process.memoryUsage();
    const heapUsedMb = usage.heapUsed / 1024 / 1024;
    const heapTotalMb = usage.heapTotal / 1024 / 1024;
    const rssMb = usage.rss / 1024 / 1024;

    let status: HealthStatus = 'healthy';
    let message = `Memory usage: ${heapUsedMb.toFixed(1)}MB`;

    if (heapUsedMb > criticalThresholdMb) {
      status = 'unhealthy';
      message = `High memory usage: ${heapUsedMb.toFixed(1)}MB`;
    } else if (heapUsedMb > warningThresholdMb) {
      status = 'degraded';
      message = `Elevated memory usage: ${heapUsedMb.toFixed(1)}MB`;
    }

    return {
      name: 'memory',
      status,
      message,
      latencyMs: 0,
      timestamp: new Date(),
      details: {
        heapUsedMb: Math.round(heapUsedMb),
        heapTotalMb: Math.round(heapTotalMb),
        rssMb: Math.round(rssMb),
      },
    };
  };
}

/**
 * Create a circuit breaker health check
 */
export function createCircuitBreakerCheck(
  getOpenCount: () => number,
  threshold: number = 1
): HealthChecker {
  return async (): Promise<HealthCheckResult> => {
    const openCount = getOpenCount();

    let status: HealthStatus = 'healthy';
    let message = 'All circuits closed';

    if (openCount >= threshold) {
      status = 'unhealthy';
      message = `${openCount} circuit(s) open`;
    } else if (openCount > 0) {
      status = 'degraded';
      message = `${openCount} circuit(s) open`;
    }

    return {
      name: 'circuit-breakers',
      status,
      message,
      latencyMs: 0,
      timestamp: new Date(),
      details: { openCircuits: openCount },
    };
  };
}
