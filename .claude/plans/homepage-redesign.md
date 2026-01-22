# COMPLETE - 2026-01-22

# Specboard Homepage Redesign

## Implementation Status: COMPLETE
PR: https://github.com/kcjonson/doc-platform/pull/93

Files created/modified:
- ✅ `shared/ui/src/tokens.css` - Added accent color tokens (amber)
- ✅ `ssg/src/pages/home.tsx` - Complete rewrite with 11 sections
- ✅ `ssg/src/styles/home.css` - Complete rewrite with all section styles
- ✅ `api/src/handlers/waitlist.ts` - New waitlist signup handler
- ✅ `api/src/index.ts` - Added waitlist route, CSRF exclusion, rate limiting
- ✅ `shared/db/migrations/012_waitlist.sql` - Waitlist table migration

---

## Overview

Complete redesign of the public homepage from 5 sections to 11 comprehensive sections.

**New messaging:** "The briefing system for AI coding agents"

## Design Direction

### Color Palette

**Primary:** Keep existing blue (`#3b82f6`) for interactive elements
**Accent:** Warm amber/gold for highlights and badges

```css
/* New accent color tokens to add */
--color-accent: #f59e0b;           /* Amber - badges, highlights */
--color-accent-soft: #fef3c7;      /* Light amber bg */
--color-accent-dark: #d97706;      /* Darker amber for hover */

/* Dark mode accent */
--color-accent: #fbbf24;
--color-accent-soft: rgba(251, 191, 36, 0.15);
```

**Usage:**
- Hero badge: Amber background
- "New" or highlight labels: Amber
- Problem section icons: Amber (warning tone)
- Success states: Keep green
- Buttons/links: Keep blue

### Hero Visual: Connection Diagram

Abstract diagram showing three connected panels:

```
┌─────────────┐      ┌─────────────┐      ┌─────────────┐
│   📄 Docs   │──────│  📋 Kanban  │──────│  🤖 Agent   │
│             │  MCP │             │  MCP │             │
│  Specs &    │ ───► │  Epics &    │ ───► │  Context &  │
│  Requirements│      │  Tasks      │      │  Queries    │
└─────────────┘      └─────────────┘      └─────────────┘
        ▲                                        │
        └────────────── Progress ────────────────┘
```

**Implementation:** SVG with subtle animation potential
- Three rounded rectangles with icons
- Glowing connection lines (gradient stroke)
- Labels below each panel
- Subtle pulse animation on connections (CSS, not JS)

## Files to Modify

| File | Action |
|------|--------|
| `ssg/src/pages/home.tsx` | **Rewrite** - 11 sections + connection diagram SVG |
| `ssg/src/styles/home.css` | **Rewrite** - Full styles with accent colors |
| `shared/ui/src/tokens.css` | **Edit** - Add accent color tokens |
| `api/src/handlers/waitlist.ts` | **Create** - Early access form endpoint |
| `api/src/index.ts` | **Edit** - Add waitlist route |

## Section-by-Section Design

### 1. Hero
- **Background:** Subtle gradient (surface → background)
- **Badge:** Amber background, dark text, mono font
- **Headline:** Large, tight letter-spacing, max-width for readability
- **CTAs:** Primary blue + Secondary outline
- **Visual:** Connection diagram below CTAs

### 2. Who It's For
- **Layout:** Two-column grid, equal width
- **Cards:** White surface, subtle border, icon at top
- **Icons:** Document icon for Product, Code icon for Developers
- **Bullet style:** Blue dots (current pattern)

### 3. The Problem ⚡
- **Background:** Dark surface (`--color-surface` in dark, inverted in light mode)
- **Tone:** This is the "tension" section before the solution
- **Cards:** 4 pain points in 2x2 grid
- **Icons:** Amber/warning color
- **Optional:** Simple diagram showing fragmented tools

### 4. The Solution
- **Background:** Light (contrast from Problem section)
- **Layout:** 4 pillars in responsive grid
- **Cards:** Icon + title + description
- **Icons:** Blue primary color (positive/solution tone)

### 5. How It Works
- **Layout:** Horizontal 5-step flow on desktop, vertical on mobile
- **Connector:** SVG line connecting steps (dashed or gradient)
- **Step circles:** Blue background, white number
- **Role indicators:** Show who does each step (Product person vs Dev/Agent)

### 6. Comparison Table
- **Layout:** Full-width table with horizontal scroll on mobile
- **Sticky column:** First column (tool names) sticks on scroll
- **Row styling:** Alternating backgrounds, hover highlight
- **Indicators:** ❌ for problems, ✓ for solutions (with color)

### 7. Humans Stay in Control
- **Layout:** 2x3 grid of control points
- **Visual:** Simple diagram showing human approval loop
- **Tone:** Reassuring, builds trust
- **Icons:** Lock, check, eye, etc.

### 8. MCP-Native Architecture
- **Aesthetic:** Slightly technical feel
- **Code blocks:** Mono font for capability names
- **Background:** Subtle pattern or different surface color
- **Content:** MCP explanation + capability list

### 9. Your Data, Your Control
- **Layout:** 3 horizontal cards or simple list
- **Tone:** Trust-building, no lock-in
- **Icons:** Git, markdown, export icons

### 10. Early Access Form
- **Layout:** Centered, max-width ~500px
- **Fields:** Email (required), Company, Role, Use Case (optional, collapsed by default)
- **Submit button:** Primary blue, full-width
- **Benefits:** 2x2 grid with checkmarks below form
- **Success state:** Inline message, form hides

### 11. Final CTA
- **Background:** Surface with top border
- **Content:** Simple headline + button anchoring to form

## Typography Scale

```css
/* Headlines */
.hero h1          { font-size: clamp(2.25rem, 5vw, 3.5rem); }
.section h2       { font-size: clamp(1.75rem, 4vw, 2.25rem); }
.card h3          { font-size: 1.125rem; }

/* Body */
.hero-subtitle    { font-size: clamp(1rem, 2vw, 1.125rem); }
.card p           { font-size: 0.9375rem; }
.badge            { font-size: 0.8125rem; font-family: var(--font-mono); }
```

## Spacing System

```css
/* Section padding */
--section-padding: 4rem 1.5rem;      /* Desktop */
--section-padding-mobile: 2.5rem 1rem;

/* Content max-width */
--content-max-width: 1100px;
--content-narrow: 800px;

/* Grid gaps */
--grid-gap: 1.5rem;
--grid-gap-mobile: 1rem;
```

## Responsive Breakpoints

| Width | Layout Changes |
|-------|----------------|
| >1024px | Full desktop layouts |
| 768-1024px | Narrower content, some 2-col becomes 1-col |
| 480-768px | Most grids become single column |
| <480px | Mobile: stacked everything, larger touch targets |

## Implementation Order

### Phase 1: Foundation
1. Add accent color tokens to `tokens.css`
2. Set up section structure in `home.tsx` (placeholder content)
3. Create base CSS structure with section backgrounds

### Phase 2: Content & Layout
4. Hero section with connection diagram SVG
5. Who It's For two-column layout
6. Problem section (dark background)
7. Solution pillars
8. How It Works flow

### Phase 3: Tables & Forms
9. Comparison table with responsive scroll
10. Control section
11. MCP Architecture section
12. Data Control section
13. Early Access form (frontend only)

### Phase 4: Backend & Polish
14. Create waitlist API endpoint
15. Wire up form submission
16. Add form validation and success states
17. Responsive testing and fixes
18. Dark mode verification

## API Endpoint

**`POST /api/waitlist`**

```typescript
// Request
{
  email: string;      // required
  company?: string;
  role?: string;
  use_case?: string;
}

// Response 201
{ success: true }

// Response 400
{ error: "Email is required" }
```

Database: `waitlist_signups` table in existing Postgres.

## Verification Checklist

- [ ] SSG build succeeds
- [ ] All 11 sections render
- [ ] Connection diagram displays correctly
- [ ] Accent colors appear on badges/highlights
- [ ] Dark mode throughout
- [ ] Responsive: 1440, 1024, 768, 480, 375px
- [ ] Comparison table scrolls on mobile
- [ ] Anchor links scroll smoothly
- [ ] Form validates email
- [ ] Form submits to API
- [ ] Form shows success state
- [ ] Session detection works (Open App vs Sign In)

## Content Source

All copy from requirements document. Key phrases:
- "The briefing system for AI coding agents"
- "Write requirements. Set priorities. Your agents handle the rest."
- "The handoff to AI is broken"
- "One system. Structured context. Right docs for the right task."
