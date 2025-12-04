# Phase 2: Settings, Price Management & Payout Processing

## Overview

Phase 2 completes the merchant-side functionality by adding:
1. **Settings Management** - Configure multipliers, thresholds, notifications
2. **Price Management** - Browse, search, import prices from external sources
3. **Payout Processing** - Issue store credit (Shopify gift cards) and track bank transfers

---

## 1. Settings Management

### 1.1 File Structure

```
app/
├── routes/
│   └── app.settings.tsx          # Complete rewrite with all settings
├── lib/
│   └── settings.server.ts        # Settings CRUD, defaults, validation
```

### 1.2 Settings Categories

#### A. Pricing & Multipliers
| Setting | Type | Default | Validation |
|---------|------|---------|------------|
| conditionMultiplierNM | Float | 0.70 | 0.01 - 1.00 |
| conditionMultiplierLP | Float | 0.55 | 0.01 - 1.00, < NM |
| conditionMultiplierMP | Float | 0.40 | 0.01 - 1.00, < LP |
| conditionMultiplierHP | Float | 0.25 | 0.01 - 1.00, < MP |
| conditionMultiplierDMG | Float | 0.10 | 0.01 - 1.00, < HP |
| storeCreditBonusPercent | Int | 10 | 0 - 50 |
| cashPayoutPercent | Int | 100 | 50 - 100 |

#### B. Thresholds & Limits
| Setting | Type | Default | Validation |
|---------|------|---------|------------|
| minimumSubmissionValue | Int (pence) | 500 | 0 - 100000 |
| requiresApprovalAbove | Int (pence) | 5000 | >= autoApproveBelow |
| autoApproveBelow | Int (pence) | 2000 | <= requiresApprovalAbove |
| maxItemsPerSubmission | Int | 100 | 1 - 500 |

#### C. Shipping
| Setting | Type | Default | Validation |
|---------|------|---------|------------|
| freeShippingMinimum | Int (pence) | 5000 | 0 - 100000 |
| shippingLabelEnabled | Boolean | true | - |
| returnAddress | JSON | null | Valid address object |

#### D. Notifications
| Setting | Type | Default | Notes |
|---------|------|---------|-------|
| notifyOnSubmission | Boolean | true | Email merchant on new submission |
| notifyOnReceived | Boolean | true | Email customer when received |
| notifyOnGraded | Boolean | true | Email customer with grading results |

#### E. Content
| Setting | Type | Default | Validation |
|---------|------|---------|------------|
| termsAndConditions | Text | null | Max 10000 chars |
| gradingGuideUrl | String | null | Valid URL or null |

### 1.3 Edge Cases & Error Handling

```typescript
// Edge Case 1: Multipliers must be in descending order
function validateMultipliers(multipliers: ConditionMultipliers): ValidationResult {
  const order = ['NM', 'LP', 'MP', 'HP', 'DMG'];
  for (let i = 0; i < order.length - 1; i++) {
    const current = multipliers[`conditionMultiplier${order[i]}`];
    const next = multipliers[`conditionMultiplier${order[i + 1]}`];
    if (current <= next) {
      return {
        valid: false,
        error: `${order[i]} multiplier must be greater than ${order[i + 1]}`
      };
    }
  }
  return { valid: true };
}

// Edge Case 2: Threshold consistency
function validateThresholds(settings: ThresholdSettings): ValidationResult {
  if (settings.autoApproveBelow > settings.requiresApprovalAbove) {
    return {
      valid: false,
      error: 'Auto-approve threshold cannot exceed requires-approval threshold'
    };
  }
  return { valid: true };
}

// Edge Case 3: Return address validation
interface ReturnAddress {
  name: string;      // Required
  company?: string;
  address1: string;  // Required
  address2?: string;
  city: string;      // Required
  province?: string;
  postalCode: string; // Required
  country: string;   // Required, ISO 2-letter code
  phone?: string;
}

// Edge Case 4: First-time setup (no settings exist)
async function getOrCreateSettings(shop: string): Promise<TradeInSettings> {
  let settings = await prisma.tradeInSettings.findUnique({
    where: { shop }
  });

  if (!settings) {
    settings = await prisma.tradeInSettings.create({
      data: { shop, /* defaults applied by Prisma */ }
    });
  }

  return settings;
}
```

### 1.4 UI Components

```
┌─────────────────────────────────────────────────────────────────┐
│ Settings                                                    Save│
├─────────────────────────────────────────────────────────────────┤
│ ┌─ Pricing ──────────────────────────────────────────────────┐ │
│ │                                                             │ │
│ │  Condition Multipliers                                      │ │
│ │  ┌─────────────────────────────────────────────────────┐   │ │
│ │  │ NM    [====70%====]  £7.00 per £10 market value    │   │ │
│ │  │ LP    [===55%===]    £5.50 per £10 market value    │   │ │
│ │  │ MP    [==40%==]      £4.00 per £10 market value    │   │ │
│ │  │ HP    [=25%=]        £2.50 per £10 market value    │   │ │
│ │  │ DMG   [10%]          £1.00 per £10 market value    │   │ │
│ │  └─────────────────────────────────────────────────────┘   │ │
│ │                                                             │ │
│ │  Store Credit Bonus    [===10%===]  +10% for store credit  │ │
│ │  Cash Payout Rate      [====100%====]  100% of trade value │ │
│ │                                                             │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│ ┌─ Thresholds ───────────────────────────────────────────────┐ │
│ │  Minimum Submission    £[ 5.00  ]                          │ │
│ │  Auto-approve Below    £[ 20.00 ]  ⓘ Approve automatically │ │
│ │  Require Approval      £[ 50.00 ]  ⓘ Manual review needed  │ │
│ │  Max Items             [ 100    ]  per submission          │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│ ┌─ Shipping ─────────────────────────────────────────────────┐ │
│ │  [✓] Enable prepaid shipping labels                        │ │
│ │  Free shipping above   £[ 50.00 ]                          │ │
│ │                                                             │ │
│ │  Return Address:                                            │ │
│ │  ┌─────────────────────────────────────────────────────┐   │ │
│ │  │ CardForum Ltd                                        │   │ │
│ │  │ Unit 5, Trading Estate                               │   │ │
│ │  │ Cambridge, CB1 2AB                                   │   │ │
│ │  │ United Kingdom                          [Edit]       │   │ │
│ │  └─────────────────────────────────────────────────────┘   │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│ ┌─ Notifications ────────────────────────────────────────────┐ │
│ │  [✓] Notify me on new submission                           │ │
│ │  [✓] Notify customer when package received                 │ │
│ │  [✓] Notify customer when grading complete                 │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│ ┌─ Content ──────────────────────────────────────────────────┐ │
│ │  Grading Guide URL  [https://example.com/grading-guide   ] │ │
│ │                                                             │ │
│ │  Terms & Conditions                                         │ │
│ │  ┌─────────────────────────────────────────────────────┐   │ │
│ │  │ By submitting cards for trade-in, you agree to...   │   │ │
│ │  │                                                      │   │ │
│ │  └─────────────────────────────────────────────────────┘   │ │
│ └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. Price Management

### 2.1 File Structure

```
app/
├── routes/
│   ├── app.prices.tsx              # Price list with search/filter
│   ├── app.prices.$id.tsx          # Individual price edit
│   └── app.prices.import.tsx       # Import from external sources
├── lib/
│   └── prices.server.ts            # Price sync, search, CRUD
```

### 2.2 Data Sources

We have two price tables:
1. **CardPrice** - Internal prices used for trade-ins (editable)
2. **ExternalCardPrice** - Synced from Lambda price fetcher (read-only, source of truth)

#### Price Sync Strategy

```typescript
interface PriceSyncOptions {
  source: 'external' | 'manual';
  game?: string;           // Filter by game (e.g., 'pokemon', 'yugioh')
  overwriteExisting: boolean;
  applyMultipliers: boolean; // Apply condition multipliers to base price
}

// Sync flow:
// 1. Fetch from ExternalCardPrice (already populated by Lambda)
// 2. Calculate condition-based prices using multipliers
// 3. Insert/update CardPrice records

async function syncPricesFromExternal(options: PriceSyncOptions): Promise<SyncResult> {
  const settings = await getSettings();

  const externalPrices = await prisma.externalCardPrice.findMany({
    where: options.game ? { game: options.game } : {},
  });

  const results = { created: 0, updated: 0, skipped: 0, errors: [] };

  for (const external of externalPrices) {
    try {
      // Calculate condition prices from tradein_price_gbp or market_price_gbp
      const basePrice = external.tradeinPriceGbp ?? external.marketPriceGbp ?? 0;
      const basePence = poundsToPence(Number(basePrice));

      const priceData = {
        cardName: external.name,
        setName: external.game,  // Or parse from card_id
        priceNM: Math.floor(basePence * settings.conditionMultiplierNM),
        priceLP: Math.floor(basePence * settings.conditionMultiplierLP),
        priceMP: Math.floor(basePence * settings.conditionMultiplierMP),
        priceHP: Math.floor(basePence * settings.conditionMultiplierHP),
        priceDMG: Math.floor(basePence * settings.conditionMultiplierDMG),
        isActive: basePence >= PriceConstants.MIN_TRADEABLE_PRICE,
      };

      const existing = await prisma.cardPrice.findFirst({
        where: { cardName: external.name, setName: external.game }
      });

      if (existing) {
        if (options.overwriteExisting) {
          await prisma.cardPrice.update({
            where: { id: existing.id },
            data: priceData,
          });
          results.updated++;
        } else {
          results.skipped++;
        }
      } else {
        await prisma.cardPrice.create({ data: priceData });
        results.created++;
      }
    } catch (error) {
      results.errors.push({ card: external.name, error: error.message });
    }
  }

  return results;
}
```

### 2.3 Search & Filter

```typescript
interface PriceSearchParams {
  search?: string;        // Card name, set name
  game?: string;          // pokemon, yugioh, mtg
  minPrice?: number;      // Minimum NM price in pence
  maxPrice?: number;      // Maximum NM price in pence
  isActive?: boolean;
  hasExternalPrice?: boolean;
  sort?: 'name' | 'price-asc' | 'price-desc' | 'updated';
  page?: number;
  limit?: number;
}

// Full-text search on card names
async function searchPrices(params: PriceSearchParams) {
  const where: Prisma.CardPriceWhereInput = {};

  if (params.search) {
    where.OR = [
      { cardName: { contains: params.search, mode: 'insensitive' } },
      { setName: { contains: params.search, mode: 'insensitive' } },
      { setCode: { contains: params.search, mode: 'insensitive' } },
    ];
  }

  if (params.isActive !== undefined) {
    where.isActive = params.isActive;
  }

  if (params.minPrice !== undefined || params.maxPrice !== undefined) {
    where.priceNM = {};
    if (params.minPrice) where.priceNM.gte = params.minPrice;
    if (params.maxPrice) where.priceNM.lte = params.maxPrice;
  }

  // ... rest of filtering
}
```

### 2.4 UI Components

#### Price List View
```
┌─────────────────────────────────────────────────────────────────┐
│ Card Prices                                      [Sync Prices ▼]│
├─────────────────────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ 🔍 [Search cards...                              ] [Filter] │ │
│ │                                                              │ │
│ │ Game: [All ▼]  Status: [All ▼]  Price: [£0] - [£500]       │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│ Showing 1,547 cards                          Sort: [Name A-Z ▼] │
│                                                                  │
│ ┌─────┬────────────────────────┬─────────┬───────────────────┐ │
│ │     │ Card                   │ Set     │ Trade-In Prices   │ │
│ ├─────┼────────────────────────┼─────────┼───────────────────┤ │
│ │ [✓] │ Charizard VMAX         │ SWSH    │ NM £45 LP £35 ... │ │
│ │ [✓] │ Pikachu V              │ SWSH    │ NM £12 LP £9 ...  │ │
│ │ [ ] │ Mewtwo GX (Inactive)   │ SM      │ NM £8  LP £6 ...  │ │
│ │ [✓] │ Lugia V Alt Art        │ SV      │ NM £85 LP £66 ... │ │
│ └─────┴────────────────────────┴─────────┴───────────────────┘ │
│                                                                  │
│ Selected: 0                    [◀ Prev] Page 1 of 78 [Next ▶]  │
│                                                                  │
│ Bulk Actions: [Set Active] [Set Inactive] [Delete]              │
└─────────────────────────────────────────────────────────────────┘
```

#### Sync Prices Modal
```
┌─────────────────────────────────────────────────────────────────┐
│ Sync Prices from External Source                            [X] │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Source: External Price Feed (Lambda)                           │
│                                                                  │
│  Game Filter:                                                    │
│  ○ All Games                                                     │
│  ● Pokemon                                                       │
│  ○ Yu-Gi-Oh!                                                     │
│  ○ Magic: The Gathering                                          │
│                                                                  │
│  Options:                                                        │
│  [✓] Apply current condition multipliers                        │
│  [ ] Overwrite existing prices (⚠️ manual edits will be lost)   │
│  [✓] Skip cards with price below £0.50                          │
│                                                                  │
│  Preview:                                                        │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ 12,456 cards found                                         │  │
│  │ 8,234 new cards will be created                            │  │
│  │ 4,222 existing cards will be skipped (or updated)          │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                  │
│                                    [Cancel]  [Start Sync]       │
└─────────────────────────────────────────────────────────────────┘
```

### 2.5 Edge Cases

```typescript
// Edge Case 1: Price too low to be tradeable
const MIN_TRADEABLE_PRICE = 50; // 50p minimum

function shouldBeActive(priceNM: number): boolean {
  return priceNM >= MIN_TRADEABLE_PRICE;
}

// Edge Case 2: Missing data from external source
function handleMissingPrice(external: ExternalCardPrice): number {
  // Priority: tradeinPriceGbp > marketPriceGbp > tcgplayerPriceGbp > 0
  return Number(
    external.tradeinPriceGbp ??
    external.marketPriceGbp ??
    external.tcgplayerPriceGbp ??
    0
  );
}

// Edge Case 3: Duplicate card names across sets
// Solution: Composite key of cardName + setName + variant
async function findOrCreatePrice(card: CardData): Promise<CardPrice> {
  const existing = await prisma.cardPrice.findFirst({
    where: {
      cardName: card.name,
      setName: card.set,
      variant: card.variant ?? null,
    }
  });
  // ...
}

// Edge Case 4: Bulk operations on large datasets
// Solution: Batch processing with progress tracking
async function bulkUpdatePrices(
  ids: string[],
  update: Partial<CardPrice>,
  onProgress?: (progress: number) => void
): Promise<BulkResult> {
  const BATCH_SIZE = 100;
  const results = { success: 0, failed: 0 };

  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batch = ids.slice(i, i + BATCH_SIZE);

    try {
      await prisma.cardPrice.updateMany({
        where: { id: { in: batch } },
        data: update,
      });
      results.success += batch.length;
    } catch (error) {
      results.failed += batch.length;
    }

    onProgress?.((i + batch.length) / ids.length);
  }

  return results;
}
```

---

## 3. Payout Processing

### 3.1 File Structure

```
app/
├── routes/
│   ├── app.payouts.tsx             # Payout queue/history
│   └── app.payouts.$id.tsx         # Individual payout details
├── lib/
│   ├── payouts.server.ts           # Payout processing logic
│   └── shopify-giftcard.server.ts  # Shopify gift card API wrapper
```

### 3.2 Payout Types

#### A. Store Credit (Shopify Gift Card)
```typescript
interface StoreCreditPayout {
  type: 'STORE_CREDIT';
  amount: number;           // Base amount in pence
  bonusAmount: number;      // Store credit bonus in pence
  totalAmount: number;      // Final amount
  giftCardId?: string;      // Shopify gift card ID
  giftCardCode?: string;    // Gift card code (masked for display)
  giftCardLastChars?: string; // Last 4 chars for reference
}

// Shopify Admin API - Create Gift Card
const CREATE_GIFT_CARD = `#graphql
  mutation giftCardCreate($input: GiftCardCreateInput!) {
    giftCardCreate(input: $input) {
      giftCard {
        id
        lastCharacters
        maskedCode
        balance {
          amount
          currencyCode
        }
        expiresOn
        customer {
          id
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

async function createStoreCreditPayout(
  submission: TradeInSubmission,
  admin: AdminApiContext
): Promise<PayoutResult> {
  const settings = await getSettings();

  // Calculate amounts
  const baseAmount = submission.finalTotal ?? submission.quotedTotal;
  const bonusAmount = Math.floor(baseAmount * (settings.storeCreditBonusPercent / 100));
  const totalAmount = baseAmount + bonusAmount;

  // Convert pence to pounds for Shopify
  const amountInPounds = (totalAmount / 100).toFixed(2);

  try {
    const response = await admin.graphql(CREATE_GIFT_CARD, {
      variables: {
        input: {
          initialValue: amountInPounds,
          customerId: submission.customer.shopifyCustomerId
            ? `gid://shopify/Customer/${submission.customer.shopifyCustomerId}`
            : null,
          note: `Trade-in #${submission.submissionNumber}`,
          expiresOn: null, // No expiry
        }
      }
    });

    const data = await response.json();

    if (data.data.giftCardCreate.userErrors.length > 0) {
      throw new Error(data.data.giftCardCreate.userErrors[0].message);
    }

    const giftCard = data.data.giftCardCreate.giftCard;

    // Update payout record
    await prisma.payout.update({
      where: { submissionId: submission.id },
      data: {
        status: 'COMPLETED',
        giftCardId: giftCard.id,
        giftCardCode: giftCard.maskedCode,
        processedAt: new Date(),
      }
    });

    return { success: true, giftCard };

  } catch (error) {
    await prisma.payout.update({
      where: { submissionId: submission.id },
      data: {
        status: 'FAILED',
        failureReason: error.message,
      }
    });

    return { success: false, error: error.message };
  }
}
```

#### B. Bank Transfer
```typescript
interface BankTransferPayout {
  type: 'BANK';
  amount: number;
  totalAmount: number;
  bankReference?: string;   // Bank transfer reference
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
}

// Bank transfers are manual - we just track the status
async function markBankTransferProcessing(
  payoutId: string,
  bankReference: string
): Promise<void> {
  await prisma.payout.update({
    where: { id: payoutId },
    data: {
      status: 'PROCESSING',
      bankReference,
    }
  });
}

async function markBankTransferCompleted(payoutId: string): Promise<void> {
  await prisma.payout.update({
    where: { id: payoutId },
    data: {
      status: 'COMPLETED',
      processedAt: new Date(),
    }
  });
}
```

#### C. PayPal
```typescript
interface PayPalPayout {
  type: 'PAYPAL';
  amount: number;
  totalAmount: number;
  paypalEmail: string;
  paypalTransactionId?: string;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
}

// PayPal payouts would integrate with PayPal Payouts API
// For MVP, we'll treat it like bank transfer (manual)
```

### 3.3 Payout Workflow

```
┌─────────────┐
│  APPROVED   │
└──────┬──────┘
       │
       ▼
┌─────────────┐     ┌─────────────┐
│   PENDING   │────▶│ PROCESSING  │
└──────┬──────┘     └──────┬──────┘
       │                   │
       │                   ▼
       │            ┌─────────────┐
       │            │  COMPLETED  │
       │            └─────────────┘
       │                   ▲
       ▼                   │
┌─────────────┐            │
│   FAILED    │────────────┘ (retry)
└─────────────┘
```

### 3.4 Automatic Payout Triggering

```typescript
// When submission moves to APPROVED, create payout record
async function onSubmissionApproved(submission: TradeInSubmission) {
  const settings = await getSettings();

  const baseAmount = submission.finalTotal ?? submission.quotedTotal;
  let bonusAmount = 0;
  let totalAmount = baseAmount;

  if (submission.payoutType === 'STORE_CREDIT') {
    bonusAmount = Math.floor(baseAmount * (settings.storeCreditBonusPercent / 100));
    totalAmount = baseAmount + bonusAmount;
  } else if (submission.payoutType === 'BANK' || submission.payoutType === 'PAYPAL') {
    // Apply cash payout percentage if less than 100%
    if (settings.cashPayoutPercent < 100) {
      totalAmount = Math.floor(baseAmount * (settings.cashPayoutPercent / 100));
    }
  }

  // Create payout record
  await prisma.payout.create({
    data: {
      submissionId: submission.id,
      customerId: submission.customerId,
      type: submission.payoutType,
      amount: baseAmount,
      bonusAmount,
      totalAmount,
      status: 'PENDING',
    }
  });

  // For store credit, attempt auto-processing
  if (submission.payoutType === 'STORE_CREDIT') {
    // Queue for processing (or process immediately)
    await processStoreCreditPayout(submission.id);
  }
}
```

### 3.5 UI Components

#### Payouts Queue
```
┌─────────────────────────────────────────────────────────────────┐
│ Payouts                                                         │
├─────────────────────────────────────────────────────────────────┤
│ [Pending (3)] [Processing (1)] [Completed] [Failed]             │
│                                                                  │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ #TRD-0045    Store Credit    £125.40    PENDING    [Issue]  │ │
│ │ John Smith   +£11.40 bonus   Today                          │ │
│ ├─────────────────────────────────────────────────────────────┤ │
│ │ #TRD-0044    Bank Transfer   £89.00     PENDING    [Mark]   │ │
│ │ Sarah Jones                  Yesterday                       │ │
│ ├─────────────────────────────────────────────────────────────┤ │
│ │ #TRD-0042    Store Credit    £45.00     PENDING    [Issue]  │ │
│ │ Mike Brown   +£4.50 bonus    2 days ago                     │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│ Bulk Actions: [Issue All Store Credit] [Export for Bank]       │
└─────────────────────────────────────────────────────────────────┘
```

### 3.6 Edge Cases & Error Handling

```typescript
// Edge Case 1: Shopify API rate limiting
async function processStoreCreditWithRetry(
  submissionId: string,
  maxRetries = 3
): Promise<PayoutResult> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await createStoreCreditPayout(submissionId);
    } catch (error) {
      if (error.message.includes('rate limit') && attempt < maxRetries) {
        await sleep(1000 * attempt); // Exponential backoff
        continue;
      }
      throw error;
    }
  }
}

// Edge Case 2: Customer doesn't have Shopify account
// Solution: Create gift card without customer association, email code
async function createGiftCardForNonCustomer(
  submission: TradeInSubmission,
  email: string
): Promise<GiftCard> {
  const giftCard = await createGiftCard({ /* no customerId */ });

  // Send email with gift card code
  await sendGiftCardEmail(email, giftCard.code, submission);

  return giftCard;
}

// Edge Case 3: Partial payout failure
// Solution: Track individual payout attempts, allow retry
interface PayoutAttempt {
  attemptedAt: Date;
  status: 'success' | 'failed';
  errorMessage?: string;
}

// Edge Case 4: Currency mismatch
// Shopify store might be in different currency than our pence-based calculations
async function convertToStoreCurrency(
  amountInPence: number,
  storeCurrency: string
): Promise<{ amount: string; currency: string }> {
  if (storeCurrency === 'GBP') {
    return { amount: (amountInPence / 100).toFixed(2), currency: 'GBP' };
  }

  // Fetch exchange rate and convert
  const rate = await getExchangeRate('GBP', storeCurrency);
  const convertedAmount = (amountInPence / 100) * rate;

  return { amount: convertedAmount.toFixed(2), currency: storeCurrency };
}

// Edge Case 5: Duplicate payout prevention
async function ensureNoDuplicatePayout(submissionId: string): Promise<void> {
  const existing = await prisma.payout.findUnique({
    where: { submissionId }
  });

  if (existing && existing.status === 'COMPLETED') {
    throw new Error('Payout already completed for this submission');
  }
}

// Edge Case 6: Bank transfer batch export
async function exportBankTransfers(
  payoutIds: string[]
): Promise<BankExportFile> {
  const payouts = await prisma.payout.findMany({
    where: {
      id: { in: payoutIds },
      type: 'BANK',
      status: 'PENDING'
    },
    include: {
      customer: {
        include: {
          payoutMethods: {
            where: { type: 'BANK', isDefault: true }
          }
        }
      }
    }
  });

  // Generate CSV for bank batch upload
  const csv = payouts.map(p => ({
    reference: `TRD-${p.submission.submissionNumber}`,
    sortCode: p.customer.payoutMethods[0]?.bsb,
    accountNumber: p.customer.payoutMethods[0]?.accountNumber,
    accountName: p.customer.payoutMethods[0]?.accountName,
    amount: (p.totalAmount / 100).toFixed(2),
  }));

  return { filename: `bank-transfers-${Date.now()}.csv`, data: csv };
}
```

---

## 4. Testing Strategy

### 4.1 Unit Tests

#### Settings Tests (`app/lib/__tests__/settings.test.ts`)
```typescript
describe('validateMultipliers', () => {
  it('should accept valid descending multipliers');
  it('should reject when LP >= NM');
  it('should reject when MP >= LP');
  it('should reject multipliers outside 0-1 range');
});

describe('validateThresholds', () => {
  it('should accept valid threshold combination');
  it('should reject autoApprove > requiresApproval');
});

describe('validateReturnAddress', () => {
  it('should accept complete address');
  it('should reject missing required fields');
  it('should validate country code format');
});
```

#### Pricing Tests (`app/lib/__tests__/prices.test.ts`)
```typescript
describe('syncPricesFromExternal', () => {
  it('should create new price records');
  it('should skip existing when overwrite=false');
  it('should update existing when overwrite=true');
  it('should apply condition multipliers correctly');
  it('should handle missing external prices gracefully');
  it('should deactivate cards below minimum price');
});

describe('searchPrices', () => {
  it('should search by card name');
  it('should filter by game');
  it('should filter by price range');
  it('should paginate results');
});
```

#### Payout Tests (`app/lib/__tests__/payouts.test.ts`)
```typescript
describe('createStoreCreditPayout', () => {
  it('should create gift card via Shopify API');
  it('should apply store credit bonus');
  it('should handle API errors gracefully');
  it('should prevent duplicate payouts');
  it('should update payout status on success');
  it('should record failure reason on error');
});

describe('processPayoutQueue', () => {
  it('should process pending store credit payouts');
  it('should skip bank transfer payouts');
  it('should handle rate limiting');
});
```

### 4.2 Integration Tests

```typescript
describe('Settings E2E', () => {
  it('should load default settings on first visit');
  it('should save and reload custom settings');
  it('should show validation errors for invalid input');
  it('should update multipliers and affect price calculations');
});

describe('Price Sync E2E', () => {
  it('should sync prices from external table');
  it('should show progress during sync');
  it('should report sync results');
  it('should handle sync errors');
});

describe('Payout E2E', () => {
  it('should create payout when submission approved');
  it('should issue gift card and complete payout');
  it('should show payout in submission detail');
  it('should allow retry on failed payout');
});
```

### 4.3 Test Mocks

```typescript
// Mock Shopify Admin API for gift card creation
const mockAdminGraphql = vi.fn().mockResolvedValue({
  json: () => ({
    data: {
      giftCardCreate: {
        giftCard: {
          id: 'gid://shopify/GiftCard/123',
          lastCharacters: 'ABCD',
          maskedCode: '•••• •••• •••• ABCD',
          balance: { amount: '125.40', currencyCode: 'GBP' },
        },
        userErrors: [],
      }
    }
  })
});

// Mock external price data
const mockExternalPrices = [
  {
    cardId: 'swsh-001',
    name: 'Charizard VMAX',
    game: 'pokemon',
    tradeinPriceGbp: new Decimal('65.00'),
    marketPriceGbp: new Decimal('95.00'),
  },
  // ...
];
```

---

## 5. Implementation Order

### Week 1: Settings Management
1. Create `lib/settings.server.ts` with validation logic
2. Write settings unit tests
3. Build `app.settings.tsx` with full UI
4. Test settings persistence and validation

### Week 2: Price Management
1. Create `lib/prices.server.ts` with search/sync logic
2. Write price management tests
3. Build `app.prices.tsx` with search/filter UI
4. Build price sync modal and import functionality
5. Add bulk operations

### Week 3: Payout Processing
1. Create `lib/payouts.server.ts` and `lib/shopify-giftcard.server.ts`
2. Write payout unit tests with mocked Shopify API
3. Build `app.payouts.tsx` queue interface
4. Integrate payout creation with submission approval
5. Add bank transfer export functionality

### Week 4: Integration & Polish
1. Integration testing across all features
2. Error handling improvements
3. Loading states and optimistic updates
4. Documentation and code cleanup

---

## 6. Database Indexes (Performance)

Add these indexes for Phase 2 queries:

```sql
-- For price search
CREATE INDEX idx_card_price_name ON "CardPrice"("cardName");
CREATE INDEX idx_card_price_set ON "CardPrice"("setName");
CREATE INDEX idx_card_price_active ON "CardPrice"("isActive");

-- For payout queue
CREATE INDEX idx_payout_status ON "Payout"("status");
CREATE INDEX idx_payout_type_status ON "Payout"("type", "status");
```

---

## 7. Security Considerations

1. **Settings Access**: Verify shop ownership before allowing settings changes
2. **Price Sync**: Only allow authenticated admins to trigger sync
3. **Payout Processing**: Log all payout actions with timestamps and actor
4. **Gift Card Codes**: Never expose full gift card codes in UI or logs
5. **Bank Details**: Encrypt sensitive payment method data at rest
6. **Rate Limiting**: Implement rate limiting on sync and payout endpoints

---

## 8. Monitoring & Alerts

1. **Payout Failures**: Alert on repeated payout failures
2. **Sync Failures**: Alert on price sync errors
3. **Stale Payouts**: Alert on payouts pending > 24 hours
4. **Settings Changes**: Log all settings modifications

---

## Summary

Phase 2 delivers the complete merchant toolset:
- **Settings**: Full control over pricing, thresholds, and notifications
- **Prices**: Searchable price list with sync from external sources
- **Payouts**: Automated store credit issuance and bank transfer tracking

This enables merchants to:
1. Configure the system to their business model
2. Maintain accurate, up-to-date pricing
3. Efficiently process customer payouts

Phase 3 will focus on the customer-facing submission flow.
