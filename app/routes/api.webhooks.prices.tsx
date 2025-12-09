/**
 * Price Update Webhook Receiver
 *
 * Receives SNS notifications from the trading-card-pricer Lambda
 * when price updates are completed. Triggers a price sync to ensure
 * the cardforum database has the latest prices.
 *
 * SNS sends two types of requests:
 * 1. SubscriptionConfirmation - Initial subscription validation
 * 2. Notification - Actual price update notification
 */

import type { ActionFunctionArgs } from "react-router";
import { verifyWebhookSignature } from "../lib/webhook-signing.server";

interface SNSMessage {
  Type: "SubscriptionConfirmation" | "Notification" | "UnsubscribeConfirmation";
  MessageId: string;
  TopicArn: string;
  Subject?: string;
  Message: string;
  Timestamp: string;
  SignatureVersion: string;
  Signature: string;
  SigningCertURL: string;
  SubscribeURL?: string; // Present for SubscriptionConfirmation
  UnsubscribeURL?: string; // Present for Notification
  Token?: string; // Present for SubscriptionConfirmation
}

interface PriceUpdateNotification {
  type: "PRICE_BATCH_COMPLETE";
  timestamp: string;
  source: "optcg";
  stats: {
    cardsProcessed: number;
    cardsUpdated: number;
    errorCount: number;
  };
}

// Environment variables
const WEBHOOK_SECRET = process.env.PRICE_WEBHOOK_SECRET;
const EXPECTED_TOPIC_ARN = process.env.PRICE_UPDATE_TOPIC_ARN;

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const body = await request.text();

    // Check for SNS message type header
    const messageType = request.headers.get("x-amz-sns-message-type");

    if (messageType) {
      // Handle SNS message
      return handleSNSMessage(messageType, body);
    }

    // Handle direct webhook (signed request)
    return handleDirectWebhook(request, body);
  } catch (error) {
    console.error("Webhook error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}

async function handleSNSMessage(messageType: string, body: string): Promise<Response> {
  let snsMessage: SNSMessage;

  try {
    snsMessage = JSON.parse(body) as SNSMessage;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  // Validate topic ARN if configured
  if (EXPECTED_TOPIC_ARN && snsMessage.TopicArn !== EXPECTED_TOPIC_ARN) {
    console.warn(`Unexpected topic ARN: ${snsMessage.TopicArn}`);
    return new Response("Invalid topic", { status: 403 });
  }

  // Handle different message types
  switch (messageType) {
    case "SubscriptionConfirmation":
      return handleSubscriptionConfirmation(snsMessage);

    case "Notification":
      return handleNotification(snsMessage);

    case "UnsubscribeConfirmation":
      console.log("Received unsubscribe confirmation");
      return new Response("OK", { status: 200 });

    default:
      console.warn(`Unknown SNS message type: ${messageType}`);
      return new Response("Unknown message type", { status: 400 });
  }
}

async function handleSubscriptionConfirmation(message: SNSMessage): Promise<Response> {
  if (!message.SubscribeURL) {
    console.error("No SubscribeURL in confirmation message");
    return new Response("Missing SubscribeURL", { status: 400 });
  }

  console.log(`Confirming SNS subscription for topic: ${message.TopicArn}`);

  try {
    // Confirm the subscription by fetching the SubscribeURL
    const response = await fetch(message.SubscribeURL);
    if (!response.ok) {
      throw new Error(`Failed to confirm: ${response.status}`);
    }

    console.log("SNS subscription confirmed successfully");
    return new Response("Subscription confirmed", { status: 200 });
  } catch (error) {
    console.error("Failed to confirm SNS subscription:", error);
    return new Response("Failed to confirm subscription", { status: 500 });
  }
}

async function handleNotification(message: SNSMessage): Promise<Response> {
  let notification: PriceUpdateNotification;

  try {
    notification = JSON.parse(message.Message) as PriceUpdateNotification;
  } catch {
    console.error("Failed to parse notification message");
    return new Response("Invalid notification format", { status: 400 });
  }

  if (notification.type !== "PRICE_BATCH_COMPLETE") {
    console.log(`Ignoring notification type: ${notification.type}`);
    return new Response("OK", { status: 200 });
  }

  console.log("Received price update notification:", {
    source: notification.source,
    timestamp: notification.timestamp,
    cardsProcessed: notification.stats.cardsProcessed,
    cardsUpdated: notification.stats.cardsUpdated,
    errorCount: notification.stats.errorCount,
  });

  // Trigger price sync
  try {
    await triggerPriceSync(notification);
    return new Response(
      JSON.stringify({
        success: true,
        message: "Price sync triggered",
        stats: notification.stats,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Failed to trigger price sync:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: "Price sync failed",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}

async function handleDirectWebhook(request: Request, body: string): Promise<Response> {
  // Verify signature if secret is configured
  if (WEBHOOK_SECRET) {
    const signature = request.headers.get("x-webhook-signature");

    if (!signature) {
      return new Response("Missing signature", { status: 401 });
    }

    const isValid = verifyWebhookSignature(body, signature, WEBHOOK_SECRET);
    if (!isValid) {
      return new Response("Invalid signature", { status: 401 });
    }
  }

  let notification: PriceUpdateNotification;

  try {
    notification = JSON.parse(body) as PriceUpdateNotification;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  if (notification.type !== "PRICE_BATCH_COMPLETE") {
    return new Response("OK", { status: 200 });
  }

  console.log("Received direct price update webhook:", notification);

  try {
    await triggerPriceSync(notification);
    return new Response(
      JSON.stringify({ success: true }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Price sync error:", error);
    return new Response(
      JSON.stringify({ success: false, error: "Sync failed" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}

async function triggerPriceSync(notification: PriceUpdateNotification): Promise<void> {
  // Import modules dynamically to avoid server-only import issues
  const { syncPricesFromExternal } = await import("../lib/prices.server");
  const { invalidatePriceCaches } = await import("../lib/cache.server");

  console.log(`Starting price sync triggered by ${notification.source} update`);

  const startTime = Date.now();
  const result = await syncPricesFromExternal();
  const duration = Date.now() - startTime;

  // Invalidate price caches after sync
  await invalidatePriceCaches();

  console.log(`Price sync completed in ${duration}ms:`, {
    synced: result.synced,
    errors: result.errors,
    source: notification.source,
    lambdaStats: notification.stats,
  });
}

// Loader for health checks
export async function loader() {
  return new Response(
    JSON.stringify({
      status: "ok",
      endpoint: "price-webhook",
      accepts: ["SNS", "direct"],
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }
  );
}
