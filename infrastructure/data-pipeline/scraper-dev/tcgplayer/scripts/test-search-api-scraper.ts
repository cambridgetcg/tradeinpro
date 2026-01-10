#!/usr/bin/env npx tsx
/**
 * Test TCGPlayer Search API Scraper
 *
 * This tests the new search API scraper which uses TCGPlayer's
 * public search API to get product data and individual listings.
 *
 * Usage:
 *   npx tsx scripts/test-search-api-scraper.ts
 *   npx tsx scripts/test-search-api-scraper.ts --set=OP01
 *   npx tsx scripts/test-search-api-scraper.ts --product=471372
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * DOCUMENTATION REFERENCES (Symbiotic Code ↔ Docs)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * @see {@link file://../docs/SCRAPER_ARCHITECTURE_INSIGHTS.md} - Architecture patterns
 *   - Section 1: TCGPlayer API-First Approach
 *   - Section 6: Performance Characteristics
 *   - Section 9: Quick Reference
 *
 * @see {@link file://../docs/TCGPLAYER_STACK_ANALYSIS.md} - Platform analysis
 *   - API endpoint discovery
 *   - Request/response format
 *
 * @see {@link file://../docs/README.md} - TCGPlayer documentation index
 *
 * Related Code Files:
 * @see {@link file://../src/scrapers/tcgplayer-search-api-scraper.ts} - Scraper implementation
 * @see {@link file://./daily-archive-local.ts} - Production usage
 * @see {@link file://./test-tcgplayer-api-v2.ts} - API discovery script
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * @script test-search-api-scraper
 * @since 2026-01-10
 */

import 'dotenv/config';
import * as fs from 'fs';
import { TCGPlayerSearchAPIScraper, createTCGPlayerSearchScraper } from '../src/scrapers/tcgplayer-search-api-scraper.js';

const ARGS = process.argv.slice(2);
const SET_CODE = ARGS.find(a => a.startsWith('--set='))?.split('=')[1] || 'OP01';
const PRODUCT_ID = ARGS.find(a => a.startsWith('--product='))?.split('=')[1];
const MAX_PRODUCTS = 10;

async function testSetScrape() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  📊 TCGPlayer Search API Scraper - Set Test');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Game: One Piece Card Game`);
  console.log(`  Set: ${SET_CODE}`);
  console.log(`  Max Products: ${MAX_PRODUCTS}`);

  const scraper = createTCGPlayerSearchScraper('onepiece', {
    includeListings: true,
    maxListingsPerProduct: 30,
    requestDelayMs: 1000,
  });

  try {
    console.log('\n');
    const products = await scraper.scrapeSet(SET_CODE, { maxProducts: MAX_PRODUCTS });

    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('  📋 RESULTS');
    console.log('═══════════════════════════════════════════════════════════════');

    if (products.length === 0) {
      console.log('\n  ❌ No products found');
      return;
    }

    console.log(`\n  Found ${products.length} products:\n`);

    for (const product of products.slice(0, 5)) {
      console.log(`  🃏 ${product.productName}`);
      console.log(`     ID: ${product.productId} | Card#: ${product.cardNumber || 'N/A'}`);
      console.log(`     Market: $${product.marketPrice?.toFixed(2) || 'N/A'} | Low: $${product.lowestPrice?.toFixed(2) || 'N/A'}`);
      console.log(`     Total Listings: ${product.totalListings}`);

      if (product.listings.length > 0) {
        console.log(`     📋 Sample Listings (${product.listings.length} total):`);
        product.listings.slice(0, 3).forEach((listing, i) => {
          console.log(`        [${i + 1}] ${listing.sellerName} (${listing.sellerRating}%)`);
          console.log(`            ${listing.condition} ${listing.printing} - $${listing.price.toFixed(2)} + $${listing.shippingPrice.toFixed(2)} ship`);
          console.log(`            Qty: ${listing.quantity}`);
        });
      }
      console.log('');
    }

    // Save results
    const filename = `/tmp/tcgplayer-${SET_CODE}-products.json`;
    fs.writeFileSync(filename, JSON.stringify(products, null, 2));
    console.log(`  💾 Saved to ${filename}`);

    // Metrics
    const metrics = scraper.getMetrics();
    console.log('\n  📊 Metrics:');
    console.log(`     API Calls: ${metrics.apiCalls}`);
    console.log(`     Products: ${metrics.productsScraped}`);
    console.log(`     Listings: ${metrics.listingsScraped}`);
    console.log(`     Duration: ${((metrics.durationMs || 0) / 1000).toFixed(1)}s`);
    console.log(`     Errors: ${metrics.errors}`);

    const errors = scraper.getErrors();
    if (errors.length > 0) {
      console.log('\n  ❌ Errors:');
      errors.forEach(e => console.log(`     - ${e}`));
    }

  } catch (error) {
    console.error('\n  ❌ Error:', error);
  }

  console.log('\n═══════════════════════════════════════════════════════════════\n');
}

async function testProductScrape(productId: number) {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  📊 TCGPlayer Search API Scraper - Product Test');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Product ID: ${productId}`);

  const scraper = createTCGPlayerSearchScraper('onepiece', {
    includeListings: true,
    maxListingsPerProduct: 50,
  });

  try {
    const product = await scraper.scrapeProduct(productId);

    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('  📋 PRODUCT DETAILS');
    console.log('═══════════════════════════════════════════════════════════════');

    if (!product) {
      console.log('\n  ❌ Product not found');
      return;
    }

    console.log(`\n  🃏 ${product.productName}`);
    console.log(`     ID: ${product.productId}`);
    console.log(`     Set: ${product.setName}`);
    console.log(`     Card#: ${product.cardNumber || 'N/A'}`);
    console.log(`     Rarity: ${product.rarity || 'N/A'}`);
    console.log(`     Foil Only: ${product.foilOnly}`);
    console.log(`\n  💰 Prices:`);
    console.log(`     Market: $${product.marketPrice?.toFixed(2) || 'N/A'}`);
    console.log(`     Median: $${product.medianPrice?.toFixed(2) || 'N/A'}`);
    console.log(`     Lowest: $${product.lowestPrice?.toFixed(2) || 'N/A'}`);
    console.log(`     Lowest w/Ship: $${product.lowestPriceWithShipping?.toFixed(2) || 'N/A'}`);
    console.log(`\n  📋 Listings (${product.listings.length} of ${product.totalListings} total):`);

    if (product.listings.length > 0) {
      // Group by condition
      const byCondition: Record<string, typeof product.listings> = {};
      for (const listing of product.listings) {
        const key = `${listing.condition} ${listing.printing}`;
        if (!byCondition[key]) byCondition[key] = [];
        byCondition[key].push(listing);
      }

      for (const [condition, listings] of Object.entries(byCondition)) {
        console.log(`\n     📦 ${condition} (${listings.length} listings):`);
        const prices = listings.map(l => l.price).sort((a, b) => a - b);
        console.log(`        Price range: $${prices[0].toFixed(2)} - $${prices[prices.length - 1].toFixed(2)}`);

        listings.slice(0, 3).forEach((listing, i) => {
          const programs = [];
          if (listing.goldSeller) programs.push('Gold');
          if (listing.verifiedSeller) programs.push('Verified');
          if (listing.directSeller) programs.push('Direct');

          console.log(`        [${i + 1}] ${listing.sellerName} (${listing.sellerRating}%) ${programs.join(', ')}`);
          console.log(`            $${listing.price.toFixed(2)} + $${listing.shippingPrice.toFixed(2)} | Qty: ${listing.quantity}`);
        });
      }
    }

    // Save results
    const filename = `/tmp/tcgplayer-product-${productId}.json`;
    fs.writeFileSync(filename, JSON.stringify(product, null, 2));
    console.log(`\n  💾 Saved to ${filename}`);

  } catch (error) {
    console.error('\n  ❌ Error:', error);
  }

  console.log('\n═══════════════════════════════════════════════════════════════\n');
}

async function main() {
  if (PRODUCT_ID) {
    await testProductScrape(parseInt(PRODUCT_ID, 10));
  } else {
    await testSetScrape();
  }
}

main();
