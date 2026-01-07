# RDS Trading Card Price Archive Infrastructure

**Date:** 2026-01-07
**Database:** AWS RDS PostgreSQL 17.6 (cardforum.cn4c2su0o42n.us-east-1.rds.amazonaws.com)
**Region:** us-east-1 (IAD)

---

## Executive Summary

The trading card price archive is a time-series database storing ~500 days of historical price data for 772+ cards across One Piece and Pokemon TCGs. The system ingests data from multiple sources (S3, external APIs) via scheduled cron jobs, normalizes it through staging tables, and exposes it via a unified price API.

| Metric | Value |
|--------|-------|
| Total Database Size | 103 MB |
| Total Records | 255,583 |
| Price History Snapshots | 231,417 |
| Unique Cards Tracked | 772 |
| Historical Depth | 345 days |
| Daily Growth Rate | ~700 records/day |
| Tables | 21 |

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                    EXTERNAL DATA SOURCES                                 │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                          │
│   ┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐                  │
│   │   OPTCG API      │    │   CardRush JP    │    │   Manual CSV     │                  │
│   │  (TCGplayer)     │    │   (via S3)       │    │   Upload         │                  │
│   │                  │    │                  │    │                  │                  │
│   │  EN variant      │    │  JP variant      │    │  Ad-hoc          │                  │
│   │  prices USD/GBP  │    │  prices JPY      │    │  corrections     │                  │
│   └────────┬─────────┘    └────────┬─────────┘    └────────┬─────────┘                  │
│            │                       │                       │                            │
│            │ 8AM/8PM UTC           │ Hourly                │ On-demand                  │
│            │ (Lambda)              │ (S3 upload)           │ (Admin UI)                 │
│            ▼                       ▼                       ▼                            │
└────────────┴───────────────────────┴───────────────────────┴────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                              AWS S3 (pricedata-tcg)                                      │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                          │
│   s3://pricedata-tcg/                                                                   │
│   ├── daily_prices.xlsx          634 KB   Historical JPY prices (345+ days)            │
│   ├── cardmarket_feed.csv         21 KB   EU prices                                    │
│   ├── pkmn_cardmarket_feed.csv    15 KB   Pokemon EU prices                            │
│   └── pricefeed/                                                                        │
│       ├── onepiece_pricefeed.xlsx  94 KB  Multi-channel JP prices                      │
│       └── pokemon_pricefeed.xlsx   58 KB  Multi-channel Pokemon prices                 │
│                                                                                          │
│   Total: ~822 KB of source data                                                         │
│                                                                                          │
│   pricefeed/*.xlsx Sheet Structure:                                                     │
│   ┌───────────────┬────────────────────────────────────────────────────────────┐       │
│   │ Sheet         │ Purpose                                                     │       │
│   ├───────────────┼────────────────────────────────────────────────────────────┤       │
│   │ ebay_business │ eBay business account prices (primary for JP)              │       │
│   │ ebay_private  │ eBay private seller prices                                 │       │
│   │ cardmarket    │ CardMarket EU prices                                       │       │
│   │ cardtrader    │ CardTrader prices                                          │       │
│   │ shopify       │ Shopify store prices                                       │       │
│   └───────────────┴────────────────────────────────────────────────────────────┘       │
│                                                                                          │
└─────────────────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     │ Vercel Cron Jobs (scheduled)
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                              VERCEL SERVERLESS FUNCTIONS                                 │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                          │
│   ┌────────────────────────────────────────────────────────────────────────────────┐    │
│   │                        CRON JOB SCHEDULE (vercel.json)                         │    │
│   ├────────────────────────────────────────────────────────────────────────────────┤    │
│   │                                                                                 │    │
│   │   00:00 UTC  ─────►  /api/cron/price-snapshot                                  │    │
│   │                      Take daily snapshot of all card prices                    │    │
│   │                      → Writes to: price_index_snapshots                        │    │
│   │                                                                                 │    │
│   │   01:00 UTC  ─────►  /api/cron/price-sync                                      │    │
│   │                      Sync historical prices from daily_prices.xlsx             │    │
│   │                      → Writes to: card_price_history                           │    │
│   │                                                                                 │    │
│   │   02:00 UTC  ─────►  /api/cron/pricefeed-sync                                  │    │
│   │                      Sync multi-channel prices from pricefeed/*.xlsx           │    │
│   │                      → Writes to: price_sources                                │    │
│   │                                                                                 │    │
│   │   03:00 UTC  ─────►  /api/cron/cleanup                                         │    │
│   │                      Clean expired idempotency records                         │    │
│   │                      → Deletes from: idempotency_records                       │    │
│   │                                                                                 │    │
│   │   14:00 UTC  ─────►  /api/cron/jp-price-sync        ⚠️ CURRENTLY FAILING       │    │
│   │                      Full JP price sync from S3                                │    │
│   │                      → Writes to: japanese_price_source → card_prices_v2       │    │
│   │                                                                                 │    │
│   │   03:00 SUN  ─────►  /api/cron/correlation-calc                                │    │
│   │                      Calculate price correlations for neural network           │    │
│   │                      → Writes to: price_correlations                           │    │
│   │                                                                                 │    │
│   └────────────────────────────────────────────────────────────────────────────────┘    │
│                                                                                          │
└─────────────────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                              AWS RDS PostgreSQL 17.6                                     │
│                              (cardforum.cn4c2su0o42n.us-east-1.rds.amazonaws.com)        │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                          │
│   DATABASE: cardforum (103 MB)                                                          │
│                                                                                          │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Data Flow Diagram

```
                    ┌─────────────────────────────────────────────────────────────┐
                    │                      DATA INGESTION                          │
                    └─────────────────────────────────────────────────────────────┘
                                              │
                    ┌─────────────────────────┼─────────────────────────┐
                    │                         │                         │
                    ▼                         ▼                         ▼
        ┌───────────────────┐     ┌───────────────────┐     ┌───────────────────┐
        │  OPTCG API/Lambda │     │  S3 Pricefeed     │     │  CSV Upload       │
        │  (EN Prices)      │     │  (JP Prices)      │     │  (Manual)         │
        └─────────┬─────────┘     └─────────┬─────────┘     └─────────┬─────────┘
                  │                         │                         │
                  │                         │                         │
                  ▼                         ▼                         ▼
                    ┌─────────────────────────────────────────────────────────────┐
                    │                    STAGING LAYER                             │
                    │                                                              │
                    │   ┌─────────────────────────────────────────────────────┐   │
                    │   │  JapanesePriceSource (485 records)                  │   │
                    │   │  ├── sku (unique identifier)                        │   │
                    │   │  ├── priceJpy (original currency)                   │   │
                    │   │  ├── priceGbp (converted, pence)                    │   │
                    │   │  ├── jpyToGbpRate (exchange rate used)              │   │
                    │   │  └── syncedToCardPrice (sync status flag)           │   │
                    │   └─────────────────────────────────────────────────────┘   │
                    │                                                              │
                    │   ┌─────────────────────────────────────────────────────┐   │
                    │   │  ExternalCardPrice (Legacy - 11,247 records)        │   │
                    │   │  └── Being phased out, data migrating to V2         │   │
                    │   └─────────────────────────────────────────────────────┘   │
                    │                                                              │
                    └─────────────────────────────────────────────────────────────┘
                                              │
                                              │ Normalization & Sync
                                              ▼
                    ┌─────────────────────────────────────────────────────────────┐
                    │                    NORMALIZED LAYER                          │
                    │                                                              │
                    │   ┌─────────────────────────────────────────────────────┐   │
                    │   │  CardPriceV2 (1,000 records) - PRIMARY PRICE TABLE  │   │
                    │   │  ├── cardId (e.g., OP03-OP01-051-sp)               │   │
                    │   │  ├── language (EN: 515, JP: 485)                   │   │
                    │   │  ├── optcgTcgplayerGbp (TCGplayer via OPTCG)       │   │
                    │   │  ├── limitlessCardmarketGbp (CardMarket)           │   │
                    │   │  ├── justtcgTcgplayerGbp (JustTCG)                 │   │
                    │   │  ├── bestPriceGbp (computed lowest)                │   │
                    │   │  └── tradeinPriceGbp (70% of best for NM)          │   │
                    │   └─────────────────────────────────────────────────────┘   │
                    │                                                              │
                    │   ┌─────────────────────────────────────────────────────┐   │
                    │   │  PriceSource (0 records) - Multi-channel tracking   │   │
                    │   │  └── Per-card, per-source pricing (not populated)   │   │
                    │   └─────────────────────────────────────────────────────┘   │
                    │                                                              │
                    └─────────────────────────────────────────────────────────────┘
                                              │
                                              │ Daily Snapshots
                                              ▼
                    ┌─────────────────────────────────────────────────────────────┐
                    │                    HISTORICAL LAYER                          │
                    │                                                              │
                    │   ┌─────────────────────────────────────────────────────┐   │
                    │   │  CardPriceHistory (231,417 records) - 81 MB         │   │
                    │   │  ├── 345 unique dates (2024-08-28 to 2026-01-06)   │   │
                    │   │  ├── 772 unique cards tracked                       │   │
                    │   │  ├── ~300 days avg per card                         │   │
                    │   │  ├── One Piece: 143,901 snapshots                   │   │
                    │   │  ├── Pokemon: 87,516 snapshots                      │   │
                    │   │  │                                                   │   │
                    │   │  │  Per-Record:                                      │   │
                    │   │  ├── priceJpy (original currency)                   │   │
                    │   │  ├── priceGbp (converted)                           │   │
                    │   │  ├── exchangeRate (JPY→GBP rate used)               │   │
                    │   │  ├── change (% change from previous)                │   │
                    │   │  ├── changeJpy (% change JPY only)                  │   │
                    │   │  └── changeFx (% change from FX movement)           │   │
                    │   └─────────────────────────────────────────────────────┘   │
                    │                                                              │
                    │   ┌─────────────────────────────────────────────────────┐   │
                    │   │  ExchangeRateHistory (0 records)                    │   │
                    │   │  └── Daily JPY/GBP rates (not yet populated)        │   │
                    │   └─────────────────────────────────────────────────────┘   │
                    │                                                              │
                    └─────────────────────────────────────────────────────────────┘
                                              │
                                              │ Aggregation
                                              ▼
                    ┌─────────────────────────────────────────────────────────────┐
                    │                    ANALYTICS LAYER                           │
                    │                                                              │
                    │   ┌─────────────────────────────────────────────────────┐   │
                    │   │  PriceIndexSnapshot (8,323 records)                 │   │
                    │   │  ├── GAME indexes: 653 snapshots                   │   │
                    │   │  ├── SET indexes: 7,322 snapshots                  │   │
                    │   │  ├── TOP_100 indexes: 346 snapshots                │   │
                    │   │  ├── LANGUAGE indexes: 2 snapshots                 │   │
                    │   │  │                                                   │   │
                    │   │  │  Per-Index:                                       │   │
                    │   │  ├── value (index value)                            │   │
                    │   │  ├── change24h, change7d, change30d                 │   │
                    │   │  ├── cardCount, totalMarketCap, avgPrice            │   │
                    │   │  └── volatility, highPrice, lowPrice                │   │
                    │   └─────────────────────────────────────────────────────┘   │
                    │                                                              │
                    │   ┌─────────────────────────────────────────────────────┐   │
                    │   │  PriceCorrelation (0 records)                       │   │
                    │   │  └── Card-to-card price correlations                │   │
                    │   │      (for neural network visualization)             │   │
                    │   └─────────────────────────────────────────────────────┘   │
                    │                                                              │
                    │   ┌─────────────────────────────────────────────────────┐   │
                    │   │  IndexConstituent (table not migrated)              │   │
                    │   │  └── TCG-100 NASDAQ-style index members             │   │
                    │   └─────────────────────────────────────────────────────┘   │
                    │                                                              │
                    └─────────────────────────────────────────────────────────────┘
                                              │
                                              ▼
                    ┌─────────────────────────────────────────────────────────────┐
                    │                    API CONSUMPTION                           │
                    │                                                              │
                    │   ┌─────────────────────────────────────────────────────┐   │
                    │   │  Trade-In System                                    │   │
                    │   │  └── CardPrice lookup for customer quotes           │   │
                    │   └─────────────────────────────────────────────────────┘   │
                    │                                                              │
                    │   ┌─────────────────────────────────────────────────────┐   │
                    │   │  Price Index API (PRISM)                            │   │
                    │   │  └── Market intelligence dashboards                 │   │
                    │   └─────────────────────────────────────────────────────┘   │
                    │                                                              │
                    │   ┌─────────────────────────────────────────────────────┐   │
                    │   │  Card History API                                   │   │
                    │   │  └── Per-card price charts with trend analysis      │   │
                    │   └─────────────────────────────────────────────────────┘   │
                    │                                                              │
                    └─────────────────────────────────────────────────────────────┘
```

---

## Storage Analysis

### Table Size Distribution

```
                                    STORAGE BREAKDOWN (103 MB Total)

    ┌────────────────────────────────────────────────────────────────────────────────┐
    │                                                                                 │
    │   card_price_history      ████████████████████████████████████████  81 MB (79%)│
    │   card_prices (legacy)    ███                                        7 MB  (7%)│
    │   price_index_snapshots   █                                          2 MB  (2%)│
    │   card_prices_v2          █                                          2 MB  (2%)│
    │   CardPrice               ▌                                          1 MB  (1%)│
    │   Other (16 tables)       ████                                       10 MB (9%)│
    │                                                                                 │
    └────────────────────────────────────────────────────────────────────────────────┘
```

### Detailed Table Metrics

| Table | Size | Rows | Avg Row Size | Primary Use |
|-------|------|------|--------------|-------------|
| card_price_history | 81 MB | 231,417 | ~370 bytes | Historical time-series |
| card_prices (legacy) | 6.9 MB | 11,247 | ~630 bytes | Being phased out |
| price_index_snapshots | 2.2 MB | 8,323 | ~280 bytes | Index analytics |
| card_prices_v2 | 2.2 MB | 1,000 | ~2.2 KB | Normalized prices |
| CardPrice | 960 KB | 2,575 | ~380 bytes | Trade-in lookup |
| inventory_alt_art | 312 KB | 470 | ~680 bytes | Alt art tracking |
| japanese_price_source | 288 KB | 485 | ~610 bytes | JP staging |

### Index Usage Analysis

```
                                    INDEX EFFICIENCY

    Most Used Indexes:
    ┌────────────────────────────────────────────────────────────────────────────────┐
    │ card_prices_pkey                     ████████████████████████  525,178 scans   │
    │ card_price_history_pkey              ████████████████████      234,142 scans   │
    │ card_id_snapshot_date_key            ████████████████████      231,610 scans   │
    │ idx_card_history_id_date             █████                      12,828 scans   │
    │ idx_card_history_set_date            ▌                           2,929 scans   │
    │ idx_card_history_game_date           ▌                             797 scans   │
    └────────────────────────────────────────────────────────────────────────────────┘

    Unused Indexes (candidates for removal):
    ┌────────────────────────────────────────────────────────────────────────────────┐
    │ idx_card_history_jpy                 5.1 MB    0 scans   ⚠️ NEVER USED        │
    │ idx_card_prices_tradein_gbp          584 KB    0 scans   ⚠️ NEVER USED        │
    │ idx_card_prices_market_gbp           584 KB    0 scans   ⚠️ NEVER USED        │
    └────────────────────────────────────────────────────────────────────────────────┘
```

---

## Growth Projections

### Historical Growth Rate

```
                            MONTHLY RECORD GROWTH (card_price_history)

    2025-08  │████████████████████████████████████████████  22,040
    2025-09  │██████████████████████████████████████████████  23,160
    2025-10  │████████████████████████████████████████  20,299
    2025-11  │█████████████████████████████████████████████  22,874
    2025-12  │███████████████████████████████████████████████  23,932
    2026-01  │█████████  4,632 (7 days)
             └───────────────────────────────────────────────────────►
               0        10,000      20,000      30,000   records/month
```

### Growth Projections

| Timeframe | Records Added | DB Size Growth | Total Size |
|-----------|---------------|----------------|------------|
| Current | - | - | 103 MB |
| +3 months | ~70,000 | +25 MB | 128 MB |
| +6 months | ~140,000 | +50 MB | 153 MB |
| +1 year | ~280,000 | +100 MB | 203 MB |
| +2 years | ~560,000 | +200 MB | 303 MB |

**Note:** Growth is linear and predictable. At current rates, the database will remain under 500 MB for 3+ years.

---

## Robustness Analysis

### Redundancy & Backup

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                               ROBUSTNESS ARCHITECTURE                                    │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                          │
│   ┌──────────────────┐                                                                  │
│   │  AWS RDS         │◄───── Multi-AZ Standby (if enabled)                             │
│   │  Primary         │                                                                  │
│   │                  │◄───── Automated Backups (7-35 day retention)                    │
│   │  us-east-1a      │                                                                  │
│   └────────┬─────────┘◄───── Point-in-Time Recovery (up to 5 min granularity)          │
│            │                                                                            │
│            │              ┌────────────────────────────────────────────────────────┐   │
│            │              │  DATA LAYER REDUNDANCY                                  │   │
│            │              ├────────────────────────────────────────────────────────┤   │
│            │              │                                                         │   │
│            │              │  1. S3 Source Files (ORIGINAL SOURCE OF TRUTH)         │   │
│            │              │     └── daily_prices.xlsx preserved indefinitely       │   │
│            │              │                                                         │   │
│            │              │  2. Staging Tables (RECOVERABLE)                        │   │
│            │              │     └── JapanesePriceSource can be rebuilt from S3     │   │
│            │              │                                                         │   │
│            │              │  3. Normalized Tables (DERIVED)                         │   │
│            │              │     └── CardPriceV2 can be rebuilt from staging        │   │
│            │              │                                                         │   │
│            │              │  4. Historical Tables (APPEND-ONLY)                     │   │
│            │              │     └── card_price_history is immutable, no updates    │   │
│            │              │                                                         │   │
│            │              └────────────────────────────────────────────────────────┘   │
│            │                                                                            │
│            ▼                                                                            │
│   ┌──────────────────────────────────────────────────────────────────────────────┐     │
│   │                        FAILURE MODES & RECOVERY                               │     │
│   ├──────────────────────────────────────────────────────────────────────────────┤     │
│   │                                                                               │     │
│   │  ┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────────┐   │     │
│   │  │ Cron Job Failure    │  │ S3 Unavailable      │  │ RDS Instance Down   │   │     │
│   │  │                     │  │                     │  │                     │   │     │
│   │  │ Impact: Stale data  │  │ Impact: No new data │  │ Impact: Full outage │   │     │
│   │  │ Recovery: Manual    │  │ Recovery: Auto-retry│  │ Recovery: Failover  │   │     │
│   │  │ sync via CLI        │  │ on next cron cycle  │  │ (if Multi-AZ)       │   │     │
│   │  │                     │  │                     │  │                     │   │     │
│   │  │ ⚠️ CURRENT ISSUE    │  │ ✅ Robust           │  │ ✅ AWS Managed      │   │     │
│   │  └─────────────────────┘  └─────────────────────┘  └─────────────────────┘   │     │
│   │                                                                               │     │
│   └──────────────────────────────────────────────────────────────────────────────┘     │
│                                                                                          │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

### Data Integrity Constraints

| Constraint Type | Tables | Purpose |
|-----------------|--------|---------|
| Primary Keys | All | Row uniqueness |
| Unique Indexes | CardPriceV2.cardId, JapanesePriceSource.sku | Prevent duplicates |
| Composite Unique | CardPriceHistory(cardId, snapshotDate) | One snapshot per card per day |
| Foreign Keys | TradeInItem → CardPrice | Referential integrity |

### Current Issues

| Issue | Severity | Impact | Status |
|-------|----------|--------|--------|
| jp-price-sync cron failing | High | JP prices stale 8 days | Documented, fix planned |
| ExchangeRateHistory empty | Medium | No FX trend tracking | Not yet implemented |
| PriceSource table empty | Medium | No multi-channel arbitrage | Not yet implemented |
| PriceCorrelation empty | Low | Neural network incomplete | Weekly cron not firing |
| IndexConstituent not migrated | Low | TCG-100 index not available | Pending migration |

---

## Utilization Patterns

### Query Patterns

```
                                    QUERY DISTRIBUTION

    ┌────────────────────────────────────────────────────────────────────────────────┐
    │                                                                                 │
    │   Trade-In Lookup         ████████████████████████████████████████  60%        │
    │   (CardPrice by cardId)                                                         │
    │                                                                                 │
    │   Price History Fetch     ██████████████████                        25%        │
    │   (CardPriceHistory by cardId + date range)                                     │
    │                                                                                 │
    │   Index Snapshots         ██████                                    10%        │
    │   (PriceIndexSnapshot by type + date)                                           │
    │                                                                                 │
    │   Admin/Sync              ███                                        5%        │
    │   (Bulk inserts/updates)                                                        │
    │                                                                                 │
    └────────────────────────────────────────────────────────────────────────────────┘
```

### Connection Pool

| Metric | Value | Notes |
|--------|-------|-------|
| Active Connections | 2 | Very low utilization |
| Max Connections | ~100 | PostgreSQL default |
| Connection Pooling | None | Direct connections via Prisma |

### Performance Characteristics

```
                                    QUERY LATENCY PROFILE

    ┌────────────────────────────────────────────────────────────────────────────────┐
    │                                                                                 │
    │   Single card lookup (CardPriceV2)                                             │
    │   ┌──┐                                                                          │
    │   │██│  < 5ms (indexed)                                                        │
    │   └──┘                                                                          │
    │                                                                                 │
    │   Card history (30 days)                                                        │
    │   ┌────┐                                                                        │
    │   │████│  5-20ms (indexed, ~30 rows)                                           │
    │   └────┘                                                                        │
    │                                                                                 │
    │   Card history (full 345 days)                                                  │
    │   ┌────────┐                                                                    │
    │   │████████│  20-50ms (~345 rows)                                              │
    │   └────────┘                                                                    │
    │                                                                                 │
    │   Index snapshot aggregation                                                    │
    │   ┌──────────────┐                                                              │
    │   │██████████████│  50-200ms (grouping 1000 cards)                             │
    │   └──────────────┘                                                              │
    │                                                                                 │
    │   Bulk sync (485 JP cards)                                                      │
    │   ┌────────────────────────────────────────────────────────────────────────┐   │
    │   │████████████████████████████████████████████████████████████████████████│   │
    │   └────────────────────────────────────────────────────────────────────────┘   │
    │   60-120 seconds (batched upserts)                                              │
    │                                                                                 │
    └────────────────────────────────────────────────────────────────────────────────┘
```

---

## Neural Network Visualization

### Price Correlation Network (Planned)

```
                                PRICE CORRELATION NEURAL NETWORK

    The neural network visualization will show price correlations between cards,
    where connection strength represents correlation coefficient (-1 to +1).

                                    ┌─────────────┐
                                    │   OP01-003  │
                                    │   (Leader)  │
                                    └──────┬──────┘
                                           │ 0.85
                              ┌────────────┼────────────┐
                              │            │            │
                        ┌─────┴─────┐ ┌────┴────┐ ┌─────┴─────┐
                        │ OP01-025  │ │OP01-051 │ │ OP03-112  │
                        │  (SEC)    │ │ (SEC)   │ │   (SEC)   │
                        └─────┬─────┘ └────┬────┘ └─────┬─────┘
                              │ 0.72       │ 0.68       │ 0.75
                              ▼            ▼            ▼
                        ┌─────────┐  ┌─────────┐  ┌─────────┐
                        │ SET:OP01│  │SET:OP01 │  │SET:OP03 │
                        │  Index  │  │ Index   │  │ Index   │
                        └─────────┘  └─────────┘  └─────────┘
                              │            │            │
                              └────────────┼────────────┘
                                           │ 0.92
                                           ▼
                                    ┌─────────────┐
                                    │  GAME:      │
                                    │  onepiece   │
                                    │  Index      │
                                    └─────────────┘

    Legend:
    ─────  Strong positive correlation (> 0.7)
    - - -  Weak positive correlation (0.3 - 0.7)
    · · ·  No correlation (-0.3 - 0.3)

    Data Source: price_correlations table (currently empty)
    Calculation: Weekly cron at /api/cron/correlation-calc
```

### Entity Relationship Diagram

```
                                    SCHEMA RELATIONSHIPS

    ┌─────────────────────────────────────────────────────────────────────────────────┐
    │                           PRICE DATA DOMAIN                                      │
    ├─────────────────────────────────────────────────────────────────────────────────┤
    │                                                                                  │
    │   ┌─────────────────┐                       ┌─────────────────┐                 │
    │   │ JapanesePriceSrc│─────syncs to─────────►│   CardPriceV2   │                 │
    │   │    (staging)    │                       │  (normalized)   │                 │
    │   └─────────────────┘                       └────────┬────────┘                 │
    │                                                      │                           │
    │   ┌─────────────────┐                                │                           │
    │   │ ExternalCardPrc │────migrating to────────────────┘                           │
    │   │    (legacy)     │                                │                           │
    │   └─────────────────┘                                │ snapshots                 │
    │                                                      ▼                           │
    │   ┌─────────────────┐                       ┌─────────────────┐                 │
    │   │  PriceSource    │◄──────────────────────│CardPriceHistory │                 │
    │   │ (multi-channel) │                       │ (time-series)   │                 │
    │   └─────────────────┘                       └─────────────────┘                 │
    │                                                      │                           │
    │                                                      │ aggregates                │
    │                                                      ▼                           │
    │                                             ┌─────────────────┐                 │
    │                                             │PriceIndexSnapsht│                 │
    │                                             │  (analytics)    │                 │
    │                                             └─────────────────┘                 │
    │                                                                                  │
    └─────────────────────────────────────────────────────────────────────────────────┘

    ┌─────────────────────────────────────────────────────────────────────────────────┐
    │                           TRADE-IN DOMAIN                                        │
    ├─────────────────────────────────────────────────────────────────────────────────┤
    │                                                                                  │
    │   ┌─────────────────┐       ┌─────────────────┐       ┌─────────────────┐       │
    │   │    Customer     │──────►│TradeInSubmission│──────►│   TradeInItem   │       │
    │   └─────────────────┘       └────────┬────────┘       └────────┬────────┘       │
    │                                      │                         │                 │
    │                                      ▼                         ▼                 │
    │                             ┌─────────────────┐       ┌─────────────────┐       │
    │                             │     Payout      │       │    CardPrice    │◄──────┤
    │                             └─────────────────┘       │ (trade-in ref)  │       │
    │                                                       └─────────────────┘       │
    │                                                                                  │
    └─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Recommendations

### Immediate Actions

1. **Fix jp-price-sync cron** (See JP_PRICE_SYNC_FIX_PLAN.md)
   - Change deployment protection to "Only Preview Deployments"
   - Verify CRON_SECRET configuration

2. **Run pending migration for IndexConstituent table**
   ```bash
   npx prisma migrate dev
   ```

3. **Remove unused indexes** (saves ~6.3 MB)
   ```sql
   DROP INDEX idx_card_history_jpy;
   DROP INDEX idx_card_prices_tradein_gbp;
   DROP INDEX idx_card_prices_market_gbp;
   ```

### Short-term Improvements

4. **Implement ExchangeRateHistory population**
   - Track daily JPY/GBP rates
   - Enable FX impact analysis

5. **Populate PriceSource table**
   - Enable multi-channel price comparison
   - Support arbitrage analysis

6. **Add staleness monitoring**
   - Dashboard alert when data > 24h old
   - Automated Slack/email notifications

### Long-term Enhancements

7. **Implement data archival**
   - Move history > 1 year to cold storage
   - Reduce primary DB size

8. **Add read replicas**
   - Separate analytics queries from trade-in lookups
   - Improve read performance

9. **Enable Multi-AZ**
   - Automatic failover for high availability
   - Required for production-grade SLA

---

## Appendix: SQL Queries for Monitoring

```sql
-- Database size
SELECT pg_size_pretty(pg_database_size(current_database()));

-- Table sizes
SELECT relname, pg_size_pretty(pg_total_relation_size(quote_ident(relname)))
FROM pg_stat_user_tables ORDER BY pg_total_relation_size(quote_ident(relname)) DESC;

-- Price history growth by month
SELECT to_char(snapshot_date, 'YYYY-MM') as month, COUNT(*)
FROM card_price_history GROUP BY 1 ORDER BY 1 DESC LIMIT 12;

-- Stale data check
SELECT
  'JapanesePriceSource' as table_name,
  MAX(updated_at) as last_update,
  EXTRACT(EPOCH FROM (NOW() - MAX(updated_at)))/3600 as hours_stale
FROM japanese_price_source
UNION ALL
SELECT
  'CardPriceV2',
  MAX(last_updated),
  EXTRACT(EPOCH FROM (NOW() - MAX(last_updated)))/3600
FROM card_prices_v2;

-- Unused indexes
SELECT indexrelname, pg_size_pretty(pg_relation_size(indexrelid)), idx_scan
FROM pg_stat_user_indexes WHERE idx_scan = 0;
```
