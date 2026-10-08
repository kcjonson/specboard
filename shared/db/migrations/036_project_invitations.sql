-- Project invitations: an owner invites an email address into a project with a role
-- (docs/specs/multi-user-collaboration.md, Data Model and Invitation Flow).
--
-- Only the token's SHA-256 is stored, as for magic links. Rows are never deleted: an
-- invitation ends by being accepted, declined, or revoked, and the stamp says which, so
-- the owner's view can show what happened. An open row past expires_at is expired.
--
-- New table only, no backfill. Rolling-deploy safe: the previous release never reads or
-- writes it.

CREATE TABLE project_invitations (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
	email VARCHAR(255) NOT NULL,
	role TEXT NOT NULL CHECK (role IN ('editor', 'viewer')),
	token_hash VARCHAR(64) NOT NULL UNIQUE,
	invited_by UUID REFERENCES users(id) ON DELETE SET NULL,
	created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	expires_at TIMESTAMPTZ NOT NULL,
	accepted_at TIMESTAMPTZ,
	declined_at TIMESTAMPTZ,
	revoked_at TIMESTAMPTZ
);

-- At most one open invitation per address per project. Re-inviting revokes the open one
-- first. Also serves the project's pending list.
CREATE UNIQUE INDEX idx_project_invitations_open
	ON project_invitations(project_id, email)
	WHERE accepted_at IS NULL AND declined_at IS NULL AND revoked_at IS NULL;

-- "Invitations addressed to me" on the projects list.
CREATE INDEX idx_project_invitations_email ON project_invitations(email)
	WHERE accepted_at IS NULL AND declined_at IS NULL AND revoked_at IS NULL;

COMMENT ON TABLE project_invitations IS 'Invitations into a project by email. Tombstoned by accepted_at, declined_at or revoked_at, never deleted.';
COMMENT ON COLUMN project_invitations.email IS 'The invited address, lowercased. Accepting requires an account whose verified email is this address.';
COMMENT ON COLUMN project_invitations.token_hash IS 'SHA-256 hex of the emailed token. The token itself is never stored.';
