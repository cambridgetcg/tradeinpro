#!/usr/bin/env npx tsx
/**
 * Daily TCGPlayer Archive - Local CLI
 *
 * Run locally to archive TCGPlayer prices to the RDS database.
 * Uses the same logic as the Lambda but runs locally for testing.
 *
 * Data Sources:
 * - JustTCG API: Aggregate prices, statistics, price history (primary)
 * - TCGPlayer Search API: Individual seller listings (optional, --with-listings)
 *
 * Usage:
 *   source ../../../secrets/.env.keys
 *   npx tsx scripts/daily-archive-local.ts
 *   npx tsx scripts/daily-archive-local.ts --game=onepiece --dry-run
 *   npx tsx scripts/daily-archive-local.ts --game=pokemon --limit=100
 *   npx tsx scripts/daily-archive-local.ts --game=onepiece --with-listings --set=OP01
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * DOCUMENTATION REFERENCES (Symbiotic Code ↔ Docs)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * @see {@link file://../docs/AWS_INFRASTRUCTURE.md} - Production deployment
 *   - Lambda function configuration
 *   - EventBridge scheduling
 *   - S3 storage patterns
 *
 * @see {@link file://../docs/HYBRID_PIPELINE_ARCHITECTURE.md} - Pipeline design
 *   - JustTCG API vs Search API strategy
 *   - Data flow diagram
 *
 * @see {@link file://../docs/SCRAPER_ARCHITECTURE_INSIGHTS.md} - Architecture patterns
 *   - Rate limiting implementation
 *   - Error handling patterns
 *
 * @see {@link file://../docs/ML_TRAINING_PREREQUISITES.md} - Data requirements
 *   - What data to collect for ML training
 *   - Volume and quality requirements
 *
 * @see {@link file://../docs/README.md} - TCGPlayer documentation index
 *
 * Related Code Files:
 * @see {@link file://../src/scrapers/tcgplayer-search-api-scraper.ts} - Search API scraper
 * @see {@link file://../src/pipeline/hybrid-tcgplayer-pipeline.ts} - Pipeline orchestration
 * @see {@link file://../src/apis/justtcg-client.ts} - JustTCG API client
 * @see {@link file://../src/storage/database-loader.ts} - Database operations
 *
 * Test Scripts:
 * @see {@link file://./test-search-api-scraper.ts} - Search API testing
 * @see {@link file://./test-data-sources.ts} - Data source validation
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * @script daily-archive-local
 * @since 2026-01-09
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { createTCGPlayerSearchScraper, type TCGPlayerProductResult, type TCGPlayerListingResult } from '../src/scrapers/tcgplayer-search-api-scraper.js';
import type { GameCode } from '../src/config/games.js';

// =============================================================================
// Configuration
// =============================================================================

const JUSTTCG_API_KEY = process.env.JUSTTCG_API_KEY;
const DATABASE_URL = process.env.DATABASE_URL;
const JUSTTCG_BASE_URL = 'https://api.justtcg.com/v1';
const USD_TO_GBP = 0.79;

// Parse CLI args
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const VERBOSE = args.includes('--verbose') || args.includes('-v');
const WITH_LISTINGS = args.includes('--with-listings');
const gameArg = args.find(a => a.startsWith('--game='))?.split('=')[1];
const setArg = args.find(a => a.startsWith('--set='))?.split('=')[1];
const limitArg = parseInt(args.find(a => a.startsWith('--limit='))?.split('=')[1] || '0', 10);

// Games to archive
const ALL_GAMES = [
  { id: 'one-piece-card-game', name: 'One Piece', code: 'onepiece' },
  { id: 'pokemon', name: 'Pokemon', code: 'pokemon' },
  { id: 'disney-lorcana', name: 'Lorcana', code: 'lorcana' },
];

const GAMES_TO_ARCHIVE = gameArg
  ? ALL_GAMES.filter(g => g.code === gameArg || g.id === gameArg)
  : ALL_GAMES;

// =============================================================================
// Types
// =============================================================================

interface JustTcgVariant {
  id: string;
  condition: string;
  printing: string;
  price: number;
  lastUpdated: number;
  priceChange7d?: number;
  priceChange30d?: number;
  priceChange90d?: number;
  stddevPopPrice7d?: number;
  priceHistory?: Array<{ p: number; t: number }>;
}

interface JustTcgCard {
  id: string;
  name: string;
  set: string;
  set_name: string;
  number: string;
  rarity?: string;
  variants: JustTcgVariant[];
}

interface JustTcgSet {
  id: string;
  name: string;
  cards_count: number;
}

interface ArchiveMetrics {
  game: string;
  setsProcessed: number;
  cardsArchived: number;
  conditionsArchived: number;
  historyRecords: number;
  errors: number;
  durationMs: number;
}

// =============================================================================
// JustTCG API Client
// =============================================================================

class JustTcgClient {
  private apiKey: string;
  private requestCount = 0;
  private minuteStart = Date.now();

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  private async rateLimit(): Promise<void> {
    const now = Date.now();
    if (now - this.minuteStart >= 60000) {
      this.requestCount = 0;
      this.minuteStart = now;
    }

    if (this.requestCount >= 45) {
      const waitTime = 60000 - (now - this.minuteStart) + 100;
      console.log(`   Rate limit approaching, waiting ${(waitTime / 1000).toFixed(1)}s...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
      this.requestCount = 0;
      this.minuteStart = Date.now();
    }

    this.requestCount++;
  }

  private async request<T>(endpoint: string, params?: Record<string, string | number>): Promise<T> {
    await this.rateLimit();

    const url = new URL(`${JUSTTCG_BASE_URL}${endpoint}`);
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      });
    }

    const response = await fetch(url.toString(), {
      headers: {
        Accept: 'application/json',
        'x-api-key': this.apiKey,
      },
    });

    if (!response.ok) {
      throw new Error(`JustTCG API error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  async getSets(gameId: string): Promise<JustTcgSet[]> {
    const response = await this.request<{ data: JustTcgSet[] }>('/sets', { game: gameId });
    return response.data || [];
  }

  async getCards(gameId: string, setId: string, limit = 100, offset = 0): Promise<{
    cards: JustTcgCard[];
    total: number;
    hasMore: boolean;
  }> {
    const response = await this.request<{
      data: JustTcgCard[];
      meta: { total: number; hasMore: boolean };
    }>('/cards', {
      game: gameId,
      set: setId,
      limit,
      offset,
    });

    return {
      cards: response.data || [],
      total: response.meta?.total || 0,
      hasMore: response.meta?.hasMore || false,
    };
  }
}

// =============================================================================
// Data Processing
// =============================================================================

function parseSetCode(cardNumber: string): { setCode: string; number: string } {
  const match = cardNumber.match(/^([A-Z]+\d+)-(.+)$/i);
  if (match) {
    return { setCode: match[1].toUpperCase(), number: match[2] };
  }
  return { setCode: '', number: cardNumber };
}

function detectVariantType(name: string, printing: string): string | null {
  const combined = `${name} ${printing}`.toLowerCase();

  if (combined.includes('parallel')) return 'parallel';
  if (combined.includes('alternate art') || combined.includes('alt art')) return 'alternate-art';
  if (combined.includes('manga')) return 'manga';
  if (combined.includes('special') || combined.includes(' sp')) return 'sp';
  if (combined.includes('secret')) return 'spr';
  if (combined.includes('treasure')) return 'tr';
  if (combined.includes('foil') && !combined.includes('non-foil')) return 'foil';

  return null;
}

function mapConditionCode(condition: string): string {
  const condLower = condition.toLowerCase();
  if (condLower.includes('near mint') || condLower === 'nm') return 'NM';
  if (condLower.includes('lightly') || condLower === 'lp') return 'LP';
  if (condLower.includes('moderately') || condLower === 'mp') return 'MP';
  if (condLower.includes('heavily') || condLower === 'hp') return 'HP';
  if (condLower.includes('damaged') || condLower === 'dmg') return 'DMG';
  if (condLower.includes('sealed')) return 'SEALED';
  return 'NM';
}

// =============================================================================
// Archive Function
// =============================================================================

async function archiveGame(
  client: JustTcgClient,
  db: PrismaClient | null,
  game: { id: string; name: string; code: string },
  date: Date
): Promise<ArchiveMetrics> {
  const startTime = Date.now();
  const metrics: ArchiveMetrics = {
    game: game.code,
    setsProcessed: 0,
    cardsArchived: 0,
    conditionsArchived: 0,
    historyRecords: 0,
    errors: 0,
    durationMs: 0,
  };

  const dateStr = date.toISOString().split('T')[0];
  console.log(`\n📦 Archiving ${game.name} for ${dateStr}`);

  try {
    const sets = await client.getSets(game.id);
    console.log(`   Found ${sets.length} sets`);

    let totalCardsArchived = 0;

    for (const set of sets) {
      if (limitArg > 0 && totalCardsArchived >= limitArg) {
        console.log(`   Reached card limit (${limitArg}), stopping...`);
        break;
      }

      console.log(`   📂 ${set.name} (${set.cards_count || 0} cards)`);

      let offset = 0;
      let hasMore = true;

      while (hasMore) {
        if (limitArg > 0 && totalCardsArchived >= limitArg) break;

        const { cards, hasMore: more } = await client.getCards(game.id, set.id, 100, offset);
        hasMore = more;
        offset += 100;

        for (const card of cards) {
          if (limitArg > 0 && totalCardsArchived >= limitArg) break;

          try {
            const { setCode, number } = parseSetCode(card.number);
            if (!setCode) continue;

            for (const variant of card.variants) {
              const variantType = detectVariantType(card.name, variant.printing);
              const conditionCode = mapConditionCode(variant.condition);
              const cardId = variantType ? `${setCode}-${number}-${variantType}` : `${setCode}-${number}`;
              const priceUsd = variant.price || 0;
              const priceGbp = Math.round(priceUsd * USD_TO_GBP * 100) / 100;

              if (VERBOSE) {
                console.log(`      ${cardId}: $${priceUsd.toFixed(2)} (${conditionCode})`);
              }

              if (!DRY_RUN && db) {
                // Archive daily price snapshot
                const archiveResult = await db.$queryRaw<{ id: number }[]>`
                  INSERT INTO "tcgplayer_price_archive" (
                    "card_id", "date", "game", "set_code", "card_number", "variant_type",
                    "card_name", "market_price_usd", "low_price_usd", "market_price_gbp", "low_price_gbp",
                    "price_change_7d", "price_change_30d", "price_change_90d",
                    "std_dev", "data_source", "scraped_at"
                  ) VALUES (
                    ${cardId}, ${date}::date, ${game.code}, ${setCode}, ${number}, ${variantType},
                    ${card.name}, ${priceUsd}, ${priceUsd}, ${priceGbp}, ${priceGbp},
                    ${variant.priceChange7d || null}, ${variant.priceChange30d || null}, ${variant.priceChange90d || null},
                    ${variant.stddevPopPrice7d || null}, 'justtcg', NOW()
                  )
                  ON CONFLICT ("card_id", "date") DO UPDATE SET
                    "market_price_usd" = EXCLUDED."market_price_usd",
                    "low_price_usd" = EXCLUDED."low_price_usd",
                    "market_price_gbp" = EXCLUDED."market_price_gbp",
                    "low_price_gbp" = EXCLUDED."low_price_gbp",
                    "price_change_7d" = EXCLUDED."price_change_7d",
                    "price_change_30d" = EXCLUDED."price_change_30d",
                    "price_change_90d" = EXCLUDED."price_change_90d"
                  RETURNING id
                `;
                const archiveId = archiveResult[0]?.id;
                metrics.cardsArchived++;

                // Archive condition snapshot
                if (archiveId) {
                  const conditionId = { NM: 1, LP: 2, MP: 3, HP: 4, DMG: 5, SEALED: 0 }[conditionCode] || 1;
                  await db.$executeRaw`
                    INSERT INTO "tcgplayer_condition_snapshot" (
                      "archive_id", "card_id", "date", "condition_id", "condition_code", "printing",
                      "price_usd", "price_gbp"
                    ) VALUES (
                      ${archiveId}, ${cardId}, ${date}::date, ${conditionId}, ${conditionCode}, ${variant.printing},
                      ${priceUsd}, ${priceGbp}
                    )
                    ON CONFLICT ("card_id", "date", "condition_code", "printing") DO UPDATE SET
                      "price_usd" = EXCLUDED."price_usd",
                      "price_gbp" = EXCLUDED."price_gbp",
                      "archive_id" = EXCLUDED."archive_id"
                  `;
                  metrics.conditionsArchived++;
                }

                // Archive price history
                if (variant.priceHistory && variant.priceHistory.length > 0) {
                  for (const point of variant.priceHistory.slice(-30)) {
                    const historyTimestamp = new Date(point.t * 1000);
                    const historyPriceGbp = Math.round(point.p * USD_TO_GBP * 100) / 100;

                    await db.$executeRaw`
                      INSERT INTO "tcgplayer_price_history" (
                        "card_id", "timestamp", "price_usd", "price_gbp", "data_source", "created_at"
                      ) VALUES (
                        ${cardId}, ${historyTimestamp}, ${point.p}, ${historyPriceGbp}, 'justtcg', NOW()
                      )
                      ON CONFLICT ("card_id", "timestamp") DO NOTHING
                    `;
                    metrics.historyRecords++;
                  }
                }
              } else {
                metrics.cardsArchived++;
                metrics.conditionsArchived++;
              }

              totalCardsArchived++;
            }
          } catch (cardError) {
            console.warn(`      ❌ Error archiving ${card.id}:`, cardError);
            metrics.errors++;
          }
        }

        await new Promise(resolve => setTimeout(resolve, 200));
      }

      metrics.setsProcessed++;
    }
  } catch (error) {
    console.error(`   ❌ Error archiving ${game.name}:`, error);
    metrics.errors++;
  }

  metrics.durationMs = Date.now() - startTime;
  return metrics;
}

// =============================================================================
// Listings Archive (via TCGPlayer Search API)
// =============================================================================

interface ListingsMetrics {
  game: string;
  setsProcessed: number;
  productsScraped: number;
  listingsArchived: number;
  errors: number;
  durationMs: number;
}

async function archiveListings(
  db: PrismaClient | null,
  game: { id: string; name: string; code: string },
  date: Date,
  setCodes?: string[]
): Promise<ListingsMetrics> {
  const startTime = Date.now();
  const metrics: ListingsMetrics = {
    game: game.code,
    setsProcessed: 0,
    productsScraped: 0,
    listingsArchived: 0,
    errors: 0,
    durationMs: 0,
  };

  const gameCode = game.code as GameCode;
  const dateStr = date.toISOString().split('T')[0];

  console.log(`\n📋 Archiving Listings for ${game.name} (${dateStr})`);

  const scraper = createTCGPlayerSearchScraper(gameCode, {
    includeListings: true,
    maxListingsPerProduct: 50,
    requestDelayMs: 1500,
  });

  try {
    // Get sets to scrape
    const sets = scraper.getAvailableSets();
    const setsToScrape = setCodes
      ? sets.filter(s => setCodes.map(c => c.toUpperCase()).includes(s.code.toUpperCase()))
      : sets.slice(0, 3); // Default: first 3 sets to avoid overwhelming

    console.log(`   Sets to scrape: ${setsToScrape.map(s => s.code).join(', ')}`);

    for (const set of setsToScrape) {
      try {
        console.log(`\n   📦 ${set.name} (${set.code})`);
        const products = await scraper.scrapeSet(set.code, {
          maxProducts: limitArg > 0 ? limitArg : undefined,
        });

        for (const product of products) {
          try {
            // Skip products without listings
            if (product.listings.length === 0) continue;

            const cardId = product.cardNumber
              ? `${product.cardNumber.split('-')[0]}-${product.cardNumber.split('-')[1]}`
              : `TCGP-${product.productId}`;

            if (VERBOSE) {
              console.log(`      ${product.productName}: ${product.listings.length} listings`);
            }

            if (!DRY_RUN && db) {
              // Ensure card exists in Card table
              await db.$executeRaw`
                INSERT INTO "Card" ("id", "name", "game", "setCode", "setName", "cardNumber", "rarity", "marketPrice", "lowPrice", "createdAt", "updatedAt")
                VALUES (
                  ${String(product.productId)},
                  ${product.productName},
                  ${game.code},
                  ${set.code},
                  ${product.setName},
                  ${product.cardNumber},
                  ${product.rarity},
                  ${product.marketPrice || 0},
                  ${product.lowestPrice || 0},
                  NOW(),
                  NOW()
                )
                ON CONFLICT ("id") DO UPDATE SET
                  "name" = EXCLUDED."name",
                  "marketPrice" = EXCLUDED."marketPrice",
                  "lowPrice" = EXCLUDED."lowPrice",
                  "updatedAt" = NOW()
              `;

              // Create listing snapshot with aggregate stats
              const listingsJson = JSON.stringify(product.listings);
              const avgPrice = product.listings.reduce((sum, l) => sum + l.price, 0) / product.listings.length;
              const minPrice = Math.min(...product.listings.map(l => l.price));
              const maxPrice = Math.max(...product.listings.map(l => l.price));

              await db.$executeRaw`
                INSERT INTO "ListingSnapshot" (
                  "id", "cardId", "snapshotAt", "listingCount", "avgPrice", "minPrice", "maxPrice", "marketPrice", "listingsJson"
                ) VALUES (
                  ${`snapshot-${product.productId}-${Date.now()}`},
                  ${String(product.productId)},
                  NOW(),
                  ${product.listings.length},
                  ${avgPrice},
                  ${minPrice},
                  ${maxPrice},
                  ${product.marketPrice || avgPrice},
                  ${listingsJson}::jsonb
                )
              `;

              // Archive individual listings
              for (const listing of product.listings) {
                const conditionCode = mapConditionCodeFromListing(listing.condition);

                await db.$executeRaw`
                  INSERT INTO "Listing" (
                    "id", "cardId", "sellerId", "sellerName", "sellerRating", "sellerSalesCount",
                    "price", "condition", "quantity", "shippingCost", "language", "isFeatured",
                    "marketPriceAtListing", "lowPriceAtListing", "firstSeenAt", "lastSeenAt", "isActive"
                  ) VALUES (
                    ${`listing-${listing.listingId}`},
                    ${String(product.productId)},
                    ${listing.sellerId},
                    ${listing.sellerName},
                    ${listing.sellerRating / 100.0},
                    ${listing.sellerSales},
                    ${listing.price},
                    ${conditionCode},
                    ${listing.quantity},
                    ${listing.shippingPrice},
                    ${listing.language},
                    ${listing.goldSeller || listing.verifiedSeller},
                    ${product.marketPrice || null},
                    ${product.lowestPrice || null},
                    NOW(),
                    NOW(),
                    true
                  )
                  ON CONFLICT ("cardId", "sellerId", "price", "condition") DO UPDATE SET
                    "lastSeenAt" = NOW(),
                    "quantity" = EXCLUDED."quantity",
                    "isActive" = true
                `;

                metrics.listingsArchived++;
              }
            } else {
              metrics.listingsArchived += product.listings.length;
            }

            metrics.productsScraped++;
          } catch (productError) {
            console.warn(`      ❌ Error archiving ${product.productName}:`, productError);
            metrics.errors++;
          }
        }

        metrics.setsProcessed++;
      } catch (setError) {
        console.warn(`   ❌ Error scraping ${set.code}:`, setError);
        metrics.errors++;
      }
    }
  } catch (error) {
    console.error(`   ❌ Error archiving listings for ${game.name}:`, error);
    metrics.errors++;
  }

  metrics.durationMs = Date.now() - startTime;
  return metrics;
}

function mapConditionCodeFromListing(condition: string): string {
  const condLower = condition.toLowerCase();
  if (condLower.includes('near mint') || condLower === 'nm') return 'NM';
  if (condLower.includes('lightly') || condLower === 'lp') return 'LP';
  if (condLower.includes('moderately') || condLower === 'mp') return 'MP';
  if (condLower.includes('heavily') || condLower === 'hp') return 'HP';
  if (condLower.includes('damaged') || condLower === 'dmg') return 'DMG';
  return 'NM';
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  📊 TCGPlayer Daily Archive - Local CLI');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  JustTCG API Key: ${JUSTTCG_API_KEY ? '✅ Configured' : '❌ Missing'}`);
  console.log(`  Database URL: ${DATABASE_URL ? '✅ Configured' : '❌ Missing'}`);
  console.log(`  Mode: ${DRY_RUN ? '🔍 DRY RUN' : '💾 LIVE'}`);
  console.log(`  Games: ${GAMES_TO_ARCHIVE.map(g => g.name).join(', ')}`);
  console.log(`  Listings: ${WITH_LISTINGS ? '✅ Enabled' : '❌ Disabled'}`);
  if (setArg) console.log(`  Set Filter: ${setArg}`);
  if (limitArg > 0) console.log(`  Card Limit: ${limitArg}`);
  console.log('═══════════════════════════════════════════════════════════════');

  if (!JUSTTCG_API_KEY) {
    console.error('\n❌ JUSTTCG_API_KEY not set. Run: source ../../../secrets/.env.keys');
    process.exit(1);
  }

  if (!DATABASE_URL && !DRY_RUN) {
    console.error('\n❌ DATABASE_URL not set. Run: source ../../../secrets/.env.keys');
    process.exit(1);
  }

  const client = new JustTcgClient(JUSTTCG_API_KEY);

  // Only initialize Prisma if not in dry-run mode
  let db: PrismaClient | null = null;
  if (!DRY_RUN) {
    db = new PrismaClient({
      datasources: { db: { url: DATABASE_URL } },
      log: ['error'],
    });
  }

  const today = new Date();
  const allMetrics: ArchiveMetrics[] = [];

  try {
    for (const game of GAMES_TO_ARCHIVE) {
      const metrics = await archiveGame(client, db, game, today);
      allMetrics.push(metrics);

      console.log(`\n   ✅ ${game.name} Complete:`);
      console.log(`      Sets: ${metrics.setsProcessed}`);
      console.log(`      Cards: ${metrics.cardsArchived}`);
      console.log(`      Conditions: ${metrics.conditionsArchived}`);
      console.log(`      History: ${metrics.historyRecords}`);
      console.log(`      Errors: ${metrics.errors}`);
      console.log(`      Duration: ${(metrics.durationMs / 1000).toFixed(1)}s`);
    }

    // Summary for price archive
    const totalCards = allMetrics.reduce((sum, m) => sum + m.cardsArchived, 0);
    const totalConditions = allMetrics.reduce((sum, m) => sum + m.conditionsArchived, 0);
    const totalHistory = allMetrics.reduce((sum, m) => sum + m.historyRecords, 0);
    const totalErrors = allMetrics.reduce((sum, m) => sum + m.errors, 0);
    const totalDuration = allMetrics.reduce((sum, m) => sum + m.durationMs, 0);

    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('  📊 PRICE ARCHIVE COMPLETE');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`  Total Cards: ${totalCards.toLocaleString()}`);
    console.log(`  Total Conditions: ${totalConditions.toLocaleString()}`);
    console.log(`  Total History: ${totalHistory.toLocaleString()}`);
    console.log(`  Total Errors: ${totalErrors}`);
    console.log(`  Total Duration: ${(totalDuration / 1000).toFixed(1)}s`);

    // Archive listings if requested
    if (WITH_LISTINGS) {
      console.log('\n═══════════════════════════════════════════════════════════════');
      console.log('  📋 ARCHIVING INDIVIDUAL LISTINGS');
      console.log('═══════════════════════════════════════════════════════════════');

      const listingsMetrics: ListingsMetrics[] = [];
      const setCodes = setArg ? [setArg] : undefined;

      for (const game of GAMES_TO_ARCHIVE) {
        const metrics = await archiveListings(db, game, today, setCodes);
        listingsMetrics.push(metrics);

        console.log(`\n   ✅ ${game.name} Listings Complete:`);
        console.log(`      Sets: ${metrics.setsProcessed}`);
        console.log(`      Products: ${metrics.productsScraped}`);
        console.log(`      Listings: ${metrics.listingsArchived}`);
        console.log(`      Errors: ${metrics.errors}`);
        console.log(`      Duration: ${(metrics.durationMs / 1000).toFixed(1)}s`);
      }

      const totalListings = listingsMetrics.reduce((sum, m) => sum + m.listingsArchived, 0);
      const totalProducts = listingsMetrics.reduce((sum, m) => sum + m.productsScraped, 0);
      const listingsErrors = listingsMetrics.reduce((sum, m) => sum + m.errors, 0);
      const listingsDuration = listingsMetrics.reduce((sum, m) => sum + m.durationMs, 0);

      console.log('\n═══════════════════════════════════════════════════════════════');
      console.log('  📋 LISTINGS ARCHIVE COMPLETE');
      console.log('═══════════════════════════════════════════════════════════════');
      console.log(`  Total Products: ${totalProducts.toLocaleString()}`);
      console.log(`  Total Listings: ${totalListings.toLocaleString()}`);
      console.log(`  Errors: ${listingsErrors}`);
      console.log(`  Duration: ${(listingsDuration / 1000).toFixed(1)}s`);
    }

    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log(`  ✅ ALL ARCHIVES COMPLETE`);
    console.log(`  Mode: ${DRY_RUN ? '🔍 DRY RUN (no data saved)' : '💾 LIVE (data saved to RDS)'}`);
    console.log('═══════════════════════════════════════════════════════════════\n');
  } finally {
    if (db) {
      await db.$disconnect();
    }
  }
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
