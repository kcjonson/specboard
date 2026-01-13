# MCP Integration Specification

This specification defines how Claude Code integrates with doc-platform via the Model Context Protocol (MCP).

---

## Overview

MCP enables Claude Code to:
- **Read** documents and tasks for coding context
- **Search** across documentation when answering questions
- **Query** specific sections relevant to current work
- **Create/Update** tasks as work progresses

The MCP server is deployed as a **separate service** from the main API, providing clean isolation and independent scaling.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Claude Code                               │
│                                                                  │
│   Project with .mcp.json config                                 │
└───────────────────────────┬─────────────────────────────────────┘
                            │ MCP Protocol (HTTP + SSE)
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                 MCP Server (ECS Fargate)                         │
│                                                                  │
│   ┌───────────────────────────────────────────────────────────┐ │
│   │                    Auth Middleware                         │ │
│   │                                                            │ │
│   │  • Validates OAuth access tokens                          │ │
│   │  • Checks required scopes per tool                        │ │
│   │  • Rate limiting per user                                 │ │
│   └───────────────────────────────────────────────────────────┘ │
│                            │                                     │
│   ┌────────────────────────┼────────────────────────┐           │
│   │                        │                        │           │
│   ▼                        ▼                        ▼           │
│ ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐       │
│ │  Doc Tools   │  │  Task Tools  │  │   Resources      │       │
│ │              │  │              │  │                  │       │
│ │ get_document │  │ get_task     │  │ docs://...       │       │
│ │ search_docs  │  │ get_backlog  │  │ kanban://...     │       │
│ │ list_docs    │  │ create_task  │  │                  │       │
│ └──────┬───────┘  └──────┬───────┘  └────────┬─────────┘       │
│        │                 │                    │                 │
│        └─────────────────┼────────────────────┘                 │
│                          │                                      │
│                          ▼                                      │
│               ┌─────────────────────┐                          │
│               │    Internal API     │                          │
│               │      Client         │                          │
│               └──────────┬──────────┘                          │
└──────────────────────────┼──────────────────────────────────────┘
                           │
          ┌────────────────┼────────────────┐
          │                │                │
          ▼                ▼                ▼
┌─────────────────┐ ┌────────────┐ ┌───────────────────┐
│   Main API      │ │    RDS     │ │ OpenSearch        │
│   (ECS)         │ │  Postgres  │ │ Serverless        │
└─────────────────┘ └────────────┘ └───────────────────┘
```

---

## Authentication

MCP uses OAuth 2.1 + PKCE (defined in `authentication.md`).

### Required Scopes

| Scope | Description |
|-------|-------------|
| `docs:read` | Read documents, sections, search |
| `docs:write` | Create and update documents |
| `tasks:read` | Read tasks, epics, backlog |
| `tasks:write` | Create and update tasks |

### Token Flow

1. User runs `doc-platform connect` or configures `.mcp.json`
2. OAuth flow obtains access + refresh tokens
3. Claude Code stores tokens securely
4. MCP server validates token on each request
5. Tokens refresh automatically when expired

---

## Configuration

### CLI Setup (Recommended)

```bash
# Install CLI globally
npm install -g @doc-platform/cli

# Connect (opens browser for OAuth)
doc-platform connect

# Outputs:
# ✓ Authenticated as user@example.com
# ✓ Created .mcp.json
# ✓ Connection verified
```

### Generated .mcp.json

```json
{
	"mcpServers": {
		"doc-platform": {
			"url": "https://mcp.doc-platform.com",
			"transport": "http",
			"auth": {
				"type": "oauth",
				"clientId": "claude-code-mcp",
				"tokenStorage": "keychain"
			}
		}
	}
}
```

### Manual Configuration

For advanced users or CI environments:

```json
{
	"mcpServers": {
		"doc-platform": {
			"url": "https://mcp.doc-platform.com",
			"transport": "http",
			"auth": {
				"type": "oauth",
				"clientId": "claude-code-mcp",
				"authorizationUrl": "https://api.doc-platform.com/oauth/authorize",
				"tokenUrl": "https://api.doc-platform.com/oauth/token",
				"scopes": ["docs:read", "docs:write", "tasks:read", "tasks:write"],
				"pkce": true
			}
		}
	}
}
```

---

## Tools

### Documentation Tools

#### get_document

Retrieve a full document by ID.

**Input:**
- `docId` (string, required): The document ID

**Output:**
```
id: string
title: string
path: string
repository:
  id: string
  name: string
  owner: string
content: string (full markdown)
sections: array of
  id: string
  heading: string
  level: 1-6
  startLine: number
  endLine: number
metadata:
  lastModified: ISO timestamp
  lastAuthor: string
  wordCount: number
linkedTasks: array of
  id: string
  title: string
  status: string
```

**Example usage by Claude:**
```
User: "What are the auth requirements?"
Claude: [calls get_document with auth-requirements doc ID]
```

#### get_section

Retrieve a specific section of a document.

**Input:**
- `docId` (string, required): The document ID
- `sectionId` (string, required): The section ID

**Output:**
```
id: string
docId: string
heading: string
level: number
content: string
parentSection: string or null
childSections: string[]
```

#### list_documents

List all documents, optionally filtered by repository.

**Input:**
- `repoId` (string, optional): Filter to specific repository
- `path` (string, optional): Filter by path prefix

**Output:**
```
documents: array of
  id: string
  title: string
  path: string
  repository:
    id: string
    name: string
  lastModified: ISO timestamp
total: number
```

#### search_docs

Full-text search across all documents.

**Input:**
- `query` (string, required): Search query
- `repoId` (string, optional): Limit to repository
- `limit` (number, optional): Max results (default 10, max 50)

**Output:**
```
results: array of
  type: 'document' | 'section'
  id: string
  docId: string
  title: string
  path: string
  snippet: string (highlighted match)
  score: number
  matchedTerms: string[]
total: number
query: string
```

**Example usage by Claude:**
```
User: "What do the docs say about rate limiting?"
Claude: [calls search_docs with query "rate limiting"]
```

#### get_doc_outline

Get the structure/headings of a document.

**Input:**
- `docId` (string, required): The document ID

**Output:**
```
docId: string
title: string
outline: nested array of
  id: string
  heading: string
  level: number
  children: (same structure, recursive)
```

#### create_document

Create a new document. **Requires `docs:write` scope.**

**Input:**
- `repoId` (string, required): Repository ID
- `path` (string, required): Path like "/specs/new-feature.md"
- `title` (string, required): Document title
- `content` (string, required): Markdown content
- `commitMessage` (string, optional): Git commit message

**Output:**
```
id: string
path: string
commitSha: string
```

#### update_document

Update an existing document. **Requires `docs:write` scope.**

**Input:**
- `docId` (string, required): Document ID
- `content` (string, required): New content
- `commitMessage` (string, optional): Git commit message

**Output:**
```
id: string
commitSha: string
lastModified: ISO timestamp
```

---

### Kanban Tools

#### get_task

Retrieve a task by ID.

**Input:**
- `taskId` (string, required): The task ID

**Output:**
```
id: string
title: string
description: string or null
status: 'ready' | 'in_progress' | 'done'
epic:
  id: string
  title: string
  rank: number
assignee:
  id: string
  displayName: string
  avatarUrl: string
acceptanceCriteria: string[]
linkedDocs: array of
  id: string
  path: string
  title: string
  relevantSections: string[]
createdAt: ISO timestamp
updatedAt: ISO timestamp
```

#### get_epic

Retrieve an epic with all its tasks.

**Input:**
- `epicId` (string, required): The epic ID

**Output:**
```
id: string
title: string
description: string or null
status: 'ready' | 'in_progress' | 'done'
rank: number
tasks: array of
  id: string
  title: string
  status: string
  assignee: { displayName: string } or null
progress:
  total: number
  completed: number
linkedDocs: array of
  id: string
  path: string
  title: string
```

#### get_backlog

Get the ranked backlog, optionally filtered by column.

**Input:**
- `column` (string, optional): 'ready' | 'in_progress' | 'done'
- `limit` (number, optional): Default 20

**Output:**
```
epics: array of
  id: string
  title: string
  status: string
  rank: number
  taskCount: number
  completedTasks: number
column: string or null
```

**Example usage by Claude:**
```
User: "What should I work on next?"
Claude: [calls get_backlog with column "ready" to see prioritized work]
```

#### search_tasks

Query tasks with filters.

**Input:**
- `query` (string, optional): Text search
- `status` (string, optional): Filter by status
- `epicId` (string, optional): Filter by epic
- `assigneeId` (string, optional): Filter by assignee
- `limit` (number, optional): Max results

**Output:**
```
tasks: array of
  id: string
  title: string
  status: string
  epic: { id, title } or null
total: number
```

#### create_task

Create a new task. **Requires `tasks:write` scope.**

**Input:**
- `title` (string, required): Task title
- `description` (string, optional): Description
- `epicId` (string, optional): Parent epic
- `status` (string, optional): Default 'ready'
- `acceptanceCriteria` (string[], optional): Criteria list
- `linkedDocIds` (string[], optional): Document IDs to link

**Output:**
```
id: string
title: string
status: string
```

**Example usage by Claude:**
```
User: "Create a task for implementing the login form"
Claude: [calls create_task with title and relevant details]
```

#### update_task

Update an existing task. **Requires `tasks:write` scope.**

**Input:**
- `taskId` (string, required): Task ID
- `title` (string, optional): New title
- `description` (string, optional): New description
- `status` (string, optional): New status
- `epicId` (string, optional): New parent epic
- `acceptanceCriteria` (string[], optional): New criteria
- `linkedDocIds` (string[], optional): New linked docs

**Output:**
```
id: string
updatedFields: string[]
```

#### get_linked_docs

Get documents linked to a specific task. **Requires both `tasks:read` and `docs:read`.**

**Input:**
- `taskId` (string, required): The task ID

**Output:**
```
task:
  id: string
  title: string
documents: array of
  id: string
  title: string
  path: string
  relevantSections: array of
    id: string
    heading: string
    snippet: string
```

**Example usage by Claude:**
```
User: "What are the requirements for the task I'm working on?"
Claude: [calls get_linked_docs to fetch requirement documents]
```

---

## Resources

MCP resources provide URI-based access to data.

### Document Resources

| URI Pattern | Description |
|-------------|-------------|
| `docs://repo/{repoId}` | Repository with document list |
| `docs://doc/{docId}` | Full document |
| `docs://doc/{docId}/section/{sectionId}` | Specific section |
| `docs://search?q={query}` | Search results |

### Kanban Resources

| URI Pattern | Description |
|-------------|-------------|
| `kanban://backlog` | Full backlog |
| `kanban://backlog/{column}` | Column-specific backlog |
| `kanban://epic/{epicId}` | Epic with tasks |
| `kanban://task/{taskId}` | Individual task |

---

## Search Implementation

### OpenSearch Serverless

Full-text search uses AWS OpenSearch Serverless.

#### Index Structure

Documents are indexed with:
- `docId` - Document identifier
- `userId` - Owner for access control
- `repoId` - Repository identifier
- `title` - Searchable, boosted
- `path` - File path
- `content` - Full markdown content
- `sections` - Nested objects with heading, level, content
- `lastModified` - Timestamp

#### Search Behavior

1. Query hits title (3x boost), headings (2x boost), and content
2. Results filtered by userId for access control
3. Fuzzy matching enabled for typo tolerance
4. Highlights returned in snippets
5. Max 50 results per query

---

## CLI Tool

### Installation & Commands

```bash
npm install -g @doc-platform/cli
```

#### connect

Authenticate and create `.mcp.json`:

```bash
doc-platform connect [--global]

# Options:
#   --global    Install to ~/.mcp.json instead of project
```

#### disconnect

Remove authentication:

```bash
doc-platform disconnect
```

#### status

Check connection status:

```bash
doc-platform status

# Output:
# Connected as: user@example.com
# Scopes: docs:read, docs:write, tasks:read, tasks:write
# Token expires: 2025-01-19T10:30:00Z
```

### CLI Behavior

1. `connect` opens browser for OAuth
2. Local server listens for callback
3. Exchanges code for tokens using PKCE
4. Stores tokens in system keychain
5. Creates .mcp.json with configuration

---

## Error Handling

### Error Codes

| Code | Description |
|------|-------------|
| `auth_required` | Missing or invalid token |
| `insufficient_scope` | Token lacks required scope |
| `not_found` | Resource not found |
| `rate_limited` | Too many requests |
| `internal_error` | Server error |

### Error Response Format

```
error:
  code: string
  message: string
  details: object (optional)
```

Example:
```json
{
	"code": "insufficient_scope",
	"message": "This operation requires the 'docs:write' scope",
	"details": {
		"required": "docs:write",
		"provided": ["docs:read", "tasks:read"]
	}
}
```

---

## Rate Limiting

| Scope | Limit |
|-------|-------|
| Per user | 100 requests/minute |
| Search | 20 requests/minute |
| Write operations | 30 requests/minute |

Rate limit headers included in responses:
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1703001234
```

---

## File Structure

```
apps/mcp/
├── src/
│   ├── index.ts              # Server entry point
│   ├── tools/
│   │   ├── documents.ts      # Document tools
│   │   ├── tasks.ts          # Task tools
│   │   └── index.ts
│   ├── resources/
│   │   ├── docs.ts           # Document resources
│   │   ├── kanban.ts         # Kanban resources
│   │   └── index.ts
│   ├── middleware/
│   │   ├── auth.ts           # Auth middleware
│   │   └── rateLimit.ts      # Rate limiting
│   ├── search/
│   │   ├── opensearch.ts     # OpenSearch client
│   │   └── indexer.ts        # Document indexer
│   └── api/
│       └── client.ts         # Internal API client
├── Dockerfile
├── package.json
└── tsconfig.json

packages/cli/
├── src/
│   ├── index.ts              # CLI entry point
│   ├── commands/
│   │   ├── connect.ts
│   │   ├── disconnect.ts
│   │   └── status.ts
│   ├── auth/
│   │   └── pkce.ts           # PKCE utilities
│   └── config/
│       └── mcp-json.ts       # Config file handling
├── package.json
└── tsconfig.json
```

---

## Testing

### Tool Testing Strategy

For each tool:
1. Test with valid auth and correct scope - should succeed
2. Test with valid auth and missing scope - should fail with `insufficient_scope`
3. Test with invalid auth - should fail with `auth_required`
4. Test with non-existent resource - should fail with `not_found`

### Integration Testing Strategy

1. Spin up local MCP server
2. Connect with valid OAuth token
3. Call each tool and verify response structure
4. Test rate limiting behavior

---

## Implementation Status

### Current State (December 2024)

The MCP server is implemented for **planning/task management** with the following features:

#### Completed

- **HTTP Transport**: Uses `StreamableHTTPServerTransport` (not stdio)
- **Project Scoping**: All API endpoints are project-scoped via URL path
- **API Routes**: `GET/POST /api/projects/:projectId/epics`, tasks, progress notes
- **MCP Tools**: `get_ready_epics`, `get_epic`, `get_current_work`, task lifecycle tools
- **Docker Deployment**: MCP runs as separate ECS Fargate service
- **CI/CD**: Automated build and deployment

#### API Route Structure (Project-Scoped)

All planning endpoints use project ID in the URL:

```
/api/projects/:projectId/epics
/api/projects/:projectId/epics/:epicId
/api/projects/:projectId/epics/:epicId/tasks
/api/projects/:projectId/tasks/:taskId/start
/api/projects/:projectId/tasks/:taskId/complete
...
```

#### Local Development Configuration

```json
{
	"mcpServers": {
		"doc-platform": {
			"url": "http://localhost:3002/mcp",
			"transport": "http"
		}
	}
}
```

Environment variables for MCP server:
- `PORT` - HTTP server port (default: 3002)
- `API_URL` - Backend API URL (default: http://localhost:3001)
- `PROJECT_ID` - Required. Project ID to scope all operations
- `API_TOKEN` - Optional. Bearer token for API authentication

#### Not Yet Implemented

- OAuth 2.1 + PKCE authentication (using simple token for now)
- CLI tool (`doc-platform connect`)
- Documentation tools (docs:read, docs:write)
- OpenSearch integration for full-text search
- Rate limiting in MCP server
