/**
 * One Piece TCG Query Strategy Testing
 *
 * Tests different eBay search query strategies to find optimal
 * approaches for high-quality ML training data.
 *
 * Run with: npx tsx src/test-query-strategies.ts
 */

import * as dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: resolve(__dirname, '../.env') });

const SERPAPI_KEY = process.env.SERPAPI_API_KEY || '';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface SerpApiResult {
  title: string;
  link: string;
  price?: { raw: string; extracted: number };
  shipping?: string;
  condition?: string;
  sold_date?: string;
}

interface SerpApiResponse {
  search_information?: { total_results: number };
  organic_results?: SerpApiResult[];
  error?: string;
}

interface QueryStrategy {
  name: string;
  description: string;
  query: string;
  category?: string; // eBay category filter
  expectedPatterns: RegExp[]; // Patterns to match in titles
  excludePatterns: RegExp[]; // Patterns that indicate noise
}

interface StrategyResult {
  strategy: QueryStrategy;
  totalResults: number;
  returnedCount: number;
  relevantCount: number; // Matches expectedPatterns
  noiseCount: number; // Matches excludePatterns
  precision: number; // relevantCount / returnedCount
  cardIdExtractRate: number; // % with extractable card IDs
  priceRate: number;
  avgPrice: number;
  samples: Array<{
    title: string;
    price: string;
    cardId?: string;
    isRelevant: boolean;
    isNoise: boolean;
  }>;
}

// ============================================================================
// QUERY STRATEGIES TO TEST
// ============================================================================

const QUERY_STRATEGIES: QueryStrategy[] = [
  // === STRATEGY GROUP 1: Set-based queries ===
  {
    name: 'set_code_basic',
    description: 'Basic set code query',
    query: 'one piece tcg OP01',
    expectedPatterns: [/OP01-\d{3}/i],
    excludePatterns: [/\b(lot|bundle|bulk|playset|x4|x3|starter deck|booster)\b/i],
  },
  {
    name: 'set_code_with_dash',
    description: 'Set code with dash prefix',
    query: '"OP01-" one piece card',
    expectedPatterns: [/OP01-\d{3}/i],
    excludePatterns: [/\b(lot|bundle|bulk|playset)\b/i],
  },

  // === STRATEGY GROUP 2: Rarity + Set queries ===
  {
    name: 'sec_rarity',
    description: 'Secret Rare cards only',
    query: 'one piece tcg SEC secret rare',
    expectedPatterns: [/\bSEC\b/i, /secret\s*rare/i],
    excludePatterns: [/\b(lot|bundle|bulk)\b/i],
  },
  {
    name: 'sr_parallel',
    description: 'Super Rare Parallel cards',
    query: 'one piece tcg SR parallel',
    expectedPatterns: [/\bSR\b/, /parallel/i],
    excludePatterns: [/\b(lot|bundle|bulk)\b/i],
  },

  // === STRATEGY GROUP 3: Variant-specific queries ===
  {
    name: 'parallel_alt_art',
    description: 'Parallel/Alt Art variants',
    query: 'one piece tcg parallel alt art -lot -bundle',
    expectedPatterns: [/parallel/i, /alt\s*art/i, /alternate/i],
    excludePatterns: [/\b(lot|bundle|bulk|playset)\b/i],
  },
  {
    name: 'sp_special_art',
    description: 'SP Special Art cards',
    query: 'one piece tcg SP special art',
    expectedPatterns: [/\bSP\b/, /special\s*(art|rare)/i],
    excludePatterns: [/\b(lot|bundle|bulk)\b/i],
  },
  {
    name: 'manga_art',
    description: 'Manga art variants',
    query: 'one piece tcg manga art rare',
    expectedPatterns: [/manga/i],
    excludePatterns: [/\b(lot|bundle|bulk)\b/i],
  },
  {
    name: 'treasure_rare',
    description: 'Treasure Rare cards',
    query: 'one piece tcg TR treasure rare',
    expectedPatterns: [/\bTR\b/i, /treasure\s*rare/i],
    excludePatterns: [/\b(lot|bundle|bulk)\b/i],
  },

  // === STRATEGY GROUP 4: Specific card number queries ===
  {
    name: 'card_number_exact',
    description: 'Exact card number search',
    query: '"OP01-120" one piece',
    expectedPatterns: [/OP01-120/i],
    excludePatterns: [/\b(lot|bundle)\b/i],
  },
  {
    name: 'card_number_range',
    description: 'High-value card numbers (SEC range)',
    query: 'one piece tcg OP01-121 OR OP01-120 OR OP01-119',
    expectedPatterns: [/OP01-1(19|20|21)/i],
    excludePatterns: [/\b(lot|bundle)\b/i],
  },

  // === STRATEGY GROUP 5: Language-specific ===
  {
    name: 'english_only',
    description: 'English cards only',
    query: 'one piece tcg english SEC -japanese -JP',
    expectedPatterns: [/english/i, /\bSEC\b/i],
    excludePatterns: [/japanese/i, /\bJP\b/i, /\b(lot|bundle)\b/i],
  },
  {
    name: 'japanese_only',
    description: 'Japanese cards only',
    query: 'one piece tcg japanese SEC -english',
    expectedPatterns: [/japanese/i, /\bJP\b/i, /\bSEC\b/i],
    excludePatterns: [/\b(lot|bundle)\b/i],
  },

  // === STRATEGY GROUP 6: Graded vs Raw ===
  {
    name: 'psa_graded',
    description: 'PSA graded cards',
    query: 'one piece tcg PSA 10 SEC',
    expectedPatterns: [/\bPSA\b/i, /\b10\b/, /\bSEC\b/i],
    excludePatterns: [/\b(lot|bundle)\b/i],
  },
  {
    name: 'raw_ungraded',
    description: 'Raw/ungraded cards',
    query: 'one piece tcg SEC NM raw -PSA -CGC -BGS',
    expectedPatterns: [/\bSEC\b/i, /\bNM\b/i, /near\s*mint/i],
    excludePatterns: [/\bPSA\b/i, /\bCGC\b/i, /\bBGS\b/i, /\b(lot|bundle)\b/i],
  },

  // === STRATEGY GROUP 7: Character-based (for popular cards) ===
  {
    name: 'character_luffy_sec',
    description: 'Luffy SEC cards',
    query: 'one piece tcg Luffy SEC secret rare',
    expectedPatterns: [/luffy/i, /\bSEC\b/i],
    excludePatterns: [/\b(lot|bundle)\b/i],
  },
  {
    name: 'character_shanks',
    description: 'Shanks high-value cards',
    query: 'one piece tcg Shanks SEC parallel manga',
    expectedPatterns: [/shanks/i, /(\bSEC\b|parallel|manga)/i],
    excludePatterns: [/\b(lot|bundle)\b/i],
  },

  // === STRATEGY GROUP 8: Combined precision queries ===
  {
    name: 'precision_sec_parallel_en',
    description: 'High precision: SEC Parallel English',
    query: '"one piece" SEC parallel english -lot -bundle -bulk -japanese',
    expectedPatterns: [/\bSEC\b/i, /parallel/i],
    excludePatterns: [/\b(lot|bundle|bulk|japanese)\b/i],
  },
  {
    name: 'precision_sp_set',
    description: 'High precision: SP with set code',
    query: 'one piece tcg SP OP01 OR OP02 OR OP03 -lot -bundle',
    expectedPatterns: [/\bSP\b/, /OP0[123]-\d{3}/i],
    excludePatterns: [/\b(lot|bundle|bulk)\b/i],
  },

  // === STRATEGY GROUP 9: eBay Category filtered ===
  {
    name: 'category_filtered_sec',
    description: 'SEC with category filter (CCG singles)',
    query: 'one piece tcg SEC',
    category: '183454', // CCG Individual Cards
    expectedPatterns: [/\bSEC\b/i],
    excludePatterns: [/\b(lot|bundle|bulk|booster|box)\b/i],
  },
];

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Extract card ID from title
 */
function extractCardId(title: string): string | undefined {
  // Match patterns like OP01-120, ST01-001, EB01-050, PRB01-001
  const match = title.match(/\b(OP\d{2}|ST\d{2}|EB\d{2}|PRB\d{2})-(\d{3})\b/i);
  if (match) {
    return `${match[1].toUpperCase()}-${match[2]}`;
  }
  return undefined;
}

/**
 * Check if title matches any pattern in array
 */
function matchesAny(title: string, patterns: RegExp[]): boolean {
  return patterns.some(p => p.test(title));
}

/**
 * Search eBay via SerpApi
 */
async function searchEbay(query: string, category?: string): Promise<SerpApiResponse> {
  const params: Record<string, string> = {
    engine: 'ebay',
    _nkw: query,
    show_only: 'Sold',
    _ipg: '100',
    api_key: SERPAPI_KEY,
  };

  if (category) {
    params._sacat = category;
  }

  const url = `https://serpapi.com/search?${new URLSearchParams(params)}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }

  return response.json();
}

/**
 * Evaluate a query strategy
 */
async function evaluateStrategy(strategy: QueryStrategy): Promise<StrategyResult> {
  const response = await searchEbay(strategy.query, strategy.category);

  const items = response.organic_results || [];
  const totalResults = response.search_information?.total_results || 0;

  let relevantCount = 0;
  let noiseCount = 0;
  let cardIdCount = 0;
  let priceCount = 0;
  let priceSum = 0;

  const samples: StrategyResult['samples'] = [];

  for (const item of items) {
    const title = item.title || '';
    const isRelevant = matchesAny(title, strategy.expectedPatterns);
    const isNoise = matchesAny(title, strategy.excludePatterns);
    const cardId = extractCardId(title);

    if (isRelevant && !isNoise) relevantCount++;
    if (isNoise) noiseCount++;
    if (cardId) cardIdCount++;
    if (item.price?.extracted) {
      priceCount++;
      priceSum += item.price.extracted;
    }

    if (samples.length < 5) {
      samples.push({
        title: title.substring(0, 80),
        price: item.price?.raw || 'N/A',
        cardId,
        isRelevant,
        isNoise,
      });
    }
  }

  return {
    strategy,
    totalResults,
    returnedCount: items.length,
    relevantCount,
    noiseCount,
    precision: items.length > 0 ? relevantCount / items.length : 0,
    cardIdExtractRate: items.length > 0 ? cardIdCount / items.length : 0,
    priceRate: items.length > 0 ? priceCount / items.length : 0,
    avgPrice: priceCount > 0 ? priceSum / priceCount : 0,
    samples,
  };
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log('═'.repeat(80));
  console.log('One Piece TCG Query Strategy Analysis');
  console.log('═'.repeat(80));

  if (!SERPAPI_KEY) {
    console.error('❌ SERPAPI_API_KEY not set');
    process.exit(1);
  }

  const results: StrategyResult[] = [];

  for (const strategy of QUERY_STRATEGIES) {
    console.log(`\n${'─'.repeat(80)}`);
    console.log(`📊 Testing: ${strategy.name}`);
    console.log(`   Description: ${strategy.description}`);
    console.log(`   Query: "${strategy.query}"`);

    try {
      const result = await evaluateStrategy(strategy);
      results.push(result);

      console.log(`\n   Results: ${result.totalResults.toLocaleString()} total, ${result.returnedCount} analyzed`);
      console.log(`   ✅ Relevant: ${result.relevantCount}/${result.returnedCount} (${(result.precision * 100).toFixed(1)}%)`);
      console.log(`   ❌ Noise: ${result.noiseCount}/${result.returnedCount} (${((result.noiseCount / result.returnedCount) * 100).toFixed(1)}%)`);
      console.log(`   🔢 Card ID Extract: ${(result.cardIdExtractRate * 100).toFixed(1)}%`);
      console.log(`   💰 Avg Price: $${result.avgPrice.toFixed(2)}`);

      console.log(`\n   Sample Listings:`);
      result.samples.forEach((s, i) => {
        const status = s.isNoise ? '❌' : s.isRelevant ? '✅' : '⚠️';
        console.log(`   ${i + 1}. ${status} ${s.title}...`);
        console.log(`      Price: ${s.price} | CardID: ${s.cardId || 'N/A'}`);
      });

    } catch (error) {
      console.log(`   ❌ Error: ${error instanceof Error ? error.message : error}`);
    }

    // Rate limiting
    await new Promise(r => setTimeout(r, 1500));
  }

  // ============================================================================
  // SUMMARY & RANKINGS
  // ============================================================================

  console.log('\n' + '═'.repeat(80));
  console.log('STRATEGY RANKINGS');
  console.log('═'.repeat(80));

  // Sort by ML suitability score
  const ranked = results
    .map(r => ({
      ...r,
      mlScore: (
        r.precision * 40 +           // 40% weight: precision
        r.cardIdExtractRate * 30 +   // 30% weight: card ID extraction
        r.priceRate * 20 +           // 20% weight: price availability
        (r.totalResults > 100 ? 10 : r.totalResults / 10) // 10% weight: volume
      ),
    }))
    .sort((a, b) => b.mlScore - a.mlScore);

  console.log('\n┌─────────────────────────────────┬─────────┬───────────┬──────────┬─────────┬──────────┐');
  console.log('│ Strategy                        │ Volume  │ Precision │ Card ID  │ Price   │ ML Score │');
  console.log('├─────────────────────────────────┼─────────┼───────────┼──────────┼─────────┼──────────┤');

  for (const r of ranked) {
    const name = r.strategy.name.substring(0, 31).padEnd(31);
    const vol = r.totalResults.toLocaleString().padStart(7);
    const prec = `${(r.precision * 100).toFixed(0)}%`.padStart(9);
    const cardId = `${(r.cardIdExtractRate * 100).toFixed(0)}%`.padStart(8);
    const price = `${(r.priceRate * 100).toFixed(0)}%`.padStart(7);
    const score = r.mlScore.toFixed(1).padStart(8);
    console.log(`│ ${name} │ ${vol} │ ${prec} │ ${cardId} │ ${price} │ ${score} │`);
  }

  console.log('└─────────────────────────────────┴─────────┴───────────┴──────────┴─────────┴──────────┘');

  // Top recommendations
  console.log('\n📋 TOP RECOMMENDATIONS FOR ML TRAINING:');
  console.log('─'.repeat(80));

  const top5 = ranked.slice(0, 5);
  top5.forEach((r, i) => {
    console.log(`\n${i + 1}. ${r.strategy.name} (Score: ${r.mlScore.toFixed(1)})`);
    console.log(`   Query: "${r.strategy.query}"`);
    console.log(`   Volume: ${r.totalResults.toLocaleString()} | Precision: ${(r.precision * 100).toFixed(0)}% | Card ID: ${(r.cardIdExtractRate * 100).toFixed(0)}%`);
  });

  // Key insights
  console.log('\n\n🔍 KEY INSIGHTS:');
  console.log('─'.repeat(80));

  // Best for volume
  const bestVolume = ranked.reduce((a, b) => a.totalResults > b.totalResults ? a : b);
  console.log(`• Highest Volume: "${bestVolume.strategy.name}" (${bestVolume.totalResults.toLocaleString()} listings)`);

  // Best for precision
  const bestPrecision = ranked.reduce((a, b) => a.precision > b.precision ? a : b);
  console.log(`• Highest Precision: "${bestPrecision.strategy.name}" (${(bestPrecision.precision * 100).toFixed(0)}%)`);

  // Best for card ID extraction
  const bestCardId = ranked.reduce((a, b) => a.cardIdExtractRate > b.cardIdExtractRate ? a : b);
  console.log(`• Best Card ID Extract: "${bestCardId.strategy.name}" (${(bestCardId.cardIdExtractRate * 100).toFixed(0)}%)`);

  // Highest value cards
  const highestValue = ranked.reduce((a, b) => a.avgPrice > b.avgPrice ? a : b);
  console.log(`• Highest Avg Value: "${highestValue.strategy.name}" ($${highestValue.avgPrice.toFixed(2)})`);
}

main();
