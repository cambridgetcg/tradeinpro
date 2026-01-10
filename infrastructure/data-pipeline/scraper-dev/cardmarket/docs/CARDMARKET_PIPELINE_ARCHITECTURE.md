# CardMarket Data Pipeline - Architecture & Engineering Guide

> **Version**: 1.0.0
> **Last Updated**: 2026-01-09
> **Status**: Development (Phase 3 - Scaling)

---

## Executive Summary

This document provides comprehensive architectural documentation for the CardMarket price scraping pipeline. Unlike the eBay pipeline (which uses SerpAPI), this pipeline directly scrapes CardMarket's website using a sophisticated multi-layered approach combining HTTP requests, browser automation, and resilience patterns to handle CardMarket's aggressive anti-bot protections.

**Key Differences from eBay Pipeline:**
| Aspect | eBay Pipeline | CardMarket Pipeline |
|--------|--------------|---------------------|
| Data Source | SerpAPI (API wrapper) | Direct web scraping |
| Rate Limiting | 2s delay, API quota | 3-5s delay, IP-based blocking |
| Anti-Bot | None (API) | CAPTCHA, TLS fingerprint, PoW |
| Currency | Multi-currency (USD, GBP, EUR) | EUR only (converted to GBP) |
| Proxy Required | No | Yes (residential only) |
| Browser Required | No | Yes (fallback for JS pages) |

---

## 1. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                        CARDMARKET DATA COLLECTION PIPELINE                               │
│                        One Piece TCG Price Data                                          │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                          │
│   ┌──────────────┐                                                                      │
│   │    CLI       │  npx tsx src/cli/runner.ts scrape                                    │
│   │   Runner     │  --sets=OP01,OP02 --mode=full --dry-run                              │
│   └──────┬───────┘                                                                      │
│          │                                                                              │
│          ▼                                                                              │
│   ┌──────────────────────────────────────────────────────────────────────────────────┐ │
│   │                          ORCHESTRATION LAYER                                      │ │
│   │                                                                                   │ │
│   │  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐       │ │
│   │  │  Pipeline   │    │   Circuit   │    │   Session   │    │  Selector   │       │ │
│   │  │Orchestrator │───▶│  Breaker    │───▶│  Manager    │───▶│  Monitor    │       │ │
│   │  │             │    │(5 failures) │    │(BWSTATE)    │    │(health)     │       │ │
│   │  └─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘       │ │
│   │                                                                                   │ │
│   │  AWS SERVICES:                                                                    │ │
│   │  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐                          │ │
│   │  │    SQS      │    │    Step     │    │  CloudWatch │                          │ │
│   │  │   Queue     │    │  Functions  │    │   Metrics   │                          │ │
│   │  │(job dist.)  │    │(orchestrate)│    │(observ.)    │                          │ │
│   │  └─────────────┘    └─────────────┘    └─────────────┘                          │ │
│   └──────────────────────────────────────────────────────────────────────────────────┘ │
│          │                                                                              │
│          ▼                                                                              │
│   ┌──────────────────────────────────────────────────────────────────────────────────┐ │
│   │                          REQUEST LAYER (Anti-Detection)                           │ │
│   │                                                                                   │ │
│   │   ┌─────────────────────────────────────────────────────────────────────────────┐│ │
│   │   │                      HYBRID SCRAPER                                          ││ │
│   │   │                                                                              ││ │
│   │   │   Primary Path:          Fallback Path:                                      ││ │
│   │   │   ┌─────────────┐        ┌─────────────────┐                                ││ │
│   │   │   │ HTTP Client │──403──▶│ Playwright      │                                ││ │
│   │   │   │ (axios/got) │  429   │ Browser         │                                ││ │
│   │   │   │             │ CAPTCHA│ (headless)      │                                ││ │
│   │   │   └──────┬──────┘        └────────┬────────┘                                ││ │
│   │   │          │                        │                                          ││ │
│   │   │          └────────────┬───────────┘                                          ││ │
│   │   │                       │                                                      ││ │
│   │   │                       ▼                                                      ││ │
│   │   │   ┌─────────────────────────────────────────────────────────────────────┐   ││ │
│   │   │   │                    PROXY ROTATION                                    │   ││ │
│   │   │   │                                                                      │   ││ │
│   │   │   │   ┌──────────┐    ┌──────────┐    ┌──────────┐                      │   ││ │
│   │   │   │   │  Bright  │    │  Smart   │    │  Oxylabs │                      │   ││ │
│   │   │   │   │   Data   │    │  Proxy   │    │          │                      │   ││ │
│   │   │   │   │  (EU)    │    │  (EU)    │    │  (EU)    │                      │   ││ │
│   │   │   │   └──────────┘    └──────────┘    └──────────┘                      │   ││ │
│   │   │   │                                                                      │   ││ │
│   │   │   │   Session: rotating | Country: de,fr,es,it,nl,be,at                 │   ││ │
│   │   │   └─────────────────────────────────────────────────────────────────────┘   ││ │
│   │   │                                                                              ││ │
│   │   │   ┌─────────────────────────────────────────────────────────────────────┐   ││ │
│   │   │   │                    FINGERPRINT RANDOMIZATION                         │   ││ │
│   │   │   │                                                                      │   ││ │
│   │   │   │   User-Agent: Chrome/120 (Win/Mac/Linux rotation)                   │   ││ │
│   │   │   │   Viewport:   1920x1080 | 2560x1440 | 1366x768                       │   ││ │
│   │   │   │   Locale:     de-DE | en-GB | fr-FR                                  │   ││ │
│   │   │   │   Timezone:   Europe/Berlin | Europe/London                          │   ││ │
│   │   │   │   WebGL:      Randomized vendor/renderer                             │   ││ │
│   │   │   └─────────────────────────────────────────────────────────────────────┘   ││ │
│   │   └─────────────────────────────────────────────────────────────────────────────┘│ │
│   └──────────────────────────────────────────────────────────────────────────────────┘ │
│          │                                                                              │
│          ▼                                                                              │
│   ┌──────────────────────────────────────────────────────────────────────────────────┐ │
│   │                           PARSING LAYER                                           │ │
│   │                                                                                   │ │
│   │   ┌─────────────────────────────────────────────────────────────────────────────┐│ │
│   │   │                    MULTI-STRATEGY HTML PARSER (Cheerio)                      ││ │
│   │   │                                                                              ││ │
│   │   │   Strategy 1: Primary CSS Selectors                                          ││ │
│   │   │   ├─ .table-body .row                                                        ││ │
│   │   │   ├─ .col-price .font-weight-bold                                           ││ │
│   │   │   └─ .info-list-container dt/dd                                             ││ │
│   │   │              │                                                               ││ │
│   │   │              ▼ (if fails)                                                    ││ │
│   │   │   Strategy 2: Fallback CSS Selectors                                         ││ │
│   │   │   ├─ div[class*="row"]                                                       ││ │
│   │   │   ├─ span:contains("€")                                                      ││ │
│   │   │   └─ [data-price], [itemprop="price"]                                       ││ │
│   │   │              │                                                               ││ │
│   │   │              ▼ (if fails)                                                    ││ │
│   │   │   Strategy 3: Regex Extraction                                               ││ │
│   │   │   ├─ /(\d+[,.]?\d*)\s*€/                                                    ││ │
│   │   │   └─ /card-number[:\s]*([A-Z0-9-]+)/i                                       ││ │
│   │   │              │                                                               ││ │
│   │   │              ▼ (if fails)                                                    ││ │
│   │   │   Strategy 4: Heuristic Content Matching                                     ││ │
│   │   │   └─ Content-based pattern recognition                                       ││ │
│   │   │                                                                              ││ │
│   │   └─────────────────────────────────────────────────────────────────────────────┘│ │
│   │                                                                                   │ │
│   │   EXTRACTION TARGETS:                                                             │ │
│   │   ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐                  │ │
│   │   │ Expansion Page  │  │  Card Detail    │  │ Seller Articles │                  │ │
│   │   │ ─────────────── │  │ ─────────────── │  │ ─────────────── │                  │ │
│   │   │ • Product links │  │ • Card name/num │  │ • Seller name   │                  │ │
│   │   │ • Trend prices  │  │ • Image URL     │  │ • Condition     │                  │ │
│   │   │ • Low prices    │  │ • Trend price   │  │ • Language      │                  │ │
│   │   │ • Quantities    │  │ • 7d/30d avg    │  │ • Foil status   │                  │ │
│   │   │ • Pagination    │  │ • Price changes │  │ • Price/qty     │                  │ │
│   │   └─────────────────┘  └─────────────────┘  └─────────────────┘                  │ │
│   └──────────────────────────────────────────────────────────────────────────────────┘ │
│          │                                                                              │
│          ▼                                                                              │
│   ┌──────────────────────────────────────────────────────────────────────────────────┐ │
│   │                          TRANSFORMATION LAYER                                     │ │
│   │                                                                                   │ │
│   │   ScrapedCard                    TransformedCard                                  │ │
│   │   ┌──────────────────┐           ┌──────────────────────────────────┐            │ │
│   │   │ name             │           │ cardId (normalized)               │            │ │
│   │   │ priceEur         │  ──────▶  │ priceGbp (EUR × 0.85)            │            │ │
│   │   │ cardNumber       │ TRANSFORM │ tradeinPriceGbp (× 0.70)         │            │ │
│   │   │ imageUrl         │           │ validated: boolean                │            │ │
│   │   │ available        │           │ anomaly: boolean                  │            │ │
│   │   └──────────────────┘           │ pctChange7d/30d                   │            │ │
│   │                                  └──────────────────────────────────┘            │ │
│   │                                                                                   │ │
│   │   TRANSFORMATION STEPS:                                                           │ │
│   │   ┌─────────────────────────────────────────────────────────────────────────────┐│ │
│   │   │  1. Deduplication ──▶ 2. Validation ──▶ 3. EUR→GBP ──▶ 4. Anomaly Detection ││ │
│   │   │     (by cardId)      (price range)     (× 0.85)        (>50% change)         ││ │
│   │   └─────────────────────────────────────────────────────────────────────────────┘│ │
│   └──────────────────────────────────────────────────────────────────────────────────┘ │
│          │                                                                              │
│          ├──────────────────────────────────────────────────────────────┐              │
│          ▼                                                              ▼              │
│   ┌────────────────────────────────────┐    ┌────────────────────────────────────┐   │
│   │         S3 STORAGE                  │    │         RDS POSTGRESQL             │   │
│   │                                     │    │                                     │   │
│   │   s3://cardmarket-scraper-data/    │    │   card_prices_v2 (current)         │   │
│   │   │                                │    │   ┌─────────────────────────────┐  │   │
│   │   ├── scrapes/                     │    │   │ cardId (PK)                 │  │   │
│   │   │   └── year=2026/               │    │   │ limitless_cardmarket_eur    │  │   │
│   │   │       └── month=01/            │    │   │ limitless_cardmarket_gbp    │  │   │
│   │   │           └── day=09/          │    │   │ bestPriceGbp                │  │   │
│   │   │               └── set=OP01/    │    │   │ tradeinPriceGbp (×0.70)     │  │   │
│   │   │                   └── *.json.gz│    │   │ lastUpdated                 │  │   │
│   │   │                                │    │   └─────────────────────────────┘  │   │
│   │   ├── transformed/                 │    │                                     │   │
│   │   │   └── year/month/day/          │    │   price_history (historical)       │   │
│   │   │       └── prices_*.json.gz     │    │   ┌─────────────────────────────┐  │   │
│   │   │                                │    │   │ id (BIGSERIAL)              │  │   │
│   │   ├── training/                    │    │   │ cardId + priceDate (unique) │  │   │
│   │   │   └── exports/daily/*.parquet  │    │   │ tcgplayer_price_gbp         │  │   │
│   │   │                                │    │   │ cardmarket_price_gbp        │  │   │
│   │   └── debug/                       │    │   │ pct_change_1d/7d/30d        │  │   │
│   │       └── raw_html/{scrape_id}/    │    │   │ volatility_7d               │  │   │
│   │                                    │    │   │ source                      │  │   │
│   │   Features:                        │    │   └─────────────────────────────┘  │   │
│   │   • Hive-style partitioning        │    │                                     │   │
│   │   • GZIP compression (~10x)        │    │   Features:                         │   │
│   │   • Atomic writes + versioning     │    │   • Batch upserts (100/batch)       │   │
│   │   • Athena-compatible              │    │   • Transaction safety              │   │
│   │                                    │    │   • Auto trade-in calculation       │   │
│   └────────────────────────────────────┘    └────────────────────────────────────┘   │
│                                                                                          │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Data Flow Diagram

```
                                    CLI INPUT
                                        │
                                        ▼
┌───────────────────────────────────────────────────────────────────────────────────────┐
│                              SET CONFIGURATION                                         │
│                                                                                        │
│   sets.ts - ONEPIECE_SETS                                                             │
│   ┌───────────────────────────────────────────────────────────────────────────────┐  │
│   │  SET     CARDMARKET NAME              CARDS    RELEASE                        │  │
│   │  ───     ──────────────              ─────    ───────                        │  │
│   │  OP01    Romance-Dawn                 121      Jul 2022                       │  │
│   │  OP02    Paramount-War                121      Oct 2022                       │  │
│   │  OP03    Pillars-of-Strength          122      Jan 2023                       │  │
│   │  OP04    Kingdoms-of-Intrigue         121      Apr 2023                       │  │
│   │  OP05    Awakening-of-the-New-Era     121      Jul 2023                       │  │
│   │  OP06    Wings-of-the-Captain         138      Sep 2023                       │  │
│   │  OP07    500-Years-in-the-Future      136      Dec 2023                       │  │
│   │  OP08    Two-Legends                  138      Feb 2024                       │  │
│   │  OP09    The-Four-Emperors            139      May 2024                       │  │
│   │  OP10    Royal-Blood                  140      Aug 2024                       │  │
│   │  OP11    TBD                          140      Nov 2024                       │  │
│   │  EB01    Memorial-Collection          74       Feb 2024                       │  │
│   │  EB02    Memorial-Collection-EB02     74       Aug 2024                       │  │
│   │  ST01-20 Starter Decks                17-20    Various                        │  │
│   └───────────────────────────────────────────────────────────────────────────────┘  │
│                                        │                                              │
│                         generateSetUrl(set) ──▶ CardMarket URL                       │
│                                        │                                              │
│   URL Format: https://www.cardmarket.com/en/OnePiece/Products/Singles/              │
│               {Set-Name}?sortBy=price_desc&page={n}                                  │
│                                                                                        │
└───────────────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌───────────────────────────────────────────────────────────────────────────────────────┐
│                              HTTP REQUEST                                              │
│                                                                                        │
│   http-client.ts                                                                      │
│                                                                                        │
│   REQUEST CONFIGURATION:                                                              │
│   ┌───────────────────────────────────────────────────────────────────────────────┐  │
│   │  Base URL:    https://www.cardmarket.com                                      │  │
│   │  Method:      GET                                                             │  │
│   │  Timeout:     30,000ms                                                        │  │
│   │  Delay:       2,000-5,000ms (randomized)                                      │  │
│   │  Retries:     3 (exponential backoff)                                         │  │
│   │                                                                               │  │
│   │  Headers:                                                                     │  │
│   │  ┌─────────────────────────────────────────────────────────────────────────┐ │  │
│   │  │  User-Agent:      Chrome/120.0.0.0 Safari/537.36 (rotated)              │ │  │
│   │  │  Accept:          text/html,application/xhtml+xml,...                   │ │  │
│   │  │  Accept-Language: en-GB,en;q=0.9,de;q=0.8                               │ │  │
│   │  │  Accept-Encoding: gzip, deflate, br                                     │ │  │
│   │  │  Connection:      keep-alive                                            │ │  │
│   │  │  Cache-Control:   no-cache                                              │ │  │
│   │  │  Cookie:          BWSTATE={session}     ◄─── Critical for access        │ │  │
│   │  └─────────────────────────────────────────────────────────────────────────┘ │  │
│   │                                                                               │  │
│   │  Proxy:                                                                       │  │
│   │  ┌─────────────────────────────────────────────────────────────────────────┐ │  │
│   │  │  Provider:  Bright Data (residential)                                   │ │  │
│   │  │  Endpoint:  brd.superproxy.io:22225                                     │ │  │
│   │  │  Countries: de, fr, es, it, nl, be, at (EU rotation)                    │ │  │
│   │  │  Session:   rotating (new IP per request)                               │ │  │
│   │  │  Auth:      customer-{id}-country-{cc}-session-{uuid}:{password}        │ │  │
│   │  └─────────────────────────────────────────────────────────────────────────┘ │  │
│   └───────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                        │
│   RESPONSE HANDLING:                                                                  │
│   ┌───────────────────────────────────────────────────────────────────────────────┐  │
│   │  200 OK         ──▶  Parse HTML                                               │  │
│   │  403 Forbidden  ──▶  Switch to Playwright, rotate proxy                       │  │
│   │  429 Rate Limit ──▶  Exponential backoff, circuit breaker                     │  │
│   │  CAPTCHA        ──▶  Playwright fallback, 2Captcha solver                     │  │
│   │  5xx Error      ──▶  Retry with backoff                                       │  │
│   └───────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                        │
└───────────────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌───────────────────────────────────────────────────────────────────────────────────────┐
│                              HTML PARSING                                              │
│                                                                                        │
│   html-parser.ts (Cheerio-based)                                                      │
│                                                                                        │
│   EXPANSION PAGE STRUCTURE:                                                           │
│   ┌───────────────────────────────────────────────────────────────────────────────┐  │
│   │  <div class="table-body">                                                     │  │
│   │    <div class="row">                                                          │  │
│   │      <div class="col-product">                                                │  │
│   │        <a href="/en/OnePiece/.../OP01-120">OP01-120 Shanks SEC</a>           │  │
│   │      </div>                                                                   │  │
│   │      <div class="col-price">                                                  │  │
│   │        <span class="font-weight-bold">45,00 €</span>   ◄─── Trend price      │  │
│   │      </div>                                                                   │  │
│   │      <div class="col-availability">                                           │  │
│   │        <span>Available from 12,50 €</span>              ◄─── Low price        │  │
│   │      </div>                                                                   │  │
│   │    </div>                                                                     │  │
│   │    <!-- More rows... -->                                                      │  │
│   │  </div>                                                                       │  │
│   └───────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                        │
│   CARD DETAIL PAGE STRUCTURE:                                                         │
│   ┌───────────────────────────────────────────────────────────────────────────────┐  │
│   │  <div class="info-list-container">                                            │  │
│   │    <dl>                                                                       │  │
│   │      <dt>Price Trend</dt>                                                     │  │
│   │      <dd>45,00 €</dd>                                                         │  │
│   │                                                                               │  │
│   │      <dt>30-days average price</dt>                                           │  │
│   │      <dd>42,50 €</dd>                                                         │  │
│   │                                                                               │  │
│   │      <dt>7-days average price</dt>                                            │  │
│   │      <dd>46,20 €</dd>                                                         │  │
│   │                                                                               │  │
│   │      <dt>From</dt>                                                            │  │
│   │      <dd>12,50 €</dd>             ◄─── Lowest available price                 │  │
│   │                                                                               │  │
│   │      <dt>Available items</dt>                                                 │  │
│   │      <dd>127</dd>                                                             │  │
│   │    </dl>                                                                      │  │
│   │  </div>                                                                       │  │
│   │                                                                               │  │
│   │  <img class="card-image" src="..." />                                        │  │
│   └───────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                        │
│   PARSED OUTPUT (ScrapedCard):                                                        │
│   ┌───────────────────────────────────────────────────────────────────────────────┐  │
│   │  {                                                                            │  │
│   │    name: "OP01-120 Shanks",                                                   │  │
│   │    cardNumber: "OP01-120",                                                    │  │
│   │    setCode: "OP01",                                                           │  │
│   │    url: "https://www.cardmarket.com/en/OnePiece/.../OP01-120",               │  │
│   │    imageUrl: "https://static.cardmarket.com/.../OP01-120.jpg",               │  │
│   │    trendPrice: 45.00,                                                         │  │
│   │    lowPrice: 12.50,                                                           │  │
│   │    avg7Price: 46.20,                                                          │  │
│   │    avg30Price: 42.50,                                                         │  │
│   │    available: 127,                                                            │  │
│   │    currency: "EUR",                                                           │  │
│   │    scrapedAt: "2026-01-09T10:30:00.000Z"                                     │  │
│   │  }                                                                            │  │
│   └───────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                        │
└───────────────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌───────────────────────────────────────────────────────────────────────────────────────┐
│                              DATA TRANSFORMATION                                       │
│                                                                                        │
│   transformer.ts                                                                      │
│                                                                                        │
│   CONFIGURATION:                                                                      │
│   ┌───────────────────────────────────────────────────────────────────────────────┐  │
│   │  eurToGbpRate:           0.85       (EUR to GBP conversion)                   │  │
│   │  minPrice:               0.01       (minimum valid price)                     │  │
│   │  maxPrice:               10000      (maximum valid price)                     │  │
│   │  anomalyThresholdPercent: 50        (% change to flag anomaly)                │  │
│   │  enableDeduplication:    true                                                 │  │
│   │  enableAnomalyDetection: true                                                 │  │
│   └───────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                        │
│   TRANSFORMATION PIPELINE:                                                            │
│                                                                                        │
│   ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐          │
│   │    DEDUPE   │───▶│  VALIDATE   │───▶│  CONVERT    │───▶│   ANOMALY   │          │
│   │             │    │             │    │             │    │   DETECT    │          │
│   │ • By cardId │    │ • Price     │    │ • EUR→GBP   │    │ • >50%      │          │
│   │ • Keep      │    │   range     │    │ • Round to  │    │   change    │          │
│   │   latest    │    │ • Required  │    │   2 decimal │    │ • Flag for  │          │
│   │             │    │   fields    │    │             │    │   review    │          │
│   └─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘          │
│         │                  │                  │                  │                   │
│         ▼                  ▼                  ▼                  ▼                   │
│   Removed: 15        Rejected: 3        Converted: 127      Flagged: 2              │
│                                                                                        │
│   PRICE CALCULATION:                                                                  │
│   ┌───────────────────────────────────────────────────────────────────────────────┐  │
│   │  trendPriceGbp   = trendPrice × 0.85                                          │  │
│   │  lowPriceGbp     = lowPrice × 0.85                                            │  │
│   │  bestPriceGbp    = min(trendPriceGbp, lowPriceGbp)                            │  │
│   │  tradeinPriceGbp = bestPriceGbp × 0.70                                        │  │
│   │                                                                               │  │
│   │  Example:                                                                     │  │
│   │  trendPrice: 45.00 EUR → 38.25 GBP                                           │  │
│   │  lowPrice:   12.50 EUR → 10.63 GBP                                           │  │
│   │  bestPrice:  10.63 GBP (lower of trend/low)                                  │  │
│   │  tradeinPrice: 7.44 GBP (for customer trade-ins)                             │  │
│   └───────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                        │
└───────────────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌───────────────────────────────────────────────────────────────────────────────────────┐
│                              DATABASE LOADING                                          │
│                                                                                        │
│   database-loader.ts (Prisma ORM)                                                     │
│                                                                                        │
│   CONFIGURATION:                                                                      │
│   ┌───────────────────────────────────────────────────────────────────────────────┐  │
│   │  batchSize:         100           (records per transaction)                   │  │
│   │  enableHistory:     true          (write to price_history)                    │  │
│   │  updateBestPrice:   true          (recalculate bestPriceGbp)                  │  │
│   │  tradeinMultiplier: 0.70          (trade-in value factor)                     │  │
│   │  dryRun:            false         (skip actual writes)                        │  │
│   └───────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                        │
│   UPSERT OPERATION:                                                                   │
│   ┌───────────────────────────────────────────────────────────────────────────────┐  │
│   │  prisma.cardPriceV2.upsert({                                                  │  │
│   │    where: { cardId: 'OP01-120' },                                             │  │
│   │    update: {                                                                  │  │
│   │      limitless_cardmarket_eur: 45.00,                                         │  │
│   │      limitless_cardmarket_gbp: 38.25,                                         │  │
│   │      bestPriceGbp: 10.63,                                                     │  │
│   │      tradeinPriceGbp: 7.44,                                                   │  │
│   │      lastUpdated: new Date()                                                  │  │
│   │    },                                                                         │  │
│   │    create: { /* full record */ }                                              │  │
│   │  })                                                                           │  │
│   └───────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                        │
│   HISTORY INSERT:                                                                     │
│   ┌───────────────────────────────────────────────────────────────────────────────┐  │
│   │  prisma.priceHistory.create({                                                 │  │
│   │    data: {                                                                    │  │
│   │      cardId: 'OP01-120',                                                      │  │
│   │      priceDate: new Date(),                                                   │  │
│   │      cardmarket_price_gbp: 10.63,                                             │  │
│   │      source: 'cardmarket',                                                    │  │
│   │      pct_change_1d: 2.5,                                                      │  │
│   │      pct_change_7d: -3.2,                                                     │  │
│   │      pct_change_30d: 15.4                                                     │  │
│   │    }                                                                          │  │
│   │  })                                                                           │  │
│   └───────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                        │
└───────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Component Architecture

### 3.1 Module Dependency Graph

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                              MODULE DEPENDENCIES                                     │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│   src/cli/runner.ts (Entry Point)                                                   │
│           │                                                                          │
│           ▼                                                                          │
│   ┌───────────────────────────────────────────────────────────────────────────────┐│
│   │                         PIPELINE LAYER                                         ││
│   │                                                                                ││
│   │   ┌─────────────────┐                                                         ││
│   │   │  orchestrator.ts │◄────────────────────────────────────────────┐          ││
│   │   │                  │                                             │          ││
│   │   │ • orchestrate()  │                                             │          ││
│   │   │ • runScrape()    │                                             │          ││
│   │   │ • processSet()   │                                             │          ││
│   │   └────────┬─────────┘                                             │          ││
│   │            │                                                       │          ││
│   │   ┌────────┼─────────────────────────────────────────────┐        │          ││
│   │   │        ▼                                             │        │          ││
│   │   │  ┌─────────────────┐    ┌─────────────────┐          │        │          ││
│   │   │  │  transformer.ts │───▶│database-loader.ts│         │        │          ││
│   │   │  │                 │    │                  │         │        │          ││
│   │   │  │ • transform()   │    │ • loadBatch()    │         │        │          ││
│   │   │  │ • validate()    │    │ • upsert()       │         │        │          ││
│   │   │  │ • dedupe()      │    │ • insertHistory()│         │        │          ││
│   │   │  └─────────────────┘    └─────────────────┘         │        │          ││
│   │   │                                                      │        │          ││
│   │   │  ┌─────────────────┐    ┌─────────────────┐          │        │          ││
│   │   │  │   sqs-queue.ts  │    │lambda-handler.ts│          │        │          ││
│   │   │  │                 │    │                 │          │        │          ││
│   │   │  │ • enqueue()     │    │ • handleScrape()│          │        │          ││
│   │   │  │ • dequeue()     │    │ • handleLoad()  │          │        │          ││
│   │   │  └─────────────────┘    └─────────────────┘          │        │          ││
│   │   └──────────────────────────────────────────────────────┘        │          ││
│   │                                                                    │          ││
│   └────────────────────────────────────────────────────────────────────┼──────────┘│
│                                                                        │           │
│   ┌────────────────────────────────────────────────────────────────────┼──────────┐│
│   │                         SCRAPER LAYER                              │          ││
│   │                                                                    │          ││
│   │   ┌─────────────────────────────────────────────────┐             │          ││
│   │   │             cardmarket-scraper.ts               │◄────────────┘          ││
│   │   │                                                 │                         ││
│   │   │  class CardmarketScraper {                      │                         ││
│   │   │    • scrapeSet(setCode)                         │                         ││
│   │   │    • scrapeCard(cardUrl)                        │                         ││
│   │   │    • scrapeExpansionPage(url, page)             │                         ││
│   │   │  }                                              │                         ││
│   │   └─────────────────────┬───────────────────────────┘                         ││
│   │                         │                                                      ││
│   │            ┌────────────┼────────────┐                                        ││
│   │            ▼            │            ▼                                        ││
│   │   ┌─────────────────┐   │   ┌─────────────────┐                               ││
│   │   │  http-client.ts │   │   │hybrid-scraper.ts│                               ││
│   │   │                 │   │   │                 │                               ││
│   │   │ • request()     │   │   │ • scrape()      │                               ││
│   │   │ • get()         │   │   │ • httpFetch()   │                               ││
│   │   │ • setProxy()    │   │   │ • browserFetch()│                               ││
│   │   └─────────────────┘   │   └────────┬────────┘                               ││
│   │                         │            │                                        ││
│   │                         │            ▼                                        ││
│   │                         │   ┌─────────────────┐                               ││
│   │                         │   │playwright-      │                               ││
│   │                         │   │client.ts        │                               ││
│   │                         │   │                 │                               ││
│   │                         │   │ • launch()      │                               ││
│   │                         │   │ • navigate()    │                               ││
│   │                         │   │ • getHtml()     │                               ││
│   │                         │   └─────────────────┘                               ││
│   │                         │                                                      ││
│   │                         ▼                                                      ││
│   │                ┌─────────────────┐                                             ││
│   │                │  html-parser.ts │                                             ││
│   │                │                 │                                             ││
│   │                │ • parseExpansion()│                                           ││
│   │                │ • parseCard()   │                                             ││
│   │                │ • parseArticles()│                                            ││
│   │                └─────────────────┘                                             ││
│   │                                                                                ││
│   └────────────────────────────────────────────────────────────────────────────────┘│
│                                                                                      │
│   ┌────────────────────────────────────────────────────────────────────────────────┐│
│   │                         RESILIENCE LAYER                                       ││
│   │                                                                                ││
│   │   ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐               ││
│   │   │circuit-breaker  │  │session-manager  │  │ fingerprint.ts  │               ││
│   │   │.ts              │  │.ts              │  │                 │               ││
│   │   │                 │  │                 │  │ • randomize()   │               ││
│   │   │ • execute()     │  │ • getSession()  │  │ • getUserAgent()│               ││
│   │   │ • trip()        │  │ • saveCookies() │  │ • getViewport() │               ││
│   │   │ • reset()       │  │ • loadCookies() │  └─────────────────┘               ││
│   │   └─────────────────┘  └─────────────────┘                                     ││
│   │                                                                                ││
│   │   ┌─────────────────┐  ┌─────────────────┐                                    ││
│   │   │  captcha.ts     │  │selector-monitor │                                    ││
│   │   │                 │  │.ts              │                                    ││
│   │   │ • solve()       │  │                 │                                    ││
│   │   │ • detect()      │  │ • recordSuccess()│                                   ││
│   │   │ • bypass()      │  │ • getHealthy()  │                                    ││
│   │   └─────────────────┘  └─────────────────┘                                    ││
│   │                                                                                ││
│   └────────────────────────────────────────────────────────────────────────────────┘│
│                                                                                      │
│   ┌────────────────────────────────────────────────────────────────────────────────┐│
│   │                         STORAGE & MONITORING                                   ││
│   │                                                                                ││
│   │   ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐               ││
│   │   │  s3-storage.ts  │  │ cloudwatch.ts   │  │   health.ts     │               ││
│   │   │                 │  │                 │  │                 │               ││
│   │   │ • save()        │  │ • putMetric()   │  │ • check()       │               ││
│   │   │ • load()        │  │ • log()         │  │ • getStatus()   │               ││
│   │   │ • list()        │  │ • alarm()       │  │ • isHealthy()   │               ││
│   │   └─────────────────┘  └─────────────────┘  └─────────────────┘               ││
│   │                                                                                ││
│   └────────────────────────────────────────────────────────────────────────────────┘│
│                                                                                      │
│   ┌────────────────────────────────────────────────────────────────────────────────┐│
│   │                         CONFIGURATION                                          ││
│   │                                                                                ││
│   │   ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────────┐              ││
│   │   │ sets.ts  │  │ proxy.ts │  │selectors │  │cardmarket-       │              ││
│   │   │          │  │          │  │.ts       │  │optimized.ts      │              ││
│   │   │ONEPIECE_ │  │BRIGHT_   │  │EXPANSION_│  │SCRAPER_CONFIG    │              ││
│   │   │SETS      │  │DATA_CFG  │  │SELECTORS │  │                  │              ││
│   │   └──────────┘  └──────────┘  └──────────┘  └──────────────────┘              ││
│   │                                                                                ││
│   └────────────────────────────────────────────────────────────────────────────────┘│
│                                                                                      │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Class Relationships

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                              CLASS STRUCTURE                                         │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│  ┌────────────────────────────────────┐                                             │
│  │        CardmarketScraper           │                                             │
│  ├────────────────────────────────────┤                                             │
│  │ - httpClient: HttpClient           │                                             │
│  │ - parser: HtmlParser               │                                             │
│  │ - circuitBreaker: CircuitBreaker   │                                             │
│  │ - sessionManager: SessionManager   │                                             │
│  │ - config: ScraperConfig            │                                             │
│  ├────────────────────────────────────┤                                             │
│  │ + scrapeSet(setCode): ScrapeResult │                                             │
│  │ + scrapeCard(url): ScrapedCard     │                                             │
│  │ + scrapeExpansion(url): ScrapedCard[]                                            │
│  │ - handleBlocked(): void            │                                             │
│  │ - retryWithBackoff(): Promise      │                                             │
│  └────────────────────────────────────┘                                             │
│           │                                                                          │
│           │ uses                                                                     │
│           ▼                                                                          │
│  ┌────────────────────────────────────┐    ┌────────────────────────────────────┐  │
│  │           HttpClient               │    │          HtmlParser                 │  │
│  ├────────────────────────────────────┤    ├────────────────────────────────────┤  │
│  │ - axiosInstance: AxiosInstance     │    │ - cheerio: CheerioAPI              │  │
│  │ - proxyConfig: ProxyConfig         │    │ - selectors: SelectorConfig        │  │
│  │ - rateLimiter: Bottleneck          │    ├────────────────────────────────────┤  │
│  ├────────────────────────────────────┤    │ + parseExpansionPage(html)         │  │
│  │ + get(url, options): Response      │    │ + parseCardDetail(html)            │  │
│  │ + setProxy(config): void           │    │ + parseArticles(html)              │  │
│  │ + setCookies(cookies): void        │    │ - extractPrice(element): number    │  │
│  │ - rotateProxy(): void              │    │ - trySelectors(strategies): any    │  │
│  └────────────────────────────────────┘    └────────────────────────────────────┘  │
│                                                                                      │
│  ┌────────────────────────────────────┐    ┌────────────────────────────────────┐  │
│  │        CircuitBreaker              │    │        SessionManager              │  │
│  ├────────────────────────────────────┤    ├────────────────────────────────────┤  │
│  │ - state: CLOSED|OPEN|HALF_OPEN     │    │ - s3Client: S3Client               │  │
│  │ - failureCount: number             │    │ - cookies: Map<string, Cookie[]>   │  │
│  │ - successCount: number             │    │ - ttl: number                      │  │
│  │ - config: CircuitBreakerConfig     │    ├────────────────────────────────────┤  │
│  ├────────────────────────────────────┤    │ + getSession(domain): Cookies      │  │
│  │ + execute<T>(fn): Promise<T>       │    │ + saveSession(domain, cookies)     │  │
│  │ + recordSuccess(): void            │    │ + loadFromS3(): void               │  │
│  │ + recordFailure(): void            │    │ + persistToS3(): void              │  │
│  │ - trip(): void                     │    │ - isExpired(session): boolean      │  │
│  │ - reset(): void                    │    └────────────────────────────────────┘  │
│  └────────────────────────────────────┘                                             │
│                                                                                      │
│  ┌────────────────────────────────────┐    ┌────────────────────────────────────┐  │
│  │        DataTransformer             │    │        DatabaseLoader              │  │
│  ├────────────────────────────────────┤    ├────────────────────────────────────┤  │
│  │ - eurToGbpRate: number             │    │ - prisma: PrismaClient             │  │
│  │ - anomalyThreshold: number         │    │ - batchSize: number                │  │
│  │ - config: TransformerConfig        │    │ - config: LoaderConfig             │  │
│  ├────────────────────────────────────┤    ├────────────────────────────────────┤  │
│  │ + transform(cards): TransformedCard[]   │ + loadBatch(cards): LoadResult     │  │
│  │ + validate(card): ValidationResult │    │ + upsertCard(card): void           │  │
│  │ + detectAnomaly(card): boolean     │    │ + insertHistory(card): void        │  │
│  │ - convertCurrency(eur): number     │    │ - calculateBestPrice(card): number │  │
│  │ - deduplicate(cards): cards        │    └────────────────────────────────────┘  │
│  └────────────────────────────────────┘                                             │
│                                                                                      │
│  ┌────────────────────────────────────┐    ┌────────────────────────────────────┐  │
│  │          S3Storage                 │    │        CloudWatchMonitor           │  │
│  ├────────────────────────────────────┤    ├────────────────────────────────────┤  │
│  │ - s3Client: S3Client               │    │ - cloudwatch: CloudWatchClient     │  │
│  │ - bucket: string                   │    │ - namespace: string                │  │
│  │ - compression: boolean             │    ├────────────────────────────────────┤  │
│  ├────────────────────────────────────┤    │ + putMetric(name, value, unit)     │  │
│  │ + save(key, data): void            │    │ + logEvent(message, level)         │  │
│  │ + load(key): Buffer                │    │ + setAlarm(name, threshold)        │  │
│  │ + list(prefix): string[]           │    │ + recordLatency(operation, ms)     │  │
│  │ - compress(data): Buffer           │    └────────────────────────────────────┘  │
│  │ - buildPartitionedKey(): string    │                                             │
│  └────────────────────────────────────┘                                             │
│                                                                                      │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Internal Engineering Details

### 4.1 CardMarket Anti-Bot Protection Analysis

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                    CARDMARKET PROTECTION MECHANISMS                                  │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│   LAYER 1: TLS FINGERPRINTING                                                       │
│   ┌─────────────────────────────────────────────────────────────────────────────┐  │
│   │  CardMarket analyzes TLS handshake characteristics:                          │  │
│   │                                                                              │  │
│   │  • JA3 fingerprint (cipher suite order, extensions)                         │  │
│   │  • JA4 fingerprint (enhanced version detection)                             │  │
│   │  • TLS version negotiation patterns                                         │  │
│   │                                                                              │  │
│   │  MITIGATION:                                                                 │  │
│   │  ├─ Use Playwright/Puppeteer (real browser TLS stack)                       │  │
│   │  ├─ Avoid axios/got for blocked requests (detectable fingerprint)           │  │
│   │  └─ Enable HTTP/2 where possible                                            │  │
│   └─────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                      │
│   LAYER 2: BEHAVIORAL ANALYSIS                                                      │
│   ┌─────────────────────────────────────────────────────────────────────────────┐  │
│   │  Detection triggers:                                                         │  │
│   │                                                                              │  │
│   │  • Request frequency > 30/minute                                            │  │
│   │  • Sequential pagination without delays                                      │  │
│   │  • Parallel requests from same IP                                           │  │
│   │  • Non-human navigation patterns (no CSS/JS/image requests)                 │  │
│   │  • Missing referer headers                                                  │  │
│   │                                                                              │  │
│   │  MITIGATION:                                                                 │  │
│   │  ├─ 3-5 second delays between requests (randomized)                         │  │
│   │  ├─ Sequential processing only (no parallel)                                │  │
│   │  ├─ Simulate realistic navigation (homepage → set → card)                   │  │
│   │  └─ Request all page resources (CSS, JS, images)                            │  │
│   └─────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                      │
│   LAYER 3: CAPTCHA SYSTEM (BWSTATE)                                                 │
│   ┌─────────────────────────────────────────────────────────────────────────────┐  │
│   │  CardMarket uses a CUSTOM captcha system (NOT Cloudflare):                  │  │
│   │                                                                              │  │
│   │  Flow:                                                                       │  │
│   │  1. Request triggers /human-test/* endpoint                                 │  │
│   │  2. Proof-of-Work (PoW) JavaScript challenge                                │  │
│   │  3. Image-based verification (select matching images)                        │  │
│   │  4. BWSTATE cookie issued on success                                        │  │
│   │                                                                              │  │
│   │  Cookie format: BWSTATE={encrypted_payload}                                 │  │
│   │  TTL: ~30 minutes to 2 hours                                                │  │
│   │                                                                              │  │
│   │  MITIGATION:                                                                 │  │
│   │  ├─ Preserve BWSTATE cookies across sessions                                │  │
│   │  ├─ Use Playwright to solve PoW challenge natively                          │  │
│   │  ├─ 2Captcha/CapSolver integration for image challenges                     │  │
│   │  └─ Session persistence in S3 for distributed scraping                      │  │
│   └─────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                      │
│   LAYER 4: IP REPUTATION                                                            │
│   ┌─────────────────────────────────────────────────────────────────────────────┐  │
│   │  CardMarket maintains IP reputation scores:                                  │  │
│   │                                                                              │  │
│   │  • Datacenter IPs: Immediately flagged (AWS, GCP, Azure ranges)             │  │
│   │  • Known proxy ranges: Higher scrutiny                                       │  │
│   │  • Residential IPs: Lower suspicion                                         │  │
│   │  • Geographic anomalies: EU site from US/Asia triggers review               │  │
│   │                                                                              │  │
│   │  MITIGATION:                                                                 │  │
│   │  ├─ RESIDENTIAL proxies only (Bright Data, SmartProxy)                      │  │
│   │  ├─ EU country rotation (de, fr, es, it, nl, be, at)                        │  │
│   │  ├─ Rotating sessions (new IP per request or sticky for session)            │  │
│   │  └─ Off-peak hours scraping (2-6 AM UTC)                                    │  │
│   └─────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                      │
│   RESPONSE CODES:                                                                   │
│   ┌─────────────────────────────────────────────────────────────────────────────┐  │
│   │  200 OK          Normal response                                             │  │
│   │  403 Forbidden   IP blocked, TLS fingerprint detected                       │  │
│   │  429 Too Many    Rate limit exceeded (soft block)                           │  │
│   │  503 Unavailable CAPTCHA challenge required                                 │  │
│   │  302 Redirect    → /human-test/* (CAPTCHA trigger)                          │  │
│   └─────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                      │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

### 4.2 Circuit Breaker Implementation

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                         CIRCUIT BREAKER STATE MACHINE                                │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│                        ┌─────────────────────────────────────┐                      │
│                        │              CLOSED                  │                      │
│                        │         (Normal Operation)           │                      │
│                        │                                      │                      │
│                        │  • All requests pass through         │                      │
│                        │  • Track failures in sliding window  │                      │
│                        │  • failureCount = 0-4                │                      │
│                        └──────────────┬───────────────────────┘                      │
│                                       │                                              │
│                                       │ failureCount >= 5                            │
│                                       │ (within 60s window)                          │
│                                       ▼                                              │
│                        ┌─────────────────────────────────────┐                      │
│                        │               OPEN                   │                      │
│                        │          (Fail Fast Mode)            │                      │
│                        │                                      │                      │
│                        │  • All requests rejected immediately │                      │
│                        │  • Return cached/fallback response   │                      │
│                        │  • Wait for timeout (30 seconds)     │                      │
│                        └──────────────┬───────────────────────┘                      │
│                                       │                                              │
│                                       │ timeout expires                              │
│                                       │ (30 seconds)                                 │
│                                       ▼                                              │
│                        ┌─────────────────────────────────────┐                      │
│                        │            HALF_OPEN                 │                      │
│                        │         (Testing Recovery)           │                      │
│                        │                                      │                      │
│                        │  • Allow 1 test request              │                      │
│                        │  • Success → CLOSED                  │                      │
│                        │  • Failure → OPEN (reset timeout)    │                      │
│                        └──────────────────────────────────────┘                      │
│                               │                  │                                   │
│                     success   │                  │ failure                           │
│                     ──────────┘                  └──────────                         │
│                     │                                      │                         │
│                     ▼                                      ▼                         │
│              Back to CLOSED                         Back to OPEN                     │
│                                                                                      │
│   CONFIGURATION:                                                                    │
│   ┌─────────────────────────────────────────────────────────────────────────────┐  │
│   │  failureThreshold:   5          // Open after 5 failures                    │  │
│   │  successThreshold:   3          // Close after 3 consecutive successes      │  │
│   │  timeout:            30000      // 30 seconds before testing                │  │
│   │  monitoringWindow:   60000      // 60 second sliding window                 │  │
│   └─────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                      │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

### 4.3 Multi-Strategy Selector System

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                         CSS SELECTOR FALLBACK CHAINS                                 │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│   EXPANSION PAGE - PRODUCT ROW EXTRACTION:                                          │
│   ┌─────────────────────────────────────────────────────────────────────────────┐  │
│   │                                                                              │  │
│   │   Strategy 1 (Primary):                                                      │  │
│   │   └─ .table-body .row                         ──▶ Direct class targeting    │  │
│   │                  │                                                           │  │
│   │                  ▼ (if 0 matches)                                            │  │
│   │   Strategy 2 (Fallback):                                                     │  │
│   │   └─ .product-row, div[class*="row"]         ──▶ Partial class match        │  │
│   │                  │                                                           │  │
│   │                  ▼ (if 0 matches)                                            │  │
│   │   Strategy 3 (Generic):                                                      │  │
│   │   └─ tr[class*="product"], .card-item        ──▶ Common patterns            │  │
│   │                  │                                                           │  │
│   │                  ▼ (if 0 matches)                                            │  │
│   │   Strategy 4 (Regex):                                                        │  │
│   │   └─ /<div[^>]*class="[^"]*row[^"]*">/g      ──▶ Raw HTML regex             │  │
│   │                                                                              │  │
│   └─────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                      │
│   CARD DETAIL PAGE - PRICE EXTRACTION:                                              │
│   ┌─────────────────────────────────────────────────────────────────────────────┐  │
│   │                                                                              │  │
│   │   Strategy 1: Info List (dt/dd pairs)                                        │  │
│   │   ┌─────────────────────────────────────────────────────────────────────┐   │  │
│   │   │  .info-list-container dt:contains("Price Trend") + dd               │   │  │
│   │   │  .info-list-container dt:contains("From") + dd                      │   │  │
│   │   │  .info-list-container dt:contains("30-days") + dd                   │   │  │
│   │   └─────────────────────────────────────────────────────────────────────┘   │  │
│   │                  │                                                           │  │
│   │                  ▼ (if parsing fails)                                        │  │
│   │   Strategy 2: Direct Price Container                                         │  │
│   │   ┌─────────────────────────────────────────────────────────────────────┐   │  │
│   │   │  .price-container .trend                                            │   │  │
│   │   │  [data-price], [itemprop="price"]                                   │   │  │
│   │   └─────────────────────────────────────────────────────────────────────┘   │  │
│   │                  │                                                           │  │
│   │                  ▼ (if parsing fails)                                        │  │
│   │   Strategy 3: Regex Extraction                                               │  │
│   │   ┌─────────────────────────────────────────────────────────────────────┐   │  │
│   │   │  /(\d+[,.]?\d*)\s*€/g                                               │   │  │
│   │   │  /Price[:\s]*(\d+[,.]?\d*)/gi                                       │   │  │
│   │   └─────────────────────────────────────────────────────────────────────┘   │  │
│   │                                                                              │  │
│   └─────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                      │
│   PRICE PARSING (European Format):                                                  │
│   ┌─────────────────────────────────────────────────────────────────────────────┐  │
│   │                                                                              │  │
│   │   Input: "45,00 €" or "1.234,56 €"                                          │  │
│   │                                                                              │  │
│   │   Steps:                                                                     │  │
│   │   1. Remove currency symbol: "45,00" or "1.234,56"                          │  │
│   │   2. Remove thousand separators (dot): "45,00" or "1234,56"                 │  │
│   │   3. Replace decimal comma with dot: "45.00" or "1234.56"                   │  │
│   │   4. parseFloat(): 45.00 or 1234.56                                         │  │
│   │                                                                              │  │
│   │   Code:                                                                      │  │
│   │   function parseEuroPrice(str: string): number {                            │  │
│   │     return parseFloat(                                                      │  │
│   │       str.replace(/[€\s]/g, '')     // Remove € and spaces                  │  │
│   │          .replace(/\./g, '')         // Remove thousand separators          │  │
│   │          .replace(',', '.')          // Convert decimal comma               │  │
│   │     );                                                                       │  │
│   │   }                                                                          │  │
│   │                                                                              │  │
│   └─────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                      │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

### 4.4 Hybrid Scraping Strategy

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                         HTTP vs BROWSER DECISION TREE                                │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│   START                                                                             │
│     │                                                                               │
│     ▼                                                                               │
│   ┌─────────────────────────────────────────────────────────────────────────────┐  │
│   │  Is this the first request of the session?                                   │  │
│   └────────────────────────────────┬────────────────────────────────────────────┘  │
│                                    │                                               │
│               ┌────────────────────┴────────────────────┐                         │
│               │ YES                                      │ NO                      │
│               ▼                                          ▼                         │
│   ┌───────────────────────┐              ┌───────────────────────────────────────┐│
│   │ Use HTTP Client       │              │ Check previous request result          ││
│   │ (faster, cheaper)     │              │                                        ││
│   └───────────┬───────────┘              └───────────────────┬───────────────────┘│
│               │                                              │                     │
│               ▼                                              ▼                     │
│   ┌───────────────────────────────────────┐     ┌───────────────────────────────┐ │
│   │ Check response status                  │     │ Was previous request blocked? │ │
│   └───────────────────────────────────────┘     └───────────────────────────────┘ │
│               │                                              │                     │
│      ┌────────┼────────┐                        ┌────────────┼────────────┐       │
│      │        │        │                        │ YES                     │ NO    │
│      ▼        ▼        ▼                        ▼                         ▼       │
│   ┌──────┐ ┌──────┐ ┌──────┐          ┌────────────────┐        ┌──────────────┐ │
│   │ 200  │ │ 403  │ │ 302  │          │ Use Playwright  │        │ Use HTTP     │ │
│   │ OK   │ │ 429  │ │ 503  │          │ Browser         │        │ Client       │ │
│   └──┬───┘ └──┬───┘ └──┬───┘          └────────────────┘        └──────────────┘ │
│      │        │        │                                                          │
│      │        │        │                                                          │
│      ▼        ▼        ▼                                                          │
│   ┌──────┐ ┌──────────────────────────────────────────────────────────────────┐  │
│   │Parse │ │ FALLBACK TO BROWSER:                                              │  │
│   │HTML  │ │                                                                   │  │
│   └──────┘ │ 1. Launch headless Playwright (Chrome)                           │  │
│            │ 2. Set stealth mode (hide automation indicators)                  │  │
│            │ 3. Configure fingerprint (viewport, user agent, etc.)            │  │
│            │ 4. Navigate to URL                                                │  │
│            │ 5. Wait for network idle (all resources loaded)                  │  │
│            │ 6. Check for CAPTCHA presence                                     │  │
│            │    ├─ If CAPTCHA: Solve via 2Captcha or CapSolver               │  │
│            │    └─ If No CAPTCHA: Extract HTML                                │  │
│            │ 7. Save cookies to session manager                               │  │
│            │ 8. Return HTML for parsing                                        │  │
│            │                                                                   │  │
│            └───────────────────────────────────────────────────────────────────┘  │
│                                                                                      │
│   COST COMPARISON:                                                                  │
│   ┌─────────────────────────────────────────────────────────────────────────────┐  │
│   │  Method      │ Latency │ Cost/Request │ Detection Risk │ Success Rate      │  │
│   │  ──────────  │ ─────── │ ──────────── │ ────────────── │ ────────────      │  │
│   │  HTTP Client │ ~500ms  │ $0.001       │ HIGH           │ 60-70%            │  │
│   │  Playwright  │ ~3-5s   │ $0.01-0.05   │ LOW            │ 95%+              │  │
│   │  Hybrid      │ ~1-2s   │ $0.005 avg   │ MEDIUM         │ 90%+              │  │
│   └─────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                      │
│   RECOMMENDATION: Start with HTTP, fallback to Playwright on block                 │
│                                                                                      │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 5. Performance & Cost Characteristics

### 5.1 Throughput Estimates

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                         PERFORMANCE PROJECTIONS                                      │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│   SCRAPING RATES (with 3-5s delays):                                                │
│   ┌─────────────────────────────────────────────────────────────────────────────┐  │
│   │  Requests per minute:    12-20 (conservative)                                │  │
│   │  Cards per request:      50-100 (expansion page)                             │  │
│   │  Cards per minute:       600-2,000                                           │  │
│   │  Cards per hour:         36,000-120,000                                      │  │
│   └─────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                      │
│   FULL SET SCRAPE TIME:                                                             │
│   ┌─────────────────────────────────────────────────────────────────────────────┐  │
│   │  Set          Cards    Pages    Est. Time (3s delay)                        │  │
│   │  ──────────   ─────    ─────    ────────────────────                        │  │
│   │  OP01         121      3        ~15 seconds                                  │  │
│   │  OP01-OP11    1,400    35       ~3 minutes                                   │  │
│   │  All Sets     2,000+   50       ~5 minutes                                   │  │
│   │  + Detail     2,000    2,000    ~2-3 hours (sequential)                      │  │
│   └─────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                      │
│   DAILY COLLECTION SCHEDULE:                                                        │
│   ┌─────────────────────────────────────────────────────────────────────────────┐  │
│   │  02:00 UTC   Full scrape (all sets, expansion pages)         ~5 min        │  │
│   │  08:00 UTC   High-value card detail scrape (top 100)         ~10 min       │  │
│   │  14:00 UTC   Full scrape                                     ~5 min        │  │
│   │  20:00 UTC   High-value card detail scrape                   ~10 min       │  │
│   │                                                                              │  │
│   │  Total daily: ~30 minutes scraping, 95% idle                                │  │
│   └─────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                      │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

### 5.2 Cost Analysis

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                            COST BREAKDOWN (Monthly)                                  │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│   PROXY COSTS:                                                                      │
│   ┌─────────────────────────────────────────────────────────────────────────────┐  │
│   │  Bright Data Residential:                                                    │  │
│   │  ├─ Pay-as-you-go: $8.40/GB                                                 │  │
│   │  ├─ Est. bandwidth/scrape: ~500KB (HTML only)                               │  │
│   │  ├─ Daily scrapes: ~100 requests × 500KB = 50MB                             │  │
│   │  ├─ Monthly: 50MB × 30 = 1.5GB                                              │  │
│   │  └─ Cost: 1.5 × $8.40 = ~$13/month                                          │  │
│   │                                                                              │  │
│   │  SmartProxy Residential (alternative):                                       │  │
│   │  └─ $7/GB → ~$11/month                                                      │  │
│   └─────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                      │
│   AWS COSTS:                                                                        │
│   ┌─────────────────────────────────────────────────────────────────────────────┐  │
│   │  Lambda (scraping):                                                          │  │
│   │  ├─ 4 runs/day × 5 min × 30 days = 600 min = 10 hours                       │  │
│   │  ├─ 1024MB memory: $0.0000166667/second                                     │  │
│   │  └─ Cost: 36,000s × $0.0000166667 = ~$0.60/month                            │  │
│   │                                                                              │  │
│   │  Fargate (browser scraping - if needed):                                     │  │
│   │  ├─ 0.5 vCPU, 1GB memory: $0.02/hour                                        │  │
│   │  ├─ 10 hours/month (fallback only)                                          │  │
│   │  └─ Cost: ~$0.20/month                                                      │  │
│   │                                                                              │  │
│   │  S3 Storage:                                                                 │  │
│   │  ├─ ~100MB/month compressed JSON                                            │  │
│   │  └─ Cost: ~$0.01/month                                                      │  │
│   │                                                                              │  │
│   │  RDS (shared with main app):                                                 │  │
│   │  └─ Incremental cost: ~$0                                                   │  │
│   │                                                                              │  │
│   │  CloudWatch:                                                                 │  │
│   │  └─ Cost: ~$0.30/month (custom metrics)                                     │  │
│   └─────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                      │
│   CAPTCHA COSTS (if triggered):                                                     │
│   ┌─────────────────────────────────────────────────────────────────────────────┐  │
│   │  2Captcha: $2.99/1000 solves                                                │  │
│   │  Est. triggers: 10-50/month (if well-tuned)                                 │  │
│   │  Cost: ~$0.15/month                                                         │  │
│   └─────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                      │
│   ═══════════════════════════════════════════════════════════════════════════════  │
│   TOTAL MONTHLY ESTIMATE: $14-16                                                    │
│   ═══════════════════════════════════════════════════════════════════════════════  │
│                                                                                      │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 6. Development Insights & Recommendations

### 6.1 Lessons Learned

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                         KEY LEARNINGS FROM DEVELOPMENT                               │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│   1. CARDMARKET IS NOT CLOUDFLARE                                                   │
│   ┌─────────────────────────────────────────────────────────────────────────────┐  │
│   │  Assumption: CardMarket uses Cloudflare (like many sites)                    │  │
│   │  Reality:    Custom WAF with BWSTATE cookie system                          │  │
│   │  Impact:     Standard Cloudflare bypass tools DON'T work                    │  │
│   │  Solution:   Custom session management, residential proxies required         │  │
│   │                                                                              │  │
│   │  INSIGHT: Always analyze the actual protection mechanism before              │  │
│   │           implementing bypass strategies.                                    │  │
│   └─────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                      │
│   2. SSR SIMPLIFIES EXTRACTION                                                      │
│   ┌─────────────────────────────────────────────────────────────────────────────┐  │
│   │  Discovery: CardMarket renders prices server-side (SSR)                      │  │
│   │  Impact:    No JavaScript execution needed for basic price data              │  │
│   │  Benefit:   HTTP-only scraping works for 60-70% of requests                 │  │
│   │  Savings:   ~$0.04/request saved vs. always using browser                   │  │
│   │                                                                              │  │
│   │  INSIGHT: Test if data is available in initial HTML before                  │  │
│   │           implementing expensive browser automation.                         │  │
│   └─────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                      │
│   3. EUROPEAN PRICE FORMAT MATTERS                                                  │
│   ┌─────────────────────────────────────────────────────────────────────────────┐  │
│   │  Format: "1.234,56 €" (dot = thousands, comma = decimal)                    │  │
│   │  Bug:    parseFloat("1.234,56") returns 1.234 (wrong!)                      │  │
│   │  Fix:    Remove dots, replace comma with dot, then parseFloat              │  │
│   │                                                                              │  │
│   │  INSIGHT: Currency formatting varies by region. Always validate             │  │
│   │           price parsing with real examples.                                  │  │
│   └─────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                      │
│   4. SELECTOR FRAGILITY                                                             │
│   ┌─────────────────────────────────────────────────────────────────────────────┐  │
│   │  Problem:  CSS classes can change with site updates                         │  │
│   │  Observed: ".table-body" stable, but ".col-price" variants exist            │  │
│   │  Solution: Multi-strategy selectors with monitoring                         │  │
│   │                                                                              │  │
│   │  Implementation:                                                             │  │
│   │  ├─ Track selector success rates                                            │  │
│   │  ├─ Alert when success rate drops below 30%                                 │  │
│   │  ├─ Fallback chain ensures continued operation                              │  │
│   │  └─ Regex backup for catastrophic selector failure                          │  │
│   │                                                                              │  │
│   │  INSIGHT: Never rely on a single selector. Build resilience into           │  │
│   │           the parser from day one.                                           │  │
│   └─────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                      │
│   5. RATE LIMITING IS NON-NEGOTIABLE                                               │
│   ┌─────────────────────────────────────────────────────────────────────────────┐  │
│   │  Finding:  Requests faster than 2s trigger immediate blocks                 │  │
│   │  Sweet Spot: 3-5 seconds with variance                                      │  │
│   │  Pattern:   Sequential only - parallel requests = instant ban              │  │
│   │                                                                              │  │
│   │  Implementation:                                                             │  │
│   │  const delay = 3000 + Math.random() * 2000; // 3-5s                         │  │
│   │  await new Promise(r => setTimeout(r, delay));                              │  │
│   │                                                                              │  │
│   │  INSIGHT: Aggressive scraping saves time in the short term but             │  │
│   │           costs more in IP bans and CAPTCHA solves.                          │  │
│   └─────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                      │
│   6. DATACENTER PROXIES ARE USELESS                                                │
│   ┌─────────────────────────────────────────────────────────────────────────────┐  │
│   │  Test:     Used AWS IP directly → Instant 403                               │  │
│   │  Test:     Used datacenter proxy → Blocked within 2 requests                │  │
│   │  Test:     Used residential proxy → Worked consistently                      │  │
│   │                                                                              │  │
│   │  Cost impact:                                                                │  │
│   │  ├─ Datacenter: $0.50/GB (but 0% success = infinite $/successful request)  │  │
│   │  └─ Residential: $8/GB (90%+ success = $0.004/successful request)          │  │
│   │                                                                              │  │
│   │  INSIGHT: For CardMarket, residential proxies are the only viable          │  │
│   │           option. Factor this into cost projections from the start.         │  │
│   └─────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                      │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

### 6.2 Implementation Roadmap

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                         IMPLEMENTATION STATUS & ROADMAP                              │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│   PHASE 1: FOUNDATION (COMPLETE)                                                    │
│   ┌─────────────────────────────────────────────────────────────────────────────┐  │
│   │  [x] Basic HTTP scraper with axios                                           │  │
│   │  [x] Cheerio-based HTML parser                                               │  │
│   │  [x] Multi-strategy selector system                                          │  │
│   │  [x] Rate limiting with bottleneck                                          │  │
│   │  [x] Configuration management                                                │  │
│   │  [x] One Piece set definitions                                               │  │
│   │  [x] Unit tests for parser/utils                                             │  │
│   │  [x] AWS infrastructure documentation                                        │  │
│   └─────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                      │
│   PHASE 2: RESILIENCE (COMPLETE)                                                    │
│   ┌─────────────────────────────────────────────────────────────────────────────┐  │
│   │  [x] Proxy rotation (Bright Data, SmartProxy, Oxylabs)                      │  │
│   │  [x] Session/cookie management                                               │  │
│   │  [x] User-agent rotation                                                     │  │
│   │  [x] Circuit breaker pattern                                                 │  │
│   │  [x] Error recovery and retry logic                                          │  │
│   │  [x] Fingerprint randomization                                               │  │
│   │  [x] Block detection (403, 429, CAPTCHA)                                    │  │
│   │  [x] Selector monitoring and health checks                                   │  │
│   └─────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                      │
│   PHASE 3: SCALE (IN PROGRESS - 70%)                                               │
│   ┌─────────────────────────────────────────────────────────────────────────────┐  │
│   │  [x] Data transformer with validation                                        │  │
│   │  [x] EUR → GBP conversion                                                   │  │
│   │  [x] Database loader (Prisma)                                                │  │
│   │  [x] S3 storage with compression                                             │  │
│   │  [x] CloudWatch metrics/logging                                              │  │
│   │  [x] SQS queue integration                                                   │  │
│   │  [~] Playwright browser integration (scaffolded, not deployed)              │  │
│   │  [ ] Lambda handler deployment                                               │  │
│   │  [ ] Step Functions orchestration                                            │  │
│   │  [ ] Fargate task definitions                                                │  │
│   └─────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                      │
│   PHASE 4: PRODUCTION (PLANNED)                                                     │
│   ┌─────────────────────────────────────────────────────────────────────────────┐  │
│   │  [ ] CAPTCHA solver integration (2Captcha/CapSolver)                        │  │
│   │  [ ] Automated scheduling (EventBridge)                                      │  │
│   │  [ ] Alerting and on-call setup                                              │  │
│   │  [ ] Cost monitoring dashboards                                              │  │
│   │  [ ] Performance optimization                                                │  │
│   │  [ ] Production runbook                                                      │  │
│   │  [ ] Disaster recovery procedures                                            │  │
│   └─────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                      │
│   PHASE 5: ENHANCEMENT (FUTURE)                                                     │
│   ┌─────────────────────────────────────────────────────────────────────────────┐  │
│   │  [ ] Real-time price alerts                                                  │  │
│   │  [ ] Price history analytics                                                 │  │
│   │  [ ] Arbitrage detection (CardMarket vs eBay)                               │  │
│   │  [ ] ML-based anomaly detection                                              │  │
│   │  [ ] Multi-TCG support (Pokemon, Yu-Gi-Oh, MTG)                             │  │
│   │  [ ] API endpoint for external access                                        │  │
│   └─────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                      │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

### 6.3 Comparison: eBay vs CardMarket Pipeline

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                    PIPELINE COMPARISON: EBAY vs CARDMARKET                           │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│   ┌───────────────────┬───────────────────────┬───────────────────────┐            │
│   │ Aspect            │ eBay Pipeline         │ CardMarket Pipeline   │            │
│   ├───────────────────┼───────────────────────┼───────────────────────┤            │
│   │ Data Source       │ SerpAPI (API)         │ Direct scraping       │            │
│   │ Cost per 1000 req │ $10 (API quota)       │ ~$0.04 (proxy)        │            │
│   │ Anti-bot          │ None (API)            │ Heavy (CAPTCHA, TLS)  │            │
│   │ Rate limit        │ 2s (API limit)        │ 3-5s (avoid block)    │            │
│   │ Proxy required    │ No                    │ Yes (residential)     │            │
│   │ Browser required  │ No                    │ Fallback only         │            │
│   │ Data freshness    │ 90-day sold history   │ Real-time prices      │            │
│   │ Currency          │ Multi (USD,GBP,EUR)   │ EUR only              │            │
│   │ Primary use       │ ML training data      │ Live pricing          │            │
│   │ Complexity        │ Low                   │ High                  │            │
│   │ Reliability       │ 99%+ (API SLA)        │ 90-95% (scraping)     │            │
│   │ Implementation    │ Production ready      │ 70% complete          │            │
│   └───────────────────┴───────────────────────┴───────────────────────┘            │
│                                                                                      │
│   DATA COMPLEMENTARITY:                                                             │
│   ┌─────────────────────────────────────────────────────────────────────────────┐  │
│   │                                                                              │  │
│   │   eBay Pipeline                    CardMarket Pipeline                       │  │
│   │   ─────────────                    ──────────────────                       │  │
│   │   • Historical sold prices         • Current market prices                  │  │
│   │   • Graded card data               • European market focus                  │  │
│   │   • Condition-based pricing        • Trend analysis (7d/30d)                │  │
│   │   • Images for ML training         • Seller inventory data                  │  │
│   │                                                                              │  │
│   │                        ┌─────────────┐                                       │  │
│   │                        │   COMBINE   │                                       │  │
│   │                        └──────┬──────┘                                       │  │
│   │                               │                                              │  │
│   │                               ▼                                              │  │
│   │                  ┌────────────────────────┐                                  │  │
│   │                  │  Comprehensive Price   │                                  │  │
│   │                  │  Intelligence System   │                                  │  │
│   │                  │                        │                                  │  │
│   │                  │  • Cross-market arb    │                                  │  │
│   │                  │  • Historical trends   │                                  │  │
│   │                  │  • Optimal trade-in    │                                  │  │
│   │                  │  • Price predictions   │                                  │  │
│   │                  └────────────────────────┘                                  │  │
│   │                                                                              │  │
│   └─────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                      │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 7. Appendix

### A. Environment Variables

```bash
# Core
AWS_REGION=us-east-1
NODE_ENV=production

# Proxy (choose one provider)
BRIGHT_DATA_CUSTOMER=your_customer_id
BRIGHT_DATA_PASSWORD=your_password
# OR
SMARTPROXY_USER=your_username
SMARTPROXY_PASSWORD=your_password

# Database
DATABASE_URL=postgresql://user:pass@host:5432/db

# S3
S3_BUCKET=cardmarket-scraper-data

# Request Settings
REQUEST_DELAY_MS=3000
REQUEST_TIMEOUT_MS=30000
MAX_CONCURRENCY=1
RETRY_ATTEMPTS=3

# Optional
CAPTCHA_2CAPTCHA_API_KEY=xxx
DEBUG=cardmarket:*
```

### B. CLI Reference

```bash
# Full set scrape
npx tsx src/cli/runner.ts scrape --sets=OP01,OP02,OP03

# Single set with verbose output
npx tsx src/cli/runner.ts scrape --sets=OP01 --verbose

# Dry run (no S3/database writes)
npx tsx src/cli/runner.ts scrape --sets=OP01 --dry-run

# High-value cards only
npx tsx src/cli/runner.ts scrape --mode=high-value

# Run health check
npx tsx src/cli/runner.ts health

# View selector health
npx tsx src/cli/runner.ts selectors --status
```

### C. S3 Path Reference

| Path | Purpose |
|------|---------|
| `scrapes/year={Y}/month={M}/day={D}/set={S}/*.json.gz` | Raw scrape data |
| `transformed/year={Y}/month={M}/day={D}/prices_*.json.gz` | Transformed prices |
| `training/exports/daily/*.parquet` | ML training exports |
| `debug/raw_html/{scrape_id}/` | Raw HTML for debugging |
| `sessions/` | Cookie/session persistence |

### D. Database Tables

| Table | Purpose |
|-------|---------|
| `card_prices_v2` | Current best prices per card |
| `price_history` | Historical price tracking |
| `scrape_runs` | Scrape execution metadata |
| `selector_health` | CSS selector success rates |

---

*Document generated: 2026-01-09*
*Pipeline version: 1.0.0 (Development)*
