# TCG Data Quality Assessment & Training Data Pipeline

> Implementation Plan & Research Insights
> Created: January 2025
> Last Updated: January 2025

---

## Implementation Status

| Component | Status | Location |
|-----------|--------|----------|
| OPTCG API Collector | ✅ Complete | `lambda/collectors/optcg/optcg.ts` |
| JustTCG API Collector | ✅ Complete | `lambda/collectors/justtcg/justtcg.ts` |
| Cardmarket Scraper | ✅ Complete | `lambda/collectors/cardmarket/cardmarket-scraper.ts` |
| Data Quality Validator | ✅ Complete | `lambda/processors/quality-validator/quality-validator.ts` |
| Feature Engineering | ✅ Complete | `lambda/processors/feature-engineer/feature-engineer.ts` |
| Shared Utilities | ✅ Complete | `lambda/layers/shared/nodejs/utils.ts` |
| Infrastructure (CDK) | ✅ Complete | `infrastructure/lib/data-pipeline-stack.ts` |

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Research: Existing Data Aggregators](#research-existing-data-aggregators)
3. [Data Source Quality Analysis](#data-source-quality-analysis)
4. [Data Quality Assessment Pipeline](#data-quality-assessment-pipeline)
5. [Training Data Production Pipeline](#training-data-production-pipeline)
6. [Implementation Roadmap](#implementation-roadmap)
7. [Technical Architecture](#technical-architecture)

---

## Executive Summary

This document outlines the research findings on trading card game data aggregators and presents a comprehensive plan for:

1. **Data Quality Assessment Pipeline** - Real-time validation, anomaly detection, and quality scoring for incoming price data feeds
2. **Training Data Production Pipeline** - Automated generation of high-quality, labeled datasets for ML model training

### Key Insights

- **TCGplayer is the ultimate source** - Nearly all aggregators derive pricing from TCGplayer's marketplace
- **Update frequency varies significantly** - From real-time to daily updates across sources
- **Data quality requires multi-layer validation** - Statistical, semantic, and temporal checks
- **Training data needs careful curation** - Outliers, missing data, and distribution shifts can severely impact model performance

---

## Research: Existing Data Aggregators

### Tier 1: Official/Primary Sources

| Source | Coverage | Update Frequency | Access | Quality |
|--------|----------|------------------|--------|---------|
| [TCGplayer API](https://help.tcgplayer.com/hc/en-us/articles/201577976) | All major TCGs | Real-time | Partner API | Gold standard |
| Cardmarket | EU markets | Real-time | ⚠️ No Public API | High (EU focus) |

**TCGplayer** processes millions of transactions annually and is the source-of-truth for US/global TCG pricing. Their API provides:
- Market price (median of recent sales)
- Low/Mid/High price points
- Buylist prices
- Direct market data (actual transaction prices)

### Cardmarket API Status & Alternatives

> ⚠️ **Important Finding (January 2025):** Cardmarket no longer offers a publicly accessible API. The partner API requires direct business relationship approval.

**Alternative Solutions for EU Market Data:**

| Solution | Type | Cost | Supports OPTCG |
|----------|------|------|----------------|
| [Apify Cardmarket Trend Scraper](https://apify.com/drobnikj/cardmarket-trend-scraper) | Hosted Scraper | ~$10/mo | ✅ Yes |
| [RapidAPI Cardmarket](https://rapidapi.com/kalilatech-kalilatech/api/cardmarket12) | API Wrapper | Freemium | ❌ No (MTG only) |
| Custom Scraper | Self-hosted | Free + Proxy costs | ✅ Yes |

**Implemented Solution:** Web scraper at `lambda/collectors/cardmarket/cardmarket-scraper.ts`
- Multi-strategy HTML parsing (Primary selectors → Fallback selectors → Regex)
- Proxy rotation support for reliability
- Rate limiting to avoid blocks
- Handles One Piece TCG expansions (OP01-OP11, EB01-EB02, ST01-ST20)

### Tier 2: Aggregator APIs

| Source | Games | Update Freq | Free Tier | Pricing |
|--------|-------|-------------|-----------|---------|
| [JustTCG](https://justtcg.com/docs) | MTG, Pokemon, Yu-Gi-Oh, Lorcana, **One Piece**, Digimon | 6 hours | 1,000 req/mo | $9-99/mo |
| [OPTCG API](https://optcgapi.com/) | One Piece TCG only | Daily | Unlimited | Free |
| [TCGCSV](https://tcgcsv.com/) | All TCGplayer games | Daily (20:00 UTC) | Unlimited | Free |
| [Scryfall](https://scryfall.com/docs/api) | MTG only | Daily | Unlimited | Free |

**Recommended for One Piece TCG:**
1. **OPTCG API** - Free, comprehensive, daily updates, includes JP data
2. **JustTCG** - Paid but 6-hour updates, multi-game support
3. **TCGCSV** - Free bulk downloads, all TCGplayer data

### Tier 3: Tracking/Analytics Platforms

| Source | Focus | Update Freq | Unique Value |
|--------|-------|-------------|--------------|
| [Magical Meta](https://magicalmeta.ink/onepiece) | One Piece TCG | Hourly | Price momentum, meta analysis |
| [Limitless TCG](https://onepiece.limitlesstcg.com/cards) | One Piece TCG | Variable | Tournament data, deck meta |

**Magical Meta** is particularly valuable because they:
- Update hourly via TCGplayer API
- Track 5,000+ cards across 63 sets
- Implement outlier detection
- Provide price history up to 1 year
- Calculate market momentum indicators

### Tier 4: Japan-Specific Sources

| Source | Access | Quality | Notes |
|--------|--------|---------|-------|
| Yahoo Auctions Japan | Scraping | Medium | Auction prices, not BIN |
| Mercari Japan | Scraping | Medium | Fixed price, condition varies |
| Yuyu-tei | Scraping | High | Professional pricing |
| Bigweb | Scraping | High | Professional pricing |

**Note:** Japanese sources require proxy rotation and are prone to breaking due to HTML changes.

---

## Data Source Quality Analysis

### Quality Dimensions

Each data source is evaluated across 6 dimensions:

```
┌─────────────────────────────────────────────────────────────────┐
│                    DATA QUALITY DIMENSIONS                       │
├─────────────┬──────────────────────────────────────────────────┤
│ Dimension   │ Description                                       │
├─────────────┼──────────────────────────────────────────────────┤
│ Accuracy    │ How close prices are to actual market values      │
│ Completeness│ Coverage of cards, sets, variants, conditions     │
│ Timeliness  │ How fresh the data is (update frequency)          │
│ Consistency │ Same card = same ID across time and sources       │
│ Validity    │ Data conforms to expected formats/ranges          │
│ Uniqueness  │ No duplicate records for same card+condition      │
└─────────────┴──────────────────────────────────────────────────┘
```

### Source Quality Matrix

| Source | Accuracy | Completeness | Timeliness | Consistency | Validity | Overall |
|--------|----------|--------------|------------|-------------|----------|---------|
| TCGplayer Direct | 10/10 | 10/10 | 10/10 | 10/10 | 10/10 | **A+** |
| JustTCG | 9/10 | 9/10 | 8/10 | 9/10 | 9/10 | **A** |
| OPTCG API | 8/10 | 9/10 | 6/10 | 8/10 | 8/10 | **B+** |
| TCGCSV | 9/10 | 9/10 | 5/10 | 9/10 | 9/10 | **B+** |
| Cardmarket | 9/10 | 8/10 | 9/10 | 8/10 | 9/10 | **B+** |
| eBay Scraping | 6/10 | 5/10 | 7/10 | 5/10 | 6/10 | **C** |
| Yahoo JP | 5/10 | 6/10 | 7/10 | 4/10 | 5/10 | **C-** |
| Mercari JP | 5/10 | 6/10 | 7/10 | 4/10 | 5/10 | **C-** |

### Known Data Quality Issues by Source

#### TCGplayer-derived (JustTCG, TCGCSV, OPTCG API)
- **Strength:** Accurate market prices from real transactions
- **Weakness:** Can lag on newly released sets, some variants missing

#### eBay
- **Card ID extraction:** ~30% of listings lack standard card numbers
- **Condition unreliability:** Seller descriptions inconsistent
- **Price variance:** Mix of BIN, auction, best offer prices

#### Japan Markets
- **Language barrier:** Japanese text requires translation
- **Condition mapping:** Japanese condition terms differ from US/EU
- **Currency volatility:** JPY/USD rate fluctuations impact comparisons
- **Scraping fragility:** HTML structure changes frequently

---

## Data Quality Assessment Pipeline

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    DATA QUALITY ASSESSMENT PIPELINE                      │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌──────────┐    ┌──────────────┐    ┌──────────────┐    ┌───────────┐ │
│  │ Raw Data │───▶│ Schema       │───▶│ Statistical  │───▶│ Semantic  │ │
│  │ Ingestion│    │ Validation   │    │ Validation   │    │ Validation│ │
│  └──────────┘    └──────────────┘    └──────────────┘    └───────────┘ │
│                         │                   │                   │       │
│                         ▼                   ▼                   ▼       │
│                  ┌─────────────────────────────────────────────────┐   │
│                  │            QUALITY SCORE AGGREGATOR              │   │
│                  └─────────────────────────────────────────────────┘   │
│                         │                   │                   │       │
│            ┌────────────┼───────────────────┼───────────────────┤       │
│            ▼            ▼                   ▼                   ▼       │
│     ┌──────────┐  ┌──────────┐       ┌──────────┐       ┌──────────┐  │
│     │ Pass     │  │ Warn     │       │ Quarantine│      │ Reject   │  │
│     │ (Score   │  │ (Score   │       │ (Score    │      │ (Score   │  │
│     │  > 0.9)  │  │ 0.7-0.9) │       │ 0.5-0.7)  │      │ < 0.5)   │  │
│     └──────────┘  └──────────┘       └──────────┘       └──────────┘  │
│          │             │                   │                   │       │
│          ▼             ▼                   ▼                   ▼       │
│     ┌──────────┐  ┌──────────┐       ┌──────────┐       ┌──────────┐  │
│     │ Training │  │ Training │       │ Manual    │      │ Dropped  │  │
│     │ Data     │  │ Data +   │       │ Review    │      │ (Logged) │  │
│     │          │  │ Metadata │       │ Queue     │      │          │  │
│     └──────────┘  └──────────┘       └──────────┘       └──────────┘  │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Layer 1: Schema Validation

Using [Great Expectations](https://greatexpectations.io/) framework for declarative data validation:

```python
# Great Expectations Suite for Price Events
expectations = {
    "card_id": {
        "expect_column_to_exist": True,
        "expect_column_values_to_match_regex": r"^[A-Z]{2,3}\d{2}-\d{3}(-[a-z]+)?$",
        "expect_column_values_to_not_be_null": True,
    },
    "price": {
        "expect_column_to_exist": True,
        "expect_column_values_to_be_between": {"min_value": 0.01, "max_value": 100000},
        "expect_column_values_to_not_be_null": True,
    },
    "price_usd": {
        "expect_column_values_to_be_between": {"min_value": 0.01, "max_value": 100000},
    },
    "condition": {
        "expect_column_values_to_be_in_set": ["NM", "LP", "MP", "HP", "DMG", "UNKNOWN"],
    },
    "source": {
        "expect_column_values_to_be_in_set": [
            "tcgplayer", "cardmarket", "ebay_us", "ebay_gb",
            "yahoo_jp", "mercari_jp"
        ],
    },
    "timestamp": {
        "expect_column_values_to_be_dateutil_parseable": True,
        "expect_column_max_to_be_between": {
            "max_value": "now + 1 day",  # Not future dated
        },
    },
}
```

### Layer 2: Statistical Validation

```python
class StatisticalValidator:
    """
    Detects statistical anomalies in price data
    """

    def __init__(self, lookback_days: int = 30):
        self.lookback_days = lookback_days

    def validate_price(self, card_id: str, price: float, source: str) -> ValidationResult:
        # Get historical prices for this card
        history = self.get_price_history(card_id, self.lookback_days)

        if len(history) < 5:
            return ValidationResult(score=0.7, reason="insufficient_history")

        # Calculate statistics
        mean = np.mean(history)
        std = np.std(history)
        median = np.median(history)

        # Z-score check
        z_score = (price - mean) / std if std > 0 else 0

        # IQR-based outlier detection
        q1, q3 = np.percentile(history, [25, 75])
        iqr = q3 - q1
        lower_bound = q1 - 3 * iqr
        upper_bound = q3 + 3 * iqr

        checks = {
            "z_score_normal": abs(z_score) < 3,
            "within_iqr_bounds": lower_bound <= price <= upper_bound,
            "not_too_far_from_median": 0.1 * median <= price <= 10 * median,
            "positive_price": price > 0,
        }

        score = sum(checks.values()) / len(checks)

        return ValidationResult(
            score=score,
            z_score=z_score,
            checks=checks,
            historical_mean=mean,
            historical_median=median,
        )
```

### Layer 3: Semantic Validation

```python
class SemanticValidator:
    """
    Validates data makes sense in context
    """

    def validate_card_context(self, event: PriceEvent) -> ValidationResult:
        checks = {}

        # 1. Card exists in catalog
        card = self.catalog.get(event.card_id)
        checks["card_exists"] = card is not None

        if card:
            # 2. Set code matches expected pattern for card
            checks["set_code_valid"] = event.set_code == card.set_code

            # 3. Price reasonable for rarity
            rarity_ranges = {
                "C": (0.01, 50),      # Common
                "UC": (0.01, 100),    # Uncommon
                "R": (0.10, 500),     # Rare
                "SR": (1.00, 2000),   # Super Rare
                "SEC": (5.00, 5000),  # Secret Rare
                "L": (10.00, 10000),  # Leader
            }
            if card.rarity in rarity_ranges:
                min_p, max_p = rarity_ranges[card.rarity]
                checks["price_reasonable_for_rarity"] = min_p <= event.price_usd <= max_p

            # 4. Variant type matches known variants for this card
            known_variants = self.get_known_variants(event.card_id)
            checks["variant_known"] = event.variant_type in known_variants

        # 5. Currency conversion sanity check
        if event.currency == "JPY":
            expected_usd = event.price * 0.0067  # Approximate
            checks["fx_reasonable"] = 0.5 <= event.price_usd / expected_usd <= 2.0

        # 6. Seller reputation (if available)
        if hasattr(event, 'seller_reputation_tier'):
            checks["seller_trusted"] = event.seller_reputation_tier in ["trusted", "standard"]

        score = sum(checks.values()) / len(checks) if checks else 0.5

        return ValidationResult(score=score, checks=checks)
```

### Layer 4: Temporal Validation

```python
class TemporalValidator:
    """
    Detects time-based anomalies and data drift
    """

    def validate_temporal(self, event: PriceEvent) -> ValidationResult:
        checks = {}

        # 1. Not stale data
        event_age = (datetime.now() - event.timestamp).total_seconds()
        checks["data_fresh"] = event_age < 86400  # Less than 24 hours old

        # 2. No sudden market-wide shifts (unless expected)
        market_avg = self.get_market_average(event.source)
        source_avg = self.get_source_average_for_card(event.card_id, event.source)
        if source_avg:
            pct_change = abs(event.price_usd - source_avg) / source_avg
            checks["no_sudden_shift"] = pct_change < 0.5  # Less than 50% change

        # 3. Check for time series continuity
        last_price = self.get_last_price(event.card_id, event.source)
        if last_price:
            time_gap = (event.timestamp - last_price.timestamp).total_seconds()
            checks["continuous_data"] = time_gap < 172800  # Less than 48 hours gap

        # 4. Detect concept drift
        drift_score = self.calculate_drift_score(event.card_id, event.source)
        checks["no_drift"] = drift_score < 0.3

        score = sum(checks.values()) / len(checks) if checks else 0.5

        return ValidationResult(score=score, checks=checks)
```

### Quality Score Aggregation

```python
class QualityScoreAggregator:
    """
    Combines all validation layers into final quality score
    """

    # Weights for each validation layer
    WEIGHTS = {
        "schema": 0.25,
        "statistical": 0.30,
        "semantic": 0.25,
        "temporal": 0.20,
    }

    def calculate_quality_score(
        self,
        schema_result: ValidationResult,
        statistical_result: ValidationResult,
        semantic_result: ValidationResult,
        temporal_result: ValidationResult,
    ) -> QualityScore:

        weighted_score = (
            self.WEIGHTS["schema"] * schema_result.score +
            self.WEIGHTS["statistical"] * statistical_result.score +
            self.WEIGHTS["semantic"] * semantic_result.score +
            self.WEIGHTS["temporal"] * temporal_result.score
        )

        # Determine action based on score
        if weighted_score >= 0.9:
            action = "pass"
        elif weighted_score >= 0.7:
            action = "warn"
        elif weighted_score >= 0.5:
            action = "quarantine"
        else:
            action = "reject"

        return QualityScore(
            score=weighted_score,
            action=action,
            layer_scores={
                "schema": schema_result.score,
                "statistical": statistical_result.score,
                "semantic": semantic_result.score,
                "temporal": temporal_result.score,
            },
            issues=self._collect_issues(
                schema_result, statistical_result,
                semantic_result, temporal_result
            ),
        )
```

---

## Training Data Production Pipeline

### Pipeline Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                  TRAINING DATA PRODUCTION PIPELINE                       │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │                    DATA SOURCES (Raw)                               │ │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────────┐  │ │
│  │  │TCGplayer│ │Cardmkt  │ │eBay    │ │Japan   │ │Social/News │  │ │
│  │  └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘ └──────┬──────┘  │ │
│  └───────┼──────────┼──────────┼──────────┼──────────────┼──────────┘ │
│          │          │          │          │              │            │
│          ▼          ▼          ▼          ▼              ▼            │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │                     QUALITY ASSESSMENT                              │ │
│  │    (Schema → Statistical → Semantic → Temporal → Score)             │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                    │                                     │
│          ┌─────────────────────────┼─────────────────────────┐          │
│          ▼                         ▼                         ▼          │
│   ┌────────────┐           ┌────────────┐           ┌────────────┐     │
│   │ High Quality│          │ Med Quality │          │ Quarantine │     │
│   │ (Score ≥0.9)│          │ (0.7-0.9)   │          │ (< 0.7)    │     │
│   └──────┬─────┘           └──────┬─────┘           └──────┬─────┘     │
│          │                        │                        │            │
│          ▼                        ▼                        ▼            │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │                     FEATURE ENGINEERING                             │ │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐  │ │
│  │  │Price Features│ │Time Features│ │Market Feats│ │Card Features│  │ │
│  │  │- rolling_avg │ │- day_of_week│ │- spread    │ │- rarity     │  │ │
│  │  │- volatility │ │- seasonality│ │- volume    │ │- color      │  │ │
│  │  │- momentum   │ │- trend      │ │- liquidity │ │- type       │  │ │
│  │  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘  │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                    │                                     │
│                                    ▼                                     │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │                     LABEL GENERATION                                │ │
│  │  ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐      │ │
│  │  │ Demand Labels   │ │ Anomaly Labels  │ │ Timing Labels   │      │ │
│  │  │ (High/Med/Low)  │ │ (Normal/Anomaly)│ │ (Buy/Sell/Hold) │      │ │
│  │  └─────────────────┘ └─────────────────┘ └─────────────────┘      │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                    │                                     │
│                                    ▼                                     │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │                     DATA SPLITTING & VERSIONING                     │ │
│  │  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐     │ │
│  │  │ Train    │    │ Validate │    │ Test     │    │ Holdout  │     │ │
│  │  │ (70%)    │    │ (15%)    │    │ (10%)    │    │ (5%)     │     │ │
│  │  └──────────┘    └──────────┘    └──────────┘    └──────────┘     │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                    │                                     │
│                                    ▼                                     │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │                     OUTPUT: VERSIONED DATASETS                      │ │
│  │  s3://tcg-data/training/v{version}/                                │ │
│  │  ├── train/demand_features.parquet                                 │ │
│  │  ├── train/anomaly_features.parquet                                │ │
│  │  ├── train/timing_features.parquet                                 │ │
│  │  ├── validate/...                                                  │ │
│  │  ├── test/...                                                      │ │
│  │  ├── metadata.json (schema, stats, quality report)                 │ │
│  │  └── lineage.json (source files, transformations)                  │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Feature Engineering Specifications

#### Price Features
```python
price_features = {
    # Rolling statistics
    "price_sma_7d": "7-day simple moving average",
    "price_sma_30d": "30-day simple moving average",
    "price_ema_7d": "7-day exponential moving average",
    "price_volatility_7d": "7-day rolling standard deviation",
    "price_volatility_30d": "30-day rolling standard deviation",

    # Momentum indicators
    "price_momentum_7d": "(current - 7d_ago) / 7d_ago",
    "price_momentum_30d": "(current - 30d_ago) / 30d_ago",
    "price_rsi_14d": "14-day relative strength index",

    # Cross-market features
    "tcgplayer_cardmarket_spread": "Price difference between markets",
    "us_jp_spread": "Price difference US vs Japan",
    "arbitrage_opportunity": "Boolean if spread > threshold",
}
```

#### Time Features
```python
time_features = {
    "day_of_week": "0-6 (Monday-Sunday)",
    "day_of_month": "1-31",
    "week_of_year": "1-52",
    "month": "1-12",
    "is_weekend": "Boolean",
    "days_since_release": "Days since card/set release",
    "days_until_rotation": "Days until format rotation (if applicable)",
    "is_holiday_season": "Nov-Dec holiday indicator",
    "is_tournament_season": "Regional/championship season indicator",
}
```

#### Market Features
```python
market_features = {
    "listing_count": "Number of active listings",
    "listing_velocity": "Rate of new listings per day",
    "sales_velocity": "Rate of sales per day",
    "inventory_change_7d": "Change in available inventory",
    "market_depth": "Total value of listings at various price points",
    "bid_ask_spread": "Difference between buy/sell offers",
    "liquidity_score": "Composite score of market liquidity",
}
```

#### Card Features
```python
card_features = {
    # Static attributes
    "rarity_encoded": "One-hot encoded rarity",
    "color_encoded": "One-hot encoded color(s)",
    "type_encoded": "One-hot encoded card type",
    "cost": "Card play cost",
    "power": "Card power value",

    # Derived features
    "is_leader": "Boolean",
    "is_variant": "Boolean (parallel, SP, etc.)",
    "variant_type_encoded": "One-hot encoded variant type",
    "meta_relevance": "Score based on tournament usage",
    "art_popularity": "Social sentiment on card art",
}
```

### Label Generation

#### Demand Labels (Classification)
```python
def generate_demand_label(card_id: str, lookback_days: int = 30) -> str:
    """
    Classify demand based on sales velocity and inventory trends
    """
    sales_velocity = get_sales_velocity(card_id, lookback_days)
    inventory_trend = get_inventory_trend(card_id, lookback_days)
    listing_velocity = get_listing_velocity(card_id, lookback_days)

    # High demand: fast sales, decreasing inventory
    if sales_velocity > 0.8 and inventory_trend < -0.2:
        return "HIGH"

    # Low demand: slow sales, increasing inventory
    elif sales_velocity < 0.2 and inventory_trend > 0.2:
        return "LOW"

    # Medium demand: everything else
    else:
        return "MEDIUM"
```

#### Anomaly Labels (Binary)
```python
def generate_anomaly_label(price_event: PriceEvent) -> int:
    """
    Label as anomaly based on multiple criteria
    """
    is_anomaly = False

    # Statistical anomaly
    historical = get_price_history(price_event.card_id, days=30)
    if len(historical) >= 5:
        z_score = (price_event.price_usd - np.mean(historical)) / np.std(historical)
        if abs(z_score) > 3:
            is_anomaly = True

    # Sudden spike/crash
    last_price = get_last_price(price_event.card_id)
    if last_price:
        pct_change = abs(price_event.price_usd - last_price) / last_price
        if pct_change > 0.5:  # 50% change
            is_anomaly = True

    # Market manipulation indicators
    if detect_wash_trading(price_event):
        is_anomaly = True

    return 1 if is_anomaly else 0
```

#### Timing Labels (Regression/Classification)
```python
def generate_timing_label(card_id: str, horizon_days: int = 7) -> str:
    """
    Generate buy/sell/hold recommendation based on future price
    """
    current_price = get_current_price(card_id)
    future_price = get_future_price(card_id, horizon_days)  # For training only!

    if future_price is None:
        return "HOLD"  # Not enough future data

    pct_change = (future_price - current_price) / current_price

    if pct_change > 0.10:  # Price will rise 10%+
        return "BUY"
    elif pct_change < -0.10:  # Price will fall 10%+
        return "SELL"
    else:
        return "HOLD"
```

### Data Versioning Strategy

```python
class TrainingDataVersion:
    """
    Manages versioned training datasets
    """

    def __init__(self, base_path: str = "s3://tcg-data/training"):
        self.base_path = base_path
        self.version = self._generate_version()

    def _generate_version(self) -> str:
        """Generate version string: YYYYMMDD_HHMMSS"""
        return datetime.now().strftime("%Y%m%d_%H%M%S")

    def save_dataset(
        self,
        train_df: pd.DataFrame,
        val_df: pd.DataFrame,
        test_df: pd.DataFrame,
        holdout_df: pd.DataFrame,
        model_type: str,  # "demand", "anomaly", "timing"
    ):
        version_path = f"{self.base_path}/v{self.version}"

        # Save data splits
        for split, df in [
            ("train", train_df),
            ("validate", val_df),
            ("test", test_df),
            ("holdout", holdout_df),
        ]:
            path = f"{version_path}/{split}/{model_type}_features.parquet"
            df.to_parquet(path)

        # Save metadata
        metadata = {
            "version": self.version,
            "model_type": model_type,
            "created_at": datetime.now().isoformat(),
            "row_counts": {
                "train": len(train_df),
                "validate": len(val_df),
                "test": len(test_df),
                "holdout": len(holdout_df),
            },
            "feature_columns": list(train_df.columns),
            "label_distribution": train_df["label"].value_counts().to_dict(),
            "quality_stats": self._compute_quality_stats(train_df),
        }

        with open(f"{version_path}/metadata.json", "w") as f:
            json.dump(metadata, f, indent=2)

        # Save lineage
        lineage = {
            "source_files": self._get_source_files(),
            "transformations": self._get_transformation_log(),
            "quality_filters_applied": self._get_quality_filters(),
        }

        with open(f"{version_path}/lineage.json", "w") as f:
            json.dump(lineage, f, indent=2)
```

---

## Implementation Roadmap

### Phase 1: Data Source Integration (Week 1-2)

| Task | Priority | Effort | Dependencies |
|------|----------|--------|--------------|
| Integrate OPTCG API | High | 3 days | API key |
| Integrate JustTCG API | High | 3 days | API key, subscription |
| Set up TCGCSV daily sync | Medium | 2 days | S3 bucket |
| Add Magical Meta scraper | Medium | 2 days | Proxy setup |
| Implement source reconciliation | High | 3 days | All sources |

### Phase 2: Quality Assessment Pipeline (Week 3-4)

| Task | Priority | Effort | Dependencies |
|------|----------|--------|--------------|
| Implement schema validation (GX) | High | 3 days | Great Expectations |
| Implement statistical validation | High | 4 days | Historical data |
| Implement semantic validation | Medium | 3 days | Card catalog |
| Implement temporal validation | Medium | 3 days | Time series data |
| Build quality score aggregator | High | 2 days | All validators |
| Set up quality dashboards | Medium | 2 days | CloudWatch/Grafana |

### Phase 3: Training Data Pipeline (Week 5-6)

| Task | Priority | Effort | Dependencies |
|------|----------|--------|--------------|
| Implement feature engineering | High | 5 days | Clean data |
| Build demand label generator | High | 3 days | Sales data |
| Build anomaly label generator | High | 3 days | Historical data |
| Build timing label generator | High | 3 days | Future prices |
| Implement data versioning | Medium | 2 days | S3 setup |
| Add lineage tracking | Medium | 2 days | Metadata store |

### Phase 4: Automation & Monitoring (Week 7-8)

| Task | Priority | Effort | Dependencies |
|------|----------|--------|--------------|
| Schedule daily quality runs | High | 2 days | Step Functions |
| Implement alerting | High | 2 days | SNS |
| Build training data triggers | Medium | 3 days | EventBridge |
| Add drift detection | Medium | 3 days | ML models |
| Create quality reports | Low | 2 days | QuickSight |

---

## Technical Architecture

### AWS Services Used

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         AWS ARCHITECTURE                                 │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  Data Ingestion                    Quality Assessment                    │
│  ┌─────────────────┐              ┌─────────────────┐                   │
│  │ Lambda          │              │ Glue ETL        │                   │
│  │ (Collectors)    │──────────────│ (Validators)    │                   │
│  └────────┬────────┘              └────────┬────────┘                   │
│           │                                │                             │
│           ▼                                ▼                             │
│  ┌─────────────────┐              ┌─────────────────┐                   │
│  │ Kinesis         │              │ S3              │                   │
│  │ Data Streams    │              │ (Data Lake)     │                   │
│  └────────┬────────┘              └────────┬────────┘                   │
│           │                                │                             │
│           ▼                                ▼                             │
│  ┌─────────────────┐              ┌─────────────────┐                   │
│  │ DynamoDB        │              │ Athena          │                   │
│  │ (Current State) │              │ (Analytics)     │                   │
│  └─────────────────┘              └────────┬────────┘                   │
│                                            │                             │
│  Training Pipeline                         │                             │
│  ┌─────────────────┐              ┌────────┴────────┐                   │
│  │ SageMaker       │◀─────────────│ Step Functions  │                   │
│  │ Pipelines       │              │ (Orchestration) │                   │
│  └────────┬────────┘              └─────────────────┘                   │
│           │                                                              │
│           ▼                                                              │
│  ┌─────────────────┐              ┌─────────────────┐                   │
│  │ Model Registry  │              │ CloudWatch      │                   │
│  │ (Versioned)     │              │ (Monitoring)    │                   │
│  └─────────────────┘              └─────────────────┘                   │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Key Configuration

```yaml
# data-quality-config.yaml
quality_thresholds:
  pass: 0.9
  warn: 0.7
  quarantine: 0.5

validation_weights:
  schema: 0.25
  statistical: 0.30
  semantic: 0.25
  temporal: 0.20

statistical_params:
  z_score_threshold: 3.0
  iqr_multiplier: 3.0
  min_history_points: 5
  lookback_days: 30

temporal_params:
  max_data_age_hours: 24
  max_price_change_pct: 0.5
  max_gap_hours: 48
  drift_threshold: 0.3

training_data:
  split_ratios:
    train: 0.70
    validate: 0.15
    test: 0.10
    holdout: 0.05

  min_quality_score: 0.7
  version_retention_days: 90
```

---

## Appendix: Data Source API Examples

### OPTCG API
```bash
# Get all cards
curl https://optcgapi.com/api/cards/

# Get cards by set
curl https://optcgapi.com/api/cards/?set=OP01

# Get card prices
curl https://optcgapi.com/api/cards/OP01-001/prices/
```

### JustTCG API
```bash
# Get One Piece sets
curl -H "Authorization: Bearer API_KEY" \
  "https://api.justtcg.com/v1/sets?game=one-piece-card-game"

# Get card prices
curl -H "Authorization: Bearer API_KEY" \
  "https://api.justtcg.com/v1/cards?set=OP01&include_variants=true"
```

### TCGCSV
```bash
# Get One Piece category
curl "https://tcgcsv.com/tcgplayer/88/groups"

# Get OP01 products
curl "https://tcgcsv.com/tcgplayer/88/12345/products"

# Get prices
curl "https://tcgcsv.com/tcgplayer/88/12345/prices"
```

---

## Implemented Components

### Data Collectors

#### OPTCG API Collector (`lambda/collectors/optcg/optcg.ts`)

Free API collector for One Piece TCG data:

```typescript
// Key features:
- Free API, no authentication required
- Daily updated prices from TCGplayer
- Comprehensive card catalog (OP01-OP12, ST01-ST28, Promos)
- 2-week price history available

// Usage:
const client = new OptcgApiClient();
const cards = await client.getAllCardsWithPrices();
```

#### JustTCG API Collector (`lambda/collectors/justtcg/justtcg.ts`)

Paid API with condition-specific pricing:

```typescript
// Key features:
- Multi-game support (One Piece, Pokemon, MTG, etc.)
- Condition-specific pricing (NM, LP, MP, HP, DMG)
- 6-hour update frequency
- Variant support (foil, parallel, etc.)

// Pricing tiers:
- Free: 1,000 req/month
- Starter ($9.90): 10,000 req/month
- Professional ($24.90): 50,000 req/month
```

#### Cardmarket Scraper (`lambda/collectors/cardmarket/cardmarket-scraper.ts`)

Web scraper for EU market data (no public API):

```typescript
// Key features:
- Multi-strategy HTML parsing
- Proxy rotation support
- Rate limiting (2 req/sec max)
- Supports all One Piece sets (OP01-OP11, EB01-EB02, ST01-ST20)

// Data extracted:
- Card prices (€30, €7, low, trend)
- Available quantity
- Price history (7d, 30d changes)
```

### Data Quality Validator (`lambda/processors/quality-validator/quality-validator.ts`)

Multi-layer validation pipeline:

```typescript
// Validation layers:
1. Schema Validation (35% weight)
   - Field presence and types
   - Format validation (regex patterns)
   - Enum validation (conditions, currencies)

2. Statistical Validation (25% weight)
   - Z-score outlier detection (threshold: 3.0)
   - IQR-based outlier detection (multiplier: 1.5)
   - Price change magnitude check (50% threshold)

3. Semantic Validation (25% weight)
   - Set code validity
   - Card number range validation
   - Currency conversion sanity check
   - Variant type validation

4. Temporal Validation (15% weight)
   - Timestamp freshness (max 7 days)
   - Future timestamp rejection
   - Collection delay validation

// Quality tiers:
- Pass: score ≥ 0.9
- Warn: score 0.7-0.9
- Quarantine: score 0.5-0.7
- Reject: score < 0.5
```

### Feature Engineering (`lambda/processors/feature-engineer/feature-engineer.ts`)

ML-ready feature vector generation:

```typescript
// Feature categories:
1. Price Features (rolling stats, volatility, momentum)
   - priceMA{1,3,7,14,30}d: Moving averages
   - priceStd{1,3,7,14,30}d: Standard deviations
   - priceChange{1,3,7,30}d: Absolute and percent changes
   - volatility{7,30}d: Annualized volatility

2. Time Features
   - dayOfWeek, dayOfMonth, monthOfYear
   - isWeekend, daysSinceRelease

3. Market Features
   - tcgplayerSpread, cardmarketSpread
   - arbitrageOpportunity (>15% spread)
   - liquidityScore (0-1 based on listings)

4. Card Features
   - rarityEncoded (0-5: C, UC, R, SR, SEC, SP)
   - variantEncoded (0-7: regular, parallel, manga, sp, etc.)
   - setEncoded (release order)

// Labels generated:
- label_price_{1,3,7}d: Future prices
- label_direction_{1,7}d: Price direction (+1, 0, -1)
- label_volatility_7d: Future volatility
- label_anomaly: Anomaly detection (0 or 1)
```

### Shared Utilities (`lambda/layers/shared/nodejs/utils.ts`)

Common utilities across all Lambdas:

```typescript
// Key utilities:
- Currency conversion with live FX rates (exchangerate-api.com)
- Card ID normalization (setCode-cardNumber-variant)
- Condition normalization (with tracking for unknown conditions)
- Variant type detection (parallel, manga, sp, spr, tr, etc.)
- Seller reputation calculation and weighting
- Fuzzy card matching for inconsistent listings
- Rate limiting (token bucket algorithm)
- Retry with exponential backoff
- Data quality tracking and metrics
```

---

## References

- [Great Expectations Documentation](https://greatexpectations.io/)
- [TCGplayer API Documentation](https://help.tcgplayer.com/hc/en-us/articles/201577976)
- [JustTCG API Documentation](https://justtcg.com/docs)
- [OPTCG API Documentation](https://optcgapi.com/about/general)
- [TCGCSV](https://tcgcsv.com/)
- [Magical Meta](https://magicalmeta.ink/onepiece/about.html)
- [Time Series Anomaly Detection Survey](https://arxiv.org/html/2211.05244v3)
- [TODS: Time Series Outlier Detection](https://towardsdatascience.com/tods-detecting-outliers-from-time-series-data-2d4bd2e91381/)
