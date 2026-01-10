import { Router } from 'express';
import prisma from '../db.js';

export const trainingRouter = Router();

// Get training results and metrics
trainingRouter.get('/', async (req, res) => {
  try {
    const game = 'onepiece';

    // Get model history
    const modelHistory = await prisma.neuralModelHistory.findMany({
      orderBy: { trainedAt: 'desc' },
      take: 10,
    });

    // Get current model (latest)
    const currentModel = modelHistory[0];

    // Get deal type breakdown
    const dealTypeStats = await prisma.neuralDeal.groupBy({
      by: ['dealType'],
      where: { game },
      _count: true,
      _avg: {
        confidence: true,
        expectedReturn: true,
        actualReturn: true,
      },
    });

    // Calculate per-type metrics
    const dealTypeBreakdown = dealTypeStats.map((stat) => ({
      dealType: stat.dealType,
      totalDeals: stat._count,
      avgConfidence: stat._avg.confidence ? Number(stat._avg.confidence) : 0,
      avgExpectedReturn: stat._avg.expectedReturn ? Number(stat._avg.expectedReturn) : 0,
      avgActualReturn: stat._avg.actualReturn ? Number(stat._avg.actualReturn) : null,
    }));

    // Get training data statistics
    const [totalExamples, positiveCount, dateRange] = await Promise.all([
      prisma.neuralDeal.count({ where: { game, status: { in: ['EXECUTED', 'EXPIRED'] } } }),
      prisma.neuralDeal.count({ where: { game, status: 'EXECUTED' } }),
      prisma.neuralDeal.aggregate({
        where: { game },
        _min: { createdAt: true },
        _max: { createdAt: true },
      }),
    ]);

    // Get annotation stats
    const annotationStats = await prisma.neuralDeal.groupBy({
      by: ['userRating'],
      where: { game, userRating: { not: null } },
      _count: true,
    });

    // Build confusion matrix data (simplified - deal type distribution by rating)
    const confusionData = await prisma.neuralDeal.groupBy({
      by: ['dealType', 'userRating'],
      where: { game, userRating: { not: null } },
      _count: true,
    });

    // Feature importance from recent deals (mock - in reality would come from model)
    const featureImportance = [
      { feature: 'momentum_rsi', importance: 0.15, category: 'temporal' },
      { feature: 'mean_reversion_distance', importance: 0.12, category: 'temporal' },
      { feature: 'velocity_7d', importance: 0.11, category: 'temporal' },
      { feature: 'spread_min_max', importance: 0.09, category: 'price' },
      { feature: 'percentile_in_set', importance: 0.08, category: 'price' },
      { feature: 'correlation_deviation', importance: 0.07, category: 'market' },
      { feature: 'volume_relative', importance: 0.06, category: 'market' },
      { feature: 'fx_adjusted_gap', importance: 0.06, category: 'fx' },
      { feature: 'volatility_7d', importance: 0.05, category: 'temporal' },
      { feature: 'trend_strength', importance: 0.05, category: 'temporal' },
      { feature: 'inventory_signal', importance: 0.04, category: 'market' },
      { feature: 'opportunity_score', importance: 0.04, category: 'derived' },
      { feature: 'current_gbp', importance: 0.03, category: 'price' },
      { feature: 'risk_score', importance: 0.03, category: 'derived' },
      { feature: 'seasonality_index', importance: 0.02, category: 'temporal' },
    ];

    res.json({
      modelHistory: modelHistory.map((m) => ({
        version: m.modelVersion,
        trainedAt: m.trainedAt,
        trainingSamples: m.trainingSamples,
        validationSamples: m.validationSamples,
        metrics: {
          dealTypeAccuracy: m.dealTypeAccuracy ? Number(m.dealTypeAccuracy) : null,
          confidenceBrierScore: m.confidenceBrierScore ? Number(m.confidenceBrierScore) : null,
          returnMae: m.returnMae ? Number(m.returnMae) : null,
          riskF1Score: m.riskF1Score ? Number(m.riskF1Score) : null,
        },
        notes: m.notes,
      })),
      currentModel: currentModel
        ? {
            version: currentModel.modelVersion,
            trainingSamples: currentModel.trainingSamples,
            validationSamples: currentModel.validationSamples,
            metrics: {
              dealTypeAccuracy: currentModel.dealTypeAccuracy ? Number(currentModel.dealTypeAccuracy) : null,
              confidenceBrierScore: currentModel.confidenceBrierScore ? Number(currentModel.confidenceBrierScore) : null,
              returnMae: currentModel.returnMae ? Number(currentModel.returnMae) : null,
              riskF1Score: currentModel.riskF1Score ? Number(currentModel.riskF1Score) : null,
            },
            notes: currentModel.notes,
          }
        : null,
      dealTypeBreakdown,
      featureImportance,
      trainingDataStats: {
        totalExamples,
        positiveExamples: positiveCount,
        negativeExamples: totalExamples - positiveCount,
        dateRange: {
          start: dateRange._min.createdAt,
          end: dateRange._max.createdAt,
        },
      },
      annotationStats: {
        good: annotationStats.find((a) => a.userRating === 'good')?._count || 0,
        bad: annotationStats.find((a) => a.userRating === 'bad')?._count || 0,
        uncertain: annotationStats.find((a) => a.userRating === 'uncertain')?._count || 0,
      },
      confusionData,
    });
  } catch (error) {
    console.error('Training data error:', error);
    res.status(500).json({ error: 'Failed to load training data' });
  }
});

// Export annotated deals for training
trainingRouter.post('/export', async (req, res) => {
  try {
    const game = 'onepiece';

    const annotatedDeals = await prisma.neuralDeal.findMany({
      where: {
        game,
        userRating: { not: null },
      },
      include: {
        card: {
          select: { name: true, setCode: true },
        },
      },
    });

    const exportData = {
      exportedAt: new Date().toISOString(),
      totalDeals: annotatedDeals.length,
      deals: annotatedDeals.map((d) => ({
        cardId: d.cardId,
        cardName: d.card?.name,
        dealType: d.dealType,
        confidence: Number(d.confidence),
        expectedReturn: Number(d.expectedReturn),
        riskLevel: d.riskLevel,
        timeHorizon: d.timeHorizon,
        // Labels from annotation
        userRating: d.userRating,
        wasProfitable: d.wasProfitable,
        profitAmount: d.profitAmount ? Number(d.profitAmount) : null,
        actualReturn: d.actualReturn ? Number(d.actualReturn) : null,
        // Features
        featureImportance: d.featureImportance,
        metadata: d.metadata,
        // Timestamps
        createdAt: d.createdAt,
        annotatedAt: d.annotatedAt,
      })),
    };

    res.json(exportData);
  } catch (error) {
    console.error('Export error:', error);
    res.status(500).json({ error: 'Failed to export training data' });
  }
});
