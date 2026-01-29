# Waypoint: D4 - S3 Freshness Alerting

**Created**: 2026-01-29
**Type**: Infrastructure (Data)
**Required By**: W7 (Production Launch)
**Status**: completed
**Completed**: 2026-01-29
**Depends On**: D1, D2

---

## What This Waypoint Achieves

Proactive alerting when S3 price data files become stale, preventing silent data staleness that would affect trade-in pricing accuracy.

---

## Success Criteria

1. [x] CloudWatch alarm triggers if `daily_prices.xlsx` not modified in 26 hours
2. [x] CloudWatch alarm triggers if `pricefeed/*.xlsx` not modified in 26 hours
3. [x] SNS notification sent when alarm triggers (via cardforum-dev-security-alerts)
4. [x] Health endpoint includes S3 freshness check (api.health.pipeline.tsx)
5. [x] Lambda `cardforum-s3-freshness-checker` deployed (runs every 4h)
6. [x] EventBridge schedule `cardforum-s3-freshness-check` created

---

## Implementation Plan

### Step 1: Create S3 Freshness Lambda

Create a Lambda that checks S3 file modification times and publishes custom CloudWatch metrics.

**Lambda**: `cardforum-s3-freshness-checker`
**Schedule**: Every 4 hours (cron(0 */4 * * ? *))
**Logic**:
```
For each monitored file:
  1. HeadObject to get LastModified
  2. Calculate age in hours
  3. PutMetricData to CloudWatch:
     - Namespace: CardForum/DataPipeline
     - MetricName: S3FileAgeHours
     - Dimensions: FileName={key}
```

### Step 2: Create CloudWatch Alarms

**Alarm 1**: `cardforum-daily-prices-stale`
- Metric: S3FileAgeHours (FileName=daily_prices.xlsx)
- Threshold: > 26 hours (allows for schedule variance)
- Period: 1 hour
- Evaluation: 1 datapoint
- Action: SNS `cardforum-dev-security-alerts`

**Alarm 2**: `cardforum-pricefeed-stale`
- Metric: S3FileAgeHours (FileName=pricefeed/onepiece_pricefeed.xlsx)
- Threshold: > 26 hours
- Same configuration as above

### Step 3: Update Health Endpoint

Add S3 freshness to `/api/health/pipeline`:
```typescript
// Already partially implemented in api.health.pipeline.tsx
// Verify checks are working correctly
```

### Step 4: Create Runbook

Document response procedure:
1. Check Lambda CloudWatch logs for errors
2. Check EventBridge rule is enabled
3. Manually trigger Lambda if needed
4. Escalate if Lambda is failing

---

## Verification Commands

```bash
# Check alarm exists
aws cloudwatch describe-alarms --alarm-names cardforum-daily-prices-stale --region us-east-1

# Check custom metric
aws cloudwatch get-metric-statistics \
  --namespace CardForum/DataPipeline \
  --metric-name S3FileAgeHours \
  --dimensions Name=FileName,Value=daily_prices.xlsx \
  --start-time $(date -u -d '24 hours ago' +%Y-%m-%dT%H:%M:%SZ) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%SZ) \
  --period 3600 \
  --statistics Maximum \
  --region us-east-1

# Test health endpoint
curl https://cardforum.vercel.app/api/health/pipeline | jq
```

---

## Alternative: Use S3 Event-Based Approach

Instead of polling, could use S3 event notifications:
- Configure S3 to publish to SNS on PutObject
- CloudWatch alarm if no events in 26 hours

**Pros**: No Lambda needed, simpler
**Cons**: S3 metrics can be delayed, less granular

**Decision**: Use Lambda polling for reliability and control.

---

## Notes

The Lambda collectors run at 8 AM, 8 PM, 12:32 PM UTC. A 26-hour threshold allows:
- Normal 12-hour gap between runs
- 2-hour buffer for execution time variance
- Alert triggers if a full cycle is missed
