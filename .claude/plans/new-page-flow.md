# COMPLETE - 2026-01-09

# New Page Flow Implementation

Add ability to create new markdown pages from the editor with inline rename (VS Code-style).

## Entry Points

1. **FileBrowser "+" button** - Creates in first root folder (or selected folder if implemented later)
2. **EditorHeader "New Page" button** - Creates in current document's directory, or first root if no doc open

## User Flow

1. User clicks "+" or "New Page"
2. Optimistic `untitled.md` entry appears in file tree with inline text input
3. Main area shows "Creating new file" notice (like "No file selected" state)
4. User types filename → Enter commits, Escape cancels
5. On commit: API creates file → tree refreshes → file opens in editor

## Files to Modify

### Backend

**`api/src/handlers/storage/file-handlers.ts`** - Add `handleCreateFile`
- `POST /api/projects/:id/files?path=/path/to/file.md`
- Validate path within roots, ensure .md extension
- Create file with empty content
- Return `{ path, success: true }`

**`api/src/routes.ts`** - Register the new route

### Models

**`shared/models/src/FileTreeModel.ts`** - Add pending file state
- `@prop accessor pendingNewFile: { parentPath: string } | null`
- `startNewFile(parentPath: string)` - Set pending state, insert placeholder entry
- `commitNewFile(filename: string): Promise<string>` - Call API, reload, return path
- `cancelNewFile()` - Clear pending state, remove placeholder

### UI Components

**`shared/pages/FileBrowser/FileBrowser.tsx`**
- Add "+" button in header (next to "Files" title)
- Render inline input for pending file entry
- Handle Enter (commit) and Escape (cancel)
- Pass `onFileCreated?: (path: string) => void` callback up
- Expose `startNewFile()` method via ref or callback prop

**`shared/pages/Editor/EditorHeader.tsx`**
- Add "New Page" button to actions
- Add `onNewPage?: () => void` prop

**`shared/pages/Editor/Editor.tsx`**
- Wire up `onNewPage` callback
- Compute target directory: `dirname(currentFilePath)` or `rootPaths[0]`
- Trigger creation flow in FileBrowser
- Handle `onFileCreated` to select new file
- Show "Creating new file" notice when pending file exists

**`shared/pages/Editor/Editor.module.css`**
- Add `creatingState` styles (similar to `emptyState`)

## Implementation Order

1. Backend: Create file endpoint
2. FileTreeModel: Pending file state and methods
3. FileBrowser: "+" button and inline rename UI
4. EditorHeader: "New Page" button
5. Editor: Wire everything together + "Creating new file" state

## Edge Cases

- No root folders added → disable "+" button
- File already exists → API returns error, show in UI
- Invalid filename (empty, slashes, etc.) → validate client-side
- Auto-add `.md` extension if not provided
