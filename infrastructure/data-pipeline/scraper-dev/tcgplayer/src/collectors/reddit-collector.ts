/**
 * Reddit Data Collector
 *
 * Collects TCG-related posts and discussions from Reddit for sentiment analysis.
 * Uses Reddit API with OAuth authentication.
 *
 * Cost: Free
 * Rate limit: 100 requests/minute with OAuth
 *
 * Documentation: https://www.reddit.com/dev/api/
 */

import type { GameCode } from '../config/games.js';

/**
 * Reddit collector configuration
 */
export interface RedditCollectorConfig {
  clientId: string;
  clientSecret: string;
  userAgent?: string;
}

/**
 * Reddit post data
 */
export interface RedditPost {
  postId: string;
  subreddit: string;
  title: string;
  content: string;
  author: string | null;
  score: number;
  upvoteRatio: number;
  numComments: number;
  url: string;
  permalink: string;
  postedAt: Date;
  flair: string | null;
  isPriceDiscussion: boolean;
  cardMentions: string[];
  game: GameCode;
}

/**
 * Reddit comment data
 */
export interface RedditComment {
  commentId: string;
  postId: string;
  content: string;
  author: string | null;
  score: number;
  postedAt: Date;
  depth: number;
}

/**
 * Aggregated Reddit signals for a card
 */
export interface CardRedditSignals {
  cardId: string;
  cardName: string;
  postCount: number;
  totalComments: number;
  totalScore: number;
  avgUpvoteRatio: number;
  priceDiscussionCount: number;
  sentiment: number; // Derived from upvote ratio
  recentPosts: RedditPost[];
  collectedAt: Date;
}

/**
 * Reddit API response types
 */
interface RedditAuthResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

interface RedditListingResponse {
  kind: string;
  data: {
    children: Array<{
      kind: string;
      data: {
        id: string;
        subreddit: string;
        title: string;
        selftext: string;
        author: string;
        score: number;
        upvote_ratio: number;
        num_comments: number;
        url: string;
        permalink: string;
        created_utc: number;
        link_flair_text: string | null;
      };
    }>;
    after: string | null;
  };
}

/**
 * Reddit Data Collector
 */
export class RedditCollector {
  private clientId: string;
  private clientSecret: string;
  private userAgent: string;
  private accessToken: string | null = null;
  private tokenExpiry: Date | null = null;

  // Request tracking for rate limiting
  private requestTimes: number[] = [];
  private readonly MAX_REQUESTS_PER_MINUTE = 60; // Conservative limit

  // Subreddits by game
  private readonly SUBREDDITS: Record<GameCode, string[]> = {
    onepiece: ['OnePieceTCG', 'OnePieceCard'],
    pokemon: ['PokemonTCG', 'pokemoncardcollectors', 'PokeInvesting', 'pkmntcgtrades'],
    mtg: ['magicTCG', 'mtgfinance', 'EDH', 'ModernMagic', 'spikes'],
    yugioh: ['yugioh', 'YuGiOhMasterDuel', 'yugiohshowcase'],
    lorcana: ['DisneyLorcana', 'Lorcana'],
    'flesh-and-blood': ['FlessAndBloodTCG', 'FABTCG'],
    digimon: ['DigimonCardGame2020', 'DigimonTCG'],
    'dragon-ball': ['DBS_CardGame', 'DragonBallFusionWorld'],
  };

  // Price-related keywords
  private readonly PRICE_KEYWORDS = [
    'price', 'value', 'worth', 'sell', 'buy', 'market',
    'spike', 'crash', 'investment', 'trade', 'deal',
    'graded', 'psa', 'cgc', 'bgs', 'underpriced',
  ];

  constructor(config: RedditCollectorConfig) {
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.userAgent = config.userAgent || 'TCG-Price-Tracker/1.0 (Multi-Game Collector)';
  }

  /**
   * Authenticate with Reddit API
   */
  private async authenticate(): Promise<void> {
    // Check if we have a valid token
    if (this.accessToken && this.tokenExpiry && new Date() < this.tokenExpiry) {
      return;
    }

    const credentials = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');

    const response = await fetch('https://www.reddit.com/api/v1/access_token', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': this.userAgent,
      },
      body: 'grant_type=client_credentials',
    });

    if (!response.ok) {
      throw new Error(`Reddit authentication failed: ${response.statusText}`);
    }

    const data: RedditAuthResponse = await response.json();
    this.accessToken = data.access_token;
    this.tokenExpiry = new Date(Date.now() + (data.expires_in - 60) * 1000); // 60s buffer
  }

  /**
   * Make authenticated request to Reddit API
   */
  private async request<T>(endpoint: string): Promise<T> {
    await this.authenticate();
    await this.rateLimit();

    const response = await fetch(`https://oauth.reddit.com${endpoint}`, {
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'User-Agent': this.userAgent,
      },
    });

    this.requestTimes.push(Date.now());

    if (!response.ok) {
      throw new Error(`Reddit API error: ${response.status} ${response.statusText}`);
    }

    return response.json() as Promise<T>;
  }

  /**
   * Simple rate limiting
   */
  private async rateLimit(): Promise<void> {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;

    // Remove old requests
    this.requestTimes = this.requestTimes.filter((t) => t > oneMinuteAgo);

    // Wait if we're at the limit
    if (this.requestTimes.length >= this.MAX_REQUESTS_PER_MINUTE) {
      const oldestRequest = this.requestTimes[0];
      const waitTime = oldestRequest + 60000 - now;
      if (waitTime > 0) {
        await new Promise((resolve) => setTimeout(resolve, waitTime));
      }
    }
  }

  /**
   * Collect recent posts from game-specific subreddits
   */
  async collectPosts(
    game: GameCode,
    options: {
      hours?: number;
      limitPerSub?: number;
    } = {}
  ): Promise<RedditPost[]> {
    const hours = options.hours || 24;
    const limitPerSub = options.limitPerSub || 100;
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);

    const results: RedditPost[] = [];
    const subreddits = this.SUBREDDITS[game] || [];

    for (const subreddit of subreddits) {
      try {
        const response = await this.request<RedditListingResponse>(
          `/r/${subreddit}/new?limit=${limitPerSub}`
        );

        for (const child of response.data.children) {
          const post = child.data;
          const postedAt = new Date(post.created_utc * 1000);

          if (postedAt < cutoff) continue;

          const content = `${post.title} ${post.selftext || ''}`;
          const isPriceDiscussion = this.isPriceDiscussion(content);

          results.push({
            postId: post.id,
            subreddit: post.subreddit,
            title: post.title,
            content: post.selftext || '',
            author: post.author !== '[deleted]' ? post.author : null,
            score: post.score,
            upvoteRatio: post.upvote_ratio,
            numComments: post.num_comments,
            url: post.url,
            permalink: `https://reddit.com${post.permalink}`,
            postedAt,
            flair: post.link_flair_text,
            isPriceDiscussion,
            cardMentions: this.extractCardMentions(content),
            game,
          });
        }
      } catch (error) {
        console.error(`Error collecting from r/${subreddit}:`, error);
      }
    }

    return results;
  }

  /**
   * Search for posts mentioning a specific card
   */
  async searchCardPosts(
    cardName: string,
    game: GameCode,
    options: {
      days?: number;
      limit?: number;
    } = {}
  ): Promise<RedditPost[]> {
    const days = options.days || 7;
    const limit = options.limit || 50;
    const timeFilter = days <= 1 ? 'day' : days <= 7 ? 'week' : 'month';

    const results: RedditPost[] = [];
    const subreddits = this.SUBREDDITS[game] || [];

    for (const subreddit of subreddits) {
      try {
        const query = encodeURIComponent(cardName);
        const response = await this.request<RedditListingResponse>(
          `/r/${subreddit}/search?q=${query}&restrict_sr=1&sort=relevance&t=${timeFilter}&limit=${limit}`
        );

        for (const child of response.data.children) {
          const post = child.data;
          const content = `${post.title} ${post.selftext || ''}`;

          results.push({
            postId: post.id,
            subreddit: post.subreddit,
            title: post.title,
            content: post.selftext || '',
            author: post.author !== '[deleted]' ? post.author : null,
            score: post.score,
            upvoteRatio: post.upvote_ratio,
            numComments: post.num_comments,
            url: post.url,
            permalink: `https://reddit.com${post.permalink}`,
            postedAt: new Date(post.created_utc * 1000),
            flair: post.link_flair_text,
            isPriceDiscussion: this.isPriceDiscussion(content),
            cardMentions: [cardName],
            game,
          });
        }
      } catch (error) {
        console.error(`Error searching r/${subreddit} for "${cardName}":`, error);
      }
    }

    return results;
  }

  /**
   * Collect comments from a specific post
   */
  async collectComments(
    postId: string,
    subreddit: string,
    limit: number = 100
  ): Promise<RedditComment[]> {
    interface CommentData {
      id: string;
      body: string;
      author: string;
      score: number;
      created_utc: number;
      depth: number;
    }

    const results: RedditComment[] = [];

    try {
      const response = await this.request<[RedditListingResponse, RedditListingResponse]>(
        `/r/${subreddit}/comments/${postId}?limit=${limit}&depth=3`
      );

      // Response is [post, comments]
      const commentListing = response[1];

      const processComments = (children: Array<{ kind: string; data: CommentData }>, depth = 0) => {
        for (const child of children) {
          if (child.kind !== 't1') continue; // t1 = comment

          const comment = child.data;
          results.push({
            commentId: comment.id,
            postId,
            content: comment.body,
            author: comment.author !== '[deleted]' ? comment.author : null,
            score: comment.score,
            postedAt: new Date(comment.created_utc * 1000),
            depth,
          });

          // Process replies if present
          const replies = (child.data as any).replies;
          if (replies && replies.data?.children) {
            processComments(replies.data.children, depth + 1);
          }
        }
      };

      processComments(commentListing.data.children as any);
    } catch (error) {
      console.error(`Error collecting comments for ${postId}:`, error);
    }

    return results;
  }

  /**
   * Aggregate Reddit signals for a card
   */
  async getCardSignals(
    cardName: string,
    game: GameCode,
    days: number = 7
  ): Promise<CardRedditSignals> {
    const posts = await this.searchCardPosts(cardName, game, { days });

    const totalScore = posts.reduce((sum, p) => sum + p.score, 0);
    const totalComments = posts.reduce((sum, p) => sum + p.numComments, 0);
    const avgUpvoteRatio = posts.length > 0
      ? posts.reduce((sum, p) => sum + p.upvoteRatio, 0) / posts.length
      : 0.5;
    const priceDiscussionCount = posts.filter((p) => p.isPriceDiscussion).length;

    // Sentiment derived from upvote ratio (0.5 = neutral, 1.0 = very positive)
    // Convert to -1 to 1 scale
    const sentiment = (avgUpvoteRatio - 0.5) * 2;

    return {
      cardId: '', // To be matched later
      cardName,
      postCount: posts.length,
      totalComments,
      totalScore,
      avgUpvoteRatio,
      priceDiscussionCount,
      sentiment,
      recentPosts: posts.slice(0, 10), // Top 10 by score
      collectedAt: new Date(),
    };
  }

  /**
   * Get hot posts from all TCG subreddits
   */
  async getHotPosts(limit: number = 25): Promise<Map<GameCode, RedditPost[]>> {
    const results = new Map<GameCode, RedditPost[]>();
    const games = Object.keys(this.SUBREDDITS) as GameCode[];

    for (const game of games) {
      const posts: RedditPost[] = [];

      for (const subreddit of this.SUBREDDITS[game]) {
        try {
          const response = await this.request<RedditListingResponse>(
            `/r/${subreddit}/hot?limit=${limit}`
          );

          for (const child of response.data.children) {
            const post = child.data;
            const content = `${post.title} ${post.selftext || ''}`;

            posts.push({
              postId: post.id,
              subreddit: post.subreddit,
              title: post.title,
              content: post.selftext || '',
              author: post.author !== '[deleted]' ? post.author : null,
              score: post.score,
              upvoteRatio: post.upvote_ratio,
              numComments: post.num_comments,
              url: post.url,
              permalink: `https://reddit.com${post.permalink}`,
              postedAt: new Date(post.created_utc * 1000),
              flair: post.link_flair_text,
              isPriceDiscussion: this.isPriceDiscussion(content),
              cardMentions: this.extractCardMentions(content),
              game,
            });
          }
        } catch (error) {
          console.error(`Error getting hot posts from r/${subreddit}:`, error);
        }
      }

      results.set(game, posts);
    }

    return results;
  }

  /**
   * Check if content is about prices/market
   */
  private isPriceDiscussion(content: string): boolean {
    const lowerContent = content.toLowerCase();
    return this.PRICE_KEYWORDS.some((keyword) => lowerContent.includes(keyword));
  }

  /**
   * Extract card names from content
   */
  private extractCardMentions(content: string): string[] {
    const mentions: string[] = [];

    // Pattern: Set codes like OP01-001, BT15-001, etc.
    const setCodePattern = /\b([A-Z]{2,4}\d{1,2}[-\s]?\d{2,3})\b/gi;
    const matches = content.match(setCodePattern);
    if (matches) {
      mentions.push(...matches.map((m) => m.toUpperCase()));
    }

    return [...new Set(mentions)];
  }

  /**
   * Add custom subreddit for a game
   */
  addSubreddit(game: GameCode, subreddit: string): void {
    if (!this.SUBREDDITS[game]) {
      this.SUBREDDITS[game] = [];
    }
    if (!this.SUBREDDITS[game].includes(subreddit)) {
      this.SUBREDDITS[game].push(subreddit);
    }
  }

  /**
   * Get rate limit statistics
   */
  getRateLimitStats(): {
    requestsInLastMinute: number;
    maxPerMinute: number;
    available: number;
  } {
    const now = Date.now();
    const recentRequests = this.requestTimes.filter((t) => t > now - 60000).length;

    return {
      requestsInLastMinute: recentRequests,
      maxPerMinute: this.MAX_REQUESTS_PER_MINUTE,
      available: Math.max(0, this.MAX_REQUESTS_PER_MINUTE - recentRequests),
    };
  }
}

/**
 * Create Reddit collector instance
 */
export function createRedditCollector(config: RedditCollectorConfig): RedditCollector {
  return new RedditCollector(config);
}

export default RedditCollector;
