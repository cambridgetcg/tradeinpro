/**
 * Debug script to understand why deal generation has so many errors
 */

import { PrismaClient } from "@prisma/client";
import { FeatureCalculator } from "../app/lib/neural/features.server";

const prisma = new PrismaClient();

async function main() {
  // Get a few cards with history
  const cardIds = await prisma.$queryRaw<{ card_id: string }[]>`
    SELECT card_id FROM card_price_history
    WHERE game = 'onepiece'
    GROUP BY card_id
    HAVING COUNT(DISTINCT DATE(snapshot_date)) >= 14
    LIMIT 10
  `;
  console.log("Found", cardIds.length, "cards to test");

  const testDate = new Date("2025-12-20");
  const dateStr = testDate.toISOString().split("T")[0];

  let successCount = 0;
  let errorCount = 0;
  let skipCount = 0;

  for (const { card_id: cardId } of cardIds) {
    try {
      const card = await prisma.cardPriceV2.findFirst({
        where: { cardId },
      });

      if (card === null) {
        console.log(cardId, "- not found in cardPriceV2");
        skipCount++;
        continue;
      }

      const startDate = new Date(testDate);
      startDate.setDate(startDate.getDate() - 30);

      const history = await prisma.cardPriceHistory.findMany({
        where: {
          cardId,
          snapshotDate: { gte: startDate, lte: testDate },
        },
        orderBy: { snapshotDate: "asc" },
      });

      const dateHistory = history.find(
        (h) => h.snapshotDate.toISOString().split("T")[0] === dateStr
      );

      if (dateHistory === undefined) {
        console.log(cardId, "- no history for", dateStr, "(has", history.length, "records)");
        skipCount++;
        continue;
      }

      const currentPrice = Number(dateHistory.priceGbp);
      console.log(cardId, "- price:", currentPrice, "history:", history.length);

      // Try to build features
      const cardWithData = {
        card: {
          cardId: card.cardId,
          name: card.name,
          setCode: card.setCode,
          rarity: card.rarity,
          optcgTcgplayerGbp: { toNumber: () => currentPrice },
          limitlessCardmarketGbp: { toNumber: () => currentPrice * 0.9 },
          justtcgTcgplayerGbp: { toNumber: () => currentPrice * 1.02 },
          bestPriceGbp: { toNumber: () => currentPrice },
          tradeinPriceGbp: { toNumber: () => currentPrice * 0.7 },
        },
        history: history.map((h) => ({
          snapshotDate: h.snapshotDate,
          priceGbp: { toNumber: () => Number(h.priceGbp) },
          change: { toNumber: () => Number(h.change || 0) },
        })),
        sources: [{ priceGbp: { toNumber: () => currentPrice }, priceJpy: null }],
        fx: [{ jpyToGbp: { toNumber: () => 0.00472 } }],
      };

      const setStats = {
        setCode: card.setCode,
        cardCount: 100,
        avgPrice: 30,
        momentum7d: 0.05,
        pricePercentile: (price: number) => price / 100,
      };

      const gameStats = {
        tcg100AvgPrice: 25,
        sentiment: 0.2,
        getMarketCapRank: () => 50,
      };

      const calculator = new FeatureCalculator(cardWithData as any, setStats, gameStats);
      const features = calculator.calculate();

      console.log(cardId, "- features OK, RSI:", features.temporal.momentum_rsi.toFixed(2));
      successCount++;
    } catch (err) {
      errorCount++;
      console.error(cardId, "- ERROR:", (err as Error).message);
      console.error("  Stack:", (err as Error).stack?.split("\n").slice(0, 3).join("\n"));
    }
  }

  console.log("\n--- SUMMARY ---");
  console.log("Success:", successCount);
  console.log("Errors:", errorCount);
  console.log("Skipped:", skipCount);

  await prisma.$disconnect();
}

main();
