/**
 * TCGplayer Data Collector Lambda
 *
 * Collects price and sales data from the TCGplayer API.
 * Runs every 5 minutes via EventBridge schedule.
 *
 * TCGplayer API endpoints used:
 * - /pricing/product/{productId}/prices - Get current prices
 * - /catalog/products - Search products
 * - /pricing/marketprices - Get market prices
 */
import { Handler, ScheduledEvent } from "aws-lambda";
export declare const handler: Handler<ScheduledEvent>;
