/**
 * Analyze CardMarket page structure for condition/language data
 */
import { chromium } from 'playwright';

async function extractArticleStructure() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
  });

  await context.addInitScript(`
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    window.chrome = { runtime: {} };
  `);

  const page = await context.newPage();

  console.log('Loading card page...');
  await page.goto('https://www.cardmarket.com/en/OnePiece/Products/Singles/Romance-Dawn/Kaido-OP01-094-V1', {
    waitUntil: 'networkidle',
    timeout: 60000,
  });

  await page.waitForTimeout(3000);

  // Extract article listings
  const articles = await page.evaluate(() => {
    const results: Array<{
      seller?: string;
      conditionClass?: string;
      condition?: string;
      languageTitle?: string;
      languageClass?: string;
      price?: string;
      quantity?: string;
      rowHtml?: string;
    }> = [];

    // Find all article rows
    const rows = document.querySelectorAll('.article-row');

    rows.forEach((row, i) => {
      if (i >= 10) return; // Limit to first 10

      const article: typeof results[0] = {};

      // Seller info
      const sellerEl = row.querySelector('.seller-name a, .col-seller a');
      article.seller = sellerEl?.textContent?.trim();

      // Condition
      const conditionEl = row.querySelector('[class*="article-condition"]');
      article.conditionClass = conditionEl?.className;
      article.condition = conditionEl?.textContent?.trim();

      // Language (usually a flag icon with tooltip)
      const langEl = row.querySelector('[data-bs-toggle="tooltip"]');
      article.languageTitle = langEl?.getAttribute('title') || langEl?.getAttribute('data-bs-original-title');
      article.languageClass = langEl?.className;

      // Price
      const priceEl = row.querySelector('.price-container .fw-bold, .col-price .fw-bold');
      article.price = priceEl?.textContent?.trim();

      // Quantity
      const qtyEl = row.querySelector('.amount-container, .col-offer .amount');
      article.quantity = qtyEl?.textContent?.trim();

      // Full row HTML for debugging
      article.rowHtml = row.innerHTML.substring(0, 800);

      results.push(article);
    });

    return results;
  });

  console.log('\n=== ARTICLE STRUCTURE ===');
  console.log('Total articles found:', articles.length);

  articles.slice(0, 5).forEach((a, i) => {
    console.log(`\nArticle ${i + 1}:`);
    console.log('  Seller:', a.seller);
    console.log('  Condition:', a.condition, '| Class:', a.conditionClass);
    console.log('  Language Title:', a.languageTitle);
    console.log('  Price:', a.price);
    console.log('  Quantity:', a.quantity);
  });

  // Show first article's HTML for structure analysis
  if (articles[0]?.rowHtml) {
    console.log('\n=== SAMPLE ROW HTML ===');
    console.log(articles[0].rowHtml);
  }

  // Extract language filter options
  const langOptions = await page.evaluate(() => {
    const select = document.querySelector('select[name*="language"], select[name*="idLanguage"]') as HTMLSelectElement | null;
    if (!select) return null;

    const options = Array.from(select.querySelectorAll('option')).map(opt => ({
      value: opt.value,
      text: opt.textContent?.trim()
    }));
    return options;
  });

  console.log('\n=== LANGUAGE OPTIONS ===');
  console.log(langOptions);

  // Extract condition filter options
  const condOptions = await page.evaluate(() => {
    const select = document.querySelector('select[name*="condition"], select[name*="minCondition"]') as HTMLSelectElement | null;
    if (!select) return null;

    const options = Array.from(select.querySelectorAll('option')).map(opt => ({
      value: opt.value,
      text: opt.textContent?.trim()
    }));
    return options;
  });

  console.log('\n=== CONDITION OPTIONS ===');
  console.log(condOptions);

  // Extract price chart/trend data if available
  const priceData = await page.evaluate(() => {
    const data: {
      fromPrice?: string;
      trendPrice?: string;
      avg7?: string;
      avg30?: string;
      available?: string;
    } = {};

    // Look for the info list container
    const infoContainer = document.querySelector('.info-list-container');
    if (infoContainer) {
      const text = infoContainer.textContent || '';

      // Try to extract prices
      const fromMatch = text.match(/From\s*([\d,.]+)\s*€/);
      const trendMatch = text.match(/Price Trend\s*([\d,.]+)\s*€/);
      const avg7Match = text.match(/7-day average price\s*([\d,.]+)\s*€/i);
      const avg30Match = text.match(/30-day average price\s*([\d,.]+)\s*€/i);
      const availMatch = text.match(/Available items\s*(\d+)/i);

      if (fromMatch) data.fromPrice = fromMatch[1];
      if (trendMatch) data.trendPrice = trendMatch[1];
      if (avg7Match) data.avg7 = avg7Match[1];
      if (avg30Match) data.avg30 = avg30Match[1];
      if (availMatch) data.available = availMatch[1];
    }

    return data;
  });

  console.log('\n=== PRICE DATA ===');
  console.log(priceData);

  await browser.close();
}

extractArticleStructure().catch(console.error);
