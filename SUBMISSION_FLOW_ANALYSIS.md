# Trade-In Submission Flow Analysis

## Executive Summary

This document provides a detailed analysis of the dataflow between the trade-in submission process (admin side) and the Customer Account UI Extension (customer side). The analysis identifies the complete state machine, data synchronization points, and any gaps in the flow.

**Last Updated:** December 29, 2024

---

## 1. Workflow State Machine

### 1.1 Submission Status Flow

```
                                  TRADE-IN SUBMISSION LIFECYCLE

  ┌─────────┐    ┌───────────┐    ┌────────────┐    ┌──────────┐    ┌─────────┐
  │  DRAFT  │───▶│ SUBMITTED │───▶│ IN_TRANSIT │───▶│ RECEIVED │───▶│ GRADING │
  └─────────┘    └───────────┘    └────────────┘    └──────────┘    └─────────┘
       │              │                  │                │              │
       │              │                  │                │              │
       ▼              ▼                  ▼                ▼              ▼
  ┌───────────┐  ┌───────────┐     ┌──────────┐    ┌──────────┐   ┌─────────────────┐
  │ CANCELLED │  │ CANCELLED │     │ RETURNED │    │ RETURNED │   │ PENDING_APPROVAL│
  └───────────┘  └───────────┘     └──────────┘    └──────────┘   └────────┬────────┘
                                                                           │
                                                                  ┌────────┴────────┐
                                                                  ▼                 ▼
                                                           ┌──────────┐       ┌──────────┐
                                                           │ APPROVED │       │ RETURNED │
                                                           └────┬─────┘       └──────────┘
                                                                │
                                                                ▼
                                                          ┌───────────┐
                                                          │ COMPLETED │
                                                          └───────────┘
```

### 1.2 Valid Transitions (from `workflow.server.ts:55-91`)

| From Status | Valid Next Statuses |
|-------------|---------------------|
| DRAFT | SUBMITTED, CANCELLED |
| SUBMITTED | IN_TRANSIT, RECEIVED, CANCELLED |
| IN_TRANSIT | RECEIVED, RETURNED |
| RECEIVED | GRADING, RETURNED |
| GRADING | PENDING_APPROVAL, APPROVED*, RETURNED |
| PENDING_APPROVAL | APPROVED, RETURNED, GRADING |
| APPROVED | COMPLETED, PENDING_APPROVAL |
| COMPLETED | *(terminal)* |
| CANCELLED | *(terminal)* |
| RETURNED | *(terminal)* |

*\* GRADING → APPROVED is auto-approve when below threshold*

### 1.3 Timestamp Tracking

Each status transition updates specific timestamps:

| Status | Timestamp Updated | Purpose |
|--------|-------------------|---------|
| SUBMITTED | `submittedAt` | When customer submits |
| RECEIVED | `receivedAt` | When package arrives |
| GRADING | - | (uses receivedAt if not set) |
| PENDING_APPROVAL | `gradedAt` | When grading complete |
| APPROVED | `approvedAt`, `gradedAt` | When approved for payout |
| COMPLETED | `completedAt` | When payout processed |

---

## 2. Dataflow Architecture

### 2.1 System Components

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              ADMIN INTERFACE                                 │
│  ┌──────────────────────┐  ┌──────────────────────┐  ┌──────────────────┐  │
│  │  Trade-In Queue      │  │  Grading Interface   │  │  Payouts Page    │  │
│  │  app.trade-ins.tsx   │  │  app.trade-ins.$id   │  │  app.payouts.tsx │  │
│  └──────────┬───────────┘  └──────────┬───────────┘  └────────┬─────────┘  │
│             │                         │                        │            │
└─────────────┼─────────────────────────┼────────────────────────┼────────────┘
              │                         │                        │
              ▼                         ▼                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              DATABASE (PostgreSQL)                           │
│  ┌────────────────────┐  ┌────────────────────┐  ┌────────────────────┐    │
│  │ TradeInSubmission  │  │   TradeInItem      │  │     Payout         │    │
│  │ - status           │  │ - status           │  │ - status           │    │
│  │ - quotedTotal      │  │ - conditionClaimed │  │ - totalAmount      │    │
│  │ - finalTotal       │  │ - conditionActual  │  │ - giftCardCode     │    │
│  │ - timestamps       │  │ - quotedPrice      │  │ - bankReference    │    │
│  └────────────────────┘  │ - finalPrice       │  └────────────────────┘    │
│                          └────────────────────┘                             │
└─────────────────────────────────────────────────────────────────────────────┘
              │                         │                        │
              ▼                         ▼                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         CUSTOMER API (App Proxy)                             │
│  ┌──────────────────────┐  ┌──────────────────────┐  ┌──────────────────┐  │
│  │  api.my-submissions  │  │  api.my-submissions  │  │  api.my-submiss  │  │
│  │  (list)              │  │  .$number (detail)   │  │  .$number.action │  │
│  └──────────┬───────────┘  └──────────┬───────────┘  └────────┬─────────┘  │
│             │                         │                        │            │
└─────────────┼─────────────────────────┼────────────────────────┼────────────┘
              │                         │                        │
              ▼                         ▼                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      CUSTOMER ACCOUNT UI EXTENSION                           │
│  ┌──────────────────────┐  ┌──────────────────────┐  ┌──────────────────┐  │
│  │  TradeInPage.tsx     │  │  SubmissionDetail    │  │  GradingReview   │  │
│  │  (submission list)   │  │  (full details)      │  │  (accept/reject) │  │
│  └──────────────────────┘  └──────────────────────┘  └──────────────────┘  │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Data Synchronization Points

| Event | Source | Database Update | Customer API Reflects | Email Sent |
|-------|--------|-----------------|----------------------|------------|
| Customer submits | Storefront | status=SUBMITTED, submittedAt | Immediate | SUBMITTED notification |
| Package received | Admin | status=RECEIVED, receivedAt | Immediate | RECEIVED notification |
| Grading starts | Admin | status=GRADING | Immediate | - |
| Grading complete | Admin | status=PENDING_APPROVAL, gradedAt | Immediate | PENDING_APPROVAL notification |
| Customer accepts | Extension | status=APPROVED, approvedAt | Immediate | **GAP** (see 4.1) |
| Customer rejects | Extension | status=RETURNED | Immediate | **GAP** (see 4.2) |
| Admin approves | Admin | status=APPROVED, payout created | Immediate | - |
| Gift card issued | Admin | payout=COMPLETED, submission=COMPLETED | Immediate | COMPLETED notification |
| Bank transfer done | Admin | payout=COMPLETED, submission=COMPLETED | Immediate | COMPLETED notification |
| Admin returns | Admin | status=RETURNED | Immediate | RETURNED notification |

---

## 3. Detailed Flow Analysis

### 3.1 Happy Path: Store Credit

```
Timeline    Actor       Action                      Status              Customer Sees
────────────────────────────────────────────────────────────────────────────────────────
T+0         Customer    Creates submission          DRAFT               -
T+1         Customer    Submits via storefront      SUBMITTED           "Please send your cards"
            Email       → Confirmation sent
T+2         Customer    Ships cards                 IN_TRANSIT          "Your package is on its way"
T+3         Admin       Marks received              RECEIVED            "We have your cards"
            Email       → Package received
T+4         Admin       Starts grading              GRADING             "Our team is verifying"
T+5         Admin       Completes grading           PENDING_APPROVAL    "Please review and accept"
            Email       → Grading complete
T+6         Customer    Accepts offer (Extension)   APPROVED            "Processing your payment"
            **GAP**     → Payout should be created
T+7         Admin       Issues gift card            COMPLETED           "Payment sent!"
            Email       → Payout issued
```

### 3.2 Happy Path: Bank Transfer

```
Timeline    Actor       Action                      Status              Customer Sees
────────────────────────────────────────────────────────────────────────────────────────
T+0-T+5     (same as store credit path)
T+6         Customer    Accepts offer (Extension)   APPROVED            "Processing your payment"
T+7         Admin       Marks processing            APPROVED            "Processing your payment"
                        (adds bank reference)
T+8         Admin       Marks completed             COMPLETED           "Payment sent!"
            Email       → Payout issued
```

### 3.3 Return Path (Customer Rejects)

```
Timeline    Actor       Action                      Status              Customer Sees
────────────────────────────────────────────────────────────────────────────────────────
T+0-T+5     (same as store credit path)
T+6         Customer    Rejects offer (Extension)   RETURNED            "Your cards have been returned"
            **GAP**     → Return notification should be sent
T+7         Admin       Ships cards back            RETURNED            "Your cards have been returned"
```

### 3.4 Return Path (Admin Rejects)

```
Timeline    Actor       Action                      Status              Customer Sees
────────────────────────────────────────────────────────────────────────────────────────
T+3         Admin       Marks received, rejects     RETURNED            "Your cards have been returned"
            Email       → Return notification sent
```

---

## 4. Identified Gaps & Issues

### 4.1 ~~GAP: Customer Accept Missing Payout Creation~~ - FIXED

**Location:** `api.my-submissions.$number.action.tsx:147-224`

**Issue:** ~~When customer accepts offer via the UI Extension, the status changes to APPROVED but payout record was NOT created and email notification was NOT sent.~~

**Resolution (December 29, 2024):**
- Added `createPayout()` call after status update to APPROVED
- Added `sendGradingAcceptedNotification()` for customer confirmation
- Created new `buildGradingAcceptedEmail()` template in notifications.server.ts
- All operations wrapped in try/catch to prevent action failures

### 4.2 ~~GAP: Customer Reject Missing Email Notification~~ - FIXED

**Location:** `api.my-submissions.$number.action.tsx:226-292`

**Issue:** ~~When customer rejects offer via the UI Extension, email notification was NOT sent to customer.~~

**Resolution (December 29, 2024):**
- Added `sendReturnRequestedNotification()` call after status update to RETURNED
- Fetches full submission with customer data for email context
- Wrapped in try/catch to prevent action failures

### 4.3 ~~NUANCE: Dual Approval Paths~~ - UNIFIED

**Observation:** There are two ways to approve a submission, now both create payouts:

1. **Admin Approval** (`app.trade-ins.$id.tsx:246-253`)
   - Status → APPROVED
   - Payout auto-created ✅
   - Email sent at payout processing ✅

2. **Customer Approval** (`api.my-submissions.$number.action.tsx:147-224`)
   - Status → APPROVED
   - Payout auto-created ✅ (FIXED)
   - Acceptance email sent ✅ (FIXED)

**Status:** Both paths now create payouts automatically.

### 4.4 NUANCE: Timeline Display for IN_TRANSIT

**Location:** `api.my-submissions.$number.tsx:250-267`

**Issue:** The timeline doesn't have a dedicated timestamp for IN_TRANSIT status. It appears complete once the customer adds tracking, but there's no `inTransitAt` field.

**Impact:** Timeline shows IN_TRANSIT as complete without timestamp verification.

**Recommendation:** Consider adding `inTransitAt` timestamp to submission model, or display tracking number addition time.

---

## 5. Customer API Data Mapping

### 5.1 List Endpoint Response

**Endpoint:** `GET /apps/trade-in/my-submissions`

| Field | Source | Computed |
|-------|--------|----------|
| submissionNumber | TradeInSubmission.submissionNumber | - |
| status | TradeInSubmission.status | - |
| statusLabel | SubmissionStatusLabels[status] | Yes |
| itemCount | _count.items | Yes |
| quotedTotal | TradeInSubmission.quotedTotal | - |
| finalTotal | TradeInSubmission.finalTotal | - |
| needsReview | status === PENDING_APPROVAL | Yes |
| isComplete | status === COMPLETED | Yes |
| canDownloadPackingSlip | status in [SUBMITTED, IN_TRANSIT] | Yes |

### 5.2 Detail Endpoint Response

**Endpoint:** `GET /apps/trade-in/my-submissions/:number`

| Section | Data Source | Notes |
|---------|-------------|-------|
| submission | TradeInSubmission + computed | Includes totalPayout calculation |
| items | TradeInItem[] | Includes wasAdjusted flag |
| timeline | Computed from timestamps | 7-step timeline |
| gradingResults | Computed from items | Only for PENDING_APPROVAL+ |
| actions | Computed from status | Permission flags |

### 5.3 Action Endpoint

**Endpoint:** `POST /apps/trade-in/my-submissions/:number/action`

| Action | Required Status | Result Status | Side Effects |
|--------|-----------------|---------------|--------------|
| accept | PENDING_APPROVAL | APPROVED | Note created, **needs payout** |
| reject | PENDING_APPROVAL | RETURNED | Note created, **needs email** |
| cancel | DRAFT, SUBMITTED | CANCELLED | Note created |
| update_tracking | SUBMITTED, IN_TRANSIT | IN_TRANSIT | Note created |

---

## 6. Item Status Workflow

### 6.1 Item Status Transitions

```
┌─────────┐
│ PENDING │
└────┬────┘
     │
     ├──────────────┬──────────────┐
     ▼              ▼              ▼
┌──────────┐  ┌──────────┐  ┌──────────┐
│ VERIFIED │  │ ADJUSTED │  │ REJECTED │
└────┬─────┘  └────┬─────┘  └──────────┘
     │              │         (terminal)
     └──────┬───────┘
            ▼
     Can re-evaluate
```

### 6.2 Item Status Meaning

| Status | Customer Display | Meaning |
|--------|------------------|---------|
| PENDING | "Pending Review" | Not yet graded |
| VERIFIED | "Verified" | Condition matches claim |
| ADJUSTED | "Adjusted" | Condition downgraded |
| REJECTED | "Rejected" | Item not accepted |

---

## 7. Email Notification Coverage

### 7.1 Current Implementation

| Event | Notification Function | Wired? |
|-------|----------------------|--------|
| SUBMITTED | sendSubmissionCreatedNotification | ✅ Storefront |
| RECEIVED | sendSubmissionReceivedNotification | ✅ Admin |
| PENDING_APPROVAL | sendGradingCompleteNotification | ✅ Admin |
| APPROVED (admin) | - | ✅ (via payout) |
| APPROVED (customer) | sendGradingAcceptedNotification | ✅ Customer Action |
| COMPLETED | sendPayoutIssuedNotification | ✅ Payouts |
| RETURNED (admin) | sendReturnRequestedNotification | ✅ Admin |
| RETURNED (customer) | sendReturnRequestedNotification | ✅ Customer Action |

### 7.2 Notification Data Requirements

All notification functions require:
```typescript
{
  submission: {
    submissionNumber: string;
    quotedTotal: number;
    finalTotal: number | null;
    customer: {
      email: string;
      firstName: string;
      lastName: string;
    };
    items: TradeInItem[];
  }
}
```

---

## 8. Recommendations

### 8.1 ~~Immediate Fixes (P0)~~ - COMPLETE

1. ~~**Wire payout creation on customer accept**~~ ✅ DONE
   - File: `api.my-submissions.$number.action.tsx`
   - Added `createPayout()` call in `handleAccept()`

2. ~~**Wire return email on customer reject**~~ ✅ DONE
   - File: `api.my-submissions.$number.action.tsx`
   - Added `sendReturnRequestedNotification()` call in `handleReject()`

### 8.2 ~~Short-Term Improvements (P1)~~ - COMPLETE

1. ~~**Add confirmation email for customer accept**~~ ✅ DONE
   - Created `sendGradingAcceptedNotification()` function
   - Created `buildGradingAcceptedEmail()` template
   - Wired in customer action handler

2. **Add admin alert for customer actions** (Optional enhancement)
   - When customer accepts/rejects, notify admin
   - Could be dashboard notification or email

### 8.3 Medium-Term Enhancements (P2)

1. **Add IN_TRANSIT timestamp**
   - Add `inTransitAt` to TradeInSubmission model
   - Update timeline display logic

2. **Add real-time status updates**
   - Consider WebSocket or polling for status changes
   - Customer doesn't need to refresh to see updates

3. **Add customer notes visibility**
   - Allow customers to see system notes (non-internal)
   - Show timeline of status changes

---

## 9. Testing Checklist

### 9.1 Admin Flow Tests

- [ ] DRAFT → SUBMITTED updates submittedAt
- [ ] SUBMITTED → RECEIVED updates receivedAt
- [ ] RECEIVED → GRADING works (sets receivedAt if not set)
- [ ] GRADING → PENDING_APPROVAL updates gradedAt
- [ ] GRADING → APPROVED (auto) updates gradedAt and approvedAt
- [ ] APPROVED → COMPLETED updates completedAt
- [ ] All invalid transitions are rejected

### 9.2 Customer API Tests

- [ ] List excludes DRAFT submissions
- [ ] List pagination works correctly
- [ ] Detail returns 404 for other customer's submissions
- [ ] Timeline shows correct completion states
- [ ] Grading results calculated correctly
- [ ] Action permissions match status

### 9.3 Customer Action Tests

- [ ] Accept from PENDING_APPROVAL → APPROVED
- [ ] Reject from PENDING_APPROVAL → RETURNED
- [ ] Cancel from SUBMITTED → CANCELLED
- [ ] Cancel from IN_TRANSIT fails
- [ ] Update tracking adds IN_TRANSIT status

### 9.4 Email Tests

- [ ] SUBMITTED sends confirmation
- [ ] RECEIVED sends acknowledgment
- [ ] PENDING_APPROVAL sends grading review request
- [ ] COMPLETED sends payout confirmation
- [ ] RETURNED sends return notification

---

## 10. Appendix: Key File Locations

| Component | File Path | Purpose |
|-----------|-----------|---------|
| Workflow State Machine | `app/lib/workflow.server.ts` | Status transition rules |
| Admin Queue | `app/routes/app.trade-ins.tsx` | Submission list |
| Admin Grading | `app/routes/app.trade-ins.$id.tsx` | Grading interface |
| Admin Payouts | `app/routes/app.payouts.tsx` | Payout processing |
| Payout Logic | `app/lib/payouts.server.ts` | Payout creation/processing |
| Customer List API | `app/routes/api.my-submissions.tsx` | List submissions |
| Customer Detail API | `app/routes/api.my-submissions.$number.tsx` | Submission details |
| Customer Action API | `app/routes/api.my-submissions.$number.action.tsx` | Accept/reject/cancel |
| Storefront Router | `app/routes/api.storefront.$.tsx` | App Proxy routing |
| Extension Page | `extensions/trade-in-account/src/TradeInPage.tsx` | Customer UI |
| Extension Detail | `extensions/trade-in-account/src/components/SubmissionDetail.tsx` | Detail view |
| Notifications | `app/lib/notifications.server.ts` | Email functions |

---

*Document Version: 1.1*
*Analysis completed by: Claude Code*
*All P0 gaps resolved: December 29, 2024*
