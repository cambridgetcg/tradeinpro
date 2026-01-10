/**
 * The Sacred Target Card Registry
 *
 * Contains the Philosopher's Stones (£50+) and Silver Ingots (£20-50)
 * that guide our SerpAPI queries toward the most valuable specimens.
 *
 * Priority Tiers:
 *   - LEGENDARY: Philosopher's Stones - highest value targets
 *   - EPIC: Silver Ingots - significant value targets
 *   - RARE: Rising Stars - emerging value cards
 *   - COMMON: Base variants - standard collection
 *
 * @see docs/SERPAPI_ALCHEMIST_GRIMOIRE.md
 */

// =============================================================================
// TYPES
// =============================================================================

export type PriorityTier = 'legendary' | 'epic' | 'rare' | 'common';

export interface TargetCard {
  cardId: string;
  name: string;
  character: string;
  variant: VariantType;
  tier: PriorityTier;
  estimatedValueGbp: number;
  queryPriority: number; // 1-10, higher = more frequent queries
  aliases: string[]; // Alternative search terms
  notes?: string;
}

export type VariantType =
  | 'parallel'
  | 'sp'
  | 'sec'
  | 'manga'
  | 'leader'
  | 'boxtopper'
  | 'wantedposter'
  | 'promo'
  | 'standard';

export interface QueryTarget {
  cardId: string;
  queries: string[];
  tier: PriorityTier;
  priority: number;
}

// =============================================================================
// PHILOSOPHER'S STONES (£50+)
// =============================================================================

const PHILOSOPHERS_STONES: TargetCard[] = [
  // === SHANKS - The Red-Haired Emperor ===
  {
    cardId: 'OP01-120',
    name: 'Shanks (Parallel)',
    character: 'Shanks',
    variant: 'parallel',
    tier: 'legendary',
    estimatedValueGbp: 180,
    queryPriority: 10,
    aliases: ['red hair shanks alt art', 'shanks AA', 'shanks alternate art'],
    notes: 'Flagship chase card of OP01',
  },
  {
    cardId: 'OP01-120',
    name: 'Shanks (Manga)',
    character: 'Shanks',
    variant: 'manga',
    tier: 'legendary',
    estimatedValueGbp: 250,
    queryPriority: 10,
    aliases: ['shanks manga art', 'shanks manga rare'],
    notes: 'Extremely rare manga variant',
  },
  {
    cardId: 'OP05-SP-OP01-120',
    name: 'Shanks SP (OP05)',
    character: 'Shanks',
    variant: 'sp',
    tier: 'legendary',
    estimatedValueGbp: 85,
    queryPriority: 9,
    aliases: ['shanks special art', 'shanks SP'],
  },

  // === YAMATO - The Oni Princess ===
  {
    cardId: 'OP06-118',
    name: 'Yamato (Parallel)',
    character: 'Yamato',
    variant: 'parallel',
    tier: 'legendary',
    estimatedValueGbp: 120,
    queryPriority: 10,
    aliases: ['yamato alt art', 'yamato AA', 'yamato alternate'],
  },
  {
    cardId: 'OP06-118',
    name: 'Yamato (Manga)',
    character: 'Yamato',
    variant: 'manga',
    tier: 'legendary',
    estimatedValueGbp: 200,
    queryPriority: 10,
    aliases: ['yamato manga art', 'yamato manga rare'],
    notes: 'CRITICAL GAP: 0 images in training data',
  },

  // === NAMI - The Navigator ===
  {
    cardId: 'OP03-040',
    name: 'Nami (Parallel)',
    character: 'Nami',
    variant: 'parallel',
    tier: 'legendary',
    estimatedValueGbp: 95,
    queryPriority: 9,
    aliases: ['nami alt art', 'nami AA', 'nami parallel'],
  },
  {
    cardId: 'OP01-016',
    name: 'Nami (Leader Parallel)',
    character: 'Nami',
    variant: 'leader',
    tier: 'legendary',
    estimatedValueGbp: 150,
    queryPriority: 10,
    aliases: ['nami leader alt art', 'nami leader AA'],
    notes: 'Leader alt arts are highly sought',
  },

  // === LUFFY - The Future Pirate King ===
  {
    cardId: 'OP05-119',
    name: 'Luffy Gear 5 (SEC)',
    character: 'Luffy',
    variant: 'sec',
    tier: 'legendary',
    estimatedValueGbp: 280,
    queryPriority: 10,
    aliases: ['gear 5 luffy', 'luffy gear fifth', 'nika luffy SEC'],
    notes: 'Most iconic card in OP05',
  },
  {
    cardId: 'OP01-024',
    name: 'Luffy (Box Topper)',
    character: 'Luffy',
    variant: 'boxtopper',
    tier: 'legendary',
    estimatedValueGbp: 75,
    queryPriority: 8,
    aliases: ['luffy box topper', 'luffy promo box'],
    notes: 'GAP: Only 30 images in training data',
  },

  // === ACE - The Fire Fist ===
  {
    cardId: 'OP02-013',
    name: 'Portgas D. Ace (Manga)',
    character: 'Ace',
    variant: 'manga',
    tier: 'legendary',
    estimatedValueGbp: 180,
    queryPriority: 10,
    aliases: ['ace manga art', 'fire fist ace manga'],
    notes: 'CRITICAL GAP: Manga variants need data',
  },

  // === BOA HANCOCK - The Pirate Empress ===
  {
    cardId: 'OP01-078',
    name: 'Boa Hancock (Parallel)',
    character: 'Boa Hancock',
    variant: 'parallel',
    tier: 'legendary',
    estimatedValueGbp: 110,
    queryPriority: 9,
    aliases: ['hancock alt art', 'boa hancock AA', 'pirate empress'],
  },

  // === LAW - The Surgeon of Death ===
  {
    cardId: 'OP01-047',
    name: 'Trafalgar Law (Parallel)',
    character: 'Law',
    variant: 'parallel',
    tier: 'legendary',
    estimatedValueGbp: 85,
    queryPriority: 9,
    aliases: ['law alt art', 'trafalgar law AA', 'surgeon of death'],
  },

  // === KAIDO - The King of Beasts ===
  {
    cardId: 'OP04-044',
    name: 'Kaido (SEC)',
    character: 'Kaido',
    variant: 'sec',
    tier: 'legendary',
    estimatedValueGbp: 120,
    queryPriority: 9,
    aliases: ['kaido secret rare', 'kaido SEC', 'king of beasts'],
  },
];

// =============================================================================
// SILVER INGOTS (£20-50)
// =============================================================================

const SILVER_INGOTS: TargetCard[] = [
  // === ZORO ===
  {
    cardId: 'OP01-025',
    name: 'Roronoa Zoro (Parallel)',
    character: 'Zoro',
    variant: 'parallel',
    tier: 'epic',
    estimatedValueGbp: 45,
    queryPriority: 7,
    aliases: ['zoro alt art', 'zoro AA', 'roronoa zoro parallel'],
  },
  {
    cardId: 'OP06-SP-OP01-025',
    name: 'Roronoa Zoro SP (OP06)',
    character: 'Zoro',
    variant: 'sp',
    tier: 'epic',
    estimatedValueGbp: 35,
    queryPriority: 6,
    aliases: ['zoro special art', 'zoro SP'],
  },

  // === SANJI ===
  {
    cardId: 'OP03-034',
    name: 'Sanji (Parallel)',
    character: 'Sanji',
    variant: 'parallel',
    tier: 'epic',
    estimatedValueGbp: 40,
    queryPriority: 7,
    aliases: ['sanji alt art', 'sanji AA', 'black leg sanji'],
  },

  // === ROBIN ===
  {
    cardId: 'OP01-017',
    name: 'Nico Robin (Parallel)',
    character: 'Robin',
    variant: 'parallel',
    tier: 'epic',
    estimatedValueGbp: 38,
    queryPriority: 7,
    aliases: ['robin alt art', 'nico robin AA'],
  },

  // === CROCODILE ===
  {
    cardId: 'OP04-064',
    name: 'Crocodile (SEC)',
    character: 'Crocodile',
    variant: 'sec',
    tier: 'epic',
    estimatedValueGbp: 48,
    queryPriority: 7,
    aliases: ['crocodile secret rare', 'sir crocodile SEC'],
  },

  // === DOFLAMINGO ===
  {
    cardId: 'OP04-031',
    name: 'Donquixote Doflamingo (Parallel)',
    character: 'Doflamingo',
    variant: 'parallel',
    tier: 'epic',
    estimatedValueGbp: 42,
    queryPriority: 7,
    aliases: ['doflamingo alt art', 'doffy AA', 'joker parallel'],
  },

  // === KATAKURI ===
  {
    cardId: 'OP03-123',
    name: 'Charlotte Katakuri (SEC)',
    character: 'Katakuri',
    variant: 'sec',
    tier: 'epic',
    estimatedValueGbp: 35,
    queryPriority: 6,
    aliases: ['katakuri secret rare', 'katakuri SEC'],
  },

  // === WHITEBEARD ===
  {
    cardId: 'OP02-004',
    name: 'Edward Newgate (Leader Parallel)',
    character: 'Whitebeard',
    variant: 'leader',
    tier: 'epic',
    estimatedValueGbp: 50,
    queryPriority: 8,
    aliases: ['whitebeard leader alt', 'edward newgate AA'],
    notes: 'GAP: Leader alt arts need more data',
  },

  // === EUSTASS KID ===
  {
    cardId: 'OP05-074',
    name: 'Eustass Kid (SEC)',
    character: 'Eustass Kid',
    variant: 'sec',
    tier: 'epic',
    estimatedValueGbp: 30,
    queryPriority: 6,
    aliases: ['kid secret rare', 'eustass kid SEC', 'captain kid'],
  },

  // === CHOPPER ===
  {
    cardId: 'OP01-015',
    name: 'Tony Tony Chopper (Parallel)',
    character: 'Chopper',
    variant: 'parallel',
    tier: 'epic',
    estimatedValueGbp: 28,
    queryPriority: 5,
    aliases: ['chopper alt art', 'chopper AA', 'cotton candy lover'],
  },

  // === SABO ===
  {
    cardId: 'OP04-083',
    name: 'Sabo (Parallel)',
    character: 'Sabo',
    variant: 'parallel',
    tier: 'epic',
    estimatedValueGbp: 32,
    queryPriority: 6,
    aliases: ['sabo alt art', 'sabo AA', 'flame emperor'],
  },
];

// =============================================================================
// RISING STARS (£10-20) - Cards gaining value
// =============================================================================

const RISING_STARS: TargetCard[] = [
  {
    cardId: 'EB01-061',
    name: 'Yamato (EB01)',
    character: 'Yamato',
    variant: 'parallel',
    tier: 'rare',
    estimatedValueGbp: 18,
    queryPriority: 5,
    aliases: ['yamato extra booster', 'yamato EB01'],
  },
  {
    cardId: 'EB02-024',
    name: 'Shanks (EB02)',
    character: 'Shanks',
    variant: 'parallel',
    tier: 'rare',
    estimatedValueGbp: 15,
    queryPriority: 5,
    aliases: ['shanks extra booster 2', 'shanks EB02'],
  },
  {
    cardId: 'ST13-003',
    name: 'Monkey D. Luffy (ST13)',
    character: 'Luffy',
    variant: 'parallel',
    tier: 'rare',
    estimatedValueGbp: 12,
    queryPriority: 4,
    aliases: ['luffy starter 13', 'luffy ST13 parallel'],
  },
];

// =============================================================================
// CRITICAL GAPS (Need Training Data)
// =============================================================================

/**
 * Cards identified with insufficient training images.
 * These should be prioritized for data collection.
 */
export const CRITICAL_GAPS = {
  manga: {
    description: 'Manga art variants - 0 images in training data',
    priority: 'CRITICAL',
    targets: ['OP01-120', 'OP06-118', 'OP02-013', 'OP03-040'],
  },
  boxtopper: {
    description: 'Box topper promos - only 30 images',
    priority: 'HIGH',
    targets: ['OP01-024', 'OP02-004', 'OP03-040'],
  },
  leaderAltArt: {
    description: 'Leader alternate arts - only 50 images',
    priority: 'HIGH',
    targets: ['OP01-016', 'OP02-004', 'OP04-001', 'OP05-001'],
  },
  wantedPoster: {
    description: 'Wanted poster variants - limited data',
    priority: 'MEDIUM',
    targets: ['OP01-003', 'OP02-001'],
  },
};

// =============================================================================
// COMBINED REGISTRY
// =============================================================================

export const ALL_TARGET_CARDS: TargetCard[] = [
  ...PHILOSOPHERS_STONES,
  ...SILVER_INGOTS,
  ...RISING_STARS,
];

// =============================================================================
// REGISTRY CLASS
// =============================================================================

export class TargetCardRegistry {
  private cards: Map<string, TargetCard[]>;
  private byCharacter: Map<string, TargetCard[]>;
  private byTier: Map<PriorityTier, TargetCard[]>;

  constructor() {
    this.cards = new Map();
    this.byCharacter = new Map();
    this.byTier = new Map();

    this.indexCards();
  }

  private indexCards(): void {
    for (const card of ALL_TARGET_CARDS) {
      // Index by cardId (can have multiple variants per cardId)
      const existing = this.cards.get(card.cardId) || [];
      existing.push(card);
      this.cards.set(card.cardId, existing);

      // Index by character
      const charCards = this.byCharacter.get(card.character) || [];
      charCards.push(card);
      this.byCharacter.set(card.character, charCards);

      // Index by tier
      const tierCards = this.byTier.get(card.tier) || [];
      tierCards.push(card);
      this.byTier.set(card.tier, tierCards);
    }
  }

  /**
   * Get all variants for a card ID
   */
  getByCardId(cardId: string): TargetCard[] {
    return this.cards.get(cardId) || [];
  }

  /**
   * Get all cards for a character
   */
  getByCharacter(character: string): TargetCard[] {
    return this.byCharacter.get(character) || [];
  }

  /**
   * Get all cards in a tier
   */
  getByTier(tier: PriorityTier): TargetCard[] {
    return this.byTier.get(tier) || [];
  }

  /**
   * Get cards sorted by query priority (highest first)
   */
  getByPriority(): TargetCard[] {
    return [...ALL_TARGET_CARDS].sort((a, b) => b.queryPriority - a.queryPriority);
  }

  /**
   * Get cards that need critical data collection
   */
  getCriticalGaps(): TargetCard[] {
    const criticalCardIds = new Set([
      ...CRITICAL_GAPS.manga.targets,
      ...CRITICAL_GAPS.boxtopper.targets,
      ...CRITICAL_GAPS.leaderAltArt.targets,
    ]);

    return ALL_TARGET_CARDS.filter((card) => criticalCardIds.has(card.cardId));
  }

  /**
   * Check if a card ID is a target
   */
  isTarget(cardId: string): boolean {
    return this.cards.has(cardId);
  }

  /**
   * Get target tier for a card
   */
  getTier(cardId: string, variant?: VariantType): PriorityTier | null {
    const cards = this.cards.get(cardId);
    if (!cards) return null;

    if (variant) {
      const match = cards.find((c) => c.variant === variant);
      return match?.tier || null;
    }

    // Return highest tier if no variant specified
    const tiers: PriorityTier[] = ['legendary', 'epic', 'rare', 'common'];
    for (const tier of tiers) {
      if (cards.some((c) => c.tier === tier)) {
        return tier;
      }
    }

    return null;
  }

  /**
   * Generate query targets for SerpAPI
   */
  generateQueryTargets(): QueryTarget[] {
    const targets: QueryTarget[] = [];

    for (const card of ALL_TARGET_CARDS) {
      // Build search queries
      const queries: string[] = [
        // Primary query: cardId + variant
        `One Piece TCG ${card.cardId} ${card.variant}`,
        // Character + variant query
        `One Piece Card ${card.character} ${card.variant}`,
        // With aliases
        ...card.aliases.map((alias) => `One Piece Card ${alias}`),
      ];

      targets.push({
        cardId: card.cardId,
        queries,
        tier: card.tier,
        priority: card.queryPriority,
      });
    }

    return targets;
  }

  /**
   * Get query schedule based on priority
   * Returns cards to query at each time slot
   */
  getQuerySchedule(): { morning: TargetCard[]; midday: TargetCard[]; evening: TargetCard[] } {
    const legendary = this.getByTier('legendary');
    const epic = this.getByTier('epic');
    const rare = this.getByTier('rare');

    return {
      // Morning (08:00): All legendary + half epic
      morning: [...legendary, ...epic.slice(0, Math.ceil(epic.length / 2))],
      // Midday (12:00): All legendary + other half epic
      midday: [...legendary, ...epic.slice(Math.ceil(epic.length / 2))],
      // Evening (18:00): All cards including rare
      evening: [...legendary, ...epic, ...rare],
    };
  }

  /**
   * Get statistics about the registry
   */
  getStats(): RegistryStats {
    const legendary = this.getByTier('legendary');
    const epic = this.getByTier('epic');
    const rare = this.getByTier('rare');

    const totalValue = ALL_TARGET_CARDS.reduce((sum, c) => sum + c.estimatedValueGbp, 0);

    return {
      totalCards: ALL_TARGET_CARDS.length,
      legendary: legendary.length,
      epic: epic.length,
      rare: rare.length,
      uniqueCardIds: this.cards.size,
      uniqueCharacters: this.byCharacter.size,
      estimatedTotalValueGbp: totalValue,
      criticalGaps: Object.keys(CRITICAL_GAPS).length,
    };
  }

  /**
   * Print registry summary
   */
  printSummary(): void {
    const stats = this.getStats();
    console.log('\n🎯 TARGET CARD REGISTRY');
    console.log('═'.repeat(50));
    console.log(`  Total targets: ${stats.totalCards}`);
    console.log(`  Legendary (£50+): ${stats.legendary}`);
    console.log(`  Epic (£20-50): ${stats.epic}`);
    console.log(`  Rare (£10-20): ${stats.rare}`);
    console.log(`  Unique card IDs: ${stats.uniqueCardIds}`);
    console.log(`  Unique characters: ${stats.uniqueCharacters}`);
    console.log(`  Estimated total value: £${stats.estimatedTotalValueGbp}`);
    console.log(`  Critical data gaps: ${stats.criticalGaps}`);
    console.log('═'.repeat(50));
  }
}

// =============================================================================
// TYPES
// =============================================================================

interface RegistryStats {
  totalCards: number;
  legendary: number;
  epic: number;
  rare: number;
  uniqueCardIds: number;
  uniqueCharacters: number;
  estimatedTotalValueGbp: number;
  criticalGaps: number;
}

// =============================================================================
// SINGLETON INSTANCE
// =============================================================================

export const targetCardRegistry = new TargetCardRegistry();
