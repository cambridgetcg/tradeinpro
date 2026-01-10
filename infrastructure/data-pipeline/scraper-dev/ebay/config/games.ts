/**
 * eBay TCG Category Configuration
 *
 * Maps games to eBay category IDs and search terms.
 */

export type GameCode = 'onepiece' | 'pokemon' | 'mtg' | 'yugioh' | 'lorcana' | 'digimon';

export interface GameConfig {
  name: string;
  ebayCategory: string;
  searchTerms: string[];
  enabled: boolean;
}

/**
 * eBay category IDs:
 * - 183454: CCG Individual Cards
 * - 19107: MTG Singles
 * - 2536: Pokemon Trading Cards
 */
export const GAME_CONFIGS: Record<GameCode, GameConfig> = {
  onepiece: {
    name: 'One Piece TCG',
    ebayCategory: '183454',
    searchTerms: [
      'one piece tcg',
      'optcg',
      'one piece card game',
    ],
    enabled: true,
  },
  pokemon: {
    name: 'Pokemon TCG',
    ebayCategory: '2536',
    searchTerms: [
      'pokemon tcg',
      'pokemon card',
      'pokemon trading card',
    ],
    enabled: true,
  },
  mtg: {
    name: 'Magic: The Gathering',
    ebayCategory: '19107',
    searchTerms: [
      'mtg',
      'magic the gathering',
      'magic card',
    ],
    enabled: false, // Large volume - enable when ready
  },
  yugioh: {
    name: 'Yu-Gi-Oh!',
    ebayCategory: '183454',
    searchTerms: [
      'yugioh',
      'yu-gi-oh',
      'ygo',
    ],
    enabled: false,
  },
  lorcana: {
    name: 'Disney Lorcana',
    ebayCategory: '183454',
    searchTerms: [
      'disney lorcana',
      'lorcana tcg',
    ],
    enabled: false,
  },
  digimon: {
    name: 'Digimon TCG',
    ebayCategory: '183454',
    searchTerms: [
      'digimon tcg',
      'digimon card game',
    ],
    enabled: false,
  },
};

/**
 * Get enabled games for collection
 */
export function getEnabledGames(): GameCode[] {
  return (Object.keys(GAME_CONFIGS) as GameCode[]).filter(
    (game) => GAME_CONFIGS[game].enabled
  );
}

/**
 * Build eBay search URL with sold items filter
 */
export function buildSoldSearchUrl(
  game: GameCode,
  additionalQuery?: string
): string {
  const config = GAME_CONFIGS[game];
  const query = additionalQuery
    ? `${config.searchTerms[0]} ${additionalQuery}`
    : config.searchTerms[0];

  const params = new URLSearchParams({
    _nkw: query,
    _sacat: config.ebayCategory,
    LH_Sold: '1',
    LH_Complete: '1',
    _sop: '13', // Sort by end date (recent first)
  });

  return `https://www.ebay.com/sch/i.html?${params.toString()}`;
}

export default GAME_CONFIGS;
