# Cardmarket Technology Stack Analysis

> **Research Date**: January 2026
> **Purpose**: Optimize scraper resilience based on actual Cardmarket implementation

## Executive Summary

Cardmarket employs a modern React-based frontend with TypeScript/AWS Lambda backend, protected by a **custom anti-bot system** (not standard Cloudflare Turnstile). Understanding their specific protection mechanisms enables targeted optimization of our scraping approach.

---

## 1. Technology Stack Overview

### Frontend
| Component | Technology | Implications |
|-----------|------------|--------------|
| **Framework** | React | Client-side hydration required for some data |
| **Rendering** | SSR + Hydration | Initial HTML contains core data; JS enhances interactivity |
| **Fonts** | Poppins (Google Fonts) | Can block for faster loads |
| **Mobile** | Responsive (viewport meta) | Same HTML structure across devices |

### Backend
| Component | Technology | Implications |
|-----------|------------|--------------|
| **Runtime** | TypeScript on AWS Lambda | Serverless, auto-scaling |
| **Database** | AWS Aurora via TypeORM | Fast reads, potential rate limits |
| **API Spec** | Swagger/OpenAPI | Structured endpoints, predictable responses |
| **CDN** | CloudFront (implied) | Geographic edge caching |

### Sources
- [BuiltWith Technology Profile](https://builtwith.com/cardmarket.com)
- [Cardmarket IT Developments Insight](https://www.cardmarket.com/en/Magic/Insight/Articles/Insight-into-Cardmarket-IT-Developments)

---

## 2. Anti-Bot Protection Analysis

### Protection Layers

#### Layer 1: Custom CAPTCHA System (BWSTATE)
Cardmarket uses a **proprietary** verification system, NOT standard reCAPTCHA or hCaptcha:

```
Endpoints:
├── /human-test/start     # Initiates challenge
├── /human-test/prompt    # Returns challenge parameters
└── /human-test/verify    # Validates solution

Cookie: BWSTATE (session state token)
Header: X-Captcha-Id (challenge identifier)
```

**Challenge Type**: Proof-of-Work (PoW) + Image-based

The system requires:
1. **Hash computation** with trailing zeros (PoW)
2. **Image-based challenge** after PoW completes
3. **Cookie persistence** for session validation

#### Layer 2: Request Fingerprinting
Based on 403 responses to basic requests, Cardmarket fingerprints:
- User-Agent patterns
- TLS fingerprint (JA3/JA4)
- Request timing patterns
- Header ordering

#### Layer 3: Behavioral Analysis
- Request frequency monitoring
- Session consistency checks
- Geographic anomaly detection

### Key Insight: Not Standard Cloudflare
While Cardmarket uses Cloudflare infrastructure, their `/human-test/*` endpoints indicate a **custom WAF solution**. Standard Cloudflare bypass techniques (cf_clearance cookies) may not apply.

---

## 3. HTML Structure Patterns

### Product Listing Pages (Expansion View)

Based on analysis of existing scrapers and common patterns:

```html
<!-- Primary Structure (2024-2026) -->
<div class="table-body">
  <div class="row">
    <div class="col-product">
      <a href="/en/OnePiece/Products/Singles/{Set}/{Card-Name}">
        Card Name
      </a>
    </div>
    <div class="col-seller">
      <span class="seller-name">...</span>
    </div>
    <div class="col-price">
      <span class="font-weight-bold">€ X,XX</span>
    </div>
    <div class="col-availability">
      <span>N available</span>
    </div>
  </div>
</div>
```

### Card Detail Pages

```html
<!-- Price Information Container -->
<div class="info-list-container">
  <dl>
    <dt>From</dt>
    <dd>€ X,XX</dd>
    <dt>Trend</dt>
    <dd>€ X,XX</dd>
    <dt>30-days average</dt>
    <dd>€ X,XX</dd>
    <dt>7-days average</dt>
    <dd>€ X,XX</dd>
    <dt>Available items</dt>
    <dd>N</dd>
  </dl>
</div>

<!-- Seller Listings -->
<div class="article-row">
  <div class="col-seller">...</div>
  <div class="col-condition">
    <abbr title="Near Mint">NM</abbr>
  </div>
  <div class="col-price">€ X,XX</div>
</div>
```

### URL Patterns

```
Base: https://www.cardmarket.com/en/OnePiece

Expansion List:
/Products/Singles/{SetName}
/Products/Singles/{SetName}?site={page}

Card Detail:
/Products/Singles/{SetName}/{CardName-SetCode-Number}

Examples:
/Products/Singles/Romance-Dawn
/Products/Singles/Romance-Dawn/Monkey-D-Luffy-OP01-003
```

---

## 4. Resilience Strategies

### Strategy A: Browser-First Approach (Recommended)

Given the custom PoW+CAPTCHA system, **browser automation is essential**:

```typescript
// Optimized Browser Configuration
const browserConfig = {
  // Use Chrome remote debugging instead of WebDriver
  useRemoteDebugging: true,
  debuggingPort: 9222,

  // Maintain persistent session
  userDataDir: './chrome-session',

  // Essential for anti-detection
  headless: 'new',  // Chrome's new headless mode

  // Disable automation indicators
  args: [
    '--disable-blink-features=AutomationControlled',
    '--disable-infobars',
    '--no-first-run',
  ]
};
```

### Strategy B: Session Harvesting

1. **Manual Session**: Solve CAPTCHA manually once
2. **Extract Cookies**: Capture BWSTATE and session cookies
3. **Reuse in HTTP**: Use cookies for subsequent requests until expiry

```typescript
// Session harvesting approach
async function harvestSession(): Promise<SessionCookies> {
  const browser = await playwright.chromium.launch({ headless: false });
  const page = await browser.newPage();

  await page.goto('https://www.cardmarket.com/en/OnePiece');

  // Wait for user to solve CAPTCHA
  await page.waitForSelector('.info-list-container', { timeout: 300000 });

  // Extract cookies
  const cookies = await page.context().cookies();
  const bwstate = cookies.find(c => c.name === 'BWSTATE');

  await browser.close();
  return { bwstate, cookies };
}
```

### Strategy C: Adaptive Escalation

Start with HTTP, escalate to browser only when blocked:

```typescript
const escalationConfig = {
  // Trigger escalation on these conditions
  escalationTriggers: [
    { status: 403, threshold: 1 },
    { status: 429, threshold: 1 },
    { bodyContains: 'human-test', threshold: 1 },
    { bodyContains: 'BWSTATE', threshold: 1 },
  ],

  // De-escalate after sustained success
  deescalationAfter: 10,  // successful requests

  // Browser session TTL
  sessionTTL: 30 * 60 * 1000,  // 30 minutes
};
```

---

## 5. Rate Limiting Recommendations

### Based on Community Experience

| Source | Recommendation |
|--------|----------------|
| [RichyLe69/CardMarketScraper](https://github.com/RichyLe69/CardMarketScraper) | 3-5 seconds between requests |
| [Apify Scraper](https://apify.com/ecomscrape/cardmarket-card-page-details-scraper/api) | Batch processing with delays |
| Community consensus | Sequential, not parallel |

### Recommended Configuration

```typescript
const rateLimitConfig = {
  // Base delay between requests
  baseDelayMs: 3000,

  // Add variance to appear human
  variancePercent: 0.3,  // ±30%

  // Longer delay between different cards
  interCardDelayMs: 5000,

  // Very long delay between sets
  interSetDelayMs: 30000,

  // Daily limits to avoid long-term blocking
  maxRequestsPerHour: 200,
  maxRequestsPerDay: 2000,

  // Respect server load
  preferredHours: [2, 3, 4, 5, 6],  // UTC, off-peak
};
```

---

## 6. Selector Resilience

### Multi-Strategy Approach

Don't rely on single selectors. Use fallback chains:

```typescript
const RESILIENT_SELECTORS = {
  productPrice: {
    // Ordered by reliability
    strategies: [
      // Strategy 1: Semantic class names
      '.col-price .font-weight-bold',

      // Strategy 2: Structure-based
      '.row > div:nth-child(3) span',

      // Strategy 3: Content pattern
      'span:contains("€")',

      // Strategy 4: Regex on raw HTML
      /€\s*([\d.,]+)/,

      // Strategy 5: JSON-LD structured data
      'script[type="application/ld+json"]',
    ],

    // Validation
    validate: (value: string) => /^\d+[.,]\d{2}$/.test(value.replace(/[€\s]/g, '')),
  },
};
```

### Detecting Structure Changes

```typescript
// Monitor selector success rates
class SelectorMonitor {
  private successRates: Map<string, number> = new Map();

  recordAttempt(selector: string, success: boolean): void {
    const current = this.successRates.get(selector) || 0.5;
    const newRate = current * 0.9 + (success ? 0.1 : 0);
    this.successRates.set(selector, newRate);

    // Alert on degradation
    if (newRate < 0.3) {
      this.alertSelectorDegraded(selector, newRate);
    }
  }
}
```

---

## 7. Optimized Data Extraction

### Server-Side Rendered Data

Much of Cardmarket's data is SSR, meaning it's in the initial HTML:

```typescript
// Prioritize SSR data extraction
async function extractSSRData(html: string): Promise<CardData> {
  const $ = cheerio.load(html);

  // Check for JSON-LD first (most reliable)
  const jsonLd = $('script[type="application/ld+json"]').html();
  if (jsonLd) {
    try {
      return parseJsonLd(JSON.parse(jsonLd));
    } catch {}
  }

  // Fall back to HTML parsing
  return parseHtmlStructure($);
}
```

### Client-Side Rendered Data

Some data may load via JavaScript (seller listings, real-time prices):

```typescript
// Wait for hydration completion
async function waitForHydration(page: Page): Promise<void> {
  // Cardmarket likely uses React hydration
  await page.waitForFunction(() => {
    // Check if React has hydrated
    const root = document.querySelector('#app') || document.body;
    return root.hasAttribute('data-reactroot') ||
           root.querySelector('[data-reactroot]') !== null;
  }, { timeout: 10000 });

  // Additional wait for dynamic content
  await page.waitForSelector('.article-row', { timeout: 5000 }).catch(() => {});
}
```

---

## 8. Error Recovery Patterns

### Handling BWSTATE Challenges

```typescript
async function handleBWSTATEChallenge(page: Page): Promise<boolean> {
  // Detect challenge
  const challengePresent = await page.evaluate(() => {
    return document.body.innerHTML.includes('human-test') ||
           document.body.innerHTML.includes('BWSTATE');
  });

  if (!challengePresent) return true;

  console.log('BWSTATE challenge detected, waiting for resolution...');

  // Option 1: Wait for automatic PoW completion
  await page.waitForTimeout(5000);

  // Option 2: Manual intervention (for development)
  if (process.env.ALLOW_MANUAL_CAPTCHA) {
    await page.waitForNavigation({ timeout: 300000 });
    return true;
  }

  // Option 3: External solver (production)
  // Note: Custom solver needed - not standard CAPTCHA services
  return false;
}
```

### Circuit Breaker Configuration

```typescript
const circuitBreakerConfig = {
  // Cardmarket-specific thresholds
  failureThreshold: 3,      // Open after 3 failures
  successThreshold: 2,      // Close after 2 successes
  timeout: 5 * 60 * 1000,   // 5 min before retry

  // Per-endpoint circuits
  endpoints: {
    'expansion': { failureThreshold: 5 },
    'card-detail': { failureThreshold: 3 },
    'articles': { failureThreshold: 3 },
  },
};
```

---

## 9. Recommended Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Cardmarket Scraper                        │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐     │
│  │   Session   │───▶│   Request   │───▶│    HTML     │     │
│  │  Manager    │    │  Executor   │    │   Parser    │     │
│  └─────────────┘    └─────────────┘    └─────────────┘     │
│         │                 │                   │             │
│         │                 │                   │             │
│  ┌──────▼──────┐   ┌─────▼─────┐      ┌─────▼─────┐       │
│  │   Cookie    │   │  Circuit  │      │  Selector │       │
│  │  Harvester  │   │  Breaker  │      │  Monitor  │       │
│  └─────────────┘   └───────────┘      └───────────┘       │
│                                                              │
├─────────────────────────────────────────────────────────────┤
│                    Transport Layer                           │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐     │
│  │    HTTP     │◀──▶│   Hybrid    │◀──▶│  Playwright │     │
│  │   Client    │    │  Switcher   │    │   Client    │     │
│  └─────────────┘    └─────────────┘    └─────────────┘     │
│                            │                                 │
│                     ┌──────▼──────┐                         │
│                     │   Proxy     │                         │
│                     │  Rotator    │                         │
│                     └─────────────┘                         │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## 10. Key Recommendations

### Do's ✅

1. **Use browser automation** as primary method (Playwright preferred)
2. **Maintain persistent sessions** with harvested cookies
3. **Sequential processing** - one card at a time
4. **3-5 second delays** between requests minimum
5. **Monitor selector success rates** for early detection of changes
6. **Implement circuit breakers** per endpoint
7. **Run during off-peak hours** (2-6 AM UTC)
8. **Cache aggressively** - card data doesn't change frequently

### Don'ts ❌

1. **Don't use parallel requests** - triggers immediate blocking
2. **Don't rely on standard CAPTCHA solvers** - custom system
3. **Don't ignore BWSTATE cookies** - essential for session
4. **Don't scrape high-value pages first** - warm up session
5. **Don't use datacenter proxies** - residential only
6. **Don't exceed 200 requests/hour** without session rotation

---

## 11. References

### GitHub Implementations
- [DrankRock/CMScrape](https://github.com/DrankRock/CMScrape) - Python scraper (archived)
- [RichyLe69/CardMarketScraper](https://github.com/RichyLe69/CardMarketScraper) - YuGiOh sequential scraper
- [marekpiskorek/cardmarket_crawler](https://github.com/marekpiskorek/cardmarket_crawler) - Scrapy + Splash
- [Timothy-Be/Cardmarket-searcher](https://github.com/Timothy-Be/Cardmarket-searcher) - Selenium approach

### Commercial Services
- [Apify Cardmarket Scraper](https://apify.com/ecomscrape/cardmarket-card-page-details-scraper/api) - $20/month + usage
- [Apify Trend Scraper](https://apify.com/ecomscrape/cardmarket-trend-scraper/api) - Market trend data

### Alternative Data Sources
- [JustTCG API](https://justtcg.com/blog/the-definitive-tcgplayer-api-alternative-for-developers-in-2025) - Allows combining with Cardmarket
- [TCGdex API](https://tcgdex.dev/markets-prices) - Pokémon TCG with Cardmarket prices

### Anti-Bot Research
- [ZenRows CAPTCHA Bypass Guide](https://www.zenrows.com/blog/bypass-captcha-web-scraping)
- [Proof-of-Work CAPTCHA Concepts](https://friendlycaptcha.com/insights/controlling-variance-in-proof-of-work-algorithms/)

---

## 12. Verified Extraction Results (January 2026)

### Test Confirmation: Price Data CAN Be Extracted

Successfully tested extraction on **January 8, 2026** using Playwright headless Chrome.

#### Test Results

| Card | URL | Status | Prices Extracted |
|------|-----|--------|------------------|
| Monkey.D.Luffy (OP01-003) | `.../MonkeyDLuffy-OP01-003-V1` | ✅ 200 | From: 0,02 €, Trend: 0,45 € |
| Shanks (OP01-120) | `.../Shanks-OP01-120-V1` | ✅ 200 | From: 2,00 €, Trend: 5,26 € |

#### Extracted Data Points

For **Monkey.D.Luffy (OP01-003)**:
```
Number: 003
Available items: 420
From: 0,02 €
Price Trend: 0,45 €
30-days average price: 0,34 €
7-days average price: 0,47 €
1-day average price: 0,30 €
```

For **Shanks (OP01-120)** (high-value card):
```
Number: 120
Available items: 295
From: 2,00 €
Price Trend: 5,26 €
30-days average price: 3,96 €
7-days average price: 5,22 €
1-day average price: 2,82 €
```

### Verified URL Pattern

```
https://www.cardmarket.com/en/OnePiece/Products/Singles/{SetName}/{CardName}-{SetCode}-{Number}-V{Variant}

Examples:
- MonkeyDLuffy-OP01-003-V1  (base version)
- Shanks-OP01-120-V1       (base version)
- CardName-OP01-XXX-V2     (alternate version)
```

**Important**: Card names in URLs are **camelCase with no spaces or special characters**.

### Verified Selectors

```typescript
// Primary extraction method: dt/dd pairs in .info-list-container
const VERIFIED_SELECTORS = {
  priceContainer: '.info-list-container dl, dl',
  labelElements: 'dt',
  valueElements: 'dd',

  // Price labels to extract
  labels: {
    'from': /^from$/i,
    'priceTrend': /^price trend$/i,
    'avg30': /^30-days average price$/i,
    'avg7': /^7-days average price$/i,
    'avg1': /^1-day average price$/i,
    'available': /^available items$/i,
    'number': /^number$/i,
  },
};
```

### Price Format

Prices are in **European format**:
- Format: `X,XX €` (number followed by € symbol)
- Decimal separator: comma (`,`)
- Thousands separator: period (`.`) for large values
- Example: `5,26 €` = €5.26

### Parser Code (Verified Working)

```typescript
import * as cheerio from 'cheerio';

interface CardPrices {
  cardNumber?: string;
  available?: number;
  from?: number;
  trend?: number;
  avg30?: number;
  avg7?: number;
  avg1?: number;
}

function parseEuroPrice(text: string): number | undefined {
  // Match "X,XX €" format
  const match = text.match(/([\d.,]+)\s*€/);
  if (!match) return undefined;
  // Convert European format to number: 5,26 -> 5.26
  return parseFloat(match[1].replace('.', '').replace(',', '.'));
}

function extractCardPrices(html: string): CardPrices {
  const $ = cheerio.load(html);
  const prices: CardPrices = {};

  $('dt').each((_, el) => {
    const label = $(el).text().trim().toLowerCase();
    const value = $(el).next('dd').text().trim();

    if (label === 'number') {
      prices.cardNumber = value;
    } else if (label === 'available items') {
      prices.available = parseInt(value, 10);
    } else if (label === 'from') {
      prices.from = parseEuroPrice(value);
    } else if (label === 'price trend') {
      prices.trend = parseEuroPrice(value);
    } else if (label.includes('30-days')) {
      prices.avg30 = parseEuroPrice(value);
    } else if (label.includes('7-days')) {
      prices.avg7 = parseEuroPrice(value);
    } else if (label.includes('1-day')) {
      prices.avg1 = parseEuroPrice(value);
    }
  });

  return prices;
}
```

### Key Findings

1. **Direct HTTP is blocked** (403 Forbidden)
2. **Playwright headless works** with stealth settings
3. **No CAPTCHA triggered** during test (may vary with volume)
4. **Data is SSR** - available in initial HTML, no need to wait for JS
5. **Price format is European** - comma decimal, € suffix

### Recommended Browser Configuration (Verified)

```typescript
const browser = await chromium.launch({
  headless: true,
  args: ['--disable-blink-features=AutomationControlled'],
});

const context = await browser.newContext({
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  viewport: { width: 1920, height: 1080 },
});

await context.addInitScript(() => {
  Object.defineProperty(navigator, 'webdriver', { get: () => false });
});
```
