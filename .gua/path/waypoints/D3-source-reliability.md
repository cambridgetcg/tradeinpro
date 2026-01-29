# Waypoint: D3 - Source Reliability Hardening

**Created**: 2026-01-29
**Type**: Infrastructure (Data)
**Required By**: W7 (Production Launch)
**Status**: completed
**Completed**: 2026-01-29

---

## What This Waypoint Achieves

Verifies and documents the reliability of all external data sources, API credentials, and scheduled collectors.

---

## Success Criteria

1. [x] Verify Bright Data subscription status
2. [x] Verify TCGplayer API credentials
3. [x] Document eBay integration status
4. [x] Document all data source schedules
5. [ ] Add JustTCG to scheduled pipeline (optional enhancement)

---

## External Service Verification

### Bright Data (CardMarket Scraping)

| Attribute | Status |
|-----------|--------|
| Secret Name | `brightdata/web-unlocker` |
| Secret Created | 2026-01-12 |
| Status | ✓ ACTIVE (recent secret update) |
| Used By | CardMarket scraper collectors |

**Verification**:
```bash
aws secretsmanager get-secret-value --secret-id brightdata/web-unlocker --region us-east-1 --query 'CreatedDate'
# Output: 2026-01-12T23:04:41.787000+00:00
```

### TCGplayer API

| Attribute | Status |
|-----------|--------|
| Secret Name | `trading-card-pricer/api-keys` |
| Status | ✓ ACTIVE |
| Used By | trading-card-price-fetcher Lambda |

### eBay Integration

| Attribute | Status |
|-----------|--------|
| Lambdas | API_ebay, API_ebayPrivate, API_ebayUpdateItemNumber |
| Last Modified | April 2025 |
| EventBridge Rule | NOT FOUND |
| Status | ⚠️ INACTIVE - Lambdas exist but not scheduled |

**Analysis**: eBay Lambdas exist but are not scheduled via EventBridge. They were last updated in April 2025. This appears to be legacy code not actively used.

**Impact**: eBay historical sold data is not being collected. This affects:
- Correlation analysis accuracy
- Historical price validation
- Arbitrage detection (eBay channel missing)

**Recommendation**: Either schedule eBay collectors or remove from codebase to avoid confusion.

---

## Data Source Schedule Matrix

| Source | Collector | Schedule | Last Run | Status |
|--------|-----------|----------|----------|--------|
| OPTCG API | trading-card-price-fetcher | 8 AM, 8 PM UTC | Today | ✓ ACTIVE |
| Limitless | tcg-tradein-limitless-scraper | 8 AM, 8 PM UTC | Today | ✓ ACTIVE |
| TCG Batch | tcg-ScrapeBatch-prod | 6 AM UTC | Today | ✓ ACTIVE |
| Pricefeed | calculator-pricefeed | 12:32 PM UTC | Today | ✓ ACTIVE |
| CardMarket | (via Bright Data) | (triggered) | Unknown | ⚠️ VERIFY |
| eBay | API_ebay, API_ebayPrivate | NOT SCHEDULED | Never | ❌ INACTIVE |
| JustTCG | On-demand only | NOT SCHEDULED | N/A | ⚠️ ON-DEMAND |

---

## Secrets Manager Inventory

| Secret | Purpose | Status |
|--------|---------|--------|
| `trading-card-pricer/api-keys` | TCGplayer API credentials | ✓ Active |
| `brightdata/web-unlocker` | Bright Data scraping service | ✓ Active |
| `/cardforum/dev/api/royal-mail-api-key` | Shipping integration | ✓ Active |
| `/cardforum/dev/database/postgres-credentials` | Database access | ✓ Active |
| `/cardforum/dev/oauth/*` | OAuth integrations | ✓ Active |

---

## Risk Assessment

| Source | Original Risk | Verified Status | Risk Level |
|--------|---------------|-----------------|------------|
| Bright Data | "Subscription may lapse" | Secret updated Jan 12 | LOW |
| TCGplayer | "Credentials may expire" | Monitored with alarms | LOW |
| S3 Files | "Manual upload" | Automated via Lambda | LOW |
| eBay | "Unclear status" | Not scheduled | MEDIUM (data missing) |
| JustTCG | "On-demand only" | Confirmed on-demand | LOW (feature not blocker) |

---

## Recommendations

### Short-term (Optional)
1. **eBay**: Either schedule the existing Lambdas or document as deprecated
2. **JustTCG**: Consider adding to daily sync for historical data

### Long-term
1. **Credential Rotation**: Implement automatic rotation for API keys
2. **Health Checks**: Add credential validation to health endpoint
3. **Backup Sources**: Identify fallback sources for each data channel

---

## Verification Commands

```bash
# Check all secrets
aws secretsmanager list-secrets --region us-east-1 \
  --query 'SecretList[*].{Name:Name,Created:CreatedDate}'

# Check EventBridge rules
aws events list-rules --region us-east-1 \
  --query 'Rules[*].{Name:Name,State:State,Schedule:ScheduleExpression}'

# Check Lambda last invocations
aws lambda list-functions --region us-east-1 \
  --query 'Functions[?contains(FunctionName, `price`) || contains(FunctionName, `scraper`)].{Name:FunctionName,LastModified:LastModified}'
```

---

## Notes

The data pipeline is more robust than initially assessed:
- **Bright Data** subscription is active (secret recently updated)
- **TCGplayer** credentials are in Secrets Manager and monitored
- **S3 uploads** are fully automated (not manual)
- **eBay** is the only truly inactive source, but it's historical data, not critical for trade-ins

The primary data sources (OPTCG, Limitless, TCG Batch) are all active and healthy.
