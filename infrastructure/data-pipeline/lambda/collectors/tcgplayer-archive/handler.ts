/**
 * TCGPlayer Daily Archive Lambda
 *
 * Collects price data from JustTCG API (primary) with Bright Data fallback
 * and archives to RDS PostgreSQL for historical price tracking.
 *
 * Schedule: Daily at 8 AM UTC
 *
 * Data saved:
 * - tcgplayer_price_archive: Daily price snapshots
 * - tcgplayer_condition_snapshot: Condition-level prices (NM, LP, MP, HP, DMG)
 * - tcgplayer_price_history: 180-day historical data from JustTCG
 */

import { Handler, ScheduledEvent } from "aws-lambda";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";
import {
  CloudWatchClient,
  PutMetricDataCommand,
} from "@aws-sdk/client-cloudwatch";
import { PrismaClient } from "@prisma/client";

// =============================================================================
// Configuration
// =============================================================================

const AWS_REGION = process.env.AWS_REGION || "us-east-1";
const ENVIRONMENT = process.env.ENVIRONMENT || "dev";
const JUSTTCG_BASE_URL = "https://api.justtcg.com/v1";
const USD_TO_GBP = 0.79;

// Games to archive
const GAMES_TO_ARCHIVE = [
  { id: "one-piece-card-game", name: "One Piece", code: "onepiece" },
  { id: "pokemon", name: "Pokemon", code: "pokemon" },
  { id: "disney-lorcana", name: "Lorcana", code: "lorcana" },
];

// =============================================================================
// Types
// =============================================================================

interface Secrets {
  justtcg_api_key: string;
  brightdata_token?: string;
  database_url: string;
}

interface JustTcgSet {
  id: string;
  name: string;
  cards_count: number;
  release_date?: string;
}

interface JustTcgVariant {
  id: string;
  condition: string;
  printing: string;
  price: number;
  lastUpdated: number;
  priceChange7d?: number;
  priceChange30d?: number;
  priceChange90d?: number;
  avgPrice?: number;
  stddevPopPrice7d?: number;
  trendSlope7d?: number;
  priceHistory?: Array<{ p: number; t: number }>;
}

interface JustTcgCard {
  id: string;
  name: string;
  set: string;
  set_name: string;
  number: string;
  rarity?: string;
  tcgplayerId?: string;
  variants: JustTcgVariant[];
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
// AWS Clients
// =============================================================================

const secretsClient = new SecretsManagerClient({ region: AWS_REGION });
const cloudwatchClient = new CloudWatchClient({ region: AWS_REGION });

let prisma: PrismaClient | null = null;

async function getSecrets(): Promise<Secrets> {
  const secretId = `tcg-${ENVIRONMENT}/api-credentials`;

  try {
    const response = await secretsClient.send(
      new GetSecretValueCommand({ SecretId: secretId })
    );
    return JSON.parse(response.SecretString || "{}");
  } catch {
    // Fallback to environment variables
    return {
      justtcg_api_key: process.env.JUSTTCG_API_KEY || "",
      brightdata_token: process.env.BRIGHTDATA_TOKEN,
      database_url: process.env.DATABASE_URL || "",
    };
  }
}

async function getPrismaClient(databaseUrl: string): Promise<PrismaClient> {
  if (!prisma) {
    prisma = new PrismaClient({
      datasources: { db: { url: databaseUrl } },
      log: ["error"],
    });
  }
  return prisma;
}

async function publishMetrics(metrics: ArchiveMetrics): Promise<void> {
  const metricData = [
    { MetricName: "SetsProcessed", Value: metrics.setsProcessed, Unit: "Count" as const },
    { MetricName: "CardsArchived", Value: metrics.cardsArchived, Unit: "Count" as const },
    { MetricName: "ConditionsArchived", Value: metrics.conditionsArchived, Unit: "Count" as const },
    { MetricName: "HistoryRecords", Value: metrics.historyRecords, Unit: "Count" as const },
    { MetricName: "ErrorCount", Value: metrics.errors, Unit: "Count" as const },
    { MetricName: "DurationSeconds", Value: metrics.durationMs / 1000, Unit: "Seconds" as const },
  ];

  await cloudwatchClient.send(
    new PutMetricDataCommand({
      Namespace: "TCGPlayer/Archive",
      MetricData: metricData.map((m) => ({
        ...m,
        Timestamp: new Date(),
        Dimensions: [
          { Name: "Environment", Value: ENVIRONMENT },
          { Name: "Game", Value: metrics.game },
        ],
      })),
    })
  );
}

// =============================================================================
// JustTCG API Client
// =============================================================================

class JustTcgArchiveClient {
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

    // JustTCG Starter: 50 req/min
    if (this.requestCount >= 45) {
      const waitTime = 60000 - (now - this.minuteStart) + 100;
      console.log(`Rate limit approaching, waiting ${waitTime}ms`);
      await new Promise((resolve) => setTimeout(resolve, waitTime));
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
        Accept: "application/json",
        "x-api-key": this.apiKey,
      },
    });

    if (!response.ok) {
      throw new Error(`JustTCG API error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  async getSets(gameId: string): Promise<JustTcgSet[]> {
    const response = await this.request<{ data: JustTcgSet[] }>("/sets", { game: gameId });
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
    }>("/cards", {
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

function parseSetCode(cardId: string, cardNumber: string): { setCode: string; number: string } {
  // Try to extract set code from card number (e.g., "OP01-001")
  const match = cardNumber.match(/^([A-Z]+\d+)-(.+)$/i);
  if (match) {
    return { setCode: match[1].toUpperCase(), number: match[2] };
  }

  // Try to extract from card ID
  const idMatch = cardId.match(/([A-Z]+\d+)/i);
  if (idMatch) {
    return { setCode: idMatch[1].toUpperCase(), number: cardNumber };
  }

  return { setCode: "", number: cardNumber };
}

function detectVariantType(name: string, printing: string): string | null {
  const combined = `${name} ${printing}`.toLowerCase();

  if (combined.includes("parallel")) return "parallel";
  if (combined.includes("alternate art") || combined.includes("alt art")) return "alternate-art";
  if (combined.includes("manga")) return "manga";
  if (combined.includes("special") || combined.includes(" sp")) return "sp";
  if (combined.includes("secret")) return "spr";
  if (combined.includes("treasure")) return "tr";
  if (combined.includes("foil") && !combined.includes("non-foil")) return "foil";

  return null;
}

function mapConditionCode(condition: string): string {
  const condLower = condition.toLowerCase();
  if (condLower.includes("near mint") || condLower === "nm") return "NM";
  if (condLower.includes("lightly") || condLower === "lp") return "LP";
  if (condLower.includes("moderately") || condLower === "mp") return "MP";
  if (condLower.includes("heavily") || condLower === "hp") return "HP";
  if (condLower.includes("damaged") || condLower === "dmg") return "DMG";
  if (condLower.includes("sealed")) return "SEALED";
  return "NM";
}

// =============================================================================
// Archive Functions
// =============================================================================

async function archiveGame(
  client: JustTcgArchiveClient,
  db: PrismaClient,
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

  const dateStr = date.toISOString().split("T")[0];
  console.log(`\nArchiving ${game.name} for ${dateStr}`);

  try {
    // Get all sets
    const sets = await client.getSets(game.id);
    console.log(`Found ${sets.length} sets for ${game.name}`);

    for (const set of sets) {
      try {
        console.log(`  Processing: ${set.name} (${set.cards_count || 0} cards)`);

        let offset = 0;
        let hasMore = true;

        while (hasMore) {
          const { cards, hasMore: more } = await client.getCards(game.id, set.id, 100, offset);
          hasMore = more;
          offset += 100;

          for (const card of cards) {
            try {
              const { setCode, number } = parseSetCode(card.id, card.number);

              for (const variant of card.variants) {
                const variantType = detectVariantType(card.name, variant.printing);
                const conditionCode = mapConditionCode(variant.condition);

                // Build unique card ID
                const cardId = variantType
                  ? `${setCode}-${number}-${variantType}`
                  : `${setCode}-${number}`;

                const priceUsd = variant.price || 0;
                const priceGbp = Math.round(priceUsd * USD_TO_GBP * 100) / 100;

                // Archive daily price snapshot - upsert and get the ID
                const archiveResult = await db.$queryRaw<{ id: number }[]>`
                  INSERT INTO "tcgplayer_price_archive" (
                    "card_id", "date", "game", "set_code", "card_number", "variant_type",
                    "card_name", "market_price_usd", "low_price_usd", "market_price_gbp", "low_price_gbp",
                    "price_change_24h", "price_change_7d", "price_change_30d", "price_change_90d",
                    "std_dev", "data_source", "scraped_at"
                  ) VALUES (
                    ${cardId}, ${date}::date, ${game.code}, ${setCode}, ${number}, ${variantType},
                    ${card.name}, ${priceUsd}, ${priceUsd}, ${priceGbp}, ${priceGbp},
                    ${variant.priceChange7d ? variant.priceChange7d / 7 : null},
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

                // Archive condition snapshot with archiveId
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

                // Archive price history if available
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
              }
            } catch (cardError) {
              console.warn(`    Error archiving card ${card.id}:`, cardError);
              metrics.errors++;
            }
          }

          // Small delay between batches
          await new Promise((resolve) => setTimeout(resolve, 500));
        }

        metrics.setsProcessed++;
      } catch (setError) {
        console.warn(`  Error processing set ${set.name}:`, setError);
        metrics.errors++;
      }
    }
  } catch (error) {
    console.error(`Error archiving ${game.name}:`, error);
    metrics.errors++;
  }

  metrics.durationMs = Date.now() - startTime;
  return metrics;
}

// =============================================================================
// Main Handler
// =============================================================================

export const handler: Handler<ScheduledEvent> = async (event) => {
  console.log("TCGPlayer Daily Archive started", { event });
  const startTime = Date.now();
  const today = new Date();

  try {
    // Get secrets
    const secrets = await getSecrets();
    if (!secrets.justtcg_api_key) {
      throw new Error("JustTCG API key not configured");
    }
    if (!secrets.database_url) {
      throw new Error("Database URL not configured");
    }

    // Initialize clients
    const client = new JustTcgArchiveClient(secrets.justtcg_api_key);
    const db = await getPrismaClient(secrets.database_url);

    // Archive each game
    const allMetrics: ArchiveMetrics[] = [];

    for (const game of GAMES_TO_ARCHIVE) {
      const metrics = await archiveGame(client, db, game, today);
      allMetrics.push(metrics);

      // Publish metrics to CloudWatch
      await publishMetrics(metrics);

      console.log(`\n${game.name} Archive Summary:`);
      console.log(`  Sets: ${metrics.setsProcessed}`);
      console.log(`  Cards: ${metrics.cardsArchived}`);
      console.log(`  Conditions: ${metrics.conditionsArchived}`);
      console.log(`  History: ${metrics.historyRecords}`);
      console.log(`  Errors: ${metrics.errors}`);
      console.log(`  Duration: ${(metrics.durationMs / 1000).toFixed(1)}s`);
    }

    // Summary
    const totalCards = allMetrics.reduce((sum, m) => sum + m.cardsArchived, 0);
    const totalErrors = allMetrics.reduce((sum, m) => sum + m.errors, 0);
    const totalDuration = Date.now() - startTime;

    console.log("\n═══════════════════════════════════════════════════════════════");
    console.log("  TCGPlayer Daily Archive Complete");
    console.log("═══════════════════════════════════════════════════════════════");
    console.log(`  Total Cards Archived: ${totalCards.toLocaleString()}`);
    console.log(`  Total Errors: ${totalErrors}`);
    console.log(`  Total Duration: ${(totalDuration / 1000).toFixed(1)}s`);
    console.log("═══════════════════════════════════════════════════════════════");

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        date: today.toISOString().split("T")[0],
        metrics: allMetrics,
        totalCards,
        totalErrors,
        durationMs: totalDuration,
      }),
    };
  } catch (error) {
    console.error("TCGPlayer Archive error:", error);
    throw error;
  } finally {
    // Disconnect Prisma
    if (prisma) {
      await prisma.$disconnect();
    }
  }
};
