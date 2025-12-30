# Japanese Card Image Display Investigation

## Summary

**Issue:** Japanese card images are not displayed on the customer-facing trade-in page.

**Root Cause:** The `syncJapanesePricesToCards()` function does not populate the `imageUrl` field when syncing Japanese card prices to `CardPriceV2`. Although a helper function `getJpCardImageUrl()` exists to construct S3 image URLs, it is never called during the sync process.

**Impact:** All Japanese cards display "No Image" placeholder instead of actual card images.

---

## Data Flow Analysis

### Expected Flow
```
JapanesePriceSource → syncJapanesePricesToCards() → CardPriceV2 (with imageUrl) → API → Frontend
```

### Actual Flow (Bug)
```
JapanesePriceSource → syncJapanesePricesToCards() → CardPriceV2 (imageUrl = NULL) → API → Frontend (placeholder)
```

---

## Code Analysis

### 1. Sync Function Missing imageUrl Population

**File:** `app/lib/jp-prices.server.ts` (lines 414-426)

```typescript
const cardData = {
  name: jpPrice.name,
  game: "onepiece",
  language: "JP",
  releaseSet: jpPrice.setCode,
  setCode: jpPrice.setCode,
  cardNumber: jpPrice.cardNumber,
  variantType: jpPrice.variantType,
  rarity: jpPrice.rarity,
  bestPriceGbp: jpPrice.priceGbp / 100,
  tradeinPriceGbp: tradeinPriceGbp / 100,
  lastUpdated: new Date(),
  // ❌ imageUrl is NOT set here
};
```

### 2. Unused Image URL Helper Function

**File:** `app/lib/jp-prices.server.ts` (lines 824-828)

```typescript
export function getJpCardImageUrl(setCode: string, cardNumber: string): string {
  const cardId = `${setCode}-${cardNumber}`;
  return `https://${IMAGE_BUCKET}.s3.${S3_REGION}.amazonaws.com/${IMAGE_PREFIX}/${setCode}/${cardId}.png`;
  // Returns: https://jp-op-photos.s3.us-east-1.amazonaws.com/Official/OP01/OP01-001.png
}
```

This function exists but is **never called** during the sync process.

### 3. S3 Configuration (Correct)

**File:** `app/lib/jp-prices.server.ts` (lines 14-19)

```typescript
const S3_REGION = process.env.AWS_REGION || "us-east-1";
const PRICE_BUCKET = "pricedata-tcg";
const PRICE_FILE = "pricefeed/onepiece_pricefeed.xlsx";
const IMAGE_BUCKET = "jp-op-photos";      // ✅ Correct bucket
const IMAGE_PREFIX = "Official";           // ✅ Correct prefix
```

### 4. API Routes Return Null imageUrl

**File:** `app/routes/api.cards.search.tsx` (lines 110-120, 140)

```typescript
const cards = await prisma.cardPriceV2.findMany({
  // ...
  select: {
    // ...
    imageUrl: true,  // ✅ Selected correctly
  },
});

return {
  // ...
  imageUrl: card.imageUrl,  // Returns null for JP cards
};
```

**File:** `app/routes/api.cards.browse.tsx` (lines 158-169, 211)

Same pattern - imageUrl is selected but returns null.

### 5. Frontend Handles Null Gracefully

**File:** `extensions/trade-in-blocks/assets/trade-in.js` (lines 21, 282, 395, 543, 738)

```javascript
// Fallback placeholder
defaultImagePlaceholder: "data:image/svg+xml,...No Image..."

// Image display with fallback
<img src="${card.imageUrl || CONFIG.defaultImagePlaceholder}"
     onerror="this.src='${CONFIG.defaultImagePlaceholder}'">
```

---

## Database State

### CardPriceV2 Schema

**File:** `prisma/schema.prisma` (line 124)

```prisma
// Card image URL (local path or CDN URL)
imageUrl           String?   @map("image_url") @db.VarChar(500)
```

The field exists and is correctly defined, but is not being populated for JP cards.

### Japanese Card IDs

Japanese cards are created with the prefix `JP-`:
```typescript
const cardId = `JP-${jpPrice.sku}`.toUpperCase();
// Example: JP-OP01-003-P
```

---

## Fix Required

### Option A: Modify syncJapanesePricesToCards() (Recommended)

**Location:** `app/lib/jp-prices.server.ts`, line 414

Add `imageUrl` to the `cardData` object:

```typescript
const cardData = {
  name: jpPrice.name,
  game: "onepiece",
  language: "JP",
  releaseSet: jpPrice.setCode,
  setCode: jpPrice.setCode,
  cardNumber: jpPrice.cardNumber,
  variantType: jpPrice.variantType,
  rarity: jpPrice.rarity,
  bestPriceGbp: jpPrice.priceGbp / 100,
  tradeinPriceGbp: tradeinPriceGbp / 100,
  lastUpdated: new Date(),
  // ✅ ADD THIS LINE:
  imageUrl: jpPrice.setCode && jpPrice.cardNumber
    ? getJpCardImageUrl(jpPrice.setCode, jpPrice.cardNumber)
    : null,
};
```

### Option B: Backfill Existing Records

Create a one-time migration to update existing JP cards:

```sql
UPDATE card_prices_v2
SET image_url = CONCAT(
  'https://jp-op-photos.s3.us-east-1.amazonaws.com/Official/',
  set_code, '/', set_code, '-', card_number, '.png'
)
WHERE language = 'JP'
  AND set_code IS NOT NULL
  AND card_number IS NOT NULL
  AND image_url IS NULL;
```

---

## Verification Steps

### 1. Check Current Database State

```sql
-- Count JP cards with/without images
SELECT
  language,
  COUNT(*) as total,
  COUNT(image_url) as with_images,
  COUNT(*) - COUNT(image_url) as without_images
FROM card_prices_v2
WHERE language = 'JP'
GROUP BY language;
```

### 2. Verify S3 Image Accessibility

```bash
# Test if images exist in S3
curl -I "https://jp-op-photos.s3.us-east-1.amazonaws.com/Official/OP01/OP01-001.png"
```

### 3. Test API Response

```bash
# Check if API returns imageUrl
curl "https://your-shop.myshopify.com/apps/trade-in/cards/search?q=OP01" | jq '.results[0].imageUrl'
```

---

## S3 Image URL Format

### Expected Format
```
https://jp-op-photos.s3.us-east-1.amazonaws.com/Official/{SET}/{SET}-{NUMBER}.png
```

### Examples
| Card | Expected URL |
|------|--------------|
| OP01-001 | `https://jp-op-photos.s3.us-east-1.amazonaws.com/Official/OP01/OP01-001.png` |
| OP03-051 | `https://jp-op-photos.s3.us-east-1.amazonaws.com/Official/OP03/OP03-051.png` |
| ST01-012 | `https://jp-op-photos.s3.us-east-1.amazonaws.com/Official/ST01/ST01-012.png` |

---

## Files Involved

| File | Purpose | Line Numbers |
|------|---------|--------------|
| `app/lib/jp-prices.server.ts` | Sync logic, image URL helper | 365-468, 824-828 |
| `app/routes/api.cards.search.tsx` | Card search API | 110-120, 140 |
| `app/routes/api.cards.browse.tsx` | Card browse API | 158-169, 211 |
| `extensions/trade-in-blocks/assets/trade-in.js` | Frontend display | 21, 282, 395, 543, 738 |
| `prisma/schema.prisma` | Database schema | 124 |

---

## Related Notes

### English Cards vs Japanese Cards

- **English cards** (from trading-card-pricer Lambda): May have images populated from OPTCG API
- **Japanese cards** (from CSV/S3 import): imageUrl never populated during sync

### Variant Handling

The image URL construction may need adjustment for variants:
- Base cards: `{SET}/{SET}-{NUMBER}.png`
- Parallel/SP cards: May need different path structure

---

## Investigation Date

2025-12-30

## Status

**FIXED** - Implementation complete

---

## Fix Applied

**File:** `app/lib/jp-prices.server.ts` (line 426-429)

Added `imageUrl` to the `cardData` object in `syncJapanesePricesToCards()`:

```typescript
const cardData = {
  // ... existing fields ...
  lastUpdated: new Date(),
  // Add image URL from S3
  imageUrl: jpPrice.setCode && jpPrice.cardNumber
    ? getJpCardImageUrl(jpPrice.setCode, jpPrice.cardNumber)
    : null,
};
```

### Backfill Completed

**Date:** 2025-12-30

Ran `npx tsx scripts/backfill-jp-card-images.ts` to update all 486 JP cards.

The existing relative paths (e.g., `Official/OP08/SP-ST02-007.png`) were preserved and
converted to full S3 URLs by prepending the base URL. This correctly handles both:
- Regular cards: `Official/OP01/OP01-001.png`
- SP cards: `Official/OP08/SP-ST02-007.png`

### Sync Function Updated

Modified `syncJapanesePricesToCards()` to:
1. Preserve existing full URLs when re-syncing (handles SP cards correctly)
2. Only construct new URLs for cards without an existing imageUrl

### Data Sources Confirmed

| Source | Location | Format |
|--------|----------|--------|
| Prices | `s3://pricedata-tcg/pricefeed/onepiece_pricefeed.xlsx` | SKU: `OP-{SET}-{NUM}-JP` |
| Images | `s3://jp-op-photos/Official/{SET}/{SET}-{NUM}.png` | PNG files |

### Image URL Pattern

```
https://jp-op-photos.s3.us-east-1.amazonaws.com/Official/{SET}/{SET}-{NUMBER}.png
```

Example: `https://jp-op-photos.s3.us-east-1.amazonaws.com/Official/OP01/OP01-001.png`
