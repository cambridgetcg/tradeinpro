/**
 * Stream Processor Lambda
 *
 * Processes price events from Kinesis in real-time to:
 * - Calculate cross-market spreads
 * - Detect arbitrage opportunities
 * - Identify price anomalies
 * - Update real-time dashboards
 */

import { Handler, KinesisStreamEvent, KinesisStreamRecord } from "aws-lambda";
import {
  DynamoDBClient,
  PutItemCommand,
  GetItemCommand,
  QueryCommand,
  BatchWriteItemCommand,
} from "@aws-sdk/client-dynamodb";
import {
  TimestreamWriteClient,
  WriteRecordsCommand,
  _Record,
} from "@aws-sdk/client-timestream-write";
import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { PriceEvent } from "/opt/nodejs/utils";

// =============================================================================
// CONFIGURATION
// =============================================================================

const CURRENT_PRICES_TABLE = process.env.CURRENT_PRICES_TABLE!;
const ARBITRAGE_TABLE = process.env.ARBITRAGE_TABLE!;
const TIMESTREAM_DATABASE = process.env.TIMESTREAM_DATABASE!;
const ALERT_TOPIC_ARN = process.env.ALERT_TOPIC_ARN;

// Thresholds for opportunities
const ARBITRAGE_THRESHOLD = 0.15; // 15% spread
const ANOMALY_Z_SCORE_THRESHOLD = 2.5;
const HIGH_VALUE_THRESHOLD = 50; // $50 USD

// =============================================================================
// CLIENTS
// =============================================================================

const dynamoClient = new DynamoDBClient({});
const timestreamClient = new TimestreamWriteClient({});
const snsClient = new SNSClient({});

// =============================================================================
// TYPES
// =============================================================================

interface CrossMarketSpread {
  cardId: string;
  cardName: string;
  buySource: string;
  sellSource: string;
  buyPrice: number;
  sellPrice: number;
  spread: number;
  netProfit: number;
  urgency: "immediate" | "short" | "medium" | "low";
}

interface PriceAnomaly {
  cardId: string;
  source: string;
  currentPrice: number;
  avgPrice: number;
  zScore: number;
  anomalyType: "underpriced" | "overpriced" | "volatile";
}

interface CardPriceSnapshot {
  cardId: string;
  prices: Map<string, { price: number; source: string; condition: string; timestamp: string }>;
}

// =============================================================================
// PRICE AGGREGATION
// =============================================================================

class PriceAggregator {
  private pricesByCard: Map<string, CardPriceSnapshot> = new Map();

  addPrice(event: PriceEvent): void {
    const key = `${event.source}#${event.condition}`;

    if (!this.pricesByCard.has(event.cardId)) {
      this.pricesByCard.set(event.cardId, {
        cardId: event.cardId,
        prices: new Map(),
      });
    }

    const snapshot = this.pricesByCard.get(event.cardId)!;
    snapshot.prices.set(key, {
      price: event.priceUsd,
      source: event.source,
      condition: event.condition,
      timestamp: event.timestamp,
    });
  }

  getSnapshots(): CardPriceSnapshot[] {
    return Array.from(this.pricesByCard.values());
  }
}

// =============================================================================
// SPREAD CALCULATION
// =============================================================================

// Platform fees for net profit calculation
const PLATFORM_FEES: Record<string, { seller: number; buyer: number; fixed: number }> = {
  tcgplayer: { seller: 0.1025, buyer: 0, fixed: 0.30 },
  cardmarket: { seller: 0.05, buyer: 0, fixed: 0 },
  ebay_us: { seller: 0.1325, buyer: 0, fixed: 0.30 },
  ebay_gb: { seller: 0.1325, buyer: 0, fixed: 0.30 },
  ebay_de: { seller: 0.1325, buyer: 0, fixed: 0.30 },
  yahoo_jp: { seller: 0.088, buyer: 0, fixed: 0 },
  mercari_jp: { seller: 0.10, buyer: 0, fixed: 0 },
};

// Estimated shipping costs by route
const SHIPPING_COSTS: Record<string, number> = {
  "tcgplayer->cardmarket": 8,
  "cardmarket->tcgplayer": 8,
  "yahoo_jp->tcgplayer": 15,
  "yahoo_jp->cardmarket": 18,
  "mercari_jp->tcgplayer": 15,
  "mercari_jp->cardmarket": 18,
  "tcgplayer->ebay_us": 4,
  "cardmarket->ebay_de": 3,
  default: 10,
};

function calculateNetProfit(
  buySource: string,
  sellSource: string,
  buyPrice: number,
  sellPrice: number
): number {
  const buyFees = PLATFORM_FEES[buySource] || { seller: 0, buyer: 0, fixed: 0 };
  const sellFees = PLATFORM_FEES[sellSource] || { seller: 0, buyer: 0, fixed: 0 };

  const shippingKey = `${buySource}->${sellSource}`;
  const shipping = SHIPPING_COSTS[shippingKey] || SHIPPING_COSTS.default;

  // Total buy cost
  const totalBuyCost = buyPrice * (1 + buyFees.buyer) + buyFees.fixed;

  // Net sale proceeds
  const netSaleProceeds = sellPrice * (1 - sellFees.seller) - sellFees.fixed;

  // Net profit after shipping
  return netSaleProceeds - totalBuyCost - shipping;
}

function findArbitrageOpportunities(snapshot: CardPriceSnapshot): CrossMarketSpread[] {
  const opportunities: CrossMarketSpread[] = [];
  const prices = Array.from(snapshot.prices.values());

  // Only consider NM condition for arbitrage
  const nmPrices = prices.filter((p) => p.condition === "NM");

  // Compare all pairs
  for (let i = 0; i < nmPrices.length; i++) {
    for (let j = 0; j < nmPrices.length; j++) {
      if (i === j) continue;

      const buyPrice = nmPrices[i];
      const sellPrice = nmPrices[j];

      if (buyPrice.price >= sellPrice.price) continue;

      const spread = (sellPrice.price - buyPrice.price) / sellPrice.price;
      const netProfit = calculateNetProfit(
        buyPrice.source,
        sellPrice.source,
        buyPrice.price,
        sellPrice.price
      );

      // Only include profitable opportunities
      if (netProfit > 0 && spread >= ARBITRAGE_THRESHOLD) {
        let urgency: CrossMarketSpread["urgency"] = "low";
        if (spread > 0.30) urgency = "immediate";
        else if (spread > 0.25) urgency = "short";
        else if (spread > 0.20) urgency = "medium";

        opportunities.push({
          cardId: snapshot.cardId,
          cardName: "", // Would lookup from catalog
          buySource: buyPrice.source,
          sellSource: sellPrice.source,
          buyPrice: buyPrice.price,
          sellPrice: sellPrice.price,
          spread,
          netProfit,
          urgency,
        });
      }
    }
  }

  return opportunities;
}

// =============================================================================
// ANOMALY DETECTION
// =============================================================================

interface HistoricalStats {
  mean: number;
  std: number;
  count: number;
}

async function getHistoricalStats(
  cardId: string,
  source: string,
  condition: string
): Promise<HistoricalStats | null> {
  // Query recent prices from DynamoDB or Timestream
  // For this implementation, we'll use a simplified approach
  // In production, would query Timestream for rolling statistics

  try {
    const response = await dynamoClient.send(
      new GetItemCommand({
        TableName: CURRENT_PRICES_TABLE,
        Key: marshall({
          card_id: cardId,
          source_condition: `${source}#${condition}`,
        }),
      })
    );

    if (!response.Item) return null;

    const item = unmarshall(response.Item);

    // Use stored statistics or calculate from recent data
    return {
      mean: item.avg_price_7d || item.price_usd,
      std: item.std_price_7d || item.price_usd * 0.1, // Estimate 10% std if not available
      count: item.price_count || 1,
    };
  } catch (error) {
    console.warn(`Failed to get historical stats for ${cardId}:`, error);
    return null;
  }
}

async function detectAnomalies(events: PriceEvent[]): Promise<PriceAnomaly[]> {
  const anomalies: PriceAnomaly[] = [];

  for (const event of events) {
    const stats = await getHistoricalStats(event.cardId, event.source, event.condition);
    if (!stats || stats.count < 5) continue; // Need enough data

    const zScore = stats.std > 0 ? (event.priceUsd - stats.mean) / stats.std : 0;

    if (Math.abs(zScore) > ANOMALY_Z_SCORE_THRESHOLD) {
      anomalies.push({
        cardId: event.cardId,
        source: event.source,
        currentPrice: event.priceUsd,
        avgPrice: stats.mean,
        zScore,
        anomalyType: zScore < 0 ? "underpriced" : "overpriced",
      });
    }
  }

  return anomalies;
}

// =============================================================================
// PERSISTENCE
// =============================================================================

async function saveArbitrageOpportunities(opportunities: CrossMarketSpread[]): Promise<void> {
  if (opportunities.length === 0) return;

  const timestamp = Date.now();
  const ttl = Math.floor(timestamp / 1000) + 86400; // 24 hours

  // Batch write to DynamoDB
  const batches: CrossMarketSpread[][] = [];
  for (let i = 0; i < opportunities.length; i += 25) {
    batches.push(opportunities.slice(i, i + 25));
  }

  for (const batch of batches) {
    await dynamoClient.send(
      new BatchWriteItemCommand({
        RequestItems: {
          [ARBITRAGE_TABLE]: batch.map((opp) => ({
            PutRequest: {
              Item: marshall({
                card_id: opp.cardId,
                timestamp,
                buy_source: opp.buySource,
                sell_source: opp.sellSource,
                buy_price: opp.buyPrice,
                sell_price: opp.sellPrice,
                spread: opp.spread,
                net_profit: opp.netProfit,
                urgency: opp.urgency,
                ttl,
              }),
            },
          })),
        },
      })
    );
  }
}

async function writeSpreadToTimestream(
  cardId: string,
  spreads: Record<string, number>
): Promise<void> {
  const timestamp = Date.now();

  const measureValues = Object.entries(spreads).map(([key, value]) => ({
    Name: key.replace(/[^a-zA-Z0-9_]/g, "_"),
    Value: value.toString(),
    Type: "DOUBLE" as const,
  }));

  if (measureValues.length === 0) return;

  const record: _Record = {
    Dimensions: [{ Name: "card_id", Value: cardId }],
    MeasureName: "market_spreads",
    MeasureValueType: "MULTI",
    MeasureValues: measureValues,
    Time: timestamp.toString(),
    TimeUnit: "MILLISECONDS",
  };

  await timestreamClient.send(
    new WriteRecordsCommand({
      DatabaseName: TIMESTREAM_DATABASE,
      TableName: "market_spreads",
      Records: [record],
    })
  );
}

// =============================================================================
// ALERTING
// =============================================================================

async function sendAlert(
  type: "arbitrage" | "anomaly",
  data: CrossMarketSpread | PriceAnomaly
): Promise<void> {
  if (!ALERT_TOPIC_ARN) return;

  let subject: string;
  let message: string;

  if (type === "arbitrage") {
    const opp = data as CrossMarketSpread;
    subject = `[TCG Alert] Arbitrage: ${opp.cardId} - $${opp.netProfit.toFixed(2)} profit`;
    message = JSON.stringify(
      {
        type: "arbitrage",
        cardId: opp.cardId,
        buySource: opp.buySource,
        sellSource: opp.sellSource,
        buyPrice: opp.buyPrice,
        sellPrice: opp.sellPrice,
        spread: `${(opp.spread * 100).toFixed(1)}%`,
        netProfit: `$${opp.netProfit.toFixed(2)}`,
        urgency: opp.urgency,
        timestamp: new Date().toISOString(),
      },
      null,
      2
    );
  } else {
    const anomaly = data as PriceAnomaly;
    subject = `[TCG Alert] Price Anomaly: ${anomaly.cardId} (z=${anomaly.zScore.toFixed(1)})`;
    message = JSON.stringify(
      {
        type: "anomaly",
        cardId: anomaly.cardId,
        source: anomaly.source,
        currentPrice: `$${anomaly.currentPrice.toFixed(2)}`,
        avgPrice: `$${anomaly.avgPrice.toFixed(2)}`,
        zScore: anomaly.zScore.toFixed(2),
        anomalyType: anomaly.anomalyType,
        timestamp: new Date().toISOString(),
      },
      null,
      2
    );
  }

  await snsClient.send(
    new PublishCommand({
      TopicArn: ALERT_TOPIC_ARN,
      Subject: subject,
      Message: message,
    })
  );
}

// =============================================================================
// MAIN HANDLER
// =============================================================================

export const handler: Handler<KinesisStreamEvent> = async (event) => {
  console.log(`Processing ${event.Records.length} records`);

  const aggregator = new PriceAggregator();
  const processedEvents: PriceEvent[] = [];

  // Parse and aggregate events
  for (const record of event.Records) {
    try {
      const payload = Buffer.from(record.kinesis.data, "base64").toString("utf-8");
      const priceEvent: PriceEvent = JSON.parse(payload);

      aggregator.addPrice(priceEvent);
      processedEvents.push(priceEvent);
    } catch (error) {
      console.error("Failed to parse record:", error);
    }
  }

  console.log(`Parsed ${processedEvents.length} events`);

  // Find arbitrage opportunities
  const allOpportunities: CrossMarketSpread[] = [];
  const snapshots = aggregator.getSnapshots();

  for (const snapshot of snapshots) {
    const opportunities = findArbitrageOpportunities(snapshot);
    allOpportunities.push(...opportunities);

    // Write spreads to Timestream
    if (snapshot.prices.size >= 2) {
      const spreads: Record<string, number> = {};
      const prices = Array.from(snapshot.prices.values());

      for (let i = 0; i < prices.length; i++) {
        for (let j = i + 1; j < prices.length; j++) {
          const key = `${prices[i].source}_${prices[j].source}`;
          spreads[key] =
            (prices[i].price - prices[j].price) / Math.max(prices[i].price, prices[j].price);
        }
      }

      try {
        await writeSpreadToTimestream(snapshot.cardId, spreads);
      } catch (error) {
        console.warn(`Failed to write spread for ${snapshot.cardId}:`, error);
      }
    }
  }

  // Save arbitrage opportunities
  if (allOpportunities.length > 0) {
    console.log(`Found ${allOpportunities.length} arbitrage opportunities`);
    await saveArbitrageOpportunities(allOpportunities);

    // Send alerts for high-value opportunities
    const highValueOpps = allOpportunities.filter(
      (o) => o.netProfit >= 10 && o.urgency !== "low"
    );
    for (const opp of highValueOpps.slice(0, 5)) {
      // Limit alerts
      await sendAlert("arbitrage", opp);
    }
  }

  // Detect anomalies
  const anomalies = await detectAnomalies(processedEvents);
  if (anomalies.length > 0) {
    console.log(`Found ${anomalies.length} price anomalies`);

    // Send alerts for significant anomalies
    const significantAnomalies = anomalies.filter(
      (a) => Math.abs(a.zScore) > 3 && a.currentPrice > HIGH_VALUE_THRESHOLD
    );
    for (const anomaly of significantAnomalies.slice(0, 5)) {
      await sendAlert("anomaly", anomaly);
    }
  }

  return {
    batchItemFailures: [], // All items processed successfully
  };
};
