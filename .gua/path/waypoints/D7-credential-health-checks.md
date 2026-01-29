# Waypoint: D7 - Credential Health Checks

**Created**: 2026-01-29
**Type**: Infrastructure (Data)
**Required By**: W7 (Production Launch)
**Status**: completed
**Completed**: 2026-01-29
**Depends On**: D1, I1

---

## What This Waypoint Achieves

Proactive validation of external API credentials before they cause silent data collection failures.

---

## Success Criteria

1. [x] Health endpoint validates TCGplayer API connectivity
2. [x] Health endpoint validates Bright Data connectivity
3. [ ] CloudWatch alarm for credential validation failures (future)
4. [ ] Credential expiry tracking (where applicable) (future)
5. [ ] Automated rotation for secrets with expiry (future)

---

## Problem Being Solved

**Current State**: Silent authentication failures
```
Lambda runs → Fetches secret → API returns 401 → Logs error → Continues
                                                          ↓
                                               No alert, data goes stale
```

**Target State**: Proactive credential validation
```
Health check → Validates credentials → Fails → Alert triggered
                                             ↓
                              Team notified BEFORE data goes stale
```

---

## Implementation Plan

### Step 1: Add Credential Validation to Health Endpoint

**File**: `app/routes/api.health.pipeline.tsx`

Add new checks:
```typescript
interface HealthStatus {
  // ... existing
  checks: {
    // ... existing
    tcgplayerApi: CheckResult;
    brightDataApi: CheckResult;
  };
}

async function checkTcgplayerCredentials(): Promise<CheckResult> {
  try {
    // Fetch API key from Secrets Manager
    const apiKey = await getSecret('trading-card-pricer/api-keys', 'TCGPLAYER_API_KEY');

    // Make lightweight validation request
    const response = await fetch('https://api.tcgplayer.com/catalog/categories', {
      headers: { 'Authorization': `Bearer ${apiKey}` }
    });

    if (response.status === 401 || response.status === 403) {
      return {
        status: 'unhealthy',
        lastUpdated: null,
        ageHours: null,
        threshold: 0,
        message: 'TCGplayer API authentication failed'
      };
    }

    return {
      status: 'healthy',
      lastUpdated: new Date().toISOString(),
      ageHours: 0,
      threshold: 0,
      message: 'TCGplayer API credentials valid'
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      lastUpdated: null,
      ageHours: null,
      threshold: 0,
      message: `TCGplayer check failed: ${error.message}`
    };
  }
}

async function checkBrightDataCredentials(): Promise<CheckResult> {
  try {
    const apiKey = await getSecret('brightdata/web-unlocker', 'BRIGHT_DATA_API_KEY');

    // Bright Data health check endpoint
    const response = await fetch('https://api.brightdata.com/zone/status', {
      headers: { 'Authorization': `Bearer ${apiKey}` }
    });

    if (response.status === 401 || response.status === 403) {
      return {
        status: 'unhealthy',
        lastUpdated: null,
        ageHours: null,
        threshold: 0,
        message: 'Bright Data authentication failed'
      };
    }

    return {
      status: 'healthy',
      lastUpdated: new Date().toISOString(),
      ageHours: 0,
      threshold: 0,
      message: 'Bright Data credentials valid'
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      lastUpdated: null,
      ageHours: null,
      threshold: 0,
      message: `Bright Data check failed: ${error.message}`
    };
  }
}
```

### Step 2: Create Dedicated Credential Check Lambda

For deeper validation, create a Lambda that runs daily:

**Lambda**: `cardforum-credential-validator`
**Schedule**: Daily at 7 AM UTC (before collectors run)

**Logic**:
1. Fetch each API credential from Secrets Manager
2. Make authentication request to each API
3. Log results to CloudWatch
4. Publish custom metric: CredentialValid (1/0)
5. If any fail, publish to SNS

### Step 3: Add CloudWatch Alarms

**Alarm**: `cardforum-credential-validation-failed`
- Metric: CredentialValid
- Threshold: < 1
- Action: SNS notification

### Step 4: Credential Rotation (Future)

For secrets with expiry (like OAuth tokens):
1. Track expiry date in secret metadata
2. Lambda checks expiry 7 days before
3. Automated rotation via Secrets Manager rotation Lambda

---

## API Credentials Inventory

| Service | Secret Name | Has Expiry? | Rotation |
|---------|-------------|-------------|----------|
| TCGplayer | trading-card-pricer/api-keys | No (API key) | Manual |
| Bright Data | brightdata/web-unlocker | No (subscription) | Manual |
| Database | postgres-credentials | No | Manual |
| Royal Mail | royal-mail-api-key | Unknown | Manual |

---

## Caching Considerations

Credential validation makes external API calls. To avoid:
- Hitting rate limits
- Adding latency to health checks
- Unnecessary API calls

**Strategy**:
- Cache validation result for 1 hour
- Full health check: use cached results
- Deep health check (`?deep=true`): force revalidation
- Dedicated Lambda runs full check daily

---

## Verification Commands

```bash
# Test health endpoint with credential checks
curl 'https://cardforum.vercel.app/api/health/pipeline?deep=true' | jq '.checks | {tcgplayerApi, brightDataApi}'

# Check credential validation alarm
aws cloudwatch describe-alarms \
  --alarm-names cardforum-credential-validation-failed \
  --region us-east-1

# Check credential validation metrics
aws cloudwatch get-metric-statistics \
  --namespace CardForum/DataPipeline \
  --metric-name CredentialValid \
  --start-time $(date -u -d '7 days ago' +%Y-%m-%dT%H:%M:%SZ) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%SZ) \
  --period 86400 \
  --statistics Minimum \
  --region us-east-1
```

---

## Notes

This waypoint addresses Gap #3 from the pipeline analysis: "Silent Authentication Failures". By proactively validating credentials:
1. Issues detected before they cause data staleness
2. Team can respond before trade-in pricing is affected
3. Clear audit trail of credential health over time
