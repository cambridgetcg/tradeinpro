# Raffle & Prize Draw System

**Project Codename:** FORTUNE
**Date:** 2026-01-06
**Status:** Planning Phase

---

## Vision

Create an engaging raffle ticket system where members earn tickets through purchases, trade-ins, and activities, then enter prize draws for exclusive TCG products, store credit, and rare cards. The system visualizes as a **crystal lottery lattice** - tickets flow like energy through the network, converging on prize nodes during draws.

```
                    ╭─────────────────────────────────────────╮
                    │      FORTUNE: Raffle Ticket System       │
                    │     Prize Draw & Rewards Manifold        │
                    ╰─────────────────────────────────────────╯
                                       │
          ┌────────────────────────────┼────────────────────────────┐
          │                            │                            │
          ▼                            ▼                            ▼
┌──────────────────┐        ┌──────────────────┐        ┌──────────────────┐
│  TICKET ENGINE   │        │   DRAW ORACLE    │        │  PRIZE TREASURY  │
│                  │        │                  │        │                  │
│ • Earn Rules     │        │ • Draw Scheduler │        │ • Prize Catalog  │
│ • Balance Track  │        │ • Random Select  │        │ • Winner Fulfill │
│ • Transaction    │        │ • Entry Valid    │        │ • Notification   │
│ • Audit Trail    │        │ • Result Record  │        │ • Claim Process  │
└──────────────────┘        └──────────────────┘        └──────────────────┘
          │                            │                            │
          └────────────────────────────┼────────────────────────────┘
                                       │
                                       ▼
                          ┌─────────────────────┐
                          │   MEMBER PORTAL     │
                          │                     │
                          │ • Ticket Balance    │
                          │ • Active Draws      │
                          │ • Entry History     │
                          │ • Prize Claims      │
                          └─────────────────────┘
```

---

## Part 1: Crystal Neural Network Visualization

### 1.1 The Lottery Lattice

The raffle system visualizes as an interconnected crystal where energy (tickets) flows from earning sources through members to prize draw nodes.

```
                           FORTUNE CRYSTAL LATTICE

                     ╭─────────────────────────────────╮
                     │         PRIZE NUCLEUS           │
                     │                                 │
                     │    ★ Grand Prize (Booster Box) │
                     │   ◆ Runner Up (Store Credit)   │
                     │   ● Consolation (Promo Cards)  │
                     ╰───────────────┬─────────────────╯
                                     │
                    ┌────────────────┼────────────────┐
                    │                │                │
                    ▼                ▼                ▼
              ╭──────────╮    ╭──────────╮    ╭──────────╮
              │ DRAW #1  │    │ DRAW #2  │    │ DRAW #3  │
              │ Monthly  │    │ Weekly   │    │ Special  │
              │ ════════ │    │ ════════ │    │ ════════ │
              │ 🎟️ 1,234  │    │ 🎟️ 456   │    │ 🎟️ 89    │
              │ entries  │    │ entries  │    │ entries  │
              ╰────┬─────╯    ╰────┬─────╯    ╰────┬─────╯
                   │               │               │
     ┌─────────────┼───────────────┼───────────────┼─────────────┐
     │             │               │               │             │
     ▼             ▼               ▼               ▼             ▼
   ┌───┐         ┌───┐           ┌───┐           ┌───┐         ┌───┐
   │👤 │─────────│👤 │───────────│👤 │───────────│👤 │─────────│👤 │
   │M1 │         │M2 │           │M3 │           │M4 │         │M5 │
   │🎟️12│         │🎟️45│           │🎟️8 │           │🎟️23│         │🎟️67│
   └─┬─┘         └─┬─┘           └─┬─┘           └─┬─┘         └─┬─┘
     │             │               │               │             │
     └──────┬──────┴───────┬───────┴───────┬──────┴──────┬──────┘
            │              │               │              │
            ▼              ▼               ▼              ▼
      ╭──────────╮   ╭──────────╮   ╭──────────╮   ╭──────────╮
      │ PURCHASE │   │ TRADE-IN │   │ REFERRAL │   │  BONUS   │
      │  +1/£10  │   │  +5/sub  │   │   +10    │   │ Birthday │
      ╰──────────╯   ╰──────────╯   ╰──────────╯   ╰──────────╯

              ═══════════════════════════════════════
                     TICKET SOURCE LAYER
              ═══════════════════════════════════════
```

### 1.2 Visual Elements

| Element | Represents | Visual Properties |
|---------|------------|-------------------|
| **★ Star** | Grand Prize | Large, golden glow, pulsing |
| **◆ Diamond** | Runner-up Prize | Medium, silver glow |
| **● Circle** | Consolation Prize | Small, bronze |
| **🎟️ Ticket** | Entry ticket | Flowing particle, color = source |
| **👤 Member** | Customer node | Size = ticket count, glow = activity |
| **═ Edge** | Ticket flow | Animated particles, thickness = volume |
| **Draw Node** | Active raffle | Spinning, attracting ticket particles |

### 1.3 Animation Concepts

```javascript
const FORTUNE_ANIMATIONS = {
  // Tickets flowing from source to member
  TICKET_EARN: {
    type: 'particle_flow',
    duration: 1500,
    path: 'bezier',
    color: {
      PURCHASE: '#4ade80',   // Green - purchase
      TRADE_IN: '#3b82f6',   // Blue - trade-in
      REFERRAL: '#f59e0b',   // Amber - referral
      BONUS: '#8b5cf6',      // Purple - bonus
    }
  },

  // Tickets entering a draw
  TICKET_ENTER: {
    type: 'spiral_in',
    duration: 800,
    easing: 'easeInQuad',
    target: 'draw_node'
  },

  // Draw happening - spinning selection
  DRAW_SPIN: {
    type: 'roulette',
    duration: 5000,
    acceleration: 'ease_out',
    highlight: 'winner_pulse'
  },

  // Winner announcement - explosion
  WINNER_REVEAL: {
    type: 'burst',
    duration: 2000,
    particles: 50,
    colors: ['#ffd700', '#ff6b6b', '#4ecdc4']
  },

  // Ambient crystal breathing
  LATTICE_PULSE: {
    type: 'ambient',
    frequency: 0.3,
    amplitude: 0.08
  }
};
```

### 1.4 Color Scheme

```css
:root {
  /* Ticket Source Colors */
  --fortune-purchase: #4ade80;    /* Green - money spent */
  --fortune-tradein: #3b82f6;     /* Blue - cards traded */
  --fortune-referral: #f59e0b;    /* Amber - friend referred */
  --fortune-bonus: #8b5cf6;       /* Purple - special bonus */
  --fortune-membership: #ec4899;  /* Pink - tier bonus */

  /* Prize Tier Colors */
  --fortune-grand: #ffd700;       /* Gold - grand prize */
  --fortune-runner: #c0c0c0;      /* Silver - runner up */
  --fortune-consolation: #cd7f32; /* Bronze - consolation */

  /* Status Colors */
  --fortune-active: #22c55e;      /* Draw open */
  --fortune-pending: #eab308;     /* Draw pending */
  --fortune-completed: #6b7280;   /* Draw finished */
  --fortune-won: #10b981;         /* Winner! */

  /* Background */
  --fortune-bg: #0c1222;
  --fortune-surface: #1a2332;
  --fortune-glow: rgba(59, 130, 246, 0.3);
}
```

---

## Part 2: Data Architecture

### 2.1 Prisma Models

```prisma
// ============================================================================
// RAFFLE SYSTEM (FORTUNE)
// Ticket earning, prize draws, and winner management
// ============================================================================

// Raffle ticket balance and transaction history
model RaffleTicket {
  id              String   @id @default(cuid())

  // Owner
  customerId      String   @map("customer_id")
  customer        Customer @relation(fields: [customerId], references: [id])

  // Transaction details
  amount          Int                    // Positive = earned, Negative = spent
  balance         Int                    // Running balance after transaction

  // Source tracking
  source          String                 // PURCHASE, TRADE_IN, REFERRAL, BONUS, MEMBERSHIP, MANUAL
  sourceRef       String?  @map("source_ref")  // Order ID, Submission ID, etc.
  description     String?                // Human-readable description

  // Expiry (optional - tickets can expire)
  expiresAt       DateTime? @map("expires_at")

  // Timestamps
  createdAt       DateTime @default(now()) @map("created_at")

  @@index([customerId])
  @@index([source])
  @@index([createdAt])
  @@index([expiresAt])
  @@map("raffle_tickets")
}

// Prize draw events
model RaffleDraw {
  id              String   @id @default(cuid())

  // Draw identification
  name            String                 // "January 2026 Grand Draw"
  slug            String   @unique       // "jan-2026-grand"
  description     String?  @db.Text

  // Draw type and rules
  drawType        String   @map("draw_type")  // MONTHLY, WEEKLY, SPECIAL, FLASH
  ticketCost      Int      @default(1) @map("ticket_cost")  // Tickets per entry
  maxEntriesPerCustomer Int? @map("max_entries_per_customer")  // Null = unlimited
  minTicketsToEnter Int    @default(1) @map("min_tickets_to_enter")

  // Prizes (JSON array of prize tiers)
  // [{ tier: "GRAND", name: "OP09 Booster Box", quantity: 1, value: 9999 }, ...]
  prizes          String   @db.Text      // JSON

  // Schedule
  startsAt        DateTime @map("starts_at")
  endsAt          DateTime @map("ends_at")
  drawAt          DateTime @map("draw_at")  // When winner is selected

  // Status
  status          String   @default("SCHEDULED")  // SCHEDULED, OPEN, DRAWING, COMPLETED, CANCELLED

  // Results (set after draw)
  totalEntries    Int?     @map("total_entries")
  totalTickets    Int?     @map("total_tickets")
  winnerSeed      String?  @map("winner_seed")  // Random seed for verification

  // Media
  imageUrl        String?  @map("image_url")
  bannerUrl       String?  @map("banner_url")

  // Timestamps
  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @updatedAt @map("updated_at")
  completedAt     DateTime? @map("completed_at")

  // Relations
  entries         RaffleEntry[]
  winners         RaffleWinner[]

  @@index([status])
  @@index([drawType])
  @@index([startsAt])
  @@index([endsAt])
  @@map("raffle_draws")
}

// Customer entries into draws
model RaffleEntry {
  id              String   @id @default(cuid())

  // Participants
  customerId      String   @map("customer_id")
  customer        Customer @relation(fields: [customerId], references: [id])
  drawId          String   @map("draw_id")
  draw            RaffleDraw @relation(fields: [drawId], references: [id])

  // Entry details
  ticketsSpent    Int      @map("tickets_spent")  // How many tickets used
  entryCount      Int      @default(1) @map("entry_count")  // Number of entries

  // Entry numbers (for display)
  // JSON array: ["F-JAN26-00001", "F-JAN26-00002", ...]
  entryNumbers    String   @map("entry_numbers") @db.Text

  // Timestamps
  enteredAt       DateTime @default(now()) @map("entered_at")

  @@unique([customerId, drawId])  // One entry record per customer per draw
  @@index([drawId])
  @@index([customerId])
  @@map("raffle_entries")
}

// Winners of draws
model RaffleWinner {
  id              String   @id @default(cuid())

  // Winner details
  customerId      String   @map("customer_id")
  customer        Customer @relation(fields: [customerId], references: [id])
  drawId          String   @map("draw_id")
  draw            RaffleDraw @relation(fields: [drawId], references: [id])
  entryId         String   @map("entry_id")

  // Prize details
  prizeTier       String   @map("prize_tier")  // GRAND, RUNNER_UP, CONSOLATION
  prizeName       String   @map("prize_name")
  prizeValue      Int      @map("prize_value")  // In pence

  // Winning entry
  winningNumber   String   @map("winning_number")  // Which entry number won

  // Fulfillment
  status          String   @default("PENDING")  // PENDING, NOTIFIED, CLAIMED, SHIPPED, DELIVERED
  claimedAt       DateTime? @map("claimed_at")
  shippedAt       DateTime? @map("shipped_at")
  trackingNumber  String?  @map("tracking_number")

  // For store credit prizes
  giftCardId      String?  @map("gift_card_id")
  giftCardCode    String?  @map("gift_card_code")

  // Notes
  notes           String?  @db.Text

  // Timestamps
  wonAt           DateTime @default(now()) @map("won_at")
  updatedAt       DateTime @updatedAt @map("updated_at")

  @@index([customerId])
  @@index([drawId])
  @@index([status])
  @@map("raffle_winners")
}

// Earning rules configuration
model RaffleEarningRule {
  id              String   @id @default(cuid())

  // Rule identification
  name            String                 // "Purchase Reward"
  source          String   @unique       // PURCHASE, TRADE_IN, REFERRAL, etc.

  // Earning formula
  // For PURCHASE: ticketsPerPound = amount spent / threshold
  // For TRADE_IN: flat tickets per submission
  calculationType String   @map("calculation_type")  // PER_POUND, FLAT, PERCENTAGE
  threshold       Int?                   // E.g., £10 per ticket
  ticketsAwarded  Int      @map("tickets_awarded")  // Base tickets

  // Caps
  maxPerTransaction Int?   @map("max_per_transaction")  // Max tickets per single transaction
  maxPerDay       Int?     @map("max_per_day")
  maxPerMonth     Int?     @map("max_per_month")

  // Bonus multipliers (JSON)
  // { "VIP": 2.0, "GOLD": 1.5, "SILVER": 1.2 }
  tierMultipliers String?  @map("tier_multipliers")

  // Status
  isActive        Boolean  @default(true) @map("is_active")

  // Timestamps
  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @updatedAt @map("updated_at")

  @@map("raffle_earning_rules")
}
```

### 2.2 Customer Model Extension

```prisma
// Add to existing Customer model
model Customer {
  // ... existing fields ...

  // Raffle relations
  raffleTickets   RaffleTicket[]
  raffleEntries   RaffleEntry[]
  raffleWins      RaffleWinner[]
}
```

---

## Part 3: Ticket Earning Mechanisms

### 3.1 Earning Sources

| Source | Trigger | Default Reward | Notes |
|--------|---------|----------------|-------|
| **PURCHASE** | Shopify order paid | 1 ticket per £10 | Excludes shipping |
| **TRADE_IN** | Submission approved | 5 tickets + 1 per £20 value | Based on final value |
| **REFERRAL** | Referred friend's first purchase | 10 tickets | One-time per referral |
| **SIGNUP** | Account creation | 3 tickets | Welcome bonus |
| **BIRTHDAY** | Customer's birthday | 5 tickets | Annual, requires DOB |
| **REVIEW** | Product review submitted | 2 tickets | Max 5 per month |
| **SOCIAL** | Social media engagement | 1-5 tickets | Manual/campaign |
| **MEMBERSHIP** | Monthly tier bonus | VIP: 20, Gold: 10, Silver: 5 | Recurring |
| **MANUAL** | Admin award | Variable | For special cases |

### 3.2 Earning Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        TICKET EARNING PIPELINE                          │
└─────────────────────────────────────────────────────────────────────────┘

    ┌──────────────┐      ┌──────────────┐      ┌──────────────┐
    │   TRIGGERS   │      │   CALCULATE  │      │   RECORD     │
    │              │      │              │      │              │
    │ • Webhook    │ ───▶ │ • Get Rules  │ ───▶ │ • Create Tx  │
    │ • Cron Job   │      │ • Apply Mult │      │ • Update Bal │
    │ • API Call   │      │ • Check Caps │      │ • Notify     │
    │ • Manual     │      │ • Validate   │      │ • Log Audit  │
    └──────────────┘      └──────────────┘      └──────────────┘
           │                     │                     │
           ▼                     ▼                     ▼
    ╔══════════════╗      ╔══════════════╗      ╔══════════════╗
    ║   SHOPIFY    ║      ║   EARNING    ║      ║   RAFFLE     ║
    ║   WEBHOOKS   ║      ║   RULES      ║      ║   TICKETS    ║
    ╠══════════════╣      ╠══════════════╣      ╠══════════════╣
    ║ orders/paid  ║      ║ PURCHASE:    ║      ║ customer_id  ║
    ║ customers/   ║      ║  £10 = 1 🎟️   ║      ║ amount: +5   ║
    ║   create     ║      ║ TRADE_IN:    ║      ║ balance: 47  ║
    ║ refunds/     ║      ║  5 + £20 = 1 ║      ║ source: ...  ║
    ║   create     ║      ║ VIP: 2x mult ║      ║ source_ref   ║
    ╚══════════════╝      ╚══════════════╝      ╚══════════════╝
```

### 3.3 Ticket Calculation Examples

```typescript
// Purchase: £89.99 order
// Rule: 1 ticket per £10, VIP gets 2x
const purchaseTickets = Math.floor(89.99 / 10) * (isVIP ? 2 : 1);
// Regular: 8 tickets, VIP: 16 tickets

// Trade-In: £45.50 approved submission
// Rule: 5 base + 1 per £20 value
const tradeInTickets = 5 + Math.floor(45.50 / 20);
// Result: 7 tickets

// Referral: Friend made first purchase
// Rule: 10 tickets flat
const referralTickets = 10;
```

---

## Part 4: Prize Draw Mechanics

### 4.1 Draw Types

| Type | Frequency | Entry Cost | Typical Prizes |
|------|-----------|------------|----------------|
| **MONTHLY** | 1st of month | 5 tickets | Booster Box, Store Credit |
| **WEEKLY** | Every Friday | 2 tickets | Promo Cards, Sleeves |
| **SPECIAL** | Events/Holidays | 10 tickets | Rare Singles, Signed Items |
| **FLASH** | Random 24hr | 1 ticket | Small prizes, high odds |

### 4.2 Draw Process

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          DRAW LIFECYCLE                                  │
└─────────────────────────────────────────────────────────────────────────┘

    SCHEDULED          OPEN              DRAWING           COMPLETED
    ─────────────────────────────────────────────────────────────────▶
         │                │                  │                  │
         │                │                  │                  │
    ┌────┴────┐      ┌────┴────┐        ┌────┴────┐        ┌────┴────┐
    │ Created │      │ Entries │        │ Random  │        │ Winners │
    │ by Admin│ ───▶ │ Accepted│  ───▶  │ Select  │  ───▶  │ Notified│
    │         │      │         │        │         │        │         │
    │ Set     │      │ Tickets │        │ Verify  │        │ Prizes  │
    │ prizes, │      │ deducted│        │ seed &  │        │ fulfill │
    │ dates   │      │ entries │        │ record  │        │         │
    └─────────┘      └─────────┘        └─────────┘        └─────────┘
         │                │                  │                  │
         ▼                ▼                  ▼                  ▼
    "Coming Soon"   "Enter Now!"      "Drawing..."      "View Winners"
```

### 4.3 Winner Selection Algorithm

```typescript
interface DrawResult {
  draw: RaffleDraw;
  winners: Winner[];
  seed: string;
  timestamp: Date;
}

async function selectWinners(drawId: string): Promise<DrawResult> {
  const draw = await getDraw(drawId);
  const entries = await getAllEntries(drawId);
  const prizes = JSON.parse(draw.prizes);

  // Generate cryptographically secure seed
  const seed = crypto.randomBytes(32).toString('hex');
  const rng = seedrandom(seed);

  // Build weighted entry pool
  // Each ticket = one chance
  const entryPool: string[] = [];
  for (const entry of entries) {
    const numbers = JSON.parse(entry.entryNumbers);
    entryPool.push(...numbers);
  }

  // Shuffle pool
  for (let i = entryPool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [entryPool[i], entryPool[j]] = [entryPool[j], entryPool[i]];
  }

  // Select winners (remove from pool after selection)
  const winners: Winner[] = [];
  const usedCustomers = new Set<string>();

  for (const prize of prizes) {
    for (let q = 0; q < prize.quantity; q++) {
      // Find next entry not already winning
      const winningNumber = entryPool.find(num => {
        const entry = entries.find(e =>
          JSON.parse(e.entryNumbers).includes(num)
        );
        return entry && !usedCustomers.has(entry.customerId);
      });

      if (winningNumber) {
        const winningEntry = entries.find(e =>
          JSON.parse(e.entryNumbers).includes(winningNumber)
        );

        winners.push({
          customerId: winningEntry.customerId,
          entryId: winningEntry.id,
          prizeTier: prize.tier,
          prizeName: prize.name,
          prizeValue: prize.value,
          winningNumber,
        });

        usedCustomers.add(winningEntry.customerId);
      }
    }
  }

  return { draw, winners, seed, timestamp: new Date() };
}
```

---

## Part 5: API Endpoints

### 5.1 Endpoint Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          API ROUTES                                      │
└─────────────────────────────────────────────────────────────────────────┘

PUBLIC (App Proxy - /apps/trade-in/raffle/...)
├── GET  /balance              → Current ticket balance
├── GET  /history              → Ticket transaction history
├── GET  /draws                → Active and upcoming draws
├── GET  /draws/:slug          → Single draw details
├── POST /draws/:slug/enter    → Enter a draw (spend tickets)
├── GET  /my-entries           → Customer's entries
├── GET  /my-wins              → Customer's wins
└── GET  /winners/:drawId      → Public winner list

ADMIN (Authenticated - /api/admin/raffle/...)
├── POST /draws                → Create new draw
├── PUT  /draws/:id            → Update draw
├── POST /draws/:id/execute    → Run the draw
├── POST /tickets/award        → Manual ticket award
├── PUT  /winners/:id/fulfill  → Mark prize shipped
└── GET  /analytics            → Raffle statistics
```

### 5.2 Key Endpoint Schemas

```typescript
// GET /apps/trade-in/raffle/balance
interface BalanceResponse {
  balance: number;
  pendingExpiry: {
    amount: number;
    expiresAt: string;
  } | null;
  recentTransactions: Array<{
    id: string;
    amount: number;
    source: string;
    description: string;
    createdAt: string;
  }>;
}

// GET /apps/trade-in/raffle/draws
interface DrawsResponse {
  active: RaffleDrawSummary[];
  upcoming: RaffleDrawSummary[];
  recent: RaffleDrawSummary[];
}

interface RaffleDrawSummary {
  id: string;
  name: string;
  slug: string;
  drawType: string;
  ticketCost: number;
  startsAt: string;
  endsAt: string;
  drawAt: string;
  status: string;
  imageUrl: string | null;
  prizes: PrizeTier[];
  stats: {
    totalEntries: number;
    myEntries: number;
  };
}

// POST /apps/trade-in/raffle/draws/:slug/enter
interface EnterDrawRequest {
  ticketCount: number;  // How many tickets to spend
}

interface EnterDrawResponse {
  success: boolean;
  entry: {
    id: string;
    ticketsSpent: number;
    entryCount: number;
    entryNumbers: string[];
  };
  newBalance: number;
}
```

---

## Part 6: Frontend Pages

### 6.1 Page Structure

```
┌─────────────────────────────────────────────────────────────────────────┐
│  HEADER: Raffle Hub - Your Lucky Tickets                                │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                     TICKET BALANCE CARD                          │   │
│  │                                                                  │   │
│  │    🎟️ YOUR TICKETS                                               │   │
│  │    ══════════════                                               │   │
│  │         ╔═══════════════╗                                       │   │
│  │         ║      47       ║   [How to Earn More]                  │   │
│  │         ║   TICKETS     ║                                       │   │
│  │         ╚═══════════════╝                                       │   │
│  │                                                                  │   │
│  │    ⚡ 5 tickets expiring in 12 days                              │   │
│  │                                                                  │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                      ACTIVE DRAWS                                │   │
│  │                                                                  │   │
│  │  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐    │   │
│  │  │ 🏆 JANUARY     │  │ 🎁 WEEKLY      │  │ ⚡ FLASH       │    │   │
│  │  │ GRAND DRAW     │  │ DRAW #4        │  │ 24HR SPECIAL   │    │   │
│  │  │                │  │                │  │                │    │   │
│  │  │ OP09 Box       │  │ Promo Pack     │  │ Mystery Prize  │    │   │
│  │  │ + £50 Credit   │  │ + Sleeves      │  │                │    │   │
│  │  │                │  │                │  │                │    │   │
│  │  │ Cost: 5🎟️      │  │ Cost: 2🎟️      │  │ Cost: 1🎟️      │    │   │
│  │  │ Ends: 5d 12h   │  │ Ends: 2d 4h    │  │ Ends: 18h 32m  │    │   │
│  │  │                │  │                │  │                │    │   │
│  │  │ Your entries: 3│  │ Your entries: 0│  │ Your entries: 5│    │   │
│  │  │                │  │                │  │                │    │   │
│  │  │ [Enter Draw]   │  │ [Enter Draw]   │  │ [+ Add Entry]  │    │   │
│  │  └────────────────┘  └────────────────┘  └────────────────┘    │   │
│  │                                                                  │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌────────────────────────────┐  ┌─────────────────────────────────┐   │
│  │    MY ENTRY HISTORY        │  │      RECENT WINNERS             │   │
│  │                            │  │                                 │   │
│  │ ┌────────────────────────┐ │  │ 🏆 John D. won OP09 Box         │   │
│  │ │ January Grand Draw     │ │  │    Weekly Draw #3               │   │
│  │ │ 3 entries (15 tickets) │ │  │                                 │   │
│  │ │ Status: ⏳ Pending     │ │  │ 🎁 Sarah M. won Promo Pack      │   │
│  │ │ Draw: Jan 31 @ 8pm     │ │  │    Weekly Draw #3               │   │
│  │ └────────────────────────┘ │  │                                 │   │
│  │                            │  │ 🏆 Alex K. won Starter Deck     │   │
│  │ ┌────────────────────────┐ │  │    Flash Draw                   │   │
│  │ │ Weekly Draw #3         │ │  │                                 │   │
│  │ │ 2 entries (4 tickets)  │ │  │ [View All Winners →]            │   │
│  │ │ Status: ❌ Not Won     │ │  │                                 │   │
│  │ └────────────────────────┘ │  └─────────────────────────────────┘   │
│  │                            │                                        │
│  │ [View All History →]       │                                        │
│  └────────────────────────────┘                                        │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                     HOW TO EARN TICKETS                          │   │
│  │                                                                  │   │
│  │   💳 SHOP         📦 TRADE-IN       👥 REFER        🎂 BONUS    │   │
│  │   1🎟️ per £10     5🎟️ + 1 per £20   10🎟️ per friend  5🎟️ birthday│   │
│  │                                                                  │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 6.2 Entry Modal

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                              [×]        │
│                                                                         │
│                        ENTER JANUARY GRAND DRAW                         │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                                                                  │   │
│  │                    [Prize Image: OP09 Box]                       │   │
│  │                                                                  │   │
│  │    🏆 Grand Prize: OP09 Booster Box (36 packs)                   │   │
│  │    🥈 Runner Up: £50 Store Credit                                │   │
│  │    🥉 10× Consolation: Promo Card Pack                           │   │
│  │                                                                  │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│       Your Balance: 47 🎟️         Entry Cost: 5 🎟️ each               │
│                                                                         │
│       ┌─────────────────────────────────────────────────────────┐      │
│       │                                                          │      │
│       │   How many entries?                                      │      │
│       │                                                          │      │
│       │      [ − ]    ╔═══════╗    [ + ]                        │      │
│       │               ║   3   ║                                  │      │
│       │               ╚═══════╝                                  │      │
│       │                                                          │      │
│       │   Total Cost: 15 🎟️                                      │      │
│       │   Remaining Balance: 32 🎟️                               │      │
│       │                                                          │      │
│       └─────────────────────────────────────────────────────────┘      │
│                                                                         │
│       ┌─────────────────────────────────────────────────────────┐      │
│       │                                                          │      │
│       │              [ 🎰 ENTER DRAW ]                           │      │
│       │                                                          │      │
│       └─────────────────────────────────────────────────────────┘      │
│                                                                         │
│       📊 1,234 entries so far • Draw: Jan 31, 2026 @ 8:00 PM           │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 6.3 Winner Announcement

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│                          🎉 CONGRATULATIONS! 🎉                         │
│                                                                         │
│                     ╔═══════════════════════════════╗                   │
│                     ║                               ║                   │
│                     ║      ★ YOU WON! ★            ║                   │
│                     ║                               ║                   │
│                     ║    RUNNER UP PRIZE            ║                   │
│                     ║    £50 Store Credit           ║                   │
│                     ║                               ║                   │
│                     ║    January Grand Draw         ║                   │
│                     ║    Entry #F-JAN26-00847       ║                   │
│                     ║                               ║                   │
│                     ╚═══════════════════════════════╝                   │
│                                                                         │
│             Your prize will be automatically added to                   │
│             your account within 24 hours.                               │
│                                                                         │
│                     [ View My Prizes ]                                  │
│                                                                         │
│       ─────────────────────────────────────────────────────────        │
│                                                                         │
│       Share your win!                                                   │
│       [ Twitter ] [ Facebook ] [ Copy Link ]                            │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Part 7: Implementation Phases

### Phase 1: Data Foundation
- [ ] Add Prisma models (RaffleTicket, RaffleDraw, RaffleEntry, RaffleWinner, RaffleEarningRule)
- [ ] Extend Customer model with raffle relations
- [ ] Create raffle-tickets.server.ts for balance management
- [ ] Create raffle-draws.server.ts for draw management
- [ ] Implement basic API endpoints (balance, history)

### Phase 2: Ticket Earning
- [ ] Implement earning rules engine
- [ ] Add Shopify webhook handler for orders/paid
- [ ] Integrate with trade-in submission flow
- [ ] Create manual ticket award admin endpoint
- [ ] Add transaction audit logging

### Phase 3: Prize Draws
- [ ] Implement draw creation and management
- [ ] Create entry submission flow
- [ ] Build winner selection algorithm
- [ ] Add draw execution cron job
- [ ] Implement winner notification system

### Phase 4: Frontend - Raffle Hub
- [ ] Upgrade page.my-raffles.liquid with new API
- [ ] Build ticket balance component
- [ ] Create active draws grid
- [ ] Implement entry modal with ticket spending
- [ ] Add entry history section

### Phase 5: Frontend - Crystal Visualization
- [ ] Create fortune-crystal.js visualization engine
- [ ] Implement ticket flow animations
- [ ] Add draw countdown and status indicators
- [ ] Build winner celebration animation
- [ ] Add ambient lattice effects

### Phase 6: Advanced Features
- [ ] Implement ticket expiry system
- [ ] Add referral tracking integration
- [ ] Create membership tier bonuses
- [ ] Build admin dashboard for raffle management
- [ ] Add analytics and reporting

---

## Part 8: Integration Points

### 8.1 Trade-In Integration

```typescript
// In submissions.server.ts - After submission approved
async function onSubmissionApproved(submission: TradeInSubmission) {
  // Calculate tickets based on final value
  const finalValuePounds = submission.finalTotal / 100;
  const baseTickets = 5;
  const valueTickets = Math.floor(finalValuePounds / 20);
  const totalTickets = baseTickets + valueTickets;

  await awardTickets({
    customerId: submission.customerId,
    amount: totalTickets,
    source: 'TRADE_IN',
    sourceRef: submission.id,
    description: `Trade-in ${submission.submissionNumber} approved (£${finalValuePounds.toFixed(2)})`,
  });
}
```

### 8.2 Shopify Webhook Integration

```typescript
// Webhook: orders/paid
async function handleOrderPaid(order: ShopifyOrder) {
  const customer = await getCustomerByShopifyId(order.customer.id);
  if (!customer) return;

  // Calculate tickets (exclude shipping, discounts already applied)
  const subtotal = parseFloat(order.subtotal_price);
  const tickets = Math.floor(subtotal / 10);

  if (tickets > 0) {
    await awardTickets({
      customerId: customer.id,
      amount: tickets,
      source: 'PURCHASE',
      sourceRef: order.id.toString(),
      description: `Order ${order.name} (£${subtotal.toFixed(2)})`,
    });
  }
}
```

---

## Appendix: ASCII Crystal Reference

```
                    FORTUNE LOTTERY LATTICE - FULL VIEW

                              ★ GRAND PRIZE
                             ╱│╲
                            ╱ │ ╲
                           ╱  │  ╲
                      ◆───────┼───────◆
                     ╱│╲      │      ╱│╲
                    ╱ │ ╲     │     ╱ │ ╲
                   ●──┼──●    │    ●──┼──●
                      │       │       │
            ╭─────────┼───────┼───────┼─────────╮
            │    DRAW │  DRAW │  DRAW │    DRAW │
            │   #001  │  #002 │  #003 │   #004  │
            ╰─────────┼───────┼───────┼─────────╯
                      │       │       │
          ┌───────────┼───────┼───────┼───────────┐
          │           │       │       │           │
        ┌─┴─┐       ┌─┴─┐   ┌─┴─┐   ┌─┴─┐       ┌─┴─┐
        │👤 │═══════│👤 │═══│👤 │═══│👤 │═══════│👤 │
        │M1 │       │M2 │   │M3 │   │M4 │       │M5 │
        │🎟️  │       │🎟️  │   │🎟️  │   │🎟️  │       │🎟️  │
        └─┬─┘       └─┬─┘   └─┬─┘   └─┬─┘       └─┬─┘
          │           │       │       │           │
          ╰═══════════╪═══════╪═══════╪═══════════╯
                      │       │       │
              ════════╪═══════╪═══════╪════════
                   TICKET SOURCE STREAMS
              ════════╪═══════╪═══════╪════════
                      │       │       │
                ┌─────┴─────┐ │ ┌─────┴─────┐
                │ PURCHASE  │ │ │ TRADE-IN  │
                │ 💳 → 🎟️    │ │ │ 📦 → 🎟️    │
                └───────────┘ │ └───────────┘
                              │
                    ┌─────────┴─────────┐
                    │     REFERRAL      │
                    │     👥 → 🎟️        │
                    └───────────────────┘

        ═══════════════════════════════════════════════
                    ENERGY FLOW LEGEND
        ═══════════════════════════════════════════════

        ★ Grand Prize    ◆ Runner Up    ● Consolation
        👤 Member Node   🎟️ Ticket Count  ═ Ticket Flow

        Flow Direction: Source → Member → Draw → Prize

        Animation: Particles flow upward through the lattice,
        converging on prize nodes during active draws.
```

---

*Document Version: 1.0*
*Created: 2026-01-06*
*Status: Planning - Ready for Implementation*
