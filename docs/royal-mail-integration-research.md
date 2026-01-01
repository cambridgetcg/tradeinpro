# Royal Mail API Integration Research

> **Date:** 2026-01-01
> **Purpose:** Evaluate Royal Mail API options for trade-in shipping label generation
> **Status:** Research Complete

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Available API Options](#available-api-options)
3. [Click & Drop API](#click--drop-api)
4. [Pro Shipping API](#pro-shipping-api)
5. [Comparison Matrix](#comparison-matrix)
6. [Trade-In Use Case Analysis](#trade-in-use-case-analysis)
7. [Recommended Architecture](#recommended-architecture)
8. [Implementation Roadmap](#implementation-roadmap)
9. [Cost Analysis](#cost-analysis)
10. [Sources](#sources)

---

## Executive Summary

### Recommendation: Click & Drop API

For Cambridge TCG's trade-in shipping flow, **Click & Drop API** is the recommended solution because:

1. **Lower volume threshold** - Works with 20+ parcels/week (vs 100+/day for Pro Shipping)
2. **Simpler integration** - REST API with straightforward authentication
3. **Cost-effective** - No API usage fees, only pay for postage
4. **Return label support** - Can generate prepaid return labels
5. **Existing business account** - Already have OBA, meets requirements

### Key Capabilities

| Feature | Supported |
|---------|-----------|
| Generate shipping labels | Yes |
| Generate return labels | Yes |
| Tracking integration | Yes |
| Manifest generation | Yes |
| Tracked 24/48 services | Yes |
| PDF label output | Yes |

---

## Available API Options

Royal Mail offers multiple integration paths:

### 1. Click & Drop API
- **Best for:** Businesses sending 20-100+ items/day
- **Authentication:** Bearer token (API key from account settings)
- **Base URL:** `https://api.parcel.royalmail.com/api/v1`
- **Rate Limit:** 2 calls/second

### 2. Pro Shipping API (v3/v4)
- **Best for:** High-volume shippers (100+ items/day)
- **Authentication:** OAuth2 + IBM headers
- **Base URL:** `https://api.royalmail.net/shipping/v3`
- **Rate Limit:** Higher limits, enterprise features

### 3. Shipping API V2 (Legacy)
- **Status:** Still operational but V3/V4 recommended
- **Best for:** Existing integrations

---

## Click & Drop API

### Overview

The Click & Drop API (also known as ChannelShipper API) provides:
- Order creation and management
- Label generation (PDF)
- Return label support
- Manifest operations
- Tracking status

### Authentication

```
Authorization: Bearer {API_KEY}
```

API key obtained from: Click & Drop Account Settings → API Integration

### Key Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `POST /orders` | POST | Create order and optionally generate label |
| `GET /orders/{id}/label` | GET | Generate label PDF |
| `DELETE /orders/{id}` | DELETE | Cancel order (invalidates label) |
| `POST /manifests` | POST | Create end-of-day manifest |
| `GET /version` | GET | API health check |

### Create Order with Label

```json
POST /api/v1/orders
{
  "orderReference": "TRD-202601-00042",
  "recipient": {
    "fullName": "John Smith",
    "addressLine1": "123 High Street",
    "city": "London",
    "postcode": "SW1A 1AA",
    "countryCode": "GB"
  },
  "sender": {
    "tradingName": "Cambridge TCG",
    "addressLine1": "Business Address",
    "city": "Cambridge",
    "postcode": "CB1 1AA"
  },
  "packages": [{
    "weightInGrams": 100,
    "packageFormatIdentifier": "largeLetter"
  }],
  "orderDate": "2026-01-01",
  "serviceCode": "TRM",
  "label": {
    "includeLabelInResponse": true,
    "labelFormat": "PDF"
  }
}
```

### Response with Label

```json
{
  "createdOrders": [{
    "orderIdentifier": 12345678,
    "orderReference": "TRD-202601-00042",
    "trackingNumber": "AB123456789GB",
    "label": "JVBERi0xLjQK..."  // Base64 PDF
  }]
}
```

### Generate Return Label

```
GET /api/v1/orders/{orderIdentifiers}/label?documentType=postageLabel&includeReturnsLabel=true
```

---

## Pro Shipping API

### Overview

Enterprise-grade API for high-volume shippers with advanced features:
- Batch operations
- Offline barcoding
- Data streaming
- Advanced customs handling

### Authentication (Complex)

Requires multiple headers:
```
X-IBM-Client-Id: {client_id}
X-IBM-Client-Secret: {client_secret}
X-RMG-Security-Username: {username}
X-RMG-Security-Password: {password}
```

Then exchange for JWT token (valid 4 hours):
```
X-RMG-Auth-Token: {jwt_token}
```

### When to Use Pro Shipping

- Sending 100+ items per day
- Need offline label generation
- Require batch processing
- Need advanced manifest control
- Custom label formats required

---

## Comparison Matrix

| Feature | Click & Drop API | Pro Shipping API |
|---------|------------------|------------------|
| **Volume Threshold** | 20+ items/week | 100+ items/day |
| **Authentication** | Simple Bearer token | Complex OAuth + IBM headers |
| **Setup Complexity** | Low | High |
| **Label Generation** | Yes (PDF) | Yes (PDF, ZPL, PNG) |
| **Return Labels** | Yes | Yes |
| **Tracking** | Via Tracking API | Built-in |
| **Rate Limit** | 2/second | 5/second |
| **Sandbox** | Limited | Full sandbox environment |
| **API Cost** | Free | Free |
| **Support** | Standard | Dedicated |
| **Best For** | SMB, marketplace sellers | Enterprise, 3PL |

---

## Trade-In Use Case Analysis

### Current Flow

```
Customer submits trade-in
        ↓
Success page shows:
- Reference number
- "Ship to" address
- Packing slip (PDF)
- Shipping instructions
        ↓
Customer ships cards to Cambridge TCG
        ↓
Cards received & processed
```

### Proposed Enhanced Flow (With Royal Mail)

```
Customer submits trade-in
        ↓
Backend creates Royal Mail order via API
        ↓
Success page shows:
- Reference number
- Prepaid return label (PDF download)
- QR code for Post Office drop-off
- Tracking number
        ↓
Customer prints label OR uses QR at Post Office
        ↓
Customer drops package
        ↓
Tracking updates received via webhook/polling
        ↓
Cards received & processed
```

### Benefits of Integration

| Benefit | Impact |
|---------|--------|
| **Prepaid labels** | Removes shipping cost barrier for customers |
| **Tracking** | Real-time visibility for customer and staff |
| **Consistency** | Standardized packaging, fewer lost items |
| **Professionalism** | Premium customer experience |
| **Data** | Shipping analytics and cost tracking |

### Considerations

| Consideration | Notes |
|---------------|-------|
| **Cost** | Business pays for return shipping (~£3-5 per item) |
| **Minimum value** | May want to set min trade-in value for free shipping |
| **Package size** | Most card trade-ins fit Large Letter (cheaper) |
| **Insurance** | Tracked 24/48 includes £75 coverage |

---

## Recommended Architecture

### System Design

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         TRADE-IN SHIPPING FLOW                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Shopify Theme              CardForum API              Royal Mail API       │
│  ─────────────              ────────────               ───────────────      │
│                                                                             │
│  1. Customer submits                                                        │
│     trade-in form      ──►  2. POST /submissions                            │
│                              - Create submission                            │
│                              - Calculate value                              │
│                                    │                                        │
│                                    ▼                                        │
│                             3. Check if eligible                            │
│                                for prepaid label                            │
│                                (value > £20?)                               │
│                                    │                                        │
│                              ┌─────┴─────┐                                  │
│                              │           │                                  │
│                         No   ▼           ▼  Yes                             │
│                         ┌────────┐  ┌────────────┐                          │
│                         │ Return │  │ Call Royal │                          │
│                         │ manual │  │ Mail API   │ ──►  POST /orders        │
│                         │ ship   │  └────────────┘      - Create order      │
│                         │ info   │       │              - Generate label    │
│                         └────────┘       │                    │             │
│                              │           ▼                    │             │
│                              │    4. Store in DB:             │             │
│                              │    - trackingNumber            │             │
│                              │    - labelPdfBase64       ◄────┘             │
│                              │    - labelGeneratedAt                        │
│                              │           │                                  │
│                              └─────┬─────┘                                  │
│                                    │                                        │
│                                    ▼                                        │
│  5. Success page        ◄──  Return response:                               │
│     - Show tracking          - submissionNumber                             │
│     - Download label         - trackingNumber                               │
│     - QR code option         - labelUrl                                     │
│                                                                             │
│  ─────────────────────────────────────────────────────────────────────────  │
│                                                                             │
│  TRACKING UPDATES (Background Job)                                          │
│                                                                             │
│  6. Cron job polls      ──►  GET /tracking/{trackingNumber}                 │
│     Royal Mail API                  │                                       │
│                                     ▼                                       │
│                             7. Update submission                            │
│                                status in DB                                 │
│                                     │                                       │
│                                     ▼                                       │
│  8. Customer can        ◄──  Track Status page                              │
│     view progress            shows latest status                            │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Database Schema Changes

```prisma
model TradeInSubmission {
  // ... existing fields ...

  // Shipping fields (new)
  shippingMethod       String?   // "ROYAL_MAIL_TRACKED_24" | "ROYAL_MAIL_TRACKED_48" | "CUSTOMER_ARRANGED"
  trackingNumber       String?   // Royal Mail tracking number
  royalMailOrderId     String?   // Click & Drop order ID
  labelPdfUrl          String?   // URL to stored label PDF
  labelGeneratedAt     DateTime?
  shippingStatus       String?   // "LABEL_GENERATED" | "IN_TRANSIT" | "DELIVERED"
  shippingStatusUpdatedAt DateTime?
  estimatedDeliveryDate DateTime?
}
```

### New API Endpoints (CardForum)

```
GET  /api/submissions/{id}/label     - Download shipping label PDF
GET  /api/submissions/{id}/tracking  - Get tracking status
POST /api/webhooks/royal-mail        - Receive tracking updates (future)
```

### Service Module

```typescript
// app/lib/royal-mail.server.ts

interface RoyalMailConfig {
  apiKey: string;
  baseUrl: string;
  senderAddress: Address;
}

interface CreateLabelRequest {
  submissionNumber: string;
  recipientName: string;
  recipientAddress: Address;
  weightGrams: number;
  serviceCode: 'TRM24' | 'TRM48';  // Tracked 24 or 48
}

interface CreateLabelResponse {
  success: boolean;
  trackingNumber?: string;
  orderIdentifier?: string;
  labelPdf?: string;  // Base64
  error?: string;
}

export async function createShippingLabel(
  request: CreateLabelRequest
): Promise<CreateLabelResponse> {
  // Implementation
}

export async function getTrackingStatus(
  trackingNumber: string
): Promise<TrackingStatus> {
  // Implementation
}

export async function cancelLabel(
  orderIdentifier: string
): Promise<boolean> {
  // Implementation
}
```

---

## Implementation Roadmap

### Phase 1: Foundation (Week 1)
- [ ] Register for Click & Drop API access
- [ ] Obtain API key from account settings
- [ ] Create `royal-mail.server.ts` service module
- [ ] Add database schema migrations
- [ ] Test API connection in development

### Phase 2: Label Generation (Week 2)
- [ ] Implement `createShippingLabel()` function
- [ ] Add label generation to submission flow
- [ ] Store label PDF (Cloudflare R2 or similar)
- [ ] Create `/api/submissions/{id}/label` endpoint
- [ ] Update success page to show download link

### Phase 3: Tracking (Week 3)
- [ ] Implement `getTrackingStatus()` function
- [ ] Create background job for polling
- [ ] Create `/api/submissions/{id}/tracking` endpoint
- [ ] Update Track Status page with real data
- [ ] Add email notifications for status changes

### Phase 4: Polish (Week 4)
- [ ] Add QR code generation for Post Office drop-off
- [ ] Implement label cancellation for cancelled submissions
- [ ] Add admin dashboard shipping overview
- [ ] Performance testing and monitoring
- [ ] Documentation and runbook

---

## Cost Analysis

### Royal Mail Tracked Services (2025 Prices)

| Service | Weight | Price (approx) |
|---------|--------|----------------|
| Tracked 48 Large Letter | Up to 100g | £2.10 |
| Tracked 48 Large Letter | Up to 250g | £2.65 |
| Tracked 48 Large Letter | Up to 500g | £3.10 |
| Tracked 48 Large Letter | Up to 750g | £3.60 |
| Tracked 48 Small Parcel | Up to 1kg | £3.59 |
| Tracked 24 Small Parcel | Up to 1kg | £4.19 |
| Tracked 24 Small Parcel | Up to 2kg | £5.89 |

*Prices are approximate and subject to change. Business account rates may differ.*

### Cost Strategy Options

**Option A: Free shipping on all trade-ins**
- Simple messaging: "Free prepaid shipping included"
- Cost absorbed into trade-in margin
- Estimated: £3-4 average per submission

**Option B: Free shipping above threshold**
- "Free shipping on trade-ins over £20"
- Below threshold: Customer arranges own shipping
- Reduces cost while incentivizing larger submissions

**Option C: Shipping credit deducted**
- Deduct shipping cost from trade-in value
- Transparent but less attractive UX
- "Your trade-in value: £50.00 (£3.50 shipping deducted)"

### Recommendation

**Option B** provides the best balance:
- Incentivizes larger trade-ins (higher margin)
- Reduces low-value submissions that cost more to process
- Clear value proposition for customers

---

## Sources

### Official Royal Mail Resources
- [Royal Mail API Shipping](https://www.royalmail.com/business/parcels/shipping-solutions/api-shipping)
- [Royal Mail APIs Overview](https://www.royalmail.com/business/tools-services/apis)
- [Royal Mail Developer Portal](https://developer.royalmail.net/api)
- [Pro Shipping API v4 Documentation](https://api.proshipping.net/docs/v4-RM/api/index.html)
- [Click & Drop API Specification](https://api.parcel.royalmail.com/doc/v1/click-and-drop-api-v1.yaml)

### Pricing & Requirements
- [Royal Mail Prices 2025](https://www.royalmail.com/prices2025)
- [Tracked Returns Help](https://business.help.royalmail.com/app/answers/detail/a_id/717)
- [Royal Mail March 2025 Price Guide (PDF)](https://www.mymailingroom.com/wp-content/uploads/Royal-Mail-price-guide-march-2025.pdf)

### Third-Party Resources
- [ShipEngine Royal Mail Integration](https://help.shipengine.com/hc/en-us/articles/7687357092891-Royal-Mail)
- [PHP Click & Drop Client (GitHub)](https://github.com/zVPS/royal-mail-click-drop-rest-api-client)
- [PHP Pro Shipping Client (GitHub)](https://github.com/zVPS/royal-mail-shipping-rest-api-client)

### Comparison Guides
- [Base: API vs Click & Drop](https://base.com/en-EN/blog/integrate-with-royal-mail-by-api-or-clickdrop/)
- [Royal Mail Shipping Solutions Comparison](https://www.royalmail.com/business/parcels/shipping-solutions)

---

## Next Steps

1. **Confirm business account details** - Verify OBA number and Click & Drop access
2. **Request API credentials** - Generate API key from Click & Drop settings
3. **Set up test environment** - Create test orders without actually shipping
4. **Define shipping policy** - Decide on threshold for free shipping
5. **Begin Phase 1 implementation** - Start with service module

---

*Research completed 2026-01-01*
