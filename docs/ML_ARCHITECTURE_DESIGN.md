# Machine Learning Architecture Design

> **Paradigm Shift**: One neural network to rule them all → Specialized models for specialized tasks

---

## Table of Contents
1. [Architectural Philosophy](#architectural-philosophy)
2. [Model Taxonomy](#model-taxonomy)
3. [Neural Network: Vision System](#neural-network-vision-system)
4. [XGBoost/LightGBM: Demand Forecasting](#xgboostlightgbm-demand-forecasting)
5. [Logistic Regression: Listing Quality](#logistic-regression-listing-quality)
6. [Time Series: Optimal Timing](#time-series-optimal-timing)
7. [Isolation Forest: Anomaly Detection](#isolation-forest-anomaly-detection)
8. [AWS Infrastructure Design](#aws-infrastructure-design)
9. [Data Pipeline Architecture](#data-pipeline-architecture)
10. [Cost Analysis](#cost-analysis)

---

## Architectural Philosophy

### The Wrong Approach (What We Had)
```
┌─────────────────────────────────────────────────────────────────────┐
│                    MONOLITHIC NEURAL NETWORK                         │
│                                                                      │
│   125 features → LSTM → Everything                                   │
│                                                                      │
│   Problems:                                                          │
│   • Neural networks are OVERKILL for tabular data                    │
│   • XGBoost beats deep learning on structured data 90% of the time   │
│   • Time series has specialized, proven methods                      │
│   • Training is expensive and slow                                   │
│   • Single point of failure                                          │
└─────────────────────────────────────────────────────────────────────┘
```

### The Right Approach (Modular Specialists)
```
┌─────────────────────────────────────────────────────────────────────┐
│                    ENSEMBLE OF SPECIALISTS                           │
│                                                                      │
│   Each model does ONE thing exceptionally well:                      │
│                                                                      │
│   ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌────────────┐ │
│   │   NEURAL    │  │   XGBOOST   │  │   PROPHET   │  │  ISOLATION │ │
│   │   NETWORK   │  │   LIGHTGBM  │  │   ARIMA     │  │   FOREST   │ │
│   │             │  │             │  │             │  │            │ │
│   │  Images     │  │  Tabular    │  │  Time       │  │  Anomaly   │ │
│   │  Only       │  │  Data       │  │  Series     │  │  Detection │ │
│   └─────────────┘  └─────────────┘  └─────────────┘  └────────────┘ │
│         │                │                │                │        │
│         └────────────────┴────────────────┴────────────────┘        │
│                                   │                                  │
│                           ┌──────┴──────┐                           │
│                           │ ORCHESTRATOR │                           │
│                           │   (Rules +   │                           │
│                           │   Ensemble)  │                           │
│                           └─────────────┘                            │
└─────────────────────────────────────────────────────────────────────┘
```

### Why This Works Better

| Aspect | Monolithic NN | Modular Specialists |
|--------|---------------|---------------------|
| **Tabular Data** | Mediocre (NNs struggle) | Excellent (XGBoost dominates) |
| **Image Data** | Good | Excellent (specialized CNN/ViT) |
| **Time Series** | Poor | Excellent (Prophet/ARIMA) |
| **Interpretability** | Black box | XGBoost has feature importance |
| **Training Cost** | High (GPU always) | Low (CPU for most) |
| **Inference Cost** | High | Low (only GPU for images) |
| **Failure Isolation** | Total failure | Graceful degradation |
| **Update Frequency** | Retrain everything | Update individual models |

---

## Model Taxonomy

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           MODEL ECOSYSTEM                                    │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ LAYER 1: PERCEPTION (What is this listing?)                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────┐     │
│  │ NEURAL NETWORK (CNN/Vision Transformer)                            │     │
│  │                                                                     │     │
│  │ Input: Card images from listings                                   │     │
│  │                                                                     │     │
│  │ Outputs:                                                           │     │
│  │   • Card identification (which card is this?)                      │     │
│  │   • Language detection (EN/JP/DE/FR/etc)                           │     │
│  │   • Condition grading (NM/LP/MP/HP/DMG)                            │     │
│  │   • Variant detection (parallel/SP/manga/etc)                      │     │
│  │   • Authenticity score (real vs counterfeit probability)           │     │
│  │   • Grading potential (PSA 10 probability)                         │     │
│  │   • Centering analysis (for grading submission decisions)          │     │
│  └────────────────────────────────────────────────────────────────────┘     │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ LAYER 2: EVALUATION (Is this a good deal?)                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────┐    ┌─────────────────────────────┐        │
│  │ ISOLATION FOREST            │    │ LOGISTIC REGRESSION         │        │
│  │                             │    │                             │        │
│  │ Price Anomaly Detection     │    │ Listing Quality Scoring     │        │
│  │                             │    │                             │        │
│  │ • Is price abnormally low?  │    │ • Fake probability          │        │
│  │ • Is price abnormally high? │    │ • Misgraded probability     │        │
│  │ • Data error detection      │    │ • Scam probability          │        │
│  │ • Market dislocation        │    │ • Seller reliability        │        │
│  └─────────────────────────────┘    └─────────────────────────────┘        │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ LAYER 3: PREDICTION (What will happen?)                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────┐    ┌─────────────────────────────┐        │
│  │ XGBOOST / LIGHTGBM          │    │ PROPHET / ARIMA             │        │
│  │                             │    │                             │        │
│  │ Demand Forecasting          │    │ Optimal Timing              │        │
│  │                             │    │                             │        │
│  │ • Will price increase?      │    │ • Seasonal patterns         │        │
│  │ • Appreciation probability  │    │ • Best time to buy          │        │
│  │ • Expected return (7/30/90d)│    │ • Best time to sell         │        │
│  │ • Confidence interval       │    │ • Holiday effects           │        │
│  │ • Feature importance        │    │ • Set release impact        │        │
│  └─────────────────────────────┘    └─────────────────────────────┘        │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ LAYER 4: DECISION (What should I do?)                                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────┐     │
│  │ ORCHESTRATOR (Rule-based + Ensemble)                               │     │
│  │                                                                     │     │
│  │ Combines all model outputs into actionable recommendations:        │     │
│  │                                                                     │     │
│  │   IF anomaly_detected AND NOT suspicious_listing:                  │     │
│  │     → ARBITRAGE OPPORTUNITY                                        │     │
│  │                                                                     │     │
│  │   IF appreciation_predicted AND optimal_timing:                    │     │
│  │     → SPECULATION OPPORTUNITY                                      │     │
│  │                                                                     │     │
│  │   IF suspicious_listing:                                           │     │
│  │     → AVOID                                                        │     │
│  │                                                                     │     │
│  │   IF NOT optimal_timing:                                           │     │
│  │     → WAIT                                                         │     │
│  └────────────────────────────────────────────────────────────────────┘     │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Neural Network: Vision System

### Purpose
The ONLY job of the neural network is **image processing**. This is what neural networks excel at.

### Problem Statement
```
eBay listing: "rare pokemon card holo 1st edition charizard fire"
              + blurry photo at an angle

Questions to answer:
  1. What card is this actually? (Could be anything)
  2. What language is it? (Can't tell from title)
  3. What condition is it? (Seller says "excellent" but...)
  4. Is it the variant they claim? (1st edition? Holo?)
  5. Is it even real? (Counterfeits exist)
  6. Would it grade well? (PSA 10 potential?)
```

### Architecture Options

#### Option A: Multi-Task CNN (Recommended for MVP)
```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        MULTI-TASK CNN ARCHITECTURE                           │
└─────────────────────────────────────────────────────────────────────────────┘

                              Input Image
                              (224 × 224 × 3)
                                    │
                                    ▼
                        ┌───────────────────┐
                        │   EfficientNet-B4 │
                        │   (Backbone)      │
                        │                   │
                        │   Pre-trained on  │
                        │   ImageNet        │
                        └─────────┬─────────┘
                                  │
                              [1792 features]
                                  │
                    ┌─────────────┼─────────────┐
                    │             │             │
                    ▼             ▼             ▼
            ┌───────────┐ ┌───────────┐ ┌───────────┐
            │  Head 1   │ │  Head 2   │ │  Head 3   │
            │           │ │           │ │           │
            │ Card ID   │ │ Condition │ │ Authentic │
            │ (N cards) │ │ (5 class) │ │ (binary)  │
            └─────┬─────┘ └─────┬─────┘ └─────┬─────┘
                  │             │             │
                  ▼             ▼             ▼
            ┌───────────┐ ┌───────────┐ ┌───────────┐
            │  Head 4   │ │  Head 5   │ │  Head 6   │
            │           │ │           │ │           │
            │ Language  │ │  Variant  │ │ PSA Grade │
            │ (8 class) │ │ (10 class)│ │ (regress) │
            └───────────┘ └───────────┘ └───────────┘

Outputs:
  • card_id: Probability distribution over known cards
  • condition: [NM, LP, MP, HP, DMG] probabilities
  • authentic: Real vs fake probability
  • language: [EN, JP, DE, FR, IT, ES, PT, KO] probabilities
  • variant: [regular, parallel, SP, manga, 1st_ed, ...] probabilities
  • psa_grade: Predicted grade (1-10 continuous)
```

#### Option B: Siamese Network for Card Matching
```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      SIAMESE NETWORK FOR MATCHING                            │
└─────────────────────────────────────────────────────────────────────────────┘

For matching unknown listings to known card database:

    Listing Image                    Reference Image
         │                                │
         ▼                                ▼
    ┌─────────┐                      ┌─────────┐
    │ Encoder │    (shared weights)  │ Encoder │
    │   CNN   │ ◄──────────────────► │   CNN   │
    └────┬────┘                      └────┬────┘
         │                                │
         ▼                                ▼
    [embedding]                      [embedding]
         │                                │
         └──────────────┬─────────────────┘
                        │
                        ▼
               ┌────────────────┐
               │ Similarity     │
               │ Score          │
               │ (contrastive   │
               │  loss trained) │
               └────────────────┘

Use case: eBay listing → Find matching card in our database
```

#### Option C: Vision Transformer (State of the Art)
```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     VISION TRANSFORMER (ViT) ARCHITECTURE                    │
└─────────────────────────────────────────────────────────────────────────────┘

    Input Image (224 × 224)
            │
            ▼
    ┌───────────────┐
    │ Patch         │   Split into 16×16 patches
    │ Embedding     │   (196 patches total)
    └───────┬───────┘
            │
            ▼
    ┌───────────────┐
    │ + Position    │   Add learnable position embeddings
    │ Embeddings    │
    └───────┬───────┘
            │
            ▼
    ┌───────────────┐
    │ Transformer   │   12 layers of self-attention
    │ Encoder       │   (ViT-B/16 architecture)
    │ × 12          │
    └───────┬───────┘
            │
            ▼
    ┌───────────────┐
    │ [CLS] Token   │   Classification token
    └───────┬───────┘
            │
            ▼
    Multi-task heads (same as CNN)

Advantages:
  • Better at capturing global relationships
  • Can attend to specific card features (text, art, borders)
  • State of the art performance

Disadvantages:
  • Requires more training data
  • More expensive to train and run
```

### Training Data Requirements

```
DATASET STRUCTURE:
═══════════════════

/training_data/
├── card_images/
│   ├── OP01-001/
│   │   ├── EN_NM_001.jpg
│   │   ├── EN_LP_002.jpg
│   │   ├── JP_NM_001.jpg
│   │   └── ...
│   ├── OP01-002/
│   └── ...
├── fake_examples/
│   ├── counterfeit_001.jpg
│   ├── counterfeit_002.jpg
│   └── ...
├── graded_examples/
│   ├── PSA10/
│   ├── PSA9/
│   └── ...
└── annotations.json

MINIMUM VIABLE DATASET:
═══════════════════════
• Card identification: 50+ images per card × 500 cards = 25,000 images
• Condition grading: 1,000 images per condition × 5 = 5,000 images
• Authenticity: 2,000 real + 500 known fakes = 2,500 images
• Language: 500 images per language × 8 = 4,000 images
• Grading prediction: 5,000 graded card images with known grades

Total: ~40,000 labeled images (minimum)

DATA AUGMENTATION:
══════════════════
• Rotation (±15°) - simulate angled photos
• Brightness/contrast variation - different lighting
• Blur (Gaussian) - simulate poor camera
• Perspective transform - simulate phone angles
• Color jitter - different camera sensors
• Crop variations - card not centered

With augmentation: 40,000 → 400,000 effective training examples
```

### Condition Grading Deep Dive

```
WHAT THE MODEL MUST DETECT:
═══════════════════════════

NEAR MINT (NM):
  • No visible wear
  • Sharp corners
  • Clean edges
  • No scratches on surface
  • Perfect centering (for grading potential)

LIGHTLY PLAYED (LP):
  • Minor edge wear (whitening)
  • Very slight corner wear
  • Minor surface scratches (only visible at angle)

MODERATELY PLAYED (MP):
  • Moderate edge wear
  • Corner wear visible
  • Surface scratches visible
  • Minor creases possible

HEAVILY PLAYED (HP):
  • Heavy edge wear
  • Significant corner damage
  • Visible creases
  • Surface damage

DAMAGED (DMG):
  • Major creases
  • Tears
  • Water damage
  • Writing/stickers
  • Missing pieces

TRAINING APPROACH:
══════════════════
1. Collect images from Cardmarket/TCGplayer with known conditions
2. Augment with synthetic damage (edge wear filters, etc.)
3. Use professional grading results as ground truth
4. Train with focal loss (condition imbalance - most cards are NM/LP)
```

---

## XGBoost/LightGBM: Demand Forecasting

### Purpose
Predict which cards will appreciate in value. This is **speculation**, not arbitrage.

### Why XGBoost/LightGBM, Not Neural Networks?

```
KAGGLE COMPETITION RESULTS (Tabular Data):
══════════════════════════════════════════

Competition                          Winner           Neural Network Place
───────────────────────────────────  ───────────────  ────────────────────
Rossmann Store Sales                 XGBoost          15th
Porto Seguro Safe Driver             LightGBM         23rd
Santander Customer Satisfaction      XGBoost          11th
Home Credit Default Risk             LightGBM         8th
Instacart Market Basket              LightGBM         Did not place

Key insight: On structured/tabular data, gradient boosting wins.
Neural networks excel at unstructured data (images, text, audio).
```

### Feature Engineering

```python
DEMAND_FORECASTING_FEATURES = {

    # ══════════════════════════════════════════════════════════════════
    # PRICE MOMENTUM (15 features)
    # ══════════════════════════════════════════════════════════════════

    'price_momentum': {
        'price_change_7d': float,         # % change last 7 days
        'price_change_30d': float,        # % change last 30 days
        'price_change_90d': float,        # % change last 90 days
        'price_acceleration': float,      # Change in momentum
        'price_vs_52w_high': float,       # Distance from 52-week high
        'price_vs_52w_low': float,        # Distance from 52-week low
        'price_percentile_90d': float,    # Where in 90d range
        'consecutive_up_days': int,       # Streak of price increases
        'consecutive_down_days': int,     # Streak of price decreases
        'volatility_7d': float,           # Standard deviation
        'volatility_30d': float,
        'volatility_ratio': float,        # Short/long term volatility
        'rsi_14': float,                  # Relative strength index
        'macd': float,                    # Moving average convergence
        'macd_signal': float,
    },

    # ══════════════════════════════════════════════════════════════════
    # VOLUME/LIQUIDITY (10 features)
    # ══════════════════════════════════════════════════════════════════

    'volume': {
        'sales_7d': int,                  # Units sold last 7 days
        'sales_30d': int,
        'sales_change_7d': float,         # % change in volume
        'listings_count': int,            # Current supply
        'listings_change_7d': float,      # Supply trend
        'days_of_supply': float,          # Listings / daily sales
        'sell_through_rate': float,       # Sales / new listings
        'time_to_sale_avg': float,        # Days from listing to sale
        'price_dispersion': float,        # Std dev of listing prices
        'bid_ask_spread': float,          # If available
    },

    # ══════════════════════════════════════════════════════════════════
    # CARD CHARACTERISTICS (12 features)
    # ══════════════════════════════════════════════════════════════════

    'card': {
        'rarity_encoded': int,            # Common=0, Rare=1, SR=2, etc.
        'is_leader': bool,
        'is_character': bool,
        'is_event': bool,
        'is_stage': bool,
        'color_encoded': int,             # Red=0, Blue=1, Green=2, etc.
        'cost': int,                      # Play cost
        'power': int,                     # If applicable
        'set_age_days': int,              # Days since set release
        'set_total_value': float,         # Total value of all cards in set
        'card_rank_in_set': int,          # Most valuable = 1
        'is_alternate_art': bool,
    },

    # ══════════════════════════════════════════════════════════════════
    # MARKET CONTEXT (10 features)
    # ══════════════════════════════════════════════════════════════════

    'market': {
        'tcg100_index_value': float,      # Overall market level
        'tcg100_change_7d': float,        # Market momentum
        'set_index_value': float,         # Set-specific index
        'set_index_change_7d': float,
        'market_phase': int,              # 0-3 (accum/markup/dist/markdown)
        'days_to_next_set': int,          # Supply shock incoming?
        'days_since_last_set': int,
        'is_tournament_legal': bool,
        'tournament_play_rate': float,    # % of decks using this card
        'meta_relevance_score': float,    # Competitive viability
    },

    # ══════════════════════════════════════════════════════════════════
    # EXTERNAL SIGNALS (8 features)
    # ══════════════════════════════════════════════════════════════════

    'signals': {
        'social_mentions_7d': int,        # Twitter/Reddit mentions
        'social_sentiment': float,        # -1 to 1
        'youtube_mentions_7d': int,       # Influencer coverage
        'search_trend_7d': float,         # Google trends
        'tournament_top_cut': int,        # Recent tournament placements
        'ban_watch_score': float,         # Likelihood of ban/restriction
        'reprint_probability': float,     # Likelihood of reprint
        'crossover_potential': float,     # Anime/movie tie-in coming?
    },
}

TOTAL_FEATURES = 55
```

### Target Variable

```python
# Classification approach (recommended for initial version)
TARGET_CLASSES = {
    'STRONG_UP':   'Price increases >20% in 30 days',
    'UP':          'Price increases 5-20% in 30 days',
    'FLAT':        'Price changes <5% in either direction',
    'DOWN':        'Price decreases 5-20% in 30 days',
    'STRONG_DOWN': 'Price decreases >20% in 30 days',
}

# Regression approach (for confidence intervals)
TARGET_REGRESSION = {
    'price_change_7d': float,   # Actual % change after 7 days
    'price_change_30d': float,  # Actual % change after 30 days
    'price_change_90d': float,  # Actual % change after 90 days
}
```

### XGBoost Configuration

```python
import xgboost as xgb

# Optimized hyperparameters for card price prediction
XGBOOST_PARAMS = {
    'objective': 'multi:softprob',  # Multi-class classification
    'num_class': 5,                 # 5 price movement categories
    'eval_metric': 'mlogloss',

    # Tree parameters
    'max_depth': 6,                 # Prevent overfitting
    'min_child_weight': 10,         # Minimum samples per leaf
    'subsample': 0.8,               # Row sampling
    'colsample_bytree': 0.8,        # Feature sampling

    # Regularization
    'lambda': 1.0,                  # L2 regularization
    'alpha': 0.5,                   # L1 regularization

    # Learning
    'learning_rate': 0.05,          # Conservative learning rate
    'n_estimators': 500,            # Boosting rounds
    'early_stopping_rounds': 50,    # Stop if no improvement

    # GPU acceleration (if available)
    'tree_method': 'gpu_hist',      # GPU training
    'predictor': 'gpu_predictor',
}

# LightGBM alternative (often faster)
LIGHTGBM_PARAMS = {
    'objective': 'multiclass',
    'num_class': 5,
    'metric': 'multi_logloss',
    'boosting_type': 'gbdt',
    'num_leaves': 31,
    'max_depth': 6,
    'learning_rate': 0.05,
    'feature_fraction': 0.8,
    'bagging_fraction': 0.8,
    'bagging_freq': 5,
    'lambda_l1': 0.5,
    'lambda_l2': 1.0,
    'min_child_samples': 20,
    'n_estimators': 500,
    'early_stopping_rounds': 50,
    'device': 'gpu',  # GPU acceleration
}
```

### Feature Importance (Interpretability Win)

```
One major advantage of XGBoost: We can see WHY it predicts what it predicts.

EXAMPLE OUTPUT:
═══════════════

Feature Importance (Gain):
  1. tournament_play_rate    0.142  ████████████████
  2. social_mentions_7d      0.098  ███████████
  3. sales_change_7d         0.087  ██████████
  4. price_change_7d         0.076  █████████
  5. volatility_ratio        0.065  ████████
  6. days_to_next_set        0.054  ██████
  7. rsi_14                  0.048  █████
  8. set_age_days            0.042  █████
  ...

This tells us: Tournament play rate is the #1 predictor of price appreciation.
Neural networks cannot provide this insight.
```

---

## Logistic Regression: Listing Quality

### Purpose
Flag suspicious listings: counterfeits, misgraded cards, scams.

### Why Logistic Regression?

```
For binary classification with interpretable features:
  • Fast to train (seconds)
  • Fast inference (microseconds)
  • Fully interpretable (coefficients = feature weights)
  • Robust to outliers with regularization
  • Calibrated probabilities out of the box

For this task, we don't need complexity - we need reliability and speed.
```

### Feature Set

```python
LISTING_QUALITY_FEATURES = {

    # ══════════════════════════════════════════════════════════════════
    # PRICE SIGNALS (5 features)
    # ══════════════════════════════════════════════════════════════════

    'price': {
        'price_vs_market': float,       # How far below market? (-0.5 = 50% below)
        'price_vs_recent_sales': float, # vs actual sale prices
        'price_percentile': float,      # Among current listings
        'is_suspiciously_low': bool,    # >30% below market
        'is_round_number': bool,        # $10.00 vs $10.47 (scammers use round)
    },

    # ══════════════════════════════════════════════════════════════════
    # SELLER SIGNALS (10 features)
    # ══════════════════════════════════════════════════════════════════

    'seller': {
        'feedback_score': float,        # 0-100%
        'feedback_count': int,
        'account_age_days': int,
        'is_new_account': bool,         # <30 days
        'is_power_seller': bool,
        'negative_feedback_rate': float,
        'recent_negative_count': int,   # Last 30 days
        'sells_other_categories': bool, # Diversified or TCG-focused?
        'listing_velocity': float,      # Listings per day (too high = suspicious)
        'response_time_hours': float,
    },

    # ══════════════════════════════════════════════════════════════════
    # LISTING SIGNALS (10 features)
    # ══════════════════════════════════════════════════════════════════

    'listing': {
        'has_photos': bool,
        'photo_count': int,
        'photo_quality_score': float,   # From image model
        'uses_stock_photo': bool,       # Red flag!
        'description_length': int,
        'description_quality_score': float,  # NLP-assessed
        'condition_matches_photos': bool,    # From image model
        'title_has_keywords': bool,     # "authentic", "real", "not fake" = sus
        'is_auction_vs_bin': bool,      # Auctions less likely fake
        'shipping_location_matches': bool,   # Seller location vs ship from
    },

    # ══════════════════════════════════════════════════════════════════
    # CARD-SPECIFIC SIGNALS (5 features)
    # ══════════════════════════════════════════════════════════════════

    'card': {
        'is_high_value': bool,          # >$50
        'has_known_fakes': bool,        # This card is commonly counterfeited
        'graded_vs_raw': bool,          # Graded cards harder to fake
        'edition_matches_era': bool,    # 1st edition from right time period?
        'image_authenticity_score': float,  # From neural network
    },
}

TOTAL_FEATURES = 30
```

### Model Output

```python
# Multi-class logistic regression
OUTPUT_CLASSES = {
    'LEGITIMATE':  'Normal listing, safe to purchase',
    'SUSPICIOUS':  'Some red flags, proceed with caution',
    'LIKELY_FAKE': 'High probability of counterfeit',
    'MISGRADED':   'Condition probably worse than stated',
    'SCAM':        'Likely won\'t receive item at all',
}

# Probability output
{
    'legitimate_prob': 0.85,
    'suspicious_prob': 0.10,
    'fake_prob': 0.03,
    'misgraded_prob': 0.02,
    'scam_prob': 0.00,

    # Top risk factors (interpretability)
    'risk_factors': [
        'Price 45% below market average',
        'Seller account only 12 days old',
        'Uses stock photo instead of actual card',
    ]
}
```

### Training Data Collection

```
POSITIVE EXAMPLES (Legitimate listings):
  • Completed sales with positive feedback
  • Known reliable sellers
  • Verified authentic cards

NEGATIVE EXAMPLES (Problems):
  • Reported counterfeits (eBay/platform data)
  • Disputed transactions
  • Known fake sellers
  • Synthetic fakes (for augmentation)

CHALLENGE: Getting labeled fake data
  • Partner with eBay/platforms for fraud data?
  • Create synthetic suspicious listings
  • Use confirmed scammer accounts as negative examples
  • Community-reported fakes
```

---

## Time Series: Optimal Timing

### Purpose
Determine the best time to buy and sell based on seasonal and cyclical patterns.

### Why Prophet/ARIMA?

```
Time series data has unique characteristics:
  • Autocorrelation (today's price relates to yesterday's)
  • Seasonality (weekly, monthly, yearly patterns)
  • Trend (long-term direction)
  • Holidays/events (Christmas, tournament seasons)

Prophet (Facebook) is specifically designed for business time series with:
  • Multiple seasonalities
  • Holiday effects
  • Missing data handling
  • Automatic changepoint detection
```

### Seasonal Patterns in TCG Market

```
OBSERVED PATTERNS:
══════════════════

WEEKLY SEASONALITY:
┌─────────────────────────────────────────────────────────────────────────────┐
│    Mon    Tue    Wed    Thu    Fri    Sat    Sun                            │
│    ───    ───    ───    ───    ───    ───    ───                            │
│     ▂      ▃      ▄      ▅      ▇      █      ▇                             │
│                                                                              │
│  Prices tend to be:                                                         │
│    • Lowest: Monday-Tuesday (weekday sellers need quick cash)               │
│    • Highest: Saturday (weekend buyers have time to shop)                   │
│    • Auctions: End Sunday evening (highest bidder activity)                 │
└─────────────────────────────────────────────────────────────────────────────┘

MONTHLY SEASONALITY:
┌─────────────────────────────────────────────────────────────────────────────┐
│  Jan  Feb  Mar  Apr  May  Jun  Jul  Aug  Sep  Oct  Nov  Dec                 │
│  ───  ───  ───  ───  ───  ───  ───  ───  ───  ───  ───  ───                 │
│   ▃    ▂    ▃    ▄    ▄    ▃    ▃    ▄    ▅    ▅    ▆    █                  │
│                                                                              │
│  Patterns:                                                                   │
│    • December: Peak (Christmas gifts)                                        │
│    • January: Post-holiday dip (sellers liquidate gifts)                    │
│    • Summer: Lower activity (vacations)                                      │
│    • September: Back to school, new set releases                            │
│    • November: Pre-holiday buying begins                                    │
└─────────────────────────────────────────────────────────────────────────────┘

JAPAN-SPECIFIC PATTERNS:
┌─────────────────────────────────────────────────────────────────────────────┐
│  Japanese card prices follow different cycles:                               │
│                                                                              │
│  • Golden Week (late April/early May): Prices DROP                          │
│    - Many sellers list during holiday, increased supply                     │
│    - BEST TIME TO BUY Japanese cards                                        │
│                                                                              │
│  • Obon (mid-August): Prices DROP                                           │
│    - Similar effect, sellers have time to list                              │
│                                                                              │
│  • New Year: Prices INCREASE                                                │
│    - Gift giving, lucky bag sales                                           │
│    - Collectors spending New Year money                                     │
│                                                                              │
│  • Pre-Japan Nationals: Prices SPIKE                                        │
│    - Competitive players buying meta cards                                  │
└─────────────────────────────────────────────────────────────────────────────┘

SET RELEASE PATTERNS:
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                              │
│  Price                                                                       │
│    │                                                                         │
│    │      ████                                                              │
│    │    ██    █                                                             │
│    │   █       ██                                                           │
│    │  █          █████████████████████                                      │
│    │ █                                ████████                              │
│    │█                                         ██████████                    │
│    └────────────────────────────────────────────────────────────────────    │
│        │         │         │         │         │                            │
│    Release    +2 weeks  +1 month  +3 months  +6 months                      │
│                                                                              │
│  Pattern:                                                                    │
│    • Pre-release hype: Prices INFLATED                                      │
│    • Week 1-2: Peak prices, chase cards expensive                           │
│    • Week 3-4: Supply catches up, prices DROP 20-40%                        │
│    • Month 2+: Stabilization, meta determines final price                   │
│    • Month 6+: Slow appreciation or continued decline                       │
│                                                                              │
│  STRATEGY: Never buy chase cards in first 2 weeks                           │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Prophet Implementation

```python
from prophet import Prophet
import pandas as pd

def train_timing_model(card_id: str, price_history: pd.DataFrame):
    """
    Train Prophet model for optimal timing predictions.

    Args:
        card_id: Card identifier
        price_history: DataFrame with columns ['ds', 'y'] (date, price)

    Returns:
        Trained Prophet model with seasonal components
    """

    model = Prophet(
        # Seasonality
        yearly_seasonality=True,
        weekly_seasonality=True,
        daily_seasonality=False,  # Cards don't have daily patterns

        # Holidays (TCG-specific)
        holidays=tcg_holidays,

        # Changepoint detection
        changepoint_prior_scale=0.05,  # Sensitivity to trend changes

        # Uncertainty
        interval_width=0.95,

        # Growth
        growth='linear',  # or 'logistic' for bounded growth
    )

    # Add custom seasonalities
    model.add_seasonality(
        name='monthly',
        period=30.5,
        fourier_order=5,
    )

    # Add set release effects (known future events)
    model.add_regressor('days_to_set_release')
    model.add_regressor('is_tournament_season')

    # Fit model
    model.fit(price_history)

    return model


# TCG-specific holidays
tcg_holidays = pd.DataFrame({
    'holiday': [
        'christmas', 'christmas',
        'black_friday', 'black_friday',
        'golden_week', 'golden_week',
        'obon', 'obon',
        'worlds', 'worlds',
    ],
    'ds': pd.to_datetime([
        '2025-12-25', '2026-12-25',
        '2025-11-28', '2026-11-27',
        '2025-05-03', '2026-05-03',
        '2025-08-15', '2026-08-15',
        '2025-08-10', '2026-08-10',
    ]),
    'lower_window': [-7, -7, -3, -3, -3, -3, -3, -3, -14, -14],
    'upper_window': [3, 3, 3, 3, 7, 7, 3, 3, 3, 3],
})


def get_optimal_timing(model, forecast_days=90):
    """
    Find optimal buy/sell windows in next N days.
    """
    future = model.make_future_dataframe(periods=forecast_days)
    forecast = model.predict(future)

    # Find local minima (best buy) and maxima (best sell)
    forecast['is_local_min'] = (
        (forecast['yhat'] < forecast['yhat'].shift(1)) &
        (forecast['yhat'] < forecast['yhat'].shift(-1))
    )
    forecast['is_local_max'] = (
        (forecast['yhat'] > forecast['yhat'].shift(1)) &
        (forecast['yhat'] > forecast['yhat'].shift(-1))
    )

    return {
        'best_buy_dates': forecast[forecast['is_local_min']]['ds'].tolist(),
        'best_sell_dates': forecast[forecast['is_local_max']]['ds'].tolist(),
        'expected_range': {
            'low': forecast['yhat_lower'].min(),
            'high': forecast['yhat_upper'].max(),
        },
        'seasonality_components': {
            'weekly': model.plot_components(forecast)['weekly'],
            'yearly': model.plot_components(forecast)['yearly'],
        }
    }
```

### ARIMA for Short-Term Predictions

```python
from statsmodels.tsa.arima.model import ARIMA
from statsmodels.tsa.stattools import adfuller

def train_arima_model(price_series: pd.Series):
    """
    Train ARIMA model for short-term price predictions.

    ARIMA is better than Prophet for:
      • Short-term forecasts (1-14 days)
      • High-frequency data
      • Quick inference
    """

    # Check stationarity
    adf_result = adfuller(price_series)
    is_stationary = adf_result[1] < 0.05

    # Determine differencing order
    d = 0 if is_stationary else 1

    # Auto-select p and q using AIC
    best_aic = float('inf')
    best_order = (1, d, 1)

    for p in range(0, 5):
        for q in range(0, 5):
            try:
                model = ARIMA(price_series, order=(p, d, q))
                fitted = model.fit()
                if fitted.aic < best_aic:
                    best_aic = fitted.aic
                    best_order = (p, d, q)
            except:
                continue

    # Train final model
    final_model = ARIMA(price_series, order=best_order)
    fitted_model = final_model.fit()

    return fitted_model


def short_term_forecast(model, days=7):
    """
    Generate short-term price forecast with confidence intervals.
    """
    forecast = model.forecast(steps=days)
    conf_int = model.get_forecast(steps=days).conf_int()

    return {
        'predictions': forecast.tolist(),
        'lower_bound': conf_int.iloc[:, 0].tolist(),
        'upper_bound': conf_int.iloc[:, 1].tolist(),
    }
```

---

## Isolation Forest: Anomaly Detection

### Purpose
Detect mispriced listings and data errors in real-time.

### Why Isolation Forest?

```
ANOMALY DETECTION ALGORITHMS COMPARED:
═════════════════════════════════════

Algorithm          | Pros                      | Cons
───────────────────|───────────────────────────|─────────────────────
Isolation Forest   | Fast, handles high-dim    | Less interpretable
                   | No distribution assumption |
                   | Works with mixed features  |
───────────────────|───────────────────────────|─────────────────────
One-Class SVM      | Good for known normal     | Slow on large data
                   | Shape-aware boundaries    | Assumes normal shape
───────────────────|───────────────────────────|─────────────────────
Local Outlier      | Density-aware            | Slow, O(n²)
Factor (LOF)       | Good for clusters        | Sensitive to params
───────────────────|───────────────────────────|─────────────────────
Autoencoder        | Learns complex patterns  | Needs lots of data
                   | Can detect subtle anomaly | Slow inference

Winner for real-time listing detection: Isolation Forest
  • Fast training (seconds)
  • Fast inference (microseconds per listing)
  • Works on our mixed feature set
  • Handles concept drift (retrain easily)
```

### How Isolation Forest Works

```
INTUITION:
══════════

Anomalies are "few and different" - they're easier to isolate.

Normal listings cluster together:
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                              │
│     ░░░░░                                                                   │
│   ░░░░░░░░░                          ●  ← This outlier is                   │
│  ░░░░░░░░░░░                            isolated quickly                    │
│  ░░░░░░░░░░░                                                                │
│   ░░░░░░░░░                                                                 │
│     ░░░░░       ░ = Normal listing                                          │
│                 ● = Anomaly (isolated in few splits)                        │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘

ALGORITHM:
═══════════

1. Random Splitting:
   - Pick a random feature
   - Pick a random split value
   - Partition data

2. Build Trees:
   - Repeat splitting until all points isolated
   - Anomalies require fewer splits (shorter path)

3. Anomaly Score:
   - Average path length across all trees
   - Short path = high anomaly score
   - Score normalized to [0, 1]
```

### Feature Set for Anomaly Detection

```python
ANOMALY_DETECTION_FEATURES = {

    # ══════════════════════════════════════════════════════════════════
    # PRICE FEATURES (relative to market)
    # ══════════════════════════════════════════════════════════════════

    'price_z_score': float,           # Std devs from mean
    'price_vs_median': float,         # % difference from median
    'price_vs_recent_sales': float,   # vs last 10 sales
    'price_percentile': float,        # Among current listings

    # ══════════════════════════════════════════════════════════════════
    # VOLUME FEATURES (unusual activity)
    # ══════════════════════════════════════════════════════════════════

    'listing_age_hours': float,       # How long has it been listed?
    'seller_listings_today': int,     # Bulk listing = sus
    'card_listings_today': int,       # Unusual supply spike?

    # ══════════════════════════════════════════════════════════════════
    # CROSS-MARKET FEATURES
    # ══════════════════════════════════════════════════════════════════

    'tcg_cm_spread': float,           # TCGplayer vs Cardmarket
    'tcg_ebay_spread': float,         # TCGplayer vs eBay
    'cross_market_z_score': float,    # Overall spread anomaly

    # ══════════════════════════════════════════════════════════════════
    # DATA QUALITY FEATURES
    # ══════════════════════════════════════════════════════════════════

    'is_complete_data': bool,         # All fields populated?
    'condition_matches_price': bool,  # NM priced as HP?
    'title_matches_card': float,      # Confidence from NLP
}
```

### Implementation

```python
from sklearn.ensemble import IsolationForest
import numpy as np

class PriceAnomalyDetector:
    """
    Real-time detection of mispriced listings.
    """

    def __init__(self, contamination=0.05):
        """
        Args:
            contamination: Expected proportion of anomalies (5% default)
        """
        self.model = IsolationForest(
            n_estimators=100,
            max_samples='auto',
            contamination=contamination,
            random_state=42,
            n_jobs=-1,  # Use all cores
        )
        self.is_fitted = False
        self.feature_means = None
        self.feature_stds = None

    def fit(self, listings_df: pd.DataFrame):
        """
        Train on historical listings data.

        Args:
            listings_df: DataFrame with feature columns
        """
        features = self._extract_features(listings_df)

        # Normalize features
        self.feature_means = features.mean()
        self.feature_stds = features.std()
        normalized = (features - self.feature_means) / self.feature_stds

        self.model.fit(normalized)
        self.is_fitted = True

    def detect(self, listing: dict) -> dict:
        """
        Check if a single listing is anomalous.

        Returns:
            {
                'is_anomaly': bool,
                'anomaly_score': float,  # 0-1, higher = more anomalous
                'anomaly_type': str,     # 'underpriced', 'overpriced', 'data_error'
                'details': dict,
            }
        """
        if not self.is_fitted:
            raise ValueError("Model not fitted. Call fit() first.")

        features = self._extract_single(listing)
        normalized = (features - self.feature_means) / self.feature_stds

        # Get anomaly score (-1 to 1, lower = more anomalous)
        raw_score = self.model.score_samples(normalized.reshape(1, -1))[0]

        # Convert to 0-1 scale (higher = more anomalous)
        anomaly_score = 1 - (raw_score + 1) / 2

        # Classify anomaly type
        is_anomaly = self.model.predict(normalized.reshape(1, -1))[0] == -1
        anomaly_type = self._classify_anomaly_type(listing, features)

        return {
            'is_anomaly': is_anomaly,
            'anomaly_score': float(anomaly_score),
            'anomaly_type': anomaly_type,
            'details': {
                'price_z_score': float(features['price_z_score']),
                'cross_market_spread': float(features['tcg_cm_spread']),
                'contributing_features': self._get_contributing_features(features),
            }
        }

    def _classify_anomaly_type(self, listing: dict, features: pd.Series) -> str:
        """Determine what kind of anomaly this is."""

        if features['price_z_score'] < -2:
            return 'underpriced'  # Potential arbitrage!
        elif features['price_z_score'] > 2:
            return 'overpriced'   # Seller mistake or optimistic
        elif not features['is_complete_data']:
            return 'data_error'   # Missing/corrupt data
        elif abs(features['tcg_cm_spread']) > 0.3:
            return 'market_dislocation'  # Cross-market opportunity
        else:
            return 'unknown'

    def _get_contributing_features(self, features: pd.Series) -> list:
        """Find which features contributed most to anomaly."""

        # Z-score each feature
        z_scores = abs((features - self.feature_means) / self.feature_stds)

        # Return top contributors
        contributors = z_scores.nlargest(3)
        return [
            {'feature': name, 'z_score': float(score)}
            for name, score in contributors.items()
        ]
```

### Real-Time Detection Pipeline

```
NEW LISTING ARRIVES
        │
        ▼
┌───────────────────┐
│ Feature Extraction│
│ (10ms)            │
└─────────┬─────────┘
          │
          ▼
┌───────────────────┐
│ Isolation Forest  │
│ Score (1ms)       │
└─────────┬─────────┘
          │
          ▼
    ┌─────┴─────┐
    │ Anomaly?  │
    └─────┬─────┘
          │
    ┌─────┴─────┐
    │           │
    ▼           ▼
 NORMAL     ANOMALY
    │           │
    ▼           ▼
 Index      ┌───┴───────────────┐
 in DB      │                   │
            ▼                   ▼
       Underpriced?        Data Error?
            │                   │
            ▼                   ▼
       → ALERT            → Flag for
         ARBITRAGE          Review
         OPPORTUNITY
```

---

## AWS Infrastructure Design

### Overview Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                          AWS ML INFRASTRUCTURE                                                   │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘

                                              ┌──────────────────┐
                                              │   CloudWatch     │
                                              │   Monitoring     │
                                              └────────┬─────────┘
                                                       │
┌──────────────────────────────────────────────────────┼──────────────────────────────────────────────────────────┐
│                                                      │                                                           │
│  ┌─────────────────┐    ┌─────────────────┐    ┌────┴────────┐    ┌─────────────────┐    ┌─────────────────┐   │
│  │   DATA LAYER    │    │  STORAGE LAYER  │    │  COMPUTE    │    │   ML LAYER      │    │  SERVING LAYER  │   │
│  │                 │    │                 │    │   LAYER     │    │                 │    │                 │   │
│  │ ┌─────────────┐ │    │ ┌─────────────┐ │    │ ┌─────────┐ │    │ ┌─────────────┐ │    │ ┌─────────────┐ │   │
│  │ │ EventBridge │ │───▶│ │     S3      │ │───▶│ │ Glue/   │ │───▶│ │  SageMaker  │ │───▶│ │   Lambda    │ │   │
│  │ │  (Events)   │ │    │ │ (Raw Data)  │ │    │ │ Spark   │ │    │ │  Training   │ │    │ │  (Routing)  │ │   │
│  │ └─────────────┘ │    │ └─────────────┘ │    │ └─────────┘ │    │ └─────────────┘ │    │ └─────────────┘ │   │
│  │                 │    │                 │    │             │    │                 │    │        │        │   │
│  │ ┌─────────────┐ │    │ ┌─────────────┐ │    │ ┌─────────┐ │    │ ┌─────────────┐ │    │        ▼        │   │
│  │ │   Kinesis   │ │    │ │   S3        │ │    │ │   EMR   │ │    │ │  SageMaker  │ │    │ ┌─────────────┐ │   │
│  │ │  (Stream)   │ │    │ │ (Features)  │ │    │ │ (Large) │ │    │ │  Endpoints  │ │◀───│ │ API Gateway │ │   │
│  │ └─────────────┘ │    │ └─────────────┘ │    │ └─────────┘ │    │ └─────────────┘ │    │ └─────────────┘ │   │
│  │                 │    │                 │    │             │    │                 │    │                 │   │
│  │ ┌─────────────┐ │    │ ┌─────────────┐ │    │             │    │ ┌─────────────┐ │    │ ┌─────────────┐ │   │
│  │ │    SQS      │ │    │ │   S3        │ │    │             │    │ │   Model     │ │    │ │   Lambda    │ │   │
│  │ │  (Queue)    │ │    │ │  (Models)   │ │    │             │    │ │  Registry   │ │    │ │ (Inference) │ │   │
│  │ └─────────────┘ │    │ └─────────────┘ │    │             │    │ └─────────────┘ │    │ └─────────────┘ │   │
│  │                 │    │                 │    │             │    │                 │    │                 │   │
│  └─────────────────┘    └─────────────────┘    └─────────────┘    └─────────────────┘    └─────────────────┘   │
│                                                                                                                  │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘

COST-OPTIMIZED:
  • Spot instances for training
  • Serverless inference where possible
  • Multi-model endpoints to share GPU
  • S3 Intelligent Tiering for data
```

### Training Infrastructure (Detailed)

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                          TRAINING INFRASTRUCTURE                                                 │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                              S3 DATA LAKE                                                       │
│                                                                                                                 │
│  ┌─────────────────────┐   ┌─────────────────────┐   ┌─────────────────────┐   ┌─────────────────────┐        │
│  │ s3://tcg-ml-raw/    │   │ s3://tcg-ml-        │   │ s3://tcg-ml-        │   │ s3://tcg-ml-        │        │
│  │                     │   │     features/       │   │     models/         │   │     artifacts/      │        │
│  │ • listings/         │   │                     │   │                     │   │                     │        │
│  │ • prices/           │   │ • demand/           │   │ • vision/v1/        │   │ • experiments/      │        │
│  │ • images/           │   │ • quality/          │   │ • xgboost/v3/       │   │ • checkpoints/      │        │
│  │ • seller_data/      │   │ • timing/           │   │ • prophet/v2/       │   │ • logs/             │        │
│  │ • market_data/      │   │ • anomaly/          │   │ • iforest/v1/       │   │ • reports/          │        │
│  └─────────────────────┘   └─────────────────────┘   └─────────────────────┘   └─────────────────────┘        │
│                                                                                                                 │
└────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
                                                          │
                                                          ▼
┌────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                           SAGEMAKER TRAINING                                                    │
│                                                                                                                 │
│  ┌─────────────────────────────────────────────────────────────────────────────────────────────────────┐       │
│  │                                    VISION MODEL (CNN/ViT)                                            │       │
│  │                                                                                                      │       │
│  │  Instance: ml.p3.2xlarge (1 V100 GPU, $3.06/hr)                                                     │       │
│  │  OR ml.g5.xlarge (1 A10G GPU, $1.41/hr) - newer, better price/performance                           │       │
│  │                                                                                                      │       │
│  │  Training Config:                                                                                    │       │
│  │    • Framework: PyTorch 2.0 with TorchVision                                                        │       │
│  │    • Image: 763104351884.dkr.ecr.us-east-1.amazonaws.com/pytorch-training:2.0-gpu-py310             │       │
│  │    • Data: S3 input mode (streaming for large datasets)                                             │       │
│  │    • Epochs: 50                                                                                      │       │
│  │    • Batch size: 64                                                                                  │       │
│  │    • Mixed precision: FP16                                                                          │       │
│  │                                                                                                      │       │
│  │  Estimated Training Time: 8-12 hours                                                                │       │
│  │  Estimated Cost: $11-17 (spot) or $25-37 (on-demand)                                               │       │
│  └─────────────────────────────────────────────────────────────────────────────────────────────────────┘       │
│                                                                                                                 │
│  ┌─────────────────────────────────────────────────────────────────────────────────────────────────────┐       │
│  │                                    XGBOOST/LIGHTGBM MODEL                                            │       │
│  │                                                                                                      │       │
│  │  Instance: ml.m5.xlarge (4 vCPU, 16GB, $0.23/hr)                                                    │       │
│  │  OR ml.g4dn.xlarge for GPU XGBoost ($0.71/hr)                                                       │       │
│  │                                                                                                      │       │
│  │  Training Config:                                                                                    │       │
│  │    • Framework: XGBoost 1.7 (SageMaker built-in)                                                    │       │
│  │    • Hyperparameter tuning: Bayesian optimization                                                   │       │
│  │    • Cross-validation: 5-fold                                                                       │       │
│  │                                                                                                      │       │
│  │  Estimated Training Time: 30-60 minutes                                                             │       │
│  │  Estimated Cost: $0.15-0.40                                                                         │       │
│  └─────────────────────────────────────────────────────────────────────────────────────────────────────┘       │
│                                                                                                                 │
│  ┌─────────────────────────────────────────────────────────────────────────────────────────────────────┐       │
│  │                                    PROPHET/ARIMA MODELS                                              │       │
│  │                                                                                                      │       │
│  │  Instance: ml.m5.large (2 vCPU, 8GB, $0.12/hr)                                                      │       │
│  │                                                                                                      │       │
│  │  Training Config:                                                                                    │       │
│  │    • Framework: Custom container with Prophet 1.1                                                   │       │
│  │    • Training: Per-card models (parallelizable)                                                     │       │
│  │    • Processing: SageMaker Processing job with multi-instance                                       │       │
│  │                                                                                                      │       │
│  │  Estimated Training Time: 1-2 hours (all cards)                                                     │       │
│  │  Estimated Cost: $0.12-0.24                                                                         │       │
│  └─────────────────────────────────────────────────────────────────────────────────────────────────────┘       │
│                                                                                                                 │
│  ┌─────────────────────────────────────────────────────────────────────────────────────────────────────┐       │
│  │                                    ISOLATION FOREST + LOGISTIC REG                                   │       │
│  │                                                                                                      │       │
│  │  Instance: ml.m5.large (2 vCPU, 8GB, $0.12/hr)                                                      │       │
│  │                                                                                                      │       │
│  │  Training Config:                                                                                    │       │
│  │    • Framework: Scikit-learn 1.2                                                                    │       │
│  │    • Image: SageMaker Scikit-learn container                                                        │       │
│  │                                                                                                      │       │
│  │  Estimated Training Time: 10-20 minutes                                                             │       │
│  │  Estimated Cost: $0.02-0.04                                                                         │       │
│  └─────────────────────────────────────────────────────────────────────────────────────────────────────┘       │
│                                                                                                                 │
└────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘

TOTAL TRAINING COST ESTIMATE (Monthly Retraining):
  Vision model:        $15-25 (spot instances)
  XGBoost:            $1-2
  Prophet (all cards): $1-2
  Isolation Forest:    $0.10
  ─────────────────────────────────────
  TOTAL:              ~$20-30/month
```

### Inference Infrastructure (Detailed)

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                         INFERENCE INFRASTRUCTURE                                                 │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                              API GATEWAY                                                        │
│                                                                                                                 │
│  POST /api/v1/vision/identify        →  Vision Model (card identification)                                     │
│  POST /api/v1/vision/grade           →  Vision Model (condition grading)                                       │
│  POST /api/v1/demand/forecast        →  XGBoost Model (price prediction)                                       │
│  POST /api/v1/quality/score          →  Logistic Regression (listing quality)                                  │
│  POST /api/v1/timing/optimal         →  Prophet Model (buy/sell timing)                                        │
│  POST /api/v1/anomaly/detect         →  Isolation Forest (price anomaly)                                       │
│  POST /api/v1/orchestrator/analyze   →  All models combined                                                    │
│                                                                                                                 │
└────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
                                                          │
                                                          ▼
┌────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                           LAMBDA ROUTING LAYER                                                  │
│                                                                                                                 │
│  ┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐   │
│  │  async function routeRequest(event) {                                                                   │   │
│  │    const { endpoint, payload } = parseRequest(event);                                                   │   │
│  │                                                                                                          │   │
│  │    switch(endpoint) {                                                                                    │   │
│  │      case 'vision':                                                                                      │   │
│  │        return await invokeSageMakerEndpoint('vision-endpoint', payload);                                │   │
│  │                                                                                                          │   │
│  │      case 'demand':                                                                                      │   │
│  │      case 'quality':                                                                                     │   │
│  │      case 'anomaly':                                                                                     │   │
│  │        // These run directly in Lambda (fast, small models)                                             │   │
│  │        return await runLocalInference(endpoint, payload);                                               │   │
│  │                                                                                                          │   │
│  │      case 'timing':                                                                                      │   │
│  │        return await invokeSageMakerEndpoint('prophet-endpoint', payload);                               │   │
│  │                                                                                                          │   │
│  │      case 'orchestrator':                                                                                │   │
│  │        // Run all models and combine results                                                            │   │
│  │        return await orchestrateAllModels(payload);                                                      │   │
│  │    }                                                                                                     │   │
│  │  }                                                                                                       │   │
│  └────────────────────────────────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                                                 │
└────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
                           │                              │                              │
                           ▼                              ▼                              ▼
┌──────────────────────────────────────┐  ┌──────────────────────────────┐  ┌──────────────────────────────────┐
│    SAGEMAKER REAL-TIME ENDPOINT      │  │    LAMBDA LOCAL INFERENCE    │  │    SAGEMAKER SERVERLESS          │
│                                      │  │                              │  │                                  │
│  ┌────────────────────────────────┐  │  │  Models small enough to run  │  │  For intermittent workloads:    │
│  │      VISION MODEL               │  │  │  directly in Lambda:         │  │                                  │
│  │                                 │  │  │                              │  │  ┌────────────────────────────┐  │
│  │  Instance: ml.g4dn.xlarge      │  │  │  • XGBoost (~50MB)           │  │  │     PROPHET ENDPOINT        │  │
│  │  (1 T4 GPU)                    │  │  │  • Isolation Forest (~5MB)   │  │  │                             │  │
│  │                                 │  │  │  • Logistic Reg (~1MB)      │  │  │  Memory: 4GB                │  │
│  │  Cost: $0.71/hr                │  │  │                              │  │  │  Concurrency: 5             │  │
│  │  Latency: 50-100ms             │  │  │  Lambda Config:              │  │  │                             │  │
│  │                                 │  │  │  • Memory: 1024MB           │  │  │  Cost: $0.00016/request     │  │
│  │  Auto-scaling:                 │  │  │  • Timeout: 30s             │  │  │  Latency: 100-500ms         │  │
│  │  • Min: 1 instance             │  │  │  • Layers: sklearn, xgb     │  │  │  (cold start: 2-5s)         │  │
│  │  • Max: 5 instances            │  │  │                              │  │  │                             │  │
│  │  • Target: 70% utilization     │  │  │  Cost: ~$0.00001/request    │  │  └────────────────────────────┘  │
│  │                                 │  │  │  Latency: 5-20ms            │  │                                  │
│  └────────────────────────────────┘  │  │                              │  │                                  │
│                                      │  └──────────────────────────────┘  │                                  │
│  Monthly Cost: ~$500-1000           │  │  Monthly Cost: ~$5-20         │  │  Monthly Cost: ~$20-50          │
│  (depending on traffic)              │  │                              │  │                                  │
└──────────────────────────────────────┘  └──────────────────────────────┘  └──────────────────────────────────┘

ALTERNATIVE: MULTI-MODEL ENDPOINT (Cost Optimized)
═══════════════════════════════════════════════════

Instead of separate endpoints, host multiple models on one GPU:

┌──────────────────────────────────────────────────────────────────────────────────────────┐
│                              SAGEMAKER MULTI-MODEL ENDPOINT                               │
│                                                                                           │
│  Instance: ml.g4dn.xlarge (1 T4 GPU, 16GB memory)                                        │
│                                                                                           │
│  Loaded Models:                                                                           │
│    ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                                    │
│    │  Vision     │  │  XGBoost    │  │  Prophet    │                                    │
│    │  (~2GB)     │  │  (~100MB)   │  │  (~50MB)    │                                    │
│    └─────────────┘  └─────────────┘  └─────────────┘                                    │
│                                                                                           │
│  Total Memory: ~3GB / 16GB available                                                     │
│  Cost: $0.71/hr = ~$500/month                                                            │
│                                                                                           │
│  Request Routing:                                                                         │
│    POST /invoke?target_model=vision                                                      │
│    POST /invoke?target_model=xgboost                                                     │
│    POST /invoke?target_model=prophet                                                     │
│                                                                                           │
│  Latency: +5-10ms overhead for model routing                                             │
│                                                                                           │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

### Cost Summary

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                          MONTHLY COST ESTIMATE                                                   │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘

TRAINING (Monthly Retraining):
──────────────────────────────────────────────────────────────────────────────────────
  Vision Model (8hr × $1.41 spot)                                            $11.28
  XGBoost (1hr × $0.23)                                                       $0.23
  Prophet (2hr × $0.12)                                                       $0.24
  Isolation Forest (0.5hr × $0.12)                                            $0.06
                                                                            ────────
  Training Subtotal:                                                         $11.81

INFERENCE (Assuming 100K requests/month):
──────────────────────────────────────────────────────────────────────────────────────
  Option A: Separate Endpoints
    Vision Endpoint (24/7, ml.g4dn.xlarge)                                 $511.20
    Prophet Serverless (100K × $0.00016)                                    $16.00
    Lambda (XGBoost/IForest, 100K × $0.00001)                               $1.00
                                                                           ────────
    Inference Subtotal (Option A):                                        $528.20

  Option B: Multi-Model Endpoint (Recommended)
    Shared Endpoint (24/7, ml.g4dn.xlarge)                                 $511.20
    Lambda routing (100K × $0.000001)                                        $0.10
                                                                           ────────
    Inference Subtotal (Option B):                                        $511.30

  Option C: Serverless Only (Low Traffic)
    Vision Serverless (20K × $0.0008)                                       $16.00
    Other models in Lambda (80K × $0.00001)                                  $0.80
                                                                           ────────
    Inference Subtotal (Option C):                                         $16.80
    (Note: Higher latency, cold starts)

STORAGE:
──────────────────────────────────────────────────────────────────────────────────────
  S3 (100GB images, 10GB features, 1GB models)                               $2.53
  S3 requests (1M requests)                                                  $0.40
                                                                            ────────
  Storage Subtotal:                                                          $2.93

DATA TRANSFER:
──────────────────────────────────────────────────────────────────────────────────────
  Outbound (10GB)                                                            $0.90

══════════════════════════════════════════════════════════════════════════════════════
TOTAL MONTHLY COST:
  Low Traffic (Option C):     $32/month    (~1K requests/day)
  Medium Traffic (Option B):  $526/month   (~3K requests/day)
  High Traffic (Option A):    $544/month   (~10K requests/day)
══════════════════════════════════════════════════════════════════════════════════════
```

---

## Data Pipeline Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                          DATA PIPELINE ARCHITECTURE                                              │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘

                                    ┌───────────────────────────────────────┐
                                    │          EXTERNAL DATA SOURCES         │
                                    │                                        │
                                    │  TCGplayer API    Cardmarket API       │
                                    │  eBay API         OPTCG API            │
                                    │  Yahoo Auctions   Social Media         │
                                    └────────────────────┬──────────────────┘
                                                         │
                                    ┌────────────────────┴──────────────────┐
                                    │              INGESTION                 │
                                    │                                        │
                                    │  ┌─────────────┐    ┌─────────────┐   │
                                    │  │  Lambda     │    │  EventBridge│   │
                                    │  │  (Hourly)   │    │  (Scheduled)│   │
                                    │  └──────┬──────┘    └──────┬──────┘   │
                                    │         │                  │          │
                                    │         ▼                  ▼          │
                                    │       ┌────────────────────┐          │
                                    │       │   Kinesis Firehose │          │
                                    │       │   (Buffering)      │          │
                                    │       └─────────┬──────────┘          │
                                    │                 │                     │
                                    └─────────────────┼─────────────────────┘
                                                      │
                                                      ▼
┌──────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                                  S3 DATA LAKE                                                     │
│                                                                                                                   │
│  ┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────┐ │
│  │  RAW LAYER (Bronze)                                                                                          │ │
│  │  s3://tcg-ml-raw/                                                                                            │ │
│  │                                                                                                              │ │
│  │  ├── listings/                    ├── prices/                     ├── images/                               │ │
│  │  │   ├── tcgplayer/               │   ├── daily/                  │   ├── raw/                              │ │
│  │  │   │   └── 2026/01/08/          │   │   └── 2026-01-08.parquet  │   │   └── listing_12345.jpg             │ │
│  │  │   ├── cardmarket/              │   └── hourly/                 │   └── processed/                        │ │
│  │  │   └── ebay/                    │       └── 2026-01-08-14.json  │       └── listing_12345_224.jpg         │ │
│  │  │                                │                               │                                          │ │
│  │  └── sellers/                     └── market/                                                                │ │
│  │      └── profiles.parquet             └── tcg100_history.parquet                                            │ │
│  └─────────────────────────────────────────────────────────────────────────────────────────────────────────────┘ │
│                                                      │                                                            │
│                                                      ▼                                                            │
│  ┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────┐ │
│  │  PROCESSED LAYER (Silver)                                                                                    │ │
│  │  s3://tcg-ml-processed/                                                                                      │ │
│  │                                                                                                              │ │
│  │  ├── demand_features/             ├── quality_features/           ├── timing_features/                      │ │
│  │  │   └── card_features.parquet    │   └── listing_features.parquet│   └── seasonal.parquet                  │ │
│  │  │                                │                               │                                          │ │
│  │  └── anomaly_features/            └── vision_labels/                                                         │ │
│  │      └── price_context.parquet        └── training_labels.csv                                               │ │
│  └─────────────────────────────────────────────────────────────────────────────────────────────────────────────┘ │
│                                                      │                                                            │
│                                                      ▼                                                            │
│  ┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────┐ │
│  │  TRAINING LAYER (Gold)                                                                                       │ │
│  │  s3://tcg-ml-training/                                                                                       │ │
│  │                                                                                                              │ │
│  │  ├── vision/                      ├── demand/                     ├── timing/                               │ │
│  │  │   ├── train/                   │   ├── train.parquet           │   └── prophet_data.parquet              │ │
│  │  │   ├── validation/              │   ├── validation.parquet      │                                          │ │
│  │  │   └── test/                    │   └── test.parquet            │                                          │ │
│  │  │                                │                               │                                          │ │
│  │  └── quality/                     └── anomaly/                                                               │ │
│  │      └── labeled_data.parquet         └── baseline_data.parquet                                             │ │
│  └─────────────────────────────────────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                                                   │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
                                                      │
                                                      │
                   ┌──────────────────────────────────┼──────────────────────────────────┐
                   │                                  │                                  │
                   ▼                                  ▼                                  ▼
          ┌────────────────┐                ┌────────────────┐                ┌────────────────┐
          │   AWS GLUE     │                │   AWS GLUE     │                │   AWS GLUE     │
          │   ETL Job      │                │   Crawler      │                │   Data Catalog │
          │                │                │                │                │                │
          │  - Clean       │                │  - Schema      │                │  - Metadata    │
          │  - Transform   │                │    discovery   │                │  - Lineage     │
          │  - Aggregate   │                │  - Partitions  │                │  - Statistics  │
          └────────────────┘                └────────────────┘                └────────────────┘
```

### Feature Engineering Pipeline

```python
# AWS Glue Job: Feature Engineering for Demand Model

import sys
from awsglue.transforms import *
from awsglue.utils import getResolvedOptions
from pyspark.context import SparkContext
from awsglue.context import GlueContext
from awsglue.job import Job
from pyspark.sql import functions as F
from pyspark.sql.window import Window

args = getResolvedOptions(sys.argv, ['JOB_NAME', 'source_bucket', 'target_bucket'])

sc = SparkContext()
glueContext = GlueContext(sc)
spark = glueContext.spark_session
job = Job(glueContext)
job.init(args['JOB_NAME'], args)

# Read raw price data
prices_df = spark.read.parquet(f"s3://{args['source_bucket']}/prices/daily/")

# Calculate features
window_7d = Window.partitionBy("card_id").orderBy("date").rowsBetween(-7, 0)
window_30d = Window.partitionBy("card_id").orderBy("date").rowsBetween(-30, 0)

features_df = prices_df \
    .withColumn("price_change_7d",
        (F.col("price") - F.lag("price", 7).over(Window.partitionBy("card_id").orderBy("date"))) /
        F.lag("price", 7).over(Window.partitionBy("card_id").orderBy("date"))
    ) \
    .withColumn("price_change_30d",
        (F.col("price") - F.lag("price", 30).over(Window.partitionBy("card_id").orderBy("date"))) /
        F.lag("price", 30).over(Window.partitionBy("card_id").orderBy("date"))
    ) \
    .withColumn("volatility_7d", F.stddev("price").over(window_7d)) \
    .withColumn("volatility_30d", F.stddev("price").over(window_30d)) \
    .withColumn("avg_price_7d", F.avg("price").over(window_7d)) \
    .withColumn("avg_price_30d", F.avg("price").over(window_30d)) \
    .withColumn("price_vs_avg_7d", F.col("price") / F.col("avg_price_7d")) \
    .withColumn("price_vs_avg_30d", F.col("price") / F.col("avg_price_30d"))

# Write to processed layer
features_df.write.parquet(
    f"s3://{args['target_bucket']}/demand_features/",
    mode="overwrite",
    partitionBy=["date"]
)

job.commit()
```

---

## Next Steps

### Phase 1: Foundation (Week 1-2)
- [ ] Set up AWS infrastructure (S3 buckets, IAM roles)
- [ ] Create data ingestion pipeline (Lambda + Kinesis)
- [ ] Implement feature engineering (Glue jobs)
- [ ] Collect initial training data

### Phase 2: Vision Model (Week 3-4)
- [ ] Label card images (condition, language, variant)
- [ ] Train EfficientNet multi-task model
- [ ] Deploy to SageMaker endpoint
- [ ] Integrate with listing ingestion

### Phase 3: Tabular Models (Week 5-6)
- [ ] Train XGBoost demand forecasting model
- [ ] Train Isolation Forest anomaly detector
- [ ] Train Logistic Regression quality scorer
- [ ] Deploy to Lambda

### Phase 4: Time Series (Week 7-8)
- [ ] Train Prophet models per card/set
- [ ] Deploy to SageMaker Serverless
- [ ] Build optimal timing API

### Phase 5: Orchestration (Week 9-10)
- [ ] Build orchestrator Lambda
- [ ] Create combined analysis endpoint
- [ ] Integrate with CardForum application
- [ ] Monitor and iterate

---

*Document Version: 1.0.0*
*Created: 2026-01-08*
*Architecture: Modular ML Specialists*
