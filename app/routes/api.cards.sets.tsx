/**
 * Card Sets API
 *
 * GET /apps/trade-in/cards/sets
 *
 * Returns available card sets for filtering
 */

import type { LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import {
  validateAppProxy,
  jsonResponse,
  errorResponse,
  sanitizeString,
} from "../lib/app-proxy.server";

// Set display names mapping
const SET_NAMES: Record<string, string> = {
  OP01: "Romance Dawn (OP01)",
  OP02: "Paramount War (OP02)",
  OP03: "Pillars of Strength (OP03)",
  OP04: "Kingdoms of Intrigue (OP04)",
  OP05: "Awakening of the New Era (OP05)",
  OP06: "Wings of the Captain (OP06)",
  OP07: "500 Years in the Future (OP07)",
  OP08: "Two Legends (OP08)",
  OP09: "The Four Emperors (OP09)",
  OP10: "Royal Blood (OP10)",
  OP11: "Emperors in the New World (OP11)",
  OP12: "World Legends (OP12)",
  OP13: "Ancient Heroes (OP13)",
  EB01: "Memorial Collection (EB01)",
  EB02: "Premium Booster (EB02)",
  ST01: "Straw Hat Crew (ST01)",
  ST02: "Worst Generation (ST02)",
  ST03: "The Seven Warlords (ST03)",
  ST04: "Animal Kingdom Pirates (ST04)",
  ST05: "ONE PIECE Film Edition (ST05)",
  ST06: "Navy (ST06)",
  ST07: "Big Mom Pirates (ST07)",
  ST08: "Monkey D. Luffy (ST08)",
  ST09: "Yamato (ST09)",
  ST10: "The Three Captains (ST10)",
  ST11: "Uta (ST11)",
  ST12: "Zoro & Sanji (ST12)",
  ST13: "The Three Brothers (ST13)",
  ST14: "3D2Y (ST14)",
  ST15: "RED Edward Newgate (ST15)",
  ST16: "GREEN Uta (ST16)",
  ST17: "BLUE Donquixote Doflamingo (ST17)",
  ST18: "PURPLE Monkey D. Luffy (ST18)",
  ST19: "BLACK Sabo (ST19)",
  ST20: "YELLOW Charlotte Katakuri (ST20)",
  PRB01: "Premium Booster (PRB01)",
};

export interface CardSet {
  code: string;
  name: string;
  cardCount: number;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const context = validateAppProxy(request);
  if (!context.isValid && process.env.NODE_ENV === "production") {
    return errorResponse(401, "unauthorized", "Invalid request signature");
  }

  const url = new URL(request.url);
  const game = sanitizeString(url.searchParams.get("game") || "onepiece", 50);

  try {
    // Get unique sets with card counts
    const setsData = await prisma.cardPriceV2.groupBy({
      by: ["setCode"],
      where: {
        game,
        tradeinPriceGbp: { not: null },
        setCode: { not: null },
      },
      _count: { cardId: true },
      orderBy: { setCode: "asc" },
    });

    const sets: CardSet[] = setsData
      .filter((s) => s.setCode !== null)
      .map((s) => ({
        code: s.setCode as string,
        name: SET_NAMES[s.setCode as string] || s.setCode as string,
        cardCount: s._count.cardId,
      }));

    return jsonResponse({
      sets,
      count: sets.length,
    });
  } catch (error) {
    console.error("Card sets error:", error);
    return errorResponse(500, "sets_failed", "Failed to load card sets");
  }
}

export async function action() {
  return errorResponse(405, "method_not_allowed", "Only GET requests are supported");
}
