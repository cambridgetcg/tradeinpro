# Training Data Collection Strategy & Feedback Interface Design

**Date:** 2026-01-09
**Status:** Research Complete, Awaiting Implementation
**Purpose:** SERP API data sources, user feedback interface design, and training data requirements

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [SERP API Data Sources](#2-serp-api-data-sources)
3. [Data Types per Model](#3-data-types-per-model)
4. [User Feedback Requirements](#4-user-feedback-requirements)
5. [Interactive Feedback Interface Design](#5-interactive-feedback-interface-design)
6. [Implementation Roadmap](#6-implementation-roadmap)

---

## 1. Executive Summary

### Key Findings

| Data Source | Cost (1M/mo) | Quality | Best For |
|-------------|--------------|---------|----------|
| **Serper** | ~$1,000 | High | Google Shopping trends, volume signals |
| **DataForSEO** | ~$600 | High | Multi-engine SERP, historical data |
| **Card Market API** | ~$100 | Excellent | EU/US price pairs (arbitrage) |
| **TCGdex** | Free | Good | Pokemon pricing (extends to OPTCG pattern) |
| **Google Images API** | ~$500 | Excellent | Card image collection for vision models |
| **eBay Browse API** | Free tier | Good | Sold listings, condition data |

### Total Estimated Monthly Cost: £1,500-2,500

### User Feedback Required

| Model | Feedback Type | Estimated Volume | Time Investment |
|-------|--------------|------------------|-----------------|
| M1a ViT (Card ID) | Image labeling | 100-200 images/week | 2-3 hours/week |
| M1b Condition | Grade verification | 50-100 cards/week | 1-2 hours/week |
| M6 Demand | Trade outcome logging | Automatic + manual | 30 min/week |
| M8 Arbitrage | Spread validation | 20-50 opportunities/week | 1 hour/week |
| M15 Meta-Learner | Decision feedback | All trades | Automatic |

---

## 2. SERP API Data Sources

### 2.1 Recommended Provider Stack

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     SERP API DATA COLLECTION STACK                           │
└─────────────────────────────────────────────────────────────────────────────┘

TIER 1: CORE PRICING DATA
├── Card Market API (cardmarket-api.com)
│   ├── Cardmarket EUR prices
│   ├── TCGplayer USD prices
│   ├── Combined in single response
│   ├── PSA/Beckett/CGC graded prices
│   └── Historical trends (1/7/30 days)
│
├── TCGdex API (tcgdex.dev)
│   ├── Free tier (no API key)
│   ├── Hourly TCGplayer updates
│   ├── Daily Cardmarket updates
│   └── Multi-variant support
│
└── Your Existing Lambda (trading-card-pricer)
    ├── OPTCG API integration
    ├── card_prices_v2 table
    └── 8 AM / 8 PM UTC sync

TIER 2: MARKET INTELLIGENCE
├── DataForSEO ($0.001/search)
│   ├── Google Shopping API
│   │   ├── Product listings
│   │   ├── Price trends
│   │   ├── Seller data
│   │   └── Availability signals
│   │
│   └── Google Images API
│       ├── Card image URLs
│       ├── Source diversity
│       └── Pre-labeled categories
│
└── Serper ($0.001/search)
    ├── Fast Google search
    ├── Shopping results
    └── Social mention tracking

TIER 3: LISTING DATA
├── eBay Browse API (free tier)
│   ├── Sold listings
│   ├── Active listings
│   ├── Seller reputation
│   └── Condition descriptions
│
└── Ximilar API (optional)
    ├── AI-powered price checking
    ├── eBay + TCGplayer integration
    └── Automated card identification
```

### 2.2 API Configuration

```yaml
# Environment variables for SERP integration
SERP_PROVIDERS:
  dataforseo:
    api_login: "${DATAFORSEO_LOGIN}"
    api_password: "${DATAFORSEO_PASSWORD}"
    base_url: "https://api.dataforseo.com/v3"
    rate_limit: 2000  # requests per minute
    cost_per_request: 0.001  # USD

  serper:
    api_key: "${SERPER_API_KEY}"
    base_url: "https://google.serper.dev"
    rate_limit: 250  # requests per minute
    cost_per_request: 0.001  # USD

  cardmarket_api:
    api_key: "${CARDMARKET_API_KEY}"
    base_url: "https://cardmarket-api.com/api"
    rate_limit: 100  # free tier, per day
    cost_per_request: 0.01  # paid tier, USD

  ebay:
    app_id: "${EBAY_APP_ID}"
    cert_id: "${EBAY_CERT_ID}"
    dev_id: "${EBAY_DEV_ID}"
    base_url: "https://api.ebay.com/buy/browse/v1"
    rate_limit: 5000  # per day, free tier
```

### 2.3 Data Collection Schedule

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     DATA COLLECTION SCHEDULE                                 │
└─────────────────────────────────────────────────────────────────────────────┘

FREQUENCY          SOURCE                  DATA TYPE                VOLUME
──────────────────────────────────────────────────────────────────────────────
Every 4 hours      trading-card-pricer     OPTCG prices            ~515 cards
                   (Lambda)                 USD/GBP/JPY

Every hour         Card Market API         TCGplayer prices         Top 100 cards
                                           Cardmarket prices

Every 6 hours      DataForSEO              Google Shopping          500 queries
                                           trends & listings

Daily (2 AM)       eBay Browse API         Sold listings (24h)      1000 listings
                                           Condition data

Daily (3 AM)       Google Images           New card images          100 images
                   (via DataForSEO)        For training

Weekly (Sunday)    Full market scan        All tracked cards        10,000 cards
                                           All platforms

Monthly            Model retraining        Accumulated data         N/A
```

---

## 3. Data Types per Model

### 3.1 M1a Vision Transformer - Card Identification

```yaml
SERP_DATA_SOURCES:
  google_images:
    query_template: "{card_name} {set_code} trading card"
    fields_extracted:
      - image_url
      - source_domain
      - image_dimensions
      - page_title
      - thumbnail_url

    quality_filters:
      - min_width: 300
      - max_width: 2000
      - aspect_ratio: 0.6-0.8  # Card ratio
      - exclude_domains: ["pinterest.com", "reddit.com"]

  ebay_listings:
    query_template: "{card_id} {variant_type}"
    fields_extracted:
      - image_urls[]
      - title
      - condition
      - seller_id
      - sold_price

USER_FEEDBACK_REQUIRED:
  - Image-to-card mapping verification
  - Variant type confirmation
  - Language identification
  - Reject blurry/wrong images

TRAINING_DATA_SCHEMA:
  image_url: string
  card_id: string (e.g., "OP01-121")
  set_code: string (e.g., "OP01")
  card_number: string (e.g., "121")
  variant_type: enum [regular, parallel, sp, manga, ...]
  language: enum [EN, JP, DE, FR, IT, ES, PT, KO, ZH]
  verified_by: user_id
  verification_timestamp: datetime
  confidence_score: float  # From automated matching
```

### 3.2 M1b Condition Grading

```yaml
SERP_DATA_SOURCES:
  ebay_sold:
    query: "PSA {grade} {card_name}"
    fields:
      - images[]
      - final_price
      - psa_grade
      - psa_cert_number

  grading_company_databases:
    sources:
      - PSA cert verification
      - CGC population reports
      - Beckett grading history

USER_FEEDBACK_REQUIRED:
  - Manual condition assessment of raw cards
  - Grade prediction vs actual outcome
  - Corner/edge/surface detail annotations
  - Centering measurement

TRAINING_DATA_SCHEMA:
  image_url: string
  card_id: string
  user_assessed_grade: enum [NM, LP, MP, HP, DMG]
  corner_scores: [float, float, float, float]  # TL, TR, BL, BR
  edge_scores: [float, float, float, float]  # T, R, B, L
  surface_score: float
  centering: {lr_ratio: float, tb_ratio: float}
  actual_psa_grade: int | null  # If submitted for grading
  assessor_id: user_id
  assessment_timestamp: datetime
```

### 3.3 M6 XGBoost Demand Forecasting

```yaml
SERP_DATA_SOURCES:
  google_trends:
    query: "{card_name} {set_name}"
    fields:
      - search_volume_7d
      - search_volume_trend
      - related_queries

  social_signals:
    platforms: [twitter, reddit, youtube]
    fields:
      - mention_count_7d
      - sentiment_score
      - influencer_mentions

  tournament_data:
    source: "Official tournament databases"
    fields:
      - deck_lists
      - card_frequency
      - placement

USER_FEEDBACK_REQUIRED:
  - Trade outcome logging (profit/loss)
  - Holding period tracking
  - Reason for trade decision
  - Market observation notes

TRAINING_DATA_SCHEMA:
  card_id: string
  observation_date: date
  # SERP-derived features
  search_volume: int
  social_mentions: int
  social_sentiment: float
  tournament_playrate: float
  # Price features (from existing data)
  price_current: float
  price_7d_ago: float
  price_30d_ago: float
  # User feedback (outcome)
  actual_price_7d_later: float
  actual_price_30d_later: float
  user_trade_decision: enum [bought, sold, held]
  user_profit_loss: float | null
```

### 3.4 M8 Cross-Market Arbitrage

```yaml
SERP_DATA_SOURCES:
  multi_platform_prices:
    platforms:
      tcgplayer:
        source: "Card Market API"
        currency: USD
      cardmarket:
        source: "Card Market API"
        currency: EUR
      ebay_uk:
        source: "eBay Browse API"
        currency: GBP
      ebay_us:
        source: "eBay Browse API"
        currency: USD

  fx_rates:
    source: "Exchange rate API"
    pairs: [USDGBP, EURGBP, JPYGBP]
    frequency: hourly

USER_FEEDBACK_REQUIRED:
  - Spread opportunity validation
  - Execution outcome (filled/missed)
  - Actual profit vs predicted
  - Execution time tracking
  - Condition mismatch reports

TRAINING_DATA_SCHEMA:
  spread_id: string
  card_id: string
  detection_timestamp: datetime
  buy_market: string
  buy_price: float
  buy_currency: string
  sell_market: string
  sell_price: float
  sell_currency: string
  gross_spread: float
  predicted_net_spread: float
  # User feedback
  was_executed: boolean
  execution_timestamp: datetime | null
  actual_buy_price: float | null
  actual_sell_price: float | null
  actual_profit: float | null
  failure_reason: string | null  # "condition_mismatch", "sold_out", "shipping_delay"
```

---

## 4. User Feedback Requirements

### 4.1 Feedback Types Matrix

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     USER FEEDBACK TYPES                                      │
└─────────────────────────────────────────────────────────────────────────────┘

TYPE                    EFFORT      FREQUENCY       VALUE TO MODELS
──────────────────────────────────────────────────────────────────────────────
Image Labeling          Medium      100/week        CRITICAL for M1a
                        Click to select card ID,
                        confirm variant/language

Condition Grading       High        50/week         CRITICAL for M1b
                        Assess corners, edges,
                        surface, centering

Trade Logging           Low         Per trade       HIGH for M6, M15
                        Record buy/sell with
                        prices and dates

Spread Validation       Medium      20/week         HIGH for M8
                        Confirm if opportunity
                        was real, report outcome

Model Correction        Low         As needed       MEDIUM for all
                        Flag incorrect predictions
                        provide correct answer

Market Observations     Low         Optional        MEDIUM for M6
                        Note unusual patterns,
                        external events
```

### 4.2 Input Interface Requirements

For each feedback type, the user needs:

```yaml
IMAGE_LABELING:
  inputs:
    - image: Display the card image
    - card_id_dropdown: Searchable list of cards
    - variant_buttons: [regular, parallel, sp, manga, other]
    - language_buttons: [EN, JP, DE, FR, IT, ES, PT, KO, ZH]
    - quality_slider: 1-5 (unusable to perfect)
    - skip_button: For unclear/wrong images

  outputs:
    - Labeled image for training
    - Confidence weight (based on user accuracy history)

CONDITION_GRADING:
  inputs:
    - card_image: High-resolution display
    - zoom_regions: Interactive corner/edge zoom
    - grade_selector: [NM, LP, MP, HP, DMG]
    - sub_grade_sliders:
        corners: 0-10
        edges: 0-10
        surface: 0-10
        centering: 0-10
    - psa_potential_checkbox: "Would you submit for grading?"
    - notes_field: Optional description

  outputs:
    - Condition assessment record
    - Sub-grade details
    - Aggregated training example

TRADE_LOGGING:
  inputs:
    - card_selector: Search by name or ID
    - action: [BUY, SELL]
    - platform: [tcgplayer, cardmarket, ebay, local, ...]
    - price: Number input
    - quantity: Number input
    - date: Date picker (default today)
    - notes: Optional

  outputs:
    - Trade record linked to card price history
    - Profit/loss calculation (auto)
    - Holding period tracking

SPREAD_VALIDATION:
  inputs:
    - opportunity_display: Show predicted spread details
    - status_buttons: [EXECUTED, MISSED, INVALID]
    - if executed:
        actual_buy_price: Number
        actual_sell_price: Number
        execution_date: Date
    - if invalid:
        reason_dropdown: [sold_out, wrong_condition, wrong_card, price_changed, ...]
    - notes: Optional

  outputs:
    - Spread outcome record
    - Model accuracy tracking
    - Threshold optimization data
```

---

## 5. Interactive Feedback Interface Design

### 5.1 Page Structure

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     NEURAL TRAINING FEEDBACK                                 │
│                     /app/neural/feedback                                     │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ Header                                                                       │
│ [Dashboard] [Image Labels] [Condition] [Trades] [Spreads] [Settings]        │
│                                                                             │
│ Progress: ████████░░░░░░░░░░░░ 42%                                          │
│ Weekly Goal: 73/100 images | 28/50 conditions | 15/20 spreads              │
└─────────────────────────────────────────────────────────────────────────────┘

┌───────────────────────────────────┬─────────────────────────────────────────┐
│ Queue                             │ Feedback Form                            │
│                                   │                                          │
│ ┌─────────────────────────────┐   │ ┌─────────────────────────────────────┐ │
│ │ 🖼 Image #1                 │   │ │                                     │ │
│ │ Source: eBay                │   │ │       [Large Card Image]            │ │
│ │ Confidence: 73%             │   │ │                                     │ │
│ │ Auto-match: OP01-121?       │ ← │ │                                     │ │
│ └─────────────────────────────┘   │ └─────────────────────────────────────┘ │
│                                   │                                          │
│ ┌─────────────────────────────┐   │ Card ID: [OP01-121 ▼] (searchable)      │
│ │ 🖼 Image #2                 │   │                                          │
│ │ Source: TCGplayer           │   │ Variant: ○ Regular ○ Parallel ● SP     │
│ │ Confidence: 89%             │   │          ○ Manga  ○ Other              │
│ └─────────────────────────────┘   │                                          │
│                                   │ Language: ● EN ○ JP ○ DE ○ FR ○ Other  │
│ ┌─────────────────────────────┐   │                                          │
│ │ 🖼 Image #3                 │   │ Quality: ★★★★☆ (4/5)                   │
│ │ Source: Google Images       │   │                                          │
│ │ Confidence: 45%             │   │ [Skip - Bad Image]  [Submit & Next →]   │
│ └─────────────────────────────┘   │                                          │
│                                   │                                          │
│ [Load More]                       │ Keyboard: [S]kip [Enter]Submit [1-5]Qual │
└───────────────────────────────────┴─────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ Session Stats                                                                │
│                                                                             │
│ This session: 12 labeled | 3 skipped | ~8 min                               │
│ Accuracy: 94% (vs verified samples)                                         │
│ Contribution: +1.2% to model training data                                  │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 5.2 Condition Grading Interface

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     CONDITION GRADING                                        │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                                                                       │  │
│  │                    [Full Card Image - Zoomable]                       │  │
│  │                                                                       │  │
│  │   ┌────┐                                               ┌────┐        │  │
│  │   │ TL │ ← Click to zoom                               │ TR │        │  │
│  │   └────┘                                               └────┘        │  │
│  │                                                                       │  │
│  │                                                                       │  │
│  │                                                                       │  │
│  │                                                                       │  │
│  │   ┌────┐                                               ┌────┐        │  │
│  │   │ BL │                                               │ BR │        │  │
│  │   └────┘                                               └────┘        │  │
│  │                                                                       │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ Quick Grade:  [NM] [LP] [MP] [HP] [DMG]                                     │
│                ↑ Selected                                                    │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ Detailed Assessment (Optional - Improves Training Quality)                   │
│                                                                             │
│ Corners:   ████████░░ 8/10  [Click corners in image to zoom]               │
│ Edges:     ███████░░░ 7/10                                                  │
│ Surface:   █████████░ 9/10                                                  │
│ Centering: ██████░░░░ 6/10  [Auto-detected: 55/45 L/R, 52/48 T/B]          │
│                                                                             │
│ ☐ Would you submit this for PSA grading?                                    │
│                                                                             │
│ Notes: [                                                    ]               │
│                                                                             │
│ [Skip]                                    [Submit & Next →]                 │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ Corner Zoom Modal                                                            │
│ ┌─────────────────────────────────────────┐                                 │
│ │                                         │                                 │
│ │    [300% Zoom of Selected Corner]       │                                 │
│ │                                         │                                 │
│ │    Whitening: ○ None ○ Minor ● Moderate │                                 │
│ │    Dings:     ○ None ● Minor ○ Major    │                                 │
│ │                                         │                                 │
│ └─────────────────────────────────────────┘                                 │
│                            [Close] [Next Corner →]                          │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 5.3 Trade Logging Interface

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     TRADE LOG                                                │
│                     /app/neural/feedback/trades                              │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ Quick Add Trade                                                              │
│                                                                             │
│ Card: [Search: "OP01-121 Roronoa Zoro"              ▼]                      │
│                                                                             │
│ Action:   ● BUY  ○ SELL                                                     │
│                                                                             │
│ Platform: ○ TCGplayer ● eBay UK ○ Cardmarket ○ Local ○ Other               │
│                                                                             │
│ Price: £ [45.00]   Quantity: [1]   Date: [2026-01-09]                       │
│                                                                             │
│ Condition: [LP ▼]   Shipping: £ [3.50]                                      │
│                                                                             │
│ Notes: [Bought for resale, expect 15% margin          ]                     │
│                                                                             │
│ [Cancel]                                        [Log Trade]                 │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ Recent Trades                                                                │
│                                                                             │
│ ┌─────────────────────────────────────────────────────────────────────────┐ │
│ │ 2026-01-08  BUY   OP01-121 Zoro SP       £45.00  eBay UK    [OPEN]     │ │
│ │             Model predicted: +12% in 30d  Current: £47.50 (+5.6%)      │ │
│ │             [Close Position]                                           │ │
│ ├─────────────────────────────────────────────────────────────────────────┤ │
│ │ 2026-01-05  BUY   OP03-099 Yamato Par    £28.00  TCGplayer  [CLOSED]   │ │
│ │             SELL  2026-01-08              £35.00  eBay UK              │ │
│ │             Profit: £4.50 (+16%)  Days held: 3                        │ │
│ │             Model predicted: +8%   ✓ Beat prediction                   │ │
│ ├─────────────────────────────────────────────────────────────────────────┤ │
│ │ 2026-01-03  BUY   OP02-004 Ace SP        £62.00  Cardmarket [CLOSED]   │ │
│ │             SELL  2026-01-07              £58.00  eBay UK              │ │
│ │             Loss: -£7.50 (-12%)  Days held: 4                         │ │
│ │             Model predicted: +5%   ✗ Missed prediction                │ │
│ └─────────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
│ Summary: 15 trades | 11 wins (73%) | Avg return: +8.2% | Best: +32%        │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 5.4 Spread Validation Interface

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     ARBITRAGE OPPORTUNITIES                                  │
│                     /app/neural/feedback/spreads                             │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ Live Opportunities (Refresh: 5 min ago)                                      │
│                                                                             │
│ ┌─────────────────────────────────────────────────────────────────────────┐ │
│ │ 🟢 HIGH CONFIDENCE                                                      │ │
│ │                                                                         │ │
│ │ OP01-121 Roronoa Zoro (SP)                                              │ │
│ │                                                                         │ │
│ │ BUY:  TCGplayer   $52.00 (£41.60)                                       │ │
│ │ SELL: eBay UK     £55.00                                                │ │
│ │                                                                         │ │
│ │ Gross Spread: 32%                                                       │ │
│ │ Est. Net:     12% (after fees, shipping)                                │ │
│ │ Confidence:   87%                                                       │ │
│ │ Urgency:      HIGH (expires ~2 hours)                                   │ │
│ │                                                                         │ │
│ │ [I Executed This]  [Not Available]  [Wrong Card/Condition]  [Skip]      │ │
│ └─────────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
│ ┌─────────────────────────────────────────────────────────────────────────┐ │
│ │ 🟡 MEDIUM CONFIDENCE                                                    │ │
│ │                                                                         │ │
│ │ OP03-099 Yamato (Parallel)                                              │ │
│ │                                                                         │ │
│ │ BUY:  Cardmarket  €25.00 (£21.25)                                       │ │
│ │ SELL: TCGplayer   $32.00 (£25.60)                                       │ │
│ │                                                                         │ │
│ │ Gross Spread: 20%                                                       │ │
│ │ Est. Net:     6% (after fees, shipping)                                 │ │
│ │ Confidence:   65%                                                       │ │
│ │ Urgency:      MEDIUM                                                    │ │
│ │                                                                         │ │
│ │ [I Executed This]  [Not Available]  [Wrong Card/Condition]  [Skip]      │ │
│ └─────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ Execution Feedback Modal                                                     │
│                                                                             │
│ You selected: "I Executed This"                                              │
│                                                                             │
│ Actual Buy Price:  £ [42.50]  (Model predicted: £41.60)                     │
│ Actual Sell Price: £ [53.00]  (Model predicted: £55.00)                     │
│ Execution Date:    [2026-01-09]                                              │
│                                                                             │
│ Condition Match:   ● Yes, as expected  ○ Worse than listed  ○ Better        │
│                                                                             │
│ Notes: [Seller shipped fast, card was LP not NM     ]                       │
│                                                                             │
│ Actual Profit: £7.00 (Model predicted: £8.40)                               │
│ Accuracy: 83% ✓                                                             │
│                                                                             │
│ [Cancel]                                      [Submit Feedback]             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 5.5 Dashboard Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     NEURAL TRAINING DASHBOARD                                │
│                     /app/neural/feedback                                     │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ Your Contribution                                                            │
│                                                                             │
│ ┌───────────────────────┬───────────────────────┬───────────────────────┐   │
│ │   IMAGE LABELS        │   CONDITION GRADES    │   SPREAD FEEDBACK     │   │
│ │                       │                       │                       │   │
│ │   ████████████░░░     │   ██████░░░░░░░░░     │   ████████████████░   │   │
│ │   247 / 500           │   89 / 200            │   156 / 200           │   │
│ │   This week: +42      │   This week: +12      │   This week: +28      │   │
│ │   Accuracy: 94%       │   Accuracy: 82%       │   Executed: 45%       │   │
│ │                       │                       │                       │   │
│ │   [Continue →]        │   [Continue →]        │   [View Live →]       │   │
│ └───────────────────────┴───────────────────────┴───────────────────────┘   │
│                                                                             │
│ Overall Impact: Your data improved model accuracy by ~2.3% this month      │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ Model Training Status                                                        │
│                                                                             │
│ ┌──────────────────────────────────────────────────────────────────────┐    │
│ │ M1a Vision Transformer                                                │    │
│ │ Status: AWAITING DATA | 12,450 / 500,000 images (2.5%)               │    │
│ │ ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░                   │    │
│ │ Est. time to training: 8-12 months at current rate                   │    │
│ │ Bottleneck: Need more variant card images                            │    │
│ ├──────────────────────────────────────────────────────────────────────┤    │
│ │ M1b Condition Grading                                                 │    │
│ │ Status: AWAITING DATA | 3,200 / 100,000 images (3.2%)                │    │
│ │ █░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░                  │    │
│ │ Est. time to training: 6-8 months at current rate                    │    │
│ │ Bottleneck: Need PSA-verified condition labels                       │    │
│ ├──────────────────────────────────────────────────────────────────────┤    │
│ │ M8 Arbitrage Detector                                                 │    │
│ │ Status: RULE-BASED | 45,000 / 10,000,000 spreads (0.45%)             │    │
│ │ ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░                   │    │
│ │ Collecting passively from market scans                               │    │
│ │ Your feedback: 156 validated spreads                                 │    │
│ └──────────────────────────────────────────────────────────────────────┘    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ Quick Actions                                                                │
│                                                                             │
│ [🖼 Label 10 Images]  [📊 Grade 5 Cards]  [💰 Log Trade]  [🔍 Check Spreads] │
│                                                                             │
│ Estimated time: 15 min for full daily contribution                          │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 6. Implementation Roadmap

### Phase 1: Data Collection Infrastructure (Week 1-2)

```yaml
tasks:
  - Setup SERP API accounts
      - DataForSEO (Google Shopping, Images)
      - Card Market API
      - eBay Developer account

  - Create data ingestion workers
      - Scheduled Lambda for SERP queries
      - Image download and S3 storage
      - Price normalization pipeline

  - Database schema updates
      - SerpImageQueue table
      - ConditionLabel table
      - TradeLog table
      - SpreadOutcome table

deliverables:
  - Working SERP data pipeline
  - Image storage in S3
  - Scheduled collection jobs
```

### Phase 2: Feedback Interface (Week 3-4)

```yaml
tasks:
  - Build feedback routes
      - /app/neural/feedback (dashboard)
      - /app/neural/feedback/images (labeling)
      - /app/neural/feedback/conditions (grading)
      - /app/neural/feedback/trades (logging)
      - /app/neural/feedback/spreads (validation)

  - Create UI components
      - ImageLabeler component
      - ConditionGrader component (with zoom)
      - TradeLogger component
      - SpreadValidator component
      - ProgressTracker component

  - Implement keyboard shortcuts
      - [1-5] for quality rating
      - [N/L/M/H/D] for condition grades
      - [Enter] to submit
      - [S] to skip

deliverables:
  - Functional feedback interface
  - Mobile-responsive design
  - Keyboard navigation
```

### Phase 3: Gamification & Incentives (Week 5-6)

```yaml
tasks:
  - Add progress tracking
      - Weekly goals
      - Streak tracking
      - Accuracy leaderboard

  - Implement rewards
      - Free API tier upgrades
      - Early access to features
      - Reduced commission rates

  - Add quality assurance
      - Duplicate labeling for verification
      - Gold standard test samples
      - Accuracy scoring

deliverables:
  - Gamified feedback system
  - Quality metrics
  - Reward redemption
```

### Phase 4: Model Training Integration (Week 7-8)

```yaml
tasks:
  - Export training datasets
      - Image dataset for M1a/M1b
      - Tabular dataset for M6/M8
      - Outcome dataset for M15

  - Setup training pipelines
      - AWS SageMaker notebooks
      - W&B experiment tracking
      - Automated retraining triggers

  - Monitor model improvement
      - A/B test predictions
      - Track accuracy vs feedback volume
      - Publish metrics to dashboard

deliverables:
  - Automated training pipeline
  - Model versioning
  - Performance monitoring
```

---

## Appendix: Required User Inputs Summary

### Daily (5-10 minutes)

| Task | Input | Impact |
|------|-------|--------|
| Image Labeling | Click card ID, variant, language | +2-5 training images |
| Log Trades | Enter buy/sell details | +1-3 outcome records |

### Weekly (30-60 minutes)

| Task | Input | Impact |
|------|-------|--------|
| Condition Grading | Assess 10-20 card images | +10-20 training labels |
| Spread Validation | Confirm/reject 10-30 opportunities | +10-30 outcome records |
| Trade Reviews | Close open positions with actual prices | +5-10 profit/loss records |

### Monthly (1-2 hours)

| Task | Input | Impact |
|------|-------|--------|
| Accuracy Review | Review flagged predictions | Quality improvement |
| Threshold Tuning | Adjust personal thresholds | Personalized signals |
| Data Export | Download personal trade history | Backup + analysis |

---

*Document Version: 1.0.0*
*Created: 2026-01-09*
*Status: Ready for Implementation*
