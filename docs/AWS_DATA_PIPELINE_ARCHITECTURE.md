# AWS Data Pipeline Architecture for TCG ML System

## Executive Summary

This document outlines the complete AWS infrastructure for ingesting, processing, and storing trading card price data from global marketplaces. The architecture supports real-time arbitrage detection, historical analysis for ML training, and cross-market price normalization.

**Estimated Monthly Cost**: $1,200-2,500 (depending on data volume and ML usage)

---

## 1. High-Level Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                              EXTERNAL DATA SOURCES                                       │
├─────────────┬─────────────┬─────────────┬─────────────┬─────────────┬─────────────────── │
│  TCGplayer  │  Cardmarket │    eBay     │  Yahoo JP   │  Mercari JP │   Social/News     │
│    (API)    │    (API)    │    (API)    │  (Scraper)  │  (Scraper)  │   (APIs/RSS)      │
└──────┬──────┴──────┬──────┴──────┬──────┴──────┬──────┴──────┬──────┴────────┬──────────┘
       │             │             │             │             │               │
       ▼             ▼             ▼             ▼             ▼               ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                              INGESTION LAYER (AWS)                                       │
│  ┌─────────────────────────────────────────────────────────────────────────────────┐    │
│  │                        API Gateway + Lambda Collectors                           │    │
│  │   ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐  │    │
│  │   │TCGplayer│  │Cardmkt  │  │  eBay   │  │Yahoo JP │  │Mercari  │  │ Social  │  │    │
│  │   │Collector│  │Collector│  │Collector│  │Collector│  │Collector│  │Collector│  │    │
│  │   └────┬────┘  └────┬────┘  └────┬────┘  └────┬────┘  └────┬────┘  └────┬────┘  │    │
│  └────────┼────────────┼────────────┼────────────┼────────────┼────────────┼───────┘    │
│           └────────────┴────────────┴─────┬──────┴────────────┴────────────┘            │
│                                           ▼                                              │
│  ┌─────────────────────────────────────────────────────────────────────────────────┐    │
│  │                     Kinesis Data Streams (Raw Events)                            │    │
│  │   ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐            │    │
│  │   │price-stream │  │listing-stream│  │sales-stream │  │signal-stream│            │    │
│  │   │  (prices)   │  │  (listings) │  │(transactions)│  │  (social)   │            │    │
│  │   └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘            │    │
│  └──────────┼────────────────┼────────────────┼────────────────┼───────────────────┘    │
└─────────────┼────────────────┼────────────────┼────────────────┼────────────────────────┘
              │                │                │                │
              ▼                ▼                ▼                ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                              PROCESSING LAYER                                            │
│  ┌─────────────────────────────────────────────────────────────────────────────────┐    │
│  │                    Kinesis Data Analytics (Real-time)                            │    │
│  │   • Anomaly detection (immediate arbitrage alerts)                               │    │
│  │   • Price normalization & currency conversion                                    │    │
│  │   • Cross-market spread calculation                                              │    │
│  │   • Deduplication & validation                                                   │    │
│  └──────────────────────────────────┬──────────────────────────────────────────────┘    │
│                                     │                                                    │
│           ┌─────────────────────────┼─────────────────────────┐                         │
│           ▼                         ▼                         ▼                         │
│  ┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐                 │
│  │  Kinesis Firehose│      │   Lambda        │      │   SNS/SQS       │                 │
│  │  (S3 Delivery)  │      │ (Enrichment)    │      │  (Alerts)       │                 │
│  └────────┬────────┘      └────────┬────────┘      └────────┬────────┘                 │
└───────────┼────────────────────────┼────────────────────────┼───────────────────────────┘
            │                        │                        │
            ▼                        ▼                        ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                              STORAGE LAYER                                               │
│                                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────────────┐    │
│  │                           S3 Data Lake                                           │    │
│  │   ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐            │    │
│  │   │   raw/      │  │  processed/ │  │  features/  │  │   models/   │            │    │
│  │   │ (landing)   │  │ (cleaned)   │  │ (ML ready)  │  │  (trained)  │            │    │
│  │   └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘            │    │
│  └─────────────────────────────────────────────────────────────────────────────────┘    │
│                                                                                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────────┐    │
│  │  Timestream │  │  DynamoDB   │  │    RDS      │  │  SageMaker Feature Store    │    │
│  │(time series)│  │ (real-time) │  │(relational) │  │     (ML features)           │    │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────────────────┘
              │                        │                        │
              ▼                        ▼                        ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                              ML/ANALYTICS LAYER                                          │
│                                                                                          │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐    │
│  │   SageMaker     │  │   SageMaker     │  │      Glue       │  │    Athena       │    │
│  │   Training      │  │   Endpoints     │  │   ETL Jobs      │  │   Analytics     │    │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘  └─────────────────┘    │
│                                                                                          │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Data Source Analysis

### 2.1 Source Characteristics Matrix

| Source | Type | Rate Limit | Update Freq | Data Quality | Auth Method |
|--------|------|------------|-------------|--------------|-------------|
| **TCGplayer** | REST API | 300/min | Real-time | High | API Key |
| **Cardmarket** | REST API | 100/min | 15 min | High | OAuth 1.0a |
| **eBay** | REST API | 5000/day | Real-time | Medium | OAuth 2.0 |
| **Yahoo JP** | Scraping | N/A | 30 min | Medium | Proxy |
| **Mercari JP** | Scraping | N/A | 30 min | Medium | Proxy |
| **CardTrader** | REST API | 60/min | Hourly | High | API Key |
| **Twitter/X** | API v2 | 300/15min | Real-time | Low | OAuth 2.0 |
| **YouTube** | Data API | 10000/day | Hourly | Low | API Key |

### 2.2 Data Volume Estimates

```
┌────────────────────────────────────────────────────────────────────────┐
│                    Daily Data Volume Estimates                          │
├────────────────────┬───────────────┬───────────────┬───────────────────┤
│      Source        │   Records/Day │   Size/Day    │   Annual Size     │
├────────────────────┼───────────────┼───────────────┼───────────────────┤
│ TCGplayer Prices   │    500,000    │    150 MB     │     55 GB         │
│ Cardmarket Prices  │    300,000    │     90 MB     │     33 GB         │
│ eBay Listings      │    100,000    │     80 MB     │     29 GB         │
│ Yahoo JP           │     50,000    │     40 MB     │     15 GB         │
│ Mercari JP         │     30,000    │     25 MB     │      9 GB         │
│ Sales/Transactions │    200,000    │     60 MB     │     22 GB         │
│ Social Signals     │     20,000    │     10 MB     │      4 GB         │
│ Card Images        │      5,000    │    500 MB     │    180 GB         │
├────────────────────┼───────────────┼───────────────┼───────────────────┤
│ TOTAL              │  1,205,000    │    955 MB     │    347 GB         │
└────────────────────┴───────────────┴───────────────┴───────────────────┘
```

---

## 3. Detailed Component Architecture

### 3.1 Ingestion Layer - Lambda Collectors

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         COLLECTOR ARCHITECTURE                               │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                    EventBridge Scheduler                                │ │
│  │   ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐              │ │
│  │   │ 5 min    │  │ 15 min   │  │ 30 min   │  │ hourly   │              │ │
│  │   │(TCGplayer│  │(Cardmkt) │  │(Yahoo/   │  │(social)  │              │ │
│  │   │ eBay)    │  │          │  │ Mercari) │  │          │              │ │
│  │   └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘              │ │
│  └────────┼─────────────┼─────────────┼─────────────┼────────────────────┘ │
│           │             │             │             │                       │
│           ▼             ▼             ▼             ▼                       │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                    Lambda Collector Functions                           │ │
│  │                                                                         │ │
│  │  ┌─────────────────────────────────────────────────────────────────┐   │ │
│  │  │  tcg-collector                                                   │   │ │
│  │  │  ├── fetch_price_updates()     # Incremental price changes      │   │ │
│  │  │  ├── fetch_recent_sales()      # Last 5 min transactions        │   │ │
│  │  │  ├── fetch_listings()          # Active listings snapshot       │   │ │
│  │  │  └── handle_rate_limit()       # Exponential backoff            │   │ │
│  │  └─────────────────────────────────────────────────────────────────┘   │ │
│  │                                                                         │ │
│  │  ┌─────────────────────────────────────────────────────────────────┐   │ │
│  │  │  cardmarket-collector                                            │   │ │
│  │  │  ├── fetch_article_prices()    # Seller article prices          │   │ │
│  │  │  ├── fetch_wants_lists()       # Demand signal                  │   │ │
│  │  │  ├── fetch_price_guide()       # Official price guide           │   │ │
│  │  │  └── currency_convert()        # EUR -> GBP/USD                 │   │ │
│  │  └─────────────────────────────────────────────────────────────────┘   │ │
│  │                                                                         │ │
│  │  ┌─────────────────────────────────────────────────────────────────┐   │ │
│  │  │  japan-collector (Yahoo/Mercari)                                 │   │ │
│  │  │  ├── scrape_with_proxy()       # Rotating proxy pool            │   │ │
│  │  │  ├── parse_japanese_text()     # OCR/NLP for card names         │   │ │
│  │  │  ├── match_to_catalog()        # Fuzzy match to card database   │   │ │
│  │  │  └── convert_jpy()             # JPY -> GBP/USD                 │   │ │
│  │  └─────────────────────────────────────────────────────────────────┘   │ │
│  │                                                                         │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
│                                        │                                     │
│                                        ▼                                     │
│  ┌─────────────────────────────────────────────────────────────────────────┐ │
│  │                    Kinesis Data Streams                                  │ │
│  │                                                                          │ │
│  │    price-events    listing-events    sales-events    signal-events      │ │
│  │    ────────────    ──────────────    ────────────    ─────────────      │ │
│  │    10 shards       5 shards          5 shards        2 shards           │ │
│  │    24hr retention  24hr retention    7d retention    24hr retention     │ │
│  │                                                                          │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Real-time Processing Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    KINESIS DATA ANALYTICS APPLICATION                        │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                    Apache Flink SQL Processing                          │ │
│  │                                                                         │ │
│  │  -- 1. PRICE NORMALIZATION                                              │ │
│  │  CREATE TABLE normalized_prices AS                                      │ │
│  │  SELECT                                                                 │ │
│  │    card_id,                                                             │ │
│  │    source,                                                              │ │
│  │    price * fx_rate AS price_usd,                                        │ │
│  │    price * fx_rate * 0.79 AS price_gbp,                                 │ │
│  │    condition,                                                           │ │
│  │    event_time,                                                          │ │
│  │    TUMBLE_START(event_time, INTERVAL '1' MINUTE) as window_start        │ │
│  │  FROM price_stream p                                                    │ │
│  │  JOIN fx_rates f ON p.currency = f.currency;                            │ │
│  │                                                                         │ │
│  │  -- 2. CROSS-MARKET SPREAD CALCULATION                                  │ │
│  │  CREATE TABLE market_spreads AS                                         │ │
│  │  SELECT                                                                 │ │
│  │    card_id,                                                             │ │
│  │    tcg_price,                                                           │ │
│  │    cm_price,                                                            │ │
│  │    (tcg_price - cm_price) / tcg_price AS tcg_cm_spread,                 │ │
│  │    (tcg_price - ebay_price) / tcg_price AS tcg_ebay_spread,             │ │
│  │    CASE                                                                 │ │
│  │      WHEN ABS(tcg_cm_spread) > 0.15 THEN 'ARBITRAGE'                    │ │
│  │      WHEN ABS(tcg_cm_spread) > 0.10 THEN 'OPPORTUNITY'                  │ │
│  │      ELSE 'NORMAL'                                                      │ │
│  │    END AS spread_status                                                 │ │
│  │  FROM (                                                                 │ │
│  │    SELECT card_id,                                                      │ │
│  │      MAX(CASE WHEN source='tcgplayer' THEN price_usd END) as tcg_price, │ │
│  │      MAX(CASE WHEN source='cardmarket' THEN price_usd END) as cm_price, │ │
│  │      MAX(CASE WHEN source='ebay' THEN price_usd END) as ebay_price      │ │
│  │    FROM normalized_prices                                               │ │
│  │    GROUP BY card_id, TUMBLE(event_time, INTERVAL '5' MINUTE)            │ │
│  │  );                                                                     │ │
│  │                                                                         │ │
│  │  -- 3. REAL-TIME ANOMALY DETECTION                                      │ │
│  │  CREATE TABLE anomalies AS                                              │ │
│  │  SELECT                                                                 │ │
│  │    *,                                                                   │ │
│  │    (price_usd - avg_price) / stddev_price AS z_score                    │ │
│  │  FROM normalized_prices p                                               │ │
│  │  JOIN (                                                                 │ │
│  │    SELECT card_id, AVG(price_usd) as avg_price,                         │ │
│  │           STDDEV(price_usd) as stddev_price                             │ │
│  │    FROM normalized_prices                                               │ │
│  │    WHERE event_time > CURRENT_TIMESTAMP - INTERVAL '7' DAY              │ │
│  │    GROUP BY card_id                                                     │ │
│  │  ) stats ON p.card_id = stats.card_id                                   │ │
│  │  WHERE ABS((price_usd - avg_price) / stddev_price) > 2.5;               │ │
│  │                                                                         │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│           │                    │                    │                        │
│           ▼                    ▼                    ▼                        │
│  ┌─────────────┐      ┌─────────────┐      ┌─────────────┐                  │
│  │  Firehose   │      │    SNS      │      │  DynamoDB   │                  │
│  │  (S3 sink)  │      │  (Alerts)   │      │ (Real-time) │                  │
│  └─────────────┘      └─────────────┘      └─────────────┘                  │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 3.3 Storage Layer - S3 Data Lake Structure

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         S3 DATA LAKE STRUCTURE                               │
│                                                                              │
│  s3://tcg-ml-data-{env}/                                                    │
│  │                                                                           │
│  ├── raw/                           # Landing zone (immutable)               │
│  │   ├── tcgplayer/                                                          │
│  │   │   ├── prices/                                                         │
│  │   │   │   └── year=2024/month=01/day=15/hour=14/                         │
│  │   │   │       └── prices_20240115_1400.parquet                           │
│  │   │   ├── sales/                                                          │
│  │   │   └── listings/                                                       │
│  │   ├── cardmarket/                                                         │
│  │   ├── ebay/                                                               │
│  │   ├── yahoo_jp/                                                           │
│  │   ├── mercari_jp/                                                         │
│  │   └── social/                                                             │
│  │                                                                           │
│  ├── processed/                     # Cleaned & validated                    │
│  │   ├── unified_prices/            # Cross-market normalized                │
│  │   │   └── year=2024/month=01/day=15/                                     │
│  │   │       └── unified_prices_20240115.parquet                            │
│  │   ├── market_spreads/            # Calculated spreads                     │
│  │   ├── sales_history/             # Deduplicated transactions              │
│  │   └── card_catalog/              # Master card database                   │
│  │                                                                           │
│  ├── features/                      # ML-ready feature sets                  │
│  │   ├── demand/                    # 55 demand features                     │
│  │   │   └── card_id=OP01-001/                                              │
│  │   │       └── features_20240115.parquet                                  │
│  │   ├── quality/                   # 30 quality features                    │
│  │   ├── anomaly/                   # 13 anomaly features                    │
│  │   └── timing/                    # Time series features                   │
│  │                                                                           │
│  ├── training/                      # Training datasets                      │
│  │   ├── demand_model/                                                       │
│  │   │   ├── train/                                                          │
│  │   │   ├── validation/                                                     │
│  │   │   └── test/                                                           │
│  │   ├── quality_model/                                                      │
│  │   ├── anomaly_model/                                                      │
│  │   └── timing_model/                                                       │
│  │                                                                           │
│  ├── models/                        # Trained model artifacts                │
│  │   ├── demand/                                                             │
│  │   │   ├── v1.0.0/                                                         │
│  │   │   │   ├── model.tar.gz                                               │
│  │   │   │   └── metrics.json                                               │
│  │   │   └── latest -> v1.0.0                                               │
│  │   ├── quality/                                                            │
│  │   ├── anomaly/                                                            │
│  │   ├── timing/                                                             │
│  │   └── vision/                                                             │
│  │                                                                           │
│  └── images/                        # Card images for vision model           │
│      ├── raw/                       # Original scraped images                │
│      └── processed/                 # Resized, normalized                    │
│          └── OP01/                                                           │
│              └── OP01-001.png                                                │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 3.4 Database Schema Design

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         DATABASE ARCHITECTURE                                │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                    Amazon Timestream (Time Series)                      │ │
│  │                                                                         │ │
│  │  Database: tcg_prices                                                   │ │
│  │  ├── Table: price_history                                               │ │
│  │  │   Dimensions: card_id, source, condition, currency                   │ │
│  │  │   Measures: price, volume, listings_count                            │ │
│  │  │   Memory retention: 7 days                                           │ │
│  │  │   Magnetic retention: 2 years                                        │ │
│  │  │                                                                      │ │
│  │  └── Table: market_spreads                                              │ │
│  │      Dimensions: card_id                                                │ │
│  │      Measures: tcg_cm_spread, tcg_ebay_spread, jp_us_spread             │ │
│  │                                                                         │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                    Amazon DynamoDB (Real-time)                          │ │
│  │                                                                         │ │
│  │  Table: current_prices                                                  │ │
│  │  ├── PK: card_id                                                        │ │
│  │  ├── SK: source#condition                                               │ │
│  │  ├── Attributes:                                                        │ │
│  │  │   - price_usd, price_gbp, price_eur                                  │ │
│  │  │   - listings_count                                                   │ │
│  │  │   - last_updated                                                     │ │
│  │  │   - z_score (for anomaly detection)                                  │ │
│  │  └── GSI: source-price-index (for cross-market queries)                 │ │
│  │                                                                         │ │
│  │  Table: arbitrage_opportunities                                         │ │
│  │  ├── PK: card_id                                                        │ │
│  │  ├── SK: timestamp                                                      │ │
│  │  ├── TTL: 24 hours                                                      │ │
│  │  └── Attributes: buy_source, sell_source, spread, net_profit            │ │
│  │                                                                         │ │
│  │  Table: ml_predictions                                                  │ │
│  │  ├── PK: card_id                                                        │ │
│  │  ├── SK: model#version                                                  │ │
│  │  └── Attributes: prediction, confidence, features_hash, timestamp       │ │
│  │                                                                         │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                    Amazon RDS PostgreSQL (Relational)                   │ │
│  │                                                                         │ │
│  │  -- Card Catalog (Master Data)                                          │ │
│  │  CREATE TABLE cards (                                                   │ │
│  │    card_id VARCHAR(50) PRIMARY KEY,                                     │ │
│  │    name VARCHAR(200),                                                   │ │
│  │    set_code VARCHAR(10),                                                │ │
│  │    card_number VARCHAR(10),                                             │ │
│  │    variant_type VARCHAR(20),                                            │ │
│  │    rarity VARCHAR(20),                                                  │ │
│  │    game VARCHAR(20),                                                    │ │
│  │    release_date DATE,                                                   │ │
│  │    image_url TEXT,                                                      │ │
│  │    created_at TIMESTAMP DEFAULT NOW()                                   │ │
│  │  );                                                                     │ │
│  │                                                                         │ │
│  │  -- Card ID Mappings (Cross-platform)                                   │ │
│  │  CREATE TABLE card_id_mappings (                                        │ │
│  │    internal_card_id VARCHAR(50) REFERENCES cards(card_id),              │ │
│  │    source VARCHAR(20),                                                  │ │
│  │    external_id VARCHAR(100),                                            │ │
│  │    external_name VARCHAR(200),                                          │ │
│  │    confidence DECIMAL(3,2),                                             │ │
│  │    PRIMARY KEY (internal_card_id, source)                               │ │
│  │  );                                                                     │ │
│  │                                                                         │ │
│  │  -- Platform Metadata                                                   │ │
│  │  CREATE TABLE platforms (                                               │ │
│  │    platform_id VARCHAR(20) PRIMARY KEY,                                 │ │
│  │    name VARCHAR(50),                                                    │ │
│  │    seller_fee DECIMAL(5,4),                                             │ │
│  │    buyer_fee DECIMAL(5,4),                                              │ │
│  │    fixed_fee DECIMAL(10,2),                                             │ │
│  │    currency VARCHAR(3),                                                 │ │
│  │    region VARCHAR(10)                                                   │ │
│  │  );                                                                     │ │
│  │                                                                         │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                    SageMaker Feature Store                              │ │
│  │                                                                         │ │
│  │  Feature Group: demand_features                                         │ │
│  │  ├── record_identifier: card_id                                         │ │
│  │  ├── event_time: feature_timestamp                                      │ │
│  │  └── features: (55 demand features)                                     │ │
│  │      - price_change_7d, price_change_30d, rsi_14, macd, ...             │ │
│  │                                                                         │ │
│  │  Feature Group: quality_features                                        │ │
│  │  ├── record_identifier: listing_id                                      │ │
│  │  └── features: (30 quality features)                                    │ │
│  │                                                                         │ │
│  │  Feature Group: anomaly_features                                        │ │
│  │  ├── record_identifier: listing_id                                      │ │
│  │  └── features: (13 anomaly features)                                    │ │
│  │                                                                         │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Data Processing Pipeline (Batch)

### 4.1 AWS Glue ETL Pipeline

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         GLUE ETL PIPELINE                                    │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                    Daily ETL Workflow                                   │ │
│  │                                                                         │ │
│  │  ┌─────────┐   ┌─────────┐   ┌─────────┐   ┌─────────┐   ┌─────────┐  │ │
│  │  │ Extract │──▶│ Validate│──▶│Transform│──▶│ Feature │──▶│  Load   │  │ │
│  │  │  Raw    │   │ & Clean │   │& Enrich │   │  Eng.   │   │ to S3/  │  │ │
│  │  │  Data   │   │  Data   │   │  Data   │   │         │   │ Feature │  │ │
│  │  │         │   │         │   │         │   │         │   │  Store  │  │ │
│  │  └─────────┘   └─────────┘   └─────────┘   └─────────┘   └─────────┘  │ │
│  │       │             │             │             │             │        │ │
│  │       ▼             ▼             ▼             ▼             ▼        │ │
│  │  ┌─────────────────────────────────────────────────────────────────┐   │ │
│  │  │                    Glue Job: tcg_daily_etl                       │   │ │
│  │  │                                                                  │   │ │
│  │  │  # Job 1: Raw Data Consolidation                                │   │ │
│  │  │  def consolidate_raw():                                          │   │ │
│  │  │      # Read from all source partitions                           │   │ │
│  │  │      tcg_df = spark.read.parquet("s3://raw/tcgplayer/...")       │   │ │
│  │  │      cm_df = spark.read.parquet("s3://raw/cardmarket/...")       │   │ │
│  │  │      # ... other sources                                         │   │ │
│  │  │      return union_all_sources()                                  │   │ │
│  │  │                                                                  │   │ │
│  │  │  # Job 2: Data Validation                                        │   │ │
│  │  │  def validate_data(df):                                          │   │ │
│  │  │      # Check for required fields                                 │   │ │
│  │  │      # Validate price ranges (e.g., $0.01 - $100,000)            │   │ │
│  │  │      # Check timestamp validity                                  │   │ │
│  │  │      # Flag suspicious records                                   │   │ │
│  │  │      return df.filter(valid_records)                             │   │ │
│  │  │                                                                  │   │ │
│  │  │  # Job 3: Card ID Resolution                                     │   │ │
│  │  │  def resolve_card_ids(df):                                       │   │ │
│  │  │      # Join with card_id_mappings                                │   │ │
│  │  │      # Fuzzy match unresolved cards                              │   │ │
│  │  │      # Flag for manual review if confidence < 0.8                │   │ │
│  │  │      return df_with_internal_ids                                 │   │ │
│  │  │                                                                  │   │ │
│  │  │  # Job 4: Currency Normalization                                 │   │ │
│  │  │  def normalize_currencies(df):                                   │   │ │
│  │  │      fx_rates = get_daily_fx_rates()                             │   │ │
│  │  │      return df.withColumn("price_usd", col("price") * fx_rate)   │   │ │
│  │  │              .withColumn("price_gbp", col("price_usd") * 0.79)   │   │ │
│  │  │                                                                  │   │ │
│  │  │  # Job 5: Feature Engineering                                    │   │ │
│  │  │  def engineer_features(df):                                      │   │ │
│  │  │      # Calculate rolling windows                                 │   │ │
│  │  │      window_7d = Window.partitionBy("card_id")                   │   │ │
│  │  │                       .orderBy("timestamp")                      │   │ │
│  │  │                       .rangeBetween(-7*86400, 0)                 │   │ │
│  │  │      df = df.withColumn("avg_price_7d", avg("price").over(w7d))  │   │ │
│  │  │      df = df.withColumn("rsi_14", calculate_rsi())               │   │ │
│  │  │      # ... 55 demand features                                    │   │ │
│  │  │      return df                                                   │   │ │
│  │  │                                                                  │   │ │
│  │  └──────────────────────────────────────────────────────────────────┘   │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                    Step Functions Orchestration                        │ │
│  │                                                                         │ │
│  │  ┌─────────────────────────────────────────────────────────────────┐   │ │
│  │  │                                                                  │   │ │
│  │  │  {                                                               │   │ │
│  │  │    "StartAt": "CheckSourceData",                                 │   │ │
│  │  │    "States": {                                                   │   │ │
│  │  │      "CheckSourceData": {                                        │   │ │
│  │  │        "Type": "Task",                                           │   │ │
│  │  │        "Resource": "arn:aws:lambda:check-data-availability",     │   │ │
│  │  │        "Next": "ParallelExtract"                                 │   │ │
│  │  │      },                                                          │   │ │
│  │  │      "ParallelExtract": {                                        │   │ │
│  │  │        "Type": "Parallel",                                       │   │ │
│  │  │        "Branches": [                                             │   │ │
│  │  │          { "StartAt": "ExtractTCGplayer" },                      │   │ │
│  │  │          { "StartAt": "ExtractCardmarket" },                     │   │ │
│  │  │          { "StartAt": "ExtractEbay" },                           │   │ │
│  │  │          { "StartAt": "ExtractJapan" }                           │   │ │
│  │  │        ],                                                        │   │ │
│  │  │        "Next": "ConsolidateData"                                 │   │ │
│  │  │      },                                                          │   │ │
│  │  │      "ConsolidateData": {                                        │   │ │
│  │  │        "Type": "Task",                                           │   │ │
│  │  │        "Resource": "arn:aws:glue:job/tcg_consolidate",           │   │ │
│  │  │        "Next": "FeatureEngineering"                              │   │ │
│  │  │      },                                                          │   │ │
│  │  │      "FeatureEngineering": {                                     │   │ │
│  │  │        "Type": "Task",                                           │   │ │
│  │  │        "Resource": "arn:aws:glue:job/tcg_features",              │   │ │
│  │  │        "Next": "UpdateFeatureStore"                              │   │ │
│  │  │      },                                                          │   │ │
│  │  │      "UpdateFeatureStore": {                                     │   │ │
│  │  │        "Type": "Task",                                           │   │ │
│  │  │        "Resource": "arn:aws:lambda:update-feature-store",        │   │ │
│  │  │        "End": true                                               │   │ │
│  │  │      }                                                           │   │ │
│  │  │    }                                                             │   │ │
│  │  │  }                                                               │   │ │
│  │  │                                                                  │   │ │
│  │  └──────────────────────────────────────────────────────────────────┘   │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 5. ML Training Pipeline

### 5.1 SageMaker Training Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         SAGEMAKER TRAINING PIPELINE                          │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                    SageMaker Pipelines Workflow                         │ │
│  │                                                                         │ │
│  │  ┌─────────┐   ┌─────────┐   ┌─────────┐   ┌─────────┐   ┌─────────┐  │ │
│  │  │  Data   │──▶│  Data   │──▶│ Train   │──▶│ Evaluate│──▶│ Register│  │ │
│  │  │ Prep    │   │  Split  │   │  Model  │   │  Model  │   │  Model  │  │ │
│  │  └─────────┘   └─────────┘   └─────────┘   └─────────┘   └─────────┘  │ │
│  │                                   │                           │        │ │
│  │                                   ▼                           ▼        │ │
│  │                          ┌─────────────┐             ┌─────────────┐   │ │
│  │                          │   Hyper-    │             │   Model     │   │ │
│  │                          │  parameter  │             │  Registry   │   │ │
│  │                          │   Tuning    │             │             │   │ │
│  │                          └─────────────┘             └─────────────┘   │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                    Model Training Configurations                        │ │
│  │                                                                         │ │
│  │  ┌─────────────────────────────────────────────────────────────────┐   │ │
│  │  │  DEMAND MODEL (XGBoost)                                          │   │ │
│  │  │  ├── Instance: ml.m5.xlarge                                      │   │ │
│  │  │  ├── Training data: s3://training/demand_model/                  │   │ │
│  │  │  ├── Features: 55                                                │   │ │
│  │  │  ├── Target: price_change_30d (regression)                       │   │ │
│  │  │  │           price_movement (classification)                     │   │ │
│  │  │  ├── Hyperparameters:                                            │   │ │
│  │  │  │   - max_depth: [4, 6, 8]                                      │   │ │
│  │  │  │   - learning_rate: [0.01, 0.05, 0.1]                          │   │ │
│  │  │  │   - n_estimators: [100, 200, 500]                             │   │ │
│  │  │  │   - colsample_bytree: [0.7, 0.8, 0.9]                         │   │ │
│  │  │  └── Metrics: RMSE, Accuracy, F1-score                           │   │ │
│  │  └──────────────────────────────────────────────────────────────────┘   │ │
│  │                                                                         │ │
│  │  ┌─────────────────────────────────────────────────────────────────┐   │ │
│  │  │  QUALITY MODEL (Logistic Regression / Random Forest)             │   │ │
│  │  │  ├── Instance: ml.m5.large                                       │   │ │
│  │  │  ├── Training data: s3://training/quality_model/                 │   │ │
│  │  │  ├── Features: 30                                                │   │ │
│  │  │  ├── Target: listing_quality (multi-class)                       │   │ │
│  │  │  │           [legitimate, suspicious, likely_fake, scam]         │   │ │
│  │  │  └── Metrics: Precision, Recall, AUC-ROC                         │   │ │
│  │  └──────────────────────────────────────────────────────────────────┘   │ │
│  │                                                                         │ │
│  │  ┌─────────────────────────────────────────────────────────────────┐   │ │
│  │  │  ANOMALY MODEL (Isolation Forest)                                │   │ │
│  │  │  ├── Instance: ml.m5.large                                       │   │ │
│  │  │  ├── Training data: s3://training/anomaly_model/                 │   │ │
│  │  │  ├── Features: 13                                                │   │ │
│  │  │  ├── Unsupervised: contamination = 0.05                          │   │ │
│  │  │  └── Metrics: Precision@k, False positive rate                   │   │ │
│  │  └──────────────────────────────────────────────────────────────────┘   │ │
│  │                                                                         │ │
│  │  ┌─────────────────────────────────────────────────────────────────┐   │ │
│  │  │  TIMING MODEL (Prophet / ARIMA)                                  │   │ │
│  │  │  ├── Instance: ml.m5.xlarge                                      │   │ │
│  │  │  ├── Training data: s3://training/timing_model/                  │   │ │
│  │  │  ├── Per-card time series (top 1000 cards)                       │   │ │
│  │  │  └── Metrics: MAPE, MAE                                          │   │ │
│  │  └──────────────────────────────────────────────────────────────────┘   │ │
│  │                                                                         │ │
│  │  ┌─────────────────────────────────────────────────────────────────┐   │ │
│  │  │  VISION MODEL (CNN / Vision Transformer)                         │   │ │
│  │  │  ├── Instance: ml.g4dn.xlarge (GPU)                              │   │ │
│  │  │  ├── Training data: s3://images/processed/                       │   │ │
│  │  │  ├── Tasks:                                                      │   │ │
│  │  │  │   - Card identification (classification)                      │   │ │
│  │  │  │   - Condition grading (regression)                            │   │ │
│  │  │  │   - Language detection (classification)                       │   │ │
│  │  │  │   - Authenticity (binary classification)                      │   │ │
│  │  │  └── Metrics: Top-1/Top-5 accuracy, MSE for grading              │   │ │
│  │  └──────────────────────────────────────────────────────────────────┘   │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 6. Data Quality & Monitoring

### 6.1 Data Quality Framework

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         DATA QUALITY FRAMEWORK                               │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                    Quality Checks at Each Stage                         │ │
│  │                                                                         │ │
│  │  INGESTION QUALITY                                                      │ │
│  │  ├── Schema validation (JSON Schema)                                    │ │
│  │  ├── Required field presence                                            │ │
│  │  ├── Data type validation                                               │ │
│  │  ├── Timestamp recency (< 1 hour old)                                   │ │
│  │  └── Source authentication verification                                 │ │
│  │                                                                         │ │
│  │  PROCESSING QUALITY                                                     │ │
│  │  ├── Price range validation ($0.01 - $100,000)                          │ │
│  │  ├── Currency code validation (ISO 4217)                                │ │
│  │  ├── Card ID resolution confidence > 80%                                │ │
│  │  ├── Duplicate detection (same card/source/time)                        │ │
│  │  └── Outlier flagging (z-score > 4)                                     │ │
│  │                                                                         │ │
│  │  FEATURE QUALITY                                                        │ │
│  │  ├── Feature completeness (< 5% null)                                   │ │
│  │  ├── Feature distribution drift detection                               │ │
│  │  ├── Correlation matrix stability                                       │ │
│  │  └── Feature importance consistency                                     │ │
│  │                                                                         │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                    CloudWatch Monitoring Dashboard                      │ │
│  │                                                                         │ │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐         │ │
│  │  │  Data Freshness │  │  Data Volume    │  │  Error Rate     │         │ │
│  │  │  ┌───────────┐  │  │  ┌───────────┐  │  │  ┌───────────┐  │         │ │
│  │  │  │  TCG: 3m  │  │  │  │▓▓▓▓▓▓░░░░│  │  │  │  0.02%    │  │         │ │
│  │  │  │  CM: 12m  │  │  │  │500K/day   │  │  │  │  Target   │  │         │ │
│  │  │  │  eBay: 5m │  │  │  │           │  │  │  │  <0.1%    │  │         │ │
│  │  │  │  JP: 28m  │  │  │  │           │  │  │  │           │  │         │ │
│  │  │  └───────────┘  │  │  └───────────┘  │  │  └───────────┘  │         │ │
│  │  └─────────────────┘  └─────────────────┘  └─────────────────┘         │ │
│  │                                                                         │ │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐         │ │
│  │  │  Card Coverage  │  │  Price Accuracy │  │  Latency P99    │         │ │
│  │  │  ┌───────────┐  │  │  ┌───────────┐  │  │  ┌───────────┐  │         │ │
│  │  │  │  95.3%    │  │  │  │  ±2.1%    │  │  │  │  450ms    │  │         │ │
│  │  │  │  of known │  │  │  │  vs manual│  │  │  │  real-time│  │         │ │
│  │  │  │  cards    │  │  │  │  check    │  │  │  │  pipeline │  │         │ │
│  │  │  └───────────┘  │  │  └───────────┘  │  │  └───────────┘  │         │ │
│  │  └─────────────────┘  └─────────────────┘  └─────────────────┘         │ │
│  │                                                                         │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                    Alerting Rules                                       │ │
│  │                                                                         │ │
│  │  CRITICAL (PagerDuty)                                                   │ │
│  │  ├── Data freshness > 1 hour for any source                             │ │
│  │  ├── Error rate > 5%                                                    │ │
│  │  ├── ML endpoint latency P99 > 5 seconds                                │ │
│  │  └── Feature store update failure                                       │ │
│  │                                                                         │ │
│  │  WARNING (Slack)                                                        │ │
│  │  ├── Data freshness > 30 minutes                                        │ │
│  │  ├── Error rate > 1%                                                    │ │
│  │  ├── Unusual price volatility (z-score > 3)                             │ │
│  │  └── Model drift detected                                               │ │
│  │                                                                         │ │
│  │  INFO (CloudWatch Logs)                                                 │ │
│  │  ├── Daily data quality report                                          │ │
│  │  ├── Feature distribution summary                                       │ │
│  │  └── Model performance metrics                                          │ │
│  │                                                                         │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 7. Cost Analysis

### 7.1 Monthly Cost Breakdown

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         MONTHLY COST ESTIMATES                               │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │  INGESTION & STREAMING                                                  │ │
│  │  ├── Lambda (Collectors)                                                │ │
│  │  │   └── 1M invocations × $0.20/1M = $0.20                              │ │
│  │  │   └── 100GB-seconds × $0.0000166667 = $1.67                          │ │
│  │  ├── Kinesis Data Streams (22 shards)                                   │ │
│  │  │   └── 22 × $0.015/hr × 720hr = $237.60                               │ │
│  │  ├── Kinesis Data Analytics                                             │ │
│  │  │   └── 4 KPU × $0.11/hr × 720hr = $316.80                             │ │
│  │  └── API Gateway                                                        │ │
│  │      └── 1M requests × $3.50/1M = $3.50                                 │ │
│  │  SUBTOTAL: ~$560                                                        │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │  STORAGE                                                                │ │
│  │  ├── S3 (500GB)                                                         │ │
│  │  │   └── Standard: 200GB × $0.023 = $4.60                               │ │
│  │  │   └── IA: 300GB × $0.0125 = $3.75                                    │ │
│  │  ├── Timestream                                                         │ │
│  │  │   └── Memory: 10GB × $0.50 = $5.00                                   │ │
│  │  │   └── Magnetic: 100GB × $0.03 = $3.00                                │ │
│  │  │   └── Queries: 100GB scanned × $0.01 = $1.00                         │ │
│  │  ├── DynamoDB                                                           │ │
│  │  │   └── On-demand: ~$25/month (variable)                               │ │
│  │  ├── RDS PostgreSQL (db.t3.medium)                                      │ │
│  │  │   └── $0.068/hr × 720hr = $49.00                                     │ │
│  │  │   └── Storage: 100GB × $0.115 = $11.50                               │ │
│  │  └── SageMaker Feature Store                                            │ │
│  │      └── Online: 10GB × $0.0008/hr × 720 = $5.76                        │ │
│  │      └── Offline: Included in S3                                        │ │
│  │  SUBTOTAL: ~$110                                                        │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │  PROCESSING                                                             │ │
│  │  ├── Glue ETL Jobs                                                      │ │
│  │  │   └── 10 DPU × 2hr/day × 30 days × $0.44 = $264                      │ │
│  │  ├── Step Functions                                                     │ │
│  │  │   └── 10K state transitions × $0.025/1K = $0.25                      │ │
│  │  └── EventBridge                                                        │ │
│  │      └── 1M events × $1.00/1M = $1.00                                   │ │
│  │  SUBTOTAL: ~$265                                                        │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │  ML/SAGEMAKER                                                           │ │
│  │  ├── Training (weekly)                                                  │ │
│  │  │   └── Demand: ml.m5.xlarge × 4hr × 4 = $3.07                         │ │
│  │  │   └── Vision: ml.g4dn.xlarge × 8hr × 4 = $16.73                      │ │
│  │  │   └── Other models: ~$10                                             │ │
│  │  ├── Inference Endpoints                                                │ │
│  │  │   └── Vision: ml.g4dn.xlarge × 720hr = $376.20                       │ │
│  │  │   └── Demand: ml.m5.large × 720hr = $69.12                           │ │
│  │  └── Hyperparameter Tuning (monthly)                                    │ │
│  │      └── ~$50                                                           │ │
│  │  SUBTOTAL: ~$525                                                        │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │  MONITORING & MISC                                                      │ │
│  │  ├── CloudWatch                                                         │ │
│  │  │   └── Logs: 50GB × $0.50 = $25                                       │ │
│  │  │   └── Metrics: 100 custom × $0.30 = $30                              │ │
│  │  │   └── Dashboards: 3 × $3 = $9                                        │ │
│  │  ├── SNS/SQS                                                            │ │
│  │  │   └── ~$5                                                            │ │
│  │  └── Data Transfer                                                      │ │
│  │      └── ~$20                                                           │ │
│  │  SUBTOTAL: ~$90                                                         │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  ╔════════════════════════════════════════════════════════════════════════╗ │
│  ║  TOTAL ESTIMATED MONTHLY COST: $1,550                                  ║ │
│  ║                                                                        ║ │
│  ║  Cost Optimization Opportunities:                                      ║ │
│  ║  • Reserved Instances for RDS/SageMaker: -30% (~$200)                  ║ │
│  ║  • Spot instances for training: -70% (~$20)                            ║ │
│  ║  • Serverless inference for low-traffic: -50% on endpoints             ║ │
│  ║  • S3 Intelligent Tiering: automatic optimization                      ║ │
│  ║                                                                        ║ │
│  ║  OPTIMIZED MONTHLY COST: ~$1,100 - $1,300                              ║ │
│  ╚════════════════════════════════════════════════════════════════════════╝ │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 8. Implementation Plan

### 8.1 Phase 1: Foundation (Weeks 1-2)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  PHASE 1: FOUNDATION                                                         │
│                                                                              │
│  Week 1: Infrastructure Setup                                                │
│  ├── [ ] Create AWS accounts and IAM roles                                   │
│  ├── [ ] Set up VPC with private subnets                                     │
│  ├── [ ] Deploy S3 buckets with lifecycle policies                           │
│  ├── [ ] Configure Kinesis Data Streams                                      │
│  ├── [ ] Set up RDS PostgreSQL                                               │
│  └── [ ] Create CloudWatch log groups                                        │
│                                                                              │
│  Week 2: Core Data Model                                                     │
│  ├── [ ] Design and create card catalog schema                               │
│  ├── [ ] Implement card ID mapping tables                                    │
│  ├── [ ] Create DynamoDB tables for real-time data                           │
│  ├── [ ] Set up Timestream database                                          │
│  └── [ ] Configure cross-region replication (if needed)                      │
│                                                                              │
│  Deliverables:                                                               │
│  • Terraform/CDK infrastructure code                                         │
│  • Database schemas and migrations                                           │
│  • IAM policies and roles                                                    │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 8.2 Phase 2: Data Ingestion (Weeks 3-5)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  PHASE 2: DATA INGESTION                                                     │
│                                                                              │
│  Week 3: API Collectors                                                      │
│  ├── [ ] Implement TCGplayer collector Lambda                                │
│  │       ├── Price endpoint integration                                      │
│  │       ├── Sales history endpoint                                          │
│  │       └── Rate limiting and retry logic                                   │
│  ├── [ ] Implement Cardmarket collector Lambda                               │
│  │       ├── OAuth 1.0a authentication                                       │
│  │       ├── Article prices endpoint                                         │
│  │       └── Price guide endpoint                                            │
│  └── [ ] Implement eBay collector Lambda                                     │
│          ├── Browse API integration                                          │
│          └── Finding API for completed listings                              │
│                                                                              │
│  Week 4: Scraping Infrastructure                                             │
│  ├── [ ] Set up proxy rotation service                                       │
│  │       ├── Bright Data or ScraperAPI integration                           │
│  │       └── IP rotation logic                                               │
│  ├── [ ] Implement Yahoo Auctions JP scraper                                 │
│  │       ├── Search result parsing                                           │
│  │       ├── Japanese text extraction                                        │
│  │       └── Price/bid parsing                                               │
│  └── [ ] Implement Mercari JP scraper                                        │
│          ├── API reverse engineering                                         │
│          └── Listing extraction                                              │
│                                                                              │
│  Week 5: Stream Processing                                                   │
│  ├── [ ] Configure Kinesis Data Analytics application                        │
│  │       ├── Price normalization SQL                                         │
│  │       ├── Cross-market spread calculation                                 │
│  │       └── Real-time anomaly flagging                                      │
│  ├── [ ] Set up Kinesis Firehose to S3                                       │
│  └── [ ] Configure EventBridge schedules                                     │
│                                                                              │
│  Deliverables:                                                               │
│  • All collector Lambda functions                                            │
│  • Kinesis Analytics SQL applications                                        │
│  • Monitoring dashboards for data flow                                       │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 8.3 Phase 3: ETL & Feature Engineering (Weeks 6-8)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  PHASE 3: ETL & FEATURE ENGINEERING                                          │
│                                                                              │
│  Week 6: Glue ETL Jobs                                                       │
│  ├── [ ] Create raw data consolidation job                                   │
│  ├── [ ] Implement data validation job                                       │
│  │       ├── Schema validation                                               │
│  │       ├── Price range checks                                              │
│  │       └── Duplicate detection                                             │
│  ├── [ ] Create card ID resolution job                                       │
│  │       ├── Exact match logic                                               │
│  │       ├── Fuzzy matching for unresolved                                   │
│  │       └── Manual review queue                                             │
│  └── [ ] Implement currency normalization job                                │
│                                                                              │
│  Week 7: Feature Engineering                                                 │
│  ├── [ ] Implement demand features (55 features)                             │
│  │       ├── Price momentum features                                         │
│  │       ├── Volume/liquidity features                                       │
│  │       ├── Card characteristics features                                   │
│  │       └── External signal features                                        │
│  ├── [ ] Implement quality features (30 features)                            │
│  ├── [ ] Implement anomaly features (13 features)                            │
│  └── [ ] Create feature validation tests                                     │
│                                                                              │
│  Week 8: Feature Store Integration                                           │
│  ├── [ ] Set up SageMaker Feature Store                                      │
│  │       ├── Online store configuration                                      │
│  │       └── Offline store S3 integration                                    │
│  ├── [ ] Create feature ingestion pipeline                                   │
│  ├── [ ] Implement Step Functions orchestration                              │
│  └── [ ] Set up data quality monitoring                                      │
│                                                                              │
│  Deliverables:                                                               │
│  • Complete Glue ETL job suite                                               │
│  • Feature Store with all feature groups                                     │
│  • Step Functions workflow                                                   │
│  • Data quality dashboard                                                    │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 8.4 Phase 4: ML Training Pipeline (Weeks 9-11)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  PHASE 4: ML TRAINING PIPELINE                                               │
│                                                                              │
│  Week 9: Training Data Preparation                                           │
│  ├── [ ] Create training data splits                                         │
│  │       ├── Time-based splitting (no leakage)                               │
│  │       ├── Stratified sampling                                             │
│  │       └── Validation set creation                                         │
│  ├── [ ] Generate labeled datasets                                           │
│  │       ├── Demand: historical price movements                              │
│  │       ├── Quality: manually labeled listings                              │
│  │       └── Vision: card image annotations                                  │
│  └── [ ] Upload to S3 training buckets                                       │
│                                                                              │
│  Week 10: Model Training                                                     │
│  ├── [ ] Train demand model (XGBoost)                                        │
│  │       ├── Hyperparameter tuning                                           │
│  │       ├── Cross-validation                                                │
│  │       └── Feature importance analysis                                     │
│  ├── [ ] Train quality model (Logistic Regression)                           │
│  ├── [ ] Train anomaly model (Isolation Forest)                              │
│  ├── [ ] Train timing model (Prophet)                                        │
│  └── [ ] Train vision model (CNN/ViT)                                        │
│                                                                              │
│  Week 11: Model Deployment                                                   │
│  ├── [ ] Create SageMaker endpoints                                          │
│  │       ├── Multi-model endpoint configuration                              │
│  │       ├── Auto-scaling policies                                           │
│  │       └── A/B testing setup                                               │
│  ├── [ ] Set up model registry                                               │
│  ├── [ ] Create model monitoring                                             │
│  │       ├── Data drift detection                                            │
│  │       ├── Model performance tracking                                      │
│  │       └── Retraining triggers                                             │
│  └── [ ] Deploy Lambda functions for lightweight models                      │
│                                                                              │
│  Deliverables:                                                               │
│  • Trained models in Model Registry                                          │
│  • SageMaker endpoints                                                       │
│  • Model monitoring dashboard                                                │
│  • Automated retraining pipeline                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 8.5 Phase 5: Integration & Testing (Weeks 12-14)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  PHASE 5: INTEGRATION & TESTING                                              │
│                                                                              │
│  Week 12: API Integration                                                    │
│  ├── [ ] Create inference API (API Gateway + Lambda)                         │
│  │       ├── /analyze endpoint                                               │
│  │       ├── /predict endpoint                                               │
│  │       └── /alerts endpoint                                                │
│  ├── [ ] Integrate with CardForum application                                │
│  │       ├── Real-time price lookup                                          │
│  │       ├── Deal detection alerts                                           │
│  │       └── Listing quality scores                                          │
│  └── [ ] Set up WebSocket for real-time alerts                               │
│                                                                              │
│  Week 13: End-to-End Testing                                                 │
│  ├── [ ] Data pipeline integration tests                                     │
│  │       ├── Source to S3 flow                                               │
│  │       ├── ETL job correctness                                             │
│  │       └── Feature Store consistency                                       │
│  ├── [ ] Model inference tests                                               │
│  │       ├── Latency benchmarks                                              │
│  │       ├── Accuracy validation                                             │
│  │       └── Edge case handling                                              │
│  └── [ ] Load testing                                                        │
│          ├── Kinesis throughput                                              │
│          ├── Endpoint scaling                                                │
│          └── Database performance                                            │
│                                                                              │
│  Week 14: Production Readiness                                               │
│  ├── [ ] Security audit                                                      │
│  │       ├── IAM policy review                                               │
│  │       ├── Data encryption verification                                    │
│  │       └── Network security                                                │
│  ├── [ ] Documentation                                                       │
│  │       ├── Architecture diagrams                                           │
│  │       ├── Runbooks                                                        │
│  │       └── API documentation                                               │
│  ├── [ ] Alerting and on-call setup                                          │
│  └── [ ] Go-live checklist completion                                        │
│                                                                              │
│  Deliverables:                                                               │
│  • Production-ready infrastructure                                           │
│  • Complete test suite                                                       │
│  • Documentation and runbooks                                                │
│  • Monitoring and alerting                                                   │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 9. Key Insights & Recommendations

### 9.1 Architecture Decisions

| Decision | Rationale | Alternative Considered |
|----------|-----------|------------------------|
| **Kinesis over Kafka** | Fully managed, native AWS integration, simpler ops | MSK (Kafka) - more flexible but higher ops overhead |
| **Timestream for time series** | Purpose-built, automatic tiering, SQL interface | InfluxDB - more features but self-managed |
| **Glue over EMR** | Serverless, pay-per-use, integrated catalog | EMR - more control but cluster management |
| **Feature Store** | ML-specific, online/offline sync, point-in-time | Custom S3/DynamoDB - more work, less features |
| **Multi-model endpoint** | Cost efficient, single GPU shared | Separate endpoints - simpler but 3x cost |

### 9.2 Risk Mitigation

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         RISK MITIGATION STRATEGIES                           │
│                                                                              │
│  1. DATA SOURCE FAILURES                                                     │
│     Risk: API rate limits, scraping blocks, service outages                  │
│     Mitigation:                                                              │
│     • Exponential backoff with jitter                                        │
│     • Multiple proxy providers for scraping                                  │
│     • Cached fallback data (last known good)                                 │
│     • Alert on freshness degradation                                         │
│                                                                              │
│  2. DATA QUALITY ISSUES                                                      │
│     Risk: Invalid prices, wrong card matches, duplicate data                 │
│     Mitigation:                                                              │
│     • Multi-stage validation pipeline                                        │
│     • Human review queue for low-confidence matches                          │
│     • Anomaly detection on incoming data                                     │
│     • Daily data quality reports                                             │
│                                                                              │
│  3. MODEL DRIFT                                                              │
│     Risk: Model performance degrades over time                               │
│     Mitigation:                                                              │
│     • Continuous monitoring of prediction distribution                       │
│     • Automated retraining on performance thresholds                         │
│     • A/B testing for model updates                                          │
│     • Feature drift detection                                                │
│                                                                              │
│  4. COST OVERRUNS                                                            │
│     Risk: Unexpected data volume or compute costs                            │
│     Mitigation:                                                              │
│     • AWS Budgets with alerts                                                │
│     • Reserved capacity for predictable workloads                            │
│     • Auto-scaling with caps                                                 │
│     • Monthly cost reviews                                                   │
│                                                                              │
│  5. SECURITY BREACHES                                                        │
│     Risk: Unauthorized access, data leaks                                    │
│     Mitigation:                                                              │
│     • Least-privilege IAM policies                                           │
│     • VPC with private subnets                                               │
│     • Encryption at rest and in transit                                      │
│     • Regular security audits                                                │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 9.3 Future Enhancements

1. **Real-time Arbitrage Execution**
   - Integrate with marketplace APIs for automated buying
   - Implement position management and risk controls

2. **Advanced ML Models**
   - Graph neural networks for card relationship modeling
   - Transformer models for market sentiment analysis

3. **Multi-region Deployment**
   - Deploy collectors close to data sources
   - Reduce latency for Japanese market data

4. **Mobile Alerts**
   - Push notifications for arbitrage opportunities
   - React Native app integration

---

## 10. Appendix

### 10.1 Environment Variables

```bash
# AWS Configuration
AWS_REGION=us-east-1
AWS_ACCOUNT_ID=123456789012

# Data Sources
TCGPLAYER_API_KEY=xxx
TCGPLAYER_ACCESS_TOKEN=xxx
CARDMARKET_APP_TOKEN=xxx
CARDMARKET_APP_SECRET=xxx
EBAY_CLIENT_ID=xxx
EBAY_CLIENT_SECRET=xxx

# Proxy Configuration
PROXY_PROVIDER=brightdata
PROXY_USERNAME=xxx
PROXY_PASSWORD=xxx

# Database
RDS_HOST=tcg-ml.xxx.us-east-1.rds.amazonaws.com
RDS_DATABASE=tcg_ml
RDS_USERNAME=admin
RDS_PASSWORD=xxx

# Feature Store
FEATURE_GROUP_DEMAND=demand_features
FEATURE_GROUP_QUALITY=quality_features
FEATURE_GROUP_ANOMALY=anomaly_features

# SageMaker
SAGEMAKER_ROLE_ARN=arn:aws:iam::123456789012:role/SageMakerRole
VISION_ENDPOINT=tcg-vision-prod
DEMAND_ENDPOINT=tcg-demand-prod
```

### 10.2 Useful AWS CLI Commands

```bash
# Check Kinesis stream status
aws kinesis describe-stream --stream-name tcg-price-stream

# List S3 objects in raw bucket
aws s3 ls s3://tcg-ml-data-prod/raw/ --recursive --human-readable

# Get SageMaker endpoint status
aws sagemaker describe-endpoint --endpoint-name tcg-vision-prod

# Query Timestream
aws timestream-query query \
  --query-string "SELECT * FROM tcg_prices.price_history WHERE card_id = 'OP01-121' AND time > ago(7d)"

# Check Glue job runs
aws glue get-job-runs --job-name tcg_daily_etl --max-results 5
```

---

*Document Version: 1.0*
*Last Updated: 2024-01-15*
*Author: ML Architecture Team*
