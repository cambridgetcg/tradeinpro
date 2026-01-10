/**
 * One Piece TCG Set Configuration
 *
 * Maps set codes to Cardmarket expansion names and metadata
 */

export interface SetConfig {
  code: string;
  cardmarketName: string;
  releaseDate: string;
  cardCount: number;
  type: 'booster' | 'starter' | 'extra' | 'promo';
}

export const ONEPIECE_SETS: Record<string, SetConfig> = {
  // Main Booster Sets
  OP01: {
    code: 'OP01',
    cardmarketName: 'Romance-Dawn',
    releaseDate: '2022-07-08',
    cardCount: 127,
    type: 'booster',
  },
  OP02: {
    code: 'OP02',
    cardmarketName: 'Paramount-War',
    releaseDate: '2022-10-21',
    cardCount: 127,
    type: 'booster',
  },
  OP03: {
    code: 'OP03',
    cardmarketName: 'Pillars-of-Strength',
    releaseDate: '2023-01-27',
    cardCount: 127,
    type: 'booster',
  },
  OP04: {
    code: 'OP04',
    cardmarketName: 'Kingdoms-of-Intrigue',
    releaseDate: '2023-05-26',
    cardCount: 127,
    type: 'booster',
  },
  OP05: {
    code: 'OP05',
    cardmarketName: 'Awakening-of-the-New-Era',
    releaseDate: '2023-08-25',
    cardCount: 127,
    type: 'booster',
  },
  OP06: {
    code: 'OP06',
    cardmarketName: 'Wings-of-the-Captain',
    releaseDate: '2023-11-24',
    cardCount: 127,
    type: 'booster',
  },
  OP07: {
    code: 'OP07',
    cardmarketName: '500-Years-in-the-Future',
    releaseDate: '2024-02-23',
    cardCount: 127,
    type: 'booster',
  },
  OP08: {
    code: 'OP08',
    cardmarketName: 'Two-Legends',
    releaseDate: '2024-05-31',
    cardCount: 127,
    type: 'booster',
  },
  OP09: {
    code: 'OP09',
    cardmarketName: 'The-Four-Emperors',
    releaseDate: '2024-08-30',
    cardCount: 127,
    type: 'booster',
  },
  OP10: {
    code: 'OP10',
    cardmarketName: 'Royal-Blood',
    releaseDate: '2024-11-29',
    cardCount: 127,
    type: 'booster',
  },
  OP11: {
    code: 'OP11',
    cardmarketName: 'Uta',
    releaseDate: '2025-02-28',
    cardCount: 127,
    type: 'booster',
  },

  // Extra Booster Sets
  EB01: {
    code: 'EB01',
    cardmarketName: 'Memorial-Collection',
    releaseDate: '2023-12-08',
    cardCount: 72,
    type: 'extra',
  },
  EB02: {
    code: 'EB02',
    cardmarketName: 'Extra-Booster-Anime-25th',
    releaseDate: '2024-09-27',
    cardCount: 72,
    type: 'extra',
  },

  // Starter Decks
  ST01: {
    code: 'ST01',
    cardmarketName: 'Straw-Hat-Crew',
    releaseDate: '2022-07-08',
    cardCount: 17,
    type: 'starter',
  },
  ST02: {
    code: 'ST02',
    cardmarketName: 'Worst-Generation',
    releaseDate: '2022-07-08',
    cardCount: 17,
    type: 'starter',
  },
  ST03: {
    code: 'ST03',
    cardmarketName: 'The-Seven-Warlords-of-the-Sea',
    releaseDate: '2022-07-08',
    cardCount: 17,
    type: 'starter',
  },
  ST04: {
    code: 'ST04',
    cardmarketName: 'Animal-Kingdom-Pirates',
    releaseDate: '2022-07-08',
    cardCount: 17,
    type: 'starter',
  },
  ST05: {
    code: 'ST05',
    cardmarketName: 'ONE-PIECE-FILM-edition',
    releaseDate: '2022-10-21',
    cardCount: 17,
    type: 'starter',
  },
  ST06: {
    code: 'ST06',
    cardmarketName: 'Navy-Absolute-Justice',
    releaseDate: '2022-10-21',
    cardCount: 17,
    type: 'starter',
  },
  ST07: {
    code: 'ST07',
    cardmarketName: 'Big-Mom-Pirates',
    releaseDate: '2023-01-27',
    cardCount: 17,
    type: 'starter',
  },
  ST08: {
    code: 'ST08',
    cardmarketName: 'Monkey-D-Luffy',
    releaseDate: '2023-01-27',
    cardCount: 17,
    type: 'starter',
  },
  ST09: {
    code: 'ST09',
    cardmarketName: 'Yamato',
    releaseDate: '2023-05-26',
    cardCount: 17,
    type: 'starter',
  },
  ST10: {
    code: 'ST10',
    cardmarketName: 'The-Three-Captains',
    releaseDate: '2023-05-26',
    cardCount: 17,
    type: 'starter',
  },
  ST11: {
    code: 'ST11',
    cardmarketName: 'Uta',
    releaseDate: '2023-08-25',
    cardCount: 17,
    type: 'starter',
  },
  ST12: {
    code: 'ST12',
    cardmarketName: 'Zoro-and-Sanji',
    releaseDate: '2023-11-24',
    cardCount: 17,
    type: 'starter',
  },
  ST13: {
    code: 'ST13',
    cardmarketName: 'The-Three-Brothers',
    releaseDate: '2024-02-23',
    cardCount: 17,
    type: 'starter',
  },
  ST14: {
    code: 'ST14',
    cardmarketName: '3D2Y',
    releaseDate: '2024-05-31',
    cardCount: 17,
    type: 'starter',
  },
  ST15: {
    code: 'ST15',
    cardmarketName: 'RED-Edward-Newgate',
    releaseDate: '2024-05-31',
    cardCount: 17,
    type: 'starter',
  },
  ST16: {
    code: 'ST16',
    cardmarketName: 'GREEN-Uta',
    releaseDate: '2024-05-31',
    cardCount: 17,
    type: 'starter',
  },
  ST17: {
    code: 'ST17',
    cardmarketName: 'BLUE-Donquixote-Doflamingo',
    releaseDate: '2024-08-30',
    cardCount: 17,
    type: 'starter',
  },
  ST18: {
    code: 'ST18',
    cardmarketName: 'PURPLE-Monkey-D-Luffy',
    releaseDate: '2024-08-30',
    cardCount: 17,
    type: 'starter',
  },
  ST19: {
    code: 'ST19',
    cardmarketName: 'BLACK-Smoker',
    releaseDate: '2024-11-29',
    cardCount: 17,
    type: 'starter',
  },
  ST20: {
    code: 'ST20',
    cardmarketName: 'YELLOW-Charlotte-Katakuri',
    releaseDate: '2024-11-29',
    cardCount: 17,
    type: 'starter',
  },
};

/**
 * Get all booster set codes
 */
export function getBoosterSets(): string[] {
  return Object.entries(ONEPIECE_SETS)
    .filter(([, config]) => config.type === 'booster')
    .map(([code]) => code);
}

/**
 * Get all set codes by type
 */
export function getSetsByType(type: SetConfig['type']): string[] {
  return Object.entries(ONEPIECE_SETS)
    .filter(([, config]) => config.type === type)
    .map(([code]) => code);
}

/**
 * Get Cardmarket URL-friendly expansion name
 */
export function getCardmarketExpansionName(setCode: string): string | null {
  const set = ONEPIECE_SETS[setCode.toUpperCase()];
  return set?.cardmarketName ?? null;
}

/**
 * Get set config by code
 */
export function getSetConfig(setCode: string): SetConfig | null {
  return ONEPIECE_SETS[setCode.toUpperCase()] ?? null;
}
