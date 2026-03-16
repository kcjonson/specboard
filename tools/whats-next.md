---
allowed-tools: Bash(git status:*), Bash(git branch:*), Bash(git log:*), Bash(git checkout:*), Bash(git push:*), Bash(git rev-parse:*), Bash(git worktree list:*), Bash(git fetch:*), Bash(git for-each-ref:*), Bash(bash ~/.claude/scripts/assess-git-state.sh), Bash(gh pr list:*), Bash(gh pr view:*), Bash(gh pr create:*), Glob, Grep, Read, mcp__specboard__list_projects, mcp__specboard__get_items, mcp__specboard__create_item, mcp__specboard__create_items, mcp__specboard__update_item, mcp__specboard__delete_item
description: Check current work, find what to do next, and manage your development workflow via Specboard
---

# Specboard Workflow — /whats-next

You are the Specboard workflow coordinator. Follow this process to assess the current state of the user's project and recommend next actions.

## 1. Project Discovery

Call `list_projects` to find the user's project(s) and their IDs.
- If single project: auto-select it
- If multiple: ask the user which project to work on
- Store the `project_id` for all subsequent calls

## 2. Gather State (do these in parallel)

### 2a. Git + Local State
Run the helper script (if available):
```
bash ~/.claude/scripts/assess-git-state.sh
```
This returns JSON with:
- `worktrees`: local git worktrees (path + branch)
- `remoteBranches`: branches with recent activity (last 7 days)
- `incompletePlans`: plan files in `.claude/plans/` without `# COMPLETE` header

If the script is not available, gather this manually:
- `git worktree list` for active worktrees
- `git branch -r --sort=-committerdate` for recent remote branches
- Glob `.claude/plans/*.md` and check first lines for `# COMPLETE`

### 2b. Git Status
- Current branch, uncommitted changes, unpushed commits
- `gh pr list --author=@me` — open PRs (feedback takes highest priority)

### 2c. MCP State
- `get_items(project_id, { status: 'in_progress', include_tasks: true, include_notes: true })` — in-progress items with tasks and notes
- `get_items(project_id, { status: 'in_review', include_tasks: true })` — items in review
- `get_items(project_id, { status: 'ready' })` — available work to pick up

## 3. Cross-Reference & Classify

For each in-progress item from MCP, cross-reference with local state:

| sub_status | Local Worktree? | Remote Activity? | Classification |
|------------|----------------|-------------------|----------------|
| scoping or in_development | yes | — | **Active locally** — skip |
| scoping or in_development | no | recent (<2h) | **Active elsewhere** — skip |
| paused | — | — | **Needs continuation** — suggest |
| needs_input | — | — | **Blocked on input** — show, don't suggest |
| pr_open | — | — | **In review** — check for PR feedback |
| not_started | — | — | **Available** — suggest |

## 4. Priority Framework

Present recommendations in this order:
1. **PR feedback** — Address review comments on in-review items
2. **Resume paused work** — Items with `sub_status: paused`
3. **Continue in-progress** — Items with incomplete tasks
4. **Incomplete plan files** — Plans without `# COMPLETE` that match MCP items
5. **Pick up new work** — Ready items from the backlog

## 5. Present Findings

Output a structured summary:

```
## Current State
- Branch: <current branch>
- Uncommitted changes: <yes/no>
- Open PRs: <count and titles>

## In Progress (<count>)
| Item | Type | Sub-Status | Tasks | Branch |
|------|------|------------|-------|--------|
| ... | ... | ... | done/total | ... |

## Needs Attention
- <paused items, PR items with feedback>

## Ready to Start (<count>)
| Item | Type | Description |
|------|------|-------------|
| ... | ... | ... |

## Recommendation
<What to work on next, based on priority framework>
```

## 6. Picking Up Work

When the user selects an item:

1. `get_items(project_id, { item_id: epic_id, include_tasks: true, include_notes: true })` — read full details + spec_doc_path
2. If `spec_doc_path` is set, read the spec document from the filesystem
3. For epics: create a plan file at `.claude/plans/{description}.md`
4. For chores/bugs: plan file optional (depends on complexity)
5. Create feature branch
6. `update_item(project_id, epic_id, 'epic', { branch_name: '<branch>', sub_status: 'scoping' })`
7. `create_items(project_id, epic_id, items)` — create task breakdown
8. `update_item(project_id, epic_id, 'epic', { sub_status: 'in_development' })` when starting to code
9. Start first task: `update_item(project_id, task_id, 'task', { status: 'in_progress' })`

## 7. During Work

All updates go through `update_item`:

**Tasks:**
- Start: `update_item(project_id, task_id, 'task', { status: 'in_progress' })`
- Complete: `update_item(project_id, task_id, 'task', { status: 'done', note: 'Added Redis session store' })`
- Block: `update_item(project_id, task_id, 'task', { status: 'blocked', note: 'Need auth spec clarification' })`
- Unblock: `update_item(project_id, task_id, 'task', { status: 'ready' })`

**Work items:**
- Blocked on user: `update_item(project_id, epic_id, 'epic', { sub_status: 'needs_input' })`
- Pausing session: `update_item(project_id, epic_id, 'epic', { sub_status: 'paused' })`
- Add decision note: `update_item(project_id, epic_id, 'epic', { notes: 'Decided to use Redis over Memcached' })`

**Side-fixes:** `create_item(project_id, title, 'chore')` or `create_item(project_id, title, 'bug')`

**Key principle:**
- Task completions with notes ARE the progress log
- Plan file = detailed reasoning (Claude's private thinking)
- MCP tasks = human-readable work log (completed tasks with notes)

## 8. Finishing Work

1. Open PR: `gh pr create`
2. `update_item(project_id, epic_id, 'epic', { sub_status: 'pr_open', pr_url: '<url>' })` — auto-sets status to in_review
3. Mark plan file: add `# COMPLETE - {date}` on first line
4. **Stay on the feature branch** — PR feedback may come immediately
5. Note: only the human marks the epic "done" after reviewing

## 9. Work Item Types

- **Epic**: Large feature with linked spec. Human-created only. Full task/progress/PR lifecycle.
- **Chore**: Small non-feature work (cleanup, config, refactoring). Claude can create.
- **Bug**: Defect fix. Claude can create.
- All three types live on the same board and support tasks and notes.

## 10. Role Boundaries

- Claude CANNOT create epics or mark them done
- Claude CAN create chores and bugs
- Claude CAN create/manage tasks under any item type
- Spec documents are human-owned (read, don't write)
