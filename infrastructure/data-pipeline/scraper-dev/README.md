# Scraper Development Hub

> **Multi-Platform Data Collection Infrastructure**
>
> This directory contains scraper implementations for all supported TCG marketplaces.

**Location:** `infrastructure/data-pipeline/scraper-dev/`

---

## Platform Documentation

| Platform | Directory | Documentation | Primary Method |
|----------|-----------|---------------|----------------|
| **CardMarket** | [cardmarket/](./cardmarket/) | [docs/INDEX.md](./cardmarket/docs/INDEX.md) | Bright Data API |
| **TCGPlayer** | [tcgplayer/](./tcgplayer/) | [docs/README.md](./tcgplayer/docs/README.md) | Search API (FREE) |
| **eBay** | [ebay/](./ebay/) | [docs/](./ebay/docs/) | SerpAPI |

---

## Quick Start by Platform

### CardMarket (EU Marketplace)
```bash
cd cardmarket

# Test browser scraper (fallback)
npx tsx scripts/test-browser-scraper.ts --dry-run

# Run with Bright Data (recommended)
npx tsx scripts/daily-cardmarket-archive.ts --dry-run
```
**Docs:** [CardMarket INDEX.md](./cardmarket/docs/INDEX.md)

### TCGPlayer (US Marketplace)
```bash
cd tcgplayer

# Test Search API scraper (free, recommended)
npx tsx scripts/test-search-api-scraper.ts --set=OP01

# Daily archive with listings
npx tsx scripts/daily-archive-local.ts --with-listings --set=OP01
```
**Docs:** [TCGPlayer README.md](./tcgplayer/docs/README.md)

### eBay (Historical Prices)
```bash
cd ebay

# Collect historical sold prices via SerpAPI
npx tsx scripts/collect-ebay-data.ts
```
**Docs:** [eBay docs/](./ebay/docs/)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          SCRAPER DEVELOPMENT HUB                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐              │
│  │   CardMarket    │  │   TCGPlayer     │  │     eBay        │              │
│  │   (EU/EUR)      │  │   (US/USD)      │  │   (Historical)  │              │
│  ├─────────────────┤  ├─────────────────┤  ├─────────────────┤              │
│  │ • Bright Data   │  │ • Search API    │  │ • SerpAPI       │              │
│  │ • Browser       │  │ • JustTCG API   │  │ • Image ML      │              │
│  │ • Daily archive │  │ • Daily archive │  │ • Title parsing │              │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘              │
│           │                    │                    │                        │
│           ▼                    ▼                    ▼                        │
│  ┌─────────────────────────────────────────────────────────────────┐        │
│  │                    UNIFIED DATA LAYER                            │        │
│  │         PostgreSQL (RDS) │ S3 Archives │ Price Snapshots         │        │
│  └─────────────────────────────────────────────────────────────────┘        │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Cross-Platform Features

### Shared Patterns
| Pattern | CardMarket | TCGPlayer | eBay |
|---------|------------|-----------|------|
| Rate limiting | 2s delay | 1.5s delay | SerpAPI managed |
| Retry logic | Exponential backoff | Exponential backoff | SerpAPI retry |
| Daily archive | Yes | Yes | Historical only |
| Individual listings | Yes | Yes | Sold prices only |

### Data Flow
1. **Collection** → Platform-specific scrapers
2. **Storage** → PostgreSQL + S3 archive
3. **Processing** → Price normalization, currency conversion
4. **Output** → Neural network training, API endpoints

---

## Directory Structure

```
scraper-dev/
├── README.md                 ← YOU ARE HERE
│
├── cardmarket/               ← CardMarket scraper
│   ├── docs/
│   │   └── INDEX.md          ← MASTER DOCUMENTATION INDEX
│   ├── src/
│   └── scripts/
│
├── tcgplayer/                ← TCGPlayer scraper
│   ├── docs/
│   │   └── README.md         ← TCGPlayer sub-index
│   ├── src/
│   └── scripts/
│
└── ebay/                     ← eBay scraper
    ├── docs/
    └── scripts/
```

---

## Related Documentation

### Parent Level
- [Data Pipeline docs](../docs/) - Pipeline architecture
- [CardForum docs](../../../docs/) - Main application docs

### Key Documents
| Topic | Document |
|-------|----------|
| **Master Index** | [cardmarket/docs/INDEX.md](./cardmarket/docs/INDEX.md) |
| **Scraper Comparison** | [tcgplayer/docs/SCRAPER_ARCHITECTURE_INSIGHTS.md](./tcgplayer/docs/SCRAPER_ARCHITECTURE_INSIGHTS.md) |
| **AWS Deployment** | [cardmarket/docs/AWS_DEPLOYMENT_GUIDE.md](./cardmarket/docs/AWS_DEPLOYMENT_GUIDE.md) |
| **Neural Network** | [cardmarket/docs/NEURAL_ARCHITECTURE.md](./cardmarket/docs/NEURAL_ARCHITECTURE.md) |
| **ML Training** | [tcgplayer/docs/ML_TRAINING_PREREQUISITES.md](./tcgplayer/docs/ML_TRAINING_PREREQUISITES.md) |

---

*"Three platforms, one unified data layer."*
