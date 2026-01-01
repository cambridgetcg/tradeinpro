# Trade-In Submission Flow: Component Architecture & Data Flow

> **Purpose:** Technical deep-dive into the trade-in submission system, documenting component architecture, data flow, and optimization opportunities.
> **Last Updated:** 2026-01-01

---

## Table of Contents

1. [High-Level Overview](#high-level-overview)
2. [Component Architecture](#component-architecture)
3. [Data Flow Diagram](#data-flow-diagram)
4. [Reference Number Generation](#reference-number-generation)
5. [Pricing Engine](#pricing-engine)
6. [Database Schema](#database-schema)
7. [API Endpoints](#api-endpoints)
8. [Client-Side State Management](#client-side-state-management)
9. [Performance Optimizations](#performance-optimizations)
10. [Future Optimization Plan](#future-optimization-plan)

---

## High-Level Overview

The trade-in submission system consists of three main layers:

```
┌─────────────────────────────────────────────────────────────────┐
│                      STOREFRONT LAYER                           │
│  trade-in-form.liquid + trade-in.js + trade-in.css              │
│  (Customer-facing form on Shopify storefront)                   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼ POST /apps/trade-in/submissions
┌─────────────────────────────────────────────────────────────────┐
│                      API LAYER                                  │
│  api.submissions.tsx (React Router action handler)              │
│  - Validates App Proxy signature                                │
│  - Validates request body                                       │
│  - Calls business logic layer                                   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                   BUSINESS LOGIC LAYER                          │
│  submissions.server.ts + pricing.server.ts + settings.server.ts │
│  - Customer management                                          │
│  - Price calculation                                            │
│  - Submission creation                                          │
│  - Email notifications                                          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    DATABASE LAYER                               │
│  PostgreSQL (AWS RDS) via Prisma ORM                            │
│  - TradeInSubmission, TradeInItem, Customer, CardPriceV2        │
└─────────────────────────────────────────────────────────────────┘
```

---

## Component Architecture

### Frontend Components (Liquid + JavaScript)

```
extensions/trade-in-blocks/
├── blocks/
│   └── trade-in-form.liquid     # Main form template (627 lines)
├── assets/
│   ├── trade-in.js              # Client-side logic (1609 lines)
│   └── trade-in.css             # Component styles
```

#### trade-in-form.liquid Structure

| Section | Purpose | Key Elements |
|---------|---------|--------------|
| **Header** | Title + subtitle | Customizable via block settings |
| **Search Section** | Card lookup | `[data-search-input]`, `[data-search-results]` |
| **Browse Section** | Card grid with images | `[data-browse-grid]`, `[data-set-filter]` |
| **Cart Section** | Selected items | `[data-cart-items]`, `[data-cart-summary]` |
| **Customer Section** | Email/name (guest) or hidden (logged in) | `[data-customer-section]` |
| **Contact Details** | Phone + preferred channel (required) | `[data-contact-details]` |
| **Bank Details** | For bank transfer payout | `[data-bank-details]` |
| **Payout Selection** | Store Credit vs Bank | `[data-payout-section]` |
| **Shipping Address** | For free prepaid labels | `[data-shipping-section]` |
| **Submit Section** | Final CTA | `[data-submit-button]` |
| **Success State** | Post-submission | `[data-success-state]` with reference number |
| **Mobile Cart Widget** | Sticky footer on mobile | `[data-mobile-cart]` |
| **Condition Modal** | Condition/quantity picker | `[data-condition-modal]` |

#### trade-in.js State Management

```javascript
const state = {
  cart: [],                    // Array of cart items
  searchQuery: "",             // Current search query
  searchResults: [],           // Search API results
  browseResults: [],           // Browse API results
  availableSets: [],           // Filter options
  selectedSet: "",             // Current set filter
  currentPage: 1,              // Browse pagination
  totalPages: 1,
  isLoading: false,
  isSubmitting: false,
  selectedCard: null,          // Card in condition modal
  selectedCondition: "NM",     // Default condition
  selectedQuantity: 1,
  viewMode: "search",          // "search" or "browse"
};
```

#### Cart Item Structure

```javascript
{
  cardId: "OP03-OP01-051-sp",    // CardPriceV2 primary key
  cardName: "Eustass Captain Kid",
  setName: "OP03",
  setCode: "OP03",
  variant: "sp",
  imageUrl: "OP03/OP03-SP-OP01-051.png",
  condition: "NM",
  quantity: 2,
  pricePerItem: 2414             // Price in pence
}
```

---

## Data Flow Diagram

### Submission Creation Flow

```
Customer Action           Client (trade-in.js)              Server (api.submissions.tsx)        Database
─────────────────────────────────────────────────────────────────────────────────────────────────────────

1. Add cards to cart      state.cart.push(item)
                          └─ calculatePriceFromCard()
                          └─ saveCartToStorage()

2. Fill customer info     Form validation (email, phone, contact channel)

3. Select payout type     Radio button selection
                          └─ If BANK: validate bank details

4. Click "Submit"         handleSubmit()
                          └─ validateContactPreferences()
                          └─ validateBankDetails() (if BANK)
                          └─ validateShippingAddress() (if free shipping)
                          │
                          ▼
                          POST /apps/trade-in/submissions
                          {
                            email, firstName, lastName,
                            payoutType, phone, contactChannel,
                            bankDetails (if BANK),
                            shippingAddress (if qualifies),
                            items: [{ cardPriceId, cardName, setName,
                                      quantity, conditionClaimed }]
                          }
                                                            │
                                                            ▼
                                                            requireAppProxy(request)
                                                            └─ Validate HMAC signature
                                                            │
                                                            ▼
                                                            validateCreateSubmissionRequest()
                                                            └─ Email format
                                                            └─ Payout type
                                                            └─ Bank details (if BANK)
                                                            └─ Items array
                                                            │
                                                            ▼
                                                            createSubmission()
                                                            │
                                                            ├─► getCachedSettings(shop)        → TradeInSettings
                                                            ├─► getOrCreateCustomer()           → Customer
                                                            ├─► validateAndPrepareItems()
                                                            │   └─► batchLookupCardPricesV2()   → CardPriceV2 (batch)
                                                            │   └─► calculatePriceFromCard()
                                                            │   └─► totalValue calculation
                                                            │
                                                            ├─► generateSubmissionNumber()      → COUNT query
                                                            │
                                                            └─► prisma.tradeInSubmission.create → TradeInSubmission
                                                                with nested items                  + TradeInItem[]
                                                            │
                                                            ▼
                                                            submitSubmission()
                                                            └─ status: DRAFT → SUBMITTED
                                                            │
                                                            ▼
                                                            sendSubmissionCreatedNotification()
                                                            │
                                                            ▼
                          Response: { success: true,
                                      submission: { submissionNumber, ... } }
                          │
                          ▼
5. Success screen         Show reference number
                          Clear cart
                          Show packing slip / shipping links
```

---

## Reference Number Generation

### Format: `TRD-YYYYMM-XXXXX`

| Segment | Description | Example |
|---------|-------------|---------|
| `TRD` | Fixed prefix | TRD |
| `YYYYMM` | Year and month | 202601 (January 2026) |
| `XXXXX` | 5-digit sequence, padded | 00001, 00042, 01234 |

### Generation Logic

**Location:** `app/lib/submissions.server.ts:313-329`

```typescript
export async function generateSubmissionNumber(): Promise<string> {
  const now = new Date();
  const yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  const prefix = `TRD-${yearMonth}`;

  // Count submissions in current month
  const count = await prisma.tradeInSubmission.count({
    where: {
      submissionNumber: {
        startsWith: prefix,
      },
    },
  });

  const sequence = String(count + 1).padStart(5, "0");
  return `${prefix}-${sequence}`;
}
```

### Insights

| Aspect | Current State | Notes |
|--------|---------------|-------|
| **Uniqueness** | Month-scoped sequence | Resets each month |
| **Capacity** | 99,999 per month | Sufficient for trade-in volume |
| **Readability** | Human-friendly | Easy to quote over phone |
| **Sorting** | Chronological | Newer submissions have higher numbers |
| **Race Condition** | COUNT + INSERT gap | Small risk with concurrent requests |

### Potential Improvements

1. **Atomic Generation**: Use database sequence or `RETURNING` clause
2. **Shop-Specific Prefix**: `TRD-{SHOP_ID}-YYYYMM-XXXXX` for multi-shop
3. **Checksum Digit**: Add validation digit for data entry error detection

---

## Pricing Engine

### Price Calculation Flow

```
CardPriceV2.bestPriceGbp (market price in GBP)
        │
        ▼
Convert to pence: Math.round(price * 100)
        │
        ▼
Apply condition multiplier from TradeInSettings:
  NM:  70% (0.70)
  LP:  55% (0.55)
  MP:  40% (0.40)
  HP:  25% (0.25)
  DMG: 10% (0.10)
        │
        ▼
Round down to nearest 10p: Math.floor(price / 10) * 10
        │
        ▼
Multiply by quantity
        │
        ▼
Sum all items = quotedTotal
        │
        ▼
If STORE_CREDIT: bonusAmount = quotedTotal * 0.10 (10% bonus)
```

### Key Functions

| Function | Location | Purpose |
|----------|----------|---------|
| `calculatePriceFromCard()` | submissions.server.ts:159 | Price from pre-fetched card |
| `getMultiplierFromSettings()` | settings.server.ts | Get condition multiplier |
| `calculateCardPrice()` | pricing.server.ts:133 | Full price calculation |
| `calculateSubmissionTotal()` | pricing.server.ts:266 | Submission total with bonus |

### Example Calculation

```
Card: OP01-051-sp
Market Price: £34.49 (3449p)
Condition: LP (55% multiplier)

Base calculation: 3449 × 0.55 = 1896.95
Round to 10p: 1890p (£18.90)
Quantity: 2
Total: 3780p (£37.80)

With store credit bonus (+10%): 4158p (£41.58)
```

---

## Database Schema

### Core Tables

```
┌───────────────────┐       ┌────────────────────┐
│    Customer       │       │   TradeInSettings  │
├───────────────────┤       ├────────────────────┤
│ id                │       │ shop               │
│ shopifyCustomerId │       │ minimumSubmission  │
│ email             │       │ conditionMultipliers│
│ firstName         │       │ storeCreditBonus   │
│ lastName          │       │ freeShippingMin    │
└────────┬──────────┘       └────────────────────┘
         │
         │ 1:N
         ▼
┌────────────────────────────────────────────────┐
│            TradeInSubmission                   │
├────────────────────────────────────────────────┤
│ id (cuid)                                      │
│ submissionNumber (TRD-YYYYMM-XXXXX)            │
│ customerId → Customer                          │
│ status (DRAFT → SUBMITTED → ... → COMPLETED)  │
│ payoutType (STORE_CREDIT, BANK, PAYPAL)        │
│ quotedTotal (pence)                            │
│ finalTotal (pence, after grading)              │
│ bonusAmount (pence)                            │
│ phone, contactChannel                          │
│ bankAccountName, bankSortCode, bankAccountNumber│
│ shippingAddress fields                         │
│ trackingNumber, labelUrl                       │
│ submittedAt, receivedAt, gradedAt, ...         │
└────────┬───────────────────────────────────────┘
         │
         │ 1:N
         ▼
┌────────────────────────────────────────────────┐
│              TradeInItem                       │
├────────────────────────────────────────────────┤
│ id (cuid)                                      │
│ submissionId → TradeInSubmission               │
│ cardPriceId → CardPrice (nullable, legacy FK)  │
│ cardName, setName, setCode, variant            │
│ quantity                                       │
│ conditionClaimed (NM, LP, MP, HP, DMG)         │
│ conditionActual (set during grading)           │
│ marketPricePence (for recalculation)           │
│ quotedPrice (pence)                            │
│ finalPrice (pence, after grading)              │
│ status (PENDING, VERIFIED, ADJUSTED, REJECTED) │
└────────────────────────────────────────────────┘

┌────────────────────────────────────────────────┐
│              CardPriceV2                       │
├────────────────────────────────────────────────┤
│ cardId (e.g., OP03-OP01-051-sp)                │
│ name                                           │
│ releaseSet, fullCardNumber, setCode, cardNumber│
│ variantType                                    │
│ bestPriceGbp (market price)                    │
│ tradeinPriceGbp (pre-calculated 70%)           │
│ imageUrl                                       │
│ (Managed by Lambda pricer, read-only)          │
└────────────────────────────────────────────────┘
```

### Data Denormalization

Card details are **denormalized** into `TradeInItem`:
- `cardName`, `setName`, `setCode`, `variant` copied from CardPriceV2
- `marketPricePence` stored for grading recalculations
- `cardPriceId` is `null` (CardPriceV2 IDs incompatible with legacy FK)

**Rationale:**
- Card prices change over time; submission captures point-in-time pricing
- Historical records remain accurate even if card is removed
- Grading adjustments can recalculate from `marketPricePence`

---

## API Endpoints

### Submissions API

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/apps/trade-in/submissions` | GET | Customer (logged in) | List customer's submissions |
| `/apps/trade-in/submissions` | POST | App Proxy (guest allowed) | Create new submission |
| `/apps/trade-in/submissions/:id` | GET | Customer | Get submission details |
| `/apps/trade-in/submissions/:id/confirm` | POST | Customer | Confirm grading results |
| `/apps/trade-in/submissions/:id/reject` | POST | Customer | Reject and request return |

### Cards API

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/apps/trade-in/cards/search` | GET | Search cards by name/set |
| `/apps/trade-in/cards/browse` | GET | Browse with pagination + images |
| `/apps/trade-in/cards/sets` | GET | Get available sets for filter |

### Request Validation (api.submissions.tsx)

```typescript
const VALID_PAYOUT_TYPES = ["STORE_CREDIT", "BANK", "PAYPAL"];
const VALID_CONDITIONS = ["NM", "LP", "MP", "HP", "DMG"];
const VALID_CONTACT_CHANNELS = ["WHATSAPP", "TELEGRAM", "SIGNAL"];
const MAX_ITEMS = 100;
const MAX_QUANTITY_PER_ITEM = 99;

// Validation rules:
// - Email: required, valid format
// - Payout type: required, must be valid
// - Phone: required
// - Contact channel: required when phone provided
// - Items: required array, 1-100 items
// - Each item: cardName, setName, quantity (1-99), conditionClaimed required
// - Bank details: required when payoutType is BANK
```

---

## Client-Side State Management

### Cart Persistence

```javascript
// localStorage with 72-hour expiry
CONFIG.cartStorageKey = "tradein_cart";
CONFIG.cartExpiryHours = 72;

// Save format
{
  items: [...cartItems],
  savedAt: Date.now()
}
```

### Cart Recovery Flow

```
Page Load
    │
    ▼
loadCartFromStorage()
    │
    ├─► Expired? → clearCartStorage()
    │
    └─► Valid? → showCartRecoveryPrompt(itemCount)
                 │
                 ├─► "Restore Cart" → state.cart = savedItems
                 │
                 └─► "Start Fresh" → clearCartStorage()
```

### Price Display

```javascript
function formatMoney(pence) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
  }).format(pence / 100);
}
```

---

## Performance Optimizations

### Current Optimizations (Already Implemented)

| Optimization | Location | Impact |
|--------------|----------|--------|
| **Batch Card Lookup** | `batchLookupCardPricesV2()` | 1 query instead of N queries |
| **Settings Caching** | `getCachedSettings()` | Request-scoped cache |
| **Parallel Fetches** | `createSubmission()` | Settings + Customer in parallel |
| **Single-Pass Validation** | `validateAndPrepareItems()` | Validate + calculate in one loop |
| **Pre-Calculated Prices** | `validatedItems[].price` | No DB lookups during item creation |
| **Debounced Search** | `CONFIG.debounceMs = 300` | Reduced API calls during typing |
| **Cart LocalStorage** | `saveCartToStorage()` | Preserves cart across page reloads |

### Query Count Comparison

| Scenario | Before Optimization | After Optimization |
|----------|---------------------|-------------------|
| 10-item submission | 40-60 queries | 6-8 queries |
| 50-item submission | 200-300 queries | 6-8 queries |

**Why it scales:**
- Card lookups: O(1) with batch query regardless of item count
- Settings: O(1) with caching
- Customer: O(1) single query
- Submission creation: O(1) single transaction with nested writes

---

## Future Optimization Plan

### Priority 1: Critical Improvements

| Issue | Impact | Recommendation |
|-------|--------|----------------|
| **Race condition in submission number** | Duplicate numbers under load | Use PostgreSQL sequence or `INSERT ... RETURNING` with atomic increment |
| **No retry on transient errors** | Failed submissions | Add exponential backoff for DB timeouts |
| **No request deduplication** | Double-click creates duplicates | Add idempotency key to request |

### Priority 2: Performance Enhancements

| Issue | Impact | Recommendation |
|-------|--------|----------------|
| **Card search hits DB directly** | Latency on every keystroke | Add Redis/edge cache for popular searches |
| **No browse result caching** | Repeated queries for same page | Cache browse results for 5 minutes |
| **Settings fetched per-request** | Unnecessary DB reads | Use longer-lived cache (1 hour) with invalidation on update |

### Priority 3: UX Improvements

| Issue | Impact | Recommendation |
|-------|--------|----------------|
| **Cart not synced across devices** | Lost carts | Store draft in DB, not localStorage |
| **No real-time price updates** | Stale prices in cart | Add timestamp to cart items, warn if > 24h old |
| **No cart size limit on client** | Memory issues | Enforce MAX_ITEMS on add, not just submit |

### Priority 4: Observability

| Aspect | Current State | Recommendation |
|--------|---------------|----------------|
| **API Timing** | No metrics | Add APM (e.g., Datadog, Sentry) |
| **Error Rates** | Console logs only | Structured logging with correlation IDs |
| **Cart Abandonment** | Unknown | Track cart saves without submission |

---

## Implementation Checklist

### Immediate Actions (P0)

- [ ] Add idempotency key to submission creation
- [ ] Use database sequence for submission numbers
- [ ] Add error boundary to form component

### Short-Term (P1)

- [ ] Implement Redis cache for card search
- [ ] Add request timing metrics
- [ ] Create health check endpoint

### Medium-Term (P2)

- [ ] Server-side draft persistence
- [ ] Real-time inventory/price checks
- [ ] Progressive enhancement for no-JS fallback

---

## Key Files Reference

| File | Purpose | Lines |
|------|---------|-------|
| `extensions/trade-in-blocks/blocks/trade-in-form.liquid` | Form template | 627 |
| `extensions/trade-in-blocks/assets/trade-in.js` | Client logic | 1609 |
| `app/routes/api.submissions.tsx` | API handler | 326 |
| `app/lib/submissions.server.ts` | Business logic | 1220 |
| `app/lib/pricing.server.ts` | Price calculations | 448 |
| `app/lib/constants.ts` | Enums + utilities | 296 |
| `prisma/schema.prisma` | Database schema | 507 |

---

*Document created for CardForum Trade-In system analysis.*
