#!/usr/bin/env node
/**
 * TCGplayer Pipeline CLI
 *
 * Command-line interface for running the pipeline locally.
 *
 * Usage:
 *   npx tsx src/cli.ts fetch --game onepiece
 *   npx tsx src/cli.ts transform --input ./data/raw.json
 *   npx tsx src/cli.ts load --input ./data/transformed.json
 *   npx tsx src/cli.ts run --games onepiece,pokemon
 *   npx tsx src/cli.ts stats
 */

import { parseArgs } from 'util';
import type { GameCode } from './config/games.js';
import { getEnabledGames, SUPPORTED_GAMES } from './config/games.js';
import { createClientForGame } from './apis/index.js';
import { createPipeline, type PipelineResult } from './pipeline/orchestrator.js';
import { createTransformer, type TransformedCard } from './pipeline/transformer.js';
import { createDatabaseLoader } from './storage/database-loader.js';
import { createLogger, LogLevel } from './monitoring/logger.js';
import * as fs from 'fs';
import * as path from 'path';

const logger = createLogger({ level: LogLevel.INFO, json: false });

/**
 * CLI commands
 */
type Command = 'fetch' | 'transform' | 'load' | 'run' | 'stats' | 'help';

/**
 * Parse command line arguments
 */
function parseCliArgs(): {
  command: Command;
  options: Record<string, string | boolean | undefined>;
} {
  const args = process.argv.slice(2);
  const command = (args[0] as Command) || 'help';

  const { values } = parseArgs({
    args: args.slice(1),
    options: {
      game: { type: 'string', short: 'g' },
      games: { type: 'string' },
      input: { type: 'string', short: 'i' },
      output: { type: 'string', short: 'o' },
      set: { type: 'string', short: 's' },
      format: { type: 'string', short: 'f' },
      'dry-run': { type: 'boolean' },
      verbose: { type: 'boolean', short: 'v' },
      'no-db': { type: 'boolean' },
      'justtcg-key': { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: true,
  });

  return { command, options: values };
}

/**
 * Show help
 */
function showHelp(): void {
  console.log(`
TCGplayer Pipeline CLI

Usage: npx tsx src/cli.ts <command> [options]

Commands:
  fetch      Fetch card data from APIs
  transform  Transform raw data to database format
  load       Load transformed data into database
  run        Run the full pipeline
  stats      Show database statistics
  help       Show this help message

Options:
  -g, --game <game>       Single game to process (e.g., onepiece, pokemon)
  --games <games>         Comma-separated list of games
  -i, --input <file>      Input file path
  -o, --output <file>     Output file path
  -s, --set <setCode>     Specific set to fetch
  -f, --format <format>   Output format (json, csv)
  --dry-run               Run without making changes
  --no-db                 Skip database operations
  --justtcg-key <key>     JustTCG API key
  -v, --verbose           Verbose output
  -h, --help              Show help

Examples:
  # Fetch One Piece card data
  npx tsx src/cli.ts fetch --game onepiece --output ./data/onepiece.json

  # Fetch specific set
  npx tsx src/cli.ts fetch --game onepiece --set OP01 --output ./data/op01.json

  # Run full pipeline for multiple games
  npx tsx src/cli.ts run --games onepiece,pokemon,mtg

  # Transform and load data
  npx tsx src/cli.ts transform --input ./data/raw.json --output ./data/transformed.json
  npx tsx src/cli.ts load --input ./data/transformed.json

Supported games: ${SUPPORTED_GAMES.map(g => g.code).join(', ')}
`);
}

/**
 * Fetch command
 */
async function fetchCommand(options: Record<string, string | boolean | undefined>): Promise<void> {
  const game = options.game as GameCode;
  const setCode = options.set as string | undefined;
  const outputPath = options.output as string || `./data/${game}-${Date.now()}.json`;

  if (!game) {
    logger.error('Game is required. Use --game <game>');
    process.exit(1);
  }

  logger.info(`Fetching data for ${game}...`, { game, setCode });

  const client = createClientForGame(game, {
    justTcgApiKey: options['justtcg-key'] as string,
  });

  if (!client) {
    logger.error(`No API client available for ${game}`);
    process.exit(1);
  }

  try {
    let cards;
    if (setCode) {
      cards = await client.getCardsBySet(setCode);
    } else {
      cards = await client.getCardsWithPrices();
    }

    logger.info(`Fetched ${cards.length} cards`, { game, cardCount: cards.length });

    // Ensure output directory exists
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Write output
    fs.writeFileSync(outputPath, JSON.stringify(cards, null, 2));
    logger.info(`Saved to ${outputPath}`);

  } catch (error) {
    logger.error('Fetch failed', error);
    process.exit(1);
  }
}

/**
 * Transform command
 */
async function transformCommand(options: Record<string, string | boolean | undefined>): Promise<void> {
  const inputPath = options.input as string;
  const outputPath = options.output as string || './data/transformed.json';

  if (!inputPath) {
    logger.error('Input file is required. Use --input <file>');
    process.exit(1);
  }

  logger.info(`Transforming data from ${inputPath}...`);

  try {
    const rawData = JSON.parse(fs.readFileSync(inputPath, 'utf-8'));
    const cards = Array.isArray(rawData) ? rawData : rawData.cards || [];

    const transformer = createTransformer({
      calculateTradeIn: true,
      targetCurrency: 'GBP',
    });

    // Convert to merged card format (simplified)
    const mergedCards = cards.map((card: Record<string, unknown>) => ({
      ...card,
      sources: ['cli-import'],
      primarySource: 'cli-import',
      mergedAt: new Date(),
      conflictsResolved: 0,
      qualityScore: 50,
      priceConfidence: card.priceUsd ? 0.7 : 0,
    }));

    const result = transformer.transformCards(mergedCards);

    logger.info(`Transformed ${result.stats.outputCount} cards`, {
      input: result.stats.inputCount,
      output: result.stats.outputCount,
      errors: result.stats.validationErrors,
    });

    // Ensure output directory exists
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Write output
    fs.writeFileSync(outputPath, JSON.stringify(result.cards, null, 2));
    logger.info(`Saved to ${outputPath}`);

  } catch (error) {
    logger.error('Transform failed', error);
    process.exit(1);
  }
}

/**
 * Load command
 */
async function loadCommand(options: Record<string, string | boolean | undefined>): Promise<void> {
  const inputPath = options.input as string;
  const dryRun = options['dry-run'] as boolean || false;

  if (!inputPath) {
    logger.error('Input file is required. Use --input <file>');
    process.exit(1);
  }

  logger.info(`Loading data from ${inputPath}...`, { dryRun });

  try {
    const cards: TransformedCard[] = JSON.parse(fs.readFileSync(inputPath, 'utf-8'));

    const loader = createDatabaseLoader({
      dryRun,
      trackPriceHistory: true,
      updateExisting: true,
    });

    const result = await loader.loadCards(cards);
    await loader.close();

    logger.info('Load complete', {
      inserted: result.inserted,
      updated: result.updated,
      skipped: result.skipped,
      errors: result.errors,
      priceHistory: result.priceHistoryRecords,
      duration: `${result.duration}ms`,
    });

    if (result.errorDetails.length > 0) {
      logger.warn('Errors occurred', { errors: result.errorDetails.slice(0, 10) });
    }

  } catch (error) {
    logger.error('Load failed', error);
    process.exit(1);
  }
}

/**
 * Run full pipeline command
 */
async function runCommand(options: Record<string, string | boolean | undefined>): Promise<void> {
  const gamesArg = options.games as string || options.game as string;
  const noDb = options['no-db'] as boolean || false;
  const dryRun = options['dry-run'] as boolean || false;

  let games: GameCode[];
  if (gamesArg) {
    games = gamesArg.split(',').map((g) => g.trim() as GameCode);
  } else {
    games = getEnabledGames().map((g) => g.code);
  }

  logger.info(`Running pipeline for games: ${games.join(', ')}`, { dryRun, noDb });

  const pipeline = createPipeline({
    games,
    justTcgApiKey: options['justtcg-key'] as string,
    parallelFetch: true,
    maxConcurrency: 3,
    validateInput: true,
    validateOutput: true,
    onEvent: (event) => {
      if (options.verbose) {
        logger.debug(`[${event.stage}] ${event.message}`, event.data);
      }
    },
  });

  try {
    const result = await pipeline.run();

    logger.info('Pipeline complete', {
      success: result.success,
      fetched: result.stats.totalFetched,
      transformed: result.stats.totalTransformed,
      errors: result.stats.errors,
      warnings: result.stats.warnings,
      duration: `${result.stats.duration}ms`,
    });

    // Load to database if not disabled
    if (!noDb && !dryRun && result.cards.length > 0) {
      logger.info('Loading to database...');
      const loader = createDatabaseLoader({ dryRun });
      const loadResult = await loader.loadCards(result.cards);
      await loader.close();

      logger.info('Database load complete', {
        inserted: loadResult.inserted,
        updated: loadResult.updated,
        errors: loadResult.errors,
      });
    }

    // Save output
    const outputPath = options.output as string || `./data/pipeline-${Date.now()}.json`;
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(outputPath, JSON.stringify(result.cards, null, 2));
    logger.info(`Output saved to ${outputPath}`);

    if (!result.success) {
      process.exit(1);
    }

  } catch (error) {
    logger.error('Pipeline failed', error);
    process.exit(1);
  }
}

/**
 * Stats command
 */
async function statsCommand(_options: Record<string, string | boolean | undefined>): Promise<void> {
  logger.info('Fetching database statistics...');

  try {
    const loader = createDatabaseLoader();
    const stats = await loader.getStats();
    await loader.close();

    console.log('\n📊 Database Statistics\n');
    console.log(`Total Cards: ${stats.totalCards.toLocaleString()}`);
    console.log(`Cards with Prices: ${stats.cardsWithPrices.toLocaleString()}`);
    console.log(`Price History Records: ${stats.priceHistoryRecords.toLocaleString()}`);
    console.log(`Last Updated: ${stats.lastUpdated?.toISOString() || 'Never'}`);
    console.log('\nCards by Game:');
    for (const [game, count] of Object.entries(stats.cardsByGame)) {
      console.log(`  ${game}: ${count.toLocaleString()}`);
    }
    console.log('');

  } catch (error) {
    logger.error('Failed to fetch stats', error);
    process.exit(1);
  }
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  const { command, options } = parseCliArgs();

  if (options.help || command === 'help') {
    showHelp();
    return;
  }

  switch (command) {
    case 'fetch':
      await fetchCommand(options);
      break;
    case 'transform':
      await transformCommand(options);
      break;
    case 'load':
      await loadCommand(options);
      break;
    case 'run':
      await runCommand(options);
      break;
    case 'stats':
      await statsCommand(options);
      break;
    default:
      logger.error(`Unknown command: ${command}`);
      showHelp();
      process.exit(1);
  }
}

// Run CLI
main().catch((error) => {
  console.error('CLI error:', error);
  process.exit(1);
});
