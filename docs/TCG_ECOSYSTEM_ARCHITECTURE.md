# TCG Trade-In Ecosystem - Unified Architecture

**Date:** 2026-01-07
**Type:** System Architecture Documentation
**Scope:** Complete ecosystem including cardforum, prism-app, and external services

---

## Neural Network Architecture View

```
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃                    TCG TRADE-IN ECOSYSTEM NEURAL NETWORK                     ┃
┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┫
┃                                                                              ┃
┃   ╔═══════════════════════════════════════════════════════════════════════╗ ┃
┃   ║                         INPUT LAYER (DENDRITES)                       ║ ┃
┃   ║                         External Data Sources                         ║ ┃
┃   ╠═══════════════════════════════════════════════════════════════════════╣ ┃
┃   ║                                                                       ║ ┃
┃   ║   ┌─────────────┐   ┌─────────────┐   ┌─────────────┐                ║ ┃
┃   ║   │  TCGplayer  │   │  CardMarket │   │   JustTCG   │                ║ ┃
┃   ║   │    (US)     │   │    (EU)     │   │    (UK)     │                ║ ┃
┃   ║   │   USD/GBP   │   │   EUR/GBP   │   │   USD/GBP   │                ║ ┃
┃   ║   └──────┬──────┘   └──────┬──────┘   └──────┬──────┘                ║ ┃
┃   ║          │                 │                 │                        ║ ┃
┃   ║          └─────────────────┴─────────────────┘                        ║ ┃
┃   ║                            │                                          ║ ┃
┃   ╚════════════════════════════╪══════════════════════════════════════════╝ ┃
┃                                ▼                                             ┃
┃   ╔═══════════════════════════════════════════════════════════════════════╗ ┃
┃   ║                      AGGREGATION LAYER (SOMA)                         ║ ┃
┃   ║                      trading-card-pricer Lambda                       ║ ┃
┃   ╠═══════════════════════════════════════════════════════════════════════╣ ┃
┃   ║                                                                       ║ ┃
┃   ║   ┌─────────────────────────────────────────────────────────────┐    ║ ┃
┃   ║   │                    AWS Lambda (us-east-1)                    │    ║ ┃
┃   ║   │                                                              │    ║ ┃
┃   ║   │   Inputs:          Transformations:        Outputs:          │    ║ ┃
┃   ║   │   ────────         ────────────────        ────────          │    ║ ┃
┃   ║   │   USD prices  ───► USD→GBP convert    ───► RDS writes        │    ║ ┃
┃   ║   │   EUR prices  ───► EUR→GBP convert    ───► S3 price feed     │    ║ ┃
┃   ║   │   GBP prices  ───► Best price calc    ───► SNS notification  │    ║ ┃
┃   ║   │                    Tradein (70%)                              │    ║ ┃
┃   ║   │                                                              │    ║ ┃
┃   ║   │   Schedule: 08:00 UTC, 20:00 UTC (2x daily)                  │    ║ ┃
┃   ║   │                                                              │    ║ ┃
┃   ║   └─────────────────────────────────────────────────────────────┘    ║ ┃
┃   ║                                                                       ║ ┃
┃   ╚════════════════════════════╪══════════════════════════════════════════╝ ┃
┃                                │                                             ┃
┃              ┌─────────────────┼─────────────────┐                          ┃
┃              ▼                 ▼                 ▼                          ┃
┃   ╔═══════════════════════════════════════════════════════════════════════╗ ┃
┃   ║                      STORAGE LAYER (NUCLEUS)                          ║ ┃
┃   ║                      AWS RDS PostgreSQL                               ║ ┃
┃   ╠═══════════════════════════════════════════════════════════════════════╣ ┃
┃   ║                                                                       ║ ┃
┃   ║   Host: cardforum.cn4c2su0o42n.us-east-1.rds.amazonaws.com           ║ ┃
┃   ║   Database: cardforum                                                 ║ ┃
┃   ║                                                                       ║ ┃
┃   ║   ┌─────────────────────────────────────────────────────────────┐    ║ ┃
┃   ║   │  LIVE DATA                      HISTORICAL DATA             │    ║ ┃
┃   ║   │  ─────────                      ───────────────             │    ║ ┃
┃   ║   │                                                              │    ║ ┃
┃   ║   │  card_prices_v2 ◄──────────────► card_price_history         │    ║ ┃
┃   ║   │  (Lambda writes)                 (PRISM writes)              │    ║ ┃
┃   ║   │  ~5000 cards                     ~150k snapshots             │    ║ ┃
┃   ║   │                                                              │    ║ ┃
┃   ║   │  Fields:                         Fields:                     │    ║ ┃
┃   ║   │  - optcg_tcgplayer_gbp          - price_gbp                 │    ║ ┃
┃   ║   │  - limitless_cardmarket_gbp      - price_jpy                │    ║ ┃
┃   ║   │  - justtcg_tcgplayer_gbp         - change (%)               │    ║ ┃
┃   ║   │  - best_price_gbp                - snapshot_date            │    ║ ┃
┃   ║   │  - tradein_price_gbp             - source_used              │    ║ ┃
┃   ║   │                                                              │    ║ ┃
┃   ║   └─────────────────────────────────────────────────────────────┘    ║ ┃
┃   ║                                                                       ║ ┃
┃   ║   ┌─────────────────────────────────────────────────────────────┐    ║ ┃
┃   ║   │  INDEX DATA                     ANALYTICS DATA              │    ║ ┃
┃   ║   │  ──────────                     ──────────────              │    ║ ┃
┃   ║   │                                                              │    ║ ┃
┃   ║   │  price_index_snapshots          price_correlations          │    ║ ┃
┃   ║   │  (PRISM writes)                 (PRISM writes)              │    ║ ┃
┃   ║   │                                                              │    ║ ┃
┃   ║   │  - GAME indices                 - Pearson coefficients      │    ║ ┃
┃   ║   │  - SET indices                  - Card-to-card relations    │    ║ ┃
┃   ║   │  - TOP_100 index                - Crystal visualization     │    ║ ┃
┃   ║   │  - LANGUAGE indices                                         │    ║ ┃
┃   ║   │                                                              │    ║ ┃
┃   ║   └─────────────────────────────────────────────────────────────┘    ║ ┃
┃   ║                                                                       ║ ┃
┃   ║   ┌─────────────────────────────────────────────────────────────┐    ║ ┃
┃   ║   │  BUSINESS DATA (cardforum only)                              │    ║ ┃
┃   ║   │  ──────────────────────────────                              │    ║ ┃
┃   ║   │                                                              │    ║ ┃
┃   ║   │  trade_in_submissions  →  trade_in_items                    │    ║ ┃
┃   ║   │         ↓                       ↓                            │    ║ ┃
┃   ║   │     customers         →     payouts                         │    ║ ┃
┃   ║   │                                                              │    ║ ┃
┃   ║   └─────────────────────────────────────────────────────────────┘    ║ ┃
┃   ║                                                                       ║ ┃
┃   ╚════════════════════════════╪══════════════════════════════════════════╝ ┃
┃                                │                                             ┃
┃              ┌─────────────────┴─────────────────┐                          ┃
┃              ▼                                   ▼                          ┃
┃   ╔═══════════════════════════════════════════════════════════════════════╗ ┃
┃   ║                      PROCESSING LAYER (AXONS)                         ║ ┃
┃   ║                      Application Servers                              ║ ┃
┃   ╠═══════════════════════════════════════════════════════════════════════╣ ┃
┃   ║                                                                       ║ ┃
┃   ║   ┌───────────────────────────┐   ┌───────────────────────────┐      ║ ┃
┃   ║   │        CARDFORUM          │   │        PRISM-APP          │      ║ ┃
┃   ║   │     (Shopify App)         │   │     (Price Index)         │      ║ ┃
┃   ║   ├───────────────────────────┤   ├───────────────────────────┤      ║ ┃
┃   ║   │                           │   │                           │      ║ ┃
┃   ║   │  Framework:               │   │  Framework:               │      ║ ┃
┃   ║   │  React Router 7.x         │   │  Next.js 14               │      ║ ┃
┃   ║   │                           │   │                           │      ║ ┃
┃   ║   │  Purpose:                 │   │  Purpose:                 │      ║ ┃
┃   ║   │  - Trade-in submissions   │   │  - Price indices          │      ║ ┃
┃   ║   │  - Customer management    │   │  - Market analytics       │      ║ ┃
┃   ║   │  - Shopify integration    │   │  - Historical snapshots   │      ║ ┃
┃   ║   │  - Shipping labels        │   │  - Correlation viz        │      ║ ┃
┃   ║   │                           │   │                           │      ║ ┃
┃   ║   │  DB Operations:           │   │  DB Operations:           │      ║ ┃
┃   ║   │  - Read card_prices_v2    │   │  - Read card_prices_v2    │      ║ ┃
┃   ║   │  - Read/Write trade-ins   │   │  - Write price_history    │      ║ ┃
┃   ║   │  - Read indices           │   │  - Write indices          │      ║ ┃
┃   ║   │                           │   │                           │      ║ ┃
┃   ║   │  Host: Vercel             │   │  Host: Vercel             │      ║ ┃
┃   ║   │                           │   │                           │      ║ ┃
┃   ║   └───────────────────────────┘   └───────────────────────────┘      ║ ┃
┃   ║                                                                       ║ ┃
┃   ╚════════════════════════════╪══════════════════════════════════════════╝ ┃
┃                                │                                             ┃
┃              ┌─────────────────┴─────────────────┐                          ┃
┃              ▼                                   ▼                          ┃
┃   ╔═══════════════════════════════════════════════════════════════════════╗ ┃
┃   ║                      OUTPUT LAYER (SYNAPSES)                          ║ ┃
┃   ║                      Consumer Interfaces                              ║ ┃
┃   ╠═══════════════════════════════════════════════════════════════════════╣ ┃
┃   ║                                                                       ║ ┃
┃   ║   ┌─────────────┐   ┌─────────────┐   ┌─────────────┐                ║ ┃
┃   ║   │  Shopify    │   │   PRISM     │   │   Mobile    │                ║ ┃
┃   ║   │  Storefront │   │  Dashboard  │   │    App      │                ║ ┃
┃   ║   │             │   │             │   │  (Future)   │                ║ ┃
┃   ║   │ - Trade-in  │   │ - Indices   │   │             │                ║ ┃
┃   ║   │   widget    │   │ - Charts    │   │ - Alerts    │                ║ ┃
┃   ║   │ - Price     │   │ - Movers    │   │ - Tracking  │                ║ ┃
┃   ║   │   display   │   │ - Crystal   │   │             │                ║ ┃
┃   ║   │             │   │   network   │   │             │                ║ ┃
┃   ║   └─────────────┘   └─────────────┘   └─────────────┘                ║ ┃
┃   ║                                                                       ║ ┃
┃   ╚═══════════════════════════════════════════════════════════════════════╝ ┃
┃                                                                              ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛
```

---

## Data Flow Timeline

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        DAILY SIGNAL PROPAGATION                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   TIME (UTC)    SYSTEM              ACTION                                   │
│   ──────────    ──────              ──────                                   │
│                                                                              │
│   08:00         Lambda              Fetch external prices                    │
│      │          ─────►              Convert currencies                       │
│      │                              Write to card_prices_v2                  │
│      │                              Upload daily_prices.xlsx to S3           │
│      │                              Send SNS notification                    │
│      ▼                                                                       │
│   08:00         cardforum           Receive webhook                          │
│      │          ─────►              Sync prices from external                │
│      │                              Invalidate caches                        │
│      ▼                                                                       │
│   08:00         prism-app           /cron/sync-prices                        │
│      │          ─────►              Health check                             │
│      │                              Staleness detection                      │
│      ▼                                                                       │
│   08:15         prism-app           /cron/calculate-tcg100                   │
│      │          ─────►              Calculate GAME_onepiece index            │
│      │                              Calculate TOP_100 index                  │
│      │                              Calculate LANG_EN, LANG_JP               │
│      │                              Write price_index_snapshots              │
│      ▼                                                                       │
│   08:30         prism-app           /cron/calculate-movers                   │
│      │          ─────►              Snapshot current prices                  │
│      │                              Calculate % changes                      │
│      │                              Write card_price_history                 │
│      ▼                                                                       │
│   09:00+        CONSUMERS           Data available for queries               │
│                 ────────            - Trade-in pricing uses fresh data       │
│                                     - Index APIs return current values       │
│                                     - History APIs include today's point     │
│                                                                              │
│   ─────────────────────────────────────────────────────────────────────────  │
│                                                                              │
│   20:00         [REPEAT]            Same cycle as 08:00                      │
│   20:00                                                                      │
│   20:15                                                                      │
│   20:30                                                                      │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Component Dependency Graph

```
                              ┌─────────────────┐
                              │  External APIs  │
                              │  (TCGplayer,    │
                              │   CardMarket,   │
                              │   JustTCG)      │
                              └────────┬────────┘
                                       │
                                       ▼
                              ┌─────────────────┐
                              │     Lambda      │
                              │  (Aggregator)   │
                              └────────┬────────┘
                                       │
                    ┌──────────────────┼──────────────────┐
                    │                  │                  │
                    ▼                  ▼                  ▼
           ┌───────────────┐  ┌───────────────┐  ┌───────────────┐
           │      S3       │  │     SNS       │  │      RDS      │
           │  (Pricefeed)  │  │   (Events)    │  │  (Database)   │
           └───────┬───────┘  └───────┬───────┘  └───────┬───────┘
                   │                  │                  │
                   │                  ▼                  │
                   │         ┌───────────────┐          │
                   │         │   cardforum   │◄─────────┤
                   │         │   (Webhook)   │          │
                   │         └───────────────┘          │
                   │                                    │
                   │         ┌───────────────┐          │
                   └────────►│   cardforum   │◄─────────┤
                             │   (S3 Sync)   │          │
                             └───────────────┘          │
                                                        │
                             ┌───────────────┐          │
                             │   prism-app   │◄─────────┘
                             │   (Cron)      │
                             └───────┬───────┘
                                     │
                                     ▼
                             ┌───────────────┐
                             │      RDS      │
                             │  (History +   │
                             │   Indices)    │
                             └───────────────┘
```

---

## API Endpoint Matrix

### Price Data Endpoints

| Endpoint | Cardforum | PRISM | Data Source |
|----------|-----------|-------|-------------|
| Card search | `/api/cards/lookup` | `/api/cards` | card_prices_v2 |
| Card detail | `?id=X` | `/api/cards/[id]` | card_prices_v2 |
| Price history | `/api/price-index.card.$id.history` | `/api/history/[id]` | card_price_history |
| All indices | `/api/price-index` | `/api/index` | price_index_snapshots |
| TCG-100 | `/api/price-index.tcg100` | `/api/tcg100` | price_index_snapshots |
| Top movers | `/api/price-index.movers` | `/api/movers` | card_price_history |
| Crystal viz | `/api/price-index.crystal` | `/api/crystal` | price_correlations |

### Unique Endpoints

**Cardforum Only:**
- `POST /api/submissions` - Create trade-in
- `GET /api/my-submissions` - Customer submissions
- `POST /api/shipping.*` - Royal Mail integration

**PRISM Only:**
- `POST /api/admin/backfill-history` - Data recovery
- `GET /api/health` - System status

---

## Error Propagation Paths

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         ERROR PROPAGATION NETWORK                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   ERROR TYPE              ORIGIN          AFFECTED              RECOVERY     │
│   ──────────              ──────          ────────              ────────     │
│                                                                              │
│   ┌─────────────┐                                                           │
│   │ Lambda Fail │ ───────► Stale card_prices_v2                             │
│   └─────────────┘          │                                                │
│                            ├──► cardforum: Wrong trade-in quotes            │
│                            ├──► prism-app: No index change                  │
│                            └──► Recovery: Wait for Lambda fix               │
│                                                                              │
│   ┌─────────────┐                                                           │
│   │ RDS Outage  │ ───────► All queries fail                                 │
│   └─────────────┘          │                                                │
│                            ├──► cardforum: 500 errors                       │
│                            ├──► prism-app: 500 errors                       │
│                            └──► Recovery: RDS auto-recovery / failover      │
│                                                                              │
│   ┌─────────────┐                                                           │
│   │ PRISM Cron  │ ───────► History gap for date                             │
│   │    Fail     │          │                                                │
│   └─────────────┘          ├──► prism-app: Missing movers/indices           │
│                            ├──► cardforum: Missing chart points             │
│                            └──► Recovery: /api/admin/backfill-history       │
│                                                                              │
│   ┌─────────────┐                                                           │
│   │ Cache Stale │ ───────► Stale API responses                              │
│   └─────────────┘          │                                                │
│                            ├──► prism-app: Old data served (max 5 min)      │
│                            ├──► cardforum: Old data served (max 5 min)      │
│                            └──► Recovery: Automatic TTL expiry              │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Security Boundaries

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           SECURITY ARCHITECTURE                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                        PUBLIC INTERNET                               │   │
│   │                                                                      │   │
│   │   Browser ──► Shopify App Proxy ──► cardforum (HMAC verified)       │   │
│   │   Browser ──► PRISM APIs (public read-only)                          │   │
│   │                                                                      │   │
│   └───────────────────────────────┬─────────────────────────────────────┘   │
│                                   │                                          │
│   ┌───────────────────────────────┼─────────────────────────────────────┐   │
│   │                        AUTHENTICATED ZONE                            │   │
│   │                                                                      │   │
│   │   Vercel Cron ──► CRON_SECRET header ──► Cron endpoints             │   │
│   │   Admin UI ──► ADMIN_SECRET header ──► Admin endpoints               │   │
│   │   Shopify ──► Session OAuth ──► Admin routes                         │   │
│   │                                                                      │   │
│   └───────────────────────────────┬─────────────────────────────────────┘   │
│                                   │                                          │
│   ┌───────────────────────────────┼─────────────────────────────────────┐   │
│   │                        INFRASTRUCTURE ZONE                           │   │
│   │                                                                      │   │
│   │   Lambda ──► IAM Role ──► RDS (write)                                │   │
│   │   Lambda ──► IAM Role ──► S3 (write)                                 │   │
│   │   Lambda ──► IAM Role ──► SNS (publish)                              │   │
│   │                                                                      │   │
│   │   Vercel Apps ──► DATABASE_URL ──► RDS (read/write as configured)   │   │
│   │   Vercel Apps ──► AWS SDK ──► S3 (read)                              │   │
│   │                                                                      │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Deployment Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         DEPLOYMENT TOPOLOGY                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   ┌─────────────────────┐                                                   │
│   │   GitHub Repos      │                                                   │
│   │                     │                                                   │
│   │ TCG_TradeIn/        │                                                   │
│   │ ├── cardforum/      │──────────────┐                                   │
│   │ └── prism-app/      │──────────┐   │                                   │
│   │                     │          │   │                                   │
│   └─────────────────────┘          │   │                                   │
│                                    │   │                                   │
│                    ┌───────────────┘   └───────────────┐                   │
│                    ▼                                   ▼                   │
│   ┌───────────────────────────┐       ┌───────────────────────────┐       │
│   │      Vercel Project       │       │      Vercel Project       │       │
│   │        prism-app          │       │        cardforum          │       │
│   │                           │       │                           │       │
│   │  Region: lhr1 (London)    │       │  Region: lhr1 (London)    │       │
│   │  Framework: Next.js       │       │  Framework: React Router  │       │
│   │  Node: 20.x               │       │  Node: 20.x               │       │
│   │                           │       │                           │       │
│   │  Cron Jobs:               │       │  Cron Jobs:               │       │
│   │  - sync-prices (8:00)     │       │  - price-sync (daily)     │       │
│   │  - calculate-tcg100       │       │  - pricefeed-sync         │       │
│   │  - calculate-movers       │       │  - price-snapshot         │       │
│   │                           │       │  - correlation-calc       │       │
│   │                           │       │  - jp-price-sync          │       │
│   │                           │       │  - cleanup                │       │
│   └─────────────┬─────────────┘       └─────────────┬─────────────┘       │
│                 │                                   │                       │
│                 └─────────────┬─────────────────────┘                       │
│                               │                                             │
│                               ▼                                             │
│   ┌───────────────────────────────────────────────────────────────────┐    │
│   │                    AWS (us-east-1)                                 │    │
│   │                                                                    │    │
│   │   ┌─────────────┐   ┌─────────────┐   ┌─────────────┐            │    │
│   │   │     RDS     │   │      S3     │   │    Lambda   │            │    │
│   │   │  PostgreSQL │   │  Pricefeed  │   │   Pricer    │            │    │
│   │   │             │   │             │   │             │            │    │
│   │   │ cardforum   │   │ pricedata-  │   │ trading-    │            │    │
│   │   │ database    │   │ tcg bucket  │   │ card-pricer │            │    │
│   │   └─────────────┘   └─────────────┘   └─────────────┘            │    │
│   │                                                                    │    │
│   └───────────────────────────────────────────────────────────────────┘    │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Quick Reference Card

### Project Locations
```
/Users/alex/TCG_TradeIn/
├── cardforum/           # Shopify trade-in app
│   ├── app/             # React Router routes
│   ├── prisma/          # Master schema
│   └── docs/            # Documentation
│
└── prism-app/           # Price index app
    ├── src/             # Next.js source
    ├── prisma/          # Subset schema
    └── docs/            # Documentation
```

### Database
```
Host: cardforum.cn4c2su0o42n.us-east-1.rds.amazonaws.com:5432
Database: cardforum
Schema Owner: cardforum (Prisma migrations)
```

### Cron Schedule (UTC)
```
08:00  Lambda: Fetch & aggregate prices
08:00  prism-app: Health check
08:15  prism-app: Calculate indices
08:30  prism-app: Create history snapshots
20:00  [Repeat cycle]
```

### Key Documentation
```
SYNAPSE_CARDFORUM_PRISM.md      # Cross-project relationships
NEURAL_NETWORK_PRICE_PIPELINE_ANALYSIS.md  # PRISM analysis
ISSUE_RESOLUTION_PLAN.md        # Fix implementation plan
TCG_ECOSYSTEM_ARCHITECTURE.md   # This document
```

---

**Architecture Status:** Current
**Last Updated:** 2026-01-07
**Version:** 1.0
