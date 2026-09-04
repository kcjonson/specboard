-- The MCP server no longer holds transport sessions (they lived in one process's
-- memory and every deploy stranded every connected client). It still mints a session
-- id at initialize, but only as a correlation token the client echoes back; the
-- server keeps no transport state for it and never rejects a request over it.
--
-- 1. mcp_tokens learns the MCP protocol clientInfo (name/version) the holder sent at
--    initialize. With a stateless transport the server answering a tool call never
--    saw the initialize, so the token row is the durable place to keep it for
--    provenance actors.
-- 2. item_workers episodes are keyed per (user, OAuth client, session id). The
--    session id is client-echoed and a client id can be shared by many users (a
--    claude.ai org connector registers once), so userId, which only the token can
--    supply, is part of the key; COALESCE folds a client that sends no id into one
--    episode per (user, client) instead of stacking NULL rows.
--
-- Expand/contract: the old index stays for this release so the previous image's
-- upsert (which names it) keeps working during the rolling swap and on image
-- rollback. Existing active rows already satisfy the new key (old code never wrote a
-- NULL sessionId), so open episodes continue across the deploy. Migration 028 drops
-- idx_item_workers_active once no task from the previous release can run.

ALTER TABLE mcp_tokens
	ADD COLUMN client_name VARCHAR(255),
	ADD COLUMN client_version VARCHAR(64);

CREATE UNIQUE INDEX idx_item_workers_active_session
	ON item_workers(item_id, (actor->>'userId'), (actor->>'clientId'), (COALESCE(actor->>'sessionId', '')))
	WHERE ended_at IS NULL;
