# MCP Document Operations Specification

Extend the MCP server with document CRUD tools so Claude Code can create, read, edit, move, and delete documents in Specboard projects.

---

## Architecture

### MCP calls API via HTTP (internal service-to-service)

The MCP server proxies document operations to the existing API REST endpoints rather than importing storage providers directly.

```
Claude Code
  |
  v (MCP protocol)
MCP Server (ECS / docker)
  |
  v (HTTP + X-Internal-API-Key)
API Server (ECS / docker)
  |
  v
StorageProvider (Local or Cloud)
```

**Rationale:**
- Storage providers live in `api/src/services/storage/` (not a shared package) -- can't be imported by MCP
- All validation, path security, and epic-reference updates already exist in API handlers
- Both services run on the same Docker/ECS network (negligible latency)
- Follows the existing `StorageClient` -> storage service pattern (`api/src/services/storage/storage-client.ts`)
- MCP containers can't access local filesystems -- only cloud mode works in production

---

## Tools

### list_documents

List all documents in a project's file tree. Returns markdown files (.md, .mdx) within the project's configured root paths.

**Input:**
- `project_id` (string, required) -- project UUID
- `path` (string, optional) -- directory path to list (defaults to all root paths)

**Output:** Array of file entries with name, path, type (file/directory), size, modifiedAt.

**Maps to:** `POST /api/projects/:id/tree`

### read_document

Read the raw markdown content of a document by path.

**Input:**
- `project_id` (string, required) -- project UUID
- `path` (string, required) -- file path relative to repo root (e.g., `/docs/spec.md`)

**Output:** File path, content (string), encoding.

**Maps to:** `GET /api/projects/:id/files?path=...`

### create_document

Create a new markdown document. Auto-adds `.md` extension if not present. Fails if file already exists (409).

**Input:**
- `project_id` (string, required) -- project UUID
- `path` (string, required) -- file path for the new document
- `content` (string, optional) -- markdown content (defaults to `# Untitled\n\n`)

**Output:** File path, success status.

**Maps to:** `POST /api/projects/:id/files?path=...` (API create handler needs modification to accept optional content in body)

### update_document

Replace the content of an existing markdown document.

**Input:**
- `project_id` (string, required) -- project UUID
- `path` (string, required) -- file path of the document
- `content` (string, required) -- new markdown content

**Output:** File path, success status.

**Maps to:** `PUT /api/projects/:id/files?path=...`

### delete_document

Delete a markdown document. Also clears any epic `spec_doc_path` references to the deleted file.

**Input:**
- `project_id` (string, required) -- project UUID
- `path` (string, required) -- file path of the document

**Output:** File path, success status.

**Maps to:** `DELETE /api/projects/:id/files?path=...`

### move_document

Rename or move a document. Also updates any epic `spec_doc_path` references.

**Input:**
- `project_id` (string, required) -- project UUID
- `old_path` (string, required) -- current file path
- `new_path` (string, required) -- new file path

**Output:** Old path, new path, success status.

**Maps to:** `PUT /api/projects/:id/files/rename`

---

## Service-to-Service Authentication

MCP-to-API calls use the same internal service auth pattern as API-to-Storage (`StorageClient`):

- **`X-Internal-API-Key`** header -- shared secret validates the caller is a trusted internal service
- **`X-Internal-User-Id`** header -- userId from the MCP OAuth token, trusted because the API key validates the caller
- Secret stored in AWS Secrets Manager (production) or hardcoded in docker-compose (local dev)

### Changes needed in the API

1. **New middleware** (`shared/auth/src/internal.ts`): Checks `X-Internal-API-Key`, if valid sets `internalUserId` on Hono context
2. **CSRF bypass**: Add `excludeWhen` callback to `csrfMiddleware` so it skips validation when internal auth is present (internal calls don't come from browsers, CSRF is irrelevant)
3. **getUserId fallback**: `api/src/handlers/storage/utils.ts` -- check `c.get('internalUserId')` when no session cookie exists

---

## MCP Implementation

### New files

```
mcp/src/
  api-client.ts                    # HTTP client for API (modeled on StorageClient)
  tools/documents/
    definitions.ts                 # Tool schemas (Tool[] array)
    reads.ts                       # list_documents, read_document handlers
    writes.ts                      # create_document, update_document, delete_document, move_document
    index.ts                       # Router: handleDocumentTool(name, args, userId)
```

### ApiClient pattern

```typescript
class ApiClient {
  private baseUrl: string;   // API_URL env var, default http://api:3001
  private apiKey: string;    // MCP_API_KEY env var

  private async request<T>(method, path, userId, body?, timeoutMs = 30000): Promise<T>
  // Uses fetch with X-Internal-API-Key + X-Internal-User-Id headers
  // AbortController timeout, same pattern as StorageClient

  async listDocuments(projectId, userId): Promise<TreeResponse>
  async readDocument(projectId, path, userId): Promise<FileResponse>
  async createDocument(projectId, path, userId, content?): Promise<CreateResponse>
  async updateDocument(projectId, path, userId, content): Promise<UpdateResponse>
  async deleteDocument(projectId, path, userId): Promise<DeleteResponse>
  async moveDocument(projectId, oldPath, newPath, userId): Promise<MoveResponse>
}
```

### Tool routing in index.ts

Follows `mcp/src/tools/items/index.ts` pattern exactly:
- Validates `project_id` presence
- Calls `verifyProjectAccess(projectId, userId)` from `@specboard/db`
- Routes to handler via switch statement

### Wiring into MCP server

In `mcp/src/index.ts`:
- Import `documentTools` and `handleDocumentTool`
- Add `documentToolNames` set
- Include in `ListToolsRequestSchema` response: `[...projectTools, ...epicTools, ...documentTools]`
- Add routing case in `CallToolRequestSchema` handler

---

## Docker / Infrastructure

### docker-compose.yml changes

```yaml
api:
  environment:
    MCP_API_KEY: local-dev-mcp-key          # New

mcp:
  environment:
    API_URL: http://api:3001                 # New
    MCP_API_KEY: local-dev-mcp-key           # New
  depends_on:
    api:                                     # New -- API must be up for doc calls
      condition: service_started
    db:
      condition: service_healthy
```

### Production (ECS)

- Add `MCP_API_KEY` secret to AWS Secrets Manager
- Pass to both MCP and API task definitions
- Security groups already allow MCP -> API traffic

---

## Constraints

- **Markdown only**: Only `.md` and `.mdx` files are accessible (enforced by API)
- **Path validation**: All paths must start with `/`, no `..` traversal, must be within project `root_paths`
- **File size limit**: 5MB per file (enforced by API)
- **No auto-commit**: Writes go to filesystem (local) or pending changes (cloud). Committing is a separate action.

---

## Scope exclusions (future work)

- **OAuth scope enforcement** (`docs:read`, `docs:write`): Current planning tools don't check scopes either. Add across all tools as a separate effort.
- **Git operations via MCP** (commit, push, pull): Separate epic. Document writes save to disk; committing is a user-initiated action.
- **Search** (`search_docs`): Requires OpenSearch integration, separate epic (Document Search & Intelligence).
- **Doc metrics / access tracking**: Separate epic (Doc Metrics & MCP Access Tracking).

---

## Dependencies

- MCP Server (existing)
- REST API & Database -- file handlers at `api/src/handlers/storage/file-handlers.ts`
- `@specboard/auth` -- CSRF middleware modification
- `@specboard/db` -- `verifyProjectAccess()` for authorization

## Status

Designed -- ready for implementation
