/**
 * Test Bright Data Scraping Browser connection
 */
import { chromium } from 'playwright';

async function testBrightData() {
  // Use the mcp_browser zone that was just created
  const API_TOKEN = '***REMOVED-ROTATE-ME***';

  // Try with the mcp_browser zone
  const AUTH = `brd-customer-hl_${API_TOKEN}-zone-mcp_browser:${API_TOKEN}`;
  const SBR_WS = `wss://${AUTH}@brd.superproxy.io:9222`;

  console.log('Connecting to Bright Data Scraping Browser...');

  try {
    const browser = await chromium.connectOverCDP(SBR_WS);
    console.log('Connected to Bright Data!');

    const context = browser.contexts()[0];
    const page = context.pages()[0] || await context.newPage();

    console.log('Navigating to CardMarket...');
    await page.goto('https://www.cardmarket.com/en/OnePiece/Products/Singles/Romance-Dawn', {
      waitUntil: 'domcontentloaded',
      timeout: 120000,
    });

    // Wait for page to fully load / CAPTCHA to be solved
    console.log('Waiting for page load (CAPTCHA auto-solve)...');
    await page.waitForTimeout(10000);

    const html = await page.content();
    const blocked = html.includes('Just a moment') || html.includes('Verify you are human');
    console.log('Blocked by Cloudflare?', blocked);

    if (blocked === false) {
      const rows = await page.evaluate(`document.querySelectorAll('.table-body .row').length`);
      console.log('SUCCESS! Table rows found:', rows);

      // Get some card links
      const cardLinks = await page.evaluate(`
        (function() {
          var links = [];
          document.querySelectorAll('.table-body .row a[href*="/Products/Singles/"]').forEach(function(el) {
            var href = el.getAttribute('href');
            if (href && links.length < 5) {
              links.push(href);
            }
          });
          return links;
        })()
      `);
      console.log('Sample card links:', cardLinks);
    } else {
      console.log('Page title:', await page.title());
      // Show a snippet of the page
      const bodyText = await page.evaluate(`document.body ? document.body.innerText.substring(0, 500) : 'no body'`);
      console.log('Body preview:', bodyText);
    }

    await browser.close();
    console.log('Browser closed');
  } catch (err) {
    console.error('Error:', err instanceof Error ? err.message : err);
  }
}

testBrightData();
