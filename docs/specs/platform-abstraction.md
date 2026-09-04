# Platform Abstraction Specification

This specification defines the abstraction layer that allows the editor core to run unchanged on every target: browser, Electron (desktop), and Capacitor (iOS and Android).

> **Related Spec**: See [Project Storage](./project-storage.md) for how projects connect to git repositories and the storage provider architecture.

---

## Overview

The platform abstraction provides interfaces for:
- **File System** - Reading and writing files
- **Git Operations** - Commit, diff, status, etc.
- **System** - Platform detection, paths, dialogs

Each interface has three implementations:
- **Electron** - Uses Node.js APIs and local git CLI
- **Web** - Calls backend REST API
- **Capacitor** - Uses Capacitor plugins for device capability, and the same REST API as web for anything repository-shaped

This boundary is the only place a target is allowed to matter. See [shared-app-shell.md](./shared-app-shell.md) for the target matrix and what each shell contributes.

### Relationship to Project Storage

This spec defines the **platform-level** abstraction (Electron vs Web). The [Project Storage](./project-storage.md) spec defines the **storage-level** abstraction (local filesystem vs cloud checkout).

For web deployments:
- Frontend uses the platform-web implementation (REST API calls)
- Backend uses a StorageProvider to access files (local or cloud mode)
- The frontend is agnostic to where files are actually stored

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                       Editor Core                                │
│                                                                  │
│   import { useFileSystem, useGit } from '@specboard/platform' │
│                                                                  │
│   // Platform-agnostic code                                     │
│   content = await fs.readFile('/docs/readme.md')                │
│   await git.commit('Updated readme')                            │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ Dependency Injection
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Platform Provider                             │
│                                                                  │
│   <PlatformProvider implementation={electronPlatform}>          │
│     <App />                                                     │
│   </PlatformProvider>                                           │
└─────────────────────────────────────────────────────────────────┘
                              │
       ┌────────────────────┼────────────────────┐
       ▼                    ▼                    ▼
┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐
│  @specboard/     │ │  @specboard/     │ │  @specboard/     │
│ platform-electron│ │  platform-web    │ │platform-capacitor│
│                  │ │                  │ │                  │
│ - Node.js fs     │ │ - REST API calls │ │ - Capacitor      │
│ - child_process  │ │ - Backend git    │ │   Filesystem     │
│   git            │ │ - Browser        │ │ - REST API git   │
│ - Electron       │ │   dialogs        │ │ - Native share / │
│   dialogs        │ │                  │ │   browser        │
└──────────────────┘ └──────────────────┘ └──────────────────┘
```

---

## File System Interface

### Operations

| Method | Description |
|--------|-------------|
| `readFile(path)` | Read file contents as string |
| `readFileBuffer(path)` | Read file as binary ArrayBuffer |
| `exists(path)` | Check if file/directory exists |
| `stat(path)` | Get file metadata (size, dates) |
| `readDirectory(path)` | List immediate children |
| `readDirectoryRecursive(path)` | List all descendants |
| `writeFile(path, content)` | Write string to file |
| `createDirectory(path)` | Create directory (recursive) |
| `rename(oldPath, newPath)` | Rename/move file or directory |
| `delete(path)` | Delete file or directory |
| `watch(path, callback)` | Watch for changes, returns unsubscribe |

### Data Structures

```
FileEntry:
  name: string
  path: string
  type: 'file' | 'directory'
  size: number (optional)
  modifiedAt: Date (optional)

FileStat:
  size: number
  modifiedAt: Date
  createdAt: Date
  isDirectory: boolean
  isFile: boolean

WatchEvent:
  type: 'create' | 'update' | 'delete'
  path: string
```

### Electron Implementation

Uses Node.js `fs/promises` module:
- `readFile` → `fs.readFile(fullPath, 'utf-8')`
- `writeFile` → `fs.writeFile(fullPath, content, 'utf-8')`
- `readDirectory` → `fs.readdir(fullPath, { withFileTypes: true })`
- `watch` → uses `chokidar` for cross-platform file watching

**Security:** All paths are resolved relative to a base path. Path traversal attacks are prevented by checking that resolved path starts with base path.

### Web Implementation

Uses REST API calls:
- `readFile` → `GET /api/repos/:repoId/files?path=...`
- `writeFile` → `PUT /api/repos/:repoId/files` with path and content
- `readDirectory` → `GET /api/repos/:repoId/tree?path=...`
- `watch` → Polling (MVP) or WebSocket/SSE (future)

### Capacitor Implementation

Project files live in the cloud, so the same REST API calls as the web implementation. The Capacitor `Filesystem` plugin covers device-local needs only: caching, downloads, and anything the user explicitly saves out of the app.

Mobile is cloud-mode only. There is no local git checkout on a phone, and the contract has to say so rather than leaving callers to discover it.

---

## Git Interface

### Operations

| Method | Description |
|--------|-------------|
| `status()` | Get current repo status |
| `add(paths)` | Stage files for commit |
| `reset(paths)` | Unstage files |
| `commit(message)` | Create commit with message |
| `log(limit)` | Get recent commit history |
| `diff()` | Get unstaged changes |
| `diffFile(path)` | Get diff for specific file |
| `diffStaged()` | Get staged changes |
| `branches()` | List branches (Phase 2) |
| `currentBranch()` | Get current branch name |
| `checkout(branch)` | Switch branches (Phase 2) |
| `push()` | Push to remote |
| `pull()` | Pull from remote |

### Data Structures

```
GitStatus:
  staged: FileChange[]
  unstaged: FileChange[]
  untracked: string[]
  branch: string
  ahead: number
  behind: number

FileChange:
  path: string
  status: 'added' | 'modified' | 'deleted' | 'renamed'
  oldPath: string (for renames)

DiffResult:
  files: FileDiff[]

FileDiff:
  path: string
  hunks: DiffHunk[]

DiffHunk:
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: DiffLine[]

DiffLine:
  type: 'context' | 'add' | 'delete'
  content: string

CommitInfo:
  sha: string
  message: string
  author: string
  date: Date
```

### Electron Implementation

Shells out to git CLI:
- `status()` → `git status --porcelain -b`
- `add(paths)` → `git add "path1" "path2" ...`
- `commit(message)` → `git commit -m "message"`
- `diff()` → `git diff`
- `push()` → `git push`
- `pull()` → `git pull`

**Output Parsing:**
- Parse `--porcelain` format for status
- Parse unified diff format for diffs
- Parse `log --format` for commit info

### Web Implementation

Uses REST API calls:
- `status()` → `GET /api/repos/:repoId/git/status`
- `add(paths)` → `POST /api/repos/:repoId/git/add`
- `commit(message)` → `POST /api/repos/:repoId/git/commit`
- `diff()` → `GET /api/repos/:repoId/git/diff`
- `push()` → `POST /api/repos/:repoId/git/push`
- `pull()` → `POST /api/repos/:repoId/git/pull`

Backend executes git commands against repo stored on EFS.

### Capacitor Implementation

Identical to the web implementation. Git is remote-only on mobile.

---

## System Interface

### Operations

| Method | Description |
|--------|-------------|
| `platform` | Returns 'electron', 'web', 'ios', or 'android' |
| `isNative` | Boolean check (Electron or Capacitor) |
| `isWeb` | Boolean check |
| `showMessage(options)` | Show alert/confirm dialog |
| `showOpenDialog(options)` | File picker dialog |
| `showSaveDialog(options)` | Save file dialog |
| `copyToClipboard(text)` | Copy to clipboard |
| `readFromClipboard()` | Read from clipboard |
| `openExternal(url)` | Open URL in browser |
| `showInFolder(path)` | Reveal file in Finder/Explorer |

### Data Structures

```
DialogOptions:
  title: string (optional)
  message: string
  buttons: string[] (optional)
  defaultButton: number (optional)

FileDialogOptions:
  title: string (optional)
  defaultPath: string (optional)
  filters: array of
    name: string
    extensions: string[]
```

### Electron Implementation

Uses Electron's `dialog` and `shell` modules:
- `showMessage` → `dialog.showMessageBox()`
- `showOpenDialog` → `dialog.showOpenDialog()`
- `openExternal` → `shell.openExternal()`
- `showInFolder` → `shell.showItemInFolder()`
- Clipboard → `clipboard.writeText()` / `readText()`

### Web Implementation

Uses browser APIs:
- `showMessage` → Custom modal component
- `showOpenDialog` → Not available (no file picker in MVP)
- `copyToClipboard` → `navigator.clipboard.writeText()`
- `openExternal` → `window.open(url, '_blank')`
- `showInFolder` → Not available (desktop only)

### Capacitor Implementation

Uses Capacitor plugins:
- `showMessage` → the same custom modal component as web, so the dialog looks like the app rather than the OS
- `copyToClipboard` → `Clipboard.write()`
- `openExternal` → `Browser.open()`, which keeps the user in an in-app browser instead of losing them to Safari
- `showOpenDialog`, `showInFolder` → Not available

Capability that only exists here (secure token storage via `Preferences`, deep-link handling, share sheet, safe-area insets) also belongs on this interface rather than being reached for directly from a component.

---

## Platform Provider

### Usage

The editor core uses Preact context to access platform services:

```
// Editor code (platform-agnostic)
const fs = useFileSystem()
const git = useGit()
const system = useSystem()

content = await fs.readFile('/docs/readme.md')
await git.commit('Update readme')
system.copyToClipboard(content)
```

### Provider Setup

Electron app:
- Creates ElectronFileSystem with repo path
- Creates ElectronGit with repo path
- Creates ElectronSystem
- Wraps app in PlatformProvider

Web app:
- Creates WebFileSystem with API client and repo ID
- Creates WebGit with API client and repo ID
- Creates WebSystem
- Wraps app in PlatformProvider

Mobile app:
- Creates CapacitorFileSystem with API client and repo ID
- Reuses WebGit, since git is remote on mobile
- Creates CapacitorSystem
- Wraps app in PlatformProvider

The app itself is the same build in all three cases. Only the implementation handed to the provider changes.

---

## Package Structure

```
packages/
├── platform/
│   ├── src/
│   │   ├── types/
│   │   │   ├── filesystem.ts    # Interface definitions
│   │   │   ├── git.ts
│   │   │   └── system.ts
│   │   ├── provider.tsx         # Preact context
│   │   └── index.ts
│   └── package.json
│
├── platform-electron/
│   ├── src/
│   │   ├── filesystem.ts        # Node.js implementation
│   │   ├── git.ts               # Git CLI implementation
│   │   ├── system.ts            # Electron API implementation
│   │   └── index.ts
│   └── package.json
│
├── platform-web/
│   ├── src/
│   │   ├── filesystem.ts        # REST API implementation
│   │   ├── git.ts               # REST API implementation
│   │   ├── system.ts            # Browser API implementation
│   │   └── index.ts
│   └── package.json
│
└── platform-capacitor/
    ├── src/
    │   ├── filesystem.ts        # Capacitor Filesystem + REST API
    │   ├── system.ts            # Capacitor plugin implementation
    │   └── index.ts
    └── package.json
```

Note that `packages/` above is historical; these live under `shared/` in the current layout.

---

## Error Handling

All platform operations can throw errors. Errors are normalized to a common format:

```
PlatformError:
  code: string
  message: string
  originalError: Error (optional)
```

### Common Error Codes

| Code | Description |
|------|-------------|
| `FILE_NOT_FOUND` | File or directory doesn't exist |
| `PERMISSION_DENIED` | Access denied |
| `GIT_NOT_INITIALIZED` | Not a git repository |
| `GIT_CONFLICT` | Merge conflict |
| `NETWORK_ERROR` | API call failed |

---

## Testing

### Mock Implementations

For unit testing editor components, mock implementations are provided:

```
createMockFileSystem():
  - All methods are mock functions
  - Can configure return values per test

createMockGit():
  - All methods are mock functions
  - Can simulate various git states

createMockSystem():
  - All methods are mock functions
  - Can simulate dialogs, clipboard, etc.
```

### Test Setup

Wrap component under test with PlatformProvider using mocks:
1. Create mock instances
2. Configure expected behavior
3. Render component with PlatformProvider
4. Verify mock was called with expected arguments
