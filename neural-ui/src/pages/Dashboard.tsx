import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { StatsCard } from '../components/StatsCard';
import { FeedbackButtons } from '../components/FeedbackButtons';

interface DashboardData {
  modelInfo: {
    version: string;
    isLoaded: boolean;
    lastTrainedAt: string | null;
    trainingSamples: number | null;
    accuracy: number | null;
  };
  stats: {
    totalDeals: number;
    activeDeals: number;
    annotatedCount: number;
    pendingAnnotation: number;
    avgConfidence: number;
    avgExpectedReturn: number;
  };
  dataQuality: {
    totalCards: number;
    historyRecords: number;
    correlationRecords: number;
    featureCoverage: number;
  };
  dealTypeDistribution: Record<string, number>;
  recentDeals: Array<{
    id: string;
    cardId: string;
    cardName: string;
    dealType: string;
    confidence: number;
    expectedReturn: number;
    riskLevel: string;
    status: string;
    userRating: string | null;
    createdAt: string;
  }>;
}

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    try {
      const res = await fetch('/api/dashboard');
      if (!res.ok) throw new Error('Failed to fetch');
      const json = await res.json();
      setData(json);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Loading dashboard...</div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="card bg-red-50 border-red-200">
        <p className="text-red-600">Error: {error || 'No data'}</p>
        <button onClick={fetchData} className="btn btn-secondary mt-2">Retry</button>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Page header */}
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Dashboard</h2>
        <p className="text-gray-500 mt-1">Neural network training overview and quick feedback</p>
      </div>

      {/* Model Status Banner */}
      <div className={`card ${data.modelInfo.isLoaded ? 'bg-green-50 border-green-200' : 'bg-yellow-50 border-yellow-200'}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-3xl">{data.modelInfo.isLoaded ? '🧠' : '⚠️'}</span>
            <div>
              <p className="font-medium text-gray-900">
                Model: {data.modelInfo.version}
              </p>
              <p className="text-sm text-gray-600">
                {data.modelInfo.lastTrainedAt
                  ? `Trained ${new Date(data.modelInfo.lastTrainedAt).toLocaleDateString()}`
                  : 'No model trained yet'}
                {data.modelInfo.trainingSamples && ` • ${data.modelInfo.trainingSamples} samples`}
              </p>
            </div>
          </div>
          {data.modelInfo.accuracy !== null && (
            <div className="text-right">
              <p className="text-2xl font-bold text-neural-primary">
                {(data.modelInfo.accuracy * 100).toFixed(1)}%
              </p>
              <p className="text-sm text-gray-500">Accuracy</p>
            </div>
          )}
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard
          label="Total Deals"
          value={data.stats.totalDeals}
          icon="💰"
          subtext={`${data.stats.activeDeals} active`}
        />
        <StatsCard
          label="Pending Review"
          value={data.stats.pendingAnnotation}
          icon="📝"
          subtext={`${data.stats.annotatedCount} annotated`}
          trend={data.stats.pendingAnnotation > 100 ? 'down' : 'neutral'}
        />
        <StatsCard
          label="Avg Confidence"
          value={`${(data.stats.avgConfidence * 100).toFixed(0)}%`}
          icon="🎯"
        />
        <StatsCard
          label="Avg Expected Return"
          value={`${data.stats.avgExpectedReturn.toFixed(1)}%`}
          icon="📈"
          trend={data.stats.avgExpectedReturn > 10 ? 'up' : 'neutral'}
        />
      </div>

      {/* Data Quality */}
      <div className="card">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Data Quality</h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
          <div>
            <p className="text-sm text-gray-500">Cards Tracked</p>
            <p className="text-xl font-bold">{data.dataQuality.totalCards.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-sm text-gray-500">History Records</p>
            <p className="text-xl font-bold">{data.dataQuality.historyRecords.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-sm text-gray-500">Correlations</p>
            <p className="text-xl font-bold">{data.dataQuality.correlationRecords.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-sm text-gray-500">Feature Coverage</p>
            <div className="flex items-center gap-2">
              <div className="flex-1 bg-gray-200 rounded-full h-2">
                <div
                  className="bg-neural-primary rounded-full h-2"
                  style={{ width: `${data.dataQuality.featureCoverage}%` }}
                />
              </div>
              <span className="text-sm font-medium">{data.dataQuality.featureCoverage.toFixed(0)}%</span>
            </div>
          </div>
        </div>
      </div>

      {/* Deal Type Distribution */}
      <div className="card">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Deal Type Distribution</h3>
        <div className="space-y-2">
          {Object.entries(data.dealTypeDistribution)
            .sort((a, b) => b[1] - a[1])
            .map(([type, count]) => {
              const percentage = (count / data.stats.totalDeals) * 100;
              return (
                <div key={type} className="flex items-center gap-3">
                  <span className="text-sm text-gray-600 w-48 truncate">
                    {type.replace(/_/g, ' ')}
                  </span>
                  <div className="flex-1 bg-gray-200 rounded-full h-2">
                    <div
                      className="bg-neural-secondary rounded-full h-2"
                      style={{ width: `${percentage}%` }}
                    />
                  </div>
                  <span className="text-sm font-medium w-16 text-right">
                    {count} ({percentage.toFixed(0)}%)
                  </span>
                </div>
              );
            })}
        </div>
      </div>

      {/* Recent Deals with Quick Feedback */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900">Recent Deals</h3>
          <Link to="/deals" className="text-neural-primary hover:underline text-sm">
            View all →
          </Link>
        </div>
        <div className="space-y-3">
          {data.recentDeals.map((deal) => (
            <div
              key={deal.id}
              className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
            >
              <div className="flex-1 min-w-0">
                <Link
                  to={`/deals/${deal.id}`}
                  className="font-medium text-gray-900 hover:text-neural-primary"
                >
                  {deal.cardName}
                </Link>
                <div className="flex items-center gap-3 mt-1 text-sm text-gray-500">
                  <span>{deal.dealType.replace(/_/g, ' ')}</span>
                  <span>•</span>
                  <span>{(deal.confidence * 100).toFixed(0)}% conf</span>
                  <span>•</span>
                  <span className={deal.expectedReturn >= 0 ? 'text-green-600' : 'text-red-600'}>
                    {deal.expectedReturn >= 0 ? '+' : ''}{deal.expectedReturn.toFixed(1)}%
                  </span>
                </div>
              </div>
              <FeedbackButtons
                dealId={deal.id}
                currentRating={deal.userRating}
                onFeedback={handleFeedback}
                size="sm"
              />
            </div>
          ))}
        </div>
      </div>

      {/* Quick Actions */}
      <div className="flex gap-4">
        <Link to="/training" className="btn btn-primary">
          View Training Results
        </Link>
        <Link to="/deals" className="btn btn-secondary">
          Review All Deals
        </Link>
      </div>
    </div>
  );
}
