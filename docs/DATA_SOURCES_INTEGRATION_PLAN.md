# Data Sources Integration Plan

> **Analysis Date:** 2026-01-09
> **Purpose:** Fill gaps identified in DATA_PIPELINE_LEAKAGE_ANALYSIS.md
> **Priority:** Start with existing paid/active sources before exploring alternatives

---

## Executive Summary

The data pipeline has **7 hardcoded features** that return constants, making them useless for ML training. Analysis of existing data sources reveals that **5 of these gaps can be filled using data we already pay for** (JustTCG) or already collect (Cardmarket CSV). The remaining 2 require implementing correlation calculations from existing price history data.

### Gap Summary

| Feature | Current Value | Data Source Available | Priority |
|---------|---------------|----------------------|----------|
| `relative_volume` | 1 | **JustTCG API** - Listings count via variants | P0 |
| `inventory_signal` | 0 | **Cardmarket CSV** - "Available items" column | P0 |
| `rarity_momentum` | 0 | Calculate from `card_price_history` by rarity | P1 |
| `correlation_to_set` | 0.7 | Calculate from `card_price_history` by set | P1 |
| `correlation_to_rarity` | 0.5 | Calculate from `card_price_history` by rarity | P1 |
| `correlation_deviation` | 0 | Calculate from above correlations | P1 |
| `percentile_in_rarity` | 0.5 | Calculate from `card_prices_v2` by rarity | P0 |

---

## 1. Existing Paid Sources (Priority: Immediate)

### 1.1 JustTCG API ($50/month Professional Plan)

**Current Usage:**
- Price data collection via `app/lib/data-collection/clients/justtcg.server.ts`
- Storing in `MarketPriceUS` table

**Available Data NOT Currently Used:**

```typescript
// From infrastructure/data-pipeline/scraper-dev/tcgplayer/src/apis/justtcg-client.ts

interface JustTcgVariant {
  condition: 'Near Mint' | 'Lightly Played' | 'Moderately Played' | 'Heavily Played' | 'Damaged';
  printing: 'Normal' | 'Foil' | 'Reverse Holofoil' | '1st Edition' | string;
  price: {
    usd: number;
    eur?: number;
    gbp?: number;
    updated_at: string;
  };
  history?: {
    '7d'?: number;   // 7-day price history
    '30d'?: number;  // 30-day price history
    '90d'?: number;  // 90-day price history
    '180d'?: number; // 180-day price history
  };
}
```

**Data That Can Fill Gaps:**

| Feature | JustTCG Field | Integration |
|---------|---------------|-------------|
| `relative_volume` | Count of variants with prices | Proxy for activity |
| `inventory_signal` | Number of variant conditions available | Supply indicator |
| Statistics | `history?.7d`, `history?.30d`, etc. | Price momentum |

**Integration Plan:**

```typescript
// Enhancement to normalizeCard() in justtcg-client.ts
private normalizeCard(card: JustTcgCard): NormalizedCard {
  // ... existing code ...

  // NEW: Extract volume/inventory signals
  const activeVariants = card.variants.filter(v => v.price?.usd > 0);
  const listingsProxy = activeVariants.length;

  // NEW: Extract momentum from history
  const nmVariant = activeVariants.find(v => v.condition === 'Near Mint');
  const momentum7d = nmVariant?.history?.['7d'] || null;
  const momentum30d = nmVariant?.history?.['30d'] || null;

  return {
    // ... existing fields ...
    attributes: {
      // ... existing ...
      listingsCount: listingsProxy,          // NEW
      momentum7d,                             // NEW
      momentum30d,                            // NEW
      conditionsAvailable: activeVariants.length,  // NEW
    },
  };
}
```

**Database Schema Change:**

```prisma
// Add to MarketPriceUS model
model MarketPriceUS {
  // ... existing fields ...

  // NEW: Volume/Inventory signals from JustTCG
  listingsCount     Int?      @map("listings_count")
  conditionsAvailable Int?    @map("conditions_available")
}
```

---

### 1.2 Cardmarket CSV (Free, Manual Download)

**Current Usage:**
- Parsing via `app/lib/data-collection/clients/cardmarket-csv.server.ts`
- Storing in `MarketPriceEU` table

**CSV Columns Currently Parsed:**

```typescript
// From cardmarket-csv.server.ts
const EXPECTED_HEADERS = [
  "Product ID",
  "Name",
  "Expansion",
  "Price Guide",  // trendPrice
];

// Also mapped:
// "Avg. Sell Price" -> avgSellPrice
// "Low Price" -> lowPrice
// "Avg. Day 1", "Avg. Day 7", "Avg. Day 30" -> avg1d, avg7d, avg30d
```

**Available Columns NOT Parsed:**

From Cardmarket official CSV format documentation:
- **"Available Items"** - Number of listings (CRITICAL for `inventory_signal`)
- **"Available Foils"** - Number of foil listings
- **"Category"** - Already partially handled

**Integration Plan:**

```typescript
// Enhancement to cardmarket-csv.server.ts

// Add to CardmarketCSVRow interface
export interface CardmarketCSVRow {
  // ... existing fields ...
  availableItems?: number;    // NEW
  availableFoils?: number;    // NEW
}

// Add to mapRowToObject()
function mapRowToObject(values: string[], headerMap: Record<string, number>): CardmarketCSVRow | null {
  // ... existing code ...

  return {
    // ... existing fields ...
    availableItems: getNumber("Available Items"),    // NEW
    availableFoils: getNumber("Available Foils"),    // NEW
  };
}
```

**Database Schema Change:**

```prisma
// Add to MarketPriceEU model
model MarketPriceEU {
  // ... existing fields ...

  // NEW: Inventory signals from Cardmarket CSV
  availableItems    Int?      @map("available_items")
  availableFoils    Int?      @map("available_foils")
}
```

**IMPORTANT: PriceHistoryDaily Already Has Schema Support!**

The schema already has these fields but they're not being populated:

```prisma
model PriceHistoryDaily {
  // ... existing fields ...

  // Volume/activity indicators (ALREADY EXISTS!)
  usListingsCount Int?   @map("us_listings_count")
  euListingsCount Int?   @map("eu_listings_count")
}
```

**Action:** Update the price aggregation pipeline to populate these fields from the source data.

---

## 2. Free APIs (Priority: After Paid Sources)

### 2.1 OPTCG API (Free, No Auth)

**Current Usage:**
- Price collection via `app/lib/data-collection/clients/optcg.server.ts`
- Storing inventory_price and market_price

**Available Data:**

```typescript
// From types.ts
interface OPTCGCard {
  inventory_price: number;  // TCGplayer inventory price
  market_price: number;     // TCGplayer market price
  // ... other fields
}
```

**Use for Volume Signal:**

The ratio of `inventory_price` to `market_price` can indicate supply pressure:
- `inventory_price > market_price` = High supply, sellers undercutting
- `inventory_price < market_price` = Low supply, market price elevated

```typescript
// Feature calculation
const inventorySignal = card.inventory_price && card.market_price
  ? (card.inventory_price - card.market_price) / card.market_price
  : 0;
```

---

## 3. Calculated Features (Priority: After Data Collection)

### 3.1 Rarity Percentile

**Data Source:** `card_prices_v2` table (already exists)

**Implementation:**

```sql
-- Pre-compute rarity price distributions daily
WITH rarity_stats AS (
  SELECT
    rarity,
    PERCENTILE_CONT(0.10) WITHIN GROUP (ORDER BY best_price_gbp) as p10,
    PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY best_price_gbp) as p25,
    PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY best_price_gbp) as p50,
    PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY best_price_gbp) as p75,
    PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY best_price_gbp) as p90,
    PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY best_price_gbp) as p95,
    PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY best_price_gbp) as p99
  FROM card_prices_v2
  WHERE game = 'onepiece' AND best_price_gbp > 0
  GROUP BY rarity
)
SELECT * FROM rarity_stats;
```

**TypeScript Implementation:**

```typescript
// app/lib/data-collection/services/statistics.server.ts

interface RarityPriceDistribution {
  rarity: string;
  thresholds: number[];  // [p10, p25, p50, p75, p90, p95, p99]
}

// In-memory cache (refresh daily)
const rarityDistributions = new Map<string, RarityPriceDistribution>();

export function calculateRarityPercentile(price: number, rarity: string): number {
  const dist = rarityDistributions.get(rarity);
  if (!dist) return 0.5;

  const thresholds = dist.thresholds;
  const percentiles = [0.10, 0.25, 0.50, 0.75, 0.90, 0.95, 0.99];

  // Binary search for position
  for (let i = 0; i < thresholds.length; i++) {
    if (price < thresholds[i]) {
      return i === 0 ? percentiles[0] / 2 : (percentiles[i - 1] + percentiles[i]) / 2;
    }
  }
  return 0.99;
}
```

---

### 3.2 Set & Rarity Momentum

**Data Source:** `card_price_history` table (already exists)

**Implementation:**

```sql
-- Calculate set momentum (7-day)
WITH set_prices AS (
  SELECT
    c.set_code,
    h.snapshot_date,
    AVG(h.price_gbp) as avg_price
  FROM card_price_history h
  JOIN card_prices_v2 c ON h.card_id = c.card_id
  WHERE h.snapshot_date >= CURRENT_DATE - INTERVAL '14 days'
  GROUP BY c.set_code, h.snapshot_date
),
set_momentum AS (
  SELECT
    set_code,
    (
      AVG(CASE WHEN snapshot_date >= CURRENT_DATE - INTERVAL '7 days' THEN avg_price END) -
      AVG(CASE WHEN snapshot_date < CURRENT_DATE - INTERVAL '7 days' THEN avg_price END)
    ) / NULLIF(AVG(CASE WHEN snapshot_date < CURRENT_DATE - INTERVAL '7 days' THEN avg_price END), 0)
    as momentum_7d
  FROM set_prices
  GROUP BY set_code
)
SELECT * FROM set_momentum;
```

---

### 3.3 Correlation Calculations

**Data Source:** `card_price_history` table + calculated indices

**Implementation:**

```typescript
// app/lib/data-collection/services/correlation.server.ts

import { pearsonCorrelation } from './math-utils.server';

interface CorrelationResult {
  cardId: string;
  correlationToSet: number;
  correlationToRarity: number;
  correlationDeviation: number;
}

export async function calculateCorrelations(
  cardHistory: Array<{ date: Date; price: number }>,
  setIndexHistory: Array<{ date: Date; value: number }>,
  rarityIndexHistory: Array<{ date: Date; value: number }>
): Promise<CorrelationResult> {
  // Align dates
  const cardPrices = cardHistory.map(h => h.price);
  const setValues = alignToCardDates(setIndexHistory, cardHistory);
  const rarityValues = alignToCardDates(rarityIndexHistory, cardHistory);

  const correlationToSet = pearsonCorrelation(cardPrices, setValues);
  const correlationToRarity = pearsonCorrelation(cardPrices, rarityValues);

  // Deviation = how different this card behaves from expected
  const expectedCorrelation = (correlationToSet + correlationToRarity) / 2;
  const correlationDeviation = Math.abs(correlationToSet - correlationToRarity);

  return {
    cardId: cardHistory[0].cardId,
    correlationToSet,
    correlationToRarity,
    correlationDeviation,
  };
}

// Pearson correlation coefficient
function pearsonCorrelation(x: number[], y: number[]): number {
  if (x.length !== y.length || x.length < 3) return 0;

  const n = x.length;
  const sumX = x.reduce((a, b) => a + b, 0);
  const sumY = y.reduce((a, b) => a + b, 0);
  const sumXY = x.reduce((sum, xi, i) => sum + xi * y[i], 0);
  const sumX2 = x.reduce((sum, xi) => sum + xi * xi, 0);
  const sumY2 = y.reduce((sum, yi) => sum + yi * yi, 0);

  const numerator = n * sumXY - sumX * sumY;
  const denominator = Math.sqrt(
    (n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY)
  );

  return denominator === 0 ? 0 : numerator / denominator;
}
```

---

## 4. Alternative Data Sources (Explore Later)

### 4.1 eBay Browse API

**Potential Use:** Real sales volume data
**Cost:** Free tier (5,000 calls/day)
**Limitations:** Requires OAuth app registration, rate limited

**Data Available:**
- Sold item count (completed listings)
- Price distribution of sales
- Actual transaction prices

**Integration Complexity:** HIGH - Requires OAuth flow, item matching logic

### 4.2 TCGplayer API (Direct)

**Potential Use:** Official market data, listing counts
**Cost:** Free tier available, higher tiers paid
**Limitations:** Requires application approval, strict rate limits

**Data Available:**
- Official market prices
- Sales velocity
- Listing counts

**Integration Complexity:** MEDIUM - Well-documented API, need approval

### 4.3 Scryfall (MTG only)

**Not applicable** - One Piece TCG not covered

---

## 5. Implementation Roadmap

### Phase 1: Capture Existing Data (1-2 days)

1. **Update Cardmarket CSV parser** to extract "Available Items"
   - File: `app/lib/data-collection/clients/cardmarket-csv.server.ts`
   - Add `availableItems` and `availableFoils` fields

2. **Update JustTCG collector** to capture listings count
   - File: `app/lib/data-collection/clients/justtcg.server.ts`
   - Extract variant count as proxy for activity

3. **Update PriceHistoryDaily aggregation** to populate existing fields
   - File: `app/lib/data-collection/services/price-aggregator.server.ts`
   - Populate `usListingsCount` and `euListingsCount`

### Phase 2: Implement Calculated Features (2-3 days)

4. **Create statistics service** for rarity percentiles
   - New file: `app/lib/data-collection/services/statistics.server.ts`
   - Daily job to compute rarity price distributions

5. **Create correlation service** for set/rarity correlations
   - New file: `app/lib/data-collection/services/correlation.server.ts`
   - Daily job to compute correlations

### Phase 3: Update Feature Calculator (1 day)

6. **Update FeatureCalculator** to use real data
   - File: `app/lib/neural/features.server.ts`
   - Replace hardcoded values with data lookups

### Phase 4: Validation (1 day)

7. **Add tests** for new data collection
8. **Verify feature distributions** are reasonable
9. **Re-export training data** with fixed features

---

## 6. Database Schema Additions

```prisma
// Add to existing MarketPriceEU model
model MarketPriceEU {
  // ... existing fields ...

  // Inventory signals from Cardmarket CSV
  availableItems    Int?      @map("available_items")
  availableFoils    Int?      @map("available_foils")
}

// Add to existing MarketPriceUS model
model MarketPriceUS {
  // ... existing fields ...

  // Volume/activity signals from JustTCG
  listingsCount       Int?      @map("listings_count")
  conditionsAvailable Int?      @map("conditions_available")
}

// New: Pre-computed statistics for feature calculation
model RarityStatistics {
  id              Int      @id @default(autoincrement())
  game            String   @default("onepiece")
  rarity          String   @db.VarChar(50)

  // Price distribution percentiles
  p10             Decimal  @db.Decimal(10, 2)
  p25             Decimal  @db.Decimal(10, 2)
  p50             Decimal  @db.Decimal(10, 2)
  p75             Decimal  @db.Decimal(10, 2)
  p90             Decimal  @db.Decimal(10, 2)
  p95             Decimal  @db.Decimal(10, 2)
  p99             Decimal  @db.Decimal(10, 2)

  // Momentum
  momentum7d      Decimal? @map("momentum_7d") @db.Decimal(6, 4)
  momentum30d     Decimal? @map("momentum_30d") @db.Decimal(6, 4)

  // Card count in this rarity
  cardCount       Int      @map("card_count")

  // Snapshot date
  snapshotDate    DateTime @map("snapshot_date") @db.Date
  createdAt       DateTime @default(now()) @map("created_at")

  @@unique([game, rarity, snapshotDate])
  @@index([game, snapshotDate])
  @@map("rarity_statistics")
}

model SetStatistics {
  id              Int      @id @default(autoincrement())
  game            String   @default("onepiece")
  setCode         String   @map("set_code") @db.VarChar(20)

  // Price distribution
  avgPrice        Decimal  @map("avg_price") @db.Decimal(10, 2)
  medianPrice     Decimal  @map("median_price") @db.Decimal(10, 2)
  totalMarketCap  Decimal  @map("total_market_cap") @db.Decimal(14, 2)

  // Momentum
  momentum7d      Decimal? @map("momentum_7d") @db.Decimal(6, 4)
  momentum30d     Decimal? @map("momentum_30d") @db.Decimal(6, 4)

  // Card count
  cardCount       Int      @map("card_count")

  // Snapshot date
  snapshotDate    DateTime @map("snapshot_date") @db.Date
  createdAt       DateTime @default(now()) @map("created_at")

  @@unique([game, setCode, snapshotDate])
  @@index([game, snapshotDate])
  @@map("set_statistics")
}
```

---

## 7. Cost Analysis

| Source | Current Cost | Additional Cost | Value |
|--------|--------------|-----------------|-------|
| JustTCG API | $50/month | $0 | Capture existing data better |
| Cardmarket CSV | $0 | $0 | Add column parsing |
| OPTCG API | $0 | $0 | Already captured |
| eBay API | N/A | $0 (free tier) | Future consideration |
| TCGplayer API | N/A | TBD | Future consideration |

**Recommendation:** No additional paid sources needed. Focus on maximizing value from JustTCG subscription by capturing all available data fields.

---

## 8. Success Metrics

After implementation, verify:

1. **`relative_volume` distribution**: Should vary from 0.2 to 3.0 (log scale of listings relative to average)
2. **`inventory_signal` distribution**: Should vary from -1 to +1 (below/above average listings)
3. **`rarity_momentum` distribution**: Should vary from -0.3 to +0.3 (percentage change)
4. **`correlation_to_set`**: Should vary from -0.5 to +1.0 (most cards should be 0.5+)
5. **`percentile_in_rarity`**: Should be uniformly distributed 0-1

If any feature has constant or near-constant values, the implementation has failed.

---

## Conclusion

The pipeline has been collecting valuable data that isn't being used. By:
1. Parsing additional Cardmarket CSV columns (0 cost)
2. Extracting more JustTCG data (0 cost, already paid)
3. Computing statistics from existing history data (0 cost)

We can fill **all 7 feature gaps** without any additional API costs or integrations.

**Next Step:** Begin Phase 1 implementation with Cardmarket CSV parser enhancement.
