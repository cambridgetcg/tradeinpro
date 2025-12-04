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

### Routes
- `app/routes/app._index.tsx` - Dashboard with stats, alerts, recent activity
- `app/routes/app.trade-ins.tsx` - Queue view with filters, search, pagination
- `app/routes/app.trade-ins.$id.tsx` - Grading interface with condition adjustment
- `app/routes/app.settings.tsx` - App settings configuration
- `app/routes/app.prices.tsx` - Price database browsing and search
- `app/routes/app.payouts.tsx` - Payout queue and processing

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

## Environment Variables
See `.env` for required variables:
- `DATABASE_URL` - PostgreSQL connection string
- `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET` - App credentials
- `SCOPES` - Required Shopify API scopes

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
