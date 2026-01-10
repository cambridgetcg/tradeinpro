# CardMarket Browser Scraper Guide

> **Created**: 2026-01-10
> **Status**: Production Ready
> **Key Insight**: Browser automation bypasses Cloudflare - NO PROXY NEEDED

---

## Executive Summary

CardMarket uses Cloudflare protection that blocks standard HTTP requests with a 403 challenge. After extensive testing, **Playwright browser automation with stealth scripts** successfully bypasses this protection without requiring a residential proxy.

---

## The Problem: Cloudflare Protection

### What Doesn't Work

| Method | Result | Headers |
|--------|--------|---------|
| `fetch()` / `axios` | 403 Forbidden | `cf-mitigated: challenge` |
| `curl` with browser UA | 403 Forbidden | `cf-mitigated: challenge` |
| HTTP client with cookies | 403 Forbidden | Challenge page returned |

### What Works

| Method | Result | Notes |
|--------|--------|-------|
| **Playwright browser** | ✅ Success | Stealth mode, headless OK |
| Real browser (manual) | ✅ Success | Not automatable |

---

## Solution: Browser-Based Scraper

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    BROWSER SCRAPER                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    │
│  │  Playwright │───▶│   Stealth   │───▶│  CardMarket │    │
│  │  Chromium   │    │   Scripts   │    │   Page      │    │
│  └─────────────┘    └─────────────┘    └─────────────┘    │
│         │                                     │            │
│         │           ┌─────────────┐          │            │
│         └──────────▶│   Rate      │◀─────────┘            │
│                     │   Limiter   │                        │
│                     └─────────────┘                        │
│                           │                                │
│                           ▼                                │
│                     ┌─────────────┐                        │
│                     │   Parser    │                        │
│                     │   Extract   │                        │
│                     └─────────────┘                        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Key Components

1. **Playwright Chromium** - Headless browser engine
2. **Stealth Scripts** - Prevent bot detection
3. **Rate Limiter** - 10 requests/minute max
4. **HTML Parser** - Extract card data from DOM

---

## Quick Start

### Test Connection (Dry Run)

```bash
npx tsx scripts/test-browser-scraper.ts --dry-run
```

Expected output:
```
📡 Testing connection to CardMarket...
   ✅ Connection successful - Cloudflare bypassed with browser automation
   Latency: 4102ms
```

### Scrape Sample Cards

```bash
# Scrape 5 cards from Romance Dawn (OP01)
npx tsx scripts/test-browser-scraper.ts --max-cards=5
```

### Production Scrape

```bash
# Scrape up to 100 cards
npx tsx scripts/test-browser-scraper.ts --max-cards=100
```

---

## Scraper Files

| File | Purpose |
|------|---------|
| `src/scrapers/cardmarket-browser-scraper.ts` | Main browser scraper class |
| `src/browser/playwright-client.ts` | Low-level Playwright wrapper |
| `scripts/test-browser-scraper.ts` | Test/run script |

### Using the Scraper Programmatically

```typescript
import { createBrowserScraper } from '../src/scrapers/cardmarket-browser-scraper.js';

const scraper = createBrowserScraper({
  headless: true,
  requestDelayMs: 3000,  // 3 second delay between requests
});

try {
  // Test connection
  const conn = await scraper.testConnection();
  console.log(conn.success ? 'Connected!' : 'Failed');

  // Scrape a set
  const result = await scraper.scrapeSet('OP01', {
    maxCardsPerSet: 50,
    maxPagesPerSet: 2,
  });

  console.log(`Scraped ${result.cards.length} cards`);

  for (const card of result.cards) {
    console.log(`${card.name}: €${card.trendPrice}`);
  }
} finally {
  await scraper.close();
}
```

---

## Stealth Scripts

The scraper injects these scripts to avoid bot detection:

```javascript
// Prevent webdriver detection
Object.defineProperty(navigator, 'webdriver', { get: () => false });

// Fake Chrome runtime
window.chrome = { runtime: {} };

// Fake plugins array
Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });

// Set languages
Object.defineProperty(navigator, 'languages', { get: () => ['en-GB', 'en-US', 'en'] });

// Hardware fingerprint
Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 4 });
Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
```

---

## Rate Limiting Guidelines

CardMarket is sensitive to automated traffic. Follow these limits:

| Setting | Recommended | Aggressive (risky) |
|---------|-------------|-------------------|
| Requests/minute | 10 | 20 |
| Delay between requests | 3000ms | 1500ms |
| Delay between sets | 10000ms | 5000ms |
| Max pages per session | 50 | 100 |

### Warning Signs of Detection

- Repeated 403 responses
- Cloudflare challenge pages appearing
- Connection timeouts increasing
- Empty response bodies

**If detected**: Stop scraping, wait 30+ minutes, rotate fingerprint.

---

## Page Structure (as of 2026-01-10)

### Expansion Page (`/Products/Singles/{SetName}`)

```html
<div class="table-body">
  <div class="row">
    <a href="/en/OnePiece/Products/Singles/Romance-Dawn/Kaido-OP01-094-V1">
      Kaido (OP01-094) (V.1)
    </a>
    <span class="col-price">9,69 €</span>
    <span class="col-availability">342</span>
  </div>
  <!-- More rows... -->
</div>
```

### Key Selectors

| Element | Selector |
|---------|----------|
| Product rows | `.table-body .row` |
| Card link | `a[href*="/Products/Singles/"]` |
| Price | `.col-price, .font-weight-bold` |
| Availability | `.col-availability` |
| Pagination | `.pagination .page-item` |

### Card Detail Page

| Element | Selector |
|---------|----------|
| Card name | `h1` |
| Image | `.image-wrapper img` |
| Info table | `.info-list-container dd` |
| Trend price | Label: "Trend" |
| Low price | Label: "Low" |
| 7-day avg | Label: "7-Day Average" |
| 30-day avg | Label: "30-Day Average" |

---

## URL Patterns

### Set Pages

```
https://www.cardmarket.com/en/OnePiece/Products/Singles/{SetName}
https://www.cardmarket.com/en/OnePiece/Products/Singles/{SetName}?site=2  # Page 2
```

### Card Detail Pages

```
https://www.cardmarket.com/en/OnePiece/Products/Singles/{SetName}/{CardSlug}
```

### Set Name Mapping

| Set Code | CardMarket Name |
|----------|-----------------|
| OP01 | Romance-Dawn |
| OP02 | Paramount-War |
| OP03 | Pillars-of-Strength |
| OP04 | Kingdoms-of-Intrigue |
| OP05 | Awakening-of-the-New-Era |
| OP06 | Wings-of-the-Captain |
| OP07 | 500-Years-in-the-Future |
| EB01 | Extra-Booster-Memorial-Collection |

---

## Data Extraction

### Scraped Card Object

```typescript
interface ScrapedCard {
  cardId: string;          // e.g., "OP01-OP01-094-parallel"
  name: string;            // e.g., "Kaido (OP01-094) (V.1)"
  setCode: string;         // e.g., "OP01"
  cardNumber: string;      // e.g., "094"
  variantType: string;     // "standard", "parallel", "manga", "sp"
  trendPrice: number;      // In EUR, e.g., 9.69
  lowPrice: number;        // Lowest available price
  avg7Price: number;       // 7-day average
  avg30Price: number;      // 30-day average
  availableCount: number;  // Listings available
  sourceUrl: string;       // Full URL
  scrapedAt: string;       // ISO timestamp
}
```

### Price Parsing

CardMarket uses European number format:
- `9,69 €` → 9.69 EUR
- `1.234,56 €` → 1234.56 EUR

```typescript
const priceText = "9,69 €";
const price = parseFloat(priceText.replace(/[^\d,]/g, '').replace(',', '.'));
// Result: 9.69
```

---

## Variant Detection

Detect variant type from URL or card name:

| Pattern | Variant |
|---------|---------|
| `-V1`, `-V2` | parallel |
| `-Manga` | manga |
| `-SP` | sp (special) |
| `-SEC` | sec (secret rare) |
| `-L` | leader |
| (none) | standard |

```typescript
function detectVariant(url: string): string {
  const lower = url.toLowerCase();
  if (lower.includes('-v2') || lower.includes('-v1')) return 'parallel';
  if (lower.includes('-manga')) return 'manga';
  if (lower.includes('-sp')) return 'sp';
  if (lower.includes('-sec')) return 'sec';
  return 'standard';
}
```

---

## Error Handling

### Common Errors

| Error | Cause | Solution |
|-------|-------|----------|
| `Cloudflare challenge not resolved` | Bot detected | Wait 30 min, rotate fingerprint |
| `Access blocked` | IP/session blocked | New browser context |
| `Navigation timeout` | Slow page load | Increase timeout to 60s |
| `No card data found` | Page structure changed | Update selectors |

### Recovery Strategy

```typescript
try {
  await scraper.scrapeSet('OP01', options);
} catch (error) {
  if (error.message.includes('blocked')) {
    console.log('Blocked! Waiting 30 minutes...');
    await sleep(30 * 60 * 1000);
    await scraper.reset();  // New browser context
    // Retry...
  }
}
```

---

## Best Practices

### Do's

1. **Always use dry-run first** to verify connection
2. **Respect rate limits** - 10 req/min recommended
3. **Close browser** when done to free resources
4. **Handle errors gracefully** - expect occasional blocks
5. **Store scraped data** immediately after each card
6. **Use delays between sets** - 10+ seconds

### Don'ts

1. **Don't scrape during peak hours** (European evening)
2. **Don't run multiple scrapers simultaneously**
3. **Don't ignore rate limits** - will get IP blocked
4. **Don't scrape entire catalog at once** - batch by set
5. **Don't leave browser running** - memory leak risk

---

## Integration with Pipeline

### Writing to Database

```typescript
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function saveCard(card: ScrapedCard) {
  await prisma.cardMarketPrice.upsert({
    where: { cardId: card.cardId },
    update: {
      trendPriceEur: card.trendPrice,
      lowPriceEur: card.lowPrice,
      availableCount: card.availableCount,
      lastScrapedAt: new Date(),
    },
    create: {
      cardId: card.cardId,
      name: card.name,
      setCode: card.setCode,
      trendPriceEur: card.trendPrice,
      lowPriceEur: card.lowPrice,
      availableCount: card.availableCount,
      sourceUrl: card.sourceUrl,
      lastScrapedAt: new Date(),
    },
  });
}
```

### Scheduling

Recommended scrape schedule:
- **Daily**: High-value variants (manga, SP, SEC)
- **Weekly**: Full set refresh
- **On-demand**: Specific cards for arbitrage detection

---

## Troubleshooting

### "Cloudflare bypassed but no data"

Page structure may have changed. Check:
```bash
# Save page HTML for inspection
npx tsx -e "
import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('https://www.cardmarket.com/en/OnePiece/Products/Singles/Romance-Dawn');
await page.waitForTimeout(3000);
const fs = await import('fs');
fs.writeFileSync('cardmarket-debug.html', await page.content());
await browser.close();
"
```

### "Browser crashes or hangs"

Memory issue. Ensure browser is closed:
```typescript
const scraper = createBrowserScraper();
try {
  // ... scraping
} finally {
  await scraper.close();  // Always close!
}
```

### "Prices not parsing correctly"

CardMarket may use different price formats by locale. Check the raw text:
```typescript
const priceText = await page.locator('.col-price').textContent();
console.log('Raw price:', JSON.stringify(priceText));
```

---

## Future Improvements

1. **Proxy rotation** - For high-volume scraping if needed
2. **Fingerprint rotation** - Auto-rotate after N requests
3. **Captcha solving** - If Cloudflare adds captchas
4. **Parallel scraping** - Multiple browser contexts
5. **Incremental scraping** - Only fetch changed prices

---

## Related Documentation

| Document | Purpose |
|----------|---------|
| [DATA_COLLECTION_STATUS.md](./DATA_COLLECTION_STATUS.md) | Overall pipeline status |
| [CARDMARKET_SCRAPER_INFRASTRUCTURE.md](./CARDMARKET_SCRAPER_INFRASTRUCTURE.md) | HTTP scraper (deprecated) |
| [CARDMARKET_STACK_ANALYSIS.md](./CARDMARKET_STACK_ANALYSIS.md) | CardMarket tech analysis |
| [TARGETED_SCRAPING_STRATEGY.md](./TARGETED_SCRAPING_STRATEGY.md) | What cards to prioritize |

---

*"The browser is mightier than the HTTP request."*

**[>>> Documentation Index <<<](./INDEX.md)** | *Navigate all TCG pipeline documentation*
