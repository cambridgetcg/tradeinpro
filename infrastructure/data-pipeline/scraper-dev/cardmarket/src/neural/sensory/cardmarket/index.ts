/**
 * CardMarket Alchemist Module
 *
 * The CardMarket scraping module following the Alchemist Grimoire teachings.
 * Extracts pricing data from Europe's premier trading card marketplace.
 *
 * @see docs/CARDMARKET_ALCHEMIST_GRIMOIRE.md
 *
 * Module Structure:
 * ├── target-cards.ts     - Sacred Registry of target cards
 * ├── url-builder.ts      - URL construction for CardMarket pages
 * ├── scrape-orchestrator.ts - Daily transmutation schedule
 * └── index.ts            - This file (module exports)
 */

// =============================================================================
// TARGET CARDS (SACRED REGISTRY)
// =============================================================================

export {
  // Types
  CardMarketTarget,
  SetInfo,
  PriorityTier,
  VariantType as CardMarketVariantType,
  // Constants
  ONE_PIECE_SETS,
  ALL_CARDMARKET_TARGETS,
  // Registry Class
  CardMarketTargetRegistry,
  // Singleton
  cardMarketTargetRegistry,
} from './target-cards.js';

// =============================================================================
// URL BUILDER (SACRED URL CODEX)
// =============================================================================

export {
  // Types
  UrlConfig,
  CardUrl,
  // Class
  CardMarketUrlBuilder,
  // Singleton
  cardMarketUrlBuilder,
  // Helper Functions
  buildCardUrl,
  buildExpansionUrl,
} from './url-builder.js';

// =============================================================================
// SCRAPE ORCHESTRATOR (TRANSMUTATION SCHEDULE)
// =============================================================================

export {
  // Types
  OrchestratorConfig as CardMarketOrchestratorConfig,
  ScrapeJob,
  ScrapeResult as ScrapeJobResult,
  CardMarketPriceData,
  ScheduleWindow as ScrapeScheduleWindow,
  ScrapeSession as ScrapeSessionStats,
  // Class
  CardMarketScrapeOrchestrator,
  // Factory Functions
  createCardMarketOrchestrator,
  getCardMarketOrchestrator,
} from './scrape-orchestrator.js';

// =============================================================================
// DATA PARSER (FOUR CARDINAL ESSENCES)
// =============================================================================

export {
  // Types
  ParsedCardMarketData,
  CardMarketVariant,
  CardMarketLanguage,
  CardMarketCondition,
  RawCardMarketScrape,
  // Class
  CardMarketDataParser,
  // Singleton
  cardMarketDataParser,
  // Utility Functions
  hasValidPricing,
  shouldExcludeFromTraining,
  getDedupeKey as getCardMarketDedupeKey,
  getBestPrice,
  convertEurToUsd,
  getPriceSpread,
} from './data-parser.js';

// =============================================================================
// QUICK START UTILITIES
// =============================================================================

import { cardMarketTargetRegistry } from './target-cards.js';
import { cardMarketUrlBuilder } from './url-builder.js';
import { createCardMarketOrchestrator, CardMarketOrchestratorConfig } from './scrape-orchestrator.js';

/**
 * Quick start: Initialize CardMarket scraping system
 *
 * @example
 * ```typescript
 * import { startCardMarketCollection } from './sensory/cardmarket';
 *
 * // Start automated collection
 * const orchestrator = await startCardMarketCollection();
 *
 * // Run morning ritual manually
 * await orchestrator.runMorningRitual();
 * ```
 */
export async function startCardMarketCollection(
  config: Partial<CardMarketOrchestratorConfig> = {}
): Promise<ReturnType<typeof createCardMarketOrchestrator>> {
  console.log('🔮 Starting CardMarket Alchemist Collection...\n');

  // Log target card summary
  const summary = cardMarketTargetRegistry.getCoverageSummary();
  console.log(`📜 Target Registry:`);
  console.log(`   Total targets: ${summary.totalCards}`);
  console.log(`   By tier: Legendary=${summary.byTier.legendary}, Silver=${summary.byTier.silver}, Rising=${summary.byTier.risingStar}`);
  console.log(`   By character: ${summary.byCharacter.size} unique characters\n`);

  // Log critical gaps
  const gaps = cardMarketTargetRegistry.getCriticalGaps();
  if (gaps.length > 0) {
    console.log(`🚨 Critical Gaps:`);
    gaps.forEach((gap) => {
      console.log(`   - ${gap.category}: ${gap.current}/${gap.target} (${gap.priority})`);
    });
    console.log();
  }

  // Create orchestrator
  const orchestrator = createCardMarketOrchestrator(config);
  await orchestrator.initialize();

  return orchestrator;
}

/**
 * Run a single card scrape manually
 *
 * @example
 * ```typescript
 * import { scrapeCard } from './sensory/cardmarket';
 *
 * const result = await scrapeCard('OP01-120', 'parallel');
 * console.log(result.priceTrend);
 * ```
 */
export async function scrapeCard(
  cardId: string,
  variant: string = 'standard'
): Promise<{ url: string; cardId: string; variant: string }> {
  const target = cardMarketTargetRegistry.findByCardId(cardId);

  if (target) {
    const url = cardMarketUrlBuilder.buildCardDetailUrl(target);
    console.log(`🔗 Card URL: ${url}`);
    return { url, cardId, variant };
  }

  // Fallback: construct URL from card ID pattern
  const setCode = cardId.split('-')[0];
  const setSlug = cardMarketUrlBuilder.getSetSlug(setCode);

  if (!setSlug) {
    throw new Error(`Unknown set code: ${setCode}`);
  }

  const url = cardMarketUrlBuilder.buildCardUrl(cardId, cardId, setSlug, variant);
  console.log(`🔗 Card URL (generated): ${url}`);
  return { url, cardId, variant };
}

/**
 * Get all expansion URLs for scraping
 */
export function getAllExpansionUrls(): Map<string, string[]> {
  return cardMarketUrlBuilder.buildAllExpansionUrls();
}

/**
 * Parse a CardMarket URL to extract card info
 */
export function parseCardMarketUrl(url: string) {
  return cardMarketUrlBuilder.parseUrl(url);
}

// =============================================================================
// CONVENIENCE EXPORTS
// =============================================================================

/**
 * Module metadata
 */
export const CARDMARKET_MODULE = {
  name: 'CardMarket Alchemist',
  version: '1.1.0',
  description: 'CardMarket scraping module following the Alchemist Grimoire teachings',
  docPath: 'docs/CARDMARKET_SCRAPER_INFRASTRUCTURE.md',
  features: [
    'Target card registry with priority tiers',
    'URL builder for expansion and detail pages',
    'Scrape orchestrator with daily schedule',
    'Integrated CardmarketScraper with HTTP + Playwright support',
    'Circuit breaker resilience layer',
    'Multi-strategy CSS selector fallbacks',
    'Rate limiting with randomized delays',
    'Cloudflare bypass strategies (proxy + stealth mode)',
    'EUR → USD price normalization',
    'Critical gap tracking',
  ],
};

/**
 * Print module info
 */
export function printCardMarketModuleInfo(): void {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`📜 ${CARDMARKET_MODULE.name} v${CARDMARKET_MODULE.version}`);
  console.log(`${'='.repeat(60)}`);
  console.log(`\n${CARDMARKET_MODULE.description}\n`);
  console.log(`Documentation: ${CARDMARKET_MODULE.docPath}\n`);
  console.log('Features:');
  CARDMARKET_MODULE.features.forEach((f) => console.log(`  ✓ ${f}`));
  console.log(`\n${'='.repeat(60)}\n`);
}
