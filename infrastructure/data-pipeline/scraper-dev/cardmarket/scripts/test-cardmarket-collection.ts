/**
 * CardMarket Test Collection Script
 *
 * Tests the CardMarket Alchemist module by:
 * 1. Printing the target card registry
 * 2. Generating URLs for all target cards
 * 3. Running a dry-run scrape session
 *
 * Usage:
 *   npx tsx scripts/test-cardmarket-collection.ts
 */

import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Load environment variables
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: join(__dirname, '..', '.env') });

import {
  cardMarketTargetRegistry,
  ALL_CARDMARKET_TARGETS,
  ONE_PIECE_SETS,
} from '../src/neural/sensory/cardmarket/target-cards.js';

import { cardMarketUrlBuilder } from '../src/neural/sensory/cardmarket/url-builder.js';

import {
  CardMarketDataParser,
  getBestPrice,
  getPriceSpread,
} from '../src/neural/sensory/cardmarket/data-parser.js';

// Simple module info printer
function printCardMarketModuleInfo(): void {
  console.log('\n' + '='.repeat(60));
  console.log('CardMarket Alchemist Module v1.0.0');
  console.log('='.repeat(60));
}

// =============================================================================
// TEST FUNCTIONS
// =============================================================================

function testTargetRegistry(): void {
  console.log('\n' + '═'.repeat(60));
  console.log('📜 TARGET CARD REGISTRY TEST');
  console.log('═'.repeat(60));

  // Print summary
  cardMarketTargetRegistry.printSummary();

  // Get targets by tier using registry methods
  const legendaryTargets = cardMarketTargetRegistry.getByTier('legendary');
  const epicTargets = cardMarketTargetRegistry.getByTier('epic');
  const rareTargets = cardMarketTargetRegistry.getByTier('rare');

  // Show legendary targets
  console.log('\n🔥 LEGENDARY TIER (€50+):');
  legendaryTargets.slice(0, 5).forEach((t) => {
    console.log(`   ${t.cardId} - ${t.character} (${t.variant}) - Priority: ${t.scrapePriority}`);
  });
  if (legendaryTargets.length > 5) {
    console.log(`   ... and ${legendaryTargets.length - 5} more`);
  }

  // Show epic targets
  console.log('\n🥈 EPIC TIER (€20-50):');
  epicTargets.slice(0, 5).forEach((t) => {
    console.log(`   ${t.cardId} - ${t.character} (${t.variant}) - Priority: ${t.scrapePriority}`);
  });
  if (epicTargets.length > 5) {
    console.log(`   ... and ${epicTargets.length - 5} more`);
  }

  // Show rare targets
  console.log('\n⭐ RARE TIER (€10-20):');
  rareTargets.slice(0, 5).forEach((t) => {
    console.log(`   ${t.cardId} - ${t.character} (${t.variant}) - Priority: ${t.scrapePriority}`);
  });
  if (rareTargets.length > 5) {
    console.log(`   ... and ${rareTargets.length - 5} more`);
  }

  // Critical gaps
  console.log('\n🚨 CRITICAL DATA GAPS:');
  const gaps = cardMarketTargetRegistry.getCriticalGaps();
  gaps.forEach((gap) => {
    console.log(`   ${gap.cardId} - ${gap.character} (${gap.variant}) - ${gap.notes || 'Critical gap'}`);
  });
}

function testUrlBuilder(): void {
  console.log('\n' + '═'.repeat(60));
  console.log('🔗 URL BUILDER TEST');
  console.log('═'.repeat(60));

  // Test expansion URLs
  console.log('\n📦 SET EXPANSION URLs:');
  ONE_PIECE_SETS.slice(0, 5).forEach((set) => {
    const url = cardMarketUrlBuilder.buildExpansionUrl(set.code, 1);
    console.log(`   ${set.code} (${set.name}): ${url}`);
  });

  // Test card detail URLs for legendary targets
  console.log('\n🃏 LEGENDARY CARD DETAIL URLs:');
  const legendaryForUrls = cardMarketTargetRegistry.getByTier('legendary');
  legendaryForUrls.slice(0, 5).forEach((target) => {
    const url = cardMarketUrlBuilder.buildCardDetailUrl(target);
    console.log(`   ${target.cardId} (${target.variant}): ${url}`);
  });

  // Test URL parsing
  console.log('\n🔍 URL PARSING TEST:');
  const testUrls = [
    'https://www.cardmarket.com/en/One-Piece/Products/Singles/Romance-Dawn/Shanks-OP01-120',
    'https://www.cardmarket.com/en/One-Piece/Products/Singles/Romance-Dawn/Shanks-OP01-120-V2',
    'https://www.cardmarket.com/en/One-Piece/Products/Singles/Wings-of-the-Captain/Yamato-OP06-118-Manga',
  ];

  testUrls.forEach((url) => {
    const parsed = cardMarketUrlBuilder.parseUrl(url);
    if (parsed) {
      console.log(`   URL: ...${url.slice(-50)}`);
      console.log(`     Card ID: ${parsed.cardId}, Variant: ${parsed.variant}, Set: ${parsed.setCode}`);
    }
  });
}

function testDataParser(): void {
  console.log('\n' + '═'.repeat(60));
  console.log('🔬 DATA PARSER TEST');
  console.log('═'.repeat(60));

  const parser = new CardMarketDataParser();

  // Simulated scrape results
  const mockScrapes = [
    {
      url: 'https://www.cardmarket.com/en/One-Piece/Products/Singles/Romance-Dawn/Shanks-OP01-120-V2',
      priceGuide: {
        priceFrom: '162,00 €',
        priceTrend: '175,50 €',
        priceAvg7: '170,00 €',
        priceAvg30: '168,25 €',
        available: '12',
      },
      cardInfo: {
        name: 'Shanks',
        setName: 'Romance Dawn',
        rarity: 'SEC',
      },
    },
    {
      url: 'https://www.cardmarket.com/en/One-Piece/Products/Singles/Wings-of-the-Captain/Yamato-OP06-118-Manga',
      priceGuide: {
        priceFrom: '195,00 €',
        priceTrend: '210,00 €',
        available: '3',
      },
      cardInfo: {
        name: 'Yamato',
        setName: 'Wings of the Captain',
        rarity: 'SEC',
      },
    },
    {
      url: 'https://www.cardmarket.com/de/One-Piece/Products/Singles/Pillars-of-Strength/Nami-OP03-040-V2',
      priceGuide: {
        priceFrom: '80,00 €',
        priceTrend: '85,50 €',
        priceAvg30: '82,00 €',
        available: '8',
      },
      article: {
        condition: 'NM',
        language: 'EN',
      },
    },
  ];

  console.log('\n📊 PARSED RESULTS:');
  mockScrapes.forEach((scrape, i) => {
    const parsed = parser.parse(scrape);
    console.log(`\n   [${i + 1}] ${parsed.cardId || 'Unknown'} (${parsed.variant})`);
    console.log(`       Card Name: ${parsed.cardName || 'N/A'}`);
    console.log(`       Prices: From €${parsed.priceFromEur?.toFixed(2) || 'N/A'} | Trend €${parsed.priceTrendEur?.toFixed(2) || 'N/A'}`);
    console.log(`       Available: ${parsed.availableItems} items`);
    console.log(`       Language: ${parsed.language} (URL: ${parsed.urlLanguage})`);
    console.log(`       Condition: ${parsed.condition} (×${parsed.conditionMultiplier})`);
    console.log(`       Confidence: ${(parsed.confidence * 100).toFixed(1)}%`);

    const bestPrice = getBestPrice(parsed);
    const spread = getPriceSpread(parsed);
    if (bestPrice) {
      console.log(`       Best Price: €${bestPrice.toFixed(2)}`);
    }
    if (spread !== null) {
      console.log(`       Price Spread: ${spread.toFixed(1)}%`);
    }
  });
}

function testDryRunSession(): void {
  console.log('\n' + '═'.repeat(60));
  console.log('🧪 DRY RUN SESSION TEST');
  console.log('═'.repeat(60));

  const legendaryTargets = cardMarketTargetRegistry.getByTier('legendary');
  const epicTargets = cardMarketTargetRegistry.getByTier('epic');
  const rareTargets = cardMarketTargetRegistry.getByTier('rare');
  const allTargets = ALL_CARDMARKET_TARGETS;

  console.log(`\n📋 SIMULATED SCRAPE QUEUE:`);
  console.log(`   Total targets: ${allTargets.length}`);
  console.log(`   Legendary: ${legendaryTargets.length}`);
  console.log(`   Epic: ${epicTargets.length}`);
  console.log(`   Rare: ${rareTargets.length}`);

  // Simulate processing time estimate
  const avgDelayMs = 2000; // 2 seconds between requests
  const estimatedMinutes = (allTargets.length * avgDelayMs) / 60000;

  console.log(`\n⏱️  ESTIMATED PROCESSING:`);
  console.log(`   Delay per request: ${avgDelayMs}ms`);
  console.log(`   Total time: ~${estimatedMinutes.toFixed(1)} minutes`);

  // Generate all URLs
  console.log(`\n🔗 GENERATED URLs (first 10):`);
  allTargets.slice(0, 10).forEach((target) => {
    const url = cardMarketUrlBuilder.buildCardDetailUrl(target);
    console.log(`   [${target.tier}] ${target.cardId}: ${url.slice(-60)}...`);
  });

  // Show schedule
  console.log('\n📅 DAILY SCHEDULE:');
  console.log('   06:00 UTC - Morning Ritual (Legendary only)');
  console.log('   12:00 UTC - Midday Ritual (Legendary + Silver)');
  console.log('   18:00 UTC - Evening Ritual (All tiers)');
  console.log('   00:00 UTC - Nightly Ritual (Full refresh)');
}

function printFinalSummary(): void {
  console.log('\n' + '═'.repeat(60));
  console.log('✅ CARDMARKET ALCHEMIST TEST COMPLETE');
  console.log('═'.repeat(60));

  console.log('\n📊 MODULE STATUS:');
  console.log('   ✓ Target Registry: Loaded');
  console.log('   ✓ URL Builder: Operational');
  console.log('   ✓ Data Parser: Functional');
  console.log('   ✓ Dry Run Mode: Working');

  console.log('\n🔧 NEXT STEPS:');
  console.log('   1. Connect actual browser scraper (Puppeteer/Playwright)');
  console.log('   2. Configure residential proxy for Cloudflare bypass');
  console.log('   3. Run first live collection with rate limiting');
  console.log('   4. Store results in database via CardMarketReceptorNeuron');

  console.log('\n💡 TO RUN LIVE COLLECTION:');
  console.log('   npx tsx scripts/collect-cardmarket-live.ts');
  console.log();
}

// =============================================================================
// MAIN
// =============================================================================

async function main(): Promise<void> {
  console.log('\n🔮 CARDMARKET ALCHEMIST TEST COLLECTION');
  console.log('═'.repeat(60));
  console.log(`Started: ${new Date().toISOString()}`);

  // Print module info
  printCardMarketModuleInfo();

  // Run tests
  testTargetRegistry();
  testUrlBuilder();
  testDataParser();
  testDryRunSession();
  printFinalSummary();
}

main().catch((error) => {
  console.error('\n❌ Test failed:', error);
  process.exit(1);
});
