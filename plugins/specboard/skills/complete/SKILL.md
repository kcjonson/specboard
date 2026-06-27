---
name: complete
description: Specboard close-out. Use when finishing a work item: verify it, open or finalize the PR, and (when verified) merge and mark the epic complete on the board. The close-out bookend to /specboard:whats-next.
allowed-tools: Bash(git status:*), Bash(git branch:*), Bash(git log:*), Bash(git rev-parse:*), Bash(git push:*), Bash(git merge:*), Bash(gh pr view:*), Bash(gh pr create:*), Bash(gh pr checks:*), Bash(gh pr merge:*), Glob, Grep, Read, mcp__specboard__list_projects, mcp__specboard__get_items, mcp__specboard__update_item, mcp__specboard__create_item
---

# Specboard Complete

The close-out bookend to `/specboard:whats-next`. That skill picks work up and runs it; this one
closes it out. One rule governs everything here: **verify before you close anything. An unverified
merge is never a close.**

## 1. Confirm what you're closing

- `list_projects` to resolve the project (a bound repo auto-selects one).
- `get_items(project_id, { item_id: epic_id, include_tasks: true })` to load the epic and its tasks.
- Confirm every task is `done` or accounted for. If some are still open, either finish them or decide
  explicitly that they're out of scope for this close-out, and say which in the closing note.

## 2. Verify (the gate)

Tests green; run `/verify` or exercise the change to confirm it does what the spec intended. Nothing
below happens until the work is verified. If you can't verify it, stop here: open the PR, set
`sub_status: 'pr_open'`, and leave it for the human.

## 3. Open or finalize the PR

- No PR yet: `gh pr create`, then
  `update_item(project_id, epic_id, 'epic', { sub_status: 'pr_open', pr_url: '<url>' })`, which moves
  the board to `in_review`.
- PR already open with feedback: address it (or run `/pr-feedback`), push, and confirm CI is green
  (`gh pr checks`).

## 4. Merge and close

- **If the human wants to review**, stop. Leave the PR for them; the merge and the close are theirs.
- **If you have merge authority and the work is verified**, merge it (`gh pr merge`). Having merged,
  close the ticket, don't leave a merged epic open:
  `update_item(project_id, epic_id, 'epic', { sub_status: 'complete' })` sets the board to `done`.
  Then add a closing note summarizing what shipped:
  `update_item(project_id, epic_id, 'epic', { notes: '<what shipped>' })`.

## 5. Tidy up

- Every task `done`, the epic `complete`, a closing note on the record.
- If you kept a plan file for this work, mark it complete (add `# COMPLETE - {date}` on the first
  line), wherever it lives.
- Don't leave a merged epic sitting in `in_review`, or a task stuck `in_progress`.

## Role

You can close the loop, but only behind verification. The human stays in control by choosing when to
review a PR instead of letting you merge; honor that. You never mark a task `done` or an epic
`complete` you haven't verified. That's the line that keeps the board trustworthy.
