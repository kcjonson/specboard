-- Storage service initial schema
-- File metadata and pending changes tables

-- Document metadata (synced from GitHub)
CREATE TABLE IF NOT EXISTS project_documents (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	project_id UUID NOT NULL,
	path TEXT NOT NULL,
	s3_key TEXT NOT NULL,
	content_hash TEXT NOT NULL,
	size_bytes INTEGER NOT NULL,
	synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

	UNIQUE(project_id, path)
);

CREATE INDEX IF NOT EXISTS idx_project_documents_project ON project_documents(project_id);

-- Uncommitted user changes (durable)
CREATE TABLE IF NOT EXISTS pending_changes (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	project_id UUID NOT NULL,
	user_id UUID NOT NULL,
	path TEXT NOT NULL,
	content TEXT,
	s3_key TEXT,
	action TEXT NOT NULL CHECK (action IN ('modified', 'created', 'deleted')),
	created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

	UNIQUE(project_id, user_id, path)
);

CREATE INDEX IF NOT EXISTS idx_pending_changes_project_user ON pending_changes(project_id, user_id);
