# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Doc-platform is a monorepo containing two products:
1. **Documentation Editor** - Git-backed markdown editor with WYSIWYG/raw modes, commenting, and AI assistance
2. **Planning** - Lightweight task manager with epic/task hierarchy

Built with Preact, TypeScript, and AWS services. For full details, see [docs/tech-stack.md](docs/tech-stack.md).

**Critical Architectural Decisions:**
- Monorepo with pnpm workspaces + Turborepo
- Preact (not React) with custom router, fetch wrapper, and state management
- AWS backend: ECS Fargate, Aurora Postgres, Redis, Bedrock
- Platform abstraction layer for Electron + Web
- See `/docs/specs/` for detailed specifications

## Development Standards

**You are a professional software developer working on production-quality applications.**

### Workflow: Before Writing Code

**ALWAYS follow this process:**

0. **Determine git status**
   - Are you on the correct branch? You most likely need to be on main

1. **Read documentation first**
   - `/docs/status.md` - Current project state
   - Keep explicit todos and work items in this list, with checkboxes
   - Update this document before and after doing any work
   - Relevant specs in `/docs/specs/`
   - Tech stack decisions in `/docs/tech-stack.md`

2. **Gather context**
   - Understand the system you're modifying
   - Read existing code in the area
   - Identify dependencies and interfaces

3. **Ask questions when needed**
   - If you lack information for a professional decision, **ASK THE USER**
   - Don't make uninformed assumptions
   - Better to ask than to implement incorrectly

4. **Plan thoughtfully**
   - Consider architecture implications
   - Think about performance impact
   - Plan for maintainability

5. **Prepare for Coding**
   - Create a new branch to do work in

### Code Quality

- **Industry best practices**: Follow web development conventions
- **Performance-conscious**: Efficient code, profile before optimizing
- **Maintainable**: Clear structure, logical organization
- **Production-quality**: No hacks, no "good enough for now"

**DO:**
- Write production-quality code every time
- Follow the monorepo package hierarchy strictly
- Document non-obvious decisions
- Consider edge cases and error handling

**DON'T:**
- Make uninformed decisions without context
- Skip reading documentation
- Write quick hacks or temporary code
- Ignore established patterns
- Create technical debt
- **NEVER provide time estimates or cost estimates for tasks** - You cannot accurately estimate how long work will take. Focus on clear task descriptions and deliverables instead.

### Clean Code: No Legacy, No Fallbacks

**This is critical. Aggressively delete old code. Never leave legacy fallbacks.**

#### Core Principles

1. **Replace, Don't Layer**
   - When implementing a new approach, DELETE the old implementation in the same commit
   - No `// legacy` comments, no `useNewSystem` flags, no fallback code paths
   - If the new code works, the old code is dead—delete it immediately

2. **One Path Rule**
   - There must be exactly ONE way to accomplish each task in the codebase
   - Multiple code paths for the same functionality = code smell requiring immediate cleanup
   - If you're adding a second way to do something, you must delete the first

3. **Delete First Workflow**
   - Before adding new code, identify what it replaces
   - Delete the old code FIRST, then add the new implementation
   - This forces clean breaks rather than accumulation of dead code

4. **No Feature Flags for Internal Changes**
   - Feature flags are ONLY for user-facing features with gradual rollout requirements
   - Internal refactors don't need flags—just change the code directly
   - If something breaks, fix it—don't create parallel paths

5. **Clean Up On Touch**
   - When modifying any file, actively look for dead code to remove
   - Delete: unused imports, unused functions, commented-out code, unreachable branches
   - Leave every file cleaner than you found it

#### Explicit Anti-Patterns (NEVER DO THESE)

```typescript
// NEVER: Conditional new/old paths
if (useNewSystem) {
	newImplementation();
} else {
	legacyImplementation();  // DELETE THIS
}

// NEVER: "Just in case" fallbacks
result = tryNewApproach();
if (!result) {
	result = oldApproach();  // DELETE THIS
}

// NEVER: Keeping old functions "for reference"
function oldFunction() { /* old implementation */ }  // DELETE THIS
function newFunction() { /* new implementation */ }

// NEVER: Renaming unused variables instead of deleting
function process(_unusedParam: string) { }  // DELETE THE PARAMETER

// NEVER: Re-exporting removed types for "compatibility"
/** @deprecated */ export type OldTypeName = NewTypeName;  // DELETE THIS

// NEVER: TODO comments for removing legacy code
// TODO: Remove this after testing the new system  // NO - DELETE NOW

// NEVER: Version suffixes on functions
function renderV2() { }  // Just name it render() and delete the old one
```

#### The Right Way

```typescript
// CORRECT: One implementation, no alternatives
function render() {
	// The only render implementation
}

// CORRECT: Delete parameters you don't need
function process() {  // Removed unused parameter entirely
	// ...
}

// CORRECT: Replace types directly
type TypeName = NewImplementation;  // Old type is gone

// CORRECT: Clean, single code path
function doOperation(): Result {
	return modernApproach();  // No fallback, this is THE way
}
```

## Key Project Conventions

**Monorepo Structure:**
```
shared/                    # Shared libraries
  core/                    # Shared types, utilities
  ui/                      # Shared Preact components
  platform/                # Platform abstraction interfaces
  platform-electron/       # Electron implementations
  platform-web/            # Web implementations
  models/                  # State management (Model/SyncModel)
  router/                  # Custom client-side router
  fetch/                   # Custom HTTP client wrapper
editor-web/                # Documentation editor (Preact)
editor-desktop/            # Documentation editor (Electron)
planning-web/              # Planning/task management (Preact)
planning-desktop/          # Planning/task management (Electron)
api/                       # Backend API (Node.js)
mcp/                       # MCP server
infra/                     # AWS CDK infrastructure
```

**Naming:**
- Files: kebab-case (`user-profile.tsx`, `auth-middleware.ts`)
- Components: PascalCase (`UserProfile`, `AuthProvider`)
- Functions/variables: camelCase (`getUserById`, `isLoading`)
- Constants: SCREAMING_SNAKE_CASE (`MAX_RETRIES`, `API_URL`)
- CSS classes: kebab-case via CSS Modules

**TypeScript:**
- Strict mode enabled
- Explicit return types on exported functions
- Prefer `interface` over `type` for object shapes
- Use `unknown` over `any`

**Preact:**
- Functional components only
- Use signals for local state where appropriate
- Custom hooks for reusable logic

**CSS:**
- CSS Modules (`.module.css`)
- Design tokens in `tokens.css`
- No CSS-in-JS

**Formatting:**
- Tabs for indentation (EditorConfig enforced)
- ESLint for code quality
- No Prettier

## Documentation System

### When Asked "What are we working on?" or "Where are we?"
→ Check `/docs/status.md` FIRST

### For Technical Specifications
→ Check `/docs/specs/` for feature specifications

### For Tech Stack & Architecture
→ Check `/docs/tech-stack.md`

### For Original Requirements
→ Check `/docs/initial-requirements.md`

## Quick Reference

| When You Need... | Check... |
|------------------|----------|
| Current project status | `/docs/status.md` |
| Tech stack decisions | `/docs/tech-stack.md` |
| Feature specifications | `/docs/specs/` |
| Product requirements | `/docs/initial-requirements.md` |
| Build commands | `README.md` |

## Status.md Format and Workflow

### Structure: Epic/Story/Task Hierarchy

`/docs/status.md` is a **CHECKLIST-ONLY** document. NO long-form content, architectural decisions, or detailed rationale.

**Format:**
- **Epic** → **Story** → **Task** → **Sub-task** (max 3 levels of nesting)
- Use terminology: Epic (top level), Story (major feature), Task (implementation step), Sub-task (detail)

**Required Fields for Each Epic:**
```markdown
## Epic Title
**Spec/Documentation:** /path/to/doc.md or /path/to/folder/
**Dependencies:** Other Epic Name (if applicable)
**Status:** ready | in progress | blocked | needs spec

**Tasks:**
- [ ] Story Title
  - [ ] Task Title
    - [ ] Sub-task Title
```

**Sections in status.md:**
1. **Recently Completed Epics** - Last 4 completed (with ALL tasks marked [x])
2. **In Progress Epics** - Currently active work (at least one task incomplete)
3. **Planned Epics** - Future work
4. **Blockers & Issues** - Current problems

### When to Update status.md

**Before starting work:**
1. Find or create the relevant Epic
2. Mark the Story/Task you're working on as in-progress
3. Check Dependencies field for prerequisite work

**After completing a task:**
1. Mark task as [x]
2. If all tasks in an Epic are complete, mark Epic as complete
3. Update Last Updated timestamp

### Content Placement Rules

**status.md contains:**
- Checklists (Epic/Story/Task/Sub-task)
- Status indicators (ready/in progress/blocked/needs spec)
- Dependencies between epics
- Blockers & issues

**status.md does NOT contain:**
- Architectural decisions (→ specs or tech-stack.md)
- Implementation rationale (→ specs)
- Detailed technical discussion (→ specs)
- Long-form content or paragraphs

## After Significant Work

### Update `/docs/status.md`:
- Mark completed tasks with `[x]`
- Update "Blockers & Issues" if any
- Update "Last Updated" timestamp

### Workflow: After Writing Code

1. **Open a PR**
2. **Switch back to the main branch**

## Plan File Management

When a plan file is confirmed complete (has `# COMPLETE` on first line):

1. Keep in `.claude/plans/` for reference
2. Plans are project-specific, stored in `{project-root}/.claude/plans/`
3. Use descriptive names: `auth-refactor.md`, `editor-comments.md`
