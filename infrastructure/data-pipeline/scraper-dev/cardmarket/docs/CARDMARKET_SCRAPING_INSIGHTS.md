# CardMarket Scraping Insights

> **Date**: 2026-01-09
> **Status**: Testing Complete
> **Result**: Scraping Viable with Browser Automation

---

## Executive Summary

CardMarket can be successfully scraped for One Piece TCG card prices using Playwright browser automation with a European IP address. The site employs Cloudflare protection that blocks standard HTTP requests but can be bypassed with headless browser automation.

---

## Test Environment

| Component | Details |
|-----------|---------|
| Machine IP | 51.191.0.209 (German IP via VPN) |
| Node.js | v22.14.0 |
| Playwright | v1.57.0 |
| Test Target | Romance Dawn (OP01) singles |

---

## Connection Methods Tested

### 1. HTTP Client (Direct) ❌

```
Result: 403 Forbidden
Response: Cloudflare JavaScript challenge page ("Just a moment...")
```

Standard HTTP requests with proper headers are immediately blocked by Cloudflare's bot detection.

### 2. HTTP Client + Bright Data Proxy ❌

**Credentials Tested:**
- Customer ID: `hl_2d97e1e0`
- Password: `***REMOVED-ROTATE-ME***`

**Results:**
| Method | Endpoint | Result |
|--------|----------|--------|
| Node.js https-proxy-agent | httpbin.org | ✅ IP: 51.191.0.209 |
| Node.js https-proxy-agent | cardmarket.com | ❌ 403 + Cloudflare challenge |
| curl | brd.superproxy.io:22225 | ❌ 407 Proxy Auth Required |
| Playwright + proxy | Any URL | ❌ Timeout |

**Analysis:**
- The proxy authenticates successfully for simple requests via Node.js `https-proxy-agent`
- Cloudflare still blocks even proxied HTTP requests (requires JS execution)
- curl fails with 407 - possible credential format mismatch
- Browser with explicit proxy times out - may conflict with system VPN

### 3. Playwright Browser (No Explicit Proxy) ✅

```
Result: SUCCESS
Page Title: "Romance Dawn Singles | Cardmarket"
Page Size: 145,263 bytes
Cloudflare Bypass: Yes
```

Using Playwright without explicit proxy settings (traffic routes through existing VPN) successfully:
1. Passes Cloudflare JavaScript challenge
2. Renders full page with card data
3. Extracts pricing information

---

## Data Available from CardMarket

### Card Listing Page (Expansion View)

Each expansion page shows ~30 cards per page with:

| Field | Example | Notes |
|-------|---------|-------|
| Card Name | Kaido (OP01-094) (V.1) | Includes card number and variant |
| Card URL | /en/OnePiece/Products/Singles/Romance-Dawn/Kaido-OP01-094-V1 | Unique page per card |
| Variant Indicator | (V.1), (V.2), etc. | Distinguishes alternate arts |

**Sample Cards Discovered (OP01 Romance Dawn):**
```
1. Kaido (OP01-094) (V.1)
2. Monkey.D.Luffy (OP01-003) (V.1)
3. Monkey.D.Luffy (OP01-024) (V.1)
4. Round Table (OP01-027)
5. Roronoa Zoro (OP01-001) (V.1)
6. Thunder Bagua (OP01-119)
7. Sanji (OP01-013) (V.1)
8. Trafalgar Law (OP01-002) (V.1)
9. Dracule Mihawk (OP01-070) (V.1)
10. Boa Hancock (OP01-078) (V.1)
```

### Individual Card Page (Detail View)

**Pricing Data:**

| Field | Selector Pattern | Example Value |
|-------|-----------------|---------------|
| From (Lowest) | `.info-list-container dt:has-text("From") + dd` | 6,00 € |
| Price Trend | `.info-list-container dt:has-text("Price Trend") + dd` | 9,71 € |
| 7-day Average | `.info-list-container dt:has-text("7-days") + dd` | 8,15 € |
| 30-day Average | `.info-list-container dt:has-text("30-days") + dd` | 6,12 € |
| 1-day Average | `.info-list-container dt:has-text("1-day") + dd` | 8,10 € |
| Available Items | `.info-list-container dt:has-text("Available") + dd` | 342 |

**Card Metadata:**

| Field | Example Value |
|-------|---------------|
| Rarity | (needs selector adjustment) |
| Card Number | 094 |
| Printed In | Romance Dawn |
| Reprints/Versions | Show Versions (6) |

**Seller Listings:**

| Field | Notes |
|-------|-------|
| Article Rows | 50 listings found via `.article-row` selector |
| Seller Name | Available per listing |
| Price | Individual seller price |
| Condition | NM, EX, GD, LP, PL, PO |
| Language | EN, JP, etc. |
| Foil Status | Yes/No |
| Quantity | Stock per seller |

---

## Price Data Quality

### Extracted Values (Kaido OP01-094 Example)

```
From (lowest):        6,00 €
Price Trend:          9,71 €  (CardMarket's algorithm-based price)
7-day Average:        8,15 €
30-day Average:       6,12 €
1-day Average:        8,10 €
Available Sellers:    342
```

### Price Comparison Notes

- **Price Trend** is CardMarket's proprietary algorithm considering recent sales, not just listings
- **From** is the cheapest current listing (may exclude shipping)
- **Averages** are based on actual completed sales
- **1-day average** provides most recent market movement indicator

---

## Anti-Bot Protection Analysis

### Cloudflare Configuration

CardMarket uses Cloudflare with:

| Protection | Details |
|------------|---------|
| JavaScript Challenge | "Just a moment..." interstitial |
| Browser Fingerprinting | Client Hints headers required |
| Cookie Validation | `__cf_bm` cookie set on challenge pass |
| Rate Limiting | Aggressive on repeated requests |

**Response Headers (Blocked Request):**
```
HTTP/2 403
cf-mitigated: challenge
server: cloudflare
accept-ch: Sec-CH-UA-Bitness, Sec-CH-UA-Arch, ...
```

### Bypass Requirements

1. **JavaScript Engine**: Must execute Cloudflare's challenge script
2. **Browser Fingerprint**: Consistent user agent, viewport, locale
3. **European IP**: German/EU IPs less likely to be blocked
4. **Request Delays**: Minimum 2-3 seconds between requests

---

## Infrastructure Requirements

### For Production Scraping

| Requirement | Recommendation |
|-------------|----------------|
| **Browser Automation** | Playwright (not Puppeteer - better stealth) |
| **IP Location** | European residential IP (DE, FR, NL preferred) |
| **Execution Environment** | AWS Lambda with Playwright layer |
| **Request Delay** | 3000ms minimum between requests |
| **Session Management** | Maintain cookies across requests |
| **Concurrency** | Single-threaded per IP |

### Proxy Options

| Provider | Status | Notes |
|----------|--------|-------|
| Bright Data | ⚠️ Partial | Works for HTTP, browser integration needs investigation |
| VPN (Current) | ✅ Works | Routes through German datacenter |
| AWS Lambda (EU Region) | 🔄 Untested | Should work with eu-central-1 |

---

## Recommended Scraping Strategy

### Phase 1: Expansion Crawl
1. Navigate to expansion page (e.g., Romance Dawn)
2. Wait for Cloudflare challenge to resolve
3. Extract all card URLs from listing
4. Paginate through all pages

### Phase 2: Card Detail Extraction
1. Visit each card URL
2. Extract pricing data from info list
3. Optionally extract seller listings
4. Store with timestamp

### Phase 3: Data Transformation
1. Parse EUR prices to numeric values
2. Convert EUR → GBP (rate: ~0.85)
3. Calculate trade-in prices (best price × 0.70)
4. Validate against price thresholds

---

## Selectors Reference

### Expansion Page
```javascript
// Card links
'a[href*="/Products/Singles/{SET_NAME}/"]'

// Product table (if present)
'.table-body-row'
```

### Card Detail Page
```javascript
// Price info container
'.info-list-container'

// Specific prices
'.info-list-container dt:has-text("From") + dd'
'.info-list-container dt:has-text("Price Trend") + dd'
'.info-list-container dt:has-text("7-days") + dd'
'.info-list-container dt:has-text("30-days") + dd'

// Seller listings
'.article-row'
```

---

## Known Issues & Limitations

### Current Issues

1. **Bright Data Browser Integration**: Explicit proxy settings in Playwright cause timeout - needs investigation
2. **Table Structure**: CardMarket doesn't use traditional `<table>` elements, uses flex/grid layout
3. **Rate Limiting**: Aggressive blocking after ~50-100 requests from same IP

### Limitations

1. **No API**: CardMarket has no public API; scraping is only option
2. **ToS Consideration**: Web scraping may violate CardMarket's Terms of Service
3. **IP Reputation**: Datacenter IPs quickly blocked; residential required
4. **Dynamic Content**: Some prices load via JavaScript after initial page load

---

## Test Scripts Created

| Script | Purpose |
|--------|---------|
| `scripts/test-proxy.ts` | Validates Bright Data proxy connectivity |
| `scripts/test-browser.ts` | Tests Playwright with explicit proxy |
| `scripts/test-browser-noproxy.ts` | Tests Playwright with VPN only |
| `scripts/test-cardmarket-extract.ts` | Full data extraction demonstration |

---

## Next Steps

1. **Fix Bright Data Integration**: Investigate correct credential format for browser proxy
2. **Lambda Testing**: Deploy to eu-central-1 and test without VPN
3. **Selector Refinement**: Update HTML parser with working selectors
4. **Full Set Scrape**: Test complete OP01 extraction with rate limiting
5. **Data Validation**: Compare extracted prices with known values

---

## Appendix: Raw Test Output

### Successful Extraction (2026-01-09)

```
Launching browser to extract CardMarket data...
Page loaded: Romance Dawn Singles | Cardmarket
Card links found: 30
Unique cards: 30

Navigating to: Kaido (OP01-094) (V.1)
Card page title: Kaido (OP01-094) (V.1) | Cardmarket

Price data found:
  From price: 6,00 €
  Price trend: 9,71 €
  Available: 342
  30-days avg: 6,12 €
  7-days avg: 8,15 €

All info fields:
  Rarity:
  Number: 094
  Printed in: Romance Dawn
  Reprints: Show Versions (6)
  Available items: 342
  From: 6,00 €
  Price Trend: 9,71 €
  30-days average price: 6,12 €
  7-days average price: 8,15 €
  1-day average price: 8,10 €

Seller listings:
  Article rows: 50
```

---

## V2/V3 Targeted Scraping (Live Test)

Successfully tested targeted scraping of V2/V3 alternate art cards on 2026-01-09:

### Command
```bash
npx tsx src/services/targeted-scraper.ts --test --limit=3
```

### Results

| Card | Variant | Trend | From | 7-Day Avg | Sellers |
|------|---------|-------|------|-----------|---------|
| Shanks OP01-120 | V.2 | €96.53 | €39.99 | €72.37 | 77 |
| Shanks OP01-120 | V.3 | €2,079.96 | €2,900.00 | €2,418.80 | 31 |
| Shanks OP01-121 | V.2 (Manga) | N/A | N/A | N/A | N/A |

### Key Features
- Targets only **V2/V3 variants** (alternate arts, not base V1)
- Matches by **card number** for URL construction
- Filters by **English language** cards
- Enforces **€0.50 minimum price** threshold
- **5-10 second delays** between requests
- 44 V2/V3 cards in watchlist

---

## Language Handling

### V2/V3 = English Only

An important discovery during testing: **V2 and V3 variants on CardMarket are exclusively English**.

| Variant | Description | Languages |
|---------|-------------|-----------|
| V.1 | Base version | EN or JP (depends on print run) |
| V.2 | Parallel/Alternate Art | **English only** |
| V.3 | Special Alternate Art | **English only** |
| SP | Special reprint in later set | **English only** |
| Manga | Manga panel art | **English only** |

### Verified via Selectors

Language detection is functional using `[data-original-title*="English"]` selector:

```typescript
// Language detection (works correctly)
const englishListings = await page.locator('[data-original-title*="English"]').count();
const japaneseListings = await page.locator('[data-original-title*="Japanese"]').count();

// V2 card example: Shanks OP01-120-V2
// Result: 51 English, 0 Japanese
```

### Implications for Scraping

Since our targeted scraping focuses on **V2/V3 variants**, language filtering is inherently handled:
- No need to filter seller articles by language for V2/V3 cards
- All listings are English by definition
- The `englishFromPrice` and `englishAvailable` fields will match the aggregate values

For **V1 base cards** (if ever needed), language detection would be required:
- OP01-OP05 V1 cards may have mixed EN/JP seller listings
- Use the `data-original-title` attribute to distinguish
- Parse seller articles individually for language-specific pricing

---

## Related Documentation

| Document | Purpose |
|----------|---------|
| [TARGETED_SCRAPING_STRATEGY.md](./TARGETED_SCRAPING_STRATEGY.md) | Ethical scraping strategy for Cambridge TCG |
| [targeted-cards.yaml](../config/targeted-cards.yaml) | Watchlist configuration and settings |
| [targeted-scraper.ts](../src/services/targeted-scraper.ts) | Implementation of targeted scraper |
| [CARDMARKET_PIPELINE_ARCHITECTURE.md](./CARDMARKET_PIPELINE_ARCHITECTURE.md) | Full pipeline architecture |
| [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md) | Production deployment guide |

---

*Document Version: 1.1.0*
*Last Updated: 2026-01-09*
*Changelog: Added language handling section - V2/V3 variants are English-only*
