-- Ordered scratch todos on an item: items.checklist, a JSONB array of
-- {id, text, status} and nothing more, where status is 'todo' or 'done'. It is
-- a string rather than a boolean so further states can be added without
-- breaking every reader and writer of the column.
--
-- A checklist entry is not a child item. A child item is first-class work: it
-- has a key, a board status with a lifecycle behind it, blockers, an activity
-- log, its own provenance, and a row other items can reference. A checklist
-- entry has none of that -- no actor, no timestamps, no lifecycle; its status
-- is a label on a todo, not a state machine. That absence is the whole test.
-- item_notes and item_blockers earn their own tables precisely because they
-- carry actors, created_at, and cleared_at, the things a row is for; a
-- checklist carries none of them and is 1-per-item, so it is a column on the
-- same reasoning
-- items.origin is (see docs/specs/item-relationships.md, "The two shared
-- shapes"). If a step deserves to be tracked, it is a task, not an entry.
--
-- Array order IS display order, so there is no rank column and no sort key:
-- rewriting the array reorders the list. No index either -- the checklist is
-- read by item and never queried by its content, so a GIN index would only cost
-- writes.
--
-- The CHECK pins the shape to an array. Per-entry shape (keys, text length, the
-- status values, the 100-entry cap) is enforced in the service, which is also
-- where entry-level writes rewrite exactly one element so a concurrent edit of
-- another entry cannot be clobbered. Keeping the enum out of the CHECK is
-- deliberate: widening the set of states must not require a table-scanning
-- constraint revalidation.
--
-- Rolling-deploy safe: additive, constant-defaulted (Postgres 16 stores the
-- default in the catalog, so ADD COLUMN does not rewrite the table), and
-- unread by the previous release, which neither selects nor writes the column.

ALTER TABLE items ADD COLUMN checklist JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE items ADD CONSTRAINT items_checklist_is_array CHECK (jsonb_typeof(checklist) = 'array');

COMMENT ON COLUMN items.checklist IS 'Ordered scratch todos: [{id, text, status}], status one of todo/done (the service owns that set, so it can widen without a constraint change). Array order is display order. Distinct from child items, which are first-class tracked work.';
