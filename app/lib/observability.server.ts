/**
 * Lightweight Observability Layer
 *
 * Provides structured logging, request tracing, and metrics collection
 * without requiring external OpenTelemetry packages.
 *
 * @synapse CODE_SYNAPSE.md - See ./CODE_SYNAPSE.md for module dependencies
 *
 * USAGE:
 *   import { withTrace, logger, metrics } from "./observability.server";
 *
 *   // Trace an operation
 *   const result = await withTrace("submission.create", {
 *     itemCount: items.length,
 *     payoutType: "STORE_CREDIT"
 *   }, async (trace) => {
 *     trace.log("Starting submission creation");
 *     // ... do work
 *     trace.setResult("success");
 *     return submission;
 *   });
 *
 *   // Simple logging
 *   logger.info("Processing submission", { submissionId: "123" });
 *   logger.error("Failed to create payout", { error: err.message });
 *
 *   // Record metrics
 *   metrics.increment("submissions.created");
 *   metrics.timing("api.latency", durationMs);
 */

import { randomBytes } from "crypto";

// ============================================================================
// Types
// ============================================================================

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogContext {
  [key: string]: string | number | boolean | null | undefined;
}

export interface TraceContext {
  traceId: string;
  spanId: string;
  startTime: number;
  name: string;
  attributes: LogContext;
}

export interface TraceHandle {
  /** Log a message within this trace */
  log: (message: string, context?: LogContext) => void;
  /** Set a result status for the trace */
  setResult: (status: "success" | "error" | "timeout") => void;
  /** Add attributes to the trace */
  addAttribute: (key: string, value: string | number | boolean) => void;
  /** Get the trace ID for error responses */
  traceId: string;
}

// ============================================================================
// Trace ID Generation
// ============================================================================

/**
 * Generate a unique trace ID (16 hex chars)
 */
function generateTraceId(): string {
  return randomBytes(8).toString("hex");
}

/**
 * Generate a unique span ID (8 hex chars)
 */
function generateSpanId(): string {
  return randomBytes(4).toString("hex");
}

// ============================================================================
// Logger
// ============================================================================

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// Get minimum log level from environment (default: info in prod, debug in dev)
const MIN_LOG_LEVEL: LogLevel =
  (process.env.LOG_LEVEL as LogLevel) ||
  (process.env.NODE_ENV === "production" ? "info" : "debug");

/**
 * Format a log message with structured context
 */
function formatLog(
  level: LogLevel,
  message: string,
  context?: LogContext,
  traceId?: string
): string {
  const timestamp = new Date().toISOString();
  const contextStr = context
    ? " " + JSON.stringify(context)
    : "";
  const traceStr = traceId ? ` [trace:${traceId}]` : "";

  return `[${timestamp}] ${level.toUpperCase()}${traceStr}: ${message}${contextStr}`;
}

/**
 * Structured logger with trace support
 */
export const logger = {
  debug(message: string, context?: LogContext, traceId?: string): void {
    if (LOG_LEVELS.debug >= LOG_LEVELS[MIN_LOG_LEVEL]) {
      console.debug(formatLog("debug", message, context, traceId));
    }
  },

  info(message: string, context?: LogContext, traceId?: string): void {
    if (LOG_LEVELS.info >= LOG_LEVELS[MIN_LOG_LEVEL]) {
      console.info(formatLog("info", message, context, traceId));
    }
  },

  warn(message: string, context?: LogContext, traceId?: string): void {
    if (LOG_LEVELS.warn >= LOG_LEVELS[MIN_LOG_LEVEL]) {
      console.warn(formatLog("warn", message, context, traceId));
    }
  },

  error(message: string, context?: LogContext, traceId?: string): void {
    if (LOG_LEVELS.error >= LOG_LEVELS[MIN_LOG_LEVEL]) {
      console.error(formatLog("error", message, context, traceId));
    }
  },
};

// ============================================================================
// Tracing
// ============================================================================

// Active traces for debugging
const activeTraces = new Map<string, TraceContext>();

/**
 * Execute an operation with tracing
 *
 * @param name - Name of the operation (e.g., "submission.create")
 * @param attributes - Initial attributes for the trace
 * @param fn - The async function to execute
 * @returns The result of the function
 */
export async function withTrace<T>(
  name: string,
  attributes: LogContext,
  fn: (trace: TraceHandle) => Promise<T>
): Promise<T> {
  const traceId = generateTraceId();
  const spanId = generateSpanId();
  const startTime = Date.now();

  const trace: TraceContext = {
    traceId,
    spanId,
    startTime,
    name,
    attributes: { ...attributes },
  };

  activeTraces.set(traceId, trace);

  const handle: TraceHandle = {
    traceId,

    log(message: string, context?: LogContext): void {
      logger.debug(message, { ...context, span: name }, traceId);
    },

    setResult(status: "success" | "error" | "timeout"): void {
      trace.attributes.result = status;
    },

    addAttribute(key: string, value: string | number | boolean): void {
      trace.attributes[key] = value;
    },
  };

  logger.debug(`Starting ${name}`, attributes, traceId);

  try {
    const result = await fn(handle);

    const duration = Date.now() - startTime;
    logger.info(`Completed ${name}`, {
      duration_ms: duration,
      result: trace.attributes.result || "success",
    }, traceId);

    // Record timing metric
    metrics.timing(`trace.${name}`, duration);

    return result;
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);

    logger.error(`Failed ${name}`, {
      duration_ms: duration,
      error: errorMessage,
    }, traceId);

    // Record error metric
    metrics.increment(`trace.${name}.error`);

    throw error;
  } finally {
    activeTraces.delete(traceId);
  }
}

/**
 * Get active traces (for debugging)
 */
export function getActiveTraces(): TraceContext[] {
  return Array.from(activeTraces.values());
}

// ============================================================================
// Metrics (In-Memory for Now)
// ============================================================================

interface MetricEntry {
  value: number;
  count: number;
  min: number;
  max: number;
  sum: number;
  lastUpdated: number;
}

const metricsStore = new Map<string, MetricEntry>();

/**
 * Simple in-memory metrics collector
 * In production, this would push to a metrics service
 */
export const metrics = {
  /**
   * Increment a counter
   */
  increment(name: string, value: number = 1): void {
    const existing = metricsStore.get(name) || {
      value: 0,
      count: 0,
      min: 0,
      max: 0,
      sum: 0,
      lastUpdated: 0,
    };

    metricsStore.set(name, {
      value: existing.value + value,
      count: existing.count + 1,
      min: Math.min(existing.min, value),
      max: Math.max(existing.max, value),
      sum: existing.sum + value,
      lastUpdated: Date.now(),
    });
  },

  /**
   * Record a timing metric (in milliseconds)
   */
  timing(name: string, durationMs: number): void {
    const existing = metricsStore.get(name) || {
      value: 0,
      count: 0,
      min: Infinity,
      max: -Infinity,
      sum: 0,
      lastUpdated: 0,
    };

    metricsStore.set(name, {
      value: durationMs,
      count: existing.count + 1,
      min: Math.min(existing.min, durationMs),
      max: Math.max(existing.max, durationMs),
      sum: existing.sum + durationMs,
      lastUpdated: Date.now(),
    });
  },

  /**
   * Set a gauge value
   */
  gauge(name: string, value: number): void {
    metricsStore.set(name, {
      value,
      count: 1,
      min: value,
      max: value,
      sum: value,
      lastUpdated: Date.now(),
    });
  },

  /**
   * Get all metrics
   */
  getAll(): Record<string, MetricEntry> {
    return Object.fromEntries(metricsStore);
  },

  /**
   * Get a specific metric
   */
  get(name: string): MetricEntry | undefined {
    return metricsStore.get(name);
  },

  /**
   * Reset all metrics (useful for testing)
   */
  reset(): void {
    metricsStore.clear();
  },
};

// ============================================================================
// Request Context Helper
// ============================================================================

/**
 * Extract or generate a trace ID from a request
 * Looks for X-Trace-ID header or generates a new one
 */
export function getRequestTraceId(request: Request): string {
  return request.headers.get("X-Trace-ID") || generateTraceId();
}

/**
 * Add trace ID to a response
 */
export function addTraceIdToResponse(
  response: Response,
  traceId: string
): Response {
  const newHeaders = new Headers(response.headers);
  newHeaders.set("X-Trace-ID", traceId);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
}
