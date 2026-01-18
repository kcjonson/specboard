# COMPLETE - 2026-01-18

# Git Workflow UI for Doc Editor

Add git workflow capabilities to the documentation editor: file change indicators, auto-save, and commit UI.

## Terminology

- **Auto-save** - Write file to disk automatically (frequent, as you type)
- **Commit** - Git commit + push (manual, user-initiated)
- **Changed files** - Files with uncommitted changes (saved to disk but not committed)

## Requirements

1. **File tree change indicators** - Show which files have uncommitted changes
2. **Auto-save** - Remove save button, auto-save with localStorage backup + server persistence
3. **Git status UI** - At top of file tree showing branch and changed file count, with commit button
4. **Commit flow** - Stage all → commit → push, with auto-generated message (optional customization)
5. **Error handling** - Show banners for save failures and git commit failures
6. **Deleted files** - Show greyed out in tree with restore option
7. **Pull latest** - Button at bottom of file tree to pull from remote

## Implementation Plan

### Phase 1: API Endpoints

**New file:** `api/src/handlers/storage/git-handlers.ts`

Create endpoints:

1. `GET /api/projects/:id/git/status`
   - Returns: `{ branch, ahead, behind, changedFiles: [{ path, status }] }`
   - Includes deleted files with status: 'deleted'

2. `POST /api/projects/:id/git/commit`
   - Body: `{ message?: string }`
   - Auto-generates message if not provided
   - Returns: `{ success, sha?, error?: { stage, message } }`

3. `POST /api/projects/:id/git/restore`
   - Body: `{ path: string }`
   - Restores a deleted file from git
   - Returns: `{ success, path }`

4. `POST /api/projects/:id/git/pull`
   - Pulls latest from remote
   - Returns: `{ success, error?: string }`
   - No conflict handling - just succeeds or fails

**Modify:** `api/src/index.ts` - Add routes

### Phase 2: GitStatusModel

**New file:** `shared/models/src/GitStatusModel.ts`

```typescript
class GitStatusModel extends Model {
  projectId: string
  branch: string
  changedFiles: ChangedFile[]
  loading: boolean
  committing: boolean
  pulling: boolean
  commitError: CommitError | null
  pullError: string | null

  hasChanges(path: string): boolean
  getChangeStatus(path: string): 'added' | 'modified' | 'deleted' | null
  isDeleted(path: string): boolean
  async refresh(): Promise<void>
  async commit(message?: string): Promise<CommitResult>
  async restore(path: string): Promise<boolean>
  async pull(): Promise<{ success: boolean; error?: string }>
  clearError(): void
}
```

**Modify:** `shared/models/src/index.ts` - Export

### Phase 3: Auto-Save with Error Handling

**Modify:** `shared/pages/Editor/Editor.tsx`

Two-tier auto-save:
1. **localStorage (immediate)** - Every content change
2. **Server save (debounced 2-3s)** - Persists to disk

Immediate server saves:
- File switch, New file, Delete file

Error handling:
- Track save errors, show banner, retry with backoff
- Banner: "Changes saved locally. Server save failed. Retrying..."

**Modify:** `shared/pages/Editor/EditorHeader.tsx`
- Remove save button
- Add subtle save spinner

### Phase 4: Error Banners

**New file:** `shared/pages/Editor/SaveErrorBanner.tsx`
- Warning banner for save failures with retry

**New file:** `shared/pages/FileBrowser/CommitErrorBanner.tsx`
- Different messages for commit/push/merge failures

### Phase 5: File Tree Change Indicators

**Modify:** `shared/pages/FileBrowser/FileBrowser.tsx`

1. Add prop: `gitStatus?: GitStatusModel`
2. Change indicator dot for modified/added files
3. **Deleted files:**
   - Include deleted files from gitStatus in the tree
   - Render greyed out with strikethrough
   - When clicked: show "File deleted" message with restore button
4. Refresh git status after file operations

**Modify:** `shared/pages/FileBrowser/FileBrowser.module.css`

```css
.changeIndicator {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  margin-left: auto;
}
.changeIndicator[data-status="modified"] { background: var(--color-warning); }
.changeIndicator[data-status="added"] { background: var(--color-success); }
.changeIndicator[data-status="deleted"] { background: var(--color-error); }

.deleted {
  opacity: 0.5;
  text-decoration: line-through;
}
```

### Phase 6: Deleted File View

**Modify:** `shared/pages/Editor/Editor.tsx`

When a deleted file is selected:
- Don't load file content
- Show empty state: "This file has been deleted"
- Show "Restore from Git" button
- After restore, refresh and load file

### Phase 7: Git Status Bar Component

**New file:** `shared/pages/FileBrowser/GitStatusBar.tsx`

At top of file tree:
- Branch name with git icon
- Changed files count
- Commit button (when changes exist)
- Optional message input on commit click
- Error banner when commit fails

**New file:** `shared/pages/FileBrowser/GitStatusBar.module.css`

### Phase 8: Pull Latest Button

**New file:** `shared/pages/FileBrowser/PullButton.tsx`

At bottom of file tree sidebar:
- "Pull Latest" button with sync icon
- Spinner during pull
- On success: refresh file tree and git status
- On error: show simple error message

**New file:** `shared/pages/FileBrowser/PullButton.module.css`

**Modify:** `shared/pages/FileBrowser/FileBrowser.tsx`
- Add GitStatusBar at top
- Add PullButton at bottom

### Phase 9: Integration

**Modify:** `shared/pages/Editor/Editor.tsx`
- Pass `gitStatusModel` to FileBrowser
- Handle deleted file selection
- Render SaveErrorBanner

## Files Summary

### New Files
- `api/src/handlers/storage/git-handlers.ts`
- `shared/models/src/GitStatusModel.ts`
- `shared/pages/FileBrowser/GitStatusBar.tsx`
- `shared/pages/FileBrowser/GitStatusBar.module.css`
- `shared/pages/FileBrowser/PullButton.tsx`
- `shared/pages/FileBrowser/PullButton.module.css`
- `shared/pages/Editor/SaveErrorBanner.tsx`
- `shared/pages/Editor/SaveErrorBanner.module.css`
- `shared/pages/FileBrowser/CommitErrorBanner.tsx`
- `shared/pages/FileBrowser/CommitErrorBanner.module.css`

### Modified Files
- `api/src/index.ts` - Add git routes
- `shared/models/src/index.ts` - Export GitStatusModel
- `shared/pages/Editor/Editor.tsx` - Auto-save, deleted file handling
- `shared/pages/Editor/EditorHeader.tsx` - Remove save button
- `shared/pages/Editor/EditorHeader.module.css`
- `shared/pages/FileBrowser/FileBrowser.tsx` - Change indicators, GitStatusBar, PullButton
- `shared/pages/FileBrowser/FileBrowser.module.css`

## Error States

### Save Errors
| State | Banner Message | Action |
|-------|---------------|--------|
| Server error | "Changes saved locally. Server error - retrying..." | Retry Now |

### Commit Errors
| Stage | Banner Message | Action |
|-------|---------------|--------|
| Commit failed | "Commit failed: [message]" | Try Again |
| Push failed | "Committed but push failed: [message]" | Retry Push |
| Merge failed | "Pushed but merge failed: [message]" | Info |

### Pull Errors
| State | Message |
|-------|---------|
| Failed | "Pull failed: [message]" |

## Data Flow

```
User types → localStorage (immediate) + Server save (debounced 2-3s)
                    ↓
          Refresh GitStatusModel
                    ↓
    FileBrowser shows change indicators
    (deleted files greyed out)
                    ↓
    User clicks "Commit" → git add → commit → push
                    ↓
    Refresh status (changedFiles empty on success)

Pull Latest:
    Click "Pull Latest" → POST /api/git/pull → Refresh on success

Restore Deleted:
    Select deleted file → Show restore button → POST /api/git/restore → Refresh
```

## Verification

1. **localStorage**: Edit file, localStorage updated immediately
2. **Server save**: Wait 3s, file on disk updated
3. **Save spinner**: Subtle spinner during save
4. **Save on switch**: Edit A, switch to B, A saved
5. **Delete file**: Shows greyed out in tree
6. **Select deleted**: Shows "File deleted" + restore button
7. **Restore file**: Restores and reappears
8. **Change indicators**: Dots for changed files
9. **Git status bar**: Branch name and change count
10. **Commit**: Files committed to git
11. **Pull latest**: Files updated from remote
12. **Save failure**: Banner with retry
13. **Commit failures**: Stage-specific banners
