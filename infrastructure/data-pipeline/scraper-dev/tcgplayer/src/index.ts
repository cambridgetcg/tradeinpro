/**
 * TCGplayer Scraper - Main Entry Point
 *
 * Multi-game, multi-source price data fetching framework.
 * Supports: One Piece, Pokemon, MTG, Yu-Gi-Oh, and more TCGs.
 */

// Internal imports for utility functions
import type { GameCode } from './config/games.js';
import { createClientForGame } from './apis/index.js';

// ============================================================================
// Configuration
// ============================================================================
export { config, type Config, type DataSourceConfig, type RateLimitConfig } from './config/index.js';

// Game configuration
export {
  type GameCode,
  type GameConfig,
  type GameApiConfig,
  type DataSourceType,
  SUPPORTED_GAMES,
  getGameConfig,
  getEnabledGames,
  getGamesByDataSource,
  getPrimaryDataSource,
  buildTcgplayerGameUrl,
  buildCardmarketGameUrl,
  registerCustomGame,
} from './config/games.js';

// Set configuration (game-agnostic)
export {
  type SetInfo,
  registerSets,
  getSetsByGame,
  getSetByCode,
  getReleasedSets,
  getSetsByType,
  buildTcgplayerSetUrl,
  buildCardmarketSetUrl,
  VARIANT_KEYWORDS,
  detectVariantType,
  type VariantType,
  // Legacy exports (deprecated)
  ALL_SETS,
  BOOSTER_SETS,
  STARTER_DECKS,
  PROMO_SETS,
} from './config/sets.js';

// ============================================================================
// API Clients
// ============================================================================

// Base client interface
export {
  type ICardApiClient,
  type NormalizedCard,
  type NormalizedSet,
  type SearchParams,
  type ClientStats,
  BaseCardApiClient,
  CurrencyConverter,
  normalizePrice,
} from './apis/base-client.js';

// Game-specific clients
export {
  OptcgClient,
  createOptcgClient,
  type OptcgCard,
  type OptcgSet,
  type OptcgResponse,
  type OptcgSearchParams,
  OptcgApiError,
} from './apis/optcg-client.js';

export {
  PokemonTcgClient,
  createPokemonTcgClient,
  type PokemonCard,
  type PokemonSet,
  type PokemonApiResponse,
} from './apis/pokemon-client.js';

// Client factory
export { createClientForGame, getAvailableClients } from './apis/index.js';

// ============================================================================
// Resilience
// ============================================================================
export {
  CircuitBreaker,
  CircuitBreakerRegistry,
  type CircuitState,
  type CircuitBreakerConfig,
  type CircuitStats,
  generateFingerprint,
  fingerprintToHeaders,
  FingerprintManager,
  type BrowserFingerprint,
} from './resilience/index.js';

// ============================================================================
// Browser Automation
// ============================================================================
export {
  PlaywrightClient,
  createPlaywrightClient,
  type BrowserClientConfig,
  type BrowserType,
  type NavigationResult,
} from './browser/index.js';

// ============================================================================
// Scrapers
// ============================================================================
export {
  TcgplayerScraper,
  createTcgplayerScraper,
  TcgplayerUrlBuilder,
  TcgplayerParser,
  type ScrapedCard,
  type ScrapedPrice,
  type ScraperConfig,
} from './scrapers/index.js';

// ============================================================================
// Pipeline
// ============================================================================
export {
  // Validator
  CardValidator,
  createValidator,
  validateCard,
  validateCards,
  type ValidationResult,
  type ValidationError,
  type ValidationRules,
  // Merger
  CardMerger,
  createMerger,
  mergeTwoSources,
  DATA_SOURCES,
  type SourcedCard,
  type MergedCard,
  type MergeStats,
  type MergeConfig,
  type DataSource,
  // Transformer
  DataTransformer,
  createTransformer,
  transformCards,
  transformRawCards,
  type TransformedCard,
  type TransformResult,
  type TransformOptions,
  type TradeInConfig,
  // Orchestrator
  PipelineOrchestrator,
  createPipeline,
  runPipeline,
  runForGame,
  type PipelineConfig,
  type PipelineResult,
  type PipelineEvent,
  type PipelineStage,
} from './pipeline/index.js';

// ============================================================================
// Storage
// ============================================================================
export {
  // S3 Storage
  S3Storage,
  createS3Storage,
  type S3StorageConfig,
  type StoragePaths,
  type StoredObjectMeta,
  // Database Loader
  DatabaseLoader,
  createDatabaseLoader,
  loadCards as loadCardsToDb,
  type DatabaseLoaderConfig,
  type LoadResult,
  type PriceHistoryRecord,
} from './storage/index.js';

// ============================================================================
// Lambda Handlers
// ============================================================================
export {
  fetchHandler,
  transformHandler,
  loadHandler,
  orchestratorHandler,
  handlers,
  type FetchEvent,
  type FetchResult,
  type FetchResponse,
  type TransformEvent,
  type TransformResponse,
  type LoadEvent,
  type LoadResponse,
  type OrchestratorEvent,
  type OrchestratorResponse,
} from './lambda/index.js';

// ============================================================================
// Monitoring
// ============================================================================
export {
  // Metrics
  MetricsCollector,
  createMetricsCollector,
  getMetricsCollector,
  setDefaultMetricsCollector,
  METRIC_NAMESPACE,
  MetricName,
  type MetricConfig,
  type MetricDataPoint,
  // Logger
  Logger,
  createLogger,
  createLambdaLogger,
  logger,
  LogLevel,
  type LoggerConfig,
  type LogEntry,
} from './monitoring/index.js';

// ============================================================================
// Version & Utilities
// ============================================================================

/**
 * Version information
 */
export const VERSION = '1.0.0';

/**
 * Quick start - get a client for a specific game
 *
 * @example
 * ```typescript
 * import { getClient } from 'tcgplayer-scraper';
 *
 * const onePieceClient = getClient('onepiece');
 * const pokemonClient = getClient('pokemon');
 *
 * // Fetch prices
 * const cards = await onePieceClient.getCardsWithPrices('OP01');
 * ```
 */
export function getClient(game: string) {
  return createClientForGame(game as GameCode);
}
