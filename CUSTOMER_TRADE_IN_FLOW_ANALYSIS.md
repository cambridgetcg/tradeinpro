# Customer-Facing Trade-In Flow: Implementation Analysis & Customer Account UI Integration

> **Document Purpose**: Analysis of current implementation progress and strategic planning for Shopify Customer Account UI Extension integration.
> **Date**: December 29, 2025

---

## Table of Contents
1. [Current Implementation Status](#current-implementation-status)
2. [Technical Architecture Overview](#technical-architecture-overview)
3. [Customer-Facing Components Analysis](#customer-facing-components-analysis)
4. [Shopify Customer Account UI Extensions](#shopify-customer-account-ui-extensions)
5. [Integration Strategy & Recommendations](#integration-strategy--recommendations)
6. [Implementation Roadmap](#implementation-roadmap)

---

## Current Implementation Status

### Overall Progress: 95% Complete

The trade-in system is **production-ready** with comprehensive functionality across all major areas.

| Phase | Status | Test Coverage | Description |
|-------|--------|---------------|-------------|
| Phase 1 | ✅ Complete | Core tests | Constants, Pricing Engine, Workflow State Machine, Dashboard, Queue, Grading Interface |
| Phase 2 | ✅ Complete | 241 tests | Settings Management, Price Management, Payout Processing |
| Phase 3 | ✅ Complete | 351 tests | Customer Submissions Library, Card Search, Shipping Library |
| Phase 4 | ✅ Complete | 460 tests | App Proxy Auth, Customer-Facing APIs, Email Notifications, Webhooks, GDPR Compliance |
| Phase 5 | ✅ Complete | 564 tests | Bulk Operations, Email Providers, Rate Limiting, Reports, Theme App Extension |

### Feature Completion Matrix

| Feature | Backend | Frontend | API | Tests | Notes |
|---------|---------|----------|-----|-------|-------|
| Card Search & Browse | ✅ | ✅ | ✅ | ✅ | Full-text search with pagination |
| Cart Management | ✅ | ✅ | ✅ | ✅ | LocalStorage with 72hr expiry |
| Condition Selection | ✅ | ✅ | ✅ | ✅ | Modal with pricing preview |
| Submission Creation | ✅ | ✅ | ✅ | ✅ | Guest & logged-in support |
| Contact Details | ✅ | ✅ | ✅ | ✅ | Phone + WhatsApp/Telegram/Signal |
| Payout Selection | ✅ | ✅ | ✅ | ✅ | Store Credit (+10%) or Bank Transfer |
| Shipping Labels | ✅ | ✅ | ✅ | ✅ | Royal Mail integration ready |
| Public Tracking | ✅ | ✅ | ✅ | ✅ | By submission number |
| Customer Account View | ✅ | ⚠️ Partial | ✅ | ✅ | API complete, theme integration partial |
| Accept/Reject Grading | ✅ | ⚠️ Partial | ✅ | ✅ | API complete, UI needs work |
| Email Notifications | ✅ | N/A | N/A | ✅ | Resend/SendGrid/Console fallback |

### What's Working End-to-End

```
✅ Customer visits store → Sees trade-in form block
✅ Search/Browse cards → Select condition + quantity → Add to cart
✅ Enter contact details → Choose payout method
✅ Submit trade-in → Receive confirmation email
✅ Download packing slip → Get shipping instructions
✅ Track submission by number (public)
✅ Admin receives, grades, processes
✅ Payout issued (gift card or bank)
```

### Gaps Identified

| Gap | Impact | Priority | Notes |
|-----|--------|----------|-------|
| Customer Account Page (Theme) | Medium | High | my-submissions.liquid exists but incomplete |
| Accept/Reject UI (Theme) | Medium | High | API endpoints work, UI needs implementation |
| Customer Account UI Extension | High | **Critical** | Native Shopify integration - better UX |
| Shopify Cart Integration | Low | Low | Trade-ins are separate flow by design |

---

## Technical Architecture Overview

### System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              SHOPIFY STOREFRONT                                  │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ┌─────────────────────┐    ┌─────────────────────┐    ┌─────────────────────┐  │
│  │  Theme App Extension│    │  Customer Account   │    │  App Proxy          │  │
│  │  (Liquid Blocks)    │    │  UI Extension       │    │  /apps/trade-in/*   │  │
│  │                     │    │  (React/Preact)     │    │                     │  │
│  │  • trade-in-form    │    │  • Full page ext    │    │  • Signature valid  │  │
│  │  • trade-in-tracker │    │  • Profile block    │    │  • Customer context │  │
│  │  • my-submissions   │    │  • Order status     │    │  • API routing      │  │
│  └──────────┬──────────┘    └──────────┬──────────┘    └──────────┬──────────┘  │
│             │                          │                          │              │
└─────────────┼──────────────────────────┼──────────────────────────┼──────────────┘
              │                          │                          │
              │              ┌───────────┴───────────┐              │
              │              │                       │              │
              ▼              ▼                       ▼              ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              CARDFORUM APP                                       │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ┌─────────────────────┐    ┌─────────────────────┐    ┌─────────────────────┐  │
│  │  API Routes         │    │  Business Logic     │    │  Admin UI           │  │
│  │                     │    │                     │    │  (Polaris)          │  │
│  │  api.submissions    │    │  submissions.server │    │                     │  │
│  │  api.cards.search   │    │  pricing.server     │    │  Dashboard          │  │
│  │  api.track          │    │  workflow.server    │    │  Trade-in Queue     │  │
│  │  api.my-submissions │    │  payouts.server     │    │  Grading Interface  │  │
│  │  api.shipping.*     │    │  shipping.server    │    │  Reports            │  │
│  └──────────┬──────────┘    └──────────┬──────────┘    └─────────────────────┘  │
│             │                          │                                         │
│             └──────────────────────────┼─────────────────────────────────────────┤
│                                        │                                         │
│  ┌─────────────────────────────────────┴──────────────────────────────────────┐ │
│  │                           PRISMA ORM                                        │ │
│  └─────────────────────────────────────┬──────────────────────────────────────┘ │
│                                        │                                         │
└────────────────────────────────────────┼─────────────────────────────────────────┘
                                         │
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           AWS RDS (PostgreSQL)                                   │
├─────────────────────────────────────────────────────────────────────────────────┤
│  Customer │ TradeInSubmission │ TradeInItem │ CardPrice │ CardPriceV2 │ Payout  │
└─────────────────────────────────────────────────────────────────────────────────┘
                                         ▲
                                         │
┌─────────────────────────────────────────────────────────────────────────────────┐
│                        TRADING-CARD-PRICER (Lambda)                              │
│                  Fetches prices from OPTCG/Limitless/JustTCG                     │
│                        Writes to card_prices_v2 table                            │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Database Models Summary

**Customer Linking:**
```
Customer
├── id (CUID)
├── shopifyCustomerId (nullable) ← Links to Shopify
├── email
└── submissions[]

Linking Logic:
1. Logged-in customer → Use shopifyCustomerId
2. Guest with existing email → Link via email
3. New guest → Create Customer without Shopify ID
4. Customer later creates account → Webhook merges via email
```

**Submission Flow:**
```
DRAFT → SUBMITTED → IN_TRANSIT → RECEIVED → GRADING → PENDING_APPROVAL → APPROVED → COMPLETED
                                                                       ↘ RETURNED
         ↘ CANCELLED (from most states)
```

---

## Customer-Facing Components Analysis

### Theme App Extension (`extensions/trade-in-blocks/`)

**Current Blocks:**

| Block | File | Status | Description |
|-------|------|--------|-------------|
| Trade-In Form | `trade-in-form.liquid` | ✅ Complete | Full submission form with cart |
| Tracker | `trade-in-tracker.liquid` | ✅ Complete | Public lookup by number |
| CTA | `trade-in-cta.liquid` | ✅ Complete | Marketing call-to-action |
| My Submissions | `my-submissions.liquid` | ⚠️ Partial | Customer account view |

**JavaScript Assets:**

| File | LOC | Status | Purpose |
|------|-----|--------|---------|
| `trade-in.js` | ~400 | ✅ Complete | Cart, search, submission logic |
| `trade-in-account.js` | ~150 | ⚠️ Partial | Account page interactions |
| `trade-in.css` | ~600 | ✅ Complete | Full responsive styling |

### API Endpoints (Customer-Facing)

All routes served via App Proxy at `/apps/trade-in/`:

| Endpoint | Method | Auth | Status | Purpose |
|----------|--------|------|--------|---------|
| `/cards/search` | GET | None | ✅ | Autocomplete search |
| `/cards/browse` | GET | None | ✅ | Paginated card catalog |
| `/cards/games` | GET | None | ✅ | Available games list |
| `/cards/languages` | GET | None | ✅ | Available languages |
| `/submissions` | POST | None | ✅ | Create submission |
| `/submissions` | GET | Customer | ✅ | List customer's submissions |
| `/submissions/:id` | GET | Customer | ✅ | Submission detail |
| `/submissions/:id` | PUT | Customer | ✅ | Submit for processing |
| `/submissions/:id/confirm` | POST | Customer | ✅ | Accept grading offer |
| `/submissions/:id/reject` | POST | Customer | ✅ | Reject and request return |
| `/track` | GET | None | ✅ | Public tracking |
| `/my-submissions/:number` | GET | Customer | ✅ | Customer detail view |
| `/packing-slip/:number` | GET | Customer | ✅ | Packing slip HTML |
| `/shipping-instructions/:number` | GET | Customer | ✅ | Self-ship instructions |
| `/settings` | GET | None | ✅ | Public settings |

### Existing Customer Account Integration Plan

A detailed plan exists in `CUSTOMER_ACCOUNT_INTEGRATION_PLAN.md` covering:

- ✅ API endpoints (implemented)
- ⚠️ Theme blocks (partially implemented)
- ⚠️ JavaScript enhancements (partially implemented)
- ✅ Customer linking logic (implemented)
- ⚠️ Accept/reject UI (needs completion)

---

## Shopify Customer Account UI Extensions

### Overview

Customer Account UI Extensions are a newer Shopify technology (distinct from Theme App Extensions) that allow developers to build **native integrations directly within the Shopify customer account pages**.

### Key Differences from Theme App Extension

| Aspect | Theme App Extension | Customer Account UI Extension |
|--------|--------------------|-----------------------------|
| Technology | Liquid + Vanilla JS | React/Preact + Shopify Components |
| Location | Theme blocks on pages | Native account pages |
| Styling | Custom CSS | Inherits merchant branding |
| Auth | App Proxy signature | Built-in customer context |
| User Experience | Feels like third-party | Feels native to Shopify |
| Maintenance | Theme-dependent | Shopify-managed |

### Available Extension Targets (2025-07)

**Full-Page Extensions:**
| Target | Location | Use Case |
|--------|----------|----------|
| `customer-account.page.render` | New custom pages | **Trade-in submission history** |
| `customer-account.order.page.render` | Order-specific pages | N/A for trade-ins |

**Profile Page:**
| Target | Location | Use Case |
|--------|----------|----------|
| `customer-account.profile.block.render` | Profile page | **Trade-in summary stats** |
| `customer-account.profile.addresses.render-after` | After addresses | N/A |

**Order Index:**
| Target | Location | Use Case |
|--------|----------|----------|
| `customer-account.order-index.block.render` | Orders list | Could link to trade-ins |

**Footer (All Pages):**
| Target | Location | Use Case |
|--------|----------|----------|
| `customer-account.footer.render-after` | Below footer | **Trade-in CTA banner** |

### Technology Stack (2025-10)

As of API version 2025-10, Shopify recommends:
- **Preact** instead of React (smaller bundle, better performance)
- **Polaris Web Components** for UI
- **Global `shopify` object** for API access

```javascript
// Modern approach (2025-10)
import { Page, BlockStack, Card, Text, Button } from '@shopify/ui-extensions-react/customer-account';

function TradeInPage() {
  const { query } = shopify.customerAccount;

  // GraphQL queries for customer data
  const submissions = await query(SUBMISSIONS_QUERY);

  return (
    <Page title="My Trade-Ins">
      <BlockStack>
        {submissions.map(sub => (
          <SubmissionCard key={sub.id} submission={sub} />
        ))}
      </BlockStack>
    </Page>
  );
}
```

### Available Components

Customer Account UI extensions can use:

**Layout:**
- `Page`, `BlockStack`, `InlineStack`, `Grid`, `Divider`

**Content:**
- `Text`, `Heading`, `Badge`, `Image`, `Banner`

**Interactive:**
- `Button`, `Link`, `Pressable`

**Data Display:**
- `Card`, `List`, `ResourceItem`

**Forms (limited):**
- Basic input support for actions

### Backend Communication

Extensions communicate with app backend via:

1. **Direct Fetch** to app proxy endpoints
2. **GraphQL** via `shopify:customer-account/api/unstable/graphql.json`
3. **Metafields** for lightweight data storage

---

## Integration Strategy & Recommendations

### Recommended Approach: Hybrid Model

Leverage **both** Theme App Extension and Customer Account UI Extension for optimal coverage:

```
┌─────────────────────────────────────────────────────────────────────┐
│                        CUSTOMER JOURNEY                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  STOREFRONT (Theme App Extension)                              │  │
│  │  ────────────────────────────────────────────────────────────  │  │
│  │                                                                │  │
│  │  /pages/trade-in                                               │  │
│  │  └─ trade-in-form.liquid  ← Full submission flow               │  │
│  │                                                                │  │
│  │  /pages/track-trade-in                                         │  │
│  │  └─ trade-in-tracker.liquid  ← Public tracking (no login)     │  │
│  │                                                                │  │
│  │  Homepage / Product Pages                                      │  │
│  │  └─ trade-in-cta.liquid  ← Marketing banners                  │  │
│  │                                                                │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                              │                                       │
│                              ▼                                       │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  CUSTOMER ACCOUNT (UI Extension) ⭐ NEW                        │  │
│  │  ────────────────────────────────────────────────────────────  │  │
│  │                                                                │  │
│  │  customer-account.page.render                                  │  │
│  │  └─ /trade-ins  ← Full submission history & management        │  │
│  │     • List all submissions                                     │  │
│  │     • View details + timeline                                  │  │
│  │     • Accept/reject grading offers                             │  │
│  │     • Download packing slips                                   │  │
│  │                                                                │  │
│  │  customer-account.profile.block.render                         │  │
│  │  └─ Profile page widget                                        │  │
│  │     • Summary stats (total submitted, earned)                  │  │
│  │     • Quick link to trade-ins page                            │  │
│  │                                                                │  │
│  │  customer-account.footer.render-after                          │  │
│  │  └─ Footer CTA                                                 │  │
│  │     • "Have cards to trade?" banner                           │  │
│  │     • Links to trade-in form                                   │  │
│  │                                                                │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### Why Customer Account UI Extension is Critical

1. **Native Experience**: Submissions appear alongside orders, profiles, addresses - feels integrated
2. **Better UX**: No redirecting to external pages, all within account
3. **Customer Expectations**: Users expect account-related features in their account
4. **Trust**: Native Shopify UI builds confidence vs. third-party looking pages
5. **Maintenance**: Less theme-dependent, survives theme changes
6. **Mobile**: Optimized for Shopify's mobile account experience

### Technical Integration Design

#### Extension Structure

```
extensions/
├── trade-in-blocks/           # Existing Theme App Extension
│   ├── blocks/
│   │   ├── trade-in-form.liquid
│   │   ├── trade-in-tracker.liquid
│   │   └── trade-in-cta.liquid
│   └── assets/
│       ├── trade-in.js
│       └── trade-in.css
│
└── trade-in-account/          # NEW: Customer Account UI Extension
    ├── src/
    │   ├── TradeInPage.tsx          # Full page extension
    │   ├── ProfileWidget.tsx        # Profile block
    │   ├── FooterCTA.tsx            # Footer banner
    │   ├── components/
    │   │   ├── SubmissionList.tsx
    │   │   ├── SubmissionCard.tsx
    │   │   ├── SubmissionDetail.tsx
    │   │   ├── GradingReview.tsx
    │   │   ├── Timeline.tsx
    │   │   └── StatsWidget.tsx
    │   └── api/
    │       └── client.ts            # API client for app proxy
    └── shopify.extension.toml
```

#### Extension Configuration

```toml
# extensions/trade-in-account/shopify.extension.toml
api_version = "2025-07"
type = "customer_account_ui"

[[extensions]]
name = "Trade-In History"
handle = "trade-in-page"

  [[extensions.targeting]]
  target = "customer-account.page.render"
  module = "./src/TradeInPage.tsx"

[[extensions]]
name = "Trade-In Profile Widget"
handle = "trade-in-profile"

  [[extensions.targeting]]
  target = "customer-account.profile.block.render"
  module = "./src/ProfileWidget.tsx"

[[extensions]]
name = "Trade-In CTA"
handle = "trade-in-footer"

  [[extensions.targeting]]
  target = "customer-account.footer.render-after"
  module = "./src/FooterCTA.tsx"
```

#### API Communication

The extension will communicate with existing API endpoints via App Proxy:

```typescript
// extensions/trade-in-account/src/api/client.ts
const API_BASE = '/apps/trade-in';

export async function fetchSubmissions() {
  const response = await fetch(`${API_BASE}/submissions`);
  return response.json();
}

export async function getSubmissionDetail(number: string) {
  const response = await fetch(`${API_BASE}/my-submissions/${number}`);
  return response.json();
}

export async function confirmGrading(id: string) {
  const response = await fetch(`${API_BASE}/submissions/${id}/confirm`, {
    method: 'POST',
  });
  return response.json();
}

export async function rejectGrading(id: string, reason?: string) {
  const response = await fetch(`${API_BASE}/submissions/${id}/reject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason }),
  });
  return response.json();
}
```

### Feature Specification

#### 1. Trade-In History Page (`customer-account.page.render`)

**Navigation:** Account sidebar → "Trade-Ins" menu item

**UI Sections:**

```
┌─────────────────────────────────────────────────────────────────────┐
│  Trade-Ins                                         [Start New] ↗    │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Stats Bar                                                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐            │
│  │    5     │  │    1     │  │    4     │  │ £1,247   │            │
│  │  Total   │  │ Active   │  │ Complete │  │  Earned  │            │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘            │
│                                                                      │
│  Filter Tabs: [All] [Active] [Completed] [Needs Action]             │
│                                                                      │
│  Submission List                                                    │
│  ─────────────────────────────────────────────────────────────────  │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │ ⚠️  TRD-202512-00008              PENDING APPROVAL            │  │
│  │    5 cards • £245.50 quoted → £198.20 final                   │  │
│  │    Grading complete - please review                           │  │
│  │    [Review & Accept]                                          │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │    TRD-202512-00005                    IN TRANSIT             │  │
│  │    3 cards • £413.80 • Store Credit                          │  │
│  │    Shipped Dec 15 • Expected Dec 18-20                        │  │
│  │    [View Details]                                             │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │ ✓  TRD-202511-00012                    COMPLETED              │  │
│  │    8 cards • £567.90 • Store Credit                          │  │
│  │    Completed Nov 28 • Gift card issued                        │  │
│  │    [View Details]                                             │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

**Detail View (expanded/modal):**

```
┌─────────────────────────────────────────────────────────────────────┐
│  ← Back                                    TRD-202512-00008         │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Status: PENDING APPROVAL                        Dec 18, 2025       │
│                                                                      │
│  Timeline                                                           │
│  ● Submitted ─── ● In Transit ─── ● Received ─── ● Graded ─── ○    │
│    Dec 10          Dec 12           Dec 15         Dec 18           │
│                                                                      │
│  ─────────────────────────────────────────────────────────────────  │
│                                                                      │
│  Items (5)                                                          │
│                                                                      │
│  ┌─────┐  Portgas D. Ace (Manga)            Adjusted ⚠️            │
│  │ IMG │  OP02-013 • NM claimed → LP actual                         │
│  └─────┘  £125.00 → £97.50  •  "Light surface scratches"           │
│                                                                      │
│  ┌─────┐  Roronoa Zoro (SP)                 Verified ✓             │
│  │ IMG │  OP01-025 • NM                                            │
│  └─────┘  £89.00                                                    │
│                                                                      │
│  ... 3 more items                                                   │
│                                                                      │
│  ─────────────────────────────────────────────────────────────────  │
│                                                                      │
│  Summary                                                            │
│  Original Quote:    £245.50                                         │
│  Grading Adjustment: -£47.30                                        │
│  Final Offer:       £198.20                                         │
│  Store Credit (+10%): £218.02                                       │
│                                                                      │
│  ┌─────────────────────────┐  ┌─────────────────────────┐          │
│  │  ✓ Accept Offer         │  │  Request Return         │          │
│  │  Get £218.02 credit     │  │  Cards shipped back     │          │
│  └─────────────────────────┘  └─────────────────────────┘          │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

#### 2. Profile Widget (`customer-account.profile.block.render`)

**Location:** Customer profile page, below contact information

```
┌─────────────────────────────────────────────────────────────────────┐
│  Trade-In Activity                                                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────────────┐  ┌──────────────────┐                        │
│  │  5 trade-ins     │  │  £1,247 earned   │                        │
│  │  1 in progress   │  │  lifetime        │                        │
│  └──────────────────┘  └──────────────────┘                        │
│                                                                      │
│  [View All Trade-Ins →]                                             │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

#### 3. Footer CTA (`customer-account.footer.render-after`)

**Location:** Bottom of all customer account pages

```
┌─────────────────────────────────────────────────────────────────────┐
│  💳  Have trading cards to sell?                                    │
│                                                                      │
│  Get up to 70% of market value + 10% bonus when you choose          │
│  store credit. Fast payments, free shipping on orders over £50.     │
│                                                                      │
│  [Start a Trade-In →]                                               │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Implementation Roadmap

### Phase 1: Extension Scaffolding (Foundation)

**Tasks:**
1. Create `extensions/trade-in-account/` directory structure
2. Configure `shopify.extension.toml` with all three targets
3. Set up build tooling (Vite/esbuild for Preact)
4. Create API client module connecting to existing endpoints
5. Test basic extension loading in development store

**Deliverables:**
- [ ] Extension scaffold with empty components
- [ ] Build configuration
- [ ] API client with type definitions
- [ ] Development testing workflow

### Phase 2: Trade-In History Page

**Tasks:**
1. Implement `TradeInPage.tsx` main component
2. Build `SubmissionList` with filtering/pagination
3. Create `SubmissionCard` component with status badges
4. Add stats bar with aggregated metrics
5. Implement navigation to storefront trade-in form

**Deliverables:**
- [ ] Full page extension showing submission list
- [ ] Filter tabs (All/Active/Completed/Needs Action)
- [ ] Stats summary widget
- [ ] "Start New" link to storefront

### Phase 3: Submission Detail & Actions

**Tasks:**
1. Build `SubmissionDetail` component
2. Create `Timeline` visualization
3. Implement item list with grading status
4. Build `GradingReview` accept/reject UI
5. Add packing slip and shipping instruction downloads

**Deliverables:**
- [ ] Detail view (modal or inline expansion)
- [ ] Visual timeline component
- [ ] Accept/reject grading workflow
- [ ] Document download links

### Phase 4: Profile Widget & Footer CTA

**Tasks:**
1. Implement `ProfileWidget` with stats
2. Build `FooterCTA` banner
3. Configure menu item in customer account navigation
4. Add deep links between components

**Deliverables:**
- [ ] Profile widget on profile page
- [ ] Footer CTA on all account pages
- [ ] Account menu integration
- [ ] Cross-component navigation

### Phase 5: Polish & Launch

**Tasks:**
1. Mobile responsiveness testing
2. Error handling and loading states
3. Empty states and onboarding
4. Performance optimization
5. Accessibility audit
6. Production deployment

**Deliverables:**
- [ ] Mobile-optimized UI
- [ ] Comprehensive error handling
- [ ] Loading skeletons
- [ ] Empty state with CTA
- [ ] Production release

---

## Appendix: Technical Considerations

### Authentication

Customer Account UI extensions automatically have access to customer context:

```typescript
// The customer is automatically authenticated in UI extensions
// No need to pass tokens - App Proxy handles it
const { customer } = shopify.customerAccount;
```

### API Changes Needed

The existing API endpoints should work, but consider:

1. **CORS Headers**: Ensure App Proxy responses include appropriate headers
2. **Response Format**: Standardize response structure for UI extension consumption
3. **Error Codes**: Consistent error response format for UI handling

### State Management

For the extension:
- Use React state for UI state
- Fetch data on mount with loading states
- Consider SWR-style caching for repeated visits
- Optimistic updates for actions (accept/reject)

### Testing Strategy

1. **Unit Tests**: Component logic
2. **Integration Tests**: API communication
3. **E2E Tests**: Full user flows in development store
4. **Visual Regression**: UI consistency

---

## References

- [Shopify Customer Account UI Extensions Documentation](https://shopify.dev/docs/api/customer-account-ui-extensions/2025-07)
- [Extension Targets Reference](https://shopify.dev/docs/api/customer-account-ui-extensions/2025-04/targets)
- [Shopify UI Extensions GitHub](https://github.com/Shopify/ui-extensions)
- [Upgrading to 2025-10](https://shopify.dev/docs/api/customer-account-ui-extensions/latest/upgrading-to-2025-10)
- [Building with Shopify Customer Account Extensions (Gadget)](https://gadget.dev/blog/building-with-shopify-customer-account-extensions)

---

*Document generated December 29, 2025*
