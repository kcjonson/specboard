-- The MCP server no longer issues transport sessions (they lived in one process's
-- memory and every deploy stranded every connected client), so nothing may key on
-- a session id any more.
--
-- 1. mcp_tokens learns the MCP protocol clientInfo (name/version) the holder sent at
--    initialize. With a stateless transport the server answering a tool call never
--    saw the initialize, so the token row is the durable place to keep it for
--    provenance actors.
-- 2. item_workers episodes are keyed per OAuth client (actor->>'clientId') instead of
--    per transport session. Active episodes are ended first: they were opened under
--    the old grain and two of them on one client would collide under the new index.
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
CREATE UNIQUE INDEX idx_item_workers_active ON item_workers(item_id, (actor->>'clientId'))
	WHERE ended_at IS NULL;
