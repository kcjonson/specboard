# Kanban Board UI Specification

This specification defines the user interface and interactions for the kanban board.

---

## Overview

A lightweight, keyboard-first kanban board with:
- Three fixed columns (Ready, In Progress, Done) plus a Blocked column that
  appears only while an item is held at status `blocked` (see
  [item-relationships.md](item-relationships.md))
- Epic → Task two-level hierarchy
- Drag-and-drop with keyboard alternatives
- Sub-500ms performance target

---

## Layout

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Header                                                    [User] [Settings] │
│  ┌─────────────┐                                                            │
│  │ Project ▼   │  [Search /]                              [+ New Epic]      │
│  └─────────────┘                                                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐          │
│  │ Ready        (3) │  │ In Progress  (2) │  │ Done         (5) │          │
│  │ ─────────────────│  │ ─────────────────│  │ ─────────────────│          │
│  │                  │  │                  │  │                  │          │
│  │ ┌──────────────┐ │  │ ┌──────────────┐ │  │ ┌──────────────┐ │          │
│  │ │ Epic Card    │ │  │ │ Epic Card    │ │  │ │ Epic Card    │ │          │
│  │ │              │ │  │ │              │ │  │ │              │ │          │
│  │ └──────────────┘ │  │ └──────────────┘ │  │ └──────────────┘ │          │
│  │                  │  │                  │  │                  │          │
│  │ ┌──────────────┐ │  │ ┌──────────────┐ │  │ ┌──────────────┐ │          │
│  │ │ Epic Card    │ │  │ │ Epic Card    │ │  │ │ Epic Card    │ │          │
│  │ │              │ │  │ │              │ │  │ │              │ │          │
│  │ └──────────────┘ │  │ └──────────────┘ │  │ └──────────────┘ │          │
│  │                  │  │                  │  │                  │          │
│  │ ┌──────────────┐ │  │                  │  │ ┌──────────────┐ │          │
│  │ │ Epic Card    │ │  │                  │  │ │ Epic Card    │ │          │
│  │ │              │ │  │                  │  │ │              │ │          │
│  │ └──────────────┘ │  │                  │  │ └──────────────┘ │          │
│  │                  │  │                  │  │                  │          │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘          │
│                                                                              │
├─────────────────────────────────────────────────────────────────────────────┤
│  [?] Keyboard shortcuts    Press ? for help                                 │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Components

### Column

**Properties:**
- status: 'ready' | 'in_progress' | 'done'
- title: string
- epics: list of epics
- onDrop: handler for dropped epic

**Visual Design:**
- Fixed width: 320px
- Header: Status name + count badge. The count is the server's total for the status, not how many cards are loaded; while a search or type filter is active it is the filtered count instead.
- Scrollable content area
- Drop zone highlight on drag over
- Optional WIP limit indicator
- Ghost card (dashed outline, muted text) at the foot of a column when the server holds more of that status than is loaded: "Show more" plus "100 of 842". Clicking it loads the next page into the column. It sits below the drop zone (a drop over it lands at the end of the column) and is not part of keyboard traversal.

### Epic Card

**Properties:**
- epic: Epic data
- isSelected: boolean
- onSelect: selection handler
- onOpen: open detail handler
- onDragStart: drag handler

**Data Structure:**
```
Epic:
  id: string
  title: string
  status: 'ready' | 'in_progress' | 'done'
  rank: number
  tasks: Task[]
  assignee: User (optional)
```

**Visual Design:**
```
┌────────────────────────────────────────┐
│ ◆ Auth System                      👤  │  ← Title + Assignee avatar
│                                        │
│ ████████░░░░░░░░░░░░  3/7 tasks        │  ← Progress bar
│                                        │
│ #12 · Updated 2h ago                   │  ← ID + timestamp
└────────────────────────────────────────┘
```

**States:**
| State | Appearance |
|-------|------------|
| Default | Light background |
| Hover | Subtle elevation |
| Selected | Border highlight |
| Dragging | Elevated shadow, slight rotation |

### Task Card (in Epic Detail Modal)

**Properties:**
- task: Task data
- onToggleStatus: status toggle handler
- onEdit: edit handler

**Data Structure:**
```
Task:
  id: string
  title: string
  status: 'ready' | 'in_progress' | 'done'
  assignee: User (optional)
  dueDate: Date (optional)
```

**Visual Design:**
```
┌────────────────────────────────────────┐
│ ☐ Implement login form             👤  │
│   Due: Dec 25                          │
└────────────────────────────────────────┘

┌────────────────────────────────────────┐
│ ☑ Design login UI                  👤  │  ← Completed (strikethrough)
└────────────────────────────────────────┘
```

### Epic Detail Modal

```
┌─────────────────────────────────────────────────────────────────┐
│                                                            [×]  │
│  ◆ Auth System                                                  │
│  ──────────────────────────────────────────────────────────────│
│                                                                 │
│  Description                                        [Edit]      │
│  Implement user authentication including login,                 │
│  signup, and password reset flows.                              │
│                                                                 │
│  ──────────────────────────────────────────────────────────────│
│                                                                 │
│  Tasks (3/7)                                    [+ Add Task]    │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ ☑ Design login UI                                    👤 │   │
│  └─────────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ ☑ Implement login API                                👤 │   │
│  └─────────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ ☐ Implement login form                               👤 │   │
│  └─────────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ ☐ Add form validation                                👤 │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ──────────────────────────────────────────────────────────────│
│                                                                 │
│  Linked Documents                              [+ Link Doc]     │
│                                                                 │
│  📄 /requirements/auth.md                                       │
│  📄 /specs/login-flow.md                                        │
│                                                                 │
│  ──────────────────────────────────────────────────────────────│
│                                                                 │
│  Status: In Progress ▼        Assignee: @john ▼                │
│                                                                 │
│  [Delete Epic]                              [Move to Done →]   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Drag and Drop

### Behavior

1. **Grab**: Click and hold on epic card (200ms delay to allow click)
2. **Drag**: Card follows cursor with slight rotation
3. **Drop zones**: Other cards shuffle to show insertion point
4. **Release**: Card animates to final position

### Implementation Notes

- Use native drag events (no library for bundle size)
- Track: dragged epic ID, hover column, drop index
- On drag start: set dragged state, add visual feedback
- On drag over: calculate drop position, show insertion gap
- On drop: optimistic update, then API call
- On drag end: clear drag state

### Keyboard Alternative

| Shortcut | Action |
|----------|--------|
| `↑/↓` | Navigate between epics in column |
| `←/→` | Move epic between columns |
| `Shift+↑` | Move epic up in column (reorder) |
| `Shift+↓` | Move epic down in column (reorder) |

---

## Keyboard Shortcuts

### Global

| Shortcut | Action |
|----------|--------|
| `N` | Create new epic |
| `C` | Create new task (in selected epic) |
| `/` | Focus search |
| `Cmd+K` | Open command palette |
| `?` | Show shortcuts help |
| `Escape` | Close modal / Deselect |

### Navigation

| Shortcut | Action |
|----------|--------|
| `↑` | Select previous epic |
| `↓` | Select next epic |
| `←` | Select epic in left column |
| `→` | Select epic in right column |
| `Enter` | Open selected epic |
| `Tab` | Cycle through columns |

### Actions (on selected epic)

| Shortcut | Action |
|----------|--------|
| `M` | Assign to me |
| `1` | Move to Ready |
| `2` | Move to In Progress |
| `3` | Move to Done |
| `Shift+↑` | Move up (reorder) |
| `Shift+↓` | Move down (reorder) |
| `E` | Edit epic |
| `Delete` | Delete epic (with confirmation) |

---

## Quick Create

### Epic Quick Create

Press `N` anywhere:

```
┌────────────────────────────────────────────────────────────────┐
│  New Epic                                                      │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │ Epic title...                                            │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                                │
│  Press Enter to create, Escape to cancel                       │
└────────────────────────────────────────────────────────────────┘
```

- Inline input at top of "Ready" column
- Enter creates and focuses the new card
- Tab to add description before creating

### Task Quick Create

In epic detail modal, press `C` or click "+ Add Task":

```
┌──────────────────────────────────────────────────────────────┐
│ ☐ |                                                          │  ← Inline input
└──────────────────────────────────────────────────────────────┘
```

---

## Performance Optimizations

### Target: Sub-500ms Initial Load

1. **Minimal JavaScript bundle**
   - No heavy drag-drop library
   - Code-split modal components
   - Tree-shake unused code

2. **Bounded loading windows** (see "Loading windows" below)
   - Memoize epic cards
   - Batch state updates

3. **Optimistic updates**
   - Update UI immediately on user action
   - Sync to server in background
   - Revert on failure with error message

4. **Prefetch**
   - Prefetch epic details on hover
   - Cache API responses

### Loading windows

A project can hold thousands of items, so neither view loads the whole project. The
items collection keeps one window per status: the first N items by rank, requested
as `GET /items?status=<s>&limit=<N>`, one request per status. The response's
`X-Total-Count` header is how the client knows a status has more.

| View | Window per status | Affordance |
|------|-------------------|------------|
| Board | 100 cards per column | Ghost card at the foot of the column |
| Table | 200 rows per section | "Show more" row at the foot of the section |

The table also has a "Show done" toggle beside Expand all / Collapse all: a secondary
size-sm button with `aria-pressed`, showing a check while on. It is off by default,
which hides the Done section (usually the largest and least interesting), and the
choice is remembered per browser alongside the active view.

This is additive, not paged: "show more" widens that status's window by one page
and refetches it, so the loaded set only ever grows. The background poll re-requests
every window at its current width, which is what stops a refresh from shrinking a
column the user expanded. Switching from the board to the table widens every window
to the table's size; switching back leaves them wide.

Two consequences worth knowing:

- Each window request asks for one row past its limit. That row's rank marks where
  the window ends, and lets the client tell an item it moved or created past the
  window (still on the server, just outside the page) from one the server dropped.
  Locally moved items are kept, not removed, by the next poll, until a wider window
  returns them for real or the page reloads. A poll cannot see another client delete
  or move such an item, so a card can outlive the server row until then.
- Search and the type filter are the server's job, not the client's. They ride on
  every window request as `search=` / `type=`, and `X-Total-Count` comes back
  narrowed to match, so counts and "show more" go on meaning the same thing. A
  filter change is a different question rather than a wider window: it resets every
  window to its base size and drops what the old query was holding past them. The
  search box is debounced before it becomes a query; the type Select applies at once.
- A search matches items at any depth, so child items come back alongside top-level
  ones, carrying the `parentKey` they hang under. Both views render such a row in
  the section or column of the child's own status, labelled with that parent key,
  and clicking it opens the child like any other item.

---

## Design Tokens

### Colors

| Token | Value | Usage |
|-------|-------|-------|
| `--color-background` | #f8f9fa | Page background |
| `--color-surface` | #ffffff | Column background |
| `--color-surface-hover` | #f1f3f4 | Hover states |
| `--color-card` | #ffffff | Card background |
| `--color-text` | #1a1a1a | Primary text |
| `--color-text-muted` | #6b7280 | Secondary text |
| `--color-border` | #e5e7eb | Borders |
| `--color-ready` | #3b82f6 | Ready status |
| `--color-in-progress` | #f59e0b | In Progress status |
| `--color-done` | #10b981 | Done status |
| `--color-primary` | #3b82f6 | Primary actions |
| `--color-primary-hover` | #2563eb | Primary hover |
| `--color-success` | #10b981 | Success states |
| `--color-error` | #ef4444 | Error states |

### Dimensions

| Element | Value |
|---------|-------|
| Column width | 320px |
| Card padding | 12px |
| Card margin | 8px |
| Card border radius | 6px |
| Column border radius | 8px |

---

## Item URLs

An item has two URLs. `/projects/:slug/items/:key` is the standalone full-page view
and the canonical link for an item, the form any shared or copied link should take.
`/projects/:slug/planning/items/:key` is the board with that item's
drawer open; it exists so opening a card is a history entry Back can undo and moving
between cards replaces rather than piles up entries. The drawer URL is in-app only:
a document load of it (pasted link, reload, new tab) is redirected by the frontend
service to the standalone page, so following a link to an item never lands on a
board with a sidebar.

---

## Responsive Behavior

Shipped 2026-08. One 768px breakpoint (see [tech-stack.md](../tech-stack.md#responsive-strategy)):

| Breakpoint | Behavior |
|------------|----------|
| 768px and up | Three columns side by side; item opens in a resizable side drawer |
| Below 768px | Columns stack vertically, the board scrolls as one list; the table view drops to Title + Status (type, task count, and assignee stay visible in the item view); opening an item is a full-screen takeover closable via X, ESC, or browser back |

Drag-and-drop is native HTML5 DnD and does not fire on touch — status changes on small screens happen inside the item view. Touch DnD is a known follow-up, not planned for now.

---

## Accessibility

- Full keyboard navigation
- Focus indicators on all interactive elements
- ARIA labels for screen readers
- Color not sole indicator (icons + text)
- Drag-and-drop has keyboard alternative

### ARIA Roles

| Element | Role | Attributes |
|---------|------|------------|
| Column | listbox | aria-label="Column name" |
| Epic card | option | aria-selected, tabindex |
| Modal | dialog | aria-modal, aria-labelledby |

---

## Component Structure

```
packages/kanban/
├── src/
│   ├── components/
│   │   ├── Board.tsx
│   │   ├── Column.tsx
│   │   ├── EpicCard.tsx
│   │   ├── TaskCard.tsx
│   │   ├── EpicModal.tsx
│   │   ├── QuickCreate.tsx
│   │   ├── KeyboardHelp.tsx
│   │   └── index.ts
│   ├── hooks/
│   │   ├── useKeyboardNavigation.ts
│   │   ├── useDragDrop.ts
│   │   └── useEpics.ts
│   ├── styles/
│   │   ├── board.module.css
│   │   ├── column.module.css
│   │   ├── epic-card.module.css
│   │   └── tokens.css
│   └── index.ts
└── package.json
```
