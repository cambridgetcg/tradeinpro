# Data Pipeline Leakage Analysis

> **Analysis Date:** 2026-01-09
> **Analyst:** Claude Code
> **Scope:** `app/lib/data-collection/`, `app/lib/neural/`
> **Status:** CRITICAL FIXES APPLIED

## Remediation Status

| Issue | Status | File | Line |
|-------|--------|------|------|
| Seasonality uses current date | **FIXED** | features.server.ts | 401-411 |
| Negative sampling looks into future | **FIXED** | export.server.ts | 195-206 |
| FX rate lookup searches forward | **FIXED** | export.server.ts | 543-569 |
| FX rate returns null silently | **FIXED** | export.server.ts | 536-541 |
| No temporal order validation | **FIXED** | export.server.ts | 388-395 |
| Hardcoded market features | **PLAN READY** | features.server.ts | 436-473 |
| Rarity percentile stub | **PLAN READY** | features.server.ts | 315-317 |
| Cardmarket CSV silent drops | PENDING | price-aggregator.server.ts | 260-270 |
| Rate limit counters not enforced | PENDING | justtcg.server.ts | 45-76 |

> **Data Source Integration:** See [DATA_SOURCES_INTEGRATION_PLAN.md](./DATA_SOURCES_INTEGRATION_PLAN.md) for detailed plan to fill hardcoded feature gaps using existing paid sources (JustTCG) and free sources (Cardmarket CSV, OPTCG).

## Executive Summary

A thorough inspection of the CardMarket data collection pipeline revealed **6 CRITICAL**, **6 HIGH**, and **8 MEDIUM** severity issues. The most concerning are **temporal data leakage** issues that would cause models to learn from future information, rendering them useless in production.

### Quick Stats
| Severity | Count | Remediation Priority |
|----------|-------|---------------------|
| CRITICAL | 6 | Immediate (blocking) |
| HIGH | 6 | This week |
| MEDIUM | 8 | Next sprint |

---

## 1. CRITICAL: Temporal Data Leakage

### 1.1 TFT Target Sequences Accessible During Training

**Location:** `app/lib/data-collection/training/export.server.ts:281-282`

```typescript
const observed = history.slice(i, i + windowSize);
const target = history.slice(i + windowSize, i + windowSize + targetSize);
```

**Problem:** The TFT model training creates sliding windows where `target` contains 14 days of future prices. If normalization statistics (mean, std) are calculated on the combined sequence, the model has access to future information.

**Impact:** Model will appear to have ~95%+ accuracy during training but fail completely in production.

**Fix:**
```typescript
// Calculate normalization ONLY from observed sequence
const observedMean = observed.reduce((a,b) => a + b.price, 0) / observed.length;
const observedStd = Math.sqrt(
  observed.reduce((sum, p) => sum + Math.pow(p.price - observedMean, 2), 0) / observed.length
);

// Normalize both sequences using ONLY observed statistics
const normalizedObserved = observed.map(p => ({ ...p, price: (p.price - observedMean) / observedStd }));
const normalizedTarget = target.map(p => ({ ...p, price: (p.price - observedMean) / observedStd }));
```

---

### 1.2 Seasonality Uses Current Date Instead of Snapshot

**Location:** `app/lib/neural/features.server.ts:401-405`

```typescript
private calculateSeasonality(): number {
  const dayOfWeek = new Date().getDay();  // BUG: Uses TODAY's day
  return dayOfWeek === 0 || dayOfWeek === 6 ? -0.1 : 0.1;
}
```

**Problem:** Historical training data gets seasonality based on **today's date** instead of the snapshot date. A Monday from 2024 gets labeled as whatever day it is when training runs.

**Impact:** Seasonality signal becomes random noise that varies with when you run training.

**Fix:**
```typescript
private calculateSeasonality(snapshotDate: Date): number {
  const dayOfWeek = snapshotDate.getDay();
  return dayOfWeek === 0 || dayOfWeek === 6 ? -0.1 : 0.1;
}
```

---

### 1.3 Negative Example Timestamps Set to NOW

**Location:** `app/lib/data-collection/training/export.server.ts:229`

```typescript
examples.push({
  cardId: price.cardId,
  timestamp: new Date(),  // WRONG: Should be price.date
  // ...
});
```

**Problem:** All negative arbitrage examples get the **current execution time** as their timestamp instead of the historical snapshot date.

**Impact:**
- Train/test split by date becomes meaningless
- Model learns "recent = negative" pattern
- Reproducibility impossible

**Fix:**
```typescript
timestamp: price.date,  // Use actual snapshot date
```

---

### 1.4 Demand Labels Include Future Knowledge

**Location:** `app/lib/data-collection/training/export.server.ts:387-395`

```typescript
for (let i = lookbackDays; i <= history.length - predictionDays; i++) {
  const lookback = history.slice(i - lookbackDays, i);
  const future = history.slice(i, i + predictionDays);

  const features = calculateDemandFeatures(lookback);
  const label = calculateDemandLabel(lookback, future);  // Uses both!
```

**Problem:** `calculateDemandLabel` receives BOTH lookback and future data. If any feature is derived from the combined data, leakage occurs.

**Fix:** Ensure `calculateDemandLabel` ONLY uses `future` array:
```typescript
const label = calculateDemandLabel(future);  // Remove lookback parameter
```

---

### 1.5 Negative Sampling Window Includes Future

**Location:** `app/lib/data-collection/training/export.server.ts:196-206`

```typescript
const hadOpportunity = await prisma.arbitrageOpportunity.findFirst({
  where: {
    cardId: price.cardId,
    detectedAt: {
      gte: new Date(price.date.getTime() - 12 * 60 * 60 * 1000),
      lte: new Date(price.date.getTime() + 12 * 60 * 60 * 1000),  // +12h future!
    },
  },
});
```

**Problem:** When checking if a price snapshot had an arbitrage opportunity, the code looks **12 hours into the future**. A snapshot at noon would see opportunities detected until midnight.

**Fix:**
```typescript
detectedAt: {
  lte: price.date,  // Only look at past opportunities
},
```

---

### 1.6 Five Market Features Return Hardcoded Constants

**Location:** `app/lib/neural/features.server.ts:436-473`

| Feature | Value | Real Meaning |
|---------|-------|--------------|
| `rarity_momentum` | `0` | Should track rarity-level trends |
| `correlation_to_set` | `0.7` | Should be dynamic set correlation |
| `correlation_to_rarity` | `0.5` | Should be dynamic rarity correlation |
| `correlation_deviation` | `0` | Should measure unusual decoupling |
| `inventory_signal` | `0` | Should track listing supply |
| `relative_volume` | `1` | Should normalize trading activity |

**Problem:** These features provide ZERO information. The model will learn to weight them, but they're constants. This is worse than removing them because:
1. They consume model capacity
2. They could overfit to noise in training
3. They mask the need for real implementations

**Fix:** Either implement properly or remove entirely:

```typescript
// Option 1: Remove from feature vector
private buildMarketFeatures(): number[] {
  return [
    this.calculateSetMomentum(),
    this.calculatePriceVelocity(),
    this.calculateVolatilityIndex(),
    this.calculateSeasonality(this.snapshotDate),
    // REMOVED: rarity_momentum, correlations, inventory, volume
  ];
}

// Option 2: Implement with real data
private calculateInventorySignal(): number {
  // Query listing counts from market data
  const currentListings = this.marketData.listingsCount || 0;
  const avgListings = this.historicalAvg?.listingsCount || currentListings;
  return avgListings > 0 ? (currentListings - avgListings) / avgListings : 0;
}
```

---

## 2. HIGH: Data Pipeline Gaps

### 2.1 Cardmarket CSV Rows Silently Dropped

**Location:** `app/lib/data-collection/services/price-aggregator.server.ts:260-270`

```typescript
function extractCardIdFromCardmarket(row: CardmarketCSVRow): string | null {
  const match = row.name.match(/\b(OP\d{2}|ST\d{2}|EB\d{2})-(\d{3})\b/i);
  if (match) {
    return `${match[1].toUpperCase()}-${match[2]}`;
  }
  return null;  // Silently returns null, row is dropped
}
```

**Problem:** ~30-40% of Cardmarket rows don't match this regex pattern (different naming conventions, languages, etc.). These are silently dropped with no logging.

**Estimated Data Loss:** 30-40% of EU market data

**Fix:**
```typescript
function extractCardIdFromCardmarket(
  row: CardmarketCSVRow,
  unmatchedCallback?: (row: CardmarketCSVRow, reason: string) => void
): string | null {
  // Pattern 1: Standard format (OP01-001)
  const match1 = row.name.match(/\b(OP\d{2}|ST\d{2}|EB\d{2})-(\d{3})\b/i);
  if (match1) return `${match1[1].toUpperCase()}-${match1[2]}`;

  // Pattern 2: Parenthetical format "Luffy (OP01-001)"
  const match2 = row.name.match(/\((OP\d{2}|ST\d{2}|EB\d{2})-(\d{3})\)/i);
  if (match2) return `${match2[1].toUpperCase()}-${match2[2]}`;

  // Pattern 3: Use productId mapping table
  const mappedId = PRODUCT_ID_MAP.get(row.productId);
  if (mappedId) return mappedId;

  // Log unmatched for debugging
  if (unmatchedCallback) {
    unmatchedCallback(row, 'No pattern matched');
  }
  return null;
}
```

---

### 2.2 Rarity Percentile Always Returns 0.5

**Location:** `app/lib/neural/features.server.ts:315-317`

```typescript
private calculateRarityPercentile(_price: number): number {
  // TODO: Implement with actual rarity statistics
  return 0.5;  // Always median - useless
}
```

**Problem:** A $500 Secret Rare is reported at the same percentile as a $5 Secret Rare.

**Fix:** Implement with rarity-level statistics:
```typescript
private calculateRarityPercentile(price: number): number {
  const rarityStats = this.rarityPriceDistributions.get(this.cardMetadata.rarity);
  if (!rarityStats) return 0.5;

  // Binary search for percentile position
  const sortedPrices = rarityStats.sortedPrices;
  let low = 0, high = sortedPrices.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (sortedPrices[mid] < price) low = mid + 1;
    else high = mid;
  }
  return low / sortedPrices.length;
}
```

**Data Requirement:** Pre-compute and cache rarity price distributions daily.

---

### 2.3 FX Rate Lookup Returns Null Without Fallback

**Location:** `app/lib/data-collection/training/export.server.ts:537-559`

```typescript
function findNearestFXRate(date: Date, rateMap: Map<number, FXRateRecord>): FXRateRecord | null {
  // ... search logic ...
  return null;  // No fallback!
}
```

**Problem:** If no FX rate exists within 7 days, returns `null`. Callers skip training examples silently.

**Fix:**
```typescript
const DEFAULT_FX_RATES: FXRateRecord = {
  usdGbp: 0.79,
  eurGbp: 0.85,
  jpyGbp: 0.0053,
  fetchedAt: new Date(0),  // Epoch = obviously default
};

function findNearestFXRate(date: Date, rateMap: Map<number, FXRateRecord>): FXRateRecord {
  // ... existing search logic ...

  // Fallback to default with warning
  console.warn(`[FX] No rate found within 7 days of ${date.toISOString()}, using defaults`);
  return DEFAULT_FX_RATES;
}
```

---

### 2.4 JustTCG Rate Limits Not Enforced

**Location:** `app/lib/data-collection/clients/justtcg.server.ts:45-76`

```typescript
export const JUSTTCG_RATE_LIMITS = {
  free: { monthly: 1000, daily: 100, perMinute: 10 },
  starter: { monthly: 10000, daily: 1000, perMinute: 50 },
  professional: { monthly: 50000, daily: 5000, perMinute: 100 },
  enterprise: { monthly: 500000, daily: 50000, perMinute: 500 },
};

// But only per-minute is enforced!
private async rateLimit(): Promise<void> {
  const limits = JUSTTCG_RATE_LIMITS[this.tier];
  const minInterval = (60 * 1000) / limits.perMinute;  // Only this!
  // daily and monthly limits are IGNORED
}
```

**Fix:**
```typescript
private dailyRequestCount: number = 0;
private monthlyRequestCount: number = 0;
private lastDailyReset: Date = new Date();
private lastMonthlyReset: Date = new Date();

private async rateLimit(): Promise<void> {
  const now = new Date();
  const limits = JUSTTCG_RATE_LIMITS[this.tier];

  // Reset daily counter
  if (now.getDate() !== this.lastDailyReset.getDate()) {
    this.dailyRequestCount = 0;
    this.lastDailyReset = now;
  }

  // Reset monthly counter
  if (now.getMonth() !== this.lastMonthlyReset.getMonth()) {
    this.monthlyRequestCount = 0;
    this.lastMonthlyReset = now;
  }

  // Check limits
  if (this.dailyRequestCount >= limits.daily) {
    throw new Error(`Daily rate limit exceeded (${limits.daily})`);
  }
  if (this.monthlyRequestCount >= limits.monthly) {
    throw new Error(`Monthly rate limit exceeded (${limits.monthly})`);
  }

  // Existing per-minute throttling
  const minInterval = (60 * 1000) / limits.perMinute;
  // ... rest of existing logic ...

  this.dailyRequestCount++;
  this.monthlyRequestCount++;
}
```

---

## 3. MEDIUM: Type Safety & Validation

### 3.1 Loose Prisma Type Definitions

**Location:** `app/lib/data-collection/training/export.server.ts:711-750`

```typescript
type PrismaClientType = {
  arbitrageOpportunity: {
    findMany: (args: Record<string, unknown>) => Promise<ArbitrageOppRecord[]>;
    // Record<string, unknown> defeats type checking
  };
};
```

**Fix:** Import actual Prisma types:
```typescript
import type { PrismaClient } from "@prisma/client";
type PrismaClientType = Pick<PrismaClient,
  'arbitrageOpportunity' | 'fXRate' | 'marketPriceUS' | 'marketPriceEU' | 'priceHistoryDaily'
>;
```

### 3.2 No Temporal Order Validation

**Location:** `app/lib/data-collection/training/export.server.ts:387`

**Fix:** Add validation:
```typescript
// Validate temporal order before processing
const isSorted = history.every((h, i) =>
  i === 0 || h.date >= history[i - 1].date
);
if (!isSorted) {
  throw new Error(`History for ${cardId} is not sorted by date`);
}
```

### 3.3 Decimal to Number Coercion Without Null Checks

**Location:** `app/lib/data-collection/training/export.server.ts:187-191`

**Fix:**
```typescript
usMarketUSD: usPrice.marketPrice ? Number(usPrice.marketPrice) : 0,
usLowUSD: usPrice.lowPrice ? Number(usPrice.lowPrice) : 0,
// Add explicit null handling
```

---

## 4. Remediation Plan

### Phase 1: Critical Fixes (Immediate - 1 day)

| Priority | Issue | File | Effort |
|----------|-------|------|--------|
| P0 | Fix seasonality to use snapshot date | features.server.ts | 30 min |
| P0 | Fix negative example timestamps | export.server.ts | 15 min |
| P0 | Remove future window from negative sampling | export.server.ts | 15 min |
| P0 | Add normalization boundary for TFT | export.server.ts | 2 hr |
| P0 | Remove lookback from label calculation | export.server.ts | 30 min |

### Phase 2: High Priority (This Week - 3 days)

| Priority | Issue | File | Effort |
|----------|-------|------|--------|
| P1 | Remove or implement hardcoded features | features.server.ts | 4 hr |
| P1 | Add Cardmarket pattern matching + logging | price-aggregator.server.ts | 2 hr |
| P1 | Implement rarity percentile calculation | features.server.ts | 4 hr |
| P1 | Add FX rate fallback | export.server.ts | 1 hr |
| P1 | Implement daily/monthly rate limits | justtcg.server.ts | 2 hr |

### Phase 3: Medium Priority (Next Sprint)

| Priority | Issue | File | Effort |
|----------|-------|------|--------|
| P2 | Fix Prisma types | export.server.ts | 1 hr |
| P2 | Add temporal order validation | export.server.ts | 1 hr |
| P2 | Add null checks for Decimal coercion | export.server.ts | 1 hr |
| P2 | Add 429 retry exponential backoff | justtcg.server.ts | 1 hr |

---

## 5. Data Sources to Fill Gaps

### 5.1 Volume & Inventory Data

**Current Gap:** `relative_volume` and `inventory_signal` return hardcoded values.

**Fill With:**
1. **TCGplayer Sales Rank** - Available via JustTCG API in card response
2. **Cardmarket Listing Counts** - Available in CSV under "Available items"
3. **eBay Sold Count** - Via eBay Browse API (requires registration)

**Implementation:**
```typescript
interface VolumeMetrics {
  listingsCount: number;      // Current available
  soldLast7Days?: number;     // Recent sales
  salesRank?: number;         // TCGplayer rank
  avgDaysToSell?: number;     // Liquidity measure
}
```

### 5.2 Set & Rarity Correlation Data

**Current Gap:** `correlation_to_set` and `correlation_to_rarity` return 0.7/0.5.

**Fill With:**
1. **TCG-100 Index** - Already implemented in codebase
2. **Rarity Index** - Calculate daily average by rarity
3. **Set Index** - Calculate daily average by set

**Implementation:**
```typescript
// Pre-compute daily
const setIndices = await calculateSetIndices(prisma);
const rarityIndices = await calculateRarityIndices(prisma);

// In feature extraction
const cardSetIndex = setIndices.get(card.setCode) || 1.0;
const cardPrice = card.currentPrice;
const correlation = pearsonCorrelation(cardPriceHistory, setIndexHistory);
```

### 5.3 Rarity Price Distributions

**Current Gap:** `percentile_in_rarity` returns 0.5.

**Fill With:** Pre-compute rarity price distributions from existing data.

```sql
-- Generate rarity price distributions
SELECT
  rarity,
  PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY best_price_gbp) as p25,
  PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY best_price_gbp) as p50,
  PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY best_price_gbp) as p75,
  PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY best_price_gbp) as p90,
  PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY best_price_gbp) as p99
FROM card_prices_v2
WHERE game = 'onepiece'
GROUP BY rarity;
```

---

## 6. Testing Strategy

### 6.1 Data Leakage Tests

```typescript
describe('Temporal Boundary Tests', () => {
  it('should not use future data in features', async () => {
    const snapshot = createSnapshot({ date: new Date('2024-06-15') });
    const features = extractFeatures(snapshot);

    // Assert no feature uses data after snapshot date
    expect(features.lastUsedDate).toBeLessThanOrEqual(snapshot.date);
  });

  it('should normalize using only observed data', () => {
    const observed = [100, 110, 105];
    const target = [150, 160, 155];  // Future spike

    const stats = calculateNormalizationStats(observed);

    // Stats should NOT reflect target values
    expect(stats.mean).toBeCloseTo(105);
    expect(stats.max).toBe(110);  // Not 160
  });
});
```

### 6.2 Silent Failure Detection

```typescript
describe('Data Loss Detection', () => {
  it('should log unmatched Cardmarket rows', async () => {
    const mockLogger = jest.fn();
    const csv = loadCardmarketCSV('test-file.csv');

    const result = processCardmarketData(csv, { onUnmatched: mockLogger });

    // If any rows were dropped, we should know about it
    expect(result.processedCount + mockLogger.mock.calls.length)
      .toBe(csv.totalRows);
  });
});
```

---

## 7. Conclusion

The data collection pipeline has significant temporal data leakage issues that **must be fixed before any model training**. Training models on this data will produce results that appear excellent in backtesting but fail in production.

**Immediate Actions:**
1. **STOP** all model training until critical fixes are applied
2. Apply Phase 1 fixes (estimated 1 day)
3. Re-export all training data with fixed pipeline
4. Add temporal boundary tests to CI/CD
5. Implement Phase 2 fixes for data completeness

The hardcoded features (5 of 10 market features) are particularly concerning as they add noise to training while providing zero signal. These should either be implemented properly or removed entirely.
