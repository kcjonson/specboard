-- Drop the 'chore' work-item type. Existing chores become epics: they were
-- top-level work items (often containers with child tasks), so epic is their home.

UPDATE epics SET type = 'epic' WHERE type = 'chore';

ALTER TABLE epics DROP CONSTRAINT IF EXISTS epics_type_check;
ALTER TABLE epics ADD CONSTRAINT epics_type_check CHECK (type IN ('epic', 'bug'));
