# Customer Account UI Extension Design Guide

> **Purpose:** Design insights and integration plan for CardForum Trade-In Customer Account Extensions
> **Theme:** Sleek by FoxEcom (v2.1.0)
> **Last Updated:** 2026-01-01

> **Central Reference:** See [TRADE_IN_SYSTEM_SYNAPSE.md](./TRADE_IN_SYSTEM_SYNAPSE.md) for the complete system architecture, weak links, and unhandled scenarios across both frontend and backend.
>
> **Myelin Pathways:**
> - `extensions/EXTENSIONS_SYNAPSE.md` → trade-in-account extension architecture
> - `../../ShopifyTheme_TCG/docs/sleek-theme-guide.md` → Theme style context
> - Related analysis: `OAUTH_IMPLEMENTATION_REVIEW.md` → Session token handling

---

## Table of Contents

1. [Design Philosophy Alignment](#design-philosophy-alignment)
2. [Shopify Customer Account UI Components](#shopify-customer-account-ui-components)
3. [Layout Best Practices](#layout-best-practices)
4. [Typography Guidelines](#typography-guidelines)
5. [Color & Appearance](#color--appearance)
6. [Component Patterns](#component-patterns)
7. [Limitations & Constraints](#limitations--constraints)
8. [Integration Plan](#integration-plan)
9. [Implementation Reference](#implementation-reference)

---

## Design Philosophy Alignment

### Sleek Theme Core Values

| Principle | Description | Extension Application |
|-----------|-------------|----------------------|
| **Clean & Modern** | Professional aesthetics, minimal clutter | Use whitespace, clear hierarchy, focused content |
| **UX-Optimized** | Seamless navigation, intuitive interactions | Clear CTAs, logical flow, self-explanatory UI |
| **Performance** | Fast loading, responsive | Lightweight components, no network calls |
| **Conversion-Focused** | Trust-building, urgency creation | Clear value proposition, benefits emphasis |

### Key Sleek Design Elements

```
Colors:
- Primary, tint, neutral colors
- Semantic: info (blue), warning (yellow), danger (red), success (green)
- Light/dark mode support
- Accessibility-focused contrasts

Typography:
- Clean, modern fonts
- Clear hierarchy
- Sentence case for headings

Layout:
- Card-based sections
- Multi-column grids
- Mobile-first responsive
- Consistent spacing
```

---

## Shopify Customer Account UI Components

### Available Components (React)

```typescript
// Structure
import {
  Page,           // Full page wrapper with title
  Card,           // Grouped content container
  BlockStack,     // Vertical stacking (spacing: none|extraTight|tight|base|loose|extraLoose)
  InlineStack,    // Horizontal stacking
  Divider,        // Visual separator
} from '@shopify/ui-extensions-react/customer-account';

// Typography
import {
  Text,           // Body text (size: small|base|large, emphasis: bold, appearance: subdued|critical|success)
  Heading,        // Headings (auto-sized based on nesting)
} from '@shopify/ui-extensions-react/customer-account';

// Actions
import {
  Button,         // Actions (kind: primary|secondary, to: URL)
  Link,           // Navigation (to: URL, external: boolean)
} from '@shopify/ui-extensions-react/customer-account';

// Feedback
import {
  Banner,         // Alerts (status: info|warning|critical|success)
  Spinner,        // Loading indicator
  Badge,          // Status labels (tone: success|warning|critical|info)
} from '@shopify/ui-extensions-react/customer-account';

// Forms
import {
  Form,           // Form wrapper
  TextField,      // Text input
  Select,         // Dropdown
  Checkbox,       // Checkbox
} from '@shopify/ui-extensions-react/customer-account';
```

### Component Hierarchy

```
Page
└── BlockStack (spacing="loose")
    ├── Card
    │   └── BlockStack (spacing="base")
    │       ├── Text (emphasis="bold")  // Card title
    │       ├── Divider
    │       └── Content...
    ├── Card
    │   └── ...
    └── Card
        └── ...
```

---

## Layout Best Practices

### Spacing Scale (Middle-Out)

```
small-300 < small-200 < small-100 < base < large-100 < large-200 < large-300
     ↑                        ↑                              ↑
  Tightest              Default                         Loosest
```

**Usage Guidelines:**

| Context | Recommended Spacing |
|---------|---------------------|
| Between cards/sections | `loose` or `extraLoose` |
| Within card content | `base` |
| Between related items | `tight` |
| Between label and value | `extraTight` or `none` |
| Icon and text | `tight` |

### Responsive Grid (12-Column)

```
Mobile (375dp):   |  6 cols  | → 1-column content
Tablet (750dp):   |  6 cols  | → 1-column content
Laptop (1000dp):  | 12 cols  | → 2-column content
```

**Container Query Syntax:**
```typescript
// Mobile-first (fallback value is smallest)
padding="@container (inline-size > 500px) large-400, small"
direction="@container (inline-size > 300px) inline, block"
```

### Layout Patterns

**Full-Width Card:**
```tsx
<Card>
  <BlockStack spacing="base">
    <Text emphasis="bold" size="large">Title</Text>
    <Text>Description content...</Text>
    <Link to={url} external>Action →</Link>
  </BlockStack>
</Card>
```

**Two-Column Info:**
```tsx
<Card>
  <BlockStack spacing="base">
    <InlineStack spacing="base" blockAlignment="start">
      <BlockStack spacing="extraTight">
        <Text emphasis="bold">Label 1</Text>
        <Text appearance="subdued">Value 1</Text>
      </BlockStack>
      <BlockStack spacing="extraTight">
        <Text emphasis="bold">Label 2</Text>
        <Text appearance="subdued">Value 2</Text>
      </BlockStack>
    </InlineStack>
  </BlockStack>
</Card>
```

**Steps/Process Flow:**
```tsx
<Card>
  <BlockStack spacing="base">
    <Text emphasis="bold">How It Works</Text>
    {steps.map((step, i) => (
      <InlineStack key={i} spacing="base" blockAlignment="start">
        <Text emphasis="bold">{i + 1}.</Text>
        <BlockStack spacing="extraTight">
          <Text emphasis="bold">{step.title}</Text>
          <Text size="small" appearance="subdued">{step.description}</Text>
        </BlockStack>
      </InlineStack>
    ))}
  </BlockStack>
</Card>
```

---

## Typography Guidelines

### Hierarchy

| Level | Component | Usage |
|-------|-----------|-------|
| Page Title | `<Page title="...">` | Main page heading |
| Section Title | `<Text emphasis="bold" size="large">` | Card/section headers |
| Subsection | `<Text emphasis="bold">` | Group labels |
| Body | `<Text>` | Regular content |
| Supporting | `<Text size="small" appearance="subdued">` | Helper text, labels |

### Content Guidelines (Sleek-Aligned)

- **Sentence case** for headings (not Title Case)
- **1-3 words** for status names
- **Action-oriented** CTAs (e.g., "Start Trade-In →")
- **Benefit-focused** descriptions
- **No app branding** - represent the merchant

**Good Examples:**
```
✓ "Turn your cards into value"
✓ "Get up to 70% of market value"
✓ "Start a Trade-In →"
```

**Avoid:**
```
✗ "Welcome to CardForum Trade-In App!"
✗ "Powered by CardForum"
✗ "Click Here"
```

---

## Color & Appearance

### Semantic Colors (Auto-Applied)

| Tone | Use Case | Example |
|------|----------|---------|
| `success` | Positive states, completion | "Trade-in completed" |
| `warning` | Needs attention, pending | "Action required" |
| `critical` | Errors, problems | "Submission rejected" |
| `info` | Informational | "Processing your cards" |
| (default) | Neutral states | Normal content |

### Text Appearance

```tsx
<Text appearance="subdued">Secondary information</Text>
<Text appearance="success">Positive message</Text>
<Text appearance="critical">Error or warning</Text>
```

### Badge Tones

```tsx
<Badge tone="success">Completed</Badge>
<Badge tone="warning">Pending</Badge>
<Badge tone="critical">Rejected</Badge>
<Badge tone="info">Processing</Badge>
<Badge>Default</Badge>
```

### Banner Status

```tsx
<Banner status="info">Informational message</Banner>
<Banner status="warning">Warning message</Banner>
<Banner status="critical">Error message</Banner>
<Banner status="success">Success message</Banner>
```

---

## Component Patterns

### Hero/CTA Card (Conversion-Focused)

```tsx
<Card>
  <BlockStack spacing="base">
    <Text emphasis="bold" size="large">
      Turn Your Cards Into Value
    </Text>
    <Text>
      Get up to 70% of market value, with a 10% bonus
      when you choose store credit.
    </Text>
    <Link to={TRADE_IN_URL} external>
      Start a Trade-In →
    </Link>
  </BlockStack>
</Card>
```

### Benefits List (Trust-Building)

```tsx
<Card>
  <BlockStack spacing="base">
    <Text emphasis="bold">Why Trade With Us?</Text>
    <BlockStack spacing="tight">
      <Text>✓ Competitive prices based on live market data</Text>
      <Text>✓ 10% bonus when you choose store credit</Text>
      <Text>✓ Fast processing - typically 2-3 business days</Text>
      <Text>✓ Free shipping on orders over £50</Text>
    </BlockStack>
  </BlockStack>
</Card>
```

### Process Steps (Clear Navigation)

```tsx
<Card>
  <BlockStack spacing="base">
    <Text emphasis="bold">How It Works</Text>

    <InlineStack spacing="base" blockAlignment="start">
      <Text emphasis="bold">1.</Text>
      <BlockStack spacing="extraTight">
        <Text emphasis="bold">Search & Add Cards</Text>
        <Text size="small" appearance="subdued">
          Find your cards and select their condition
        </Text>
      </BlockStack>
    </InlineStack>

    {/* Repeat for steps 2, 3, 4... */}
  </BlockStack>
</Card>
```

### Simple CTA (Minimal)

```tsx
<Card>
  <BlockStack spacing="base" inlineAlignment="center">
    <Text>Ready to get started?</Text>
    <Link to={TRADE_IN_URL} external>
      Start Your Trade-In Now →
    </Link>
  </BlockStack>
</Card>
```

### Profile Widget (Compact)

```tsx
<Card title="Trade-In Program">
  <BlockStack spacing="base">
    <Text>
      Turn your trading cards into store credit or cash.
    </Text>
    <Link to={TRADE_IN_URL} external>
      Start a Trade-In →
    </Link>
  </BlockStack>
</Card>
```

### Footer Banner (Promotional)

```tsx
<Banner status="info">
  <InlineStack
    inlineAlignment="space-between"
    blockAlignment="center"
    spacing="base"
  >
    <BlockStack spacing="none">
      <Text emphasis="bold">Have trading cards to sell?</Text>
      <Text size="small">
        Get up to 70% of market value + 10% bonus with store credit
      </Text>
    </BlockStack>
    <Link to={TRADE_IN_URL} external>Start Trade-In →</Link>
  </InlineStack>
</Banner>
```

---

## Limitations & Constraints

### Critical Constraints

| Constraint | Impact | Workaround |
|------------|--------|------------|
| **No CSS override** | Cannot match exact Sleek styles | Use semantic components, rely on merchant branding |
| **No network access** (without approval) | Cannot fetch data from API | Link to storefront pages, use static content |
| **Sandbox isolation** | Limited web APIs | Use Shopify-provided APIs only |
| **No custom HTML** | Cannot render arbitrary elements | Use only Shopify components |

### Design Implications

1. **Cannot perfectly match Sleek theme** - Extensions inherit merchant's account branding
2. **No custom fonts** - Typography controlled by Shopify
3. **No custom colors** - Must use semantic tones (success, warning, etc.)
4. **No animations** - Cannot add custom transitions
5. **No icons** - Limited to emoji and text-based indicators

### Best Approach

Since we cannot style extensions to match Sleek exactly:
- Focus on **content quality** and **clear messaging**
- Use **semantic components** correctly
- Maintain **consistent hierarchy**
- Leverage **external links** to storefront for rich experiences
- Keep extensions **simple and focused**

---

## Integration Plan

### Current State

Three extension targets:
1. `customer-account.page.render` → Trade-In Program info page
2. `customer-account.profile.block.render` → Profile widget
3. `customer-account.footer.render-after` → Footer CTA banner

### Design Alignment with Sleek

| Sleek Feature | Extension Implementation |
|---------------|-------------------------|
| Card-based layout | Use `<Card>` for each section |
| Clear typography hierarchy | Use proper Text emphasis/size |
| Conversion-focused CTAs | Action-oriented links with arrows |
| Benefits/trust building | Checkmark lists, clear value props |
| Mobile-first | Use BlockStack for vertical flow |
| Clean whitespace | Use appropriate spacing values |

### Recommended Structure

**Trade-In Page (`TradeInPage.tsx`):**
```
Page: "Trade-In Program"
├── Card: Hero/CTA (primary value proposition)
├── Card: How It Works (4-step process)
├── Card: Benefits (trust builders)
└── Card: Final CTA (centered)
```

**Profile Widget (`ProfileWidget.tsx`):**
```
Card: "Trade-In Program"
├── Text: Brief description
└── Link: Start Trade-In →
```

**Footer CTA (`FooterCTA.tsx`):**
```
Banner: info status
├── BlockStack: Title + subtitle
└── Link: Start Trade-In →
```

---

## Implementation Reference

### File Structure

```
extensions/trade-in-account/
├── shopify.extension.toml    # Extension config
└── src/
    ├── TradeInPage.tsx       # Full page extension
    ├── ProfileWidget.tsx     # Profile block
    └── FooterCTA.tsx         # Footer banner
```

### Extension Configuration

```toml
# shopify.extension.toml
api_version = "2025-07"

[[extensions]]
name = "Trade-In Program"
handle = "trade-in-page"
type = "ui_extension"
  [[extensions.targeting]]
  target = "customer-account.page.render"
  module = "./src/TradeInPage.tsx"

[[extensions]]
name = "Trade-In"
handle = "trade-in-profile"
type = "ui_extension"
  [[extensions.targeting]]
  target = "customer-account.profile.block.render"
  module = "./src/ProfileWidget.tsx"

[[extensions]]
name = "Trade-In CTA"
handle = "trade-in-footer"
type = "ui_extension"
  [[extensions.targeting]]
  target = "customer-account.footer.render-after"
  module = "./src/FooterCTA.tsx"
```

### URL Constants

```typescript
// Use consistent URL across all extensions
const TRADE_IN_URL = 'https://www.cambridgetcg.com/pages/trade-in';
```

---

## Testing Checklist

### Design Validation

- [ ] Extensions render correctly on mobile (375dp)
- [ ] Extensions render correctly on tablet (750dp)
- [ ] Extensions render correctly on laptop (1000dp)
- [ ] Text is readable and properly sized
- [ ] Spacing is consistent
- [ ] Links work and open correctly (external)

### Content Validation

- [ ] No app branding visible
- [ ] Content represents merchant voice
- [ ] CTAs are action-oriented
- [ ] Benefits are clearly communicated
- [ ] No spelling/grammar errors

### Accessibility

- [ ] Proper heading hierarchy
- [ ] Sufficient color contrast
- [ ] Links have descriptive text
- [ ] Screen reader compatible

---

## Resources

- [Shopify Customer Account UI Extensions](https://shopify.dev/docs/api/customer-account-ui-extensions)
- [Polaris Web Components](https://shopify.dev/docs/api/customer-account-ui-extensions/latest/polaris-web-components)
- [UX Guidelines](https://shopify.dev/docs/apps/build/customer-accounts/ux)
- [Figma UI Kit](https://www.figma.com/community/file/1554582792754361051)
- [Sleek Theme Docs](https://docs.foxecom.com/sleek-theme)

---

*Document created for CardForum Trade-In integration with Sleek theme.*
