/**
 * eBay Data Collector Lambda
 *
 * Collects listings and completed sales from eBay APIs.
 * Uses OAuth 2.0 for authentication.
 *
 * APIs used:
 * - Browse API: Search active listings
 * - Finding API: Search completed sales
 */
import { Handler, ScheduledEvent } from "aws-lambda";
export declare const handler: Handler<ScheduledEvent>;
