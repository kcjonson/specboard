-- Polymorphic blockers: each row blocks item_id on another item (FK) XOR free text.
--
-- An item is blocked while it has any open (cleared_at IS NULL) blocker row, OR
-- while its status is 'blocked' — the status value remains a separate, manual
-- status-level hold and is never mutated by blocker rows. Item blockers are
-- cleared automatically (cleared_by = system actor) when the blocking item
-- reaches done; text blockers only clear when explicitly removed. Cleared rows
-- are tombstones, kept for history; re-opening a done blocking item does NOT
-- re-block dependents.
--
-- created_by / cleared_by hold an Actor JSONB (shared/db/src/types.ts): a
-- discriminated union of user / agent / system, captured server-side.
--
-- Same-project scoping of blocker_item_id is enforced in the service layer,
-- like items.parent_id.
--
-- Rolling-deploy safe: nothing here is read or written by the previous release.

CREATE TABLE item_blockers (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
	-- Denormalized so project-scoped queries and cascades stay single-table
	-- (same rationale as epic_specs.project_id).
	project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
	blocker_item_id UUID REFERENCES items(id) ON DELETE CASCADE,
	blocker_text TEXT,
	created_by JSONB,
	created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	cleared_at TIMESTAMPTZ,
	cleared_by JSONB,
	CONSTRAINT item_blockers_one_kind CHECK ((blocker_item_id IS NULL) <> (blocker_text IS NULL)),
	CONSTRAINT item_blockers_not_self CHECK (blocker_item_id IS NULL OR blocker_item_id <> item_id),
	CONSTRAINT item_blockers_text_nonempty CHECK (blocker_text IS NULL OR length(btrim(blocker_text)) > 0)
);

-- Open-blocker lookups dominate; partial indexes keep them tight.
CREATE INDEX idx_item_blockers_item ON item_blockers(item_id) WHERE cleared_at IS NULL;
CREATE INDEX idx_item_blockers_blocker ON item_blockers(blocker_item_id) WHERE cleared_at IS NULL;
-- No duplicate open item-blocker per item; duplicates may exist among tombstones.
CREATE UNIQUE INDEX idx_item_blockers_uniq_item ON item_blockers(item_id, blocker_item_id)
	WHERE cleared_at IS NULL AND blocker_item_id IS NOT NULL;
