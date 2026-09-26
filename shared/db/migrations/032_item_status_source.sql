-- status_source: who put an item's current status there.
--
--   explicit    a caller named the status: a board drag or the drawer's status
--               select (the REST PUT, when the value moves), MCP update_item
--               status, the start/complete/block routes, unblock of an item
--               that wasn't blocked, or a create that names a status.
--   rollup      the parent rollup moved it between ready and in_progress.
--   sub_status  a sub_status write derived it (scoping, in_development, and
--               pr_open derive in_progress; complete derives done).
--   default     nobody chose it: a create that names no status (MCP create_item,
--               create_items, and the web form left on Ready), or the Ready an
--               unblock restores.
--
-- "Dragged epics should stay put", in both directions. The rollup promotes a
-- ready item unless its source is explicit, and demotes an in_progress one only
-- when its source is rollup or sub_status. An epic dragged to In Progress with no
-- started children used to carry sub_status not_started, which looked exactly
-- like one the rollup had promoted, so the next child write (creating its first
-- ready task included) dropped it back into Ready; an epic dragged to Ready went
-- straight back to In Progress on the next child start. The rule and the
-- per-path classification are in docs/specs/item-relationships.md.
--
-- Backfill: nothing on record says who put any existing status there, so each
-- status takes the reading under which nothing changes behavior at deploy.
--   ready        default: promotable, as every Ready was before this column.
--   in_progress  explicit: never demoted, as decided when the column was added.
--                The cost: parents the rollup did promote stay in_progress when
--                their children stop, until their status is next written by hand
--                or they pass back through ready.
--   blocked, in_review, done: default. The rollup never touches these, and
--                every current write that moves an item out of them records a
--                fresh source, so the value only matters for a status the
--                previous release moves during the rollout; default keeps those
--                behaving as that release expects (a Ready it restores stays
--                promotable, an in_progress it sets is not demoted).
--
-- Rolling-deploy safe: the constant default is stored in the catalog (no table
-- rewrite on Postgres 16), the backfill touches only in_progress rows, and the
-- previous release neither reads nor writes the column. Its creates take the
-- default, which matches how it treats them. Status writes it makes during the
-- rollout leave the source as it was, so an item dragged in that window may
-- still move once.

ALTER TABLE items ADD COLUMN status_source TEXT NOT NULL DEFAULT 'default'
	CONSTRAINT items_status_source_check CHECK (status_source IN ('explicit', 'rollup', 'sub_status', 'default'));

UPDATE items SET status_source = 'explicit' WHERE status = 'in_progress';

COMMENT ON COLUMN items.status_source IS 'Who set the current status: explicit (a caller named it), rollup (the parent rollup), sub_status (derived from a sub_status write), or default (nobody chose it: a create without a status, or the Ready an unblock restores). The rollup never promotes an explicit ready, and only demotes an in_progress that it or a sub_status set.';
