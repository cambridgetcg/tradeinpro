/**
 * API Route: Data Collection Status
 *
 * Provides status and metrics for the data collection pipeline
 */

import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { getAllJobStates, JOB_CONFIGS } from "~/lib/data-collection";

// =============================================================================
// LOADER - Get collection status
// =============================================================================

export async function loader({ request }: LoaderFunctionArgs) {
  const { prisma } = await import("../db.server");

  // Get job states
  const jobStates = getAllJobStates();
  const jobs = Object.entries(JOB_CONFIGS).map(([id, config]) => {
    const state = jobStates.get(id);
    return {
      id,
      name: config.name,
      enabled: config.enabled,
      intervalMs: config.intervalMs,
      lastRun: state?.lastRun,
      nextRun: state?.nextRun,
      isRunning: state?.isRunning || false,
      consecutiveFailures: state?.consecutiveFailures || 0,
      lastResult: state?.lastResult,
    };
  });

  // Get data counts
  const [
    usPriceCount,
    euPriceCount,
    fxRateCount,
    arbitrageCount,
    dailyHistoryCount,
    feedbackCount,
  ] = await Promise.all([
    prisma.marketPriceUS.count(),
    prisma.marketPriceEU.count(),
    prisma.fXRate.count(),
    prisma.arbitrageOpportunity.count(),
    prisma.priceHistoryDaily.count(),
    prisma.trainingFeedback.count(),
  ]);

  // Get recent data timestamps
  const [latestUSPrice, latestEUPrice, latestFXRate] = await Promise.all([
    prisma.marketPriceUS.findFirst({
      orderBy: { updatedAt: "desc" },
      select: { updatedAt: true },
    }),
    prisma.marketPriceEU.findFirst({
      orderBy: { updatedAt: "desc" },
      select: { updatedAt: true },
    }),
    prisma.fXRate.findFirst({
      orderBy: { fetchedAt: "desc" },
      select: { fetchedAt: true, usdGbp: true, eurGbp: true, jpyGbp: true },
    }),
  ]);

  // Calculate data freshness
  const now = Date.now();
  const dataFreshness = {
    usMarket: latestUSPrice?.updatedAt
      ? {
          lastUpdate: latestUSPrice.updatedAt,
          ageMinutes: Math.round((now - latestUSPrice.updatedAt.getTime()) / 60000),
          isStale: now - latestUSPrice.updatedAt.getTime() > 4 * 60 * 60 * 1000,
        }
      : null,
    euMarket: latestEUPrice?.updatedAt
      ? {
          lastUpdate: latestEUPrice.updatedAt,
          ageMinutes: Math.round((now - latestEUPrice.updatedAt.getTime()) / 60000),
          isStale: now - latestEUPrice.updatedAt.getTime() > 24 * 60 * 60 * 1000,
        }
      : null,
    fxRates: latestFXRate?.fetchedAt
      ? {
          lastUpdate: latestFXRate.fetchedAt,
          ageMinutes: Math.round((now - latestFXRate.fetchedAt.getTime()) / 60000),
          isStale: now - latestFXRate.fetchedAt.getTime() > 60 * 60 * 1000,
          rates: {
            USDGBP: Number(latestFXRate.usdGbp),
            EURGBP: Number(latestFXRate.eurGbp),
            JPYGBP: Number(latestFXRate.jpyGbp),
          },
        }
      : null,
  };

  // Training data readiness
  const trainingReadiness = {
    arbitrage: {
      required: 10000,
      collected: arbitrageCount,
      percentComplete: Math.min(100, Math.round((arbitrageCount / 10000) * 100)),
      ready: arbitrageCount >= 10000,
    },
    timeSeries: {
      required: 500000,
      collected: dailyHistoryCount,
      percentComplete: Math.min(100, Math.round((dailyHistoryCount / 500000) * 100)),
      ready: dailyHistoryCount >= 500000,
    },
    feedback: {
      required: 1000,
      collected: feedbackCount,
      percentComplete: Math.min(100, Math.round((feedbackCount / 1000) * 100)),
      ready: feedbackCount >= 1000,
    },
  };

  return {
    jobs,
    dataCounts: {
      usPrices: usPriceCount,
      euPrices: euPriceCount,
      fxRates: fxRateCount,
      arbitrageOpportunities: arbitrageCount,
      dailyHistory: dailyHistoryCount,
      trainingFeedback: feedbackCount,
    },
    dataFreshness,
    trainingReadiness,
    timestamp: new Date(),
  };
}

// =============================================================================
// ACTION - Trigger jobs manually
// =============================================================================

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return { success: false, error: "Method not allowed" };
  }

  try {
    const body = await request.json();
    const { action: jobAction, jobId } = body as { action: string; jobId?: string };

    const {
      runOPTCGSync,
      runJustTCGFullRefresh,
      runJustTCGTopMovers,
      runFXRatesRefresh,
    } = await import("~/lib/data-collection");

    switch (jobAction) {
      case "run": {
        if (!jobId) {
          return { success: false, error: "jobId required" };
        }

        let result;
        switch (jobId) {
          case "optcg_sync":
            result = await runOPTCGSync();
            break;
          case "justtcg_full":
            result = await runJustTCGFullRefresh();
            break;
          case "justtcg_movers":
            result = await runJustTCGTopMovers();
            break;
          case "fx_rates":
            result = await runFXRatesRefresh();
            break;
          default:
            return { success: false, error: `Unknown job: ${jobId}` };
        }

        return {
          success: true,
          jobId,
          result,
        };
      }

      case "refresh_all": {
        const results = await Promise.allSettled([
          runOPTCGSync(),
          runJustTCGTopMovers(),
          runFXRatesRefresh(),
        ]);

        return {
          success: true,
          results: results.map((r, i) => ({
            job: ["optcg_sync", "justtcg_movers", "fx_rates"][i],
            status: r.status,
            result: r.status === "fulfilled" ? r.value : undefined,
            error: r.status === "rejected" ? r.reason?.message : undefined,
          })),
        };
      }

      default:
        return { success: false, error: `Unknown action: ${jobAction}` };
    }
  } catch (error) {
    console.error("Collection action error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
