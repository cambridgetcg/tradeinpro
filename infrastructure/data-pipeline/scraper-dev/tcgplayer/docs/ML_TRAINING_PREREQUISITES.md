# ML Training Prerequisites & Workflow

> **Purpose**: Practical guide for collecting data and training the value extraction models
> **Status**: Prerequisites checklist and implementation guide

---

## 1. Training Prerequisites Overview

### The Cold Start Problem

**You cannot train ML models without historical data.** Each model requires weeks to months of data collection before training can begin.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         DATA COLLECTION TIMELINE                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   Model              Minimum Data        Ideal Data        Can Train After  │
│   ─────────────────────────────────────────────────────────────────────────  │
│   Sniper             2 weeks listings    8 weeks           Week 2           │
│   Sentiment          4 weeks social      12 weeks          Week 4           │
│   Arbitrage          2 weeks prices      8 weeks           Week 2           │
│   Meta               8 weeks tournaments 6 months          Week 8           │
│   Condition          1000 graded images  5000 images       Immediate*       │
│   Trade-In           4 weeks history     12 weeks          Week 4           │
│                                                                              │
│   * Can use public graded card datasets to bootstrap                        │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Current State Assessment

**What you have now:**
- ✅ Price collection pipeline (OPTCG, Pokemon, Scryfall APIs)
- ✅ Price history tracking (`PriceHistory` table)
- ✅ Basic ML export function (`exportForML()`)
- ✅ Card metadata (name, set, rarity, variant)

**What you need to build:**
- ❌ Listing-level data collection (individual listings, not just market prices)
- ❌ Social signal collection pipeline (Twitter, YouTube, Reddit)
- ❌ Tournament result scraping
- ❌ Listing outcome tracking (did it sell? how fast?)
- ❌ Cross-platform price sync (TCGplayer + Cardmarket aligned)
- ❌ Feature store for real-time inference

---

## 2. Data Collection Requirements

### 2.1 Listing-Level Data (for Sniper Model)

**Current Gap**: You collect market prices, not individual listings. The Sniper model needs to see *every listing* to find underpriced ones.

**Required Schema:**

```sql
CREATE TABLE listings (
    id SERIAL PRIMARY KEY,
    card_id VARCHAR(50) NOT NULL,
    platform VARCHAR(20) NOT NULL,  -- 'tcgplayer', 'cardmarket', 'ebay'

    -- Listing details
    listing_price DECIMAL(10, 2) NOT NULL,
    condition VARCHAR(20),
    seller_id VARCHAR(100),
    seller_rating DECIMAL(3, 2),
    seller_sales_count INTEGER,
    has_photo BOOLEAN DEFAULT FALSE,
    shipping_cost DECIMAL(6, 2),

    -- For training labels
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sold_at TIMESTAMPTZ,  -- NULL if still available
    time_to_sell_minutes INTEGER,  -- Calculated when sold

    -- Market context at time of listing
    market_price_at_listing DECIMAL(10, 2),
    low_price_at_listing DECIMAL(10, 2),

    -- Indexes
    CONSTRAINT idx_listings_card_platform UNIQUE (card_id, platform, listing_price, seller_id)
);

CREATE INDEX idx_listings_unsold ON listings (card_id) WHERE sold_at IS NULL;
CREATE INDEX idx_listings_recent ON listings (first_seen_at DESC);
```

**Collection Strategy:**

```typescript
// src/collectors/listing-collector.ts

interface ListingSnapshot {
  cardId: string;
  platform: 'tcgplayer' | 'cardmarket' | 'ebay';
  listings: Array<{
    price: number;
    condition: string;
    sellerId: string;
    sellerRating: number;
    sellerSales: number;
    hasPhoto: boolean;
    shippingCost: number;
  }>;
  marketPrice: number;
  lowPrice: number;
  collectedAt: Date;
}

class ListingCollector {
  /**
   * Collect listings for a card and detect changes.
   *
   * Run every 5-15 minutes for hot cards, hourly for others.
   */
  async collectAndTrack(cardId: string, platform: string): Promise<void> {
    const currentListings = await this.fetchListings(cardId, platform);
    const previousListings = await this.db.getActiveListings(cardId, platform);

    // Find new listings
    for (const listing of currentListings) {
      const key = `${listing.sellerId}-${listing.price}`;
      if (!previousListings.has(key)) {
        await this.db.insertListing({
          ...listing,
          cardId,
          platform,
          marketPriceAtListing: await this.getMarketPrice(cardId),
          lowPriceAtListing: await this.getLowPrice(cardId),
        });
      }
    }

    // Find sold listings (were in DB, not in current)
    for (const [key, dbListing] of previousListings) {
      if (!currentListings.has(key)) {
        await this.db.markListingSold(dbListing.id, new Date());
      }
    }
  }

  /**
   * Generate training labels from listing outcomes.
   */
  async generateTrainingData(): Promise<SniperTrainingExample[]> {
    const listings = await this.db.getListingsWithOutcomes();

    return listings.map(listing => ({
      // Features
      listingPrice: listing.listing_price,
      marketPrice: listing.market_price_at_listing,
      lowPrice: listing.low_price_at_listing,
      discountFromMarket: (listing.market_price_at_listing - listing.listing_price)
                          / listing.market_price_at_listing,
      discountFromLow: (listing.low_price_at_listing - listing.listing_price)
                       / listing.low_price_at_listing,
      sellerRating: listing.seller_rating,
      sellerSalesCount: listing.seller_sales_count,
      hasPhoto: listing.has_photo,
      condition: listing.condition,

      // Label: sold within 1 hour = underpriced
      label: listing.time_to_sell_minutes !== null && listing.time_to_sell_minutes < 60 ? 1 : 0,

      // Continuous label for regression
      timeToSellMinutes: listing.time_to_sell_minutes,
    }));
  }
}
```

### 2.2 Social Signal Data (for Sentiment Model)

**Required Schema:**

```sql
CREATE TABLE social_mentions (
    id SERIAL PRIMARY KEY,
    card_id VARCHAR(50),  -- NULL if card not yet identified
    card_name_raw VARCHAR(255) NOT NULL,  -- Original text for card matching

    platform VARCHAR(20) NOT NULL,  -- 'twitter', 'youtube', 'reddit', 'discord'

    -- Platform-specific IDs
    external_id VARCHAR(100) NOT NULL,
    author_id VARCHAR(100),
    author_followers INTEGER,

    -- Content
    content TEXT,
    url TEXT,

    -- Engagement
    likes INTEGER DEFAULT 0,
    retweets INTEGER DEFAULT 0,  -- or shares/upvotes
    comments INTEGER DEFAULT 0,
    views INTEGER DEFAULT 0,  -- YouTube only

    -- Sentiment (computed)
    sentiment_score DECIMAL(4, 3),  -- -1.000 to 1.000
    sentiment_label VARCHAR(20),

    -- Timestamps
    posted_at TIMESTAMPTZ NOT NULL,
    collected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT idx_social_unique UNIQUE (platform, external_id)
);

CREATE INDEX idx_social_card ON social_mentions (card_id, posted_at DESC);
CREATE INDEX idx_social_unmatched ON social_mentions (card_id) WHERE card_id IS NULL;
```

**Collection Implementation:**

```python
# src/collectors/social_collector.py

import tweepy
from googleapiclient.discovery import build
import praw
from datetime import datetime, timedelta
import re

class SocialCollector:
    """
    Collect social mentions across platforms.

    Prerequisites:
    1. Twitter API credentials (Basic tier minimum: $100/month)
    2. YouTube Data API key (free tier: 10,000 quota/day)
    3. Reddit API credentials (free)
    """

    def __init__(self, config: dict):
        # Twitter/X setup
        self.twitter = tweepy.Client(
            bearer_token=config['twitter_bearer_token'],
            wait_on_rate_limit=True
        )

        # YouTube setup
        self.youtube = build('youtube', 'v3',
                            developerKey=config['youtube_api_key'])

        # Reddit setup
        self.reddit = praw.Reddit(
            client_id=config['reddit_client_id'],
            client_secret=config['reddit_client_secret'],
            user_agent='TCG-Price-Tracker/1.0'
        )

        # Card name patterns for matching
        self.card_patterns = self._build_card_patterns()

    def collect_twitter(self, hours: int = 24) -> list[dict]:
        """
        Collect TCG-related tweets.

        Rate limit: 450 requests/15 min (Basic tier)
        Each request returns up to 100 tweets.
        """
        queries = [
            '(optcg OR "one piece tcg") (price OR sell OR buy OR pull)',
            '(pokemon tcg OR ptcg) (price OR sell OR buy OR pull)',
            '(mtg OR "magic gathering") (spike OR price OR sell)',
        ]

        all_tweets = []
        start_time = datetime.utcnow() - timedelta(hours=hours)

        for query in queries:
            try:
                tweets = self.twitter.search_recent_tweets(
                    query=f'{query} -is:retweet lang:en',
                    max_results=100,
                    start_time=start_time,
                    tweet_fields=['created_at', 'public_metrics', 'author_id'],
                    expansions=['author_id'],
                    user_fields=['public_metrics']
                )

                if tweets.data:
                    # Build user lookup
                    users = {u.id: u for u in (tweets.includes.get('users', []))}

                    for tweet in tweets.data:
                        user = users.get(tweet.author_id)
                        all_tweets.append({
                            'platform': 'twitter',
                            'external_id': str(tweet.id),
                            'author_id': str(tweet.author_id),
                            'author_followers': user.public_metrics['followers_count'] if user else 0,
                            'content': tweet.text,
                            'likes': tweet.public_metrics['like_count'],
                            'retweets': tweet.public_metrics['retweet_count'],
                            'comments': tweet.public_metrics['reply_count'],
                            'posted_at': tweet.created_at,
                        })
            except Exception as e:
                print(f"Twitter error for query '{query}': {e}")

        return all_tweets

    def collect_youtube(self, hours: int = 24) -> list[dict]:
        """
        Collect TCG-related YouTube videos.

        Quota cost: ~100 units per search + 1 per video detail
        Daily limit: 10,000 units (free tier)
        """
        queries = [
            'one piece tcg opening',
            'one piece tcg market',
            'pokemon tcg pull',
            'pokemon tcg price',
        ]

        all_videos = []
        published_after = (datetime.utcnow() - timedelta(hours=hours)).isoformat() + 'Z'

        for query in queries:
            try:
                search_response = self.youtube.search().list(
                    q=query,
                    part='snippet',
                    type='video',
                    publishedAfter=published_after,
                    maxResults=25,  # Balance quota vs coverage
                    order='viewCount'
                ).execute()

                video_ids = [item['id']['videoId'] for item in search_response.get('items', [])]

                if video_ids:
                    # Get view counts (1 quota unit per video)
                    stats_response = self.youtube.videos().list(
                        id=','.join(video_ids),
                        part='statistics'
                    ).execute()

                    stats = {v['id']: v['statistics'] for v in stats_response.get('items', [])}

                    for item in search_response['items']:
                        vid = item['id']['videoId']
                        video_stats = stats.get(vid, {})

                        all_videos.append({
                            'platform': 'youtube',
                            'external_id': vid,
                            'author_id': item['snippet']['channelId'],
                            'content': item['snippet']['title'] + ' ' + item['snippet'].get('description', ''),
                            'url': f'https://youtube.com/watch?v={vid}',
                            'views': int(video_stats.get('viewCount', 0)),
                            'likes': int(video_stats.get('likeCount', 0)),
                            'comments': int(video_stats.get('commentCount', 0)),
                            'posted_at': item['snippet']['publishedAt'],
                        })
            except Exception as e:
                print(f"YouTube error for query '{query}': {e}")

        return all_videos

    def collect_reddit(self, hours: int = 24) -> list[dict]:
        """
        Collect posts from TCG subreddits.

        Rate limit: 60 requests/minute (with OAuth)
        """
        subreddits = [
            'OnePieceTCG',
            'PokemonTCG',
            'PokeInvesting',
            'mtgfinance',
            'magicTCG',
        ]

        all_posts = []

        for sub_name in subreddits:
            try:
                subreddit = self.reddit.subreddit(sub_name)

                for post in subreddit.new(limit=50):
                    # Filter by time
                    post_time = datetime.fromtimestamp(post.created_utc)
                    if post_time < datetime.utcnow() - timedelta(hours=hours):
                        continue

                    all_posts.append({
                        'platform': 'reddit',
                        'external_id': post.id,
                        'author_id': str(post.author) if post.author else None,
                        'content': post.title + ' ' + (post.selftext or ''),
                        'url': f'https://reddit.com{post.permalink}',
                        'likes': post.score,  # upvotes - downvotes
                        'comments': post.num_comments,
                        'posted_at': post_time,
                    })
            except Exception as e:
                print(f"Reddit error for r/{sub_name}: {e}")

        return all_posts

    def match_card_mentions(self, mentions: list[dict]) -> list[dict]:
        """
        Match social mentions to card IDs.

        This is imperfect - some mentions won't match.
        Store unmatched for manual review / pattern improvement.
        """
        for mention in mentions:
            content = mention['content'].lower()

            # Try to match against known card names
            for pattern, card_id in self.card_patterns.items():
                if re.search(pattern, content, re.IGNORECASE):
                    mention['card_id'] = card_id
                    mention['card_name_raw'] = pattern
                    break
            else:
                mention['card_id'] = None
                # Extract potential card name for later matching
                mention['card_name_raw'] = self._extract_card_name(content)

        return mentions

    def _build_card_patterns(self) -> dict[str, str]:
        """Load card names from database and build regex patterns."""
        # This would query your CardPriceV2 table
        # Returns {pattern: card_id}
        return {}  # Implement based on your card database

    def _extract_card_name(self, text: str) -> str:
        """Extract potential card name from text for later matching."""
        # Simple heuristic: look for capitalized words
        # Could be improved with NER
        words = re.findall(r'[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*', text)
        return ' '.join(words[:3]) if words else ''
```

### 2.3 Tournament Data (for Meta Model)

**Required Schema:**

```sql
CREATE TABLE tournaments (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    game VARCHAR(20) NOT NULL,
    date DATE NOT NULL,
    format VARCHAR(50),  -- 'standard', 'expanded', etc.
    player_count INTEGER,
    source_url TEXT,
    collected_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE tournament_decks (
    id SERIAL PRIMARY KEY,
    tournament_id INTEGER REFERENCES tournaments(id),
    player_name VARCHAR(100),
    placement INTEGER,  -- 1-8 for top cut
    deck_archetype VARCHAR(100),
    decklist_url TEXT
);

CREATE TABLE deck_cards (
    id SERIAL PRIMARY KEY,
    deck_id INTEGER REFERENCES tournament_decks(id),
    card_id VARCHAR(50) NOT NULL,
    quantity INTEGER NOT NULL,
    is_main_deck BOOLEAN DEFAULT TRUE
);

-- View for training data
CREATE VIEW tournament_card_performance AS
SELECT
    dc.card_id,
    t.game,
    t.date,
    COUNT(DISTINCT td.id) as deck_count,
    COUNT(DISTINCT td.id) FILTER (WHERE td.placement <= 8) as top8_count,
    AVG(dc.quantity) as avg_copies,
    COUNT(DISTINCT td.deck_archetype) as archetype_diversity
FROM deck_cards dc
JOIN tournament_decks td ON dc.deck_id = td.id
JOIN tournaments t ON td.tournament_id = t.id
GROUP BY dc.card_id, t.game, t.date;
```

**Data Sources:**

| Game | Source | URL | Format |
|------|--------|-----|--------|
| Pokemon | Limitless TCG | `https://limitlesstcg.com/tournaments` | HTML scrape |
| One Piece | One Piece Top Decks | `https://onepiecetopdecks.com/` | HTML scrape |
| MTG | MTG Goldfish | `https://www.mtggoldfish.com/metagame/` | HTML/API |
| Yu-Gi-Oh | YGO Meta | `https://www.yugiohmeta.com/` | HTML scrape |

---

## 3. Infrastructure Prerequisites

### 3.1 Feature Store (Redis)

For real-time inference, features need to be pre-computed and cached.

```typescript
// src/features/feature-store.ts

interface FeatureStore {
  // Price features - updated every 4 hours
  setCardPrices(cardId: string, prices: {
    marketPrice: number;
    lowPrice: number;
    highPrice: number;
    trend7d: number;
    trend30d: number;
    volatility30d: number;
  }): Promise<void>;

  // Social features - updated hourly
  setSocialSignals(cardId: string, signals: {
    buzzScore: number;
    sentiment: number;
    twitterVolume24h: number;
    youtubeViews24h: number;
  }): Promise<void>;

  // Get all features for inference
  getFeatures(cardId: string): Promise<CardFeatures>;
}

class RedisFeatureStore implements FeatureStore {
  private redis: Redis;

  constructor(redisUrl: string) {
    this.redis = new Redis(redisUrl);
  }

  async setCardPrices(cardId: string, prices: PriceFeatures): Promise<void> {
    await this.redis.hset(`features:${cardId}`, {
      ...prices,
      priceUpdatedAt: Date.now(),
    });
    // 4 hour TTL
    await this.redis.expire(`features:${cardId}`, 4 * 60 * 60);
  }

  async getFeatures(cardId: string): Promise<CardFeatures | null> {
    const data = await this.redis.hgetall(`features:${cardId}`);
    if (!data || Object.keys(data).length === 0) return null;

    return {
      cardId,
      marketPrice: parseFloat(data.marketPrice),
      lowPrice: parseFloat(data.lowPrice),
      // ... etc
    };
  }
}
```

### 3.2 Model Registry (MLflow)

Track model versions, parameters, and performance.

```python
# src/training/model_registry.py

import mlflow
from mlflow.tracking import MlflowClient

mlflow.set_tracking_uri("http://localhost:5000")  # Or S3/cloud

class ModelRegistry:
    def __init__(self, experiment_name: str):
        mlflow.set_experiment(experiment_name)
        self.client = MlflowClient()

    def log_training_run(
        self,
        model_name: str,
        model: any,
        params: dict,
        metrics: dict,
        training_data_info: dict
    ) -> str:
        """Log a training run with all metadata."""
        with mlflow.start_run() as run:
            # Log parameters
            mlflow.log_params(params)
            mlflow.log_params({
                'training_samples': training_data_info['num_samples'],
                'training_start_date': training_data_info['start_date'],
                'training_end_date': training_data_info['end_date'],
            })

            # Log metrics
            mlflow.log_metrics(metrics)

            # Log model
            mlflow.sklearn.log_model(model, model_name)

            # Register model if performance is good
            if metrics.get('precision_at_100', 0) > 0.7:
                mlflow.register_model(
                    f"runs:/{run.info.run_id}/{model_name}",
                    model_name
                )

            return run.info.run_id

    def load_production_model(self, model_name: str):
        """Load the current production model."""
        model_uri = f"models:/{model_name}/Production"
        return mlflow.sklearn.load_model(model_uri)
```

### 3.3 Training Compute

**Options:**

| Option | Cost | Best For |
|--------|------|----------|
| Local (M1/M2 Mac) | $0 | Prototyping, small datasets |
| AWS SageMaker | ~$5-50/run | Production training |
| Google Colab Pro | $10/month | Quick experiments |
| Lambda (ML) | $0.80/hour | GPU training |

For the models described:
- Sniper, Arbitrage, Meta: CPU sufficient (XGBoost/LightGBM)
- Sentiment: GPU recommended (RoBERTa fine-tuning)
- Condition: GPU required (CNN training)

---

## 4. Training Workflow

### 4.1 Sniper Model Training

```python
# src/training/train_sniper.py

import pandas as pd
import numpy as np
from sklearn.ensemble import IsolationForest, GradientBoostingClassifier
from sklearn.model_selection import TimeSeriesSplit
from sklearn.metrics import precision_score, recall_score
import mlflow

def train_sniper_model(db_connection: str) -> dict:
    """
    Train the listing sniper model.

    Prerequisites:
    - At least 2 weeks of listing data with outcomes
    - At least 10,000 listings with known sell times
    """

    # 1. Load training data
    query = """
    SELECT
        listing_price,
        market_price_at_listing,
        low_price_at_listing,
        (market_price_at_listing - listing_price) / NULLIF(market_price_at_listing, 0) as discount_from_market,
        (low_price_at_listing - listing_price) / NULLIF(low_price_at_listing, 0) as discount_from_low,
        seller_rating,
        seller_sales_count,
        has_photo::int,
        CASE WHEN condition = 'Near Mint' THEN 1 ELSE 0 END as is_nm,
        CASE WHEN time_to_sell_minutes IS NOT NULL AND time_to_sell_minutes < 60 THEN 1 ELSE 0 END as sold_fast
    FROM listings
    WHERE sold_at IS NOT NULL OR first_seen_at < NOW() - INTERVAL '24 hours'
    """

    df = pd.read_sql(query, db_connection)

    # Check prerequisites
    if len(df) < 10000:
        raise ValueError(f"Insufficient training data: {len(df)} samples (need 10,000+)")

    positive_rate = df['sold_fast'].mean()
    if positive_rate < 0.01 or positive_rate > 0.5:
        print(f"Warning: Unusual positive rate: {positive_rate:.2%}")

    # 2. Prepare features and labels
    feature_cols = [
        'listing_price', 'market_price_at_listing', 'low_price_at_listing',
        'discount_from_market', 'discount_from_low',
        'seller_rating', 'seller_sales_count', 'has_photo', 'is_nm'
    ]

    X = df[feature_cols].fillna(0)
    y = df['sold_fast']

    # 3. Time-series cross-validation (don't leak future data)
    tscv = TimeSeriesSplit(n_splits=5)

    results = []
    for fold, (train_idx, val_idx) in enumerate(tscv.split(X)):
        X_train, X_val = X.iloc[train_idx], X.iloc[val_idx]
        y_train, y_val = y.iloc[train_idx], y.iloc[val_idx]

        # Train gradient boosting classifier
        model = GradientBoostingClassifier(
            n_estimators=100,
            max_depth=5,
            learning_rate=0.1,
            subsample=0.8,
            random_state=42
        )

        model.fit(X_train, y_train)

        # Evaluate
        y_pred_proba = model.predict_proba(X_val)[:, 1]

        # Precision at top 100 (our key metric)
        top_100_idx = np.argsort(y_pred_proba)[-100:]
        precision_at_100 = y_val.iloc[top_100_idx].mean()

        results.append({
            'fold': fold,
            'precision_at_100': precision_at_100,
            'overall_precision': precision_score(y_val, y_pred_proba > 0.5),
            'recall': recall_score(y_val, y_pred_proba > 0.5),
        })

        print(f"Fold {fold}: Precision@100 = {precision_at_100:.2%}")

    # 4. Train final model on all data
    final_model = GradientBoostingClassifier(
        n_estimators=100,
        max_depth=5,
        learning_rate=0.1,
        subsample=0.8,
        random_state=42
    )
    final_model.fit(X, y)

    # 5. Log to MLflow
    avg_precision = np.mean([r['precision_at_100'] for r in results])

    with mlflow.start_run():
        mlflow.log_params({
            'n_estimators': 100,
            'max_depth': 5,
            'learning_rate': 0.1,
            'training_samples': len(df),
            'positive_rate': positive_rate,
        })
        mlflow.log_metrics({
            'precision_at_100': avg_precision,
            'cv_std': np.std([r['precision_at_100'] for r in results]),
        })
        mlflow.sklearn.log_model(final_model, 'sniper_model')

        # Register if good enough
        if avg_precision > 0.70:
            mlflow.register_model(
                f"runs:/{mlflow.active_run().info.run_id}/sniper_model",
                "sniper_model"
            )

    return {
        'model': final_model,
        'feature_cols': feature_cols,
        'metrics': {
            'precision_at_100': avg_precision,
            'cv_results': results,
        }
    }
```

### 4.2 Sentiment Model Training

```python
# src/training/train_sentiment.py

from transformers import (
    RobertaTokenizer,
    RobertaForSequenceClassification,
    Trainer,
    TrainingArguments
)
from datasets import Dataset
import torch

def train_sentiment_model(db_connection: str, output_dir: str) -> dict:
    """
    Fine-tune RoBERTa for TCG sentiment analysis.

    Prerequisites:
    - At least 4 weeks of social mentions with engagement data
    - GPU recommended (4+ hours on CPU)
    - ~5,000 labeled examples minimum
    """

    # 1. Load and label training data
    query = """
    SELECT
        content,
        platform,
        likes,
        retweets,
        comments,
        -- Proxy labels from engagement
        CASE
            WHEN platform = 'twitter' AND (likes + retweets) > (
                SELECT AVG(likes + retweets) * 1.5 FROM social_mentions WHERE platform = 'twitter'
            ) THEN 2  -- Positive (high engagement)
            WHEN platform = 'twitter' AND (likes + retweets) < (
                SELECT AVG(likes + retweets) * 0.5 FROM social_mentions WHERE platform = 'twitter'
            ) THEN 0  -- Negative (low engagement)
            ELSE 1  -- Neutral
        END as label
    FROM social_mentions
    WHERE content IS NOT NULL AND LENGTH(content) > 20
    """

    df = pd.read_sql(query, db_connection)

    if len(df) < 5000:
        raise ValueError(f"Insufficient training data: {len(df)} samples (need 5,000+)")

    # 2. Prepare dataset
    tokenizer = RobertaTokenizer.from_pretrained('roberta-base')

    def tokenize_function(examples):
        return tokenizer(
            examples['content'],
            padding='max_length',
            truncation=True,
            max_length=128
        )

    dataset = Dataset.from_pandas(df[['content', 'label']])
    tokenized = dataset.map(tokenize_function, batched=True)

    # Split
    split = tokenized.train_test_split(test_size=0.2, seed=42)

    # 3. Initialize model
    model = RobertaForSequenceClassification.from_pretrained(
        'roberta-base',
        num_labels=3
    )

    # 4. Training arguments
    training_args = TrainingArguments(
        output_dir=output_dir,
        num_train_epochs=3,
        per_device_train_batch_size=16,
        per_device_eval_batch_size=16,
        warmup_steps=500,
        weight_decay=0.01,
        logging_dir=f'{output_dir}/logs',
        logging_steps=100,
        evaluation_strategy='epoch',
        save_strategy='epoch',
        load_best_model_at_end=True,
    )

    # 5. Train
    trainer = Trainer(
        model=model,
        args=training_args,
        train_dataset=split['train'],
        eval_dataset=split['test'],
    )

    trainer.train()

    # 6. Save
    model.save_pretrained(f'{output_dir}/final')
    tokenizer.save_pretrained(f'{output_dir}/final')

    # 7. Evaluate
    results = trainer.evaluate()

    return {
        'model_path': f'{output_dir}/final',
        'metrics': results,
    }
```

---

## 5. Validation Before Deployment

### 5.1 Backtesting Framework

```python
# src/validation/backtest.py

class Backtester:
    """
    Backtest trading models on historical data.

    CRITICAL: Never train on data you'll backtest on.
    """

    def __init__(self, model, feature_store):
        self.model = model
        self.feature_store = feature_store

    def backtest_sniper(
        self,
        start_date: datetime,
        end_date: datetime,
        initial_capital: float = 10000
    ) -> dict:
        """
        Simulate sniper model performance on historical listings.
        """
        capital = initial_capital
        trades = []

        # Get historical listings day by day
        current_date = start_date
        while current_date < end_date:
            # Get listings that appeared on this day
            listings = self.get_listings_for_date(current_date)

            # Score each listing
            for listing in listings:
                features = self.prepare_features(listing)
                score = self.model.predict_proba([features])[0][1]

                if score > 0.7 and capital >= listing['price']:
                    # Would have bought
                    outcome = self.get_listing_outcome(listing)

                    if outcome['sold']:
                        profit = outcome['resale_price'] - listing['price']
                        roi = profit / listing['price']
                    else:
                        profit = 0  # Didn't sell, no profit
                        roi = 0

                    trades.append({
                        'date': current_date,
                        'card_id': listing['card_id'],
                        'buy_price': listing['price'],
                        'sell_price': outcome.get('resale_price'),
                        'profit': profit,
                        'roi': roi,
                        'score': score,
                    })

                    capital += profit

            current_date += timedelta(days=1)

        # Calculate metrics
        winning_trades = [t for t in trades if t['profit'] > 0]

        return {
            'total_trades': len(trades),
            'winning_trades': len(winning_trades),
            'win_rate': len(winning_trades) / len(trades) if trades else 0,
            'total_profit': sum(t['profit'] for t in trades),
            'avg_roi': np.mean([t['roi'] for t in trades]) if trades else 0,
            'final_capital': capital,
            'return': (capital - initial_capital) / initial_capital,
            'trades': trades,
        }
```

### 5.2 Deployment Checklist

Before deploying any model to production:

- [ ] **Data Quality Checks**
  - [ ] Training data has no future leakage
  - [ ] Feature distributions match production
  - [ ] Labels are correctly generated

- [ ] **Model Performance**
  - [ ] Cross-validation metrics meet thresholds
  - [ ] Backtest shows positive expected value
  - [ ] Performance stable across time periods

- [ ] **Infrastructure**
  - [ ] Feature store populated and updating
  - [ ] Model serving endpoint deployed
  - [ ] Alert system connected
  - [ ] Monitoring dashboards created

- [ ] **Risk Management**
  - [ ] Position sizing limits configured
  - [ ] Daily loss limits set
  - [ ] Model drift detection enabled

---

## 6. Quick Start: 30-Day Data Collection Plan

### Week 1: Core Setup
- [ ] Deploy listing collector (TCGplayer first)
- [ ] Set up PostgreSQL tables (listings, social_mentions)
- [ ] Configure 15-minute collection cron job
- [ ] Begin Twitter API collection (if budget allows)

### Week 2: Expand Collection
- [ ] Add Cardmarket listing collection
- [ ] Set up YouTube data collection
- [ ] Configure Reddit collection
- [ ] Start tracking listing outcomes

### Week 3: Feature Engineering
- [ ] Implement feature store (Redis)
- [ ] Create feature computation jobs
- [ ] Build training data export pipeline
- [ ] Set up MLflow for experiment tracking

### Week 4: First Model Training
- [ ] Export Sniper training data (should have ~20k listings)
- [ ] Train initial Sniper model
- [ ] Backtest on held-out data
- [ ] Deploy to staging for shadow mode (score but don't alert)

### Ongoing
- [ ] Monitor model drift weekly
- [ ] Retrain monthly with new data
- [ ] Expand to Sentiment model (week 6+)
- [ ] Add tournament data (week 8+)

---

## References

- [MLflow Quickstart](https://mlflow.org/docs/latest/quickstart.html)
- [Twitter API v2 Docs](https://developer.twitter.com/en/docs/twitter-api)
- [YouTube Data API](https://developers.google.com/youtube/v3)
- [Reddit API (PRAW)](https://praw.readthedocs.io/)
- [Time Series Cross-Validation](https://scikit-learn.org/stable/modules/cross_validation.html#time-series-split)
