-- Migration: Add price history and pipeline tracking tables
-- Date: 2026-01-08
-- Purpose: Support ML training data and pipeline monitoring

-- ============================================================================
-- Price History Table (for ML training data)
-- ============================================================================
CREATE TABLE IF NOT EXISTS price_history (
  id BIGSERIAL PRIMARY KEY,

  -- Card identifier (references card_prices_v2)
  card_id VARCHAR(100) NOT NULL,

  -- Date of the price snapshot (one row per card per day per source)
  price_date DATE NOT NULL,

  -- Prices from different sources
  tcgplayer_price_gbp DECIMAL(10, 2),
  cardmarket_price_gbp DECIMAL(10, 2),
  best_price_gbp DECIMAL(10, 2),
  tradein_price_gbp DECIMAL(10, 2),

  -- Price changes (calculated during transformation)
  pct_change_1d DECIMAL(8, 4),
  pct_change_7d DECIMAL(8, 4),
  pct_change_30d DECIMAL(8, 4),

  -- Market indicators
  available_count INTEGER,
  volatility_7d DECIMAL(8, 4),

  -- Source tracking
  source VARCHAR(50) NOT NULL,  -- 'tcgplayer', 'cardmarket', 'combined'

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- Unique constraint: one price per card per day per source
  UNIQUE(card_id, price_date, source)
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_price_history_card ON price_history(card_id);
CREATE INDEX IF NOT EXISTS idx_price_history_date ON price_history(price_date);
CREATE INDEX IF NOT EXISTS idx_price_history_source ON price_history(source);
CREATE INDEX IF NOT EXISTS idx_price_history_card_date ON price_history(card_id, price_date);
CREATE INDEX IF NOT EXISTS idx_price_history_date_source ON price_history(price_date, source);

-- ============================================================================
-- CardMarket Prices Table (detailed Cardmarket data)
-- ============================================================================
CREATE TABLE IF NOT EXISTS cardmarket_prices (
  id SERIAL PRIMARY KEY,

  -- Card identifier (references card_prices_v2)
  card_id VARCHAR(100) NOT NULL,

  -- Scraped prices (EUR - original currency)
  trend_price_eur DECIMAL(10, 2),
  low_price_eur DECIMAL(10, 2),
  avg_7d_price_eur DECIMAL(10, 2),
  avg_30d_price_eur DECIMAL(10, 2),
  avg_1d_price_eur DECIMAL(10, 2),

  -- Converted prices (GBP)
  trend_price_gbp DECIMAL(10, 2),
  low_price_gbp DECIMAL(10, 2),

  -- Metadata
  available_count INTEGER,
  source_url VARCHAR(500),
  exchange_rate DECIMAL(10, 6),

  -- Timestamps
  scraped_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- Unique constraint: one detailed price per card per day
  UNIQUE(card_id, (scraped_at::DATE))
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_cm_prices_card_id ON cardmarket_prices(card_id);
CREATE INDEX IF NOT EXISTS idx_cm_prices_scraped_at ON cardmarket_prices(scraped_at);
CREATE INDEX IF NOT EXISTS idx_cm_prices_trend ON cardmarket_prices(trend_price_gbp);

-- ============================================================================
-- Pipeline Runs Table (tracking pipeline executions)
-- ============================================================================
CREATE TABLE IF NOT EXISTS pipeline_runs (
  id SERIAL PRIMARY KEY,

  -- Unique run identifier
  run_id VARCHAR(100) UNIQUE NOT NULL,

  -- Status: 'running', 'completed', 'partial', 'failed'
  status VARCHAR(20) NOT NULL,

  -- Metrics
  sets_processed INTEGER DEFAULT 0,
  cards_scraped INTEGER DEFAULT 0,
  cards_updated INTEGER DEFAULT 0,
  errors_count INTEGER DEFAULT 0,

  -- Timing
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER,

  -- Details (JSON)
  error_details JSONB,
  metrics JSONB,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_status ON pipeline_runs(status);
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_started ON pipeline_runs(started_at);
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_run_id ON pipeline_runs(run_id);

-- ============================================================================
-- Pipeline Errors Table (detailed error tracking)
-- ============================================================================
CREATE TABLE IF NOT EXISTS pipeline_errors (
  id BIGSERIAL PRIMARY KEY,

  -- Error context
  run_id VARCHAR(100),
  card_id VARCHAR(100),
  set_code VARCHAR(20),

  -- Error details
  error_type VARCHAR(50) NOT NULL,
  error_message TEXT NOT NULL,
  stack_trace TEXT,

  -- Attempt tracking
  attempt_count INTEGER DEFAULT 1,

  -- Raw message (for DLQ processing)
  raw_message TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_pipeline_errors_run ON pipeline_errors(run_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_errors_card ON pipeline_errors(card_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_errors_type ON pipeline_errors(error_type);
CREATE INDEX IF NOT EXISTS idx_pipeline_errors_created ON pipeline_errors(created_at);

-- ============================================================================
-- Views for Analytics
-- ============================================================================

-- Daily price summary view
CREATE OR REPLACE VIEW v_daily_price_summary AS
SELECT
  price_date,
  COUNT(DISTINCT card_id) as cards_with_prices,
  AVG(best_price_gbp) as avg_price,
  MIN(best_price_gbp) as min_price,
  MAX(best_price_gbp) as max_price,
  SUM(available_count) as total_available
FROM price_history
WHERE source = 'cardmarket'
GROUP BY price_date
ORDER BY price_date DESC;

-- Price trend view (7-day moving average)
CREATE OR REPLACE VIEW v_price_trends AS
SELECT
  card_id,
  price_date,
  best_price_gbp,
  AVG(best_price_gbp) OVER (
    PARTITION BY card_id
    ORDER BY price_date
    ROWS BETWEEN 6 PRECEDING AND CURRENT ROW
  ) as ma_7d,
  AVG(best_price_gbp) OVER (
    PARTITION BY card_id
    ORDER BY price_date
    ROWS BETWEEN 29 PRECEDING AND CURRENT ROW
  ) as ma_30d
FROM price_history
WHERE source = 'cardmarket'
ORDER BY card_id, price_date;

-- Pipeline health view
CREATE OR REPLACE VIEW v_pipeline_health AS
SELECT
  DATE(started_at) as run_date,
  COUNT(*) as total_runs,
  SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as successful_runs,
  SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_runs,
  AVG(cards_updated) as avg_cards_updated,
  AVG(duration_ms) as avg_duration_ms,
  SUM(errors_count) as total_errors
FROM pipeline_runs
GROUP BY DATE(started_at)
ORDER BY run_date DESC;

-- ============================================================================
-- Comments
-- ============================================================================
COMMENT ON TABLE price_history IS 'Historical price data for ML training and analytics';
COMMENT ON TABLE cardmarket_prices IS 'Detailed Cardmarket price snapshots';
COMMENT ON TABLE pipeline_runs IS 'Pipeline execution tracking and metrics';
COMMENT ON TABLE pipeline_errors IS 'Detailed error logging for debugging';
COMMENT ON VIEW v_daily_price_summary IS 'Daily aggregated price statistics';
COMMENT ON VIEW v_price_trends IS 'Price trends with moving averages';
COMMENT ON VIEW v_pipeline_health IS 'Pipeline health metrics by day';
