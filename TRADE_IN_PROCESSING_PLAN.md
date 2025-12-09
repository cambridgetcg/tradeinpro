# Trade-In Processing Workflow Plan

## Current State Analysis

### What's Implemented

**Trade-ins List Page** (`app/routes/app.trade-ins.tsx`):
- Status tabs with counts (All, Pending, Grading, Approval, Approved, Completed)
- Search by submission #, customer name/email
- Sort options (newest, oldest, value, received date)
- Pagination
- Days-since-received indicator for grading queue

**Trade-in Detail Page** (`app/routes/app.trade-ins.$id.tsx`):
- Status display with transition buttons
- Summary cards (quoted total, final total, items, payout method)
- Grading progress bar (when in RECEIVED/GRADING status)
- Items list with expand/collapse for grading
- Individual item grading (verify/adjust/reject)
- Bulk grading ("Verify All Remaining")
- Customer info sidebar
- Timeline sidebar
- Notes section

**Payouts Page** (`app/routes/app.payouts.tsx`):
- Payout queue with status filtering
- Gift card issuance via Shopify API
- Bank transfer tracking
- Payout statistics

**Workflow Engine** (`app/lib/workflow.server.ts`):
- Full state machine with transitions
- Validation rules (e.g., all items must be graded)
- Side effect definitions (timestamps, notifications)

---

## Critical Issues to Fix

### Issue 1: Grading Price Recalculation Broken

**Problem**: We set `cardPriceId: null` to fix the FK constraint error, but the grading UI relies on `item.cardPrice` for price lookups:
- Line 255-258 in `app.trade-ins.$id.tsx`: Uses `item.cardPrice[priceKey]` for price calculation
- Line 911-953: Price preview shows `item.cardPrice.priceNM`, etc.

**Solution**: Store condition prices directly on `TradeInItem` at creation time, OR look up prices from `CardPriceV2` during grading.

### Issue 2: Payout Not Auto-Created on Approval

**Problem**: When a submission transitions to APPROVED, no payout record is created automatically.

**Solution**: Call `createPayout()` when transitioning to APPROVED status.

### Issue 3: No Email Notifications

**Problem**: Status changes don't trigger email notifications despite the workflow defining them.

**Solution**: Implement notification sending in the action handler.

---

## Complete Processing Workflow

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                        TRADE-IN SUBMISSION LIFECYCLE                         │
└──────────────────────────────────────────────────────────────────────────────┘

CUSTOMER SUBMITS (Storefront)
         │
         ▼
┌─────────────┐
│  SUBMITTED  │  Customer receives confirmation email
└─────────────┘  Admin sees in "Pending" tab
         │
         │ ◄── Option A: Mark as "In Transit" (if shipping)
         │ ◄── Option B: Mark as "Received" (if drop-off)
         ▼
┌─────────────┐
│  RECEIVED   │  Customer notified package arrived
└─────────────┘  Cards physically in hand
         │
         │ ◄── Click "Start Grading"
         ▼
┌─────────────┐
│   GRADING   │  Grade each item: Verify / Adjust / Reject
└─────────────┘  - Verify: Condition matches, keep quoted price
         │       - Adjust: Condition different, recalculate price
         │       - Reject: Card not accepted, price = £0
         │
         │ ◄── All items graded
         ▼
    ┌────┴────┐
    │         │
    ▼         ▼
┌─────────┐  ┌──────────────────┐
│APPROVED │  │ PENDING_APPROVAL │
└─────────┘  └──────────────────┘
(auto if     (if > threshold OR
< threshold) changes made)
    │              │
    │              │ ◄── Customer approves/rejects
    │              ▼
    │         ┌─────────┐
    │         │APPROVED │
    │         └─────────┘
    │              │
    └──────┬───────┘
           │
           │ ◄── Payout created automatically
           │ ◄── Process payout (Gift Card or Bank Transfer)
           ▼
    ┌───────────┐
    │ COMPLETED │  Customer notified, submission archived
    └───────────┘

Alternative Paths:
    CANCELLED ◄── Admin cancels before receiving
    RETURNED  ◄── Customer rejects grading OR items returned
```

---

## Implementation Tasks

### Phase 1: Fix Critical Grading Issues

#### Task 1.1: Store Condition Prices on TradeInItem Creation
Store all 5 condition prices when creating items so grading doesn't need FK lookup.

**Files to modify:**
- `app/lib/submissions.server.ts` - Store prices in item creation
- `prisma/schema.prisma` - Add price fields to TradeInItem (optional, could use JSON)

**Alternative approach (simpler):**
- Look up prices from `CardPriceV2` table during grading by cardId stored elsewhere
- Store `cardPriceV2Id` on TradeInItem for reference

#### Task 1.2: Update Grading UI to Use New Price Source
Fix the price preview and recalculation in the grading form.

**Files to modify:**
- `app/routes/app.trade-ins.$id.tsx` - Update price calculation logic

---

### Phase 2: Complete Status Transitions

#### Task 2.1: Auto-Create Payout on Approval
When transitioning to APPROVED, automatically create a Payout record.

**Files to modify:**
- `app/routes/app.trade-ins.$id.tsx` - Add `createPayout()` call in action handler

#### Task 2.2: Mark Submission Complete After Payout
When payout is processed, auto-transition submission to COMPLETED.

**Files to modify:**
- `app/routes/app.payouts.tsx` - Update submission status after payout

---

### Phase 3: Enhance Admin Experience

#### Task 3.1: Add Tracking Number Input
For IN_TRANSIT status, allow admin to enter/update tracking number.

**UI Changes:**
- Add text field in detail page for tracking number
- Show tracking link when available

#### Task 3.2: Improve Grading Interface
- Keyboard shortcuts for grading (V=Verify, A=Adjust, R=Reject)
- Auto-advance to next item after grading
- Card image display (from imageUrl in CardPriceV2)

#### Task 3.3: Batch Actions on List Page
- Select multiple submissions
- Bulk mark as Received
- Bulk start Grading
- Export selected

---

### Phase 4: Email Notifications

#### Task 4.1: Send Status Change Emails
Trigger emails on key transitions:
- SUBMITTED → Confirmation with shipping instructions
- RECEIVED → "We got your cards"
- PENDING_APPROVAL → "Grading complete, please review"
- APPROVED → "Your trade-in was approved"
- COMPLETED → "Payout processed"

**Files to modify:**
- `app/routes/app.trade-ins.$id.tsx` - Call notification functions
- `app/lib/notifications.server.ts` - Email templates exist, need to wire up

---

### Phase 5: Customer-Facing Improvements

#### Task 5.1: Submission Tracker
Customer can view their submission status on storefront.

**Already exists:**
- `extensions/trade-in-blocks/blocks/trade-in-tracker.liquid`
- API endpoint for status lookup

#### Task 5.2: Approval Interface
When PENDING_APPROVAL, customer can approve or reject from storefront.

**Already exists:**
- `app/routes/api.submissions.$id.confirm.tsx`
- `app/routes/api.submissions.$id.reject.tsx`

---

## Data Model Considerations

### Current TradeInItem Schema
```prisma
model TradeInItem {
  id              String   @id @default(cuid())
  submissionId    String
  cardPriceId     String?  // FK to CardPrice (BROKEN for CardPriceV2)
  cardName        String   // Denormalized
  setName         String   // Denormalized
  setCode         String?
  variant         String?
  quantity        Int
  conditionClaimed String
  conditionActual  String?
  quotedPrice     Int      // Price at submission time
  finalPrice      Int?     // Price after grading
  adjustmentReason String?
  status          String   // PENDING, VERIFIED, ADJUSTED, REJECTED
}
```

### Proposed Changes for Price Lookup
Option A: Add CardPriceV2 reference
```prisma
model TradeInItem {
  // ... existing fields ...
  cardPriceV2Id   String?  // Reference to CardPriceV2.cardId
  // No FK because cardId format differs, just store for lookup
}
```

Option B: Store all condition prices as JSON
```prisma
model TradeInItem {
  // ... existing fields ...
  pricesByCondition Json?  // {"NM": 1000, "LP": 800, ...}
}
```

Option C: Store market price + multiplier
```prisma
model TradeInItem {
  // ... existing fields ...
  marketPrice     Int?     // Base price in pence
  // Calculate condition prices dynamically using settings multipliers
}
```

**Recommendation**: Option C is cleanest - store the market price and calculate condition prices using the current settings multipliers.

---

## Action Items Summary

| Priority | Task | Effort | Impact |
|----------|------|--------|--------|
| P0 | Fix grading price calculation | Medium | Critical - grading broken |
| P0 | Auto-create payout on approval | Low | Critical - workflow incomplete |
| P1 | Send email notifications | Medium | High - customer experience |
| P1 | Add tracking number input | Low | Medium - workflow completeness |
| P2 | Card images in grading | Low | Medium - UX improvement |
| P2 | Keyboard shortcuts | Low | Low - power user feature |
| P3 | Batch actions | Medium | Medium - efficiency |

---

## Testing the Current Flow

1. **Create submission** (storefront) → Status: SUBMITTED
2. **Admin: Mark Received** → Status: RECEIVED
3. **Admin: Start Grading** → Status: GRADING
4. **Admin: Grade items** (currently broken - needs fix)
5. **Admin: Approve** → Status: APPROVED (payout should auto-create)
6. **Admin: Process payout** (payouts page) → Submission should go to COMPLETED
