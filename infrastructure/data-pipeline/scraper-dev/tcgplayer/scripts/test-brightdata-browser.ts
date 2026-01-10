#!/usr/bin/env npx tsx
/**
 * Test Bright Data Browser Mode for TCGPlayer SPA
 *
 * TCGPlayer is a JavaScript SPA that requires browser rendering.
 * This script tests two approaches:
 * 1. Bright Data with JavaScript rendering (render_js mode)
 * 2. Direct TCGPlayer API calls via Bright Data proxy
 *
 * Usage:
 *   BRIGHTDATA_TOKEN=xxx npx tsx scripts/test-brightdata-browser.ts
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as cheerio from 'cheerio';

const BRIGHTDATA_TOKEN = process.env.BRIGHTDATA_TOKEN;
const SAVE_HTML = process.argv.includes('--save-html');

// Test product - One Piece Roronoa Zoro parallel (known good listing)
const TEST_PRODUCT_ID = '471372';
const TEST_PRODUCT_URL = `https://www.tcgplayer.com/product/${TEST_PRODUCT_ID}/one-piece-card-game-romance-dawn-roronoa-zoro-op01-025-parallel?Language=English`;

// TCGPlayer internal API endpoints (discovered from CSP)
const TCGPLAYER_API = {
  marketplace: 'https://mpapi.tcgplayer.com',
  search: 'https://mp-search-api.tcgplayer.com',
};

interface BrightDataResponse {
  html?: string;
  json?: unknown;
  error?: string;
}

/**
 * Approach 1: Bright Data with JavaScript rendering
 */
async function fetchWithBrowserRendering(url: string): Promise<BrightDataResponse> {
  console.log(`\n📡 [Browser Mode] Fetching: ${url.substring(0, 60)}...`);

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
        // Enable JavaScript rendering
        render_js: true,
        // Wait for specific element to appear (listings)
        wait_for: '[class*="listing"], [class*="seller"], [data-testid="listing"]',
        // Or wait a fixed time for SPA to load
        wait: 5000,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return { error: `API error ${response.status}: ${errorText}` };
    }

    const html = await response.text();
    return { html };
  } catch (error) {
    return { error: String(error) };
  }
}

/**
 * Approach 2: Call TCGPlayer's internal API directly
 *
 * TCGPlayer's marketplace API returns JSON with listing data.
 * We use Bright Data to proxy the request to avoid blocks.
 */
async function fetchListingsFromAPI(productId: string): Promise<BrightDataResponse> {
  console.log(`\n📡 [API Mode] Fetching listings for product ${productId}...`);

  // TCGPlayer's listing API endpoint (discovered from network traffic)
  // Format: /v2/product/{productId}/listings
  const apiUrl = `${TCGPLAYER_API.marketplace}/v2/product/${productId}/listings?mpfev=3071`;

  try {
    const response = await fetch('https://api.brightdata.com/request', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${BRIGHTDATA_TOKEN}`,
      },
      body: JSON.stringify({
        zone: 'mcp_unlocker',
        url: apiUrl,
        format: 'raw',
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          'Referer': `https://www.tcgplayer.com/product/${productId}`,
          'Origin': 'https://www.tcgplayer.com',
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return { error: `API error ${response.status}: ${errorText}` };
    }

    const text = await response.text();

    // Try to parse as JSON
    try {
      const json = JSON.parse(text);
      return { json };
    } catch {
      // If not JSON, might be HTML (blocked or redirected)
      return { html: text };
    }
  } catch (error) {
    return { error: String(error) };
  }
}

/**
 * Approach 3: Try alternative API endpoints
 */
async function fetchProductDetails(productId: string): Promise<BrightDataResponse> {
  console.log(`\n📡 [Product API] Fetching details for product ${productId}...`);

  // Try different API endpoints
  const endpoints = [
    `/product/${productId}`,
    `/v2/product/${productId}`,
    `/products/${productId}`,
  ];

  for (const endpoint of endpoints) {
    const apiUrl = `${TCGPLAYER_API.marketplace}${endpoint}`;
    console.log(`   Trying: ${apiUrl}`);

    try {
      const response = await fetch('https://api.brightdata.com/request', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${BRIGHTDATA_TOKEN}`,
        },
        body: JSON.stringify({
          zone: 'mcp_unlocker',
          url: apiUrl,
          format: 'raw',
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
            'Referer': 'https://www.tcgplayer.com/',
            'Origin': 'https://www.tcgplayer.com',
          },
        }),
      });

      const text = await response.text();

      if (response.ok && text.startsWith('{')) {
        try {
          const json = JSON.parse(text);
          console.log(`   ✅ Success with ${endpoint}`);
          return { json };
        } catch {
          // Not valid JSON
        }
      }
    } catch (error) {
      console.log(`   ❌ Error: ${error}`);
    }
  }

  return { error: 'All API endpoints failed' };
}

/**
 * Analyze browser-rendered HTML for listing content
 */
function analyzeBrowserHtml(html: string): void {
  const $ = cheerio.load(html);

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  📊 BROWSER-RENDERED HTML ANALYSIS');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  HTML Length: ${(html.length / 1024).toFixed(1)}KB`);

  // Check if page has actual content (not just shell)
  const bodyText = $('body').text().trim();
  const hasContent = bodyText.length > 1000;
  console.log(`  Has Content: ${hasContent ? '✅ Yes' : '❌ No (still SPA shell)'}`);

  // Look for product name
  const productName = $('h1').first().text().trim();
  console.log(`  Product Name: ${productName || '❌ Not found'}`);

  // Look for price elements
  console.log('\n  💰 Price Elements:');
  $('[class*="price"]').slice(0, 10).each((i, el) => {
    const text = $(el).text().trim().substring(0, 50);
    if (text.includes('$')) {
      console.log(`     [${i}] ${text}`);
    }
  });

  // Look for listing elements
  console.log('\n  📋 Listing Elements:');
  const listingSelectors = [
    '.listing-item',
    '[class*="listing"]',
    '.seller-listing',
    '[class*="seller"]',
    '.inventory-listing',
    '[data-testid*="listing"]',
    'table tbody tr',
  ];

  for (const sel of listingSelectors) {
    const count = $(sel).length;
    if (count > 0) {
      console.log(`     ✅ ${sel}: ${count} element(s)`);
      // Show first listing content
      const firstText = $(sel).first().text().trim().substring(0, 80);
      if (firstText) {
        console.log(`        Sample: "${firstText.replace(/\s+/g, ' ')}..."`);
      }
    }
  }

  // Check for embedded JSON data (Next.js, Nuxt, etc.)
  console.log('\n  📦 Embedded Data:');
  $('script').each((i, el) => {
    const content = $(el).html() || '';
    if (content.includes('"listings"') || content.includes('"sellerName"')) {
      console.log(`     ✅ Found listing data in script tag`);
      // Try to extract sample
      const match = content.match(/"listings"\s*:\s*\[([\s\S]{0,300})/);
      if (match) {
        console.log(`        Sample: ${match[0].substring(0, 150)}...`);
      }
    }
    if (content.includes('__NEXT_DATA__') || content.includes('__NUXT__')) {
      console.log(`     ✅ Found SSR data: ${content.substring(0, 50)}...`);
    }
  });
}

/**
 * Analyze API response
 */
function analyzeApiResponse(data: unknown): void {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  📊 API RESPONSE ANALYSIS');
  console.log('═══════════════════════════════════════════════════════════════');

  if (typeof data !== 'object' || !data) {
    console.log(`  Response type: ${typeof data}`);
    return;
  }

  const obj = data as Record<string, unknown>;
  console.log(`  Top-level keys: ${Object.keys(obj).join(', ')}`);

  // Check for listings
  if (Array.isArray(obj.listings)) {
    console.log(`\n  📋 Listings: ${obj.listings.length} found`);
    const first = obj.listings[0] as Record<string, unknown>;
    if (first) {
      console.log(`  Sample listing keys: ${Object.keys(first).join(', ')}`);
      console.log(`  Sample listing:`);
      console.log(JSON.stringify(first, null, 2).split('\n').slice(0, 15).join('\n'));
    }
  }

  // Check for results array
  if (Array.isArray(obj.results)) {
    console.log(`\n  📋 Results: ${obj.results.length} found`);
    const first = obj.results[0] as Record<string, unknown>;
    if (first) {
      console.log(`  Sample result keys: ${Object.keys(first).join(', ')}`);
    }
  }

  // Check for product data
  if (obj.product || obj.productDetails) {
    console.log('\n  🃏 Product Data Found');
    const product = (obj.product || obj.productDetails) as Record<string, unknown>;
    console.log(`  Product keys: ${Object.keys(product).join(', ')}`);
  }
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  🔍 Bright Data Browser Rendering Test');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Token: ${BRIGHTDATA_TOKEN ? '✅ Configured' : '❌ Missing'}`);
  console.log(`  Product ID: ${TEST_PRODUCT_ID}`);

  if (!BRIGHTDATA_TOKEN) {
    console.error('\n❌ BRIGHTDATA_TOKEN not set');
    process.exit(1);
  }

  // Test 1: Browser rendering mode
  console.log('\n\n' + '='.repeat(65));
  console.log('  TEST 1: Browser Rendering Mode (render_js=true)');
  console.log('='.repeat(65));

  const browserResult = await fetchWithBrowserRendering(TEST_PRODUCT_URL);

  if (browserResult.error) {
    console.log(`\n  ❌ Error: ${browserResult.error}`);
  } else if (browserResult.html) {
    console.log(`\n  ✅ Received ${(browserResult.html.length / 1024).toFixed(1)}KB of HTML`);
    analyzeBrowserHtml(browserResult.html);

    if (SAVE_HTML) {
      fs.writeFileSync('/tmp/tcgplayer-browser.html', browserResult.html);
      console.log('\n  Saved to /tmp/tcgplayer-browser.html');
    }
  }

  // Test 2: Direct API call for listings
  console.log('\n\n' + '='.repeat(65));
  console.log('  TEST 2: Direct Listings API');
  console.log('='.repeat(65));

  const listingsResult = await fetchListingsFromAPI(TEST_PRODUCT_ID);

  if (listingsResult.error) {
    console.log(`\n  ❌ Error: ${listingsResult.error}`);
  } else if (listingsResult.json) {
    console.log('\n  ✅ Received JSON response');
    analyzeApiResponse(listingsResult.json);

    if (SAVE_HTML) {
      fs.writeFileSync('/tmp/tcgplayer-listings.json', JSON.stringify(listingsResult.json, null, 2));
      console.log('\n  Saved to /tmp/tcgplayer-listings.json');
    }
  } else if (listingsResult.html) {
    console.log(`\n  ⚠️ Received HTML instead of JSON (${listingsResult.html.length} bytes)`);
    console.log(`  First 200 chars: ${listingsResult.html.substring(0, 200)}`);
  }

  // Test 3: Product details API
  console.log('\n\n' + '='.repeat(65));
  console.log('  TEST 3: Product Details API');
  console.log('='.repeat(65));

  const productResult = await fetchProductDetails(TEST_PRODUCT_ID);

  if (productResult.error) {
    console.log(`\n  ❌ Error: ${productResult.error}`);
  } else if (productResult.json) {
    console.log('\n  ✅ Received JSON response');
    analyzeApiResponse(productResult.json);

    if (SAVE_HTML) {
      fs.writeFileSync('/tmp/tcgplayer-product.json', JSON.stringify(productResult.json, null, 2));
      console.log('\n  Saved to /tmp/tcgplayer-product.json');
    }
  }

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  ✅ TEST COMPLETE');
  console.log('═══════════════════════════════════════════════════════════════\n');
}

main();
