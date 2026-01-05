# Cardforum Routes Synapse Hub

> **Purpose:** Central reference for API route relationships and request flow
> **See Also:** [CODE_SYNAPSE.md](../lib/CODE_SYNAPSE.md) for lib module dependencies
> **See Also:** [TRADE_IN_SYSTEM_SYNAPSE.md](../../docs/TRADE_IN_SYSTEM_SYNAPSE.md) for full system architecture

---

## App Proxy Routing Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     SHOPIFY APP PROXY REQUEST FLOW                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Customer Browser                                                           │
│       │                                                                     │
│       │ GET/POST /apps/trade-in/*                                          │
│       ▼                                                                     │
│  ┌─────────────────┐                                                        │
│  │ Shopify Proxy   │ Adds: shop, timestamp, signature, logged_in_customer_id│
│  └────────┬────────┘                                                        │
│           │                                                                 │
│           │ Proxied to: https://cardforum.vercel.app/api/storefront/*      │
│           ▼                                                                 │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                   api.storefront.$.tsx (Splat Route)                 │   │
│  │                                                                      │   │
│  │  1. validateAppProxy(request) - HMAC signature check                │   │
│  │  2. matchRoute(path, method) - Route matching                       │   │
│  │  3. handler(request) - Execute matched route                        │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Route Table (api.storefront.$.tsx)

| Path Pattern | Method | Handler | Auth Required | Purpose |
|--------------|--------|---------|---------------|---------|
| `/cards/search` | GET | cardsSearchLoader | No | Quick card search |
| `/cards/browse` | GET | cardsBrowseLoader | No | Paginated browse |
| `/cards/sets` | GET | cardsSetsLoader | No | Set filter options |
| `/cards/games` | GET | cardsGamesLoader | No | Game filter options |
| `/cards/languages` | GET | cardsLanguagesLoader | No | Language filter options |
| `/submissions` | POST | submissionsAction | No* | Create submission |
| `/submissions` | GET | submissionsLoader | No | List (admin) |
| `/track` | GET | trackLoader | No | Track by number |
| `/settings` | GET | settingsPublicLoader | No | Public settings |
| `/my-submissions` | GET | mySubmissionsLoader | **Yes** | Customer's submissions |
| `/my-submissions/:number` | GET | mySubmissionDetailLoader | **Yes** | Single submission |
| `/my-submissions/:number/action` | POST | mySubmissionActionHandler | **Yes** | Customer actions |
| `/packing-slip/:number` | GET | packingSlipLoader | No | PDF download |
| `/shipping-instructions/:number` | GET | shippingInstructionsLoader | No | Shipping info |

*Submissions POST captures customer ID if logged in but doesn't require it

---

## Customer-Authenticated Routes

These routes require `requireCustomer()` from `app-proxy.server.ts`:

### api.my-submissions.tsx
```typescript
// Synapse: Imports
import { requireCustomer } from "~/lib/app-proxy.server";  // Auth
import { SUBMISSION_STATUS } from "~/lib/constants";       // Status enums

// Synapse: Called by
// - trade-in-account extension: TradeInPage.tsx
// - Theme block: my-submissions.liquid → trade-in-account.js

// Synapse: Returns
// { submissions: [], stats: {}, pagination: {} }
```

### api.my-submissions.$number.tsx
```typescript
// Synapse: Called by
// - trade-in-account extension: SubmissionDetail.tsx
// - Returns full submission with items for modal view
```

### api.my-submissions.$number.action.tsx
```typescript
// Synapse: Actions supported
// - cancel: Cancel pending submission
// - confirm: Accept grading results
// - reject: Dispute grading results

// Synapse: Should import (missing)
// import { canTransition } from "~/lib/workflow.server";
```

---

## Submission Flow Routes

### api.submissions.tsx (POST - Create)
```typescript
// Synapse: Full flow
// 1. checkIdempotency() - Duplicate check
// 2. getOrCreateCustomer() - Customer record
// 3. createSubmission() - DB insert
// 4. generateShippingLabel() - Royal Mail (if eligible)
// 5. sendSubmissionConfirmation() - Email
// 6. storeIdempotencyResponse() - Cache response

// Synapse: Called by
// - Theme: trade-in-app.js → POST /apps/trade-in/submissions

// Synapse: Returns
// { success: true, submission: { submissionNumber, ... } }
```

### api.track.tsx
```typescript
// Synapse: Called by
// - Theme: trade-in-track.js → GET /apps/trade-in/track?number=XXX

// Synapse: Returns
// { submission: { status, items, timeline, ... } }
```

---

## Card Search Routes

### api.cards.search.tsx
```typescript
// Synapse: Called by
// - Theme: trade-in-app.js search input

// Synapse: Database
// - Queries CardPriceV2 table directly
// - Returns: { results: [{ id, cardName, prices, ... }] }
```

### api.cards.browse.tsx
```typescript
// Synapse: Called by
// - Theme: trade-in-app.js browse grid

// Synapse: Filters
// - game, language, set (from filter dropdowns)
// - Pagination: page, limit
```

---

## Admin Routes (Not Proxied)

These routes are accessed directly, not through App Proxy:

| Route | Purpose | Auth |
|-------|---------|------|
| `api.submissions.$id.tsx` | Get/update single submission | Admin session |
| `api.submissions.$id.confirm.tsx` | Mark confirmed by customer | Admin session |
| `api.submissions.$id.reject.tsx` | Mark rejected by customer | Admin session |
| `api.cron.cleanup.tsx` | Cleanup expired idempotency | CRON_SECRET |
| `webhooks.*.tsx` | Shopify webhooks | Webhook signature |

---

## Extension Integration Points

### Theme App Extension (trade-in-blocks)
```
blocks/my-submissions.liquid
    │
    │ Renders: [data-trade-in-account]
    │ Loads: trade-in-account.js
    │
    ▼
trade-in-account.js
    │
    │ GET /apps/trade-in/my-submissions
    │ GET /apps/trade-in/my-submissions/:number
    │ POST /apps/trade-in/my-submissions/:number/action
    │
    │ Headers: X-Customer-Email (for customer linking)
    │
    ▼
api.storefront.$.tsx → my-submissions routes
```

### Customer Account UI Extension (trade-in-account)
```
TradeInPage.tsx
    │
    │ shopify.sessionToken.get()
    │
    ▼
api/client.ts
    │
    │ Authorization: Bearer <JWT>
    │
    ▼
api.storefront.$.tsx → requireCustomer() validates JWT
```

---

## Error Response Patterns

All routes follow consistent error format:

```typescript
// 400 Bad Request
{ error: "validation_error", message: "...", details: [...] }

// 401 Unauthorized
{ error: "unauthorized", message: "Invalid request signature" }
{ error: "login_required", message: "Customer login required" }

// 404 Not Found
{ error: "not_found", message: "Submission not found" }
{ error: "customer_not_found", message: "Customer record not found" }

// 409 Conflict
{ error: "duplicate", message: "Submission already exists", submission: {...} }

// 500 Internal Error
{ error: "server_error", message: "..." }
```

---

## Request Flow Debugging

```bash
# Check route matching
curl -v "https://cardforum.vercel.app/api/storefront/my-submissions" \
  -H "X-Shopify-Shop-Domain: store.myshopify.com"

# Vercel logs
vercel logs cardforum --follow

# Filter by route
vercel logs cardforum | grep "my-submissions"
```

---

## Cross-References

| This Route | Relates To |
|------------|------------|
| api.submissions.tsx | lib/submissions.server.ts, lib/idempotency.server.ts |
| api.my-submissions.tsx | lib/app-proxy.server.ts |
| api.track.tsx | lib/submissions.server.ts |
| api.storefront.$.tsx | ALL other api.*.tsx routes |
| api.cards.*.tsx | prisma (CardPriceV2 table) |

---

*Last updated: 2026-01-02*
