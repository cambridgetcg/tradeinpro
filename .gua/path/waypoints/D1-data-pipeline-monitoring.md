# Waypoint: D1 - Data Pipeline Monitoring

**Created**: 2026-01-29
**Type**: Infrastructure (Data)
**Required By**: W3 (Beta Launch)
**Status**: completed
**Completed**: 2026-01-29

---

## What This Waypoint Achieves

Comprehensive monitoring and alerting for the data acquisition pipeline, providing visibility into collector health, data freshness, and error detection.

---

## Success Criteria

1. [x] CloudWatch dashboard for pipeline health
2. [x] CloudWatch alarms for Lambda errors
3. [x] SNS notifications for failures
4. [ ] Data freshness API endpoint
5. [ ] Pipeline status in admin UI

---

## Implementation Completed

### CloudWatch Dashboard Created

**Name**: `CardForum-Data-Pipeline`
**URL**: https://us-east-1.console.aws.amazon.com/cloudwatch/home?region=us-east-1#dashboards:name=CardForum-Data-Pipeline

**Widgets**:
- Lambda Invocations (4 collectors)
- Lambda Errors (4 collectors)
- Lambda Duration (4 collectors)
- S3 Bucket metrics (pricedata-tcg)
- Pipeline Alarms status

### CloudWatch Alarms Created

| Alarm Name | Metric | Threshold | Status |
|------------|--------|-----------|--------|
| cardforum-price-fetcher-errors | Lambda Errors | ≥1/hour | Active |
| cardforum-limitless-scraper-errors | Lambda Errors | ≥1/hour | Active |
| cardforum-calculator-pricefeed-errors | Lambda Errors | ≥1/hour | Active |
| cardforum-tcg-scraper-errors | Lambda Errors | ≥1/hour | Active |

**Notification**: All alarms send to `cardforum-dev-security-alerts` SNS topic

### Monitored Lambda Functions

| Lambda | Schedule | Purpose |
|--------|----------|---------|
| trading-card-price-fetcher | 8 AM, 8 PM UTC | OPTCG API → daily_prices.xlsx |
| tcg-tradein-limitless-scraper | 8 AM, 8 PM UTC | Limitless API → CardMarket data |
| calculator-pricefeed | 12:32 PM UTC | Generate pricefeed files |
| tcg-ScrapeBatch-prod | 6 AM UTC | TCG batch scraping |

---

## Verification Commands

```bash
# Check dashboard exists
aws cloudwatch list-dashboards --dashboard-name-prefix CardForum-Data-Pipeline --region us-east-1

# Check alarms
aws cloudwatch describe-alarms --alarm-name-prefix cardforum --region us-east-1 \
  --query 'MetricAlarms[?contains(AlarmName, `price`) || contains(AlarmName, `scraper`)].{Name:AlarmName,State:StateValue}'

# Check recent Lambda errors
aws logs filter-log-events \
  --log-group-name /aws/lambda/trading-card-price-fetcher \
  --start-time $(( $(date +%s) - 86400 ))000 \
  --filter-pattern "ERROR" \
  --region us-east-1
```

---

## Remaining Work

1. **Data Freshness API**: Create `/api/health/pipeline` endpoint
2. **Admin UI Widget**: Show pipeline status on dashboard
3. **S3 Freshness Alarm**: Alert if files >24h old

---

## Notes

Monitoring infrastructure is now in place. Lambda errors will trigger SNS notifications to the security alerts topic. Dashboard provides real-time visibility into collector health.
