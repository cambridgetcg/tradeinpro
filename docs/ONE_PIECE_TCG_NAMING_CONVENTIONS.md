# One Piece TCG Card Naming Conventions & Image Collection Strategy

**Date:** 2026-01-09
**Source:** Cambridge TCG (cambridgetcg.com), eBay sold listings analysis
**Purpose:** Guide SerpApi queries for high-quality training image collection

---

## 1. Card Identification System

### 1.1 Base Card Number Format

```
[SET_CODE]-[CARD_NUMBER]

Examples:
  OP01-120    → Set OP01, Card 120
  OP13-118    → Set OP13, Card 118
  EB01-061    → Extra Booster 01, Card 061
  ST16-004    → Starter Deck 16, Card 004
```

### 1.2 Set Codes & Official Names

| Code | Official Set Name | Release Order |
|------|-------------------|---------------|
| **OP01** | Romance Dawn | 1st Main Set |
| **OP02** | Paramount War | 2nd Main Set |
| **OP03** | Pillars of Strength | 3rd Main Set |
| **OP04** | Kingdoms of Intrigue | 4th Main Set |
| **OP05** | Awakening of the New Era | 5th Main Set |
| **OP06** | Wings of the Captain | 6th Main Set |
| **OP07** | 500 Years into the Future | 7th Main Set |
| **OP08** | Two Legends | 8th Main Set |
| **OP09** | The New Emperor | 9th Main Set |
| **OP10** | Royal Blood | 10th Main Set |
| **OP11** | A Fist of Divine Speed | 11th Main Set |
| **OP12** | Legacy of the Master | 12th Main Set |
| **OP13** | Carrying On His Will | 13th Main Set |
| **EB01** | Memorial Collection | Extra Booster 1 |
| **EB02** | Extra Booster 02 | Extra Booster 2 |
| **ST01-ST16** | Starter Decks | Supplementary |

---

## 2. Variant Types & Naming Patterns

### 2.1 Alt Art (Parallel) Cards

**Cambridge TCG Naming:**
```
[CardNumber] [Character] Alt Art [SetName] Japanese

Examples:
  OP01-120 Shanks Alt Art Romance Dawn Japanese
  OP01-121 Yamato Alt Art Romance Dawn Japanese
  OP13-118 Alt Art Carrying On His Will Japanese
```

**eBay Search Terms:**
- "OP01-120 alt art"
- "OP01-120 parallel"
- "Shanks parallel romance dawn"

**Note:** Cambridge TCG uses "Alt Art" where other markets use "Parallel". These are the same cards.

### 2.2 SP (Special Rare) Cards

**Naming Pattern:**
```
[ReleaseSet]-SP-[OriginalCard] Alt Art

Examples:
  OP05-SP-OP01-121  → SP of OP01-121 released in OP05
  EB02-SP-OP08-001  → SP of OP08-001 released in EB02
  EB02-SP-OP06-042  → SP of OP06-042 released in EB02
```

**Key Insight:** SP cards are reprints with special artwork released in LATER sets. The `ReleaseSet` indicates where the SP was pullable, while `OriginalCard` indicates the base card it references.

**Cambridge TCG Examples:**
| Product Name | Price | Original Card |
|--------------|-------|---------------|
| EB02-SP-OP05-060 Alt Art | £234.80 | OP05-060 |
| EB02-SP-OP06-001 Alt Art | £75.80 | OP06-001 |
| EB02-SP-OP06-042 Alt Art | £55.80 | OP06-042 |
| OP05 Special Rare OP01-121 | £93.80 | OP01-121 |

**eBay Search Terms:**
- "OP01-121 SP"
- "OP01-121 special rare"
- "Yamato SP one piece"

### 2.3 SEC (Secret Rare) Cards

**Naming Pattern:**
```
[CardNumber] [Character] Secret Alt Art [SetName]
[CardNumber] [Character] SEC [SetName]

Examples:
  OP07-119 Portgas D. Ace Secret Alt Art 500 Years into the Future
  OP03-122 Sogeking SEC Alt Art Pillars of Strength
```

**Key Insight:** SEC cards are the highest rarity chase cards in each set. They typically have card numbers at the end of the set (e.g., -118, -119, -120, -121, -122).

**eBay Search Terms:**
- "OP01-121 SEC"
- "one piece SEC english"
- "one piece secret rare"

### 2.4 Leader Alt Art Cards

**Naming Pattern:**
```
[CardNumber] [Character] Leader Alt Art [SetName]

Examples:
  OP01-062 Crocodile Leader Alt Art Romance Dawn
  OP01-031 Kouzuki Oden Leader Alt Art Romance Dawn
  OP02-093 Smoker Leader Alt Art Paramount War
```

**Key Insight:** Leader cards have alternate art versions that are separate from regular Alt Art/Parallel cards. They are typically lower card numbers.

**eBay Search Terms:**
- "OP01-062 leader alt art"
- "Crocodile leader one piece"

### 2.5 Manga Art Cards

**Naming Pattern:**
```
[CardNumber] [Character] Manga [SetName]
[CardNumber] Manga Art

Examples:
  OP01-120 Shanks Manga
  OP05-119 Luffy Manga Art
```

**Key Insight:** Manga art variants feature black-and-white manga panel artwork. Very rare and high value. Cambridge TCG doesn't stock many, but eBay has listings.

**eBay Search Terms:**
- "OP01-120 manga"
- "Shanks manga one piece"
- "one piece manga art"

### 2.6 Box Topper / Promo Cards

**Naming Pattern:**
```
[CardNumber] Box Topper
[CardNumber] Promo
[CardNumber] Wanted Poster

Examples:
  OP01-077 Perona Box Topper
  OP01-051 Eustass Kid Wanted Poster
```

**eBay Search Terms:**
- "one piece box topper"
- "OP01 wanted poster"
- "one piece promo"

---

## 3. High-Value Target Cards for Image Collection

### 3.1 Priority 1: Highest Value (£50+)

| Card ID | Character | Variant | Est. Value | Image Priority |
|---------|-----------|---------|------------|----------------|
| OP01-120 | Shanks | Manga | £1,024 | CRITICAL |
| OP01-078 | Boa Hancock | SP | £496 | CRITICAL |
| OP01-016 | Nami | SP | £282 | CRITICAL |
| OP01-003 | Monkey D. Luffy | Parallel | £264 | CRITICAL |
| EB02-SP-OP05-060 | - | SP | £234 | CRITICAL |
| OP01-001 | Roronoa Zoro | Parallel | £201 | CRITICAL |
| OP01-121 | Yamato | SP | £154 | CRITICAL |

### 3.2 Priority 2: High Value (£20-50)

| Card ID | Character | Variant | Est. Value |
|---------|-----------|---------|------------|
| OP01-002 | Trafalgar Law | Parallel | £145 |
| OP01-060 | Donquixote Doflamingo | Parallel | £121 |
| OP01-047 | Trafalgar Law | SP | £117 |
| OP01-078 | Boa Hancock | Parallel | £116 |
| OP05-SP-OP01-121 | Yamato | SP | £93 |
| OP01-024 | Monkey D. Luffy | Parallel | £99 |
| OP01-025 | Roronoa Zoro | Parallel | £90 |

### 3.3 Priority 3: Medium Value (£10-20)

| Card ID | Character | Variant | Est. Value |
|---------|-----------|---------|------------|
| OP01-121 | Yamato | Parallel | £72 |
| OP01-051 | Eustass Kid | Wanted Poster | £68 |
| OP01-073 | Doflamingo | SP | £63 |
| OP01-120 | Shanks | Parallel | £62 |
| OP01-094 | Kaido | Parallel | £57 |
| OP01-013 | Sanji | Parallel | £48 |
| OP01-062 | Crocodile | Parallel | £47 |

---

## 4. Optimized SerpApi Query Templates

### 4.1 English Cards (Primary Market)

```javascript
const ENGLISH_QUERIES = [
  // SEC Cards (Highest rarity)
  {
    name: 'sec_en',
    query: 'one piece tcg SEC english -graded -PSA -CGC -BGS',
    priority: 1,
    expectedVolume: 1500
  },

  // Alt Art / Parallel Cards
  {
    name: 'parallel_en',
    query: 'one piece tcg parallel alt art english -graded -PSA',
    priority: 1,
    expectedVolume: 2000
  },

  // SP Special Rare
  {
    name: 'sp_en',
    query: 'one piece tcg SP special rare english -graded',
    priority: 2,
    expectedVolume: 800
  },

  // Manga Art
  {
    name: 'manga_en',
    query: 'one piece tcg manga art english -graded',
    priority: 2,
    expectedVolume: 200
  },

  // Specific High-Value Cards
  {
    name: 'shanks_variants',
    query: 'OP01-120 Shanks one piece -graded -PSA',
    priority: 1,
    expectedVolume: 500
  },
  {
    name: 'yamato_variants',
    query: 'OP01-121 Yamato one piece -graded -PSA',
    priority: 1,
    expectedVolume: 500
  },
  {
    name: 'nami_sp',
    query: 'OP01-016 Nami parallel SP one piece -graded',
    priority: 1,
    expectedVolume: 400
  },
  {
    name: 'luffy_parallel',
    query: 'OP01-003 Luffy parallel one piece -graded',
    priority: 2,
    expectedVolume: 300
  }
];
```

### 4.2 Japanese Cards (Premium Market)

```javascript
const JAPANESE_QUERIES = [
  // SEC Japanese
  {
    name: 'sec_jp',
    query: 'one piece tcg SEC japanese -graded -PSA',
    priority: 2,
    expectedVolume: 800
  },

  // Alt Art Japanese
  {
    name: 'altart_jp',
    query: 'one piece card game alt art japanese -graded',
    priority: 2,
    expectedVolume: 1500
  },

  // SP Japanese
  {
    name: 'sp_jp',
    query: 'one piece SP special rare japanese -graded',
    priority: 3,
    expectedVolume: 600
  },

  // Romance Dawn (OP01) Japanese
  {
    name: 'op01_jp',
    query: 'romance dawn one piece alt art japanese -graded',
    priority: 3,
    expectedVolume: 400
  }
];
```

### 4.3 Set-Specific Queries

```javascript
const SET_QUERIES = [
  // OP01 Romance Dawn
  { name: 'op01_all', query: 'OP01 one piece parallel alt art -graded', priority: 2 },

  // OP05 Awakening (Popular set)
  { name: 'op05_all', query: 'OP05 awakening one piece alt art -graded', priority: 2 },

  // OP13 Latest Set
  { name: 'op13_all', query: 'OP13 one piece alt art -graded', priority: 1 },

  // Memorial Collection
  { name: 'eb01_all', query: 'EB01 memorial collection one piece -graded', priority: 3 },
  { name: 'eb02_all', query: 'EB02 one piece SP alt art -graded', priority: 2 }
];
```

---

## 5. Image Collection Pipeline Design

### 5.1 S3 Storage Structure

```
s3://tcg-training-data/onepiece-tcg/
├── images/
│   ├── raw/
│   │   ├── 500/                    # 500px (card identification)
│   │   │   ├── {card_id}/
│   │   │   │   ├── {variant}/
│   │   │   │   │   ├── {language}/
│   │   │   │   │   │   ├── {ebay_item_id}.jpg
│   │   ├── 1600/                   # 1600px (condition analysis)
│   │   │   └── ... (same structure)
├── metadata/
│   ├── listings/
│   │   ├── {date}/
│   │   │   ├── {query_name}.jsonl
│   ├── manifest.json
│   ├── labels/
│   │   ├── card_identification.json
│   │   ├── variant_detection.json
│   │   ├── condition_labels.json
```

### 5.2 Title Parsing Patterns

```javascript
const CARD_ID_PATTERNS = [
  // Standard: OP01-120, EB02-061
  /\b(OP\d{2}|EB\d{2}|ST\d{2})-(\d{3})\b/i,

  // With spaces: OP01 - 120
  /\b(OP\d{2}|EB\d{2}|ST\d{2})\s*-\s*(\d{3})\b/i,

  // Without dash: OP01120 (rare)
  /\b(OP\d{2}|EB\d{2}|ST\d{2})(\d{3})\b/i
];

const VARIANT_PATTERNS = {
  'sec': /\b(SEC|secret\s*rare)\b/i,
  'sp': /\b(SP|special\s*rare)\b/i,
  'parallel': /\b(parallel|alt\s*art|alternate\s*art)\b/i,
  'manga': /\b(manga|manga\s*art)\b/i,
  'leader': /\bleader\b/i,
  'boxtopper': /\b(box\s*topper|promo)\b/i,
  'wantedposter': /\bwanted\s*poster\b/i
};

const LANGUAGE_PATTERNS = {
  'EN': /\b(english|eng|EN)\b/i,
  'JP': /\b(japanese|japan|JP|JPN)\b/i
};

const GRADED_EXCLUSION = /\b(PSA|CGC|BGS|graded|\d{1,2}\s*grade)\b/i;
```

### 5.3 Collection Schedule

```
Daily Schedule (27 API calls/day):
├── 08:00 UTC: Priority 1 queries (SEC, Parallel EN)     - 8 queries
├── 12:00 UTC: Priority 2 queries (SP, Manga, JP)        - 10 queries
├── 18:00 UTC: Priority 3 queries (Set-specific)         - 9 queries

Monthly Targets:
├── ~810 SerpApi calls
├── ~100,000+ listing records
├── ~200,000 images (500px + 1600px)
├── Storage: ~50 GB
```

---

## 6. Quality Metrics & Validation

### 6.1 Image Quality Requirements

| Metric | Minimum | Target |
|--------|---------|--------|
| Resolution | 300px | 500-1600px |
| Aspect Ratio | 0.6-0.8 | 0.714 (card ratio) |
| File Size | 20KB | 50-200KB |
| Card Visibility | 70% frame | 90%+ frame |
| Background | Any | Solid preferred |

### 6.2 Deduplication Keys

```javascript
// Primary key: eBay item ID
const primaryKey = listing.ebayItemId;

// Fuzzy dedup: Same card from same seller
const fuzzyKey = `${cardId}|${variantType}|${sellerId}|${Math.floor(priceUsd/5)*5}`;
```

### 6.3 Label Confidence Scoring

```javascript
function calculateConfidence(listing) {
  let score = 0.5; // Base confidence

  // Card ID extraction
  if (listing.cardId && CARD_ID_PATTERNS[0].test(listing.title)) {
    score += 0.2; // Strong match
  }

  // Variant type explicit
  if (Object.values(VARIANT_PATTERNS).some(p => p.test(listing.title))) {
    score += 0.15;
  }

  // Language explicit
  if (Object.values(LANGUAGE_PATTERNS).some(p => p.test(listing.title))) {
    score += 0.1;
  }

  // Not graded (cleaner images)
  if (!GRADED_EXCLUSION.test(listing.title)) {
    score += 0.05;
  }

  return Math.min(score, 1.0);
}
```

---

## 7. Training Data Requirements

### 7.1 Minimum Viable Dataset

| Model | Task | Min Images | Target |
|-------|------|------------|--------|
| M1a ViT | Card ID | 50/card | 100/card |
| M1b Condition | Grading | 10,000 | 50,000 |
| Variant Detection | Type | 500/type | 2,000/type |

### 7.2 Current Progress (2026-01-09)

| Collection | Images | Cards | Coverage |
|------------|--------|-------|----------|
| SEC English | 464 | 25 | 19 avg/card |
| OP01 Variants | 1,148 | 27 | 42 avg/card |
| **Total** | **1,612** | **~40** | **5%** |

### 7.3 Gap Analysis

**Missing Variant Types:**
- Manga Art: 0 images (CRITICAL)
- Box Topper: 30 images (need 500+)
- Leader Alt Art: ~50 images (need 500+)

**Under-represented Sets:**
- OP02-OP04: Low coverage
- OP10-OP13: Newer sets, limited sold data
- EB02 SP: High value, low volume

---

## 8. Next Steps

1. **Implement expanded query set** with naming conventions
2. **Run daily collection** targeting 1,000+ new images/day
3. **Build user feedback interface** for label verification
4. **Monitor quality metrics** and adjust queries
5. **Expand to other TCGs** using same patterns

---

*Document Version: 1.0.0*
*Last Updated: 2026-01-09*
