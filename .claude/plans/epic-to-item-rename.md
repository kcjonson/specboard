# COMPLETE - 2026-03-07

# Rename Epic → Item in Planning UI Layer

## Context

The planning system now supports three work item types: `epic`, `chore`, and `bug`. All UI components and the frontend model are still named with "Epic" prefixes (e.g., `EpicCard`, `EpicModel`, `EpicDialog`), which is misleading since they handle all item types. This rename aligns the naming with the actual semantics.

## Scope

**Rename** the UI/component/model layer from `Epic*` to `Item*`.
**Keep** the API routes (`/api/.../epics`), database table (`epics`), and backend handler files (`api/src/handlers/epics.ts`, `shared/db/src/services/epics.ts`) unchanged — the backend naming is a separate concern.

## Renames

### Directories (4)
```
shared/planning/EpicCard/    → shared/planning/ItemCard/
shared/planning/EpicView/    → shared/planning/ItemView/
shared/planning/EpicDetail/  → shared/planning/ItemDetail/
shared/planning/EpicDialog/  → shared/planning/ItemDialog/
```

### Files within those directories (8)
```
EpicCard.tsx / EpicCard.module.css       → ItemCard.tsx / ItemCard.module.css
EpicView.tsx / EpicView.module.css       → ItemView.tsx / ItemView.module.css
EpicDetail.tsx / EpicDetail.module.css   → ItemDetail.tsx / ItemDetail.module.css
EpicDialog.tsx / EpicDialog.module.css   → ItemDialog.tsx / ItemDialog.module.css
```

### Model classes (`shared/models/src/planning.ts`)
```
EpicModel       → ItemModel
EpicsCollection → ItemsCollection
```

### Component/interface/prop renames (inside each file)
- `EpicCard` → `ItemCard`, prop `epic` → `item`
- `EpicView` → `ItemView`, prop `epic` → `item`
- `EpicViewExistingProps` → `ItemViewExistingProps`
- `EpicViewCreateProps` → `ItemViewCreateProps`
- `EpicViewProps` → `ItemViewProps`
- `EpicDetail` → `ItemDetail`, variable `epic` → `item`, `epicId` → `itemId`
- `EpicDialog` → `ItemDialog`, prop `epic` → `item`
- `EpicDialogExistingProps` → `ItemDialogExistingProps`
- `EpicDialogCreateProps` → `ItemDialogCreateProps`
- `EpicDialogProps` → `ItemDialogProps`
- `EpicCardProps` → `ItemCardProps`
- DOM attribute `data-epic-card` → `data-item-card`

### Variable renames in consuming files
- `Board.tsx`: `dialogEpic` → `dialogItem`, `handleSelectEpic` → `handleSelectItem`, `handleOpenEpic` → `handleOpenItem`, `handleCreateEpic` → `handleCreateItem`, `handleDeleteEpic` → `handleDeleteItem`, `columnEpics` → `columnItems`, etc.
- `Column.tsx`: prop `epics` → `items`, `onSelectEpic` → `onSelectItem`, `onOpenEpic` → `onOpenItem`, etc.
- `hooks/useKeyboardNavigation.ts`: `epicsByStatus` → `itemsByStatus`, `onSelectEpic` → `onSelectItem`, `onOpenEpic` → `onOpenItem`, `onCreateEpic` → `onCreateItem`, `onMoveEpic` → `onMoveItem`

### Import updates (all consuming files)
- `shared/planning/index.ts` — update all 4 re-exports
- `shared/models/src/index.ts` — update `EpicModel`/`EpicsCollection` exports
- `web/src/main.tsx` — `EpicDetail` → `ItemDetail`
- `shared/planning/Board/Board.tsx` — model + component imports
- `shared/planning/Column/Column.tsx` — model + component imports
- `shared/models/src/Collection.test.ts` — test class named `Epic` → `Item`
- `shared/models/src/SyncCollection.ts` — update JSDoc comment example

## Execution Order

1. Rename model classes in `shared/models/src/planning.ts` + update exports in `index.ts`
2. Use `git mv` to rename the 4 component directories
3. Update all internal references within each renamed component file
4. Update consuming files: Board.tsx, Column.tsx, useKeyboardNavigation.ts, main.tsx
5. Update barrel exports in `shared/planning/index.ts`
6. Update test file and JSDoc comments
7. Build to verify no broken references
8. Test in browser — open board, open dialog, open detail view

## Verification

- `docker compose exec frontend npm run build` (or check Vite HMR for errors)
- Open planning board, verify cards render
- Double-click a card to open dialog, verify it works
- Open detail page in new window, verify data loads
- Check browser console for import/reference errors
