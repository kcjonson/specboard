# COMPLETE - 2026-03-07

# Add Work Item Types (Chore, Bug) to Planning Board

## Context

The planning board currently only supports "epics" — large work items linked to spec documents. The user needs lighter-weight item types:
- **Chore**: Small work item not linked to a spec doc (cleanup, config, etc.)
- **Bug**: Bug report, also not linked to documentation

Both live on the same kanban board, can contain tasks, and need full MCP access. A new **SplitButton** shared UI component is needed for the creation UX and must be documented on the UI demo page.

## Key Design Decisions

1. **Single table with `type` column** — epic/chore/bug share 90%+ of fields and behavior. A `type` column on the `epics` table avoids massive duplication.
2. **Keep `epics` naming internally** — Renaming to `work_items` across 30+ files is disruptive for no functional benefit.
3. **SplitButton for creation** — Main area defaults to "Epic" (one click), dropdown arrow reveals Chore/Bug options (two clicks). New shared UI component.
4. **Type is immutable** — Set at creation, not changeable via update.
5. **Add `create_item` MCP tool** — Full CRUD via MCP.

---

## Phase 1: Database Migration

**New: `shared/db/migrations/013_work_item_types.sql`**
- Add `type VARCHAR(10) NOT NULL DEFAULT 'epic'` to `epics` table
- CHECK constraint: `type IN ('epic', 'chore', 'bug')`
- Indexes on `type` and `(project_id, type)`
- Backward compatible: existing rows become `'epic'` automatically

## Phase 2: Shared DB Types & Services

**`shared/db/src/types.ts`**
- Add `EpicType = 'epic' | 'chore' | 'bug'`
- Add `type: EpicType` to `Epic` interface

**`shared/db/src/services/epics.ts`**
- Add `type` to `transformEpic()` output and all response interfaces (`EpicResponse`, `EpicSummary`, `CurrentWorkEpic`)
- Add optional `type?: EpicType` to `CreateEpicInput`, include in INSERT SQL
- Add optional `type` filter param to `getEpics()` and `getReadyEpics()`
- Do NOT add to `UpdateEpicInput` (immutable)

**`shared/db/src/index.ts`** — Ensure `EpicType` is re-exported

## Phase 3: API Layer

**`api/src/types.ts`** — Add `type?: EpicType` to `ApiEpic`

**`api/src/transform.ts`** — Add `type: epic.type` to `dbEpicToApi()`

**`api/src/validation.ts`** — Add `isValidType()` validating `['epic', 'chore', 'bug']`

**`api/src/handlers/epics.ts`**
- `handleListEpics`: Accept `type` query param, add SQL filter
- `handleCreateEpic`: Accept `type` in body, validate, default `'epic'`, include in INSERT
- `handleUpdateEpic`: Ignore `type` in body (immutable)

## Phase 4: Client Models

**`shared/models/src/planning.ts`**
- Add `ItemType = 'epic' | 'chore' | 'bug'` type export
- Add `@prop accessor type!: ItemType` to `EpicModel`
- Add `byType(type: ItemType)` to `EpicsCollection`

## Phase 5: UI — New Icons

**`shared/ui/src/Icon/Icon.tsx`**
- Add `'bug'` and `'wrench'` to `IconName` union
- Add stroke-based SVG paths (24x24 viewBox, matching Feather style)

## Phase 6: UI — SplitButton Component (NEW)

**New: `shared/ui/src/SplitButton/SplitButton.tsx`**
**New: `shared/ui/src/SplitButton/SplitButton.module.css`**

A compound button with a primary action area and a dropdown arrow. The first option is the default action displayed on the main button face:

```
[  + New Epic  |v]
               ↓
          ┌─────────┐
          │ Epic     │  ← first option (default)
          │ Chore    │
          │ Bug      │
          └─────────┘
```

Props interface (mirrors `SelectOption` pattern with per-option callbacks):
```typescript
export interface SplitButtonOption {
  /** Display text for this option */
  label: string;
  /** Unique identifier for this option */
  value: string;
  /** Called when this option is triggered (main click or dropdown select) */
  onClick: () => void;
  /** Optional icon to show next to the label in the dropdown */
  icon?: IconName;
}

export interface SplitButtonProps {
  /** Options list — first option is the default action shown on the main button */
  options: SplitButtonOption[];
  /** Optional prefix text before the default label (e.g., "+ New") */
  prefix?: string;
  /** Disabled state */
  disabled?: boolean;
  /** CSS classes passed through to root container */
  class?: string;
}
```

Behavior:
- **Main button click**: Calls `options[0].onClick()` (first option is default action)
- **Dropdown arrow click**: Opens/toggles menu showing all options
- **Dropdown option click**: Calls that option's `onClick()` callback, closes menu

Key implementation details:
- Root container uses `display: inline-flex` to join the two button sections
- Main area styled like primary button (uses `button.css` base styles) with `border-radius` only on left
- Dropdown arrow section: narrow button with chevron-down icon, `border-radius` only on right, left border separator
- Dropdown menu: absolutely positioned below, uses `--z-dropdown`, `--shadow-card`, `--color-surface` background
- Each dropdown option renders icon (if provided) + label, with hover highlight
- Click outside closes dropdown (event listener cleanup on unmount)
- Keyboard: Escape closes dropdown
- CSS module handles internal layout; inherits button styling from `elements.css`

**`shared/ui/src/index.ts`** — Export `SplitButton`, `SplitButtonProps`, `SplitButtonOption`

## Phase 7: UI — TypeBadge Component (NEW)

**New: `shared/planning/TypeBadge/TypeBadge.tsx`**
**New: `shared/planning/TypeBadge/TypeBadge.module.css`**

Small inline icon showing the work item type on cards:
- Maps: `epic` -> `file` icon, `chore` -> `wrench` icon, `bug` -> `bug` icon
- Tooltip with type label
- Subtle color tinting (bug: reddish via `--color-error`, chore: neutral via `--color-text-muted`)

**`shared/planning/index.ts`** — Export TypeBadge

## Phase 8: UI — Board & Card Updates

**`shared/planning/EpicCard/EpicCard.tsx`**
- Add `<TypeBadge type={epic.type} />` before the title in header
- Minor CSS update to `EpicCard.module.css` for title row layout

**`shared/planning/Board/Board.tsx`**
- Replace `<Button>+ New Epic</Button>` with `<SplitButton>` component
- State: `createType` tracks which type to create
- Options array with per-option callbacks that set `createType` and open the dialog:
  ```tsx
  const createOptions = [
    { label: 'Epic', value: 'epic', icon: 'file', onClick: () => openCreate('epic') },
    { label: 'Chore', value: 'chore', icon: 'wrench', onClick: () => openCreate('chore') },
    { label: 'Bug', value: 'bug', icon: 'bug', onClick: () => openCreate('bug') },
  ];
  <SplitButton options={createOptions} prefix="+ New" />
  ```
- Pass `createType` through to `EpicDialog` -> `EpicView`
- Update `handleCreateEpic` to include `type: createType`

**`shared/planning/EpicDialog/EpicDialog.tsx`**
- Add `createType?: ItemType` to `EpicDialogCreateProps`
- Dialog title: `'New ${TYPE_LABELS[createType]}'` / `'Edit ${TYPE_LABELS[epic.type]}'`
- Pass `createType` through to `EpicView`

**`shared/planning/EpicView/EpicView.tsx`**
- Add `createType?: ItemType` to `EpicViewCreateProps`
- Conditional: only show "Specification" section when `epic?.type === 'epic'`
- Type-aware labels: placeholder, create button, delete button, confirm dialog
- Include `type` in `onCreate` callback data

**`shared/planning/Column/Column.tsx`** — Update empty state text to "No items"

**`shared/planning/EpicDetail/EpicDetail.tsx`** — Type-aware labels (flows from EpicView)

## Phase 9: UI Demo Page

**`web/src/routes/ui-demo/UIDemo.tsx`**
- Add new "SplitButton" section following existing pattern (section > description > subsections)
- Demo: default state, with prefix text ("+ New"), with icons, disabled state
- Import `SplitButton` from `@specboard/ui`
- Add state for tracking selected value in demo

## Phase 10: MCP Tools

**`mcp/src/tools/epics.ts`**
- Update `get_ready_epics`: add optional `item_type` param with enum, pass to service
- Add new `create_item` tool:
  - Params: `project_id` (required), `title` (required), `type` (enum, default `'epic'`), `description` (optional), `status` (optional)
  - Calls the existing `createEpic` service with type
- Register in tool list and handler switch
- Update descriptions: "epic" -> "work item" where appropriate

**`mcp/src/tools/tasks.ts`** — Update `epic_id` descriptions to "parent work item (epic, chore, or bug)"

**`mcp/src/tools/progress.ts`** — Update `epic_id` descriptions similarly

---

## Files Summary

| File | Change |
|------|--------|
| `shared/db/migrations/013_work_item_types.sql` | **NEW** |
| `shared/db/src/types.ts` | Add `EpicType`, extend `Epic` |
| `shared/db/src/services/epics.ts` | Type in transforms, create, queries |
| `shared/db/src/index.ts` | Re-export `EpicType` |
| `api/src/types.ts` | Add `type` to `ApiEpic` |
| `api/src/transform.ts` | Add `type` to `dbEpicToApi()` |
| `api/src/validation.ts` | Add `isValidType()` |
| `api/src/handlers/epics.ts` | Type filter + type on create |
| `shared/models/src/planning.ts` | `ItemType`, `type` prop, `byType()` |
| `shared/ui/src/Icon/Icon.tsx` | Add `bug`, `wrench` icons |
| `shared/ui/src/SplitButton/SplitButton.tsx` | **NEW** — SplitButton component |
| `shared/ui/src/SplitButton/SplitButton.module.css` | **NEW** — SplitButton styles |
| `shared/ui/src/index.ts` | Export SplitButton |
| `shared/planning/TypeBadge/TypeBadge.tsx` | **NEW** |
| `shared/planning/TypeBadge/TypeBadge.module.css` | **NEW** |
| `shared/planning/EpicCard/EpicCard.tsx` | TypeBadge in header |
| `shared/planning/EpicCard/EpicCard.module.css` | Title row layout |
| `shared/planning/Board/Board.tsx` | SplitButton creation |
| `shared/planning/EpicDialog/EpicDialog.tsx` | Type-aware title, `createType` prop |
| `shared/planning/EpicView/EpicView.tsx` | Conditional spec section, type labels |
| `shared/planning/Column/Column.tsx` | Update empty state text |
| `shared/planning/EpicDetail/EpicDetail.tsx` | Type-aware labels |
| `shared/planning/index.ts` | Export TypeBadge |
| `web/src/routes/ui-demo/UIDemo.tsx` | SplitButton demo section |
| `mcp/src/tools/epics.ts` | Type filter, `create_item` tool |
| `mcp/src/tools/tasks.ts` | Update descriptions |
| `mcp/src/tools/progress.ts` | Update descriptions |

## Verification

1. **Database**: Run migration, verify existing epics have `type = 'epic'`
2. **API**: `GET /epics?type=chore`, `POST /epics` with `type: 'bug'`, verify type in responses
3. **UI**: Open board at `http://localhost`:
   - SplitButton shows "Epic" as default, dropdown reveals Chore/Bug
   - Creating each type shows correct icon badge on card
   - Epic detail shows spec doc section; chore/bug do not
   - Dialog titles reflect item type
   - Drag-drop works for all types
4. **UI Demo**: Visit UI demo page, verify SplitButton section with variants
5. **MCP**: Test `create_item` tool, `get_ready_epics` with `item_type` filter
6. **Backward compatibility**: Existing epics still load and function normally
