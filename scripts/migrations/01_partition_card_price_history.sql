-- ============================================================================
-- PHASE 2: PARTITION card_price_history BY MONTH
-- ============================================================================
--
-- PREREQUISITES:
-- - Table size > 500 MB or query latency increasing
-- - Run during low-traffic window (02:00-05:00 UTC)
-- - Backup database before running
--
-- ESTIMATED DOWNTIME: 5-10 minutes (for table swap)
-- ROLLBACK: See section at bottom
-- ============================================================================

-- Step 1: Create the new partitioned table structure
-- ============================================================================

CREATE TABLE card_price_history_partitioned (
    id TEXT NOT NULL,
    card_id TEXT NOT NULL,
    game TEXT NOT NULL DEFAULT 'onepiece',
    set_code TEXT,
    price_jpy DECIMAL(10, 0),
    price_gbp DECIMAL(10, 2) NOT NULL,
    exchange_rate DECIMAL(10, 8),
    source_used TEXT NOT NULL,
    change DECIMAL(8, 4) NOT NULL DEFAULT 0,
    change_jpy DECIMAL(8, 4),
    change_fx DECIMAL(8, 4),
    snapshot_date DATE NOT NULL,

    -- Composite primary key required for partitioning
    PRIMARY KEY (id, snapshot_date)
) PARTITION BY RANGE (snapshot_date);

-- Step 2: Create monthly partitions
-- ============================================================================
-- Adjust date ranges based on your data. This creates partitions from Jan 2025.

-- 2025 Partitions
CREATE TABLE card_price_history_2025_01 PARTITION OF card_price_history_partitioned
    FOR VALUES FROM ('2025-01-01') TO ('2025-02-01');

CREATE TABLE card_price_history_2025_02 PARTITION OF card_price_history_partitioned
    FOR VALUES FROM ('2025-02-01') TO ('2025-03-01');

CREATE TABLE card_price_history_2025_03 PARTITION OF card_price_history_partitioned
    FOR VALUES FROM ('2025-03-01') TO ('2025-04-01');

CREATE TABLE card_price_history_2025_04 PARTITION OF card_price_history_partitioned
    FOR VALUES FROM ('2025-04-01') TO ('2025-05-01');

CREATE TABLE card_price_history_2025_05 PARTITION OF card_price_history_partitioned
    FOR VALUES FROM ('2025-05-01') TO ('2025-06-01');

CREATE TABLE card_price_history_2025_06 PARTITION OF card_price_history_partitioned
    FOR VALUES FROM ('2025-06-01') TO ('2025-07-01');

CREATE TABLE card_price_history_2025_07 PARTITION OF card_price_history_partitioned
    FOR VALUES FROM ('2025-07-01') TO ('2025-08-01');

CREATE TABLE card_price_history_2025_08 PARTITION OF card_price_history_partitioned
    FOR VALUES FROM ('2025-08-01') TO ('2025-09-01');

CREATE TABLE card_price_history_2025_09 PARTITION OF card_price_history_partitioned
    FOR VALUES FROM ('2025-09-01') TO ('2025-10-01');

CREATE TABLE card_price_history_2025_10 PARTITION OF card_price_history_partitioned
    FOR VALUES FROM ('2025-10-01') TO ('2025-11-01');

CREATE TABLE card_price_history_2025_11 PARTITION OF card_price_history_partitioned
    FOR VALUES FROM ('2025-11-01') TO ('2025-12-01');

CREATE TABLE card_price_history_2025_12 PARTITION OF card_price_history_partitioned
    FOR VALUES FROM ('2025-12-01') TO ('2026-01-01');

-- 2026 Partitions
CREATE TABLE card_price_history_2026_01 PARTITION OF card_price_history_partitioned
    FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');

CREATE TABLE card_price_history_2026_02 PARTITION OF card_price_history_partitioned
    FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');

CREATE TABLE card_price_history_2026_03 PARTITION OF card_price_history_partitioned
    FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');

CREATE TABLE card_price_history_2026_04 PARTITION OF card_price_history_partitioned
    FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');

CREATE TABLE card_price_history_2026_05 PARTITION OF card_price_history_partitioned
    FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');

CREATE TABLE card_price_history_2026_06 PARTITION OF card_price_history_partitioned
    FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');

CREATE TABLE card_price_history_2026_07 PARTITION OF card_price_history_partitioned
    FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');

CREATE TABLE card_price_history_2026_08 PARTITION OF card_price_history_partitioned
    FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');

CREATE TABLE card_price_history_2026_09 PARTITION OF card_price_history_partitioned
    FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');

CREATE TABLE card_price_history_2026_10 PARTITION OF card_price_history_partitioned
    FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');

CREATE TABLE card_price_history_2026_11 PARTITION OF card_price_history_partitioned
    FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');

CREATE TABLE card_price_history_2026_12 PARTITION OF card_price_history_partitioned
    FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');

-- Default partition for any data outside defined ranges
CREATE TABLE card_price_history_default PARTITION OF card_price_history_partitioned
    DEFAULT;

-- Step 3: Create indexes on the partitioned table
-- ============================================================================
-- Indexes are automatically created on each partition

CREATE INDEX idx_partitioned_card_date ON card_price_history_partitioned (card_id, snapshot_date);
CREATE INDEX idx_partitioned_set_date ON card_price_history_partitioned (set_code, snapshot_date);
CREATE INDEX idx_partitioned_game_date ON card_price_history_partitioned (game, snapshot_date);

-- Unique constraint for upserts
CREATE UNIQUE INDEX idx_partitioned_card_date_unique ON card_price_history_partitioned (card_id, snapshot_date);

-- Step 4: Migrate data
-- ============================================================================
-- Run this during low-traffic window

INSERT INTO card_price_history_partitioned
SELECT * FROM card_price_history;

-- Step 5: Verify data migration
-- ============================================================================
-- Check counts match before proceeding

SELECT 'Original' as table_name, COUNT(*) as count FROM card_price_history
UNION ALL
SELECT 'Partitioned' as table_name, COUNT(*) as count FROM card_price_history_partitioned;

-- Step 6: Swap tables (requires brief exclusive lock)
-- ============================================================================
-- Run these as a single transaction

BEGIN;

-- Rename original table
ALTER TABLE card_price_history RENAME TO card_price_history_old;

-- Rename partitioned table to original name
ALTER TABLE card_price_history_partitioned RENAME TO card_price_history;

COMMIT;

-- Step 7: Cleanup (after verifying everything works)
-- ============================================================================
-- Wait 24-48 hours before dropping old table

-- DROP TABLE card_price_history_old;

-- ============================================================================
-- ROLLBACK PROCEDURE
-- ============================================================================
-- If something goes wrong after the swap:
--
-- BEGIN;
-- ALTER TABLE card_price_history RENAME TO card_price_history_partitioned;
-- ALTER TABLE card_price_history_old RENAME TO card_price_history;
-- COMMIT;
-- ============================================================================

-- ============================================================================
-- FUTURE PARTITION MAINTENANCE
-- ============================================================================
-- Add new partitions before they're needed (run monthly via cron):
--
-- CREATE TABLE card_price_history_YYYY_MM PARTITION OF card_price_history
--     FOR VALUES FROM ('YYYY-MM-01') TO ('YYYY-MM+1-01');
--
-- Drop old partitions when archiving (instant operation):
--
-- DROP TABLE card_price_history_2025_01;
-- ============================================================================
