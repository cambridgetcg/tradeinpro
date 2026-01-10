/**
 * Prices API Lambda
 *
 * Provides real-time price data via API Gateway:
 * - GET /prices/{cardId} - Get current prices for a card
 * - GET /prices/search - Search prices by card name
 * - GET /prices/market - Get market overview
 * - GET /prices/arbitrage - Get arbitrage opportunities
 */

import { APIGatewayProxyHandler, APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import {
  DynamoDBClient,
  GetItemCommand,
  QueryCommand,
  ScanCommand,
} from "@aws-sdk/client-dynamodb";
import {
  TimestreamQueryClient,
  QueryCommand as TimestreamQuery,
} from "@aws-sdk/client-timestream-query";
import { unmarshall } from "@aws-sdk/util-dynamodb";

// =============================================================================
// CONFIGURATION
// =============================================================================

const CURRENT_PRICES_TABLE = process.env.CURRENT_PRICES_TABLE!;
const ARBITRAGE_TABLE = process.env.ARBITRAGE_TABLE!;
const TIMESTREAM_DATABASE = process.env.TIMESTREAM_DATABASE!;

const dynamoClient = new DynamoDBClient({});
const timestreamClient = new TimestreamQueryClient({});

// =============================================================================
// TYPES
// =============================================================================

interface PriceResponse {
  cardId: string;
  prices: Array<{
    source: string;
    condition: string;
    price: number;
    currency: string;
    priceUsd: number;
    priceGbp: number;
    lastUpdated: string;
    listingsCount?: number;
  }>;
  lowestPrice: number;
  averagePrice: number;
  priceRange: { min: number; max: number };
}

interface ArbitrageOpportunity {
  cardId: string;
  buySource: string;
  sellSource: string;
  buyPrice: number;
  sellPrice: number;
  spread: number;
  netProfit: number;
  urgency: string;
}

interface MarketOverview {
  totalCards: number;
  avgPrice: number;
  medianPrice: number;
  totalListings: number;
  priceChange24h: number;
  topGainers: Array<{ cardId: string; change: number }>;
  topLosers: Array<{ cardId: string; change: number }>;
}

// =============================================================================
// HELPERS
// =============================================================================

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Content-Type": "application/json",
  };
}

function response(statusCode: number, body: object): APIGatewayProxyResult {
  return {
    statusCode,
    headers: corsHeaders(),
    body: JSON.stringify(body),
  };
}

function errorResponse(statusCode: number, message: string): APIGatewayProxyResult {
  return response(statusCode, { error: message });
}

// =============================================================================
// HANDLERS
// =============================================================================

async function getCardPrices(cardId: string): Promise<PriceResponse | null> {
  // Query all prices for this card
  const result = await dynamoClient.send(
    new QueryCommand({
      TableName: CURRENT_PRICES_TABLE,
      KeyConditionExpression: "card_id = :cardId",
      ExpressionAttributeValues: {
        ":cardId": { S: cardId },
      },
    })
  );

  if (!result.Items || result.Items.length === 0) {
    return null;
  }

  const prices = result.Items.map((item) => {
    const unmarshalled = unmarshall(item);
    return {
      source: unmarshalled.source,
      condition: unmarshalled.condition,
      price: unmarshalled.price,
      currency: unmarshalled.currency || "USD",
      priceUsd: unmarshalled.price_usd,
      priceGbp: unmarshalled.price_gbp,
      lastUpdated: unmarshalled.updated_at,
      listingsCount: unmarshalled.listings_count,
    };
  });

  // Calculate summary stats
  const usdPrices = prices.map((p) => p.priceUsd);
  const lowestPrice = Math.min(...usdPrices);
  const averagePrice = usdPrices.reduce((a, b) => a + b, 0) / usdPrices.length;
  const priceRange = { min: Math.min(...usdPrices), max: Math.max(...usdPrices) };

  return {
    cardId,
    prices,
    lowestPrice,
    averagePrice,
    priceRange,
  };
}

async function searchPrices(query: string, limit: number = 20): Promise<PriceResponse[]> {
  // Scan with filter (in production, use OpenSearch for better search)
  const result = await dynamoClient.send(
    new ScanCommand({
      TableName: CURRENT_PRICES_TABLE,
      FilterExpression: "contains(card_id, :query)",
      ExpressionAttributeValues: {
        ":query": { S: query.toUpperCase() },
      },
      Limit: limit * 5, // Over-fetch since we'll group
    })
  );

  if (!result.Items || result.Items.length === 0) {
    return [];
  }

  // Group by card_id
  const byCard = new Map<string, any[]>();
  for (const item of result.Items) {
    const unmarshalled = unmarshall(item);
    const cardId = unmarshalled.card_id;
    if (!byCard.has(cardId)) {
      byCard.set(cardId, []);
    }
    byCard.get(cardId)!.push(unmarshalled);
  }

  // Build responses
  const responses: PriceResponse[] = [];
  for (const [cardId, items] of byCard.entries()) {
    const prices = items.map((item) => ({
      source: item.source,
      condition: item.condition,
      price: item.price,
      currency: item.currency || "USD",
      priceUsd: item.price_usd,
      priceGbp: item.price_gbp,
      lastUpdated: item.updated_at,
      listingsCount: item.listings_count,
    }));

    const usdPrices = prices.map((p) => p.priceUsd);

    responses.push({
      cardId,
      prices,
      lowestPrice: Math.min(...usdPrices),
      averagePrice: usdPrices.reduce((a, b) => a + b, 0) / usdPrices.length,
      priceRange: { min: Math.min(...usdPrices), max: Math.max(...usdPrices) },
    });

    if (responses.length >= limit) break;
  }

  return responses;
}

async function getArbitrageOpportunities(limit: number = 20): Promise<ArbitrageOpportunity[]> {
  // Query recent arbitrage opportunities
  const result = await dynamoClient.send(
    new ScanCommand({
      TableName: ARBITRAGE_TABLE,
      FilterExpression: "net_profit > :minProfit",
      ExpressionAttributeValues: {
        ":minProfit": { N: "5" },
      },
      Limit: limit,
    })
  );

  if (!result.Items || result.Items.length === 0) {
    return [];
  }

  return result.Items.map((item) => {
    const unmarshalled = unmarshall(item);
    return {
      cardId: unmarshalled.card_id,
      buySource: unmarshalled.buy_source,
      sellSource: unmarshalled.sell_source,
      buyPrice: unmarshalled.buy_price,
      sellPrice: unmarshalled.sell_price,
      spread: unmarshalled.spread,
      netProfit: unmarshalled.net_profit,
      urgency: unmarshalled.urgency,
    };
  }).sort((a, b) => b.netProfit - a.netProfit);
}

async function getMarketOverview(): Promise<MarketOverview> {
  // Query Timestream for market overview
  const query = `
    SELECT
      COUNT(DISTINCT card_id) as total_cards,
      AVG(price_usd) as avg_price,
      APPROX_PERCENTILE(price_usd, 0.5) as median_price,
      SUM(listings_count) as total_listings
    FROM "${TIMESTREAM_DATABASE}"."price_history"
    WHERE time > ago(24h)
  `;

  try {
    const result = await timestreamClient.send(
      new TimestreamQuery({ QueryString: query })
    );

    const row = result.Rows?.[0];
    if (!row) {
      return {
        totalCards: 0,
        avgPrice: 0,
        medianPrice: 0,
        totalListings: 0,
        priceChange24h: 0,
        topGainers: [],
        topLosers: [],
      };
    }

    const data = row.Data || [];

    return {
      totalCards: parseInt(data[0]?.ScalarValue || "0"),
      avgPrice: parseFloat(data[1]?.ScalarValue || "0"),
      medianPrice: parseFloat(data[2]?.ScalarValue || "0"),
      totalListings: parseInt(data[3]?.ScalarValue || "0"),
      priceChange24h: 0, // Would need additional query
      topGainers: [],
      topLosers: [],
    };
  } catch (error) {
    console.error("Timestream query failed:", error);
    return {
      totalCards: 0,
      avgPrice: 0,
      medianPrice: 0,
      totalListings: 0,
      priceChange24h: 0,
      topGainers: [],
      topLosers: [],
    };
  }
}

async function getPriceHistory(
  cardId: string,
  days: number = 30
): Promise<Array<{ timestamp: string; price: number; source: string }>> {
  const query = `
    SELECT time, price_usd, source
    FROM "${TIMESTREAM_DATABASE}"."price_history"
    WHERE card_id = '${cardId}'
      AND time > ago(${days}d)
    ORDER BY time DESC
  `;

  try {
    const result = await timestreamClient.send(
      new TimestreamQuery({ QueryString: query })
    );

    return (result.Rows || []).map((row) => ({
      timestamp: row.Data?.[0]?.ScalarValue || "",
      price: parseFloat(row.Data?.[1]?.ScalarValue || "0"),
      source: row.Data?.[2]?.ScalarValue || "",
    }));
  } catch (error) {
    console.error("Timestream query failed:", error);
    return [];
  }
}

// =============================================================================
// MAIN HANDLER
// =============================================================================

export const handler: APIGatewayProxyHandler = async (event) => {
  console.log("API Request:", {
    path: event.path,
    method: event.httpMethod,
    queryParams: event.queryStringParameters,
    pathParams: event.pathParameters,
  });

  // Handle OPTIONS for CORS
  if (event.httpMethod === "OPTIONS") {
    return response(200, {});
  }

  const path = event.path;
  const method = event.httpMethod;

  try {
    // GET /prices/{cardId}
    if (path.match(/^\/prices\/[A-Z0-9-]+$/i) && method === "GET") {
      const cardId = event.pathParameters?.cardId || path.split("/").pop();
      if (!cardId) {
        return errorResponse(400, "Card ID is required");
      }

      const prices = await getCardPrices(cardId.toUpperCase());
      if (!prices) {
        return errorResponse(404, "Card not found");
      }

      return response(200, prices);
    }

    // GET /prices/{cardId}/history
    if (path.match(/^\/prices\/[A-Z0-9-]+\/history$/i) && method === "GET") {
      const cardId = event.pathParameters?.cardId || path.split("/")[2];
      const days = parseInt(event.queryStringParameters?.days || "30");

      const history = await getPriceHistory(cardId.toUpperCase(), days);
      return response(200, { cardId, history });
    }

    // GET /prices/search?q=query
    if (path === "/prices/search" && method === "GET") {
      const query = event.queryStringParameters?.q;
      if (!query) {
        return errorResponse(400, "Query parameter 'q' is required");
      }

      const limit = parseInt(event.queryStringParameters?.limit || "20");
      const results = await searchPrices(query, limit);

      return response(200, { results, count: results.length });
    }

    // GET /prices/market
    if (path === "/prices/market" && method === "GET") {
      const overview = await getMarketOverview();
      return response(200, overview);
    }

    // GET /prices/arbitrage
    if (path === "/prices/arbitrage" && method === "GET") {
      const limit = parseInt(event.queryStringParameters?.limit || "20");
      const opportunities = await getArbitrageOpportunities(limit);

      return response(200, {
        opportunities,
        count: opportunities.length,
        totalPotentialProfit: opportunities.reduce((sum, o) => sum + o.netProfit, 0),
      });
    }

    return errorResponse(404, "Not found");
  } catch (error) {
    console.error("API Error:", error);
    return errorResponse(500, "Internal server error");
  }
};
