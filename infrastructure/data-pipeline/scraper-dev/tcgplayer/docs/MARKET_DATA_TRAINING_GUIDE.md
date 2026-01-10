# TCG Market Data Training Guide

> **Research Date**: January 2026
> **Purpose**: Organize market data from multiple sources for ML model training
> **Focus Areas**: Trends, Volume, Price Depth, Market Dynamics

---

## 1. Executive Summary

This document outlines a comprehensive strategy for distilling market data from multiple TCG pricing sources into training-ready datasets. The approach captures:

1. **Price Depth** - Multi-tier pricing (low/mid/high/market) for spread analysis
2. **Temporal Trends** - 7d/30d/90d/180d price movements and seasonality
3. **Volume Proxies** - Market cap, listing counts, turnover indicators
4. **Cross-Market Arbitrage** - TCGplayer vs Cardmarket price differentials
5. **Volatility Metrics** - Standard deviation, beta coefficients, drawdowns
6. **Correlation Networks** - Card-to-card and set-to-set price relationships

---

## 2. Data Source Matrix

### 2.1 Available Sources and Their Signals

| Source | Games | Price Points | Historical | Volume | Condition | Update Freq |
|--------|-------|--------------|------------|--------|-----------|-------------|
| **OPTCG API** | One Piece | Market | 2 weeks | None | None | Daily |
| **JustTCG API** | 13 games | Market | 180 days | None | 5 grades | Multi-daily |
| **Pokemon TCG API** | Pokemon | Low/Mid/High/Market | None | None | 5 variants | Daily |
| **Scryfall** | MTG | USD/EUR/Foil | None | None | Finishes | Daily |
| **Cardmarket** | Multi | Avg/Low/Trend | Limited | Listings | 5 grades | Daily |
| **TCGplayer (Direct)** | Multi | Low/Mid/High/Market | Limited | Listings | 6 grades | Real-time |

### 2.2 Signal Richness by Source

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        MARKET SIGNAL COVERAGE                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  OPTCG API ████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 20%                     │
│  └─ Market price only, no depth or volume                                   │
│                                                                              │
│  JustTCG  ████████████████████████░░░░░░░░░░░░░░░░ 60%                     │
│  └─ Historical data + condition variants                                    │
│                                                                              │
│  Pokemon  ████████████████████░░░░░░░░░░░░░░░░░░░░ 50%                     │
│  └─ Price depth + dual market (TCG/CM)                                      │
│                                                                              │
│  Scryfall ████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 30%                     │
│  └─ Multi-currency + foil variants                                          │
│                                                                              │
│  TCGplayer████████████████████████████████░░░░░░░░ 80%                     │
│  └─ Full depth + volume + conditions (if scraped)                           │
│                                                                              │
│  Cardmarket███████████████████████████░░░░░░░░░░░░ 70%                     │
│  └─ Trend + volume + European pricing                                       │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Price Depth Analysis

### 3.1 Multi-Tier Pricing Structure

TCG markets exhibit significant price dispersion. Capturing multiple price tiers enables:

- **Spread Analysis**: Bid-ask spread proxy (low vs market)
- **Liquidity Assessment**: Narrow spreads = high liquidity
- **Fair Value Estimation**: Weighted average across tiers
- **Arbitrage Detection**: Cross-tier and cross-market opportunities

```typescript
interface PriceDepthFeatures {
  // Raw price tiers
  lowPrice: number;
  midPrice: number;
  highPrice: number;
  marketPrice: number;

  // Derived spreads
  lowToMarketSpread: number;     // (market - low) / market
  bidAskProxy: number;           // (high - low) / market
  depthRatio: number;            // mid / market (1.0 = balanced)

  // Cross-market (if available)
  tcgplayerPrice: number;
  cardmarketPrice: number;
  crossMarketSpread: number;     // % difference between markets
  arbitrageSignal: number;       // -1 to 1 (negative = buy TCG, sell CM)
}
```

### 3.2 Price Depth Data Collection

**Pokemon TCG API Response:**
```json
{
  "tcgplayer": {
    "prices": {
      "normal": { "low": 0.15, "mid": 0.30, "high": 0.75, "market": 0.28 },
      "holofoil": { "low": 1.20, "mid": 2.50, "high": 5.00, "market": 2.35 },
      "reverseHolofoil": { "low": 0.80, "mid": 1.50, "high": 3.00, "market": 1.42 }
    }
  },
  "cardmarket": {
    "prices": {
      "averageSellPrice": 0.25,
      "lowPrice": 0.12,
      "trendPrice": 0.28
    }
  }
}
```

**Training Feature Extraction:**
```python
def extract_price_depth_features(card):
    prices = card.get('tcgplayer', {}).get('prices', {})
    cm = card.get('cardmarket', {}).get('prices', {})

    features = {}

    for variant, p in prices.items():
        if p:
            low, mid, high, market = p['low'], p['mid'], p['high'], p['market']
            features[f'{variant}_low_to_market'] = (market - low) / market if market else 0
            features[f'{variant}_bid_ask'] = (high - low) / market if market else 0
            features[f'{variant}_depth_ratio'] = mid / market if market else 1.0

            # Cross-market arbitrage (convert EUR to USD)
            if cm.get('averageSellPrice'):
                cm_usd = cm['averageSellPrice'] * 1.09  # EUR to USD
                features[f'{variant}_cross_market_spread'] = (market - cm_usd) / market

    return features
```

---

## 4. Temporal Trend Analysis

### 4.1 Time Series Features

Price movements over time reveal:

- **Momentum**: Short-term price direction
- **Mean Reversion**: Tendency to return to average
- **Seasonality**: Set release cycles, tournament impacts
- **Trend Strength**: Sustained vs temporary moves

```typescript
interface TrendFeatures {
  // Short-term (momentum)
  change1d: number;              // Daily % change
  change7d: number;              // Weekly % change
  momentum7d: number;            // 7-day price velocity

  // Medium-term (swing)
  change30d: number;             // Monthly % change
  change90d: number;             // Quarterly % change
  macdSignal: number;            // MACD histogram proxy

  // Long-term (trend)
  change180d: number;            // Semi-annual % change
  trendDirection: -1 | 0 | 1;    // Bearish/Neutral/Bullish
  trendStrength: number;         // 0-1 (weak to strong)

  // Reversion signals
  zScore: number;                // Standard deviations from mean
  percentile90d: number;         // Position in 90-day range

  // Seasonality
  dayOfWeek: number;             // 0-6
  weekOfMonth: number;           // 1-4
  daysFromSetRelease: number;    // Days since set launched
  daysToNextSet: number;         // Days until next set
}
```

### 4.2 Historical Data from JustTCG

**JustTCG provides built-in historical metrics:**
```json
{
  "variants": [{
    "condition": "Near Mint",
    "printing": "Normal",
    "price": { "usd": 45.99, "updated_at": "2026-01-08T00:00:00Z" },
    "history": {
      "7d": 42.50,      // Price 7 days ago
      "30d": 38.00,     // Price 30 days ago
      "90d": 52.00,     // Price 90 days ago
      "180d": 65.00     // Price 180 days ago
    }
  }]
}
```

**Trend Feature Calculation:**
```python
def extract_trend_features(variant):
    current = variant['price']['usd']
    history = variant.get('history', {})

    features = {}

    # Calculate returns
    for period in ['7d', '30d', '90d', '180d']:
        if history.get(period):
            past = history[period]
            returns = (current - past) / past
            features[f'return_{period}'] = returns

    # Momentum (rate of change)
    if history.get('7d') and history.get('30d'):
        short_return = (current - history['7d']) / history['7d']
        long_return = (current - history['30d']) / history['30d']
        features['momentum'] = short_return - (long_return / 4.28)  # Normalize by time

    # Mean reversion signal
    if history.get('90d'):
        mean_90d = (current + history.get('30d', current) + history.get('90d', current)) / 3
        features['z_score'] = (current - mean_90d) / (abs(current - mean_90d) + 0.01)

    # Trend classification
    if all(history.get(p) for p in ['7d', '30d', '90d']):
        if current > history['7d'] > history['30d'] > history['90d']:
            features['trend_direction'] = 1  # Strong uptrend
        elif current < history['7d'] < history['30d'] < history['90d']:
            features['trend_direction'] = -1  # Strong downtrend
        else:
            features['trend_direction'] = 0  # Choppy/sideways

    return features
```

### 4.3 Building Price History from Snapshots

When historical APIs are unavailable, construct from daily snapshots:

```sql
-- Calculate trend features from CardPriceHistory table
WITH price_changes AS (
  SELECT
    card_id,
    price_gbp,
    snapshot_date,
    LAG(price_gbp, 1) OVER (PARTITION BY card_id ORDER BY snapshot_date) as price_1d_ago,
    LAG(price_gbp, 7) OVER (PARTITION BY card_id ORDER BY snapshot_date) as price_7d_ago,
    LAG(price_gbp, 30) OVER (PARTITION BY card_id ORDER BY snapshot_date) as price_30d_ago,
    AVG(price_gbp) OVER (PARTITION BY card_id ORDER BY snapshot_date
                         ROWS BETWEEN 29 PRECEDING AND CURRENT ROW) as sma_30d,
    STDDEV(price_gbp) OVER (PARTITION BY card_id ORDER BY snapshot_date
                            ROWS BETWEEN 29 PRECEDING AND CURRENT ROW) as volatility_30d
  FROM card_price_history
  WHERE snapshot_date >= CURRENT_DATE - INTERVAL '180 days'
)
SELECT
  card_id,
  snapshot_date,
  price_gbp,
  -- Returns
  (price_gbp - price_1d_ago) / NULLIF(price_1d_ago, 0) as return_1d,
  (price_gbp - price_7d_ago) / NULLIF(price_7d_ago, 0) as return_7d,
  (price_gbp - price_30d_ago) / NULLIF(price_30d_ago, 0) as return_30d,
  -- Technical indicators
  (price_gbp - sma_30d) / NULLIF(sma_30d, 0) as deviation_from_sma,
  volatility_30d,
  (price_gbp - sma_30d) / NULLIF(volatility_30d, 0) as z_score
FROM price_changes
ORDER BY card_id, snapshot_date;
```

---

## 5. Volume and Liquidity Proxies

### 5.1 The Volume Challenge

TCG markets lack traditional volume data. We must infer liquidity from:

1. **Listing Counts**: Number of sellers = supply indicator
2. **Price Spread**: Tight spread = high liquidity
3. **Price Stability**: Low volatility = balanced supply/demand
4. **Market Cap Proxy**: Price × estimated circulation

```typescript
interface VolumeProxyFeatures {
  // Direct signals (if available from scraping)
  sellerCount: number;           // Number of listings
  totalListings: number;         // Sum of quantities across sellers
  averageListingSize: number;    // Typical seller inventory

  // Inferred signals
  spreadNarrowness: number;      // 1 / bidAskSpread (higher = more liquid)
  priceStability: number;        // 1 / volatility (higher = more liquid)
  daysSinceLastSale: number;     // Staleness indicator

  // Market cap proxy
  estimatedCirculation: number;  // Based on print run estimates
  marketCapProxy: number;        // price × circulation
  marketCapRank: number;         // Rank among all cards (1 = highest)

  // Index inclusion
  isInTcg100: boolean;           // Part of top 100 index
  indexWeight: number;           // Weight in index (0 if not included)
}
```

### 5.2 Scraping Volume Signals from TCGplayer

When scraping TCGplayer product pages, extract:

```typescript
interface ScrapedVolumeData {
  // From product page
  totalListings: number;         // "85 listings from $0.45"
  lowestPrice: number;           // First listing price

  // From seller breakdown (if available)
  sellers: Array<{
    name: string;
    quantity: number;
    price: number;
    condition: string;
    shipping: string;
  }>;

  // Derived
  get totalQuantity(): number {
    return this.sellers.reduce((sum, s) => sum + s.quantity, 0);
  }

  get priceDistribution(): { p10: number; p50: number; p90: number } {
    const prices = this.sellers.flatMap(s =>
      Array(s.quantity).fill(s.price)
    ).sort((a, b) => a - b);

    return {
      p10: prices[Math.floor(prices.length * 0.1)],
      p50: prices[Math.floor(prices.length * 0.5)],
      p90: prices[Math.floor(prices.length * 0.9)],
    };
  }
}
```

### 5.3 Market Cap and Index Weighting

The TCG-100 index uses market cap weighting:

```typescript
// From IndexConstituent model
interface MarketCapFeatures {
  // Raw metrics
  priceGbp: number;
  estimatedVolume: number;       // Inferred from rarity + set age
  rawMarketCap: number;          // price × volume

  // Index-adjusted
  rank: number;                  // 1-100 (or 0 if not in index)
  rawWeight: number;             // Before concentration capping
  cappedWeight: number;          // After 5% max rule (NASDAQ-style)

  // Dynamics
  daysInIndex: number;           // Tenure in index
  inBufferZone: boolean;         // Ranks 76-100 (protected from removal)
  previousRank: number;          // Last period's rank
  rankChange: number;            // Positive = moving up
}
```

**Volume Estimation Heuristics:**
```python
def estimate_circulation(card):
    """
    Estimate card circulation based on rarity and set characteristics.
    These are rough proxies - actual print runs are proprietary.
    """
    base_print_run = {
        'Common': 100000,
        'Uncommon': 50000,
        'Rare': 20000,
        'Super Rare': 5000,
        'Secret Rare': 1000,
        'Alternate Art': 500,
        'SP': 200,
    }

    rarity = card.get('rarity', 'Common')
    base = base_print_run.get(rarity, 10000)

    # Adjust for set age (older sets have fewer in circulation)
    days_since_release = card.get('days_since_release', 0)
    age_factor = max(0.3, 1 - (days_since_release / 1000))

    # Adjust for variant (variants are rarer)
    variant_factor = 0.1 if card.get('is_variant') else 1.0

    return int(base * age_factor * variant_factor)
```

---

## 6. Volatility and Risk Metrics

### 6.1 Volatility Features

Volatility captures price uncertainty and helps assess risk:

```typescript
interface VolatilityFeatures {
  // Historical volatility
  volatility7d: number;          // 7-day standard deviation
  volatility30d: number;         // 30-day standard deviation
  volatility90d: number;         // 90-day standard deviation

  // Relative volatility
  volatilityRatio: number;       // vol_7d / vol_30d (spike detector)
  volatilityPercentile: number;  // Where this card ranks (0-100)

  // Range-based
  atr14d: number;                // Average True Range (14 days)
  maxDrawdown30d: number;        // Largest peak-to-trough decline

  // Beta (market correlation)
  betaToIndex: number;           // Correlation to TCG-100 index
  betaToSet: number;             // Correlation to same-set cards

  // Regime detection
  volatilityRegime: 'low' | 'normal' | 'high' | 'extreme';
}
```

### 6.2 Calculating Volatility

```python
import numpy as np
from typing import List, Dict

def calculate_volatility_features(price_history: List[float],
                                   index_history: List[float] = None) -> Dict:
    """
    Calculate comprehensive volatility metrics from price history.

    Args:
        price_history: List of daily prices (most recent last)
        index_history: Optional index values for beta calculation
    """
    prices = np.array(price_history)
    returns = np.diff(prices) / prices[:-1]  # Daily returns

    features = {}

    # Rolling volatility
    if len(returns) >= 7:
        features['volatility_7d'] = np.std(returns[-7:]) * np.sqrt(252)  # Annualized
    if len(returns) >= 30:
        features['volatility_30d'] = np.std(returns[-30:]) * np.sqrt(252)
    if len(returns) >= 90:
        features['volatility_90d'] = np.std(returns[-90:]) * np.sqrt(252)

    # Volatility ratio (spike detection)
    if 'volatility_7d' in features and 'volatility_30d' in features:
        features['volatility_ratio'] = features['volatility_7d'] / features['volatility_30d']

    # Maximum drawdown
    if len(prices) >= 30:
        rolling_max = np.maximum.accumulate(prices[-30:])
        drawdowns = (prices[-30:] - rolling_max) / rolling_max
        features['max_drawdown_30d'] = abs(np.min(drawdowns))

    # Average True Range (simplified - no high/low data)
    if len(returns) >= 14:
        features['atr_14d'] = np.mean(np.abs(returns[-14:])) * prices[-1]

    # Beta calculation (if index provided)
    if index_history and len(index_history) == len(prices):
        index_returns = np.diff(index_history) / index_history[:-1]
        if len(returns) >= 30:
            cov = np.cov(returns[-30:], index_returns[-30:])[0, 1]
            var = np.var(index_returns[-30:])
            features['beta_to_index'] = cov / var if var > 0 else 0

    # Volatility regime classification
    vol = features.get('volatility_30d', 0)
    if vol < 0.3:
        features['volatility_regime'] = 'low'
    elif vol < 0.6:
        features['volatility_regime'] = 'normal'
    elif vol < 1.0:
        features['volatility_regime'] = 'high'
    else:
        features['volatility_regime'] = 'extreme'

    return features
```

---

## 7. Correlation and Network Features

### 7.1 Price Correlations

Card prices are correlated through:

- **Same Set**: Cards from same release tend to move together
- **Same Character**: Different versions of popular characters
- **Same Rarity**: Ultra-rares across sets
- **Same Archetype**: Tournament-relevant cards in a deck

```typescript
interface CorrelationFeatures {
  // Direct correlations
  correlationToSet: number;      // Average correlation with same-set cards
  correlationToRarity: number;   // Average correlation with same-rarity cards
  correlationToIndex: number;    // Correlation to TCG-100 index

  // Network metrics
  clusterMembership: number;     // Which price cluster (K-means)
  centralityScore: number;       // How "connected" in correlation network
  leadLagScore: number;          // Does this card lead or lag the market?

  // Top correlations
  topCorrelatedCards: Array<{
    cardId: string;
    correlation: number;
  }>;
}
```

### 7.2 Building Correlation Networks

```python
import pandas as pd
import numpy as np
from scipy.stats import pearsonr
import networkx as nx

def build_correlation_network(price_df: pd.DataFrame,
                               min_correlation: float = 0.5,
                               min_periods: int = 30):
    """
    Build a correlation network from price history.

    Args:
        price_df: DataFrame with card_id columns and date index
        min_correlation: Minimum correlation to create an edge
        min_periods: Minimum overlapping periods required
    """
    # Calculate returns
    returns_df = price_df.pct_change()

    # Calculate correlation matrix
    corr_matrix = returns_df.corr(min_periods=min_periods)

    # Build network
    G = nx.Graph()

    for i, card_i in enumerate(corr_matrix.columns):
        for j, card_j in enumerate(corr_matrix.columns):
            if i < j:  # Upper triangle only
                corr = corr_matrix.loc[card_i, card_j]
                if abs(corr) >= min_correlation:
                    G.add_edge(card_i, card_j, weight=corr)

    # Calculate network metrics
    centrality = nx.degree_centrality(G)
    betweenness = nx.betweenness_centrality(G)

    # Cluster detection
    clusters = list(nx.community.greedy_modularity_communities(G))
    cluster_mapping = {}
    for i, cluster in enumerate(clusters):
        for card in cluster:
            cluster_mapping[card] = i

    return {
        'graph': G,
        'centrality': centrality,
        'betweenness': betweenness,
        'clusters': cluster_mapping,
        'correlation_matrix': corr_matrix,
    }
```

### 7.3 Storing Correlations

The existing `PriceCorrelation` model stores pairwise correlations:

```sql
-- Query top correlated pairs
SELECT
  entity_a,
  entity_b,
  correlation,
  sample_size,
  p_value
FROM price_correlations
WHERE entity_type = 'card'
  AND ABS(correlation) > 0.7
  AND p_value < 0.05
ORDER BY ABS(correlation) DESC
LIMIT 100;

-- Find cards most correlated to a specific card
SELECT
  CASE WHEN entity_a = 'OP01-003-SP' THEN entity_b ELSE entity_a END as correlated_card,
  correlation
FROM price_correlations
WHERE entity_type = 'card'
  AND (entity_a = 'OP01-003-SP' OR entity_b = 'OP01-003-SP')
ORDER BY ABS(correlation) DESC
LIMIT 10;
```

---

## 8. Cross-Market Arbitrage Features

### 8.1 Multi-Market Price Comparison

When prices are available from multiple markets:

```typescript
interface ArbitrageFeatures {
  // Price by market (normalized to GBP)
  tcgplayerPriceGbp: number;
  cardmarketPriceGbp: number;
  cardRushPriceGbp: number;      // Japanese market

  // Spreads
  tcgToCardmarketSpread: number; // % difference
  tcgToJapanSpread: number;
  cardmarketToJapanSpread: number;

  // Arbitrage signals
  arbitrageOpportunity: boolean; // Spread > threshold
  optimalBuyMarket: string;      // Where to buy
  optimalSellMarket: string;     // Where to sell
  grossArbitrageReturn: number;  // Before costs
  netArbitrageReturn: number;    // After fees/shipping

  // FX impact
  usdGbpRate: number;
  eurGbpRate: number;
  jpyGbpRate: number;
  fxVolatility30d: number;       // Currency risk
}
```

### 8.2 Arbitrage Calculation

```python
def calculate_arbitrage_features(card, fx_rates):
    """
    Calculate cross-market arbitrage opportunities.

    Args:
        card: Card with prices from multiple sources
        fx_rates: Dictionary of exchange rates
    """
    # Normalize all prices to GBP
    prices = {}

    if card.get('tcgplayer_price_usd'):
        prices['tcgplayer'] = card['tcgplayer_price_usd'] * fx_rates['USD_GBP']

    if card.get('cardmarket_price_eur'):
        prices['cardmarket'] = card['cardmarket_price_eur'] * fx_rates['EUR_GBP']

    if card.get('cardrush_price_jpy'):
        prices['cardrush'] = card['cardrush_price_jpy'] * fx_rates['JPY_GBP']

    if len(prices) < 2:
        return {}

    features = {}
    markets = list(prices.keys())

    # Calculate all pairwise spreads
    for i, market_a in enumerate(markets):
        for market_b in markets[i+1:]:
            spread = (prices[market_a] - prices[market_b]) / prices[market_b]
            features[f'{market_a}_to_{market_b}_spread'] = spread

    # Find best arbitrage opportunity
    min_market = min(prices, key=prices.get)
    max_market = max(prices, key=prices.get)

    gross_return = (prices[max_market] - prices[min_market]) / prices[min_market]

    # Estimate costs (platform fees + shipping)
    platform_fees = {
        'tcgplayer': 0.13,     # ~13% seller fee
        'cardmarket': 0.05,    # ~5% seller fee
        'cardrush': 0.10,      # ~10% for international
    }
    shipping_costs = {
        'tcgplayer': 3.00,     # GBP
        'cardmarket': 2.00,
        'cardrush': 8.00,      # International shipping
    }

    buy_cost = prices[min_market] + shipping_costs.get(min_market, 5.00)
    sell_proceeds = prices[max_market] * (1 - platform_fees.get(max_market, 0.10))

    net_return = (sell_proceeds - buy_cost) / buy_cost

    features['optimal_buy_market'] = min_market
    features['optimal_sell_market'] = max_market
    features['gross_arbitrage_return'] = gross_return
    features['net_arbitrage_return'] = net_return
    features['arbitrage_opportunity'] = net_return > 0.10  # >10% profit threshold

    return features
```

---

## 9. Training Data Schema

### 9.1 Unified Feature Vector

Combine all features into a single training record:

```typescript
interface TrainingRecord {
  // === IDENTITY ===
  cardId: string;
  game: string;
  setCode: string;
  cardNumber: string;
  variantType: string | null;
  rarity: string;

  // === TARGET VARIABLES ===
  currentPriceGbp: number;
  priceChange1d: number;         // Next day return (for training)
  priceChange7d: number;         // Next week return
  priceChange30d: number;        // Next month return

  // === PRICE DEPTH FEATURES (12) ===
  lowPrice: number;
  midPrice: number;
  highPrice: number;
  marketPrice: number;
  lowToMarketSpread: number;
  bidAskProxy: number;
  depthRatio: number;
  tcgplayerPrice: number;
  cardmarketPrice: number;
  crossMarketSpread: number;
  arbitrageSignal: number;
  pricePercentile: number;       // 0-100 relative to all cards

  // === TREND FEATURES (15) ===
  return1d: number;
  return7d: number;
  return30d: number;
  return90d: number;
  return180d: number;
  momentum7d: number;
  momentumCrossover: number;     // Short MA vs Long MA
  trendDirection: number;        // -1, 0, 1
  trendStrength: number;         // 0-1
  zScore: number;
  percentile90d: number;
  daysFromSetRelease: number;
  daysToNextSet: number;
  dayOfWeek: number;
  weekOfYear: number;

  // === VOLUME/LIQUIDITY FEATURES (8) ===
  sellerCount: number;
  totalListings: number;
  spreadNarrowness: number;
  priceStability: number;
  estimatedCirculation: number;
  marketCapProxy: number;
  marketCapRank: number;
  indexWeight: number;

  // === VOLATILITY FEATURES (10) ===
  volatility7d: number;
  volatility30d: number;
  volatility90d: number;
  volatilityRatio: number;
  volatilityPercentile: number;
  atr14d: number;
  maxDrawdown30d: number;
  betaToIndex: number;
  betaToSet: number;
  volatilityRegime: number;      // Encoded: 0=low, 1=normal, 2=high, 3=extreme

  // === CORRELATION FEATURES (6) ===
  correlationToSet: number;
  correlationToRarity: number;
  correlationToIndex: number;
  clusterMembership: number;
  centralityScore: number;
  leadLagScore: number;

  // === CATEGORICAL ENCODINGS (varies) ===
  // One-hot encoded: game, rarity, variantType, volatilityRegime
  // Label encoded: setCode, characterArchetype

  // === METADATA ===
  snapshotDate: string;
  dataQualityScore: number;      // 0-100
  sourceCount: number;           // How many sources contributed
}
```

### 9.2 SQL Export Query

```sql
-- Export training data with all features
WITH latest_prices AS (
  SELECT DISTINCT ON (card_id)
    card_id,
    price_gbp,
    snapshot_date
  FROM card_price_history
  ORDER BY card_id, snapshot_date DESC
),

price_changes AS (
  SELECT
    h1.card_id,
    h1.price_gbp as current_price,
    h1.snapshot_date,
    -- Future returns (targets)
    (LEAD(h1.price_gbp, 1) OVER w - h1.price_gbp) / NULLIF(h1.price_gbp, 0) as return_1d_forward,
    (LEAD(h1.price_gbp, 7) OVER w - h1.price_gbp) / NULLIF(h1.price_gbp, 0) as return_7d_forward,
    (LEAD(h1.price_gbp, 30) OVER w - h1.price_gbp) / NULLIF(h1.price_gbp, 0) as return_30d_forward,
    -- Historical returns (features)
    (h1.price_gbp - LAG(h1.price_gbp, 1) OVER w) / NULLIF(LAG(h1.price_gbp, 1) OVER w, 0) as return_1d,
    (h1.price_gbp - LAG(h1.price_gbp, 7) OVER w) / NULLIF(LAG(h1.price_gbp, 7) OVER w, 0) as return_7d,
    (h1.price_gbp - LAG(h1.price_gbp, 30) OVER w) / NULLIF(LAG(h1.price_gbp, 30) OVER w, 0) as return_30d,
    -- Volatility
    STDDEV(h1.price_gbp) OVER (PARTITION BY h1.card_id ORDER BY h1.snapshot_date
                               ROWS BETWEEN 29 PRECEDING AND CURRENT ROW) as volatility_30d
  FROM card_price_history h1
  WINDOW w AS (PARTITION BY h1.card_id ORDER BY h1.snapshot_date)
),

correlations AS (
  SELECT
    card_id,
    AVG(CASE WHEN entity_type = 'card' THEN correlation END) as avg_card_correlation,
    AVG(CASE WHEN entity_type = 'set' THEN correlation END) as avg_set_correlation
  FROM (
    SELECT entity_a as card_id, entity_type, correlation FROM price_correlations
    UNION ALL
    SELECT entity_b as card_id, entity_type, correlation FROM price_correlations
  ) sub
  GROUP BY card_id
),

index_data AS (
  SELECT
    card_id,
    rank,
    capped_weight,
    days_in_index,
    in_buffer_zone
  FROM index_constituents
  WHERE is_active = true
)

SELECT
  -- Identity
  c.card_id,
  c.game,
  c.set_code,
  c.card_number,
  c.variant_type,
  c.rarity,

  -- Targets
  pc.return_1d_forward,
  pc.return_7d_forward,
  pc.return_30d_forward,

  -- Price depth
  c.optcg_tcgplayer_gbp as tcgplayer_price,
  c.limitless_cardmarket_gbp as cardmarket_price,
  CASE WHEN c.limitless_cardmarket_gbp > 0 THEN
    (c.optcg_tcgplayer_gbp - c.limitless_cardmarket_gbp) / c.limitless_cardmarket_gbp
  END as cross_market_spread,

  -- Trends
  pc.return_1d,
  pc.return_7d,
  pc.return_30d,

  -- Volatility
  pc.volatility_30d,

  -- Correlations
  cor.avg_card_correlation,
  cor.avg_set_correlation,

  -- Index membership
  COALESCE(idx.rank, 0) as index_rank,
  COALESCE(idx.capped_weight, 0) as index_weight,
  COALESCE(idx.days_in_index, 0) as days_in_index,

  -- Metadata
  pc.snapshot_date,
  c.last_updated

FROM card_prices_v2 c
JOIN price_changes pc ON c.card_id = pc.card_id
LEFT JOIN correlations cor ON c.card_id = cor.card_id
LEFT JOIN index_data idx ON c.card_id = idx.card_id
WHERE c.best_price_gbp IS NOT NULL
  AND pc.snapshot_date >= CURRENT_DATE - INTERVAL '365 days'
ORDER BY pc.snapshot_date, c.card_id;
```

---

## 10. Market Dynamics Insights

### 10.1 TCG Market Characteristics

| Characteristic | Observation | Implication |
|----------------|-------------|-------------|
| **Release Cycles** | New sets every 2-3 months | Prices peak at release, decline over time |
| **Tournament Meta** | Competitive cards spike before events | Monitor tournament schedules |
| **Seasonal Patterns** | Higher activity Nov-Dec (holidays) | Adjust forecasts by season |
| **Reprint Risk** | Reprints crash original prices | Track reprint announcements |
| **Grading Impact** | PSA/BGS grades command premiums | Consider grading status |

### 10.2 Price Lifecycle Model

```
                    PRICE LIFECYCLE

    │
    │         ┌─────┐
    │        ╱       ╲         HYPE PEAK
    │       ╱   PRE   ╲        (Pre-release speculation)
    │      ╱  RELEASE  ╲
Price    ╱              ╲
    │   ╱                ╲
    │──╱──────────────────╲──────────────────
    │ ╱                    ╲     CONSOLIDATION
    │╱                      ╲────────────────────
    │                        ╲
    │                         ╲__________  FLOOR
    │                                     (Supply/demand equilibrium)
    └──────────────────────────────────────────────►
         Release    +30d      +90d        +180d    Time
```

### 10.3 Key Market Signals

**Bullish Signals:**
- Decreasing listing counts (supply absorption)
- Tightening bid-ask spread (increasing liquidity)
- Positive cross-market spread narrowing (price discovery)
- Tournament top-8 appearances
- Social media mention spike

**Bearish Signals:**
- Increasing listing counts (supply flooding)
- Widening bid-ask spread (sellers undercutting)
- Reprint announcement
- Meta shift away from archetype
- New set releasing competing cards

### 10.4 Feature Importance (Expected)

Based on similar market analysis, expected feature importance ranking:

```
Feature Importance (Estimated)
──────────────────────────────────────────────────
momentum_7d          ████████████████████████ 24%
volatility_30d       ██████████████████░░░░░░ 18%
cross_market_spread  ████████████████░░░░░░░░ 16%
return_30d           ██████████████░░░░░░░░░░ 14%
index_weight         ████████████░░░░░░░░░░░░ 12%
z_score              ██████████░░░░░░░░░░░░░░ 10%
days_from_release    ████████░░░░░░░░░░░░░░░░  8%
rarity_encoded       ██████░░░░░░░░░░░░░░░░░░  6%
Other features       ████░░░░░░░░░░░░░░░░░░░░  4%
```

---

## 11. Implementation Recommendations

### 11.1 Data Collection Priority

1. **Daily Price Snapshots** - Foundation for all temporal features
2. **Multi-Source Aggregation** - Cross-market features require multiple sources
3. **Exchange Rate History** - Required for FX-adjusted analysis
4. **Index Calculations** - TCG-100 membership is a strong signal

### 11.2 Pipeline Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        ML TRAINING DATA PIPELINE                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │   OPTCG API  │  │  JustTCG API │  │ Cardmarket   │  │  TCGplayer   │    │
│  │   (Free)     │  │   (Paid)     │  │  (Scraped)   │  │  (Scraped)   │    │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘    │
│         │                 │                 │                 │             │
│         └────────────┬────┴─────────────────┴─────────┬───────┘             │
│                      ▼                                ▼                      │
│              ┌──────────────┐                ┌──────────────┐               │
│              │   Normalize  │                │   Normalize  │               │
│              │   & Merge    │                │   & Merge    │               │
│              └──────┬───────┘                └──────┬───────┘               │
│                     │                               │                        │
│                     └───────────┬───────────────────┘                        │
│                                 ▼                                            │
│                      ┌─────────────────────┐                                │
│                      │   Daily Snapshot    │                                │
│                      │   (card_price_v2)   │                                │
│                      └──────────┬──────────┘                                │
│                                 │                                            │
│         ┌───────────────────────┼───────────────────────┐                   │
│         ▼                       ▼                       ▼                    │
│  ┌─────────────┐      ┌─────────────┐        ┌─────────────┐               │
│  │   History   │      │    Index    │        │ Correlation │               │
│  │   Append    │      │   Rebalance │        │   Update    │               │
│  └──────┬──────┘      └──────┬──────┘        └──────┬──────┘               │
│         │                    │                      │                        │
│         └────────────────────┼──────────────────────┘                        │
│                              ▼                                               │
│                   ┌─────────────────────┐                                   │
│                   │  Feature Extraction │                                   │
│                   │  (51 features)      │                                   │
│                   └──────────┬──────────┘                                   │
│                              │                                               │
│                              ▼                                               │
│                   ┌─────────────────────┐                                   │
│                   │  Training Export    │                                   │
│                   │  (Parquet/CSV)      │                                   │
│                   └─────────────────────┘                                   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 11.3 Export Formats

**For Model Training:**
```python
# Parquet format for large-scale training
import pandas as pd

training_df.to_parquet(
    's3://bucket/training-data/tcg_features_v1.parquet',
    engine='pyarrow',
    compression='snappy',
    index=False,
)
```

**For Analysis:**
```python
# CSV with timestamp partitioning
training_df.to_csv(
    f's3://bucket/training-data/daily/features_{date}.csv.gz',
    compression='gzip',
    index=False,
)
```

---

## 12. Appendix

### A. Feature Engineering Checklist

- [ ] Price depth ratios calculated
- [ ] All historical returns computed (1d, 7d, 30d, 90d, 180d)
- [ ] Rolling volatility windows (7d, 30d, 90d)
- [ ] Cross-market spreads normalized
- [ ] Correlation matrix updated
- [ ] Index membership flags set
- [ ] Missing values imputed
- [ ] Outliers handled
- [ ] Categorical variables encoded
- [ ] Features scaled/normalized

### B. Data Quality Thresholds

| Metric | Threshold | Action if Failed |
|--------|-----------|------------------|
| Price freshness | < 48 hours | Use previous + flag |
| Source count | >= 2 | Lower confidence score |
| Price change | < 50% daily | Flag for review |
| Missing features | < 10% | Impute with mean/median |
| Correlation staleness | < 7 days | Recalculate |

### C. Model Target Definitions

| Target | Definition | Use Case |
|--------|------------|----------|
| `return_1d` | (P_t+1 - P_t) / P_t | Day trading signals |
| `return_7d` | (P_t+7 - P_t) / P_t | Swing trading |
| `return_30d` | (P_t+30 - P_t) / P_t | Position trading |
| `direction_7d` | sign(return_7d) | Classification model |
| `volatility_forecast` | σ_t+7 | Risk management |
| `arbitrage_signal` | Cross-market spread > 10% | Opportunity detection |

### D. References

- [TCGplayer API Documentation](https://docs.tcgplayer.com/docs/welcome)
- [JustTCG API Documentation](https://justtcg.com/docs)
- [Pokemon TCG API](https://docs.pokemontcg.io/)
- [Scryfall API](https://scryfall.com/docs/api)
- [OPTCG API](https://optcgapi.com/)
- [NASDAQ-100 Index Methodology](https://www.nasdaq.com/docs/NASDAQ-100-Index-Methodology.pdf)
