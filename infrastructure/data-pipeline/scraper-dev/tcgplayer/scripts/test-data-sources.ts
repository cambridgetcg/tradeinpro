#!/usr/bin/env npx tsx
/**
 * Test Script for TCGPlayer Data Sources
 *
 * Verifies JustTCG API and Bright Data scraper are working correctly
 * and producing quality data for the daily archive pipeline.
 *
 * Usage:
 *   JUSTTCG_API_KEY=xxx npx tsx scripts/test-data-sources.ts
 *   JUSTTCG_API_KEY=xxx BRIGHTDATA_TOKEN=xxx npx tsx scripts/test-data-sources.ts --test-scraper
 */

import 'dotenv/config';

// =============================================================================
// Configuration
// =============================================================================

const JUSTTCG_API_KEY = process.env.JUSTTCG_API_KEY;
const BRIGHTDATA_TOKEN = process.env.BRIGHTDATA_TOKEN;
const JUSTTCG_BASE_URL = 'https://api.justtcg.com/v1';

const args = process.argv.slice(2);
const TEST_SCRAPER = args.includes('--test-scraper');
const VERBOSE = args.includes('--verbose') || args.includes('-v');

// =============================================================================
// Types
// =============================================================================

interface TestResult {
  name: string;
  status: 'pass' | 'fail' | 'skip';
  duration: number;
  details?: string;
  data?: unknown;
}

interface DataQualityReport {
  source: string;
  totalCards: number;
  cardsWithPrices: number;
  cardsWithHistory: number;
  cardsWithStatistics: number;
  priceRange: { min: number; max: number };
  avgPrice: number;
  conditions: string[];
  issues: string[];
}

// =============================================================================
// Helper Functions
// =============================================================================

function log(message: string, level: 'info' | 'warn' | 'error' | 'success' = 'info'): void {
  const icons = { info: '📋', warn: '⚠️', error: '❌', success: '✅' };
  console.log(`${icons[level]} ${message}`);
}

async function makeRequest(url: string, headers: Record<string, string> = {}): Promise<Response> {
  const response = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      ...headers,
    },
  });
  return response;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

// =============================================================================
// JustTCG API Tests
// =============================================================================

async function testJustTCGConnection(): Promise<TestResult> {
  const start = Date.now();
  const testName = 'JustTCG API Connection';

  if (!JUSTTCG_API_KEY) {
    return { name: testName, status: 'skip', duration: 0, details: 'No API key configured' };
  }

  try {
    const response = await makeRequest(
      `${JUSTTCG_BASE_URL}/sets?game=one-piece-card-game&limit=1`,
      { 'x-api-key': JUSTTCG_API_KEY }
    );

    if (!response.ok) {
      return {
        name: testName,
        status: 'fail',
        duration: Date.now() - start,
        details: `HTTP ${response.status}: ${response.statusText}`,
      };
    }

    const data = await response.json();
    return {
      name: testName,
      status: 'pass',
      duration: Date.now() - start,
      details: `Connected successfully, ${data.meta?.total || 'N/A'} sets available`,
      data: data._metadata,
    };
  } catch (error) {
    return {
      name: testName,
      status: 'fail',
      duration: Date.now() - start,
      details: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

async function testJustTCGGameCoverage(): Promise<TestResult> {
  const start = Date.now();
  const testName = 'JustTCG Game Coverage';

  if (!JUSTTCG_API_KEY) {
    return { name: testName, status: 'skip', duration: 0, details: 'No API key configured' };
  }

  const games = [
    'one-piece-card-game',
    'pokemon',
    'magic-the-gathering',
    'yugioh',
    'disney-lorcana',
  ];

  const coverage: Record<string, { sets: number; cards: number }> = {};

  try {
    for (const game of games) {
      const response = await makeRequest(
        `${JUSTTCG_BASE_URL}/sets?game=${game}`,
        { 'x-api-key': JUSTTCG_API_KEY }
      );

      if (response.ok) {
        const data = await response.json();
        const totalCards = data.data?.reduce((sum: number, set: { cards_count: number }) =>
          sum + (set.cards_count || 0), 0) || 0;
        coverage[game] = {
          sets: data.meta?.total || data.data?.length || 0,
          cards: totalCards,
        };
      }
    }

    const totalSets = Object.values(coverage).reduce((sum, g) => sum + g.sets, 0);
    const totalCards = Object.values(coverage).reduce((sum, g) => sum + g.cards, 0);

    return {
      name: testName,
      status: 'pass',
      duration: Date.now() - start,
      details: `${Object.keys(coverage).length} games, ${totalSets} sets, ${totalCards.toLocaleString()} cards`,
      data: coverage,
    };
  } catch (error) {
    return {
      name: testName,
      status: 'fail',
      duration: Date.now() - start,
      details: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

async function testJustTCGDataQuality(): Promise<TestResult & { report?: DataQualityReport }> {
  const start = Date.now();
  const testName = 'JustTCG Data Quality';

  if (!JUSTTCG_API_KEY) {
    return { name: testName, status: 'skip', duration: 0, details: 'No API key configured' };
  }

  try {
    // Fetch a sample of One Piece cards
    const response = await makeRequest(
      `${JUSTTCG_BASE_URL}/cards?game=one-piece-card-game&set=romance-dawn-one-piece-card-game&limit=20`,
      { 'x-api-key': JUSTTCG_API_KEY }
    );

    if (!response.ok) {
      return {
        name: testName,
        status: 'fail',
        duration: Date.now() - start,
        details: `HTTP ${response.status}`,
      };
    }

    const data = await response.json();
    const cards = data.data || [];

    // Analyze data quality
    const report: DataQualityReport = {
      source: 'JustTCG API',
      totalCards: cards.length,
      cardsWithPrices: 0,
      cardsWithHistory: 0,
      cardsWithStatistics: 0,
      priceRange: { min: Infinity, max: -Infinity },
      avgPrice: 0,
      conditions: [],
      issues: [],
    };

    const allConditions = new Set<string>();
    let priceSum = 0;
    let priceCount = 0;

    for (const card of cards) {
      const variants = card.variants || [];

      for (const variant of variants) {
        if (variant.price && variant.price > 0) {
          report.cardsWithPrices++;
          priceSum += variant.price;
          priceCount++;
          report.priceRange.min = Math.min(report.priceRange.min, variant.price);
          report.priceRange.max = Math.max(report.priceRange.max, variant.price);
        }

        if (variant.priceHistory && variant.priceHistory.length > 0) {
          report.cardsWithHistory++;
        }

        if (variant.priceChange7d !== null || variant.avgPrice !== null) {
          report.cardsWithStatistics++;
        }

        if (variant.condition) {
          allConditions.add(variant.condition);
        }
      }
    }

    report.conditions = Array.from(allConditions);
    report.avgPrice = priceCount > 0 ? priceSum / priceCount : 0;

    // Check for issues
    if (report.cardsWithPrices < report.totalCards * 0.5) {
      report.issues.push('Less than 50% of cards have prices');
    }
    if (report.priceRange.min === Infinity) {
      report.priceRange.min = 0;
      report.priceRange.max = 0;
    }

    const qualityScore = (
      (report.cardsWithPrices / Math.max(report.totalCards, 1)) * 40 +
      (report.cardsWithHistory > 0 ? 30 : 0) +
      (report.cardsWithStatistics > 0 ? 30 : 0)
    );

    return {
      name: testName,
      status: qualityScore >= 60 ? 'pass' : 'fail',
      duration: Date.now() - start,
      details: `Quality score: ${qualityScore.toFixed(0)}%, ${report.cardsWithPrices}/${report.totalCards} have prices`,
      report,
    };
  } catch (error) {
    return {
      name: testName,
      status: 'fail',
      duration: Date.now() - start,
      details: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

async function testJustTCGRateLimits(): Promise<TestResult> {
  const start = Date.now();
  const testName = 'JustTCG Rate Limit Check';

  if (!JUSTTCG_API_KEY) {
    return { name: testName, status: 'skip', duration: 0, details: 'No API key configured' };
  }

  try {
    const response = await makeRequest(
      `${JUSTTCG_BASE_URL}/sets?game=one-piece-card-game&limit=1`,
      { 'x-api-key': JUSTTCG_API_KEY }
    );

    if (!response.ok) {
      return {
        name: testName,
        status: 'fail',
        duration: Date.now() - start,
        details: `HTTP ${response.status}`,
      };
    }

    const data = await response.json();
    const metadata = data._metadata || {};

    const remaining = metadata.apiRequestsRemaining || metadata.apiDailyRequestsRemaining;
    const limit = metadata.apiRequestLimit || metadata.apiDailyLimit;
    const plan = metadata.apiPlan || 'Unknown';

    return {
      name: testName,
      status: 'pass',
      duration: Date.now() - start,
      details: `Plan: ${plan}, Remaining: ${remaining}/${limit}`,
      data: metadata,
    };
  } catch (error) {
    return {
      name: testName,
      status: 'fail',
      duration: Date.now() - start,
      details: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// =============================================================================
// Bright Data Scraper Tests
// =============================================================================

async function testBrightDataConnection(): Promise<TestResult> {
  const start = Date.now();
  const testName = 'Bright Data Connection';

  if (!BRIGHTDATA_TOKEN) {
    return { name: testName, status: 'skip', duration: 0, details: 'No token configured' };
  }

  if (!TEST_SCRAPER) {
    return { name: testName, status: 'skip', duration: 0, details: 'Use --test-scraper to enable' };
  }

  try {
    // Test with a simple request to TCGPlayer
    const response = await fetch('https://api.brightdata.com/request', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${BRIGHTDATA_TOKEN}`,
      },
      body: JSON.stringify({
        zone: 'mcp_unlocker',
        url: 'https://www.tcgplayer.com/search/one-piece-card-game/product?productLineName=one-piece-card-game&page=1&view=grid',
        format: 'raw',
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        name: testName,
        status: 'fail',
        duration: Date.now() - start,
        details: `HTTP ${response.status}: ${errorText.substring(0, 100)}`,
      };
    }

    const html = await response.text();
    const hasProducts = html.includes('product-card') || html.includes('search-result');

    return {
      name: testName,
      status: hasProducts ? 'pass' : 'fail',
      duration: Date.now() - start,
      details: hasProducts
        ? `Connected successfully, page size: ${(html.length / 1024).toFixed(1)}KB`
        : 'Connected but no products found (may be blocked)',
    };
  } catch (error) {
    return {
      name: testName,
      status: 'fail',
      duration: Date.now() - start,
      details: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// =============================================================================
// Main Test Runner
// =============================================================================

async function runTests(): Promise<void> {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  🧪 TCGPlayer Data Sources Test Suite');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  JustTCG API Key: ${JUSTTCG_API_KEY ? '✅ Configured' : '❌ Missing'}`);
  console.log(`  Bright Data Token: ${BRIGHTDATA_TOKEN ? '✅ Configured' : '❌ Missing'}`);
  console.log(`  Test Scraper: ${TEST_SCRAPER ? '✅ Enabled' : '⏭️ Skipped (use --test-scraper)'}`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  const results: TestResult[] = [];

  // JustTCG API Tests
  console.log('📡 JustTCG API Tests\n');

  results.push(await testJustTCGConnection());
  log(`${results[results.length - 1].name}: ${results[results.length - 1].status.toUpperCase()} (${formatDuration(results[results.length - 1].duration)})`,
      results[results.length - 1].status === 'pass' ? 'success' : results[results.length - 1].status === 'skip' ? 'warn' : 'error');
  if (VERBOSE && results[results.length - 1].details) {
    console.log(`   ${results[results.length - 1].details}`);
  }

  results.push(await testJustTCGGameCoverage());
  log(`${results[results.length - 1].name}: ${results[results.length - 1].status.toUpperCase()} (${formatDuration(results[results.length - 1].duration)})`,
      results[results.length - 1].status === 'pass' ? 'success' : results[results.length - 1].status === 'skip' ? 'warn' : 'error');
  if (VERBOSE && results[results.length - 1].data) {
    console.log(`   Coverage:`, results[results.length - 1].data);
  }

  const qualityResult = await testJustTCGDataQuality();
  results.push(qualityResult);
  log(`${qualityResult.name}: ${qualityResult.status.toUpperCase()} (${formatDuration(qualityResult.duration)})`,
      qualityResult.status === 'pass' ? 'success' : qualityResult.status === 'skip' ? 'warn' : 'error');
  if (qualityResult.report) {
    console.log(`   📊 Quality Report:`);
    console.log(`      Cards with prices: ${qualityResult.report.cardsWithPrices}/${qualityResult.report.totalCards}`);
    console.log(`      Cards with history: ${qualityResult.report.cardsWithHistory}`);
    console.log(`      Cards with statistics: ${qualityResult.report.cardsWithStatistics}`);
    console.log(`      Price range: $${qualityResult.report.priceRange.min.toFixed(2)} - $${qualityResult.report.priceRange.max.toFixed(2)}`);
    console.log(`      Conditions: ${qualityResult.report.conditions.join(', ')}`);
  }

  results.push(await testJustTCGRateLimits());
  log(`${results[results.length - 1].name}: ${results[results.length - 1].status.toUpperCase()} (${formatDuration(results[results.length - 1].duration)})`,
      results[results.length - 1].status === 'pass' ? 'success' : results[results.length - 1].status === 'skip' ? 'warn' : 'error');
  if (results[results.length - 1].details) {
    console.log(`   ${results[results.length - 1].details}`);
  }

  // Bright Data Tests
  console.log('\n🌐 Bright Data Scraper Tests\n');

  results.push(await testBrightDataConnection());
  log(`${results[results.length - 1].name}: ${results[results.length - 1].status.toUpperCase()} (${formatDuration(results[results.length - 1].duration)})`,
      results[results.length - 1].status === 'pass' ? 'success' : results[results.length - 1].status === 'skip' ? 'warn' : 'error');
  if (results[results.length - 1].details) {
    console.log(`   ${results[results.length - 1].details}`);
  }

  // Summary
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  📊 TEST SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════');

  const passed = results.filter(r => r.status === 'pass').length;
  const failed = results.filter(r => r.status === 'fail').length;
  const skipped = results.filter(r => r.status === 'skip').length;

  console.log(`  ✅ Passed: ${passed}`);
  console.log(`  ❌ Failed: ${failed}`);
  console.log(`  ⏭️ Skipped: ${skipped}`);
  console.log(`  📈 Total: ${results.length}`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Exit with error code if any tests failed
  if (failed > 0) {
    console.log('❌ Some tests failed. Check the output above for details.\n');
    process.exit(1);
  }

  console.log('✅ All tests passed!\n');
}

// Run tests
runTests().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
