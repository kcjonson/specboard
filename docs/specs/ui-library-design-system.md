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

The one action-row pattern for dialog, drawer, and detail footers. DOM order is secondary first, primary last (desktop reads left to right); below the breakpoint the row stacks full-width via `column-reverse`, putting the primary on top without changing tab order. `pinned` keeps the footer in view at the bottom of a dialog whose body scrolls (a long form), so the primary action is never below the fold. Don't hand-roll footer flex rows.

### ConfirmDialog

The one "are you sure?" dialog, built on `Dialog` and `DialogFooter`: a title, a `message`, an optional monospace `detail` (a path) and a `warning`. When `onConfirm` returns a promise the dialog holds both buttons busy (with `busyText` on the confirm) until it settles, and a rejection is shown in the dialog as an alert, the server's message for a failed request, rather than closing. The caller closes it by flipping `open`. A danger confirm is a solid danger button (`danger solid`), since it is the committing action; the outline `danger` is for the button that opens the confirm. It is the one confirm path: item delete, file delete, pull over unsaved changes, and the project settings page's remove, revoke, leave and delete. Don't use `window.confirm()`, which freezes the page and can't show a failure.

### Busy buttons

`Button`'s `busy` marks a click in progress: `aria-busy`, clicks ignored, but the button stays enabled. Disabling the button that has focus drops focus to the page, so a pending action uses `busy` and keeps `disabled` for actions that aren't available at all (an empty form).

### Badge

Variants are `variant-primary`, `-success`, `-warning`, `-error` (solid) and `variant-warning-subtle` (tinted background, colored text) for status chips that sit inside a list, where a solid fill would outweigh the row.

### Notice

`announce` makes a notice a live region when it appears, an alert for `error` and a status otherwise. Use it for a notice that answers something the user just did (a save, a refused request); standing notices leave it off.

### Avatar

A person's picture (`avatarUrl`), or their initials when there is none or it fails to load: the first letters of the first and last words of the name. Sizes `xs` 20px, `sm` 24px, `md` 28px, `lg` 36px; tones `primary` and `muted`. It labels itself with the name (`role="img"`) unless `decorative`, for when the name is printed beside it. It is the only place initials are computed.

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
