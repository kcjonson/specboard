-- Unify epics + tasks into one self-referential items table.
--
-- Epics become top-level items (parent_id NULL). Tasks become child items
-- (parent_id = old epic_id, type 'task', project_id inherited from the parent).
-- Bugs and tasks can now be nested under an item or stand alone. epic_specs and
-- progress_notes re-point to a single item_id. Ids are preserved through the swap
-- so existing references stay valid.

-- Generic updated_at trigger function for items.
CREATE OR REPLACE FUNCTION update_item_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE items (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id  UUID REFERENCES projects(id) ON DELETE CASCADE,
    parent_id   UUID REFERENCES items(id) ON DELETE CASCADE,
    type        VARCHAR(10) NOT NULL DEFAULT 'epic' CHECK (type IN ('epic', 'task', 'bug')),
    title       VARCHAR(255) NOT NULL,
    description TEXT,
    status      VARCHAR(20) NOT NULL DEFAULT 'ready'
                CHECK (status IN ('ready', 'in_progress', 'blocked', 'in_review', 'done')),
    sub_status  VARCHAR(20)
                CHECK (sub_status IN ('not_started', 'scoping', 'in_development', 'paused', 'needs_input', 'pr_open', 'complete')),
    creator     UUID REFERENCES users(id) ON DELETE SET NULL,
    assignee    UUID REFERENCES users(id) ON DELETE SET NULL,
    rank        DOUBLE PRECISION NOT NULL DEFAULT 0,
    due_date    DATE,
    pr_url      TEXT,
    branch_name VARCHAR(255),
    notes       TEXT,
    note        TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_items_project_id ON items(project_id);
CREATE INDEX idx_items_parent_id ON items(parent_id);
CREATE INDEX idx_items_status ON items(status);
CREATE INDEX idx_items_rank ON items(rank);
CREATE INDEX idx_items_type ON items(type);
CREATE INDEX idx_items_project_type ON items(project_id, type);

CREATE TRIGGER items_updated_at
    BEFORE UPDATE ON items
    FOR EACH ROW
    EXECUTE FUNCTION update_item_timestamp();

-- Epics -> top-level items.
INSERT INTO items (id, project_id, parent_id, type, title, description, status, sub_status, creator, assignee, rank, pr_url, branch_name, notes, created_at, updated_at)
SELECT id, project_id, NULL, type, title, description, status, sub_status, creator, assignee, rank, pr_url, branch_name, notes, created_at, updated_at
FROM epics;

-- Tasks -> child items (project_id inherited from the parent epic; details -> description).
INSERT INTO items (id, project_id, parent_id, type, title, description, status, assignee, rank, due_date, note, created_at, updated_at)
SELECT t.id, e.project_id, t.epic_id, 'task', t.title, t.details, t.status, t.assignee, t.rank, t.due_date, t.note, t.created_at, t.updated_at
FROM tasks t
JOIN epics e ON t.epic_id = e.id;

-- Re-point epic_specs.epic_id -> item_id.
ALTER TABLE epic_specs DROP CONSTRAINT epic_specs_epic_id_fkey;
ALTER TABLE epic_specs RENAME COLUMN epic_id TO item_id;
ALTER TABLE epic_specs ADD CONSTRAINT epic_specs_item_id_fkey FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE;

-- Collapse progress_notes (epic_id XOR task_id) into a single item_id.
ALTER TABLE progress_notes ADD COLUMN item_id UUID;
UPDATE progress_notes SET item_id = COALESCE(epic_id, task_id);
ALTER TABLE progress_notes DROP CONSTRAINT progress_notes_parent_check;
ALTER TABLE progress_notes DROP COLUMN epic_id;
ALTER TABLE progress_notes DROP COLUMN task_id;
ALTER TABLE progress_notes ALTER COLUMN item_id SET NOT NULL;
ALTER TABLE progress_notes ADD CONSTRAINT progress_notes_item_id_fkey FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE;
CREATE INDEX idx_progress_notes_item_id ON progress_notes(item_id);

-- Drop the old tables and their now-unused trigger functions.
DROP TABLE tasks;
DROP TABLE epics;
DROP FUNCTION IF EXISTS update_epic_timestamp();
DROP FUNCTION IF EXISTS update_task_timestamp();
