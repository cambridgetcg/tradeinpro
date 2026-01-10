-- Migration: Add statistics tables and inventory fields for ML feature gaps
-- Date: 2026-01-09
-- Purpose: Fill hardcoded feature gaps identified in DATA_PIPELINE_LEAKAGE_ANALYSIS.md

-- =============================================================================
-- PHASE 1: Add inventory/volume fields to existing tables
-- =============================================================================

-- Add inventory signals to MarketPriceEU (from Cardmarket CSV)
ALTER TABLE "market_prices_eu"
ADD COLUMN IF NOT EXISTS "available_items" INTEGER,
ADD COLUMN IF NOT EXISTS "available_foils" INTEGER;

-- Add volume signals to MarketPriceUS (from JustTCG)
ALTER TABLE "market_prices_us"
ADD COLUMN IF NOT EXISTS "listings_count" INTEGER,
ADD COLUMN IF NOT EXISTS "conditions_available" INTEGER;

-- =============================================================================
-- PHASE 2: Create statistics tables for calculated features
-- =============================================================================

-- Rarity-level statistics for percentile calculations
CREATE TABLE IF NOT EXISTS "rarity_statistics" (
    "id" SERIAL PRIMARY KEY,
    "game" VARCHAR(50) NOT NULL DEFAULT 'onepiece',
    "rarity" VARCHAR(50) NOT NULL,

    -- Price distribution percentiles (in GBP)
    "p10" DECIMAL(10, 2) NOT NULL,
    "p25" DECIMAL(10, 2) NOT NULL,
    "p50" DECIMAL(10, 2) NOT NULL,
    "p75" DECIMAL(10, 2) NOT NULL,
    "p90" DECIMAL(10, 2) NOT NULL,
    "p95" DECIMAL(10, 2) NOT NULL,
    "p99" DECIMAL(10, 2) NOT NULL,

    -- Momentum metrics
    "momentum_7d" DECIMAL(6, 4),
    "momentum_30d" DECIMAL(6, 4),

    -- Card count in this rarity
    "card_count" INTEGER NOT NULL,

    -- Average price for this rarity
    "avg_price" DECIMAL(10, 2) NOT NULL,

    -- Snapshot timestamp
    "snapshot_date" DATE NOT NULL,
    "created_at" TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT "rarity_statistics_unique" UNIQUE ("game", "rarity", "snapshot_date")
);

CREATE INDEX IF NOT EXISTS "idx_rarity_stats_game_date" ON "rarity_statistics" ("game", "snapshot_date");
CREATE INDEX IF NOT EXISTS "idx_rarity_stats_rarity" ON "rarity_statistics" ("rarity");

-- Set-level statistics for set momentum and correlation
CREATE TABLE IF NOT EXISTS "set_statistics" (
    "id" SERIAL PRIMARY KEY,
    "game" VARCHAR(50) NOT NULL DEFAULT 'onepiece',
    "set_code" VARCHAR(20) NOT NULL,

    -- Price metrics
    "avg_price" DECIMAL(10, 2) NOT NULL,
    "median_price" DECIMAL(10, 2) NOT NULL,
    "total_market_cap" DECIMAL(14, 2) NOT NULL,
    "min_price" DECIMAL(10, 2),
    "max_price" DECIMAL(10, 2),

    -- Momentum metrics
    "momentum_7d" DECIMAL(6, 4),
    "momentum_30d" DECIMAL(6, 4),

    -- Card count
    "card_count" INTEGER NOT NULL,

    -- Volatility
    "volatility_7d" DECIMAL(6, 4),

    -- Snapshot timestamp
    "snapshot_date" DATE NOT NULL,
    "created_at" TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT "set_statistics_unique" UNIQUE ("game", "set_code", "snapshot_date")
);

CREATE INDEX IF NOT EXISTS "idx_set_stats_game_date" ON "set_statistics" ("game", "snapshot_date");
CREATE INDEX IF NOT EXISTS "idx_set_stats_set_code" ON "set_statistics" ("set_code");

-- Card-level correlation cache (updated daily)
CREATE TABLE IF NOT EXISTS "card_correlation_cache" (
    "id" SERIAL PRIMARY KEY,
    "card_id" VARCHAR(100) NOT NULL,
    "game" VARCHAR(50) NOT NULL DEFAULT 'onepiece',

    -- Correlation coefficients
    "correlation_to_set" DECIMAL(5, 4),
    "correlation_to_rarity" DECIMAL(5, 4),
    "correlation_deviation" DECIMAL(5, 4),

    -- Sample size used for calculation
    "sample_days" INTEGER NOT NULL,

    -- Statistical significance
    "p_value_set" DECIMAL(8, 6),
    "p_value_rarity" DECIMAL(8, 6),

    -- Snapshot timestamp
    "snapshot_date" DATE NOT NULL,
    "created_at" TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT "card_correlation_unique" UNIQUE ("card_id", "snapshot_date")
);

CREATE INDEX IF NOT EXISTS "idx_card_correlation_card" ON "card_correlation_cache" ("card_id");
CREATE INDEX IF NOT EXISTS "idx_card_correlation_date" ON "card_correlation_cache" ("snapshot_date");

-- Volume/inventory cache for relative calculations
CREATE TABLE IF NOT EXISTS "volume_statistics" (
    "id" SERIAL PRIMARY KEY,
    "game" VARCHAR(50) NOT NULL DEFAULT 'onepiece',

    -- Average listings counts (for relative_volume calculation)
    "avg_us_listings" DECIMAL(10, 2),
    "avg_eu_listings" DECIMAL(10, 2),
    "total_cards_tracked" INTEGER NOT NULL,

    -- By rarity averages
    "avg_listings_by_rarity" JSONB,

    -- Snapshot timestamp
    "snapshot_date" DATE NOT NULL,
    "created_at" TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT "volume_statistics_unique" UNIQUE ("game", "snapshot_date")
);

CREATE INDEX IF NOT EXISTS "idx_volume_stats_date" ON "volume_statistics" ("snapshot_date");

-- =============================================================================
-- COMMENTS
-- =============================================================================

COMMENT ON TABLE "rarity_statistics" IS 'Daily rarity-level price statistics for percentile_in_rarity feature';
COMMENT ON TABLE "set_statistics" IS 'Daily set-level statistics for set_momentum and correlation features';
COMMENT ON TABLE "card_correlation_cache" IS 'Daily correlation cache for correlation_to_set/rarity features';
COMMENT ON TABLE "volume_statistics" IS 'Daily volume averages for relative_volume feature normalization';
