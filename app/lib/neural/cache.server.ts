/**
 * Neural Pipeline Caching Layer
 *
 * Provides caching for expensive operations:
 * - Feature calculations
 * - Neural model predictions
 * - Pipeline results
 */

import { FeatureVector, DetectedDeal, PipelineResult, DealPrediction } from "./types";

// ============================================================================
// CACHE CONFIGURATION
// ============================================================================

interface CacheConfig {
  /** TTL for feature vectors in milliseconds (default: 5 minutes) */
  featureTtl: number;
  /** TTL for predictions in milliseconds (default: 1 minute) */
  predictionTtl: number;
  /** TTL for pipeline results in milliseconds (default: 10 minutes) */
  pipelineResultTtl: number;
  /** Maximum number of entries before eviction (default: 10000) */
  maxEntries: number;
}

const DEFAULT_CONFIG: CacheConfig = {
  featureTtl: 5 * 60 * 1000, // 5 minutes
  predictionTtl: 1 * 60 * 1000, // 1 minute
  pipelineResultTtl: 10 * 60 * 1000, // 10 minutes
  maxEntries: 10000,
};

// ============================================================================
// CACHE ENTRY
// ============================================================================

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  createdAt: number;
}

// ============================================================================
// LRU CACHE IMPLEMENTATION
// ============================================================================

/**
 * Simple LRU cache with TTL support.
 */
class LRUCache<T> {
  private cache: Map<string, CacheEntry<T>> = new Map();
  private maxEntries: number;

  constructor(maxEntries: number = 10000) {
    this.maxEntries = maxEntries;
  }

  get(key: string): T | undefined {
    const entry = this.cache.get(key);

    if (!entry) return undefined;

    // Check expiry
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }

    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, entry);

    return entry.value;
  }

  set(key: string, value: T, ttl: number): void {
    // Check if we need to evict
    if (this.cache.size >= this.maxEntries) {
      // Evict oldest entry (first in map)
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      }
    }

    this.cache.set(key, {
      value,
      expiresAt: Date.now() + ttl,
      createdAt: Date.now(),
    });
  }

  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return false;
    }

    return true;
  }

  delete(key: string): void {
    this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  size(): number {
    return this.cache.size;
  }

  /**
   * Clean up expired entries.
   */
  cleanup(): number {
    const now = Date.now();
    let removed = 0;

    for (const [key, entry] of this.cache) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
        removed++;
      }
    }

    return removed;
  }

  /**
   * Get cache statistics.
   */
  stats(): { size: number; oldest: number | null; newest: number | null } {
    let oldest: number | null = null;
    let newest: number | null = null;

    for (const entry of this.cache.values()) {
      if (oldest === null || entry.createdAt < oldest) {
        oldest = entry.createdAt;
      }
      if (newest === null || entry.createdAt > newest) {
        newest = entry.createdAt;
      }
    }

    return {
      size: this.cache.size,
      oldest,
      newest,
    };
  }
}

// ============================================================================
// NEURAL PIPELINE CACHE
// ============================================================================

/**
 * Cache manager for the neural pipeline.
 */
export class PipelineCache {
  private config: CacheConfig;
  private featureCache: LRUCache<FeatureVector>;
  private predictionCache: LRUCache<DealPrediction>;
  private pipelineResultCache: LRUCache<PipelineResult>;
  private dealCache: LRUCache<DetectedDeal[]>;

  // Statistics
  private hits = 0;
  private misses = 0;

  constructor(config?: Partial<CacheConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    this.featureCache = new LRUCache(this.config.maxEntries);
    this.predictionCache = new LRUCache(this.config.maxEntries);
    this.pipelineResultCache = new LRUCache(100); // Small cache for pipeline results
    this.dealCache = new LRUCache(this.config.maxEntries);

    // Set up periodic cleanup
    this.startCleanupInterval();
  }

  // ============================================================================
  // FEATURE CACHING
  // ============================================================================

  /**
   * Get cached feature vector for a card.
   */
  getFeatures(cardId: string): FeatureVector | undefined {
    const result = this.featureCache.get(cardId);
    if (result) {
      this.hits++;
    } else {
      this.misses++;
    }
    return result;
  }

  /**
   * Cache feature vector for a card.
   */
  setFeatures(cardId: string, features: FeatureVector): void {
    this.featureCache.set(cardId, features, this.config.featureTtl);
  }

  /**
   * Get multiple feature vectors, returning only cached ones.
   */
  getFeaturesBatch(cardIds: string[]): Map<string, FeatureVector> {
    const result = new Map<string, FeatureVector>();

    for (const cardId of cardIds) {
      const features = this.featureCache.get(cardId);
      if (features) {
        result.set(cardId, features);
        this.hits++;
      } else {
        this.misses++;
      }
    }

    return result;
  }

  /**
   * Cache multiple feature vectors.
   */
  setFeaturesBatch(featuresMap: Map<string, FeatureVector>): void {
    for (const [cardId, features] of featuresMap) {
      this.featureCache.set(cardId, features, this.config.featureTtl);
    }
  }

  // ============================================================================
  // PREDICTION CACHING
  // ============================================================================

  /**
   * Get cached prediction for a card.
   */
  getPrediction(cardId: string): DealPrediction | undefined {
    const result = this.predictionCache.get(cardId);
    if (result) {
      this.hits++;
    } else {
      this.misses++;
    }
    return result;
  }

  /**
   * Cache prediction for a card.
   */
  setPrediction(cardId: string, prediction: DealPrediction): void {
    this.predictionCache.set(cardId, prediction, this.config.predictionTtl);
  }

  // ============================================================================
  // DEAL CACHING
  // ============================================================================

  /**
   * Get cached deals for a card.
   */
  getDeals(cardId: string): DetectedDeal[] | undefined {
    return this.dealCache.get(cardId);
  }

  /**
   * Cache deals for a card.
   */
  setDeals(cardId: string, deals: DetectedDeal[]): void {
    this.dealCache.set(cardId, deals, this.config.featureTtl);
  }

  // ============================================================================
  // PIPELINE RESULT CACHING
  // ============================================================================

  /**
   * Get cached pipeline result for a game.
   */
  getPipelineResult(game: string): PipelineResult | undefined {
    return this.pipelineResultCache.get(game);
  }

  /**
   * Cache pipeline result for a game.
   */
  setPipelineResult(game: string, result: PipelineResult): void {
    this.pipelineResultCache.set(game, result, this.config.pipelineResultTtl);
  }

  // ============================================================================
  // CACHE MANAGEMENT
  // ============================================================================

  /**
   * Clear all caches.
   */
  clearAll(): void {
    this.featureCache.clear();
    this.predictionCache.clear();
    this.pipelineResultCache.clear();
    this.dealCache.clear();
    this.hits = 0;
    this.misses = 0;
    console.log("[PipelineCache] All caches cleared");
  }

  /**
   * Clear feature cache only.
   */
  clearFeatures(): void {
    this.featureCache.clear();
    console.log("[PipelineCache] Feature cache cleared");
  }

  /**
   * Clear prediction cache only.
   */
  clearPredictions(): void {
    this.predictionCache.clear();
    console.log("[PipelineCache] Prediction cache cleared");
  }

  /**
   * Invalidate cache for a specific card.
   */
  invalidateCard(cardId: string): void {
    this.featureCache.delete(cardId);
    this.predictionCache.delete(cardId);
    this.dealCache.delete(cardId);
  }

  /**
   * Get cache statistics.
   */
  getStats(): {
    features: { size: number; oldest: number | null; newest: number | null };
    predictions: { size: number; oldest: number | null; newest: number | null };
    deals: { size: number; oldest: number | null; newest: number | null };
    pipelineResults: { size: number; oldest: number | null; newest: number | null };
    hitRate: number;
    totalHits: number;
    totalMisses: number;
  } {
    const total = this.hits + this.misses;

    return {
      features: this.featureCache.stats(),
      predictions: this.predictionCache.stats(),
      deals: this.dealCache.stats(),
      pipelineResults: this.pipelineResultCache.stats(),
      hitRate: total > 0 ? this.hits / total : 0,
      totalHits: this.hits,
      totalMisses: this.misses,
    };
  }

  /**
   * Start periodic cleanup of expired entries.
   */
  private cleanupIntervalId: NodeJS.Timeout | null = null;

  private startCleanupInterval(): void {
    // Clean up every minute
    this.cleanupIntervalId = setInterval(() => {
      const featureRemoved = this.featureCache.cleanup();
      const predictionRemoved = this.predictionCache.cleanup();
      const dealRemoved = this.dealCache.cleanup();
      const resultRemoved = this.pipelineResultCache.cleanup();

      const total = featureRemoved + predictionRemoved + dealRemoved + resultRemoved;
      if (total > 0) {
        console.log(`[PipelineCache] Cleaned up ${total} expired entries`);
      }
    }, 60000);
  }

  /**
   * Stop the cleanup interval (for graceful shutdown).
   */
  stopCleanupInterval(): void {
    if (this.cleanupIntervalId) {
      clearInterval(this.cleanupIntervalId);
      this.cleanupIntervalId = null;
    }
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

let pipelineCacheInstance: PipelineCache | null = null;

/**
 * Get or create the pipeline cache singleton.
 */
export function getPipelineCache(config?: Partial<CacheConfig>): PipelineCache {
  if (!pipelineCacheInstance) {
    pipelineCacheInstance = new PipelineCache(config);
    console.log("[PipelineCache] Initialized pipeline cache");
  }
  return pipelineCacheInstance;
}

/**
 * Reset the pipeline cache singleton (for testing).
 */
export function resetPipelineCache(): void {
  if (pipelineCacheInstance) {
    pipelineCacheInstance.stopCleanupInterval();
    pipelineCacheInstance.clearAll();
    pipelineCacheInstance = null;
    console.log("[PipelineCache] Cache instance reset");
  }
}

// ============================================================================
// CACHE DECORATOR HELPERS
// ============================================================================

/**
 * Helper to cache async function results.
 */
export async function withCache<T>(
  cache: LRUCache<T>,
  key: string,
  ttl: number,
  fn: () => Promise<T>
): Promise<T> {
  const cached = cache.get(key);
  if (cached !== undefined) {
    return cached;
  }

  const result = await fn();
  cache.set(key, result, ttl);
  return result;
}
