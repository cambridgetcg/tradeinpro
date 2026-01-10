# TCG Value Extraction Framework

> **Research Date**: January 2026
> **Purpose**: Align ML model training with actionable profit extraction
> **Philosophy**: Every model must answer "How do I make money from this?"

---

## 1. Value Extraction Philosophy

**The Problem**: Generic price prediction models optimize for accuracy metrics (RMSE, MAPE) without considering whether predictions translate to actionable profits.

**The Solution**: Design models around specific value extraction opportunities, where the output directly informs a profitable action.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    VALUE EXTRACTION DECISION TREE                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│                        ┌────────────────┐                                   │
│                        │  MARKET SIGNAL │                                   │
│                        └───────┬────────┘                                   │
│                                │                                             │
│           ┌────────────────────┼────────────────────┐                       │
│           ▼                    ▼                    ▼                        │
│    ┌─────────────┐     ┌─────────────┐     ┌─────────────┐                 │
│    │  IMMEDIATE  │     │ SHORT-TERM  │     │  LONG-TERM  │                 │
│    │   VALUE     │     │    VALUE    │     │    VALUE    │                 │
│    └──────┬──────┘     └──────┬──────┘     └──────┬──────┘                 │
│           │                   │                   │                          │
│    ┌──────┴──────┐     ┌──────┴──────┐     ┌──────┴──────┐                 │
│    │  Arbitrage  │     │  Momentum   │     │  Position   │                 │
│    │  Sniper     │     │   Trader    │     │  Builder    │                 │
│    └─────────────┘     └─────────────┘     └─────────────┘                 │
│                                                                              │
│    ACTION: Buy now     ACTION: Buy/sell    ACTION: Accumulate              │
│    ROI: 10-50%         within 7 days       over 30-90 days                  │
│    Risk: Low           ROI: 20-100%        ROI: 50-500%                     │
│    Volume: High        Risk: Medium        Risk: Higher                     │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Value Extraction Opportunity Matrix

### 2.1 Complete Opportunity Landscape

| Opportunity | Time Horizon | Expected ROI | Risk | Frequency | Model Type |
|-------------|--------------|--------------|------|-----------|------------|
| **Listing Sniper** | Immediate | 15-40% | Low | High | Anomaly Detection |
| **Condition Arbitrage** | Immediate | 20-50% | Low | Medium | Classification |
| **Cross-Platform Arbitrage** | 1-3 days | 10-30% | Low | Medium | Regression |
| **JP→EN Price Lead** | 2-4 months | 50-200% | Medium | Low | Time Series |
| **Tournament Meta Spike** | 1-2 weeks | 30-100% | Medium | Low | NLP + Time Series |
| **Social Sentiment Surge** | 1-7 days | 20-80% | Medium | Medium | NLP Sentiment |
| **Grading ROI Prediction** | 4-8 weeks | 100-500% | Medium | Medium | Image + Regression |
| **Set Release Timing** | 1-4 weeks | 20-60% | Low | Low | Time Series |
| **Reprint Crash Avoidance** | Weeks-Months | Loss Avoidance | Medium | Low | NLP + Classification |
| **Trade-In Value Optimization** | Immediate | 10-25% | Low | High | Optimization |

### 2.2 Model-to-Opportunity Alignment Matrix

**Key Principle**: Each model must have a single, measurable profit objective.

| Opportunity | Model Type | Training Objective | Loss Function | Output | Action Trigger |
|-------------|------------|-------------------|---------------|--------|----------------|
| **Listing Sniper** | Isolation Forest + XGBoost | Maximize precision on sold-within-1h listings | Binary Cross-Entropy | `opportunity_score: 0-100` | Score > 70 → BUY |
| **Condition Arbitrage** | CNN (ResNet50) + Dense | Minimize grade prediction MSE | MSE + Weighted Class Loss | `grade_distribution: {1-10: prob}` | P(9+) > 0.4 AND ROI > 50% |
| **Cross-Platform Arb** | Multi-output Regression | Maximize net profit prediction R² | RMSE per platform | `{platform: price}` | Spread > 15% after fees |
| **JP→EN Lead** | LSTM Time Series | Minimize EN price prediction error | Huber Loss | `en_price: float` | JP price < 60% predicted EN |
| **Social Sentiment** | LSTM + RoBERTa Transformer | Maximize directional accuracy | Categorical CE + MSE | `direction, magnitude, timing` | Buzz > 70 + rising |
| **Tournament Meta** | XGBoost Classifier | Maximize spike detection recall | Focal Loss (class imbalance) | `spike_prob: 0-1` | P(spike) > 0.6 + new tech |
| **Grading ROI** | CNN + Regression | Maximize expected ROI accuracy | MAE on ROI | `expected_roi: float` | ROI > 50% |
| **Trade-In Optimize** | Multi-objective Optimization | Maximize margin × conversion | Custom Pareto Loss | `offer_price: float` | Margin > 15% |

### 2.3 Feature Requirements Matrix

**Consolidated feature availability by data source**:

| Feature Category | TCGplayer | Cardmarket | OPTCG API | Scryfall | Social APIs | Images |
|------------------|-----------|------------|-----------|----------|-------------|--------|
| Market Price | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| Price Depth (Low/Mid/High) | ✅ | ✅ (trend) | ❌ | ❌ | ❌ | ❌ |
| Historical Prices | ✅ (paid) | ✅ (30d) | ❌ | ❌ | ❌ | ❌ |
| Listing Count | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Seller Metadata | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Condition Variants | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Card Attributes | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| Tournament Data | ❌ | ❌ | ❌ | ❌ | ✅ (Limitless) | ❌ |
| Social Volume | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |
| Sentiment Score | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |
| Visual Condition | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Card Images | ✅ | ✅ | ❌ | ✅ | ❌ | ✅ |

### 2.4 Minimum Viable Data for Each Model

```typescript
interface ModelDataRequirements {
  // === SNIPER MODEL ===
  sniper: {
    required: ['listing_price', 'market_price', 'low_price', 'listing_age_minutes'];
    optional: ['seller_rating', 'seller_sales_count', 'has_photo', 'condition'];
    update_frequency: 'real-time';  // Every 5 minutes
    training_samples: 50000;  // Listings with known outcomes
  };

  // === SENTIMENT MODEL ===
  sentiment: {
    required: ['price_history_30d', 'twitter_volume_24h', 'sentiment_score'];
    optional: ['youtube_views', 'reddit_posts', 'tournament_results'];
    update_frequency: 'hourly';
    training_samples: 10000;  // Cards with social + price data
  };

  // === CONDITION MODEL ===
  condition: {
    required: ['image_front', 'image_back', 'known_grade'];
    optional: ['seller_accuracy', 'photo_resolution'];
    update_frequency: 'on-demand';
    training_samples: 5000;  // Graded cards with images
  };

  // === ARBITRAGE MODEL ===
  arbitrage: {
    required: ['tcgplayer_price', 'cardmarket_price', 'fx_rate_gbp'];
    optional: ['ebay_price', 'japan_price', 'shipping_costs'];
    update_frequency: 'every 4 hours';
    training_samples: 20000;  // Cross-platform price pairs
  };

  // === META MODEL ===
  meta: {
    required: ['tournament_results', 'deck_inclusion_rate', 'price_before', 'price_after'];
    optional: ['meta_share', 'win_rate', 'copies_per_deck'];
    update_frequency: 'daily';
    training_samples: 2000;  // Cards with tournament + price spike data
  };

  // === TRADE-IN MODEL ===
  tradeIn: {
    required: ['market_price', 'condition', 'price_trend_30d', 'inventory_count'];
    optional: ['volatility', 'sell_through_days', 'customer_asking_price'];
    update_frequency: 'real-time';
    training_samples: 10000;  // Historical trade-in transactions
  };
}
```

---

## 3. Opportunity 1: Listing Sniper (Underpriced Detection)

### 3.1 Value Proposition

**Goal**: Identify listings priced significantly below market value before other buyers.

**Why It Works**: Sellers make pricing mistakes due to:
- Outdated price knowledge
- Urgency to sell
- Misidentified variants (SP sold as base)
- Condition mislabeling
- Bulk lot liquidation
- Currency confusion (listing USD as GBP)

**Expected ROI**: 15-40% per transaction
**Time to Value**: Minutes to hours
**Competition Level**: High (bots, experienced flippers)

### 3.2 Model Design

**Model Type**: Anomaly Detection (Isolation Forest / Autoencoder)

**Objective Function**:
```python
# Score = how underpriced relative to fair value
# Higher score = better opportunity

def opportunity_score(listing_price, fair_value, confidence):
    """
    Score underpriced listings.

    Args:
        listing_price: Current asking price
        fair_value: Model's estimated fair value
        confidence: Model's confidence in fair value estimate

    Returns:
        opportunity_score: 0-100 (higher = better deal)
    """
    if listing_price >= fair_value:
        return 0  # Not underpriced

    discount = (fair_value - listing_price) / fair_value

    # Penalize low-confidence estimates
    adjusted_discount = discount * confidence

    # Convert to score (cap at 100)
    score = min(100, adjusted_discount * 200)

    return score
```

**Training Target**: Binary classification
- 1 = Listing sold within 1 hour (confirmed underpriced)
- 0 = Listing remained > 24 hours (fairly priced or overpriced)

### 3.3 Feature Set

```typescript
interface ListingSniperFeatures {
  // === PRICING CONTEXT ===
  listingPrice: number;
  marketPrice: number;           // TCGplayer market
  lowPrice: number;              // TCGplayer low
  cardmarketPrice: number;       // Cross-platform reference
  discountFromMarket: number;    // (market - listing) / market
  discountFromLow: number;       // (low - listing) / low
  pricePercentile: number;       // Where listing falls in distribution

  // === LISTING METADATA ===
  sellerRating: number;          // Seller feedback score
  sellerSalesCount: number;      // Experience indicator
  listingAge: number;            // Minutes since posted
  hasPhoto: boolean;             // Real photo vs stock
  conditionStated: string;       // NM, LP, etc.
  shippingCost: number;          // Total cost consideration

  // === CARD CONTEXT ===
  averageDaysToSell: number;     // Typical sell-through time
  recentSalesVelocity: number;   // Sales per day
  priceVolatility30d: number;    // Price stability
  isVariant: boolean;            // Higher misidentification risk
  variantType: string;           // SP, parallel, etc.

  // === RISK SIGNALS ===
  tooGoodToBeTrueFlag: boolean;  // >50% discount = suspicious
  newSellerFlag: boolean;        // <10 sales = higher risk
  stockPhotoFlag: boolean;       // No real photo = condition risk
}
```

### 3.4 Alert Output Format

```json
{
  "alert_type": "UNDERPRICED_LISTING",
  "confidence": 0.87,
  "card": {
    "name": "Monkey D. Luffy (SP)",
    "set": "OP01",
    "card_id": "OP03-OP01-003-SP"
  },
  "listing": {
    "platform": "TCGplayer",
    "price": 42.99,
    "condition": "Near Mint",
    "seller": "CardShop123",
    "url": "https://tcgplayer.com/..."
  },
  "analysis": {
    "fair_value": 65.00,
    "discount_pct": 33.9,
    "opportunity_score": 78,
    "estimated_profit": 18.01,
    "estimated_roi": 41.9
  },
  "risk_assessment": {
    "seller_score": "HIGH",
    "photo_verified": true,
    "variant_correctly_identified": true
  },
  "action": "BUY_IMMEDIATELY",
  "urgency": "HIGH",
  "expires_estimate": "15 minutes"
}
```

---

## 4. Opportunity 2: Condition Arbitrage

### 4.1 Value Proposition

**Goal**: Identify condition mispricings where actual grade differs from listed grade.

**Scenarios**:
1. **Upgrade Opportunity**: Card listed as LP is actually NM → buy LP price, sell NM price
2. **Grading Arbitrage**: Raw card with PSA 10 potential → buy raw, grade, sell slabbed
3. **Condition Spread Exploitation**: LP-NM spread too wide → buy LP, sell to less condition-sensitive buyer

**Expected ROI**: 20-50% (condition upgrade), 100-500% (successful grading)

### 4.2 Model Design: Grade Prediction

**Model Type**: Multi-class Classification (CNN for images + tabular features)

**Classes**: NM, LP, MP, HP, DMG (5 conditions)

**For Grading ROI Prediction**:
- Input: Card images (front + back)
- Output: Probability distribution over PSA grades 1-10
- Decision: Grade if P(PSA 9+) × (PSA 9 price - raw price - grading cost) > threshold

```python
def grading_roi_prediction(card, image_front, image_back):
    """
    Predict whether a card is worth grading.

    Returns decision and expected ROI.
    """
    # Get grade probability distribution from CNN model
    grade_probs = grade_predictor.predict(image_front, image_back)
    # grade_probs = {1: 0.01, 2: 0.02, ..., 9: 0.25, 10: 0.15}

    # Get price multipliers for each grade
    raw_price = card['price']
    graded_prices = get_graded_prices(card['card_id'])
    # graded_prices = {9: 150, 10: 450, ...}

    grading_cost = 25  # Base PSA cost
    shipping_cost = 15
    total_cost = raw_price + grading_cost + shipping_cost

    # Calculate expected value
    expected_value = sum(
        grade_probs.get(grade, 0) * graded_prices.get(grade, raw_price)
        for grade in range(1, 11)
    )

    expected_profit = expected_value - total_cost
    expected_roi = expected_profit / total_cost

    # Decision threshold: only grade if >50% expected ROI
    should_grade = expected_roi > 0.50

    return {
        'should_grade': should_grade,
        'expected_roi': expected_roi,
        'grade_distribution': grade_probs,
        'confidence': max(grade_probs.values()),
        'primary_grade_prediction': max(grade_probs, key=grade_probs.get),
    }
```

### 4.3 Feature Set

```typescript
interface ConditionArbitrageFeatures {
  // === IMAGE FEATURES (from CNN) ===
  cornerSharpness: number[];     // 4 corners, 0-1 each
  edgeCondition: number[];       // 4 edges, 0-1 each
  surfaceQuality: number;        // 0-1, scratches/whitening
  centeringScore: number;        // 0-1, how centered
  printQuality: number;          // 0-1, factory defects

  // === LISTING CONTEXT ===
  listedCondition: string;       // What seller claims
  hasDetailedPhotos: boolean;    // Real photos available
  photoResolution: string;       // High/medium/low
  sellerAccuracy: number;        // Historical condition accuracy

  // === PRICING CONTEXT ===
  rawPriceNM: number;
  rawPriceLP: number;
  psa9Price: number;
  psa10Price: number;
  conditionSpread: number;       // (NM - LP) / LP

  // === GRADING CONTEXT ===
  popReportPSA10: number;        // How many PSA 10s exist
  popReportTotal: number;        // Total graded population
  gemRate: number;               // PSA 10 / Total graded
  gradingBacklog: number;        // Current PSA turnaround
}
```

---

## 5. Opportunity 3: Cross-Platform Arbitrage

### 5.1 Value Proposition

**Goal**: Exploit price differences between TCGplayer, Cardmarket, eBay, and Japanese markets.

**Why It Works**:
- Regional demand differences
- Currency fluctuations
- Information lag between markets
- Platform fee structures differ
- Seller concentration varies

**Key Arbitrage Routes**:
1. **TCGplayer → eBay**: Buy underpriced TCGplayer, sell on eBay at retail markup
2. **Cardmarket → TCGplayer**: EUR weakness creates USD buying opportunities
3. **Japan → Global**: JP prices are 30-60% lower; buy JP, hold for EN release
4. **eBay Auction → Fixed Price**: Auctions end below market, relist at market

### 5.2 Model Design

**Model Type**: Multi-output Regression (predict prices on all platforms)

**Objective**: Maximize net arbitrage return after all costs

```python
def calculate_arbitrage_opportunity(card_id, current_prices, fx_rates):
    """
    Find best arbitrage route for a card.

    Args:
        card_id: Card identifier
        current_prices: Dict of {platform: price}
        fx_rates: Dict of exchange rates

    Returns:
        Best arbitrage opportunity with expected profit
    """
    # Platform costs (fees + typical shipping)
    platform_costs = {
        'tcgplayer': {'buy_fee': 0.00, 'sell_fee': 0.13, 'ship_buy': 3.00, 'ship_sell': 3.50},
        'cardmarket': {'buy_fee': 0.00, 'sell_fee': 0.05, 'ship_buy': 4.00, 'ship_sell': 4.00},
        'ebay': {'buy_fee': 0.00, 'sell_fee': 0.13, 'ship_buy': 4.00, 'ship_sell': 4.00},
        'cardrush_jp': {'buy_fee': 0.00, 'sell_fee': 0.10, 'ship_buy': 15.00, 'ship_sell': 0},
    }

    # Normalize all prices to GBP
    normalized = {}
    for platform, price in current_prices.items():
        currency = platform_currency[platform]
        normalized[platform] = price * fx_rates[f'{currency}_GBP']

    # Find best buy/sell combination
    best_opportunity = None
    best_profit = 0

    for buy_platform in normalized:
        for sell_platform in normalized:
            if buy_platform == sell_platform:
                continue

            buy_price = normalized[buy_platform]
            buy_costs = platform_costs[buy_platform]
            total_buy = buy_price + buy_costs['ship_buy']

            sell_price = normalized[sell_platform]
            sell_costs = platform_costs[sell_platform]
            net_sell = sell_price * (1 - sell_costs['sell_fee']) - sell_costs['ship_sell']

            profit = net_sell - total_buy
            roi = profit / total_buy

            if profit > best_profit and roi > 0.10:  # Minimum 10% ROI threshold
                best_profit = profit
                best_opportunity = {
                    'buy_platform': buy_platform,
                    'buy_price': buy_price,
                    'sell_platform': sell_platform,
                    'sell_price': sell_price,
                    'net_profit': profit,
                    'roi': roi,
                }

    return best_opportunity
```

### 5.3 JP→EN Lead Time Model

**Special Case**: Japanese cards release 3-4 months before English. JP prices predict EN launch prices.

```python
def jp_to_en_price_prediction(jp_card_id, jp_price_history):
    """
    Predict English price at release based on Japanese market data.

    The JP market provides a "preview" of EN demand.
    High JP prices + high play rate = high EN prices at launch.
    """
    features = {
        # JP price trajectory
        'jp_launch_price': jp_price_history[0],
        'jp_current_price': jp_price_history[-1],
        'jp_price_change': (jp_price_history[-1] - jp_price_history[0]) / jp_price_history[0],
        'jp_volatility': np.std(jp_price_history),

        # JP market signals
        'jp_tournament_play_rate': get_jp_tournament_rate(jp_card_id),
        'jp_deck_inclusion_rate': get_jp_deck_rate(jp_card_id),

        # Historical JP→EN correlation for similar cards
        'historical_jp_en_ratio': get_historical_ratio(jp_card_id),

        # EN-specific factors
        'en_preorder_price': get_en_preorder(jp_card_id),
        'en_hype_score': get_en_social_sentiment(jp_card_id),
    }

    # Model predicts EN price at T+0 (release day) and T+30 (settled price)
    en_launch_price = model.predict(features, target='en_launch')
    en_settled_price = model.predict(features, target='en_settled')

    return {
        'jp_current_price': features['jp_current_price'],
        'predicted_en_launch': en_launch_price,
        'predicted_en_settled': en_settled_price,
        'recommended_action': 'BUY_JP_NOW' if en_launch_price > jp_price_history[-1] * 1.5 else 'WAIT',
        'expected_roi': (en_launch_price - jp_price_history[-1]) / jp_price_history[-1],
    }
```

---

## 6. Opportunity 4: Social Sentiment Trading

### 6.1 Value Proposition

**Goal**: Predict price movements from social media signals before they reflect in market prices.

**Signal Sources**:
- Twitter/X mentions and sentiment
- YouTube video views (openings, reviews)
- Reddit discussion volume
- TikTok viral moments
- Discord server activity
- Tournament stream viewership

**Why It Works**:
- Social buzz precedes buying activity by 1-7 days
- Content creators drive demand for featured cards
- Anime episode releases spike character card prices
- Tournament results spread on social before market adjusts

### 6.2 Model Design

**Model Type**: LSTM/Transformer with multi-modal input (text + time series)

**Architecture**:
```
                    ┌─────────────────┐
                    │  Price History  │
                    │  (Time Series)  │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │    LSTM/GRU     │
                    └────────┬────────┘
                             │
    ┌─────────────┐   ┌──────▼──────┐   ┌─────────────┐
    │   Twitter   │   │             │   │   YouTube   │
    │  Sentiment  │──▶│   CONCAT    │◀──│   Volume    │
    │  (RoBERTa)  │   │             │   │             │
    └─────────────┘   └──────┬──────┘   └─────────────┘
                             │
                    ┌────────▼────────┐
                    │  Dense Layers   │
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
        ┌──────────┐  ┌──────────┐  ┌──────────┐
        │Direction │  │Magnitude │  │ Timing   │
        │ (±1, 0)  │  │  (% Δ)   │  │ (Days)   │
        └──────────┘  └──────────┘  └──────────┘
```

### 6.3 Feature Engineering for Social Signals

```typescript
interface SocialSentimentFeatures {
  // === TWITTER/X SIGNALS ===
  tweetVolume24h: number;        // Tweets mentioning card
  tweetVolume7d: number;         // Weekly volume
  volumeChangeRate: number;      // (24h / 7d_avg) - 1
  sentimentScore: number;        // -1 to 1 (negative to positive)
  sentimentChange: number;       // Sentiment delta from yesterday
  influencerMentions: number;    // Mentions by accounts >10k followers
  viralTweetFlag: boolean;       // Any tweet >1000 engagements

  // === YOUTUBE SIGNALS ===
  videoCount24h: number;         // New videos featuring card
  totalViews24h: number;         // Views on card-related videos
  avgViewsPerVideo: number;      // Engagement level
  topCreatorMention: boolean;    // Featured by major channel
  openingVideoSpike: boolean;    // Pack opening featuring this card

  // === REDDIT SIGNALS ===
  postVolume24h: number;         // Posts in relevant subreddits
  commentVolume24h: number;      // Discussion depth
  upvoteRatio: number;           // Community sentiment
  priceDiscussionFlag: boolean;  // Posts about buying/selling

  // === TOURNAMENT SIGNALS ===
  recentTopCut: boolean;         // In top 8 of recent event
  deckInclusionRate: number;     // % of decks running this card
  metaRelevanceScore: number;    // Competitive importance

  // === ANIME/MEDIA SIGNALS ===
  recentEpisodeFeature: boolean; // Character in recent episode
  episodeHypeScore: number;      // Social reaction to episode
  upcomingArcRelevance: number;  // Character importance in upcoming story

  // === DERIVED SIGNALS ===
  buzzScore: number;             // Composite of all social metrics
  buzzAcceleration: number;      // Rate of change of buzz
  priceToSocialRatio: number;    // Is price lagging social interest?
}
```

### 6.4 Data Collection Pipeline

```python
import tweepy
from googleapiclient.discovery import build
import praw

class SocialDataCollector:
    """
    Collect social signals for TCG cards.
    """

    def __init__(self, config):
        self.twitter = tweepy.Client(bearer_token=config['twitter_bearer'])
        self.youtube = build('youtube', 'v3', developerKey=config['youtube_key'])
        self.reddit = praw.Reddit(**config['reddit'])

    def collect_twitter_signals(self, card_name: str, hours: int = 24) -> dict:
        """Collect Twitter mentions and sentiment."""
        query = f'"{card_name}" (pokemon OR tcg OR onepiece OR card) -is:retweet'

        tweets = self.twitter.search_recent_tweets(
            query=query,
            max_results=100,
            tweet_fields=['created_at', 'public_metrics', 'author_id'],
            start_time=datetime.utcnow() - timedelta(hours=hours),
        )

        if not tweets.data:
            return {'volume': 0, 'sentiment': 0, 'engagement': 0}

        # Analyze sentiment with RoBERTa
        sentiments = [self.analyze_sentiment(t.text) for t in tweets.data]

        # Calculate metrics
        total_engagement = sum(
            t.public_metrics['like_count'] +
            t.public_metrics['retweet_count'] +
            t.public_metrics['reply_count']
            for t in tweets.data
        )

        return {
            'volume': len(tweets.data),
            'sentiment': np.mean(sentiments),
            'engagement': total_engagement,
            'viral_tweets': sum(1 for t in tweets.data
                               if t.public_metrics['like_count'] > 100),
        }

    def collect_youtube_signals(self, card_name: str, days: int = 7) -> dict:
        """Collect YouTube video metrics."""
        search_response = self.youtube.search().list(
            q=f'{card_name} tcg card',
            part='snippet',
            type='video',
            publishedAfter=(datetime.utcnow() - timedelta(days=days)).isoformat() + 'Z',
            maxResults=50,
        ).execute()

        if not search_response['items']:
            return {'video_count': 0, 'total_views': 0}

        video_ids = [item['id']['videoId'] for item in search_response['items']]

        videos_response = self.youtube.videos().list(
            id=','.join(video_ids),
            part='statistics',
        ).execute()

        total_views = sum(
            int(v['statistics'].get('viewCount', 0))
            for v in videos_response['items']
        )

        return {
            'video_count': len(video_ids),
            'total_views': total_views,
            'avg_views': total_views / len(video_ids) if video_ids else 0,
        }

    def calculate_buzz_score(self, twitter: dict, youtube: dict, reddit: dict) -> float:
        """
        Calculate composite buzz score from all social signals.

        Returns: 0-100 score (higher = more buzz)
        """
        # Normalize each signal to 0-1 range using historical percentiles
        twitter_norm = min(1, twitter['volume'] / 50) * 0.4  # 40% weight
        youtube_norm = min(1, youtube['total_views'] / 10000) * 0.3  # 30% weight
        reddit_norm = min(1, reddit.get('post_count', 0) / 20) * 0.2  # 20% weight
        sentiment_bonus = (twitter['sentiment'] + 1) / 2 * 0.1  # 10% weight

        buzz_score = (twitter_norm + youtube_norm + reddit_norm + sentiment_bonus) * 100

        return min(100, buzz_score)
```

### 6.5 Alert Output Format

```json
{
  "alert_type": "SOCIAL_SURGE_DETECTED",
  "confidence": 0.82,
  "card": {
    "name": "Roronoa Zoro (SP)",
    "set": "OP01",
    "current_price": 45.00
  },
  "social_signals": {
    "buzz_score": 78,
    "buzz_change_24h": "+156%",
    "twitter_volume": 342,
    "twitter_sentiment": 0.72,
    "youtube_videos_24h": 5,
    "youtube_views_24h": 45000,
    "trigger_event": "Featured in viral TikTok opening"
  },
  "prediction": {
    "direction": "UP",
    "magnitude": "+25-40%",
    "timeframe": "3-7 days",
    "confidence": 0.78
  },
  "action": {
    "recommendation": "BUY",
    "entry_price": "< $48",
    "target_price": "$60-65",
    "stop_loss": "$40",
    "position_size": "2-5% of portfolio"
  },
  "risk_factors": [
    "Sentiment could be temporary",
    "Reprint announcement would invalidate thesis"
  ]
}
```

### 6.6 Social Signal Integration Strategy

**Architecture Overview**: Multi-platform ingestion pipeline with unified sentiment scoring.

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                     SOCIAL SIGNAL INTEGRATION PIPELINE                           │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│   ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐     │
│   │   Twitter   │    │   YouTube   │    │   Reddit    │    │   Discord   │     │
│   │   (X) API   │    │  Data API   │    │    API      │    │   Webhooks  │     │
│   └──────┬──────┘    └──────┬──────┘    └──────┬──────┘    └──────┬──────┘     │
│          │                  │                  │                  │             │
│   Rate: 500/15min    Rate: 10k/day      Rate: 60/min       Rate: Unlimited     │
│          │                  │                  │                  │             │
│          └──────────────────┴─────────┬────────┴──────────────────┘             │
│                                       ▼                                         │
│                        ┌──────────────────────────┐                            │
│                        │    Message Queue (SQS)   │                            │
│                        │  - Raw social mentions   │                            │
│                        │  - Deduplicated by hash  │                            │
│                        └───────────┬──────────────┘                            │
│                                    │                                            │
│                                    ▼                                            │
│                        ┌──────────────────────────┐                            │
│                        │   Entity Recognition     │                            │
│                        │  - Card name matching    │                            │
│                        │  - Set code extraction   │                            │
│                        │  - Variant detection     │                            │
│                        └───────────┬──────────────┘                            │
│                                    │                                            │
│                        ┌───────────┴───────────┐                               │
│                        ▼                       ▼                                │
│            ┌─────────────────────┐  ┌─────────────────────┐                   │
│            │ Sentiment Analysis  │  │   Volume Counter    │                   │
│            │ (RoBERTa Fine-tuned)│  │ (Redis Time Series) │                   │
│            └──────────┬──────────┘  └──────────┬──────────┘                   │
│                       │                        │                               │
│                       └────────────┬───────────┘                               │
│                                    ▼                                            │
│                        ┌──────────────────────────┐                            │
│                        │    Signal Aggregator     │                            │
│                        │  - Buzz score calc       │                            │
│                        │  - Acceleration calc     │                            │
│                        │  - Anomaly detection     │                            │
│                        └───────────┬──────────────┘                            │
│                                    │                                            │
│                                    ▼                                            │
│                        ┌──────────────────────────┐                            │
│                        │   PostgreSQL + TimescaleDB│                           │
│                        │  social_signals table    │                            │
│                        └──────────────────────────┘                            │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

#### API Configuration Details

```typescript
// src/social/config.ts
export const SOCIAL_API_CONFIG = {
  twitter: {
    // Twitter API v2 - Academic Research or Enterprise tier recommended
    baseUrl: 'https://api.twitter.com/2',
    endpoints: {
      search: '/tweets/search/recent',  // 7-day lookback
      counts: '/tweets/counts/recent',   // Volume without content
    },
    rateLimit: {
      searchPerMinute: 450,     // App-level
      countsPerMinute: 300,
    },
    // Card name queries with TCG context
    buildQuery: (cardName: string, game: string) => {
      const gameTerms = {
        onepiece: 'optcg OR "one piece tcg"',
        pokemon: 'pokemon tcg OR ptcg',
        mtg: 'mtg OR "magic the gathering"',
        yugioh: 'yugioh OR ygo',
      };
      return `"${cardName}" (${gameTerms[game] || game}) -is:retweet lang:en`;
    },
  },

  youtube: {
    // YouTube Data API v3
    baseUrl: 'https://www.googleapis.com/youtube/v3',
    endpoints: {
      search: '/search',
      videos: '/videos',        // For stats
      channels: '/channels',    // For creator verification
    },
    quotaCost: {
      search: 100,              // 100 units per search
      videos: 1,                // 1 unit per video detail
    },
    dailyQuota: 10000,          // Free tier
    // Search for card openings, deck profiles, market updates
    buildQuery: (cardName: string, game: string) => {
      return `${cardName} ${game} tcg opening OR pull OR market OR price`;
    },
  },

  reddit: {
    // Reddit API via PRAW or official API
    baseUrl: 'https://oauth.reddit.com',
    rateLimit: {
      requestsPerMinute: 60,    // With OAuth
    },
    // Relevant subreddits by game
    subreddits: {
      onepiece: ['OnePieceTCG', 'OnePieceCard'],
      pokemon: ['PokemonTCG', 'pokemoncardcollectors', 'PokeInvesting'],
      mtg: ['magicTCG', 'mtgfinance', 'EDH'],
      yugioh: ['yugioh', 'YuGiOhMasterDuel'],
    },
  },

  discord: {
    // Discord via bot in relevant servers
    // Requires server-specific bot setup
    servers: {
      onepiece: ['OP TCG Community', 'Bandai TCG'],
      pokemon: ['Pokemon TCG', 'Pokemart'],
    },
    webhookUrl: process.env.DISCORD_WEBHOOK_URL,
  },
};
```

#### Sentiment Model Training

```python
# src/social/sentiment_model.py
from transformers import RobertaTokenizer, RobertaForSequenceClassification
from torch.utils.data import DataLoader
import torch

class TCGSentimentAnalyzer:
    """
    Fine-tuned RoBERTa model for TCG-specific sentiment analysis.

    Training data sources:
    1. Twitter mentions with engagement metrics as proxy labels
    2. Reddit posts with upvote/downvote ratios
    3. Discord messages from trading channels
    """

    def __init__(self, model_path: str = 'roberta-base'):
        self.tokenizer = RobertaTokenizer.from_pretrained(model_path)
        self.model = RobertaForSequenceClassification.from_pretrained(
            model_path,
            num_labels=3,  # Negative, Neutral, Positive
        )

        # TCG-specific vocabulary additions
        self.tcg_terms = {
            'positive': ['alt art', 'chase', 'grail', 'gem', 'fire', 'banger',
                        'stonks', 'moon', 'pump', 'spike', 'sealed', 'mint'],
            'negative': ['reprint', 'ban', 'rotation', 'crash', 'dump', 'scam',
                        'fake', 'whitening', 'damaged', 'centering'],
            'neutral': ['listing', 'market', 'price', 'sold', 'comps'],
        }

    def preprocess_tcg_text(self, text: str) -> str:
        """Normalize TCG-specific language."""
        # Expand common abbreviations
        replacements = {
            'NM': 'near mint',
            'LP': 'lightly played',
            'PSA': 'graded',
            'BGS': 'graded',
            'CGC': 'graded',
            'SP': 'special art',
            'SR': 'secret rare',
            'UR': 'ultra rare',
            'FA': 'full art',
            'AA': 'alternate art',
        }
        for abbr, full in replacements.items():
            text = text.replace(abbr, full)
        return text

    def analyze(self, text: str) -> dict:
        """
        Analyze sentiment of TCG-related text.

        Returns:
            {
                'sentiment': -1 to 1 (negative to positive),
                'confidence': 0 to 1,
                'label': 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE',
            }
        """
        processed = self.preprocess_tcg_text(text)
        inputs = self.tokenizer(
            processed,
            return_tensors='pt',
            truncation=True,
            max_length=512
        )

        with torch.no_grad():
            outputs = self.model(**inputs)
            probs = torch.softmax(outputs.logits, dim=1)[0]

        labels = ['NEGATIVE', 'NEUTRAL', 'POSITIVE']
        label_idx = probs.argmax().item()

        # Convert to -1 to 1 scale
        sentiment = (probs[2] - probs[0]).item()

        return {
            'sentiment': sentiment,
            'confidence': probs[label_idx].item(),
            'label': labels[label_idx],
            'probabilities': {
                'negative': probs[0].item(),
                'neutral': probs[1].item(),
                'positive': probs[2].item(),
            }
        }

    def fine_tune(self, training_data: list, epochs: int = 3):
        """
        Fine-tune on TCG-specific data.

        training_data: [{'text': str, 'label': 0|1|2, 'weight': float}]

        Label assignment strategy:
        - Twitter: engagement_rate > avg → positive, < avg → negative
        - Reddit: upvote_ratio > 0.7 → positive, < 0.3 → negative
        - Manual labeling for edge cases
        """
        # Implementation details...
        pass


class SocialSignalAggregator:
    """
    Combine signals from multiple platforms into unified metrics.
    """

    def __init__(self, redis_client, db_client):
        self.redis = redis_client
        self.db = db_client
        self.sentiment_model = TCGSentimentAnalyzer()

    async def calculate_card_buzz(
        self,
        card_id: str,
        hours: int = 24
    ) -> dict:
        """
        Calculate buzz score for a card.

        Combines:
        - Twitter mention volume and sentiment
        - YouTube video count and views
        - Reddit post count and upvotes
        - Discord message count (if available)
        """
        # Get platform signals
        twitter = await self.get_twitter_signals(card_id, hours)
        youtube = await self.get_youtube_signals(card_id, hours)
        reddit = await self.get_reddit_signals(card_id, hours)

        # Calculate component scores (0-100 each)
        twitter_score = self._normalize_twitter(twitter)
        youtube_score = self._normalize_youtube(youtube)
        reddit_score = self._normalize_reddit(reddit)

        # Weighted combination
        weights = {'twitter': 0.40, 'youtube': 0.35, 'reddit': 0.25}

        buzz_score = (
            twitter_score * weights['twitter'] +
            youtube_score * weights['youtube'] +
            reddit_score * weights['reddit']
        )

        # Calculate acceleration (rate of change)
        previous_buzz = await self.get_previous_buzz(card_id, hours * 2)
        acceleration = (buzz_score - previous_buzz) / max(1, previous_buzz)

        # Sentiment-weighted adjustment
        avg_sentiment = (
            twitter['sentiment'] * 0.4 +
            reddit.get('sentiment', 0) * 0.3 +
            0.3  # Neutral default for YouTube
        )

        # Positive sentiment amplifies buzz
        sentiment_multiplier = 1 + (avg_sentiment * 0.2)
        adjusted_buzz = buzz_score * sentiment_multiplier

        return {
            'card_id': card_id,
            'buzz_score': min(100, adjusted_buzz),
            'buzz_acceleration': acceleration,
            'sentiment': avg_sentiment,
            'components': {
                'twitter': {'score': twitter_score, **twitter},
                'youtube': {'score': youtube_score, **youtube},
                'reddit': {'score': reddit_score, **reddit},
            },
            'timestamp': datetime.utcnow().isoformat(),
        }

    def _normalize_twitter(self, signals: dict) -> float:
        """Normalize Twitter signals to 0-100."""
        # Based on historical percentiles
        volume_score = min(100, signals['volume'] / 50 * 100)
        engagement_score = min(100, signals['engagement'] / 1000 * 100)
        viral_bonus = 20 if signals['viral_tweets'] > 0 else 0

        return (volume_score * 0.5 + engagement_score * 0.3 + viral_bonus * 0.2)

    def _normalize_youtube(self, signals: dict) -> float:
        """Normalize YouTube signals to 0-100."""
        video_score = min(100, signals['video_count'] / 5 * 100)
        views_score = min(100, signals['total_views'] / 50000 * 100)
        creator_bonus = 25 if signals.get('top_creator_mention') else 0

        return (video_score * 0.3 + views_score * 0.5 + creator_bonus * 0.2)

    def _normalize_reddit(self, signals: dict) -> float:
        """Normalize Reddit signals to 0-100."""
        post_score = min(100, signals.get('post_count', 0) / 10 * 100)
        comment_score = min(100, signals.get('comment_count', 0) / 100 * 100)
        upvote_score = min(100, signals.get('total_upvotes', 0) / 500 * 100)

        return (post_score * 0.3 + comment_score * 0.3 + upvote_score * 0.4)
```

#### Database Schema for Social Signals

```sql
-- Social signals time-series table (TimescaleDB recommended)
CREATE TABLE social_signals (
    id BIGSERIAL,
    card_id VARCHAR(50) NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Aggregate metrics
    buzz_score DECIMAL(5,2),
    buzz_acceleration DECIMAL(5,4),
    sentiment_score DECIMAL(4,3),  -- -1.000 to 1.000

    -- Platform breakdowns
    twitter_volume INTEGER,
    twitter_sentiment DECIMAL(4,3),
    twitter_engagement INTEGER,
    twitter_viral_count INTEGER,

    youtube_video_count INTEGER,
    youtube_total_views BIGINT,
    youtube_top_creator BOOLEAN DEFAULT FALSE,

    reddit_post_count INTEGER,
    reddit_comment_count INTEGER,
    reddit_upvotes INTEGER,
    reddit_sentiment DECIMAL(4,3),

    -- Trigger events (nullable)
    trigger_event VARCHAR(255),  -- e.g., "Featured in viral TikTok"
    trigger_url TEXT,

    PRIMARY KEY (id, timestamp)
);

-- Convert to hypertable for time-series optimization
SELECT create_hypertable('social_signals', 'timestamp');

-- Index for fast card lookups
CREATE INDEX idx_social_signals_card_time
ON social_signals (card_id, timestamp DESC);

-- Continuous aggregate for hourly summaries
CREATE MATERIALIZED VIEW social_signals_hourly
WITH (timescaledb.continuous) AS
SELECT
    card_id,
    time_bucket('1 hour', timestamp) AS hour,
    AVG(buzz_score) AS avg_buzz,
    MAX(buzz_score) AS max_buzz,
    AVG(sentiment_score) AS avg_sentiment,
    SUM(twitter_volume) AS total_twitter_volume,
    SUM(youtube_total_views) AS total_youtube_views
FROM social_signals
GROUP BY card_id, time_bucket('1 hour', timestamp);
```

---

## 7. Opportunity 5: Tournament Meta Prediction

### 7.1 Value Proposition

**Goal**: Predict which cards will spike based on tournament performance before prices adjust.

**Information Flow**:
```
Tournament Results → Reddit/Twitter → Price Aggregators → Market Prices
     (T+0)              (T+1-6h)          (T+6-24h)         (T+24-72h)

     ◄─────────────── EDGE WINDOW ───────────────►
```

**Key Insight**: Cards appearing in Top 8 decklists typically spike 30-100% within 1 week.

### 7.2 Model Design

**Model Type**: Gradient Boosting (XGBoost/LightGBM) with tournament features

```python
def predict_meta_spike(card_id, tournament_data, historical_prices):
    """
    Predict if a card will spike from tournament results.

    Args:
        card_id: Card identifier
        tournament_data: Recent tournament results
        historical_prices: Price history for the card

    Returns:
        Spike prediction with confidence
    """
    features = extract_tournament_features(card_id, tournament_data)

    # Model outputs
    spike_probability = model.predict_proba(features)[1]
    spike_magnitude = magnitude_model.predict(features)

    # Decision logic
    if spike_probability > 0.7 and spike_magnitude > 0.20:
        action = 'STRONG_BUY'
    elif spike_probability > 0.5 and spike_magnitude > 0.15:
        action = 'BUY'
    else:
        action = 'HOLD'

    return {
        'card_id': card_id,
        'spike_probability': spike_probability,
        'expected_magnitude': spike_magnitude,
        'action': action,
        'reasoning': generate_reasoning(features),
    }

def extract_tournament_features(card_id, tournament_data):
    """Extract features from tournament data."""
    return {
        # Recent performance
        'top8_appearances_7d': count_top8(card_id, tournament_data, days=7),
        'top8_appearances_30d': count_top8(card_id, tournament_data, days=30),
        'win_rate_with_card': calculate_win_rate(card_id, tournament_data),

        # Meta context
        'meta_share': get_meta_share(card_id, tournament_data),
        'meta_share_change': get_meta_share_delta(card_id, tournament_data),
        'is_new_tech': is_first_appearance(card_id, tournament_data),
        'counter_to_top_deck': is_counter(card_id, get_top_deck(tournament_data)),

        # Card characteristics
        'copies_per_deck': avg_copies_per_deck(card_id, tournament_data),
        'deck_diversity': count_unique_decks(card_id, tournament_data),

        # Historical patterns
        'previous_spike_on_top8': has_spiked_before(card_id),
        'price_vs_90d_avg': current_price_ratio(card_id),
    }
```

### 7.3 Data Sources

| Source | Data Available | Update Frequency |
|--------|---------------|------------------|
| [Limitless TCG](https://limitlesstcg.com/) | Pokemon decklists, results | Daily |
| [Yu-Gi-Oh Meta](https://www.yugiohmeta.com/) | YGO decklists, tier lists | Daily |
| [MTG Goldfish](https://www.mtggoldfish.com/) | MTG metagame, prices | Real-time |
| [One Piece Top Decks](https://onepiecetopdecks.com/) | OPTCG tournament results | Weekly |

---

## 8. Opportunity 6: Trade-In Value Optimization

### 8.1 Value Proposition

**Goal**: Maximize profit from trade-in operations by identifying optimal buy prices.

**Our Unique Advantage**: As a trade-in business, we can profit when:
1. Trade-in value > acquisition cost (direct profit)
2. Market price trajectory suggests holding for resale
3. Bulk submissions contain misidentified high-value cards

### 8.2 Model Design

**Model Type**: Multi-objective Optimization

**Objectives**:
1. Maximize trade-in margin: (trade_in_value - acquisition_cost) / acquisition_cost
2. Minimize inventory risk: Consider price volatility and sell-through rate
3. Optimize cash flow: Balance margin vs. turnover speed

```python
def optimize_trade_in_offer(card, customer_asking_price, inventory_status):
    """
    Calculate optimal offer for a trade-in card.

    Returns offer price that maximizes expected profit while remaining competitive.
    """
    # Get current market data
    market_price = get_market_price(card['card_id'])
    price_trend = get_price_trend(card['card_id'], days=30)
    volatility = get_volatility(card['card_id'], days=30)
    sell_through_days = get_avg_sell_through(card['card_id'])

    # Condition adjustment
    condition_multiplier = {
        'NM': 0.70,   # 70% of market for Near Mint
        'LP': 0.55,
        'MP': 0.40,
        'HP': 0.25,
        'DMG': 0.10,
    }

    # Base trade-in value
    base_trade_in = market_price * condition_multiplier[card['condition']]

    # Adjustments
    # 1. Trend adjustment: Pay more for rising cards, less for falling
    trend_adjustment = 1 + (price_trend * 0.1)  # ±10% based on trend

    # 2. Volatility penalty: Pay less for volatile cards (higher risk)
    volatility_penalty = max(0.9, 1 - volatility * 0.2)

    # 3. Inventory adjustment: Pay less if we have excess inventory
    inventory_penalty = 1.0 if inventory_status[card['card_id']] < 5 else 0.95

    # 4. Sell-through adjustment: Pay more for fast-selling cards
    sellthrough_bonus = 1 + (1 / max(1, sell_through_days)) * 0.1

    adjusted_trade_in = (
        base_trade_in
        * trend_adjustment
        * volatility_penalty
        * inventory_penalty
        * sellthrough_bonus
    )

    # Ensure minimum margin
    min_margin = 0.15  # 15% minimum margin
    max_offer = market_price * (1 - min_margin)

    optimal_offer = min(adjusted_trade_in, max_offer)

    # Compare to customer's asking price
    if customer_asking_price <= optimal_offer:
        decision = 'ACCEPT'
        profit_estimate = optimal_offer - customer_asking_price
    elif customer_asking_price <= optimal_offer * 1.1:
        decision = 'COUNTER'
        counter_offer = optimal_offer
    else:
        decision = 'DECLINE'
        counter_offer = optimal_offer

    return {
        'decision': decision,
        'offer': optimal_offer,
        'market_price': market_price,
        'expected_margin': (market_price - optimal_offer) / optimal_offer,
        'reasoning': {
            'base_trade_in': base_trade_in,
            'trend_adjustment': trend_adjustment,
            'volatility_penalty': volatility_penalty,
            'inventory_status': inventory_status[card['card_id']],
        }
    }
```

### 8.3 Bulk Submission Scanner

**Goal**: Identify high-value cards in bulk trade-in submissions that may be undervalued.

```python
def scan_bulk_submission(submission_items):
    """
    Scan a bulk trade-in submission for hidden value.

    Identifies:
    1. Misidentified variants (SP marked as base)
    2. Condition upgrades (LP that looks NM)
    3. Cards with recent price spikes customer may not know about
    """
    alerts = []

    for item in submission_items:
        # Check for variant misidentification
        if is_likely_variant(item['image'], item['card_id']):
            variant_value = get_variant_price(item['card_id'])
            base_value = get_base_price(item['card_id'])

            if variant_value > base_value * 1.5:
                alerts.append({
                    'type': 'VARIANT_MISIDENTIFICATION',
                    'item': item,
                    'customer_value': base_value,
                    'actual_value': variant_value,
                    'hidden_profit': variant_value - base_value,
                })

        # Check for condition upgrade potential
        predicted_condition = predict_condition(item['image'])
        if condition_rank(predicted_condition) > condition_rank(item['stated_condition']):
            upgrade_value = get_price_for_condition(item['card_id'], predicted_condition)
            stated_value = get_price_for_condition(item['card_id'], item['stated_condition'])

            alerts.append({
                'type': 'CONDITION_UPGRADE',
                'item': item,
                'stated_condition': item['stated_condition'],
                'predicted_condition': predicted_condition,
                'value_difference': upgrade_value - stated_value,
            })

        # Check for recent price spikes
        recent_change = get_price_change(item['card_id'], days=7)
        if recent_change > 0.20:  # >20% increase in 7 days
            alerts.append({
                'type': 'RECENT_SPIKE',
                'item': item,
                'price_change_7d': recent_change,
                'customer_may_use_outdated_price': True,
            })

    return alerts
```

---

## 9. Model Training Pipeline

### 9.1 Unified Training Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      VALUE-ALIGNED TRAINING PIPELINE                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                         DATA COLLECTION                               │   │
│  │                                                                       │   │
│  │   Prices      Social       Tournaments    Listings      Images       │   │
│  │   (APIs)      (Twitter)    (Limitless)    (Scraped)     (CDN)        │   │
│  │      │            │             │             │            │          │   │
│  │      └────────────┴──────┬──────┴─────────────┴────────────┘          │   │
│  │                          ▼                                            │   │
│  │                   ┌─────────────┐                                    │   │
│  │                   │  Data Lake  │                                    │   │
│  │                   │    (S3)     │                                    │   │
│  │                   └──────┬──────┘                                    │   │
│  └──────────────────────────┼───────────────────────────────────────────┘   │
│                             │                                                │
│  ┌──────────────────────────▼───────────────────────────────────────────┐   │
│  │                      FEATURE ENGINEERING                              │   │
│  │                                                                       │   │
│  │   ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐   │   │
│  │   │ Price   │  │ Social  │  │ Volume  │  │  Meta   │  │ Image   │   │   │
│  │   │Features │  │Features │  │Features │  │Features │  │Features │   │   │
│  │   └────┬────┘  └────┬────┘  └────┬────┘  └────┬────┘  └────┬────┘   │   │
│  │        │            │            │            │            │         │   │
│  │        └────────────┴─────┬──────┴────────────┴────────────┘         │   │
│  │                           ▼                                          │   │
│  │                  ┌────────────────┐                                  │   │
│  │                  │ Feature Store  │                                  │   │
│  │                  │   (Redis)      │                                  │   │
│  │                  └───────┬────────┘                                  │   │
│  └──────────────────────────┼───────────────────────────────────────────┘   │
│                             │                                                │
│  ┌──────────────────────────▼───────────────────────────────────────────┐   │
│  │                      MODEL TRAINING                                   │   │
│  │                                                                       │   │
│  │   ┌───────────────┐  ┌───────────────┐  ┌───────────────┐           │   │
│  │   │   SNIPER      │  │   SENTIMENT   │  │   CONDITION   │           │   │
│  │   │   MODEL       │  │   MODEL       │  │   MODEL       │           │   │
│  │   │ (Isolation    │  │ (LSTM +       │  │ (CNN +        │           │   │
│  │   │  Forest)      │  │  RoBERTa)     │  │  XGBoost)     │           │   │
│  │   └───────┬───────┘  └───────┬───────┘  └───────┬───────┘           │   │
│  │           │                  │                  │                    │   │
│  │   ┌───────────────┐  ┌───────────────┐  ┌───────────────┐           │   │
│  │   │   ARBITRAGE   │  │   META        │  │   TRADE-IN    │           │   │
│  │   │   MODEL       │  │   MODEL       │  │   MODEL       │           │   │
│  │   │ (Multi-output │  │ (XGBoost)     │  │ (Optimization)│           │   │
│  │   │  Regression)  │  │               │  │               │           │   │
│  │   └───────┬───────┘  └───────┬───────┘  └───────┬───────┘           │   │
│  │           │                  │                  │                    │   │
│  │           └──────────────────┼──────────────────┘                    │   │
│  │                              ▼                                       │   │
│  │                     ┌────────────────┐                               │   │
│  │                     │ Model Registry │                               │   │
│  │                     │   (MLflow)     │                               │   │
│  │                     └────────────────┘                               │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                      INFERENCE & ALERTS                               │   │
│  │                                                                       │   │
│  │   Real-time     ──►  Model Ensemble  ──►  Alert Engine  ──►  Action  │   │
│  │   Data Stream        Predictions          (Discord/API)      Queue   │   │
│  │                                                                       │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 9.2 Model Evaluation Metrics

**Critical Insight**: Optimize for PROFIT, not prediction accuracy.

| Model | Primary Metric | Secondary Metrics |
|-------|---------------|-------------------|
| **Sniper** | Precision @ top 100 | ROI per alert, False positive rate |
| **Sentiment** | Profit per trade | Direction accuracy, Timing accuracy |
| **Condition** | Grading ROI | Grade accuracy, Cost per miss |
| **Arbitrage** | Net profit after costs | Win rate, Avg profit per trade |
| **Meta** | Profit from recommendations | Spike detection recall |
| **Trade-In** | Margin per transaction | Competitive win rate |

```python
def evaluate_sniper_model(predictions, outcomes):
    """
    Evaluate sniper model on profit metrics.

    The goal is NOT to predict all underpriced listings,
    but to have HIGH PRECISION on the ones we flag.
    """
    # Get top 100 predictions by confidence
    top_predictions = sorted(predictions, key=lambda x: x['confidence'], reverse=True)[:100]

    # Calculate metrics
    true_positives = 0
    total_profit = 0
    total_invested = 0

    for pred in top_predictions:
        listing_id = pred['listing_id']
        outcome = outcomes.get(listing_id)

        if outcome and outcome['sold_within_1h']:
            true_positives += 1
            if outcome['resale_price']:
                profit = outcome['resale_price'] - pred['listing_price']
                total_profit += profit
                total_invested += pred['listing_price']

    precision = true_positives / len(top_predictions)
    roi = total_profit / total_invested if total_invested > 0 else 0

    return {
        'precision_at_100': precision,
        'total_profit': total_profit,
        'roi': roi,
        'avg_profit_per_alert': total_profit / true_positives if true_positives > 0 else 0,
    }
```

### 9.3 Unified Alert Engine

**Purpose**: Coordinate outputs from all models into actionable alerts with priority ranking.

```typescript
// src/alerts/alert-engine.ts

interface ModelPrediction {
  model: 'sniper' | 'sentiment' | 'condition' | 'arbitrage' | 'meta' | 'tradeIn';
  cardId: string;
  confidence: number;
  prediction: Record<string, any>;
  timestamp: Date;
}

interface Alert {
  id: string;
  type: AlertType;
  priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  card: {
    id: string;
    name: string;
    set: string;
    currentPrice: number;
  };
  action: 'BUY' | 'SELL' | 'HOLD' | 'GRADE' | 'TRADE_IN';
  reasoning: string[];
  signals: ModelPrediction[];
  expectedROI: number;
  confidence: number;
  expiresAt: Date;
  createdAt: Date;
}

type AlertType =
  | 'UNDERPRICED_LISTING'
  | 'SOCIAL_SURGE'
  | 'TOURNAMENT_SPIKE'
  | 'ARBITRAGE_OPPORTUNITY'
  | 'GRADING_CANDIDATE'
  | 'TRADE_IN_UPGRADE'
  | 'PRICE_CRASH_WARNING';

class AlertEngine {
  private models: Map<string, Model>;
  private alertQueue: Alert[] = [];
  private sentAlerts: Set<string> = new Set();

  constructor(
    private db: DatabaseClient,
    private notifier: NotificationService,
    private config: AlertConfig
  ) {}

  /**
   * Process model predictions and generate alerts.
   */
  async processSignals(predictions: ModelPrediction[]): Promise<Alert[]> {
    const alerts: Alert[] = [];

    // Group predictions by card
    const byCard = this.groupByCard(predictions);

    for (const [cardId, cardPredictions] of byCard) {
      // Check for multi-signal confluence
      const confluenceScore = this.calculateConfluence(cardPredictions);

      // Single-model alerts
      for (const pred of cardPredictions) {
        const alert = await this.evaluatePrediction(pred, confluenceScore);
        if (alert) alerts.push(alert);
      }

      // Multi-model confluence alerts (higher priority)
      if (confluenceScore > 0.7) {
        const confluenceAlert = await this.createConfluenceAlert(
          cardId,
          cardPredictions,
          confluenceScore
        );
        if (confluenceAlert) alerts.push(confluenceAlert);
      }
    }

    // Rank and filter
    const rankedAlerts = this.rankAlerts(alerts);
    const filteredAlerts = this.filterDuplicates(rankedAlerts);

    // Send top alerts
    await this.sendAlerts(filteredAlerts.slice(0, this.config.maxAlertsPerHour));

    return filteredAlerts;
  }

  /**
   * Calculate confluence score when multiple models agree.
   */
  private calculateConfluence(predictions: ModelPrediction[]): number {
    if (predictions.length < 2) return 0;

    // Check if models point in same direction
    const buySignals = predictions.filter(p =>
      this.isBuySignal(p.model, p.prediction)
    ).length;

    const totalSignals = predictions.length;
    const agreementRatio = buySignals / totalSignals;

    // Weighted by model confidence
    const avgConfidence = predictions.reduce((sum, p) => sum + p.confidence, 0) / totalSignals;

    return agreementRatio * avgConfidence;
  }

  /**
   * Create alert when multiple models agree on a card.
   */
  private async createConfluenceAlert(
    cardId: string,
    predictions: ModelPrediction[],
    confluenceScore: number
  ): Promise<Alert | null> {
    const card = await this.db.getCard(cardId);
    if (!card) return null;

    const reasoning = predictions.map(p =>
      this.getReasoningForModel(p.model, p.prediction)
    );

    // Calculate combined expected ROI
    const expectedROIs = predictions.map(p => p.prediction.expectedROI || 0);
    const combinedROI = Math.max(...expectedROIs) * (1 + confluenceScore * 0.2);

    return {
      id: `confluence-${cardId}-${Date.now()}`,
      type: 'SOCIAL_SURGE', // Default to social surge for confluence
      priority: confluenceScore > 0.85 ? 'CRITICAL' : 'HIGH',
      card: {
        id: cardId,
        name: card.name,
        set: card.setCode,
        currentPrice: card.marketPrice,
      },
      action: 'BUY',
      reasoning: [
        `🎯 Multi-signal confluence detected (${predictions.length} models agree)`,
        ...reasoning,
      ],
      signals: predictions,
      expectedROI: combinedROI,
      confidence: confluenceScore,
      expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000), // 4 hours
      createdAt: new Date(),
    };
  }

  /**
   * Rank alerts by priority and expected value.
   */
  private rankAlerts(alerts: Alert[]): Alert[] {
    const priorityWeight = {
      'CRITICAL': 1000,
      'HIGH': 100,
      'MEDIUM': 10,
      'LOW': 1,
    };

    return alerts.sort((a, b) => {
      const aScore = priorityWeight[a.priority] * a.confidence * a.expectedROI;
      const bScore = priorityWeight[b.priority] * b.confidence * b.expectedROI;
      return bScore - aScore;
    });
  }

  /**
   * Filter duplicate alerts for same card within cooldown period.
   */
  private filterDuplicates(alerts: Alert[]): Alert[] {
    return alerts.filter(alert => {
      const key = `${alert.card.id}-${alert.type}`;
      if (this.sentAlerts.has(key)) return false;
      this.sentAlerts.add(key);
      // Clean up old alerts after cooldown
      setTimeout(() => this.sentAlerts.delete(key), this.config.alertCooldownMs);
      return true;
    });
  }

  /**
   * Send alerts through configured channels.
   */
  private async sendAlerts(alerts: Alert[]): Promise<void> {
    for (const alert of alerts) {
      // Discord webhook for high priority
      if (alert.priority === 'CRITICAL' || alert.priority === 'HIGH') {
        await this.notifier.sendDiscord(this.formatDiscordAlert(alert));
      }

      // Store all alerts in database
      await this.db.saveAlert(alert);

      // Push notification for critical only
      if (alert.priority === 'CRITICAL') {
        await this.notifier.sendPush(this.formatPushAlert(alert));
      }
    }
  }

  /**
   * Format alert for Discord.
   */
  private formatDiscordAlert(alert: Alert): DiscordEmbed {
    const colorMap = {
      'CRITICAL': 0xFF0000, // Red
      'HIGH': 0xFFA500,     // Orange
      'MEDIUM': 0xFFFF00,   // Yellow
      'LOW': 0x00FF00,      // Green
    };

    return {
      title: `${alert.priority} ${alert.type.replace(/_/g, ' ')}`,
      description: alert.reasoning.join('\n'),
      color: colorMap[alert.priority],
      fields: [
        { name: 'Card', value: alert.card.name, inline: true },
        { name: 'Set', value: alert.card.set, inline: true },
        { name: 'Price', value: `$${alert.card.currentPrice.toFixed(2)}`, inline: true },
        { name: 'Action', value: alert.action, inline: true },
        { name: 'Expected ROI', value: `${(alert.expectedROI * 100).toFixed(1)}%`, inline: true },
        { name: 'Confidence', value: `${(alert.confidence * 100).toFixed(0)}%`, inline: true },
      ],
      timestamp: alert.createdAt.toISOString(),
    };
  }

  private isBuySignal(model: string, prediction: Record<string, any>): boolean {
    switch (model) {
      case 'sniper': return prediction.opportunityScore > 70;
      case 'sentiment': return prediction.direction === 'UP' && prediction.confidence > 0.6;
      case 'arbitrage': return prediction.profitMargin > 0.15;
      case 'meta': return prediction.spikeProb > 0.6;
      case 'condition': return prediction.shouldGrade && prediction.expectedROI > 0.5;
      case 'tradeIn': return prediction.margin > 0.15;
      default: return false;
    }
  }

  private getReasoningForModel(model: string, prediction: Record<string, any>): string {
    switch (model) {
      case 'sniper':
        return `📉 Listing ${prediction.discountPct.toFixed(1)}% below market (score: ${prediction.opportunityScore})`;
      case 'sentiment':
        return `📈 Social buzz score ${prediction.buzzScore} (${prediction.direction} ${prediction.magnitude})`;
      case 'arbitrage':
        return `💱 ${prediction.buyPlatform} → ${prediction.sellPlatform} spread: ${(prediction.profitMargin * 100).toFixed(1)}%`;
      case 'meta':
        return `🏆 Tournament spike probability: ${(prediction.spikeProb * 100).toFixed(0)}%`;
      case 'condition':
        return `💎 Grading ROI: ${(prediction.expectedROI * 100).toFixed(0)}% (P(PSA 9+): ${(prediction.gradeProb * 100).toFixed(0)}%)`;
      case 'tradeIn':
        return `💰 Trade-in margin: ${(prediction.margin * 100).toFixed(1)}%`;
      default:
        return `Signal from ${model}`;
    }
  }
}

interface AlertConfig {
  maxAlertsPerHour: number;
  alertCooldownMs: number;
  minConfidence: number;
  minExpectedROI: number;
}

const DEFAULT_ALERT_CONFIG: AlertConfig = {
  maxAlertsPerHour: 20,
  alertCooldownMs: 4 * 60 * 60 * 1000, // 4 hours
  minConfidence: 0.6,
  minExpectedROI: 0.15,
};
```

### 9.4 Real-time Inference Pipeline

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                        REAL-TIME INFERENCE PIPELINE                              │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│   ┌─────────────────────────────────────────────────────────────────────────┐   │
│   │                          DATA STREAMS                                    │   │
│   │                                                                          │   │
│   │   Price Feed     Social Feed    Tournament Feed    Listing Feed         │   │
│   │   (4h cycle)     (15min cycle)  (Daily)           (5min cycle)          │   │
│   │       │               │              │                 │                 │   │
│   │       └───────────────┴──────────────┴─────────────────┘                 │   │
│   │                              │                                           │   │
│   │                              ▼                                           │   │
│   │                    ┌─────────────────┐                                  │   │
│   │                    │  Kafka Topics   │                                  │   │
│   │                    │  - price.raw    │                                  │   │
│   │                    │  - social.raw   │                                  │   │
│   │                    │  - listing.raw  │                                  │   │
│   │                    └────────┬────────┘                                  │   │
│   └─────────────────────────────┼────────────────────────────────────────────┘   │
│                                 │                                                │
│   ┌─────────────────────────────▼────────────────────────────────────────────┐   │
│   │                       FEATURE STORE (Redis)                              │   │
│   │                                                                          │   │
│   │   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                 │   │
│   │   │ Price Cache  │  │ Social Cache │  │ Card Cache   │                 │   │
│   │   │ TTL: 4h      │  │ TTL: 1h      │  │ TTL: 24h     │                 │   │
│   │   └──────────────┘  └──────────────┘  └──────────────┘                 │   │
│   │                                                                          │   │
│   └─────────────────────────────┬────────────────────────────────────────────┘   │
│                                 │                                                │
│   ┌─────────────────────────────▼────────────────────────────────────────────┐   │
│   │                      MODEL INFERENCE (Lambda/ECS)                        │   │
│   │                                                                          │   │
│   │   ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐          │   │
│   │   │  Sniper    │ │ Sentiment  │ │ Arbitrage  │ │   Meta     │          │   │
│   │   │  Model     │ │ Model      │ │ Model      │ │  Model     │          │   │
│   │   │ (5min)     │ │ (1h)       │ │ (4h)       │ │ (Daily)    │          │   │
│   │   └─────┬──────┘ └─────┬──────┘ └─────┬──────┘ └─────┬──────┘          │   │
│   │         │              │              │              │                  │   │
│   │         └──────────────┴──────────────┴──────────────┘                  │   │
│   │                              │                                          │   │
│   └──────────────────────────────┼───────────────────────────────────────────┘   │
│                                  │                                               │
│   ┌──────────────────────────────▼───────────────────────────────────────────┐   │
│   │                         ALERT ENGINE                                     │   │
│   │                                                                          │   │
│   │   Confluence Detection → Priority Ranking → Deduplication → Dispatch    │   │
│   │                                                                          │   │
│   │                              │                                           │   │
│   │         ┌────────────────────┼────────────────────┐                     │   │
│   │         ▼                    ▼                    ▼                      │   │
│   │   ┌──────────┐        ┌──────────┐        ┌──────────┐                 │   │
│   │   │ Discord  │        │  Push    │        │ Database │                 │   │
│   │   │ Webhook  │        │ Notify   │        │  Store   │                 │   │
│   │   └──────────┘        └──────────┘        └──────────┘                 │   │
│   │                                                                          │   │
│   └──────────────────────────────────────────────────────────────────────────┘   │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 10. Implementation Roadmap

### Phase 1: Foundation (Weeks 1-2)
- [ ] Set up feature store infrastructure
- [ ] Implement price depth collection from all sources
- [ ] Build social signal collection pipeline (Twitter API)
- [ ] Create base training data export

### Phase 2: Sniper Model (Weeks 3-4)
- [ ] Collect listing-level data with outcomes
- [ ] Train anomaly detection model
- [ ] Build real-time alert system
- [ ] Deploy to production with monitoring

### Phase 3: Social Sentiment (Weeks 5-6)
- [ ] Integrate YouTube and Reddit data
- [ ] Train LSTM sentiment model
- [ ] Validate on historical price movements
- [ ] Create sentiment dashboard

### Phase 4: Condition & Grading (Weeks 7-8)
- [ ] Collect card images with known grades
- [ ] Train CNN grade predictor
- [ ] Build grading ROI calculator
- [ ] Integrate with trade-in workflow

### Phase 5: Tournament Meta (Weeks 9-10)
- [ ] Scrape tournament results from Limitless/etc.
- [ ] Build meta tracking features
- [ ] Train spike prediction model
- [ ] Create tournament alert system

### Phase 6: Trade-In Optimization (Weeks 11-12)
- [ ] Integrate all models into trade-in pricing
- [ ] Build bulk submission scanner
- [ ] A/B test pricing strategies
- [ ] Optimize margin vs. conversion

---

## 11. Risk Management

### 11.1 Model Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| **Overfitting** | False signals, losses | Cross-validation, holdout testing |
| **Data drift** | Degraded accuracy | Continuous monitoring, retraining |
| **Adversarial sellers** | Fake underpriced listings | Seller reputation scoring |
| **Market manipulation** | False social signals | Source verification, volume thresholds |
| **API changes** | Data collection failure | Multiple data sources, fallbacks |

### 11.2 Position Sizing

```python
def calculate_position_size(signal, portfolio_value, risk_tolerance):
    """
    Kelly Criterion-inspired position sizing.

    Never bet more than you can afford to lose.
    """
    # Estimated win probability
    win_prob = signal['confidence']

    # Estimated odds (return if win / loss if lose)
    win_return = signal['expected_roi']
    loss_return = -0.20  # Assume 20% loss on bad trades

    # Kelly fraction
    kelly = (win_prob * win_return - (1 - win_prob) * abs(loss_return)) / win_return

    # Conservative: use half Kelly
    conservative_kelly = kelly * 0.5

    # Cap at risk tolerance
    max_position = portfolio_value * risk_tolerance

    position_size = min(
        conservative_kelly * portfolio_value,
        max_position,
        signal['listing_price'] * 10  # Max 10 copies
    )

    return max(0, position_size)
```

---

## 12. Success Metrics

### 12.1 Business KPIs

| Metric | Target | Measurement |
|--------|--------|-------------|
| **Sniper ROI** | >25% per trade | (Sell price - Buy price) / Buy price |
| **Alert precision** | >70% | True positives / Total alerts |
| **Trade-in margin** | >15% | (Resale - Trade-in) / Trade-in |
| **Social signal lead time** | >3 days | Days before price moves |
| **Monthly profit** | >£5,000 | Total profit from all strategies |

### 12.2 Model KPIs

| Model | Target Metric | Threshold |
|-------|--------------|-----------|
| **Sniper** | Precision@100 | >0.70 |
| **Sentiment** | Directional accuracy | >0.65 |
| **Condition** | Grade accuracy ±1 | >0.85 |
| **Arbitrage** | Profit per trade | >£5 |
| **Meta** | Spike recall | >0.60 |

---

## References

- [Poke Plug - Pokemon Arbitrage Tool](https://www.pokeplug.io/)
- [TCG AI Pro - Grade Prediction](https://tcgai.pro/)
- [Limitless TCG - Tournament Data](https://limitlesstcg.com/)
- [Flipmine - eBay Arbitrage Engine](https://www.flipmine.com/)
- [Twitter Sentiment for Price Prediction (CEPR)](https://cepr.org/voxeu/columns/twitter-sentiment-and-stock-market-movements-predictive-power-social-media)
- [JP vs EN One Piece Price Analysis](https://www.saifrtcg.com/post/one-piece-tcg-english-vs-japanese-op08-comparison)
- [PSA Grading Standards](https://www.psacard.com/gradingstandards)
