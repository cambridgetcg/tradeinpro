# TCG Data Pipeline Documentation Index

> **MASTER NAVIGATION HUB** - Start here to find any documentation
>
> **Auto-Discovery**: This file is referenced from README.md, CLAUDE.md, and all major documentation files. If you lose context, search for `INDEX.md` or `docs/INDEX.md`.

**Last Updated:** 2026-01-10
**Location:** `infrastructure/data-pipeline/scraper-dev/cardmarket/docs/INDEX.md`

---

## Sub-Documentation Hubs

| Platform | Documentation Hub | Description |
|----------|-------------------|-------------|
| **CardMarket** | This file (INDEX.md) | EU marketplace scraping |
| **TCGPlayer** | [tcgplayer/docs/README.md](../../tcgplayer/docs/README.md) | US marketplace API & scraping |
| **eBay** | [ebay/docs/](../../ebay/docs/) | Historical sold prices |

---

## Quick Navigation

| Need | Go To |
|------|-------|
| **Start CardMarket scraper** | [CARDMARKET_BROWSER_SCRAPER_GUIDE.md](#cardmarket-scraper-infrastructure) |
| **Use Bright Data (recommended)** | [BRIGHTDATA_INTEGRATION_INSIGHTS.md](#cardmarket-scraper-infrastructure) |
| **Daily price archive** | [CARDMARKET_ARCHIVE_IMPLEMENTATION_INSIGHTS.md](#cardmarket-scraper-infrastructure) |
| **AWS production pipeline** | [AWS_CARDMARKET_PIPELINE_ARCHITECTURE.md](#aws--pipeline) |
| **Deploy to AWS** | [AWS_DEPLOYMENT_GUIDE.md](#aws--pipeline) |
| **TCGPlayer Search API** | [tcgplayer/docs/README.md](../../tcgplayer/docs/README.md) ← NEW |
| **TCGPlayer vs CardMarket** | [SCRAPER_ARCHITECTURE_INSIGHTS.md](../../tcgplayer/docs/SCRAPER_ARCHITECTURE_INSIGHTS.md) ← NEW |
| **Understand neural network** | [NEURAL_ARCHITECTURE.md](#neural-network-architecture) |
| **Configure eBay collection** | [SERPAPI_ALCHEMIST_GRIMOIRE.md](#serpapi-ebay-collection) |
| **ML model design** | [ML_ARCHITECTURE_DESIGN.md](#machine-learning) |
| **Business strategy** | [API_COMMERCIALIZATION_STRATEGY.md](#business--strategy) |

---

## Documentation Map

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        TCG DATA PIPELINE DOCUMENTATION                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────┐        │
│  │                      DATA SOURCES                                │        │
│  ├─────────────────┬─────────────────┬─────────────────────────────┤        │
│  │   CardMarket    │   TCGPlayer     │     SerpAPI/eBay            │        │
│  │   (EU - EUR)    │   (US - USD)    │     (Historical)            │        │
│  │   Bright Data   │   Search API    │     3-year lookback         │        │
│  └────────┬────────┴────────┬────────┴──────────┬──────────────────┘        │
│           │                 │                    │                           │
│           ▼                 ▼                    ▼                           │
│  ┌─────────────────────────────────────────────────────────────────┐        │
│  │                    UNIFIED DATA LAYER                            │        │
│  │    Prices │ Listings │ Sellers │ Conditions │ Currencies         │        │
│  └─────────────────────────────────────────────────────────────────┘        │
│                                │                                             │
│           ┌────────────────────┼────────────────────┐                       │
│           ▼                    ▼                    ▼                        │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐              │
│  │   NEURAL CORE   │  │  INFRASTRUCTURE │  │    BUSINESS     │              │
│  ├─────────────────┤  ├─────────────────┤  ├─────────────────┤              │
│  │ • Architecture  │  │ • AWS Setup     │  │ • API Strategy  │              │
│  │ • Embryo Vision │  │ • Deployment    │  │ • Marketplaces  │              │
│  │ • ML Models     │  │ • Daily Archive │  │ • Arbitrage     │              │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘              │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 1. Data Sources (Scrapers & APIs)

### CardMarket Scraper Infrastructure
*European marketplace price collection*

| Document | Purpose | Key Insight |
|----------|---------|-------------|
| **[BRIGHTDATA_INTEGRATION_INSIGHTS.md](./BRIGHTDATA_INTEGRATION_INSIGHTS.md)** | **RECOMMENDED** - Bright Data API | 100% success rate, auto CAPTCHA solving |
| **[CARDMARKET_BROWSER_SCRAPER_GUIDE.md](./CARDMARKET_BROWSER_SCRAPER_GUIDE.md)** | Browser scraper guide (local) | Playwright works but gets rate-limited |
| **[CARDMARKET_ARCHIVE_IMPLEMENTATION_INSIGHTS.md](./CARDMARKET_ARCHIVE_IMPLEMENTATION_INSIGHTS.md)** | Daily archive system | Condition/language partitioning, `__name` fix |
| **[CARDMARKET_SCRAPER_INFRASTRUCTURE.md](./CARDMARKET_SCRAPER_INFRASTRUCTURE.md)** | HTTP scraper reference (deprecated) | CSS selectors, rate limits, circuit breaker |
| **[CARDMARKET_ALCHEMIST_GRIMOIRE.md](./CARDMARKET_ALCHEMIST_GRIMOIRE.md)** | Philosophical guide & patterns | Four Cardinal Essences, transmutation rituals |
| **[CARDMARKET_SCRAPING_INSIGHTS.md](./CARDMARKET_SCRAPING_INSIGHTS.md)** | Testing results & findings | Cloudflare bypass, session handling |
| **[CARDMARKET_STACK_ANALYSIS.md](./CARDMARKET_STACK_ANALYSIS.md)** | Technology reverse-engineering | Cardmarket frontend/backend stack |
| **[TARGETED_SCRAPING_STRATEGY.md](./TARGETED_SCRAPING_STRATEGY.md)** | Ethical scraping approach | Minimal footprint, priority tiers |
| **[TOOLS_AND_RESOURCES.md](./TOOLS_AND_RESOURCES.md)** | External tools catalog | Proxies, libraries, services |

**Key Discoveries (2026-01-10):**
- HTTP requests return 403 (Cloudflare challenge)
- **Playwright browser automation bypasses Cloudflare WITHOUT proxy**
- **CRITICAL**: TypeScript arrow functions break `page.evaluate()` - use plain JS strings
- Use `npx tsx scripts/test-browser-scraper.ts --dry-run` to test
- Use `npx tsx scripts/daily-cardmarket-archive.ts --dry-run` for archive test

**Relationships:**
- `CARDMARKET_BROWSER_SCRAPER_GUIDE.md` → Supersedes → `CARDMARKET_SCRAPER_INFRASTRUCTURE.md` (for live scraping)
- `CARDMARKET_SCRAPING_INSIGHTS.md` → Informs → `TARGETED_SCRAPING_STRATEGY.md`
- `CARDMARKET_STACK_ANALYSIS.md` → Guides → `TOOLS_AND_RESOURCES.md`

### SerpAPI (eBay Collection)
*Historical eBay sold prices via SerpAPI*

| Document | Purpose | Key Insight |
|----------|---------|-------------|
| **[SERPAPI_ALCHEMIST_GRIMOIRE.md](./SERPAPI_ALCHEMIST_GRIMOIRE.md)** | Complete eBay collection guide | Title parsing, query orchestration, 3-year lookback |
| **[EBAY_COLLECTION_INSIGHTS.md](./EBAY_COLLECTION_INSIGHTS.md)** | Collection results & analysis | 3,906 listings, variant coverage gaps |

**Related (in cardforum/docs):**
| Document | Purpose |
|----------|---------|
| [DATA_COLLECTION_INSIGHTS.md](../../../docs/DATA_COLLECTION_INSIGHTS.md) | Cross-source insights |
| [TRAINING_DATA_COLLECTION_STRATEGY.md](../../../docs/TRAINING_DATA_COLLECTION_STRATEGY.md) | ML training data strategy |

### TCGPlayer API & Scraping
*US marketplace price collection - NEW (2026-01-10)*

> **Full Documentation:** [tcgplayer/docs/README.md](../../tcgplayer/docs/README.md)

| Document | Purpose | Key Insight |
|----------|---------|-------------|
| **[SCRAPER_ARCHITECTURE_INSIGHTS.md](../../tcgplayer/docs/SCRAPER_ARCHITECTURE_INSIGHTS.md)** | **COMPREHENSIVE** - TCGPlayer vs CardMarket | API-first strategy, patterns, lessons |
| **[HYBRID_PIPELINE_ARCHITECTURE.md](../../tcgplayer/docs/HYBRID_PIPELINE_ARCHITECTURE.md)** | JustTCG + Search API | Hybrid approach for reliability |
| **[TCGPLAYER_STACK_ANALYSIS.md](../../tcgplayer/docs/TCGPLAYER_STACK_ANALYSIS.md)** | Platform tech analysis | SPA architecture, API discovery |
| **[AWS_INFRASTRUCTURE.md](../../tcgplayer/docs/AWS_INFRASTRUCTURE.md)** | AWS deployment | S3, Lambda, ECS setup |
| **[ML_TRAINING_PREREQUISITES.md](../../tcgplayer/docs/ML_TRAINING_PREREQUISITES.md)** | ML data requirements | Training data prep |
| **[MARKET_DATA_TRAINING_GUIDE.md](../../tcgplayer/docs/MARKET_DATA_TRAINING_GUIDE.md)** | Price prediction data | Feature engineering |
| **[GAP_FILLING_IMPLEMENTATION_PLAN.md](../../tcgplayer/docs/GAP_FILLING_IMPLEMENTATION_PLAN.md)** | Data gap solutions | Interpolation strategies |
| **[VALUE_EXTRACTION_FRAMEWORK.md](../../tcgplayer/docs/VALUE_EXTRACTION_FRAMEWORK.md)** | Data value framework | What to collect, why |

**Key Discovery (2026-01-10):**
- TCGPlayer website is an SPA - HTML scraping returns empty shells
- **Found public Search API**: `mp-search-api.tcgplayer.com/v1/search/request`
- Returns full JSON with products AND individual seller listings
- **Cost: $0** (vs $20+/month for Bright Data)

**Usage:**
```bash
# Test the Search API scraper
npx tsx scripts/test-search-api-scraper.ts --set=OP01

# Run daily archive with listings
npx tsx scripts/daily-archive-local.ts --with-listings --set=OP01
```

---

## 2. Neural Network Architecture

### Core Neural System
*Biological metaphor for data pipeline*

| Document | Purpose | Key Insight |
|----------|---------|-------------|
| **[NEURAL_ARCHITECTURE.md](./NEURAL_ARCHITECTURE.md)** | Full neural network design | Neurons, synapses, neurotransmitters |
| **[NEURAL_EMBRYO_VISION.md](./NEURAL_EMBRYO_VISION.md)** | Visual cortex for card grading | CNN architecture, defect detection |
| **[NEURAL_EMBRYO_NUTRIENTS.md](./NEURAL_EMBRYO_NUTRIENTS.md)** | Training data preparation | Augmentation, vitamins/minerals metaphor |

**Related (in cardforum/docs):**
| Document | Purpose |
|----------|---------|
| [NEURAL_EMBRYO_GENESIS.md](../../../docs/NEURAL_EMBRYO_GENESIS.md) | System conception document |
| [NEURAL_DEAL_IDENTIFICATION_SPEC.md](../../../docs/NEURAL_DEAL_IDENTIFICATION_SPEC.md) | Deal scoring algorithm |
| [NEURAL_IMPLEMENTATION_PROGRESS.md](../../../docs/NEURAL_IMPLEMENTATION_PROGRESS.md) | Implementation status tracker |

**Relationships:**
- `NEURAL_ARCHITECTURE.md` → Parent of → `NEURAL_EMBRYO_*.md`
- `NEURAL_EMBRYO_NUTRIENTS.md` → Feeds → `NEURAL_EMBRYO_VISION.md`
- `NEURAL_DEAL_IDENTIFICATION_SPEC.md` → Uses → `NEURAL_ARCHITECTURE.md`

---

## 3. Infrastructure & Deployment

### AWS & Pipeline
*Cloud infrastructure and data flow*

| Document | Purpose | Key Insight |
|----------|---------|-------------|
| **[AWS_CARDMARKET_PIPELINE_ARCHITECTURE.md](./AWS_CARDMARKET_PIPELINE_ARCHITECTURE.md)** | **NEW** - ECS Fargate + Bright Data | Daily 2 AM schedule, ~$85/month |
| **[AWS_DEPLOYMENT_GUIDE.md](./AWS_DEPLOYMENT_GUIDE.md)** | **NEW** - Complete deployment guide | CDK, Docker, Secrets, Monitoring |
| **[AWS_SCRAPING_INFRASTRUCTURE.md](./AWS_SCRAPING_INFRASTRUCTURE.md)** | AWS service configuration | Lambda, ECS, S3, RDS setup |
| **[DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md)** | Generic deployment steps | Environment, secrets, monitoring |
| **[PIPELINE_ARCHITECTURE.md](./PIPELINE_ARCHITECTURE.md)** | Data flow design | ETL stages, validation |
| **[PIPELINE_INTEGRATION_ARCHITECTURE.md](./PIPELINE_INTEGRATION_ARCHITECTURE.md)** | Component integration | Module connections, data contracts |
| **[CARDMARKET_PIPELINE_ARCHITECTURE.md](./CARDMARKET_PIPELINE_ARCHITECTURE.md)** | CardMarket-specific pipeline | Scraper → Database → ML |

**Related (in cardforum/docs):**
| Document | Purpose |
|----------|---------|
| [AWS_DATA_PIPELINE_ARCHITECTURE.md](../../../docs/AWS_DATA_PIPELINE_ARCHITECTURE.md) | High-level AWS design |
| [RDS_ELEVATION_STRATEGY.md](../../../docs/RDS_ELEVATION_STRATEGY.md) | Database tiering strategy |
| [RDS_PRICE_ARCHIVE_INFRASTRUCTURE.md](../../../docs/RDS_PRICE_ARCHIVE_INFRASTRUCTURE.md) | Historical price storage |
| [S3_PRICE_PIPELINE_PLAN.md](../../../docs/S3_PRICE_PIPELINE_PLAN.md) | S3 data lake design |

**Relationships:**
- `AWS_SCRAPING_INFRASTRUCTURE.md` → Implements → `PIPELINE_ARCHITECTURE.md`
- `DEPLOYMENT_GUIDE.md` → Deploys → `PIPELINE_INTEGRATION_ARCHITECTURE.md`
- `CARDMARKET_PIPELINE_ARCHITECTURE.md` → Specializes → `PIPELINE_ARCHITECTURE.md`

---

## 4. Machine Learning

### ML System Design
*Model architecture and training*

| Document | Purpose | Key Insight |
|----------|---------|-------------|
| [ML_ARCHITECTURE_DESIGN.md](../../../docs/ML_ARCHITECTURE_DESIGN.md) | Multi-model paradigm | Specialized models per task |
| [AI_MODELS_FOR_TCG_ARBITRAGE.md](../../../docs/AI_MODELS_FOR_TCG_ARBITRAGE.md) | Value capture framework | Price prediction, arbitrage detection |
| [ALPHA_TRAINING_SESSION.md](../../../docs/ALPHA_TRAINING_SESSION.md) | First training session notes | Baseline metrics, learnings |

**Relationships:**
- `ML_ARCHITECTURE_DESIGN.md` → Consumes → `NEURAL_ARCHITECTURE.md` outputs
- `AI_MODELS_FOR_TCG_ARBITRAGE.md` → Business case for → `NEURAL_DEAL_IDENTIFICATION_SPEC.md`

---

## 5. Insights & Analysis

### Data Collection Status
*Current pipeline state and gaps*

| Document | Purpose | Key Insight |
|----------|---------|-------------|
| **[DATA_COLLECTION_STATUS.md](./DATA_COLLECTION_STATUS.md)** | Pipeline status report | Coverage gaps, next steps |
| **[EBAY_COLLECTION_INSIGHTS.md](./EBAY_COLLECTION_INSIGHTS.md)** | eBay results analysis | 3,906 listings, variant breakdown |
| **[TRAINING_PIPELINE_INSIGHTS.md](./TRAINING_PIPELINE_INSIGHTS.md)** | ML training readiness | 45-feature vectors, deal types |

### Research & Findings
*Discoveries and learnings*

| Document | Purpose | Key Insight |
|----------|---------|-------------|
| [DATA_PIPELINE_LEAKAGE_ANALYSIS.md](../../../docs/DATA_PIPELINE_LEAKAGE_ANALYSIS.md) | Data quality issues | Leakage sources, fixes |
| [DATA_SOURCES_INTEGRATION_PLAN.md](../../../docs/DATA_SOURCES_INTEGRATION_PLAN.md) | Multi-source integration | API priorities, fallbacks |
| [OPTCG_DATA_FLOW_ANALYSIS.md](../../../docs/OPTCG_DATA_FLOW_ANALYSIS.md) | OPTCG API understanding | Endpoints, data format |
| [ONE_PIECE_TCG_NAMING_CONVENTIONS.md](../../../docs/ONE_PIECE_TCG_NAMING_CONVENTIONS.md) | Card naming patterns | ID formats, variants |
| [INFRASTRUCTURE_INSIGHTS.md](../../../docs/INFRASTRUCTURE_INSIGHTS.md) | Key decisions log | Quick reference for critical choices |

---

## 6. Business & Strategy

### Commercial Planning
*Revenue and market strategy*

| Document | Purpose | Key Insight |
|----------|---------|-------------|
| [API_COMMERCIALIZATION_STRATEGY.md](../../../docs/API_COMMERCIALIZATION_STRATEGY.md) | API product strategy | Pricing tiers, SaaS model |
| [GLOBAL_TCG_MARKETPLACES.md](../../../docs/GLOBAL_TCG_MARKETPLACES.md) | Market research | Platform fees, regional dynamics |
| [TCG_ECOSYSTEM_ARCHITECTURE.md](../../../docs/TCG_ECOSYSTEM_ARCHITECTURE.md) | Full ecosystem design | All apps, integrations |
| [TCG_PRICE_INDEX_PLAN.md](../../../docs/TCG_PRICE_INDEX_PLAN.md) | TCG-100 index design | NASDAQ-style tracking |

---

## 7. Trade-In System (CardForum App)

### Shopify Integration
*Customer-facing trade-in application*

| Document | Purpose |
|----------|---------|
| [TRADE_IN_SYSTEM_SYNAPSE.md](../../../docs/TRADE_IN_SYSTEM_SYNAPSE.md) | System overview |
| [TRADE_IN_HISTORY_DATAFLOW.md](../../../docs/TRADE_IN_HISTORY_DATAFLOW.md) | Data flow design |
| [trade-in-submission-flow.md](../../../docs/trade-in-submission-flow.md) | Submission UX |
| [SHIPPING_IMPLEMENTATION_PLAN.md](../../../docs/SHIPPING_IMPLEMENTATION_PLAN.md) | Royal Mail integration |
| [PRICE_SYSTEM_FIX_PLAN.md](../../../docs/PRICE_SYSTEM_FIX_PLAN.md) | Pricing bug fixes |

---

## Cross-Reference Matrix

### By Component
| Component | Primary Doc | Related Docs |
|-----------|-------------|--------------|
| CardMarket Scraper | `CARDMARKET_SCRAPER_INFRASTRUCTURE.md` | Grimoire, Insights, Stack |
| TCGPlayer Scraper | `tcgplayer/docs/SCRAPER_ARCHITECTURE_INSIGHTS.md` | Hybrid Pipeline, Stack Analysis |
| SerpAPI/eBay | `SERPAPI_ALCHEMIST_GRIMOIRE.md` | Data Collection Insights |
| Neural Network | `NEURAL_ARCHITECTURE.md` | Embryo Vision, Nutrients, Genesis |
| AWS Pipeline | `AWS_SCRAPING_INFRASTRUCTURE.md` | Deployment, Pipeline Arch |
| ML Models | `ML_ARCHITECTURE_DESIGN.md` | AI Models, Deal Spec |
| Trade-In App | `TRADE_IN_SYSTEM_SYNAPSE.md` | History, Flow, Shipping |

### By Task
| Task | Start Here |
|------|------------|
| **Scrape CardMarket** | `CARDMARKET_BROWSER_SCRAPER_GUIDE.md` ← START HERE |
| **Scrape TCGPlayer** | `tcgplayer/docs/README.md` ← START HERE |
| Add new scraper | `CARDMARKET_ALCHEMIST_GRIMOIRE.md` → `SCRAPER_INFRASTRUCTURE.md` |
| Compare scrapers | `tcgplayer/docs/SCRAPER_ARCHITECTURE_INSIGHTS.md` |
| Fix data quality | `DATA_PIPELINE_LEAKAGE_ANALYSIS.md` → `INFRASTRUCTURE_INSIGHTS.md` |
| Train ML model | `NEURAL_EMBRYO_NUTRIENTS.md` → `ML_ARCHITECTURE_DESIGN.md` |
| Deploy changes | `DEPLOYMENT_GUIDE.md` → `AWS_SCRAPING_INFRASTRUCTURE.md` |
| Understand pricing | `ONE_PIECE_TCG_NAMING_CONVENTIONS.md` → `GLOBAL_TCG_MARKETPLACES.md` |

---

## File Locations Summary

### CardMarket Docs (this directory)
```
infrastructure/data-pipeline/scraper-dev/cardmarket/docs/
├── INDEX.md                              ← YOU ARE HERE (MASTER INDEX)
├── AWS_CARDMARKET_PIPELINE_ARCHITECTURE.md
├── AWS_DEPLOYMENT_GUIDE.md
├── AWS_SCRAPING_INFRASTRUCTURE.md
├── BRIGHTDATA_INTEGRATION_INSIGHTS.md    ← RECOMMENDED for CardMarket!
├── CARDMARKET_ALCHEMIST_GRIMOIRE.md
├── CARDMARKET_ARCHIVE_IMPLEMENTATION_INSIGHTS.md
├── CARDMARKET_BROWSER_SCRAPER_GUIDE.md
├── CARDMARKET_PIPELINE_ARCHITECTURE.md
├── CARDMARKET_SCRAPER_INFRASTRUCTURE.md
├── CARDMARKET_SCRAPING_INSIGHTS.md
├── CARDMARKET_STACK_ANALYSIS.md
├── DATA_COLLECTION_STATUS.md
├── DEPLOYMENT_GUIDE.md
├── EBAY_COLLECTION_INSIGHTS.md
├── NEURAL_ARCHITECTURE.md
├── NEURAL_EMBRYO_NUTRIENTS.md
├── NEURAL_EMBRYO_VISION.md
├── PIPELINE_ARCHITECTURE.md
├── PIPELINE_INTEGRATION_ARCHITECTURE.md
├── SERPAPI_ALCHEMIST_GRIMOIRE.md
├── TARGETED_SCRAPING_STRATEGY.md
├── TOOLS_AND_RESOURCES.md
└── TRAINING_PIPELINE_INSIGHTS.md
```

### TCGPlayer Docs
```
infrastructure/data-pipeline/scraper-dev/tcgplayer/docs/
├── README.md                              ← TCGPlayer sub-index
├── SCRAPER_ARCHITECTURE_INSIGHTS.md       ← NEW (2026-01-10) - Comparison doc
├── HYBRID_PIPELINE_ARCHITECTURE.md
├── AWS_INFRASTRUCTURE.md
├── ML_TRAINING_PREREQUISITES.md
├── MARKET_DATA_TRAINING_GUIDE.md
├── GAP_FILLING_IMPLEMENTATION_PLAN.md
├── TCGPLAYER_STACK_ANALYSIS.md
└── VALUE_EXTRACTION_FRAMEWORK.md
```

### eBay Docs
```
infrastructure/data-pipeline/scraper-dev/ebay/docs/
├── README.md
├── EBAY_PIPELINE_ARCHITECTURE.md
├── EBAY_PIPELINE_INFRASTRUCTURE.md
├── EFFICIENTNET_TRAINING_GUIDE.md
├── IMAGE_PIPELINE_README.md
├── QUERY_STRATEGY_GUIDE.md
└── SERPAPI_EBAY_INSIGHTS.md
```

### Main App Docs
```
cardforum/docs/
├── AI_MODELS_FOR_TCG_ARBITRAGE.md
├── API_COMMERCIALIZATION_STRATEGY.md
├── AWS_DATA_PIPELINE_ARCHITECTURE.md
├── DATA_COLLECTION_INSIGHTS.md
├── DATA_PIPELINE_LEAKAGE_ANALYSIS.md
├── DATA_SOURCES_INTEGRATION_PLAN.md
├── GLOBAL_TCG_MARKETPLACES.md
├── ML_ARCHITECTURE_DESIGN.md
├── NEURAL_DEAL_IDENTIFICATION_SPEC.md
├── NEURAL_EMBRYO_GENESIS.md
├── NEURAL_IMPLEMENTATION_PROGRESS.md
├── ONE_PIECE_TCG_NAMING_CONVENTIONS.md
├── RDS_ELEVATION_STRATEGY.md
├── TCG_ECOSYSTEM_ARCHITECTURE.md
├── TRAINING_DATA_COLLECTION_STRATEGY.md
└── ... (trade-in specific docs)
```

---

## How to Find This File

If you lose context, use any of these methods:

1. **Search**: `find . -name "INDEX.md"`
2. **From README**: Check `README.md` → links to `docs/INDEX.md`
3. **From any doc**: Most docs reference `→ See INDEX.md for navigation`
4. **CLAUDE.md**: Project instructions reference this index

---

*"In the labyrinth of documentation, the INDEX is the thread of Ariadne."*
