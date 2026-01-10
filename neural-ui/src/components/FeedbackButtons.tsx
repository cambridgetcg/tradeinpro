import { useState } from 'react';

interface FeedbackButtonsProps {
  dealId: string;
  currentRating: string | null;
  onFeedback: (dealId: string, rating: 'good' | 'bad') => Promise<void>;
  size?: 'sm' | 'md' | 'lg';
}

export function FeedbackButtons({ dealId, currentRating, onFeedback, size = 'md' }: FeedbackButtonsProps) {
  const [loading, setLoading] = useState(false);

  const handleClick = async (rating: 'good' | 'bad') => {
    if (loading) return;
    setLoading(true);
    try {
      await onFeedback(dealId, rating);
    } finally {
      setLoading(false);
    }
  };

  const sizeClasses = {
    sm: 'text-lg p-1.5',
    md: 'text-xl p-2',
    lg: 'text-2xl p-3',
  };

  return (
    <div className="flex gap-2">
      <button
        onClick={() => handleClick('good')}
        disabled={loading}
        className={`feedback-btn good ${currentRating === 'good' ? 'active' : ''} ${sizeClasses[size]} ${loading ? 'opacity-50' : ''}`}
        title="Good deal"
      >
        👍
      </button>
      <button
        onClick={() => handleClick('bad')}
        disabled={loading}
        className={`feedback-btn bad ${currentRating === 'bad' ? 'active' : ''} ${sizeClasses[size]} ${loading ? 'opacity-50' : ''}`}
        title="Bad deal"
      >
        👎
      </button>
    </div>
  );
}
