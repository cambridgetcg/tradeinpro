/**
 * Social Signal Collector Lambda
 *
 * Collects social signals from Twitter/X, Reddit, and YouTube to
 * detect sentiment and trending cards for demand prediction.
 *
 * Sources:
 * - Twitter/X: Card mentions, hashtags, sentiment
 * - Reddit: r/OnePieceTCG, r/TradingCardGames discussions
 * - YouTube: Deck profiles, unboxings, meta discussions
 */

import { Handler, ScheduledEvent } from "aws-lambda";
import {
  getSecrets,
  putToKinesis,
  RateLimiter,
  withRetry,
  nowIso,
  sanitizeString,
  SignalEvent,
} from "/opt/nodejs/utils";

// =============================================================================
// CONFIGURATION
// =============================================================================

const SIGNAL_STREAM = process.env.SIGNAL_STREAM_NAME!;

// Rate limiters for each platform
const twitterRateLimiter = new RateLimiter(15, 60); // 15 requests per 15 min window
const redditRateLimiter = new RateLimiter(1, 2); // 30 requests per minute
const youtubeRateLimiter = new RateLimiter(100, 60); // 100 requests per minute

// Search keywords
const SEARCH_KEYWORDS = [
  "one piece card game",
  "one piece tcg",
  "optcg",
  "#OnePieceTCG",
  "#OPTCG",
];

const CARD_KEYWORDS = [
  "OP01",
  "OP02",
  "OP03",
  "OP04",
  "OP05",
  "OP06",
  "OP07",
  "OP08",
  "OP09",
  "OP10",
  "OP11",
  "EB01",
  "EB02",
];

const SUBREDDITS = ["OnePieceTCG", "TradingCardGames", "TCGCollecting"];

// =============================================================================
// TYPES
// =============================================================================

interface TwitterTweet {
  id: string;
  text: string;
  author_id: string;
  created_at: string;
  public_metrics: {
    retweet_count: number;
    reply_count: number;
    like_count: number;
    quote_count: number;
  };
  entities?: {
    hashtags?: Array<{ tag: string }>;
    mentions?: Array<{ username: string }>;
    urls?: Array<{ expanded_url: string }>;
  };
}

interface TwitterSearchResponse {
  data?: TwitterTweet[];
  meta?: {
    result_count: number;
    next_token?: string;
  };
}

interface RedditPost {
  id: string;
  title: string;
  selftext: string;
  author: string;
  subreddit: string;
  score: number;
  upvote_ratio: number;
  num_comments: number;
  created_utc: number;
  url: string;
  is_video: boolean;
  link_flair_text?: string;
}

interface RedditListingResponse {
  data: {
    children: Array<{ data: RedditPost }>;
    after?: string;
  };
}

interface YouTubeVideo {
  id: { videoId: string };
  snippet: {
    publishedAt: string;
    channelId: string;
    channelTitle: string;
    title: string;
    description: string;
    thumbnails: {
      default: { url: string };
    };
  };
}

interface YouTubeSearchResponse {
  items?: YouTubeVideo[];
  pageInfo?: {
    totalResults: number;
  };
  nextPageToken?: string;
}

interface YouTubeVideoStats {
  id: string;
  statistics: {
    viewCount: string;
    likeCount?: string;
    commentCount?: string;
  };
}

// =============================================================================
// SENTIMENT ANALYSIS
// =============================================================================

// Simple keyword-based sentiment (would use ML in production)
const POSITIVE_KEYWORDS = [
  "amazing",
  "love",
  "great",
  "best",
  "awesome",
  "beautiful",
  "want",
  "need",
  "fire",
  "sick",
  "insane",
  "gorgeous",
  "stunning",
  "invest",
  "underrated",
  "staple",
  "meta",
  "tier 1",
  "must have",
  "grail",
];

const NEGATIVE_KEYWORDS = [
  "hate",
  "bad",
  "worst",
  "terrible",
  "awful",
  "ugly",
  "overrated",
  "overpriced",
  "expensive",
  "scam",
  "fake",
  "disappointed",
  "trash",
  "garbage",
  "dead",
  "crashed",
  "tanked",
  "avoid",
];

function analyzeSentiment(text: string): { score: number; keywords: string[] } {
  const lowerText = text.toLowerCase();
  const foundKeywords: string[] = [];
  let score = 0;

  for (const keyword of POSITIVE_KEYWORDS) {
    if (lowerText.includes(keyword)) {
      score += 1;
      foundKeywords.push(`+${keyword}`);
    }
  }

  for (const keyword of NEGATIVE_KEYWORDS) {
    if (lowerText.includes(keyword)) {
      score -= 1;
      foundKeywords.push(`-${keyword}`);
    }
  }

  // Normalize to -1 to 1 range
  const normalizedScore = Math.max(-1, Math.min(1, score / 3));

  return { score: normalizedScore, keywords: foundKeywords };
}

// =============================================================================
// CARD EXTRACTION
// =============================================================================

function extractCardMentions(text: string): string[] {
  const mentions: string[] = [];
  const cleanText = text.toUpperCase();

  // Match card IDs like OP01-001, EB02-123, etc.
  const cardIdPattern = /([A-Z]{2,3}\d{2})-(\d{3})/g;
  let match;

  while ((match = cardIdPattern.exec(cleanText)) !== null) {
    mentions.push(`${match[1]}-${match[2]}`);
  }

  // Match set codes mentioned
  for (const setCode of CARD_KEYWORDS) {
    if (cleanText.includes(setCode)) {
      if (!mentions.some((m) => m.startsWith(setCode))) {
        mentions.push(setCode);
      }
    }
  }

  return [...new Set(mentions)];
}

// =============================================================================
// TWITTER/X COLLECTOR
// =============================================================================

class TwitterCollector {
  private bearerToken: string;

  constructor(bearerToken: string) {
    this.bearerToken = bearerToken;
  }

  private async request<T>(endpoint: string): Promise<T> {
    await twitterRateLimiter.acquire();

    const url = `https://api.twitter.com/2${endpoint}`;

    const response = await withRetry(async () => {
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${this.bearerToken}`,
        },
      });

      if (!res.ok) {
        if (res.status === 429) {
          throw new Error("Rate limited");
        }
        throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      }

      return res.json();
    });

    return response;
  }

  async searchRecent(query: string, maxResults: number = 100): Promise<TwitterTweet[]> {
    const params = new URLSearchParams({
      query: `${query} -is:retweet lang:en`,
      max_results: Math.min(maxResults, 100).toString(),
      "tweet.fields": "created_at,public_metrics,entities",
    });

    const response = await this.request<TwitterSearchResponse>(
      `/tweets/search/recent?${params.toString()}`
    );

    return response.data || [];
  }

  async collectSignals(collectedAt: string): Promise<SignalEvent[]> {
    const signals: SignalEvent[] = [];

    for (const keyword of SEARCH_KEYWORDS) {
      try {
        const tweets = await this.searchRecent(keyword, 50);

        for (const tweet of tweets) {
          const sentiment = analyzeSentiment(tweet.text);
          const cardMentions = extractCardMentions(tweet.text);

          // Calculate engagement score
          const engagement =
            tweet.public_metrics.like_count * 1 +
            tweet.public_metrics.retweet_count * 2 +
            tweet.public_metrics.reply_count * 1.5 +
            tweet.public_metrics.quote_count * 2.5;

          signals.push({
            eventType: "signal",
            source: "twitter",
            signalId: `tw-${tweet.id}`,
            signalType: "social_mention",
            cardIds: cardMentions,
            content: sanitizeString(tweet.text.substring(0, 500)),
            sentiment: sentiment.score,
            sentimentKeywords: sentiment.keywords,
            engagement,
            authorId: tweet.author_id,
            url: `https://twitter.com/i/web/status/${tweet.id}`,
            metadata: {
              likes: tweet.public_metrics.like_count,
              retweets: tweet.public_metrics.retweet_count,
              replies: tweet.public_metrics.reply_count,
              hashtags: tweet.entities?.hashtags?.map((h) => h.tag) || [],
            },
            timestamp: tweet.created_at,
            collectedAt,
          });
        }
      } catch (error) {
        console.warn(`Twitter search failed for "${keyword}":`, error);
      }
    }

    return signals;
  }
}

// =============================================================================
// REDDIT COLLECTOR
// =============================================================================

class RedditCollector {
  private userAgent: string;

  constructor(userAgent: string = "OPTCG-DataCollector/1.0") {
    this.userAgent = userAgent;
  }

  private async request<T>(endpoint: string): Promise<T> {
    await redditRateLimiter.acquire();

    const url = `https://oauth.reddit.com${endpoint}`;

    const response = await withRetry(async () => {
      const res = await fetch(url, {
        headers: {
          "User-Agent": this.userAgent,
        },
      });

      if (!res.ok) {
        if (res.status === 429) {
          throw new Error("Rate limited");
        }
        throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      }

      return res.json();
    });

    return response;
  }

  async getSubredditPosts(
    subreddit: string,
    sort: "hot" | "new" | "top" = "hot",
    limit: number = 25
  ): Promise<RedditPost[]> {
    const response = await this.request<RedditListingResponse>(
      `/r/${subreddit}/${sort}.json?limit=${limit}`
    );

    return response.data.children.map((child) => child.data);
  }

  async searchSubreddit(subreddit: string, query: string): Promise<RedditPost[]> {
    const response = await this.request<RedditListingResponse>(
      `/r/${subreddit}/search.json?q=${encodeURIComponent(query)}&restrict_sr=1&limit=25`
    );

    return response.data.children.map((child) => child.data);
  }

  async collectSignals(collectedAt: string): Promise<SignalEvent[]> {
    const signals: SignalEvent[] = [];

    for (const subreddit of SUBREDDITS) {
      try {
        // Get hot and new posts
        const hotPosts = await this.getSubredditPosts(subreddit, "hot", 25);
        const newPosts = await this.getSubredditPosts(subreddit, "new", 25);
        const allPosts = [...hotPosts, ...newPosts];

        // Deduplicate by ID
        const uniquePosts = new Map(allPosts.map((p) => [p.id, p]));

        for (const post of uniquePosts.values()) {
          const fullText = `${post.title} ${post.selftext}`;
          const sentiment = analyzeSentiment(fullText);
          const cardMentions = extractCardMentions(fullText);

          // Skip if not related to specific cards and has neutral sentiment
          if (cardMentions.length === 0 && Math.abs(sentiment.score) < 0.3) {
            continue;
          }

          // Calculate engagement (Reddit uses score which is upvotes - downvotes)
          const engagement = post.score * post.upvote_ratio + post.num_comments * 2;

          signals.push({
            eventType: "signal",
            source: "reddit",
            signalId: `rd-${post.id}`,
            signalType: "social_mention",
            cardIds: cardMentions,
            content: sanitizeString(`${post.title}\n${post.selftext}`.substring(0, 1000)),
            sentiment: sentiment.score,
            sentimentKeywords: sentiment.keywords,
            engagement,
            authorId: post.author,
            url: `https://reddit.com${post.url}`,
            metadata: {
              subreddit: post.subreddit,
              score: post.score,
              upvoteRatio: post.upvote_ratio,
              comments: post.num_comments,
              flair: post.link_flair_text,
              isVideo: post.is_video,
            },
            timestamp: new Date(post.created_utc * 1000).toISOString(),
            collectedAt,
          });
        }
      } catch (error) {
        console.warn(`Reddit collection failed for r/${subreddit}:`, error);
      }
    }

    return signals;
  }
}

// =============================================================================
// YOUTUBE COLLECTOR
// =============================================================================

class YouTubeCollector {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  private async request<T>(endpoint: string, params: URLSearchParams): Promise<T> {
    await youtubeRateLimiter.acquire();

    params.set("key", this.apiKey);
    const url = `https://www.googleapis.com/youtube/v3${endpoint}?${params.toString()}`;

    const response = await withRetry(async () => {
      const res = await fetch(url);

      if (!res.ok) {
        if (res.status === 429) {
          throw new Error("Rate limited");
        }
        throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      }

      return res.json();
    });

    return response;
  }

  async searchVideos(query: string, maxResults: number = 25): Promise<YouTubeVideo[]> {
    const params = new URLSearchParams({
      part: "snippet",
      q: query,
      type: "video",
      maxResults: maxResults.toString(),
      order: "date",
      publishedAfter: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(), // Last 7 days
    });

    const response = await this.request<YouTubeSearchResponse>("/search", params);
    return response.items || [];
  }

  async getVideoStats(videoIds: string[]): Promise<Map<string, YouTubeVideoStats>> {
    if (videoIds.length === 0) return new Map();

    const params = new URLSearchParams({
      part: "statistics",
      id: videoIds.join(","),
    });

    const response = await this.request<{ items: YouTubeVideoStats[] }>("/videos", params);

    return new Map((response.items || []).map((item) => [item.id, item]));
  }

  async collectSignals(collectedAt: string): Promise<SignalEvent[]> {
    const signals: SignalEvent[] = [];

    for (const keyword of SEARCH_KEYWORDS.slice(0, 3)) {
      // Limit to avoid quota
      try {
        const videos = await this.searchVideos(keyword, 20);

        // Get stats for all videos
        const videoIds = videos.map((v) => v.id.videoId);
        const stats = await this.getVideoStats(videoIds);

        for (const video of videos) {
          const fullText = `${video.snippet.title} ${video.snippet.description}`;
          const sentiment = analyzeSentiment(fullText);
          const cardMentions = extractCardMentions(fullText);

          const videoStats = stats.get(video.id.videoId);
          const views = parseInt(videoStats?.statistics.viewCount || "0");
          const likes = parseInt(videoStats?.statistics.likeCount || "0");
          const comments = parseInt(videoStats?.statistics.commentCount || "0");

          // Calculate engagement based on views, likes, comments
          const engagement = views * 0.01 + likes * 2 + comments * 5;

          // Detect video type from title
          let signalType: SignalEvent["signalType"] = "social_mention";
          const titleLower = video.snippet.title.toLowerCase();
          if (
            titleLower.includes("deck") ||
            titleLower.includes("profile") ||
            titleLower.includes("build")
          ) {
            signalType = "meta_shift";
          } else if (
            titleLower.includes("opening") ||
            titleLower.includes("unbox") ||
            titleLower.includes("pack")
          ) {
            signalType = "release_announce";
          }

          signals.push({
            eventType: "signal",
            source: "youtube",
            signalId: `yt-${video.id.videoId}`,
            signalType,
            cardIds: cardMentions,
            content: sanitizeString(video.snippet.title.substring(0, 200)),
            sentiment: sentiment.score,
            sentimentKeywords: sentiment.keywords,
            engagement,
            authorId: video.snippet.channelId,
            url: `https://www.youtube.com/watch?v=${video.id.videoId}`,
            metadata: {
              channelTitle: video.snippet.channelTitle,
              views,
              likes,
              comments,
              thumbnail: video.snippet.thumbnails.default.url,
            },
            timestamp: video.snippet.publishedAt,
            collectedAt,
          });
        }
      } catch (error) {
        console.warn(`YouTube search failed for "${keyword}":`, error);
      }
    }

    return signals;
  }
}

// =============================================================================
// MAIN HANDLER
// =============================================================================

export const handler: Handler<ScheduledEvent> = async (event) => {
  console.log("Social collector started", { event });
  const collectedAt = nowIso();

  try {
    // Get API credentials
    const secrets = await getSecrets();

    const allSignals: SignalEvent[] = [];

    // Collect from Twitter
    if (secrets.twitter_bearer_token) {
      console.log("Collecting from Twitter...");
      const twitterCollector = new TwitterCollector(secrets.twitter_bearer_token);
      const twitterSignals = await twitterCollector.collectSignals(collectedAt);
      console.log(`  Collected ${twitterSignals.length} Twitter signals`);
      allSignals.push(...twitterSignals);
    } else {
      console.warn("Twitter credentials not configured, skipping");
    }

    // Collect from Reddit
    console.log("Collecting from Reddit...");
    const redditCollector = new RedditCollector();
    try {
      const redditSignals = await redditCollector.collectSignals(collectedAt);
      console.log(`  Collected ${redditSignals.length} Reddit signals`);
      allSignals.push(...redditSignals);
    } catch (error) {
      console.warn("Reddit collection failed:", error);
    }

    // Collect from YouTube
    if (secrets.youtube_api_key) {
      console.log("Collecting from YouTube...");
      const youtubeCollector = new YouTubeCollector(secrets.youtube_api_key);
      const youtubeSignals = await youtubeCollector.collectSignals(collectedAt);
      console.log(`  Collected ${youtubeSignals.length} YouTube signals`);
      allSignals.push(...youtubeSignals);
    } else {
      console.warn("YouTube credentials not configured, skipping");
    }

    console.log(`Total signals collected: ${allSignals.length}`);

    // Send to Kinesis
    if (allSignals.length > 0) {
      await putToKinesis(SIGNAL_STREAM, allSignals);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        totalSignals: allSignals.length,
        bySource: {
          twitter: allSignals.filter((s) => s.source === "twitter").length,
          reddit: allSignals.filter((s) => s.source === "reddit").length,
          youtube: allSignals.filter((s) => s.source === "youtube").length,
        },
        collectedAt,
      }),
    };
  } catch (error) {
    console.error("Social collector error:", error);
    throw error;
  }
};
