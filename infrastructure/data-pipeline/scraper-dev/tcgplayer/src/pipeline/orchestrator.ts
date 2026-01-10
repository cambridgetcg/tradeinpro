/**
 * Pipeline Orchestrator
 *
 * Coordinates the entire data pipeline:
 * 1. Fetch data from multiple sources (APIs, scrapers)
 * 2. Validate incoming data
 * 3. Merge data from different sources
 * 4. Transform to database-ready format
 * 5. Export for storage/loading
 */

import type { GameCode } from '../config/games.js';
import { getGameConfig, getEnabledGames } from '../config/games.js';
import type { ICardApiClient, NormalizedCard, NormalizedSet } from '../apis/base-client.js';
import { createClientForGame, getAvailableClients } from '../apis/index.js';
import type { SourcedCard, MergedCard, MergeStats } from './merger.js';
import { CardMerger, DATA_SOURCES } from './merger.js';
import type { TransformedCard, TransformResult } from './transformer.js';
import { DataTransformer } from './transformer.js';
import type { ValidationResult } from './validator.js';
import { CardValidator } from './validator.js';

/**
 * Pipeline stage
 */
export type PipelineStage =
  | 'init'
  | 'fetch'
  | 'validate'
  | 'merge'
  | 'transform'
  | 'export'
  | 'complete'
  | 'error';

/**
 * Pipeline event
 */
export interface PipelineEvent {
  stage: PipelineStage;
  game?: GameCode;
  source?: string;
  message: string;
  data?: Record<string, unknown>;
  timestamp: Date;
}

/**
 * Pipeline configuration
 */
export interface PipelineConfig {
  // Games to process
  games: GameCode[];

  // Data source preferences
  preferJustTcg: boolean;
  justTcgApiKey?: string;
  enableScraping: boolean;

  // Processing options
  validateInput: boolean;
  validateOutput: boolean;
  parallelFetch: boolean;
  maxConcurrency: number;

  // Output options
  outputFormat: 'json' | 'csv' | 'parquet';
  includeRawData: boolean;

  // Callbacks
  onEvent?: (event: PipelineEvent) => void;
  onProgress?: (processed: number, total: number) => void;
}

/**
 * Pipeline result
 */
export interface PipelineResult {
  success: boolean;
  games: GameCode[];
  stages: PipelineStage[];
  stats: {
    totalFetched: number;
    totalValidated: number;
    totalMerged: number;
    totalTransformed: number;
    errors: number;
    warnings: number;
    duration: number;
  };
  byGame: Map<GameCode, {
    fetched: number;
    merged: number;
    transformed: number;
    errors: string[];
  }>;
  cards: TransformedCard[];
  errors: Array<{ stage: PipelineStage; error: string; details?: unknown }>;
}

/**
 * Fetch result from a single source
 */
interface FetchResult {
  game: GameCode;
  source: string;
  cards: SourcedCard[];
  sets: NormalizedSet[];
  success: boolean;
  error?: string;
  duration: number;
}

const DEFAULT_CONFIG: PipelineConfig = {
  games: [],
  preferJustTcg: false,
  enableScraping: false,
  validateInput: true,
  validateOutput: true,
  parallelFetch: true,
  maxConcurrency: 3,
  outputFormat: 'json',
  includeRawData: false,
};

/**
 * Pipeline orchestrator
 */
export class PipelineOrchestrator {
  private config: PipelineConfig;
  private validator: CardValidator;
  private merger: CardMerger;
  private transformer: DataTransformer;
  private currentStage: PipelineStage = 'init';
  private events: PipelineEvent[] = [];

  constructor(config?: Partial<PipelineConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.validator = new CardValidator();
    this.merger = new CardMerger();
    this.transformer = new DataTransformer();
  }

  /**
   * Run the complete pipeline
   */
  async run(options?: {
    games?: GameCode[];
    sets?: Map<GameCode, string[]>;
  }): Promise<PipelineResult> {
    const startTime = Date.now();
    const games = options?.games || this.config.games;

    if (games.length === 0) {
      // Use all enabled games if none specified
      games.push(...getEnabledGames().map((g) => g.code));
    }

    this.emit('init', { games, config: this.config });

    const result: PipelineResult = {
      success: true,
      games,
      stages: ['init'],
      stats: {
        totalFetched: 0,
        totalValidated: 0,
        totalMerged: 0,
        totalTransformed: 0,
        errors: 0,
        warnings: 0,
        duration: 0,
      },
      byGame: new Map(),
      cards: [],
      errors: [],
    };

    try {
      // Stage 1: Fetch data from all sources
      this.setStage('fetch');
      const fetchResults = await this.fetchAllSources(games, options?.sets);
      result.stages.push('fetch');

      // Aggregate fetch results by game
      const cardsByGame = new Map<GameCode, Map<string, SourcedCard[]>>();
      for (const fetch of fetchResults) {
        if (!fetch.success) {
          result.errors.push({
            stage: 'fetch',
            error: `Failed to fetch from ${fetch.source} for ${fetch.game}`,
            details: fetch.error,
          });
          result.stats.errors++;
          continue;
        }

        result.stats.totalFetched += fetch.cards.length;

        // Group by game
        if (!cardsByGame.has(fetch.game)) {
          cardsByGame.set(fetch.game, new Map());
        }
        const gameCards = cardsByGame.get(fetch.game)!;
        const existing = gameCards.get(fetch.source) || [];
        existing.push(...fetch.cards);
        gameCards.set(fetch.source, existing);
      }

      // Stage 2: Validate input data
      if (this.config.validateInput) {
        this.setStage('validate');
        for (const [game, sourceCards] of cardsByGame) {
          for (const [source, cards] of sourceCards) {
            const validationResult = this.validator.validateCards(
              cards.map((c) => c as NormalizedCard)
            );
            result.stats.totalValidated += validationResult.summary.valid;
            result.stats.warnings += validationResult.summary.warnings;

            // Filter to valid cards only
            const validIds = new Set(validationResult.validCards.map((c) => c.id));
            sourceCards.set(
              source,
              cards.filter((c) => validIds.has(c.id))
            );
          }
        }
        result.stages.push('validate');
      }

      // Stage 3: Merge data from multiple sources
      this.setStage('merge');
      const mergedByGame = new Map<GameCode, MergedCard[]>();

      for (const [game, sourceCards] of cardsByGame) {
        this.emit('merge', { game, sources: [...sourceCards.keys()] });

        const mergeResult = this.merger.mergeCards(sourceCards);
        mergedByGame.set(game, mergeResult.cards);
        result.stats.totalMerged += mergeResult.cards.length;

        // Track per-game stats
        const gameStats = result.byGame.get(game) || {
          fetched: 0,
          merged: 0,
          transformed: 0,
          errors: [],
        };
        gameStats.fetched = [...sourceCards.values()].reduce((sum, arr) => sum + arr.length, 0);
        gameStats.merged = mergeResult.cards.length;
        result.byGame.set(game, gameStats);
      }
      result.stages.push('merge');

      // Stage 4: Transform to database format
      this.setStage('transform');
      const allTransformed: TransformedCard[] = [];

      for (const [game, cards] of mergedByGame) {
        this.emit('transform', { game, count: cards.length });

        const transformResult = this.transformer.transformCards(cards);
        allTransformed.push(...transformResult.cards);
        result.stats.totalTransformed += transformResult.cards.length;

        // Track per-game stats
        const gameStats = result.byGame.get(game)!;
        gameStats.transformed = transformResult.cards.length;
        gameStats.errors.push(...transformResult.errors.map((e) => e.error));

        if (transformResult.errors.length > 0) {
          result.stats.errors += transformResult.errors.length;
          for (const err of transformResult.errors) {
            result.errors.push({
              stage: 'transform',
              error: `Transform error for ${err.cardId}: ${err.error}`,
            });
          }
        }
      }
      result.stages.push('transform');

      // Stage 5: Export
      this.setStage('export');
      result.cards = allTransformed;
      result.stages.push('export');

      // Complete
      this.setStage('complete');
      result.stages.push('complete');
      result.stats.duration = Date.now() - startTime;

      this.emit('complete', {
        stats: result.stats,
        cardCount: result.cards.length,
      });

    } catch (error) {
      this.setStage('error');
      result.success = false;
      result.errors.push({
        stage: this.currentStage,
        error: error instanceof Error ? error.message : 'Unknown error',
        details: error,
      });
      this.emit('error', {
        stage: this.currentStage,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }

    result.stats.duration = Date.now() - startTime;
    return result;
  }

  /**
   * Fetch data from all sources for specified games
   */
  private async fetchAllSources(
    games: GameCode[],
    sets?: Map<GameCode, string[]>
  ): Promise<FetchResult[]> {
    const fetchTasks: Array<() => Promise<FetchResult>> = [];

    for (const game of games) {
      const gameConfig = getGameConfig(game);
      if (!gameConfig) {
        this.emit('fetch', { game, error: `Unknown game: ${game}` });
        continue;
      }

      // Create API client for this game
      const client = createClientForGame(game, {
        preferJustTcg: this.config.preferJustTcg,
        justTcgApiKey: this.config.justTcgApiKey,
      });

      if (client) {
        const gameSets = sets?.get(game);
        fetchTasks.push(() => this.fetchFromClient(client, game, gameSets));
      } else {
        this.emit('fetch', { game, message: `No API client available for ${game}` });
      }
    }

    // Execute fetches (parallel or sequential)
    if (this.config.parallelFetch) {
      return this.executeParallel(fetchTasks, this.config.maxConcurrency);
    } else {
      const results: FetchResult[] = [];
      for (const task of fetchTasks) {
        results.push(await task());
      }
      return results;
    }
  }

  /**
   * Fetch from a single API client
   */
  private async fetchFromClient(
    client: ICardApiClient,
    game: GameCode,
    setFilters?: string[]
  ): Promise<FetchResult> {
    const startTime = Date.now();
    const sourceName = client.name.toLowerCase().replace(/\s+/g, '-');

    this.emit('fetch', { game, source: sourceName, message: `Starting fetch` });

    try {
      let cards: NormalizedCard[] = [];
      let sets: NormalizedSet[] = [];

      // Fetch sets
      try {
        sets = await client.getSets();
      } catch (err) {
        console.warn(`Failed to fetch sets for ${game}:`, err);
      }

      // Fetch cards
      if (setFilters && setFilters.length > 0) {
        // Fetch specific sets
        for (const setCode of setFilters) {
          try {
            const setCards = await client.getCardsBySet(setCode);
            cards.push(...setCards);
          } catch (err) {
            console.warn(`Failed to fetch set ${setCode}:`, err);
          }
        }
      } else {
        // Fetch all cards with prices
        cards = await client.getCardsWithPrices();
      }

      // Convert to SourcedCard format
      const sourcedCards: SourcedCard[] = cards.map((card) => ({
        ...card,
        source: sourceName,
        fetchedAt: new Date(),
      }));

      this.emit('fetch', {
        game,
        source: sourceName,
        message: `Fetched ${sourcedCards.length} cards`,
      });

      return {
        game,
        source: sourceName,
        cards: sourcedCards,
        sets,
        success: true,
        duration: Date.now() - startTime,
      };
    } catch (error) {
      return {
        game,
        source: sourceName,
        cards: [],
        sets: [],
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Execute tasks with concurrency limit
   */
  private async executeParallel<T>(
    tasks: Array<() => Promise<T>>,
    maxConcurrency: number
  ): Promise<T[]> {
    const results: T[] = [];
    const executing: Promise<void>[] = [];

    for (const task of tasks) {
      const promise = task().then((result) => {
        results.push(result);
      });

      executing.push(promise);

      if (executing.length >= maxConcurrency) {
        await Promise.race(executing);
        // Remove completed promises
        const completed = executing.filter((p) =>
          p.then(
            () => true,
            () => true
          )
        );
        executing.length = 0;
        executing.push(...completed);
      }
    }

    await Promise.all(executing);
    return results;
  }

  /**
   * Set current stage
   */
  private setStage(stage: PipelineStage): void {
    this.currentStage = stage;
  }

  /**
   * Emit pipeline event
   */
  private emit(stage: PipelineStage, data?: Record<string, unknown>): void {
    const event: PipelineEvent = {
      stage,
      message: data?.message as string || `Stage: ${stage}`,
      game: data?.game as GameCode,
      source: data?.source as string,
      data,
      timestamp: new Date(),
    };

    this.events.push(event);

    if (this.config.onEvent) {
      this.config.onEvent(event);
    }
  }

  /**
   * Get all events
   */
  getEvents(): PipelineEvent[] {
    return [...this.events];
  }

  /**
   * Clear events
   */
  clearEvents(): void {
    this.events = [];
  }

  /**
   * Run pipeline for a single game
   */
  async runForGame(game: GameCode, sets?: string[]): Promise<PipelineResult> {
    return this.run({
      games: [game],
      sets: sets ? new Map([[game, sets]]) : undefined,
    });
  }

  /**
   * Quick fetch without full pipeline
   */
  async fetchOnly(games?: GameCode[]): Promise<Map<GameCode, SourcedCard[]>> {
    const targetGames = games || this.config.games;
    if (targetGames.length === 0) {
      targetGames.push(...getEnabledGames().map((g) => g.code));
    }

    const fetchResults = await this.fetchAllSources(targetGames);
    const cardsByGame = new Map<GameCode, SourcedCard[]>();

    for (const result of fetchResults) {
      if (result.success) {
        const existing = cardsByGame.get(result.game) || [];
        existing.push(...result.cards);
        cardsByGame.set(result.game, existing);
      }
    }

    return cardsByGame;
  }
}

/**
 * Create pipeline orchestrator
 */
export function createPipeline(config?: Partial<PipelineConfig>): PipelineOrchestrator {
  return new PipelineOrchestrator(config);
}

/**
 * Run pipeline with default configuration
 */
export async function runPipeline(
  games: GameCode[],
  options?: Partial<PipelineConfig>
): Promise<PipelineResult> {
  const pipeline = new PipelineOrchestrator({
    ...options,
    games,
  });
  return pipeline.run();
}

/**
 * Run pipeline for a single game
 */
export async function runForGame(
  game: GameCode,
  sets?: string[],
  options?: Partial<PipelineConfig>
): Promise<PipelineResult> {
  const pipeline = new PipelineOrchestrator(options);
  return pipeline.runForGame(game, sets);
}
