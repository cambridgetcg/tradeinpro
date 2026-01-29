/**
 * API Route: Arbitrage Feedback
 *
 * Collects user feedback on arbitrage opportunities for model training:
 * - Record executed trades
 * - Capture actual profits/losses
 * - Track opportunity validity
 */

import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

// =============================================================================
// TYPES
// =============================================================================

interface FeedbackSubmission {
  opportunityId: number;
  wasExecuted: boolean;
  actualProfit?: number;
  wasSuccessful?: boolean;
  executionNotes?: string;
  failureReason?: string;
  priceAtExecution?: {
    buyPrice: number;
    sellPrice: number;
  };
}

interface FeedbackResponse {
  success: boolean;
  feedbackId?: number;
  message: string;
  error?: string;
}

// =============================================================================
// LOADER - Get pending feedback requests
// =============================================================================

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const limit = parseInt(url.searchParams.get("limit") || "50", 10);
  const status = url.searchParams.get("status") || "pending";

  const { prisma } = await import("../db.server");

  // Get opportunities that need feedback
  const opportunities = await prisma.arbitrageOpportunity.findMany({
    where: {
      wasExecuted: status === "pending" ? null : status === "executed" ? true : false,
      detectedAt: {
        gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // Last 7 days
      },
    },
    orderBy: {
      detectedAt: "desc",
    },
    take: limit,
    select: {
      id: true,
      cardId: true,
      buyMarket: true,
      buyPrice: true,
      buyCurrency: true,
      buyPriceGbp: true,
      sellMarket: true,
      sellPrice: true,
      sellCurrency: true,
      sellPriceGbp: true,
      grossSpread: true,
      netSpread: true,
      confidence: true,
      urgency: true,
      detectedAt: true,
      wasExecuted: true,
      wasSuccessful: true,
      actualProfit: true,
    },
  });

  // Get feedback statistics
  const stats = await prisma.arbitrageOpportunity.groupBy({
    by: ["wasExecuted", "wasSuccessful"],
    _count: true,
    where: {
      detectedAt: {
        gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // Last 30 days
      },
    },
  });

  return {
    opportunities,
    stats: {
      total: stats.reduce((sum, s) => sum + s._count, 0),
      executed: stats
        .filter((s) => s.wasExecuted === true)
        .reduce((sum, s) => sum + s._count, 0),
      successful: stats
        .filter((s) => s.wasSuccessful === true)
        .reduce((sum, s) => sum + s._count, 0),
      pending: stats
        .filter((s) => s.wasExecuted === null)
        .reduce((sum, s) => sum + s._count, 0),
    },
  };
}

// =============================================================================
// ACTION - Submit feedback
// =============================================================================

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return {
      success: false,
      error: "Method not allowed",
    } as FeedbackResponse;
  }

  try {
    const body = await request.json();
    const feedback = body as FeedbackSubmission;

    // Validate required fields
    if (!feedback.opportunityId) {
      return {
        success: false,
        error: "opportunityId is required",
      } as FeedbackResponse;
    }

    const { prisma } = await import("../db.server");

    // Update the opportunity with feedback
    const updated = await prisma.arbitrageOpportunity.update({
      where: { id: feedback.opportunityId },
      data: {
        wasExecuted: feedback.wasExecuted,
        wasSuccessful: feedback.wasSuccessful,
        actualProfit: feedback.actualProfit,
        feedbackAt: new Date(),
      },
    });

    // Also record in training feedback table for detailed tracking
    await prisma.trainingFeedback.create({
      data: {
        modelType: "arbitrage_detector",
        predictionId: feedback.opportunityId.toString(),
        userFeedback: feedback.wasSuccessful === true
          ? "correct"
          : feedback.wasSuccessful === false
            ? "incorrect"
            : "skipped",
        confidence: Number(updated.confidence),
        notes: feedback.executionNotes || feedback.failureReason,
      },
    });

    // If trade was executed, also log to trade_log
    if (feedback.wasExecuted && feedback.priceAtExecution) {
      await prisma.tradeLog.create({
        data: {
          cardId: updated.cardId,
          buyMarket: updated.buyMarket,
          buyPrice: feedback.priceAtExecution.buyPrice,
          sellMarket: updated.sellMarket,
          sellPrice: feedback.priceAtExecution.sellPrice,
          predictedProfit: Number(updated.netSpread) * Number(updated.buyPriceGbp),
          actualProfit: feedback.actualProfit,
          wasSuccessful: feedback.wasSuccessful ?? false,
          executedAt: new Date(),
        },
      });
    }

    return {
      success: true,
      feedbackId: updated.id,
      message: "Feedback recorded successfully",
    } as FeedbackResponse;
  } catch (error) {
    console.error("Feedback submission error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    } as FeedbackResponse;
  }
}

// =============================================================================
// BATCH FEEDBACK ENDPOINT
// =============================================================================

export async function batchFeedback(
  feedbackItems: FeedbackSubmission[]
): Promise<{ success: number; failed: number; errors: string[] }> {
  const { prisma } = await import("../db.server");
  const errors: string[] = [];
  let success = 0;
  let failed = 0;

  for (const feedback of feedbackItems) {
    try {
      await prisma.arbitrageOpportunity.update({
        where: { id: feedback.opportunityId },
        data: {
          wasExecuted: feedback.wasExecuted,
          wasSuccessful: feedback.wasSuccessful,
          actualProfit: feedback.actualProfit,
          feedbackAt: new Date(),
        },
      });
      success++;
    } catch (error) {
      failed++;
      errors.push(
        `Failed to update ${feedback.opportunityId}: ${error instanceof Error ? error.message : "Unknown"}`
      );
    }
  }

  return { success, failed, errors };
}
