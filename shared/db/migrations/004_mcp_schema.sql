-- MCP schema additions for Claude workflow support

-- Add in_review status to epics, spec_doc_path for linked specs, pr_url for review phase
ALTER TABLE epics
    DROP CONSTRAINT IF EXISTS epics_status_check,
    ADD CONSTRAINT epics_status_check CHECK (status IN ('ready', 'in_progress', 'in_review', 'done'));

ALTER TABLE epics
    ADD COLUMN IF NOT EXISTS spec_doc_path TEXT,
    ADD COLUMN IF NOT EXISTS pr_url TEXT;

-- Add blocked status to tasks, details field, block_reason
ALTER TABLE tasks
    DROP CONSTRAINT IF EXISTS tasks_status_check,
    ADD CONSTRAINT tasks_status_check CHECK (status IN ('ready', 'in_progress', 'blocked', 'done'));

ALTER TABLE tasks
    ADD COLUMN IF NOT EXISTS details TEXT,
    ADD COLUMN IF NOT EXISTS block_reason TEXT;

-- Progress notes table for timestamped activity log
CREATE TABLE IF NOT EXISTS progress_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    epic_id UUID REFERENCES epics(id) ON DELETE CASCADE,
    task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
    note TEXT NOT NULL,
    created_by TEXT NOT NULL DEFAULT 'claude',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Must reference either epic or task
    CONSTRAINT progress_notes_parent_check CHECK (
        (epic_id IS NOT NULL AND task_id IS NULL) OR
        (epic_id IS NULL AND task_id IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_progress_notes_epic_id ON progress_notes(epic_id);
CREATE INDEX IF NOT EXISTS idx_progress_notes_task_id ON progress_notes(task_id);
CREATE INDEX IF NOT EXISTS idx_progress_notes_created_at ON progress_notes(created_at DESC);

-- Index for finding epics by spec path
CREATE INDEX IF NOT EXISTS idx_epics_spec_doc_path ON epics(spec_doc_path);
