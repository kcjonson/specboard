-- Collapse three overlapping "notes on an item" mechanisms into ONE append-only
-- activity log: rows in item_notes (renamed from progress_notes), each carrying
-- an Actor JSONB captured server-side.
--
-- items.notes was an append-only blob of "[YYYY-MM-DD] text" entries joined by
-- newlines; entry text may itself contain newlines, so a line NOT starting with
-- that prefix continues the previous entry. It splits into one row per entry.
-- items.note was a single overwritable value (completion outcome / block reason);
-- its block-reason job was superseded by item_blockers.blocker_text in 024, so
-- what remains folds in as one final entry.
--
-- actor is NULL on every backfilled row: these entries predate actor capture,
-- the same convention as items.origin (025). created_by is dropped rather than
-- migrated -- it held the literals 'claude'/'system', a strictly weaker encoding
-- of the same fact.
--
-- ROLLING-DEPLOY NOTE: deploy this migration together with the new code. It
-- breaks the previous release during any overlap window: getItems' include_notes
-- reads FROM progress_notes, updateItem writes items.notes/items.note, and
-- completeItem/blockItem write items.note. Same posture as 023 and 025.

ALTER TABLE progress_notes RENAME TO item_notes;

-- RENAME CONSTRAINT has no IF EXISTS form, and a pkey created under a different
-- name (an environment restored from a dump, say) would abort the transaction.
DO $$
BEGIN
	IF EXISTS (
		SELECT 1 FROM pg_constraint
		WHERE conname = 'progress_notes_pkey' AND conrelid = 'item_notes'::regclass
	) THEN
		ALTER TABLE item_notes RENAME CONSTRAINT progress_notes_pkey TO item_notes_pkey;
	END IF;
END $$;

ALTER TABLE item_notes RENAME CONSTRAINT progress_notes_item_id_fkey TO item_notes_item_id_fkey;

ALTER TABLE item_notes ADD COLUMN actor JSONB;
ALTER TABLE item_notes DROP COLUMN created_by;

DROP INDEX IF EXISTS idx_progress_notes_item_id;
DROP INDEX IF EXISTS idx_progress_notes_created_at;
CREATE INDEX idx_item_notes_item_created ON item_notes(item_id, created_at DESC);

COMMENT ON COLUMN item_notes.actor IS 'Who wrote the entry (Actor, shared/db/src/types.ts), captured server-side. NULL = predates tracking.';

-- Backfill 1: items.notes blob -> one row per entry.
-- chr(1) is inserted immediately before each "[date] " that starts a line (the
-- captured newline stays with the PREVIOUS chunk), then the blob is split on it.
-- Ordinality doubles as the intra-item ordering offset.
INSERT INTO item_notes (item_id, note, actor, created_at)
SELECT
	i.id,
	-- Only a prefix that actually parsed is stripped, so an impossible date stays
	-- visible in the entry text instead of vanishing.
	CASE WHEN d.entry_date IS NULL
		THEN btrim(e.chunk, E' \r\n\t')
		ELSE btrim(regexp_replace(e.chunk, E'^\\[\\d{4}-\\d{2}-\\d{2}\\] ', ''), E' \r\n\t')
	END,
	NULL,
	COALESCE(d.entry_date::timestamp AT TIME ZONE 'UTC', i.created_at)
		+ (e.ord * interval '1 second')
FROM items i
CROSS JOIN LATERAL regexp_split_to_table(
	regexp_replace(
		-- chr(1) is the split sentinel, so it can't survive in the source text. It
		-- becomes a space, not nothing: a control byte in real text is unexpected
		-- enough that it should show as a gap rather than silently join two words.
		replace(i.notes, chr(1), ' '),
		E'(^|\n)(\\[\\d{4}-\\d{2}-\\d{2}\\] )',
		E'\\1\x01\\2',
		'g'
	),
	E'\x01'
) WITH ORDINALITY AS e(chunk, ord)
CROSS JOIN LATERAL (
	SELECT substring(e.chunk from E'^\\[(\\d{4}-\\d{2}-\\d{2})\\] ') AS prefix
) AS p
CROSS JOIN LATERAL (
	-- to_date() raises on an impossible date (2026-02-30) rather than clamping it,
	-- which would abort the whole migration; validate before casting.
	SELECT CASE WHEN pg_input_is_valid(p.prefix, 'date') THEN p.prefix::date END AS entry_date
) AS d
WHERE i.notes IS NOT NULL
  AND btrim(e.chunk, E' \r\n\t') <> '';

-- Backfill 2: items.note -> one final entry, placed after every parsed entry.
-- Skipped when it merely repeats the newest parsed entry: the old MCP exposed
-- `note` and `notes` as separate params for what was one write, so plenty of
-- items carry the same text in both and would otherwise log it twice.
INSERT INTO item_notes (item_id, note, actor, created_at)
SELECT
	i.id,
	btrim(i.note, E' \r\n\t'),
	NULL,
	GREATEST(
		i.updated_at,
		COALESCE((SELECT max(n.created_at) FROM item_notes n WHERE n.item_id = i.id), i.created_at)
			+ interval '1 second'
	)
FROM items i
WHERE i.note IS NOT NULL AND btrim(i.note, E' \r\n\t') <> ''
  AND btrim(i.note, E' \r\n\t') IS DISTINCT FROM (
	SELECT n.note FROM item_notes n WHERE n.item_id = i.id ORDER BY n.created_at DESC LIMIT 1
  );

-- The undo for an irreversible parse: the blob columns are about to be dropped,
-- and nothing else keeps their raw text. A later migration drops this table once
-- the log has been verified in prod.
CREATE TABLE items_notes_backup_027 AS
SELECT id, number, notes, note FROM items WHERE notes IS NOT NULL OR note IS NOT NULL;

ALTER TABLE items DROP COLUMN notes;
ALTER TABLE items DROP COLUMN note;
