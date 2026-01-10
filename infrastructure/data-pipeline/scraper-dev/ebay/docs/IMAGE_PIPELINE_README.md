# Image Collection Pipeline

> Automated eBay sold listing image collection for One Piece TCG ML training.

## Overview

This pipeline collects sold listing images from eBay via SerpApi and stores them in S3, organized for ML training on:
- **Card Identification** - Match images to card database
- **Condition Assessment** - Detect wear, whitening, scratches
- **Variant Detection** - Parallel vs standard foil patterns
- **Graded Card Recognition** - PSA/CGC/BGS slab detection

## Quick Start

```bash
# Install dependencies
npm install

# Dry run test (no S3 uploads)
npm run collect:dry -- --queries=sec_en --max-pages=1

# Real collection (uploads to S3)
npm run collect -- --queries=sec_en --verbose

# View stats
npm run stats
```

## S3 Bucket Structure

```
s3://tcg-training-data/onepiece-tcg/
├── images/
│   ├── raw/
│   │   ├── 500/              # 500px images (card identification)
│   │   │   ├── OP01-120/     # Organized by card ID
│   │   │   │   ├── {ebay_item_id}.jpg
│   │   ├── 1600/             # 1600px images (condition analysis)
│   │   │   ├── OP01-120/
│   │   │   │   ├── {ebay_item_id}.jpg
├── metadata/
│   ├── listings/             # Raw listing JSONL files
│   │   ├── 2026-01-08/
│   │   │   ├── sec_en.jsonl
│   ├── manifest.json         # Master index + stats
│   ├── labels/               # ML training labels
│   │   ├── card_identification.json
│   │   ├── variant_detection.json
├── stats/
│   ├── daily/
│   │   ├── 2026-01-08.json
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `npm run collect` | Run collection with default settings |
| `npm run collect:dry` | Dry run (download but don't upload) |
| `npm run collect:priority1` | Run high-priority queries only |
| `npm run collect:all` | Run all queries |
| `npm run stats` | View collection statistics |
| `npm run labels` | Generate training labels |

### CLI Options

```bash
npx tsx src/collect-images.ts [options]

Options:
  --queries=name1,name2    Run specific queries
  --priority=N             Run queries with priority <= N
  --max-pages=N            Max pages per query (default: 5)
  --resolutions=500,1600   Image resolutions to download
  --dry-run                Don't upload to S3
  --verbose, -v            Show detailed progress
  --stats                  Show collection statistics only
  --generate-labels        Generate training labels
```

## Available Queries

| Name | Priority | Description | Expected Volume |
|------|----------|-------------|-----------------|
| `sec_parallel_en` | 1 | SEC Parallel English | 150 |
| `sec_en` | 1 | SEC English | 1,500 |
| `parallel_en` | 1 | Parallel/Alt Art English | 900 |
| `manga_en` | 2 | Manga Art English | 100 |
| `manga_jp` | 2 | Manga Art Japanese | 50 |
| `treasure_rare` | 2 | Treasure Rare | 200 |
| `sp_special` | 2 | SP Special Art | 200 |
| `psa_10` | 3 | PSA 10 Graded | 300 |
| `psa_9` | 3 | PSA 9 Graded | 200 |
| `cgc_graded` | 3 | CGC Graded | 100 |
| `sec_jp` | 4 | SEC Japanese | 250 |
| `parallel_jp` | 4 | Parallel Japanese | 350 |

## Image Metadata

Each image in S3 includes metadata tags:

| Tag | Description |
|-----|-------------|
| `ebay-item-id` | Unique eBay listing ID |
| `card-id` | Extracted card number (e.g., OP01-120) |
| `variant-type` | parallel, sp, manga, sec, etc. |
| `language` | EN, JP, or UNKNOWN |
| `graded` | true/false |
| `price-usd` | Sale price |
| `collected-at` | ISO timestamp |

## Training Labels Format

### Card Identification (`card_identification.json`)

```json
[
  {
    "imageS3Key": "onepiece-tcg/images/raw/500/OP01-120/123456789.jpg",
    "cardId": "OP01-120",
    "setCode": "OP01",
    "cardNumber": "120",
    "confidence": 0.95
  }
]
```

### Variant Detection (`variant_detection.json`)

```json
[
  {
    "imageS3Key": "onepiece-tcg/images/raw/500/OP01-120/123456789.jpg",
    "variantType": "sec_parallel",
    "confidence": 0.85
  }
]
```

## Cost Estimates

### SerpApi (Big Data Tier: $275/mo)

| Metric | Value |
|--------|-------|
| Searches/month | 30,000 |
| Results/search | 200 |
| **Max listings/month** | **6,000,000** |

### AWS S3 Storage

| Resolution | Size/Image | 100K Images | Cost/Month |
|------------|------------|-------------|------------|
| 500px | ~50KB | 5 GB | ~$0.12 |
| 1600px | ~200KB | 20 GB | ~$0.46 |

### Recommended Collection Schedule

```
Daily (27 searches):
├── Morning: Priority 1 queries (SEC, Parallel)
├── Afternoon: Priority 2 queries (Manga, TR, SP)
└── Evening: Priority 3-4 (Graded, Japanese)

Monthly Volume: ~810 searches → ~100K+ images
```

## Environment Variables

```bash
# .env file
SERPAPI_API_KEY=your-serpapi-key
S3_BUCKET=tcg-training-data
AWS_REGION=us-east-1
```

## Pipeline Architecture

```
┌─────────────────┐
│   SerpApi       │ ─── Fetch sold listings (rate limited)
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   Parser        │ ─── Extract card ID, variant, condition
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   Collector     │ ─── Download images from eBay CDN
└────────┬────────┘     (concurrent, with retries)
         │
         ▼
┌─────────────────┐
│   Storage       │ ─── Upload to S3 with metadata
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   Manifest      │ ─── Track stats, deduplication
└─────────────────┘
```

## Files

| File | Description |
|------|-------------|
| `src/pipeline/config.ts` | Configuration and query definitions |
| `src/pipeline/types.ts` | TypeScript type definitions |
| `src/pipeline/parser.ts` | Title parsing and card extraction |
| `src/pipeline/collector.ts` | SerpApi fetch and image download |
| `src/pipeline/storage.ts` | S3 operations and manifest management |
| `src/pipeline/pipeline.ts` | Main orchestrator |
| `src/collect-images.ts` | CLI entry point |

## Deduplication

The pipeline tracks processed eBay item IDs in the manifest to avoid re-downloading the same images. This is persisted across runs.

To reset and re-collect all images:
1. Delete the manifest: `aws s3 rm s3://tcg-training-data/onepiece-tcg/metadata/manifest.json`
2. Run collection again

## Error Handling

- **SerpApi errors**: Logged and skipped, continues with next query
- **Image download failures**: Retried 3x with exponential backoff
- **S3 upload failures**: Logged, image skipped
- Daily stats track error counts for monitoring
