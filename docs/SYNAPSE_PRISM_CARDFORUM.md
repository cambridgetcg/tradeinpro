# Synapse: Cardforum ↔ PRISM Neural Network

**Date:** 2026-01-07
**Type:** Inter-System Synapse Documentation
**Purpose:** Define relationships, shared resources, and data flows between cardforum and prism-app

---

## Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     TCG TRADE-IN ECOSYSTEM NEURAL NETWORK                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   EXTERNAL LAYER              CORE LAYER               CONSUMER LAYER       │
│   (Data Sources)              (Storage)                (Applications)       │
│                                                                              │
│   ┌─────────────┐          ┌─────────────┐          ┌─────────────┐        │
│   │  TCGplayer  │          │             │          │  cardforum  │        │
│   │  CardMarket │ ───────► │  AWS RDS    │ ◄─────── │  (Shopify)  │        │
│   │  JustTCG    │          │  PostgreSQL │          │             │        │
│   └─────────────┘          │             │          └─────────────┘        │
│          │                 │  cardforum  │                 │               │
│          ▼                 │  database   │                 │               │
│   ┌─────────────┐          │             │          ┌──────┴──────┐        │
│   │   Lambda    │ ───────► │             │ ◄─────── │  prism-app  │        │
│   │  (Pricer)   │          │             │          │  (Index)    │        │
│   └─────────────┘          └─────────────┘          └─────────────┘        │
│          │                        │                        │               │
│          ▼                        ▼                        ▼               │
│   ┌─────────────┐          ┌─────────────┐          ┌─────────────┐        │
│   │     S3      │ ───────► │  Exchange   │          │   Vercel    │        │
│   │ (Pricefeed) │          │   Rates     │          │   (Host)    │        │
│   └─────────────┘          └─────────────┘          └─────────────┘        │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## System Identity Cards

### Cardforum

| Attribute | Value |
|-----------|-------|
| **Type** | Shopify App (Full-Stack) |
| **Framework** | React Router 7.x |
| **Purpose** | Trade-in submissions, pricing, customer management |
| **Database Role** | Schema owner, read/write for trade-ins |
| **Price Data Role** | Consumer (reads CardPriceV2) |
| **Location** | `/Users/alex/TCG_TradeIn/cardforum` |
| **Deployment** | Vercel |

### PRISM (prism-app)

| Attribute | Value |
|-----------|-------|
| **Type** | Price Index Application |
| **Framework** | Next.js 14 |
| **Purpose** | Price analytics, indices, market intelligence |
| **Database Role** | Consumer, historical snapshot writer |
| **Price Data Role** | Consumer (reads CardPriceV2, writes history) |
| **Location** | `/Users/alex/TCG_TradeIn/prism-app` |
| **Deployment** | Vercel |

### Trading-Card-Pricer Lambda

| Attribute | Value |
|-----------|-------|
| **Type** | AWS Lambda Function |
| **Purpose** | Aggregate prices from external APIs |
| **Database Role** | Writer (updates CardPriceV2) |
| **Location** | External (not in this repo) |
| **Trigger** | Scheduled (2x daily) |

---

## Shared Resources

### 1. AWS RDS PostgreSQL Database

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         SHARED DATABASE: cardforum                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   Host: cardforum.cn4c2su0o42n.us-east-1.rds.amazonaws.com:5432             │
│   Name: cardforum                                                            │
│   Engine: PostgreSQL                                                         │
│                                                                              │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                        TABLE OWNERSHIP                               │   │
│   ├─────────────────────────────────────────────────────────────────────┤   │
│   │                                                                      │   │
│   │   LAMBDA WRITES                  CARDFORUM WRITES                   │   │
│   │   ─────────────                  ───────────────                    │   │
│   │   card_prices_v2 (bestPrice)     trade_in_submissions               │   │
│   │   card_prices (legacy)           trade_in_items                     │   │
│   │                                   customers                          │   │
│   │                                   payouts                            │   │
│   │                                   payout_methods                     │   │
│   │                                   submission_notes                   │   │
│   │                                   trade_in_settings                  │   │
│   │                                   excluded_trade_in_cards            │   │
│   │                                   idempotency_records                │   │
│   │                                   japanese_price_source              │   │
│   │                                   Session                            │   │
│   │                                                                      │   │
│   │   PRISM WRITES                   SHARED READS                       │   │
│   │   ────────────                   ────────────                       │   │
│   │   card_price_history             card_prices_v2 (both apps)         │   │
│   │   price_index_snapshots          card_price_history (both)          │   │
│   │   price_correlations             price_index_snapshots (both)       │   │
│   │   index_constituents             exchange_rate_history              │   │
│   │   index_reconstitutions                                             │   │
│   │   index_weight_history                                              │   │
│   │   exchange_rate_history                                             │   │
│   │                                                                      │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2. Prisma Schema Ownership

**Owner:** Cardforum

**Reason:** Cardforum was the original application; its schema includes all tables.

**Synchronization Strategy:**
- Cardforum defines the canonical schema in `prisma/schema.prisma`
- PRISM's schema is a subset (price-related tables only)
- Schema changes MUST be coordinated between projects

**Critical Note:** If cardforum runs a migration, PRISM must regenerate its Prisma client.

### 3. AWS S3 Resources

| Bucket | Region | Purpose | Writer | Readers |
|--------|--------|---------|--------|---------|
| `tcg-tradein-images` | eu-west-2 | Card images CDN | Lambda | Both apps |
| `pricedata-tcg` | us-east-1 | Daily price feeds | Lambda | Cardforum |

### 4. Environment Variables

**Shared Variables (must match):**
```env
DATABASE_URL=postgresql://...@cardforum.cn4c2su0o42n.us-east-1.rds.amazonaws.com:5432/cardforum
CRON_SECRET=<shared-secret>
```

**App-Specific:**
```env
# Cardforum only
SHOPIFY_API_KEY=...
SHOPIFY_API_SECRET=...
PRICE_WEBHOOK_SECRET=...
ROYAL_MAIL_API_KEY=...

# PRISM only
ADMIN_SECRET=...
UPSTASH_REDIS_URL=...  (optional)
```

---

## Data Flow Synapses

### Synapse 1: Price Data Propagation

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    SYNAPSE 1: PRICE DATA PROPAGATION                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   SIGNAL: Card price update (e.g., OP01-001 changes from £10 to £12)        │
│                                                                              │
│   08:00 UTC                                                                  │
│   ─────────                                                                  │
│   ┌──────────────────┐                                                      │
│   │  External APIs   │  TCGplayer: $15.00, CardMarket: €14.50               │
│   └────────┬─────────┘                                                      │
│            │                                                                 │
│            ▼                                                                 │
│   ┌──────────────────┐                                                      │
│   │ trading-card-    │  Convert: USD→GBP, EUR→GBP                           │
│   │ pricer Lambda    │  Calculate: bestPriceGbp = min(£11.80, £12.20)      │
│   └────────┬─────────┘  = £11.80                                            │
│            │                                                                 │
│            ▼                                                                 │
│   ┌──────────────────┐                                                      │
│   │ RDS: card_prices │  UPDATE card_prices_v2                               │
│   │      _v2         │  SET best_price_gbp = 11.80,                         │
│   └────────┬─────────┘      optcg_tcgplayer_gbp = 11.80, ...                │
│            │                                                                 │
│            ├───────────────────────┬────────────────────────┐               │
│            ▼                       ▼                        ▼               │
│   ┌──────────────────┐   ┌──────────────────┐   ┌──────────────────┐       │
│   │    cardforum     │   │    prism-app     │   │   SNS Webhook    │       │
│   │                  │   │                  │   │                  │       │
│   │ Reads for:       │   │ Reads for:       │   │ Notifies:        │       │
│   │ - Trade-in quote │   │ - Index calc     │   │ - cardforum      │       │
│   │ - Card lookup    │   │ - Movers list    │   │   webhook        │       │
│   │ - Price display  │   │ - Crystal viz    │   │                  │       │
│   └──────────────────┘   └──────────────────┘   └──────────────────┘       │
│                                                                              │
│   08:15 UTC                                                                  │
│   ─────────                                                                  │
│   ┌──────────────────┐                                                      │
│   │  prism-app       │  Calculate indices from card_prices_v2               │
│   │  /cron/tcg100    │  UPSERT price_index_snapshots                        │
│   └──────────────────┘                                                      │
│                                                                              │
│   08:30 UTC                                                                  │
│   ─────────                                                                  │
│   ┌──────────────────┐                                                      │
│   │  prism-app       │  Calculate changes: (£11.80 - £10.00) / £10 = 18%   │
│   │  /cron/movers    │  INSERT card_price_history                           │
│   └──────────────────┘                                                      │
│                                                                              │
│   DOWNSTREAM CONSUMERS                                                       │
│   ────────────────────                                                       │
│   ┌──────────────────┐   ┌──────────────────┐                               │
│   │    cardforum     │   │    prism-app     │                               │
│   │                  │   │                  │                               │
│   │ Uses history for:│   │ Uses history for:│                               │
│   │ - Price charts   │   │ - Sparklines     │                               │
│   │ - Trend display  │   │ - Index history  │                               │
│   │ - Market alerts  │   │ - Volatility     │                               │
│   └──────────────────┘   └──────────────────┘                               │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Synapse 2: Trade-In Pricing Calculation

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    SYNAPSE 2: TRADE-IN PRICING                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   SIGNAL: Customer submits OP01-001 for trade-in                            │
│                                                                              │
│   ┌──────────────────┐                                                      │
│   │ Customer Browser │  POST /api/submissions                               │
│   └────────┬─────────┘  { cards: [{ cardId: "OP01-001", condition: "NM" }] }│
│            │                                                                 │
│            ▼                                                                 │
│   ┌──────────────────┐                                                      │
│   │    cardforum     │                                                      │
│   │  api.submissions │                                                      │
│   └────────┬─────────┘                                                      │
│            │                                                                 │
│            ▼                                                                 │
│   ┌──────────────────┐                                                      │
│   │ pricing.server.ts│  calculateCardPrice(cardId, condition)               │
│   └────────┬─────────┘                                                      │
│            │                                                                 │
│            ▼                                                                 │
│   ┌──────────────────────────────────────────────────────────────────────┐ │
│   │                         PRICE LOOKUP                                  │ │
│   ├──────────────────────────────────────────────────────────────────────┤ │
│   │                                                                       │ │
│   │   SELECT best_price_gbp, tradein_price_gbp                           │ │
│   │   FROM card_prices_v2                                                 │ │
│   │   WHERE card_id = 'OP01-001'                                          │ │
│   │                                                                       │ │
│   │   Result: { bestPriceGbp: 11.80, tradeinPriceGbp: 8.26 }             │ │
│   │                                                                       │ │
│   │   ┌─────────────────────────────────────────────────────────────┐    │ │
│   │   │  CONDITION MULTIPLIERS (pricing.server.ts)                   │    │ │
│   │   ├─────────────────────────────────────────────────────────────┤    │ │
│   │   │  NM  (Near Mint)    : tradeinPriceGbp × 1.00 = £8.26        │    │ │
│   │   │  LP  (Lightly Played): tradeinPriceGbp × 0.79 = £6.53       │    │ │
│   │   │  MP  (Moderately)   : tradeinPriceGbp × 0.57 = £4.71        │    │ │
│   │   │  HP  (Heavily Played): tradeinPriceGbp × 0.36 = £2.97       │    │ │
│   │   │  DMG (Damaged)      : tradeinPriceGbp × 0.14 = £1.16        │    │ │
│   │   └─────────────────────────────────────────────────────────────┘    │ │
│   │                                                                       │ │
│   └──────────────────────────────────────────────────────────────────────┘ │
│            │                                                                 │
│            ▼                                                                 │
│   ┌──────────────────┐                                                      │
│   │ TradeInItem      │  quotedPrice = £8.26 (NM)                           │
│   │ (database)       │  condition = "NM"                                    │
│   └──────────────────┘                                                      │
│                                                                              │
│   DEPENDENCY                                                                 │
│   ──────────                                                                 │
│   cardforum pricing DEPENDS ON:                                             │
│   - Lambda updating card_prices_v2 (stale = wrong quotes)                   │
│   - tradeinPriceGbp calculation (70% of bestPriceGbp)                       │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Synapse 3: Index Consumption

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    SYNAPSE 3: INDEX CONSUMPTION                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   WRITER: prism-app                                                          │
│   READERS: prism-app, cardforum                                              │
│                                                                              │
│   ┌──────────────────┐                                                      │
│   │    prism-app     │  08:15 UTC cron                                      │
│   │  /cron/tcg100    │                                                      │
│   └────────┬─────────┘                                                      │
│            │                                                                 │
│            ▼                                                                 │
│   ┌──────────────────────────────────────────────────────────────────────┐ │
│   │  price_index_snapshots                                                │ │
│   │                                                                       │ │
│   │  indexType │ indexKey  │ value  │ change24h │ cardCount │ date       │ │
│   │  ──────────┼───────────┼────────┼───────────┼───────────┼──────────  │ │
│   │  GAME      │ onepiece  │ 45.23  │ +2.1%     │ 4521      │ 2026-01-07 │ │
│   │  TOP_100   │ top100    │ 127.89 │ +1.8%     │ 100       │ 2026-01-07 │ │
│   │  LANGUAGE  │ EN        │ 38.12  │ +2.3%     │ 2890      │ 2026-01-07 │ │
│   │  LANGUAGE  │ JP        │ 52.45  │ +1.5%     │ 1631      │ 2026-01-07 │ │
│   │                                                                       │ │
│   └──────────────────────────────────────────────────────────────────────┘ │
│            │                                                                 │
│            ├───────────────────────────────────────┐                        │
│            ▼                                       ▼                        │
│   ┌──────────────────┐                   ┌──────────────────┐              │
│   │    prism-app     │                   │    cardforum     │              │
│   │                  │                   │                  │              │
│   │ /api/index       │                   │ /api/price-index │              │
│   │ /api/tcg100      │                   │ Dashboard widgets│              │
│   │ Market health    │                   │ Market overview  │              │
│   └──────────────────┘                   └──────────────────┘              │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Schema Synchronization Protocol

### When Cardforum Updates Schema

```
1. Developer modifies cardforum/prisma/schema.prisma
2. Run: npx prisma migrate dev --name <migration_name>
3. Migration applied to shared RDS
4. Notify PRISM team

PRISM Response:
1. Pull latest schema changes (if applicable)
2. Update prism-app/prisma/schema.prisma (subset)
3. Run: npx prisma generate
4. Redeploy prism-app
```

### Schema Alignment Checklist

| Table | Cardforum | PRISM | Lambda | Notes |
|-------|-----------|-------|--------|-------|
| card_prices_v2 | Define, Read | Define, Read | Write | Lambda is source of truth |
| card_price_history | Define, Read | Define, Read/Write | - | PRISM creates snapshots |
| price_index_snapshots | Define, Read | Define, Read/Write | - | PRISM creates indices |
| trade_in_submissions | Define, R/W | - | - | Cardforum only |
| exchange_rate_history | Define, Read | Define, Read | - | Both read for FX |

---

## API Endpoint Mapping

### Equivalent Endpoints

| Function | Cardforum | PRISM |
|----------|-----------|-------|
| Card search | `/api/cards/lookup` | `/api/cards` |
| Card detail | `/api/cards/lookup?id=X` | `/api/cards/[cardId]` |
| Price history | `/api/price-index.card.$id.history` | `/api/history/[cardId]` |
| All indices | `/api/price-index` | `/api/index` |
| TCG-100 | `/api/price-index.tcg100` | `/api/tcg100` |
| Top movers | `/api/price-index.movers` | `/api/movers` |
| Crystal viz | `/api/price-index.crystal` | `/api/crystal` |

### Unique Endpoints

**Cardforum Only:**
- `/api/submissions/*` - Trade-in management
- `/api/shipping/*` - Royal Mail integration
- `/api/my-submissions/*` - Customer portal
- `/api/admin.jp-prices.*` - Japanese price management

**PRISM Only:**
- `/api/admin/backfill-history` - Historical data management
- `/api/health` - System health check

---

## Failure Mode Analysis

### Scenario 1: Lambda Fails to Update Prices

```
IMPACT:
├── card_prices_v2 contains stale data (> 12 hours)
├── cardforum: Trade-in quotes use old prices (BUSINESS RISK)
├── prism-app: Indices show no change (ACCURACY RISK)
└── Both apps: sync-prices cron logs warning

DETECTION:
├── prism-app: /api/cron/sync-prices returns isStale: true
├── cardforum: Price freshness warning in API responses
└── Monitoring: Alert on staleness threshold

MITIGATION:
├── No automatic recovery (Lambda must be fixed)
├── Manual: Contact Lambda team
└── Workaround: None for live prices
```

### Scenario 2: PRISM Cron Fails

```
IMPACT:
├── card_price_history gap for that day
├── price_index_snapshots not created
├── cardforum: Historical charts missing data point
├── prism-app: Movers/indices return cached or empty

DETECTION:
├── Vercel cron logs show error
├── GET /api/admin/backfill-history shows gap
└── Monitoring: Alert on cron failure

MITIGATION:
├── Use backfill endpoint to restore
├── POST /api/admin/backfill-history { startDate, endDate, source: "current" }
└── Data quality: Backfilled data marked sourceUsed: "backfill"
```

### Scenario 3: Database Connection Issues

```
IMPACT:
├── Both apps return 500 errors
├── Trade-ins cannot be processed
├── Indices cannot be calculated

DETECTION:
├── prism-app: /api/health returns connected: false
├── cardforum: API errors across all endpoints
└── Monitoring: Database health alerts

MITIGATION:
├── Prisma retry logic (3 attempts, exponential backoff)
├── Connection pool management (5 connections per instance)
└── Escalation: AWS RDS monitoring
```

---

## Development Coordination

### Shared Type Definitions

Consider creating a shared npm package for types used by both projects:

```typescript
// @tcg-tradein/types

export interface CardPrice {
  cardId: string;
  name: string;
  game: string;
  setCode: string | null;
  bestPriceGbp: number | null;
  tradeinPriceGbp: number | null;
  lastUpdated: Date;
}

export interface PriceHistoryPoint {
  date: string;
  priceGbp: number;
  priceJpy: number | null;
  change: number;
}

export interface IndexSnapshot {
  type: 'GAME' | 'SET' | 'RARITY' | 'TOP_100' | 'LANGUAGE';
  key: string;
  value: number;
  change24h: number;
  cardCount: number;
}
```

### Communication Channels

| Event | From | To | Mechanism |
|-------|------|-----|-----------|
| Schema change | Cardforum | PRISM | GitHub PR + Slack |
| Price update | Lambda | Cardforum | SNS webhook |
| Index ready | PRISM | Cardforum | Shared DB (poll) |
| Cron failure | Either | Ops | Vercel/monitoring alert |

---

## Future Integration Opportunities

### 1. Unified Cache Layer

Both apps use in-memory LRU caching. Consider shared Redis:

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  cardforum  │     │   Upstash   │     │  prism-app  │
│             │────►│   Redis     │◄────│             │
│             │     │   (shared)  │     │             │
└─────────────┘     └─────────────┘     └─────────────┘

Benefits:
- Cache invalidation propagates instantly
- Reduced database load
- Consistent cache state
```

### 2. Event-Driven Architecture

Replace polling with events:

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Lambda    │────►│   AWS SNS   │────►│  prism-app  │
│  (prices)   │     │   Topic     │     │  webhook    │
└─────────────┘     └─────────────┘     └─────────────┘
                           │
                           ▼
                    ┌─────────────┐
                    │  cardforum  │
                    │  webhook    │
                    └─────────────┘

Benefits:
- Real-time updates
- No cron timing issues
- Guaranteed delivery
```

### 3. Shared Observability

Unified logging and metrics:

```yaml
# datadog.yaml
services:
  - name: cardforum
    env: production
    tags: [tcg-tradein, shopify-app]

  - name: prism-app
    env: production
    tags: [tcg-tradein, price-index]

  - name: trading-card-pricer
    env: production
    tags: [tcg-tradein, lambda]

dashboards:
  - tcg-tradein-ecosystem:
      widgets:
        - price-freshness
        - index-calculation-time
        - trade-in-volume
        - api-latency
```

---

## Quick Reference

### Project Locations
```
/Users/alex/TCG_TradeIn/
├── cardforum/          # Shopify trade-in app
├── prism-app/          # Price index application
└── (external)          # trading-card-pricer Lambda
```

### Key Files
```
cardforum:
├── prisma/schema.prisma          # Master schema
├── app/lib/pricing.server.ts     # Trade-in pricing
├── app/lib/s3-prices.server.ts   # S3 price sync
└── app/routes/api.*.tsx          # API routes

prism-app:
├── prisma/schema.prisma          # Subset schema
├── src/lib/price-index.ts        # Index calculations
├── src/lib/cards.ts              # Card queries
└── src/app/api/cron/*.ts         # Scheduled jobs
```

### Database Connection
```
Host: cardforum.cn4c2su0o42n.us-east-1.rds.amazonaws.com
Port: 5432
Database: cardforum
```

---

**Synapse Status:** Active
**Last Updated:** 2026-01-07
**Maintainers:** PRISM Team, Cardforum Team
