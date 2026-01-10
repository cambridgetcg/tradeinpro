/**
 * Job Handlers
 *
 * Implementation of collection job handlers that use the collectors
 * and feature store to gather and store ML training data.
 */

import type { JobContext, JobHandler, JobType } from './collection-scheduler.js';
import type { GameCode } from '../config/games.js';

// Collector types (to be imported when available)
import type { TCGApisListingCollector } from '../collectors/tcgapis-listing-collector.js';
import type { YouTubeCollector } from '../collectors/youtube-collector.js';
import type { RedditCollector } from '../collectors/reddit-collector.js';
import type { LimitlessCollector } from '../collectors/limitless-collector.js';
import type { CardmarketCollector } from '../collectors/cardmarket-collector.js';
import type { RedisFeatureStore, PriceFeatures, SocialFeatures, TournamentFeatures, CrossPlatformFeatures } from '../features/redis-feature-store.js';

/**
 * Dependencies for job handlers
 */
export interface JobHandlerDependencies {
  // Collectors
  listingCollector: TCGApisListingCollector;
  youtubeCollector: YouTubeCollector;
  redditCollector: RedditCollector;
  tournamentCollector: LimitlessCollector;
  cardmarketCollector: CardmarketCollector;

  // Feature store
  featureStore: RedisFeatureStore;

  // Database client (Prisma)
  db: {
    card: {
      findMany: (args: {
        where?: { game?: string };
        select?: { id: true };
        take?: number;
      }) => Promise<Array<{ id: string }>>;
    };
    listing: {
      upsert: (args: {
        where: { cardId_sellerId_price_condition: { cardId: string; sellerId: string; price: number; condition: string } };
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }) => Promise<unknown>;
      updateMany: (args: {
        where: { cardId: string; isActive: boolean; lastSeenAt: { lt: Date } };
        data: { isActive: boolean; soldAt: Date };
      }) => Promise<unknown>;
    };
    socialMention: {
      upsert: (args: {
        where: { platform_postId: { platform: string; postId: string } };
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }) => Promise<unknown>;
    };
    tournament: {
      upsert: (args: {
        where: { id: string };
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }) => Promise<unknown>;
    };
    decklist: {
      create: (args: { data: Record<string, unknown> }) => Promise<unknown>;
    };
    crossPlatformPrice: {
      create: (args: { data: Record<string, unknown> }) => Promise<unknown>;
    };
    collectionJob: {
      create: (args: { data: Record<string, unknown> }) => Promise<unknown>;
      update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown>;
    };
  };
}

/**
 * Create listings collection handler
 */
export function createListingsHandler(deps: JobHandlerDependencies): JobHandler {
  return async (context: JobContext) => {
    const { games, options, signal, onProgress, onError } = context;
    const batchSize = (options.batchSize as number) || 100;

    let processed = 0;

    for (const game of games) {
      if (signal.aborted) break;

      try {
        // Get cards for this game
        const cards = await deps.db.card.findMany({
          where: { game },
          select: { id: true },
          take: 1000,
        });

        const total = cards.length;
        onProgress(processed, processed + total);

        // Process in batches
        for (let i = 0; i < cards.length; i += batchSize) {
          if (signal.aborted) break;

          const batch = cards.slice(i, i + batchSize);
          const cardIds = batch.map((c) => c.id);

          try {
            // Fetch listings from TCGAPIs
            const listings = await deps.listingCollector.batchGetListings(cardIds);
            const now = new Date();

            for (const [cardId, listingData] of listings) {
              // Store each listing
              for (const listing of listingData.listings) {
                await deps.db.listing.upsert({
                  where: {
                    cardId_sellerId_price_condition: {
                      cardId,
                      sellerId: listing.sellerId,
                      price: listing.price,
                      condition: listing.condition,
                    },
                  },
                  create: {
                    cardId,
                    sellerId: listing.sellerId,
                    sellerName: listing.sellerName,
                    sellerRating: listing.sellerRating,
                    sellerSalesCount: listing.sellerSalesCount,
                    price: listing.price,
                    condition: listing.condition,
                    quantity: listing.quantity,
                    shippingCost: listing.shippingCost,
                    language: listing.language,
                    isFeatured: listing.isFeatured,
                    marketPriceAtListing: listingData.marketPrice,
                    lowPriceAtListing: listingData.lowPrice,
                    firstSeenAt: now,
                    lastSeenAt: now,
                    isActive: true,
                  },
                  update: {
                    lastSeenAt: now,
                    quantity: listing.quantity,
                    isActive: true,
                  },
                });
              }

              // Mark stale listings as sold
              const staleThreshold = new Date(now.getTime() - 2 * 60 * 60 * 1000); // 2 hours
              await deps.db.listing.updateMany({
                where: {
                  cardId,
                  isActive: true,
                  lastSeenAt: { lt: staleThreshold },
                },
                data: {
                  isActive: false,
                  soldAt: now,
                },
              });

              // Update feature store
              const priceFeatures = buildPriceFeatures(cardId, game, listingData);
              await deps.featureStore.setPriceFeatures(priceFeatures);
            }

            processed += batch.length;
            onProgress(processed);
          } catch (error) {
            onError(error instanceof Error ? error : new Error(String(error)));
          }
        }
      } catch (error) {
        onError(error instanceof Error ? error : new Error(String(error)));
      }
    }
  };
}

/**
 * Create YouTube signals handler
 */
export function createYouTubeHandler(deps: JobHandlerDependencies): JobHandler {
  return async (context: JobContext) => {
    const { games, options, signal, onProgress, onError } = context;
    const hoursBack = (options.hoursBack as number) || 24;
    const maxResults = (options.maxResults as number) || 25;

    let processed = 0;

    for (const game of games) {
      if (signal.aborted) break;

      try {
        // Search for TCG videos
        const videos = await deps.youtubeCollector.searchTCGVideos(game, {
          hours: hoursBack,
          maxResults,
        });

        for (const video of videos) {
          if (signal.aborted) break;

          try {
            await deps.db.socialMention.upsert({
              where: {
                platform_postId: {
                  platform: 'youtube',
                  postId: video.videoId,
                },
              },
              create: {
                platform: 'youtube',
                postId: video.videoId,
                postUrl: `https://youtube.com/watch?v=${video.videoId}`,
                title: video.title,
                content: video.description,
                author: video.channelTitle,
                score: video.likeCount,
                viewCount: video.viewCount,
                commentCount: video.commentCount,
                game,
                channelId: video.channelId,
                channelName: video.channelTitle,
                cardMentions: video.cardMentions,
                postedAt: video.publishedAt,
                collectedAt: new Date(),
              },
              update: {
                score: video.likeCount,
                viewCount: video.viewCount,
                commentCount: video.commentCount,
                collectedAt: new Date(),
              },
            });

            processed++;
            onProgress(processed);
          } catch (error) {
            onError(error instanceof Error ? error : new Error(String(error)));
          }
        }
      } catch (error) {
        onError(error instanceof Error ? error : new Error(String(error)));
      }
    }
  };
}

/**
 * Create Reddit signals handler
 */
export function createRedditHandler(deps: JobHandlerDependencies): JobHandler {
  return async (context: JobContext) => {
    const { games, options, signal, onProgress, onError } = context;
    const hoursBack = (options.hoursBack as number) || 24;
    const limitPerSub = (options.limitPerSub as number) || 100;

    let processed = 0;

    for (const game of games) {
      if (signal.aborted) break;

      try {
        // Collect posts from subreddits
        const posts = await deps.redditCollector.collectPosts(game, {
          hours: hoursBack,
          limitPerSub,
        });

        for (const post of posts) {
          if (signal.aborted) break;

          try {
            await deps.db.socialMention.upsert({
              where: {
                platform_postId: {
                  platform: 'reddit',
                  postId: post.postId,
                },
              },
              create: {
                platform: 'reddit',
                postId: post.postId,
                postUrl: post.permalink,
                title: post.title,
                content: post.content,
                author: post.author,
                score: post.score,
                upvoteRatio: post.upvoteRatio,
                commentCount: post.numComments,
                isPriceDiscussion: post.isPriceDiscussion,
                game,
                subreddit: post.subreddit,
                cardMentions: post.cardMentions,
                postedAt: post.postedAt,
                collectedAt: new Date(),
              },
              update: {
                score: post.score,
                upvoteRatio: post.upvoteRatio,
                commentCount: post.numComments,
                collectedAt: new Date(),
              },
            });

            processed++;
            onProgress(processed);
          } catch (error) {
            onError(error instanceof Error ? error : new Error(String(error)));
          }
        }
      } catch (error) {
        onError(error instanceof Error ? error : new Error(String(error)));
      }
    }
  };
}

/**
 * Create tournament data handler
 */
export function createTournamentHandler(deps: JobHandlerDependencies): JobHandler {
  return async (context: JobContext) => {
    const { games, options, signal, onProgress, onError } = context;
    const daysBack = (options.daysBack as number) || 7;
    const topCut = (options.topCut as number) || 32;

    let processed = 0;

    for (const game of games) {
      if (signal.aborted) break;

      // Check if game is supported by Limitless
      if (!deps.tournamentCollector.isGameSupported(game)) {
        continue;
      }

      try {
        // Get recent tournaments
        const tournaments = await deps.tournamentCollector.getTournaments(game, {
          days: daysBack,
        });

        onProgress(processed, processed + tournaments.length);

        for (const tournament of tournaments) {
          if (signal.aborted) break;

          try {
            // Store tournament
            await deps.db.tournament.upsert({
              where: { id: tournament.id },
              create: {
                id: tournament.id,
                name: tournament.name,
                game: tournament.game,
                format: tournament.format,
                date: tournament.date,
                playerCount: tournament.playerCount,
                country: tournament.country,
                city: tournament.city,
                organizer: tournament.organizer,
                isOnline: tournament.isOnline,
                source: 'limitless',
              },
              update: {
                playerCount: tournament.playerCount,
              },
            });

            // Get top decklists
            const decklists = await deps.tournamentCollector.getTopDecklists(tournament.id, topCut);

            for (const decklist of decklists) {
              await deps.db.decklist.create({
                data: {
                  tournamentId: tournament.id,
                  playerId: decklist.playerId,
                  playerName: decklist.playerName,
                  placement: decklist.placement,
                  archetype: decklist.archetype,
                  cards: {
                    create: decklist.cards.map((card) => ({
                      cardName: card.cardName,
                      setCode: card.setCode,
                      cardNumber: card.cardNumber,
                      quantity: card.quantity,
                      isMainDeck: card.isMainDeck,
                    })),
                  },
                },
              });
            }

            processed++;
            onProgress(processed);
          } catch (error) {
            onError(error instanceof Error ? error : new Error(String(error)));
          }
        }

        // Calculate and store meta stats
        const metaStats = await deps.tournamentCollector.calculateMetaStats(game, { days: daysBack });

        for (const [cardId, stats] of metaStats) {
          const tournamentFeatures: TournamentFeatures = {
            cardId,
            game,
            deckInclusionRate7d: stats.deckInclusionRate,
            deckInclusionRate30d: stats.deckInclusionRate,
            deckInclusionRateChange: 0,
            top8Rate: stats.top8Rate,
            top4Rate: stats.top4Count / Math.max(stats.deckCount, 1),
            winRate: stats.winnerCount / Math.max(stats.totalTournaments, 1),
            avgCopiesPerDeck: stats.avgCopiesPerDeck,
            archetypeDiversity: stats.archetypeDiversity,
            isNewTech: false,
            metaTrendDirection: 'stable',
            recentTournamentCount: stats.totalTournaments,
            totalDecksAnalyzed: stats.deckCount,
            updatedAt: new Date(),
          };

          await deps.featureStore.setTournamentFeatures(tournamentFeatures);
        }
      } catch (error) {
        onError(error instanceof Error ? error : new Error(String(error)));
      }
    }
  };
}

/**
 * Create Cardmarket handler
 */
export function createCardmarketHandler(deps: JobHandlerDependencies): JobHandler {
  return async (context: JobContext) => {
    const { games, options, signal, onProgress, onError } = context;
    const maxCards = (options.maxCards as number) || 100;

    let processed = 0;

    for (const game of games) {
      if (signal.aborted) break;

      try {
        // Get high-value cards for this game
        const cards = await deps.db.card.findMany({
          where: { game },
          select: { id: true },
          take: maxCards,
        });

        // Build Cardmarket URLs
        const urls = cards.map((card) =>
          deps.cardmarketCollector.buildCardmarketUrl(card.id, game)
        );

        // Scrape Cardmarket data
        const cardmarketPrices = await deps.cardmarketCollector.scrapeCards(urls);

        for (const cmPrice of cardmarketPrices) {
          if (signal.aborted) break;

          try {
            // Store cross-platform price
            await deps.db.crossPlatformPrice.create({
              data: {
                cardId: cmPrice.cardId || cmPrice.cardmarketId,
                tcgplayerPriceUsd: 0, // Will be matched later
                tcgplayerLowUsd: 0,
                cardmarketPriceEur: cmPrice.priceEur,
                cardmarketPriceUsd: cmPrice.priceUsd,
                cardmarketLowEur: cmPrice.lowEur,
                cardmarketLowUsd: cmPrice.lowEur * 1.08, // Approximate
                priceDiffUsd: 0,
                priceDiffPercent: 0,
                estimatedProfit: 0,
                arbitrageDirection: 'NO_OPPORTUNITY',
                fxRateEurUsd: 1.08,
              },
            });

            // Update feature store
            const crossPlatformFeatures: CrossPlatformFeatures = {
              cardId: cmPrice.cardId || cmPrice.cardmarketId,
              game,
              tcgplayerPriceUsd: 0,
              tcgplayerLowUsd: 0,
              cardmarketPriceEur: cmPrice.priceEur,
              cardmarketPriceUsd: cmPrice.priceUsd,
              cardmarketLowEur: cmPrice.lowEur,
              cardmarketLowUsd: cmPrice.lowEur * 1.08,
              priceDiffUsd: 0,
              priceDiffPercent: 0,
              estimatedProfit: 0,
              arbitrageDirection: 'NO_OPPORTUNITY',
              fxRateEurUsd: 1.08,
              avgSpread7d: 0,
              avgSpread30d: 0,
              updatedAt: new Date(),
            };

            await deps.featureStore.setCrossPlatformFeatures(crossPlatformFeatures);

            processed++;
            onProgress(processed);
          } catch (error) {
            onError(error instanceof Error ? error : new Error(String(error)));
          }
        }
      } catch (error) {
        onError(error instanceof Error ? error : new Error(String(error)));
      }
    }
  };
}

/**
 * Create feature refresh handler
 */
export function createFeatureRefreshHandler(deps: JobHandlerDependencies): JobHandler {
  return async (context: JobContext) => {
    const { games, options, signal, onProgress, onError } = context;
    const maxAgeMinutes = (options.maxAgeMinutes as number) || 60;

    let processed = 0;

    for (const game of games) {
      if (signal.aborted) break;

      try {
        // Get cards for this game
        const cards = await deps.db.card.findMany({
          where: { game },
          select: { id: true },
          take: 500,
        });

        for (const card of cards) {
          if (signal.aborted) break;

          // Check if features are fresh
          const isFresh = await deps.featureStore.areFeaturesFresh(card.id, maxAgeMinutes * 60);

          if (!isFresh) {
            // Refresh would be triggered by the listings handler
            // Here we just aggregate social features from recent data

            try {
              // Get recent YouTube signals for this card
              const youtubeSignals = await deps.youtubeCollector.getCardSignals(card.id, game, 7);

              // Get recent Reddit signals
              const redditSignals = await deps.redditCollector.getCardSignals(card.id, game, 7);

              // Build social features
              const socialFeatures: SocialFeatures = {
                cardId: card.id,
                game,
                redditPostCount24h: redditSignals.postCount,
                redditPostCount7d: redditSignals.postCount,
                redditTotalScore24h: redditSignals.totalScore,
                redditTotalScore7d: redditSignals.totalScore,
                redditAvgUpvoteRatio: redditSignals.avgUpvoteRatio,
                redditPriceDiscussionCount: redditSignals.priceDiscussionCount,
                redditSentiment: redditSignals.sentiment,
                youtubeVideoCount24h: youtubeSignals.videoCount,
                youtubeVideoCount7d: youtubeSignals.videoCount,
                youtubeTotalViews24h: youtubeSignals.totalViews,
                youtubeTotalViews7d: youtubeSignals.totalViews,
                youtubeTotalLikes: youtubeSignals.totalLikes,
                youtubeTopCreatorMention: youtubeSignals.topCreatorMention,
                socialMomentumScore: calculateMomentumScore(redditSignals, youtubeSignals),
                socialSentimentScore: redditSignals.sentiment,
                isTrending: youtubeSignals.videoCount > 5 || redditSignals.postCount > 10,
                trendingScore: (youtubeSignals.totalViews / 10000) + (redditSignals.totalScore / 100),
                updatedAt: new Date(),
              };

              await deps.featureStore.setSocialFeatures(socialFeatures);
            } catch {
              // Ignore individual card errors during refresh
            }
          }

          processed++;
          onProgress(processed, cards.length);
        }
      } catch (error) {
        onError(error instanceof Error ? error : new Error(String(error)));
      }
    }
  };
}

// ==================== Helper Functions ====================

/**
 * Build price features from listing data
 */
function buildPriceFeatures(cardId: string, game: GameCode, listingData: {
  marketPrice: number;
  lowPrice: number;
  midPrice: number;
  highPrice: number;
  listings: Array<{ price: number }>;
}): PriceFeatures {
  const listings = listingData.listings;
  const avgPrice = listings.length > 0
    ? listings.reduce((sum, l) => sum + l.price, 0) / listings.length
    : listingData.marketPrice;

  return {
    cardId,
    game,
    marketPrice: listingData.marketPrice,
    lowPrice: listingData.lowPrice,
    midPrice: listingData.midPrice,
    highPrice: listingData.highPrice,
    priceChange1h: 0,
    priceChange24h: 0,
    priceChange7d: 0,
    priceChange30d: 0,
    pricePercentile: 50,
    volatility7d: 0,
    volatility30d: 0,
    listingCount: listings.length,
    avgListingPrice: avgPrice,
    listingSpread: listingData.marketPrice > 0
      ? (listingData.highPrice - listingData.lowPrice) / listingData.marketPrice
      : 0,
    salesLast24h: 0,
    salesLast7d: 0,
    avgDaysToSell: 0,
    updatedAt: new Date(),
  };
}

/**
 * Calculate social momentum score
 */
function calculateMomentumScore(
  reddit: { postCount: number; totalScore: number },
  youtube: { videoCount: number; totalViews: number }
): number {
  // Weighted score 0-100
  const redditScore = Math.min(reddit.postCount * 5 + reddit.totalScore / 10, 50);
  const youtubeScore = Math.min(youtube.videoCount * 5 + youtube.totalViews / 1000, 50);
  return redditScore + youtubeScore;
}

/**
 * Create all job handlers
 */
export function createAllHandlers(deps: JobHandlerDependencies): Map<JobType, JobHandler> {
  const handlers = new Map<JobType, JobHandler>();

  handlers.set('listings', createListingsHandler(deps));
  handlers.set('social_youtube', createYouTubeHandler(deps));
  handlers.set('social_reddit', createRedditHandler(deps));
  handlers.set('tournament', createTournamentHandler(deps));
  handlers.set('cardmarket', createCardmarketHandler(deps));
  handlers.set('feature_refresh', createFeatureRefreshHandler(deps));

  return handlers;
}

export default createAllHandlers;
