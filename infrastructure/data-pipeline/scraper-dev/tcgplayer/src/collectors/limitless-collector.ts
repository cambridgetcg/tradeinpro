/**
 * Limitless TCG Tournament Collector
 *
 * Collects tournament results and decklists from Limitless TCG.
 * Used for the Meta model to predict price spikes from tournament performance.
 *
 * API Documentation: https://docs.limitlesstcg.com/developer.html
 *
 * Cost: Free (requires API key)
 * Supported games: Pokemon, One Piece, Digimon, Dragon Ball, Lorcana, and more
 */

import type { GameCode } from '../config/games.js';

/**
 * Limitless collector configuration
 */
export interface LimitlessConfig {
  apiKey: string;
  baseUrl?: string;
}

/**
 * Tournament data
 */
export interface Tournament {
  id: string;
  name: string;
  game: string;
  date: Date;
  format: string;
  playerCount: number;
  country?: string;
  city?: string;
  organizer?: string;
  isOnline: boolean;
}

/**
 * Tournament standing/placement
 */
export interface TournamentStanding {
  tournamentId: string;
  playerId: string;
  playerName: string;
  placement: number;
  record?: string; // e.g., "7-2-0"
  decklistId?: string;
}

/**
 * Decklist data
 */
export interface Decklist {
  id: string;
  tournamentId: string;
  playerId: string;
  playerName: string;
  placement: number;
  archetype: string;
  cards: DeckCard[];
}

/**
 * Card in a decklist
 */
export interface DeckCard {
  cardId: string;
  cardName: string;
  setCode: string;
  cardNumber: string;
  quantity: number;
  isMainDeck: boolean;
}

/**
 * Meta share statistics for a card
 */
export interface CardMetaStats {
  cardId: string;
  cardName: string;
  game: GameCode;
  period: {
    startDate: Date;
    endDate: Date;
    days: number;
  };
  deckCount: number;
  top8Count: number;
  top4Count: number;
  winnerCount: number;
  totalTournaments: number;
  deckInclusionRate: number;
  top8Rate: number;
  avgCopiesPerDeck: number;
  archetypeDiversity: number;
  winRate?: number;
}

/**
 * Limitless API error
 */
export class LimitlessApiError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public endpoint: string
  ) {
    super(message);
    this.name = 'LimitlessApiError';
  }
}

/**
 * Limitless TCG Collector
 */
export class LimitlessCollector {
  private apiKey: string;
  private baseUrl: string;

  // Game code mapping (Limitless uses different codes)
  private readonly GAME_MAPPING: Record<GameCode, string> = {
    onepiece: 'onepiece',
    pokemon: 'pokemon',
    digimon: 'digimon',
    'dragon-ball': 'dbs',
    lorcana: 'lorcana',
    mtg: '', // Not supported
    yugioh: '', // Not supported
    'flesh-and-blood': '', // Not supported
  };

  constructor(config: LimitlessConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || 'https://api.limitlesstcg.com';
  }

  /**
   * Make authenticated request to Limitless API
   */
  private async request<T>(endpoint: string, params?: Record<string, string>): Promise<T> {
    const url = new URL(`${this.baseUrl}${endpoint}`);
    url.searchParams.set('key', this.apiKey);

    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        url.searchParams.set(key, value);
      });
    }

    const response = await fetch(url.toString(), {
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      throw new LimitlessApiError(
        `API request failed: ${response.statusText}`,
        response.status,
        endpoint
      );
    }

    return response.json() as Promise<T>;
  }

  /**
   * Check if game is supported by Limitless
   */
  isGameSupported(game: GameCode): boolean {
    return !!this.GAME_MAPPING[game];
  }

  /**
   * Get recent tournaments for a game
   */
  async getTournaments(
    game: GameCode,
    options: {
      days?: number;
      limit?: number;
      format?: string;
    } = {}
  ): Promise<Tournament[]> {
    const limitlessGame = this.GAME_MAPPING[game];
    if (!limitlessGame) {
      throw new Error(`Game ${game} is not supported by Limitless TCG`);
    }

    const days = options.days || 30;
    const limit = options.limit || 100;

    interface TournamentResponse {
      tournaments: Array<{
        id: string;
        name: string;
        game: string;
        date: string;
        format: string;
        players: number;
        country?: string;
        city?: string;
        organizer?: string;
        online: boolean;
      }>;
    }

    const response = await this.request<TournamentResponse>('/tournaments', {
      game: limitlessGame,
      limit: String(limit),
    });

    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    return response.tournaments
      .filter((t) => new Date(t.date) >= cutoff)
      .filter((t) => !options.format || t.format === options.format)
      .map((t) => ({
        id: t.id,
        name: t.name,
        game: t.game,
        date: new Date(t.date),
        format: t.format,
        playerCount: t.players,
        country: t.country,
        city: t.city,
        organizer: t.organizer,
        isOnline: t.online,
      }));
  }

  /**
   * Get standings for a tournament
   */
  async getTournamentStandings(
    tournamentId: string,
    topN?: number
  ): Promise<TournamentStanding[]> {
    interface StandingsResponse {
      standings: Array<{
        playerId: string;
        name: string;
        placement: number;
        record?: string;
        decklist?: string;
      }>;
    }

    const response = await this.request<StandingsResponse>(
      `/tournaments/${tournamentId}/standings`
    );

    let standings = response.standings.map((s) => ({
      tournamentId,
      playerId: s.playerId,
      playerName: s.name,
      placement: s.placement,
      record: s.record,
      decklistId: s.decklist,
    }));

    if (topN) {
      standings = standings.filter((s) => s.placement <= topN);
    }

    return standings;
  }

  /**
   * Get a specific decklist
   */
  async getDecklist(decklistId: string): Promise<Decklist | null> {
    interface DecklistResponse {
      id: string;
      tournamentId: string;
      playerId: string;
      playerName: string;
      placement: number;
      archetype: string;
      cards: Array<{
        id: string;
        name: string;
        set: string;
        number: string;
        count: number;
        mainDeck: boolean;
      }>;
    }

    try {
      const response = await this.request<DecklistResponse>(`/decklists/${decklistId}`);

      return {
        id: response.id,
        tournamentId: response.tournamentId,
        playerId: response.playerId,
        playerName: response.playerName,
        placement: response.placement,
        archetype: response.archetype || 'Unknown',
        cards: response.cards.map((c) => ({
          cardId: `${c.set}-${c.number}`,
          cardName: c.name,
          setCode: c.set,
          cardNumber: c.number,
          quantity: c.count,
          isMainDeck: c.mainDeck,
        })),
      };
    } catch (error) {
      if (error instanceof LimitlessApiError && error.statusCode === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Get top decklists from a tournament
   */
  async getTopDecklists(
    tournamentId: string,
    topN: number = 8
  ): Promise<Decklist[]> {
    const standings = await this.getTournamentStandings(tournamentId, topN);
    const decklists: Decklist[] = [];

    for (const standing of standings) {
      if (standing.decklistId) {
        const decklist = await this.getDecklist(standing.decklistId);
        if (decklist) {
          decklists.push(decklist);
        }
      }
    }

    return decklists;
  }

  /**
   * Calculate meta statistics for cards
   *
   * Analyzes tournament decklists to determine meta relevance.
   */
  async calculateMetaStats(
    game: GameCode,
    options: {
      days?: number;
      topCut?: number;
    } = {}
  ): Promise<Map<string, CardMetaStats>> {
    const days = options.days || 30;
    const topCut = options.topCut || 32;

    const tournaments = await this.getTournaments(game, { days });
    const cardStats = new Map<string, {
      cardName: string;
      deckCount: number;
      top8Count: number;
      top4Count: number;
      winnerCount: number;
      totalCopies: number;
      archetypes: Set<string>;
    }>();

    let totalDecks = 0;
    let totalTop8Decks = 0;

    for (const tournament of tournaments) {
      try {
        const decklists = await this.getTopDecklists(tournament.id, topCut);

        for (const deck of decklists) {
          totalDecks++;
          if (deck.placement <= 8) totalTop8Decks++;

          for (const card of deck.cards) {
            const stats = cardStats.get(card.cardId) || {
              cardName: card.cardName,
              deckCount: 0,
              top8Count: 0,
              top4Count: 0,
              winnerCount: 0,
              totalCopies: 0,
              archetypes: new Set<string>(),
            };

            stats.deckCount++;
            stats.totalCopies += card.quantity;
            stats.archetypes.add(deck.archetype);

            if (deck.placement <= 8) stats.top8Count++;
            if (deck.placement <= 4) stats.top4Count++;
            if (deck.placement === 1) stats.winnerCount++;

            cardStats.set(card.cardId, stats);
          }
        }
      } catch (error) {
        console.error(`Error processing tournament ${tournament.id}:`, error);
      }
    }

    // Convert to CardMetaStats
    const result = new Map<string, CardMetaStats>();
    const periodEnd = new Date();
    const periodStart = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    for (const [cardId, stats] of cardStats) {
      result.set(cardId, {
        cardId,
        cardName: stats.cardName,
        game,
        period: {
          startDate: periodStart,
          endDate: periodEnd,
          days,
        },
        deckCount: stats.deckCount,
        top8Count: stats.top8Count,
        top4Count: stats.top4Count,
        winnerCount: stats.winnerCount,
        totalTournaments: tournaments.length,
        deckInclusionRate: totalDecks > 0 ? stats.deckCount / totalDecks : 0,
        top8Rate: totalTop8Decks > 0 ? stats.top8Count / totalTop8Decks : 0,
        avgCopiesPerDeck: stats.deckCount > 0 ? stats.totalCopies / stats.deckCount : 0,
        archetypeDiversity: stats.archetypes.size,
      });
    }

    return result;
  }

  /**
   * Get meta stats for a specific card
   */
  async getCardMetaStats(
    cardId: string,
    game: GameCode,
    days: number = 30
  ): Promise<CardMetaStats | null> {
    const allStats = await this.calculateMetaStats(game, { days });
    return allStats.get(cardId) || null;
  }

  /**
   * Find trending cards (increasing meta share)
   *
   * Compares recent meta share to previous period.
   */
  async findTrendingCards(
    game: GameCode,
    options: {
      recentDays?: number;
      previousDays?: number;
      minDeckCount?: number;
    } = {}
  ): Promise<Array<{
    cardId: string;
    cardName: string;
    recentRate: number;
    previousRate: number;
    changePercent: number;
    isNewTech: boolean;
  }>> {
    const recentDays = options.recentDays || 14;
    const previousDays = options.previousDays || 30;
    const minDeckCount = options.minDeckCount || 3;

    // Get recent stats
    const recentStats = await this.calculateMetaStats(game, { days: recentDays });

    // Get previous period stats
    const previousStats = await this.calculateMetaStats(game, { days: previousDays });

    const trending: Array<{
      cardId: string;
      cardName: string;
      recentRate: number;
      previousRate: number;
      changePercent: number;
      isNewTech: boolean;
    }> = [];

    for (const [cardId, recent] of recentStats) {
      if (recent.deckCount < minDeckCount) continue;

      const previous = previousStats.get(cardId);
      const previousRate = previous?.deckInclusionRate || 0;
      const recentRate = recent.deckInclusionRate;

      // Calculate change
      const changePercent = previousRate > 0
        ? ((recentRate - previousRate) / previousRate) * 100
        : recentRate > 0 ? 100 : 0;

      // New tech = wasn't in meta before, now appearing
      const isNewTech = previousRate === 0 && recentRate > 0.05;

      // Only include cards with significant change or new tech
      if (changePercent > 20 || isNewTech) {
        trending.push({
          cardId,
          cardName: recent.cardName,
          recentRate,
          previousRate,
          changePercent,
          isNewTech,
        });
      }
    }

    // Sort by change percent (descending)
    trending.sort((a, b) => b.changePercent - a.changePercent);

    return trending;
  }

  /**
   * Get archetype breakdown for a game
   */
  async getArchetypeBreakdown(
    game: GameCode,
    days: number = 30
  ): Promise<Map<string, {
    archetype: string;
    deckCount: number;
    top8Count: number;
    winCount: number;
    share: number;
  }>> {
    const tournaments = await this.getTournaments(game, { days });
    const archetypes = new Map<string, {
      archetype: string;
      deckCount: number;
      top8Count: number;
      winCount: number;
    }>();

    let totalDecks = 0;

    for (const tournament of tournaments) {
      try {
        const decklists = await this.getTopDecklists(tournament.id, 32);

        for (const deck of decklists) {
          totalDecks++;
          const arch = deck.archetype || 'Unknown';

          const stats = archetypes.get(arch) || {
            archetype: arch,
            deckCount: 0,
            top8Count: 0,
            winCount: 0,
          };

          stats.deckCount++;
          if (deck.placement <= 8) stats.top8Count++;
          if (deck.placement === 1) stats.winCount++;

          archetypes.set(arch, stats);
        }
      } catch (error) {
        console.error(`Error processing tournament ${tournament.id}:`, error);
      }
    }

    // Add share calculation
    const result = new Map<string, {
      archetype: string;
      deckCount: number;
      top8Count: number;
      winCount: number;
      share: number;
    }>();

    for (const [arch, stats] of archetypes) {
      result.set(arch, {
        ...stats,
        share: totalDecks > 0 ? stats.deckCount / totalDecks : 0,
      });
    }

    return result;
  }
}

/**
 * Create Limitless collector instance
 */
export function createLimitlessCollector(config: LimitlessConfig): LimitlessCollector {
  return new LimitlessCollector(config);
}

export default LimitlessCollector;
