# Project Storage Specification

This specification defines how projects connect to git repositories for file storage, supporting both local development and cloud deployment.

---

## Overview

Every project in Specboard is backed by exactly **one git repository**. The editor is designed around git workflows: viewing file history, making commits, and pushing changes. This git-centric model is fundamental, not optional.

### Storage Modes by Platform

| Platform | Storage Mode | How It Works |
|----------|--------------|--------------|
| **Electron (desktop)** | Local | Backend reads from local filesystem, runs git commands locally |
| **Browser (web)** | Cloud only | Backend manages a git checkout on the server |

**Why browser can't use local mode:**
- Browsers cannot execute git commands (no shell access)
- The File System Access API only provides file read/write, not git operations
- All git operations (commit, push, pull) must run on a server

### Mode Details

- **Local Mode** (Electron only): Backend reads from a git repository on the local filesystem. User selects folder via native OS dialog. Git commands run locally.
- **Cloud Mode** (Browser): Backend clones the repository to managed server storage. User connects via GitHub OAuth. Git commands run on server.

The frontend is storage-agnostic—it uses the same API regardless of mode.

---

## Core Principles

1. **One Project = One Git Repository**
   - All files in a project must be within the same git repository
   - Adding folders from different repositories is not allowed

2. **Git is Required**
   - Folders must be inside a valid git repository
   - The backend validates this on folder addition

3. **Root Paths Limit Scope**
   - Projects can display a subset of the repository (e.g., only `/docs`)
   - Multiple root paths are allowed, but all must be in the same repo

4. **Frontend is Mode-Agnostic**
   - Same API endpoints work for both local and cloud modes
   - Frontend doesn't know or care where files are stored

---

## Architecture

```
Frontend (browser)
    │
    ├── POST /api/projects/:id/folders     ← Add folder (local mode)
    ├── POST /api/projects/:id/repository  ← Connect GitHub (cloud mode)
    ├── GET  /api/projects/:id/tree        ← List files
    ├── GET  /api/projects/:id/files?path= ← Read file
    └── PUT  /api/projects/:id/files?path= ← Write file
    │
    ▼
Backend (Hono)
    │
    └── StorageProvider (interface)
            │
            ├── LocalStorageProvider
            │   └── Reads/writes to configured local path
            │   └── Runs git commands in local repo
            │
            └── GitStorageProvider
                └── Manages clone on server (EFS/container storage)
                └── Runs git commands in managed checkout
```

---

## Data Model

### Project Schema

```typescript
interface Project {
  id: string
  name: string
  description?: string
  ownerId: string

  // Storage configuration
  storageMode: 'local' | 'cloud'
  repository: RepositoryConfig
  rootPaths: string[]  // Paths within repo to show, e.g., ['/docs', '/specs']

  createdAt: Date
  updatedAt: Date
}

interface RepositoryConfig {
  // For local mode: absolute path to repo root on user's machine
  localPath?: string  // e.g., /Users/me/projects/my-app

  // For cloud mode: remote repository info
  remote?: {
    provider: 'github'  // Future: 'gitlab' | 'bitbucket'
    owner: string       // e.g., 'acme-corp'
    repo: string        // e.g., 'documentation'
    url: string         // e.g., https://github.com/acme-corp/documentation
  }

  // Common to both modes
  branch: string        // e.g., 'main'
}
```

### Database Migration

```sql
-- Add storage columns to projects table
ALTER TABLE projects
  ADD COLUMN storage_mode TEXT NOT NULL DEFAULT 'none'
    CHECK (storage_mode IN ('none', 'local', 'cloud')),
  ADD COLUMN repository JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN root_paths JSONB NOT NULL DEFAULT '[]';

-- Example local project:
-- storage_mode: 'local'
-- repository: {
--   "localPath": "/Users/me/projects/docs",
--   "branch": "main"
-- }
-- root_paths: ["/"]

-- Example cloud project:
-- storage_mode: 'cloud'
-- repository: {
--   "remote": {
--     "provider": "github",
--     "owner": "acme-corp",
--     "repo": "documentation",
--     "url": "https://github.com/acme-corp/documentation"
--   },
--   "branch": "main"
-- }
-- root_paths: ["/docs"]
```

---

## Local Mode (Electron Only)

### Use Case

Developer running the **Electron desktop app** for:
- Initial documentation setup
- Editing docs while working in their IDE
- Testing before pushing to cloud

**Note:** Local mode is not available in the browser. Browser users must use cloud mode.

### Add Folder Flow

```
1. User clicks "Add Folder" in file browser
2. Electron shows native OS folder picker (dialog.showOpenDialog)
3. User selects folder: /Users/me/projects/my-app/docs
4. Frontend calls POST /api/projects/:id/folders
   Body: { "path": "/Users/me/projects/my-app/docs" }

5. Backend validates:
   a. Folder exists
   b. Folder is inside a git repository
   c. If project already has a repository, it's the same one

5. Backend stores:
   - repository.localPath = /Users/me/projects/my-app (repo root)
   - repository.branch = current branch (e.g., "main")
   - rootPaths += "/docs" (relative to repo root)

6. Response: success with updated project config
```

### Validation Logic

```typescript
async function addFolder(projectId: string, folderPath: string): Promise<void> {
  // 1. Verify folder exists
  if (!await fs.exists(folderPath)) {
    throw new ValidationError('FOLDER_NOT_FOUND', 'Folder does not exist')
  }

  // 2. Find git repository root
  const repoRoot = await git.findRepoRoot(folderPath)
  if (!repoRoot) {
    throw new ValidationError('NOT_GIT_REPO', 'Folder is not inside a git repository')
  }

  // 3. Get project
  const project = await projectService.getById(projectId)

  // 4. Check if project already has a different repository
  if (project.repository.localPath && project.repository.localPath !== repoRoot) {
    throw new ValidationError(
      'DIFFERENT_REPO',
      'Folder must be in the same git repository as existing folders'
    )
  }

  // 5. Calculate relative path within repo
  const relativePath = '/' + path.relative(repoRoot, folderPath)

  // 6. Check for duplicates
  if (project.rootPaths.includes(relativePath)) {
    throw new ValidationError('DUPLICATE_PATH', 'This folder is already added')
  }

  // 7. Get current branch
  const branch = await git.getCurrentBranch(repoRoot)

  // 8. Update project
  await projectService.update(projectId, {
    storageMode: 'local',
    repository: {
      localPath: repoRoot,
      branch
    },
    rootPaths: [...project.rootPaths, relativePath]
  })
}
```

---

## Cloud Mode

### Use Case

- Production deployment where users access from anywhere
- Team collaboration on shared documentation
- CI/CD integration for documentation builds

### Connect Repository Flow

```
1. User goes to Project Settings → "Connect Repository"
2. User authenticates with GitHub (if not already)
3. User selects repository from list
4. User optionally selects root path(s) to display

5. Backend:
   a. Clones repository to managed storage (EFS or container volume)
   b. Stores repository config in project

6. Project is now in cloud mode
```

### Managed Checkout Location

```
/mnt/repos/
└── {projectId}/
    └── checkout/
        ├── .git/
        ├── docs/
        ├── README.md
        └── ...
```

- Each project gets isolated checkout directory
- Backend manages clone, pull, push operations
- Storage: EFS (persistent) or container ephemeral (simple, but lost on restart)

---

## API Endpoints

### Folder Management (Local Mode)

#### POST /api/projects/:id/folders

Add a local folder to the project.

**Request:**
```json
{
  "path": "/Users/me/projects/my-app/docs"
}
```

**Success Response (200):**
```json
{
  "data": {
    "projectId": "proj-123",
    "repository": {
      "localPath": "/Users/me/projects/my-app",
      "branch": "main"
    },
    "rootPaths": ["/docs"]
  }
}
```

**Error Responses:**
- `400 FOLDER_NOT_FOUND` - Path doesn't exist
- `400 NOT_GIT_REPO` - Path is not inside a git repository
- `400 DIFFERENT_REPO` - Path is in a different git repository
- `400 DUPLICATE_PATH` - Path already added

#### DELETE /api/projects/:id/folders

Remove a root path from the project (does not delete files).

**Request:**
```json
{
  "path": "/docs"
}
```

### Repository Connection (Cloud Mode)

#### POST /api/projects/:id/repository

Connect a GitHub repository.

**Request:**
```json
{
  "provider": "github",
  "owner": "acme-corp",
  "repo": "documentation",
  "branch": "main",
  "rootPaths": ["/docs"]
}
```

**Success Response (200):**
```json
{
  "data": {
    "projectId": "proj-123",
    "storageMode": "cloud",
    "repository": {
      "remote": {
        "provider": "github",
        "owner": "acme-corp",
        "repo": "documentation",
        "url": "https://github.com/acme-corp/documentation"
      },
      "branch": "main"
    },
    "rootPaths": ["/docs"]
  }
}
```

#### DELETE /api/projects/:id/repository

Disconnect repository (switches to no storage configured).

### File Operations

#### GET /api/projects/:id/tree

Get file tree for all root paths.

**Query Parameters:**
- `path` (optional) - Subdirectory to list

**Response:**
```json
{
  "data": {
    "roots": [
      {
        "path": "/docs",
        "name": "docs",
        "entries": [
          {
            "name": "getting-started.md",
            "path": "/docs/getting-started.md",
            "type": "file",
            "size": 2048,
            "modifiedAt": "2025-12-30T10:00:00Z"
          },
          {
            "name": "guides",
            "path": "/docs/guides",
            "type": "directory"
          }
        ]
      }
    ]
  }
}
```

#### GET /api/projects/:id/files?path=...

Read file content. Path is passed as query parameter to handle special characters.

#### PUT /api/projects/:id/files?path=...

Write file content. Path is passed as query parameter.

---

## Mode Transition: Local → Cloud

Users may start with local mode during initial setup, then transition to cloud mode for team access.

### Flow

```
1. User works in local mode, commits and pushes to GitHub
2. User goes to Project Settings
3. User clicks "Connect to GitHub"
4. User selects the same repository they've been using locally
5. Backend:
   a. Clones repository to managed storage
   b. Verifies content matches (optional safety check)
   c. Updates project: storageMode = 'cloud'
6. User can now access from anywhere
```

### Considerations

- Local changes should be committed and pushed before transitioning
- Backend could warn if there are uncommitted local changes
- The transition is one-way in v1 (cloud → local not supported via UI)

---

## Storage Provider Interface

The StorageProvider interface abstracts file operations. Git operations are internal implementation details, not exposed to the frontend.

File operations:
- listDirectory(path) - List files in directory
- readFile(path) - Read file content
- writeFile(path, content) - Write file content
- exists(path) - Check if path exists

---

## Error Handling

| Error Code | HTTP | Description |
|------------|------|-------------|
| `FOLDER_NOT_FOUND` | 400 | Specified folder path doesn't exist |
| `NOT_GIT_REPO` | 400 | Folder is not inside a git repository |
| `DIFFERENT_REPO` | 400 | Folder is in a different repository than existing folders |
| `DUPLICATE_PATH` | 400 | Path is already added to project |
| `REPO_NOT_CONFIGURED` | 400 | Project has no repository configured |
| `PATH_OUTSIDE_ROOTS` | 403 | Requested path is outside project boundaries |
| `INVALID_PATH` | 400 | Path contains invalid characters or traversal |

---

## Security Considerations

### Local Mode

- **Path Traversal**: Validate that requested paths are within configured root paths
- **Symlinks**: Resolve and validate symlink targets
- **Permissions**: Backend runs with user's filesystem permissions

### Cloud Mode

- **Token Security**: GitHub tokens stored encrypted, never exposed to frontend
- **Checkout Isolation**: Each project has isolated checkout directory
- **Branch Restrictions**: Only allow configured branch (no arbitrary branch switching in v1)

---

## Limits

To prevent performance issues and abuse, the following limits are enforced:

| Limit | Value | Description |
|-------|-------|-------------|
| `MAX_FILES_PER_LISTING` | 1000 | Maximum files returned in a single directory listing |
| `MAX_FILE_SIZE_BYTES` | 5MB | Maximum file size that can be read/written |
| `MAX_TOTAL_SIZE_BYTES` | 50MB | Maximum total size of all files in a project (not yet enforced) |

**Error Codes:**

*Folder Management:*
- `NOT_DIRECTORY` (400): Path exists but is not a directory
- `FOLDER_NOT_FOUND` (400): Folder does not exist
- `NOT_GIT_REPO` (400): Folder is not inside a git repository
- `DIFFERENT_REPO` (400): Folder must be in the same git repository as existing folders
- `DUPLICATE_PATH` (400): This folder is already added

*File Operations:*
- `REPO_NOT_CONFIGURED` (400): No repository configured for project
- `PATH_OUTSIDE_ROOTS` (403): Path is outside project boundaries
- `TOO_MANY_FILES` (400): Directory contains more than 1000 files
- `FILE_TOO_LARGE` (400): File exceeds 5MB size limit
- `BINARY_FILE` (400): Cannot read binary files (images, videos, etc.)

---

## Cloud Mode: Sparse Checkout

For cloud mode, when a user connects a repository with specific root paths (e.g., `/docs`), the backend should use **git sparse-checkout** to avoid cloning the entire repository. This is especially important for large monorepos.

### Implementation Notes

```bash
# Clone with sparse checkout enabled
git clone --filter=blob:none --sparse https://github.com/org/repo.git

# Configure sparse checkout to only include specific paths
git sparse-checkout set docs specs

# Subsequent pulls only fetch the sparse paths
git pull
```

### Benefits

- **Reduced storage**: Only checkout the folders the user cares about
- **Faster clones**: Don't download blobs for ignored paths
- **Lower bandwidth**: Subsequent fetches are smaller

### When to Use

- Always use sparse checkout for cloud mode when `rootPaths` is not `["/"]`
- For local mode, sparse checkout is not needed (user has full repo locally)

---

## Future Enhancements

1. **Multiple Branches**: Switch between branches in the UI
2. **Branch Creation**: Create feature branches for documentation changes
3. **Pull Requests**: Create PRs directly from the editor
4. **GitLab/Bitbucket**: Support additional git providers
5. **Conflict Resolution**: UI for resolving merge conflicts
6. **File History**: View file-level commit history and diffs
