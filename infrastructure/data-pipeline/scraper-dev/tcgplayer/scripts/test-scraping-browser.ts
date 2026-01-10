#!/usr/bin/env npx tsx
/**
 * Test Bright Data Scraping Browser for TCGPlayer
 *
 * The Scraping Browser provides full browser automation that:
 * - Executes JavaScript
 * - Handles CAPTCHAs automatically
 * - Manages cookies and sessions
 *
 * Usage:
 *   BRIGHTDATA_TOKEN=xxx npx tsx scripts/test-scraping-browser.ts
 *
 * Requires: puppeteer-core
 */

import 'dotenv/config';
import * as fs from 'fs';

// Bright Data Scraping Browser auth
const BRIGHT_DATA_CUSTOMER = process.env.BRIGHT_DATA_CUSTOMER || 'hl_2d97e1e0';
const BRIGHTDATA_TOKEN = process.env.BRIGHTDATA_TOKEN;
const ZONE = 'scraping_browser';

// Build Scraping Browser URL
const BROWSER_WS_ENDPOINT = `wss://brd-customer-${BRIGHT_DATA_CUSTOMER}-zone-${ZONE}:${BRIGHTDATA_TOKEN}@brd.superproxy.io:9222`;

// Test URL - One Piece card with listings
const TEST_PRODUCT_URL = 'https://www.tcgplayer.com/product/471372/one-piece-card-game-romance-dawn-roronoa-zoro-op01-025-parallel?Language=English';
const TEST_PRODUCT_ID = '471372';

interface ListingData {
  sellerName: string;
  sellerRating: number | null;
  condition: string;
  printing: string;
  price: number;
  quantity: number;
  shipping: string | null;
}

interface ProductData {
  productId: string;
  name: string;
  setName: string;
  marketPrice: number | null;
  lowPrice: number | null;
  listings: ListingData[];
  scrapedAt: string;
}

async function scrapeWithPuppeteer(): Promise<ProductData | null> {
  let browser;

  try {
    // Dynamic import for puppeteer
    const puppeteer = await import('puppeteer-core');

    console.log('\n📡 Connecting to Bright Data Scraping Browser...');
    console.log(`   Endpoint: wss://brd-customer-${BRIGHT_DATA_CUSTOMER}-zone-${ZONE}:***@brd.superproxy.io:9222`);

    browser = await puppeteer.connect({
      browserWSEndpoint: BROWSER_WS_ENDPOINT,
    });

    console.log('   ✅ Connected!\n');

    const page = await browser.newPage();

    // Set viewport
    await page.setViewport({ width: 1920, height: 1080 });

    // Navigate to product page
    console.log(`📄 Navigating to: ${TEST_PRODUCT_URL.substring(0, 60)}...`);
    await page.goto(TEST_PRODUCT_URL, {
      waitUntil: 'networkidle2',
      timeout: 60000,
    });

    console.log('   Page loaded, waiting for listings...');

    // Wait for either listings to appear or a reasonable timeout
    try {
      await page.waitForSelector('.listing-item, [class*="seller-listing"], [data-testid="listing"]', {
        timeout: 15000,
      });
      console.log('   ✅ Listings selector found!');
    } catch {
      console.log('   ⚠️ Listings selector not found, will try alternative parsing');
    }

    // Get the rendered HTML
    const html = await page.content();
    console.log(`   Rendered HTML: ${(html.length / 1024).toFixed(1)}KB`);

    // Save HTML for debugging
    fs.writeFileSync('/tmp/tcgplayer-puppeteer.html', html);
    console.log('   Saved to /tmp/tcgplayer-puppeteer.html');

    // Take screenshot
    await page.screenshot({ path: '/tmp/tcgplayer-screenshot.png', fullPage: false });
    console.log('   Screenshot saved to /tmp/tcgplayer-screenshot.png');

    // Extract data using page.evaluate
    console.log('\n📊 Extracting data...');

    const data = await page.evaluate(() => {
      const result: {
        productName: string;
        setName: string;
        marketPrice: string | null;
        lowPrice: string | null;
        totalListings: number;
        listings: Array<{
          seller: string;
          rating: string;
          condition: string;
          price: string;
          quantity: string;
          shipping: string;
        }>;
        pageContent: string;
      } = {
        productName: '',
        setName: '',
        marketPrice: null,
        lowPrice: null,
        totalListings: 0,
        listings: [],
        pageContent: '',
      };

      // Product name - try multiple selectors
      const nameEl = document.querySelector('h1') ||
        document.querySelector('[data-testid="product-name"]') ||
        document.querySelector('[class*="product-details__name"]');
      result.productName = nameEl?.textContent?.trim() || '';

      // Get page text for price extraction
      result.pageContent = document.body?.innerText?.substring(0, 5000) || '';

      // Try to find price elements
      const priceElements = document.querySelectorAll('[class*="price"]');
      priceElements.forEach(el => {
        const text = el.textContent || '';
        if (text.includes('Market') && text.includes('$')) {
          result.marketPrice = text;
        }
        if (text.includes('From') && text.includes('$') || text.includes('Low')) {
          result.lowPrice = text;
        }
      });

      // Find listings - try multiple patterns
      const listingSelectors = [
        '.listing-item',
        '[class*="listing-item"]',
        '[class*="seller-listing"]',
        '[data-testid*="listing"]',
        'table[class*="listing"] tbody tr',
        '[class*="product-listing"] > div',
      ];

      for (const selector of listingSelectors) {
        const elements = document.querySelectorAll(selector);
        if (elements.length > 0) {
          result.totalListings = elements.length;
          elements.forEach((el, i) => {
            if (i < 10) { // First 10 listings
              result.listings.push({
                seller: el.querySelector('[class*="seller"]')?.textContent?.trim() || '',
                rating: el.querySelector('[class*="rating"]')?.textContent?.trim() || '',
                condition: el.querySelector('[class*="condition"]')?.textContent?.trim() || '',
                price: el.querySelector('[class*="price"]')?.textContent?.trim() || '',
                quantity: el.querySelector('[class*="quantity"]')?.textContent?.trim() || '',
                shipping: el.querySelector('[class*="shipping"]')?.textContent?.trim() || '',
              });
            }
          });
          break;
        }
      }

      return result;
    });

    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('  📊 EXTRACTED DATA');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`  Product: ${data.productName || '❌ Not found'}`);
    console.log(`  Market Price: ${data.marketPrice || '❌ Not found'}`);
    console.log(`  Low Price: ${data.lowPrice || '❌ Not found'}`);
    console.log(`  Total Listings: ${data.totalListings}`);

    if (data.listings.length > 0) {
      console.log('\n  📋 Sample Listings:');
      data.listings.slice(0, 5).forEach((listing, i) => {
        console.log(`     [${i + 1}] ${listing.seller || 'Unknown'} - ${listing.condition} - ${listing.price}`);
      });
    } else {
      console.log('\n  ⚠️ No listings found via selectors');
      console.log('  Page content sample:');
      console.log(`     "${data.pageContent.substring(0, 500).replace(/\s+/g, ' ')}..."`);
    }

    await browser.close();

    // Parse into structured data
    const product: ProductData = {
      productId: TEST_PRODUCT_ID,
      name: data.productName,
      setName: data.setName || 'Romance Dawn',
      marketPrice: null,
      lowPrice: null,
      listings: [],
      scrapedAt: new Date().toISOString(),
    };

    // Parse prices
    if (data.marketPrice) {
      const match = data.marketPrice.match(/\$?([\d,.]+)/);
      if (match) product.marketPrice = parseFloat(match[1].replace(',', ''));
    }
    if (data.lowPrice) {
      const match = data.lowPrice.match(/\$?([\d,.]+)/);
      if (match) product.lowPrice = parseFloat(match[1].replace(',', ''));
    }

    // Parse listings
    for (const listing of data.listings) {
      const priceMatch = listing.price.match(/\$?([\d,.]+)/);
      if (priceMatch) {
        product.listings.push({
          sellerName: listing.seller || 'Unknown',
          sellerRating: null,
          condition: listing.condition || 'Unknown',
          printing: 'Normal',
          price: parseFloat(priceMatch[1].replace(',', '')),
          quantity: parseInt(listing.quantity) || 1,
          shipping: listing.shipping || null,
        });
      }
    }

    return product;

  } catch (error) {
    console.error('\n❌ Error:', error);
    if (browser) {
      await browser.close();
    }
    return null;
  }
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  🔍 Bright Data Scraping Browser Test');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Customer ID: ${BRIGHT_DATA_CUSTOMER}`);
  console.log(`  Token: ${BRIGHTDATA_TOKEN ? '✅ Configured' : '❌ Missing'}`);
  console.log(`  Zone: ${ZONE}`);

  if (!BRIGHTDATA_TOKEN) {
    console.error('\n❌ BRIGHTDATA_TOKEN not set');
    process.exit(1);
  }

  // Check if puppeteer-core is installed
  try {
    await import('puppeteer-core');
    console.log(`  Puppeteer: ✅ Installed`);
  } catch {
    console.error('\n❌ puppeteer-core not installed. Run: npm install puppeteer-core');
    process.exit(1);
  }

  const result = await scrapeWithPuppeteer();

  if (result) {
    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('  ✅ SCRAPE SUCCESSFUL');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`  Product: ${result.name}`);
    console.log(`  Market Price: $${result.marketPrice || 'N/A'}`);
    console.log(`  Listings: ${result.listings.length}`);

    // Save result
    fs.writeFileSync('/tmp/tcgplayer-result.json', JSON.stringify(result, null, 2));
    console.log('\n  Result saved to /tmp/tcgplayer-result.json');
  } else {
    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('  ❌ SCRAPE FAILED');
    console.log('═══════════════════════════════════════════════════════════════');
  }

  console.log('\n');
}

main();
