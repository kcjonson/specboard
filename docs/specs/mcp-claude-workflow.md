# MCP Server Design: Claude Workflow

This document is the design rationale for how Claude works against Specboard over MCP. The
operational source of truth, the step-by-step process Claude follows, lives in the Specboard
plugin's skill (`plugins/specboard/skills/whats-next/SKILL.md`). This doc explains the model behind
it.

---

## Collaboration model

Specboard supports an AI agent running the full development loop, with the human steering by
exception rather than by gate. Both can write specs. The agent can create epics, break them into
tasks, build, verify, merge, and close. The human stays in control by choosing when to author a
spec themselves and when to hold a PR for review before it merges.

```
Human                                  Claude
─────                                  ──────

(optionally) write a spec        ↔     (optionally) draft a spec, commit it
create / let Claude create an epic ↔   create an epic, link the spec
                                 →     break the epic into tasks
                                 →     work the tasks, keep status accurate
                                 →     verify the work
                                 →     open a PR
(optionally) review the PR       ↔     (with merge authority + verification) merge it
                                 →     close the epic (sub_status: complete)
```

The single invariant: **verification gates closing.** Claude never marks a task `done` or an epic
`complete` without having verified the work (tests green, behavior confirmed). An unverified merge
is never a close.

---

## Three layers of planning

Claude's internal planning tools coexist with the board; they operate at different altitudes.

| Layer | Where | Purpose | Visibility |
|-------|-------|---------|------------|
| **Spec** | `docs/specs/` | The why and what | Shared |
| **MCP tasks** | Specboard | The human-readable checklist | Shared |
| **Plan file** | `.claude/plans/` | Claude's detailed reasoning (the how) | Private |
| **Plan mode** | Claude Code | The scoping activity that produces the plan file | Session |

The plan file is the source; the board is the projection. Plan mode *is* the epic's `scoping`
sub_status, exploring the code and designing the approach. Its steps become the MCP tasks the human
tracks. Keep reasoning and detail in the plan file; keep the trackable checklist on the board.

---

## Status models

### Epic status (board) and sub_status (detail)

The board status is derived from sub_status. Drive the board through sub_status, not the raw status
field.

| sub_status | Meaning | Board status |
|------------|---------|--------------|
| not_started | nothing begun | ready |
| scoping | planning / plan mode / writing the spec | in_progress |
| in_development | actively coding | in_progress |
| needs_input | blocked on a human answer | in_progress |
| paused | stepped away mid-flight | in_progress |
| pr_open | PR open for review | in_review |
| complete | verified and closed | done |

Setting sub_status to `scoping`, `in_development`, or `pr_open` moves the board to `in_progress`;
`complete` moves it to `done`.

### Task status

```
ready ──start──> in_progress ──complete──> done
  ^                   │
  └──── unblock ──── blocked  (block requires a reason)
```

Completing all tasks does not auto-complete the epic. Closing the epic is a deliberate, verified
act.

---

## MCP tools

The server exposes a unified item API. All operations are scoped to a project and authorized per
user (OAuth 2.1 Bearer token).

| Tool | Purpose |
|------|---------|
| `list_projects` | Discover projects (a bound repo returns just its one) |
| `get_items` | Read items by status/type/search, or one by `item_id`, with optional tasks and notes |
| `create_item` | Create an epic, task, or bug (optionally under a `parent_id`); epics may link `specs: [{ path, type }]` |
| `create_items` | Bulk-create tasks under a parent |
| `update_item` | Update title/description/status/sub_status/notes/branch_name/pr_url (items) or status/details/note (tasks) |
| `delete_item` | Delete an item or task |

Specs are read directly from the filesystem using the `path` of each linked spec (the `specs`
array, each entry typed `product` or `technical`). A spec link may point at a path that isn't merged
yet, the path is a stable reference, not a fetch.

Server-level `instructions` (returned at MCP `initialize`) give every connected client a short
summary of this model even without the plugin installed; the plugin carries the full workflow.

---

## What stays human-controlled

By the human's choice, not by a permission wall:

- Whether to write a given spec themselves, or leave it to Claude.
- Whether to review a PR before it merges, or let a verified agent merge and close it.
- Answering Claude's clarifying questions (asked in the chat session).

Everything else, specs, epics, tasks, build, verify, merge, close, Claude can do. The board stays
trustworthy because verification gates every close, not because Claude is fenced out of the loop.
