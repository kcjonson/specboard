-- status_source: who put an item's current status there.
--
--   explicit    a caller named the status: a board drag or the drawer's status
--               select (the REST PUT, when the value moves), MCP update_item
--               status, the start/complete/block/unblock routes, or a create.
--   rollup      the parent rollup moved it between ready and in_progress.
--   sub_status  a sub_status write derived it (scoping, in_development, and
--               pr_open derive in_progress; complete derives done).
--
-- The rollup demotes in_progress back to ready only when the source is rollup or
-- sub_status. An epic dragged to In Progress with no started children used to
-- carry sub_status not_started, which looked exactly like one the rollup had
-- promoted, so the next child write (creating its first ready task included)
-- dropped it back into Ready. The rule and the per-path classification are in
-- docs/specs/item-relationships.md.
--
-- Backfill: every existing row takes the default, 'explicit'. Nothing on record
-- says which in_progress parents the rollup promoted and which a person dragged,
-- and that ambiguity is the bug; 'explicit' is the reading under which no epic
-- changes columns on its own after deploy. The cost: parents the rollup did
-- promote stay in_progress when their children stop, until their status is next
-- written by hand or they pass back through ready.
--
-- Rolling-deploy safe: the constant default is stored in the catalog (no table
-- rewrite on Postgres 16), and the previous release neither reads nor writes the
-- column. Status writes the previous release makes during the rollout leave the
-- source as it was, so an item dragged in that window may still roll back once.

ALTER TABLE items ADD COLUMN status_source TEXT NOT NULL DEFAULT 'explicit'
	CONSTRAINT items_status_source_check CHECK (status_source IN ('explicit', 'rollup', 'sub_status'));

COMMENT ON COLUMN items.status_source IS 'Who set the current status: explicit (a caller named it), rollup (the parent rollup), or sub_status (derived from a sub_status write). The rollup only demotes in_progress it or a sub_status set.';
