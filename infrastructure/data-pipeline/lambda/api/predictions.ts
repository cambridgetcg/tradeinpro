/**
 * Predictions API Lambda
 *
 * Serves ML model predictions via API Gateway:
 * - GET /predictions/{cardId} - Get all predictions for a card
 * - GET /predictions/{cardId}/demand - Get demand prediction
 * - GET /predictions/{cardId}/anomaly - Check for anomalies
 * - GET /predictions/{cardId}/timing - Get buy/sell timing signals
 */

import { APIGatewayProxyHandler, APIGatewayProxyResult } from "aws-lambda";
import {
  SageMakerRuntimeClient,
  InvokeEndpointCommand,
} from "@aws-sdk/client-sagemaker-runtime";
import {
  DynamoDBClient,
  GetItemCommand,
  QueryCommand,
} from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";

// =============================================================================
// CONFIGURATION
// =============================================================================

const DEMAND_ENDPOINT = process.env.DEMAND_ENDPOINT || "tcg-demand-endpoint";
const ANOMALY_ENDPOINT = process.env.ANOMALY_ENDPOINT || "tcg-anomaly-endpoint";
const TIMING_ENDPOINT = process.env.TIMING_ENDPOINT || "tcg-timing-endpoint";
const CURRENT_PRICES_TABLE = process.env.CURRENT_PRICES_TABLE!;
const PREDICTIONS_CACHE_TABLE = process.env.PREDICTIONS_CACHE_TABLE;

const sagemakerClient = new SageMakerRuntimeClient({});
const dynamoClient = new DynamoDBClient({});

// Cache TTL in seconds
const CACHE_TTL = 300; // 5 minutes

// =============================================================================
// TYPES
// =============================================================================

interface CardFeatures {
  cardId: string;
  priceCurrent: number;
  priceMa7: number;
  priceMa30: number;
  volatility7d: number;
  volatility30d: number;
  momentum7d: number;
  momentum30d: number;
  listingsCount: number;
  dayOfWeek: number;
  month: number;
}

interface DemandPrediction {
  cardId: string;
  predictedReturn7d: number;
  confidence: number;
  direction: "up" | "down" | "flat";
  features: {
    momentum: number;
    volatility: number;
    priceVsMa: number;
  };
}

interface AnomalyPrediction {
  cardId: string;
  isAnomaly: boolean;
  anomalyScore: number;
  anomalyType: "price_spike" | "price_drop" | "volume_anomaly" | null;
  confidence: number;
}

interface TimingPrediction {
  cardId: string;
  signal: "buy" | "sell" | "hold";
  confidence: number;
  expectedReturn: number;
  bestBuyDay: string;
  bestSellDay: string;
  forecast7d: Array<{ date: string; price: number; lower: number; upper: number }>;
}

interface CombinedPrediction {
  cardId: string;
  timestamp: string;
  demand: DemandPrediction;
  anomaly: AnomalyPrediction;
  timing: TimingPrediction;
  overallRecommendation: string;
  riskLevel: "low" | "medium" | "high";
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
// FEATURE EXTRACTION
// =============================================================================

async function getCardFeatures(cardId: string): Promise<CardFeatures | null> {
  // Query current prices
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

  // Aggregate features from price data
  const prices = result.Items.map((item) => unmarshall(item));

  // Get most recent price
  const latestPrice = prices.reduce((latest, p) =>
    new Date(p.updated_at) > new Date(latest.updated_at) ? p : latest
  );

  // Calculate features
  const usdPrices = prices.map((p) => p.price_usd);
  const avgPrice = usdPrices.reduce((a, b) => a + b, 0) / usdPrices.length;
  const totalListings = prices.reduce((sum, p) => sum + (p.listings_count || 0), 0);

  const now = new Date();

  return {
    cardId,
    priceCurrent: latestPrice.price_usd,
    priceMa7: latestPrice.avg_7d || avgPrice,
    priceMa30: latestPrice.avg_30d || avgPrice,
    volatility7d: latestPrice.volatility_7d || 0.1,
    volatility30d: latestPrice.volatility_30d || 0.1,
    momentum7d: latestPrice.momentum_7d || 0,
    momentum30d: latestPrice.momentum_30d || 0,
    listingsCount: totalListings,
    dayOfWeek: now.getDay(),
    month: now.getMonth() + 1,
  };
}

function featuresToVector(features: CardFeatures): number[] {
  return [
    features.priceCurrent,
    features.priceMa7,
    features.priceMa30,
    features.volatility7d,
    features.volatility30d,
    features.momentum7d,
    features.momentum30d,
    (features.priceCurrent - features.priceMa7) / features.priceMa7, // price_vs_ma7
    (features.priceCurrent - features.priceMa30) / features.priceMa30, // price_vs_ma30
    features.listingsCount,
    Math.sin((2 * Math.PI * features.dayOfWeek) / 7), // day_sin
    Math.cos((2 * Math.PI * features.dayOfWeek) / 7), // day_cos
    Math.sin((2 * Math.PI * features.month) / 12), // month_sin
    Math.cos((2 * Math.PI * features.month) / 12), // month_cos
  ];
}

// =============================================================================
// ML MODEL INFERENCE
// =============================================================================

async function invokeDemandModel(features: CardFeatures): Promise<DemandPrediction> {
  const featureVector = featuresToVector(features);

  try {
    const result = await sagemakerClient.send(
      new InvokeEndpointCommand({
        EndpointName: DEMAND_ENDPOINT,
        Body: JSON.stringify({ instances: [featureVector] }),
        ContentType: "application/json",
        Accept: "application/json",
      })
    );

    const responseBody = JSON.parse(new TextDecoder().decode(result.Body));
    const prediction = responseBody.predictions?.[0] || 0;

    return {
      cardId: features.cardId,
      predictedReturn7d: prediction,
      confidence: Math.min(0.9, Math.abs(prediction) * 5), // Rough confidence estimate
      direction: prediction > 0.02 ? "up" : prediction < -0.02 ? "down" : "flat",
      features: {
        momentum: features.momentum7d,
        volatility: features.volatility7d,
        priceVsMa: (features.priceCurrent - features.priceMa7) / features.priceMa7,
      },
    };
  } catch (error) {
    console.error("Demand model inference failed:", error);

    // Fallback to rule-based prediction
    const momentum = features.momentum7d;
    return {
      cardId: features.cardId,
      predictedReturn7d: momentum * 0.5, // Simple momentum-based estimate
      confidence: 0.3,
      direction: momentum > 0.02 ? "up" : momentum < -0.02 ? "down" : "flat",
      features: {
        momentum: features.momentum7d,
        volatility: features.volatility7d,
        priceVsMa: (features.priceCurrent - features.priceMa7) / features.priceMa7,
      },
    };
  }
}

async function invokeAnomalyModel(features: CardFeatures): Promise<AnomalyPrediction> {
  const featureVector = featuresToVector(features);

  try {
    const result = await sagemakerClient.send(
      new InvokeEndpointCommand({
        EndpointName: ANOMALY_ENDPOINT,
        Body: JSON.stringify({ instances: [featureVector] }),
        ContentType: "application/json",
        Accept: "application/json",
      })
    );

    const responseBody = JSON.parse(new TextDecoder().decode(result.Body));
    const score = responseBody.predictions?.[0] || 0;

    const isAnomaly = score < -0.5; // Isolation Forest: negative = anomaly

    return {
      cardId: features.cardId,
      isAnomaly,
      anomalyScore: -score, // Convert to positive (higher = more anomalous)
      anomalyType: isAnomaly
        ? features.momentum7d > 0.2
          ? "price_spike"
          : features.momentum7d < -0.2
          ? "price_drop"
          : "volume_anomaly"
        : null,
      confidence: Math.min(0.95, Math.abs(score)),
    };
  } catch (error) {
    console.error("Anomaly model inference failed:", error);

    // Fallback to z-score based detection
    const zScore = Math.abs(features.priceCurrent - features.priceMa30) /
      (features.volatility30d * features.priceMa30 || 1);
    const isAnomaly = zScore > 2.5;

    return {
      cardId: features.cardId,
      isAnomaly,
      anomalyScore: zScore / 5, // Normalize
      anomalyType: isAnomaly
        ? features.priceCurrent > features.priceMa30
          ? "price_spike"
          : "price_drop"
        : null,
      confidence: 0.5,
    };
  }
}

async function invokeTimingModel(features: CardFeatures): Promise<TimingPrediction> {
  try {
    const result = await sagemakerClient.send(
      new InvokeEndpointCommand({
        EndpointName: TIMING_ENDPOINT,
        Body: JSON.stringify({
          cardId: features.cardId,
          currentPrice: features.priceCurrent,
          dayOfWeek: features.dayOfWeek,
        }),
        ContentType: "application/json",
        Accept: "application/json",
      })
    );

    const responseBody = JSON.parse(new TextDecoder().decode(result.Body));

    return {
      cardId: features.cardId,
      signal: responseBody.signal || "hold",
      confidence: responseBody.confidence || 0.5,
      expectedReturn: responseBody.expectedReturn || 0,
      bestBuyDay: responseBody.bestBuyDay || "Monday",
      bestSellDay: responseBody.bestSellDay || "Saturday",
      forecast7d: responseBody.forecast || [],
    };
  } catch (error) {
    console.error("Timing model inference failed:", error);

    // Fallback to rule-based timing
    const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const isWeekend = features.dayOfWeek === 0 || features.dayOfWeek === 6;

    return {
      cardId: features.cardId,
      signal: isWeekend ? "sell" : features.momentum7d < -0.05 ? "buy" : "hold",
      confidence: 0.4,
      expectedReturn: features.momentum7d * 0.3,
      bestBuyDay: "Monday",
      bestSellDay: "Saturday",
      forecast7d: [],
    };
  }
}

// =============================================================================
// COMBINED PREDICTION
// =============================================================================

async function getCombinedPrediction(cardId: string): Promise<CombinedPrediction | null> {
  const features = await getCardFeatures(cardId);
  if (!features) {
    return null;
  }

  // Run all predictions in parallel
  const [demand, anomaly, timing] = await Promise.all([
    invokeDemandModel(features),
    invokeAnomalyModel(features),
    invokeTimingModel(features),
  ]);

  // Generate overall recommendation
  let recommendation = "Hold - Monitor for better entry/exit";
  let riskLevel: "low" | "medium" | "high" = "medium";

  if (anomaly.isAnomaly) {
    if (anomaly.anomalyType === "price_drop") {
      recommendation = "Potential buying opportunity - Price anomaly detected";
      riskLevel = "high";
    } else if (anomaly.anomalyType === "price_spike") {
      recommendation = "Consider selling - Price spike detected";
      riskLevel = "high";
    }
  } else if (demand.direction === "up" && timing.signal === "buy") {
    recommendation = "Strong Buy - Positive momentum and good timing";
    riskLevel = "low";
  } else if (demand.direction === "down" && timing.signal === "sell") {
    recommendation = "Strong Sell - Negative momentum, consider exiting";
    riskLevel = "low";
  } else if (demand.direction === "up") {
    recommendation = "Bullish outlook - Consider accumulating";
    riskLevel = "medium";
  } else if (demand.direction === "down") {
    recommendation = "Bearish outlook - Avoid new positions";
    riskLevel = "medium";
  }

  return {
    cardId,
    timestamp: new Date().toISOString(),
    demand,
    anomaly,
    timing,
    overallRecommendation: recommendation,
    riskLevel,
  };
}

// =============================================================================
// MAIN HANDLER
// =============================================================================

export const handler: APIGatewayProxyHandler = async (event) => {
  console.log("Predictions API Request:", {
    path: event.path,
    method: event.httpMethod,
    pathParams: event.pathParameters,
  });

  // Handle OPTIONS for CORS
  if (event.httpMethod === "OPTIONS") {
    return response(200, {});
  }

  const path = event.path;
  const method = event.httpMethod;

  try {
    // GET /predictions/{cardId}
    if (path.match(/^\/predictions\/[A-Z0-9-]+$/i) && method === "GET") {
      const cardId = event.pathParameters?.cardId || path.split("/").pop();
      if (!cardId) {
        return errorResponse(400, "Card ID is required");
      }

      const prediction = await getCombinedPrediction(cardId.toUpperCase());
      if (!prediction) {
        return errorResponse(404, "Card not found");
      }

      return response(200, prediction);
    }

    // GET /predictions/{cardId}/demand
    if (path.match(/^\/predictions\/[A-Z0-9-]+\/demand$/i) && method === "GET") {
      const cardId = path.split("/")[2];
      const features = await getCardFeatures(cardId.toUpperCase());
      if (!features) {
        return errorResponse(404, "Card not found");
      }

      const prediction = await invokeDemandModel(features);
      return response(200, prediction);
    }

    // GET /predictions/{cardId}/anomaly
    if (path.match(/^\/predictions\/[A-Z0-9-]+\/anomaly$/i) && method === "GET") {
      const cardId = path.split("/")[2];
      const features = await getCardFeatures(cardId.toUpperCase());
      if (!features) {
        return errorResponse(404, "Card not found");
      }

      const prediction = await invokeAnomalyModel(features);
      return response(200, prediction);
    }

    // GET /predictions/{cardId}/timing
    if (path.match(/^\/predictions\/[A-Z0-9-]+\/timing$/i) && method === "GET") {
      const cardId = path.split("/")[2];
      const features = await getCardFeatures(cardId.toUpperCase());
      if (!features) {
        return errorResponse(404, "Card not found");
      }

      const prediction = await invokeTimingModel(features);
      return response(200, prediction);
    }

    return errorResponse(404, "Not found");
  } catch (error) {
    console.error("Predictions API Error:", error);
    return errorResponse(500, "Internal server error");
  }
};
