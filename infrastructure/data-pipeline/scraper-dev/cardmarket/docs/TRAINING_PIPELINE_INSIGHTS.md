# Training Pipeline Insights

> **Generated**: 2026-01-09
> **Status**: 🟢 Infrastructure Complete, Data Bootstrapping
> **Next Milestone**: LSTM Model Training

---

## Executive Summary

The TCG Neural Network training pipeline has reached a critical milestone. With the completion of:
1. eBay historical data collection (3,906 listings)
2. Daily snapshot infrastructure
3. Historical data bootstrapping scripts

The system is now capable of generating the 30-timestep × 45-feature sequences required for LSTM training.

---

## Data Pipeline Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         TRAINING DATA PIPELINE                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  DATA SOURCES                  TRANSFORMATION                 OUTPUT        │
│  ────────────                  ──────────────                 ──────        │
│                                                                              │
│  ┌─────────────┐                                                            │
│  │   eBay      │──┐                                                         │
│  │   3,906     │  │     ┌─────────────────────┐                            │
│  │   listings  │  ├────▶│   Bootstrap Script  │                            │
│  └─────────────┘  │     │   (30-day history)  │                            │
│                   │     └──────────┬──────────┘                            │
│  ┌─────────────┐  │                │                                        │
│  │  CardMarket │  │                │                                        │
│  │   (future)  │──┤                ▼                                        │
│  └─────────────┘  │     ┌─────────────────────┐     ┌────────────────┐     │
│                   │     │  price_history_     │     │   Training     │     │
│  ┌─────────────┐  │     │     daily           │────▶│   Exporter     │     │
│  │ card_prices │  │     │  30+ days × 975+    │     │   (NDJSON)     │     │
│  │   _v2       │──┘     │     cards           │     └───────┬────────┘     │
│  │   1,000     │        └─────────────────────┘             │              │
│  │   cards     │                                            ▼              │
│  └─────────────┘                                   ┌────────────────┐      │
│                                                    │   S3 / Local   │      │
│  ┌─────────────┐                                   │   Training     │      │
│  │  Snapshot   │─────────────────────────────────▶│   Dataset      │      │
│  │  Lambda     │  Daily capture                   └────────────────┘      │
│  │  (2x/day)   │                                                           │
│  └─────────────┘                                                           │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Key Insights

### 🔬 Data Quality Analysis

#### eBay Collection Quality

| Metric | Value | Assessment |
|--------|-------|------------|
| Total listings | 3,906 | Good volume |
| Unique cards | 460 | Strong coverage |
| Character extraction | ~85% | Acceptable |
| Price confidence | High | Direct USD conversion |
| Duplicate rate | 0% | By listing ID |

#### Price Distribution Insights

```
Percentile Distribution (USD):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  P10   │ $9.64    │ Entry-level variants
  P25   │ $18.50   │ Common parallels
  P50   │ $43.15   │ Median market price
  P75   │ $107.00  │ High-demand cards
  P90   │ $212.62  │ Premium variants
  P99   │ $650.00  │ Chase cards
  MAX   │ $980.06  │ Graded/ultra-rare
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### 📊 Variant Economics

| Variant | Avg Price | Volume | Arbitrage Potential |
|---------|-----------|--------|---------------------|
| manga | $403.29 | 124 | 🔴 HIGH (scarcity + value) |
| wantedposter | $372.74 | 11 | 🔴 HIGH (ultra-scarce) |
| sp | $233.66 | 203 | 🟡 MEDIUM (cross-set) |
| leader | $91.65 | 986 | 🟡 MEDIUM (stable demand) |
| sec | $89.93 | 332 | 🟡 MEDIUM (rarity) |
| promo | $77.47 | 136 | 🟢 LOW (predictable) |
| parallel | $55.86 | 1,596 | 🟢 LOW (high volume) |
| standard | $46.67 | 499 | 🟢 LOW (baseline) |

### 🌍 Language Premium Analysis

| Language | Listings | Avg Premium vs JP | Market Share |
|----------|----------|-------------------|--------------|
| EN | 3,232 | +35-50% | 82.7% |
| JP | 643 | Baseline | 16.5% |
| ZH | 27 | +20-30% (rare) | 0.7% |

**Key Finding**: English variants consistently command 35-50% premium over Japanese equivalents. This creates systematic arbitrage opportunity for JP→EN conversion timing.

---

## Training Feature Engineering

### 45-Feature Vector Design

The training pipeline generates 45 features per timestep, organized into 5 categories:

#### 1. Price Features (12)
```
current_gbp           - Current price in GBP
current_eur           - Current price in EUR
spread_trend_from     - Spread between trend and from price
spread_7d_trend       - 7-day to trend spread
spread_30d_7d         - 30-day to 7-day spread
distance_from_best    - Distance from best price
jp_en_gap_pct         - JP/EN price gap percentage
fx_adjusted_gap       - FX-adjusted arbitrage gap
tradein_margin        - Trade-in margin (70% of price)
percentile_in_set     - Price percentile within set
percentile_in_rarity  - Price percentile within rarity
price_to_index_ratio  - Ratio to TCG-100 index
```

#### 2. Temporal Features (15)
```
velocity_1d           - 1-day price velocity
velocity_7d           - 7-day price velocity
velocity_30d          - 30-day price velocity
acceleration_7d       - 7-day acceleration
volatility_7d         - 7-day volatility (std dev)
volatility_30d        - 30-day volatility
volatility_ratio      - 30d/7d volatility ratio
trend_strength        - Trend strength (absolute)
trend_direction       - Trend direction (+1/-1)
mean_reversion_dist   - Distance from 30-day mean
days_since_high       - Days since period high
days_since_low        - Days since period low
streak_length         - Consecutive up/down days
seasonality_index     - Day-of-week effect
momentum_rsi          - Relative Strength Index
```

#### 3. Market Features (10)
```
set_momentum          - Set-wide price momentum
rarity_momentum       - Rarity-class momentum
game_sentiment        - Overall game sentiment
correlation_to_set    - Correlation to set average
correlation_to_rarity - Correlation to rarity average
correlation_deviation - Deviation from expected correlation
liquidity_score       - Available listings count
volume_relative       - Volume vs historical average
inventory_signal      - Supply/demand imbalance
market_cap_rank       - Rank by total market value
```

#### 4. FX Features (5)
```
jpy_gbp_current       - JPY/GBP exchange rate
eur_gbp_current       - EUR/GBP exchange rate
fx_velocity_7d        - 7-day FX movement
fx_volatility_7d      - 7-day FX volatility
fx_trend_direction    - FX trend direction
```

#### 5. Derived Features (3)
```
opportunity_score     - Composite opportunity signal
risk_score            - Risk assessment
time_sensitivity      - Urgency indicator
```

---

## Deal Type Classification

The LSTM model classifies deals into 10 categories:

| Index | Deal Type | Signal Pattern |
|-------|-----------|----------------|
| 0 | ARBITRAGE_CROSS_MARKET | EU/US price gap >15% |
| 1 | ARBITRAGE_CURRENCY | JP/EN gap with FX adjustment |
| 2 | UNDERVALUED_STATISTICAL | >15% below 30-day mean |
| 3 | UNDERVALUED_COMPARATIVE | <25th percentile vs peers |
| 4 | MOMENTUM_BREAKOUT | >2%/day acceleration |
| 5 | MOMENTUM_REVERSAL | RSI <30 or >70 |
| 6 | SUPPLY_SHOCK | Inventory depletion signal |
| 7 | DEMAND_SURGE | >2x relative volume spike |
| 8 | CORRELATION_BREAK | >1.5 std dev from set/rarity |
| 9 | SEASONAL_OPPORTUNITY | Tournament season patterns |

---

## Infrastructure Status

### Scripts Created

| Script | Purpose | Status |
|--------|---------|--------|
| `scripts/snapshot-history.ts` | Daily price capture | ✅ Ready |
| `scripts/bootstrap-historical-data.ts` | Historical backfill | 🔄 Running |
| `scripts/upload-ebay-s3.ts` | S3 data lake upload | ✅ Ready |
| `src/pipeline/training-exporter.ts` | Feature engineering | ✅ Ready |

### Database State

| Table | Records | Status |
|-------|---------|--------|
| card_prices_v2 | 1,000 | ✅ Populated |
| price_history_daily | ~30,000 | 🔄 Bootstrapping |

### Expected Post-Bootstrap

After bootstrap completes:
- **Cards**: 975+ unique cards (460 eBay + 515 card_prices_v2)
- **Days**: 31 days of history
- **Records**: ~30,225 price history entries
- **Training Examples**: ~29,250 (975 cards × 30 sliding windows)

---

## Next Steps

### Immediate (Today)

1. ✅ Bootstrap historical data (running)
2. ⏳ Verify bootstrap completion
3. ⏳ Run training exporter
4. ⏳ Validate training dataset

### Short-term (This Week)

5. Configure Lambda for daily snapshots
6. Acquire residential proxy for CardMarket
7. Fill manga variant coverage gap
8. Begin LSTM model training

### Medium-term (Next 2 Weeks)

9. Deploy trained model to production
10. Integrate with deal identification API
11. Set up monitoring and alerting
12. Launch alpha neural deal detection

---

## Risk Assessment

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Synthetic history divergence | Medium | Low | Bounded variance ±2%/day |
| Manga variant gap | High | Medium | Priority collection campaign |
| CardMarket blocking | Medium | Medium | Proxy acquisition |
| FX rate changes | Low | High | Daily rate refresh |
| Model overfitting | Medium | Medium | 70/15/15 train/val/test split |

---

## Appendix: Variance Parameters

The bootstrap script uses these parameters for synthetic price generation:

```typescript
const VARIANCE = {
  dailyVolatility: 0.02,      // 2% daily volatility
  trendBias: 0.001,           // 0.1% upward trend per day
  meanReversion: 0.1,         // 10% mean reversion strength
};
```

These values are calibrated from observed TCG market behavior:
- Daily volatility of 1-3% is typical for variant cards
- Slight upward trend reflects general market appreciation
- Mean reversion prevents runaway prices in synthetic data

---

## Related Documentation

- [DATA_COLLECTION_STATUS.md](./DATA_COLLECTION_STATUS.md) - Collection status
- [EBAY_COLLECTION_INSIGHTS.md](./EBAY_COLLECTION_INSIGHTS.md) - eBay analysis
- [NEURAL_ARCHITECTURE.md](./NEURAL_ARCHITECTURE.md) - Neural network design
- [Training Exporter](../src/pipeline/training-exporter.ts) - Feature code

---

*Generated by TCG Data Pipeline - Neural Network Training System*

**[>>> Documentation Index <<<](./INDEX.md)** | *Navigate all TCG pipeline documentation*
