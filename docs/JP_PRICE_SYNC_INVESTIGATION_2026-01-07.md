# Japanese Price Sync Investigation

**Date:** 2026-01-07
**Issue:** Japanese card prices not updating since 2025-12-30

## Summary

The Japanese card trade-in prices stopped updating on December 30, 2025. Investigation revealed the Vercel cron job was not executing, while the S3 data source was being updated correctly. A manual sync resolved the immediate issue.

---

## Findings

### 1. Database State (Before Fix)

| Table | Records | Last Updated |
|-------|---------|--------------|
| JapanesePriceSource | 485 | 2025-12-30 13:30:00 |
| CardPriceV2 (JP) | 485 | 2025-12-30 13:30:00 |
| ExchangeRateHistory | 0 | N/A |

**Gap:** 8 days without price updates

### 2. S3 Data Source (Healthy)

```
s3://pricedata-tcg/pricefeed/onepiece_pricefeed.xlsx
├── Last Modified: 2026-01-07 14:01:04
├── Size: 94.2 KiB
├── Rows: 486
└── Latest Price Column: 2026-01-07
```

The S3 pricefeed is being updated correctly with today's date column containing current JPY prices.

### 3. Data Flow Architecture

```
┌─────────────────────┐
│ CardRush (Source)   │
└─────────┬───────────┘
          │ Daily scrape
          ▼
┌─────────────────────┐
│ S3: pricedata-tcg   │──── WORKING
│ pricefeed/*.xlsx    │
└─────────┬───────────┘
          │ Vercel Cron (0 14 * * *)
          ▼
┌─────────────────────┐
│ /api/cron/          │──── NOT RUNNING
│ jp-price-sync       │
└─────────┬───────────┘
          │ fullS3Sync()
          ▼
┌─────────────────────┐
│ JapanesePriceSource │──── STALE
│ (staging table)     │
└─────────┬───────────┘
          │ syncJapanesePricesToCards()
          ▼
┌─────────────────────┐
│ CardPriceV2 (JP)    │──── STALE
│ (trade-in prices)   │
└─────────────────────┘
```

### 4. Cron Configuration

**vercel.json:**
```json
{
  "crons": [
    {
      "path": "/api/cron/jp-price-sync",
      "schedule": "0 14 * * *"  // Daily at 14:00 UTC
    }
  ]
}
```

**Discrepancy:** Code comments say "every 6 hours" but cron is set for once daily.

### 5. Root Cause Analysis

**Probable causes for cron failure:**

1. **Vercel Pro Plan Requirement:** Vercel crons require a Pro plan or higher. If the plan lapsed or was downgraded, crons stop executing.

2. **CRON_SECRET Authentication:** The endpoint validates `Authorization: Bearer ${CRON_SECRET}`. If this env var is missing or mismatched in production, the cron returns 401.

3. **Function Timeout:** AWS S3 download + 485 DB updates may exceed Vercel's function timeout (default 10s on Hobby, 60s on Pro).

4. **Cold Start Issues:** First invocation after deployment may timeout during Prisma client initialization.

5. **Deployment Disruption:** A deployment on Dec 30 may have interrupted cron registration.

---

## Resolution

### Immediate Fix (Applied)

Manual sync executed successfully:

```bash
npx tsx -e "require('./app/lib/jp-prices.server').fullS3Sync('cambridgetcg.myshopify.com')"
```

**Result:**
- Import: 0 created, 485 updated, 1 skipped (excluded)
- Sync: 0 created, 485 updated, 0 errors
- Duration: ~2 minutes

### Database State (After Fix)

| Table | Records | Last Updated |
|-------|---------|--------------|
| JapanesePriceSource | 485 | 2026-01-07 14:18:18 |
| CardPriceV2 (JP) | 485 | 2026-01-07 14:18:18 |

### Price Change Example

**Card:** OP01-001 (Roronoa Zoro Leader)

| Metric | Before (Dec 30) | After (Jan 7) | Change |
|--------|-----------------|---------------|--------|
| JPY Price | 14,800 | 15,800 | +6.8% |
| GBP (pence) | 7,026 | 7,485 | +6.5% |
| Trade-in GBP | £49.18 | £52.39 | +6.5% |

---

## Recommendations

### Short-term

1. **Verify Vercel Cron Status:**
   ```bash
   vercel crons list
   ```

2. **Check CRON_SECRET in Production:**
   ```bash
   vercel env ls | grep CRON
   ```

3. **Review Vercel Function Logs:**
   - Check for 401 errors (auth failure)
   - Check for timeouts
   - Check for deployment events around Dec 30

4. **Set Up Monitoring:**
   - Add uptime monitoring for `/api/cron/jp-price-sync`
   - Alert if JP prices are >24h stale

### Long-term

1. **Increase Cron Frequency:**
   Change from daily to every 6 hours as originally intended:
   ```json
   "schedule": "0 */6 * * *"
   ```

2. **Add Retry Logic:**
   If S3 download fails, retry with exponential backoff.

3. **Add Staleness Check to Dashboard:**
   Show warning if JP prices are >24h old:
   ```typescript
   const hoursStale = (Date.now() - lastUpdated.getTime()) / (1000 * 60 * 60);
   if (hoursStale > 24) showWarning();
   ```

4. **Consider External Cron:**
   Use a more reliable external service (e.g., AWS EventBridge, Cronitor, EasyCron) to trigger the sync endpoint.

---

## Files Involved

| File | Purpose |
|------|---------|
| `app/lib/jp-prices.server.ts` | Core sync logic, S3 download, DB operations |
| `app/routes/api.cron.jp-price-sync.tsx` | Cron endpoint, auth validation |
| `vercel.json` | Cron schedule configuration |
| `prisma/schema.prisma` | JapanesePriceSource, CardPriceV2 models |

---

## Appendix: S3 Pricefeed Structure

**File:** `s3://pricedata-tcg/pricefeed/onepiece_pricefeed.xlsx`

**Sheets:** ebay_business, ebay_private, cardmarket, cardtrader, shopify

**Columns (ebay_business sheet):**
| Column | Description | Example |
|--------|-------------|---------|
| sku | Card identifier | `OP-OP01-001-JP` |
| 2026-01-07 | Latest JPY price | 15800 |
| base_cost | GBP buy price | 74.85 |
| total_cost | GBP with fees | 95.54 |
| selling_price | GBP selling | 131.80 |
| gbp_to_jpy | Exchange rate | 211.09 |
| ebay_item_number | eBay listing ID | 156846789150 |

**Trade-in Calculation:**
```
trade_in_price = base_cost × 0.70 (NM condition)
               = £74.85 × 0.70
               = £52.40
```
