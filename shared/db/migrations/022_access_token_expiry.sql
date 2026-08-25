-- Server-side access-token TTL for MCP tokens.
-- expires_at is the refresh-token (30-day) expiry; the 1-hour access-token
-- TTL advertised via expires_in was never enforced server-side. Backfill
-- existing rows to NOW() so old access tokens are treated as expired and
-- clients silently refresh on next use.
-- DEFAULT NOW() also covers API tasks still running pre-022 code during the
-- deploy window: their INSERT omits the column and gets an immediately
-- expired access token, which self-heals via refresh.

ALTER TABLE mcp_tokens ADD COLUMN access_token_expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
