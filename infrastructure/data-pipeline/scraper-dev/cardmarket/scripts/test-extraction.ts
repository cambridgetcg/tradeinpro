#!/usr/bin/env npx tsx
/**
 * Test Script: Cardmarket Price Data Extraction
 *
 * Tests different methods to extract price data:
 * 1. Direct HTTP request (likely blocked)
 * 2. HTTP with headers/fingerprint
 * 3. Playwright browser automation
 */

import { chromium, type Browser, type Page } from 'playwright';
import * as cheerio from 'cheerio';

const TEST_URL = 'https://www.cardmarket.com/en/OnePiece/Products/Singles/Romance-Dawn/Monkey-D-Luffy-OP01-003';
const EXPANSION_URL = 'https://www.cardmarket.com/en/OnePiece/Products/Singles/Romance-Dawn';

interface ExtractionResult {
  method: string;
  success: boolean;
  blocked: boolean;
  data: {
    cardName?: string;
    prices?: {
      from?: string;
      trend?: string;
      avg30?: string;
      avg7?: string;
    };
    availability?: string;
    sellers?: number;
  } | null;
  error?: string;
  timing: number;
}

// ==================== METHOD 1: Direct HTTP ====================
async function testDirectHttp(url: string): Promise<ExtractionResult> {
  const start = Date.now();
  console.log('\n📡 Testing direct HTTP request...');

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,de;q=0.8',
      },
    });

    const html = await response.text();
    const timing = Date.now() - start;

    console.log(`   Status: ${response.status}`);
    console.log(`   Size: ${html.length} bytes`);

    // Check for blocking indicators
    const isBlocked =
      response.status === 403 ||
      response.status === 429 ||
      html.includes('human-test') ||
      html.includes('BWSTATE') ||
      html.includes('captcha');

    if (isBlocked) {
      console.log('   ❌ Request blocked');
      return {
        method: 'Direct HTTP',
        success: false,
        blocked: true,
        data: null,
        error: `Blocked: ${response.status}`,
        timing,
      };
    }

    // Try to parse data
    const data = parseCardPage(html);

    return {
      method: 'Direct HTTP',
      success: !!data.cardName,
      blocked: false,
      data,
      timing,
    };
  } catch (error) {
    return {
      method: 'Direct HTTP',
      success: false,
      blocked: false,
      data: null,
      error: error instanceof Error ? error.message : 'Unknown error',
      timing: Date.now() - start,
    };
  }
}

// ==================== METHOD 2: Playwright Browser ====================
async function testPlaywright(url: string): Promise<ExtractionResult> {
  const start = Date.now();
  console.log('\n🎭 Testing Playwright browser...');

  let browser: Browser | null = null;

  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-dev-shm-usage',
      ],
    });

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1920, height: 1080 },
      locale: 'en-US',
    });

    // Add stealth script
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });

    const page = await context.newPage();

    console.log('   Navigating to page...');
    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    console.log(`   Status: ${response?.status()}`);

    // Wait for potential content
    await page.waitForTimeout(2000);

    // Check for BWSTATE challenge
    const html = await page.content();
    const hasBWSTATE = html.includes('human-test') || html.includes('BWSTATE');

    if (hasBWSTATE) {
      console.log('   ⚠️  BWSTATE challenge detected');
      console.log('   Waiting for potential auto-resolution...');
      await page.waitForTimeout(5000);
    }

    // Get final content
    const finalHtml = await page.content();
    console.log(`   Final size: ${finalHtml.length} bytes`);

    // Check if still blocked
    const isBlocked =
      finalHtml.includes('human-test') ||
      finalHtml.includes('BWSTATE') ||
      !finalHtml.includes('cardmarket');

    if (isBlocked) {
      // Take screenshot for debugging
      await page.screenshot({ path: './screenshots/blocked.png' });
      console.log('   ❌ Still blocked (screenshot saved)');

      await browser.close();
      return {
        method: 'Playwright',
        success: false,
        blocked: true,
        data: null,
        error: 'BWSTATE challenge not resolved',
        timing: Date.now() - start,
      };
    }

    // Parse the data
    const data = parseCardPage(finalHtml);

    // Also try to extract from page directly
    if (!data.cardName) {
      data.cardName = await page.locator('h1').first().textContent() || undefined;
    }

    await browser.close();

    return {
      method: 'Playwright',
      success: !!data.cardName,
      blocked: false,
      data,
      timing: Date.now() - start,
    };
  } catch (error) {
    if (browser) await browser.close();
    return {
      method: 'Playwright',
      success: false,
      blocked: false,
      data: null,
      error: error instanceof Error ? error.message : 'Unknown error',
      timing: Date.now() - start,
    };
  }
}

// ==================== METHOD 3: Playwright with Manual Session ====================
async function testPlaywrightInteractive(): Promise<ExtractionResult> {
  const start = Date.now();
  console.log('\n🖱️  Testing Playwright with interactive session...');
  console.log('   This will open a visible browser window.');
  console.log('   If CAPTCHA appears, solve it manually.');

  let browser: Browser | null = null;

  try {
    browser = await chromium.launch({
      headless: false,  // Visible browser
      args: [
        '--disable-blink-features=AutomationControlled',
      ],
    });

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1920, height: 1080 },
    });

    const page = await context.newPage();

    console.log('   Navigating to Cardmarket...');
    await page.goto(TEST_URL, { waitUntil: 'domcontentloaded' });

    // Wait for user to solve CAPTCHA if needed
    console.log('   Waiting for page to be ready (solve CAPTCHA if shown)...');

    try {
      // Wait for price container which indicates successful load
      await page.waitForSelector('.info-list-container, dl', { timeout: 60000 });
      console.log('   ✅ Page loaded successfully!');
    } catch {
      console.log('   ⚠️  Timeout waiting for content');
    }

    const html = await page.content();
    const data = parseCardPage(html);

    // Extract additional data using Playwright locators
    try {
      const priceElements = await page.locator('.info-list-container dd, dl dd').allTextContents();
      console.log('   Price elements found:', priceElements.length);
    } catch {}

    await browser.close();

    return {
      method: 'Playwright Interactive',
      success: !!data.cardName,
      blocked: false,
      data,
      timing: Date.now() - start,
    };
  } catch (error) {
    if (browser) await browser.close();
    return {
      method: 'Playwright Interactive',
      success: false,
      blocked: false,
      data: null,
      error: error instanceof Error ? error.message : 'Unknown error',
      timing: Date.now() - start,
    };
  }
}

// ==================== HTML Parser ====================
function parseCardPage(html: string): ExtractionResult['data'] {
  const $ = cheerio.load(html);
  const data: ExtractionResult['data'] = {};

  // Card name - multiple selectors
  data.cardName =
    $('h1.page-title').text().trim() ||
    $('h1').first().text().trim() ||
    $('[class*="productTitle"]').text().trim() ||
    undefined;

  // Prices - look in info-list-container
  const prices: Record<string, string> = {};

  // Try different structures
  $('.info-list-container dt, dl dt').each((_, el) => {
    const label = $(el).text().trim().toLowerCase();
    const value = $(el).next('dd').text().trim();

    if (label.includes('from') || label.includes('ab')) {
      prices.from = value;
    } else if (label.includes('trend')) {
      prices.trend = value;
    } else if (label.includes('30')) {
      prices.avg30 = value;
    } else if (label.includes('7')) {
      prices.avg7 = value;
    } else if (label.includes('available') || label.includes('verfügbar')) {
      data.availability = value;
    }
  });

  // Also try regex extraction
  if (!prices.trend) {
    const trendMatch = html.match(/Trend[^€]*€\s*([\d.,]+)/i);
    if (trendMatch) prices.trend = `€ ${trendMatch[1]}`;
  }

  if (!prices.from) {
    const fromMatch = html.match(/(?:From|Ab)[^€]*€\s*([\d.,]+)/i);
    if (fromMatch) prices.from = `€ ${fromMatch[1]}`;
  }

  if (Object.keys(prices).length > 0) {
    data.prices = prices;
  }

  // Count sellers
  const sellerRows = $('.article-row, [class*="articleRow"]').length;
  if (sellerRows > 0) {
    data.sellers = sellerRows;
  }

  return data;
}

// ==================== Test Expansion Page ====================
async function testExpansionPage(): Promise<void> {
  console.log('\n📋 Testing expansion page parsing...');

  let browser: Browser | null = null;

  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    await page.goto(EXPANSION_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    const html = await page.content();
    const $ = cheerio.load(html);

    // Try to find product links
    const productLinks = $('a[href*="/Products/Singles/"]');
    console.log(`   Found ${productLinks.length} product links`);

    // Extract first few cards
    const cards: string[] = [];
    productLinks.slice(0, 5).each((_, el) => {
      const href = $(el).attr('href');
      const text = $(el).text().trim();
      if (href && text && text.length > 2) {
        cards.push(`${text} -> ${href}`);
      }
    });

    if (cards.length > 0) {
      console.log('   Sample cards:');
      cards.forEach(c => console.log(`     - ${c}`));
    }

    await browser.close();
  } catch (error) {
    if (browser) await browser.close();
    console.log(`   Error: ${error instanceof Error ? error.message : 'Unknown'}`);
  }
}

// ==================== Main ====================
async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║      Cardmarket Price Data Extraction Test                 ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log(`\nTarget: ${TEST_URL}\n`);

  // Create screenshots directory
  const fs = await import('fs/promises');
  await fs.mkdir('./screenshots', { recursive: true });

  const results: ExtractionResult[] = [];

  // Test 1: Direct HTTP
  results.push(await testDirectHttp(TEST_URL));

  // Test 2: Playwright headless
  results.push(await testPlaywright(TEST_URL));

  // Test 3: Expansion page
  await testExpansionPage();

  // Summary
  console.log('\n' + '═'.repeat(60));
  console.log('RESULTS SUMMARY');
  console.log('═'.repeat(60));

  for (const result of results) {
    const status = result.success ? '✅ SUCCESS' : (result.blocked ? '🚫 BLOCKED' : '❌ FAILED');
    console.log(`\n${result.method}: ${status} (${result.timing}ms)`);

    if (result.data?.cardName) {
      console.log(`  Card: ${result.data.cardName}`);
    }
    if (result.data?.prices) {
      console.log(`  Prices: ${JSON.stringify(result.data.prices)}`);
    }
    if (result.data?.availability) {
      console.log(`  Availability: ${result.data.availability}`);
    }
    if (result.data?.sellers) {
      console.log(`  Sellers: ${result.data.sellers}`);
    }
    if (result.error) {
      console.log(`  Error: ${result.error}`);
    }
  }

  // Check if any method worked
  const anySuccess = results.some(r => r.success);

  console.log('\n' + '═'.repeat(60));
  if (anySuccess) {
    console.log('✅ PRICE DATA EXTRACTION IS POSSIBLE');
  } else if (results.some(r => r.blocked)) {
    console.log('🚫 ALL METHODS BLOCKED - Manual session required');
    console.log('\nTo test with manual CAPTCHA solving, run:');
    console.log('  npx tsx scripts/test-extraction.ts --interactive');
  } else {
    console.log('❌ EXTRACTION FAILED - Check errors above');
  }
  console.log('═'.repeat(60) + '\n');

  // Interactive mode
  if (process.argv.includes('--interactive')) {
    console.log('\n🖱️  Running interactive test...');
    const interactiveResult = await testPlaywrightInteractive();
    console.log('\nInteractive result:', interactiveResult.success ? 'SUCCESS' : 'FAILED');
    if (interactiveResult.data) {
      console.log('Data:', JSON.stringify(interactiveResult.data, null, 2));
    }
  }
}

main().catch(console.error);
