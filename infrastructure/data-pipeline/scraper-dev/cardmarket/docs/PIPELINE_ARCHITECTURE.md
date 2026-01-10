# Cardmarket to AWS Training Data Pipeline

> **Version**: 1.0.0
> **Last Updated**: January 2026
> **Status**: Production Ready

## Executive Summary

This document describes the end-to-end data pipeline from Cardmarket web scraping to AWS-hosted training data infrastructure. The pipeline is designed for:

- **Reliability**: Circuit breakers, retries, dead-letter queues
- **Scalability**: Serverless architecture, horizontal scaling
- **Observability**: CloudWatch metrics, alerts, dashboards
- **Data Quality**: Validation, transformation, anomaly detection

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         CARDMARKET DATA PIPELINE                                 │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ┌──────────────┐                                                               │
│  │  EventBridge │  Scheduled triggers (8AM/8PM UTC)                             │
│  │   Scheduler  │                                                               │
│  └──────┬───────┘                                                               │
│         │                                                                        │
│         ▼                                                                        │
│  ┌──────────────────────────────────────────────────────────────────────────┐   │
│  │                        AWS STEP FUNCTIONS                                 │   │
│  │                     "CardmarketPipelineStateMachine"                      │   │
│  │  ┌─────────┐   ┌─────────┐   ┌─────────┐   ┌─────────┐   ┌─────────┐    │   │
│  │  │ Scrape  │──▶│ Store   │──▶│Transform│──▶│ Validate│──▶│  Load   │    │   │
│  │  │  Sets   │   │  to S3  │   │  Data   │   │  Data   │   │ to RDS  │    │   │
│  │  └─────────┘   └─────────┘   └─────────┘   └─────────┘   └─────────┘    │   │
│  │       │                                          │             │         │   │
│  │       │                                          ▼             ▼         │   │
│  │       │                                    ┌──────────┐  ┌──────────┐   │   │
│  │       │                                    │  DLQ for │  │ History  │   │   │
│  │       ▼                                    │  Errors  │  │  Table   │   │   │
│  │  ┌─────────┐                              └──────────┘  └──────────┘   │   │
│  │  │ Circuit │                                                            │   │
│  │  │ Breaker │                                                            │   │
│  │  └─────────┘                                                            │   │
│  └──────────────────────────────────────────────────────────────────────────┘   │
│                                                                                  │
├─────────────────────────────────────────────────────────────────────────────────┤
│                              DATA STORAGE LAYER                                  │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │                           Amazon S3                                      │    │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐         │    │
│  │  │   Raw Scrapes   │  │  Transformed    │  │   Training      │         │    │
│  │  │                 │  │     Data        │  │   Exports       │         │    │
│  │  │ /raw/           │  │ /transformed/   │  │ /training/      │         │    │
│  │  │  year=2026/     │  │  year=2026/     │  │  exports/       │         │    │
│  │  │   month=01/     │  │   month=01/     │  │   daily/        │         │    │
│  │  │    day=08/      │  │    day=08/      │  │   weekly/       │         │    │
│  │  │     set=OP01/   │  │     prices.json │  │   monthly/      │         │    │
│  │  └─────────────────┘  └─────────────────┘  └─────────────────┘         │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │                      Amazon RDS (PostgreSQL)                             │    │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐         │    │
│  │  │  card_prices_v2 │  │ cardmarket_     │  │ price_history   │         │    │
│  │  │                 │  │    prices       │  │                 │         │    │
│  │  │ - cardId (PK)   │  │ - id (PK)       │  │ - id (PK)       │         │    │
│  │  │ - limitless_    │  │ - cardId (FK)   │  │ - cardId (FK)   │         │    │
│  │  │   cardmarket_   │  │ - trendPrice    │  │ - date          │         │    │
│  │  │   eur/gbp       │  │ - lowPrice      │  │ - trendPrice    │         │    │
│  │  │ - bestPriceGbp  │  │ - avg7Price     │  │ - lowPrice      │         │    │
│  │  │ - lastUpdated   │  │ - avg30Price    │  │ - source        │         │    │
│  │  └─────────────────┘  │ - scrapedAt     │  │ - metadata      │         │    │
│  │                       └─────────────────┘  └─────────────────┘         │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
├─────────────────────────────────────────────────────────────────────────────────┤
│                            MONITORING & ALERTING                                 │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐                 │
│  │   CloudWatch    │  │    CloudWatch   │  │      SNS        │                 │
│  │    Metrics      │  │    Dashboard    │  │    Alerts       │                 │
│  │                 │  │                 │  │                 │                 │
│  │ - scrape_count  │  │ [Pipeline View] │  │ - ScrapeFailure │                 │
│  │ - error_count   │  │ [Price Trends]  │  │ - DataAnomaly   │                 │
│  │ - latency_ms    │  │ [Data Quality]  │  │ - CircuitOpen   │                 │
│  │ - cards_updated │  │ [Cost Analysis] │  │ - DLQMessages   │                 │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘                 │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Data Flow Diagram

```
                                    CARDMARKET SCRAPER
                                          │
                                          ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                              EXTRACTION LAYER                                 │
│                                                                               │
│   ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐         │
│   │   Playwright    │───▶│  HTML Parser    │───▶│  ScrapedCard    │         │
│   │   Browser       │    │  (Cheerio)      │    │  Objects        │         │
│   │                 │    │                 │    │                 │         │
│   │  - Stealth mode │    │  - dt/dd pairs  │    │  - trendPrice   │         │
│   │  - Anti-detect  │    │  - Euro format  │    │  - lowPrice     │         │
│   │  - Rate limit   │    │  - Fallbacks    │    │  - avg7Price    │         │
│   └─────────────────┘    └─────────────────┘    └─────────────────┘         │
│                                                          │                   │
└──────────────────────────────────────────────────────────│───────────────────┘
                                                           │
                                                           ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                             STORAGE LAYER (S3)                                │
│                                                                               │
│   Raw JSON (compressed)                                                       │
│   s3://cardmarket-scraper-data/raw/year=2026/month=01/day=08/set=OP01/       │
│                                                                               │
│   {                                                                           │
│     "metadata": {                                                             │
│       "scrapeId": "scrape_1704700800000",                                     │
│       "scrapedAt": "2026-01-08T08:00:00Z",                                    │
│       "setCode": "OP01",                                                      │
│       "cardCount": 121                                                        │
│     },                                                                        │
│     "cards": [                                                                │
│       {                                                                       │
│         "cardId": "OP01-OP01-003-parallel",                                   │
│         "name": "Monkey.D.Luffy",                                             │
│         "trendPrice": 0.45,                                                   │
│         "lowPrice": 0.02,                                                     │
│         ...                                                                   │
│       }                                                                       │
│     ]                                                                         │
│   }                                                                           │
│                                                                               │
└──────────────────────────────────────────────────────────────────────────────┘
                                                           │
                                                           ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                           TRANSFORMATION LAYER                                │
│                                                                               │
│   ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐         │
│   │   Normalizer    │───▶│   Validator     │───▶│   Enricher      │         │
│   │                 │    │                 │    │                 │         │
│   │  - EUR → GBP    │    │  - Price range  │    │  - % change     │         │
│   │  - Card ID norm │    │  - Required     │    │  - Trend score  │         │
│   │  - Dedupe       │    │    fields       │    │  - Volatility   │         │
│   └─────────────────┘    └─────────────────┘    └─────────────────┘         │
│                                                          │                   │
│                                   ┌──────────────────────┼──────────┐        │
│                                   ▼                      ▼          │        │
│                          ┌─────────────────┐    ┌─────────────────┐│        │
│                          │  Valid Records  │    │ Invalid Records ││        │
│                          │  (to RDS)       │    │ (to DLQ)        ││        │
│                          └─────────────────┘    └─────────────────┘│        │
│                                                                     │        │
└─────────────────────────────────────────────────────────────────────────────┘
                                                           │
                                                           ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                              LOAD LAYER (RDS)                                 │
│                                                                               │
│   ┌─────────────────────────────────────────────────────────────────┐        │
│   │                    PostgreSQL (AWS RDS)                          │        │
│   │                                                                  │        │
│   │   UPSERT into card_prices_v2:                                   │        │
│   │   - limitless_cardmarket_eur = <scraped EUR price>              │        │
│   │   - limitless_cardmarket_gbp = <EUR * exchange_rate>            │        │
│   │   - best_price_gbp = LEAST(all_source_prices)                   │        │
│   │   - tradein_price_gbp = best_price_gbp * 0.70                   │        │
│   │   - last_updated = NOW()                                         │        │
│   │                                                                  │        │
│   │   INSERT into price_history:                                     │        │
│   │   - cardId, date, trend_price, low_price, source                │        │
│   │   (Retained for ML training data)                               │        │
│   │                                                                  │        │
│   └─────────────────────────────────────────────────────────────────┘        │
│                                                                               │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Component Details

### 3.1 Scraper Component

Located in `/src/scrapers/`

**Responsibilities:**
- Browser automation with Playwright
- Anti-detection (stealth mode, fingerprint randomization)
- Rate limiting (3-5 seconds between requests)
- Circuit breaker for failure handling
- Session management for BWSTATE cookies

**Key Classes:**
```typescript
CardmarketScraper     // Main orchestration
HybridScraper         // HTTP + Browser fallback
PlaywrightClient      // Browser automation
SessionManager        // BWSTATE cookie handling
```

### 3.2 Storage Component

Located in `/src/storage/`

**Responsibilities:**
- S3 storage with Hive-style partitioning
- GZIP compression
- Versioning and atomic writes
- Raw HTML archival for debugging

**S3 Key Structure:**
```
cardmarket-scraper-data/
├── raw/
│   └── year=2026/month=01/day=08/
│       └── set=OP01/
│           └── scrape_1704700800000.json.gz
├── transformed/
│   └── year=2026/month=01/day=08/
│       └── prices_consolidated.json.gz
├── training/
│   └── exports/
│       ├── daily/price_history_2026-01-08.parquet
│       ├── weekly/price_history_week_01.parquet
│       └── monthly/price_history_2026-01.parquet
└── debug/
    └── raw_html/
        └── <scrape_id>/
```

### 3.3 Transformer Component

Located in `/src/pipeline/`

**Responsibilities:**
- Currency conversion (EUR → GBP)
- Card ID normalization
- Price validation (min/max ranges)
- Anomaly detection (>50% price change)
- Deduplication

**Transformation Rules:**
```typescript
// EUR to GBP conversion
const gbpPrice = eurPrice * exchangeRate;

// Card ID normalization
// Input:  "Monkey.D.Luffy-OP01-003-V1"
// Output: "OP01-OP01-003" (base) or "OP01-OP01-003-parallel" (variant)

// Price validation
const isValid = price > 0.01 && price < 10000;

// Anomaly detection
const percentChange = (newPrice - oldPrice) / oldPrice * 100;
const isAnomaly = Math.abs(percentChange) > 50;
```

### 3.4 Loader Component

Located in `/src/pipeline/`

**Responsibilities:**
- Batch upsert to card_prices_v2
- Historical price insertion to price_history
- Transaction management
- Conflict resolution

**Database Operations:**
```sql
-- Upsert current prices
INSERT INTO card_prices_v2 (card_id, limitless_cardmarket_eur, ...)
VALUES ($1, $2, ...)
ON CONFLICT (card_id) DO UPDATE SET
  limitless_cardmarket_eur = EXCLUDED.limitless_cardmarket_eur,
  limitless_cardmarket_gbp = EXCLUDED.limitless_cardmarket_gbp,
  best_price_gbp = LEAST(
    card_prices_v2.optcg_tcgplayer_gbp,
    EXCLUDED.limitless_cardmarket_gbp
  ),
  tradein_price_gbp = LEAST(...) * 0.70,
  last_updated = NOW();

-- Insert historical price
INSERT INTO price_history (card_id, date, trend_price, low_price, source)
VALUES ($1, CURRENT_DATE, $2, $3, 'cardmarket');
```

---

## 4. AWS Infrastructure

### 4.1 Step Functions State Machine

```json
{
  "Comment": "Cardmarket Scraping Pipeline",
  "StartAt": "ScrapeAllSets",
  "States": {
    "ScrapeAllSets": {
      "Type": "Map",
      "ItemsPath": "$.sets",
      "MaxConcurrency": 1,
      "Iterator": {
        "StartAt": "ScrapeSet",
        "States": {
          "ScrapeSet": {
            "Type": "Task",
            "Resource": "arn:aws:lambda:us-east-1:XXX:function:cardmarket-scraper",
            "Retry": [{
              "ErrorEquals": ["ServiceException", "RateLimitExceeded"],
              "IntervalSeconds": 300,
              "MaxAttempts": 3,
              "BackoffRate": 2
            }],
            "Catch": [{
              "ErrorEquals": ["States.ALL"],
              "ResultPath": "$.error",
              "Next": "RecordFailure"
            }],
            "Next": "StoreToS3"
          },
          "StoreToS3": {
            "Type": "Task",
            "Resource": "arn:aws:lambda:us-east-1:XXX:function:store-scrape-data",
            "Next": "TransformData"
          },
          "TransformData": {
            "Type": "Task",
            "Resource": "arn:aws:lambda:us-east-1:XXX:function:transform-prices",
            "Next": "ValidateData"
          },
          "ValidateData": {
            "Type": "Choice",
            "Choices": [{
              "Variable": "$.validationResult.isValid",
              "BooleanEquals": true,
              "Next": "LoadToRDS"
            }],
            "Default": "SendToDLQ"
          },
          "LoadToRDS": {
            "Type": "Task",
            "Resource": "arn:aws:lambda:us-east-1:XXX:function:load-to-rds",
            "End": true
          },
          "SendToDLQ": {
            "Type": "Task",
            "Resource": "arn:aws:sqs:us-east-1:XXX:cardmarket-dlq",
            "End": true
          },
          "RecordFailure": {
            "Type": "Task",
            "Resource": "arn:aws:lambda:us-east-1:XXX:function:record-failure",
            "End": true
          }
        }
      },
      "Next": "GenerateTrainingExport"
    },
    "GenerateTrainingExport": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:us-east-1:XXX:function:export-training-data",
      "End": true
    }
  }
}
```

### 4.2 EventBridge Schedule

```yaml
# Twice daily: 8 AM and 8 PM UTC
ScheduleExpression: "cron(0 8,20 * * ? *)"
Target:
  Arn: arn:aws:states:us-east-1:XXX:stateMachine:CardmarketPipeline
  Input: |
    {
      "sets": ["OP01", "OP02", "OP03", "OP04", "OP05", "OP06",
               "OP07", "OP08", "OP09", "OP10", "OP11", "OP12", "OP13",
               "EB01", "EB02", "ST01", "ST02", "ST03", "ST04", "ST05",
               "ST06", "ST07", "ST08", "ST09", "ST10", "ST11", "ST12",
               "ST13", "ST14", "ST15", "ST16", "ST17", "ST18", "ST19", "ST20"],
      "options": {
        "includeArticles": false,
        "maxCardsPerSet": 500
      }
    }
```

### 4.3 Lambda Functions

| Function | Runtime | Memory | Timeout | Purpose |
|----------|---------|--------|---------|---------|
| `cardmarket-scraper` | Node.js 20 | 2048 MB | 15 min | Playwright scraping |
| `store-scrape-data` | Node.js 20 | 512 MB | 30 sec | S3 storage |
| `transform-prices` | Node.js 20 | 1024 MB | 5 min | Data transformation |
| `load-to-rds` | Node.js 20 | 512 MB | 2 min | Database loading |
| `export-training-data` | Node.js 20 | 2048 MB | 10 min | Training export |
| `record-failure` | Node.js 20 | 256 MB | 30 sec | Error recording |

### 4.4 SQS Queues

```yaml
MainQueue:
  Name: cardmarket-scrape-queue
  VisibilityTimeout: 900  # 15 minutes
  MessageRetentionPeriod: 1209600  # 14 days
  RedrivePolicy:
    deadLetterTargetArn: arn:aws:sqs:us-east-1:XXX:cardmarket-dlq
    maxReceiveCount: 3

DeadLetterQueue:
  Name: cardmarket-dlq
  MessageRetentionPeriod: 1209600
```

---

## 5. Database Schema

### 5.1 CardMarket Prices Table (New)

```sql
CREATE TABLE cardmarket_prices (
  id SERIAL PRIMARY KEY,
  card_id VARCHAR(100) NOT NULL REFERENCES card_prices_v2(card_id),

  -- Scraped prices (EUR)
  trend_price_eur DECIMAL(10, 2),
  low_price_eur DECIMAL(10, 2),
  avg_7d_price_eur DECIMAL(10, 2),
  avg_30d_price_eur DECIMAL(10, 2),
  avg_1d_price_eur DECIMAL(10, 2),

  -- Converted prices (GBP)
  trend_price_gbp DECIMAL(10, 2),
  low_price_gbp DECIMAL(10, 2),

  -- Metadata
  available_count INTEGER,
  source_url VARCHAR(500),
  exchange_rate DECIMAL(10, 6),

  -- Timestamps
  scraped_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(card_id, scraped_at::DATE)
);

CREATE INDEX idx_cm_prices_card_id ON cardmarket_prices(card_id);
CREATE INDEX idx_cm_prices_scraped_at ON cardmarket_prices(scraped_at);
CREATE INDEX idx_cm_prices_trend ON cardmarket_prices(trend_price_gbp);
```

### 5.2 Price History Table (Training Data)

```sql
CREATE TABLE price_history (
  id BIGSERIAL PRIMARY KEY,
  card_id VARCHAR(100) NOT NULL,

  -- Date (one row per card per day)
  price_date DATE NOT NULL,

  -- Prices from all sources
  tcgplayer_price_gbp DECIMAL(10, 2),
  cardmarket_price_gbp DECIMAL(10, 2),
  best_price_gbp DECIMAL(10, 2),
  tradein_price_gbp DECIMAL(10, 2),

  -- Price changes
  pct_change_1d DECIMAL(8, 4),
  pct_change_7d DECIMAL(8, 4),
  pct_change_30d DECIMAL(8, 4),

  -- Market indicators
  available_count INTEGER,
  volatility_7d DECIMAL(8, 4),

  -- Source tracking
  source VARCHAR(50) NOT NULL,  -- 'tcgplayer', 'cardmarket', 'combined'

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(card_id, price_date, source)
);

-- Partitioning by month for efficient queries
CREATE INDEX idx_price_history_card ON price_history(card_id);
CREATE INDEX idx_price_history_date ON price_history(price_date);
CREATE INDEX idx_price_history_source ON price_history(source);
CREATE INDEX idx_price_history_card_date ON price_history(card_id, price_date);
```

### 5.3 Pipeline Run Log Table

```sql
CREATE TABLE pipeline_runs (
  id SERIAL PRIMARY KEY,
  run_id VARCHAR(100) UNIQUE NOT NULL,

  -- Status
  status VARCHAR(20) NOT NULL,  -- 'running', 'completed', 'failed', 'partial'

  -- Metrics
  sets_processed INTEGER DEFAULT 0,
  cards_scraped INTEGER DEFAULT 0,
  cards_updated INTEGER DEFAULT 0,
  errors_count INTEGER DEFAULT 0,

  -- Timing
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER,

  -- Details
  error_details JSONB,
  metrics JSONB,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_pipeline_runs_status ON pipeline_runs(status);
CREATE INDEX idx_pipeline_runs_started ON pipeline_runs(started_at);
```

---

## 6. Monitoring & Alerting

### 6.1 CloudWatch Metrics

```typescript
const METRICS = {
  namespace: 'CardmarketPipeline',

  dimensions: {
    Environment: 'production',
    SetCode: '<dynamic>',
  },

  metrics: [
    // Scraping metrics
    { name: 'ScrapeLatencyMs', unit: 'Milliseconds' },
    { name: 'CardsScraped', unit: 'Count' },
    { name: 'ArticlesScraped', unit: 'Count' },
    { name: 'ScrapeErrors', unit: 'Count' },
    { name: 'RequestsBlocked', unit: 'Count' },

    // Pipeline metrics
    { name: 'TransformationErrors', unit: 'Count' },
    { name: 'ValidationFailures', unit: 'Count' },
    { name: 'DatabaseUpserts', unit: 'Count' },
    { name: 'DLQMessages', unit: 'Count' },

    // Data quality metrics
    { name: 'PriceAnomalies', unit: 'Count' },
    { name: 'MissingPrices', unit: 'Count' },
    { name: 'StaleCards', unit: 'Count' },  // Not updated in 7+ days

    // Cost metrics
    { name: 'S3BytesWritten', unit: 'Bytes' },
    { name: 'LambdaInvocations', unit: 'Count' },
    { name: 'LambdaDurationMs', unit: 'Milliseconds' },
  ],
};
```

### 6.2 CloudWatch Alarms

```yaml
Alarms:
  - Name: CardmarketScrapeFailure
    Metric: ScrapeErrors
    Threshold: 10
    Period: 3600  # 1 hour
    EvaluationPeriods: 1
    ComparisonOperator: GreaterThanThreshold
    Action: SNS:CardmarketAlerts

  - Name: CardmarketHighLatency
    Metric: ScrapeLatencyMs
    Threshold: 60000  # 1 minute per card
    Period: 300
    EvaluationPeriods: 3
    ComparisonOperator: GreaterThanThreshold
    Action: SNS:CardmarketAlerts

  - Name: CardmarketDLQDepth
    Metric: ApproximateNumberOfMessagesVisible
    Namespace: AWS/SQS
    Dimensions:
      QueueName: cardmarket-dlq
    Threshold: 5
    Period: 300
    EvaluationPeriods: 1
    Action: SNS:CardmarketAlerts

  - Name: CardmarketCircuitOpen
    Metric: CircuitBreakerOpen
    Threshold: 1
    Period: 60
    EvaluationPeriods: 1
    Action: SNS:CardmarketAlerts
```

### 6.3 CloudWatch Dashboard

```json
{
  "widgets": [
    {
      "type": "metric",
      "title": "Scraping Performance",
      "metrics": [
        ["CardmarketPipeline", "CardsScraped", "Environment", "production"],
        [".", "ScrapeErrors", ".", "."],
        [".", "RequestsBlocked", ".", "."]
      ],
      "period": 3600
    },
    {
      "type": "metric",
      "title": "Pipeline Health",
      "metrics": [
        ["CardmarketPipeline", "ValidationFailures"],
        [".", "DatabaseUpserts"],
        [".", "DLQMessages"]
      ],
      "period": 3600
    },
    {
      "type": "metric",
      "title": "Data Quality",
      "metrics": [
        ["CardmarketPipeline", "PriceAnomalies"],
        [".", "MissingPrices"],
        [".", "StaleCards"]
      ],
      "period": 86400
    },
    {
      "type": "log",
      "title": "Recent Errors",
      "query": "fields @timestamp, @message | filter @message like /ERROR/ | sort @timestamp desc | limit 20"
    }
  ]
}
```

---

## 7. Training Data Export

### 7.1 Daily Export Job

```typescript
// Exports price history for ML training
async function exportTrainingData(): Promise<void> {
  const today = new Date().toISOString().split('T')[0];

  // Query last 90 days of price history
  const data = await prisma.priceHistory.findMany({
    where: {
      priceDate: {
        gte: subDays(new Date(), 90),
      },
    },
    orderBy: [
      { cardId: 'asc' },
      { priceDate: 'asc' },
    ],
  });

  // Convert to Parquet format for ML tools
  const parquet = await convertToParquet(data);

  // Upload to S3
  await s3.putObject({
    Bucket: 'cardmarket-scraper-data',
    Key: `training/exports/daily/price_history_${today}.parquet`,
    Body: parquet,
  });
}
```

### 7.2 Feature Engineering

```typescript
interface TrainingFeatures {
  // Card identification
  cardId: string;
  setCode: string;
  variantType: string;

  // Current prices
  currentPriceGbp: number;
  tradeinPriceGbp: number;

  // Historical features
  priceChange1d: number;
  priceChange7d: number;
  priceChange30d: number;
  volatility7d: number;
  volatility30d: number;

  // Market features
  availableCount: number;
  avgAvailable7d: number;
  supplyTrend: number;  // Increasing/decreasing availability

  // Time features
  dayOfWeek: number;
  dayOfMonth: number;
  isWeekend: boolean;

  // Cross-market features
  tcgplayerPremium: number;  // Cardmarket price vs TCGplayer
  marketSpread: number;      // Low vs trend price spread
}
```

---

## 8. Error Handling

### 8.1 Retry Strategy

```typescript
const RETRY_CONFIG = {
  // Transient errors - retry immediately
  transientErrors: [
    'ECONNRESET',
    'ETIMEDOUT',
    'ENOTFOUND',
    'ServiceUnavailable',
  ],
  maxRetries: 3,
  baseDelay: 5000,
  maxDelay: 60000,
  backoffMultiplier: 2,

  // Rate limit errors - retry with longer delay
  rateLimitErrors: ['TooManyRequests', '429'],
  rateLimitDelay: 300000,  // 5 minutes

  // Permanent errors - send to DLQ
  permanentErrors: [
    'InvalidCardId',
    'PageNotFound',
    'ValidationError',
  ],
};
```

### 8.2 Dead Letter Queue Processing

```typescript
// DLQ processor Lambda
async function processDLQMessage(message: SQSMessage): Promise<void> {
  const { cardId, error, attemptCount } = JSON.parse(message.body);

  // Log for analysis
  console.error('DLQ Message:', { cardId, error, attemptCount });

  // Store in error log table
  await prisma.pipelineErrors.create({
    data: {
      cardId,
      errorType: error.type,
      errorMessage: error.message,
      attemptCount,
      rawMessage: message.body,
      createdAt: new Date(),
    },
  });

  // Alert if high-value card
  if (await isHighValueCard(cardId)) {
    await sns.publish({
      TopicArn: process.env.ALERTS_TOPIC,
      Subject: 'High-Value Card Scrape Failure',
      Message: JSON.stringify({ cardId, error }),
    });
  }
}
```

---

## 9. Security Considerations

### 9.1 IAM Policies

```yaml
# Lambda execution role
CardmarketScraperRole:
  Type: AWS::IAM::Role
  Properties:
    AssumeRolePolicyDocument:
      Statement:
        - Effect: Allow
          Principal:
            Service: lambda.amazonaws.com
          Action: sts:AssumeRole
    Policies:
      - PolicyName: S3Access
        PolicyDocument:
          Statement:
            - Effect: Allow
              Action:
                - s3:PutObject
                - s3:GetObject
                - s3:ListBucket
              Resource:
                - arn:aws:s3:::cardmarket-scraper-data/*
      - PolicyName: RDSAccess
        PolicyDocument:
          Statement:
            - Effect: Allow
              Action:
                - rds-data:ExecuteStatement
                - rds-data:BatchExecuteStatement
              Resource: arn:aws:rds:us-east-1:XXX:cluster:cardforum
      - PolicyName: SQSAccess
        PolicyDocument:
          Statement:
            - Effect: Allow
              Action:
                - sqs:SendMessage
                - sqs:ReceiveMessage
                - sqs:DeleteMessage
              Resource:
                - arn:aws:sqs:us-east-1:XXX:cardmarket-*
      - PolicyName: SecretsAccess
        PolicyDocument:
          Statement:
            - Effect: Allow
              Action:
                - secretsmanager:GetSecretValue
              Resource:
                - arn:aws:secretsmanager:us-east-1:XXX:secret:cardmarket/*
```

### 9.2 Secrets Management

```typescript
// Secrets stored in AWS Secrets Manager
const SECRETS = {
  'cardmarket/database': {
    host: '<rds-endpoint>',
    username: '<db-user>',
    password: '<db-password>',
    database: 'cardforum',
  },
  'cardmarket/proxy': {
    provider: 'brightdata',
    username: '<proxy-user>',
    password: '<proxy-password>',
  },
};
```

---

## 10. Cost Optimization

### 10.1 Estimated Monthly Costs

| Service | Usage | Est. Cost |
|---------|-------|-----------|
| Lambda | ~4,000 invocations @ 2GB | $15 |
| S3 | ~10 GB storage + requests | $5 |
| RDS | Existing (shared) | $0 |
| Step Functions | ~120 executions | $2 |
| CloudWatch | Logs + metrics | $5 |
| SQS | ~5,000 messages | $0.01 |
| **Total** | | **~$27/month** |

### 10.2 Cost Reduction Strategies

1. **S3 Lifecycle Policies**
   - Move raw data to Glacier after 30 days
   - Delete debug HTML after 7 days

2. **Lambda Optimization**
   - Use ARM64 architecture (20% cheaper)
   - Right-size memory based on profiling

3. **Scraping Efficiency**
   - Skip unchanged cards (ETag/Last-Modified)
   - Batch requests where possible

---

## 11. Deployment

### 11.1 CDK Stack

See `/infrastructure/cdk/` for full CDK implementation.

### 11.2 Deployment Commands

```bash
# Deploy infrastructure
cd infrastructure/cdk
npm run cdk deploy CardmarketPipelineStack

# Deploy Lambda code
npm run build
aws lambda update-function-code \
  --function-name cardmarket-scraper \
  --zip-file fileb://dist/lambda.zip

# Run pipeline manually
aws stepfunctions start-execution \
  --state-machine-arn arn:aws:states:us-east-1:XXX:stateMachine:CardmarketPipeline \
  --input '{"sets": ["OP01"]}'
```

---

## 12. Appendix

### A. Card ID Format Reference

```
Format: {RELEASE_SET}-{FULL_CARD_NUMBER}[-{variant}]

Examples:
  OP01-OP01-003              # Base card from OP01
  OP01-OP01-003-parallel     # Parallel variant from OP01
  OP03-OP01-051-sp           # SP card released in OP03
  OP11-EB01-057-sp           # SP card released in OP11
```

### B. Price Format Reference

```
Cardmarket (EUR):  "5,26 €"  → 5.26
TCGplayer (USD):   "$5.26"   → 5.26
Converted (GBP):   5.26 * 0.85 = 4.47
Trade-in (GBP):    4.47 * 0.70 = 3.13
```

### C. Set Codes Reference

```typescript
const SETS = {
  // Main sets
  'OP01': 'Romance-Dawn',
  'OP02': 'Paramount-War',
  'OP03': 'Pillars-of-Strength',
  // ... (see /src/config/sets.ts for full list)

  // Extra boosters
  'EB01': 'Memorial-Collection',
  'EB02': 'Premium-Collection-Best-Selection',

  // Starter decks
  'ST01': 'Straw-Hat-Crew',
  // ...
};
```
