# PRISM Subdomain Migration Plan

## Migrate Price Tracking to app.cambridgetcg.com

**Status:** Planning
**Target:** Q1 2026
**Author:** Claude Code

---

## Executive Summary

Migrate the PRISM price tracking system from Shopify theme pages to a standalone Next.js application hosted at `app.cambridgetcg.com`. This separation provides:

- **Performance**: No Shopify overhead, optimized caching, faster page loads
- **Independence**: Separate deployment cycles from main store
- **Scalability**: Can scale independently based on traffic
- **Modern Stack**: Full React/Next.js with TypeScript support
- **SEO Control**: Direct control over meta tags, sitemap, structured data

---

## Table of Contents

1. [Architecture Decision](#1-architecture-decision)
2. [Current State Analysis](#2-current-state-analysis)
3. [Target Architecture](#3-target-architecture)
4. [Phase 1: Infrastructure Setup](#phase-1-infrastructure-setup)
5. [Phase 2: API Migration](#phase-2-api-migration)
6. [Phase 3: Frontend Development](#phase-3-frontend-development)
7. [Phase 4: Data & Caching Layer](#phase-4-data--caching-layer)
8. [Phase 5: Testing & QA](#phase-5-testing--qa)
9. [Phase 6: Launch & Cutover](#phase-6-launch--cutover)
10. [Phase 7: Post-Launch](#phase-7-post-launch)
11. [Risk Assessment](#risk-assessment)
12. [Timeline & Resources](#timeline--resources)

---

## 1. Architecture Decision

### Options Evaluated

| Option | Description | Pros | Cons |
|--------|-------------|------|------|
| **A: Standalone Next.js** | New Next.js app, separate Vercel project | Clean separation, modern stack, optimal caching | Code duplication, two codebases |
| **B: Extend CardForum** | Add subdomain routes to existing app | Single codebase, shared utilities | Complex routing, risk to trade-in |
| **C: Static Site + API** | Astro/Vite static build calling CardForum APIs | Very fast, simple | Limited interactivity, CORS setup |

### Recommendation: **Option A - Standalone Next.js Application**

**Rationale:**
1. Price tracking is **read-only** (no mutations to main database)
2. Different traffic patterns than trade-in system
3. Can leverage Next.js App Router with React Server Components
4. Independent caching strategies (ISR, static generation)
5. No risk of affecting core trade-in functionality
6. Can optimize specifically for this use case (SEO, performance)

---

## 2. Current State Analysis

### Frontend Assets (Shopify Theme)
```
ShopifyTheme_TCG/
├── templates/
│   ├── page.price-index.liquid      # Main price index page
│   └── page.card-detail.liquid      # Individual card page
└── assets/
    ├── price-index.js               # 2000+ lines of JS
    ├── price-index.css              # 2700+ lines of CSS
    ├── card-detail.js               # 900+ lines of JS
    └── card-detail.css              # 1200+ lines of CSS
```

### Backend API Endpoints (CardForum)
```
cardforum/app/routes/
├── api.price-index.tsx              # Summary of all indices
├── api.price-index.$type.$key.tsx   # Historical index data
├── api.price-index.card.$cardId.tsx # Card detail + pricing
├── api.price-index.card.$cardId.history.tsx
├── api.price-index.movers.tsx       # Top gainers/losers
├── api.price-index.health.tsx       # Market sentiment
├── api.price-index.network.tsx      # Correlation network
├── api.price-index.crystal.tsx      # Heatmap data
├── api.price-index.tcg100.tsx       # NASDAQ-style index
├── api.price-index.tcg100.compare.tsx
└── api.cards.catalog.tsx            # Card catalog search
```

### Database Tables (11 PRISM-specific)
```
card_prices_v2           # Main price data (from Lambda)
card_price_history       # Historical price snapshots
price_index_snapshots    # Daily index snapshots
price_correlations       # Card correlations
price_sources           # Multi-source pricing
exchange_rate_history   # JPY/GBP rates
index_constituents      # TCG-100 holdings
index_reconstitution    # Monthly rebalancing
index_weight_history    # Weight tracking
```

### External Dependencies
- AWS S3: `pricedata-tcg` bucket (daily_prices.xlsx, pricefeed/*)
- PostgreSQL: AWS RDS `cardforum` database
- Vercel Cron: 6 scheduled jobs
- trading-card-pricer Lambda: Writes to card_prices_v2 (8 AM/PM UTC)

---

## 3. Target Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         CLOUDFLARE DNS                          │
├─────────────────────────────────────────────────────────────────┤
│  cambridgetcg.com (A) → Shopify                                 │
│  app.cambridgetcg.com (CNAME) → prism-app.vercel.app           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    VERCEL (prism-app)                           │
├─────────────────────────────────────────────────────────────────┤
│  Next.js 14+ App Router                                         │
│  ├── app/                                                       │
│  │   ├── page.tsx              # Price Index (SSG + ISR)        │
│  │   ├── card/[id]/page.tsx    # Card Detail (Dynamic)          │
│  │   └── api/                  # Internal API routes            │
│  │       ├── price-index/      # All price endpoints            │
│  │       └── cron/             # Scheduled jobs                 │
│  ├── lib/                                                       │
│  │   ├── price-index.ts        # Migrated from CardForum        │
│  │   ├── tcg100-index.ts                                        │
│  │   ├── s3-prices.ts                                           │
│  │   └── db.ts                 # Prisma client                  │
│  └── components/                                                │
│      ├── Heatmap.tsx                                            │
│      ├── PriceChart.tsx                                         │
│      ├── NetworkGraph.tsx                                       │
│      └── TCG100Table.tsx                                        │
└─────────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┴───────────────┐
              ▼                               ▼
┌─────────────────────────┐     ┌─────────────────────────┐
│     AWS RDS (shared)    │     │      AWS S3             │
│   cardforum database    │     │   pricedata-tcg bucket  │
│                         │     │                         │
│   READ-ONLY ACCESS      │     │   daily_prices.xlsx     │
│   (via DATABASE_URL)    │     │   pricefeed/*.xlsx      │
└─────────────────────────┘     └─────────────────────────┘
```

### Key Design Decisions

1. **Shared Database**: Read from same PostgreSQL database as CardForum
2. **Separate Vercel Project**: Independent deployments and domains
3. **ISR Caching**: Incremental Static Regeneration for price pages
4. **Edge Caching**: Vercel Edge Network for static assets
5. **No Auth Required**: All price data is public (unlike trade-in)

---

## Phase 1: Infrastructure Setup

### 1.1 Create New Vercel Project

```bash
# Create Next.js project
npx create-next-app@latest prism-app --typescript --tailwind --app --src-dir

# Project structure
prism-app/
├── src/
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx           # Price Index
│   │   ├── card/
│   │   │   └── [id]/
│   │   │       └── page.tsx   # Card Detail
│   │   └── api/
│   │       └── [...slug]/
│   │           └── route.ts   # API catch-all
│   ├── lib/
│   ├── components/
│   └── styles/
├── prisma/
│   └── schema.prisma          # Copy from CardForum
├── package.json
├── next.config.js
└── vercel.json
```

### 1.2 DNS Configuration (Cloudflare)

```
Type: CNAME
Name: app
Target: cname.vercel-dns.com
Proxy: DNS only (gray cloud)
TTL: Auto
```

### 1.3 Vercel Domain Setup

```bash
# In Vercel Dashboard
Project Settings → Domains → Add Domain
Domain: app.cambridgetcg.com
```

### 1.4 Environment Variables

```env
# Database (read-only connection recommended)
DATABASE_URL="postgresql://readonly_user:xxx@cardforum.xxx.rds.amazonaws.com/cardforum?sslmode=require"

# AWS S3 Access
AWS_ACCESS_KEY_ID="AKIA..."
AWS_SECRET_ACCESS_KEY="..."
AWS_REGION="us-east-1"
S3_PRICE_BUCKET="pricedata-tcg"

# App Config
NEXT_PUBLIC_SITE_URL="https://app.cambridgetcg.com"
NEXT_PUBLIC_MAIN_SITE="https://cambridgetcg.com"
CRON_SECRET="..." # Same as CardForum or new

# Analytics (optional)
NEXT_PUBLIC_GA_ID="G-XXXXXXX"
```

### 1.5 Create Read-Only Database User (Recommended)

```sql
-- Run on PostgreSQL
CREATE USER prism_readonly WITH PASSWORD 'xxx';
GRANT CONNECT ON DATABASE cardforum TO prism_readonly;
GRANT USAGE ON SCHEMA public TO prism_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO prism_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON TABLES TO prism_readonly;
```

---

## Phase 2: API Migration

### 2.1 API Route Structure

```
src/app/api/
├── price-index/
│   ├── route.ts                    # GET /api/price-index
│   ├── [type]/
│   │   └── [key]/
│   │       └── route.ts            # GET /api/price-index/:type/:key
│   ├── card/
│   │   └── [cardId]/
│   │       ├── route.ts            # GET /api/price-index/card/:id
│   │       └── history/
│   │           └── route.ts        # GET /api/price-index/card/:id/history
│   ├── movers/
│   │   └── route.ts                # GET /api/price-index/movers
│   ├── health/
│   │   └── route.ts                # GET /api/price-index/health
│   ├── network/
│   │   └── route.ts                # GET /api/price-index/network
│   ├── crystal/
│   │   └── route.ts                # GET /api/price-index/crystal
│   └── tcg100/
│       ├── route.ts                # GET /api/price-index/tcg100
│       └── compare/
│           └── route.ts            # GET /api/price-index/tcg100/compare
├── cards/
│   └── catalog/
│       └── route.ts                # GET /api/cards/catalog
└── cron/
    ├── price-snapshot/
    │   └── route.ts                # POST (Vercel Cron)
    ├── price-sync/
    │   └── route.ts
    ├── pricefeed-sync/
    │   └── route.ts
    └── correlation-calc/
        └── route.ts
```

### 2.2 Library Migration

Copy and adapt from CardForum:

| Source File | Target File | Changes Needed |
|-------------|-------------|----------------|
| `app/lib/price-index.server.ts` | `src/lib/price-index.ts` | Remove .server suffix, update imports |
| `app/lib/tcg100-index.server.ts` | `src/lib/tcg100-index.ts` | Same |
| `app/lib/s3-prices.server.ts` | `src/lib/s3-prices.ts` | Same |
| `app/db.server.ts` | `src/lib/db.ts` | Singleton pattern for edge |
| `prisma/schema.prisma` | `prisma/schema.prisma` | Only PRISM tables |

### 2.3 Example API Route Migration

**Before (CardForum - `api.price-index.tsx`):**
```typescript
import { json } from "@remix-run/node";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { validateAppProxy } from "~/lib/app-proxy.server";
import { getAllIndices } from "~/lib/price-index.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const context = await validateAppProxy(request);
  const indices = await getAllIndices();
  return json(indices);
}
```

**After (PRISM App - `src/app/api/price-index/route.ts`):**
```typescript
import { NextResponse } from 'next/server';
import { getAllIndices } from '@/lib/price-index';

export const revalidate = 300; // ISR: 5 minutes

export async function GET() {
  try {
    const indices = await getAllIndices();
    return NextResponse.json(indices, {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=60',
      },
    });
  } catch (error) {
    console.error('Price index error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch price index' },
      { status: 500 }
    );
  }
}
```

### 2.4 Remove App Proxy Authentication

Since this is a public-facing app (not through Shopify), remove HMAC validation:

```typescript
// Old: Required Shopify App Proxy signature
const context = await validateAppProxy(request);

// New: No auth needed for public price data
// Optional: Add rate limiting with Vercel KV or Upstash
import { Ratelimit } from '@upstash/ratelimit';
import { kv } from '@vercel/kv';

const ratelimit = new Ratelimit({
  redis: kv,
  limiter: Ratelimit.slidingWindow(100, '1 m'),
});
```

### 2.5 Cron Job Migration

**vercel.json:**
```json
{
  "crons": [
    { "path": "/api/cron/price-snapshot", "schedule": "0 0 * * *" },
    { "path": "/api/cron/price-sync", "schedule": "0 1 * * *" },
    { "path": "/api/cron/pricefeed-sync", "schedule": "0 2 * * *" },
    { "path": "/api/cron/correlation-calc", "schedule": "0 3 * * 0" }
  ]
}
```

**Cron route example (`src/app/api/cron/price-sync/route.ts`):**
```typescript
import { NextResponse } from 'next/server';
import { syncDailyPrices } from '@/lib/s3-prices';

export async function POST(request: Request) {
  // Verify cron secret
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await syncDailyPrices();
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error('Price sync failed:', error);
    return NextResponse.json({ error: 'Sync failed' }, { status: 500 });
  }
}
```

---

## Phase 3: Frontend Development

### 3.1 Component Architecture

```
src/components/
├── layout/
│   ├── Header.tsx               # Navigation + Currency Toggle
│   ├── Footer.tsx               # Links back to main site
│   └── Sidebar.tsx              # Filters panel
├── price-index/
│   ├── SummaryBar.tsx           # Index summary cards
│   ├── ViewToggle.tsx           # Heatmap/Chart/Table/Network
│   ├── Heatmap/
│   │   ├── Heatmap.tsx          # Main treemap component
│   │   ├── HeatmapLegend.tsx
│   │   └── HeatmapTooltip.tsx
│   ├── Chart/
│   │   ├── PriceChart.tsx       # Chart.js line chart
│   │   └── ChartControls.tsx    # Range selector
│   ├── Table/
│   │   ├── SetsTable.tsx        # Set performance table
│   │   └── TableSorting.tsx
│   ├── Network/
│   │   ├── NetworkGraph.tsx     # Force-directed graph
│   │   └── NetworkLegend.tsx
│   ├── TCG100/
│   │   ├── TCG100Summary.tsx    # NASDAQ-style header
│   │   ├── TCG100Table.tsx      # Constituents table
│   │   └── LanguageComparison.tsx
│   ├── Movers/
│   │   ├── MoversPanel.tsx      # Gainers/Losers/Volume
│   │   └── MoverItem.tsx
│   ├── Alerts/
│   │   ├── AlertsPanel.tsx      # Price alerts sidebar
│   │   ├── AlertModal.tsx       # Add alert modal
│   │   └── AlertItem.tsx
│   ├── Health/
│   │   └── MarketHealth.tsx     # Bull/Bear sentiment
│   └── Volatility/
│       └── VolatilityWidget.tsx # Volatility gauge
├── card-detail/
│   ├── CardHero.tsx             # Image + info section
│   ├── PriceDisplay.tsx         # Current prices + changes
│   ├── PriceHistory.tsx         # Chart + table
│   ├── RelatedCards.tsx         # Similar cards grid
│   └── ShareButton.tsx
└── ui/
    ├── Button.tsx
    ├── Select.tsx
    ├── Modal.tsx
    ├── Spinner.tsx
    └── Tooltip.tsx
```

### 3.2 Page Components

**Price Index Page (`src/app/page.tsx`):**
```tsx
import { Suspense } from 'react';
import { SummaryBar } from '@/components/price-index/SummaryBar';
import { ViewToggle } from '@/components/price-index/ViewToggle';
import { Heatmap } from '@/components/price-index/Heatmap';
import { MoversPanel } from '@/components/price-index/Movers/MoversPanel';
import { TCG100Section } from '@/components/price-index/TCG100';
import { getAllIndices, getCrystalData, getMovers } from '@/lib/price-index';

export const revalidate = 300; // Revalidate every 5 minutes

export default async function PriceIndexPage() {
  const [indices, crystalData, movers] = await Promise.all([
    getAllIndices(),
    getCrystalData({ game: 'onepiece', limit: 150 }),
    getMovers({ limit: 10 }),
  ]);

  return (
    <div className="min-h-screen bg-[#0f1419] text-white">
      <Header />
      <main className="max-w-7xl mx-auto px-4 py-8">
        <h1 className="text-3xl font-bold mb-2">TCG Price Index</h1>
        <p className="text-gray-400 mb-8">
          Real-time market intelligence for trading card games
        </p>

        <Suspense fallback={<SummaryBarSkeleton />}>
          <SummaryBar indices={indices} />
        </Suspense>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6 mt-8">
          <div>
            <ViewToggle defaultView="heatmap" />
            <Suspense fallback={<HeatmapSkeleton />}>
              <Heatmap data={crystalData} />
            </Suspense>
          </div>

          <aside>
            <MarketHealth />
            <Filters />
            <MoversPanel data={movers} />
            <AlertsPanel />
          </aside>
        </div>

        <TCG100Section />
        <SetsTable />
      </main>
      <Footer />
    </div>
  );
}
```

**Card Detail Page (`src/app/card/[id]/page.tsx`):**
```tsx
import { notFound } from 'next/navigation';
import { getCardDetails } from '@/lib/price-index';
import { CardHero } from '@/components/card-detail/CardHero';
import { PriceDisplay } from '@/components/card-detail/PriceDisplay';
import { PriceHistory } from '@/components/card-detail/PriceHistory';
import { RelatedCards } from '@/components/card-detail/RelatedCards';

interface PageProps {
  params: { id: string };
}

export async function generateMetadata({ params }: PageProps) {
  const card = await getCardDetails(params.id);
  if (!card) return { title: 'Card Not Found' };

  return {
    title: `${card.name} Price History | PRISM`,
    description: `Track price history and market data for ${card.name} (${card.fullCardNumber})`,
    openGraph: {
      images: [card.imageUrl],
    },
  };
}

export default async function CardDetailPage({ params }: PageProps) {
  const data = await getCardDetails(params.id);

  if (!data) {
    notFound();
  }

  return (
    <div className="min-h-screen bg-[#0f1419] text-white">
      <Header />
      <main className="max-w-7xl mx-auto px-4 py-8">
        <Breadcrumb card={data.card} />
        <CardHero card={data.card} />
        <PriceDisplay pricing={data.pricing} />
        <PriceHistory history={data.history} />
        <RelatedCards cards={data.related} />
      </main>
      <Footer />
    </div>
  );
}
```

### 3.3 Client Components (Interactive)

For interactive features, use client components:

```tsx
'use client';

import { useState, useEffect } from 'react';
import { Chart } from 'chart.js/auto';

export function PriceChart({ cardId, initialData }) {
  const [range, setRange] = useState(30);
  const [data, setData] = useState(initialData);

  useEffect(() => {
    if (range !== 30) {
      fetch(`/api/price-index/card/${cardId}/history?range=${range}`)
        .then(res => res.json())
        .then(setData);
    }
  }, [range, cardId]);

  // Chart rendering logic...
}
```

### 3.4 Styling Strategy

**Option A: Port existing CSS**
- Copy `price-index.css` and `card-detail.css`
- Use CSS Modules or global styles
- Minimal changes needed

**Option B: Convert to Tailwind (Recommended)**
- Use existing CSS variables as Tailwind theme
- Better tree-shaking and smaller bundle
- Consistent with modern Next.js patterns

```js
// tailwind.config.js
module.exports = {
  theme: {
    extend: {
      colors: {
        'pi-gain-strong': '#00ff88',
        'pi-gain-medium': '#4ade80',
        'pi-loss-medium': '#f87171',
        'pi-loss-strong': '#ff4444',
        'pi-neutral': '#94a3b8',
        'pi-bg': '#0f1419',
        'pi-surface': '#1a1f26',
        'pi-border': '#2d3640',
      },
    },
  },
};
```

---

## Phase 4: Data & Caching Layer

### 4.1 Caching Strategy

```
┌─────────────────────────────────────────────────────────────┐
│                      CACHING LAYERS                         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Browser Cache (client)                                     │
│  └─ Static assets: 1 year                                   │
│  └─ API responses: via Cache-Control headers                │
│                                                             │
│  Vercel Edge Cache (CDN)                                    │
│  └─ ISR pages: s-maxage from revalidate prop                │
│  └─ API routes: Cache-Control headers                       │
│                                                             │
│  In-Memory Cache (server)                                   │
│  └─ Expensive calculations: 5 min TTL                       │
│  └─ Implementation: Map or lru-cache                        │
│                                                             │
│  Database (source of truth)                                 │
│  └─ PostgreSQL with connection pooling                      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 4.2 ISR Configuration

```tsx
// src/app/page.tsx
export const revalidate = 300; // 5 minutes

// src/app/card/[id]/page.tsx
export const revalidate = 60; // 1 minute for individual cards

// Static paths for popular cards
export async function generateStaticParams() {
  const topCards = await getTopCards(100);
  return topCards.map(card => ({ id: card.cardId }));
}
```

### 4.3 API Response Caching

```typescript
// src/app/api/price-index/route.ts
export async function GET() {
  const data = await getAllIndices();

  return NextResponse.json(data, {
    headers: {
      'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=60',
      'CDN-Cache-Control': 'public, max-age=300',
      'Vercel-CDN-Cache-Control': 'public, max-age=300',
    },
  });
}
```

### 4.4 Database Connection Pooling

```typescript
// src/lib/db.ts
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query'] : [],
});

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
```

---

## Phase 5: Testing & QA

### 5.1 Test Matrix

| Feature | Unit Tests | Integration | E2E | Visual |
|---------|-----------|-------------|-----|--------|
| Price calculations | ✓ | ✓ | | |
| API endpoints | ✓ | ✓ | | |
| Heatmap rendering | | | ✓ | ✓ |
| Chart interactions | | | ✓ | |
| Currency toggle | | | ✓ | |
| Price alerts | ✓ | | ✓ | |
| Card detail page | | ✓ | ✓ | ✓ |
| Responsive design | | | | ✓ |

### 5.2 Performance Benchmarks

| Metric | Target | Measurement |
|--------|--------|-------------|
| First Contentful Paint | < 1.2s | Lighthouse |
| Largest Contentful Paint | < 2.5s | Lighthouse |
| Time to Interactive | < 3.5s | Lighthouse |
| Cumulative Layout Shift | < 0.1 | Lighthouse |
| API Response Time | < 200ms | Vercel Analytics |

### 5.3 Load Testing

```bash
# Using k6
k6 run --vus 100 --duration 30s load-test.js
```

### 5.4 Cross-Browser Testing

- Chrome (latest 2 versions)
- Firefox (latest 2 versions)
- Safari (latest 2 versions)
- Mobile Safari (iOS 15+)
- Chrome Mobile (Android 10+)

---

## Phase 6: Launch & Cutover

### 6.1 Pre-Launch Checklist

- [ ] All API endpoints returning correct data
- [ ] ISR caching working correctly
- [ ] Cron jobs executing on schedule
- [ ] SSL certificate issued for app.cambridgetcg.com
- [ ] Error tracking set up (Sentry)
- [ ] Analytics configured (GA4, Vercel Analytics)
- [ ] Performance budgets met
- [ ] SEO meta tags in place
- [ ] Sitemap.xml generated
- [ ] Robots.txt configured
- [ ] Favicon and app icons
- [ ] Open Graph images

### 6.2 Soft Launch (Week 1)

1. Deploy to app.cambridgetcg.com
2. Add link from main site footer: "Price Tracker (Beta)"
3. Monitor error rates and performance
4. Gather user feedback
5. Fix critical issues

### 6.3 Redirect Setup (Week 2)

**Shopify Theme (sections/header.liquid):**
```liquid
{% comment %} Redirect old price index URLs to new subdomain {% endcomment %}
<script>
  if (window.location.pathname === '/pages/price-index') {
    window.location.replace('https://app.cambridgetcg.com/');
  }
  if (window.location.pathname === '/pages/card-detail') {
    const params = new URLSearchParams(window.location.search);
    const cardId = params.get('id');
    if (cardId) {
      window.location.replace(`https://app.cambridgetcg.com/card/${cardId}`);
    }
  }
</script>
```

### 6.4 Full Cutover (Week 3)

1. Update all internal links to use app.cambridgetcg.com
2. Set up 301 redirects from old URLs
3. Update Google Search Console with new sitemap
4. Submit URL change notification
5. Remove old Shopify theme pages (or keep as fallback)

---

## Phase 7: Post-Launch

### 7.1 Monitoring Dashboard

Set up Vercel Analytics and Sentry dashboards:

- Page views by route
- API response times
- Error rates by endpoint
- Cache hit rates
- Core Web Vitals

### 7.2 Deprecate Old Theme Pages

After 30 days with stable traffic:

1. Remove `page.price-index.liquid`
2. Remove `page.card-detail.liquid`
3. Remove `price-index.js`, `price-index.css`
4. Remove `card-detail.js`, `card-detail.css`
5. Keep redirects in place for SEO

### 7.3 Future Enhancements

With the new platform, consider:

- [ ] User accounts for personalized alerts (Clerk/NextAuth)
- [ ] Portfolio tracking feature
- [ ] Price prediction ML models
- [ ] Real-time WebSocket updates
- [ ] PWA support for mobile
- [ ] Push notifications for alerts
- [ ] API access for third parties

---

## Risk Assessment

### High Risk

| Risk | Mitigation |
|------|------------|
| Database overload from new traffic | Read-only user + connection pooling + caching |
| SEO ranking loss during migration | 301 redirects + sitemap update + Search Console |
| Cron job conflicts with CardForum | Stagger schedules by 30 minutes |

### Medium Risk

| Risk | Mitigation |
|------|------------|
| Data inconsistency between systems | Single source of truth (same DB) |
| Feature parity issues | Comprehensive test matrix |
| Cache staleness | Short ISR intervals + manual revalidation |

### Low Risk

| Risk | Mitigation |
|------|------------|
| SSL certificate issues | Automatic with Vercel |
| DNS propagation delays | Low TTL during transition |

---

## Timeline & Resources

### Estimated Timeline

| Phase | Duration | Dependencies |
|-------|----------|--------------|
| Phase 1: Infrastructure | 2-3 days | DNS access, Vercel account |
| Phase 2: API Migration | 5-7 days | Phase 1 complete |
| Phase 3: Frontend | 7-10 days | Phase 2 complete |
| Phase 4: Caching | 2-3 days | Phase 3 complete |
| Phase 5: Testing | 3-5 days | Phase 4 complete |
| Phase 6: Launch | 1-2 weeks | Phase 5 complete |
| **Total** | **4-6 weeks** | |

### Resource Requirements

- Developer time: ~120-160 hours
- Vercel Pro plan: Included (existing)
- DNS changes: Cloudflare (existing)
- Database: No additional cost (shared)
- Monitoring: Sentry free tier / Vercel Analytics

---

## Appendix A: File Migration Checklist

### From CardForum (Backend)
- [ ] `app/lib/price-index.server.ts`
- [ ] `app/lib/tcg100-index.server.ts`
- [ ] `app/lib/s3-prices.server.ts`
- [ ] `app/lib/observability.server.ts`
- [ ] `prisma/schema.prisma` (PRISM tables only)
- [ ] All `api.price-index*.tsx` routes

### From ShopifyTheme (Frontend)
- [ ] `assets/price-index.js` → React components
- [ ] `assets/price-index.css` → Tailwind/CSS Modules
- [ ] `assets/card-detail.js` → React components
- [ ] `assets/card-detail.css` → Tailwind/CSS Modules
- [ ] `templates/page.price-index.liquid` → `src/app/page.tsx`
- [ ] `templates/page.card-detail.liquid` → `src/app/card/[id]/page.tsx`

---

## Appendix B: API Endpoint Mapping

| Old (CardForum App Proxy) | New (PRISM Direct) |
|---------------------------|-------------------|
| `/apps/trade-in/price-index` | `/api/price-index` |
| `/apps/trade-in/price-index/:type/:key` | `/api/price-index/:type/:key` |
| `/apps/trade-in/price-index/card/:id` | `/api/price-index/card/:id` |
| `/apps/trade-in/price-index/card/:id/history` | `/api/price-index/card/:id/history` |
| `/apps/trade-in/price-index/movers` | `/api/price-index/movers` |
| `/apps/trade-in/price-index/health` | `/api/price-index/health` |
| `/apps/trade-in/price-index/network` | `/api/price-index/network` |
| `/apps/trade-in/price-index/crystal` | `/api/price-index/crystal` |
| `/apps/trade-in/price-index/tcg100` | `/api/price-index/tcg100` |
| `/apps/trade-in/price-index/tcg100/compare` | `/api/price-index/tcg100/compare` |
| `/apps/trade-in/cards/catalog` | `/api/cards/catalog` |
