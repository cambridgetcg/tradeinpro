# CardForum - Project Context

## Overview
Shopify custom app for trading card trade-ins. Built with React Router v7, Polaris, Prisma ORM, and PostgreSQL (AWS RDS).

## Tech Stack
- **Frontend**: React Router v7, Shopify Polaris
- **Backend**: Node.js, Prisma ORM
- **Database**: PostgreSQL on AWS RDS (`cardforum.cn4c2su0o42n.us-east-1.rds.amazonaws.com`)
- **Deployment**: Vercel
- **Testing**: Vitest

## Key Files

### Core Libraries
- `app/lib/constants.ts` - Enums (SubmissionStatus, ItemStatus, Condition, PayoutType), utilities (formatPrice, isConditionWorse)
- `app/lib/pricing.server.ts` - Price calculation engine (calculateCardPrice, calculateSubmissionTotal, meetsMinimumValue)
- `app/lib/workflow.server.ts` - Status transition state machine (attemptTransition, getValidNextStatuses)
- `app/lib/settings.server.ts` - Settings CRUD operations (getSettings, updateSettings, resetSettings)
- `app/lib/prices.server.ts` - Price data management (searchPrices, getPriceById, syncPrices)
- `app/lib/payouts.server.ts` - Payout processing (createPayout, processGiftCardPayout, processBankPayout)
- `app/lib/submissions.server.ts` - Customer submission management (createSubmission, validateSubmission, searchCards)
- `app/lib/shipping.server.ts` - Shipping labels and instructions (generateShippingLabel, getSelfShipInstructions)
- `app/lib/app-proxy.server.ts` - Shopify App Proxy signature validation (validateAppProxy, requireCustomer)
- `app/lib/notifications.server.ts` - Email notifications (buildSubmissionCreatedEmail, sendEmail)
- `app/lib/bulk-operations.server.ts` - Bulk actions (bulkMarkReceived, bulkStartGrading, bulkApproveSubmissions, bulkCancelSubmissions)
- `app/lib/email-provider.server.ts` - Multi-provider email system (Resend, SendGrid, Console), template rendering
- `app/lib/rate-limit.server.ts` - Rate limiting middleware (RateLimiter, MemoryStore, presets)

### Routes
- `app/routes/app._index.tsx` - Dashboard with stats, alerts, recent activity
- `app/routes/app.trade-ins.tsx` - Queue view with filters, search, pagination
- `app/routes/app.trade-ins.$id.tsx` - Grading interface with condition adjustment
- `app/routes/app.settings.tsx` - App settings configuration
- `app/routes/app.prices.tsx` - Price database browsing and search
- `app/routes/app.payouts.tsx` - Payout queue and processing
- `app/routes/webhooks.tsx` - Shopify webhooks (GDPR compliance, customer sync)
- `app/routes/api.cards.search.tsx` - Card catalog search API
- `app/routes/api.submissions.tsx` - Submissions list/create API
- `app/routes/api.submissions.$id.tsx` - Submission details/submit API
- `app/routes/api.submissions.$id.confirm.tsx` - Confirm grading API
- `app/routes/api.submissions.$id.reject.tsx` - Reject/return API
- `app/routes/api.submissions.$id.items.tsx` - Add/remove items API
- `app/routes/api.shipping.label.$id.tsx` - Shipping label HTML
- `app/routes/api.shipping.instructions.$id.tsx` - Self-ship instructions
- `app/routes/api.shipping.tracking.$id.tsx` - Update tracking API
- `app/routes/app.reports.tsx` - Admin reports with stats, charts, breakdowns
- `app/routes/app.reports.export.tsx` - Data export (CSV/JSON) with field selection

### Theme App Extension
- `extensions/trade-in-blocks/` - Theme app extension for storefront
- `extensions/trade-in-blocks/blocks/trade-in-form.liquid` - Main submission form
- `extensions/trade-in-blocks/blocks/trade-in-tracker.liquid` - Submission status tracker
- `extensions/trade-in-blocks/blocks/trade-in-cta.liquid` - Call-to-action block
- `extensions/trade-in-blocks/assets/trade-in.js` - Client-side cart/search logic
- `extensions/trade-in-blocks/assets/trade-in.css` - Scoped component styles

### Database
- `prisma/schema.prisma` - Full schema with TradeInSubmission, TradeInItem, Customer, Payout, AppSettings, etc.

## Pricing Logic

### Condition Multipliers (of base trade-in price)
- NM (Near Mint): 70%
- LP (Lightly Played): 55%
- MP (Moderately Played): 40%
- HP (Heavily Played): 25%
- DMG (Damaged): 10%

### Payout Options
- **Store Credit**: +10% bonus (default)
- **Bank Transfer**: 100% (or configurable reduction)

### Thresholds
- Minimum submission value: £5 (500p)
- Auto-approve below: £20 (2000p)
- Requires approval above: £50 (5000p)

## Workflow States

### Submission Status Flow
```
DRAFT -> SUBMITTED -> IN_TRANSIT -> RECEIVED -> GRADING -> PENDING_APPROVAL -> APPROVED -> COMPLETED
                                                                           \-> RETURNED
                  \-> CANCELLED (from most states)
```

### Item Status
- PENDING -> VERIFIED (matches quoted price)
- PENDING -> ADJUSTED (condition downgraded, price recalculated)
- PENDING -> REJECTED (not accepted)

## Commands

```bash
# Development
npm run dev

# Testing
npm run test           # Run all tests
npm run test:coverage  # With coverage

# Build
npm run build
npm run typecheck

# Database
npx prisma migrate dev    # Apply migrations
npx prisma studio         # Visual DB browser
```

## Implementation Status

### Phase 1 (COMPLETE)
- [x] Constants and enums
- [x] Pricing engine with tests
- [x] Workflow state machine with tests
- [x] Dashboard with live stats
- [x] Trade-in queue with filters
- [x] Grading interface with bulk actions

### Phase 2 (COMPLETE)
- [x] Settings Management - Configure multipliers, thresholds, notifications
- [x] Price Management - Browse, search, sync from external sources
- [x] Payout Processing - Shopify gift cards, bank transfer tracking
- [x] 241 unit tests passing (settings: 26, prices: 45, payouts: 38, + Phase 1 tests)

### Phase 3 (COMPLETE)
- [x] Customer Submissions Library - createSubmission, validateSubmission, submitSubmission, confirmSubmission, rejectSubmission
- [x] Card Search - searchCards with name/set filters, pagination
- [x] Customer Management - getOrCreateCustomer with Shopify linking
- [x] Shipping Library - generateShippingLabel, getSelfShipInstructions, generateLabelHTML, generatePackingSlipHTML
- [x] Free Shipping Logic - qualifiesForFreeShipping based on submission value
- [x] Tracking Updates - updateTrackingNumber, markAsReceived
- [x] 351 unit tests passing (submissions: 56, shipping: 54, + Phase 1-2 tests)

See `PHASE3_PLAN.md` for detailed design documentation.

### Phase 4 (COMPLETE)
- [x] App Proxy Authentication - HMAC-SHA256 signature validation, timing-safe comparison
- [x] Customer-Facing API Routes - Card search, submissions CRUD, shipping endpoints
- [x] Input Validation Helpers - sanitizeString, parsePositiveInt, isValidEmail
- [x] Email Notifications - HTML/text templates for all submission lifecycle events
- [x] Shopify Webhooks - customers/update, customers/delete, app/uninstalled
- [x] GDPR Compliance - customers/redact, shop/redact, customers/data_request handlers
- [x] Customer Data Anonymization - Preserves submission history while removing PII
- [x] 460 unit tests passing (app-proxy: 39, notifications: 50, webhooks: 20, + Phase 1-3 tests)

See `PHASE4_PLAN.md` for detailed design documentation.

### Phase 5 (COMPLETE)
- [x] Bulk Operations Library - bulkMarkReceived, bulkStartGrading, bulkApproveSubmissions, bulkCancelSubmissions, bulkRequestReturns, bulkAddNotes
- [x] Email Provider Integration - Multi-provider support (Resend, SendGrid, Console fallback), template system, HTML/text formatting
- [x] Rate Limiting - Memory-based store, configurable presets (api, strict, search, submission, auth, export), middleware helpers
- [x] Admin Reports Route - Summary stats, status breakdown, payout breakdown, top cards, daily stats with date range filtering
- [x] Export Functionality - CSV/JSON export for submissions, items, customers, payouts with field selection
- [x] Theme App Extension - Trade-in form, submission tracker, CTA blocks with full CSS styling
- [x] 564 unit tests passing (rate-limit: 47, bulk-ops: 31, email-provider: 26, + Phase 1-4 tests)

See `PHASE5_PLAN.md` for detailed design documentation.

## Environment Variables
See `.env` for required variables:
- `DATABASE_URL` - PostgreSQL connection string
- `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET` - App credentials
- `SCOPES` - Required Shopify API scopes
- `COMPANY_NAME`, `COMPANY_ADDRESS`, `COMPANY_EMAIL` - For shipping labels and notifications
- `SENDGRID_API_KEY` or `POSTMARK_API_KEY` - Email service (optional, logs to console if not set)

## Architecture Notes

### Shopify App Setup
- Uses `@shopify/shopify-app-react-router` (NOT Remix - this is React Router v7)
- Embedded app with `future.unstable_newEmbeddedAuthStrategy: true`
- Session storage via `PrismaSessionStorage`
- Polaris styles loaded via `links` export in `app/routes/app.tsx`

### Important Patterns
- **Server-only imports**: Use dynamic `await import()` inside loader/action functions for `.server.ts` files
- **React Router v7**: Return plain objects from loaders, NOT `json()` wrapper (deprecated)
- **Auth handling**: `authenticate.admin()` may throw Response objects for redirects - catch and return them

### Prices
- All prices stored in pence (integer) to avoid floating point issues
- Uses Prisma Decimal for external price data, converted via `toNumber()`
- Workflow transitions validated via `attemptTransition()` before database updates

### Testing
- Tests located in `app/lib/__tests__/`
- Mock Prisma client for database operations
- Run `npm run test` before committing
