import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';

interface DealDetailData {
  deal: {
    id: string;
    cardId: string;
    dealType: string;
    confidence: number;
    expectedReturn: number;
    riskLevel: string;
    timeHorizon: string;
    actionType: string;
    buyMarket: string | null;
    buyPrice: number | null;
    sellMarket: string | null;
    sellPrice: number | null;
    status: string;
    metadata: Record<string, unknown> | null;
    featureImportance: Record<string, number> | null;
    createdAt: string;
    expiresAt: string;
    executedAt: string | null;
    actualReturn: number | null;
    // Annotation fields
    userRating: string | null;
    annotationNotes: string | null;
    annotationTags: string[];
    wasProfitable: boolean | null;
    profitAmount: number | null;
    annotatedAt: string | null;
  };
  card: {
    name: string;
    setCode: string;
    rarity: string | null;
    variantType: string | null;
    currentPrice: number;
    imageUrl: string | null;
  } | null;
  priceHistory: Array<{ date: string; price: number }>;
  relatedDeals: Array<{
    id: string;
    dealType: string;
    confidence: number;
    status: string;
    createdAt: string;
  }>;
  suggestedTags: string[];
}

const dealTypeColors: Record<string, string> = {
  ARBITRAGE_CROSS_MARKET: 'bg-purple-100 text-purple-800',
  ARBITRAGE_CURRENCY: 'bg-purple-100 text-purple-800',
  UNDERVALUED_STATISTICAL: 'bg-blue-100 text-blue-800',
  UNDERVALUED_COMPARATIVE: 'bg-blue-100 text-blue-800',
  MOMENTUM_BREAKOUT: 'bg-orange-100 text-orange-800',
  MOMENTUM_REVERSAL: 'bg-orange-100 text-orange-800',
  SUPPLY_SHOCK: 'bg-red-100 text-red-800',
  DEMAND_SURGE: 'bg-amber-100 text-amber-800',
  CORRELATION_BREAK: 'bg-teal-100 text-teal-800',
  SEASONAL_OPPORTUNITY: 'bg-pink-100 text-pink-800',
};

const riskColors: Record<string, string> = {
  LOW: 'bg-green-100 text-green-800',
  MEDIUM: 'bg-yellow-100 text-yellow-800',
  HIGH: 'bg-red-100 text-red-800',
};

export default function DealDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<DealDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Annotation form state
  const [rating, setRating] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [newTag, setNewTag] = useState('');
  const [wasProfitable, setWasProfitable] = useState<boolean | null>(null);
  const [profitAmount, setProfitAmount] = useState<string>('');

  useEffect(() => {
    fetch(`/api/deals/${id}`)
      .then((res) => {
        if (!res.ok) throw new Error('Deal not found');
        return res.json();
      })
      .then((json: DealDetailData) => {
        setData(json);
        // Initialize form with existing annotation
        setRating(json.deal.userRating);
        setNotes(json.deal.annotationNotes || '');
        setTags(json.deal.annotationTags || []);
        setWasProfitable(json.deal.wasProfitable);
        setProfitAmount(json.deal.profitAmount?.toString() || '');
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [id]);

  const handleQuickFeedback = async (r: 'good' | 'bad') => {
    try {
      await fetch(`/api/deals/${id}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating: r }),
      });
      setRating(r);
    } catch (err) {
      console.error('Feedback error:', err);
    }
  };

  const handleSaveAnnotation = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/deals/${id}/annotate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rating,
          notes: notes || null,
          tags,
          wasProfitable,
          profitAmount: profitAmount ? parseFloat(profitAmount) : null,
        }),
      });
      if (!res.ok) throw new Error('Failed to save');
      // Show success briefly then navigate back
      setTimeout(() => navigate('/deals'), 500);
    } catch (err) {
      console.error('Save error:', err);
      alert('Failed to save annotation');
    } finally {
      setSaving(false);
    }
  };

  const addTag = () => {
    if (newTag && !tags.includes(newTag)) {
      setTags([...tags, newTag]);
      setNewTag('');
    }
  };

  const removeTag = (tag: string) => {
    setTags(tags.filter((t) => t !== tag));
  };

  const formatDealType = (type: string) => {
    return type.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  };

  if (loading) {
    return <div className="text-center py-8 text-gray-500">Loading deal...</div>;
  }

  if (error || !data) {
    return (
      <div className="card bg-red-50 border-red-200">
        <p className="text-red-600">Error: {error || 'Deal not found'}</p>
        <Link to="/deals" className="btn btn-secondary mt-2">
          Back to Deals
        </Link>
      </div>
    );
  }

  const { deal, card, priceHistory, relatedDeals, suggestedTags } = data;

  // Calculate price change from history
  const priceChange =
    priceHistory.length >= 2
      ? ((priceHistory[priceHistory.length - 1].price - priceHistory[0].price) / priceHistory[0].price) * 100
      : null;

  return (
    <div className="space-y-6">
      {/* Back link */}
      <Link to="/deals" className="text-neural-primary hover:underline text-sm">
        &larr; Back to Deals
      </Link>

      {/* Deal Header */}
      <div className="card">
        <div className="flex gap-6">
          {/* Card Image */}
          {card?.imageUrl && (
            <div className="shrink-0">
              <img
                src={`/images/${card.imageUrl}`}
                alt={card.name}
                className="w-32 h-auto rounded-lg shadow-md"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
              />
            </div>
          )}

          {/* Deal Info */}
          <div className="flex-1 min-w-0">
            <h2 className="text-2xl font-bold text-gray-900 mb-2">
              {card?.name || deal.cardId}
            </h2>

            {card && (
              <p className="text-sm text-gray-500 mb-3">
                {card.setCode}
                {card.variantType && ` - ${card.variantType}`}
                {card.rarity && ` - ${card.rarity}`}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-2 mb-4">
              <span className={`badge ${dealTypeColors[deal.dealType] || 'bg-gray-100 text-gray-800'}`}>
                {formatDealType(deal.dealType)}
              </span>
              <span className={`badge ${riskColors[deal.riskLevel] || ''}`}>
                {deal.riskLevel} Risk
              </span>
              <span className={`badge ${deal.status === 'ACTIVE' ? 'badge-success' : 'badge-info'}`}>
                {deal.status}
              </span>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <p className="text-gray-500">Confidence</p>
                <p className="text-xl font-bold">{(deal.confidence * 100).toFixed(0)}%</p>
              </div>
              <div>
                <p className="text-gray-500">Expected Return</p>
                <p className={`text-xl font-bold ${deal.expectedReturn >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {deal.expectedReturn >= 0 ? '+' : ''}{deal.expectedReturn.toFixed(1)}%
                </p>
              </div>
              <div>
                <p className="text-gray-500">Current Price</p>
                <p className="text-xl font-bold">{card ? `£${card.currentPrice.toFixed(2)}` : 'N/A'}</p>
              </div>
              <div>
                <p className="text-gray-500">30d Change</p>
                <p className={`text-xl font-bold ${priceChange !== null ? (priceChange >= 0 ? 'text-green-600' : 'text-red-600') : ''}`}>
                  {priceChange !== null ? `${priceChange >= 0 ? '+' : ''}${priceChange.toFixed(1)}%` : 'N/A'}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Action details */}
        {(deal.buyMarket || deal.sellMarket) && (
          <div className="mt-4 pt-4 border-t border-gray-200">
            <p className="text-sm text-gray-600">
              <span className="font-medium">{deal.actionType}</span>
              {deal.buyMarket && deal.buyPrice && (
                <>
                  : Buy on <span className="font-medium">{deal.buyMarket}</span> at £{deal.buyPrice.toFixed(2)}
                </>
              )}
              {deal.sellMarket && deal.sellPrice && (
                <>
                  , Sell on <span className="font-medium">{deal.sellMarket}</span> at £{deal.sellPrice.toFixed(2)}
                </>
              )}
            </p>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main annotation form */}
        <div className="lg:col-span-2 space-y-6">
          {/* Quick Feedback */}
          <div className="card">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Quick Feedback</h3>
            <div className="flex gap-4">
              <button
                onClick={() => handleQuickFeedback('good')}
                className={`flex-1 py-4 px-6 rounded-lg border-2 transition-all ${
                  rating === 'good'
                    ? 'border-green-500 bg-green-50 text-green-700'
                    : 'border-gray-200 hover:border-green-300 hover:bg-green-50'
                }`}
              >
                <span className="text-3xl block mb-1">👍</span>
                <span className="font-medium">Good Deal</span>
              </button>
              <button
                onClick={() => handleQuickFeedback('bad')}
                className={`flex-1 py-4 px-6 rounded-lg border-2 transition-all ${
                  rating === 'bad'
                    ? 'border-red-500 bg-red-50 text-red-700'
                    : 'border-gray-200 hover:border-red-300 hover:bg-red-50'
                }`}
              >
                <span className="text-3xl block mb-1">👎</span>
                <span className="font-medium">Bad Deal</span>
              </button>
              <button
                onClick={() => setRating('uncertain')}
                className={`flex-1 py-4 px-6 rounded-lg border-2 transition-all ${
                  rating === 'uncertain'
                    ? 'border-gray-500 bg-gray-50 text-gray-700'
                    : 'border-gray-200 hover:border-gray-400 hover:bg-gray-50'
                }`}
              >
                <span className="text-3xl block mb-1">🤔</span>
                <span className="font-medium">Uncertain</span>
              </button>
            </div>
          </div>

          {/* Notes */}
          <div className="card">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Notes</h3>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add notes about why this deal is good/bad, what factors to consider, etc..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-neural-primary focus:border-neural-primary resize-none"
              rows={4}
            />
          </div>

          {/* Tags */}
          <div className="card">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Tags</h3>
            <div className="flex flex-wrap gap-2 mb-3">
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="px-3 py-1 bg-neural-primary/10 text-neural-primary rounded-full text-sm flex items-center gap-1"
                >
                  {tag}
                  <button
                    onClick={() => removeTag(tag)}
                    className="hover:text-red-500 ml-1"
                  >
                    &times;
                  </button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addTag())}
                placeholder="Add a tag..."
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-neural-primary focus:border-neural-primary"
              />
              <button onClick={addTag} className="btn btn-secondary">
                Add
              </button>
            </div>
            {suggestedTags.length > 0 && (
              <div className="mt-3">
                <p className="text-xs text-gray-500 mb-2">Suggested:</p>
                <div className="flex flex-wrap gap-1">
                  {suggestedTags
                    .filter((t) => !tags.includes(t))
                    .map((tag) => (
                      <button
                        key={tag}
                        onClick={() => setTags([...tags, tag])}
                        className="px-2 py-0.5 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded text-xs"
                      >
                        + {tag}
                      </button>
                    ))}
                </div>
              </div>
            )}
          </div>

          {/* Outcome Tracking */}
          <div className="card">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Outcome Tracking</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Was Profitable?</label>
                <div className="flex gap-2">
                  <button
                    onClick={() => setWasProfitable(true)}
                    className={`flex-1 py-2 px-4 rounded-lg border-2 text-sm font-medium transition-all ${
                      wasProfitable === true
                        ? 'border-green-500 bg-green-50 text-green-700'
                        : 'border-gray-200 hover:border-green-300'
                    }`}
                  >
                    Yes
                  </button>
                  <button
                    onClick={() => setWasProfitable(false)}
                    className={`flex-1 py-2 px-4 rounded-lg border-2 text-sm font-medium transition-all ${
                      wasProfitable === false
                        ? 'border-red-500 bg-red-50 text-red-700'
                        : 'border-gray-200 hover:border-red-300'
                    }`}
                  >
                    No
                  </button>
                  <button
                    onClick={() => setWasProfitable(null)}
                    className={`flex-1 py-2 px-4 rounded-lg border-2 text-sm font-medium transition-all ${
                      wasProfitable === null
                        ? 'border-gray-400 bg-gray-50'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    N/A
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Profit/Loss Amount (£)</label>
                <input
                  type="number"
                  step="0.01"
                  value={profitAmount}
                  onChange={(e) => setProfitAmount(e.target.value)}
                  placeholder="e.g., 5.50 or -2.00"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-neural-primary focus:border-neural-primary"
                />
              </div>
            </div>
          </div>

          {/* Save Button */}
          <div className="flex gap-3">
            <button
              onClick={handleSaveAnnotation}
              disabled={saving}
              className="btn btn-primary flex-1"
            >
              {saving ? 'Saving...' : 'Save Annotation'}
            </button>
            <Link to="/deals" className="btn btn-secondary">
              Cancel
            </Link>
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Price History Sparkline */}
          {priceHistory.length > 0 && (
            <div className="card">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">30-Day Price History</h3>
              <div className="h-24 flex items-end gap-0.5">
                {(() => {
                  const prices = priceHistory.map((p) => p.price);
                  const min = Math.min(...prices);
                  const max = Math.max(...prices);
                  const range = max - min || 1;
                  return priceHistory.map((p, i) => (
                    <div
                      key={i}
                      className="flex-1 bg-neural-primary/60 hover:bg-neural-primary rounded-t transition-colors"
                      style={{ height: `${((p.price - min) / range) * 80 + 20}%` }}
                      title={`${new Date(p.date).toLocaleDateString()}: £${p.price.toFixed(2)}`}
                    />
                  ));
                })()}
              </div>
              <div className="flex justify-between text-xs text-gray-500 mt-2">
                <span>{new Date(priceHistory[0].date).toLocaleDateString()}</span>
                <span>{new Date(priceHistory[priceHistory.length - 1].date).toLocaleDateString()}</span>
              </div>
            </div>
          )}

          {/* Feature Importance */}
          {deal.featureImportance && Object.keys(deal.featureImportance).length > 0 && (
            <div className="card">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Top Features</h3>
              <div className="space-y-2">
                {Object.entries(deal.featureImportance)
                  .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
                  .slice(0, 8)
                  .map(([feature, importance]) => (
                    <div key={feature} className="flex items-center gap-2 text-sm">
                      <span className="text-gray-600 w-32 truncate" title={feature}>
                        {feature.replace(/_/g, ' ')}
                      </span>
                      <div className="flex-1 bg-gray-200 rounded-full h-1.5">
                        <div
                          className={`rounded-full h-1.5 ${importance >= 0 ? 'bg-green-500' : 'bg-red-500'}`}
                          style={{ width: `${Math.abs(importance) * 100}%` }}
                        />
                      </div>
                      <span className={`text-xs w-10 text-right ${importance >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {(importance * 100).toFixed(0)}%
                      </span>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {/* Related Deals */}
          {relatedDeals.length > 0 && (
            <div className="card">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Related Deals</h3>
              <div className="space-y-2">
                {relatedDeals.map((rd) => (
                  <Link
                    key={rd.id}
                    to={`/deals/${rd.id}`}
                    className="block p-2 hover:bg-gray-50 rounded-lg transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-600">{formatDealType(rd.dealType)}</span>
                      <span className={`text-xs badge ${rd.status === 'ACTIVE' ? 'badge-success' : 'badge-info'}`}>
                        {rd.status}
                      </span>
                    </div>
                    <div className="text-xs text-gray-400 mt-1">
                      {(rd.confidence * 100).toFixed(0)}% conf • {new Date(rd.createdAt).toLocaleDateString()}
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Deal Metadata */}
          <div className="card">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Deal Info</h3>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-gray-500">Created</dt>
                <dd>{new Date(deal.createdAt).toLocaleString()}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500">Expires</dt>
                <dd>{new Date(deal.expiresAt).toLocaleString()}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500">Time Horizon</dt>
                <dd>{deal.timeHorizon}</dd>
              </div>
              {deal.executedAt && (
                <div className="flex justify-between">
                  <dt className="text-gray-500">Executed</dt>
                  <dd>{new Date(deal.executedAt).toLocaleString()}</dd>
                </div>
              )}
              {deal.actualReturn !== null && (
                <div className="flex justify-between">
                  <dt className="text-gray-500">Actual Return</dt>
                  <dd className={deal.actualReturn >= 0 ? 'text-green-600' : 'text-red-600'}>
                    {deal.actualReturn >= 0 ? '+' : ''}{deal.actualReturn.toFixed(1)}%
                  </dd>
                </div>
              )}
              {deal.annotatedAt && (
                <div className="flex justify-between">
                  <dt className="text-gray-500">Last Annotated</dt>
                  <dd>{new Date(deal.annotatedAt).toLocaleString()}</dd>
                </div>
              )}
            </dl>
          </div>
        </div>
      </div>
    </div>
  );
}
