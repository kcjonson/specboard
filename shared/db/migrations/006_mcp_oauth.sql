-- MCP OAuth 2.1 schema updates
-- Add device_name and last_used_at to mcp_tokens for authorization management

-- Drop existing mcp_tokens table and recreate with new columns
-- (The table was defined in 003 but never populated in production)
DROP TABLE IF EXISTS mcp_tokens CASCADE;
DROP TABLE IF EXISTS oauth_codes CASCADE;

-- MCP OAuth tokens - stores authorized device sessions
CREATE TABLE mcp_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    client_id VARCHAR(255) NOT NULL,
    device_name VARCHAR(255) NOT NULL,
    access_token_hash VARCHAR(255) NOT NULL UNIQUE,
    refresh_token_hash VARCHAR(255) UNIQUE,
    scopes TEXT[] NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at TIMESTAMPTZ
);

-- OAuth authorization codes (short-lived, used during PKCE flow)
CREATE TABLE oauth_codes (
    code VARCHAR(255) PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    client_id VARCHAR(255) NOT NULL,
    device_name VARCHAR(255) NOT NULL,
    code_challenge VARCHAR(255) NOT NULL,
    code_challenge_method VARCHAR(10) NOT NULL DEFAULT 'S256',
    scopes TEXT[] NOT NULL,
    redirect_uri TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for efficient lookups
CREATE INDEX idx_mcp_tokens_user_id ON mcp_tokens(user_id);
CREATE INDEX idx_mcp_tokens_expires_at ON mcp_tokens(expires_at);
CREATE INDEX idx_mcp_tokens_refresh_token_hash ON mcp_tokens(refresh_token_hash);
CREATE INDEX idx_oauth_codes_expires_at ON oauth_codes(expires_at);
CREATE INDEX idx_oauth_codes_user_id ON oauth_codes(user_id);

-- Cleanup job can use these to delete expired tokens/codes
-- DELETE FROM mcp_tokens WHERE expires_at < NOW();
-- DELETE FROM oauth_codes WHERE expires_at < NOW();
