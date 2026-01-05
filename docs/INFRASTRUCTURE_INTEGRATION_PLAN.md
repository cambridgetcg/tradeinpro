# Infrastructure Integration Plan

> **Purpose:** Strategic plan for integrating resilience, observability, and feature flag modules into production code
> **Created:** 2026-01-03
> **Status:** Planning Phase

---

## Executive Summary

We have built four infrastructure modules that are currently **implemented but not integrated**:

| Module | Purpose | Risk Level | Integration Priority |
|--------|---------|------------|---------------------|
| `circuit-breaker.server.ts` | Protect external APIs from cascading failures | Medium | High |
| `db-resilience.server.ts` | Retry transient database errors | Medium | High |
| `observability.server.ts` | Structured logging and tracing | Low | Critical (do first) |
| `feature-flags.server.ts` | Runtime feature control | Low | High |
| `middleware/auth.server.ts` | HOF authentication wrappers | Low | Medium |

**Key Insight:** Observability should be integrated FIRST because it provides visibility into system behavior before we change that behavior with circuit breakers and retry logic.

---

## Current State Analysis

### What Already Exists (Don't Duplicate)

| Feature | Location | Implementation |
|---------|----------|----------------|
| **Retry on collision** | `submissions.server.ts:637-681` | `createSubmissionWithRetry()` - 5 retries, exponential backoff |
| **Notification retry** | `notifications.server.ts:591-613` | `withRetry()` - 3 attempts, exponential backoff |
| **Rate limiting** | `royalMailApi.server.ts:396` | 500ms delay between requests |
| **Failed notification tracking** | `notifications.server.ts:618-639` | `recordFailedNotification()` |

### Integration Points Discovered

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        EXTERNAL API INTEGRATION POINTS                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ROYAL MAIL API (services/royalMailApi.server.ts)                          │
│  ├── createOrder()      [line 224]  → Circuit breaker + tracing            │
│  ├── getLabel()         [line 328]  → Circuit breaker                      │
│  ├── getTracking()      [line 344]  → Circuit breaker                      │
│  └── deleteOrder()      [line 362]  → Circuit breaker                      │
│                                                                             │
│  SHOPIFY ADMIN API                                                          │
│  ├── getShopifyCustomerEmail()  [app-proxy.server.ts:570]  → CB + trace    │
│  └── giftCardCreate mutation    [payouts.server.ts:295]    → CB + trace    │
│                                                                             │
│  EMAIL SERVICE (notifications.server.ts)                                    │
│  └── sendEmail()        [line 641]  → Circuit breaker (wraps existing)     │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                        DATABASE INTEGRATION POINTS                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  CRITICAL PATH (High traffic, data loss = catastrophic)                     │
│  ├── createSubmission()        [submissions.server.ts:696]  → DB retry     │
│  ├── executeTransition()       [workflow.server.ts]         → DB retry     │
│  └── createPayout()            [payouts.server.ts:220]      → DB retry     │
│                                                                             │
│  SECONDARY PATH (Important but can fail gracefully)                         │
│  ├── getOrCreateCustomer()     [submissions.server.ts]      → DB retry     │
│  ├── linkGuestSubmissions()    [app-proxy.server.ts:452]    → DB retry     │
│  └── processStoreCreditPayout() [payouts.server.ts:326]     → DB retry     │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                        AUTH ROUTES (Middleware Migration)                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  CUSTOMER-REQUIRED ROUTES                                                   │
│  ├── api.submissions.tsx          [GET]    → withRequiredCustomer()        │
│  ├── api.my-submissions.tsx       [GET]    → withRequiredCustomer()        │
│  ├── api.shipping.label.$id.tsx   [GET/POST] → withRequiredCustomer()      │
│  ├── api.submissions.$id.confirm.tsx [POST] → withRequiredCustomer()       │
│  └── api.submissions.$id.reject.tsx  [POST] → withRequiredCustomer()       │
│                                                                             │
│  APP-PROXY ROUTES (Guest allowed)                                           │
│  ├── api.submissions.tsx          [POST]   → withAppProxy()                │
│  └── api.track.tsx                [GET]    → withAppProxy()                │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Integration Strategy

### Philosophy: "Observe → Protect → Control"

```
Phase A: OBSERVE     Phase B: PROTECT      Phase C: CONTROL
─────────────────    ─────────────────     ─────────────────
Add tracing to       Add circuit breakers  Enable feature flags
critical paths       to external APIs      for gradual rollout

Add structured       Add DB retry to       Migrate auth to
logging throughout   critical operations   middleware pattern

     ↓                      ↓                     ↓
 VISIBILITY           RESILIENCE            FLEXIBILITY
```

---

## Phase A: Observability Integration (Low Risk, High Value)

**Goal:** Gain visibility into system behavior before changing it.

### A.1 Trace Submission Creation Flow

**File:** `app/lib/submissions.server.ts`

```typescript
// BEFORE (line 696)
export async function createSubmission(
  shop: string,
  data: CreateSubmissionInput
): Promise<SubmissionResult> {
  // ... implementation
}

// AFTER
import { withTrace, logger } from "./observability.server";

export async function createSubmission(
  shop: string,
  data: CreateSubmissionInput
): Promise<SubmissionResult> {
  return withTrace("submission.create", {
    shop,
    itemCount: data.items.length,
    payoutType: data.payoutType,
    hasCustomerId: !!data.customerId,
  }, async (trace) => {
    trace.log("Fetching settings and customer in parallel");
    const [settings, customer] = await Promise.all([...]);

    trace.log("Validating and preparing items", { itemCount: data.items.length });
    const preparedItems = await validateAndPrepareItems(...);

    trace.log("Generating submission number");
    const submissionNumber = await generateSubmissionNumber(shop);
    trace.addAttribute("submissionNumber", submissionNumber);

    trace.log("Creating submission record");
    const submission = await createSubmissionWithRetry(...);

    trace.setResult("success");
    return { success: true, submission };
  });
}
```

**Value:** When submissions fail in production, trace ID in error response enables rapid debugging.

### A.2 Trace Workflow Transitions

**File:** `app/lib/workflow.server.ts`

```typescript
// In executeTransition()
import { withTrace, logger, metrics } from "./observability.server";

export async function executeTransition(params: TransitionParams): Promise<TransitionResult> {
  return withTrace("workflow.transition", {
    submissionId: params.submissionId,
    targetStatus: params.targetStatus,
    actorType: params.actorType,
  }, async (trace) => {
    trace.log("Validating transition");
    const validation = canTransition(currentStatus, params.targetStatus);

    if (!validation.valid) {
      trace.setResult("error");
      trace.addAttribute("error", validation.reason || "Invalid transition");
      return { success: false, error: validation.reason };
    }

    trace.log("Updating submission status");
    const updated = await prisma.tradeInSubmission.update(...);

    trace.log("Sending notification");
    await sendTransitionNotification(...);

    // Record metric
    metrics.increment(`workflow.transition.${params.targetStatus}`);

    trace.setResult("success");
    return { success: true, submission: updated };
  });
}
```

### A.3 Add Structured Logging to Key Operations

**Pattern:** Replace `console.log/error` with structured logger.

```typescript
// BEFORE
console.error("Failed to create gift card:", error);

// AFTER
logger.error("Failed to create gift card", {
  submissionId,
  customerId,
  amount: giftCardAmount,
  error: error instanceof Error ? error.message : String(error),
}, traceId);
```

**Files to Update:**
- `lib/submissions.server.ts` - 4 console.log calls
- `lib/payouts.server.ts` - 6 console.log/error calls
- `lib/notifications.server.ts` - 8 console.log/warn calls
- `lib/shipping.server.ts` - 3 console.log calls
- `lib/app-proxy.server.ts` - 5 console.warn/error calls

### A.4 Add Request Tracing to API Routes

**Pattern:** Extract/generate trace ID at route entry, include in all responses.

```typescript
// In route loader/action
import { getRequestTraceId, addTraceIdToResponse } from "~/lib/observability.server";

export async function action({ request }: ActionFunctionArgs) {
  const traceId = getRequestTraceId(request);

  try {
    // ... business logic
    const response = json({ success: true, data });
    return addTraceIdToResponse(response, traceId);
  } catch (error) {
    logger.error("Action failed", { error: error.message }, traceId);
    const response = json({ error: "Internal error", traceId }, { status: 500 });
    return addTraceIdToResponse(response, traceId);
  }
}
```

---

## Phase B: Resilience Integration (Medium Risk, High Protection)

**Goal:** Protect system from external failures and transient errors.

### B.1 Circuit Breaker on Royal Mail API

**File:** `app/services/royalMailApi.server.ts`

**Current State:** Has rate limiting but no failure protection.

**Integration Point:** Wrap the internal `_makeRequest` method or individual public methods.

```typescript
import { royalMailCircuitBreaker, CircuitOpenError } from "~/lib/circuit-breaker.server";
import { withTrace, logger } from "~/lib/observability.server";

class RoyalMailService {
  // Wrap API calls with circuit breaker
  async createOrder(data: CreateOrderData): Promise<OrderResult> {
    return withTrace("royalmail.createOrder", {
      recipientPostcode: data.recipient.postcode,
    }, async (trace) => {
      try {
        return await royalMailCircuitBreaker.execute(
          () => this._createOrderImpl(data),
          () => {
            // Fallback: Queue for retry, return pending status
            trace.log("Circuit open, returning fallback response");
            return {
              success: false,
              queued: true,
              message: "Shipping service temporarily unavailable. Label will be generated shortly.",
            };
          }
        );
      } catch (error) {
        if (error instanceof CircuitOpenError) {
          trace.setResult("error");
          trace.addAttribute("circuitOpen", true);
        }
        throw error;
      }
    });
  }

  private async _createOrderImpl(data: CreateOrderData): Promise<OrderResult> {
    // Existing implementation
  }
}
```

**Fallback Behavior Options:**

| Scenario | Fallback Strategy |
|----------|-------------------|
| Label generation | Return "queued" status, add to retry queue |
| Tracking lookup | Return cached/stale tracking, or "unavailable" |
| Order deletion | Queue for later, don't block user flow |

### B.2 Circuit Breaker on Shopify Admin API

**File:** `app/lib/app-proxy.server.ts` and `app/lib/payouts.server.ts`

```typescript
import { shopifyAdminCircuitBreaker } from "~/lib/circuit-breaker.server";

// In app-proxy.server.ts
async function getShopifyCustomerEmail(
  admin: AdminApiContext,
  customerId: string
): Promise<string | null> {
  return shopifyAdminCircuitBreaker.execute(
    async () => {
      const response = await admin.graphql(GET_CUSTOMER_EMAIL_QUERY, { ... });
      return response.data?.customer?.email || null;
    },
    () => {
      // Fallback: Return null, will use placeholder email
      logger.warn("Shopify Admin API unavailable, using placeholder email");
      return null;
    }
  );
}

// In payouts.server.ts - Gift card creation
async function createGiftCard(admin: AdminApiContext, data: GiftCardInput) {
  return shopifyAdminCircuitBreaker.execute(
    async () => {
      const response = await admin.graphql(CREATE_GIFT_CARD_MUTATION, { ... });
      // ... existing logic
    },
    () => {
      // NO FALLBACK - gift card creation must succeed
      // Let it throw, will be retried by payout processor
      throw new Error("Gift card service temporarily unavailable");
    }
  );
}
```

### B.3 Circuit Breaker on Email Service

**File:** `app/lib/notifications.server.ts`

**Note:** Already has `withRetry()`. Add circuit breaker as outer wrapper.

```typescript
import { emailCircuitBreaker } from "~/lib/circuit-breaker.server";

async function sendEmail(options: EmailOptions): Promise<boolean> {
  return emailCircuitBreaker.execute(
    async () => {
      // Existing implementation with withRetry
      return await withRetry(() => actualSendEmail(options), {
        maxAttempts: 3,
        baseDelayMs: 1000,
      });
    },
    () => {
      // Fallback: Queue for later delivery
      logger.warn("Email circuit open, queuing notification", {
        to: options.to,
        subject: options.subject,
      });
      await queueFailedNotification(options);
      return false;
    }
  );
}
```

### B.4 Database Retry on Critical Operations

**File:** `app/lib/submissions.server.ts`

**Key Insight:** `createSubmissionWithRetry` already handles collision. Add `withDbRetry` for connection issues.

```typescript
import { withDbRetry } from "./db-resilience.server";

// Wrap the inner prisma.create call
async function createSubmissionWithRetry(...) {
  return withDbRetry(
    async () => {
      // Existing collision retry logic
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          return await prisma.tradeInSubmission.create({ ... });
        } catch (error) {
          if (isUniqueConstraintViolation(error)) {
            // Regenerate number and retry
            continue;
          }
          throw error; // Let withDbRetry handle connection errors
        }
      }
    },
    { label: "create-submission", maxRetries: 3 }
  );
}
```

**Files to Add DB Retry:**

| File | Function | Priority |
|------|----------|----------|
| `submissions.server.ts` | `createSubmission()` | Critical |
| `workflow.server.ts` | `executeTransition()` | Critical |
| `payouts.server.ts` | `createPayout()` | High |
| `payouts.server.ts` | `processStoreCreditPayout()` | High |
| `app-proxy.server.ts` | `getOrCreateCustomer()` | Medium |

---

## Phase C: Feature Flags & Control (Low Risk, High Flexibility)

**Goal:** Enable gradual rollout and runtime control.

### C.1 Wire Up Royal Mail Feature Flag

**File:** `app/lib/shipping.server.ts`

```typescript
import { isFeatureEnabled } from "./feature-flags.server";

export async function generateShippingLabel(
  shop: string,
  submission: Submission
): Promise<ShippingLabelResult> {
  // Check feature flag
  const royalMailEnabled = await isFeatureEnabled("royalMailEnabled", shop);

  if (!royalMailEnabled) {
    logger.info("Royal Mail disabled, using manual label flow", { shop });
    return {
      success: true,
      manual: true,
      instructions: "Please use your own shipping method...",
    };
  }

  // Proceed with Royal Mail integration
  return await royalMailService.createOrder(...);
}
```

### C.2 Wire Up Price Freshness Flag

**File:** `app/routes/api.submissions.tsx`

```typescript
import { isFeatureEnabled } from "~/lib/feature-flags.server";

export async function action({ request }: ActionFunctionArgs) {
  const shop = getShop(request);

  // Check for stale prices
  const staleItems = items.filter(item => isPriceStale(item.priceTimestamp));

  if (staleItems.length > 0) {
    const blockStale = await isFeatureEnabled("priceFreshnessBlocking", shop);

    if (blockStale) {
      return json({
        success: false,
        error: "STALE_PRICES",
        message: "Some prices are outdated. Please refresh and try again.",
        staleItems: staleItems.map(i => i.cardName),
      }, { status: 400 });
    } else {
      // Log warning but allow submission
      logger.warn("Submission with stale prices allowed", {
        shop,
        staleCount: staleItems.length,
      });
    }
  }

  // Continue with submission...
}
```

### C.3 Feature Flag for Debug Logging

**File:** `app/lib/observability.server.ts`

```typescript
import { isFeatureEnabledSync } from "./feature-flags.server";

export const logger = {
  debug(message: string, context?: LogContext, traceId?: string): void {
    // Check debug flag synchronously (uses cache)
    const debugEnabled = isFeatureEnabledSync("debugLogging", "default");

    if (debugEnabled || LOG_LEVELS.debug >= LOG_LEVELS[MIN_LOG_LEVEL]) {
      console.debug(formatLog("debug", message, context, traceId));
    }
  },
  // ...
};
```

---

## Phase D: Auth Middleware Migration (Low Risk, Code Quality)

**Goal:** Cleaner route code, consistent auth handling.

### Migration Pattern

```typescript
// BEFORE (verbose, repetitive)
export async function loader({ request }: LoaderFunctionArgs) {
  const context = await requireCustomer(request);
  if (context instanceof Response) {
    return context;
  }

  const { shop, internalCustomerId } = context;
  // ... business logic
}

// AFTER (clean, consistent)
import { withRequiredCustomer } from "~/middleware/auth.server";

export const loader = withRequiredCustomer(async ({ request, context }) => {
  const { shop, internalCustomerId } = context;
  // ... business logic (context guaranteed valid)
});
```

### Migration Order (by risk)

1. **Low traffic routes first:**
   - `api.shipping.label.$id.tsx`
   - `api.submissions.$id.confirm.tsx`
   - `api.submissions.$id.reject.tsx`

2. **Medium traffic routes:**
   - `api.my-submissions.tsx`
   - `api.my-submissions.$number.tsx`

3. **High traffic routes last:**
   - `api.submissions.tsx`
   - `api.track.tsx`

---

## Implementation Timeline

### Week 1: Observability (Phase A)

| Day | Task | Files |
|-----|------|-------|
| 1 | Add tracing to submission creation | `submissions.server.ts` |
| 1 | Add tracing to workflow transitions | `workflow.server.ts` |
| 2 | Replace console.log with structured logger | All lib files |
| 3 | Add request tracing to API routes | Route files |
| 4 | Test and verify logs in staging | - |
| 5 | Deploy to production, monitor | - |

### Week 2: Resilience (Phase B)

| Day | Task | Files |
|-----|------|-------|
| 1 | Circuit breaker on Royal Mail | `royalMailApi.server.ts` |
| 2 | Circuit breaker on Shopify Admin | `app-proxy.server.ts`, `payouts.server.ts` |
| 3 | Circuit breaker on email | `notifications.server.ts` |
| 4 | DB retry on critical operations | `submissions.server.ts`, `workflow.server.ts` |
| 5 | Test failure scenarios, deploy | - |

### Week 3: Control & Polish (Phase C + D)

| Day | Task | Files |
|-----|------|-------|
| 1-2 | Wire up feature flags | Various |
| 3-4 | Migrate auth to middleware | Route files |
| 5 | Final testing, documentation | - |

---

## Risk Mitigation

### Circuit Breaker Risks

| Risk | Mitigation |
|------|------------|
| Opens too aggressively | Set `failureThreshold: 5` initially, tune down |
| Stays open too long | Set `resetTimeoutMs: 30000` initially, tune up |
| Fallback causes data loss | Only use fallbacks for non-critical paths |

### DB Retry Risks

| Risk | Mitigation |
|------|------------|
| Retrying non-idempotent ops | Only wrap idempotent operations or add idempotency keys |
| Excessive retries | Cap at 3 retries, use exponential backoff |
| Masking real issues | Log every retry, alert on high retry rates |

### Feature Flag Risks

| Risk | Mitigation |
|------|------------|
| Cache stale flags | 5-minute TTL is reasonable, can invalidate manually |
| Wrong default | Defaults match current behavior (no change if flag missing) |

---

## Testing Checklist

### Observability Tests
- [ ] Trace IDs appear in logs
- [ ] Trace IDs included in error responses
- [ ] Metrics increment correctly
- [ ] Log levels filter appropriately

### Circuit Breaker Tests
- [ ] Circuit opens after N failures
- [ ] Circuit enters HALF_OPEN after timeout
- [ ] Circuit closes after successful request in HALF_OPEN
- [ ] Fallbacks execute when circuit open
- [ ] Alert fires when circuit opens

### DB Retry Tests
- [ ] Retries on connection errors
- [ ] Does NOT retry on business errors
- [ ] Backoff increases with each retry
- [ ] Succeeds after transient failure

### Feature Flag Tests
- [ ] Env var overrides database
- [ ] Cache invalidates correctly
- [ ] Sync method uses cached value
- [ ] Default values apply when no override

---

## Monitoring & Alerting

### Metrics to Track

```typescript
// Circuit breaker health
metrics.gauge("circuit.royal_mail.state", stateToNumber(state));
metrics.increment("circuit.royal_mail.opened");
metrics.increment("circuit.royal_mail.closed");

// DB resilience
metrics.increment("db.retry.attempt");
metrics.increment("db.retry.success");
metrics.increment("db.retry.exhausted");
metrics.timing("db.retry.total_time", totalMs);

// Feature flags
metrics.gauge("flags.enabled.count", enabledCount);
```

### Alerts to Configure

| Alert | Condition | Severity |
|-------|-----------|----------|
| Circuit breaker opened | Any circuit → OPEN | Warning |
| Circuit stayed open 10min | Circuit OPEN > 10min | Critical |
| High DB retry rate | >10% operations retrying | Warning |
| DB retries exhausted | Any exhausted | Critical |

---

## Success Criteria

### Phase A Complete When:
- [ ] All critical paths have trace IDs
- [ ] Structured logs in all lib files
- [ ] Can correlate errors to specific requests

### Phase B Complete When:
- [ ] All external APIs protected by circuit breakers
- [ ] Critical DB operations have retry logic
- [ ] System degrades gracefully under failure

### Phase C Complete When:
- [ ] Royal Mail can be toggled without deployment
- [ ] Price freshness blocking can be enabled per-shop
- [ ] Debug logging toggleable in production

### Phase D Complete When:
- [ ] At least 3 routes migrated to middleware pattern
- [ ] No auth-related code duplication in migrated routes

---

## Appendix: File Change Summary

| File | Changes |
|------|---------|
| `lib/submissions.server.ts` | +tracing, +db-retry, +structured-logging |
| `lib/workflow.server.ts` | +tracing, +db-retry, +structured-logging |
| `lib/payouts.server.ts` | +circuit-breaker, +db-retry, +tracing |
| `lib/notifications.server.ts` | +circuit-breaker, +structured-logging |
| `lib/shipping.server.ts` | +feature-flag, +tracing |
| `lib/app-proxy.server.ts` | +circuit-breaker, +structured-logging |
| `services/royalMailApi.server.ts` | +circuit-breaker, +tracing |
| `routes/api.submissions.tsx` | +feature-flag, +request-tracing |
| `routes/api.my-submissions.tsx` | +middleware-auth |
| `routes/api.shipping.label.$id.tsx` | +middleware-auth |

---

*Last updated: 2026-01-03*
