-- Migration: Add Market Price Tables for CardMarket Data Collection Pipeline
-- Date: 2026-01-09
-- Purpose: Support multi-market price collection from OPTCG API, JustTCG, Cardmarket

-- =============================================================================
-- MARKET PRICES (US) - TCGplayer data from OPTCG API and JustTCG
-- =============================================================================

CREATE TABLE IF NOT EXISTS market_prices_us (
  id SERIAL PRIMARY KEY,
  card_id VARCHAR(50) NOT NULL,
  source VARCHAR(20) NOT NULL, -- 'optcg' | 'justtcg'

  -- Prices in USD
  market_price DECIMAL(10,2),
  low_price DECIMAL(10,2),
  mid_price DECIMAL(10,2),
  high_price DECIMAL(10,2),
  inventory_price DECIMAL(10,2), -- OPTCG specific

  -- Statistics (from JustTCG)
  change_24h DECIMAL(6,4),
  change_7d DECIMAL(6,4),
  change_30d DECIMAL(6,4),
  change_90d DECIMAL(6,4),
  avg_price DECIMAL(10,2),
  min_price DECIMAL(10,2),
  max_price DECIMAL(10,2),
  std_dev DECIMAL(10,2),
  trend_slope DECIMAL(10,6),

  -- Metadata
  collected_at TIMESTAMP NOT NULL DEFAULT NOW(),
  source_updated_at TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_market_prices_us_unique
  ON market_prices_us(card_id, source, collected_at);
CREATE INDEX IF NOT EXISTS idx_market_prices_us_card
  ON market_prices_us(card_id);
CREATE INDEX IF NOT EXISTS idx_market_prices_us_collected
  ON market_prices_us(collected_at DESC);

-- =============================================================================
-- MARKET PRICES (EU) - Cardmarket data from CSV downloads and Apify
-- =============================================================================

CREATE TABLE IF NOT EXISTS market_prices_eu (
  id SERIAL PRIMARY KEY,
  card_id VARCHAR(50) NOT NULL,
  source VARCHAR(20) NOT NULL, -- 'cardmarket_csv' | 'apify'

  -- Prices in EUR
  trend_price DECIMAL(10,2),
  avg_price DECIMAL(10,2),
  low_price DECIMAL(10,2),

  -- Cardmarket specific averages
  avg_1d DECIMAL(10,2),
  avg_7d DECIMAL(10,2),
  avg_30d DECIMAL(10,2),

  -- Metadata
  collected_at TIMESTAMP NOT NULL DEFAULT NOW(),
  source_updated_at TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_market_prices_eu_unique
  ON market_prices_eu(card_id, source, collected_at);
CREATE INDEX IF NOT EXISTS idx_market_prices_eu_card
  ON market_prices_eu(card_id);
CREATE INDEX IF NOT EXISTS idx_market_prices_eu_collected
  ON market_prices_eu(collected_at DESC);

-- =============================================================================
-- FX RATES - Exchange rates for currency conversion
-- =============================================================================

CREATE TABLE IF NOT EXISTS fx_rates (
  id SERIAL PRIMARY KEY,
  base_currency VARCHAR(3) NOT NULL DEFAULT 'GBP',
  target_currency VARCHAR(3) NOT NULL, -- 'USD', 'EUR', 'JPY'
  rate DECIMAL(12,6) NOT NULL,
  collected_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fx_rates_pair
  ON fx_rates(target_currency, collected_at DESC);
CREATE INDEX IF NOT EXISTS idx_fx_rates_collected
  ON fx_rates(collected_at DESC);

-- =============================================================================
-- PRICE HISTORY DAILY - Aggregated daily prices for training
-- =============================================================================

CREATE TABLE IF NOT EXISTS price_history_daily (
  id SERIAL PRIMARY KEY,
  card_id VARCHAR(50) NOT NULL,
  date DATE NOT NULL,

  -- US prices (in USD, converted to GBP)
  us_market_usd DECIMAL(10,2),
  us_low_usd DECIMAL(10,2),
  us_market_gbp DECIMAL(10,2),
  us_low_gbp DECIMAL(10,2),

  -- EU prices (in EUR, converted to GBP)
  eu_trend_eur DECIMAL(10,2),
  eu_low_eur DECIMAL(10,2),
  eu_trend_gbp DECIMAL(10,2),
  eu_low_gbp DECIMAL(10,2),

  -- Calculated spreads
  spread_eu_to_us DECIMAL(6,4), -- Buy EU, sell US
  spread_us_to_eu DECIMAL(6,4), -- Buy US, sell EU

  -- FX rates used
  fx_usd_gbp DECIMAL(12,6),
  fx_eur_gbp DECIMAL(12,6),

  -- Volume/activity indicators
  us_listings_count INT,
  eu_listings_count INT,

  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_price_history_daily_unique
  ON price_history_daily(card_id, date);
CREATE INDEX IF NOT EXISTS idx_price_history_daily_card
  ON price_history_daily(card_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_price_history_daily_date
  ON price_history_daily(date DESC);
CREATE INDEX IF NOT EXISTS idx_price_history_daily_spread
  ON price_history_daily(spread_eu_to_us DESC) WHERE spread_eu_to_us > 0;

-- =============================================================================
-- ARBITRAGE OPPORTUNITIES - Detected cross-market opportunities
-- =============================================================================

CREATE TABLE IF NOT EXISTS arbitrage_opportunities (
  id SERIAL PRIMARY KEY,
  card_id VARCHAR(50) NOT NULL,
  detected_at TIMESTAMP NOT NULL DEFAULT NOW(),

  -- Buy side
  buy_market VARCHAR(50) NOT NULL,
  buy_price DECIMAL(10,2) NOT NULL,
  buy_currency VARCHAR(3) NOT NULL,
  buy_price_gbp DECIMAL(10,2) NOT NULL,

  -- Sell side
  sell_market VARCHAR(50) NOT NULL,
  sell_price DECIMAL(10,2) NOT NULL,
  sell_currency VARCHAR(3) NOT NULL,
  sell_price_gbp DECIMAL(10,2) NOT NULL,

  -- Spread analysis
  gross_spread DECIMAL(6,4) NOT NULL,
  estimated_fees DECIMAL(6,4) NOT NULL,
  estimated_shipping DECIMAL(10,2) NOT NULL,
  net_spread DECIMAL(6,4) NOT NULL,

  -- Classification
  confidence DECIMAL(3,2) NOT NULL,
  urgency VARCHAR(20) NOT NULL, -- 'immediate', 'short', 'medium', 'low'

  -- Outcome (filled by user feedback)
  was_executed BOOLEAN,
  execution_timestamp TIMESTAMP,
  actual_buy_price DECIMAL(10,2),
  actual_sell_price DECIMAL(10,2),
  actual_profit DECIMAL(10,2),
  feedback_notes TEXT,

  -- Status
  status VARCHAR(20) NOT NULL DEFAULT 'active', -- 'active', 'executed', 'expired', 'invalid'
  expires_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_arbitrage_card_detected
  ON arbitrage_opportunities(card_id, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_arbitrage_net_spread
  ON arbitrage_opportunities(net_spread DESC) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_arbitrage_status
  ON arbitrage_opportunities(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_arbitrage_confidence
  ON arbitrage_opportunities(confidence DESC) WHERE status = 'active';

-- =============================================================================
-- JUSTTCG PRICE HISTORY - Raw price history from JustTCG API
-- =============================================================================

CREATE TABLE IF NOT EXISTS justtcg_price_history (
  id SERIAL PRIMARY KEY,
  card_id VARCHAR(50) NOT NULL,
  price DECIMAL(10,2) NOT NULL,
  price_timestamp TIMESTAMP NOT NULL, -- Unix timestamp from API
  collected_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_justtcg_history_unique
  ON justtcg_price_history(card_id, price_timestamp);
CREATE INDEX IF NOT EXISTS idx_justtcg_history_card
  ON justtcg_price_history(card_id, price_timestamp DESC);

-- =============================================================================
-- TRAINING DATA FEEDBACK - User feedback for model training
-- =============================================================================

CREATE TABLE IF NOT EXISTS training_feedback (
  id SERIAL PRIMARY KEY,
  feedback_type VARCHAR(50) NOT NULL, -- 'arbitrage', 'condition', 'image_label', 'trade'

  -- Reference to source data
  reference_id VARCHAR(100), -- arbitrage_opportunity_id, card_id, etc.
  reference_type VARCHAR(50),

  -- Feedback data (JSON for flexibility)
  feedback_data JSONB NOT NULL,

  -- User info
  user_id VARCHAR(100),
  user_accuracy_score DECIMAL(3,2), -- Historical accuracy of this user

  -- Quality control
  is_verified BOOLEAN DEFAULT false,
  verification_source VARCHAR(50), -- 'gold_standard', 'consensus', 'expert'

  -- Timestamps
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  verified_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_training_feedback_type
  ON training_feedback(feedback_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_training_feedback_reference
  ON training_feedback(reference_type, reference_id);
CREATE INDEX IF NOT EXISTS idx_training_feedback_verified
  ON training_feedback(is_verified, feedback_type);

-- =============================================================================
-- TRADE LOG - User trade history for outcome tracking
-- =============================================================================

CREATE TABLE IF NOT EXISTS trade_log (
  id SERIAL PRIMARY KEY,
  card_id VARCHAR(50) NOT NULL,
  user_id VARCHAR(100),

  -- Trade details
  action VARCHAR(10) NOT NULL, -- 'buy' | 'sell'
  platform VARCHAR(50) NOT NULL, -- 'tcgplayer', 'cardmarket', 'ebay', etc.
  price DECIMAL(10,2) NOT NULL,
  currency VARCHAR(3) NOT NULL,
  price_gbp DECIMAL(10,2) NOT NULL,
  quantity INT NOT NULL DEFAULT 1,
  condition VARCHAR(10),
  shipping_cost DECIMAL(10,2),
  fees DECIMAL(10,2),

  -- Link buy/sell pairs
  linked_trade_id INT REFERENCES trade_log(id),

  -- Model predictions at time of trade
  model_predicted_return DECIMAL(6,4),
  model_confidence DECIMAL(3,2),

  -- Outcome (for closed positions)
  is_closed BOOLEAN DEFAULT false,
  actual_return DECIMAL(6,4),
  holding_days INT,

  -- Notes
  notes TEXT,

  -- Timestamps
  trade_date DATE NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trade_log_card
  ON trade_log(card_id, trade_date DESC);
CREATE INDEX IF NOT EXISTS idx_trade_log_user
  ON trade_log(user_id, trade_date DESC);
CREATE INDEX IF NOT EXISTS idx_trade_log_open
  ON trade_log(is_closed, action) WHERE is_closed = false;

-- =============================================================================
-- COLLECTION JOB STATUS - Track data collection job executions
-- =============================================================================

CREATE TABLE IF NOT EXISTS collection_job_status (
  id SERIAL PRIMARY KEY,
  job_name VARCHAR(100) NOT NULL, -- 'optcg_sync', 'justtcg_sync', 'cardmarket_csv', etc.

  -- Execution info
  started_at TIMESTAMP NOT NULL,
  completed_at TIMESTAMP,
  status VARCHAR(20) NOT NULL DEFAULT 'running', -- 'running', 'success', 'failed'

  -- Results
  records_processed INT,
  records_created INT,
  records_updated INT,
  errors_count INT DEFAULT 0,

  -- Error details
  error_message TEXT,
  error_details JSONB,

  -- Metadata
  metadata JSONB
);

CREATE INDEX IF NOT EXISTS idx_collection_job_name
  ON collection_job_status(job_name, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_collection_job_status
  ON collection_job_status(status, started_at DESC);
