/**
 * Stream Processor Lambda
 *
 * Processes price events from Kinesis in real-time to:
 * - Calculate cross-market spreads
 * - Detect arbitrage opportunities
 * - Identify price anomalies
 * - Update real-time dashboards
 */
import { Handler, KinesisStreamEvent } from "aws-lambda";
export declare const handler: Handler<KinesisStreamEvent>;
