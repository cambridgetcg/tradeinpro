/**
 * Selector Health Monitor
 *
 * Monitors CSS selector success rates to detect Cardmarket HTML changes.
 * Uses exponential moving average for trend detection.
 */

import { SELECTOR_MONITORING_CONFIG } from '../config/cardmarket-optimized.js';

export interface SelectorStats {
  selector: string;
  attempts: number;
  successes: number;
  successRate: number;
  emaSuccessRate: number;
  lastAttempt: Date | null;
  lastSuccess: Date | null;
  isDegraded: boolean;
}

export interface SelectorMonitorConfig {
  alertThreshold: number;
  emaWeight: number;
  minAttempts: number;
  logInterval: number;
}

export type SelectorAlertHandler = (selector: string, stats: SelectorStats) => void;

/**
 * Selector Health Monitor
 */
export class SelectorMonitor {
  private config: SelectorMonitorConfig;
  private stats: Map<string, SelectorStats> = new Map();
  private alertHandlers: SelectorAlertHandler[] = [];
  private requestCount: number = 0;

  constructor(config?: Partial<SelectorMonitorConfig>) {
    this.config = { ...SELECTOR_MONITORING_CONFIG, ...config };
  }

  /**
   * Register an alert handler
   */
  onAlert(handler: SelectorAlertHandler): void {
    this.alertHandlers.push(handler);
  }

  /**
   * Record a selector attempt
   */
  recordAttempt(selector: string, success: boolean): void {
    let stat = this.stats.get(selector);

    if (!stat) {
      stat = this.initStat(selector);
      this.stats.set(selector, stat);
    }

    stat.attempts++;
    stat.lastAttempt = new Date();

    if (success) {
      stat.successes++;
      stat.lastSuccess = new Date();
    }

    // Update rates
    stat.successRate = stat.successes / stat.attempts;
    stat.emaSuccessRate = this.calculateEMA(stat.emaSuccessRate, success ? 1 : 0);

    // Check for degradation
    this.checkDegradation(selector, stat);

    // Periodic logging
    this.requestCount++;
    if (this.requestCount % this.config.logInterval === 0) {
      this.logSummary();
    }
  }

  /**
   * Record multiple selector attempts at once
   */
  recordAttempts(results: Array<{ selector: string; success: boolean }>): void {
    for (const { selector, success } of results) {
      this.recordAttempt(selector, success);
    }
  }

  /**
   * Initialize stats for a selector
   */
  private initStat(selector: string): SelectorStats {
    return {
      selector,
      attempts: 0,
      successes: 0,
      successRate: 1.0,  // Optimistic start
      emaSuccessRate: 1.0,
      lastAttempt: null,
      lastSuccess: null,
      isDegraded: false,
    };
  }

  /**
   * Calculate exponential moving average
   */
  private calculateEMA(current: number, newValue: number): number {
    const weight = this.config.emaWeight;
    return current * weight + newValue * (1 - weight);
  }

  /**
   * Check for selector degradation and trigger alerts
   */
  private checkDegradation(selector: string, stat: SelectorStats): void {
    // Only alert after minimum attempts
    if (stat.attempts < this.config.minAttempts) {
      return;
    }

    const wasDegraded = stat.isDegraded;
    stat.isDegraded = stat.emaSuccessRate < this.config.alertThreshold;

    // Trigger alert on state change
    if (stat.isDegraded && !wasDegraded) {
      this.triggerAlert(selector, stat);
    }
  }

  /**
   * Trigger degradation alert
   */
  private triggerAlert(selector: string, stat: SelectorStats): void {
    console.warn(
      `[Selector Alert] "${selector}" degraded - ` +
      `EMA: ${(stat.emaSuccessRate * 100).toFixed(1)}%, ` +
      `Actual: ${(stat.successRate * 100).toFixed(1)}%`
    );

    for (const handler of this.alertHandlers) {
      try {
        handler(selector, stat);
      } catch (error) {
        console.error('[Selector Monitor] Alert handler error:', error);
      }
    }
  }

  /**
   * Log summary of all selector health
   */
  private logSummary(): void {
    const entries = Array.from(this.stats.entries());

    if (entries.length === 0) return;

    console.log('\n[Selector Health Summary]');
    console.log('─'.repeat(80));

    // Sort by success rate (worst first)
    entries.sort((a, b) => a[1].emaSuccessRate - b[1].emaSuccessRate);

    for (const [selector, stat] of entries) {
      const status = stat.isDegraded ? '❌' : '✅';
      const ema = (stat.emaSuccessRate * 100).toFixed(1);
      const actual = (stat.successRate * 100).toFixed(1);

      console.log(
        `${status} ${selector.substring(0, 40).padEnd(40)} ` +
        `EMA: ${ema.padStart(5)}%  Actual: ${actual.padStart(5)}%  ` +
        `(${stat.successes}/${stat.attempts})`
      );
    }

    console.log('─'.repeat(80));
  }

  /**
   * Get stats for a specific selector
   */
  getSelectorStats(selector: string): SelectorStats | null {
    return this.stats.get(selector) || null;
  }

  /**
   * Get all selector stats
   */
  getAllStats(): Map<string, SelectorStats> {
    return new Map(this.stats);
  }

  /**
   * Get list of degraded selectors
   */
  getDegradedSelectors(): string[] {
    const degraded: string[] = [];
    for (const [selector, stat] of this.stats) {
      if (stat.isDegraded) {
        degraded.push(selector);
      }
    }
    return degraded;
  }

  /**
   * Get overall health score (0-1)
   */
  getHealthScore(): number {
    const entries = Array.from(this.stats.values());
    if (entries.length === 0) return 1.0;

    const totalEMA = entries.reduce((sum, stat) => sum + stat.emaSuccessRate, 0);
    return totalEMA / entries.length;
  }

  /**
   * Check if any critical selectors are degraded
   */
  hasCriticalDegradation(criticalSelectors: string[]): boolean {
    for (const selector of criticalSelectors) {
      const stat = this.stats.get(selector);
      if (stat?.isDegraded) {
        return true;
      }
    }
    return false;
  }

  /**
   * Reset all statistics
   */
  reset(): void {
    this.stats.clear();
    this.requestCount = 0;
    console.log('[Selector Monitor] Stats reset');
  }

  /**
   * Export stats for persistence
   */
  export(): Record<string, SelectorStats> {
    const exported: Record<string, SelectorStats> = {};
    for (const [selector, stat] of this.stats) {
      exported[selector] = { ...stat };
    }
    return exported;
  }

  /**
   * Import previously saved stats
   */
  import(data: Record<string, SelectorStats>): void {
    for (const [selector, stat] of Object.entries(data)) {
      this.stats.set(selector, {
        ...stat,
        lastAttempt: stat.lastAttempt ? new Date(stat.lastAttempt) : null,
        lastSuccess: stat.lastSuccess ? new Date(stat.lastSuccess) : null,
      });
    }
    console.log(`[Selector Monitor] Imported ${Object.keys(data).length} selector stats`);
  }
}

/**
 * Create a selector monitor instance
 */
export function createSelectorMonitor(config?: Partial<SelectorMonitorConfig>): SelectorMonitor {
  return new SelectorMonitor(config);
}

/**
 * Critical selectors for Cardmarket (must have high success rate)
 */
export const CRITICAL_SELECTORS = [
  // Expansion page
  '.col-product a',
  '.col-price .font-weight-bold',

  // Card detail page
  '.info-list-container',
  'h1.page-title',

  // Articles
  '.article-row',
];
