#!/usr/bin/env npx tsx
/**
 * Local testing script for Cardmarket scraper
 *
 * Usage:
 *   npx tsx scripts/test-scraper.ts
 *   npx tsx scripts/test-scraper.ts --card "OP01-003"
 *   npx tsx scripts/test-scraper.ts --expansion "Romance-Dawn"
 *   PROXY_URL=http://user:pass@host:port npx tsx scripts/test-scraper.ts
 */

import { parseArgs } from 'node:util';

// Parse command line arguments
const { values } = parseArgs({
  options: {
    card: { type: 'string', short: 'c' },
    expansion: { type: 'string', short: 'e' },
    verbose: { type: 'boolean', short: 'v', default: false },
  },
});

const CARDMARKET_BASE = 'https://www.cardmarket.com/en/OnePiece';

// One Piece TCG expansion mappings
const EXPANSIONS: Record<string, string> = {
  OP01: 'Romance-Dawn',
  OP02: 'Paramount-War',
  OP03: 'Pillars-of-Strength',
  OP04: 'Kingdoms-of-Intrigue',
  OP05: 'Awakening-of-the-New-Era',
  OP06: 'Wings-of-the-Captain',
  OP07: '500-Years-in-the-Future',
  OP08: 'Two-Legends',
  OP09: 'The-Four-Emperors',
  OP10: 'Royal-Blood',
  OP11: 'Uta',
  EB01: 'Memorial-Collection',
  EB02: 'Extra-Booster-Anime-25th',
};

interface ScrapeResult {
  url: string;
  status: number;
  contentLength: number;
  parseResults?: {
    trendPrice?: number;
    lowPrice?: number;
    cardCount?: number;
    errors?: string[];
  };
  timing: {
    requestMs: number;
    parseMs: number;
    totalMs: number;
  };
}

async function fetchPage(url: string, proxyUrl?: string): Promise<{ html: string; status: number; timeMs: number }> {
  const start = Date.now();

  const fetchOptions: RequestInit = {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
    },
  };

  // Note: Native fetch doesn't support proxies directly
  // For proxy support, use got or node-fetch with proxy-agent
  if (proxyUrl) {
    console.log(`⚠️  Proxy support requires additional setup. Using direct connection.`);
    console.log(`   To use proxy, install: npm install https-proxy-agent`);
  }

  const response = await fetch(url, fetchOptions);
  const html = await response.text();

  return {
    html,
    status: response.status,
    timeMs: Date.now() - start,
  };
}

function parseExpansionPage(html: string): { cardCount: number; cards: string[]; errors: string[] } {
  const errors: string[] = [];
  const cards: string[] = [];

  // Try to find product rows
  const productRowRegex = /<div[^>]*class="[^"]*row[^"]*"[^>]*>[\s\S]*?<\/div>/gi;
  const matches = html.match(productRowRegex) || [];

  // Try to find card links
  const cardLinkRegex = /href="[^"]*\/Products\/Singles\/[^"]+\/([^"]+)"/gi;
  let match;
  while ((match = cardLinkRegex.exec(html)) !== null) {
    cards.push(match[1]);
  }

  if (cards.length === 0) {
    errors.push('No card links found');
  }

  return {
    cardCount: cards.length || matches.length,
    cards: cards.slice(0, 10), // First 10 for sample
    errors,
  };
}

function parseCardPage(html: string): { trendPrice?: number; lowPrice?: number; errors: string[] } {
  const errors: string[] = [];
  let trendPrice: number | undefined;
  let lowPrice: number | undefined;

  // Try multiple patterns for trend price
  const trendPatterns = [
    /class="[^"]*trend[^"]*"[^>]*>€?\s*(\d+[.,]\d{2})/i,
    /Trend[^<]*<[^>]*>€?\s*(\d+[.,]\d{2})/i,
    /data-trend="(\d+[.,]\d{2})"/i,
  ];

  for (const pattern of trendPatterns) {
    const match = html.match(pattern);
    if (match) {
      trendPrice = parseFloat(match[1].replace(',', '.'));
      break;
    }
  }

  // Try patterns for low price
  const lowPatterns = [
    /From[^<]*<[^>]*>€?\s*(\d+[.,]\d{2})/i,
    /class="[^"]*low[^"]*"[^>]*>€?\s*(\d+[.,]\d{2})/i,
    /data-low="(\d+[.,]\d{2})"/i,
  ];

  for (const pattern of lowPatterns) {
    const match = html.match(pattern);
    if (match) {
      lowPrice = parseFloat(match[1].replace(',', '.'));
      break;
    }
  }

  if (!trendPrice) errors.push('Could not find trend price');
  if (!lowPrice) errors.push('Could not find low price');

  return { trendPrice, lowPrice, errors };
}

async function testExpansionScrape(expansionCode: string): Promise<ScrapeResult> {
  const expansionName = EXPANSIONS[expansionCode.toUpperCase()] || expansionCode;
  const url = `${CARDMARKET_BASE}/Products/Singles/${expansionName}`;

  console.log(`\n🔍 Testing expansion scrape: ${expansionCode}`);
  console.log(`   URL: ${url}`);

  const startTotal = Date.now();

  const { html, status, timeMs: requestMs } = await fetchPage(url, process.env.PROXY_URL);

  const startParse = Date.now();
  const parseResults = parseExpansionPage(html);
  const parseMs = Date.now() - startParse;

  const result: ScrapeResult = {
    url,
    status,
    contentLength: html.length,
    parseResults: {
      cardCount: parseResults.cardCount,
      errors: parseResults.errors,
    },
    timing: {
      requestMs,
      parseMs,
      totalMs: Date.now() - startTotal,
    },
  };

  // Log results
  console.log(`\n📊 Results:`);
  console.log(`   Status: ${status}`);
  console.log(`   Content Length: ${html.length} bytes`);
  console.log(`   Cards Found: ${parseResults.cardCount}`);
  if (parseResults.cards.length > 0) {
    console.log(`   Sample Cards: ${parseResults.cards.slice(0, 5).join(', ')}`);
  }
  console.log(`   Timing: ${requestMs}ms request, ${parseMs}ms parse, ${result.timing.totalMs}ms total`);

  if (parseResults.errors.length > 0) {
    console.log(`\n⚠️  Errors:`);
    parseResults.errors.forEach(e => console.log(`   - ${e}`));
  }

  if (values.verbose) {
    console.log(`\n📄 HTML Preview (first 2000 chars):`);
    console.log(html.substring(0, 2000));
  }

  return result;
}

async function testCardScrape(cardId: string): Promise<ScrapeResult> {
  // Parse card ID (e.g., "OP01-003")
  const match = cardId.match(/^([A-Z]{2,3}\d{2})-(\d{3})$/i);
  if (!match) {
    throw new Error(`Invalid card ID format: ${cardId}. Expected format: OP01-003`);
  }

  const [, setCode, cardNum] = match;
  const expansionName = EXPANSIONS[setCode.toUpperCase()];
  if (!expansionName) {
    throw new Error(`Unknown set code: ${setCode}`);
  }

  // Note: We'd need to look up the actual card name from Cardmarket
  // For testing, we'll try a generic URL pattern
  const url = `${CARDMARKET_BASE}/Products/Singles/${expansionName}`;

  console.log(`\n🔍 Testing card scrape: ${cardId}`);
  console.log(`   Expansion URL: ${url}`);
  console.log(`   Note: Direct card URL would require card name lookup`);

  const startTotal = Date.now();

  const { html, status, timeMs: requestMs } = await fetchPage(url, process.env.PROXY_URL);

  const startParse = Date.now();
  const parseResults = parseCardPage(html);
  const parseMs = Date.now() - startParse;

  const result: ScrapeResult = {
    url,
    status,
    contentLength: html.length,
    parseResults: {
      trendPrice: parseResults.trendPrice,
      lowPrice: parseResults.lowPrice,
      errors: parseResults.errors,
    },
    timing: {
      requestMs,
      parseMs,
      totalMs: Date.now() - startTotal,
    },
  };

  console.log(`\n📊 Results:`);
  console.log(`   Status: ${status}`);
  console.log(`   Content Length: ${html.length} bytes`);
  console.log(`   Trend Price: ${parseResults.trendPrice ? `€${parseResults.trendPrice}` : 'Not found'}`);
  console.log(`   Low Price: ${parseResults.lowPrice ? `€${parseResults.lowPrice}` : 'Not found'}`);
  console.log(`   Timing: ${requestMs}ms request, ${parseMs}ms parse, ${result.timing.totalMs}ms total`);

  if (parseResults.errors.length > 0) {
    console.log(`\n⚠️  Errors:`);
    parseResults.errors.forEach(e => console.log(`   - ${e}`));
  }

  return result;
}

async function runBasicTest(): Promise<void> {
  console.log('='.repeat(60));
  console.log('Cardmarket Scraper Test');
  console.log('='.repeat(60));

  console.log('\n📋 Configuration:');
  console.log(`   Proxy: ${process.env.PROXY_URL || 'None (direct connection)'}`);
  console.log(`   Verbose: ${values.verbose}`);

  try {
    // Test main page accessibility
    console.log('\n🌐 Testing main page accessibility...');
    const { html, status, timeMs } = await fetchPage(CARDMARKET_BASE);
    console.log(`   Status: ${status}`);
    console.log(`   Response Time: ${timeMs}ms`);
    console.log(`   Content Length: ${html.length} bytes`);

    if (status === 403) {
      console.log('\n❌ Access blocked (403). You may need:');
      console.log('   1. Residential proxy');
      console.log('   2. Different User-Agent');
      console.log('   3. Wait and retry later');
      return;
    }

    if (status === 200) {
      console.log('\n✅ Main page accessible!');
    }

    // Run specific tests based on arguments
    if (values.card) {
      await testCardScrape(values.card);
    } else if (values.expansion) {
      await testExpansionScrape(values.expansion);
    } else {
      // Default: test OP01 expansion
      await testExpansionScrape('OP01');
    }

  } catch (error) {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  }

  console.log('\n' + '='.repeat(60));
  console.log('Test Complete');
  console.log('='.repeat(60));
}

// Run tests
runBasicTest();
