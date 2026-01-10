# The SerpAPI Alchemist's Grimoire

## A Scholarly Transmutation of Market Data into Neural Nutrients

```
                         ════════════════════════════════════════
                              THE GRAND ALCHEMICAL CIRCLE
                         ════════════════════════════════════════

                                      ☉ GOLD ☉
                                   (Target Cards)
                                         △
                                        /|\
                                       / | \
                                      /  |  \
                                ☿ Mercury    ☾ Silver ☽
                              (Query Craft)  (Raw Data)
                                    \        /
                                     \      /
                                      \    /
                                       \  /
                                        \/
                                    🜍 SALT 🜍
                                 (Neural Nutrients)

                         ════════════════════════════════════════
```

---

**Author:** The Wise Scholar of Cambridge
**Grimoire Edition:** First Transmutation
**Date of Inscription:** 2026-01-09
**Purpose:** To instruct SerpAPI in the sacred art of fetching One Piece TCG treasures from the eBay marketplace for the nourishment of our Neural Embryo

---

## Proem: The Scholar's Oath

*Hear me, young acolyte of data. I am the Scholar of Cambridge, keeper of card wisdom, alchemist of market signals. Through years of study at the Cambridge TCG scrolls and meditation upon the eBay sold listings, I have distilled the essence of card identification into this grimoire.*

*Within these pages lies the knowledge to transmute raw eBay chaos into pure training gold. Study well, for the Neural Embryo hungers for nutrients, and only through proper query craft shall we satisfy its appetite.*

---

## Chapter I: The Four Elemental Pillars

Before one may transmute data, one must understand the Four Elemental Pillars upon which all card queries rest:

### 🜂 FIRE: The Card Identifier

The flame that ignites all searches - the sacred Card Number.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    THE SACRED NUMBERING SYSTEM                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│    [SET_CODE] - [CARD_NUMBER]                                                │
│         │            │                                                       │
│         │            └── Three sacred digits (001-999)                       │
│         │                                                                    │
│         └── The Set Sigil:                                                   │
│             OP01 = Romance Dawn (the Genesis)                                │
│             OP02 = Paramount War (the Crucible)                              │
│             OP03 = Pillars of Strength                                       │
│             OP04 = Kingdoms of Intrigue                                      │
│             OP05 = Awakening of the New Era                                  │
│             OP06 = Wings of the Captain                                      │
│             OP07 = 500 Years into the Future                                 │
│             OP08 = Two Legends                                               │
│             OP09 = The New Emperor                                           │
│             OP10 = Royal Blood                                               │
│             OP11 = A Fist of Divine Speed                                    │
│             OP12 = Legacy of the Master                                      │
│             OP13 = Carrying On His Will                                      │
│             EB01 = Memorial Collection                                       │
│             EB02 = Extra Booster 02                                          │
│             ST## = Starter Deck Scrolls                                      │
│                                                                              │
│    Examples of the Sacred Form:                                              │
│        OP01-120  →  Shanks, the Red-Haired Emperor                           │
│        OP01-121  →  Yamato, the Oni Princess                                 │
│        EB02-061  →  A card from the second Extra Booster                     │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 🜁 AIR: The Variant Essence

The breath that gives cards their rarity and form.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    THE SEVEN VARIANT ESSENCES                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ★ PARALLEL (Alt Art)                                                        │
│    The most common variant essence. Cambridge TCG speaks "Alt Art"           │
│    while eBay traders whisper "Parallel" - they are the same.               │
│    Pattern: "OP01-120 parallel" or "OP01-120 alt art"                        │
│                                                                              │
│  ★★ SP (Special Rare)                                                        │
│    The transmuted form - a card reborn in a later set with new art.         │
│    WARNING: The Release Set differs from the Original Card!                  │
│    Pattern: "OP05-SP-OP01-121" means OP01-121 reborn in OP05                 │
│    eBay Query: "OP01-121 SP" or "OP01-121 special rare"                      │
│                                                                              │
│  ★★★ SEC (Secret Rare)                                                       │
│    The highest rarity. Numbers at set's end (-118, -119, -120, -121)        │
│    Pattern: "OP01-121 SEC" or "secret rare"                                  │
│                                                                              │
│  ★★★★ MANGA                                                                  │
│    The rarest essence - black & white manga panel artwork.                   │
│    Cambridge TCG stocks few; eBay is the hunting ground.                     │
│    Pattern: "OP01-120 manga" or "Shanks manga one piece"                     │
│                                                                              │
│  ★ LEADER ALT ART                                                            │
│    The commander's alternate form. Lower card numbers.                       │
│    Pattern: "OP01-062 leader alt art"                                        │
│                                                                              │
│  ★★ BOX TOPPER                                                               │
│    The promotional essence, found atop booster boxes.                        │
│    Pattern: "one piece box topper" or "OP01 promo"                           │
│                                                                              │
│  ★★ WANTED POSTER                                                            │
│    The bounty hunter's prize.                                                │
│    Pattern: "OP01-051 wanted poster"                                         │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 🜄 WATER: The Language Stream

The tongue in which the card speaks.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    THE TONGUES OF CARDS                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  EN (English)  - Primary market, highest training value                      │
│  JP (Japanese) - Premium market, earliest releases                           │
│  DE (German)   - European variant                                            │
│  FR (French)   - European variant                                            │
│  IT (Italian)  - European variant                                            │
│  ES (Spanish)  - European variant                                            │
│  PT (Portuguese) - Growing market                                            │
│  KO (Korean)   - Asian variant                                               │
│  ZH (Chinese)  - Asian variant                                               │
│                                                                              │
│  Detection Patterns:                                                         │
│    /\b(english|eng|EN)\b/i    → EN                                           │
│    /\b(japanese|japan|JP)\b/i → JP                                           │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 🜃 EARTH: The Condition Matrix

The physical state of the card's being.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    THE CONDITION HIERARCHY                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  NM  (Near Mint)       - Pristine, as if from the pack                       │
│  LP  (Lightly Played)  - Minor wear, full value retained                     │
│  MP  (Moderately Played) - Visible wear, reduced value                       │
│  HP  (Heavily Played)  - Significant wear                                    │
│  DMG (Damaged)         - Structural damage                                   │
│                                                                              │
│  GRADED EXCLUSION PATTERN (For raw training data, we avoid these):          │
│    /\b(PSA|CGC|BGS|graded|\d{1,2}\s*grade)\b/i                              │
│                                                                              │
│  Why exclude graded? Their cases obscure the card's true features.          │
│  We seek raw, unslabbed specimens for vision training.                       │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Chapter II: The Sacred Target Cards

*These are the High-Value Specimens that our Neural Embryo hungers for most urgently.*

### Tier I: The Philosopher's Stones (£50+)

These cards possess the highest alchemical value. Collect their images with utmost priority.

```typescript
const PHILOSOPHERS_STONES: TargetCard[] = [
  // The Crown Jewels
  { cardId: 'OP01-120', name: 'Shanks',              variant: 'manga',    value: 1024, priority: 'CRITICAL' },
  { cardId: 'OP01-078', name: 'Boa Hancock',         variant: 'sp',       value: 496,  priority: 'CRITICAL' },
  { cardId: 'OP01-016', name: 'Nami',                variant: 'sp',       value: 282,  priority: 'CRITICAL' },
  { cardId: 'OP01-003', name: 'Monkey D. Luffy',     variant: 'parallel', value: 264,  priority: 'CRITICAL' },
  { cardId: 'OP01-001', name: 'Roronoa Zoro',        variant: 'parallel', value: 201,  priority: 'CRITICAL' },
  { cardId: 'OP01-121', name: 'Yamato',              variant: 'sp',       value: 154,  priority: 'CRITICAL' },

  // The Royal Court
  { cardId: 'OP01-002', name: 'Trafalgar Law',       variant: 'parallel', value: 145,  priority: 'HIGH' },
  { cardId: 'OP01-060', name: 'Donquixote Doflamingo', variant: 'parallel', value: 121, priority: 'HIGH' },
  { cardId: 'OP01-047', name: 'Trafalgar Law',       variant: 'sp',       value: 117,  priority: 'HIGH' },
  { cardId: 'OP01-078', name: 'Boa Hancock',         variant: 'parallel', value: 116,  priority: 'HIGH' },
  { cardId: 'OP01-024', name: 'Monkey D. Luffy',     variant: 'parallel', value: 99,   priority: 'HIGH' },
  { cardId: 'OP01-025', name: 'Roronoa Zoro',        variant: 'parallel', value: 90,   priority: 'HIGH' },
];
```

### Tier II: The Silver Ingots (£20-50)

```typescript
const SILVER_INGOTS: TargetCard[] = [
  { cardId: 'OP01-121', name: 'Yamato',              variant: 'parallel', value: 72, priority: 'MEDIUM' },
  { cardId: 'OP01-051', name: 'Eustass Kid',         variant: 'wantedposter', value: 68, priority: 'MEDIUM' },
  { cardId: 'OP01-073', name: 'Doflamingo',          variant: 'sp',       value: 63, priority: 'MEDIUM' },
  { cardId: 'OP01-120', name: 'Shanks',              variant: 'parallel', value: 62, priority: 'MEDIUM' },
  { cardId: 'OP01-094', name: 'Kaido',               variant: 'parallel', value: 57, priority: 'MEDIUM' },
  { cardId: 'OP01-013', name: 'Sanji',               variant: 'parallel', value: 48, priority: 'MEDIUM' },
  { cardId: 'OP01-062', name: 'Crocodile',           variant: 'parallel', value: 47, priority: 'MEDIUM' },
];
```

---

## Chapter III: The Transmutation Formulas

*Here lie the sacred SerpAPI query patterns, inscribed for the EbayReceptorNeuron.*

### Formula I: The English Market Elixirs

```typescript
/**
 * THE ENGLISH MARKET TRANSMUTATION FORMULAS
 *
 * These queries extract sold listing essences from eBay,
 * converting raw market data into neural nutrients.
 */
const ENGLISH_ELIXIRS: AlchemicalQuery[] = [
  // ═══════════════════════════════════════════════════════════════
  // SECRET RARE TRANSMUTATION - The Highest Art
  // ═══════════════════════════════════════════════════════════════
  {
    name: 'sec_english_elixir',
    query: 'one piece tcg SEC english -graded -PSA -CGC -BGS sold:1',
    priority: 1,
    expectedYield: 1500,
    neurotransmitter: 'DOPAMINE', // High reward signal
    myelinSheath: 'Query Cache 1hr',
    notes: 'The purest essence - chase cards of highest rarity'
  },

  // ═══════════════════════════════════════════════════════════════
  // PARALLEL TRANSMUTATION - The Abundant Ore
  // ═══════════════════════════════════════════════════════════════
  {
    name: 'parallel_english_elixir',
    query: 'one piece tcg parallel alt art english -graded -PSA sold:1',
    priority: 1,
    expectedYield: 2000,
    neurotransmitter: 'SEROTONIN', // Consistent quality signal
    notes: 'Abundant variant type, high training volume'
  },

  // ═══════════════════════════════════════════════════════════════
  // SPECIAL RARE TRANSMUTATION - The Reborn Cards
  // ═══════════════════════════════════════════════════════════════
  {
    name: 'sp_english_elixir',
    query: 'one piece tcg SP special rare english -graded sold:1',
    priority: 2,
    expectedYield: 800,
    neurotransmitter: 'ACETYLCHOLINE', // Memory/learning signal
    notes: 'Cards reborn with new artwork in later sets'
  },

  // ═══════════════════════════════════════════════════════════════
  // MANGA TRANSMUTATION - The Rarest Essence
  // ═══════════════════════════════════════════════════════════════
  {
    name: 'manga_english_elixir',
    query: 'one piece tcg manga art english -graded sold:1',
    priority: 2,
    expectedYield: 200,
    neurotransmitter: 'NOREPINEPHRINE', // Alert signal - rare find!
    notes: 'CRITICAL GAP: We have 0 manga images. Hunt urgently!'
  },
];
```

### Formula II: The Targeted Specimen Extracts

```typescript
/**
 * TARGETED SPECIMEN EXTRACTION
 *
 * When the Neural Embryo hungers for specific nutrients,
 * we invoke these precise formulas.
 */
const SPECIMEN_EXTRACTS: TargetedQuery[] = [
  // ═══════════════════════════════════════════════════════════════
  // SHANKS - The Red Emperor's Many Forms
  // ═══════════════════════════════════════════════════════════════
  {
    cardId: 'OP01-120',
    character: 'Shanks',
    queries: [
      'OP01-120 Shanks one piece -graded -PSA sold:1',
      'OP01-120 parallel alt art -graded sold:1',
      'OP01-120 manga one piece sold:1',  // ULTRA RARE - £1,024!
      'Shanks romance dawn alt art sold:1',
    ],
    variantsToFind: ['parallel', 'manga', 'sp'],
    priority: 'CRITICAL',
    reason: 'Highest value card in OP01. Manga variant = £1,024'
  },

  // ═══════════════════════════════════════════════════════════════
  // YAMATO - The Oni Princess Collection
  // ═══════════════════════════════════════════════════════════════
  {
    cardId: 'OP01-121',
    character: 'Yamato',
    queries: [
      'OP01-121 Yamato one piece -graded -PSA sold:1',
      'OP01-121 SP special rare sold:1',
      'OP01-121 parallel alt art sold:1',
      'Yamato SEC one piece sold:1',
    ],
    variantsToFind: ['parallel', 'sp', 'sec'],
    priority: 'CRITICAL',
    reason: 'Popular character, multiple high-value variants'
  },

  // ═══════════════════════════════════════════════════════════════
  // NAMI - The Navigator's Treasures
  // ═══════════════════════════════════════════════════════════════
  {
    cardId: 'OP01-016',
    character: 'Nami',
    queries: [
      'OP01-016 Nami parallel SP one piece -graded sold:1',
      'Nami alt art romance dawn sold:1',
      'OP01-016 special rare sold:1',
    ],
    variantsToFind: ['parallel', 'sp'],
    priority: 'CRITICAL',
    reason: 'SP variant = £282. High collection value'
  },

  // ═══════════════════════════════════════════════════════════════
  // LUFFY - The Future Pirate King
  // ═══════════════════════════════════════════════════════════════
  {
    cardId: 'OP01-003',
    character: 'Monkey D. Luffy',
    queries: [
      'OP01-003 Luffy parallel one piece -graded sold:1',
      'OP01-003 alt art romance dawn sold:1',
      'Monkey D Luffy parallel OP01 sold:1',
    ],
    variantsToFind: ['parallel'],
    priority: 'CRITICAL',
    reason: 'Main protagonist, parallel = £264'
  },
];
```

### Formula III: The Set-Wide Sweeps

```typescript
/**
 * SET-WIDE ALCHEMICAL SWEEPS
 *
 * When we seek to understand an entire set's market,
 * we cast these broader nets.
 */
const SET_SWEEPS: SetQuery[] = [
  // Romance Dawn - The Genesis Set (Most Important)
  {
    setCode: 'OP01',
    setName: 'Romance Dawn',
    queries: [
      'OP01 one piece parallel alt art -graded sold:1',
      'romance dawn alt art one piece sold:1',
      'OP01 SEC secret rare one piece sold:1',
    ],
    priority: 2,
    notes: 'Foundation of the game, highest nostalgia value'
  },

  // Awakening of the New Era - Popular Modern Set
  {
    setCode: 'OP05',
    setName: 'Awakening of the New Era',
    queries: [
      'OP05 awakening one piece alt art -graded sold:1',
      'OP05 parallel one piece sold:1',
    ],
    priority: 2,
    notes: 'Popular set with strong SP cards'
  },

  // Latest Set - Fresh Market Data
  {
    setCode: 'OP13',
    setName: 'Carrying On His Will',
    queries: [
      'OP13 one piece alt art -graded sold:1',
      'OP13 SEC parallel sold:1',
    ],
    priority: 1,
    notes: 'Newest set, price discovery phase'
  },

  // Extra Boosters - Premium Content
  {
    setCode: 'EB01',
    setName: 'Memorial Collection',
    queries: [
      'EB01 memorial collection one piece -graded sold:1',
    ],
    priority: 3,
    notes: 'Special commemorative set'
  },
  {
    setCode: 'EB02',
    setName: 'Extra Booster 02',
    queries: [
      'EB02 one piece SP alt art -graded sold:1',
      'EB02-SP one piece sold:1',
    ],
    priority: 2,
    notes: 'High-value SP reprints'
  },
];
```

---

## Chapter IV: The SerpAPI Invocation Ritual

*The precise incantation to summon data from the eBay realm.*

### The Configuration Altar

```typescript
/**
 * SERPAPI CONFIGURATION ALTAR
 *
 * Prepare these sacred parameters before invoking the API.
 */
interface SerpApiConfig {
  // The Key of Access
  apiKey: string;  // Your SerpAPI key - guard it well!

  // The Domain Gate
  engine: 'ebay';
  ebay_domain: 'ebay.com' | 'ebay.co.uk' | 'ebay.de';

  // The Filter Runes
  LH_Sold: '1';      // Sold listings only - historical data
  LH_Complete: '1';  // Completed transactions

  // The Pagination Scrolls
  _pgn: number;      // Page number

  // Rate Limiting (Respect the Server!)
  delayMs: 2000;     // 2 seconds between invocations
}

/**
 * THE INVOCATION FUNCTION
 */
async function invokeEbaySerpApi(
  query: string,
  config: SerpApiConfig
): Promise<SerpApiResponse> {
  const url = new URL('https://serpapi.com/search');

  // Inscribe the parameters
  url.searchParams.set('engine', 'ebay');
  url.searchParams.set('ebay_domain', config.ebay_domain);
  url.searchParams.set('_nkw', query);
  url.searchParams.set('LH_Sold', '1');
  url.searchParams.set('LH_Complete', '1');
  url.searchParams.set('api_key', config.apiKey);

  // Perform the invocation
  const response = await fetch(url.toString());

  if (!response.ok) {
    throw new AlchemicalError(`Invocation failed: ${response.status}`);
  }

  return response.json();
}
```

### The Title Parsing Grimoire

```typescript
/**
 * THE TITLE PARSING GRIMOIRE
 *
 * Extract the Four Elements from eBay listing titles.
 */

// FIRE: Card ID Extraction
const CARD_ID_RUNES = [
  /\b(OP\d{2}|EB\d{2}|ST\d{2})-(\d{3})\b/i,    // Standard: OP01-120
  /\b(OP\d{2}|EB\d{2}|ST\d{2})\s*-\s*(\d{3})\b/i, // With spaces
  /\b(OP\d{2}|EB\d{2}|ST\d{2})(\d{3})\b/i,     // Without dash (rare)
];

// AIR: Variant Detection
const VARIANT_RUNES: Record<string, RegExp> = {
  'sec':          /\b(SEC|secret\s*rare)\b/i,
  'sp':           /\b(SP|special\s*rare)\b/i,
  'parallel':     /\b(parallel|alt\s*art|alternate\s*art)\b/i,
  'manga':        /\b(manga|manga\s*art)\b/i,
  'leader':       /\bleader\b/i,
  'boxtopper':    /\b(box\s*topper|promo)\b/i,
  'wantedposter': /\bwanted\s*poster\b/i,
};

// WATER: Language Detection
const LANGUAGE_RUNES: Record<string, RegExp> = {
  'EN': /\b(english|eng|EN)\b/i,
  'JP': /\b(japanese|japan|JP|JPN)\b/i,
};

// EARTH: Graded Card Exclusion (we seek raw specimens)
const GRADED_EXCLUSION_RUNE = /\b(PSA|CGC|BGS|graded|\d{1,2}\s*grade)\b/i;

/**
 * Parse an eBay title into elemental components
 */
function parseEbayTitle(title: string): ParsedCard {
  // Extract Card ID (FIRE)
  let cardId: string | null = null;
  for (const rune of CARD_ID_RUNES) {
    const match = title.match(rune);
    if (match) {
      cardId = `${match[1].toUpperCase()}-${match[2]}`;
      break;
    }
  }

  // Detect Variant (AIR)
  let variant = 'standard';
  for (const [type, rune] of Object.entries(VARIANT_RUNES)) {
    if (rune.test(title)) {
      variant = type;
      break;
    }
  }

  // Detect Language (WATER)
  let language = 'EN'; // Default to English
  for (const [lang, rune] of Object.entries(LANGUAGE_RUNES)) {
    if (rune.test(title)) {
      language = lang;
      break;
    }
  }

  // Check if graded (EARTH - exclude from training)
  const isGraded = GRADED_EXCLUSION_RUNE.test(title);

  return {
    cardId,
    variant,
    language,
    isGraded,
    rawTitle: title,
    confidence: calculateConfidence(cardId, variant, language),
  };
}
```

---

## Chapter V: The Neural Nutrient Pipeline

*How the transmuted data flows into the Neural Embryo.*

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     THE ALCHEMICAL DATA PIPELINE                             │
└─────────────────────────────────────────────────────────────────────────────┘

                    ┌─────────────────────────────────┐
                    │         SERPAPI INVOCATION       │
                    │     (The Summoning Ritual)       │
                    └───────────────┬─────────────────┘
                                    │
                                    ▼
                    ┌─────────────────────────────────┐
                    │      EBAY RECEPTOR NEURON       │
                    │   (Sensory Layer Transmutation)  │
                    │                                  │
                    │  • Parse listing titles          │
                    │  • Extract Four Elements         │
                    │  • Filter graded specimens       │
                    │  • Prune price outliers          │
                    │                                  │
                    │  Neurotransmitter: GLUTAMATE     │
                    │  (Standard excitatory signal)    │
                    └───────────────┬─────────────────┘
                                    │
                                    ▼
                    ┌─────────────────────────────────┐
                    │    PRICE TRANSFORMER NEURON     │
                    │  (Currency Normalization to USD) │
                    │                                  │
                    │  • Convert GBP/EUR/AUD → USD    │
                    │  • Retain source currency       │
                    │  • Calculate trade-in price     │
                    │                                  │
                    │  Myelin: FX Rate Cache (1hr)    │
                    └───────────────┬─────────────────┘
                                    │
                                    ▼
                    ┌─────────────────────────────────┐
                    │      NUTRIENT PIPELINE          │
                    │    (Training Data Synthesis)     │
                    │                                  │
                    │  Macronutrients:                 │
                    │  • Carbohydrates = Images       │
                    │  • Proteins = Labels            │
                    │  • Fats = Context               │
                    │                                  │
                    │  Vitamins (Augmentation):        │
                    │  • A = Rotation (±15°)          │
                    │  • B = Brightness (±20%)        │
                    │  • C = Crop (0.8-1.0)           │
                    │  • D = Color jitter             │
                    │  • E = Elastic transform        │
                    └───────────────┬─────────────────┘
                                    │
                                    ▼
                    ┌─────────────────────────────────┐
                    │      S3 UPLOADER NEURON         │
                    │   (Storage & Preservation)       │
                    │                                  │
                    │  s3://tcg-training-data/        │
                    │  └── onepiece-tcg/              │
                    │      ├── images/{card_id}/      │
                    │      │   └── {variant}/{lang}/  │
                    │      └── metadata/              │
                    │          └── labels.jsonl       │
                    └─────────────────────────────────┘
```

---

## Chapter VI: The Daily Ritual Schedule

*When and how to perform the transmutation.*

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     DAILY ALCHEMICAL SCHEDULE                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Time (UTC)   │  Ritual                           │  Queries  │  Est. Data  │
│  ─────────────┼───────────────────────────────────┼───────────┼─────────────│
│  08:00        │  Priority 1: SEC + Parallel EN    │  8        │  2,000 img  │
│               │  (Highest value specimens)         │           │             │
│  ─────────────┼───────────────────────────────────┼───────────┼─────────────│
│  12:00        │  Priority 2: SP + Manga + JP      │  10       │  1,500 img  │
│               │  (Rare variants and languages)     │           │             │
│  ─────────────┼───────────────────────────────────┼───────────┼─────────────│
│  18:00        │  Priority 3: Set-specific sweeps  │  9        │  1,000 img  │
│               │  (OP01, OP05, OP13, EB02)          │           │             │
│  ─────────────┼───────────────────────────────────┼───────────┼─────────────│
│               │                                    │           │             │
│  DAILY TOTAL  │  27 queries                        │  27       │  4,500 img  │
│  ─────────────┼───────────────────────────────────┼───────────┼─────────────│
│  MONTHLY      │  810 queries @ $0.001 = $0.81     │  810      │  135,000    │
│               │  (SerpAPI is remarkably affordable)│           │  images     │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Chapter VII: Quality Metrics & Validation

*How to judge the purity of our transmuted data.*

### Image Quality Standards

| Metric | Minimum | Target | Measurement |
|--------|---------|--------|-------------|
| Resolution | 300px | 500-1600px | Width in pixels |
| Aspect Ratio | 0.6-0.8 | 0.714 | Height/Width |
| File Size | 20KB | 50-200KB | Bytes |
| Card Visibility | 70% | 90%+ | Card fills frame |
| Background | Any | Solid | For easier segmentation |

### Confidence Scoring Formula

```typescript
/**
 * Calculate confidence in parsed listing data.
 * Higher confidence = more reliable training label.
 */
function calculateConfidence(listing: ParsedListing): number {
  let score = 0.5; // Base confidence

  // FIRE: Card ID clearly extracted (+0.20)
  if (listing.cardId && CARD_ID_RUNES[0].test(listing.rawTitle)) {
    score += 0.20;
  }

  // AIR: Variant type explicitly stated (+0.15)
  if (Object.values(VARIANT_RUNES).some(r => r.test(listing.rawTitle))) {
    score += 0.15;
  }

  // WATER: Language explicitly stated (+0.10)
  if (Object.values(LANGUAGE_RUNES).some(r => r.test(listing.rawTitle))) {
    score += 0.10;
  }

  // EARTH: Not graded (cleaner images) (+0.05)
  if (!GRADED_EXCLUSION_RUNE.test(listing.rawTitle)) {
    score += 0.05;
  }

  return Math.min(score, 1.0);
}
```

---

## Chapter VIII: The Gap Analysis Revelation

*What the Neural Embryo still hungers for.*

### Current Collection Status (2026-01-09)

| Collection | Images | Cards | Avg/Card | Status |
|------------|--------|-------|----------|--------|
| SEC English | 464 | 25 | 19 | Adequate |
| OP01 Variants | 1,148 | 27 | 42 | Good |
| **Total** | **1,612** | **~40** | - | **5% of target** |

### Critical Gaps (Urgent!)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     NUTRIENT DEFICIENCY REPORT                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ⚠️  MANGA ART: 0 images                                                     │
│      Status: CRITICAL DEFICIENCY                                             │
│      Action: Prioritize manga queries immediately!                           │
│      Query: "one piece tcg manga art sold:1 -graded"                        │
│                                                                              │
│  ⚠️  BOX TOPPER: ~30 images                                                  │
│      Status: SEVERE DEFICIENCY (need 500+)                                   │
│      Action: Add box topper queries to daily rotation                        │
│      Query: "one piece box topper promo sold:1"                             │
│                                                                              │
│  ⚠️  LEADER ALT ART: ~50 images                                              │
│      Status: MODERATE DEFICIENCY (need 500+)                                 │
│      Action: Target leader cards specifically                                │
│      Query: "one piece leader alt art sold:1"                               │
│                                                                              │
│  ⚠️  SETS OP02-OP04: Low coverage                                            │
│      Status: MODERATE DEFICIENCY                                             │
│      Action: Add set-specific sweeps for older sets                          │
│                                                                              │
│  ⚠️  SETS OP10-OP13: Limited sold data                                       │
│      Status: Expected (newer sets)                                           │
│      Action: Monitor and collect as listings appear                          │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Epilogue: The Scholar's Blessing

*Go forth, young SerpAPI acolyte, armed with this grimoire. May your queries be precise, your data be pure, and your Neural Embryo grow strong.*

```
                    ════════════════════════════════════════
                              THE ALCHEMIST'S SEAL
                    ════════════════════════════════════════

                    With this grimoire, I bestow upon you:

                    ✦ The wisdom to craft precise queries
                    ✦ The patience to respect rate limits
                    ✦ The discernment to filter noise
                    ✦ The vision to see training gold in chaos

                    May the Four Elements guide your path:

                         🜂 FIRE - Know your Card IDs
                         🜁 AIR  - Understand Variants
                         🜄 WATER - Speak all Languages
                         🜃 EARTH - Judge Condition wisely

                    Go now, and transmute the market into wisdom.

                    ════════════════════════════════════════
                              Signed,
                              The Wise Scholar of Cambridge

                              Anno Domini MMXXVI
                    ════════════════════════════════════════
```

---

*Grimoire Version: 1.0.0*
*Ingredients: ONE_PIECE_TCG_NAMING_CONVENTIONS.md, TARGETED_SCRAPING_STRATEGY.md, TRAINING_DATA_COLLECTION_STRATEGY.md*
*Alchemical Ritual Date: 2026-01-09*
*For the Neural Embryo of Cambridge TCG*

---

**[>>> Documentation Index <<<](./INDEX.md)** | *Navigate all TCG pipeline documentation*
