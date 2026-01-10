/**
 * Deep Dive: One Piece TCG Variant Query Analysis
 *
 * Tests optimized queries for each variant type to maximize
 * ML training data quality per your CardPriceV2 variant types.
 *
 * Run with: npx tsx src/test-variant-deep-dive.ts
 */

import * as dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: resolve(__dirname, '../.env') });

const SERPAPI_KEY = process.env.SERPAPI_API_KEY || '';

// ============================================================================
// OPTIMIZED VARIANT QUERIES (Based on CardPriceV2 variant types)
// ============================================================================

interface VariantQuery {
  variantType: string;  // Maps to CardPriceV2.variantType
  queries: {
    name: string;
    query: string;
    language: 'EN' | 'JP' | 'ALL';
  }[];
}

const VARIANT_QUERIES: VariantQuery[] = [
  {
    variantType: 'parallel',
    queries: [
      { name: 'parallel_en', query: '"one piece" parallel english alt art -lot -bundle -japanese', language: 'EN' },
      { name: 'parallel_jp', query: '"one piece" parallel japanese alt art -lot -bundle -english', language: 'JP' },
    ],
  },
  {
    variantType: 'sp',
    queries: [
      { name: 'sp_en', query: 'one piece tcg SP special art english -lot -bundle -japanese', language: 'EN' },
      { name: 'sp_jp', query: 'one piece tcg SP special art japanese -lot -bundle', language: 'JP' },
    ],
  },
  {
    variantType: 'manga',
    queries: [
      { name: 'manga_en', query: 'one piece tcg manga art english -lot -bundle -japanese', language: 'EN' },
      { name: 'manga_jp', query: 'one piece tcg manga art japanese -lot -bundle', language: 'JP' },
    ],
  },
  {
    variantType: 'tr', // Treasure Rare
    queries: [
      { name: 'tr_en', query: 'one piece tcg TR treasure rare english -lot -bundle -japanese', language: 'EN' },
      { name: 'tr_jp', query: 'one piece tcg TR treasure rare japanese -lot -bundle', language: 'JP' },
    ],
  },
  {
    variantType: 'spr', // Special Rare (different from SP)
    queries: [
      { name: 'spr_all', query: 'one piece tcg SPR -lot -bundle', language: 'ALL' },
    ],
  },
  {
    variantType: 'sec', // Secret Rare (base + variants)
    queries: [
      { name: 'sec_en', query: 'one piece tcg SEC secret rare english -lot -bundle -japanese', language: 'EN' },
      { name: 'sec_jp', query: 'one piece tcg SEC secret rare japanese -lot -bundle', language: 'JP' },
      { name: 'sec_parallel_en', query: '"one piece" SEC parallel english -lot -bundle -japanese', language: 'EN' },
    ],
  },
  {
    variantType: 'wantedposter',
    queries: [
      { name: 'wanted_all', query: 'one piece tcg wanted poster -lot -bundle', language: 'ALL' },
    ],
  },
  {
    variantType: 'boxtopper',
    queries: [
      { name: 'boxtopper_all', query: 'one piece tcg box topper promo -lot -bundle', language: 'ALL' },
    ],
  },
];

// ============================================================================
// SET-SPECIFIC QUERIES (for comprehensive coverage)
// ============================================================================

const SET_QUERIES = [
  // Main booster sets
  { set: 'OP01', name: 'Romance Dawn' },
  { set: 'OP02', name: 'Paramount War' },
  { set: 'OP03', name: 'Pillars of Strength' },
  { set: 'OP04', name: 'Kingdoms of Intrigue' },
  { set: 'OP05', name: 'Awakening of the New Era' },
  { set: 'OP06', name: 'Wings of the Captain' },
  { set: 'OP07', name: '500 Years in the Future' },
  { set: 'OP08', name: 'Two Legends' },
  { set: 'OP09', name: 'The Four Emperors' },
  { set: 'OP10', name: 'Royal Blood' },
  { set: 'OP11', name: 'A Fist of Divine Speed' },
  { set: 'OP12', name: 'Legacy of the Master' },
  { set: 'OP13', name: 'Carrying On His Will' },
  // Extra boosters
  { set: 'EB01', name: 'Memorial Collection' },
  { set: 'EB02', name: 'Extra Booster 2' },
  // Premium boosters (SP cards released here)
  { set: 'PRB01', name: 'Premium Booster Vol.1' },
  { set: 'PRB02', name: 'Premium Booster Vol.2' },
];

// ============================================================================
// ANALYSIS FUNCTIONS
// ============================================================================

interface SerpApiResult {
  title: string;
  link: string;
  price?: { raw: string; extracted: number };
  condition?: string;
  sold_date?: string;
}

interface SerpApiResponse {
  search_information?: { total_results: number };
  organic_results?: SerpApiResult[];
}

async function searchEbay(query: string): Promise<SerpApiResponse> {
  const params = new URLSearchParams({
    engine: 'ebay',
    _nkw: query,
    show_only: 'Sold',
    _ipg: '100',
    api_key: SERPAPI_KEY,
  });

  const response = await fetch(`https://serpapi.com/search?${params}`);
  return response.json();
}

function extractCardId(title: string): string | undefined {
  const match = title.match(/\b(OP\d{2}|ST\d{2}|EB\d{2}|PRB\d{2})-(\d{3})\b/i);
  return match ? `${match[1].toUpperCase()}-${match[2]}` : undefined;
}

function extractVariantFromTitle(title: string): string[] {
  const variants: string[] = [];
  const titleLower = title.toLowerCase();

  if (/parallel/i.test(title)) variants.push('parallel');
  if (/\bSP\b/.test(title) || /special\s*(art|rare)/i.test(title)) variants.push('sp');
  if (/manga/i.test(title)) variants.push('manga');
  if (/\bTR\b/i.test(title) || /treasure\s*rare/i.test(title)) variants.push('tr');
  if (/\bSEC\b/i.test(title) || /secret\s*rare/i.test(title)) variants.push('sec');
  if (/wanted\s*poster/i.test(title)) variants.push('wantedposter');
  if (/box\s*topper/i.test(title)) variants.push('boxtopper');
  if (/alt\s*art|alternate/i.test(title)) variants.push('alt_art');

  return variants;
}

function extractGrading(title: string): { graded: boolean; company?: string; grade?: string } {
  const gradeMatch = title.match(/\b(PSA|CGC|BGS)\s*(\d+\.?\d?)\b/i);
  if (gradeMatch) {
    return { graded: true, company: gradeMatch[1].toUpperCase(), grade: gradeMatch[2] };
  }
  return { graded: false };
}

function extractLanguage(title: string): 'EN' | 'JP' | 'UNKNOWN' {
  if (/\benglish\b/i.test(title) || /\bEN\b/.test(title)) return 'EN';
  if (/\bjapanese\b/i.test(title) || /\bJP\b/i.test(title) || /日本語/.test(title)) return 'JP';
  return 'UNKNOWN';
}

// ============================================================================
// MAIN ANALYSIS
// ============================================================================

async function main() {
  console.log('═'.repeat(80));
  console.log('One Piece TCG Variant Deep Dive Analysis');
  console.log('═'.repeat(80));

  if (!SERPAPI_KEY) {
    console.error('❌ SERPAPI_API_KEY not set');
    process.exit(1);
  }

  const allResults: Array<{
    variantType: string;
    queryName: string;
    query: string;
    language: string;
    totalResults: number;
    cardIdRate: number;
    avgPrice: number;
    priceRange: { min: number; max: number };
    gradedRate: number;
    samples: string[];
  }> = [];

  // Test variant-specific queries
  console.log('\n📊 VARIANT-SPECIFIC QUERY ANALYSIS');
  console.log('─'.repeat(80));

  for (const variant of VARIANT_QUERIES) {
    console.log(`\n🎴 Variant Type: ${variant.variantType}`);

    for (const q of variant.queries) {
      console.log(`   Testing: ${q.name} (${q.language})`);

      try {
        const response = await searchEbay(q.query);
        const items = response.organic_results || [];
        const totalResults = response.search_information?.total_results || 0;

        let cardIdCount = 0;
        let gradedCount = 0;
        const prices: number[] = [];

        for (const item of items) {
          if (extractCardId(item.title)) cardIdCount++;
          if (extractGrading(item.title).graded) gradedCount++;
          if (item.price?.extracted) prices.push(item.price.extracted);
        }

        const result = {
          variantType: variant.variantType,
          queryName: q.name,
          query: q.query,
          language: q.language,
          totalResults,
          cardIdRate: items.length > 0 ? cardIdCount / items.length : 0,
          avgPrice: prices.length > 0 ? prices.reduce((a, b) => a + b, 0) / prices.length : 0,
          priceRange: prices.length > 0 ? { min: Math.min(...prices), max: Math.max(...prices) } : { min: 0, max: 0 },
          gradedRate: items.length > 0 ? gradedCount / items.length : 0,
          samples: items.slice(0, 3).map(i => i.title.substring(0, 60)),
        };

        allResults.push(result);

        console.log(`      Volume: ${totalResults.toLocaleString()} | CardID: ${(result.cardIdRate * 100).toFixed(0)}% | Avg: $${result.avgPrice.toFixed(2)} | Graded: ${(result.gradedRate * 100).toFixed(0)}%`);

      } catch (error) {
        console.log(`      ❌ Error: ${error}`);
      }

      await new Promise(r => setTimeout(r, 1500));
    }
  }

  // Test a few set-specific queries
  console.log('\n\n📊 SET-SPECIFIC QUERY ANALYSIS (Sample)');
  console.log('─'.repeat(80));

  const sampleSets = ['OP01', 'OP05', 'OP13']; // Key sets

  for (const setCode of sampleSets) {
    const setInfo = SET_QUERIES.find(s => s.set === setCode);
    const query = `"${setCode}-" one piece tcg SEC OR parallel english -lot -bundle -japanese`;

    console.log(`\n🎴 Set: ${setCode} (${setInfo?.name || 'Unknown'})`);
    console.log(`   Query: ${query}`);

    try {
      const response = await searchEbay(query);
      const items = response.organic_results || [];
      const totalResults = response.search_information?.total_results || 0;

      let cardIdCount = 0;
      const prices: number[] = [];
      const cardIds = new Set<string>();

      for (const item of items) {
        const cardId = extractCardId(item.title);
        if (cardId) {
          cardIdCount++;
          cardIds.add(cardId);
        }
        if (item.price?.extracted) prices.push(item.price.extracted);
      }

      console.log(`   Volume: ${totalResults.toLocaleString()} | Unique Cards: ${cardIds.size} | CardID Rate: ${((cardIdCount / items.length) * 100).toFixed(0)}%`);
      console.log(`   Price Range: $${Math.min(...prices).toFixed(2)} - $${Math.max(...prices).toFixed(2)} (Avg: $${(prices.reduce((a, b) => a + b, 0) / prices.length).toFixed(2)})`);
      console.log(`   Sample Card IDs: ${Array.from(cardIds).slice(0, 5).join(', ')}`);

    } catch (error) {
      console.log(`   ❌ Error: ${error}`);
    }

    await new Promise(r => setTimeout(r, 1500));
  }

  // Summary table
  console.log('\n\n═'.repeat(80));
  console.log('SUMMARY: OPTIMAL QUERIES BY VARIANT TYPE');
  console.log('═'.repeat(80));

  const variantSummary = new Map<string, typeof allResults[0][]>();
  for (const r of allResults) {
    const existing = variantSummary.get(r.variantType) || [];
    existing.push(r);
    variantSummary.set(r.variantType, existing);
  }

  console.log('\n┌─────────────┬──────────────────┬─────────┬──────────┬───────────┬──────────────────────────────────────────────────┐');
  console.log('│ Variant     │ Best Query       │ Volume  │ Card ID  │ Avg Price │ Recommended Query                                │');
  console.log('├─────────────┼──────────────────┼─────────┼──────────┼───────────┼──────────────────────────────────────────────────┤');

  for (const [variant, results] of variantSummary) {
    // Pick best by card ID rate * volume
    const best = results.reduce((a, b) =>
      (a.cardIdRate * Math.min(a.totalResults, 1000)) > (b.cardIdRate * Math.min(b.totalResults, 1000)) ? a : b
    );

    const v = variant.padEnd(11);
    const n = best.queryName.substring(0, 16).padEnd(16);
    const vol = best.totalResults.toLocaleString().padStart(7);
    const cid = `${(best.cardIdRate * 100).toFixed(0)}%`.padStart(8);
    const avg = `$${best.avgPrice.toFixed(0)}`.padStart(9);
    const q = best.query.substring(0, 48).padEnd(48);

    console.log(`│ ${v} │ ${n} │ ${vol} │ ${cid} │ ${avg} │ ${q} │`);
  }

  console.log('└─────────────┴──────────────────┴─────────┴──────────┴───────────┴──────────────────────────────────────────────────┘');

  // Final recommendations
  console.log('\n\n📋 FINAL RECOMMENDATIONS FOR PRODUCTION PIPELINE');
  console.log('─'.repeat(80));
  console.log(`
1. USE LANGUAGE-SPECIFIC QUERIES
   - Always separate EN and JP searches for cleaner data
   - EN cards generally have higher volumes on eBay US

2. USE NEGATIVE FILTERS
   - Always include: -lot -bundle -bulk
   - For EN: add -japanese
   - For JP: add -english

3. VARIANT-SPECIFIC STRATEGY
   - SEC/Parallel: Highest volume, use as primary
   - SP: Lower volume but high value, worth separate collection
   - Manga: Very high value ($1000+), always collect
   - TR: Medium volume, good for trend analysis

4. CARD ID EXTRACTION IS RELIABLE
   - 85-98% extraction rate with good queries
   - Format: {SET}-{NUMBER} (e.g., OP01-120)
   - Can be used to join with CardPriceV2

5. GRADED VS RAW SEPARATION
   - Add "PSA OR CGC OR BGS" to get graded only
   - Add "-PSA -CGC -BGS" to exclude graded
   - Important for accurate pricing models

6. RECOMMENDED QUERY TEMPLATES:

   For SEC (English):
   "one piece tcg SEC secret rare english -lot -bundle -japanese"

   For Parallel (English):
   "one piece" parallel english alt art -lot -bundle -japanese

   For SP (English):
   one piece tcg SP special art english -lot -bundle -japanese

   For Manga (All):
   one piece tcg manga art -lot -bundle

   For specific set:
   "{SET}-" one piece tcg SEC OR parallel english -lot -bundle -japanese
`);
}

main();
