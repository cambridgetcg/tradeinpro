/**
 * Collectors Module
 *
 * Data collectors for ML training data:
 * - TCGAPIs: Live listings from TCGplayer
 * - YouTube: Video signals and engagement
 * - Reddit: Post signals and sentiment
 * - Limitless: Tournament and decklist data
 * - Cardmarket: Cross-platform price data
 */

// TCGAPIs Listing Collector
export {
  TCGApisListingCollector,
  createTCGApisCollector,
  type TCGApisConfig,
  type ListingData,
  type SellerListing,
  type SalesHistory,
  type SaleRecord,
  type ListingOutcome,
  type CardCondition,
  TCGApisError,
} from './tcgapis-listing-collector.js';

// YouTube Collector
export {
  YouTubeCollector,
  createYouTubeCollector,
  type YouTubeCollectorConfig,
  type VideoSignal,
  type CardYouTubeSignals,
} from './youtube-collector.js';

// Reddit Collector
export {
  RedditCollector,
  createRedditCollector,
  type RedditCollectorConfig,
  type RedditPost,
  type RedditComment,
  type CardRedditSignals,
} from './reddit-collector.js';

// Limitless Tournament Collector
export {
  LimitlessCollector,
  createLimitlessCollector,
  type LimitlessConfig,
  type Tournament,
  type TournamentStanding,
  type Decklist,
  type DeckCard,
  type CardMetaStats,
  LimitlessApiError,
} from './limitless-collector.js';

// Cardmarket Collector
export {
  CardmarketCollector,
  createCardmarketCollector,
  type CardmarketCollectorConfig,
  type CardmarketPrice,
  type CardmarketSeller,
  type CrossPlatformPrice,
} from './cardmarket-collector.js';
