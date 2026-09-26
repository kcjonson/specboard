-- User slugs: the owner half of a project address (acme/roadmap).
--
-- Every onboarded user gets a slug, unique site-wide, in the same alphabet as
-- project slugs. Users who haven't onboarded (NULL username) have a NULL slug;
-- onboarding claims both together, and users_slug_matches_username keeps it that
-- way, so every possible project owner is addressable.
--
-- Rolling deploys: users_slug_matches_username rejects the previous release's
-- onboarding claim and admin user create (they set a username without a slug)
-- until the new code is out. Only those two writes are affected, for the length
-- of the rollout.
--
-- The backfill default duplicates defaultUserSlug in shared/core/src/identifiers.ts:
-- the username lowercased, runs of anything else (in practice `_`) collapsed to one
-- hyphen, trimmed, `user` if nothing is left. This file is frozen history and must
-- not follow that helper if it changes.

SET lock_timeout = '5s';

ALTER TABLE users ADD COLUMN slug VARCHAR(39);

-- Backfilling is bookkeeping, not a profile edit; don't stamp every row's updated_at.
ALTER TABLE users DISABLE TRIGGER users_updated_at;

UPDATE users
SET slug = COALESCE(
	NULLIF(
		regexp_replace(
			regexp_replace(lower(username), '[^a-z0-9]+', '-', 'g'),
			'^-+|-+$', '', 'g'
		),
		''
	),
	'user'
)
WHERE username IS NOT NULL;

-- Colliding defaults ("Jane" and "jane", "jane_doe" and "jane__doe"): the oldest
-- account keeps the bare slug and the rest get a numeric suffix. A natural slug may
-- already hold the suffixed value (a user literally named jane_2 is jane-2), so each
-- candidate is probed against a temp table of taken values, as 023 does for projects.
-- Usernames are at most 30 characters, so a suffix never overflows the column.
DO $$
DECLARE
	dup       RECORD;
	candidate TEXT;
	n         INTEGER;
BEGIN
	CREATE TEMP TABLE taken_user_slug (value TEXT PRIMARY KEY) ON COMMIT DROP;
	INSERT INTO taken_user_slug (value) SELECT DISTINCT slug FROM users WHERE slug IS NOT NULL;

	FOR dup IN
		SELECT id, slug, rn FROM (
			SELECT id, slug,
				row_number() OVER (PARTITION BY slug ORDER BY created_at, id) AS rn
			FROM users
			WHERE slug IS NOT NULL
		) ranked WHERE rn > 1
		ORDER BY slug, rn
	LOOP
		n := dup.rn;
		LOOP
			candidate := dup.slug || '-' || n;
			EXIT WHEN NOT EXISTS (SELECT 1 FROM taken_user_slug t WHERE t.value = candidate);
			n := n + 1;
		END LOOP;
		UPDATE users SET slug = candidate WHERE id = dup.id;
		INSERT INTO taken_user_slug (value) VALUES (candidate);
	END LOOP;
END $$;

ALTER TABLE users ENABLE TRIGGER users_updated_at;

ALTER TABLE users
	ADD CONSTRAINT users_slug_format CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) <= 39),
	ADD CONSTRAINT users_slug_matches_username CHECK ((username IS NULL) = (slug IS NULL));

CREATE UNIQUE INDEX idx_users_slug ON users(slug) WHERE slug IS NOT NULL;
