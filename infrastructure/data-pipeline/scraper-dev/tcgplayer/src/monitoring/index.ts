/**
 * Monitoring Module Index
 *
 * Export monitoring, metrics, and logging utilities.
 */

// Metrics
export * from './metrics.js';

// Logger
export * from './logger.js';

// Re-export convenience functions
import {
  MetricsCollector,
  createMetricsCollector,
  getMetricsCollector,
  setDefaultMetricsCollector,
  METRIC_NAMESPACE,
  MetricName,
} from './metrics.js';

import {
  Logger,
  createLogger,
  createLambdaLogger,
  logger,
  LogLevel,
} from './logger.js';

export {
  // Metrics
  MetricsCollector,
  createMetricsCollector,
  getMetricsCollector,
  setDefaultMetricsCollector,
  METRIC_NAMESPACE,
  MetricName,
  // Logger
  Logger,
  createLogger,
  createLambdaLogger,
  logger,
  LogLevel,
};
