#!/usr/bin/env npx tsx
/**
 * Test TCGPlayer API Endpoints
 *
 * TCGPlayer has several API endpoints that may be accessible:
 * - mpapi.tcgplayer.com - Marketplace API
 * - mp-search-api.tcgplayer.com - Search API
 *
 * This script tests direct API calls without Bright Data to see
 * what's available publicly.
 *
 * Usage:
 *   npx tsx scripts/test-tcgplayer-api.ts
 */

import 'dotenv/config';
import * as fs from 'fs';

const BRIGHTDATA_TOKEN = process.env.BRIGHTDATA_TOKEN;
const TEST_PRODUCT_ID = '471372';  // One Piece Zoro parallel

interface APITestResult {
  endpoint: string;
  status: number | string;
  contentType: string;
  dataType: 'json' | 'html' | 'error' | 'empty';
  sample: string;
  success: boolean;
}

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * Try fetching an endpoint directly (no proxy)
 */
async function fetchDirect(url: string): Promise<APITestResult> {
  try {
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'User-Agent': USER_AGENT,
        'Origin': 'https://www.tcgplayer.com',
        'Referer': 'https://www.tcgplayer.com/',
      },
    });

    const contentType = response.headers.get('content-type') || '';
    const text = await response.text();

    let dataType: 'json' | 'html' | 'error' | 'empty' = 'empty';
    if (text.startsWith('{') || text.startsWith('[')) {
      dataType = 'json';
    } else if (text.includes('<!DOCTYPE') || text.includes('<html')) {
      dataType = 'html';
    } else if (text.length === 0) {
      dataType = 'empty';
    } else {
      dataType = 'error';
    }

    return {
      endpoint: url,
      status: response.status,
      contentType,
      dataType,
      sample: text.substring(0, 300),
      success: response.ok && dataType === 'json',
    };
  } catch (error) {
    return {
      endpoint: url,
      status: String(error),
      contentType: 'error',
      dataType: 'error',
      sample: String(error).substring(0, 200),
      success: false,
    };
  }
}

/**
 * Try fetching via Bright Data proxy
 */
async function fetchViaProxy(url: string): Promise<APITestResult> {
  if (!BRIGHTDATA_TOKEN) {
    return {
      endpoint: url,
      status: 'no token',
      contentType: 'error',
      dataType: 'error',
      sample: 'BRIGHTDATA_TOKEN not set',
      success: false,
    };
  }

  try {
    const response = await fetch('https://api.brightdata.com/request', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${BRIGHTDATA_TOKEN}`,
      },
      body: JSON.stringify({
        zone: 'mcp_unlocker',
        url: url,
        format: 'raw',
        headers: {
          'Accept': 'application/json, text/plain, */*',
          'Accept-Language': 'en-US,en;q=0.9',
          'User-Agent': USER_AGENT,
          'Origin': 'https://www.tcgplayer.com',
          'Referer': 'https://www.tcgplayer.com/',
        },
      }),
    });

    const contentType = response.headers.get('content-type') || '';
    const text = await response.text();

    let dataType: 'json' | 'html' | 'error' | 'empty' = 'empty';
    if (text.startsWith('{') || text.startsWith('[')) {
      dataType = 'json';
    } else if (text.includes('<!DOCTYPE') || text.includes('<html')) {
      dataType = 'html';
    } else if (text.length === 0) {
      dataType = 'empty';
    } else {
      dataType = 'error';
    }

    return {
      endpoint: url,
      status: response.status,
      contentType,
      dataType,
      sample: text.substring(0, 300),
      success: response.ok && dataType === 'json',
    };
  } catch (error) {
    return {
      endpoint: url,
      status: String(error),
      contentType: 'error',
      dataType: 'error',
      sample: String(error).substring(0, 200),
      success: false,
    };
  }
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  🔍 TCGPlayer API Endpoint Discovery');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Product ID: ${TEST_PRODUCT_ID}`);
  console.log(`  Bright Data: ${BRIGHTDATA_TOKEN ? '✅ Available' : '❌ Not configured'}`);

  // Known/suspected TCGPlayer API endpoints
  const endpoints = [
    // Price endpoints
    `https://mpapi.tcgplayer.com/v2/product/${TEST_PRODUCT_ID}/pricepoints`,
    `https://mpapi.tcgplayer.com/v2/product/${TEST_PRODUCT_ID}/details`,
    `https://mpapi.tcgplayer.com/v2/product/${TEST_PRODUCT_ID}/latestsales`,
    `https://mpapi.tcgplayer.com/v2/product/${TEST_PRODUCT_ID}/listings`,

    // Product info
    `https://mpapi.tcgplayer.com/v2/product/${TEST_PRODUCT_ID}`,
    `https://mpgateway.tcgplayer.com/v2/product/${TEST_PRODUCT_ID}`,

    // Search API
    `https://mp-search-api.tcgplayer.com/v1/search/request?q=roronoa+zoro&isList=false`,

    // Infinite API (article/content)
    `https://infinite-api.tcgplayer.com/article/search?q=one+piece`,

    // Legacy/alternative endpoints
    `https://mpapi.tcgplayer.com/product/${TEST_PRODUCT_ID}`,
    `https://mpapi.tcgplayer.com/product/pricepoints?productId=${TEST_PRODUCT_ID}`,
  ];

  console.log('\n\n' + '='.repeat(65));
  console.log('  TEST 1: Direct API Calls (no proxy)');
  console.log('='.repeat(65));

  const directResults: APITestResult[] = [];
  for (const endpoint of endpoints) {
    const shortUrl = endpoint.replace('https://', '').substring(0, 60);
    console.log(`\n📡 ${shortUrl}...`);
    const result = await fetchDirect(endpoint);
    directResults.push(result);

    const icon = result.success ? '✅' : result.dataType === 'html' ? '⚠️' : '❌';
    console.log(`   ${icon} Status: ${result.status}, Type: ${result.dataType}`);
    if (result.success) {
      console.log(`   Sample: ${result.sample.substring(0, 100)}...`);
    }
  }

  console.log('\n\n' + '='.repeat(65));
  console.log('  TEST 2: Via Bright Data Proxy');
  console.log('='.repeat(65));

  // Only test endpoints that failed direct
  const failedEndpoints = endpoints.filter((_, i) => !directResults[i].success).slice(0, 5);

  if (BRIGHTDATA_TOKEN) {
    for (const endpoint of failedEndpoints) {
      const shortUrl = endpoint.replace('https://', '').substring(0, 60);
      console.log(`\n📡 ${shortUrl}...`);
      const result = await fetchViaProxy(endpoint);

      const icon = result.success ? '✅' : result.dataType === 'html' ? '⚠️' : '❌';
      console.log(`   ${icon} Status: ${result.status}, Type: ${result.dataType}`);
      if (result.success) {
        console.log(`   Sample: ${result.sample.substring(0, 100)}...`);

        // Save successful JSON response
        try {
          const data = JSON.parse(result.sample);
          const filename = `/tmp/tcgplayer-api-${Date.now()}.json`;
          fs.writeFileSync(filename, JSON.stringify(data, null, 2));
          console.log(`   Saved to ${filename}`);
        } catch {}
      }
    }
  } else {
    console.log('\n  ⚠️ Skipping proxy tests - BRIGHTDATA_TOKEN not set');
  }

  // Summary
  console.log('\n\n═══════════════════════════════════════════════════════════════');
  console.log('  📊 SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════');

  const successfulDirect = directResults.filter(r => r.success);
  console.log(`\n  Direct API calls: ${successfulDirect.length}/${directResults.length} successful`);

  if (successfulDirect.length > 0) {
    console.log('\n  Working endpoints:');
    successfulDirect.forEach(r => {
      console.log(`    ✅ ${r.endpoint.replace('https://', '').substring(0, 70)}`);
    });
  }

  const corsBlocked = directResults.filter(r => r.dataType === 'error' && String(r.status).includes('CORS'));
  if (corsBlocked.length > 0) {
    console.log(`\n  CORS blocked (need proxy): ${corsBlocked.length}`);
  }

  console.log('\n═══════════════════════════════════════════════════════════════\n');
}

main();
