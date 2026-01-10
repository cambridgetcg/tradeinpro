/**
 * SerpApi eBay Rarity-Specific Search Test
 *
 * Tests sold listings for specific TCG rarities to evaluate
 * data quality for ML training.
 *
 * Run with: npx tsx src/test-serpapi-rarity.ts
 */

import * as dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: resolve(__dirname, '../.env') });

const SERPAPI_KEY = process.env.SERPAPI_API_KEY || '';

interface SerpApiResult {
  title: string;
  link: string;
  price?: {
    raw: string;
    extracted: number;
  };
  shipping?: string;
  condition?: string;
  sold_date?: string;
  bids?: number;
  thumbnail?: string;
}

interface SerpApiResponse {
  search_metadata: {
    status: string;
    total_time_taken: number;
  };
  search_information: {
    total_results: number;
  };
  organic_results?: SerpApiResult[];
  error?: string;
}

interface RarityQuery {
  game: string;
  rarity: string;
  query: string;
  expectedPatterns: string[];  // Patterns we expect to find in titles
}

// Rarity-specific queries for different TCGs
const RARITY_QUERIES: RarityQuery[] = [
  // One Piece TCG - Parallel/Alt Art
  {
    game: 'One Piece',
    rarity: 'Parallel',
    query: 'One Piece TCG parallel art',
    expectedPatterns: ['parallel', 'alt art', 'alternate'],
  },
  {
    game: 'One Piece',
    rarity: 'SP (Special Art)',
    query: 'One Piece TCG SP special art',
    expectedPatterns: ['SP', 'special art', 'special'],
  },
  {
    game: 'One Piece',
    rarity: 'Manga Art',
    query: 'One Piece TCG manga art rare',
    expectedPatterns: ['manga', 'comic'],
  },
  {
    game: 'One Piece',
    rarity: 'Secret Rare',
    query: 'One Piece TCG SEC secret rare',
    expectedPatterns: ['SEC', 'secret', 'SR'],
  },

  // Pokemon TCG - Alt Art / Special Art Rare
  {
    game: 'Pokemon',
    rarity: 'Alt Art',
    query: 'Pokemon TCG alt art illustration rare',
    expectedPatterns: ['alt art', 'alternate art', 'illustration rare', 'SAR'],
  },
  {
    game: 'Pokemon',
    rarity: 'Special Art Rare',
    query: 'Pokemon TCG special art rare SAR',
    expectedPatterns: ['SAR', 'special art', 'full art'],
  },
  {
    game: 'Pokemon',
    rarity: 'Gold Rare',
    query: 'Pokemon TCG gold rare hyper',
    expectedPatterns: ['gold', 'hyper rare', 'UR'],
  },

  // Yu-Gi-Oh - Starlight / Ultimate Rare
  {
    game: 'Yu-Gi-Oh',
    rarity: 'Starlight Rare',
    query: 'Yu-Gi-Oh starlight rare',
    expectedPatterns: ['starlight', 'STRL'],
  },
  {
    game: 'Yu-Gi-Oh',
    rarity: 'Ultimate Rare',
    query: 'Yu-Gi-Oh ultimate rare',
    expectedPatterns: ['ultimate', 'ulti'],
  },
  {
    game: 'Yu-Gi-Oh',
    rarity: 'Ghost Rare',
    query: 'Yu-Gi-Oh ghost rare',
    expectedPatterns: ['ghost'],
  },
];

/**
 * Search eBay sold listings
 */
async function searchSoldListings(query: string): Promise<SerpApiResponse> {
  const params = new URLSearchParams({
    engine: 'ebay',
    _nkw: query,
    show_only: 'Sold',
    _ipg: '100',  // Get more results for analysis
    api_key: SERPAPI_KEY,
  });

  const response = await fetch(`https://serpapi.com/search?${params}`);
  if (!response.ok) {
    throw new Error(`SerpApi request failed: ${response.status}`);
  }
  return response.json();
}

/**
 * Analyze data quality for ML training
 */
function analyzeDataQuality(items: SerpApiResult[], expectedPatterns: string[]): {
  totalItems: number;
  withPrice: number;
  withCondition: number;
  withSoldDate: number;
  patternMatches: number;
  priceRange: { min: number; max: number; avg: number };
  sampleTitles: string[];
  qualityScore: number;
} {
  const withPrice = items.filter(i => i.price?.extracted).length;
  const withCondition = items.filter(i => i.condition).length;
  const withSoldDate = items.filter(i => i.sold_date).length;

  // Check how many titles contain expected rarity patterns
  const patternMatches = items.filter(item => {
    const titleLower = item.title.toLowerCase();
    return expectedPatterns.some(p => titleLower.includes(p.toLowerCase()));
  }).length;

  // Calculate price statistics
  const prices = items
    .map(i => i.price?.extracted)
    .filter((p): p is number => typeof p === 'number' && p > 0);

  const priceRange = prices.length > 0 ? {
    min: Math.min(...prices),
    max: Math.max(...prices),
    avg: prices.reduce((a, b) => a + b, 0) / prices.length,
  } : { min: 0, max: 0, avg: 0 };

  // Quality score (0-100)
  const qualityScore = Math.round(
    (withPrice / items.length * 30) +     // 30% weight: has price
    (withCondition / items.length * 20) + // 20% weight: has condition
    (withSoldDate / items.length * 20) +  // 20% weight: has sold date
    (patternMatches / items.length * 30)  // 30% weight: matches rarity pattern
  );

  return {
    totalItems: items.length,
    withPrice,
    withCondition,
    withSoldDate,
    patternMatches,
    priceRange,
    sampleTitles: items.slice(0, 5).map(i => i.title),
    qualityScore,
  };
}

/**
 * Extract potential card identifiers from title
 */
function extractCardInfo(title: string): {
  setCode?: string;
  cardNumber?: string;
  rarity?: string;
  graded?: boolean;
  grade?: string;
} {
  const info: ReturnType<typeof extractCardInfo> = {};

  // One Piece set codes (OP01, OP02, etc.)
  const opMatch = title.match(/\b(OP\d{2}|EB\d{2}|ST\d{2}|PRB\d{2})-?(\d{3})?\b/i);
  if (opMatch) {
    info.setCode = opMatch[1].toUpperCase();
    if (opMatch[2]) info.cardNumber = opMatch[2];
  }

  // Pokemon set codes
  const pkmnMatch = title.match(/\b(\d{3}\/\d{3})\b/);
  if (pkmnMatch) info.cardNumber = pkmnMatch[1];

  // Yu-Gi-Oh set codes
  const ygoMatch = title.match(/\b([A-Z]{2,4}-[A-Z]{2}\d{3})\b/);
  if (ygoMatch) info.cardNumber = ygoMatch[1];

  // Rarity indicators
  if (/\bparallel\b/i.test(title)) info.rarity = 'parallel';
  else if (/\bSP\b/.test(title) || /special art/i.test(title)) info.rarity = 'sp';
  else if (/\bmanga\b/i.test(title)) info.rarity = 'manga';
  else if (/\bSEC\b/.test(title) || /secret rare/i.test(title)) info.rarity = 'secret';
  else if (/\balt art\b/i.test(title)) info.rarity = 'alt_art';
  else if (/\bSAR\b/.test(title)) info.rarity = 'sar';
  else if (/starlight/i.test(title)) info.rarity = 'starlight';
  else if (/ultimate/i.test(title)) info.rarity = 'ultimate';
  else if (/ghost/i.test(title)) info.rarity = 'ghost';

  // Grading info
  if (/\bPSA\b|\bCGC\b|\bBGS\b/i.test(title)) {
    info.graded = true;
    const gradeMatch = title.match(/\b(PSA|CGC|BGS)\s*(\d+\.?\d?)\b/i);
    if (gradeMatch) info.grade = `${gradeMatch[1].toUpperCase()} ${gradeMatch[2]}`;
  }

  return info;
}

async function main() {
  console.log('═'.repeat(70));
  console.log('SerpApi eBay Rarity-Specific Data Quality Test');
  console.log('═'.repeat(70));

  if (!SERPAPI_KEY) {
    console.error('❌ SERPAPI_API_KEY not set');
    process.exit(1);
  }

  const results: Array<{
    query: RarityQuery;
    totalAvailable: number;
    quality: ReturnType<typeof analyzeDataQuality>;
  }> = [];

  for (const rarityQuery of RARITY_QUERIES) {
    console.log(`\n${'─'.repeat(70)}`);
    console.log(`🎴 ${rarityQuery.game} - ${rarityQuery.rarity}`);
    console.log(`   Query: "${rarityQuery.query}"`);

    try {
      const response = await searchSoldListings(rarityQuery.query);

      if (response.error) {
        console.log(`   ❌ Error: ${response.error}`);
        continue;
      }

      const items = response.organic_results || [];
      const totalAvailable = response.search_information?.total_results || 0;
      const quality = analyzeDataQuality(items, rarityQuery.expectedPatterns);

      results.push({ query: rarityQuery, totalAvailable, quality });

      console.log(`\n   📊 Results: ${totalAvailable.toLocaleString()} total, ${items.length} returned`);
      console.log(`   ✅ Quality Score: ${quality.qualityScore}/100`);
      console.log(`\n   Data Completeness:`);
      console.log(`      With Price:     ${quality.withPrice}/${quality.totalItems} (${Math.round(quality.withPrice/quality.totalItems*100)}%)`);
      console.log(`      With Condition: ${quality.withCondition}/${quality.totalItems} (${Math.round(quality.withCondition/quality.totalItems*100)}%)`);
      console.log(`      With Sold Date: ${quality.withSoldDate}/${quality.totalItems} (${Math.round(quality.withSoldDate/quality.totalItems*100)}%)`);
      console.log(`      Rarity Match:   ${quality.patternMatches}/${quality.totalItems} (${Math.round(quality.patternMatches/quality.totalItems*100)}%)`);

      if (quality.priceRange.avg > 0) {
        console.log(`\n   💰 Price Range: $${quality.priceRange.min.toFixed(2)} - $${quality.priceRange.max.toFixed(2)} (avg: $${quality.priceRange.avg.toFixed(2)})`);
      }

      console.log(`\n   📝 Sample Listings:`);
      items.slice(0, 3).forEach((item, i) => {
        const cardInfo = extractCardInfo(item.title);
        console.log(`      ${i + 1}. ${item.title.substring(0, 65)}...`);
        console.log(`         Price: ${item.price?.raw || 'N/A'} | Condition: ${item.condition || 'N/A'} | Sold: ${item.sold_date || 'N/A'}`);
        if (Object.keys(cardInfo).length > 0) {
          console.log(`         Extracted: ${JSON.stringify(cardInfo)}`);
        }
      });

    } catch (error) {
      console.log(`   ❌ Failed: ${error instanceof Error ? error.message : error}`);
    }

    // Rate limit: be respectful
    await new Promise(r => setTimeout(r, 1500));
  }

  // Summary report
  console.log('\n' + '═'.repeat(70));
  console.log('SUMMARY - Data Quality for ML Training');
  console.log('═'.repeat(70));

  console.log('\n┌────────────────┬─────────────────────┬─────────┬─────────┬───────────┐');
  console.log('│ Game           │ Rarity              │ Volume  │ Quality │ ML Ready  │');
  console.log('├────────────────┼─────────────────────┼─────────┼─────────┼───────────┤');

  for (const r of results) {
    const mlReady = r.quality.qualityScore >= 70 && r.totalAvailable >= 100 ? '✅ Yes' :
                    r.quality.qualityScore >= 50 ? '⚠️ Partial' : '❌ No';
    console.log(
      `│ ${r.query.game.padEnd(14)} │ ${r.query.rarity.padEnd(19)} │ ${r.totalAvailable.toLocaleString().padStart(7)} │ ${(r.quality.qualityScore + '/100').padStart(7)} │ ${mlReady.padEnd(9)} │`
    );
  }

  console.log('└────────────────┴─────────────────────┴─────────┴─────────┴───────────┘');

  // ML Training Recommendations
  console.log('\n📋 ML Training Recommendations:');

  const goodQueries = results.filter(r => r.quality.qualityScore >= 70 && r.totalAvailable >= 100);
  const partialQueries = results.filter(r => r.quality.qualityScore >= 50 && r.quality.qualityScore < 70);

  if (goodQueries.length > 0) {
    console.log('\n   ✅ High Quality Data (ready for training):');
    goodQueries.forEach(r => {
      console.log(`      - ${r.query.game} ${r.query.rarity}: ${r.totalAvailable.toLocaleString()} listings, ${r.quality.qualityScore}/100 quality`);
    });
  }

  if (partialQueries.length > 0) {
    console.log('\n   ⚠️ Partial Quality (needs filtering/cleaning):');
    partialQueries.forEach(r => {
      console.log(`      - ${r.query.game} ${r.query.rarity}: ${r.totalAvailable.toLocaleString()} listings, ${r.quality.qualityScore}/100 quality`);
    });
  }

  console.log('\n   📊 Key Insights:');
  console.log('      - Price data available for most sold listings');
  console.log('      - Sold dates help track price trends over time');
  console.log('      - Title parsing can extract set codes and card numbers');
  console.log('      - Graded vs raw cards can be distinguished');
  console.log('      - Rarity patterns detectable but may need refinement');

  console.log('\n   🔧 Suggested Data Pipeline:');
  console.log('      1. Fetch sold listings with rarity-specific queries');
  console.log('      2. Parse titles to extract card identifiers');
  console.log('      3. Filter graded cards separately from raw');
  console.log('      4. Aggregate prices by card + condition');
  console.log('      5. Store with timestamps for trend analysis');
}

main();
