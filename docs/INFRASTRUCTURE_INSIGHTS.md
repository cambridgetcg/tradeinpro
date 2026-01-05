# Infrastructure Integration: Key Insights

> **Quick reference for critical decisions and discoveries**
> **Date:** 2026-01-03

---

## Critical Discovery: Don't Duplicate Existing Patterns

| Pattern | Already Exists In | Do NOT Recreate |
|---------|-------------------|-----------------|
| Collision retry | `submissions.server.ts:637` | `createSubmissionWithRetry()` |
| Notification retry | `notifications.server.ts:591` | `withRetry()` |
| Rate limiting | `royalMailApi.server.ts:396` | 500ms delay |
| Failed tracking | `notifications.server.ts:618` | `recordFailedNotification()` |

**Insight:** Wrap existing patterns with new infrastructure, don't replace them.

---

## Integration Priority Matrix

```
                    HIGH IMPACT
                        │
    ┌───────────────────┼───────────────────┐
    │                   │                   │
    │  OBSERVABILITY    │  CIRCUIT BREAKER  │
    │  (Do First)       │  (Royal Mail)     │
    │                   │                   │
LOW ├───────────────────┼───────────────────┤ HIGH
RISK│                   │                   │ RISK
    │  FEATURE FLAGS    │  DB RETRY         │
    │  (Easy Win)       │  (Be Careful)     │
    │                   │                   │
    └───────────────────┼───────────────────┘
                        │
                    LOW IMPACT
```

**Golden Rule:** Observability FIRST → See behavior before changing it.

---

## The 5 External API Touch Points

1. **Royal Mail** - `services/royalMailApi.server.ts`
   - `createOrder()`, `getLabel()`, `getTracking()`, `deleteOrder()`
   - **Fallback strategy:** Queue for retry, return "pending" status

2. **Shopify Admin (Email)** - `app-proxy.server.ts:570`
   - `getShopifyCustomerEmail()`
   - **Fallback strategy:** Return null, use placeholder email

3. **Shopify Admin (Gift Cards)** - `payouts.server.ts:295`
   - `giftCardCreate` mutation
   - **Fallback strategy:** NONE - must succeed, let it throw

4. **Email Service** - `notifications.server.ts:641`
   - `sendEmail()`
   - **Fallback strategy:** Queue for later delivery

---

## DB Retry: The Idempotency Trap

**DANGER:** Only wrap idempotent operations with `withDbRetry()`.

| Operation | Idempotent? | Safe to Retry? |
|-----------|-------------|----------------|
| `findUnique()` | Yes | ✅ Safe |
| `findMany()` | Yes | ✅ Safe |
| `update()` with same data | Yes | ✅ Safe |
| `create()` without unique key | NO | ❌ Duplicates! |
| `create()` with idempotency key | Yes | ✅ Safe |
| Increment counter | NO | ❌ Double count! |

**Solution:** The existing `createSubmissionWithRetry` handles collision via unique constraint. Wrap it with `withDbRetry` for connection errors only.

---

## Feature Flags: Current → Target Behavior

| Flag | Current Default | Behavior When Enabled |
|------|-----------------|----------------------|
| `royalMailEnabled` | `false` | Use Royal Mail API for labels |
| `priceFreshnessBlocking` | `false` | Block submissions with stale prices |
| `newPayoutMethods` | `false` | Show PayPal option |
| `japaneseCardsEnabled` | `true` | Allow Japanese card submissions |
| `debugLogging` | `false` | Enable debug logs in production |

**Insight:** Defaults match current production behavior → enabling flag = opt-in to new behavior.

---

## Auth Middleware Migration: The Safe Path

**Migrate in order of traffic (lowest first):**

```
1. api.shipping.label.$id.tsx     (rarely used)
2. api.submissions.$id.confirm.tsx (low traffic)
3. api.submissions.$id.reject.tsx  (low traffic)
    ↓
4. api.my-submissions.tsx          (medium traffic)
    ↓
5. api.submissions.tsx             (high traffic) ← LAST
```

**Why:** If middleware has a bug, it affects fewer users in low-traffic routes.

---

## Circuit Breaker Tuning Guide

| Service | Failure Threshold | Reset Timeout | Rationale |
|---------|-------------------|---------------|-----------|
| Royal Mail | 3 | 2 min | Shipping is time-sensitive |
| Shopify Admin | 5 | 1 min | More tolerant, critical for auth |
| Email | 3 | 5 min | Can delay, not blocking |

**Monitoring:** Alert when ANY circuit opens. This is your early warning system.

---

## Quick Wins (< 1 hour each)

1. **Add trace ID to error responses** - Instant debugging improvement
2. **Replace console.log with logger** - Structured, filterable logs
3. **Wire `royalMailEnabled` flag** - Already has fallback path
4. **Add metrics.increment to key events** - Visibility into system health

---

## Red Flags to Watch For

| Signal | Meaning | Action |
|--------|---------|--------|
| Circuit opens frequently | Upstream service degraded | Check external service status |
| DB retries > 10% | Database under stress | Scale DB or optimize queries |
| Trace duration > 5s | Slow operation | Profile and optimize |
| Feature flag cache miss | DB being hit too often | Check cache TTL |

---

## The One-Line Summary

> **"Add observability first, then circuit breakers protect external calls, DB retry handles transient errors, and feature flags let you control rollout."**

---

*See full plan: [INFRASTRUCTURE_INTEGRATION_PLAN.md](./INFRASTRUCTURE_INTEGRATION_PLAN.md)*
