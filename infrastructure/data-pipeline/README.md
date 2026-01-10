# Data Pipeline Infrastructure

> **Multi-Platform TCG Data Collection and Processing**
>
> This directory contains all infrastructure for collecting, processing, and storing TCG price data.

**Location:** `infrastructure/data-pipeline/`

---

## Directory Structure

```
data-pipeline/
├── README.md                 ← YOU ARE HERE
├── docs/                     ← Pipeline-level documentation
│   └── DATA_QUALITY_PIPELINE_PLAN.md
│
└── scraper-dev/              ← Platform scrapers
    ├── README.md             ← Scraper hub overview
    ├── cardmarket/           ← EU marketplace
    │   └── docs/INDEX.md     ← MASTER DOCUMENTATION INDEX
    ├── tcgplayer/            ← US marketplace
    │   └── docs/README.md    ← TCGPlayer sub-index
    └── ebay/                  ← Historical prices
        └── docs/README.md    ← eBay sub-index
```

---

## Quick Links

| Destination | Link | Description |
|-------------|------|-------------|
| **Master Index** | [cardmarket/docs/INDEX.md](./scraper-dev/cardmarket/docs/INDEX.md) | All documentation starts here |
| **Scraper Hub** | [scraper-dev/README.md](./scraper-dev/README.md) | Platform-specific scrapers |
| **TCGPlayer** | [tcgplayer/docs/README.md](./scraper-dev/tcgplayer/docs/README.md) | US marketplace (Search API) |
| **CardMarket** | [cardmarket/docs/INDEX.md](./scraper-dev/cardmarket/docs/INDEX.md) | EU marketplace (Bright Data) |
| **eBay** | [ebay/docs/README.md](./scraper-dev/ebay/docs/README.md) | Historical sold prices |

---

## Documentation Navigation

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      DOCUMENTATION NAVIGATION MAP                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  cardforum/docs/                                                            │
│  └── DATA_PIPELINE_INDEX.md ──────────────────────────────┐                 │
│                                                            │                 │
│  infrastructure/data-pipeline/                             │                 │
│  ├── README.md ← YOU ARE HERE ◀────────────────────────────┤                 │
│  │                                                         │                 │
│  └── scraper-dev/                                          │                 │
│      ├── README.md ────────────────────────────────────────┤                 │
│      │                                                     ▼                 │
│      ├── cardmarket/docs/INDEX.md ◀══════════════════════════               │
│      │       ▲         MASTER INDEX                                         │
│      │       │                                                              │
│      ├── tcgplayer/docs/README.md ◀──────────────────────────               │
│      │       │         TCGPlayer Sub-Index                                  │
│      │       │                                                              │
│      └── ebay/docs/README.md ◀───────────────────────────────               │
│                        eBay Sub-Index                                       │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Data Flow Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         DATA PIPELINE OVERVIEW                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   COLLECTION                    PROCESSING                  OUTPUT          │
│                                                                              │
│   ┌───────────┐                ┌───────────┐              ┌───────────┐     │
│   │ CardMarket│ ──┐            │ Normalize │              │ PostgreSQL│     │
│   │  (EU/EUR) │   │            │ & Validate│ ──────────▶  │   (RDS)   │     │
│   └───────────┘   │   ┌──────▶ │           │              └───────────┘     │
│                   │   │        └───────────┘                    │           │
│   ┌───────────┐   │   │                                         │           │
│   │ TCGPlayer │ ──┼───┤                                         ▼           │
│   │  (US/USD) │   │   │        ┌───────────┐              ┌───────────┐     │
│   └───────────┘   │   │        │  Currency │              │ S3 Archive│     │
│                   │   └──────▶ │ Conversion│ ──────────▶  │  (Daily)  │     │
│   ┌───────────┐   │            │           │              └───────────┘     │
│   │   eBay    │ ──┘            └───────────┘                    │           │
│   │(Historical)│                                                │           │
│   └───────────┘                                                 ▼           │
│                                                            ┌───────────┐    │
│                                                            │ ML Models │    │
│                                                            │& Neural N.│    │
│                                                            └───────────┘    │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Related Documentation

### Up (Parent Level)
- [infrastructure/](../) - All infrastructure components
- [cardforum/](../../) - Main application

### Down (Child Level)
- [scraper-dev/](./scraper-dev/) - Scraper implementations
- [docs/](./docs/) - Pipeline documentation

### Sibling Documentation
- [cardforum/docs/](../../docs/) - Application documentation
- [cardforum/docs/DATA_PIPELINE_INDEX.md](../../docs/DATA_PIPELINE_INDEX.md) - Pipeline entry point

---

*"From multiple sources to unified insights."*
