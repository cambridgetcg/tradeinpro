/**
 * Lambda Handler: Transform
 *
 * Transforms fetched data through the pipeline:
 * validate → merge → transform
 */

import type { Context, Handler } from 'aws-lambda';
import type { GameCode } from '../config/games.js';
import type { SourcedCard, MergedCard } from '../pipeline/merger.js';
import { CardMerger } from '../pipeline/merger.js';
import type { TransformedCard, TransformResult } from '../pipeline/transformer.js';
import { DataTransformer } from '../pipeline/transformer.js';
import { CardValidator } from '../pipeline/validator.js';
import { createS3Storage } from '../storage/s3-client.js';

/**
 * Transform event input
 */
export interface TransformEvent {
  // Input data (one of these is required)
  cards?: SourcedCard[];
  s3Keys?: string[];

  // Source metadata
  game?: GameCode;
  sources?: string[];

  // Processing options
  validateInput?: boolean;
  validateOutput?: boolean;
  calculateTradeIn?: boolean;
  targetCurrency?: 'USD' | 'GBP' | 'EUR';

  // Output options
  storeToS3?: boolean;
  s3Bucket?: string;

  // Execution context
  executionId?: string;
  pipelineId?: string;
}

/**
 * Transform result
 */
export interface TransformResponse {
  statusCode: number;
  success: boolean;
  stats: {
    inputCards: number;
    validatedCards: number;
    mergedCards: number;
    transformedCards: number;
    errors: number;
    warnings: number;
  };
  s3Key?: string;
  transformedCards?: TransformedCard[];
  duration: number;
  executionId?: string;
  error?: string;
}

/**
 * Lambda handler for transforming card data
 */
export const handler: Handler<TransformEvent, TransformResponse> = async (
  event: TransformEvent,
  context: Context
): Promise<TransformResponse> => {
  const startTime = Date.now();
  const executionId = event.executionId || context.awsRequestId;

  console.log('Transform handler invoked', { event, executionId });

  const stats = {
    inputCards: 0,
    validatedCards: 0,
    mergedCards: 0,
    transformedCards: 0,
    errors: 0,
    warnings: 0,
  };

  try {
    // Initialize components
    const validator = new CardValidator();
    const merger = new CardMerger();
    const transformer = new DataTransformer({
      targetCurrency: event.targetCurrency || 'GBP',
      calculateTradeIn: event.calculateTradeIn !== false,
      validateOutput: event.validateOutput !== false,
    });

    // Initialize S3 if needed
    const s3 = event.storeToS3 || event.s3Keys
      ? createS3Storage({ bucket: event.s3Bucket })
      : null;

    // Load input data
    let inputCards: SourcedCard[] = [];

    if (event.cards && event.cards.length > 0) {
      inputCards = event.cards;
    } else if (event.s3Keys && event.s3Keys.length > 0 && s3) {
      // Load from S3
      for (const key of event.s3Keys) {
        try {
          const data = await s3.getRawResponse<{ cards: SourcedCard[] }>(key);
          if (data?.cards) {
            inputCards.push(...data.cards);
          }
        } catch (err) {
          console.error(`Failed to load from S3 key ${key}:`, err);
          stats.errors++;
        }
      }
    }

    stats.inputCards = inputCards.length;

    if (inputCards.length === 0) {
      return {
        statusCode: 400,
        success: false,
        stats,
        duration: Date.now() - startTime,
        executionId,
        error: 'No input cards provided',
      };
    }

    // Step 1: Validate input
    let validCards = inputCards;
    if (event.validateInput !== false) {
      const validationResult = validator.validateCards(
        inputCards.map((c) => ({ ...c }))
      );
      stats.validatedCards = validationResult.summary.valid;
      stats.warnings = validationResult.summary.warnings;

      // Filter to valid cards
      const validIds = new Set(validationResult.validCards.map((c) => c.id));
      validCards = inputCards.filter((c) => validIds.has(c.id));

      console.log(`Validation: ${stats.validatedCards}/${stats.inputCards} valid, ${stats.warnings} warnings`);
    } else {
      stats.validatedCards = inputCards.length;
    }

    // Step 2: Group by source and merge
    const cardsBySource = new Map<string, SourcedCard[]>();
    for (const card of validCards) {
      const source = card.source || 'unknown';
      const existing = cardsBySource.get(source) || [];
      existing.push(card);
      cardsBySource.set(source, existing);
    }

    const mergeResult = merger.mergeCards(cardsBySource);
    stats.mergedCards = mergeResult.cards.length;

    console.log(`Merge: ${stats.mergedCards} unique cards from ${cardsBySource.size} sources`);

    // Step 3: Transform
    const transformResult = transformer.transformCards(mergeResult.cards);
    stats.transformedCards = transformResult.stats.outputCount;
    stats.errors += transformResult.errors.length;

    console.log(`Transform: ${stats.transformedCards} cards transformed`);

    // Store to S3 if enabled
    let s3Key: string | undefined;
    if (event.storeToS3 && s3 && transformResult.cards.length > 0) {
      const game = event.game || transformResult.cards[0]?.game || 'mixed';
      s3Key = await s3.storeTransformedCards(
        transformResult.cards,
        game as GameCode,
        { format: 'json' }
      );
      console.log(`Stored ${transformResult.cards.length} cards to S3: ${s3Key}`);
    }

    return {
      statusCode: 200,
      success: true,
      stats,
      s3Key,
      transformedCards: event.storeToS3 ? undefined : transformResult.cards,
      duration: Date.now() - startTime,
      executionId,
    };

  } catch (error) {
    console.error('Transform handler error:', error);

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
export { handler as transformHandler };
