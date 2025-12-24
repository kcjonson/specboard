# Project Status

Last Updated: 2025-12-24 (API Stub & Board Layout Complete)

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

### ✅ Collection & Nested Models
**Spec/Documentation:** `shared/models/src/`
**Dependencies:** Custom State Management
**Status:** complete

**Tasks:**
- [x] Create Observable interface for Model and Collection
- [x] Implement Collection<T> class with event bubbling
- [x] Create @collection decorator for child model arrays
- [x] Create @model decorator for single nested models
- [x] Update useModel hook to accept Observable
- [x] Write comprehensive tests (26 new tests)

---

### ✅ Custom Router
**Spec/Documentation:** `/docs/tech-stack.md`
**Dependencies:** Monorepo Scaffolding
**Status:** complete

**Tasks:**
- [x] Minimal router implementation
  - [x] Route matching with :param support
  - [x] History API integration (popstate)
  - [x] Automatic <a> click interception
  - [x] Programmatic navigation (navigate function)
- [x] Tests for route matching

---

### ✅ Custom State Management
**Spec/Documentation:** `/docs/tech-stack.md`, `.claude/plans/custom-state-management.md`
**Dependencies:** Monorepo Scaffolding
**Status:** complete

**Tasks:**
- [x] Implement @doc-platform/fetch (FetchClient with interceptors)
- [x] Implement @doc-platform/models (Model, SyncModel, Preact hooks)

---

### ✅ Monorepo Scaffolding
**Spec/Documentation:** `/docs/tech-stack.md`
**Dependencies:** None
**Status:** complete

**Tasks:**
- [x] Initialize pnpm workspace
- [x] Create shared packages (core, ui, platform, models, router, fetch)
- [x] Create apps (editor-web, editor-desktop, planning-web, planning-desktop, api, mcp, infra)

---

## In Progress Epics

### Planning UI
**Spec/Documentation:** `/docs/specs/kanban-ui.md`
**Dependencies:** Custom State Management, Custom Router
**Status:** in progress

**Goal:** Build lightweight planning board with drag-drop and keyboard navigation.

**Tasks:**
- [x] API stub (Hono with in-memory data)
  - [x] Epic CRUD endpoints
  - [x] Task CRUD endpoints
- [x] Board layout
  - [x] Three-column layout (Ready, In Progress, Done)
  - [x] Column component
  - [x] Epic card component
- [x] Drag and drop
  - [x] Native drag events
  - [x] Drop zone highlighting
  - [x] Optimistic reordering within columns
- [x] Epic detail dialog
  - [x] Task list
  - [x] Status/assignee controls
  - [ ] Linked documents (stubbed)
- [ ] Keyboard navigation
  - [ ] Arrow key navigation
  - [ ] Keyboard shortcuts
  - [ ] Quick create (N for epic, C for task)

---

## Planned Epics

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
  - [ ] Hono server setup
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
