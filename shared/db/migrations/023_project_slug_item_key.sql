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
-- The backfill derives slugs and keys from existing project names. That derivation
-- is intentionally duplicated from shared/core/src/identifiers.ts: this migration is
-- a frozen historical artifact and must not change when that helper evolves.

ALTER TABLE projects
    ADD COLUMN slug     VARCHAR(63),
    ADD COLUMN key      VARCHAR(10),
    ADD COLUMN item_seq INTEGER NOT NULL DEFAULT 0;

-- ── Slugs ────────────────────────────────────────────────────────────────────
-- Lowercase the name, collapse runs of non-alphanumerics to single hyphens, trim
-- hyphens from both ends, cap at 55 chars (leaving room for a dedupe suffix), then
-- re-trim in case the cap landed on a hyphen. Empty results fall back to 'project'.
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
-- Derived values collide (two projects named "Docs", or both falling back to PRJ).
-- Resolve by suffixing the newest of each colliding group until it is unique, then
-- repeat: each pass shrinks every duplicate group by one, so this terminates.
DO $$
DECLARE
    dup       RECORD;
    candidate TEXT;
    n         INTEGER;
BEGIN
    LOOP
        SELECT p.id, p.owner_id, p.slug INTO dup
        FROM projects p
        JOIN (
            SELECT owner_id, slug FROM projects GROUP BY owner_id, slug HAVING count(*) > 1
        ) g ON g.owner_id = p.owner_id AND g.slug = p.slug
        ORDER BY p.created_at DESC, p.id DESC
        LIMIT 1;
        EXIT WHEN NOT FOUND;

        n := 2;
        LOOP
            candidate := left(dup.slug, 60) || '-' || n;
            EXIT WHEN NOT EXISTS (
                SELECT 1 FROM projects WHERE owner_id = dup.owner_id AND slug = candidate
            );
            n := n + 1;
        END LOOP;
        UPDATE projects SET slug = candidate WHERE id = dup.id;
    END LOOP;

    LOOP
        SELECT p.id, p.owner_id, p.key INTO dup
        FROM projects p
        JOIN (
            SELECT owner_id, key FROM projects GROUP BY owner_id, key HAVING count(*) > 1
        ) g ON g.owner_id = p.owner_id AND g.key = p.key
        ORDER BY p.created_at DESC, p.id DESC
        LIMIT 1;
        EXIT WHEN NOT FOUND;

        n := 2;
        LOOP
            candidate := left(dup.key, 8) || n;
            EXIT WHEN NOT EXISTS (
                SELECT 1 FROM projects WHERE owner_id = dup.owner_id AND key = candidate
            );
            n := n + 1;
        END LOOP;
        UPDATE projects SET key = candidate WHERE id = dup.id;
    END LOOP;
END $$;

ALTER TABLE projects
    ALTER COLUMN slug SET NOT NULL,
    ALTER COLUMN key  SET NOT NULL,
    ADD CONSTRAINT projects_slug_format CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    ADD CONSTRAINT projects_key_format  CHECK (key ~ '^[A-Z][A-Z0-9]{1,9}$');

CREATE UNIQUE INDEX idx_projects_owner_slug ON projects(owner_id, slug);
CREATE UNIQUE INDEX idx_projects_owner_key  ON projects(owner_id, key);

-- ── Item numbers ─────────────────────────────────────────────────────────────
-- Number every item within its project in creation order, then seed each project's
-- allocator. Items with no project (pre-005 leftovers) can't be addressed by key
-- and stay unnumbered; the CHECK below keeps that the only case where number is NULL.
ALTER TABLE items ADD COLUMN number INTEGER;

UPDATE items i
SET number = n.seq
FROM (
    SELECT id, row_number() OVER (PARTITION BY project_id ORDER BY created_at, id) AS seq
    FROM items
    WHERE project_id IS NOT NULL
) n
WHERE i.id = n.id;

UPDATE projects p
SET item_seq = COALESCE((SELECT max(i.number) FROM items i WHERE i.project_id = p.id), 0);

ALTER TABLE items
    ADD CONSTRAINT items_number_present CHECK (project_id IS NULL OR number IS NOT NULL);

-- NULL project_id rows are exempt: NULLs compare distinct in a unique index.
CREATE UNIQUE INDEX idx_items_project_number ON items(project_id, number);
