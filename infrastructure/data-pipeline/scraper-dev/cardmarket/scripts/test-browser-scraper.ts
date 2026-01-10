/**
 * Test the browser-based CardMarket scraper
 *
 * Usage:
 *   npx tsx scripts/test-browser-scraper.ts [--dry-run] [--max-cards=5]
 */

import { createBrowserScraper } from '../src/scrapers/cardmarket-browser-scraper.js';

async function testBrowserScraper() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const maxCardsArg = args.find((a) => a.startsWith('--max-cards='));
  const maxCards = maxCardsArg ? parseInt(maxCardsArg.split('=')[1], 10) : 5;

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  🌐 CardMarket Browser Scraper Test');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Mode: ${dryRun ? 'DRY RUN (connection test only)' : 'LIVE SCRAPE'}`);
  console.log(`  Max cards: ${maxCards}`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  const scraper = createBrowserScraper({
    headless: true,
    requestDelayMs: 2000,
  });

  try {
    // Test connection
    console.log('📡 Testing connection to CardMarket...');
    const conn = await scraper.testConnection();

    console.log(`   ${conn.success ? '✅' : '❌'} ${conn.message}`);
    console.log(`   Latency: ${conn.latency}ms\n`);

    if (!conn.success) {
      console.log('❌ Connection test failed. Cannot proceed.');
      await scraper.close();
      process.exit(1);
    }

    if (dryRun) {
      console.log('✅ Dry run complete. Connection verified!\n');
      console.log('To run a live scrape, remove --dry-run flag.');
      await scraper.close();
      process.exit(0);
    }

    // Scrape Romance Dawn with limited cards
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('  📦 Scraping Romance Dawn (OP01)');
    console.log('═══════════════════════════════════════════════════════════════\n');

    const result = await scraper.scrapeSet('OP01', {
      maxCardsPerSet: maxCards,
      maxPagesPerSet: 1,
      delayBetweenRequests: 2000,
      onProgress: (progress) => {
        // Progress logged in scraper
      },
    });

    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('  📊 RESULTS');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`  Cards scraped: ${result.stats.cardsScraped}`);
    console.log(`  Pages processed: ${result.stats.pagesProcessed}`);
    console.log(`  Duration: ${(result.stats.duration / 1000).toFixed(1)}s`);
    console.log(`  Errors: ${result.errors.length}`);
    console.log('═══════════════════════════════════════════════════════════════\n');

    if (result.cards.length > 0) {
      console.log('📋 Sample Cards:');
      for (const card of result.cards.slice(0, 5)) {
        console.log(`   • ${card.name}`);
        console.log(`     ID: ${card.cardId}`);
        console.log(`     Trend: €${card.trendPrice ?? 'N/A'}`);
        console.log(`     Low: €${card.lowPrice ?? 'N/A'}`);
        console.log('');
      }
    }

    if (result.errors.length > 0) {
      console.log('⚠️ Errors:');
      for (const err of result.errors) {
        console.log(`   - ${err}`);
      }
    }

    console.log('\n✅ Browser scraper test complete!');
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await scraper.close();
  }
}

testBrowserScraper();
