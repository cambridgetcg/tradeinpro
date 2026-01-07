# OPTCG API to RDS Data Flow Analysis

**Date:** 2026-01-07
**Issue:** Daily card price snapshots failing since unknown date

---

## Executive Summary

The OPTCG API data flow to the RDS database is **partially working**:
- EN card prices from OPTCG API **ARE being updated** (515 cards, last update: today 08:00 UTC)
- Daily **index snapshots ARE being created** (32 indices today)
- Daily **card price history snapshots ARE FAILING** due to a numeric overflow bug

**Critical Bug Found:** The `change` column in `card_price_history` has `Decimal(8,4)` precision which cannot store percentage changes exceeding 9999.9999%. We have 11 cards with >15,000% daily changes causing the batch insert to fail.

---

## Data Flow Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                            OPTCG API DATA FLOW                                           │
└─────────────────────────────────────────────────────────────────────────────────────────┘

                    ┌───────────────────────────────────────────┐
                    │           OPTCG API (External)            │
                    │  https://optcgapi.com or similar          │
                    │                                           │
                    │  Provides: TCGplayer USD prices           │
                    │  Updates: Every few hours                 │
                    └─────────────────┬─────────────────────────┘
                                      │
                                      │ Scraped/fetched by
                                      ▼
                    ┌───────────────────────────────────────────┐
                    │      AWS Lambda (trading-card-pricer)     │
                    │                                           │
                    │  Schedule: 8 AM / 8 PM UTC               │
                    │  Source:   /Users/alex/trading-card-pricer│
                    │  Output:   RDS card_prices_v2 table      │
                    │            SNS notification              │
                    └─────────────────┬─────────────────────────┘
                                      │
                    ┌─────────────────┴─────────────────┐
                    │                                   │
                    ▼                                   ▼
      ┌─────────────────────────┐       ┌─────────────────────────┐
      │  Direct RDS Write       │       │  SNS Notification       │
      │                         │       │                         │
      │  Table: card_prices_v2  │       │  → /api/webhooks/prices │
      │  Columns:               │       │  → syncPricesFromExternal│
      │   - optcgTcgplayerUsd   │       │                         │
      │   - optcgTcgplayerGbp   │       │  (Backup trigger if     │
      │   - optcgUpdatedAt      │       │   Lambda can't write    │
      │   - bestPriceGbp        │       │   directly to RDS)      │
      │                         │       │                         │
      └─────────────────────────┘       └─────────────────────────┘
                    │
                    │ Cron: 00:00 UTC daily
                    ▼
      ┌───────────────────────────────────────────────────────────┐
      │              /api/cron/price-snapshot                      │
      │                                                            │
      │  1. Calculate index values (GAME, SET, TOP_100, LANGUAGE) │
      │  2. Take PriceIndexSnapshot (✅ Working - 32 indices)     │
      │  3. Take CardPriceHistory snapshots                        │
      │     ❌ FAILING - Decimal overflow on change column        │
      │                                                            │
      └───────────────────────────────────────────────────────────┘
                    │
                    ▼
      ┌───────────────────────────────────────────────────────────┐
      │                     RDS Tables                             │
      │                                                            │
      │  ┌─────────────────────┐   ┌─────────────────────────┐    │
      │  │  card_prices_v2     │   │  price_index_snapshots  │    │
      │  │  (Current prices)   │   │  (Index history)        │    │
      │  │                     │   │                         │    │
      │  │  ✅ 1,000 cards     │   │  ✅ 8,323 snapshots     │    │
      │  │  ✅ Last: 08:00 UTC │   │  ✅ 32 today            │    │
      │  └─────────────────────┘   └─────────────────────────┘    │
      │                                                            │
      │  ┌─────────────────────────────────────────────────────┐  │
      │  │  card_price_history (Daily snapshots per card)      │  │
      │  │                                                      │  │
      │  │  ❌ 0 records today (should be 1,000)               │  │
      │  │  ✅ 772 records yesterday                            │  │
      │  │  ✅ 231,417 total (345 days)                        │  │
      │  │                                                      │  │
      │  │  FAILING because:                                    │  │
      │  │  - change column: Decimal(8,4) max = 9999.9999%     │  │
      │  │  - 11 cards have >15,000% changes                   │  │
      │  │  - Batch INSERT fails, no records written           │  │
      │  └─────────────────────────────────────────────────────┘  │
      │                                                            │
      └───────────────────────────────────────────────────────────┘
```

---

## Current State Analysis

### ✅ Working Components

| Component | Status | Details |
|-----------|--------|---------|
| OPTCG API fetch | Working | Lambda writes directly to RDS |
| CardPriceV2 (EN) | Updated | 515 cards, last update 08:00 UTC today |
| CardPriceV2 (JP) | Updated | 485 cards, manually synced today (was stale 8 days) |
| PriceIndexSnapshot | Working | 32 indices created today at 00:00:26 UTC |
| Index calculations | Working | GAME, SET, TOP_100, LANGUAGE all computed |

### ❌ Failing Components

| Component | Status | Error |
|-----------|--------|-------|
| CardPriceHistory | Failing | `numeric field overflow` - Decimal(8,4) exceeded |
| Daily card snapshots | Failing | 0 records created today |

---

## Root Cause: Decimal Overflow Bug

### The Problem

```sql
-- Schema definition
change Decimal @default(0) @db.Decimal(8, 4)
-- Maximum storable value: 9999.9999
-- Minimum storable value: -9999.9999
```

### Cards Causing Overflow (>9999% change)

| Card ID | Previous | Current | Change % |
|---------|----------|---------|----------|
| OP09-OP09-118-manga | £10.28 | £3,486.90 | **33,819%** |
| OP05-OP05-069-manga-altart | £2.74 | £724.45 | **26,340%** |
| OP12-OP09-093-sp-gold | £3.21 | £796.74 | **24,721%** |
| OP09-OP09-119-manga | £5.09 | £1,118.27 | **21,870%** |
| EB01-EB01-006-manga-altart | £6.04 | £1,097.78 | **18,075%** |
| OP03-OP03-122-manga-altart | £2.74 | £487.62 | **17,696%** |
| OP11-OP11-118-manga | £4.15 | £707.27 | **16,943%** |
| OP09-OP09-004-manga | £5.57 | £841.39 | **15,006%** |
| EB02-EB02-061-manga | £6.98 | £1,071.64 | **15,253%** |
| OP05-OP05-074-manga-altart | £2.74 | £412.05 | **14,938%** |
| OP09-OP05-067-manga | £5.09 | £541.80 | **10,544%** |

### Why These Extreme Changes?

These are likely **new manga variant cards** that were:
1. Added to CardPriceV2 recently with correct high prices
2. But had incorrect/placeholder low prices in yesterday's snapshot
3. Or were newly added from the JP sync with very different pricing

---

## Recommended Fixes

### Fix 1: Cap Change Values (Quick Fix)

Modify `takeCardPriceSnapshots()` in `app/lib/price-index.server.ts`:

```typescript
// Line 466: Add capping
const rawChange = prevPrice > 0 ? ((price - prevPrice) / prevPrice) * 100 : 0;
const change = Math.max(-9999, Math.min(9999, rawChange)); // Cap to ±9999%
```

### Fix 2: Expand Column Precision (Better Fix)

Create migration to change column type:

```sql
ALTER TABLE card_price_history
ALTER COLUMN change TYPE DECIMAL(12, 4);
```

Or in Prisma schema:
```prisma
change Decimal @default(0) @db.Decimal(12, 4)  // Supports up to 99,999,999.9999%
```

### Fix 3: Use Float Instead (Alternative)

```prisma
change Float @default(0)  // No precision limits, handles any percentage
```

---

## Data Flow Verification Commands

```bash
# Check OPTCG price population
npx tsx -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.cardPriceV2.count({ where: { optcgTcgplayerGbp: { not: null } } })
  .then(c => console.log('Cards with OPTCG prices:', c));
"

# Check today's snapshot status
npx tsx -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
const today = new Date(); today.setHours(0,0,0,0);
p.cardPriceHistory.count({ where: { snapshotDate: today } })
  .then(c => console.log('Today\\'s snapshots:', c));
"

# Manually trigger snapshot (after fix)
curl -X POST https://cardforum.vercel.app/api/cron/price-snapshot \
  -H "Authorization: Bearer $CRON_SECRET"
```

---

## Cron Schedule Reference

| Time (UTC) | Endpoint | Purpose |
|------------|----------|---------|
| 00:00 | /api/cron/price-snapshot | Index + card history snapshots |
| 01:00 | /api/cron/price-sync | Sync daily_prices.xlsx from S3 |
| 02:00 | /api/cron/pricefeed-sync | Sync multi-channel prices |
| 03:00 | /api/cron/cleanup | Clean expired records |
| 14:00 | /api/cron/jp-price-sync | JP prices from S3 (currently failing) |
| 03:00 Sun | /api/cron/correlation-calc | Weekly correlation calculation |

---

## Summary

1. **OPTCG API → CardPriceV2**: ✅ Working (Lambda writes directly to RDS)
2. **CardPriceV2 → PriceIndexSnapshot**: ✅ Working (32 indices today)
3. **CardPriceV2 → CardPriceHistory**: ❌ Failing (Decimal overflow)
4. **Root cause**: 11 manga variant cards have >15,000% price changes
5. **Fix**: Cap change values or expand Decimal precision
