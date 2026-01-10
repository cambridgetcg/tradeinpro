"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
const utils_1 = require("/opt/nodejs/utils");
// =============================================================================
// CONFIGURATION
// =============================================================================
const SIGNAL_STREAM = process.env.SIGNAL_STREAM_NAME;
// Rate limiters for each platform
const twitterRateLimiter = new utils_1.RateLimiter(15, 60); // 15 requests per 15 min window
const redditRateLimiter = new utils_1.RateLimiter(1, 2); // 30 requests per minute
const youtubeRateLimiter = new utils_1.RateLimiter(100, 60); // 100 requests per minute
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
function analyzeSentiment(text) {
    const lowerText = text.toLowerCase();
    const foundKeywords = [];
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
function extractCardMentions(text) {
    const mentions = [];
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
    constructor(bearerToken) {
        this.bearerToken = bearerToken;
    }
    async request(endpoint) {
        await twitterRateLimiter.acquire();
        const url = `https://api.twitter.com/2${endpoint}`;
        const response = await (0, utils_1.withRetry)(async () => {
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
    async searchRecent(query, maxResults = 100) {
        const params = new URLSearchParams({
            query: `${query} -is:retweet lang:en`,
            max_results: Math.min(maxResults, 100).toString(),
            "tweet.fields": "created_at,public_metrics,entities",
        });
        const response = await this.request(`/tweets/search/recent?${params.toString()}`);
        return response.data || [];
    }
    async collectSignals(collectedAt) {
        const signals = [];
        for (const keyword of SEARCH_KEYWORDS) {
            try {
                const tweets = await this.searchRecent(keyword, 50);
                for (const tweet of tweets) {
                    const sentiment = analyzeSentiment(tweet.text);
                    const cardMentions = extractCardMentions(tweet.text);
                    // Calculate engagement score
                    const engagement = tweet.public_metrics.like_count * 1 +
                        tweet.public_metrics.retweet_count * 2 +
                        tweet.public_metrics.reply_count * 1.5 +
                        tweet.public_metrics.quote_count * 2.5;
                    signals.push({
                        eventType: "signal",
                        source: "twitter",
                        signalId: `tw-${tweet.id}`,
                        signalType: "social_mention",
                        cardIds: cardMentions,
                        content: (0, utils_1.sanitizeString)(tweet.text.substring(0, 500)),
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
            }
            catch (error) {
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
    constructor(userAgent = "OPTCG-DataCollector/1.0") {
        this.userAgent = userAgent;
    }
    async request(endpoint) {
        await redditRateLimiter.acquire();
        const url = `https://oauth.reddit.com${endpoint}`;
        const response = await (0, utils_1.withRetry)(async () => {
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
    async getSubredditPosts(subreddit, sort = "hot", limit = 25) {
        const response = await this.request(`/r/${subreddit}/${sort}.json?limit=${limit}`);
        return response.data.children.map((child) => child.data);
    }
    async searchSubreddit(subreddit, query) {
        const response = await this.request(`/r/${subreddit}/search.json?q=${encodeURIComponent(query)}&restrict_sr=1&limit=25`);
        return response.data.children.map((child) => child.data);
    }
    async collectSignals(collectedAt) {
        const signals = [];
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
                        content: (0, utils_1.sanitizeString)(`${post.title}\n${post.selftext}`.substring(0, 1000)),
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
            }
            catch (error) {
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
    constructor(apiKey) {
        this.apiKey = apiKey;
    }
    async request(endpoint, params) {
        await youtubeRateLimiter.acquire();
        params.set("key", this.apiKey);
        const url = `https://www.googleapis.com/youtube/v3${endpoint}?${params.toString()}`;
        const response = await (0, utils_1.withRetry)(async () => {
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
    async searchVideos(query, maxResults = 25) {
        const params = new URLSearchParams({
            part: "snippet",
            q: query,
            type: "video",
            maxResults: maxResults.toString(),
            order: "date",
            publishedAfter: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(), // Last 7 days
        });
        const response = await this.request("/search", params);
        return response.items || [];
    }
    async getVideoStats(videoIds) {
        if (videoIds.length === 0)
            return new Map();
        const params = new URLSearchParams({
            part: "statistics",
            id: videoIds.join(","),
        });
        const response = await this.request("/videos", params);
        return new Map((response.items || []).map((item) => [item.id, item]));
    }
    async collectSignals(collectedAt) {
        const signals = [];
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
                    let signalType = "social_mention";
                    const titleLower = video.snippet.title.toLowerCase();
                    if (titleLower.includes("deck") ||
                        titleLower.includes("profile") ||
                        titleLower.includes("build")) {
                        signalType = "meta_shift";
                    }
                    else if (titleLower.includes("opening") ||
                        titleLower.includes("unbox") ||
                        titleLower.includes("pack")) {
                        signalType = "release_announce";
                    }
                    signals.push({
                        eventType: "signal",
                        source: "youtube",
                        signalId: `yt-${video.id.videoId}`,
                        signalType,
                        cardIds: cardMentions,
                        content: (0, utils_1.sanitizeString)(video.snippet.title.substring(0, 200)),
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
            }
            catch (error) {
                console.warn(`YouTube search failed for "${keyword}":`, error);
            }
        }
        return signals;
    }
}
// =============================================================================
// MAIN HANDLER
// =============================================================================
const handler = async (event) => {
    console.log("Social collector started", { event });
    const collectedAt = (0, utils_1.nowIso)();
    try {
        // Get API credentials
        const secrets = await (0, utils_1.getSecrets)();
        const allSignals = [];
        // Collect from Twitter
        if (secrets.twitter_bearer_token) {
            console.log("Collecting from Twitter...");
            const twitterCollector = new TwitterCollector(secrets.twitter_bearer_token);
            const twitterSignals = await twitterCollector.collectSignals(collectedAt);
            console.log(`  Collected ${twitterSignals.length} Twitter signals`);
            allSignals.push(...twitterSignals);
        }
        else {
            console.warn("Twitter credentials not configured, skipping");
        }
        // Collect from Reddit
        console.log("Collecting from Reddit...");
        const redditCollector = new RedditCollector();
        try {
            const redditSignals = await redditCollector.collectSignals(collectedAt);
            console.log(`  Collected ${redditSignals.length} Reddit signals`);
            allSignals.push(...redditSignals);
        }
        catch (error) {
            console.warn("Reddit collection failed:", error);
        }
        // Collect from YouTube
        if (secrets.youtube_api_key) {
            console.log("Collecting from YouTube...");
            const youtubeCollector = new YouTubeCollector(secrets.youtube_api_key);
            const youtubeSignals = await youtubeCollector.collectSignals(collectedAt);
            console.log(`  Collected ${youtubeSignals.length} YouTube signals`);
            allSignals.push(...youtubeSignals);
        }
        else {
            console.warn("YouTube credentials not configured, skipping");
        }
        console.log(`Total signals collected: ${allSignals.length}`);
        // Send to Kinesis
        if (allSignals.length > 0) {
            await (0, utils_1.putToKinesis)(SIGNAL_STREAM, allSignals);
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
    }
    catch (error) {
        console.error("Social collector error:", error);
        throw error;
    }
};
exports.handler = handler;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic29jaWFsLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vbGFtYmRhL2NvbGxlY3RvcnMvc29jaWFsL3NvY2lhbC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiO0FBQUE7Ozs7Ozs7Ozs7R0FVRzs7O0FBR0gsNkNBUTJCO0FBRTNCLGdGQUFnRjtBQUNoRixnQkFBZ0I7QUFDaEIsZ0ZBQWdGO0FBRWhGLE1BQU0sYUFBYSxHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUMsa0JBQW1CLENBQUM7QUFFdEQsa0NBQWtDO0FBQ2xDLE1BQU0sa0JBQWtCLEdBQUcsSUFBSSxtQkFBVyxDQUFDLEVBQUUsRUFBRSxFQUFFLENBQUMsQ0FBQyxDQUFDLGdDQUFnQztBQUNwRixNQUFNLGlCQUFpQixHQUFHLElBQUksbUJBQVcsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQyx5QkFBeUI7QUFDMUUsTUFBTSxrQkFBa0IsR0FBRyxJQUFJLG1CQUFXLENBQUMsR0FBRyxFQUFFLEVBQUUsQ0FBQyxDQUFDLENBQUMsMEJBQTBCO0FBRS9FLGtCQUFrQjtBQUNsQixNQUFNLGVBQWUsR0FBRztJQUN0QixxQkFBcUI7SUFDckIsZUFBZTtJQUNmLE9BQU87SUFDUCxjQUFjO0lBQ2QsUUFBUTtDQUNULENBQUM7QUFFRixNQUFNLGFBQWEsR0FBRztJQUNwQixNQUFNO0lBQ04sTUFBTTtJQUNOLE1BQU07SUFDTixNQUFNO0lBQ04sTUFBTTtJQUNOLE1BQU07SUFDTixNQUFNO0lBQ04sTUFBTTtJQUNOLE1BQU07SUFDTixNQUFNO0lBQ04sTUFBTTtJQUNOLE1BQU07SUFDTixNQUFNO0NBQ1AsQ0FBQztBQUVGLE1BQU0sVUFBVSxHQUFHLENBQUMsYUFBYSxFQUFFLGtCQUFrQixFQUFFLGVBQWUsQ0FBQyxDQUFDO0FBcUZ4RSxnRkFBZ0Y7QUFDaEYscUJBQXFCO0FBQ3JCLGdGQUFnRjtBQUVoRiw4REFBOEQ7QUFDOUQsTUFBTSxpQkFBaUIsR0FBRztJQUN4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Q0FBQyxDQUFDLENBQUMsRUFBRSxFQUFFLENBQUMsQ0FBQyxDQUFDLE1BQU0sS0FBSyxRQUFRLENBQUMsQ0FBQyxNQUFNO29CQUM5RCxPQUFPLEVBQUUsVUFBVSxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsRUFBRSxFQUFFLENBQUMsQ0FBQyxDQUFDLE1BQU0sS0FBSyxTQUFTLENBQUMsQ0FBQyxNQUFNO2lCQUNqRTtnQkFDRCxXQUFXO2FBQ1osQ0FBQztTQUNILENBQUM7SUFDSixDQUFDO0lBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztRQUNmLE9BQU8sQ0FBQyxLQUFLLENBQUMseUJBQXlCLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFDaEQsTUFBTSxLQUFLLENBQUM7SUFDZCxDQUFDO0FBQ0gsQ0FBQyxDQUFDO0FBbEVXLFFBQUEsT0FBTyxXQWtFbEIiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIFNvY2lhbCBTaWduYWwgQ29sbGVjdG9yIExhbWJkYVxuICpcbiAqIENvbGxlY3RzIHNvY2lhbCBzaWduYWxzIGZyb20gVHdpdHRlci9YLCBSZWRkaXQsIGFuZCBZb3VUdWJlIHRvXG4gKiBkZXRlY3Qgc2VudGltZW50IGFuZCB0cmVuZGluZyBjYXJkcyBmb3IgZGVtYW5kIHByZWRpY3Rpb24uXG4gKlxuICogU291cmNlczpcbiAqIC0gVHdpdHRlci9YOiBDYXJkIG1lbnRpb25zLCBoYXNodGFncywgc2VudGltZW50XG4gKiAtIFJlZGRpdDogci9PbmVQaWVjZVRDRywgci9UcmFkaW5nQ2FyZEdhbWVzIGRpc2N1c3Npb25zXG4gKiAtIFlvdVR1YmU6IERlY2sgcHJvZmlsZXMsIHVuYm94aW5ncywgbWV0YSBkaXNjdXNzaW9uc1xuICovXG5cbmltcG9ydCB7IEhhbmRsZXIsIFNjaGVkdWxlZEV2ZW50IH0gZnJvbSBcImF3cy1sYW1iZGFcIjtcbmltcG9ydCB7XG4gIGdldFNlY3JldHMsXG4gIHB1dFRvS2luZXNpcyxcbiAgUmF0ZUxpbWl0ZXIsXG4gIHdpdGhSZXRyeSxcbiAgbm93SXNvLFxuICBzYW5pdGl6ZVN0cmluZyxcbiAgU2lnbmFsRXZlbnQsXG59IGZyb20gXCIvb3B0L25vZGVqcy91dGlsc1wiO1xuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gQ09ORklHVVJBVElPTlxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuY29uc3QgU0lHTkFMX1NUUkVBTSA9IHByb2Nlc3MuZW52LlNJR05BTF9TVFJFQU1fTkFNRSE7XG5cbi8vIFJhdGUgbGltaXRlcnMgZm9yIGVhY2ggcGxhdGZvcm1cbmNvbnN0IHR3aXR0ZXJSYXRlTGltaXRlciA9IG5ldyBSYXRlTGltaXRlcigxNSwgNjApOyAvLyAxNSByZXF1ZXN0cyBwZXIgMTUgbWluIHdpbmRvd1xuY29uc3QgcmVkZGl0UmF0ZUxpbWl0ZXIgPSBuZXcgUmF0ZUxpbWl0ZXIoMSwgMik7IC8vIDMwIHJlcXVlc3RzIHBlciBtaW51dGVcbmNvbnN0IHlvdXR1YmVSYXRlTGltaXRlciA9IG5ldyBSYXRlTGltaXRlcigxMDAsIDYwKTsgLy8gMTAwIHJlcXVlc3RzIHBlciBtaW51dGVcblxuLy8gU2VhcmNoIGtleXdvcmRzXG5jb25zdCBTRUFSQ0hfS0VZV09SRFMgPSBbXG4gIFwib25lIHBpZWNlIGNhcmQgZ2FtZVwiLFxuICBcIm9uZSBwaWVjZSB0Y2dcIixcbiAgXCJvcHRjZ1wiLFxuICBcIiNPbmVQaWVjZVRDR1wiLFxuICBcIiNPUFRDR1wiLFxuXTtcblxuY29uc3QgQ0FSRF9LRVlXT1JEUyA9IFtcbiAgXCJPUDAxXCIsXG4gIFwiT1AwMlwiLFxuICBcIk9QMDNcIixcbiAgXCJPUDA0XCIsXG4gIFwiT1AwNVwiLFxuICBcIk9QMDZcIixcbiAgXCJPUDA3XCIsXG4gIFwiT1AwOFwiLFxuICBcIk9QMDlcIixcbiAgXCJPUDEwXCIsXG4gIFwiT1AxMVwiLFxuICBcIkVCMDFcIixcbiAgXCJFQjAyXCIsXG5dO1xuXG5jb25zdCBTVUJSRURESVRTID0gW1wiT25lUGllY2VUQ0dcIiwgXCJUcmFkaW5nQ2FyZEdhbWVzXCIsIFwiVENHQ29sbGVjdGluZ1wiXTtcblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIFRZUEVTXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG5pbnRlcmZhY2UgVHdpdHRlclR3ZWV0IHtcbiAgaWQ6IHN0cmluZztcbiAgdGV4dDogc3RyaW5nO1xuICBhdXRob3JfaWQ6IHN0cmluZztcbiAgY3JlYXRlZF9hdDogc3RyaW5nO1xuICBwdWJsaWNfbWV0cmljczoge1xuICAgIHJldHdlZXRfY291bnQ6IG51bWJlcjtcbiAgICByZXBseV9jb3VudDogbnVtYmVyO1xuICAgIGxpa2VfY291bnQ6IG51bWJlcjtcbiAgICBxdW90ZV9jb3VudDogbnVtYmVyO1xuICB9O1xuICBlbnRpdGllcz86IHtcbiAgICBoYXNodGFncz86IEFycmF5PHsgdGFnOiBzdHJpbmcgfT47XG4gICAgbWVudGlvbnM/OiBBcnJheTx7IHVzZXJuYW1lOiBzdHJpbmcgfT47XG4gICAgdXJscz86IEFycmF5PHsgZXhwYW5kZWRfdXJsOiBzdHJpbmcgfT47XG4gIH07XG59XG5cbmludGVyZmFjZSBUd2l0dGVyU2VhcmNoUmVzcG9uc2Uge1xuICBkYXRhPzogVHdpdHRlclR3ZWV0W107XG4gIG1ldGE/OiB7XG4gICAgcmVzdWx0X2NvdW50OiBudW1iZXI7XG4gICAgbmV4dF90b2tlbj86IHN0cmluZztcbiAgfTtcbn1cblxuaW50ZXJmYWNlIFJlZGRpdFBvc3Qge1xuICBpZDogc3RyaW5nO1xuICB0aXRsZTogc3RyaW5nO1xuICBzZWxmdGV4dDogc3RyaW5nO1xuICBhdXRob3I6IHN0cmluZztcbiAgc3VicmVkZGl0OiBzdHJpbmc7XG4gIHNjb3JlOiBudW1iZXI7XG4gIHVwdm90ZV9yYXRpbzogbnVtYmVyO1xuICBudW1fY29tbWVudHM6IG51bWJlcjtcbiAgY3JlYXRlZF91dGM6IG51bWJlcjtcbiAgdXJsOiBzdHJpbmc7XG4gIGlzX3ZpZGVvOiBib29sZWFuO1xuICBsaW5rX2ZsYWlyX3RleHQ/OiBzdHJpbmc7XG59XG5cbmludGVyZmFjZSBSZWRkaXRMaXN0aW5nUmVzcG9uc2Uge1xuICBkYXRhOiB7XG4gICAgY2hpbGRyZW46IEFycmF5PHsgZGF0YTogUmVkZGl0UG9zdCB9PjtcbiAgICBhZnRlcj86IHN0cmluZztcbiAgfTtcbn1cblxuaW50ZXJmYWNlIFlvdVR1YmVWaWRlbyB7XG4gIGlkOiB7IHZpZGVvSWQ6IHN0cmluZyB9O1xuICBzbmlwcGV0OiB7XG4gICAgcHVibGlzaGVkQXQ6IHN0cmluZztcbiAgICBjaGFubmVsSWQ6IHN0cmluZztcbiAgICBjaGFubmVsVGl0bGU6IHN0cmluZztcbiAgICB0aXRsZTogc3RyaW5nO1xuICAgIGRlc2NyaXB0aW9uOiBzdHJpbmc7XG4gICAgdGh1bWJuYWlsczoge1xuICAgICAgZGVmYXVsdDogeyB1cmw6IHN0cmluZyB9O1xuICAgIH07XG4gIH07XG59XG5cbmludGVyZmFjZSBZb3VUdWJlU2VhcmNoUmVzcG9uc2Uge1xuICBpdGVtcz86IFlvdVR1YmVWaWRlb1tdO1xuICBwYWdlSW5mbz86IHtcbiAgICB0b3RhbFJlc3VsdHM6IG51bWJlcjtcbiAgfTtcbiAgbmV4dFBhZ2VUb2tlbj86IHN0cmluZztcbn1cblxuaW50ZXJmYWNlIFlvdVR1YmVWaWRlb1N0YXRzIHtcbiAgaWQ6IHN0cmluZztcbiAgc3RhdGlzdGljczoge1xuICAgIHZpZXdDb3VudDogc3RyaW5nO1xuICAgIGxpa2VDb3VudD86IHN0cmluZztcbiAgICBjb21tZW50Q291bnQ/OiBzdHJpbmc7XG4gIH07XG59XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBTRU5USU1FTlQgQU5BTFlTSVNcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbi8vIFNpbXBsZSBrZXl3b3JkLWJhc2VkIHNlbnRpbWVudCAod291bGQgdXNlIE1MIGluIHByb2R1Y3Rpb24pXG5jb25zdCBQT1NJVElWRV9LRVlXT1JEUyA9IFtcbiAgXCJhbWF6aW5nXCIsXG4gIFwibG92ZVwiLFxuICBcImdyZWF0XCIsXG4gIFwiYmVzdFwiLFxuICBcImF3ZXNvbWVcIixcbiAgXCJiZWF1dGlmdWxcIixcbiAgXCJ3YW50XCIsXG4gIFwibmVlZFwiLFxuICBcImZpcmVcIixcbiAgXCJzaWNrXCIsXG4gIFwiaW5zYW5lXCIsXG4gIFwiZ29yZ2VvdXNcIixcbiAgXCJzdHVubmluZ1wiLFxuICBcImludmVzdFwiLFxuICBcInVuZGVycmF0ZWRcIixcbiAgXCJzdGFwbGVcIixcbiAgXCJtZXRhXCIsXG4gIFwidGllciAxXCIsXG4gIFwibXVzdCBoYXZlXCIsXG4gIFwiZ3JhaWxcIixcbl07XG5cbmNvbnN0IE5FR0FUSVZFX0tFWVdPUkRTID0gW1xuICBcImhhdGVcIixcbiAgXCJiYWRcIixcbiAgXCJ3b3JzdFwiLFxuICBcInRlcnJpYmxlXCIsXG4gIFwiYXdmdWxcIixcbiAgXCJ1Z2x5XCIsXG4gIFwib3ZlcnJhdGVkXCIsXG4gIFwib3ZlcnByaWNlZFwiLFxuICBcImV4cGVuc2l2ZVwiLFxuICBcInNjYW1cIixcbiAgXCJmYWtlXCIsXG4gIFwiZGlzYXBwb2ludGVkXCIsXG4gIFwidHJhc2hcIixcbiAgXCJnYXJiYWdlXCIsXG4gIFwiZGVhZFwiLFxuICBcImNyYXNoZWRcIixcbiAgXCJ0YW5rZWRcIixcbiAgXCJhdm9pZFwiLFxuXTtcblxuZnVuY3Rpb24gYW5hbHl6ZVNlbnRpbWVudCh0ZXh0OiBzdHJpbmcpOiB7IHNjb3JlOiBudW1iZXI7IGtleXdvcmRzOiBzdHJpbmdbXSB9IHtcbiAgY29uc3QgbG93ZXJUZXh0ID0gdGV4dC50b0xvd2VyQ2FzZSgpO1xuICBjb25zdCBmb3VuZEtleXdvcmRzOiBzdHJpbmdbXSA9IFtdO1xuICBsZXQgc2NvcmUgPSAwO1xuXG4gIGZvciAoY29uc3Qga2V5d29yZCBvZiBQT1NJVElWRV9LRVlXT1JEUykge1xuICAgIGlmIChsb3dlclRleHQuaW5jbHVkZXMoa2V5d29yZCkpIHtcbiAgICAgIHNjb3JlICs9IDE7XG4gICAgICBmb3VuZEtleXdvcmRzLnB1c2goYCske2tleXdvcmR9YCk7XG4gICAgfVxuICB9XG5cbiAgZm9yIChjb25zdCBrZXl3b3JkIG9mIE5FR0FUSVZFX0tFWVdPUkRTKSB7XG4gICAgaWYgKGxvd2VyVGV4dC5pbmNsdWRlcyhrZXl3b3JkKSkge1xuICAgICAgc2NvcmUgLT0gMTtcbiAgICAgIGZvdW5kS2V5d29yZHMucHVzaChgLSR7a2V5d29yZH1gKTtcbiAgICB9XG4gIH1cblxuICAvLyBOb3JtYWxpemUgdG8gLTEgdG8gMSByYW5nZVxuICBjb25zdCBub3JtYWxpemVkU2NvcmUgPSBNYXRoLm1heCgtMSwgTWF0aC5taW4oMSwgc2NvcmUgLyAzKSk7XG5cbiAgcmV0dXJuIHsgc2NvcmU6IG5vcm1hbGl6ZWRTY29yZSwga2V5d29yZHM6IGZvdW5kS2V5d29yZHMgfTtcbn1cblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIENBUkQgRVhUUkFDVElPTlxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuZnVuY3Rpb24gZXh0cmFjdENhcmRNZW50aW9ucyh0ZXh0OiBzdHJpbmcpOiBzdHJpbmdbXSB7XG4gIGNvbnN0IG1lbnRpb25zOiBzdHJpbmdbXSA9IFtdO1xuICBjb25zdCBjbGVhblRleHQgPSB0ZXh0LnRvVXBwZXJDYXNlKCk7XG5cbiAgLy8gTWF0Y2ggY2FyZCBJRHMgbGlrZSBPUDAxLTAwMSwgRUIwMi0xMjMsIGV0Yy5cbiAgY29uc3QgY2FyZElkUGF0dGVybiA9IC8oW0EtWl17MiwzfVxcZHsyfSktKFxcZHszfSkvZztcbiAgbGV0IG1hdGNoO1xuXG4gIHdoaWxlICgobWF0Y2ggPSBjYXJkSWRQYXR0ZXJuLmV4ZWMoY2xlYW5UZXh0KSkgIT09IG51bGwpIHtcbiAgICBtZW50aW9ucy5wdXNoKGAke21hdGNoWzFdfS0ke21hdGNoWzJdfWApO1xuICB9XG5cbiAgLy8gTWF0Y2ggc2V0IGNvZGVzIG1lbnRpb25lZFxuICBmb3IgKGNvbnN0IHNldENvZGUgb2YgQ0FSRF9LRVlXT1JEUykge1xuICAgIGlmIChjbGVhblRleHQuaW5jbHVkZXMoc2V0Q29kZSkpIHtcbiAgICAgIGlmICghbWVudGlvbnMuc29tZSgobSkgPT4gbS5zdGFydHNXaXRoKHNldENvZGUpKSkge1xuICAgICAgICBtZW50aW9ucy5wdXNoKHNldENvZGUpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiBbLi4ubmV3IFNldChtZW50aW9ucyldO1xufVxuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gVFdJVFRFUi9YIENPTExFQ1RPUlxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuY2xhc3MgVHdpdHRlckNvbGxlY3RvciB7XG4gIHByaXZhdGUgYmVhcmVyVG9rZW46IHN0cmluZztcblxuICBjb25zdHJ1Y3RvcihiZWFyZXJUb2tlbjogc3RyaW5nKSB7XG4gICAgdGhpcy5iZWFyZXJUb2tlbiA9IGJlYXJlclRva2VuO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyByZXF1ZXN0PFQ+KGVuZHBvaW50OiBzdHJpbmcpOiBQcm9taXNlPFQ+IHtcbiAgICBhd2FpdCB0d2l0dGVyUmF0ZUxpbWl0ZXIuYWNxdWlyZSgpO1xuXG4gICAgY29uc3QgdXJsID0gYGh0dHBzOi8vYXBpLnR3aXR0ZXIuY29tLzIke2VuZHBvaW50fWA7XG5cbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHdpdGhSZXRyeShhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCByZXMgPSBhd2FpdCBmZXRjaCh1cmwsIHtcbiAgICAgICAgaGVhZGVyczoge1xuICAgICAgICAgIEF1dGhvcml6YXRpb246IGBCZWFyZXIgJHt0aGlzLmJlYXJlclRva2VufWAsXG4gICAgICAgIH0sXG4gICAgICB9KTtcblxuICAgICAgaWYgKCFyZXMub2spIHtcbiAgICAgICAgaWYgKHJlcy5zdGF0dXMgPT09IDQyOSkge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcIlJhdGUgbGltaXRlZFwiKTtcbiAgICAgICAgfVxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEhUVFAgJHtyZXMuc3RhdHVzfTogJHthd2FpdCByZXMudGV4dCgpfWApO1xuICAgICAgfVxuXG4gICAgICByZXR1cm4gcmVzLmpzb24oKTtcbiAgICB9KTtcblxuICAgIHJldHVybiByZXNwb25zZTtcbiAgfVxuXG4gIGFzeW5jIHNlYXJjaFJlY2VudChxdWVyeTogc3RyaW5nLCBtYXhSZXN1bHRzOiBudW1iZXIgPSAxMDApOiBQcm9taXNlPFR3aXR0ZXJUd2VldFtdPiB7XG4gICAgY29uc3QgcGFyYW1zID0gbmV3IFVSTFNlYXJjaFBhcmFtcyh7XG4gICAgICBxdWVyeTogYCR7cXVlcnl9IC1pczpyZXR3ZWV0IGxhbmc6ZW5gLFxuICAgICAgbWF4X3Jlc3VsdHM6IE1hdGgubWluKG1heFJlc3VsdHMsIDEwMCkudG9TdHJpbmcoKSxcbiAgICAgIFwidHdlZXQuZmllbGRzXCI6IFwiY3JlYXRlZF9hdCxwdWJsaWNfbWV0cmljcyxlbnRpdGllc1wiLFxuICAgIH0pO1xuXG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCB0aGlzLnJlcXVlc3Q8VHdpdHRlclNlYXJjaFJlc3BvbnNlPihcbiAgICAgIGAvdHdlZXRzL3NlYXJjaC9yZWNlbnQ/JHtwYXJhbXMudG9TdHJpbmcoKX1gXG4gICAgKTtcblxuICAgIHJldHVybiByZXNwb25zZS5kYXRhIHx8IFtdO1xuICB9XG5cbiAgYXN5bmMgY29sbGVjdFNpZ25hbHMoY29sbGVjdGVkQXQ6IHN0cmluZyk6IFByb21pc2U8U2lnbmFsRXZlbnRbXT4ge1xuICAgIGNvbnN0IHNpZ25hbHM6IFNpZ25hbEV2ZW50W10gPSBbXTtcblxuICAgIGZvciAoY29uc3Qga2V5d29yZCBvZiBTRUFSQ0hfS0VZV09SRFMpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHR3ZWV0cyA9IGF3YWl0IHRoaXMuc2VhcmNoUmVjZW50KGtleXdvcmQsIDUwKTtcblxuICAgICAgICBmb3IgKGNvbnN0IHR3ZWV0IG9mIHR3ZWV0cykge1xuICAgICAgICAgIGNvbnN0IHNlbnRpbWVudCA9IGFuYWx5emVTZW50aW1lbnQodHdlZXQudGV4dCk7XG4gICAgICAgICAgY29uc3QgY2FyZE1lbnRpb25zID0gZXh0cmFjdENhcmRNZW50aW9ucyh0d2VldC50ZXh0KTtcblxuICAgICAgICAgIC8vIENhbGN1bGF0ZSBlbmdhZ2VtZW50IHNjb3JlXG4gICAgICAgICAgY29uc3QgZW5nYWdlbWVudCA9XG4gICAgICAgICAgICB0d2VldC5wdWJsaWNfbWV0cmljcy5saWtlX2NvdW50ICogMSArXG4gICAgICAgICAgICB0d2VldC5wdWJsaWNfbWV0cmljcy5yZXR3ZWV0X2NvdW50ICogMiArXG4gICAgICAgICAgICB0d2VldC5wdWJsaWNfbWV0cmljcy5yZXBseV9jb3VudCAqIDEuNSArXG4gICAgICAgICAgICB0d2VldC5wdWJsaWNfbWV0cmljcy5xdW90ZV9jb3VudCAqIDIuNTtcblxuICAgICAgICAgIHNpZ25hbHMucHVzaCh7XG4gICAgICAgICAgICBldmVudFR5cGU6IFwic2lnbmFsXCIsXG4gICAgICAgICAgICBzb3VyY2U6IFwidHdpdHRlclwiLFxuICAgICAgICAgICAgc2lnbmFsSWQ6IGB0dy0ke3R3ZWV0LmlkfWAsXG4gICAgICAgICAgICBzaWduYWxUeXBlOiBcInNvY2lhbF9tZW50aW9uXCIsXG4gICAgICAgICAgICBjYXJkSWRzOiBjYXJkTWVudGlvbnMsXG4gICAgICAgICAgICBjb250ZW50OiBzYW5pdGl6ZVN0cmluZyh0d2VldC50ZXh0LnN1YnN0cmluZygwLCA1MDApKSxcbiAgICAgICAgICAgIHNlbnRpbWVudDogc2VudGltZW50LnNjb3JlLFxuICAgICAgICAgICAgc2VudGltZW50S2V5d29yZHM6IHNlbnRpbWVudC5rZXl3b3JkcyxcbiAgICAgICAgICAgIGVuZ2FnZW1lbnQsXG4gICAgICAgICAgICBhdXRob3JJZDogdHdlZXQuYXV0aG9yX2lkLFxuICAgICAgICAgICAgdXJsOiBgaHR0cHM6Ly90d2l0dGVyLmNvbS9pL3dlYi9zdGF0dXMvJHt0d2VldC5pZH1gLFxuICAgICAgICAgICAgbWV0YWRhdGE6IHtcbiAgICAgICAgICAgICAgbGlrZXM6IHR3ZWV0LnB1YmxpY19tZXRyaWNzLmxpa2VfY291bnQsXG4gICAgICAgICAgICAgIHJldHdlZXRzOiB0d2VldC5wdWJsaWNfbWV0cmljcy5yZXR3ZWV0X2NvdW50LFxuICAgICAgICAgICAgICByZXBsaWVzOiB0d2VldC5wdWJsaWNfbWV0cmljcy5yZXBseV9jb3VudCxcbiAgICAgICAgICAgICAgaGFzaHRhZ3M6IHR3ZWV0LmVudGl0aWVzPy5oYXNodGFncz8ubWFwKChoKSA9PiBoLnRhZykgfHwgW10sXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgdGltZXN0YW1wOiB0d2VldC5jcmVhdGVkX2F0LFxuICAgICAgICAgICAgY29sbGVjdGVkQXQsXG4gICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGNvbnNvbGUud2FybihgVHdpdHRlciBzZWFyY2ggZmFpbGVkIGZvciBcIiR7a2V5d29yZH1cIjpgLCBlcnJvcik7XG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHNpZ25hbHM7XG4gIH1cbn1cblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIFJFRERJVCBDT0xMRUNUT1Jcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbmNsYXNzIFJlZGRpdENvbGxlY3RvciB7XG4gIHByaXZhdGUgdXNlckFnZW50OiBzdHJpbmc7XG5cbiAgY29uc3RydWN0b3IodXNlckFnZW50OiBzdHJpbmcgPSBcIk9QVENHLURhdGFDb2xsZWN0b3IvMS4wXCIpIHtcbiAgICB0aGlzLnVzZXJBZ2VudCA9IHVzZXJBZ2VudDtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcmVxdWVzdDxUPihlbmRwb2ludDogc3RyaW5nKTogUHJvbWlzZTxUPiB7XG4gICAgYXdhaXQgcmVkZGl0UmF0ZUxpbWl0ZXIuYWNxdWlyZSgpO1xuXG4gICAgY29uc3QgdXJsID0gYGh0dHBzOi8vb2F1dGgucmVkZGl0LmNvbSR7ZW5kcG9pbnR9YDtcblxuICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgd2l0aFJldHJ5KGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHJlcyA9IGF3YWl0IGZldGNoKHVybCwge1xuICAgICAgICBoZWFkZXJzOiB7XG4gICAgICAgICAgXCJVc2VyLUFnZW50XCI6IHRoaXMudXNlckFnZW50LFxuICAgICAgICB9LFxuICAgICAgfSk7XG5cbiAgICAgIGlmICghcmVzLm9rKSB7XG4gICAgICAgIGlmIChyZXMuc3RhdHVzID09PSA0MjkpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJSYXRlIGxpbWl0ZWRcIik7XG4gICAgICAgIH1cbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBIVFRQICR7cmVzLnN0YXR1c306ICR7YXdhaXQgcmVzLnRleHQoKX1gKTtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHJlcy5qc29uKCk7XG4gICAgfSk7XG5cbiAgICByZXR1cm4gcmVzcG9uc2U7XG4gIH1cblxuICBhc3luYyBnZXRTdWJyZWRkaXRQb3N0cyhcbiAgICBzdWJyZWRkaXQ6IHN0cmluZyxcbiAgICBzb3J0OiBcImhvdFwiIHwgXCJuZXdcIiB8IFwidG9wXCIgPSBcImhvdFwiLFxuICAgIGxpbWl0OiBudW1iZXIgPSAyNVxuICApOiBQcm9taXNlPFJlZGRpdFBvc3RbXT4ge1xuICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgdGhpcy5yZXF1ZXN0PFJlZGRpdExpc3RpbmdSZXNwb25zZT4oXG4gICAgICBgL3IvJHtzdWJyZWRkaXR9LyR7c29ydH0uanNvbj9saW1pdD0ke2xpbWl0fWBcbiAgICApO1xuXG4gICAgcmV0dXJuIHJlc3BvbnNlLmRhdGEuY2hpbGRyZW4ubWFwKChjaGlsZCkgPT4gY2hpbGQuZGF0YSk7XG4gIH1cblxuICBhc3luYyBzZWFyY2hTdWJyZWRkaXQoc3VicmVkZGl0OiBzdHJpbmcsIHF1ZXJ5OiBzdHJpbmcpOiBQcm9taXNlPFJlZGRpdFBvc3RbXT4ge1xuICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgdGhpcy5yZXF1ZXN0PFJlZGRpdExpc3RpbmdSZXNwb25zZT4oXG4gICAgICBgL3IvJHtzdWJyZWRkaXR9L3NlYXJjaC5qc29uP3E9JHtlbmNvZGVVUklDb21wb25lbnQocXVlcnkpfSZyZXN0cmljdF9zcj0xJmxpbWl0PTI1YFxuICAgICk7XG5cbiAgICByZXR1cm4gcmVzcG9uc2UuZGF0YS5jaGlsZHJlbi5tYXAoKGNoaWxkKSA9PiBjaGlsZC5kYXRhKTtcbiAgfVxuXG4gIGFzeW5jIGNvbGxlY3RTaWduYWxzKGNvbGxlY3RlZEF0OiBzdHJpbmcpOiBQcm9taXNlPFNpZ25hbEV2ZW50W10+IHtcbiAgICBjb25zdCBzaWduYWxzOiBTaWduYWxFdmVudFtdID0gW107XG5cbiAgICBmb3IgKGNvbnN0IHN1YnJlZGRpdCBvZiBTVUJSRURESVRTKSB7XG4gICAgICB0cnkge1xuICAgICAgICAvLyBHZXQgaG90IGFuZCBuZXcgcG9zdHNcbiAgICAgICAgY29uc3QgaG90UG9zdHMgPSBhd2FpdCB0aGlzLmdldFN1YnJlZGRpdFBvc3RzKHN1YnJlZGRpdCwgXCJob3RcIiwgMjUpO1xuICAgICAgICBjb25zdCBuZXdQb3N0cyA9IGF3YWl0IHRoaXMuZ2V0U3VicmVkZGl0UG9zdHMoc3VicmVkZGl0LCBcIm5ld1wiLCAyNSk7XG4gICAgICAgIGNvbnN0IGFsbFBvc3RzID0gWy4uLmhvdFBvc3RzLCAuLi5uZXdQb3N0c107XG5cbiAgICAgICAgLy8gRGVkdXBsaWNhdGUgYnkgSURcbiAgICAgICAgY29uc3QgdW5pcXVlUG9zdHMgPSBuZXcgTWFwKGFsbFBvc3RzLm1hcCgocCkgPT4gW3AuaWQsIHBdKSk7XG5cbiAgICAgICAgZm9yIChjb25zdCBwb3N0IG9mIHVuaXF1ZVBvc3RzLnZhbHVlcygpKSB7XG4gICAgICAgICAgY29uc3QgZnVsbFRleHQgPSBgJHtwb3N0LnRpdGxlfSAke3Bvc3Quc2VsZnRleHR9YDtcbiAgICAgICAgICBjb25zdCBzZW50aW1lbnQgPSBhbmFseXplU2VudGltZW50KGZ1bGxUZXh0KTtcbiAgICAgICAgICBjb25zdCBjYXJkTWVudGlvbnMgPSBleHRyYWN0Q2FyZE1lbnRpb25zKGZ1bGxUZXh0KTtcblxuICAgICAgICAgIC8vIFNraXAgaWYgbm90IHJlbGF0ZWQgdG8gc3BlY2lmaWMgY2FyZHMgYW5kIGhhcyBuZXV0cmFsIHNlbnRpbWVudFxuICAgICAgICAgIGlmIChjYXJkTWVudGlvbnMubGVuZ3RoID09PSAwICYmIE1hdGguYWJzKHNlbnRpbWVudC5zY29yZSkgPCAwLjMpIHtcbiAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIC8vIENhbGN1bGF0ZSBlbmdhZ2VtZW50IChSZWRkaXQgdXNlcyBzY29yZSB3aGljaCBpcyB1cHZvdGVzIC0gZG93bnZvdGVzKVxuICAgICAgICAgIGNvbnN0IGVuZ2FnZW1lbnQgPSBwb3N0LnNjb3JlICogcG9zdC51cHZvdGVfcmF0aW8gKyBwb3N0Lm51bV9jb21tZW50cyAqIDI7XG5cbiAgICAgICAgICBzaWduYWxzLnB1c2goe1xuICAgICAgICAgICAgZXZlbnRUeXBlOiBcInNpZ25hbFwiLFxuICAgICAgICAgICAgc291cmNlOiBcInJlZGRpdFwiLFxuICAgICAgICAgICAgc2lnbmFsSWQ6IGByZC0ke3Bvc3QuaWR9YCxcbiAgICAgICAgICAgIHNpZ25hbFR5cGU6IFwic29jaWFsX21lbnRpb25cIixcbiAgICAgICAgICAgIGNhcmRJZHM6IGNhcmRNZW50aW9ucyxcbiAgICAgICAgICAgIGNvbnRlbnQ6IHNhbml0aXplU3RyaW5nKGAke3Bvc3QudGl0bGV9XFxuJHtwb3N0LnNlbGZ0ZXh0fWAuc3Vic3RyaW5nKDAsIDEwMDApKSxcbiAgICAgICAgICAgIHNlbnRpbWVudDogc2VudGltZW50LnNjb3JlLFxuICAgICAgICAgICAgc2VudGltZW50S2V5d29yZHM6IHNlbnRpbWVudC5rZXl3b3JkcyxcbiAgICAgICAgICAgIGVuZ2FnZW1lbnQsXG4gICAgICAgICAgICBhdXRob3JJZDogcG9zdC5hdXRob3IsXG4gICAgICAgICAgICB1cmw6IGBodHRwczovL3JlZGRpdC5jb20ke3Bvc3QudXJsfWAsXG4gICAgICAgICAgICBtZXRhZGF0YToge1xuICAgICAgICAgICAgICBzdWJyZWRkaXQ6IHBvc3Quc3VicmVkZGl0LFxuICAgICAgICAgICAgICBzY29yZTogcG9zdC5zY29yZSxcbiAgICAgICAgICAgICAgdXB2b3RlUmF0aW86IHBvc3QudXB2b3RlX3JhdGlvLFxuICAgICAgICAgICAgICBjb21tZW50czogcG9zdC5udW1fY29tbWVudHMsXG4gICAgICAgICAgICAgIGZsYWlyOiBwb3N0LmxpbmtfZmxhaXJfdGV4dCxcbiAgICAgICAgICAgICAgaXNWaWRlbzogcG9zdC5pc192aWRlbyxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB0aW1lc3RhbXA6IG5ldyBEYXRlKHBvc3QuY3JlYXRlZF91dGMgKiAxMDAwKS50b0lTT1N0cmluZygpLFxuICAgICAgICAgICAgY29sbGVjdGVkQXQsXG4gICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGNvbnNvbGUud2FybihgUmVkZGl0IGNvbGxlY3Rpb24gZmFpbGVkIGZvciByLyR7c3VicmVkZGl0fTpgLCBlcnJvcik7XG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHNpZ25hbHM7XG4gIH1cbn1cblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIFlPVVRVQkUgQ09MTEVDVE9SXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG5jbGFzcyBZb3VUdWJlQ29sbGVjdG9yIHtcbiAgcHJpdmF0ZSBhcGlLZXk6IHN0cmluZztcblxuICBjb25zdHJ1Y3RvcihhcGlLZXk6IHN0cmluZykge1xuICAgIHRoaXMuYXBpS2V5ID0gYXBpS2V5O1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyByZXF1ZXN0PFQ+KGVuZHBvaW50OiBzdHJpbmcsIHBhcmFtczogVVJMU2VhcmNoUGFyYW1zKTogUHJvbWlzZTxUPiB7XG4gICAgYXdhaXQgeW91dHViZVJhdGVMaW1pdGVyLmFjcXVpcmUoKTtcblxuICAgIHBhcmFtcy5zZXQoXCJrZXlcIiwgdGhpcy5hcGlLZXkpO1xuICAgIGNvbnN0IHVybCA9IGBodHRwczovL3d3dy5nb29nbGVhcGlzLmNvbS95b3V0dWJlL3YzJHtlbmRwb2ludH0/JHtwYXJhbXMudG9TdHJpbmcoKX1gO1xuXG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCB3aXRoUmV0cnkoYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgcmVzID0gYXdhaXQgZmV0Y2godXJsKTtcblxuICAgICAgaWYgKCFyZXMub2spIHtcbiAgICAgICAgaWYgKHJlcy5zdGF0dXMgPT09IDQyOSkge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcIlJhdGUgbGltaXRlZFwiKTtcbiAgICAgICAgfVxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEhUVFAgJHtyZXMuc3RhdHVzfTogJHthd2FpdCByZXMudGV4dCgpfWApO1xuICAgICAgfVxuXG4gICAgICByZXR1cm4gcmVzLmpzb24oKTtcbiAgICB9KTtcblxuICAgIHJldHVybiByZXNwb25zZTtcbiAgfVxuXG4gIGFzeW5jIHNlYXJjaFZpZGVvcyhxdWVyeTogc3RyaW5nLCBtYXhSZXN1bHRzOiBudW1iZXIgPSAyNSk6IFByb21pc2U8WW91VHViZVZpZGVvW10+IHtcbiAgICBjb25zdCBwYXJhbXMgPSBuZXcgVVJMU2VhcmNoUGFyYW1zKHtcbiAgICAgIHBhcnQ6IFwic25pcHBldFwiLFxuICAgICAgcTogcXVlcnksXG4gICAgICB0eXBlOiBcInZpZGVvXCIsXG4gICAgICBtYXhSZXN1bHRzOiBtYXhSZXN1bHRzLnRvU3RyaW5nKCksXG4gICAgICBvcmRlcjogXCJkYXRlXCIsXG4gICAgICBwdWJsaXNoZWRBZnRlcjogbmV3IERhdGUoRGF0ZS5ub3coKSAtIDcgKiAyNCAqIDYwICogNjAgKiAxMDAwKS50b0lTT1N0cmluZygpLCAvLyBMYXN0IDcgZGF5c1xuICAgIH0pO1xuXG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCB0aGlzLnJlcXVlc3Q8WW91VHViZVNlYXJjaFJlc3BvbnNlPihcIi9zZWFyY2hcIiwgcGFyYW1zKTtcbiAgICByZXR1cm4gcmVzcG9uc2UuaXRlbXMgfHwgW107XG4gIH1cblxuICBhc3luYyBnZXRWaWRlb1N0YXRzKHZpZGVvSWRzOiBzdHJpbmdbXSk6IFByb21pc2U8TWFwPHN0cmluZywgWW91VHViZVZpZGVvU3RhdHM+PiB7XG4gICAgaWYgKHZpZGVvSWRzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIG5ldyBNYXAoKTtcblxuICAgIGNvbnN0IHBhcmFtcyA9IG5ldyBVUkxTZWFyY2hQYXJhbXMoe1xuICAgICAgcGFydDogXCJzdGF0aXN0aWNzXCIsXG4gICAgICBpZDogdmlkZW9JZHMuam9pbihcIixcIiksXG4gICAgfSk7XG5cbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHRoaXMucmVxdWVzdDx7IGl0ZW1zOiBZb3VUdWJlVmlkZW9TdGF0c1tdIH0+KFwiL3ZpZGVvc1wiLCBwYXJhbXMpO1xuXG4gICAgcmV0dXJuIG5ldyBNYXAoKHJlc3BvbnNlLml0ZW1zIHx8IFtdKS5tYXAoKGl0ZW0pID0+IFtpdGVtLmlkLCBpdGVtXSkpO1xuICB9XG5cbiAgYXN5bmMgY29sbGVjdFNpZ25hbHMoY29sbGVjdGVkQXQ6IHN0cmluZyk6IFByb21pc2U8U2lnbmFsRXZlbnRbXT4ge1xuICAgIGNvbnN0IHNpZ25hbHM6IFNpZ25hbEV2ZW50W10gPSBbXTtcblxuICAgIGZvciAoY29uc3Qga2V5d29yZCBvZiBTRUFSQ0hfS0VZV09SRFMuc2xpY2UoMCwgMykpIHtcbiAgICAgIC8vIExpbWl0IHRvIGF2b2lkIHF1b3RhXG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCB2aWRlb3MgPSBhd2FpdCB0aGlzLnNlYXJjaFZpZGVvcyhrZXl3b3JkLCAyMCk7XG5cbiAgICAgICAgLy8gR2V0IHN0YXRzIGZvciBhbGwgdmlkZW9zXG4gICAgICAgIGNvbnN0IHZpZGVvSWRzID0gdmlkZW9zLm1hcCgodikgPT4gdi5pZC52aWRlb0lkKTtcbiAgICAgICAgY29uc3Qgc3RhdHMgPSBhd2FpdCB0aGlzLmdldFZpZGVvU3RhdHModmlkZW9JZHMpO1xuXG4gICAgICAgIGZvciAoY29uc3QgdmlkZW8gb2YgdmlkZW9zKSB7XG4gICAgICAgICAgY29uc3QgZnVsbFRleHQgPSBgJHt2aWRlby5zbmlwcGV0LnRpdGxlfSAke3ZpZGVvLnNuaXBwZXQuZGVzY3JpcHRpb259YDtcbiAgICAgICAgICBjb25zdCBzZW50aW1lbnQgPSBhbmFseXplU2VudGltZW50KGZ1bGxUZXh0KTtcbiAgICAgICAgICBjb25zdCBjYXJkTWVudGlvbnMgPSBleHRyYWN0Q2FyZE1lbnRpb25zKGZ1bGxUZXh0KTtcblxuICAgICAgICAgIGNvbnN0IHZpZGVvU3RhdHMgPSBzdGF0cy5nZXQodmlkZW8uaWQudmlkZW9JZCk7XG4gICAgICAgICAgY29uc3Qgdmlld3MgPSBwYXJzZUludCh2aWRlb1N0YXRzPy5zdGF0aXN0aWNzLnZpZXdDb3VudCB8fCBcIjBcIik7XG4gICAgICAgICAgY29uc3QgbGlrZXMgPSBwYXJzZUludCh2aWRlb1N0YXRzPy5zdGF0aXN0aWNzLmxpa2VDb3VudCB8fCBcIjBcIik7XG4gICAgICAgICAgY29uc3QgY29tbWVudHMgPSBwYXJzZUludCh2aWRlb1N0YXRzPy5zdGF0aXN0aWNzLmNvbW1lbnRDb3VudCB8fCBcIjBcIik7XG5cbiAgICAgICAgICAvLyBDYWxjdWxhdGUgZW5nYWdlbWVudCBiYXNlZCBvbiB2aWV3cywgbGlrZXMsIGNvbW1lbnRzXG4gICAgICAgICAgY29uc3QgZW5nYWdlbWVudCA9IHZpZXdzICogMC4wMSArIGxpa2VzICogMiArIGNvbW1lbnRzICogNTtcblxuICAgICAgICAgIC8vIERldGVjdCB2aWRlbyB0eXBlIGZyb20gdGl0bGVcbiAgICAgICAgICBsZXQgc2lnbmFsVHlwZTogU2lnbmFsRXZlbnRbXCJzaWduYWxUeXBlXCJdID0gXCJzb2NpYWxfbWVudGlvblwiO1xuICAgICAgICAgIGNvbnN0IHRpdGxlTG93ZXIgPSB2aWRlby5zbmlwcGV0LnRpdGxlLnRvTG93ZXJDYXNlKCk7XG4gICAgICAgICAgaWYgKFxuICAgICAgICAgICAgdGl0bGVMb3dlci5pbmNsdWRlcyhcImRlY2tcIikgfHxcbiAgICAgICAgICAgIHRpdGxlTG93ZXIuaW5jbHVkZXMoXCJwcm9maWxlXCIpIHx8XG4gICAgICAgICAgICB0aXRsZUxvd2VyLmluY2x1ZGVzKFwiYnVpbGRcIilcbiAgICAgICAgICApIHtcbiAgICAgICAgICAgIHNpZ25hbFR5cGUgPSBcIm1ldGFfc2hpZnRcIjtcbiAgICAgICAgICB9IGVsc2UgaWYgKFxuICAgICAgICAgICAgdGl0bGVMb3dlci5pbmNsdWRlcyhcIm9wZW5pbmdcIikgfHxcbiAgICAgICAgICAgIHRpdGxlTG93ZXIuaW5jbHVkZXMoXCJ1bmJveFwiKSB8fFxuICAgICAgICAgICAgdGl0bGVMb3dlci5pbmNsdWRlcyhcInBhY2tcIilcbiAgICAgICAgICApIHtcbiAgICAgICAgICAgIHNpZ25hbFR5cGUgPSBcInJlbGVhc2VfYW5ub3VuY2VcIjtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBzaWduYWxzLnB1c2goe1xuICAgICAgICAgICAgZXZlbnRUeXBlOiBcInNpZ25hbFwiLFxuICAgICAgICAgICAgc291cmNlOiBcInlvdXR1YmVcIixcbiAgICAgICAgICAgIHNpZ25hbElkOiBgeXQtJHt2aWRlby5pZC52aWRlb0lkfWAsXG4gICAgICAgICAgICBzaWduYWxUeXBlLFxuICAgICAgICAgICAgY2FyZElkczogY2FyZE1lbnRpb25zLFxuICAgICAgICAgICAgY29udGVudDogc2FuaXRpemVTdHJpbmcodmlkZW8uc25pcHBldC50aXRsZS5zdWJzdHJpbmcoMCwgMjAwKSksXG4gICAgICAgICAgICBzZW50aW1lbnQ6IHNlbnRpbWVudC5zY29yZSxcbiAgICAgICAgICAgIHNlbnRpbWVudEtleXdvcmRzOiBzZW50aW1lbnQua2V5d29yZHMsXG4gICAgICAgICAgICBlbmdhZ2VtZW50LFxuICAgICAgICAgICAgYXV0aG9ySWQ6IHZpZGVvLnNuaXBwZXQuY2hhbm5lbElkLFxuICAgICAgICAgICAgdXJsOiBgaHR0cHM6Ly93d3cueW91dHViZS5jb20vd2F0Y2g/dj0ke3ZpZGVvLmlkLnZpZGVvSWR9YCxcbiAgICAgICAgICAgIG1ldGFkYXRhOiB7XG4gICAgICAgICAgICAgIGNoYW5uZWxUaXRsZTogdmlkZW8uc25pcHBldC5jaGFubmVsVGl0bGUsXG4gICAgICAgICAgICAgIHZpZXdzLFxuICAgICAgICAgICAgICBsaWtlcyxcbiAgICAgICAgICAgICAgY29tbWVudHMsXG4gICAgICAgICAgICAgIHRodW1ibmFpbDogdmlkZW8uc25pcHBldC50aHVtYm5haWxzLmRlZmF1bHQudXJsLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHRpbWVzdGFtcDogdmlkZW8uc25pcHBldC5wdWJsaXNoZWRBdCxcbiAgICAgICAgICAgIGNvbGxlY3RlZEF0LFxuICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBjb25zb2xlLndhcm4oYFlvdVR1YmUgc2VhcmNoIGZhaWxlZCBmb3IgXCIke2tleXdvcmR9XCI6YCwgZXJyb3IpO1xuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBzaWduYWxzO1xuICB9XG59XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBNQUlOIEhBTkRMRVJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbmV4cG9ydCBjb25zdCBoYW5kbGVyOiBIYW5kbGVyPFNjaGVkdWxlZEV2ZW50PiA9IGFzeW5jIChldmVudCkgPT4ge1xuICBjb25zb2xlLmxvZyhcIlNvY2lhbCBjb2xsZWN0b3Igc3RhcnRlZFwiLCB7IGV2ZW50IH0pO1xuICBjb25zdCBjb2xsZWN0ZWRBdCA9IG5vd0lzbygpO1xuXG4gIHRyeSB7XG4gICAgLy8gR2V0IEFQSSBjcmVkZW50aWFsc1xuICAgIGNvbnN0IHNlY3JldHMgPSBhd2FpdCBnZXRTZWNyZXRzKCk7XG5cbiAgICBjb25zdCBhbGxTaWduYWxzOiBTaWduYWxFdmVudFtdID0gW107XG5cbiAgICAvLyBDb2xsZWN0IGZyb20gVHdpdHRlclxuICAgIGlmIChzZWNyZXRzLnR3aXR0ZXJfYmVhcmVyX3Rva2VuKSB7XG4gICAgICBjb25zb2xlLmxvZyhcIkNvbGxlY3RpbmcgZnJvbSBUd2l0dGVyLi4uXCIpO1xuICAgICAgY29uc3QgdHdpdHRlckNvbGxlY3RvciA9IG5ldyBUd2l0dGVyQ29sbGVjdG9yKHNlY3JldHMudHdpdHRlcl9iZWFyZXJfdG9rZW4pO1xuICAgICAgY29uc3QgdHdpdHRlclNpZ25hbHMgPSBhd2FpdCB0d2l0dGVyQ29sbGVjdG9yLmNvbGxlY3RTaWduYWxzKGNvbGxlY3RlZEF0KTtcbiAgICAgIGNvbnNvbGUubG9nKGAgIENvbGxlY3RlZCAke3R3aXR0ZXJTaWduYWxzLmxlbmd0aH0gVHdpdHRlciBzaWduYWxzYCk7XG4gICAgICBhbGxTaWduYWxzLnB1c2goLi4udHdpdHRlclNpZ25hbHMpO1xuICAgIH0gZWxzZSB7XG4gICAgICBjb25zb2xlLndhcm4oXCJUd2l0dGVyIGNyZWRlbnRpYWxzIG5vdCBjb25maWd1cmVkLCBza2lwcGluZ1wiKTtcbiAgICB9XG5cbiAgICAvLyBDb2xsZWN0IGZyb20gUmVkZGl0XG4gICAgY29uc29sZS5sb2coXCJDb2xsZWN0aW5nIGZyb20gUmVkZGl0Li4uXCIpO1xuICAgIGNvbnN0IHJlZGRpdENvbGxlY3RvciA9IG5ldyBSZWRkaXRDb2xsZWN0b3IoKTtcbiAgICB0cnkge1xuICAgICAgY29uc3QgcmVkZGl0U2lnbmFscyA9IGF3YWl0IHJlZGRpdENvbGxlY3Rvci5jb2xsZWN0U2lnbmFscyhjb2xsZWN0ZWRBdCk7XG4gICAgICBjb25zb2xlLmxvZyhgICBDb2xsZWN0ZWQgJHtyZWRkaXRTaWduYWxzLmxlbmd0aH0gUmVkZGl0IHNpZ25hbHNgKTtcbiAgICAgIGFsbFNpZ25hbHMucHVzaCguLi5yZWRkaXRTaWduYWxzKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgY29uc29sZS53YXJuKFwiUmVkZGl0IGNvbGxlY3Rpb24gZmFpbGVkOlwiLCBlcnJvcik7XG4gICAgfVxuXG4gICAgLy8gQ29sbGVjdCBmcm9tIFlvdVR1YmVcbiAgICBpZiAoc2VjcmV0cy55b3V0dWJlX2FwaV9rZXkpIHtcbiAgICAgIGNvbnNvbGUubG9nKFwiQ29sbGVjdGluZyBmcm9tIFlvdVR1YmUuLi5cIik7XG4gICAgICBjb25zdCB5b3V0dWJlQ29sbGVjdG9yID0gbmV3IFlvdVR1YmVDb2xsZWN0b3Ioc2VjcmV0cy55b3V0dWJlX2FwaV9rZXkpO1xuICAgICAgY29uc3QgeW91dHViZVNpZ25hbHMgPSBhd2FpdCB5b3V0dWJlQ29sbGVjdG9yLmNvbGxlY3RTaWduYWxzKGNvbGxlY3RlZEF0KTtcbiAgICAgIGNvbnNvbGUubG9nKGAgIENvbGxlY3RlZCAke3lvdXR1YmVTaWduYWxzLmxlbmd0aH0gWW91VHViZSBzaWduYWxzYCk7XG4gICAgICBhbGxTaWduYWxzLnB1c2goLi4ueW91dHViZVNpZ25hbHMpO1xuICAgIH0gZWxzZSB7XG4gICAgICBjb25zb2xlLndhcm4oXCJZb3VUdWJlIGNyZWRlbnRpYWxzIG5vdCBjb25maWd1cmVkLCBza2lwcGluZ1wiKTtcbiAgICB9XG5cbiAgICBjb25zb2xlLmxvZyhgVG90YWwgc2lnbmFscyBjb2xsZWN0ZWQ6ICR7YWxsU2lnbmFscy5sZW5ndGh9YCk7XG5cbiAgICAvLyBTZW5kIHRvIEtpbmVzaXNcbiAgICBpZiAoYWxsU2lnbmFscy5sZW5ndGggPiAwKSB7XG4gICAgICBhd2FpdCBwdXRUb0tpbmVzaXMoU0lHTkFMX1NUUkVBTSwgYWxsU2lnbmFscyk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIHN0YXR1c0NvZGU6IDIwMCxcbiAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgdG90YWxTaWduYWxzOiBhbGxTaWduYWxzLmxlbmd0aCxcbiAgICAgICAgYnlTb3VyY2U6IHtcbiAgICAgICAgICB0d2l0dGVyOiBhbGxTaWduYWxzLmZpbHRlcigocykgPT4gcy5zb3VyY2UgPT09IFwidHdpdHRlclwiKS5sZW5ndGgsXG4gICAgICAgICAgcmVkZGl0OiBhbGxTaWduYWxzLmZpbHRlcigocykgPT4gcy5zb3VyY2UgPT09IFwicmVkZGl0XCIpLmxlbmd0aCxcbiAgICAgICAgICB5b3V0dWJlOiBhbGxTaWduYWxzLmZpbHRlcigocykgPT4gcy5zb3VyY2UgPT09IFwieW91dHViZVwiKS5sZW5ndGgsXG4gICAgICAgIH0sXG4gICAgICAgIGNvbGxlY3RlZEF0LFxuICAgICAgfSksXG4gICAgfTtcbiAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICBjb25zb2xlLmVycm9yKFwiU29jaWFsIGNvbGxlY3RvciBlcnJvcjpcIiwgZXJyb3IpO1xuICAgIHRocm93IGVycm9yO1xuICB9XG59O1xuIl19