/**
 * Shard Router for Multi-TCG Database Architecture
 *
 * Provides horizontal sharding by game, allowing each TCG to have its own
 * database instance for independent scaling and isolation.
 *
 * Usage:
 *   import { getShardClient, withShard, GameShard } from "./shard.server";
 *
 *   // Get client for a specific game
 *   const client = getShardClient("pokemon");
 *   const cards = await client.cardPriceV2.findMany();
 *
 *   // Execute query on specific shard
 *   const history = await withShard("onepiece", (prisma) =>
 *     prisma.cardPriceHistory.findMany({ where: { cardId } })
 *   );
 *
 * Environment Variables:
 *   DATABASE_URL              - Default/One Piece shard (required)
 *   DATABASE_URL_POKEMON      - Pokemon TCG shard (optional)
 *   DATABASE_URL_MTG          - Magic: The Gathering shard (optional)
 *   DATABASE_URL_YUGIOH       - Yu-Gi-Oh! shard (optional)
 *   DATABASE_URL_LORCANA      - Disney Lorcana shard (optional)
 *   DATABASE_URL_UNION_ARENA  - Union Arena shard (optional)
 */

import { PrismaClient } from "@prisma/client";

// ============================================================================
// Types
// ============================================================================

/**
 * Supported game shards. Add new games here as they're onboarded.
 */
export type GameShard =
  | "onepiece"
  | "pokemon"
  | "mtg"
  | "yugioh"
  | "lorcana"
  | "unionarena";

/**
 * Shard configuration for a single game database.
 */
export interface ShardConfig {
  /** Game identifier */
  game: GameShard;
  /** Environment variable name for database URL */
  envVar: string;
  /** Display name for logging */
  displayName: string;
  /** Whether this shard is currently active */
  active: boolean;
}

/**
 * Shard health status.
 */
export interface ShardHealth {
  game: GameShard;
  displayName: string;
  connected: boolean;
  latencyMs: number;
  activeConnections: number;
  maxConnections: number;
  error?: string;
}

// ============================================================================
// Configuration
// ============================================================================

/**
 * Shard configuration for all supported games.
 * The default shard (onepiece) uses DATABASE_URL.
 */
export const SHARD_CONFIG: Record<GameShard, ShardConfig> = {
  onepiece: {
    game: "onepiece",
    envVar: "DATABASE_URL",
    displayName: "One Piece TCG",
    active: true,
  },
  pokemon: {
    game: "pokemon",
    envVar: "DATABASE_URL_POKEMON",
    displayName: "Pokémon TCG",
    active: !!process.env.DATABASE_URL_POKEMON,
  },
  mtg: {
    game: "mtg",
    envVar: "DATABASE_URL_MTG",
    displayName: "Magic: The Gathering",
    active: !!process.env.DATABASE_URL_MTG,
  },
  yugioh: {
    game: "yugioh",
    envVar: "DATABASE_URL_YUGIOH",
    displayName: "Yu-Gi-Oh!",
    active: !!process.env.DATABASE_URL_YUGIOH,
  },
  lorcana: {
    game: "lorcana",
    envVar: "DATABASE_URL_LORCANA",
    displayName: "Disney Lorcana",
    active: !!process.env.DATABASE_URL_LORCANA,
  },
  unionarena: {
    game: "unionarena",
    envVar: "DATABASE_URL_UNION_ARENA",
    displayName: "Union Arena",
    active: !!process.env.DATABASE_URL_UNION_ARENA,
  },
};

/**
 * Default shard for queries that don't specify a game.
 */
export const DEFAULT_SHARD: GameShard = "onepiece";

/**
 * Connection pool configuration per shard.
 */
const POOL_CONFIG = {
  connectionLimit: parseInt(process.env.DATABASE_CONNECTION_LIMIT || "3"),
  connectTimeout: parseInt(process.env.DATABASE_CONNECT_TIMEOUT || "10000"),
  poolTimeout: parseInt(process.env.DATABASE_POOL_TIMEOUT || "10000"),
};

// ============================================================================
// Global Shard Client Storage
// ============================================================================

declare global {
  // eslint-disable-next-line no-var
  var shardClients: Map<GameShard, PrismaClient> | undefined;
}

// Initialize global shard client map
if (!global.shardClients) {
  global.shardClients = new Map();
}

// ============================================================================
// Shard Client Management
// ============================================================================

/**
 * Build database URL with connection pool parameters.
 */
function buildShardUrl(baseUrl: string): string {
  try {
    const url = new URL(baseUrl);
    if (!url.searchParams.has("connection_limit")) {
      url.searchParams.set("connection_limit", POOL_CONFIG.connectionLimit.toString());
    }
    if (!url.searchParams.has("connect_timeout")) {
      url.searchParams.set("connect_timeout", Math.floor(POOL_CONFIG.connectTimeout / 1000).toString());
    }
    if (!url.searchParams.has("pool_timeout")) {
      url.searchParams.set("pool_timeout", Math.floor(POOL_CONFIG.poolTimeout / 1000).toString());
    }
    return url.toString();
  } catch {
    // If URL parsing fails, return as-is
    return baseUrl;
  }
}

/**
 * Create a new Prisma client for a shard.
 */
function createShardClient(game: GameShard): PrismaClient | null {
  const config = SHARD_CONFIG[game];
  const dbUrl = process.env[config.envVar];

  if (!dbUrl) {
    if (game === DEFAULT_SHARD) {
      throw new Error(`${config.envVar} environment variable is required for default shard`);
    }
    return null;
  }

  console.log(`[shard] Creating client for ${config.displayName} (${game})`);

  return new PrismaClient({
    datasources: {
      db: {
        url: buildShardUrl(dbUrl),
      },
    },
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
}

/**
 * Get or create a Prisma client for the specified game shard.
 * Returns the default shard client if the game-specific shard is not configured.
 *
 * @param game - The game identifier
 * @returns PrismaClient for the shard
 */
export function getShardClient(game: GameShard = DEFAULT_SHARD): PrismaClient {
  // Check if we already have a client for this shard
  const existingClient = global.shardClients!.get(game);
  if (existingClient) {
    return existingClient;
  }

  // Try to create a new client for this shard
  const newClient = createShardClient(game);

  if (newClient) {
    global.shardClients!.set(game, newClient);
    return newClient;
  }

  // Fall back to default shard
  console.log(`[shard] No database configured for ${game}, falling back to ${DEFAULT_SHARD}`);
  return getShardClient(DEFAULT_SHARD);
}

/**
 * Execute a query on a specific shard.
 *
 * @param game - The game shard to query
 * @param query - Function that receives the Prisma client and returns a query result
 * @returns The query result
 */
export async function withShard<T>(
  game: GameShard,
  query: (prisma: PrismaClient) => Promise<T>
): Promise<T> {
  const client = getShardClient(game);
  return query(client);
}

/**
 * Execute a query across all active shards and combine results.
 *
 * @param query - Function that receives the Prisma client and game, returns a query result
 * @returns Combined results from all shards
 */
export async function withAllShards<T>(
  query: (prisma: PrismaClient, game: GameShard) => Promise<T[]>
): Promise<{ game: GameShard; results: T[] }[]> {
  const activeShards = getActiveShards();

  const results = await Promise.all(
    activeShards.map(async (game) => {
      try {
        const client = getShardClient(game);
        const results = await query(client, game);
        return { game, results };
      } catch (error) {
        console.error(`[shard] Query failed for ${game}:`, error);
        return { game, results: [] as T[] };
      }
    })
  );

  return results;
}

// ============================================================================
// Shard Discovery & Health
// ============================================================================

/**
 * Get list of all active (configured) shards.
 */
export function getActiveShards(): GameShard[] {
  return Object.values(SHARD_CONFIG)
    .filter((config) => config.active)
    .map((config) => config.game);
}

/**
 * Get list of all supported shards (including inactive).
 */
export function getAllShards(): GameShard[] {
  return Object.keys(SHARD_CONFIG) as GameShard[];
}

/**
 * Check if a game shard is active (has database configured).
 */
export function isShardActive(game: GameShard): boolean {
  return SHARD_CONFIG[game]?.active ?? false;
}

/**
 * Get the display name for a game shard.
 */
export function getShardDisplayName(game: GameShard): string {
  return SHARD_CONFIG[game]?.displayName ?? game;
}

/**
 * Check health of a specific shard.
 */
export async function checkShardHealth(game: GameShard): Promise<ShardHealth> {
  const config = SHARD_CONFIG[game];
  const startTime = Date.now();

  if (!config.active) {
    return {
      game,
      displayName: config.displayName,
      connected: false,
      latencyMs: 0,
      activeConnections: 0,
      maxConnections: 0,
      error: "Shard not configured",
    };
  }

  try {
    const client = getShardClient(game);

    // Run a simple query to check connection
    const result = await client.$queryRaw<[{ active: bigint; max: bigint }]>`
      SELECT
        (SELECT count(*) FROM pg_stat_activity WHERE state = 'active') as active,
        (SELECT setting::int FROM pg_settings WHERE name = 'max_connections') as max
    `;

    const latencyMs = Date.now() - startTime;

    return {
      game,
      displayName: config.displayName,
      connected: true,
      latencyMs,
      activeConnections: Number(result[0].active),
      maxConnections: Number(result[0].max),
    };
  } catch (error) {
    return {
      game,
      displayName: config.displayName,
      connected: false,
      latencyMs: Date.now() - startTime,
      activeConnections: 0,
      maxConnections: 0,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Check health of all active shards.
 */
export async function checkAllShardsHealth(): Promise<ShardHealth[]> {
  const activeShards = getActiveShards();
  return Promise.all(activeShards.map(checkShardHealth));
}

// ============================================================================
// Shard Routing Helpers
// ============================================================================

/**
 * Determine which shard a card belongs to based on its ID or game field.
 * Card IDs typically include a prefix indicating the game.
 */
export function routeCardToShard(cardId: string, game?: string): GameShard {
  // If game is explicitly provided, use it
  if (game) {
    const normalizedGame = game.toLowerCase() as GameShard;
    if (SHARD_CONFIG[normalizedGame]) {
      return normalizedGame;
    }
  }

  // Try to infer from card ID prefix
  const upperCardId = cardId.toUpperCase();

  // One Piece: OP01-001, ST01-001, EB01-001, etc.
  if (/^(OP|ST|EB|DON|P-)\d/.test(upperCardId)) {
    return "onepiece";
  }

  // Pokemon: swsh1-001, sv1-001, etc.
  if (/^(SWSH|SV|SM|XY|BW|DP|EX)\d/.test(upperCardId)) {
    return "pokemon";
  }

  // MTG: Set codes are typically 3 letters
  if (/^[A-Z]{3}-\d/.test(upperCardId)) {
    return "mtg";
  }

  // Yu-Gi-Oh: Various formats like LOB-001, DUEA-EN001
  if (/^[A-Z]{2,4}-[A-Z]{0,2}\d/.test(upperCardId)) {
    return "yugioh";
  }

  // Default to onepiece
  return DEFAULT_SHARD;
}

/**
 * Parse a game string into a valid GameShard.
 */
export function parseGameShard(game: string | undefined | null): GameShard {
  if (!game) return DEFAULT_SHARD;

  const normalized = game.toLowerCase().replace(/[\s-_]/g, "") as GameShard;

  // Handle common aliases
  const aliases: Record<string, GameShard> = {
    op: "onepiece",
    optcg: "onepiece",
    onepiecetcg: "onepiece",
    poke: "pokemon",
    pokemontcg: "pokemon",
    magic: "mtg",
    magicthegathering: "mtg",
    ygo: "yugioh",
    yugioh: "yugioh",
    disney: "lorcana",
    disneylorcana: "lorcana",
    ua: "unionarena",
  };

  if (aliases[normalized]) {
    return aliases[normalized];
  }

  if (SHARD_CONFIG[normalized as GameShard]) {
    return normalized as GameShard;
  }

  return DEFAULT_SHARD;
}

// ============================================================================
// Graceful Shutdown
// ============================================================================

/**
 * Disconnect all shard clients.
 * Call this during graceful shutdown.
 */
export async function disconnectAllShards(): Promise<void> {
  const disconnectPromises: Promise<void>[] = [];

  global.shardClients!.forEach((client, game) => {
    console.log(`[shard] Disconnecting ${game}...`);
    disconnectPromises.push(client.$disconnect());
  });

  await Promise.all(disconnectPromises);
  global.shardClients!.clear();
  console.log("[shard] All shards disconnected");
}

// ============================================================================
// Exports
// ============================================================================

export const shardRouter = {
  getClient: getShardClient,
  withShard,
  withAllShards,
  getActiveShards,
  getAllShards,
  isActive: isShardActive,
  getDisplayName: getShardDisplayName,
  checkHealth: checkShardHealth,
  checkAllHealth: checkAllShardsHealth,
  routeCard: routeCardToShard,
  parseGame: parseGameShard,
  disconnect: disconnectAllShards,
  config: SHARD_CONFIG,
  defaultShard: DEFAULT_SHARD,
};
