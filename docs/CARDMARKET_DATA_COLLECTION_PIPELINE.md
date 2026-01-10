# CardMarket Data Collection Pipeline for One Piece TCG

**Date:** 2026-01-09
**Status:** Research Complete, Ready for Implementation
**Purpose:** Comprehensive analysis of TCGdex API and alternative CardMarket data sources for One Piece TCG model training

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [TCGdex API Deep Dive](#2-tcgdex-api-deep-dive)
3. [Alternative CardMarket Data Sources](#3-alternative-cardmarket-data-sources)
4. [API Comparison Matrix](#4-api-comparison-matrix)
5. [Recommended Data Collection Stack](#5-recommended-data-collection-stack)
6. [Collection Pipeline Architecture](#6-collection-pipeline-architecture)
7. [Data Schema & Storage](#7-data-schema--storage)
8. [Model Training Data Mapping](#8-model-training-data-mapping)
9. [Implementation Roadmap](#9-implementation-roadmap)

---

## 1. Executive Summary

### Critical Finding: TCGdex Does NOT Support One Piece TCG

**TCGdex API (tcgdex.dev) is Pokemon-only.** Despite its excellent CardMarket integration and pricing data, it cannot be used for One Piece TCG data collection.

### Recommended Alternative Stack for One Piece TCG

| API | CardMarket Data | Historical Depth | Cost | Rate Limit |
|-----|-----------------|------------------|------|------------|
| **OPTCG API** | No (TCGplayer only) | 14 days | Free | Reasonable use |
| **JustTCG API** | No (TCGplayer only) | 180 days | Free-$50/mo | 100-50K/mo |
| **Apify Scrapers** | Yes (direct scrape) | Current only | Pay-per-use | Per actor |
| **Official CM Download** | Yes (price guide) | Current only | Free | Daily file |

### Key Insight

For **CardMarket EUR prices** specifically for One Piece TCG, we must either:
1. Use Apify scrapers (pay-per-use, no historical)
2. Download official Cardmarket price guide CSV (daily snapshot)
3. Build custom scraper (legal considerations)
4. Wait for cardmarket-api.com to add One Piece support

For **comprehensive price data**, combine:
- **OPTCG API** (free, 14-day history, TCGplayer)
- **JustTCG API** (180-day history, US prices)
- **Cardmarket CSV downloads** (daily EU prices)

---

## 2. TCGdex API Deep Dive

### 2.1 Overview

```yaml
API_IDENTITY:
  name: TCGdex
  url: https://tcgdex.dev
  documentation: https://tcgdex.dev/reference/card
  base_url: https://api.tcgdex.net/v2/{lang}/cards/{id}

SUPPORTED_GAMES:
  - Pokemon TCG ONLY

ONE_PIECE_SUPPORT: false  # CRITICAL: Does NOT support One Piece TCG
```

### 2.2 CardMarket Price Data Structure (Pokemon Reference)

Even though TCGdex doesn't support One Piece, its CardMarket data structure is exemplary:

```json
{
  "pricing": {
    "cardmarket": {
      "updated": "2025-08-05T00:42:15.000Z",
      "unit": "EUR",
      "avg": 12.50,
      "low": 8.99,
      "trend": 11.75,
      "avg1": 12.30,
      "avg7": 12.15,
      "avg30": 11.90,
      "avg-holo": 45.00,
      "low-holo": 35.00,
      "trend-holo": 42.50,
      "avg1-holo": 44.50,
      "avg7-holo": 43.80,
      "avg30-holo": 41.20
    },
    "tcgplayer": {
      "updated": "2025-08-05T12:00:00.000Z",
      "unit": "USD",
      "normal": {
        "lowPrice": 9.99,
        "midPrice": 12.50,
        "highPrice": 18.00,
        "marketPrice": 11.75,
        "directLowPrice": 10.50
      },
      "holofoil": {
        "lowPrice": 39.99,
        "midPrice": 48.00,
        "highPrice": 65.00,
        "marketPrice": 45.50,
        "directLowPrice": 42.00
      }
    }
  }
}
```

### 2.3 TCGdex Capabilities (For Pokemon Reference)

```yaml
FEATURES:
  authentication: none  # Completely free, no API key
  rate_limit: undocumented  # "10M+ requests/month served"
  languages: 14  # EN, FR, DE, ES, IT, PT, JP, KO, ZH, etc.

  price_data:
    cardmarket:
      currency: EUR
      update_frequency: daily
      fields:
        - avg (average sale price)
        - low (lowest listing)
        - trend (trend price)
        - avg1 (1-day average)
        - avg7 (7-day average)
        - avg30 (30-day average)
      variants:
        - non-foil (standard)
        - holo (all foil variants)

    tcgplayer:
      currency: USD
      update_frequency: hourly to daily
      fields:
        - lowPrice
        - midPrice
        - highPrice
        - marketPrice
        - directLowPrice
      variants:
        - normal
        - holofoil
        - reverseHolofoil
        - 1stEdition (where applicable)

ENDPOINTS:
  cards:
    - GET /v2/{lang}/cards                    # List all cards
    - GET /v2/{lang}/cards/{id}               # Single card with prices
    - GET /v2/{lang}/cards?name={query}       # Search by name

  sets:
    - GET /v2/{lang}/sets                     # List all sets
    - GET /v2/{lang}/sets/{id}                # Set details
    - GET /v2/{lang}/sets/{id}/cards          # All cards in set

HISTORICAL_DATA:
  available: partial
  depth: 1, 7, 30 days via avg1/avg7/avg30
  granularity: daily averages only
  raw_history: NOT available (no time series)
```

### 2.4 Why TCGdex Pattern Matters

The TCGdex CardMarket integration pattern is **exactly what we need** for One Piece:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     IDEAL DATA STRUCTURE FOR ARBITRAGE                       │
└─────────────────────────────────────────────────────────────────────────────┘

Card: OP01-121 Roronoa Zoro (SP)

├── CardMarket (EUR) - European market
│   ├── avg: €38.50 (average sale)
│   ├── low: €32.00 (lowest listing - BUY signal)
│   ├── trend: €37.80 (trend price)
│   ├── avg1: €39.00 (yesterday's average)
│   ├── avg7: €36.50 (weekly average)
│   └── avg30: €34.20 (monthly average - baseline)
│
├── TCGplayer (USD) - US market
│   ├── marketPrice: $48.50
│   ├── lowPrice: $42.00
│   ├── midPrice: $47.00
│   └── directLowPrice: $44.00
│
└── Arbitrage Signal
    ├── CM low → TCG market = €32 → $48.50 (51.5% gross)
    ├── After fees & shipping: ~22% net spread
    └── EXECUTE if net > 15% threshold
```

---

## 3. Alternative CardMarket Data Sources

### 3.1 OPTCG API (optcgapi.com)

**Best free option for One Piece TCG, but NO CardMarket data.**

```yaml
API_IDENTITY:
  name: OPTCG API
  url: https://optcgapi.com
  base_url: https://optcgapi.com/api/

CRITICAL_LIMITATION: TCGplayer prices ONLY - no CardMarket EUR data

CAPABILITIES:
  authentication: none
  rate_limit: undefined (asks for "reasonable use")
  cost: free

  supported_content:
    - All booster sets (OP-01 through current)
    - Starter decks (ST-01 through ST-21+)
    - Promotional cards

  price_data:
    source: TCGplayer
    fields:
      - inventory_price (decimal)
      - market_price (decimal)
    update_frequency: daily (date_scraped field)

  historical_data:
    available: true
    depth: 14 days
    endpoints:
      - /api/sets/card/twoweeks/{card_id}/
      - /api/decks/card/twoweeks/{card_id}/
      - /api/promos/card/twoweeks/{card_id}/
    fields:
      - Day1_Inventory_Price through Day13_Inventory_Price
      - Day1_Market_Price through Day13_Market_Price

ENDPOINTS:
  sets:
    - GET /api/allSets/                       # All set names/IDs
    - GET /api/allSetCards/                   # All cards from sets
    - GET /api/sets/{set_id}/                 # Cards in specific set
    - GET /api/sets/card/{card_id}/           # Single card
    - GET /api/sets/filtered/                 # Filter by params
    - GET /api/sets/card/twoweeks/{card_id}/  # 14-day price history

  starter_decks:
    - GET /api/allDecks/
    - GET /api/allSTCards/
    - GET /api/decks/{st_id}/
    - GET /api/decks/card/{card_id}/
    - GET /api/decks/card/twoweeks/{card_id}/

  promos:
    - GET /api/allPromoCards/
    - GET /api/promos/filtered/
    - GET /api/promos/card/{card_id}/
    - GET /api/promos/card/twoweeks/{card_id}/

RESPONSE_SCHEMA:
  card_object:
    card_name: string
    set_name: string
    set_id: string
    card_set_id: string
    rarity: string
    card_color: string
    card_type: string
    card_cost: string
    card_power: string
    life: string
    counter_amount: string
    attribute: string
    sub_types: string
    card_text: string
    inventory_price: decimal
    market_price: decimal
    date_scraped: date
    card_image_id: string
    card_image: url
```

### 3.2 JustTCG API

**Best for deep historical data (180 days), but US prices only.**

```yaml
API_IDENTITY:
  name: JustTCG
  url: https://justtcg.com
  documentation: https://justtcg.com/docs
  base_url: https://api.justtcg.com/v1/

ONE_PIECE_SUPPORT: true (game ID: "one-piece-card-game")

CAPABILITIES:
  authentication: API key (x-api-key header)

  rate_limits:
    free:
      monthly: 1,000
      daily: 100
      per_minute: 10
    starter:
      monthly: 10,000
      daily: 1,000
      per_minute: 50
    professional:
      monthly: 50,000
      daily: 5,000
      per_minute: 100
    enterprise:
      monthly: 500,000
      daily: 50,000
      per_minute: 500

  pricing:
    free: $0
    starter: ~$10/mo
    professional: ~$30/mo
    enterprise: ~$100/mo

CRITICAL_NOTE:
  price_source: TCGplayer ONLY (US market)
  cardmarket_data: NOT available

HISTORICAL_DATA:
  available: true
  depth: up to 180 days
  parameter: priceHistoryDuration (7d, 30d, 90d, 180d)
  format:
    priceHistory:
      - p: price (float)
        t: timestamp (unix)
      - ...

PRICE_STATISTICS:
  - current price
  - 24h change %
  - 7d change %
  - 30d change %
  - 90d change %
  - average price
  - min/max prices
  - standard deviation
  - coefficient of variation
  - interquartile range
  - trend slope
  - all-time high/low with timestamps

ENDPOINTS:
  games:
    - GET /v1/games                           # List all games

  sets:
    - GET /v1/sets                            # List sets
    - GET /v1/sets?game=one-piece-card-game   # One Piece sets

  cards:
    - GET /v1/cards?id={card_id}              # Direct lookup
    - GET /v1/cards?game=one-piece-card-game&set={set}&search={query}
    - POST /v1/cards                          # Batch lookup (array of IDs)

  query_params:
    - include_price_history: boolean
    - priceHistoryDuration: "7d" | "30d" | "90d" | "180d"
    - include_statistics: boolean
    - orderBy: "price" | "24h" | "7d" | "30d"
    - order: "asc" | "desc"
```

### 3.3 Apify CardMarket Scrapers

**Only option for actual CardMarket EUR data for One Piece.**

```yaml
SCRAPERS:
  cardmarket_trend_scraper:
    url: https://apify.com/ecomscrape/cardmarket-trend-scraper
    description: Weekly top cards, prices, market data
    one_piece_support: true

  cardmarket_card_details:
    url: https://apify.com/ecomscrape/cardmarket-card-page-details-scraper
    description: Individual card listing pages
    one_piece_support: true
    data_extracted:
      - pricing
      - seller information
      - product details
      - market statistics

PRICING_MODEL:
  type: pay-per-result
  cost: varies by actor
  typical: $0.001 - $0.01 per card scraped

LIMITATIONS:
  - No historical data (current prices only)
  - Must run scrape jobs periodically
  - Subject to Cardmarket ToS
  - Rate limited by Apify

USE_CASE:
  - Supplement TCGplayer data with EU prices
  - Build historical archive by daily runs
  - Spot-check arbitrage opportunities
```

### 3.4 Official Cardmarket Price Guide Downloads

**Free official data, but limited.**

```yaml
SOURCE:
  url: https://www.cardmarket.com/Data/Download
  type: CSV files

AVAILABILITY:
  games: "all games" (One Piece included)
  access: free (was API-only, now public)

DATA_INCLUDED:
  price_guide:
    update_frequency: daily
    fields: (not fully documented)
      - product_id
      - name
      - expansion
      - trend_price
      - avg_sell_price
      - low_price (estimated)

  product_catalogue:
    update_frequency: on new releases
    fields:
      - product metadata
      - set information

LIMITATIONS:
  - No historical data archive
  - Daily snapshots only
  - Must download manually or automate
  - Field documentation sparse

STRATEGY:
  - Daily automated download at 4 AM UTC
  - Store in database with timestamp
  - Build historical archive over time
```

### 3.5 cardmarket-api.com (Third-Party)

**Promising but One Piece NOT YET AVAILABLE.**

```yaml
API_IDENTITY:
  name: CardMarket API (third-party)
  url: http://cardmarket-api.com
  provider: via RapidAPI

ONE_PIECE_STATUS: "Soon" (not yet implemented)

WHEN_AVAILABLE:
  features:
    - Combined EU + US prices
    - Country-specific (DE, FR, ES, IT)
    - Graded prices (PSA, CGC, Beckett)
    - 7d and 30d averages

  rate_limits:
    basic: 100/day, 30/min (free)
    pro: 3,000/day, 300/min ($9.90/mo)
    ultra: 15,000/day, 300/min ($24.90/mo)
    mega: 50,000/day, 600/min ($49.50/mo)
    enterprise: 1M/day (custom pricing)

MONITOR:
  - Check monthly for One Piece support
  - Best future option when available
```

---

## 4. API Comparison Matrix

### 4.1 Feature Comparison

```
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                              API FEATURE COMPARISON FOR ONE PIECE TCG                         │
├────────────────────┬──────────────┬─────────────┬──────────────┬──────────────┬─────────────┤
│ Feature            │ OPTCG API    │ JustTCG     │ Apify        │ CM Download  │ CM-API.com  │
├────────────────────┼──────────────┼─────────────┼──────────────┼──────────────┼─────────────┤
│ One Piece Support  │ ✓ Full       │ ✓ Full      │ ✓ Full       │ ✓ Full       │ ✗ Coming    │
│ CardMarket EUR     │ ✗ No         │ ✗ No        │ ✓ Yes        │ ✓ Yes        │ ✓ Yes       │
│ TCGplayer USD      │ ✓ Yes        │ ✓ Yes       │ ✗ No         │ ✗ No         │ ✓ Yes       │
│ Historical Data    │ 14 days      │ 180 days    │ ✗ No         │ ✗ No         │ 30 days     │
│ Authentication     │ None         │ API key     │ Account      │ None         │ RapidAPI    │
│ Cost               │ Free         │ $0-100/mo   │ Pay-per-use  │ Free         │ $0-50/mo    │
│ Rate Limit         │ Reasonable   │ 100-50K/mo  │ By plan      │ 1/day        │ 100-50K/day │
│ Real-time Updates  │ Daily        │ Daily       │ On-demand    │ Daily        │ Multiple/day│
│ Graded Prices      │ ✗ No         │ ✗ No        │ Partial      │ ✗ No         │ ✓ Yes       │
│ Variant Support    │ Limited      │ Good        │ Full         │ Full         │ Full        │
└────────────────────┴──────────────┴─────────────┴──────────────┴──────────────┴─────────────┘
```

### 4.2 Data Completeness for Arbitrage

```
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                              DATA REQUIREMENTS FOR M8 ARBITRAGE DETECTOR                      │
├────────────────────┬────────────────────────────────────────────────────────────────────────┤
│ Requirement        │ Solution                                                                │
├────────────────────┼────────────────────────────────────────────────────────────────────────┤
│ US Market Prices   │ OPTCG API (free) + JustTCG (historical)                                │
│ EU Market Prices   │ Apify scrapers + Cardmarket CSV downloads                              │
│ Price History      │ JustTCG (180d US) + self-collected CM archive                          │
│ FX Rates           │ Any forex API (openexchangerates.org)                                  │
│ Cross-Market Pairs │ Combine US + EU sources programmatically                               │
└────────────────────┴────────────────────────────────────────────────────────────────────────┘
```

---

## 5. Recommended Data Collection Stack

### 5.1 Primary Stack Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    ONE PIECE TCG DATA COLLECTION STACK                        │
└─────────────────────────────────────────────────────────────────────────────┘

LAYER 1: US MARKET (TCGplayer)
├── OPTCG API (Primary - Free)
│   ├── Frequency: Every 4 hours
│   ├── Data: inventory_price, market_price
│   ├── History: 14-day via /twoweeks/ endpoints
│   └── Coverage: All sets, decks, promos
│
└── JustTCG API (Supplementary - $30/mo Pro)
    ├── Frequency: Daily
    ├── Data: Full price statistics, 180-day history
    ├── Use: Deep historical analysis, trend detection
    └── Backup: If OPTCG API unavailable

LAYER 2: EU MARKET (CardMarket)
├── Cardmarket CSV Download (Primary - Free)
│   ├── Frequency: Daily at 4 AM UTC
│   ├── Data: Trend, avg, low prices
│   ├── Storage: Archive with timestamp
│   └── History: Self-built from daily downloads
│
└── Apify Scrapers (Supplementary - Pay-per-use)
    ├── Frequency: Hourly for hot cards (top 100)
    ├── Data: Real-time listings, seller data
    ├── Use: Arbitrage execution timing
    └── Cost: ~$50-100/mo estimated

LAYER 3: SUPPORTING DATA
├── Exchange Rates API
│   ├── Source: openexchangerates.org
│   ├── Frequency: Hourly
│   └── Pairs: EUR/GBP, USD/GBP, JPY/GBP
│
└── Existing Lambda (trading-card-pricer)
    ├── Frequency: 8 AM / 8 PM UTC
    ├── Data: OPTCG API prices
    └── Table: card_prices_v2
```

### 5.2 Collection Schedule

```yaml
COLLECTION_SCHEDULE:
  every_hour:
    - Exchange rates (forex API)
    - Hot card prices (Apify) - top 50 cards only

  every_4_hours:
    - OPTCG API full sync (all cards)
    - Match with existing card_prices_v2

  daily_4am_utc:
    - Cardmarket CSV download
    - Parse and store in cardmarket_prices table
    - Calculate daily deltas

  daily_6am_utc:
    - JustTCG API sync
    - 180-day history for top 200 cards
    - Update trend/statistics

  weekly_sunday:
    - Full Apify scrape (all One Piece cards)
    - Validate against other sources
    - Data quality report

  on_demand:
    - Arbitrage opportunity verification
    - Real-time price check before execution
```

### 5.3 Cost Breakdown

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         MONTHLY COST ESTIMATE                                 │
├──────────────────────────────────────┬──────────────────────────────────────┤
│ Service                               │ Monthly Cost                          │
├──────────────────────────────────────┼──────────────────────────────────────┤
│ OPTCG API                            │ $0 (free)                             │
│ JustTCG API (Professional)           │ $30                                   │
│ Cardmarket CSV Download              │ $0 (free)                             │
│ Apify Scrapers (~5000 runs)          │ $50-100                               │
│ Exchange Rate API                    │ $0-12                                 │
│ AWS Lambda (existing)                │ Included                              │
├──────────────────────────────────────┼──────────────────────────────────────┤
│ TOTAL                                │ $80-142/month                         │
└──────────────────────────────────────┴──────────────────────────────────────┘
```

---

## 6. Collection Pipeline Architecture

### 6.1 System Design

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        DATA COLLECTION PIPELINE                               │
└─────────────────────────────────────────────────────────────────────────────┘

                    ┌─────────────────────────────────────┐
                    │          SCHEDULER (EventBridge)     │
                    │  ├── Hourly: FX rates, hot cards     │
                    │  ├── 4-hourly: OPTCG full sync       │
                    │  ├── Daily: CM CSV, JustTCG          │
                    │  └── Weekly: Full Apify scrape       │
                    └────────────────┬────────────────────┘
                                     │
              ┌──────────────────────┼──────────────────────┐
              │                      │                      │
              ▼                      ▼                      ▼
     ┌────────────────┐    ┌────────────────┐    ┌────────────────┐
     │  US COLLECTOR  │    │  EU COLLECTOR  │    │  FX COLLECTOR  │
     │  (Lambda)      │    │  (Lambda)      │    │  (Lambda)      │
     └───────┬────────┘    └───────┬────────┘    └───────┬────────┘
             │                     │                     │
             ▼                     ▼                     ▼
     ┌────────────────┐    ┌────────────────┐    ┌────────────────┐
     │ OPTCG API      │    │ CM CSV Parser  │    │ Forex API      │
     │ JustTCG API    │    │ Apify Client   │    │ Rate Store     │
     └───────┬────────┘    └───────┬────────┘    └───────┬────────┘
             │                     │                     │
             └─────────────────────┼─────────────────────┘
                                   │
                                   ▼
                    ┌─────────────────────────────────────┐
                    │          PRICE AGGREGATOR            │
                    │  ├── Normalize currencies (to GBP)   │
                    │  ├── Match card IDs across sources   │
                    │  ├── Calculate spreads               │
                    │  └── Detect anomalies                │
                    └────────────────┬────────────────────┘
                                     │
                                     ▼
                    ┌─────────────────────────────────────┐
                    │          POSTGRES (RDS)              │
                    │  ├── market_prices_us                │
                    │  ├── market_prices_eu                │
                    │  ├── fx_rates                        │
                    │  ├── price_history                   │
                    │  └── arbitrage_opportunities         │
                    └────────────────┬────────────────────┘
                                     │
              ┌──────────────────────┼──────────────────────┐
              │                      │                      │
              ▼                      ▼                      ▼
     ┌────────────────┐    ┌────────────────┐    ┌────────────────┐
     │  ML TRAINING   │    │  ARBITRAGE     │    │  DASHBOARD     │
     │  DATA EXPORT   │    │  DETECTOR      │    │  DISPLAY       │
     └────────────────┘    └────────────────┘    └────────────────┘
```

### 6.2 Lambda Function Implementations

```typescript
// US Market Collector (OPTCG API + JustTCG)
// File: infrastructure/lambdas/us-price-collector/handler.ts

interface OPTCGCard {
  card_name: string;
  set_id: string;
  card_set_id: string;
  inventory_price: number;
  market_price: number;
  date_scraped: string;
}

interface JustTCGCard {
  id: string;
  name: string;
  price: number;
  priceHistory?: { p: number; t: number }[];
  statistics?: {
    change24h: number;
    change7d: number;
    change30d: number;
    avg: number;
    stdDev: number;
    trendSlope: number;
  };
}

export async function collectUSPrices(): Promise<void> {
  // 1. Fetch from OPTCG API (all cards)
  const optcgCards = await fetchOPTCGAllCards();

  // 2. Fetch from JustTCG (top 200 with history)
  const justTCGCards = await fetchJustTCGWithHistory({
    game: 'one-piece-card-game',
    limit: 200,
    orderBy: 'price',
    order: 'desc',
    priceHistoryDuration: '180d',
    includeStatistics: true,
  });

  // 3. Merge and normalize
  const mergedPrices = mergeUSPrices(optcgCards, justTCGCards);

  // 4. Store in database
  await storeUSPrices(mergedPrices);

  // 5. Update price history
  await updatePriceHistory('US', mergedPrices);
}
```

```typescript
// EU Market Collector (Cardmarket)
// File: infrastructure/lambdas/eu-price-collector/handler.ts

interface CardmarketPrice {
  productId: string;
  name: string;
  expansion: string;
  trendPrice: number;
  avgSellPrice: number;
  lowPrice: number;
  updatedAt: Date;
}

export async function collectEUPrices(): Promise<void> {
  // 1. Download Cardmarket CSV
  const csvBuffer = await downloadCardmarketCSV('onepiece');

  // 2. Parse CSV
  const cmPrices = parseCardmarketCSV(csvBuffer);

  // 3. Map to internal card IDs
  const mappedPrices = await mapToInternalIds(cmPrices);

  // 4. Store in database
  await storeEUPrices(mappedPrices);

  // 5. Update price history
  await updatePriceHistory('EU', mappedPrices);

  // 6. For hot cards, get real-time via Apify
  if (isHotCardsSchedule()) {
    const hotCards = await getHotCards(50);
    const apifyPrices = await scrapeApifyRealtime(hotCards);
    await updateRealtimePrices(apifyPrices);
  }
}
```

### 6.3 Price Aggregation Logic

```typescript
// Price Aggregator Service
// File: app/lib/ml/data/price-aggregator.server.ts

interface AggregatedPrice {
  cardId: string;
  timestamp: Date;

  // US Market (TCGplayer)
  us: {
    source: 'optcg' | 'justtcg';
    marketPrice: number;      // USD
    lowPrice: number;         // USD
    marketPriceGBP: number;   // Converted
    lowPriceGBP: number;      // Converted
    change24h?: number;
    change7d?: number;
    change30d?: number;
  };

  // EU Market (Cardmarket)
  eu: {
    source: 'cardmarket' | 'apify';
    trendPrice: number;       // EUR
    lowPrice: number;         // EUR
    avgPrice: number;         // EUR
    trendPriceGBP: number;    // Converted
    lowPriceGBP: number;      // Converted
  };

  // Calculated arbitrage
  arbitrage: {
    spreadEUtoUS: number;     // Buy EU, sell US
    spreadUStoEU: number;     // Buy US, sell EU
    bestDirection: 'EU_TO_US' | 'US_TO_EU' | 'NONE';
    grossSpread: number;
    estimatedNetSpread: number;
  };
}

export function calculateArbitrage(
  usPrice: USPrice,
  euPrice: EUPrice,
  fxRates: FXRates
): AggregatedPrice['arbitrage'] {
  // Convert to common currency (GBP)
  const usLowGBP = usPrice.lowPrice * fxRates.USDGBP;
  const euLowGBP = euPrice.lowPrice * fxRates.EURGBP;

  const usMarketGBP = usPrice.marketPrice * fxRates.USDGBP;
  const euTrendGBP = euPrice.trendPrice * fxRates.EURGBP;

  // Calculate spreads
  // EU to US: Buy at EU low, sell at US market
  const spreadEUtoUS = (usMarketGBP - euLowGBP) / euLowGBP;

  // US to EU: Buy at US low, sell at EU trend
  const spreadUStoEU = (euTrendGBP - usLowGBP) / usLowGBP;

  // Determine best direction
  let bestDirection: 'EU_TO_US' | 'US_TO_EU' | 'NONE' = 'NONE';
  let grossSpread = 0;

  if (spreadEUtoUS > spreadUStoEU && spreadEUtoUS > 0.1) {
    bestDirection = 'EU_TO_US';
    grossSpread = spreadEUtoUS;
  } else if (spreadUStoEU > spreadEUtoUS && spreadUStoEU > 0.1) {
    bestDirection = 'US_TO_EU';
    grossSpread = spreadUStoEU;
  }

  // Estimate net spread after fees/shipping
  const fees = estimateFees(bestDirection);
  const estimatedNetSpread = grossSpread - fees;

  return {
    spreadEUtoUS,
    spreadUStoEU,
    bestDirection,
    grossSpread,
    estimatedNetSpread,
  };
}
```

---

## 7. Data Schema & Storage

### 7.1 Database Schema

```sql
-- Market prices from US sources (TCGplayer)
CREATE TABLE market_prices_us (
  id SERIAL PRIMARY KEY,
  card_id VARCHAR(50) NOT NULL,
  source VARCHAR(20) NOT NULL, -- 'optcg' | 'justtcg'

  -- Prices in USD
  market_price DECIMAL(10,2),
  low_price DECIMAL(10,2),
  mid_price DECIMAL(10,2),
  high_price DECIMAL(10,2),

  -- Statistics (from JustTCG)
  change_24h DECIMAL(6,4),
  change_7d DECIMAL(6,4),
  change_30d DECIMAL(6,4),
  avg_price DECIMAL(10,2),
  std_dev DECIMAL(10,2),
  trend_slope DECIMAL(10,6),

  -- Metadata
  collected_at TIMESTAMP NOT NULL DEFAULT NOW(),
  source_updated_at TIMESTAMP,

  UNIQUE(card_id, source, collected_at)
);

-- Market prices from EU sources (Cardmarket)
CREATE TABLE market_prices_eu (
  id SERIAL PRIMARY KEY,
  card_id VARCHAR(50) NOT NULL,
  source VARCHAR(20) NOT NULL, -- 'cardmarket' | 'apify'

  -- Prices in EUR
  trend_price DECIMAL(10,2),
  avg_price DECIMAL(10,2),
  low_price DECIMAL(10,2),

  -- Cardmarket specific
  avg_1d DECIMAL(10,2),
  avg_7d DECIMAL(10,2),
  avg_30d DECIMAL(10,2),

  -- Metadata
  collected_at TIMESTAMP NOT NULL DEFAULT NOW(),
  source_updated_at TIMESTAMP,

  UNIQUE(card_id, source, collected_at)
);

-- Exchange rates
CREATE TABLE fx_rates (
  id SERIAL PRIMARY KEY,
  base_currency VARCHAR(3) NOT NULL, -- Always 'GBP'
  target_currency VARCHAR(3) NOT NULL, -- 'USD', 'EUR', 'JPY'
  rate DECIMAL(12,6) NOT NULL,
  collected_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Price history (daily aggregates for training)
CREATE TABLE price_history_daily (
  id SERIAL PRIMARY KEY,
  card_id VARCHAR(50) NOT NULL,
  date DATE NOT NULL,

  -- US prices (in USD, converted to GBP)
  us_market_usd DECIMAL(10,2),
  us_low_usd DECIMAL(10,2),
  us_market_gbp DECIMAL(10,2),
  us_low_gbp DECIMAL(10,2),

  -- EU prices (in EUR, converted to GBP)
  eu_trend_eur DECIMAL(10,2),
  eu_low_eur DECIMAL(10,2),
  eu_trend_gbp DECIMAL(10,2),
  eu_low_gbp DECIMAL(10,2),

  -- Calculated fields
  spread_eu_to_us DECIMAL(6,4),
  spread_us_to_eu DECIMAL(6,4),

  -- FX rates used
  fx_usd_gbp DECIMAL(12,6),
  fx_eur_gbp DECIMAL(12,6),

  UNIQUE(card_id, date)
);

-- Detected arbitrage opportunities
CREATE TABLE arbitrage_opportunities (
  id SERIAL PRIMARY KEY,
  card_id VARCHAR(50) NOT NULL,
  detected_at TIMESTAMP NOT NULL DEFAULT NOW(),

  -- Buy side
  buy_market VARCHAR(50) NOT NULL,
  buy_price DECIMAL(10,2) NOT NULL,
  buy_currency VARCHAR(3) NOT NULL,
  buy_price_gbp DECIMAL(10,2) NOT NULL,

  -- Sell side
  sell_market VARCHAR(50) NOT NULL,
  sell_price DECIMAL(10,2) NOT NULL,
  sell_currency VARCHAR(3) NOT NULL,
  sell_price_gbp DECIMAL(10,2) NOT NULL,

  -- Spread analysis
  gross_spread DECIMAL(6,4) NOT NULL,
  estimated_fees DECIMAL(6,4) NOT NULL,
  estimated_shipping DECIMAL(10,2) NOT NULL,
  net_spread DECIMAL(6,4) NOT NULL,

  -- Classification
  confidence DECIMAL(3,2) NOT NULL,
  urgency VARCHAR(20) NOT NULL, -- 'immediate', 'short', 'medium', 'low'

  -- Outcome (filled by user feedback)
  was_executed BOOLEAN,
  execution_timestamp TIMESTAMP,
  actual_profit DECIMAL(10,2),
  feedback_notes TEXT,

  INDEX idx_card_detected (card_id, detected_at),
  INDEX idx_net_spread (net_spread DESC)
);

-- JustTCG price history (raw storage)
CREATE TABLE justtcg_price_history (
  id SERIAL PRIMARY KEY,
  card_id VARCHAR(50) NOT NULL,
  price DECIMAL(10,2) NOT NULL,
  price_timestamp TIMESTAMP NOT NULL, -- Unix timestamp from API
  collected_at TIMESTAMP NOT NULL DEFAULT NOW(),

  UNIQUE(card_id, price_timestamp)
);
```

### 7.2 Prisma Schema Addition

```prisma
// Add to prisma/schema.prisma

model MarketPriceUS {
  id              Int       @id @default(autoincrement())
  cardId          String    @map("card_id")
  source          String    // 'optcg' | 'justtcg'

  marketPrice     Decimal?  @map("market_price") @db.Decimal(10, 2)
  lowPrice        Decimal?  @map("low_price") @db.Decimal(10, 2)
  midPrice        Decimal?  @map("mid_price") @db.Decimal(10, 2)
  highPrice       Decimal?  @map("high_price") @db.Decimal(10, 2)

  change24h       Decimal?  @map("change_24h") @db.Decimal(6, 4)
  change7d        Decimal?  @map("change_7d") @db.Decimal(6, 4)
  change30d       Decimal?  @map("change_30d") @db.Decimal(6, 4)
  avgPrice        Decimal?  @map("avg_price") @db.Decimal(10, 2)
  stdDev          Decimal?  @map("std_dev") @db.Decimal(10, 2)
  trendSlope      Decimal?  @map("trend_slope") @db.Decimal(10, 6)

  collectedAt     DateTime  @default(now()) @map("collected_at")
  sourceUpdatedAt DateTime? @map("source_updated_at")

  @@unique([cardId, source, collectedAt])
  @@map("market_prices_us")
}

model MarketPriceEU {
  id              Int       @id @default(autoincrement())
  cardId          String    @map("card_id")
  source          String    // 'cardmarket' | 'apify'

  trendPrice      Decimal?  @map("trend_price") @db.Decimal(10, 2)
  avgPrice        Decimal?  @map("avg_price") @db.Decimal(10, 2)
  lowPrice        Decimal?  @map("low_price") @db.Decimal(10, 2)

  avg1d           Decimal?  @map("avg_1d") @db.Decimal(10, 2)
  avg7d           Decimal?  @map("avg_7d") @db.Decimal(10, 2)
  avg30d          Decimal?  @map("avg_30d") @db.Decimal(10, 2)

  collectedAt     DateTime  @default(now()) @map("collected_at")
  sourceUpdatedAt DateTime? @map("source_updated_at")

  @@unique([cardId, source, collectedAt])
  @@map("market_prices_eu")
}

model FXRate {
  id             Int      @id @default(autoincrement())
  baseCurrency   String   @map("base_currency")
  targetCurrency String   @map("target_currency")
  rate           Decimal  @db.Decimal(12, 6)
  collectedAt    DateTime @default(now()) @map("collected_at")

  @@map("fx_rates")
}

model PriceHistoryDaily {
  id            Int      @id @default(autoincrement())
  cardId        String   @map("card_id")
  date          DateTime @db.Date

  usMarketUsd   Decimal? @map("us_market_usd") @db.Decimal(10, 2)
  usLowUsd      Decimal? @map("us_low_usd") @db.Decimal(10, 2)
  usMarketGbp   Decimal? @map("us_market_gbp") @db.Decimal(10, 2)
  usLowGbp      Decimal? @map("us_low_gbp") @db.Decimal(10, 2)

  euTrendEur    Decimal? @map("eu_trend_eur") @db.Decimal(10, 2)
  euLowEur      Decimal? @map("eu_low_eur") @db.Decimal(10, 2)
  euTrendGbp    Decimal? @map("eu_trend_gbp") @db.Decimal(10, 2)
  euLowGbp      Decimal? @map("eu_low_gbp") @db.Decimal(10, 2)

  spreadEuToUs  Decimal? @map("spread_eu_to_us") @db.Decimal(6, 4)
  spreadUsToEu  Decimal? @map("spread_us_to_eu") @db.Decimal(6, 4)

  fxUsdGbp      Decimal? @map("fx_usd_gbp") @db.Decimal(12, 6)
  fxEurGbp      Decimal? @map("fx_eur_gbp") @db.Decimal(12, 6)

  @@unique([cardId, date])
  @@map("price_history_daily")
}

model ArbitrageOpportunity {
  id               Int       @id @default(autoincrement())
  cardId           String    @map("card_id")
  detectedAt       DateTime  @default(now()) @map("detected_at")

  buyMarket        String    @map("buy_market")
  buyPrice         Decimal   @map("buy_price") @db.Decimal(10, 2)
  buyCurrency      String    @map("buy_currency")
  buyPriceGbp      Decimal   @map("buy_price_gbp") @db.Decimal(10, 2)

  sellMarket       String    @map("sell_market")
  sellPrice        Decimal   @map("sell_price") @db.Decimal(10, 2)
  sellCurrency     String    @map("sell_currency")
  sellPriceGbp     Decimal   @map("sell_price_gbp") @db.Decimal(10, 2)

  grossSpread      Decimal   @map("gross_spread") @db.Decimal(6, 4)
  estimatedFees    Decimal   @map("estimated_fees") @db.Decimal(6, 4)
  estimatedShipping Decimal  @map("estimated_shipping") @db.Decimal(10, 2)
  netSpread        Decimal   @map("net_spread") @db.Decimal(6, 4)

  confidence       Decimal   @db.Decimal(3, 2)
  urgency          String

  wasExecuted      Boolean?  @map("was_executed")
  executionTimestamp DateTime? @map("execution_timestamp")
  actualProfit     Decimal?  @map("actual_profit") @db.Decimal(10, 2)
  feedbackNotes    String?   @map("feedback_notes")

  @@index([cardId, detectedAt])
  @@index([netSpread(sort: Desc)])
  @@map("arbitrage_opportunities")
}
```

---

## 8. Model Training Data Mapping

### 8.1 Which Models Use CardMarket Data

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    MODEL → DATA SOURCE MAPPING                               │
└─────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────┐
│ MODEL                  │ US DATA (TCGplayer)  │ EU DATA (CardMarket)        │
├──────────────────────────────────────────────────────────────────────────────┤
│ M1a ViT (Card ID)      │ ✗ Not needed         │ ✗ Not needed (images only)  │
│ M1b Condition          │ ✗ Not needed         │ ✗ Not needed (images only)  │
│ M2 Seller Risk         │ ✓ Seller data        │ ✓ Seller data               │
│ M3 Quality Scorer      │ ✓ Listing quality    │ ✓ Listing quality           │
│ M4 GNN (Topology)      │ ✓ Correlations       │ ✓ EU-US relationships       │
│ M5 Prophet (Timing)    │ ✓ Seasonality        │ ✓ EU seasonality            │
│ M6 XGBoost (Demand)    │ ✓ Price movements    │ ✓ EU demand signals         │
│ M7 TFT (Forecasting)   │ ✓ Time series        │ ✓ EU time series            │
│ M8 ARBITRAGE           │ ✓ CRITICAL           │ ✓ CRITICAL                  │
│ M10 Isolation Forest   │ ✓ Anomaly detection  │ ✓ EU anomalies              │
│ M15 Meta-Learner       │ ✓ Combined input     │ ✓ Combined input            │
└──────────────────────────────────────────────────────────────────────────────┘

CRITICAL DEPENDENCY:
  M8 (Cross-Market Arbitrage Detector) requires BOTH US and EU data
  to function. This is the PRIMARY consumer of CardMarket data.
```

### 8.2 Training Data Export Functions

```typescript
// File: app/lib/ml/data/training-export.server.ts

/**
 * Export training data for M8 Arbitrage Detector
 */
export async function exportArbitrageTrainingData(
  startDate: Date,
  endDate: Date
): Promise<ArbitrageTrainingExample[]> {
  const priceHistory = await prisma.priceHistoryDaily.findMany({
    where: {
      date: { gte: startDate, lte: endDate },
      // Must have both US and EU data
      usMarketGbp: { not: null },
      euTrendGbp: { not: null },
    },
    orderBy: { date: 'asc' },
  });

  const opportunities = await prisma.arbitrageOpportunity.findMany({
    where: {
      detectedAt: { gte: startDate, lte: endDate },
      wasExecuted: { not: null }, // Only labeled examples
    },
  });

  return transformToTrainingExamples(priceHistory, opportunities);
}

/**
 * Export training data for M7 TFT (requires long history)
 */
export async function exportTFTTrainingData(
  lookbackDays: number = 90,
  forecastDays: number = 30
): Promise<TFTTrainingSequence[]> {
  // Get cards with sufficient history
  const cardIds = await getCardsWithSufficientHistory(lookbackDays + forecastDays);

  const sequences: TFTTrainingSequence[] = [];

  for (const cardId of cardIds) {
    const history = await prisma.priceHistoryDaily.findMany({
      where: { cardId },
      orderBy: { date: 'asc' },
    });

    // Generate sliding window sequences
    for (let i = lookbackDays; i < history.length - forecastDays; i++) {
      sequences.push({
        cardId,
        // Past 90 days
        observedSequence: history.slice(i - lookbackDays, i),
        // Next 30 days (target)
        targetSequence: history.slice(i, i + forecastDays),
        // Static features
        staticFeatures: await getCardStaticFeatures(cardId),
      });
    }
  }

  return sequences;
}

/**
 * Export training data for M6 XGBoost Demand
 */
export async function exportDemandTrainingData(): Promise<DemandTrainingExample[]> {
  // Use JustTCG statistics for rich feature set
  const justTCGData = await prisma.$queryRaw`
    SELECT DISTINCT ON (card_id)
      card_id,
      change_24h,
      change_7d,
      change_30d,
      avg_price,
      std_dev,
      trend_slope
    FROM market_prices_us
    WHERE source = 'justtcg'
    ORDER BY card_id, collected_at DESC
  `;

  // Combine with price history for labels
  const examples: DemandTrainingExample[] = [];

  for (const card of justTCGData) {
    const futurePrice = await getFuturePriceLabel(card.card_id, 7); // 7-day ahead

    if (futurePrice) {
      examples.push({
        cardId: card.card_id,
        features: {
          change24h: card.change_24h,
          change7d: card.change_7d,
          change30d: card.change_30d,
          avgPrice: card.avg_price,
          volatility: card.std_dev,
          trendSlope: card.trend_slope,
        },
        label: {
          priceChange7d: futurePrice.change,
          direction: futurePrice.direction, // 'up' | 'down' | 'flat'
        },
      });
    }
  }

  return examples;
}
```

### 8.3 Data Quality Requirements by Model

```yaml
M8_ARBITRAGE_DETECTOR:
  minimum_data:
    us_eu_pairs: 50,000  # Price pairs with both markets
    labeled_opportunities: 5,000  # User-validated outcomes
    historical_depth: 180 days

  required_fields:
    - card_id
    - us_market_price
    - us_low_price
    - eu_trend_price
    - eu_low_price
    - fx_rate_at_time
    - actual_outcome (for labeled data)

  quality_filters:
    - Both US and EU prices must be present
    - Prices must be within 7 days of each other
    - FX rate must be from same day
    - Exclude outliers (> 3 std from mean)

M7_TFT_FORECASTER:
  minimum_data:
    cards: 500  # Cards with sufficient history
    sequences_per_card: 100  # Training sequences
    total_sequences: 50,000

  required_fields:
    - 90-day price history (observed)
    - 30-day future prices (target)
    - Static card features (rarity, set, variant)
    - Calendar features (day of week, month)

  quality_filters:
    - No gaps > 3 days in history
    - Price variance > 0 (not flat)
    - Sufficient trading activity

M6_XGBOOST_DEMAND:
  minimum_data:
    examples: 100,000
    cards: 1,000

  required_fields:
    - Price change statistics (24h, 7d, 30d)
    - Volatility measures
    - Trend indicators
    - Future price label (7d ahead)

  quality_filters:
    - Complete feature set
    - Valid future label
    - Balanced class distribution
```

---

## 9. Implementation Roadmap

### Phase 1: Foundation (Week 1-2)

```yaml
TASKS:
  database:
    - Create migration for new tables
    - Add Prisma models
    - Setup indexes for query performance

  api_clients:
    - OPTCG API client (TypeScript)
    - JustTCG API client with auth
    - Cardmarket CSV parser
    - FX rate API client

  lambda_functions:
    - us-price-collector (OPTCG + JustTCG)
    - eu-price-collector (CSV + Apify)
    - fx-rate-collector

DELIVERABLES:
  - Database schema deployed
  - API clients tested
  - Manual collection working
```

### Phase 2: Automation (Week 3-4)

```yaml
TASKS:
  scheduling:
    - EventBridge rules for all collectors
    - Error handling and retries
    - Dead letter queues

  aggregation:
    - Price aggregator service
    - Currency normalization
    - Spread calculation

  monitoring:
    - CloudWatch dashboards
    - Alerts for missing data
    - Data quality metrics

DELIVERABLES:
  - Fully automated collection pipeline
  - Real-time aggregated prices
  - Monitoring dashboard
```

### Phase 3: Training Integration (Week 5-6)

```yaml
TASKS:
  export_functions:
    - Arbitrage training export
    - TFT training export
    - Demand training export

  data_validation:
    - Quality checks before export
    - Outlier detection
    - Missing data handling

  model_updates:
    - Update M8 to use new data schema
    - Add CardMarket features to M6/M7
    - Test with collected data

DELIVERABLES:
  - Training data exports working
  - Models updated for new data
  - Initial training runs
```

### Phase 4: User Feedback Loop (Week 7-8)

```yaml
TASKS:
  feedback_interface:
    - Arbitrage opportunity display
    - Execution feedback form
    - Outcome tracking

  labeling_pipeline:
    - Connect feedback to training data
    - Automated relabeling
    - Confidence weighting

  metrics:
    - Model accuracy vs data volume
    - Feedback completion rates
    - Data quality scores

DELIVERABLES:
  - Feedback interface live
  - Labeled data flowing to training
  - Model improvement metrics
```

---

## Appendix A: API Response Examples

### OPTCG API Response

```json
{
  "card_name": "Roronoa Zoro",
  "set_name": "Romance Dawn",
  "set_id": "OP-01",
  "card_set_id": "OP01-001",
  "rarity": "SR",
  "card_color": "Green",
  "card_type": "Character",
  "card_cost": "3",
  "card_power": "5000",
  "life": "",
  "counter_amount": "1000",
  "attribute": "Slash",
  "sub_types": "Supernovas/Straw Hat Crew",
  "card_text": "[DON!! x1] [When Attacking] ...",
  "inventory_price": 12.99,
  "market_price": 14.50,
  "date_scraped": "2026-01-09",
  "card_image_id": "op01-001",
  "card_image": "https://..."
}
```

### JustTCG API Response

```json
{
  "id": "one-piece-op01-001",
  "name": "Roronoa Zoro",
  "game": "one-piece-card-game",
  "set": "Romance Dawn",
  "price": 14.50,
  "lastUpdated": "2026-01-09T10:30:00Z",
  "statistics": {
    "change24h": 0.0345,
    "change7d": 0.0892,
    "change30d": -0.0156,
    "avg": 13.80,
    "min": 11.50,
    "max": 18.00,
    "stdDev": 1.45,
    "coeffVar": 0.105,
    "iqr": 2.50,
    "trendSlope": 0.025,
    "allTimeHigh": 22.00,
    "allTimeHighDate": "2025-08-15T00:00:00Z",
    "allTimeLow": 8.50,
    "allTimeLowDate": "2025-03-01T00:00:00Z"
  },
  "priceHistory": [
    { "p": 14.50, "t": 1736420000 },
    { "p": 14.25, "t": 1736333600 },
    { "p": 14.00, "t": 1736247200 }
  ]
}
```

### Cardmarket CSV Structure (Estimated)

```csv
"product_id","name","expansion","category","trend_price","avg_sell_price","low_price","updated_at"
"12345","Roronoa Zoro","Romance Dawn","Singles","12.50","13.20","10.99","2026-01-09"
"12346","Monkey D. Luffy","Romance Dawn","Singles","25.00","26.50","22.00","2026-01-09"
```

---

## Appendix B: Error Handling

```typescript
// Retry configuration for API calls
const RETRY_CONFIG = {
  optcg: {
    maxRetries: 3,
    baseDelay: 1000,
    maxDelay: 10000,
    retryOn: [429, 500, 502, 503, 504],
  },
  justtcg: {
    maxRetries: 5,
    baseDelay: 2000,
    maxDelay: 30000,
    retryOn: [429, 500, 502, 503, 504],
  },
  apify: {
    maxRetries: 2,
    baseDelay: 5000,
    maxDelay: 60000,
    retryOn: [429, 500],
  },
};

// Fallback strategy when primary source fails
const FALLBACK_STRATEGY = {
  us_prices: {
    primary: 'optcg',
    fallback: 'justtcg',
    action_on_both_fail: 'use_cached_with_warning',
  },
  eu_prices: {
    primary: 'cardmarket_csv',
    fallback: 'apify',
    action_on_both_fail: 'skip_eu_data_for_day',
  },
};
```

---

*Document Version: 1.0.0*
*Created: 2026-01-09*
*Status: Research Complete, Ready for Implementation*
*Dependencies: AI_MODELS_FOR_TCG_ARBITRAGE.md, TRAINING_DATA_COLLECTION_STRATEGY.md*
