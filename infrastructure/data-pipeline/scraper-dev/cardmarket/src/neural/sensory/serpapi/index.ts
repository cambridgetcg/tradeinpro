/**
 * SerpAPI Module - The Alchemist's Workshop
 *
 * Exports all components for fetching and processing eBay sold listings
 * via SerpAPI for One Piece TCG training data collection.
 *
 * Components:
 *   - TitleParser: Extracts the Four Elements from listing titles
 *   - TargetCardRegistry: Sacred catalogue of target cards
 *   - SerpApiClient: The Alchemist's Cauldron for API queries
 *   - QueryOrchestrator: Grand scheduler of daily rituals
 *
 * @see docs/SERPAPI_ALCHEMIST_GRIMOIRE.md
 */

// =============================================================================
// TITLE PARSER
// =============================================================================

export {
  TitleParser,
  ParsedTitle,
  VariantType,
  LanguageCode,
  shouldExclude,
  getDedupeKey,
  titleParser,
} from './title-parser';

// =============================================================================
// TARGET CARDS
// =============================================================================

export {
  TargetCard,
  TargetCardRegistry,
  PriorityTier,
  QueryTarget,
  CRITICAL_GAPS,
  ALL_TARGET_CARDS,
  targetCardRegistry,
} from './target-cards';

// =============================================================================
// SERPAPI CLIENT
// =============================================================================

export {
  SerpApiClient,
  SerpApiConfig,
  SerpApiQuery,
  SerpApiResponse,
  EbaySoldResult,
  ProcessedListing,
  QueryResult,
  ClientStats,
  createSerpApiClient,
} from './serpapi-client';

// =============================================================================
// QUERY ORCHESTRATOR
// =============================================================================

export {
  QueryOrchestrator,
  OrchestratorConfig,
  ScheduleWindow,
  CollectionBatch,
  BatchStats,
  DailyReport,
  createQueryOrchestrator,
  getOrchestrator,
} from './query-orchestrator';

// =============================================================================
// EBAY RECEPTOR BRIDGE
// =============================================================================

export {
  EbayReceptorBridgeNeuron,
  BridgeConfig,
  BridgeOutput,
  createEbayReceptorBridge,
} from './ebay-receptor-bridge';

// =============================================================================
// HISTORICAL COLLECTOR
// =============================================================================

export {
  HistoricalCollector,
  CollectorConfig,
  CollectedListing,
  CollectionProgress,
  CollectionResult,
  createHistoricalCollector,
  runHistoricalCollection,
} from './historical-collector';

// =============================================================================
// QUICK START
// =============================================================================

import { getOrchestrator, OrchestratorConfig } from './query-orchestrator';
import { targetCardRegistry } from './target-cards';

/**
 * Quick start: Initialize and run the SerpAPI collection system
 *
 * @example
 * ```typescript
 * import { startSerpApiCollection } from './neural/sensory/serpapi';
 *
 * // Start with scheduling enabled
 * const orchestrator = await startSerpApiCollection();
 *
 * // Or run a manual batch
 * const batch = await orchestrator.runMorningBatch();
 *
 * // Export collected data
 * const data = await orchestrator.exportForTraining();
 * ```
 */
export async function startSerpApiCollection(
  config?: Partial<OrchestratorConfig>
): Promise<ReturnType<typeof getOrchestrator>> {
  console.log('\n✨ SERPAPI ALCHEMIST AWAKENS ✨');
  console.log('═'.repeat(50));
  console.log('📜 Consulting the Grimoire...');

  // Print registry summary
  targetCardRegistry.printSummary();

  // Get or create orchestrator
  const orchestrator = getOrchestrator(config);

  // Start with scheduling
  await orchestrator.start();

  console.log('\n🔮 The Alchemist is ready to transmute queries into gold');
  console.log('═'.repeat(50));

  return orchestrator;
}

/**
 * Run a single collection batch manually
 */
export async function runManualCollection(
  schedule: 'morning' | 'midday' | 'evening' | 'gap-fill' = 'morning'
): Promise<void> {
  const orchestrator = getOrchestrator();

  console.log(`\n🧪 Manual collection: ${schedule}`);

  switch (schedule) {
    case 'morning':
      await orchestrator.runMorningBatch();
      break;
    case 'midday':
      await orchestrator.runMiddayBatch();
      break;
    case 'evening':
      await orchestrator.runEveningBatch();
      break;
    case 'gap-fill':
      await orchestrator.runGapFillBatch();
      break;
  }
}
