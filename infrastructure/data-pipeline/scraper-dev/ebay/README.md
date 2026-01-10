# eBay Listing Data Extraction Pipeline

> TCG sold listing data extraction from eBay for market analysis

## Overview

This pipeline extracts sold/completed listing data from eBay to support:
- Historical price analysis for trading cards
- Market velocity tracking
- Cross-platform arbitrage (eBay vs TCGplayer)
- Condition-based pricing insights

## Documentation

- **[Infrastructure Plan](docs/EBAY_PIPELINE_INFRASTRUCTURE.md)** - AWS architecture, data sources, cost estimates

## Directory Structure

```
ebay/
├── README.md
├── docs/
│   └── EBAY_PIPELINE_INFRASTRUCTURE.md
├── src/
│   ├── collectors/      # Data extraction modules
│   ├── processors/      # Transform and load
│   └── utils/           # Shared utilities
├── config/
│   └── games.ts         # TCG category configuration
└── prisma/
    └── schema.prisma    # Database schema
```

## Quick Start

```bash
# Install dependencies
npm install

# Set environment variables
export SERPAPI_API_KEY="your-key"
export EBAY_APP_ID="your-app-id"
export DATABASE_URL="postgresql://..."

# Run locally
npx tsx src/index.ts
```

## Data Sources

| Source | Data Type | Status |
|--------|-----------|--------|
| SerpApi | Sold listings | Primary |
| eBay Browse API | Active listings | Secondary |
| Apify | Backup/validation | Fallback |

## Cost Estimate

~$115/month including:
- SerpApi Small Business ($50)
- AWS infrastructure (~$45)
- Apify backup ($20)

## Status

🔴 **Planning Phase** - Infrastructure research complete, implementation pending.
