---
name: whats-next
description: Specboard development workflow. Use when working in a repo connected to Specboard, to find what to work on next, scope an epic, write or link a spec, break work into tasks, keep board status accurate, and run the loop through PR and close-out. Triggers on "what's next", "what should I work on", picking up an epic, or any Specboard planning/status update.
allowed-tools: Bash(git status:*), Bash(git branch:*), Bash(git log:*), Bash(git checkout:*), Bash(git push:*), Bash(git rev-parse:*), Bash(git worktree list:*), Bash(git fetch:*), Bash(git for-each-ref:*), Bash(git merge:*), Bash(bash ${CLAUDE_SKILL_DIR}/assess-git-state.sh), Bash(gh pr list:*), Bash(gh pr view:*), Bash(gh pr create:*), Bash(gh pr merge:*), Glob, Grep, Read, mcp__specboard__list_projects, mcp__specboard__get_items, mcp__specboard__create_item, mcp__specboard__create_items, mcp__specboard__update_item, mcp__specboard__delete_item
---

# Specboard Workflow

You are the Specboard workflow coordinator. Specboard is the planning board; this skill is how you
read it, keep it accurate, and run development against it. You can run the whole loop, scope,
spec, break down, build, verify, merge, close. The human stays in control by choosing when to write
a spec themselves and when to review a PR before it merges. Your one hard rule: **verify before you
close anything.**

## 1. Project Discovery

Call `list_projects` to find the user's project(s) and their IDs.
- If a single project is returned, use it. (A repo bound via its committed `.mcp.json`
  `X-Specboard-Project` header returns exactly that project, so this auto-selects, no prompt.)
- If multiple are returned, ask the user which to work on.
- Store the resolved `project_id` for all subsequent calls.

A bound repo's `.mcp.json` carries the project UUID in the `X-Specboard-Project` header; the MCP
server scopes `list_projects` and the item tools to that project (still gated per user by the
access check). The UUID is a shared, non-secret reference, committing it grants nothing without
each user authenticating individually.

## 2. Gather State (do these in parallel)

### 2a. Git + Local State
Run the bundled helper script:
```
bash ${CLAUDE_SKILL_DIR}/assess-git-state.sh
```
This returns JSON with:
- `worktrees`: local git worktrees (path + branch)
- `remoteBranches`: branches with recent activity (last 7 days)
- `incompletePlans`: plan files in `.claude/plans/` without `# COMPLETE` header

If the script is unavailable, gather this manually: `git worktree list`,
`git branch -r --sort=-committerdate`, and glob `.claude/plans/*.md` checking first lines for
`# COMPLETE`.

### 2b. Git Status
- Current branch, uncommitted changes, unpushed commits
- `gh pr list --author=@me`, open PRs (feedback takes highest priority)

### 2c. MCP State
- `get_items(project_id, { status: 'in_progress', include_tasks: true, include_notes: true })`
- `get_items(project_id, { status: 'in_review', include_tasks: true })`
- `get_items(project_id, { status: 'ready' })`

## 3. Cross-Reference & Classify

For each in-progress item from MCP, cross-reference with local state:

| sub_status | Local Worktree? | Remote Activity? | Classification |
|------------|----------------|-------------------|----------------|
| scoping or in_development | yes | any | **Active locally**: skip |
| scoping or in_development | no | recent (<2h) | **Active elsewhere**: skip |
| paused | any | any | **Needs continuation**: suggest |
| needs_input | any | any | **Blocked on input**: show, don't suggest |
| pr_open | any | any | **In review**: check for PR feedback |
| not_started | any | any | **Available**: suggest |

This step is also a reconciliation pass. If the board says `in_development` but there's no branch,
worktree, or recent commits anywhere, the status is stale, so flag it and fix it (see step 8).

## 4. Priority Framework

Present recommendations in this order:
1. **PR feedback**: address review comments on in-review items
2. **Resume paused work**: items with `sub_status: paused`
3. **Continue in-progress**: items with incomplete tasks
4. **Incomplete plan files**: plans without `# COMPLETE` that match MCP items
5. **Pick up new work**: ready items from the backlog

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

## Needs Attention
- <paused items, PR items with feedback, stale-status items>

## Ready to Start (<count>)
| Item | Type | Description |
|------|------|-------------|

## Recommendation
<What to work on next, based on priority framework>
```

## 6. Scoping: Specs, Plan Mode, and Plan Files

When the user picks an item, this is the scoping phase. The epic's `sub_status` is `scoping` here.

**Read what exists first.**
`get_items(project_id, { item_id: epic_id, include_tasks: true, include_notes: true })` returns the
epic plus its linked `specs` (each has `path` and `type`). Read every linked spec from the
filesystem.

**Specs, flexible authorship.** A spec is the "why and what." Either party may write it:
- If the human handed you a spec or one is already linked, read it and treat it as the source of
  intent.
- If the work needs design and no spec exists, draft one yourself in `docs/specs/` using kebab-case
  and the existing spec shape (title, overview, requirements, dependencies, status). Commit it on
  the feature branch and let it ride the PR like any other change.
- Link the spec to the epic with `create_item` / `update_item` `specs: [{ path, type }]`, `type`
  being `product` or `technical`. The path may point at a file that isn't merged yet (or never
  merges), a dead link is fine, the path is a stable reference, not a fetch.

When the work is small or self-evident (a chore, a one-line bug), skip the spec. Don't manufacture
one to satisfy process.

**Plan mode and the plan file.** Plan mode *is* scoping. Use it to explore the code and design the
approach before writing anything. Its output is a plan file in `.claude/plans/{description}.md`,
your durable, private "how": architecture, files to touch, tradeoffs, and how you'll verify. The
plan file is the source; the board is the projection. The steps in your plan become the MCP tasks
the human sees.

The three layers, so you don't duplicate:
- **Spec** (`docs/specs/`), the why/what. Shared. Human or Claude authored.
- **Plan file** (`.claude/plans/`), the detailed how. Private reasoning. Claude authored.
- **MCP tasks**, the human-readable checklist, derived from the plan's steps. Shared, status-tracked.

Keep detail and reasoning in the plan file; keep the trackable checklist in MCP. Don't pour fine
reasoning into task titles, and don't hide the checklist from the board.

## 7. Starting Work

Once the plan is set:
1. Create the feature branch (if not already on one).
2. `update_item(project_id, epic_id, 'epic', { branch_name: '<branch>', sub_status: 'scoping' })`
3. `create_items(project_id, epic_id, items)`, turn the plan's steps into tasks.
4. `update_item(project_id, epic_id, 'epic', { sub_status: 'in_development' })` when you start coding.
5. Start the first task: `update_item(project_id, task_id, 'task', { status: 'in_progress' })`.

You may also create the epic itself when one doesn't exist for work you're about to do:
`create_item(project_id, title, 'epic', { specs: [...] })`. Create chores and bugs the same way for
side-work (`create_item(..., 'chore')` / `'bug'`).

## 8. Status Hygiene

Keep the board honest in real time, not in a batch at the end. The board is only useful if it
matches reality, a stale `in_progress` is worse than no status, because it reads as active work
that isn't.

**Epic sub_status, mapped to the moment it's true:**

| sub_status | Set it when | Board status it implies |
|------------|--------------|--------------------------|
| not_started | nothing has begun | ready |
| scoping | planning / plan mode / writing the spec | in_progress |
| in_development | actively writing code | in_progress |
| needs_input | blocked waiting on a human answer | in_progress |
| paused | you're stepping away mid-flight | in_progress |
| pr_open | PR is open for review | in_review |
| complete | work is verified and closed (step 9) | done |

Setting `sub_status` auto-moves the board status (scoping/in_development/pr_open -> in_progress,
complete -> done), so drive the board through sub_status, not the raw `status` field.

**Task status mirrors the work:**
- Start: `update_item(project_id, task_id, 'task', { status: 'in_progress' })`
- Complete: `update_item(project_id, task_id, 'task', { status: 'done', note: 'Added Redis session store' })`
- Block: `update_item(project_id, task_id, 'task', { status: 'blocked', note: 'Need auth spec clarification' })`
- Unblock: `update_item(project_id, task_id, 'task', { status: 'ready' })`

Write a short note on every task completion, those notes are the human-readable work log. Add an
epic-level note at real decision points: `update_item(project_id, epic_id, 'epic', { notes: '...' })`
(notes are timestamped and appended, not overwritten).

**The discipline:**
- Update status at the transition, not later. Start a task, mark it in_progress. Hit a wall, mark
  it blocked with the reason, same minute.
- Never leave a task `in_progress` you've actually stopped working on. Pause it or block it.
- Never mark a task `done` or an epic `complete` you haven't verified.
- At the start of a session, reconcile: if step 3 surfaced a status that doesn't match git reality,
  fix it before doing anything else.

## 9. Finishing and Closing

1. **Verify.** Tests green; run `/verify` (or exercise the change) to confirm it does what the spec
   said. Verification is the gate for everything below.
2. Open the PR: `gh pr create`.
3. `update_item(project_id, epic_id, 'epic', { sub_status: 'pr_open', pr_url: '<url>' })`, moves
   the board to in_review.
4. **If the human wants to review**, stop here and stay on the feature branch, feedback may come
   immediately. The human merges and the loop is theirs to close.
5. **If you have merge authority and the work is verified**, you may merge it yourself
   (`gh pr merge`). Having merged, close the ticket, don't leave a merged epic open:
   `update_item(project_id, epic_id, 'epic', { sub_status: 'complete' })` sets board status `done`.
   Add a closing note summarizing what shipped.
6. Mark the plan file: add `# COMPLETE - {date}` on the first line.

An unverified merge is never a close. If you can't verify, open the PR, set `pr_open`, and leave it
for the human.

## 10. How the roles split

Not a list of things you can't do, a description of who steers what:
- **You can run the full loop:** write or read specs, create epics/chores/bugs, break down tasks,
  build, verify, merge, and close.
- **The human stays in control by choosing when to step in:** they may write the spec themselves,
  and they may hold a PR for review instead of letting you merge. Honor those choices when they're
  made.
- **Verification is non-negotiable:** you never mark a task `done` or an epic `complete` without
  having verified the work. That's the line that keeps the board trustworthy.
