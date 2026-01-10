/**
 * Data Collection Clients
 *
 * Unified exports for all market data collection clients
 */

// OPTCG API Client (Free, TCGplayer data)
export {
  OPTCGClient,
  getOPTCGClient,
  extractPriceHistory,
  normalizeOPTCGCardId,
} from "./optcg.server";

// JustTCG API Client (Premium, 180-day history)
export {
  JustTCGClient,
  getJustTCGClient,
  resetJustTCGClient,
  convertPriceHistory,
  normalizeJustTCGCardId,
  JUSTTCG_RATE_LIMITS,
} from "./justtcg.server";

// FX Rate Client (Currency conversion)
export {
  FXRateClient,
  getFXRateClient,
  resetFXRateClient,
  usdToGbp,
  eurToGbp,
  jpyToGbp,
  gbpToUsd,
  gbpToEur,
  convertFromGbp,
  inverseRate,
} from "./fx-rates.server";

// Cardmarket CSV Parser
export {
  parseCardmarketCSV,
  parseCardmarketCSVFile,
  fetchCardmarketPriceGuide,
  expansionToSetCode,
  normalizeCardName,
  extractCardNumber,
  matchCardmarketToCardId,
  groupByExpansion,
  calculateCSVStats,
  filterByMinPrice,
  sortRows,
} from "./cardmarket-csv.server";

export type { ParseOptions, ParseResult } from "./cardmarket-csv.server";
