-- Server-side access-token TTL for MCP tokens.
-- expires_at is the refresh-token (30-day) expiry; the 1-hour access-token
-- TTL advertised via expires_in was never enforced server-side. Backfill
-- existing rows to NOW() so old access tokens are treated as expired and
-- clients silently refresh on next use.

ALTER TABLE mcp_tokens ADD COLUMN access_token_expires_at TIMESTAMPTZ;
UPDATE mcp_tokens SET access_token_expires_at = NOW();
ALTER TABLE mcp_tokens ALTER COLUMN access_token_expires_at SET NOT NULL;
