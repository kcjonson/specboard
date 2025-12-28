# MCP Server Design: Claude Workflow Analysis

This document analyzes how Claude Code should interact with the planning system via MCP, modeling a realistic dev manager / developer relationship.

---

## Workflow Model: Dev Manager + Developer

The MCP server models a professional development workflow where:

- **Human (Dev Manager)** owns requirements and approval
- **Claude (Developer)** owns task breakdown and implementation

```
Human (Dev Manager)                    Claude (Developer)
───────────────────                    ──────────────────

1. Write spec document           →
2. Create epic, link to spec     →
                                 →     3. Read epic + spec via MCP
                                 →     4. Break down epic into tasks
                                 →     5. Work on tasks, update progress
                                 →     6. Open PR (signals "ready for review")
7. Review PR, give feedback      →
                                 →     8. Address feedback, update tasks
9. Approve & merge PR            →
10. Mark epic as done            →
```

**Key Principles:**

1. **Claude cannot mark epics done** - Only humans can approve completion
2. **PR is a checkpoint, not completion** - Work continues after PR opens
3. **Claude creates tasks, humans create epics** - Clear ownership boundary
4. **Spec documents are the source of truth** - Claude reads, humans write
5. **MCP supplements, doesn't replace, Claude's internal planning** - See below

---

## MCP vs Claude's Internal Planning

Claude has internal planning tools (plan files, TodoWrite) that remain active alongside MCP:

| Layer | Purpose | Visibility |
|-------|---------|------------|
| **Epic + Spec** | Human defines the work | Shared |
| **MCP Tasks** | Claude's breakdown (summary) | Shared |
| **MCP Progress Notes** | Key milestones | Shared |
| **Plan files** (`.claude/plans/`) | Claude's detailed reasoning | Private |
| **TodoWrite** | Claude's immediate session tracking | Private |

**For complex epics, Claude will:**
1. Read epic + spec via MCP
2. Create a local plan file for detailed exploration/design
3. Create MCP tasks as the human-readable summary
4. Use TodoWrite for immediate session work
5. Post MCP progress notes at key milestones
6. Mark plan file COMPLETE when epic work is done

**MCP tasks are the "what" the human sees. Plan files are the "how" Claude thinks through it.**

The MCP system is the coordination layer. Claude's internal tools remain essential for complex work.

---

## Role Permissions

### Human-Only Actions (via UI)

| Action | Description |
|--------|-------------|
| Create epic | Define new work with linked spec |
| Link spec to epic | Associate requirements document |
| Approve epic completion | Mark epic as "done" after verification |
| Merge PR | Final approval of code changes |
| Answer clarifications | Respond to Claude's questions |

### Claude-Only Actions (via MCP)

| Action | Description |
|--------|-------------|
| Read epic + spec | Get requirements and context |
| Create tasks under epic | Break down work into implementable units |
| Update task status/details | Track progress (ready → in_progress → done) |
| Open PR | Signal "ready for review" |
| Add progress notes | Log activity for visibility |

> **v1 assumption:** Claude asks clarifying questions directly in the chat session, not via MCP.

### Shared Actions

| Action | Who | Description |
|--------|-----|-------------|
| Add comments | Both | Discussion on tasks/PRs |
| Update task details | Both | Refine acceptance criteria |

---

## Epic & Task Status Model

### Epic Status (Human-Controlled)

```
┌──────────┐   assign    ┌─────────────┐   PR opened   ┌───────────┐
│  ready   │ ──────────► │ in_progress │ ────────────► │ in_review │
└──────────┘             └─────────────┘               └───────────┘
                                                             │
                                                             │ human approves
                                                             ▼
                                                       ┌──────────┐
                                                       │   done   │
                                                       └──────────┘
```

- `ready` - Epic created, spec linked, waiting for developer
- `in_progress` - Claude is actively working on tasks
- `in_review` - PR opened, awaiting human review
- `done` - Human verified and approved (only human can set this)

### Task Status (Claude-Controlled)

```
┌──────────┐   start    ┌─────────────┐   complete   ┌──────────┐
│  ready   │ ─────────► │ in_progress │ ───────────► │   done   │
└──────────┘            └─────────────┘              └──────────┘
      ▲                       │
      │                       │ block
      │                       ▼
      │                 ┌───────────┐
      └──── unblock ─── │  blocked  │
                        └───────────┘
```

Claude can freely manage task status. Completing all tasks does NOT auto-complete the epic.

---

## MCP Tools for Claude

### Context Loading

| Tool | Purpose | Returns |
|------|---------|---------|
| `get_epic` | Read epic details + linked spec | Epic, spec content, existing tasks |
| `get_current_work` | What am I working on? | In-progress epics/tasks for this user |
| `get_ready_epics` | What's available? | Epics in "ready" status |

### Task Management (Claude creates, humans don't)

| Tool | Purpose | Input |
|------|---------|-------|
| `create_task` | Add task to epic | epicId, title, description |
| `create_tasks` | Bulk add tasks | epicId, tasks[] |
| `update_task` | Modify task details | taskId, fields |
| `start_task` | Begin work | taskId |
| `complete_task` | Finish task | taskId |
| `block_task` | Mark blocked | taskId, reason |
| `unblock_task` | Resume work | taskId |

### Progress & Communication

| Tool | Purpose | Input |
|------|---------|-------|
| `add_progress_note` | Log activity | epicId or taskId, note |
| `signal_ready_for_review` | Indicate PR opened | epicId, prUrl |

> **Note:** In v1, Claude asks questions directly in the chat session. Async clarification workflows are planned for v2.

### Read-Only (Specs & Docs) — Planned for v2

The following tools are planned for a future version:

| Tool | Purpose | Input |
|------|---------|-------|
| `get_spec` | Read linked spec document | epicId or docId |
| `search_docs` | Find relevant documentation | query |

In v1, Claude reads spec documents directly from the filesystem using the `spec_doc_path` field returned by epic tools.

---

## Example Workflow: Claude Picks Up an Epic

### 1. Claude checks for available work

```
→ get_ready_epics()

← {
    epics: [{
      id: "epic-123",
      title: "Add user authentication",
      specPath: "/docs/specs/authentication.md",
      createdBy: "human@example.com",
      createdAt: "2025-01-15T10:00:00Z"
    }]
  }
```

### 2. Claude reads the epic and spec

```
→ get_epic(epicId: "epic-123")

← {
    id: "epic-123",
    title: "Add user authentication",
    status: "ready",
    spec: {
      path: "/docs/specs/authentication.md",
      content: "# Authentication Spec\n\n## Requirements\n..."
    },
    tasks: [],  // None yet - Claude will create these
    linkedDocs: [...]
  }
```

### 3. Claude breaks down into tasks

```
→ create_tasks(
    epicId: "epic-123",
    tasks: [
      { title: "Set up session infrastructure", description: "..." },
      { title: "Create login endpoint", description: "..." },
      { title: "Create signup endpoint", description: "..." },
      { title: "Add auth middleware", description: "..." }
    ]
  )

← {
    created: [
      { id: "task-1", title: "Set up session infrastructure" },
      { id: "task-2", title: "Create login endpoint" },
      ...
    ]
  }
```

### 4. Claude works on tasks

```
→ start_task(taskId: "task-1")
← { status: "in_progress" }

// ... does work ...

→ add_progress_note(taskId: "task-1", note: "Added Redis session store")
← { ok: true }

→ complete_task(taskId: "task-1")
← { status: "done" }
```

### 5. Claude gets stuck, asks for clarification

```
→ request_clarification(
    epicId: "epic-123",
    question: "Should login support both email and username, or email only?"
  )

← { clarificationId: "q-456", status: "pending" }
```

Human answers via UI. Next session:

```
→ get_epic(epicId: "epic-123")

← {
    ...
    pendingClarifications: [],
    answeredClarifications: [{
      id: "q-456",
      question: "Should login support both email and username?",
      answer: "Email only for now. Username login is Phase 2.",
      answeredAt: "2025-01-15T14:30:00Z"
    }]
  }
```

### 6. Claude signals ready for review

```
→ signal_ready_for_review(
    epicId: "epic-123",
    prUrl: "https://github.com/org/repo/pull/42"
  )

← { epicStatus: "in_review" }
```

### 7. Human reviews, requests changes (via PR comments)

Claude addresses feedback, updates tasks as needed.

### 8. Human approves (via UI)

Human merges PR and marks epic "done" in the planning UI. Claude cannot do this.

---

## Data Model

### Epic

```typescript
interface Epic {
  id: string;
  title: string;
  description?: string;
  status: 'ready' | 'in_progress' | 'in_review' | 'done';

  // Human-provided
  specDocId?: string;           // Linked spec document
  createdBy: string;            // Human who created

  // Derived
  tasks: Task[];
  progress: number;             // Completed tasks / total tasks

  // Communication
  clarifications: Clarification[];
  progressNotes: ProgressNote[];

  // Review
  prUrl?: string;               // Set when ready for review
  completedBy?: string;         // Human who approved
  completedAt?: string;
}
```

### Task

```typescript
interface Task {
  id: string;
  epicId: string;
  title: string;
  details?: string;           // Freeform markdown - Claude's working notes
  status: 'ready' | 'in_progress' | 'blocked' | 'done';
  blockReason?: string;

  // Created by Claude
  createdBy: 'claude';

  // Progress - timestamped activity log
  progressNotes: ProgressNote[];

  // Timestamps
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}
```

### Clarification

```typescript
interface Clarification {
  id: string;
  epicId: string;
  taskId?: string;              // Optional - can be epic-level
  question: string;
  askedBy: 'claude';
  askedAt: string;
  answer?: string;
  answeredBy?: string;          // Human who answered
  answeredAt?: string;
}
```

---

## What Claude CANNOT Do

To enforce the dev manager / developer boundary:

1. **Cannot create epics** - Only humans define what work exists
2. **Cannot mark epics done** - Only humans approve completion
3. **Cannot modify specs** - Specs are human-owned requirements
4. **Cannot merge PRs** - Final approval is human-only
5. **Cannot answer clarifications** - Those are questions TO humans

---

## get_current_work Response

The primary tool for Claude to understand context:

```typescript
interface CurrentWorkResponse {
  // Active work
  inProgressEpics: {
    id: string;
    title: string;
    status: 'in_progress' | 'in_review';
    specPath: string;
    tasks: {
      total: number;
      completed: number;
      inProgress: number;
      blocked: number;
    };
    currentTask?: {
      id: string;
      title: string;
      status: string;
      details?: string;       // My working notes
    };
    pendingClarifications: Clarification[];
    recentNotes: ProgressNote[];
  }[];

  // Available to pick up
  readyEpics: {
    id: string;
    title: string;
    specPath: string;
    createdAt: string;
  }[];
}
```

---

## Implementation Priority

### Phase 1: Core Loop (v1)
1. `get_ready_epics` - Find available work
2. `get_epic` - Read epic + spec
3. `create_tasks` - Break down work
4. `start_task`, `complete_task` - Basic lifecycle
5. `signal_ready_for_review` - Handoff to human
6. `add_progress_note` - Visibility for humans
7. `update_task` - Update details as work progresses
8. `get_current_work` - Context loading
9. `block_task`, `unblock_task` - Handle stuck states

### Future (v2+)
- `request_clarification` - For async workflows where human isn't in chat

---

## MCP Resources (Read-Only Context)

| Resource URI | Description |
|--------------|-------------|
| `planning://epics` | List all epics with status |
| `planning://epic/{id}` | Single epic with tasks |
| `docs://spec/{id}` | Spec document content |
| `docs://search?q={query}` | Search results |

---

## Security & Permissions

### OAuth Scopes (v1)

| Scope | Allows |
|-------|--------|
| `epics:read` | Read epics, tasks, specs |
| `tasks:write` | Create/update tasks (not epics) |
| `docs:read` | Read documents |

Claude's token has `epics:read`, `tasks:write`, `docs:read`.

Claude does NOT have `epics:write` (only humans can create/complete epics).

> **Future:** Add `clarifications:write` scope when async workflows are needed.

---

## Next Steps

1. Update database schema: add clarifications table, details field on tasks
2. Implement MCP tools in priority order (Phase 1 first)
3. Build human UI for answering clarifications
4. Add "in_review" status to epic model
5. Connect PR webhooks to auto-detect review state
