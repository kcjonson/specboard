# COMPLETE - 2025-12-19

# Tech Stack & Best Practices Documentation Plan

## Goal
Create a foundational tech stack document for doc-platform (Documentation Editor + Kanban Board).

---

## Complete Tech Stack (All Decisions Finalized)

### Frontend
| Area | Choice | Notes |
|------|--------|-------|
| Framework | **Preact** | Lightweight React alternative |
| Styling | **CSS Modules** | Scoped CSS, no runtime |
| Language | **TypeScript** | Strict mode |
| Bundler | **Vite** | Fast dev server, ESM-native |
| Testing | **Vitest** | Fast, works with Vite |
| Desktop | **Electron** | Web + desktop simultaneous |

### Custom Infrastructure (Build From Scratch)
| Component | Approach |
|-----------|----------|
| Router | Custom minimal router |
| Fetch wrapper | Custom with retry, error handling |
| State management | Observable Model/SyncModel pattern |

### AWS Backend
| Component | AWS Service | Notes |
|-----------|-------------|-------|
| Compute | **ECS Fargate** | Containers, same locally and in AWS |
| Database | **RDS PostgreSQL** | t4g.micro, single-AZ staging |
| AI | **Amazon Bedrock** | Claude via AWS platform |
| Auth | **PostgreSQL + bcrypt + Redis sessions** | Self-managed identity |
| Storage | **S3** | Document/asset storage |
| CDN | **CloudFront** | Edge delivery |
| IaC | **AWS CDK (TypeScript)** | Infrastructure as code |

### Tooling
| Area | Choice |
|------|--------|
| Package manager | **pnpm** |
| Build orchestration | **Turborepo** |
| Formatting | **EditorConfig + ESLint** |
| Git operations | Backend-handled |
| Real-time | Polling first, WebSockets later |

---

## Monorepo Structure

```
doc-platform/
├── apps/
│   ├── web/                 # Preact web app
│   ├── desktop/             # Electron wrapper
│   └── api/                 # Node.js backend (runs in ECS)
├── packages/
│   ├── ui/                  # Shared Preact components
│   ├── models/              # Model/SyncModel state management
│   ├── router/              # Custom router
│   ├── fetch/               # Custom fetch wrapper
│   └── types/               # Shared TypeScript types
├── infra/                   # AWS CDK infrastructure
├── docs/
│   ├── tech-stack.md
│   └── specs/
├── .editorconfig
├── eslint.config.js
├── turbo.json
├── pnpm-workspace.yaml
└── package.json
```

---

## Documents to Create

### 1. Main Tech Stack Document
**File**: `docs/tech-stack.md`
- All decisions from above
- Development workflow
- Coding standards
- Monorepo conventions

### 2. Separate Specs (Deeper Discussion Needed)
| Spec | File | Status |
|------|------|--------|
| Markdown Editor | `docs/specs/markdown-editor.md` | Needs discussion: TipTap vs ProseMirror vs custom |
| Authentication | `docs/specs/authentication.md` | PostgreSQL + bcrypt, GitHub OAuth |
| MCP Integration | `docs/specs/mcp-integration.md` | Needs discussion: MCP server design |

---

## Next Steps

1. Write `docs/tech-stack.md` with all confirmed decisions
2. Create spec documents for topics needing deeper discussion
3. Set up monorepo structure
