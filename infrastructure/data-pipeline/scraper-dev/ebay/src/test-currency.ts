/**
 * Test currency capture in listings
 */

import { Collector } from './pipeline/collector.js';
import type { PipelineConfig } from './pipeline/config.js';

const CONFIG: PipelineConfig = {
  serpApiKey: '***REMOVED-ROTATE-ME***',
  searchesPerRun: 10,
  resultsPerPage: 10,
  s3Bucket: 'test',
  s3Region: 'us-east-1',
  s3Prefix: 'test',
  imageResolutions: [500],
  downloadConcurrency: 1,
  downloadRetries: 1,
  downloadDelayMs: 100,
  serpApiDelayMs: 1000,
  ebayImageDelayMs: 50,
  localCachePath: './cache/test',
};

async function main() {
  console.log('Testing currency capture...\n');

  const collector = new Collector(CONFIG);

  try {
    const result = await collector.fetchListings(
      'one piece tcg OP01-120 Shanks',
      'test_currency',
      1
    );

    console.log(`Found ${result.totalResults} total, ${result.listings.length} returned\n`);

    console.log('Sample listings with price data:\n');

    for (const listing of result.listings.slice(0, 5)) {
      console.log(`Title: ${listing.title.substring(0, 60)}...`);
      console.log(`  Card ID: ${listing.cardId || 'N/A'}`);
      console.log(`  Price: ${listing.price}`);
      console.log(`  Currency: ${listing.priceCurrency}`);
      console.log(`  Price Raw: ${listing.priceRaw}`);
      console.log(`  Shipping: ${listing.shipping}`);
      console.log(`  Shipping Currency: ${listing.shippingCurrency}`);
      console.log(`  Sold Date: ${listing.soldDate}`);
      console.log('');
    }

    // Summary
    const currencies = result.listings
      .map(l => l.priceCurrency)
      .filter(Boolean);

    const currencyCounts: Record<string, number> = {};
    for (const c of currencies) {
      currencyCounts[c!] = (currencyCounts[c!] || 0) + 1;
    }

    console.log('\n=== Currency Summary ===');
    console.log(`Total listings: ${result.listings.length}`);
    console.log(`With currency: ${currencies.length}`);
    console.log('Currency breakdown:', currencyCounts);

  } catch (e) {
    console.log(`Error: ${e}`);
  }
}

main();
