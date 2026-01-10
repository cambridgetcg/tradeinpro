/**
 * AWS CloudWatch Integration
 *
 * Sends metrics and logs to CloudWatch for production monitoring.
 */

import {
  CloudWatchClient,
  PutMetricDataCommand,
  type MetricDatum,
  type Dimension,
  StandardUnit,
} from '@aws-sdk/client-cloudwatch';
import type { MetricValue } from './metrics.js';

export interface CloudWatchConfig {
  region: string;
  namespace: string;
  dimensions: Record<string, string>;
  batchSize: number;
}

const DEFAULT_CONFIG: CloudWatchConfig = {
  region: process.env.AWS_REGION || 'us-east-1',
  namespace: 'CardmarketScraper',
  dimensions: {},
  batchSize: 20, // CloudWatch limit
};

/**
 * Map metric types to CloudWatch units
 */
function getUnit(metric: MetricValue): StandardUnit {
  if (metric.unit) {
    const unitMap: Record<string, StandardUnit> = {
      'Count': StandardUnit.Count,
      'Milliseconds': StandardUnit.Milliseconds,
      'Seconds': StandardUnit.Seconds,
      'Bytes': StandardUnit.Bytes,
      'Percent': StandardUnit.Percent,
    };
    return unitMap[metric.unit] || StandardUnit.None;
  }

  // Default units by type
  const typeMap: Record<string, StandardUnit> = {
    counter: StandardUnit.Count,
    timer: StandardUnit.Milliseconds,
    gauge: StandardUnit.None,
    histogram: StandardUnit.None,
  };
  return typeMap[metric.type] || StandardUnit.None;
}

/**
 * Convert internal metrics to CloudWatch format
 */
function toCloudWatchMetric(
  metric: MetricValue,
  globalDimensions: Record<string, string>
): MetricDatum {
  const dimensions: Dimension[] = [];

  // Add global dimensions
  for (const [name, value] of Object.entries(globalDimensions)) {
    dimensions.push({ Name: name, Value: value });
  }

  // Add metric-specific dimensions
  if (metric.dimensions) {
    for (const [name, value] of Object.entries(metric.dimensions)) {
      dimensions.push({ Name: name, Value: value });
    }
  }

  return {
    MetricName: metric.name.replace(/\./g, '/'), // CloudWatch uses / not .
    Value: metric.value,
    Unit: getUnit(metric),
    Timestamp: metric.timestamp,
    Dimensions: dimensions.length > 0 ? dimensions : undefined,
  };
}

/**
 * Create a CloudWatch metrics handler
 */
export function createCloudWatchHandler(
  config?: Partial<CloudWatchConfig>
): (metrics: MetricValue[]) => Promise<void> {
  const fullConfig = { ...DEFAULT_CONFIG, ...config };
  const client = new CloudWatchClient({ region: fullConfig.region });

  return async (metrics: MetricValue[]) => {
    if (metrics.length === 0) return;

    // Convert metrics
    const cloudWatchMetrics = metrics.map((m) =>
      toCloudWatchMetric(m, fullConfig.dimensions)
    );

    // Send in batches
    for (let i = 0; i < cloudWatchMetrics.length; i += fullConfig.batchSize) {
      const batch = cloudWatchMetrics.slice(i, i + fullConfig.batchSize);

      try {
        await client.send(
          new PutMetricDataCommand({
            Namespace: fullConfig.namespace,
            MetricData: batch,
          })
        );
      } catch (error) {
        console.error('CloudWatch put metrics error:', error);
        throw error;
      }
    }
  };
}

/**
 * CloudWatch metrics publisher class with buffering
 */
export class CloudWatchPublisher {
  private client: CloudWatchClient;
  private config: CloudWatchConfig;
  private buffer: MetricDatum[] = [];
  private flushTimer: NodeJS.Timeout | null = null;

  constructor(config?: Partial<CloudWatchConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.client = new CloudWatchClient({ region: this.config.region });
  }

  /**
   * Add a metric to the buffer
   */
  addMetric(metric: MetricValue): void {
    const cwMetric = toCloudWatchMetric(metric, this.config.dimensions);
    this.buffer.push(cwMetric);

    // Auto-flush if buffer is full
    if (this.buffer.length >= this.config.batchSize) {
      this.flush();
    }
  }

  /**
   * Flush buffered metrics to CloudWatch
   */
  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;

    const batch = this.buffer.splice(0, this.config.batchSize);

    try {
      await this.client.send(
        new PutMetricDataCommand({
          Namespace: this.config.namespace,
          MetricData: batch,
        })
      );
    } catch (error) {
      console.error('CloudWatch flush error:', error);
      // Put metrics back in buffer on failure
      this.buffer.unshift(...batch);
      throw error;
    }
  }

  /**
   * Start automatic flushing
   */
  startAutoFlush(intervalMs: number = 60000): void {
    if (this.flushTimer) return;

    this.flushTimer = setInterval(async () => {
      try {
        await this.flush();
      } catch (error) {
        // Error already logged in flush
      }
    }, intervalMs);
  }

  /**
   * Stop automatic flushing
   */
  stopAutoFlush(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  /**
   * Close and flush remaining metrics
   */
  async close(): Promise<void> {
    this.stopAutoFlush();
    while (this.buffer.length > 0) {
      await this.flush();
    }
  }
}

/**
 * Helper to publish scraper-specific metrics
 */
export class ScraperCloudWatchMetrics {
  private publisher: CloudWatchPublisher;

  constructor(config?: Partial<CloudWatchConfig>) {
    this.publisher = new CloudWatchPublisher({
      namespace: 'CardmarketScraper',
      ...config,
    });
    this.publisher.startAutoFlush();
  }

  requestLatency(mode: 'http' | 'browser', latencyMs: number): void {
    this.publisher.addMetric({
      name: 'RequestLatency',
      type: 'timer',
      value: latencyMs,
      unit: 'Milliseconds',
      dimensions: { Mode: mode },
      timestamp: new Date(),
    });
  }

  requestCount(mode: 'http' | 'browser', success: boolean): void {
    this.publisher.addMetric({
      name: success ? 'RequestSuccess' : 'RequestFailure',
      type: 'counter',
      value: 1,
      unit: 'Count',
      dimensions: { Mode: mode },
      timestamp: new Date(),
    });
  }

  cardsScraped(setCode: string, count: number): void {
    this.publisher.addMetric({
      name: 'CardsScraped',
      type: 'counter',
      value: count,
      unit: 'Count',
      dimensions: { SetCode: setCode },
      timestamp: new Date(),
    });
  }

  errorCount(errorType: string): void {
    this.publisher.addMetric({
      name: 'ErrorCount',
      type: 'counter',
      value: 1,
      unit: 'Count',
      dimensions: { ErrorType: errorType },
      timestamp: new Date(),
    });
  }

  async close(): Promise<void> {
    await this.publisher.close();
  }
}
