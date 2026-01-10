import { Link } from 'react-router-dom';
import { FeedbackButtons } from './FeedbackButtons';

interface Deal {
  id: string;
  cardId: string;
  cardName: string;
  setCode?: string;
  dealType: string;
  confidence: number;
  expectedReturn: number;
  riskLevel: string;
  status: string;
  userRating: string | null;
  createdAt: string;
}

interface DealCardProps {
  deal: Deal;
  onFeedback: (dealId: string, rating: 'good' | 'bad') => Promise<void>;
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
  LOW: 'text-green-600',
  MEDIUM: 'text-yellow-600',
  HIGH: 'text-red-600',
};

export function DealCard({ deal, onFeedback }: DealCardProps) {
  const formatDealType = (type: string) => {
    return type.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
  };

  return (
    <div className="card hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <Link
              to={`/deals/${deal.id}`}
              className="font-medium text-gray-900 hover:text-neural-primary truncate"
            >
              {deal.cardName}
            </Link>
            {deal.setCode && (
              <span className="text-xs text-gray-500 shrink-0">{deal.setCode}</span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 mb-3">
            <span className={`badge ${dealTypeColors[deal.dealType] || 'bg-gray-100 text-gray-800'}`}>
              {formatDealType(deal.dealType)}
            </span>
            <span className={`text-sm font-medium ${riskColors[deal.riskLevel] || ''}`}>
              {deal.riskLevel} Risk
            </span>
            <span className={`badge ${deal.status === 'ACTIVE' ? 'badge-success' : 'badge-info'}`}>
              {deal.status}
            </span>
          </div>

          <div className="flex items-center gap-6 text-sm">
            <div>
              <span className="text-gray-500">Confidence:</span>{' '}
              <span className="font-medium">{(deal.confidence * 100).toFixed(0)}%</span>
            </div>
            <div>
              <span className="text-gray-500">Expected:</span>{' '}
              <span className={`font-medium ${deal.expectedReturn >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {deal.expectedReturn >= 0 ? '+' : ''}{deal.expectedReturn.toFixed(1)}%
              </span>
            </div>
            <div className="text-gray-400 text-xs">
              {new Date(deal.createdAt).toLocaleDateString()}
            </div>
          </div>
        </div>

        <div className="flex flex-col items-end gap-2">
          <FeedbackButtons
            dealId={deal.id}
            currentRating={deal.userRating}
            onFeedback={onFeedback}
            size="sm"
          />
          <Link
            to={`/deals/${deal.id}`}
            className="text-xs text-neural-primary hover:underline"
          >
            Annotate →
          </Link>
        </div>
      </div>
    </div>
  );
}
