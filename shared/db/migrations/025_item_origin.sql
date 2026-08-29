-- Immutable creation provenance on items.
--
-- origin is { actor: Actor, discoveredFrom?: { itemId, itemKey } } (typed in
-- shared/db/src/types.ts). The actor records who/what created the item (human
-- user, or an AI agent session with client/device/session identity); the
-- optional discoveredFrom records the item being worked when this one was
-- filed. It is a snapshot, deliberately not an FK — provenance is a fact about
-- the past and survives deletion of the source item. NULL = predates tracking.
-- Immutability is enforced the same way as items.number: no update path ever
-- writes the column.
--
-- creator is dropped: accepted by the service since 018 but passed by no
-- caller, so it is NULL on every row. origin.actor replaces it.
--
-- ── ROLLING-DEPLOY NOTE ──────────────────────────────────────────────────────
-- Dropping creator breaks the previous release's createItem INSERT (it names
-- the column, binding NULL). Deploy this migration together with the new code;
-- item creates in the overlap window fail, reads are unaffected. Same posture
-- as 023.

ALTER TABLE items ADD COLUMN origin JSONB;
ALTER TABLE items DROP COLUMN creator;

COMMENT ON COLUMN items.origin IS 'Immutable creation provenance: { actor: Actor, discoveredFrom?: { itemId, itemKey } }. NULL = predates tracking.';
