# Tech Stack & Conventions

Technology choices, coding standards, and development practices for Specboard.

For system design and infrastructure, see [architecture.md](architecture.md).

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
| RDS PostgreSQL | PostgreSQL database (t4g.micro) |
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

See [architecture.md](architecture.md) for the full directory layout and package descriptions.

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
- Absolute imports for packages (`@specboard/ui`)
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

## Decision Log

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Preact over React | Preact | Smaller bundle, compatible API |
| Custom router | Build own | Minimal footprint, no dependencies |
| Custom state | Model pattern | Familiar pattern, fits app needs |
| CSS Modules | CSS Modules | Scoped styles, no runtime |
| ECS over Lambda | ECS Fargate | Consistent local/cloud environment, better for Git ops |
| RDS over DynamoDB | RDS PostgreSQL | Relational data model, full SQL |
| CDK over Terraform | CDK | TypeScript, same language as app |
