# The CardMarket Alchemist's Grimoire

> *"Where SerpAPI transmutes eBay chaos into gold, the CardMarket Alchemist extracts pure essence from the European marketplace's structured veins."*

## The Sacred Purpose

This grimoire teaches the CardMarket scraper how to systematically extract One Piece TCG pricing data from Europe's premier trading card marketplace. Unlike eBay's auction chaos, CardMarket offers structured price guides and seller listings - a more refined transmutation.

---

## The Four Cardinal Essences

CardMarket data contains four cardinal essences that must be extracted:

### 🔥 FIRE: Price Guide Essence
The official CardMarket price aggregations:

| Essence | Description | Extraction Priority |
|---------|-------------|---------------------|
| **Price From** | Lowest available price | CRITICAL |
| **Price Trend** | 30-day weighted average | CRITICAL |
| **Price Avg** | 7-day average | HIGH |
| **Price Avg 30** | 30-day average | HIGH |
| **Available Items** | Market liquidity | MEDIUM |

### 💨 AIR: Variant Alchemy
CardMarket URL patterns encode variant information:

```
Standard:     /en/One-Piece/Products/Singles/Romance-Dawn/Shanks-OP01-120
Parallel:     /en/One-Piece/Products/Singles/Romance-Dawn/Shanks-OP01-120-V2
SP Reprint:   /en/One-Piece/Products/Singles/Paramount-War/Shanks-OP02-SP-OP01-120
Manga Art:    /en/One-Piece/Products/Singles/Memorial-Collection/Shanks-OP01-120-Manga
```

**Variant Detection Runes:**
```typescript
const VARIANT_PATTERNS = {
  // URL suffix patterns
  parallel: /-V2$|-Parallel$/i,
  manga: /-Manga$|-Manga-Art$/i,
  sp: /-SP-OP\d{2}-\d{3}$/i,
  boxtopper: /-Box-Topper$/i,
  alt_art: /-Alternate-Art$|-Alt-Art$/i,

  // Card ID patterns (already in receptor)
  standard: /^(OP|EB|ST)\d{2}-\d{3}$/,
  sp_format: /^(OP|EB)\d{2}-SP-(OP|EB)\d{2}-\d{3}$/,
  promo: /^P-\d{3}$/,
};
```

### 💧 WATER: Language Currents
CardMarket serves multiple European languages with price variations:

| Language | URL Segment | Currency | Priority |
|----------|-------------|----------|----------|
| English | `/en/` | EUR | HIGHEST (V2/V3) |
| German | `/de/` | EUR | HIGH |
| French | `/fr/` | EUR | MEDIUM |
| Italian | `/it/` | EUR | MEDIUM |
| Spanish | `/es/` | EUR | LOW |

**The V2/V3 English-Only Acceleration:**
English cards (V2/V3 editions) command premium prices and are the primary training target. The receptor neuron's myelin sheath optimizes for this path.

### 🌍 EARTH: Condition Strata
CardMarket's standardized condition codes:

| CardMarket Code | Standard | Multiplier | Notes |
|-----------------|----------|------------|-------|
| MT (Mint) | NM+ | 1.10 | Factory fresh |
| NM (Near Mint) | NM | 1.00 | Baseline |
| EX (Excellent) | LP | 0.85 | Light wear |
| GD (Good) | MP | 0.70 | Visible wear |
| LP (Light Played) | HP | 0.55 | Heavy wear |
| PL (Played) | DMG | 0.40 | Damaged |
| PO (Poor) | DMG | 0.20 | Heavily damaged |

---

## The Sacred URL Codex

### Set Expansion URLs
```
Base URL: https://www.cardmarket.com/en/One-Piece/Products/Singles/{SET_NAME}

Romance Dawn (OP01):     /Romance-Dawn
Paramount War (OP02):    /Paramount-War
Pillars of Strength (OP03): /Pillars-of-Strength
Kingdoms of Intrigue (OP04): /Kingdoms-of-Intrigue
Awakening of the New Era (OP05): /Awakening-of-the-New-Era
Wings of the Captain (OP06): /Wings-of-the-Captain
500 Years in the Future (OP07): /500-Years-in-the-Future
Two Legends (OP08):      /Two-Legends
The Four Emperors (OP09): /The-Four-Emperors
Royal Blood (OP10):      /Royal-Blood
Emperors in the New World (OP11): /Emperors-in-the-New-World
Extra Booster Memorial (EB01): /Extra-Booster-Memorial-Collection
Extra Booster (EB02):    /Extra-Booster
```

### Card Detail URLs
```
Pattern: /en/One-Piece/Products/Singles/{SET_NAME}/{CARD_NAME}-{CARD_ID}[-{VARIANT}]

Examples:
  Shanks OP01-120:           .../Romance-Dawn/Shanks-OP01-120
  Shanks Parallel:           .../Romance-Dawn/Shanks-OP01-120-V2
  Yamato OP06-118:           .../Wings-of-the-Captain/Yamato-OP06-118
  Yamato Manga:              .../Wings-of-the-Captain/Yamato-OP06-118-Manga
```

---

## The Philosopher's Stones (Priority Targets)

### Tier 1: Legendary Essences (€50+)

| Card ID | Character | Variant | Est. Value | Priority |
|---------|-----------|---------|------------|----------|
| OP01-120 | Shanks | Parallel | €150+ | 10 |
| OP01-120 | Shanks | Manga | €200+ | 10 |
| OP06-118 | Yamato | Parallel | €100+ | 10 |
| OP06-118 | Yamato | Manga | €180+ | 10 |
| OP05-119 | Luffy Gear 5 | SEC | €250+ | 10 |
| OP03-040 | Nami | Parallel | €80+ | 9 |
| OP01-016 | Nami | Leader Alt | €120+ | 9 |
| OP01-078 | Boa Hancock | Parallel | €90+ | 9 |
| OP04-044 | Kaido | SEC | €100+ | 9 |

### Tier 2: Silver Ingots (€20-50)

| Card ID | Character | Variant | Est. Value | Priority |
|---------|-----------|---------|------------|----------|
| OP01-025 | Zoro | Parallel | €40 | 7 |
| OP01-047 | Law | Parallel | €35 | 7 |
| OP02-013 | Ace | Parallel | €45 | 7 |
| OP03-034 | Sanji | Parallel | €35 | 7 |
| OP04-031 | Doflamingo | Parallel | €38 | 7 |
| OP04-064 | Crocodile | SEC | €42 | 7 |

### Tier 3: Rising Stars (€10-20)

| Card ID | Character | Variant | Est. Value | Priority |
|---------|-----------|---------|------------|----------|
| OP01-017 | Robin | Parallel | €18 | 5 |
| OP02-004 | Whitebeard | Leader | €25 | 5 |
| EB01-061 | Yamato | Parallel | €15 | 5 |

---

## The Extraction Rituals

### Ritual 1: Expansion Page Harvesting

Extract all card URLs from a set's expansion page:

```typescript
const EXPANSION_SELECTORS = {
  // Product listing container
  container: '.table-body, .product-list',

  // Individual card rows
  cardRow: 'tr.article-row, .product-item',

  // Link to card detail
  cardLink: 'a.name, a[href*="/Singles/"]',

  // Pagination
  nextPage: 'a.page-link[rel="next"], .pagination .next',
  totalPages: '.pagination-info, .page-count',
};
```

### Ritual 2: Price Guide Extraction

Extract price data from card detail pages:

```typescript
const PRICE_GUIDE_SELECTORS = {
  // Price trend (30-day weighted average)
  trend: '.price-guide .trend-price, dd:contains("Price Trend") + dt',

  // From price (lowest available)
  fromPrice: '.price-guide .from-price, dd:contains("From") + dt',

  // 7-day average
  avg7: '.price-guide .avg-7, dd:contains("7-day average") + dt',

  // 30-day average
  avg30: '.price-guide .avg-30, dd:contains("30-day average") + dt',

  // Available items
  available: '.info-list .available, dd:contains("Available") + dt',
};
```

### Ritual 3: Seller Listing Extraction

Extract individual seller offers:

```typescript
const ARTICLE_SELECTORS = {
  // Listing rows
  articleRow: 'div.article-row, .seller-listing',

  // Seller info
  sellerName: '.seller-name a, .seller-info .name',
  sellerRating: '.seller-rating, .rating-value',

  // Price
  price: '.price-container .price, .article-price',

  // Condition
  condition: '.item-condition, .condition-badge',

  // Language
  language: '.item-language img, .language-flag',

  // Quantity
  quantity: '.item-count, .quantity',
};
```

---

## The Cloudflare Barrier

CardMarket employs Cloudflare protection. The grimoire teaches these bypass techniques:

### 1. Residential Proxy Rotation
```typescript
const PROXY_CONFIG = {
  provider: 'brightdata', // or 'smartproxy', 'oxylabs'
  type: 'residential',
  country: 'DE', // Germany for CardMarket
  sessionDuration: 600, // 10 minutes per session
  rotateOnBlock: true,
};
```

### 2. Request Header Alchemy
```typescript
const HEADERS = {
  'User-Agent': rotateUserAgent(), // Browser fingerprint
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-GB,en;q=0.9,de;q=0.8',
  'Accept-Encoding': 'gzip, deflate, br',
  'Connection': 'keep-alive',
  'Upgrade-Insecure-Requests': '1',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Cache-Control': 'max-age=0',
};
```

### 3. Rate Limit Awareness
```typescript
const RATE_LIMITS = {
  requestsPerMinute: 30,
  delayBetweenRequests: 2000, // 2 seconds base
  delayVariance: 0.3, // ±30% randomization
  backoffOnError: 60000, // 1 minute on 403/429
  maxRetries: 3,
};
```

---

## The Daily Transmutation Schedule

### Morning Ritual (06:00 UTC)
- Scrape all Legendary tier cards
- Full price guide extraction
- Update trend data

### Midday Ritual (12:00 UTC)
- Scrape Silver Ingot tier
- Monitor price movements
- Detect arbitrage opportunities

### Evening Ritual (18:00 UTC)
- Full sweep all tiers
- Seller listing extraction
- Historical data archival

### Nightly Ritual (00:00 UTC)
- Gap analysis
- Data quality validation
- Report generation

---

## The Output Transmutation

### Price Signal Schema (USD Normalized)
```typescript
interface CardMarketPriceSignal {
  // Identity
  cardId: string;           // "OP01-120"
  variant: string;          // "parallel" | "manga" | "sp" | "standard"
  language: string;         // "EN" | "DE" | "FR"

  // Prices (USD normalized)
  priceFromUsd: number;     // Lowest available
  priceTrendUsd: number;    // 30-day weighted avg
  priceAvgUsd: number;      // 7-day average
  priceAvg30Usd: number;    // 30-day average

  // Source (EUR original)
  source: {
    marketplace: 'cardmarket';
    currency: 'EUR';
    priceFrom: number;
    priceTrend: number;
    priceAvg: number;
  };

  // Market data
  availableItems: number;
  spreadPercent: number;    // (trend - from) / from * 100

  // Metadata
  url: string;
  scrapedAt: Date;
  confidence: number;       // 0-1 quality score
}
```

### NDJSON Export Format
```json
{"card_id":"OP01-120","variant":"parallel","price_from_usd":162.00,"price_trend_usd":175.50,"available":12,"scraped_at":"2026-01-09T08:00:00Z"}
{"card_id":"OP06-118","variant":"manga","price_from_usd":195.00,"price_trend_usd":210.00,"available":3,"scraped_at":"2026-01-09T08:00:00Z"}
```

---

## Critical Data Gaps

The grimoire identifies these training data gaps:

### 🚨 CRITICAL: Manga Variants
- Current images: 0
- Target: 500+
- Priority: HIGHEST

### ⚠️ HIGH: Box Toppers
- Current images: 30
- Target: 200+
- Priority: HIGH

### ⚠️ HIGH: Leader Alt Arts
- Current images: 50
- Target: 300+
- Priority: HIGH

### 📊 MEDIUM: SP Reprints
- Current: ~100
- Target: 400+
- Priority: MEDIUM

---

## Integration with Neural Network

The CardMarket Receptor Neuron (`cardmarket-receptor.ts`) receives scraped data and:

1. **Validates** card ID format and price bounds
2. **Normalizes** prices via Price Transformer (EUR → USD)
3. **Detects** opportunities (scarcity, spread, high-value)
4. **Emits** neurotransmitters:
   - `DOPAMINE`: Scarcity (≤3 items) + opportunity
   - `NOREPINEPHRINE`: High value (>€50)
   - `GLUTAMATE`: Standard valid signal
   - `GABA`: Invalid/blocked data

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  CardMarket     │────▶│  Receptor        │────▶│  Price          │
│  Scraper        │     │  Neuron          │     │  Transformer    │
└─────────────────┘     └──────────────────┘     └─────────────────┘
        │                       │                        │
        ▼                       ▼                        ▼
   Raw HTML              Validated Signal          USD Normalized
   + Prices              + Neurotransmitter        + Spread Analysis
```

---

## The Apprentice's Checklist

Before each scraping session, verify:

- [ ] Proxy configured and tested
- [ ] Rate limits set appropriately
- [ ] Target cards list updated
- [ ] Output directory exists
- [ ] Database connection active
- [ ] Cloudflare not blocking (test request)
- [ ] Previous session data archived

---

## Appendix: Set Code Reference

| Set Code | Full Name | Release | Cards |
|----------|-----------|---------|-------|
| OP01 | Romance Dawn | Dec 2022 | 121 |
| OP02 | Paramount War | Mar 2023 | 121 |
| OP03 | Pillars of Strength | Jun 2023 | 122 |
| OP04 | Kingdoms of Intrigue | Sep 2023 | 121 |
| OP05 | Awakening of the New Era | Dec 2023 | 121 |
| OP06 | Wings of the Captain | Mar 2024 | 121 |
| OP07 | 500 Years in the Future | Jun 2024 | 121 |
| OP08 | Two Legends | Sep 2024 | 121 |
| OP09 | The Four Emperors | Dec 2024 | 121 |
| OP10 | Royal Blood | Mar 2025 | 121 |
| OP11 | Emperors in New World | Jun 2025 | TBD |
| EB01 | Memorial Collection | Aug 2023 | 63 |
| EB02 | Extra Booster | Feb 2024 | 63 |
| ST01-ST16 | Starter Decks | Various | ~17 each |

---

*"The CardMarket Alchemist sees not just prices, but the flow of value across the European marketplace. Master these teachings, and the data shall flow like gold."*

---

**[>>> Documentation Index <<<](./INDEX.md)** | *Navigate all TCG pipeline documentation*
