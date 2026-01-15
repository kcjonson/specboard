-- GitHub sync tracking: Add columns to track sync state for cloud mode projects
-- See /docs/specs/project-storage.md for details

-- Add sync tracking columns to projects table
ALTER TABLE projects
	ADD COLUMN last_synced_commit_sha TEXT DEFAULT NULL,
	ADD COLUMN sync_status TEXT DEFAULT NULL
		CHECK (sync_status IN ('pending', 'syncing', 'completed', 'failed')),
	ADD COLUMN sync_started_at TIMESTAMPTZ DEFAULT NULL,
	ADD COLUMN sync_completed_at TIMESTAMPTZ DEFAULT NULL,
	ADD COLUMN sync_error TEXT DEFAULT NULL;

COMMENT ON COLUMN projects.last_synced_commit_sha IS 'SHA of the last GitHub commit successfully synced (cloud mode only)';
COMMENT ON COLUMN projects.sync_status IS 'Current sync status: pending, syncing, completed, or failed';
COMMENT ON COLUMN projects.sync_started_at IS 'Timestamp when the current/last sync started';
COMMENT ON COLUMN projects.sync_completed_at IS 'Timestamp when the last sync completed (success or failure)';
COMMENT ON COLUMN projects.sync_error IS 'Error message if sync_status is failed';

-- Rollback instructions:
-- ALTER TABLE projects
--   DROP COLUMN IF EXISTS last_synced_commit_sha,
--   DROP COLUMN IF EXISTS sync_status,
--   DROP COLUMN IF EXISTS sync_started_at,
--   DROP COLUMN IF EXISTS sync_completed_at,
--   DROP COLUMN IF EXISTS sync_error;
