# Cardforum Extensions Synapse Hub

> **Purpose:** Central reference for Shopify extension integration points
> **See Also:** [TRADE_IN_SYSTEM_SYNAPSE.md](../docs/TRADE_IN_SYSTEM_SYNAPSE.md) for full system architecture
> **See Also:** [CODE_SYNAPSE.md](../app/lib/CODE_SYNAPSE.md) for backend lib relationships

---

## Extension Types Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     CARDFORUM SHOPIFY EXTENSIONS                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────┐    ┌─────────────────────────────┐        │
│  │  trade-in-account           │    │  trade-in-blocks            │        │
│  │  (Customer Account UI Ext)  │    │  (Theme App Extension)      │        │
│  └──────────────┬──────────────┘    └──────────────┬──────────────┘        │
│                 │                                   │                       │
│                 │ Session Token (JWT)              │ App Proxy (HMAC)      │
│                 │ Authorization: Bearer            │ logged_in_customer_id │
│                 ▼                                   ▼                       │
│  ┌──────────────────────────────────────────────────────────────────┐      │
│  │              app/lib/app-proxy.server.ts                          │      │
│  │              (Dual authentication support)                        │      │
│  └──────────────────────────────────────────────────────────────────┘      │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## trade-in-account (Customer Account UI Extension)

**Purpose:** Display trade-in history in Shopify's new Customer Account pages

### Files

| File | Purpose |
|------|---------|
| `src/TradeInPage.tsx` | Main page component (customer-account.page.render) |
| `src/ProfileWidget.tsx` | Profile block (customer-account.profile.block.render) |
| `src/FooterCTA.tsx` | Footer banner (customer-account.footer.render-after) |
| `src/api/client.ts` | API client with session token auth |
| `src/hooks/useSessionToken.ts` | JWT management with auto-refresh |
| `src/utils/sessionToken.ts` | JWT decode utilities |
| `src/config.ts` | Centralized configuration |
| `src/components/SubmissionDetail.tsx` | Submission detail modal |
| `src/types.ts` | TypeScript interfaces |
| `shopify.extension.toml` | Extension targets configuration |

### Authentication Flow

```
TradeInPage.tsx
      │
      │ 1. useSessionToken() hook
      ▼
useSessionToken.ts
      │
      │ 2. shopify.sessionToken.get()
      │    (Auto-refresh every 4 minutes)
      ▼
api/client.ts
      │
      │ 3. Authorization: Bearer <JWT>
      │    Timeout: 10 seconds
      ▼
/apps/trade-in/my-submissions
      │
      │ 4. App Proxy routes to Vercel
      ▼
api.storefront.$.tsx
      │
      │ 5. requireCustomer() validates JWT
      │    Extracts customer GID from 'sub' claim
      ▼
api.my-submissions.tsx
      │
      │ 6. Query submissions by internalCustomerId
      ▼
Response to extension
```

### Target Configuration (shopify.extension.toml)

```toml
[[extensions.targeting]]
target = "customer-account.page.render"
module = "./src/TradeInPage.tsx"

[[extensions.targeting]]
target = "customer-account.profile.block.render"
module = "./src/ProfileWidget.tsx"

[[extensions.targeting]]
target = "customer-account.footer.render-after"
module = "./src/FooterCTA.tsx"
```

---

## trade-in-blocks (Theme App Extension)

**Purpose:** Provide Liquid blocks for theme integration

### Files

| File | Purpose |
|------|---------|
| `blocks/my-submissions.liquid` | Customer account submissions block |
| `assets/trade-in-account.js` | Client-side logic for my-submissions |
| `assets/trade-in-account.css` | Styling for submissions display |
| `shopify.extension.toml` | Block configuration |

### Authentication Flow

```
my-submissions.liquid
      │
      │ 1. Renders in customer account page
      │    Exposes {{ customer.email }} as hidden input
      ▼
trade-in-account.js
      │
      │ 2. GET /apps/trade-in/my-submissions
      │    Header: X-Customer-Email: {{ customer.email }}
      ▼
Shopify App Proxy
      │
      │ 3. Adds: shop, timestamp, signature, logged_in_customer_id
      ▼
api.storefront.$.tsx
      │
      │ 4. validateAppProxy() checks HMAC signature
      │    requireCustomer() finds/creates customer
      ▼
api.my-submissions.tsx
      │
      │ 5. Customer linking: email header enables
      │    guest submission → account merge
      ▼
Response to theme
```

### Block Configuration (shopify.extension.toml)

```toml
[[extensions.blocks]]
type = "page"
name = "My Trade-Ins"
directory = "blocks"
file = "my-submissions.liquid"
theme_support = true
```

---

## Backend Integration Points

### Routes Called by Extensions

| Extension | Endpoint | Route File |
|-----------|----------|------------|
| trade-in-account | GET /my-submissions | api.my-submissions.tsx |
| trade-in-account | GET /my-submissions/:number | api.my-submissions.$number.tsx |
| trade-in-account | POST /my-submissions/:number/action | api.my-submissions.$number.action.tsx |
| trade-in-blocks | GET /my-submissions | api.my-submissions.tsx |
| trade-in-blocks | GET /my-submissions/:number | api.my-submissions.$number.tsx |
| trade-in-blocks | POST /my-submissions/:number/action | api.my-submissions.$number.action.tsx |

### Auth Validation (app-proxy.server.ts)

```typescript
// Session Token (JWT) - for trade-in-account extension
validateSessionToken(token: string): SessionTokenClaims | null

// App Proxy (HMAC) - for trade-in-blocks extension
validateAppProxy(request: Request): AppProxyContext

// Combined - tries both, auto-creates customer
requireCustomer(request: Request): AppProxyContextWithCustomer
```

---

## Data Contracts

### GET /my-submissions Response

```typescript
interface SubmissionsResponse {
  submissions: Submission[];
  stats: {
    total: number;
    pending: number;
    completed: number;
    totalEarned: number;
  };
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasMore: boolean;
  };
}
```

### Submission Actions (POST /my-submissions/:number/action)

```typescript
type Action = 'cancel' | 'confirm' | 'reject';

// Request
{ action: Action }

// Response
{ success: boolean, submission?: Submission, error?: string }
```

---

## Development & Debugging

### Dev Server

```bash
# Run extension dev server
cd cardforum
shopify app dev

# Extension preview URL appears in console
# Test in customer account: /account
```

### Debug Logging

```typescript
// In extensions, use console.log
// Visible in browser DevTools when previewing

// In backend, logs go to Vercel
vercel logs cardforum --follow | grep "my-submissions"
```

### Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| "Failed to load submissions" | Customer record not found | Check customer linking logic |
| "Invalid signature" | HMAC mismatch | Verify SHOPIFY_API_SECRET env var |
| "Token expired" | JWT > 5 minutes old | Check useSessionToken auto-refresh |
| CORS errors | CSP in Customer Account | Use full shop URL, not relative |

---

## Related Documentation

| Document | Purpose |
|----------|---------|
| `docs/customer-account-extension-design.md` | UI design guidelines |
| `docs/MY_SUBMISSIONS_FLOW_INVESTIGATION.md` | Auth flow details |
| `docs/OAUTH_IMPLEMENTATION_REVIEW.md` | JWT implementation |
| `docs/trade-in-history-extension-analysis.md` | Customer linking fix |

---

*Last updated: 2026-01-02*
