# REST API & Database Schema Specification

This specification defines the REST API endpoints and database schema for Specboard.

> **Related Specs**:
> - [Project Storage](./project-storage.md) - Git repository connection and storage modes
> - [Authentication](./authentication.md) - Auth flows and session management

---

## Database Schema

### Entity Relationship Diagram

```
┌─────────────┐       ┌─────────────────┐       ┌─────────────┐
│   users     │       │ user_passwords  │       │  github_    │
│             │       │                 │       │  connections│
│  id (PK)    │◄──────│  user_id (FK)   │       │             │
│  username   │       │  password_hash  │       │  user_id(FK)│──►│
│  first_name │       └─────────────────┘       │  github_    │
│  last_name  │                                 │   user_id   │
│  email      │                                 └─────────────┘
│  phone      │
└─────────────┘
       │
       │ owner_id
       ▼
┌─────────────┐       ┌─────────────────┐       ┌─────────────┐
│  projects   │       │   documents     │       │  comments   │
│             │       │                 │       │             │
│  id (PK)    │◄──────│  project_id(FK) │◄──────│ document_id │
│  name       │       │  path           │       │  range_start│
│  owner_id   │       │  title          │       │  range_end  │
│storage_mode │       │  content_hash   │       │  text       │
│ repository  │       │  last_synced    │       │  author_id  │
│ root_paths  │       └─────────────────┘       └─────────────┘
└─────────────┘
       │
       │ project_id
       ▼
┌─────────────┐       ┌─────────────────┐
│   epics     │       │     tasks       │
│             │       │                 │
│  id (PK)    │◄──────│  epic_id (FK)   │
│  project_id │       │  title          │
│  title      │       │  description    │
│  status     │       │  status         │
│  rank       │       │  assignee_id    │
└─────────────┘       └─────────────────┘
```

### Full Schema

```sql
-- Users (core identity)
-- username is immutable after creation
-- email can be changed but must be unique across all users
-- username, slug and names are NULL until onboarding claims them (email-only signup)
CREATE TABLE users (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	username VARCHAR(255) UNIQUE,
	slug VARCHAR(39),
	-- The owner half of every project address (acme/roadmap). Same alphabet as
	-- project slugs, unique site-wide, editable. Defaults to the username lowercased
	-- with _ mapped to -. NULL exactly when username is (users_slug_matches_username),
	-- so every user who can own a project is addressable.
	first_name VARCHAR(255),
	last_name VARCHAR(255),
	email VARCHAR(255) NOT NULL UNIQUE,
	email_verified BOOLEAN DEFAULT FALSE,
	email_verified_at TIMESTAMPTZ,
	phone_number VARCHAR(50),
	avatar_url TEXT,
	created_at TIMESTAMPTZ DEFAULT NOW(),
	updated_at TIMESTAMPTZ DEFAULT NOW(),
	CONSTRAINT users_slug_format CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) <= 39),
	CONSTRAINT users_slug_matches_username CHECK ((username IS NULL) = (slug IS NULL))
);

CREATE UNIQUE INDEX idx_users_slug ON users(slug) WHERE slug IS NOT NULL;

-- User passwords (for username/password auth)
CREATE TABLE user_passwords (
	user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
	password_hash VARCHAR(255) NOT NULL,
	created_at TIMESTAMPTZ DEFAULT NOW(),
	updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- GitHub connections
CREATE TABLE github_connections (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
	github_user_id VARCHAR(255) NOT NULL UNIQUE,
	github_username VARCHAR(255) NOT NULL,
	access_token TEXT NOT NULL,
	refresh_token TEXT,
	token_expires_at TIMESTAMPTZ,
	scopes TEXT[] NOT NULL,
	connected_at TIMESTAMPTZ DEFAULT NOW()
);

-- Projects (container for documentation and planning)
-- See project-storage.md for storage_mode and repository details
CREATE TABLE projects (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	slug VARCHAR(63) NOT NULL,
	-- URL identifier, e.g. "roadmap", unique per owner. Every user-facing URL and API
	-- path addresses a project as <owner slug>/<project slug> (acme/roadmap); the UUID
	-- above is internal only.
	key VARCHAR(10) NOT NULL,
	-- Short uppercase prefix for this project's item keys, e.g. "SB" -> SB-345.
	item_seq INTEGER NOT NULL DEFAULT 0,
	-- Allocator for per-project item numbers; the last number handed out.
	name VARCHAR(255) NOT NULL,
	description TEXT,
	owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	storage_mode TEXT NOT NULL DEFAULT 'none'
		CHECK (storage_mode IN ('none', 'local', 'cloud')),
	repository JSONB NOT NULL DEFAULT '{}',
	-- Local: { "localPath": "/path/to/repo", "branch": "main" }
	-- Cloud: { "remote": { "provider": "github", "owner": "...", "repo": "...", "url": "..." }, "branch": "main" }
	root_paths JSONB NOT NULL DEFAULT '[]',
	-- Array of paths within repo to display, e.g., ["/docs", "/specs"]
	created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_projects_owner_id ON projects(owner_id);

-- Slugs and keys are unique per owner, which is exactly the URL namespace: the owner's
-- user slug plus the project slug resolves to one project.
CREATE UNIQUE INDEX idx_projects_owner_slug ON projects(owner_id, slug);
CREATE UNIQUE INDEX idx_projects_owner_key ON projects(owner_id, key);

-- Project members: everyone besides the owner who can reach a project. The owner is
-- projects.owner_id and never a row here. role is the granted role; an editor without a
-- github_connections row works as a viewer (see multi-user-collaboration.md).
CREATE TABLE project_members (
	project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
	user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	role TEXT NOT NULL CHECK (role IN ('editor', 'viewer')),
	added_by UUID REFERENCES users(id) ON DELETE SET NULL,
	created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	PRIMARY KEY (project_id, user_id)
);
CREATE INDEX idx_project_members_user ON project_members(user_id);

-- Invitations into a project by email. Only the token's SHA-256 is stored. Rows are
-- tombstoned by accepted_at, declined_at or revoked_at, never deleted; an open row past
-- expires_at (7 days from sending or the last resend) is expired.
CREATE TABLE project_invitations (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
	email VARCHAR(255) NOT NULL,          -- lowercased
	role TEXT NOT NULL CHECK (role IN ('editor', 'viewer')),
	token_hash VARCHAR(64) NOT NULL UNIQUE,
	invited_by UUID REFERENCES users(id) ON DELETE SET NULL,
	created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	expires_at TIMESTAMPTZ NOT NULL,
	accepted_at TIMESTAMPTZ,
	declined_at TIMESTAMPTZ,
	revoked_at TIMESTAMPTZ
);
-- At most one open invitation per address per project
CREATE UNIQUE INDEX idx_project_invitations_open
	ON project_invitations(project_id, email)
	WHERE accepted_at IS NULL AND declined_at IS NULL AND revoked_at IS NULL;
CREATE INDEX idx_project_invitations_email ON project_invitations(email)
	WHERE accepted_at IS NULL AND declined_at IS NULL AND revoked_at IS NULL;

-- Repositories (GitHub repos the user has connected - legacy, see projects)
CREATE TABLE repositories (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	github_owner VARCHAR(255) NOT NULL,
	github_repo VARCHAR(255) NOT NULL,
	github_repo_id BIGINT NOT NULL,
	name VARCHAR(255) NOT NULL,
	default_branch VARCHAR(255) DEFAULT 'main',
	last_synced_at TIMESTAMPTZ,
	created_at TIMESTAMPTZ DEFAULT NOW(),
	updated_at TIMESTAMPTZ DEFAULT NOW(),
	UNIQUE(user_id, github_owner, github_repo)
);

-- Documents (metadata cache, content in Git)
CREATE TABLE documents (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	repo_id UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
	path VARCHAR(1024) NOT NULL,
	title VARCHAR(255),
	content_hash VARCHAR(64),
	word_count INTEGER,
	last_synced_at TIMESTAMPTZ,
	created_at TIMESTAMPTZ DEFAULT NOW(),
	updated_at TIMESTAMPTZ DEFAULT NOW(),
	UNIQUE(repo_id, path)
);

CREATE INDEX idx_documents_repo ON documents(repo_id);

-- Document sections (for search and linking)
CREATE TABLE document_sections (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
	heading VARCHAR(500) NOT NULL,
	level INTEGER NOT NULL CHECK (level BETWEEN 1 AND 6),
	start_line INTEGER NOT NULL,
	end_line INTEGER NOT NULL,
	content_hash VARCHAR(64)
);

CREATE INDEX idx_sections_document ON document_sections(document_id);

-- Comments
CREATE TABLE comments (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
	author_id UUID NOT NULL REFERENCES users(id),
	parent_id UUID REFERENCES comments(id) ON DELETE CASCADE,
	range_start_line INTEGER NOT NULL,
	range_start_col INTEGER NOT NULL,
	range_end_line INTEGER NOT NULL,
	range_end_col INTEGER NOT NULL,
	text TEXT NOT NULL,
	resolved BOOLEAN DEFAULT FALSE,
	resolved_at TIMESTAMPTZ,
	resolved_by UUID REFERENCES users(id),
	created_at TIMESTAMPTZ DEFAULT NOW(),
	updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_comments_document ON comments(document_id);

-- Epics
CREATE TABLE epics (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	repo_id UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
	title VARCHAR(500) NOT NULL,
	description TEXT,
	status VARCHAR(50) NOT NULL DEFAULT 'ready' CHECK (status IN ('ready', 'in_progress', 'done')),
	rank INTEGER NOT NULL DEFAULT 0,
	created_at TIMESTAMPTZ DEFAULT NOW(),
	updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_epics_repo_status ON epics(repo_id, status);

-- Tasks
CREATE TABLE tasks (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	repo_id UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
	epic_id UUID REFERENCES epics(id) ON DELETE SET NULL,
	title VARCHAR(500) NOT NULL,
	description TEXT,
	status VARCHAR(50) NOT NULL DEFAULT 'ready' CHECK (status IN ('ready', 'in_progress', 'done')),
	assignee_id UUID REFERENCES users(id) ON DELETE SET NULL,
	due_date DATE,
	rank INTEGER NOT NULL DEFAULT 0,
	created_at TIMESTAMPTZ DEFAULT NOW(),
	updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_tasks_repo_status ON tasks(repo_id, status);
CREATE INDEX idx_tasks_epic ON tasks(epic_id);
CREATE INDEX idx_tasks_assignee ON tasks(assignee_id);

-- Task acceptance criteria
CREATE TABLE task_criteria (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
	text TEXT NOT NULL,
	completed BOOLEAN DEFAULT FALSE,
	order_index INTEGER NOT NULL DEFAULT 0
);

-- Document-Task links
CREATE TABLE document_task_links (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
	task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
	section_id UUID REFERENCES document_sections(id) ON DELETE SET NULL,
	created_at TIMESTAMPTZ DEFAULT NOW(),
	UNIQUE(document_id, task_id)
);

-- MCP tokens (from auth spec)
CREATE TABLE mcp_tokens (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	client_id VARCHAR(255) NOT NULL,
	access_token_hash VARCHAR(255) NOT NULL UNIQUE,
	refresh_token_hash VARCHAR(255),
	scopes TEXT[] NOT NULL,
	expires_at TIMESTAMPTZ NOT NULL,
	created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Audit log (optional, for tracking changes)
CREATE TABLE audit_log (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id UUID REFERENCES users(id) ON DELETE SET NULL,
	action VARCHAR(100) NOT NULL,
	entity_type VARCHAR(100) NOT NULL,
	entity_id UUID NOT NULL,
	changes JSONB,
	created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_audit_entity ON audit_log(entity_type, entity_id);
```

---

## REST API

### Base URL

- Production: `https://api.specboard.io`
- Development: `http://localhost:3000`

### Authentication

All endpoints (except auth) require Bearer token:
```
Authorization: Bearer <access_token>
```

### Response Format

**Success:**
```json
{
	"data": { ... },
	"meta": {
		"requestId": "req-123",
		"timestamp": "2025-12-19T10:30:00Z"
	}
}
```

**Error:**
```json
{
	"error": {
		"code": "NOT_FOUND",
		"message": "Document not found",
		"details": { ... }
	},
	"meta": {
		"requestId": "req-123",
		"timestamp": "2025-12-19T10:30:00Z"
	}
}
```

### Pagination

The item list is windowed, not cursor-paged: a request asks for the first `limit`
rows in rank order, and the response reports how many rows matched in the
`X-Total-Count` header (exposed through CORS). The body stays a plain array.

```
GET /api/projects/:owner/:project/items?status=done&limit=100

X-Total-Count: 842
[ ...100 items, by rank... ]
```

A client that wants more re-requests with a larger `limit`; the item list caps it at
5000 (default 500). This suits the planning views, which grow a per-status window
and re-request it on every poll, and keeps the client from needing a second count
request. Filters (`status`, `type`, `search`) apply before the count.

Without `search` the list is top-level items only. With one, it spans every depth:
`search` matches title and description as a case-insensitive substring, with `%`/`_`
taken literally, and a matched child comes back with `parentKey` set. A term shaped
like a full key (`SB-345`) or a bare number (`345`) additionally matches that one
item exactly, ORed with the text match. Key matching is never a substring match: as
one, `SAM-42` would also match on `s`, `sam`, and `-`, so every keystroke on the way
to typing a key would return the whole project.
`status` and `type` still test the matched item's own row, so a `ready` task under a
`done` epic is returned by `?status=ready&search=...`, and `X-Total-Count` counts the
same deep set as the body.

---

## Endpoints

### Authentication

| Method | Path | Description |
|--------|------|-------------|
| POST | /auth/signup | Create account |
| POST | /auth/login | Login |
| POST | /auth/refresh | Refresh tokens |
| POST | /auth/logout | Logout |
| GET | /auth/github?next=/path | Start GitHub OAuth; the callback lands on `next` (a same-origin path) or Settings |
| GET | /auth/github/callback | GitHub OAuth callback |
| DELETE | /auth/github | Disconnect GitHub |
| GET | /oauth/authorize | MCP OAuth authorize |
| POST | /oauth/token | MCP token exchange |
| POST | /oauth/revoke | Revoke MCP token |

### Users

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/auth/me | Get current user, including `slug` |
| PUT | /api/auth/me | Update names; at onboarding, claim `username` and `slug` together (once) |
| GET | /api/users/:id | Get a user (`me` for yourself; admins can read anyone) |
| PUT | /api/users/:id | Update a user; users can change their own names and `slug`, admins any field |
| POST | /api/users | Create a user (admin); the slug defaults from the username, suffixed past collisions |

A user slug is changed only through `PUT /api/users/:id`. Changing it moves every project
URL the user owns and breaks `.mcp.json` bindings that name it; the old addresses 404
(redirects are SPE-204). A taken slug is a 409.

### Project addresses

Every project-scoped path is `/api/projects/:owner/:project/...`, where `:owner` is the
owner's user slug and `:project` the project slug. Every such route is registered behind
`requireProjectAccess(minRole)` (`api/src/project-access.ts`), which resolves the pair with
`resolveProjectAccess(ownerSlug, projectSlug, userId)` (`shared/db/src/services/projects.ts`),
the one resolver REST and MCP share, before the handler runs:

| Caller | Answer |
|---|---|
| Malformed address | 400 |
| No session | 401 (a logged-out write is refused earlier by CSRF, 403) |
| Neither owner nor member, or no such project | 404, never 403, so other users' projects can't be probed |
| Member below the route's role | 403 `{ error, reason }`, reason `viewer`, `github_not_connected`, or `owner_only` |

The role compared is the effective one: a granted editor without a GitHub connection is a
viewer. Reads and AI chat need viewer; item, document and comment writes, commit and pull need
editor; project settings, repository, folders, delete and member management need owner
([multi-user-collaboration.md](./multi-user-collaboration.md), Roles and Permissions). The
role-matrix suite (`api/src/role-matrix.test.ts`) reads the route table back and fails any
project route registered without a role.

Project responses carry `ownerSlug` and `ownerName` next to `slug`, and the caller's
`grantedRole` and `effectiveRole`. They carry no user ids. A member is sent no `repository` for
a local project, whose `localPath` is a path on the owner's disk.

The single-project GET also carries `pushAccess`: whether the caller's own GitHub account can
push to the repository, `true`, `false`, or `null` when that's unknown or moot (no cloud
repository, no GitHub connection, or GitHub didn't answer in time). It comes from
`GET /repos/{owner}/{repo}` on the caller's token, `permissions.push`, and a 404 there (a
private repo the token can't see) is `false`. Answers are cached in Redis for five minutes per
user and repository; a request waits at most a second for an uncached one and reports `null`
past that, while the check finishes in the background and fills the cache. Connecting or
disconnecting GitHub clears the user's answers, and connecting re-checks their cloud projects.
Specboard doesn't enforce push access; GitHub refuses the commit. It is surfaced so a member
isn't surprised (`api/src/services/push-access.ts`).

Items, notes, blockers and workers go out through the views in `shared/db/src/views.ts`, the
same ones MCP uses: actors keep their type, device name and client, never a user id, OAuth
client id or session id.

### Projects

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/projects | List the projects the user owns or is a member of, each with their role |
| POST | /api/projects | Create project |
| GET | /api/projects/:owner/:project | Get project (viewer) |
| PUT | /api/projects/:owner/:project | Update project (name, description, slug, key, system prompt, repository: attach once) (owner) |
| DELETE | /api/projects/:owner/:project | Delete project (owner) |
| POST | /api/projects/:owner/:project/chat | AI chat over the project's documents, SSE (viewer) |

### Project Members

Members are addressed by user slug, and the member view carries no user id:
`{ slug, name, email, avatarUrl, role, effectiveRole, githubConnected }`, where `role` is the
granted role (`owner` for the owner). The list adds `pushAccess` per person, computed the same
way as the project GET's but on each person's own stored token, so the owner can see who will
have commits refused. The owner isn't a membership, so naming the owner's slug
in a member route is a 409 `PROJECT_OWNER`, and so is the owner leaving.

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/projects/:owner/:project/members | The owner, then members in join order (viewer) |
| PUT | /api/projects/:owner/:project/members/:member | Change a member's role, body `{ "role": "editor" \| "viewer" }`; answers the member view (owner) |
| DELETE | /api/projects/:owner/:project/members/:member | Remove a member (owner) |
| DELETE | /api/projects/:owner/:project/membership | Leave the project: the caller's own membership (viewer) |

People join a project by accepting an invitation.

### Project Invitations

The owner's side lives under the project and is owner-only, the pending list included,
since it carries invitees' addresses. An invitation is
`{ id, email, role, invitedBy, createdAt, expiresAt, state }`, where `state` is `open` or
`expired` and `invitedBy` is the sender's display name.

| Method | Path | Description |
|--------|------|-------------|
| POST | /api/projects/:owner/:project/invitations | Invite `{ "email", "role": "editor" \| "viewer" }`; 201 with the invitation (owner) |
| GET | /api/projects/:owner/:project/invitations | Pending invitations, open or expired, oldest first (owner) |
| POST | /api/projects/:owner/:project/invitations/:invitation/resend | New token, expiry restarts at 7 days; the old link stops working (owner) |
| DELETE | /api/projects/:owner/:project/invitations/:invitation | Revoke; the row stays, stamped (owner) |

- Inviting answers the same whether or not the address has an account. The owner's own
  address is a 409 `PROJECT_OWNER`, a member's a 409 `ALREADY_MEMBER`.
- Inviting an address with an open invitation revokes it and sends a new one. Invites to one
  project take turns on the project row, so a double click leaves exactly one open.
- Sending and resending share one budget per inviting owner, across their projects:
  `projectInvite`, 30 an hour (429 past it).
- The email ("{inviter} invited you to {project} on Specboard as an editor") links to
  `/invite?token=...`. It goes through the same `sendEmail` path as the magic link.

The invitee's side is not under a project, since the caller isn't a member yet, so it has no
`requireProjectAccess` gate. The emailed token only finds an invitation. Reading and answering
one goes by its id, and needs a session whose account's verified email is the invited address.
So the raw token never travels past the first page load: the /invite page's sign-in, signup and
onboarding hops come back as `/invite?id=...`, and only the token's hash is stored anywhere.

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/invite?token=... | What the /invite page shows: `{ id, state, role, projectName, ownerName, inviterName, email, addressedToYou }`. `email` is masked (`k•••@example.com`); `addressedToYou` is null signed out. No side effects |
| GET | /api/invitations | The signed-in user's open, unexpired invitations: `{ id, role, project: { ref, name }, ownerName, inviterName, createdAt, expiresAt }` |
| GET | /api/invitations/:id | One invitation addressed to the signed-in user, in any state, shaped like the token lookup |
| POST | /api/invitations/:id/accept | Answers `{ project: { ref, name }, role, alreadyMember }` |
| POST | /api/invitations/:id/decline | |

When the invitation is the caller's (`addressedToYou: true`), both reads add `project: { ref, name }`,
so an accepted invite can link to the project, and for a revoked, expired or declined one
`openInvitationId`: the newest open invitation to the same address and project, if the owner
invited them again, else null.

Refusals: no session 401 (a session-less POST is refused by CSRF with 403 first); unknown,
malformed or someone else's id 404, the same answer, so an id says nothing about other people's
invitations; expired, revoked, accepted or declined 410 `INVITATION_CLOSED` with `state`; the
owner accepting 409 `PROJECT_OWNER` (the owner never gets a membership); an account without a
slug accepting 409 `ONBOARDING_REQUIRED` (members are addressed by slug).
Accepting as someone who is already a member stamps the invitation accepted and keeps the
role they have, `alreadyMember: true`; changing a role is the owner's call in the member list.
Accepting adds the membership (`added_by` is the inviter) and stamps the invitation in one
transaction. It share-locks the project row first, the row inviting takes, so a re-invite of
the same address either waits and refuses them as a member or revokes the invite before they
can accept it; never a member left with an open invitation.

### Project Storage (see [project-storage.md](./project-storage.md))

| Method | Path | Description |
|--------|------|-------------|
| POST | /api/projects/:owner/:project/folders | Add local folder (only with `LOCAL_STORAGE_ENABLED=true`) (owner) |
| DELETE | /api/projects/:owner/:project/folders | Remove folder from view (owner) |
| POST | /api/projects/:owner/:project/sync | Sync a cloud project from GitHub (editor) |
| POST | /api/projects/:owner/:project/sync/initial | First sync after connecting a repo (editor) |
| GET | /api/projects/:owner/:project/sync/status | Poll sync progress (viewer) |
| POST | /api/projects/:owner/:project/github/commit | Commit the caller's pending changes (editor) |
| GET | /api/projects/:owner/:project/git/status | Changed files (viewer) |
| POST | /api/projects/:owner/:project/git/commit, /git/restore, /git/pull | Commit, discard a change, pull (editor) |

### Project Files

| Method | Path | Description |
|--------|------|-------------|
| GET/POST | /api/projects/:owner/:project/tree | List files/folders (viewer) |
| GET | /api/projects/:owner/:project/files?path=... | Get file content (viewer) |
| PUT | /api/projects/:owner/:project/files?path=... | Save file (editor) |
| POST/DELETE | /api/projects/:owner/:project/files?path=... | Create, delete a file (editor) |
| PUT | /api/projects/:owner/:project/files/rename | Rename a file (editor) |

A local project's files are its owner's alone; to a member it has no storage
([project-storage.md](./project-storage.md)).

### Repositories (Legacy)

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/repos | List repositories |
| POST | /api/repos | Connect repository |
| GET | /api/repos/:id | Get repository |
| DELETE | /api/repos/:id | Disconnect repository |
| POST | /api/repos/:id/sync | Sync with GitHub |

### Documents (Web Platform - Legacy, use Project Files)

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/repos/:repoId/tree | List files/folders |
| GET | /api/repos/:repoId/files | Get file content |
| PUT | /api/repos/:repoId/files | Save file |
| POST | /api/repos/:repoId/files | Create file |
| DELETE | /api/repos/:repoId/files | Delete file |
| POST | /api/repos/:repoId/files/rename | Rename file |
| GET | /api/repos/:repoId/documents | List documents (metadata) |
| GET | /api/repos/:repoId/documents/:id | Get document with sections |
| GET | /api/repos/:repoId/documents/:id/sections | Get sections |

### Comments

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/documents/:docId/comments | List comments |
| POST | /api/documents/:docId/comments | Add comment |
| PATCH | /api/comments/:id | Update comment |
| DELETE | /api/comments/:id | Delete comment |
| POST | /api/comments/:id/resolve | Resolve comment |
| POST | /api/comments/:id/reopen | Reopen comment |
| POST | /api/comments/:id/replies | Add reply |

### Epics

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/repos/:repoId/epics | List epics |
| POST | /api/repos/:repoId/epics | Create epic |
| GET | /api/epics/:id | Get epic |
| PATCH | /api/epics/:id | Update epic |
| DELETE | /api/epics/:id | Delete epic |
| PATCH | /api/epics/:id/rank | Reorder epic |
| PATCH | /api/epics/:id/status | Change status |

### Tasks

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/repos/:repoId/tasks | List tasks |
| POST | /api/repos/:repoId/tasks | Create task |
| GET | /api/tasks/:id | Get task |
| PATCH | /api/tasks/:id | Update task |
| DELETE | /api/tasks/:id | Delete task |
| PATCH | /api/tasks/:id/rank | Reorder task |
| PATCH | /api/tasks/:id/status | Change status |
| PATCH | /api/tasks/:id/assign | Assign task |
| GET | /api/tasks/:id/criteria | List criteria |
| POST | /api/tasks/:id/criteria | Add criterion |
| PATCH | /api/criteria/:id | Update criterion |
| DELETE | /api/criteria/:id | Delete criterion |

### Document-Task Links

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/tasks/:taskId/documents | Get linked documents |
| POST | /api/tasks/:taskId/documents | Link document |
| DELETE | /api/tasks/:taskId/documents/:docId | Unlink document |
| GET | /api/documents/:docId/tasks | Get linked tasks |

### Search

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/repos/:repoId/search/docs | Search documents |
| GET | /api/repos/:repoId/search/tasks | Search tasks |

### AI (Amazon Bedrock)

| Method | Path | Description |
|--------|------|-------------|
| POST | /api/ai/improve | Improve text |
| POST | /api/ai/simplify | Simplify text |
| POST | /api/ai/expand | Expand text |
| POST | /api/ai/review | Review document |
| POST | /api/ai/chat | Chat about document |

---

## Endpoint Examples

### GET /api/repos/:repoId/tree

List files and folders in repository.

**Query Parameters:**
- `path` (optional) - Directory path, defaults to root

**Response:**
```json
{
	"data": {
		"path": "/docs",
		"entries": [
			{
				"name": "requirements",
				"path": "/docs/requirements",
				"type": "directory"
			},
			{
				"name": "README.md",
				"path": "/docs/README.md",
				"type": "file",
				"size": 1234,
				"modifiedAt": "2025-12-19T10:30:00Z"
			}
		]
	}
}
```

### PUT /api/repos/:repoId/files

Save file content.

**Request:**
```json
{
	"path": "/docs/README.md",
	"content": "# Hello World\n\nThis is content.",
	"commitMessage": "Update README"
}
```

**Response:**
```json
{
	"data": {
		"path": "/docs/README.md",
		"commitSha": "abc123",
		"savedAt": "2025-12-19T10:30:00Z"
	}
}
```

### POST /api/repos/:repoId/epics

Create new epic.

**Request:**
```json
{
	"title": "User Authentication",
	"description": "Implement login, signup, and password reset",
	"status": "ready"
}
```

**Response:**
```json
{
	"data": {
		"id": "epic-123",
		"title": "User Authentication",
		"description": "Implement login, signup, and password reset",
		"status": "ready",
		"rank": 0,
		"taskCount": 0,
		"createdAt": "2025-12-19T10:30:00Z"
	}
}
```

### PATCH /api/epics/:id/rank

Reorder epic within column.

**Request:**
```json
{
	"rank": 2,
	"afterEpicId": "epic-456"
}
```

### GET /api/repos/:repoId/search/docs

Search documents.

**Query Parameters:**
- `q` (required) - Search query
- `limit` (optional) - Max results, default 20

**Response:**
```json
{
	"data": {
		"results": [
			{
				"id": "doc-123",
				"title": "Authentication Requirements",
				"path": "/requirements/auth.md",
				"snippet": "...user must be able to <mark>login</mark> with email...",
				"score": 0.95
			}
		],
		"total": 15
	}
}
```

### POST /api/ai/improve

Improve selected text.

**Request:**
```json
{
	"text": "The user login process is not good and should be better.",
	"context": "Full document content for context...",
	"instruction": "Make this more professional"
}
```

**Response:**
```json
{
	"data": {
		"original": "The user login process is not good and should be better.",
		"improved": "The user authentication flow requires optimization to enhance security and user experience.",
		"explanation": "Replaced vague language with specific terminology."
	}
}
```

---

## Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `UNAUTHORIZED` | 401 | Missing or invalid token |
| `FORBIDDEN` | 403 | Insufficient permissions |
| `NOT_FOUND` | 404 | Resource not found |
| `VALIDATION_ERROR` | 400 | Invalid request data |
| `CONFLICT` | 409 | Resource conflict (e.g., duplicate) |
| `RATE_LIMITED` | 429 | Too many requests |
| `GITHUB_ERROR` | 502 | GitHub API error |
| `INTERNAL_ERROR` | 500 | Server error |

---

## Rate Limits

| Endpoint Group | Limit |
|----------------|-------|
| Authentication | 10/minute |
| Read operations | 100/minute |
| Write operations | 30/minute |
| Search | 20/minute |
| AI | 10/minute |
| `GET /api/projects/:owner/:project/items` | 600/minute |
| Project invitation emails (invite and resend), per inviting owner | 30/hour |

The items list gets its own budget because the planning board doesn't fetch it
once per view: it fetches one window per status column, so a single poll (every
10s while the window is focused) and every settled search query each cost five
requests. A normal session therefore runs several times the general read rate,
and the 100/minute cap trips within a minute of typing in the search box. Only
GET is raised; writes to the same path stay on the default.

---

## Webhooks (Future)

For real-time updates, webhooks can notify of changes:

```json
{
	"event": "document.updated",
	"data": {
		"documentId": "doc-123",
		"path": "/docs/README.md",
		"updatedBy": "user-456"
	},
	"timestamp": "2025-12-19T10:30:00Z"
}
```

Events:
- `document.created`
- `document.updated`
- `document.deleted`
- `task.created`
- `task.updated`
- `task.status_changed`
- `comment.created`
