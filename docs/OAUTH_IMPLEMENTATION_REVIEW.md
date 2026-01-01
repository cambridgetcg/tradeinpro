# OAuth 2.0 Implementation Review

> **Date:** 2025-12-30
> **Reference:** `/Users/alex/rewards-pro` (production-grade implementation)
> **Current:** `/Users/alex/TCG_TradeIn/cardforum`

## Executive Summary

Compared cardforum's OAuth 2.0 implementation against rewards-pro (a production-grade Shopify app). Several optimizations are recommended.

---

## Implementation Comparison

| Feature | rewards-pro | cardforum | Gap |
|---------|-------------|-----------|-----|
| **Session Token Refresh** | Auto-refresh every 4 min | No refresh | 🔴 High |
| **Shopify Validation API** | `authenticate.public.customerAccount()` | Manual JWT validation | 🟡 Medium |
| **Preview Mode Detection** | Graceful fallback | None | 🟡 Medium |
| **Token Utilities** | Dedicated module with hooks | Basic extraction | 🟡 Medium |
| **API Client Architecture** | Class-based with methods | Function-based | 🟢 Low |
| **Auto-create Customer** | Not needed (read-only) | ✅ Implemented | ✅ |
| **Dual Auth Methods** | Session Token only | App Proxy + Session Token | ✅ Better |
| **Configuration** | Centralized config.ts | Hardcoded | 🟡 Medium |

---

## rewards-pro Key Patterns

### 1. Session Token Management (Best Practice)

```typescript
// /extensions/rewards-pro-membership/src/hooks/useSessionToken.ts
const TOKEN_REFRESH_INTERVAL = 240000; // 4 minutes (tokens expire in 5 min)

function useSessionToken() {
  const { sessionToken } = useApi();
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    const fetchToken = async () => {
      const newToken = await sessionToken.get();
      setToken(newToken);
    };

    fetchToken();

    // Auto-refresh before expiration
    const interval = setInterval(fetchToken, TOKEN_REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, [sessionToken]);

  return { token, isExpired: token ? isTokenExpired(token) : true };
}
```

### 2. Shopify's Official Validation API

```typescript
// /app/routes/api.customer-account.loyalty.tsx
import { authenticate } from "../shopify.server";

export async function loader({ request }: LoaderFunctionArgs) {
  // Shopify handles JWT signature validation using app secret
  const authResult = await authenticate.public.customerAccount(request);
  const sessionToken = authResult?.sessionToken;

  // Trust validated claims directly
  const customerGid = sessionToken.sub;  // "gid://shopify/Customer/12345"
  const shop = sessionToken.dest;        // "store.myshopify.com"
}
```

### 3. Preview Mode Detection

```typescript
// Gracefully handle theme editor preview (no real customer)
const [, payloadBase64] = token.split('.');
const payload = JSON.parse(atob(payloadBase64));

if (!payload.dest || !payload.sub) {
  return json({
    enrolled: false,
    isPreview: true,
    message: "Preview mode - log in to see your membership"
  });
}
```

### 4. Token Utilities Module

```typescript
// /extensions/rewards-pro-membership/src/utils/sessionToken.ts
interface DecodedSessionToken {
  claims: SessionTokenClaims;
  token: string;
  isExpired: boolean;
  customerId: string | null;
}

export function decodeSessionToken(token: string): DecodedSessionToken;
export function getCustomerIdFromToken(token: string): string | null;
export function isTokenExpired(token: string): boolean;
export function getTokenExpiryTime(token: string): number;
```

### 5. Configuration Centralization

```typescript
// /extensions/rewards-pro-membership/src/config.ts
export const CONFIG = {
  DEBUG_MODE: false,
  API_TIMEOUT: 10000,           // 10 seconds
  TOKEN_REFRESH_INTERVAL: 240000, // 4 minutes
  API_BASE_URL: 'https://rewardspro-production.vercel.app',
};
```

---

## cardforum Current Implementation

### Strengths ✅

1. **Dual Authentication**: Supports both App Proxy AND Session Token (more flexible)
2. **Auto-create Customer**: Creates customer record on first visit
3. **Manual JWT Validation**: Works without Shopify's authenticate helper
4. **Comprehensive Error Handling**: Different error codes for different failures

### Gaps 🔴

1. **No Token Refresh**: Tokens may expire during long sessions
2. **No Preview Mode Handling**: Will error in theme editor
3. **Hardcoded Values**: No centralized configuration
4. **Basic Token Extraction**: No dedicated utilities module

---

## Recommended Optimizations

### Priority 1: Add Token Auto-Refresh (High Impact)

The Customer Account UI Extension should refresh tokens before expiration:

```typescript
// extensions/trade-in-account/src/hooks/useSessionToken.ts
import { useState, useEffect, useCallback } from 'react';

const TOKEN_REFRESH_INTERVAL = 240000; // 4 minutes

export function useSessionToken() {
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchToken = useCallback(async () => {
    try {
      // @ts-expect-error - shopify global injected by extension runtime
      if (typeof shopify !== 'undefined' && shopify.sessionToken) {
        // @ts-expect-error
        const newToken = await shopify.sessionToken.get();
        setToken(newToken);
        setError(null);
      }
    } catch (err) {
      setError('Failed to get session token');
      console.error('Session token error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchToken();

    // Auto-refresh every 4 minutes (before 5-min expiry)
    const interval = setInterval(fetchToken, TOKEN_REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchToken]);

  return { token, loading, error, refresh: fetchToken };
}
```

### Priority 2: Use Shopify's authenticate Helper (Medium Impact)

Consider using `authenticate.public.customerAccount()` instead of manual JWT validation:

```typescript
// app/routes/api.my-submissions.tsx
import { authenticate } from "../shopify.server";

export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const authResult = await authenticate.public.customerAccount(request);
    const sessionToken = authResult.sessionToken;

    // Extract customer ID from validated claims
    const customerGid = sessionToken.sub;
    const customerId = customerGid?.match(/Customer\/(\d+)/)?.[1];

    if (!customerId) {
      return json({ error: "login_required" }, { status: 401 });
    }

    // ... fetch submissions
  } catch {
    // Fall back to App Proxy validation
    return fallbackToAppProxy(request);
  }
}
```

### Priority 3: Add Preview Mode Detection (Medium Impact)

```typescript
// app/lib/app-proxy.server.ts

export function isPreviewMode(token: string): boolean {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return false;

    const payload = JSON.parse(base64UrlDecode(parts[1]));
    return !payload.dest || !payload.sub;
  } catch {
    return false;
  }
}

// In requireCustomer():
if (bearerToken && isPreviewMode(bearerToken)) {
  return json({
    submissions: [],
    stats: { total: 0, pending: 0, completed: 0, totalEarned: 0 },
    isPreview: true,
    message: "Log in to see your trade-ins"
  });
}
```

### Priority 4: Centralize Configuration (Low Impact)

```typescript
// extensions/trade-in-account/src/config.ts
export const CONFIG = {
  API_BASE: '/apps/trade-in',
  TOKEN_REFRESH_INTERVAL: 240000,  // 4 minutes
  API_TIMEOUT: 10000,              // 10 seconds
  DEBUG_MODE: process.env.NODE_ENV === 'development',
};
```

---

## Architecture Comparison Diagram

### rewards-pro (Session Token Only)
```
Customer Account Page
        │
        ▼
┌──────────────────────────┐
│ MembershipBlock.tsx      │
│ useSessionToken() hook   │◄──── Auto-refresh every 4 min
│ useApiClient()           │
└──────────┬───────────────┘
           │
           │ Authorization: Bearer <JWT>
           ▼
┌──────────────────────────┐
│ api.customer-account.    │
│ loyalty.tsx              │
│                          │
│ authenticate.public.     │◄──── Shopify validates JWT
│ customerAccount()        │
└──────────────────────────┘
```

### cardforum (Dual Auth)
```
Theme App Extension              Customer Account Extension
        │                                │
        │ App Proxy                      │ Session Token
        │ (signature + customer_id)      │ (JWT in header)
        ▼                                ▼
┌─────────────────────────────────────────────────────────┐
│              api.storefront.$.tsx                        │
│                                                          │
│ requireCustomer():                                       │
│   1. Try App Proxy validation                           │
│   2. Fall back to Session Token validation              │
│   3. Auto-create customer if needed                     │
└─────────────────────────────────────────────────────────┘
```

---

## Conclusion

cardforum's implementation is **functional but not production-optimized**. The key improvements needed are:

1. **Token auto-refresh** - Prevents session expiration during long visits
2. **Preview mode handling** - Better UX in theme editor
3. **Configuration centralization** - Easier maintenance

The dual-auth approach (App Proxy + Session Token) in cardforum is actually **more flexible** than rewards-pro, supporting both Theme Extensions and Customer Account Extensions with a single backend endpoint.

---

## Files Modified During This Review

| File | Change |
|------|--------|
| `extensions/trade-in-account/src/api/client.ts` | Added session token auth, timeout, request IDs |
| `extensions/trade-in-account/src/config.ts` | **NEW** - Centralized configuration |
| `extensions/trade-in-account/src/utils/sessionToken.ts` | **NEW** - JWT decode utilities |
| `extensions/trade-in-account/src/hooks/useSessionToken.ts` | **NEW** - Token hook with auto-refresh |
| `extensions/trade-in-account/src/TradeInPage.tsx` | Integrated useSessionToken, preview mode |
| `extensions/trade-in-account/src/components/SubmissionDetail.tsx` | Added token prop |
| `app/lib/app-proxy.server.ts` | Added JWT validation + dual auth support |
| `docs/MY_SUBMISSIONS_FLOW_INVESTIGATION.md` | Added OAuth 2.0 flow documentation |
| `docs/OAUTH_IMPLEMENTATION_REVIEW.md` | This file - comparison & recommendations |

---

## Optimizations Applied ✅

Based on the rewards-pro reference implementation, the following optimizations were applied:

### 1. Token Auto-Refresh (Priority 1) ✅

Created `useSessionToken` hook that auto-refreshes tokens every 4 minutes:

```typescript
// extensions/trade-in-account/src/hooks/useSessionToken.ts
const TOKEN_REFRESH_INTERVAL = 240000; // 4 minutes

export function useSessionToken() {
  // Initial fetch + auto-refresh interval
  useEffect(() => {
    fetchToken();
    const interval = setInterval(fetchToken, TOKEN_REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchToken]);
}
```

### 2. Preview Mode Detection (Priority 3) ✅

Added preview mode detection for theme editor:

```typescript
// extensions/trade-in-account/src/utils/sessionToken.ts
export function isPreviewMode(token: string): boolean {
  const decoded = decodeSessionToken(token);
  return !decoded?.claims.dest || !decoded?.claims.sub;
}

// TradeInPage.tsx
if (isPreview) {
  return (
    <Page title="My Trade-Ins">
      <Banner status="info">Log in to view your trade-in submissions.</Banner>
    </Page>
  );
}
```

### 3. Centralized Configuration (Priority 4) ✅

Created `config.ts` with all constants:

```typescript
export const CONFIG = {
  API_BASE: '/apps/trade-in',
  TOKEN_REFRESH_INTERVAL: 240000,
  API_TIMEOUT: 10000,
  DEBUG_MODE: false,
};
```

### 4. Token Utilities Module ✅

Created comprehensive JWT utilities:

- `decodeSessionToken()` - Decode without verification
- `getCustomerIdFromToken()` - Extract numeric ID
- `isTokenExpired()` - Check expiration
- `isPreviewMode()` - Detect theme editor

---

## Remaining Difference: Shopify Validation API

The rewards-pro app uses Shopify's built-in validation:

```typescript
const authResult = await authenticate.public.customerAccount(request);
```

Our implementation uses manual JWT validation which is functionally equivalent but slightly more verbose. This is acceptable because:

1. Our manual validation uses the same HMAC-SHA256 algorithm
2. We support dual authentication (App Proxy + Session Token)
3. The manual approach gives us more control over error handling

**Decision:** Keep manual validation for now. Consider migrating if Shopify adds new validation features.
