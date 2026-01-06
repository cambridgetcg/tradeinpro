# Japanese Price Integration & Neural Network Visualization Plan

## Executive Summary

This document outlines the architecture for integrating Japanese (CardRush) price data as the **source of truth** for the price tracker, with a neural network visualization showing how price signals propagate from Japan through multi-channel markets.

---

## Data Flow Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                           🇯🇵 JAPAN - SOURCE MARKET                                  │
│  ┌─────────────────────────────────────────────────────────────────────────────┐   │
│  │                         CardRush Japan (JPY)                                  │   │
│  │                    daily_prices.xlsx → Historical                             │   │
│  │                    pricefeed/*.xlsx → Real-time                               │   │
│  └──────────────────────────────────┬──────────────────────────────────────────┘   │
└─────────────────────────────────────┼───────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                           💱 EXCHANGE RATE LAYER                                     │
│                                                                                      │
│     JPY → GBP (×0.0047)    JPY → EUR (×0.0055)    JPY → USD (×0.0063)              │
│                                                                                      │
│     Exchange rate changes affect ALL cards simultaneously                            │
│     This is a "market force" that ripples through the entire network                │
└─────────────────────────────────────┬───────────────────────────────────────────────┘
                                      │
                    ┌─────────────────┼─────────────────┐
                    │                 │                 │
                    ▼                 ▼                 ▼
┌───────────────────────┐ ┌───────────────────────┐ ┌───────────────────────┐
│   🛒 eBay Business    │ │   🛒 eBay Private     │ │   🃏 CardMarket        │
│   selling_price_gbp   │ │   selling_price_gbp   │ │   selling_price_gbp   │
│   margin: +76%        │ │   margin: +59%        │ │   margin: +67%        │
└───────────────────────┘ └───────────────────────┘ └───────────────────────┘
            │                       │                         │
            └───────────────────────┼─────────────────────────┘
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                           📊 PRICE TRACKER (Frontend)                                │
│                                                                                      │
│  ┌─────────────────────────────────────────────────────────────────────────────┐   │
│  │                    NEURAL NETWORK VISUALIZATION                              │   │
│  │                                                                               │   │
│  │     ○ Cards = Nodes (size = price, color = change)                           │   │
│  │     ─ Correlations = Edges (thickness = strength, color = pos/neg)           │   │
│  │     ◉ Sets = Clusters (cards grouped by booster set)                         │   │
│  │     ⟳ Exchange Rate = Global force affecting all nodes                       │   │
│  │                                                                               │   │
│  └─────────────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Neural Network Concept

### Nodes (Cards)

Each card is a node in the network with properties:

```typescript
interface CardNode {
  id: string;                    // e.g., "OP01-001-parallel"
  name: string;                  // e.g., "Roronoa Zoro"
  setCode: string;               // e.g., "OP01" (determines cluster)

  // Japanese Source Price
  priceJpy: number;              // CardRush JPY price
  priceJpyChange24h: number;     // % change in JPY
  priceJpyChange7d: number;
  priceJpyChange30d: number;

  // Converted GBP Price
  priceGbp: number;              // Current GBP equivalent
  priceGbpChange24h: number;     // Combined JPY change + FX change

  // Multi-Channel Selling Prices
  channels: {
    ebay_business: number;       // Selling price GBP
    ebay_private: number;
    cardmarket: number;
    cardtrader: number;
  };

  // Arbitrage Metrics
  margin: number;                // Best sell - buy cost
  marginPercent: number;         // (margin / cost) × 100

  // Network Properties
  connections: number;           // Number of correlated cards
  clusterStrength: number;       // How tightly bound to its set
}
```

### Edges (Correlations)

Correlations show how cards move together:

```typescript
interface CorrelationEdge {
  source: string;                // Card A
  target: string;                // Card B

  // Correlation metrics
  correlation: number;           // Pearson coefficient (-1 to +1)
  pValue: number;                // Statistical significance
  sampleSize: number;            // Days of data used

  // Visual properties
  strength: number;              // |correlation| for edge thickness
  type: 'positive' | 'negative'; // Edge color
}
```

### Clusters (Sets)

Cards naturally cluster by booster set:

```typescript
interface SetCluster {
  setCode: string;               // e.g., "OP01"
  setName: string;               // e.g., "Romance Dawn"

  // Aggregate metrics
  cardCount: number;
  totalValueJpy: number;
  totalValueGbp: number;
  avgChange24h: number;

  // Cluster coherence
  internalCorrelation: number;   // How strongly cards within set correlate
  volatility: number;            // Price movement variance

  // Network position
  centerX: number;               // Cluster center in visualization
  centerY: number;
}
```

---

## Database Schema Extensions

### 1. Extend CardPriceHistory with JPY

```sql
ALTER TABLE card_price_history
ADD COLUMN price_jpy DECIMAL(10,0),
ADD COLUMN exchange_rate DECIMAL(10,5);

-- Index for JPY queries
CREATE INDEX idx_card_history_jpy ON card_price_history(card_id, price_jpy);
```

### 2. Exchange Rate History Table

```sql
CREATE TABLE exchange_rate_history (
  id TEXT PRIMARY KEY,
  date DATE NOT NULL UNIQUE,

  -- Rate from S3 pricefeed (gbp_to_jpy column)
  jpy_to_gbp DECIMAL(10,8) NOT NULL,  -- e.g., 0.00472
  gbp_to_jpy DECIMAL(10,4) NOT NULL,  -- e.g., 211.82

  -- Source tracking
  source TEXT DEFAULT 's3_pricefeed',

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_exchange_rate_date ON exchange_rate_history(date);
```

### 3. Correlation Calculation Requirements

The `price_correlations` table exists but needs data. Calculation approach:

```typescript
// Calculate Pearson correlation for all card pairs with sufficient data
async function calculateCorrelations(minDays: number = 30): Promise<void> {
  // 1. Get all cards with at least minDays of history
  // 2. For each pair, calculate:
  //    - Pearson correlation coefficient
  //    - p-value for significance test
  //    - Sample size
  // 3. Only store correlations where |r| > 0.3 and p < 0.05
  // 4. Update weekly via cron job
}
```

---

## New API Endpoints

### 1. Card History with JPY Data

```
GET /apps/trade-in/price-index/card/:cardId/history?days=30&currency=both
```

Response:
```json
{
  "cardId": "OP01-OP01-001-parallel",
  "name": "Roronoa Zoro",
  "setCode": "OP01",
  "history": [
    {
      "date": "2024-08-29",
      "priceJpy": 18800,
      "priceGbp": 88.68,
      "exchangeRate": 0.00472,
      "changeJpy": 0,
      "changeGbp": 0,
      "changeFx": 0
    },
    // ...
  ],
  "sources": {
    "cardrush": { "priceJpy": 15800, "priceGbp": 74.59 },
    "ebay_business": { "sellingGbp": 131.80, "margin": 76.7 },
    "ebay_private": { "sellingGbp": 118.80, "margin": 59.3 },
    "cardmarket": { "sellingGbp": 124.80, "margin": 67.3 }
  },
  "stats": {
    "currentJpy": 15800,
    "currentGbp": 74.59,
    "highJpy": 18800,
    "lowJpy": 9980,
    "change30dJpy": -15.96,
    "change30dGbp": -15.89,
    "volatility": 12.4
  }
}
```

### 2. Neural Network Data Endpoint

```
GET /apps/trade-in/price-index/network?game=onepiece&minCorrelation=0.3
```

Response:
```json
{
  "nodes": [
    {
      "id": "OP01-OP01-001-parallel",
      "name": "Roronoa Zoro",
      "setCode": "OP01",
      "priceJpy": 15800,
      "priceGbp": 74.59,
      "changeJpy": -2.5,
      "changeGbp": -2.1,
      "size": 12,
      "color": "#f87171"
    }
    // ...
  ],
  "edges": [
    {
      "source": "OP01-OP01-001-parallel",
      "target": "OP01-OP01-003-parallel",
      "correlation": 0.85,
      "strength": 0.85,
      "type": "positive"
    }
    // ...
  ],
  "clusters": [
    {
      "setCode": "OP01",
      "name": "Romance Dawn",
      "cardCount": 45,
      "internalCorrelation": 0.72,
      "color": "#3b82f6"
    }
    // ...
  ],
  "marketForces": {
    "exchangeRate": {
      "current": 0.00472,
      "change24h": -0.3,
      "impact": "All nodes shifted -0.3% from FX"
    }
  }
}
```

### 3. Arbitrage Opportunities

```
GET /apps/trade-in/price-index/arbitrage?game=onepiece&minMargin=50
```

Response:
```json
{
  "opportunities": [
    {
      "cardId": "OP01-OP01-001-parallel",
      "name": "Roronoa Zoro",
      "buyPrice": { "source": "cardrush", "jpy": 15800, "gbp": 74.59 },
      "sellPrice": { "channel": "ebay_business", "gbp": 131.80 },
      "margin": 57.21,
      "marginPercent": 76.7,
      "volume": "high"
    }
    // ...
  ],
  "summary": {
    "totalOpportunities": 127,
    "avgMargin": 62.4,
    "topChannel": "ebay_business"
  }
}
```

---

## Frontend Visualization Enhancement

### Crystal View Evolution

Transform the crystal visualization into a true neural network:

```javascript
// Enhanced crystal rendering with neural network semantics
function renderNeuralNetwork(data) {
  // 1. Position clusters (sets) in a circle
  const clusters = positionClusters(data.clusters);

  // 2. Position nodes within clusters using force-directed layout
  const nodes = positionNodes(data.nodes, clusters);

  // 3. Draw correlation edges
  for (const edge of data.edges) {
    drawCorrelationEdge(edge, nodes);
  }

  // 4. Draw exchange rate "force field" as background gradient
  drawExchangeRateField(data.marketForces.exchangeRate);

  // 5. Draw nodes with JPY/GBP toggle
  for (const node of nodes) {
    drawCardNode(node, state.currency);
  }

  // 6. Draw cluster boundaries
  for (const cluster of clusters) {
    drawClusterBoundary(cluster);
  }
}
```

### New UI Elements

```html
<!-- Currency Toggle -->
<div class="price-index__currency-toggle">
  <button data-currency="gbp" class="active">£ GBP</button>
  <button data-currency="jpy">¥ JPY</button>
  <button data-currency="both">Both</button>
</div>

<!-- Exchange Rate Banner -->
<div class="price-index__fx-banner">
  <span class="fx-label">¥→£ Rate</span>
  <span class="fx-value">0.00472</span>
  <span class="fx-change fx-change--down">▼ 0.3%</span>
</div>

<!-- Arbitrage Panel -->
<div class="price-index__arbitrage-panel">
  <h3>💰 Top Opportunities</h3>
  <div class="arbitrage-list" data-arbitrage-list></div>
</div>
```

---

## Data Sync Pipeline

### Cron Schedule

| Job | Schedule | Purpose |
|-----|----------|---------|
| `/api/cron/price-sync` | 0 1 * * * | Sync daily_prices.xlsx (JPY history) |
| `/api/cron/pricefeed-sync` | 0 */4 * * * | Sync multi-channel prices |
| `/api/cron/correlation-calc` | 0 2 * * 0 | Calculate correlations weekly |
| `/api/cron/exchange-rate` | 0 */6 * * * | Track exchange rate changes |

### Sync Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    DAILY SYNC (1 AM UTC)                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. Download daily_prices.xlsx from S3                          │
│     ↓                                                            │
│  2. Parse Excel, extract new dates                               │
│     ↓                                                            │
│  3. Get exchange rate from pricefeed                             │
│     ↓                                                            │
│  4. For each card/date:                                          │
│     - Store JPY price                                            │
│     - Calculate GBP using exchange rate                          │
│     - Calculate % change from previous                           │
│     ↓                                                            │
│  5. Upsert to card_price_history                                │
│     ↓                                                            │
│  6. Update exchange_rate_history                                 │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                  PRICEFEED SYNC (Every 4 hours)                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. Download onepiece_pricefeed.xlsx from S3                    │
│     ↓                                                            │
│  2. Parse each sheet (ebay_business, cardmarket, etc.)          │
│     ↓                                                            │
│  3. For each card:                                               │
│     - Extract current JPY price                                  │
│     - Extract channel selling prices                             │
│     - Calculate margins                                          │
│     ↓                                                            │
│  4. Upsert to price_sources                                     │
│     ↓                                                            │
│  5. Identify arbitrage opportunities                            │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                CORRELATION CALC (Weekly, Sunday 2 AM)            │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. Get all cards with 30+ days of history                      │
│     ↓                                                            │
│  2. For each pair of cards:                                      │
│     - Align price series by date                                 │
│     - Calculate Pearson correlation                              │
│     - Calculate p-value                                          │
│     ↓                                                            │
│  3. Filter: |correlation| > 0.3 AND p-value < 0.05              │
│     ↓                                                            │
│  4. Upsert to price_correlations                                │
│     ↓                                                            │
│  5. Calculate set-level correlations                            │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Implementation Phases

### Phase 1: JPY Data Storage (Week 1)
- [ ] Add `price_jpy` and `exchange_rate` columns to `card_price_history`
- [ ] Create `exchange_rate_history` table
- [ ] Update `syncDailyPrices()` to store JPY alongside GBP
- [ ] Create `/api/cron/exchange-rate` endpoint

### Phase 2: Multi-Channel Sync (Week 1-2)
- [ ] Create `/api/cron/pricefeed-sync` endpoint
- [ ] Implement `syncPriceSources()` function
- [ ] Add margin calculations
- [ ] Create `/price-index/card/:cardId/sources` API

### Phase 3: Correlation Engine (Week 2)
- [ ] Implement Pearson correlation calculator
- [ ] Create `/api/cron/correlation-calc` endpoint
- [ ] Add set-level correlation aggregation
- [ ] Create `/price-index/network` API

### Phase 4: Frontend Neural Network (Week 3)
- [ ] Add currency toggle UI
- [ ] Add exchange rate banner
- [ ] Enhance crystal view with correlation edges
- [ ] Add cluster visualization
- [ ] Implement force-directed layout for nodes

### Phase 5: Arbitrage Features (Week 3-4)
- [ ] Create `/price-index/arbitrage` API
- [ ] Add arbitrage panel to UI
- [ ] Implement opportunity notifications
- [ ] Add historical margin tracking

---

## Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| JPY Data Coverage | 100% | All S3 cards have JPY history |
| Correlation Coverage | 80%+ | Cards with 30d history have correlations |
| API Latency (network) | <500ms | p95 response time |
| Sync Success Rate | >99% | Daily cron completions |
| Arbitrage Detection | Real-time | Opportunities shown within 4 hours |

---

## Appendix: Correlation Algorithm

```typescript
/**
 * Calculate Pearson correlation coefficient between two price series
 */
function pearsonCorrelation(seriesA: number[], seriesB: number[]): {
  correlation: number;
  pValue: number;
  n: number;
} {
  const n = seriesA.length;
  if (n < 10) throw new Error('Insufficient data points');

  // Calculate means
  const meanA = seriesA.reduce((a, b) => a + b, 0) / n;
  const meanB = seriesB.reduce((a, b) => a + b, 0) / n;

  // Calculate covariance and standard deviations
  let covariance = 0;
  let varianceA = 0;
  let varianceB = 0;

  for (let i = 0; i < n; i++) {
    const diffA = seriesA[i] - meanA;
    const diffB = seriesB[i] - meanB;
    covariance += diffA * diffB;
    varianceA += diffA * diffA;
    varianceB += diffB * diffB;
  }

  const stdA = Math.sqrt(varianceA);
  const stdB = Math.sqrt(varianceB);

  if (stdA === 0 || stdB === 0) {
    return { correlation: 0, pValue: 1, n };
  }

  const correlation = covariance / (stdA * stdB);

  // Calculate t-statistic for significance test
  const t = correlation * Math.sqrt((n - 2) / (1 - correlation * correlation));

  // Approximate p-value using t-distribution
  const pValue = 2 * (1 - tDistCDF(Math.abs(t), n - 2));

  return { correlation, pValue, n };
}
```

---

## Visual Reference: Neural Network Layout

```
                              ┌─────────┐
                         ┌────│  OP01   │────┐
                    OP09 │    │ CLUSTER │    │ OP02
                   ┌─────┴──┐ └────┬────┘ ┌──┴─────┐
                   │        │      │      │        │
                 ○─┼──○     │    ○─┼─○    │     ○──┼─○
                ○──┼───○    │   ○──┼──○   │    ○───┼──○
                 ○─┼──○     │    ○─┼─○    │     ○──┼─○
                   │        │      │      │        │
                   └───┬────┘      │      └────┬───┘
                       │           │           │
       EB01 ───────────┼───────────┼───────────┼─────────── EB02
                       │           │           │
                   ┌───┴────┐      │      ┌────┴───┐
                   │        │      │      │        │
                 ○─┼──○     │    ○─┼─○    │     ○──┼─○
                ○──┼───○    │   ○──┼──○   │    ○───┼──○
                 ○─┼──○     │    ○─┼─○    │     ○──┼─○
                   │        │      │      │        │
                   └────┬───┘ ┌────┴────┐ └───┬────┘
                        │     │  OP03   │     │
                    OP08│     │ CLUSTER │     │OP04
                        └─────│         │─────┘
                              └─────────┘

Legend:
  ○ = Card node (size = price, color = change)
  ─ = Correlation edge (thickness = strength)
  │ = Cluster boundary (set grouping)
```

This neural network visualization shows:
1. **Clusters** = Booster sets (OP01, OP02, EB01, etc.)
2. **Nodes** = Individual cards within clusters
3. **Edges** = Price correlations between cards
4. **Layout** = Force-directed, keeping correlated cards closer

The Japanese price (JPY) flows from the center outward, with exchange rate affecting all nodes simultaneously like a gravitational force.
