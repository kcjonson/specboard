-- A commit holds the project's sync lock while it writes to GitHub, storage, and the
-- sync point, so a pull can't interleave with it (docs/specs/project-storage.md,
-- Committing). The lock is sync_status; 'committing' is its new held state.
ALTER TABLE projects DROP CONSTRAINT projects_sync_status_check;
ALTER TABLE projects ADD CONSTRAINT projects_sync_status_check
	CHECK (sync_status IN ('pending', 'syncing', 'committing', 'completed', 'failed'));

COMMENT ON COLUMN projects.sync_status IS 'Sync lock and last outcome: pending, syncing, or committing while held; completed or failed after';
COMMENT ON COLUMN projects.sync_started_at IS 'When the current/last holder took the sync lock; a lock older than 20 minutes is stale and can be taken over';
