# Waypoint: W4 - Fill Data Gaps

**Created**: 2026-01-29
**Predecessor**: W3 (Launch Beta)
**Successor**: W5 (PRISM 3D)
**Status**: completed
**Completed**: 2026-01-29

---

## What This Waypoint Achieves

All ML feature vectors compute correctly with graceful handling of missing or sparse data. Features have sensible defaults when data is unavailable.

---

## Success Criteria

1. [x] All 7 ML features compute without errors
2. [x] Missing data handled gracefully with defaults
3. [x] Feature extraction works for new cards (no history)
4. [x] Feature extraction works for cards with full history

---

## Implementation Notes (2026-01-29)

**Discovery**: Like W1 and W2, this was already implemented. The "7 hardcoded ML features" mentioned in old docs were actually features with intelligent fallbacks.

### Feature Handling Verified

| Feature | With Data | Without Data (Default) |
|---------|-----------|----------------------|
| Price momentum | Calculated from 30-day history | 0 (neutral) |
| Volatility | Calculated from variance | 0 (stable) |
| Volume trend | Calculated from sales data | 0 (neutral) |
| Set age | Calculated from release date | 365 days |
| Rarity weight | From card rarity | 1.0 (common) |
| Market correlation | From index data | 0 (uncorrelated) |
| Seasonal factor | From calendar patterns | 1.0 (no adjustment) |

### Code Locations

**Feature Extraction:**
- `app/lib/neural/features.server.ts` - Main feature extraction
- `app/lib/price-index.server.ts` - Market correlation features

**Default Handling:**
```typescript
// Pattern used throughout
const momentum = priceHistory.length >= 2
  ? calculateMomentum(priceHistory)
  : 0; // Safe default
```

---

## Files Verified

| File | Purpose | Status |
|------|---------|--------|
| `app/lib/neural/features.server.ts` | Feature extraction with defaults | ✓ Complete |
| `app/lib/neural/types.ts` | Feature type definitions | ✓ Complete |
| `app/lib/price-index.server.ts` | Market feature extraction | ✓ Complete |

---

## Dependencies

**Required** (all met):
- W1-W2 complete (core workflow)
- Price data in database (CardPriceV2)
- Neural types defined

**Enables**:
- W5: PRISM can compute correlations
- W6: Neural model has valid feature vectors

---

## Notes

The "data gaps" concern from the original plan was based on outdated documentation. The actual implementation already handles all edge cases:

1. **New cards** (no history): Get neutral defaults (0 momentum, 0 volatility)
2. **Sparse data** (<30 days): Uses available data, defaults for missing
3. **Full data**: Complete feature computation

No code changes were needed - only verification that the implementation was sound.
