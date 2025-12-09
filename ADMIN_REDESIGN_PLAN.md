# Admin Trade-Ins Page Redesign Plan

## Problem Analysis

The current admin trade-ins pages use **inline React styles** that are:
- Inconsistent with the customer-facing theme
- Hard to maintain
- Not using design tokens
- Missing responsive considerations

The customer-facing theme extension uses a **professional CSS design system** with:
- CSS variables (`--ti-primary`, `--ti-accent`, etc.)
- Consistent spacing and typography
- Clean card-based components
- Responsive breakpoints
- Accessible color contrasts

## Solution: Unified Design System

Create a shared CSS stylesheet for the admin that uses the same design tokens as the customer theme, making the experience seamless across both contexts.

## Design Tokens (from customer theme)

```css
--ti-primary: #000000;
--ti-primary-hover: #333333;
--ti-accent: #10B981;
--ti-accent-hover: #059669;
--ti-error: #EF4444;
--ti-warning: #F59E0B;
--ti-success: #10B981;
--ti-text: #111827;
--ti-text-muted: #6B7280;
--ti-border: #E5E7EB;
--ti-bg: #FFFFFF;
--ti-bg-muted: #F9FAFB;
--ti-radius: 8px;
--ti-radius-lg: 12px;
--ti-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
--ti-shadow-lg: 0 10px 25px rgba(0, 0, 0, 0.15);
--ti-transition: 150ms ease;
```

## Status Badge Colors (consistent across both)

| Status | Background | Text |
|--------|------------|------|
| DRAFT | #f3f4f6 | #6b7280 |
| SUBMITTED | #dbeafe | #1d4ed8 |
| IN_TRANSIT | #dbeafe | #1d4ed8 |
| RECEIVED | #fef3c7 | #b45309 |
| GRADING | #fef3c7 | #b45309 |
| PENDING_APPROVAL | #ede9fe | #7c3aed |
| APPROVED | #d1fae5 | #059669 |
| COMPLETED | #d1fae5 | #059669 |
| CANCELLED | #fee2e2 | #dc2626 |
| RETURNED | #fee2e2 | #dc2626 |

## Implementation Steps

### Step 1: Create Admin CSS Module
Create `/app/styles/admin-trade-ins.css` with all styles using the same design tokens.

### Step 2: Rebuild Trade-Ins List Page
- Use CSS classes instead of inline styles
- Match the customer theme's card-based design
- Improve table/list layout for better scannability
- Add visual hierarchy

### Step 3: Rebuild Trade-In Detail Page
- Use CSS classes
- Better grading interface with card images
- Cleaner sidebar layout
- Improved action buttons

### Step 4: Ensure Responsive Design
- Mobile-friendly layouts
- Touch-friendly buttons
- Collapsible sections on small screens

## Component Design

### Submission List Item (Card-based)
```
┌─────────────────────────────────────────────────────────────────┐
│ ┌──────┐                                                        │
│ │Image │  TRD-202512-00001          [SUBMITTED]      £413.80   │
│ │      │  John Doe • 3 items • Store Credit                     │
│ └──────┘  Dec 9, 2025               [View →]                    │
└─────────────────────────────────────────────────────────────────┘
```

### Grading Item (Expanded)
```
┌─────────────────────────────────────────────────────────────────┐
│ ┌──────────┐  OP02 Portgas D. Ace Manga Parallel Alt Art        │
│ │          │  OP02-013 • Manga Parallel                         │
│ │  Card    │  ────────────────────────────────────              │
│ │  Image   │  Claimed: NM  →  Actual: [NM ▼]                   │
│ │          │  Quoted: £413.80                                   │
│ └──────────┘  ────────────────────────────────────              │
│              [Verify ✓]  [Adjust ⚡]  [Reject ✕]                │
└─────────────────────────────────────────────────────────────────┘
```

## File Changes Required

1. **New File**: `app/styles/admin-trade-ins.css`
2. **Modify**: `app/routes/app.trade-ins.tsx` - Replace inline styles with CSS classes
3. **Modify**: `app/routes/app.trade-ins.$id.tsx` - Replace inline styles with CSS classes
4. **Modify**: `app/routes/app.tsx` - Import the CSS file

## Benefits

1. **Consistency**: Same look across customer and admin
2. **Maintainability**: Changes in one place affect everywhere
3. **Performance**: CSS is cached, inline styles are not
4. **Accessibility**: Proper contrast ratios built-in
5. **Developer Experience**: Easier to read and modify code
