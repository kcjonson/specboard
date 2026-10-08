-- The committed path a pending change was renamed from. A rename is journaled as a
-- deletion of the old path and a change at the new one; this column is what lets a
-- commit tell that pair apart from an unrelated delete and create.
ALTER TABLE pending_changes ADD COLUMN IF NOT EXISTS renamed_from TEXT;
