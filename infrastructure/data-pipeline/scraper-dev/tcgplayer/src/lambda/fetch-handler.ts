/**
 * Lambda Handler: Fetch
 *
 * Fetches card data from APIs and scrapers.
 * Triggered by Step Functions or EventBridge.
 */

import type { Context, Handler } from 'aws-lambda';
import type { GameCode } from '../config/games.js';
import { getEnabledGames } from '../config/games.js';
import { createClientForGame } from '../apis/index.js';
import type { NormalizedCard, NormalizedSet } from '../apis/base-client.js';
import type { SourcedCard } from '../pipeline/merger.js';
import { createS3Storage } from '../storage/s3-client.js';

/**
 * Fetch event input
 */
export interface FetchEvent {
  // Target specification
  game?: GameCode;
  games?: GameCode[];
  sets?: string[];

  // Source preferences
  preferJustTcg?: boolean;
  justTcgApiKey?: string;
  enableScraping?: boolean;

  // Output options
  storeToS3?: boolean;
  s3Bucket?: string;

  // Execution context
  executionId?: string;
  pipelineId?: string;
}

/**
 * Fetch result
 */
export interface FetchResult {
  success: boolean;
  game: GameCode;
  source: string;
  cardCount: number;
  setCount: number;
  s3Key?: string;
  duration: number;
  error?: string;
}

/**
 * Handler response
 */
export interface FetchResponse {
  statusCode: number;
  results: FetchResult[];
  totalCards: number;
  totalDuration: number;
  executionId?: string;
}

/**
 * Lambda handler for fetching card data
 */
export const handler: Handler<FetchEvent, FetchResponse> = async (
  event: FetchEvent,
  context: Context
): Promise<FetchResponse> => {
  const startTime = Date.now();
  const executionId = event.executionId || context.awsRequestId;

  console.log('Fetch handler invoked', { event, executionId });

  const results: FetchResult[] = [];
  let totalCards = 0;

  // Determine which games to fetch
  const games: GameCode[] = event.games || (event.game ? [event.game] : []);
  if (games.length === 0) {
    // Fetch all enabled games
    games.push(...getEnabledGames().map((g) => g.code));
  }

  // Initialize S3 storage if needed
  const s3 = event.storeToS3
    ? createS3Storage({ bucket: event.s3Bucket })
    : null;

  // Process each game
  for (const game of games) {
    const gameStartTime = Date.now();

    try {
      // Create API client
      const client = createClientForGame(game, {
        preferJustTcg: event.preferJustTcg,
        justTcgApiKey: event.justTcgApiKey,
      });

      if (!client) {
        results.push({
          success: false,
          game,
          source: 'none',
          cardCount: 0,
          setCount: 0,
          duration: Date.now() - gameStartTime,
          error: `No API client available for ${game}`,
        });
        continue;
      }

      // Fetch sets
      let sets: NormalizedSet[] = [];
      try {
        sets = await client.getSets();
      } catch (err) {
        console.warn(`Failed to fetch sets for ${game}:`, err);
      }

      // Fetch cards
      let cards: NormalizedCard[] = [];

      if (event.sets && event.sets.length > 0) {
        // Fetch specific sets
        for (const setCode of event.sets) {
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
        source: client.name.toLowerCase().replace(/\s+/g, '-'),
        fetchedAt: new Date(),
      }));

      totalCards += sourcedCards.length;

      // Store to S3 if enabled
      let s3Key: string | undefined;
      if (s3 && sourcedCards.length > 0) {
        s3Key = await s3.storeRawResponse(
          { cards: sourcedCards, sets },
          game,
          client.name.toLowerCase().replace(/\s+/g, '-'),
          { timestamp: new Date() }
        );
      }

      results.push({
        success: true,
        game,
        source: client.name,
        cardCount: sourcedCards.length,
        setCount: sets.length,
        s3Key,
        duration: Date.now() - gameStartTime,
      });

      console.log(`Fetched ${sourcedCards.length} cards for ${game} from ${client.name}`);

    } catch (error) {
      console.error(`Error fetching ${game}:`, error);
      results.push({
        success: false,
        game,
        source: 'error',
        cardCount: 0,
        setCount: 0,
        duration: Date.now() - gameStartTime,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  const response: FetchResponse = {
    statusCode: results.some((r) => r.success) ? 200 : 500,
    results,
    totalCards,
    totalDuration: Date.now() - startTime,
    executionId,
  };

  console.log('Fetch handler complete', {
    totalCards,
    successCount: results.filter((r) => r.success).length,
    errorCount: results.filter((r) => !r.success).length,
    duration: response.totalDuration,
  });

  return response;
};

/**
 * Export for direct invocation
 */
export { handler as fetchHandler };
