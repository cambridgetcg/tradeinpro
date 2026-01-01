# Shipping & Packing Slip Implementation Plan

## Current State Summary

### What's Fully Implemented ✅

| Component | File | Status |
|-----------|------|--------|
| Packing Slip HTML | `api.packing-slip.$number.tsx` | Complete |
| Shipping Instructions | `api.shipping-instructions.$number.tsx` | Complete |
| Royal Mail API Client | `services/royalMailApi.server.ts` | Complete |
| Shipping Label Generation | `lib/shipping.server.ts` | Complete |
| Free Shipping Logic | `qualifiesForFreeShipping()` | Complete |
| UK Postcode Validation | `isValidUKPostcode()` | Complete |
| Customer Address Form | `trade-in-form.liquid` | Complete |
| Submission Tracker | `trade-in-tracker.liquid` | Complete |
| Self-Ship Instructions | `getSelfShipInstructions()` | Complete |

### What's Missing ❌

| Component | Priority | Description |
|-----------|----------|-------------|
| Admin Shipping Settings UI | P0 | Configure Royal Mail, thresholds, return address |
| Royal Mail API Key | P0 | Environment variable `ROYAL_MAIL_API_KEY` |
| Settings Route | P1 | Expose shipping settings in admin dashboard |
| Label Download UI | P1 | Admin can view/print labels for submissions |
| Tracking Integration | P2 | Auto-update tracking status from Royal Mail |
| Bulk Label Operations | P3 | Generate labels for multiple submissions |

---

## Data Flow Analysis

### 1. Packing Slip Flow

```
Customer clicks "Download Packing Slip"
    │
    ▼
GET /apps/trade-in/packing-slip/{submissionNumber}
    │
    ▼
api.storefront.$.tsx (splat route)
    │ matches /packing-slip/:number
    ▼
api.packing-slip.$number.tsx
    │
    ├─► validateAppProxy(request) - verify Shopify signature
    ├─► prisma.tradeInSubmission.findUnique({ submissionNumber })
    ├─► getShippingSettings() - get return address
    ├─► formatAddress(settings.returnAddress)
    └─► generatePackingSlipHTML(submission, addressLines)
            │
            ▼
        Returns HTML with:
        - Header (logo, reference number, date)
        - Info row (Ship To address, Customer details)
        - Items table (checkbox, card name, set, condition, qty, value)
        - Summary (total cards, quoted total, bonus if store credit)
        - Important notice
        - Barcode (submission number)
        - Print button
```

### 2. Shipping Instructions Flow

```
Customer clicks "Shipping Instructions"
    │
    ▼
GET /apps/trade-in/shipping-instructions/{submissionNumber}
    │
    ▼
api.shipping-instructions.$number.tsx
    │
    ├─► validateAppProxy(request)
    ├─► prisma.tradeInSubmission.findUnique()
    ├─► getShippingSettings() - get return address
    ├─► qualifiesForFreeShipping(submissionId)
    └─► generateShippingInstructionsHTML({
            submissionNumber,
            returnAddress,
            quotedTotal,
            totalItems,
            freeShipping,
            freeShippingMinimum,
            trackingNumber
        })
            │
            ▼
        Returns HTML with:
        - Header (reference number)
        - Summary (cards, value, shipping type)
        - Ship To address (with free shipping badge)
        - Packing checklist (5 items)
        - Pro tips
        - Important notice
        - CTA to download packing slip
```

### 3. Prepaid Label Generation Flow (Royal Mail)

```
Submission qualifies for free shipping (≥£50)
    │
    ▼
Customer provides shipping address during submission
    │
    ▼
createSubmission() → includes shipping address
    │
    ▼
generateShippingLabel(submissionId, address)
    │
    ├─► Check: submission exists & status = SUBMITTED
    ├─► Check: return address configured
    ├─► qualifiesForFreeShipping() → must be true
    ├─► Check: settings.royalMailEnabled = true
    ├─► Check: valid UK postcode
    │
    ▼ (If all checks pass)
generateRoyalMailLabel(submission, settings)
    │
    ├─► Build recipient address (customer)
    ├─► Build sender address (business return address)
    ├─► estimatePackageWeight(itemCount)
    ├─► getPackageFormat(itemCount) → largeLetter or parcel
    │
    ▼
royalMailApi.createOrder({
    recipient, sender, orderReference,
    weight, format, orderValue, serviceCode
})
    │
    ▼
Store in DB:
    - royalMailOrderId
    - labelPdfBase64 (PDF as Base64)
    - trackingNumber
    - shippingMethod = 'PREPAID'
    - carrier = 'Royal Mail'
    - labelGeneratedAt
    │
    ▼
Return ShippingLabel {
    labelUrl, trackingNumber, carrier, instructions
}
```

### 4. Self-Ship Flow (Fallback)

```
Submission does NOT qualify for free shipping
OR Royal Mail disabled/failed
    │
    ▼
getSelfShipInstructions(submissionId)
    │
    ├─► Get return address from settings
    ├─► Build instructions object:
    │   - returnAddress (formatted lines)
    │   - submissionNumber
    │   - packingTips (5 tips)
    │   - trackingAdvice
    │   - handlingInstructions
    │
    ▼
shippingMethod = 'SELF_SHIP'
Customer ships at their own cost
```

---

## Royal Mail API Integration

### API Client Location
`app/services/royalMailApi.server.ts`

### Configuration
```typescript
// Environment variables needed
ROYAL_MAIL_API_KEY=your_api_key_here
ROYAL_MAIL_BASE_URL=https://api.parcel.royalmail.com  // optional, has default

// Service codes
TRACKED_24: "TPS"  // Next business day
TRACKED_48: "TPN"  // 2-3 days (default)
SPECIAL_DELIVERY_9AM: "SD1"
SPECIAL_DELIVERY_1PM: "SD2"
```

### Available Methods
```typescript
royalMailApi.createOrder({
  recipient: Address,
  sender: Address,
  orderReference: string,
  weight: number,
  format: 'largeLetter' | 'parcel',
  orderValue: number,
  serviceCode: string
}) → { orderId, labelPdf, trackingNumber }

royalMailApi.getLabel(orderId) → { labelPdf }
royalMailApi.getTracking(trackingNumber) → TrackingInfo
royalMailApi.deleteOrder(orderId) → boolean
```

### Package Estimation
```typescript
// Weight: 2g per card + 50g base + 15g per 10 cards (padding)
estimatePackageWeight(cardCount: number) → number (grams)

// Format: ≤20 cards = largeLetter, >20 cards = parcel
getPackageFormat(cardCount: number) → 'largeLetter' | 'parcel'
```

---

## Database Schema (Shipping Fields)

### TradeInSubmission
```prisma
model TradeInSubmission {
  // ... other fields

  // Shipping method & tracking
  shippingMethod     String?   // PREPAID, SELF_SHIP, DROP_OFF
  trackingNumber     String?
  labelUrl           String?
  carrier            String?   // "Royal Mail"

  // Customer shipping address
  shippingName       String?
  shippingAddress1   String?
  shippingAddress2   String?
  shippingCity       String?
  shippingPostalCode String?
  shippingCountry    String?   @default("GB")

  // Royal Mail integration
  royalMailOrderId   String?
  labelPdfBase64     String?   @db.Text
  labelGeneratedAt   DateTime?
}
```

### TradeInSettings
```prisma
model TradeInSettings {
  // ... other fields

  // Shipping configuration
  freeShippingMinimum   Int       @default(5000)  // £50 in pence
  shippingLabelEnabled  Boolean   @default(true)
  returnAddress         String?   // JSON: {name, address1, address2, city, postalCode, country}

  // Royal Mail
  royalMailEnabled      Boolean   @default(false)
  royalMailService      String    @default("TPN")  // Tracked 48
}
```

---

## Implementation Plan

### Phase 1: Admin Shipping Settings UI (P0) 🎯

**Goal:** Allow admins to configure shipping settings from the dashboard.

#### 1.1 Add Shipping Tab to Settings Page

**File:** `app/routes/app.settings.tsx`

**New Tab Content:**
```
┌─────────────────────────────────────────────────────────────┐
│ Shipping Settings                                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│ RETURN ADDRESS                                              │
│ ┌─────────────────────────────────────────────────────────┐│
│ │ Business Name: [CardForum                             ] ││
│ │ Address Line 1: [123 High Street                      ] ││
│ │ Address Line 2: [Suite 4                              ] ││
│ │ City: [Cambridge                                      ] ││
│ │ Postal Code: [CB1 2AB                                 ] ││
│ │ Country: [United Kingdom                              ] ││
│ └─────────────────────────────────────────────────────────┘│
│                                                             │
│ FREE SHIPPING                                               │
│ ┌─────────────────────────────────────────────────────────┐│
│ │ Minimum Value: £ [50.00         ]                      ││
│ │ (Submissions above this value get prepaid labels)      ││
│ └─────────────────────────────────────────────────────────┘│
│                                                             │
│ ROYAL MAIL INTEGRATION                                      │
│ ┌─────────────────────────────────────────────────────────┐│
│ │ ☐ Enable Royal Mail prepaid labels                     ││
│ │                                                         ││
│ │ Service Level:                                          ││
│ │ ○ Tracked 48 (2-3 days) - Recommended                   ││
│ │ ○ Tracked 24 (Next day)                                 ││
│ │ ○ Special Delivery by 1pm                               ││
│ │ ○ Special Delivery by 9am                               ││
│ │                                                         ││
│ │ ⚠️ Requires ROYAL_MAIL_API_KEY environment variable    ││
│ └─────────────────────────────────────────────────────────┘│
│                                                             │
│ [Save Shipping Settings]                                    │
└─────────────────────────────────────────────────────────────┘
```

#### 1.2 Update Settings Server

**File:** `app/lib/settings.server.ts`

Add functions:
- `getShippingSettingsForAdmin()` - Returns all shipping config
- `updateShippingSettings(data)` - Updates shipping config
- Validate return address format
- Validate postcode format

#### 1.3 Add Settings Form Handler

**File:** `app/routes/app.settings.tsx`

Add action handler for shipping tab form submission.

---

### Phase 2: Submission Detail - Shipping Panel (P1)

**Goal:** Show shipping info and actions in admin submission view.

#### 2.1 Shipping Panel in Submission Detail

**File:** `app/routes/app.trade-ins.$id.tsx`

**New Panel:**
```
┌─────────────────────────────────────────────────────────────┐
│ Shipping & Delivery                                         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│ Method: PREPAID (Royal Mail Tracked 48)                     │
│ Tracking: RM123456789GB                      [Track ↗]     │
│ Label Generated: 01 Jan 2026, 10:30          [Reprint]     │
│                                                             │
│ Customer Address:                                           │
│   John Smith                                                │
│   123 Customer Lane                                         │
│   London, SW1A 1AA                                         │
│                                                             │
│ ───────────────────────────────────────────────────────────│
│                                                             │
│ [View Packing Slip] [View Shipping Instructions]           │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**For Self-Ship:**
```
┌─────────────────────────────────────────────────────────────┐
│ Shipping & Delivery                                         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│ Method: SELF_SHIP (Customer ships at own cost)              │
│ Tracking: [                    ] [Update]                   │
│                                                             │
│ [View Packing Slip] [View Shipping Instructions]           │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

### Phase 3: Label Printing & Download (P1)

**Goal:** Admin can view/download PDF labels.

#### 3.1 Add Label Download Endpoint

**File:** `app/routes/app.trade-ins.$id.label.tsx` (new)

- Returns PDF for download
- Converts Base64 to binary PDF
- Sets correct Content-Type headers

#### 3.2 Add Print Button to Panel

Opens label in new tab for printing.

---

### Phase 4: Bulk Label Operations (P3)

**Goal:** Generate labels for multiple submissions at once.

#### 4.1 Bulk Action in Queue

**File:** `app/routes/app.trade-ins.tsx`

Add bulk action: "Generate Labels" for selected submissions.

---

## UI Components Needed

### 1. ShippingSettingsCard (Polaris)
```tsx
<Card>
  <Card.Header title="Shipping Settings" />
  <Card.Section title="Return Address">
    <FormLayout>
      <TextField label="Business Name" ... />
      <TextField label="Address Line 1" ... />
      ...
    </FormLayout>
  </Card.Section>
  <Card.Section title="Free Shipping">
    <TextField label="Minimum Value (£)" type="number" ... />
  </Card.Section>
  <Card.Section title="Royal Mail Integration">
    <Checkbox label="Enable Royal Mail prepaid labels" />
    <RadioButton.Group>
      <RadioButton label="Tracked 48" value="TPN" />
      ...
    </RadioButton.Group>
  </Card.Section>
</Card>
```

### 2. ShippingInfoPanel (Polaris)
```tsx
<Card>
  <Card.Header title="Shipping & Delivery" />
  <Card.Section>
    <Stack vertical>
      <Stack>
        <Text>Method:</Text>
        <Badge>{shippingMethod}</Badge>
      </Stack>
      {trackingNumber && (
        <Stack>
          <Text>Tracking:</Text>
          <Link url={trackingUrl}>{trackingNumber}</Link>
        </Stack>
      )}
      ...
    </Stack>
  </Card.Section>
  <Card.Section>
    <ButtonGroup>
      <Button url={packingSlipUrl}>View Packing Slip</Button>
      <Button url={shippingInstructionsUrl}>Shipping Instructions</Button>
    </ButtonGroup>
  </Card.Section>
</Card>
```

---

## Environment Variables Needed

```bash
# Royal Mail API (required for prepaid labels)
ROYAL_MAIL_API_KEY=your_api_key_here

# Optional - defaults to production URL
ROYAL_MAIL_BASE_URL=https://api.parcel.royalmail.com
```

---

## Testing Checklist

### Phase 1: Settings UI
- [ ] Return address form saves correctly
- [ ] Address validates UK postcode format
- [ ] Free shipping minimum updates correctly
- [ ] Royal Mail toggle works
- [ ] Service level selection saves
- [ ] Warning shown when API key missing

### Phase 2: Shipping Panel
- [ ] Shows correct shipping method
- [ ] Tracking number displays and links work
- [ ] Reprint button generates new label
- [ ] Packing slip link works
- [ ] Shipping instructions link works

### Phase 3: Label Operations
- [ ] PDF download works
- [ ] Label opens in new tab
- [ ] Print dialog appears

---

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `app/routes/app.settings.tsx` | Modify | Add Shipping tab |
| `app/lib/settings.server.ts` | Modify | Add shipping settings functions |
| `app/routes/app.trade-ins.$id.tsx` | Modify | Add shipping panel |
| `app/routes/app.trade-ins.$id.label.tsx` | Create | PDF download endpoint |
| `.env` | Modify | Add ROYAL_MAIL_API_KEY |

---

## Progress Tracker

### Phase 1: Admin Shipping Settings UI
- [ ] Design settings card layout
- [ ] Implement return address form
- [ ] Implement free shipping threshold
- [ ] Implement Royal Mail toggle
- [ ] Implement service level radio buttons
- [ ] Add form validation
- [ ] Add save action handler
- [ ] Test settings persistence

### Phase 2: Submission Shipping Panel
- [ ] Design shipping info panel
- [ ] Fetch shipping data
- [ ] Display shipping method badge
- [ ] Display tracking with link
- [ ] Add packing slip button
- [ ] Add shipping instructions button
- [ ] Add tracking update form (self-ship)
- [ ] Test panel rendering

### Phase 3: Label Operations
- [ ] Create label download route
- [ ] Implement PDF response
- [ ] Add print button
- [ ] Test PDF download

### Phase 4: Bulk Operations
- [ ] Add bulk action to queue
- [ ] Implement batch label generation
- [ ] Add progress indicator
- [ ] Test bulk operations

---

## Next Steps

1. **Start with Phase 1** - Add Shipping tab to Settings page
2. **UI First** - Build the Polaris components
3. **Then wire up** - Connect to settings.server.ts
4. **Test locally** - Verify settings save/load
5. **Deploy** - Push to production
6. **Configure** - Add Royal Mail API key to Vercel env vars
