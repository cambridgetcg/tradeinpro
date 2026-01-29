# Current State Assessment

**Date**: 2026-01-29
**Project**: CardForum
**Assessed By**: Claude (Purpose Prompter)

---

## What Works

### Trade-In App (Phase 1-5 Complete)
- [x] Constants and enums (SubmissionStatus, ItemStatus, Condition, PayoutType)
- [x] Pricing engine with condition multipliers (NM: 70%, LP: 55%, MP: 40%, HP: 25%, DMG: 10%)
- [x] Workflow state machine with validation rules
- [x] Dashboard with live stats
- [x] Trade-in queue with filters, search, pagination
- [x] Grading interface UI with expand/collapse items
- [x] Settings management (multipliers, thresholds, notifications)
- [x] Price management (browse, search)
- [x] Payout processing framework (gift cards, bank transfer tracking)
- [x] Customer submissions library
- [x] Shipping library (labels, packing slips, instructions)
- [x] App proxy authentication (HMAC-SHA256)
- [x] Customer-facing API routes (cards search, submissions CRUD)
- [x] Email templates (all lifecycle events)
- [x] GDPR compliance handlers
- [x] Bulk operations library
- [x] Rate limiting middleware
- [x] Admin reports route
- [x] Theme app extension blocks (form, tracker, CTA)

### Price Intelligence (PRISM)
- [x] Price index calculation engine with configs
- [x] Prisma models (PriceIndexSnapshot, CardPriceHistory, PriceCorrelation)
- [x] Summary API endpoint
- [x] Historical data endpoint
- [x] Crystal visualization data endpoint
- [x] Top movers endpoint
- [x] Daily cron job for snapshots
- [x] 2D canvas-based node/edge rendering
- [x] Basic force-directed layout
- [x] Hover interaction with tooltip
- [x] Chart.js integration for line charts

### Data Pipeline
- [x] Multi-source price collection (JustTCG, Cardmarket, OPTCG)
- [x] CardPriceV2 model with variant support
- [x] Daily price sync from Lambda
- [x] Price history tracking

### Infrastructure
- [x] PostgreSQL on AWS RDS
- [x] Vercel deployment
- [x] Horizontal sharding schema (GameShard model)
- [x] RDS tiered storage schema

---

## What Doesn't Work

### Critical Bugs (P0)
- [ ] **Grading price recalculation** - `cardPriceId: null` breaks price lookup
  - File: `app/routes/app.trade-ins.$id.tsx:255-258`
  - Item uses `item.cardPrice[priceKey]` but cardPrice is null
  - Grading UI cannot show price previews or calculate adjusted prices

- [ ] **Auto-payout on approval** - No payout record created when submission approved
  - File: `app/routes/app.trade-ins.$id.tsx` action handler
  - `createPayout()` never called on APPROVED transition
  - Workflow incomplete: submissions stuck in APPROVED state

### Integration Issues (P1)
- [ ] **Email notifications not wired** - Templates exist but never sent
  - File: `app/lib/notifications.server.ts` has templates
  - Action handlers don't call notification functions
  - Customers receive no status updates

- [ ] **Customer tracker disconnected** - Theme block exists but not connected
  - File: `extensions/trade-in-blocks/blocks/trade-in-tracker.liquid`
  - API exists but tracker block uses placeholder data

---

## What's Partially Working

### Trade-In Flow (70%)
- Submission works end-to-end for DRAFT → SUBMITTED
- Grading UI displays but price calculation broken
- Payout processing works if manually created
- Missing: auto-payout, email notifications, tracker integration

### PRISM Visualization (60%)
- 2D canvas rendering works
- Basic clustering by set
- Missing: 3D Three.js, physics simulation, animations

### Data Pipeline (75%)
- Price sync works
- ML features have 7 hardcoded values returning constants
- Missing: relative_volume, inventory_signal, correlations

---

## Known Obstacles

### Technical Debt
- [ ] CardPrice vs CardPriceV2 FK mismatch
- [ ] No E2E test coverage
- [ ] Theme extension not tested in real Shopify theme
- [ ] ML features hardcoded (blocks training)

### Missing Infrastructure
- [ ] No monitoring/alerting
- [ ] No error tracking (Sentry etc.)
- [ ] No performance metrics collection
- [ ] No automated deployment tests

### Business Blockers
- [ ] Cannot process real trade-ins until grading fixed
- [ ] No customer-facing documentation
- [ ] No admin training materials

---

## Current Capabilities

What the system CAN do now:
- Display card prices from database
- Accept trade-in submissions via storefront form
- Show submission queue to admin
- Display grading interface (without price calculation)
- Manage app settings
- Browse price database
- Show price indices and 2D visualization
- Export data to CSV/JSON

---

## Current Limitations

What the system CANNOT do now:
- Complete grading with price recalculation
- Automatically create payouts on approval
- Send email notifications
- Show customers their submission status
- Train ML models (features are constants)
- Render 3D crystal visualization

---

## Baseline Metrics

### Test Coverage
- Unit tests: 564 passing
- E2E tests: 0 (not implemented)
- Coverage: Unknown (not measured)

### Code Quality
- Open P0 bugs: 2 (grading, auto-payout)
- Open P1 bugs: 2 (email, tracker)
- Technical debt items: 4

### Data Quality
- Cards in CardPriceV2: ~515 variants
- Price sources: 3 (JustTCG, Cardmarket, OPTCG)
- Price freshness: 12 hours max (Lambda runs 8AM/8PM UTC)

---

## Next Actions

Immediate priorities to reach first waypoint (W1: Fix Critical Grading Flow):

1. **Fix grading price lookup** - Store prices on TradeInItem at creation
2. **Implement auto-payout** - Call `createPayout()` on APPROVED transition
3. **Wire email notifications** - Call notification functions in action handlers
4. **Add E2E test** - Verify full submission flow works

---

*Assessment Method: Code analysis + document review*
*Confidence: High (verified via file reads)*
