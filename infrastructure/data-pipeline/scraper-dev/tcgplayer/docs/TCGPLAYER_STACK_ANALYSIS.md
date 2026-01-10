# TCGplayer Technology Stack Analysis

> **Research Date**: January 2026
> **Purpose**: Design robust scraper architecture for TCGplayer price data
> **Learning Applied**: Patterns from Cardmarket scraper development

## Executive Summary

TCGplayer presents a **multi-layered data acquisition challenge** with several key findings:

1. **Same BWSTATE Anti-Bot System as Cardmarket** - TCGplayer uses identical `/human-test/*` endpoints
2. **Official API Access Restricted** - New developer applications suspended since 2025
3. **Multiple Alternative Data Sources** - OPTCG API (free), JustTCG API (paid), direct scraping
4. **Browser Automation Required** - JavaScript fingerprinting necessitates Playwright/Selenium

---

## 1. Technology Stack Overview

### 1.1 Frontend Analysis

| Component | Technology | Evidence |
|-----------|------------|----------|
| **Framework** | JavaScript (possibly React) | Custom JS modules, dynamic content |
| **Fonts** | Poppins (Google Fonts) | Same as Cardmarket |
| **Rendering** | Client-side + SSR hybrid | Product pages require JS execution |
| **Languages** | 10 supported | EN, DE, FR, ES, IT, RU, KO, JA, ZH, AR |

### 1.2 Anti-Bot Protection

**Critical Finding: TCGplayer uses the SAME BWSTATE system as Cardmarket!**

```
Endpoints (Identical to Cardmarket):
├── /human-test/start     # Retrieves captcha image and ID
├── /human-test/prompt    # Loads click instruction
└── /human-test/verify    # Validates user interaction

Cookie: BWSTATE (5-minute expiration, SameSite=Lax)
Header: X-Captcha-Id (challenge identifier)
```

**Protection Layers:**
1. **Proof-of-Work**: Hash computation with trailing zeros
2. **Image CAPTCHA**: Click-based verification
3. **JavaScript Fingerprinting**: navigator.webdriver detection
4. **TLS Fingerprinting**: JA3/JA4 signature analysis
5. **Behavioral Analysis**: Request patterns, timing

### 1.3 URL Structures

```
Base: https://www.tcgplayer.com

Price Guides:
/categories/trading-and-collectible-card-games/one-piece-card-game/price-guides
/categories/trading-and-collectible-card-games/one-piece-card-game/price-guides/{set-slug}

Examples:
/price-guides/romance-dawn
/price-guides/pillars-of-strength
/price-guides/extra-booster-memorial-collection

Product Search:
/search/one-piece-card-game/product?productLineName=one-piece-card-game

Individual Products:
/product/{product-id}/{card-slug}
```

### 1.4 Sources

- [BuiltWith Technology Profile](https://builtwith.com/tcgplayer.com)
- [TCGplayer Developer Portal](https://developer.tcgplayer.com/)
- [TCGplayer API Documentation](https://docs.tcgplayer.com/docs/welcome)

---

## 2. Data Source Options

### 2.1 Official TCGplayer API (RESTRICTED)

**Status**: New developer applications suspended since early 2025.

| Aspect | Details |
|--------|---------|
| **Access** | Existing users only; no new registrations |
| **Version** | v1.39.0 (deprecated older versions Aug 2023) |
| **Authentication** | Bearer token via PRIVATE_KEY + ACCESS_TOKEN |
| **Terms** | Explicitly forbids combining with other pricing sources |
| **Endpoints** | Catalog, pricing, store management |

**Implications**: Cannot rely on official API for new development.

### 2.2 OPTCG API (FREE - RECOMMENDED)

**Website**: [optcgapi.com](https://optcgapi.com/)

| Aspect | Details |
|--------|---------|
| **Cost** | Free |
| **Coverage** | One Piece TCG only |
| **Data** | OP01-OP12, EB01-EB02, PRB01-PRB02, ST01-ST28, 900+ promos |
| **Updates** | Historic pricing up to 2 weeks |
| **Rate Limits** | Limited (unspecified daily cap) |
| **Fields** | Name, Type, Color, Rarity, Set, Market Price, Inventory Price |

**Current Integration**: Already used by `trading-card-pricer` Lambda.

```typescript
// Example OPTCG API usage
const response = await fetch('https://optcgapi.com/api/cards/OP01-003');
const card = await response.json();
// { name: "Monkey.D.Luffy", marketPrice: 0.45, ... }
```

### 2.3 JustTCG API (PAID - COMPREHENSIVE)

**Website**: [justtcg.com](https://justtcg.com/docs)

| Plan | Monthly Requests | Rate/Minute | Price |
|------|------------------|-------------|-------|
| Free | 1,000 | 10 | $0 |
| Starter | 10,000 | 50 | ~$20/mo |
| Professional | 50,000 | 100 | ~$50/mo |
| Enterprise | 500,000 | 500 | Custom |

**Features**:
- 13 supported games including One Piece TCG
- Condition/printing variants (NM Foil, Played Normal, etc.)
- Historical data: 7d, 30d, 90d, 180d
- Batch operations (up to 200 cards/request)
- Delta sync via `updated_after` parameter

```typescript
// JustTCG API example
const response = await fetch('https://api.justtcg.com/v1/cards?game=one-piece-tcg&set=romance-dawn', {
  headers: { 'x-api-key': 'tcg_your_api_key_here' }
});
```

### 2.4 Direct Scraping (COMPLEX)

**Feasibility**: Possible but challenging due to BWSTATE protection.

| Approach | Difficulty | Success Rate | Cost |
|----------|------------|--------------|------|
| Direct HTTP | Very High | <5% | Low |
| Selenium + Stealth | High | 60-80% | Medium |
| Playwright + Stealth | High | 70-85% | Medium |
| Residential Proxies | Medium | 90%+ | High |
| Browser Farm | Low | 95%+ | Very High |

**Recommended Tools**:
- [playwright-extra](https://github.com/berstend/puppeteer-extra/tree/master/packages/playwright-extra) with stealth plugin
- [Camoufox](https://camoufox.com/) - Firefox-based anti-detect browser
- [SeleniumBase UC Mode](https://seleniumbase.io/) - Built-in CAPTCHA handling

### 2.5 Alternative APIs Comparison

| Source | One Piece Support | Price | Updates | Historical Data |
|--------|-------------------|-------|---------|-----------------|
| OPTCG API | Yes (primary) | Free | Daily | 2 weeks |
| JustTCG | Yes | Paid | Multiple/day | Up to 180 days |
| Limitless | Yes | Free | Daily | Limited |
| TCGNode | Yes | Free | Varies | Limited |

---

## 3. Lessons from Cardmarket Scraper

### 3.1 What Worked

1. **Playwright with Stealth Mode**
   - `--disable-blink-features=AutomationControlled`
   - `navigator.webdriver = false` injection
   - Realistic viewport and user agent

2. **Rate Limiting Strategy**
   - 3-5 seconds between requests
   - Sequential processing (no parallelism)
   - Variance to appear human (±30%)

3. **Session Management**
   - BWSTATE cookie harvesting
   - Session persistence across requests
   - Challenge detection and waiting

4. **Resilient Selectors**
   - Multiple fallback strategies
   - Regex patterns as backup
   - JSON-LD structured data extraction

5. **Pipeline Architecture**
   - S3 for raw data (partitioned by date/set)
   - Transformation layer (validation, currency conversion)
   - RDS for normalized prices
   - Price history for ML training

### 3.2 What to Improve

1. **Earlier API Discovery**
   - Research existing APIs before building scraper
   - OPTCG API could have saved significant effort

2. **Hybrid Approach**
   - Use APIs for bulk data
   - Scrape only for missing/real-time data

3. **Cost Optimization**
   - Evaluate paid APIs vs scraping infrastructure cost
   - JustTCG at $50/mo may be cheaper than Lambda + Playwright

4. **Better Error Recovery**
   - More granular circuit breakers
   - Automatic proxy rotation on blocks

---

## 4. Recommended Architecture for TCGplayer

### 4.1 Hybrid Data Strategy

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         TCGPLAYER DATA STRATEGY                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  PRIMARY DATA SOURCE (90% of data)                                          │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                          OPTCG API                                   │    │
│  │  • Free, already integrated                                          │    │
│  │  • Covers all One Piece TCG sets                                     │    │
│  │  • Updates: Daily                                                    │    │
│  │  • Use for: Bulk price updates, historical data                      │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  SECONDARY DATA SOURCE (Gap filling)                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                      JustTCG API (Optional)                          │    │
│  │  • Paid: $20-50/month                                                │    │
│  │  • Multi-game support                                                │    │
│  │  • Historical data: Up to 180 days                                   │    │
│  │  • Use for: Condition variants, deeper history                       │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  TERTIARY DATA SOURCE (Real-time / Validation)                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                    Direct Scraper (Playwright)                       │    │
│  │  • High infrastructure cost                                          │    │
│  │  • Complex anti-bot handling                                         │    │
│  │  • Use for: Real-time spot checks, price validation                  │    │
│  │  • Reuse BWSTATE patterns from Cardmarket                            │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 4.2 Data Flow Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         TCGPLAYER DATA PIPELINE                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  EventBridge (8AM/8PM UTC)                                                   │
│       │                                                                      │
│       ▼                                                                      │
│  ┌─────────────────┐                                                        │
│  │  Step Functions │                                                        │
│  │   Orchestrator  │                                                        │
│  └────────┬────────┘                                                        │
│           │                                                                  │
│    ┌──────┴──────┬──────────────┐                                          │
│    ▼             ▼              ▼                                           │
│ ┌──────┐    ┌──────┐      ┌──────────┐                                     │
│ │OPTCG │    │JustTCG│     │ Scraper  │                                     │
│ │ API  │    │  API  │     │(Fallback)│                                     │
│ │Lambda│    │Lambda │     │  Lambda  │                                     │
│ └──┬───┘    └──┬───┘      └────┬─────┘                                     │
│    │           │               │                                            │
│    └───────────┴───────┬───────┘                                           │
│                        ▼                                                    │
│              ┌─────────────────┐                                           │
│              │   S3 Raw Data   │                                           │
│              │   (Partitioned) │                                           │
│              └────────┬────────┘                                           │
│                       ▼                                                     │
│              ┌─────────────────┐                                           │
│              │   Transformer   │                                           │
│              │  (Normalize,    │                                           │
│              │   Dedupe,       │                                           │
│              │   Validate)     │                                           │
│              └────────┬────────┘                                           │
│                       ▼                                                     │
│              ┌─────────────────┐                                           │
│              │   RDS Loader    │                                           │
│              │                 │                                           │
│              │ card_prices_v2  │──▶ Current prices                         │
│              │ price_history   │──▶ ML training data                       │
│              └─────────────────┘                                           │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 4.3 Code Reuse from Cardmarket

| Component | Reusability | Notes |
|-----------|-------------|-------|
| `session-manager.ts` | **100%** | Same BWSTATE system |
| `circuit-breaker.ts` | **100%** | Generic pattern |
| `fingerprint.ts` | **100%** | Browser fingerprinting |
| `playwright-client.ts` | **90%** | Minor URL adjustments |
| `s3-storage.ts` | **100%** | Same storage pattern |
| `database-loader.ts` | **95%** | Same schema target |
| `transformer.ts` | **80%** | USD→GBP instead of EUR→GBP |
| `pipeline/orchestrator.ts` | **85%** | Different data sources |
| `html-parser.ts` | **30%** | Different DOM structure |
| `config/selectors.ts` | **0%** | Completely different |

---

## 5. AWS Infrastructure Requirements

### 5.1 Compute Resources

| Resource | Purpose | Specs |
|----------|---------|-------|
| Lambda (API Fetcher) | OPTCG/JustTCG API calls | 512MB, 60s timeout |
| Lambda (Scraper) | Playwright browser automation | 2048MB, 15min timeout |
| Lambda (Transformer) | Data normalization | 1024MB, 5min timeout |
| Lambda (Loader) | RDS upserts | 512MB, 2min timeout |
| Step Functions | Pipeline orchestration | Standard workflow |

### 5.2 Storage

| Resource | Purpose | Retention |
|----------|---------|-----------|
| S3 (Raw) | API responses, scraped HTML | 30 days → Glacier |
| S3 (Transformed) | Normalized JSON | 90 days |
| S3 (Training) | ML exports (Parquet) | Indefinite |
| RDS (card_prices_v2) | Current prices | Indefinite |
| RDS (price_history) | Historical data | 1 year |

### 5.3 Networking

| Resource | Purpose |
|----------|---------|
| VPC | Lambda isolation |
| NAT Gateway | Outbound internet for Lambda |
| Security Groups | RDS access control |
| Secrets Manager | API keys, DB credentials |

### 5.4 Monitoring

| Resource | Metrics |
|----------|---------|
| CloudWatch | API call counts, error rates, latency |
| CloudWatch Alarms | Error threshold, DLQ depth |
| CloudWatch Dashboard | Pipeline health visualization |
| SNS | Alert notifications |
| SQS + DLQ | Failed job handling |

### 5.5 Estimated Costs

| Service | Monthly Est. |
|---------|--------------|
| Lambda | $10-20 |
| S3 | $5-10 |
| Step Functions | $2-5 |
| CloudWatch | $5-10 |
| NAT Gateway | $30-50 |
| Secrets Manager | $1 |
| **Total (API-only)** | **~$55-100** |
| **+ Playwright Layer** | **+$20-30** |

**Comparison**: JustTCG Professional plan at $50/mo may be more cost-effective than full scraping infrastructure.

---

## 6. Implementation Phases

### Phase 1: API Integration (Week 1)
- [ ] Integrate OPTCG API client
- [ ] Implement response parsing
- [ ] Store to S3 and RDS
- [ ] Validate against existing data

### Phase 2: JustTCG Integration (Week 2)
- [ ] Evaluate pricing tiers
- [ ] Implement API client with rate limiting
- [ ] Handle batch operations
- [ ] Merge with OPTCG data

### Phase 3: Scraper Fallback (Week 3-4)
- [ ] Port Cardmarket session manager
- [ ] Adapt Playwright client for TCGplayer
- [ ] Implement TCGplayer-specific parsers
- [ ] Test against live site

### Phase 4: Pipeline Integration (Week 5)
- [ ] Integrate with existing Cardmarket pipeline
- [ ] Unified transformer for both sources
- [ ] Combined price aggregation
- [ ] ML training data export

---

## 7. Risk Assessment

### 7.1 Technical Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| OPTCG API downtime | Medium | High | JustTCG fallback |
| BWSTATE challenges increase | Medium | Medium | Session harvesting |
| TCGplayer blocks scraper | High | Low | API-first strategy |
| Rate limit changes | Low | Medium | Adaptive throttling |

### 7.2 Business Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| OPTCG API discontinues | Low | High | JustTCG subscription |
| JustTCG price increases | Medium | Low | Direct scraping fallback |
| Data quality degradation | Medium | Medium | Cross-source validation |

---

## 8. Appendix

### A. TCGplayer Set Slug Reference

```typescript
const TCGPLAYER_SETS = {
  'OP01': 'romance-dawn',
  'OP02': 'paramount-war',
  'OP03': 'pillars-of-strength',
  'OP04': 'kingdoms-of-intrigue',
  'OP05': 'awakening-of-the-new-era',
  'OP06': 'wings-of-the-captain',
  'OP07': 'future-500-years-later',
  'OP08': 'two-legends',
  'OP09': 'the-four-emperors',
  'OP10': 'royal-bloodlines',
  'OP11': 'the-twin-fighters',
  'OP12': 'the-greatest-rival',
  'OP13': 'the-adventurers-of-the-new-age',
  'EB01': 'extra-booster-memorial-collection',
  'EB02': 'premium-booster-the-best',
};
```

### B. API Response Format Comparison

**OPTCG API:**
```json
{
  "cardId": "OP01-003",
  "name": "Monkey.D.Luffy",
  "marketPrice": 0.45,
  "inventoryPrice": 0.38,
  "rarity": "SR",
  "color": "Red"
}
```

**JustTCG API:**
```json
{
  "id": "op01-003-sr",
  "name": "Monkey.D.Luffy",
  "game": "one-piece-tcg",
  "set": { "code": "OP01", "name": "Romance Dawn" },
  "rarity": "Super Rare",
  "variants": [
    {
      "condition": "Near Mint",
      "printing": "Normal",
      "price": { "usd": 0.45, "updated_at": "2026-01-08T00:00:00Z" }
    }
  ]
}
```

### C. Reference Links

- [TCGplayer Developer Portal](https://developer.tcgplayer.com/)
- [TCGplayer API Documentation](https://docs.tcgplayer.com/docs/welcome)
- [OPTCG API](https://optcgapi.com/)
- [JustTCG API Documentation](https://justtcg.com/docs)
- [Limitless One Piece](https://onepiece.limitlesstcg.com/cards)
- [Magical Meta Price Tracker](https://magicalmeta.ink/onepiece)
- [davidteather/TCGPlayer-Scraper](https://github.com/davidteather/TCGPlayer-Scraper)
- [Richard-Stump/pokespider](https://github.com/Richard-Stump/pokespider)
- [How to Bypass Cloudflare - ZenRows](https://www.zenrows.com/blog/bypass-cloudflare)
- [Playwright Cloudflare Bypass - ZenRows](https://www.zenrows.com/blog/playwright-cloudflare-bypass)

---

## 9. Advanced Scraping Strategies (2025-2026)

### 9.1 Technology Stack Deep Dive

Based on [BuiltWith](https://builtwith.com/) and [Crunchbase](https://www.crunchbase.com/organization/tcgplayer-com/technology) analysis:

| Category | Technologies |
|----------|--------------|
| **Total Technologies** | 55 (BuiltWith), 35 (G2 Stack) |
| **Server Location** | US-based servers |
| **DNS** | Amazon Route 53, DNSSEC enabled |
| **SSL** | LetsEncrypt certificates |
| **Fonts** | Adobe Fonts, Google Fonts (Poppins) |
| **CDN/Protection** | Cloudflare (inferred from BWSTATE) |
| **Framework** | JavaScript SPA (React suspected) |

**Key Insight**: TCGplayer is a JavaScript-heavy Single Page Application. Content loads dynamically after initial HTML, requiring browser automation or API interception for reliable scraping.

### 9.2 TCGplayer REST API Endpoints

The official API at `api.tcgplayer.com` (v1.39.0) provides these pricing endpoints:

| Endpoint | Description | Notes |
|----------|-------------|-------|
| `POST /token` | Bearer token authentication | Requires PUBLIC_KEY + PRIVATE_KEY |
| `GET /pricing/product/{productIds}` | List product market prices | Comma-separated IDs |
| `GET /pricing/group/{groupId}` | List prices by set/group | Returns all products in set |
| `GET /pricing/sku/{skuIds}` | List SKU market prices | By productConditionId |
| `GET /pricing/marketprices/{skuId}` | Single SKU market price | Single item lookup |
| `GET /pricing/buy/product/{productIds}` | Buylist prices | For seller-facing data |

**Authentication Header:**
```
Authorization: bearer {BEARER_TOKEN}
```

> ⚠️ **Access Restricted**: New developer applications suspended since 2025. Existing keys work but no new registrations.

### 9.3 FlareSolverr Integration

[FlareSolverr](https://github.com/FlareSolverr/FlareSolverr) can solve Cloudflare challenges for subsequent HTTP requests:

**Docker Setup:**
```bash
docker run -d \
  --name=flaresolverr \
  -p 8191:8191 \
  -e LOG_LEVEL=info \
  --restart unless-stopped \
  ghcr.io/flaresolverr/flaresolverr:latest
```

**Usage:**
```typescript
// Request via FlareSolverr proxy
const response = await fetch('http://localhost:8191/v1', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    cmd: 'request.get',
    url: 'https://www.tcgplayer.com/product/123456',
    maxTimeout: 60000,
  }),
});

const { solution } = await response.json();
// solution.cookies contains BWSTATE for subsequent requests
// solution.response contains page HTML
```

**Limitations:**
- Cannot solve hCAPTCHA automatically
- Adds latency (~5-30 seconds per challenge)
- Resource intensive (1GB+ RAM per instance)

### 9.4 Playwright Stealth Configuration

The [playwright-extra](https://github.com/berstend/puppeteer-extra/tree/master/packages/playwright-extra) stealth plugin helps evade detection:

```typescript
import { chromium } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';

// Apply stealth plugin
chromium.use(stealth());

const browser = await chromium.launch({
  headless: true,
  args: [
    '--disable-blink-features=AutomationControlled',
    '--disable-features=IsolateOrigins,site-per-process',
    '--disable-site-isolation-trials',
  ],
});

const context = await browser.newContext({
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36...',
  viewport: { width: 1920, height: 1080 },
  locale: 'en-US',
  timezoneId: 'America/New_York',
});

// Hide webdriver flag
await context.addInitScript(() => {
  Object.defineProperty(navigator, 'webdriver', { get: () => false });
});

const page = await context.newPage();
```

**Anti-Detection Checklist:**
- [x] Hide `navigator.webdriver` property
- [x] Spoof plugins and mimetypes
- [x] Remove headless indicators
- [x] Randomize user agent per session
- [x] Match timezone to IP geolocation
- [x] Add realistic mouse movements
- [x] Implement human-like delays (1-5 seconds)
- [ ] TLS fingerprint matching (advanced)
- [ ] JA3 signature spoofing (requires proxy)

### 9.5 Network Interception Strategy

Instead of parsing rendered HTML, intercept XHR/fetch responses:

```typescript
const page = await context.newPage();

// Intercept API responses
const priceData: any[] = [];
page.on('response', async (response) => {
  const url = response.url();

  // Capture pricing API calls
  if (url.includes('/api/marketplace/') || url.includes('/pricing/')) {
    try {
      const json = await response.json();
      priceData.push({ url, data: json, timestamp: Date.now() });
    } catch (e) {
      // Not JSON response
    }
  }
});

await page.goto('https://www.tcgplayer.com/product/123456');
await page.waitForLoadState('networkidle');

// priceData now contains intercepted API responses
```

**Benefits:**
- More reliable than DOM scraping
- Immune to CSS class changes
- Captures structured data directly
- Works even if UI changes

### 9.6 Infinite Scroll Handling

TCGplayer search results use lazy loading. Handle with scroll simulation:

```typescript
async function scrollToLoadAll(page: Page, maxScrolls = 50): Promise<void> {
  let previousHeight = 0;
  let scrollCount = 0;

  while (scrollCount < maxScrolls) {
    // Get current scroll height
    const currentHeight = await page.evaluate(() => document.body.scrollHeight);

    if (currentHeight === previousHeight) {
      // No new content loaded
      break;
    }

    previousHeight = currentHeight;

    // Scroll to bottom
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));

    // Wait for content to load (adjust based on network speed)
    await page.waitForTimeout(2000 + Math.random() * 1000);

    scrollCount++;
  }
}
```

**Memory Management:**
For large result sets, extract and remove elements periodically:

```typescript
async function extractAndClear(page: Page): Promise<any[]> {
  return await page.evaluate(() => {
    const items = document.querySelectorAll('.product-card');
    const data = Array.from(items).map(item => ({
      name: item.querySelector('.product-name')?.textContent,
      price: item.querySelector('.product-price')?.textContent,
    }));

    // Remove processed items to free memory
    items.forEach(item => item.remove());

    return data;
  });
}
```

### 9.7 GitHub Scraper Resources

Active TCGplayer scraper projects for reference:

| Project | Language | Features |
|---------|----------|----------|
| [davidteather/TCGPlayer-Scraper](https://github.com/davidteather/TCGPlayer-Scraper) | Python | Chrome + Selenium, image extraction |
| [Mewsterion/tcgplayerscraper](https://github.com/Mewsterion/tcgplayerscraper) | Python | Daily tracking, PDF reports, Python 3.12+ |
| [cjanowski/scrapy_play](https://github.com/cjanowski/scrapy_play) | Python | Scrapy + Playwright, CAPTCHA solver, proxy rotation |
| [seventy-two-gorillas/TCG-pricer](https://github.com/seventy-two-gorillas/TCG-pricer) | Python | CSV input, inventory tracking |
| [Richard-Stump/pokespider](https://github.com/Richard-Stump/pokespider) | Python | Scrapy spider, Pokemon focus |

### 9.8 Resilience Patterns

**Circuit Breaker with Exponential Backoff:**
```typescript
class ResilientScraper {
  private failures = 0;
  private lastFailure = 0;
  private readonly maxFailures = 5;
  private readonly cooldownMs = 60000;

  async scrape(url: string): Promise<any> {
    // Check circuit state
    if (this.failures >= this.maxFailures) {
      const elapsed = Date.now() - this.lastFailure;
      if (elapsed < this.cooldownMs * Math.pow(2, this.failures - this.maxFailures)) {
        throw new Error('Circuit breaker open');
      }
      this.failures = 0; // Reset after cooldown
    }

    try {
      const result = await this.doScrape(url);
      this.failures = 0; // Success resets counter
      return result;
    } catch (error) {
      this.failures++;
      this.lastFailure = Date.now();
      throw error;
    }
  }
}
```

**Proxy Rotation on Block Detection:**
```typescript
const proxyList = [
  'http://proxy1:8080',
  'http://proxy2:8080',
  'http://proxy3:8080',
];

let proxyIndex = 0;

async function getNextProxy(): Promise<string> {
  proxyIndex = (proxyIndex + 1) % proxyList.length;
  return proxyList[proxyIndex];
}

async function scrapeWithRotation(url: string): Promise<any> {
  for (let attempt = 0; attempt < proxyList.length; attempt++) {
    const proxy = await getNextProxy();

    try {
      const browser = await chromium.launch({
        proxy: { server: proxy },
      });
      // ... scrape logic
      return result;
    } catch (error) {
      if (isBlockedError(error)) {
        console.log(`Proxy ${proxy} blocked, rotating...`);
        continue;
      }
      throw error;
    }
  }
  throw new Error('All proxies exhausted');
}
```

### 9.9 Performance Optimization

**Block Unnecessary Resources:**
```typescript
await page.route('**/*', (route) => {
  const resourceType = route.request().resourceType();
  const blockedTypes = ['image', 'font', 'stylesheet', 'media'];

  if (blockedTypes.includes(resourceType)) {
    route.abort();
  } else {
    route.continue();
  }
});
```

**Wait Strategies:**
```typescript
// Bad: Fixed timeout
await page.waitForTimeout(5000);

// Good: Wait for specific element
await page.waitForSelector('.price-value', { timeout: 10000 });

// Better: Wait for network idle
await page.waitForLoadState('networkidle');

// Best: Wait for specific API response
await page.waitForResponse(resp =>
  resp.url().includes('/pricing/') && resp.status() === 200
);
```

---

## 10. Implementation Recommendations

### 10.1 Priority Order for TCGplayer Data

1. **OPTCG API** (Free) - Primary source for One Piece TCG
2. **JustTCG API** ($20-50/mo) - Multi-game support, historical data
3. **Network Interception** - Capture internal API responses
4. **DOM Scraping** - Last resort, most fragile

### 10.2 Anti-Detection Best Practices

| Practice | Implementation |
|----------|----------------|
| Rate limiting | 3-8 seconds between requests |
| Session rotation | New browser context every 20-50 requests |
| IP rotation | Residential proxies for sensitive operations |
| User agent rotation | Pool of 50+ modern user agents |
| Fingerprint consistency | Match UA, viewport, timezone, locale |
| Human behavior | Random delays, mouse movements, scrolling |

### 10.3 Monitoring for Changes

Set up alerts for:
- HTTP 403/429 response rate increase
- Selector match failure rate
- API response structure changes
- New challenge types (hCAPTCHA, Turnstile)

### 10.4 Legal Considerations

- Respect `robots.txt` directives
- Don't overload servers (rate limit appropriately)
- Cache responses to minimize requests
- Consider API licensing for commercial use
- Terms of Service may prohibit automated access
