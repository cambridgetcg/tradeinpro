-- CreateTable: CardMarket Price Archive (daily aggregate)
CREATE TABLE IF NOT EXISTS "cardmarket_price_archive" (
    "id" SERIAL NOT NULL,
    "card_id" VARCHAR(100) NOT NULL,
    "date" DATE NOT NULL,
    "game" VARCHAR(50) NOT NULL DEFAULT 'onepiece',
    "set_code" VARCHAR(20),
    "card_number" VARCHAR(20),
    "variant_type" VARCHAR(50),
    "card_name" VARCHAR(500),
    "trend_price_eur" DECIMAL(10,2),
    "from_price_eur" DECIMAL(10,2),
    "avg7_price_eur" DECIMAL(10,2),
    "avg30_price_eur" DECIMAL(10,2),
    "trend_price_gbp" DECIMAL(10,2),
    "from_price_gbp" DECIMAL(10,2),
    "avg7_price_gbp" DECIMAL(10,2),
    "avg30_price_gbp" DECIMAL(10,2),
    "total_listings" INTEGER,
    "total_sellers" INTEGER,
    "price_change_7d" DECIMAL(8,4),
    "price_change_30d" DECIMAL(8,4),
    "eur_gbp_rate" DECIMAL(12,6),
    "source_url" VARCHAR(500),
    "scraped_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scrape_success" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "cardmarket_price_archive_pkey" PRIMARY KEY ("id")
);

-- CreateTable: CardMarket Condition Snapshot (condition x language partition)
CREATE TABLE IF NOT EXISTS "cardmarket_condition_snapshot" (
    "id" SERIAL NOT NULL,
    "archive_id" INTEGER NOT NULL,
    "card_id" VARCHAR(100) NOT NULL,
    "date" DATE NOT NULL,
    "condition_id" INTEGER NOT NULL,
    "condition_code" VARCHAR(5) NOT NULL,
    "language_id" INTEGER NOT NULL DEFAULT 1,
    "language_code" VARCHAR(5) NOT NULL DEFAULT 'EN',
    "from_price_eur" DECIMAL(10,2),
    "avg_price_eur" DECIMAL(10,2),
    "high_price_eur" DECIMAL(10,2),
    "from_price_gbp" DECIMAL(10,2),
    "avg_price_gbp" DECIMAL(10,2),
    "high_price_gbp" DECIMAL(10,2),
    "listings_count" INTEGER,
    "sellers_count" INTEGER,

    CONSTRAINT "cardmarket_condition_snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable: CardMarket Listing Snapshot (individual seller listings)
CREATE TABLE IF NOT EXISTS "cardmarket_listing_snapshot" (
    "id" SERIAL NOT NULL,
    "card_id" VARCHAR(100) NOT NULL,
    "date" DATE NOT NULL,
    "seller_name" VARCHAR(200) NOT NULL,
    "seller_country" VARCHAR(5),
    "seller_sales" INTEGER,
    "seller_rating" DECIMAL(3,2),
    "condition_code" VARCHAR(5) NOT NULL,
    "language_code" VARCHAR(5) NOT NULL DEFAULT 'EN',
    "price_eur" DECIMAL(10,2) NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "is_playset" BOOLEAN NOT NULL DEFAULT false,
    "is_signed" BOOLEAN NOT NULL DEFAULT false,
    "is_first_ed" BOOLEAN NOT NULL DEFAULT false,
    "is_altered" BOOLEAN NOT NULL DEFAULT false,
    "shipping_country" VARCHAR(5),
    "scraped_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cardmarket_listing_snapshot_pkey" PRIMARY KEY ("id")
);

-- Unique Constraints
CREATE UNIQUE INDEX IF NOT EXISTS "idx_cm_archive_unique" ON "cardmarket_price_archive"("card_id", "date");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_cm_condition_unique" ON "cardmarket_condition_snapshot"("card_id", "date", "condition_code", "language_code");

-- CardMarket Price Archive Indexes
CREATE INDEX IF NOT EXISTS "idx_cm_archive_card" ON "cardmarket_price_archive"("card_id", "date" DESC);
CREATE INDEX IF NOT EXISTS "idx_cm_archive_date" ON "cardmarket_price_archive"("date" DESC);
CREATE INDEX IF NOT EXISTS "idx_cm_archive_set" ON "cardmarket_price_archive"("set_code", "date");
CREATE INDEX IF NOT EXISTS "idx_cm_archive_variant" ON "cardmarket_price_archive"("variant_type", "date");
CREATE INDEX IF NOT EXISTS "idx_cm_archive_game" ON "cardmarket_price_archive"("game", "date");

-- Condition Snapshot Indexes
CREATE INDEX IF NOT EXISTS "idx_cm_condition_card" ON "cardmarket_condition_snapshot"("card_id", "date", "condition_code");
CREATE INDEX IF NOT EXISTS "idx_cm_condition_date" ON "cardmarket_condition_snapshot"("date", "condition_code");
CREATE INDEX IF NOT EXISTS "idx_cm_condition_code" ON "cardmarket_condition_snapshot"("condition_code", "date");
CREATE INDEX IF NOT EXISTS "idx_cm_condition_lang" ON "cardmarket_condition_snapshot"("language_code", "date");

-- Listing Snapshot Indexes
CREATE INDEX IF NOT EXISTS "idx_cm_listing_card" ON "cardmarket_listing_snapshot"("card_id", "date");
CREATE INDEX IF NOT EXISTS "idx_cm_listing_date_cond" ON "cardmarket_listing_snapshot"("date", "condition_code");
CREATE INDEX IF NOT EXISTS "idx_cm_listing_country" ON "cardmarket_listing_snapshot"("seller_country", "date");

-- Foreign Key: Condition Snapshot -> Price Archive
ALTER TABLE "cardmarket_condition_snapshot"
ADD CONSTRAINT "cardmarket_condition_snapshot_archive_id_fkey"
FOREIGN KEY ("archive_id") REFERENCES "cardmarket_price_archive"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
