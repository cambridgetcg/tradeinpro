-- Backfill JP Card Images SQL Script
--
-- This script updates all Japanese cards in card_prices_v2 to have full S3 URLs
-- for their images instead of relative paths.
--
-- IMPORTANT: The existing relative paths (e.g., "Official/OP08/SP-ST02-007.png") are correct
-- and account for SP cards with different naming conventions. This script simply
-- prepends the S3 base URL to convert them to full URLs.
--
-- S3 Base URL: https://jp-op-photos.s3.us-east-1.amazonaws.com
--
-- Usage:
--   psql $DATABASE_URL -f scripts/backfill-jp-card-images.sql
--   OR run each section manually

-- ============================================================================
-- PREVIEW: Check current state (run this first to see what will be updated)
-- ============================================================================

-- Count JP cards by image URL status
SELECT
    CASE
        WHEN image_url IS NULL THEN 'No image URL'
        WHEN image_url LIKE 'https://%' THEN 'Full URL (correct)'
        ELSE 'Relative path (needs fix)'
    END AS status,
    COUNT(*) AS count
FROM card_prices_v2
WHERE language = 'JP'
GROUP BY 1
ORDER BY 1;

-- Sample of cards that need updating (shows how relative paths will be converted)
SELECT
    card_id,
    name,
    image_url AS current_url,
    CONCAT('https://jp-op-photos.s3.us-east-1.amazonaws.com/', image_url) AS new_url
FROM card_prices_v2
WHERE language = 'JP'
  AND image_url IS NOT NULL
  AND image_url NOT LIKE 'https://%'
LIMIT 10;

-- ============================================================================
-- UPDATE: Convert relative paths to full S3 URLs
-- ============================================================================

-- Dry run: Show what would be updated (SELECT instead of UPDATE)
/*
SELECT
    card_id,
    image_url AS old_url,
    CONCAT('https://jp-op-photos.s3.us-east-1.amazonaws.com/', image_url) AS new_url
FROM card_prices_v2
WHERE language = 'JP'
  AND image_url IS NOT NULL
  AND image_url NOT LIKE 'https://%';
*/

-- ACTUAL UPDATE: Prepend S3 base URL to existing relative paths
-- This preserves the correct path structure for SP cards
UPDATE card_prices_v2
SET image_url = CONCAT('https://jp-op-photos.s3.us-east-1.amazonaws.com/', image_url),
    last_updated = NOW()
WHERE language = 'JP'
  AND image_url IS NOT NULL
  AND image_url NOT LIKE 'https://%';

-- For cards with NULL imageUrl, construct from setCode/cardNumber (if available)
UPDATE card_prices_v2
SET image_url = CONCAT(
    'https://jp-op-photos.s3.us-east-1.amazonaws.com/Official/',
    set_code,
    '/',
    set_code,
    '-',
    card_number,
    '.png'
),
last_updated = NOW()
WHERE language = 'JP'
  AND image_url IS NULL
  AND set_code IS NOT NULL
  AND card_number IS NOT NULL;

-- ============================================================================
-- VERIFY: Check results after update
-- ============================================================================

-- Verify all JP cards now have full URLs
SELECT
    CASE
        WHEN image_url IS NULL THEN 'No image URL'
        WHEN image_url LIKE 'https://%' THEN 'Full URL (correct)'
        ELSE 'Relative path (needs fix)'
    END AS status,
    COUNT(*) AS count
FROM card_prices_v2
WHERE language = 'JP'
GROUP BY 1
ORDER BY 1;

-- Sample of updated cards
SELECT
    card_id,
    name,
    set_code,
    card_number,
    image_url
FROM card_prices_v2
WHERE language = 'JP'
  AND image_url LIKE 'https://%'
LIMIT 5;
