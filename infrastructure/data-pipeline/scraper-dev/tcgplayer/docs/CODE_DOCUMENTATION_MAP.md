# Code ↔ Documentation Symbiosis Map

> **Master Reference** for navigating between code files and their documentation.
>
> **Philosophy**: Code and documentation should reference each other bidirectionally,
> creating a symbiotic relationship where neither exists in isolation.

**Last Updated:** 2026-01-10
**Location:** `infrastructure/data-pipeline/scraper-dev/tcgplayer/docs/CODE_DOCUMENTATION_MAP.md`

---

## Quick Reference

### Find Documentation for Code

| If you're reading... | Look at... |
|---------------------|------------|
| `tcgplayer-search-api-scraper.ts` | [SCRAPER_ARCHITECTURE_INSIGHTS.md](./SCRAPER_ARCHITECTURE_INSIGHTS.md) |
| `tcgplayer-brightdata-scraper.ts` | [SCRAPER_ARCHITECTURE_INSIGHTS.md](./SCRAPER_ARCHITECTURE_INSIGHTS.md) (Section 7) |
| `hybrid-tcgplayer-pipeline.ts` | [HYBRID_PIPELINE_ARCHITECTURE.md](./HYBRID_PIPELINE_ARCHITECTURE.md) |
| `cardmarket-collector.ts` | [SCRAPER_ARCHITECTURE_INSIGHTS.md](./SCRAPER_ARCHITECTURE_INSIGHTS.md) + CardMarket docs |
| `daily-archive-local.ts` | [AWS_INFRASTRUCTURE.md](./AWS_INFRASTRUCTURE.md) |
| `justtcg-client.ts` | [HYBRID_PIPELINE_ARCHITECTURE.md](./HYBRID_PIPELINE_ARCHITECTURE.md) |

### Find Code for Documentation

| If you're reading... | Look at... |
|---------------------|------------|
| SCRAPER_ARCHITECTURE_INSIGHTS.md | `src/scrapers/*.ts`, `src/collectors/*.ts` |
| HYBRID_PIPELINE_ARCHITECTURE.md | `src/pipeline/hybrid-tcgplayer-pipeline.ts` |
| AWS_INFRASTRUCTURE.md | `scripts/daily-archive-local.ts`, `src/lambda/*.ts` |
| ML_TRAINING_PREREQUISITES.md | `src/storage/database-loader.ts` |
| TCGPLAYER_STACK_ANALYSIS.md | `scripts/test-tcgplayer-api*.ts` |

---

## Complete Code → Documentation Map

### Scrapers (`src/scrapers/`)

| Code File | Primary Documentation | Sections |
|-----------|----------------------|----------|
| [`tcgplayer-search-api-scraper.ts`](../src/scrapers/tcgplayer-search-api-scraper.ts) | [SCRAPER_ARCHITECTURE_INSIGHTS.md](./SCRAPER_ARCHITECTURE_INSIGHTS.md) | 1, 2.3, 2.4, 3, 9 |
| [`tcgplayer-brightdata-scraper.ts`](../src/scrapers/tcgplayer-brightdata-scraper.ts) | [SCRAPER_ARCHITECTURE_INSIGHTS.md](./SCRAPER_ARCHITECTURE_INSIGHTS.md) | 1, 7.2, 7.3 |
| [`tcgplayer-scraper.ts`](../src/scrapers/tcgplayer-scraper.ts) | [TCGPLAYER_STACK_ANALYSIS.md](./TCGPLAYER_STACK_ANALYSIS.md) | Legacy reference |

### Collectors (`src/collectors/`)

| Code File | Primary Documentation | Cross-References |
|-----------|----------------------|------------------|
| [`cardmarket-collector.ts`](../src/collectors/cardmarket-collector.ts) | [SCRAPER_ARCHITECTURE_INSIGHTS.md](./SCRAPER_ARCHITECTURE_INSIGHTS.md) | CardMarket: INDEX.md, CARDMARKET_SCRAPER_INFRASTRUCTURE.md |
| [`reddit-collector.ts`](../src/collectors/reddit-collector.ts) | [DATA_SOURCES_INTEGRATION_PLAN.md](../../../../docs/DATA_SOURCES_INTEGRATION_PLAN.md) | Social signals |
| [`youtube-collector.ts`](../src/collectors/youtube-collector.ts) | [DATA_SOURCES_INTEGRATION_PLAN.md](../../../../docs/DATA_SOURCES_INTEGRATION_PLAN.md) | Content tracking |
| [`limitless-collector.ts`](../src/collectors/limitless-collector.ts) | [DATA_SOURCES_INTEGRATION_PLAN.md](../../../../docs/DATA_SOURCES_INTEGRATION_PLAN.md) | Tournament data |

### Pipeline (`src/pipeline/`)

| Code File | Primary Documentation | Sections |
|-----------|----------------------|----------|
| [`hybrid-tcgplayer-pipeline.ts`](../src/pipeline/hybrid-tcgplayer-pipeline.ts) | [HYBRID_PIPELINE_ARCHITECTURE.md](./HYBRID_PIPELINE_ARCHITECTURE.md) | Full document |
| [`orchestrator.ts`](../src/pipeline/orchestrator.ts) | [AWS_INFRASTRUCTURE.md](./AWS_INFRASTRUCTURE.md) | Lambda orchestration |
| [`transformer.ts`](../src/pipeline/transformer.ts) | [HYBRID_PIPELINE_ARCHITECTURE.md](./HYBRID_PIPELINE_ARCHITECTURE.md) | Data transformation |
| [`validator.ts`](../src/pipeline/validator.ts) | [ML_TRAINING_PREREQUISITES.md](./ML_TRAINING_PREREQUISITES.md) | Data validation |
| [`merger.ts`](../src/pipeline/merger.ts) | [HYBRID_PIPELINE_ARCHITECTURE.md](./HYBRID_PIPELINE_ARCHITECTURE.md) | Data deduplication |

### APIs (`src/apis/`)

| Code File | Primary Documentation | Notes |
|-----------|----------------------|-------|
| [`justtcg-client.ts`](../src/apis/justtcg-client.ts) | [HYBRID_PIPELINE_ARCHITECTURE.md](./HYBRID_PIPELINE_ARCHITECTURE.md) | Primary TCGPlayer source |
| [`optcg-client.ts`](../src/apis/optcg-client.ts) | [../../docs/DATA_SOURCES_INTEGRATION_PLAN.md](../../../../docs/DATA_SOURCES_INTEGRATION_PLAN.md) | One Piece TCG API |
| [`pokemon-client.ts`](../src/apis/pokemon-client.ts) | [../../docs/DATA_SOURCES_INTEGRATION_PLAN.md](../../../../docs/DATA_SOURCES_INTEGRATION_PLAN.md) | Pokemon TCG API |
| [`scryfall-client.ts`](../src/apis/scryfall-client.ts) | [../../docs/DATA_SOURCES_INTEGRATION_PLAN.md](../../../../docs/DATA_SOURCES_INTEGRATION_PLAN.md) | MTG Scryfall API |
| [`base-client.ts`](../src/apis/base-client.ts) | [SCRAPER_ARCHITECTURE_INSIGHTS.md](./SCRAPER_ARCHITECTURE_INSIGHTS.md) | Shared utilities |

### Storage (`src/storage/`)

| Code File | Primary Documentation | Notes |
|-----------|----------------------|-------|
| [`database-loader.ts`](../src/storage/database-loader.ts) | [AWS_INFRASTRUCTURE.md](./AWS_INFRASTRUCTURE.md) | RDS operations |
| [`s3-client.ts`](../src/storage/s3-client.ts) | [AWS_INFRASTRUCTURE.md](./AWS_INFRASTRUCTURE.md) | S3 archival |

### Lambda (`src/lambda/`)

| Code File | Primary Documentation | Notes |
|-----------|----------------------|-------|
| [`orchestrator-handler.ts`](../src/lambda/orchestrator-handler.ts) | [AWS_INFRASTRUCTURE.md](./AWS_INFRASTRUCTURE.md) | Step Functions |
| [`fetch-handler.ts`](../src/lambda/fetch-handler.ts) | [AWS_INFRASTRUCTURE.md](./AWS_INFRASTRUCTURE.md) | Data fetching |
| [`transform-handler.ts`](../src/lambda/transform-handler.ts) | [AWS_INFRASTRUCTURE.md](./AWS_INFRASTRUCTURE.md) | ETL transform |
| [`load-handler.ts`](../src/lambda/load-handler.ts) | [AWS_INFRASTRUCTURE.md](./AWS_INFRASTRUCTURE.md) | Database loading |

### Scripts (`scripts/`)

| Script | Primary Documentation | Purpose |
|--------|----------------------|---------|
| [`daily-archive-local.ts`](../scripts/daily-archive-local.ts) | [AWS_INFRASTRUCTURE.md](./AWS_INFRASTRUCTURE.md) | Local daily archive |
| [`test-search-api-scraper.ts`](../scripts/test-search-api-scraper.ts) | [SCRAPER_ARCHITECTURE_INSIGHTS.md](./SCRAPER_ARCHITECTURE_INSIGHTS.md) | Search API testing |
| [`test-tcgplayer-api-v2.ts`](../scripts/test-tcgplayer-api-v2.ts) | [TCGPLAYER_STACK_ANALYSIS.md](./TCGPLAYER_STACK_ANALYSIS.md) | API discovery |
| [`test-brightdata-scraper.ts`](../scripts/test-brightdata-scraper.ts) | [SCRAPER_ARCHITECTURE_INSIGHTS.md](./SCRAPER_ARCHITECTURE_INSIGHTS.md) | Bright Data testing |
| [`test-data-sources.ts`](../scripts/test-data-sources.ts) | [HYBRID_PIPELINE_ARCHITECTURE.md](./HYBRID_PIPELINE_ARCHITECTURE.md) | Data validation |

---

## Documentation → Code Map

### Architecture Documents

| Documentation | Implements | Tests |
|--------------|------------|-------|
| [SCRAPER_ARCHITECTURE_INSIGHTS.md](./SCRAPER_ARCHITECTURE_INSIGHTS.md) | `tcgplayer-search-api-scraper.ts`, `cardmarket-collector.ts` | `test-search-api-scraper.ts` |
| [HYBRID_PIPELINE_ARCHITECTURE.md](./HYBRID_PIPELINE_ARCHITECTURE.md) | `hybrid-tcgplayer-pipeline.ts`, `justtcg-client.ts` | `test-data-sources.ts` |
| [AWS_INFRASTRUCTURE.md](./AWS_INFRASTRUCTURE.md) | `src/lambda/*.ts`, `src/storage/*.ts` | `daily-archive-local.ts` |

### Analysis Documents

| Documentation | Discovery Scripts | Related Code |
|--------------|-------------------|--------------|
| [TCGPLAYER_STACK_ANALYSIS.md](./TCGPLAYER_STACK_ANALYSIS.md) | `test-tcgplayer-api*.ts` | `tcgplayer-search-api-scraper.ts` |
| [VALUE_EXTRACTION_FRAMEWORK.md](./VALUE_EXTRACTION_FRAMEWORK.md) | - | All collectors |

### Training Documents

| Documentation | Data Sources | Validation |
|--------------|--------------|------------|
| [ML_TRAINING_PREREQUISITES.md](./ML_TRAINING_PREREQUISITES.md) | `database-loader.ts` | `validator.ts` |
| [MARKET_DATA_TRAINING_GUIDE.md](./MARKET_DATA_TRAINING_GUIDE.md) | All scrapers | `transformer.ts` |
| [GAP_FILLING_IMPLEMENTATION_PLAN.md](./GAP_FILLING_IMPLEMENTATION_PLAN.md) | `gap-filling-entry.ts` | - |

---

## Symbiotic Pattern

### In Code Files

Every significant code file should include a documentation header:

```typescript
/**
 * [Module Description]
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * DOCUMENTATION REFERENCES (Symbiotic Code ↔ Docs)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * @see {@link file://../docs/PRIMARY_DOC.md} - Primary documentation
 *   - Section X: Relevant section
 *   - Section Y: Another relevant section
 *
 * @see {@link file://../docs/SECONDARY_DOC.md} - Related documentation
 *
 * Related Code Files:
 * @see {@link file://./related-module.ts} - Description
 * @see {@link file://../other/module.ts} - Description
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * @module [module-name]
 * @since [date]
 */
```

### In Documentation Files

Every documentation file should include:

1. **Navigation header** linking to parent/sibling docs
2. **Code Files Analyzed** section linking to implementations
3. **Related Code Files** section in navigation footer

---

## Cross-Project References

### TCGPlayer → CardMarket

| TCGPlayer File | CardMarket Equivalent | Purpose |
|----------------|----------------------|---------|
| `tcgplayer-search-api-scraper.ts` | `cardmarket-browser-scraper.ts` | Platform scraping |
| `SCRAPER_ARCHITECTURE_INSIGHTS.md` | `CARDMARKET_SCRAPER_INFRASTRUCTURE.md` | Architecture |
| `daily-archive-local.ts` | `daily-cardmarket-archive.ts` | Daily archival |

### TCGPlayer → Main App (cardforum)

| TCGPlayer File | Main App File | Purpose |
|----------------|--------------|---------|
| All scrapers | `app/lib/prices.server.ts` | Price sync |
| Database operations | `prisma/schema.prisma` | Data models |
| ML data | `app/lib/neural/` | Neural network |

---

## Navigation

**Up:**
- [TCGPlayer Index](./README.md)
- [Master Index](../../cardmarket/docs/INDEX.md)

**Related:**
- [SCRAPER_ARCHITECTURE_INSIGHTS.md](./SCRAPER_ARCHITECTURE_INSIGHTS.md) - Main architecture doc
- [Scraper Hub README](../../README.md) - Multi-platform overview

---

*"Code without documentation is a mystery; documentation without code is fiction."*
