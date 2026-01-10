/**
 * Test Playwright browser with proxy for CardMarket
 */
import { chromium } from 'playwright';

const customerId = process.env.BRIGHT_DATA_CUSTOMER || 'hl_2d97e1e0';
const password = process.env.BRIGHT_DATA_PASSWORD || '***REMOVED-ROTATE-ME***';

async function testBrowser() {
  console.log('Launching Playwright with Bright Data proxy...');
  console.log('Customer ID:', customerId);

  // First try without proxy to ensure browser works
  console.log('\n--- Testing without proxy first ---');

  const browserNoProxy = await chromium.launch({ headless: true });
  const pageNoProxy = await browserNoProxy.newPage();
  try {
    await pageNoProxy.goto('https://httpbin.org/ip', { timeout: 10000 });
    const localIp = await pageNoProxy.textContent('body');
    console.log('Local IP (no proxy):', localIp);
  } catch (e) {
    console.log('No proxy test error:', e);
  }
  await browserNoProxy.close();

  console.log('\n--- Now testing WITH Bright Data proxy ---');

  const browser = await chromium.launch({
    headless: true,
    proxy: {
      server: 'brd.superproxy.io:22225',
      username: `${customerId}`,
      password: password,
    },
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    locale: 'en-GB',
    viewport: { width: 1920, height: 1080 },
  });

  const page = await context.newPage();

  try {
    console.log('\n1. Checking IP address...');
    await page.goto('https://httpbin.org/ip');
    const ipText = await page.textContent('body');
    console.log('   IP:', ipText);

    console.log('\n2. Navigating to CardMarket One Piece...');
    const startTime = Date.now();

    await page.goto('https://www.cardmarket.com/en/OnePiece/Products/Singles/Romance-Dawn', {
      waitUntil: 'networkidle',
      timeout: 60000,
    });

    const elapsed = Date.now() - startTime;
    console.log(`   Loaded in ${elapsed}ms`);

    // Check if we passed Cloudflare
    const title = await page.title();
    console.log('   Page title:', title);

    const url = page.url();
    console.log('   Final URL:', url);

    // Look for card elements
    const cardCount = await page.locator('.product-row, .table-body-row, [class*="product"]').count();
    console.log('   Card elements found:', cardCount);

    // Get page content sample
    const content = await page.content();
    console.log('   Page length:', content.length);
    console.log('   Contains "Romance Dawn":', content.includes('Romance Dawn'));
    console.log('   Contains "Monkey D. Luffy":', content.includes('Monkey D. Luffy'));

    if (cardCount > 0 || content.includes('Romance Dawn')) {
      console.log('\n✅ SUCCESS! CardMarket accessible via browser + proxy');

      // Try to extract some card data
      const products = await page.locator('.table-body-row').all();
      console.log(`\n📊 Found ${products.length} product rows`);

      for (let i = 0; i < Math.min(3, products.length); i++) {
        const row = products[i];
        const name = await row.locator('.product-name, .col-name a').textContent().catch(() => 'N/A');
        const price = await row.locator('.price-container, .col-price').textContent().catch(() => 'N/A');
        console.log(`   ${i + 1}. ${name?.trim()} - ${price?.trim()}`);
      }
    } else {
      console.log('\n⚠️ Page loaded but may still be blocked');
      console.log('   First 1000 chars:', content.substring(0, 1000));
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await browser.close();
  }
}

testBrowser();
