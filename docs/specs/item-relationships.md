# Item relationships and provenance

Blockers (blocked-by), creation origin, worker presence, the activity log, and
the checklist on planning items. Introduced by migrations 024-029; this records
the design and the reasoning so the shapes don't get reinvented.

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
   the MCP OAuth token, which also carries the protocol clientInfo recorded on it
   at initialize, plus the session correlation id the client echoes) and never accepted
   from a client payload. Request-path construction happens in exactly two
   places — the API's `requireProjectAccess`-gated handlers and the MCP server's
   per-call actor — plus the system actor the services stamp on auto-clears and
   the user actor the seed script writes. Browser-facing responses strip actor
   internals (user id, OAuth client id, MCP session id) down to what the UI
   renders: type, device name, client info.

No generic `item_links` table: origin is 1-per-item and immutable (a column, not
a row), and blockers carry lifecycle (`cleared_at`/`cleared_by`) that would be
meaningless for other relation kinds. The checklist (029) lands on the column
side of the same line: 1-per-item, no actor, no timestamps, nothing to clear.
If relation types multiply later, a generic table is a mechanical
`INSERT…SELECT` away.

## Blockers (`item_blockers`, migration 024)

One row per blocker; an item can hold any mix of item and text blockers.

- **Blocked is a hybrid**: an item is blocked when `status = 'blocked'` (a
  manual, status-level hold set by `blockItem`, which touches nothing but the
  status)
  **or** when any open blocker row exists. Blocker rows never mutate `status`,
  so there is nothing to keep in sync and nothing to restore on unblock. Every
  item response carries the derived `blocked` boolean.
- **Auto-clear is pure SQL**: when an item reaches `done` (via `completeItem` or
  `updateItem`, in the same transaction as the status write), every open blocker
  pointing at it is tombstoned with `cleared_by = { type: 'system', cause:
  'blocking_item_done' }`, and the item's **own** open rows are tombstoned with
  `cause: 'item_completed'` — done and blocked never coexist, matching the write
  rule that refuses to block a done item. Other blockers on a dependent are
  untouched; it stays blocked while any row is open.
- **Tombstones, not deletes**: clearing sets `cleared_at`/`cleared_by`. History
  ("was blocked by X, cleared when X completed; still blocked by Y") is
  queryable, and reopening a done blocking item does **not** re-block dependents
  — cleared is cleared; re-block explicitly. Deletion is the one operation that
  erases history: FK cascades remove rows, tombstones included, when either end
  or the project is deleted.
- **Edges**: blocking a done item is rejected; a done item can't be added as a
  blocker (it could never clear naturally); self-blocking is rejected; the
  partial unique indexes forbid duplicate *open* blockers of either kind; text
  is capped at 500 characters. Blocker writes run in transactions that lock the
  item rows they validated (`FOR SHARE`), so a concurrent completion can't slip
  between the not-done check and the insert. Every blocker mutation bumps the
  affected item's `updated_at` so polling boards pick up derived changes made by
  other sessions.
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
can't collide with the blocked item's URL param in client models; the MCP arg
stays `item_key`, matching every other MCP key field); MCP `blockers` array on
`create_item`/`update_item` — a full replace of open blockers applied on every
update path, status shortcuts and moves included (a completion ignores it with a
warning, since a done item can't be blocked, and a create that fails its
blockers still reports the created key with a warning rather than reading as a
failed create); `BlockersSection` in the item drawer/detail (typed input: a key
with this project's prefix links that item, anything else is text). On the
board, `status='blocked'` items get a Blocked column that appears while
non-empty (keyboard-traversable, not a drag target); row-blocked items stay in
their real column with a Blocked chip. The status-level hold requires a reason on
the MCP path only, since agents must explain themselves; a person clicking the
drawer's status select is not interrogated. On that path the reason is either a
`note` (which lands in the activity log below) or a non-empty `blockers` array,
since blocker rows already say what the item is waiting on.

## Origin (`items.origin`, migration 025)

`{ actor: Actor, discoveredFrom?: { itemId, itemKey } }`, set at creation,
immutable because no update path maps it (the same enforcement as
`items.number`). NULL means the item predates tracking.

- Actor and discovered-from **compose** rather than forming a 3-way union: work
  discovered while an agent worked SB-12 records both the agent actor and the
  SB-12 snapshot.
- `discoveredFrom` is a snapshot, not an FK: provenance is a fact about the
  past and survives deletion of the source item.
- The old `items.creator` column was dropped; rows that carried a value (seeded
  data, pre-unification epics) were backfilled into `origin` as user actors
  first, then `origin.actor` replaced it.
- MCP `create_item`/`create_items` take `discovered_from` (an item key; the
  batch shares one origin); the REST create takes `discoveredFromKey`. The
  actor half is always captured server-side.

## Workers (`item_workers`, migration 026)

Observed agent presence: one row per (item, agent session) episode, keyed by the
partial unique index on
`(item_id, (actor->>'userId'), (actor->>'clientId'), (COALESCE(actor->>'sessionId', ''))) WHERE ended_at IS NULL`.
The MCP transport is stateless (migration 028): the server mints a session id at
initialize as a correlation token, the client echoes it on every later request,
and the server holds no transport state for it and never rejects a request over
it (a malformed id is dropped from provenance, nothing more), so a deploy never
strands a connected client and an episode continues across one. Because the id
is client-echoed, and a registered OAuth client id can be shared by many users (a
claude.ai org connector registers once), the key includes the token-derived user
id and client id, so a forged id can only reach rows the same token already
owns. Two Claude Code windows on one machine are two sessions.

- **No heartbeat or claim call.** Episodes open as a side effect of real MCP
  writes: a write that leaves an item `in_progress` upserts the episode
  (bumping `last_seen_at`). Episodes END in the item service, so every surface
  behaves the same: any status transition out of `in_progress` — done, ready,
  in_review, or blocked, via MCP, the REST API, or a board drag — ends all
  active episodes on the item. A heartbeat requires agent cooperation and
  produces exactly the stale rows it is meant to prevent; deriving presence
  from observed writes makes staleness meaningful by construction.
- **Staleness is derived at read time** (`now() - last_seen_at`), never stored.
  The UI dims a worker after 15 minutes without an observed write.
- `assignee` is untouched and stays a human user FK. `items.branch_name`
  remains the item-level branch; `item_workers.branch` is the per-session
  snapshot (two sessions in two worktrees can work one item).

## Activity log (`item_notes`, migration 027)

One append-only log per item: `{ id, item_id, note, actor, created_at }`, newest
first everywhere it is read.

- **Three mechanisms collapsed into one.** `progress_notes` rows, the
  `items.notes` blob (append-only, entries joined by newline and prefixed
  `[YYYY-MM-DD]`), and `items.note` (a single overwritable outcome/block reason)
  all answered the same question (what happened on this item) with three
  shapes, three write paths, and three vocabularies. 027 renames the table to
  `item_notes`, splits the blob into one row per entry, folds the last `items.note`
  value in as a final entry, and drops both columns. The word "notes" is now
  unambiguous because the column it collided with is gone.
- **Append-only.** Entries are never edited or deleted; the log is the item's
  history, and there is no update or delete route. Only item or project deletion
  removes rows, by FK cascade.
- **Actor, not `created_by`.** The dropped `created_by` column held the literals
  `'claude'`/`'system'`, a weaker encoding of the Actor union 024-026 already
  standardized on. Actors are captured server-side (`apiActor` in the API
  handler, the per-call `AgentActor` in MCP) and never read from a request body.
  NULL means the entry predates actor capture, the same convention as
  `items.origin`; every row backfilled by 027 is NULL.
- **Status writes and log writes are separate.** `completeItem`/`blockItem` lost
  their `note` parameter; appending is one function, `addItemNote`, called after
  the transition. The note is therefore not in the same transaction as the status
  flip. Losing a log entry to a partial failure is acceptable; losing a status
  write is not.
- **Blocking needs a reason** on the MCP path: `status: 'blocked'` requires a
  `note` or a non-empty `blockers` array. `POST /items/:itemKey/block` requires
  neither, matching the blocker rule above.
- **Two read paths, deliberately.** Agents get entries inline on the item payload
  via MCP `include_notes`, so one call answers "what is the state of this work".
  The browser reads the sub-resource `GET/POST /items/:itemKey/notes` instead, so
  the item response stays small and the item model has no `notes` prop to PUT
  back. `handleGetItem` must not re-enable `includeNotes`.
- MCP `update_item` takes one `note` param with append semantics, applied on
  every write path (the status shortcuts and the reparent move included). Empty
  or whitespace-only text is nothing to say, not an error. There is no
  pagination; volume doesn't warrant it yet.
- **Validation lives in the service, once.** `addItemNote` trims the text and
  throws `NoteValidationError` when it is empty or over `MAX_NOTE_LENGTH`
  (10,000; an absurd-size guard, not an editorial limit, and entries are agent-written
  prose and the 027 backfill imports long ones). The API maps that to a 400 and
  MCP to a tool error. The API handler passes the text through untouched. The
  MCP handler drops a whitespace-only `note` as nothing to say (see above) and
  otherwise passes it through; it does not enforce the length or emptiness rules
  itself. Appending also bumps the item's `updated_at`, so polling boards and
  agents see that the item changed.
- **`notes` is present on an item response only when it was requested**
  (`include_notes`), like `blockers` and `workers`. An absent key means "not
  loaded"; `[]` would tell an agent the item has no history.
- **027 keeps `items_notes_backup_027`**, the raw `notes`/`note` text per item.
  The blob parse is irreversible and the columns drop in the same transaction;
  a later migration drops the backup once the log is verified in prod.

## Checklist (`items.checklist`, migration 029)

Ordered scratch todos on one item: a JSONB array of `{ id, text, status }`, and
nothing more.

- **A checklist entry is not a child item.** A child is first-class work: a key,
  a board status with a lifecycle behind it, blockers, an activity log,
  provenance, and a row other items can point at. An entry has none of that. A
  step you want tracked, assigned, or referenced is a task; a loose end inside
  one item is an entry.
- **`status`, not a boolean.** An entry's state is `'todo' | 'done'`, a string
  union so further states can be added without breaking every reader and writer
  of the column; the union stays narrow until one is actually needed. The set
  lives in the service (`CHECKLIST_STATUSES`), deliberately not in the CHECK
  constraint: widening it must not require a table-scanning revalidation. An
  entry's `status` is a label on a todo, not the item lifecycle, which is what
  `done` on a board item means.
- **Column, not a table**, on the test the section above states: `item_notes`
  and `item_blockers` earn rows because they carry actors, `created_at`, and
  `cleared_at`. A checklist entry has no actor, no timestamps, and no lifecycle,
  and there is exactly one checklist per item — the same reasoning that makes
  `items.origin` a column. `CHECK (jsonb_typeof(checklist) = 'array')` pins the
  shape; per-entry rules live in the service.
- **Array order is display order.** No rank column, no sort key: reordering is a
  rewrite of the array. There is no index either — the checklist is read by item
  and never queried by its content.
- **Entry-level writes don't clobber.** Add, update, and remove each rewrite
  only the element they matched, in a single statement, so a UI ticking entry A
  cannot lose a concurrent rename of entry B. Update and remove guard on
  `checklist @> [{"id": …}]`, which reads the OLD row (the entry must have
  existed) while `RETURNING` reports the NEW one; add enforces the cap inside its
  `WHERE` (`jsonb_array_length(checklist) < 100`) so it still holds when two
  appends race, and diagnoses its zero-row case as full-vs-missing afterwards.
  `setChecklist` is the deliberate full replace: it mints ids for entries lacking
  one and **preserves** supplied ids, so an MCP round-trip doesn't invalidate the
  ids a browser is holding.
- **Entries are addressed by id, never by array position.** Position is not
  stable: another agent editing the same list inserts, removes, or reorders
  entries, so a tick aimed at index 2 lands on whatever moved into index 2. That
  is the whole reason entries carry ids at all, and the reason `update_item`'s
  `checklist` array accepts `id` — an agent that means to keep an entry sends its
  id back rather than minting a new one.
- **No provenance, on purpose.** Nothing records who ticked a box or when.
  Ticking is not a fact about the past worth keeping; if it were, the step
  belonged in the activity log or as a child item.
- **Caps and per-entry shape**: 100 entries, 500 characters each, and a `status`
  inside the union, all enforced in the service, which throws
  `ChecklistValidationError` (400 from the API, a tool error from MCP). Text is
  trimmed and may not be empty; an absent `status` defaults to `todo`.
- **Completion does not clear it.** Unlike blockers, a `done` transition leaves
  the checklist alone — ticking a box is not a state the lifecycle owns.
- **Two read paths, like the activity log.** Agents get the checklist inline:
  always on a single-item `get_items item_key` read, and on lists behind
  `include_checklist`. The browser will read a sub-resource in a later PR, so the
  item response stays small and the item model has no `checklist` prop to PUT
  back — `handleGetItem` must **not** enable `includeChecklist`.
- **MCP: two writes, one tool.** `update_item` takes `checklist` (the full
  replace, for setting the list up) and `checklist_status` (`{ "<id>": "done" }`,
  for ticking entries off as the work happens). Both apply on every update path,
  the status shortcuts and the reparent move included; when a call carries both,
  the replace runs first and the patch lands on the list it produced. An id in
  `checklist_status` that no longer exists is a tool error naming it, not a
  silent no-op — an agent ticking a stale id has to find out. They are parameters
  on `update_item` rather than tools of their own because a tool schema is
  resident context on every request an agent makes; a new tool would be a
  permanent cost to serve one operation. `create_item` takes neither; a new item
  has nothing to check off yet.
- **Present only when requested**, like `notes`/`blockers`/`workers`. An absent
  key means "not loaded"; `[]` means the item genuinely has no todos.
