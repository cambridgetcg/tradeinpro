# eBay Sold Listings Pipeline - Architecture & Engineering Guide

> **Version**: 2.0.0
> **Last Updated**: 2026-01-09
> **Status**: Production Ready

---

## Executive Summary

This document provides comprehensive architectural documentation for the eBay sold listings data collection pipeline. The pipeline collects historical sales data from eBay via SerpAPI to build training datasets for ML models targeting TCG card identification, variant detection, condition assessment, and price prediction.

---

## 1. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                        EBAY DATA COLLECTION PIPELINE                                 │
│                        One Piece TCG Training Data                                   │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│   ┌──────────────┐                                                                  │
│   │    CLI       │  npx tsx src/run-1year-collection.ts                            │
│   │   Runner     │  --max-searches=641 --verbose                                   │
│   └──────┬───────┘                                                                  │
│          │                                                                          │
│          ▼                                                                          │
│   ┌──────────────────────────────────────────────────────────────────────────────┐ │
│   │                          ORCHESTRATION LAYER                                  │ │
│   │  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐   │ │
│   │  │   Query     │    │   Rate      │    │   Progress  │    │   Error     │   │ │
│   │  │  Scheduler  │───▶│  Limiter    │───▶│   Tracker   │───▶│  Handler    │   │ │
│   │  │             │    │ (2000ms)    │    │             │    │             │   │ │
│   │  └─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘   │ │
│   └──────────────────────────────────────────────────────────────────────────────┘ │
│          │                                                                          │
│          ▼                                                                          │
│   ┌──────────────────────────────────────────────────────────────────────────────┐ │
│   │                           DATA COLLECTION LAYER                               │ │
│   │                                                                               │ │
│   │   ┌─────────────────┐          ┌─────────────────┐                          │ │
│   │   │    SerpAPI      │          │   eBay CDN      │                          │ │
│   │   │   Collector     │          │  Image Fetch    │                          │ │
│   │   │                 │          │                 │                          │ │
│   │   │  show_only=Sold │          │ i.ebayimg.com   │                          │ │
│   │   │  _ipg=200       │          │ /s-l{500,1600}  │                          │ │
│   │   └────────┬────────┘          └────────┬────────┘                          │ │
│   │            │                            │                                    │ │
│   │            ▼                            ▼                                    │ │
│   │   ┌─────────────────────────────────────────────────────────────────────┐   │ │
│   │   │                    PARSING & TRANSFORMATION                          │   │ │
│   │   │                                                                      │   │ │
│   │   │   SerpApiListing ──▶ parseListing() ──▶ ParsedListing               │   │ │
│   │   │                                                                      │   │ │
│   │   │   ┌────────────────┐  ┌────────────────┐  ┌────────────────┐        │   │ │
│   │   │   │ extractCardId  │  │ detectVariant  │  │ extractCurrency│        │   │ │
│   │   │   │ OP01-120       │  │ parallel/manga │  │ USD/GBP/EUR    │        │   │ │
│   │   │   └────────────────┘  └────────────────┘  └────────────────┘        │   │ │
│   │   │                                                                      │   │ │
│   │   │   ┌────────────────┐  ┌────────────────┐  ┌────────────────┐        │   │ │
│   │   │   │ detectLanguage │  │ extractGrading │  │ generateImgURLs│        │   │ │
│   │   │   │ EN/JP/UNKNOWN  │  │ PSA/CGC/BGS    │  │ 140/300/500/   │        │   │ │
│   │   │   │                │  │                │  │ 1600           │        │   │ │
│   │   │   └────────────────┘  └────────────────┘  └────────────────┘        │   │ │
│   │   └─────────────────────────────────────────────────────────────────────┘   │ │
│   └──────────────────────────────────────────────────────────────────────────────┘ │
│          │                                                                          │
│          ▼                                                                          │
│   ┌──────────────────────────────────────────────────────────────────────────────┐ │
│   │                            STORAGE LAYER (S3)                                 │ │
│   │                                                                               │ │
│   │   s3://tcg-training-data/onepiece-tcg-1year/                                 │ │
│   │   │                                                                          │ │
│   │   ├── images/                                                                │ │
│   │   │   └── raw/                                                               │ │
│   │   │       ├── 500/{cardId}/{ebayItemId}.jpg     # Card ID resolution        │ │
│   │   │       └── 1600/{cardId}/{ebayItemId}.jpg    # Condition resolution      │ │
│   │   │                                                                          │ │
│   │   ├── metadata/                                                              │ │
│   │   │   ├── listings/{date}/{queryName}.jsonl     # Raw listing data          │ │
│   │   │   ├── manifest.json                         # Master index              │ │
│   │   │   └── labels/                               # ML training labels        │ │
│   │   │       ├── card_identification.json                                      │ │
│   │   │       ├── variant_detection.json                                        │ │
│   │   │       └── condition_grading.json                                        │ │
│   │   │                                                                          │ │
│   │   └── stats/                                                                 │ │
│   │       ├── collection_stats.json                                             │ │
│   │       └── daily/{date}.json                                                 │ │
│   │                                                                              │ │
│   └──────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                      │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Data Flow Diagram

```
                                    USER INPUT
                                        │
                                        ▼
┌───────────────────────────────────────────────────────────────────────────────────┐
│                              QUERY CONFIGURATION                                   │
│                                                                                    │
│   comprehensive-1year-queries.ts                                                  │
│   ┌─────────────────────────────────────────────────────────────────────────────┐│
│   │  HIGH_VALUE_CARDS[]     SET_SPECIFIC_QUERIES[]    VARIANT_TYPE_QUERIES[]   ││
│   │  ├─ op01_120_shanks     ├─ op01_sec_all           ├─ manga_all_en          ││
│   │  ├─ op01_121_yamato     ├─ op05_parallel_en       ├─ tr_all_en             ││
│   │  └─ ...                 └─ ...                    └─ ...                   ││
│   │                                                                             ││
│   │  CONDITION_TRAINING[]   SPECIFIC_CARD_QUERIES[]                            ││
│   │  ├─ psa_10_all          ├─ op02_118_121                                    ││
│   │  ├─ cgc_all             └─ ...                                             ││
│   │  └─ ...                                                                    ││
│   └─────────────────────────────────────────────────────────────────────────────┘│
│                                        │                                          │
│                         getAllComprehensiveQueries()                             │
│                                        │                                          │
│                                        ▼                                          │
│                              84 queries, 641 searches                            │
│                                                                                    │
└───────────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌───────────────────────────────────────────────────────────────────────────────────┐
│                              SERPAPI COLLECTION                                    │
│                                                                                    │
│   collector.fetchListings(query, page)                                           │
│                                                                                    │
│   Request:                                                                        │
│   ┌─────────────────────────────────────────────────────────────────────────────┐│
│   │  GET https://serpapi.com/search                                             ││
│   │  ?engine=ebay                                                               ││
│   │  &_nkw="OP01" one piece parallel english -graded -lot                       ││
│   │  &show_only=Sold          ◄─── CRITICAL: SerpAPI format, NOT LH_Sold       ││
│   │  &_ipg=200                ◄─── Max 240 results per search                   ││
│   │  &_pgn=1                                                                    ││
│   │  &_sacat=183454           ◄─── CCG Individual Cards category               ││
│   │  &api_key=xxx                                                               ││
│   └─────────────────────────────────────────────────────────────────────────────┘│
│                                                                                    │
│   Response (SerpApiResponse):                                                     │
│   ┌─────────────────────────────────────────────────────────────────────────────┐│
│   │  {                                                                          ││
│   │    "search_information": { "total_results": 358 },                         ││
│   │    "organic_results": [                                                     ││
│   │      {                                                                      ││
│   │        "title": "OP01-120 Shanks SEC - One Piece TCG...",                  ││
│   │        "link": "https://www.ebay.com/itm/123456789",                       ││
│   │        "price": { "raw": "$140.00", "extracted": 140 },                    ││
│   │        "shipping": { "raw": "$4.99", "extracted": 4.99 },                  ││
│   │        "sold_date": "Jan 8, 2026",                                         ││
│   │        "condition": "Pre-Owned",                                           ││
│   │        "thumbnail": "https://i.ebayimg.com/images/g/.../s-l225.jpg"        ││
│   │      },                                                                     ││
│   │      ...                                                                    ││
│   │    ]                                                                        ││
│   │  }                                                                          ││
│   └─────────────────────────────────────────────────────────────────────────────┘│
│                                                                                    │
└───────────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌───────────────────────────────────────────────────────────────────────────────────┐
│                              PARSING LAYER                                         │
│                                                                                    │
│   parser.parseListing(serpApiListing, queryName)                                 │
│                                                                                    │
│   Input: SerpApiListing                    Output: ParsedListing                  │
│   ┌────────────────────────┐              ┌────────────────────────────────────┐ │
│   │ title                  │   ───────▶   │ ebayItemId: "123456789"            │ │
│   │ link                   │   TRANSFORM  │ cardId: "OP01-120"                 │ │
│   │ price.raw/extracted    │              │ setCode: "OP01"                    │ │
│   │ shipping.raw/extracted │              │ cardNumber: "120"                  │ │
│   │ sold_date              │              │ variantType: "sec"                 │ │
│   │ condition              │              │ rarity: "SEC"                      │ │
│   │ thumbnail              │              │ language: "EN"                     │ │
│   │ seller                 │              │ graded: false                      │ │
│   └────────────────────────┘              │ price: 140                         │ │
│                                           │ priceCurrency: "USD"               │ │
│   PARSING FUNCTIONS:                      │ priceRaw: "$140.00"                │ │
│   ├─ extractEbayItemId()                  │ shipping: 4.99                     │ │
│   ├─ extractCardId()                      │ soldDate: "Jan 8, 2026"            │ │
│   ├─ detectVariantType()                  │ condition: "Pre-Owned"             │ │
│   ├─ detectRarity()                       │ imageUrls: {                       │ │
│   ├─ detectLanguage()                     │   140: "...s-l140.jpg",            │ │
│   ├─ extractGrading()                     │   300: "...s-l300.jpg",            │ │
│   ├─ extractCurrency()                    │   500: "...s-l500.jpg",            │ │
│   └─ generateImageUrls()                  │   1600: "...s-l1600.jpg"           │ │
│                                           │ }                                   │ │
│                                           │ collectedAt: "2026-01-09T..."      │ │
│                                           │ queryName: "op01_sec_all"          │ │
│                                           └────────────────────────────────────┘ │
│                                                                                    │
└───────────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌───────────────────────────────────────────────────────────────────────────────────┐
│                              IMAGE DOWNLOAD                                        │
│                                                                                    │
│   collector.downloadBatch(listings, [500, 1600])                                 │
│                                                                                    │
│   eBay CDN URL Manipulation:                                                      │
│   ┌─────────────────────────────────────────────────────────────────────────────┐│
│   │  Thumbnail: https://i.ebayimg.com/images/g/AbCd123/s-l225.jpg              ││
│   │                                                    ▲                        ││
│   │                                                    │                        ││
│   │  Replace size ─────────────────────────────────────┘                        ││
│   │                                                                             ││
│   │  500px:  https://i.ebayimg.com/images/g/AbCd123/s-l500.jpg  (Card ID)      ││
│   │  1600px: https://i.ebayimg.com/images/g/AbCd123/s-l1600.jpg (Condition)    ││
│   └─────────────────────────────────────────────────────────────────────────────┘│
│                                                                                    │
│   Concurrency Control:                                                            │
│   ├─ downloadConcurrency: 5 parallel downloads                                   │
│   ├─ downloadRetries: 3 attempts per image                                       │
│   ├─ ebayImageDelayMs: 50ms between images                                       │
│   └─ Exponential backoff on failure                                              │
│                                                                                    │
└───────────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌───────────────────────────────────────────────────────────────────────────────────┐
│                              S3 STORAGE                                            │
│                                                                                    │
│   storage.uploadImage(buffer, listing, resolution)                               │
│   storage.saveListingsMetadata(listings, queryName)                              │
│   storage.updateManifest(listings, imageMetadata, queryName)                     │
│                                                                                    │
│   S3 OBJECT METADATA:                                                             │
│   ┌─────────────────────────────────────────────────────────────────────────────┐│
│   │  Key: onepiece-tcg-1year/images/raw/500/OP01-120/123456789.jpg             ││
│   │  ContentType: image/jpeg                                                    ││
│   │  Metadata:                                                                  ││
│   │    ebay-item-id: 123456789                                                  ││
│   │    card-id: OP01-120                                                        ││
│   │    variant-type: sec                                                        ││
│   │    language: EN                                                             ││
│   │    graded: false                                                            ││
│   │    price: 140                                                               ││
│   │    price-currency: USD                   ◄─── NEW: Currency tracking        ││
│   │    collected-at: 2026-01-09T12:00:00Z                                       ││
│   └─────────────────────────────────────────────────────────────────────────────┘│
│                                                                                    │
│   MANIFEST STRUCTURE (manifest.json):                                             │
│   ┌─────────────────────────────────────────────────────────────────────────────┐│
│   │  {                                                                          ││
│   │    "version": "1.0.0",                                                      ││
│   │    "stats": {                                                               ││
│   │      "totalListings": 5151,                                                 ││
│   │      "totalImages": 10302,                                                  ││
│   │      "byVariant": { "parallel": 2610, "sec": 943, ... },                   ││
│   │      "byLanguage": { "EN": 744, "JP": 317, "UNKNOWN": 4090 },              ││
│   │      "byCardId": { "OP01-120": { "count": 68, "avgPrice": 45.50 }, ... }   ││
│   │    },                                                                       ││
│   │    "processedItemIds": ["123456789", "987654321", ...],                     ││
│   │    "images": [{ "s3Key": "...", "cardId": "...", "variantType": "..." }]   ││
│   │  }                                                                          ││
│   └─────────────────────────────────────────────────────────────────────────────┘│
│                                                                                    │
└───────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Component Architecture

### 3.1 Module Dependency Graph

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           MODULE DEPENDENCIES                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   run-1year-collection.ts (Entry Point)                                     │
│           │                                                                  │
│           ├──────────────────────────────────────────────────────────────┐  │
│           │                                                              │  │
│           ▼                                                              │  │
│   comprehensive-1year-queries.ts                                         │  │
│   ├─ HIGH_VALUE_CARDS[]                                                  │  │
│   ├─ SET_SPECIFIC_QUERIES[]                                              │  │
│   ├─ VARIANT_TYPE_QUERIES[]                                              │  │
│   ├─ CONDITION_TRAINING_QUERIES[]                                        │  │
│   └─ getAllComprehensiveQueries()                                        │  │
│           │                                                              │  │
│           ▼                                                              ▼  │
│   ┌───────────────────┐      ┌───────────────────┐                         │
│   │    collector.ts   │      │    storage.ts     │                         │
│   │                   │      │                   │                         │
│   │ - fetchListings() │      │ - uploadImage()   │                         │
│   │ - fetchAllPages() │      │ - saveMetadata()  │                         │
│   │ - downloadImage() │      │ - loadManifest()  │                         │
│   │ - downloadBatch() │      │ - updateManifest()│                         │
│   │ - filterNew()     │      │ - saveDailyStats()│                         │
│   └─────────┬─────────┘      └─────────┬─────────┘                         │
│             │                          │                                    │
│             ▼                          ▼                                    │
│   ┌───────────────────┐      ┌───────────────────┐                         │
│   │    parser.ts      │      │    config.ts      │                         │
│   │                   │      │                   │                         │
│   │ - parseListing()  │      │ - PipelineConfig  │                         │
│   │ - extractCardId() │      │ - DEFAULT_CONFIG  │                         │
│   │ - detectVariant() │      │ - S3_PATHS        │                         │
│   │ - detectLanguage()│      │ - COLLECTION_     │                         │
│   │ - extractGrading()│      │   QUERIES         │                         │
│   │ - extractCurrency()│     └───────────────────┘                         │
│   └─────────┬─────────┘                                                    │
│             │                                                              │
│             ▼                                                              │
│   ┌───────────────────┐                                                    │
│   │     types.ts      │                                                    │
│   │                   │                                                    │
│   │ - SerpApiListing  │                                                    │
│   │ - ParsedListing   │                                                    │
│   │ - ImageMetadata   │                                                    │
│   │ - CollectionStats │                                                    │
│   │ - VariantType     │                                                    │
│   │ - Rarity          │                                                    │
│   │ - Language        │                                                    │
│   └───────────────────┘                                                    │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Class Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CLASS STRUCTURE                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌────────────────────────────────┐                                         │
│  │         Collector              │                                         │
│  ├────────────────────────────────┤                                         │
│  │ - config: PipelineConfig       │                                         │
│  ├────────────────────────────────┤                                         │
│  │ + fetchListings(query, name,   │                                         │
│  │     page, options): Promise<>  │                                         │
│  │ + fetchAllPages(query, name,   │                                         │
│  │     maxPages, options): Promise│                                         │
│  │ + downloadImage(url, retries)  │                                         │
│  │ + downloadListingImages(       │                                         │
│  │     listing, resolutions)      │                                         │
│  │ + downloadBatch(listings,      │                                         │
│  │     resolutions, onProgress)   │                                         │
│  │ + filterNewListings(listings,  │                                         │
│  │     processedIds)              │                                         │
│  │ + filterWithImages(listings)   │                                         │
│  │ + filterWithCardIds(listings)  │                                         │
│  │ - delay(ms): Promise<void>     │                                         │
│  └────────────────────────────────┘                                         │
│                                                                              │
│  ┌────────────────────────────────┐                                         │
│  │       StorageManager           │                                         │
│  ├────────────────────────────────┤                                         │
│  │ - s3: S3Client                 │                                         │
│  │ - config: PipelineConfig       │                                         │
│  │ - manifest: CollectionManifest │                                         │
│  ├────────────────────────────────┤                                         │
│  │ + uploadImage(buffer, listing, │                                         │
│  │     resolution): ImageMetadata │                                         │
│  │ + imageExists(cardId, itemId,  │                                         │
│  │     resolution): boolean       │                                         │
│  │ + saveListingsMetadata(        │                                         │
│  │     listings, queryName)       │                                         │
│  │ + loadManifest(): Manifest     │                                         │
│  │ + saveManifest(): void         │                                         │
│  │ + updateManifest(listings,     │                                         │
│  │     images, queryName)         │                                         │
│  │ + isProcessed(itemId): boolean │                                         │
│  │ + getProcessedItemIds(): Set   │                                         │
│  │ + saveDailyStats(stats): void  │                                         │
│  │ + generateTrainingLabels()     │                                         │
│  └────────────────────────────────┘                                         │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Internal Engineering Details

### 4.1 SerpAPI Parameter Discovery

Through systematic testing, we discovered critical differences between eBay native parameters and SerpAPI's supported parameters:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    SERPAPI PARAMETER COMPATIBILITY                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   WORKING PARAMETERS:                                                        │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  engine          = "ebay"          ✓ Required                       │   │
│   │  _nkw            = "search query"  ✓ Keywords                       │   │
│   │  show_only       = "Sold"          ✓ Sold listings filter           │   │
│   │  _ipg            = "200"           ✓ Items per page (max ~240)      │   │
│   │  _pgn            = "1"             ✓ Page number                    │   │
│   │  _sacat          = "183454"        ✓ Category (CCG cards)           │   │
│   │  _udlo           = "10"            ✓ Min price                      │   │
│   │  _udhi           = "500"           ✓ Max price                      │   │
│   │  ebay_domain     = "ebay.com"      ✓ eBay site                      │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│   NON-WORKING PARAMETERS (Return 400 Error):                                │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  LH_Sold         = "1"             ✗ Use show_only instead          │   │
│   │  LH_Complete     = "1"             ✗ Use show_only instead          │   │
│   │  LH_Time         = "15"            ✗ Not supported                  │   │
│   │  _sop            = "13"            ✗ "Unsupported _sop: 13"         │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│   INSIGHT: SerpAPI wraps eBay's API differently than direct URL access.     │
│   Parameters like _sop (sort order) work on eBay.com but not via SerpAPI.  │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 4.2 Query Optimization Strategy

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         QUERY OPTIMIZATION MATRIX                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   HIGH YIELD PATTERNS:                                                       │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  Pattern: "{SET}" one piece {variant} {language} -{exclusions}      │   │
│   │                                                                     │   │
│   │  Examples:                                                          │   │
│   │  ✓ "OP01" one piece parallel english -graded -lot     ~200 results │   │
│   │  ✓ "OP05" one piece SEC secret rare -graded -lot      ~180 results │   │
│   │  ✓ one piece tcg manga art english -graded -lot       ~100 results │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│   LOW YIELD PATTERNS (Avoid):                                               │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  Pattern: Too many exact match requirements                         │   │
│   │                                                                     │   │
│   │  Examples:                                                          │   │
│   │  ✗ "EB02" SP "OP06-042" one piece -graded -lot        0 results   │   │
│   │  ✗ "OP01-016" Nami SP special parallel one piece      0 results   │   │
│   │  ✗ one piece tcg PSA 7 6 5 -lot                       0 results   │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│   EXCLUSION TERMS EFFECTIVENESS:                                            │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  -lot        Essential   Removes bulk listings                      │   │
│   │  -bundle     Essential   Removes multi-card bundles                 │   │
│   │  -graded     Useful      Separates raw from graded (for training)   │   │
│   │  -PSA        Specific    Excludes PSA graded only                   │   │
│   │  -CGC        Specific    Excludes CGC graded only                   │   │
│   │  -japanese   Context     Use when targeting English only            │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│   KEY INSIGHT: Do NOT include "sold" in query text when using              │
│   show_only=Sold parameter. It's redundant and may reduce results.         │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 4.3 Variant Detection Logic

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      VARIANT DETECTION DECISION TREE                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   Input: Listing Title                                                       │
│   │                                                                          │
│   ▼                                                                          │
│   ┌─────────────────┐                                                       │
│   │ Contains "manga"│──YES──▶ return "manga"        (Highest value)         │
│   └────────┬────────┘                                                       │
│            │NO                                                               │
│            ▼                                                                 │
│   ┌─────────────────────┐                                                   │
│   │ Contains "wanted    │──YES──▶ return "wantedposter"                     │
│   │ poster"             │                                                   │
│   └────────┬────────────┘                                                   │
│            │NO                                                               │
│            ▼                                                                 │
│   ┌─────────────────────┐                                                   │
│   │ Contains "box       │──YES──▶ return "boxtopper"                        │
│   │ topper"             │                                                   │
│   └────────┬────────────┘                                                   │
│            │NO                                                               │
│            ▼                                                                 │
│   ┌─────────────────────┐                                                   │
│   │ Contains "SP" or    │──YES──▶ return "sp"                               │
│   │ "special art/rare"  │                                                   │
│   └────────┬────────────┘                                                   │
│            │NO                                                               │
│            ▼                                                                 │
│   ┌─────────────────────┐                                                   │
│   │ Contains "TR" or    │──YES──▶ return "tr"                               │
│   │ "treasure rare"     │                                                   │
│   └────────┬────────────┘                                                   │
│            │NO                                                               │
│            ▼                                                                 │
│   ┌─────────────────────┐                                                   │
│   │ Contains "SEC" AND  │──YES──▶ return "sec_parallel"                     │
│   │ "parallel/alt art"  │                                                   │
│   └────────┬────────────┘                                                   │
│            │NO                                                               │
│            ▼                                                                 │
│   ┌─────────────────────┐                                                   │
│   │ Contains "SR" AND   │──YES──▶ return "sr_parallel"                      │
│   │ "parallel/alt art"  │                                                   │
│   └────────┬────────────┘                                                   │
│            │NO                                                               │
│            ▼                                                                 │
│   ┌─────────────────────┐                                                   │
│   │ Contains "SEC" or   │──YES──▶ return "sec"                              │
│   │ "secret rare"       │                                                   │
│   └────────┬────────────┘                                                   │
│            │NO                                                               │
│            ▼                                                                 │
│   ┌─────────────────────┐                                                   │
│   │ Contains "parallel" │──YES──▶ return "parallel"                         │
│   │ or "alt art"        │                                                   │
│   └────────┬────────────┘                                                   │
│            │NO                                                               │
│            ▼                                                                 │
│   ┌─────────────────────┐                                                   │
│   │ Contains "promo"    │──YES──▶ return "promo"                            │
│   └────────┬────────────┘                                                   │
│            │NO                                                               │
│            ▼                                                                 │
│        return "standard"                                                     │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 4.4 Currency Extraction

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         CURRENCY EXTRACTION LOGIC                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   Input: price.raw string from SerpAPI                                      │
│                                                                              │
│   SYMBOL-BASED DETECTION:                                                    │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  "$140.00"    → contains "$"    → "USD"                             │   │
│   │  "£50.00"     → contains "£"    → "GBP"                             │   │
│   │  "€30.00"     → contains "€"    → "EUR"                             │   │
│   │  "¥5000"      → contains "¥"    → "JPY"                             │   │
│   │  "A$75.00"    → contains "A$"   → "AUD"                             │   │
│   │  "C$60.00"    → contains "C$"   → "CAD"                             │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│   CODE-BASED FALLBACK:                                                      │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  "140.00 USD" → matches /\bUSD\b/i → "USD"                          │   │
│   │  "50.00 GBP"  → matches /\bGBP\b/i → "GBP"                          │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│   STORED FIELDS:                                                            │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  price: 140              (numeric, for calculations)                │   │
│   │  priceCurrency: "USD"    (for multi-currency analysis)              │   │
│   │  priceRaw: "$140.00"     (original string, for auditing)            │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│   FUTURE USE CASE: Cross-market arbitrage detection                        │
│   - Compare USD prices (eBay US) vs GBP (eBay UK) vs EUR (CardMarket)     │
│   - Identify pricing inefficiencies across regions                         │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 5. Performance Characteristics

### 5.1 Collection Metrics (Actual Run: 2026-01-09)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         PERFORMANCE METRICS                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   RUN SUMMARY:                                                               │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  Duration:           7.6 minutes                                    │   │
│   │  Queries executed:   69 / 84 planned                                │   │
│   │  Searches used:      80 / 641 allocated                             │   │
│   │  Listings collected: 5,151                                          │   │
│   │  Error rate:         15 / 69 = 21.7% (empty results)                │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│   THROUGHPUT:                                                                │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  Listings per search:  64.4 avg                                     │   │
│   │  Listings per minute:  678                                          │   │
│   │  Searches per minute:  10.5 (rate limited to ~30/min max)           │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│   VARIANT DISTRIBUTION:                                                      │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  parallel      2,610  (50.7%)  ████████████████████                 │   │
│   │  sec             943  (18.3%)  ███████                              │   │
│   │  manga           186  ( 3.6%)  █                                    │   │
│   │  wantedposter    162  ( 3.1%)  █                                    │   │
│   │  sp               67  ( 1.3%)                                       │   │
│   │  tr               42  ( 0.8%)                                       │   │
│   │  sec_parallel     10  ( 0.2%)                                       │   │
│   │  boxtopper         7  ( 0.1%)                                       │   │
│   │  other/unknown 1,124  (21.8%)  █████████                            │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│   LANGUAGE DISTRIBUTION:                                                     │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  EN          744  (14.4%)  █████                                    │   │
│   │  JP          317  ( 6.2%)  ██                                       │   │
│   │  UNKNOWN   4,090  (79.4%)  ████████████████████████████████         │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│   INSIGHT: High "UNKNOWN" language rate indicates listings often don't     │
│   explicitly state language in title. Consider image-based language        │
│   detection for ML training.                                                │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 5.2 Cost Analysis

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            COST BREAKDOWN                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   SERPAPI COSTS:                                                            │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  Plan:              Paid ($50/month = 5,000 searches)               │   │
│   │  Cost per search:   $0.01                                           │   │
│   │  This run:          80 searches = $0.80                             │   │
│   │  Full 641 run:      641 searches = $6.41                            │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│   AWS S3 COSTS (Estimated):                                                 │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  Storage:           ~3 GB @ $0.023/GB = $0.07/month                 │   │
│   │  PUT requests:      ~10,000 @ $0.005/1000 = $0.05                   │   │
│   │  GET requests:      Variable (ML training)                          │   │
│   │  Data transfer:     Free (same region)                              │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│   TOTAL ESTIMATED COST PER FULL RUN: ~$7                                    │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 6. Development Insights & Recommendations

### 6.1 Lessons Learned

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         KEY LEARNINGS                                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   1. API PARAMETER FORMATS MATTER                                           │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  Problem:  Used eBay native params (LH_Sold, _sop) with SerpAPI     │   │
│   │  Symptom:  400 errors on all queries                                │   │
│   │  Solution: Use SerpAPI-specific params (show_only: "Sold")          │   │
│   │  Lesson:   Always test API wrapper params, don't assume parity      │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│   2. QUERY REDUNDANCY HURTS                                                 │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  Problem:  Included "sold" in query text + show_only=Sold          │   │
│   │  Symptom:  0 results for many queries                               │   │
│   │  Solution: Remove redundant terms from query text                   │   │
│   │  Lesson:   API filters operate independently from search terms      │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│   3. RESULTS PER PAGE OPTIMIZATION                                          │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  Problem:  Used _ipg=60 (docs said max was 60)                      │   │
│   │  Discovery: _ipg=200 returns up to 240 results                      │   │
│   │  Impact:   4x fewer API calls needed for same data                  │   │
│   │  Lesson:   Test edge cases, don't trust documentation blindly       │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│   4. CURRENCY IS VALUABLE METADATA                                          │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  Problem:  Only stored numeric price, discarded currency            │   │
│   │  Impact:   Lost ability to do cross-market analysis                 │   │
│   │  Solution: Store price, priceCurrency, and priceRaw                 │   │
│   │  Lesson:   Preserve original data when possible                     │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│   5. SPECIFIC QUERIES OFTEN FAIL                                            │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  Problem:  Very specific queries ("EB02" SP "OP06-042") = 0 results│   │
│   │  Reason:   eBay sold history is ~90 days, rare cards may not exist │   │
│   │  Solution: Use broader queries, aggregate at processing time        │   │
│   │  Lesson:   Balance specificity vs. yield in query design            │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 6.2 Future Improvements

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       RECOMMENDED ENHANCEMENTS                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   PRIORITY 1: Data Quality                                                  │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  [ ] Add image-based language detection (JP text in image)          │   │
│   │  [ ] Implement duplicate image detection (perceptual hashing)       │   │
│   │  [ ] Add card condition parsing from title ("NM", "LP", etc.)       │   │
│   │  [ ] Cross-reference with official card database for validation     │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│   PRIORITY 2: Coverage                                                      │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  [ ] Add eBay UK (ebay.co.uk) for GBP prices                        │   │
│   │  [ ] Add eBay Germany (ebay.de) for EUR prices                      │   │
│   │  [ ] Add Yahoo Japan Auctions for JP market                         │   │
│   │  [ ] Schedule recurring collection (daily/weekly)                   │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│   PRIORITY 3: Infrastructure                                                │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  [ ] Move to AWS Lambda for serverless execution                    │   │
│   │  [ ] Add EventBridge schedule for automated runs                    │   │
│   │  [ ] Implement DynamoDB for processed ID tracking (vs S3 manifest)  │   │
│   │  [ ] Add CloudWatch metrics and alerting                            │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│   PRIORITY 4: ML Integration                                                │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  [ ] Generate SageMaker-compatible training manifests               │   │
│   │  [ ] Create TFRecord exports for TensorFlow                         │   │
│   │  [ ] Implement active learning feedback loop                        │   │
│   │  [ ] Add confidence scores to variant/rarity detection              │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 7. Appendix

### A. Environment Configuration

```bash
# Required
export SERPAPI_API_KEY="your_serpapi_key"
export AWS_REGION="us-east-1"

# Optional (defaults provided)
export S3_BUCKET="tcg-training-data"
```

### B. CLI Reference

```bash
# Full collection run
npx tsx src/run-1year-collection.ts --max-searches=641 --verbose

# Dry run (preview only)
npx tsx src/run-1year-collection.ts --dry-run

# Skip image downloads (metadata only)
npx tsx src/run-1year-collection.ts --skip-images

# Filter by priority
npx tsx src/run-1year-collection.ts --priority=1

# Filter by variant
npx tsx src/run-1year-collection.ts --variant=manga

# Resume from specific query
npx tsx src/run-1year-collection.ts --resume=op05_sec_all
```

### C. S3 Path Reference

| Path | Purpose |
|------|---------|
| `{prefix}/images/raw/{resolution}/{cardId}/{itemId}.jpg` | Raw card images |
| `{prefix}/metadata/listings/{date}/{query}.jsonl` | Listing metadata |
| `{prefix}/metadata/manifest.json` | Master index |
| `{prefix}/metadata/labels/card_identification.json` | ML labels |
| `{prefix}/stats/daily/{date}.json` | Daily run stats |

---

*Document generated: 2026-01-09*
*Pipeline version: 2.0.0*
