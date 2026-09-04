-- The MCP server no longer holds transport sessions (they lived in one process's
-- memory and every deploy stranded every connected client). It still mints a session
-- id at initialize, but only as a correlation token the client echoes back; the
-- server stores nothing for it and never validates it.
--
-- 1. mcp_tokens learns the MCP protocol clientInfo (name/version) the holder sent at
--    initialize. With a stateless transport the server answering a tool call never
--    saw the initialize, so the token row is the durable place to keep it for
--    provenance actors.
-- 2. item_workers episodes are keyed per (OAuth client, session id). The session id
--    is client-echoed, so scoping it under the client keeps a forged id from
--    touching another install's row; COALESCE keeps a client that sends no id to one
--    episode instead of stacking NULL rows. Active episodes are ended first so the
--    new index builds clean.
--
-- Deploy note: between this migration and the MCP service swap, the previous
-- release's worker upsert names the old index and errors on in_progress writes. The
-- swap also drops every live session, so the window is the same disruption this
-- change removes for good.

ALTER TABLE mcp_tokens
	ADD COLUMN client_name VARCHAR(255),
	ADD COLUMN client_version VARCHAR(64);

UPDATE item_workers SET ended_at = now() WHERE ended_at IS NULL;

DROP INDEX idx_item_workers_active;
CREATE UNIQUE INDEX idx_item_workers_active
	ON item_workers(item_id, (actor->>'clientId'), (COALESCE(actor->>'sessionId', '')))
	WHERE ended_at IS NULL;
