-- The Map's last-visit baseline: one timestamp per account per project, what "since your
-- last visit" counts changes from (docs/specs/ai-development-overview.md, Since your last
-- visit).
--
-- last_visit_at is the moment the person's Map had read up to, not the moment they left:
-- the API hands out the read's time with the changes and the client sends it back when
-- the person leaves the Map or marks everything seen. It only moves forward (the upsert
-- keeps the later of the stored and the sent value, so two tabs can't move it back) and
-- never past the server's own clock.
--
-- This is per-user state for that person's own use, one row per (account, project),
-- overwritten in place. It keeps no history of visits and nothing reads it in aggregate:
-- it is not a usage measurement.
--
-- New table only, no backfill: a person with no row has no baseline, and their first visit
-- sets one without showing a changes view. Rolling-deploy safe: the previous release never
-- reads or writes it.

CREATE TABLE map_baselines (
	user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
	last_visit_at TIMESTAMPTZ NOT NULL,
	PRIMARY KEY (user_id, project_id)
);

-- The primary key serves the one read (a person's row for a project); this serves the
-- project deletion's cascade.
CREATE INDEX idx_map_baselines_project ON map_baselines(project_id);

COMMENT ON TABLE map_baselines IS 'Per-account last-visit baseline for the Map, one row per (user, project). Moves forward only. Not analytics: no history, never aggregated.';
COMMENT ON COLUMN map_baselines.last_visit_at IS 'The time the person''s Map had read up to, as the API stamped it on the read; never past the server clock when written.';
