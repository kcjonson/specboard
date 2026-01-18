# GitHub Commit for Cloud-Mode Projects

## Summary

Implement the ability to commit pending changes from cloud-mode projects back to GitHub using the GraphQL `createCommitOnBranch` mutation.

## Current State

- Files sync FROM GitHub via Lambda (initial ZIP + incremental Compare API)
- User edits stored as `pending_changes` in storage service (S3 + Postgres)
- `CloudStorageProvider.commit()` throws "not implemented"
- Endpoint `POST /api/projects/:id/github/commit` returns 501

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| API approach | **GraphQL `createCommitOnBranch`** | Atomic (all-or-nothing), single API call, built-in conflict detection |
| Sync vs Async | **Synchronous API** | Immediate feedback, simpler, single API call now |
| Conflict handling | **Atomic via `expectedHeadOid`** | Mutation fails if branch moved - no partial commits |
| File selection | **Commit all pending** | Simpler MVP, add selection later if needed |
| GraphQL client | **Raw fetch()** | No dependencies - just HTTP POST with JSON body |

## GitHub GraphQL API Flow

```
1. GET  /git/refs/heads/{branch}     → Get current HEAD SHA (for expectedHeadOid)
2. POST /graphql                     → createCommitOnBranch mutation (atomic - all files in one call)
3. Clear pending changes             → Remove from storage service on success
```

**Why GraphQL instead of REST Git Data API:**
- REST requires ~30+ API calls for a 30-file commit (1 blob per file + tree + commit + ref)
- GraphQL is atomic - either all files commit or none (no partial success)
- Built-in conflict detection via `expectedHeadOid` parameter
- No need for complex rollback logic

## Implementation

### 1. Create GitHub Commit Service

**New file: `api/src/services/github-commit.ts`**

```typescript
interface CommitResult {
  success: boolean;
  sha?: string;
  url?: string;
  error?: string;
  conflictDetected?: boolean;
}

interface PendingChange {
  path: string;
  content: string | null;  // null for deletions
  action: 'modified' | 'created' | 'deleted';
}

export async function createGitHubCommit(params: {
  owner: string;
  repo: string;
  branch: string;
  token: string;
  message: string;
  changes: PendingChange[];
}): Promise<CommitResult>;
```

**Core logic:**

```typescript
async function createGitHubCommit(params) {
  const { owner, repo, branch, token, message, changes } = params;

  // 1. Get current HEAD SHA (for conflict detection)
  const headSha = await getBranchHeadSha(owner, repo, branch, token);

  // 2. Build file changes for mutation
  const additions = changes
    .filter(c => c.action !== 'deleted')
    .map(c => ({ path: c.path, contents: Buffer.from(c.content!).toString('base64') }));

  const deletions = changes
    .filter(c => c.action === 'deleted')
    .map(c => ({ path: c.path }));

  // 3. Execute GraphQL mutation (single atomic call)
  const response = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: `
        mutation CreateCommit($input: CreateCommitOnBranchInput!) {
          createCommitOnBranch(input: $input) {
            commit { oid url }
          }
        }
      `,
      variables: {
        input: {
          branch: { repositoryNameWithOwner: `${owner}/${repo}`, branchName: branch },
          message: { headline: message },
          expectedHeadOid: headSha,
          fileChanges: { additions, deletions }
        }
      }
    })
  });

  const result = await response.json();

  // 4. Handle errors (including conflicts)
  if (result.errors) {
    const isConflict = result.errors.some(e =>
      e.message.includes('expectedHeadOid') || e.message.includes('out of date')
    );
    return { success: false, error: result.errors[0].message, conflictDetected: isConflict };
  }

  return {
    success: true,
    sha: result.data.createCommitOnBranch.commit.oid,
    url: result.data.createCommitOnBranch.commit.url
  };
}
```

### 2. Implement API Handler

**Modify: `api/src/handlers/github-sync.ts`**

Replace stub `handleGitHubCommit()` (line ~483):

1. Auth check (session required)
2. Get project with repo info
3. Verify cloud mode
4. Get & decrypt GitHub token from `github_connections`
5. Get pending changes with content from storage service
6. Return 400 if no pending changes
7. Build commit message (use provided or auto-generate from file list)
8. Call `createGitHubCommit()` (conflict detection is built into the mutation)
9. On success: clear pending changes, update `last_synced_commit_sha`
10. Return result (including conflict info if applicable)

### 3. Add Storage Client Method

**Modify: `api/src/services/storage/storage-client.ts`**

Add method to fetch pending changes with content:
```typescript
async listPendingChangesWithContent(projectId: string, userId: string): Promise<{
  path: string;
  content: string | null;  // null for deletions
  action: 'modified' | 'created' | 'deleted';
}[]>
```

### 4. Update CloudStorageProvider

**Modify: `api/src/services/storage/cloud-provider.ts`**

Update `commit()` stub to use the new service (or just let the API handler handle it directly).

## API Contract

### `POST /api/projects/:id/github/commit`

**Request:**
```json
{ "message": "Optional commit message" }
```

**Success (200):**
```json
{
  "success": true,
  "sha": "abc123...",
  "filesCommitted": 3,
  "url": "https://github.com/owner/repo/commit/abc123..."
}
```

**Conflict (409):**
```json
{
  "success": false,
  "error": "Remote has new changes. Sync before committing.",
  "conflictDetected": true
}
```

**No changes (400):**
```json
{ "error": "No changes to commit" }
```

## Files to Create/Modify

| File | Action |
|------|--------|
| `api/src/services/github-commit.ts` | CREATE |
| `api/src/handlers/github-sync.ts` | MODIFY - implement `handleGitHubCommit()` |
| `api/src/services/storage/storage-client.ts` | MODIFY - add `listPendingChangesWithContent()` |
| `api/src/services/storage/cloud-provider.ts` | MODIFY - update `commit()` stub |

## Verification

1. Start dev environment: `docker compose up`
2. Create a cloud-mode project connected to a test GitHub repo
3. Edit a file in the editor
4. Check git status shows pending changes
5. Click commit button
6. Verify:
   - Commit appears on GitHub
   - Pending changes cleared
   - `last_synced_commit_sha` updated
7. Test conflict: edit file on GitHub, try to commit locally, should get 409

## Out of Scope (Future)

- File selection UI (commit specific files)
- Auto-sync after commit
- Branch creation
- PR creation from editor
