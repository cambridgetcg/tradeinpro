/**
 * Redis Feature Store
 *
 * Pre-computed feature cache for real-time ML model inference.
 * Stores card features, social signals, market metrics, and tournament data.
 *
 * Features are organized by:
 * - Card ID (primary key)
 * - Feature type (price, social, tournament, cross_platform)
 * - Time window (1h, 24h, 7d, 30d)
 *
 * Cost: AWS ElastiCache or self-hosted Redis (~$50-100/mo)
 */

import type { GameCode } from '../config/games.js';

/**
 * Feature store configuration
 */
export interface FeatureStoreConfig {
  redisUrl: string;
  keyPrefix?: string;
  defaultTTL?: number; // seconds
}

/**
 * Feature types supported by the store
 */
export type FeatureType = 'price' | 'social' | 'tournament' | 'cross_platform' | 'listing';

/**
 * Time windows for feature aggregation
 */
export type TimeWindow = '1h' | '6h' | '24h' | '7d' | '30d';

/**
 * Price features for a card
 */
export interface PriceFeatures {
  cardId: string;
  game: GameCode;

  // Current prices
  marketPrice: number;
  lowPrice: number;
  midPrice: number;
  highPrice: number;

  // Price changes
  priceChange1h: number;
  priceChange24h: number;
  priceChange7d: number;
  priceChange30d: number;

  // Price percentiles
  pricePercentile: number; // vs all cards in set

  // Volatility
  volatility7d: number;
  volatility30d: number;

  // Listing stats
  listingCount: number;
  avgListingPrice: number;
  listingSpread: number; // high - low / market

  // Sales velocity
  salesLast24h: number;
  salesLast7d: number;
  avgDaysToSell: number;

  updatedAt: Date;
}

/**
 * Social signal features for a card
 */
export interface SocialFeatures {
  cardId: string;
  game: GameCode;

  // Reddit signals
  redditPostCount24h: number;
  redditPostCount7d: number;
  redditTotalScore24h: number;
  redditTotalScore7d: number;
  redditAvgUpvoteRatio: number;
  redditPriceDiscussionCount: number;
  redditSentiment: number; // -1 to 1

  // YouTube signals
  youtubeVideoCount24h: number;
  youtubeVideoCount7d: number;
  youtubeTotalViews24h: number;
  youtubeTotalViews7d: number;
  youtubeTotalLikes: number;
  youtubeTopCreatorMention: boolean;

  // Combined social score (weighted)
  socialMomentumScore: number; // 0-100
  socialSentimentScore: number; // -1 to 1

  // Trending indicator
  isTrending: boolean;
  trendingScore: number;

  updatedAt: Date;
}

/**
 * Tournament/meta features for a card
 */
export interface TournamentFeatures {
  cardId: string;
  game: GameCode;

  // Meta share
  deckInclusionRate7d: number;
  deckInclusionRate30d: number;
  deckInclusionRateChange: number;

  // Tournament performance
  top8Rate: number;
  top4Rate: number;
  winRate: number;

  // Deck statistics
  avgCopiesPerDeck: number;
  archetypeDiversity: number;

  // Trending in meta
  isNewTech: boolean;
  metaTrendDirection: 'rising' | 'stable' | 'falling';

  // Recent tournaments
  recentTournamentCount: number;
  totalDecksAnalyzed: number;

  updatedAt: Date;
}

/**
 * Cross-platform arbitrage features
 */
export interface CrossPlatformFeatures {
  cardId: string;
  game: GameCode;

  // TCGplayer prices
  tcgplayerPriceUsd: number;
  tcgplayerLowUsd: number;

  // Cardmarket prices
  cardmarketPriceEur: number;
  cardmarketPriceUsd: number;
  cardmarketLowEur: number;
  cardmarketLowUsd: number;

  // Arbitrage metrics
  priceDiffUsd: number;
  priceDiffPercent: number;
  estimatedProfit: number;
  arbitrageDirection: 'BUY_CARDMARKET' | 'BUY_TCGPLAYER' | 'NO_OPPORTUNITY';

  // FX data
  fxRateEurUsd: number;

  // Historical
  avgSpread7d: number;
  avgSpread30d: number;

  updatedAt: Date;
}

/**
 * Listing-level features for Sniper model
 */
export interface ListingFeatures {
  listingKey: string; // sellerId-price-condition
  cardId: string;

  // Listing details
  price: number;
  condition: string;
  quantity: number;
  shippingCost: number;

  // Relative pricing
  discountFromMarket: number;
  discountFromLow: number;
  pricePercentile: number;

  // Seller metrics
  sellerRating: number;
  sellerSalesCount: number;
  sellerTier: 'new' | 'established' | 'power';

  // Temporal
  ageMinutes: number;
  firstSeenAt: Date;

  // Prediction target (training data)
  soldFast?: boolean;
  timeToSellMinutes?: number;

  updatedAt: Date;
}

/**
 * Combined feature vector for ML models
 */
export interface CardFeatureVector {
  cardId: string;
  game: GameCode;

  // All feature sets
  price: PriceFeatures | null;
  social: SocialFeatures | null;
  tournament: TournamentFeatures | null;
  crossPlatform: CrossPlatformFeatures | null;

  // Feature completeness
  featureCompleteness: number; // 0-1

  // Timestamps
  oldestFeatureAge: number; // seconds
  newestFeatureAge: number;

  fetchedAt: Date;
}

/**
 * Redis client interface (compatible with ioredis/redis)
 */
interface RedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode?: string, duration?: number): Promise<unknown>;
  setex(key: string, seconds: number, value: string): Promise<unknown>;
  mget(...keys: string[]): Promise<(string | null)[]>;
  mset(...keyValues: string[]): Promise<unknown>;
  del(...keys: string[]): Promise<number>;
  keys(pattern: string): Promise<string[]>;
  expire(key: string, seconds: number): Promise<number>;
  ttl(key: string): Promise<number>;
  pipeline(): RedisPipeline;
  quit(): Promise<unknown>;
}

interface RedisPipeline {
  setex(key: string, seconds: number, value: string): RedisPipeline;
  get(key: string): RedisPipeline;
  del(key: string): RedisPipeline;
  exec(): Promise<unknown[]>;
}

/**
 * Redis Feature Store
 */
export class RedisFeatureStore {
  private client: RedisClient;
  private keyPrefix: string;
  private defaultTTL: number;

  // TTL by feature type (seconds)
  private readonly FEATURE_TTL: Record<FeatureType, number> = {
    price: 3600,        // 1 hour - prices update hourly
    listing: 900,       // 15 minutes - listings change frequently
    social: 7200,       // 2 hours - social signals aggregate
    tournament: 86400,  // 24 hours - tournament data is daily
    cross_platform: 3600, // 1 hour - matches price refresh
  };

  constructor(client: RedisClient, config: Partial<FeatureStoreConfig> = {}) {
    this.client = client;
    this.keyPrefix = config.keyPrefix || 'tcg:features';
    this.defaultTTL = config.defaultTTL || 3600;
  }

  // ==================== Key Generation ====================

  /**
   * Generate Redis key for a feature
   */
  private key(type: FeatureType, cardId: string): string {
    return `${this.keyPrefix}:${type}:${cardId}`;
  }

  /**
   * Generate key for listing features
   */
  private listingKey(cardId: string, listingKey: string): string {
    return `${this.keyPrefix}:listing:${cardId}:${listingKey}`;
  }

  /**
   * Generate key pattern for scanning
   */
  private keyPattern(type: FeatureType, pattern: string = '*'): string {
    return `${this.keyPrefix}:${type}:${pattern}`;
  }

  // ==================== Price Features ====================

  /**
   * Store price features for a card
   */
  async setPriceFeatures(features: PriceFeatures): Promise<void> {
    const key = this.key('price', features.cardId);
    const value = JSON.stringify({
      ...features,
      updatedAt: features.updatedAt.toISOString(),
    });
    await this.client.setex(key, this.FEATURE_TTL.price, value);
  }

  /**
   * Get price features for a card
   */
  async getPriceFeatures(cardId: string): Promise<PriceFeatures | null> {
    const key = this.key('price', cardId);
    const value = await this.client.get(key);
    if (!value) return null;

    const parsed = JSON.parse(value);
    return {
      ...parsed,
      updatedAt: new Date(parsed.updatedAt),
    };
  }

  /**
   * Batch set price features
   */
  async batchSetPriceFeatures(featuresList: PriceFeatures[]): Promise<void> {
    const pipeline = this.client.pipeline();

    for (const features of featuresList) {
      const key = this.key('price', features.cardId);
      const value = JSON.stringify({
        ...features,
        updatedAt: features.updatedAt.toISOString(),
      });
      pipeline.setex(key, this.FEATURE_TTL.price, value);
    }

    await pipeline.exec();
  }

  /**
   * Batch get price features
   */
  async batchGetPriceFeatures(cardIds: string[]): Promise<Map<string, PriceFeatures>> {
    const keys = cardIds.map((id) => this.key('price', id));
    const values = await this.client.mget(...keys);

    const result = new Map<string, PriceFeatures>();

    for (let i = 0; i < cardIds.length; i++) {
      const value = values[i];
      if (value) {
        const parsed = JSON.parse(value);
        result.set(cardIds[i], {
          ...parsed,
          updatedAt: new Date(parsed.updatedAt),
        });
      }
    }

    return result;
  }

  // ==================== Social Features ====================

  /**
   * Store social features for a card
   */
  async setSocialFeatures(features: SocialFeatures): Promise<void> {
    const key = this.key('social', features.cardId);
    const value = JSON.stringify({
      ...features,
      updatedAt: features.updatedAt.toISOString(),
    });
    await this.client.setex(key, this.FEATURE_TTL.social, value);
  }

  /**
   * Get social features for a card
   */
  async getSocialFeatures(cardId: string): Promise<SocialFeatures | null> {
    const key = this.key('social', cardId);
    const value = await this.client.get(key);
    if (!value) return null;

    const parsed = JSON.parse(value);
    return {
      ...parsed,
      updatedAt: new Date(parsed.updatedAt),
    };
  }

  /**
   * Batch set social features
   */
  async batchSetSocialFeatures(featuresList: SocialFeatures[]): Promise<void> {
    const pipeline = this.client.pipeline();

    for (const features of featuresList) {
      const key = this.key('social', features.cardId);
      const value = JSON.stringify({
        ...features,
        updatedAt: features.updatedAt.toISOString(),
      });
      pipeline.setex(key, this.FEATURE_TTL.social, value);
    }

    await pipeline.exec();
  }

  // ==================== Tournament Features ====================

  /**
   * Store tournament features for a card
   */
  async setTournamentFeatures(features: TournamentFeatures): Promise<void> {
    const key = this.key('tournament', features.cardId);
    const value = JSON.stringify({
      ...features,
      updatedAt: features.updatedAt.toISOString(),
    });
    await this.client.setex(key, this.FEATURE_TTL.tournament, value);
  }

  /**
   * Get tournament features for a card
   */
  async getTournamentFeatures(cardId: string): Promise<TournamentFeatures | null> {
    const key = this.key('tournament', cardId);
    const value = await this.client.get(key);
    if (!value) return null;

    const parsed = JSON.parse(value);
    return {
      ...parsed,
      updatedAt: new Date(parsed.updatedAt),
    };
  }

  // ==================== Cross-Platform Features ====================

  /**
   * Store cross-platform features for a card
   */
  async setCrossPlatformFeatures(features: CrossPlatformFeatures): Promise<void> {
    const key = this.key('cross_platform', features.cardId);
    const value = JSON.stringify({
      ...features,
      updatedAt: features.updatedAt.toISOString(),
    });
    await this.client.setex(key, this.FEATURE_TTL.cross_platform, value);
  }

  /**
   * Get cross-platform features for a card
   */
  async getCrossPlatformFeatures(cardId: string): Promise<CrossPlatformFeatures | null> {
    const key = this.key('cross_platform', cardId);
    const value = await this.client.get(key);
    if (!value) return null;

    const parsed = JSON.parse(value);
    return {
      ...parsed,
      updatedAt: new Date(parsed.updatedAt),
    };
  }

  // ==================== Listing Features ====================

  /**
   * Store listing features
   */
  async setListingFeatures(features: ListingFeatures): Promise<void> {
    const key = this.listingKey(features.cardId, features.listingKey);
    const value = JSON.stringify({
      ...features,
      firstSeenAt: features.firstSeenAt.toISOString(),
      updatedAt: features.updatedAt.toISOString(),
    });
    await this.client.setex(key, this.FEATURE_TTL.listing, value);
  }

  /**
   * Get listing features
   */
  async getListingFeatures(cardId: string, listingKey: string): Promise<ListingFeatures | null> {
    const key = this.listingKey(cardId, listingKey);
    const value = await this.client.get(key);
    if (!value) return null;

    const parsed = JSON.parse(value);
    return {
      ...parsed,
      firstSeenAt: new Date(parsed.firstSeenAt),
      updatedAt: new Date(parsed.updatedAt),
    };
  }

  /**
   * Get all listing features for a card
   */
  async getCardListingFeatures(cardId: string): Promise<ListingFeatures[]> {
    const pattern = this.listingKey(cardId, '*');
    const keys = await this.client.keys(pattern);

    if (keys.length === 0) return [];

    const values = await this.client.mget(...keys);
    const results: ListingFeatures[] = [];

    for (const value of values) {
      if (value) {
        const parsed = JSON.parse(value);
        results.push({
          ...parsed,
          firstSeenAt: new Date(parsed.firstSeenAt),
          updatedAt: new Date(parsed.updatedAt),
        });
      }
    }

    return results;
  }

  /**
   * Batch set listing features
   */
  async batchSetListingFeatures(featuresList: ListingFeatures[]): Promise<void> {
    const pipeline = this.client.pipeline();

    for (const features of featuresList) {
      const key = this.listingKey(features.cardId, features.listingKey);
      const value = JSON.stringify({
        ...features,
        firstSeenAt: features.firstSeenAt.toISOString(),
        updatedAt: features.updatedAt.toISOString(),
      });
      pipeline.setex(key, this.FEATURE_TTL.listing, value);
    }

    await pipeline.exec();
  }

  // ==================== Combined Feature Vector ====================

  /**
   * Get complete feature vector for a card
   */
  async getFeatureVector(cardId: string, game: GameCode): Promise<CardFeatureVector> {
    const [price, social, tournament, crossPlatform] = await Promise.all([
      this.getPriceFeatures(cardId),
      this.getSocialFeatures(cardId),
      this.getTournamentFeatures(cardId),
      this.getCrossPlatformFeatures(cardId),
    ]);

    // Calculate feature completeness
    const featureSets = [price, social, tournament, crossPlatform];
    const availableCount = featureSets.filter((f) => f !== null).length;
    const featureCompleteness = availableCount / featureSets.length;

    // Calculate feature ages
    const now = Date.now();
    const ages = featureSets
      .filter((f): f is NonNullable<typeof f> => f !== null)
      .map((f) => (now - f.updatedAt.getTime()) / 1000);

    return {
      cardId,
      game,
      price,
      social,
      tournament,
      crossPlatform,
      featureCompleteness,
      oldestFeatureAge: ages.length > 0 ? Math.max(...ages) : 0,
      newestFeatureAge: ages.length > 0 ? Math.min(...ages) : 0,
      fetchedAt: new Date(),
    };
  }

  /**
   * Batch get feature vectors
   */
  async batchGetFeatureVectors(
    cardIds: string[],
    game: GameCode
  ): Promise<Map<string, CardFeatureVector>> {
    const result = new Map<string, CardFeatureVector>();

    // Fetch all feature types in parallel
    const [priceMap, socialMap, tournamentMap, crossPlatformMap] = await Promise.all([
      this.batchGetPriceFeatures(cardIds),
      this.batchGetSocialFeatures(cardIds),
      this.batchGetTournamentFeatures(cardIds),
      this.batchGetCrossPlatformFeatures(cardIds),
    ]);

    const now = Date.now();

    for (const cardId of cardIds) {
      const price = priceMap.get(cardId) || null;
      const social = socialMap.get(cardId) || null;
      const tournament = tournamentMap.get(cardId) || null;
      const crossPlatform = crossPlatformMap.get(cardId) || null;

      const featureSets = [price, social, tournament, crossPlatform];
      const availableCount = featureSets.filter((f) => f !== null).length;

      const ages = featureSets
        .filter((f): f is NonNullable<typeof f> => f !== null)
        .map((f) => (now - f.updatedAt.getTime()) / 1000);

      result.set(cardId, {
        cardId,
        game,
        price,
        social,
        tournament,
        crossPlatform,
        featureCompleteness: availableCount / featureSets.length,
        oldestFeatureAge: ages.length > 0 ? Math.max(...ages) : 0,
        newestFeatureAge: ages.length > 0 ? Math.min(...ages) : 0,
        fetchedAt: new Date(),
      });
    }

    return result;
  }

  // ==================== Batch Operations ====================

  /**
   * Batch get social features
   */
  private async batchGetSocialFeatures(cardIds: string[]): Promise<Map<string, SocialFeatures>> {
    const keys = cardIds.map((id) => this.key('social', id));
    const values = await this.client.mget(...keys);

    const result = new Map<string, SocialFeatures>();

    for (let i = 0; i < cardIds.length; i++) {
      const value = values[i];
      if (value) {
        const parsed = JSON.parse(value);
        result.set(cardIds[i], {
          ...parsed,
          updatedAt: new Date(parsed.updatedAt),
        });
      }
    }

    return result;
  }

  /**
   * Batch get tournament features
   */
  private async batchGetTournamentFeatures(cardIds: string[]): Promise<Map<string, TournamentFeatures>> {
    const keys = cardIds.map((id) => this.key('tournament', id));
    const values = await this.client.mget(...keys);

    const result = new Map<string, TournamentFeatures>();

    for (let i = 0; i < cardIds.length; i++) {
      const value = values[i];
      if (value) {
        const parsed = JSON.parse(value);
        result.set(cardIds[i], {
          ...parsed,
          updatedAt: new Date(parsed.updatedAt),
        });
      }
    }

    return result;
  }

  /**
   * Batch get cross-platform features
   */
  private async batchGetCrossPlatformFeatures(cardIds: string[]): Promise<Map<string, CrossPlatformFeatures>> {
    const keys = cardIds.map((id) => this.key('cross_platform', id));
    const values = await this.client.mget(...keys);

    const result = new Map<string, CrossPlatformFeatures>();

    for (let i = 0; i < cardIds.length; i++) {
      const value = values[i];
      if (value) {
        const parsed = JSON.parse(value);
        result.set(cardIds[i], {
          ...parsed,
          updatedAt: new Date(parsed.updatedAt),
        });
      }
    }

    return result;
  }

  // ==================== Utility Methods ====================

  /**
   * Delete all features for a card
   */
  async deleteCardFeatures(cardId: string): Promise<void> {
    const types: FeatureType[] = ['price', 'social', 'tournament', 'cross_platform'];
    const keys = types.map((t) => this.key(t, cardId));

    // Also delete listing features
    const listingPattern = this.listingKey(cardId, '*');
    const listingKeys = await this.client.keys(listingPattern);

    const allKeys = [...keys, ...listingKeys];
    if (allKeys.length > 0) {
      await this.client.del(...allKeys);
    }
  }

  /**
   * Check if features are stale
   */
  async areFeaturesFresh(cardId: string, maxAgeSeconds: number = 3600): Promise<boolean> {
    const priceKey = this.key('price', cardId);
    const ttl = await this.client.ttl(priceKey);

    if (ttl < 0) return false; // Key doesn't exist

    // Compare remaining TTL to max age
    const age = this.FEATURE_TTL.price - ttl;
    return age < maxAgeSeconds;
  }

  /**
   * Get feature store statistics
   */
  async getStats(): Promise<{
    priceFeatureCount: number;
    socialFeatureCount: number;
    tournamentFeatureCount: number;
    crossPlatformFeatureCount: number;
    listingFeatureCount: number;
  }> {
    const [price, social, tournament, crossPlatform, listing] = await Promise.all([
      this.client.keys(this.keyPattern('price')),
      this.client.keys(this.keyPattern('social')),
      this.client.keys(this.keyPattern('tournament')),
      this.client.keys(this.keyPattern('cross_platform')),
      this.client.keys(this.keyPattern('listing')),
    ]);

    return {
      priceFeatureCount: price.length,
      socialFeatureCount: social.length,
      tournamentFeatureCount: tournament.length,
      crossPlatformFeatureCount: crossPlatform.length,
      listingFeatureCount: listing.length,
    };
  }

  /**
   * Close the Redis connection
   */
  async close(): Promise<void> {
    await this.client.quit();
  }
}

/**
 * Create feature store instance
 */
export function createFeatureStore(
  client: RedisClient,
  config?: Partial<FeatureStoreConfig>
): RedisFeatureStore {
  return new RedisFeatureStore(client, config);
}

export default RedisFeatureStore;
