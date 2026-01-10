# Data Collection Pipeline - Insights and Understanding

## Executive Summary

This document captures insights accumulated during the execution of the ML data collection pipeline for the CardForum neural deal detection system. The goal is to reach Alpha training readiness (score 40+) by systematically building up the training dataset.

---

## Session: 2026-01-09

### Initial State Assessment

Before executing the pipeline, the system showed:

| Metric | Value | Target | Gap |
|--------|-------|--------|-----|
| Training Readiness Score | 27/100 | 40+ (Alpha) | -13 |
| History Records | 146,901 | 500,000 | -353,099 |
| Cards with 30d+ History | 486 | 800 | -314 |
| Correlation Coverage | 36.6% | 80% | -43.4% |
| Volume Data Coverage | 0 | 500+ cards | -500 |
| Deal Training Examples | 0 | 500+ | -500 |

### Key Blockers Identified

1. **Volume Statistics Empty**: MarketPriceUS and MarketPriceEU tables have no listing counts populated
2. **Low Correlation Coverage**: Only 366/1000 cards have correlation data (need 7+ days history)
3. **No Training Labels**: NeuralDeal table is empty - no supervised learning examples
4. **Feature Default Rate High**: ~40% of market features returning hardcoded values

---

## Pipeline Execution Log

### Step 1: Bootstrap Historical Data

**Command**: `npx tsx scripts/bootstrap-historical-data.ts --days=30`

**Purpose**: Fill gaps in CardPriceHistory to provide continuous price series for feature calculation.

**Observations**:
- [PENDING - will be updated during execution]

### Step 2: Seed Volume Data

**Command**: `npx tsx scripts/seed-volume-data.ts`

**Purpose**: Populate MarketPriceUS/EU with listing counts from JustTCG API and Cardmarket CSV.

**Observations**:
- [PENDING - will be updated during execution]

### Step 3: Compute Statistics

**Command**: `npx tsx scripts/compute-statistics.ts`

**Purpose**: Update rarity distributions, set statistics, and card correlations.

**Observations**:
- [PENDING - will be updated during execution]

### Step 4: Generate Synthetic Deals

**Command**: `npx tsx scripts/generate-synthetic-deals.ts --days=30`

**Purpose**: Create labeled training examples by running rule-based detectors on historical data.

**Observations**:
- [PENDING - will be updated during execution]

---

## Technical Insights

### Data Architecture Understanding

1. **Price Data Flow**:
   ```
   External APIs → CardPriceV2 (current) → CardPriceHistory (daily snapshots)
                                        ↓
                                   Feature Calculator → 45-feature vector
                                        ↓
                                   Rule-based Detectors → NeuralDeal (labels)
   ```

2. **Feature Dependencies**:
   - Price features (12): Depend on CardPriceV2 and multiple source prices
   - Temporal features (15): Require 30-day CardPriceHistory window
   - Market features (10): Need SetStatistics, RarityStatistics, CardCorrelation, VolumeStatistics
   - FX features (5): Require ExchangeRateHistory

3. **Training Data Requirements**:
   - Minimum 14 days history per card for basic features
   - 30 days preferred for full temporal analysis
   - Need both positive (EXECUTED) and negative (EXPIRED) deal examples
   - Balance across 10 deal types important for model generalization

### Database Schema Insights

1. **VolumeStatistics**: Uses `snapshotDate` field (not `computedAt`) - unique on [game, snapshotDate]
2. **CardPriceV2**: Uses `lastUpdated` field (not `updatedAt`) for freshness tracking
3. **NeuralDeal**: Stores both predicted (`expectedReturn`) and actual (`actualReturn`) returns for model feedback

### Feature Calculator Architecture

The FeatureCalculator accepts an optional `ExtendedStatisticsContext` parameter:
```typescript
interface ExtendedStatisticsContext {
  rarityStats?: Map<string, RarityDistribution>;
  volumeStats?: VolumeStats;
  cardCorrelation?: CardCorrelation | null;
  usListingsCount?: number;
  euAvailableItems?: number;
}
```

Without this context, features fall back to hardcoded defaults:
- `correlation_to_set`: 0.7 (default)
- `correlation_to_rarity`: 0.5 (default)
- `volume_relative`: 1.0 (default)
- `inventory_signal`: 0 (default)

---

## Readiness Progression

| Checkpoint | Score | Milestone | Notes |
|------------|-------|-----------|-------|
| Initial | 27/100 | Not Ready | Low correlation, no deals |
| After Bootstrap | TBD | TBD | |
| After Volume Seed | TBD | TBD | |
| After Statistics | TBD | TBD | |
| After Deal Generation | TBD | TBD | |
| Final | TBD | TBD | |

---

## Recommendations for Production

1. **Daily Cron Jobs**:
   ```bash
   0 3 * * * npx tsx scripts/snapshot-history.ts
   0 2 * * * npx tsx scripts/compute-statistics.ts
   0 4 * * * npx tsx scripts/validate-data-quality.ts
   ```

2. **Weekly Assessment**:
   ```bash
   0 5 * * 0 npx tsx scripts/check-readiness.ts --json >> /var/log/readiness.json
   ```

3. **Alerting Thresholds**:
   - Price freshness > 24h: ERROR
   - Correlation coverage < 50%: WARNING
   - Deal type imbalance (any < 10% of max): WARNING
   - Data gaps > 3 days: ERROR

---

## Appendix: Script Reference

| Script | Schedule | Timeout | Purpose |
|--------|----------|---------|---------|
| bootstrap-historical-data.ts | One-time | 30 min | Initial backfill |
| seed-volume-data.ts | Daily | 10 min | Volume metrics |
| compute-statistics.ts | Daily | 30 min | Stats & correlations |
| generate-synthetic-deals.ts | Weekly | 60 min | Training labels |
| snapshot-history.ts | Daily | 5 min | Daily price snapshot |
| validate-data-quality.ts | Daily | 5 min | Quality checks |
| check-readiness.ts | Weekly | 2 min | Training readiness |

