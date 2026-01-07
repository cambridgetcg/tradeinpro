# Price System Fix Implementation Plan

**Date:** 2026-01-07
**Status:** Ready for Implementation

---

## Issues to Resolve

### Issue 1: CardPriceHistory Decimal Overflow (Critical)
- **Impact:** Daily card snapshots completely failing
- **Cause:** `change` column is `Decimal(8,4)`, max value 9999.9999%
- **Cards affected:** 11 manga variants with >15,000% changes
- **Fix:** Cap change values to ±9999% in code

### Issue 2: JP Price Sync Cron Failing (Critical)
- **Impact:** JP prices stale for 8 days (manually fixed today)
- **Cause:** Vercel Deployment Protection blocking cron requests
- **Fix:** Change deployment protection settings in Vercel dashboard
- **Note:** This is a configuration change, not a code change

### Issue 3: No Staleness Monitoring (Medium)
- **Impact:** Silent failures go unnoticed
- **Cause:** No alerting when data becomes stale
- **Fix:** Add staleness indicators to admin dashboard

### Issue 4: Unused Database Indexes (Low)
- **Impact:** 6.3 MB wasted storage, minor overhead
- **Cause:** Indexes created but never queried
- **Fix:** Remove via Prisma migration

---

## Implementation Order

```
Phase 1: Critical Fixes (Code Changes)
├── 1.1 Fix decimal overflow in takeCardPriceSnapshots()
├── 1.2 Run manual snapshot to verify fix
└── 1.3 Verify 1000 cards snapshotted

Phase 2: Monitoring (Code Changes)
├── 2.1 Add staleness check to dashboard loader
└── 2.2 Add warning banner to dashboard UI

Phase 3: Database Cleanup (Migration)
├── 3.1 Create migration to drop unused indexes
└── 3.2 Apply migration

Phase 4: Verification
├── 4.1 Test all cron endpoints manually
├── 4.2 Verify dashboard shows correct status
└── 4.3 Document completion
```

---

## Detailed Implementation

### Phase 1.1: Fix Decimal Overflow

**File:** `app/lib/price-index.server.ts`
**Function:** `takeCardPriceSnapshots()`
**Line:** ~466

**Current code:**
```typescript
const change = prevPrice > 0 ? ((price - prevPrice) / prevPrice) * 100 : 0;
```

**Fixed code:**
```typescript
const rawChange = prevPrice > 0 ? ((price - prevPrice) / prevPrice) * 100 : 0;
const change = Math.max(-9999.9999, Math.min(9999.9999, rawChange));
```

### Phase 2.1: Add Staleness Check

**File:** `app/routes/app._index.tsx`
**Location:** Loader function

**Add to loader:**
```typescript
// Check data freshness
const [jpLatest, enLatest, historyLatest] = await Promise.all([
  prisma.japanesePriceSource.findFirst({
    orderBy: { updatedAt: 'desc' },
    select: { updatedAt: true }
  }),
  prisma.cardPriceV2.findFirst({
    where: { language: 'EN' },
    orderBy: { lastUpdated: 'desc' },
    select: { lastUpdated: true }
  }),
  prisma.cardPriceHistory.findFirst({
    orderBy: { snapshotDate: 'desc' },
    select: { snapshotDate: true }
  }),
]);

const now = Date.now();
const staleness = {
  jpPrices: jpLatest ? (now - jpLatest.updatedAt.getTime()) / (1000 * 60 * 60) : null,
  enPrices: enLatest ? (now - enLatest.lastUpdated.getTime()) / (1000 * 60 * 60) : null,
  history: historyLatest ? (now - historyLatest.snapshotDate.getTime()) / (1000 * 60 * 60) : null,
};
```

### Phase 3.1: Remove Unused Indexes

**Migration SQL:**
```sql
DROP INDEX IF EXISTS idx_card_history_jpy;
DROP INDEX IF EXISTS idx_card_prices_tradein_gbp;
DROP INDEX IF EXISTS idx_card_prices_market_gbp;
```

---

## Verification Steps

1. After Phase 1: Run `npx tsx` script to verify 1000 cards snapshotted
2. After Phase 2: Check dashboard shows staleness warnings
3. After Phase 3: Verify database size reduced by ~6 MB
4. Full test: Wait for next cron cycle and verify automatic execution

---

## Rollback Plan

If issues occur:
1. Decimal fix: Revert single line change
2. Staleness monitoring: Remove new code block
3. Index removal: Recreate indexes (schema has definitions)

All changes are isolated and reversible.
