/**
 * Cardmarket Data Collector Lambda
 *
 * Collects price data from the Cardmarket API (Europe's largest marketplace).
 * Uses OAuth 1.0a for authentication.
 *
 * API Documentation: https://api.cardmarket.com/ws/documentation
 */
import { Handler, ScheduledEvent } from "aws-lambda";
export declare const handler: Handler<ScheduledEvent>;
