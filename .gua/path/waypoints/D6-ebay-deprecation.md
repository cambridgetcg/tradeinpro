# Waypoint: D6 - eBay Integration Deprecation

**Created**: 2026-01-29
**Type**: Infrastructure (Data)
**Required By**: W7 (Production Launch)
**Status**: completed
**Completed**: 2026-01-29
**Depends On**: D3

---

## What This Waypoint Achieves

Formal decision and execution regarding the eBay integration: either activate it or cleanly deprecate it to avoid codebase confusion.

---

## Success Criteria

1. [x] Decision documented: DEPRECATE
2. [x] Lambda functions archived to `.archive/ebay-lambdas/`
3. [x] Lambda functions deleted from AWS (API_ebay, API_ebayPrivate, API_ebayUpdateItemNumber)
4. [x] Documentation updated (README.md in archive)
5. N/A - ACTIVATE path not taken

---

## Current State Analysis

### What Exists

| Component | Location | Last Modified |
|-----------|----------|---------------|
| API_ebay Lambda | us-east-1 | April 2025 |
| API_ebayPrivate Lambda | us-east-1 | April 2025 |
| API_ebayUpdateItemNumber Lambda | us-east-1 | April 2025 |
| EventBridge Schedule | NOT FOUND | N/A |

### Why It's Inactive

Based on investigation:
1. Lambdas were created in April 2025
2. No EventBridge rule schedules them
3. No recent invocations in CloudWatch
4. eBay data in pricefeed comes from S3 manual upload, not Lambda

### Impact of eBay Data

**Used For**:
- Historical sold prices (correlation analysis)
- Price validation (what cards actually sell for)
- Arbitrage detection (compare to other markets)

**Not Used For**:
- Real-time pricing (TCGplayer/CardMarket handle this)
- Trade-in value calculation (uses TCGplayer prices)

---

## Decision Framework

### Option A: DEPRECATE

**Do this if**:
- eBay data isn't critical for trade-in operations
- Maintaining eBay API credentials is overhead
- Historical sold data available elsewhere (TCGplayer history)
- Team doesn't have capacity to maintain

**Actions**:
1. Archive Lambda code (move to `/archive/` or delete)
2. Delete Lambda functions from AWS
3. Remove eBay secrets from Secrets Manager
4. Update documentation to remove eBay references
5. Close gap in analysis as "deprecated"

### Option B: ACTIVATE

**Do this if**:
- eBay sold data provides unique value
- Correlation analysis needs real market prices
- Team has capacity to maintain integration
- eBay API credentials are valid

**Actions**:
1. Verify eBay API credentials still work
2. Create EventBridge rule: `cron(0 6 * * ? *)` (daily at 6 AM UTC)
3. Test Lambda manually
4. Add CloudWatch alarm for errors
5. Add to monitoring dashboard

---

## Recommendation

**DEPRECATE** the eBay integration:

**Reasoning**:
1. eBay data is supplementary, not critical for trade-in operations
2. Lambdas haven't run since April 2025 - 9 months inactive
3. Credentials likely expired or need refresh
4. Adds maintenance burden with unclear value
5. TCGplayer provides sufficient price history for trade-ins

**Future Note**: If eBay data becomes needed, reactivate from archive or rebuild with fresh credentials.

---

## Deprecation Steps

```bash
# 1. Archive Lambda code locally
aws lambda get-function --function-name API_ebay --region us-east-1 \
  --query 'Code.Location' --output text | xargs curl -o ebay_lambda_backup.zip

# 2. Document current state
aws lambda list-functions --region us-east-1 \
  --query 'Functions[?contains(FunctionName, `ebay`)].{Name:FunctionName,Runtime:Runtime,Modified:LastModified}'

# 3. Delete Lambda functions (after backup confirmed)
aws lambda delete-function --function-name API_ebay --region us-east-1
aws lambda delete-function --function-name API_ebayPrivate --region us-east-1
aws lambda delete-function --function-name API_ebayUpdateItemNumber --region us-east-1

# 4. Remove secrets (if eBay-specific)
# First verify what secrets exist for eBay
aws secretsmanager list-secrets --region us-east-1 \
  --query 'SecretList[?contains(Name, `ebay`)].Name'
```

---

## Verification

After deprecation:
```bash
# Verify Lambdas removed
aws lambda list-functions --region us-east-1 \
  --query 'Functions[?contains(FunctionName, `ebay`)]'
# Expected: []

# Verify no orphan EventBridge rules
aws events list-rules --region us-east-1 \
  --query 'Rules[?contains(Name, `ebay`)]'
# Expected: []
```

---

## Notes

This waypoint exists to make an explicit decision rather than leaving legacy code in an ambiguous state. The eBay integration is "injustice" in PP terms - code that exists in the wrong state (neither active nor cleanly removed).
