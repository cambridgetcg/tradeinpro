/**
 * Japan Market Data Collector Lambda
 *
 * Scrapes price data from Japanese marketplaces:
 * - Yahoo Auctions Japan
 * - Mercari Japan
 *
 * Uses rotating proxies to avoid IP blocks.
 * Requires Japanese text parsing for card identification.
 */
import { Handler, ScheduledEvent } from "aws-lambda";
export declare const handler: Handler<ScheduledEvent>;
