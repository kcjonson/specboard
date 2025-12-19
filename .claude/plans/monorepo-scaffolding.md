# COMPLETE - 2025-12-19

# Monorepo Scaffolding Plan

## Goal
Set up pnpm workspace with Turborepo, configure build tooling, and create package structure.

## Agreed Structure

```
doc-platform/
├── shared/                    # Shared libraries (flat)
│   ├── core/                  # Shared types, utilities
│   ├── ui/                    # Shared Preact components
│   ├── platform/              # Platform abstraction interfaces
│   ├── platform-electron/     # Electron implementations
│   ├── platform-web/          # Web implementations
│   ├── models/                # State management (Model/SyncModel)
│   ├── router/                # Custom client-side router
│   └── fetch/                 # Custom HTTP client wrapper
├── editor-web/                # Documentation editor (Preact web)
├── editor-desktop/            # Documentation editor (Electron)
├── planning-web/              # Planning/task management (Preact web)
├── planning-desktop/          # Planning/task management (Electron)
├── api/                       # Backend API (Node.js)
├── mcp/                       # MCP server
├── infra/                     # AWS CDK infrastructure
└── docs/                      # Project documentation (existing)
```

---

## Phase 1: Update Documentation

Fix discrepancies across docs to match agreed structure.

### Files to update:
- `/docs/tech-stack.md` - Update monorepo structure diagram (lines 53-76)
- `/CLAUDE.md` - Update package structure reference
- `/docs/status.md` - Update epic tasks to match new structure

---

## Phase 2: Root Configuration Files

### 1. `package.json`
- name: "doc-platform"
- private: true
- packageManager: pnpm@9.x
- scripts: dev, build, test, lint (via turbo)
- devDependencies: turbo, typescript

### 2. `pnpm-workspace.yaml`
```yaml
packages:
  - 'shared/*'
  - 'editor-web'
  - 'editor-desktop'
  - 'planning-web'
  - 'planning-desktop'
  - 'api'
  - 'mcp'
  - 'infra'
```

### 3. `turbo.json`
- build: depends on ^build, outputs dist/**
- dev: no cache, persistent
- test: depends on ^build
- lint: no dependencies

### 4. `tsconfig.json` (base)
- strict: true
- target: ES2022
- module: ESNext
- moduleResolution: bundler
- path aliases for @doc-platform/*

### 5. `eslint.config.js`
- Flat config format
- TypeScript rules
- Preact/hooks rules
- Import ordering

---

## Phase 3: Shared Package Stubs

Each package gets:
- `package.json` (name: @doc-platform/<name>)
- `tsconfig.json` (extends root)
- `src/index.ts` (placeholder export)

### Packages:
1. shared/core
2. shared/ui
3. shared/platform
4. shared/platform-electron
5. shared/platform-web
6. shared/models
7. shared/router
8. shared/fetch

---

## Phase 4: App Stubs

### Preact Apps (editor-web, planning-web):
- package.json with Preact, Vite deps
- vite.config.ts (Preact plugin)
- tsconfig.json
- src/main.tsx, src/App.tsx
- index.html

### Electron Apps (editor-desktop, planning-desktop):
- package.json with Electron deps
- tsconfig.json
- src/main.ts (main process)
- src/preload.ts

### Node Apps (api, mcp):
- package.json
- tsconfig.json (node target)
- src/index.ts

### CDK (infra):
- package.json with aws-cdk deps
- tsconfig.json
- bin/ and lib/ structure

---

## Phase 5: Verify Setup

- `pnpm install` succeeds
- `pnpm build` builds all packages
- `pnpm lint` passes
- `pnpm dev` starts apps

---

## Implementation Order

1. Update docs (tech-stack.md, CLAUDE.md, status.md)
2. Root configs (package.json → pnpm-workspace.yaml → turbo.json → tsconfig.json → eslint.config.js)
3. Shared packages (core first, then others)
4. Web apps (editor-web, planning-web)
5. Desktop apps (editor-desktop, planning-desktop)
6. Backend apps (api, mcp)
7. Infra (infra/)
8. Verify everything works
