/**
 * Features Module
 *
 * Feature store for real-time ML inference:
 * - Redis-based caching
 * - Pre-computed features by type
 * - Combined feature vectors
 */

export {
  RedisFeatureStore,
  createFeatureStore,
  type FeatureStoreConfig,
  type FeatureType,
  type TimeWindow,
  type PriceFeatures,
  type SocialFeatures,
  type TournamentFeatures,
  type CrossPlatformFeatures,
  type ListingFeatures,
  type CardFeatureVector,
} from './redis-feature-store.js';
