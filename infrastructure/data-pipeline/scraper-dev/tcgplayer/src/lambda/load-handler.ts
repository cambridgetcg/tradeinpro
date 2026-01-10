/**
 * Lambda Handler: Load
 *
 * Loads transformed card data into PostgreSQL database.
 */

import type { Context, Handler } from 'aws-lambda';
import type { TransformedCard } from '../pipeline/transformer.js';
import { DatabaseLoader, type LoadResult } from '../storage/database-loader.js';
import { createS3Storage } from '../storage/s3-client.js';

/**
 * Load event input
 */
export interface LoadEvent {
  // Input data (one of these is required)
  cards?: TransformedCard[];
  s3Key?: string;
  s3Keys?: string[];

  // Database options
  batchSize?: number;
  trackPriceHistory?: boolean;
  updateExisting?: boolean;
  dryRun?: boolean;

  // S3 options
  s3Bucket?: string;

  // Execution context
  executionId?: string;
  pipelineId?: string;
}

/**
 * Load result
 */
export interface LoadResponse {
  statusCode: number;
  success: boolean;
  stats: {
    inputCards: number;
    inserted: number;
    updated: number;
    skipped: number;
    errors: number;
    priceHistoryRecords: number;
  };
  duration: number;
  executionId?: string;
  error?: string;
  errorDetails?: Array<{ cardId: string; error: string }>;
}

/**
 * Lambda handler for loading card data into database
 */
export const handler: Handler<LoadEvent, LoadResponse> = async (
  event: LoadEvent,
  context: Context
): Promise<LoadResponse> => {
  const startTime = Date.now();
  const executionId = event.executionId || context.awsRequestId;

  console.log('Load handler invoked', {
    executionId,
    hasCards: !!event.cards?.length,
    s3Key: event.s3Key,
    s3Keys: event.s3Keys,
    dryRun: event.dryRun,
  });

  const stats = {
    inputCards: 0,
    inserted: 0,
    updated: 0,
    skipped: 0,
    errors: 0,
    priceHistoryRecords: 0,
  };

  let errorDetails: Array<{ cardId: string; error: string }> = [];

  try {
    // Initialize database loader
    const loader = new DatabaseLoader({
      batchSize: event.batchSize || 100,
      trackPriceHistory: event.trackPriceHistory !== false,
      updateExisting: event.updateExisting !== false,
      dryRun: event.dryRun || false,
    });

    // Initialize S3 if needed
    const s3 = event.s3Key || event.s3Keys
      ? createS3Storage({ bucket: event.s3Bucket })
      : null;

    // Load input cards
    let inputCards: TransformedCard[] = [];

    if (event.cards && event.cards.length > 0) {
      inputCards = event.cards;
    } else if (s3) {
      const keys = event.s3Keys || (event.s3Key ? [event.s3Key] : []);

      for (const key of keys) {
        try {
          const cards = await s3.getTransformedCards(key);
          if (cards) {
            inputCards.push(...cards);
          }
        } catch (err) {
          console.error(`Failed to load from S3 key ${key}:`, err);
          stats.errors++;
        }
      }
    }

    stats.inputCards = inputCards.length;

    if (inputCards.length === 0) {
      await loader.close();
      return {
        statusCode: 400,
        success: false,
        stats,
        duration: Date.now() - startTime,
        executionId,
        error: 'No input cards provided',
      };
    }

    console.log(`Loading ${inputCards.length} cards into database...`);

    // Load cards
    const loadResult: LoadResult = await loader.loadCards(inputCards);

    // Update stats
    stats.inserted = loadResult.inserted;
    stats.updated = loadResult.updated;
    stats.skipped = loadResult.skipped;
    stats.errors = loadResult.errors;
    stats.priceHistoryRecords = loadResult.priceHistoryRecords;
    errorDetails = loadResult.errorDetails;

    // Close database connection
    await loader.close();

    console.log('Load complete', {
      inserted: stats.inserted,
      updated: stats.updated,
      skipped: stats.skipped,
      errors: stats.errors,
      priceHistoryRecords: stats.priceHistoryRecords,
      duration: loadResult.duration,
    });

    return {
      statusCode: loadResult.success ? 200 : 207,
      success: loadResult.success,
      stats,
      duration: Date.now() - startTime,
      executionId,
      errorDetails: errorDetails.length > 0 ? errorDetails : undefined,
    };

  } catch (error) {
    console.error('Load handler error:', error);

    return {
      statusCode: 500,
      success: false,
      stats,
      duration: Date.now() - startTime,
      executionId,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
};

/**
 * Export for direct invocation
 */
export { handler as loadHandler };
