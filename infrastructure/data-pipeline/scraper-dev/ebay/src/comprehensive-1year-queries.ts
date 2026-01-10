/**
 * Comprehensive 1-Year eBay Collection Queries
 *
 * Exhausts 1000 SerpAPI searches to collect alt art / rare card data
 * from the past year. Targets Cambridge TCG listed variants.
 *
 * Strategy:
 * - 1000 total searches allocated across:
 *   - High-value specific cards: 300 searches
 *   - Set-specific SEC/SP/Parallel: 400 searches
 *   - Variant-type broad queries: 200 searches
 *   - Condition training (graded): 100 searches
 *
 * Created: 2026-01-09
 */

export interface ComprehensiveQuery {
  name: string;
  query: string;
  priority: number;
  searches: number; // Number of searches allocated (pages to fetch)
  targetVariant?: string;
  targetLanguage?: 'EN' | 'JP' | 'ALL';
  expectedListings: number;
  notes?: string;
}

// =============================================================================
// HIGH-VALUE SPECIFIC CARDS (300 searches)
// Based on Cambridge TCG price data - cards £50+
// =============================================================================

export const HIGH_VALUE_CARDS: ComprehensiveQuery[] = [
  // OP01-120 Shanks - Multiple high-value variants (~£1,024 manga, £62 parallel)
  {
    name: 'op01_120_shanks_manga',
    query: '"OP01-120" Shanks manga one piece -PSA -CGC -graded -lot -bundle',
    priority: 1,
    searches: 10,
    targetVariant: 'manga',
    expectedListings: 100,
    notes: 'Highest value card ~£1,024',
  },
  {
    name: 'op01_120_shanks_parallel',
    query: '"OP01-120" Shanks parallel alt art one piece -graded -lot',
    priority: 1,
    searches: 8,
    targetVariant: 'parallel',
    expectedListings: 160,
  },
  {
    name: 'op01_120_shanks_all',
    query: '"OP01-120" Shanks one piece -lot -bundle -graded',
    priority: 2,
    searches: 5,
    expectedListings: 100,
  },

  // OP01-121 Yamato - SP (~£154) and Parallel (~£72)
  {
    name: 'op01_121_yamato_sp',
    query: '"OP01-121" Yamato SP special one piece -graded -lot',
    priority: 1,
    searches: 8,
    targetVariant: 'sp',
    expectedListings: 160,
  },
  {
    name: 'op01_121_yamato_parallel',
    query: '"OP01-121" Yamato parallel alt art one piece -graded -lot',
    priority: 1,
    searches: 6,
    targetVariant: 'parallel',
    expectedListings: 120,
  },

  // OP01-078 Boa Hancock - SP (~£496), Parallel (~£116)
  {
    name: 'op01_078_hancock_sp',
    query: '"OP01-078" Hancock SP special one piece -graded -lot',
    priority: 1,
    searches: 8,
    targetVariant: 'sp',
    expectedListings: 160,
    notes: '~£496 value',
  },
  {
    name: 'op01_078_hancock_parallel',
    query: '"OP01-078" Hancock parallel alt art one piece -graded -lot',
    priority: 1,
    searches: 6,
    targetVariant: 'parallel',
    expectedListings: 120,
  },

  // OP01-016 Nami - SP (~£282)
  {
    name: 'op01_016_nami_sp',
    query: '"OP01-016" Nami SP special parallel one piece -graded -lot',
    priority: 1,
    searches: 8,
    targetVariant: 'sp',
    expectedListings: 160,
    notes: '~£282 value',
  },

  // OP01-003 Luffy - Parallel (~£264)
  {
    name: 'op01_003_luffy_parallel',
    query: '"OP01-003" Luffy parallel alt art one piece -graded -lot',
    priority: 1,
    searches: 8,
    targetVariant: 'parallel',
    expectedListings: 160,
    notes: '~£264 value',
  },

  // OP01-001 Zoro - Parallel (~£201)
  {
    name: 'op01_001_zoro_parallel',
    query: '"OP01-001" Zoro parallel alt art one piece -graded -lot',
    priority: 1,
    searches: 6,
    targetVariant: 'parallel',
    expectedListings: 120,
  },

  // OP01-002 Law - Parallel (~£145)
  {
    name: 'op01_002_law_parallel',
    query: '"OP01-002" "Trafalgar Law" parallel alt art one piece -graded -lot',
    priority: 1,
    searches: 6,
    targetVariant: 'parallel',
    expectedListings: 120,
  },

  // OP01-060 Doflamingo - Parallel (~£121)
  {
    name: 'op01_060_doflamingo_parallel',
    query: '"OP01-060" Doflamingo parallel alt art one piece -graded -lot',
    priority: 2,
    searches: 5,
    targetVariant: 'parallel',
    expectedListings: 100,
  },

  // OP01-047 Law - SP (~£117)
  {
    name: 'op01_047_law_sp',
    query: '"OP01-047" Law SP special one piece -graded -lot',
    priority: 2,
    searches: 5,
    targetVariant: 'sp',
    expectedListings: 100,
  },

  // OP01-024/025 Luffy/Zoro - Parallel (~£99/£90)
  {
    name: 'op01_024_luffy_parallel',
    query: '"OP01-024" Luffy parallel one piece -graded -lot',
    priority: 2,
    searches: 4,
    targetVariant: 'parallel',
    expectedListings: 80,
  },
  {
    name: 'op01_025_zoro_parallel',
    query: '"OP01-025" Zoro parallel one piece -graded -lot',
    priority: 2,
    searches: 4,
    targetVariant: 'parallel',
    expectedListings: 80,
  },

  // OP01-051 Kid - Wanted Poster (~£68)
  {
    name: 'op01_051_kid_wanted',
    query: '"OP01-051" Kid wanted poster one piece -graded -lot',
    priority: 2,
    searches: 4,
    targetVariant: 'wantedposter',
    expectedListings: 80,
  },

  // OP01-073 Doflamingo - SP (~£63)
  {
    name: 'op01_073_doflamingo_sp',
    query: '"OP01-073" Doflamingo SP special one piece -graded -lot',
    priority: 2,
    searches: 4,
    targetVariant: 'sp',
    expectedListings: 80,
  },

  // OP01-094 Kaido - Parallel (~£57)
  {
    name: 'op01_094_kaido_parallel',
    query: '"OP01-094" Kaido parallel one piece -graded -lot',
    priority: 2,
    searches: 4,
    targetVariant: 'parallel',
    expectedListings: 80,
  },

  // OP01-013 Sanji - Parallel (~£48)
  {
    name: 'op01_013_sanji_parallel',
    query: '"OP01-013" Sanji parallel one piece -graded -lot',
    priority: 2,
    searches: 4,
    targetVariant: 'parallel',
    expectedListings: 80,
  },

  // OP01-062 Crocodile - Parallel (~£47)
  {
    name: 'op01_062_crocodile_parallel',
    query: '"OP01-062" Crocodile parallel leader alt art one piece -graded -lot',
    priority: 2,
    searches: 4,
    targetVariant: 'parallel',
    expectedListings: 80,
  },

  // EB02 SP reprints - High value
  {
    name: 'eb02_sp_op05_060',
    query: '"EB02" SP "OP05-060" one piece -graded -lot',
    priority: 1,
    searches: 5,
    targetVariant: 'sp',
    expectedListings: 100,
    notes: '~£234 value',
  },
  {
    name: 'eb02_sp_op06_001',
    query: '"EB02" SP "OP06-001" one piece -graded -lot',
    priority: 1,
    searches: 4,
    targetVariant: 'sp',
    expectedListings: 80,
    notes: '~£75 value',
  },
  {
    name: 'eb02_sp_op06_042',
    query: '"EB02" SP "OP06-042" one piece -graded -lot',
    priority: 2,
    searches: 4,
    targetVariant: 'sp',
    expectedListings: 80,
    notes: '~£55 value',
  },
];

// =============================================================================
// SET-SPECIFIC QUERIES (400 searches)
// Cover all sets OP01-OP13, EB01-EB02 with SEC/SP/Parallel variants
// =============================================================================

export const SET_SPECIFIC_QUERIES: ComprehensiveQuery[] = [
  // OP01 Romance Dawn - Rich variant set
  {
    name: 'op01_sec_all',
    query: '"OP01" one piece SEC secret rare -graded -lot -bundle',
    priority: 1,
    searches: 10,
    targetVariant: 'sec',
    expectedListings: 200,
  },
  {
    name: 'op01_sp_all',
    query: '"OP01" one piece SP special rare -graded -lot',
    priority: 1,
    searches: 8,
    targetVariant: 'sp',
    expectedListings: 160,
  },
  {
    name: 'op01_parallel_en',
    query: '"OP01" one piece parallel english -graded -lot -japanese',
    priority: 1,
    searches: 10,
    targetVariant: 'parallel',
    targetLanguage: 'EN',
    expectedListings: 200,
  },
  {
    name: 'op01_parallel_jp',
    query: '"OP01" one piece parallel japanese -graded -lot',
    priority: 2,
    searches: 6,
    targetVariant: 'parallel',
    targetLanguage: 'JP',
    expectedListings: 120,
  },

  // OP02 Paramount War
  {
    name: 'op02_sec_all',
    query: '"OP02" one piece SEC secret rare -graded -lot',
    priority: 2,
    searches: 8,
    targetVariant: 'sec',
    expectedListings: 160,
  },
  {
    name: 'op02_parallel_all',
    query: '"OP02" one piece parallel alt art -graded -lot',
    priority: 2,
    searches: 8,
    targetVariant: 'parallel',
    expectedListings: 160,
  },

  // OP03 Pillars of Strength
  {
    name: 'op03_sec_all',
    query: '"OP03" one piece SEC secret rare -graded -lot',
    priority: 2,
    searches: 8,
    targetVariant: 'sec',
    expectedListings: 160,
  },
  {
    name: 'op03_parallel_all',
    query: '"OP03" one piece parallel alt art -graded -lot',
    priority: 2,
    searches: 8,
    targetVariant: 'parallel',
    expectedListings: 160,
  },

  // OP04 Kingdoms of Intrigue
  {
    name: 'op04_sec_all',
    query: '"OP04" one piece SEC secret rare -graded -lot',
    priority: 2,
    searches: 8,
    targetVariant: 'sec',
    expectedListings: 160,
  },
  {
    name: 'op04_parallel_all',
    query: '"OP04" one piece parallel alt art -graded -lot',
    priority: 2,
    searches: 8,
    targetVariant: 'parallel',
    expectedListings: 160,
  },

  // OP05 Awakening of the New Era - Popular set
  {
    name: 'op05_sec_all',
    query: '"OP05" one piece SEC secret rare -graded -lot',
    priority: 1,
    searches: 10,
    targetVariant: 'sec',
    expectedListings: 200,
  },
  {
    name: 'op05_sp_all',
    query: '"OP05" one piece SP special rare -graded -lot',
    priority: 1,
    searches: 8,
    targetVariant: 'sp',
    expectedListings: 160,
  },
  {
    name: 'op05_parallel_en',
    query: '"OP05" one piece parallel english -graded -lot -japanese',
    priority: 1,
    searches: 10,
    targetVariant: 'parallel',
    targetLanguage: 'EN',
    expectedListings: 200,
  },

  // OP06 Wings of the Captain
  {
    name: 'op06_sec_all',
    query: '"OP06" one piece SEC secret rare -graded -lot',
    priority: 2,
    searches: 8,
    targetVariant: 'sec',
    expectedListings: 160,
  },
  {
    name: 'op06_parallel_all',
    query: '"OP06" one piece parallel alt art -graded -lot',
    priority: 2,
    searches: 8,
    targetVariant: 'parallel',
    expectedListings: 160,
  },

  // OP07 500 Years into the Future
  {
    name: 'op07_sec_all',
    query: '"OP07" one piece SEC secret rare -graded -lot',
    priority: 2,
    searches: 8,
    targetVariant: 'sec',
    expectedListings: 160,
  },
  {
    name: 'op07_parallel_all',
    query: '"OP07" one piece parallel alt art -graded -lot',
    priority: 2,
    searches: 8,
    targetVariant: 'parallel',
    expectedListings: 160,
  },

  // OP08 Two Legends
  {
    name: 'op08_sec_all',
    query: '"OP08" one piece SEC secret rare -graded -lot',
    priority: 2,
    searches: 8,
    targetVariant: 'sec',
    expectedListings: 160,
  },
  {
    name: 'op08_parallel_all',
    query: '"OP08" one piece parallel alt art -graded -lot',
    priority: 2,
    searches: 8,
    targetVariant: 'parallel',
    expectedListings: 160,
  },

  // OP09 The New Emperor
  {
    name: 'op09_sec_all',
    query: '"OP09" one piece SEC secret rare -graded -lot',
    priority: 2,
    searches: 6,
    targetVariant: 'sec',
    expectedListings: 120,
  },
  {
    name: 'op09_parallel_all',
    query: '"OP09" one piece parallel alt art -graded -lot',
    priority: 2,
    searches: 6,
    targetVariant: 'parallel',
    expectedListings: 120,
  },

  // OP10 Royal Blood
  {
    name: 'op10_sec_all',
    query: '"OP10" one piece SEC secret rare -graded -lot',
    priority: 2,
    searches: 6,
    targetVariant: 'sec',
    expectedListings: 120,
  },
  {
    name: 'op10_parallel_all',
    query: '"OP10" one piece parallel alt art -graded -lot',
    priority: 2,
    searches: 6,
    targetVariant: 'parallel',
    expectedListings: 120,
  },

  // OP11 A Fist of Divine Speed
  {
    name: 'op11_sec_all',
    query: '"OP11" one piece SEC secret rare -graded -lot',
    priority: 2,
    searches: 6,
    targetVariant: 'sec',
    expectedListings: 120,
  },
  {
    name: 'op11_parallel_all',
    query: '"OP11" one piece parallel alt art -graded -lot',
    priority: 2,
    searches: 6,
    targetVariant: 'parallel',
    expectedListings: 120,
  },

  // OP12 Legacy of the Master
  {
    name: 'op12_sec_all',
    query: '"OP12" one piece SEC secret rare -graded -lot',
    priority: 2,
    searches: 6,
    targetVariant: 'sec',
    expectedListings: 120,
  },
  {
    name: 'op12_parallel_all',
    query: '"OP12" one piece parallel alt art -graded -lot',
    priority: 2,
    searches: 6,
    targetVariant: 'parallel',
    expectedListings: 120,
  },

  // OP13 Carrying On His Will - Latest
  {
    name: 'op13_sec_all',
    query: '"OP13" one piece SEC secret rare -graded -lot',
    priority: 1,
    searches: 8,
    targetVariant: 'sec',
    expectedListings: 160,
  },
  {
    name: 'op13_parallel_all',
    query: '"OP13" one piece parallel alt art -graded -lot',
    priority: 1,
    searches: 8,
    targetVariant: 'parallel',
    expectedListings: 160,
  },

  // EB01 Memorial Collection
  {
    name: 'eb01_sec_all',
    query: '"EB01" memorial collection one piece SEC -graded -lot',
    priority: 2,
    searches: 6,
    targetVariant: 'sec',
    expectedListings: 120,
  },
  {
    name: 'eb01_parallel_all',
    query: '"EB01" memorial collection one piece parallel -graded -lot',
    priority: 2,
    searches: 6,
    targetVariant: 'parallel',
    expectedListings: 120,
  },

  // EB02 Extra Booster 02 - SP focused
  {
    name: 'eb02_sp_all',
    query: '"EB02" one piece SP special rare -graded -lot',
    priority: 1,
    searches: 10,
    targetVariant: 'sp',
    expectedListings: 200,
    notes: 'EB02 has many high-value SP reprints',
  },
  {
    name: 'eb02_sec_all',
    query: '"EB02" one piece SEC secret rare -graded -lot',
    priority: 2,
    searches: 6,
    targetVariant: 'sec',
    expectedListings: 120,
  },
];

// =============================================================================
// VARIANT TYPE QUERIES (200 searches)
// Broad queries by variant type for coverage
// =============================================================================

export const VARIANT_TYPE_QUERIES: ComprehensiveQuery[] = [
  // Manga Art - CRITICAL GAP
  {
    name: 'manga_all_en',
    query: 'one piece tcg manga art english -PSA -CGC -graded -lot -bundle',
    priority: 1,
    searches: 15,
    targetVariant: 'manga',
    targetLanguage: 'EN',
    expectedListings: 300,
    notes: 'CRITICAL: Manga variants severely underrepresented',
  },
  {
    name: 'manga_all_jp',
    query: 'one piece tcg manga art japanese -graded -lot -bundle',
    priority: 1,
    searches: 10,
    targetVariant: 'manga',
    targetLanguage: 'JP',
    expectedListings: 200,
  },
  {
    name: 'manga_specific',
    query: 'one piece manga Shanks Luffy Ace Zoro -graded -lot',
    priority: 1,
    searches: 8,
    targetVariant: 'manga',
    expectedListings: 160,
  },

  // Treasure Rare (TR)
  {
    name: 'tr_all_en',
    query: 'one piece tcg TR treasure rare english -graded -lot',
    priority: 1,
    searches: 10,
    targetVariant: 'tr',
    targetLanguage: 'EN',
    expectedListings: 200,
  },
  {
    name: 'tr_all_jp',
    query: 'one piece tcg TR treasure rare japanese -graded -lot',
    priority: 2,
    searches: 6,
    targetVariant: 'tr',
    targetLanguage: 'JP',
    expectedListings: 120,
  },

  // Box Topper / Promo
  {
    name: 'boxtopper_all',
    query: 'one piece tcg box topper promo -PSA -graded -lot',
    priority: 2,
    searches: 8,
    targetVariant: 'boxtopper',
    expectedListings: 160,
    notes: 'Box toppers and promotional cards',
  },

  // Wanted Poster
  {
    name: 'wanted_poster_all',
    query: 'one piece tcg wanted poster -graded -lot',
    priority: 2,
    searches: 6,
    targetVariant: 'wantedposter',
    expectedListings: 120,
  },

  // Leader Alt Art
  {
    name: 'leader_altart_all',
    query: 'one piece tcg leader alt art parallel -graded -lot',
    priority: 2,
    searches: 8,
    targetVariant: 'parallel',
    expectedListings: 160,
    notes: 'Leader cards with alternate art',
  },

  // SEC Parallel (Alt art SEC)
  {
    name: 'sec_parallel_en',
    query: 'one piece tcg SEC parallel alt art english -graded -lot',
    priority: 1,
    searches: 10,
    targetVariant: 'sec_parallel',
    targetLanguage: 'EN',
    expectedListings: 200,
  },

  // SR Parallel
  {
    name: 'sr_parallel_en',
    query: 'one piece tcg SR super rare parallel english -graded -lot',
    priority: 2,
    searches: 8,
    targetVariant: 'sr_parallel',
    targetLanguage: 'EN',
    expectedListings: 160,
  },

  // Broad SEC (catch-all)
  {
    name: 'sec_broad_en',
    query: 'one piece tcg secret rare english -PSA -CGC -graded -lot -bundle',
    priority: 2,
    searches: 15,
    targetVariant: 'sec',
    targetLanguage: 'EN',
    expectedListings: 300,
  },
  {
    name: 'sec_broad_jp',
    query: 'one piece tcg secret rare japanese -graded -lot -bundle',
    priority: 2,
    searches: 10,
    targetVariant: 'sec',
    targetLanguage: 'JP',
    expectedListings: 200,
  },

  // Broad SP (catch-all)
  {
    name: 'sp_broad_en',
    query: 'one piece tcg SP special rare english -graded -lot -bundle',
    priority: 2,
    searches: 12,
    targetVariant: 'sp',
    targetLanguage: 'EN',
    expectedListings: 240,
  },

  // Broad Parallel (catch-all)
  {
    name: 'parallel_broad_en',
    query: 'one piece tcg parallel alt art english -graded -lot -bundle -japanese',
    priority: 2,
    searches: 15,
    targetVariant: 'parallel',
    targetLanguage: 'EN',
    expectedListings: 300,
  },
  {
    name: 'altart_broad_en',
    query: 'one piece card game alternate art english -graded -lot',
    priority: 2,
    searches: 10,
    targetVariant: 'parallel',
    targetLanguage: 'EN',
    expectedListings: 200,
  },
];

// =============================================================================
// CONDITION TRAINING QUERIES (100 searches)
// PSA/CGC graded cards for ground truth labels
// =============================================================================

export const CONDITION_TRAINING_QUERIES: ComprehensiveQuery[] = [
  {
    name: 'psa_10_all',
    query: 'one piece tcg PSA 10 gem mint -lot',
    priority: 3,
    searches: 20,
    expectedListings: 400,
    notes: 'Ground truth for NM/Mint condition',
  },
  {
    name: 'psa_9_all',
    query: 'one piece tcg PSA 9 mint -lot',
    priority: 3,
    searches: 15,
    expectedListings: 300,
    notes: 'Ground truth for NM condition',
  },
  {
    name: 'psa_8_all',
    query: 'one piece tcg PSA 8 -lot',
    priority: 3,
    searches: 10,
    expectedListings: 200,
    notes: 'Ground truth for LP condition',
  },
  {
    name: 'psa_7_lower',
    query: 'one piece tcg PSA 7 6 5 -lot',
    priority: 3,
    searches: 8,
    expectedListings: 160,
    notes: 'Ground truth for MP/HP condition',
  },
  {
    name: 'cgc_all',
    query: 'one piece tcg CGC graded -lot',
    priority: 3,
    searches: 10,
    expectedListings: 200,
  },
  {
    name: 'bgs_all',
    query: 'one piece tcg BGS Beckett -lot',
    priority: 3,
    searches: 5,
    expectedListings: 100,
  },
];

// =============================================================================
// ADDITIONAL SPECIFIC CARD QUERIES
// Fill gaps in specific high-value card numbers per set
// =============================================================================

export const SPECIFIC_CARD_QUERIES: ComprehensiveQuery[] = [
  // OP02 High cards
  {
    name: 'op02_118_121',
    query: '"OP02-118" OR "OP02-119" OR "OP02-120" OR "OP02-121" one piece -graded -lot',
    priority: 2,
    searches: 6,
    expectedListings: 120,
  },
  // OP03 High cards
  {
    name: 'op03_118_122',
    query: '"OP03-118" OR "OP03-119" OR "OP03-120" OR "OP03-121" OR "OP03-122" one piece -graded -lot',
    priority: 2,
    searches: 6,
    expectedListings: 120,
  },
  // OP04 High cards
  {
    name: 'op04_118_121',
    query: '"OP04-118" OR "OP04-119" OR "OP04-120" OR "OP04-121" one piece -graded -lot',
    priority: 2,
    searches: 6,
    expectedListings: 120,
  },
  // OP05 High cards
  {
    name: 'op05_118_121',
    query: '"OP05-118" OR "OP05-119" OR "OP05-120" OR "OP05-121" one piece -graded -lot',
    priority: 2,
    searches: 6,
    expectedListings: 120,
  },
  // OP06 High cards
  {
    name: 'op06_118_121',
    query: '"OP06-118" OR "OP06-119" OR "OP06-120" OR "OP06-121" one piece -graded -lot',
    priority: 2,
    searches: 6,
    expectedListings: 120,
  },
  // OP07 High cards (Ace, etc.)
  {
    name: 'op07_118_121',
    query: '"OP07-118" OR "OP07-119" OR "OP07-120" OR "OP07-121" one piece -graded -lot',
    priority: 2,
    searches: 6,
    expectedListings: 120,
  },
  // OP08 High cards
  {
    name: 'op08_118_121',
    query: '"OP08-118" OR "OP08-119" OR "OP08-120" OR "OP08-121" one piece -graded -lot',
    priority: 2,
    searches: 6,
    expectedListings: 120,
  },
];

// =============================================================================
// AGGREGATED CONFIGURATION
// =============================================================================

export function getAllComprehensiveQueries(): ComprehensiveQuery[] {
  return [
    ...HIGH_VALUE_CARDS,
    ...SET_SPECIFIC_QUERIES,
    ...VARIANT_TYPE_QUERIES,
    ...CONDITION_TRAINING_QUERIES,
    ...SPECIFIC_CARD_QUERIES,
  ].sort((a, b) => a.priority - b.priority);
}

export function getTotalSearches(): number {
  return getAllComprehensiveQueries().reduce((sum, q) => sum + q.searches, 0);
}

export function getTotalExpectedListings(): number {
  return getAllComprehensiveQueries().reduce((sum, q) => sum + q.expectedListings, 0);
}

export function getQueriesByPriority(priority: number): ComprehensiveQuery[] {
  return getAllComprehensiveQueries().filter((q) => q.priority === priority);
}

export function getSearchAllocation(): {
  highValue: number;
  setSpecific: number;
  variantType: number;
  condition: number;
  specificCards: number;
  total: number;
} {
  return {
    highValue: HIGH_VALUE_CARDS.reduce((sum, q) => sum + q.searches, 0),
    setSpecific: SET_SPECIFIC_QUERIES.reduce((sum, q) => sum + q.searches, 0),
    variantType: VARIANT_TYPE_QUERIES.reduce((sum, q) => sum + q.searches, 0),
    condition: CONDITION_TRAINING_QUERIES.reduce((sum, q) => sum + q.searches, 0),
    specificCards: SPECIFIC_CARD_QUERIES.reduce((sum, q) => sum + q.searches, 0),
    total: getTotalSearches(),
  };
}

// Print summary
export function printSummary(): void {
  const allocation = getSearchAllocation();
  const queries = getAllComprehensiveQueries();

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('       COMPREHENSIVE 1-YEAR COLLECTION SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log('SEARCH ALLOCATION:');
  console.log(`  High-Value Cards:    ${allocation.highValue} searches`);
  console.log(`  Set-Specific:        ${allocation.setSpecific} searches`);
  console.log(`  Variant Types:       ${allocation.variantType} searches`);
  console.log(`  Condition Training:  ${allocation.condition} searches`);
  console.log(`  Specific Cards:      ${allocation.specificCards} searches`);
  console.log(`  ─────────────────────────────────────────`);
  console.log(`  TOTAL:               ${allocation.total} searches\n`);

  console.log('EXPECTED YIELD:');
  console.log(`  Total Listings:      ~${getTotalExpectedListings().toLocaleString()}`);
  console.log(`  Est. Images:         ~${(getTotalExpectedListings() * 2).toLocaleString()} (2 resolutions)`);
  console.log(`  Est. Storage:        ~${Math.round(getTotalExpectedListings() * 0.3)} MB\n`);

  console.log('QUERY BREAKDOWN:');
  console.log(`  Priority 1 (Critical): ${queries.filter((q) => q.priority === 1).length} queries`);
  console.log(`  Priority 2 (High):     ${queries.filter((q) => q.priority === 2).length} queries`);
  console.log(`  Priority 3 (Graded):   ${queries.filter((q) => q.priority === 3).length} queries\n`);

  console.log('VARIANT COVERAGE:');
  const variants = ['sec', 'sp', 'parallel', 'manga', 'tr', 'boxtopper', 'wantedposter'];
  for (const v of variants) {
    const count = queries.filter((q) => q.targetVariant === v).length;
    console.log(`  ${v.padEnd(15)} ${count} queries`);
  }

  console.log('\n═══════════════════════════════════════════════════════════════\n');
}

export default {
  HIGH_VALUE_CARDS,
  SET_SPECIFIC_QUERIES,
  VARIANT_TYPE_QUERIES,
  CONDITION_TRAINING_QUERIES,
  SPECIFIC_CARD_QUERIES,
  getAllComprehensiveQueries,
  getTotalSearches,
  getTotalExpectedListings,
  getQueriesByPriority,
  getSearchAllocation,
  printSummary,
};
