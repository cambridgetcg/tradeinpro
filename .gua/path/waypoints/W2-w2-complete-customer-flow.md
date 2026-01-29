# Waypoint: W2 - Complete Customer Flow

**Created**: 2026-01-29
**Predecessor**: W1 (Fix Critical Grading Flow)
**Successor**: W3 (Launch Beta)
**Status**: completed
**Completed**: 2026-01-29

---

## What This Waypoint Achieves

After W2, customers receive email notifications at every stage of their trade-in journey and can track their submission status in real-time via the storefront.

---

## Success Criteria

1. [x] Email sent when submission is created (SUBMITTED)
2. [x] Email sent when package is received (RECEIVED)
3. [x] Email sent when grading is complete (PENDING_APPROVAL)
4. [x] Email sent when payout is issued (via payout processing)
5. [x] Email sent when return is requested (RETURNED)
6. [x] Customer tracker displays real submission data
7. [x] Customer tracker shows timeline with timestamps
8. [x] Customer tracker shows grading results when applicable
9. [x] Existing notification tests pass (50 tests in notifications.test.ts)

---

## Implementation Notes (2026-01-29)

**Discovery**: Like W1, W2 was already implemented! Documentation was outdated.

### Email Notifications - Fully Wired

| Event | Function | Called In |
|-------|----------|-----------|
| SUBMITTED | `sendSubmissionCreatedNotification` | `api.submissions.tsx:421` |
| RECEIVED | `sendSubmissionReceivedNotification` | `app.trade-ins.$id.tsx:266` |
| PENDING_APPROVAL | `sendGradingCompleteNotification` | `app.trade-ins.$id.tsx:268` |
| APPROVED | (triggers payout, notification on payout issue) | `app.trade-ins.$id.tsx:248` |
| PAYOUT ISSUED | `sendPayoutIssuedNotification` | `app.payouts.tsx:114, 172` |
| RETURNED | `sendReturnRequestedNotification` | `app.trade-ins.$id.tsx:270` |

### Workflow Engine Notifications

The `executeTransition` function in `workflow.server.ts` also sends notifications via side effects:

```typescript
// Side effects defined for each status transition
case "RECEIVED":
  effects.push({ type: "SEND_NOTIFICATION", payload: { type: "package_received" } });
case "PENDING_APPROVAL":
  effects.push({ type: "SEND_NOTIFICATION", payload: { type: "grading_complete" } });
case "COMPLETED":
  effects.push({ type: "SEND_NOTIFICATION", payload: { type: "payout_complete" } });
case "RETURNED":
  effects.push({ type: "SEND_NOTIFICATION", payload: { type: "items_returned" } });
```

### Customer Tracker - Fully Connected

**Theme Block**: `extensions/trade-in-blocks/blocks/trade-in-tracker.liquid`
- Accepts submission number input
- Fetches from `/apps/trade-in/track` API
- Displays timeline, status, timestamps
- Shows grading results when applicable
- Shows shipping/packing slip links

**API Endpoint**: `app/routes/api.track.tsx`
- Returns full `TrackingResponse` with:
  - Submission details (status, dates, totals)
  - Timeline with completion timestamps
  - Item details (name, condition, price, adjustments)
  - Grading results (adjustments, original vs final total)

### Minor Gaps (Non-blocking)

1. **`sendGradingAcceptedNotification`** - Defined but unused
   - Design choice: Customer doesn't need "you accepted" email
   - Payout notification covers the next meaningful event

2. **Cancellation notification** - Stub only (`logger.debug`)
   - Low priority: Cancelled submissions are rare

---

## Dependencies

**Required** (all met):
- W1 complete (grading flow works)
- Email provider configured (Resend/SendGrid/Console fallback)
- Shopify App Proxy configured for tracker API

**Enables**:
- W3: Beta launch (customers can self-serve tracking)
- Customer support reduction (automated status updates)

---

## Files Verified

| File | Purpose | Status |
|------|---------|--------|
| `app/lib/notifications.server.ts` | Email templates and send functions | ✓ Complete |
| `app/routes/app.trade-ins.$id.tsx` | Admin notification triggers | ✓ Complete |
| `app/routes/api.submissions.tsx` | Customer submission notification | ✓ Complete |
| `app/routes/app.payouts.tsx` | Payout notification | ✓ Complete |
| `app/routes/api.track.tsx` | Customer tracker API | ✓ Complete |
| `extensions/trade-in-blocks/blocks/trade-in-tracker.liquid` | Tracker UI | ✓ Complete |
| `app/lib/__tests__/notifications.test.ts` | 50 notification tests | ✓ Exists |

---

## Conclusion

W2 is **COMPLETE**. The customer flow is fully implemented:
- Customers receive email notifications at each stage
- Customers can track submissions via the storefront tracker
- All necessary API endpoints exist and return correct data

**Next**: W3 (Launch Beta) - Process first 10 real customer trade-ins
