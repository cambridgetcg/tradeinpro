/**
 * Extract card data from CardMarket
 */
import { chromium } from 'playwright';

async function extractCards() {
  console.log('Launching browser to extract CardMarket data...');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    locale: 'en-GB',
  });

  const page = await context.newPage();

  try {
    console.log('Navigating to CardMarket...');
    await page.goto('https://www.cardmarket.com/en/OnePiece/Products/Singles/Romance-Dawn', {
      waitUntil: 'networkidle',
      timeout: 60000,
    });

    console.log('Page loaded:', await page.title());

    // Wait for content
    await page.waitForTimeout(2000);

    // Get all table structure
    console.log('\n--- Analyzing page structure ---');

    // Find the product table
    const tables = await page.locator('table').count();
    console.log('Tables found:', tables);

    // Try different selectors
    const selectors = [
      '.table-body-row',
      'tr.article-row',
      '.product-row',
      'tbody tr',
      '[data-article-id]',
      '.d-flex.has-content-centered',
      '.card-product',
      'div.row.mx-0',
    ];

    for (const sel of selectors) {
      const count = await page.locator(sel).count();
      if (count > 0) {
        console.log(`  ${sel}: ${count} elements`);
      }
    }

    // Get HTML snippet to understand structure
    console.log('\n--- Looking for product elements ---');

    // Try to find links to card pages
    const cardLinks = await page.locator('a[href*="/Products/Singles/Romance-Dawn/"]').all();
    console.log(`Card links found: ${cardLinks.length}`);

    // Extract unique cards
    const cards = new Map<string, { name: string; href: string }>();

    for (const link of cardLinks) {
      const href = await link.getAttribute('href');
      const text = await link.textContent();
      if (href && text && !cards.has(href)) {
        cards.set(href, { name: text.trim(), href });
      }
    }

    console.log(`\nUnique cards: ${cards.size}`);
    console.log('\n📊 Card list (first 15):');

    let i = 0;
    for (const [href, card] of cards) {
      if (i >= 15) break;
      if (card.name.length > 2 && !card.name.includes('€')) {
        console.log(`  ${++i}. ${card.name}`);
        console.log(`     URL: ${href}`);
      }
    }

    // Now try to get price info
    console.log('\n--- Price information ---');

    // Navigate to a specific card page
    if (cards.size > 0) {
      const firstCard = cards.values().next().value;
      if (firstCard) {
        console.log(`\nNavigating to: ${firstCard.name}`);
        const cardUrl = firstCard.href.startsWith('http')
          ? firstCard.href
          : `https://www.cardmarket.com${firstCard.href}`;

        await page.goto(cardUrl, { waitUntil: 'networkidle', timeout: 30000 });
        await page.waitForTimeout(1000);

        console.log('Card page title:', await page.title());

        // Extract price info
        const priceSelectors = [
          { name: 'From price', sel: '.info-list-container dt:has-text("From") + dd' },
          { name: 'Price trend', sel: '.info-list-container dt:has-text("Price Trend") + dd' },
          { name: 'Trend price', sel: 'dd:has-text("€")' },
          { name: 'Available', sel: '.info-list-container dt:has-text("Available") + dd' },
          { name: '30-days avg', sel: '.info-list-container dt:has-text("30-days") + dd' },
          { name: '7-days avg', sel: '.info-list-container dt:has-text("7-days") + dd' },
        ];

        console.log('\nPrice data found:');
        for (const { name, sel } of priceSelectors) {
          const el = page.locator(sel).first();
          const text = await el.textContent().catch(() => null);
          if (text) {
            console.log(`  ${name}: ${text.trim()}`);
          }
        }

        // Get info list values
        const infoItems = await page.locator('.info-list-container dt').all();
        console.log('\nAll info fields:');
        for (const item of infoItems) {
          const label = await item.textContent();
          const value = await item.locator('+ dd').textContent().catch(() => 'N/A');
          console.log(`  ${label?.trim()}: ${value?.trim()}`);
        }

        // Get seller articles
        console.log('\n--- Seller listings ---');
        const articles = await page.locator('.article-row').count();
        console.log(`Article rows: ${articles}`);

        const sellers = await page.locator('[data-article-id]').count();
        console.log(`Seller articles: ${sellers}`);

        // Alternative: look at the table body
        const tableRows = await page.locator('table tbody tr').all();
        console.log(`Table rows: ${tableRows.length}`);

        if (tableRows.length > 0) {
          console.log('\nSample seller data:');
          for (let i = 0; i < Math.min(3, tableRows.length); i++) {
            const row = tableRows[i];
            const seller = await row.locator('a.seller-name, .col-seller a').first().textContent().catch(() => null);
            const price = await row.locator('.price-container, .col-price').first().textContent().catch(() => null);
            const condition = await row.locator('.product-attributes, .col-condition').first().textContent().catch(() => null);
            console.log(`  Seller: ${seller?.trim() || 'N/A'}, Price: ${price?.trim() || 'N/A'}, Condition: ${condition?.trim() || 'N/A'}`);
          }
        }
      }
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await browser.close();
  }
}

extractCards();
