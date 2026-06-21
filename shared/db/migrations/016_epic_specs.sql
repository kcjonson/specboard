-- Multiple typed spec links per work item, replacing the single epics.spec_doc_path.
-- Each link is a markdown file path in the project's docs plus a type (product/technical).

CREATE TABLE epic_specs (
	id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	epic_id    UUID NOT NULL REFERENCES epics(id)    ON DELETE CASCADE,
	project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
	path       TEXT NOT NULL,
	spec_type  TEXT NOT NULL CHECK (spec_type IN ('product', 'technical')),
	created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	UNIQUE (epic_id, path)
);

-- epic_id for an epic's spec list; (project_id, path) for the editor's reverse lookup
-- and the file rename/delete cascade (project_id is denormalized so these stay single-table).
CREATE INDEX idx_epic_specs_epic_id ON epic_specs(epic_id);
CREATE INDEX idx_epic_specs_project_path ON epic_specs(project_id, path);

-- Migrate existing single spec links as 'product'.
INSERT INTO epic_specs (epic_id, project_id, path, spec_type)
SELECT id, project_id, spec_doc_path, 'product'
FROM epics
WHERE spec_doc_path IS NOT NULL AND spec_doc_path <> '' AND project_id IS NOT NULL;

DROP INDEX IF EXISTS idx_epics_spec_doc_path;
ALTER TABLE epics DROP COLUMN spec_doc_path;
