/**
 * Metrics Collection and Reporting
 *
 * Collects scraper metrics for monitoring and alerting.
 * Supports multiple backends:
 * - CloudWatch (AWS)
 * - Console (local dev)
 * - Custom handlers
 */

export type MetricType = 'counter' | 'gauge' | 'histogram' | 'timer';

export interface MetricValue {
  name: string;
  type: MetricType;
  value: number;
  unit?: string;
  dimensions?: Record<string, string>;
  timestamp: Date;
}

export interface MetricsSummary {
  counters: Record<string, number>;
  gauges: Record<string, number>;
  histograms: Record<string, {
    count: number;
    min: number;
    max: number;
    avg: number;
    p50: number;
    p90: number;
    p99: number;
  }>;
  timers: Record<string, {
    count: number;
    totalMs: number;
    avgMs: number;
    minMs: number;
    maxMs: number;
  }>;
}

export interface MetricsConfig {
  namespace: string;
  flushInterval: number;    // ms between flushes
  retentionPeriod: number;  // ms to keep metrics before flushing
  dimensions: Record<string, string>;
}

const DEFAULT_CONFIG: MetricsConfig = {
  namespace: 'CardmarketScraper',
  flushInterval: 60000,     // 1 minute
  retentionPeriod: 300000,  // 5 minutes
  dimensions: {},
};

/**
 * Metrics collector class
 */
export class MetricsCollector {
  private config: MetricsConfig;
  private counters: Map<string, number> = new Map();
  private gauges: Map<string, number> = new Map();
  private histograms: Map<string, number[]> = new Map();
  private timers: Map<string, number[]> = new Map();
  private buffer: MetricValue[] = [];
  private handlers: Array<(metrics: MetricValue[]) => Promise<void>> = [];
  private flushTimer: NodeJS.Timeout | null = null;

  constructor(config?: Partial<MetricsConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Start automatic flushing
   */
  startAutoFlush(): void {
    if (this.flushTimer) return;

    this.flushTimer = setInterval(async () => {
      await this.flush();
    }, this.config.flushInterval);
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
   * Add a metrics handler
   */
  addHandler(handler: (metrics: MetricValue[]) => Promise<void>): void {
    this.handlers.push(handler);
  }

  /**
   * Increment a counter
   */
  increment(name: string, value: number = 1, dimensions?: Record<string, string>): void {
    const key = this.makeKey(name, dimensions);
    const current = this.counters.get(key) || 0;
    this.counters.set(key, current + value);

    this.buffer.push({
      name,
      type: 'counter',
      value,
      dimensions: { ...this.config.dimensions, ...dimensions },
      timestamp: new Date(),
    });
  }

  /**
   * Set a gauge value
   */
  gauge(name: string, value: number, unit?: string, dimensions?: Record<string, string>): void {
    const key = this.makeKey(name, dimensions);
    this.gauges.set(key, value);

    this.buffer.push({
      name,
      type: 'gauge',
      value,
      unit,
      dimensions: { ...this.config.dimensions, ...dimensions },
      timestamp: new Date(),
    });
  }

  /**
   * Record a histogram value
   */
  histogram(name: string, value: number, unit?: string, dimensions?: Record<string, string>): void {
    const key = this.makeKey(name, dimensions);
    const values = this.histograms.get(key) || [];
    values.push(value);
    this.histograms.set(key, values);

    this.buffer.push({
      name,
      type: 'histogram',
      value,
      unit,
      dimensions: { ...this.config.dimensions, ...dimensions },
      timestamp: new Date(),
    });
  }

  /**
   * Start a timer, returns a stop function
   */
  startTimer(name: string, dimensions?: Record<string, string>): () => number {
    const start = Date.now();

    return () => {
      const elapsed = Date.now() - start;
      const key = this.makeKey(name, dimensions);
      const times = this.timers.get(key) || [];
      times.push(elapsed);
      this.timers.set(key, times);

      this.buffer.push({
        name,
        type: 'timer',
        value: elapsed,
        unit: 'Milliseconds',
        dimensions: { ...this.config.dimensions, ...dimensions },
        timestamp: new Date(),
      });

      return elapsed;
    };
  }

  /**
   * Record a timing value directly
   */
  timing(name: string, ms: number, dimensions?: Record<string, string>): void {
    const key = this.makeKey(name, dimensions);
    const times = this.timers.get(key) || [];
    times.push(ms);
    this.timers.set(key, times);

    this.buffer.push({
      name,
      type: 'timer',
      value: ms,
      unit: 'Milliseconds',
      dimensions: { ...this.config.dimensions, ...dimensions },
      timestamp: new Date(),
    });
  }

  /**
   * Create a composite key for a metric
   */
  private makeKey(name: string, dimensions?: Record<string, string>): string {
    if (!dimensions || Object.keys(dimensions).length === 0) {
      return name;
    }
    const dimStr = Object.entries(dimensions)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join(',');
    return `${name}[${dimStr}]`;
  }

  /**
   * Calculate percentile from sorted array
   */
  private percentile(arr: number[], p: number): number {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }

  /**
   * Get summary of all metrics
   */
  getSummary(): MetricsSummary {
    const counters: Record<string, number> = {};
    const gauges: Record<string, number> = {};
    const histograms: Record<string, MetricsSummary['histograms'][string]> = {};
    const timers: Record<string, MetricsSummary['timers'][string]> = {};

    for (const [key, value] of this.counters) {
      counters[key] = value;
    }

    for (const [key, value] of this.gauges) {
      gauges[key] = value;
    }

    for (const [key, values] of this.histograms) {
      if (values.length === 0) continue;
      const sorted = [...values].sort((a, b) => a - b);
      histograms[key] = {
        count: values.length,
        min: sorted[0],
        max: sorted[sorted.length - 1],
        avg: values.reduce((a, b) => a + b, 0) / values.length,
        p50: this.percentile(sorted, 50),
        p90: this.percentile(sorted, 90),
        p99: this.percentile(sorted, 99),
      };
    }

    for (const [key, values] of this.timers) {
      if (values.length === 0) continue;
      timers[key] = {
        count: values.length,
        totalMs: values.reduce((a, b) => a + b, 0),
        avgMs: values.reduce((a, b) => a + b, 0) / values.length,
        minMs: Math.min(...values),
        maxMs: Math.max(...values),
      };
    }

    return { counters, gauges, histograms, timers };
  }

  /**
   * Flush metrics to handlers
   */
  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;

    const metrics = [...this.buffer];
    this.buffer = [];

    // Clean old histogram/timer data
    const cutoff = Date.now() - this.config.retentionPeriod;
    // Note: Full implementation would track timestamps per value

    for (const handler of this.handlers) {
      try {
        await handler(metrics);
      } catch (error) {
        console.error('Metrics handler error:', error);
      }
    }
  }

  /**
   * Reset all metrics
   */
  reset(): void {
    this.counters.clear();
    this.gauges.clear();
    this.histograms.clear();
    this.timers.clear();
    this.buffer = [];
  }
}

/**
 * Console metrics handler (for local development)
 */
export function createConsoleHandler(): (metrics: MetricValue[]) => Promise<void> {
  return async (metrics: MetricValue[]) => {
    console.log('\n=== Metrics Report ===');
    console.log(`Timestamp: ${new Date().toISOString()}`);
    console.log(`Metrics count: ${metrics.length}`);

    // Group by type
    const byType = metrics.reduce((acc, m) => {
      acc[m.type] = acc[m.type] || [];
      acc[m.type].push(m);
      return acc;
    }, {} as Record<string, MetricValue[]>);

    for (const [type, items] of Object.entries(byType)) {
      console.log(`\n${type.toUpperCase()}:`);
      for (const item of items) {
        const dims = item.dimensions
          ? ` [${Object.entries(item.dimensions).map(([k, v]) => `${k}=${v}`).join(', ')}]`
          : '';
        console.log(`  ${item.name}${dims}: ${item.value}${item.unit ? ` ${item.unit}` : ''}`);
      }
    }

    console.log('\n======================\n');
  };
}

/**
 * Create a global metrics collector instance
 */
let globalCollector: MetricsCollector | null = null;

export function getMetricsCollector(config?: Partial<MetricsConfig>): MetricsCollector {
  if (!globalCollector) {
    globalCollector = new MetricsCollector(config);
  }
  return globalCollector;
}

/**
 * Scraper-specific metrics helper
 */
export class ScraperMetrics {
  private collector: MetricsCollector;

  constructor(collector?: MetricsCollector) {
    this.collector = collector || getMetricsCollector();
  }

  recordRequest(success: boolean, mode: 'http' | 'browser', latencyMs: number): void {
    this.collector.increment('requests.total', 1, { mode });
    this.collector.increment(`requests.${success ? 'success' : 'failure'}`, 1, { mode });
    this.collector.timing('requests.latency', latencyMs, { mode });
  }

  recordCard(setCode: string): void {
    this.collector.increment('cards.scraped', 1, { set: setCode });
  }

  recordArticle(setCode: string): void {
    this.collector.increment('articles.scraped', 1, { set: setCode });
  }

  recordError(errorType: string): void {
    this.collector.increment('errors.total', 1, { type: errorType });
  }

  recordCaptcha(detected: boolean, solved: boolean): void {
    if (detected) {
      this.collector.increment('captcha.detected', 1);
    }
    if (solved) {
      this.collector.increment('captcha.solved', 1);
    }
  }

  recordProxyRotation(): void {
    this.collector.increment('proxy.rotations', 1);
  }

  setActiveMode(mode: 'http' | 'browser'): void {
    this.collector.gauge('mode.current', mode === 'http' ? 0 : 1);
  }

  setQueueSize(size: number): void {
    this.collector.gauge('queue.size', size);
  }
}
