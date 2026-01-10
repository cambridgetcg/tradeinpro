import { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { DealCard } from '../components/DealCard';

interface Deal {
  id: string;
  cardId: string;
  cardName: string;
  setCode?: string;
  imageUrl?: string;
  dealType: string;
  confidence: number;
  expectedReturn: number;
  riskLevel: string;
  timeHorizon: string;
  status: string;
  userRating: string | null;
  annotationNotes: string | null;
  createdAt: string;
}

interface DealsData {
  deals: Deal[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  summary: {
    total: number;
    thumbsUp: number;
    thumbsDown: number;
    pendingReview: number;
    byType: Record<string, number>;
  };
}

const DEAL_TYPES = [
  'all',
  'ARBITRAGE_CROSS_MARKET',
  'ARBITRAGE_CURRENCY',
  'UNDERVALUED_STATISTICAL',
  'UNDERVALUED_COMPARATIVE',
  'MOMENTUM_BREAKOUT',
  'MOMENTUM_REVERSAL',
  'SUPPLY_SHOCK',
  'DEMAND_SURGE',
  'CORRELATION_BREAK',
  'SEASONAL_OPPORTUNITY',
];

const STATUS_OPTIONS = ['all', 'ACTIVE', 'EXPIRED', 'EXECUTED'];
const ANNOTATION_OPTIONS = ['all', 'annotated', 'pending'];

export default function Deals() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState<DealsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Get filter values from URL
  const type = searchParams.get('type') || 'all';
  const status = searchParams.get('status') || 'all';
  const annotated = searchParams.get('annotated') || 'all';
  const minConfidence = searchParams.get('minConfidence') || '';
  const page = parseInt(searchParams.get('page') || '1', 10);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (type !== 'all') params.set('type', type);
      if (status !== 'all') params.set('status', status);
      if (annotated !== 'all') params.set('annotated', annotated);
      if (minConfidence) params.set('minConfidence', minConfidence);
      params.set('page', String(page));
      params.set('limit', '20');

      const res = await fetch(`/api/deals?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to fetch');
      const json = await res.json();
      setData(json);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [type, status, annotated, minConfidence, page]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleFilterChange = (key: string, value: string) => {
    const newParams = new URLSearchParams(searchParams);
    if (value === 'all' || value === '') {
      newParams.delete(key);
    } else {
      newParams.set(key, value);
    }
    // Reset to page 1 when changing filters
    if (key !== 'page') {
      newParams.set('page', '1');
    }
    setSearchParams(newParams);
  };

  const handleFeedback = async (dealId: string, rating: 'good' | 'bad') => {
    try {
      const res = await fetch(`/api/deals/${dealId}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating }),
      });
      if (!res.ok) throw new Error('Failed to save feedback');
      // Refresh data
      fetchData();
    } catch (err) {
      console.error('Feedback error:', err);
    }
  };

  const formatDealType = (t: string) => {
    return t.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  };

  if (loading && !data) {
    return <div className="text-center py-8 text-gray-500">Loading deals...</div>;
  }

  if (error) {
    return (
      <div className="card bg-red-50 border-red-200">
        <p className="text-red-600">Error: {error}</p>
        <button onClick={fetchData} className="btn btn-secondary mt-2">
          Retry
        </button>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Deal Review</h2>
          <p className="text-gray-500 mt-1">
            Review and annotate neural network deal predictions
          </p>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <span className="flex items-center gap-1">
            <span className="text-green-600 font-medium">{data.summary.thumbsUp}</span> good
          </span>
          <span className="flex items-center gap-1">
            <span className="text-red-600 font-medium">{data.summary.thumbsDown}</span> bad
          </span>
          <span className="flex items-center gap-1">
            <span className="text-gray-600 font-medium">{data.summary.pendingReview}</span> pending
          </span>
        </div>
      </div>

      {/* Filters */}
      <div className="card">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {/* Deal Type Filter */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Deal Type</label>
            <select
              value={type}
              onChange={(e) => handleFilterChange('type', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-neural-primary focus:border-neural-primary"
            >
              {DEAL_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t === 'all' ? 'All Types' : formatDealType(t)}
                </option>
              ))}
            </select>
          </div>

          {/* Status Filter */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
            <select
              value={status}
              onChange={(e) => handleFilterChange('status', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-neural-primary focus:border-neural-primary"
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s === 'all' ? 'All Statuses' : s}
                </option>
              ))}
            </select>
          </div>

          {/* Annotation Filter */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Review Status</label>
            <select
              value={annotated}
              onChange={(e) => handleFilterChange('annotated', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-neural-primary focus:border-neural-primary"
            >
              {ANNOTATION_OPTIONS.map((a) => (
                <option key={a} value={a}>
                  {a === 'all' ? 'All' : a === 'annotated' ? 'Reviewed' : 'Pending Review'}
                </option>
              ))}
            </select>
          </div>

          {/* Min Confidence Filter */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Min Confidence: {minConfidence ? `${(parseFloat(minConfidence) * 100).toFixed(0)}%` : 'Any'}
            </label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.1"
              value={minConfidence || '0'}
              onChange={(e) =>
                handleFilterChange('minConfidence', e.target.value === '0' ? '' : e.target.value)
              }
              className="w-full h-2 bg-gray-200 rounded-lg cursor-pointer"
            />
          </div>
        </div>
      </div>

      {/* Deal Type Distribution (collapsed) */}
      {Object.keys(data.summary.byType).length > 0 && (
        <details className="card">
          <summary className="cursor-pointer text-sm font-medium text-gray-700">
            Distribution by Type ({data.summary.total} total)
          </summary>
          <div className="mt-3 space-y-1">
            {Object.entries(data.summary.byType)
              .sort((a, b) => b[1] - a[1])
              .map(([dealType, count]) => (
                <div key={dealType} className="flex items-center gap-2 text-sm">
                  <div className="flex-1 bg-gray-200 rounded-full h-1.5">
                    <div
                      className="bg-neural-secondary rounded-full h-1.5"
                      style={{ width: `${(count / data.summary.total) * 100}%` }}
                    />
                  </div>
                  <span className="w-40 truncate text-gray-600">{formatDealType(dealType)}</span>
                  <span className="w-12 text-right font-medium">{count}</span>
                </div>
              ))}
          </div>
        </details>
      )}

      {/* Deals List */}
      <div className="space-y-3">
        {data.deals.length === 0 ? (
          <div className="card text-center py-8 text-gray-500">
            No deals match the current filters
          </div>
        ) : (
          data.deals.map((deal) => (
            <DealCard key={deal.id} deal={deal} onFeedback={handleFeedback} />
          ))
        )}
      </div>

      {/* Pagination */}
      {data.pagination.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-500">
            Showing {(data.pagination.page - 1) * data.pagination.limit + 1} -{' '}
            {Math.min(data.pagination.page * data.pagination.limit, data.pagination.total)} of{' '}
            {data.pagination.total}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => handleFilterChange('page', String(page - 1))}
              disabled={page <= 1}
              className="btn btn-secondary text-sm"
            >
              Previous
            </button>
            <span className="px-4 py-2 text-sm text-gray-600">
              Page {data.pagination.page} of {data.pagination.totalPages}
            </span>
            <button
              onClick={() => handleFilterChange('page', String(page + 1))}
              disabled={page >= data.pagination.totalPages}
              className="btn btn-secondary text-sm"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
