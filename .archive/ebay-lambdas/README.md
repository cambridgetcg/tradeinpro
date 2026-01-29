# eBay Lambda Archive

**Archived**: 2026-01-29
**Reason**: Deprecated - Lambdas inactive since April 2025, no EventBridge schedule

## Archived Functions

| Function | Last Modified | Size |
|----------|---------------|------|
| API_ebay | 2025-04-01 | 1.9KB |
| API_ebayPrivate | 2025-04-01 | 2.3KB |
| API_ebayUpdateItemNumber | 2025-04-02 | 1.7KB |

## Why Deprecated

1. **No active schedule**: No EventBridge rules found for these Lambdas
2. **9 months inactive**: Last modified April 2025
3. **Data not critical**: eBay sold data is supplementary, not required for trade-in operations
4. **Maintenance burden**: Keeping inactive Lambdas creates confusion

## If Reactivation Needed

1. Unzip the archived code
2. Create new Lambda functions with the code
3. Verify/update eBay API credentials in Secrets Manager
4. Create EventBridge schedule (recommend daily at 6 AM UTC)
5. Add CloudWatch alarms for errors

## Original Purpose

- `API_ebay`: Fetch eBay sold listings for price correlation
- `API_ebayPrivate`: Fetch private/completed listings
- `API_ebayUpdateItemNumber`: Update item identifiers
