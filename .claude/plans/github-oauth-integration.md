# COMPLETE - 2026-01-18

# GitHub OAuth Integration

Connect GitHub accounts to enable cloud repository storage for projects.

## Overview

This epic implements GitHub OAuth to allow users to:
1. Connect their GitHub account from Settings
2. Select GitHub repositories when creating projects (cloud mode)
3. Access private repos through our API proxy (browser never sees tokens)

**Spec:** `/docs/specs/authentication.md` (GitHub Connection section)

## Current State (Branch: `claude/fix-cloud-git-integration-ddyL8`)

### Already Implemented

1. **API Endpoints** (`api/src/handlers/github.ts`)
   - `GET /api/auth/github` - Start OAuth flow (redirect to GitHub)
   - `GET /api/auth/github/callback` - Handle OAuth callback
   - `GET /api/github/connection` - Get connection status
   - `DELETE /api/auth/github` - Disconnect GitHub
   - `GET /api/github/repos` - List user's repositories (API proxy)
   - `GET /api/github/repos/:owner/:repo/branches` - List branches (API proxy)

2. **Token Encryption** (`@doc-platform/auth`)
   - AES-256-GCM encryption using `API_KEY_ENCRYPTION_KEY` env var
   - Tokens encrypted before storage, decrypted only when calling GitHub API

3. **Frontend Models** (`shared/models/src/github.ts`)
   - `GitHubConnectionModel` - Connection status, connect/disconnect
   - `GitHubRepoModel` / `GitHubReposCollection` - List repos
   - `GitHubBranchModel` / `GitHubBranchesCollection` - List branches

4. **Settings UI** (`web/src/routes/settings/GitHubConnection.tsx`)
   - Shows connection status
   - Connect/disconnect buttons
   - Error handling for OAuth callback

5. **Database** (`shared/db/migrations/003_auth_schema.sql`)
   - `github_connections` table with encrypted token storage

### Not Yet Implemented

1. **Project Integration** - UI to select GitHub repo when creating projects
2. **Cloud Storage Provider** - GitStorageProvider for cloud mode
3. **Login with GitHub** - Marked as future in spec

## Implementation Plan

### Phase 1: Logging Cleanup ✅

Replace raw `console.error()` with structured logging for CloudWatch:

- [x] Update `api/src/handlers/github.ts` to use `log()` from `@doc-platform/core`
  - [x] `github_connect` - successful OAuth connection
  - [x] `github_connect_failed` - OAuth errors (denied, token exchange failed, etc.)
  - [x] `github_disconnect` - user disconnected GitHub
  - [x] `github_api_error` - errors calling GitHub API (rate limits, auth expired)
  - [x] `github_token_decrypt_failed` - corrupted token (security event)

### Phase 2: Verification & Local Testing

Verify the existing implementation works end-to-end:

- [x] Add GitHub OAuth env vars to `docker-compose.override.yml`
  - [ ] `GITHUB_CLIENT_ID` (commented - user must fill in)
  - [ ] `GITHUB_CLIENT_SECRET` (commented - user must fill in)
  - [x] `APP_URL=http://localhost`
- [ ] Create a GitHub OAuth App for local dev
  - [ ] Homepage URL: `http://localhost`
  - [ ] Callback URL: `http://localhost/api/auth/github/callback`
- [ ] Test OAuth flow
  - [ ] Connect from Settings
  - [ ] Verify token encrypted in database
  - [ ] Disconnect and reconnect
  - [ ] Handle denied authorization
- [ ] Test API proxy endpoints
  - [ ] List repositories (includes private repos)
  - [ ] List branches for a repo

### Phase 3: Settings UI Integration ✅

Ensure GitHubConnection component is properly integrated:

- [x] Verify GitHubConnection renders in UserSettings page
- [ ] Test error states (OAuth denied, network errors)
- [ ] Test loading states and success feedback

### Phase 4: Project Repository Selection

Add UI to select GitHub repository when creating/editing a project:

- [ ] Create `RepoSelector` component
  - [ ] Show "Connect GitHub" prompt if not connected
  - [ ] Dropdown to select from user's repos
  - [ ] Branch selector after repo selected
- [ ] Update `ProjectDialog` to include repo selection
  - [ ] Add storage mode toggle (local vs cloud)
  - [ ] Show RepoSelector when cloud mode selected
- [ ] Backend already supports `repository` field in createProject

### Phase 5: Environment Configuration (Staging/Prod)

Configure GitHub OAuth for deployed environments:

- [ ] Add GitHub OAuth secrets to AWS Secrets Manager
  - [ ] `doc-platform/github-client-id`
  - [ ] `doc-platform/github-client-secret`
- [ ] Update CDK to inject secrets as env vars
- [ ] Set `APP_URL` for each environment
- [ ] Test OAuth flow on staging

## Files Summary

### To Modify

| File | Change |
|------|--------|
| `api/src/handlers/github.ts` | Replace console.error with structured log() |
| `docker-compose.override.yml` | Add GitHub OAuth env vars |
| `web/src/routes/settings/UserSettings.tsx` | Ensure GitHubConnection is rendered |
| `shared/pages/Projects/ProjectDialog.tsx` | Add storage mode & repo selection |
| `infra/lib/api-stack.ts` | Add GitHub OAuth secrets |

### To Create

| File | Purpose |
|------|---------|
| `shared/pages/Projects/RepoSelector.tsx` | Repository selection dropdown |
| `shared/pages/Projects/RepoSelector.module.css` | Styles |

## Environment Variables

| Variable | Description | Where |
|----------|-------------|-------|
| `GITHUB_CLIENT_ID` | OAuth App client ID | Secrets Manager / docker-compose |
| `GITHUB_CLIENT_SECRET` | OAuth App client secret | Secrets Manager / docker-compose |
| `APP_URL` | Base URL for OAuth callbacks | ECS task definition / docker-compose |
| `API_KEY_ENCRYPTION_KEY` | AES key for token encryption | Already configured |

## Logging Events

| Event | Level | When |
|-------|-------|------|
| `github_connect` | info | User successfully connected GitHub |
| `github_connect_failed` | warn | OAuth flow failed (user denied, token error) |
| `github_disconnect` | info | User disconnected GitHub |
| `github_api_error` | warn | GitHub API call failed (rate limit, 4xx/5xx) |
| `github_token_decrypt_failed` | error | Token decryption failed (security concern) |

## Testing Checklist

- [ ] OAuth flow works locally
- [ ] Structured logs appear in container output
- [ ] Token stored encrypted in database
- [ ] Repos/branches endpoints return data
- [ ] Error states handled gracefully in UI
- [ ] Settings page shows connection status
