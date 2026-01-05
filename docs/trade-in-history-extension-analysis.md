# Trade-In History Extension - Data Flow Analysis

**Date:** January 2026
**Issue:** Submitted trade-ins not showing for logged-in customers

> **Central Reference:** See [TRADE_IN_SYSTEM_SYNAPSE.md](./TRADE_IN_SYSTEM_SYNAPSE.md) for the complete system architecture, weak links, and unhandled scenarios across both frontend and backend.
>
> **Myelin Pathways:**
> - `extensions/EXTENSIONS_SYNAPSE.md` → trade-in-account.js, my-submissions.liquid
> - `app/lib/CODE_SYNAPSE.md` → app-proxy.server.ts (requireCustomer), submissions.server.ts
> - Related analysis: `MY_SUBMISSIONS_FLOW_INVESTIGATION.md`, `TRADE_IN_HISTORY_DATAFLOW.md`

---

## Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           FRONTEND (Theme Extension)                         │
│  my-submissions.liquid → trade-in-account.js                                │
│                                                                              │
│  1. Reads {{ customer.id }} from Liquid (Shopify customer ID)               │
│  2. Calls: GET /apps/trade-in/my-submissions                                │
│     - Request goes through Shopify App Proxy                                │
│     - Shopify adds: ?logged_in_customer_id=12345&signature=xxx&shop=xxx     │
└────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         APP PROXY ROUTING                                    │
│  api.storefront.$.tsx                                                        │
│                                                                              │
│  1. Validates App Proxy signature                                           │
│  2. Routes /my-submissions → mySubmissionsLoader                            │
└────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         BACKEND API                                          │
│  api.my-submissions.tsx                                                      │
│                                                                              │
│  1. Calls requireCustomer(request)                                          │
│  2. Uses context.internalCustomerId to query submissions                    │
│  3. Returns submissions for that internal customer ID                       │
└────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         CUSTOMER AUTHENTICATION                              │
│  app-proxy.server.ts → requireCustomer()                                    │
│                                                                              │
│  1. Extracts shopifyCustomerId from App Proxy params                        │
│  2. Calls findCustomerByShopifyId(shopifyCustomerId)                        │
│  3. If NOT found: AUTO-CREATES customer with placeholder email              │
│     ⚠️  THIS IS THE PROBLEM                                                 │
│  4. Returns internal customer ID                                            │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## Root Cause Analysis

### The Problem

When a customer submits a trade-in as a **guest** (not logged into their Shopify account), then later logs in to view "My Trade-Ins", the submissions don't appear.

### Why It Happens

**Scenario:**
1. **Guest Submission:**
   - Customer submits trade-in with email: `alex@example.com`
   - No Shopify customer ID provided (not logged in)
   - `getOrCreateCustomer()` creates: `Customer A { email: "alex@example.com", shopifyCustomerId: null }`
   - Submission linked to Customer A

2. **Logged-In Visit to "My Trade-Ins":**
   - Customer logs into Shopify account (ID: 12345)
   - Visits "My Trade-Ins" page
   - `requireCustomer()` receives `logged_in_customer_id=12345`
   - Looks up: `findCustomerByShopifyId(12345)` → NOT FOUND
   - **Auto-creates:** `Customer B { email: "shopify-12345@pending.local", shopifyCustomerId: "12345" }`
   - Query submissions for Customer B → **EMPTY**

**Result:** Two separate customer records exist:
- Customer A: Has the submission, no Shopify ID
- Customer B: Has the Shopify ID, no submissions

### Why `getOrCreateCustomer()` Works But `requireCustomer()` Doesn't

The `getOrCreateCustomer()` function in `submissions.server.ts` handles merging correctly:
```typescript
// Try to find by Shopify ID first
if (shopifyCustomerId) {
  const existing = await prisma.customer.findUnique({ where: { shopifyCustomerId } });
  if (existing) return existing;
}

// Try to find by email  ← THIS IS KEY
const existingByEmail = await prisma.customer.findFirst({ where: { email } });
if (existingByEmail) {
  // Update Shopify ID if we now have one
  if (shopifyCustomerId && !existingByEmail.shopifyCustomerId) {
    return prisma.customer.update({
      where: { id: existingByEmail.id },
      data: { shopifyCustomerId },
    });
  }
  return existingByEmail;
}
```

But `requireCustomer()` in `app-proxy.server.ts` only looks up by Shopify ID:
```typescript
let customer = await findCustomerByShopifyId(shopifyCustomerId);
if (!customer) {
  // Auto-create with placeholder email - NO EMAIL LOOKUP!
  customer = await prisma.customer.create({
    data: {
      shopifyCustomerId,
      email: `shopify-${shopifyCustomerId}@pending.local`,
    },
  });
}
```

---

## Solution Options

### Option 1: Fetch Customer Email from Shopify Admin API (Recommended)

When `requireCustomer()` doesn't find a customer by Shopify ID, fetch the customer's email from Shopify Admin API, then check for existing records by email.

**Pros:**
- Proper linking from first visit
- Works for all cases

**Cons:**
- Adds Admin API call (latency)
- Requires store access token

### Option 2: Customer Merge on My Trade-Ins Page Load

Add a separate endpoint to merge customers when the page loads, using the customer's email from Shopify.

**Pros:**
- Non-blocking initial load

**Cons:**
- More complex
- Race conditions possible

### Option 3: Encourage Logged-In Submissions

Don't auto-create customers in `requireCustomer()`. Show "No submissions found" message with guidance to submit while logged in.

**Pros:**
- Simple
- No data inconsistency

**Cons:**
- Poor UX for existing guest submissions

---

## Implemented Solution

### Approach: Pass Customer Email from Frontend

Since the Liquid template has access to `customer.email`, we pass it to the backend via HTTP header to enable customer record linking.

### Changes Made:

**1. Frontend Template (`my-submissions.liquid`):**
```liquid
<input type="hidden" data-customer-email value="{{ customer.email | escape }}">
```

**2. Frontend JavaScript (`trade-in-account.js`):**
```javascript
// Read email from DOM
customerEmail: container.querySelector("[data-customer-email]")?.value,

// Pass as header on API calls
if (elements.customerEmail) {
  headers["X-Customer-Email"] = elements.customerEmail;
}
```

**3. Backend (`app-proxy.server.ts` - `requireCustomer()`):**
```typescript
if (!customer) {
  // Check if customer email was provided (from X-Customer-Email header)
  const customerEmail = request.headers.get("X-Customer-Email")?.toLowerCase().trim();

  if (customerEmail && customerEmail.includes("@") && !customerEmail.endsWith("@pending.local")) {
    // Try to find existing customer by email (may have submitted as guest)
    const existingByEmail = await prisma.customer.findFirst({
      where: { email: customerEmail },
    });

    if (existingByEmail && !existingByEmail.shopifyCustomerId) {
      // MERGE: Update existing customer with Shopify ID
      customer = await prisma.customer.update({
        where: { id: existingByEmail.id },
        data: { shopifyCustomerId },
      });
      console.log(`Merged guest customer with Shopify ID ${shopifyCustomerId}`);
    }
  }
  // ... create new if still no customer
}
```

---

## Files Modified

| File | Change |
|------|--------|
| `extensions/trade-in-blocks/blocks/my-submissions.liquid` | Added `data-customer-email` hidden input |
| `extensions/trade-in-blocks/assets/trade-in-account.js` | Pass `X-Customer-Email` header on API calls |
| `app/lib/app-proxy.server.ts` | `requireCustomer()` checks for email-based customer merge |

---

## Verification Steps

1. Check database for duplicate customers:
   ```sql
   SELECT * FROM Customer WHERE email LIKE '%@pending.local';
   SELECT email, COUNT(*) FROM Customer GROUP BY email HAVING COUNT(*) > 1;
   ```

2. Test flow:
   - Submit trade-in as guest with email X
   - Log into Shopify account with email X
   - Visit "My Trade-Ins"
   - Verify submission appears

---

## Status

**FIXED** - January 2026

The fix automatically merges customer records when a logged-in customer visits "My Trade-Ins" if they have a matching email from a previous guest submission.
