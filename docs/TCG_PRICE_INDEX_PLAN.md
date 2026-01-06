# TCG Price Index & Crystal Neural Network Visualization

**Project Codename:** PRISM
**Date:** 2026-01-06
**Status:** Phase 1 & 2 Complete - Basic 2D Crystal Visualization Implemented

## Implementation Notes (2026-01-06)

**Backend (cardforum/app/lib):**
- `price-index.server.ts` - Full calculation engine with index configs
- Prisma models: `PriceIndexSnapshot`, `CardPriceHistory`, `PriceCorrelation`

**API Routes (cardforum/app/routes):**
- `api.price-index.tsx` - Main summary endpoint
- `api.price-index.$type.$key.tsx` - Historical data endpoint
- `api.price-index.crystal.tsx` - Crystal visualization data
- `api.price-index.movers.tsx` - Top gainers/losers
- `api.cron.price-snapshot.tsx` - Daily cron job

**Theme Files (ShopifyTheme_TCG):**
- `templates/page.price-index.liquid` - Page template
- `assets/price-index.css` - Styles with dark theme
- `assets/price-index.js` - Client-side logic, Chart.js integration, 2D crystal

---

## Vision

Create a real-time TCG market intelligence platform that visualizes price trends as an interconnected **crystal neural network** - where each card is a node, relationships form edges, and the entire market pulses with price energy flowing through the lattice.

```
                          ╭─────────────────────────────────╮
                          │     PRISM: Price Index System    │
                          │   Market Intelligence Manifold   │
                          ╰─────────────────────────────────╯
                                         │
              ┌──────────────────────────┼──────────────────────────┐
              │                          │                          │
              ▼                          ▼                          ▼
    ┌─────────────────┐        ┌─────────────────┐        ┌─────────────────┐
    │   INDEX ENGINE  │        │  CRYSTAL RENDER │        │   TREND ORACLE  │
    │                 │        │                 │        │                 │
    │ • Game Indices  │        │ • 3D Lattice    │        │ • Predictions   │
    │ • Set Indices   │        │ • Node Physics  │        │ • Correlations  │
    │ • Rarity Tiers  │        │ • Edge Forces   │        │ • Anomalies     │
    │ • Top 100       │        │ • Energy Flow   │        │ • Alerts        │
    └─────────────────┘        └─────────────────┘        └─────────────────┘
```

---

## Part 1: Index Engine Architecture

### 1.1 Index Types

| Index Name | Description | Calculation Method |
|------------|-------------|-------------------|
| **GAME_INDEX** | Overall market health per game | Market-cap weighted average |
| **SET_INDEX** | Performance of specific sets | Equal-weighted average |
| **RARITY_INDEX** | Rarity tier performance | Weighted by card count |
| **LANGUAGE_INDEX** | EN vs JP market comparison | Side-by-side tracking |
| **TOP_100** | Most valuable cards index | Sum of top 100 bestPriceGbp |
| **VOLATILITY_INDEX** | Market stability measure | Standard deviation of changes |

### 1.2 Data Model (New Prisma Tables)

```prisma
// Daily snapshot of index values
model PriceIndexSnapshot {
  id            String   @id @default(cuid())
  indexType     String   // GAME, SET, RARITY, TOP_100, etc.
  indexKey      String   // "onepiece", "OP01", "SR", etc.

  // Core metrics
  value         Decimal  @db.Decimal(12, 4)  // Index value
  change24h     Decimal  @db.Decimal(8, 4)   // 24h change %
  change7d      Decimal  @db.Decimal(8, 4)   // 7d change %
  change30d     Decimal  @db.Decimal(8, 4)   // 30d change %

  // Volume metrics
  cardCount     Int                          // Cards in index
  totalMarketCap Decimal @db.Decimal(14, 2) // Total value in GBP
  avgPrice      Decimal  @db.Decimal(10, 2)  // Average card price

  // Volatility
  volatility    Decimal  @db.Decimal(8, 4)   // Std dev of prices
  highPrice     Decimal  @db.Decimal(10, 2)  // Highest card
  lowPrice      Decimal  @db.Decimal(10, 2)  // Lowest card

  // Timestamps
  snapshotDate  DateTime @db.Date
  createdAt     DateTime @default(now())

  @@unique([indexType, indexKey, snapshotDate])
  @@index([indexType, snapshotDate])
  @@index([indexKey])
  @@map("price_index_snapshots")
}

// Card-level price history for detailed analysis
model CardPriceHistory {
  id          String   @id @default(cuid())
  cardId      String
  priceGbp    Decimal  @db.Decimal(10, 2)
  sourceUsed  String   // Which source provided the price
  snapshotDate DateTime @db.Date

  @@unique([cardId, snapshotDate])
  @@index([cardId, snapshotDate])
  @@map("card_price_history")
}

// Correlation tracking between cards/sets
model PriceCorrelation {
  id            String  @id @default(cuid())
  entityA       String  // Card ID or Set code
  entityB       String
  correlation   Decimal @db.Decimal(5, 4)  // -1 to 1
  sampleSize    Int     // Days of data
  updatedAt     DateTime @updatedAt

  @@unique([entityA, entityB])
  @@map("price_correlations")
}
```

### 1.3 Index Calculation Engine

```typescript
// lib/price-index.server.ts

interface IndexConfig {
  type: 'GAME' | 'SET' | 'RARITY' | 'TOP_100' | 'LANGUAGE';
  key: string;
  weights: 'market_cap' | 'equal' | 'card_count';
  filters: {
    game?: string;
    setCode?: string;
    rarity?: string;
    language?: string;
    minPrice?: number;
  };
}

// Example: One Piece Game Index
const OP_GAME_INDEX: IndexConfig = {
  type: 'GAME',
  key: 'onepiece',
  weights: 'market_cap',
  filters: { game: 'onepiece', minPrice: 0.50 }
};

// Calculation formula:
// INDEX_VALUE = Σ(card_price × card_weight) / Σ(card_weight)
// where weight = 1 for equal, marketCap for market_cap weighted
```

---

## Part 2: Crystal Neural Network Visualization

### 2.1 Conceptual Design

The visualization represents the TCG market as a **crystalline neural network**:

```
                    ╭──────────────────────────────────────╮
                    │       CRYSTAL VISUALIZATION          │
                    │                                      │
                    │    ◆ = Card Node                     │
                    │    ─ = Correlation Edge              │
                    │    ⟡ = Set Cluster                   │
                    │    ◈ = Game Nucleus                  │
                    ╰──────────────────────────────────────╯

                              ◈ ONE PIECE
                             ╱  │  ╲
                            ╱   │   ╲
                    ⟡ OP01     ⟡ OP02     ⟡ OP03
                   ╱│╲       ╱│╲        ╱│╲
                  ◆ ◆ ◆     ◆ ◆ ◆      ◆ ◆ ◆
                  └─┴─┘     └─┴─┘      └─┴─┘
                    │         │          │
              ┌─────┴─────────┴──────────┴─────┐
              │     Cross-set correlations      │
              └─────────────────────────────────┘
```

### 2.2 Visual Elements

| Element | Represents | Visual Properties |
|---------|------------|-------------------|
| **Node** | Individual card | Size = price, Color = change %, Glow = volatility |
| **Edge** | Price correlation | Thickness = correlation strength, Color = positive/negative |
| **Cluster** | Set/Collection | Gravitational pull groups related cards |
| **Nucleus** | Game center | Large attractor for all cards in game |
| **Energy Pulse** | Price update | Ripple animation when prices change |
| **Lattice Lines** | Market structure | Background grid showing price levels |

### 2.3 Color Scheme

```css
/* Crystal Color Palette */
:root {
  /* Price Change Colors */
  --crystal-gain-strong: #00ff88;    /* > +10% */
  --crystal-gain-medium: #4ade80;    /* +5% to +10% */
  --crystal-gain-light: #86efac;     /* +1% to +5% */
  --crystal-neutral: #94a3b8;        /* -1% to +1% */
  --crystal-loss-light: #fca5a5;     /* -1% to -5% */
  --crystal-loss-medium: #f87171;    /* -5% to -10% */
  --crystal-loss-strong: #ff4444;    /* < -10% */

  /* Structure Colors */
  --crystal-edge-positive: rgba(0, 255, 136, 0.3);
  --crystal-edge-negative: rgba(255, 68, 68, 0.3);
  --crystal-lattice: rgba(148, 163, 184, 0.1);
  --crystal-nucleus: #8b5cf6;
  --crystal-cluster: #3b82f6;

  /* Glow Effects */
  --crystal-glow-volatile: 0 0 20px rgba(255, 200, 0, 0.8);
  --crystal-glow-stable: 0 0 10px rgba(100, 200, 255, 0.5);
}
```

### 2.4 Interaction Modes

```
┌─────────────────────────────────────────────────────────────┐
│  MODE          │  INTERACTION      │  RESULT                │
├─────────────────────────────────────────────────────────────┤
│  EXPLORE       │  Pan/Zoom         │  Navigate crystal      │
│  FOCUS         │  Click node       │  Highlight connections │
│  COMPARE       │  Shift+Click      │  Multi-select overlay  │
│  TIME_TRAVEL   │  Drag timeline    │  Historical state      │
│  CORRELATE     │  Toggle button    │  Show/hide edges       │
│  FILTER        │  Dropdown         │  Filter by game/set    │
└─────────────────────────────────────────────────────────────┘
```

### 2.5 Animation System

```javascript
// Crystal animation types
const ANIMATIONS = {
  // Continuous background animation
  LATTICE_PULSE: {
    type: 'ambient',
    frequency: 0.5, // Hz
    amplitude: 0.1
  },

  // Price update ripple
  PRICE_RIPPLE: {
    type: 'event',
    duration: 1000, // ms
    easing: 'easeOutElastic',
    propagation: 'radial' // spreads to connected nodes
  },

  // Node hover effect
  NODE_HOVER: {
    type: 'interaction',
    scale: 1.2,
    glow: 2.0,
    duration: 200
  },

  // Cluster breathing
  CLUSTER_BREATHE: {
    type: 'ambient',
    frequency: 0.2,
    amplitude: 0.05
  }
};
```

---

## Part 3: Page Layout Design

### 3.1 Page Structure

```
┌─────────────────────────────────────────────────────────────────────┐
│  HEADER: TCG Price Index - Crystal Market View                      │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    INDEX SUMMARY BAR                         │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐    │   │
│  │  │ OP INDEX │  │ TOP 100  │  │ SETS     │  │ VOLATILITY│    │   │
│  │  │ £245.67  │  │ £12,456  │  │ OP01: +3%│  │ 2.4%     │    │   │
│  │  │ ▲ +2.3%  │  │ ▼ -0.5%  │  │ OP02: -1%│  │ ■■■□□    │    │   │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘    │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌─────────────────────────────────┐  ┌─────────────────────────┐  │
│  │                                 │  │     CONTROL PANEL       │  │
│  │                                 │  │  ┌───────────────────┐  │  │
│  │                                 │  │  │ View: ○ Crystal   │  │  │
│  │                                 │  │  │       ○ Chart     │  │  │
│  │      CRYSTAL VISUALIZATION      │  │  │       ○ Table     │  │  │
│  │                                 │  │  ├───────────────────┤  │  │
│  │        (WebGL Canvas)           │  │  │ Filter:           │  │  │
│  │                                 │  │  │ [Game ▼] [Set ▼]  │  │  │
│  │                                 │  │  │ [Rarity ▼]        │  │  │
│  │                                 │  │  ├───────────────────┤  │  │
│  │                                 │  │  │ Time Range:       │  │  │
│  │                                 │  │  │ [24h][7d][30d][Y] │  │  │
│  │                                 │  │  ├───────────────────┤  │  │
│  │                                 │  │  │ TOP MOVERS        │  │  │
│  │                                 │  │  │ ▲ Luffy SP  +15%  │  │  │
│  │                                 │  │  │ ▲ Ace Para  +12%  │  │  │
│  │                                 │  │  │ ▼ Nami Base -8%   │  │  │
│  └─────────────────────────────────┘  └─────────────────────────┘  │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    TIMELINE / CHART                          │   │
│  │  £300 ┤                                          ╭──         │   │
│  │       │                              ╭───────────╯           │   │
│  │  £250 ┤              ╭───────────────╯                       │   │
│  │       │    ╭─────────╯                                       │   │
│  │  £200 ┼────╯                                                 │   │
│  │       └──────────────────────────────────────────────────    │   │
│  │        Jan    Feb    Mar    Apr    May    Jun                │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    SET BREAKDOWN TABLE                       │   │
│  │  ┌──────┬──────────┬────────┬─────────┬──────────┬────────┐ │   │
│  │  │ Set  │ Cards    │ Avg    │ 24h Δ   │ 7d Δ     │ Status │ │   │
│  │  ├──────┼──────────┼────────┼─────────┼──────────┼────────┤ │   │
│  │  │ OP01 │ 121      │ £4.56  │ +2.3%   │ +5.1%    │ ▲ Bull │ │   │
│  │  │ OP02 │ 121      │ £3.21  │ -0.5%   │ +1.2%    │ → Flat │ │   │
│  │  │ OP03 │ 121      │ £2.89  │ -1.2%   │ -2.4%    │ ▼ Bear │ │   │
│  │  └──────┴──────────┴────────┴─────────┴──────────┴────────┘ │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.2 Responsive Breakpoints

```css
/* Mobile: Stack vertically, simplified crystal */
@media (max-width: 768px) {
  .crystal-container { height: 300px; }
  .control-panel { position: fixed; bottom: 0; }
}

/* Tablet: Side panel collapses */
@media (max-width: 1024px) {
  .control-panel { width: 250px; }
}

/* Desktop: Full experience */
@media (min-width: 1025px) {
  .crystal-container { height: 500px; }
  .control-panel { width: 320px; }
}
```

---

## Part 4: Technical Implementation

### 4.1 Technology Stack

| Layer | Technology | Purpose |
|-------|------------|---------|
| **Visualization** | Three.js + WebGL | 3D crystal rendering |
| **Charts** | Chart.js or Lightweight SVG | Line/bar charts |
| **Physics** | Custom force simulation | Node positioning |
| **Data** | REST API + Polling | Real-time updates |
| **State** | Vanilla JS + localStorage | View persistence |

### 4.2 File Structure

```
ShopifyTheme_TCG/
├── templates/
│   └── page.price-index.liquid      # Main page template
│
├── sections/
│   ├── price-index-header.liquid    # Summary bar
│   ├── price-index-crystal.liquid   # WebGL container
│   ├── price-index-chart.liquid     # Timeline chart
│   └── price-index-table.liquid     # Set breakdown
│
├── assets/
│   ├── price-index.js               # Main orchestrator
│   ├── price-index-crystal.js       # Three.js visualization
│   ├── price-index-chart.js         # Chart rendering
│   ├── price-index.css              # Styles
│   └── three.min.js                 # Three.js library (150KB)
│
cardforum/
├── app/lib/
│   ├── price-index.server.ts        # Index calculations
│   └── price-correlations.server.ts # Correlation analysis
│
├── app/routes/
│   ├── api.price-index.tsx          # Index API endpoint
│   ├── api.price-index.$type.tsx    # Specific index data
│   ├── api.price-correlations.tsx   # Correlation data
│   └── api.cron.price-snapshot.tsx  # Daily snapshot job
│
└── prisma/
    └── schema.prisma                # New tables
```

### 4.3 API Endpoints

```typescript
// GET /apps/trade-in/price-index
// Returns summary of all indices
{
  "indices": {
    "GAME_onepiece": { value: 245.67, change24h: 2.3, change7d: 5.1 },
    "TOP_100": { value: 12456.00, change24h: -0.5, change7d: 1.2 },
    ...
  },
  "timestamp": "2026-01-06T12:00:00Z"
}

// GET /apps/trade-in/price-index/GAME/onepiece?range=30d
// Returns historical data for specific index
{
  "index": { type: "GAME", key: "onepiece" },
  "history": [
    { date: "2026-01-06", value: 245.67, change: 2.3 },
    { date: "2026-01-05", value: 240.15, change: -1.2 },
    ...
  ],
  "stats": {
    "high": 256.00,
    "low": 220.00,
    "avg": 238.45,
    "volatility": 4.2
  }
}

// GET /apps/trade-in/price-index/crystal-data?game=onepiece
// Returns node/edge data for crystal visualization
{
  "nodes": [
    { id: "OP01-001", price: 4.50, change: 2.1, set: "OP01", rarity: "L" },
    ...
  ],
  "edges": [
    { source: "OP01-001", target: "OP01-002", correlation: 0.85 },
    ...
  ],
  "clusters": [
    { id: "OP01", center: [0, 0], radius: 100 },
    ...
  ]
}

// GET /apps/trade-in/price-index/top-movers?limit=10
// Returns biggest gainers/losers
{
  "gainers": [
    { cardId: "OP01-121-sp", name: "Luffy SP", change: 15.2, price: 45.00 },
    ...
  ],
  "losers": [
    { cardId: "OP02-045", name: "Nami", change: -8.1, price: 2.30 },
    ...
  ]
}
```

### 4.4 Crystal Physics Engine

```javascript
// Simplified force-directed layout for crystal
class CrystalPhysics {
  constructor(nodes, edges, clusters) {
    this.nodes = nodes;
    this.edges = edges;
    this.clusters = clusters;
  }

  simulate(iterations = 100) {
    for (let i = 0; i < iterations; i++) {
      // Repulsion between all nodes
      this.applyRepulsion();

      // Attraction along edges (correlation)
      this.applyEdgeAttraction();

      // Cluster gravity (same set pulls together)
      this.applyClusterGravity();

      // Contain within bounds
      this.applyBoundary();

      // Apply velocity with damping
      this.updatePositions();
    }
  }

  applyRepulsion() {
    const k = 50; // Repulsion constant
    for (let i = 0; i < this.nodes.length; i++) {
      for (let j = i + 1; j < this.nodes.length; j++) {
        const dx = this.nodes[j].x - this.nodes[i].x;
        const dy = this.nodes[j].y - this.nodes[i].y;
        const dist = Math.sqrt(dx*dx + dy*dy) || 1;
        const force = k / (dist * dist);

        this.nodes[i].vx -= (dx / dist) * force;
        this.nodes[i].vy -= (dy / dist) * force;
        this.nodes[j].vx += (dx / dist) * force;
        this.nodes[j].vy += (dy / dist) * force;
      }
    }
  }

  applyEdgeAttraction() {
    const k = 0.01; // Spring constant
    for (const edge of this.edges) {
      const source = this.nodeMap.get(edge.source);
      const target = this.nodeMap.get(edge.target);
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const dist = Math.sqrt(dx*dx + dy*dy);
      const force = k * dist * edge.correlation;

      source.vx += (dx / dist) * force;
      source.vy += (dy / dist) * force;
      target.vx -= (dx / dist) * force;
      target.vy -= (dy / dist) * force;
    }
  }
}
```

---

## Part 5: Implementation Phases

### Phase 1: Data Foundation (Week 1) - COMPLETED
- [x] Add Prisma models for snapshots & history
- [x] Create `price-index.server.ts` calculation engine
- [x] Implement daily snapshot cron job
- [x] Build basic API endpoints

### Phase 2: Index Dashboard (Week 2) - COMPLETED
- [x] Create `page.price-index.liquid` template
- [x] Build summary bar with key indices
- [x] Implement line chart for historical data (Chart.js)
- [x] Add set breakdown table

### Phase 3: Crystal Visualization (Week 3-4) - PARTIAL
- [x] Build 2D canvas-based node/edge rendering system
- [x] Implement basic force-directed layout (set clustering)
- [x] Add hover interaction with tooltip
- [ ] Upgrade to Three.js for 3D visualization
- [ ] Add physics simulation
- [ ] Create animation system (pulses, ripples)

### Phase 4: Advanced Features (Week 5+)
- [ ] Correlation analysis engine
- [ ] Top movers alerts
- [ ] Price prediction models (future)
- [ ] Mobile-optimized view
- [ ] Share/embed functionality

---

## Part 6: Sample Visualizations

### 6.1 Crystal View (ASCII Representation)

```
                              ONE PIECE MARKET CRYSTAL

                                      ◈ OP
                                     /│\
                                    / │ \
                              ┌────┴──┴──┴────┐
                             ╱                 ╲
                  ⟡ OP01    ╱                   ╲    ⟡ OP03
                 ╱╲        ╱                     ╲        ╱╲
               ◆──◆──◆   ╱                       ╲   ◆──◆──◆
               │  │  │  ╱         ⟡ OP02          ╲  │  │  │
               ◆──◆──◆ ╱         ╱    ╲           ╲ ◆──◆──◆
                ╲ │ ╱ ╱        ◆──◆──◆──◆          ╲ ╲ │ ╱
                 ╲│╱ ╱         │  │  │  │           ╲ ╲│╱
                  ╳ ╱          ◆──◆──◆──◆            ╲ ╳
                 ╱│╲╱            ╲    ╱               ╲╱│╲
                  │              ╲  ╱                  │
                  │               ╲╱                   │
                  └───────────────╳───────────────────┘
                                  │
                          Cross-Set Correlations

    Legend:
    ◈ = Game Nucleus (One Piece)
    ⟡ = Set Cluster (OP01, OP02, OP03)
    ◆ = Individual Card Node
    ─ = Same-set connection
    ╱╲ = Cross-set correlation

    Node Colors:
    🟢 Green = Price Up      🔴 Red = Price Down      ⚪ Gray = Stable
```

### 6.2 Index Chart (ASCII)

```
    ONE PIECE GAME INDEX - Last 30 Days

    £280 ┤
         │                                         ╭──●
    £260 ┤                               ╭─────────╯
         │                    ╭──────────╯
    £240 ┤        ╭───────────╯
         │   ╭────╯
    £220 ┤───╯
         │
    £200 ┼──────────────────────────────────────────────
         └─────┬─────┬─────┬─────┬─────┬─────┬─────┬───
               W1    W2    W3    W4    W5    W6    W7

    Current: £275.43  │  24h: ▲ +2.1%  │  7d: ▲ +5.8%  │  30d: ▲ +12.4%
```

### 6.3 Set Heatmap (ASCII)

```
    SET PERFORMANCE HEATMAP

         │  OP01  │  OP02  │  OP03  │  OP04  │  OP05  │
    ─────┼────────┼────────┼────────┼────────┼────────┤
    24h  │ ██████ │ ███    │ █      │ ███    │ ██████ │
         │ +8.2%  │ +3.1%  │ +0.5%  │ -2.1%  │ -6.5%  │
    ─────┼────────┼────────┼────────┼────────┼────────┤
    7d   │ ██████ │ ██████ │ ███    │ █      │ ███    │
         │ +12.1% │ +9.4%  │ +4.2%  │ +0.8%  │ -3.2%  │
    ─────┼────────┼────────┼────────┼────────┼────────┤
    30d  │ ██████ │ ██████ │ ██████ │ ███    │ █      │
         │ +24.5% │ +18.2% │ +11.3% │ +5.1%  │ +1.2%  │

    Legend: ██████ = Strong Gain  ███ = Moderate  █ = Weak/Loss
```

---

## Appendix: Crystal Geometry Reference

The crystal visualization uses a **hexagonal lattice** structure inspired by real crystal formations:

```
    Hexagonal Lattice (Top View)

         ●───────●───────●
        ╱ ╲     ╱ ╲     ╱ ╲
       ╱   ╲   ╱   ╲   ╱   ╲
      ●─────●─────●─────●─────●
       ╲   ╱ ╲   ╱ ╲   ╱ ╲   ╱
        ╲ ╱   ╲ ╱   ╲ ╱   ╲ ╱
         ●─────●─────●─────●
        ╱ ╲   ╱ ╲   ╱ ╲   ╱ ╲
       ╱   ╲ ╱   ╲ ╱   ╲ ╱   ╲
      ●─────●─────●─────●─────●

    Each node position: (x, y) = (col + 0.5*row, row * √3/2) * spacing
```

This structure naturally groups related cards while maintaining visual clarity and allowing for dynamic rearrangement based on price movements.

---

*Document Version: 1.0*
*Next Review: After Phase 1 completion*
