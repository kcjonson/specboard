-- Observed agent presence on items: one row per (item, agent session) episode.
--
-- Rows are written as a side effect of real MCP writes while an item is
-- in_progress (no heartbeat or claim call): first write inserts, later writes
-- from the same session bump last_seen_at, and moving the item out of
-- in_progress (or completing it) sets ended_at. Staleness is derived from
-- last_seen_at at read time and never stored. actor is an AgentActor JSONB
-- (shared/db/src/types.ts) and always carries sessionId for rows in this table.
--
-- items.branch_name remains the item-level branch; branch here is the
-- per-session snapshot (two sessions in two worktrees can work one item).
--
-- Rolling-deploy safe: nothing here is read or written by the previous release.

CREATE TABLE item_workers (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
	project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
	actor JSONB NOT NULL,
	branch TEXT,
	started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	ended_at TIMESTAMPTZ
);

-- One active episode per session per item; the expression keeps sessionId
-- single-sourced inside actor rather than duplicated as a column.
CREATE UNIQUE INDEX idx_item_workers_active ON item_workers(item_id, (actor->>'sessionId'))
	WHERE ended_at IS NULL;
CREATE INDEX idx_item_workers_item ON item_workers(item_id);
-- FK-cascade path for project deletion.
CREATE INDEX idx_item_workers_project ON item_workers(project_id);
