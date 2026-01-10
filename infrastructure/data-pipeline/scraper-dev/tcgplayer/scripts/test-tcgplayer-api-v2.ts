#!/usr/bin/env npx tsx
/**
 * Test TCGPlayer API v2 - Comprehensive endpoint testing
 *
 * Found working endpoint: /v2/product/{id}/pricepoints
 * Now testing more endpoints and methods.
 *
 * Usage:
 *   npx tsx scripts/test-tcgplayer-api-v2.ts
 */

import 'dotenv/config';
import * as fs from 'fs';

const TEST_PRODUCT_ID = '471372';  // One Piece Zoro parallel
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

interface PricePoint {
  printingType: string;
  condition?: string;
  marketPrice: number | null;
  buylistMarketPrice: number | null;
  listedMedianPrice: number | null;
  lowPrice?: number | null;
  midPrice?: number | null;
  highPrice?: number | null;
  directLowPrice?: number | null;
}

interface SearchResult {
  productId: number;
  productName: string;
  productLineName: string;
  setName: string;
  lowestPrice: number;
  marketPrice: number;
  imageUrl: string;
  productUrlName: string;
}

/**
 * Fetch with proper headers
 */
async function fetchAPI(url: string, options?: RequestInit): Promise<{ status: number; data: unknown }> {
  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'User-Agent': USER_AGENT,
        'Origin': 'https://www.tcgplayer.com',
        'Referer': 'https://www.tcgplayer.com/',
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });

    const text = await response.text();
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }

    return { status: response.status, data };
  } catch (error) {
    return { status: 0, data: { error: String(error) } };
  }
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  🔍 TCGPlayer API v2 Testing');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Product ID: ${TEST_PRODUCT_ID}`);

  // Test 1: Price Points (known working)
  console.log('\n\n' + '='.repeat(65));
  console.log('  TEST 1: Price Points API');
  console.log('='.repeat(65));

  const pricePointsUrl = `https://mpapi.tcgplayer.com/v2/product/${TEST_PRODUCT_ID}/pricepoints`;
  console.log(`\n📡 GET ${pricePointsUrl}`);

  const pricePointsResult = await fetchAPI(pricePointsUrl);
  console.log(`   Status: ${pricePointsResult.status}`);

  if (Array.isArray(pricePointsResult.data)) {
    const points = pricePointsResult.data as PricePoint[];
    console.log(`   ✅ Received ${points.length} price points\n`);

    console.log('   Price Points:');
    points.forEach((p, i) => {
      console.log(`   [${i + 1}] ${p.printingType}${p.condition ? ' - ' + p.condition : ''}`);
      console.log(`       Market: $${p.marketPrice ?? 'N/A'}, Low: $${p.lowPrice ?? 'N/A'}, Mid: $${p.midPrice ?? 'N/A'}`);
    });

    fs.writeFileSync('/tmp/tcgplayer-pricepoints.json', JSON.stringify(points, null, 2));
    console.log('\n   Saved to /tmp/tcgplayer-pricepoints.json');
  }

  // Test 2: Search API with POST
  console.log('\n\n' + '='.repeat(65));
  console.log('  TEST 2: Search API (POST)');
  console.log('='.repeat(65));

  const searchUrl = 'https://mp-search-api.tcgplayer.com/v1/search/request';
  const searchBody = {
    algorithm: 'sales_exp_fields_boosting',
    from: 0,
    size: 24,
    filters: {
      term: {
        productLineName: ['one-piece-card-game'],
        setName: ['romance-dawn'],
      },
      range: {},
      match: {},
    },
    listingSearch: {
      filters: {
        term: {},
        range: {},
        exclude: {
          channelExclusion: 0,
        },
      },
    },
    context: {
      cart: {},
      shippingCountry: 'US',
    },
    sort: {},
  };

  console.log(`\n📡 POST ${searchUrl}`);
  const searchResult = await fetchAPI(searchUrl, {
    method: 'POST',
    body: JSON.stringify(searchBody),
  });

  console.log(`   Status: ${searchResult.status}`);
  if (typeof searchResult.data === 'object') {
    const data = searchResult.data as Record<string, unknown>;
    if (data.results && Array.isArray(data.results)) {
      console.log(`   ✅ Received ${data.results.length} search results\n`);

      const results = data.results.slice(0, 5) as SearchResult[];
      console.log('   Sample Results:');
      results.forEach((r, i) => {
        console.log(`   [${i + 1}] ${r.productName} (ID: ${r.productId})`);
        console.log(`       Price: $${r.lowestPrice ?? r.marketPrice ?? 'N/A'}`);
      });

      fs.writeFileSync('/tmp/tcgplayer-search.json', JSON.stringify(data, null, 2));
      console.log('\n   Saved to /tmp/tcgplayer-search.json');
    } else {
      console.log(`   Response: ${JSON.stringify(data).substring(0, 200)}`);
    }
  }

  // Test 3: Listings via search listingSearch
  console.log('\n\n' + '='.repeat(65));
  console.log('  TEST 3: Product Listings via Search');
  console.log('='.repeat(65));

  const listingSearchBody = {
    algorithm: 'listings',
    from: 0,
    size: 50,
    filters: {
      term: {
        productId: [parseInt(TEST_PRODUCT_ID)],
      },
      range: {},
      match: {},
    },
    listingSearch: {
      filters: {
        term: {},
        range: {},
        exclude: {
          channelExclusion: 0,
        },
      },
    },
    context: {
      cart: {},
      shippingCountry: 'US',
    },
    sort: {
      field: 'price',
      order: 'asc',
    },
  };

  console.log(`\n📡 POST ${searchUrl} (listings mode)`);
  const listingsResult = await fetchAPI(searchUrl, {
    method: 'POST',
    body: JSON.stringify(listingSearchBody),
  });

  console.log(`   Status: ${listingsResult.status}`);
  if (typeof listingsResult.data === 'object') {
    const data = listingsResult.data as Record<string, unknown>;
    console.log(`   Response keys: ${Object.keys(data).join(', ')}`);

    if (data.results || data.listings) {
      const items = (data.results || data.listings) as unknown[];
      console.log(`   ✅ Found ${items.length} listings\n`);

      fs.writeFileSync('/tmp/tcgplayer-listings-search.json', JSON.stringify(data, null, 2));
      console.log('   Saved to /tmp/tcgplayer-listings-search.json');

      // Show sample
      console.log('\n   Sample listings:');
      items.slice(0, 5).forEach((item, i) => {
        const l = item as Record<string, unknown>;
        console.log(`   [${i + 1}] ${JSON.stringify(l).substring(0, 100)}...`);
      });
    } else {
      console.log(`   Response: ${JSON.stringify(data).substring(0, 300)}`);
    }
  }

  // Test 4: Alternative listing endpoint
  console.log('\n\n' + '='.repeat(65));
  console.log('  TEST 4: Direct Listing Endpoint (mpfev param)');
  console.log('='.repeat(65));

  const directListingsUrl = `https://mpapi.tcgplayer.com/v2/listing/${TEST_PRODUCT_ID}?mpfev=3071`;
  console.log(`\n📡 GET ${directListingsUrl}`);

  const directListingsResult = await fetchAPI(directListingsUrl);
  console.log(`   Status: ${directListingsResult.status}`);
  if (typeof directListingsResult.data === 'object' && directListingsResult.status === 200) {
    const data = directListingsResult.data as Record<string, unknown>;
    console.log(`   Response keys: ${Object.keys(data).join(', ')}`);
    fs.writeFileSync('/tmp/tcgplayer-direct-listings.json', JSON.stringify(data, null, 2));
    console.log('   Saved to /tmp/tcgplayer-direct-listings.json');
  }

  // Test 5: Try the productcondition endpoint
  console.log('\n\n' + '='.repeat(65));
  console.log('  TEST 5: Product Conditions Endpoint');
  console.log('='.repeat(65));

  const conditionsUrl = `https://mpapi.tcgplayer.com/v2/product/${TEST_PRODUCT_ID}/productconditions`;
  console.log(`\n📡 GET ${conditionsUrl}`);

  const conditionsResult = await fetchAPI(conditionsUrl);
  console.log(`   Status: ${conditionsResult.status}`);
  if (Array.isArray(conditionsResult.data)) {
    console.log(`   ✅ Found ${conditionsResult.data.length} conditions`);
    fs.writeFileSync('/tmp/tcgplayer-conditions.json', JSON.stringify(conditionsResult.data, null, 2));
    console.log('   Saved to /tmp/tcgplayer-conditions.json');

    // Show sample
    conditionsResult.data.slice(0, 5).forEach((c, i) => {
      const cond = c as Record<string, unknown>;
      console.log(`   [${i + 1}] ${JSON.stringify(cond).substring(0, 80)}...`);
    });
  }

  // Summary
  console.log('\n\n═══════════════════════════════════════════════════════════════');
  console.log('  📊 SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`
  Available public APIs:
    ✅ Price Points: /v2/product/{id}/pricepoints
       - Market price, buylist price, low/mid/high
       - By condition and printing type

  Files saved to /tmp/tcgplayer-*.json
  `);

  console.log('═══════════════════════════════════════════════════════════════\n');
}

main();
