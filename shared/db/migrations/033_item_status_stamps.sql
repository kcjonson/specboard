-- When an item started and finished, and a log of every status move.
--
-- items.started_at is the first time the item entered in_progress or in_review; a
-- reopen doesn't move it. items.completed_at is the most recent entry into done,
-- cleared when the item leaves done, so it is set exactly when the status is done.
-- Both belong to the status change, the way updated_at belongs to the
-- items_updated_at trigger: status is written by several statements in the item
-- service (creates, the general update, the lifecycle routes, the parent rollup),
-- and a trigger is the one place that sees all of them. An UPDATE can't write
-- either column; whatever the statement sets is replaced. An INSERT may carry
-- them, so a seed or a test can place history in the past, but completed_at
-- still only survives on a done row.
--
-- item_transitions is one append-only row per change of status or sub-status:
-- before and after of both, who did it, and when. The actor (an Actor JSONB,
-- shared/db/src/types.ts, captured server-side like items.origin) is something a
-- trigger can't see, so the item service writes the row, in the same transaction
-- as the status write. A create that names a status logs a row with no "before".
--
-- Times are clock_timestamp(), not NOW(): NOW() is when the transaction began, and
-- a write that began first can take the row lock second, so two moves of one item
-- (or two completions the Map has to put in order) could be stamped out of the
-- order they happened. The trigger fires with the row already locked, and the
-- service inserts the log row before it lets go, so both are taken in lock order.
--
-- No backfill. Items that changed status before this ran keep NULL times, and the
-- log starts empty; nothing here reconstructs history.
--
-- Rolling-deploy safe: the columns are nullable with no default (catalog only on
-- Postgres 16), and the previous release never reads or writes them or the new
-- table. Its status writes during the rollout fire the trigger, so their stamps
-- are right, but they write no transition rows: the log can miss a move made by
-- an old task in that window.

ALTER TABLE items
	ADD COLUMN started_at TIMESTAMPTZ,
	ADD COLUMN completed_at TIMESTAMPTZ;

COMMENT ON COLUMN items.started_at IS 'First entry into in_progress or in_review; never moved by a reopen. Set by the items_status_stamps trigger. NULL: never started, or last moved before migration 033.';
COMMENT ON COLUMN items.completed_at IS 'Most recent entry into done; NULL whenever the status is not done. Set by the items_status_stamps trigger. NULL on a done item: completed before migration 033.';

CREATE FUNCTION stamp_item_status()
RETURNS TRIGGER AS $$
BEGIN
	IF TG_OP = 'INSERT' THEN
		IF NEW.status IN ('in_progress', 'in_review') THEN
			NEW.started_at := COALESCE(NEW.started_at, clock_timestamp());
		END IF;
		NEW.completed_at := CASE WHEN NEW.status = 'done' THEN COALESCE(NEW.completed_at, clock_timestamp()) END;
		RETURN NEW;
	END IF;

	NEW.started_at := OLD.started_at;
	NEW.completed_at := OLD.completed_at;
	IF NEW.status IS DISTINCT FROM OLD.status THEN
		IF NEW.status IN ('in_progress', 'in_review') AND NEW.started_at IS NULL THEN
			NEW.started_at := clock_timestamp();
		END IF;
		NEW.completed_at := CASE WHEN NEW.status = 'done' THEN clock_timestamp() END;
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER items_status_stamps
	BEFORE INSERT OR UPDATE ON items
	FOR EACH ROW
	EXECUTE FUNCTION stamp_item_status();

CREATE TABLE item_transitions (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
	project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
	from_status VARCHAR(20),
	to_status VARCHAR(20) NOT NULL,
	from_sub_status VARCHAR(20),
	to_sub_status VARCHAR(20),
	actor JSONB NOT NULL,
	created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
	CONSTRAINT item_transitions_moved CHECK (
		(from_status, from_sub_status) IS DISTINCT FROM (to_status, to_sub_status)
	)
);

-- One item's history in order, and a project's moves since a moment (the Map's
-- time anchor and since-your-last-visit). Both also serve the FK cascades.
CREATE INDEX idx_item_transitions_item ON item_transitions(item_id, created_at);
CREATE INDEX idx_item_transitions_project ON item_transitions(project_id, created_at);

COMMENT ON TABLE item_transitions IS 'Append-only log of status and sub-status changes, one row per real change, written by the item service in the status write''s transaction. from_* NULL: a create that named a status. Starts empty at migration 033.';
COMMENT ON COLUMN item_transitions.actor IS 'Who moved it (Actor, shared/db/src/types.ts), captured server-side; the parent rollup is a system actor.';
