# Tech Stack & Best Practices

This document defines the core technologies, architecture decisions, and development practices for doc-platform.

---

## Overview

doc-platform consists of two integrated products:
1. **Documentation Editor** - Git-backed Markdown editor with inline comments and AI assistance
2. **Kanban Board** - Lightweight task manager with epic/task hierarchy

Both share a common infrastructure and are developed in a single monorepo.

---

## Core Technologies

### Frontend

| Technology | Purpose |
|------------|---------|
| Preact | UI framework (lightweight React alternative) |
| TypeScript | Type safety (strict mode) |
| Vite | Build tool and dev server |
| CSS Modules | Scoped styling |
| Vitest | Unit and component testing |
| Electron | Desktop application wrapper |

### API Framework

| Technology | Purpose |
|------------|---------|
| Hono | Lightweight HTTP framework |
| Node.js | Runtime environment |

### Backend (AWS)

| AWS Service | Purpose |
|-------------|---------|
| ECS Fargate | Container hosting (frontend + API) |
| Aurora Serverless v2 | PostgreSQL database |
| ElastiCache Redis | Session storage |
| Amazon Bedrock | AI features (Claude) |
| SES | Email sending (verification, password reset) |
| S3 | File and asset storage |
| CloudFront | CDN for static assets |
| ALB | Load balancer with path routing |
| AWS CDK | Infrastructure as code |

### Tooling

| Tool | Purpose |
|------|---------|
| npm | Package manager (workspaces) |
| ESLint | Code linting and formatting |
| EditorConfig | Basic editor formatting |

---

## Monorepo Structure

```
doc-platform/
├── shared/
│   ├── pages/                 # Pages feature source (no build step)
│   ├── planning/              # Planning feature source (no build step)
│   ├── core/                  # Shared types, utilities (package)
│   ├── ui/                    # Shared Preact components (package, open-sourceable)
│   ├── db/                    # Database connection, migrations (package)
│   ├── auth/                  # Session management, auth middleware (package)
│   ├── platform/              # Platform abstraction interfaces (package)
│   ├── platform-electron/     # Electron implementations (package)
│   ├── platform-web/          # Web implementations (package)
│   ├── models/                # State management (package, open-sourceable)
│   ├── router/                # Custom client-side router (package)
│   └── fetch/                 # Custom HTTP client wrapper (package)
├── web/                       # Unified web app (/pages + /planning routes)
├── docs-desktop/              # Pages Electron app
├── planning-desktop/          # Planning Electron app
├── api/                       # Backend API (Hono)
├── frontend/                  # Frontend server (Hono, serves SPA)
├── mcp/                       # MCP server
├── infra/                     # AWS CDK infrastructure
├── docs/                      # Project documentation
│   ├── tech-stack.md          # This file
│   └── specs/                 # Detailed specifications
├── docker-compose.yml         # Local development containers
├── .editorconfig
├── eslint.config.js
└── package.json
```

### Package Types

**Feature source (no build step):**
- `shared/pages/` - Pages editor components, compiled by apps
- `shared/planning/` - Planning board components, compiled by apps
- Files colocated: `Component.tsx`, `Component.module.css`, `Component.test.ts`
- Imported via `@shared/pages` and `@shared/planning` aliases

**Packages (built, publishable):**
- `shared/ui/` - UI component library (will be open-sourced)
- `shared/models/` - State management core (will be open-sourced)
- Other shared/* packages are internal

**Apps:**
- `web/` - Single web app serving both `/pages` and `/planning` routes
- `docs-desktop/` - Standalone Electron app for Pages
- `planning-desktop/` - Standalone Electron app for Planning

---

## Custom Infrastructure

We build the following from scratch rather than using third-party libraries:

### Router
- Minimal client-side router
- Hash-based or history API routing
- Preact-compatible hooks API

### Fetch Wrapper
- Custom HTTP client with retry logic
- Error handling and normalization
- Request/response interceptors
- TypeScript generics for typed responses

### State Management
Based on the observable Model pattern:

**Model** - Base observable class:
- Static `properties` Set defines allowed fields
- Property accessors via Object.defineProperty
- `on('change', callback)` for subscriptions
- `set(data)` triggers change events
- Immutable via Object.freeze

**SyncModel** - REST-synced extension:
- Static `url` with path-to-regexp templating
- Auto-fetches on construction
- `$meta.working` for loading state

Future extensions:
- Optimistic updates
- WebSocket sync
- Offline support with IndexedDB

---

## Development Workflow

### Local Development
```bash
# Start all services in Docker
docker compose up

# Run tests (inside container)
docker compose run --rm api npm test

# Lint code (inside container)
docker compose run --rm api npm run lint
```

### Branch Strategy
- `main` - stable, deployable code
- Feature branches off `main`
- Pull requests for all changes

### Code Review
- All changes require PR review
- CI must pass before merge
- Squash merge to main

---

## Coding Standards

### TypeScript
- Strict mode enabled
- Explicit return types on exported functions
- No `any` except when absolutely necessary
- Prefer `unknown` over `any` for unknown types

### Naming Conventions
| Item | Convention | Example |
|------|------------|---------|
| Files (components) | PascalCase | `DocumentEditor.tsx` |
| Files (utilities) | camelCase | `formatDate.ts` |
| Components | PascalCase | `DocumentEditor` |
| Functions | camelCase | `fetchDocument` |
| Constants | UPPER_SNAKE | `MAX_FILE_SIZE` |
| Types/Interfaces | PascalCase | `DocumentMetadata` |
| CSS classes | kebab-case | `.document-editor` |

### File Organization
- One component per file
- Co-locate tests with source (`Component.test.tsx`)
- Co-locate styles with components (`Component.module.css`)

### Imports
- Absolute imports for packages (`@doc-platform/ui`)
- Relative imports within a package (`./utils`)
- Group imports: external, internal, relative

---

## Formatting

### EditorConfig
Basic formatting enforced via `.editorconfig`:
- Tabs for indentation (all file types)
- Line endings (LF)
- Final newline
- Trailing whitespace trimmed

### ESLint
Code quality and additional formatting via ESLint:
- TypeScript-specific rules
- Preact/React hooks rules
- Import ordering
- Stylistic rules for consistent code

CI enforces ESLint on all PRs.

---

## Testing Strategy

### Unit Tests (Vitest)
- Test pure functions and utilities
- Mock external dependencies
- Aim for fast, isolated tests

### Component Tests (Vitest + Testing Library)
- Test component behavior, not implementation
- Use `@testing-library/preact`
- Test user interactions

### E2E Tests (Future)
- Playwright for end-to-end testing
- Test critical user flows

### Coverage
- No strict coverage requirements
- Focus on testing critical paths

---

## Container Architecture

### Overview

The application runs as two separate containers that share authentication via Redis:

```
┌──────────────────────────────────────────────────────────┐
│                    Load Balancer (ALB)                   │
│                                                          │
│    /*        → Frontend Container                        │
│    /api/*    → API Container                             │
│    /auth/*   → API Container                             │
└───────────────────────┬──────────────────────────────────┘
                        │
         ┌──────────────┴──────────────┐
         │                             │
┌────────▼────────┐          ┌────────▼────────┐
│    Frontend     │          │      API        │
│    (Hono)       │          │    (Hono)       │
│                 │          │                 │
│ Serves static   │          │ /api/* routes   │
│ files + SPA     │          │ /auth/* routes  │
└────────┬────────┘          └────────┬────────┘
         │                             │
         └──────────────┬──────────────┘
                        │
               ┌────────▼────────┐
               │     Redis       │
               │   (sessions)    │
               └─────────────────┘
```

### Frontend Container
- Hono server serving built SPA static files
- Auth middleware validates session via Redis before serving
- No database access needed

### API Container
- Hono server handling API routes and authentication
- Creates/validates sessions in Redis
- Handles user authentication (PostgreSQL + bcrypt)
- Connects to PostgreSQL for data

### Local Development

See [docs/setup.md](setup.md) for detailed local development setup instructions.

```bash
# Start all services (db, redis, api, frontend)
docker compose up
```

---

## AWS Architecture

### Compute
ECS Fargate runs containers:
- **Frontend container**: Hono server serving static SPA files
- **API container**: Hono server handling API/auth routes
- Same Docker images run locally and in AWS
- Auto-scaling based on load
- ALB routes traffic by path

### Session Storage
ElastiCache Redis:
- Stores user sessions (shared between containers)
- Session ID in HttpOnly cookie
- 30-day TTL with sliding expiration

### Database
Aurora Serverless v2 (PostgreSQL):
- Scales capacity automatically (0.5 - 128 ACUs)
- Full PostgreSQL compatibility
- Automatic backups

### Git Operations
- Backend handles all Git operations (clone, commit, push)
- Uses GitHub OAuth tokens for repository access
- Repositories stored on ECS container ephemeral storage during operations

### AI Integration
Amazon Bedrock with Claude:
- Document improvement suggestions
- Full document AI review
- Sidebar chat assistance

### Authentication
Session-based auth with PostgreSQL + bcrypt:
- Users stored in PostgreSQL with bcrypt-hashed passwords
- API creates Redis session on login
- Both containers validate via Redis session lookup
- GitHub OAuth for repository access (and optional login)

### Infrastructure as Code
AWS CDK (TypeScript):
- All infrastructure defined in code
- Type-safe infrastructure definitions
- Same language as application code

---

## Real-time Sync

Initial implementation uses polling:
- Periodic API calls to check for updates
- Simple to implement and debug

Future: API Gateway WebSockets for real-time updates.

---

## Separate Specifications

The following topics require deeper design documents:

| Spec | File | Description |
|------|------|-------------|
| Markdown Editor | `docs/specs/markdown-editor.md` | Editor architecture, dual-mode implementation |
| Authentication | `docs/specs/authentication.md` | PostgreSQL + bcrypt, GitHub OAuth, MCP PKCE |
| MCP Integration | `docs/specs/mcp-integration.md` | MCP server design for Claude Code |

---

## Decision Log

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Preact over React | Preact | Smaller bundle, compatible API |
| Custom router | Build own | Minimal footprint, no dependencies |
| Custom state | Model pattern | Familiar pattern, fits app needs |
| CSS Modules | CSS Modules | Scoped styles, no runtime |
| ECS over Lambda | ECS Fargate | Consistent local/cloud environment, better for Git ops |
| Aurora over DynamoDB | Aurora | Relational data model, full SQL |
| CDK over Terraform | CDK | TypeScript, same language as app |
