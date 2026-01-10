/**
 * YouTube Data Collector
 *
 * Collects TCG-related video data from YouTube for sentiment analysis.
 * Uses official YouTube Data API v3.
 *
 * Cost: Free (10,000 quota units/day)
 * Quota costs:
 *   - Search: 100 units
 *   - Video details: 1 unit per video
 *   - With 10k daily, can do ~100 searches/day
 */

import type { GameCode } from '../config/games.js';

/**
 * YouTube collector configuration
 */
export interface YouTubeCollectorConfig {
  apiKey: string;
  maxDailyQuota?: number;
}

/**
 * Video signal data
 */
export interface VideoSignal {
  videoId: string;
  title: string;
  description: string;
  channelId: string;
  channelTitle: string;
  publishedAt: Date;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  duration?: string;
  tags?: string[];
  categoryId?: string;
  cardMentions: string[];  // Extracted card names
  game: GameCode;
}

/**
 * Aggregated YouTube signals for a card
 */
export interface CardYouTubeSignals {
  cardId: string;
  cardName: string;
  videoCount: number;
  totalViews: number;
  totalLikes: number;
  avgViewsPerVideo: number;
  topCreatorMention: boolean;
  recentVideos: VideoSignal[];
  collectedAt: Date;
}

/**
 * YouTube API search response types
 */
interface YouTubeSearchResponse {
  items: Array<{
    id: { videoId: string };
    snippet: {
      publishedAt: string;
      channelId: string;
      title: string;
      description: string;
      channelTitle: string;
    };
  }>;
  pageInfo: {
    totalResults: number;
    resultsPerPage: number;
  };
  nextPageToken?: string;
}

interface YouTubeVideosResponse {
  items: Array<{
    id: string;
    statistics: {
      viewCount: string;
      likeCount: string;
      commentCount: string;
    };
    contentDetails?: {
      duration: string;
    };
    snippet?: {
      tags?: string[];
      categoryId?: string;
    };
  }>;
}

/**
 * YouTube Data Collector
 */
export class YouTubeCollector {
  private apiKey: string;
  private baseUrl = 'https://www.googleapis.com/youtube/v3';
  private dailyQuotaUsed = 0;
  private dailyQuotaMax: number;
  private quotaResetTime: Date;

  // Search queries by game
  private readonly SEARCH_QUERIES: Record<GameCode, string[]> = {
    onepiece: [
      'one piece tcg opening',
      'optcg market price',
      'one piece card pull',
      'one piece tcg box opening',
      'optcg deck profile',
    ],
    pokemon: [
      'pokemon tcg opening',
      'pokemon card pull',
      'pokemon tcg market',
      'pokemon booster box',
      'ptcg deck',
    ],
    mtg: [
      'mtg opening',
      'magic the gathering box',
      'mtg finance',
      'mtg market',
      'magic deck tech',
    ],
    yugioh: [
      'yugioh opening',
      'yugioh box',
      'yugioh market',
      'ygo deck profile',
    ],
    lorcana: [
      'disney lorcana opening',
      'lorcana box',
      'lorcana market',
    ],
    'flesh-and-blood': [
      'flesh and blood tcg opening',
      'fab tcg box',
    ],
    digimon: [
      'digimon tcg opening',
      'digimon card game',
    ],
    'dragon-ball': [
      'dragon ball fusion world opening',
      'dragon ball tcg',
    ],
  };

  // Known large TCG YouTube channels (subscriber count threshold)
  private readonly TOP_CREATORS = new Set([
    'UCiPerttMrEflf3VSL6Q9vhg', // Example channel IDs
    'UC4V9r1ggN2n4LfD9F7qZEtw',
  ]);

  constructor(config: YouTubeCollectorConfig) {
    this.apiKey = config.apiKey;
    this.dailyQuotaMax = config.maxDailyQuota || 10000;
    this.quotaResetTime = this.getNextMidnightPT();
  }

  /**
   * Search for TCG-related videos
   *
   * Quota cost: 100 units per search + 1 per video detail
   */
  async searchTCGVideos(
    game: GameCode,
    options: {
      hours?: number;
      maxResults?: number;
      queries?: string[];
    } = {}
  ): Promise<VideoSignal[]> {
    const hours = options.hours || 24;
    const maxResults = options.maxResults || 25;
    const queries = options.queries || this.SEARCH_QUERIES[game] || [];

    const results: VideoSignal[] = [];
    const publishedAfter = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

    for (const query of queries) {
      // Check quota
      if (!this.checkQuota(100 + maxResults)) {
        console.warn(`YouTube quota nearly exhausted (${this.dailyQuotaUsed}/${this.dailyQuotaMax}), stopping`);
        break;
      }

      try {
        // Search request (100 quota)
        const searchUrl = new URL(`${this.baseUrl}/search`);
        searchUrl.searchParams.set('key', this.apiKey);
        searchUrl.searchParams.set('part', 'snippet');
        searchUrl.searchParams.set('q', query);
        searchUrl.searchParams.set('type', 'video');
        searchUrl.searchParams.set('publishedAfter', publishedAfter);
        searchUrl.searchParams.set('maxResults', String(maxResults));
        searchUrl.searchParams.set('order', 'viewCount');
        searchUrl.searchParams.set('relevanceLanguage', 'en');

        const searchResponse = await fetch(searchUrl.toString());
        this.dailyQuotaUsed += 100;

        if (!searchResponse.ok) {
          console.error(`YouTube search error: ${searchResponse.statusText}`);
          continue;
        }

        const searchData: YouTubeSearchResponse = await searchResponse.json();
        const videoIds = searchData.items
          .map((item) => item.id.videoId)
          .filter(Boolean);

        if (videoIds.length === 0) continue;

        // Get video statistics (1 quota per video)
        const statsUrl = new URL(`${this.baseUrl}/videos`);
        statsUrl.searchParams.set('key', this.apiKey);
        statsUrl.searchParams.set('part', 'statistics,contentDetails,snippet');
        statsUrl.searchParams.set('id', videoIds.join(','));

        const statsResponse = await fetch(statsUrl.toString());
        this.dailyQuotaUsed += videoIds.length;

        if (!statsResponse.ok) {
          console.error(`YouTube stats error: ${statsResponse.statusText}`);
          continue;
        }

        const statsData: YouTubeVideosResponse = await statsResponse.json();
        const statsMap = new Map(
          statsData.items.map((v) => [v.id, v])
        );

        // Combine search and stats data
        for (const item of searchData.items) {
          const videoId = item.id.videoId;
          const stats = statsMap.get(videoId);

          if (!stats) continue;

          results.push({
            videoId,
            title: item.snippet.title,
            description: item.snippet.description,
            channelId: item.snippet.channelId,
            channelTitle: item.snippet.channelTitle,
            publishedAt: new Date(item.snippet.publishedAt),
            viewCount: parseInt(stats.statistics.viewCount || '0'),
            likeCount: parseInt(stats.statistics.likeCount || '0'),
            commentCount: parseInt(stats.statistics.commentCount || '0'),
            duration: stats.contentDetails?.duration,
            tags: stats.snippet?.tags,
            categoryId: stats.snippet?.categoryId,
            cardMentions: this.extractCardMentions(item.snippet.title, item.snippet.description),
            game,
          });
        }
      } catch (error) {
        console.error(`YouTube search error for "${query}":`, error);
      }
    }

    return results;
  }

  /**
   * Search for videos mentioning a specific card
   */
  async searchCardVideos(
    cardName: string,
    game: GameCode,
    options: {
      days?: number;
      maxResults?: number;
    } = {}
  ): Promise<VideoSignal[]> {
    const days = options.days || 7;
    const gameTerms: Record<GameCode, string> = {
      onepiece: 'one piece tcg',
      pokemon: 'pokemon tcg',
      mtg: 'mtg',
      yugioh: 'yugioh',
      lorcana: 'lorcana',
      'flesh-and-blood': 'fab tcg',
      digimon: 'digimon tcg',
      'dragon-ball': 'dragon ball fusion',
    };

    const query = `${cardName} ${gameTerms[game] || game}`;

    return this.searchTCGVideos(game, {
      hours: days * 24,
      maxResults: options.maxResults || 25,
      queries: [query],
    });
  }

  /**
   * Aggregate YouTube signals for a card
   */
  async getCardSignals(
    cardName: string,
    game: GameCode,
    days: number = 7
  ): Promise<CardYouTubeSignals> {
    const videos = await this.searchCardVideos(cardName, game, { days });

    const totalViews = videos.reduce((sum, v) => sum + v.viewCount, 0);
    const totalLikes = videos.reduce((sum, v) => sum + v.likeCount, 0);
    const topCreatorMention = videos.some((v) => this.TOP_CREATORS.has(v.channelId));

    return {
      cardId: '', // To be matched later
      cardName,
      videoCount: videos.length,
      totalViews,
      totalLikes,
      avgViewsPerVideo: videos.length > 0 ? totalViews / videos.length : 0,
      topCreatorMention,
      recentVideos: videos.slice(0, 10), // Top 10 by views
      collectedAt: new Date(),
    };
  }

  /**
   * Get trending TCG videos across all games
   */
  async getTrendingTCGVideos(hours: number = 24): Promise<Map<GameCode, VideoSignal[]>> {
    const results = new Map<GameCode, VideoSignal[]>();
    const games: GameCode[] = ['onepiece', 'pokemon', 'mtg', 'yugioh'];

    for (const game of games) {
      if (!this.checkQuota(500)) {
        console.warn('YouTube quota exhausted');
        break;
      }

      const videos = await this.searchTCGVideos(game, { hours, maxResults: 10 });
      results.set(game, videos);
    }

    return results;
  }

  /**
   * Extract card names from video title/description
   *
   * This is a basic implementation - could be improved with:
   * - Card name database lookup
   * - NER (Named Entity Recognition)
   * - Set code patterns (e.g., OP01-001)
   */
  private extractCardMentions(title: string, description: string): string[] {
    const text = `${title} ${description}`.toLowerCase();
    const mentions: string[] = [];

    // Pattern: Set codes like OP01-001, BT15-001, etc.
    const setCodePattern = /\b([A-Z]{2,4}\d{1,2}[-\s]?\d{2,3})\b/gi;
    const setMatches = text.match(setCodePattern);
    if (setMatches) {
      mentions.push(...setMatches.map((m) => m.toUpperCase()));
    }

    // Pattern: "Card Name" in quotes
    const quotedPattern = /"([^"]{3,50})"/g;
    let match;
    while ((match = quotedPattern.exec(text)) !== null) {
      mentions.push(match[1]);
    }

    return [...new Set(mentions)]; // Deduplicate
  }

  /**
   * Check if we have enough quota for an operation
   */
  private checkQuota(required: number): boolean {
    // Reset quota if it's past midnight PT
    if (new Date() >= this.quotaResetTime) {
      this.dailyQuotaUsed = 0;
      this.quotaResetTime = this.getNextMidnightPT();
    }

    return this.dailyQuotaUsed + required <= this.dailyQuotaMax;
  }

  /**
   * Get next midnight Pacific Time
   */
  private getNextMidnightPT(): Date {
    const now = new Date();
    // Convert to PT (UTC-8 or UTC-7 for DST)
    const ptOffset = -8 * 60; // minutes
    const utc = now.getTime() + now.getTimezoneOffset() * 60000;
    const pt = new Date(utc + ptOffset * 60000);

    // Set to next midnight
    pt.setHours(24, 0, 0, 0);

    // Convert back to local
    return new Date(pt.getTime() - ptOffset * 60000 - now.getTimezoneOffset() * 60000);
  }

  /**
   * Get remaining daily quota
   */
  getRemainingQuota(): number {
    if (new Date() >= this.quotaResetTime) {
      return this.dailyQuotaMax;
    }
    return Math.max(0, this.dailyQuotaMax - this.dailyQuotaUsed);
  }

  /**
   * Get quota usage statistics
   */
  getQuotaStats(): {
    used: number;
    remaining: number;
    max: number;
    resetAt: Date;
  } {
    const remaining = this.getRemainingQuota();
    return {
      used: this.dailyQuotaUsed,
      remaining,
      max: this.dailyQuotaMax,
      resetAt: this.quotaResetTime,
    };
  }

  /**
   * Add a top creator channel ID
   */
  addTopCreator(channelId: string): void {
    this.TOP_CREATORS.add(channelId);
  }
}

/**
 * Create YouTube collector instance
 */
export function createYouTubeCollector(config: YouTubeCollectorConfig): YouTubeCollector {
  return new YouTubeCollector(config);
}

export default YouTubeCollector;
