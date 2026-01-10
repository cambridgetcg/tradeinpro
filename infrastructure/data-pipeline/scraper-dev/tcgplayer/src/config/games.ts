/**
 * Multi-Game Configuration
 *
 * Defines supported trading card games and their data sources.
 * Extensible framework for adding new games.
 */

/**
 * Supported trading card games
 */
export type GameCode =
  | 'onepiece'
  | 'pokemon'
  | 'mtg'
  | 'yugioh'
  | 'lorcana'
  | 'flesh-and-blood'
  | 'digimon'
  | 'union-arena'
  | 'weiss-schwarz'
  | 'dragonball-super'
  | 'star-wars-unlimited'
  | 'custom';

/**
 * Data source types available for games
 */
export type DataSourceType =
  | 'tcgplayer-api'      // Official TCGplayer API (if available)
  | 'tcgplayer-scraper'  // Direct TCGplayer scraping
  | 'cardmarket-scraper' // Cardmarket scraping (EU prices)
  | 'game-api'           // Game-specific API (e.g., OPTCG, Pokemon TCG API)
  | 'third-party-api'    // Third-party aggregators (JustTCG, etc.)
  | 'custom';

/**
 * Game-specific API configuration
 */
export interface GameApiConfig {
  type: DataSourceType;
  name: string;
  baseUrl: string;
  apiKey?: string;
  requiresAuth: boolean;
  rateLimit: {
    requestsPerMinute: number;
    requestsPerDay?: number;
  };
  capabilities: {
    search: boolean;
    priceHistory: boolean;
    bulkExport: boolean;
    realtime: boolean;
  };
}

/**
 * Game configuration
 */
export interface GameConfig {
  code: GameCode;
  name: string;
  tcgplayerName: string;           // Name used in TCGplayer URLs
  tcgplayerProductLineId?: number; // TCGplayer internal ID
  cardmarketName?: string;         // Name used in Cardmarket (if applicable)
  currency: {
    primary: 'USD' | 'EUR' | 'GBP';
    supported: ('USD' | 'EUR' | 'GBP')[];
  };
  dataSources: GameApiConfig[];
  setPattern?: RegExp;             // Pattern to validate set codes
  cardIdPattern?: RegExp;          // Pattern to validate card IDs
  variantTypes: string[];          // Game-specific variant types
  enabled: boolean;
}

/**
 * Supported games registry
 */
export const SUPPORTED_GAMES: GameConfig[] = [
  {
    code: 'onepiece',
    name: 'One Piece Card Game',
    tcgplayerName: 'one-piece-card-game',
    tcgplayerProductLineId: 2532,
    cardmarketName: 'One Piece',
    currency: { primary: 'USD', supported: ['USD', 'EUR', 'GBP'] },
    dataSources: [
      {
        type: 'game-api',
        name: 'OPTCG API',
        baseUrl: 'https://api.optcgapi.com/api',
        requiresAuth: false,
        rateLimit: { requestsPerMinute: 60, requestsPerDay: 5000 },
        capabilities: { search: true, priceHistory: false, bulkExport: true, realtime: false },
      },
      {
        type: 'tcgplayer-scraper',
        name: 'TCGplayer Scraper',
        baseUrl: 'https://www.tcgplayer.com',
        requiresAuth: false,
        rateLimit: { requestsPerMinute: 5 },
        capabilities: { search: true, priceHistory: false, bulkExport: false, realtime: true },
      },
    ],
    setPattern: /^(OP|ST|EB|P|DON)\d{2}$/i,
    cardIdPattern: /^(OP|ST|EB|P|DON)\d{2}-\d{3}(-[a-z]+)?$/i,
    variantTypes: ['parallel', 'sp', 'manga', 'spr', 'tr', 'boxtopper', 'wantedposter', 'dashpack'],
    enabled: true,
  },
  {
    code: 'pokemon',
    name: 'Pokemon TCG',
    tcgplayerName: 'pokemon',
    tcgplayerProductLineId: 3,
    cardmarketName: 'Pokemon',
    currency: { primary: 'USD', supported: ['USD', 'EUR', 'GBP'] },
    dataSources: [
      {
        type: 'game-api',
        name: 'Pokemon TCG API',
        baseUrl: 'https://api.pokemontcg.io/v2',
        requiresAuth: false,
        rateLimit: { requestsPerMinute: 30, requestsPerDay: 20000 },
        capabilities: { search: true, priceHistory: false, bulkExport: true, realtime: false },
      },
      {
        type: 'tcgplayer-scraper',
        name: 'TCGplayer Scraper',
        baseUrl: 'https://www.tcgplayer.com',
        requiresAuth: false,
        rateLimit: { requestsPerMinute: 5 },
        capabilities: { search: true, priceHistory: false, bulkExport: false, realtime: true },
      },
    ],
    setPattern: /^[A-Z]{2,4}\d*$/i,
    variantTypes: ['holo', 'reverse-holo', 'full-art', 'secret-rare', 'promo', 'first-edition'],
    enabled: true,
  },
  {
    code: 'mtg',
    name: 'Magic: The Gathering',
    tcgplayerName: 'magic',
    tcgplayerProductLineId: 1,
    cardmarketName: 'Magic',
    currency: { primary: 'USD', supported: ['USD', 'EUR', 'GBP'] },
    dataSources: [
      {
        type: 'game-api',
        name: 'Scryfall API',
        baseUrl: 'https://api.scryfall.com',
        requiresAuth: false,
        rateLimit: { requestsPerMinute: 10 }, // Very strict
        capabilities: { search: true, priceHistory: false, bulkExport: true, realtime: false },
      },
      {
        type: 'tcgplayer-scraper',
        name: 'TCGplayer Scraper',
        baseUrl: 'https://www.tcgplayer.com',
        requiresAuth: false,
        rateLimit: { requestsPerMinute: 5 },
        capabilities: { search: true, priceHistory: false, bulkExport: false, realtime: true },
      },
    ],
    variantTypes: ['foil', 'extended-art', 'borderless', 'showcase', 'retro-frame', 'etched'],
    enabled: true,
  },
  {
    code: 'yugioh',
    name: 'Yu-Gi-Oh!',
    tcgplayerName: 'yugioh',
    tcgplayerProductLineId: 2,
    cardmarketName: 'Yu-Gi-Oh!',
    currency: { primary: 'USD', supported: ['USD', 'EUR', 'GBP'] },
    dataSources: [
      {
        type: 'game-api',
        name: 'YGOProDeck API',
        baseUrl: 'https://db.ygoprodeck.com/api/v7',
        requiresAuth: false,
        rateLimit: { requestsPerMinute: 20 },
        capabilities: { search: true, priceHistory: false, bulkExport: true, realtime: false },
      },
      {
        type: 'tcgplayer-scraper',
        name: 'TCGplayer Scraper',
        baseUrl: 'https://www.tcgplayer.com',
        requiresAuth: false,
        rateLimit: { requestsPerMinute: 5 },
        capabilities: { search: true, priceHistory: false, bulkExport: false, realtime: true },
      },
    ],
    variantTypes: ['1st-edition', 'unlimited', 'starlight', 'ghost', 'ultimate', 'prismatic'],
    enabled: true,
  },
  {
    code: 'lorcana',
    name: 'Disney Lorcana',
    tcgplayerName: 'disney-lorcana',
    tcgplayerProductLineId: 2956,
    currency: { primary: 'USD', supported: ['USD', 'EUR', 'GBP'] },
    dataSources: [
      {
        type: 'tcgplayer-scraper',
        name: 'TCGplayer Scraper',
        baseUrl: 'https://www.tcgplayer.com',
        requiresAuth: false,
        rateLimit: { requestsPerMinute: 5 },
        capabilities: { search: true, priceHistory: false, bulkExport: false, realtime: true },
      },
    ],
    variantTypes: ['foil', 'enchanted', 'promo'],
    enabled: true,
  },
  {
    code: 'flesh-and-blood',
    name: 'Flesh and Blood',
    tcgplayerName: 'flesh-and-blood-tcg',
    tcgplayerProductLineId: 2558,
    cardmarketName: 'Flesh and Blood',
    currency: { primary: 'USD', supported: ['USD', 'EUR', 'GBP'] },
    dataSources: [
      {
        type: 'tcgplayer-scraper',
        name: 'TCGplayer Scraper',
        baseUrl: 'https://www.tcgplayer.com',
        requiresAuth: false,
        rateLimit: { requestsPerMinute: 5 },
        capabilities: { search: true, priceHistory: false, bulkExport: false, realtime: true },
      },
    ],
    variantTypes: ['cold-foil', 'rainbow-foil', 'extended-art', 'marvel'],
    enabled: true,
  },
  {
    code: 'digimon',
    name: 'Digimon Card Game',
    tcgplayerName: 'digimon-card-game',
    tcgplayerProductLineId: 2649,
    cardmarketName: 'Digimon Card Game',
    currency: { primary: 'USD', supported: ['USD', 'EUR', 'GBP'] },
    dataSources: [
      {
        type: 'tcgplayer-scraper',
        name: 'TCGplayer Scraper',
        baseUrl: 'https://www.tcgplayer.com',
        requiresAuth: false,
        rateLimit: { requestsPerMinute: 5 },
        capabilities: { search: true, priceHistory: false, bulkExport: false, realtime: true },
      },
    ],
    variantTypes: ['parallel', 'alternative-art', 'box-topper'],
    enabled: true,
  },
  {
    code: 'star-wars-unlimited',
    name: 'Star Wars: Unlimited',
    tcgplayerName: 'star-wars-unlimited',
    tcgplayerProductLineId: 3082,
    currency: { primary: 'USD', supported: ['USD', 'EUR', 'GBP'] },
    dataSources: [
      {
        type: 'tcgplayer-scraper',
        name: 'TCGplayer Scraper',
        baseUrl: 'https://www.tcgplayer.com',
        requiresAuth: false,
        rateLimit: { requestsPerMinute: 5 },
        capabilities: { search: true, priceHistory: false, bulkExport: false, realtime: true },
      },
    ],
    variantTypes: ['foil', 'hyperspace', 'showcase'],
    enabled: true,
  },
  {
    code: 'union-arena',
    name: 'Union Arena',
    tcgplayerName: 'union-arena',
    tcgplayerProductLineId: 2880,
    currency: { primary: 'USD', supported: ['USD', 'EUR', 'GBP'] },
    dataSources: [
      {
        type: 'tcgplayer-scraper',
        name: 'TCGplayer Scraper',
        baseUrl: 'https://www.tcgplayer.com',
        requiresAuth: false,
        rateLimit: { requestsPerMinute: 5 },
        capabilities: { search: true, priceHistory: false, bulkExport: false, realtime: true },
      },
    ],
    variantTypes: ['parallel', 'sp'],
    enabled: false, // Enable when ready
  },
  {
    code: 'weiss-schwarz',
    name: 'Weiss Schwarz',
    tcgplayerName: 'weiss-schwarz',
    tcgplayerProductLineId: 15,
    currency: { primary: 'USD', supported: ['USD', 'EUR', 'GBP'] },
    dataSources: [
      {
        type: 'tcgplayer-scraper',
        name: 'TCGplayer Scraper',
        baseUrl: 'https://www.tcgplayer.com',
        requiresAuth: false,
        rateLimit: { requestsPerMinute: 5 },
        capabilities: { search: true, priceHistory: false, bulkExport: false, realtime: true },
      },
    ],
    variantTypes: ['sp', 'ssp', 'ssr', 'sec'],
    enabled: false,
  },
  {
    code: 'dragonball-super',
    name: 'Dragon Ball Super Card Game',
    tcgplayerName: 'dragon-ball-super-ccg',
    tcgplayerProductLineId: 2165,
    currency: { primary: 'USD', supported: ['USD', 'EUR', 'GBP'] },
    dataSources: [
      {
        type: 'tcgplayer-scraper',
        name: 'TCGplayer Scraper',
        baseUrl: 'https://www.tcgplayer.com',
        requiresAuth: false,
        rateLimit: { requestsPerMinute: 5 },
        capabilities: { search: true, priceHistory: false, bulkExport: false, realtime: true },
      },
    ],
    variantTypes: ['spr', 'scr', 'signature'],
    enabled: false,
  },
];

/**
 * Get game configuration by code
 */
export function getGameConfig(code: GameCode): GameConfig | undefined {
  return SUPPORTED_GAMES.find((g) => g.code === code);
}

/**
 * Get all enabled games
 */
export function getEnabledGames(): GameConfig[] {
  return SUPPORTED_GAMES.filter((g) => g.enabled);
}

/**
 * Get games with a specific data source type
 */
export function getGamesByDataSource(sourceType: DataSourceType): GameConfig[] {
  return SUPPORTED_GAMES.filter((g) =>
    g.enabled && g.dataSources.some((ds) => ds.type === sourceType)
  );
}

/**
 * Get primary data source for a game
 */
export function getPrimaryDataSource(code: GameCode): GameApiConfig | undefined {
  const game = getGameConfig(code);
  return game?.dataSources[0];
}

/**
 * Build TCGplayer search URL for a game
 */
export function buildTcgplayerGameUrl(game: GameConfig, setSlug?: string): string {
  let url = `https://www.tcgplayer.com/search/${game.tcgplayerName}`;
  if (setSlug) {
    url += `/${setSlug}`;
  }
  url += `?productLineName=${game.tcgplayerName}&view=grid`;
  return url;
}

/**
 * Build Cardmarket search URL for a game (if supported)
 */
export function buildCardmarketGameUrl(game: GameConfig, setSlug?: string): string | null {
  if (!game.cardmarketName) return null;

  const cmName = game.cardmarketName.replace(/\s+/g, '-');
  let url = `https://www.cardmarket.com/en/${cmName}/Products/Singles`;
  if (setSlug) {
    url += `/${setSlug}`;
  }
  return url;
}

/**
 * Register a custom game configuration
 */
export function registerCustomGame(config: Omit<GameConfig, 'code'> & { code?: string }): GameConfig {
  const gameConfig: GameConfig = {
    ...config,
    code: (config.code as GameCode) || 'custom',
  };

  // Check if already exists
  const existing = SUPPORTED_GAMES.findIndex((g) => g.code === gameConfig.code);
  if (existing >= 0) {
    SUPPORTED_GAMES[existing] = gameConfig;
  } else {
    SUPPORTED_GAMES.push(gameConfig);
  }

  return gameConfig;
}
