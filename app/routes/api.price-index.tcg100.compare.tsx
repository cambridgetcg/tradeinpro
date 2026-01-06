/**
 * TCG-100 Language Comparison API
 *
 * GET /apps/trade-in/price-index/tcg100/compare
 *
 * Compares English vs Japanese TCG-100 indices with:
 * - Side-by-side index values
 * - Relative performance metrics
 * - Correlation analysis
 * - Market cap comparison
 *
 * Query params:
 *   - game: Game to compare (default: onepiece)
 */

import type { LoaderFunctionArgs } from "react-router";
import {
  validateAppProxy,
  jsonResponse,
  errorResponse,
} from "../lib/app-proxy.server";
import {
  calculateLanguageComparison,
  type LanguageComparisonResult,
} from "../lib/tcg100-index.server";
import { logger, metrics } from "../lib/observability.server";

export interface LanguageComparisonResponse {
  en: {
    value: number;
    change24h: number;
    change7d: number;
    totalMarketCap: number;
    avgPrice: number;
    constituentCount: number;
    volatilityIndex: number;
    top5Weight: number;
  } | null;

  jp: {
    value: number;
    change24h: number;
    change7d: number;
    totalMarketCap: number;
    avgPrice: number;
    constituentCount: number;
    volatilityIndex: number;
    top5Weight: number;
  } | null;

  comparison: {
    indexDiff: number;
    indexDiffPercent: number;
    change24hDiff: number;
    volatilityDiff: number;
    marketCapRatio: number;
    avgPriceRatio: number;
    correlation7d: number | null;
    leader: "EN" | "JP" | "TIE";
    momentum: "EN" | "JP" | "TIE";
  };

  game: string;
  timestamp: string;
}

export async function loader({ request }: LoaderFunctionArgs) {
  // Validate App Proxy signature
  const context = validateAppProxy(request);
  if (!context.isValid && process.env.NODE_ENV === "production") {
    return errorResponse(401, "unauthorized", "Invalid request signature");
  }

  const url = new URL(request.url);
  const game = url.searchParams.get("game") || "onepiece";

  try {
    metrics.increment("priceIndex.tcg100.compare.requested");

    // Calculate language comparison
    const comparisonData = await calculateLanguageComparison(game);

    // Determine leader (higher index value)
    const enValue = comparisonData.en?.value ?? 0;
    const jpValue = comparisonData.jp?.value ?? 0;
    const leader = Math.abs(enValue - jpValue) < 0.01 ? "TIE"
      : enValue > jpValue ? "EN" : "JP";

    // Determine momentum (better 24h change)
    const enChange = comparisonData.en?.change24h ?? 0;
    const jpChange = comparisonData.jp?.change24h ?? 0;
    const momentum = Math.abs(enChange - jpChange) < 0.1 ? "TIE"
      : enChange > jpChange ? "EN" : "JP";

    const response: LanguageComparisonResponse = {
      en: comparisonData.en ? {
        value: comparisonData.en.value,
        change24h: comparisonData.en.change24h,
        change7d: comparisonData.en.change7d,
        totalMarketCap: comparisonData.en.totalMarketCap,
        avgPrice: comparisonData.en.avgPrice,
        constituentCount: comparisonData.en.constituentCount,
        volatilityIndex: comparisonData.en.volatilityIndex,
        top5Weight: comparisonData.en.top5Weight,
      } : null,

      jp: comparisonData.jp ? {
        value: comparisonData.jp.value,
        change24h: comparisonData.jp.change24h,
        change7d: comparisonData.jp.change7d,
        totalMarketCap: comparisonData.jp.totalMarketCap,
        avgPrice: comparisonData.jp.avgPrice,
        constituentCount: comparisonData.jp.constituentCount,
        volatilityIndex: comparisonData.jp.volatilityIndex,
        top5Weight: comparisonData.jp.top5Weight,
      } : null,

      comparison: {
        ...comparisonData.comparison,
        leader,
        momentum,
      },

      game,
      timestamp: new Date().toISOString(),
    };

    return jsonResponse(response);
  } catch (error) {
    logger.error("TCG-100 comparison API error", {
      error: error instanceof Error ? error.message : String(error),
    });

    return errorResponse(
      500,
      "comparison_failed",
      "Failed to compare language indices. Please try again."
    );
  }
}

export async function action() {
  return errorResponse(405, "method_not_allowed", "Only GET requests are supported");
}
