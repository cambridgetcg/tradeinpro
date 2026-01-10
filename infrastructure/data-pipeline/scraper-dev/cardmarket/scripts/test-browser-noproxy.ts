/**
 * Test Playwright browser WITHOUT proxy (using existing VPN)
 */
import { chromium } from 'playwright';

async function testBrowser() {
  console.log('Launching Playwright without explicit proxy (using VPN)...');

  const browser = await chromium.launch({
    headless: true,
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    locale: 'en-GB',
    viewport: { width: 1920, height: 1080 },
  });

  const page = await context.newPage();

  try {
    console.log('\n1. Checking IP address...');
    await page.goto('https://httpbin.org/ip', { timeout: 15000 });
    const ipText = await page.textContent('body');
    console.log('   IP:', ipText?.trim());

    console.log('\n2. Navigating to CardMarket Romance Dawn...');
    const startTime = Date.now();

    // Navigate and wait for Cloudflare to resolve
    await page.goto('https://www.cardmarket.com/en/OnePiece/Products/Singles/Romance-Dawn', {
      waitUntil: 'networkidle',
      timeout: 60000,
    });

    const elapsed = Date.now() - startTime;
    console.log(`   Loaded in ${elapsed}ms`);

    // Check page state
    const title = await page.title();
    console.log('   Page title:', title);

    const url = page.url();
    console.log('   Final URL:', url);

    // Wait a bit for any JS to finish
    await page.waitForTimeout(2000);

    // Get page content
    const content = await page.content();
    console.log('   Page length:', content.length);
    console.log('   Contains "Romance Dawn":', content.includes('Romance Dawn'));
    console.log('   Contains "Luffy":', content.includes('Luffy'));
    console.log('   Contains "Just a moment":', content.includes('Just a moment'));

    // Try to find product elements
    const productRows = await page.locator('.table-body-row').count();
    console.log('   Product rows found:', productRows);

    if (productRows > 0) {
      console.log('\n✅ SUCCESS! CardMarket data accessible!');

      // Extract some sample data
      console.log('\n📊 Sample card data:');
      const rows = await page.locator('.table-body-row').all();

      for (let i = 0; i < Math.min(5, rows.length); i++) {
        const row = rows[i];
        const name = await row.locator('a.name, .col-name a').first().textContent().catch(() => null);
        const price = await row.locator('.price-container .price, .col-price').first().textContent().catch(() => null);
        const available = await row.locator('.amount, .col-availability').first().textContent().catch(() => null);

        if (name) {
          console.log(`   ${i + 1}. ${name.trim()}`);
          if (price) console.log(`      Price: ${price.trim()}`);
          if (available) console.log(`      Available: ${available.trim()}`);
        }
      }
    } else if (content.includes('Just a moment')) {
      console.log('\n⚠️ Still on Cloudflare challenge page');
      await page.screenshot({ path: 'cloudflare-challenge.png' });
      console.log('   Screenshot saved to cloudflare-challenge.png');
    } else {
      console.log('\n⚠️ Unexpected page state');
      console.log('   First 1500 chars:', content.substring(0, 1500));
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await browser.close();
  }
}

testBrowser();
