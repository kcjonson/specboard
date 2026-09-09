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

### Parent field (in the item detail)

Sits in the header's field row between Sub-Status and Assignee, reading
`SB-4 · UI Library & Design System` — key and title, joined server-side onto the
item as `parentKey` / `parentTitle`, so the row costs no extra request. Clicking
it opens the parent, the same callback every other item link in the view uses.

Tasks and bugs always show the field, reading `None` when they have no parent, so
one can be given where there is none. An epic shows it only when it actually has
a parent: a parented epic is legal but unusual, and every top-level epic carrying
an empty row would be noise.

`Change` opens the item picker below. It is a modal, not an inline combobox: the
field row is a compact 13px flex-wrap strip that has to survive a ~320px drawer,
and an expanding listbox inside it would reflow every other field. A "No parent"
row appears in the picker when the item has one, and promotes it to top-level.

Reparenting goes through the move route, never through a save of the item; the
server owns the cycle check and re-ranks the item to the bottom of its new
sibling group. A refusal ("Cannot move an item under itself or one of its
descendants") renders inline under the field row, in the server's own words.

### Item picker

One modal list of the project's items, used both here and by the documentation
editor to link a document to an item. Search runs on the server, one request per
settled keystroke (250ms), across every status at once — not through the board's
items collection, which would fire one request per status window per keystroke
and would move the board's own windows besides.

The opening list is the top-level set; a non-empty search widens the server's
query to every depth, so a nested item is one search away rather than
unreachable. Results are ordered by rank, not by relevance, so the page limit is
deliberately generous (100).

Where it picks a parent, the list is filtered to epics. That is a product choice
about the ordinary shape of a board, **not** a model rule: the schema puts no
type restriction on parenting at all (see
[item-relationships.md](item-relationships.md)).

### Child Row (in the item detail)

**Properties:**
- item: the parent item
- onOpenItem: opens a child's detail by key

Every item's detail lists its children, whatever the item's own type: a bug can
hold children too, and before this the detail view gave no way to see or add
them. A childless task or bug collapses to the header line alone.

**Data Structure:** the same child summary the table renders — `{ id, key, type,
title, status, blocked }`.

**Visual Design:**
```
◆ SB-41  Implement login form            ● In Progress
▲ SB-42  Session cookie is dropped   Blocked   ● Ready
```

There is deliberately no checkbox. A child is a first-class item with a status,
a sub-status, blockers, spec links, and an activity log; a checkbox writes
`status` alone and silently discards the rest, and it reads as a to-do that can
be ticked off in place when the honest action is to open the item. Loose,
unnumbered to-dos belong in the item's Checklist, which is what that affordance
was really being used for.

Only the first ten children render, with a "Show all N" line revealing the rest
in place (they are already loaded with the item). A forty-child epic is over a
thousand pixels of drawer ahead of Blockers, Specs, and the activity log — the
sections that answer why the work is stuck. The table shows every child, which
is right there: it has the horizontal room and no sections below to bury.

### Checklist (in the item detail)

**Properties:**
- projectSlug, itemKey

Scratch todos on one item, on every item type, sitting between Children and
Blockers. An entry is `{ id, text, status }` and nothing more, where `status` is
`todo` or `done` — a checklist status, not the board status a child item carries.
It is a union rather than a boolean because more states are expected, and a
boolean cannot grow into them without breaking the API.

Beyond that an entry has nothing: no key, no sub-status, no blockers, no spec
links, no activity log, nobody recorded as having ticked it. That is the whole
point of the primitive. A line that deserves any of those is not a checklist
entry, it is a child item, and it should be created as one.

Each write carries only the field it changes — a tick sends `{ status }`, a
rename sends `{ text }` — so ticking a box cannot overwrite a rename someone
made in between.

**Visual Design:**
```
Checklist (1/3)

[x] Drop the backup table                          Remove
[ ] Re-run the migration against a prod snapshot   Remove
[ ] Ask about the 500-char cap                     Remove

[ Add a checklist item...                     ]   + Add
```

The box toggles optimistically and reverts with an error if the write fails.
The row's text is an editable field that saves on blur, so a typo is fixable in
place; because the text is that field rather than the checkbox's label, the
box carries its accessible name in `aria-label` instead. Blanking the field
reverts rather than deleting, since Remove is the delete.

Reads and writes go through the checklist sub-resource, one entry at a time,
never as a `checklist` field on the item: an item PUT carries the whole model,
so the array would ride along on every unrelated title or status edit and
overwrite whatever an agent wrote in between. Ticking one box writes that one
entry, and the server rewrites only the matched element.

Escape in a draft or a half-typed rename dismisses that, not the drawer; with
nothing to dismiss it falls through and the drawer closes.

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
│  Children (3/7)                                  [+ Add ▾]      │
│                                                                 │
│  ◆ SB-38  Design login UI                          ● Done       │
│  ◆ SB-39  Implement login API                      ● Done       │
│  ◆ SB-40  Implement login form              Blocked  ● Ready    │
│  ▲ SB-41  Session cookie is dropped                ● Ready      │
│  Show all 7                                                     │
│                                                                 │
│  ──────────────────────────────────────────────────────────────│
│                                                                 │
│  Checklist (1/2)                                                │
│                                                                 │
│  [x] Drop the backup table                        Remove        │
│  [ ] Ask about the 500-char cap                   Remove        │
│                                                                 │
│  [ Add a checklist item...                ]       + Add         │
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

### Child Quick Create

In the item detail, `+ Add ▾` picks the child's type (Task by default, Bug or
Epic from the dropdown) and opens the create dialog with this item pre-set as the
parent. There is no one-field inline version: a child item is first-class work
with a type, a status, and a description, and creating one should look like it.
A failure surfaces in the section rather than being swallowed.

The create dialog carries its own Parent field, pre-filled that way and changed
through the same item picker. So the parent is not fixed by where creation
started: `+ New` from the toolbar can create a child, and `+ Add` under an epic
can create something that lands elsewhere (in which case it will not appear in
the list it was started from, which is the honest result). Creation passes the
parent in the payload — a different write path from the move route, which only
exists once the item does.

Loose ends that are not worth an item of their own go in the Checklist instead.

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

The board lives in `shared/planning/`, which is a feature directory rather than an npm
workspace: it has no `package.json`, so apps reach it through a Vite alias and a tsconfig
include and import from `@shared/planning`, not a package name. That is also why the root
`test` script names it explicitly instead of picking it up with the workspaces. There is
no `packages/` directory in this monorepo. Each component owns a directory, most with a
CSS module beside the component, and `index.ts` re-exports the ones consumers mount.

```
shared/planning/
├── Planning/            board shell: view toggle, windows, drawer routing (+ prefs.ts)
├── Board/               the columns
├── Column/              one status column
├── ItemCard/            a card on the board
├── Table/               table view (Table, ItemRow, ChildRow)
├── ViewToggle/          board / table switch
├── ItemView/            the item body: title, status, description, sections
├── ItemDrawer/          side panel the board opens; renders ItemView
├── ItemDetail/          full-page item route; loads the model, renders ItemView
├── BlockersSection/     the item's sub-resources, one section each
├── ChecklistSection/
├── ChildrenSection/
├── NotesSection/        (the activity log)
├── SpecsSection/
├── FilePicker/          spec-file browser the specs section opens
├── NewItemDialog/       dialog wrapper around the create form (no styles of its own)
├── NewItemForm/         the create form itself
├── RichTextEditor/      description / note editor (+ Toolbar, types)
├── TypeBadge/           epic / task / bug pill
├── hooks/               useKeyboardNavigation
├── utils/               actor, itemType, time
└── index.ts
```

State lives in `shared/models/src/planning.ts`, not in the component tree:
`ItemModel` / `ItemsCollection` for the board itself, and `BlockerModel`,
`ChecklistEntryModel`, `NoteModel`, `SpecModel` with their collections for the
item's sections. `ChildModel` is the summary shape a parent carries for each child.
