# Data Acquisition Pipeline - Gap Analysis

**Analysis Date**: 2026-01-29
**Framework**: Purpose Prompter (PP)
**Analyst**: Claude Code

---

## Executive Summary

The data acquisition pipeline is **sophisticated but fragile**. While 9 data sources are configured across 3 markets (US, EU, Japan), several critical dependencies create single points of failure.

**Overall Health Score: 65/100**

| Category | Score | Status |
|----------|-------|--------|
| Source Coverage | 85% | Good - 9 sources configured |
| Automation | 45% | Poor - Manual S3 dependency |
| Reliability | 55% | Medium - External service risks |
| Monitoring | 30% | Poor - No alerting |
| Scalability | 70% | Good - AWS infrastructure ready |

---

## PP Signal Analysis

### 🔴 UGLINESS SIGNALS (Incomplete Understanding)

These indicate we don't fully understand what's happening:

| Signal | Location | Impact |
|--------|----------|--------|
| Silent authentication failures | TCGplayer Lambda | Data goes stale without notice |
| No error alerting | All Lambda collectors | Failures go undetected |
| Missing validation logs | S3 sync crons | Don't know if sync succeeded |
| Unclear eBay scheduling | eBay Lambda | Don't know if it runs |

### 🟡 INJUSTICE SIGNALS (Misplaced Responsibility)

These indicate things are in the wrong place:

| Signal | Location | Better Place |
|--------|----------|--------------|
| Manual S3 uploads | External process | Should be automated collector |
| Bright Data dependency | CardMarket scraper | Should use direct API |
| On-demand JustTCG | Client library | Should be scheduled collector |
| Exchange rates in multiple places | Scattered | Should be centralized service |

### 🟠 STAGNATION SIGNALS (Need for Creativity)

These indicate new paths are needed:

| Signal | Evidence | New Path Needed |
|--------|----------|-----------------|
| No Pokemon data | Schema ready, no collectors | Activate Pokemon pipeline |
| No webhook delivery | Schema exists, not implemented | Build notification system |
| No real-time alerts | Missing entirely | Create price alert service |
| No data freshness monitoring | No metrics | Build health dashboard |

---

## Critical Gap #1: S3 File Dependency

**Severity**: 🔴 CRITICAL

**Current State**:
```
External Process (unknown) → S3 Upload → Vercel Cron → Database
```

**Problem**: The entire pricing system depends on someone/something uploading `daily_prices.xlsx` and `pricefeed/*.xlsx` to S3 every day. This is:
- Not automated
- No monitoring
- No alerting if upload fails
- Unknown who/what does the upload

**Impact**: If S3 files stop being uploaded:
- Daily price sync fails silently
- JPY prices go stale
- Multi-channel arbitrage data disappears
- Trade-in prices become outdated

**Evidence**:
```typescript
// app/routes/api.cron.price-sync.tsx
const response = await s3.send(new GetObjectCommand({
  Bucket: S3_PRICE_BUCKET,
  Key: "daily_prices.xlsx",  // WHO UPLOADS THIS?
}));
```

**Recommendation**:
1. Document who/what uploads S3 files
2. Add monitoring for S3 file freshness
3. Create CloudWatch alarm if file not updated in 24h
4. Long-term: Create automated collector to replace manual upload

---

## Critical Gap #2: Bright Data Subscription Risk

**Severity**: 🔴 CRITICAL

**Current State**:
```
CardMarket Website → Bright Data Scraper → Lambda → Database
```

**Problem**: CardMarket data depends on a paid third-party service (Bright Data). If subscription lapses or service fails:
- No EU pricing data
- No CardMarket condition breakdown
- 33% of price sources lost

**Evidence**:
```typescript
// infrastructure/data-pipeline/lambda/collectors/cardmarket/cardmarket.ts
const brightDataResponse = await fetch(BRIGHT_DATA_API_URL, {
  headers: { 'Authorization': `Bearer ${BRIGHT_DATA_API_KEY}` }
});
```

**Impact**:
- EU market blind spot
- Arbitrage detection broken (no EU prices to compare)
- Trade-in prices may be suboptimal

**Recommendation**:
1. Verify Bright Data subscription status
2. Set up billing alerts
3. Investigate direct CardMarket API (if available)
4. Create fallback data source

---

## Critical Gap #3: Silent Authentication Failures

**Severity**: 🟡 HIGH

**Current State**:
```
Lambda → AWS Secrets Manager → External API
                     ↓
              If auth fails → Silent failure
```

**Problem**: Lambda collectors fetch credentials from Secrets Manager and use them to authenticate with external APIs. If credentials expire:
- Lambda runs successfully (no error)
- API returns 401/403
- Collector logs error but continues
- No alert is triggered
- Data stops flowing

**Evidence**:
```typescript
// TCGplayer collector
const apiKey = await getSecret('tcgplayer-api-key');
const response = await fetch(TCGPLAYER_API, {
  headers: { 'Authorization': `Bearer ${apiKey}` }
});
if (!response.ok) {
  console.error('Auth failed');  // Logged but not alerted
  return;  // Silent failure
}
```

**Impact**:
- TCGplayer data goes stale without warning
- Days could pass before anyone notices
- Trade-in prices based on old data

**Recommendation**:
1. Add CloudWatch alarm on Lambda error logs
2. Create SNS notification for auth failures
3. Implement credential rotation monitoring
4. Add health check endpoint that verifies API connectivity

---

## Critical Gap #4: eBay Integration Inactive

**Severity**: 🟡 HIGH

**Current State**:
```
eBay Lambda exists → EventBridge schedule unclear → Data likely stale
```

**Problem**: eBay collector Lambda exists but:
- No clear schedule in EventBridge
- No recent data in database
- Used for historical/correlation analysis which is now outdated

**Evidence**:
- `lambda/collectors/ebay/ebay.ts` exists
- No EventBridge rule found for eBay
- eBay data in pricefeed comes from S3, not Lambda

**Impact**:
- Historical sold prices not being collected
- Correlation analysis based on stale data
- Arbitrage detection missing eBay channel

**Recommendation**:
1. Verify if eBay Lambda is scheduled
2. If not, add EventBridge rule (daily)
3. Verify eBay API credentials are valid
4. Add monitoring for data freshness

---

## Critical Gap #5: JustTCG On-Demand Only

**Severity**: 🟡 MEDIUM

**Current State**:
```
JustTCG Client Library → Called manually → Not in scheduled pipeline
```

**Problem**: JustTCG provides 180-day price history but:
- Only used when explicitly called
- Not part of any scheduled sync
- Historical data not being collected
- Valuable time series being lost

**Evidence**:
```typescript
// app/lib/data-collection/clients/justtcg.server.ts
export async function fetchJustTCGPrices(cardId: string) {
  // On-demand function, not scheduled
}
```

**Impact**:
- Missing 180-day history data
- Less accurate trend analysis
- Potential arbitrage opportunities missed

**Recommendation**:
1. Create scheduled cron for JustTCG collection
2. Store historical data in MarketPriceUS table
3. Add to correlation calculation

---

## Critical Gap #6: No Monitoring Dashboard

**Severity**: 🟡 MEDIUM

**Current State**:
```
Data flows → No visibility → Hope it works
```

**Problem**: No centralized view of:
- Data freshness per source
- Collection success rates
- API error rates
- Price staleness

**Evidence**:
- No CloudWatch dashboard for data pipeline
- No health check endpoint
- No data quality metrics exposed

**Impact**:
- Can't proactively detect issues
- Problems discovered by users/customers
- No SLA tracking

**Recommendation**:
1. Create CloudWatch dashboard for pipeline health
2. Add data freshness metrics endpoint
3. Create alert for any source >24h stale
4. Expose pipeline status in admin UI

---

## Critical Gap #7: Pokemon Infrastructure Unused

**Severity**: 🟢 LOW (opportunity cost)

**Current State**:
```
Schema supports Pokemon → No collectors configured → Infrastructure idle
```

**Problem**: The system is designed for multi-TCG but:
- `game` field exists in all tables
- `syncDailyPrices("pokemon")` function exists
- No Pokemon data sources configured
- No Pokemon collectors deployed

**Evidence**:
```typescript
// Schema: game field on CardPriceV2
game            String    @default("onepiece")

// Function exists but no data
await syncDailyPrices("pokemon");  // No S3 file to sync
```

**Impact**:
- Revenue opportunity missed
- Infrastructure cost without utilization

**Recommendation**:
1. Identify Pokemon data sources
2. Configure Pokemon S3 sync
3. Deploy Pokemon collectors
4. Enable Pokemon in trade-in system

---

## Critical Gap #8: Webhook System Unimplemented

**Severity**: 🟢 LOW (future need)

**Current State**:
```
ApiWebhook table exists → No delivery mechanism → Feature incomplete
```

**Problem**: Schema includes webhook infrastructure but:
- No webhook delivery code
- No subscription management
- No event triggers

**Evidence**:
```prisma
model ApiWebhook {
  id          String   @id
  url         String
  events      String[]  // price_change, new_card, etc.
  // No delivery implementation
}
```

**Impact**:
- API customers can't get real-time updates
- No push notification capability
- Manual polling required

**Recommendation**:
1. Implement webhook delivery service
2. Add subscription management UI
3. Create event triggers in price sync
4. Document webhook API

---

## Gap Summary Matrix

| Gap | Severity | Effort | Impact | Priority |
|-----|----------|--------|--------|----------|
| S3 File Dependency | 🔴 Critical | High | System-wide | P0 |
| Bright Data Risk | 🔴 Critical | Medium | EU data | P0 |
| Silent Auth Failures | 🟡 High | Low | Detection | P1 |
| eBay Inactive | 🟡 High | Low | Data quality | P1 |
| JustTCG On-Demand | 🟡 Medium | Low | History | P2 |
| No Monitoring | 🟡 Medium | Medium | Visibility | P2 |
| Pokemon Unused | 🟢 Low | High | Revenue | P3 |
| Webhooks Missing | 🟢 Low | High | Features | P3 |

---

## Recommended Waypoints

Based on this analysis, I recommend adding infrastructure waypoints to the PATH:

### D1: Data Pipeline Monitoring
- CloudWatch dashboard for all collectors
- Data freshness alarms (>24h stale)
- Authentication failure alerts
- Pipeline health endpoint

### D2: S3 Automation
- Document current upload process
- Add S3 freshness monitoring
- Create automated fallback collector
- Remove manual dependency

### D3: Source Reliability
- Verify Bright Data subscription
- Investigate CardMarket direct API
- Activate eBay scheduling
- Add JustTCG to cron

---

## Files Analyzed

| File | Purpose | Issues Found |
|------|---------|--------------|
| `app/lib/s3-prices.server.ts` | S3 file handling | No freshness check |
| `app/routes/api.cron.*.tsx` | Cron jobs | No error alerting |
| `infrastructure/data-pipeline/lambda/` | Collectors | Silent failures |
| `vercel.json` | Cron schedules | eBay not scheduled |
| `prisma/schema.prisma` | Data models | Webhooks unused |

---

## Conclusion

The data acquisition pipeline has **strong bones** but **weak monitoring**. The biggest risks are:

1. **S3 dependency** - Single point of failure with no monitoring
2. **External services** - Bright Data subscription risk
3. **Silent failures** - No alerting when things break

Immediate actions:
1. Add CloudWatch alarms for Lambda errors
2. Create data freshness monitoring
3. Document and monitor S3 upload process
4. Verify all external service subscriptions

The system will be **production-grade** once these gaps are addressed.
