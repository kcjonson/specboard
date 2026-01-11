# COMPLETE - 2026-01-09

# Document-Driven Epic Creation

## Goal
Allow creating epics from spec documents in the Editor. Keep existing "New Epic" button in Planning for flexibility. UI-only enforcement, no DB constraints.

## Requirements
1. "Create Epic" button in Editor header (for .md files)
2. Keep "New Epic" button in Planning (no changes there)
3. Navigate to Planning page after epic creation
4. Show linked spec document in EpicView

---

## Implementation Tasks

### Task 1: API - New Endpoint
**File:** `api/src/handlers/epics.ts`

Add `handleGetEpicBySpec`:
- Route: `GET /api/projects/:projectId/epics/by-spec?path=<path>`
- Returns: `{ exists: boolean, epic?: { id, title } }`

**File:** `api/src/index.ts`
- Register route BEFORE `/:id` to avoid param collision

### Task 2: Frontend Model
**File:** `shared/models/src/planning.ts`

Add to EpicModel:
```typescript
@prop accessor specDocPath: string | undefined = undefined;
```

### Task 3: EditorHeader - Add Create Epic Button
**File:** `shared/pages/Editor/EditorHeader.tsx`

New props:
```typescript
projectId: string;
linkedEpicId?: string;
onCreateEpic?: () => void;
onViewEpic?: () => void;
```

UI:
- If `.md` file and no `linkedEpicId`: Show "Create Epic" button
- If `linkedEpicId` exists: Show "View Epic" button

### Task 4: Editor - Wire Up Epic Logic
**File:** `shared/pages/Editor/Editor.tsx`

Add:
1. State for `linkedEpicId`
2. On file load: fetch `GET /epics/by-spec?path=...` to check if epic exists
3. `handleCreateEpic`: POST to `/epics` with `specDocPath`, then navigate to Planning
4. `handleViewEpic`: Navigate to Planning with epic selected

### Task 5: EpicView - Show Linked Document
**File:** `shared/planning/EpicView/EpicView.tsx`

Replace "Linked Documents" placeholder with:
- Link to spec document (opens in Editor)
- Format: clickable path that navigates to `/projects/:id/pages?file=<path>`

---

## Files Summary

| File | Action |
|------|--------|
| `api/src/handlers/epics.ts` | MODIFY - add endpoint |
| `api/src/index.ts` | MODIFY - register new route |
| `shared/models/src/planning.ts` | MODIFY - add specDocPath |
| `shared/pages/Editor/EditorHeader.tsx` | MODIFY - add epic buttons |
| `shared/pages/Editor/Editor.tsx` | MODIFY - wire up epic logic |
| `shared/planning/EpicView/EpicView.tsx` | MODIFY - show spec link |

---

## Edge Cases

1. **Document deleted**: Epic remains with spec link (file just won't exist)
2. **Epic already exists for doc**: Show "View Epic" instead of "Create Epic"
3. **Non-markdown files**: Don't show epic buttons
4. **Multiple epics for same doc**: Allowed (no constraint) - UI shows first match

---

## Execution Order

1. API endpoint (lookup only, no validation)
2. EpicModel property
3. EpicView spec link (read-only)
4. Editor epic creation flow
