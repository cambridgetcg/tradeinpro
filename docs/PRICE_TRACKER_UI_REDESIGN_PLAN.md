# Price Tracker UI Redesign Plan

## Executive Summary

Based on comprehensive research of leading TCG price tracking platforms (TCGplayer, Cardmarket, MTGGoldfish, PriceCharting, Pokemon trackers, BinderPOS), this document outlines a strategic redesign plan for our PRISM Price Index system. The goal is to adopt industry best practices while maintaining our unique neural network visualization concept.

---

## Research Findings: Industry Design Patterns

### 1. Price Visualization Standards

| Platform | Primary Chart Type | Unique Feature |
|----------|-------------------|----------------|
| MTGGoldfish | Stock-market line charts | Price indices like S&P 500 |
| PriceCharting | Dual metric (Avg/Median) toggle | 15+ year historical data |
| TCGplayer | Volatility scale indicator | Real-time transaction-based pricing |
| Cardmarket | 1/7/30 day trend indicators | Alert when price exceeds 10% of 3-day avg |

**Key Insight**: All major platforms treat card prices like financial instruments, using stock market conventions (green=up, red=down, line charts, indices).

### 2. Color Psychology Conventions

```
Green (#00ff88, #4ade80)  → Price increase, abundant stock, positive
Red (#ff4444, #f87171)    → Price decrease, low stock, negative
Gold (#eab308)            → Premium, outstanding, rare
Grey (#94a3b8)            → Neutral, no stock, inactive
Blue (#3b82f6)            → Interactive, primary actions
Purple (#8b5cf6)          → Premium features, special items
```

**Our Current**: Already aligned with industry standards via CSS variables.

### 3. Information Hierarchy

**MTGGoldfish Pattern** (most effective):
```
Level 1: Market Index Summary (hero section)
Level 2: Movers & Shakers (attention grabbers)
Level 3: Category Breakdown (sets, formats)
Level 4: Individual Card Details (drill-down)
```

### 4. Mobile-First Patterns

- Camera-based card scanning (TCGplayer, PokeScreener)
- Top-positioned quick filters
- Swipe gestures for navigation
- Collapsible filter panels
- Touch-friendly chart interactions

---

## Gap Analysis: Current vs. Best Practices

| Feature | Industry Standard | Our Current | Gap |
|---------|------------------|-------------|-----|
| Movers Display | Ranked list with % change | Basic list | **Need ranking, prominent % display** |
| Price Chart | Interactive with tooltips | Basic Chart.js | **Need interactive crosshair, annotations** |
| Currency Toggle | Regional pricing (TCGplayer) | GBP/JPY toggle | ✅ Implemented |
| Volatility Indicator | Visual scale (TCGplayer) | Not present | **High priority** |
| Card Search | Instant search with preview | Not on price page | **Consider adding** |
| Condition Filter | Standard dropdown | Not on price page | **Consider adding** |
| Time Range | 7D/30D/90D/1Y/All buttons | 7D/30D/90D/1Y | ✅ Good |
| Data Freshness | Timestamp with auto-refresh | "Updated HH:MM" | ✅ Good |
| Dark Mode | Universal standard | Dark only | **Consider light mode option** |
| Mobile Scanning | Camera integration | Not present | **Future consideration** |

---

## Redesign Plan

### Phase 1: Enhanced Movers Display (Priority: HIGH)

**Current State**: Simple list with name, set, and change percentage.

**Target State** (inspired by MTGGoldfish):

```
┌─────────────────────────────────────────┐
│  TOP GAINERS (24h)                      │
├─────────────────────────────────────────┤
│  1. ▲ Eustass Kid (OP01-051-SP)         │
│     £45.00 → £67.50  +£22.50 (+50.0%)   │
│     ░░░░░░░░░░░░░░░░░░░░████████ Volume │
├─────────────────────────────────────────┤
│  2. ▲ Portgas D. Ace (OP02-013-P)       │
│     £32.00 → £44.80  +£12.80 (+40.0%)   │
│     ░░░░░░░░░░░░░░░░░░░░░░████ Volume   │
└─────────────────────────────────────────┘
```

**Implementation**:
```javascript
// Enhanced mover item structure
{
  rank: 1,
  cardId: "OP01-051-SP",
  name: "Eustass Kid",
  setCode: "OP01",
  previousPrice: 45.00,
  currentPrice: 67.50,
  changeAmount: 22.50,
  changePercent: 50.0,
  volume24h: 12,  // Number of sales
  volumeBar: 0.8  // Relative volume (0-1)
}
```

**CSS Addition**:
```css
.price-index__mover-item--enhanced {
  display: grid;
  grid-template-columns: 32px 1fr auto;
  gap: 0.75rem;
  padding: 0.75rem;
  border-left: 3px solid transparent;
}

.price-index__mover-item--gainer {
  border-left-color: var(--pi-gain-medium);
  background: linear-gradient(90deg, rgba(0,255,136,0.05) 0%, transparent 100%);
}

.price-index__mover-volume-bar {
  height: 4px;
  background: var(--pi-border);
  border-radius: 2px;
  margin-top: 0.25rem;
}

.price-index__mover-volume-fill {
  height: 100%;
  background: var(--pi-cluster);
  border-radius: 2px;
  transition: width 0.3s ease;
}
```

### Phase 2: Volatility Indicator (Priority: HIGH)

**Inspiration**: TCGplayer's Market Price Volatility Scale

**Concept**: Visual indicator showing price stability based on:
- Standard deviation of price over 30 days
- Number of data points (sales volume)
- Price range (high - low) / average

```
Volatility Scale:
████████░░  Stable (σ < 5%)
██████████  Moderate (5% ≤ σ < 15%)
██████████  Volatile (15% ≤ σ < 30%)
██████████  Highly Volatile (σ ≥ 30%)
```

**Implementation**:
```typescript
// Calculate volatility score
function calculateVolatility(history: PricePoint[]): {
  score: number;      // 0-100
  label: string;      // "Stable" | "Moderate" | "Volatile" | "Highly Volatile"
  stdDev: number;     // Actual standard deviation
  dataPoints: number; // Sample size
} {
  if (history.length < 7) {
    return { score: 50, label: "Insufficient Data", stdDev: 0, dataPoints: history.length };
  }

  const prices = history.map(h => h.priceGbp);
  const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
  const squaredDiffs = prices.map(p => Math.pow(p - mean, 2));
  const variance = squaredDiffs.reduce((a, b) => a + b, 0) / prices.length;
  const stdDev = Math.sqrt(variance);
  const coefficientOfVariation = (stdDev / mean) * 100;

  let label: string;
  let score: number;

  if (coefficientOfVariation < 5) {
    label = "Stable";
    score = 20;
  } else if (coefficientOfVariation < 15) {
    label = "Moderate";
    score = 45;
  } else if (coefficientOfVariation < 30) {
    label = "Volatile";
    score = 70;
  } else {
    label = "Highly Volatile";
    score = 95;
  }

  return { score, label, stdDev, dataPoints: history.length };
}
```

**UI Component**:
```html
<div class="price-index__volatility">
  <span class="price-index__volatility-label">Volatility</span>
  <div class="price-index__volatility-bar">
    <div class="price-index__volatility-fill" style="width: 45%"></div>
  </div>
  <span class="price-index__volatility-text">Moderate</span>
</div>
```

### Phase 3: Interactive Chart Enhancements (Priority: MEDIUM)

**Inspired by**: PriceCharting's dual-metric toggle, MTGGoldfish's annotations

**Features to Add**:

1. **Crosshair Cursor**: Show exact date/price on hover
2. **Dual-Currency Overlay**: Option to show GBP and JPY on same chart
3. **Average Line**: 7-day moving average overlay
4. **Annotations**: Mark significant events (set releases, meta shifts)
5. **Volume Bars**: Show trading volume below main chart

**Chart.js Configuration Update**:
```javascript
const chartConfig = {
  type: 'line',
  data: {
    datasets: [
      {
        label: 'Price (GBP)',
        data: priceData,
        borderColor: '#3b82f6',
        fill: true,
        yAxisID: 'y',
      },
      {
        label: '7-Day MA',
        data: movingAverageData,
        borderColor: '#8b5cf6',
        borderDash: [5, 5],
        pointRadius: 0,
        fill: false,
        yAxisID: 'y',
      }
    ]
  },
  options: {
    interaction: {
      mode: 'index',
      intersect: false,
    },
    plugins: {
      crosshair: {
        line: {
          color: '#9ca3af',
          width: 1,
          dashPattern: [6, 4]
        },
        zoom: {
          enabled: false
        }
      },
      annotation: {
        annotations: {
          setRelease: {
            type: 'line',
            xMin: '2025-12-01',
            xMax: '2025-12-01',
            borderColor: '#eab308',
            borderWidth: 2,
            label: {
              content: 'OP-10 Release',
              enabled: true
            }
          }
        }
      }
    }
  }
};
```

### Phase 4: Summary Cards Redesign (Priority: MEDIUM)

**Current**: 4 basic summary cards
**Target**: Enhanced cards with sparklines and context

```
┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐
│ ONE PIECE INDEX  │ │ TOP 100 INDEX    │ │ MARKET HEALTH    │ │ FX IMPACT        │
│ £1,247.50        │ │ £8,432.00        │ │ ▲ Bullish        │ │ ¥212.5/£         │
│ ▲ +2.3% (24h)    │ │ ▲ +1.8% (24h)    │ │ 68% cards up     │ │ ▼ -0.5% (24h)    │
│ ▁▂▃▄▅▆▇█ (7d)    │ │ ▁▂▂▃▄▅▆▇ (7d)    │ │ Volume: 1,247    │ │ Impact: +£12.30  │
└──────────────────┘ └──────────────────┘ └──────────────────┘ └──────────────────┘
```

**New Summary Card Types**:

1. **Market Index Card**: Primary index with sparkline
2. **Market Health Card**: Bullish/Bearish indicator based on gainers vs losers ratio
3. **FX Impact Card**: Show how exchange rate changes affect portfolio value
4. **Hot Set Card**: Currently trending set with reason

**Sparkline Implementation** (inline SVG):
```javascript
function generateSparkline(data, width = 80, height = 24) {
  const values = data.slice(-7); // Last 7 days
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const points = values.map((v, i) => {
    const x = (i / (values.length - 1)) * width;
    const y = height - ((v - min) / range) * height;
    return `${x},${y}`;
  }).join(' ');

  const trend = values[values.length - 1] > values[0] ? '#4ade80' : '#f87171';

  return `<svg width="${width}" height="${height}" class="sparkline">
    <polyline points="${points}" fill="none" stroke="${trend}" stroke-width="2"/>
  </svg>`;
}
```

### Phase 5: Card Quick Search (Priority: LOW)

**Inspiration**: TCGplayer's instant search, Cardmarket's left panel filters

Add a search overlay accessible from the price index page:

```
┌─────────────────────────────────────────────────────────┐
│ 🔍 Search cards...                              [Esc]   │
├─────────────────────────────────────────────────────────┤
│ Recent Searches:                                        │
│   • Eustass Kid SP                                      │
│   • Portgas D. Ace Parallel                             │
│                                                         │
│ Trending Now:                                           │
│   • Shanks (OP01-120-SEC)      £89.00  ▲ +15%          │
│   • Luffy (OP05-119-SEC)       £124.50 ▲ +8%           │
└─────────────────────────────────────────────────────────┘
```

**Keyboard Shortcut**: `/` or `Cmd+K` to open search overlay

### Phase 6: Light Mode Support (Priority: LOW)

**Industry Standard**: All major platforms offer light/dark toggle

**Implementation Approach**:
```css
/* Light mode variables */
.price-index[data-theme="light"] {
  --pi-bg: #f8fafc;
  --pi-surface: #ffffff;
  --pi-surface-hover: #f1f5f9;
  --pi-border: #e2e8f0;
  --pi-text: #1e293b;
  --pi-text-secondary: #64748b;
}

/* System preference detection */
@media (prefers-color-scheme: light) {
  .price-index:not([data-theme="dark"]) {
    --pi-bg: #f8fafc;
    /* ... */
  }
}
```

---

## Implementation Roadmap

### Week 1-2: Phase 1 (Enhanced Movers)
- [ ] Update movers API to include previous price and volume
- [ ] Redesign mover item component
- [ ] Add volume bars
- [ ] Add ranking numbers with visual hierarchy

### Week 3-4: Phase 2 (Volatility Indicator)
- [ ] Create volatility calculation function
- [ ] Add volatility to card history API response
- [ ] Design and implement volatility UI component
- [ ] Add to summary cards and card details

### Week 5-6: Phase 3 (Chart Enhancements)
- [ ] Add Chart.js annotation plugin
- [ ] Implement crosshair cursor
- [ ] Add moving average overlay toggle
- [ ] Design volume bar sub-chart

### Week 7-8: Phase 4 (Summary Cards)
- [ ] Create sparkline generator
- [ ] Design market health indicator
- [ ] Add FX impact calculation
- [ ] Implement hot set detection

### Future: Phase 5-6 (Search & Light Mode)
- [ ] Build search overlay component
- [ ] Implement keyboard shortcuts
- [ ] Design light theme variables
- [ ] Add theme toggle to header

---

## Technical Specifications

### API Changes Required

**1. Enhanced Movers Endpoint** (`/api/price-index/movers`)
```typescript
interface EnhancedMover {
  rank: number;
  cardId: string;
  name: string;
  setCode: string;
  imageUrl?: string;
  previousPrice: number;   // NEW
  currentPrice: number;
  changeAmount: number;    // NEW
  changePercent: number;
  volume24h: number;       // NEW
  volumeRelative: number;  // NEW (0-1 scale)
}

interface MoversResponse {
  gainers: EnhancedMover[];
  losers: EnhancedMover[];
  mostVolume: EnhancedMover[];  // NEW
  newlyListed: EnhancedMover[]; // NEW
}
```

**2. Card History with Volatility** (`/api/price-index/card/:id/history`)
```typescript
interface EnhancedCardHistory {
  // ... existing fields
  volatility: {
    score: number;
    label: string;
    stdDev: number;
    dataPoints: number;
  };
  movingAverage7d: number[];  // NEW
  annotations: {
    date: string;
    type: 'release' | 'reprint' | 'meta' | 'custom';
    label: string;
  }[];
}
```

**3. Market Health Endpoint** (`/api/price-index/health`) - NEW
```typescript
interface MarketHealth {
  sentiment: 'bullish' | 'bearish' | 'neutral';
  gainersCount: number;
  losersCount: number;
  unchangedCount: number;
  totalVolume24h: number;
  avgChange24h: number;
  hotSets: {
    setCode: string;
    change: number;
    reason: string;
  }[];
}
```

### Performance Considerations

1. **Sparkline Generation**: Pre-compute on server, cache in response
2. **Volatility Calculation**: Calculate during daily price sync, store in DB
3. **Moving Averages**: Compute server-side, include in history response
4. **Chart Annotations**: Load separately on demand

### Browser Support

- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+
- Mobile: iOS Safari 14+, Chrome Android 90+

---

## Success Metrics

| Metric | Current | Target | Measurement |
|--------|---------|--------|-------------|
| Time on page | ~45s | 2+ min | Analytics |
| Return visits | Unknown | 40%+ | Analytics |
| Chart interactions | Low | 3+ per visit | Event tracking |
| Currency toggle usage | New | 15%+ | Event tracking |
| Search usage | N/A | 25%+ | Event tracking |

---

## Appendix: Component Library

### New CSS Classes to Add

```css
/* Volatility */
.price-index__volatility { }
.price-index__volatility-bar { }
.price-index__volatility-fill { }
.price-index__volatility-fill--stable { background: #4ade80; }
.price-index__volatility-fill--moderate { background: #eab308; }
.price-index__volatility-fill--volatile { background: #f97316; }
.price-index__volatility-fill--extreme { background: #ef4444; }

/* Enhanced Movers */
.price-index__mover-item--enhanced { }
.price-index__mover-prices { }
.price-index__mover-previous { }
.price-index__mover-arrow { }
.price-index__mover-current { }
.price-index__mover-volume-bar { }
.price-index__mover-volume-fill { }

/* Sparklines */
.price-index__sparkline { }
.price-index__sparkline--positive { }
.price-index__sparkline--negative { }

/* Search Overlay */
.price-index__search-overlay { }
.price-index__search-input { }
.price-index__search-results { }
.price-index__search-recent { }
.price-index__search-trending { }

/* Theme Toggle */
.price-index__theme-toggle { }
.price-index[data-theme="light"] { }
.price-index[data-theme="dark"] { }
```

---

## References

- TCGplayer Market Price: https://help.tcgplayer.com/hc/en-us/articles/213588017
- MTGGoldfish Price Indices: https://www.mtggoldfish.com/indices
- PriceCharting Index Charts: https://blog.pricecharting.com/2021/10/price-index-charts
- Cardmarket Dark Mode: https://news.cardmarket.com/en/WoW/Cardmarkets-Brand-New-Icons
- Chart.js Annotation Plugin: https://www.chartjs.org/chartjs-plugin-annotation/

---

*Document Version: 1.0*
*Created: 2026-01-06*
*Author: Claude Code*
