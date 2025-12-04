# Phase 3: Customer-Facing Submission Flow

## Overview

Phase 3 implements the customer-facing trade-in submission experience:
1. **Submission Creation** - Customers build trade-in lists with card search
2. **Cart/Quote System** - Running total with condition-based pricing
3. **Payout Selection** - Choose store credit or bank transfer
4. **Shipping Flow** - Generate labels or self-ship instructions
5. **Status Tracking** - Customer can view submission progress

---

## 1. File Structure

```
app/
├── routes/
│   ├── api.submissions.tsx           # REST API for submissions (App Proxy)
│   ├── api.submissions.$id.tsx       # Individual submission API
│   ├── api.cards.search.tsx          # Card search API for autocomplete
│   └── api.shipping.label.tsx        # Shipping label generation
├── lib/
│   ├── submissions.server.ts         # Submission CRUD, validation
│   ├── shipping.server.ts            # Shipping label integration
│   └── notifications.server.ts       # Email notifications
```

---

## 2. Submission Creation Flow

### 2.1 API Endpoints

#### Create Submission
```typescript
// POST /api/submissions
interface CreateSubmissionRequest {
  customerId?: string;      // Shopify customer ID (optional for guests)
  email: string;            // Required
  firstName?: string;
  lastName?: string;
  payoutType: 'STORE_CREDIT' | 'BANK' | 'PAYPAL';
  items: CreateItemRequest[];
}

interface CreateItemRequest {
  cardPriceId?: string;     // Link to CardPrice if selected from catalog
  cardName: string;
  setName: string;
  setCode?: string;
  variant?: string;
  quantity: number;
  conditionClaimed: 'NM' | 'LP' | 'MP' | 'HP' | 'DMG';
}

interface CreateSubmissionResponse {
  success: boolean;
  submission?: {
    id: string;
    submissionNumber: string;
    status: string;
    quotedTotal: number;
    items: SubmissionItem[];
  };
  errors?: ValidationError[];
}
```

### 2.2 Submission Validation

```typescript
interface SubmissionValidation {
  // Minimum value check
  minimumValue: boolean;
  minimumRequired: number;
  currentTotal: number;

  // Item limits
  withinItemLimit: boolean;
  maxItems: number;
  currentItems: number;

  // Card availability
  invalidCards: string[];

  // Overall validity
  isValid: boolean;
  errors: string[];
}

async function validateSubmission(
  items: CreateItemRequest[],
  settings: TradeInSettings
): Promise<SubmissionValidation> {
  const errors: string[] = [];
  const invalidCards: string[] = [];
  let totalValue = 0;
  let totalItems = 0;

  for (const item of items) {
    totalItems += item.quantity;

    // Lookup card price
    const cardPrice = item.cardPriceId
      ? await prisma.cardPrice.findUnique({ where: { id: item.cardPriceId } })
      : await findCardPriceByName(item.cardName, item.setName);

    if (!cardPrice || !cardPrice.isActive) {
      invalidCards.push(item.cardName);
      continue;
    }

    // Calculate price based on claimed condition
    const price = getConditionPrice(cardPrice, item.conditionClaimed);
    totalValue += price * item.quantity;
  }

  // Validate minimums
  if (totalValue < settings.minimumSubmissionValue) {
    errors.push(`Minimum submission value is ${formatPrice(settings.minimumSubmissionValue)}`);
  }

  // Validate item count
  if (totalItems > settings.maxItemsPerSubmission) {
    errors.push(`Maximum ${settings.maxItemsPerSubmission} items per submission`);
  }

  // Validate all cards found
  if (invalidCards.length > 0) {
    errors.push(`Cards not found or not accepting: ${invalidCards.join(', ')}`);
  }

  return {
    minimumValue: totalValue >= settings.minimumSubmissionValue,
    minimumRequired: settings.minimumSubmissionValue,
    currentTotal: totalValue,
    withinItemLimit: totalItems <= settings.maxItemsPerSubmission,
    maxItems: settings.maxItemsPerSubmission,
    currentItems: totalItems,
    invalidCards,
    isValid: errors.length === 0,
    errors,
  };
}
```

### 2.3 Submission Number Generation

```typescript
// Format: TRD-YYYYMM-XXXXX (e.g., TRD-202412-00001)
async function generateSubmissionNumber(): Promise<string> {
  const now = new Date();
  const yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;

  // Get count for this month
  const count = await prisma.tradeInSubmission.count({
    where: {
      submissionNumber: {
        startsWith: `TRD-${yearMonth}`
      }
    }
  });

  const sequence = String(count + 1).padStart(5, '0');
  return `TRD-${yearMonth}-${sequence}`;
}
```

---

## 3. Card Search API

### 3.1 Search Endpoint

```typescript
// GET /api/cards/search?q=charizard&game=pokemon&limit=20
interface CardSearchParams {
  q: string;           // Search query
  game?: string;       // Filter by game
  limit?: number;      // Max results (default 20)
  minPrice?: number;   // Minimum NM price in pence
}

interface CardSearchResult {
  id: string;
  cardName: string;
  setName: string;
  setCode?: string;
  variant?: string;
  rarity?: string;
  prices: {
    NM: number;
    LP: number;
    MP: number;
    HP: number;
    DMG: number;
  };
  isActive: boolean;
}

async function searchCards(params: CardSearchParams): Promise<CardSearchResult[]> {
  const results = await prisma.cardPrice.findMany({
    where: {
      isActive: true,
      OR: [
        { cardName: { contains: params.q, mode: 'insensitive' } },
        { setName: { contains: params.q, mode: 'insensitive' } },
        { setCode: { contains: params.q, mode: 'insensitive' } },
      ],
      ...(params.game && { setName: { contains: params.game, mode: 'insensitive' } }),
      ...(params.minPrice && { priceNM: { gte: params.minPrice } }),
    },
    take: params.limit || 20,
    orderBy: [
      { priceNM: 'desc' },  // Higher value cards first
      { cardName: 'asc' },
    ],
  });

  return results.map(card => ({
    id: card.id,
    cardName: card.cardName,
    setName: card.setName,
    setCode: card.setCode,
    variant: card.variant,
    rarity: card.rarity,
    prices: {
      NM: card.priceNM,
      LP: card.priceLP,
      MP: card.priceMP,
      HP: card.priceHP,
      DMG: card.priceDMG,
    },
    isActive: card.isActive,
  }));
}
```

---

## 4. Submission Status & Updates

### 4.1 Status Tracking API

```typescript
// GET /api/submissions/:id
interface SubmissionStatusResponse {
  id: string;
  submissionNumber: string;
  status: string;
  statusLabel: string;
  statusDescription: string;

  // Timeline
  timeline: TimelineEvent[];

  // Totals
  quotedTotal: number;
  finalTotal?: number;
  bonusAmount?: number;

  // Items summary
  itemCount: number;
  verifiedCount: number;
  adjustedCount: number;
  rejectedCount: number;

  // Shipping
  shippingMethod?: string;
  trackingNumber?: string;
  labelUrl?: string;

  // Payout
  payoutType: string;
  payoutStatus?: string;

  // Next steps for customer
  nextAction?: {
    type: 'SHIP_CARDS' | 'AWAIT_GRADING' | 'REVIEW_CHANGES' | 'AWAIT_PAYOUT' | 'COMPLETE';
    message: string;
    actionUrl?: string;
  };
}

interface TimelineEvent {
  status: string;
  label: string;
  timestamp: string;
  isComplete: boolean;
  isCurrent: boolean;
}
```

### 4.2 Customer Actions

```typescript
// POST /api/submissions/:id/confirm
// Customer confirms adjusted submission
async function confirmAdjustedSubmission(submissionId: string, customerId: string) {
  const submission = await prisma.tradeInSubmission.findUnique({
    where: { id: submissionId },
    include: { customer: true }
  });

  if (!submission || submission.customerId !== customerId) {
    throw new Error('Submission not found');
  }

  if (submission.status !== 'PENDING_APPROVAL') {
    throw new Error('Submission is not pending approval');
  }

  // Move to APPROVED status
  await prisma.tradeInSubmission.update({
    where: { id: submissionId },
    data: {
      status: 'APPROVED',
      approvedAt: new Date(),
    }
  });

  // Create payout record
  await createPayoutForSubmission(submission);
}

// POST /api/submissions/:id/reject
// Customer rejects and requests return
async function rejectAndReturn(submissionId: string, customerId: string, reason: string) {
  const submission = await prisma.tradeInSubmission.findUnique({
    where: { id: submissionId }
  });

  if (!submission || submission.customerId !== customerId) {
    throw new Error('Submission not found');
  }

  if (submission.status !== 'PENDING_APPROVAL') {
    throw new Error('Submission is not pending approval');
  }

  await prisma.tradeInSubmission.update({
    where: { id: submissionId },
    data: {
      status: 'RETURNED',
    }
  });

  // Add note
  await prisma.submissionNote.create({
    data: {
      submissionId,
      authorType: 'CUSTOMER',
      message: `Rejected grading and requested return. Reason: ${reason}`,
    }
  });
}
```

---

## 5. Shipping Integration

### 5.1 Shipping Label Generation

```typescript
// Placeholder for shipping provider integration
// Could integrate with: Royal Mail, Evri, DPD, UPS, etc.

interface ShippingLabelRequest {
  submissionId: string;
  returnAddress: ReturnAddress;
  customerAddress: CustomerAddress;
  weight?: number;  // grams
  dimensions?: { length: number; width: number; height: number };
}

interface ShippingLabel {
  labelUrl: string;
  trackingNumber: string;
  carrier: string;
  estimatedDelivery?: string;
}

async function generateShippingLabel(
  request: ShippingLabelRequest
): Promise<ShippingLabel> {
  // For MVP: Generate a simple instruction sheet
  // Later: Integrate with Royal Mail API or similar

  const submission = await prisma.tradeInSubmission.findUnique({
    where: { id: request.submissionId }
  });

  if (!submission) {
    throw new Error('Submission not found');
  }

  // Update submission with tracking info
  await prisma.tradeInSubmission.update({
    where: { id: request.submissionId },
    data: {
      shippingMethod: 'PREPAID',
      // In production, would be actual tracking number from carrier
      trackingNumber: `TRACK-${submission.submissionNumber}`,
    }
  });

  return {
    labelUrl: `/api/shipping/label/${request.submissionId}`,
    trackingNumber: `TRACK-${submission.submissionNumber}`,
    carrier: 'Royal Mail',
    estimatedDelivery: '2-3 business days',
  };
}
```

### 5.2 Self-Ship Instructions

```typescript
interface SelfShipInstructions {
  returnAddress: FormattedAddress;
  submissionNumber: string;
  instructions: string[];
  packingTips: string[];
}

function getSelfShipInstructions(
  submission: TradeInSubmission,
  settings: TradeInSettings
): SelfShipInstructions {
  const returnAddress = settings.returnAddress
    ? JSON.parse(settings.returnAddress)
    : null;

  return {
    returnAddress: formatAddress(returnAddress),
    submissionNumber: submission.submissionNumber,
    instructions: [
      `Write "${submission.submissionNumber}" clearly on the outside of your package`,
      'Include a printed copy of your submission summary inside the package',
      'Use tracked shipping and save your tracking number',
      'Enter your tracking number on our website to update your submission',
    ],
    packingTips: [
      'Use card sleeves and top loaders for valuable cards',
      'Wrap cards in bubble wrap or padding',
      'Use a rigid cardboard box to prevent bending',
      'Seal the package securely with tape',
    ],
  };
}
```

---

## 6. Notifications

### 6.1 Email Templates

```typescript
enum NotificationType {
  SUBMISSION_RECEIVED = 'submission_received',
  GRADING_COMPLETE = 'grading_complete',
  PAYOUT_ISSUED = 'payout_issued',
  RETURN_SHIPPED = 'return_shipped',
}

interface EmailContext {
  customerName: string;
  submissionNumber: string;
  submissionUrl: string;
  // Type-specific fields
  [key: string]: any;
}

const emailTemplates: Record<NotificationType, (ctx: EmailContext) => EmailContent> = {
  [NotificationType.SUBMISSION_RECEIVED]: (ctx) => ({
    subject: `Trade-in ${ctx.submissionNumber} Received`,
    body: `
      Hi ${ctx.customerName},

      We've received your trade-in submission ${ctx.submissionNumber}.

      Our team will now grade your cards. This usually takes 1-3 business days.

      Track your submission: ${ctx.submissionUrl}

      Thanks for trading with us!
    `,
  }),

  [NotificationType.GRADING_COMPLETE]: (ctx) => ({
    subject: `Trade-in ${ctx.submissionNumber} Grading Complete`,
    body: `
      Hi ${ctx.customerName},

      We've finished grading your trade-in ${ctx.submissionNumber}.

      Original Quote: ${ctx.originalTotal}
      Final Value: ${ctx.finalTotal}
      ${ctx.hasChanges ? 'Some items were graded at different conditions. Please review and approve.' : ''}

      Review your submission: ${ctx.submissionUrl}

      ${ctx.hasChanges
        ? 'Please approve or request changes within 7 days.'
        : 'Your payout is being processed.'}
    `,
  }),

  [NotificationType.PAYOUT_ISSUED]: (ctx) => ({
    subject: `Trade-in ${ctx.submissionNumber} Payout Complete`,
    body: `
      Hi ${ctx.customerName},

      Your payout for trade-in ${ctx.submissionNumber} has been issued.

      Amount: ${ctx.payoutAmount}
      Type: ${ctx.payoutType}
      ${ctx.payoutType === 'STORE_CREDIT'
        ? `Gift Card: ${ctx.giftCardCode}`
        : `Reference: ${ctx.bankReference}`}

      Thanks for trading with us!
    `,
  }),

  [NotificationType.RETURN_SHIPPED]: (ctx) => ({
    subject: `Trade-in ${ctx.submissionNumber} Return Shipped`,
    body: `
      Hi ${ctx.customerName},

      Your cards from trade-in ${ctx.submissionNumber} have been shipped back to you.

      Tracking: ${ctx.trackingNumber}
      Carrier: ${ctx.carrier}

      Thanks for giving us the opportunity to review your cards.
    `,
  }),
};
```

---

## 7. Security & Authentication

### 7.1 App Proxy Setup

```typescript
// API routes are accessed via Shopify App Proxy
// /apps/trade-in/* -> our API

async function validateAppProxyRequest(request: Request): Promise<boolean> {
  const url = new URL(request.url);
  const signature = url.searchParams.get('signature');
  const timestamp = url.searchParams.get('timestamp');
  const shop = url.searchParams.get('shop');

  if (!signature || !timestamp || !shop) {
    return false;
  }

  // Verify HMAC signature
  const params = new URLSearchParams(url.search);
  params.delete('signature');
  params.sort();

  const message = params.toString();
  const expectedSignature = crypto
    .createHmac('sha256', process.env.SHOPIFY_API_SECRET!)
    .update(message)
    .digest('hex');

  return signature === expectedSignature;
}
```

### 7.2 Customer Identification

```typescript
// Options for identifying customers:
// 1. Logged-in Shopify customer (via App Proxy)
// 2. Guest with email verification
// 3. Magic link authentication

async function getOrCreateCustomer(
  shopifyCustomerId?: string,
  email?: string,
  firstName?: string,
  lastName?: string
): Promise<Customer> {
  if (shopifyCustomerId) {
    // Try to find existing customer by Shopify ID
    let customer = await prisma.customer.findUnique({
      where: { shopifyCustomerId }
    });

    if (customer) {
      return customer;
    }
  }

  if (email) {
    // Find or create by email
    let customer = await prisma.customer.findFirst({
      where: { email: email.toLowerCase() }
    });

    if (customer) {
      // Update Shopify ID if we now have one
      if (shopifyCustomerId && !customer.shopifyCustomerId) {
        customer = await prisma.customer.update({
          where: { id: customer.id },
          data: { shopifyCustomerId }
        });
      }
      return customer;
    }

    // Create new customer
    return prisma.customer.create({
      data: {
        shopifyCustomerId,
        email: email.toLowerCase(),
        firstName,
        lastName,
      }
    });
  }

  throw new Error('Either shopifyCustomerId or email is required');
}
```

---

## 8. Testing Strategy

### 8.1 Unit Tests (`app/lib/__tests__/submissions.test.ts`)

```typescript
describe('validateSubmission', () => {
  it('should accept valid submission above minimum value');
  it('should reject submission below minimum value');
  it('should reject submission exceeding item limit');
  it('should handle invalid card references');
  it('should calculate correct totals for mixed conditions');
});

describe('generateSubmissionNumber', () => {
  it('should generate unique submission numbers');
  it('should use current year-month prefix');
  it('should increment sequence correctly');
});

describe('getOrCreateCustomer', () => {
  it('should return existing customer by Shopify ID');
  it('should return existing customer by email');
  it('should create new customer when not found');
  it('should link Shopify ID to existing email customer');
});
```

### 8.2 Unit Tests (`app/lib/__tests__/shipping.test.ts`)

```typescript
describe('generateShippingLabel', () => {
  it('should create label for valid submission');
  it('should update submission with tracking info');
  it('should handle missing return address');
});

describe('getSelfShipInstructions', () => {
  it('should return formatted return address');
  it('should include submission number');
  it('should provide packing tips');
});
```

### 8.3 API Tests

```typescript
describe('POST /api/submissions', () => {
  it('should create submission with valid data');
  it('should return validation errors for invalid data');
  it('should handle guest submissions');
  it('should link to Shopify customer when available');
});

describe('GET /api/submissions/:id', () => {
  it('should return submission status for owner');
  it('should return 404 for non-existent submission');
  it('should not expose internal notes');
});

describe('POST /api/submissions/:id/confirm', () => {
  it('should approve submission and create payout');
  it('should only work for PENDING_APPROVAL status');
  it('should verify customer ownership');
});
```

---

## 9. Implementation Order

### Step 1: Core Submission Logic
1. Create `lib/submissions.server.ts` with validation and CRUD
2. Write comprehensive unit tests
3. Run tests and fix failures

### Step 2: API Routes
1. Create `api.submissions.tsx` for list/create
2. Create `api.submissions.$id.tsx` for get/update
3. Create `api.cards.search.tsx` for card autocomplete

### Step 3: Shipping
1. Create `lib/shipping.server.ts`
2. Create `api.shipping.label.tsx`
3. Write shipping tests

### Step 4: Notifications
1. Create `lib/notifications.server.ts`
2. Integrate with submission workflow
3. Test email generation

### Step 5: Documentation
1. Update CLAUDE.md with Phase 3 status
2. Document API endpoints
3. Create integration examples

---

## 10. API Summary

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/submissions | Create new submission |
| GET | /api/submissions/:id | Get submission status |
| PUT | /api/submissions/:id | Update submission (add items) |
| POST | /api/submissions/:id/submit | Submit for processing |
| POST | /api/submissions/:id/confirm | Approve grading results |
| POST | /api/submissions/:id/reject | Reject and request return |
| GET | /api/cards/search | Search card catalog |
| POST | /api/shipping/label | Generate shipping label |
| GET | /api/shipping/instructions/:id | Get self-ship instructions |

---

## 11. Database Indexes

```sql
-- For customer lookups
CREATE INDEX idx_customer_email ON "Customer"("email");

-- For submission lookups by customer
CREATE INDEX idx_submission_customer ON "TradeInSubmission"("customerId", "createdAt" DESC);
```

---

## Summary

Phase 3 delivers the customer-facing submission system:
- **Submission Creation** with card search and validation
- **Quote Calculation** with condition-based pricing
- **Shipping Options** with label generation
- **Status Tracking** for transparency
- **Customer Actions** for approval/rejection

This enables customers to:
1. Build trade-in lists by searching the card catalog
2. See real-time pricing based on card condition
3. Choose their preferred payout method
4. Ship cards with generated labels or self-ship
5. Track submission progress and approve final values
