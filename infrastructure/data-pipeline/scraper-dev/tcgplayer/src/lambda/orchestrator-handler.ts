/**
 * Lambda Handler: Orchestrator
 *
 * Main entry point for the pipeline.
 * Can run the full pipeline or be invoked by Step Functions.
 * Handles EventBridge scheduled events.
 */

import type { Context, Handler, ScheduledEvent } from 'aws-lambda';
import type { GameCode } from '../config/games.js';
import { getEnabledGames } from '../config/games.js';
import {
  PipelineOrchestrator,
  type PipelineConfig,
  type PipelineResult,
} from '../pipeline/orchestrator.js';
import { createS3Storage } from '../storage/s3-client.js';
import { DatabaseLoader } from '../storage/database-loader.js';

/**
 * Orchestrator event input
 */
export interface OrchestratorEvent {
  // Trigger type
  trigger?: 'schedule' | 'manual' | 'step-functions';

  // Pipeline configuration
  games?: GameCode[];
  sets?: Record<string, string[]>; // game -> sets

  // Source preferences
  preferJustTcg?: boolean;
  justTcgApiKey?: string;
  enableScraping?: boolean;

  // Processing options
  validateInput?: boolean;
  validateOutput?: boolean;
  parallelFetch?: boolean;
  maxConcurrency?: number;

  // Output options
  storeToS3?: boolean;
  loadToDatabase?: boolean;
  s3Bucket?: string;
  dryRun?: boolean;

  // Execution context
  executionId?: string;
  source?: string;
}

/**
 * Orchestrator response
 */
export interface OrchestratorResponse {
  statusCode: number;
  success: boolean;
  trigger: string;
  games: GameCode[];
  stats: {
    totalFetched: number;
    totalTransformed: number;
    totalLoaded: number;
    errors: number;
    warnings: number;
    duration: number;
  };
  pipelineResult?: Partial<PipelineResult>;
  s3Keys?: string[];
  executionId?: string;
  error?: string;
}

/**
 * Parse EventBridge scheduled event
 */
function parseScheduledEvent(event: ScheduledEvent): Partial<OrchestratorEvent> {
  return {
    trigger: 'schedule',
    source: event.source,
    games: undefined, // Fetch all enabled games
    storeToS3: true,
    loadToDatabase: true,
  };
}

/**
 * Lambda handler for pipeline orchestration
 */
export const handler: Handler<OrchestratorEvent | ScheduledEvent, OrchestratorResponse> = async (
  event: OrchestratorEvent | ScheduledEvent,
  context: Context
): Promise<OrchestratorResponse> => {
  const startTime = Date.now();

  // Detect if this is an EventBridge scheduled event
  const isScheduledEvent = 'source' in event && event.source?.startsWith('aws.');
  const parsedEvent: OrchestratorEvent = isScheduledEvent
    ? parseScheduledEvent(event as ScheduledEvent)
    : (event as OrchestratorEvent);

  const executionId = parsedEvent.executionId || context.awsRequestId;
  const trigger = parsedEvent.trigger || (isScheduledEvent ? 'schedule' : 'manual');

  console.log('Orchestrator handler invoked', {
    executionId,
    trigger,
    games: parsedEvent.games,
    dryRun: parsedEvent.dryRun,
  });

  const stats = {
    totalFetched: 0,
    totalTransformed: 0,
    totalLoaded: 0,
    errors: 0,
    warnings: 0,
    duration: 0,
  };

  try {
    // Determine games to process
    const games = parsedEvent.games || getEnabledGames().map((g) => g.code);

    // Configure pipeline
    const pipelineConfig: Partial<PipelineConfig> = {
      games,
      preferJustTcg: parsedEvent.preferJustTcg || false,
      justTcgApiKey: parsedEvent.justTcgApiKey,
      enableScraping: parsedEvent.enableScraping || false,
      validateInput: parsedEvent.validateInput !== false,
      validateOutput: parsedEvent.validateOutput !== false,
      parallelFetch: parsedEvent.parallelFetch !== false,
      maxConcurrency: parsedEvent.maxConcurrency || 3,
      onEvent: (pipelineEvent) => {
        console.log(`Pipeline event [${pipelineEvent.stage}]:`, pipelineEvent.message, pipelineEvent.data);
      },
    };

    // Create and run pipeline
    const pipeline = new PipelineOrchestrator(pipelineConfig);

    // Convert sets to Map if provided
    const setsMap = parsedEvent.sets
      ? new Map(Object.entries(parsedEvent.sets) as [GameCode, string[]][])
      : undefined;

    const pipelineResult = await pipeline.run({
      games,
      sets: setsMap,
    });

    // Update stats from pipeline
    stats.totalFetched = pipelineResult.stats.totalFetched;
    stats.totalTransformed = pipelineResult.stats.totalTransformed;
    stats.errors = pipelineResult.stats.errors;
    stats.warnings = pipelineResult.stats.warnings;

    // Store to S3 if enabled
    const s3Keys: string[] = [];
    if (parsedEvent.storeToS3 && !parsedEvent.dryRun && pipelineResult.cards.length > 0) {
      const s3 = createS3Storage({ bucket: parsedEvent.s3Bucket });

      // Store by game
      const cardsByGame = new Map<GameCode, typeof pipelineResult.cards>();
      for (const card of pipelineResult.cards) {
        const existing = cardsByGame.get(card.game) || [];
        existing.push(card);
        cardsByGame.set(card.game, existing);
      }

      for (const [game, cards] of cardsByGame) {
        const key = await s3.storeTransformedCards(cards, game);
        s3Keys.push(key);
        console.log(`Stored ${cards.length} ${game} cards to S3: ${key}`);
      }

      // Store price snapshot for ML
      await s3.storePriceSnapshot(pipelineResult.cards);
    }

    // Load to database if enabled
    if (parsedEvent.loadToDatabase && !parsedEvent.dryRun && pipelineResult.cards.length > 0) {
      const loader = new DatabaseLoader({
        trackPriceHistory: true,
        updateExisting: true,
      });

      try {
        const loadResult = await loader.loadCards(pipelineResult.cards);
        stats.totalLoaded = loadResult.inserted + loadResult.updated;
        stats.errors += loadResult.errors;

        console.log('Database load complete', {
          inserted: loadResult.inserted,
          updated: loadResult.updated,
          errors: loadResult.errors,
          priceHistory: loadResult.priceHistoryRecords,
        });
      } finally {
        await loader.close();
      }
    }

    stats.duration = Date.now() - startTime;

    // Store pipeline log
    if (parsedEvent.storeToS3 && !parsedEvent.dryRun) {
      const s3 = createS3Storage({ bucket: parsedEvent.s3Bucket });
      await s3.storePipelineLog({
        executionId,
        trigger,
        config: pipelineConfig,
        stats,
        errors: pipelineResult.errors,
        events: pipeline.getEvents(),
      }, executionId);
    }

    console.log('Orchestrator complete', {
      success: pipelineResult.success,
      stats,
      s3Keys: s3Keys.length,
    });

    return {
      statusCode: pipelineResult.success ? 200 : 207,
      success: pipelineResult.success,
      trigger,
      games,
      stats,
      pipelineResult: {
        stages: pipelineResult.stages,
        errors: pipelineResult.errors,
      },
      s3Keys: s3Keys.length > 0 ? s3Keys : undefined,
      executionId,
    };

  } catch (error) {
    console.error('Orchestrator handler error:', error);
    stats.duration = Date.now() - startTime;
    stats.errors++;

    return {
      statusCode: 500,
      success: false,
      trigger,
      games: parsedEvent.games || [],
      stats,
      executionId,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
};

/**
 * Export for direct invocation
 */
export { handler as orchestratorHandler };
