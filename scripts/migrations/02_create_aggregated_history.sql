-- ============================================================================
-- PHASE 3: CREATE AGGREGATED HISTORY TABLE FOR COLD TIER
-- ============================================================================
--
-- This creates a weekly aggregated table for historical data.
-- Use this to reduce storage for data older than 90-365 days.
--
-- Storage reduction: ~85% for historical data
-- ============================================================================

-- Step 1: Create the weekly aggregated table
-- ============================================================================

CREATE TABLE IF NOT EXISTS card_price_history_weekly (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,

    -- Card identification
    card_id TEXT NOT NULL,
    game TEXT NOT NULL DEFAULT 'onepiece',
    set_code TEXT,

    -- Week identifier (Monday of the week)
    week_start DATE NOT NULL,

    -- OHLC prices (Open, High, Low, Close) in GBP
    open_gbp DECIMAL(10, 2) NOT NULL,
    high_gbp DECIMAL(10, 2) NOT NULL,
    low_gbp DECIMAL(10, 2) NOT NULL,
    close_gbp DECIMAL(10, 2) NOT NULL,

    -- OHLC prices in JPY
    open_jpy DECIMAL(10, 0),
    high_jpy DECIMAL(10, 0),
    low_jpy DECIMAL(10, 0),
    close_jpy DECIMAL(10, 0),

    -- Volume (number of days with data)
    volume INT NOT NULL DEFAULT 7,

    -- Weekly change percentage
    change_pct DECIMAL(8, 4),

    -- Metadata
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- Unique constraint for upserts
    CONSTRAINT card_price_history_weekly_unique UNIQUE (card_id, week_start)
);

-- Step 2: Create indexes
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_weekly_card_week
    ON card_price_history_weekly (card_id, week_start);

CREATE INDEX IF NOT EXISTS idx_weekly_set_week
    ON card_price_history_weekly (set_code, week_start);

CREATE INDEX IF NOT EXISTS idx_weekly_game_week
    ON card_price_history_weekly (game, week_start);

-- Step 3: Create monthly aggregated table (for very old data)
-- ============================================================================

CREATE TABLE IF NOT EXISTS card_price_history_monthly (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,

    -- Card identification
    card_id TEXT NOT NULL,
    game TEXT NOT NULL DEFAULT 'onepiece',
    set_code TEXT,

    -- Month identifier (first day of month)
    month_start DATE NOT NULL,

    -- OHLC prices in GBP
    open_gbp DECIMAL(10, 2) NOT NULL,
    high_gbp DECIMAL(10, 2) NOT NULL,
    low_gbp DECIMAL(10, 2) NOT NULL,
    close_gbp DECIMAL(10, 2) NOT NULL,

    -- OHLC prices in JPY
    open_jpy DECIMAL(10, 0),
    high_jpy DECIMAL(10, 0),
    low_jpy DECIMAL(10, 0),
    close_jpy DECIMAL(10, 0),

    -- Volume (number of days with data)
    volume INT NOT NULL,

    -- Monthly change percentage
    change_pct DECIMAL(8, 4),

    -- Metadata
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- Unique constraint for upserts
    CONSTRAINT card_price_history_monthly_unique UNIQUE (card_id, month_start)
);

-- Step 4: Create indexes for monthly table
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_monthly_card_month
    ON card_price_history_monthly (card_id, month_start);

CREATE INDEX IF NOT EXISTS idx_monthly_set_month
    ON card_price_history_monthly (set_code, month_start);

-- ============================================================================
-- AGGREGATION QUERIES
-- ============================================================================

-- Aggregate daily data to weekly (run weekly for data older than 90 days)
-- Usage: Run as a scheduled job on Sundays

-- INSERT INTO card_price_history_weekly (
--     card_id, game, set_code, week_start,
--     open_gbp, high_gbp, low_gbp, close_gbp,
--     open_jpy, high_jpy, low_jpy, close_jpy,
--     volume, change_pct
-- )
-- SELECT
--     card_id,
--     game,
--     set_code,
--     DATE_TRUNC('week', snapshot_date)::DATE as week_start,
--     (ARRAY_AGG(price_gbp ORDER BY snapshot_date ASC))[1] as open_gbp,
--     MAX(price_gbp) as high_gbp,
--     MIN(price_gbp) as low_gbp,
--     (ARRAY_AGG(price_gbp ORDER BY snapshot_date DESC))[1] as close_gbp,
--     (ARRAY_AGG(price_jpy ORDER BY snapshot_date ASC))[1] as open_jpy,
--     MAX(price_jpy) as high_jpy,
--     MIN(price_jpy) as low_jpy,
--     (ARRAY_AGG(price_jpy ORDER BY snapshot_date DESC))[1] as close_jpy,
--     COUNT(*)::INT as volume,
--     CASE
--         WHEN (ARRAY_AGG(price_gbp ORDER BY snapshot_date ASC))[1] > 0
--         THEN (((ARRAY_AGG(price_gbp ORDER BY snapshot_date DESC))[1] -
--                (ARRAY_AGG(price_gbp ORDER BY snapshot_date ASC))[1]) /
--               (ARRAY_AGG(price_gbp ORDER BY snapshot_date ASC))[1]) * 100
--         ELSE 0
--     END as change_pct
-- FROM card_price_history
-- WHERE snapshot_date >= CURRENT_DATE - INTERVAL '97 days'
--   AND snapshot_date < CURRENT_DATE - INTERVAL '90 days'
-- GROUP BY card_id, game, set_code, DATE_TRUNC('week', snapshot_date)
-- ON CONFLICT (card_id, week_start) DO UPDATE SET
--     high_gbp = GREATEST(EXCLUDED.high_gbp, card_price_history_weekly.high_gbp),
--     low_gbp = LEAST(EXCLUDED.low_gbp, card_price_history_weekly.low_gbp),
--     close_gbp = EXCLUDED.close_gbp,
--     high_jpy = GREATEST(EXCLUDED.high_jpy, card_price_history_weekly.high_jpy),
--     low_jpy = LEAST(EXCLUDED.low_jpy, card_price_history_weekly.low_jpy),
--     close_jpy = EXCLUDED.close_jpy,
--     volume = EXCLUDED.volume,
--     change_pct = EXCLUDED.change_pct;
