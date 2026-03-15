-- Epic sub-status for detailed AI work state tracking
-- and branch tracking for multi-machine coordination
ALTER TABLE epics ADD COLUMN sub_status VARCHAR(20) NOT NULL DEFAULT 'not_started';
ALTER TABLE epics ADD COLUMN branch_name VARCHAR(255);
ALTER TABLE epics ADD COLUMN notes TEXT;
ALTER TABLE epics ADD CONSTRAINT epics_sub_status_check
  CHECK (sub_status IN ('not_started', 'scoping', 'in_development', 'paused', 'needs_input', 'pr_open', 'complete'));

-- Backfill sub_status for existing epics based on current board status
UPDATE epics SET sub_status = 'in_development' WHERE status = 'in_progress';
UPDATE epics SET sub_status = 'pr_open' WHERE status = 'in_review';
UPDATE epics SET sub_status = 'complete' WHERE status = 'done';

-- Task note field for context on outcome (completion, blocked, cut, descoped, etc.)
-- Replaces block_reason — status alone indicates blocked, note provides context
ALTER TABLE tasks ADD COLUMN note TEXT;
ALTER TABLE tasks DROP COLUMN block_reason;
