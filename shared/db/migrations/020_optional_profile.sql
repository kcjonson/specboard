-- Email-only signup: accounts are created with just an email address.
-- Username and names are claimed during post-first-login onboarding, so a
-- user row may exist without them. Unique index on username ignores NULLs.

ALTER TABLE users ALTER COLUMN username DROP NOT NULL;
ALTER TABLE users ALTER COLUMN first_name DROP NOT NULL;
ALTER TABLE users ALTER COLUMN last_name DROP NOT NULL;
