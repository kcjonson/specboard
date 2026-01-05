# REST API & Database Schema Specification

This specification defines the REST API endpoints and database schema for doc-platform.

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
CREATE TABLE users (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	username VARCHAR(255) NOT NULL UNIQUE,
	first_name VARCHAR(255) NOT NULL,
	last_name VARCHAR(255) NOT NULL,
	email VARCHAR(255) NOT NULL UNIQUE,
	email_verified BOOLEAN DEFAULT FALSE,
	email_verified_at TIMESTAMPTZ,
	phone_number VARCHAR(50),
	avatar_url TEXT,
	created_at TIMESTAMPTZ DEFAULT NOW(),
	updated_at TIMESTAMPTZ DEFAULT NOW()
);

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
	name VARCHAR(255) NOT NULL,
	description TEXT,
	owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	storage_mode TEXT NOT NULL DEFAULT 'local'
		CHECK (storage_mode IN ('local', 'cloud')),
	repository JSONB NOT NULL DEFAULT '{}',
	-- Local: { "localPath": "/path/to/repo", "branch": "main" }
	-- Cloud: { "remote": { "provider": "github", "owner": "...", "repo": "...", "url": "..." }, "branch": "main" }
	root_paths JSONB NOT NULL DEFAULT '[]',
	-- Array of paths within repo to display, e.g., ["/docs", "/specs"]
	created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_projects_owner_id ON projects(owner_id);

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

- Production: `https://api.doc-platform.com`
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

Request with cursor:
```
GET /api/tasks?limit=20&cursor=eyJpZCI6MTIzfQ
```

Response includes pagination info:
```json
{
	"data": [...],
	"pagination": {
		"limit": 20,
		"hasMore": true,
		"nextCursor": "eyJpZCI6MTQ0fQ"
	}
}
```

---

## Endpoints

### Authentication

| Method | Path | Description |
|--------|------|-------------|
| POST | /auth/signup | Create account |
| POST | /auth/login | Login |
| POST | /auth/refresh | Refresh tokens |
| POST | /auth/logout | Logout |
| GET | /auth/github/connect | Start GitHub OAuth |
| GET | /auth/github/callback | GitHub OAuth callback |
| DELETE | /auth/github | Disconnect GitHub |
| GET | /oauth/authorize | MCP OAuth authorize |
| POST | /oauth/token | MCP token exchange |
| POST | /oauth/revoke | Revoke MCP token |

### Users

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/me | Get current user |
| PATCH | /api/me | Update current user |
| GET | /api/me/emails | List user emails |
| POST | /api/me/emails | Add email |
| DELETE | /api/me/emails/:id | Remove email |
| PATCH | /api/me/emails/:id/primary | Set primary email |

### Projects

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/projects | List user's projects |
| POST | /api/projects | Create project |
| GET | /api/projects/:id | Get project |
| PATCH | /api/projects/:id | Update project |
| DELETE | /api/projects/:id | Delete project |

### Project Storage (see [project-storage.md](./project-storage.md))

| Method | Path | Description |
|--------|------|-------------|
| POST | /api/projects/:id/folders | Add local folder (local mode) |
| DELETE | /api/projects/:id/folders | Remove folder from view |
| POST | /api/projects/:id/repository | Connect GitHub repo (cloud mode) |
| DELETE | /api/projects/:id/repository | Disconnect repository |

### Project Files

| Method | Path | Description |
|--------|------|-------------|
| GET/POST | /api/projects/:id/tree | List files/folders |
| GET | /api/projects/:id/files?path=... | Get file content |
| PUT | /api/projects/:id/files?path=... | Save file |

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
