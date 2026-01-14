# COMPLETE - 2026-01-14

# GitHub Sync: Lambda + Streaming Architecture

## Overview

Replace the current N+1 API call approach with:
1. **Initial import**: Lambda downloads ZIP, streams extraction directly to S3
2. **Incremental sync**: Lambda uses Compare API to fetch only changed files
3. **Async flow**: API triggers Lambda, frontend polls for status

## Architecture

```
User clicks "Import Repository"
         │
         ▼
┌─────────────────┐
│   API Service   │ ──► Returns { syncId, status: "pending" }
└────────┬────────┘
         │ Invokes async
         ▼
┌─────────────────┐
│  Sync Lambda    │ ──► Downloads ZIP from GitHub
│   (512MB RAM)   │     Streams through unzipper
└────────┬────────┘     Uploads each file to S3
         │              Updates sync status in DB
         ▼
┌─────────────────┐
│ Storage Service │ ──► Stores files in S3 + metadata in DB
└─────────────────┘

Frontend polls: GET /api/projects/:id/sync/status
```

## Why Lambda + Streaming

- **Scalability**: 100 users = 100 isolated Lambdas, no API overload
- **Memory efficient**: 512MB handles ANY repo size (streaming)
- **Cost efficient**: ~$0.001 per import, 4-8x cheaper than high-memory
- **Fault isolation**: One bad import doesn't affect others

## Bug Fix Required

Current `github-sync.ts` queries non-existent columns. Actual data is in `repository` JSONB:
```json
{ "remote": { "provider": "github", "owner": "...", "repo": "...", "url": "..." }, "branch": "main" }
```

## Schema Changes

**File**: `shared/db/migrations/010_github_sync_tracking.sql`

```sql
-- Track sync state for cloud mode projects
ALTER TABLE projects
  ADD COLUMN last_synced_commit_sha TEXT DEFAULT NULL,
  ADD COLUMN sync_status TEXT DEFAULT NULL
    CHECK (sync_status IN ('pending', 'syncing', 'completed', 'failed')),
  ADD COLUMN sync_started_at TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN sync_completed_at TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN sync_error TEXT DEFAULT NULL;
```

## New Package: sync-lambda

**Location**: `sync-lambda/` (new workspace package)

```
sync-lambda/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts              # Lambda handler entry
│   ├── initial-sync.ts       # ZIP download + streaming extraction
│   ├── incremental-sync.ts   # Compare API + selective fetch
│   ├── zip-stream.ts         # Streaming ZIP utilities
│   └── file-filter.ts        # Text vs binary detection
```

### Dependencies

```json
{
  "dependencies": {
    "unzipper": "^0.12.3",
    "@aws-sdk/client-s3": "^3.x",
    "@aws-sdk/lib-storage": "^3.x"
  }
}
```

**Why unzipper**:
- Stream-based: never loads full ZIP into memory
- Pipes directly: GitHub → unzipper → S3
- Battle-tested for Lambda large file handling
- 512MB Lambda can handle any repo size

## Files to Create

### 1. Lambda Handler
**File**: `sync-lambda/src/index.ts`

```typescript
interface SyncEvent {
  projectId: string;
  userId: string;
  owner: string;
  repo: string;
  branch: string;
  token: string;  // Encrypted, decrypt in Lambda
  mode: 'initial' | 'incremental';
  lastCommitSha?: string;
}

export async function handler(event: SyncEvent): Promise<SyncResult>
```

### 2. Streaming ZIP Extraction
**File**: `sync-lambda/src/zip-stream.ts`

```typescript
// Stream: GitHub → unzipper → S3 (no full ZIP in memory)
export async function streamZipToS3(
  zipUrl: string,
  token: string,
  projectId: string,
  storageServiceUrl: string
): Promise<{ synced: number; skipped: number }>
```

### 3. File Filter
**File**: `sync-lambda/src/file-filter.ts`

- `isTextFile(path)` - Extension-based check
- `isEditableFile(path)` - Returns true for `.md`, `.mdx`
- `shouldSkipDirectory(path)` - Skip node_modules, .git, etc.

## Files to Modify

### 1. API Handler
**File**: `api/src/handlers/github-sync.ts`

- Fix `getProjectWithRepo()` to parse JSONB correctly
- `handleStartSync()` - Invoke Lambda async, return syncId
- `handleSyncStatus()` - Return current sync state from DB

### 2. CDK Infrastructure
**File**: `infra/lib/sync-lambda-stack.ts` (new)

```typescript
const syncLambda = new Function(this, 'GitHubSyncLambda', {
  runtime: Runtime.NODEJS_20_X,
  handler: 'index.handler',
  memorySize: 512,
  timeout: Duration.minutes(5),
  environment: {
    STORAGE_SERVICE_URL: storageService.url,
    STORAGE_API_KEY: storageApiKey.secretValue,
  },
});
```

## File Type Filtering

**Text extensions** (sync these):
```
md, mdx, txt, rst, json, yaml, yml, toml, xml,
js, jsx, ts, tsx, mjs, cjs, py, rb, go, rs, java,
c, cpp, h, hpp, cs, php, swift, sh, bash, sql,
html, css, scss, vue, svelte, graphql, prisma,
gitignore, editorconfig, dockerfile, makefile
```

**Binary extensions** (skip):
```
png, jpg, jpeg, gif, webp, svg, ico, mp3, mp4,
zip, tar, gz, woff, woff2, ttf, exe, dll, so, pyc, class
```

**Skip directories**:
```
node_modules/, .git/, vendor/, dist/, build/, __pycache__/
```

## Sync Flows

### Initial Sync Flow

```
API: POST /api/projects/:id/sync/initial
  │
  ├─► Validate project is cloud mode with GitHub configured
  ├─► Get GitHub token from github_connections
  ├─► Set project.sync_status = 'pending'
  ├─► Invoke Lambda async with { mode: 'initial', ... }
  └─► Return { syncId: projectId, status: 'pending' }

Lambda: Initial Sync
  │
  ├─► Set project.sync_status = 'syncing', sync_started_at = now()
  ├─► GET /repos/{owner}/{repo}/zipball/{branch}
  │   (Returns 302 redirect to S3-hosted ZIP)
  ├─► Follow redirect, start streaming response
  ├─► Pipe through unzipper.Parse()
  ├─► For each entry:
  │     ├─► Skip if binary or in skip directory
  │     ├─► Strip root folder from path
  │     ├─► Stream upload to storage service
  │     └─► Continue (memory stays flat)
  ├─► Get HEAD commit SHA from response headers or separate API call
  ├─► Update project: sync_status='completed', last_synced_commit_sha=SHA
  └─► Return { synced, skipped, commitSha }

On Error:
  └─► Update project: sync_status='failed', sync_error=message
```

### Incremental Sync Flow

```
API: POST /api/projects/:id/sync
  │
  ├─► Check project.last_synced_commit_sha exists
  │   If not, return error "Initial sync required"
  ├─► Set project.sync_status = 'pending'
  ├─► Invoke Lambda async with { mode: 'incremental', lastCommitSha }
  └─► Return { syncId: projectId, status: 'pending' }

Lambda: Incremental Sync
  │
  ├─► GET /repos/{owner}/{repo}/compare/{lastSha}...{branch}
  ├─► Parse response.files array (added, modified, removed, renamed)
  ├─► Filter to text files only
  ├─► For added/modified: fetch blob via GraphQL batch, store to S3
  ├─► For removed: delete from storage service
  ├─► Update project.last_synced_commit_sha
  └─► Return { synced, removed, commitSha }
```

### Sync Status Endpoint

```
GET /api/projects/:id/sync/status

Response:
{
  "status": "syncing" | "completed" | "failed" | "pending" | null,
  "lastSyncedCommitSha": "abc123...",
  "syncStartedAt": "2025-01-14T10:00:00Z",
  "syncCompletedAt": "2025-01-14T10:00:30Z",
  "error": null
}
```

## GitHub ZIP Format

GitHub ZIPs contain a root folder: `{repo}-{sha}/`

```
my-app-abc123def/
├── docs/readme.md   →  docs/readme.md (stripped)
├── src/index.ts     →  src/index.ts (stripped)
└── package.json     →  package.json (stripped)
```

**Stripping logic**: Remove everything before first `/`

## Error Handling

| Error | Lambda Action |
|-------|---------------|
| 401 Unauthorized | Set sync_status='failed', error='GitHub token expired' |
| 404 Not Found | Set sync_status='failed', error='Repository not found' |
| Rate Limited | Retry with exponential backoff (up to 3 times) |
| Storage service down | Set sync_status='failed', error='Storage unavailable' |
| Timeout (5min) | Lambda dies, sync_status stays 'syncing' (need cleanup job) |

## Lambda Configuration

```typescript
{
  memorySize: 512,        // MB - streaming keeps this low
  timeout: 300,           // 5 minutes max
  retryAttempts: 0,       // We handle retries internally
  environment: {
    STORAGE_SERVICE_URL,
    STORAGE_API_KEY,
    DB_CONNECTION_STRING, // To update sync status
  }
}
```

## Implementation Order

1. Create migration `010_github_sync_tracking.sql`
2. Create `sync-lambda/` package scaffold
3. Implement `file-filter.ts` (text vs binary detection)
4. Implement `zip-stream.ts` (streaming extraction)
5. Implement `initial-sync.ts` (full ZIP sync)
6. Implement `incremental-sync.ts` (Compare API sync)
7. Create Lambda handler `index.ts`
8. Add CDK stack for Lambda
9. Fix `getProjectWithRepo()` JSONB parsing in API
10. Add API endpoints: start sync, get status
11. Wire up Lambda invocation from API

## Cost Estimate

| Scenario | Lambda | S3 PUTs | Total |
|----------|--------|---------|-------|
| Small repo (50 files) | $0.00008 | $0.00025 | ~$0.0003 |
| Medium repo (200 files) | $0.00025 | $0.001 | ~$0.001 |
| Large repo (1000 files) | $0.001 | $0.005 | ~$0.006 |

**1,000 imports/month ≈ $1-6**

## Verification

1. **Initial sync**: Create test project, trigger sync, verify files in S3
2. **Streaming**: Monitor Lambda memory - should stay flat at ~100MB regardless of ZIP size
3. **Incremental**: Make commit, trigger sync, verify only changed files fetched
4. **Status polling**: Verify frontend can poll and see progress
5. **Error handling**: Test with invalid token, verify status='failed' with error message
6. **Large repo**: Test with 500MB+ repo, verify Lambda completes without OOM
