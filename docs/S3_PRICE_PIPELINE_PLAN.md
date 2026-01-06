# S3 Price Data Pipeline Integration Plan

## Executive Summary

This document outlines the architecture for integrating S3 price data into the CardForum price API, enabling rich historical charting, multi-source price comparison, and automated daily updates.

## Current State

### S3 Data Sources (`s3://pricedata-tcg/`)

| File | Update Frequency | Contents |
|------|-----------------|----------|
| `daily_prices.xlsx` | Daily | Historical prices (351+ days OP, 320+ days PKMN) |
| `pricefeed/onepiece_pricefeed.xlsx` | Hourly | Multi-channel prices (eBay, CardMarket, etc.) |
| `pricefeed/pokemon_pricefeed.xlsx` | Hourly | Multi-channel prices (eBay, CardMarket, etc.) |
| `cardmarket_feed.csv` | Daily | CardMarket listing data with inventory |

### Data Structure Details

**daily_prices.xlsx** (Wide format - historical)
```
| card_number | sku             | cardrush    | 2024-08-29 | 2024-08-30 | ... |
|-------------|-----------------|-------------|------------|------------|-----|
| OP01-001    | OP-OP01-001-JP  | [url]       | 18800      | 18800      | ... |
```
- 502 One Piece cards, 286 Pokemon cards
- JPY prices from CardRush Japan
- Date range: Aug 2024 - Present

**pricefeed/*.xlsx** (Multi-channel - current)
```
Sheets: ebay_business, ebay_private, cardmarket, cardtrader, shopify

| sku             | 2026-01-06 | base_cost | total_cost | selling_price | gbp_to_jpy | platform_id |
|-----------------|------------|-----------|------------|---------------|------------|-------------|
| OP-OP01-001-JP  | 15800      | 74.59     | 95.20      | 131.80        | 211.82     | 156846789   |
```
- Current JPY price (from CardRush)
- Calculated GBP costs with margins
- Platform-specific selling prices
- eBay item numbers, CardMarket IDs

### Database Tables (Current)

| Table | Records | Purpose |
|-------|---------|---------|
| `card_prices_v2` | ~1,409 | Current card prices (Lambda-managed) |
| `card_price_history` | 231,417 | Daily price snapshots per card |
| `price_index_snapshots` | 8,291 | Daily index values (GAME/SET/TOP_100) |
| `price_correlations` | 0 | Future: correlation data |

## Proposed Architecture

### New Database Table: `price_sources`

Track multi-channel pricing for arbitrage/comparison:

```sql
CREATE TABLE price_sources (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL,
  game TEXT NOT NULL DEFAULT 'onepiece',

  -- Source identification
  source TEXT NOT NULL,  -- 'cardrush', 'cardmarket', 'ebay_business', 'ebay_private', 'cardtrader'
  platform_id TEXT,      -- External ID (ebay item number, cardmarket id)

  -- Pricing
  price_jpy DECIMAL(10,2),
  price_gbp DECIMAL(10,2),
  cost_gbp DECIMAL(10,2),
  selling_price_gbp DECIMAL(10,2),

  -- Metadata
  exchange_rate DECIMAL(10,5),
  last_updated TIMESTAMP DEFAULT NOW(),

  UNIQUE(card_id, source)
);

CREATE INDEX idx_price_sources_card ON price_sources(card_id);
CREATE INDEX idx_price_sources_source ON price_sources(source);
```

### New API Endpoints

#### 1. Card Price History
```
GET /apps/trade-in/price-index/card/:cardId/history?days=30
```
Returns daily prices for a specific card for charting.

Response:
```json
{
  "cardId": "OP01-OP01-001-parallel",
  "name": "Roronoa Zoro Parallel",
  "history": [
    { "date": "2024-08-29", "price": 88.68, "change": 0 },
    { "date": "2024-08-30", "price": 88.68, "change": 0 },
    ...
  ],
  "stats": {
    "current": 74.59,
    "high": 88.68,
    "low": 47.12,
    "avg": 65.43,
    "change30d": -15.89
  }
}
```

#### 2. Multi-Source Prices
```
GET /apps/trade-in/price-index/card/:cardId/sources
```
Returns prices across all channels for comparison.

Response:
```json
{
  "cardId": "OP01-OP01-001-parallel",
  "sources": {
    "cardrush": { "priceJpy": 15800, "priceGbp": 74.59, "lastUpdated": "..." },
    "ebay_business": { "sellingPrice": 131.80, "platformId": "156846789150" },
    "ebay_private": { "sellingPrice": 118.80, "platformId": "356704476389" },
    "cardmarket": { "sellingPrice": 124.80, "platformId": "768236" }
  },
  "bestBuy": "cardrush",
  "bestSell": "ebay_business",
  "margin": { "absolute": 57.21, "percent": 76.7 }
}
```

#### 3. Sync Trigger (Internal/Cron)
```
GET /api/cron/price-sync
```
Triggers S3 data sync. Called daily by Vercel cron.

### S3 Data Service

Create `app/lib/s3-prices.server.ts`:

```typescript
// Core functions:
- downloadFromS3(bucket, key): Buffer
- parseExcelPricefeed(buffer): PriceFeedData[]
- parseDailyPrices(buffer): HistoricalPriceData[]
- syncPriceSources(game): { synced: number, errors: string[] }
- syncDailyPrices(): { synced: number, newDates: string[] }
- getLatestExchangeRate(): number
```

### Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                         S3 Bucket                                │
│  ┌─────────────────┐  ┌──────────────────┐  ┌────────────────┐  │
│  │ daily_prices.xlsx│  │ onepiece_pricefeed│  │cardmarket_feed │  │
│  │   (historical)   │  │   (multi-channel) │  │   (inventory)  │  │
│  └────────┬────────┘  └────────┬─────────┘  └───────┬────────┘  │
└───────────┼─────────────────────┼───────────────────┼───────────┘
            │                     │                   │
            ▼                     ▼                   ▼
┌───────────────────────────────────────────────────────────────────┐
│                    S3 Price Service                                │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │  downloadFromS3() → parseExcel() → mapToCardIds() → upsert  │  │
│  └─────────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────────┘
            │                     │                   │
            ▼                     ▼                   ▼
┌───────────────────────────────────────────────────────────────────┐
│                        Database                                    │
│  ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐  │
│  │card_price_history│ │  price_sources   │ │price_index_snap  │  │
│  │  (daily prices)  │ │ (multi-channel)  │ │   (indices)      │  │
│  └────────┬─────────┘ └────────┬─────────┘ └────────┬─────────┘  │
└───────────┼─────────────────────┼───────────────────┼────────────┘
            │                     │                   │
            ▼                     ▼                   ▼
┌───────────────────────────────────────────────────────────────────┐
│                      Price API                                     │
│  /price-index/card/:id/history  │  /price-index/card/:id/sources  │
│  /price-index/:type/:key        │  /price-index/movers            │
└───────────────────────────────────────────────────────────────────┘
```

### Cron Schedule

| Job | Schedule | Endpoint | Purpose |
|-----|----------|----------|---------|
| Daily Prices Sync | 0 1 * * * | /api/cron/price-sync | Import new dates from daily_prices.xlsx |
| Index Snapshot | 0 0 * * * | /api/cron/price-snapshot | Calculate daily index values |
| Source Sync | 0 */4 * * * | /api/cron/source-sync | Update multi-channel prices |
| JP Price Sync | 0 14 * * * | /api/cron/jp-price-sync | Existing Lambda sync |

## Implementation Phases

### Phase 1: Card History API (Priority: High)
- [x] Import historical data (done - 231K records)
- [x] Backfill index snapshots (done - 8K records)
- [ ] Create `/price-index/card/:cardId/history` endpoint
- [ ] Add card history to storefront route matcher
- [ ] Update frontend chart components

### Phase 2: S3 Data Service (Priority: High)
- [ ] Create `app/lib/s3-prices.server.ts`
- [ ] Implement Excel parsing with XLSX library
- [ ] Create SKU → cardId mapping functions
- [ ] Add S3 client with error handling

### Phase 3: Daily Sync Automation (Priority: Medium)
- [ ] Create `/api/cron/price-sync` endpoint
- [ ] Implement incremental daily_prices.xlsx sync
- [ ] Add to vercel.json cron configuration
- [ ] Create sync status/health endpoint

### Phase 4: Multi-Source Prices (Priority: Medium)
- [ ] Create `price_sources` table migration
- [ ] Create `/price-index/card/:cardId/sources` endpoint
- [ ] Implement pricefeed/*.xlsx parsing
- [ ] Add source sync cron job

### Phase 5: Enhanced Analytics (Priority: Low)
- [ ] Calculate price correlations for crystal visualization
- [ ] Add volatility alerts
- [ ] Implement price prediction (moving averages)
- [ ] Add arbitrage opportunity detection

## Configuration

### Environment Variables

```env
# S3 Access (uses AWS credentials from environment)
S3_PRICE_BUCKET=pricedata-tcg
S3_REGION=us-east-1

# Sync Configuration
PRICE_SYNC_ENABLED=true
PRICE_SYNC_MAX_DAYS=365

# Cron Authentication
CRON_SECRET=your-secret-here
```

### SKU Mapping

```typescript
// S3 SKU format: OP-OP01-001-JP, PKMN-SV1A-074-JP
// DB cardId format: OP01-OP01-001-parallel, SV1A-074/073

function skuToCardId(sku: string, game: string): string {
  if (game === 'onepiece') {
    // OP-OP01-001-JP → match against fullCardNumber 'OP01-001'
    const match = sku.match(/^OP-([A-Z0-9]+)-(\d+)/i);
    if (match) return `${match[1]}-${match[2]}`;
  }
  return sku;
}
```

## Success Metrics

1. **Data Freshness**: All prices updated within 24 hours
2. **API Latency**: Card history endpoint <200ms p95
3. **Sync Reliability**: >99% success rate on cron jobs
4. **Data Coverage**: 100% of S3 cards mapped to DB

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| S3 access failure | Cache last successful sync, alert on failure |
| Excel parsing errors | Validate schema, skip malformed rows |
| SKU mapping misses | Log unmapped SKUs for manual review |
| Large file downloads | Stream processing, memory limits |

## Appendix: S3 File Schemas

### daily_prices.xlsx
- Sheet: onepiece (502 rows), pokemon (286 rows)
- Columns: card_number, sku, cardrush_url, [date columns...]
- Date format: YYYY-MM-DD
- Price unit: JPY (integer)

### pricefeed/*.xlsx
- Sheets: ebay_business, ebay_private, cardmarket, cardtrader, shopify
- Columns: sku, [current_date], base_cost, total_cost, selling_price, gbp_to_jpy, [platform_id]
- Price units: JPY (column 2), GBP (others)

### cardmarket_feed.csv
- Columns: cardmarketid, condition, language, comment, price, quantity
- Price unit: GBP
- Condition: Always "NM"
