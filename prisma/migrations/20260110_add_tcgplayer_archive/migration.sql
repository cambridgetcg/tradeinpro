-- TCGPlayer Price Archive Tables
-- Similar structure to CardMarket but with USD as native currency
-- and TCGPlayer-specific condition codes (NM, LP, MP, HP, DMG)

-- ============================================================================
-- TCGPLAYER PRICE ARCHIVE
-- ============================================================================

-- Daily TCGPlayer price snapshot per card (aggregate)
CREATE TABLE IF NOT EXISTS "tcgplayer_price_archive" (
    "id" SERIAL PRIMARY KEY,
    "card_id" VARCHAR(100) NOT NULL,
    "date" DATE NOT NULL,

    -- Card metadata (denormalized for query efficiency)
    "game" VARCHAR(50) NOT NULL DEFAULT 'onepiece',
    "set_code" VARCHAR(20),
    "set_name" VARCHAR(200),
    "card_number" VARCHAR(20),
    "variant_type" VARCHAR(50),
    "card_name" VARCHAR(500),
    "rarity" VARCHAR(50),

    -- TCGPlayer product ID for API lookups
    "product_id" VARCHAR(50),

    -- Aggregate prices (USD - TCGPlayer native currency)
    "market_price_usd" DECIMAL(10, 2),
    "low_price_usd" DECIMAL(10, 2),
    "mid_price_usd" DECIMAL(10, 2),
    "high_price_usd" DECIMAL(10, 2),

    -- Converted to GBP (for arbitrage calculations)
    "market_price_gbp" DECIMAL(10, 2),
    "low_price_gbp" DECIMAL(10, 2),
    "mid_price_gbp" DECIMAL(10, 2),
    "high_price_gbp" DECIMAL(10, 2),

    -- Availability metrics
    "total_listings" INTEGER,
    "total_sellers" INTEGER,

    -- Price change indicators (from JustTCG stats or calculated)
    "price_change_24h" DECIMAL(8, 4),
    "price_change_7d" DECIMAL(8, 4),
    "price_change_30d" DECIMAL(8, 4),
    "price_change_90d" DECIMAL(8, 4),

    -- Statistics (from JustTCG)
    "avg_price_usd" DECIMAL(10, 2),
    "std_dev" DECIMAL(10, 4),
    "trend_slope" DECIMAL(10, 6),

    -- FX rate used
    "usd_gbp_rate" DECIMAL(12, 6),

    -- Image URL
    "image_url" VARCHAR(500),

    -- Source URL for verification
    "source_url" VARCHAR(500),

    -- Data source tracking
    "data_source" VARCHAR(20) NOT NULL DEFAULT 'justtcg', -- 'justtcg', 'brightdata', 'merged'

    -- Scrape metadata
    "scraped_at" TIMESTAMP NOT NULL DEFAULT NOW(),
    "scrape_success" BOOLEAN NOT NULL DEFAULT TRUE,

    CONSTRAINT "idx_tcg_archive_unique" UNIQUE ("card_id", "date")
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS "idx_tcg_archive_card" ON "tcgplayer_price_archive" ("card_id", "date" DESC);
CREATE INDEX IF NOT EXISTS "idx_tcg_archive_date" ON "tcgplayer_price_archive" ("date" DESC);
CREATE INDEX IF NOT EXISTS "idx_tcg_archive_set" ON "tcgplayer_price_archive" ("set_code", "date");
CREATE INDEX IF NOT EXISTS "idx_tcg_archive_variant" ON "tcgplayer_price_archive" ("variant_type", "date");
CREATE INDEX IF NOT EXISTS "idx_tcg_archive_game" ON "tcgplayer_price_archive" ("game", "date");
CREATE INDEX IF NOT EXISTS "idx_tcg_archive_source" ON "tcgplayer_price_archive" ("data_source", "date");

-- ============================================================================
-- TCGPLAYER CONDITION SNAPSHOT
-- ============================================================================

-- Condition-level price snapshot
-- TCGPlayer conditions: NM (Near Mint), LP (Lightly Played), MP (Moderately Played),
--                       HP (Heavily Played), DMG (Damaged)
-- Printing types: Normal, Foil

CREATE TABLE IF NOT EXISTS "tcgplayer_condition_snapshot" (
    "id" SERIAL PRIMARY KEY,
    "archive_id" INTEGER NOT NULL REFERENCES "tcgplayer_price_archive" ("id") ON DELETE CASCADE,
    "card_id" VARCHAR(100) NOT NULL,
    "date" DATE NOT NULL,

    -- Condition (1-5 mapped to codes)
    -- 1=NM, 2=LP, 3=MP, 4=HP, 5=DMG
    "condition_id" INTEGER NOT NULL,
    "condition_code" VARCHAR(5) NOT NULL, -- NM, LP, MP, HP, DMG
    "condition_name" VARCHAR(50),

    -- Printing type
    "printing" VARCHAR(20) NOT NULL DEFAULT 'Normal', -- Normal, Foil, Reverse Holo, etc.

    -- Prices for this condition (USD)
    "price_usd" DECIMAL(10, 2),
    "low_price_usd" DECIMAL(10, 2),
    "avg_price_usd" DECIMAL(10, 2),
    "high_price_usd" DECIMAL(10, 2),

    -- Converted to GBP
    "price_gbp" DECIMAL(10, 2),
    "low_price_gbp" DECIMAL(10, 2),

    -- Availability for this condition
    "listings_count" INTEGER,

    CONSTRAINT "idx_tcg_condition_unique" UNIQUE ("card_id", "date", "condition_code", "printing")
);

-- Indexes
CREATE INDEX IF NOT EXISTS "idx_tcg_condition_card" ON "tcgplayer_condition_snapshot" ("card_id", "date", "condition_code");
CREATE INDEX IF NOT EXISTS "idx_tcg_condition_date" ON "tcgplayer_condition_snapshot" ("date", "condition_code");
CREATE INDEX IF NOT EXISTS "idx_tcg_condition_code" ON "tcgplayer_condition_snapshot" ("condition_code", "date");
CREATE INDEX IF NOT EXISTS "idx_tcg_condition_printing" ON "tcgplayer_condition_snapshot" ("printing", "date");

-- ============================================================================
-- TCGPLAYER LISTING SNAPSHOT
-- ============================================================================

-- Seller listing snapshot for deep market analysis
CREATE TABLE IF NOT EXISTS "tcgplayer_listing_snapshot" (
    "id" SERIAL PRIMARY KEY,
    "card_id" VARCHAR(100) NOT NULL,
    "date" DATE NOT NULL,

    -- Seller info
    "seller_name" VARCHAR(200) NOT NULL,
    "seller_rating" DECIMAL(5, 2), -- Rating percentage (e.g., 99.5)
    "seller_sales" INTEGER, -- Total sales count

    -- Item details
    "condition_code" VARCHAR(5) NOT NULL,
    "printing" VARCHAR(20) NOT NULL DEFAULT 'Normal',
    "price_usd" DECIMAL(10, 2) NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,

    -- Shipping info
    "shipping_usd" DECIMAL(8, 2),
    "ships_from" VARCHAR(100),

    -- Item flags
    "is_foil" BOOLEAN NOT NULL DEFAULT FALSE,
    "is_first_edition" BOOLEAN NOT NULL DEFAULT FALSE,

    "scraped_at" TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS "idx_tcg_listing_card" ON "tcgplayer_listing_snapshot" ("card_id", "date");
CREATE INDEX IF NOT EXISTS "idx_tcg_listing_date_cond" ON "tcgplayer_listing_snapshot" ("date", "condition_code");
CREATE INDEX IF NOT EXISTS "idx_tcg_listing_seller" ON "tcgplayer_listing_snapshot" ("seller_name", "date");

-- ============================================================================
-- TCGPLAYER PRICE HISTORY (for 180-day JustTCG data)
-- ============================================================================

-- Stores 180-day price history from JustTCG API
CREATE TABLE IF NOT EXISTS "tcgplayer_price_history" (
    "id" SERIAL PRIMARY KEY,
    "card_id" VARCHAR(100) NOT NULL,
    "price_usd" DECIMAL(10, 2) NOT NULL,
    "price_gbp" DECIMAL(10, 2),
    "timestamp" TIMESTAMP NOT NULL,

    -- Source tracking
    "data_source" VARCHAR(20) NOT NULL DEFAULT 'justtcg',
    "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),

    CONSTRAINT "idx_tcg_history_unique" UNIQUE ("card_id", "timestamp")
);

-- Indexes for time-series queries
CREATE INDEX IF NOT EXISTS "idx_tcg_history_card_time" ON "tcgplayer_price_history" ("card_id", "timestamp" DESC);
CREATE INDEX IF NOT EXISTS "idx_tcg_history_time" ON "tcgplayer_price_history" ("timestamp" DESC);

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE "tcgplayer_price_archive" IS 'Daily TCGPlayer price snapshots (JustTCG API + Bright Data scraper)';
COMMENT ON TABLE "tcgplayer_condition_snapshot" IS 'Condition-specific prices (NM, LP, MP, HP, DMG) with printing variants';
COMMENT ON TABLE "tcgplayer_listing_snapshot" IS 'Individual seller listings for market depth analysis';
COMMENT ON TABLE "tcgplayer_price_history" IS '180-day price history from JustTCG API';
