# Item relationships and provenance

Blockers (blocked-by), creation origin, and worker presence on planning items.
Introduced by migrations 024-026; this records the design and the reasoning so
the shapes don't get reinvented.

## The two shared shapes

Decided once, used everywhere:

1. **Polymorphic reference**: a nullable `<role>_item_id UUID` real FK plus a
   sibling non-item column, with a CHECK that exactly one is set. `item_blockers`
   uses both arms (`blocker_item_id` XOR `blocker_text`).
2. **Actor**: a JSONB discriminated union (`shared/db/src/types.ts`) of
   `UserActor { type: 'user', userId }`,
   `AgentActor { type: 'agent', userId, clientId, deviceName?, sessionId?, client? }`, and
   `SystemActor { type: 'system', cause }`. Actors are **event records**: JSONB
   snapshots rather than FKs, so provenance survives token revocation and item
   deletion, and new agent fields are additive keys with no migration. Actors are
   always constructed server-side from the authenticated context (API session, or
   MCP OAuth token + transport session + protocol clientInfo) and never accepted
   from a client payload. There are exactly two constructor sites: the API's
   `requireProjectAccess`-gated handlers, and the MCP server's per-call actor.

No generic `item_links` table: origin is 1-per-item and immutable (a column, not
a row), and blockers carry lifecycle (`cleared_at`/`cleared_by`) that would be
meaningless for other relation kinds. If relation types multiply later, a
generic table is a mechanical `INSERT…SELECT` away.

## Blockers (`item_blockers`, migration 024)

One row per blocker; an item can hold any mix of item and text blockers.

- **Blocked is a hybrid**: an item is blocked when `status = 'blocked'` (a
  manual, status-level hold — the pre-existing `blockItem`/note flow, unchanged)
  **or** when any open blocker row exists. Blocker rows never mutate `status`,
  so there is nothing to keep in sync and nothing to restore on unblock. Every
  item response carries the derived `blocked` boolean.
- **Auto-clear is pure SQL**: when an item reaches `done` (via `completeItem` or
  `updateItem`, in the same transaction as the status write), every open blocker
  pointing at it is tombstoned with `cleared_by = { type: 'system', cause:
  'blocking_item_done' }`. Other blockers on the dependent are untouched; it
  stays blocked while any row is open.
- **Tombstones, not deletes**: clearing sets `cleared_at`/`cleared_by`. History
  ("was blocked by X, cleared when X completed; still blocked by Y") is
  queryable, and reopening a done blocking item does **not** re-block dependents
  — cleared is cleared; re-block explicitly.
- **Edges**: blocking a done item is rejected; a done item can't be added as a
  blocker (it could never clear naturally); self-blocking is rejected; the
  partial unique index forbids duplicate *open* item-blockers only.
- **Ready means startable**: `getItems({ excludeBlocked: true })` backs the
  current-work ready list and MCP `get_items status=ready` (override with
  `include_blocked`). Text blockers represent a human hold and clear only when
  explicitly removed.
- **Never inferred**: agents record blockers only when the user or the work
  explicitly established the dependency (the tool descriptions say so).
  Automated suggestion is a separate, deferred concern.

Surfaces: REST sub-resource `GET/POST /items/:itemKey/blockers`,
`DELETE /items/:itemKey/blockers/:id` (wire fields for the blocking item are
`blockerKey`/`blockerTitle`/`blockerStatus`, deliberately not `itemKey`, so they
can't collide with the blocked item's URL param in client models); MCP
`blockers` array on `create_item`/`update_item` (full replace of open blockers,
the same contract as `specs`); `BlockersSection` in the item drawer/detail (typed
input: an item key links, anything else is text). On the board, `status='blocked'`
items get a display-only Blocked column (not a drag target); row-blocked items
stay in their real column with a Blocked chip.

## Origin (`items.origin`, migration 025)

`{ actor: Actor, discoveredFrom?: { itemId, itemKey } }`, set at creation,
immutable because no update path maps it (the same enforcement as
`items.number`). NULL means the item predates tracking.

- Actor and discovered-from **compose** rather than forming a 3-way union: work
  discovered while an agent worked SB-12 records both the agent actor and the
  SB-12 snapshot.
- `discoveredFrom` is a snapshot, not an FK: provenance is a fact about the
  past and survives deletion of the source item.
- The old `items.creator` column (never populated by any caller) was dropped;
  `origin.actor` replaces it.
- MCP `create_item`/`create_items` take `discovered_from` (an item key; the
  batch shares one origin); the REST create takes `discoveredFromKey`. The
  actor half is always captured server-side.

## Workers (`item_workers`, migration 026)

Observed agent presence: one row per (item, agent session) episode, keyed by the
partial unique index on `(item_id, (actor->>'sessionId')) WHERE ended_at IS NULL`.

- **No heartbeat or claim call.** Rows are a side effect of real MCP writes:
  a write that leaves an item `in_progress` upserts the episode (bumping
  `last_seen_at`); a write that moves it to `ready`/`in_review` ends that
  session's episode; `done` ends every session's episode. A heartbeat requires
  agent cooperation and produces exactly the stale rows it is meant to prevent;
  deriving presence from observed writes makes staleness meaningful by
  construction.
- **Staleness is derived at read time** (`now() - last_seen_at`), never stored.
  The UI dims a worker after 15 minutes without an observed write.
- `assignee` is untouched and stays a human user FK. `items.branch_name`
  remains the item-level branch; `item_workers.branch` is the per-session
  snapshot (two sessions in two worktrees can work one item).
