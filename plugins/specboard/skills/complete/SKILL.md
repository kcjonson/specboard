---
name: complete
description: Specboard close-out. Use when finishing a work item: verify it, get the PR(s) merged, then mark the epic complete on the board and tear the session down. The close-out bookend to /specboard:whats-next.
allowed-tools: Bash(git status:*), Bash(git diff:*), Bash(git log:*), Bash(git branch:*), Bash(git rev-parse:*), Bash(git push:*), Bash(git merge:*), Bash(gh pr list:*), Bash(gh pr view:*), Bash(gh pr checks:*), Bash(gh pr merge:*), Bash(kill:*), Bash(pkill:*), Bash(jobs:*), Glob, Grep, Read, mcp__specboard__list_projects, mcp__specboard__get_items, mcp__specboard__update_item, mcp__specboard__create_item
---

# Specboard Complete

The close-out bookend to `/specboard:whats-next`. That skill picks work up and runs it; this one
verifies it, gets it merged, closes the board, and tears the session down. Two hard rules govern
everything here: **verify before you merge, and merge before you close.** An unverified merge is
never a close, and an open PR is never a closed ticket.

## 1. Find the items and the PR(s)

- `list_projects`, then `get_items(project_id, { item_id: epic_id, include_tasks: true })` to load
  the epic(s) you're closing and their tasks.
- Find every PR for this work, there may be more than one: `gh pr list --head <branch>`, plus any
  `pr_url` recorded on the epic, plus PRs that reference it. A feature can span several PRs, and you
  close the ticket only once all of them are accounted for.

## 2. Working directory must be clean

`git status --porcelain` should come back empty. Stray changes mean the work isn't fully captured:
either they belong to this work (commit and push them onto the PR) or they're cruft (remove them).
Don't close anything on top of a dirty tree.

## 3. Docs and status

Check whether anything in the repo needs to catch up to the finished work: a changelog, a status or
progress doc, a README, a spec whose "status" line is now stale. Update what's out of date and let
it ride the PR. Don't leave the written record describing a half-done version of the work.

## 4. Verify (the gate to merge)

Tests green; run `/verify` or exercise the change to confirm it does what the spec intended. If you
can't verify it, stop: leave the PR open, set `sub_status: 'pr_open'`, and hand it to the human.
Verification is the precondition for merging.

## 5. Merge (the gate to close)

Every relevant PR must be merged before any Specboard item changes status. This is firm:
- **If the human wants to review**, wait. Don't close anything; the merge is theirs. You can note on
  the epic that it's verified and ready to close once merged.
- **If you have merge authority and the work is verified**, merge each PR (`gh pr merge`), with CI
  green per `gh pr checks`.
- Only once the PR(s) are actually merged do you move to step 6. An open or draft PR means the
  ticket stays open, no exceptions.

## 6. Close the board

With the PR(s) merged:
- `update_item(project_id, epic_id, 'epic', { sub_status: 'complete' })` sets the board to `done`.
- Add a closing note summarizing what shipped:
  `update_item(project_id, epic_id, 'epic', { notes: '<what shipped>' })`.
- Every task `done`; nothing left `in_progress`.
- If you kept a plan file, mark it complete (`# COMPLETE - {date}` on the first line), wherever it
  lives.

## 7. Tear down the session

Close-out includes cleaning up after yourself. Stop anything this session started and left running:
- background shells and long-running commands (dev servers, watchers, tunnels, `npm`/docker
  processes),
- sub-agents or background tasks you spawned,
- temporary processes, bound ports, or scratch files you no longer need.

Leave the machine as you found it: no orphaned processes, no half-open shells.

## Role

You can close the loop, but only behind both gates: verified, then merged. The human stays in
control by choosing when to review a PR instead of letting you merge; honor that, and never move a
Specboard item to `done` while its PR is unmerged.
