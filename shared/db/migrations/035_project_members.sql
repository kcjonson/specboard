-- Project membership: who besides the owner can reach a project, and with what role
-- (docs/specs/multi-user-collaboration.md, Data Model).
--
-- The owner is not a row here. projects.owner_id stays the single source of ownership;
-- a members table that also held an owner row would give ownership two sources that
-- could disagree. A row's role is the granted one. The effective role (an editor with
-- no GitHub connection works as a viewer) is derived at read time from
-- github_connections, so connecting or disconnecting GitHub never touches this table.
--
-- New table only, no backfill. Rolling-deploy safe: the previous release never reads or
-- writes it, and with no rows every project is reachable by its owner alone, exactly as
-- before.

CREATE TABLE project_members (
	project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
	user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	role TEXT NOT NULL CHECK (role IN ('editor', 'viewer')),
	added_by UUID REFERENCES users(id) ON DELETE SET NULL,
	created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	PRIMARY KEY (project_id, user_id)
);

-- The primary key serves the resolver's (project, caller) lookup and a project's member
-- list; this serves "projects shared with me" and the user deletion's cascade.
CREATE INDEX idx_project_members_user ON project_members(user_id);

COMMENT ON TABLE project_members IS 'Non-owner members of a project with their granted role. The owner is projects.owner_id, never a row here.';
COMMENT ON COLUMN project_members.role IS 'Granted role. The effective role drops editor to viewer while the member has no github_connections row.';
