# TCGplayer Scraper - AWS Infrastructure

> **Version**: 1.0.0
> **Last Updated**: January 2026
> **Status**: Planning

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         TCGPLAYER DATA PIPELINE                                  │
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
│  │                     "TCGplayerPipelineStateMachine"                       │   │
│  │                                                                           │   │
│  │   ┌─────────────────────────────────────────────────────────────────┐    │   │
│  │   │                    DATA SOURCE SELECTION                         │    │   │
│  │   │                                                                  │    │   │
│  │   │   ┌─────────┐   ┌─────────┐   ┌─────────┐                       │    │   │
│  │   │   │  OPTCG  │   │ JustTCG │   │ Direct  │                       │    │   │
│  │   │   │   API   │   │   API   │   │ Scraper │                       │    │   │
│  │   │   │ (Free)  │   │ (Paid)  │   │(Fallback)│                       │    │   │
│  │   │   └────┬────┘   └────┬────┘   └────┬────┘                       │    │   │
│  │   │        │             │             │                             │    │   │
│  │   │        └─────────────┴─────────────┘                             │    │   │
│  │   │                      │                                           │    │   │
│  │   └──────────────────────┼───────────────────────────────────────────┘    │   │
│  │                          ▼                                                │   │
│  │   ┌─────────┐   ┌─────────┐   ┌─────────┐   ┌─────────┐               │   │
│  │   │ Store   │──▶│Transform│──▶│ Validate│──▶│  Load   │               │   │
│  │   │  to S3  │   │  Data   │   │  Data   │   │ to RDS  │               │   │
│  │   └─────────┘   └─────────┘   └─────────┘   └─────────┘               │   │
│  │                                      │             │                   │   │
│  │                                      ▼             ▼                   │   │
│  │                                ┌──────────┐  ┌──────────┐             │   │
│  │                                │  DLQ for │  │ History  │             │   │
│  │                                │  Errors  │  │  Table   │             │   │
│  │                                └──────────┘  └──────────┘             │   │
│  └──────────────────────────────────────────────────────────────────────────┘   │
│                                                                                  │
├─────────────────────────────────────────────────────────────────────────────────┤
│                              DATA STORAGE LAYER                                  │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │                           Amazon S3                                      │    │
│  │                                                                          │    │
│  │   tcgplayer-scraper-data/                                               │    │
│  │   ├── raw/                                                               │    │
│  │   │   └── source={optcg|justtcg|scraper}/                               │    │
│  │   │       └── year=2026/month=01/day=08/                                │    │
│  │   │           └── {set_code}.json.gz                                    │    │
│  │   │                                                                      │    │
│  │   ├── transformed/                                                       │    │
│  │   │   └── year=2026/month=01/day=08/                                    │    │
│  │   │       └── prices_consolidated.json.gz                               │    │
│  │   │                                                                      │    │
│  │   └── training/                                                          │    │
│  │       └── exports/                                                       │    │
│  │           ├── daily/                                                     │    │
│  │           ├── weekly/                                                    │    │
│  │           └── monthly/                                                   │    │
│  │                                                                          │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │                      Amazon RDS (PostgreSQL)                             │    │
│  │                 cardforum.cn4c2su0o42n.us-east-1.rds.amazonaws.com       │    │
│  │                                                                          │    │
│  │   ┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐       │    │
│  │   │  card_prices_v2 │   │  tcgplayer_     │   │  price_history  │       │    │
│  │   │                 │   │     prices      │   │                 │       │    │
│  │   │ - optcg_        │   │ - card_id (FK)  │   │ - card_id       │       │    │
│  │   │   tcgplayer_    │   │ - market_price  │   │ - price_date    │       │    │
│  │   │   usd/gbp       │   │ - low_price     │   │ - tcgplayer_gbp │       │    │
│  │   │ - best_price    │   │ - median_price  │   │ - cardmarket_gbp│       │    │
│  │   │ - tradein_price │   │ - foil_price    │   │ - source        │       │    │
│  │   └─────────────────┘   │ - scraped_at    │   └─────────────────┘       │    │
│  │                         └─────────────────┘                              │    │
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
│  │ - api_calls     │  │ [API Health]    │  │ - APIFailure    │                 │
│  │ - error_count   │  │ [Data Quality]  │  │ - RateLimited   │                 │
│  │ - latency_ms    │  │ [Pipeline View] │  │ - DLQMessages   │                 │
│  │ - cards_updated │  │ [Cost Analysis] │  │ - DataAnomaly   │                 │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘                 │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Lambda Functions

### 2.1 API Fetcher Lambda

**Purpose**: Fetch data from OPTCG API and JustTCG API

```yaml
FunctionName: tcgplayer-api-fetcher-${Environment}
Runtime: nodejs20.x
Architecture: arm64
MemorySize: 512
Timeout: 60
Handler: src/pipeline/lambda-handler.apiFetcher

Environment:
  OPTCG_API_BASE_URL: https://optcgapi.com/api
  JUSTTCG_API_KEY: ${SecretsManager:justtcg-api-key}
  S3_BUCKET: tcgplayer-scraper-data-${Environment}

IAMPolicies:
  - S3CrudPolicy
  - SecretsManagerReadPolicy
  - CloudWatchPutMetrics
```

### 2.2 Scraper Lambda (Fallback)

**Purpose**: Direct scraping when APIs are unavailable

```yaml
FunctionName: tcgplayer-scraper-${Environment}
Runtime: nodejs20.x
Architecture: arm64
MemorySize: 2048
Timeout: 900  # 15 minutes
Handler: src/pipeline/lambda-handler.scraper

Layers:
  - PlaywrightChromiumLayer

Environment:
  S3_BUCKET: tcgplayer-scraper-data-${Environment}
  SCRAPER_MODE: headless

IAMPolicies:
  - S3CrudPolicy
  - SQSSendMessagePolicy
  - CloudWatchPutMetrics
```

### 2.3 Transformer Lambda

**Purpose**: Normalize data from multiple sources

```yaml
FunctionName: tcgplayer-transformer-${Environment}
Runtime: nodejs20.x
Architecture: arm64
MemorySize: 1024
Timeout: 300
Handler: src/pipeline/lambda-handler.transformer

Environment:
  USD_TO_GBP_RATE: 0.79  # Updated via Secrets Manager
  TRADEIN_MULTIPLIER: 0.70

IAMPolicies:
  - S3ReadPolicy
  - CloudWatchPutMetrics
```

### 2.4 Database Loader Lambda

**Purpose**: Upsert normalized data to RDS

```yaml
FunctionName: tcgplayer-loader-${Environment}
Runtime: nodejs20.x
Architecture: arm64
MemorySize: 512
Timeout: 300
Handler: src/pipeline/lambda-handler.loader

VpcConfig:
  SubnetIds: [private-subnet-1, private-subnet-2]
  SecurityGroupIds: [lambda-sg]

Environment:
  DATABASE_SECRET_ARN: ${SecretsManager:database-credentials}

IAMPolicies:
  - SecretsManagerReadPolicy
  - CloudWatchPutMetrics
```

---

## 3. Step Functions State Machine

```json
{
  "Comment": "TCGplayer Data Pipeline with Multi-Source Support",
  "StartAt": "FetchFromAPIs",
  "States": {
    "FetchFromAPIs": {
      "Type": "Parallel",
      "Branches": [
        {
          "StartAt": "FetchOPTCG",
          "States": {
            "FetchOPTCG": {
              "Type": "Task",
              "Resource": "arn:aws:lambda:${Region}:${Account}:function:tcgplayer-api-fetcher",
              "Parameters": {
                "source": "optcg",
                "sets.$": "$.sets"
              },
              "Retry": [
                {
                  "ErrorEquals": ["Lambda.ServiceException", "RateLimitError"],
                  "IntervalSeconds": 60,
                  "MaxAttempts": 3,
                  "BackoffRate": 2
                }
              ],
              "Catch": [
                {
                  "ErrorEquals": ["States.ALL"],
                  "ResultPath": "$.error",
                  "Next": "OPTCGFailed"
                }
              ],
              "End": true
            },
            "OPTCGFailed": {
              "Type": "Pass",
              "Result": { "source": "optcg", "status": "failed" },
              "End": true
            }
          }
        },
        {
          "StartAt": "CheckJustTCGEnabled",
          "States": {
            "CheckJustTCGEnabled": {
              "Type": "Choice",
              "Choices": [
                {
                  "Variable": "$.useJustTCG",
                  "BooleanEquals": true,
                  "Next": "FetchJustTCG"
                }
              ],
              "Default": "SkipJustTCG"
            },
            "FetchJustTCG": {
              "Type": "Task",
              "Resource": "arn:aws:lambda:${Region}:${Account}:function:tcgplayer-api-fetcher",
              "Parameters": {
                "source": "justtcg",
                "sets.$": "$.sets"
              },
              "Retry": [
                {
                  "ErrorEquals": ["RateLimitError"],
                  "IntervalSeconds": 300,
                  "MaxAttempts": 2
                }
              ],
              "Catch": [
                {
                  "ErrorEquals": ["States.ALL"],
                  "ResultPath": "$.error",
                  "Next": "JustTCGFailed"
                }
              ],
              "End": true
            },
            "SkipJustTCG": {
              "Type": "Pass",
              "Result": { "source": "justtcg", "status": "skipped" },
              "End": true
            },
            "JustTCGFailed": {
              "Type": "Pass",
              "Result": { "source": "justtcg", "status": "failed" },
              "End": true
            }
          }
        }
      ],
      "ResultPath": "$.apiResults",
      "Next": "CheckAPIResults"
    },
    "CheckAPIResults": {
      "Type": "Choice",
      "Choices": [
        {
          "Variable": "$.apiResults[0].status",
          "StringEquals": "failed",
          "Next": "FallbackToScraper"
        }
      ],
      "Default": "MergeAndTransform"
    },
    "FallbackToScraper": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:${Region}:${Account}:function:tcgplayer-scraper",
      "Parameters": {
        "sets.$": "$.sets",
        "maxCardsPerSet": 100
      },
      "TimeoutSeconds": 900,
      "Next": "MergeAndTransform"
    },
    "MergeAndTransform": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:${Region}:${Account}:function:tcgplayer-transformer",
      "Next": "LoadToDatabase"
    },
    "LoadToDatabase": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:${Region}:${Account}:function:tcgplayer-loader",
      "Next": "Success"
    },
    "Success": {
      "Type": "Succeed"
    }
  }
}
```

---

## 4. EventBridge Schedules

### 4.1 Morning Run (OPTCG Only)

```yaml
Name: tcgplayer-morning-sync
ScheduleExpression: cron(0 8 * * ? *)
Target:
  StateMachineArn: arn:aws:states:${Region}:${Account}:stateMachine:TCGplayerPipeline
  Input: |
    {
      "sets": ["OP01", "OP02", "OP03", "OP04", "OP05", "OP06", "OP07"],
      "useJustTCG": false,
      "generateTrainingExport": false
    }
```

### 4.2 Evening Run (Full Sync)

```yaml
Name: tcgplayer-evening-sync
ScheduleExpression: cron(0 20 * * ? *)
Target:
  StateMachineArn: arn:aws:states:${Region}:${Account}:stateMachine:TCGplayerPipeline
  Input: |
    {
      "sets": ["OP08", "OP09", "OP10", "OP11", "OP12", "OP13", "EB01", "EB02"],
      "useJustTCG": true,
      "generateTrainingExport": true
    }
```

---

## 5. S3 Bucket Configuration

```yaml
BucketName: tcgplayer-scraper-data-${Environment}

BucketEncryption:
  ServerSideEncryptionConfiguration:
    - SSEAlgorithm: AES256

LifecycleConfiguration:
  Rules:
    - Id: RawDataToGlacier
      Status: Enabled
      Prefix: raw/
      Transitions:
        - StorageClass: GLACIER
          TransitionInDays: 30

    - Id: ExpireDebugFiles
      Status: Enabled
      Prefix: debug/
      ExpirationInDays: 7

    - Id: TrainingDataRetention
      Status: Enabled
      Prefix: training/exports/daily/
      ExpirationInDays: 90

PublicAccessBlockConfiguration:
  BlockPublicAcls: true
  BlockPublicPolicy: true
  IgnorePublicAcls: true
  RestrictPublicBuckets: true

Tags:
  - Key: Application
    Value: tcgplayer-scraper
  - Key: DataClassification
    Value: internal
```

---

## 6. Database Schema Additions

```sql
-- TCGplayer-specific price table
CREATE TABLE tcgplayer_prices (
  id SERIAL PRIMARY KEY,
  card_id VARCHAR(100) NOT NULL REFERENCES card_prices_v2(card_id),

  -- Price variants
  market_price_usd DECIMAL(10, 2),
  low_price_usd DECIMAL(10, 2),
  mid_price_usd DECIMAL(10, 2),
  high_price_usd DECIMAL(10, 2),
  foil_market_price_usd DECIMAL(10, 2),
  foil_low_price_usd DECIMAL(10, 2),

  -- Converted to GBP
  market_price_gbp DECIMAL(10, 2),
  low_price_gbp DECIMAL(10, 2),

  -- Metadata
  source VARCHAR(20) NOT NULL,  -- 'optcg', 'justtcg', 'scraper'
  tcgplayer_product_id VARCHAR(50),
  exchange_rate DECIMAL(10, 6),

  -- Timestamps
  scraped_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(card_id, scraped_at::DATE, source)
);

CREATE INDEX idx_tcg_prices_card ON tcgplayer_prices(card_id);
CREATE INDEX idx_tcg_prices_scraped ON tcgplayer_prices(scraped_at);
CREATE INDEX idx_tcg_prices_source ON tcgplayer_prices(source);
```

---

## 7. Secrets Manager Configuration

```yaml
Secrets:
  tcgplayer-scraper/${Environment}/database:
    Description: RDS connection credentials
    Keys:
      - host
      - port
      - database
      - username
      - password

  tcgplayer-scraper/${Environment}/justtcg:
    Description: JustTCG API credentials
    Keys:
      - api_key
      - plan_tier

  tcgplayer-scraper/${Environment}/exchange-rates:
    Description: Currency exchange rates
    Keys:
      - usd_to_gbp
      - eur_to_gbp
      - last_updated
```

---

## 8. CloudWatch Alarms

```yaml
Alarms:
  - Name: TCGplayerAPIErrors
    Metric: APIErrors
    Namespace: TCGplayerPipeline
    Threshold: 5
    Period: 3600
    EvaluationPeriods: 1
    Action: SNS:tcgplayer-alerts

  - Name: TCGplayerRateLimited
    Metric: RateLimitHits
    Namespace: TCGplayerPipeline
    Threshold: 10
    Period: 3600
    EvaluationPeriods: 1
    Action: SNS:tcgplayer-alerts

  - Name: TCGplayerDLQDepth
    Metric: ApproximateNumberOfMessagesVisible
    Namespace: AWS/SQS
    Dimensions:
      QueueName: tcgplayer-dlq
    Threshold: 5
    Period: 300
    Action: SNS:tcgplayer-alerts

  - Name: TCGplayerDataStaleness
    Metric: HoursSinceLastUpdate
    Namespace: TCGplayerPipeline
    Threshold: 24
    Period: 3600
    Action: SNS:tcgplayer-alerts
```

---

## 9. Cost Estimation

### 9.1 API-Only Architecture (Recommended)

| Service | Monthly Usage | Est. Cost |
|---------|---------------|-----------|
| Lambda (API Fetcher) | 60 invocations × 512MB × 60s | $0.50 |
| Lambda (Transformer) | 60 invocations × 1024MB × 300s | $2.00 |
| Lambda (Loader) | 60 invocations × 512MB × 120s | $0.40 |
| S3 Storage | 5 GB | $0.12 |
| S3 Requests | 10,000 | $0.05 |
| Step Functions | 60 executions | $1.50 |
| CloudWatch | Logs + Metrics | $5.00 |
| Secrets Manager | 3 secrets | $1.20 |
| NAT Gateway | 10 GB data | $45.00 |
| **Subtotal** | | **$55.77** |
| JustTCG API (Optional) | Starter Plan | $20.00 |
| **Total** | | **$75.77** |

### 9.2 Full Scraping Architecture

| Additional Service | Monthly Usage | Est. Cost |
|--------------------|---------------|-----------|
| Lambda (Scraper) | 60 invocations × 2048MB × 900s | $15.00 |
| Playwright Layer | Storage + Transfer | $5.00 |
| **Additional Cost** | | **$20.00** |
| **Grand Total** | | **$95.77** |

---

## 10. Deployment Commands

```bash
# Deploy infrastructure
sam deploy \
  --template-file infrastructure/cloudformation.yaml \
  --stack-name tcgplayer-pipeline-production \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides \
    Environment=production \
    DatabaseSecretArn=arn:aws:secretsmanager:... \
    JustTCGApiKeyArn=arn:aws:secretsmanager:...

# Apply database migration
psql $DATABASE_URL < migrations/001_tcgplayer_prices.sql

# Manual pipeline execution
aws stepfunctions start-execution \
  --state-machine-arn arn:aws:states:us-east-1:XXX:stateMachine:TCGplayerPipeline \
  --input '{"sets": ["OP01"], "useJustTCG": false}'

# Check pipeline status
aws stepfunctions describe-execution \
  --execution-arn arn:aws:states:us-east-1:XXX:execution:TCGplayerPipeline:xxx
```
