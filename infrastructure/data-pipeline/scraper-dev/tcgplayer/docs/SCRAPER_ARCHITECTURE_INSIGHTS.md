# TCG Marketplace Scraper Architecture: Insights & Patterns

> **Navigation:**
> - **Up:** [TCGPlayer Index](./README.md) | [Master Index](../../cardmarket/docs/INDEX.md)
> - **Related:** [CardMarket Scraper](../../cardmarket/docs/CARDMARKET_SCRAPER_INFRASTRUCTURE.md) | [Hybrid Pipeline](./HYBRID_PIPELINE_ARCHITECTURE.md)

---

## Executive Summary

This document analyzes the architectural patterns, design decisions, and lessons learned from implementing scrapers for two major TCG marketplaces:

| Marketplace | Region | Currency | Implementation Approach |
|-------------|--------|----------|------------------------|
| **TCGPlayer** | US/NA | USD | Direct API (Search API) |
| **CardMarket** | EU | EUR | Third-party (Apify) |

Both scrapers collect individual seller listings, but use fundamentally different strategies reflecting the unique challenges of each platform.

---

## 1. Data Collection Strategies

### TCGPlayer: API-First Approach

```
┌─────────────────────────────────────────────────────────────────┐
│                    TCGPlayer Data Flow                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   ┌──────────┐      ┌─────────────────┐      ┌──────────────┐  │
│   │  Scraper │ ──▶  │ Search API      │ ──▶  │ JSON Response│  │
│   │  (Node)  │ POST │ (mp-search-api) │      │ (Products +  │  │
│   │          │      │                 │      │  Listings)   │  │
│   └──────────┘      └─────────────────┘      └──────────────┘  │
│                                                                 │
│   ✅ Direct access - no third-party costs                       │
│   ✅ Structured JSON - no HTML parsing                          │
│   ✅ Real-time data - same as website                           │
│   ⚠️ Undocumented API - may change without notice               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Key Discovery**: TCGPlayer's website is a Single Page Application (SPA) that calls `mp-search-api.tcgplayer.com`. This API is publicly accessible and returns rich JSON including:
- Product metadata (name, set, rarity, card number)
- Aggregate prices (market, median, low, high)
- **Individual seller listings** with full details

**Why HTML Scraping Failed**:
```typescript
// Bright Data returned raw HTML before JavaScript executed
// TCGPlayer SPA structure:
<body>
  <div id="app" class="app-container"></div>  // Empty shell
  <script src="/js/index-*.js"></script>       // JS loads content
</body>

// Result: 42KB of HTML with ZERO actual product data
```

### CardMarket: Third-Party Service Approach

```
┌─────────────────────────────────────────────────────────────────┐
│                   CardMarket Data Flow                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   ┌──────────┐      ┌──────────┐      ┌──────────┐      ┌────┐ │
│   │ Collector│ ──▶  │  Apify   │ ──▶  │ CardMarket│ ──▶ │JSON│ │
│   │  (Node)  │ POST │  Actor   │ HTTP │  Website  │     │Data│ │
│   │          │      │(headless)│      │   (SSR)   │     │    │ │
│   └──────────┘      └──────────┘      └──────────┘      └────┘ │
│                                                                 │
│   ✅ Handles anti-bot protection                                │
│   ✅ Manages browser automation                                 │
│   ⚠️ Cost: ~$0.02 per card (~$20/month)                         │
│   ⚠️ Async: Must poll for completion                            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Why Third-Party**: CardMarket has more aggressive bot detection and no public API. Using Apify provides:
- Headless browser with anti-detection
- Residential proxy rotation
- CAPTCHA solving
- Managed infrastructure

---

## 2. Architectural Patterns Comparison

### Class Structure

| Aspect | TCGPlayer | CardMarket |
|--------|-----------|------------|
| **Main Class** | `TCGPlayerSearchAPIScraper` | `CardmarketCollector` |
| **Config Pattern** | Merged defaults + user config | Constructor injection |
| **State Management** | Internal metrics, errors[] | Minimal state |
| **Factory Function** | `createTCGPlayerSearchScraper()` | `createCardmarketCollector()` |

### Configuration Patterns

**TCGPlayer** - Comprehensive with sensible defaults:
```typescript
const DEFAULT_CONFIG: Required<TCGPlayerSearchConfig> = {
  requestDelayMs: 1500,      // Rate limiting
  maxRetries: 3,             // Resilience
  retryDelayMs: 3000,        // Backoff base
  maxListingsPerProduct: 50, // Data volume control
  includeListings: true,     // Feature flag
  pageSize: 50,              // Pagination
};
```

**CardMarket** - Minimal, delegating to Apify:
```typescript
export interface CardmarketCollectorConfig {
  apifyToken: string;                   // Required auth
  actorId?: string;                     // Optional override
}
// Note: Retry logic, rate limiting handled by Apify
```

**Insight**: When using third-party services, configuration is simpler because the service handles operational concerns. Direct API integration requires more explicit configuration.

### Rate Limiting Strategies

**TCGPlayer** - Client-side throttling:
```typescript
private async rateLimit(): Promise<void> {
  const now = Date.now();
  const elapsed = now - this.lastRequestTime;

  if (elapsed < this.config.requestDelayMs) {
    await new Promise(resolve =>
      setTimeout(resolve, this.config.requestDelayMs - elapsed)
    );
  }

  this.lastRequestTime = Date.now();
}
```

**CardMarket** - Delegated to Apify:
```typescript
// No explicit rate limiting in collector
// Apify actor handles this internally with:
//   - Proxy rotation
//   - Request queuing
//   - Automatic retries
```

**Insight**: Direct API access requires implementing rate limiting. Third-party services abstract this but at higher cost.

### Retry Logic

**TCGPlayer** - Exponential backoff:
```typescript
for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
  try {
    // ... attempt request
  } catch (error) {
    if (attempt < this.config.maxRetries) {
      const delay = this.config.retryDelayMs * Math.pow(2, attempt - 1);
      // delay: 3000ms, 6000ms, 12000ms
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}
```

**CardMarket** - Simple polling with timeout:
```typescript
async waitForCompletion(runId: string, maxWaitMs: number = 300000) {
  const pollInterval = 5000; // Fixed 5s polling

  while (Date.now() - startTime < maxWaitMs) {
    const status = await checkStatus(runId);
    if (status === 'SUCCEEDED') return;
    if (status === 'FAILED') throw new Error('...');
    await sleep(pollInterval);
  }
  throw new Error('Timeout');
}
```

**Insight**: Async job-based collection (CardMarket) uses polling; synchronous API (TCGPlayer) uses retry loops.

---

## 3. Data Model Comparison

### Seller/Listing Representation

```typescript
// TCGPlayer - Rich seller metadata
interface TCGPlayerListingResult {
  listingId: number;           // Unique identifier
  sellerId: string;
  sellerName: string;
  sellerRating: number;        // Percentage (0-100)
  sellerSales: number;         // Total sales count
  goldSeller: boolean;         // TCGPlayer program
  verifiedSeller: boolean;     // Verification status
  directSeller: boolean;       // TCGPlayer Direct
  condition: string;           // "Near Mint", "Lightly Played"
  conditionId: number;         // Numeric ID
  printing: string;            // "Normal", "Foil"
  language: string;
  languageAbbreviation: string;
  price: number;               // USD
  shippingPrice: number;       // USD
  quantity: number;
  productConditionId: number;
}

// CardMarket - Regional seller focus
interface CardmarketSeller {
  sellerId: string;
  sellerName: string;
  sellerType: 'private' | 'professional' | 'powerseller';
  salesCount: number;
  country: string;             // EU seller location
  price: number;               // EUR
  condition: string;
  language: string;
  quantity: number;
  comments?: string;           // Optional seller notes
}
```

**Key Differences**:
| Attribute | TCGPlayer | CardMarket |
|-----------|-----------|------------|
| **Currency** | USD | EUR |
| **Seller Tiers** | Gold/Verified/Direct | Private/Pro/Powerseller |
| **Geography** | US-centric | Country per seller |
| **Condition Format** | Full text + ID | Text only |
| **Shipping** | Explicit field | Included in price |

### Price Data Structure

```typescript
// TCGPlayer - Market-focused aggregate pricing
interface TCGPlayerProductResult {
  marketPrice: number | null;         // Current market price
  medianPrice: number | null;         // Statistical median
  lowestPrice: number | null;         // Cheapest listing
  lowestPriceWithShipping: number | null; // Total cost
  totalListings: number;
}

// CardMarket - Trend-focused with time windows
interface CardmarketPrice {
  priceEur: number;           // Current average
  trendEur: number;           // Moving average trend
  avg1dEur: number;           // 1-day average
  avg7dEur: number;           // 7-day average
  avg30dEur: number;          // 30-day average
  lowEur: number;             // Lowest available

  // Pre-converted for convenience
  priceGbp: number;
  priceUsd: number;
}
```

**Insight**: CardMarket provides historical trend data in the response; TCGPlayer requires separate historical queries.

---

## 4. Cross-Platform Integration

### Currency Conversion

```typescript
// CardMarket handles conversion at collection time
const EUR_TO_USD = 1.08;  // Fetched from exchange rate API
const EUR_TO_GBP = 0.86;

class CurrencyConverter {
  static eurToUsd(eur: number): number {
    return eur * this.rates.EUR_TO_USD;
  }

  static async fetchLatestRates(): Promise<void> {
    // Call exchange rate API
  }
}
```

**Best Practice**: Convert at collection time and store both original and converted values for audit trail.

### Card Matching for Arbitrage

```typescript
// CardMarket implements fuzzy matching
matchToTcgplayer(
  cardmarketPrices: CardmarketPrice[],
  tcgplayerCards: Map<string, CardInfo>
): Map<string, CrossPlatformPrice> {

  for (const cmCard of cardmarketPrices) {
    const normalizedName = this.normalizeName(cmCard.name);

    for (const [cardId, tcgCard] of tcgplayerCards) {
      if (normalizedName === this.normalizeName(tcgCard.name)) {
        // Calculate arbitrage opportunity
        const priceDiff = tcgCard.marketPrice - cmCard.priceUsd;
        const priceDiffPercent = (priceDiff / cmCard.priceUsd) * 100;

        // Account for fees and shipping
        const minSpread = 15; // 15% minimum for profit
        if (Math.abs(priceDiffPercent) > minSpread) {
          // Arbitrage opportunity exists
        }
      }
    }
  }
}

private normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')  // Remove special chars
    .replace(/\s+/g, '');        // Remove spaces
}
```

**Challenge**: Card names differ between platforms:
- TCGPlayer: `"Roronoa Zoro (OP01-025) [Parallel]"`
- CardMarket: `"Roronoa Zoro V.2 (OP01-025)"`

**Solution**: Normalize to `roronoazooop01025` for matching.

---

## 5. Error Handling Patterns

### TCGPlayer - Metrics-Driven

```typescript
class TCGPlayerSearchAPIScraper {
  private errors: string[] = [];
  private metrics: ScrapeMetrics = {
    runId: `search-${Date.now()}`,
    startTime: new Date(),
    apiCalls: 0,
    errors: 0,
    retries: 0,
    // ...
  };

  // Errors are tracked but don't stop execution
  private async executeSearch(...) {
    try {
      // ...
    } catch (error) {
      this.metrics.errors++;
      this.errors.push(`Error: ${error.message}`);
      return null;  // Continue with other requests
    }
  }

  // Caller can check errors after completion
  getErrors(): string[] { return [...this.errors]; }
  getMetrics(): ScrapeMetrics { return { ...this.metrics }; }
}
```

### CardMarket - Exception-Based

```typescript
class CardmarketCollector {
  // Errors throw immediately
  async scrapeCards(urls: string[]): Promise<CardmarketPrice[]> {
    const run = await this.startActor(urls);
    await this.waitForCompletion(run.id);  // Throws on timeout/failure
    return this.getResults(run.datasetId);
  }

  private async waitForCompletion(runId: string): Promise<void> {
    // ...
    if (run.status === 'FAILED') {
      throw new Error(`Apify run failed: ${run.status}`);
    }
  }
}
```

**Insight**:
- **Batch operations** (TCGPlayer): Track errors, continue processing, report at end
- **Atomic operations** (CardMarket): Fail fast, let caller handle retry at job level

---

## 6. Performance Characteristics

### Request Efficiency

| Metric | TCGPlayer | CardMarket |
|--------|-----------|------------|
| **Products per request** | 50 | 1 (URL-based) |
| **Listings per product** | Up to 50 | All available |
| **Rate limit** | 1.5s delay | N/A (Apify) |
| **Parallelism** | Sequential | Apify parallel |

### Cost Analysis

| Platform | Method | Cost per 1000 cards |
|----------|--------|---------------------|
| TCGPlayer (Search API) | Direct | **$0** (free) |
| TCGPlayer (Bright Data) | Proxy | ~$0.50-1.00 |
| CardMarket (Apify) | Managed | ~$20 |

**Insight**: Discovering TCGPlayer's public API eliminated $20+/month in Bright Data costs.

---

## 7. Key Lessons Learned

### 1. Always Investigate Public APIs First

```
❌ Initial Approach:
   TCGPlayer → Bright Data → HTML → Cheerio → Data

✅ Better Approach:
   TCGPlayer → Search API → JSON → Data
```

**How to find hidden APIs**:
1. Open browser DevTools → Network tab
2. Filter by XHR/Fetch requests
3. Look for JSON responses on page load
4. Check CSP headers for API domains

### 2. SPA Sites Are Harder to Scrape

```typescript
// What we expected (server-rendered):
<div class="listing-item">
  <span class="seller-name">CardShop</span>
  <span class="price">$4.99</span>
</div>

// What we got (SPA shell):
<div id="app"></div>
<script src="/js/main.js"></script>
```

**Solutions**:
- Use headless browsers with JS execution (expensive)
- Find the underlying API (free, reliable)
- Use managed services like Apify (cost, but handles complexity)

### 3. Third-Party Services Have Trade-offs

| Aspect | Build It | Buy It (Apify) |
|--------|----------|----------------|
| **Upfront effort** | High | Low |
| **Ongoing cost** | Infra only | Per-request |
| **Maintenance** | You fix it | They fix it |
| **Control** | Full | Limited |
| **Anti-bot handling** | You implement | Built-in |

### 4. Data Model Design Matters

```typescript
// Good: Store original + converted values
{
  priceEur: 10.00,    // Original
  priceUsd: 10.80,    // Converted at collection time
  fxRateUsed: 1.08    // Audit trail
}

// Bad: Only store converted
{
  priceUsd: 10.80     // What was the original? What rate?
}
```

### 5. Metrics Are Essential for Debugging

```typescript
interface ScrapeMetrics {
  runId: string;        // Identify this run
  startTime: Date;      // When it started
  apiCalls: number;     // How many requests
  errors: number;       // What failed
  retries: number;      // Signs of instability
  durationMs: number;   // Performance baseline
}
```

---

## 8. Recommended Architecture for Future Scrapers

```
┌────────────────────────────────────────────────────────────────────┐
│                    Unified Scraper Architecture                    │
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│   ┌───────────────┐                                               │
│   │ ScraperConfig │  - Rate limits, retries, timeouts             │
│   │   (shared)    │  - Feature flags                               │
│   └───────────────┘  - Credentials/tokens                          │
│          │                                                         │
│          ▼                                                         │
│   ┌───────────────┐     ┌──────────────────┐                      │
│   │ BaseScraper   │────▶│ IDataSource      │                      │
│   │   (abstract)  │     │   interface      │                      │
│   └───────────────┘     └──────────────────┘                      │
│          │                       │                                 │
│   ┌──────┴────────┬──────────────┴───────────┐                    │
│   ▼               ▼                          ▼                     │
│ TCGPlayer    CardMarket    Future:         Future:                │
│ SearchAPI    ApifyAdapter  CardTrader      JapaneseMarket         │
│                                                                    │
│   ┌───────────────┐                                               │
│   │ MetricsStore  │  - Track all operations                       │
│   │   (shared)    │  - Unified reporting                          │
│   └───────────────┘  - Error aggregation                          │
│                                                                    │
│   ┌───────────────┐                                               │
│   │ DataNormalizer│  - Currency conversion                        │
│   │   (shared)    │  - Condition mapping                          │
│   └───────────────┘  - Card name normalization                    │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

### Proposed Interface

```typescript
interface IMarketplaceScraper {
  // Core operations
  scrapeSet(setCode: string): Promise<ProductResult[]>;
  scrapeProduct(productId: string): Promise<ProductResult | null>;

  // Metadata
  getAvailableSets(): SetInfo[];
  getSupportedGames(): GameCode[];

  // Observability
  getMetrics(): ScrapeMetrics;
  getErrors(): string[];

  // Lifecycle
  initialize(): Promise<void>;
  close(): Promise<void>;
}
```

---

## 9. Quick Reference

### When to Use Each Approach

| Scenario | Recommendation |
|----------|---------------|
| Site has public API | Use API directly |
| Site is SPA, no public API | Find XHR endpoints in DevTools |
| Heavy anti-bot protection | Use managed service (Apify, ScrapingBee) |
| Simple static HTML | Direct fetch + cheerio |
| Need JS execution | Puppeteer/Playwright |
| Cost-sensitive + volume | Invest time finding API |
| Time-sensitive + low volume | Use managed service |

### Code Patterns to Reuse

```typescript
// 1. Rate limiter (copy-paste ready)
private lastRequestTime = 0;
private async rateLimit(minDelayMs: number): Promise<void> {
  const elapsed = Date.now() - this.lastRequestTime;
  if (elapsed < minDelayMs) {
    await new Promise(r => setTimeout(r, minDelayMs - elapsed));
  }
  this.lastRequestTime = Date.now();
}

// 2. Exponential backoff (copy-paste ready)
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i === maxRetries - 1) throw e;
      await new Promise(r => setTimeout(r, baseDelay * Math.pow(2, i)));
    }
  }
  throw new Error('Unreachable');
}

// 3. Metrics tracking (copy-paste ready)
interface ScrapeMetrics {
  runId: string;
  startTime: Date;
  endTime?: Date;
  itemsProcessed: number;
  apiCalls: number;
  errors: number;
  retries: number;
}
```

---

## Appendix: Code ↔ Documentation Symbiosis

### Code Files Analyzed

| File | Purpose | Key Patterns |
|------|---------|--------------|
| [`src/scrapers/tcgplayer-search-api-scraper.ts`](../src/scrapers/tcgplayer-search-api-scraper.ts) | TCGPlayer public API integration | Rate limiting, retry logic, metrics |
| [`src/scrapers/tcgplayer-brightdata-scraper.ts`](../src/scrapers/tcgplayer-brightdata-scraper.ts) | TCGPlayer HTML scraping (deprecated) | Why HTML fails for SPAs |
| [`src/collectors/cardmarket-collector.ts`](../src/collectors/cardmarket-collector.ts) | CardMarket Apify integration | Third-party service patterns |
| [`src/pipeline/hybrid-tcgplayer-pipeline.ts`](../src/pipeline/hybrid-tcgplayer-pipeline.ts) | Pipeline orchestration | Fallback strategy, circuit breaker |
| [`src/apis/justtcg-client.ts`](../src/apis/justtcg-client.ts) | JustTCG API client | Primary data source |

### Script Files

| Script | Purpose | Documentation |
|--------|---------|---------------|
| [`scripts/daily-archive-local.ts`](../scripts/daily-archive-local.ts) | Daily price archive | [AWS_INFRASTRUCTURE.md](./AWS_INFRASTRUCTURE.md) |
| [`scripts/test-search-api-scraper.ts`](../scripts/test-search-api-scraper.ts) | Search API testing | This document |
| [`scripts/test-tcgplayer-api-v2.ts`](../scripts/test-tcgplayer-api-v2.ts) | API discovery | [TCGPLAYER_STACK_ANALYSIS.md](./TCGPLAYER_STACK_ANALYSIS.md) |

### CardMarket Project Files (Cross-Reference)

| File | Purpose |
|------|---------|
| [`cardmarket/src/scrapers/`](../../cardmarket/src/scrapers/) | CardMarket scraper implementations |
| [`cardmarket/scripts/daily-cardmarket-archive.ts`](../../cardmarket/scripts/daily-cardmarket-archive.ts) | CardMarket daily archive |

### Symbiotic Reference Pattern

Each code file contains a `DOCUMENTATION REFERENCES` block:

```typescript
/**
 * ═══════════════════════════════════════════════════════════════════════════
 * DOCUMENTATION REFERENCES (Symbiotic Code ↔ Docs)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * @see {@link file://../docs/SCRAPER_ARCHITECTURE_INSIGHTS.md} - This document
 *   - Section X: Relevant section
 *
 * Related Code Files:
 * @see {@link file://./related-file.ts} - Description
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */
```

---

## Navigation

**Up:**
- [TCGPlayer Index](./README.md)
- [Master Index](../../cardmarket/docs/INDEX.md)
- [Scraper Hub](../../README.md)

**Related Documentation:**
- [CardMarket Scraper Infrastructure](../../cardmarket/docs/CARDMARKET_SCRAPER_INFRASTRUCTURE.md)
- [Bright Data Integration](../../cardmarket/docs/BRIGHTDATA_INTEGRATION_INSIGHTS.md)
- [Hybrid Pipeline Architecture](./HYBRID_PIPELINE_ARCHITECTURE.md)
- [TCGPlayer Stack Analysis](./TCGPLAYER_STACK_ANALYSIS.md)

---

*Document generated: 2026-01-10*
*Last updated: Based on implementation analysis*
