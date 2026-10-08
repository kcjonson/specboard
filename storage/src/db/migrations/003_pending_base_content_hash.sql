-- The committed file a draft was made against: project_documents.content_hash at the
-- draft's own path when the draft row was first written, NULL when nothing was
-- committed there. A commit refuses drafts whose base no longer matches what's
-- committed (docs/specs/project-storage.md, Draft conflicts).
ALTER TABLE pending_changes ADD COLUMN IF NOT EXISTS base_content_hash TEXT;

-- Drafts from before this column get today's committed hash as their base. What they
-- were really made against isn't recorded anywhere, so they can't be checked; this
-- treats them as current rather than flagging every one of them.
UPDATE pending_changes p
SET base_content_hash = d.content_hash
FROM project_documents d
WHERE d.project_id = p.project_id AND d.path = p.path AND p.base_content_hash IS NULL;
