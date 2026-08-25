-- Human-friendly identifiers for URLs.
--
-- Projects gain a `slug` (lowercase, URL-safe, derived from the name) that replaces
-- the UUID in every user-facing address, and a short uppercase `key` (JIRA-style,
-- e.g. SB) that prefixes item keys. Items gain a per-project sequential `number`,
-- so an item is addressed as `<project key>-<number>` — SB-345.
--
-- Both project columns are unique per owner, which is the same scope as access
-- control (projects.owner_id), so a slug resolves unambiguously for the signed-in
-- user. Item numbers are allocated from projects.item_seq.
--
-- ── THIS MIGRATION REQUIRES A WRITE FREEZE ──────────────────────────────────
--
-- It is NOT rolling-deploy safe. The constraints it adds (projects.slug/key NOT
-- NULL, items_number_present) reject the INSERTs that the *previous* release's
-- code writes, so from the moment this commits until the new code is fully rolled
-- out, every project create and every item create fails. Reads are unaffected.
--
-- Deploy it during a window where writes can fail, or split it into an
-- expand/contract pair (nullable columns + backfill now, constraints in a later
-- migration once the new code is everywhere) if that is not acceptable.
--
-- ── Statement ordering matters ──────────────────────────────────────────────
--
-- Everything here is one transaction, so the FIRST statement to touch a table
-- holds ACCESS EXCLUSIVE on it until COMMIT. The items backfill dominates the
-- runtime (~85s per 2M items), so all items work is done first and projects is
-- touched only at the end: that holds the small, hot projects table for ~0.3s
-- instead of the ~93s it took when the order was reversed. Creating
-- idx_items_project_number before the item_seq rollup also lets that rollup use
-- an index-only scan rather than a sequential scan per project.
--
-- Expect the items heap to roughly double (the backfill rewrites every row) and
-- a large WAL burst — around 880 bytes per item. Run VACUUM (ANALYZE) items
-- afterwards; autovacuum will not reclaim that promptly at scale.
--
-- The backfill derives slugs and keys from existing project names. That derivation
-- is intentionally duplicated from shared/core/src/identifiers.ts: this migration is
-- a frozen historical artifact and must not change when that helper evolves. The
-- length caps below must stay in step with MAX_PROJECT_SLUG_LENGTH (55) and
-- MAX_PROJECT_KEY_LENGTH (10) — a value this migration writes that the app's
-- validators reject is a project no request can address.

-- Fail fast rather than queueing for a lock: a single slow query on projects or
-- items would otherwise stall every other session behind this migration's pending
-- ACCESS EXCLUSIVE request. Aborting is safe — the whole file is one transaction.
SET lock_timeout = '5s';

-- ── Item numbers ─────────────────────────────────────────────────────────────
-- Number every item within its project in creation order. Items with no project
-- (pre-005 leftovers) can't be addressed by key and stay unnumbered; the CHECK
-- below keeps that the only case.
ALTER TABLE items ADD COLUMN number INTEGER;

UPDATE items i
SET number = n.seq
FROM (
	SELECT id, row_number() OVER (PARTITION BY project_id ORDER BY created_at, id) AS seq
	FROM items
	WHERE project_id IS NOT NULL
) n
WHERE i.id = n.id;

ALTER TABLE items
	ADD CONSTRAINT items_number_present CHECK (project_id IS NULL OR number IS NOT NULL);

-- NULL project_id rows are exempt: NULLs compare distinct in a unique index.
CREATE UNIQUE INDEX idx_items_project_number ON items(project_id, number);

ALTER TABLE projects
	ADD COLUMN slug     VARCHAR(63),
	ADD COLUMN key      VARCHAR(10),
	ADD COLUMN item_seq INTEGER NOT NULL DEFAULT 0;

-- The backfill is bookkeeping, not a user edit. projects_updated_at would stamp
-- every row with the migration timestamp, and getProjects orders by updated_at
-- DESC with no tiebreak — that would scramble every user's project list into heap
-- order until they next touched each project.
ALTER TABLE projects DISABLE TRIGGER projects_updated_at;

-- ── Slugs ────────────────────────────────────────────────────────────────────
-- Lowercase the name, collapse runs of non-alphanumerics to single hyphens, trim
-- hyphens from both ends, cap at 55 chars, then re-trim in case the cap landed on
-- a hyphen. Empty results fall back to 'project'.
UPDATE projects
SET slug = COALESCE(
	NULLIF(
		regexp_replace(
			substring(
				regexp_replace(
					regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g'),
					'^-+|-+$', '', 'g'
				)
				FROM 1 FOR 55
			),
			'-+$', '', 'g'
		),
		''
	),
	'project'
);

-- ── Keys ─────────────────────────────────────────────────────────────────────
-- Multi-word names use the initials of the first five words ("Dual Deck Builder"
-- -> DDB); single-word names use the first three characters ("Specboard" -> SPE).
-- Anything that doesn't land on a valid key (leading digit, too short) becomes PRJ.
UPDATE projects p
SET key = CASE
	WHEN derived ~ '^[A-Z][A-Z0-9]{1,9}$' THEN derived
	ELSE 'PRJ'
END
FROM (
	SELECT
		id,
		CASE
			WHEN array_length(words, 1) IS NULL THEN ''
			WHEN array_length(words, 1) > 1 THEN
				upper(substr(array_to_string(ARRAY(SELECT substr(w, 1, 1) FROM unnest(words) w), ''), 1, 5))
			ELSE upper(substr(words[1], 1, 3))
		END AS derived
	FROM (
		SELECT
			id,
			ARRAY(
				SELECT x FROM unnest(regexp_split_to_array(name, '[^A-Za-z0-9]+')) x WHERE x <> ''
			) AS words
		FROM projects
	) split
) d
WHERE p.id = d.id;

-- ── Deduplicate within each owner ────────────────────────────────────────────
-- Derived values collide (two projects named "Docs", or several falling back to
-- PRJ). Each colliding group keeps its oldest member and the rest get a numeric
-- suffix. The suffix cannot simply be the row's rank: a natural slug may already
-- occupy it (a project literally named "Docs 2" slugs to `docs-2`), so each
-- candidate is probed against the values already taken.
--
-- That probe runs against a temp table keyed by (owner_id, value) rather than
-- against `projects`, whose unique indexes do not exist yet — probing the base
-- table would be a sequential scan per attempt, making the whole block quadratic.
-- Duplicates are visited exactly once, in a single pass.
DO $$
DECLARE
	dup       RECORD;
	candidate TEXT;
	n         INTEGER;
BEGIN
	CREATE TEMP TABLE taken_slug (owner_id UUID, value TEXT, PRIMARY KEY (owner_id, value)) ON COMMIT DROP;
	INSERT INTO taken_slug (owner_id, value) SELECT DISTINCT owner_id, slug FROM projects;

	FOR dup IN
		SELECT id, owner_id, slug, rn FROM (
			SELECT id, owner_id, slug,
				row_number() OVER (PARTITION BY owner_id, slug ORDER BY created_at, id) AS rn
			FROM projects
		) ranked WHERE rn > 1
	LOOP
		-- Start at this row's rank rather than 2: earlier members of the same group
		-- have already taken the lower suffixes, so probing from 2 would rescan them
		-- and make the pass quadratic. Skipping a free lower slot is harmless.
		n := dup.rn;
		LOOP
			-- Cap to 55 total, then re-trim so the cut can't leave `foo--2`.
			candidate := regexp_replace(left(dup.slug, 55 - length(n::text) - 1), '-+$', '', 'g') || '-' || n;
			EXIT WHEN NOT EXISTS (
				SELECT 1 FROM taken_slug t WHERE t.owner_id = dup.owner_id AND t.value = candidate
			);
			n := n + 1;
		END LOOP;
		UPDATE projects SET slug = candidate WHERE id = dup.id;
		INSERT INTO taken_slug (owner_id, value) VALUES (dup.owner_id, candidate);
	END LOOP;

	CREATE TEMP TABLE taken_key (owner_id UUID, value TEXT, PRIMARY KEY (owner_id, value)) ON COMMIT DROP;
	INSERT INTO taken_key (owner_id, value) SELECT DISTINCT owner_id, key FROM projects;

	FOR dup IN
		SELECT id, owner_id, key, rn FROM (
			SELECT id, owner_id, key,
				row_number() OVER (PARTITION BY owner_id, key ORDER BY created_at, id) AS rn
			FROM projects
		) ranked WHERE rn > 1
	LOOP
		n := dup.rn;
		LOOP
			-- Cap to 10 total so a large suffix can't overflow the column.
			candidate := left(dup.key, 10 - length(n::text)) || n;
			EXIT WHEN NOT EXISTS (
				SELECT 1 FROM taken_key t WHERE t.owner_id = dup.owner_id AND t.value = candidate
			);
			n := n + 1;
		END LOOP;
		UPDATE projects SET key = candidate WHERE id = dup.id;
		INSERT INTO taken_key (owner_id, value) VALUES (dup.owner_id, candidate);
	END LOOP;
END $$;

-- Seed each project's allocator from the numbers just assigned. Runs after
-- idx_items_project_number exists, so this is an index-only scan.
UPDATE projects p
SET item_seq = COALESCE((SELECT max(i.number) FROM items i WHERE i.project_id = p.id), 0);

-- Restore the trigger, but scoped: bumping item_seq to hand out an item number is
-- bookkeeping, not a user edit, and getProjects orders by updated_at. Without the
-- WHEN clause every item creation would reshuffle the caller's project list —
-- the same effect this migration disables the trigger to avoid during backfill.
DROP TRIGGER projects_updated_at ON projects;
CREATE TRIGGER projects_updated_at
	BEFORE UPDATE ON projects
	FOR EACH ROW
	WHEN (OLD.item_seq IS NOT DISTINCT FROM NEW.item_seq)
	EXECUTE FUNCTION update_epic_timestamp();

ALTER TABLE projects
	ALTER COLUMN slug SET NOT NULL,
	ALTER COLUMN key  SET NOT NULL,
	ADD CONSTRAINT projects_slug_format CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) <= 55),
	ADD CONSTRAINT projects_key_format  CHECK (key ~ '^[A-Z][A-Z0-9]{1,9}$');

CREATE UNIQUE INDEX idx_projects_owner_slug ON projects(owner_id, slug);
CREATE UNIQUE INDEX idx_projects_owner_key  ON projects(owner_id, key);

