#!/usr/bin/env npx tsx
/**
 * Test Bright Data Scraper - Examine TCGPlayer HTML Structure
 *
 * Usage:
 *   BRIGHTDATA_TOKEN=xxx npx tsx scripts/test-brightdata-scraper.ts
 *   BRIGHTDATA_TOKEN=xxx npx tsx scripts/test-brightdata-scraper.ts --save-html
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as cheerio from 'cheerio';

const BRIGHTDATA_TOKEN = process.env.BRIGHTDATA_TOKEN;
const BRIGHT_DATA_CUSTOMER = process.env.BRIGHT_DATA_CUSTOMER || 'hl_2d97e1e0';
const SAVE_HTML = process.argv.includes('--save-html');

// Test URLs - a popular One Piece card with listings
const TEST_URLS = [
  // Product page with listings
  'https://www.tcgplayer.com/product/471372/one-piece-card-game-romance-dawn-roronoa-zoro-op01-025-parallel?xid=pidb6a882d-1fa5-4d65-9b68-b876ae9e5c06&page=1&Language=English',
  // Search results page
  'https://www.tcgplayer.com/search/one-piece-card-game/romance-dawn?productLineName=one-piece-card-game&setName=romance-dawn&view=grid&page=1',
];

async function fetchWithBrightData(url: string): Promise<string> {
  console.log(`\n📡 Fetching: ${url.substring(0, 80)}...`);

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
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Bright Data error ${response.status}: ${errorText}`);
  }

  return response.text();
}

function analyzeProductPage(html: string): void {
  const $ = cheerio.load(html);

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  📊 PRODUCT PAGE ANALYSIS');
  console.log('═══════════════════════════════════════════════════════════════');

  // Product name
  const productName = $('h1').first().text().trim() ||
    $('[data-testid="product-name"]').text().trim() ||
    $('[class*="product-details__name"]').text().trim();
  console.log(`\n  Product Name: ${productName || '❌ NOT FOUND'}`);

  // Price guide section
  console.log('\n  📈 Price Guide Section:');
  const priceSelectors = [
    '.price-guide',
    '[data-testid="price-guide"]',
    '.product-details__market-price',
    '[class*="price-point"]',
    '[class*="market-price"]',
    '.marketplace-stats',
  ];

  for (const sel of priceSelectors) {
    const found = $(sel).length;
    if (found > 0) {
      console.log(`     ✅ ${sel}: ${found} element(s)`);
      if (SAVE_HTML) {
        console.log(`        Text: ${$(sel).first().text().substring(0, 100)}...`);
      }
    }
  }

  // Listings section
  console.log('\n  📋 Listings Section:');
  const listingSelectors = [
    '.listing-item',
    '.seller-listing',
    '[data-testid="listing-row"]',
    '[class*="listing"]',
    '.product-listing',
    '[class*="seller"]',
    '.add-to-cart',
    '[data-testid="add-to-cart"]',
    '.inventory-listing',
    '[class*="inventory"]',
  ];

  for (const sel of listingSelectors) {
    const found = $(sel).length;
    if (found > 0) {
      console.log(`     ✅ ${sel}: ${found} element(s)`);
    }
  }

  // Look for any element containing seller info
  console.log('\n  👤 Seller Elements:');
  const sellerPatterns = ['seller', 'vendor', 'shop', 'store', 'merchant'];
  for (const pattern of sellerPatterns) {
    const elements = $(`[class*="${pattern}"], [id*="${pattern}"], [data-testid*="${pattern}"]`);
    if (elements.length > 0) {
      console.log(`     ✅ *${pattern}*: ${elements.length} element(s)`);
      elements.slice(0, 3).each((i, el) => {
        const classes = $(el).attr('class') || '';
        const text = $(el).text().substring(0, 50).replace(/\s+/g, ' ').trim();
        console.log(`        [${i}] class="${classes.substring(0, 50)}" text="${text}..."`);
      });
    }
  }

  // Look for price elements
  console.log('\n  💰 Price Elements:');
  const pricePatterns = ['price', 'cost', 'amount', '$'];
  $('[class*="price"], [data-testid*="price"]').slice(0, 10).each((i, el) => {
    const classes = $(el).attr('class') || '';
    const text = $(el).text().substring(0, 30).replace(/\s+/g, ' ').trim();
    if (text.includes('$') || text.match(/\d+\.\d{2}/)) {
      console.log(`     [${i}] class="${classes.substring(0, 40)}" → "${text}"`);
    }
  });

  // Look for condition elements
  console.log('\n  🏷️ Condition Elements:');
  const conditionKeywords = ['near mint', 'lightly played', 'moderately', 'heavily', 'damaged', 'nm', 'lp', 'mp', 'hp'];
  const pageText = $('body').text().toLowerCase();
  for (const kw of conditionKeywords) {
    if (pageText.includes(kw)) {
      console.log(`     ✅ Found "${kw}" in page`);
    }
  }

  // Check for React/Next.js data
  console.log('\n  ⚛️ React/JSON Data:');
  const scriptTags = $('script[type="application/json"], script[id*="__NEXT"], script[id*="__NUXT"]');
  console.log(`     Script tags with JSON data: ${scriptTags.length}`);

  $('script').each((i, el) => {
    const content = $(el).html() || '';
    if (content.includes('listingPrice') || content.includes('sellerName') || content.includes('"listings"')) {
      console.log(`     ✅ Found listing data in script tag ${i}`);
      if (SAVE_HTML) {
        // Extract a sample
        const match = content.match(/"listings":\s*\[[\s\S]{0,500}/);
        if (match) console.log(`        Sample: ${match[0].substring(0, 200)}...`);
      }
    }
  });

  // Check for API endpoints in scripts
  $('script').each((i, el) => {
    const content = $(el).html() || '';
    if (content.includes('/api/') || content.includes('endpoint')) {
      const apiMatch = content.match(/["']\/api\/[^"']+["']/g);
      if (apiMatch) {
        console.log(`     API endpoints found: ${apiMatch.slice(0, 3).join(', ')}`);
      }
    }
  });
}

function analyzeSearchPage(html: string): void {
  const $ = cheerio.load(html);

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  📊 SEARCH PAGE ANALYSIS');
  console.log('═══════════════════════════════════════════════════════════════');

  // Product cards
  console.log('\n  🃏 Product Cards:');
  const cardSelectors = [
    '.search-result',
    '.product-card',
    '[data-testid="product-card"]',
    '[class*="product-card"]',
    '[class*="search-result"]',
    '.product-card__content',
  ];

  for (const sel of cardSelectors) {
    const found = $(sel).length;
    if (found > 0) {
      console.log(`     ✅ ${sel}: ${found} element(s)`);
    }
  }

  // Extract product URLs
  console.log('\n  🔗 Product Links:');
  const productLinks = $('a[href*="/product/"]');
  console.log(`     Found ${productLinks.length} product links`);

  productLinks.slice(0, 5).each((i, el) => {
    const href = $(el).attr('href');
    console.log(`     [${i}] ${href?.substring(0, 70)}...`);
  });
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  🔍 Bright Data TCGPlayer Scraper Test');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Bright Data Token: ${BRIGHTDATA_TOKEN ? '✅ Configured' : '❌ Missing'}`);
  console.log(`  Save HTML: ${SAVE_HTML ? '✅ Yes' : '❌ No'}`);

  if (!BRIGHTDATA_TOKEN) {
    console.error('\n❌ BRIGHTDATA_TOKEN not set');
    process.exit(1);
  }

  try {
    // Test product page
    console.log('\n\n🔄 Testing Product Page...');
    const productHtml = await fetchWithBrightData(TEST_URLS[0]);
    console.log(`   Received ${(productHtml.length / 1024).toFixed(1)}KB of HTML`);

    if (SAVE_HTML) {
      fs.writeFileSync('/tmp/tcgplayer-product.html', productHtml);
      console.log('   Saved to /tmp/tcgplayer-product.html');
    }

    analyzeProductPage(productHtml);

    // Test search page
    console.log('\n\n🔄 Testing Search Page...');
    const searchHtml = await fetchWithBrightData(TEST_URLS[1]);
    console.log(`   Received ${(searchHtml.length / 1024).toFixed(1)}KB of HTML`);

    if (SAVE_HTML) {
      fs.writeFileSync('/tmp/tcgplayer-search.html', searchHtml);
      console.log('   Saved to /tmp/tcgplayer-search.html');
    }

    analyzeSearchPage(searchHtml);

    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('  ✅ TEST COMPLETE');
    console.log('═══════════════════════════════════════════════════════════════\n');

  } catch (error) {
    console.error('\n❌ Error:', error);
    process.exit(1);
  }
}

main();
