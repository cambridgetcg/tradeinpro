-- DropIndex
DROP INDEX "idx_card_history_detail_covering";

-- DropIndex
DROP INDEX "idx_card_history_set_covering";

-- AlterTable
ALTER TABLE "exchange_rate_history" ALTER COLUMN "source" SET NOT NULL,
ALTER COLUMN "created_at" SET NOT NULL;

-- CreateTable
CREATE TABLE "index_constituents" (
    "id" TEXT NOT NULL,
    "card_id" TEXT NOT NULL,
    "game" TEXT NOT NULL DEFAULT 'onepiece',
    "rank" INTEGER NOT NULL,
    "previous_rank" INTEGER,
    "raw_weight" DECIMAL(10,8) NOT NULL,
    "capped_weight" DECIMAL(10,8) NOT NULL,
    "market_cap" DECIMAL(14,2) NOT NULL,
    "price_gbp" DECIMAL(10,2) NOT NULL,
    "days_in_index" INTEGER NOT NULL DEFAULT 0,
    "in_buffer_zone" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "index_constituents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "index_reconstitutions" (
    "id" TEXT NOT NULL,
    "game" TEXT NOT NULL DEFAULT 'onepiece',
    "additions" TEXT[],
    "removals" TEXT[],
    "retained" INTEGER NOT NULL,
    "buffer_zone_protected" INTEGER NOT NULL,
    "reconstitution_date" DATE NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "index_reconstitutions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "index_weight_history" (
    "id" TEXT NOT NULL,
    "card_id" TEXT NOT NULL,
    "game" TEXT NOT NULL DEFAULT 'onepiece',
    "rank" INTEGER NOT NULL,
    "raw_weight" DECIMAL(10,8) NOT NULL,
    "capped_weight" DECIMAL(10,8) NOT NULL,
    "price_gbp" DECIMAL(10,2) NOT NULL,
    "snapshot_date" DATE NOT NULL,

    CONSTRAINT "index_weight_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "neural_predictions" (
    "id" TEXT NOT NULL,
    "card_id" TEXT NOT NULL,
    "game" TEXT NOT NULL DEFAULT 'onepiece',
    "price_24h" DECIMAL(10,2),
    "price_7d" DECIMAL(10,2),
    "price_30d" DECIMAL(10,2),
    "confidence_24h" DECIMAL(5,4),
    "confidence_7d" DECIMAL(5,4),
    "confidence_30d" DECIMAL(5,4),
    "model_version" TEXT NOT NULL,
    "feature_vector" JSONB,
    "predicted_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ,

    CONSTRAINT "neural_predictions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "neural_deals" (
    "id" TEXT NOT NULL,
    "card_id" TEXT NOT NULL,
    "game" TEXT NOT NULL DEFAULT 'onepiece',
    "deal_type" TEXT NOT NULL,
    "confidence" DECIMAL(5,4) NOT NULL,
    "expected_return" DECIMAL(8,4) NOT NULL,
    "time_horizon" TEXT NOT NULL,
    "risk_level" TEXT NOT NULL,
    "action_type" TEXT NOT NULL,
    "buy_market" TEXT,
    "buy_price" DECIMAL(10,2),
    "sell_market" TEXT,
    "sell_price" DECIMAL(10,2),
    "metadata" JSONB,
    "feature_importance" JSONB,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "executed_at" TIMESTAMPTZ,
    "actual_return" DECIMAL(8,4),

    CONSTRAINT "neural_deals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "neural_model_history" (
    "id" TEXT NOT NULL,
    "model_version" TEXT NOT NULL,
    "training_samples" INTEGER NOT NULL,
    "validation_samples" INTEGER NOT NULL,
    "deal_type_accuracy" DECIMAL(5,4),
    "confidence_brier_score" DECIMAL(5,4),
    "return_mae" DECIMAL(5,4),
    "risk_f1_score" DECIMAL(5,4),
    "weights_url" TEXT,
    "trained_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deployed_at" TIMESTAMPTZ,
    "retired_at" TIMESTAMPTZ,
    "notes" TEXT,

    CONSTRAINT "neural_model_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "neural_model_metrics" (
    "id" TEXT NOT NULL,
    "card_id" TEXT NOT NULL,
    "model_version" TEXT NOT NULL,
    "predicted_deal_type" TEXT,
    "predicted_confidence" DECIMAL(5,4),
    "predicted_return" DECIMAL(8,4),
    "actual_deal_type" TEXT,
    "actual_return" DECIMAL(8,4),
    "isCorrect" BOOLEAN,
    "timestamp" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "neural_model_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" TEXT NOT NULL,
    "key_hash" TEXT NOT NULL,
    "key_prefix" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "user_id" TEXT,
    "organization" TEXT,
    "email" TEXT NOT NULL,
    "tier" TEXT NOT NULL DEFAULT 'free',
    "rate_limit_daily" INTEGER NOT NULL DEFAULT 100,
    "rate_limit_minute" INTEGER NOT NULL DEFAULT 10,
    "allowed_endpoints" TEXT[] DEFAULT ARRAY['*']::TEXT[],
    "allowed_games" TEXT[] DEFAULT ARRAY['onepiece']::TEXT[],
    "max_history_days" INTEGER NOT NULL DEFAULT 0,
    "bulk_access" BOOLEAN NOT NULL DEFAULT false,
    "webhook_access" BOOLEAN NOT NULL DEFAULT false,
    "streaming_access" BOOLEAN NOT NULL DEFAULT false,
    "neural_access" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ,
    "last_used_at" TIMESTAMPTZ,
    "stripe_customer_id" TEXT,
    "billing_email" TEXT,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_usage" (
    "id" TEXT NOT NULL,
    "api_key_id" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "status_code" INTEGER NOT NULL,
    "response_time_ms" INTEGER NOT NULL,
    "tier" TEXT NOT NULL,
    "billable_units" INTEGER NOT NULL DEFAULT 1,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "request_timestamp" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_usage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_webhooks" (
    "id" TEXT NOT NULL,
    "api_key_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "events" TEXT[],
    "secret" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "card_ids" TEXT[],
    "games" TEXT[] DEFAULT ARRAY['onepiece']::TEXT[],
    "min_price_change" DECIMAL(8,4),
    "last_delivered_at" TIMESTAMPTZ,
    "failure_count" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "api_webhooks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_rate_limits" (
    "id" TEXT NOT NULL,
    "api_key_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "daily_count" INTEGER NOT NULL DEFAULT 0,
    "minute_count" INTEGER NOT NULL DEFAULT 0,
    "minute_window" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "api_rate_limits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_constituent_game_active" ON "index_constituents"("game", "is_active");

-- CreateIndex
CREATE INDEX "idx_constituent_rank" ON "index_constituents"("game", "rank");

-- CreateIndex
CREATE INDEX "idx_constituent_card" ON "index_constituents"("card_id");

-- CreateIndex
CREATE UNIQUE INDEX "index_constituents_game_card_id_is_active_key" ON "index_constituents"("game", "card_id", "is_active");

-- CreateIndex
CREATE INDEX "idx_reconstitution_game_date" ON "index_reconstitutions"("game", "reconstitution_date");

-- CreateIndex
CREATE INDEX "idx_weight_history_game_date" ON "index_weight_history"("game", "snapshot_date");

-- CreateIndex
CREATE INDEX "idx_weight_history_card_date" ON "index_weight_history"("card_id", "snapshot_date");

-- CreateIndex
CREATE UNIQUE INDEX "index_weight_history_card_id_snapshot_date_key" ON "index_weight_history"("card_id", "snapshot_date");

-- CreateIndex
CREATE INDEX "idx_predictions_card" ON "neural_predictions"("card_id", "predicted_at");

-- CreateIndex
CREATE INDEX "idx_predictions_expiry" ON "neural_predictions"("expires_at");

-- CreateIndex
CREATE INDEX "idx_deals_card" ON "neural_deals"("card_id");

-- CreateIndex
CREATE INDEX "idx_deals_type" ON "neural_deals"("deal_type", "status");

-- CreateIndex
CREATE INDEX "idx_deals_active" ON "neural_deals"("status", "expires_at");

-- CreateIndex
CREATE INDEX "idx_deals_confidence" ON "neural_deals"("confidence");

-- CreateIndex
CREATE UNIQUE INDEX "neural_model_history_model_version_key" ON "neural_model_history"("model_version");

-- CreateIndex
CREATE INDEX "idx_metrics_model_time" ON "neural_model_metrics"("model_version", "timestamp");

-- CreateIndex
CREATE INDEX "idx_metrics_card" ON "neural_model_metrics"("card_id");

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_key_hash_key" ON "api_keys"("key_hash");

-- CreateIndex
CREATE INDEX "idx_api_keys_hash" ON "api_keys"("key_hash");

-- CreateIndex
CREATE INDEX "idx_api_keys_user" ON "api_keys"("user_id");

-- CreateIndex
CREATE INDEX "idx_api_keys_status" ON "api_keys"("status");

-- CreateIndex
CREATE INDEX "idx_usage_key" ON "api_usage"("api_key_id", "request_timestamp");

-- CreateIndex
CREATE INDEX "idx_usage_billing" ON "api_usage"("api_key_id", "request_timestamp");

-- CreateIndex
CREATE INDEX "idx_webhooks_key" ON "api_webhooks"("api_key_id");

-- CreateIndex
CREATE INDEX "idx_webhooks_active" ON "api_webhooks"("is_active");

-- CreateIndex
CREATE INDEX "idx_rate_limit_key_date" ON "api_rate_limits"("api_key_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "api_rate_limits_api_key_id_date_key" ON "api_rate_limits"("api_key_id", "date");

-- AddForeignKey
ALTER TABLE "api_usage" ADD CONSTRAINT "api_usage_api_key_id_fkey" FOREIGN KEY ("api_key_id") REFERENCES "api_keys"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_webhooks" ADD CONSTRAINT "api_webhooks_api_key_id_fkey" FOREIGN KEY ("api_key_id") REFERENCES "api_keys"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "price_sources_card_source_key" RENAME TO "price_sources_card_id_source_key";

