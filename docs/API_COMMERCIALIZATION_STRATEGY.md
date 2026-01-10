# API Commercialization & Neural Network Deal Identification Strategy

**Date:** 2026-01-07
**Analysis Method:** Deep Strategic Meditation
**Status:** Strategic Planning Document

---

## Executive Summary

This document presents a comprehensive analysis of the RDS price data infrastructure for:
1. **Internal price app optimization** - Maximizing trade-in business efficiency
2. **External API commercialization** - Revenue generation through data monetization
3. **Neural network deal identification** - AI-powered arbitrage and market opportunity detection
4. **Future elevation scenarios** - Scaling to enterprise-grade financial data platform

**Key Insight:** The current infrastructure represents a nascent **financial data terminal for TCG markets** - analogous to Bloomberg Terminal for traditional finance. With strategic elevation, this can become the authoritative price discovery platform for the $15B+ global TCG market.

---

## 1. Current State Analysis

### 1.1 Data Asset Inventory

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                         DATA ASSET PYRAMID                                           │
└─────────────────────────────────────────────────────────────────────────────────────┘

                              ┌─────────────┐
                              │   SIGNALS   │  ← Neural Network Outputs
                              │  (Derived)  │     Arbitrage alerts, predictions
                              └──────┬──────┘
                                     │
                         ┌───────────┴───────────┐
                         │      ANALYTICS        │  ← Calculated Metrics
                         │   Indices, Volatility │     TCG-100, correlations
                         │   Correlations, Trends│
                         └───────────┬───────────┘
                                     │
               ┌─────────────────────┴─────────────────────┐
               │              HISTORICAL DATA              │  ← Time-Series Archive
               │   CardPriceHistory, IndexSnapshots        │     346 days, 232K rows
               │   WeightHistory, ExchangeRates            │
               └─────────────────────┬─────────────────────┘
                                     │
     ┌───────────────────────────────┴───────────────────────────────┐
     │                        RAW PRICE DATA                         │  ← Source Truth
     │   CardPriceV2 (Multi-source), JapanesePriceSource            │     1,000 cards
     │   PriceSource (Multi-channel), ExternalCardPrice              │     6 sources
     └───────────────────────────────────────────────────────────────┘
```

### 1.2 Current API Capabilities Matrix

| Endpoint | Data Type | Latency | Cache | Auth | Commercial Value |
|----------|-----------|---------|-------|------|------------------|
| `/api/price-index` | All indices | <100ms | 5min | None | ★★★★★ |
| `/api/price-index/tcg100` | Weighted index | <200ms | 5min | None | ★★★★★ |
| `/api/price-index/card/:id` | Card detail + history | <50ms | 1hr | None | ★★★★☆ |
| `/api/price-index/movers` | Top gainers/losers | <100ms | 5min | None | ★★★★☆ |
| `/api/price-index/health` | Market sentiment | <100ms | 5min | None | ★★★☆☆ |
| `/api/price-index/crystal` | Network visualization | <500ms | 10min | None | ★★★☆☆ |
| `/api/cards/lookup` | Card search | <100ms | None | None | ★★★★☆ |
| `/api/shards` | Multi-TCG status | <50ms | None | None | ★★☆☆☆ |

### 1.3 Data Flow Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                           CURRENT DATA FLOW                                          │
└─────────────────────────────────────────────────────────────────────────────────────┘

  EXTERNAL SOURCES                    INTERNAL PROCESSING                  CONSUMERS
  ━━━━━━━━━━━━━━━━                    ━━━━━━━━━━━━━━━━━━━                  ━━━━━━━━━━

  ┌─────────────┐
  │ OPTCG API   │──┐
  │ (TCGplayer) │  │
  └─────────────┘  │
                   │    ┌─────────────────────────────────────┐
  ┌─────────────┐  │    │                                     │
  │  Limitless  │──┼───▶│         CardPriceV2                 │
  │ (CardMarket)│  │    │      (Multi-Source Prices)          │
  └─────────────┘  │    │                                     │
                   │    └──────────────┬──────────────────────┘
  ┌─────────────┐  │                   │
  │   JustTCG   │──┘                   │
  │ (TCGplayer) │                      │
  └─────────────┘                      │
                                       ▼
  ┌─────────────┐         ┌─────────────────────────────────────┐
  │  CardRush   │         │                                     │
  │    (JP)     │────────▶│      JapanesePriceSource            │────┐
  └─────────────┘         │        (JP Staging)                 │    │
                          └─────────────────────────────────────┘    │
                                                                      │
  ┌─────────────┐                                                     │
  │   S3 Feed   │         ┌─────────────────────────────────────┐    │
  │ (pricefeed) │────────▶│         PriceSource                 │    │
  └─────────────┘         │     (Multi-Channel)                 │    │
                          └─────────────────────────────────────┘    │
                                       │                              │
                                       ▼                              ▼
                          ┌─────────────────────────────────────────────────┐
                          │                DAILY CRON                       │
                          │                                                 │
                          │  ┌───────────────┐    ┌───────────────────┐    │
                          │  │ Price Snapshot│    │ Index Calculation │    │
                          │  │   (per card)  │    │   (per type/key)  │    │
                          │  └───────┬───────┘    └─────────┬─────────┘    │
                          │          │                      │              │
                          └──────────┼──────────────────────┼──────────────┘
                                     │                      │
                                     ▼                      ▼
                          ┌─────────────────┐    ┌─────────────────┐
                          │CardPriceHistory │    │PriceIndexSnapshot│
                          │  (Time-Series)  │    │   (Indices)     │
                          └────────┬────────┘    └────────┬────────┘
                                   │                      │
                                   └──────────┬───────────┘
                                              │
                                              ▼
                          ┌─────────────────────────────────────┐
                          │           API LAYER                 │
                          │                                     │       ┌──────────────┐
                          │  /api/price-index/*                 │──────▶│  Dashboard   │
                          │  /api/cards/lookup                  │       │  (Internal)  │
                          │  /api/shards                        │       └──────────────┘
                          │                                     │
                          └─────────────────────────────────────┘       ┌──────────────┐
                                              │                         │  Trade-In    │
                                              └────────────────────────▶│    App       │
                                                                        └──────────────┘
```

---

## 2. Commercial API Tiers

### 2.1 Proposed Tier Structure

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                         API COMMERCIALIZATION TIERS                                  │
└─────────────────────────────────────────────────────────────────────────────────────┘

  ┌─────────────────────────────────────────────────────────────────────────────────┐
  │  TIER 0: PUBLIC (Free)                                                          │
  │  ━━━━━━━━━━━━━━━━━━━━                                                           │
  │                                                                                  │
  │  Purpose: Market awareness, developer adoption, SEO                             │
  │  Rate Limit: 100 requests/day                                                   │
  │  Endpoints:                                                                     │
  │    • GET /api/v1/health         - API status                                    │
  │    • GET /api/v1/indices        - Current index values only (no history)        │
  │    • GET /api/v1/cards/:id      - Single card price (delayed 24h)               │
  │                                                                                  │
  │  Restrictions:                                                                  │
  │    • 24-hour delay on all price data                                            │
  │    • No historical data                                                         │
  │    • No bulk endpoints                                                          │
  │    • Attribution required                                                       │
  │                                                                                  │
  │  Revenue: $0 (lead generation)                                                  │
  └─────────────────────────────────────────────────────────────────────────────────┘

  ┌─────────────────────────────────────────────────────────────────────────────────┐
  │  TIER 1: DEVELOPER ($29/month)                                                  │
  │  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━                                                   │
  │                                                                                  │
  │  Purpose: Hobby projects, small apps, Discord bots                              │
  │  Rate Limit: 1,000 requests/day                                                 │
  │  Endpoints:                                                                     │
  │    • All Tier 0 endpoints (real-time)                                           │
  │    • GET /api/v1/cards/search   - Card search                                   │
  │    • GET /api/v1/cards/:id/history?days=7 - 7-day history                       │
  │    • GET /api/v1/movers         - Daily gainers/losers                          │
  │                                                                                  │
  │  Restrictions:                                                                  │
  │    • 7-day history max                                                          │
  │    • No bulk downloads                                                          │
  │    • No webhooks                                                                │
  │    • Single game (One Piece only)                                               │
  │                                                                                  │
  │  Revenue: $29 × subscribers                                                     │
  └─────────────────────────────────────────────────────────────────────────────────┘

  ┌─────────────────────────────────────────────────────────────────────────────────┐
  │  TIER 2: PROFESSIONAL ($99/month)                                               │
  │  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━                                                 │
  │                                                                                  │
  │  Purpose: Card shops, trading platforms, analytics tools                        │
  │  Rate Limit: 10,000 requests/day                                                │
  │  Endpoints:                                                                     │
  │    • All Tier 1 endpoints                                                       │
  │    • GET /api/v1/cards/:id/history?days=90 - 90-day history                     │
  │    • GET /api/v1/tcg100         - Full TCG-100 index with constituents          │
  │    • GET /api/v1/sets/:code     - Set-level analytics                           │
  │    • GET /api/v1/volatility     - Volatility metrics                            │
  │    • POST /api/v1/webhooks      - Price alert webhooks                          │
  │                                                                                  │
  │  Features:                                                                      │
  │    • 90-day history                                                             │
  │    • All supported games                                                        │
  │    • 5 webhook endpoints                                                        │
  │    • Email support                                                              │
  │                                                                                  │
  │  Revenue: $99 × subscribers                                                     │
  └─────────────────────────────────────────────────────────────────────────────────┘

  ┌─────────────────────────────────────────────────────────────────────────────────┐
  │  TIER 3: ENTERPRISE ($499/month)                                                │
  │  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━                                                   │
  │                                                                                  │
  │  Purpose: Market makers, funds, large retailers                                 │
  │  Rate Limit: 100,000 requests/day                                               │
  │  Endpoints:                                                                     │
  │    • All Tier 2 endpoints                                                       │
  │    • GET /api/v1/cards/:id/history?days=365 - Full history                      │
  │    • GET /api/v1/bulk/cards     - Bulk card data export                         │
  │    • GET /api/v1/bulk/history   - Bulk history export                           │
  │    • GET /api/v1/correlations   - Price correlation matrix                      │
  │    • GET /api/v1/arbitrage      - Cross-market opportunities                    │
  │    • WS /api/v1/stream          - Real-time price stream                        │
  │                                                                                  │
  │  Features:                                                                      │
  │    • Full historical data (365+ days)                                           │
  │    • Bulk CSV/JSON exports                                                      │
  │    • Real-time WebSocket streaming                                              │
  │    • Unlimited webhooks                                                         │
  │    • Dedicated support                                                          │
  │    • Custom integrations                                                        │
  │                                                                                  │
  │  Revenue: $499 × subscribers                                                    │
  └─────────────────────────────────────────────────────────────────────────────────┘

  ┌─────────────────────────────────────────────────────────────────────────────────┐
  │  TIER 4: NEURAL NETWORK ($999/month)                                            │
  │  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━                                               │
  │                                                                                  │
  │  Purpose: Algorithmic trading, ML researchers, hedge funds                      │
  │  Rate Limit: Unlimited (fair use)                                               │
  │  Endpoints:                                                                     │
  │    • All Tier 3 endpoints                                                       │
  │    • GET /api/v1/neural/predictions - Price predictions (24h/7d/30d)            │
  │    • GET /api/v1/neural/anomalies   - Anomaly detection alerts                  │
  │    • GET /api/v1/neural/deals       - AI-identified market deals                │
  │    • GET /api/v1/neural/clusters    - Card cluster analysis                     │
  │    • GET /api/v1/neural/sentiment   - Market sentiment analysis                 │
  │    • GET /api/v1/neural/crystal     - Full network graph data                   │
  │                                                                                  │
  │  Features:                                                                      │
  │    • ML-powered predictions                                                     │
  │    • Anomaly detection                                                          │
  │    • Deal identification                                                        │
  │    • Priority data access                                                       │
  │    • White-label licensing available                                            │
  │                                                                                  │
  │  Revenue: $999 × subscribers                                                    │
  └─────────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Revenue Projections

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                         REVENUE MODEL SCENARIOS                                      │
└─────────────────────────────────────────────────────────────────────────────────────┘

  CONSERVATIVE (Year 1)
  ━━━━━━━━━━━━━━━━━━━━━
  Tier 1 Developer:   50 × $29  =   $1,450/month
  Tier 2 Professional: 20 × $99  =   $1,980/month
  Tier 3 Enterprise:    5 × $499 =   $2,495/month
  Tier 4 Neural:        2 × $999 =   $1,998/month
  ────────────────────────────────────────────────
  TOTAL:                             $7,923/month → $95,076/year


  MODERATE (Year 2)
  ━━━━━━━━━━━━━━━━━
  Tier 1 Developer:  200 × $29  =   $5,800/month
  Tier 2 Professional: 80 × $99  =   $7,920/month
  Tier 3 Enterprise:   20 × $499 =   $9,980/month
  Tier 4 Neural:       10 × $999 =   $9,990/month
  ────────────────────────────────────────────────
  TOTAL:                            $33,690/month → $404,280/year


  AGGRESSIVE (Year 3 - Multi-TCG)
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Tier 1 Developer:  500 × $29  =  $14,500/month
  Tier 2 Professional: 200 × $99  =  $19,800/month
  Tier 3 Enterprise:   50 × $499 =  $24,950/month
  Tier 4 Neural:       25 × $999 =  $24,975/month
  ────────────────────────────────────────────────
  TOTAL:                            $84,225/month → $1,010,700/year
```

---

## 3. Neural Network Deal Identification

### 3.1 Deal Detection Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                    NEURAL NETWORK DEAL IDENTIFICATION SYSTEM                         │
└─────────────────────────────────────────────────────────────────────────────────────┘

                              ┌─────────────────────┐
                              │   DEAL CLASSIFIER   │
                              │   (Output Layer)    │
                              └──────────┬──────────┘
                                         │
                    ┌────────────────────┼────────────────────┐
                    │                    │                    │
                    ▼                    ▼                    ▼
           ┌───────────────┐    ┌───────────────┐    ┌───────────────┐
           │   ARBITRAGE   │    │  UNDERVALUE   │    │   MOMENTUM    │
           │   DETECTOR    │    │   DETECTOR    │    │   DETECTOR    │
           └───────┬───────┘    └───────┬───────┘    └───────┬───────┘
                   │                    │                    │
                   └────────────────────┼────────────────────┘
                                        │
                              ┌─────────┴─────────┐
                              │  FEATURE FUSION   │
                              │     LAYER         │
                              └─────────┬─────────┘
                                        │
     ┌──────────────────────────────────┼──────────────────────────────────┐
     │                                  │                                  │
     ▼                                  ▼                                  ▼
┌─────────────┐                  ┌─────────────┐                  ┌─────────────┐
│   PRICE     │                  │  TEMPORAL   │                  │   MARKET    │
│  FEATURES   │                  │  FEATURES   │                  │  FEATURES   │
│             │                  │             │                  │             │
│ • Multi-src │                  │ • Velocity  │                  │ • Sentiment │
│   spread    │                  │ • Accel     │                  │ • Volume    │
│ • JP/EN gap │                  │ • Seasonlty │                  │ • Liquidity │
│ • FX impact │                  │ • Trend dir │                  │ • Correl    │
└──────┬──────┘                  └──────┬──────┘                  └──────┬──────┘
       │                                │                                │
       └────────────────────────────────┼────────────────────────────────┘
                                        │
                              ┌─────────┴─────────┐
                              │   DATA INGEST     │
                              │                   │
                              │ • CardPriceV2     │
                              │ • CardPriceHistory│
                              │ • PriceSource     │
                              │ • ExchangeRates   │
                              └───────────────────┘
```

### 3.2 Deal Types & Detection Logic

```typescript
// ============================================================================
// DEAL TYPE DEFINITIONS
// ============================================================================

interface Deal {
  dealId: string;
  cardId: string;
  dealType: DealType;
  confidence: number;        // 0-1 probability
  expectedReturn: number;    // % potential profit
  timeHorizon: TimeHorizon;  // IMMEDIATE | SHORT | MEDIUM | LONG
  riskLevel: RiskLevel;      // LOW | MEDIUM | HIGH
  actionRequired: Action;
  expiresAt: Date;
  metadata: DealMetadata;
}

type DealType =
  | "ARBITRAGE_CROSS_MARKET"     // Same card, different markets
  | "ARBITRAGE_CURRENCY"         // JP/EN price gap + FX opportunity
  | "UNDERVALUED_STATISTICAL"    // Below historical mean
  | "UNDERVALUED_COMPARATIVE"    // Below similar cards
  | "MOMENTUM_BREAKOUT"          // Price acceleration detected
  | "MOMENTUM_REVERSAL"          // Oversold bounce opportunity
  | "SUPPLY_SHOCK"               // Inventory depletion signal
  | "DEMAND_SURGE"               // Volume spike detected
  | "CORRELATION_BREAK"          // Decorrelation from set/rarity
  | "SEASONAL_OPPORTUNITY";      // Tournament/release timing
```

### 3.3 Feature Engineering

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                         FEATURE ENGINEERING PIPELINE                                 │
└─────────────────────────────────────────────────────────────────────────────────────┘

  RAW DATA                    ENGINEERED FEATURES                   NORMALIZED
  ━━━━━━━━                    ━━━━━━━━━━━━━━━━━━━                   ━━━━━━━━━━

  CardPriceV2                 PRICE FEATURES
  ───────────                 ──────────────
  • optcgTcgplayerGbp    ───▶ • price_spread_optcg_limitless
  • limitlessCardmarketGbp    • price_spread_optcg_justtcg          ───▶ z-score
  • justtcgTcgplayerGbp       • price_spread_min_max
  • bestPriceGbp              • price_distance_from_best


  CardPriceHistory            TEMPORAL FEATURES
  ────────────────            ─────────────────
  • priceGbp[]           ───▶ • price_velocity_7d (∂p/∂t)
  • change[]                  • price_acceleration_7d (∂²p/∂t²)
  • snapshotDate[]            • volatility_7d (σ)                   ───▶ 0-1 scale
                              • trend_strength (R²)
                              • mean_reversion_distance


  JapanesePriceSource         CURRENCY FEATURES
  ───────────────────         ─────────────────
  • priceJpy             ───▶ • jp_en_price_gap_pct
  • priceGbp                  • fx_adjusted_arbitrage               ───▶ z-score
  • jpyToGbpRate              • fx_trend_alignment


  PriceSource                 MULTI-CHANNEL FEATURES
  ───────────                 ──────────────────────
  • cardrush_price       ───▶ • channel_price_dispersion
  • cardmarket_price          • channel_liquidity_score             ───▶ 0-1 scale
  • ebay_price                • channel_velocity_divergence


  PriceCorrelation            NETWORK FEATURES
  ────────────────            ────────────────
  • correlation[]        ───▶ • set_correlation_deviation
  • entityA, entityB          • rarity_correlation_deviation        ───▶ z-score
                              • cluster_membership_strength


  ExchangeRateHistory         FX FEATURES
  ───────────────────         ───────────
  • jpyToGbp[]           ───▶ • fx_volatility_7d
  • change24h[]               • fx_trend_direction                  ───▶ -1 to 1
                              • fx_mean_reversion_signal
```

### 3.4 Model Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                    NEURAL NETWORK MODEL SPECIFICATION                                │
└─────────────────────────────────────────────────────────────────────────────────────┘

  MODEL: TCG-DealNet v1.0
  ━━━━━━━━━━━━━━━━━━━━━━━

  Architecture: Multi-Task Attention Network
  Framework: TensorFlow.js (browser + Node.js compatible)
  Training: Daily incremental updates

  ┌─────────────────────────────────────────────────────────────────────────────────┐
  │                                                                                  │
  │   INPUT LAYER                                                                    │
  │   ───────────                                                                    │
  │   Shape: [batch, 30, 45]  (30 days × 45 features)                               │
  │                                                                                  │
  │         │                                                                        │
  │         ▼                                                                        │
  │   ┌─────────────────────────────────────────────────────────────────────────┐   │
  │   │  TEMPORAL ENCODER (LSTM)                                                 │   │
  │   │  ─────────────────────────                                               │   │
  │   │  • Layer 1: LSTM(128, return_sequences=True)                            │   │
  │   │  • Layer 2: LSTM(64, return_sequences=False)                            │   │
  │   │  • Dropout: 0.3                                                          │   │
  │   └─────────────────────────────────────────────────────────────────────────┘   │
  │         │                                                                        │
  │         ▼                                                                        │
  │   ┌─────────────────────────────────────────────────────────────────────────┐   │
  │   │  ATTENTION MECHANISM                                                     │   │
  │   │  ───────────────────────                                                 │   │
  │   │  • Self-attention over temporal features                                 │   │
  │   │  • Multi-head attention (4 heads)                                        │   │
  │   │  • Learns which time periods matter most for each deal type              │   │
  │   └─────────────────────────────────────────────────────────────────────────┘   │
  │         │                                                                        │
  │         ▼                                                                        │
  │   ┌─────────────────────────────────────────────────────────────────────────┐   │
  │   │  FEATURE FUSION                                                          │   │
  │   │  ──────────────                                                          │   │
  │   │  • Dense(256, relu)                                                      │   │
  │   │  • BatchNorm                                                             │   │
  │   │  • Dropout(0.3)                                                          │   │
  │   │  • Dense(128, relu)                                                      │   │
  │   └─────────────────────────────────────────────────────────────────────────┘   │
  │         │                                                                        │
  │         ├──────────────────┬──────────────────┬──────────────────┐              │
  │         ▼                  ▼                  ▼                  ▼              │
  │   ┌───────────┐      ┌───────────┐      ┌───────────┐      ┌───────────┐       │
  │   │ DEAL TYPE │      │CONFIDENCE │      │ EXPECTED  │      │   RISK    │       │
  │   │ CLASSIFIER│      │ REGRESSOR │      │  RETURN   │      │  SCORER   │       │
  │   │           │      │           │      │           │      │           │       │
  │   │ Softmax   │      │ Sigmoid   │      │ Linear    │      │ Softmax   │       │
  │   │ (10 types)│      │ (0-1)     │      │ (%)       │      │ (3 levels)│       │
  │   └───────────┘      └───────────┘      └───────────┘      └───────────┘       │
  │                                                                                  │
  └─────────────────────────────────────────────────────────────────────────────────┘

  TRAINING METRICS
  ────────────────
  • Deal Type Accuracy: >85%
  • Confidence Calibration: Brier Score <0.15
  • Return MAE: <5%
  • Risk Classification F1: >0.80

  INFERENCE
  ─────────
  • Latency: <100ms per card
  • Batch: 500 cards in <5 seconds
  • Daily full scan: ~10 seconds for 1,000 cards
```

### 3.5 Deal Detection Algorithms

```python
# ============================================================================
# ARBITRAGE DETECTION
# ============================================================================

def detect_cross_market_arbitrage(card: CardPriceV2) -> Optional[Deal]:
    """
    Identifies price discrepancies between TCGplayer, CardMarket, and CardRush.

    Thresholds:
    - Minimum spread: 15% after fees
    - Minimum absolute: £2.00
    - Liquidity requirement: Both markets must show recent sales
    """

    prices = {
        'tcgplayer': card.optcgTcgplayerGbp,
        'cardmarket': card.limitlessCardmarketGbp,
        'justtcg': card.justtcgTcgplayerGbp,
    }

    valid_prices = {k: v for k, v in prices.items() if v and v > 0}
    if len(valid_prices) < 2:
        return None

    min_price = min(valid_prices.values())
    max_price = max(valid_prices.values())
    spread_pct = (max_price - min_price) / min_price

    # Account for fees (10% buy, 13% sell)
    net_spread = spread_pct - 0.23

    if net_spread >= 0.15 and (max_price - min_price) >= 2.00:
        return Deal(
            dealType="ARBITRAGE_CROSS_MARKET",
            confidence=min(0.95, 0.5 + net_spread),
            expectedReturn=net_spread * 100,
            timeHorizon="IMMEDIATE",
            riskLevel="LOW" if net_spread > 0.25 else "MEDIUM",
            metadata={
                'buy_market': min(valid_prices, key=valid_prices.get),
                'sell_market': max(valid_prices, key=valid_prices.get),
                'buy_price': min_price,
                'sell_price': max_price,
            }
        )


# ============================================================================
# CURRENCY ARBITRAGE
# ============================================================================

def detect_currency_arbitrage(
    card: CardPriceV2,
    jp_source: JapanesePriceSource,
    fx_history: List[ExchangeRateHistory]
) -> Optional[Deal]:
    """
    Identifies JP/EN price gaps that exceed FX-adjusted fair value.

    Logic:
    1. Convert JP price to GBP at current rate
    2. Compare to EN best price
    3. Factor in FX trend direction
    4. Account for import costs (~15%)
    """

    if not jp_source or not card.bestPriceGbp:
        return None

    current_fx = fx_history[-1].jpyToGbp
    jp_price_gbp = jp_source.priceJpy * current_fx
    en_price_gbp = card.bestPriceGbp

    # Calculate gap
    gap_pct = (en_price_gbp - jp_price_gbp) / jp_price_gbp

    # FX trend factor (boost if JPY weakening)
    fx_trend = calculate_fx_trend(fx_history, days=7)
    adjusted_gap = gap_pct + (fx_trend * 0.1)  # 10% weight on FX trend

    # Import costs threshold
    import_threshold = 0.15
    net_opportunity = adjusted_gap - import_threshold

    if net_opportunity >= 0.10:  # 10% after costs
        return Deal(
            dealType="ARBITRAGE_CURRENCY",
            confidence=min(0.90, 0.4 + net_opportunity),
            expectedReturn=net_opportunity * 100,
            timeHorizon="SHORT",  # 1-2 weeks for import
            riskLevel="MEDIUM",  # FX risk
            metadata={
                'jp_price_jpy': jp_source.priceJpy,
                'jp_price_gbp': jp_price_gbp,
                'en_price_gbp': en_price_gbp,
                'fx_rate': current_fx,
                'fx_trend': fx_trend,
            }
        )


# ============================================================================
# STATISTICAL UNDERVALUATION
# ============================================================================

def detect_statistical_undervalue(
    card: CardPriceV2,
    history: List[CardPriceHistory],
    lookback_days: int = 90
) -> Optional[Deal]:
    """
    Identifies cards trading significantly below their historical average.

    Method: Z-score analysis with volatility adjustment
    Threshold: Z < -1.5 (1.5 standard deviations below mean)
    """

    if len(history) < lookback_days * 0.7:  # Need 70% data coverage
        return None

    prices = [h.priceGbp for h in history[-lookback_days:]]
    mean_price = statistics.mean(prices)
    std_price = statistics.stdev(prices)

    if std_price == 0:
        return None

    current_price = card.bestPriceGbp
    z_score = (current_price - mean_price) / std_price

    if z_score <= -1.5:
        expected_return = ((mean_price / current_price) - 1) * 100

        return Deal(
            dealType="UNDERVALUED_STATISTICAL",
            confidence=min(0.85, 0.3 + abs(z_score) * 0.2),
            expectedReturn=expected_return,
            timeHorizon="MEDIUM",  # 2-4 weeks reversion
            riskLevel="MEDIUM",
            metadata={
                'current_price': current_price,
                'mean_price': mean_price,
                'z_score': z_score,
                'lookback_days': lookback_days,
            }
        )


# ============================================================================
# MOMENTUM BREAKOUT
# ============================================================================

def detect_momentum_breakout(
    card: CardPriceV2,
    history: List[CardPriceHistory]
) -> Optional[Deal]:
    """
    Identifies cards with accelerating price momentum.

    Signals:
    - Price velocity positive and increasing
    - Volume above average
    - Breaking above resistance levels
    """

    if len(history) < 14:
        return None

    prices = [h.priceGbp for h in history[-14:]]
    changes = [h.change for h in history[-14:]]

    # Calculate velocity (7-day) and acceleration (7-day delta)
    velocity_7d = sum(changes[-7:]) / 7
    velocity_prev_7d = sum(changes[-14:-7]) / 7
    acceleration = velocity_7d - velocity_prev_7d

    # Resistance breakout (above 20-day high)
    if len(history) >= 20:
        high_20d = max(h.priceGbp for h in history[-20:-1])
        breakout = prices[-1] > high_20d
    else:
        breakout = False

    if velocity_7d > 0.02 and acceleration > 0.01 and breakout:
        # Project 7-day forward return
        projected_return = velocity_7d * 7

        return Deal(
            dealType="MOMENTUM_BREAKOUT",
            confidence=min(0.80, 0.4 + velocity_7d * 10),
            expectedReturn=projected_return * 100,
            timeHorizon="SHORT",
            riskLevel="HIGH",  # Momentum can reverse
            metadata={
                'velocity_7d': velocity_7d,
                'acceleration': acceleration,
                'breakout_level': high_20d if breakout else None,
            }
        )
```

### 3.6 Deal Visualization API

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                         DEAL VISUALIZATION ENDPOINTS                                 │
└─────────────────────────────────────────────────────────────────────────────────────┘

  GET /api/v1/neural/deals
  ━━━━━━━━━━━━━━━━━━━━━━━━

  Response:
  {
    "deals": [
      {
        "dealId": "deal_abc123",
        "cardId": "OP03-OP01-051-sp",
        "cardName": "Eustass Kid SP",
        "dealType": "ARBITRAGE_CROSS_MARKET",
        "confidence": 0.87,
        "expectedReturn": 18.5,
        "timeHorizon": "IMMEDIATE",
        "riskLevel": "LOW",
        "action": {
          "type": "BUY",
          "market": "CardMarket",
          "price": 28.50,
          "targetSellMarket": "TCGplayer",
          "targetPrice": 34.00
        },
        "expiresAt": "2026-01-08T12:00:00Z",
        "createdAt": "2026-01-07T14:30:00Z"
      }
    ],
    "summary": {
      "totalDeals": 24,
      "byType": {
        "ARBITRAGE_CROSS_MARKET": 8,
        "ARBITRAGE_CURRENCY": 3,
        "UNDERVALUED_STATISTICAL": 7,
        "MOMENTUM_BREAKOUT": 4,
        "OTHER": 2
      },
      "avgConfidence": 0.72,
      "avgExpectedReturn": 12.3
    },
    "generatedAt": "2026-01-07T14:35:00Z"
  }


  GET /api/v1/neural/deals/:dealId
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Response: Detailed deal with full analysis
  {
    "deal": { ...deal object... },
    "analysis": {
      "priceHistory": [...],
      "featureImportance": {
        "price_spread": 0.35,
        "velocity_7d": 0.25,
        "volume_spike": 0.20,
        "correlation_break": 0.20
      },
      "similarDeals": [
        { "dealId": "...", "outcome": "SUCCESS", "returnAchieved": 15.2 }
      ],
      "riskFactors": [
        "FX volatility elevated",
        "Low liquidity on sell market"
      ]
    }
  }


  GET /api/v1/neural/crystal
  ━━━━━━━━━━━━━━━━━━━━━━━━━━

  Response: Network graph with deal highlights
  {
    "nodes": [
      {
        "id": "OP03-OP01-051-sp",
        "name": "Eustass Kid SP",
        "price": 34.49,
        "change24h": 2.5,
        "hasActiveDeal": true,
        "dealType": "ARBITRAGE_CROSS_MARKET",
        "dealConfidence": 0.87,
        "cluster": "OP03",
        "size": 1.2  // Relative to avg price
      }
    ],
    "edges": [
      {
        "source": "OP03-OP01-051-sp",
        "target": "OP03-OP01-050-sp",
        "correlation": 0.72,
        "edgeType": "POSITIVE"  // or NEGATIVE, NEUTRAL
      }
    ],
    "clusters": [
      {
        "id": "OP03",
        "name": "Romance Dawn",
        "cardCount": 45,
        "avgPrice": 28.50,
        "dealCount": 5,
        "sentiment": "BULLISH"
      }
    ],
    "dealOverlay": {
      "activeDeals": 24,
      "topOpportunity": {
        "cardId": "OP03-OP01-051-sp",
        "expectedReturn": 18.5
      }
    }
  }
```

---

## 4. Database Schema Elevation

### 4.1 New Tables Required

```sql
-- ============================================================================
-- NEURAL NETWORK TABLES
-- ============================================================================

-- Store model predictions with confidence intervals
CREATE TABLE neural_predictions (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    card_id TEXT NOT NULL,
    game TEXT NOT NULL DEFAULT 'onepiece',

    -- Predictions
    price_24h DECIMAL(10, 2),
    price_7d DECIMAL(10, 2),
    price_30d DECIMAL(10, 2),

    -- Confidence intervals
    confidence_24h DECIMAL(5, 4),  -- 0-1
    confidence_7d DECIMAL(5, 4),
    confidence_30d DECIMAL(5, 4),

    -- Model metadata
    model_version TEXT NOT NULL,
    feature_vector JSONB,  -- Stored for explainability

    -- Timestamps
    predicted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE,

    CONSTRAINT fk_card FOREIGN KEY (card_id) REFERENCES card_prices_v2(card_id)
);

CREATE INDEX idx_predictions_card ON neural_predictions(card_id, predicted_at DESC);
CREATE INDEX idx_predictions_expiry ON neural_predictions(expires_at) WHERE expires_at > NOW();


-- Store identified deals
CREATE TABLE neural_deals (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    card_id TEXT NOT NULL,
    game TEXT NOT NULL DEFAULT 'onepiece',

    -- Deal classification
    deal_type TEXT NOT NULL,  -- ARBITRAGE_CROSS_MARKET, etc.
    confidence DECIMAL(5, 4) NOT NULL,
    expected_return DECIMAL(8, 4) NOT NULL,
    time_horizon TEXT NOT NULL,  -- IMMEDIATE, SHORT, MEDIUM, LONG
    risk_level TEXT NOT NULL,  -- LOW, MEDIUM, HIGH

    -- Action details
    action_type TEXT NOT NULL,  -- BUY, SELL, HOLD
    buy_market TEXT,
    buy_price DECIMAL(10, 2),
    sell_market TEXT,
    sell_price DECIMAL(10, 2),

    -- Metadata
    metadata JSONB,
    feature_importance JSONB,

    -- Lifecycle
    status TEXT NOT NULL DEFAULT 'ACTIVE',  -- ACTIVE, EXECUTED, EXPIRED, CANCELLED
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    executed_at TIMESTAMP WITH TIME ZONE,
    actual_return DECIMAL(8, 4),  -- For model training feedback

    CONSTRAINT fk_card FOREIGN KEY (card_id) REFERENCES card_prices_v2(card_id)
);

CREATE INDEX idx_deals_card ON neural_deals(card_id);
CREATE INDEX idx_deals_type ON neural_deals(deal_type, status);
CREATE INDEX idx_deals_active ON neural_deals(status, expires_at) WHERE status = 'ACTIVE';
CREATE INDEX idx_deals_confidence ON neural_deals(confidence DESC) WHERE status = 'ACTIVE';


-- Store model training history
CREATE TABLE neural_model_history (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    model_version TEXT NOT NULL UNIQUE,

    -- Training metrics
    training_samples INT NOT NULL,
    validation_samples INT NOT NULL,
    deal_type_accuracy DECIMAL(5, 4),
    confidence_brier_score DECIMAL(5, 4),
    return_mae DECIMAL(5, 4),
    risk_f1_score DECIMAL(5, 4),

    -- Model weights (stored for rollback)
    weights_url TEXT,  -- S3 path to model weights

    -- Metadata
    trained_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deployed_at TIMESTAMP WITH TIME ZONE,
    retired_at TIMESTAMP WITH TIME ZONE,
    notes TEXT
);


-- API usage tracking for billing
CREATE TABLE api_usage (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    api_key_id TEXT NOT NULL,

    -- Request details
    endpoint TEXT NOT NULL,
    method TEXT NOT NULL,
    status_code INT NOT NULL,
    response_time_ms INT NOT NULL,

    -- Billing
    tier TEXT NOT NULL,
    billable_units INT NOT NULL DEFAULT 1,

    -- Metadata
    ip_address INET,
    user_agent TEXT,
    request_timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_usage_key ON api_usage(api_key_id, request_timestamp DESC);
CREATE INDEX idx_usage_billing ON api_usage(api_key_id, request_timestamp)
    WHERE request_timestamp >= DATE_TRUNC('month', NOW());


-- API keys for commercial access
CREATE TABLE api_keys (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,

    -- Key details
    key_hash TEXT NOT NULL UNIQUE,  -- SHA-256 of actual key
    key_prefix TEXT NOT NULL,  -- First 8 chars for identification
    name TEXT NOT NULL,

    -- Owner
    user_id TEXT,
    organization TEXT,
    email TEXT NOT NULL,

    -- Tier & limits
    tier TEXT NOT NULL DEFAULT 'developer',
    rate_limit_daily INT NOT NULL DEFAULT 1000,
    rate_limit_minute INT NOT NULL DEFAULT 60,

    -- Permissions
    allowed_endpoints TEXT[] NOT NULL DEFAULT ARRAY['*'],
    allowed_games TEXT[] NOT NULL DEFAULT ARRAY['onepiece'],

    -- Lifecycle
    status TEXT NOT NULL DEFAULT 'active',  -- active, suspended, revoked
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE,
    last_used_at TIMESTAMP WITH TIME ZONE,

    -- Billing
    stripe_customer_id TEXT,
    billing_email TEXT
);

CREATE INDEX idx_api_keys_hash ON api_keys(key_hash);
CREATE INDEX idx_api_keys_user ON api_keys(user_id);
CREATE INDEX idx_api_keys_status ON api_keys(status) WHERE status = 'active';
```

### 4.2 Enhanced Existing Tables

```sql
-- ============================================================================
-- ENHANCEMENTS TO EXISTING TABLES
-- ============================================================================

-- Add neural network fields to CardPriceV2
ALTER TABLE card_prices_v2 ADD COLUMN IF NOT EXISTS
    neural_score DECIMAL(5, 4);  -- Composite opportunity score 0-1

ALTER TABLE card_prices_v2 ADD COLUMN IF NOT EXISTS
    neural_updated_at TIMESTAMP WITH TIME ZONE;

ALTER TABLE card_prices_v2 ADD COLUMN IF NOT EXISTS
    has_active_deal BOOLEAN DEFAULT FALSE;


-- Add volume tracking to CardPriceHistory
ALTER TABLE card_price_history ADD COLUMN IF NOT EXISTS
    volume_estimate INT;  -- Estimated daily trade volume

ALTER TABLE card_price_history ADD COLUMN IF NOT EXISTS
    liquidity_score DECIMAL(5, 4);  -- 0-1 liquidity indicator


-- Add multi-source tracking to PriceSource
ALTER TABLE price_sources ADD COLUMN IF NOT EXISTS
    inventory_level TEXT;  -- IN_STOCK, LOW_STOCK, OUT_OF_STOCK

ALTER TABLE price_sources ADD COLUMN IF NOT EXISTS
    seller_rating DECIMAL(3, 2);  -- 0-5 seller rating

ALTER TABLE price_sources ADD COLUMN IF NOT EXISTS
    shipping_days INT;  -- Estimated shipping time
```

---

## 5. API Gateway Architecture

### 5.1 Gateway Design

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                           API GATEWAY ARCHITECTURE                                   │
└─────────────────────────────────────────────────────────────────────────────────────┘

                              ┌─────────────────────┐
                              │   CLOUDFLARE CDN    │
                              │   (Edge Caching)    │
                              └──────────┬──────────┘
                                         │
                              ┌──────────┴──────────┐
                              │   RATE LIMITER      │
                              │   (Redis-based)     │
                              │                     │
                              │  • Per-key limits   │
                              │  • Tier enforcement │
                              │  • Burst handling   │
                              └──────────┬──────────┘
                                         │
                              ┌──────────┴──────────┐
                              │   AUTH MIDDLEWARE   │
                              │                     │
                              │  • API key validate │
                              │  • JWT for sessions │
                              │  • Tier lookup      │
                              └──────────┬──────────┘
                                         │
              ┌──────────────────────────┼──────────────────────────┐
              │                          │                          │
              ▼                          ▼                          ▼
     ┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐
     │  PUBLIC ROUTES  │      │ PREMIUM ROUTES  │      │ NEURAL ROUTES   │
     │                 │      │                 │      │                 │
     │  /v1/health     │      │  /v1/tcg100     │      │  /v1/neural/*   │
     │  /v1/indices    │      │  /v1/bulk/*     │      │                 │
     │  /v1/cards/:id  │      │  /v1/webhooks   │      │  ML inference   │
     │  (delayed)      │      │  /v1/stream     │      │  Deal detection │
     └────────┬────────┘      └────────┬────────┘      └────────┬────────┘
              │                        │                        │
              └────────────────────────┼────────────────────────┘
                                       │
                              ┌────────┴────────┐
                              │   SHARD ROUTER  │
                              │                 │
                              │  • Game routing │
                              │  • Read replica │
                              │  • Failover     │
                              └────────┬────────┘
                                       │
              ┌────────────────────────┼────────────────────────┐
              │                        │                        │
              ▼                        ▼                        ▼
     ┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐
     │  RDS: One Piece │      │  RDS: Pokemon   │      │  RDS: Other     │
     │  (Primary)      │      │  (Shard)        │      │  (Shards)       │
     └─────────────────┘      └─────────────────┘      └─────────────────┘
```

### 5.2 Authentication Flow

```typescript
// ============================================================================
// API KEY AUTHENTICATION
// ============================================================================

interface ApiKeyAuth {
  keyId: string;
  tier: 'public' | 'developer' | 'professional' | 'enterprise' | 'neural';
  rateLimit: {
    daily: number;
    minute: number;
    remaining: number;
    resetAt: Date;
  };
  permissions: {
    endpoints: string[];
    games: string[];
    maxHistoryDays: number;
    bulkAccess: boolean;
    webhooks: boolean;
    streaming: boolean;
    neuralAccess: boolean;
  };
}

async function authenticateRequest(request: Request): Promise<ApiKeyAuth> {
  const apiKey = request.headers.get('X-API-Key');

  if (!apiKey) {
    // Public tier - delayed data only
    return {
      keyId: 'public',
      tier: 'public',
      rateLimit: { daily: 100, minute: 10, remaining: 100, resetAt: new Date() },
      permissions: {
        endpoints: ['/v1/health', '/v1/indices', '/v1/cards/:id'],
        games: ['onepiece'],
        maxHistoryDays: 0,
        bulkAccess: false,
        webhooks: false,
        streaming: false,
        neuralAccess: false,
      },
    };
  }

  // Validate key and return permissions
  const keyHash = sha256(apiKey);
  const keyRecord = await prisma.apiKey.findUnique({
    where: { keyHash },
  });

  if (!keyRecord || keyRecord.status !== 'active') {
    throw new ApiError(401, 'Invalid API key');
  }

  // Check rate limits
  const usage = await getRateLimitUsage(keyRecord.id);
  if (usage.daily >= keyRecord.rateLimitDaily) {
    throw new ApiError(429, 'Daily rate limit exceeded');
  }

  return mapKeyToAuth(keyRecord, usage);
}
```

### 5.3 Caching Strategy

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                           MULTI-LAYER CACHING                                        │
└─────────────────────────────────────────────────────────────────────────────────────┘

  LAYER 1: EDGE CACHE (Cloudflare)
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  • Static responses: 5 minutes
  • Index values: 1 minute
  • Card data: 5 minutes (delayed tier)

  Headers:
  Cache-Control: public, max-age=60, s-maxage=300
  Vary: X-API-Key (tier-specific caching)


  LAYER 2: APPLICATION CACHE (Redis)
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  • Index calculations: 5 minutes
  • Card history: 1 hour
  • Neural predictions: 30 minutes
  • Deal list: 5 minutes

  Keys:
  - cache:index:{type}:{key}:{game}
  - cache:card:{cardId}:history:{days}
  - cache:neural:predictions:{cardId}
  - cache:neural:deals:{game}


  LAYER 3: DATABASE MATERIALIZED VIEWS
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  • Daily aggregates: Refreshed at midnight
  • TCG-100 constituents: Refreshed on demand
  • Correlation matrix: Refreshed weekly

  Views:
  - mv_daily_index_values
  - mv_tcg100_current
  - mv_price_correlations
```

---

## 6. Elevation Roadmap

### 6.1 Phase Timeline

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                           ELEVATION ROADMAP                                          │
└─────────────────────────────────────────────────────────────────────────────────────┘

  2026 Q1                 2026 Q2                 2026 Q3                 2026 Q4
  ────────────────────────────────────────────────────────────────────────────────────►

  ┌──────────────────┐
  │  PHASE 1         │
  │  API Foundation  │
  │                  │
  │  • API Gateway   │
  │  • Auth system   │
  │  • Rate limiting │
  │  • Tier 0-2      │
  │                  │
  │  Duration: 6 wks │
  └────────┬─────────┘
           │
           └───────────┐
                       ▼
              ┌──────────────────┐
              │  PHASE 2         │
              │  Commercial      │
              │                  │
              │  • Stripe billing│
              │  • Tier 3        │
              │  • Webhooks      │
              │  • Documentation │
              │                  │
              │  Duration: 4 wks │
              └────────┬─────────┘
                       │
                       └───────────┐
                                   ▼
                          ┌──────────────────┐
                          │  PHASE 3         │
                          │  Neural Network  │
                          │                  │
                          │  • Feature eng.  │
                          │  • Model train   │
                          │  • Deal detection│
                          │  • Tier 4        │
                          │                  │
                          │  Duration: 8 wks │
                          └────────┬─────────┘
                                   │
                                   └───────────┐
                                               ▼
                                      ┌──────────────────┐
                                      │  PHASE 4         │
                                      │  Scale & Expand  │
                                      │                  │
                                      │  • Multi-TCG     │
                                      │  • WebSocket     │
                                      │  • Mobile SDK    │
                                      │  • Enterprise    │
                                      │                  │
                                      │  Duration: 8 wks │
                                      └──────────────────┘
```

### 6.2 Technical Milestones

| Milestone | Deliverables | Success Metrics |
|-----------|--------------|-----------------|
| **M1: API Gateway** | Auth, rate limiting, key management | 99.9% uptime, <100ms p95 latency |
| **M2: Billing** | Stripe integration, usage tracking | First paying customer |
| **M3: Documentation** | OpenAPI spec, SDK, tutorials | >50 developer signups |
| **M4: Neural v1** | Price predictions, anomaly detection | >80% deal accuracy |
| **M5: Neural v2** | Full deal identification | 10 profitable deals/week identified |
| **M6: Multi-TCG** | Pokemon, MTG shards live | 3 games with full coverage |
| **M7: Enterprise** | SLA, dedicated support, custom integrations | 5 enterprise customers |

---

## 7. Risk Analysis

### 7.1 Technical Risks

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Data source discontinuation | HIGH | LOW | Multi-source redundancy, scraping fallback |
| Model accuracy degradation | MEDIUM | MEDIUM | Continuous retraining, A/B testing |
| Database scaling limits | MEDIUM | LOW | Sharding ready, TimescaleDB migration path |
| API abuse/scraping | LOW | HIGH | Rate limiting, IP blocking, CAPTCHA |
| Real-time latency | MEDIUM | MEDIUM | Edge caching, WebSocket optimization |

### 7.2 Business Risks

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Competition enters market | MEDIUM | HIGH | First-mover advantage, unique neural features |
| TCG market downturn | HIGH | LOW | Multi-TCG diversification |
| Regulatory changes | LOW | LOW | Legal review, ToS compliance |
| Pricing resistance | MEDIUM | MEDIUM | Free tier, value demonstration |

---

## 8. Key Success Metrics

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                           SUCCESS METRICS DASHBOARD                                  │
└─────────────────────────────────────────────────────────────────────────────────────┘

  TECHNICAL METRICS
  ━━━━━━━━━━━━━━━━━

  API Performance
  ├── P50 Latency:      <50ms
  ├── P95 Latency:      <200ms
  ├── P99 Latency:      <500ms
  ├── Error Rate:       <0.1%
  └── Uptime:           99.9%

  Data Quality
  ├── Price Freshness:  <4 hours
  ├── Coverage:         >95% of tradeable cards
  ├── Source Diversity: 3+ sources per card
  └── History Depth:    365+ days


  NEURAL NETWORK METRICS
  ━━━━━━━━━━━━━━━━━━━━━━

  Model Performance
  ├── Deal Type Accuracy:     >85%
  ├── Confidence Calibration: Brier <0.15
  ├── Return MAE:             <5%
  └── False Positive Rate:    <10%

  Deal Outcomes
  ├── Deals Identified:       >50/week
  ├── Profitable Deals:       >70%
  ├── Avg Return on Winners:  >15%
  └── User-Executed Deals:    >30%


  BUSINESS METRICS
  ━━━━━━━━━━━━━━━━

  Adoption
  ├── API Keys Created:       Target: 500 Year 1
  ├── Paying Customers:       Target: 100 Year 1
  ├── Enterprise Customers:   Target: 10 Year 1
  └── Daily Active Keys:      Target: 50%

  Revenue
  ├── MRR:                    Target: $10K Month 6
  ├── ARR:                    Target: $100K Year 1
  ├── Churn Rate:             Target: <5%/month
  └── LTV:CAC Ratio:          Target: >3:1
```

---

## 9. Conclusion

The CardForum price data infrastructure represents a significant opportunity to become the **authoritative price discovery and intelligence platform** for the global TCG market. The combination of:

1. **Multi-source price aggregation** - Unique dataset from 6+ sources
2. **Historical depth** - 346+ days of daily snapshots
3. **Neural network intelligence** - AI-powered deal identification
4. **Multi-TCG scalability** - Sharding infrastructure ready

Creates a defensible moat that competitors would need years to replicate.

**Recommended Next Steps:**

1. **Immediate (Week 1-2):** Deploy API key management and rate limiting
2. **Short-term (Month 1):** Launch Tier 0-2 with Stripe billing
3. **Medium-term (Month 2-3):** Train and deploy Neural v1 model
4. **Long-term (Month 4-6):** Scale to multi-TCG with enterprise features

**Investment Required:**
- Engineering: 400-500 hours
- Infrastructure: +$100-200/month (Redis, increased RDS)
- ML Training: GPU compute ~$50-100

**Expected ROI:**
- Break-even: Month 4-5
- Year 1 ARR: $95K-100K (conservative)
- Year 3 ARR: $1M+ (with multi-TCG expansion)

---

*Generated: 2026-01-07*
*Analysis Method: Deep Strategic Meditation*
*Classification: Internal Strategy Document*
