-- Planning schema for epics and tasks

-- Epics table
CREATE TABLE epics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(255) NOT NULL,
    description TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'ready' CHECK (status IN ('ready', 'in_progress', 'done')),
    creator UUID REFERENCES users(id) ON DELETE SET NULL,
    assignee UUID REFERENCES users(id) ON DELETE SET NULL,
    rank DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ DEFAULT NOW()
);

-- Tasks table
CREATE TABLE tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "epicId" UUID NOT NULL REFERENCES epics(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'ready' CHECK (status IN ('ready', 'in_progress', 'done')),
    assignee UUID REFERENCES users(id) ON DELETE SET NULL,
    "dueDate" DATE,
    rank DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX idx_epics_status ON epics(status);
CREATE INDEX idx_epics_rank ON epics(rank);
CREATE INDEX idx_epics_creator ON epics(creator);
CREATE INDEX idx_epics_assignee ON epics(assignee);
CREATE INDEX "idx_tasks_epicId" ON tasks("epicId");
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_rank ON tasks(rank);
CREATE INDEX idx_tasks_assignee ON tasks(assignee);

-- Trigger to update updatedAt on epics
CREATE OR REPLACE FUNCTION update_epic_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW."updatedAt" = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER epics_updated_at
    BEFORE UPDATE ON epics
    FOR EACH ROW
    EXECUTE FUNCTION update_epic_timestamp();

-- Trigger to update updatedAt on tasks
CREATE OR REPLACE FUNCTION update_task_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW."updatedAt" = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tasks_updated_at
    BEFORE UPDATE ON tasks
    FOR EACH ROW
    EXECUTE FUNCTION update_task_timestamp();
