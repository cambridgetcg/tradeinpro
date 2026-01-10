import { useEffect, useState } from 'react';
import { StatsCard } from '../components/StatsCard';

interface TrainingData {
  modelHistory: Array<{
    version: string;
    trainedAt: string;
    trainingSamples: number;
    validationSamples: number;
    metrics: {
      dealTypeAccuracy: number | null;
      confidenceBrierScore: number | null;
      returnMae: number | null;
      riskF1Score: number | null;
    };
  }>;
  currentModel: {
    version: string;
    trainingSamples: number;
    validationSamples: number;
    metrics: {
      dealTypeAccuracy: number | null;
      confidenceBrierScore: number | null;
      returnMae: number | null;
      riskF1Score: number | null;
    };
  } | null;
  dealTypeBreakdown: Array<{
    dealType: string;
    totalDeals: number;
    avgConfidence: number;
    avgExpectedReturn: number;
    avgActualReturn: number | null;
  }>;
  featureImportance: Array<{
    feature: string;
    importance: number;
    category: string;
  }>;
  trainingDataStats: {
    totalExamples: number;
    positiveExamples: number;
    negativeExamples: number;
    dateRange: { start: string; end: string };
  };
  annotationStats: {
    good: number;
    bad: number;
    uncertain: number;
  };
}

const categoryColors: Record<string, string> = {
  temporal: 'bg-blue-500',
  price: 'bg-green-500',
  market: 'bg-purple-500',
  fx: 'bg-orange-500',
  derived: 'bg-pink-500',
};

export default function Training() {
  const [data, setData] = useState<TrainingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    fetch('/api/training')
      .then((res) => res.json())
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const handleExport = async () => {
    setExporting(true);
    try {
      const res = await fetch('/api/training/export', { method: 'POST' });
      const exportData = await res.json();

      // Download as JSON
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `training-feedback-${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Export error:', err);
    } finally {
      setExporting(false);
    }
  };

  if (loading) {
    return <div className="text-center py-8 text-gray-500">Loading training data...</div>;
  }

  if (error || !data) {
    return <div className="card bg-red-50 text-red-600">Error: {error || 'No data'}</div>;
  }

  const metrics = data.currentModel?.metrics;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Training Results</h2>
          <p className="text-gray-500 mt-1">Model performance metrics and data quality</p>
        </div>
        <button
          onClick={handleExport}
          disabled={exporting}
          className="btn btn-primary"
        >
          {exporting ? 'Exporting...' : 'Export Training Data'}
        </button>
      </div>

      {/* Current Model Info */}
      {data.currentModel && (
        <div className="card bg-gradient-to-r from-neural-primary/10 to-neural-secondary/10">
          <div className="flex items-center gap-3 mb-4">
            <span className="text-3xl">🧠</span>
            <div>
              <h3 className="font-semibold text-gray-900">{data.currentModel.version}</h3>
              <p className="text-sm text-gray-600">
                {data.currentModel.trainingSamples} training samples •{' '}
                {data.currentModel.validationSamples} validation samples
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Metrics Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard
          label="Deal Type Accuracy"
          value={metrics?.dealTypeAccuracy ? `${(metrics.dealTypeAccuracy * 100).toFixed(1)}%` : 'N/A'}
          icon="🎯"
        />
        <StatsCard
          label="Confidence Brier Score"
          value={metrics?.confidenceBrierScore?.toFixed(4) || 'N/A'}
          icon="📊"
          subtext="Lower is better"
        />
        <StatsCard
          label="Return MAE"
          value={metrics?.returnMae?.toFixed(4) || 'N/A'}
          icon="📈"
          subtext="Mean Absolute Error"
        />
        <StatsCard
          label="Risk F1 Score"
          value={metrics?.riskF1Score?.toFixed(3) || 'N/A'}
          icon="⚠️"
        />
      </div>

      {/* Annotation Stats */}
      <div className="card">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Annotation Progress</h3>
        <div className="grid grid-cols-3 gap-6">
          <div className="text-center">
            <div className="text-3xl font-bold text-green-600">{data.annotationStats.good}</div>
            <div className="text-sm text-gray-500">👍 Good</div>
          </div>
          <div className="text-center">
            <div className="text-3xl font-bold text-red-600">{data.annotationStats.bad}</div>
            <div className="text-sm text-gray-500">👎 Bad</div>
          </div>
          <div className="text-center">
            <div className="text-3xl font-bold text-gray-600">{data.annotationStats.uncertain}</div>
            <div className="text-sm text-gray-500">🤔 Uncertain</div>
          </div>
        </div>
        <div className="mt-4 bg-gray-200 rounded-full h-3 overflow-hidden flex">
          <div
            className="bg-green-500 h-full"
            style={{ width: `${(data.annotationStats.good / (data.annotationStats.good + data.annotationStats.bad + data.annotationStats.uncertain || 1)) * 100}%` }}
          />
          <div
            className="bg-red-500 h-full"
            style={{ width: `${(data.annotationStats.bad / (data.annotationStats.good + data.annotationStats.bad + data.annotationStats.uncertain || 1)) * 100}%` }}
          />
          <div
            className="bg-gray-400 h-full"
            style={{ width: `${(data.annotationStats.uncertain / (data.annotationStats.good + data.annotationStats.bad + data.annotationStats.uncertain || 1)) * 100}%` }}
          />
        </div>
      </div>

      {/* Deal Type Breakdown */}
      <div className="card">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Deal Type Performance</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-2 px-3 font-medium text-gray-600">Deal Type</th>
                <th className="text-right py-2 px-3 font-medium text-gray-600">Count</th>
                <th className="text-right py-2 px-3 font-medium text-gray-600">Avg Confidence</th>
                <th className="text-right py-2 px-3 font-medium text-gray-600">Avg Expected</th>
                <th className="text-right py-2 px-3 font-medium text-gray-600">Avg Actual</th>
              </tr>
            </thead>
            <tbody>
              {data.dealTypeBreakdown
                .sort((a, b) => b.totalDeals - a.totalDeals)
                .map((row) => (
                  <tr key={row.dealType} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-2 px-3 font-medium">
                      {row.dealType.replace(/_/g, ' ')}
                    </td>
                    <td className="text-right py-2 px-3">{row.totalDeals}</td>
                    <td className="text-right py-2 px-3">
                      {(row.avgConfidence * 100).toFixed(0)}%
                    </td>
                    <td className={`text-right py-2 px-3 ${row.avgExpectedReturn >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {row.avgExpectedReturn >= 0 ? '+' : ''}{row.avgExpectedReturn.toFixed(1)}%
                    </td>
                    <td className="text-right py-2 px-3 text-gray-500">
                      {row.avgActualReturn !== null
                        ? `${row.avgActualReturn >= 0 ? '+' : ''}${row.avgActualReturn.toFixed(1)}%`
                        : '—'}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Feature Importance */}
      <div className="card">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Feature Importance</h3>
        <div className="space-y-2">
          {data.featureImportance.slice(0, 15).map((feat) => (
            <div key={feat.feature} className="flex items-center gap-3">
              <span className={`w-3 h-3 rounded-full ${categoryColors[feat.category] || 'bg-gray-400'}`} />
              <span className="text-sm text-gray-600 w-48 truncate" title={feat.feature}>
                {feat.feature.replace(/_/g, ' ')}
              </span>
              <div className="flex-1 bg-gray-200 rounded-full h-2">
                <div
                  className={`rounded-full h-2 ${categoryColors[feat.category] || 'bg-gray-400'}`}
                  style={{ width: `${feat.importance * 100 * 5}%` }}
                />
              </div>
              <span className="text-sm font-medium w-12 text-right">
                {(feat.importance * 100).toFixed(1)}%
              </span>
            </div>
          ))}
        </div>
        <div className="flex gap-4 mt-4 text-xs">
          {Object.entries(categoryColors).map(([cat, color]) => (
            <div key={cat} className="flex items-center gap-1">
              <span className={`w-2 h-2 rounded-full ${color}`} />
              <span className="text-gray-500 capitalize">{cat}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Training Data Stats */}
      <div className="card">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Training Data Statistics</h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
          <div>
            <p className="text-sm text-gray-500">Total Examples</p>
            <p className="text-xl font-bold">{data.trainingDataStats.totalExamples}</p>
          </div>
          <div>
            <p className="text-sm text-gray-500">Positive (Executed)</p>
            <p className="text-xl font-bold text-green-600">{data.trainingDataStats.positiveExamples}</p>
          </div>
          <div>
            <p className="text-sm text-gray-500">Negative (Expired)</p>
            <p className="text-xl font-bold text-gray-600">{data.trainingDataStats.negativeExamples}</p>
          </div>
          <div>
            <p className="text-sm text-gray-500">Date Range</p>
            <p className="text-sm font-medium">
              {data.trainingDataStats.dateRange.start
                ? new Date(data.trainingDataStats.dateRange.start).toLocaleDateString()
                : '—'}{' '}
              to{' '}
              {data.trainingDataStats.dateRange.end
                ? new Date(data.trainingDataStats.dateRange.end).toLocaleDateString()
                : '—'}
            </p>
          </div>
        </div>
      </div>

      {/* Model History */}
      {data.modelHistory.length > 1 && (
        <div className="card">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Model History</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 px-3 font-medium text-gray-600">Version</th>
                  <th className="text-left py-2 px-3 font-medium text-gray-600">Trained</th>
                  <th className="text-right py-2 px-3 font-medium text-gray-600">Samples</th>
                  <th className="text-right py-2 px-3 font-medium text-gray-600">Accuracy</th>
                </tr>
              </thead>
              <tbody>
                {data.modelHistory.map((model) => (
                  <tr key={model.version} className="border-b border-gray-100">
                    <td className="py-2 px-3 font-medium">{model.version}</td>
                    <td className="py-2 px-3 text-gray-500">
                      {new Date(model.trainedAt).toLocaleDateString()}
                    </td>
                    <td className="text-right py-2 px-3">{model.trainingSamples}</td>
                    <td className="text-right py-2 px-3">
                      {model.metrics.dealTypeAccuracy
                        ? `${(model.metrics.dealTypeAccuracy * 100).toFixed(1)}%`
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
