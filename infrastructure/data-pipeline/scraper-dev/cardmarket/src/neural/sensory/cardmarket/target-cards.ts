/**
 * CardMarket Target Card Registry
 *
 * The Sacred Catalogue of One Piece TCG cards to scrape from CardMarket.
 * Prioritized by value tier and data gap criticality.
 *
 * @see docs/CARDMARKET_ALCHEMIST_GRIMOIRE.md
 */

// =============================================================================
// TYPES
// =============================================================================

export type PriorityTier = 'legendary' | 'epic' | 'rare' | 'common';

export type VariantType =
  | 'standard'
  | 'parallel'
  | 'manga'
  | 'sp'
  | 'sec'
  | 'leader'
  | 'boxtopper'
  | 'alt_art'
  | 'promo';

export interface CardMarketTarget {
  cardId: string;
  name: string;
  character: string;
  setCode: string;
  setName: string;
  variant: VariantType;
  tier: PriorityTier;
  estimatedValueEur: number;
  scrapePriority: number; // 1-10
  urlSlug: string; // CardMarket URL path segment
  isCriticalGap: boolean;
  notes?: string;
}

export interface SetInfo {
  code: string;
  name: string;
  urlSlug: string;
  releaseDate: string;
  cardCount: number;
}

// =============================================================================
// SET DEFINITIONS
// =============================================================================

export const ONE_PIECE_SETS: SetInfo[] = [
  { code: 'OP01', name: 'Romance Dawn', urlSlug: 'Romance-Dawn', releaseDate: '2022-12-02', cardCount: 121 },
  { code: 'OP02', name: 'Paramount War', urlSlug: 'Paramount-War', releaseDate: '2023-03-10', cardCount: 121 },
  { code: 'OP03', name: 'Pillars of Strength', urlSlug: 'Pillars-of-Strength', releaseDate: '2023-06-30', cardCount: 122 },
  { code: 'OP04', name: 'Kingdoms of Intrigue', urlSlug: 'Kingdoms-of-Intrigue', releaseDate: '2023-09-22', cardCount: 121 },
  { code: 'OP05', name: 'Awakening of the New Era', urlSlug: 'Awakening-of-the-New-Era', releaseDate: '2023-12-08', cardCount: 121 },
  { code: 'OP06', name: 'Wings of the Captain', urlSlug: 'Wings-of-the-Captain', releaseDate: '2024-03-15', cardCount: 121 },
  { code: 'OP07', name: '500 Years in the Future', urlSlug: '500-Years-in-the-Future', releaseDate: '2024-06-28', cardCount: 121 },
  { code: 'OP08', name: 'Two Legends', urlSlug: 'Two-Legends', releaseDate: '2024-09-27', cardCount: 121 },
  { code: 'OP09', name: 'The Four Emperors', urlSlug: 'The-Four-Emperors', releaseDate: '2024-12-06', cardCount: 121 },
  { code: 'OP10', name: 'Royal Blood', urlSlug: 'Royal-Blood', releaseDate: '2025-03-14', cardCount: 121 },
  { code: 'EB01', name: 'Memorial Collection', urlSlug: 'Extra-Booster-Memorial-Collection', releaseDate: '2023-08-25', cardCount: 63 },
  { code: 'EB02', name: 'Extra Booster', urlSlug: 'Extra-Booster', releaseDate: '2024-02-23', cardCount: 63 },
];

// =============================================================================
// LEGENDARY TIER (€50+)
// =============================================================================

const LEGENDARY_CARDS: CardMarketTarget[] = [
  // Shanks - The Flagship
  {
    cardId: 'OP01-120',
    name: 'Shanks',
    character: 'Shanks',
    setCode: 'OP01',
    setName: 'Romance Dawn',
    variant: 'parallel',
    tier: 'legendary',
    estimatedValueEur: 150,
    scrapePriority: 10,
    urlSlug: 'Shanks-OP01-120-V2',
    isCriticalGap: false,
  },
  {
    cardId: 'OP01-120',
    name: 'Shanks (Manga)',
    character: 'Shanks',
    setCode: 'OP01',
    setName: 'Romance Dawn',
    variant: 'manga',
    tier: 'legendary',
    estimatedValueEur: 200,
    scrapePriority: 10,
    urlSlug: 'Shanks-OP01-120-Manga',
    isCriticalGap: true,
    notes: 'CRITICAL: 0 training images',
  },

  // Yamato - The Oni Princess
  {
    cardId: 'OP06-118',
    name: 'Yamato',
    character: 'Yamato',
    setCode: 'OP06',
    setName: 'Wings of the Captain',
    variant: 'parallel',
    tier: 'legendary',
    estimatedValueEur: 100,
    scrapePriority: 10,
    urlSlug: 'Yamato-OP06-118-V2',
    isCriticalGap: false,
  },
  {
    cardId: 'OP06-118',
    name: 'Yamato (Manga)',
    character: 'Yamato',
    setCode: 'OP06',
    setName: 'Wings of the Captain',
    variant: 'manga',
    tier: 'legendary',
    estimatedValueEur: 180,
    scrapePriority: 10,
    urlSlug: 'Yamato-OP06-118-Manga',
    isCriticalGap: true,
    notes: 'CRITICAL: 0 training images',
  },

  // Luffy Gear 5
  {
    cardId: 'OP05-119',
    name: 'Monkey D. Luffy (Gear 5)',
    character: 'Luffy',
    setCode: 'OP05',
    setName: 'Awakening of the New Era',
    variant: 'sec',
    tier: 'legendary',
    estimatedValueEur: 250,
    scrapePriority: 10,
    urlSlug: 'Monkey-D-Luffy-OP05-119',
    isCriticalGap: false,
  },

  // Nami
  {
    cardId: 'OP03-040',
    name: 'Nami',
    character: 'Nami',
    setCode: 'OP03',
    setName: 'Pillars of Strength',
    variant: 'parallel',
    tier: 'legendary',
    estimatedValueEur: 80,
    scrapePriority: 9,
    urlSlug: 'Nami-OP03-040-V2',
    isCriticalGap: false,
  },
  {
    cardId: 'OP01-016',
    name: 'Nami (Leader)',
    character: 'Nami',
    setCode: 'OP01',
    setName: 'Romance Dawn',
    variant: 'leader',
    tier: 'legendary',
    estimatedValueEur: 120,
    scrapePriority: 9,
    urlSlug: 'Nami-OP01-016-V2',
    isCriticalGap: true,
    notes: 'Leader alt art - only 50 images',
  },

  // Boa Hancock
  {
    cardId: 'OP01-078',
    name: 'Boa Hancock',
    character: 'Boa Hancock',
    setCode: 'OP01',
    setName: 'Romance Dawn',
    variant: 'parallel',
    tier: 'legendary',
    estimatedValueEur: 90,
    scrapePriority: 9,
    urlSlug: 'Boa-Hancock-OP01-078-V2',
    isCriticalGap: false,
  },

  // Law
  {
    cardId: 'OP01-047',
    name: 'Trafalgar Law',
    character: 'Law',
    setCode: 'OP01',
    setName: 'Romance Dawn',
    variant: 'parallel',
    tier: 'legendary',
    estimatedValueEur: 70,
    scrapePriority: 9,
    urlSlug: 'Trafalgar-Law-OP01-047-V2',
    isCriticalGap: false,
  },

  // Kaido
  {
    cardId: 'OP04-044',
    name: 'Kaido',
    character: 'Kaido',
    setCode: 'OP04',
    setName: 'Kingdoms of Intrigue',
    variant: 'sec',
    tier: 'legendary',
    estimatedValueEur: 100,
    scrapePriority: 9,
    urlSlug: 'Kaido-OP04-044',
    isCriticalGap: false,
  },

  // Ace
  {
    cardId: 'OP02-013',
    name: 'Portgas D. Ace',
    character: 'Ace',
    setCode: 'OP02',
    setName: 'Paramount War',
    variant: 'parallel',
    tier: 'legendary',
    estimatedValueEur: 85,
    scrapePriority: 9,
    urlSlug: 'Portgas-D-Ace-OP02-013-V2',
    isCriticalGap: false,
  },
  {
    cardId: 'OP02-013',
    name: 'Portgas D. Ace (Manga)',
    character: 'Ace',
    setCode: 'OP02',
    setName: 'Paramount War',
    variant: 'manga',
    tier: 'legendary',
    estimatedValueEur: 160,
    scrapePriority: 10,
    urlSlug: 'Portgas-D-Ace-OP02-013-Manga',
    isCriticalGap: true,
    notes: 'CRITICAL: Manga variant',
  },
];

// =============================================================================
// EPIC TIER (€20-50)
// =============================================================================

const EPIC_CARDS: CardMarketTarget[] = [
  // Zoro
  {
    cardId: 'OP01-025',
    name: 'Roronoa Zoro',
    character: 'Zoro',
    setCode: 'OP01',
    setName: 'Romance Dawn',
    variant: 'parallel',
    tier: 'epic',
    estimatedValueEur: 40,
    scrapePriority: 7,
    urlSlug: 'Roronoa-Zoro-OP01-025-V2',
    isCriticalGap: false,
  },

  // Sanji
  {
    cardId: 'OP03-034',
    name: 'Sanji',
    character: 'Sanji',
    setCode: 'OP03',
    setName: 'Pillars of Strength',
    variant: 'parallel',
    tier: 'epic',
    estimatedValueEur: 35,
    scrapePriority: 7,
    urlSlug: 'Sanji-OP03-034-V2',
    isCriticalGap: false,
  },

  // Crocodile
  {
    cardId: 'OP04-064',
    name: 'Crocodile',
    character: 'Crocodile',
    setCode: 'OP04',
    setName: 'Kingdoms of Intrigue',
    variant: 'sec',
    tier: 'epic',
    estimatedValueEur: 42,
    scrapePriority: 7,
    urlSlug: 'Crocodile-OP04-064',
    isCriticalGap: false,
  },

  // Doflamingo
  {
    cardId: 'OP04-031',
    name: 'Donquixote Doflamingo',
    character: 'Doflamingo',
    setCode: 'OP04',
    setName: 'Kingdoms of Intrigue',
    variant: 'parallel',
    tier: 'epic',
    estimatedValueEur: 38,
    scrapePriority: 7,
    urlSlug: 'Donquixote-Doflamingo-OP04-031-V2',
    isCriticalGap: false,
  },

  // Katakuri
  {
    cardId: 'OP03-123',
    name: 'Charlotte Katakuri',
    character: 'Katakuri',
    setCode: 'OP03',
    setName: 'Pillars of Strength',
    variant: 'sec',
    tier: 'epic',
    estimatedValueEur: 35,
    scrapePriority: 6,
    urlSlug: 'Charlotte-Katakuri-OP03-123',
    isCriticalGap: false,
  },

  // Whitebeard Leader
  {
    cardId: 'OP02-004',
    name: 'Edward Newgate (Leader)',
    character: 'Whitebeard',
    setCode: 'OP02',
    setName: 'Paramount War',
    variant: 'leader',
    tier: 'epic',
    estimatedValueEur: 45,
    scrapePriority: 8,
    urlSlug: 'Edward-Newgate-OP02-004-V2',
    isCriticalGap: true,
    notes: 'Leader alt art gap',
  },

  // Kid
  {
    cardId: 'OP05-074',
    name: 'Eustass Kid',
    character: 'Eustass Kid',
    setCode: 'OP05',
    setName: 'Awakening of the New Era',
    variant: 'sec',
    tier: 'epic',
    estimatedValueEur: 28,
    scrapePriority: 6,
    urlSlug: 'Eustass-Kid-OP05-074',
    isCriticalGap: false,
  },

  // Sabo
  {
    cardId: 'OP04-083',
    name: 'Sabo',
    character: 'Sabo',
    setCode: 'OP04',
    setName: 'Kingdoms of Intrigue',
    variant: 'parallel',
    tier: 'epic',
    estimatedValueEur: 30,
    scrapePriority: 6,
    urlSlug: 'Sabo-OP04-083-V2',
    isCriticalGap: false,
  },
];

// =============================================================================
// RARE TIER (€10-20)
// =============================================================================

const RARE_CARDS: CardMarketTarget[] = [
  // Robin
  {
    cardId: 'OP01-017',
    name: 'Nico Robin',
    character: 'Robin',
    setCode: 'OP01',
    setName: 'Romance Dawn',
    variant: 'parallel',
    tier: 'rare',
    estimatedValueEur: 18,
    scrapePriority: 5,
    urlSlug: 'Nico-Robin-OP01-017-V2',
    isCriticalGap: false,
  },

  // Chopper
  {
    cardId: 'OP01-015',
    name: 'Tony Tony Chopper',
    character: 'Chopper',
    setCode: 'OP01',
    setName: 'Romance Dawn',
    variant: 'parallel',
    tier: 'rare',
    estimatedValueEur: 15,
    scrapePriority: 5,
    urlSlug: 'Tony-Tony-Chopper-OP01-015-V2',
    isCriticalGap: false,
  },

  // EB01 Yamato
  {
    cardId: 'EB01-061',
    name: 'Yamato (EB01)',
    character: 'Yamato',
    setCode: 'EB01',
    setName: 'Memorial Collection',
    variant: 'parallel',
    tier: 'rare',
    estimatedValueEur: 15,
    scrapePriority: 5,
    urlSlug: 'Yamato-EB01-061-V2',
    isCriticalGap: false,
  },

  // EB02 Shanks
  {
    cardId: 'EB02-024',
    name: 'Shanks (EB02)',
    character: 'Shanks',
    setCode: 'EB02',
    setName: 'Extra Booster',
    variant: 'parallel',
    tier: 'rare',
    estimatedValueEur: 12,
    scrapePriority: 5,
    urlSlug: 'Shanks-EB02-024-V2',
    isCriticalGap: false,
  },
];

// =============================================================================
// BOX TOPPERS (CRITICAL GAP)
// =============================================================================

const BOX_TOPPERS: CardMarketTarget[] = [
  {
    cardId: 'OP01-024-BT',
    name: 'Luffy Box Topper',
    character: 'Luffy',
    setCode: 'OP01',
    setName: 'Romance Dawn',
    variant: 'boxtopper',
    tier: 'epic',
    estimatedValueEur: 60,
    scrapePriority: 8,
    urlSlug: 'Monkey-D-Luffy-OP01-024-Box-Topper',
    isCriticalGap: true,
    notes: 'Box topper - only 30 images',
  },
  {
    cardId: 'OP02-004-BT',
    name: 'Whitebeard Box Topper',
    character: 'Whitebeard',
    setCode: 'OP02',
    setName: 'Paramount War',
    variant: 'boxtopper',
    tier: 'epic',
    estimatedValueEur: 55,
    scrapePriority: 8,
    urlSlug: 'Edward-Newgate-OP02-004-Box-Topper',
    isCriticalGap: true,
    notes: 'Box topper critical gap',
  },
];

// =============================================================================
// LEADER ALT ARTS (CRITICAL GAP)
// =============================================================================

const LEADER_ALT_ARTS: CardMarketTarget[] = [
  {
    cardId: 'OP01-001',
    name: 'Luffy Leader',
    character: 'Luffy',
    setCode: 'OP01',
    setName: 'Romance Dawn',
    variant: 'leader',
    tier: 'epic',
    estimatedValueEur: 35,
    scrapePriority: 8,
    urlSlug: 'Monkey-D-Luffy-OP01-001-V2',
    isCriticalGap: true,
  },
  {
    cardId: 'OP02-001',
    name: 'Big Mom Leader',
    character: 'Big Mom',
    setCode: 'OP02',
    setName: 'Paramount War',
    variant: 'leader',
    tier: 'epic',
    estimatedValueEur: 30,
    scrapePriority: 8,
    urlSlug: 'Charlotte-Linlin-OP02-001-V2',
    isCriticalGap: true,
  },
  {
    cardId: 'OP03-001',
    name: 'Katakuri Leader',
    character: 'Katakuri',
    setCode: 'OP03',
    setName: 'Pillars of Strength',
    variant: 'leader',
    tier: 'epic',
    estimatedValueEur: 28,
    scrapePriority: 8,
    urlSlug: 'Charlotte-Katakuri-OP03-001-V2',
    isCriticalGap: true,
  },
  {
    cardId: 'OP04-001',
    name: 'Blackbeard Leader',
    character: 'Blackbeard',
    setCode: 'OP04',
    setName: 'Kingdoms of Intrigue',
    variant: 'leader',
    tier: 'epic',
    estimatedValueEur: 32,
    scrapePriority: 8,
    urlSlug: 'Marshall-D-Teach-OP04-001-V2',
    isCriticalGap: true,
  },
  {
    cardId: 'OP05-001',
    name: 'Gear 5 Luffy Leader',
    character: 'Luffy',
    setCode: 'OP05',
    setName: 'Awakening of the New Era',
    variant: 'leader',
    tier: 'legendary',
    estimatedValueEur: 80,
    scrapePriority: 9,
    urlSlug: 'Monkey-D-Luffy-OP05-001-V2',
    isCriticalGap: true,
  },
  {
    cardId: 'OP06-001',
    name: 'Yamato Leader',
    character: 'Yamato',
    setCode: 'OP06',
    setName: 'Wings of the Captain',
    variant: 'leader',
    tier: 'epic',
    estimatedValueEur: 45,
    scrapePriority: 8,
    urlSlug: 'Yamato-OP06-001-V2',
    isCriticalGap: true,
  },
];

// =============================================================================
// COMBINED REGISTRY
// =============================================================================

export const ALL_CARDMARKET_TARGETS: CardMarketTarget[] = [
  ...LEGENDARY_CARDS,
  ...EPIC_CARDS,
  ...RARE_CARDS,
  ...BOX_TOPPERS,
  ...LEADER_ALT_ARTS,
];

// =============================================================================
// REGISTRY CLASS
// =============================================================================

export class CardMarketTargetRegistry {
  private targets: Map<string, CardMarketTarget[]>;
  private byCharacter: Map<string, CardMarketTarget[]>;
  private byTier: Map<PriorityTier, CardMarketTarget[]>;
  private bySet: Map<string, CardMarketTarget[]>;

  constructor() {
    this.targets = new Map();
    this.byCharacter = new Map();
    this.byTier = new Map();
    this.bySet = new Map();

    this.indexTargets();
  }

  private indexTargets(): void {
    for (const target of ALL_CARDMARKET_TARGETS) {
      // Index by cardId
      const existing = this.targets.get(target.cardId) || [];
      existing.push(target);
      this.targets.set(target.cardId, existing);

      // Index by character
      const charTargets = this.byCharacter.get(target.character) || [];
      charTargets.push(target);
      this.byCharacter.set(target.character, charTargets);

      // Index by tier
      const tierTargets = this.byTier.get(target.tier) || [];
      tierTargets.push(target);
      this.byTier.set(target.tier, tierTargets);

      // Index by set
      const setTargets = this.bySet.get(target.setCode) || [];
      setTargets.push(target);
      this.bySet.set(target.setCode, setTargets);
    }
  }

  getByCardId(cardId: string): CardMarketTarget[] {
    return this.targets.get(cardId) || [];
  }

  getByCharacter(character: string): CardMarketTarget[] {
    return this.byCharacter.get(character) || [];
  }

  getByTier(tier: PriorityTier): CardMarketTarget[] {
    return this.byTier.get(tier) || [];
  }

  getBySet(setCode: string): CardMarketTarget[] {
    return this.bySet.get(setCode) || [];
  }

  getByPriority(): CardMarketTarget[] {
    return [...ALL_CARDMARKET_TARGETS].sort((a, b) => b.scrapePriority - a.scrapePriority);
  }

  getCriticalGaps(): CardMarketTarget[] {
    return ALL_CARDMARKET_TARGETS.filter((t) => t.isCriticalGap);
  }

  getSetInfo(setCode: string): SetInfo | undefined {
    return ONE_PIECE_SETS.find((s) => s.code === setCode);
  }

  getAllSets(): SetInfo[] {
    return ONE_PIECE_SETS;
  }

  getStats(): RegistryStats {
    const legendary = this.getByTier('legendary');
    const epic = this.getByTier('epic');
    const rare = this.getByTier('rare');
    const criticalGaps = this.getCriticalGaps();

    return {
      totalTargets: ALL_CARDMARKET_TARGETS.length,
      legendary: legendary.length,
      epic: epic.length,
      rare: rare.length,
      criticalGaps: criticalGaps.length,
      uniqueCards: this.targets.size,
      uniqueCharacters: this.byCharacter.size,
      setsRepresented: this.bySet.size,
    };
  }

  printSummary(): void {
    const stats = this.getStats();
    console.log('\n🎴 CARDMARKET TARGET REGISTRY');
    console.log('═'.repeat(50));
    console.log(`  Total targets: ${stats.totalTargets}`);
    console.log(`  Legendary (€50+): ${stats.legendary}`);
    console.log(`  Epic (€20-50): ${stats.epic}`);
    console.log(`  Rare (€10-20): ${stats.rare}`);
    console.log(`  Critical gaps: ${stats.criticalGaps}`);
    console.log(`  Unique cards: ${stats.uniqueCards}`);
    console.log(`  Characters: ${stats.uniqueCharacters}`);
    console.log(`  Sets: ${stats.setsRepresented}`);
    console.log('═'.repeat(50));
  }
}

// =============================================================================
// TYPES
// =============================================================================

interface RegistryStats {
  totalTargets: number;
  legendary: number;
  epic: number;
  rare: number;
  criticalGaps: number;
  uniqueCards: number;
  uniqueCharacters: number;
  setsRepresented: number;
}

// =============================================================================
// SINGLETON
// =============================================================================

export const cardMarketTargetRegistry = new CardMarketTargetRegistry();
