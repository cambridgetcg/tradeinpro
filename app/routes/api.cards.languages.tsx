/**
 * Card Languages API
 *
 * GET /apps/trade-in/cards/languages?game=onepiece
 *
 * Returns available languages for a specific game
 */

import type { LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import {
  validateAppProxy,
  jsonResponse,
  errorResponse,
  sanitizeString,
} from "../lib/app-proxy.server";

// Language display names
const LANGUAGE_NAMES: Record<string, string> = {
  EN: "English",
  JP: "Japanese",
  DE: "German",
  FR: "French",
  IT: "Italian",
  ES: "Spanish",
  PT: "Portuguese",
  KO: "Korean",
  ZH: "Chinese",
};

export interface Language {
  code: string;
  name: string;
  cardCount: number;
}

export interface LanguagesResponse {
  languages: Language[];
  count: number;
  game: string;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const context = validateAppProxy(request);
  if (!context.isValid && process.env.NODE_ENV === "production") {
    return errorResponse(401, "unauthorized", "Invalid request signature");
  }

  const url = new URL(request.url);
  const game = sanitizeString(url.searchParams.get("game") || "onepiece", 50);

  try {
    // Get unique languages with card counts for the specified game
    const languageData = await prisma.cardPriceV2.groupBy({
      by: ["language"],
      where: {
        game,
        tradeinPriceGbp: { not: null },
      },
      _count: { cardId: true },
      orderBy: { language: "asc" },
    });

    const languages: Language[] = languageData
      .filter((l) => l.language !== null)
      .map((l) => ({
        code: l.language as string,
        name: LANGUAGE_NAMES[l.language as string] || l.language as string,
        cardCount: l._count.cardId,
      }));

    return jsonResponse({
      languages,
      count: languages.length,
      game,
    } as LanguagesResponse);
  } catch (error) {
    console.error("Card languages error:", error);
    return errorResponse(500, "languages_failed", "Failed to load card languages");
  }
}

export async function action() {
  return errorResponse(405, "method_not_allowed", "Only GET requests are supported");
}
