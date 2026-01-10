-- Add annotation fields to neural_deals for training feedback

-- User feedback
ALTER TABLE "neural_deals" ADD COLUMN IF NOT EXISTS "user_rating" TEXT;
ALTER TABLE "neural_deals" ADD COLUMN IF NOT EXISTS "annotation_notes" TEXT;
ALTER TABLE "neural_deals" ADD COLUMN IF NOT EXISTS "annotation_tags" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "neural_deals" ADD COLUMN IF NOT EXISTS "annotated_at" TIMESTAMPTZ;

-- Outcome tracking
ALTER TABLE "neural_deals" ADD COLUMN IF NOT EXISTS "was_profitable" BOOLEAN;
ALTER TABLE "neural_deals" ADD COLUMN IF NOT EXISTS "profit_amount" DECIMAL(10, 2);

-- Index for filtering by annotation status
CREATE INDEX IF NOT EXISTS "idx_deals_annotation" ON "neural_deals" ("user_rating");
