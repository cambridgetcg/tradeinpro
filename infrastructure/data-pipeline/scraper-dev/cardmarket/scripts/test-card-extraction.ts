#!/usr/bin/env npx tsx
/**
 * Test extraction from a specific card page
 */

import { chromium } from 'playwright';
import * as cheerio from 'cheerio';
import { writeFile, mkdir } from 'fs/promises';

// Use the actual URL format found in the HTML
const CARD_URLS = [
  'https://www.cardmarket.com/en/OnePiece/Products/Singles/Romance-Dawn/MonkeyDLuffy-OP01-003-V1',
  'https://www.cardmarket.com/en/OnePiece/Products/Singles/Romance-Dawn/Kaido-OP01-094-V1',
  'https://www.cardmarket.com/en/OnePiece/Products/Singles/Romance-Dawn/Shanks-OP01-120-V1',
];

async function extractCardPrices(url: string): Promise<void> {
  console.log(`\n📦 Testing: ${url.split('/').pop()}\n`);

  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled'],
  });

  try {
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1920, height: 1080 },
    });

    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });

    const page = await context.newPage();

    const response = await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
    console.log(`   Status: ${response?.status()}`);
    console.log(`   Final URL: ${page.url()}`);

    // Wait and get content
    await page.waitForTimeout(2000);
    const html = await page.content();

    // Save for debugging
    const cardName = url.split('/').pop() || 'card';
    await mkdir('./debug', { recursive: true });
    await writeFile(`./debug/${cardName}.html`, html);

    const $ = cheerio.load(html);

    // Extract page title
    console.log(`   Title: ${$('title').text()}`);

    // Look for price info
    console.log('\n   💰 Price Extraction:');

    // Method 1: Look for price patterns in specific containers
    const priceContainers = [
      '.info-list-container',
      '.price-info',
      'dl',
      '.col-6.col-xl-7',
      '[class*="price"]',
    ];

    for (const container of priceContainers) {
      const el = $(container);
      if (el.length > 0) {
        const text = el.text();
        const priceMatches = text.match(/[\d.,]+\s*€|€\s*[\d.,]+/g);
        if (priceMatches && priceMatches.length > 0) {
          console.log(`      ${container}: ${priceMatches.slice(0, 5).join(', ')}`);
        }
      }
    }

    // Method 2: Extract from dt/dd pairs
    console.log('\n   📋 Definition List Data:');
    $('dt').each((_, el) => {
      const label = $(el).text().trim();
      const value = $(el).next('dd').text().trim();
      if (value && (value.includes('€') || /\d/.test(value))) {
        console.log(`      ${label}: ${value}`);
      }
    });

    // Method 3: Look for specific price labels
    console.log('\n   🏷️  Regex Price Search:');
    const patterns = [
      { name: 'From/Ab', regex: /(?:From|Ab)\s*[\d.,]+\s*€|(?:From|Ab)[^€]*€\s*[\d.,]+/gi },
      { name: 'Trend', regex: /Trend\s*[\d.,]+\s*€|Trend[^€]*€\s*[\d.,]+/gi },
      { name: '30-days', regex: /30[^€]*[\d.,]+\s*€/gi },
      { name: '7-days', regex: /7[^€]*[\d.,]+\s*€/gi },
      { name: 'Available', regex: /(\d+)\s*(?:available|items|Artikel)/gi },
    ];

    for (const { name, regex } of patterns) {
      const matches = html.match(regex);
      if (matches) {
        console.log(`      ${name}: ${matches[0]}`);
      }
    }

    // Method 4: Try Playwright locators for dynamic content
    console.log('\n   🎯 Playwright Locator Data:');

    try {
      // Try to get specific elements
      const h1Text = await page.locator('h1').first().textContent();
      console.log(`      Card Name: ${h1Text?.trim()}`);

      // Look for price table
      const priceRows = await page.locator('dl dt, dl dd').allTextContents();
      if (priceRows.length > 0) {
        console.log(`      DL contents: ${priceRows.slice(0, 10).join(' | ')}`);
      }

      // Look for trend price specifically
      const trendEl = await page.locator('text=Trend').first();
      if (await trendEl.count() > 0) {
        const parent = trendEl.locator('xpath=..');
        const parentText = await parent.textContent();
        console.log(`      Trend context: ${parentText?.trim()}`);
      }

    } catch (e) {
      console.log(`      Locator error: ${e}`);
    }

    // Method 5: Extract all euros on page
    const allEuros = html.match(/[\d.,]+\s*€/g) || [];
    const uniqueEuros = [...new Set(allEuros)];
    console.log(`\n   All unique prices: ${uniqueEuros.slice(0, 15).join(', ')}`);

    await browser.close();

  } catch (error) {
    console.error(`   Error: ${error}`);
    await browser.close();
  }
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║         Card-Specific Price Extraction Test                ║');
  console.log('╚════════════════════════════════════════════════════════════╝');

  // Test first card URL
  await extractCardPrices(CARD_URLS[0]);

  // Brief delay
  await new Promise(r => setTimeout(r, 2000));

  // Test a high-value card
  await extractCardPrices(CARD_URLS[2]); // Shanks

  console.log('\n' + '═'.repeat(60));
  console.log('TEST COMPLETE - Check ./debug/ for HTML files');
  console.log('═'.repeat(60));
}

main().catch(console.error);
