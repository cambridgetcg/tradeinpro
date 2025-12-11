/**
 * Card Games API
 *
 * GET /apps/trade-in/cards/games
 *
 * Returns available card games for filtering
 */

import type { LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import {
  validateAppProxy,
  jsonResponse,
  errorResponse,
} from "../lib/app-proxy.server";

// Game configuration
interface GameConfig {
  code: string;
  name: string;
  icon: string;
  enabled: boolean;
  cardCount?: number;
}

const GAME_CONFIG: Record<string, Omit<GameConfig, "code" | "cardCount">> = {
  onepiece: { name: "One Piece", icon: "onepiece", enabled: true },
  pokemon: { name: "Pokemon", icon: "pokemon", enabled: false },
  yugioh: { name: "Yu-Gi-Oh!", icon: "yugioh", enabled: false },
};

export interface GamesResponse {
  games: GameConfig[];
  count: number;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const context = validateAppProxy(request);
  if (!context.isValid && process.env.NODE_ENV === "production") {
    return errorResponse(401, "unauthorized", "Invalid request signature");
  }

  try {
    // Get card counts per game for enabled games
    const gameCounts = await prisma.cardPriceV2.groupBy({
      by: ["game"],
      where: {
        tradeinPriceGbp: { not: null },
      },
      _count: { cardId: true },
    });

    const countMap = new Map(
      gameCounts.map((g) => [g.game, g._count.cardId])
    );

    // Build games list with counts
    const games: GameConfig[] = Object.entries(GAME_CONFIG).map(([code, config]) => ({
      code,
      ...config,
      cardCount: countMap.get(code) || 0,
    }));

    return jsonResponse({
      games,
      count: games.length,
    } as GamesResponse);
  } catch (error) {
    console.error("Card games error:", error);
    return errorResponse(500, "games_failed", "Failed to load card games");
  }
}

export async function action() {
  return errorResponse(405, "method_not_allowed", "Only GET requests are supported");
}
