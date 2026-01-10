#!/usr/bin/env npx tsx
/**
 * Daily Price History Snapshot
 *
 * Captures current card_prices_v2 data into price_history_daily table.
 * Designed to run twice daily (8 AM, 8 PM UTC) via Lambda or cron.
 *
 * Features:
 * - Snapshots all variant cards with prices
 * - Converts USD prices to GBP using current FX rates
 * - Calculates EU/US spreads for arbitrage detection
 * - Tracks listing counts for liquidity analysis
 * - Idempotent: safe to run multiple times per day (upserts)
 *
 * Usage:
 *   npx tsx scripts/snapshot-history.ts [--dry-run]
 */

import { PrismaClient, Prisma } from '@prisma/client';

// =============================================================================
// CONFIGURATION
// =============================================================================

const FX_RATES = {
  USD_GBP: 0.79,  // Current USD to GBP rate
  EUR_GBP: 0.85,  // Current EUR to GBP rate
};

interface SnapshotStats {
  date: string;
  cardsProcessed: number;
  snapshotsCreated: number;
  snapshotsUpdated: number;
  errors: number;
  executionTimeMs: number;
}

// =============================================================================
// MAIN SNAPSHOT FUNCTION
// =============================================================================

async function createDailySnapshot(dryRun: boolean = false): Promise<SnapshotStats> {
  const startTime = Date.now();
  const prisma = new PrismaClient();
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const dateStr = today.toISOString().split('T')[0];

  const stats: SnapshotStats = {
    date: dateStr,
    cardsProcessed: 0,
    snapshotsCreated: 0,
    snapshotsUpdated: 0,
    errors: 0,
    executionTimeMs: 0,
  };

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  📸 Daily Price History Snapshot');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Date: ${dateStr}`);
  console.log(`  Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  try {
    // 1. Fetch all cards with prices from card_prices_v2
    console.log('📊 Fetching current card prices...');
    const cards = await prisma.cardPriceV2.findMany({
      where: {
        game: 'onepiece',
        OR: [
          { optcgTcgplayerUsd: { not: null } },
          { optcgTcgplayerGbp: { not: null } },
          { limitlessCardmarketEur: { not: null } },
        ],
      },
    });

    console.log(`   Found ${cards.length} cards with price data\n`);
    stats.cardsProcessed = cards.length;

    if (dryRun) {
      console.log('⚠️  DRY RUN - No database changes will be made\n');
      console.log('Sample of cards that would be snapshotted:');
      for (const card of cards.slice(0, 5)) {
        console.log(`   - ${card.cardId}: US $${card.optcgTcgplayerUsd || 'N/A'}, EU €${card.limitlessCardmarketEur || 'N/A'}`);
      }
      console.log(`   ... and ${cards.length - 5} more\n`);
    } else {
      // 2. Create/update price_history_daily records
      console.log('💾 Creating daily snapshots...');

      for (const card of cards) {
        try {
          // Convert prices to GBP
          const usMarketUsd = card.optcgTcgplayerUsd?.toNumber() || null;
          const usMarketGbp = usMarketUsd ? usMarketUsd * FX_RATES.USD_GBP : null;

          const euTrendEur = card.limitlessCardmarketEur?.toNumber() || null;
          const euTrendGbp = euTrendEur ? euTrendEur * FX_RATES.EUR_GBP : null;

          // Calculate spreads (EU vs US in GBP)
          let spreadEuToUs: number | null = null;
          let spreadUsToEu: number | null = null;

          if (euTrendGbp && usMarketGbp && usMarketGbp > 0) {
            // Positive = EU cheaper (buy EU, sell US)
            spreadEuToUs = (usMarketGbp - euTrendGbp) / usMarketGbp;
          }
          if (euTrendGbp && usMarketGbp && euTrendGbp > 0) {
            // Positive = US cheaper (buy US, sell EU)
            spreadUsToEu = (euTrendGbp - usMarketGbp) / euTrendGbp;
          }

          // Check if record exists
          const existing = await prisma.priceHistoryDaily.findFirst({
            where: {
              cardId: card.cardId,
              date: today,
            },
          });

          if (existing) {
            // Update existing
            await prisma.priceHistoryDaily.update({
              where: { id: existing.id },
              data: {
                usMarketUsd: usMarketUsd ? new Prisma.Decimal(usMarketUsd) : null,
                usMarketGbp: usMarketGbp ? new Prisma.Decimal(usMarketGbp) : null,
                euTrendEur: euTrendEur ? new Prisma.Decimal(euTrendEur) : null,
                euTrendGbp: euTrendGbp ? new Prisma.Decimal(euTrendGbp) : null,
                spreadEuToUs: spreadEuToUs ? new Prisma.Decimal(spreadEuToUs) : null,
                spreadUsToEu: spreadUsToEu ? new Prisma.Decimal(spreadUsToEu) : null,
                fxUsdGbp: new Prisma.Decimal(FX_RATES.USD_GBP),
                fxEurGbp: new Prisma.Decimal(FX_RATES.EUR_GBP),
              },
            });
            stats.snapshotsUpdated++;
          } else {
            // Create new
            await prisma.priceHistoryDaily.create({
              data: {
                cardId: card.cardId,
                date: today,
                usMarketUsd: usMarketUsd ? new Prisma.Decimal(usMarketUsd) : null,
                usMarketGbp: usMarketGbp ? new Prisma.Decimal(usMarketGbp) : null,
                euTrendEur: euTrendEur ? new Prisma.Decimal(euTrendEur) : null,
                euTrendGbp: euTrendGbp ? new Prisma.Decimal(euTrendGbp) : null,
                spreadEuToUs: spreadEuToUs ? new Prisma.Decimal(spreadEuToUs) : null,
                spreadUsToEu: spreadUsToEu ? new Prisma.Decimal(spreadUsToEu) : null,
                fxUsdGbp: new Prisma.Decimal(FX_RATES.USD_GBP),
                fxEurGbp: new Prisma.Decimal(FX_RATES.EUR_GBP),
              },
            });
            stats.snapshotsCreated++;
          }

          // Progress indicator
          if ((stats.snapshotsCreated + stats.snapshotsUpdated) % 100 === 0) {
            process.stdout.write(`   Processed ${stats.snapshotsCreated + stats.snapshotsUpdated}/${cards.length}...\r`);
          }
        } catch (error) {
          stats.errors++;
          console.error(`   ❌ Error processing ${card.cardId}:`, error);
        }
      }

      console.log(`\n   ✅ Created: ${stats.snapshotsCreated} new snapshots`);
      console.log(`   ✅ Updated: ${stats.snapshotsUpdated} existing snapshots`);
      if (stats.errors > 0) {
        console.log(`   ⚠️  Errors: ${stats.errors}`);
      }
    }

    // 3. Verify total history records
    const totalHistory = await prisma.priceHistoryDaily.count();
    const todayHistory = await prisma.priceHistoryDaily.count({
      where: { date: today },
    });

    console.log(`\n📈 Database Status:`);
    console.log(`   Today's snapshots: ${todayHistory}`);
    console.log(`   Total history records: ${totalHistory}`);

    // 4. Calculate days of history
    const oldestRecord = await prisma.priceHistoryDaily.findFirst({
      orderBy: { date: 'asc' },
    });

    if (oldestRecord) {
      const daysDiff = Math.floor((today.getTime() - oldestRecord.date.getTime()) / (1000 * 60 * 60 * 24));
      console.log(`   History span: ${daysDiff} days (since ${oldestRecord.date.toISOString().split('T')[0]})`);

      if (daysDiff < 14) {
        console.log(`\n   ⚠️  Need ${14 - daysDiff} more days before training viable (14 min)`);
      } else if (daysDiff < 30) {
        console.log(`\n   🟡 Training viable! ${30 - daysDiff} more days until optimal (30 days)`);
      } else {
        console.log(`\n   ✅ Optimal training data available (30+ days)`);
      }
    }

  } catch (error) {
    console.error('❌ Snapshot failed:', error);
    stats.errors++;
  } finally {
    await prisma.$disconnect();
  }

  stats.executionTimeMs = Date.now() - startTime;

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  ✅ SNAPSHOT COMPLETE');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Cards processed: ${stats.cardsProcessed}`);
  console.log(`  Snapshots created: ${stats.snapshotsCreated}`);
  console.log(`  Snapshots updated: ${stats.snapshotsUpdated}`);
  console.log(`  Errors: ${stats.errors}`);
  console.log(`  Execution time: ${stats.executionTimeMs}ms`);
  console.log('═══════════════════════════════════════════════════════════════');

  return stats;
}

// =============================================================================
// CLI ENTRY POINT
// =============================================================================

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');

  await createDailySnapshot(dryRun);
}

main().catch(console.error);

export { createDailySnapshot };
