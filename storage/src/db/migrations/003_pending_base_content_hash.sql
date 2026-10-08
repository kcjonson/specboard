-- What a draft was made against, and what it holds, so a commit can refuse a draft that
-- would replace someone else's change (docs/specs/project-storage.md, Draft conflicts).
--
-- base_content_hash: the committed file's content_hash the draft's content was loaded
-- from (the editor sends it with the first save; a write that doesn't falls back to
-- what's committed at the path then). NULL means nothing was committed there.
-- content_hash: the draft's own content hash (sha1, as project_documents), NULL for a
-- deletion. A draft whose content matches what's committed now isn't a conflict.
ALTER TABLE pending_changes ADD COLUMN IF NOT EXISTS base_content_hash TEXT;
ALTER TABLE pending_changes ADD COLUMN IF NOT EXISTS content_hash TEXT;

-- Drafts from before these columns: what they were made against was never recorded, so
-- they get today's committed hash and count as current. One that edits or deletes a
-- file nothing is committed at any more did lose its file, so it gets a base no file
-- can have and shows as a conflict.
UPDATE pending_changes p
SET base_content_hash = d.content_hash
FROM project_documents d
WHERE d.project_id = p.project_id AND d.path = p.path AND p.base_content_hash IS NULL;

UPDATE pending_changes p
SET base_content_hash = 'missing-before-migration'
WHERE p.base_content_hash IS NULL AND p.action IN ('modified', 'deleted')
  AND NOT EXISTS (SELECT 1 FROM project_documents d WHERE d.project_id = p.project_id AND d.path = p.path);
