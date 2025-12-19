# Project Status

Last Updated: 2025-12-19 (Monorepo Scaffolding Complete)

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

### ✅ Initial Project Planning
**Spec/Documentation:** `/docs/specs/`
**Dependencies:** None
**Status:** complete

**Tasks:**
- [x] Tech stack decisions
  - [x] Choose frontend framework (Preact)
  - [x] Choose build tools (pnpm, Turborepo, Vite)
  - [x] Choose backend services (AWS: ECS, Aurora, Cognito, Bedrock)
  - [x] Define custom infrastructure approach (router, fetch, state)
- [x] Write feature specifications
  - [x] Markdown editor spec
  - [x] Authentication spec
  - [x] MCP integration spec
  - [x] Platform abstraction spec
  - [x] API & database spec
  - [x] Planning UI spec
  - [x] File tree & command palette spec
- [x] Project setup
  - [x] LICENSE (PolyForm Noncommercial)
  - [x] CONTRIBUTING.md
  - [x] CLAUDE.md
  - [x] .editorconfig
  - [x] .gitignore

---

## In Progress Epics

(None currently - Monorepo Scaffolding just completed)

---

## Planned Epics

### ✅ Monorepo Scaffolding
**Spec/Documentation:** `/docs/tech-stack.md`
**Dependencies:** None
**Status:** complete

**Goal:** Set up the pnpm workspace with Turborepo, configure build tooling, and create package structure.

**Tasks:**
- [x] Initialize pnpm workspace
  - [x] Create pnpm-workspace.yaml
  - [x] Create turbo.json
  - [x] Configure base tsconfig.json
  - [x] Configure ESLint (eslint.config.js)
- [x] Create shared packages
  - [x] shared/core (types, utilities)
  - [x] shared/ui (Preact components)
  - [x] shared/platform (abstraction interfaces)
  - [x] shared/platform-electron
  - [x] shared/platform-web
  - [x] shared/models (state management)
  - [x] shared/router (custom router)
  - [x] shared/fetch (HTTP client)
- [x] Create apps
  - [x] editor-web (documentation editor, Preact)
  - [x] editor-desktop (documentation editor, Electron)
  - [x] planning-web (task management, Preact)
  - [x] planning-desktop (task management, Electron)
  - [x] api (backend)
  - [x] mcp (MCP server)
  - [x] infra (AWS CDK)

---

### Custom State Management
**Spec/Documentation:** `/docs/tech-stack.md` (Model/SyncModel pattern)
**Dependencies:** Monorepo Scaffolding
**Status:** ready

**Goal:** Implement Model and SyncModel classes for state management based on existing pattern.

**Tasks:**
- [ ] Implement Model class
  - [ ] Observable state with subscriptions
  - [ ] Computed values
  - [ ] Batch updates
- [ ] Implement SyncModel class
  - [ ] Extends Model with API sync
  - [ ] Optimistic updates
  - [ ] Conflict resolution
- [ ] Create Preact bindings
  - [ ] useModel hook
  - [ ] useSyncModel hook

---

### Custom Router
**Spec/Documentation:** `/docs/tech-stack.md`
**Dependencies:** Monorepo Scaffolding
**Status:** ready

**Goal:** Implement lightweight client-side router for Preact apps.

**Tasks:**
- [ ] Router core
  - [ ] Route matching with params
  - [ ] History API integration
  - [ ] Programmatic navigation
- [ ] Preact components
  - [ ] Router provider
  - [ ] Route component
  - [ ] Link component
- [ ] Route guards (auth protection)

---

### Authentication System
**Spec/Documentation:** `/docs/specs/authentication.md`
**Dependencies:** Monorepo Scaffolding
**Status:** ready

**Goal:** Implement Cognito auth with GitHub OAuth for storage connection.

**Tasks:**
- [ ] AWS Cognito setup
  - [ ] CDK stack for User Pool
  - [ ] App client configuration
  - [ ] Post-confirmation Lambda trigger
- [ ] Auth API endpoints
  - [ ] Signup/login/logout
  - [ ] Token refresh
  - [ ] Password reset
- [ ] GitHub OAuth
  - [ ] Connect flow
  - [ ] Token encryption (KMS)
  - [ ] GitHub API proxy
- [ ] Frontend auth
  - [ ] Auth context/provider
  - [ ] Login/signup forms
  - [ ] Protected routes

---

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

### Markdown Editor
**Spec/Documentation:** `/docs/specs/markdown-editor.md`
**Dependencies:** Platform Abstraction Layer
**Status:** ready

**Goal:** Build dual-mode Slate.js editor with WYSIWYG and raw markdown modes.

**Tasks:**
- [ ] Slate.js setup
  - [ ] Configure with Preact
  - [ ] Define node types
  - [ ] Define text marks
- [ ] WYSIWYG rendering
  - [ ] Element renderers
  - [ ] Leaf renderers
  - [ ] Prism syntax highlighting for code
- [ ] Raw mode rendering
  - [ ] Markdown syntax highlighting
  - [ ] Cursor position preservation
- [ ] Serialization
  - [ ] Markdown → Slate (remark-slate)
  - [ ] Slate → Markdown
- [ ] Comment system
  - [ ] Comment marks on text
  - [ ] Comment panel UI
  - [ ] Comment storage in markdown

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

### Planning UI
**Spec/Documentation:** `/docs/specs/kanban-ui.md`
**Dependencies:** Custom State Management, Custom Router
**Status:** ready

**Goal:** Build lightweight planning board with drag-drop and keyboard navigation.

**Tasks:**
- [ ] Board layout
  - [ ] Three-column layout (Ready, In Progress, Done)
  - [ ] Column component
  - [ ] Epic card component
- [ ] Drag and drop
  - [ ] Native drag events
  - [ ] Drop zone highlighting
  - [ ] Optimistic reordering
- [ ] Epic detail modal
  - [ ] Task list
  - [ ] Linked documents
  - [ ] Status/assignee controls
- [ ] Keyboard navigation
  - [ ] Arrow key navigation
  - [ ] Keyboard shortcuts
  - [ ] Quick create (N for epic, C for task)

---

### REST API & Database
**Spec/Documentation:** `/docs/specs/api-database.md`
**Dependencies:** Authentication System
**Status:** ready

**Goal:** Build backend API with Aurora Postgres database.

**Tasks:**
- [ ] Database setup
  - [ ] CDK stack for Aurora Serverless v2
  - [ ] Schema migrations
  - [ ] Connection pooling
- [ ] API framework
  - [ ] Express or Fastify setup
  - [ ] Auth middleware
  - [ ] Error handling
- [ ] Core endpoints
  - [ ] User management
  - [ ] Repository management
  - [ ] Document CRUD
  - [ ] Git operations
- [ ] Planning endpoints
  - [ ] Epic CRUD
  - [ ] Task CRUD
  - [ ] Document-task links

---

### MCP Server
**Spec/Documentation:** `/docs/specs/mcp-integration.md`
**Dependencies:** REST API & Database, Authentication System
**Status:** ready

**Goal:** Build MCP server for Claude Code integration.

**Tasks:**
- [ ] MCP OAuth
  - [ ] Authorization endpoint
  - [ ] Token endpoint
  - [ ] PKCE support
- [ ] MCP tools
  - [ ] Document tools (get, search, list, create, update)
  - [ ] Task tools (get, search, create, update)
- [ ] MCP resources
  - [ ] docs:// URI scheme
  - [ ] planning:// URI scheme
- [ ] CLI tool
  - [ ] Connect command (OAuth flow)
  - [ ] Status command
  - [ ] .mcp.json generation

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
