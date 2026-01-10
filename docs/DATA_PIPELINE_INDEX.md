# Data Pipeline Documentation

> **Quick Reference**: This file points to the comprehensive documentation index for the TCG data pipeline.

**Last Updated:** 2026-01-10

---

## Documentation Hierarchy

```
cardforum/docs/                           ← YOU ARE HERE
├── DATA_PIPELINE_INDEX.md                ← This file (entry point)
│
└── infrastructure/data-pipeline/scraper-dev/
    ├── README.md                         ← Scraper hub overview
    ├── cardmarket/docs/INDEX.md          ← MASTER INDEX (all platforms)
    ├── tcgplayer/docs/README.md          ← TCGPlayer sub-index
    └── ebay/docs/README.md               ← eBay sub-index
```

---

## Main Documentation Hub

**[>>> Go to Full Documentation Index <<<](../infrastructure/data-pipeline/scraper-dev/cardmarket/docs/INDEX.md)**

The master documentation index is located at:
```
infrastructure/data-pipeline/scraper-dev/cardmarket/docs/INDEX.md
```

---

## Platform Quick Links

### CardMarket (EU Marketplace)
- **[Master Index](../infrastructure/data-pipeline/scraper-dev/cardmarket/docs/INDEX.md)** - Start here
- [Bright Data Integration](../infrastructure/data-pipeline/scraper-dev/cardmarket/docs/BRIGHTDATA_INTEGRATION_INSIGHTS.md) - Recommended approach
- [Browser Scraper Guide](../infrastructure/data-pipeline/scraper-dev/cardmarket/docs/CARDMARKET_BROWSER_SCRAPER_GUIDE.md) - Fallback method
- [CardMarket Alchemist Grimoire](../infrastructure/data-pipeline/scraper-dev/cardmarket/docs/CARDMARKET_ALCHEMIST_GRIMOIRE.md)

### TCGPlayer (US Marketplace) - NEW
- **[TCGPlayer Index](../infrastructure/data-pipeline/scraper-dev/tcgplayer/docs/README.md)** - Start here
- [Scraper Architecture Insights](../infrastructure/data-pipeline/scraper-dev/tcgplayer/docs/SCRAPER_ARCHITECTURE_INSIGHTS.md) - TCGPlayer vs CardMarket comparison
- [Hybrid Pipeline Architecture](../infrastructure/data-pipeline/scraper-dev/tcgplayer/docs/HYBRID_PIPELINE_ARCHITECTURE.md) - JustTCG + Search API

### eBay (Historical Prices)
- **[eBay Index](../infrastructure/data-pipeline/scraper-dev/ebay/docs/README.md)** - Start here
- [SerpAPI/eBay Collection](../infrastructure/data-pipeline/scraper-dev/cardmarket/docs/SERPAPI_ALCHEMIST_GRIMOIRE.md)
- [eBay Pipeline Architecture](../infrastructure/data-pipeline/scraper-dev/ebay/docs/EBAY_PIPELINE_ARCHITECTURE.md)

---

## Quick Links

### Data Sources
- [CardMarket Scraper Infrastructure](../infrastructure/data-pipeline/scraper-dev/cardmarket/docs/CARDMARKET_SCRAPER_INFRASTRUCTURE.md)
- [TCGPlayer Search API](../infrastructure/data-pipeline/scraper-dev/tcgplayer/docs/SCRAPER_ARCHITECTURE_INSIGHTS.md) - NEW
- [SerpAPI/eBay Collection (Grimoire)](../infrastructure/data-pipeline/scraper-dev/cardmarket/docs/SERPAPI_ALCHEMIST_GRIMOIRE.md)
- [CardMarket Alchemist Grimoire](../infrastructure/data-pipeline/scraper-dev/cardmarket/docs/CARDMARKET_ALCHEMIST_GRIMOIRE.md)

### Neural Network
- [Neural Architecture](../infrastructure/data-pipeline/scraper-dev/cardmarket/docs/NEURAL_ARCHITECTURE.md)
- [Neural Embryo Genesis](./NEURAL_EMBRYO_GENESIS.md)
- [Neural Deal Identification](./NEURAL_DEAL_IDENTIFICATION_SPEC.md)

### Infrastructure
- [AWS Data Pipeline](./AWS_DATA_PIPELINE_ARCHITECTURE.md)
- [RDS Elevation Strategy](./RDS_ELEVATION_STRATEGY.md)
- [Deployment Guide](../infrastructure/data-pipeline/scraper-dev/cardmarket/docs/DEPLOYMENT_GUIDE.md)

### Machine Learning
- [ML Architecture Design](./ML_ARCHITECTURE_DESIGN.md)
- [AI Models for Arbitrage](./AI_MODELS_FOR_TCG_ARBITRAGE.md)
- [Training Data Strategy](./TRAINING_DATA_COLLECTION_STRATEGY.md)

### Business
- [API Commercialization](./API_COMMERCIALIZATION_STRATEGY.md)
- [Global Marketplaces](./GLOBAL_TCG_MARKETPLACES.md)
- [TCG Ecosystem](./TCG_ECOSYSTEM_ARCHITECTURE.md)

---

## File Discovery

If you lose context about documentation locations:

1. **From this directory**: Look at this file → follow links above
2. **From scraper directory**: Look at `docs/INDEX.md`
3. **Search**: `find . -name "INDEX.md" -o -name "*_INDEX.md"`
4. **CLAUDE.md**: Contains project context and key file references

---

*This file exists to ensure the documentation index is discoverable from multiple entry points.*
