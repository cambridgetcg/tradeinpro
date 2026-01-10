/**
 * API Clients Index
 *
 * Export all API clients for multi-game, multi-source data fetching.
 */

// Base client interface
export * from './base-client.js';

// Game-specific clients
export * from './optcg-client.js';
export * from './pokemon-client.js';
export * from './scryfall-client.js';
export * from './justtcg-client.js';

import type { GameCode } from '../config/games.js';
import type { ICardApiClient } from './base-client.js';
import { createOptcgClient } from './optcg-client.js';
import { createPokemonTcgClient } from './pokemon-client.js';
import { createScryfallClient } from './scryfall-client.js';
import { createJustTcgClient } from './justtcg-client.js';
import { config } from '../config/index.js';

/**
 * Client factory - creates appropriate API client for a game
 */
export function createClientForGame(
  game: GameCode,
  options?: {
    preferJustTcg?: boolean;
    justTcgApiKey?: string;
  }
): ICardApiClient | null {
  // If JustTCG is preferred and API key is available, use it for any game
  if (options?.preferJustTcg) {
    const apiKey = options.justTcgApiKey || config.dataSources.justTcg.apiKey;
    if (apiKey) {
      return createJustTcgClient({ game, apiKey });
    }
  }

  // Otherwise use game-specific free APIs
  switch (game) {
    case 'onepiece':
      return createOptcgClient();

    case 'pokemon':
      return createPokemonTcgClient();

    case 'mtg':
      return createScryfallClient();

    case 'yugioh':
    case 'lorcana':
    case 'flesh-and-blood':
    case 'digimon':
    case 'star-wars-unlimited':
    case 'union-arena':
    case 'weiss-schwarz':
    case 'dragonball-super':
      // These games require JustTCG API or direct scraping
      const apiKey = options?.justTcgApiKey || config.dataSources.justTcg.apiKey;
      if (apiKey) {
        return createJustTcgClient({ game, apiKey });
      }
      console.warn(`Game ${game} requires JustTCG API key or scraper fallback`);
      return null;

    default:
      console.warn(`No API client available for game: ${game}`);
      return null;
  }
}

/**
 * Get all available clients with free APIs
 */
export function getAvailableClients(): Map<GameCode, () => ICardApiClient> {
  const clients: Array<[GameCode, () => ICardApiClient]> = [
    ['onepiece', () => createOptcgClient()],
    ['pokemon', () => createPokemonTcgClient()],
    ['mtg', () => createScryfallClient()],
  ];
  return new Map(clients);
}

/**
 * Get clients that require JustTCG API
 */
export function getJustTcgOnlyGames(): GameCode[] {
  return [
    'yugioh',
    'lorcana',
    'flesh-and-blood',
    'digimon',
    'star-wars-unlimited',
    'union-arena',
    'weiss-schwarz',
    'dragonball-super',
  ];
}

/**
 * Check if a game has a free API available
 */
export function hasFreeApi(game: GameCode): boolean {
  return ['onepiece', 'pokemon', 'mtg'].includes(game);
}

/**
 * Create multiple clients for batch operations
 */
export function createClientsForGames(
  games: GameCode[],
  options?: { justTcgApiKey?: string }
): Map<GameCode, ICardApiClient> {
  const clients = new Map<GameCode, ICardApiClient>();

  for (const game of games) {
    const client = createClientForGame(game, {
      justTcgApiKey: options?.justTcgApiKey,
    });
    if (client) {
      clients.set(game, client);
    }
  }

  return clients;
}
