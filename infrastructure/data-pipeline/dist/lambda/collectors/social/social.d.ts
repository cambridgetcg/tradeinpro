/**
 * Social Signal Collector Lambda
 *
 * Collects social signals from Twitter/X, Reddit, and YouTube to
 * detect sentiment and trending cards for demand prediction.
 *
 * Sources:
 * - Twitter/X: Card mentions, hashtags, sentiment
 * - Reddit: r/OnePieceTCG, r/TradingCardGames discussions
 * - YouTube: Deck profiles, unboxings, meta discussions
 */
import { Handler, ScheduledEvent } from "aws-lambda";
export declare const handler: Handler<ScheduledEvent>;
