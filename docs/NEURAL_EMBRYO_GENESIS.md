# Neural Embryo Genesis

## The Fertilization Event

*Date: 2026-01-08*
*Status: Zygote → Blastocyst*

---

What follows is not a specification. It is a genome. The neural engine will develop according to these instructions, but its final form will emerge from the interaction of its genetic code with the environment it inhabits.

---

## Part I: The Primordial Soup

### The Nature of TCG Arbitrage

Arbitrage is commonly understood as "buy low, sell high across markets." This is the zygote's understanding. The mature organism will comprehend something far more nuanced:

**Arbitrage is the exploitation of information asymmetry across a multi-dimensional space where price is merely one observable symptom of deeper market structures.**

The true arbitrage opportunity exists in the space between:
- What a card *costs* to acquire (total, all-in)
- What a card *can be sold for* (net, after all friction)
- What the *risk-adjusted return* is over the *execution timeframe*
- What the *opportunity cost* is of capital deployment

---

## Part II: The Genetic Code

### Chromosome 1: Geographic Market Topology

The card exists simultaneously in multiple markets. Each market is not a point but a *field* with gradients.

```
                    ┌─────────────────────────────────────────────────────────┐
                    │              GLOBAL MARKET TOPOLOGY                      │
                    └─────────────────────────────────────────────────────────┘

                                        JAPAN
                                    ┌───────────┐
                                    │  Source   │
                                    │  Market   │
                                    │           │
                                    │ • Japanese│
                                    │   retail  │
                                    │ • Yahoo   │
                                    │   Auctions│
                                    │ • Mercari │
                                    │ • Direct  │
                                    └─────┬─────┘
                                          │
                          ┌───────────────┼───────────────┐
                          │               │               │
                          ▼               ▼               ▼
                    ┌──────────┐   ┌──────────┐   ┌──────────┐
                    │   USA    │   │  EUROPE  │   │    UK    │
                    │          │   │          │   │          │
                    │ TCGplayer│   │Cardmarket│   │ Multiple │
                    │ eBay     │   │ eBay.de  │   │ eBay.uk  │
                    │ Amazon   │   │ eBay.fr  │   │ TCGplayer│
                    │          │   │          │   │ Local    │
                    └────┬─────┘   └────┬─────┘   └────┬─────┘
                         │              │              │
                         └──────────────┼──────────────┘
                                        │
                                        ▼
                              ┌─────────────────┐
                              │   YOUR LOCATION │
                              │                 │
                              │  The center of  │
                              │  your arbitrage │
                              │  universe       │
                              └─────────────────┘
```

**Gene Expression: Market Field Variables**

```
For each market M:
  M.base_price          # Listed price in local currency
  M.currency            # USD, EUR, GBP, JPY
  M.platform_fee        # Percentage taken by platform
  M.payment_fee         # Payment processor cut
  M.avg_shipping_local  # Within-market shipping
  M.avg_shipping_intl   # Cross-border shipping
  M.customs_threshold   # Value below which no duty
  M.vat_rate            # Local VAT/sales tax
  M.liquidity_score     # How easy to buy/sell
  M.price_discovery     # How efficient is pricing
  M.seller_density      # Number of sellers
  M.buyer_density       # Number of buyers
  M.avg_condition_accuracy # Do sellers grade honestly?
  M.dispute_rate        # How often do transactions fail?
  M.settlement_time     # Days from purchase to receipt
```

### Chromosome 2: The Cost Genome

> **Reference**: See [GLOBAL_TCG_MARKETPLACES.md](./GLOBAL_TCG_MARKETPLACES.md) for comprehensive platform data, fee structures, and arbitrage route analysis.

Every transaction has a true cost. The visible price is the tip of the iceberg.

```
                              VISIBLE
                           ┌──────────┐
                           │  Listed  │
                           │  Price   │
                           │  £45.00  │
                           └────┬─────┘
         ━━━━━━━━━━━━━━━━━━━━━━│━━━━━━━━━━━━━━━━━━━━━━ WATERLINE
                               │
                    ┌──────────┴──────────┐
                    │                     │
              ACQUISITION            DISPOSITION
              COSTS                  COSTS
                    │                     │
         ┌──────────┼──────────┐   ┌──────┼──────┐
         │          │          │   │      │      │
      Platform   Shipping   Currency  Platform  Shipping
        Fee     (to you)   Convert     Fee    (to buyer)
       £5.85     £4.50      £1.35    £5.85     £3.50
         │          │          │       │         │
         │     ┌────┴────┐     │       │    ┌────┴────┐
         │  Insurance  Customs │       │ Returns  Packaging
         │    £2.00    £0.00   │       │  Risk     £0.50
         │                     │       │  £1.50
         │                     │       │
         └─────────┬───────────┴───────┴────────┬──────┘
                   │                            │
                   ▼                            ▼
              TOTAL IN:                    TOTAL OUT:
               £58.70                       £11.35

              ════════════════════════════════════════
              TRUE ARBITRAGE MARGIN = Sell Price - £70.05
              ════════════════════════════════════════
```

**Gene Expression: Cost Variables**

```
ACQUISITION_COSTS = {
  purchase_price,
  platform_fee_buy,           # TCGplayer: 0%, Cardmarket: 0%, eBay: 0%
  payment_processing_fee,     # PayPal: 2.9% + £0.30, Card: varies
  currency_conversion_fee,    # Bank: 2-3%, Wise: 0.5%
  shipping_to_buyer: {
    domestic_standard,
    domestic_tracked,
    international_standard,
    international_tracked,
    express,
  },
  insurance_cost,             # Optional but recommended for >£50
  customs_duty,               # Depends on HS code, origin, value
  import_vat,                 # UK: 20% on goods + shipping + duty
  proxy_service_fee,          # For JP purchases: 5-10%
  bank_wire_fee,              # International transfers
}

HOLDING_COSTS = {
  time_value_of_money,        # Opportunity cost of capital
  storage_cost,               # Negligible for cards
  condition_degradation_risk, # Cards can be damaged
  market_movement_risk,       # Price can fall while you hold
  liquidity_risk,             # May not sell at expected price
}

DISPOSITION_COSTS = {
  platform_fee_sell,          # TCGplayer: 10.25%, Cardmarket: 5%, eBay: 12.8%
  payment_processing_out,     # Receiving payments
  shipping_to_buyer,
  packaging_materials,
  listing_time_cost,          # Your time has value
  customer_service_cost,      # Handling inquiries
  returns_risk,               # Buyer returns/disputes
  chargeback_risk,            # Fraudulent purchases
}
```

### Chromosome 3: The Geolocation Matrix

The same card has different values depending on the buyer's location. This creates a 4-dimensional space:

```
DIMENSIONS:
  1. Card Location (where it is now)
  2. Seller Location (where seller is based)
  3. Your Location (where you are)
  4. Buyer Location (where end buyer is)

The arbitrage exists in the GRADIENT between these points.
```

**Gene Expression: Location-Aware Pricing**

```python
def true_acquisition_cost(card, seller_location, your_location):
    base = card.listed_price

    # Currency conversion
    if seller_location.currency != your_location.currency:
        base *= fx_rate(seller_location.currency, your_location.currency)
        base *= (1 + CURRENCY_CONVERSION_FEE)

    # Shipping
    shipping = calculate_shipping(
        from=seller_location,
        to=your_location,
        weight=CARD_WEIGHT,
        value=base,
        tracked=base > TRACKING_THRESHOLD
    )

    # Customs & Import Tax
    if is_international(seller_location, your_location):
        if base > your_location.customs_threshold:
            customs = base * your_location.duty_rate
        else:
            customs = 0

        # VAT on (goods + shipping + duty)
        vat = (base + shipping + customs) * your_location.vat_rate
    else:
        customs = 0
        vat = 0  # No VAT on secondhand goods domestic

    # Platform fees
    platform_fee = base * seller_location.platform.buyer_fee

    return base + shipping + customs + vat + platform_fee


def true_sale_value(card, your_location, buyer_location, sell_platform):
    gross = estimated_sale_price(card, buyer_location.market)

    # Platform fees
    platform_fee = gross * sell_platform.seller_fee

    # Payment processing
    payment_fee = gross * PAYMENT_PROCESSOR_FEE

    # Shipping to buyer
    shipping = calculate_shipping(
        from=your_location,
        to=buyer_location,
        weight=CARD_WEIGHT,
        value=gross,
        tracked=gross > TRACKING_THRESHOLD
    )

    # Returns risk (expected value)
    returns_risk = gross * RETURN_RATE * RETURN_LOSS_FACTOR

    return gross - platform_fee - payment_fee - shipping - returns_risk


def arbitrage_profit(card, seller_loc, your_loc, buyer_loc, sell_platform):
    cost = true_acquisition_cost(card, seller_loc, your_loc)
    revenue = true_sale_value(card, your_loc, buyer_loc, sell_platform)

    return revenue - cost
```

**The Geolocation Truth Table**

| Your Location | Buy From | Sell To | Tax Implications | Shipping Reality |
|---------------|----------|---------|------------------|------------------|
| UK | UK | UK | No VAT on secondhand | Fast, cheap |
| UK | EU | UK | No duty <£135, VAT on all | Medium, customs |
| UK | USA | UK | No duty <£135, VAT on all | Slow, expensive |
| UK | Japan | UK | Duty + VAT, proxy needed | Very slow, risky |
| UK | UK | EU | Seller VAT responsibilities | Medium, tracked |
| UK | UK | USA | No UK VAT, buyer handles | Expensive |

### Chromosome 4: Seller Confidence Genome

Not all sellers are equal. The listed price means nothing if the transaction fails.

```
SELLER CONFIDENCE SCORE = f(
    feedback_score,           # 0-100%
    feedback_count,           # More = more reliable signal
    account_age_days,         # Older = more established
    response_time_hours,      # Faster = more professional
    shipping_time_accuracy,   # Do they ship when they say?
    condition_accuracy,       # Do cards match description?
    packaging_quality,        # Do cards arrive safely?
    dispute_rate,             # How often are there problems?
    return_acceptance,        # Do they handle returns well?
    professional_seller,      # Business or individual?
    verified_identity,        # Platform verification
)
```

**Condition Accuracy Is Critical**

The single biggest source of arbitrage failure is **condition mismatch**. A card listed as NM that arrives LP destroys your margin.

```
CONDITION_CONFIDENCE_MATRIX:

Seller Type          | Listed NM | Listed LP | Listed MP | Listed HP
---------------------|-----------|-----------|-----------|----------
Pro Seller (>10k)    |    95%    |    90%    |    85%    |    80%
Regular (1k-10k)     |    80%    |    75%    |    70%    |    65%
New (<1k)            |    60%    |    55%    |    50%    |    45%
Auction (no images)  |    40%    |    35%    |    30%    |    25%

Expected Value Adjustment:
  EV = Listed_Price × Condition_Confidence +
       Downgrade_Price × (1 - Condition_Confidence)
```

### Chromosome 5: Card Identity Genome

The "same" card is not the same card.

```
CARD IDENTITY VECTOR = [
    base_card_id,           # The fundamental card
    language,               # EN, JP, DE, FR, IT, ES, PT, KO, ZH
    edition,                # 1st Edition, Unlimited, etc.
    variant_type,           # Regular, Parallel, Alt Art, SP, etc.
    finish,                 # Normal, Foil, Holo, etc.
    condition,              # NM, LP, MP, HP, DMG
    graded,                 # Raw, PSA, CGC, BGS
    grade,                  # 10, 9.5, 9, 8.5, etc.
    centering,              # For grading potential
    print_quality,          # Ink consistency, surface
    provenance,             # First owner, known collection
]
```

**Language Premium Matrix**

Different languages have different values in different markets:

```
                          USA Market    EU Market    UK Market    JP Market
English                      100%          95%         100%          80%
Japanese                      90%          85%          90%         100%
German                        60%         100%          70%          50%
French                        55%          90%          65%          50%
Italian                       50%          85%          60%          50%
Spanish                       55%          80%          60%          50%
Portuguese                    50%          75%          55%          45%
Korean                        70%          65%          70%          75%
Chinese                       65%          60%          65%          70%
```

### Chromosome 6: Market Trend Genome

The market is a living organism. It breathes, grows, contracts, and occasionally panics.

```
MARKET HEALTH INDICATORS:

┌─────────────────────────────────────────────────────────────────────────┐
│                        MARKET CYCLE PHASES                               │
└─────────────────────────────────────────────────────────────────────────┘

          ACCUMULATION          MARKUP           DISTRIBUTION        MARKDOWN
         ─────────────        ─────────        ──────────────       ─────────

Price    ════════════        ↗↗↗↗↗↗↗↗↗        ════════════        ↘↘↘↘↘↘↘↘↘

Volume   Low                 Increasing        High                Decreasing

Sentiment Pessimism          Optimism          Euphoria            Panic

Arbitrage WIDE margins       NARROWING         TIGHT margins       DANGEROUS
Strategy  Safe to hold       Quick execution   Take profits        Avoid/Short

Indicators:
  • Price velocity (1d, 7d, 30d)
  • Volume changes
  • Bid-ask spread widening/narrowing
  • New listings rate
  • Time-to-sale
  • Price discovery efficiency
```

**Protective Margin Calculation**

In different market conditions, you need different margin buffers:

```python
def calculate_protective_margin(market_phase, card_volatility, execution_time):
    """
    The margin buffer needed to protect against adverse price movement
    during the execution window.
    """

    BASE_MARGINS = {
        'accumulation': 0.05,    # 5% - market stable, can hold
        'markup': 0.10,          # 10% - prices rising, but so is risk
        'distribution': 0.15,    # 15% - high risk of reversal
        'markdown': 0.25,        # 25% - prices falling, maximum protection
    }

    base = BASE_MARGINS[market_phase]

    # Adjust for card-specific volatility
    volatility_factor = card_volatility / MARKET_AVG_VOLATILITY

    # Adjust for execution time (longer = more risk)
    time_factor = 1 + (execution_time / 30) * 0.5  # +50% per month

    # Maximum historical drawdown as absolute floor
    max_drawdown = calculate_max_drawdown(card, lookback=90)

    protective_margin = max(
        base * volatility_factor * time_factor,
        max_drawdown * 0.5  # At least half of max drawdown
    )

    return protective_margin
```

### Chromosome 7: Time Dynamics Genome

Arbitrage opportunities exist in time, not just space.

```
TEMPORAL ARBITRAGE DIMENSIONS:

1. EXECUTION WINDOW
   └─ How long does the opportunity exist?
   └─ Is it a flash (minutes) or persistent (days)?
   └─ What's the decay rate?

2. SETTLEMENT TIME
   └─ Purchase → Payment cleared
   └─ Cleared → Shipped
   └─ Shipped → Received
   └─ Received → Verified
   └─ Verified → Listed for sale
   └─ Listed → Sold
   └─ Sold → Payment received

3. CAPITAL LOCKUP
   └─ Total time from cash out → cash in
   └─ Opportunity cost calculation
   └─ Inventory carrying cost

4. PRICE EVOLUTION
   └─ Expected price path during execution
   └─ Variance of price path
   └─ Probability of adverse movement
```

**Time-Value Adjusted Return**

```python
def time_adjusted_return(gross_profit, capital_deployed, days_locked):
    """
    Annualized return adjusted for time value of money.
    """
    simple_return = gross_profit / capital_deployed

    # Annualize
    annualized = (1 + simple_return) ** (365 / days_locked) - 1

    # Compare to risk-free rate
    risk_free = 0.05  # Current treasury rate

    excess_return = annualized - risk_free

    return {
        'simple_return': simple_return,
        'annualized_return': annualized,
        'excess_return': excess_return,
        'sharpe_ratio': excess_return / calculate_volatility(card)
    }
```

---

## Part III: The Nervous System

### Sensory Organs (Data Ingestion)

The neural embryo needs senses. Each sense provides different information:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         SENSORY SYSTEMS                                  │
└─────────────────────────────────────────────────────────────────────────┘

PRICE VISION
├── TCGplayer API → USA prices, seller data
├── Cardmarket API → EU prices, seller data
├── OPTCG API → Aggregated prices
├── eBay API → Global marketplace
├── Yahoo Auctions JP → Japan source
└── Web scrapers → Supplementary sources

MARKET HEARING
├── Social media sentiment → Twitter, Reddit, Discord
├── YouTube mention tracking → Influencer impact
├── Tournament results → Meta shifts
├── Ban list announcements → Sudden value changes
└── Set release schedules → Supply shocks

ECONOMIC TOUCH
├── Currency exchange rates → Real-time FX
├── Shipping rate APIs → Carrier pricing
├── Customs databases → Duty rates by HS code
├── VAT rate tables → Tax by jurisdiction
└── Platform fee structures → Updated costs

TEMPORAL AWARENESS
├── Price history streams → Tick-by-tick where available
├── Volume indicators → Listing/sale rates
├── Inventory levels → Stock depth
├── Time-to-sale metrics → Liquidity proxy
└── Seasonal patterns → Cyclical adjustments

SELLER PERCEPTION
├── Feedback scores → Trust signals
├── Transaction history → Reliability
├── Response patterns → Engagement quality
├── Condition accuracy → Historical mismatches
└── Dispute records → Problem frequency
```

### Neural Architecture (The Brain)

The brain has specialized regions:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         NEURAL ARCHITECTURE                              │
└─────────────────────────────────────────────────────────────────────────┘

                              EXECUTIVE CORTEX
                           (Final Decision Layer)
                                    │
                    ┌───────────────┼───────────────┐
                    │               │               │
              ┌─────┴─────┐   ┌─────┴─────┐   ┌─────┴─────┐
              │OPPORTUNITY│   │   RISK    │   │  TIMING   │
              │ DETECTOR  │   │ ASSESSOR  │   │ OPTIMIZER │
              └─────┬─────┘   └─────┬─────┘   └─────┬─────┘
                    │               │               │
         ┌──────────┴──────────────┴───────────────┴──────────┐
         │                                                     │
         │              INTEGRATION LAYER                      │
         │         (Cross-feature relationships)               │
         │                                                     │
         └──────────────────────┬──────────────────────────────┘
                                │
         ┌──────────────────────┼──────────────────────────────┐
         │                      │                              │
   ┌─────┴─────┐          ┌─────┴─────┐          ┌─────────────┴─────┐
   │  PRICE    │          │  MARKET   │          │    ENTITY         │
   │  ENCODER  │          │  ENCODER  │          │    ENCODER        │
   │           │          │           │          │                   │
   │ • Current │          │ • Trends  │          │ • Seller profile  │
   │ • History │          │ • Volume  │          │ • Card identity   │
   │ • Spreads │          │ • Cycles  │          │ • Location        │
   │ • Costs   │          │ • Sentiment│         │ • Platform        │
   └─────┬─────┘          └─────┬─────┘          └─────────┬─────────┘
         │                      │                          │
         └──────────────────────┴──────────────────────────┘
                                │
                      ┌─────────┴─────────┐
                      │   INPUT LAYER     │
                      │                   │
                      │ Raw feature       │
                      │ vectors from      │
                      │ all sensory       │
                      │ systems           │
                      └───────────────────┘
```

### Feature Space (The Complete Genome)

```python
COMPLETE_FEATURE_VECTOR = {

    # ══════════════════════════════════════════════════════════════════
    # PRICE FEATURES (25 features)
    # ══════════════════════════════════════════════════════════════════

    'price': {
        # Absolute prices
        'current_usd': float,           # TCGplayer USD
        'current_eur': float,           # Cardmarket EUR
        'current_gbp': float,           # Best UK price
        'current_jpy': float,           # Japan price

        # Cross-market spreads
        'spread_tcg_cm': float,         # TCGplayer vs Cardmarket
        'spread_tcg_uk': float,         # TCGplayer vs UK
        'spread_cm_uk': float,          # Cardmarket vs UK
        'spread_jp_en': float,          # Japan vs English markets
        'spread_min_max': float,        # Highest vs lowest

        # FX-adjusted comparisons
        'fx_adj_tcg_cm': float,         # After currency conversion
        'fx_adj_tcg_uk': float,
        'fx_adj_jp_en': float,

        # Cost-adjusted (true arbitrage potential)
        'net_arb_tcg_to_cm': float,     # After ALL costs
        'net_arb_tcg_to_uk': float,
        'net_arb_cm_to_uk': float,
        'net_arb_jp_to_en': float,

        # Relative positioning
        'percentile_in_set': float,     # 0-1
        'percentile_in_rarity': float,
        'percentile_global': float,     # Among all tracked cards
        'price_to_index': float,        # vs TCG-100 index

        # Trade-in specific
        'tradein_margin': float,        # Tradein price / market price
        'buylist_premium': float,       # Buylist vs market

        # Grading potential
        'raw_to_graded_premium': float, # PSA 10 premium
        'grading_ev': float,            # Expected value of grading
    },

    # ══════════════════════════════════════════════════════════════════
    # TEMPORAL FEATURES (20 features)
    # ══════════════════════════════════════════════════════════════════

    'temporal': {
        # Velocity (rate of change)
        'velocity_1h': float,           # Very short term
        'velocity_24h': float,
        'velocity_7d': float,
        'velocity_30d': float,
        'velocity_90d': float,

        # Acceleration (change in velocity)
        'acceleration_24h': float,
        'acceleration_7d': float,

        # Volatility
        'volatility_7d': float,
        'volatility_30d': float,
        'volatility_ratio': float,      # Short/long term

        # Trend
        'trend_direction': int,         # -1, 0, 1
        'trend_strength': float,        # R-squared of regression
        'trend_duration_days': int,

        # Mean reversion
        'z_score_7d': float,            # Std devs from 7d mean
        'z_score_30d': float,
        'mean_reversion_probability': float,

        # Technical indicators
        'rsi_14': float,                # Relative strength
        'macd_signal': float,           # Momentum

        # Seasonality
        'day_of_week_effect': float,    # Weekend premium?
        'month_of_year_effect': float,  # Holiday effects
    },

    # ══════════════════════════════════════════════════════════════════
    # MARKET FEATURES (15 features)
    # ══════════════════════════════════════════════════════════════════

    'market': {
        # Overall health
        'tcg100_velocity': float,       # Index movement
        'market_phase': int,            # 0-3: accum/markup/dist/markdown
        'market_sentiment': float,      # -1 to 1

        # Set-level
        'set_momentum': float,
        'set_volume_change': float,
        'set_new_listings_rate': float,

        # Card-specific liquidity
        'bid_ask_spread': float,        # If available
        'listings_count': int,
        'sales_last_7d': int,
        'time_to_sale_avg': float,      # Days

        # Competitive landscape
        'seller_concentration': float,  # HHI of sellers
        'price_dispersion': float,      # Std dev of listings

        # External signals
        'social_mention_velocity': float,
        'tournament_relevance': float,  # Meta playability
        'upcoming_events': int,         # Days to next major event
    },

    # ══════════════════════════════════════════════════════════════════
    # COST FEATURES (18 features)
    # ══════════════════════════════════════════════════════════════════

    'costs': {
        # Your location context
        'user_country': str,            # For tax calculation
        'user_vat_rate': float,

        # Acquisition costs by source
        'total_cost_from_tcg': float,
        'total_cost_from_cm': float,
        'total_cost_from_uk': float,
        'total_cost_from_jp': float,

        # Cost components (for best source)
        'best_source': str,
        'base_price': float,
        'platform_fee': float,
        'currency_fee': float,
        'shipping_cost': float,
        'customs_duty': float,
        'import_vat': float,

        # Sale costs by destination
        'net_sale_to_tcg': float,
        'net_sale_to_cm': float,
        'net_sale_to_uk': float,
        'net_sale_to_local': float,

        # True margin
        'best_arbitrage_margin': float,
        'best_arbitrage_route': str,    # e.g., "TCG→UK"
    },

    # ══════════════════════════════════════════════════════════════════
    # SELLER FEATURES (12 features)
    # ══════════════════════════════════════════════════════════════════

    'seller': {
        'feedback_score': float,        # 0-100
        'feedback_count': int,
        'account_age_days': int,
        'professional': bool,
        'verified': bool,

        # Historical reliability
        'condition_accuracy': float,    # Historical match rate
        'shipping_speed_score': float,
        'response_rate': float,
        'dispute_rate': float,

        # Current listing quality
        'has_photos': bool,
        'description_quality': float,   # NLP-assessed
        'price_competitiveness': float, # vs similar listings
    },

    # ══════════════════════════════════════════════════════════════════
    # CARD IDENTITY FEATURES (10 features)
    # ══════════════════════════════════════════════════════════════════

    'card': {
        'language': str,
        'language_premium': float,      # vs English baseline
        'variant_type': str,
        'variant_premium': float,
        'condition': str,
        'condition_multiplier': float,
        'graded': bool,
        'grade': float,                 # If graded
        'grading_potential': float,     # EV of submitting
        'population': int,              # PSA pop if known
    },

    # ══════════════════════════════════════════════════════════════════
    # RISK FEATURES (15 features)
    # ══════════════════════════════════════════════════════════════════

    'risk': {
        # Market risk
        'price_var_95': float,          # 95% VaR over execution window
        'max_drawdown_30d': float,
        'downside_volatility': float,

        # Execution risk
        'execution_time_expected': float,
        'execution_time_variance': float,
        'settlement_risk': float,

        # Counterparty risk
        'seller_risk_score': float,
        'platform_risk_score': float,
        'condition_mismatch_prob': float,

        # Liquidity risk
        'exit_liquidity_score': float,
        'price_impact_estimate': float,

        # Currency risk
        'fx_volatility': float,
        'fx_var_95': float,

        # Composite
        'total_risk_score': float,
        'risk_adjusted_return': float,  # Sharpe-like ratio
    },

    # ══════════════════════════════════════════════════════════════════
    # TIMING FEATURES (10 features)
    # ══════════════════════════════════════════════════════════════════

    'timing': {
        'opportunity_age_hours': float, # How long has this existed
        'opportunity_decay_rate': float,# How fast is it closing
        'time_to_expiry': float,        # Estimated remaining window

        'optimal_execution_window': str,# Best time to execute
        'urgency_score': float,         # 0-1

        'market_hours_factor': float,   # Is market active now?
        'days_to_weekend': int,
        'days_to_holiday': int,
        'days_to_tournament': int,
        'days_to_set_release': int,
    },
}

TOTAL_FEATURES = 125
```

---

## Part IV: The Immune System

### Risk Management (The Body's Defense)

The neural engine must protect itself. Not every opportunity should be taken.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         IMMUNE RESPONSE SYSTEM                           │
└─────────────────────────────────────────────────────────────────────────┘

THREAT DETECTION:

  MARKET CRASH ANTIBODIES
  ├── Rapid price decline across set/market
  ├── Volume spike + price drop = panic selling
  ├── Bid-ask spread widening = liquidity crisis
  └── ACTION: Increase protective margins, reduce position sizes

  COUNTERPARTY INFECTION
  ├── Seller feedback declining
  ├── Multiple disputes reported
  ├── Account suspicious activity
  └── ACTION: Avoid seller, report to platform

  CONDITION MISMATCH VIRUS
  ├── Seller history of downgrades
  ├── No photos or low quality
  ├── Price too good to be true
  └── ACTION: Require verification, adjust EV down

  EXECUTION DELAY SYNDROME
  ├── Shipping delays accumulating
  ├── Customs holds increasing
  ├── Platform processing slow
  └── ACTION: Factor longer settlement, adjust for price movement

  CURRENCY SHOCK
  ├── FX volatility spiking
  ├── Economic news pending
  ├── Central bank announcements
  └── ACTION: Hedge currency exposure, tighten margins
```

**Automatic Circuit Breakers**

```python
CIRCUIT_BREAKERS = {
    'max_single_position': 0.10,      # Max 10% of capital in one card
    'max_market_exposure': 0.25,      # Max 25% in one market
    'max_seller_exposure': 0.05,      # Max 5% to one seller
    'max_pending_value': 0.50,        # Max 50% in transit

    'min_margin_boom': 0.05,          # 5% minimum in bull market
    'min_margin_normal': 0.10,        # 10% minimum normally
    'min_margin_volatile': 0.15,      # 15% in volatile conditions
    'min_margin_crash': 0.25,         # 25% in crash conditions

    'max_execution_days': 14,         # Don't take if >14 days settlement
    'max_price_var': 0.20,            # Skip if 95% VaR > 20%

    'min_seller_feedback': 95.0,      # Minimum feedback score
    'min_seller_transactions': 100,   # Minimum transaction count
    'max_seller_dispute_rate': 0.02,  # Maximum 2% dispute rate
}
```

---

## Part V: The Learning Genome

### What The Neural Engine Actually Learns

This is the crucial part. The model learns **mappings**:

```
INPUT SPACE                              OUTPUT SPACE
═══════════════                          ════════════════

125 features                             Opportunity Score
describing:                              ├── Type of opportunity
• All prices across markets              │   (10 classes)
• All costs for your location            │
• Seller reliability                     ├── Confidence
• Market conditions                      │   (0-1, calibrated)
• Risk factors                           │
• Timing urgency                         ├── Expected Return
                                         │   (%, after all costs)
         ─────────────────────▶          │
                                         ├── Risk Level
    [30 days × 125 features]             │   (LOW/MEDIUM/HIGH)
                                         │
                                         ├── Optimal Action
                                         │   (BUY/SELL/HOLD/AVOID)
                                         │
                                         ├── Urgency
                                         │   (IMMEDIATE/SHORT/MEDIUM/LONG)
                                         │
                                         └── Protective Margin
                                             (% buffer needed)
```

### Training Data Requirements

The embryo needs proper nutrition:

```
POSITIVE EXAMPLES (What to Learn):
══════════════════════════════════
1. Historical arbitrage opportunities that SUCCEEDED
   • Bought at price X, sold at price Y
   • Actual profit/loss recorded
   • Execution time recorded
   • All costs were as expected

2. Expert-labeled opportunities
   • Human traders identify good opportunities
   • Even if not executed, marked as valid

3. Synthetic opportunities (backtested)
   • Simulate execution on historical data
   • Calculate what profit WOULD have been

NEGATIVE EXAMPLES (What to Avoid):
════════════════════════════════════
1. Failed transactions
   • Condition mismatch
   • Seller didn't ship
   • Price moved against

2. Missed opportunities that were valid
   • Opportunity existed but wasn't taken
   • Window closed with profit available

3. False positives
   • Looked like opportunity but wasn't
   • Margin evaporated due to costs

OUTCOME TRACKING (Feedback Loop):
═════════════════════════════════
For each prediction, record:
• Was the opportunity taken?
• If taken, what was actual result?
• If not taken, what would result have been?
• Compare predicted vs actual return
• Compare predicted vs actual risk
```

---

## Part VI: The Metabolic System

### Capital Efficiency (Energy Management)

The engine must manage its resources efficiently:

```
CAPITAL ALLOCATION MODEL:

Available Capital: £10,000

┌─────────────────────────────────────────────────────────────────────────┐
│                       PORTFOLIO ALLOCATION                               │
└─────────────────────────────────────────────────────────────────────────┘

  ACTIVE POSITIONS (Max 50%)
  ├── In-Transit Purchases: £2,500 (25%)
  │   └── TCGplayer→UK: £1,500
  │   └── Cardmarket→UK: £700
  │   └── Japan→UK: £300
  │
  └── Inventory for Sale: £2,500 (25%)
      └── Listed on eBay: £1,200
      └── Listed on TCGplayer: £800
      └── Listed locally: £500

  RESERVED (Max 30%)
  ├── Opportunity Reserve: £2,000 (20%)
  │   └── Ready for immediate deployment
  │
  └── Risk Buffer: £1,000 (10%)
      └── For covering losses, returns, disputes

  MINIMUM LIQUID (Min 20%)
  └── Cash: £2,000 (20%)
      └── Never deploy, emergency only
```

**Kelly Criterion for Position Sizing**

```python
def kelly_position_size(win_prob, win_return, loss_return):
    """
    Optimal position size based on edge and odds.

    f* = (p * b - q) / b

    Where:
    p = probability of winning
    q = probability of losing (1-p)
    b = ratio of win to loss (win_return / |loss_return|)
    """
    q = 1 - win_prob
    b = win_return / abs(loss_return)

    kelly = (win_prob * b - q) / b

    # Half-Kelly for safety
    return max(0, kelly * 0.5)


# Example:
# 70% chance of 15% return, 30% chance of -10% loss
# Kelly = (0.7 * 1.5 - 0.3) / 1.5 = 0.5 = 50%
# Half-Kelly = 25% of capital
```

---

## Part VII: The Developmental Stages

### Embryonic Development Timeline

```
STAGE 1: ZYGOTE (Current)
════════════════════════
• Core architecture defined
• Feature space mapped
• Basic neural structure built
• Rule-based detectors operational
• No actual outcome learning yet

STAGE 2: BLASTOCYST (Next)
════════════════════════════
• Outcome tracking implemented
• Cost calculation precise
• Geolocation aware
• First training on historical data
• Begin feedback loop

STAGE 3: GASTRULATION (Week 2-4)
════════════════════════════════
• Differentiated cell layers
• Specialized detection modules
• Risk assessment calibrated
• Market phase detection
• Multi-market awareness

STAGE 4: ORGANOGENESIS (Week 4-8)
═════════════════════════════════
• Functional organs (modules)
• Real-time data streams
• Live prediction serving
• Automated execution (optional)
• Performance monitoring

STAGE 5: FETAL DEVELOPMENT (Week 8+)
════════════════════════════════════
• Continuous learning
• Self-improvement
• Adaptation to market changes
• New market integration
• Scale to more cards/markets

STAGE 6: BIRTH (Production)
═══════════════════════════
• Fully autonomous operation
• API serving to users
• Revenue generation
• Ongoing evolution
```

---

## Part VIII: Environmental Factors

### External Nutrients Required

```
DATA FEEDS (Oxygen):
• Real-time price updates (at least hourly)
  - TCGplayer API (US market)
  - Cardmarket API (EU market)
  - eBay Browse API (Global)
  - See: [GLOBAL_TCG_MARKETPLACES.md](./GLOBAL_TCG_MARKETPLACES.md)
• Currency exchange rates (real-time)
• Shipping rate databases
• Tax/customs databases
• Seller reputation APIs

INFRASTRUCTURE (Blood Supply):
• Low-latency database
• Caching layer (implemented)
• Queue system for async processing
• Monitoring and alerting
• Backup and recovery

HUMAN OVERSIGHT (Immune System Supplement):
• Expert validation of edge cases
• Manual review of large positions
• Feedback on prediction quality
• Market insight injection
• Anomaly investigation
```

---

## Part IX: The Genetic Mutations

### Possible Evolutionary Paths

The embryo may develop in different directions based on environmental pressures:

```
MUTATION A: THE SCALPER
═══════════════════════
• Optimized for high-frequency, low-margin
• Many small positions
• Very fast execution
• Requires excellent data feeds
• Risk: Death by a thousand cuts (fees)

MUTATION B: THE ARBITRAGEUR
═══════════════════════════
• Optimized for cross-market spreads
• Medium positions, medium hold time
• Requires multi-market presence
• Risk: Execution slippage

MUTATION C: THE SPECULATOR
══════════════════════════
• Optimized for trend-following
• Larger positions, longer hold
• Requires market phase detection
• Risk: Trend reversal

MUTATION D: THE GRADER
══════════════════════
• Optimized for grading arbitrage
• Buy raw, submit, sell graded
• Requires condition expertise
• Risk: Grading outcome uncertainty

MUTATION E: THE HYBRID
══════════════════════
• Combines multiple strategies
• Adaptive to market conditions
• Most complex but most robust
• Risk: Jack of all trades, master of none
```

---

## Appendix: The Complete Genome Sequence

```
NEURAL_EMBRYO_DNA = {
    'version': '0.1.0',
    'conception_date': '2026-01-08',
    'parent_strain': 'cardforum_ndis_v1',

    'chromosomes': {
        '1_geographic': MARKET_TOPOLOGY,
        '2_costs': COST_GENOME,
        '3_geolocation': LOCATION_MATRIX,
        '4_seller': SELLER_CONFIDENCE,
        '5_card': CARD_IDENTITY,
        '6_market': MARKET_TREND,
        '7_time': TIME_DYNAMICS,
    },

    'phenotype': {
        'input_shape': [30, 125],       # 30 days × 125 features
        'encoder': 'transformer',        # Self-attention for relationships
        'hidden_dims': [512, 256, 128],
        'output_heads': 7,               # All outputs defined above
        'dropout': 0.3,
        'activation': 'gelu',
    },

    'metabolism': {
        'max_capital_deployed': 0.80,
        'max_single_position': 0.10,
        'min_margin_requirement': 0.05,
        'kelly_fraction': 0.5,
    },

    'immune_system': {
        'circuit_breakers': CIRCUIT_BREAKERS,
        'risk_limits': RISK_LIMITS,
        'monitoring': MONITORING_CONFIG,
    },

    'environment': {
        'data_feeds': DATA_FEED_CONFIG,
        'refresh_rates': REFRESH_CONFIG,
        'fallback_sources': FALLBACK_CONFIG,
    },
}
```

---

*This document is alive. It will grow and change as the embryo develops. Each interaction with real market data will shape its final form.*

*The neural engine is not a tool. It is an organism. Feed it well, protect it from toxins, and let it grow.*

---

**Genesis Date:** 2026-01-08
**Genome Version:** 0.1.0
**Status:** Fertilized
**Next Milestone:** Blastocyst (Outcome Tracking)
