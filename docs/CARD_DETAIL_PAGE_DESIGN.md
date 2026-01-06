# Card Detail Page - Design Specification

## Overview

A dedicated page for viewing individual card price history, market data, and related information. Inspired by industry leaders (TCGplayer, MTGGoldfish, finviz) but optimized for the TCG trade-in context.

---

## Data Available

### From CardPriceV2 (Current Data)
```typescript
{
  cardId: "OP01-OP01-073-parallel",
  name: "OP01 Donquixote Doflamingo Parallel -EN",
  releaseSet: "OP01",
  fullCardNumber: "OP01-073",
  setCode: "OP01",
  cardNumber: "073",
  variantType: "parallel",
  rarity: "R",
  language: "EN",
  bestPriceGbp: 24.78,
  tradeinPriceGbp: 17.35,  // 70% of market
  optcgTcgplayerUsd: 33.44,
  optcgTcgplayerGbp: 24.78,
  imageUrl: "https://www.optcgapi.com/media/static/Card_Images/OP01-073_p1.jpg"
}
```

### From CardPriceHistory (Historical Data)
```typescript
{
  date: "2026-01-06",
  priceGbp: 24.78,
  priceJpy: 5200,       // When available
  exchangeRate: 0.0047,
  change: 5.2,          // Daily % change
  changeJpy: 3.1,       // JPY-only change
  changeFx: 2.1         // FX contribution
}
```

### Computed Stats
```typescript
{
  currentGbp: 24.78,
  highGbp: 32.50,
  lowGbp: 18.20,
  avgGbp: 25.40,
  change7dGbp: 12.5,
  change30dGbp: -3.2,
  // Plus JPY equivalents
}
```

---

## Layout Design

### Desktop (1200px+): Two-Column Hero Layout

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  ← Back to Index    One Piece › OP01 › OP01-073 Parallel                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────────┐    ┌────────────────────────────────────────────────┐│
│  │                  │    │  Donquixote Doflamingo                         ││
│  │                  │    │  OP01-073 • Parallel • R • English             ││
│  │    [CARD        │    │                                                 ││
│  │     IMAGE]      │    │  ┌─────────────────────────────────────────┐   ││
│  │     400x560     │    │  │  Market Price         Trade-In Value   │   ││
│  │                  │    │  │  £24.78               £17.35           │   ││
│  │                  │    │  │  $33.44 USD           (70% of market)  │   ││
│  │                  │    │  │  ▲ +5.2% (24h)                         │   ││
│  │   [Zoom Icon]   │    │  └─────────────────────────────────────────┘   ││
│  └──────────────────┘    │                                                 ││
│                          │  Quick Stats                                    ││
│                          │  ┌─────┬─────┬─────┬─────┬─────┬─────┐        ││
│                          │  │ 7D  │ 30D │ 90D │ High│ Low │ Avg │        ││
│                          │  │+12% │ -3% │+25% │£32.5│£18.2│£25.4│        ││
│                          │  └─────┴─────┴─────┴─────┴─────┴─────┘        ││
│                          └────────────────────────────────────────────────┘│
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│  Price History                                      [7D] [30D] [90D] [1Y]  │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │                                                                         ││
│  │  £35 ─────────────────────────────────────────────────────────────      ││
│  │       │                    ╭──╮                                         ││
│  │  £30 ─│───────────────────╯    ╰───────────────────────────────────     ││
│  │       │              ╭────╯                                             ││
│  │  £25 ─│─────────────╯                            Interactive Chart      ││
│  │       │        ╭────╯                            with hover tooltip     ││
│  │  £20 ─│───────╯                                                         ││
│  │       │                                                                 ││
│  │       └──────────────────────────────────────────────────────────────   ││
│  │        Jan 1    Jan 8    Jan 15    Jan 22    Jan 29    Feb 5            ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│  [Price History Tab] [Related Cards Tab] [Market Data Tab]                 │
│                                                                             │
│  Price History Table                                                        │
│  ┌──────────┬──────────┬──────────┬──────────┐                             │
│  │ Date     │ Price    │ Change   │ Volume   │                             │
│  ├──────────┼──────────┼──────────┼──────────┤                             │
│  │ Jan 6    │ £24.78   │ ▲ +5.2%  │ --       │                             │
│  │ Jan 5    │ £23.55   │ ▼ -1.2%  │ --       │                             │
│  │ Jan 4    │ £23.84   │ ▲ +2.1%  │ --       │                             │
│  │ ...      │ ...      │ ...      │ ...      │                             │
│  └──────────┴──────────┴──────────┴──────────┘                             │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│  Related Cards                                                              │
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐                   │
│  │[Image] │ │[Image] │ │[Image] │ │[Image] │ │[Image] │                   │
│  │OP01-073│ │OP01-073│ │OP05-   │ │OP07-   │ │OP09-   │                   │
│  │  Base  │ │ Manga  │ │Doffy SP│ │Doffy SP│ │Doffy   │                   │
│  │ £3.50  │ │ £45.00 │ │ £85.00 │ │ £62.00 │ │ £28.00 │                   │
│  └────────┘ └────────┘ └────────┘ └────────┘ └────────┘                   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Mobile (<768px): Stacked Layout

```
┌─────────────────────────────┐
│ ← Back                      │
├─────────────────────────────┤
│                             │
│      ┌───────────────┐      │
│      │               │      │
│      │  [CARD IMAGE] │      │
│      │    300x420    │      │
│      │               │      │
│      └───────────────┘      │
│                             │
│  Donquixote Doflamingo      │
│  OP01-073 • Parallel • R    │
│                             │
│  ┌─────────────────────────┐│
│  │ £24.78      ▲ +5.2%    ││
│  │ Trade-in: £17.35        ││
│  └─────────────────────────┘│
│                             │
│  [7D][30D][90D][1Y]         │
│  ┌─────────────────────────┐│
│  │                         ││
│  │   [PRICE CHART]         ││
│  │      200px height       ││
│  │                         ││
│  └─────────────────────────┘│
│                             │
│  Quick Stats                │
│  ┌──────┬──────┬──────┐    │
│  │ High │ Low  │ Avg  │    │
│  │£32.50│£18.20│£25.40│    │
│  └──────┴──────┴──────┘    │
│                             │
│  [See Price History ▼]      │
│  [See Related Cards ▼]      │
│                             │
└─────────────────────────────┘
```

---

## Component Specifications

### 1. Card Image Display

**Design Goals:**
- Showcase the card as the visual anchor
- High quality with zoom capability
- Match card's natural aspect ratio (~0.714 width/height)

**Specifications:**
```css
.card-detail__image-container {
  width: 320px;           /* Desktop */
  aspect-ratio: 5/7;      /* Standard TCG ratio */
  border-radius: 12px;
  overflow: hidden;
  box-shadow:
    0 20px 40px rgba(0,0,0,0.3),
    0 0 60px rgba(139, 92, 246, 0.1);  /* Subtle purple glow */
  transition: transform 0.3s ease;
}

.card-detail__image-container:hover {
  transform: scale(1.02);
  cursor: zoom-in;
}

/* For parallel/special cards - holographic effect */
.card-detail__image-container--special::before {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(
    135deg,
    transparent 0%,
    rgba(255,255,255,0.1) 50%,
    transparent 100%
  );
  animation: shimmer 3s infinite;
}
```

**Mobile:** 280px width, centered

**Zoom Modal:**
- Click opens full-screen lightbox
- Pinch-to-zoom on mobile
- ESC/click outside to close

### 2. Price Display Card

**Primary Price Block:**
```
┌─────────────────────────────────────────┐
│  Market Price         Trade-In Value    │
│  ┌─────────────┐     ┌─────────────┐   │
│  │   £24.78    │     │   £17.35    │   │
│  │   $33.44    │     │ (70% market)│   │
│  └─────────────┘     └─────────────┘   │
│                                         │
│  ▲ +5.2% (24h)  •  ▲ +12.5% (7d)       │
└─────────────────────────────────────────┘
```

**Visual Treatment:**
- Market price: Large, bold, white text
- Trade-in: Slightly smaller, with explanation
- USD conversion shown below GBP
- Change indicators with color coding:
  - Green (#4ade80): Positive change
  - Red (#f87171): Negative change
  - Gray (#94a3b8): No change

### 3. Interactive Price Chart

**Chart Requirements:**
- Chart.js line chart with gradient fill
- Responsive sizing
- Touch-friendly on mobile
- Crosshair cursor showing exact price/date

**Time Range Buttons:**
```
[7D] [30D] [90D] [1Y] [ALL]
         ↑ active
```

**Chart Styling:**
```javascript
{
  type: 'line',
  data: {
    datasets: [{
      borderColor: '#8b5cf6',  // Purple
      backgroundColor: gradient,  // Purple → transparent
      borderWidth: 2,
      pointRadius: 0,
      pointHoverRadius: 6,
      tension: 0.3,  // Slight curve
    }]
  },
  options: {
    interaction: {
      intersect: false,
      mode: 'index',
    },
    plugins: {
      tooltip: {
        backgroundColor: '#1a1f26',
        borderColor: '#2d3640',
        callbacks: {
          label: (ctx) => `£${ctx.raw.toFixed(2)}`
        }
      }
    }
  }
}
```

**Dual Currency Mode:**
- Toggle between GBP and JPY charts
- Show exchange rate overlay when in JPY mode

### 4. Stats Grid

```
┌────────┬────────┬────────┬────────┬────────┬────────┐
│   7D   │  30D   │  90D   │  High  │  Low   │  Avg   │
├────────┼────────┼────────┼────────┼────────┼────────┤
│ +12.5% │  -3.2% │ +25.0% │ £32.50 │ £18.20 │ £25.40 │
│   ▲    │   ▼    │   ▲    │        │        │        │
└────────┴────────┴────────┴────────┴────────┴────────┘
```

**Color Coding:**
- Change percentages colored green/red based on direction
- High/Low/Avg in neutral white

### 5. Price History Table

**Columns:**
| Date | Price (GBP) | Price (JPY) | Change | FX Impact |
|------|-------------|-------------|--------|-----------|
| Jan 6 | £24.78 | ¥5,200 | +5.2% | +0.3% |

**Features:**
- Sortable columns
- Pagination (25 rows default)
- Export to CSV button
- Currency toggle affects display

### 6. Related Cards Section

**Card Thumbnails:**
```
┌──────────────┐
│    [Image]   │  <- 100x140px
│              │
├──────────────┤
│ OP01-073     │  <- Card number
│ Base         │  <- Variant type
│ £3.50  ▲2.1% │  <- Price + change
└──────────────┘
```

**Related Cards Query:**
1. Same fullCardNumber, different variants
2. Same character name, different sets
3. Same set, same rarity

---

## API Endpoint Design

### GET /apps/trade-in/price-index/card/:cardId

Returns comprehensive card data for the detail page.

**Response:**
```typescript
interface CardDetailResponse {
  card: {
    cardId: string;
    name: string;
    fullCardNumber: string;
    setCode: string;
    releaseSet: string;
    variantType: string | null;
    rarity: string | null;
    language: string;
    imageUrl: string | null;
  };

  pricing: {
    currentGbp: number;
    currentUsd: number;
    currentJpy: number | null;
    tradeinGbp: number;
    tradeinPercent: number;  // e.g., 70
    change24h: number;
    change7d: number;
    change30d: number;
    updatedAt: string;
  };

  stats: {
    highGbp: number;
    lowGbp: number;
    avgGbp: number;
    highJpy: number | null;
    lowJpy: number | null;
    avgJpy: number | null;
    volatility: number;  // Standard deviation %
    daysTracked: number;
  };

  history: Array<{
    date: string;
    priceGbp: number;
    priceJpy: number | null;
    change: number;
    changeJpy: number | null;
    changeFx: number | null;
  }>;

  related: Array<{
    cardId: string;
    name: string;
    variantType: string | null;
    priceGbp: number;
    change24h: number;
    imageUrl: string | null;
  }>;

  exchangeRate: {
    current: number;
    change24h: number;
  };
}
```

---

## URL Structure

**Pattern:** `/pages/card-detail?id={cardId}`

**Via App Proxy:** `/apps/trade-in/card/{cardId}`

**Examples:**
- `/apps/trade-in/card/OP01-OP01-073-parallel`
- `/apps/trade-in/card/OP05-OP01-051-sp`

---

## Implementation Phases

### Phase 1: Core Page (MVP)
- [ ] Create API endpoint `/price-index/card/:cardId`
- [ ] Create Liquid template `page.card-detail.liquid`
- [ ] Card image display with fallback
- [ ] Current price display (GBP only)
- [ ] Basic price chart (30 days)
- [ ] Stats grid

### Phase 2: Enhanced Features
- [ ] Dual currency support (GBP/JPY toggle)
- [ ] All time range options (7D/30D/90D/1Y/ALL)
- [ ] Price history table with pagination
- [ ] Image zoom lightbox
- [ ] Mobile-optimized layout

### Phase 3: Related & Navigation
- [ ] Related cards section
- [ ] Breadcrumb navigation
- [ ] Back to heatmap/index
- [ ] Share card link
- [ ] Add to watchlist (future)

---

## Technical Considerations

### Performance
- Lazy load card image
- Chart renders after initial paint
- History table virtualized for large datasets
- Cache API response (5 min TTL)

### SEO (if applicable)
- Semantic HTML structure
- Open Graph meta tags for sharing
- JSON-LD structured data

### Accessibility
- Alt text for card images
- Keyboard navigation for chart
- ARIA labels on interactive elements
- Color contrast ratios (WCAG AA)

### Error States
- Card not found → 404 page
- No history data → "No price history available" message
- Image load failure → Placeholder with card name
- API error → Retry button with error message

---

## File Structure

```
/cardforum/app/routes/
  api.price-index.card.$cardId.tsx        # API endpoint

/ShopifyTheme_TCG/
  templates/
    page.card-detail.liquid               # Liquid template
  assets/
    card-detail.js                        # Page JavaScript
    card-detail.css                       # Page styles
```

---

## Color Palette (PRISM Theme)

```css
--cd-bg: #0f1419;
--cd-surface: #1a1f26;
--cd-surface-hover: #252b33;
--cd-border: #2d3640;
--cd-text: #e5e7eb;
--cd-text-secondary: #9ca3af;

--cd-gain: #4ade80;
--cd-loss: #f87171;
--cd-neutral: #94a3b8;

--cd-accent: #8b5cf6;      /* Purple - primary accent */
--cd-accent-light: #a78bfa;
--cd-chart-line: #8b5cf6;
--cd-chart-fill: rgba(139, 92, 246, 0.1);
```
