# My Trade-Ins Page - Investigation & Flow Analysis

> **Date:** 2025-12-30
> **Issue:** "Failed to load submissions" on My Trade-Ins page
> **Updated:** OAuth 2.0 Session Token support added

> **Central Reference:** See [TRADE_IN_SYSTEM_SYNAPSE.md](./TRADE_IN_SYSTEM_SYNAPSE.md) for the complete system architecture, weak links, and unhandled scenarios across both frontend and backend.

## Executive Summary

The "My Trade-Ins" page supports **two authentication methods**:

1. **App Proxy** - Traditional method using HMAC signature and `logged_in_customer_id` query parameter
2. **Session Token (OAuth 2.0)** - JWT-based auth for Customer Account UI Extensions

### Authentication Methods

| Method | Use Case | How It Works |
|--------|----------|--------------|
| **App Proxy** | Theme App Extension (`my-submissions.liquid`) | Shopify adds signature + customer ID to requests |
| **Session Token** | Customer Account UI Extension | JWT with customer GID in `sub` claim |

The backend (`app/lib/app-proxy.server.ts`) now supports both methods, trying App Proxy first and falling back to Session Token if Authorization header is present.

### Previous Issues (Resolved)

1. ~~**Customer record not linked**~~ - Fixed: Auto-create customer on first visit
2. **App Proxy signature validation failing** - Check `SHOPIFY_API_SECRET` env var
3. **Route not matching** - Verify app proxy config in `shopify.app.toml`

---

## OAuth 2.0 Session Token Flow (Customer Account UI Extensions)

```
┌─────────────────────────────────────────────────────────────────────┐
│               CUSTOMER ACCOUNT PAGE (New Shopify UI)                │
│  Extension: trade-in-account (customer-account.page.render)         │
│  Component: TradeInPage.tsx                                         │
└───────────────────────────┬─────────────────────────────────────────┘
                            │
                            │ 1. shopify.sessionToken.get()
                            │    Returns JWT with customer identity
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       API CLIENT                                     │
│  File: extensions/trade-in-account/src/api/client.ts                │
│                                                                      │
│  authenticatedFetch() adds:                                          │
│    Authorization: Bearer <session_token>                             │
└───────────────────────────┬─────────────────────────────────────────┘
                            │
                            │ GET /apps/trade-in/my-submissions
                            │   + Authorization: Bearer <JWT>
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│           BACKEND: app/lib/app-proxy.server.ts                       │
│                                                                      │
│  requireCustomer(request):                                           │
│    1. Try App Proxy validation (logged_in_customer_id)              │
│    2. If no App Proxy, extract Bearer token                         │
│    3. validateSessionToken(token):                                  │
│       - Verify HMAC-SHA256 signature with SHOPIFY_API_SECRET        │
│       - Check audience matches SHOPIFY_API_KEY                      │
│       - Validate exp/nbf timestamps                                  │
│       - Extract customer ID from 'sub' claim                        │
│    4. Find/create customer record                                    │
└─────────────────────────────────────────────────────────────────────┘
```

### Session Token Claims

```json
{
  "dest": "store-name.myshopify.com",     // Shop domain
  "aud": "5557b953bcda2461a34b606d9e8cf170", // App Client ID
  "exp": 1679954053,                       // Expiration (5 min TTL)
  "nbf": 1679953753,                       // Not before
  "iat": 1679953753,                       // Issued at
  "jti": "6c992878-...",                   // Nonce (replay prevention)
  "sub": "gid://shopify/Customer/12345"   // Customer GID (if logged in)
}
```

---

## Complete Data Flow (App Proxy - Theme Extension)

```
┌─────────────────────────────────────────────────────────────────────┐
│                     CUSTOMER BROWSER                                 │
│  URL: https://{shop}.myshopify.com/account                          │
│  Block: my-submissions.liquid                                       │
│  JS: trade-in-account.js                                            │
└───────────────────────────┬─────────────────────────────────────────┘
                            │
                            │ GET /apps/trade-in/my-submissions
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│                   SHOPIFY APP PROXY                                  │
│  Config: shopify.app.toml                                           │
│  [app_proxy]                                                         │
│    url = "/api/storefront"                                          │
│    prefix = "apps"                                                   │
│    subpath = "trade-in"                                             │
│                                                                      │
│  Transforms: /apps/trade-in/* → /api/storefront/*                   │
│  Adds params: shop, timestamp, signature, logged_in_customer_id     │
└───────────────────────────┬─────────────────────────────────────────┘
                            │
                            │ GET /api/storefront/my-submissions
                            │    ?shop=myshop.myshopify.com
                            │    &timestamp=1735500000
                            │    &signature=abc123...
                            │    &logged_in_customer_id=12345
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│           BACKEND: api.storefront.$.tsx (Splat Route)               │
│                                                                      │
│  1. validateAppProxy(request)                                        │
│     - Extracts: signature, timestamp, shop, logged_in_customer_id   │
│     - Validates timestamp within 5 minutes                          │
│     - Computes HMAC-SHA256 using SHOPIFY_API_SECRET                 │
│     - Compares signatures (timing-safe)                              │
│                                                                      │
│  2. matchRoute("my-submissions", "GET")                             │
│     - Returns: { handler: mySubmissionsLoader }                     │
│                                                                      │
│  3. Calls mySubmissionsLoader(args)                                 │
└───────────────────────────┬─────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│           BACKEND: api.my-submissions.tsx (Loader)                   │
│                                                                      │
│  1. requireCustomer(request)                                         │
│     ├─ requireAppProxy(request)  ← validates signature              │
│     │   └─ Throws 401 if signature invalid                          │
│     │                                                                │
│     ├─ Check logged_in_customer_id exists                           │
│     │   └─ Throws 401 "login_required" if missing                   │
│     │                                                                │
│     └─ findCustomerByShopifyId(logged_in_customer_id)               │
│         └─ Throws 404 "customer_not_found" if not in DB ⚠️          │
│                                                                      │
│  2. Query submissions from database                                  │
│     WHERE customerId = internalCustomerId                           │
│     AND status NOT IN ('DRAFT')                                      │
│                                                                      │
│  3. Return JSON response                                             │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Potential Failure Points

### 1. Customer Record Not Linked (MOST LIKELY)

**Problem:** When a customer logs into Shopify, the App Proxy sends `logged_in_customer_id` (Shopify's customer ID). Our backend looks for a matching record in the `Customer` table where `shopifyCustomerId = logged_in_customer_id`.

**If no record exists:** 404 "customer_not_found" error

**Why this happens:**
- Customer was created in Shopify but never submitted a trade-in
- Customer record exists but `shopifyCustomerId` field is NULL
- Customer submitted trade-in before logging in (email-based, no Shopify ID link)

**Solution:** Create or link customer records when they first access the page.

### 2. App Proxy Signature Validation Failing

**Problem:** `SHOPIFY_API_SECRET` env var missing or incorrect

**Symptoms:**
- 401 "unauthorized" - "Invalid request signature"
- All requests fail, not just for specific customers

**Check:** Verify `SHOPIFY_API_SECRET` in Vercel environment variables

### 3. App Proxy Not Configured

**Problem:** Shopify isn't routing requests through the app proxy

**Symptoms:**
- Requests go directly to `/apps/trade-in/my-submissions` on Shopify
- 404 from Shopify (not your app)

**Check:** Run `shopify app deploy` to sync app proxy config

### 4. Customer Not Logged In

**Problem:** Customer viewing page without being logged in

**Symptoms:**
- 401 "login_required" error
- Should show guest view (my-submissions.liquid handles this)

**Check:** Verify `{% if customer %}` condition in Liquid

---

## Key Files

### Theme App Extension (App Proxy Auth)

| File | Purpose |
|------|---------|
| `extensions/trade-in-blocks/blocks/my-submissions.liquid` | Theme block template |
| `extensions/trade-in-blocks/assets/trade-in-account.js` | Client-side API calls |
| `extensions/trade-in-blocks/assets/trade-in-account.css` | Sleek theme styling |

### Customer Account UI Extension (Session Token Auth)

| File | Purpose |
|------|---------|
| `extensions/trade-in-account/src/TradeInPage.tsx` | Main page component |
| `extensions/trade-in-account/src/api/client.ts` | API client with session token auth |
| `extensions/trade-in-account/shopify.extension.toml` | Extension targets config |

### Backend (Shared)

| File | Purpose |
|------|---------|
| `app/routes/api.storefront.$.tsx` | Splat route handler |
| `app/routes/api.my-submissions.tsx` | List submissions endpoint |
| `app/lib/app-proxy.server.ts` | App Proxy + Session Token validation |
| `shopify.app.toml` | App proxy configuration |

---

## API Endpoint Details

### GET /apps/trade-in/my-submissions

**Internal Route:** `api.storefront.$.tsx` → `api.my-submissions.tsx`

**Query Parameters:**
- `page` (default: 1) - Pagination
- `limit` (default: 20, max: 50) - Items per page
- `status` - Filter: "all", "pending", "completed"

**Response:**
```json
{
  "submissions": [
    {
      "id": "cuid",
      "submissionNumber": "TI-20251230-XXXX",
      "status": "SUBMITTED",
      "statusLabel": "Submitted",
      "itemCount": 5,
      "quotedTotal": 2500,
      "finalTotal": null,
      "payoutType": "STORE_CREDIT",
      "payoutTypeLabel": "Store Credit",
      "createdAt": "2025-12-30T10:00:00Z",
      "submittedAt": "2025-12-30T10:05:00Z",
      "completedAt": null,
      "canDownloadPackingSlip": true,
      "canViewShippingInstructions": true,
      "needsReview": false,
      "isComplete": false
    }
  ],
  "stats": {
    "total": 5,
    "pending": 2,
    "completed": 3,
    "totalEarned": 15000
  },
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 5,
    "totalPages": 1,
    "hasMore": false
  }
}
```

**Error Responses:**
- `401` - `{"error": "unauthorized", "message": "Invalid request signature"}`
- `401` - `{"error": "login_required", "message": "Customer login required"}`
- `404` - `{"error": "customer_not_found", "message": "Customer record not found"}`
- `500` - `{"error": "fetch_failed", "message": "Failed to load submissions"}`

---

## Database Schema

### Customer Table
```prisma
model Customer {
  id                String   @id @default(cuid())
  shopifyCustomerId String?  @unique  // ← CRITICAL: Must match Shopify ID
  email             String
  firstName         String?
  lastName          String?
  ...
  submissions       TradeInSubmission[]
}
```

### TradeInSubmission Table
```prisma
model TradeInSubmission {
  id               String   @id @default(cuid())
  submissionNumber String   @unique
  customerId       String   // Foreign key to Customer.id
  status           String   @default("DRAFT")
  ...

  @@index([customerId])
  @@index([customerId, status])
}
```

---

## Debugging Steps

### 1. Check Browser Console
Open browser DevTools → Network tab → Look for `/apps/trade-in/my-submissions` request
- What status code? (401, 404, 500?)
- What's the error message in response body?

### 2. Check Server Logs (Vercel)
```bash
vercel logs cardforum --follow
```
Look for:
- "App Proxy signature mismatch"
- "Customer record not found"
- "Error fetching customer submissions"

### 3. Verify Customer Record Exists
```sql
SELECT id, "shopifyCustomerId", email, "firstName"
FROM "Customer"
WHERE "shopifyCustomerId" = '{logged_in_customer_id}';
```

### 4. Test API Directly (Dev Only)
In development, bypass auth with test customer ID:
```bash
curl "http://localhost:3000/api/storefront/my-submissions?_test_customer_id={internal_customer_id}"
```

### 5. Check App Proxy Config
```bash
# In project directory
shopify app info
# Verify app proxy settings
```

---

## Recommended Fixes

### Fix 1: Auto-Create Customer Record

When `requireCustomer` fails with "customer_not_found", create the customer:

```typescript
// In app/lib/app-proxy.server.ts

export async function requireCustomer(request: Request): Promise<AppProxyContextWithCustomer> {
  const context = requireAppProxy(request);

  if (!context.customerId) {
    throw new Response(
      JSON.stringify({ error: "login_required", message: "Customer login required" }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }

  // Find or create customer record
  let customer = await findCustomerByShopifyId(context.customerId);

  if (!customer) {
    // Auto-create customer record
    customer = await prisma.customer.create({
      data: {
        shopifyCustomerId: context.customerId,
        email: `customer-${context.customerId}@placeholder.local`, // Placeholder
      },
    });
  }

  return {
    ...context,
    customerId: context.customerId,
    internalCustomerId: customer.id,
  };
}
```

### Fix 2: Link Existing Customers by Email

If customer exists by email but missing Shopify ID:

```typescript
async function findOrLinkCustomer(shopifyCustomerId: string, email?: string) {
  // Try by Shopify ID first
  let customer = await prisma.customer.findUnique({
    where: { shopifyCustomerId },
  });

  if (!customer && email) {
    // Try by email and link
    customer = await prisma.customer.findFirst({
      where: { email: email.toLowerCase() },
    });

    if (customer && !customer.shopifyCustomerId) {
      // Link existing customer
      customer = await prisma.customer.update({
        where: { id: customer.id },
        data: { shopifyCustomerId },
      });
    }
  }

  return customer;
}
```

### Fix 3: Fetch Customer Details from Shopify

Use Shopify Admin API to get customer email, then create/link:

```typescript
// This requires admin API access and is more complex
// Only needed if we need customer details like email/name
```

---

## Summary

The most likely cause of "Failed to load submissions" is **missing customer record linkage**. When a Shopify customer visits the My Trade-Ins page, their `shopifyCustomerId` must exist in our `Customer` table.

**Quick fix:** Auto-create customer records in `requireCustomer` function.

**Proper fix:** Ensure customer records are created/linked when:
1. Customer creates a trade-in submission
2. Customer first accesses the My Trade-Ins page
3. Webhook received for customer creation in Shopify
