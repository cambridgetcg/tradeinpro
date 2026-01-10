/**
 * Predictions API Lambda
 *
 * Serves ML model predictions via API Gateway:
 * - GET /predictions/{cardId} - Get all predictions for a card
 * - GET /predictions/{cardId}/demand - Get demand prediction
 * - GET /predictions/{cardId}/anomaly - Check for anomalies
 * - GET /predictions/{cardId}/timing - Get buy/sell timing signals
 */
import { APIGatewayProxyHandler } from "aws-lambda";
export declare const handler: APIGatewayProxyHandler;
