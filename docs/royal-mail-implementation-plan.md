# Royal Mail Integration Implementation Plan

> **Date:** 2026-01-01
> **Status:** Planning Complete - Ready for Implementation
> **API Key:** Configured in Vercel ✓

> **Central Reference:** See [TRADE_IN_SYSTEM_SYNAPSE.md](./TRADE_IN_SYSTEM_SYNAPSE.md) for the complete system architecture, weak links, and unhandled scenarios across both frontend and backend.
>
> **Myelin Pathways:**
> - `app/lib/CODE_SYNAPSE.md` → shipping.server.ts, royal-mail.server.ts
> - `app/routes/ROUTES_SYNAPSE.md` → api.submissions.$id.label.tsx, api.cron.tracking.tsx
> - `../../ShopifyTheme_TCG/assets/ASSETS_SYNAPSE.md` → trade-in-app.js (success page label UI)
> - Related research: `royal-mail-integration-research.md`

---

## Table of Contents

1. [Current State Analysis](#current-state-analysis)
2. [Scenarios & Edge Cases](#scenarios--edge-cases)
3. [System Flow Diagrams](#system-flow-diagrams)
4. [Implementation Phases](#implementation-phases)
5. [Phase 1: Service Module](#phase-1-service-module)
6. [Phase 2: Submission Integration](#phase-2-submission-integration)
7. [Phase 3: Frontend Updates](#phase-3-frontend-updates)
8. [Phase 4: Tracking System](#phase-4-tracking-system)
9. [Phase 5: Admin & Polish](#phase-5-admin--polish)
10. [Testing Checklist](#testing-checklist)

---

## Current State Analysis

### Existing Schema Fields (Already Present!)

**TradeInSubmission model:**
```prisma
// Shipping fields (ALREADY EXIST)
shippingMethod      String?   // "PREPAID", "SELF_SHIP", "DROP_OFF"
trackingNumber      String?
labelUrl            String?

// Customer shipping address (ALREADY EXIST)
shippingName        String?
shippingAddress1    String?
shippingAddress2    String?
shippingCity        String?
shippingPostalCode  String?
shippingCountry     String?  @default("GB")

// Royal Mail integration (ALREADY EXIST)
royalMailOrderId    String?
labelPdfBase64      String?  @db.Text
labelGeneratedAt    DateTime?
carrier             String?
```

**TradeInSettings model:**
```prisma
// Shipping settings (ALREADY EXIST)
freeShippingMinimum    Int     @default(5000)  // £50
shippingLabelEnabled   Boolean @default(true)
returnAddress          String?  // JSON string
royalMailEnabled       Boolean @default(false)
royalMailService       String  @default("TPN")  // Tracked 48
```

### What Needs to Be Built

| Component | Status | Notes |
|-----------|--------|-------|
| Database schema | ✅ Ready | Fields already exist |
| `royal-mail.server.ts` | ❌ New | Core service module |
| Submission flow integration | ❌ New | Generate label on submit |
| Label download endpoint | ❌ New | `/api/submissions/{id}/label` |
| Frontend address collection | ❌ New | Optional - see scenarios |
| Tracking poll job | ❌ New | Background status updates |
| Admin shipping view | ❌ New | Optional Phase 5 |

---

## Scenarios & Edge Cases

### Scenario 1: Happy Path - Qualifies for Free Label

```
Conditions:
- quotedTotal >= freeShippingMinimum (£50)
- Customer provides UK address
- Royal Mail API available

Flow:
1. Customer submits trade-in with address
2. Value check: £85 >= £50 ✓
3. Call Royal Mail POST /orders
4. Receive: trackingNumber, labelPdf
5. Store in database
6. Success page shows: Download Label button + tracking number

Result: Customer prints label and ships
```

### Scenario 2: Below Threshold - No Free Label

```
Conditions:
- quotedTotal < freeShippingMinimum

Flow:
1. Customer submits trade-in worth £25
2. Value check: £25 < £50 ✗
3. Skip Royal Mail API call
4. Set shippingMethod = "SELF_SHIP"
5. Success page shows: Self-ship instructions + address

Result: Customer arranges own shipping
```

### Scenario 3: Royal Mail API Failure

```
Conditions:
- API timeout, 5xx error, auth failure

Flow:
1. Customer submits qualifying trade-in
2. Call Royal Mail API → Error/Timeout
3. Log error for monitoring
4. DON'T fail submission - still create it
5. Set shippingMethod = "PENDING"
6. Success page shows: "Label being generated, check email"
7. Admin notified to manually generate label

Result: Submission created, label generated manually later
```

### Scenario 4: Address Not Provided

```
Conditions:
- Customer doesn't provide shipping address
- Trade-in qualifies for free label

Flow:
1. Customer submits without address
2. Value check passes
3. Skip label generation (no address)
4. Set shippingMethod = "ADDRESS_REQUIRED"
5. Success page shows: "Enter address to get free shipping label"
6. Customer enters address later → label generated

Result: Deferred label generation
```

### Scenario 5: Invalid Address

```
Conditions:
- Customer provides address
- Royal Mail rejects (invalid postcode, etc.)

Flow:
1. Customer submits with dodgy address
2. Call Royal Mail API → 400 validation error
3. Log validation errors
4. Submission still created
5. Set shippingMethod = "ADDRESS_INVALID"
6. Success page shows: "Address issue - self-ship or update address"

Result: Customer can update address or self-ship
```

### Scenario 6: Duplicate Label Request

```
Conditions:
- Customer already has label
- Requests again (page refresh, re-download)

Flow:
1. Customer requests /submissions/{id}/label
2. Check: labelPdfBase64 exists?
3. Yes → Return existing label
4. No → Generate new one (if eligible)

Result: No duplicate API calls
```

### Scenario 7: Submission Cancelled

```
Conditions:
- Submission has Royal Mail label
- Customer or admin cancels

Flow:
1. Cancel submission
2. Check: royalMailOrderId exists?
3. Yes → Call DELETE /orders/{id}
4. Label invalidated with Royal Mail
5. Update: shippingMethod = "CANCELLED"

Result: Label can't be used (tracked by Revenue Protection)
```

### Scenario 8: Label Expires (Future)

```
Conditions:
- Label generated but unused for X days
- Royal Mail labels typically valid ~28 days

Flow:
1. Background job checks label age
2. Label > 28 days old?
3. Flag for regeneration or mark expired
4. Notify customer if needed

Result: Fresh label can be generated
```

### Scenario 9: Tracking Updates

```
Conditions:
- Label generated and used
- Package in transit

Flow:
1. Cron job runs every hour
2. Query Royal Mail Tracking API for SUBMITTED submissions with tracking
3. Update shippingStatus based on events
4. When DELIVERED → Update submission status to RECEIVED
5. Send notification email

Result: Real-time status visibility
```

---

## System Flow Diagrams

### Label Generation Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        LABEL GENERATION DECISION TREE                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Customer Submits Trade-In                                                  │
│           │                                                                 │
│           ▼                                                                 │
│  ┌─────────────────┐                                                        │
│  │ royalMailEnabled │─── No ──► shippingMethod = "SELF_SHIP"               │
│  │ in settings?    │           (Royal Mail integration off)                 │
│  └────────┬────────┘                                                        │
│           │ Yes                                                             │
│           ▼                                                                 │
│  ┌─────────────────┐                                                        │
│  │ quotedTotal >=  │─── No ──► shippingMethod = "SELF_SHIP"                │
│  │ freeShipping    │           (Below threshold)                           │
│  │ Minimum? (£50)  │                                                        │
│  └────────┬────────┘                                                        │
│           │ Yes                                                             │
│           ▼                                                                 │
│  ┌─────────────────┐                                                        │
│  │ Customer address│─── No ──► shippingMethod = "ADDRESS_REQUIRED"         │
│  │ provided?       │           (Show address form)                         │
│  └────────┬────────┘                                                        │
│           │ Yes                                                             │
│           ▼                                                                 │
│  ┌─────────────────┐                                                        │
│  │ Call Royal Mail │                                                        │
│  │ POST /orders    │                                                        │
│  └────────┬────────┘                                                        │
│           │                                                                 │
│     ┌─────┴─────┐                                                           │
│     │           │                                                           │
│  Success     Error                                                          │
│     │           │                                                           │
│     ▼           ▼                                                           │
│  Store:      Log error                                                      │
│  - tracking  shippingMethod = "LABEL_FAILED"                               │
│  - label     (Admin notified)                                               │
│  - orderId                                                                  │
│     │                                                                       │
│     ▼                                                                       │
│  shippingMethod = "PREPAID"                                                │
│  carrier = "ROYAL_MAIL"                                                     │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Tracking Update Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           TRACKING UPDATE FLOW                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Cron Job (every 1 hour)                                                    │
│           │                                                                 │
│           ▼                                                                 │
│  Query submissions WHERE:                                                   │
│  - status IN ('SUBMITTED', 'IN_TRANSIT')                                   │
│  - trackingNumber IS NOT NULL                                               │
│  - shippingMethod = 'PREPAID'                                               │
│           │                                                                 │
│           ▼                                                                 │
│  For each submission:                                                       │
│  ┌─────────────────┐                                                        │
│  │ GET /tracking/  │                                                        │
│  │ {trackingNumber}│                                                        │
│  └────────┬────────┘                                                        │
│           │                                                                 │
│           ▼                                                                 │
│  Parse tracking events:                                                     │
│                                                                             │
│  ┌────────────────┬─────────────────────────────────────┐                   │
│  │ Royal Mail     │ Action                              │                   │
│  │ Event          │                                     │                   │
│  ├────────────────┼─────────────────────────────────────┤                   │
│  │ COLLECTED      │ status → IN_TRANSIT                 │                   │
│  │ IN_TRANSIT     │ status → IN_TRANSIT                 │                   │
│  │ OUT_FOR_       │ (no change, almost there)           │                   │
│  │ DELIVERY       │                                     │                   │
│  │ DELIVERED      │ status → RECEIVED                   │                   │
│  │                │ receivedAt = now()                  │                   │
│  │                │ Send "received" email               │                   │
│  └────────────────┴─────────────────────────────────────┘                   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Implementation Phases

| Phase | Scope | Priority | Est. Effort |
|-------|-------|----------|-------------|
| 1 | Service Module | Critical | Medium |
| 2 | Submission Integration | Critical | Medium |
| 3 | Frontend Updates | High | Medium |
| 4 | Tracking System | Medium | Low |
| 5 | Admin & Polish | Low | Low |

---

## Phase 1: Service Module

### Files to Create

```
app/lib/royal-mail.server.ts    # Core service
app/lib/royal-mail.types.ts     # TypeScript types
```

### Service API

```typescript
// royal-mail.server.ts

interface RoyalMailConfig {
  apiKey: string;
  baseUrl: string;
  defaultService: 'TPN' | 'TPM';  // Tracked 48 / Tracked 24
}

// Create shipping label for trade-in return
export async function createShippingLabel(params: {
  submissionNumber: string;
  customerName: string;
  customerAddress: {
    addressLine1: string;
    addressLine2?: string;
    city: string;
    postcode: string;
    country?: string;
  };
  weightGrams?: number;  // Default ~100g for cards
}): Promise<{
  success: boolean;
  trackingNumber?: string;
  orderIdentifier?: string;
  labelPdf?: string;  // Base64
  error?: string;
  errorCode?: string;
}>

// Cancel a label (e.g., submission cancelled)
export async function cancelShippingLabel(
  orderIdentifier: string
): Promise<{ success: boolean; error?: string }>

// Get tracking status
export async function getTrackingStatus(
  trackingNumber: string
): Promise<{
  success: boolean;
  status?: string;
  events?: TrackingEvent[];
  error?: string;
}>

// Check API health
export async function checkApiHealth(): Promise<boolean>
```

### Error Handling Strategy

```typescript
enum RoyalMailErrorCode {
  AUTH_FAILED = 'AUTH_FAILED',
  RATE_LIMITED = 'RATE_LIMITED',
  INVALID_ADDRESS = 'INVALID_ADDRESS',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
  UNKNOWN = 'UNKNOWN'
}

// All errors are caught and returned, never thrown
// Submission flow continues even if label fails
```

### Logging

```typescript
// All API calls logged for debugging
console.log('[royal-mail] Creating label for', submissionNumber);
console.log('[royal-mail] API response:', status, time);
console.error('[royal-mail] Error:', errorCode, message);
```

---

## Phase 2: Submission Integration

### Modified Flow in `createSubmission()`

```typescript
// In submissions.server.ts createSubmission()

// After submission created successfully...

// Check if label should be generated
const shouldGenerateLabel =
  settings.royalMailEnabled &&
  settings.shippingLabelEnabled &&
  totalValue >= settings.freeShippingMinimum &&
  hasValidCustomerAddress(input);

if (shouldGenerateLabel) {
  try {
    const labelResult = await createShippingLabel({
      submissionNumber: submission.submissionNumber,
      customerName: `${input.firstName} ${input.lastName}`,
      customerAddress: {
        addressLine1: input.shippingAddress1,
        addressLine2: input.shippingAddress2,
        city: input.shippingCity,
        postcode: input.shippingPostalCode,
      },
    });

    if (labelResult.success) {
      await prisma.tradeInSubmission.update({
        where: { id: submission.id },
        data: {
          shippingMethod: 'PREPAID',
          trackingNumber: labelResult.trackingNumber,
          royalMailOrderId: labelResult.orderIdentifier,
          labelPdfBase64: labelResult.labelPdf,
          labelGeneratedAt: new Date(),
          carrier: 'ROYAL_MAIL',
        },
      });
    } else {
      // Label failed - log and continue
      console.error('[createSubmission] Label generation failed:', labelResult.error);
      await prisma.tradeInSubmission.update({
        where: { id: submission.id },
        data: {
          shippingMethod: 'LABEL_FAILED',
        },
      });
    }
  } catch (error) {
    // Don't fail submission - just log
    console.error('[createSubmission] Label generation error:', error);
  }
} else {
  // Set appropriate shipping method
  const shippingMethod = !settings.royalMailEnabled ? 'SELF_SHIP' :
    totalValue < settings.freeShippingMinimum ? 'SELF_SHIP' :
    'ADDRESS_REQUIRED';

  await prisma.tradeInSubmission.update({
    where: { id: submission.id },
    data: { shippingMethod },
  });
}
```

### New API Endpoint: Label Download

```typescript
// app/routes/api.submissions.$id.label.tsx

export async function loader({ params, request }: LoaderFunctionArgs) {
  const submission = await getSubmissionById(params.id);

  if (!submission?.labelPdfBase64) {
    return json({ error: 'Label not available' }, { status: 404 });
  }

  // Return PDF as download
  const pdfBuffer = Buffer.from(submission.labelPdfBase64, 'base64');

  return new Response(pdfBuffer, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="shipping-label-${submission.submissionNumber}.pdf"`,
    },
  });
}
```

### Input Changes: Add Shipping Address

```typescript
// Update CreateSubmissionInput
export interface CreateSubmissionInput {
  // ... existing fields ...

  // Shipping address (optional - for prepaid labels)
  shippingAddress1?: string;
  shippingAddress2?: string;
  shippingCity?: string;
  shippingPostalCode?: string;
}
```

---

## Phase 3: Frontend Updates

### Shopify Theme Changes

**1. Add address fields to trade-in form** (`page.trade-in-app.liquid`)

```html
<!-- Shipping Address Section (shown when eligible for free label) -->
<div class="trade-in-shipping-address" data-shipping-section hidden>
  <h4>Shipping Address</h4>
  <p>Enter your address to receive a free prepaid shipping label</p>

  <input name="shippingAddress1" placeholder="Address Line 1" required>
  <input name="shippingAddress2" placeholder="Address Line 2 (optional)">
  <input name="shippingCity" placeholder="City" required>
  <input name="shippingPostalCode" placeholder="Postcode" required>
</div>
```

**2. Update success page display** (`trade-in-app.js`)

```javascript
// After submission success...

if (result.submission.shippingMethod === 'PREPAID') {
  // Show download button and tracking
  showPrepaidLabel(result.submission.trackingNumber);
} else if (result.submission.shippingMethod === 'SELF_SHIP') {
  // Show self-ship instructions
  showSelfShipInstructions();
} else if (result.submission.shippingMethod === 'ADDRESS_REQUIRED') {
  // Show address entry prompt
  showAddressRequired();
}
```

**3. Add label download link**

```javascript
// In success state
if (labelDownloadLink && submission.labelPdfBase64) {
  labelDownloadLink.href = `/apps/trade-in/submissions/${submission.id}/label`;
  labelDownloadLink.hidden = false;
}
```

---

## Phase 4: Tracking System

### Background Job: Poll Tracking

```typescript
// app/jobs/tracking-poll.server.ts

export async function pollTrackingUpdates() {
  // Get submissions that need tracking updates
  const submissions = await prisma.tradeInSubmission.findMany({
    where: {
      status: { in: ['SUBMITTED', 'IN_TRANSIT'] },
      trackingNumber: { not: null },
      shippingMethod: 'PREPAID',
    },
    take: 50,  // Batch size
  });

  for (const submission of submissions) {
    const tracking = await getTrackingStatus(submission.trackingNumber!);

    if (tracking.success && tracking.status) {
      await updateSubmissionFromTracking(submission, tracking);
    }
  }
}

async function updateSubmissionFromTracking(submission, tracking) {
  const latestEvent = tracking.events?.[0];

  if (latestEvent?.eventCode === 'DELIVERED') {
    await prisma.tradeInSubmission.update({
      where: { id: submission.id },
      data: {
        status: 'RECEIVED',
        receivedAt: new Date(),
      },
    });

    // Send notification
    await sendSubmissionReceivedNotification(submission);
  } else if (latestEvent?.eventCode === 'IN_TRANSIT') {
    await prisma.tradeInSubmission.update({
      where: { id: submission.id },
      data: { status: 'IN_TRANSIT' },
    });
  }
}
```

### Cron Trigger

Option A: Vercel Cron
```json
// vercel.json
{
  "crons": [{
    "path": "/api/cron/tracking",
    "schedule": "0 * * * *"  // Every hour
  }]
}
```

Option B: External trigger (GitHub Actions, etc.)

---

## Phase 5: Admin & Polish

### Admin Dashboard Additions

1. **Shipping overview widget**
   - Labels generated today
   - Packages in transit
   - Failed labels requiring attention

2. **Manual label actions**
   - Regenerate label button
   - Mark as shipped manually
   - Override shipping method

3. **Bulk operations**
   - Export labels for printing
   - Bulk tracking update

### Customer Features

1. **Track Status page enhancements**
   - Real-time tracking display
   - Estimated delivery date
   - Tracking history timeline

2. **Email notifications**
   - "Package received" email
   - "Please ship your cards" reminder

---

## Testing Checklist

### Phase 1 Tests
- [ ] API connection with real credentials
- [ ] Create test order (sandbox if available)
- [ ] Handle auth failure gracefully
- [ ] Handle rate limiting
- [ ] Handle timeout

### Phase 2 Tests
- [ ] Submission with valid address generates label
- [ ] Submission below threshold skips label
- [ ] Submission without address shows prompt
- [ ] API failure doesn't break submission
- [ ] Label stored correctly in DB
- [ ] Duplicate request returns existing label

### Phase 3 Tests
- [ ] Address form shows when eligible
- [ ] Success page shows correct state
- [ ] Label download works
- [ ] Tracking number displays

### Phase 4 Tests
- [ ] Tracking poll job runs
- [ ] Status updates correctly
- [ ] Delivered → RECEIVED transition
- [ ] Email notifications sent

### Phase 5 Tests
- [ ] Admin can regenerate labels
- [ ] Admin can override shipping method
- [ ] Cancelled submissions cancel labels

---

## Environment Variables

```bash
# Required
ROYAL_MAIL_API_KEY=your_api_key_here

# Optional (with defaults)
ROYAL_MAIL_BASE_URL=https://api.parcel.royalmail.com/api/v1
ROYAL_MAIL_DEFAULT_SERVICE=TPN  # Tracked 48
```

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| API downtime | Graceful fallback to self-ship |
| Rate limiting (2/sec) | Queue system for high volume |
| Invalid addresses | Validation before API call |
| Label cost overruns | Threshold setting configurable |
| Data loss | Label PDF stored in DB |

---

## Success Metrics

1. **Label generation success rate** - Target: >95%
2. **Time to generate label** - Target: <3 seconds
3. **Customer adoption** - % using prepaid vs self-ship
4. **Tracking accuracy** - Status matches actual

---

*Plan created 2026-01-01 - Ready for Phase 1 implementation*
