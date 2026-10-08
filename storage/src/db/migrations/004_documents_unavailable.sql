-- A file on the branch that the editor can't hold: binary, or over the sync's size
-- limit. Its row stays, with no content behind it, so nobody reads an older copy and
-- nobody commits a draft over it (docs/specs/project-storage.md, Files the editor can't
-- hold). content_hash still changes whenever the file does.
ALTER TABLE project_documents ADD COLUMN IF NOT EXISTS unavailable_reason TEXT
	CHECK (unavailable_reason IN ('too_large', 'binary'));
