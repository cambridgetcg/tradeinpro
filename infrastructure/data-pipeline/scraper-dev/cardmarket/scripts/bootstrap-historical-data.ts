#!/usr/bin/env npx tsx
/**
 * Bootstrap Historical Price Data
 *
 * Creates synthetic historical data for ML training by:
 * 1. Converting eBay listings to price_history_daily format
 * 2. Backfilling from card_prices_v2 with date variations
 * 3. Applying realistic price variance to simulate market movement
 *
 * This enables the LSTM training pipeline to start immediately
 * rather than waiting 30 days for organic data collection.
 *
 * Usage:
 *   npx tsx scripts/bootstrap-historical-data.ts [--dry-run] [--days=30]
 */

import { PrismaClient, Prisma } from '@prisma/client';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

// =============================================================================
// CONFIGURATION
// =============================================================================

const FX_RATES = {
  USD_GBP: 0.79,
  EUR_GBP: 0.85,
};

// Price variance parameters for synthetic history
const VARIANCE = {
  dailyVolatility: 0.02,      // 2% daily volatility
  trendBias: 0.001,           // Slight upward trend (0.1% per day)
  meanReversion: 0.1,         // Mean reversion strength
};

interface BootstrapStats {
  ebayListingsProcessed: number;
  cardPricesProcessed: number;
  historyRecordsCreated: number;
  daysBootstrapped: number;
  errors: number;
  executionTimeMs: number;
}

interface EbayListing {
  cardId: string;
  priceUsd: number;
  collectedAt: string;
  variant: string;
  language: string;
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Generate random price with realistic market movement
 */
function generateVariantPrice(basePrice: number, dayOffset: number, seed: number): number {
  // Seeded random for reproducibility
  const random = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };

  // Apply daily volatility with mean reversion
  let price = basePrice;

  for (let d = 0; d < Math.abs(dayOffset); d++) {
    const noise = (random() - 0.5) * 2 * VARIANCE.dailyVolatility;
    const trend = VARIANCE.trendBias * (dayOffset > 0 ? 1 : -1);
    const reversion = (basePrice - price) / basePrice * VARIANCE.meanReversion;

    price = price * (1 + noise + trend + reversion);
  }

  // Ensure price doesn't go negative
  return Math.max(price, basePrice * 0.3);
}

/**
 * Parse NDJSON file
 */
function parseNdjsonFile(filePath: string): EbayListing[] {
  if (!existsSync(filePath)) {
    console.log(`   ⚠️  File not found: ${filePath}`);
    return [];
  }

  const content = readFileSync(filePath, 'utf-8');
  const lines = content.trim().split('\n');
  const listings: EbayListing[] = [];

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed.cardId && parsed.priceUsd) {
        listings.push(parsed);
      }
    } catch {
      // Skip invalid lines
    }
  }

  return listings;
}

/**
 * Group listings by cardId and calculate median price
 */
function aggregateByCard(listings: EbayListing[]): Map<string, number> {
  const cardPrices = new Map<string, number[]>();

  for (const listing of listings) {
    const prices = cardPrices.get(listing.cardId) || [];
    prices.push(listing.priceUsd);
    cardPrices.set(listing.cardId, prices);
  }

  // Calculate median for each card
  const medians = new Map<string, number>();
  for (const [cardId, prices] of cardPrices) {
    prices.sort((a, b) => a - b);
    const mid = Math.floor(prices.length / 2);
    const median = prices.length % 2 ? prices[mid] : (prices[mid - 1] + prices[mid]) / 2;
    medians.set(cardId, median);
  }

  return medians;
}

// =============================================================================
// MAIN BOOTSTRAP FUNCTION
// =============================================================================

async function bootstrapHistoricalData(
  dryRun: boolean = false,
  daysToBootstrap: number = 30
): Promise<BootstrapStats> {
  const startTime = Date.now();
  const prisma = new PrismaClient();

  const stats: BootstrapStats = {
    ebayListingsProcessed: 0,
    cardPricesProcessed: 0,
    historyRecordsCreated: 0,
    daysBootstrapped: daysToBootstrap,
    errors: 0,
    executionTimeMs: 0,
  };

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  🚀 Bootstrap Historical Price Data');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Days to bootstrap: ${daysToBootstrap}`);
  console.log(`  Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  try {
    // =========================================================================
    // PHASE 1: Process eBay historical data
    // =========================================================================
    console.log('📦 PHASE 1: Processing eBay historical data...\n');

    const ebayDataPath = join(process.cwd(), 'data/ebay-historical');
    let ebayFiles: string[] = [];
    if (existsSync(ebayDataPath)) {
      const { readdirSync } = await import('fs');
      ebayFiles = readdirSync(ebayDataPath).filter((f: string) => f.endsWith('.ndjson'));
    }

    if (ebayFiles.length === 0) {
      console.log('   ⚠️  No eBay NDJSON files found in data/ebay-historical/');
    } else {
      for (const file of ebayFiles) {
        const filePath = join(ebayDataPath, file);
        console.log(`   Processing: ${file}`);

        const listings = parseNdjsonFile(filePath);
        stats.ebayListingsProcessed += listings.length;

        const cardMedians = aggregateByCard(listings);
        console.log(`   - ${listings.length} listings → ${cardMedians.size} unique cards`);

        if (!dryRun) {
          // Create history entries for each card with variance
          const today = new Date();
          today.setUTCHours(0, 0, 0, 0);

          for (const [cardId, medianPrice] of cardMedians) {
            // Create entries for past days
            for (let dayOffset = daysToBootstrap; dayOffset >= 0; dayOffset--) {
              const date = new Date(today);
              date.setDate(date.getDate() - dayOffset);

              // Generate synthetic price with variance
              const seed = cardId.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) + dayOffset;
              const syntheticPrice = generateVariantPrice(medianPrice, dayOffset, seed);
              const priceGbp = syntheticPrice * FX_RATES.USD_GBP;

              try {
                // Check if record exists
                const existing = await prisma.priceHistoryDaily.findFirst({
                  where: { cardId, date },
                });

                if (!existing) {
                  await prisma.priceHistoryDaily.create({
                    data: {
                      cardId,
                      date,
                      usMarketUsd: new Prisma.Decimal(syntheticPrice),
                      usMarketGbp: new Prisma.Decimal(priceGbp),
                      fxUsdGbp: new Prisma.Decimal(FX_RATES.USD_GBP),
                      fxEurGbp: new Prisma.Decimal(FX_RATES.EUR_GBP),
                    },
                  });
                  stats.historyRecordsCreated++;
                }
              } catch (error) {
                stats.errors++;
              }
            }

            // Progress indicator
            if (stats.historyRecordsCreated % 500 === 0) {
              process.stdout.write(`   Created ${stats.historyRecordsCreated} records...\r`);
            }
          }
        }
      }
    }

    console.log(`\n   ✅ eBay phase complete: ${stats.ebayListingsProcessed} listings processed\n`);

    // =========================================================================
    // PHASE 2: Backfill from card_prices_v2
    // =========================================================================
    console.log('📊 PHASE 2: Backfilling from card_prices_v2...\n');

    const cards = await prisma.cardPriceV2.findMany({
      where: {
        game: 'onepiece',
        OR: [
          { optcgTcgplayerUsd: { not: null } },
          { limitlessCardmarketEur: { not: null } },
        ],
      },
    });

    console.log(`   Found ${cards.length} cards with price data`);
    stats.cardPricesProcessed = cards.length;

    if (!dryRun) {
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);

      for (const card of cards) {
        const baseUsd = card.optcgTcgplayerUsd?.toNumber() || null;
        const baseEur = card.limitlessCardmarketEur?.toNumber() || null;

        if (!baseUsd && !baseEur) continue;

        // Create entries for past days
        for (let dayOffset = daysToBootstrap; dayOffset >= 0; dayOffset--) {
          const date = new Date(today);
          date.setDate(date.getDate() - dayOffset);

          // Check if record already exists (from eBay phase)
          const existing = await prisma.priceHistoryDaily.findFirst({
            where: { cardId: card.cardId, date },
          });

          if (existing) continue; // Skip if already has data

          // Generate synthetic prices
          const seed = card.cardId.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) + dayOffset;

          try {
            const data: any = {
              cardId: card.cardId,
              date,
              fxUsdGbp: new Prisma.Decimal(FX_RATES.USD_GBP),
              fxEurGbp: new Prisma.Decimal(FX_RATES.EUR_GBP),
            };

            if (baseUsd) {
              const syntheticUsd = generateVariantPrice(baseUsd, dayOffset, seed);
              data.usMarketUsd = new Prisma.Decimal(syntheticUsd);
              data.usMarketGbp = new Prisma.Decimal(syntheticUsd * FX_RATES.USD_GBP);
            }

            if (baseEur) {
              const syntheticEur = generateVariantPrice(baseEur, dayOffset, seed + 1000);
              data.euTrendEur = new Prisma.Decimal(syntheticEur);
              data.euTrendGbp = new Prisma.Decimal(syntheticEur * FX_RATES.EUR_GBP);

              // Calculate spread if both prices available
              if (data.usMarketGbp && data.euTrendGbp) {
                const usGbp = data.usMarketGbp.toNumber();
                const euGbp = data.euTrendGbp.toNumber();
                if (usGbp > 0) {
                  data.spreadEuToUs = new Prisma.Decimal((usGbp - euGbp) / usGbp);
                }
                if (euGbp > 0) {
                  data.spreadUsToEu = new Prisma.Decimal((euGbp - usGbp) / euGbp);
                }
              }
            }

            await prisma.priceHistoryDaily.create({ data });
            stats.historyRecordsCreated++;

            // Progress indicator
            if (stats.historyRecordsCreated % 500 === 0) {
              process.stdout.write(`   Created ${stats.historyRecordsCreated} records...\r`);
            }
          } catch (error) {
            stats.errors++;
          }
        }
      }
    }

    console.log(`\n   ✅ Backfill phase complete\n`);

    // =========================================================================
    // SUMMARY
    // =========================================================================
    const totalHistory = await prisma.priceHistoryDaily.count();
    const uniqueCards = await prisma.priceHistoryDaily.groupBy({
      by: ['cardId'],
    });

    console.log('📈 Database Summary:');
    console.log(`   Total history records: ${totalHistory}`);
    console.log(`   Unique cards: ${uniqueCards.length}`);
    console.log(`   Days of history: ${daysToBootstrap}`);

    // Check training readiness
    const minCardsForTraining = 100;
    const minDaysForTraining = 14;

    if (uniqueCards.length >= minCardsForTraining && daysToBootstrap >= minDaysForTraining) {
      console.log(`\n   ✅ Training data requirements met!`);
      console.log(`   ✅ Ready to run: npx tsx src/pipeline/training-exporter.ts`);
    } else {
      console.log(`\n   ⚠️  Training requirements:`);
      console.log(`      Cards: ${uniqueCards.length}/${minCardsForTraining} ${uniqueCards.length >= minCardsForTraining ? '✅' : '❌'}`);
      console.log(`      Days: ${daysToBootstrap}/${minDaysForTraining} ${daysToBootstrap >= minDaysForTraining ? '✅' : '❌'}`);
    }

  } catch (error) {
    console.error('❌ Bootstrap failed:', error);
    stats.errors++;
  } finally {
    await prisma.$disconnect();
  }

  stats.executionTimeMs = Date.now() - startTime;

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  ✅ BOOTSTRAP COMPLETE');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  eBay listings processed: ${stats.ebayListingsProcessed}`);
  console.log(`  Card prices processed: ${stats.cardPricesProcessed}`);
  console.log(`  History records created: ${stats.historyRecordsCreated}`);
  console.log(`  Days bootstrapped: ${stats.daysBootstrapped}`);
  console.log(`  Errors: ${stats.errors}`);
  console.log(`  Execution time: ${(stats.executionTimeMs / 1000).toFixed(1)}s`);
  console.log('═══════════════════════════════════════════════════════════════');

  return stats;
}

// =============================================================================
// CLI ENTRY POINT
// =============================================================================

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');

  // Parse --days=N argument
  const daysArg = args.find(a => a.startsWith('--days='));
  const days = daysArg ? parseInt(daysArg.split('=')[1], 10) : 30;

  await bootstrapHistoricalData(dryRun, days);
}

main().catch(console.error);

export { bootstrapHistoricalData };
