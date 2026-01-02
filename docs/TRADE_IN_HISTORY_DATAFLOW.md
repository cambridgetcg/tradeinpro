# Trade-In History Data Flow Analysis

## Overview

This document describes the data flow for the "My Trade-Ins" (trade-in history) feature and identifies potential issues with customer matching between guest submissions and logged-in views.

## Architecture

### Components Involved

1. **Theme Extension Block**: `extensions/trade-in-blocks/blocks/my-submissions.liquid`
   - Renders the UI for "My Trade-Ins" page
   - Passes `{{ customer.id }}` (Shopify customer ID) via hidden input field
   - Loads `trade-in-account.js` and `trade-in-account.css`

2. **Client JavaScript**: `extensions/trade-in-blocks/assets/trade-in-account.js`
   - Fetches data from `/apps/trade-in/my-submissions`
   - Renders submission cards, stats, detail modals
   - Handles filtering and pagination

3. **API Route**: `app/routes/api.my-submissions.tsx`
   - Requires customer authentication via `requireCustomer()`
   - Queries submissions by `customerId` (internal ID)
   - Returns formatted submission data with stats

4. **Auth Middleware**: `app/lib/app-proxy.server.ts`
   - `requireCustomer()` handles authentication via:
     - App Proxy signature validation (for storefront requests)
     - Session Token (JWT) validation (for Customer Account UI Extensions)
   - Maps Shopify customer ID to internal customer ID

5. **Submissions Library**: `app/lib/submissions.server.ts`
   - `getOrCreateCustomer()` handles customer record creation/linking

---

## Data Flow: Viewing Trade-In History

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Customer visits "My Trade-Ins" page (logged in)                            │
└───────────────────────────────────┬─────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ Liquid template renders with {{ customer.id }} = "23631418884361"           │
│ (my-submissions.liquid)                                                      │
└───────────────────────────────────┬─────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ trade-in-account.js makes fetch to:                                         │
│ /apps/trade-in/my-submissions?page=1&limit=10                               │
└───────────────────────────────────┬─────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ Shopify App Proxy intercepts request, adds signed parameters:               │
│ ?shop=xxx&logged_in_customer_id=23631418884361&timestamp=xxx&signature=xxx  │
└───────────────────────────────────┬─────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ api.my-submissions.tsx: requireCustomer(request)                            │
│ 1. validateAppProxy() - verifies signature, extracts logged_in_customer_id  │
│ 2. findCustomerByShopifyId("23631418884361")                                │
│ 3. If not found: auto-creates customer with placeholder email               │
│ 4. Returns context with internalCustomerId                                  │
└───────────────────────────────────┬─────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ Query: prisma.tradeInSubmission.findMany({                                  │
│   where: { customerId: context.internalCustomerId }                         │
│ })                                                                          │
└───────────────────────────────────┬─────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ Return JSON response with submissions, stats, pagination                    │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Data Flow: Creating a Submission

### Guest Submission (no login)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Guest submits trade-in with email: "user@example.com"                       │
│ (No Shopify customer ID available)                                          │
└───────────────────────────────────┬─────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ api.submissions.tsx: createSubmission()                                      │
│ calls getOrCreateCustomer({ email: "user@example.com" })                    │
└───────────────────────────────────┬─────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ getOrCreateCustomer():                                                       │
│ 1. No shopifyCustomerId provided, skip that lookup                          │
│ 2. Search by email: prisma.customer.findFirst({ email })                    │
│ 3. If not found: create new customer with email only                        │
│                                                                              │
│ Result: Customer record with:                                                │
│   - email: "user@example.com"                                               │
│   - shopifyCustomerId: NULL  ← PROBLEM: No Shopify link                     │
└───────────────────────────────────┬─────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ Submission created with customerId = internal customer ID                   │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Logged-in Submission

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Logged-in customer submits trade-in                                          │
│ Request includes logged_in_customer_id from App Proxy                       │
└───────────────────────────────────┬─────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ getOrCreateCustomer({                                                        │
│   shopifyCustomerId: "23631418884361",                                      │
│   email: "user@example.com"                                                 │
│ })                                                                           │
└───────────────────────────────────┬─────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ Lookup logic:                                                                │
│ 1. Find by shopifyCustomerId first                                          │
│ 2. If not found, find by email                                              │
│ 3. If found by email: UPDATE record to add shopifyCustomerId ← LINK!       │
│ 4. If not found at all: create new with both values                        │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Root Cause: Customer ID Mismatch

### The Problem

When a customer submits as a **guest first**, then later **logs in** to view their history:

1. **Guest Submission**:
   - Customer record created with email only
   - `shopifyCustomerId = NULL`
   - Submission linked to this customer ID

2. **Later: Logged-in View**:
   - `requireCustomer()` extracts `logged_in_customer_id` from App Proxy
   - Looks up by `shopifyCustomerId` - **NO MATCH** (record has NULL)
   - Auto-creates NEW customer with:
     - `shopifyCustomerId = "23631418884361"`
     - `email = "shopify-23631418884361@pending.local"` (placeholder)
   - Queries submissions for this NEW customer - **FINDS NOTHING**

### Current Database State (for reference)

```
Customers:
┌────────────────────────────────┬───────────────────────────┬──────────────────────┐
│ id                             │ email                     │ shopifyCustomerId    │
├────────────────────────────────┼───────────────────────────┼──────────────────────┤
│ cmj0566i10000jp04z556n40j      │ contact@cambridgetcg.com  │ 23631418884361       │ ← Has both!
│ cmiz2fquc0000ih04jel8g3f9      │ testingspoidgspdo@gmail.. │ NULL                 │ ← Guest only
│ cmiyp5pk90000jy04f1c29p0g      │ aaasiadog@gmail.com       │ NULL                 │ ← Guest only
└────────────────────────────────┴───────────────────────────┴──────────────────────┘
```

The first customer has both email and shopifyCustomerId linked (either submitted while logged in, or the link was established during a subsequent logged-in submission).

---

## Potential Fixes

### Option 1: Enhance requireCustomer() to Search by Email (Recommended)

Modify `requireCustomer()` in `app/lib/app-proxy.server.ts` to:

1. First try to find customer by `shopifyCustomerId` (current behavior)
2. If not found and we can access customer email (via Shopify API), search by email
3. If found by email, update the record to add `shopifyCustomerId`
4. Then proceed with the linked customer

**Challenge**: `requireCustomer()` doesn't have access to the customer's email. Would need to:
- Call Shopify Admin API to get customer email from customer ID
- Or add customer email to the session token claims (not available by default)

### Option 2: Link Customers During Submission (Already Implemented)

The current `getOrCreateCustomer()` already handles this:

```typescript
// Try to find by email
const existingByEmail = await prisma.customer.findFirst({
  where: { email: normalizedEmail },
});

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

**This works IF** the customer makes a NEW submission while logged in. The linking happens then.

### Option 3: Query by Email in my-submissions (Simple Fix)

Modify `api.my-submissions.tsx` to also search by email if available:

```typescript
// Build where clause - include email match for backwards compatibility
const where: Prisma.TradeInSubmissionWhereInput = {
  OR: [
    { customerId: context.internalCustomerId },
    // Also include submissions from customer records with same email
    { customer: { email: customerEmail } }
  ]
};
```

**Challenge**: Same issue - we don't have the customer's email in `requireCustomer()`.

### Option 4: Call Shopify API to Get Email

In `requireCustomer()`, after getting `shopifyCustomerId`:

1. Call Shopify Admin API: `GET /admin/api/2024-01/customers/{id}.json`
2. Get customer email
3. Try to find existing customer by email
4. If found, update with `shopifyCustomerId`
5. Return the linked customer

**Implementation Required**:
- Need authenticated Shopify session for Admin API call
- Performance impact (extra API call per request)
- Caching strategy needed

### Option 5: Force Login for Submissions (UX Impact)

Require customers to log in before submitting a trade-in. This ensures:
- Every submission is linked to a Shopify customer ID
- History always shows correctly

**Drawback**: Reduces conversion - some customers may abandon if forced to create account.

---

## Implemented Solution (2026-01-02)

### Fix: Auto-Link Customers via Shopify API

Modified `requireCustomer()` in `app/lib/app-proxy.server.ts` to:

1. When customer not found by `shopifyCustomerId`:
2. Call `getShopifyCustomerEmail(shop, shopifyCustomerId)` to fetch email from Shopify Admin API
3. Search for existing customer record by email
4. If found (guest submission), **update record to link** `shopifyCustomerId`
5. Return the linked customer - submissions now visible!

```typescript
// New helper function added
export async function getShopifyCustomerEmail(
  shop: string,
  shopifyCustomerId: string
): Promise<string | null>

// Modified flow in requireCustomer():
if (!customer) {
  // Fetch email from Shopify Admin API
  const customerEmail = await getShopifyCustomerEmail(shop, shopifyCustomerId);

  if (customerEmail) {
    const existingByEmail = await prisma.customer.findFirst({
      where: { email: customerEmail }
    });

    if (existingByEmail && !existingByEmail.shopifyCustomerId) {
      // MERGE: Link guest customer to Shopify account
      customer = await prisma.customer.update({
        where: { id: existingByEmail.id },
        data: { shopifyCustomerId }
      });
      console.log(`✓ Linked guest customer with Shopify ID`);
    }
  }
}
```

### Why This Works

- Uses offline access token stored in session to make Admin API calls
- GraphQL query: `customer(id: $id) { email }`
- Automatic linking happens on first "My Trade-Ins" page visit
- No changes needed to storefront or theme code

### Long-term: Consider Enforcing Login for Trade-ins

For better data consistency, consider requiring login for trade-in submissions.

---

## Testing the Fix

1. Create a trade-in as guest with email `test@example.com`
2. Verify customer record created with email but no `shopifyCustomerId`
3. Log in with a Shopify account that has email `test@example.com`
4. Visit "My Trade-Ins" page
5. Verify:
   - Customer record now has `shopifyCustomerId` linked
   - Previous submission is visible

---

## Related Files

| File | Purpose |
|------|---------|
| `app/routes/api.my-submissions.tsx` | API endpoint for listing customer submissions |
| `app/lib/app-proxy.server.ts` | Authentication and customer lookup |
| `app/lib/submissions.server.ts` | `getOrCreateCustomer()` function |
| `extensions/trade-in-blocks/blocks/my-submissions.liquid` | UI template |
| `extensions/trade-in-blocks/assets/trade-in-account.js` | Client-side logic |

---

## Appendix: Database Schema

```prisma
model Customer {
  id                String   @id @default(cuid())
  shopifyCustomerId String?  @unique   // Shopify's customer ID
  email             String              // Can be placeholder for auto-created
  firstName         String?
  lastName          String?
  phone             String?
  // ... relationships
  tradeInSubmissions TradeInSubmission[]
}

model TradeInSubmission {
  id               String   @id @default(cuid())
  submissionNumber String   @unique
  customerId       String              // Internal customer ID (NOT Shopify ID)
  customer         Customer @relation(fields: [customerId], references: [id])
  // ... other fields
}
```

---

*Document created: 2026-01-02*
*Issue: Trade-in history not showing for customers who submitted as guests before logging in*
