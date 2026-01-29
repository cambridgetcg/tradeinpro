# Waypoint: D5 - Admin Pipeline Dashboard

**Created**: 2026-01-29
**Type**: Feature (Admin UI)
**Required By**: W3 (Beta Launch)
**Status**: completed
**Completed**: 2026-01-29
**Depends On**: D1, D4

---

## What This Waypoint Achieves

Exposes pipeline health status in the admin UI, giving staff visibility into data freshness without needing AWS console access.

---

## Success Criteria

1. [x] Pipeline status card on admin dashboard
2. [x] Shows status for each data source (healthy/degraded/unhealthy)
3. [x] Shows last update time for each source
4. [x] Visual indicators (green/yellow/red)
5. [x] Link to detailed health endpoint (Refresh button)
6. [x] Auto-refresh every 5 minutes

---

## Design

### Dashboard Card

```
┌─────────────────────────────────────────────────────┐
│  Data Pipeline Health              [View Details →] │
├─────────────────────────────────────────────────────┤
│                                                     │
│  ● S3 Daily Prices      Healthy    2h ago          │
│  ● S3 Pricefeed         Healthy    45m ago         │
│  ● DB Price History     Healthy    3h ago          │
│  ● DB Card Prices       Healthy    2h ago          │
│                                                     │
│  Overall: ✓ All systems operational                │
│                                                     │
│  Last checked: 2 minutes ago    [Refresh]          │
└─────────────────────────────────────────────────────┘
```

### Status Colors

| Status | Color | Meaning |
|--------|-------|---------|
| Healthy | Green (#2E7D32) | Data updated within threshold |
| Degraded | Yellow (#F9A825) | Data older than threshold but not critical |
| Unhealthy | Red (#C62828) | Data critically stale or unavailable |

---

## Implementation Plan

### Step 1: Create Pipeline Status Component

**File**: `app/components/PipelineStatus.tsx`

```typescript
interface PipelineStatusProps {
  status: {
    overall: 'healthy' | 'degraded' | 'unhealthy';
    checks: {
      s3DailyPrices: CheckResult;
      s3Pricefeed: CheckResult;
      dbPriceHistory: CheckResult;
      dbCardPrices: CheckResult;
    };
    timestamp: string;
  };
}

export function PipelineStatus({ status }: PipelineStatusProps) {
  // Polaris Card with status indicators
}
```

### Step 2: Add to Dashboard Route

**File**: `app/routes/app._index.tsx`

Add loader to fetch from `/api/health/pipeline`:
```typescript
const pipelineHealth = await fetch('/api/health/pipeline').then(r => r.json());
```

Render `PipelineStatus` component in dashboard.

### Step 3: Add Auto-Refresh

Use `useRevalidator` with interval:
```typescript
useEffect(() => {
  const interval = setInterval(() => revalidator.revalidate(), 5 * 60 * 1000);
  return () => clearInterval(interval);
}, []);
```

### Step 4: Add Detailed View

Create `/app/pipeline` route with:
- Full health check details
- Historical status (if tracked)
- Links to CloudWatch dashboard
- Manual refresh button

---

## API Endpoint

Already exists: `app/routes/api.health.pipeline.tsx`

Returns:
```json
{
  "status": "healthy",
  "timestamp": "2026-01-29T18:30:00Z",
  "checks": {
    "s3DailyPrices": {
      "status": "healthy",
      "lastUpdated": "2026-01-29T12:03:02Z",
      "ageHours": 6.5,
      "threshold": 24,
      "message": "File updated 6.5 hours ago"
    }
  },
  "summary": {
    "healthyCount": 4,
    "degradedCount": 0,
    "unhealthyCount": 0
  }
}
```

---

## Polaris Components to Use

- `Card` - Container for status widget
- `VerticalStack` - Layout for status rows
- `HorizontalStack` - Row layout (indicator + name + status + time)
- `Badge` - Status indicator (success/warning/critical)
- `Text` - Labels and times
- `Button` - Refresh and view details
- `Link` - Navigate to detailed view

---

## Notes

This gives staff immediate visibility into data health without needing:
- AWS console access
- Technical knowledge of CloudWatch
- Manual checking of file timestamps

The card should be prominent on the dashboard, especially when status is degraded/unhealthy.
