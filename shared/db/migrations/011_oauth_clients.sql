-- RFC 7591 Dynamic Client Registration
-- Stores dynamically registered OAuth clients

CREATE TABLE oauth_clients (
    client_id VARCHAR(255) PRIMARY KEY,
    client_name VARCHAR(255),
    redirect_uris TEXT[] NOT NULL,
    token_endpoint_auth_method VARCHAR(50) NOT NULL DEFAULT 'none',
    grant_types TEXT[] NOT NULL DEFAULT ARRAY['authorization_code', 'refresh_token'],
    response_types TEXT[] NOT NULL DEFAULT ARRAY['code'],
    client_id_issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for cleanup of old unused clients (future work)
CREATE INDEX idx_oauth_clients_created_at ON oauth_clients(created_at);

-- Trigger to update updated_at on oauth_clients
CREATE OR REPLACE FUNCTION update_oauth_clients_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER oauth_clients_updated_at
    BEFORE UPDATE ON oauth_clients
    FOR EACH ROW
    EXECUTE FUNCTION update_oauth_clients_updated_at();
