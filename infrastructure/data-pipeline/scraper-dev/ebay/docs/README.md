# eBay Data Collection Documentation

> **Sub-Navigation Hub** - eBay historical price collection
>
> **Parent Index**: [>>> Main Documentation Index <<<](../../cardmarket/docs/INDEX.md)

**Last Updated:** 2026-01-10
**Location:** `infrastructure/data-pipeline/scraper-dev/ebay/docs/README.md`

---

## Quick Navigation

| Need | Go To |
|------|-------|
| **Pipeline architecture** | [EBAY_PIPELINE_ARCHITECTURE.md](#pipeline-architecture) |
| **AWS infrastructure** | [EBAY_PIPELINE_INFRASTRUCTURE.md](#infrastructure) |
| **SerpAPI integration** | [SERPAPI_EBAY_INSIGHTS.md](#data-collection) |
| **Query optimization** | [QUERY_STRATEGY_GUIDE.md](#data-collection) |
| **Image ML training** | [EFFICIENTNET_TRAINING_GUIDE.md](#machine-learning) |
| **Image pipeline** | [IMAGE_PIPELINE_README.md](#machine-learning) |

---

## Overview

eBay provides **historical sold price data** via SerpAPI, complementing the live marketplace data from CardMarket and TCGPlayer.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        EBAY DATA COLLECTION PIPELINE                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐        │
│  │   Card Queries  │────▶│    SerpAPI      │────▶│  Sold Listings  │        │
│  │ (name + set)    │     │  (eBay endpoint)│     │  (3-year data)  │        │
│  └─────────────────┘     └─────────────────┘     └─────────────────┘        │
│                                                          │                   │
│                                   ┌──────────────────────┤                   │
│                                   ▼                      ▼                   │
│                          ┌─────────────────┐    ┌─────────────────┐          │
│                          │  Title Parsing  │    │  Image Download │          │
│                          │  (card matching)│    │  (ML training)  │          │
│                          └─────────────────┘    └─────────────────┘          │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 1. Data Collection

### SerpAPI Integration
*Historical sold prices via SerpAPI's eBay endpoint*

| Document | Purpose | Key Insight |
|----------|---------|-------------|
| **[SERPAPI_EBAY_INSIGHTS.md](./SERPAPI_EBAY_INSIGHTS.md)** | SerpAPI results analysis | 3,906 listings collected |
| **[QUERY_STRATEGY_GUIDE.md](./QUERY_STRATEGY_GUIDE.md)** | Query optimization | Title patterns, set codes |

**Key Features:**
- 3-year historical lookback
- Sold price only (actual transaction values)
- Title parsing for card identification
- Variant detection (parallel, SP, manga)

**Related (CardMarket docs):**
| Document | Purpose |
|----------|---------|
| [SERPAPI_ALCHEMIST_GRIMOIRE.md](../../cardmarket/docs/SERPAPI_ALCHEMIST_GRIMOIRE.md) | Complete SerpAPI guide |
| [EBAY_COLLECTION_INSIGHTS.md](../../cardmarket/docs/EBAY_COLLECTION_INSIGHTS.md) | Collection analysis |

---

## 2. Pipeline Architecture

### System Design
*End-to-end data flow*

| Document | Purpose | Key Insight |
|----------|---------|-------------|
| **[EBAY_PIPELINE_ARCHITECTURE.md](./EBAY_PIPELINE_ARCHITECTURE.md)** | Complete pipeline design | Query → Parse → Store flow |
| **[EBAY_PIPELINE_INFRASTRUCTURE.md](./EBAY_PIPELINE_INFRASTRUCTURE.md)** | AWS infrastructure | Lambda, S3, scheduling |

---

## 3. Machine Learning

### Image Classification
*Card image classification using EfficientNet*

| Document | Purpose | Key Insight |
|----------|---------|-------------|
| **[EFFICIENTNET_TRAINING_GUIDE.md](./EFFICIENTNET_TRAINING_GUIDE.md)** | Model training guide | Fine-tuning for TCG cards |
| **[IMAGE_PIPELINE_README.md](./IMAGE_PIPELINE_README.md)** | Image collection pipeline | Download, resize, augment |

**Purpose:**
- Classify card images from eBay listings
- Match to known card database
- Detect condition and variant type

---

## Cross-References

### To Sibling Platform Docs
| eBay Doc | Related Doc | Platform |
|----------|-------------|----------|
| `SERPAPI_EBAY_INSIGHTS.md` | `SERPAPI_ALCHEMIST_GRIMOIRE.md` | CardMarket |
| `EBAY_PIPELINE_ARCHITECTURE.md` | `HYBRID_PIPELINE_ARCHITECTURE.md` | TCGPlayer |
| Image ML docs | `NEURAL_EMBRYO_VISION.md` | CardMarket |

### To Main Docs (cardforum/docs)
| eBay Doc | Related Main Doc | Relationship |
|----------|-----------------|--------------|
| All pipeline docs | `DATA_SOURCES_INTEGRATION_PLAN.md` | Part of |
| Image ML docs | `ML_ARCHITECTURE_DESIGN.md` | Implements |
| Price data | `TRAINING_DATA_COLLECTION_STRATEGY.md` | Feeds into |

---

## File List

```
infrastructure/data-pipeline/scraper-dev/ebay/docs/
├── README.md                      ← YOU ARE HERE
├── EBAY_PIPELINE_ARCHITECTURE.md  ← Full pipeline design
├── EBAY_PIPELINE_INFRASTRUCTURE.md ← AWS setup
├── SERPAPI_EBAY_INSIGHTS.md       ← SerpAPI results
├── QUERY_STRATEGY_GUIDE.md        ← Query optimization
├── EFFICIENTNET_TRAINING_GUIDE.md ← Image ML training
└── IMAGE_PIPELINE_README.md       ← Image collection
```

---

## Navigation

**Up:** [Main Documentation Index](../../cardmarket/docs/INDEX.md)

**Siblings:**
- [CardMarket Docs](../../cardmarket/docs/INDEX.md)
- [TCGPlayer Docs](../../tcgplayer/docs/README.md)
- [Scraper Hub](../../README.md)

---

*"Historical data provides the foundation for price prediction."*
