/**
 * Targeted CardMarket Scraper for Cambridge TCG
 *
 * Scrapes V2/V3 variant cards (alternate arts) for trade-in pricing.
 * Matches by: card number, pricing availability, and language (English).
 * Designed to minimize impact on CardMarket infrastructure.
 */

import { chromium, Browser, Page } from 'playwright';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// =============================================================================
// Types
// =============================================================================

export interface TargetCard {
  card_number: string;
  name: string;
  variants: string[];
  release_set?: string;
}

export interface TargetedCard {
  cardNumber: string;
  name: string;
  variant: string;
  setCode: string;
  url: string;
  priority: 'P0' | 'P1' | 'P2' | 'P3';
  category: string;
}

export interface ScrapedPrice {
  cardNumber: string;
  variant: string;
  name: string;
  language: string;
  // Aggregate prices (all languages combined)
  fromPrice: number | null;
  trendPrice: number | null;
  avg7Price: number | null;
  avg30Price: number | null;
  avg1Price: number | null;
  available: number | null;
  // Language-specific prices (English only)
  englishFromPrice: number | null;
  englishAvailable: number | null;
  // Japanese prices (for comparison)
  japaneseFromPrice: number | null;
  japaneseAvailable: number | null;
  // Metadata
  hasMultipleLanguages: boolean;
  scrapedAt: Date;
  url: string;
}

export interface ScrapeReport {
  startedAt: Date;
  completedAt: Date | null;
  cardsTargeted: number;
  cardsScraped: number;
  cardsSkipped: number;
  errors: string[];
  results: ScrapedPrice[];
}

interface Config {
  limits: {
    max_cards_per_day: number;
    min_delay_seconds: number;
    max_delay_seconds: number;
    max_consecutive_failures: number;
  };
  cache: {
    skip_if_fresher_than_hours: number;
  };
  browser: {
    headless: boolean;
    user_agent: string;
    viewport: { width: number; height: number };
    locale: string;
  };
  targeting: {
    variants: string[];
    language: string;
    min_price_eur: number;
  };
  watchlist: Record<string, { description: string; cards: TargetCard[] }>;
  sets: Record<string, { name: string; slug: string }>;
}

// =============================================================================
// Card Name Mapping (CardMarket URL slugs)
// =============================================================================

const CARD_NAME_SLUGS: Record<string, string> = {
  // Secret Rares
  'OP01-120': 'Shanks',
  'OP01-121': 'Shanks',
  'OP02-120': 'Portgas-D-Ace',
  'OP02-121': 'Portgas-D-Ace',
  'OP03-099': 'Charlotte-Katakuri',
  'OP04-119': 'Yamato',
  'OP05-119': 'Monkey-D-Luffy',
  'OP06-119': 'Rob-Lucci',
  'OP07-119': 'Enel',

  // Leaders
  'OP01-001': 'Roronoa-Zoro',
  'OP01-002': 'Trafalgar-Law',
  'OP01-003': 'Monkey-D-Luffy',
  'OP02-001': 'Edward-Newgate',
  'OP02-002': 'Kaido',
  'OP03-001': 'Charlotte-Katakuri',
  'OP03-021': 'Nami',
  'OP03-040': 'Sakazuki',
  'OP04-001': 'Queen',
  'OP04-019': 'Sanji',

  // Super Rares
  'OP01-025': 'Roronoa-Zoro',
  'OP01-070': 'Dracule-Mihawk',
  'OP01-078': 'Boa-Hancock',
  'OP01-094': 'Kaido',
  'OP02-099': 'Portgas-D-Ace',
  'OP02-114': 'Edward-Newgate',
  'OP03-092': 'Charlotte-Linlin',
  'OP04-083': 'Sabo',
  'OP05-100': 'Trafalgar-Law',

  // SP Cards
  'OP01-051': 'Nami',
  'OP02-036': 'Makino',
  'OP01-017': 'Sanji',
  'OP01-016': 'Usopp',
};

// =============================================================================
// Configuration
// =============================================================================

function loadConfig(): Config {
  const configPath = join(__dirname, '../../config/targeted-cards.json');
  const content = readFileSync(configPath, 'utf-8');
  return JSON.parse(content) as Config;
}

// =============================================================================
// Targeted Scraper Class
// =============================================================================

export class TargetedScraper {
  private config: Config;
  private browser: Browser | null = null;
  private consecutiveFailures = 0;

  constructor() {
    this.config = loadConfig();
  }

  /**
   * Build CardMarket URL for a specific card variant
   */
  private buildCardUrl(cardNumber: string, variant: string): string {
    const setCode = cardNumber.split('-')[0];
    const setInfo = this.config.sets[setCode];

    if (!setInfo) {
      throw new Error(`Unknown set: ${setCode}`);
    }

    const nameSlug = CARD_NAME_SLUGS[cardNumber];
    if (!nameSlug) {
      throw new Error(`No URL slug for card: ${cardNumber}`);
    }

    // Convert variant to URL suffix (V.2 → V2, V.3 → V3)
    const variantSuffix = variant.replace('.', '');

    return `https://www.cardmarket.com/en/OnePiece/Products/Singles/${setInfo.slug}/${nameSlug}-${cardNumber}-${variantSuffix}`;
  }

  /**
   * Get all V2/V3 cards from watchlist
   */
  getWatchlistCards(): TargetedCard[] {
    const cards: TargetedCard[] = [];

    for (const [category, group] of Object.entries(this.config.watchlist)) {
      for (const card of group.cards) {
        // Only process V2/V3 variants (not V1)
        for (const variant of card.variants) {
          if (variant === 'V.1') continue;

          try {
            const url = this.buildCardUrl(card.card_number, variant);
            cards.push({
              cardNumber: card.card_number,
              name: card.name,
              variant: variant,
              setCode: card.card_number.split('-')[0],
              url: url,
              priority: 'P1',
              category: category,
            });
          } catch (e) {
            console.warn(`Skipping ${card.card_number} ${variant}: ${e}`);
          }
        }
      }
    }

    return cards;
  }

  /**
   * Respectful delay between requests
   */
  private async respectfulDelay(): Promise<void> {
    const min = this.config.limits.min_delay_seconds * 1000;
    const max = this.config.limits.max_delay_seconds * 1000;
    const delay = min + Math.random() * (max - min);

    console.log(`  ⏳ Waiting ${(delay / 1000).toFixed(1)}s...`);
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  /**
   * Initialize browser
   */
  private async initBrowser(): Promise<void> {
    if (this.browser) return;

    console.log('🌐 Launching browser...');
    this.browser = await chromium.launch({
      headless: this.config.browser.headless,
    });
  }

  /**
   * Create a new page with proper configuration
   */
  private async createPage(): Promise<Page> {
    if (!this.browser) throw new Error('Browser not initialized');

    const context = await this.browser.newContext({
      userAgent: this.config.browser.user_agent,
      viewport: this.config.browser.viewport,
      locale: this.config.browser.locale,
    });

    return context.newPage();
  }

  /**
   * Parse price from CardMarket format (e.g., "6,00 €" → 6.00)
   */
  private parsePrice(text: string | null): number | null {
    if (!text) return null;

    const cleaned = text
      .replace('€', '')
      .replace('.', '')
      .replace(',', '.')
      .trim();

    const value = parseFloat(cleaned);
    return isNaN(value) ? null : value;
  }

  /**
   * Parse availability count
   */
  private parseCount(text: string | null): number | null {
    if (!text) return null;
    const value = parseInt(text.replace(/\D/g, ''), 10);
    return isNaN(value) ? null : value;
  }

  /**
   * Extract language-specific prices from seller articles
   */
  private async extractLanguagePrices(
    page: Page
  ): Promise<{ english: { from: number | null; count: number }; japanese: { from: number | null; count: number }; hasMultiple: boolean }> {
    const result = {
      english: { from: null as number | null, count: 0 },
      japanese: { from: null as number | null, count: 0 },
      hasMultiple: false,
    };

    try {
      // Get all article rows
      const articles = await page.locator('.article-row').all();

      for (const article of articles) {
        // Check language flag (CardMarket uses flag icons or text)
        const langElement = await article.locator('[data-original-title*="English"], .icon-language-en, [title*="English"]').count();
        const jpElement = await article.locator('[data-original-title*="Japanese"], .icon-language-jp, [title*="Japanese"]').count();

        // Also check for language text in the row
        const rowText = await article.textContent() || '';
        const isEnglish = langElement > 0 || rowText.includes('English') || rowText.includes('EN');
        const isJapanese = jpElement > 0 || rowText.includes('Japanese') || rowText.includes('JP');

        // Extract price from this article
        const priceText = await article.locator('.price-container, .col-price, .text-end').first().textContent().catch(() => null);
        const price = this.parsePrice(priceText);

        if (price !== null) {
          if (isEnglish) {
            result.english.count++;
            if (result.english.from === null || price < result.english.from) {
              result.english.from = price;
            }
          } else if (isJapanese) {
            result.japanese.count++;
            if (result.japanese.from === null || price < result.japanese.from) {
              result.japanese.from = price;
            }
          }
        }
      }

      result.hasMultiple = result.english.count > 0 && result.japanese.count > 0;

    } catch (e) {
      // Language extraction is optional, don't fail the whole scrape
      console.log(`    ℹ️ Could not extract language-specific prices`);
    }

    return result;
  }

  /**
   * Scrape a single card page
   */
  private async scrapeCardPage(
    page: Page,
    card: TargetedCard
  ): Promise<ScrapedPrice | null> {
    try {
      console.log(`  📄 ${card.cardNumber} (${card.variant}): ${card.name}`);

      await page.goto(card.url, {
        waitUntil: 'networkidle',
        timeout: 30000,
      });

      await page.waitForTimeout(1000);

      // Check for Cloudflare or 404
      const title = await page.title();
      if (title.includes('Just a moment')) {
        console.log('    ⚠️ Cloudflare challenge - waiting...');
        await page.waitForTimeout(5000);
      }

      if (title.includes('404') || title.includes('Not Found')) {
        console.log('    ❌ Card not found (404)');
        return null;
      }

      // Extract aggregate pricing data
      const fromPrice = await page
        .locator('.info-list-container dt:has-text("From") + dd')
        .first()
        .textContent()
        .catch(() => null);

      const trendPrice = await page
        .locator('.info-list-container dt:has-text("Price Trend") + dd')
        .first()
        .textContent()
        .catch(() => null);

      const avg7Price = await page
        .locator('.info-list-container dt:has-text("7-days") + dd')
        .first()
        .textContent()
        .catch(() => null);

      const avg30Price = await page
        .locator('.info-list-container dt:has-text("30-days") + dd')
        .first()
        .textContent()
        .catch(() => null);

      const avg1Price = await page
        .locator('.info-list-container dt:has-text("1-day") + dd')
        .first()
        .textContent()
        .catch(() => null);

      const available = await page
        .locator('.info-list-container dt:has-text("Available") + dd')
        .first()
        .textContent()
        .catch(() => null);

      const parsedTrend = this.parsePrice(trendPrice);
      const parsedFrom = this.parsePrice(fromPrice);
      const parsedAvailable = this.parseCount(available);

      // Check minimum price threshold
      if (parsedTrend && parsedTrend < this.config.targeting.min_price_eur) {
        console.log(`    ⏭️ Below min price (€${parsedTrend})`);
        return null;
      }

      // V2/V3 variants are English-only by definition
      // Language extraction is only needed for V1 base cards (not currently in scope)
      const langPrices = {
        english: { from: parsedFrom, count: parsedAvailable || 0 },
        japanese: { from: null as number | null, count: 0 },
        hasMultiple: false
      };

      const result: ScrapedPrice = {
        cardNumber: card.cardNumber,
        variant: card.variant,
        name: card.name,
        language: 'English',
        // Aggregate prices
        fromPrice: parsedFrom,
        trendPrice: parsedTrend,
        avg7Price: this.parsePrice(avg7Price),
        avg30Price: this.parsePrice(avg30Price),
        avg1Price: this.parsePrice(avg1Price),
        available: parsedAvailable,
        // Language-specific prices
        englishFromPrice: langPrices.english.from,
        englishAvailable: langPrices.english.count,
        japaneseFromPrice: langPrices.japanese.from,
        japaneseAvailable: langPrices.japanese.count,
        hasMultipleLanguages: langPrices.hasMultiple,
        scrapedAt: new Date(),
        url: card.url,
      };

      // Log with language breakdown if applicable
      if (langPrices.hasMultiple) {
        console.log(`    ✅ Trend: €${parsedTrend?.toFixed(2) || 'N/A'} | EN: €${langPrices.english.from?.toFixed(2) || 'N/A'} (${langPrices.english.count}) | JP: €${langPrices.japanese.from?.toFixed(2) || 'N/A'} (${langPrices.japanese.count})`);
      } else {
        console.log(`    ✅ Trend: €${parsedTrend?.toFixed(2) || 'N/A'} | From: €${parsedFrom?.toFixed(2) || 'N/A'} | Available: ${result.available || 'N/A'}`);
      }

      this.consecutiveFailures = 0;
      return result;

    } catch (error) {
      console.log(`    ❌ Error: ${error}`);
      this.consecutiveFailures++;
      return null;
    }
  }

  /**
   * Main scraping function
   */
  async scrapeCards(cards: TargetedCard[]): Promise<ScrapeReport> {
    const report: ScrapeReport = {
      startedAt: new Date(),
      completedAt: null,
      cardsTargeted: cards.length,
      cardsScraped: 0,
      cardsSkipped: 0,
      errors: [],
      results: [],
    };

    // Apply daily limit
    if (cards.length > this.config.limits.max_cards_per_day) {
      console.log(`⚠️ Limiting to ${this.config.limits.max_cards_per_day} cards (daily budget)`);
      cards = cards.slice(0, this.config.limits.max_cards_per_day);
      report.cardsTargeted = cards.length;
    }

    console.log(`\n🎯 Targeting ${cards.length} V2/V3 variant cards\n`);
    console.log(`   Language: ${this.config.targeting.language}`);
    console.log(`   Min Price: €${this.config.targeting.min_price_eur}`);
    console.log(`   Delay: ${this.config.limits.min_delay_seconds}-${this.config.limits.max_delay_seconds}s\n`);

    try {
      await this.initBrowser();
      const page = await this.createPage();

      // Group by category for logging
      const byCategory = new Map<string, TargetedCard[]>();
      for (const card of cards) {
        if (!byCategory.has(card.category)) {
          byCategory.set(card.category, []);
        }
        byCategory.get(card.category)!.push(card);
      }

      for (const [category, categoryCards] of byCategory) {
        console.log(`\n📦 ${category} (${categoryCards.length} cards)`);
        console.log('─'.repeat(50));

        for (const card of categoryCards) {
          // Check failure threshold
          if (this.consecutiveFailures >= this.config.limits.max_consecutive_failures) {
            console.log('\n⛔ Too many consecutive failures, stopping...');
            report.errors.push('Stopped: consecutive failure limit');
            break;
          }

          await this.respectfulDelay();

          const result = await this.scrapeCardPage(page, card);

          if (result) {
            report.results.push(result);
            report.cardsScraped++;
          } else {
            report.cardsSkipped++;
          }
        }
      }

      await page.close();

    } catch (error) {
      report.errors.push(`Fatal: ${error}`);
      console.error('\n💥 Fatal error:', error);

    } finally {
      if (this.browser) {
        await this.browser.close();
        this.browser = null;
      }
    }

    report.completedAt = new Date();

    // Summary
    const duration = (report.completedAt.getTime() - report.startedAt.getTime()) / 1000;
    console.log('\n' + '═'.repeat(50));
    console.log('📊 SCRAPE SUMMARY');
    console.log('═'.repeat(50));
    console.log(`   Targeted:  ${report.cardsTargeted} cards`);
    console.log(`   Scraped:   ${report.cardsScraped} cards`);
    console.log(`   Skipped:   ${report.cardsSkipped} cards`);
    console.log(`   Errors:    ${report.errors.length}`);
    console.log(`   Duration:  ${duration.toFixed(1)}s`);
    console.log('═'.repeat(50));

    return report;
  }

  /**
   * Run a test scrape with a small sample
   */
  async testScrape(limit = 5): Promise<ScrapeReport> {
    console.log('\n🧪 TEST SCRAPE MODE\n');

    const watchlist = this.getWatchlistCards();
    console.log(`Found ${watchlist.length} V2/V3 cards in watchlist`);

    // Take sample from different categories
    const sample = watchlist.slice(0, limit);

    return this.scrapeCards(sample);
  }

  /**
   * Run full daily scrape
   */
  async runDailyScrape(): Promise<ScrapeReport> {
    console.log('\n🌅 DAILY CARDMARKET SYNC\n');
    console.log(`Date: ${new Date().toISOString()}`);

    const watchlist = this.getWatchlistCards();
    return this.scrapeCards(watchlist);
  }
}

// =============================================================================
// CLI Entry Point
// =============================================================================

async function main() {
  const args = process.argv.slice(2);
  const isTest = args.includes('--test');
  const limit = parseInt(args.find(a => a.startsWith('--limit='))?.split('=')[1] || '5', 10);

  const scraper = new TargetedScraper();

  let report: ScrapeReport;

  if (isTest) {
    report = await scraper.testScrape(limit);
  } else {
    report = await scraper.runDailyScrape();
  }

  // Output results as JSON for piping
  if (args.includes('--json')) {
    console.log('\n📋 JSON Output:');
    console.log(JSON.stringify(report.results, null, 2));
  } else {
    console.log('\n📈 SCRAPED PRICES:\n');
    for (const result of report.results) {
      console.log(`${result.cardNumber} (${result.variant}) - ${result.name}`);
      console.log(`  Trend: €${result.trendPrice?.toFixed(2) || 'N/A'}`);
      console.log(`  From:  €${result.fromPrice?.toFixed(2) || 'N/A'} (all languages)`);
      console.log(`  7-day: €${result.avg7Price?.toFixed(2) || 'N/A'}`);
      console.log(`  Avail: ${result.available || 'N/A'} sellers`);

      // Show language breakdown for multi-language sets
      if (result.hasMultipleLanguages) {
        console.log(`  ── Language Breakdown ──`);
        console.log(`  🇬🇧 English: €${result.englishFromPrice?.toFixed(2) || 'N/A'} (${result.englishAvailable} sellers)`);
        console.log(`  🇯🇵 Japanese: €${result.japaneseFromPrice?.toFixed(2) || 'N/A'} (${result.japaneseAvailable} sellers)`);
      }
      console.log('');
    }
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}
