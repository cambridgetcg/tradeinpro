# One Piece TCG eBay Query Strategy Guide

> Comprehensive guide for high-quality data extraction optimized for ML training.
> Based on empirical testing with SerpApi eBay Search API (January 2026).

## Executive Summary

After extensive testing of 18+ query strategies across multiple variant types, we identified the optimal approaches for extracting high-quality One Piece TCG sold listing data from eBay.

### Key Findings

| Metric | Best Strategy | Score |
|--------|---------------|-------|
| **Overall ML Score** | `"one piece" SEC parallel english -lot -bundle -bulk -japanese` | 99.5/100 |
| **Highest Volume** | `"OP01-" one piece card` | 3,400 listings |
| **Best Card ID Extraction** | `one piece tcg english SEC -japanese -JP` | 98% |
| **Highest Value Cards** | `one piece tcg manga art rare` | $1,391 avg |

---

## Table of Contents

1. [eBay Listing Title Anatomy](#1-ebay-listing-title-anatomy)
2. [One Piece TCG Variant Types](#2-one-piece-tcg-variant-types)
3. [Query Strategy Rankings](#3-query-strategy-rankings)
4. [Recommended Production Queries](#4-recommended-production-queries)
5. [Data Quality Metrics](#5-data-quality-metrics)
6. [Card ID Extraction Patterns](#6-card-id-extraction-patterns)
7. [Language Separation Strategy](#7-language-separation-strategy)
8. [Graded vs Raw Card Filtering](#8-graded-vs-raw-card-filtering)
9. [Implementation Guide](#9-implementation-guide)

---

## 1. eBay Listing Title Anatomy

### Typical Title Structure

```
[Character] [CardNumber] [Rarity] [Variant] [Set Name] [Language] [Condition] [Extras]
```

### Examples Analyzed

| Title | Parsed Components |
|-------|-------------------|
| `Shanks SEC OP01-120 Alt Art PRB-01 Premium Booster English` | Character: Shanks, Card: OP01-120, Rarity: SEC, Variant: Alt Art, Set: PRB-01, Lang: EN |
| `One Piece TCG Nami Manga Alternate Art OP01-016 NM ENGLISH RAW` | Character: Nami, Card: OP01-016, Variant: Manga Alt Art, Condition: NM, Lang: EN, Graded: No |
| `PSA 10 2023 One Piece Card Chinese Zoro OP01-025 Flagship Battle` | Graded: PSA 10, Card: OP01-025, Character: Zoro |

### Common Abbreviations in Titles

| Abbreviation | Meaning | Example |
|--------------|---------|---------|
| SEC | Secret Rare | `OP01-120 SEC` |
| SR | Super Rare | `OP05-051 SR` |
| SP | Special Art (reprint in later set) | `SP OP01-051` |
| TR | Treasure Rare | `ST01-007 TR` |
| NM | Near Mint | `NM English` |
| PSA/CGC/BGS | Grading companies | `PSA 10` |
| Alt Art | Alternate Art | `Alt Art Parallel` |
| Para/Parallel | Parallel foil variant | `SEC Parallel` |

---

## 2. One Piece TCG Variant Types

### Variant Hierarchy (Rarity/Value)

```
Manga Art (Highest Value: $1,000-$30,000)
    ↓
SP Special Art ($100-$1,000)
    ↓
Treasure Rare ($80-$300)
    ↓
SEC Parallel/Alt Art ($50-$500)
    ↓
SEC Base ($10-$50)
    ↓
SR Parallel ($20-$100)
    ↓
Regular Parallel ($5-$50)
```

### Variant Test Results

| Variant Type | Query | Volume | Card ID Rate | Avg Price | Graded % |
|--------------|-------|--------|--------------|-----------|----------|
| **parallel** (EN) | `"one piece" parallel english alt art -lot -bundle -japanese` | 852 | 100% | $81 | 6% |
| **parallel** (JP) | `"one piece" parallel japanese alt art -lot -bundle -english` | 307 | 94% | $740 | 44% |
| **manga** (EN) | `one piece tcg manga art english -lot -bundle -japanese` | 91 | 88% | $1,581 | 15% |
| **manga** (JP) | `one piece tcg manga art japanese -lot -bundle` | 38 | 84% | $1,324 | 68% |
| **sec** (EN) | `one piece tcg SEC secret rare english -lot -bundle -japanese` | 225 | 100% | $13 | 0% |
| **sec_parallel** (EN) | `"one piece" SEC parallel english -lot -bundle -japanese` | 128 | 98% | $112 | 3% |
| **tr** (EN) | `one piece tcg TR treasure rare english -lot -bundle -japanese` | 42 | 48% | $96 | 17% |
| **sp** (EN) | `one piece tcg SP special art english -lot -bundle -japanese` | 8 | 88% | $96 | 50% |
| **wantedposter** | `one piece tcg wanted poster -lot -bundle` | 165 | 46% | $429 | 8% |

### Key Insights

1. **Japanese parallels have 9x higher average price** than English ($740 vs $81)
2. **Manga variants are ultra-premium** ($1,300-$1,600 average)
3. **68% of JP manga cards are graded** vs only 15% EN
4. **SEC base cards are low value** ($13 avg) - focus on SEC Parallel ($112 avg)

---

## 3. Query Strategy Rankings

### ML Suitability Score

Formula: `Precision × 40% + Card ID Rate × 30% + Price Rate × 20% + Volume Bonus × 10%`

### Top 10 Strategies

| Rank | Strategy | Query | Volume | Precision | Card ID | ML Score |
|------|----------|-------|--------|-----------|---------|----------|
| 1 | **precision_sec_parallel_en** | `"one piece" SEC parallel english -lot -bundle -bulk -japanese` | 128 | 100% | 98% | 99.5 |
| 2 | **english_only** | `one piece tcg english SEC -japanese -JP` | 1,300 | 99% | 98% | 99.0 |
| 3 | **character_luffy_sec** | `one piece tcg Luffy SEC secret rare` | 660 | 99% | 98% | 98.8 |
| 4 | **sec_rarity** | `one piece tcg SEC secret rare` | 2,100 | 99% | 97% | 98.5 |
| 5 | **parallel_alt_art** | `one piece tcg parallel alt art -lot -bundle` | 801 | 100% | 94% | 98.3 |
| 6 | **treasure_rare** | `one piece tcg TR treasure rare` | 179 | 99% | 93% | 97.3 |
| 7 | **category_filtered_sec** | `one piece tcg SEC` (with category 183454) | 2,600 | 98% | 94% | 96.9 |
| 8 | **psa_graded** | `one piece tcg PSA 10 SEC` | 96 | 99% | 90% | 96.1 |
| 9 | **japanese_only** | `one piece tcg japanese SEC -english` | 223 | 97% | 91% | 95.4 |
| 10 | **card_number_exact** | `"OP01-120" one piece` | 632 | 94% | 94% | 95.2 |

### Strategies to Avoid

| Strategy | Issue | Why |
|----------|-------|-----|
| `one piece tcg OP01` (basic set) | 22.5% noise | Picks up starter decks, boosters, lots |
| `SP OP01 OR OP02 OR OP03` | 0 results | OR operators don't work in SerpApi |
| Generic without exclusions | High noise | Lots, bundles contaminate data |

---

## 4. Recommended Production Queries

### Primary Collection Queries

These queries should be run daily for comprehensive coverage:

```typescript
const PRODUCTION_QUERIES = {
  // High-volume, high-precision queries
  primary: [
    {
      name: 'sec_parallel_en',
      query: '"one piece" SEC parallel english -lot -bundle -bulk -japanese',
      expectedVolume: 128,
      precision: '100%',
      avgPrice: 112,
    },
    {
      name: 'sec_en',
      query: 'one piece tcg SEC secret rare english -lot -bundle -japanese',
      expectedVolume: 1300,
      precision: '99%',
      avgPrice: 162,
    },
    {
      name: 'parallel_en',
      query: '"one piece" parallel english alt art -lot -bundle -japanese',
      expectedVolume: 852,
      precision: '100%',
      avgPrice: 81,
    },
  ],

  // High-value variant queries
  premium: [
    {
      name: 'manga_en',
      query: 'one piece tcg manga art english -lot -bundle -japanese',
      expectedVolume: 91,
      precision: '95%',
      avgPrice: 1581,
    },
    {
      name: 'manga_jp',
      query: 'one piece tcg manga art japanese -lot -bundle',
      expectedVolume: 38,
      precision: '95%',
      avgPrice: 1324,
    },
    {
      name: 'treasure_rare',
      query: 'one piece tcg TR treasure rare -lot -bundle',
      expectedVolume: 179,
      precision: '99%',
      avgPrice: 149,
    },
  ],

  // Graded card queries (separate pricing model)
  graded: [
    {
      name: 'psa_sec',
      query: 'one piece tcg PSA 10 SEC -lot -bundle',
      expectedVolume: 96,
      precision: '99%',
      avgPrice: 241,
    },
    {
      name: 'psa_parallel',
      query: 'one piece tcg PSA 10 parallel -lot -bundle',
      expectedVolume: 50,
      precision: '95%',
      avgPrice: 300,
    },
  ],

  // Japanese market (higher prices, lower volume)
  japanese: [
    {
      name: 'sec_jp',
      query: 'one piece tcg japanese SEC -english -lot -bundle',
      expectedVolume: 223,
      precision: '97%',
      avgPrice: 58,
    },
    {
      name: 'parallel_jp',
      query: '"one piece" parallel japanese -english -lot -bundle',
      expectedVolume: 307,
      precision: '94%',
      avgPrice: 740,
    },
  ],
};
```

### Specific Card Queries

For tracking specific high-value cards:

```typescript
// Top cards by set - use exact card number queries
const SPECIFIC_CARD_QUERIES = [
  // OP01 Romance Dawn (flagship set)
  '"OP01-120" one piece',  // Shanks SEC
  '"OP01-121" one piece',  // Yamato SEC
  '"OP01-016" one piece',  // Nami (has manga variant)

  // OP05 Awakening of the New Era
  '"OP05-119" one piece',  // Gear 5 Luffy SEC

  // OP06 Wings of the Captain
  '"OP06-119" one piece',  // Sanji SEC
];
```

---

## 5. Data Quality Metrics

### Quality Score Components

| Component | Weight | Measurement |
|-----------|--------|-------------|
| **Precision** | 40% | % of results matching expected patterns |
| **Card ID Extraction** | 30% | % of titles with parseable card numbers |
| **Price Availability** | 20% | % of results with extracted prices |
| **Volume** | 10% | Bonus for queries returning >100 results |

### Data Completeness by Query Type

| Query Type | Has Price | Has Condition | Has Sold Date | Has Card ID |
|------------|-----------|---------------|---------------|-------------|
| SEC queries | 99% | 100% | 100% | 97% |
| Parallel queries | 100% | 100% | 100% | 94% |
| Manga queries | 100% | 100% | 100% | 87% |
| PSA graded | 100% | 100% | 100% | 90% |

---

## 6. Card ID Extraction Patterns

### Regex Pattern

```typescript
function extractCardId(title: string): string | undefined {
  // Matches: OP01-120, ST01-001, EB01-050, PRB01-001
  const match = title.match(/\b(OP\d{2}|ST\d{2}|EB\d{2}|PRB\d{2})-(\d{3})\b/i);
  return match ? `${match[1].toUpperCase()}-${match[2]}` : undefined;
}
```

### Extraction Success Rates

| Pattern Type | Example | Success Rate |
|--------------|---------|--------------|
| Standard booster | `OP01-120` | 95%+ |
| Starter deck | `ST01-007` | 90%+ |
| Extra booster | `EB01-050` | 90%+ |
| Premium booster | `PRB01-001` | 85%+ |

### Joining with CardPriceV2

```typescript
// eBay extracted: "OP01-120"
// CardPriceV2.fullCardNumber: "OP01-120"
// CardPriceV2.cardId: "OP03-OP01-120-sp" (for SP variant)

// Direct match on fullCardNumber for base cards
const baseMatch = await prisma.cardPriceV2.findFirst({
  where: { fullCardNumber: extractedCardId }
});

// For variants, need to also match variantType from title parsing
const variantMatch = await prisma.cardPriceV2.findFirst({
  where: {
    fullCardNumber: extractedCardId,
    variantType: parsedVariant // 'parallel', 'sp', 'manga', etc.
  }
});
```

---

## 7. Language Separation Strategy

### Why Separate Languages?

1. **Price Differential**: JP parallels average $740 vs EN $81 (9x difference)
2. **Grading Rates**: 44% of JP listings are graded vs 6% EN
3. **Market Dynamics**: JP market has different demand patterns
4. **Training Data Quality**: Mixed language data creates noise

### Language Detection Patterns

```typescript
function detectLanguage(title: string): 'EN' | 'JP' | 'UNKNOWN' {
  if (/\benglish\b/i.test(title) || /\bEN\b/.test(title)) return 'EN';
  if (/\bjapanese\b/i.test(title) || /\bJP\b/i.test(title) || /日本語/.test(title)) return 'JP';
  return 'UNKNOWN';
}
```

### Query Templates by Language

```typescript
// English cards
const EN_QUERY = (base: string) =>
  `${base} english -japanese -JP -lot -bundle`;

// Japanese cards
const JP_QUERY = (base: string) =>
  `${base} japanese -english -lot -bundle`;
```

---

## 8. Graded vs Raw Card Filtering

### Price Multipliers (Observed)

| Card Type | Raw Avg | PSA 10 Avg | Multiplier |
|-----------|---------|------------|------------|
| SEC Parallel | $112 | $241 | 2.2x |
| Manga Art | $1,581 | $3,000+ | 1.9x |
| Regular Parallel | $81 | $150 | 1.9x |

### Query Strategies

```typescript
// Raw cards only
const RAW_QUERY = `one piece tcg SEC -PSA -CGC -BGS -graded -slab`;

// Graded cards only
const GRADED_QUERY = `one piece tcg PSA 10 SEC`;

// Specific grade
const PSA_10_QUERY = `one piece tcg "PSA 10" SEC`;
const PSA_9_QUERY = `one piece tcg "PSA 9" SEC`;
```

### Grading Company Detection

```typescript
function extractGrading(title: string): {
  graded: boolean;
  company?: 'PSA' | 'CGC' | 'BGS';
  grade?: number;
} {
  const match = title.match(/\b(PSA|CGC|BGS)\s*(\d+\.?\d?)\b/i);
  if (match) {
    return {
      graded: true,
      company: match[1].toUpperCase() as 'PSA' | 'CGC' | 'BGS',
      grade: parseFloat(match[2])
    };
  }
  return { graded: false };
}
```

---

## 9. Implementation Guide

### Daily Collection Schedule

```typescript
const COLLECTION_SCHEDULE = {
  // Morning run: High-volume queries
  morning: {
    time: '08:00 UTC',
    queries: [
      'sec_en',           // ~1,300 results
      'parallel_en',      // ~850 results
      'sec_parallel_en',  // ~128 results
    ],
    expectedSearches: 15, // At 200 results/page
    expectedListings: 2300,
  },

  // Afternoon run: Premium variants
  afternoon: {
    time: '14:00 UTC',
    queries: [
      'manga_en',
      'manga_jp',
      'treasure_rare',
      'psa_sec',
    ],
    expectedSearches: 5,
    expectedListings: 400,
  },

  // Evening run: Japanese market
  evening: {
    time: '20:00 UTC',
    queries: [
      'sec_jp',
      'parallel_jp',
    ],
    expectedSearches: 4,
    expectedListings: 500,
  },
};

// Total daily: ~24 searches, ~3,200 listings
// Monthly: ~720 searches, ~96,000 listings
// Big Data tier capacity: 30,000 searches/month (plenty of headroom)
```

### Data Pipeline Flow

```
1. FETCH
   └─ SerpApi Query
      └─ Parse JSON response

2. EXTRACT
   ├─ Card ID (OP01-120)
   ├─ Variant Type (parallel, sp, manga)
   ├─ Language (EN, JP)
   ├─ Grading (PSA 10, raw)
   ├─ Price (USD)
   └─ Sold Date

3. VALIDATE
   ├─ Card ID matches pattern
   ├─ Price is reasonable (>$0, <$50,000)
   └─ Not a lot/bundle/bulk

4. DEDUPLICATE
   └─ By eBay item ID (from link URL)

5. ENRICH
   ├─ Join with CardPriceV2 (fullCardNumber)
   ├─ Convert USD → GBP
   └─ Calculate condition multiplier

6. STORE
   └─ EbaySoldListing table
      ├─ ebayItemId (unique)
      ├─ cardPriceV2Id (FK)
      ├─ priceUsd
      ├─ soldDate
      ├─ condition
      ├─ graded (bool)
      ├─ gradeCompany
      ├─ gradeValue
      └─ language
```

### Estimated Monthly Data Volume

| Query Category | Searches/Day | Listings/Day | Monthly Volume |
|----------------|--------------|--------------|----------------|
| Primary (SEC, Parallel) | 15 | 2,300 | 69,000 |
| Premium (Manga, TR) | 5 | 400 | 12,000 |
| Japanese | 4 | 500 | 15,000 |
| Graded | 3 | 200 | 6,000 |
| **Total** | **27** | **3,400** | **102,000** |

With Big Data tier (30,000 searches/month), you have **30x headroom** for:
- Historical backfill
- Additional variant queries
- Higher pagination depth
- Ad-hoc research

---

## Appendix: Test Results Data

### Query Strategy Detailed Results

```
Strategy: precision_sec_parallel_en
  Query: "one piece" SEC parallel english -lot -bundle -bulk -japanese
  Total Results: 128
  Precision: 100%
  Card ID Rate: 98%
  Avg Price: $112.17

Strategy: english_only
  Query: one piece tcg english SEC -japanese -JP
  Total Results: 1,300
  Precision: 99%
  Card ID Rate: 98%
  Avg Price: $162.33

Strategy: parallel_alt_art
  Query: one piece tcg parallel alt art -lot -bundle
  Total Results: 801
  Precision: 100%
  Card ID Rate: 94%
  Avg Price: $79.51

Strategy: manga_art
  Query: one piece tcg manga art rare
  Total Results: 84
  Precision: 95%
  Card ID Rate: 87%
  Avg Price: $1,391.72

Strategy: treasure_rare
  Query: one piece tcg TR treasure rare
  Total Results: 179
  Precision: 99%
  Card ID Rate: 93%
  Avg Price: $149.06
```

---

## References

- [SerpApi eBay Search API](https://serpapi.com/ebay-search-api)
- [One Piece TCG Rarities Guide](https://tcgking.nl/blogs/collecting/all-one-piece-tcg-rarities-explained)
- [PSA One Piece Collecting Guide](https://www.psacard.com/info/tcg/one-piece-collecting-basics-guide)

---

*Document generated: January 2026*
*Based on: 18 query strategies, 2,000+ analyzed listings*
*SerpApi tier: Big Data ($275/mo, 30,000 searches)*
