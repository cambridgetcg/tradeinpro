# eBay Historical Collection Insights

> **Generated**: 2026-01-09T22:33:00Z
> **Source**: SerpAPI eBay Collection
> **Status**: ✅ Complete

---

## Collection Summary

| Metric | Value |
|--------|-------|
| **Total Listings** | 3,906 |
| **Unique Cards** | 460 |
| **Sets Covered** | 43 |
| **Variants** | 9 |
| **Date Range** | Single collection run |

---

## Price Distribution

| Statistic | USD |
|-----------|-----|
| Minimum | $6.27 |
| 10th Percentile | $9.64 |
| Median | $43.15 |
| Average | $88.57 |
| 90th Percentile | $212.62 |
| Maximum | $980.06 |

---

## Variant Coverage Analysis

| Variant | Listings | Unique Cards | Avg Price | Min | Max |
|---------|----------|--------------|-----------|-----|-----|
| parallel | 1,596 | 268 | $55.86 | $6.65 | $963.92 |
| leader | 986 | 81 | $91.65 | $6.74 | $980.06 |
| standard | 499 | 185 | $46.67 | $6.27 | $656.21 |
| sec | 332 | 27 | $89.93 | $6.35 | $597.24 |
| sp | 203 | 63 | $233.66 | $10.87 | $938.53 |
| promo | 136 | 40 | $77.47 | $6.55 | $472.50 |
| manga | 124 | 24 | $403.29 | $9.36 | $963.36 |
| boxtopper | 19 | 7 | $63.03 | $6.41 | $361.95 |
| wantedposter | 11 | 6 | $372.74 | $151.18 | $508.15 |

---

## Set Coverage

| Set | Listings | Notes |
|-----|----------|-------|
| OP01 | 519 | Romance Dawn (highest coverage) |
| OP13 | 397 | Recent set |
| OP09 | 368 | The Four Emperors |
| OP14 | 340 | Newest set |
| OP05 | 247 | Awakening of the New Era |
| OP02 | 247 | Paramount War |
| OP03 | 225 | Pillars of Strength |
| OP12 | 189 | - |
| OP04 | 183 | Kingdoms of Intrigue |
| OP10 | 169 | Royal Blood |
| OP06 | 162 | Wings of the Captain |
| P | 133 | Promo cards |
| OP07 | 127 | 500 Years in the Future |
| OP08 | 117 | Two Legends |
| OP11 | 114 | Emperors in the New World |
| EB01 | 60 | Memorial Collection |

---

## Language Distribution

| Language | Listings | Percentage | Notes |
|----------|----------|------------|-------|
| EN | 3,232 | 82.7% | English commands premium |
| JP | 643 | 16.5% | Japanese originals |
| ZH | 27 | 0.7% | Chinese (rare, high value) |
| KO | 2 | 0.1% | Korean (minimal) |
| FR | 2 | 0.1% | French (minimal) |

---

## Top 10 Highest Priced Listings

| Card ID | Variant | Character | Price | Language | Condition |
|---------|---------|-----------|-------|----------|-----------|
| EB02-010 | leader | Luffy | $980.06 | EN | Pre-owned |
| OP01-002 | parallel | Law | $963.92 | EN | Pre-owned |
| OP06-118 | manga | Zoro | $963.36 | JP | Pre-owned |
| OP01-003 | parallel | Luffy | $946.85 | EN | Pre-owned |
| OP08-106 | sp | Nami | $938.53 | EN | Pre-owned |
| OP09-051 | sp | N/A | $915.50 | EN | Pre-owned |
| OP09-051 | sp | N/A | $915.29 | EN | Pre-owned |
| OP09-051 | sp | N/A | $915.29 | EN | Pre-owned |
| OP09-051 | sp | N/A | $915.29 | EN | Pre-owned |
| OP09-051 | sp | N/A | $915.29 | EN | Pre-owned |

---

## Coverage Gaps (Training Data Priority)

The following variants need additional data collection:

| Variant | Current | Target | Gap | Priority |
|---------|---------|--------|-----|----------|
| 🔴 manga | 24 | 200 | -176 | CRITICAL |
| 🔴 sp | 63 | 150 | -87 | HIGH |
| 🔴 sec | 27 | 100 | -73 | HIGH |
| 🔴 leader | 81 | 150 | -69 | HIGH |
| 🔴 promo | 40 | 100 | -60 | MEDIUM |
| 🔴 wantedposter | 6 | 50 | -44 | MEDIUM |
| 🔴 boxtopper | 7 | 50 | -43 | MEDIUM |
| 🟡 parallel | 268 | 300 | -32 | LOW |

---

## Storage Details

| Property | Value |
|----------|-------|
| **Location** | `data/ebay-historical/` |
| **File** | `historical-collection-2026-01-09T22-25-01-356Z.ndjson.gz` |
| **Size (Raw)** | 4.71 MB |
| **Size (Compressed)** | 1.41 MB |
| **Compression Ratio** | 70.1% |
| **Format** | NDJSON (gzip compressed) |

```
data/ebay-historical/historical-collection-2026-01-09T22-25-01-356Z.ndjson.gz
```

---

## Key Insights

### 🔑 Price Discovery

1. **High-value variants**: Manga art has highest average price ($403.29)
2. **Wanted Poster rarity**: Only 11 listings but averaging $372.74
3. **SP cards**: Strong arbitrage potential ($233.66 avg, wide range)

### 📊 Market Structure

| Insight | Data Point | Implication |
|---------|------------|-------------|
| EN premium | 82.7% of listings | Target English for trade-in |
| OP01 dominance | 519 listings | Mature price discovery |
| Manga scarcity | 24 unique cards | High priority for collection |

### 💰 Arbitrage Opportunities

1. **JP → EN Manga**: Japanese manga cards priced lower, EN editions command premium
2. **SP reprints**: Cross-set reprints show pricing inefficiency
3. **Leader variants**: Consistent demand suggests stable arbitrage margins

### 🎯 Training Data Recommendations

| Priority | Variant | Reason |
|----------|---------|--------|
| 1st | Manga | Highest value, lowest coverage |
| 2nd | SP | Cross-set arbitrage modeling |
| 3rd | SEC | Premium rarity, needs more samples |
| 4th | Boxtopper | Price volatility, limited data |
| 5th | WantedPoster | Ultra-rare, need more signals |

---

## Data Quality Notes

1. **Character extraction**: ~85% success rate on character name parsing
2. **Condition normalization**: eBay conditions mapped to NM/LP/MP/HP
3. **Price confidence**: High (direct GBP→USD conversion, no estimation)
4. **Deduplication**: By listing ID, 3,906 unique records

---

## Next Steps

1. ✅ eBay historical data collected and stored
2. ✅ Coverage analysis completed
3. ⏳ Merge with CardMarket data for cross-marketplace analysis
4. ⏳ Build unified training dataset (30-timestep sequences)
5. ⏳ Address manga variant gap (priority collection)
6. ⏳ Train LSTM model on combined data

---

## Related Documentation

- [SerpAPI Alchemist Grimoire](./SERPAPI_ALCHEMIST_GRIMOIRE.md) - eBay collection methodology
- [CardMarket Alchemist Grimoire](./CARDMARKET_ALCHEMIST_GRIMOIRE.md) - CardMarket scraping
- [Neural Architecture](./NEURAL_ARCHITECTURE.md) - ML model design
- [Training Exporter](../src/pipeline/training-exporter.ts) - Feature engineering

---

*Generated by TCG Data Pipeline - Neural Network Training System*

**[>>> Documentation Index <<<](./INDEX.md)** | *Navigate all TCG pipeline documentation*
