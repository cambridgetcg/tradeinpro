/**
 * Generic Set Configuration
 *
 * Game-agnostic set definitions that can be extended for any TCG.
 * Includes One Piece TCG sets as the initial implementation.
 */

import type { GameCode } from './games.js';

/**
 * Generic set information (game-agnostic)
 */
export interface SetInfo {
  code: string;
  name: string;
  game: GameCode;
  releaseDate: string;
  tcgplayerSlug: string;
  cardmarketSlug?: string;
  cardCount?: number;
  isReleased: boolean;
  setType: 'booster' | 'starter' | 'promo' | 'special' | 'structure';
  metadata?: Record<string, unknown>;
}

/**
 * Set registry - stores sets for all games
 */
const SET_REGISTRY: Map<GameCode, SetInfo[]> = new Map();

/**
 * Register sets for a game
 */
export function registerSets(game: GameCode, sets: Omit<SetInfo, 'game'>[]): void {
  const gameSets = sets.map((s) => ({ ...s, game }));
  SET_REGISTRY.set(game, gameSets);
}

/**
 * Get all sets for a game
 */
export function getSetsByGame(game: GameCode): SetInfo[] {
  return SET_REGISTRY.get(game) || [];
}

/**
 * Get set by code (within a game)
 */
export function getSetByCode(game: GameCode, code: string): SetInfo | undefined {
  const sets = SET_REGISTRY.get(game) || [];
  return sets.find((s) => s.code.toUpperCase() === code.toUpperCase());
}

/**
 * Get all released sets for a game
 */
export function getReleasedSets(game: GameCode): SetInfo[] {
  return getSetsByGame(game).filter((s) => s.isReleased);
}

/**
 * Get sets by type
 */
export function getSetsByType(game: GameCode, type: SetInfo['setType']): SetInfo[] {
  return getSetsByGame(game).filter((s) => s.setType === type && s.isReleased);
}

/**
 * Build TCGplayer URL for a set
 */
export function buildTcgplayerSetUrl(set: SetInfo, gameTcgplayerName: string): string {
  return `https://www.tcgplayer.com/search/${gameTcgplayerName}/${set.tcgplayerSlug}?productLineName=${gameTcgplayerName}&setName=${set.tcgplayerSlug}&view=grid`;
}

/**
 * Build Cardmarket URL for a set
 */
export function buildCardmarketSetUrl(set: SetInfo, gameCardmarketName: string): string | null {
  if (!set.cardmarketSlug) return null;
  const cmName = gameCardmarketName.replace(/\s+/g, '-');
  return `https://www.cardmarket.com/en/${cmName}/Products/Singles/${set.cardmarketSlug}`;
}

// ============================================================================
// One Piece TCG Sets
// ============================================================================

const ONE_PIECE_BOOSTER_SETS: Omit<SetInfo, 'game'>[] = [
  { code: 'OP01', name: 'Romance Dawn', releaseDate: '2022-12-02', tcgplayerSlug: 'romance-dawn', cardmarketSlug: 'Romance-Dawn-OP01', cardCount: 121, isReleased: true, setType: 'booster' },
  { code: 'OP02', name: 'Paramount War', releaseDate: '2023-03-10', tcgplayerSlug: 'paramount-war', cardmarketSlug: 'Paramount-War-OP02', cardCount: 121, isReleased: true, setType: 'booster' },
  { code: 'OP03', name: 'Pillars of Strength', releaseDate: '2023-06-30', tcgplayerSlug: 'pillars-of-strength', cardmarketSlug: 'Pillars-of-Strength-OP03', cardCount: 121, isReleased: true, setType: 'booster' },
  { code: 'OP04', name: 'Kingdoms of Intrigue', releaseDate: '2023-09-22', tcgplayerSlug: 'kingdoms-of-intrigue', cardmarketSlug: 'Kingdoms-of-Intrigue-OP04', cardCount: 121, isReleased: true, setType: 'booster' },
  { code: 'OP05', name: 'Awakening of the New Era', releaseDate: '2023-12-08', tcgplayerSlug: 'awakening-of-the-new-era', cardmarketSlug: 'Awakening-of-the-New-Era-OP05', cardCount: 121, isReleased: true, setType: 'booster' },
  { code: 'OP06', name: 'Wings of the Captain', releaseDate: '2024-03-08', tcgplayerSlug: 'wings-of-the-captain', cardmarketSlug: 'Wings-of-the-Captain-OP06', cardCount: 121, isReleased: true, setType: 'booster' },
  { code: 'OP07', name: '500 Years in the Future', releaseDate: '2024-06-28', tcgplayerSlug: '500-years-in-the-future', cardmarketSlug: '500-Years-in-the-Future-OP07', cardCount: 121, isReleased: true, setType: 'booster' },
  { code: 'OP08', name: 'Two Legends', releaseDate: '2024-09-13', tcgplayerSlug: 'two-legends', cardmarketSlug: 'Two-Legends-OP08', cardCount: 121, isReleased: true, setType: 'booster' },
  { code: 'OP09', name: 'The Four Emperors', releaseDate: '2024-12-06', tcgplayerSlug: 'the-four-emperors', cardmarketSlug: 'The-Four-Emperors-OP09', cardCount: 121, isReleased: true, setType: 'booster' },
  { code: 'OP10', name: 'Royal Blood', releaseDate: '2025-03-07', tcgplayerSlug: 'royal-blood', cardCount: 121, isReleased: true, setType: 'booster' },
  { code: 'OP11', name: 'Great Ambition', releaseDate: '2025-06-27', tcgplayerSlug: 'great-ambition', cardCount: 121, isReleased: true, setType: 'booster' },
  { code: 'OP12', name: 'TBA', releaseDate: '2025-09-12', tcgplayerSlug: 'op-12', cardCount: 121, isReleased: false, setType: 'booster' },
  { code: 'OP13', name: 'TBA', releaseDate: '2025-12-05', tcgplayerSlug: 'op-13', cardCount: 121, isReleased: false, setType: 'booster' },
  { code: 'EB01', name: 'Memorial Collection', releaseDate: '2024-01-26', tcgplayerSlug: 'memorial-collection', cardmarketSlug: 'Extra-Booster-Memorial-Collection-EB01', cardCount: 67, isReleased: true, setType: 'special' },
  { code: 'EB02', name: 'Anime 25th Collection', releaseDate: '2025-06-27', tcgplayerSlug: 'anime-25th-collection', cardCount: 67, isReleased: true, setType: 'special' },
];

const ONE_PIECE_STARTER_DECKS: Omit<SetInfo, 'game'>[] = [
  { code: 'ST01', name: 'Straw Hat Crew', releaseDate: '2022-12-02', tcgplayerSlug: 'straw-hat-crew', cardCount: 51, isReleased: true, setType: 'starter' },
  { code: 'ST02', name: 'Worst Generation', releaseDate: '2022-12-02', tcgplayerSlug: 'worst-generation', cardCount: 51, isReleased: true, setType: 'starter' },
  { code: 'ST03', name: 'The Seven Warlords of the Sea', releaseDate: '2022-12-02', tcgplayerSlug: 'seven-warlords-of-the-sea', cardCount: 51, isReleased: true, setType: 'starter' },
  { code: 'ST04', name: 'Animal Kingdom Pirates', releaseDate: '2022-12-02', tcgplayerSlug: 'animal-kingdom-pirates', cardCount: 51, isReleased: true, setType: 'starter' },
  { code: 'ST05', name: 'ONE PIECE FILM edition', releaseDate: '2023-03-10', tcgplayerSlug: 'film-edition', cardCount: 51, isReleased: true, setType: 'starter' },
  { code: 'ST06', name: 'Absolute Justice', releaseDate: '2023-06-30', tcgplayerSlug: 'absolute-justice', cardCount: 51, isReleased: true, setType: 'starter' },
  { code: 'ST07', name: 'Big Mom Pirates', releaseDate: '2023-06-30', tcgplayerSlug: 'big-mom-pirates', cardCount: 51, isReleased: true, setType: 'starter' },
  { code: 'ST08', name: 'Monkey.D.Luffy', releaseDate: '2023-09-22', tcgplayerSlug: 'monkey-d-luffy', cardCount: 51, isReleased: true, setType: 'starter' },
  { code: 'ST09', name: 'Yamato', releaseDate: '2023-09-22', tcgplayerSlug: 'yamato', cardCount: 51, isReleased: true, setType: 'starter' },
  { code: 'ST10', name: 'The Three Captains', releaseDate: '2023-12-08', tcgplayerSlug: 'three-captains', cardCount: 51, isReleased: true, setType: 'starter' },
  { code: 'ST11', name: 'Uta', releaseDate: '2024-03-08', tcgplayerSlug: 'uta', cardCount: 51, isReleased: true, setType: 'starter' },
  { code: 'ST12', name: 'Zoro and Sanji', releaseDate: '2024-03-08', tcgplayerSlug: 'zoro-and-sanji', cardCount: 51, isReleased: true, setType: 'starter' },
  { code: 'ST13', name: 'The Three Brothers', releaseDate: '2024-06-28', tcgplayerSlug: 'three-brothers', cardCount: 51, isReleased: true, setType: 'starter' },
  { code: 'ST14', name: '3D2Y', releaseDate: '2024-09-13', tcgplayerSlug: '3d2y', cardCount: 51, isReleased: true, setType: 'starter' },
  { code: 'ST15', name: 'RED Edward.Newgate', releaseDate: '2024-09-13', tcgplayerSlug: 'red-edward-newgate', cardCount: 51, isReleased: true, setType: 'starter' },
  { code: 'ST16', name: 'GREEN Uta', releaseDate: '2024-09-13', tcgplayerSlug: 'green-uta', cardCount: 51, isReleased: true, setType: 'starter' },
  { code: 'ST17', name: 'BLUE Donquixote Doflamingo', releaseDate: '2024-12-06', tcgplayerSlug: 'blue-donquixote-doflamingo', cardCount: 51, isReleased: true, setType: 'starter' },
  { code: 'ST18', name: 'PURPLE Monkey.D.Luffy', releaseDate: '2024-12-06', tcgplayerSlug: 'purple-monkey-d-luffy', cardCount: 51, isReleased: true, setType: 'starter' },
  { code: 'ST19', name: 'BLACK Smoker', releaseDate: '2024-12-06', tcgplayerSlug: 'black-smoker', cardCount: 51, isReleased: true, setType: 'starter' },
  { code: 'ST20', name: 'YELLOW Charlotte Katakuri', releaseDate: '2024-12-06', tcgplayerSlug: 'yellow-charlotte-katakuri', cardCount: 51, isReleased: true, setType: 'starter' },
  { code: 'ST21', name: 'Gear 5', releaseDate: '2025-06-27', tcgplayerSlug: 'gear-5', cardCount: 51, isReleased: true, setType: 'starter' },
];

const ONE_PIECE_PROMO_SETS: Omit<SetInfo, 'game'>[] = [
  { code: 'P01', name: 'Promos', releaseDate: '2022-12-02', tcgplayerSlug: 'promos', cardCount: 100, isReleased: true, setType: 'promo' },
  { code: 'DON', name: 'DON!! Cards', releaseDate: '2022-12-02', tcgplayerSlug: 'don-cards', cardCount: 50, isReleased: true, setType: 'promo' },
];

// Register One Piece sets
registerSets('onepiece', [
  ...ONE_PIECE_BOOSTER_SETS,
  ...ONE_PIECE_STARTER_DECKS,
  ...ONE_PIECE_PROMO_SETS,
]);

// ============================================================================
// Variant Type Detection (Game-Agnostic)
// ============================================================================

/**
 * Common variant keywords across games
 */
export const VARIANT_KEYWORDS: Record<string, string[]> = {
  // One Piece
  parallel: ['parallel', 'alternate art', 'aa'],
  sp: ['sp', 'special'],
  manga: ['manga', 'comic'],
  spr: ['spr', 'special rare'],
  tr: ['tr', 'treasure rare'],
  boxtopper: ['box topper', 'boxtopper'],
  wantedposter: ['wanted poster'],
  dashpack: ['dash pack'],

  // Pokemon
  holo: ['holo', 'holographic'],
  'reverse-holo': ['reverse holo', 'reverse'],
  'full-art': ['full art', 'full-art'],
  'secret-rare': ['secret rare', 'secret'],
  'first-edition': ['1st edition', 'first edition', '1st ed'],

  // MTG
  foil: ['foil'],
  'extended-art': ['extended art', 'extended'],
  borderless: ['borderless'],
  showcase: ['showcase'],
  'retro-frame': ['retro frame', 'old frame', 'retro'],
  etched: ['etched', 'foil etched'],

  // Yu-Gi-Oh
  starlight: ['starlight', 'starlight rare'],
  ghost: ['ghost', 'ghost rare'],
  ultimate: ['ultimate', 'ultimate rare'],
  prismatic: ['prismatic', 'prismatic secret'],

  // Generic
  promo: ['promo', 'promotional'],
  limited: ['limited', 'limited edition'],
};

/**
 * Detect variant type from text
 */
export function detectVariantType(text: string): string | null {
  const lower = text.toLowerCase();

  for (const [type, keywords] of Object.entries(VARIANT_KEYWORDS)) {
    for (const keyword of keywords) {
      if (lower.includes(keyword)) {
        return type;
      }
    }
  }

  return null;
}

// ============================================================================
// Legacy exports for backward compatibility
// ============================================================================

/** @deprecated Use getSetsByGame('onepiece') instead */
export const ALL_SETS = getSetsByGame('onepiece');

/** @deprecated Use getSetsByType('onepiece', 'booster') instead */
export const BOOSTER_SETS = getSetsByType('onepiece', 'booster');

/** @deprecated Use getSetsByType('onepiece', 'starter') instead */
export const STARTER_DECKS = getSetsByType('onepiece', 'starter');

/** @deprecated Use getSetsByType('onepiece', 'promo') instead */
export const PROMO_SETS = getSetsByType('onepiece', 'promo');

export type VariantType = keyof typeof VARIANT_KEYWORDS;
