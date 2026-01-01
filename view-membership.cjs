const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 }
  });
  const page = await context.newPage();

  console.log('Opening membership page...');
  await page.goto('https://www.cambridgetcg.com/pages/membership', { waitUntil: 'networkidle' });

  // Scroll to show the membership tiers section
  await page.evaluate(() => {
    const tierSection = document.querySelector('[id*="multicolumn"]');
    if (tierSection) {
      tierSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  });

  await page.waitForTimeout(2000);

  // Take a screenshot
  await page.screenshot({ path: '/tmp/membership-page.png', fullPage: true });
  console.log('Screenshot saved to /tmp/membership-page.png');

  // Keep browser open for viewing
  console.log('Browser is open for viewing. Press Ctrl+C to close.');
  await page.waitForTimeout(60000);

  await browser.close();
})();
