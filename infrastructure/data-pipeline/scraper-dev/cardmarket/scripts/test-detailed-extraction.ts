#!/usr/bin/env npx tsx
/**
 * Detailed Cardmarket Extraction Test
 *
 * More thorough analysis of what data we can extract
 */

import { chromium, type Browser, type Page } from 'playwright';
import * as cheerio from 'cheerio';
import { writeFile, mkdir } from 'fs/promises';

const CARD_URL = 'https://www.cardmarket.com/en/OnePiece/Products/Singles/Romance-Dawn/Monkey-D-Luffy-OP01-003';
const EXPANSION_URL = 'https://www.cardmarket.com/en/OnePiece/Products/Singles/Romance-Dawn';

async function analyzeCardPage(): Promise<void> {
  console.log('\n🔍 Detailed Card Page Analysis\n');
  console.log(`URL: ${CARD_URL}\n`);

  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled'],
  });

  try {
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1920, height: 1080 },
      locale: 'de-DE',  // Try German locale for EU site
    });

    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });

    const page = await context.newPage();

    // Navigate with network logging
    console.log('📡 Navigating...');
    const response = await page.goto(CARD_URL, {
      waitUntil: 'networkidle',
      timeout: 60000,
    });

    console.log(`   Response status: ${response?.status()}`);
    console.log(`   Final URL: ${page.url()}`);

    // Wait for content
    await page.waitForTimeout(3000);

    // Get HTML
    const html = await page.content();
    console.log(`   HTML size: ${html.length} bytes`);

    // Save HTML for inspection
    await mkdir('./debug', { recursive: true });
    await writeFile('./debug/card-page.html', html);
    console.log('   Saved HTML to ./debug/card-page.html');

    // Take screenshot
    await page.screenshot({ path: './debug/card-page.png', fullPage: true });
    console.log('   Saved screenshot to ./debug/card-page.png');

    // Check for challenge indicators
    console.log('\n🔒 Challenge Detection:');
    const challenges = {
      'human-test endpoint': html.includes('/human-test/'),
      'BWSTATE cookie ref': html.includes('BWSTATE'),
      'captcha mention': html.includes('captcha'),
      'Cloudflare challenge': html.includes('cf-browser-verification'),
      'Access denied': html.includes('Access denied') || html.includes('403'),
    };

    for (const [name, detected] of Object.entries(challenges)) {
      console.log(`   ${detected ? '⚠️ ' : '✅'} ${name}: ${detected ? 'DETECTED' : 'not found'}`);
    }

    // Parse with Cheerio
    const $ = cheerio.load(html);

    console.log('\n📊 Content Analysis:');

    // Page title
    const pageTitle = $('title').text();
    console.log(`   Page title: ${pageTitle}`);

    // H1 elements
    const h1s = $('h1').map((_, el) => $(el).text().trim()).get();
    console.log(`   H1 elements: ${h1s.length > 0 ? h1s.join(', ') : 'none'}`);

    // Check for product info
    const hasInfoList = $('.info-list-container').length > 0;
    const hasPriceGuide = $('[class*="priceGuide"]').length > 0;
    const hasProductInfo = $('[class*="product"]').length > 0;

    console.log(`   info-list-container: ${hasInfoList ? 'found' : 'not found'}`);
    console.log(`   priceGuide class: ${hasPriceGuide ? 'found' : 'not found'}`);
    console.log(`   product class: ${hasProductInfo ? 'found' : 'not found'}`);

    // Look for price patterns in text
    console.log('\n💰 Price Pattern Search:');

    const euroMatches = html.match(/€\s*[\d.,]+/g) || [];
    console.log(`   Euro prices found: ${euroMatches.length}`);
    if (euroMatches.length > 0) {
      console.log(`   Samples: ${euroMatches.slice(0, 5).join(', ')}`);
    }

    // Try to find specific price labels
    const priceLabels = ['Trend', 'From', 'Ab', '30-day', '7-day', 'Available'];
    for (const label of priceLabels) {
      const regex = new RegExp(`${label}[^€]*€\\s*([\\d.,]+)`, 'i');
      const match = html.match(regex);
      if (match) {
        console.log(`   ${label}: € ${match[1]}`);
      }
    }

    // Try using Playwright locators
    console.log('\n🎯 Playwright Locator Extraction:');

    try {
      // Try different price selectors
      const priceSelectors = [
        '.info-list-container dd',
        'dl dd',
        '[class*="price"]',
        '.font-weight-bold',
        'dd',
      ];

      for (const selector of priceSelectors) {
        const count = await page.locator(selector).count();
        if (count > 0) {
          console.log(`   ${selector}: ${count} elements`);
          const texts = await page.locator(selector).allTextContents();
          const priceTexts = texts.filter(t => t.includes('€') || /\d/.test(t)).slice(0, 3);
          if (priceTexts.length > 0) {
            console.log(`      Values: ${priceTexts.join(', ')}`);
          }
        }
      }
    } catch (e) {
      console.log(`   Locator error: ${e}`);
    }

    // Check for seller listings
    console.log('\n👥 Seller Listings:');
    const articleRows = $('.article-row, [class*="articleRow"], .table-body .row').length;
    console.log(`   Article rows found: ${articleRows}`);

    // Look for specific data attributes
    console.log('\n📋 Data Attributes:');
    const dataAttrs = $('[data-metric], [data-price], [data-trend]');
    console.log(`   Data attribute elements: ${dataAttrs.length}`);

    // Check for JSON-LD
    const jsonLd = $('script[type="application/ld+json"]').html();
    if (jsonLd) {
      console.log('\n📦 JSON-LD Found:');
      try {
        const parsed = JSON.parse(jsonLd);
        console.log(`   Type: ${parsed['@type'] || 'unknown'}`);
        if (parsed.name) console.log(`   Name: ${parsed.name}`);
        if (parsed.offers?.price) console.log(`   Price: ${parsed.offers.price}`);
      } catch {
        console.log('   (Could not parse JSON-LD)');
      }
    }

    await browser.close();
  } catch (error) {
    console.error('Error:', error);
    await browser.close();
  }
}

async function analyzeExpansionPage(): Promise<void> {
  console.log('\n\n🔍 Detailed Expansion Page Analysis\n');
  console.log(`URL: ${EXPANSION_URL}\n`);

  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled'],
  });

  try {
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1920, height: 1080 },
      locale: 'de-DE',
    });

    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });

    const page = await context.newPage();

    console.log('📡 Navigating...');
    const response = await page.goto(EXPANSION_URL, {
      waitUntil: 'networkidle',
      timeout: 60000,
    });

    console.log(`   Response status: ${response?.status()}`);
    console.log(`   Final URL: ${page.url()}`);

    await page.waitForTimeout(3000);

    const html = await page.content();
    console.log(`   HTML size: ${html.length} bytes`);

    await writeFile('./debug/expansion-page.html', html);
    console.log('   Saved HTML to ./debug/expansion-page.html');

    await page.screenshot({ path: './debug/expansion-page.png', fullPage: true });
    console.log('   Saved screenshot to ./debug/expansion-page.png');

    const $ = cheerio.load(html);

    console.log('\n📊 Content Analysis:');
    console.log(`   Page title: ${$('title').text()}`);

    // Look for product links
    const productSelectors = [
      'a[href*="/Products/Singles/"]',
      'a[href*="/Singles/"]',
      '.col-product a',
      '.product-name a',
      'table a',
      '.table-body a',
    ];

    for (const selector of productSelectors) {
      const links = $(selector);
      if (links.length > 0) {
        console.log(`\n   ${selector}: ${links.length} links`);

        // Show first few
        links.slice(0, 3).each((_, el) => {
          const href = $(el).attr('href');
          const text = $(el).text().trim().substring(0, 50);
          console.log(`      - ${text} -> ${href?.substring(0, 60)}`);
        });
      }
    }

    // Look for price information
    console.log('\n💰 Price Elements:');
    const priceElements = $('[class*="price"], .font-weight-bold, td:contains("€")');
    console.log(`   Price-related elements: ${priceElements.length}`);

    // Euro pattern search
    const euroMatches = html.match(/€\s*[\d.,]+/g) || [];
    console.log(`   Euro prices in HTML: ${euroMatches.length}`);
    if (euroMatches.length > 0) {
      const uniquePrices = [...new Set(euroMatches)].slice(0, 10);
      console.log(`   Unique prices: ${uniquePrices.join(', ')}`);
    }

    // Check table structure
    console.log('\n📋 Table Structure:');
    const tables = $('table, .table, .table-body');
    console.log(`   Table elements: ${tables.length}`);

    const rows = $('tr, .row, [class*="Row"]');
    console.log(`   Row elements: ${rows.length}`);

    await browser.close();

    // Summary
    console.log('\n' + '═'.repeat(60));
    console.log('ANALYSIS COMPLETE');
    console.log('Check ./debug/ folder for HTML and screenshots');
    console.log('═'.repeat(60));

  } catch (error) {
    console.error('Error:', error);
    await browser.close();
  }
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║      Detailed Cardmarket Extraction Analysis               ║');
  console.log('╚════════════════════════════════════════════════════════════╝');

  await analyzeCardPage();
  await analyzeExpansionPage();
}

main().catch(console.error);
