/**
 * Base Model and Feature Extractor Implementations
 *
 * Abstract base classes that all models and feature extractors extend.
 */

import type {
  MLModel,
  FeatureExtractor,
  BasePrediction,
  ModelStatus,
  ModelEnvironment,
} from "./types";
import { getModelEnvironment, PERFORMANCE_CONFIG, MODEL_VERSIONS } from "./config";

// =============================================================================
// BASE MODEL CLASS
// =============================================================================

/**
 * Abstract base class for all ML models
 */
export abstract class BaseModel<TInput, TOutput extends BasePrediction>
  implements MLModel<TInput, TOutput>
{
  abstract readonly name: string;
  abstract readonly version: string;

  protected _isLoaded: boolean = false;
  protected _lastInference: Date | null = null;
  protected _inferenceCount: number = 0;
  protected _totalLatencyMs: number = 0;
  protected _errorCount: number = 0;
  protected _environment: ModelEnvironment;

  constructor() {
    this._environment = getModelEnvironment();
  }

  /**
   * Initialize the model - must be implemented by subclasses
   */
  abstract load(): Promise<void>;

  /**
   * Run inference - must be implemented by subclasses
   */
  protected abstract _predict(input: TInput): Promise<Omit<TOutput, keyof BasePrediction>>;

  /**
   * Check if model is loaded
   */
  isLoaded(): boolean {
    return this._isLoaded;
  }

  /**
   * Get the execution environment
   */
  getEnvironment(): ModelEnvironment {
    return this._environment;
  }

  /**
   * Run inference with timing and error tracking
   */
  async predict(input: TInput): Promise<TOutput> {
    if (!this._isLoaded) {
      throw new Error(`Model ${this.name} is not loaded. Call load() first.`);
    }

    const startTime = performance.now();

    try {
      const result = await this._predict(input);
      const inferenceTimeMs = performance.now() - startTime;

      this._lastInference = new Date();
      this._inferenceCount++;
      this._totalLatencyMs += inferenceTimeMs;

      // Add base prediction fields
      return {
        ...result,
        confidence: (result as { confidence?: number }).confidence ?? 0,
        modelVersion: this.version,
        inferenceTimeMs,
        timestamp: new Date(),
      } as TOutput;
    } catch (error) {
      this._errorCount++;
      throw error;
    }
  }

  /**
   * Batch inference with parallelization
   */
  async predictBatch(inputs: TInput[]): Promise<TOutput[]> {
    // Default implementation: parallel prediction
    // Subclasses can override for optimized batch processing
    return Promise.all(inputs.map((input) => this.predict(input)));
  }

  /**
   * Get model status
   */
  getStatus(): ModelStatus {
    const avgLatency =
      this._inferenceCount > 0 ? this._totalLatencyMs / this._inferenceCount : 0;

    const errorRate =
      this._inferenceCount > 0
        ? this._errorCount / (this._inferenceCount + this._errorCount)
        : 0;

    return {
      name: this.name,
      version: this.version,
      environment: this._environment,
      isLoaded: this._isLoaded,
      lastInference: this._lastInference,
      inferenceCount: this._inferenceCount,
      averageLatencyMs: avgLatency,
      errorRate,
    };
  }

  /**
   * Unload model from memory
   */
  async unload(): Promise<void> {
    this._isLoaded = false;
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this._lastInference = null;
    this._inferenceCount = 0;
    this._totalLatencyMs = 0;
    this._errorCount = 0;
  }
}

// =============================================================================
// BASE FEATURE EXTRACTOR CLASS
// =============================================================================

/**
 * Abstract base class for feature extractors
 */
export abstract class BaseFeatureExtractor<TRaw, TFeatures>
  implements FeatureExtractor<TRaw, TFeatures>
{
  protected _featureNames: string[] = [];

  /**
   * Extract features from raw data - must be implemented by subclasses
   */
  abstract extract(raw: TRaw): Promise<TFeatures>;

  /**
   * Normalize features - can be overridden by subclasses
   */
  abstract normalize(features: TFeatures): TFeatures;

  /**
   * Get feature names
   */
  getFeatureNames(): string[] {
    return this._featureNames;
  }

  /**
   * Extract features for multiple items
   */
  async extractBatch(raw: TRaw[]): Promise<TFeatures[]> {
    return Promise.all(raw.map((r) => this.extract(r)));
  }
}

// =============================================================================
// MODEL REGISTRY
// =============================================================================

type ModelConstructor<TInput, TOutput extends BasePrediction> = new () => MLModel<
  TInput,
  TOutput
>;

/**
 * Registry for managing model instances
 */
export class ModelRegistry {
  private static instance: ModelRegistry;
  private models: Map<string, MLModel<unknown, BasePrediction>> = new Map();

  private constructor() {}

  static getInstance(): ModelRegistry {
    if (!ModelRegistry.instance) {
      ModelRegistry.instance = new ModelRegistry();
    }
    return ModelRegistry.instance;
  }

  /**
   * Register a model
   */
  register<TInput, TOutput extends BasePrediction>(
    name: string,
    model: MLModel<TInput, TOutput>
  ): void {
    this.models.set(name, model as MLModel<unknown, BasePrediction>);
  }

  /**
   * Get a model by name
   */
  get<TInput, TOutput extends BasePrediction>(name: string): MLModel<TInput, TOutput> | undefined {
    return this.models.get(name) as MLModel<TInput, TOutput> | undefined;
  }

  /**
   * Check if a model is registered
   */
  has(name: string): boolean {
    return this.models.has(name);
  }

  /**
   * Get all model names
   */
  getModelNames(): string[] {
    return Array.from(this.models.keys());
  }

  /**
   * Get status of all models
   */
  getAllStatus(): ModelStatus[] {
    return Array.from(this.models.values()).map((model) => model.getStatus());
  }

  /**
   * Load all registered models
   */
  async loadAll(): Promise<void> {
    const loadPromises = Array.from(this.models.values()).map((model) => model.load());
    await Promise.all(loadPromises);
  }

  /**
   * Unload all models
   */
  async unloadAll(): Promise<void> {
    const unloadPromises = Array.from(this.models.values()).map((model) => model.unload());
    await Promise.all(unloadPromises);
  }
}

// =============================================================================
// CACHING UTILITIES
// =============================================================================

interface CacheEntry<T> {
  value: T;
  timestamp: number;
  ttl: number;
}

/**
 * Simple in-memory cache with TTL
 */
export class ModelCache<T> {
  private cache: Map<string, CacheEntry<T>> = new Map();
  private defaultTTL: number;

  constructor(defaultTTLSeconds: number = 300) {
    this.defaultTTL = defaultTTLSeconds * 1000;
  }

  /**
   * Get a cached value
   */
  get(key: string): T | undefined {
    const entry = this.cache.get(key);

    if (!entry) {
      return undefined;
    }

    // Check if expired
    if (Date.now() - entry.timestamp > entry.ttl) {
      this.cache.delete(key);
      return undefined;
    }

    return entry.value;
  }

  /**
   * Set a cached value
   */
  set(key: string, value: T, ttlSeconds?: number): void {
    this.cache.set(key, {
      value,
      timestamp: Date.now(),
      ttl: ttlSeconds ? ttlSeconds * 1000 : this.defaultTTL,
    });
  }

  /**
   * Check if key exists and is not expired
   */
  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  /**
   * Delete a cached value
   */
  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  /**
   * Clear all cached values
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Remove expired entries
   */
  cleanup(): number {
    const now = Date.now();
    let removed = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > entry.ttl) {
        this.cache.delete(key);
        removed++;
      }
    }

    return removed;
  }

  /**
   * Get cache size
   */
  get size(): number {
    return this.cache.size;
  }
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Calculate z-score
 */
export function zScore(value: number, mean: number, std: number): number {
  if (std === 0) return 0;
  return (value - mean) / std;
}

/**
 * Calculate percentile rank
 */
export function percentileRank(value: number, sortedArray: number[]): number {
  if (sortedArray.length === 0) return 0;

  let count = 0;
  for (const v of sortedArray) {
    if (v < value) count++;
    else break;
  }

  return count / sortedArray.length;
}

/**
 * Calculate RSI (Relative Strength Index)
 */
export function calculateRSI(prices: number[], period: number = 14): number {
  if (prices.length < period + 1) return 50; // Neutral

  const changes: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    changes.push(prices[i] - prices[i - 1]);
  }

  const recentChanges = changes.slice(-period);

  let gains = 0;
  let losses = 0;

  for (const change of recentChanges) {
    if (change > 0) gains += change;
    else losses -= change;
  }

  const avgGain = gains / period;
  const avgLoss = losses / period;

  if (avgLoss === 0) return 100;

  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/**
 * Calculate MACD
 */
export function calculateMACD(
  prices: number[],
  fastPeriod: number = 12,
  slowPeriod: number = 26,
  signalPeriod: number = 9
): { macd: number; signal: number; histogram: number } {
  if (prices.length < slowPeriod) {
    return { macd: 0, signal: 0, histogram: 0 };
  }

  const emaFast = calculateEMA(prices, fastPeriod);
  const emaSlow = calculateEMA(prices, slowPeriod);

  const macdLine = emaFast - emaSlow;

  // Calculate signal line (EMA of MACD)
  // For simplicity, we'll use the current MACD as signal approximation
  const signal = macdLine * 0.9; // Simplified

  return {
    macd: macdLine,
    signal,
    histogram: macdLine - signal,
  };
}

/**
 * Calculate Exponential Moving Average
 */
export function calculateEMA(prices: number[], period: number): number {
  if (prices.length === 0) return 0;
  if (prices.length < period) {
    // Return simple average if not enough data
    return prices.reduce((a, b) => a + b, 0) / prices.length;
  }

  const multiplier = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;

  for (let i = period; i < prices.length; i++) {
    ema = (prices[i] - ema) * multiplier + ema;
  }

  return ema;
}

/**
 * Calculate standard deviation
 */
export function standardDeviation(values: number[]): number {
  if (values.length === 0) return 0;

  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const squaredDiffs = values.map((v) => Math.pow(v - mean, 2));
  const avgSquaredDiff = squaredDiffs.reduce((a, b) => a + b, 0) / values.length;

  return Math.sqrt(avgSquaredDiff);
}

/**
 * Calculate percentage change
 */
export function percentChange(current: number, previous: number): number {
  if (previous === 0) return 0;
  return (current - previous) / previous;
}

/**
 * Normalize value to 0-1 range
 */
export function normalize(value: number, min: number, max: number): number {
  if (max === min) return 0.5;
  return Math.max(0, Math.min(1, (value - min) / (max - min)));
}

/**
 * Clip value to range
 */
export function clip(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
