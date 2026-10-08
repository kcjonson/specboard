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
    ├── POST /api/projects/:owner/:project/folders     ← Add folder (only with LOCAL_STORAGE_ENABLED=true)
    ├── PUT  /api/projects/:owner/:project {repository} ← Connect GitHub (cloud mode)
    ├── GET  /api/projects/:owner/:project/tree        ← List files
    ├── GET  /api/projects/:owner/:project/files?path= ← Read file
    └── PUT  /api/projects/:owner/:project/files?path= ← Write file
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

  // Storage configuration
  storageMode: 'none' | 'local' | 'cloud'
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
-- root_paths: ["/"]  (cloud projects always expose the whole checkout)
```

---

## Local Mode (Electron Only)

### Use Case

Developer running the **Electron desktop app** for:
- Initial documentation setup
- Editing docs while working in their IDE
- Testing before pushing to cloud

**Note:** Local mode is not available in the browser. Browser users must use cloud mode.

A local project's files are on its owner's machine, so only the owner reaches them. To a project member (see [multi-user-collaboration.md](./multi-user-collaboration.md)) a local project is board-only: `getStorageProvider` (`api/src/handlers/storage/utils.ts`) returns no storage for them, so the file and git routes answer as they do for a project with no repository. Cloud storage is shared: every member reads the synced checkout, and pending changes stay per user.

The API only registers `POST /api/projects/:owner/:project/folders` when it starts with `LOCAL_STORAGE_ENABLED=true`. Today only the dev compose stack sets it (the host repo is mounted at `/host/specboard`); the cloud build never does, so a web user cannot point a project at a path on the API container. A desktop shell that runs its own API process will need to set it too.

The file browser decides which empty state to show by asking `@specboard/platform` for the desktop bridge (`getPlatformBridge()`) and checking for `showOpenDialog`. With it, the browser offers "Add Folder" and opens that picker; without it (the browser, or a shell that exposes no picker) a project without a repository gets a note that pages come from a GitHub repository and for the owner, a link to the project's settings page (`/projects/<owner>/<project>/settings`).

### Add Folder Flow

```
1. User clicks "Add Folder" in file browser
2. Electron shows native OS folder picker (dialog.showOpenDialog)
3. User selects folder: /Users/me/projects/my-app/docs
4. Frontend calls POST /api/projects/:owner/:project/folders
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

A repository is attached either when the project is created or later from the
Repository section of the project settings page, which shows the repository picker
whenever the project has no repository yet. Both use the one `RepositoryPicker`
(`shared/projects/RepositoryPicker`).

```
1. User opens Create Project, or project settings > Repository on a project with no repository
2. User authenticates with GitHub (if not already)
3. User selects repository and branch from the list

4. Backend:
   a. Stores repository config in project, storageMode = 'cloud', rootPaths = ['/']
   b. Starts the initial sync, which clones the repository to managed storage

5. Project is now in cloud mode; the client shows sync progress until the clone lands
```

A project that already has a repository cannot swap or remove it in v1; the API answers
`409 REPOSITORY_ALREADY_SET`.

### Pending changes and spec links

A cloud project's edits are pending changes in the storage service, kept per
`(project, user)` until that user commits them. Each one is `created`, `modified`, or
`deleted`. A rename is journaled as a deletion of the old path plus a change at the new
one, and the new side records `renamed_from`: the committed path the file started at.
Renaming again carries the first origin forward, a later save keeps it, and a file that
was never committed has none.

Spec links (`epic_specs`) are project-wide, so they follow committed files, never one
user's draft. A cloud rename or delete leaves every link alone; the editor still shows
the file to every other member, and discarding the draft (`git/restore`) has nothing to
undo. The commit moves them (step 4 of Committing, below), by these rules:

- a path is vacated when the commit deletes it or a renamed file lands on it (the
  pending change there is `modified` with a `renamed_from`)
- a change renamed from a vacated path takes that path's links; each vacated path goes
  to one rename at most, and a link the item already has at the new path absorbs the
  moved one
- a vacated path no rename took drops its links
- a rename whose old path was restored before the commit is a copy, so the links stay

All of it is read against the links as they were before the commit, so renames move
together: a file archived and another promoted into its place, a chain, and a swap
through a temporary name each land where they should. The moves go through a marker
path in the same transaction because `(item_id, path)` is unique and not deferrable.

A local project writes to disk at once, so its rename and delete handlers move or drop
links on the request itself.

### The sync lock

Pulls, full syncs, and commits all move committed files and the sync point
(`last_synced_commit_sha`), so they take turns through one lock: `sync_status`. A pull
or full sync takes it as `pending` (the Lambda moves it to `syncing`), a commit as
`committing`; `completed` and `failed` mean free. Whoever can't take it gets a `409`.
`sync_started_at` is the holder's token, at millisecond precision, and every write a
holder makes at the end checks it, so a holder that lost the lock changes nothing. The
API passes the pending token to the Lambda in its event; the Lambda only moves that
exact lock to `syncing` (a late or repeated invocation finds nothing to take), and if it
fails before then (configuration, secrets, the GitHub token) it marks that lock failed
so commits aren't blocked. A lock older than 20 minutes is stale and can be taken over:
a Lambda stops at 15 minutes and a commit request long before, so a lock that old
belongs to something that crashed. A commit that took one over leaves the project's
sync showing failed ("The last sync didn't finish. Pull again.") rather than putting
the dead holder's state back.

The sync point is always a full 40-character SHA. GitHub's commit API rejects anything
shorter as `expectedHeadOid`, so a sync resolves the branch head to its full SHA first,
syncs that commit, and stores it. (Older full syncs stored the archive's 7-character
SHA; a commit against one answers `409` to pull first, and the pull stores the full one.)

### Committing

A commit (`handleGitHubCommit` in `api/src/handlers/github-sync.ts`) holds the sync lock
throughout and runs in this order:

1. Refuse drafts that conflict with newer commits (Draft conflicts, below): the answer
   is `409` with `reason: 'draft_conflicts'` and the conflicting paths, and nothing
   changes. Then read the committer's pending changes. Each is read on its own, so its
   content, action, and `updatedAt` belong together.
2. Create the commit with GitHub's `createCommitOnBranch`, with `expectedHeadOid` set to
   the sync point, the commit every draft was made against. If anything landed on the
   branch since (a push from outside, another tool), GitHub refuses, the API answers
   `409` with `conflictDetected`, and nothing changes: pending changes, files, links, and
   the sync point stay. The editor's commit banner shows the message and offers Pull.
   After the pull, any draft of a file it changed shows as a conflict.
3. Promote the commit in the storage service (`POST /commits/:projectId/:userId`, same
   internal API key as every other API-to-storage call; the API's route is editor-gated).
   Its added and modified files become the committed files, its deleted and
   renamed-away paths stop being committed files, and the committer's pending changes it
   took are cleared, all in one storage transaction. A pending change saved again while
   the commit was in flight no longer matches the `updatedAt` read in step 1 and stays a
   draft. File content goes to S3 before the transaction, under each file's own key; S3
   objects for deleted paths and cleared large drafts are removed after it, unless the
   path has a live row again by then.
4. Move spec links (above) and the sync point from the commit's base to the new commit,
   in one compare-and-set transaction (`recordCommit` in `shared/db/src/services/specs.ts`).
   It's retried a few times in the request; a try that landed before its reply was lost
   reads as done.

Every member reads committed files plus their own pending changes, so after step 3 the
committer sees their commit with no drafts left and every other member sees it too.

Steps 3 and 4 run after GitHub has the commit and can't undo it, so if either still
fails the answer is success with a warning, which the editor shows with a Pull action,
and the sync point stays at the old commit. The next pull brings the commit in like any
other push. What that recovers:

- If step 3 failed, the rows and pending changes are untouched, but S3 may already hold
  the commit's content for some files, since it's what GitHub has. Until the pull, every
  member reads that new content for those files while the listing shows their old size;
  added files stay invisible and deleted ones stay listed. The committer's drafts stay
  listed as changes after the pull, matching what's committed; discarding them is safe.
- If step 4 failed, step 3 stands and the pull rewrites the same content. The pull moves
  spec links from GitHub's compare, which is lossy: a rename whose content changed
  enough is reported as a removal and an addition, and that file's links are dropped
  instead of moved. The links and the sync point move together either way, so a
  commit's links are applied once, by step 4 or by the pull.

### Draft conflicts

A draft is the whole file, so committing one made against an older version replaces
whatever changed since: another member's commit (which moves the sync point, so
`expectedHeadOid` doesn't catch it) or anything a pull brought in. Each pending change
records its base, `base_content_hash` (storage migration 003): the committed version the
draft's content was made against, NULL when nothing was committed there.

The base comes from the editor, not from the moment of the first save. `GET files`
returns `baseContentHash` with the content: the committed file's hash, or for a file
the caller already has a draft of, that draft's base. The editor keeps it with the open
document and with its local (crash-recovery) copy, and sends it with every `PUT files`.
Storage uses it when the draft row is first written; later saves keep the row's base.
So a file opened before someone else's commit and first saved after it still conflicts,
and so does a local copy restored long after it was made. Renames and deletes carry a
base too (`baseContentHash` on `PUT files/rename`, a query parameter on `DELETE files`):
the open document's base when the file is open, otherwise the hash the file tree listed
for it. A rename records it on the old path's deletion, so renaming a file someone has
changed since you saw it (from the header or the tree) conflicts as "You renamed it to
..."; the new path starts from nothing committed, and the editor takes the new path's
base after the rename. A write without a base (an agent's, a script's, an older client's
during a deploy, or a tree entry listed before hashes were) takes what's committed at
the path at that moment: for a delete that means the path as committed now. A base must
be a committed file's sha1; anything else is refused.

The editor saves the open file before anything that acts on its draft as the server has
it (a rename, a delete, resolving a conflict, a commit), and if that save fails the
action doesn't go ahead. After a rename it shows the file as the server has it under
the new name and refetches git status. A rename row whose new path holds exactly what's
committed at the old path now says the rename keeps their latest version, and a draft
started where nothing was committed reads as one the caller created even after a later
save. During a commit it holds further
saves (the local copy keeps them) until the commit is done and it has taken the new base
for the open file, then saves, so an edit made mid-commit isn't measured against the
version the commit just replaced.

A draft conflicts when what's committed at its path now differs from its base (`IS
DISTINCT FROM`): an edit of a file someone changed or deleted, a created file where
someone committed one, or a deletion of a file someone changed or already deleted. It
doesn't when the draft already holds exactly what's committed (pending changes record a
`content_hash` too): that's what happens when the caller's own commit comes back in
through a pull after its promotion failed, and committing it would change nothing. The
storage service computes this when it lists a user's drafts, so git status carries it
per file and the commit checks it under the sync lock (which keeps commits and pulls
from moving the committed files during the check). A commit that promotes a file
re-bases the committer's own drafts at that path, so a draft saved mid-commit doesn't
conflict with its own commit.

A rename's new path starts with the base of whatever was committed there (normally
nothing, since a rename can't land on an existing file). The file it came from is
tracked by the old path's own `deleted` draft, whose base is the old file's hash, so a
rename whose source someone changed conflicts through the source path, and git status
names where the file went (`renamedTo`).

The editor marks a conflicting file in the tree with an alert glyph (and a collapsed
folder holding one), shows a notice, and lists them in a dialog, also opened when a
commit is refused for them. Per file it offers Compare (the version committed now, `GET
git/committed`, beside the draft, read-only), keep, and discard; a rename's row reads
"You renamed it to ..." with Keep my rename and Undo my rename. Keep (`POST git/keep-mine
{ paths }`, editor-gated) re-bases the drafts on what's committed now, in one storage
call, so the next commit takes them as they are; a draft that writes the file becomes
`created` or `modified` to match, and a deletion of a file that's already gone is
dropped. Discard is restore and asks first; for a rename it's Undo my rename (`POST
git/undo-rename`), which drops both drafts in one storage transaction and, if the new
path was open, opens the old one. Compare on a rename's row shows the old file as
committed beside the draft at the new path. When the resolved file is open, the editor
saves it first and reloads it after. Rows resolve independently.

Drafts that existed before migration 003 got today's committed hash as their base, since
what they were made against was never recorded. They're treated as current, so a change
committed before the migration isn't caught for them, except that one editing or
deleting a file nothing is committed at any more is flagged.

### Pulling

A pull takes the sync lock and starts the incremental sync, which resolves the branch
head to its full SHA, reads GitHub's compare from the sync point to it, writes the
changed files into the committed files, and then, in one transaction that checks it
still holds the lock and the sync point is still where it started, moves the sync point
to that head and moves spec links for `removed` and `renamed` files. Every file has to
land: if any write or removal fails, the sync fails without moving the sync point or
the links, and a retry or the next pull redoes the whole range (writes are idempotent).
When the compare can't list everything (300 files, or more commits than it returns) or
the branch was rewritten (a force-push makes it `diverged` or `behind`, and it then
diffs from the merge base), the sync falls back to a full sync of that head instead.
With no new commits it still stores the head's full SHA. The editor waits for the sync
to finish before it refreshes.

A pull never touches pending changes: each member's drafts stay as they were, shown
over the new committed files. A draft of a file the pull also changed now conflicts,
and git status flags it (`conflict: true`), so the file tree marks it and the editor
offers to resolve it before the commit is refused.

A full sync (`initial`, or the fallback above) streams the head commit's archive into
storage, then removes committed files storage didn't take from the archive: files the
branch no longer has and files in skipped directories. It fails without pruning or
moving the sync point if any file failed to upload. It can't tell a rename from a
delete, so it leaves spec links alone.

### Files the editor can't hold

Syncs store text files up to 500 KB. Files in skipped directories (`node_modules`,
`.git`, build output, tool settings; the list is `@specboard/core/sync-paths`, shared by
the sync and the API) are never stored, and for a cloud project the API refuses to
create a file in one, or rename one into it (`400 PATH_NOT_SYNCED`), since a commit
would put it on GitHub where no sync brings it back. Submodules (gitlinks in the tree)
have no content in this repository and aren't stored either; GitHub's compare lists a
submodule bump as a changed file, and the sync skips it.

Before downloading anything, a sync reads the commit's tree (`GET git/trees/<sha>
?recursive=1`) for each file's blob sha and size, and refuses a truncated tree. A file
over the limit is recorded from its listed size without downloading it; a smaller one is
downloaded, and if it's binary it's recorded too. Recorded means stored as a row with no
content (`project_documents.unavailable_reason`, `too_large` or `binary`; storage
migration 004) whose `content_hash` is the file's git blob sha, and any older content
stored for it is removed. Both kinds of sync do this, including for a file a push just
made too large or binary, so nobody reads or commits over an older copy. A later sync
that finds the file editable again stores it as usual.

Such a file is listed, but reading it, saving a draft of it, or renaming it answers `409
FILE_UNAVAILABLE` with a message saying it's binary or too large to edit here; the
editor shows that message instead of the file, and doesn't retry the save. Deleting it
is allowed. A commit answers `409` with `reason: 'unavailable_files'` and the paths, and
writes nothing, when a draft (other than a deletion) would put back what the sync can't
store: a draft over a file that has since become unavailable, a rename of one, or a
draft in a skipped directory. The way on is to discard those drafts and change the
files in the repository directly.

### Sync traffic to the storage service

The storage service rate-limits each API key and client to 1000 requests a minute, in
memory per task. The sync Lambda sends `X-Storage-Client: sync` and has its own budget,
so a large full sync doesn't use up the API's, and the API's interactive traffic doesn't
stall a sync. A full sync uploads at most ten files at once, holding the archive back
while it waits. On a 429 the sync waits as long as Retry-After says (backing off when it
says nothing) and tries again, up to eight times, before failing; other refusals aren't
retried, and server errors are retried three times. Paths go into storage URLs encoded
segment by segment, so names with `#`, `?`, `%`, spaces, or non-ASCII characters arrive
as themselves.

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

#### POST /api/projects/:owner/:project/folders

Add a local folder to the project. Registered only when the API starts with `LOCAL_STORAGE_ENABLED=true`; 404 otherwise.

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
- `409 CLOUD_PROJECT` - The project is connected to a cloud repository

#### DELETE /api/projects/:owner/:project/folders

Remove a root path from the project (does not delete files). Removing the last one
returns the project to `storageMode: 'none'`.

**Request:**
```json
{
  "path": "/docs"
}
```

**Error Responses:**
- `409 CLOUD_PROJECT` - The project is connected to a cloud repository; its root paths
  are managed with the repository, and dropping the last one would orphan the managed
  checkout and its sync state

### Repository Connection (Cloud Mode)

There is no separate repository endpoint. The `repository` field of the project body
connects one, on `POST /api/projects` at creation or on `PUT /api/projects/:owner/:project`
afterwards. On update it is accepted only while the project has no storage configured
(`storage_mode = 'none'`).

**Request (`PUT /api/projects/:owner/:project`):**
```json
{
  "repository": {
    "provider": "github",
    "owner": "acme-corp",
    "repo": "documentation",
    "branch": "main",
    "url": "https://github.com/acme-corp/documentation"
  }
}
```

Other project fields (`name`, `description`, `system_prompt`, `slug`, `key`) may ride
along in the same request.

**Success Response (200):** the full project, now with
```json
{
  "storageMode": "cloud",
  "repository": {
    "type": "cloud",
    "remote": {
      "provider": "github",
      "owner": "acme-corp",
      "repo": "documentation",
      "url": "https://github.com/acme-corp/documentation"
    },
    "branch": "main"
  },
  "rootPaths": ["/"]
}
```

The response does not wait for or report on the initial sync. It is started as a side
effect; if it cannot start (GitHub not connected, sync invoke failed) the project's
`syncStatus` becomes `failed` with the reason in `syncError`, and
`POST /api/projects/:owner/:project/sync/initial` retries. Poll
`GET /api/projects/:owner/:project/sync/status` for progress. Because the start runs after
the response, the first polls can still read a `null` status; the setup dialog treats that
as "starting" and keeps polling for 30 seconds before reporting that the sync never started.

**Error Responses:**
- `400` - Repository config fails validation (provider, GitHub owner/repo/branch naming, or a URL that is not `https://github.com/{owner}/{repo}`)
- `409 REPOSITORY_ALREADY_SET` - The project already has a repository (cloud or local)

Disconnecting or replacing a repository is not supported in v1.

### File Operations

#### GET /api/projects/:owner/:project/tree

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

#### GET /api/projects/:owner/:project/files?path=...

Read file content. Path is passed as query parameter to handle special characters.

#### PUT /api/projects/:owner/:project/files?path=...

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
- The transition is one-way in v1: cloud → local is not supported, and the folder
  endpoints answer `409 CLOUD_PROJECT` for a cloud project
- Not implemented yet: the API only attaches a repository to a project with no storage
  configured, so a local-mode project answers `409` until this flow exists

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
| `CLOUD_PROJECT` | 409 | Folder add/remove on a project connected to a cloud repository |
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
- `CLOUD_PROJECT` (409): Folders cannot be added to or removed from a cloud project

*File Operations:*
- `REPO_NOT_CONFIGURED` (400): No repository configured for project
- `PATH_OUTSIDE_ROOTS` (403): Path is outside project boundaries
- `TOO_MANY_FILES` (400): Directory contains more than 1000 files
- `FILE_TOO_LARGE` (400): File exceeds 5MB size limit
- `BINARY_FILE` (400): Cannot read binary files (images, videos, etc.)

---

## Cloud Mode: Sparse Checkout

Not implemented: cloud projects are always attached with `rootPaths: ['/']` today, so the
whole repository is cloned. This section describes the intended design once narrower
roots are supported.

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
