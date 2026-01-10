import { Router } from 'express';
import prisma from '../db.js';

export const dashboardRouter = Router();

dashboardRouter.get('/', async (req, res) => {
  try {
    const game = 'onepiece';

    // Get deal statistics
    const [
      totalDeals,
      activeDeals,
      annotatedCount,
      dealsByType,
      recentDeals,
      totalCards,
      historyCount,
      correlationCount,
    ] = await Promise.all([
      prisma.neuralDeal.count({ where: { game } }),
      prisma.neuralDeal.count({ where: { game, status: 'ACTIVE' } }),
      prisma.neuralDeal.count({ where: { game, userRating: { not: null } } }),
      prisma.neuralDeal.groupBy({
        by: ['dealType'],
        where: { game },
        _count: true,
      }),
      prisma.neuralDeal.findMany({
        where: { game },
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: {
          card: {
            select: { name: true, setCode: true, bestPriceGbp: true, imageUrl: true },
          },
        },
      }),
      prisma.cardPriceV2.count({ where: { game } }),
      prisma.cardPriceHistory.count({ where: { game } }),
      prisma.cardCorrelationCache.count({ where: { game } }),
    ]);

    // Get model info
    const latestModel = await prisma.neuralModelHistory.findFirst({
      orderBy: { trainedAt: 'desc' },
    });

    // Calculate average confidence and return
    const dealStats = await prisma.neuralDeal.aggregate({
      where: { game },
      _avg: {
        confidence: true,
        expectedReturn: true,
        actualReturn: true,
      },
    });

    // Format deal type distribution
    const dealTypeDistribution: Record<string, number> = {};
    for (const d of dealsByType) {
      dealTypeDistribution[d.dealType] = d._count;
    }

    res.json({
      modelInfo: {
        version: latestModel?.modelVersion || 'No model',
        isLoaded: !!latestModel,
        lastTrainedAt: latestModel?.trainedAt,
        trainingSamples: latestModel?.trainingSamples,
        accuracy: latestModel?.dealTypeAccuracy ? Number(latestModel.dealTypeAccuracy) : null,
      },
      stats: {
        totalDeals,
        activeDeals,
        annotatedCount,
        pendingAnnotation: totalDeals - annotatedCount,
        avgConfidence: dealStats._avg.confidence ? Number(dealStats._avg.confidence) : 0,
        avgExpectedReturn: dealStats._avg.expectedReturn ? Number(dealStats._avg.expectedReturn) : 0,
        avgActualReturn: dealStats._avg.actualReturn ? Number(dealStats._avg.actualReturn) : null,
      },
      dataQuality: {
        totalCards,
        historyRecords: historyCount,
        correlationRecords: correlationCount,
        featureCoverage: correlationCount > 0 ? Math.min(100, (correlationCount / totalCards) * 100) : 0,
      },
      dealTypeDistribution,
      recentDeals: recentDeals.map((d) => ({
        id: d.id,
        cardId: d.cardId,
        cardName: d.card?.name || d.cardId,
        setCode: d.card?.setCode,
        dealType: d.dealType,
        confidence: Number(d.confidence),
        expectedReturn: Number(d.expectedReturn),
        riskLevel: d.riskLevel,
        status: d.status,
        userRating: d.userRating,
        createdAt: d.createdAt,
        imageUrl: d.card?.imageUrl,
      })),
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).json({ error: 'Failed to load dashboard data' });
  }
});
