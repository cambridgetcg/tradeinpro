# eBay Listing Data Extraction Pipeline

> **Research Date**: January 2026
> **Purpose**: Infrastructure planning for eBay TCG sold listing data extraction
> **Status**: Planning Phase

---

## Executive Summary

This document outlines the infrastructure, tools, and resources required to build an eBay listing data extraction pipeline for TCG (Trading Card Game) market analysis. The pipeline will collect sold listing data to support:

1. **Price History Analysis** - Historical sold prices for cards
2. **Market Velocity** - How quickly cards sell at different price points
3. **Condition Impact** - Price differentials across conditions
4. **Cross-Platform Arbitrage** - eBay vs TCGplayer price comparison

### Key Challenge

**eBay restricts access to sold/completed listing data**. The `findCompletedItems` API has been deprecated and the replacement [Marketplace Insights API](https://developer.ebay.com/api-docs/buy/marketplace-insights/resources/item_sales/methods/search) requires partner approval that is difficult to obtain for independent developers.

---

## 1. Data Access Options

### Option Comparison Matrix

| Option | Cost/Month | Sold Data | Rate Limits | Reliability | Effort |
|--------|------------|-----------|-------------|-------------|--------|
| **eBay Browse API** | Free | ❌ Active only | 5,000/day | High | Low |
| **Marketplace Insights API** | Free | ✅ Yes | 5,000/day | High | High (approval) |
| **SerpApi** | $50-250 | ✅ Yes | Varies by plan | High | Low |
| **Apify Scrapers** | $30-100 | ✅ Yes | N/A | Medium | Medium |
| **Custom Playwright** | ~$20 (proxies) | ✅ Yes | N/A | Low-Medium | High |

### Recommendation: Hybrid Approach

1. **Primary**: SerpApi for sold listings (reliable, legal)
2. **Secondary**: eBay Browse API for active listings
3. **Fallback**: Apify scraper for backup/validation

---

## 2. Data Source Analysis

### 2.1 eBay Official APIs

#### Browse API (Active Listings)
- **Documentation**: [Browse API Overview](https://developer.ebay.com/api-docs/buy/browse/overview.html)
- **Use Case**: Current listings, pricing, inventory monitoring
- **Limitations**: No sold/completed items, 5,000 calls/day default
- **Cost**: Free with developer account

```
Endpoint: GET /buy/browse/v1/item_summary/search
Returns: Active listings only (FIXED_PRICE by default)
Filters: Category, price range, condition, seller, location
```

#### Marketplace Insights API (Sold History)
- **Documentation**: [Marketplace Insights API](https://developer.ebay.com/api-docs/buy/static/api-insights.html)
- **Use Case**: Sales history, sold prices, market research
- **Limitations**: **Requires partner approval** (difficult to obtain)
- **Cost**: Free if approved

```
Endpoint: GET /buy/marketplace-insights/v1_beta/item_sales/search
Returns: Up to 10,000 sold items
Filters: q (keyword), gtin, category_ids, price range
Max: 10,000 items per query
```

**Status Note**: According to [eBay Community discussions](https://community.ebay.com/t5/eBay-APIs-Talk-to-your-fellow/Access-to-sold-completed-listing-data-what-options-do-non/m-p/35398955), access to sold listing data via API is effectively limited to approved partners.

### 2.2 Third-Party APIs

#### SerpApi eBay Search API
- **Documentation**: [SerpApi eBay Search API](https://serpapi.com/ebay-search-api)
- **Use Case**: Both active and sold listings
- **Features**:
  - `LH_Complete=1` filter for completed items
  - `LH_Sold=1` filter for sold items
  - Full item details, prices, conditions
  - Cached results (1 hour, free)

**Pricing** ([SerpApi Pricing](https://serpapi.com/pricing)):
| Plan | Searches/Month | Price |
|------|----------------|-------|
| Developer | 100 | Free |
| Small Business | 5,000 | $50 |
| Business | 15,000 | $130 |
| Enterprise | 50,000+ | Custom |

**Example Query**:
```
https://serpapi.com/search?engine=ebay
  &_nkw=one+piece+tcg+OP01-001
  &LH_Sold=1
  &LH_Complete=1
```

#### Apify eBay Scrapers
- **Documentation**: [Apify eBay Scraper Pro](https://apify.com/webdatalabs/ebay-scraper-pro)
- **Use Case**: Backup data collection, validation
- **Cost**: ~$0.63 per 1,000 items ([eBay Items Scraper](https://apify.com/dtrungtin/ebay-items-scraper))
- **Limitation**: Speed is 3-5 products/minute

**Key Actors**:
| Actor | Provider | Best For |
|-------|----------|----------|
| [eBay Scraper Pro](https://apify.com/webdatalabs/ebay-scraper-pro) | webdatalabs | Seller analytics, engagement |
| [eBay Items Scraper](https://apify.com/dtrungtin/ebay-items-scraper) | dtrungtin | Bulk product extraction |
| [eBay Scraper (PPR)](https://apify.com/3x1t/ebay-scraper-ppr) | 3x1t | Large result sets (40k max) |

**Sold Items Strategy**: Use eBay's website filters, then feed filtered URL to scraper:
```
https://www.ebay.com/sch/i.html?_nkw=one+piece+tcg&LH_Sold=1&LH_Complete=1
```

---

## 3. AWS Infrastructure Architecture

### 3.1 Recommended Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        AWS Infrastructure                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐             │
│  │ EventBridge │───►│    Step     │───►│   Lambda    │             │
│  │  (Scheduler)│    │  Functions  │    │  Functions  │             │
│  └─────────────┘    └──────┬──────┘    └──────┬──────┘             │
│                            │                   │                     │
│                            ▼                   ▼                     │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐             │
│  │  Secrets    │    │     SQS     │    │     S3      │             │
│  │  Manager    │    │   (Queue)   │    │  (Raw Data) │             │
│  └─────────────┘    └──────┬──────┘    └──────┬──────┘             │
│                            │                   │                     │
│                            ▼                   ▼                     │
│                     ┌─────────────┐    ┌─────────────┐             │
│                     │   Lambda    │───►│     RDS     │             │
│                     │ (Processor) │    │ (PostgreSQL)│             │
│                     └─────────────┘    └─────────────┘             │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.2 AWS Services Required

| Service | Purpose | Estimated Cost |
|---------|---------|----------------|
| **Lambda** | Data collection, processing | ~$5-20/mo |
| **Step Functions** | Workflow orchestration | ~$5-10/mo |
| **EventBridge** | Scheduling | ~$1/mo |
| **SQS** | Message queue | ~$1/mo |
| **S3** | Raw data storage | ~$5-10/mo |
| **RDS (PostgreSQL)** | Structured storage | ~$15-50/mo |
| **Secrets Manager** | API key storage | ~$1/mo |
| **CloudWatch** | Logging, monitoring | ~$5/mo |

**Total Estimated**: $40-100/month (infrastructure only)

### 3.3 Architecture Pattern: Lambda ETL

Based on [AWS Lambda ETL Reference Architecture](https://github.com/aws-samples/aws-lambda-etl-ref-architecture):

```
EventBridge Schedule (hourly/daily)
        │
        ▼
┌───────────────────┐
│  Step Functions   │ ◄─── Orchestration
│  State Machine    │
└─────────┬─────────┘
          │
    ┌─────┴─────┐
    ▼           ▼
┌───────┐  ┌───────┐
│Extract│  │Extract│    ◄─── Parallel extraction
│SerpApi│  │Browse │
└───┬───┘  └───┬───┘
    │          │
    └────┬─────┘
         ▼
   ┌───────────┐
   │ Transform │           ◄─── Normalize, dedupe
   │  Lambda   │
   └─────┬─────┘
         ▼
   ┌───────────┐
   │   Load    │           ◄─── Write to RDS/S3
   │  Lambda   │
   └─────┬─────┘
         ▼
   ┌───────────┐
   │  Notify   │           ◄─── SNS alerts
   │  Lambda   │
   └───────────┘
```

### 3.4 Best Practices

From [AWS Step Functions Best Practices for 2026](https://dev.to/jubinsoni/mastering-serverless-data-pipelines-aws-step-functions-best-practices-for-2026-44bl):

1. **IAM Security**: Use separate IAM roles per state machine, not a single "God-mode" role
2. **Observability**: Enable AWS X-Ray tracing for end-to-end visibility
3. **Logging**: Set CloudWatch log level to `ERROR` in production (reduce costs)
4. **Retry Logic**: Configure automatic retries with exponential backoff
5. **Distributed Map**: For large datasets, use distributed map to avoid 25,000 event limit
6. **Secrets**: Use [Parameters and Secrets Extension](https://aws.amazon.com/blogs/compute/using-the-aws-parameter-and-secrets-lambda-extension-to-cache-parameters-and-secrets/) for API keys

---

## 4. Data Collection Strategy

### 4.1 Collection Schedule

| Data Type | Frequency | Source | Priority |
|-----------|-----------|--------|----------|
| **Sold Listings** | Every 4 hours | SerpApi | High |
| **Active Listings** | Every 1 hour | Browse API | Medium |
| **Price Snapshots** | Daily | Aggregated | Low |

### 4.2 Target TCG Categories

```typescript
const TCG_CATEGORIES = {
  onepiece: {
    categoryId: '183454',  // CCG Individual Cards > One Piece
    searchTerms: ['one piece tcg', 'optcg'],
  },
  pokemon: {
    categoryId: '183454',  // CCG Individual Cards
    searchTerms: ['pokemon tcg', 'pokemon card'],
  },
  mtg: {
    categoryId: '19107',   // MTG Singles
    searchTerms: ['mtg', 'magic the gathering'],
  },
  yugioh: {
    categoryId: '183454',
    searchTerms: ['yugioh', 'yu-gi-oh'],
  },
};
```

### 4.3 Rate Limit Management

Based on [eBay API Call Limits](https://developer.ebay.com/develop/get-started/api-call-limits):

```typescript
interface RateLimitConfig {
  browseApi: {
    dailyLimit: 5000,
    burstLimit: 100,  // per 5 seconds
    resetTime: '00:00 UTC',
  },
  serpApi: {
    monthlyLimit: 5000,  // Small Business plan
    cacheWindow: 3600,   // 1 hour (free)
  },
}
```

**Throttling Strategy**:
1. Track daily/monthly usage in DynamoDB
2. Implement exponential backoff on 429 errors
3. Cache SerpApi results in S3 (1 hour TTL)
4. Stagger requests across time windows

---

## 5. Data Schema Design

### 5.1 Sold Listing Schema

```sql
CREATE TABLE ebay_sold_listings (
    id BIGSERIAL PRIMARY KEY,

    -- eBay identifiers
    item_id VARCHAR(50) NOT NULL,
    listing_id VARCHAR(50),

    -- Product info
    title TEXT NOT NULL,
    subtitle TEXT,
    condition VARCHAR(50),
    condition_id INTEGER,

    -- Pricing
    sold_price DECIMAL(10, 2) NOT NULL,
    currency VARCHAR(3) DEFAULT 'USD',
    shipping_cost DECIMAL(10, 2),
    total_price DECIMAL(10, 2) GENERATED ALWAYS AS (
        sold_price + COALESCE(shipping_cost, 0)
    ) STORED,

    -- Sale details
    sold_at TIMESTAMPTZ NOT NULL,
    listing_type VARCHAR(20),  -- auction, buy_it_now
    bids INTEGER,              -- for auctions

    -- Seller
    seller_id VARCHAR(100),
    seller_name VARCHAR(255),
    seller_feedback_score INTEGER,
    seller_feedback_percent DECIMAL(5, 2),

    -- Card matching
    card_id VARCHAR(50),       -- Matched to our card database
    game VARCHAR(20),
    set_code VARCHAR(20),
    card_number VARCHAR(20),

    -- Metadata
    source VARCHAR(20) DEFAULT 'serpapi',
    raw_data JSONB,
    collected_at TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT uq_ebay_sold UNIQUE (item_id)
);

CREATE INDEX idx_ebay_sold_card ON ebay_sold_listings (card_id, sold_at DESC);
CREATE INDEX idx_ebay_sold_game ON ebay_sold_listings (game, sold_at DESC);
CREATE INDEX idx_ebay_sold_date ON ebay_sold_listings (sold_at DESC);
```

### 5.2 Active Listing Schema

```sql
CREATE TABLE ebay_active_listings (
    id BIGSERIAL PRIMARY KEY,

    -- eBay identifiers
    item_id VARCHAR(50) NOT NULL,

    -- Product info
    title TEXT NOT NULL,
    condition VARCHAR(50),

    -- Pricing
    current_price DECIMAL(10, 2) NOT NULL,
    buy_it_now_price DECIMAL(10, 2),
    shipping_cost DECIMAL(10, 2),

    -- Listing details
    listing_type VARCHAR(20),
    quantity_available INTEGER,
    watch_count INTEGER,
    end_time TIMESTAMPTZ,

    -- Seller
    seller_id VARCHAR(100),
    seller_feedback_score INTEGER,

    -- Card matching
    card_id VARCHAR(50),
    game VARCHAR(20),

    -- Tracking
    first_seen_at TIMESTAMPTZ DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ DEFAULT NOW(),
    is_active BOOLEAN DEFAULT true,

    CONSTRAINT uq_ebay_active UNIQUE (item_id)
);

CREATE INDEX idx_ebay_active_card ON ebay_active_listings (card_id) WHERE is_active;
CREATE INDEX idx_ebay_active_price ON ebay_active_listings (card_id, current_price);
```

### 5.3 Price History View

```sql
CREATE MATERIALIZED VIEW ebay_price_history AS
SELECT
    card_id,
    game,
    DATE_TRUNC('day', sold_at) as date,
    COUNT(*) as sales_count,
    AVG(sold_price) as avg_price,
    MIN(sold_price) as min_price,
    MAX(sold_price) as max_price,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY sold_price) as median_price,
    AVG(total_price) as avg_total_price
FROM ebay_sold_listings
WHERE card_id IS NOT NULL
GROUP BY card_id, game, DATE_TRUNC('day', sold_at);

CREATE INDEX idx_price_history_card ON ebay_price_history (card_id, date DESC);
```

---

## 6. Implementation Plan

### Phase 1: Infrastructure Setup (Week 1)

| Task | Description | Owner |
|------|-------------|-------|
| AWS Account Setup | Create/configure AWS account | - |
| IAM Roles | Create Lambda, Step Functions roles | - |
| Secrets Manager | Store API keys (SerpApi, eBay) | - |
| RDS Instance | PostgreSQL with schema | - |
| S3 Buckets | Raw data, processed data | - |

### Phase 2: Data Collection (Week 2)

| Task | Description | Owner |
|------|-------------|-------|
| SerpApi Integration | Sold listings collector | - |
| Browse API Integration | Active listings collector | - |
| Step Functions Workflow | ETL orchestration | - |
| EventBridge Schedule | Hourly/daily triggers | - |

### Phase 3: Processing & Storage (Week 3)

| Task | Description | Owner |
|------|-------------|-------|
| Transform Lambda | Data normalization | - |
| Card Matching | Match eBay → card database | - |
| Load Lambda | Write to RDS | - |
| Error Handling | DLQ, alerting | - |

### Phase 4: Monitoring & Optimization (Week 4)

| Task | Description | Owner |
|------|-------------|-------|
| CloudWatch Dashboards | Metrics visualization | - |
| X-Ray Tracing | Performance monitoring | - |
| Cost Optimization | Reserved capacity, caching | - |
| Documentation | Runbooks, API docs | - |

---

## 7. Cost Estimate

### Monthly Operating Costs

| Component | Service | Estimated Cost |
|-----------|---------|----------------|
| **Data Sources** | | |
| SerpApi | Small Business Plan | $50 |
| Apify (backup) | Pay-as-you-go | $20 |
| **AWS Infrastructure** | | |
| Lambda | ~500K invocations | $10 |
| Step Functions | ~10K transitions | $5 |
| RDS (PostgreSQL) | db.t3.micro | $15 |
| S3 | 10GB storage | $5 |
| Other (SQS, Secrets, etc.) | | $10 |
| **Total** | | **~$115/month** |

### Cost Optimization Strategies

1. **SerpApi Caching**: Cache results in S3 for 1 hour (free re-requests)
2. **Lambda ARM64**: Use Graviton2 for 20% cost reduction
3. **Reserved RDS**: 1-year reserved for 30% savings
4. **Spot Instances**: For batch processing workloads
5. **Query Optimization**: Batch card lookups to reduce API calls

---

## 8. Risk Assessment

### Technical Risks

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| eBay API deprecation | High | Medium | Multi-source strategy |
| SerpApi rate limits | Medium | Low | Caching, throttling |
| Data quality issues | Medium | Medium | Validation, deduplication |
| Cost overruns | Low | Medium | Budget alerts, optimization |

### Compliance Considerations

1. **eBay ToS**: Review [eBay API License Agreement](https://developer.ebay.com/develop)
2. **Data Storage**: Do not store data for prohibited market research
3. **Rate Limits**: Implement proper throttling
4. **User-Agent**: Use descriptive user agent strings

---

## 9. Alternative Approaches

### Manual Research Tool (Terapeak)

If API access proves difficult, eBay's built-in [Terapeak Product Research](https://www.ebay.com/sh/research) provides:
- 3 years of sales history
- Free for eBay sellers
- No API (manual only)

**Limitation**: No programmatic access. According to [eBay Community](https://community.ebay.com/t5/Traditional-APIs-Search/Get-data-of-terapeak-research-using-API/td-p/33565469), there is no Terapeak API available.

### Third-Party Research Tools

From [3Dsellers Best eBay Research Tools](https://www.3dsellers.com/blog/best-ebay-product-research-tools):

| Tool | Features | Cost |
|------|----------|------|
| **ZIK Analytics** | Real-time seller tracking, keyword research | $29-97/mo |
| **Sellerhook** | Profitable product identification | Varies |
| **ShelfTrend** | Competitive analysis | $19-79/mo |

---

## 10. Next Steps

1. [ ] Create AWS account/configure billing alerts
2. [ ] Sign up for SerpApi Small Business plan
3. [ ] Register for eBay Developer Program
4. [ ] Apply for Browse API production access
5. [ ] Set up development environment
6. [ ] Implement proof-of-concept Lambda

---

## References

### Official Documentation
- [eBay Developers Program](https://developer.ebay.com/)
- [Browse API Overview](https://developer.ebay.com/api-docs/buy/browse/overview.html)
- [Marketplace Insights API](https://developer.ebay.com/api-docs/buy/static/api-insights.html)
- [eBay API Call Limits](https://developer.ebay.com/develop/get-started/api-call-limits)

### AWS Resources
- [AWS Lambda ETL Reference Architecture](https://github.com/aws-samples/aws-lambda-etl-ref-architecture)
- [Step Functions ETL Pipeline Pattern](https://github.com/aws-samples/aws-step-functions-etl-pipeline-pattern)
- [Orchestrate ETL with Step Functions](https://docs.aws.amazon.com/prescriptive-guidance/latest/patterns/orchestrate-an-etl-pipeline-with-validation-transformation-and-partitioning-using-aws-step-functions.html)

### Third-Party APIs
- [SerpApi eBay Search API](https://serpapi.com/ebay-search-api)
- [SerpApi Pricing](https://serpapi.com/pricing)
- [Apify eBay Scraper Pro](https://apify.com/webdatalabs/ebay-scraper-pro)
- [Apify eBay Items Scraper](https://apify.com/dtrungtin/ebay-items-scraper)

### Community Discussions
- [Access to sold/completed listing data](https://community.ebay.com/t5/eBay-APIs-Talk-to-your-fellow/Access-to-sold-completed-listing-data-what-options-do-non/m-p/35398955)
- [Terapeak API availability](https://community.ebay.com/t5/RESTful-Sell-APIs-Marketing/Is-Terapeak-API-available/td-p/33705830)
