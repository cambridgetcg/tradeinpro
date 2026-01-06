# Fortune Essence Alchemy

**The Transmutation of Action into Destiny**

---

## The Philosopher's Framework

Traditional raffles are transactional: earn tokens, spend tokens, hope for luck. This is mechanical, uninspired, forgettable.

We elevate this into **Essence Alchemy** - where every action transmutes into magical energy that flows through a living crystal lattice, seeking harmonic resonance with prizes that call to their destined owners.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│                    THE GREAT TRANSMUTATION                                  │
│                                                                             │
│      ╔═══════════╗         ╔═══════════╗         ╔═══════════╗            │
│      ║  NIGREDO  ║   ───▶  ║  ALBEDO   ║   ───▶  ║  RUBEDO   ║            │
│      ║           ║         ║           ║         ║           ║            │
│      ║  Raw Act  ║         ║  Essence  ║         ║  Manifest ║            │
│      ║  ite.     ║         ║  Forms    ║         ║  ation    ║            │
│      ╚═══════════╝         ╚═══════════╝         ╚═══════════╝            │
│                                                                             │
│      Purchase            Essence Pool           Prize Won                  │
│      Trade-In      ───▶  Crystallizes    ───▶   Destiny                    │
│      Connection          Into Shards            Fulfilled                  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Part 1: The Essence Spectrum

### 1.1 Five Elemental Essences

Rather than uniform tickets, actions transmute into **distinct essence types**, each carrying unique properties and affinities.

```
                        THE ESSENCE SPECTRUM

        ┌─────────────────────────────────────────────────────┐
        │                                                     │
        │    ◆ COMMERCE        Source: Purchases              │
        │      Viridian        Color: Emerald Green           │
        │      ════════        Energy: Acquisition            │
        │                      Affinity: Product prizes       │
        │                                                     │
        │    ◆ TRADE           Source: Card Trade-ins         │
        │      Cerulean        Color: Deep Blue               │
        │      ════════        Energy: Transformation         │
        │                      Affinity: Rare card prizes     │
        │                                                     │
        │    ◆ BOND            Source: Referrals, Community   │
        │      Aureate         Color: Warm Amber              │
        │      ════════        Energy: Connection             │
        │                      Affinity: Shared experiences   │
        │                                                     │
        │    ◆ DEVOTION        Source: Membership, Loyalty    │
        │      Amethyst        Color: Royal Purple            │
        │      ════════        Energy: Commitment             │
        │                      Affinity: Exclusive prizes     │
        │                                                     │
        │    ◆ FORTUNE         Source: Special Events         │
        │      Auric           Color: Pure Gold               │
        │      ════════        Energy: Serendipity            │
        │                      Affinity: Grand prizes         │
        │                                                     │
        └─────────────────────────────────────────────────────┘
```

### 1.2 Essence Properties

Each essence unit carries metadata:

```typescript
interface Essence {
  id: string;
  type: EssenceType;           // COMMERCE | TRADE | BOND | DEVOTION | FORTUNE
  amount: number;              // Quantity
  resonance: number;           // 0.0 - 1.0 (freshness/potency)
  sourceAct: string;           // What action created this
  crystallizedAt?: Date;       // When committed to a draw
  maturityDate: Date;          // When essence reaches full potency
  createdAt: Date;
}

enum EssenceType {
  COMMERCE = 'commerce',       // 💚 Viridian
  TRADE = 'trade',             // 💙 Cerulean
  BOND = 'bond',               // 🧡 Aureate
  DEVOTION = 'devotion',       // 💜 Amethyst
  FORTUNE = 'fortune',         // 💛 Auric
}
```

---

## Part 2: The Transmutation Process

### 2.1 From Action to Essence

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│                         TRANSMUTATION PIPELINE                              │
│                                                                             │
│                                                                             │
│    ┌──────────┐      ┌──────────┐      ┌──────────┐      ┌──────────┐     │
│    │  ACTION  │      │  IGNITE  │      │  DISTILL │      │  INFUSE  │     │
│    │          │ ───▶ │          │ ───▶ │          │ ───▶ │          │     │
│    │ Raw deed │      │ Calculate│      │ Determine│      │ Add to   │     │
│    │ occurs   │      │ base     │      │ essence  │      │ member   │     │
│    │          │      │ yield    │      │ type     │      │ pool     │     │
│    └──────────┘      └──────────┘      └──────────┘      └──────────┘     │
│         │                 │                 │                 │            │
│         ▼                 ▼                 ▼                 ▼            │
│    ╔══════════╗     ╔══════════╗     ╔══════════╗     ╔══════════╗       │
│    ║ £89.99   ║     ║ 8 units  ║     ║ COMMERCE ║     ║ Pool +8  ║       │
│    ║ purchase ║     ║ (£10=1)  ║     ║ Viridian ║     ║ res: 1.0 ║       │
│    ╚══════════╝     ╚══════════╝     ╚══════════╝     ╚══════════╝       │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Transmutation Formulae

```
╔═══════════════════════════════════════════════════════════════════════════╗
║                        TRANSMUTATION FORMULAE                              ║
╠═══════════════════════════════════════════════════════════════════════════╣
║                                                                            ║
║  COMMERCE (Viridian) ════════════════════════════════════════════════     ║
║                                                                            ║
║    Purchase → Essence                                                      ║
║    ─────────────────                                                       ║
║    yield = floor(subtotal / 10)                                           ║
║    type = COMMERCE                                                         ║
║    resonance = 1.0 (fresh)                                                ║
║                                                                            ║
║    Example: £89.99 order → 8 Viridian Essence                             ║
║                                                                            ║
║  TRADE (Cerulean) ═══════════════════════════════════════════════════     ║
║                                                                            ║
║    Trade-In Approved → Essence                                            ║
║    ──────────────────────────                                             ║
║    base = 5                                                                ║
║    bonus = floor(finalValue / 20)                                         ║
║    yield = base + bonus                                                    ║
║    type = TRADE                                                            ║
║    resonance = 1.0                                                         ║
║                                                                            ║
║    Example: £45.50 trade-in → 5 + 2 = 7 Cerulean Essence                  ║
║                                                                            ║
║  BOND (Aureate) ═════════════════════════════════════════════════════     ║
║                                                                            ║
║    Referral Conversion → Essence                                          ║
║    ─────────────────────────────                                          ║
║    yield = 10                                                              ║
║    type = BOND                                                             ║
║    resonance = 1.0                                                         ║
║    condition = referee's first purchase completes                         ║
║                                                                            ║
║    Review Submitted → Essence                                             ║
║    ─────────────────────────                                              ║
║    yield = 2                                                               ║
║    type = BOND                                                             ║
║    resonance = 1.0                                                         ║
║    cap = 5 per month                                                       ║
║                                                                            ║
║  DEVOTION (Amethyst) ════════════════════════════════════════════════     ║
║                                                                            ║
║    Monthly Tier Blessing → Essence                                        ║
║    ───────────────────────────────                                        ║
║    VIP tier    → 20 Amethyst                                              ║
║    Gold tier   → 10 Amethyst                                              ║
║    Silver tier → 5 Amethyst                                               ║
║    type = DEVOTION                                                         ║
║    resonance = 1.0                                                         ║
║                                                                            ║
║  FORTUNE (Auric) ════════════════════════════════════════════════════     ║
║                                                                            ║
║    Special Events → Essence                                               ║
║    ────────────────────────                                               ║
║    Birthday blessing → 5 Auric                                            ║
║    Anniversary bonus → 10 Auric                                           ║
║    Event participation → variable                                         ║
║    type = FORTUNE                                                          ║
║    resonance = 1.0                                                         ║
║                                                                            ║
╚═══════════════════════════════════════════════════════════════════════════╝
```

---

## Part 3: The Essence Pool

### 3.1 Pool Architecture

Each member possesses an **Essence Pool** - a living reservoir of accumulated energy.

```
                         MEMBER ESSENCE POOL

        ╔═══════════════════════════════════════════════════════╗
        ║                                                       ║
        ║                    ALEX'S POOL                        ║
        ║                    ═══════════                        ║
        ║                                                       ║
        ║   ┌─────────────────────────────────────────────┐    ║
        ║   │                                             │    ║
        ║   │   TOTAL ESSENCE: 47                         │    ║
        ║   │   ══════════════════                        │    ║
        ║   │                                             │    ║
        ║   │   💚 Commerce (Viridian)   ████████░░  23   │    ║
        ║   │   💙 Trade (Cerulean)      █████░░░░░  14   │    ║
        ║   │   🧡 Bond (Aureate)        ██░░░░░░░░   5   │    ║
        ║   │   💜 Devotion (Amethyst)   ██░░░░░░░░   5   │    ║
        ║   │   💛 Fortune (Auric)       ░░░░░░░░░░   0   │    ║
        ║   │                                             │    ║
        ║   └─────────────────────────────────────────────┘    ║
        ║                                                       ║
        ║   RESONANCE LEVELS                                    ║
        ║   ─────────────────                                   ║
        ║   ◆ Peak (1.0)     12 essence   ▓▓▓▓▓▓▓▓▓▓          ║
        ║   ◇ Strong (0.8)   20 essence   ▓▓▓▓▓▓▓▓░░          ║
        ║   ○ Fading (0.5)   10 essence   ▓▓▓▓▓░░░░░          ║
        ║   · Dim (0.2)       5 essence   ▓▓░░░░░░░░          ║
        ║                                                       ║
        ║   ⚠ 5 essence fading in 12 days                      ║
        ║                                                       ║
        ╚═══════════════════════════════════════════════════════╝
```

### 3.2 Resonance Decay

Essence doesn't expire harshly - it **fades gracefully**:

```
        RESONANCE DECAY CURVE
        ═════════════════════

        Resonance
        1.0 ┤●━━━━━━━━━━━━━━━━━━━●
            │                    ╲
        0.8 ┤                     ╲━━━━━●
            │                           ╲
        0.6 ┤                            ╲━━━━●
            │                                 ╲
        0.4 ┤                                  ╲━━━●
            │                                      ╲
        0.2 ┤                                       ╲━━●
            │                                          ╲
        0.0 ┼────────────────────────────────────────────●────
            0    7    14   21   28   35   42   49   56   63  Days

        Phase 1 (Days 0-21):   Peak resonance (1.0) - Full potency
        Phase 2 (Days 21-42):  Gradual decay (1.0 → 0.5) - Still powerful
        Phase 3 (Days 42-63):  Final fade (0.5 → 0.0) - Use or lose
        Phase 4 (Day 63+):     Essence dissolves into the aether
```

### 3.3 Resonance Impact

Higher resonance essence has greater power:

```typescript
// When entering a draw, resonance affects entry weight
function calculateEntryWeight(essence: Essence[]): number {
  let totalWeight = 0;

  for (const e of essence) {
    // Base weight is the amount
    let weight = e.amount;

    // Resonance multiplier (0.5x to 1.5x based on resonance)
    const resonanceMultiplier = 0.5 + (e.resonance * 1.0);
    weight *= resonanceMultiplier;

    totalWeight += weight;
  }

  return totalWeight;
}

// Example:
// 10 essence at 1.0 resonance = 10 * 1.5 = 15 weight
// 10 essence at 0.5 resonance = 10 * 1.0 = 10 weight
// 10 essence at 0.2 resonance = 10 * 0.7 = 7 weight
```

---

## Part 4: The Crystallization Ritual

### 4.1 From Pool to Shard

To enter a draw, essence must be **crystallized** into **Entry Shards** - a deliberate, irreversible commitment.

```
                      THE CRYSTALLIZATION RITUAL

        ┌─────────────────────────────────────────────────────────┐
        │                                                         │
        │   STEP 1: SELECT ESSENCE                                │
        │   ══════════════════════                                │
        │                                                         │
        │   From your pool, choose essence to crystallize:        │
        │                                                         │
        │   💚 Commerce    [███████░░░]  Select: [5]              │
        │   💙 Trade       [█████░░░░░]  Select: [3]              │
        │   🧡 Bond        [██░░░░░░░░]  Select: [0]              │
        │                                                         │
        │   Total Selected: 8 essence                             │
        │                                                         │
        └─────────────────────────────────────────────────────────┘
                                │
                                ▼
        ┌─────────────────────────────────────────────────────────┐
        │                                                         │
        │   STEP 2: FUSION CHECK                                  │
        │   ════════════════════                                  │
        │                                                         │
        │   Combining multiple essence types creates FUSION:      │
        │                                                         │
        │   ┌─────────────────────────────────────────────┐      │
        │   │  💚 5 Commerce + 💙 3 Trade                  │      │
        │   │  ═══════════════════════════                │      │
        │   │                                             │      │
        │   │  Base Entry Value: 8                        │      │
        │   │  Fusion Bonus: +15% (2 types combined)      │      │
        │   │  ─────────────────────────────              │      │
        │   │  Final Entry Value: 9.2                     │      │
        │   └─────────────────────────────────────────────┘      │
        │                                                         │
        └─────────────────────────────────────────────────────────┘
                                │
                                ▼
        ┌─────────────────────────────────────────────────────────┐
        │                                                         │
        │   STEP 3: CRYSTALLIZE                                   │
        │   ═══════════════════                                   │
        │                                                         │
        │            ╔═════════════════════════════╗              │
        │            ║                             ║              │
        │            ║    ◇ ENTRY SHARD #4,721    ║              │
        │            ║                             ║              │
        │            ║    Draw: January Grand      ║              │
        │            ║    Weight: 9.2              ║              │
        │            ║    Composition:             ║              │
        │            ║      💚 5 Viridian          ║              │
        │            ║      💙 3 Cerulean          ║              │
        │            ║    Fusion: ✓ Active         ║              │
        │            ║                             ║              │
        │            ╚═════════════════════════════╝              │
        │                                                         │
        │   ⚠ Crystallization is permanent. Shards cannot be     │
        │     returned to your pool.                              │
        │                                                         │
        │              [ ✨ CRYSTALLIZE ]                         │
        │                                                         │
        └─────────────────────────────────────────────────────────┘
```

### 4.2 Fusion Bonuses

Combining essence types rewards diverse engagement:

```
╔═══════════════════════════════════════════════════════════════════════════╗
║                           FUSION MATRIX                                    ║
╠═══════════════════════════════════════════════════════════════════════════╣
║                                                                            ║
║   Types Combined    │  Fusion Name         │  Bonus                       ║
║   ──────────────────┼──────────────────────┼────────────────────────      ║
║   2 types           │  Binary Fusion       │  +15% entry weight           ║
║   3 types           │  Ternary Fusion      │  +30% entry weight           ║
║   4 types           │  Quaternary Fusion   │  +50% entry weight           ║
║   5 types           │  PRISMATIC FUSION    │  +100% entry weight          ║
║                                                                            ║
╠═══════════════════════════════════════════════════════════════════════════╣
║                                                                            ║
║   SPECIAL COMBINATIONS                                                     ║
║   ════════════════════                                                     ║
║                                                                            ║
║   💚 + 💙 (Commerce + Trade)                                               ║
║   "Merchant's Path" - Perfect for product prize draws                     ║
║   Bonus: +20% affinity with physical prizes                               ║
║                                                                            ║
║   💙 + 💜 (Trade + Devotion)                                               ║
║   "Collector's Heart" - Ideal for rare card draws                         ║
║   Bonus: +25% affinity with rare singles                                  ║
║                                                                            ║
║   🧡 + 💛 (Bond + Fortune)                                                 ║
║   "Lucky Connection" - Enhanced serendipity                               ║
║   Bonus: +20% to random selection weight                                  ║
║                                                                            ║
║   ALL FIVE TYPES                                                           ║
║   "Philosopher's Stone" - Legendary fusion                                ║
║   Bonus: +100% weight + guaranteed consolation if not grand winner        ║
║                                                                            ║
╚═══════════════════════════════════════════════════════════════════════════╝
```

---

## Part 5: Draw Affinity System

### 5.1 Prize-Essence Resonance

Each draw has **affinity** with certain essence types, creating strategic depth:

```
                        DRAW AFFINITY CHART

    ┌─────────────────────────────────────────────────────────────────┐
    │                                                                 │
    │   JANUARY GRAND DRAW                                            │
    │   ══════════════════                                            │
    │   Prize: OP09 Booster Box + £50 Credit                         │
    │                                                                 │
    │   Essence Affinities:                                           │
    │   ┌──────────────────────────────────────────────────────┐     │
    │   │ 💚 Commerce   ████████████████████  HIGH (1.2x)      │     │
    │   │ 💙 Trade      ██████████████░░░░░░  MEDIUM (1.0x)    │     │
    │   │ 🧡 Bond       ████████░░░░░░░░░░░░  LOW (0.8x)       │     │
    │   │ 💜 Devotion   ██████████████████░░  HIGH (1.1x)      │     │
    │   │ 💛 Fortune    ████████████████████  HIGH (1.2x)      │     │
    │   └──────────────────────────────────────────────────────┘     │
    │                                                                 │
    │   Optimal Strategy: Commerce + Fortune fusion                   │
    │                                                                 │
    └─────────────────────────────────────────────────────────────────┘

    ┌─────────────────────────────────────────────────────────────────┐
    │                                                                 │
    │   RARE SINGLES DRAW                                             │
    │   ══════════════════                                            │
    │   Prize: Alternate Art Luffy (SP)                               │
    │                                                                 │
    │   Essence Affinities:                                           │
    │   ┌──────────────────────────────────────────────────────┐     │
    │   │ 💚 Commerce   ██████░░░░░░░░░░░░░░  LOW (0.7x)       │     │
    │   │ 💙 Trade      ████████████████████  VERY HIGH (1.5x) │     │
    │   │ 🧡 Bond       ████████████░░░░░░░░  MEDIUM (1.0x)    │     │
    │   │ 💜 Devotion   ████████████████████  HIGH (1.3x)      │     │
    │   │ 💛 Fortune    ██████████░░░░░░░░░░  MEDIUM (0.9x)    │     │
    │   └──────────────────────────────────────────────────────┘     │
    │                                                                 │
    │   Optimal Strategy: Trade + Devotion fusion                     │
    │                                                                 │
    └─────────────────────────────────────────────────────────────────┘

    ┌─────────────────────────────────────────────────────────────────┐
    │                                                                 │
    │   COMMUNITY FLASH DRAW                                          │
    │   ══════════════════════                                        │
    │   Prize: Signed Playmat + Promo Pack                           │
    │                                                                 │
    │   Essence Affinities:                                           │
    │   ┌──────────────────────────────────────────────────────┐     │
    │   │ 💚 Commerce   ████████░░░░░░░░░░░░  LOW (0.8x)       │     │
    │   │ 💙 Trade      ████████░░░░░░░░░░░░  LOW (0.8x)       │     │
    │   │ 🧡 Bond       ████████████████████  VERY HIGH (1.5x) │     │
    │   │ 💜 Devotion   ██████████████░░░░░░  MEDIUM (1.0x)    │     │
    │   │ 💛 Fortune    ████████████████░░░░  HIGH (1.2x)      │     │
    │   └──────────────────────────────────────────────────────┘     │
    │                                                                 │
    │   Optimal Strategy: Bond + Fortune fusion                       │
    │                                                                 │
    └─────────────────────────────────────────────────────────────────┘
```

### 5.2 Affinity Calculation

```typescript
function calculateFinalWeight(shard: EntryShard, draw: Draw): number {
  let weight = shard.baseWeight;

  // Apply resonance (already factored into baseWeight)

  // Apply fusion bonus
  weight *= shard.fusionMultiplier;

  // Apply affinity modifiers
  for (const [essenceType, amount] of Object.entries(shard.composition)) {
    const affinity = draw.affinities[essenceType] || 1.0;
    const proportion = amount / shard.totalEssence;
    weight *= Math.pow(affinity, proportion);
  }

  return weight;
}

// Example:
// Shard: 5 Commerce + 3 Trade (8 total, 1.15 fusion)
// Draw affinities: Commerce 1.2, Trade 1.5
//
// Weight = 8 * 1.15 * (1.2^0.625) * (1.5^0.375)
//        = 9.2 * 1.12 * 1.16
//        = 11.95 effective weight
```

---

## Part 6: The Manifestation (Draw Execution)

### 6.1 The Selection Algorithm

```
                    MANIFESTATION SEQUENCE
                    ══════════════════════


        ┌─────────────────────────────────────────────────────────┐
        │                                                         │
        │   PHASE 1: GATHER SHARDS                                │
        │   ══════════════════════                                │
        │                                                         │
        │   All crystallized entry shards converge on the         │
        │   draw nexus, their weights calculated and summed.      │
        │                                                         │
        │        ◇───◇───◇───◇───◇───◇───◇───◇                   │
        │         ╲   ╲   ╲   │   ╱   ╱   ╱                       │
        │          ╲   ╲   ╲  │  ╱   ╱   ╱                        │
        │           ╲   ╲   ╲ │ ╱   ╱   ╱                         │
        │            ╲   ╲   ╲│╱   ╱   ╱                          │
        │             ╲   ╲   ●   ╱   ╱                           │
        │              ╲   ╲  │  ╱   ╱                            │
        │               ╲   ╲ │ ╱   ╱                             │
        │                ╲   ╲│╱   ╱                              │
        │                 ╲   ●   ╱   NEXUS                       │
        │                  ╲  │  ╱                                │
        │                   ╲ │ ╱                                 │
        │                    ╲│╱                                  │
        │                     ★                                   │
        │                                                         │
        │   Total Weight: 4,721.8                                 │
        │   Unique Entrants: 234                                  │
        │                                                         │
        └─────────────────────────────────────────────────────────┘
                                │
                                ▼
        ┌─────────────────────────────────────────────────────────┐
        │                                                         │
        │   PHASE 2: GENERATE SEED                                │
        │   ══════════════════════                                │
        │                                                         │
        │   A cryptographically secure seed crystallizes from     │
        │   the aether, ensuring fair and verifiable selection.   │
        │                                                         │
        │   Seed: 7f3a8b2c4d1e5f6a9b0c1d2e3f4a5b6c7d8e9f0a1b2c   │
        │   Timestamp: 2026-01-31T20:00:00.000Z                   │
        │   Block Hash: (optional blockchain anchor)              │
        │                                                         │
        └─────────────────────────────────────────────────────────┘
                                │
                                ▼
        ┌─────────────────────────────────────────────────────────┐
        │                                                         │
        │   PHASE 3: WEIGHTED SELECTION                           │
        │   ═══════════════════════════                           │
        │                                                         │
        │   The seed determines a point in the weight spectrum.   │
        │   The shard containing that point is selected.          │
        │                                                         │
        │   Weight Spectrum:                                      │
        │   ┌──────────────────────────────────────────────────┐ │
        │   │░░░░░░░░▓▓▓▓▓▓▓▓░░░░░░░░░░░░▓▓▓▓░░░░░░▓▓▓▓▓▓▓▓░░│ │
        │   │  A       B           C        D       E          │ │
        │   │ 8.2    15.7        12.1     11.9     9.2        │ │
        │   └──────────────────────────────────────────────────┘ │
        │                              ↑                          │
        │                         Selection Point: 31.4           │
        │                         Winner: Entry C (Alex)          │
        │                                                         │
        └─────────────────────────────────────────────────────────┘
                                │
                                ▼
        ┌─────────────────────────────────────────────────────────┐
        │                                                         │
        │   PHASE 4: MANIFESTATION                                │
        │   ══════════════════════                                │
        │                                                         │
        │                     ✧                                   │
        │                    ╱│╲                                  │
        │                   ╱ │ ╲                                 │
        │                  ╱  │  ╲                                │
        │                 ★───★───★                               │
        │                     │                                   │
        │               WINNER REVEALED                           │
        │                                                         │
        │   🏆 GRAND PRIZE: Alex K.                               │
        │      Entry #F-JAN26-04721                               │
        │      Weight: 12.1 (Ternary Fusion)                      │
        │                                                         │
        │   🥈 RUNNER UP: Sarah M.                                │
        │      Entry #F-JAN26-02156                               │
        │                                                         │
        │   🥉 CONSOLATION: 10 winners selected...                │
        │                                                         │
        └─────────────────────────────────────────────────────────┘
```

### 6.2 Selection Code

```typescript
interface ManifestationResult {
  draw: RaffleDraw;
  seed: string;
  winners: Winner[];
  totalWeight: number;
  totalEntrants: number;
  timestamp: Date;
}

async function manifest(drawId: string): Promise<ManifestationResult> {
  const draw = await getDraw(drawId);
  const shards = await getAllShards(drawId);
  const prizes = JSON.parse(draw.prizes);

  // Generate cryptographic seed
  const seed = crypto.randomBytes(32).toString('hex');
  const rng = seedrandom(seed);

  // Calculate total weight and build selection array
  let totalWeight = 0;
  const weightedShards: Array<{ shard: Shard; start: number; end: number }> = [];

  for (const shard of shards) {
    const weight = calculateFinalWeight(shard, draw);
    weightedShards.push({
      shard,
      start: totalWeight,
      end: totalWeight + weight,
    });
    totalWeight += weight;
  }

  // Select winners
  const winners: Winner[] = [];
  const selectedCustomers = new Set<string>();

  for (const prize of prizes) {
    for (let q = 0; q < prize.quantity; q++) {
      // Generate selection point
      const selectionPoint = rng() * totalWeight;

      // Find winning shard (excluding already-won customers)
      let attempts = 0;
      let winner: Shard | null = null;

      while (!winner && attempts < 1000) {
        const adjustedPoint = (selectionPoint + attempts * 0.001) % totalWeight;

        for (const ws of weightedShards) {
          if (adjustedPoint >= ws.start && adjustedPoint < ws.end) {
            if (!selectedCustomers.has(ws.shard.customerId)) {
              winner = ws.shard;
              break;
            }
          }
        }
        attempts++;
      }

      if (winner) {
        selectedCustomers.add(winner.customerId);
        winners.push({
          customerId: winner.customerId,
          shardId: winner.id,
          prizeTier: prize.tier,
          prizeName: prize.name,
          prizeValue: prize.value,
          selectionPoint,
        });
      }
    }
  }

  return {
    draw,
    seed,
    winners,
    totalWeight,
    totalEntrants: new Set(shards.map(s => s.customerId)).size,
    timestamp: new Date(),
  };
}
```

---

## Part 7: The Crystal Visualization

### 7.1 Living Lattice

```
                    FORTUNE CRYSTAL - LIVE VIEW
    ═══════════════════════════════════════════════════════════

                              ★ PRIZES
                             ╱│╲
                ┌───────────╱─┼─╲───────────┐
                │          ╱  │  ╲          │
                │    ◆────●───●───●────◆    │   Prize Tier
                │         │   │   │         │   Nodes
                ╰─────────┼───┼───┼─────────╯
                          │   │   │
            ════════════════════════════════════
                    DRAW NEXUS LAYER
            ════════════════════════════════════
                          │   │   │
                ┌─────────┼───┼───┼─────────┐
                │    ┌────┴───┴───┴────┐    │
                │    │   JANUARY DRAW  │    │
                │    │   ◎ 234 entries │    │   Active
                │    │   ≋ 4,721 weight│    │   Draws
                │    │   ⏱ 5d 12h left │    │
                │    └─────────────────┘    │
                ╰───────────────────────────╯
                          │
            ════════════════════════════════════
                    RESONANCE CHAMBER
            ════════════════════════════════════
                          │
          ┌───────────────┼───────────────┐
          │               │               │
        ┌─┴─┐           ┌─┴─┐           ┌─┴─┐
        │ ◇ │───────────│ ◇ │───────────│ ◇ │   Member
        │47 │           │23 │           │89 │   Pools
        │▓▓▓│           │▓▓░│           │▓▓▓│
        └─┬─┘           └─┬─┘           └─┬─┘
          │               │               │
          └───────┬───────┴───────┬───────┘
                  │               │
            ════════════════════════════════════
                    ESSENCE STREAMS
            ════════════════════════════════════
                  │               │
            ┌─────┴─────┐   ┌─────┴─────┐
            │ 💚 COMMERCE│   │ 💙 TRADE  │
            │  ●→●→●→●  │   │  ●→●→●   │   Flowing
            │   8/day   │   │  3/day   │   Essence
            └───────────┘   └───────────┘

    ═══════════════════════════════════════════════════════════

    LEGEND:
    ★ Grand Prize    ◆ Runner Up    ● Consolation
    ◎ Draw Node      ◇ Member Pool  ● Essence Particle
    ▓ High Resonance ░ Low Resonance → Flow Direction
```

### 7.2 Animation States

```javascript
const FORTUNE_CRYSTAL_STATES = {

  // Idle: Ambient energy flow
  IDLE: {
    essence_flow: {
      speed: 1.0,
      particle_count: 50,
      glow_intensity: 0.3,
    },
    member_pools: {
      pulse_rate: 0.5,  // Hz
      pulse_amplitude: 0.05,
    },
    draw_nodes: {
      rotation_speed: 0.1,  // rad/s
      attraction_radius: 50,
    },
  },

  // Earning: New essence transmuting
  TRANSMUTING: {
    duration: 1500,
    source_burst: {
      particle_count: 20,
      color: 'essence_type',  // Dynamic based on type
      spread_angle: 45,
    },
    flow_to_pool: {
      path: 'bezier',
      trail_length: 5,
      glow_pulse: true,
    },
    pool_absorption: {
      ripple_count: 3,
      ripple_duration: 800,
    },
  },

  // Crystallizing: Essence becoming shard
  CRYSTALLIZING: {
    duration: 2000,
    pool_drain: {
      vortex_rotation: 2.0,  // rad/s
      particle_spiral: true,
    },
    shard_formation: {
      facet_count: 6,
      growth_easing: 'easeOutElastic',
      final_glow: 1.0,
    },
    ascent_to_draw: {
      path: 'arc',
      trail_sparkles: true,
    },
  },

  // Drawing: Selection in progress
  MANIFESTING: {
    duration: 5000,
    draw_node: {
      spin_acceleration: 'ease_in_out',
      max_rotation_speed: 10,  // rad/s
      energy_buildup: true,
    },
    shard_orbit: {
      orbital_speed: 2.0,
      highlight_candidate: true,
    },
    selection: {
      beam_to_winner: true,
      beam_color: '#ffd700',
      beam_duration: 1000,
    },
  },

  // Winner: Celebration
  CELEBRATION: {
    duration: 3000,
    winner_burst: {
      particle_count: 100,
      colors: ['#ffd700', '#ff6b6b', '#4ecdc4', '#45b7d1'],
      gravity: -0.5,
    },
    prize_descent: {
      path: 'sine_wave',
      glow_trail: true,
    },
    lattice_ripple: {
      origin: 'winner_node',
      speed: 200,  // px/s
      color_shift: true,
    },
  },
};
```

---

## Part 8: Data Models (Elevated)

### 8.1 Prisma Schema

```prisma
// ============================================================================
// FORTUNE ESSENCE ALCHEMY
// Elevated raffle system with essence types and crystallization
// ============================================================================

enum EssenceType {
  COMMERCE    // 💚 From purchases
  TRADE       // 💙 From trade-ins
  BOND        // 🧡 From referrals, community
  DEVOTION    // 💜 From membership
  FORTUNE     // 💛 From special events
}

// Individual essence transactions
model EssenceTransaction {
  id              String       @id @default(cuid())

  // Owner
  customerId      String       @map("customer_id")
  customer        Customer     @relation(fields: [customerId], references: [id])

  // Essence details
  essenceType     EssenceType  @map("essence_type")
  amount          Int                    // Positive = gain, Negative = crystallize
  resonance       Decimal      @db.Decimal(3, 2)  // 0.00 - 1.00

  // Source tracking
  source          String                 // PURCHASE, TRADE_IN, REFERRAL, etc.
  sourceRef       String?      @map("source_ref")
  description     String?

  // Lifecycle
  maturesAt       DateTime     @map("matures_at")     // When resonance peaks
  decaysAt        DateTime     @map("decays_at")      // When resonance starts falling
  expiresAt       DateTime     @map("expires_at")     // When essence dissolves

  // If crystallized
  shardId         String?      @map("shard_id")
  crystallizedAt  DateTime?    @map("crystallized_at")

  createdAt       DateTime     @default(now()) @map("created_at")

  @@index([customerId])
  @@index([essenceType])
  @@index([expiresAt])
  @@map("essence_transactions")
}

// Member's current essence pool (materialized view / cache)
model EssencePool {
  id              String       @id @default(cuid())
  customerId      String       @unique @map("customer_id")
  customer        Customer     @relation(fields: [customerId], references: [id])

  // Balances by type
  commerceBalance  Int         @default(0) @map("commerce_balance")
  tradeBalance     Int         @default(0) @map("trade_balance")
  bondBalance      Int         @default(0) @map("bond_balance")
  devotionBalance  Int         @default(0) @map("devotion_balance")
  fortuneBalance   Int         @default(0) @map("fortune_balance")

  // Aggregates
  totalBalance    Int          @default(0) @map("total_balance")
  peakResonance   Int          @default(0) @map("peak_resonance")    // Essence at 1.0
  averageResonance Decimal     @default(1.0) @map("average_resonance") @db.Decimal(3, 2)

  // Expiry warning
  expiringAmount  Int          @default(0) @map("expiring_amount")
  expiringWithin  DateTime?    @map("expiring_within")

  updatedAt       DateTime     @updatedAt @map("updated_at")

  @@map("essence_pools")
}

// Prize draw events
model FortuneDraw {
  id              String       @id @default(cuid())

  // Identity
  name            String
  slug            String       @unique
  description     String?      @db.Text

  // Type
  drawType        String       @map("draw_type")  // MONTHLY, WEEKLY, FLASH, SPECIAL

  // Entry rules
  minEssenceCost  Int          @map("min_essence_cost")  // Minimum essence per entry
  maxEntriesPerMember Int?     @map("max_entries_per_member")

  // Affinities (JSON: { commerce: 1.2, trade: 1.5, ... })
  affinities      String       @db.Text

  // Prizes (JSON array)
  prizes          String       @db.Text

  // Schedule
  opensAt         DateTime     @map("opens_at")
  closesAt        DateTime     @map("closes_at")
  manifestsAt     DateTime     @map("manifests_at")  // Draw time

  // Status
  status          String       @default("SCHEDULED")

  // Results
  totalShards     Int?         @map("total_shards")
  totalWeight     Decimal?     @map("total_weight") @db.Decimal(12, 2)
  manifestationSeed String?    @map("manifestation_seed")

  // Media
  imageUrl        String?      @map("image_url")

  createdAt       DateTime     @default(now()) @map("created_at")
  updatedAt       DateTime     @updatedAt @map("updated_at")
  manifestedAt    DateTime?    @map("manifested_at")

  shards          EntryShard[]
  winners         FortuneWinner[]

  @@index([status])
  @@index([manifestsAt])
  @@map("fortune_draws")
}

// Crystallized entry shards
model EntryShard {
  id              String       @id @default(cuid())

  // Ownership
  customerId      String       @map("customer_id")
  customer        Customer     @relation(fields: [customerId], references: [id])
  drawId          String       @map("draw_id")
  draw            FortuneDraw  @relation(fields: [drawId], references: [id])

  // Composition (JSON: { commerce: 5, trade: 3, ... })
  composition     String       @db.Text
  totalEssence    Int          @map("total_essence")

  // Calculated values
  baseWeight      Decimal      @map("base_weight") @db.Decimal(8, 2)
  fusionType      String?      @map("fusion_type")  // BINARY, TERNARY, etc.
  fusionMultiplier Decimal     @default(1.0) @map("fusion_multiplier") @db.Decimal(4, 2)
  finalWeight     Decimal      @map("final_weight") @db.Decimal(8, 2)

  // Display
  shardNumber     String       @map("shard_number")  // F-JAN26-00001

  crystallizedAt  DateTime     @default(now()) @map("crystallized_at")

  @@unique([customerId, drawId])  // One shard per customer per draw
  @@index([drawId])
  @@index([customerId])
  @@map("entry_shards")
}

// Winners
model FortuneWinner {
  id              String       @id @default(cuid())

  // Winner
  customerId      String       @map("customer_id")
  customer        Customer     @relation(fields: [customerId], references: [id])
  drawId          String       @map("draw_id")
  draw            FortuneDraw  @relation(fields: [drawId], references: [id])
  shardId         String       @map("shard_id")

  // Prize
  prizeTier       String       @map("prize_tier")
  prizeName       String       @map("prize_name")
  prizeValue      Int          @map("prize_value")

  // Selection metadata
  selectionPoint  Decimal      @map("selection_point") @db.Decimal(12, 4)

  // Fulfillment
  status          String       @default("PENDING")
  claimedAt       DateTime?    @map("claimed_at")
  fulfilledAt     DateTime?    @map("fulfilled_at")

  // For credit prizes
  giftCardId      String?      @map("gift_card_id")
  giftCardCode    String?      @map("gift_card_code")

  // For physical prizes
  trackingNumber  String?      @map("tracking_number")

  manifestedAt    DateTime     @default(now()) @map("manifested_at")
  updatedAt       DateTime     @updatedAt @map("updated_at")

  @@index([customerId])
  @@index([drawId])
  @@map("fortune_winners")
}
```

---

## Part 9: Implementation Roadmap

### Phase 1: Essence Foundation
- [ ] Create Prisma models for essence system
- [ ] Implement essence transmutation engine
- [ ] Build resonance decay cron job
- [ ] Create pool balance calculator
- [ ] Add API: balance, transactions, pool status

### Phase 2: Transmutation Integration
- [ ] Shopify webhook: orders/paid → Commerce essence
- [ ] Trade-in hook: approval → Trade essence
- [ ] Referral tracking → Bond essence
- [ ] Membership tier cron → Devotion essence
- [ ] Birthday/event triggers → Fortune essence

### Phase 3: Crystallization & Draws
- [ ] Implement crystallization ritual
- [ ] Build fusion calculation engine
- [ ] Create draw management system
- [ ] Implement affinity-weighted selection
- [ ] Build manifestation algorithm

### Phase 4: Member Portal
- [ ] Upgrade my-raffles page with essence pool
- [ ] Create crystallization modal with preview
- [ ] Build active draws grid with affinities
- [ ] Implement entry history with shard details
- [ ] Add winner celebration screens

### Phase 5: Crystal Visualization
- [ ] Build Fortune Crystal canvas renderer
- [ ] Implement essence flow animations
- [ ] Add crystallization effects
- [ ] Create manifestation sequence
- [ ] Build celebration particle system

### Phase 6: Advanced Alchemy
- [ ] Implement special fusion combinations
- [ ] Add "Philosopher's Stone" achievement
- [ ] Create draw affinity suggestions
- [ ] Build essence trading between members (future)
- [ ] Add predictive resonance indicators

---

## Appendix: The Alchemist's Glossary

| Term | Meaning |
|------|---------|
| **Essence** | The magical energy transmuted from actions |
| **Transmutation** | Converting an action into essence |
| **Resonance** | The potency/freshness of essence (0.0 - 1.0) |
| **Pool** | A member's reservoir of accumulated essence |
| **Crystallization** | Committing essence into an entry shard |
| **Shard** | A crystallized entry into a draw |
| **Fusion** | Combining multiple essence types for bonuses |
| **Affinity** | A draw's preference for certain essence types |
| **Manifestation** | The draw execution and winner selection |
| **Nexus** | The focal point where shards converge |

---

*"In the crucible of commerce, the essence of fortune is transmuted."*

*Document Version: 2.0 - Elevated*
*Created: 2026-01-06*
