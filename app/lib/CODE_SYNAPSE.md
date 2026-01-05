# Cardforum Library Synapse Hub

> **Purpose:** Central reference for understanding how lib modules connect
> **See Also:** [TRADE_IN_SYSTEM_SYNAPSE.md](../../docs/TRADE_IN_SYSTEM_SYNAPSE.md) for full system architecture

---

## Module Dependency Graph

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         LIB MODULE DEPENDENCIES                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────────┐         ┌──────────────────┐                         │
│  │   constants.ts   │◄────────│  ALL MODULES     │  (universal import)     │
│  └──────────────────┘         └──────────────────┘                         │
│           │                                                                 │
│           ▼                                                                 │
│  ┌──────────────────┐         ┌──────────────────┐                         │
│  │  settings.server │◄────────│ submissions.server│                        │
│  │    .ts           │         │    .ts            │                        │
│  └──────────────────┘         └─────────┬────────┘                         │
│                                         │                                   │
│                    ┌────────────────────┼────────────────────┐             │
│                    │                    │                    │             │
│                    ▼                    ▼                    ▼             │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐         │
│  │ shipping.server  │  │ notifications    │  │ payouts.server   │         │
│  │    .ts           │  │   .server.ts     │  │    .ts           │         │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘         │
│                                                                             │
│  ┌──────────────────┐         ┌──────────────────┐                         │
│  │ workflow.server  │◄────────│ Status transition │ (should be imported   │
│  │    .ts           │         │ validation        │  by action routes)    │
│  └──────────────────┘         └──────────────────┘                         │
│                                                                             │
│  ┌──────────────────┐         ┌──────────────────┐                         │
│  │ app-proxy.server │◄────────│ ALL customer-    │  (auth layer)          │
│  │    .ts           │         │ facing routes    │                         │
│  └──────────────────┘         └──────────────────┘                         │
│                                                                             │
│  ┌──────────────────┐         ┌──────────────────┐                         │
│  │ idempotency      │◄────────│ api.submissions  │  (duplicate prevention)│
│  │   .server.ts     │         │    .tsx          │                         │
│  └──────────────────┘         └──────────────────┘                         │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Core Modules Reference

### 1. submissions.server.ts
**Purpose:** Core CRUD operations for trade-in submissions

| Export | Used By | Purpose |
|--------|---------|---------|
| `createSubmission()` | api.submissions.tsx | Create new submission with items |
| `getOrCreateCustomer()` | api.submissions.tsx, app-proxy.server.ts | Link guest → Shopify customer |
| `getSubmissionByNumber()` | api.track.tsx, api.packing-slip | Fetch by TRD-XXXXXX-XXXXX |
| `formatSubmissionForResponse()` | Multiple routes | Consistent API response format |
| `calculateSubmissionTotals()` | Internal | Price calculations |

**Imports:**
- `constants.ts` - Status enums, item status
- `settings.server.ts` - Condition multipliers, thresholds
- `prisma.server.ts` - Database client

**Cross-references:**
- Routes: `api.submissions.tsx:45`, `api.my-submissions.tsx:23`, `api.track.tsx:18`
- Extensions: `trade-in-account/src/api/client.ts` (consumes API)

---

### 2. app-proxy.server.ts
**Purpose:** Authentication layer for all customer-facing endpoints

| Export | Used By | Purpose |
|--------|---------|---------|
| `validateAppProxy()` | api.storefront.$.tsx | HMAC signature validation |
| `requireAppProxy()` | Customer routes | Throws if invalid signature |
| `requireCustomer()` | api.my-submissions.tsx | Auth + customer lookup/create |
| `validateSessionToken()` | Internal | JWT validation for extensions |
| `getShopifyCustomerEmail()` | Internal | Fetch email from Admin API |

**Authentication Methods:**
1. **App Proxy** - HMAC signature from Shopify proxy
2. **Session Token** - JWT from Customer Account UI Extensions

**Cross-references:**
- Routes: ALL routes in `api.storefront.$.tsx` routing table
- Extensions: `trade-in-account/src/hooks/useSessionToken.ts`
- Docs: `docs/MY_SUBMISSIONS_FLOW_INVESTIGATION.md`

---

### 3. workflow.server.ts
**Purpose:** State machine for submission status transitions

| Export | Used By | Purpose |
|--------|---------|---------|
| `canTransition()` | Action routes | Validate status change allowed |
| `getNextStatuses()` | Admin UI | Available transitions |
| `WORKFLOW_TRANSITIONS` | Reference | Full state machine definition |

**Status Flow:**
```
DRAFT → SUBMITTED → RECEIVED → GRADING → GRADED → CUSTOMER_REVIEW
                                              ↓
                              CONFIRMED → PAYMENT_PENDING → COMPLETED
                              REJECTED → RETURNED/DISPOSED
```

**Should be imported by (currently missing):**
- `api.submissions.$id.confirm.tsx`
- `api.submissions.$id.reject.tsx`
- `api.my-submissions.$number.action.tsx`

---

### 4. shipping.server.ts
**Purpose:** Royal Mail API integration for shipping labels

| Export | Used By | Purpose |
|--------|---------|---------|
| `generateShippingLabel()` | api.submissions.tsx | Create prepaid return label |
| `getShippingStatus()` | api.track.tsx | Tracking updates |
| `getShippingSettings()` | Multiple | Fetch from settings |

**External Dependencies:**
- `services/royalMailApi.server.ts` - Click & Drop API client

**Cross-references:**
- Docs: `docs/royal-mail-implementation-plan.md`
- Docs: `docs/royal-mail-integration-research.md`

---

### 5. notifications.server.ts
**Purpose:** Email notifications for submission events

| Export | Used By | Purpose |
|--------|---------|---------|
| `sendSubmissionConfirmation()` | api.submissions.tsx | New submission email |
| `sendGradingComplete()` | Admin action | Grading results email |
| `sendPayoutComplete()` | Payout action | Payment confirmation |

**Triggers (when to call):**
1. After `createSubmission()` succeeds
2. After status → GRADED
3. After status → COMPLETED

---

### 6. payouts.server.ts
**Purpose:** Payment processing for completed submissions

| Export | Used By | Purpose |
|--------|---------|---------|
| `createPayout()` | Admin action | Create payout record |
| `processPayout()` | Cron/manual | Execute payment |
| `getPayoutMethods()` | api.settings | Available payment options |

**Cross-references:**
- Schema: `Payout` model links to `Customer` and `TradeInSubmission`

---

### 7. idempotency.server.ts
**Purpose:** Prevent duplicate submissions from network retries

| Export | Used By | Purpose |
|--------|---------|---------|
| `checkIdempotency()` | api.submissions.tsx | Check for duplicate key |
| `storeIdempotencyResponse()` | api.submissions.tsx | Cache successful response |
| `generateContentHash()` | api.submissions.tsx | Hash cart for duplicate detection |

**Cleanup:**
- Cron: `api.cron.cleanup.tsx` removes expired records daily

---

### 8. settings.server.ts
**Purpose:** App configuration and merchant settings

| Export | Used By | Purpose |
|--------|---------|---------|
| `getSettings()` | Multiple | All settings with caching |
| `getConditionMultipliers()` | submissions.server | Price adjustments |
| `getShippingSettings()` | shipping.server | Address, thresholds |

**Caching:**
- 5-minute TTL in `submissions.server.ts` via `settingsCache`

---

## Route → Lib Mapping

| Route | Primary Libs Used |
|-------|-------------------|
| `api.submissions.tsx` | submissions, idempotency, shipping, notifications |
| `api.my-submissions.tsx` | app-proxy, constants |
| `api.my-submissions.$number.action.tsx` | app-proxy, constants, (should use workflow) |
| `api.track.tsx` | app-proxy, submissions |
| `api.storefront.$.tsx` | app-proxy (validation only, routes to others) |
| `api.packing-slip.$number.tsx` | submissions |
| `api.shipping-instructions.$number.tsx` | submissions, settings |
| `api.cards.search.tsx` | prisma directly |
| `api.cron.cleanup.tsx` | idempotency |

---

## Extension → Route Mapping

| Extension Component | Routes Called | Lib Dependencies |
|--------------------|---------------|------------------|
| `TradeInPage.tsx` | my-submissions | app-proxy (session token) |
| `SubmissionDetail.tsx` | my-submissions.$number | app-proxy |
| `client.ts` | All my-submissions/* | app-proxy (auth header) |

---

## Quick Reference Commands

```bash
# Find all imports of a module
grep -r "from.*submissions.server" app/routes/

# Find all exports from a module
grep "^export" app/lib/submissions.server.ts

# Check which routes use app-proxy
grep -l "requireCustomer\|requireAppProxy" app/routes/*.tsx
```

---

## Infrastructure & Resilience Modules (Added 2026-01-02)

### circuit-breaker.server.ts
**Purpose:** Protect external API calls from cascading failures

| Export | Purpose |
|--------|---------|
| `CircuitBreaker` | Class for wrapping API calls with failure detection |
| `getCircuitBreaker()` | Get or create a named circuit breaker |
| `royalMailCircuitBreaker` | Pre-configured breaker for Royal Mail API |
| `shopifyAdminCircuitBreaker` | Pre-configured breaker for Shopify Admin API |
| `emailCircuitBreaker` | Pre-configured breaker for email service |

### db-resilience.server.ts
**Purpose:** Database connection retry logic with exponential backoff

| Export | Purpose |
|--------|---------|
| `withDbRetry()` | Wrap DB operations with retry logic |
| `isRetryableDbError()` | Check if error is transient connection issue |
| `checkDbHealth()` | Health check for database connectivity |

### feature-flags.server.ts
**Purpose:** Control features without deployment

| Export | Purpose |
|--------|---------|
| `getFeatureFlags()` | Get all flags for a shop |
| `isFeatureEnabled()` | Check single flag (async) |
| `isFeatureEnabledSync()` | Check flag using cache only (sync) |
| `invalidateFeatureFlagsCache()` | Clear flag cache |

### observability.server.ts
**Purpose:** Structured logging, tracing, and metrics

| Export | Purpose |
|--------|---------|
| `withTrace()` | Wrap operations with tracing |
| `logger` | Structured logger (debug/info/warn/error) |
| `metrics` | In-memory metrics collector |
| `getRequestTraceId()` | Extract trace ID from request |

### settings.server.ts (Enhanced)
**Caching Added:** Global in-memory cache with 5-minute TTL

| Export | Purpose |
|--------|---------|
| `invalidateSettingsCache()` | Clear settings cache after updates |

---

## Middleware Layer (app/middleware/)

### auth.server.ts
**Purpose:** Higher-order functions for route authentication

| Export | Purpose |
|--------|---------|
| `withRequiredCustomer()` | Wrap loader requiring authenticated customer |
| `withOptionalCustomer()` | Wrap loader with optional customer context |
| `withAppProxy()` | Wrap loader requiring valid App Proxy signature |

---

## Integration Planning

For detailed integration plan of infrastructure modules into production code, see:
**[INFRASTRUCTURE_INTEGRATION_PLAN.md](../../docs/INFRASTRUCTURE_INTEGRATION_PLAN.md)**

This plan covers:
- Circuit breaker integration points (Royal Mail, Shopify Admin, Email)
- Database resilience wrapping strategy
- Observability instrumentation locations
- Feature flag wiring
- Auth middleware migration path

---

*Last updated: 2026-01-03*
