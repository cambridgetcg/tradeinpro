# TCGPlayer Data Pipeline Documentation

> **Sub-Navigation Hub** - TCGPlayer-specific documentation
>
> **Parent Index**: [>>> Main Documentation Index <<<](../../cardmarket/docs/INDEX.md)

**Last Updated:** 2026-01-10
**Location:** `infrastructure/data-pipeline/scraper-dev/tcgplayer/docs/README.md`

---

## Quick Navigation

| Need | Go To |
|------|-------|
| **Use TCGPlayer Search API** | [SCRAPER_ARCHITECTURE_INSIGHTS.md](#scrapers--data-collection) |
| **Hybrid pipeline (JustTCG + API)** | [HYBRID_PIPELINE_ARCHITECTURE.md](#scrapers--data-collection) |
| **AWS deployment** | [AWS_INFRASTRUCTURE.md](#infrastructure) |
| **ML training prep** | [ML_TRAINING_PREREQUISITES.md](#machine-learning) |
| **Market data training** | [MARKET_DATA_TRAINING_GUIDE.md](#machine-learning) |
| **TCGPlayer tech stack** | [TCGPLAYER_STACK_ANALYSIS.md](#research--analysis) |

---

## Documentation Map

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     TCGPLAYER DATA PIPELINE DOCUMENTATION                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────┐                    ┌─────────────────────┐         │
│  │   SCRAPERS & APIs   │───────────────────▶│   INFRASTRUCTURE    │         │
│  ├─────────────────────┤                    ├─────────────────────┤         │
│  │ • Search API (FREE) │                    │ • AWS Deployment    │         │
│  │ • JustTCG API       │                    │ • Daily Archive     │         │
│  │ • Hybrid Pipeline   │                    │ • S3 Storage        │         │
│  │ • Bright Data       │                    │                     │         │
│  └─────────────────────┘                    └─────────────────────┘         │
│           │                                          │                       │
│           ▼                                          ▼                       │
│  ┌─────────────────────┐                    ┌─────────────────────┐         │
│  │  MACHINE LEARNING   │                    │  RESEARCH/INSIGHTS  │         │
│  ├─────────────────────┤                    ├─────────────────────┤         │
│  │ • Training Prereqs  │                    │ • Stack Analysis    │         │
│  │ • Market Data Guide │                    │ • Value Extraction  │         │
│  │ • Gap Filling       │                    │ • Architecture Comp │         │
│  └─────────────────────┘                    └─────────────────────┘         │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 1. Scrapers & Data Collection

### TCGPlayer Search API (Recommended)
*Direct API access - FREE, reliable, includes individual listings*

| Document | Purpose | Key Insight |
|----------|---------|-------------|
| **[SCRAPER_ARCHITECTURE_INSIGHTS.md](./SCRAPER_ARCHITECTURE_INSIGHTS.md)** | **COMPREHENSIVE** - TCGPlayer vs CardMarket comparison | API-first beats HTML scraping |
| **[HYBRID_PIPELINE_ARCHITECTURE.md](./HYBRID_PIPELINE_ARCHITECTURE.md)** | JustTCG + Search API integration | Hybrid approach for reliability |

**Key Discovery (2026-01-10):**
- TCGPlayer website is an SPA - HTML scraping returns empty shells
- **Found public Search API**: `mp-search-api.tcgplayer.com/v1/search/request`
- Returns full JSON with products AND individual seller listings
- **Cost: $0** (vs $20+/month for Bright Data)

**API Endpoint:**
```
POST https://mp-search-api.tcgplayer.com/v1/search/request
Headers:
  Content-Type: application/json
  Origin: https://www.tcgplayer.com
```

**Usage:**
```bash
# Test the Search API scraper
npx tsx scripts/test-search-api-scraper.ts --set=OP01

# Run daily archive with listings
npx tsx scripts/daily-archive-local.ts --with-listings --set=OP01
```

### JustTCG API (Aggregate Prices)
*Third-party API for market prices*

| Document | Purpose | Key Insight |
|----------|---------|-------------|
| [HYBRID_PIPELINE_ARCHITECTURE.md](./HYBRID_PIPELINE_ARCHITECTURE.md) | JustTCG as primary source | Aggregate prices only, no listings |

**API Key:** `***REMOVED-ROTATE-ME***`

---

## 2. Infrastructure

### AWS & Deployment
*Cloud infrastructure for production*

| Document | Purpose | Key Insight |
|----------|---------|-------------|
| **[AWS_INFRASTRUCTURE.md](./AWS_INFRASTRUCTURE.md)** | TCGPlayer AWS deployment | S3, Lambda, ECS setup |

**Related (CardMarket docs):**
| Document | Purpose |
|----------|---------|
| [AWS_CARDMARKET_PIPELINE_ARCHITECTURE.md](../../cardmarket/docs/AWS_CARDMARKET_PIPELINE_ARCHITECTURE.md) | Reference architecture |
| [AWS_DEPLOYMENT_GUIDE.md](../../cardmarket/docs/AWS_DEPLOYMENT_GUIDE.md) | Complete deployment guide |

---

## 3. Machine Learning

### Training Data Preparation
*Getting data ready for ML models*

| Document | Purpose | Key Insight |
|----------|---------|-------------|
| **[ML_TRAINING_PREREQUISITES.md](./ML_TRAINING_PREREQUISITES.md)** | Data requirements for training | Volume, quality, coverage |
| **[MARKET_DATA_TRAINING_GUIDE.md](./MARKET_DATA_TRAINING_GUIDE.md)** | Market data for price prediction | Feature engineering, time series |
| **[GAP_FILLING_IMPLEMENTATION_PLAN.md](./GAP_FILLING_IMPLEMENTATION_PLAN.md)** | Filling data gaps | Interpolation, proxy sources |

**Related (Main docs):**
| Document | Purpose |
|----------|---------|
| [ML_ARCHITECTURE_DESIGN.md](../../../../docs/ML_ARCHITECTURE_DESIGN.md) | Overall ML architecture |
| [NEURAL_DEAL_IDENTIFICATION_SPEC.md](../../../../docs/NEURAL_DEAL_IDENTIFICATION_SPEC.md) | Deal scoring model |
| [TRAINING_DATA_COLLECTION_STRATEGY.md](../../../../docs/TRAINING_DATA_COLLECTION_STRATEGY.md) | Data collection strategy |

---

## 4. Research & Analysis

### Platform Understanding
*Technical analysis and insights*

| Document | Purpose | Key Insight |
|----------|---------|-------------|
| **[TCGPLAYER_STACK_ANALYSIS.md](./TCGPLAYER_STACK_ANALYSIS.md)** | TCGPlayer tech reverse-engineering | SPA, API endpoints, headers |
| **[VALUE_EXTRACTION_FRAMEWORK.md](./VALUE_EXTRACTION_FRAMEWORK.md)** | Data value identification | What to collect, why |
| **[SCRAPER_ARCHITECTURE_INSIGHTS.md](./SCRAPER_ARCHITECTURE_INSIGHTS.md)** | TCGPlayer vs CardMarket patterns | Architecture comparison |

---

## Cross-References

### To CardMarket Docs
| TCGPlayer Doc | Related CardMarket Doc | Relationship |
|---------------|----------------------|--------------|
| `SCRAPER_ARCHITECTURE_INSIGHTS.md` | `CARDMARKET_SCRAPER_INFRASTRUCTURE.md` | Comparison |
| `AWS_INFRASTRUCTURE.md` | `AWS_CARDMARKET_PIPELINE_ARCHITECTURE.md` | Same pattern |
| `TCGPLAYER_STACK_ANALYSIS.md` | `CARDMARKET_STACK_ANALYSIS.md` | Same approach |

### To Main Docs (cardforum/docs)
| TCGPlayer Doc | Related Main Doc | Relationship |
|---------------|-----------------|--------------|
| `ML_TRAINING_PREREQUISITES.md` | `ML_ARCHITECTURE_DESIGN.md` | Implements |
| `MARKET_DATA_TRAINING_GUIDE.md` | `NEURAL_DEAL_IDENTIFICATION_SPEC.md` | Feeds into |
| All scraper docs | `DATA_SOURCES_INTEGRATION_PLAN.md` | Part of |

### To eBay Docs
| TCGPlayer Doc | Related eBay Doc | Relationship |
|---------------|-----------------|--------------|
| Price collection | `EBAY_PIPELINE_ARCHITECTURE.md` | Parallel source |
| Individual listings | `SERPAPI_EBAY_INSIGHTS.md` | Similar data |

---

## File List

```
infrastructure/data-pipeline/scraper-dev/tcgplayer/docs/
├── README.md                          ← YOU ARE HERE
├── CODE_DOCUMENTATION_MAP.md          ← NEW - Code ↔ Docs symbiosis map
├── SCRAPER_ARCHITECTURE_INSIGHTS.md   ← NEW (2026-01-10) - TCGPlayer vs CardMarket
├── HYBRID_PIPELINE_ARCHITECTURE.md    ← JustTCG + Search API
├── AWS_INFRASTRUCTURE.md              ← AWS deployment
├── ML_TRAINING_PREREQUISITES.md       ← ML data requirements
├── MARKET_DATA_TRAINING_GUIDE.md      ← Price prediction data
├── GAP_FILLING_IMPLEMENTATION_PLAN.md ← Data gap solutions
├── TCGPLAYER_STACK_ANALYSIS.md        ← Platform tech analysis
└── VALUE_EXTRACTION_FRAMEWORK.md      ← Data value framework
```

## Code ↔ Documentation Symbiosis

All major code files now include `DOCUMENTATION REFERENCES` blocks that link to relevant documentation. See [CODE_DOCUMENTATION_MAP.md](./CODE_DOCUMENTATION_MAP.md) for the complete mapping.

**Key symbiotic relationships:**
| Code File | Primary Documentation |
|-----------|----------------------|
| `tcgplayer-search-api-scraper.ts` | SCRAPER_ARCHITECTURE_INSIGHTS.md |
| `hybrid-tcgplayer-pipeline.ts` | HYBRID_PIPELINE_ARCHITECTURE.md |
| `daily-archive-local.ts` | AWS_INFRASTRUCTURE.md |
| `cardmarket-collector.ts` | SCRAPER_ARCHITECTURE_INSIGHTS.md + CardMarket docs |

---

## Navigation

**Up:** [Main Documentation Index](../../cardmarket/docs/INDEX.md)

**Siblings:**
- [CardMarket Docs](../../cardmarket/docs/INDEX.md)
- [eBay Docs](../../ebay/docs/)
- [Main App Docs](../../../../docs/)

---

*"The Search API is the thread that unravels TCGPlayer's SPA labyrinth."*
