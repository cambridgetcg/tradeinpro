-- CreateTable: Price Index Snapshots
CREATE TABLE IF NOT EXISTS "price_index_snapshots" (
    "id" TEXT NOT NULL,
    "index_type" TEXT NOT NULL,
    "index_key" TEXT NOT NULL,
    "value" DECIMAL(12,4) NOT NULL,
    "change_24h" DECIMAL(8,4) NOT NULL DEFAULT 0,
    "change_7d" DECIMAL(8,4) NOT NULL DEFAULT 0,
    "change_30d" DECIMAL(8,4) NOT NULL DEFAULT 0,
    "card_count" INTEGER NOT NULL,
    "total_market_cap" DECIMAL(14,2) NOT NULL,
    "avg_price" DECIMAL(10,2) NOT NULL,
    "volatility" DECIMAL(8,4) NOT NULL DEFAULT 0,
    "high_price" DECIMAL(10,2) NOT NULL,
    "low_price" DECIMAL(10,2) NOT NULL,
    "snapshot_date" DATE NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "price_index_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable: Card Price History
CREATE TABLE IF NOT EXISTS "card_price_history" (
    "id" TEXT NOT NULL,
    "card_id" TEXT NOT NULL,
    "game" TEXT NOT NULL DEFAULT 'onepiece',
    "set_code" TEXT,
    "price_gbp" DECIMAL(10,2) NOT NULL,
    "source_used" TEXT NOT NULL,
    "change" DECIMAL(8,4) NOT NULL DEFAULT 0,
    "snapshot_date" DATE NOT NULL,

    CONSTRAINT "card_price_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable: Price Correlations
CREATE TABLE IF NOT EXISTS "price_correlations" (
    "id" TEXT NOT NULL,
    "entity_a" TEXT NOT NULL,
    "entity_b" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL DEFAULT 'card',
    "correlation" DECIMAL(5,4) NOT NULL,
    "sample_size" INTEGER NOT NULL,
    "p_value" DECIMAL(8,6),
    "calculated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "price_correlations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: Price Index Snapshots
CREATE UNIQUE INDEX IF NOT EXISTS "price_index_snapshots_index_type_index_key_snapshot_date_key" ON "price_index_snapshots"("index_type", "index_key", "snapshot_date");
CREATE INDEX IF NOT EXISTS "idx_price_index_type_date" ON "price_index_snapshots"("index_type", "snapshot_date");
CREATE INDEX IF NOT EXISTS "idx_price_index_key" ON "price_index_snapshots"("index_key");

-- CreateIndex: Card Price History
CREATE UNIQUE INDEX IF NOT EXISTS "card_price_history_card_id_snapshot_date_key" ON "card_price_history"("card_id", "snapshot_date");
CREATE INDEX IF NOT EXISTS "idx_card_history_id_date" ON "card_price_history"("card_id", "snapshot_date");
CREATE INDEX IF NOT EXISTS "idx_card_history_game_date" ON "card_price_history"("game", "snapshot_date");
CREATE INDEX IF NOT EXISTS "idx_card_history_set_date" ON "card_price_history"("set_code", "snapshot_date");

-- CreateIndex: Price Correlations
CREATE UNIQUE INDEX IF NOT EXISTS "price_correlations_entity_a_entity_b_key" ON "price_correlations"("entity_a", "entity_b");
CREATE INDEX IF NOT EXISTS "idx_correlation_entity_a" ON "price_correlations"("entity_a");
CREATE INDEX IF NOT EXISTS "idx_correlation_entity_b" ON "price_correlations"("entity_b");
CREATE INDEX IF NOT EXISTS "idx_correlation_value" ON "price_correlations"("correlation");
