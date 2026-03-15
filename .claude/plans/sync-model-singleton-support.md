# COMPLETE - 2026-03-07

# Fix SyncModel setMeta + GitHubConnectionModel duplication

## Context

After an OAuth redirect to `/settings?github_connected=true`, the settings page appeared broken. Root cause: `GitHubConnectionModel` extends `Model` directly and duplicated the `$meta`/`setMeta` pattern without emitting change events. It should extend `SyncModel` instead — the only reason it didn't was the singleton URL, but SyncModel handles parameterless URLs fine. The manual `this.fetch()` call in the constructor is sufficient.

## Changes

### 1. SyncModel.setMeta: emit change events
**File:** `shared/models/src/SyncModel.ts`

Add change emission after `Object.assign`, matching SyncCollection's existing pattern.

### 2. GitHubConnectionModel: extend SyncModel
**File:** `shared/models/src/github.ts`

- Change `extends Model` → `extends SyncModel`
- Add `static url = '/api/github/connection'`
- Remove: `$meta` override, `setMeta()`, `fetch()` — all inherited from SyncModel
- Keep: constructor (with manual `this.fetch()`), `connect()`, `disconnect()`

### 3. Tests
**File:** `shared/models/src/SyncModel.test.ts`

The 2 currently failing `$meta` change event tests should now pass.

## Verification

1. `cd shared/models && npx vitest run` — all tests pass
2. `docker compose build && docker compose up` — settings page loads, GitHub section works
