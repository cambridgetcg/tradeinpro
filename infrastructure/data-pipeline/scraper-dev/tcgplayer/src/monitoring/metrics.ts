/**
 * Metrics Collection
 *
 * Collects and publishes pipeline metrics to CloudWatch.
 */

import {
  CloudWatchClient,
  PutMetricDataCommand,
  type MetricDatum,
  type Dimension,
} from '@aws-sdk/client-cloudwatch';
import type { GameCode } from '../config/games.js';

/**
 * Metric namespace
 */
export const METRIC_NAMESPACE = 'TCGplayer/Pipeline';

/**
 * Metric names
 */
export enum MetricName {
  // Fetch metrics
  CardsFetched = 'CardsFetched',
  SetsFetched = 'SetsFetched',
  FetchDuration = 'FetchDuration',
  FetchErrors = 'FetchErrors',

  // Transform metrics
  CardsValidated = 'CardsValidated',
  CardsMerged = 'CardsMerged',
  CardsTransformed = 'CardsTransformed',
  TransformDuration = 'TransformDuration',
  TransformErrors = 'TransformErrors',
  ValidationWarnings = 'ValidationWarnings',

  // Load metrics
  CardsInserted = 'CardsInserted',
  CardsUpdated = 'CardsUpdated',
  CardsSkipped = 'CardsSkipped',
  LoadDuration = 'LoadDuration',
  LoadErrors = 'LoadErrors',
  PriceHistoryRecords = 'PriceHistoryRecords',

  // Pipeline metrics
  PipelineDuration = 'PipelineDuration',
  PipelineSuccess = 'PipelineSuccess',
  PipelineFailure = 'PipelineFailure',

  // API metrics
  ApiRequests = 'ApiRequests',
  ApiErrors = 'ApiErrors',
  ApiLatency = 'ApiLatency',
  ApiRateLimit = 'ApiRateLimit',

  // Scraper metrics
  PagesScraped = 'PagesScraped',
  BlocksDetected = 'BlocksDetected',
  ChallengesEncountered = 'ChallengesEncountered',
}

/**
 * Metric unit types
 */
export type MetricUnit =
  | 'Count'
  | 'Milliseconds'
  | 'Seconds'
  | 'Bytes'
  | 'Percent'
  | 'None';

/**
 * Metric configuration
 */
export interface MetricConfig {
  namespace: string;
  enabled: boolean;
  batchSize: number;
  flushInterval: number;
  region?: string;
}

/**
 * Metric data point
 */
export interface MetricDataPoint {
  name: MetricName | string;
  value: number;
  unit: MetricUnit;
  dimensions?: Record<string, string>;
  timestamp?: Date;
}

const DEFAULT_CONFIG: MetricConfig = {
  namespace: METRIC_NAMESPACE,
  enabled: process.env.ENABLE_METRICS === 'true',
  batchSize: 20,
  flushInterval: 60000, // 1 minute
  region: process.env.AWS_REGION || 'us-east-1',
};

/**
 * Metrics collector
 */
export class MetricsCollector {
  private client: CloudWatchClient;
  private config: MetricConfig;
  private buffer: MetricDatum[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config?: Partial<MetricConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.client = new CloudWatchClient({ region: this.config.region });

    if (this.config.enabled && this.config.flushInterval > 0) {
      this.startAutoFlush();
    }
  }

  /**
   * Record a metric
   */
  record(metric: MetricDataPoint): void {
    if (!this.config.enabled) {
      console.log(`[Metric] ${metric.name}: ${metric.value} ${metric.unit}`, metric.dimensions);
      return;
    }

    const dimensions: Dimension[] = [];
    if (metric.dimensions) {
      for (const [name, value] of Object.entries(metric.dimensions)) {
        dimensions.push({ Name: name, Value: value });
      }
    }

    this.buffer.push({
      MetricName: metric.name,
      Value: metric.value,
      Unit: metric.unit,
      Dimensions: dimensions.length > 0 ? dimensions : undefined,
      Timestamp: metric.timestamp || new Date(),
    });

    if (this.buffer.length >= this.config.batchSize) {
      this.flush();
    }
  }

  /**
   * Record multiple metrics
   */
  recordBatch(metrics: MetricDataPoint[]): void {
    for (const metric of metrics) {
      this.record(metric);
    }
  }

  /**
   * Convenience methods for common metrics
   */
  recordFetch(game: GameCode, source: string, cardCount: number, duration: number, success: boolean): void {
    const dimensions = { Game: game, Source: source };

    this.record({
      name: MetricName.CardsFetched,
      value: cardCount,
      unit: 'Count',
      dimensions,
    });

    this.record({
      name: MetricName.FetchDuration,
      value: duration,
      unit: 'Milliseconds',
      dimensions,
    });

    if (!success) {
      this.record({
        name: MetricName.FetchErrors,
        value: 1,
        unit: 'Count',
        dimensions,
      });
    }
  }

  recordTransform(game: GameCode, stats: {
    validated: number;
    merged: number;
    transformed: number;
    errors: number;
    warnings: number;
    duration: number;
  }): void {
    const dimensions = { Game: game };

    this.recordBatch([
      { name: MetricName.CardsValidated, value: stats.validated, unit: 'Count', dimensions },
      { name: MetricName.CardsMerged, value: stats.merged, unit: 'Count', dimensions },
      { name: MetricName.CardsTransformed, value: stats.transformed, unit: 'Count', dimensions },
      { name: MetricName.TransformDuration, value: stats.duration, unit: 'Milliseconds', dimensions },
      { name: MetricName.TransformErrors, value: stats.errors, unit: 'Count', dimensions },
      { name: MetricName.ValidationWarnings, value: stats.warnings, unit: 'Count', dimensions },
    ]);
  }

  recordLoad(stats: {
    inserted: number;
    updated: number;
    skipped: number;
    errors: number;
    priceHistoryRecords: number;
    duration: number;
  }): void {
    this.recordBatch([
      { name: MetricName.CardsInserted, value: stats.inserted, unit: 'Count' },
      { name: MetricName.CardsUpdated, value: stats.updated, unit: 'Count' },
      { name: MetricName.CardsSkipped, value: stats.skipped, unit: 'Count' },
      { name: MetricName.LoadErrors, value: stats.errors, unit: 'Count' },
      { name: MetricName.PriceHistoryRecords, value: stats.priceHistoryRecords, unit: 'Count' },
      { name: MetricName.LoadDuration, value: stats.duration, unit: 'Milliseconds' },
    ]);
  }

  recordPipelineComplete(success: boolean, duration: number, games: GameCode[]): void {
    const dimensions = { GameCount: String(games.length) };

    this.record({
      name: success ? MetricName.PipelineSuccess : MetricName.PipelineFailure,
      value: 1,
      unit: 'Count',
      dimensions,
    });

    this.record({
      name: MetricName.PipelineDuration,
      value: duration,
      unit: 'Milliseconds',
      dimensions,
    });
  }

  recordApiCall(source: string, duration: number, success: boolean): void {
    const dimensions = { Source: source };

    this.record({
      name: MetricName.ApiRequests,
      value: 1,
      unit: 'Count',
      dimensions,
    });

    this.record({
      name: MetricName.ApiLatency,
      value: duration,
      unit: 'Milliseconds',
      dimensions,
    });

    if (!success) {
      this.record({
        name: MetricName.ApiErrors,
        value: 1,
        unit: 'Count',
        dimensions,
      });
    }
  }

  recordScraperStats(pagesScraped: number, blocksDetected: number, challenges: number): void {
    this.recordBatch([
      { name: MetricName.PagesScraped, value: pagesScraped, unit: 'Count' },
      { name: MetricName.BlocksDetected, value: blocksDetected, unit: 'Count' },
      { name: MetricName.ChallengesEncountered, value: challenges, unit: 'Count' },
    ]);
  }

  /**
   * Flush metrics to CloudWatch
   */
  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;

    if (!this.config.enabled) {
      console.log(`[Metrics] Would flush ${this.buffer.length} metrics`);
      this.buffer = [];
      return;
    }

    const metrics = this.buffer.splice(0, this.buffer.length);

    // Split into batches of 20 (CloudWatch limit)
    for (let i = 0; i < metrics.length; i += 20) {
      const batch = metrics.slice(i, i + 20);

      try {
        await this.client.send(
          new PutMetricDataCommand({
            Namespace: this.config.namespace,
            MetricData: batch,
          })
        );
      } catch (error) {
        console.error('Failed to publish metrics:', error);
        // Re-add to buffer for retry
        this.buffer.push(...batch);
      }
    }
  }

  /**
   * Start auto-flush timer
   */
  private startAutoFlush(): void {
    if (this.flushTimer) return;

    this.flushTimer = setInterval(() => {
      this.flush().catch(console.error);
    }, this.config.flushInterval);
  }

  /**
   * Stop auto-flush timer
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
    await this.flush();
  }

  /**
   * Get buffer size
   */
  getBufferSize(): number {
    return this.buffer.length;
  }
}

/**
 * Create metrics collector
 */
export function createMetricsCollector(config?: Partial<MetricConfig>): MetricsCollector {
  return new MetricsCollector(config);
}

/**
 * Singleton instance for convenience
 */
let defaultCollector: MetricsCollector | null = null;

export function getMetricsCollector(): MetricsCollector {
  if (!defaultCollector) {
    defaultCollector = new MetricsCollector();
  }
  return defaultCollector;
}

export function setDefaultMetricsCollector(collector: MetricsCollector): void {
  defaultCollector = collector;
}
