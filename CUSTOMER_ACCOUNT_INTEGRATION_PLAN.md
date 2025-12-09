# Customer Account Integration Plan

## Overview

Integrate trade-in submission history with Shopify's customer account system so logged-in customers can:
1. View all their trade-in submissions in one place
2. Track submission status without entering a reference number
3. Access packing slips and shipping instructions for pending submissions
4. Review grading results and accept/reject offers

## Current State Analysis

### Existing Infrastructure

```
┌─────────────────────────────────────────────────────────────────────┐
│ Database Schema                                                      │
├─────────────────────────────────────────────────────────────────────┤
│ Customer                                                             │
│   - id (CUID)                                                       │
│   - shopifyCustomerId (BigInt, nullable) ← Links to Shopify        │
│   - email                                                            │
│   - firstName, lastName                                              │
│                                                                      │
│ TradeInSubmission                                                    │
│   - customerId → Customer.id                                        │
│   - submissionNumber (TRD-YYYYMM-XXXXX)                             │
│   - status, items, totals, etc.                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Existing Theme Extension Components
- `trade-in-form.liquid` - Submission form (has access to `{{ customer }}`)
- `trade-in-tracker.liquid` - Lookup by submission number
- `trade-in.js` - Client-side logic
- `trade-in.css` - Styles

### Existing API Endpoints
- `GET /apps/trade-in/track?number=XXX` - Public tracking by number
- `POST /apps/trade-in/submissions` - Create submission
- `GET /apps/trade-in/cards/search` - Card search

## Proposed Architecture

### Authentication Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                      Customer Views Submissions                      │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Storefront (Logged In)                                             │
│  ┌─────────────────────┐                                            │
│  │ {{ customer.id }}   │                                            │
│  │ {{ customer.email }}│                                            │
│  └─────────┬───────────┘                                            │
│            │                                                         │
│            ▼                                                         │
│  ┌─────────────────────┐     ┌─────────────────────┐                │
│  │ App Proxy Request   │────▶│ /apps/trade-in/     │                │
│  │ + logged_in_customer│     │ my-submissions      │                │
│  │ + signature         │     └─────────┬───────────┘                │
│  └─────────────────────┘               │                            │
│                                        ▼                            │
│                          ┌─────────────────────────┐                │
│                          │ Validate Signature      │                │
│                          │ Extract Customer ID     │                │
│                          │ Query Submissions       │                │
│                          └─────────────────────────┘                │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### App Proxy Customer Context

Shopify App Proxy automatically includes customer information when a logged-in customer makes a request:
- `logged_in_customer_id` - Shopify customer ID
- `signature` - HMAC signature for validation

This allows us to securely identify the customer without additional auth.

## Implementation Plan

### Phase 1: API Endpoints

#### 1.1 Customer Submissions Endpoint
**File**: `app/routes/api.my-submissions.tsx`

```typescript
// GET /apps/trade-in/my-submissions
// Returns all submissions for the logged-in customer

interface CustomerSubmissionsResponse {
  submissions: {
    id: string;
    submissionNumber: string;
    status: string;
    statusLabel: string;
    itemCount: number;
    quotedTotal: number;
    finalTotal: number | null;
    payoutType: string;
    createdAt: string;
    submittedAt: string | null;
    // Quick actions available
    canDownloadPackingSlip: boolean;
    canTrack: boolean;
    needsReview: boolean;
  }[];
  stats: {
    total: number;
    pending: number;
    completed: number;
    totalEarned: number;
  };
}
```

#### 1.2 Single Submission Detail Endpoint
**File**: `app/routes/api.my-submissions.$number.tsx`

```typescript
// GET /apps/trade-in/my-submissions/TRD-XXXX-XXXXX
// Returns detailed view of a single submission (only if owned by customer)

interface SubmissionDetailResponse {
  submission: {
    // Full submission details
    submissionNumber: string;
    status: string;
    statusLabel: string;
    statusDescription: string;
    items: ItemDetail[];
    timeline: TimelineStep[];
    quotedTotal: number;
    finalTotal: number | null;
    payoutType: string;
    payoutStatus: string | null;
    // Grading results if applicable
    gradingResults: GradingResults | null;
  };
  actions: {
    canDownloadPackingSlip: boolean;
    canViewShippingInstructions: boolean;
    canAcceptOffer: boolean;
    canRejectOffer: boolean;
    canCancel: boolean;
  };
}
```

#### 1.3 Customer Actions Endpoint
**File**: `app/routes/api.my-submissions.$number.action.tsx`

```typescript
// POST /apps/trade-in/my-submissions/TRD-XXXX-XXXXX/action
// Allows customer to accept/reject grading or cancel submission

interface ActionRequest {
  action: 'accept' | 'reject' | 'cancel' | 'update-tracking';
  trackingNumber?: string;
  reason?: string;
}
```

### Phase 2: Theme Extension Components

#### 2.1 My Submissions Block
**File**: `extensions/trade-in-blocks/blocks/my-submissions.liquid`

A new block that shows the customer's submission history:

```liquid
{% if customer %}
  <div class="trade-in-account" data-my-submissions data-api-base="/apps/trade-in">
    <!-- Header -->
    <div class="trade-in-account__header">
      <h2>My Trade-Ins</h2>
      <a href="/pages/trade-in" class="trade-in-account__new-btn">
        + New Trade-In
      </a>
    </div>

    <!-- Stats Summary -->
    <div class="trade-in-account__stats" data-account-stats>
      <!-- Populated by JS -->
    </div>

    <!-- Submissions List -->
    <div class="trade-in-account__list" data-submissions-list>
      <div class="trade-in-spinner"></div>
    </div>

    <!-- Empty State -->
    <div class="trade-in-account__empty" data-empty-state hidden>
      <p>You haven't submitted any trade-ins yet.</p>
      <a href="/pages/trade-in" class="trade-in-btn trade-in-btn--primary">
        Start Your First Trade-In
      </a>
    </div>
  </div>
{% else %}
  <div class="trade-in-account trade-in-account--guest">
    <h2>My Trade-Ins</h2>
    <p>Log in to view your trade-in history and track submissions.</p>
    <a href="/account/login" class="trade-in-btn trade-in-btn--primary">
      Log In
    </a>
    <p class="trade-in-account__track-note">
      Or <a href="/pages/track-trade-in">track a submission</a> using your reference number.
    </p>
  </div>
{% endif %}
```

#### 2.2 Submission Card Component
Reusable card showing submission summary:

```html
<div class="trade-in-submission-card">
  <div class="trade-in-submission-card__header">
    <span class="trade-in-submission-card__number">TRD-202512-00002</span>
    <span class="trade-in-submission-card__status trade-in-submission-card__status--submitted">
      Submitted
    </span>
  </div>
  <div class="trade-in-submission-card__body">
    <div class="trade-in-submission-card__info">
      <span class="trade-in-submission-card__items">3 cards</span>
      <span class="trade-in-submission-card__value">£413.80</span>
      <span class="trade-in-submission-card__payout">Store Credit</span>
    </div>
    <div class="trade-in-submission-card__date">
      Submitted Dec 9, 2025
    </div>
  </div>
  <div class="trade-in-submission-card__actions">
    <a href="#" class="trade-in-submission-card__action" data-view-details>
      View Details
    </a>
    <a href="/apps/trade-in/packing-slip/TRD-202512-00002" target="_blank"
       class="trade-in-submission-card__action">
      Packing Slip
    </a>
  </div>
</div>
```

#### 2.3 Submission Detail Modal/Page
Expandable detail view showing:
- Full item list with grading status
- Timeline visualization
- Action buttons (accept/reject for pending approval)
- Payout information

### Phase 3: JavaScript Enhancement

#### 3.1 Account Module
**File**: `extensions/trade-in-blocks/assets/trade-in-account.js`

```javascript
// Handles customer account features:
// - Fetch and display submissions
// - Handle pagination
// - Real-time status updates
// - Accept/reject actions
// - Cancel submission
```

### Phase 4: Customer Linking

#### 4.1 Automatic Linking on Submission
When a logged-in customer submits:
1. Get `shopifyCustomerId` from Liquid `{{ customer.id }}`
2. Find or create Customer record with that Shopify ID
3. Link submission to customer

#### 4.2 Email-Based Linking for Guests
When a guest submits with an email:
1. If email matches existing Customer with Shopify ID → link
2. If no match → create new Customer (no Shopify ID)
3. If customer later logs in with same email → merge accounts

#### 4.3 Account Merge Webhook
Listen for `customers/update` webhook to link existing submissions when:
- Guest creates account with same email as previous submissions
- Customer email changes

### Phase 5: Email Integration

#### 5.1 Include Account Links in Emails
Update notification emails to include:
- "View in your account" link for logged-in customers
- "Create an account to track all submissions" for guests

#### 5.2 Email Templates Update
```html
{% if customer_has_account %}
  <a href="https://store.com/account#trade-ins">
    View All Your Trade-Ins
  </a>
{% else %}
  <a href="https://store.com/account/register?email={{email}}">
    Create an Account to Track Submissions
  </a>
{% endif %}
```

## File Changes Summary

### New Files
1. `app/routes/api.my-submissions.tsx` - List customer submissions
2. `app/routes/api.my-submissions.$number.tsx` - Submission detail
3. `app/routes/api.my-submissions.$number.action.tsx` - Customer actions
4. `extensions/trade-in-blocks/blocks/my-submissions.liquid` - Account block
5. `extensions/trade-in-blocks/assets/trade-in-account.js` - Account JS
6. `extensions/trade-in-blocks/assets/trade-in-account.css` - Account styles

### Modified Files
1. `app/lib/app-proxy.server.ts` - Add customer extraction helper
2. `app/routes/api.submissions.tsx` - Link Shopify customer on submit
3. `app/lib/notifications.server.ts` - Add account links to emails
4. `extensions/trade-in-blocks/locales/en.default.json` - Add translations

## UI/UX Mockups

### My Submissions Page (Customer Account)

```
┌─────────────────────────────────────────────────────────────────────┐
│  My Trade-Ins                              [+ New Trade-In]         │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐            │
│  │    3     │  │    1     │  │    2     │  │ £847.50  │            │
│  │  Total   │  │ Pending  │  │ Complete │  │  Earned  │            │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘            │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │ TRD-202512-00002                              [SUBMITTED]       ││
│  │ 3 cards • £413.80 • Store Credit                                ││
│  │ Submitted Dec 9, 2025                                           ││
│  │ [View Details]  [Packing Slip]  [Shipping Info]                 ││
│  └─────────────────────────────────────────────────────────────────┘│
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │ TRD-202511-00015                              [COMPLETED]       ││
│  │ 5 cards • £234.50 • Store Credit                                ││
│  │ Completed Nov 28, 2025                                          ││
│  │ [View Details]                                                  ││
│  └─────────────────────────────────────────────────────────────────┘│
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### Submission Detail View (Expanded)

```
┌─────────────────────────────────────────────────────────────────────┐
│  ← Back to My Trade-Ins                                             │
│                                                                      │
│  TRD-202512-00002                                    [SUBMITTED]    │
│  Submitted December 9, 2025                                         │
│                                                                      │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Timeline                                                            │
│  ────────────────────────────────────────────────────────────────   │
│  ● Submitted ─────── ○ In Transit ─── ○ Received ─── ○ Complete    │
│    Dec 9                                                            │
│                                                                      │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Items (3)                                                          │
│  ────────────────────────────────────────────────────────────────   │
│  ┌────────┐  Portgas D. Ace Alt Art                                │
│  │ Image  │  OP02-013 • Manga Parallel • NM                        │
│  └────────┘  £413.80                                    [PENDING]   │
│                                                                      │
│  ┌────────┐  Monkey D. Luffy Leader                                │
│  │ Image  │  OP01-001 • Parallel • NM                              │
│  └────────┘  £125.00                                    [PENDING]   │
│                                                                      │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Summary                                                            │
│  ────────────────────────────────────────────────────────────────   │
│  Quoted Total:     £538.80                                          │
│  Payout Method:    Store Credit (+10%)                              │
│  You'll Receive:   £592.68                                          │
│                                                                      │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Next Steps                                                         │
│  ────────────────────────────────────────────────────────────────   │
│  1. Print your packing slip                                         │
│  2. Pack cards safely with penny sleeves + toploaders               │
│  3. Ship to our address via tracked delivery                        │
│                                                                      │
│  [Download Packing Slip]    [Shipping Instructions]                 │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### Pending Approval View (Grading Complete)

```
┌─────────────────────────────────────────────────────────────────────┐
│  TRD-202512-00001                            [REVIEW REQUIRED]      │
│                                                                      │
│  ⚠️ Grading Complete - Action Required                              │
│                                                                      │
│  Some items were adjusted during grading. Please review the         │
│  results and accept or reject the offer.                            │
│                                                                      │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Items (2 adjusted)                                                 │
│  ────────────────────────────────────────────────────────────────   │
│                                                                      │
│  ┌────────┐  Portgas D. Ace Alt Art                                │
│  │ Image  │  Claimed: NM → Actual: LP                   [ADJUSTED] │
│  └────────┘  £413.80 → £324.80                                      │
│              Reason: Light scratching on back                       │
│                                                                      │
│  ┌────────┐  Monkey D. Luffy Leader                                │
│  │ Image  │  Claimed: NM → Actual: NM                   [VERIFIED] │
│  └────────┘  £125.00                                                │
│                                                                      │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Updated Offer                                                      │
│  ────────────────────────────────────────────────────────────────   │
│  Original Quote:   £538.80                                          │
│  Adjusted Total:   £449.80  (-£89.00)                               │
│  Store Credit:     £494.78  (+10% bonus)                            │
│                                                                      │
│  ┌────────────────────────┐  ┌────────────────────────┐            │
│  │   Accept Offer         │  │   Request Return       │            │
│  │   (Get £494.78 credit) │  │   (Cards sent back)    │            │
│  └────────────────────────┘  └────────────────────────┘            │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

## Security Considerations

1. **App Proxy Signature Validation**
   - All customer-facing API requests must validate HMAC signature
   - Never trust client-provided customer ID without signature

2. **Customer Ownership Verification**
   - Always verify submission belongs to requesting customer
   - Use database join on `customerId` + `shopifyCustomerId`

3. **Rate Limiting**
   - Apply rate limits to prevent enumeration attacks
   - Stricter limits on action endpoints

4. **Sensitive Data**
   - Don't expose internal IDs to customers
   - Mask email addresses in responses
   - Log access attempts for audit

## Implementation Order

1. **API Endpoints** (Backend first)
   - `api.my-submissions.tsx`
   - `api.my-submissions.$number.tsx`
   - Update app-proxy.server.ts for customer extraction

2. **Theme Block** (Customer-facing UI)
   - `my-submissions.liquid`
   - `trade-in-account.js`
   - `trade-in-account.css`

3. **Customer Linking**
   - Update submission creation to link Shopify customer
   - Add webhook for customer updates

4. **Customer Actions**
   - `api.my-submissions.$number.action.tsx`
   - Accept/reject UI in theme block

5. **Email Updates**
   - Add account links to notification templates

## Testing Checklist

- [ ] Logged-in customer can see their submissions
- [ ] Guest cannot access my-submissions endpoints
- [ ] Customer can only see their own submissions
- [ ] Submissions from same email are grouped
- [ ] Status updates reflect in customer view
- [ ] Accept/reject actions work for PENDING_APPROVAL
- [ ] Packing slip/shipping links work
- [ ] Mobile responsive
- [ ] Performance < 500ms response time
