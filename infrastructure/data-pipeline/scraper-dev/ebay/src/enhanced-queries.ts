/**
 * Enhanced Query Configuration
 *
 * Optimized queries based on Cambridge TCG naming convention analysis.
 * Targets high-value variants with precise search terms.
 *
 * Created: 2026-01-09
 */

export interface CollectionQuery {
  name: string;
  query: string;
  priority: number;
  expectedVolume: number;
  targetVariant?: string;
  targetLanguage?: 'EN' | 'JP' | 'ALL';
  excludeGraded?: boolean;
  notes?: string;
}

/**
 * High-value card-specific queries
 * Based on Cambridge TCG price analysis
 */
export const HIGH_VALUE_CARD_QUERIES: CollectionQuery[] = [
  // OP01-120 Shanks - Multiple variants
  {
    name: 'shanks_manga',
    query: 'OP01-120 Shanks manga one piece -PSA -CGC -BGS -graded -lot',
    priority: 1,
    expectedVolume: 50,
    targetVariant: 'manga',
    notes: 'Highest value card (~£1,024). Manga art severely underrepresented.',
  },
  {
    name: 'shanks_parallel',
    query: 'OP01-120 Shanks parallel alt art one piece -PSA -CGC -graded -lot',
    priority: 2,
    expectedVolume: 200,
    targetVariant: 'parallel',
  },
  {
    name: 'shanks_all_variants',
    query: '"OP01-120" Shanks one piece -lot -bundle',
    priority: 3,
    expectedVolume: 300,
    notes: 'Catch-all for any Shanks variants',
  },

  // OP01-121 Yamato - SP and Parallel
  {
    name: 'yamato_sp',
    query: 'OP01-121 Yamato SP special one piece -PSA -CGC -graded -lot',
    priority: 1,
    expectedVolume: 100,
    targetVariant: 'sp',
  },
  {
    name: 'yamato_parallel',
    query: 'OP01-121 Yamato parallel alt art one piece -PSA -CGC -graded -lot',
    priority: 2,
    expectedVolume: 150,
    targetVariant: 'parallel',
  },

  // OP01-078 Boa Hancock - High value SP
  {
    name: 'hancock_sp',
    query: 'OP01-078 "Boa Hancock" SP special one piece -PSA -graded -lot',
    priority: 1,
    expectedVolume: 80,
    targetVariant: 'sp',
    notes: '~£496 value',
  },
  {
    name: 'hancock_parallel',
    query: 'OP01-078 Hancock parallel one piece -PSA -graded -lot',
    priority: 2,
    expectedVolume: 100,
    targetVariant: 'parallel',
  },

  // OP01-016 Nami - SP and Parallel
  {
    name: 'nami_sp_parallel',
    query: 'OP01-016 Nami SP parallel one piece -PSA -CGC -graded -lot',
    priority: 1,
    expectedVolume: 150,
    notes: '~£282 value',
  },

  // OP01-003 Luffy - Parallel
  {
    name: 'luffy_op01_parallel',
    query: 'OP01-003 Luffy parallel alt art one piece -PSA -graded -lot',
    priority: 1,
    expectedVolume: 100,
    targetVariant: 'parallel',
    notes: '~£264 value',
  },

  // OP01-001 Zoro - Parallel
  {
    name: 'zoro_op01_parallel',
    query: 'OP01-001 Zoro parallel alt art one piece -PSA -graded -lot',
    priority: 2,
    expectedVolume: 80,
    targetVariant: 'parallel',
  },

  // OP01-047 Law - SP and Parallel
  {
    name: 'law_sp_parallel',
    query: 'OP01-047 "Trafalgar Law" SP parallel one piece -PSA -graded -lot',
    priority: 2,
    expectedVolume: 120,
  },
];

/**
 * Variant-type queries (broad coverage)
 */
export const VARIANT_TYPE_QUERIES: CollectionQuery[] = [
  // Manga Art - CRITICAL GAP (currently 0 images)
  {
    name: 'manga_all_en',
    query: 'one piece tcg manga art english -PSA -CGC -BGS -graded -lot -bundle',
    priority: 1,
    expectedVolume: 150,
    targetVariant: 'manga',
    targetLanguage: 'EN',
    excludeGraded: true,
    notes: 'CRITICAL: Zero manga images in current collection',
  },
  {
    name: 'manga_all_jp',
    query: 'one piece tcg manga art japanese -graded -lot -bundle',
    priority: 1,
    expectedVolume: 100,
    targetVariant: 'manga',
    targetLanguage: 'JP',
    excludeGraded: true,
  },
  {
    name: 'manga_specific_cards',
    query: 'one piece manga Shanks OR Luffy OR Ace -PSA -graded -lot',
    priority: 1,
    expectedVolume: 80,
    targetVariant: 'manga',
  },

  // SEC (Secret Rare)
  {
    name: 'sec_english_raw',
    query: 'one piece tcg SEC secret rare english -PSA -CGC -BGS -graded -lot -bundle',
    priority: 1,
    expectedVolume: 500,
    targetVariant: 'sec',
    targetLanguage: 'EN',
    excludeGraded: true,
  },
  {
    name: 'sec_japanese_raw',
    query: 'one piece tcg SEC secret rare japanese -PSA -CGC -BGS -graded -lot',
    priority: 2,
    expectedVolume: 300,
    targetVariant: 'sec',
    targetLanguage: 'JP',
    excludeGraded: true,
  },

  // SP (Special Rare) - Using Cambridge TCG terminology
  {
    name: 'sp_special_en',
    query: 'one piece tcg SP special rare english -PSA -CGC -graded -lot',
    priority: 1,
    expectedVolume: 300,
    targetVariant: 'sp',
    targetLanguage: 'EN',
    excludeGraded: true,
  },
  {
    name: 'sp_special_jp',
    query: 'one piece tcg SP special rare japanese -graded -lot',
    priority: 2,
    expectedVolume: 200,
    targetVariant: 'sp',
    targetLanguage: 'JP',
    excludeGraded: true,
  },

  // Alt Art / Parallel (Cambridge TCG uses "Alt Art")
  {
    name: 'altart_english',
    query: 'one piece card game alt art english -PSA -CGC -graded -lot -bundle',
    priority: 1,
    expectedVolume: 600,
    targetVariant: 'parallel',
    targetLanguage: 'EN',
    excludeGraded: true,
  },
  {
    name: 'parallel_english',
    query: 'one piece tcg parallel english -PSA -CGC -graded -lot -bundle -japanese',
    priority: 1,
    expectedVolume: 600,
    targetVariant: 'parallel',
    targetLanguage: 'EN',
    excludeGraded: true,
  },
  {
    name: 'altart_japanese',
    query: 'one piece card game alt art japanese -graded -lot',
    priority: 2,
    expectedVolume: 400,
    targetVariant: 'parallel',
    targetLanguage: 'JP',
    excludeGraded: true,
  },

  // Treasure Rare (TR)
  {
    name: 'treasure_rare_all',
    query: 'one piece tcg TR treasure rare -PSA -CGC -graded -lot',
    priority: 2,
    expectedVolume: 150,
    targetVariant: 'tr',
    excludeGraded: true,
  },

  // Box Topper / Promo
  {
    name: 'boxtopper_all',
    query: 'one piece tcg box topper promo -PSA -graded -lot',
    priority: 3,
    expectedVolume: 100,
    targetVariant: 'boxtopper',
    excludeGraded: true,
  },

  // Wanted Poster
  {
    name: 'wanted_poster',
    query: 'one piece tcg wanted poster -PSA -graded -lot',
    priority: 3,
    expectedVolume: 80,
    targetVariant: 'wantedposter',
    excludeGraded: true,
  },

  // Leader Alt Art
  {
    name: 'leader_altart',
    query: 'one piece tcg leader alt art -PSA -CGC -graded -lot',
    priority: 2,
    expectedVolume: 200,
    targetVariant: 'parallel',
    excludeGraded: true,
    notes: 'Leader cards with alternate art',
  },
];

/**
 * Set-specific queries (using official set names from Cambridge TCG)
 */
export const SET_SPECIFIC_QUERIES: CollectionQuery[] = [
  // OP01 Romance Dawn
  {
    name: 'op01_romance_dawn',
    query: '"OP01" "Romance Dawn" parallel alt art one piece -PSA -graded -lot',
    priority: 2,
    expectedVolume: 300,
  },

  // OP02 Paramount War
  {
    name: 'op02_paramount_war',
    query: '"OP02" "Paramount War" parallel alt art one piece -PSA -graded -lot',
    priority: 3,
    expectedVolume: 200,
  },

  // OP03 Pillars of Strength
  {
    name: 'op03_pillars',
    query: '"OP03" "Pillars of Strength" parallel alt art one piece -PSA -graded -lot',
    priority: 3,
    expectedVolume: 200,
  },

  // OP05 Awakening of the New Era (popular set)
  {
    name: 'op05_awakening',
    query: '"OP05" Awakening parallel alt art one piece -PSA -graded -lot',
    priority: 2,
    expectedVolume: 300,
  },

  // OP07 500 Years into the Future
  {
    name: 'op07_future',
    query: '"OP07" "500 Years" parallel alt art one piece -PSA -graded -lot',
    priority: 3,
    expectedVolume: 200,
  },

  // OP13 Carrying On His Will (latest set)
  {
    name: 'op13_latest',
    query: '"OP13" one piece alt art parallel -PSA -graded -lot',
    priority: 2,
    expectedVolume: 250,
  },

  // EB01 Memorial Collection
  {
    name: 'eb01_memorial',
    query: 'EB01 "Memorial Collection" one piece alt art -PSA -graded -lot',
    priority: 2,
    expectedVolume: 150,
  },

  // EB02 (has many SP reprints)
  {
    name: 'eb02_sp',
    query: 'EB02 SP one piece alt art -PSA -graded -lot',
    priority: 2,
    expectedVolume: 200,
    notes: 'EB02 contains SP reprints of popular cards',
  },
];

/**
 * Condition training queries (PSA graded for ground truth)
 */
export const CONDITION_TRAINING_QUERIES: CollectionQuery[] = [
  {
    name: 'psa_10_condition',
    query: 'one piece tcg PSA 10 gem mint -lot',
    priority: 4,
    expectedVolume: 200,
    notes: 'Ground truth for NM/Mint condition',
  },
  {
    name: 'psa_9_condition',
    query: 'one piece tcg PSA 9 mint -lot',
    priority: 4,
    expectedVolume: 150,
    notes: 'Ground truth for NM condition',
  },
  {
    name: 'psa_8_condition',
    query: 'one piece tcg PSA 8 -lot',
    priority: 4,
    expectedVolume: 100,
    notes: 'Ground truth for LP condition',
  },
  {
    name: 'cgc_graded_condition',
    query: 'one piece tcg CGC graded -lot',
    priority: 4,
    expectedVolume: 100,
  },
];

/**
 * Combined priority-sorted queries for collection runs
 */
export function getAllQueries(): CollectionQuery[] {
  const allQueries = [
    ...HIGH_VALUE_CARD_QUERIES,
    ...VARIANT_TYPE_QUERIES,
    ...SET_SPECIFIC_QUERIES,
    ...CONDITION_TRAINING_QUERIES,
  ];

  // Sort by priority (1 = highest)
  return allQueries.sort((a, b) => a.priority - b.priority);
}

/**
 * Get queries by priority level
 */
export function getQueriesByPriority(maxPriority: number): CollectionQuery[] {
  return getAllQueries().filter((q) => q.priority <= maxPriority);
}

/**
 * Get queries targeting specific variant
 */
export function getQueriesByVariant(variant: string): CollectionQuery[] {
  return getAllQueries().filter((q) => q.targetVariant === variant);
}

/**
 * Calculate total expected volume
 */
export function calculateExpectedVolume(queries: CollectionQuery[]): number {
  return queries.reduce((sum, q) => sum + q.expectedVolume, 0);
}

// Summary statistics
export const QUERY_STATS = {
  totalQueries: getAllQueries().length,
  priority1Count: getQueriesByPriority(1).length,
  priority2Count: getAllQueries().filter((q) => q.priority === 2).length,
  totalExpectedVolume: calculateExpectedVolume(getAllQueries()),
  criticalGaps: ['manga', 'boxtopper', 'wantedposter'],
};

export default {
  HIGH_VALUE_CARD_QUERIES,
  VARIANT_TYPE_QUERIES,
  SET_SPECIFIC_QUERIES,
  CONDITION_TRAINING_QUERIES,
  getAllQueries,
  getQueriesByPriority,
  getQueriesByVariant,
  calculateExpectedVolume,
  QUERY_STATS,
};
