# CardMarket Scraper Infrastructure

> *Complete reference for the CardMarket data collection pipeline. This document maps all components and their integration points.*

**Last Updated:** 2026-01-09
**Status:** Operational (requires proxy for Cloudflare bypass)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        CARDMARKET DATA PIPELINE                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐  │
│  │   Target    │───▶│    URL      │───▶│   Scraper   │───▶│   Parser    │  │
│  │  Registry   │    │   Builder   │    │  (HTTP/PW)  │    │  (Cheerio)  │  │
│  └─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘  │
│        │                                      │                   │         │
│        │                              ┌───────┴───────┐           │         │
│        │                              ▼               ▼           │         │
│        │                     ┌─────────────┐  ┌─────────────┐     │         │
│        │                     │  Playwright │  │    HTTP     │     │         │
│        │                     │   Client    │  │   Client    │     │         │
│        │                     └─────────────┘  └─────────────┘     │         │
│        │                              │               │           │         │
│        │                              └───────┬───────┘           │         │
│        │                                      ▼                   │         │
│        │                             ┌─────────────┐              │         │
│        │                             │  Resilience │              │         │
│        │                             │   Layer     │              │         │
│        │                             └─────────────┘              │         │
│        ▼                                      │                   ▼         │
│  ┌─────────────┐                              │           ┌─────────────┐   │
│  │   Neural    │◀─────────────────────────────┴──────────▶│ Transformer │   │
│  │  Receptor   │                                          │  (EUR→USD)  │   │
│  └─────────────┘                                          └─────────────┘   │
│        │                                                          │         │
│        ▼                                                          ▼         │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                         DATABASE (RDS/S3)                            │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Component Registry

### Core Scraper Components

| Component | Path | Purpose |
|-----------|------|---------|
| **CardmarketScraper** | `src/scrapers/cardmarket-scraper.ts` | Main orchestration class |
| **HttpClient** | `src/scrapers/http-client.ts` | HTTP requests with retry logic |
| **HybridScraper** | `src/scrapers/hybrid-scraper.ts` | HTTP + Playwright fallback |
| **PlaywrightClient** | `src/browser/playwright-client.ts` | Headless browser automation |

### Parsing & Extraction

| Component | Path | Purpose |
|-----------|------|---------|
| **CardmarketHtmlParser** | `src/parsers/html-parser.ts` | Multi-strategy HTML parsing |
| **SelectorStrategies** | `src/config/selectors.ts` | CSS selectors with fallbacks |

### Resilience Layer

| Component | Path | Purpose |
|-----------|------|---------|
| **CircuitBreaker** | `src/resilience/circuit-breaker.ts` | Failure protection (5 fails = open) |
| **SessionManager** | `src/resilience/session-manager.ts` | Cookie/session handling |
| **SelectorMonitor** | `src/resilience/selector-monitor.ts` | Detect selector breakage |
| **FingerprintGenerator** | `src/resilience/fingerprint.ts` | Browser fingerprint rotation |
| **CaptchaHandler** | `src/resilience/captcha.ts` | Cloudflare challenge detection |

### Neural Integration

| Component | Path | Purpose |
|-----------|------|---------|
| **CardMarketReceptorNeuron** | `src/neural/sensory/cardmarket-receptor.ts` | Validate & transform scraped data |
| **CardMarketTargetRegistry** | `src/neural/sensory/cardmarket/target-cards.ts` | 32 priority target cards |
| **CardMarketUrlBuilder** | `src/neural/sensory/cardmarket/url-builder.ts` | URL construction |
| **CardMarketDataParser** | `src/neural/sensory/cardmarket/data-parser.ts` | Four Elements data extraction |
| **ScrapeOrchestrator** | `src/neural/sensory/cardmarket/scrape-orchestrator.ts` | Scheduling & job queue |

### Pipeline & Storage

| Component | Path | Purpose |
|-----------|------|---------|
| **Orchestrator** | `src/pipeline/orchestrator.ts` | Pipeline coordination |
| **Transformer** | `src/pipeline/transformer.ts` | Data normalization |
| **DatabaseLoader** | `src/pipeline/database-loader.ts` | RDS writing |
| **TrainingExporter** | `src/pipeline/training-exporter.ts` | S3 export for ML |
| **S3Storage** | `src/storage/s3-storage.ts` | S3 operations |

---

## Key Interfaces

### ScrapedCard (Output)

```typescript
interface ScrapedCard {
  cardId: string;           // "OP01-120" or "OP01-120-parallel"
  name: string;             // "Shanks"
  setCode: string;          // "OP01"
  cardNumber: string;       // "120"
  variantType: string;      // "standard" | "parallel" | "manga" | etc.
  rarity: string | null;    // "SEC" | "SR" | "R" | etc.
  imageUrl: string | null;  // Full image URL
  trendPrice: number | null;    // 30-day weighted avg (EUR)
  lowPrice: number | null;      // Lowest available (EUR)
  avg7Price: number | null;     // 7-day avg (EUR)
  avg30Price: number | null;    // 30-day avg (EUR)
  availableCount: number | null;
  priceChange7d: number | null; // % change
  priceChange30d: number | null;
  sourceUrl: string;
  scrapedAt: string;        // ISO timestamp
}
```

### CardMarketScrapeResult (Receptor Input)

```typescript
interface CardMarketScrapeResult {
  cardId: string;
  name: string;
  variantType: string;
  priceFrom: number | null;     // EUR
  priceTrend: number | null;    // EUR
  priceAvg: number | null;      // EUR
  availableItems: number;
  language: string;
  url: string;
  scraped_at: Date;
  isValid: boolean;
  validationErrors: string[];
}
```

---

## CSS Selectors Reference

### Expansion Page Selectors

```typescript
// Product listing
'.table-body .row'              // Primary: product rows
'.col-product a'                // Product name link
'.col-price .font-weight-bold'  // Trend price

// Pagination
'.pagination-container'
'.pagination'
```

### Card Detail Selectors

```typescript
// Card info
'h1.page-title'                 // Card name
'.info-list-container'          // Price guide container

// Prices (with regex fallback)
Trend: /Trend[^€]*€\s*(\d+[.,]\d{2})/i
Low:   /(?:From|Ab)[^€]*€\s*(\d+[.,]\d{2})/i
Avg30: /30[^€]*€\s*(\d+[.,]\d{2})/i
```

### Article (Seller Listing) Selectors

```typescript
'.article-row'                  // Listing row
'.seller-name a'                // Seller name
'.col-condition abbr'           // Condition (MT/NM/EX/GD/LP/PL/PO)
'.col-price .price-container'   // Price
```

---

## Rate Limiting & Anti-Detection

### Default Configuration

```typescript
const DEFAULT_SCRAPER_CONFIG = {
  requestsPerMinute: 30,        // Max 30 req/min
  requestDelayMs: 2000,         // 2s base delay
  delayVariance: 0.3,           // ±30% randomization
  maxRetries: 3,
  backoffMultiplier: 2,
  timeout: 30000,               // 30s per request
};
```

### Stealth Mode (Playwright)

The PlaywrightClient includes anti-detection scripts:
- Override `navigator.webdriver` → false
- Fake chrome runtime object
- Override plugins, languages, hardware concurrency
- Randomized fingerprints (viewport, user-agent, timezone)

### Circuit Breaker Settings

```typescript
const CIRCUIT_BREAKER_CONFIG = {
  failureThreshold: 5,     // Open after 5 failures
  successThreshold: 3,     // Close after 3 successes
  timeout: 30000,          // 30s before half-open
  monitoringWindow: 60000, // 1-minute failure window
};
```

---

## Usage Examples

### Basic Scraping

```typescript
import { CardmarketScraper, createScraper } from './scrapers/cardmarket-scraper';

// Create scraper
const scraper = createScraper({
  requestsPerMinute: 20,
  requestDelayMs: 3000,
});

// Scrape a single set
const result = await scraper.scrapeSet('OP01', {
  includeArticles: true,
  maxCardsPerSet: 50,
  onProgress: (p) => console.log(`${p.cardsScraped} cards scraped`),
});

console.log(`Scraped ${result.cards.length} cards`);
```

### With Proxy (Required for Cloudflare)

```typescript
import { createScraper } from './scrapers/cardmarket-scraper';

const scraper = createScraper(
  { requestsPerMinute: 20 },
  {
    host: 'proxy.example.com',
    port: 8080,
    username: 'user',
    password: 'pass',
    type: 'residential',  // Residential recommended
    country: 'DE',        // Germany for CardMarket
  }
);
```

### Using Playwright for JS-Heavy Pages

```typescript
import { PlaywrightClient } from './browser/playwright-client';

const browser = new PlaywrightClient({
  browserType: 'chromium',
  headless: true,
  stealth: true,
  proxy: { host: 'proxy.example.com', port: 8080 },
});

await browser.launch();

const result = await browser.navigate(
  'https://www.cardmarket.com/en/One-Piece/Products/Singles/Romance-Dawn/Shanks-OP01-120-V2',
  { waitForSelector: '.info-list-container' }
);

const html = result.html;
await browser.close();
```

### Full Pipeline with Neural Integration

```typescript
import { cardMarketTargetRegistry } from './neural/sensory/cardmarket/target-cards';
import { cardMarketUrlBuilder } from './neural/sensory/cardmarket/url-builder';
import { CardMarketReceptorNeuron } from './neural/sensory/cardmarket-receptor';
import { createScraper } from './scrapers/cardmarket-scraper';

// Get legendary targets
const targets = cardMarketTargetRegistry.getByTier('legendary');

// Initialize receptor
const receptor = new CardMarketReceptorNeuron();
await receptor.initialize();

// Create scraper
const scraper = createScraper();

// Scrape each target
for (const target of targets) {
  const url = cardMarketUrlBuilder.buildCardDetailUrl(target);
  const result = await scraper.scrapeCard(url);

  if (result.card) {
    // Process through receptor neuron
    const signal = await receptor.processSignal({
      payload: {
        cardId: result.card.cardId,
        name: result.card.name,
        variantType: result.card.variantType,
        priceFrom: result.card.lowPrice,
        priceTrend: result.card.trendPrice,
        priceAvg: result.card.avg7Price,
        availableItems: result.card.availableCount || 0,
        language: 'EN',
        url,
        scraped_at: new Date(),
        isValid: true,
        validationErrors: [],
      }
    });

    console.log(`Processed: ${signal.cardId} @ €${signal.priceTrend}`);
  }
}
```

---

## Set URL Mappings

| Set Code | CardMarket URL Slug |
|----------|---------------------|
| OP01 | Romance-Dawn |
| OP02 | Paramount-War |
| OP03 | Pillars-of-Strength |
| OP04 | Kingdoms-of-Intrigue |
| OP05 | Awakening-of-the-New-Era |
| OP06 | Wings-of-the-Captain |
| OP07 | 500-Years-in-the-Future |
| OP08 | Two-Legends |
| OP09 | The-Four-Emperors |
| OP10 | Royal-Blood |
| EB01 | Extra-Booster-Memorial-Collection |
| EB02 | Extra-Booster |

---

## Variant Detection Patterns

| Variant | URL Suffix | Description |
|---------|------------|-------------|
| `parallel` | `-V2` | Parallel/Alt art |
| `manga` | `-Manga` | Manga art |
| `boxtopper` | `-Box-Topper` | Box topper promo |
| `alt_art` | `-Alternate-Art` | Alternative art |
| `sp` | `-SP-{SET}-{NUM}` | Special reprint |

---

## Condition Multipliers

| CardMarket Code | Standard | Multiplier |
|-----------------|----------|------------|
| MT (Mint) | NM+ | 1.10 |
| NM (Near Mint) | NM | 1.00 |
| EX (Excellent) | LP | 0.85 |
| GD (Good) | MP | 0.70 |
| LP (Light Played) | HP | 0.55 |
| PL (Played) | DMG | 0.40 |
| PO (Poor) | DMG | 0.20 |

---

## Error Handling

### Cloudflare Detection

```typescript
// In html-parser.ts
isBlocked(html: string): boolean {
  const blockedIndicators = [
    'Checking your browser',
    'Just a moment',
    'cf-browser-verification',
    'challenge-platform',
    'Access denied',
  ];
  return blockedIndicators.some(i => html.includes(i));
}
```

### Circuit Breaker States

```
CLOSED (normal) ──[5 failures]──▶ OPEN (blocking)
       ▲                              │
       │                         [30s timeout]
       │                              ▼
       └────[3 successes]──── HALF_OPEN (testing)
```

---

## Daily Collection Schedule

| Time (UTC) | Ritual | Targets |
|------------|--------|---------|
| 06:00 | Morning | Legendary only (13 cards) |
| 12:00 | Midday | Legendary + Epic (28 cards) |
| 18:00 | Evening | All tiers (32 cards) |
| 00:00 | Nightly | Full refresh + gap analysis |

---

## Critical Gaps (Priority Data Collection)

| Category | Current | Target | Priority |
|----------|---------|--------|----------|
| Manga variants | 0 | 500+ | CRITICAL |
| Box toppers | 30 | 200+ | HIGH |
| Leader alt arts | 50 | 300+ | HIGH |
| SP reprints | 100 | 400+ | MEDIUM |

---

## Quick Reference Commands

```bash
# Test connection
npx tsx scripts/test-cardmarket-collection.ts

# Run scrape for a single set
npx tsx -e "
import { createScraper } from './src/scrapers/cardmarket-scraper';
const s = createScraper();
s.scrapeSet('OP01', { maxCardsPerSet: 5 }).then(console.log);
"

# Check selector health
npx tsx -e "
import { SelectorMonitor } from './src/resilience/selector-monitor';
const m = new SelectorMonitor();
m.checkHealth().then(console.log);
"
```

---

## Integration Points

### To Neural Network
- `CardMarketReceptorNeuron` receives `CardMarketScrapeResult`
- Validates price bounds (€0.50 - €10,000)
- Emits neurotransmitters: DOPAMINE (scarcity), NOREPINEPHRINE (high value), GLUTAMATE (standard)

### To Database
- `DatabaseLoader` writes to RDS
- Tables: `card_prices_v2`, `price_history`, `scraped_articles`

### To ML Training
- `TrainingExporter` exports NDJSON to S3
- Partition: `s3://bucket/training/cardmarket/{date}/{card_id}.json`

---

---

## Orchestrator-Scraper Integration

The `CardMarketScrapeOrchestrator` is now integrated with the actual `CardmarketScraper`:

```typescript
import { createCardMarketOrchestrator } from './neural/sensory/cardmarket';

// Create orchestrator (scraper auto-initialized)
const orchestrator = createCardMarketOrchestrator({
  maxRequestsPerMinute: 20,
  delayBetweenRequests: 3000,
  proxyConfig: {
    host: 'proxy.example.com',
    port: 8080,
    type: 'residential',
    country: 'DE',
  },
});

// Initialize and test connection
await orchestrator.initialize();

// Run morning ritual (legendary tier only)
const session = await orchestrator.runMorningRitual();

// Get scraper stats
const stats = orchestrator.getScrapeStats();
console.log(`Requests: ${stats.requests.totalRequests}`);
console.log(`Parser success: ${stats.parser.successRate}%`);
```

### Integration Flow

```
Orchestrator.queueTargets()
       ↓
Orchestrator.processQueue()
       ↓
Orchestrator.processJob()
       ↓
Orchestrator.fetchCardData() ─── uses ──→ CardmarketScraper.scrapeCard()
       ↓                                          ↓
CardMarketPriceData                      ScrapedCard (normalized)
       ↓
Neural Receptor / Database
```

### Orchestrator Methods

| Method | Description |
|--------|-------------|
| `initialize()` | Test connection and prepare scraper |
| `testConnection()` | Verify CardMarket is reachable |
| `runMorningRitual()` | Scrape legendary tier (13 cards) |
| `runMiddayRitual()` | Scrape legendary + epic (28 cards) |
| `runEveningRitual()` | Scrape all tiers (32 cards) |
| `runGapFillRitual()` | Scrape critical gaps |
| `getScrapeStats()` | Get HTTP/parser statistics |
| `resetScraper()` | Clear cookies, sessions, stats |

---

*"The CardMarket Alchemist sees not just prices, but the flow of value across the European marketplace."*

---

**[>>> Documentation Index <<<](./INDEX.md)** | *Navigate all TCG pipeline documentation*
