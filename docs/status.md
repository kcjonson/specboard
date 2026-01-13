# Project Status

Last Updated: 2026-01-09 (Added multi-provider AI support with Gemini)

## Epic/Story/Task Template

Use this template for all work items:

```markdown
## Epic Title
**Spec/Documentation:** /path/to/spec.md or /path/to/folder/
**Dependencies:** Epic Name (if applicable)
**Status:** ready | in progress | blocked | needs spec

**Tasks:**
- [ ] Story Title
  - [ ] Task Title
    - [ ] Sub-task Title
```

**Notes:**
- Max 3 levels of nesting (Story → Task → Sub-task)
- Only last 4 completed epics + in-progress + planned epics shown here
- An epic is only complete when ALL tasks are [x]

---

## Recently Completed Epics (Last 4)

### ✅ AI Chat Sidebar
**Spec/Documentation:** `.claude/plans/ai-chat-sidebar.md`, `.claude/plans/gemini-integration.md`, `docs/setup.md`
**Dependencies:** Markdown Editor, Authentication System
**Status:** complete

**Tasks:**
- [x] Database & Encryption
  - [x] Create AES-256-GCM encryption utilities in @doc-platform/auth
  - [x] Database migration for user_api_keys table
  - [x] Add UserApiKey type to shared/db
- [x] Backend API
  - [x] API key CRUD endpoints (list, create, delete, validate)
  - [x] Chat streaming endpoint with SSE
  - [x] Install Anthropic SDK
- [x] Settings UI
  - [x] ApiKeys component (list, add dialog, delete)
  - [x] Integrate into UserSettings page
- [x] Chat Sidebar
  - [x] ChatSidebar component with message list and input
  - [x] ChatMessage component with streaming support
  - [x] Integrate into Editor with toggle button
- [x] Environment & Deployment
  - [x] Add API_KEY_ENCRYPTION_KEY to dev environment (docker-compose.override.yml)
  - [x] Add encryption key secret to CDK/Secrets Manager
  - [x] Create local development setup documentation
- [x] Multi-Provider Support (2026-01-09)
  - [x] Provider abstraction layer (api/src/providers/)
  - [x] Anthropic provider with model selection
  - [x] Google Gemini provider (free tier)
  - [x] Model selector dropdown in chat sidebar
  - [x] Test button for API keys in settings
  - [x] GET /api/chat/models and /api/chat/providers endpoints

---

### ✅ Admin User Management
**Spec/Documentation:** `api/src/handlers/users.ts`, `web/src/routes/settings/UserManagement.tsx`
**Status:** complete

**Tasks:**
- [x] Database schema (roles array, is_active, deactivated_at on users)
- [x] Unified /api/users endpoints with role-based permissions
- [x] UserManagement component in settings page
- [x] Password reset flow (admins use standard forgot-password flow)

---

### ✅ Logging & Monitoring
**Spec/Documentation:** `/docs/specs/logging-monitoring.md`
**Status:** complete

**Tasks:**
- [x] Error tracking integration (Sentry-compatible, tunneled through our API)
- [x] CloudWatch alarms (CPU, memory, 5xx errors)
- [x] Audit logging (login, logout, signup events)

---

### ✅ Staging Deployment
**Spec/Documentation:** `infra/lib/`, `docs/tech-stack.md`
**Status:** complete

**Tasks:**
- [x] CDK Infrastructure (VPC, ECR, ECS, RDS, Redis, ALB)
- [x] GitHub Actions CD (build, migrate, deploy)
- [x] Test data seeding (admin account, GitHub secrets)

---

## In Progress Epics

### Authentication System
**Spec/Documentation:** `/docs/specs/authentication.md`
**Dependencies:** Monorepo Scaffolding
**Status:** in progress

**Goal:** Session-based auth with PostgreSQL users + bcrypt, Redis sessions shared between containers.

**Tasks:**
- [x] Container infrastructure
  - [x] Docker Compose for local dev (includes Redis)
  - [x] API Dockerfile
  - [x] Frontend Dockerfile
  - [x] CI Docker build verification
- [x] Database foundation
  - [x] @doc-platform/db package
  - [x] PostgreSQL connection pool
  - [x] Migration runner (raw SQL)
  - [x] Initial schema migration (users, emails, connections)
- [x] Session infrastructure
  - [x] Redis in Docker Compose
  - [x] @doc-platform/auth package
  - [x] Session middleware for Hono
- [x] Frontend container
  - [x] Hono server for static files
  - [x] Auth middleware integration
  - [x] Login page (server-rendered)
  - [x] Auth proxy endpoints (/api/auth/*)
- [x] Auth API endpoints (mock users)
  - [x] Login/logout handlers
  - [x] Session creation in Redis
  - [x] /api/auth/me endpoint
- [x] Real user auth (PostgreSQL + bcrypt)
  - [x] Add bcrypt to @doc-platform/auth
  - [x] Database migration for user_passwords table
  - [x] Signup endpoint with email verification
  - [x] Login against database users
  - [x] Password reset flow
  - [x] Change password in settings
- [x] Email sending (SES via @doc-platform/email)
  - [x] Verification emails
  - [x] Password reset emails
  - [x] Development mode (console logging)
  - [x] Staging allowlist for test emails
- [ ] GitHub OAuth
  - [ ] Connect flow (link to existing account)
  - [ ] Token encryption (KMS)
  - [ ] GitHub API proxy
  - [ ] Login with GitHub (future)

---

### Markdown Editor
**Spec/Documentation:** `/docs/specs/markdown-editor.md`
**Dependencies:** Platform Abstraction Layer
**Status:** in progress

**Goal:** Build dual-mode Slate.js editor with WYSIWYG and raw markdown modes.

**Tasks:**
- [x] Slate.js setup
  - [x] Configure with Preact (via preact/compat)
  - [x] Define node types (paragraph, heading, blockquote, code-block, lists, link, thematic-break)
  - [x] Define text marks (bold, italic, code, strikethrough)
- [x] WYSIWYG rendering
  - [x] Element renderers
  - [x] Leaf renderers
  - [ ] Prism syntax highlighting for code
- [x] Toolbar with formatting controls
- [x] In-memory mock document for testing
- [ ] Raw mode rendering
  - [ ] Markdown syntax highlighting
  - [ ] Cursor position preservation
- [x] Serialization
  - [x] Markdown → Slate (remark-slate)
  - [x] Slate → Markdown
- [x] Comment system (inline comments)
  - [x] Comment marks on text with highlighting
  - [x] Inline comments UI (Google Docs-style margin comments)
  - [x] Comment storage in markdown (hidden appendix format)
  - [x] Add/reply/resolve comments UI

---

### Project Storage & Git Integration
**Spec/Documentation:** `/docs/specs/project-storage.md`
**Dependencies:** Projects Page
**Status:** in progress

**Goal:** Connect projects to git repositories with local and cloud storage modes.

**Tasks:**
- [x] Database migration
  - [x] Add storage_mode, repository, root_paths columns to projects
- [x] Storage provider interface
  - [x] Define StorageProvider interface
  - [x] LocalStorageProvider implementation
  - [ ] GitStorageProvider implementation (cloud mode)
- [x] API endpoints (local mode first)
  - [x] POST /api/projects/:id/folders (add folder with git validation)
  - [x] DELETE /api/projects/:id/folders (remove from view)
  - [x] GET/POST /api/projects/:id/tree (file listing with expanded state)
  - [x] GET /api/projects/:id/files?path=... (read file)
  - [x] PUT /api/projects/:id/files?path=... (write file)
- [x] FileBrowser UI
  - [x] Empty state with "Add Folder" button
  - [x] Folder picker dialog (local mode - window.prompt for now)
  - [x] Display validation errors (not git repo, different repo)
  - [x] File tree display with expand/collapse
  - [x] Remove folder button on root items
- [ ] Cloud mode support
  - [ ] Platform detection (isCloud vs isElectron)
  - [ ] FileBrowser shows "Connect Repository" for cloud mode
  - [ ] ConnectRepository dialog component
  - [ ] POST /api/projects/:id/repository endpoint
  - [ ] GitStorageProvider implementation
  - [ ] GitHub OAuth for repo access (depends on GitHub OAuth epic)

---

## Planned Epics

### Platform Abstraction Layer
**Spec/Documentation:** `/docs/specs/platform-abstraction.md`
**Dependencies:** Monorepo Scaffolding
**Status:** ready

**Goal:** Create interfaces for FileSystem, Git, and System that work on both Electron and Web.

**Tasks:**
- [ ] Define interfaces
  - [ ] FileSystem interface
  - [ ] Git interface
  - [ ] System interface
- [ ] Electron implementations
  - [ ] Node.js fs for FileSystem
  - [ ] Git CLI wrapper
  - [ ] Electron dialog/shell APIs
- [ ] Web implementations
  - [ ] REST API client for FileSystem
  - [ ] REST API client for Git
  - [ ] Browser APIs for System
- [ ] Preact provider

---

### File Tree & Command Palette
**Spec/Documentation:** `/docs/specs/file-tree-command-palette.md`
**Dependencies:** Project Storage & Git Integration
**Status:** in progress

**Goal:** Build file navigation sidebar and command palette components.

**Tasks:**
- [x] File tree component (basic)
  - [x] Tree rendering with expand/collapse
  - [x] Root path management (remove folder from view)
  - [ ] File/folder icons (better icons)
  - [ ] Context menu (new, rename, delete)
  - [ ] Keyboard navigation
- [ ] Quick open (Cmd+P)
  - [ ] Fuzzy file search
  - [ ] Recent files
  - [ ] Keyboard navigation
- [ ] Command palette (Cmd+K)
  - [ ] Command registry
  - [ ] Fuzzy command search
  - [ ] Keyboard shortcuts display

---

### REST API & Database
**Spec/Documentation:** `/docs/specs/api-database.md`
**Dependencies:** Authentication System
**Status:** in progress

**Goal:** Build backend API with RDS Postgres database.

**Tasks:**
- [x] Database setup
  - [x] RDS Postgres (via CDK staging stack)
  - [x] Schema migrations (users, epics, tasks, projects)
  - [x] Connection pooling (@doc-platform/db)
- [x] API framework
  - [x] Hono server setup
  - [x] Auth middleware (session-based)
  - [x] Error handling
- [x] Core endpoints
  - [x] User management (CRUD with roles)
  - [x] Project management (CRUD)
  - [ ] Document CRUD
  - [x] File/folder operations (local storage)
- [x] Planning endpoints
  - [x] Epic CRUD (PostgreSQL-backed)
  - [x] Task CRUD (PostgreSQL-backed)
  - [x] Document-epic linking (create epic from spec document)
  - [ ] Document-task links

---

### MCP Server
**Spec/Documentation:** `/docs/specs/mcp-integration.md`, `/docs/specs/mcp-claude-workflow.md`
**Dependencies:** REST API & Database
**Status:** complete

**Goal:** Build MCP server for Claude Code integration with planning system.

**Tasks:**
- [x] MCP server v1 (direct DB access)
  - [x] Epic tools (get_ready_epics, get_epic, get_current_work)
  - [x] Task tools (create, update, start/complete/block/unblock)
  - [x] Progress tools (add_progress_note, signal_ready_for_review)
  - [x] Shared service layer in @doc-platform/db
  - [x] Streamable HTTP transport on port 3002
  - [x] Docker container with DATABASE_URL
- [x] Project-scoped APIs
  - [x] All routes use /api/projects/:projectId/...
  - [x] Project ID required for all MCP tools
- [x] CI/CD
  - [x] MCP Docker build in CI
  - [x] MCP ECR repo and Fargate service in infra
  - [x] CD workflow for MCP deployment
- [x] MCP OAuth 2.1 + PKCE
  - [x] OAuth metadata, authorization, and token endpoints
  - [x] PKCE validation and token refresh
  - [x] MCP auth middleware
- [x] Authorized Apps UI
  - [x] Authorizations API endpoints
  - [x] Settings page section with revoke dialog

**Note:** Document tools and CLI tool are v2 features, tracked separately.

---

### Electron Desktop App
**Spec/Documentation:** `/docs/specs/platform-abstraction.md`
**Dependencies:** Markdown Editor, File Tree, Platform Abstraction Layer
**Status:** ready

**Goal:** Package documentation editor as Electron desktop app.

**Tasks:**
- [ ] Electron setup
  - [ ] Main process
  - [ ] Preload scripts
  - [ ] IPC communication
- [ ] Platform implementations
  - [ ] Wire up Electron FileSystem
  - [ ] Wire up Electron Git
  - [ ] Wire up Electron System
- [ ] Build & packaging
  - [ ] electron-builder config
  - [ ] macOS build
  - [ ] Auto-update (future)

---

## Blockers & Issues

(None currently)

---

## MVP Success Criteria

**Documentation Editor MVP:**
1. Open local git repository
2. Browse files in tree
3. Edit markdown in WYSIWYG or raw mode
4. Save and commit changes
5. Desktop app only (Electron)

**Planning MVP:**
1. View three-column board
2. Create/edit epics and tasks
3. Drag to change status
4. Keyboard navigation works
5. Web app only (desktop comes later)

**Stack Validation:**
- Preact renders correctly
- Custom router works
- Custom state management works
- Platform abstraction switches between Electron/Web
