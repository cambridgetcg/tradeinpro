/**
 * Prices API Lambda
 *
 * Provides real-time price data via API Gateway:
 * - GET /prices/{cardId} - Get current prices for a card
 * - GET /prices/search - Search prices by card name
 * - GET /prices/market - Get market overview
 * - GET /prices/arbitrage - Get arbitrage opportunities
 */
import { APIGatewayProxyHandler } from "aws-lambda";
export declare const handler: APIGatewayProxyHandler;
