/**
 * SerpApi eBay Sold Listings Test
 *
 * Tests the SerpApi eBay Search API with sold items filter.
 * Run with: npx tsx src/test-serpapi.ts
 */

import * as dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: resolve(__dirname, '../.env') });

const SERPAPI_KEY = process.env.SERPAPI_API_KEY || '***REMOVED-ROTATE-ME***';

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
}

interface SerpApiResponse {
  search_metadata: {
    status: string;
    total_time_taken: number;
  };
  search_information: {
    total_results: number;
    results_state: string;
  };
  organic_results?: SerpApiResult[];
  error?: string;
}

/**
 * Search eBay sold listings via SerpApi
 */
async function searchSoldListings(query: string, limit: number = 50): Promise<SerpApiResponse> {
  const params = new URLSearchParams({
    engine: 'ebay',
    _nkw: query,
    show_only: 'Sold',  // Filter for sold items only
    _ipg: String(limit), // Results per page (25, 50, 100, 200)
    api_key: SERPAPI_KEY,
  });

  const url = `https://serpapi.com/search?${params}`;

  console.log(`🔍 Searching: "${query}" (sold items only)`);
  console.log(`   URL: ${url.replace(SERPAPI_KEY, '***')}`);

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`SerpApi request failed: ${response.status}`);
  }

  return response.json();
}

/**
 * Test different TCG searches
 */
async function main() {
  console.log('═'.repeat(60));
  console.log('SerpApi eBay Sold Listings Test');
  console.log('═'.repeat(60));

  if (!SERPAPI_KEY) {
    console.error('❌ SERPAPI_API_KEY not set in .env');
    process.exit(1);
  }

  console.log(`✅ API Key: ${SERPAPI_KEY.substring(0, 20)}...`);

  const testQueries = [
    'One Piece TCG OP01 Luffy',
    'Pokemon Charizard PSA 10',
    'Yu-Gi-Oh Blue Eyes White Dragon',
  ];

  for (const query of testQueries) {
    console.log('\n' + '─'.repeat(60));

    try {
      const result = await searchSoldListings(query, 50);

      if (result.error) {
        console.log(`❌ Error: ${result.error}`);
        continue;
      }

      const totalResults = result.search_information?.total_results || 0;
      const items = result.organic_results || [];

      console.log(`✅ Found ${totalResults.toLocaleString()} total sold listings`);
      console.log(`   Returned ${items.length} items in this page`);
      console.log(`   Query time: ${result.search_metadata?.total_time_taken?.toFixed(2)}s`);

      if (items.length > 0) {
        console.log('\n   Sample sold items:');
        items.slice(0, 3).forEach((item, i) => {
          console.log(`   ${i + 1}. ${item.title?.substring(0, 60)}...`);
          console.log(`      Price: ${item.price?.raw || 'N/A'}`);
          console.log(`      Condition: ${item.condition || 'N/A'}`);
          if (item.sold_date) {
            console.log(`      Sold: ${item.sold_date}`);
          }
        });
      }

    } catch (error) {
      console.log(`❌ Failed: ${error instanceof Error ? error.message : error}`);
    }

    // Small delay between requests to be respectful
    await new Promise(r => setTimeout(r, 1000));
  }

  console.log('\n' + '═'.repeat(60));
  console.log('Test complete');
  console.log('═'.repeat(60));
}

main();
