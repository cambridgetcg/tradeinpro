# Trade-In System Synapse Document

**The Neural Bridge Between Frontend & Backend**

*Last Updated: January 2026*

---

## Table of Contents

1. [System Overview](#system-overview)
2. [Data Flow Architecture](#data-flow-architecture)
3. [Integration Points](#integration-points)
4. [Weak Links & Failure Modes](#weak-links--failure-modes)
5. [Unhandled Scenarios](#unhandled-scenarios)
6. [Optimization Recommendations](#optimization-recommendations)
7. [Quick Reference](#quick-reference)

---

## Master Ecosystem Synapse

**See Also:** [TCG_TRADEIN_ECOSYSTEM_SYNAPSE.md](../../TCG_TRADEIN_ECOSYSTEM_SYNAPSE.md) - Master synapse connecting all three codebases (trading-card-pricer, cardforum, ShopifyTheme_TCG)

---

## Related Synapse Hubs (Internal Cross-References)

These documents provide detailed synapses within each codebase:

### Trading-Card-Pricer (Price Data Pipeline)

| Hub | Location | Purpose |
|-----|----------|---------|
| **PRICER_SYNAPSE.md** | `trading-card-pricer/docs/PRICER_SYNAPSE.md` | Lambda functions, DB schema, price flow |
| **CLAUDE.md** | `trading-card-pricer/CLAUDE.md` | Quick reference for pricing system |

### Cardforum (Backend)

| Hub | Location | Purpose |
|-----|----------|---------|
| **CODE_SYNAPSE.md** | `app/lib/CODE_SYNAPSE.md` | Lib module dependencies & data flow |
| **ROUTES_SYNAPSE.md** | `app/routes/ROUTES_SYNAPSE.md` | API routing & endpoint mapping |
| **EXTENSIONS_SYNAPSE.md** | `extensions/EXTENSIONS_SYNAPSE.md` | Shopify extension integration |

### ShopifyTheme_TCG (Frontend)

| Hub | Location | Purpose |
|-----|----------|---------|
| **ASSETS_SYNAPSE.md** | `assets/ASSETS_SYNAPSE.md` | JS/CSS file relationships & API calls |

### Code Files with @synapse Tags

Key files contain `@synapse` JSDoc tags pointing to their related hub:

```
# Trading-Card-Pricer
trading-card-pricer/lambda/price-fetcher/index.ts → @synapse PRICER_SYNAPSE.md
trading-card-pricer/lambda/price-fetcher/db.ts    → @synapse PRICER_SYNAPSE.md
trading-card-pricer/lib/trading-card-pricer-stack.ts → @synapse PRICER_SYNAPSE.md

# Cardforum
cardforum/app/lib/submissions.server.ts    → @synapse CODE_SYNAPSE.md
cardforum/app/lib/app-proxy.server.ts      → @synapse CODE_SYNAPSE.md
cardforum/app/lib/workflow.server.ts       → @synapse CODE_SYNAPSE.md
cardforum/extensions/.../api/client.ts     → @synapse EXTENSIONS_SYNAPSE.md
cardforum/extensions/.../trade-in-account.js → @synapse EXTENSIONS_SYNAPSE.md

# ShopifyTheme_TCG
ShopifyTheme_TCG/assets/trade-in-app.js    → @synapse ASSETS_SYNAPSE.md
ShopifyTheme_TCG/assets/trade-in-track.js  → @synapse ASSETS_SYNAPSE.md
```

---

## System Overview

### The Two Hemispheres

| Component | Directory | Role |
|-----------|-----------|------|
| **Backend (Cardforum)** | `/Users/alex/TCG_TradeIn/cardforum` | Shopify App, API, Database, Business Logic |
| **Frontend (Theme)** | `/Users/alex/TCG_TradeIn/ShopifyTheme_TCG` | UI, User Interaction, Form Handling |

### Connection Method: Shopify App Proxy

```
Customer Browser
      │
      ▼
┌─────────────────────────────────────┐
│   Shopify Storefront                │
│   https://cambridgetcg.com          │
│                                     │
│   /apps/trade-in/* ────────────────►│──┐
└─────────────────────────────────────┘  │
                                         │ App Proxy (HMAC Signed)
                                         ▼
┌─────────────────────────────────────┐
│   Cardforum Backend                 │
│   https://cardforum.vercel.app      │
│                                     │
│   /api/storefront/* ◄───────────────│
└─────────────────────────────────────┘
```

---

## Data Flow Architecture

### Complete Trade-In Journey

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              FRONTEND (Theme)                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐              │
│  │  BROWSE  │───►│  SEARCH  │───►│   CART   │───►│  SUBMIT  │              │
│  │  Cards   │    │  Cards   │    │ Management│    │  Form    │              │
│  └────┬─────┘    └────┬─────┘    └────┬─────┘    └────┬─────┘              │
│       │               │               │               │                      │
│       │ cards/browse  │ cards/search  │ localStorage  │ submissions (POST)  │
│       │               │               │               │                      │
└───────┼───────────────┼───────────────┼───────────────┼──────────────────────┘
        │               │               │               │
        ▼               ▼               │               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              BACKEND (Cardforum)                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │ CardPriceV2  │  │ Idempotency  │  │  Submission  │  │   Shipping   │    │
│  │   Lookup     │  │    Check     │  │   Creation   │  │ Label Gen    │    │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘    │
│         │                 │                 │                 │              │
│         ▼                 ▼                 ▼                 ▼              │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                         PostgreSQL Database                          │  │
│  │  CardPriceV2 │ Customer │ TradeInSubmission │ TradeInItem │ Payout  │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│         │                                                                    │
│         ▼                                                                    │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                      │
│  │  Royal Mail  │  │    Email     │  │   Shopify    │                      │
│  │  Click&Drop  │  │   Provider   │  │  Admin API   │                      │
│  └──────────────┘  └──────────────┘  └──────────────┘                      │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Request/Response Data Contracts

#### 1. Card Search
```
Frontend Request:
GET /apps/trade-in/cards/search?q=luffy&limit=10

Backend Response:
{
  "results": [{
    "cardId": "OP01-001",
    "cardName": "Monkey D. Luffy",
    "setName": "Romance Dawn",
    "setCode": "OP01",
    "prices": { "NM": 450, "LP": 350, "MP": 260, "HP": 160, "DMG": 65 }
  }],
  "count": 1,
  "query": "luffy"
}
```

#### 2. Submission Create
```
Frontend Request:
POST /apps/trade-in/submissions
Headers: X-Idempotency-Key: <uuid>
Body: {
  "email": "customer@example.com",
  "firstName": "John",
  "lastName": "Doe",
  "phone": "07123456789",
  "contactChannel": "WHATSAPP",
  "payoutType": "STORE_CREDIT",
  "items": [{
    "cardPriceId": "OP01-001",
    "cardName": "Monkey D. Luffy",
    "setName": "Romance Dawn",
    "quantity": 2,
    "conditionClaimed": "NM",
    "quotedPricePence": 450
  }],
  "cartOldestItemAt": 1704067200000,
  "shippingAddress1": "123 High Street",
  "shippingCity": "Cambridge",
  "shippingPostalCode": "CB1 1AA"
}

Backend Response:
{
  "success": true,
  "submission": {
    "id": "clxx...",
    "submissionNumber": "TRD-202601-00015",
    "status": "SUBMITTED",
    "quotedTotal": 900,
    "itemCount": 2,
    "shippingMethod": "PREPAID",
    "trackingNumber": "TT123456789GB",
    "labelUrl": "https://..."
  },
  "warnings": []
}
```

---

## Integration Points

### 1. Authentication Bridge

| Source | Method | Data Passed | Backend Handler |
|--------|--------|-------------|-----------------|
| App Proxy | HMAC Query Params | `logged_in_customer_id`, `shop`, `signature` | `validateAppProxy()` |
| Theme Extension | Session Token JWT | `sub` (customer GID) | `validateSessionToken()` |
| Frontend Header | `X-Customer-Email` | Customer email | `requireCustomer()` merge |

**Customer Linking Flow:**
```
                    ┌─────────────────────────────┐
                    │  Shopify Customer ID: 12345 │
                    └─────────────┬───────────────┘
                                  │
              ┌───────────────────┼───────────────────┐
              │                   │                   │
              ▼                   ▼                   ▼
    ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
    │ findByShopifyId │ │ findByEmail     │ │ Shopify Admin   │
    │ (Primary)       │ │ (Header)        │ │ API (Fallback)  │
    └────────┬────────┘ └────────┬────────┘ └────────┬────────┘
             │                   │                   │
             └───────────────────┼───────────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │   Internal Customer ID   │
                    │   (links submissions)    │
                    └──────────────────────────┘
```

### 2. Price Synchronization

**Frontend caches prices for 5 minutes; Backend validates on submit**

```
Frontend (Browse)         Backend (Submit)
     │                         │
     │  Price: £4.50 (NM)      │
     │  addedAt: T+0           │
     │                         │
     │         ... 2 hours ... │
     │                         │
     │  Submit Cart ──────────►│
     │                         │  Check cartOldestItemAt
     │                         │  Age: 2 hours > 2hr threshold
     │                         │
     │◄──── warnings: ["Cart   │
     │       was over 2 hours  │
     │       old"]             │
     │                         │
```

### 3. Shipping Label Generation

**Conditional based on cart value and address validity**

```
                    Cart Total >= £50?
                          │
            ┌─────────────┴─────────────┐
            │ NO                        │ YES
            ▼                           ▼
    ┌───────────────┐          Address Provided?
    │ SELF_SHIP     │                 │
    │ (No label)    │     ┌───────────┴───────────┐
    └───────────────┘     │ NO                    │ YES
                          ▼                       ▼
                  ┌───────────────┐      UK Postcode Valid?
                  │ ADDRESS_      │             │
                  │ REQUIRED      │    ┌────────┴────────┐
                  └───────────────┘    │ NO              │ YES
                                       ▼                 ▼
                               ┌───────────────┐  ┌───────────────┐
                               │ Validation    │  │ Royal Mail    │
                               │ Error         │  │ Label Gen     │
                               └───────────────┘  └───────┬───────┘
                                                          │
                                              ┌───────────┴───────────┐
                                              │ SUCCESS               │ FAIL
                                              ▼                       ▼
                                      ┌───────────────┐      ┌───────────────┐
                                      │ PREPAID       │      │ LABEL_FAILED  │
                                      │ + labelUrl    │      │ (retry later) │
                                      └───────────────┘      └───────────────┘
```

---

## Weak Links & Failure Modes

### 1. CRITICAL: Price Drift Between Browse and Submit

**Scenario:** Customer browses cards, adds to cart, waits hours/days, then submits.

**Current Handling:**
- Frontend tracks `addedAt` timestamp per cart item
- Backend checks `cartOldestItemAt` against thresholds
- Returns warnings but ACCEPTS submission at OLD prices

**Weakness:**
- Frontend quotes price at browse time
- Backend stores `quotedPrice` from frontend request
- Actual `CardPriceV2` may have changed significantly
- No re-validation of actual prices during submission

**Risk Level:** HIGH - Customer could get outdated prices

**Recommendation:**
```javascript
// Backend should re-fetch current prices and compare
const currentPrice = await getCardPrice(item.cardPriceId, item.conditionClaimed);
const variance = Math.abs(currentPrice - item.quotedPricePence) / currentPrice;
if (variance > 0.15) {
  // 15%+ variance - reject or require confirmation
  return { error: "price_changed", actualPrice: currentPrice };
}
```

---

### 2. HIGH: Idempotency Window Gap

**Scenario:** Duplicate submission detected, but original still processing

**Current Handling:**
```
Request 1: Processing (5 seconds)
Request 2: Arrives at 2 seconds
         → Content hash match (5 min window)
         → No cachedResponse yet (still processing)
         → No submissionId yet (not saved)
         → Falls back to email search
         → Might not find (not committed)
         → Returns 409 error to user
```

**Weakness:** User gets error even though submission will succeed

**Risk Level:** HIGH - Poor UX, customer thinks submission failed

**Recommendation:**
```javascript
// Add "processing" state to idempotency records
// Return "processing" status instead of error
if (idempotencyRecord.status === 'PROCESSING') {
  return {
    status: 'processing',
    message: 'Your submission is being processed. Please wait.',
    retryAfter: 5 // seconds
  };
}
```

---

### 3. HIGH: Cart localStorage Corruption

**Scenario:** Browser localStorage corrupted, version mismatch, or quota exceeded

**Current Handling:**
- Version check (CART_VERSION = 2)
- Try/catch around JSON.parse
- Falls back to empty array

**Weakness:**
- Silent failure - customer loses cart without warning
- No way to recover cart data
- No backup mechanism

**Risk Level:** HIGH - Lost sales, frustrated customers

**Recommendation:**
```javascript
// Add cart backup to sessionStorage
function saveCart() {
  try {
    localStorage.setItem('trade_in_cart', JSON.stringify({ version: CART_VERSION, items: state.cart }));
    sessionStorage.setItem('trade_in_cart_backup', JSON.stringify({ items: state.cart, timestamp: Date.now() }));
  } catch (e) {
    if (e.name === 'QuotaExceededError') {
      showWarning('Storage full. Some items may not be saved.');
    }
  }
}

function loadCart() {
  let cart = loadFromLocalStorage();
  if (!cart && sessionStorage.getItem('trade_in_cart_backup')) {
    cart = JSON.parse(sessionStorage.getItem('trade_in_cart_backup')).items;
    showNotice('Cart restored from backup.');
  }
  return cart || [];
}
```

---

### 4. MEDIUM: Royal Mail API Failure During Submission

**Scenario:** Customer qualifies for free shipping, Royal Mail API fails

**Current Handling:**
- Catch error, log it
- Set `shippingMethod: 'LABEL_FAILED'`
- Submission still succeeds
- No user notification

**Weakness:**
- Customer expects label but doesn't get one
- No retry mechanism
- Customer must contact support

**Risk Level:** MEDIUM - Frustrating but not blocking

**Recommendation:**
```javascript
// Return warning to frontend
if (labelError) {
  response.warnings.push('Free shipping label could not be generated. We will email you a label within 24 hours.');

  // Queue background job to retry
  await queueJob('retry_label_generation', {
    submissionId: submission.id,
    attempts: 0,
    maxAttempts: 3
  });
}
```

---

### 5. MEDIUM: AbortController Race Condition

**Scenario:** Rapid search typing cancels requests, stale data displayed

**Current Handling:**
- AbortController cancels previous request
- Returns `null` on abort
- UI checks for null

**Weakness:**
```
Type: "lu"  → Request 1 sent
Type: "luf" → Request 1 aborted, Request 2 sent
Type: "luff" → Request 2 aborted, Request 3 sent
Network lag: Request 3 fails, Request 2 succeeds late
             → Results from "luf" displayed for "luff" search
```

**Risk Level:** MEDIUM - Confusing search results

**Recommendation:**
```javascript
// Add request sequence number
let searchSequence = 0;

async function searchCards(query) {
  const thisSequence = ++searchSequence;

  // ... make request ...

  const data = await response.json();

  // Ignore if newer search started
  if (thisSequence !== searchSequence) {
    return null; // Stale response
  }

  return data;
}
```

---

### 6. MEDIUM: Email Notification Delivery Failure

**Scenario:** Email fails to send, customer never knows submission succeeded

**Current Handling:**
- 3 retry attempts with exponential backoff
- Logs failure
- Submission still succeeds

**Weakness:**
- Customer doesn't receive confirmation
- No alternate notification channel
- Must check "My Submissions" manually

**Risk Level:** MEDIUM - Customer anxiety

**Recommendation:**
```javascript
// Use contact channel as backup
if (emailFailed && submission.contactChannel) {
  await queueNotification({
    type: submission.contactChannel, // WHATSAPP, TELEGRAM, SIGNAL
    recipient: submission.phone,
    message: `Trade-in ${submission.submissionNumber} received! Check status: ${trackingUrl}`
  });
}
```

---

### 7. LOW: Condition Multiplier Mismatch

**Scenario:** Backend multipliers updated, frontend shows old prices

**Current Handling:**
- Frontend loads multipliers from `/settings` on page load
- Caches for session duration

**Weakness:**
- Admin changes multipliers mid-session
- Customer sees old prices
- Backend calculates with new multipliers
- Price mismatch on submission

**Risk Level:** LOW - Rare, small variance

**Recommendation:**
```javascript
// Include multiplier version in settings response
// Frontend sends version with submission
// Backend validates version matches current
```

---

## Unhandled Scenarios

### 1. Concurrent Cart Modification

**Scenario:** Customer has site open in 2 tabs, modifies cart in both

**Current State:** Each tab has independent state, localStorage sync on page load only

**Impact:** Confusing UX, lost items

**Solution:**
```javascript
// Listen for storage events
window.addEventListener('storage', (e) => {
  if (e.key === 'trade_in_cart') {
    loadCart(); // Reload from storage
    renderCart(); // Re-render UI
    showNotice('Cart updated from another tab');
  }
});
```

---

### 2. Card Removed from Trade-In Program

**Scenario:** Customer adds card to cart, card is later excluded from trade-in

**Current State:**
- Cart holds stale card data
- Submission validation will fail
- Poor error message

**Impact:** Confusing rejection

**Solution:**
```javascript
// Pre-submission validation endpoint
POST /apps/trade-in/validate-cart
Body: { items: [...cart items...] }

Response: {
  valid: false,
  invalidItems: [{
    cardPriceId: "OP01-001",
    reason: "no_longer_accepted",
    message: "This card is no longer accepted for trade-in"
  }]
}
```

---

### 3. Session Timeout During Long Form Completion

**Scenario:** Customer fills form slowly, App Proxy signature expires (5 min)

**Current State:**
- Signature validated at request time
- Long form completion OK
- But if page reloads, signature invalid

**Impact:** Form data lost on reload

**Solution:**
- Store form state in localStorage (already done for cart)
- Add form state recovery on page load
- Refresh page silently re-signs via App Proxy

---

### 4. Customer Account Merge/Delete

**Scenario:** Shopify customer merges accounts or deletes account

**Current State:**
- GDPR webhook handles data deletion
- No merge handling

**Impact:** Orphaned submissions, lost history

**Solution:**
```javascript
// Handle customer merge webhook
POST /webhooks/customers/merge
{
  customer_id: "new_merged_id",
  merged_from: ["old_id_1", "old_id_2"]
}

// Update all Customer records
await prisma.customer.updateMany({
  where: { shopifyCustomerId: { in: merged_from } },
  data: { shopifyCustomerId: customer_id }
});
```

---

### 5. Partial Network Failure

**Scenario:** Request sent successfully, response lost due to network drop

**Current State:**
- Frontend shows error
- Backend created submission
- Idempotency prevents duplicate on retry

**Impact:** Customer thinks submission failed, but it succeeded

**Solution:**
```javascript
// Add submission check before showing error
async function submitTradeIn(formData) {
  try {
    const response = await fetchWithTimeout(...);
    return handleSuccess(response);
  } catch (error) {
    // Before showing error, check if submission exists
    const existingSubmission = await checkRecentSubmission(formData.email);
    if (existingSubmission) {
      return handleSuccess({ submission: existingSubmission, recovered: true });
    }
    return handleError(error);
  }
}
```

---

### 6. Browser Back Button After Submission

**Scenario:** Customer submits, sees success, presses back button

**Current State:**
- Form shows with old data
- Cart still has items (cleared async)
- Can attempt re-submit

**Impact:** Confusing UX, potential duplicate attempt

**Solution:**
```javascript
// Use replaceState to prevent back navigation to form
history.replaceState(null, '', '/pages/trade-in-success');

// Or show modal if back detected
window.addEventListener('popstate', (e) => {
  if (submissionComplete) {
    showModal('Your submission was already completed. Start a new trade-in?');
    history.pushState(null, '', '/pages/trade-in-app');
  }
});
```

---

### 7. Image CDN Failure

**Scenario:** Card images fail to load from CDN

**Current State:**
- Broken image shown
- No fallback

**Impact:** Poor UX, hard to identify cards

**Solution:**
```javascript
// Add fallback image handler
function handleImageError(img) {
  img.src = '/assets/card-placeholder.svg';
  img.classList.add('trade-in-card__image--placeholder');
}

// In HTML
<img src="..." onerror="handleImageError(this)">
```

---

### 8. Bank Details Validation Mismatch

**Scenario:** Customer enters valid UK bank details, but bank doesn't accept them

**Current State:**
- Format validation only (6-digit sort, 8-digit account)
- No Modulus check
- Payout may fail

**Impact:** Delayed payout, customer contact required

**Solution:**
```javascript
// Add UK bank Modulus validation
// https://www.vocalink.com/tools/modulus-checking
import { validateBankDetails } from 'uk-modulus-checking';

const isValid = validateBankDetails(sortCode, accountNumber);
if (!isValid) {
  return { error: 'invalid_bank_details', message: 'Please check your sort code and account number' };
}
```

---

### 9. Timezone Handling

**Scenario:** Customer in different timezone, timestamps confusing

**Current State:**
- All times stored as UTC
- Displayed as ISO strings
- No timezone conversion

**Impact:** Confusing dates ("submitted tomorrow?")

**Solution:**
```javascript
// Format dates in user's timezone
function formatDate(isoString) {
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
  }).format(new Date(isoString));
}
```

---

### 10. Mobile Keyboard Covering Submit Button

**Scenario:** On mobile, keyboard covers submit button when filling form

**Current State:**
- No scroll management
- Button may be hidden

**Impact:** User can't find submit button

**Solution:**
```css
/* Add padding for keyboard */
.trade-in-form__submit-section {
  padding-bottom: env(safe-area-inset-bottom, 20px);
}
```

```javascript
// Scroll button into view when form valid
function onFormValid() {
  submitButton.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
```

---

## Optimization Recommendations

### Priority 1: Data Integrity

| Issue | Fix | Effort |
|-------|-----|--------|
| Price drift on submission | Re-validate prices against current DB | Medium |
| Idempotency processing state | Add PROCESSING status, return retry-after | Medium |
| Cart corruption recovery | SessionStorage backup | Low |

### Priority 2: User Experience

| Issue | Fix | Effort |
|-------|-----|--------|
| Royal Mail failure notification | Return warning + background retry | Medium |
| Search race condition | Sequence number validation | Low |
| Browser back after submit | History state management | Low |
| Image fallback | Error handler + placeholder | Low |

### Priority 3: Resilience

| Issue | Fix | Effort |
|-------|-----|--------|
| Email failure backup | SMS/WhatsApp notification | High |
| Partial network failure | Check existing submission | Medium |
| Card exclusion handling | Pre-submission validation | Medium |

### Priority 4: Nice-to-Have

| Issue | Fix | Effort |
|-------|-----|--------|
| Multi-tab cart sync | Storage event listener | Low |
| Timezone display | Intl.DateTimeFormat | Low |
| Bank Modulus check | Third-party library | Medium |
| Customer merge webhook | Webhook handler | Medium |

---

## Quick Reference

### API Endpoints

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/apps/trade-in/settings` | GET | None | Load config |
| `/apps/trade-in/cards/search` | GET | App Proxy | Search cards |
| `/apps/trade-in/cards/browse` | GET | App Proxy | Browse cards |
| `/apps/trade-in/cards/sets` | GET | App Proxy | Get sets |
| `/apps/trade-in/cards/languages` | GET | App Proxy | Get languages |
| `/apps/trade-in/submissions` | POST | App Proxy | Create submission |
| `/apps/trade-in/track` | GET | None | Track submission |
| `/apps/trade-in/my-submissions` | GET | Session Token | Customer history |
| `/apps/trade-in/packing-slip/{n}` | GET | App Proxy | Download slip |

### Status Flow

```
DRAFT → SUBMITTED → IN_TRANSIT → RECEIVED → GRADING → PENDING_APPROVAL → APPROVED → COMPLETED
                                                  ↓                          ↓
                                              RETURNED                   CANCELLED
```

### Key Files

**Frontend:**
- `assets/trade-in-app.js` - Main application (1,655 lines)
- `assets/trade-in-track.js` - Tracking page (335 lines)
- `assets/trade-in-app.css` - Styles (2,378 lines)
- `templates/page.trade-in-app.liquid` - Main template

**Backend:**
- `app/routes/api.storefront.$.tsx` - App Proxy router
- `app/routes/api.submissions.tsx` - Submission handler
- `app/lib/submissions.server.ts` - Business logic
- `app/lib/app-proxy.server.ts` - Auth validation
- `app/lib/idempotency.server.ts` - Duplicate prevention
- `app/lib/shipping.server.ts` - Label generation

### Environment Variables

**Required:**
- `SHOPIFY_API_KEY` - App client ID
- `SHOPIFY_API_SECRET` - API secret
- `DATABASE_URL` - PostgreSQL connection

**Optional:**
- `ROYAL_MAIL_API_KEY` - Click & Drop API
- `MERCHANT_EMAIL` - Admin notifications
- `CRON_SECRET` - Cron job auth

---

## Document Maintenance

This document should be updated when:
1. New API endpoints are added
2. Authentication flow changes
3. New failure modes are discovered
4. Optimizations are implemented

**Authors:** Claude Code Analysis
**Review Cycle:** Monthly
