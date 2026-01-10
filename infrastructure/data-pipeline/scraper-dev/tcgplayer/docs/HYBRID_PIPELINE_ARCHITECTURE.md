# TCGPlayer Hybrid Pipeline Architecture

> **Purpose**: Resilient TCGPlayer price data collection using JustTCG API as primary source with Bright Data scraper as fallback.

---

## Overview

The hybrid pipeline combines two data sources for maximum reliability:

```
┌─────────────────────────────────────────────────────────────────┐
│                    HYBRID TCGPLAYER PIPELINE                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                  PRIMARY: JustTCG API                      │  │
│  │  ✓ Fast (API calls)                                        │  │
│  │  ✓ Reliable (99.9% uptime)                                 │  │
│  │  ✓ Cost-effective ($20-50/month)                           │  │
│  │  ✓ 180-day price history                                   │  │
│  │  ✓ Statistics (24h/7d/30d/90d changes)                     │  │
│  │  ✓ Multiple games supported                                │  │
│  └───────────────────────────────────────────────────────────┘  │
│                           │                                      │
│                           ▼                                      │
│                    ┌──────────────┐                             │
│                    │ Circuit      │                             │
│                    │ Breaker      │                             │
│                    └──────┬───────┘                             │
│                           │                                      │
│              ┌────────────┴────────────┐                        │
│              │ API Available?          │                        │
│              └────────┬────────────────┘                        │
│                       │                                          │
│           ┌───────────┴───────────┐                             │
│           │ YES                   │ NO / RATE LIMITED           │
│           ▼                       ▼                              │
│  ┌─────────────────┐   ┌─────────────────────────────────────┐  │
│  │ Use JustTCG API │   │     FALLBACK: Bright Data Scraper    │  │
│  └─────────────────┘   │  ✓ Scrapes TCGPlayer directly        │  │
│                        │  ✓ Works when API unavailable         │  │
│                        │  ✓ Higher cost (per-request)          │  │
│                        │  ✓ Slower (browser automation)        │  │
│                        └─────────────────────────────────────┘  │
│                                                                  │
│                           │                                      │
│                           ▼                                      │
│              ┌─────────────────────────┐                        │
│              │  Merge & Normalize Data  │                        │
│              │  (API has priority)      │                        │
│              └────────────┬────────────┘                        │
│                           │                                      │
│                           ▼                                      │
│              ┌─────────────────────────┐                        │
│              │  Save to RDS Archive    │                        │
│              │  - tcgplayer_price_archive                       │
│              │  - tcgplayer_condition_snapshot                  │
│              │  - tcgplayer_price_history                       │
│              └─────────────────────────┘                        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Data Sources Comparison

| Feature | JustTCG API | Bright Data Scraper |
|---------|-------------|---------------------|
| **Cost** | $20-50/month (fixed) | ~$0.001/request |
| **Speed** | ~100ms/request | ~3-5s/request |
| **Reliability** | 99.9% | 80-90% (anti-bot) |
| **Rate Limits** | 10-500 req/min | ~5 req/min |
| **Historical Data** | 180 days | Current only |
| **Statistics** | Yes (changes, std dev) | No |
| **Games Supported** | 13 TCGs | TCGPlayer only |
| **Condition Prices** | Yes | Yes |
| **Seller Listings** | Limited | Full |

---

## Usage

### Basic Usage

```bash
# Using JustTCG API (recommended)
JUSTTCG_API_KEY=xxx DATABASE_URL=xxx \
  npx tsx scripts/daily-tcgplayer-production.ts

# With Bright Data fallback enabled
JUSTTCG_API_KEY=xxx BRIGHTDATA_TOKEN=xxx DATABASE_URL=xxx \
  npx tsx scripts/daily-tcgplayer-production.ts
```

### Options

```bash
# Dry run (no database writes)
npx tsx scripts/daily-tcgplayer-production.ts --dry-run

# Specific game
npx tsx scripts/daily-tcgplayer-production.ts --game=pokemon

# Specific sets
npx tsx scripts/daily-tcgplayer-production.ts --sets=OP01,OP02

# Force API only (no fallback)
npx tsx scripts/daily-tcgplayer-production.ts --force-api

# Force scraper only (bypass API)
npx tsx scripts/daily-tcgplayer-production.ts --force-scraper

# Limit cards per set (for testing)
npx tsx scripts/daily-tcgplayer-production.ts --max-cards=10
```

---

## Database Schema

### tcgplayer_price_archive

Daily price snapshots with USD prices (TCGPlayer native) and GBP conversions.

```sql
CREATE TABLE tcgplayer_price_archive (
  id SERIAL PRIMARY KEY,
  card_id VARCHAR(100) NOT NULL,
  date DATE NOT NULL,
  game VARCHAR(50) DEFAULT 'onepiece',
  set_code VARCHAR(20),
  card_number VARCHAR(20),
  variant_type VARCHAR(50),
  card_name VARCHAR(500),

  -- Prices (USD native, GBP converted)
  market_price_usd DECIMAL(10,2),
  low_price_usd DECIMAL(10,2),
  market_price_gbp DECIMAL(10,2),
  low_price_gbp DECIMAL(10,2),

  -- Statistics (from JustTCG)
  price_change_24h DECIMAL(8,4),
  price_change_7d DECIMAL(8,4),
  price_change_30d DECIMAL(8,4),
  std_dev DECIMAL(10,4),

  -- Source tracking
  data_source VARCHAR(20) DEFAULT 'justtcg',

  UNIQUE(card_id, date)
);
```

### tcgplayer_condition_snapshot

Condition-level prices (NM, LP, MP, HP, DMG) with printing variants (Normal, Foil).

### tcgplayer_price_history

180-day price history from JustTCG API for ML training.

---

## Circuit Breaker

The pipeline uses circuit breakers to prevent cascading failures:

```
State: CLOSED (normal) → OPEN (failing) → HALF_OPEN (testing) → CLOSED
```

Configuration:
- **Failure threshold**: 3 failures in 2 minutes opens circuit
- **Timeout**: 60 seconds before half-open retry
- **Success threshold**: 2 successes to close circuit

---

## Cost Analysis

### Scenario: One Piece TCG (~1,500 cards)

| Approach | Monthly Cost | Notes |
|----------|--------------|-------|
| JustTCG Professional | $50 | 50k req/month, covers all games |
| Bright Data only | ~$45-67 | 1,500 cards × 30 days × $0.001 |
| **Hybrid (recommended)** | **$50** | JustTCG primary, scraper as fallback |

### When to Use Scraper

1. JustTCG API is down or rate limited
2. Game not supported by JustTCG
3. Need seller-level listing data
4. Real-time spot price validation

---

## Error Handling

The pipeline handles errors gracefully:

1. **API errors**: Circuit breaker opens, falls back to scraper
2. **Scraper blocks**: Circuit breaker opens, waits for cooldown
3. **Database errors**: Logged, card skipped, continues processing
4. **Network timeouts**: Retried with exponential backoff

---

## AWS Deployment

The pipeline runs on AWS ECS Fargate with:
- Secrets Manager for API keys
- CloudWatch for metrics and logs
- EventBridge for scheduling (8 AM UTC daily)

See `../cardmarket/docs/AWS_DEPLOYMENT_GUIDE.md` for deployment instructions.

---

## Files

| File | Purpose |
|------|---------|
| `src/pipeline/hybrid-tcgplayer-pipeline.ts` | Hybrid pipeline orchestrator |
| `src/scrapers/tcgplayer-brightdata-scraper.ts` | Bright Data scraper implementation |
| `src/apis/justtcg-client.ts` | JustTCG API client |
| `scripts/daily-tcgplayer-production.ts` | Production CLI script |
| `prisma/migrations/20260110_add_tcgplayer_archive/` | Database migration |

---

*"Two is one, one is none. Always have a backup."*
