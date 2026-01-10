# Gap-Filling Implementation Plan

> **Research Date**: January 2026
> **Purpose**: Practical implementation plan to fill data collection gaps for ML training
> **Status**: ✅ IMPLEMENTED

---

## Implementation Status

All planned components have been implemented:

| Component | Status | File Location |
|-----------|--------|---------------|
| TCGAPIs Listing Collector | ✅ Complete | `src/collectors/tcgapis-listing-collector.ts` |
| YouTube Collector | ✅ Complete | `src/collectors/youtube-collector.ts` |
| Reddit Collector | ✅ Complete | `src/collectors/reddit-collector.ts` |
| Limitless Tournament Collector | ✅ Complete | `src/collectors/limitless-collector.ts` |
| Cardmarket Collector | ✅ Complete | `src/collectors/cardmarket-collector.ts` |
| Redis Feature Store | ✅ Complete | `src/features/redis-feature-store.ts` |
| Database Schema (Prisma) | ✅ Complete | `prisma/schema.prisma` |
| Collection Job Scheduler | ✅ Complete | `src/jobs/collection-scheduler.ts` |
| Job Handlers | ✅ Complete | `src/jobs/job-handlers.ts` |
| Entry Point | ✅ Complete | `src/gap-filling-entry.ts` |

### Quick Start

```bash
# Set environment variables
export TCGAPIS_API_KEY="your-key"
export YOUTUBE_API_KEY="your-key"
export REDDIT_CLIENT_ID="your-id"
export REDDIT_CLIENT_SECRET="your-secret"
export LIMITLESS_API_KEY="your-key"
export APIFY_TOKEN="your-token"
export REDIS_URL="redis://localhost:6379"
export DATABASE_URL="postgresql://..."

# Apply database migrations
npx prisma migrate dev

# Start the collector
npx tsx src/gap-filling-entry.ts
```

---

## Executive Summary

The Value Extraction Framework requires data that the current pipeline doesn't collect. This document provides concrete solutions with costs, implementation details, and prioritization.

### Gap Overview

| Gap | Current State | Solution | Monthly Cost | Time to Value |
|-----|--------------|----------|--------------|---------------|
| **Listing-Level Data** | Market prices only | TCGAPIs Unlimited | £499 | 2 weeks |
| **Social Signals** | None | YouTube API + Reddit + Apify | ~$50 | 4 weeks |
| **Tournament Data** | None | Limitless API | Free (with key) | 1 week |
| **Cross-Platform Sync** | TCGplayer only | Cardmarket scraper | $20 | 2 weeks |
| **Feature Store** | None | Redis Cloud | $5-50 | 1 week |

**Total estimated monthly cost**: £500-600 (~$630-750)

---

## 1. Gap #1: Listing-Level Data

### The Problem

Current pipeline collects **market prices** (aggregated):
```
Card X: market=$45, low=$42, high=$50
```

The Sniper model needs **individual listings**:
```
Card X listings:
  - Seller A: $42.00 (NM, 5 available, 98% rating)
  - Seller B: $44.99 (NM, 2 available, 100% rating)
  - Seller C: $48.00 (LP, 1 available, 95% rating)
```

### Solution Options Comparison

| Option | Cost | Data Quality | Effort | Recommendation |
|--------|------|--------------|--------|----------------|
| **TCGAPIs Unlimited** | £499/mo | Excellent | Low | **Best choice** |
| TCGAPIs Business | £199/mo | Good (no live listings) | Low | Budget option |
| Apify TCGplayer Scrapers | ~$100/mo | Good | Medium | Alternative |
| Custom Playwright scraper | $0 | Variable | High | Not recommended |

### Recommended: TCGAPIs Unlimited Plan

**Why**: Pre-built solution with live listings, no API key management, reliable.

**Cost**: £499/month (~$630)

**What you get**:
- Live TCGplayer listings (hourly updates)
- SKU-level pricing (condition + language variants)
- Sales history data
- Card recognition API (bonus for trade-in grading)
- No rate limits

### Implementation

```typescript
// src/collectors/tcgapis-listing-collector.ts

import { createClient } from '@tcgapis/sdk';

interface TCGApisConfig {
  apiKey: string;
  baseUrl: string;
}

interface ListingData {
  cardId: string;
  platform: 'tcgplayer';
  listings: Array<{
    sellerId: string;
    sellerName: string;
    sellerRating: number;
    sellerSales: number;
    price: number;
    condition: 'NM' | 'LP' | 'MP' | 'HP' | 'DMG';
    quantity: number;
    shipping: number;
    language: string;
  }>;
  marketPrice: number;
  lowPrice: number;
  lastUpdated: Date;
}

export class TCGApisListingCollector {
  private client: TCGApisClient;

  constructor(config: TCGApisConfig) {
    this.client = createClient({
      apiKey: config.apiKey,
      baseUrl: config.baseUrl || 'https://api.tcgapis.com/v1',
    });
  }

  /**
   * Fetch live listings for a card.
   *
   * TCGAPIs Unlimited: No rate limits
   * Updates: Hourly from TCGplayer
   */
  async getListings(productId: string): Promise<ListingData> {
    const response = await this.client.get(`/tcgplayer/products/${productId}/listings`);

    return {
      cardId: productId,
      platform: 'tcgplayer',
      listings: response.listings.map((l: any) => ({
        sellerId: l.seller.id,
        sellerName: l.seller.name,
        sellerRating: l.seller.rating,
        sellerSales: l.seller.salesCount,
        price: l.price,
        condition: this.mapCondition(l.condition),
        quantity: l.quantity,
        shipping: l.shipping || 0,
        language: l.language || 'English',
      })),
      marketPrice: response.marketPrice,
      lowPrice: response.lowPrice,
      lastUpdated: new Date(response.lastUpdated),
    };
  }

  /**
   * Fetch sales history for training data.
   */
  async getSalesHistory(productId: string, days: number = 90): Promise<SalesData[]> {
    const response = await this.client.get(`/tcgplayer/products/${productId}/sales`, {
      params: { days },
    });

    return response.sales.map((s: any) => ({
      date: new Date(s.date),
      price: s.price,
      condition: s.condition,
      quantity: s.quantity,
    }));
  }

  /**
   * Batch fetch listings for multiple cards.
   * More efficient than individual calls.
   */
  async batchGetListings(productIds: string[]): Promise<Map<string, ListingData>> {
    const results = new Map<string, ListingData>();

    // TCGAPIs supports batch requests
    const response = await this.client.post('/tcgplayer/products/batch/listings', {
      productIds,
    });

    for (const item of response.results) {
      results.set(item.productId, {
        cardId: item.productId,
        platform: 'tcgplayer',
        listings: item.listings,
        marketPrice: item.marketPrice,
        lowPrice: item.lowPrice,
        lastUpdated: new Date(),
      });
    }

    return results;
  }

  private mapCondition(raw: string): 'NM' | 'LP' | 'MP' | 'HP' | 'DMG' {
    const map: Record<string, 'NM' | 'LP' | 'MP' | 'HP' | 'DMG'> = {
      'Near Mint': 'NM',
      'Lightly Played': 'LP',
      'Moderately Played': 'MP',
      'Heavily Played': 'HP',
      'Damaged': 'DMG',
    };
    return map[raw] || 'NM';
  }
}
```

### Database Schema for Listings

```sql
-- Individual listings with change tracking
CREATE TABLE card_listings (
    id BIGSERIAL PRIMARY KEY,
    card_id VARCHAR(50) NOT NULL,
    platform VARCHAR(20) NOT NULL DEFAULT 'tcgplayer',

    -- Seller info
    seller_id VARCHAR(100) NOT NULL,
    seller_name VARCHAR(255),
    seller_rating DECIMAL(5, 2),
    seller_sales_count INTEGER,

    -- Listing details
    price DECIMAL(10, 2) NOT NULL,
    condition VARCHAR(20) NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    shipping_cost DECIMAL(6, 2) DEFAULT 0,
    language VARCHAR(20) DEFAULT 'English',

    -- Market context (for training)
    market_price_snapshot DECIMAL(10, 2),
    low_price_snapshot DECIMAL(10, 2),
    discount_from_market DECIMAL(5, 4) GENERATED ALWAYS AS (
        (market_price_snapshot - price) / NULLIF(market_price_snapshot, 0)
    ) STORED,

    -- Tracking
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sold_at TIMESTAMPTZ,  -- Populated when listing disappears

    -- Composite unique constraint
    CONSTRAINT uq_listing UNIQUE (card_id, seller_id, price, condition)
);

-- Index for fast lookups
CREATE INDEX idx_listings_card ON card_listings (card_id, last_seen_at DESC);
CREATE INDEX idx_listings_active ON card_listings (card_id) WHERE sold_at IS NULL;
CREATE INDEX idx_listings_underpriced ON card_listings (discount_from_market DESC)
    WHERE discount_from_market > 0.15 AND sold_at IS NULL;

-- View for Sniper model training data
CREATE VIEW sniper_training_data AS
SELECT
    cl.*,
    CASE
        WHEN cl.sold_at IS NOT NULL
             AND EXTRACT(EPOCH FROM (cl.sold_at - cl.first_seen_at)) / 60 < 60
        THEN 1
        ELSE 0
    END as sold_fast,
    EXTRACT(EPOCH FROM (COALESCE(cl.sold_at, NOW()) - cl.first_seen_at)) / 60 as time_to_sell_minutes
FROM card_listings cl
WHERE cl.first_seen_at < NOW() - INTERVAL '24 hours'  -- Give listings time to sell
   OR cl.sold_at IS NOT NULL;
```

### Collection Schedule

```typescript
// src/jobs/listing-collection-job.ts

import { CronJob } from 'cron';

/**
 * Listing collection schedule:
 * - Hot cards (>$20, high volume): Every 15 minutes
 * - Medium cards ($5-20): Every hour
 * - Low-value cards (<$5): Every 4 hours
 */
export function setupListingCollectionJobs(collector: TCGApisListingCollector) {
  // Hot cards - 15 minute intervals
  new CronJob('*/15 * * * *', async () => {
    const hotCards = await db.getHotCardIds(); // Cards >$20 or high recent sales
    for (const batch of chunk(hotCards, 100)) {
      await collector.batchGetListings(batch);
      await processAndStoreBatch(batch);
    }
  }).start();

  // Medium cards - hourly
  new CronJob('0 * * * *', async () => {
    const mediumCards = await db.getMediumCardIds();
    for (const batch of chunk(mediumCards, 100)) {
      await collector.batchGetListings(batch);
      await processAndStoreBatch(batch);
    }
  }).start();

  // Low-value cards - every 4 hours
  new CronJob('0 */4 * * *', async () => {
    const lowCards = await db.getLowValueCardIds();
    for (const batch of chunk(lowCards, 100)) {
      await collector.batchGetListings(batch);
      await processAndStoreBatch(batch);
    }
  }).start();
}

/**
 * Process batch and detect sold listings.
 */
async function processAndStoreBatch(listings: ListingData[]): Promise<void> {
  for (const listing of listings) {
    // Get previous listings for this card
    const previousListings = await db.getActiveListings(listing.cardId);
    const currentKeys = new Set(
      listing.listings.map(l => `${l.sellerId}-${l.price}-${l.condition}`)
    );

    // Mark sold listings
    for (const prev of previousListings) {
      const key = `${prev.sellerId}-${prev.price}-${prev.condition}`;
      if (!currentKeys.has(key)) {
        await db.markListingSold(prev.id, new Date());
      }
    }

    // Upsert current listings
    for (const l of listing.listings) {
      await db.upsertListing({
        ...l,
        cardId: listing.cardId,
        marketPriceSnapshot: listing.marketPrice,
        lowPriceSnapshot: listing.lowPrice,
      });
    }
  }
}
```

---

## 2. Gap #2: Social Signal Data

### The Problem

No social data is currently collected. The Sentiment model needs:
- Twitter/X mentions and sentiment
- YouTube video views for card-related content
- Reddit discussion volume and sentiment

### Solution: Multi-Platform Collection

| Platform | Method | Cost | Data Quality |
|----------|--------|------|--------------|
| **YouTube** | Official API | Free (10k quota/day) | Excellent |
| **Reddit** | PRAW (Official API) | Free (100 req/min) | Excellent |
| **Twitter/X** | Apify scraper | ~$30-50/mo | Good |

**Total**: ~$30-50/month

### Implementation

#### YouTube Data Collection

```typescript
// src/collectors/youtube-collector.ts

import { google } from 'googleapis';

interface YouTubeConfig {
  apiKey: string;
}

interface VideoSignal {
  videoId: string;
  title: string;
  channelId: string;
  channelTitle: string;
  publishedAt: Date;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  cardMentions: string[];  // Extracted card names
}

export class YouTubeCollector {
  private youtube;
  private dailyQuotaUsed = 0;
  private readonly DAILY_QUOTA = 10000;

  constructor(config: YouTubeConfig) {
    this.youtube = google.youtube({
      version: 'v3',
      auth: config.apiKey,
    });
  }

  /**
   * Search for TCG-related videos.
   *
   * Quota cost: 100 units per search
   * With 10k daily quota: ~100 searches/day
   */
  async searchTCGVideos(
    game: 'onepiece' | 'pokemon' | 'mtg',
    hours: number = 24
  ): Promise<VideoSignal[]> {
    const queries = {
      onepiece: ['one piece tcg opening', 'optcg market', 'one piece card pull'],
      pokemon: ['pokemon tcg opening', 'pokemon card pull', 'pokemon tcg market'],
      mtg: ['mtg opening', 'magic the gathering market', 'mtg finance'],
    };

    const results: VideoSignal[] = [];
    const publishedAfter = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

    for (const query of queries[game]) {
      if (this.dailyQuotaUsed >= this.DAILY_QUOTA - 200) {
        console.warn('YouTube quota nearly exhausted, stopping searches');
        break;
      }

      try {
        // Search costs 100 quota
        const searchResponse = await this.youtube.search.list({
          part: ['snippet'],
          q: query,
          type: ['video'],
          publishedAfter,
          maxResults: 25,
          order: 'viewCount',
        });
        this.dailyQuotaUsed += 100;

        const videoIds = searchResponse.data.items
          ?.map(item => item.id?.videoId)
          .filter(Boolean) as string[];

        if (videoIds.length > 0) {
          // Get stats costs 1 quota per video
          const statsResponse = await this.youtube.videos.list({
            part: ['statistics'],
            id: videoIds,
          });
          this.dailyQuotaUsed += videoIds.length;

          const statsMap = new Map(
            statsResponse.data.items?.map(v => [v.id, v.statistics]) || []
          );

          for (const item of searchResponse.data.items || []) {
            const videoId = item.id?.videoId;
            if (!videoId) continue;

            const stats = statsMap.get(videoId);
            results.push({
              videoId,
              title: item.snippet?.title || '',
              channelId: item.snippet?.channelId || '',
              channelTitle: item.snippet?.channelTitle || '',
              publishedAt: new Date(item.snippet?.publishedAt || ''),
              viewCount: parseInt(stats?.viewCount || '0'),
              likeCount: parseInt(stats?.likeCount || '0'),
              commentCount: parseInt(stats?.commentCount || '0'),
              cardMentions: this.extractCardMentions(item.snippet?.title || ''),
            });
          }
        }
      } catch (error) {
        console.error(`YouTube search error for "${query}":`, error);
      }
    }

    return results;
  }

  /**
   * Extract card names from video titles.
   * Uses pattern matching against known card database.
   */
  private extractCardMentions(title: string): string[] {
    // This would match against your CardPriceV2 table
    // For now, return empty - implement with card name lookup
    return [];
  }

  /**
   * Get remaining daily quota.
   */
  getRemainingQuota(): number {
    return this.DAILY_QUOTA - this.dailyQuotaUsed;
  }

  /**
   * Reset quota counter (call at midnight PT).
   */
  resetQuota(): void {
    this.dailyQuotaUsed = 0;
  }
}
```

#### Reddit Data Collection

```python
# src/collectors/reddit_collector.py

import praw
from datetime import datetime, timedelta
from typing import List, Dict, Optional
import re

class RedditCollector:
    """
    Reddit data collection using PRAW.

    Rate limits: 100 requests/minute with OAuth
    Cost: Free
    """

    SUBREDDITS = {
        'onepiece': ['OnePieceTCG', 'OnePieceCard'],
        'pokemon': ['PokemonTCG', 'pokemoncardcollectors', 'PokeInvesting', 'pokemontrades'],
        'mtg': ['magicTCG', 'mtgfinance', 'EDH', 'ModernMagic'],
        'yugioh': ['yugioh', 'YuGiOhMasterDuel', 'yugiohshowcase'],
    }

    def __init__(self, client_id: str, client_secret: str, user_agent: str):
        self.reddit = praw.Reddit(
            client_id=client_id,
            client_secret=client_secret,
            user_agent=user_agent,
        )

    def collect_posts(
        self,
        game: str,
        hours: int = 24,
        limit_per_sub: int = 100
    ) -> List[Dict]:
        """
        Collect recent posts from game-specific subreddits.
        """
        results = []
        cutoff = datetime.utcnow() - timedelta(hours=hours)

        for subreddit_name in self.SUBREDDITS.get(game, []):
            try:
                subreddit = self.reddit.subreddit(subreddit_name)

                for post in subreddit.new(limit=limit_per_sub):
                    post_time = datetime.utcfromtimestamp(post.created_utc)
                    if post_time < cutoff:
                        continue

                    results.append({
                        'platform': 'reddit',
                        'external_id': post.id,
                        'subreddit': subreddit_name,
                        'title': post.title,
                        'content': post.selftext or '',
                        'author': str(post.author) if post.author else None,
                        'score': post.score,  # upvotes - downvotes
                        'upvote_ratio': post.upvote_ratio,
                        'num_comments': post.num_comments,
                        'url': f'https://reddit.com{post.permalink}',
                        'posted_at': post_time,
                        'flair': post.link_flair_text,
                        'is_price_discussion': self._is_price_discussion(post),
                    })
            except Exception as e:
                print(f"Error collecting from r/{subreddit_name}: {e}")

        return results

    def collect_comments(
        self,
        post_ids: List[str],
        limit_per_post: int = 50
    ) -> List[Dict]:
        """
        Collect comments from specific posts for deeper sentiment analysis.
        """
        results = []

        for post_id in post_ids:
            try:
                submission = self.reddit.submission(id=post_id)
                submission.comments.replace_more(limit=0)  # Don't expand "more comments"

                for comment in submission.comments[:limit_per_post]:
                    results.append({
                        'platform': 'reddit',
                        'external_id': comment.id,
                        'parent_post_id': post_id,
                        'content': comment.body,
                        'author': str(comment.author) if comment.author else None,
                        'score': comment.score,
                        'posted_at': datetime.utcfromtimestamp(comment.created_utc),
                    })
            except Exception as e:
                print(f"Error collecting comments for {post_id}: {e}")

        return results

    def _is_price_discussion(self, post) -> bool:
        """Check if post is about prices/market."""
        price_keywords = [
            'price', 'value', 'worth', 'sell', 'buy', 'market',
            'spike', 'crash', 'investment', 'trade', 'deal',
        ]
        text = f"{post.title} {post.selftext or ''}".lower()
        return any(kw in text for kw in price_keywords)

    def search_card_mentions(
        self,
        card_name: str,
        game: str,
        days: int = 7
    ) -> List[Dict]:
        """
        Search for mentions of a specific card across subreddits.
        """
        results = []

        for subreddit_name in self.SUBREDDITS.get(game, []):
            try:
                subreddit = self.reddit.subreddit(subreddit_name)

                for post in subreddit.search(
                    card_name,
                    time_filter='week' if days <= 7 else 'month',
                    limit=50
                ):
                    results.append({
                        'platform': 'reddit',
                        'external_id': post.id,
                        'subreddit': subreddit_name,
                        'title': post.title,
                        'score': post.score,
                        'num_comments': post.num_comments,
                        'posted_at': datetime.utcfromtimestamp(post.created_utc),
                        'card_name': card_name,
                    })
            except Exception as e:
                print(f"Error searching r/{subreddit_name} for '{card_name}': {e}")

        return results
```

#### Twitter/X via Apify

```typescript
// src/collectors/twitter-apify-collector.ts

import { ApifyClient } from 'apify-client';

interface ApifyConfig {
  token: string;
}

interface TweetData {
  tweetId: string;
  authorId: string;
  authorUsername: string;
  authorFollowers: number;
  content: string;
  likes: number;
  retweets: number;
  replies: number;
  postedAt: Date;
}

export class TwitterApifyCollector {
  private client: ApifyClient;
  private actorId = 'apidojo/tweet-scraper';  // Or similar Twitter scraper

  constructor(config: ApifyConfig) {
    this.client = new ApifyClient({ token: config.token });
  }

  /**
   * Search for TCG-related tweets.
   *
   * Cost: ~$0.50-1.00 per 1000 tweets (Apify pay-as-you-go)
   */
  async searchTweets(
    query: string,
    maxTweets: number = 500
  ): Promise<TweetData[]> {
    const run = await this.client.actor(this.actorId).call({
      searchTerms: [query],
      maxTweets,
      addUserInfo: true,
      scrapeTweetReplies: false,
    });

    const { items } = await this.client.dataset(run.defaultDatasetId).listItems();

    return items.map((tweet: any) => ({
      tweetId: tweet.id,
      authorId: tweet.author?.id,
      authorUsername: tweet.author?.userName,
      authorFollowers: tweet.author?.followers || 0,
      content: tweet.text,
      likes: tweet.likeCount || 0,
      retweets: tweet.retweetCount || 0,
      replies: tweet.replyCount || 0,
      postedAt: new Date(tweet.createdAt),
    }));
  }

  /**
   * Build TCG-specific search queries.
   */
  buildQuery(game: string): string {
    const gameTerms: Record<string, string> = {
      onepiece: '(optcg OR "one piece tcg" OR "one piece card game") (price OR pull OR market OR sell)',
      pokemon: '(pokemon tcg OR ptcg) (price OR pull OR market OR sell)',
      mtg: '(mtg OR "magic the gathering") (spike OR price OR market)',
    };
    return `${gameTerms[game] || game} -is:retweet lang:en`;
  }

  /**
   * Estimated monthly cost for TCG monitoring.
   *
   * Assumption: 3 games × 500 tweets/day = 1500 tweets/day
   * Cost: ~1500 × 30 × $0.001 = ~$45/month
   */
  getEstimatedMonthlyCost(): number {
    return 45;
  }
}
```

### Social Signal Database Schema

```sql
CREATE TABLE social_mentions (
    id BIGSERIAL PRIMARY KEY,

    -- Source identification
    platform VARCHAR(20) NOT NULL,  -- 'twitter', 'youtube', 'reddit'
    external_id VARCHAR(100) NOT NULL,

    -- Content
    content TEXT,
    title VARCHAR(500),  -- For YouTube/Reddit
    url TEXT,

    -- Author info
    author_id VARCHAR(100),
    author_name VARCHAR(255),
    author_followers INTEGER,

    -- Engagement metrics
    views INTEGER DEFAULT 0,        -- YouTube
    likes INTEGER DEFAULT 0,
    retweets INTEGER DEFAULT 0,     -- Twitter
    comments INTEGER DEFAULT 0,
    score INTEGER DEFAULT 0,        -- Reddit upvotes
    upvote_ratio DECIMAL(3, 2),     -- Reddit

    -- Card matching
    card_id VARCHAR(50),            -- Matched card (nullable)
    card_name_raw VARCHAR(255),     -- Original text for matching
    game VARCHAR(20),

    -- Sentiment (computed)
    sentiment_score DECIMAL(4, 3),
    sentiment_label VARCHAR(20),

    -- Timestamps
    posted_at TIMESTAMPTZ NOT NULL,
    collected_at TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT uq_social_mention UNIQUE (platform, external_id)
);

CREATE INDEX idx_social_card ON social_mentions (card_id, posted_at DESC) WHERE card_id IS NOT NULL;
CREATE INDEX idx_social_game ON social_mentions (game, posted_at DESC);
CREATE INDEX idx_social_unmatched ON social_mentions (platform, collected_at DESC) WHERE card_id IS NULL;
```

---

## 3. Gap #3: Tournament Data

### The Problem

No tournament results or decklists collected. The Meta model needs:
- Tournament results (placings, deck archetypes)
- Decklists with card quantities
- Meta share trends over time

### Solution: Limitless TCG API

**Cost**: Free with API key (request access)
**Coverage**: Pokemon, One Piece, Digimon, Dragon Ball, Lorcana, and more

### Implementation

```typescript
// src/collectors/limitless-collector.ts

interface LimitlessConfig {
  apiKey: string;
  baseUrl?: string;
}

interface Tournament {
  id: string;
  name: string;
  game: string;
  date: Date;
  format: string;
  playerCount: number;
}

interface TournamentDeck {
  tournamentId: string;
  playerId: string;
  playerName: string;
  placement: number;
  deckArchetype: string;
  cards: Array<{
    cardId: string;
    cardName: string;
    quantity: number;
  }>;
}

export class LimitlessCollector {
  private apiKey: string;
  private baseUrl: string;

  constructor(config: LimitlessConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || 'https://api.limitlesstcg.com';
  }

  /**
   * Fetch recent tournaments for a game.
   */
  async getTournaments(game: string, days: number = 30): Promise<Tournament[]> {
    const response = await fetch(
      `${this.baseUrl}/tournaments?game=${game}&key=${this.apiKey}`
    );

    if (!response.ok) {
      throw new Error(`Limitless API error: ${response.statusText}`);
    }

    const data = await response.json();
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    return data.tournaments
      .filter((t: any) => new Date(t.date) >= cutoff)
      .map((t: any) => ({
        id: t.id,
        name: t.name,
        game: t.game,
        date: new Date(t.date),
        format: t.format,
        playerCount: t.players,
      }));
  }

  /**
   * Fetch top cut decklists from a tournament.
   */
  async getTopDecks(tournamentId: string, topN: number = 8): Promise<TournamentDeck[]> {
    const response = await fetch(
      `${this.baseUrl}/tournaments/${tournamentId}/standings?key=${this.apiKey}`
    );

    if (!response.ok) {
      throw new Error(`Limitless API error: ${response.statusText}`);
    }

    const data = await response.json();

    const decks: TournamentDeck[] = [];
    for (const standing of data.standings.slice(0, topN)) {
      if (standing.decklist) {
        const deckResponse = await fetch(
          `${this.baseUrl}/decklists/${standing.decklist}?key=${this.apiKey}`
        );
        const deckData = await deckResponse.json();

        decks.push({
          tournamentId,
          playerId: standing.playerId,
          playerName: standing.name,
          placement: standing.placement,
          deckArchetype: deckData.archetype || 'Unknown',
          cards: deckData.cards.map((c: any) => ({
            cardId: c.id,
            cardName: c.name,
            quantity: c.count,
          })),
        });
      }
    }

    return decks;
  }

  /**
   * Calculate meta shares for cards.
   */
  async calculateMetaShares(
    game: string,
    days: number = 30
  ): Promise<Map<string, MetaShare>> {
    const tournaments = await this.getTournaments(game, days);
    const cardCounts = new Map<string, { decks: number; top8: number; totalCopies: number }>();

    let totalDecks = 0;
    let totalTop8Decks = 0;

    for (const tournament of tournaments) {
      const decks = await this.getTopDecks(tournament.id, 32);  // Top 32

      for (const deck of decks) {
        totalDecks++;
        if (deck.placement <= 8) totalTop8Decks++;

        for (const card of deck.cards) {
          const current = cardCounts.get(card.cardId) || { decks: 0, top8: 0, totalCopies: 0 };
          current.decks++;
          current.totalCopies += card.quantity;
          if (deck.placement <= 8) current.top8++;
          cardCounts.set(card.cardId, current);
        }
      }
    }

    const metaShares = new Map<string, MetaShare>();
    for (const [cardId, counts] of cardCounts) {
      metaShares.set(cardId, {
        cardId,
        deckInclusionRate: counts.decks / totalDecks,
        top8Rate: counts.top8 / totalTop8Decks,
        avgCopiesPerDeck: counts.totalCopies / counts.decks,
        totalDecksAnalyzed: totalDecks,
      });
    }

    return metaShares;
  }
}

interface MetaShare {
  cardId: string;
  deckInclusionRate: number;
  top8Rate: number;
  avgCopiesPerDeck: number;
  totalDecksAnalyzed: number;
}
```

### Tournament Database Schema

```sql
CREATE TABLE tournaments (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    game VARCHAR(20) NOT NULL,
    date DATE NOT NULL,
    format VARCHAR(50),
    player_count INTEGER,
    source VARCHAR(50) DEFAULT 'limitless',
    collected_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE tournament_decks (
    id SERIAL PRIMARY KEY,
    tournament_id VARCHAR(50) REFERENCES tournaments(id),
    player_id VARCHAR(100),
    player_name VARCHAR(255),
    placement INTEGER NOT NULL,
    deck_archetype VARCHAR(100),
    CONSTRAINT uq_deck UNIQUE (tournament_id, player_id)
);

CREATE TABLE deck_cards (
    id SERIAL PRIMARY KEY,
    deck_id INTEGER REFERENCES tournament_decks(id),
    card_id VARCHAR(50) NOT NULL,
    card_name VARCHAR(255),
    quantity INTEGER NOT NULL DEFAULT 1
);

-- Meta analysis view
CREATE MATERIALIZED VIEW card_meta_stats AS
SELECT
    dc.card_id,
    t.game,
    DATE_TRUNC('week', t.date) as week,
    COUNT(DISTINCT td.id) as deck_count,
    COUNT(DISTINCT td.id) FILTER (WHERE td.placement <= 8) as top8_count,
    COUNT(DISTINCT t.id) as tournament_count,
    AVG(dc.quantity) as avg_copies,
    SUM(dc.quantity) as total_copies
FROM deck_cards dc
JOIN tournament_decks td ON dc.deck_id = td.id
JOIN tournaments t ON td.tournament_id = t.id
WHERE t.date >= NOW() - INTERVAL '90 days'
GROUP BY dc.card_id, t.game, DATE_TRUNC('week', t.date);

CREATE INDEX idx_meta_stats_card ON card_meta_stats (card_id, week DESC);
```

---

## 4. Gap #4: Cross-Platform Price Sync

### The Problem

Current pipeline collects TCGplayer prices only. Arbitrage model needs:
- Cardmarket (EUR) prices synchronized
- Same cards matched across platforms
- Currency conversion with real FX rates

### Solution: Cardmarket Apify Scraper + Card Matching

**Cost**: $20/month (Apify Cardmarket scraper)

### Implementation

```typescript
// src/collectors/cardmarket-collector.ts

import { ApifyClient } from 'apify-client';

interface CardmarketPrice {
  cardId: string;
  cardmarketId: string;
  name: string;
  setCode: string;
  priceEur: number;
  trendEur: number;
  avg7dEur: number;
  avg30dEur: number;
  lowEur: number;
  sellers: Array<{
    sellerId: string;
    sellerName: string;
    price: number;
    condition: string;
    quantity: number;
    country: string;
  }>;
}

export class CardmarketCollector {
  private apify: ApifyClient;
  private actorId = 'ecomscrape/cardmarket-card-page-details-scraper';

  constructor(apifyToken: string) {
    this.apify = new ApifyClient({ token: apifyToken });
  }

  /**
   * Scrape Cardmarket prices for a list of cards.
   *
   * Cost: ~$20/month for moderate usage
   */
  async scrapeCards(cardUrls: string[]): Promise<CardmarketPrice[]> {
    const run = await this.apify.actor(this.actorId).call({
      startUrls: cardUrls.map(url => ({ url })),
      max_retries_per_url: 2,
    });

    const { items } = await this.apify.dataset(run.defaultDatasetId).listItems();

    return items.map((item: any) => ({
      cardmarketId: item.id,
      cardId: '', // Will be matched later
      name: item.title,
      setCode: this.extractSetCode(item.title),
      priceEur: this.parsePrice(item.averagePriceLine?.current),
      trendEur: this.parsePrice(item.averagePriceLine?.trend),
      avg7dEur: this.parsePrice(item.averagePriceLine?.['7d']),
      avg30dEur: this.parsePrice(item.averagePriceLine?.['30d']),
      lowEur: Math.min(...(item.sellerData?.map((s: any) => s.price) || [Infinity])),
      sellers: (item.sellerData || []).map((s: any) => ({
        sellerId: s.sellerId,
        sellerName: s.sellerName,
        price: this.parsePrice(s.price),
        condition: s.condition,
        quantity: s.quantity || 1,
        country: s.country,
      })),
    }));
  }

  /**
   * Match Cardmarket cards to TCGplayer cards.
   *
   * Matching strategy:
   * 1. Exact name + set code match
   * 2. Fuzzy name match with set code
   * 3. Manual mapping table for known mismatches
   */
  async matchToTcgplayer(
    cardmarketPrices: CardmarketPrice[],
    tcgplayerCards: Map<string, any>
  ): Promise<Map<string, CrossPlatformPrice>> {
    const matched = new Map<string, CrossPlatformPrice>();

    for (const cmCard of cardmarketPrices) {
      // Try exact match first
      const normalizedName = this.normalizeName(cmCard.name);
      const tcgCard = tcgplayerCards.get(normalizedName);

      if (tcgCard) {
        matched.set(tcgCard.cardId, {
          cardId: tcgCard.cardId,
          name: tcgCard.name,
          tcgplayerPriceUsd: tcgCard.marketPrice,
          cardmarketPriceEur: cmCard.priceEur,
          cardmarketTrendEur: cmCard.trendEur,
          lastUpdated: new Date(),
        });
      } else {
        // Log unmatched for manual review
        console.log(`Unmatched Cardmarket card: ${cmCard.name}`);
      }
    }

    return matched;
  }

  private normalizeName(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .replace(/\s+/g, '');
  }

  private extractSetCode(title: string): string {
    // Extract set code from title like "Card Name (SET-123)"
    const match = title.match(/\(([A-Z0-9-]+)\)/);
    return match ? match[1] : '';
  }

  private parsePrice(value: any): number {
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
      return parseFloat(value.replace(/[^0-9.]/g, '')) || 0;
    }
    return 0;
  }
}

interface CrossPlatformPrice {
  cardId: string;
  name: string;
  tcgplayerPriceUsd: number;
  cardmarketPriceEur: number;
  cardmarketTrendEur: number;
  lastUpdated: Date;
}
```

### Cross-Platform Price Table

```sql
CREATE TABLE cross_platform_prices (
    card_id VARCHAR(50) PRIMARY KEY,

    -- TCGplayer (USD)
    tcgplayer_market_usd DECIMAL(10, 2),
    tcgplayer_low_usd DECIMAL(10, 2),
    tcgplayer_updated_at TIMESTAMPTZ,

    -- Cardmarket (EUR)
    cardmarket_id VARCHAR(50),
    cardmarket_trend_eur DECIMAL(10, 2),
    cardmarket_low_eur DECIMAL(10, 2),
    cardmarket_avg_7d_eur DECIMAL(10, 2),
    cardmarket_updated_at TIMESTAMPTZ,

    -- Calculated arbitrage
    fx_rate_eur_usd DECIMAL(8, 6),
    price_diff_pct DECIMAL(5, 4) GENERATED ALWAYS AS (
        (tcgplayer_market_usd - (cardmarket_trend_eur * fx_rate_eur_usd))
        / NULLIF(cardmarket_trend_eur * fx_rate_eur_usd, 0)
    ) STORED,

    -- Timestamps
    last_synced_at TIMESTAMPTZ DEFAULT NOW()
);

-- View for arbitrage opportunities
CREATE VIEW arbitrage_opportunities AS
SELECT
    cpp.*,
    c.name,
    c.set_code,
    CASE
        WHEN cpp.price_diff_pct > 0.15 THEN 'BUY_CARDMARKET'
        WHEN cpp.price_diff_pct < -0.15 THEN 'BUY_TCGPLAYER'
        ELSE 'NO_OPPORTUNITY'
    END as recommendation
FROM cross_platform_prices cpp
JOIN card_price_v2 c ON cpp.card_id = c.card_id
WHERE ABS(cpp.price_diff_pct) > 0.15
ORDER BY ABS(cpp.price_diff_pct) DESC;
```

---

## 5. Gap #5: Feature Store

### The Problem

No pre-computed features for real-time inference. Models need features available in <100ms.

### Solution: Redis Cloud + Feature Computation Jobs

**Cost**: $5-50/month depending on data size

### Implementation

```typescript
// src/features/redis-feature-store.ts

import Redis from 'ioredis';

interface FeatureStoreConfig {
  redisUrl: string;
  defaultTtl: number;  // seconds
}

interface CardFeatures {
  // Price features
  marketPrice: number;
  lowPrice: number;
  highPrice: number;
  trend7d: number;
  trend30d: number;
  volatility30d: number;

  // Social features
  buzzScore: number;
  sentiment: number;
  twitterVolume24h: number;
  youtubeViews24h: number;

  // Meta features
  deckInclusionRate: number;
  top8Rate: number;

  // Cross-platform
  tcgplayerPriceUsd: number;
  cardmarketPriceEur: number;
  arbitrageSpread: number;

  // Timestamps
  priceUpdatedAt: number;
  socialUpdatedAt: number;
  metaUpdatedAt: number;
}

export class RedisFeatureStore {
  private redis: Redis;
  private defaultTtl: number;

  constructor(config: FeatureStoreConfig) {
    this.redis = new Redis(config.redisUrl);
    this.defaultTtl = config.defaultTtl;
  }

  /**
   * Get all features for a card.
   *
   * Latency: <10ms typical
   */
  async getFeatures(cardId: string): Promise<CardFeatures | null> {
    const data = await this.redis.hgetall(`features:${cardId}`);
    if (!data || Object.keys(data).length === 0) return null;

    return {
      marketPrice: parseFloat(data.marketPrice || '0'),
      lowPrice: parseFloat(data.lowPrice || '0'),
      highPrice: parseFloat(data.highPrice || '0'),
      trend7d: parseFloat(data.trend7d || '0'),
      trend30d: parseFloat(data.trend30d || '0'),
      volatility30d: parseFloat(data.volatility30d || '0'),
      buzzScore: parseFloat(data.buzzScore || '0'),
      sentiment: parseFloat(data.sentiment || '0'),
      twitterVolume24h: parseInt(data.twitterVolume24h || '0'),
      youtubeViews24h: parseInt(data.youtubeViews24h || '0'),
      deckInclusionRate: parseFloat(data.deckInclusionRate || '0'),
      top8Rate: parseFloat(data.top8Rate || '0'),
      tcgplayerPriceUsd: parseFloat(data.tcgplayerPriceUsd || '0'),
      cardmarketPriceEur: parseFloat(data.cardmarketPriceEur || '0'),
      arbitrageSpread: parseFloat(data.arbitrageSpread || '0'),
      priceUpdatedAt: parseInt(data.priceUpdatedAt || '0'),
      socialUpdatedAt: parseInt(data.socialUpdatedAt || '0'),
      metaUpdatedAt: parseInt(data.metaUpdatedAt || '0'),
    };
  }

  /**
   * Update price features.
   */
  async setPriceFeatures(cardId: string, features: Partial<CardFeatures>): Promise<void> {
    await this.redis.hset(`features:${cardId}`, {
      ...features,
      priceUpdatedAt: Date.now(),
    });
    await this.redis.expire(`features:${cardId}`, this.defaultTtl);
  }

  /**
   * Update social features.
   */
  async setSocialFeatures(cardId: string, features: Partial<CardFeatures>): Promise<void> {
    await this.redis.hset(`features:${cardId}`, {
      ...features,
      socialUpdatedAt: Date.now(),
    });
  }

  /**
   * Batch get features for multiple cards.
   */
  async batchGetFeatures(cardIds: string[]): Promise<Map<string, CardFeatures>> {
    const pipeline = this.redis.pipeline();
    for (const cardId of cardIds) {
      pipeline.hgetall(`features:${cardId}`);
    }

    const results = await pipeline.exec();
    const features = new Map<string, CardFeatures>();

    for (let i = 0; i < cardIds.length; i++) {
      const [err, data] = results?.[i] || [null, null];
      if (!err && data && Object.keys(data as object).length > 0) {
        features.set(cardIds[i], this.parseFeatures(data as Record<string, string>));
      }
    }

    return features;
  }

  private parseFeatures(data: Record<string, string>): CardFeatures {
    return {
      marketPrice: parseFloat(data.marketPrice || '0'),
      lowPrice: parseFloat(data.lowPrice || '0'),
      highPrice: parseFloat(data.highPrice || '0'),
      trend7d: parseFloat(data.trend7d || '0'),
      trend30d: parseFloat(data.trend30d || '0'),
      volatility30d: parseFloat(data.volatility30d || '0'),
      buzzScore: parseFloat(data.buzzScore || '0'),
      sentiment: parseFloat(data.sentiment || '0'),
      twitterVolume24h: parseInt(data.twitterVolume24h || '0'),
      youtubeViews24h: parseInt(data.youtubeViews24h || '0'),
      deckInclusionRate: parseFloat(data.deckInclusionRate || '0'),
      top8Rate: parseFloat(data.top8Rate || '0'),
      tcgplayerPriceUsd: parseFloat(data.tcgplayerPriceUsd || '0'),
      cardmarketPriceEur: parseFloat(data.cardmarketPriceEur || '0'),
      arbitrageSpread: parseFloat(data.arbitrageSpread || '0'),
      priceUpdatedAt: parseInt(data.priceUpdatedAt || '0'),
      socialUpdatedAt: parseInt(data.socialUpdatedAt || '0'),
      metaUpdatedAt: parseInt(data.metaUpdatedAt || '0'),
    };
  }
}
```

---

## 6. Implementation Roadmap

### Phase 1: Data Infrastructure (Week 1-2)

```
Week 1:
├── Day 1-2: Set up TCGAPIs account (Unlimited tier)
│   ├── Request API key
│   ├── Test listing endpoints
│   └── Verify data quality
├── Day 3-4: Deploy listing collector
│   ├── Create card_listings table
│   ├── Implement TCGApisListingCollector
│   └── Set up 15-minute cron job
└── Day 5-7: Deploy Redis feature store
    ├── Set up Redis Cloud instance
    ├── Implement RedisFeatureStore
    └── Create feature computation jobs

Week 2:
├── Day 1-3: Social signal collection
│   ├── Set up YouTube API key
│   ├── Set up Reddit API credentials
│   ├── Set up Apify account for Twitter
│   └── Deploy collectors
├── Day 4-5: Tournament data collection
│   ├── Request Limitless API key
│   ├── Deploy LimitlessCollector
│   └── Set up weekly sync job
└── Day 6-7: Cross-platform sync
    ├── Set up Cardmarket scraper on Apify
    ├── Implement card matching logic
    └── Deploy daily sync job
```

### Phase 2: Training Data Generation (Week 3-4)

```
Week 3:
├── Monitor data collection quality
├── Fix any collection bugs
├── Build training data export pipelines
└── Generate first Sniper training dataset

Week 4:
├── Train initial Sniper model (10k+ listings)
├── Backtest on held-out data
├── Deploy to staging (shadow mode)
└── Begin social signal aggregation
```

### Phase 3: Model Deployment (Week 5-6)

```
Week 5:
├── Evaluate Sniper model in shadow mode
├── Train Sentiment model (if 5k+ social samples)
├── Build alert engine integration
└── Create Discord alert bot

Week 6:
├── Enable Sniper alerts (production)
├── Monitor alert quality
├── Iterate on thresholds
└── Plan Meta model training
```

---

## 7. Cost Summary

### Monthly Operating Costs

| Service | Tier | Monthly Cost |
|---------|------|--------------|
| **TCGAPIs** | Unlimited | £499 (~$630) |
| **Apify** | Pay-as-you-go | ~$50 |
| **Redis Cloud** | 250MB tier | $5-15 |
| **YouTube API** | Free | $0 |
| **Reddit API** | Free | $0 |
| **Limitless API** | Free | $0 |
| **AWS/Vercel** | Existing | $0 (incremental) |
| **Total** | | **~$700/month** |

### Cost-Optimized Alternative

If budget is constrained, start with Business tier:

| Service | Tier | Monthly Cost |
|---------|------|--------------|
| **TCGAPIs** | Business | £199 (~$250) |
| **Apify** | Minimal | ~$30 |
| **Redis Cloud** | Free tier | $0 |
| **Total** | | **~$280/month** |

Trade-off: No live listings (hourly only), smaller dataset.

---

## 8. Success Metrics

### Data Collection Targets

| Metric | Week 2 Target | Week 4 Target |
|--------|---------------|---------------|
| **Listings tracked** | 10,000 | 50,000 |
| **Listings with outcomes** | 2,000 | 20,000 |
| **Social mentions/day** | 500 | 2,000 |
| **Tournament decks** | 200 | 1,000 |
| **Cards with cross-platform prices** | 500 | 2,000 |

### Model Training Readiness

| Model | Data Required | Target Date |
|-------|--------------|-------------|
| **Sniper** | 10k listings with outcomes | Week 4 |
| **Sentiment** | 5k social mentions | Week 6 |
| **Arbitrage** | 2k cross-platform pairs | Week 4 |
| **Meta** | 500 tournament decks | Week 8 |

---

## References

- [TCGAPIs Documentation](https://tcgapis.com/)
- [Limitless TCG Developer Docs](https://docs.limitlesstcg.com/developer.html)
- [YouTube Data API Quota Calculator](https://developers.google.com/youtube/v3/determine_quota_cost)
- [Reddit API via PRAW](https://praw.readthedocs.io/)
- [Apify Marketplace](https://apify.com/store)
- [Redis Cloud Pricing](https://redis.com/redis-enterprise-cloud/pricing/)
