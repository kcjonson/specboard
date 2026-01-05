-- Project storage: Add git repository connection to projects
-- See /docs/specs/project-storage.md for details

-- Add storage columns to projects table
ALTER TABLE projects
	ADD COLUMN storage_mode TEXT NOT NULL DEFAULT 'none'
		CHECK (storage_mode IN ('none', 'local', 'cloud')),
	ADD COLUMN repository JSONB NOT NULL DEFAULT '{}',
	ADD COLUMN root_paths JSONB NOT NULL DEFAULT '[]';

-- repository JSON structure:
-- Local mode: { "localPath": "/path/to/repo", "branch": "main" }
-- Cloud mode: { "remote": { "provider": "github", "owner": "...", "repo": "...", "url": "..." }, "branch": "main" }

-- root_paths JSON structure:
-- Array of paths within repo to display, e.g., ["/docs", "/specs"]
-- Empty array means show entire repo

COMMENT ON COLUMN projects.storage_mode IS 'Storage mode: none (not configured), local (filesystem), or cloud (managed git checkout)';
COMMENT ON COLUMN projects.repository IS 'Repository configuration (localPath for local, remote for cloud)';
COMMENT ON COLUMN projects.root_paths IS 'Paths within repo to display in file browser';
