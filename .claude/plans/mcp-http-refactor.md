# MCP Server HTTP Refactor

## Problem

The current MCP server implementation connects **directly to the database**, but the spec clearly states it should communicate via **HTTP to the API**.

**Current (wrong):**
```
Claude Code → MCP Server → Direct DB connection
```

**Spec requirement:**
```
Claude Code → MCP Server (HTTP+SSE) → API (HTTP) → Database
```

## Implementation Summary

### Completed Changes

#### Phase 1: Extended API with Missing Endpoints
- Added `specDocPath`, `prUrl` fields to `ApiEpic` type
- Added `details`, `blockReason` fields to `ApiTask` type
- Added `ApiProgressNote` type
- Added status query param filtering to `GET /api/projects/:projectId/epics`
- Added `GET /api/projects/:projectId/epics/current` for in-progress/in-review epics
- Added task lifecycle endpoints (start/complete/block/unblock)
- Added bulk create tasks endpoint
- Added progress notes handlers
- Added `POST /api/projects/:projectId/epics/:id/ready-for-review`

#### Phase 2: Refactored MCP to Use HTTP Client
- Created `mcp/src/api/client.ts` with ApiClient class
- Updated `epics.ts`, `tasks.ts`, `progress.ts` to use ApiClient
- Removed `@doc-platform/db` dependency from MCP package

#### Phase 3: MCP as HTTP Service
- Changed from `StdioServerTransport` to `StreamableHTTPServerTransport`
- MCP server now runs as HTTP server on port 3002
- Added `/health` endpoint for health checks
- Added `/mcp` endpoint for MCP protocol (SSE + JSON-RPC)
- Created `mcp/Dockerfile` and `mcp/pnpm-workspace.docker.yaml`
- Added MCP service to `docker-compose.yml`

#### Phase 4: Multi-Project Support
- Added `projects` table (migration 005)
- Added `project_id` column to `epics` table
- Updated all API routes to use `/api/projects/:projectId/...` pattern
- Updated all handlers to filter by project ID
- MCP server requires `PROJECT_ID` environment variable

#### Phase 5: CI/CD Updates
- Added MCP Docker build to CI workflow
- Added MCP image push and deployment to CD workflow
- Added MCP ECR repository to infrastructure

## API Route Structure

All planning endpoints are now project-scoped:

```
GET  /api/projects/:projectId/epics
GET  /api/projects/:projectId/epics/current
GET  /api/projects/:projectId/epics/:id
POST /api/projects/:projectId/epics
PUT  /api/projects/:projectId/epics/:id
DELETE /api/projects/:projectId/epics/:id
POST /api/projects/:projectId/epics/:id/ready-for-review

GET  /api/projects/:projectId/epics/:epicId/tasks
POST /api/projects/:projectId/epics/:epicId/tasks
POST /api/projects/:projectId/epics/:epicId/tasks/bulk
PUT  /api/projects/:projectId/tasks/:id
DELETE /api/projects/:projectId/tasks/:id
POST /api/projects/:projectId/tasks/:id/start
POST /api/projects/:projectId/tasks/:id/complete
POST /api/projects/:projectId/tasks/:id/block
POST /api/projects/:projectId/tasks/:id/unblock

GET  /api/projects/:projectId/epics/:epicId/progress
POST /api/projects/:projectId/epics/:epicId/progress
GET  /api/projects/:projectId/tasks/:taskId/progress
POST /api/projects/:projectId/tasks/:taskId/progress
```

## MCP Server Configuration

The MCP server uses HTTP transport (Streamable HTTP), not stdio:

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

Environment variables:
- `PORT` - HTTP server port (default: 3002)
- `API_URL` - Backend API URL (default: http://localhost:3001)
- `PROJECT_ID` - Required. The project ID to scope all operations to
- `API_TOKEN` - Optional. Bearer token for API authentication

## Files Modified

### Database
- `shared/db/migrations/005_projects_schema.sql` - New projects table, project_id column on epics
- `shared/db/src/types.ts` - Added Project interface, project_id to Epic

### API
- `api/src/index.ts` - Updated routes to use project-scoped paths
- `api/src/handlers/epics.ts` - All handlers updated for project filtering
- `api/src/handlers/tasks.ts` - All handlers updated for project filtering
- `api/src/handlers/progress.ts` - All handlers updated for project filtering
- `api/src/types.ts` - Added new types/fields
- `api/src/transform.ts` - Updated transforms

### MCP
- `mcp/src/index.ts` - Changed to HTTP transport, requires PROJECT_ID
- `mcp/src/api/client.ts` - HTTP client with project-scoped paths
- `mcp/src/tools/*.ts` - Updated to use API client
- `mcp/package.json` - Removed db dependency
- `mcp/Dockerfile` - New file for containerization
- `mcp/pnpm-workspace.docker.yaml` - Docker workspace config

### Infrastructure
- `docker-compose.yml` - Added mcp service with PROJECT_ID env var
- `infra/lib/doc-platform-stack.ts` - Added MCP ECR repo, security group, Fargate service
- `.github/workflows/ci.yml` - Added MCP Docker build
- `.github/workflows/cd.yml` - Added MCP image push and deployment

## Future Work

### Authentication (separate epic)
Per spec, full implementation requires OAuth 2.1 + PKCE:
- API endpoints for `/oauth/authorize`, `/oauth/token`
- MCP server auth middleware to validate tokens
- CLI tool for `doc-platform connect`

Currently using simple bearer token for local dev.
