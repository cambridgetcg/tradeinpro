interface StatsCardProps {
  label: string;
  value: string | number;
  subtext?: string;
  trend?: 'up' | 'down' | 'neutral';
  icon?: string;
}

export function StatsCard({ label, value, subtext, trend, icon }: StatsCardProps) {
  return (
    <div className="stat-card">
      <div className="flex items-center justify-between">
        <span className="stat-label">{label}</span>
        {icon && <span className="text-2xl">{icon}</span>}
      </div>
      <div className="stat-value">{value}</div>
      {subtext && (
        <div className={`stat-change ${
          trend === 'up' ? 'text-green-600' :
          trend === 'down' ? 'text-red-600' :
          'text-gray-500'
        }`}>
          {trend === 'up' && '↑ '}
          {trend === 'down' && '↓ '}
          {subtext}
        </div>
      )}
    </div>
  );
}
