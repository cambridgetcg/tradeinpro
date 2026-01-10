# CardMarket Pipeline Integration Architecture

> **Date**: 2026-01-09
> **Status**: Implementation Complete
> **Purpose**: Integrate CardMarket scraper with ML training data pipeline

---

## Executive Summary

This document describes the integration of the CardMarket targeted scraper with the TCG data pipeline infrastructure. The integration enables:

1. **Automated price collection** from CardMarket V2/V3 variant cards
2. **Multi-destination storage** to RDS and S3
3. **Training data generation** for neural network models
4. **Scheduled execution** via cron/Lambda/EventBridge

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          CARDMARKET DATA PIPELINE                           │
└─────────────────────────────────────────────────────────────────────────────┘

   ┌─────────────────┐
   │  EventBridge    │──── Schedule: 0 3 * * * (3 AM UTC)
   │  / Cron Job     │
   └────────┬────────┘
            │
            ▼
   ┌─────────────────┐
   │  Daily Job      │──── Retry logic, notifications
   │  Runner         │
   └────────┬────────┘
            │
            ▼
   ┌─────────────────┐
   │  Targeted       │──── Playwright browser automation
   │  Scraper        │──── 44 V2/V3 cards in watchlist
   │  (Playwright)   │──── 5-10s delays between requests
   └────────┬────────┘
            │
            ▼
   ┌─────────────────┐
   │  Data           │──── Transform scraped prices
   │  Integration    │──── EUR → GBP conversion
   └────────┬────────┘
            │
     ┌──────┴──────┐
     │             │
     ▼             ▼
┌─────────┐   ┌─────────┐
│   RDS   │   │   S3    │
│ Postgres│   │ Data    │
│         │   │ Lake    │
└─────────┘   └─────────┘
     │             │
     │             │
     ▼             ▼
┌───────────────────────────────────────────┐
│           Training Data Export            │
│  - 30-timestep LSTM sequences            │
│  - 45-feature vectors                     │
│  - Train/Val/Test splits                  │
└───────────────────────────────────────────┘
```

---

## Key Implementation Insights

### 1. V2/V3 Variants are English-Only

**Discovery**: CardMarket V2 and V3 variant cards are exclusively English. This significantly simplifies the scraping logic.

| Variant | Description | Languages |
|---------|-------------|-----------|
| V.1 | Base version | EN or JP |
| V.2 | Parallel/Alternate Art | **English only** |
| V.3 | Special Alternate Art | **English only** |

**Implication**: No language filtering needed for V2/V3 scrapes. All seller listings are guaranteed English.

### 2. Browser Automation Required

**Challenge**: CardMarket uses Cloudflare JavaScript challenge protection.

**Solution**: Playwright browser automation with VPN/European IP routing.

```typescript
// Key configuration
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)...',
  locale: 'en-GB',
  viewport: { width: 1920, height: 1080 }
});
```

**Requirements**:
- European IP (German datacenter via VPN)
- Minimum 5-second delay between requests
- Session management for cookies

### 3. Price Data Hierarchy

CardMarket provides multiple price points with different meanings:

| Field | Description | Use Case |
|-------|-------------|----------|
| **Trend** | CardMarket algorithm-based price | Primary pricing signal |
| **From** | Lowest current listing | Arbitrage detection |
| **7-day Avg** | Average of last 7 days sales | Short-term trend |
| **30-day Avg** | Average of last 30 days sales | Baseline reference |
| **Available** | Number of sellers with stock | Liquidity signal |

### 4. Schema Already Prepared

The existing Prisma schema (`MarketPriceEU`, `CardPriceV2`, `PriceHistoryDaily`) was designed for this integration. Key fields:

```prisma
model MarketPriceEU {
  cardId          String
  source          String    // 'cardmarket_scraper'
  trendPrice      Decimal?
  lowPrice        Decimal?  // 'from' price
  avg7d           Decimal?
  avg30d          Decimal?
  availableItems  Int?
  collectedAt     DateTime
}
```

### 5. Feature Engineering Alignment

The pipeline generates the exact 45-feature format expected by the LSTM model:

| Category | Features | Count |
|----------|----------|-------|
| Price Features | current_gbp, spreads, percentiles | 12 |
| Temporal Features | velocity, volatility, RSI | 15 |
| Market Features | set momentum, correlations | 10 |
| FX Features | exchange rates, trends | 5 |
| Derived Features | opportunity, risk scores | 3 |

---

## Data Flow Details

### Stage 1: Scraping

```
Input: targeted-cards.json watchlist (44 V2/V3 cards)
Process: Playwright browser automation
Output: ScrapedPrice[] array

Key metrics:
- Cards per run: ~44
- Time per card: ~5-10 seconds
- Total duration: ~10-15 minutes
```

### Stage 2: RDS Integration

Three tables updated per scraped card:

1. **MarketPriceEU** (INSERT): Historical price record
   - One record per scrape per card
   - Enables time-series analysis

2. **CardPriceV2** (UPSERT): Current price
   - Updates `limitlessCardmarketEur/Gbp`
   - Updates `limitlessUpdatedAt`

3. **PriceHistoryDaily** (UPSERT): Daily aggregate
   - One record per day per card
   - Combines US and EU prices

### Stage 3: S3 Storage

Raw data stored as NDJSON:

```
s3://tcg-{env}-data-lake/
├── raw/prices/source=cardmarket_scraper/
│   └── year=2026/month=01/day=09/hour=03/
│       └── scrape-{timestamp}.ndjson
└── training/cardmarket/
    └── datasets/{date}/
        ├── train.json
        ├── validation.json
        ├── test.json
        ├── normalization_stats.json
        └── metadata.json
```

### Stage 4: Training Export

Training data format for TensorFlow.js LSTM:

```typescript
interface TrainingExample {
  cardId: string;
  sequence: number[][];  // [30, 45] - 30 days × 45 features
  labels: {
    dealType: number[];      // One-hot [10 classes]
    confidence: number;      // [0-1]
    expectedReturn: number;  // Percentage
    riskLevel: number[];     // One-hot [3 classes]
  };
}
```

---

## Scheduling & Deployment

### Local Development

```bash
# Test mode (3 cards)
npx tsx src/pipeline/run-pipeline.ts --test

# Full pipeline (dry run)
npx tsx src/pipeline/run-pipeline.ts --dry-run

# Full pipeline
npx tsx src/pipeline/run-pipeline.ts
```

### Cron Job

```cron
# Daily at 3 AM UTC
0 3 * * * cd /path/to/scraper-dev/cardmarket && npx tsx src/scheduler/daily-job.ts >> /var/log/cardmarket.log 2>&1
```

### AWS Lambda + EventBridge

The daily job exports a Lambda handler:

```typescript
// src/scheduler/daily-job.ts
export async function handler(event: any): Promise<{ statusCode: number; body: string }> {
  const runner = new DailyJobRunner();
  const result = await runner.execute();
  return { statusCode: result.success ? 200 : 500, body: JSON.stringify(result) };
}
```

EventBridge rule:
- Schedule: `cron(0 3 * * ? *)` (3 AM UTC daily)
- Target: CardMarket scraper Lambda

---

## Error Handling & Retry

### Retry Policy

| Metric | Value |
|--------|-------|
| Max retries | 2 (3 total attempts) |
| Retry delay | 60 seconds |
| Backoff | Linear |

### Failure Modes

| Failure | Detection | Action |
|---------|-----------|--------|
| Cloudflare block | Page title "Just a moment..." | Retry with longer delay |
| Rate limit | 429 status or aggressive blocks | Stop and wait for fallback schedule |
| Network error | Timeout or connection refused | Retry immediately |
| Card not found | 404 page | Skip and continue |
| Database error | Prisma exception | Log and continue (best effort) |

### Notifications

On failure, the job sends notifications via:
- Slack webhook (if configured)
- Email (to ops@cambridgetcg.com)

---

## FX Rate Handling

CardMarket prices are in EUR. Conversion to GBP:

1. **Primary**: Fetch latest rate from `FXRate` table
2. **Fallback**: Use default rate (0.85)

```typescript
private async updateFxRate(): Promise<void> {
  const fxRate = await this.prisma.fXRate.findFirst({
    where: { currencyPair: 'EUR/GBP' },
    orderBy: { timestamp: 'desc' }
  });
  if (fxRate) {
    this.eurGbpRate = fxRate.rate.toNumber();
  }
}
```

FX rate is stored alongside prices in:
- `PriceHistoryDaily.fxEurGbp`
- S3 raw records `fx_eur_gbp` field

---

## Training Data Quality

### Minimum Requirements

| Requirement | Value |
|-------------|-------|
| Minimum history per card | 14 days |
| Sequence length | 30 timesteps |
| Feature count | 45 per timestep |

### Deal Type Distribution

The current rule-based labeler generates these deal types:

| Type | Description | Trigger |
|------|-------------|---------|
| UNDERVALUED_STATISTICAL | Below 30-day mean | Price >15% below mean |
| MOMENTUM_BREAKOUT | Price acceleration | Velocity >2%/day |
| (Others) | Pending neural model | Will be assigned by trained model |

### Normalization

Z-score normalization with clipping:
- Mean and std computed per feature
- Outliers clipped to ±3 standard deviations
- Stats saved to `normalization_stats.json`

---

## File Structure

```
scraper-dev/cardmarket/
├── config/
│   ├── targeted-cards.json      # Watchlist configuration
│   └── targeted-cards.yaml      # YAML version (reference)
│
├── docs/
│   ├── CARDMARKET_SCRAPING_INSIGHTS.md
│   ├── TARGETED_SCRAPING_STRATEGY.md
│   └── PIPELINE_INTEGRATION_ARCHITECTURE.md  # This file
│
├── src/
│   ├── services/
│   │   └── targeted-scraper.ts  # Playwright browser scraper
│   │
│   ├── pipeline/
│   │   ├── index.ts             # Module exports
│   │   ├── data-integration.ts  # RDS + S3 writer
│   │   ├── training-exporter.ts # ML training data generator
│   │   └── run-pipeline.ts      # Pipeline orchestrator
│   │
│   └── scheduler/
│       └── daily-job.ts         # Scheduled job runner
│
└── scripts/
    └── test-*.ts                # Various test scripts
```

---

## Metrics & Monitoring

### Success Metrics

| Metric | Target | Alert Threshold |
|--------|--------|-----------------|
| Cards scraped/day | 44 | <40 |
| Success rate | >95% | <90% |
| RDS writes/day | 44 | <40 |
| S3 uploads/day | 1 | 0 |
| Avg latency/card | <10s | >15s |

### CloudWatch Dashboard Widgets

1. **Scrape Success Rate**: Daily % of cards successfully scraped
2. **Price Coverage**: % of watchlist with fresh prices (<24h)
3. **RDS Write Latency**: P50/P99 write times
4. **Training Data Volume**: Examples generated per export

---

## Security Considerations

### Sensitive Data

| Data | Location | Protection |
|------|----------|------------|
| Database URL | `.env` / Secrets Manager | Never committed |
| AWS credentials | IAM role / env vars | Never committed |
| Bright Data proxy | `.env` / Secrets Manager | Not currently used |
| Slack webhook | Secrets Manager | Optional |

### Rate Limiting

The scraper is designed to be a "good citizen":
- 5-10 second delays between requests
- Single-threaded (no parallel requests)
- 3 AM UTC (off-peak hours)
- Max 100 cards/day budget

---

## Future Enhancements

### Short Term

1. **Add more cards to watchlist**: Expand from 44 to 100+ V2/V3 cards
2. **Historical backfill**: Scrape last 30 days of prices to bootstrap training
3. **Better deal labeling**: Replace rule-based with neural predictions

### Medium Term

1. **Bright Data proxy integration**: Remove VPN dependency
2. **Lambda deployment**: Move from local cron to AWS Lambda
3. **Real-time alerts**: Notify on significant price movements

### Long Term

1. **Multi-TCG support**: Extend to Pokemon, MTG, etc.
2. **eBay integration**: Cross-marketplace arbitrage
3. **Model retraining pipeline**: Automated daily model updates

---

## Implementation Summary

| Component | Status | Lines of Code |
|-----------|--------|---------------|
| Targeted Scraper | ✅ Complete | ~600 |
| Data Integration | ✅ Complete | ~400 |
| Training Exporter | ✅ Complete | ~450 |
| Pipeline Runner | ✅ Complete | ~250 |
| Daily Job | ✅ Complete | ~200 |
| Documentation | ✅ Complete | ~500 |

**Total new code**: ~2,400 lines

---

*Document Version: 1.0.0*
*Last Updated: 2026-01-09*
