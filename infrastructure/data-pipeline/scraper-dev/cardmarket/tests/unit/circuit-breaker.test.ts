/**
 * Unit tests for Circuit Breaker
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Import circuit breaker module
const { CircuitBreaker, CircuitBreakerRegistry } = await import(
  '../../src/resilience/circuit-breaker.js'
);

describe('CircuitBreaker', () => {
  let breaker: InstanceType<typeof CircuitBreaker>;

  beforeEach(() => {
    vi.useFakeTimers();
    breaker = new CircuitBreaker({
      failureThreshold: 3,
      successThreshold: 2,
      timeout: 5000,
      monitoringWindow: 10000,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('initial state', () => {
    it('should start in CLOSED state', () => {
      expect(breaker.getState()).toBe('CLOSED');
    });

    it('should allow requests when closed', async () => {
      const result = await breaker.execute(() => Promise.resolve('success'));
      expect(result).toBe('success');
    });
  });

  describe('state transitions', () => {
    it('should open after reaching failure threshold', async () => {
      const failingFn = () => Promise.reject(new Error('fail'));

      // Fail 3 times to trigger opening
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(failingFn);
        } catch {
          // Expected
        }
      }

      expect(breaker.getState()).toBe('OPEN');
    });

    it('should reject requests immediately when open', async () => {
      // Force open state
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(() => Promise.reject(new Error('fail')));
        } catch {
          // Expected
        }
      }

      expect(breaker.getState()).toBe('OPEN');

      // Next request should fail fast
      await expect(
        breaker.execute(() => Promise.resolve('success'))
      ).rejects.toThrow('Circuit breaker is OPEN');
    });

    it('should transition to HALF_OPEN after timeout', async () => {
      // Open the circuit
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(() => Promise.reject(new Error('fail')));
        } catch {
          // Expected
        }
      }

      expect(breaker.getState()).toBe('OPEN');

      // Advance time past timeout
      vi.advanceTimersByTime(6000);

      expect(breaker.getState()).toBe('HALF_OPEN');
    });

    it('should close after successful requests in HALF_OPEN', async () => {
      // Open the circuit
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(() => Promise.reject(new Error('fail')));
        } catch {
          // Expected
        }
      }

      // Wait for timeout
      vi.advanceTimersByTime(6000);
      expect(breaker.getState()).toBe('HALF_OPEN');

      // Succeed twice (success threshold)
      await breaker.execute(() => Promise.resolve('success'));
      await breaker.execute(() => Promise.resolve('success'));

      expect(breaker.getState()).toBe('CLOSED');
    });

    it('should re-open on failure in HALF_OPEN', async () => {
      // Open the circuit
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(() => Promise.reject(new Error('fail')));
        } catch {
          // Expected
        }
      }

      // Wait for timeout
      vi.advanceTimersByTime(6000);
      expect(breaker.getState()).toBe('HALF_OPEN');

      // Fail in half-open
      try {
        await breaker.execute(() => Promise.reject(new Error('fail again')));
      } catch {
        // Expected
      }

      expect(breaker.getState()).toBe('OPEN');
    });
  });

  describe('metrics', () => {
    it('should track success count', async () => {
      await breaker.execute(() => Promise.resolve('success'));
      await breaker.execute(() => Promise.resolve('success'));

      const metrics = breaker.getMetrics();
      expect(metrics.successCount).toBe(2);
    });

    it('should track failure count', async () => {
      try {
        await breaker.execute(() => Promise.reject(new Error('fail')));
      } catch {
        // Expected
      }

      const metrics = breaker.getMetrics();
      expect(metrics.failureCount).toBe(1);
    });

    it('should track total requests', async () => {
      await breaker.execute(() => Promise.resolve('success'));
      try {
        await breaker.execute(() => Promise.reject(new Error('fail')));
      } catch {
        // Expected
      }

      const metrics = breaker.getMetrics();
      expect(metrics.totalRequests).toBe(2);
    });
  });

  describe('fallback', () => {
    it('should use fallback when circuit is open', async () => {
      const fallbackFn = vi.fn().mockResolvedValue('fallback result');

      // Open the circuit
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(() => Promise.reject(new Error('fail')));
        } catch {
          // Expected
        }
      }

      const result = await breaker.execute(
        () => Promise.resolve('success'),
        fallbackFn
      );

      expect(result).toBe('fallback result');
      expect(fallbackFn).toHaveBeenCalled();
    });
  });
});

describe('CircuitBreakerRegistry', () => {
  let registry: InstanceType<typeof CircuitBreakerRegistry>;

  beforeEach(() => {
    registry = new CircuitBreakerRegistry();
  });

  it('should create named circuit breakers', () => {
    const breaker = registry.getOrCreate('test-service');
    expect(breaker).toBeInstanceOf(CircuitBreaker);
  });

  it('should return same instance for same name', () => {
    const breaker1 = registry.getOrCreate('test-service');
    const breaker2 = registry.getOrCreate('test-service');
    expect(breaker1).toBe(breaker2);
  });

  it('should create different instances for different names', () => {
    const breaker1 = registry.getOrCreate('service-a');
    const breaker2 = registry.getOrCreate('service-b');
    expect(breaker1).not.toBe(breaker2);
  });

  it('should get all breaker states', () => {
    registry.getOrCreate('service-a');
    registry.getOrCreate('service-b');

    const states = registry.getAllStates();

    expect(states['service-a']).toBe('CLOSED');
    expect(states['service-b']).toBe('CLOSED');
  });
});
