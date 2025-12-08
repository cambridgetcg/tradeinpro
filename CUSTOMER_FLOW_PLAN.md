# Customer-Facing Trade-In Flow Design

## Executive Summary

Design a frictionless, mobile-first trade-in experience that guides customers from price discovery through submission completion and tracking. The goal is maximum conversion with minimum effort.

---

## User Personas

### 1. Casual Seller
- Has 1-5 valuable cards
- Wants quick price check
- May abandon if process is too complex
- **Priority**: Speed and simplicity

### 2. Bulk Seller
- Has 10+ cards to trade
- Needs efficient entry method
- Values accuracy over speed
- **Priority**: Bulk operations and cart management

### 3. First-Timer
- Never used trade-in service before
- Needs clear guidance and trust signals
- May have questions about grading/shipping
- **Priority**: Education and confidence

### 4. Returning Customer
- Checking on previous submission
- May want to submit more cards
- Familiar with process
- **Priority**: Quick access to tracking

---

## User Journey

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           CUSTOMER JOURNEY                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌────────┐│
│  │  PRICE   │───▶│  BUILD   │───▶│  REVIEW  │───▶│  SHIP    │───▶│ TRACK  ││
│  │  CHECK   │    │  CART    │    │ & SUBMIT │    │  CARDS   │    │ STATUS ││
│  └──────────┘    └──────────┘    └──────────┘    └──────────┘    └────────┘│
│       │                                                              ▲      │
│       │                                                              │      │
│       └──────────────────────────────────────────────────────────────┘      │
│                        (can check prices anytime)                           │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Phase 1: Landing & Price Discovery

### 1.1 Landing Page (`/pages/trade-in`)

**Purpose**: Introduce the service and drive action

**Layout**:
```
┌─────────────────────────────────────────────────┐
│  [Hero Section]                                 │
│  "Turn Your Cards Into Cash or Store Credit"   │
│  [Start Trade-In Button] [Check Prices Button] │
├─────────────────────────────────────────────────┤
│  [How It Works - 4 Steps]                       │
│  1. Search Cards  2. Add to Cart                │
│  3. Ship to Us    4. Get Paid                   │
├─────────────────────────────────────────────────┤
│  [Trust Signals]                                │
│  ✓ 10% Bonus Store Credit                       │
│  ✓ Free Shipping Over £50                       │
│  ✓ Fast Grading (2-3 Days)                      │
│  ✓ Fair Market Prices                           │
├─────────────────────────────────────────────────┤
│  [Quick Price Checker]                          │
│  Search: [________________________] [Check]     │
├─────────────────────────────────────────────────┤
│  [FAQ Accordion]                                │
│  - How does condition affect price?             │
│  - When will I get paid?                        │
│  - What if I disagree with grading?             │
└─────────────────────────────────────────────────┘
```

**Components Needed**:
- `trade-in-hero.liquid` - Hero section with CTAs
- `trade-in-steps.liquid` - Visual process steps
- `trade-in-faq.liquid` - FAQ accordion

### 1.2 Quick Price Checker (Standalone)

**Purpose**: Allow price checking without commitment

**Features**:
- Instant search as you type
- Show card image, name, set, all condition prices
- "Add to Trade-In" button on each result
- No login required
- Mobile-optimized

**UI**:
```
┌─────────────────────────────────────────────────┐
│  Quick Price Check                              │
│  ┌─────────────────────────────────────────┐   │
│  │ 🔍 Search by card name or number...     │   │
│  └─────────────────────────────────────────┘   │
│                                                 │
│  [Results]                                      │
│  ┌─────────────────────────────────────────┐   │
│  │ [IMG] Monkey D. Luffy (119)             │   │
│  │       OP05 - Parallel                    │   │
│  │       ─────────────────────────────      │   │
│  │       NM: £678    LP: £530              │   │
│  │       MP: £385    HP: £240              │   │
│  │       [Add to Trade-In ▶]               │   │
│  └─────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘
```

---

## Phase 2: Card Selection & Cart Building

### 2.1 Main Trade-In Form (Enhanced)

**Current State**: Already implemented with search, browse, cart
**Improvements Needed**:

#### A. Simplified Card Selection Flow

**Current**: Click card → Modal → Select condition → Select quantity → Add
**Improved**:
- Quick-add with default NM condition (single click)
- Long-press/right-click for condition selection
- Bulk condition adjustment in cart

```
[Card Tile]
┌─────────────────┐
│     [Image]     │
│   Card Name     │
│   OP05 - Para   │
│   £678 (NM)     │
│ [+Add] [▼More]  │
└─────────────────┘

[+Add] = Instant add as NM
[▼More] = Opens condition selector
```

#### B. Smart Cart Features

1. **Duplicate Detection**: Warn if same card/condition already in cart
2. **Price Breakdown**: Show each condition's multiplier
3. **Bulk Actions**:
   - Set all to same condition
   - Remove all from same set
   - Duplicate item
4. **Save Cart**: localStorage persistence + optional email save

#### C. Progress Indicator

```
[Step 1: Add Cards] ─── [Step 2: Your Info] ─── [Step 3: Review] ─── [Step 4: Ship]
      ●═══════════════════○════════════════════○═══════════════════○
```

### 2.2 Browse Improvements

#### A. Enhanced Filtering
- **By Set**: Already exists
- **By Release**: Add (e.g., OP07, OP08)
- **By Price Range**: £0-10, £10-50, £50+
- **By Variant Type**: Parallel, SP, Manga, etc.
- **Sort Options**: Price High/Low, Name, Newest

#### B. Set Gallery View
```
┌─────────────────────────────────────────────────┐
│  Browse by Set                                  │
│  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐      │
│  │OP01 │ │OP02 │ │OP03 │ │OP04 │ │OP05 │      │
│  │ 33  │ │ 33  │ │ 31  │ │ 36  │ │ 35  │      │
│  │cards│ │cards│ │cards│ │cards│ │cards│      │
│  └─────┘ └─────┘ └─────┘ └─────┘ └─────┘      │
│  [Click to browse set]                          │
└─────────────────────────────────────────────────┘
```

---

## Phase 3: Customer Information & Review

### 3.1 Streamlined Info Collection

**For Logged-In Customers**:
- Auto-fill from Shopify account
- Just confirm payout preference
- Skip to review

**For Guests**:
- Email only required (for tracking)
- Name optional
- No account creation needed
- Offer account creation after submission

### 3.2 Payout Selection (Enhanced)

```
┌─────────────────────────────────────────────────┐
│  How would you like to be paid?                 │
│                                                 │
│  ┌─────────────────────────────────────────┐   │
│  │ ⭐ STORE CREDIT           RECOMMENDED   │   │
│  │    Get 10% bonus on your trade-in       │   │
│  │    ────────────────────────────────     │   │
│  │    Your items:     £156.00              │   │
│  │    + 10% bonus:    + £15.60             │   │
│  │    ═══════════════════════════          │   │
│  │    YOU GET:        £171.60              │   │
│  │    [● Selected]                         │   │
│  └─────────────────────────────────────────┘   │
│                                                 │
│  ┌─────────────────────────────────────────┐   │
│  │ ○ BANK TRANSFER                         │   │
│  │    Direct to your bank account          │   │
│  │    Processing: 3-5 business days        │   │
│  │    ────────────────────────────────     │   │
│  │    YOU GET:        £156.00              │   │
│  └─────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘
```

### 3.3 Review Page

**Critical for trust and reducing errors**

```
┌─────────────────────────────────────────────────┐
│  Review Your Trade-In                           │
│                                                 │
│  [Item List - Editable]                         │
│  ┌─────────────────────────────────────────┐   │
│  │ [IMG] Luffy (119) - Parallel            │   │
│  │       NM x1         £678.00    [✎][×]  │   │
│  ├─────────────────────────────────────────┤   │
│  │ [IMG] Zoro - SP                         │   │
│  │       LP x2         £1,045.34  [✎][×]  │   │
│  └─────────────────────────────────────────┘   │
│                                                 │
│  ─────────────────────────────────────────────  │
│  Subtotal (3 cards):              £1,723.34    │
│  Payout: Store Credit (+10%):     + £172.34    │
│  ═════════════════════════════════════════════  │
│  ESTIMATED PAYOUT:                £1,895.67    │
│  ─────────────────────────────────────────────  │
│                                                 │
│  ⚠️ Important Notes:                            │
│  • Prices are estimates based on NM condition   │
│  • Final value determined after grading         │
│  • You'll be notified if adjustments are needed │
│                                                 │
│  ☑️ I agree to the trade-in terms               │
│                                                 │
│  [Submit Trade-In Request]                      │
└─────────────────────────────────────────────────┘
```

---

## Phase 4: Post-Submission Flow

### 4.1 Confirmation Page

**Immediate feedback after submission**

```
┌─────────────────────────────────────────────────┐
│  ✓ Trade-In Submitted!                          │
│                                                 │
│  ┌─────────────────────────────────────────┐   │
│  │  Your Reference Number                   │   │
│  │  TI-2024-001234                          │   │
│  │  [Copy]                                  │   │
│  └─────────────────────────────────────────┘   │
│                                                 │
│  📧 Confirmation sent to: alex@email.com        │
│                                                 │
│  ─────────────────────────────────────────────  │
│  WHAT'S NEXT?                                   │
│  ─────────────────────────────────────────────  │
│                                                 │
│  1️⃣ Pack Your Cards                             │
│     Use penny sleeves and toploaders            │
│     Include your packing slip                   │
│                                                 │
│  2️⃣ Ship to Us                                  │
│     [Download Packing Slip]                     │
│     [View Shipping Instructions]                │
│     OR                                          │
│     [Get Free Shipping Label] (£50+ orders)     │
│                                                 │
│  3️⃣ We Grade & Pay                              │
│     Grading: 2-3 business days after receipt    │
│     Payment: Same day after approval            │
│                                                 │
│  ─────────────────────────────────────────────  │
│  [Track Your Submission]  [Start New Trade-In]  │
└─────────────────────────────────────────────────┘
```

### 4.2 Shipping Instructions Page

**Clear, printable shipping guide**

```
┌─────────────────────────────────────────────────┐
│  Shipping Your Cards                            │
│  Reference: TI-2024-001234                      │
│                                                 │
│  ┌─────────────────────────────────────────┐   │
│  │  📦 PACKING CHECKLIST                    │   │
│  │                                          │   │
│  │  ☐ Each card in a penny sleeve           │   │
│  │  ☐ Valuable cards (£50+) in toploaders   │   │
│  │  ☐ Cards secured to prevent movement     │   │
│  │  ☐ Packing slip included                 │   │
│  │  ☐ Sealed with tape                      │   │
│  └─────────────────────────────────────────┘   │
│                                                 │
│  📍 SEND TO:                                    │
│  ┌─────────────────────────────────────────┐   │
│  │  CardForum Trade-Ins                     │   │
│  │  123 Trading Card Lane                   │   │
│  │  Cambridge, CB1 2AB                      │   │
│  │  United Kingdom                          │   │
│  └─────────────────────────────────────────┘   │
│                                                 │
│  [Print Packing Slip]  [Print Address Label]    │
│                                                 │
│  ─────────────────────────────────────────────  │
│  💡 TIPS                                        │
│  • Use tracked shipping for peace of mind       │
│  • Take photos of cards before sending          │
│  • Keep your tracking number                    │
│                                                 │
│  [Update Tracking Number]                       │
└─────────────────────────────────────────────────┘
```

### 4.3 Packing Slip (Printable)

```
┌─────────────────────────────────────────────────┐
│  CARDFORUM TRADE-IN PACKING SLIP                │
│  ═══════════════════════════════════════════    │
│                                                 │
│  Reference: TI-2024-001234                      │
│  Date: December 8, 2024                         │
│  Customer: alex@email.com                       │
│                                                 │
│  ─────────────────────────────────────────────  │
│  ITEMS INCLUDED                                 │
│  ─────────────────────────────────────────────  │
│  □ Monkey D. Luffy (119) Parallel - NM x1      │
│  □ Roronoa Zoro SP - LP x2                     │
│  □ Shanks Manga - NM x1                        │
│  ─────────────────────────────────────────────  │
│  Total Cards: 4                                 │
│  Estimated Value: £1,895.67 (Store Credit)      │
│                                                 │
│  ─────────────────────────────────────────────  │
│  ⚠️ IMPORTANT                                   │
│  This slip must be included with your package   │
│  ─────────────────────────────────────────────  │
│                                                 │
│  [BARCODE: TI-2024-001234]                      │
└─────────────────────────────────────────────────┘
```

---

## Phase 5: Tracking & Status Updates

### 5.1 Tracking Page (Enhanced)

**URL**: `/apps/trade-in/track?number=TI-2024-001234`

```
┌─────────────────────────────────────────────────┐
│  Track Your Trade-In                            │
│                                                 │
│  [TI-2024-001234        ] [Track]               │
│                                                 │
│  ═══════════════════════════════════════════    │
│  TI-2024-001234                    IN TRANSIT   │
│  ═══════════════════════════════════════════    │
│                                                 │
│  [Timeline]                                     │
│  ●──────────────────────────────────────────    │
│  │                                              │
│  ├─● Submitted           Dec 8, 10:30 AM       │
│  │   Trade-in request received                  │
│  │                                              │
│  ├─● In Transit          Dec 8, 2:15 PM        │
│  │   Tracking: RM123456789GB                    │
│  │   [Track with Royal Mail →]                  │
│  │                                              │
│  ├─○ Received            Pending                │
│  │   We'll inspect your package                 │
│  │                                              │
│  ├─○ Grading             Pending                │
│  │   Each card verified for condition           │
│  │                                              │
│  ├─○ Review              Pending                │
│  │   Final totals calculated                    │
│  │                                              │
│  └─○ Complete            Pending                │
│      Payment processed                          │
│                                                 │
│  ─────────────────────────────────────────────  │
│  📦 YOUR ITEMS                                  │
│  ─────────────────────────────────────────────  │
│  Monkey D. Luffy (119) - NM    £678.00 Pending │
│  Roronoa Zoro SP - LP x2       £1,045.34 Pending│
│  ─────────────────────────────────────────────  │
│  Estimated Total:              £1,895.67        │
│                                                 │
│  [Contact Support]                              │
└─────────────────────────────────────────────────┘
```

### 5.2 Grading Results View

**Shown after grading is complete**

```
┌─────────────────────────────────────────────────┐
│  Grading Complete                               │
│  TI-2024-001234                                 │
│                                                 │
│  ─────────────────────────────────────────────  │
│  GRADING RESULTS                                │
│  ─────────────────────────────────────────────  │
│                                                 │
│  ✓ Monkey D. Luffy (119) Parallel              │
│    Claimed: NM → Verified: NM                   │
│    Price: £678.00 ✓                             │
│                                                 │
│  ⚠️ Roronoa Zoro SP (x2)                        │
│    Claimed: LP → Adjusted: MP                   │
│    Reason: Edge whitening on back               │
│    Original: £522.67 → Adjusted: £380.00 each   │
│    [View Photos]                                │
│                                                 │
│  ─────────────────────────────────────────────  │
│  SUMMARY                                        │
│  ─────────────────────────────────────────────  │
│  Originally Quoted:           £1,723.34         │
│  Adjusted Total:              £1,438.00         │
│  Store Credit Bonus (+10%):   + £143.80         │
│  ═══════════════════════════════════════════    │
│  FINAL PAYOUT:                £1,581.80         │
│                                                 │
│  [Accept & Get Paid]  [Request Return]          │
│                                                 │
│  ℹ️ If you don't respond within 7 days,         │
│     we'll process at the adjusted price.        │
└─────────────────────────────────────────────────┘
```

---

## Phase 6: Email Notifications

### 6.1 Email Templates Needed

| Email | Trigger | Content |
|-------|---------|---------|
| Submission Confirmation | After submit | Reference #, items, shipping instructions |
| Received Confirmation | Package scanned | Items being processed |
| Grading Complete | After grading | Results, any adjustments, accept/reject |
| Payment Sent | After approval | Gift card code or bank reference |
| Return Shipped | If rejected/returned | Tracking number |

### 6.2 Sample Email: Submission Confirmation

```
Subject: Trade-In Received - TI-2024-001234

Hi Alex,

Thanks for your trade-in submission!

REFERENCE NUMBER: TI-2024-001234

ITEMS (4 cards):
• Monkey D. Luffy (119) Parallel - NM x1
• Roronoa Zoro SP - LP x2
• Shanks Manga - NM x1

ESTIMATED VALUE: £1,895.67 (Store Credit)

NEXT STEPS:
1. Pack your cards safely
2. Include your packing slip
3. Ship to our address

[Download Packing Slip]
[View Shipping Instructions]

Questions? Reply to this email.

CardForum Trade-Ins
```

---

## Technical Implementation Plan

### New Routes Needed

| Route | Purpose |
|-------|---------|
| `/apps/trade-in/` | Redirect to trade-in page |
| `/apps/trade-in/track` | Submission tracking |
| `/apps/trade-in/track/:number` | Specific submission tracking |
| `/apps/trade-in/shipping/:id` | Shipping instructions |
| `/apps/trade-in/packing-slip/:id` | Printable packing slip |
| `/apps/trade-in/label/:id` | Shipping label (if free shipping) |

### New API Endpoints Needed

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `GET /api/cards/price/:cardId` | GET | Single card price lookup |
| `GET /api/cards/sets` | GET | List all sets with card counts |
| `POST /api/submissions/:id/tracking` | POST | Update tracking number |
| `POST /api/submissions/:id/accept` | POST | Accept grading results |
| `POST /api/submissions/:id/reject` | POST | Request return |

### New Theme Blocks Needed

| Block | Purpose |
|-------|---------|
| `trade-in-hero.liquid` | Landing page hero |
| `trade-in-steps.liquid` | How it works steps |
| `trade-in-price-checker.liquid` | Quick price check widget |
| `trade-in-faq.liquid` | FAQ accordion |

### JavaScript Enhancements

1. **localStorage Cart Persistence**
   - Save cart on every change
   - Restore on page load
   - Clear on successful submission

2. **Quick-Add Feature**
   - Single click adds as NM
   - Shows brief toast notification

3. **Enhanced Search**
   - Search by card number (e.g., "OP05-119")
   - Recent searches history
   - Popular cards suggestions

4. **Mobile Optimizations**
   - Swipe to remove cart items
   - Bottom sheet for condition modal
   - Sticky cart summary

---

## Implementation Priority

### MVP (Phase 1) - 1-2 weeks
1. ✅ Existing trade-in form (already done)
2. ✅ Card search and browse (already done)
3. ⬜ localStorage cart persistence
4. ⬜ Enhanced confirmation page with shipping instructions
5. ⬜ Packing slip generation
6. ⬜ Basic tracking page

### Enhanced (Phase 2) - 2-3 weeks
1. ⬜ Quick-add feature (single click NM)
2. ⬜ Set gallery browse view
3. ⬜ Enhanced filtering (release, price range, variant)
4. ⬜ Email notifications (all templates)
5. ⬜ Tracking number input

### Polish (Phase 3) - 1-2 weeks
1. ⬜ Landing page blocks (hero, steps, FAQ)
2. ⬜ Mobile optimizations
3. ⬜ Saved cart recovery prompts
4. ⬜ Grading results acceptance flow
5. ⬜ Return request flow

---

## Success Metrics

| Metric | Target | How to Measure |
|--------|--------|----------------|
| Submission Conversion | >50% of started carts | Analytics |
| Time to Submit | <5 minutes | Session timing |
| Cart Abandonment | <30% | localStorage analysis |
| Mobile Completion | >40% of submissions | Device tracking |
| Return Rate | <5% | Business metrics |
| Customer Satisfaction | >4.5/5 | Post-submission survey |

---

## Open Questions for User

1. **Free Shipping Threshold**: Currently £50 - is this correct?
2. **Grading Turnaround**: What's the target? (suggested 2-3 business days)
3. **Minimum Submission**: Currently £5 - should this change?
4. **Payment Timeline**: Same-day after approval?
5. **Return Shipping**: Who pays for returns if customer rejects grading?
6. **Photo Evidence**: Should we show photos of adjusted cards?
