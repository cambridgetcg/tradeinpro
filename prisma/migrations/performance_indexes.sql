-- Performance Optimization Indexes for TCG Trade-In System
-- Run these indexes to improve query performance
-- Use CONCURRENTLY to avoid locking tables in production

-- ============================================================================
-- Full-Text Search Indexes (requires pg_trgm extension)
-- ============================================================================

-- Enable trigram extension for fuzzy text search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Card name search with trigram index (supports LIKE '%term%' and similarity queries)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_card_prices_v2_name_trgm
ON card_prices_v2 USING gin(name gin_trgm_ops);

-- CardPrice name search (trade-in system)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_card_price_name_trgm
ON "CardPrice" USING gin("cardName" gin_trgm_ops);

-- ============================================================================
-- Composite Indexes for Common Query Patterns
-- ============================================================================

-- Submissions by status and date (for queue views)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_submissions_status_created
ON "TradeInSubmission"(status, "createdAt" DESC);

-- Submissions by status and updated (for processing queue)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_submissions_status_updated
ON "TradeInSubmission"(status, "updatedAt" DESC);

-- Customer submissions lookup
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_submissions_customer_status
ON "TradeInSubmission"("customerId", status);

-- Items by submission and status (for grading view)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_items_submission_status
ON "TradeInItem"("submissionId", status);

-- Payouts by status and date
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payouts_status_created
ON "Payout"(status, "createdAt" DESC);

-- ============================================================================
-- Card Price V2 Optimizations
-- ============================================================================

-- Cards with images only (common filter for trade-in)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_card_prices_v2_with_image
ON card_prices_v2(game, "release_set")
WHERE image_url IS NOT NULL;

-- Recently updated prices
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_card_prices_v2_optcg_updated
ON card_prices_v2(optcg_updated_at DESC NULLS LAST)
WHERE optcg_updated_at IS NOT NULL;

-- Variant cards only (common filter)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_card_prices_v2_variants_only
ON card_prices_v2(game, "release_set", variant_type)
WHERE variant_type IS NOT NULL;

-- Cards with valid trade-in prices
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_card_prices_v2_tradeable
ON card_prices_v2(game, tradein_price_gbp DESC)
WHERE tradein_price_gbp IS NOT NULL AND tradein_price_gbp > 0;

-- ============================================================================
-- Session and Customer Optimizations
-- ============================================================================

-- Session lookup by shop
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_session_shop
ON "Session"(shop);

-- Customer lookup by email
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_customer_email
ON "Customer"(email);

-- ============================================================================
-- Notes Index
-- ============================================================================

-- Submission notes by date
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notes_submission_created
ON "SubmissionNote"("submissionId", "createdAt" DESC);

-- ============================================================================
-- Statistics/Reporting Optimizations
-- ============================================================================

-- For daily stats queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_submissions_completed_at
ON "TradeInSubmission"("completedAt")
WHERE "completedAt" IS NOT NULL;

-- For payout reports
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payouts_processed_at
ON "Payout"("processedAt")
WHERE "processedAt" IS NOT NULL;

-- ============================================================================
-- Analyze tables to update statistics
-- ============================================================================

ANALYZE card_prices_v2;
ANALYZE "CardPrice";
ANALYZE "TradeInSubmission";
ANALYZE "TradeInItem";
ANALYZE "Payout";
ANALYZE "Customer";
