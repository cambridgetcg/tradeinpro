# AI Models for TCG Market Arbitrage - Value Capture Framework

**Date:** 2026-01-09
**Status:** Research & Integration Blueprint
**Purpose:** Comprehensive analysis of AI/ML models for trading card market arbitrage with training data specifications

---

## Executive Summary

This document provides an **ultrathink analysis** of AI models optimized for capturing value in the trading card market arbitrage ecosystem. Based on previous research (ML_ARCHITECTURE_DESIGN.md, NEURAL_EMBRYO_GENESIS.md, NEURAL_DEAL_IDENTIFICATION_SPEC.md), we identify **15 specialized models** across 6 functional layers, each with specific training data requirements.

---

## Table of Contents

1. [Model Taxonomy Overview](#1-model-taxonomy-overview)
2. [Layer 1: Perception Models](#2-layer-1-perception-models)
3. [Layer 2: Evaluation Models](#3-layer-2-evaluation-models)
4. [Layer 3: Prediction Models](#4-layer-3-prediction-models)
5. [Layer 4: Anomaly & Opportunity Models](#5-layer-4-anomaly--opportunity-models)
6. [Layer 5: Execution Optimization](#6-layer-5-execution-optimization)
7. [Layer 6: Meta-Learning & Ensemble](#7-layer-6-meta-learning--ensemble)
8. [Training Data Requirements Matrix](#8-training-data-requirements-matrix)
9. [Pipeline Integration Architecture](#9-pipeline-integration-architecture)
10. [Implementation Priority Roadmap](#10-implementation-priority-roadmap)

---

## 1. Model Taxonomy Overview

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                    TCG ARBITRAGE VALUE CAPTURE - AI MODEL STACK                       │
└─────────────────────────────────────────────────────────────────────────────────────┘

LAYER 6: META-LEARNING & ENSEMBLE
├── M15: Stacking Meta-Learner (Gradient Boosting ensemble)
└── M14: Online Learning Adapter (Incremental model updates)

LAYER 5: EXECUTION OPTIMIZATION
├── M13: Reinforcement Learning Agent (Optimal execution strategy)
├── M12: Order Book Simulator (Market impact modeling)
└── M11: Position Sizing Optimizer (Kelly criterion + constraints)

LAYER 4: ANOMALY & OPPORTUNITY DETECTION
├── M10: Isolation Forest (Price anomalies)
├── M9: Autoencoder Network (Complex pattern anomalies)
└── M8: Cross-Market Arbitrage Detector (Multi-source spread analysis)

LAYER 3: PREDICTION MODELS
├── M7: Temporal Fusion Transformer (Multi-horizon price prediction)
├── M6: XGBoost/LightGBM Ensemble (Demand forecasting)
├── M5: Prophet + ARIMA Hybrid (Seasonality & timing)
└── M4: Graph Neural Network (Market topology & correlations)

LAYER 2: EVALUATION MODELS
├── M3: Logistic Regression Ensemble (Listing quality)
└── M2: Seller Risk Scorer (Counterparty assessment)

LAYER 1: PERCEPTION MODELS
├── M1a: Vision Transformer (ViT) (Card identification)
├── M1b: Multi-Task CNN (Condition grading)
└── M1c: Siamese Network (Card matching & deduplication)
```

---

## 2. Layer 1: Perception Models

### M1a: Vision Transformer (ViT) - Card Identification

**Purpose:** Identify cards from listing images with high accuracy across variants, languages, and conditions.

**Architecture:**
```
┌─────────────────────────────────────────────────────────────────┐
│                    VISION TRANSFORMER (ViT-B/16)                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│   Input: 224×224×3 RGB Image                                      │
│                │                                                   │
│                ▼                                                   │
│   ┌─────────────────────────┐                                     │
│   │   Patch Embedding       │  16×16 patches → 196 tokens         │
│   │   + Position Encoding   │  + Learnable [CLS] token            │
│   └───────────┬─────────────┘                                     │
│               │                                                    │
│               ▼                                                    │
│   ┌─────────────────────────┐                                     │
│   │   Transformer Encoder   │  12 layers, 768 hidden, 12 heads    │
│   │   × 12 Blocks           │  Pre-trained on ImageNet-21K        │
│   └───────────┬─────────────┘                                     │
│               │                                                    │
│       ┌───────┴───────┬───────────────┬───────────────┐          │
│       ▼               ▼               ▼               ▼          │
│   ┌─────────┐   ┌─────────┐    ┌─────────┐    ┌─────────┐       │
│   │Card ID  │   │Language │    │Variant  │    │Auth     │       │
│   │(10K cls)│   │(9 cls)  │    │(10 cls) │    │(binary) │       │
│   └─────────┘   └─────────┘    └─────────┘    └─────────┘       │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘

Model Specifications:
  • Parameters: ~86M (ViT-B/16)
  • Input size: 224×224×3
  • Inference time: ~30ms (GPU), ~200ms (CPU)
  • Memory: ~350MB loaded
```

**Why ViT over CNN:**
| Aspect | CNN (EfficientNet) | Vision Transformer |
|--------|-------------------|-------------------|
| Global attention | Limited receptive field | Full image attention |
| Card text reading | Poor | Better at text regions |
| Variant detection | Good | Excellent (holographic patterns) |
| Transfer learning | Good | Excellent (scaling laws) |
| Training data needs | 50K images | 100K+ images |
| Fine-tuning efficiency | Medium | High (adapters) |

**Training Data Requirements:**

```yaml
M1a_TRAINING_DATA:
  card_identification:
    total_images: 500,000
    per_card_minimum: 50
    sources:
      - Official card database images (reference)
      - eBay listing photos (real-world)
      - TCGplayer listing photos
      - Cardmarket listing photos
      - User submissions (trade-in photos)

    augmentation:
      - Rotation: ±15°
      - Perspective: ±10°
      - Brightness: ±20%
      - Contrast: ±15%
      - Blur: Gaussian σ=0-2
      - JPEG artifacts: q=50-95
      - Background variation: 10 templates
      - Partial occlusion: 0-20%

    labeling:
      - card_id: Primary key from database
      - set_code: e.g., "OP01"
      - card_number: e.g., "003"
      - variant_type: [regular, parallel, sp, manga, ...]
      - language: [EN, JP, DE, FR, IT, ES, PT, KO, ZH]
      - image_quality: [high, medium, low, unusable]

    validation_split: 15%
    test_split: 15%

    collection_priority:
      - High-value variants (>£20): 100+ images each
      - Common cards: 20+ images each
      - Known counterfeits: 500+ examples
```

### M1b: Multi-Task CNN - Condition Grading

**Purpose:** Assess card condition from images with sub-grade precision for PSA potential estimation.

**Architecture:**
```
┌─────────────────────────────────────────────────────────────────┐
│                    CONDITION GRADING CNN                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│   Input: 448×448×3 (High-res for surface details)                │
│                │                                                   │
│                ▼                                                   │
│   ┌─────────────────────────┐                                     │
│   │   EfficientNet-B5       │  Backbone feature extraction        │
│   │   (Pre-trained)         │  Output: 2048-dim features          │
│   └───────────┬─────────────┘                                     │
│               │                                                    │
│       ┌───────┴───────────────────────────────┐                   │
│       │         Feature Pyramid Network        │                   │
│       │    (Multi-scale condition detection)   │                   │
│       └───────┬───────────────────────────────┘                   │
│               │                                                    │
│   ┌───────────┼───────────────┬───────────────┐                   │
│   ▼           ▼               ▼               ▼                   │
│ ┌──────┐  ┌──────┐       ┌──────┐        ┌──────┐                │
│ │Corner│  │Edge  │       │Surface│       │Center│                │
│ │Wear  │  │White │       │Scratch│       │-ing  │                │
│ │Head  │  │Head  │       │Head   │       │Head  │                │
│ └──┬───┘  └──┬───┘       └──┬───┘        └──┬───┘                │
│    │         │              │               │                     │
│    └─────────┴──────────────┴───────────────┘                     │
│                      │                                             │
│                      ▼                                             │
│              ┌──────────────┐                                      │
│              │   Condition  │                                      │
│              │   Classifier │  Output: NM/LP/MP/HP/DMG + PSA est  │
│              │   + PSA Est  │                                      │
│              └──────────────┘                                      │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘

Outputs:
  • condition_class: [NM, LP, MP, HP, DMG] (5-class)
  • condition_score: 0.0-1.0 continuous
  • sub_grades:
      - corners: 0.0-1.0
      - edges: 0.0-1.0
      - surface: 0.0-1.0
      - centering: 0.0-1.0
  • psa_estimate: 1-10 continuous
  • psa_10_probability: 0.0-1.0
  • grading_recommendation: boolean
```

**Training Data Requirements:**

```yaml
M1b_TRAINING_DATA:
  condition_grading:
    total_images: 100,000
    per_condition_minimum:
      NM: 30,000
      LP: 25,000
      MP: 20,000
      HP: 15,000
      DMG: 10,000

    sources:
      - PSA/CGC/BGS graded card images (gold standard)
      - Professional graders' assessments
      - Platform-verified condition photos
      - Synthetic damage augmentation

    labeling:
      - condition_class: NM/LP/MP/HP/DMG
      - professional_grade: PSA 1-10 (where available)
      - corner_scores: [TL, TR, BL, BR] 0-10 each
      - edge_whitening: 0-10 per edge
      - surface_issues: [scratches, print_lines, holo_scratches]
      - centering: L/R, T/B percentages
      - creases: count and severity
      - grading_company: PSA/CGC/BGS/raw

    augmentation:
      - Synthetic edge whitening
      - Synthetic corner wear
      - Synthetic surface scratches
      - Varying lighting angles
      - Macro crop variations

    special_requirements:
      - PSA 10 examples: 10,000+ images
      - Borderline cases (e.g., NM/LP boundary): 15,000+
      - Known grading company discrepancies: 5,000+
```

### M1c: Siamese Network - Card Matching

**Purpose:** Match unknown listing images to database cards using learned similarity.

**Architecture:**
```
┌─────────────────────────────────────────────────────────────────┐
│                    SIAMESE MATCHING NETWORK                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│   Listing Image              Reference Image (DB)                │
│        │                           │                              │
│        ▼                           ▼                              │
│   ┌─────────┐                 ┌─────────┐                        │
│   │ Encoder │   (Shared       │ Encoder │                        │
│   │   CNN   │◄── Weights ───► │   CNN   │                        │
│   └────┬────┘                 └────┬────┘                        │
│        │                           │                              │
│        ▼                           ▼                              │
│   [512-dim]                   [512-dim]                          │
│   Embedding                   Embedding                          │
│        │                           │                              │
│        └───────────┬───────────────┘                             │
│                    │                                              │
│                    ▼                                              │
│            ┌──────────────┐                                       │
│            │  Contrastive │                                       │
│            │    Loss      │                                       │
│            │  (Training)  │                                       │
│            └──────────────┘                                       │
│                    │                                              │
│                    ▼                                              │
│            ┌──────────────┐                                       │
│            │  Similarity  │  Euclidean or Cosine                 │
│            │    Score     │  0.0 (different) → 1.0 (same)        │
│            └──────────────┘                                       │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘

Use Cases:
  • Listing → Database card matching (identification)
  • Duplicate listing detection across platforms
  • Counterfeit detection (dissimilarity to known authentic)
  • Set completion tracking
```

**Training Data Requirements:**

```yaml
M1c_TRAINING_DATA:
  card_matching:
    positive_pairs: 500,000  # Same card, different photos
    negative_pairs: 500,000  # Different cards
    hard_negatives: 100,000  # Similar-looking different cards

    sources:
      - Multiple photos of same physical card
      - Same card from different sellers
      - Variant pairs (regular vs parallel of same card)
      - Cross-language pairs (EN vs JP same card)

    pair_generation:
      - Positive: Same card_id, different image source
      - Negative: Different card_id, same set/rarity
      - Hard negative: Same character/art, different card

    augmentation:
      - One-sided augmentation (aug one image in pair)
      - Quality degradation simulation
      - Angle/rotation variation
```

---

## 3. Layer 2: Evaluation Models

### M2: Seller Risk Scorer

**Purpose:** Assess counterparty risk for each transaction.

**Architecture:** Gradient Boosted Trees (XGBoost)

```yaml
M2_SELLER_RISK_SCORER:
  model_type: XGBoost Classifier

  features:
    historical:
      - feedback_score: 0-100%
      - feedback_count: integer
      - account_age_days: integer
      - total_transactions: integer
      - category_specialization: float (% TCG sales)
      - dispute_rate_30d: float
      - dispute_rate_all_time: float
      - return_rate: float
      - average_shipping_time: float (days)

    behavioral:
      - response_time_median: float (hours)
      - listing_velocity_7d: integer
      - price_consistency: float (std dev of prices)
      - condition_accuracy_rate: float
      - description_quality_score: float (NLP)
      - photo_quality_score: float (from M1)

    listing_specific:
      - uses_stock_photos: boolean
      - price_vs_market: float
      - shipping_method: categorical
      - accepts_returns: boolean
      - international_shipping: boolean

    derived:
      - anomaly_score: float (from Isolation Forest)
      - new_seller_flag: boolean (< 30 days)
      - volume_spike_flag: boolean (> 3x normal)

  output:
    - risk_class: [low, medium, high, critical]
    - risk_probability: float 0-1
    - risk_factors: list[str]
    - recommended_action: [proceed, verify, avoid]

  training_data:
    positive_examples: 50,000  # Successful transactions
    negative_examples:
      - Confirmed scammers: 5,000
      - Dispute cases: 10,000
      - Condition mismatch: 15,000
      - Non-delivery: 5,000

    sources:
      - Platform dispute records
      - Community-reported bad sellers
      - Historical transaction outcomes
      - User feedback aggregation
```

### M3: Listing Quality Ensemble

**Purpose:** Detect fraudulent, misgraded, or problematic listings.

**Architecture:** Ensemble of Logistic Regression + Random Forest

```yaml
M3_LISTING_QUALITY:
  ensemble_components:
    - Logistic Regression (interpretable baseline)
    - Random Forest (non-linear interactions)
    - Gradient Boosting (highest accuracy)

  voting: soft (probability averaging)

  features:
    price_signals:
      - price_z_score: float  # vs market
      - price_vs_recent_sales: float
      - price_percentile: float
      - is_suspiciously_low: boolean (< -30%)
      - is_suspiciously_high: boolean (> +50%)
      - is_round_number: boolean

    listing_signals:
      - has_photos: boolean
      - photo_count: integer
      - photo_quality_score: float
      - uses_stock_photo: boolean
      - description_length: integer
      - description_sentiment: float
      - title_keyword_flags: boolean[]
        # ["authentic", "real", "not fake", "100%", "guaranteed"]
      - grammatical_errors: integer

    seller_signals:
      - seller_risk_score: float (from M2)
      - seller_price_history: float[] (deviation pattern)

    card_signals:
      - card_fake_prevalence: float  # Known counterfeit rate
      - card_value_tier: categorical
      - condition_vs_price: float (consistency check)

  output:
    - quality_class: [legitimate, suspicious, likely_fake, misgraded, scam]
    - probabilities: {class: float}
    - risk_factors: list[{factor, severity, description}]
    - recommendation: [safe, caution, avoid]

  training_data:
    legitimate: 100,000
    suspicious: 20,000
    confirmed_fake: 5,000
    misgraded: 15,000
    scam: 3,000

    labeling_sources:
      - Platform fraud team records
      - Community reports
      - Professional authenticator verifications
      - Dispute resolution outcomes
```

---

## 4. Layer 3: Prediction Models

### M4: Graph Neural Network - Market Topology

**Purpose:** Model relationships between cards, sets, and market dynamics.

**Architecture:**
```
┌─────────────────────────────────────────────────────────────────┐
│                GRAPH NEURAL NETWORK (GNN)                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│   Graph Construction:                                             │
│   ┌─────────────────────────────────────────────────────────┐    │
│   │  NODES                      EDGES                        │    │
│   │  • Cards (10K+)             • Same set                   │    │
│   │  • Sets (50+)               • Same character             │    │
│   │  • Characters (500+)        • Price correlation          │    │
│   │  • Platforms (10)           • Substitute cards           │    │
│   │  • Time periods (365)       • Complement cards           │    │
│   │                             • Tournament deck co-occur   │    │
│   └─────────────────────────────────────────────────────────┘    │
│                                                                   │
│   Node Features:                                                  │
│   ┌─────────────────────────────────────────────────────────┐    │
│   │  Cards:                                                  │    │
│   │    • Price (current, 7d, 30d, 90d)                       │    │
│   │    • Volatility                                           │    │
│   │    • Volume                                               │    │
│   │    • Rarity encoding                                      │    │
│   │    • Color encoding                                       │    │
│   │    • Card type encoding                                   │    │
│   │    • Meta relevance                                       │    │
│   │                                                           │    │
│   │  Sets:                                                    │    │
│   │    • Release date                                         │    │
│   │    • Total value                                          │    │
│   │    • Set momentum                                         │    │
│   │    • Reprint status                                       │    │
│   └─────────────────────────────────────────────────────────┘    │
│                                                                   │
│   Architecture:                                                   │
│   ┌─────────────────────────────────────────────────────────┐    │
│   │                                                          │    │
│   │   Input Node Features                                    │    │
│   │          │                                               │    │
│   │          ▼                                               │    │
│   │   ┌──────────────┐                                       │    │
│   │   │  GraphSAGE   │  Layer 1: Neighbor aggregation        │    │
│   │   │  (256 dim)   │                                       │    │
│   │   └──────┬───────┘                                       │    │
│   │          │                                               │    │
│   │          ▼                                               │    │
│   │   ┌──────────────┐                                       │    │
│   │   │  GraphSAGE   │  Layer 2: 2-hop neighborhood          │    │
│   │   │  (128 dim)   │                                       │    │
│   │   └──────┬───────┘                                       │    │
│   │          │                                               │    │
│   │          ▼                                               │    │
│   │   ┌──────────────┐                                       │    │
│   │   │  Attention   │  Layer 3: Learn importance weights    │    │
│   │   │  Aggregation │                                       │    │
│   │   └──────┬───────┘                                       │    │
│   │          │                                               │    │
│   │          ▼                                               │    │
│   │   Node Embeddings (64 dim)                               │    │
│   │                                                          │    │
│   └─────────────────────────────────────────────────────────┘    │
│                                                                   │
│   Outputs:                                                        │
│   • Card embeddings (for downstream tasks)                       │
│   • Correlation predictions (price co-movement)                  │
│   • Market regime classification                                 │
│   • Anomaly detection (structural anomalies)                     │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

**Training Data Requirements:**

```yaml
M4_TRAINING_DATA:
  graph_construction:
    nodes:
      cards: 10,000+
      sets: 50+
      platforms: 10
      time_periods: 365 (daily snapshots)

    edges:
      same_set: ~200 per set
      price_correlation: Pearson > 0.5 over 30d
      deck_co_occurrence: Tournament data
      substitute: Manual + automated (same character/role)

    node_features:
      historical_prices: 365 days × cards
      volume_data: 365 days × cards
      tournament_data: Deck lists with placements

  training_objective:
    link_prediction: Predict future price correlations
    node_classification: Market regime per card

  sources:
    - Historical price data (CardPriceHistory)
    - Tournament deck databases
    - Set/card metadata
    - Platform API data
```

### M5: Prophet + ARIMA Hybrid - Seasonality & Timing

**Purpose:** Optimal buy/sell timing based on seasonal patterns.

**Architecture:**
```
┌─────────────────────────────────────────────────────────────────┐
│                    HYBRID TIMING MODEL                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│   ┌──────────────────────────────────────────────────────────┐   │
│   │                    PROPHET COMPONENT                      │   │
│   │                                                           │   │
│   │   y(t) = g(t) + s(t) + h(t) + ε(t)                       │   │
│   │                                                           │   │
│   │   g(t) = Trend (piecewise linear)                        │   │
│   │   s(t) = Seasonality (Fourier series)                    │   │
│   │          • Weekly: Day-of-week effects                   │   │
│   │          • Monthly: Payday effects                       │   │
│   │          • Yearly: Holiday/tournament seasons            │   │
│   │   h(t) = Holidays (TCG-specific events)                  │   │
│   │          • Set releases                                   │   │
│   │          • Tournament weekends                           │   │
│   │          • Ban list announcements                        │   │
│   │          • Christmas/Black Friday                        │   │
│   │          • Golden Week (JP)                              │   │
│   │                                                           │   │
│   └────────────────────────┬─────────────────────────────────┘   │
│                            │                                      │
│                            ▼                                      │
│   ┌──────────────────────────────────────────────────────────┐   │
│   │                    ARIMA COMPONENT                        │   │
│   │                                                           │   │
│   │   Residuals from Prophet → ARIMA(p,d,q)                  │   │
│   │                                                           │   │
│   │   • Captures short-term autocorrelation                  │   │
│   │   • Handles remaining structure                          │   │
│   │   • Auto-selected order using AIC                        │   │
│   │                                                           │   │
│   └────────────────────────┬─────────────────────────────────┘   │
│                            │                                      │
│                            ▼                                      │
│   ┌──────────────────────────────────────────────────────────┐   │
│   │                    ENSEMBLE OUTPUT                        │   │
│   │                                                           │   │
│   │   • Price forecast (7/30/90 days)                        │   │
│   │   • Confidence intervals (80%, 95%)                      │   │
│   │   • Optimal buy windows (next 30 days)                   │   │
│   │   • Optimal sell windows (next 30 days)                  │   │
│   │   • Seasonal decomposition                                │   │
│   │   • Trend direction & strength                           │   │
│   │                                                           │   │
│   └──────────────────────────────────────────────────────────┘   │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

**Training Data Requirements:**

```yaml
M5_TRAINING_DATA:
  time_series:
    per_card_history: 365+ days (minimum 90 days)
    frequency: Daily (ideally multiple snapshots/day)
    total_cards: All tracked cards (~10,000)

    features_per_point:
      - date
      - price_gbp
      - price_usd
      - price_jpy
      - volume_estimate
      - listings_count

    holiday_calendar:
      tcg_events:
        - name: "Set Release"
          dates: [dynamic per set]
          pre_window: 7
          post_window: 14

        - name: "Tournament Season"
          months: [3, 4, 8, 9]  # Regional/National seasons

        - name: "World Championship"
          dates: [annual, varies]
          pre_window: 30

        - name: "Ban List Announcement"
          dates: [quarterly]
          post_window: 7

      general_events:
        - Christmas: Dec 20-31
        - Black Friday: Nov 25-30
        - Golden Week (JP): May 1-7
        - Obon (JP): Aug 13-16

    training_split:
      train: First 80% of time series
      validation: Next 10%
      test: Final 10%

    backtesting:
      - Walk-forward validation
      - 30-day forecast accuracy
      - Buy/sell signal profitability
```

### M6: XGBoost/LightGBM Ensemble - Demand Forecasting

**Purpose:** Predict price movements using 55 tabular features.

**Architecture:**
```
┌─────────────────────────────────────────────────────────────────┐
│              GRADIENT BOOSTING ENSEMBLE                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│   55 Input Features                                               │
│   (Price momentum, Volume, Card attributes, Market context)      │
│          │                                                        │
│          ├────────────────┬────────────────┐                     │
│          ▼                ▼                ▼                     │
│   ┌────────────┐   ┌────────────┐   ┌────────────┐              │
│   │  XGBoost   │   │ LightGBM   │   │ CatBoost   │              │
│   │            │   │            │   │            │              │
│   │ max_depth  │   │ num_leaves │   │ depth=6    │              │
│   │ = 6        │   │ = 31       │   │            │              │
│   │            │   │            │   │ cat_feats  │              │
│   │ n_est=500  │   │ n_est=500  │   │ = auto     │              │
│   └─────┬──────┘   └─────┬──────┘   └─────┬──────┘              │
│         │                │                │                      │
│         └────────────────┼────────────────┘                      │
│                          ▼                                        │
│                ┌─────────────────┐                                │
│                │  Stacking       │                                │
│                │  Meta-Learner   │                                │
│                │  (Logistic Reg) │                                │
│                └────────┬────────┘                                │
│                         │                                         │
│                         ▼                                         │
│   ┌──────────────────────────────────────────────────────────┐   │
│   │  Outputs:                                                 │   │
│   │  • price_movement: [strong_up, up, flat, down, strong_dn]│   │
│   │  • movement_probabilities: {class: float}                │   │
│   │  • expected_return_7d: float                             │   │
│   │  • expected_return_30d: float                            │   │
│   │  • confidence_interval: [low, high]                      │   │
│   │  • feature_importance: {feature: float}                  │   │
│   └──────────────────────────────────────────────────────────┘   │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

**Training Data Requirements:**

```yaml
M6_TRAINING_DATA:
  demand_forecasting:
    training_examples: 1,000,000+  # Card-day observations
    label_horizon: [7d, 30d, 90d]  # Multiple prediction windows

    features:
      price_momentum: 15
        - price_change_7d, 30d, 90d
        - price_acceleration
        - price_vs_52w_high/low
        - rsi_14, macd, macd_signal
        - volatility_7d, 30d, ratio
        - consecutive_up/down_days

      volume_liquidity: 10
        - sales_7d, 30d
        - sales_change_7d
        - listings_count, listings_change_7d
        - days_of_supply
        - sell_through_rate
        - time_to_sale_avg
        - price_dispersion

      card_characteristics: 12
        - rarity_encoded
        - card_type (leader/character/event/stage)
        - color_encoded
        - cost, power
        - set_age_days
        - set_total_value
        - card_rank_in_set
        - is_alternate_art

      market_context: 10
        - tcg100_index_value, change_7d
        - set_index_value, change_7d
        - market_phase
        - days_to/since_set
        - tournament_legal
        - tournament_play_rate
        - meta_relevance_score

      external_signals: 8
        - social_mentions_7d
        - social_sentiment
        - youtube_mentions_7d
        - search_trend_7d
        - tournament_top_cut
        - ban_watch_score
        - reprint_probability
        - crossover_potential

    labels:
      classification:
        strong_up: price_change > 20%
        up: price_change 5-20%
        flat: price_change -5% to 5%
        down: price_change -20% to -5%
        strong_down: price_change < -20%

      regression:
        actual_change_7d: float
        actual_change_30d: float
        actual_change_90d: float

    class_balance:
      strategy: SMOTE + class_weight
      target_ratio: ~1:1:1:1:1 for classification

    validation:
      method: Time-series cross-validation
      n_splits: 5
      gap: 7 days (prevent leakage)
```

### M7: Temporal Fusion Transformer - Multi-Horizon Prediction

**Purpose:** State-of-the-art time series forecasting with attention-based architecture.

**Architecture:**
```
┌─────────────────────────────────────────────────────────────────┐
│              TEMPORAL FUSION TRANSFORMER (TFT)                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│   Inputs:                                                         │
│   ┌─────────────────────────────────────────────────────────┐    │
│   │  Static Covariates (card attributes)                     │    │
│   │  • Card ID embedding                                     │    │
│   │  • Rarity, color, type embeddings                        │    │
│   │  • Set embedding                                         │    │
│   │                                                          │    │
│   │  Time-Varying Known (future known)                       │    │
│   │  • Day of week                                           │    │
│   │  • Month                                                 │    │
│   │  • Days to set release                                   │    │
│   │  • Tournament indicator                                  │    │
│   │                                                          │    │
│   │  Time-Varying Observed (past only)                       │    │
│   │  • Historical prices                                     │    │
│   │  • Volume                                                │    │
│   │  • Social mentions                                       │    │
│   │  • Market index                                          │    │
│   └─────────────────────────────────────────────────────────┘    │
│                                                                   │
│   Architecture:                                                   │
│   ┌─────────────────────────────────────────────────────────┐    │
│   │                                                          │    │
│   │   Variable Selection Network                             │    │
│   │   (Learn feature importance per timestep)                │    │
│   │          │                                               │    │
│   │          ▼                                               │    │
│   │   LSTM Encoder (past) ──► LSTM Decoder (future)         │    │
│   │          │                      │                        │    │
│   │          ▼                      ▼                        │    │
│   │   ┌──────────────────────────────────────┐              │    │
│   │   │     Multi-Head Attention              │              │    │
│   │   │     (Interpretable self-attention)    │              │    │
│   │   └──────────────────────────────────────┘              │    │
│   │          │                                               │    │
│   │          ▼                                               │    │
│   │   Gated Residual Network                                 │    │
│   │          │                                               │    │
│   │          ▼                                               │    │
│   │   Quantile Output (10%, 50%, 90%)                       │    │
│   │                                                          │    │
│   └─────────────────────────────────────────────────────────┘    │
│                                                                   │
│   Outputs:                                                        │
│   • Multi-horizon forecasts (1, 7, 14, 30, 90 days)             │
│   • Quantile predictions (uncertainty)                          │
│   • Attention weights (interpretability)                        │
│   • Feature importance over time                                │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

**Training Data Requirements:**

```yaml
M7_TRAINING_DATA:
  temporal_fusion_transformer:
    sequence_length:
      encoder: 90 days (lookback)
      decoder: 30 days (forecast horizon)

    samples: 500,000+  # Card-date combinations

    static_features:
      - card_id_embedding (learnable)
      - rarity_embedding
      - color_embedding
      - card_type_embedding
      - set_embedding

    time_varying_known:
      - day_of_week (0-6)
      - month (1-12)
      - is_weekend
      - is_holiday
      - days_to_set_release
      - days_to_tournament
      - is_ban_list_period

    time_varying_observed:
      - price
      - price_change
      - volume
      - listings_count
      - tcg100_index
      - social_sentiment
      - search_volume

    training_config:
      batch_size: 64
      learning_rate: 0.001
      epochs: 100
      early_stopping_patience: 10
      quantiles: [0.1, 0.5, 0.9]

    hardware:
      gpu_memory: 16GB minimum
      training_time: ~24 hours
```

---

## 5. Layer 4: Anomaly & Opportunity Models

### M8: Cross-Market Arbitrage Detector

**Purpose:** Real-time detection of price discrepancies across platforms.

**Architecture:**
```
┌─────────────────────────────────────────────────────────────────┐
│            CROSS-MARKET ARBITRAGE DETECTOR                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│   Real-time Price Feeds                                           │
│   ┌─────────────────────────────────────────────────────────┐    │
│   │  TCGplayer  │  Cardmarket  │  eBay  │  Yahoo JP  │  etc │    │
│   └──────┬──────┴──────┬───────┴────┬───┴──────┬─────┴──────┘    │
│          │             │            │          │                  │
│          └─────────────┴────────────┴──────────┘                  │
│                         │                                         │
│                         ▼                                         │
│   ┌─────────────────────────────────────────────────────────┐    │
│   │              SPREAD CALCULATION ENGINE                   │    │
│   │                                                          │    │
│   │   For each card c and market pair (i, j):               │    │
│   │                                                          │    │
│   │   raw_spread[c,i,j] = (price[c,j] - price[c,i]) / price[c,i] │
│   │                                                          │    │
│   │   fx_adjusted[c,i,j] = raw_spread * (1 - fx_fee)        │    │
│   │                                                          │    │
│   │   net_spread[c,i,j] = fx_adjusted                       │    │
│   │                      - buy_fee[i]                        │    │
│   │                      - sell_fee[j]                       │    │
│   │                      - shipping[i→j]                     │    │
│   │                      - customs[i→j]                      │    │
│   │                      - vat[j]                            │    │
│   │                                                          │    │
│   └────────────────────────┬────────────────────────────────┘    │
│                            │                                      │
│                            ▼                                      │
│   ┌─────────────────────────────────────────────────────────┐    │
│   │              OPPORTUNITY FILTER                          │    │
│   │                                                          │    │
│   │   IF net_spread > MIN_MARGIN (5%)                       │    │
│   │   AND seller_risk_score < MAX_RISK (0.3)                │    │
│   │   AND listing_quality != "avoid"                        │    │
│   │   AND volume > MIN_VOLUME                               │    │
│   │   THEN → OPPORTUNITY                                    │    │
│   │                                                          │    │
│   └────────────────────────┬────────────────────────────────┘    │
│                            │                                      │
│                            ▼                                      │
│   ┌─────────────────────────────────────────────────────────┐    │
│   │              OUTPUT                                      │    │
│   │                                                          │    │
│   │   {                                                      │    │
│   │     card_id,                                             │    │
│   │     buy_market, buy_price, buy_url,                     │    │
│   │     sell_market, sell_price,                            │    │
│   │     gross_spread, net_spread,                           │    │
│   │     confidence, urgency, expiry_estimate,               │    │
│   │     cost_breakdown: {...}                               │    │
│   │   }                                                      │    │
│   │                                                          │    │
│   └─────────────────────────────────────────────────────────┘    │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

**Training Data (Rule-Based + Learned Thresholds):**

```yaml
M8_TRAINING_DATA:
  arbitrage_detection:
    historical_spreads:
      total_observations: 10,000,000+
      per_card_minimum: 1,000
      time_range: 365 days

    spread_outcomes:
      - spread_id
      - buy_market, sell_market
      - observed_spread
      - spread_duration_hours
      - was_actionable: boolean
      - actual_profit (if executed)

    cost_database:
      platform_fees:
        - tcgplayer: {seller: 10.25%, buyer: 0%, fixed: $0.30}
        - cardmarket: {seller: 5%, buyer: 0%}
        - ebay: {seller: 13.25%, buyer: 0%, fixed: $0.30}
        - yahoo_jp: {seller: 10%, buyer: 0%}

      shipping_matrix: [from_region × to_region × method]
      customs_matrix: [from_region × to_region × value_tier]
      vat_rates: {UK: 20%, US: 0%, EU: 19%, JP: 10%}
      fx_fees: {bank: 3%, wise: 0.5%, paypal: 4%}

    learning_targets:
      threshold_optimization:
        - Optimal MIN_MARGIN per route
        - Optimal urgency classification
        - Spread persistence prediction
```

### M9: Autoencoder Anomaly Detector

**Purpose:** Detect complex, non-linear price anomalies.

**Architecture:**
```
┌─────────────────────────────────────────────────────────────────┐
│              VARIATIONAL AUTOENCODER (VAE)                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│   Input: Feature vector (45 features)                            │
│          │                                                        │
│          ▼                                                        │
│   ┌──────────────┐                                                │
│   │   ENCODER    │                                                │
│   │              │                                                │
│   │ Dense(256)   │                                                │
│   │ Dense(128)   │                                                │
│   │ Dense(64)    │                                                │
│   └──────┬───────┘                                                │
│          │                                                        │
│          ├──────────────┬──────────────┐                         │
│          ▼              ▼              │                         │
│   ┌──────────┐   ┌──────────┐         │                         │
│   │    μ     │   │   σ²    │          │                         │
│   │  (mean)  │   │ (var)   │          │                         │
│   └────┬─────┘   └────┬────┘          │                         │
│        │              │               │                          │
│        └──────┬───────┘               │                          │
│               ▼                       │                          │
│   ┌──────────────────┐                │                          │
│   │  Latent Space    │  z ~ N(μ, σ²) │                          │
│   │  (16-dim)        │                │                          │
│   └────────┬─────────┘                │                          │
│            │                          │                          │
│            ▼                          │                          │
│   ┌──────────────┐                    │                          │
│   │   DECODER    │                    │                          │
│   │              │                    │                          │
│   │ Dense(64)    │                    │                          │
│   │ Dense(128)   │                    │                          │
│   │ Dense(256)   │                    │                          │
│   │ Dense(45)    │                    │                          │
│   └──────┬───────┘                    │                          │
│          │                            │                          │
│          ▼                            │                          │
│   Reconstructed Features              │                          │
│          │                            │                          │
│          └────────────────────────────┘                          │
│                            │                                      │
│                            ▼                                      │
│   ┌─────────────────────────────────────────────────────────┐    │
│   │              ANOMALY SCORE                               │    │
│   │                                                          │    │
│   │   score = reconstruction_error + KL_divergence          │    │
│   │                                                          │    │
│   │   IF score > threshold (learned from data):             │    │
│   │     → ANOMALY (investigate)                             │    │
│   │                                                          │    │
│   └─────────────────────────────────────────────────────────┘    │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

**Training Data Requirements:**

```yaml
M9_TRAINING_DATA:
  autoencoder_anomaly:
    training_examples: 1,000,000+ (normal listings only)

    input_features: 45 (same as M6 demand features)

    training_approach:
      - Train on NORMAL data only
      - Anomalies = high reconstruction error
      - Threshold = 95th percentile of training errors

    validation:
      normal_examples: 50,000
      known_anomalies: 5,000
        - Price errors (typos)
        - Arbitrage opportunities
        - Market dislocations
        - Suspicious listings

    metrics:
      - Reconstruction error distribution
      - Precision at various thresholds
      - Recall of known anomalies
      - False positive rate
```

### M10: Isolation Forest - Real-Time Anomaly Detection

**Purpose:** Fast, lightweight anomaly detection for streaming data.

**Implementation:** (Already designed in ML_ARCHITECTURE_DESIGN.md)

```yaml
M10_TRAINING_DATA:
  isolation_forest:
    training_examples: 500,000

    features:
      - price_z_score
      - price_vs_median
      - price_vs_recent_sales
      - price_percentile
      - listing_age_hours
      - seller_listings_today
      - card_listings_today
      - tcg_cm_spread
      - tcg_ebay_spread
      - cross_market_z_score
      - is_complete_data
      - condition_matches_price
      - title_matches_card

    hyperparameters:
      n_estimators: 100
      max_samples: 256
      contamination: 0.05  # 5% expected anomalies
      random_state: 42

    retraining:
      frequency: Weekly
      min_samples: 10,000 new observations
```

---

## 6. Layer 5: Execution Optimization

### M11: Position Sizing Optimizer

**Purpose:** Determine optimal capital allocation per opportunity.

**Architecture:** Kelly Criterion + Risk Constraints

```python
# Position Sizing Model (Rule-Based + Learned Adjustments)

def calculate_position_size(
    opportunity: ArbitrageOpportunity,
    portfolio_state: PortfolioState,
    risk_params: RiskParameters
) -> PositionSize:
    """
    Kelly Criterion with constraints:

    f* = (p * b - q) / b

    Where:
    - p = probability of success (from ensemble models)
    - q = 1 - p
    - b = win/loss ratio (expected_return / max_loss)

    Constraints:
    - Max single position: 10% of capital
    - Max market exposure: 25%
    - Max pending value: 50%
    - Liquidity buffer: 20%
    """

    # Get probability from ensemble
    p = opportunity.confidence
    q = 1 - p

    # Calculate win/loss ratio
    expected_return = opportunity.net_spread
    max_loss = opportunity.max_downside  # From VaR model
    b = expected_return / max_loss if max_loss > 0 else 0

    # Kelly fraction
    kelly = (p * b - q) / b if b > 0 else 0

    # Half-Kelly for safety
    position_fraction = max(0, kelly * 0.5)

    # Apply constraints
    position_fraction = min(
        position_fraction,
        risk_params.max_single_position,
        (risk_params.max_market_exposure - portfolio_state.current_exposure) /
            portfolio_state.market_count,
        (risk_params.max_pending - portfolio_state.pending_value) /
            portfolio_state.available_capital
    )

    return PositionSize(
        fraction=position_fraction,
        amount=position_fraction * portfolio_state.available_capital,
        reasoning=generate_reasoning(...)
    )
```

**Training Data:**

```yaml
M11_TRAINING_DATA:
  position_sizing:
    historical_trades: 10,000+

    per_trade:
      - entry_price, exit_price
      - position_size_used
      - capital_at_time
      - actual_return
      - holding_period
      - model_confidence_at_entry

    optimization_target:
      - Maximize Sharpe ratio
      - Minimize max drawdown
      - Optimize Kelly fraction multiplier
```

### M12: Order Book Simulator

**Purpose:** Model market impact and optimal execution timing.

**Architecture:** Monte Carlo Simulation + Historical Patterns

```yaml
M12_MARKET_IMPACT:
  simulation_model:
    type: Monte Carlo
    iterations: 10,000 per scenario

    inputs:
      - order_size (cards)
      - current_listings (supply curve)
      - recent_sales (demand estimate)
      - time_horizon (hours/days)

    outputs:
      - expected_fill_time
      - expected_fill_price
      - price_impact_estimate
      - slippage_distribution

  training_data:
    historical_orders: 100,000+

    per_order:
      - order_type (buy/sell)
      - size
      - limit_price
      - fill_time
      - fill_price
      - market_conditions_at_order
      - supply_curve_snapshot
```

### M13: Reinforcement Learning Agent (Future)

**Purpose:** Learn optimal execution strategies through experience.

**Architecture:**
```
┌─────────────────────────────────────────────────────────────────┐
│              DEEP Q-NETWORK (DQN) EXECUTION AGENT                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│   State Space:                                                    │
│   ┌─────────────────────────────────────────────────────────┐    │
│   │  • Current position (inventory)                          │    │
│   │  • Market state (prices, spreads, volume)               │    │
│   │  • Time remaining in opportunity window                 │    │
│   │  • Portfolio state (capital, exposure)                  │    │
│   │  • Recent actions and outcomes                          │    │
│   └─────────────────────────────────────────────────────────┘    │
│                                                                   │
│   Action Space:                                                   │
│   ┌─────────────────────────────────────────────────────────┐    │
│   │  • BUY(quantity, limit_price)                           │    │
│   │  • SELL(quantity, limit_price)                          │    │
│   │  • HOLD                                                  │    │
│   │  • CANCEL(order_id)                                     │    │
│   │  • MODIFY(order_id, new_price)                          │    │
│   └─────────────────────────────────────────────────────────┘    │
│                                                                   │
│   Reward Function:                                                │
│   ┌─────────────────────────────────────────────────────────┐    │
│   │  R = realized_profit                                     │    │
│   │      - transaction_costs                                 │    │
│   │      - inventory_risk_penalty                            │    │
│   │      - time_decay_penalty                               │    │
│   │      + opportunity_capture_bonus                         │    │
│   └─────────────────────────────────────────────────────────┘    │
│                                                                   │
│   Training:                                                       │
│   • Experience replay (1M transitions)                           │
│   • Double DQN for stability                                     │
│   • Prioritized replay for rare events                          │
│   • Offline training on historical data first                   │
│   • Online fine-tuning with paper trading                       │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

**Training Data (Future):**

```yaml
M13_TRAINING_DATA:
  reinforcement_learning:
    historical_episodes: 100,000+

    per_episode:
      - opportunity_id
      - market_state_sequence
      - action_sequence
      - reward_sequence
      - final_outcome

    simulation_environment:
      - Historical replay with action injection
      - Synthetic market conditions
      - Adversarial scenarios

    training_phases:
      1. Offline: Train on historical data
      2. Simulation: Test in simulated market
      3. Paper trading: Real market, no real money
      4. Live (small): Limited capital deployment
      5. Live (full): Full strategy execution
```

---

## 7. Layer 6: Meta-Learning & Ensemble

### M14: Online Learning Adapter

**Purpose:** Continuously update models with new data without full retraining.

**Architecture:** Incremental Learning with Drift Detection

```yaml
M14_ONLINE_LEARNING:
  components:
    drift_detector:
      method: ADWIN (Adaptive Windowing)
      sensitivity: 0.01
      triggers:
        - Feature distribution shift
        - Prediction accuracy drop
        - Market regime change

    incremental_updater:
      models_supported:
        - XGBoost (incremental_train)
        - LightGBM (refit)
        - Isolation Forest (partial_fit not native, use windowing)
        - Neural networks (online SGD)

      update_frequency:
        - Real-time: Anomaly detection
        - Hourly: Demand features
        - Daily: Price predictions
        - Weekly: Full model update

    warm_start:
      - Use previous model as initialization
      - Exponential decay on old data weight
      - Preserve learned patterns while adapting
```

### M15: Stacking Meta-Learner

**Purpose:** Combine all models for final decision making.

**Architecture:**
```
┌─────────────────────────────────────────────────────────────────┐
│              STACKING ENSEMBLE META-LEARNER                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│   Base Model Predictions (Level 0):                              │
│   ┌─────────────────────────────────────────────────────────┐    │
│   │                                                          │    │
│   │  M6 (XGBoost)     → demand_prediction                   │    │
│   │  M7 (TFT)         → price_forecast                      │    │
│   │  M5 (Prophet)     → timing_signal                       │    │
│   │  M10 (IForest)    → anomaly_score                       │    │
│   │  M3 (Quality)     → quality_score                       │    │
│   │  M8 (Arbitrage)   → spread_info                         │    │
│   │                                                          │    │
│   └────────────────────────┬────────────────────────────────┘    │
│                            │                                      │
│                            ▼                                      │
│   Meta Features:                                                  │
│   ┌─────────────────────────────────────────────────────────┐    │
│   │                                                          │    │
│   │  • Base model predictions (6)                           │    │
│   │  • Base model confidences (6)                           │    │
│   │  • Model agreement score                                │    │
│   │  • Historical accuracy per model                        │    │
│   │  • Current market regime                                │    │
│   │  • Card characteristics                                 │    │
│   │                                                          │    │
│   └────────────────────────┬────────────────────────────────┘    │
│                            │                                      │
│                            ▼                                      │
│   Meta-Learner (Level 1):                                        │
│   ┌─────────────────────────────────────────────────────────┐    │
│   │                                                          │    │
│   │  Gradient Boosting (XGBoost or LightGBM)                │    │
│   │                                                          │    │
│   │  Learns:                                                 │    │
│   │  • When each base model is most reliable               │    │
│   │  • How to weight disagreements                         │    │
│   │  • Market regime-specific combinations                 │    │
│   │                                                          │    │
│   └────────────────────────┬────────────────────────────────┘    │
│                            │                                      │
│                            ▼                                      │
│   Final Outputs:                                                  │
│   ┌─────────────────────────────────────────────────────────┐    │
│   │                                                          │    │
│   │  • action: [buy, sell, hold, avoid, monitor]           │    │
│   │  • confidence: 0.0 - 1.0                               │    │
│   │  • expected_return: float                              │    │
│   │  • risk_level: [low, medium, high]                     │    │
│   │  • reasoning: list[str]                                │    │
│   │  • component_weights: {model: weight}                  │    │
│   │                                                          │    │
│   └─────────────────────────────────────────────────────────┘    │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

**Training Data:**

```yaml
M15_TRAINING_DATA:
  meta_learner:
    training_examples: 100,000+

    per_example:
      - All base model outputs (predictions + confidences)
      - Actual outcome (return after 7/30 days)
      - Market conditions at prediction time
      - Card characteristics

    validation:
      - Out-of-time validation (last 90 days)
      - Cross-validation on historical periods

    retraining:
      frequency: Monthly
      requires: Updated base model predictions
```

---

## 8. Training Data Requirements Matrix

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                         TRAINING DATA REQUIREMENTS SUMMARY                            │
├──────────┬─────────────────────┬────────────────┬─────────────────┬─────────────────┤
│ Model    │ Data Type           │ Volume         │ Source          │ Update Freq     │
├──────────┼─────────────────────┼────────────────┼─────────────────┼─────────────────┤
│ M1a ViT  │ Card images         │ 500K images    │ Listings, DB    │ Monthly add     │
│ M1b CNN  │ Condition photos    │ 100K images    │ Graded, verified│ Quarterly       │
│ M1c Siam │ Image pairs         │ 1M pairs       │ Generated       │ Monthly         │
├──────────┼─────────────────────┼────────────────┼─────────────────┼─────────────────┤
│ M2 Seller│ Seller profiles     │ 50K sellers    │ Platform APIs   │ Weekly          │
│ M3 Qual  │ Listing features    │ 150K listings  │ Labeled disputes│ Bi-weekly       │
├──────────┼─────────────────────┼────────────────┼─────────────────┼─────────────────┤
│ M4 GNN   │ Graph structure     │ 10K nodes      │ DB + tournament │ Weekly          │
│ M5 Time  │ Price history       │ 365d × 10K     │ Price feeds     │ Daily           │
│ M6 XGB   │ Tabular features    │ 1M examples    │ Computed        │ Daily           │
│ M7 TFT   │ Sequences           │ 500K sequences │ Price history   │ Daily           │
├──────────┼─────────────────────┼────────────────┼─────────────────┼─────────────────┤
│ M8 Arb   │ Spread data         │ 10M spreads    │ Multi-platform  │ Real-time       │
│ M9 VAE   │ Feature vectors     │ 1M normal      │ Computed        │ Weekly          │
│ M10 IF   │ Feature vectors     │ 500K examples  │ Computed        │ Weekly          │
├──────────┼─────────────────────┼────────────────┼─────────────────┼─────────────────┤
│ M11 Size │ Trade outcomes      │ 10K trades     │ Execution logs  │ Continuous      │
│ M12 Book │ Order data          │ 100K orders    │ Market data     │ Weekly          │
│ M13 RL   │ Episodes            │ 100K episodes  │ Simulation      │ Continuous      │
├──────────┼─────────────────────┼────────────────┼─────────────────┼─────────────────┤
│ M14 OL   │ Streaming data      │ Continuous     │ All sources     │ Real-time       │
│ M15 Meta │ Ensemble outputs    │ 100K decisions │ Model outputs   │ Monthly         │
└──────────┴─────────────────────┴────────────────┴─────────────────┴─────────────────┘
```

### Data Quality Requirements

```yaml
DATA_QUALITY_STANDARDS:
  images:
    minimum_resolution: 224×224
    preferred_resolution: 448×448
    format: JPEG, PNG, WebP
    quality_score: > 0.6 (assessed by quality model)
    labeling_accuracy: > 95% verified

  price_data:
    completeness: > 99% (no missing days)
    accuracy: Cross-validated across sources
    freshness: < 4 hours for arbitrage
    currency_normalization: Consistent GBP base

  text_data:
    language: Detected and normalized
    encoding: UTF-8
    cleaning: HTML stripped, normalized whitespace

  labels:
    source_verification: Multi-annotator agreement
    confidence_threshold: > 0.8 for training
    disputed_labels: Flagged for review

  validation:
    train_test_leakage: Prevented (time-based split)
    class_balance: Addressed (SMOTE/weighting)
    outlier_handling: Documented thresholds
```

---

## 9. Pipeline Integration Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                         INTEGRATED ML PIPELINE                                        │
└─────────────────────────────────────────────────────────────────────────────────────┘

                              ┌─────────────────────┐
                              │   DATA INGESTION    │
                              │                     │
                              │  • Price feeds      │
                              │  • Listing scrapes  │
                              │  • Image downloads  │
                              │  • Tournament data  │
                              └──────────┬──────────┘
                                         │
                                         ▼
┌────────────────────────────────────────────────────────────────────────────────────┐
│                              FEATURE STORE (Redis + S3)                             │
│                                                                                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐            │
│  │ Price Cache  │  │ Image Cache  │  │ Feature Vec  │  │ Predictions  │            │
│  │ (Redis)      │  │ (S3+CDN)     │  │ (Redis)      │  │ (Redis)      │            │
│  │ TTL: 5min    │  │ TTL: 24h     │  │ TTL: 1h      │  │ TTL: 15min   │            │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘            │
│                                                                                      │
└────────────────────────────────────────────────────────────────────────────────────┘
                                         │
                     ┌───────────────────┼───────────────────┐
                     │                   │                   │
                     ▼                   ▼                   ▼
          ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
          │  BATCH PIPELINE │  │ STREAMING PIPE  │  │  API REQUESTS   │
          │                 │  │                 │  │                 │
          │ • Daily retrain │  │ • Real-time     │  │ • On-demand     │
          │ • Backfill      │  │   anomaly det.  │  │   predictions   │
          │ • Evaluation    │  │ • Spread calc   │  │ • Single card   │
          │                 │  │ • Alert gen     │  │   analysis      │
          └────────┬────────┘  └────────┬────────┘  └────────┬────────┘
                   │                    │                    │
                   └────────────────────┼────────────────────┘
                                        │
                                        ▼
┌────────────────────────────────────────────────────────────────────────────────────┐
│                              MODEL SERVING LAYER                                     │
│                                                                                      │
│  ┌──────────────────────────────────────────────────────────────────────────────┐  │
│  │                        MODEL REGISTRY (S3 + DynamoDB)                         │  │
│  │                                                                               │  │
│  │  • Version control for all models                                            │  │
│  │  • A/B test configurations                                                   │  │
│  │  • Rollback capabilities                                                     │  │
│  │  • Performance metrics tracking                                              │  │
│  └──────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                      │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────┐   │
│  │  Vision    │  │  Demand    │  │  Anomaly   │  │  Timing    │  │  Ensemble  │   │
│  │  Endpoint  │  │  Endpoint  │  │  Endpoint  │  │  Endpoint  │  │  Endpoint  │   │
│  │            │  │            │  │            │  │            │  │            │   │
│  │  GPU       │  │  CPU       │  │  CPU       │  │  CPU       │  │  CPU       │   │
│  │  p=100ms   │  │  p=10ms    │  │  p=5ms     │  │  p=50ms    │  │  p=150ms   │   │
│  └────────────┘  └────────────┘  └────────────┘  └────────────┘  └────────────┘   │
│                                                                                      │
└────────────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌────────────────────────────────────────────────────────────────────────────────────┐
│                              ORCHESTRATOR                                            │
│                                                                                      │
│  ┌──────────────────────────────────────────────────────────────────────────────┐  │
│  │  Combines all model outputs into final recommendations                        │  │
│  │                                                                               │  │
│  │  Input: Card/Listing → All Models → Meta-Learner → Final Decision            │  │
│  │                                                                               │  │
│  │  Output:                                                                      │  │
│  │  {                                                                            │  │
│  │    action: "buy",                                                            │  │
│  │    confidence: 0.87,                                                         │  │
│  │    expected_return: 0.15,                                                    │  │
│  │    risk_level: "medium",                                                     │  │
│  │    deal_type: "arbitrage",                                                   │  │
│  │    urgency: "high",                                                          │  │
│  │    cost_analysis: {...},                                                     │  │
│  │    reasoning: [...]                                                          │  │
│  │  }                                                                            │  │
│  └──────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                      │
└────────────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
                              ┌─────────────────────┐
                              │   OUTPUT LAYER      │
                              │                     │
                              │  • API responses    │
                              │  • Alert webhooks   │
                              │  • Deal database    │
                              │  • Analytics        │
                              └─────────────────────┘
```

### File Structure Integration

```
app/lib/ml/
├── index.ts                    # Module exports
├── types.ts                    # ✅ Exists - Core type definitions
├── config.ts                   # ✅ Exists - Configuration
├── base.server.ts              # ✅ Exists - Base classes
│
├── vision/                     # Layer 1
│   ├── index.ts                # ✅ Exists
│   ├── types.ts                # ✅ Exists
│   ├── model.server.ts         # ✅ Exists - CNN implementation
│   ├── preprocessor.server.ts  # ✅ Exists
│   ├── vit.server.ts           # 🆕 NEW - Vision Transformer
│   └── siamese.server.ts       # 🆕 NEW - Card matching
│
├── demand/                     # Layer 3
│   ├── index.ts                # ✅ Exists
│   ├── model.server.ts         # ✅ Exists - XGBoost
│   ├── features.server.ts      # ✅ Exists
│   └── tft.server.ts           # 🆕 NEW - Temporal Fusion Transformer
│
├── quality/                    # Layer 2
│   ├── index.ts                # ✅ Exists
│   ├── model.server.ts         # ✅ Exists
│   └── seller.server.ts        # 🆕 NEW - Seller risk scorer
│
├── timing/                     # Layer 3
│   ├── index.ts                # ✅ Exists
│   ├── model.server.ts         # ✅ Exists - Prophet/ARIMA
│   └── prophet.server.ts       # 🆕 NEW - Enhanced Prophet
│
├── anomaly/                    # Layer 4
│   ├── index.ts                # ✅ Exists
│   ├── model.server.ts         # ✅ Exists - Isolation Forest
│   ├── autoencoder.server.ts   # 🆕 NEW - VAE anomaly
│   └── arbitrage.server.ts     # 🆕 NEW - Cross-market spreads
│
├── graph/                      # Layer 3 - NEW
│   ├── index.ts                # 🆕 NEW
│   └── gnn.server.ts           # 🆕 NEW - Graph Neural Network
│
├── execution/                  # Layer 5 - NEW
│   ├── index.ts                # 🆕 NEW
│   ├── sizing.server.ts        # 🆕 NEW - Position sizing
│   └── simulator.server.ts     # 🆕 NEW - Market simulator
│
├── meta/                       # Layer 6 - NEW
│   ├── index.ts                # 🆕 NEW
│   ├── online.server.ts        # 🆕 NEW - Online learning
│   └── stacking.server.ts      # 🆕 NEW - Meta-learner
│
└── orchestrator/
    ├── index.ts                # ✅ Exists
    └── orchestrator.server.ts  # ✅ Exists - Update for new models
```

---

## 10. Implementation Priority Roadmap

### Phase 1: Foundation Enhancement (Current → +2 weeks)

| Priority | Model | Status | Effort | Value |
|----------|-------|--------|--------|-------|
| P0 | M6 XGBoost Ensemble | ✅ 80% done | Low | High |
| P0 | M10 Isolation Forest | ✅ 80% done | Low | High |
| P0 | M5 Prophet/ARIMA | ✅ 70% done | Medium | High |
| P1 | M3 Quality Ensemble | ✅ 70% done | Low | Medium |
| P1 | M8 Arbitrage Detector | 🆕 Design only | Medium | **Critical** |

**Deliverables:**
- Complete XGBoost training pipeline
- Deploy Isolation Forest to production
- Implement cross-market spread calculator
- Enhance Prophet with TCG-specific holidays

### Phase 2: Vision & Perception (+2 → +6 weeks)

| Priority | Model | Status | Effort | Value |
|----------|-------|--------|--------|-------|
| P0 | M1a Vision Transformer | 🆕 Architecture defined | High | **Critical** |
| P1 | M1b Condition Grading | 🆕 Architecture defined | High | High |
| P2 | M1c Siamese Matching | 🆕 Architecture defined | Medium | Medium |

**Deliverables:**
- ViT model fine-tuned on card images
- Condition grading with sub-grade detail
- Card matching for deduplication

### Phase 3: Advanced Prediction (+6 → +10 weeks)

| Priority | Model | Status | Effort | Value |
|----------|-------|--------|--------|-------|
| P0 | M7 Temporal Fusion Transformer | 🆕 Architecture defined | High | High |
| P1 | M4 Graph Neural Network | 🆕 Architecture defined | High | Medium |
| P2 | M9 VAE Anomaly | 🆕 Architecture defined | Medium | Medium |

**Deliverables:**
- TFT for multi-horizon forecasting
- GNN for market topology modeling
- VAE for complex anomaly patterns

### Phase 4: Execution & Meta (+10 → +14 weeks)

| Priority | Model | Status | Effort | Value |
|----------|-------|--------|--------|-------|
| P1 | M11 Position Sizing | 🆕 Architecture defined | Low | Medium |
| P1 | M15 Stacking Meta-Learner | 🆕 Architecture defined | Medium | High |
| P2 | M14 Online Learning | 🆕 Architecture defined | Medium | Medium |
| P3 | M12 Order Book Simulator | 🆕 Architecture defined | High | Low |
| P3 | M13 RL Agent | 🆕 Architecture defined | Very High | Future |

**Deliverables:**
- Kelly criterion position sizing
- Stacking ensemble for final decisions
- Online model updating capability

---

## Summary

This document defines **15 AI models** across **6 functional layers** for comprehensive TCG market arbitrage value capture:

1. **Perception (3 models):** Card identification, condition grading, matching
2. **Evaluation (2 models):** Listing quality, seller risk
3. **Prediction (4 models):** Demand, timing, graph correlations, multi-horizon
4. **Anomaly (3 models):** Isolation forest, autoencoder, arbitrage detection
5. **Execution (3 models):** Position sizing, market simulation, RL agent
6. **Meta (2 models):** Online learning, stacking ensemble

**Total Training Data Required:**
- ~500K labeled card images
- ~100K condition-graded images
- ~1M price-day observations
- ~150K labeled listings
- ~10M cross-market spread observations

**Expected Value Capture:**
- Arbitrage opportunities: 5-20% margins
- Demand prediction: 70%+ directional accuracy
- Quality filtering: 95%+ scam prevention
- Timing optimization: 5-10% seasonal advantage
- Combined ensemble: 15-25% risk-adjusted returns

---

*Document Version: 1.0.0*
*Created: 2026-01-09*
*Classification: Technical Blueprint*
*Status: Ready for Implementation*
