# UI Library & Design System Specification

This specification defines the shared UI component library and design token system.

---

## Overview

Establish consistent, well-structured UI primitives in `@specboard/ui` with proper component APIs, design tokens, and icon management.

---

## Requirements

### Component API Standards
- Button: use `label` and `icon` props, not children
- Consistent prop patterns across all components
- Proper TypeScript interfaces for all component props

### Icon System
- Icons in individual files (not one monolithic file)
- Tree-shakeable icon imports
- Consistent sizing and color inheritance

### Design Tokens
- Refine `tokens.css` with complete token coverage
- Spacing, typography, color, shadow, border radius scales
- Document token usage guidelines

### Component Library
- Audit and refine existing shared components
- Custom checkbox with checked/unchecked/partial states
- Consistent patterns for form elements

---

## Component Contracts

Contracts established by the small-screen work (2026-08). They build on the breakpoint, capability-query, and keyboard rules in [tech-stack.md](../tech-stack.md#responsive-strategy).

### Dialog

`Dialog` wraps native `<dialog>` + `showModal()`: focus trap, inert background, ESC (the `cancel` event), and top-layer rendering come from the platform. Consumers stay controlled — `cancel` is prevented and routed to `onClose`; there is no `method="dialog"` close path. Open/close animates in CSS via `@starting-style` and `transition-behavior: allow-discrete`; consumers that unmount instead of toggling `open` get an instant close, which is accepted. Body scroll locks globally via `body:has(dialog:modal) { overflow: hidden }` in `elements/dialog.css`.

Below the breakpoint every dialog is a full-screen slide-up takeover, and the header always renders with a close X even when desktop hides it — everything must be closable on a small screen.

### DialogFooter

The one action-row pattern for dialog, drawer, and detail footers. DOM order is secondary first, primary last (desktop reads left to right); below the breakpoint the row stacks full-width via `column-reverse`, putting the primary on top without changing tab order. An optional `start` slot left-aligns destructive/tertiary actions (e.g. ProjectDialog's Delete). Don't hand-roll footer flex rows.

### ResizablePanel

The panel publishes its width as the `--panel-width` custom property rather than an inline `width` style, so consumer CSS can reposition it without `!important` or cascade-order gambling. Below the breakpoint it neutralizes itself: `width: auto`, handle hidden, no self-sizing — the consumer's class owns positioning, in practice a fixed full-screen takeover. One DOM serves both sizes; CSS alone switches the presentation.

Panel takeovers (planning item drawer, editor file browser and chat) deliberately do not use `<dialog>`: they coexist with routing and autosave rather than being modal, and staying out of the top layer preserves the layering doctrine below.

### Layering

Native `<dialog>` renders in the browser top layer, above every z-index token — modal dialogs need no z value. `--z-modal` is the layer for non-dialog full-screen takeovers (panel/drawer overlays on small screens); `--z-dropdown` stays below it so in-page chrome never covers a takeover.

---

## Dependencies

None

## Status

Needs design
