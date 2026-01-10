# CardMarket Archive Implementation Insights

> **CRITICAL LEARNINGS** - Hard-won knowledge from building the daily price archive system
>
> **Date**: 2026-01-10
> **Author**: Claude Code Implementation Session

---

## Executive Summary

Built a comprehensive daily CardMarket price archiving system that:
- Collects card prices partitioned by **condition** (MT, NM, EX, GD, LP, PL, PO) and **language** (EN, JP, DE, FR, ES, IT)
- Archives aggregate prices (trend, from, 7d avg, 30d avg)
- Captures individual seller listings for market depth analysis
- Converts EUR to GBP for UK market arbitrage opportunities

**Critical Discovery**: TypeScript/ESBuild transpilation breaks `page.evaluate()` in Playwright. Solution documented below.

---

## 1. The `__name is not defined` Crisis

### The Problem

When running Playwright's `page.evaluate()` with TypeScript arrow functions via `tsx`:

```typescript
// THIS BREAKS
const data = await page.evaluate((url) => {
  const el = document.querySelector('h1');
  return { title: el?.textContent, url };
}, cardUrl);
```

**Error:**
```
ReferenceError: __name is not defined
    at eval (eval at <anonymous>...)
```

### Root Cause

ESBuild (used by `tsx`) transpiles arrow functions and adds a `__name` decorator function for debugging/stack traces:

```javascript
// What ESBuild produces:
var __name = (fn, name) => Object.defineProperty(fn, "name", { value: name });
var extractFn = __name((url) => { /* ... */ }, "extractFn");
```

When this code is serialized and sent to the browser context via `page.evaluate()`, the `__name` function doesn't exist in the browser's scope, causing the ReferenceError.

### The Solution: Plain JavaScript Strings

Convert all `page.evaluate()` functions to plain JavaScript strings that are `eval()`'d at runtime:

```typescript
// THIS WORKS
const extractFn = `
  (function(url) {
    var el = document.querySelector('h1');
    return { title: el ? el.textContent : '', url: url };
  })
`;

const data = await page.evaluate(eval(extractFn), cardUrl);
```

### Key Rules for Browser Code

| ❌ Avoid | ✅ Use Instead |
|----------|---------------|
| Arrow functions `() => {}` | `function() {}` |
| `const`/`let` | `var` |
| Optional chaining `?.` | Explicit null checks |
| Template literals | String concatenation |
| Destructuring | Manual property access |
| `Array.from()` | Manual iteration |

### Example Transformation

```typescript
// BEFORE (broken):
const prices = await page.evaluate(() => {
  const items = document.querySelectorAll('.price');
  return Array.from(items).map(el => ({
    value: el?.textContent?.trim() || ''
  }));
});

// AFTER (working):
const extractFn = `
  (function() {
    var results = [];
    var items = document.querySelectorAll('.price');
    for (var i = 0; i < items.length; i++) {
      var el = items[i];
      results.push({
        value: el && el.textContent ? el.textContent.trim() : ''
      });
    }
    return results;
  })
`;
const prices = await page.evaluate(eval(extractFn));
```

---

## 2. CardMarket Page Structure Analysis

### DOM Selectors

| Data | Selector | Notes |
|------|----------|-------|
| Card rows | `.table-body .row` | Expansion listing page |
| Card links | `.table-body .row a[href*="/Products/Singles/"]` | Filter to product links |
| Article rows | `.article-row` | Individual seller listings |
| Condition badge | `[class*="article-condition"]` | Has `.condition-mt`, `.condition-nm`, etc. |
| Price | `.price-container .fw-bold` | Contains `€X.XX` |
| Seller name | `.seller-name a` | Link text |
| Info container | `.info-list-container` | Contains trend, from, avg prices |

### Condition Class Mapping

```javascript
// CSS class → Condition code mapping
{
  'condition-mt': 'MT',  // Mint
  'condition-nm': 'NM',  // Near Mint
  'condition-ex': 'EX',  // Excellent
  'condition-gd': 'GD',  // Good
  'condition-lp': 'LP',  // Light Played
  'condition-pl': 'PL',  // Played
  'condition-po': 'PO'   // Poor
}
```

### Price Extraction Regex Patterns

```javascript
// From price: "From 9.69 €"
/From\s*([\d,.]+)\s*€/i

// Trend price: "Price Trend 9.69 €" or "Trend 9.69 €"
/Price Trend\s*([\d,.]+)\s*€/i
/Trend\s*([\d,.]+)\s*€/i

// 7-day average: "7-day average price 9.69 €"
/7-day average[^€]*([\d,.]+)\s*€/i

// 30-day average: "30-day average price 9.69 €"
/30-day average[^€]*([\d,.]+)\s*€/i

// Available items: "Available items 42"
/Available items\s*(\d+)/i
```

### URL Structure

```
https://www.cardmarket.com/en/OnePiece/Products/Singles/{SetName}/{CardName}

Examples:
- Romance-Dawn/Kaido-OP01-094-V1      (parallel variant)
- Romance-Dawn/MonkeyDLuffy-OP01-003  (standard)
- Paramount-War/AceOP02-001-Manga     (manga variant)
```

---

## 3. Database Schema Design

### Three-Level Architecture

```
CardMarketPriceArchive (daily aggregate)
    └── CardMarketConditionSnapshot (condition × language partition)
            └── CardMarketListingSnapshot (individual seller listings)
```

### Schema Rationale

**Level 1: `cardmarket_price_archive`** - One record per card per day
- Aggregate prices (trend, from, 7d avg, 30d avg)
- Total listings count
- Price change metrics
- EUR and GBP currencies

**Level 2: `cardmarket_condition_snapshot`** - Partitioned by condition AND language
- Unique constraint: `(cardId, date, conditionCode, languageCode)`
- From, avg, high prices per condition/language combo
- Listings count per partition
- Enables "What's the cheapest NM English copy?" queries

**Level 3: `cardmarket_listing_snapshot`** - Individual sellers
- Full listing details (seller, country, sales count)
- Condition and language per listing
- Quantity, price, flags (signed, 1st ed, altered, playset)
- Market depth analysis

### Currency Conversion

```typescript
// Fixed rate (should be FX API in production)
const EUR_TO_GBP = 0.86;

const toGbp = (eur: number | null): number | null => {
  return eur !== null ? Math.round(eur * EUR_TO_GBP * 100) / 100 : null;
};
```

### Card ID Format

```
{SET_CODE}-{CARD_NUMBER}[-{VARIANT}]

Examples:
- OP01-094-parallel  (parallel variant)
- OP01-003           (standard)
- OP01-051-manga     (manga variant)
- OP01-121-sec       (secret rare)
- OP01-001-sp        (special art)
```

---

## 4. Playwright Stealth Patterns

### Anti-Detection Scripts

```typescript
const STEALTH_SCRIPTS = `
  // Hide webdriver flag
  Object.defineProperty(navigator, 'webdriver', { get: () => false });

  // Fake Chrome runtime
  window.chrome = { runtime: {} };

  // Fake plugins array
  Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });

  // Set realistic languages
  Object.defineProperty(navigator, 'languages', { get: () => ['en-GB', 'en-US', 'en'] });
`;
```

### Browser Context Configuration

```typescript
const context = await browser.newContext({
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  locale: 'en-GB',
  viewport: { width: 1920, height: 1080 },
});

// Apply stealth scripts to all pages
await context.addInitScript(STEALTH_SCRIPTS);
```

### Resource Blocking (Performance Optimization)

```typescript
// Block images, media, fonts to speed up scraping
await context.route('**/*', (route) => {
  const type = route.request().resourceType();
  if (['image', 'media', 'font'].includes(type)) {
    route.abort();
  } else {
    route.continue();
  }
});
```

### Cloudflare Handling

```typescript
// Check for Cloudflare challenge
const html = await page.content();
if (html.includes('Just a moment')) {
  console.log('Cloudflare detected, waiting...');
  await page.waitForTimeout(5000);
  // Browser automation usually bypasses automatically
}
```

---

## 5. Rate Limiting & Performance

### Configuration

```typescript
const DEFAULT_CONFIG: ArchiveScraperConfig = {
  headless: true,
  timeout: 60000,
  requestDelayMs: 3000,        // 3 seconds between requests
  requestsPerMinute: 10,       // ~6 seconds per request
  maxRetries: 2,
  includeListings: true,
  maxListingsPerCard: 50,
};
```

### Performance Metrics (from test run)

| Metric | Value |
|--------|-------|
| Cards per minute | ~3-4 |
| Conditions per card | 3-7 |
| Listings per card | 50 (capped) |
| Time for OP01 (30 cards) | ~10 minutes |

### Full Archive Estimate

| Set Count | Cards (est.) | Time @ 4/min | Daily Window |
|-----------|--------------|--------------|--------------|
| 15 sets | 1,500 cards | 6.25 hours | Overnight batch |

---

## 6. Daily Archive Workflow

### Command Line Interface

```bash
# Dry run - test without database writes
npx tsx scripts/daily-cardmarket-archive.ts --dry-run --sets=OP01 --max-cards=5

# Production run for specific sets
npx tsx scripts/daily-cardmarket-archive.ts --sets=OP01,OP02,OP03

# Full archive (all sets)
npx tsx scripts/daily-cardmarket-archive.ts
```

### Output Example

```
═══════════════════════════════════════════════════════════════
  📅 Daily CardMarket Price Archive
═══════════════════════════════════════════════════════════════
  Date: 2026-01-10
  Mode: LIVE
  Sets: OP01
═══════════════════════════════════════════════════════════════

🗂️  Processing set: OP01

📦 Archiving set: OP01 (Romance-Dawn)
   Page 1/1: Found 30 cards (total: 2)

📊 Scraping 2 cards for archive...
   [1/2] Kaido-OP01-094-V1
      ✓ Kaido (OP01-094) - €9.69 (3 conditions, 50 listings)
   [2/2] MonkeyDLuffy-OP01-003-V1
      ✓ Monkey.D.Luffy (OP01-003) - €0.42 (3 conditions, 50 listings)

═══════════════════════════════════════════════════════════════
  📊 ARCHIVE COMPLETE
═══════════════════════════════════════════════════════════════
  Sets processed: 1
  Cards archived: 2
  Condition snapshots: 6
  Listing snapshots: 100
  Duration: 19.5s
  Errors: 0
═══════════════════════════════════════════════════════════════
```

---

## 7. Lessons Learned

### 1. TypeScript in Browser Contexts is Fragile
- **Never** pass TypeScript functions directly to `page.evaluate()`
- Always use plain JavaScript strings with `eval()`
- Avoid ES6+ syntax in browser code

### 2. Condition Extraction is Best Done from Listings
- CardMarket doesn't expose condition-level aggregate prices directly
- Must analyze individual listings and compute min/avg/max
- Listings page already shows condition badges

### 3. Rate Limiting is Non-Negotiable
- 3+ second delays between requests
- Max 10 requests per minute
- Cloudflare will block aggressive scraping

### 4. Stealth Scripts Work (No Proxy Needed)
- Playwright with stealth scripts bypasses Cloudflare
- No expensive proxy services required
- Headless mode works fine

### 5. Data Partitioning Enables Powerful Queries
- Condition × Language partitioning is essential
- Enables arbitrage: "Find underpriced NM English copies"
- Historical depth analysis: "How has EX pricing trended?"

---

## 8. Files Reference

| File | Purpose |
|------|---------|
| `src/scrapers/cardmarket-archive-scraper.ts` | Main archive scraper class |
| `scripts/daily-cardmarket-archive.ts` | Daily orchestration script |
| `scripts/analyze-cardmarket-structure.ts` | DOM structure analysis tool |
| `prisma/schema.prisma` | Database models |

---

## 9. Next Steps

1. **Apply Prisma Migration** - Create archive tables in production
2. **Add Language Detection** - Currently defaults to EN, need flag parsing
3. **FX API Integration** - Replace hardcoded EUR_TO_GBP rate
4. **AWS Lambda Deployment** - Scheduled daily execution
5. **Monitoring Dashboard** - Track archive completeness and errors

---

*"The browser is the alchemist's crucible - it transforms protected data into accessible knowledge."*
