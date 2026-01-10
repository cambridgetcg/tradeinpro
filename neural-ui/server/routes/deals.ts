import { Router } from 'express';
import prisma from '../db.js';

export const dealsRouter = Router();

// List deals with filters
dealsRouter.get('/', async (req, res) => {
  try {
    const {
      type,
      status,
      annotated,
      minConfidence,
      page = '1',
      limit = '20',
    } = req.query;

    const game = 'onepiece';
    const pageNum = parseInt(page as string, 10);
    const limitNum = parseInt(limit as string, 10);
    const skip = (pageNum - 1) * limitNum;

    // Build where clause
    const where: any = { game };

    if (type && type !== 'all') {
      where.dealType = type;
    }

    if (status && status !== 'all') {
      where.status = status;
    }

    if (annotated === 'annotated') {
      where.userRating = { not: null };
    } else if (annotated === 'pending') {
      where.userRating = null;
    }

    if (minConfidence) {
      where.confidence = { gte: parseFloat(minConfidence as string) };
    }

    // Get deals and count
    const [deals, total] = await Promise.all([
      prisma.neuralDeal.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limitNum,
        include: {
          card: {
            select: { name: true, setCode: true, bestPriceGbp: true, imageUrl: true },
          },
        },
      }),
      prisma.neuralDeal.count({ where }),
    ]);

    // Get summary stats
    const [thumbsUp, thumbsDown, byType] = await Promise.all([
      prisma.neuralDeal.count({ where: { game, userRating: 'good' } }),
      prisma.neuralDeal.count({ where: { game, userRating: 'bad' } }),
      prisma.neuralDeal.groupBy({
        by: ['dealType'],
        where: { game },
        _count: true,
      }),
    ]);

    res.json({
      deals: deals.map((d) => ({
        id: d.id,
        cardId: d.cardId,
        cardName: d.card?.name || d.cardId,
        setCode: d.card?.setCode,
        imageUrl: d.card?.imageUrl,
        dealType: d.dealType,
        confidence: Number(d.confidence),
        expectedReturn: Number(d.expectedReturn),
        riskLevel: d.riskLevel,
        timeHorizon: d.timeHorizon,
        status: d.status,
        userRating: d.userRating,
        annotationNotes: d.annotationNotes,
        buyPrice: d.buyPrice ? Number(d.buyPrice) : null,
        buyMarket: d.buyMarket,
        createdAt: d.createdAt,
        expiresAt: d.expiresAt,
      })),
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
      summary: {
        total,
        thumbsUp,
        thumbsDown,
        pendingReview: total - thumbsUp - thumbsDown,
        byType: Object.fromEntries(byType.map((b) => [b.dealType, b._count])),
      },
    });
  } catch (error) {
    console.error('Deals list error:', error);
    res.status(500).json({ error: 'Failed to load deals' });
  }
});

// Get single deal with full details
dealsRouter.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const deal = await prisma.neuralDeal.findUnique({
      where: { id },
      include: {
        card: {
          select: {
            name: true,
            setCode: true,
            rarity: true,
            variantType: true,
            bestPriceGbp: true,
            imageUrl: true,
          },
        },
      },
    });

    if (!deal) {
      return res.status(404).json({ error: 'Deal not found' });
    }

    // Get price history for the card
    const priceHistory = await prisma.cardPriceHistory.findMany({
      where: {
        cardId: deal.cardId,
        snapshotDate: {
          gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        },
      },
      orderBy: { snapshotDate: 'asc' },
      select: { snapshotDate: true, priceGbp: true },
    });

    // Get related deals for same card
    const relatedDeals = await prisma.neuralDeal.findMany({
      where: {
        cardId: deal.cardId,
        id: { not: deal.id },
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: {
        id: true,
        dealType: true,
        confidence: true,
        status: true,
        createdAt: true,
      },
    });

    // Get common tags for suggestions
    const tagsResult = await prisma.neuralDeal.findMany({
      where: {
        annotationTags: { isEmpty: false },
      },
      select: { annotationTags: true },
      take: 100,
    });
    const tagCounts = new Map<string, number>();
    for (const d of tagsResult) {
      for (const tag of d.annotationTags) {
        tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
      }
    }
    const suggestedTags = Array.from(tagCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([tag]) => tag);

    res.json({
      deal: {
        id: deal.id,
        cardId: deal.cardId,
        dealType: deal.dealType,
        confidence: Number(deal.confidence),
        expectedReturn: Number(deal.expectedReturn),
        riskLevel: deal.riskLevel,
        timeHorizon: deal.timeHorizon,
        actionType: deal.actionType,
        buyMarket: deal.buyMarket,
        buyPrice: deal.buyPrice ? Number(deal.buyPrice) : null,
        sellMarket: deal.sellMarket,
        sellPrice: deal.sellPrice ? Number(deal.sellPrice) : null,
        status: deal.status,
        metadata: deal.metadata,
        featureImportance: deal.featureImportance,
        createdAt: deal.createdAt,
        expiresAt: deal.expiresAt,
        executedAt: deal.executedAt,
        actualReturn: deal.actualReturn ? Number(deal.actualReturn) : null,
        // Annotation fields
        userRating: deal.userRating,
        annotationNotes: deal.annotationNotes,
        annotationTags: deal.annotationTags || [],
        wasProfitable: deal.wasProfitable,
        profitAmount: deal.profitAmount ? Number(deal.profitAmount) : null,
        annotatedAt: deal.annotatedAt,
      },
      card: deal.card
        ? {
            name: deal.card.name,
            setCode: deal.card.setCode,
            rarity: deal.card.rarity,
            variantType: deal.card.variantType,
            currentPrice: Number(deal.card.bestPriceGbp),
            imageUrl: deal.card.imageUrl,
          }
        : null,
      priceHistory: priceHistory.map((h) => ({
        date: h.snapshotDate,
        price: Number(h.priceGbp),
      })),
      relatedDeals: relatedDeals.map((d) => ({
        id: d.id,
        dealType: d.dealType,
        confidence: Number(d.confidence),
        status: d.status,
        createdAt: d.createdAt,
      })),
      suggestedTags,
    });
  } catch (error) {
    console.error('Deal detail error:', error);
    res.status(500).json({ error: 'Failed to load deal' });
  }
});

// Quick feedback (thumbs up/down)
dealsRouter.post('/:id/feedback', async (req, res) => {
  try {
    const { id } = req.params;
    const { rating } = req.body; // 'good' | 'bad' | 'uncertain'

    if (!['good', 'bad', 'uncertain'].includes(rating)) {
      return res.status(400).json({ error: 'Invalid rating' });
    }

    const deal = await prisma.neuralDeal.update({
      where: { id },
      data: {
        userRating: rating,
        annotatedAt: new Date(),
      },
    });

    res.json({
      success: true,
      dealId: deal.id,
      rating: deal.userRating,
    });
  } catch (error) {
    console.error('Feedback error:', error);
    res.status(500).json({ error: 'Failed to save feedback' });
  }
});

// Full annotation
dealsRouter.post('/:id/annotate', async (req, res) => {
  try {
    const { id } = req.params;
    const { rating, notes, tags, wasProfitable, profitAmount } = req.body;

    const deal = await prisma.neuralDeal.update({
      where: { id },
      data: {
        userRating: rating || null,
        annotationNotes: notes || null,
        annotationTags: tags || [],
        wasProfitable: wasProfitable !== undefined ? wasProfitable : null,
        profitAmount: profitAmount !== undefined ? profitAmount : null,
        annotatedAt: new Date(),
      },
    });

    res.json({
      success: true,
      dealId: deal.id,
      annotation: {
        userRating: deal.userRating,
        annotationNotes: deal.annotationNotes,
        annotationTags: deal.annotationTags,
        wasProfitable: deal.wasProfitable,
        profitAmount: deal.profitAmount ? Number(deal.profitAmount) : null,
        annotatedAt: deal.annotatedAt,
      },
    });
  } catch (error) {
    console.error('Annotation error:', error);
    res.status(500).json({ error: 'Failed to save annotation' });
  }
});
