# Project Status

Last Updated: 2025-12-29 (MCP OAuth implementation)

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

### ✅ UI Component Library
**Spec/Documentation:** `shared/ui/src/`
**Dependencies:** Monorepo Scaffolding
**Status:** complete

**Tasks:**
- [x] Create tokens.css with design system values
- [x] Add dark mode support (prefers-color-scheme)
- [x] Button, Dialog, Text, Textarea, Select components
- [x] Card, Badge, StatusDot components
- [x] UserMenu, AppHeader components
- [x] Demo page at /ui route
- [x] Migrate to shared/planning using @doc-platform/ui

---

### ✅ Planning UI
**Spec/Documentation:** `/docs/specs/kanban-ui.md`
**Dependencies:** Custom State Management, Custom Router
**Status:** complete

**Tasks:**
- [x] Board layout (three-column, drag-drop)
- [x] Epic/Task CRUD endpoints (PostgreSQL-backed)
- [x] Epic detail dialog with task list
- [x] Keyboard navigation (arrows, N, 1/2/3, Enter, Escape)
- [x] User menu and settings page

---

### ✅ Pages Layout Setup
**Spec/Documentation:** `docs/specs/kanban-ui.md` (header layout)
**Dependencies:** Pages Scaffolding, UI Component Library
**Status:** complete

**Tasks:**
- [x] Create shared AppHeader component
  - [x] Project name display
  - [x] Navigation tabs (Planning | Pages)
  - [x] User menu integration
- [x] Create Pages three-panel layout
  - [x] FileBrowser placeholder (left sidebar)
  - [x] Editor content area (center)
  - [x] CommentsPanel placeholder (right sidebar)
- [x] Add project-scoped routes
  - [x] /projects/:projectId/planning
  - [x] /projects/:projectId/pages
  - [x] Root redirect to default project
- [x] Update Planning Board to use shared AppHeader
- [x] Move "+ New Epic" button to board-specific toolbar

---

### ✅ Pages Scaffolding
**Spec/Documentation:** `docs/tech-stack.md`
**Dependencies:** Planning UI
**Status:** complete

**Tasks:**
- [x] Restructure packages for unified web app
  - [x] Rename planning-web → web
  - [x] Delete empty editor-web
  - [x] Rename editor-desktop → docs-desktop
- [x] Create shared feature source directories
  - [x] Create shared/planning/ (moved components from planning-web)
  - [x] Create shared/pages/ (new Pages feature components)
- [x] Update routes to use /planning and /pages prefixes
- [x] Add basic Pages placeholder page
- [x] Configure Vite aliases for @shared/planning and @shared/pages
- [x] Update pnpm-workspace.yaml and tsconfig.json

---

## In Progress Epics

### Staging Deployment
**Spec/Documentation:** `infra/lib/`, `docs/tech-stack.md`
**Dependencies:** Container Infrastructure (done)
**Status:** in progress

**Goal:** Deploy to AWS staging environment with CD from main branch.

**Tasks:**
- [x] CDK Infrastructure
  - [x] VPC and networking
  - [x] ECR repositories for container images
  - [x] ECS Cluster with Fargate services
  - [x] RDS Postgres (single-AZ)
  - [x] ElastiCache Redis
  - [x] ALB with path-based routing
  - [x] GitHub OIDC provider + IAM deploy role
- [x] GitHub Actions CD
  - [x] Build and push Docker images to ECR
  - [x] Run database migrations before deploy
  - [x] Deploy to ECS on push to main
- [ ] Configure GitHub secret (AWS_DEPLOY_ROLE_ARN)
- [ ] Mock auth middleware (bypass for staging)

---

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
  - [x] Signup endpoint (email verification TODO)
  - [x] Login against database users
  - [ ] Password reset flow
- [ ] Email sending (SES)
  - [ ] Verification emails
  - [ ] Password reset emails
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
- [ ] Serialization
  - [ ] Markdown → Slate (remark-slate)
  - [ ] Slate → Markdown
- [x] Comment system (inline comments)
  - [x] Comment marks on text with highlighting
  - [x] Inline comments UI (Google Docs-style margin comments)
  - [ ] Comment storage in markdown

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
**Dependencies:** Platform Abstraction Layer
**Status:** ready

**Goal:** Build file navigation sidebar and command palette components.

**Tasks:**
- [ ] File tree component
  - [ ] Tree rendering with expand/collapse
  - [ ] File/folder icons
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

**Goal:** Build backend API with Aurora Postgres database.

**Tasks:**
- [ ] Database setup
  - [ ] CDK stack for Aurora Serverless v2
  - [x] Schema migrations (epics, tasks tables)
  - [x] Connection pooling (@doc-platform/db)
- [x] API framework
  - [x] Hono server setup
  - [ ] Auth middleware
  - [ ] Error handling
- [ ] Core endpoints
  - [ ] User management
  - [ ] Repository management
  - [ ] Document CRUD
  - [ ] Git operations
- [x] Planning endpoints
  - [x] Epic CRUD (PostgreSQL-backed)
  - [x] Task CRUD (PostgreSQL-backed)
  - [ ] Document-task links

---

### MCP Server
**Spec/Documentation:** `/docs/specs/mcp-integration.md`, `/docs/specs/mcp-claude-workflow.md`
**Dependencies:** REST API & Database
**Status:** in progress

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
  - [x] Database migration (add device_name, last_used_at to mcp_tokens)
  - [x] OAuth metadata endpoint (/.well-known/oauth-authorization-server)
  - [x] Authorization endpoint (GET/POST /oauth/authorize)
  - [x] Consent screen UI (device name input, scope display)
  - [x] Token endpoint (POST /oauth/token)
  - [x] PKCE validation (code_challenge/code_verifier)
  - [x] Token refresh flow
  - [x] MCP auth middleware (validate Bearer token, update last_used_at)
- [ ] Authorized Apps UI
  - [x] GET /api/oauth/authorizations endpoint
  - [x] DELETE /api/oauth/authorizations/:id endpoint
  - [ ] Settings page section (frontend component)
  - [ ] Revoke confirmation dialog
- [ ] Document tools (v2)
  - [ ] get_spec, search_docs
- [ ] CLI tool (v2)
  - [ ] Connect command (OAuth flow)
  - [ ] Status command

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
